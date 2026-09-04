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
import {
  acceptInvitationRequestSchema,
  createWorkspaceRequestSchema,
  inviteWorkspaceMemberRequestSchema,
  listInvitationsQuerySchema,
  paginationQuerySchema,
} from "@flowboard/contracts";
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
import type { RateLimiter } from "../../../shared/http/rate-limit.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import type { Database } from "../../../shared/database/client.ts";
import type {
  InvitationUseCases,
  JoinedWorkspaceView,
  PendingInvitationView,
} from "../application/invitation-use-cases.ts";
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
  invitations: Symbol("InvitationUseCases"),
  rateLimiter: Symbol("WorkspaceRateLimiter"),
  config: Symbol("WorkspaceConfig"),
  db: Symbol("WorkspaceDatabase"),
} as const;

export interface WorkspaceHttpConfig {
  csrfSecret: string;
}

/** UUID trong path phải hợp lệ trước khi chạm database. */
const workspaceIdParamSchema = z.object({ workspaceId: z.uuid() }).strict();
const memberParamSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() }).strict();
const invitationParamSchema = z.object({ workspaceId: z.uuid(), invitationId: z.uuid() }).strict();

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

/**
 * Projection lời mời: đúng sáu field hợp đồng công bố.
 *
 * **Không** `tokenHash` và **không** `status`. Viết tường minh từng field thay
 * vì trải `...row`: trải là cách một cột mới thêm vào database âm thầm đi ra
 * response, và cột nhạy cảm nhất của bảng này chính là `token_hash`.
 */
function toPendingInvitationProjection(invitation: PendingInvitationView) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedBy: {
      id: invitation.invitedBy.id,
      displayName: invitation.invitedBy.displayName,
    },
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function toJoinedWorkspaceProjection(workspace: JoinedWorkspaceView) {
  return {
    id: workspace.id,
    name: workspace.name,
    role: workspace.role,
    capabilities: workspace.capabilities,
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
    @Inject(WORKSPACE_TOKENS.invitations) private readonly invitations: InvitationUseCases,
    @Inject(WORKSPACE_TOKENS.rateLimiter) private readonly limiter: RateLimiter,
    @Inject(WORKSPACE_TOKENS.config) private readonly config: WorkspaceHttpConfig,
    @Inject(WORKSPACE_TOKENS.db) private readonly db: Database,
  ) {}

  /**
   * Tín hiệu định danh cho rate limit: địa chỉ IP của kết nối.
   *
   * **Không** dùng header do client gửi như `X-Forwarded-For`: không có proxy
   * tin cậy phía trước thì client tự chọn được bucket của mình, và rate limit
   * thành vô nghĩa. Cùng lối mà module `auth` đã dùng.
   */
  #enforceInviteRateLimit(request: FastifyRequest): void {
    const subject = request.socket.remoteAddress ?? "unknown";
    const result = this.limiter.consume("workspace.invite", subject);
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", { retryAfterSeconds: result.retryAfterSeconds });
    }
  }

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

  /**
   * `POST /workspaces/:workspaceId/members` — mời member qua email. `202`.
   *
   * Nest mặc định POST là `201`; hợp đồng ghi `202`. `@HttpCode(202)` vắng mặt
   * trông y hệt `@HttpCode(202)` đúng, và chỉ gọi endpoint thật mới lộ ra — đã
   * dính đúng lỗi này ở `email/verify` và `sign-in` của M1.
   *
   * Body response là hằng số, dựng ở **một** chỗ: không có nhánh nào trong
   * controller hay use case chạm được vào nó để làm nó khác đi.
   */
  @Post("workspaces/:workspaceId/members")
  @HttpCode(202)
  @RequireWorkspacePermission("workspace:member:manage")
  async inviteMember(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    // Rate limit **trước** khi gửi thư, không phải sau: giới hạn đặt sau lần
    // gửi thứ n là giới hạn đã cho phép n lá thư đi ra.
    this.#enforceInviteRateLimit(request);

    const actor = getActor(request);
    const { workspaceId } = parse(workspaceIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(inviteWorkspaceMemberRequestSchema, body);

    const accepted = { accepted: true as const };

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "workspace.member.invite",
      key,
      request: { workspaceId, ...input },
      successStatus: 202,
      run: async (recordOutcome) => {
        await this.invitations.inviteMember(actor, workspaceId, input, recordOutcome, accepted);
      },
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, accepted);
  }

  /** `GET /workspaces/:workspaceId/invitations` — lời mời đang chờ. `200`. */
  @Get("workspaces/:workspaceId/invitations")
  @RequireWorkspacePermission("workspace:member:manage")
  async listInvitations(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const actor = getActor(request);
    const { workspaceId } = parse(workspaceIdParamSchema, params);
    const page = parse(listInvitationsQuerySchema, query ?? {});

    const result = await this.invitations.listPendingInvitations(actor, workspaceId, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });

    return okList(request, result.items.map(toPendingInvitationProjection), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  /**
   * `DELETE /workspaces/:workspaceId/invitations/:invitationId` — thu hồi. `204`.
   *
   * `:invitationId` là **locator, không phải bằng chứng quyền**: guard chỉ
   * authorize workspace trên URL, nên repository vẫn ràng buộc `workspace_id`
   * trong `WHERE`. Nhờ đó một admin của workspace khác đoán trúng ID cũng chỉ
   * nhận `404`.
   */
  @Delete("workspaces/:workspaceId/invitations/:invitationId")
  @HttpCode(204)
  @RequireWorkspacePermission("workspace:member:manage")
  async revokeInvitation(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { workspaceId, invitationId } = parse(invitationParamSchema, params);
    const key = requireIdempotencyKey(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "workspace.invitation.revoke",
      key,
      request: { workspaceId, invitationId },
      successStatus: 204,
      run: async (recordOutcome) => {
        await this.invitations.revokeInvitation(workspaceId, invitationId, recordOutcome);
      },
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return undefined;
  }

  /**
   * `POST /invitations/accept` — chấp nhận lời mời. `200`.
   *
   * Không có `@RequireWorkspacePermission`: actor chưa là member của workspace
   * nào — đó chính là điều họ đang xin đổi. Thứ authorize họ là **token trong
   * hộp thư**, và `SessionGuard` bảo đảm họ đã đăng nhập để so email.
   *
   * Không `Idempotency-Key`: token tự nó đã là khoá một lần dùng. Câu `UPDATE`
   * có điều kiện trong `WHERE` nên gửi lại cùng token lần hai nhận `400` — đó
   * là hành vi đúng, không phải chỗ cần idempotency layer thứ hai.
   */
  @Post("invitations/accept")
  @HttpCode(200)
  async acceptInvitation(@Req() request: FastifyRequest, @Body() body: unknown) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const input = parse(acceptInvitationRequestSchema, body);

    const workspace = await this.invitations.acceptInvitation(actor, input);
    return ok(request, { workspace: toJoinedWorkspaceProjection(workspace) });
  }

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
