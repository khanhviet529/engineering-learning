import type { FastifyRequest } from "fastify";

/**
 * Envelope thành công — `docs/api/api-conventions.md`.
 *
 * Mọi response JSON thành công có cùng hình dạng `{ data, requestId }`, và
 * `requestId` cũng xuất hiện trong header `X-Request-Id`. Giữ nó ở một hàm
 * dùng chung vì nếu mỗi controller tự dựng object envelope, một chỗ quên
 * `requestId` sẽ tạo ra response hợp lệ về mặt kiểu nhưng không tra được log.
 *
 * Đây là đối xứng của `mapError` ở `shared/errors`: một chỗ dựng envelope
 * thành công, một chỗ dựng envelope lỗi.
 */

export interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

/**
 * `requestId` do hook `onRequest` ở `main.ts` đặt lên request.
 *
 * Fallback `"unknown"` thay vì ném lỗi: một response mất correlation ID là
 * chuyện khó chịu, còn một request hỏng vì thiếu correlation ID là chuyện tệ
 * hơn cho người dùng.
 */
export function getRequestId(request: FastifyRequest): string {
  return (request as FastifyRequest & { requestId?: string }).requestId ?? "unknown";
}

export function ok<T>(request: FastifyRequest, data: T): SuccessEnvelope<T> {
  return { data, requestId: getRequestId(request) };
}

/** Envelope của list endpoint: `items` và `page` nằm **trong** `data`. */
export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export function okList<T>(
  request: FastifyRequest,
  items: T[],
  page: PageInfo,
): SuccessEnvelope<{ items: T[]; page: PageInfo }> {
  return ok(request, { items, page });
}
