import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createWorkspaceRequestSchema, paginationQuerySchema } from "@flowboard/contracts";
import { z } from "zod";
import {
  ProjectPermissionGuard,
  RequireWorkspacePermission,
  SessionGuard,
  WorkspacePermissionGuard,
  getActor,
} from "../../../shared/authorization/index.ts";
import { getRequestId, ok, okList } from "../../../shared/http/envelope.ts";
import { parse } from "../../../shared/http/validation.ts";
import { requireCsrf } from "../../../shared/http/csrf.ts";
import {
  applyReplay,
  requireIdempotencyKey,
  runIdempotent,
} from "../../../shared/http/idempotency-runner.ts";
import type { Database } from "../../../shared/database/client.ts";
import type {
  WorkspaceMemberView,
  WorkspaceSummary,
  WorkspaceUseCases,
} from "../application/workspace-use-cases.ts";

/**
 * Controller của module `workspaces`.
 *
 * Nó biết HTTP và không biết Drizzle. Mỗi route ánh xạ **một** use case, parse
 * input bằng schema của `@flowboard/contracts`, rồi dịch outcome sang status.
 *
 * Chuỗi guard được khai tường minh trên từng route thay vì đặt toàn cục: một
 * route quên guard phải là điều **nhìn thấy được** khi đọc file này, chứ không
 * phải một dòng thiếu trong một file cấu hình ở nơi khác.
 */

export const WORKSPACE_TOKENS = {
  useCases: Symbol("WorkspaceUseCases"),
  config: Symbol("WorkspaceConfig"),
  db: Symbol("WorkspaceDatabase"),
} as const;

export interface WorkspaceHttpConfig {
  csrfSecret: string;
}

/** UUID trong path phải hợp lệ trước khi chạm database. */
const workspaceIdParamSchema = z.object({ workspaceId: z.uuid() }).strict();
const memberParamSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() }).strict();

/** Projection member: đúng field mà hợp đồng công bố, không hơn. */
function toMemberProjection(member: WorkspaceMemberView) {
  return {
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
  };
}

function toWorkspaceProjection(workspace: WorkspaceSummary) {
  return {
    id: workspace.id,
    name: workspace.name,
    role: workspace.role,
    capabilities: workspace.capabilities,
  };
}

@Controller()
@UseGuards(SessionGuard, WorkspacePermissionGuard, ProjectPermissionGuard)
export class WorkspacesController {
  constructor(
    @Inject(WORKSPACE_TOKENS.useCases) private readonly useCases: WorkspaceUseCases,
    @Inject(WORKSPACE_TOKENS.config) private readonly config: WorkspaceHttpConfig,
    @Inject(WORKSPACE_TOKENS.db) private readonly db: Database,
  ) {}

  /**
   * `GET /workspaces`.
   *
   * Cố ý **không** có `@RequireWorkspacePermission`: không có một workspace cụ
   * thể để authorize. Scope là kết quả — repository chỉ trả workspace mà actor
   * có dòng membership.
   */
  @Get("workspaces")
  async listWorkspaces(@Req() request: FastifyRequest, @Query() query: unknown) {
    const actor = getActor(request);
    const page = parse(paginationQuerySchema, query ?? {});

    const result = await this.useCases.listWorkspacesForActor(actor, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });

    return okList(request, result.items.map(toWorkspaceProjection), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  /** `POST /workspaces` — `201`, cần CSRF và `Idempotency-Key`. */
  @Post("workspaces")
  @HttpCode(201)
  async createWorkspace(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const key = requireIdempotencyKey(request);
    const input = parse(createWorkspaceRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "workspace.create",
      key,
      request: input,
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.useCases.createWorkspace(actor, input, recordOutcome, (summary) => ({
          workspace: toWorkspaceProjection(summary),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { workspace: toWorkspaceProjection(result.value as WorkspaceSummary) });
  }

  /** `GET /workspaces/:workspaceId/members` — Workspace Admin. */
  @Get("workspaces/:workspaceId/members")
  @RequireWorkspacePermission("workspace:member:manage")
  async listMembers(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const actor = getActor(request);
    const { workspaceId } = parse(workspaceIdParamSchema, params);
    const page = parse(paginationQuerySchema, query ?? {});

    const result = await this.useCases.listWorkspaceMembers(actor, workspaceId, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });

    return okList(request, result.items.map(toMemberProjection), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  /**
   * `POST /workspaces/:workspaceId/members` — **chưa dựng**.
   *
   * [ADR-0013](../../../../../docs/decisions/ADR-0013-workspace-member-invitation.md)
   * (Accepted 04/09/2026) đổi route này từ `{ userId, role }` sang mời theo
   * email, và thêm ba route lời mời. Hợp đồng và `@flowboard/contracts` đã cập
   * nhật; phần hiện thực chưa.
   *
   * Route cũ được **xoá** thay vì giữ lại: giữ nó nghĩa là server vẫn nhận
   * `userId` trong khi hợp đồng nói nó nhận email, và một sai lệch im lặng giữa
   * hai bên tệ hơn một `404`. Cho tới khi ba route mới được dựng, gọi route này
   * trả `404` — cùng cách mà `GET /workspaces/:workspaceId/projects` đã ở trong
   * khoảng giữa hợp đồng và hiện thực.
   *
   * Việc cần làm, theo ADR-0013:
   * - `POST /workspaces/:workspaceId/members` — body `{ email, role }`, **luôn**
   *   trả `202 { accepted: true }` ở mọi nhánh, kể cả email không có account.
   * - `GET /workspaces/:workspaceId/invitations` — chỉ lời mời `pending`.
   * - `DELETE /workspaces/:workspaceId/invitations/:invitationId` — `204`.
   * - `POST /invitations/accept` — một transaction: validate token, kiểm email
   *   actor khớp email được mời, tạo membership, đánh dấu `accepted`.
   */

  /** `DELETE /workspaces/:workspaceId/members/:userId` — `204`, không body. */
  @Delete("workspaces/:workspaceId/members/:userId")
  @HttpCode(204)
  @RequireWorkspacePermission("workspace:member:manage")
  async removeMember(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { workspaceId, userId } = parse(memberParamSchema, params);
    const key = requireIdempotencyKey(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "workspace.member.remove",
      key,
      request: { workspaceId, userId },
      successStatus: 204,
      run: async (recordOutcome) => {
        await this.useCases.removeWorkspaceMember(workspaceId, userId, recordOutcome);
      },
    });

    // Replay vẫn phải tôn trọng status đã lưu: một lần gọi trước bị chặn bởi
    // bất biến đã lưu `400`, và phát lại nó dưới `204` sẽ báo thành công cho
    // một thao tác chưa từng xảy ra.
    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return undefined;
  }
}
