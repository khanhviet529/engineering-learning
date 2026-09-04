import { ERROR_STATUS, type ErrorCode, type FieldError, type Page } from "@flowboard/contracts";

/**
 * Bộ dựng response của mock.
 *
 * Mọi thứ mock trả ra đều đi qua đây, nên chỉ có **một** chỗ biết hình dạng
 * envelope. Nếu hợp đồng đổi envelope, chỗ phải sửa là chỗ này, không phải ba
 * mươi handler.
 */

export interface MockResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body: TBody;
}

let counter = 0;

/**
 * `requestId` tất định theo thứ tự gọi, để test so sánh được mà không phải
 * stub đồng hồ hay bộ sinh ngẫu nhiên.
 */
export function nextRequestId(): string {
  counter += 1;
  return `mock-request-${String(counter).padStart(6, "0")}`;
}

export function resetRequestIds(): void {
  counter = 0;
}

/** Envelope thành công. `requestId` xuất hiện ở cả body lẫn header. */
export function ok<T>(data: T, status = 200): MockResponse<{ data: T; requestId: string }> {
  const requestId = nextRequestId();
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
    body: { data, requestId },
  };
}

/** `204 No Content`: không body, nhưng vẫn có `X-Request-Id`. */
export function noContent(): MockResponse<null> {
  const requestId = nextRequestId();
  return { status: 204, headers: { "x-request-id": requestId }, body: null };
}

/** Envelope list: `items` và `page` nằm **trong** `data`, không ở top-level. */
export function okList<T>(
  items: readonly T[],
  page: Page = { nextCursor: null, hasMore: false },
): MockResponse<{ data: { items: readonly T[]; page: Page }; requestId: string }> {
  return ok({ items, page });
}

interface ErrorOptions {
  message?: string;
  details?: FieldError[] | { currentVersion: number };
  /** Số giây; chỉ hợp lệ với `RATE_LIMITED` và `IDEMPOTENCY_IN_PROGRESS`. */
  retryAfter?: number;
}

const DEFAULT_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "Request validation failed.",
  UNAUTHENTICATED: "Authentication required.",
  EMAIL_VERIFICATION_REQUIRED: "Email verification required.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "Resource not found.",
  TASK_VERSION_CONFLICT: "The task was changed by someone else.",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key reused with a different request.",
  IDEMPOTENCY_IN_PROGRESS: "A request with this idempotency key is still running.",
  COLUMN_NOT_EMPTY: "The column still contains tasks.",
  PROJECT_LAST_OWNER: "A project must keep at least one owner.",
  MEMBER_HAS_ASSIGNED_TASKS: "This member still has tasks assigned to them.",
  WORKSPACE_MEMBER_IN_PROJECTS: "This member still belongs to projects in this workspace.",
  RATE_LIMITED: "Too many requests.",
  INTERNAL_ERROR: "Something went wrong.",
  REPORT_NOT_READY: "The report is not ready yet.",
  REPORT_EXPIRED: "The report download has expired.",
  TIME_TRACKING_DISABLED: "Time tracking is disabled for this project.",
  WORK_LOG_BACKFILL_CLOSED: "The backfill window is closed.",
  WORK_LOG_DAILY_LIMIT_EXCEEDED: "The daily limit would be exceeded.",
  WORK_LOG_TASK_SUPPORT_REASON_REQUIRED: "A support reason is required.",
  WORK_LOG_SELF_REVIEW_FORBIDDEN: "You cannot review your own work log.",
  WORK_LOG_VERSION_CONFLICT: "The work log was changed by someone else.",
  SPRINT_DISABLED: "Sprints are disabled for this project.",
  SPRINT_ALREADY_ACTIVE: "Another sprint is already active.",
  SPRINT_CLOSED: "The sprint is closed.",
  SPRINT_VERSION_CONFLICT: "The sprint was changed by someone else.",
  TASK_DEPENDENCY_DUPLICATE: "This dependency already exists.",
  TASK_DEPENDENCY_CYCLE: "This dependency would create a cycle.",
};

/**
 * Envelope lỗi.
 *
 * `details` chỉ được đặt cho hai code công bố nó; truyền `details` cho code
 * khác là lỗi lập trình của chính mock, nên hàm này ném ngay thay vì tạo ra
 * một response sai hợp đồng mà frontend lại tin.
 */
export function err(
  code: ErrorCode,
  options: ErrorOptions = {},
): MockResponse<{
  error: { code: ErrorCode; message: string; details?: FieldError[] | { currentVersion: number } };
  requestId: string;
}> {
  if (options.details !== undefined) {
    const isFieldErrors = Array.isArray(options.details);
    if (code === "VALIDATION_FAILED" && !isFieldErrors) {
      throw new Error("VALIDATION_FAILED yêu cầu details là field-error array.");
    }
    if (code === "TASK_VERSION_CONFLICT" && isFieldErrors) {
      throw new Error("TASK_VERSION_CONFLICT yêu cầu details là object currentVersion.");
    }
    if (code !== "VALIDATION_FAILED" && code !== "TASK_VERSION_CONFLICT") {
      throw new Error(`${code} không công bố details; không được gắn details cho nó.`);
    }
  }

  const requestId = nextRequestId();
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  };

  // Hợp đồng: mọi 429 phải có Retry-After; 409 IDEMPOTENCY_IN_PROGRESS có thể có.
  if (code === "RATE_LIMITED") {
    headers["retry-after"] = String(options.retryAfter ?? 60);
  } else if (code === "IDEMPOTENCY_IN_PROGRESS" && options.retryAfter !== undefined) {
    headers["retry-after"] = String(options.retryAfter);
  }

  return {
    status: ERROR_STATUS[code],
    headers,
    body: {
      error: {
        code,
        message: options.message ?? DEFAULT_MESSAGES[code],
        ...(options.details === undefined ? {} : { details: options.details }),
      },
      requestId,
    },
  };
}
