/**
 * Những path của web app mà **server** phải biết để dựng link trong thư.
 *
 * Đây là một đường nối hẹp và có thật: ba loại thư — xác minh email, đặt lại
 * mật khẩu, lời mời workspace — đều mang một link trỏ về web app, và link đó
 * được dựng ở `apps/api`. Nếu path chỉ tồn tại như một chuỗi trong mailer và
 * một tên thư mục trong `apps/web`, hai bên lệch nhau mà **không test nào của
 * bên nào bắt được**.
 *
 * Chuyện đó đã xảy ra: thư mời trỏ `/loi-moi` trong khi route thật là
 * `/loi-moi/chap-nhan`, nên mọi người được mời nhận `404`. 954 test xanh ở cả
 * hai phía. Test của backend đọc token **ra khỏi** Mailpit rồi tự gọi API, test
 * của frontend render component với `token` truyền vào và tự đặt
 * `window.location` — không bên nào nhìn vào chính cái path trong thư.
 *
 * File này vì vậy chỉ chứa những path **đi qua đường nối đó**, không phải toàn
 * bộ route của app. Danh mục route đầy đủ nằm ở
 * `docs/design/information-architecture.md` theo
 * [ADR-0014](../../../docs/decisions/ADR-0014-route-language.md); nhân bản nó ở
 * đây sẽ tạo ra đúng loại nguồn-thứ-hai mà file này tồn tại để chống.
 *
 * `apps/web` có một test đọc `src/app` trên đĩa và khẳng định mỗi path dưới đây
 * là một route thật. `apps/api` dùng chúng thay cho chuỗi viết tay.
 */
export const WEB_ROUTES = {
  /** `AUTH-05` — hoàn tất xác minh email từ link trong thư. */
  emailVerify: "/xac-minh-email",
  /** `AUTH-04` — đặt mật khẩu mới bằng token reset. */
  passwordReset: "/dat-lai-mat-khau",
  /** `WSP-05` — đổi token lời mời thành membership workspace. */
  invitationAccept: "/loi-moi/chap-nhan",
} as const;

export type WebRouteKey = keyof typeof WEB_ROUTES;

/**
 * Dựng URL tuyệt đối cho một link trong thư.
 *
 * Token luôn đi trong query key `token` — tiếng Anh, vì query key là tham số
 * kỹ thuật chứ không phải chữ hiển thị (ADR-0014). Việc `encodeURIComponent`
 * nằm ở đây, một chỗ, thay vì ở từng chỗ gọi.
 */
export function webRouteWithToken(origin: string, key: WebRouteKey, token: string): string {
  return `${origin}${WEB_ROUTES[key]}?token=${encodeURIComponent(token)}`;
}
