import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.ts";
import { SESSION_COOKIE_NAME } from "./session-cookie.ts";

/**
 * CSRF token **gắn với session** — `docs/security/authentication.md`.
 *
 * Nó là HMAC của session token dưới một secret riêng, nên:
 *
 * - Không cần lưu thêm cột nào: giá trị suy lại được từ session.
 * - Một CSRF token của phiên này không dùng được cho phiên khác.
 * - Kẻ tấn công cross-site không đọc được cookie `HttpOnly` nên không tự tính
 *   được giá trị này, dù họ khiến trình duyệt gửi cookie đi.
 *
 * Ở `shared/` vì mọi module có mutation đều cần: `auth` (sign-out), `workspaces`
 * và `projects` (toàn bộ mutation), và các module của M3, M4 sau đó.
 */

export function deriveCsrfToken(sessionToken: string, csrfSecret: string): string {
  return createHmac("sha256", csrfSecret).update(sessionToken, "utf8").digest("base64url");
}

/**
 * So sánh CSRF token theo thời gian hằng định.
 *
 * So sánh bằng `===` rò rỉ độ dài tiền tố khớp qua thời gian chạy. Với một giá
 * trị mà kẻ tấn công gửi được nhiều lần, đó là một kênh phụ thật.
 */
export function csrfTokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Cưỡng chế CSRF cho một mutation phát sinh từ browser.
 *
 * Ném **trước khi** use case chạy. Hợp đồng nói rõ: một lần CSRF thất bại không
 * tạo mutation hay activity record nào — nên phép kiểm này phải nằm ở ranh giới
 * HTTP, không nằm bên trong transaction.
 *
 * `403 FORBIDDEN` chứ không phải `401`: session **có** hợp lệ; thứ thiếu là
 * bằng chứng rằng request thật sự đến từ ứng dụng của chúng ta.
 */
export function requireCsrf(request: FastifyRequest, csrfSecret: string): void {
  const sessionToken = request.cookies[SESSION_COOKIE_NAME];
  if (sessionToken === undefined) throw new AppError("UNAUTHENTICATED");

  const received = request.headers["x-csrf-token"];
  const expected = deriveCsrfToken(sessionToken, csrfSecret);
  if (typeof received !== "string" || !csrfTokenMatches(expected, received)) {
    throw new AppError("FORBIDDEN", { message: "Yêu cầu thiếu hoặc sai CSRF token." });
  }
}
