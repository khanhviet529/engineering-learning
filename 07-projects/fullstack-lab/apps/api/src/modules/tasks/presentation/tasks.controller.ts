import type { KeyRing } from "../../../shared/security/key-ring.ts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createCommentRequestSchema,
  createTaskRequestSchema,
  listTasksQuerySchema,
  listWorkspaceTasksQuerySchema,
  moveTaskRequestSchema,
  overviewQuerySchema,
  paginationQuerySchema,
  updateTaskRequestSchema,
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
import { getRequestId, ok, okList } from "../../../shared/http/envelope.ts";
import { parse } from "../../../shared/http/validation.ts";
import { requireCsrf } from "../../../shared/http/csrf.ts";
import {
  applyReplay,
  requireIdempotencyKey,
  runIdempotent,
} from "../../../shared/http/idempotency-runner.ts";
import type { Database } from "../../../shared/database/client.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import { formatPosition } from "../../../shared/ordering/position.ts";
import type { TaskUseCases, TaskView } from "../application/task-use-cases.ts";
import type { OverviewUseCases, OverviewView } from "../application/overview-use-cases.ts";
import type {
  ActivityView,
  CommentUseCases,
  CommentView,
} from "../application/comment-use-cases.ts";

/**
 * Controller của module `tasks` — bảy route của M4.
 *
 * Nó biết HTTP và không biết Drizzle. Chuỗi guard khai tường minh trên từng
 * route: một route quên guard phải **nhìn thấy được** khi đọc file này.
 */

export const TASK_TOKENS = {
  tasks: Symbol("TaskUseCases"),
  overview: Symbol("OverviewUseCases"),
  comments: Symbol("CommentUseCases"),
  config: Symbol("TaskConfig"),
  db: Symbol("TaskDatabase"),
} as const;

export interface TaskHttpConfig {
  csrfSecret: KeyRing;
}

const projectIdParamSchema = z.object({ projectId: z.uuid() }).strict();
const taskIdParamSchema = z.object({ taskId: z.uuid() }).strict();
const workspaceIdParamSchema = z.object({ workspaceId: z.uuid() }).strict();

/**
 * Projection task: đúng những field mà `taskSchema` công bố.
 *
 * `position` là **string** — `numeric(20,10)` giữ nguyên precision qua JSON chỉ
 * khi nó không đi qua một JSON number — và nó tới đây từ database mà không qua
 * `number` ở bất kỳ bước nào (xem `shared/ordering/position.ts`).
 *
 * `dueState` **do server suy**, không có cột nào lưu và client không bao giờ
 * gửi nó.
 */
function toTaskProjection(task: TaskView) {
  return {
    id: task.id,
    projectId: task.projectId,
    columnId: task.columnId,
    createdBy: { id: task.createdByUserId, displayName: task.createdByDisplayName },
    assigneeId: task.assigneeId,
    reviewerId: task.reviewerId,
    title: task.title,
    description: task.description,
    /**
     * `category` có thể là `null` — cột trong database nullable và hợp đồng
     * create/update nhận `null` để xoá phân loại.
     *
     * **Lệch hợp đồng đã biết:** `taskSchema.category` trong
     * `packages/contracts` khai non-nullable, nên một task không có phân loại
     * không parse được bằng chính schema đó. Đây là lỗi của hợp đồng chứ không
     * phải của dữ liệu (`database-design.md` ghi `category` Null=Yes,
     * "Optional fixed category"), và `packages/contracts` không thuộc lane này
     * nên nó được **báo cáo**, không tự sửa. Server trả sự thật.
     */
    category: task.category,
    priority: task.priority,
    startDate: task.startDate,
    dueDate: task.dueDate,
    dueState: task.dueState,
    evidenceUrl: task.evidenceUrl,
    sprintId: null,
    position: formatPosition(task.position),
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * Projection overview — đúng những field mà `projectOverviewSchema` công bố.
 *
 * **Không có phần trăm ở đâu cả.** `58%` suy được từ `taskCount / totals.tasks`;
 * trả cả hai là hai nguồn cho cùng một sự thật, và chúng lệch ở lần làm tròn
 * đầu tiên.
 */
function toOverviewProjection(overview: OverviewView) {
  return {
    window: overview.window,
    totals: overview.totals,
    byColumn: overview.byColumn.map((column) => ({
      columnId: column.columnId,
      name: column.name,
      isTerminal: column.isTerminal,
      taskCount: column.taskCount,
    })),
    byAssignee: overview.byAssignee.map((row) => ({
      user: { id: row.userId, displayName: row.displayName },
      taskCount: row.taskCount,
    })),
    unassignedCount: overview.unassignedCount,
    dueStates: overview.dueStates,
  };
}

function toCommentProjection(comment: CommentView) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    author: { id: comment.authorId, displayName: comment.authorDisplayName },
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

/**
 * Projection activity: `summary` do server dựng, **không có `payload`**.
 *
 * Đây là chỗ mà luật "raw payload không bao giờ đến client" trở thành code. Một
 * `...row` ở đây sẽ phá nó im lặng.
 */
function toActivityProjection(activity: ActivityView) {
  return {
    id: activity.id,
    taskId: activity.taskId,
    actor: { id: activity.actorId, displayName: activity.actorDisplayName },
    action: activity.action,
    summary: activity.summary,
    createdAt: activity.createdAt.toISOString(),
  };
}

@Controller()
@UseGuards(SessionGuard, WorkspacePermissionGuard, ProjectPermissionGuard)
export class TasksController {
  constructor(
    @Inject(TASK_TOKENS.tasks) private readonly tasks: TaskUseCases,
    @Inject(TASK_TOKENS.overview) private readonly overview: OverviewUseCases,
    @Inject(TASK_TOKENS.comments) private readonly comments: CommentUseCases,
    @Inject(TASK_TOKENS.config) private readonly config: TaskHttpConfig,
    @Inject(TASK_TOKENS.db) private readonly db: Database,
  ) {}

  /**
   * `GET /projects/:projectId/tasks` — `200`.
   *
   * Không CSRF và không `Idempotency-Key`: đây là một lượt đọc, và không có
   * side effect nào, kể cả activity.
   */
  @Get("projects/:projectId/tasks")
  @RequireProjectPermission("task:read")
  async listTasks(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);
    // Schema `.strict()` cộng `refine`: field lạ, sort ngoài allowlist, và
    // `sort=position:*` mà không có `columnId` đều là `400` tại đây.
    const listQuery = parse(listTasksQuerySchema, query ?? {});

    const result = await this.tasks.listTasks(actor, projectId, listQuery);

    return okList(request, result.items.map(toTaskProjection), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  /**
   * `GET /workspaces/:workspaceId/tasks` — `200`, task cấp workspace cho `MYT-01`.
   *
   * Permission là `workspace:read` — cả hai vai trò workspace đều mở được màn
   * hình này. Thứ **giới hạn kết quả** không phải một phép kiểm quyền ở đây mà
   * là membership từng project, do repository áp trong chính câu SQL: một
   * Workspace Admin chưa được thêm vào project nào nhận trang rỗng, không phải
   * task của người khác.
   *
   * Không CSRF và không `Idempotency-Key`: đây là một lượt đọc.
   */
  @Get("workspaces/:workspaceId/tasks")
  @RequireWorkspacePermission("workspace:read")
  async listWorkspaceTasks(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const actor = getActor(request);
    const { workspaceId } = parse(workspaceIdParamSchema, params);
    // Cùng allowlist với list cấp project **trừ `columnId`**; `sort=position:*`
    // bị từ chối vì position chỉ có nghĩa trong một column.
    const listQuery = parse(listWorkspaceTasksQuerySchema, query ?? {});

    const result = await this.tasks.listWorkspaceTasks(actor, workspaceId, listQuery);

    /**
     * Envelope có **ba** khoá, không phải hai.
     *
     * `okList` dựng `{ items, page }`; ở đây còn một bảng tra cứu `projects`,
     * nên response được dựng tường minh bằng `ok`. Nhét `projects` vào từng item
     * sẽ là hai mươi bản sao của cùng một tên — thứ sẽ lệch nếu project được đổi
     * tên giữa chừng.
     */
    return ok(request, {
      items: result.items.map(toTaskProjection),
      projects: result.projects,
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
  }

  /**
   * `GET /projects/:projectId/overview` — `200`, aggregate cho `PRJ-04`.
   *
   * `task:read`, cùng quyền với việc đọc task — vì đây chính là những task đó đã
   * được đếm. Viewer mở được, và chỉ đọc như mọi thứ khác.
   */
  @Get("projects/:projectId/overview")
  @RequireProjectPermission("task:read")
  async getOverview(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const { projectId } = parse(projectIdParamSchema, params);
    // `.strict()`: chỉ `from` và `to`. Không `groupBy`, không `metrics`, không
    // một field nào cho client tự chọn cách tổng hợp.
    const overviewQuery = parse(overviewQuerySchema, query ?? {});

    const overview = await this.overview.getOverview(projectId, overviewQuery);

    return ok(request, toOverviewProjection(overview));
  }

  /** `POST /projects/:projectId/tasks` — `201`. */
  @Post("projects/:projectId/tasks")
  @HttpCode(201)
  @RequireProjectPermission("task:create")
  async createTask(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { projectId } = parse(projectIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    // `.strict()`: `projectId`, `position`, `version`, `dueState`, `createdBy`
    // và mọi timestamp trong body đều là `400`, không phải bị bỏ qua im lặng.
    const input = parse(createTaskRequestSchema, body);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "task.create",
      key,
      request: { projectId, ...input },
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.tasks.createTask(actor, projectId, input, recordOutcome, (task) => ({
          task: toTaskProjection(task),
          capabilities: capabilitiesOf(request),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, {
      task: toTaskProjection(result.value as TaskView),
      capabilities: capabilitiesOf(request),
    });
  }

  /**
   * `GET /tasks/:taskId` — `200`, kèm trang comment đầu tiên.
   *
   * Yêu cầu **cả** `task:read` lẫn `comment:read`. Guard chỉ khai được một
   * permission mỗi route, nên `task:read` là permission của route và
   * `comment:read` được kiểm ngay dưới đây — hai vai trò MVP nào đọc được task
   * thì cũng đọc được comment, nhưng phép kiểm vẫn tường minh vì catalog là hai
   * entry riêng và một ngày nào đó chúng có thể tách ra.
   */
  @Get("tasks/:taskId")
  @RequireProjectPermission("task:read")
  async getTask(@Req() request: FastifyRequest, @Param() params: unknown, @Query() query: unknown) {
    const { taskId } = parse(taskIdParamSchema, params);
    const page = parse(paginationQuerySchema, query ?? {});
    const projectId = requireResolvedProjectId(request);

    requireCapability(request, "comment:read");

    const task = await this.tasks.getTask(projectId, taskId);
    const comments = await this.comments.listComments(projectId, taskId, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });

    return ok(request, {
      task: toTaskProjection(task),
      comments: {
        items: comments.items.map(toCommentProjection),
        page: { nextCursor: comments.nextCursor, hasMore: comments.hasMore },
      },
      capabilities: capabilitiesOf(request),
    });
  }

  /**
   * `PATCH /tasks/:taskId` — `200`.
   *
   * Đổi `assigneeId` cần thêm `task:assign`. Guard khai `task:update` cho route;
   * phép kiểm thứ hai nằm ở đây vì nó **phụ thuộc nội dung body**, thứ mà guard
   * chạy trước Zod không nhìn thấy được.
   */
  @Patch("tasks/:taskId")
  @RequireProjectPermission("task:update")
  async updateTask(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { taskId } = parse(taskIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(updateTaskRequestSchema, body);
    const projectId = requireResolvedProjectId(request);

    if ("assigneeId" in input) requireCapability(request, "task:assign");

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "task.update",
      key,
      request: { taskId, ...input },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.tasks.updateTask(actor, projectId, taskId, input, recordOutcome, (task) => ({
          task: toTaskProjection(task),
          capabilities: capabilitiesOf(request),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, {
      task: toTaskProjection(result.value as TaskView),
      capabilities: capabilitiesOf(request),
    });
  }

  /**
   * `POST /tasks/:taskId/move` — **`200`**, không phải `201`.
   *
   * Nest mặc định POST là `201`, và `@HttpCode(200)` vắng mặt trông y hệt
   * `@HttpCode(200)` đúng. Move không tạo resource mới nên `201` sẽ là lời khai
   * sai với mọi client đọc status.
   */
  @Post("tasks/:taskId/move")
  @HttpCode(200)
  @RequireProjectPermission("task:move")
  async moveTask(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { taskId } = parse(taskIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(moveTaskRequestSchema, body);
    const projectId = requireResolvedProjectId(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "task.move",
      key,
      request: { taskId, ...input },
      successStatus: 200,
      run: async (recordOutcome) =>
        await this.tasks.moveTask(actor, projectId, taskId, input, recordOutcome, (task) => ({
          task: toTaskProjection(task),
          capabilities: capabilitiesOf(request),
        })),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, {
      task: toTaskProjection(result.value as TaskView),
      capabilities: capabilitiesOf(request),
    });
  }

  /** `POST /tasks/:taskId/comments` — `201`, append bất biến. */
  @Post("tasks/:taskId/comments")
  @HttpCode(201)
  @RequireProjectPermission("comment:create")
  async createComment(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    requireCsrf(request, this.config.csrfSecret);
    const actor = getActor(request);
    const { taskId } = parse(taskIdParamSchema, params);
    const key = requireIdempotencyKey(request);
    const input = parse(createCommentRequestSchema, body);
    const projectId = requireResolvedProjectId(request);

    const result = await runIdempotent({
      db: this.db,
      actorId: actor.id,
      useCase: "comment.create",
      key,
      request: { taskId, ...input },
      successStatus: 201,
      run: async (recordOutcome) =>
        await this.comments.createComment(
          actor,
          projectId,
          taskId,
          input,
          recordOutcome,
          (comment) => ({ comment: toCommentProjection(comment) }),
        ),
    });

    if (result.replayed !== undefined) {
      return applyReplay(reply, getRequestId(request), result.replayed);
    }
    return ok(request, { comment: toCommentProjection(result.value as CommentView) });
  }

  /** `GET /tasks/:taskId/activity` — `200`, mới nhất trước. */
  @Get("tasks/:taskId/activity")
  @RequireProjectPermission("activity:read")
  async listActivity(
    @Req() request: FastifyRequest,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const { taskId } = parse(taskIdParamSchema, params);
    const page = parse(paginationQuerySchema, query ?? {});
    const projectId = requireResolvedProjectId(request);

    const result = await this.comments.listTaskActivity(projectId, taskId, {
      limit: page.limit,
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    });

    return okList(request, result.items.map(toActivityProjection), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }
}

/* -------------------------------------------------------------------------- *
 * Đọc lại kết quả của chuỗi guard
 * -------------------------------------------------------------------------- */

interface WithAuthorization {
  projectAuthorization?: { projectId: string; role: string; capabilities: string[] };
}

/**
 * Project mà guard vừa authorize.
 *
 * Vắng mặt nghĩa là route quên `@RequireProjectPermission` — một lỗi lập trình,
 * không phải một nhánh người dùng gặp. Ném lỗi nội bộ chứ **không** rơi về một
 * ID do client gửi: rơi về đó là bỏ qua đúng lớp vừa kiểm quyền.
 */
function requireResolvedProjectId(request: FastifyRequest): string {
  const authorization = (request as FastifyRequest & WithAuthorization).projectAuthorization;
  if (authorization === undefined) {
    throw new Error("Route thiếu @RequireProjectPermission: không có project đã authorize.");
  }
  return authorization.projectId;
}

/** Capability của actor trong project này — affordance cho UI, do server tính. */
function capabilitiesOf(request: FastifyRequest): string[] {
  const authorization = (request as FastifyRequest & WithAuthorization).projectAuthorization;
  if (authorization === undefined) {
    throw new Error("Route thiếu @RequireProjectPermission: không có capability đã tính.");
  }
  return authorization.capabilities;
}

/**
 * Phép kiểm permission **thứ hai** trên một route.
 *
 * Decorator chỉ khai được một permission, nhưng hai route của M4 cần hai:
 * `GET /tasks/:taskId` cần `task:read` **và** `comment:read`; `PATCH` cần
 * `task:update` **và**, khi body đổi assignee, `task:assign`. Trường hợp thứ
 * hai còn phụ thuộc body — thứ guard chạy trước Zod không nhìn thấy được.
 *
 * `403` chứ không `404`: actor **đã** nhìn thấy được project (guard đầu đã cho
 * qua), nên câu trả lời đúng là "bạn thấy nhưng thiếu action".
 */
function requireCapability(request: FastifyRequest, permission: string): void {
  if (!capabilitiesOf(request).includes(permission)) throw new AppError("FORBIDDEN");
}
