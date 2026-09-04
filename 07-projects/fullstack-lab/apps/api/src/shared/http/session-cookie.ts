/**
 * Cookie session — hình dạng và tên.
 *
 * Nằm ở `shared/` vì có **ba** consumer thật, không phải vì "sẽ dùng sau":
 * module `auth` đặt và xoá cookie, `SessionGuard` của `shared/authorization`
 * đọc nó ở mọi route được bảo vệ, và mọi module sản phẩm đi qua guard đó. Quy
 * tắc hai consumer ở `docs/engineering/shared-helper-policy.md` đã đạt.
 *
 * Điều quan trọng hơn là **vì sao không nhân bản**: nếu tên cookie tồn tại ở
 * hai chỗ, một lần đổi tên ở chỗ này mà quên chỗ kia làm mọi request được xác
 * thực trở thành `401` — hoặc tệ hơn, làm guard đọc một cookie không ai đặt và
 * âm thầm coi mọi người là chưa đăng nhập.
 *
 * File này cố ý **không** chứa policy nghiệp vụ: không TTL của session, không
 * quy tắc revoke. Những thứ đó thuộc domain của `auth`.
 */

export const SESSION_COOKIE_NAME = "fb_session";

export interface SessionCookieOptions {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

/**
 * Thuộc tính cookie session.
 *
 * `Secure` bật ở mọi nơi trừ development. Nới lỏng cho local là có chủ đích,
 * nhưng nó **không** được rò sang build production — vì vậy điều kiện nằm ở
 * đúng một hàm, không rải rác trong code.
 */
export function sessionCookieOptions(nodeEnv: string, maxAgeSeconds: number): SessionCookieOptions {
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
    maxAge: maxAgeSeconds,
  };
}
