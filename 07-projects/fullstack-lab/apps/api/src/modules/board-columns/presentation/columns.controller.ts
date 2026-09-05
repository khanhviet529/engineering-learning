import type { KeyRing } from "../../../shared/security/key-ring.ts";
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createColumnRequestSchema,
  reorderColumnsRequestSchema,
  updateColumnRequestSchema,
} from "@flowboard/contracts";
import { z } from "zod";
import {
  ProjectPermissionGuard,
  RequireProjectPermission,
  SessionGuard,
  WorkspacePermissionGuard,
  getActor,
} from "../../../shared/authorization/index.ts";
import { getRequestId, ok } from "../../../shared/http/envelope.ts";
import { parse } from "../../../shared/http/validation.ts";
import { requireCsrf } from "../../../shared/http/csrf.ts";
import {
  applyReplay,
  requireIdempotencyKey,
  runIdempotent,
} from "../../../shared/http/idempotency-runner.ts";
import { validationError } from "../../../shared/errors/app-error.ts";
import type { Database } from "../../../shared/database/client.ts";
import { formatPosition } from "../../../shared/ordering/position.ts";
import type { ColumnUseCases, ColumnView } from "../application/column-use-cases.ts";

/**
 * Controller của module `board-columns`.
 *
 * Nó biết HTTP và không biết Drizzle. Chuỗi guard khai tường minh trên từng
 * route: một route quên guard phải **nhìn thấy được** khi đọc file này.
 */

export const COLUMN_TOKENS = {
  useCases: Symbol("ColumnUseCases"),
  config: Symbol("ColumnConfig"),
  db: Symbol("ColumnDatabase"),
} as const;

export interface ColumnHttpConfig {
  csrfSecret: KeyRing;
}

const projectIdParamSchema = z.object({ projectId: z.uuid() }).strict();
const columnIdParamSchema = z.object({ columnId: z.uuid() }).strict();

/**
 * Projection column: đúng bảy field mà `boardColumnSchema` công bố.
 *
 * `position` là **string** trong hợp đồng (`numeric` giữ nguyên precision qua
 * JSON), và nó đi từ database tới đây mà **không** qua `number` ở bất kỳ bước
 * nào — xem `shared/ordering/position.ts`.
 */
function toColumnProjection(column: ColumnView) {
  return {
    id: column.id,
    projectId: column.projectId,
    name: column.name,
    requiresReviewer: column.requiresReviewer,
    isTerminal: column.isTerminal,
    position: formatPosition(column.position),
    archivedAt: column.archivedAt === null ? null : column.archivedAt.toISOString(),
  };
}

/**
 * Dịch body PATCH thành **một** command tường minh.
 *
 * `updateColumnRequestSchema` là `z.union`, và union chọn **nhánh khớp đầu
 * tiên** — nó một mình không từ chối được `{ name, archive: true }`, vì nhánh
 * `{ name }` là `.strict()` nên sẽ fail, rồi nhánh `{ archive }` cũng fail...
 * thực ra cả bốn nhánh strict đều fail và union từ chối. Nhưng dựa vào điều đó
 * là dựa vào một chi tiết của thư viện; phép đếm dưới đây nói thẳng ý định:
 * **đúng một** khoá, và nó phải là một trong bốn khoá đã biết.
 */
function toCommand(body: unknown) {
  const parsed = parse(updateColumnRequestSchema, body);

  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 1) {
    throw validationError([
      {
        field: "(root)",
        code: "ambiguous_command",
        message: "Mỗi request chỉ được mang đúng một lệnh cập nhật.",
      },
    ]);
  }

  if ("name" in parsed) return { kind: "rename" as const, name: parsed.name };
  if ("isTerminal" in parsed) return { kind: "terminal" as const, isTerminal: parsed.isTerminal };
  if ("requiresReviewer" in parsed) {
    return { kind: "reviewer" as const, requiresReviewer: parsed.requiresReviewer };
  }
  return { kind: "archive" as const };
}

@Controller()
@UseGuards(SessionGuard, WorkspacePermissionGuard, ProjectPermissionGuard)
export class ColumnsController {
  constructor(
    @Inject(COLUMN_TOKENS.useCases) private readonly useCases: ColumnUseCases,
    @Inject(COLUMN_TOKENS.config) private readonly config: ColumnHttpConfig,
    @Inject(COLUMN_TOKENS.db) private readonly db: Database,
  ) {}

  /** `POST /projects/:projectId/columns` — `201`. */
  @Post("projects/:projectId/columns")
  @HttpCode(201)
  @RequireProjectPermission("board-column:manage")
  async createColumn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    // `.strict()`: `projectId`, `position`, `archivedAt` hay timestamp trong
    // body đều là `400`, không phải field bị bỏ qua im lặng.
    const input = parse(createColumnRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "board-column.create",
      key,
      request: { projectId, ...input },
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.useCases.createColumn(actor, projectId, input, recordOutcome, (column) => ({
          column: toColumnProjection(column),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { column: toColumnProjection(result.value as ColumnView) });
  }

  /** `PATCH /columns/:columnId` — `200`, đúng một command. */
  @Patch("columns/:columnId")
  @RequireProjectPermission("board-column:manage")
  async updateColumn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { columnId } = parse(columnIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const command = toCommand(body);

    /**
     * `projectId` lấy từ **authorization đã resolve**, không từ client.
     *
     * Guard đã tra chủ sở hữu thật của cột và gắn nó lên request. Đọc lại từ
     * đó là cách duy nhất chắc chắn use case scope theo đúng project mà quyền
     * vừa được kiểm.
     */
    const projectId = requireResolvedProjectId(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "board-column.update",
      key,
      request: { columnId, ...(command as Record<string, unknown>) },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.useCases.updateColumn(
          actor,
          projectId,
          columnId,
          command,
          recordOutcome,
          (column) => ({ column: toColumnProjection(column) }),
        ),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { column: toColumnProjection(result.value as ColumnView) });
  }

  /**
   * `POST /columns/reorder` — **`200`**, không phải `201`.
   *
   * Nest mặc định POST là `201`, và `@HttpCode(200)` vắng mặt trông y hệt
   * `@HttpCode(200)` đúng. M1 đã dính đúng lỗi này ở `email/verify` và
   * `sign-in`, và nó chỉ lộ ra khi gọi endpoint thật.
   */
  @Post("columns/reorder")
  @HttpCode(200)
  @RequireProjectPermission("board-column:manage")
  async reorderColumns(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const key = requireIdempotencyKey(request);
    const input = parse(reorderColumnsRequestSchema, body);

    // Project đã được guard authorize từ chính `input.projectId`; đọc lại từ
    // authorization thay vì tin body lần thứ hai.
    const projectId = requireResolvedProjectId(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "board-column.reorder",
      key,
      request: { projectId, orderedColumnIds: input.orderedColumnIds },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.useCases.reorderColumns(
          actor,
          projectId,
          input.orderedColumnIds,
          recordOutcome,
          (columns) => ({ columns: columns.map(toColumnProjection) }),
        ),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, {
      columns: (result.value as ColumnView[]).map(toColumnProjection),
    });
  }
}

/**
 * Project mà guard vừa authorize.
 *
 * Vắng mặt nghĩa là route quên `@RequireProjectPermission` — một lỗi lập trình,
 * không phải một nhánh người dùng gặp. Ném lỗi nội bộ chứ **không** rơi về
 * `projectId` do client gửi: rơi về đó là bỏ qua đúng lớp vừa kiểm quyền.
 */
function requireResolvedProjectId(request: FastifyRequest): string {
  const authorization = (
    request as FastifyRequest & { projectAuthorization?: { projectId: string } }
  ).projectAuthorization;

  if (authorization === undefined) {
    throw new Error("Route thiếu @RequireProjectPermission: không có project đã authorize.");
  }
  return authorization.projectId;
}
