---
level: intermediate
area: backend
---

# Auth

Ba câu hỏi, và chúng độc lập với nhau:

```text
① AI?          xác thực (authentication)  → 01, 02, 03, 04, 05
② ĐƯỢC LÀM GÌ? uỷ quyền  (authorization)  → 01, 06
③ ĐÃ LÀM GÌ?   ghi vết   (audit)          → xuyên suốt
```

Gần như mọi sự cố bảo mật nghiêm trọng trong ứng dụng web nằm ở câu ② — và nó là câu duy nhất **không có thư viện nào làm hộ được**, vì nó phụ thuộc vào nghiệp vụ của bạn.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Authentication vs Authorization](01-authentication-authorization.md) | Vì sao đổi ID trong URL lại xem được hoá đơn người khác? |
| 2 | [Session vs token](02-session-vs-token.md) | Vì sao nhân viên bị sa thải vẫn dùng được hệ thống 24 giờ? |
| 3 | [JWT & refresh token](03-jwt-refresh-token.md) | Refresh token bị đánh cắp — làm sao phát hiện? |
| 4 | [OAuth 2 & OIDC](04-oauth-oidc.md) | Vì sao dùng `access_token` để đăng nhập là lỗ hổng? |
| 5 | [Password & MFA](05-password-mfa.md) | Vì sao hệ thống bị chiếm qua chức năng *quên mật khẩu*? |
| 6 | [Authorization models](06-authorization-models.md) | Vì sao dự án có chín role và không ai dám xoá cái nào? |

Note 1 và 6 là hai note quan trọng nhất. Note 2–5 là cơ chế; note 1 và 6 là **cách suy nghĩ**.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Đổi ID trong URL xem được dữ liệu người khác | ownership không nằm trong query | [1](01-authentication-authorization.md), [6](06-authorization-models.md) |
| Danh sách hiện nhiều hơn chi tiết cho phép | `findOne` và `findMany` lệch scope | [6](06-authorization-models.md) |
| Dữ liệu của khách hàng khác lọt vào | thiếu `tenant_id` ở một query | [1](01-authentication-authorization.md) |
| Thu hồi quyền không có hiệu lực ngay | quyền nằm trong token | [2](02-session-vs-token.md), [3](03-jwt-refresh-token.md) |
| Người dùng bị đăng xuất ngẫu nhiên | rotation + race giữa nhiều tab | [3](03-jwt-refresh-token.md) |
| Token bị đánh cắp qua XSS | lưu ở `localStorage` | [2](02-session-vs-token.md) |
| Đăng nhập bằng Google vào nhầm tài khoản | khớp theo email, hoặc `email_verified` bị bỏ qua | [4](04-oauth-oidc.md) |
| Chấp nhận token của ứng dụng khác | không kiểm `aud` | [3](03-jwt-refresh-token.md), [4](04-oauth-oidc.md) |
| Chiếm tài khoản qua reset mật khẩu | token yếu / không hết hạn / dùng nhiều lần | [5](05-password-mfa.md) |
| Chiếm tài khoản qua đổi email | không yêu cầu xác thực lại | [5](05-password-mfa.md) |
| Nhiều tài khoản bị thử cùng một mật khẩu | rate limit chỉ theo tài khoản | [5](05-password-mfa.md) |
| Endpoint mới công khai ngoài ý muốn | guard mặc định mở | [6](06-authorization-models.md) |
| Đăng nhập chậm khi tải cao | cost hash + thread pool | [5](05-password-mfa.md) |
| Thêm một role phải sửa 40 chỗ | code kiểm tra role, không kiểm tra permission | [6](06-authorization-models.md) |

## Mười quyết định mặc định

Khi không có yêu cầu đặc biệt, đây là các lựa chọn đúng:

```text
 1. Session + cookie HttpOnly cho web app.
    JWT chỉ khi có lý do cụ thể session không đáp ứng.

 2. Nếu dùng JWT: access token 5–15 phút, refresh token xoay vòng
    + phát hiện tái sử dụng + huỷ theo family.

 3. Verify token LUÔN chỉ định algorithms, issuer, audience.

 4. OAuth: chỉ Authorization Code + PKCE.
    id_token để xác thực; access_token KHÔNG BAO GIỜ dùng để xác thực.

 5. Khoá người dùng ngoại là (provider, sub), không phải email.

 6. argon2id với tham số đo trên phần cứng thật; needsRehash lúc đăng nhập.

 7. Đối chiếu danh sách mật khẩu bị lộ, thay cho quy tắc độ phức tạp.

 8. Guard toàn cục MẶC ĐỊNH ĐÓNG; @Public() để mở từng chỗ.

 9. Permission (không phải role) ở guard;
    tenant_id + owner_id trong WHERE — một hàm scope dùng cho cả check và list.

10. 404 thay vì 403 khi sự tồn tại của tài nguyên là thông tin.
```

Mười dòng này chặn phần lớn các triệu chứng trong bảng chẩn đoán ở trên.

## Hai đường thường bị bỏ quên

```text
① CÁC ĐƯỜNG VÒNG QUANH ĐĂNG NHẬP
   quên mật khẩu · đổi email · mã dự phòng · tắt MFA · hỗ trợ khách hàng
   → phải được bảo vệ NGANG với đăng nhập
   → mọi thao tác đổi cách đăng nhập cần xác thực lại (step-up)

② CÂU HỎI "THẤY ĐƯỢC NHỮNG GÌ"
   authz không chỉ là boolean check
   → nếu mô hình không sinh ra được mệnh đề WHERE, nó không dùng được cho danh sách
```

## Kiểm tra nhanh trước khi merge một endpoint

```text
□ Người dùng chưa đăng nhập gọi được không?
□ Người dùng của TENANT KHÁC gọi được không?
□ Đổi ID trong URL sang ID người khác — trả về gì?
□ Endpoint danh sách có lọc trong QUERY không (không phải lọc sau)?
□ Có test cho đường TỪ CHỐI, không chỉ đường cho phép?
□ Quyết định từ chối có được log kèm userId và lý do không?
```

## Position

```text
Client → [ XÁC THỰC: ai? ] → [ UỶ QUYỀN: được làm gì, trên cái gì? ] → Service → DB
              ↑ 02–05                    ↑ 01, 06                            ↑ RLS
```

## Related

- [02-backend-api/](../README.md) — đường đi của một request
- [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md) — nơi cài đặt trong NestJS
- [Security](../../05-cross-cutting/security/README.md) — XSS, CSRF, access control, secrets
- [Cookies & storage](../../01-web-frontend/00-web-foundations/05-cookies-storage.md) — nơi lưu ở phía client
- [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md) — chống thử mật khẩu
- [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) — bối cảnh cho RLS
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md) — audit trail

## Version / Context

Ví dụ dùng NestJS 10/11, PostgreSQL 16, Redis 7. Chuẩn tham chiếu: RFC 6749/7636/7519, OIDC Core 1.0, OAuth 2.0 Security BCP, NIST SP 800-63B, OWASP Top 10 (2021) — mục A01 Broken Access Control và A07 Identification and Authentication Failures.
