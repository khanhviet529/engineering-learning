/**
 * `requestId` — `docs/api/api-conventions.md`, mục "Request ID và observability".
 *
 * Client **được phép** gửi `X-Request-Id`, nhưng giá trị đó là input không tin
 * cậy: nó sẽ đi vào structured log, nên một chuỗi dài hoặc chứa ký tự điều
 * khiển là một đường tiêm vào log. Vì vậy API chuẩn hoá hoặc thay mới, chứ
 * không nhận nguyên xi.
 *
 * `requestId` là correlation ID. Nó **không** phải idempotency key và **không**
 * mang ngữ nghĩa authorization nào.
 */

/** Ký tự an toàn cho log; đủ rộng cho ULID, UUID và trace ID thông dụng. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function normalizeRequestId(candidate: string | undefined, generate: () => string): string {
  if (candidate !== undefined && SAFE_REQUEST_ID.test(candidate)) return candidate;
  return generate();
}

/** Bộ sinh mặc định: ngẫu nhiên, URL-safe, không mang thông tin gì. */
export function generateRequestId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
