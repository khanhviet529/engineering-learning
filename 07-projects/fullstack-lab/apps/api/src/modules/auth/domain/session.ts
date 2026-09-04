import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

/**
 * Opaque session và CSRF — [ADR-0003](../../../../../docs/decisions/ADR-0003-opaque-session-authentication.md)
 * và `docs/security/authentication.md`.
 *
 * Vì sao opaque chứ không phải JWT: session ở đây phải **revoke được ngay**.
 * Reset mật khẩu huỷ mọi phiên đang mở trong cùng một transaction, và một token
 * tự xác minh không cho phép điều đó mà không dựng thêm một danh sách thu hồi —
 * tức là vẫn phải có bảng, nhưng mất luôn tính đơn giản vốn là lý do chọn JWT.
 */

/**
 * 32 byte ngẫu nhiên mã base64url.
 *
 * Đây là bí mật duy nhất chứng minh danh tính, nên nó phải đến từ nguồn ngẫu
 * nhiên mật mã, không phải `Math.random` hay UUID v4 (v4 chỉ có 122 bit và
 * mang cấu trúc nhận ra được).
 */
const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * Băm token trước khi lưu.
 *
 * SHA-256 là đủ ở đây và **không** cần Argon2: token là 256 bit ngẫu nhiên, nên
 * không có gì để brute-force. Argon2 chỉ cần khi đầu vào có entropy thấp như
 * mật khẩu người dùng chọn; dùng nó ở đây chỉ làm mọi request chậm đi.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Thời gian sống của session. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

export type RevocationReason = "sign_out" | "password_reset" | "server_revocation";

export interface SessionRecord {
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Session dùng được khi **chưa hết hạn và chưa bị revoke**.
 *
 * Hàm nhận `now` thay vì tự gọi đồng hồ, để test kiểm được ranh giới hết hạn
 * mà không phải giả lập thời gian toàn cục.
 */
export function isSessionUsable(session: SessionRecord, now: Date = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  return session.expiresAt.getTime() > now.getTime();
}

/**
 * Thuộc tính cookie session.
 *
 * `Secure` bật ở mọi nơi trừ development. Nới lỏng cho local là có chủ đích,
 * nhưng nó **không** được rò sang build production — vì vậy điều kiện nằm ở
 * đúng một hàm, không rải rác trong code.
 */
export interface SessionCookieOptions {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export const SESSION_COOKIE_NAME = "fb_session";

export function sessionCookieOptions(nodeEnv: string): SessionCookieOptions {
  return {
    name: SESSION_COOKIE_NAME,
    // Cookie session không bao giờ đọc được bằng JavaScript: XSS không được
    // biến thành đánh cắp phiên.
    httpOnly: true,
    // `lax` cho phép điều hướng từ link email về ứng dụng vẫn mang cookie,
    // trong khi vẫn chặn cookie đi kèm request cross-site dạng form POST.
    sameSite: "lax",
    secure: nodeEnv !== "development",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * CSRF token **gắn với session**.
 *
 * Nó là HMAC của session token dưới một secret riêng, nên:
 *
 * - Không cần lưu thêm cột nào: giá trị suy lại được từ session.
 * - Một CSRF token của phiên này không dùng được cho phiên khác.
 * - Kẻ tấn công cross-site không đọc được cookie `HttpOnly` nên không tự tính
 *   được giá trị này, dù họ khiến trình duyệt gửi cookie đi.
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
 * Token một lần cho xác minh email và reset mật khẩu.
 *
 * Cùng cách sinh và cùng cách băm với session token, vì cùng tính chất: entropy
 * cao, chỉ lưu hash, và chỉ dùng được một lần.
 */
export function generateOneTimeToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export const hashOneTimeToken = hashSessionToken;

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
