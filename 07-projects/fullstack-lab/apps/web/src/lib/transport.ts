import type { ErrorCode, FieldError } from "@flowboard/contracts";

/**
 * Tầng transport của `apps/web`.
 *
 * Nó sở hữu ba thứ mà mọi feature đều cần và không feature nào nên tự làm:
 * gắn cookie và CSRF token, chuẩn hoá lỗi về một hình dạng client đọc được, và
 * **vòng đời `Idempotency-Key`**.
 *
 * Vòng đời key là phần dễ sai nhất, và sai thì hậu quả là dữ liệu chứ không
 * phải giao diện — nên nó được đặc tả ở
 * [quy ước frontend](../../../../docs/engineering/frontend-conventions.md#vòng-đời-idempotency-key-phía-client)
 * và hiện thực ở đây, một chỗ duy nhất.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  code: ErrorCode;
  message: string;
  requestId: string;
  fieldErrors: FieldError[];
  currentVersion?: number;
  /** Số giây từ header `Retry-After`, khi có. */
  retryAfterSeconds?: number;
  status: number;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * Một **ý định của người dùng**: một lần bấm lưu, một cú thả, một lần gửi
 * comment.
 *
 * Key gắn với ý định, **không** gắn với một lần gọi HTTP. Đó là toàn bộ lý do
 * key tồn tại: gửi lại vì lỗi vận chuyển phải trả về đúng kết quả đã lưu, chứ
 * không tạo hiệu ứng thứ hai.
 */
export class Intent {
  #key: string;

  constructor() {
    this.#key = Intent.#newKey();
  }

  static #newKey(): string {
    return crypto.randomUUID();
  }

  get key(): string {
    return this.#key;
  }

  /**
   * Xoay key mới.
   *
   * Gọi khi: người dùng **sửa payload**; sau khi giải quyết `409` version
   * conflict và gửi lại với `expectedVersion` mới; người dùng huỷ rồi mở lại
   * form.
   *
   * **Không** gọi khi chỉ gửi lại vì network error, timeout hay `5xx` — giữ
   * nguyên key ở đó chính là mục đích của nó.
   */
  rotate(): void {
    this.#key = Intent.#newKey();
  }
}

export interface TransportConfig {
  baseUrl: string;
  /** CSRF token lấy từ `GET /auth/session` hoặc từ response sign-in. */
  csrfToken?: string | undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Bắt buộc với các mutation mà hợp đồng yêu cầu `Idempotency-Key`. */
  intent?: Intent;
  signal?: AbortSignal;
}

interface RawErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
}

/**
 * Chuẩn hoá lỗi về một hình dạng.
 *
 * Client rẽ nhánh theo `error.code`, **không** theo HTTP status và không theo
 * `typeof details` — đó là quy tắc trong API conventions, và nó tồn tại vì
 * status bị nhiều nguyên nhân khác nhau dùng chung.
 */
function toFailure(status: number, body: unknown, retryAfter: string | null): ApiFailure {
  const raw = (body ?? {}) as RawErrorBody;
  const details = raw.error?.details;

  const failure: ApiFailure = {
    ok: false,
    status,
    code: (raw.error?.code ?? "INTERNAL_ERROR") as ErrorCode,
    message: raw.error?.message ?? "Đã có lỗi xảy ra. Vui lòng thử lại.",
    requestId: raw.requestId ?? "unknown",
    // `details` chỉ được đọc khi code công bố nó; các code khác cho mảng rỗng
    // thay vì để chỗ gọi tự đoán.
    fieldErrors:
      raw.error?.code === "VALIDATION_FAILED" && Array.isArray(details)
        ? (details as FieldError[])
        : [],
  };

  if (
    raw.error?.code === "TASK_VERSION_CONFLICT" &&
    details !== null &&
    typeof details === "object"
  ) {
    const version = (details as { currentVersion?: unknown }).currentVersion;
    if (typeof version === "number") failure.currentVersion = version;
  }

  if (retryAfter !== null) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) failure.retryAfterSeconds = seconds;
  }

  return failure;
}

export class Transport {
  #config: TransportConfig;

  constructor(config: TransportConfig) {
    this.#config = config;
  }

  setCsrfToken(token: string | undefined): void {
    this.#config = { ...this.#config, csrfToken: token };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {};

    if (options.body !== undefined) headers["content-type"] = "application/json";

    // CSRF chỉ cần cho mutation; gửi kèm ở `GET` là thừa và làm lộ token ra
    // những nơi không cần biết nó.
    if (method !== "GET" && this.#config.csrfToken !== undefined) {
      headers["x-csrf-token"] = this.#config.csrfToken;
    }

    if (options.intent !== undefined) {
      headers["idempotency-key"] = options.intent.key;
    }

    let response: Response;
    try {
      response = await fetch(`${this.#config.baseUrl}${path}`, {
        method,
        headers,
        // Cookie session là `HttpOnly`, nên trình duyệt phải được yêu cầu gửi
        // nó một cách tường minh cho request cross-origin.
        credentials: "include",
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      // Lỗi vận chuyển: chưa biết server đã nhận hay chưa. Đây đúng là trường
      // hợp phải gửi lại **cùng** key, nên chỗ gọi không được xoay key.
      return {
        ok: false,
        status: 0,
        code: "INTERNAL_ERROR",
        message: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
        requestId: "unknown",
        fieldErrors: [],
      } satisfies ApiFailure;
    }

    if (response.status === 204) {
      return {
        ok: true,
        data: undefined as T,
        requestId: response.headers.get("x-request-id") ?? "unknown",
      };
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return toFailure(response.status, body, response.headers.get("retry-after"));
    }

    const envelope = body as { data: T; requestId: string };
    return { ok: true, data: envelope.data, requestId: envelope.requestId };
  }
}

/**
 * Lấy thông báo lỗi cho một field cụ thể từ `VALIDATION_FAILED`.
 *
 * Lỗi không gắn field nào được hiển thị ở cấp form, không phải gán bừa vào
 * field đầu tiên.
 */
export function fieldError(failure: ApiFailure, field: string): string | undefined {
  return failure.fieldErrors.find((error) => error.field === field)?.message;
}

/** Lỗi không thuộc field nào — hiển thị ở cấp form hoặc trang. */
export function formErrors(failure: ApiFailure, knownFields: readonly string[]): string[] {
  return failure.fieldErrors
    .filter((error) => !knownFields.includes(error.field))
    .map((error) => error.message);
}
