import {
  signInRequestSchema,
  signUpRequestSchema,
  verifyEmailRequestSchema,
  resendVerificationRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  createTaskRequestSchema,
  moveTaskRequestSchema,
  updateTaskRequestSchema,
  createCommentRequestSchema,
  createColumnRequestSchema,
  updateColumnRequestSchema,
  reorderColumnsRequestSchema,
  type ErrorCode,
} from "@flowboard/contracts";
import type { ZodType } from "zod";
import {
  actors,
  capabilitiesByRole,
  columns,
  comments,
  ids,
  members,
  projectB,
  tasks,
  workspace,
  activities,
} from "./fixtures.js";
import { err, noContent, ok, okList, type MockResponse } from "./responses.js";

/**
 * Handler của mock.
 *
 * Mỗi handler nhận một request đã parse và trả một `MockResponse`. Chúng
 * **không** tái hiện business logic: không kiểm quyền thật, không giữ trạng
 * thái giữa các request, không cưỡng chế concurrency. Đó là việc của backend
 * thật, và một mock giả vờ làm được sẽ khiến người ta tin nhầm.
 *
 * Điều mock **phải** làm đúng là hình dạng: mọi response parse được bằng chính
 * schema trong `@flowboard/contracts`, gồm cả nhánh lỗi.
 */

export type Scenario =
  | "success"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "validation-failed"
  | "version-conflict"
  | "idempotency-reused"
  | "idempotency-in-progress"
  | "column-not-empty"
  | "project-last-owner"
  | "member-has-assigned-tasks"
  | "workspace-member-in-projects"
  | "rate-limited"
  | "email-verification-required"
  | "internal-error";

/** Ánh xạ kịch bản lỗi sang error code, để handler không tự chế code rời rạc. */
const SCENARIO_CODE: Readonly<Record<Exclude<Scenario, "success">, ErrorCode>> = {
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  "not-found": "NOT_FOUND",
  "validation-failed": "VALIDATION_FAILED",
  "version-conflict": "TASK_VERSION_CONFLICT",
  "idempotency-reused": "IDEMPOTENCY_KEY_REUSED",
  "idempotency-in-progress": "IDEMPOTENCY_IN_PROGRESS",
  "column-not-empty": "COLUMN_NOT_EMPTY",
  // Ba xung đột trạng thái của membership. Chúng **không** phải optimistic
  // concurrency: tải lại rồi gửi lại không giải quyết gì, người dùng phải đổi
  // thứ tự thao tác. Vì vậy chúng có kịch bản riêng chứ không dùng chung
  // `version-conflict`.
  "project-last-owner": "PROJECT_LAST_OWNER",
  "member-has-assigned-tasks": "MEMBER_HAS_ASSIGNED_TASKS",
  "workspace-member-in-projects": "WORKSPACE_MEMBER_IN_PROJECTS",
  "rate-limited": "RATE_LIMITED",
  "email-verification-required": "EMAIL_VERIFICATION_REQUIRED",
  "internal-error": "INTERNAL_ERROR",
};

/**
 * Dựng response lỗi cho một kịch bản, kèm đúng `details` mà code đó công bố.
 *
 * Đây là chỗ duy nhất frontend cần để dựng và thử mọi trạng thái lỗi đã thiết
 * kế, nên nó phải phủ đủ chứ không chỉ vài code thông dụng.
 */
export function errorFor(scenario: Exclude<Scenario, "success">): MockResponse<unknown> {
  const code = SCENARIO_CODE[scenario];
  switch (code) {
    case "VALIDATION_FAILED":
      return err(code, {
        details: [
          { field: "title", code: "required", message: "title is required." },
          { field: "dueDate", code: "invalid_format", message: "dueDate must be YYYY-MM-DD." },
        ],
      });
    case "TASK_VERSION_CONFLICT":
      return err(code, { details: { currentVersion: 7 } });
    case "RATE_LIMITED":
      return err(code, { retryAfter: 30 });
    case "IDEMPOTENCY_IN_PROGRESS":
      return err(code, { retryAfter: 2 });
    default:
      return err(code);
  }
}

/** Parse body theo schema contract; body sai trả đúng `400` field-error array. */
function parse<T>(
  schema: ZodType<T>,
  body: unknown,
): { ok: true; value: T } | { ok: false; response: MockResponse<unknown> } {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    response: err("VALIDATION_FAILED", {
      details: result.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        code: issue.code,
        message: issue.message,
      })),
    }),
  };
}

/** Vai trò mà mock đóng cho request hiện tại, quyết định capabilities trả về. */
export type MockRole = "owner" | "editor" | "viewer";

export interface HandlerContext {
  role?: MockRole;
  scenario?: Scenario;
}

function guard(ctx: HandlerContext): MockResponse<unknown> | null {
  if (ctx.scenario && ctx.scenario !== "success") return errorFor(ctx.scenario);
  return null;
}

// ------------------------------------------------------------------ auth

export const authHandlers = {
  signUp(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(signUpRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok(
      {
        account: {
          email: parsed.value.email,
          displayName: parsed.value.displayName,
          emailVerified: false as const,
        },
        verificationEmailSent: true,
      },
      201,
    );
  },

  verifyEmail(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(verifyEmailRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ emailVerified: true as const });
  },

  /** Luôn trả cùng một body dù account có tồn tại hay không — chống enumeration. */
  resendVerification(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(resendVerificationRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ accepted: true as const }, 202);
  },

  signIn(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(signInRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ actor: actors.ownerB, csrfToken: "mock-csrf-token" });
  },

  session(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return ok({ actor: actors.ownerB, csrfToken: "mock-csrf-token" });
  },

  signOut(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return noContent();
  },

  forgotPassword(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(forgotPasswordRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ accepted: true as const }, 202);
  },

  resetPassword(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(resetPasswordRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ passwordReset: true as const, signInRequired: true as const });
  },
};

// ------------------------------------------------------ workspace, project

export const workspaceHandlers = {
  list(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return okList([workspace]);
  },
};

export const projectHandlers = {
  /**
   * `GET /workspaces/:workspaceId/projects`.
   *
   * Chỉ trả project mà actor có `project_members` row. Fixture chuẩn cho actor
   * mặc định (`ownerB`) đúng một project — Project B — nên một Workspace Admin
   * chưa được thêm vào đâu sẽ nhận trang rỗng, chứ không phải danh sách project
   * của người khác. Không có count thành viên hay count task: không projection
   * nào công bố chúng.
   */
  listInWorkspace(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return okList([
      {
        id: projectB.id,
        workspaceId: projectB.workspaceId,
        name: projectB.name,
        role: ctx.role ?? "owner",
        createdAt: projectB.createdAt,
        updatedAt: projectB.updatedAt,
      },
    ]);
  },

  detail(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return ok({
      project: projectB,
      capabilities: capabilitiesByRole[ctx.role ?? "owner"],
      columns,
      members,
    });
  },

  rename(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return ok({ project: projectB, capabilities: capabilitiesByRole[ctx.role ?? "owner"] });
  },
};

// ---------------------------------------------------------- board columns

export const columnHandlers = {
  create(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(createColumnRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok(
      {
        column: {
          id: ids.columnReview,
          projectId: ids.projectB,
          name: parsed.value.name,
          requiresReviewer: parsed.value.requiresReviewer,
          isTerminal: parsed.value.isTerminal,
          position: "5120.0000000000",
          archivedAt: null,
        },
      },
      201,
    );
  },

  update(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(updateColumnRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ column: columns[0] });
  },

  reorder(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(reorderColumnsRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ columns });
  },
};

// ------------------------------------------------- tasks, comments, activity

export const taskHandlers = {
  list(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return okList(tasks, { nextCursor: "mock-cursor", hasMore: true });
  },

  detail(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return ok({
      task: tasks[0],
      comments: { items: comments, page: { nextCursor: null, hasMore: false } },
      capabilities: capabilitiesByRole[ctx.role ?? "owner"],
    });
  },

  create(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(createTaskRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ task: tasks[0], capabilities: capabilitiesByRole[ctx.role ?? "owner"] }, 201);
  },

  update(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(updateTaskRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ task: tasks[0], capabilities: capabilitiesByRole[ctx.role ?? "owner"] });
  },

  move(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(moveTaskRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ task: tasks[0], capabilities: capabilitiesByRole[ctx.role ?? "owner"] });
  },
};

export const commentHandlers = {
  create(body: unknown, ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    const parsed = parse(createCommentRequestSchema, body);
    if (!parsed.ok) return parsed.response;
    return ok({ comment: comments[0] }, 201);
  },
};

export const activityHandlers = {
  list(ctx: HandlerContext = {}): MockResponse<unknown> {
    const failed = guard(ctx);
    if (failed) return failed;
    return okList(activities);
  },
};
