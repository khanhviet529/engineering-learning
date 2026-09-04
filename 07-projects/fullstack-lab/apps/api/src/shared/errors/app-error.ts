import { ERROR_STATUS, type ErrorCode, type FieldError } from "@flowboard/contracts";

/**
 * Error mapper — `docs/engineering/backend-conventions.md`, mục "Contract,
 * validation và lỗi".
 *
 * Đây là **chỗ duy nhất** dựng error envelope. Controller và use case không tự
 * chế shape lỗi riêng: nếu chúng làm thế, danh mục error code sẽ trôi khỏi thực
 * tế mà không ai phát hiện, vì mỗi chỗ đều "đúng" theo cách của mình.
 */

export interface ErrorEnvelopeBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: FieldError[] | { currentVersion: number };
  };
  requestId: string;
}

export interface AppErrorOptions {
  message?: string;
  details?: FieldError[] | { currentVersion: number };
  /** Số giây cho header `Retry-After`. */
  retryAfterSeconds?: number;
  /** Nguyên nhân gốc — chỉ để ghi log, **không bao giờ** ra tới client. */
  cause?: unknown;
}

/**
 * Lỗi đã biết của ứng dụng.
 *
 * `cause` cố ý tách khỏi `message`: nguyên nhân gốc thường chứa chi tiết nội bộ
 * hữu ích cho log và nguy hiểm cho response.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: FieldError[] | { currentVersion: number } | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Thông điệp mặc định, an toàn cho người dùng.
 *
 * Chúng cố ý **không** phân biệt "email không tồn tại" với "mật khẩu sai", và
 * không nói resource nào bị từ chối: cả hai đều là tín hiệu enumeration.
 */
const DEFAULT_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "Dữ liệu gửi lên không hợp lệ.",
  UNAUTHENTICATED: "Bạn cần đăng nhập để tiếp tục.",
  EMAIL_VERIFICATION_REQUIRED: "Email của bạn chưa được xác minh.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  NOT_FOUND: "Không tìm thấy nội dung bạn yêu cầu.",
  TASK_VERSION_CONFLICT: "Công việc đã được người khác thay đổi.",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key đã được dùng cho một request khác.",
  IDEMPOTENCY_IN_PROGRESS: "Một request cùng key đang được xử lý.",
  COLUMN_NOT_EMPTY: "Cột vẫn còn công việc.",
  RATE_LIMITED: "Bạn đã thao tác quá nhanh. Vui lòng thử lại sau.",
  INTERNAL_ERROR: "Đã có lỗi xảy ra. Vui lòng thử lại.",
  REPORT_NOT_READY: "Báo cáo chưa sẵn sàng.",
  REPORT_EXPIRED: "Liên kết tải báo cáo đã hết hạn.",
  TIME_TRACKING_DISABLED: "Dự án này chưa bật chấm công.",
  WORK_LOG_BACKFILL_CLOSED: "Đã quá hạn ghi bù cho ngày này.",
  WORK_LOG_DAILY_LIMIT_EXCEEDED: "Tổng giờ trong ngày vượt giới hạn cho phép.",
  WORK_LOG_TASK_SUPPORT_REASON_REQUIRED: "Cần nêu lý do hỗ trợ cho công việc này.",
  WORK_LOG_SELF_REVIEW_FORBIDDEN: "Bạn không thể tự duyệt bản ghi của mình.",
  WORK_LOG_VERSION_CONFLICT: "Bản ghi giờ đã được thay đổi.",
  SPRINT_DISABLED: "Dự án này chưa bật Sprint.",
  SPRINT_ALREADY_ACTIVE: "Đã có một sprint đang hoạt động.",
  SPRINT_CLOSED: "Sprint đã đóng.",
  SPRINT_VERSION_CONFLICT: "Sprint đã được thay đổi.",
  TASK_DEPENDENCY_CYCLE: "Phụ thuộc này sẽ tạo thành vòng lặp.",
};

export interface MappedError {
  status: number;
  headers: Record<string, string>;
  body: ErrorEnvelopeBody;
  /** Chi tiết chỉ dành cho log; không bao giờ nằm trong `body`. */
  logDetail: { code: ErrorCode; cause?: unknown };
}

/**
 * Chuyển một lỗi bất kỳ thành envelope chuẩn.
 *
 * Lỗi **không** phải `AppError` được coi là lỗi không mong đợi: client nhận
 * `INTERNAL_ERROR` với thông điệp an toàn, còn nguyên nhân gốc chỉ đi vào log.
 * Không stack trace, không SQL, không token, không tên resource bị từ chối.
 */
export function mapError(error: unknown, requestId: string): MappedError {
  const appError =
    error instanceof AppError ? error : new AppError("INTERNAL_ERROR", { cause: error });

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  };

  // Hợp đồng: mọi `429` phải có `Retry-After`. `409 IDEMPOTENCY_IN_PROGRESS`
  // có thể có, như một gợi ý khoảng chờ ngắn.
  if (appError.retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(appError.retryAfterSeconds);
  } else if (appError.code === "RATE_LIMITED") {
    headers["retry-after"] = "60";
  }

  return {
    status: appError.status,
    headers,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details === undefined ? {} : { details: appError.details }),
      },
      requestId,
    },
    logDetail: {
      code: appError.code,
      ...(appError.cause === undefined ? {} : { cause: appError.cause }),
    },
  };
}

/** Dựng `VALIDATION_FAILED` từ danh sách field error đã kiểm. */
export function validationError(details: FieldError[]): AppError {
  return new AppError("VALIDATION_FAILED", { details });
}
