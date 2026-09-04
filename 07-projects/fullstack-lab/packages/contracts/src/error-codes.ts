import { z } from "zod";

/**
 * Danh mục error code — bản dịch máy đọc được của bảng trong
 * `docs/api/endpoint-contracts.md#danh-mục-error-code`.
 *
 * Danh mục này **đóng**: không code nào ngoài bảng được xuất hiện trong response,
 * và mọi code trong bảng phải có mặt ở đây. Test `error-codes.contract.test.ts`
 * đối chiếu hai chiều với tài liệu Markdown, nên lệch một code là fail build.
 *
 * Code của phase chưa mở vẫn nằm trong danh mục: kết quả của chúng được chốt từ
 * bây giờ để client không phải đoán khi phase đó bật.
 */
export const ERROR_CODES = [
  // Dùng chung cho mọi endpoint
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "EMAIL_VERIFICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "TASK_VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "COLUMN_NOT_EMPTY",
  "RATE_LIMITED",
  "INTERNAL_ERROR",

  // Phase 1.1 — export tiến độ
  "REPORT_NOT_READY",
  "REPORT_EXPIRED",

  // Phase 1.3 — Time Tracking
  "TIME_TRACKING_DISABLED",
  "WORK_LOG_BACKFILL_CLOSED",
  "WORK_LOG_DAILY_LIMIT_EXCEEDED",
  "WORK_LOG_TASK_SUPPORT_REASON_REQUIRED",
  "WORK_LOG_SELF_REVIEW_FORBIDDEN",
  "WORK_LOG_VERSION_CONFLICT",

  // Phase 1.4 — Sprint
  "SPRINT_DISABLED",
  "SPRINT_ALREADY_ACTIVE",
  "SPRINT_CLOSED",
  "SPRINT_VERSION_CONFLICT",

  // Phase 1.5 — quan hệ giữa Task
  "TASK_DEPENDENCY_CYCLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

/**
 * HTTP status đã công bố cho từng code.
 *
 * `INTERNAL_ERROR` ghi `500` vì đó là giá trị mặc định; hợp đồng cho phép mọi
 * `5xx` với cùng envelope, nên đây là status mà server phát ra khi không có lý
 * do cụ thể hơn.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  EMAIL_VERIFICATION_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TASK_VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  COLUMN_NOT_EMPTY: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,

  REPORT_NOT_READY: 409,
  REPORT_EXPIRED: 410,

  TIME_TRACKING_DISABLED: 403,
  WORK_LOG_BACKFILL_CLOSED: 400,
  WORK_LOG_DAILY_LIMIT_EXCEEDED: 400,
  WORK_LOG_TASK_SUPPORT_REASON_REQUIRED: 400,
  WORK_LOG_SELF_REVIEW_FORBIDDEN: 403,
  WORK_LOG_VERSION_CONFLICT: 409,

  SPRINT_DISABLED: 403,
  SPRINT_ALREADY_ACTIVE: 409,
  SPRINT_CLOSED: 409,
  SPRINT_VERSION_CONFLICT: 409,

  TASK_DEPENDENCY_CYCLE: 409,
} as const;

/**
 * Hai code duy nhất công bố `details`. Mọi code khác **không** có `details`, và
 * client không được ép chúng thành một trong hai shape đó.
 */
export const CODES_WITH_DETAILS = ["VALIDATION_FAILED", "TASK_VERSION_CONFLICT"] as const;

export type CodeWithDetails = (typeof CODES_WITH_DETAILS)[number];
