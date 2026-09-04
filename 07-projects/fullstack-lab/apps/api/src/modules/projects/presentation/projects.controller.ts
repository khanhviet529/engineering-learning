import {
  Body,
  Controller,
  Delete,
  Get,
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
  addProjectMemberRequestSchema,
  changeProjectMemberRoleRequestSchema,
  createProjectRequestSchema,
  renameProjectRequestSchema,
} from "@flowboard/contracts";
import { z } from "zod";
import {
  ProjectPermissionGuard,
  RequireProjectPermission,
  RequireWorkspacePermission,
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
import type { Database } from "../../../shared/database/client.ts";
import type {
  ProjectMemberView,
  ProjectUseCases,
  ProjectView,
} from "../application/project-use-cases.ts";

/**
 * Controller của module `projects`.
 *
 * Chuỗi guard khai tường minh trên từng route. Route nào chạm project mang
 * `@RequireProjectPermission`, và `ProjectPermissionGuard` là chỗ quyết định
 * `404` hay `403` — controller không tự viết nhánh đó, vì viết ở nhiều chỗ là
 * cách một chỗ trả `403` nhầm cho người ngoài.
 */

export const PROJECT_TOKENS = {
  useCases: Symbol("ProjectUseCases"),
  config: Symbol("ProjectConfig"),
  db: Symbol("ProjectDatabase"),
} as const;

export interface ProjectHttpConfig {
  csrfSecret: string;
}

const workspaceIdParamSchema = z.object({ workspaceId: z.uuid() }).strict();
const projectIdParamSchema = z.object({ projectId: z.uuid() }).strict();
const projectMemberParamSchema = z.object({ projectId: z.uuid(), userId: z.uuid() }).strict();

function toProjectProjection(project: ProjectView) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toMemberProjection(member: ProjectMemberView) {
  return {
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
    role: member.role,
  };
}

@Controller()
@UseGuards(SessionGuard, WorkspacePermissionGuard, ProjectPermissionGuard)
export class ProjectsController {
  constructor(
    @Inject(PROJECT_TOKENS.useCases) private readonly useCases: ProjectUseCases,
    @Inject(PROJECT_TOKENS.config) private readonly config: ProjectHttpConfig,
    @Inject(PROJECT_TOKENS.db) private readonly db: Database,
  ) {}

  /**
   * `POST /workspaces/:workspaceId/projects` — `201`.
   *
   * Route nằm dưới workspace nhưng resource được tạo là một Project, nên use
   * case thuộc module `projects`. Permission là `project:create` ở **cấp
   * workspace** (Workspace Admin), không phải một permission project — người
   * tạo chưa có project nào để có vai trò trong đó.
   */
  @Post("workspaces/:workspaceId/projects")
  @HttpCode(201)
  @RequireWorkspacePermission("project:create")
  async createProject(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { workspaceId } = parse(workspaceIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(createProjectRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "project.create",
      key,
      request: { workspaceId, ...input },
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.useCases.createProject(actor, workspaceId, input, recordOutcome, (detail) => ({
          project: toProjectProjection(detail.project),
          capabilities: detail.capabilities,
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }

    const created = result.value as { project: ProjectView; capabilities: string[] };
    return ok(request, {
      project: toProjectProjection(created.project),
      capabilities: created.capabilities,
    });
  }

  /**
   * `GET /projects/:projectId`.
   *
   * `columns` là mảng rỗng ở M2 — bảng `board_columns` thuộc M3. Field vẫn có
   * mặt vì `projectDetailSchema` của contract công bố nó; bỏ field là thay đổi
   * hợp đồng, còn mảng rỗng là sự thật của mốc này.
   */
  @Get("projects/:projectId")
  @RequireProjectPermission("project:read")
  async getProject(@Req() request: FastifyRequest, @Param() params: unknown) {
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);

    const detail = await this.useCases.getProjectDetail(actor, projectId);

    return ok(request, {
      project: toProjectProjection(detail.project),
      capabilities: detail.capabilities,
      columns: [],
      members: detail.members.map(toMemberProjection),
    });
  }

  /** `PATCH /projects/:projectId` — `200`, chỉ đổi `name`. */
  @Patch("projects/:projectId")
  @RequireProjectPermission("project:update")
  async renameProject(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    // Schema là `.strict()`: `description`, `visibility`, `workspaceId` hay bất
    // kỳ field nào ngoài `name` đều là `400`, không phải bị bỏ qua im lặng.
    const input = parse(renameProjectRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "project.rename",
      key,
      request: { projectId, ...input },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.useCases.renameProject(projectId, input, recordOutcome, (detail) => ({
          project: toProjectProjection(detail.project),
          capabilities: detail.capabilities,
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }

    const updated = result.value as { project: ProjectView; capabilities: string[] };
    return ok(request, {
      project: toProjectProjection(updated.project),
      capabilities: updated.capabilities,
    });
  }

  /** `POST /projects/:projectId/members` — `201`. */
  @Post("projects/:projectId/members")
  @HttpCode(201)
  @RequireProjectPermission("project:member:manage")
  async addMember(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(addProjectMemberRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "project.member.add",
      key,
      request: { projectId, ...input },
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.useCases.addProjectMember(projectId, input, recordOutcome, (member) => ({
          member: toMemberProjection(member),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { member: toMemberProjection(result.value as ProjectMemberView) });
  }

  /** `PATCH /projects/:projectId/members/:userId` — `200`. */
  @Patch("projects/:projectId/members/:userId")
  @RequireProjectPermission("project:member:manage")
  async changeMemberRole(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId, userId } = parse(projectMemberParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(changeProjectMemberRoleRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "project.member.role-change",
      key,
      request: { projectId, userId, ...input },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.useCases.changeProjectMemberRole(
          projectId,
          userId,
          input,
          recordOutcome,
          (member) => ({ member: toMemberProjection(member) }),
        ),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { member: toMemberProjection(result.value as ProjectMemberView) });
  }

  /** `DELETE /projects/:projectId/members/:userId` — `204`, không body. */
  @Delete("projects/:projectId/members/:userId")
  @HttpCode(204)
  @RequireProjectPermission("project:member:manage")
  async removeMember(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId, userId } = parse(projectMemberParamSchema, params);
    const key = requireIdempotencyKey(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "project.member.remove",
      key,
      request: { projectId, userId },
      successStatus: 204,
      run: async (recordOutcome) => {
        await this.useCases.removeProjectMember(projectId, userId, recordOutcome);
      },
    });

    // Một lần gọi trước bị bất biến chặn đã lưu `400`; phát lại nó dưới `204`
    // sẽ báo thành công cho một thao tác chưa từng xảy ra.
    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return undefined;
  }
}
