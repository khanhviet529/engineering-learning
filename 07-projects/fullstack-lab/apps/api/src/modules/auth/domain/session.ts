import { createHash, randomBytes } from "node:crypto";

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
 * Cookie session và CSRF đã chuyển sang `shared/http/`.
 *
 * Lý do: `SessionGuard` của `shared/authorization` và mọi module có mutation
 * đều cần chúng, nên quy tắc hai consumer ở
 * `docs/engineering/shared-helper-policy.md` đã đạt. Giữ thêm một bản sao ở đây
 * là tạo ra hai nguồn cho cùng một tên cookie — và một lần đổi tên sót chỗ thứ
 * hai làm mọi phiên đăng nhập im lặng trở thành `401`.
 *
 * Xem `shared/http/session-cookie.ts` và `shared/http/csrf.ts`.
 */

/**
 * Token một lần cho xác minh email và reset mật khẩu.
 *
 * Cơ chế sinh và băm đã chuyển sang `shared/security/one-time-token.ts` khi lời
 * mời workspace (ADR-0013) trở thành consumer thứ hai: đồ thị phụ thuộc của
 * ADR-0005 không có cạnh `workspaces → auth`, nên một primitive mà cả hai module
 * cần phải ở shared. Re-export để chỗ gọi trong `auth` giữ nguyên vocabulary
 * của mình, nhưng **định nghĩa chỉ có một**.
 */
export { generateOneTimeToken, hashOneTimeToken } from "../../../shared/security/one-time-token.ts";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
