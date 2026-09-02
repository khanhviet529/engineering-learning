# ADR-0003: Opaque server session, cookie và CSRF thay vì JWT

- Status: Accepted
- Date: 2026-09-02
- Related docs: [authentication](../security/authentication.md), [database design](../data/database-design.md) (bảng `auth_sessions`), [API conventions](../api/api-conventions.md), [authorization model](../security/authorization-model.md)

## Context

Flowboard là browser web app với private project và deny-by-default. Ba yêu cầu đã được baseline chốt buộc cơ chế phiên phải trả lời được: (1) logout, password reset và security revocation phải vô hiệu hóa phiên **ngay lập tức**, không phải "khi token hết hạn"; (2) quyền là per-project và có thể đổi giữa hai request (member bị gỡ, role đổi), nên mọi request đều phải đánh giá lại membership từ database — không có lợi ích "stateless" nào để đổi lấy; (3) bearer secret không được nằm trong JavaScript-accessible storage. `decisions/README.md` liệt kê lựa chọn authentication/session là quyết định bắt buộc có ADR; contract đã tồn tại ở `security/authentication.md` nhưng chưa có bản ghi lý do — ADR này bổ sung phần đó, không đổi contract.

## Decision

Giữ nguyên contract đã phê duyệt: **opaque server session**. Sign-in tạo identifier ngẫu nhiên high-entropy, gửi duy nhất qua cookie `HttpOnly, SameSite=Lax, Secure` (ngoài local dev); server chỉ lưu hash trong `auth_sessions` (`session_token_hash UNIQUE`, `revoked_at`, `revocation_reason`). `SessionGuard` hash cookie và lookup mỗi request. Mọi mutation browser yêu cầu CSRF token session-bound trong `X-CSRF-Token` cùng origin check.

Các quyết định phụ thuộc đi kèm, đã có trong contract và được ADR này ghi nhận là một khối:

- Session ID **rotate khi sign-in**; server không bao giờ chấp nhận identifier do client cung cấp (chống session fixation).
- Password reset **revoke mọi active session trong cùng transaction** với việc thay password hash.
- `403 EMAIL_VERIFICATION_REQUIRED` **không set cookie/CSRF token** — xác thực đúng credential nhưng chưa tạo phiên.
- Logout idempotent: revoke session khớp nếu có và clear cookie kể cả khi session đã vắng/hết hạn.

Chi phí chấp nhận: một database point-lookup cho mỗi request. Chi phí này chấp nhận được **vì** index `auth_sessions(session_token_hash)` (unique btree, đã có trong index baseline) làm lookup O(1) trên bảng chỉ tăng theo số phiên; và vì mọi request project-data vốn đã phải chạm database để đánh giá membership — bỏ session lookup không loại database khỏi hot path.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Opaque server session + cookie + CSRF (chọn) | Revocation tức thời (logout/reset/remove member); bearer secret ngoài tầm JS; không có claim nào để client giả mạo; mô hình đơn giản nhất đúng cho browser-only MVP. | Một DB lookup mỗi request; session store là stateful dependency (đã được index và vốn là dependency của mọi request). |
| Stateless JWT access token | Không cần session store; xác thực không chạm DB. | Không revoke được trước expiry — logout, password reset và gỡ member chỉ có hiệu lực khi token hết hạn; muốn revoke tức thời phải thêm denylist ⇒ tái tạo state vừa loại bỏ. Nhồi role/permission vào claim mâu thuẫn trực tiếp với authorization per-project đánh giá lại mỗi request. Lợi ích stateless vô nghĩa khi mọi request vẫn phải query membership. |
| JWT access ngắn hạn + refresh token rotation | Thu hẹp cửa sổ revocation về TTL của access token; có tiền lệ cho mobile/API client. | Độ phức tạp cao nhất (hai token, rotation, reuse detection, đồng bộ hai expiry) để đổi lấy revocation **vẫn trễ** trong TTL. MVP không có non-browser client nào cần bearer header. Sẽ đánh giá lại khi có public API/mobile (xem Revisit). |

## Consequences

- Được: mô hình revocation khớp chính xác bảng "Authentication lifecycle outcomes" trong `security/authentication.md`; test matrix có thể chứng minh từng dòng (phiên bị revoke từ chối ngay ở request kế tiếp).
- Chi phí: bảng `auth_sessions` tăng theo phiên; purge policy được hoãn có chủ đích (ghi tại database design) và cần retention policy phê duyệt trước khi thêm — không thêm cron dọn tự phát.
- Vận hành: database unavailable làm authentication unavailable — chấp nhận vì toàn bộ product data cùng số phận; readiness contract đã phản ánh điều này.
- Ràng buộc: non-browser client không được tái dùng cookie contract (đã ghi ở authentication.md); mở API token là quyết định mới.

## Revisit When

- Sản phẩm cần non-browser client, public API hoặc API token cho integration — khi đó đánh giá lại token-based scheme cho surface đó (không nhất thiết thay cookie session của browser).
- Có SSO/OIDC requirement.
- Telemetry cho thấy session lookup là bottleneck thực (ví dụ multi-instance với connection pool bão hòa) — khi đó cân nhắc session cache (Redis) bằng ADR mới, không đổi semantic revocation.
