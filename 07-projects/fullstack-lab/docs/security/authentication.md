# Xác thực của Flowboard

Tài liệu này là hợp đồng xác thực cho Flowboard MVP. Nó mở rộng thiết kế email/password và opaque session của baseline đã phê duyệt; nó không đưa vào social sign-in, API token hay xác thực cho public API.

## Quy tắc danh tính và credential

- Người dùng đăng ký bằng email, password và các profile field bắt buộc. Service tạo một account chưa xác minh rồi gửi liên kết xác minh email.
- Password được hash bằng **Argon2id**. Password hash là biểu diễn duy nhất của password được lưu hoặc ghi log. Tham số hash là configuration do auth module sở hữu và phải được hiệu chỉnh theo môi trường triển khai; client không bao giờ điều khiển được chúng.
- Liên kết xác minh email và đặt lại password chứa token ngẫu nhiên high-entropy, sinh độc lập cho từng liên kết. Mỗi token dùng một lần, có expiry, và chỉ được lưu dưới dạng hash. Khi token bị tiêu thụ, hết hạn hoặc bị thay thế thì nó không còn dùng được.
- **Password policy** (theo [ADR-0007](../decisions/ADR-0007-password-policy.md), Accepted 03/09/2026): password dài 12–200 ký tự và **không có yêu cầu composition** nào. Mọi ký tự in được đều hợp lệ, kể cả space và ký tự ngoài ASCII; giá trị được normalize NFKC **giống nhau** ở sign-up, reset và sign-in, và không bao giờ bị truncate trước khi hash. Verifier từ chối password nằm trong danh sách phổ biến hoặc đã bị lộ (bundle có version), hoặc password chứa local-part của email hay display name của chính account đó (không phân biệt hoa thường, chuỗi con từ bốn ký tự trở lên), trả `400 VALIDATION_FAILED` với field error an toàn không tiết lộ đã khớp danh sách nào. Không có lượt tra blocklist nào đi ra khỏi process trên đường sign-up. Không có rotation định kỳ, password hint hay câu hỏi bảo mật; luồng reset bằng token vẫn là đường thay password duy nhất. Client chỉ kiểm những gì kiểm được — độ dài và quy tắc không-chứa-email/tên — rồi hiển thị kết quả blocklist dưới dạng field error sau khi submit; validator phía server là điểm quyết định cuối cùng. Đổi policy này là thay đổi vòng đời credential, cần ADR mới và phải cập nhật cùng lúc với design checklist của `AUTH-02`/`AUTH-04`.
- Sign-in nhận email và password. Credential sai và account không tồn tại đều nhận cùng một outcome `401 UNAUTHENTICATED` chung, ở những chỗ mà tiết lộ sự tồn tại của account là không an toàn. Credential đúng nhưng account chưa xác minh nhận `403 EMAIL_VERIFICATION_REQUIRED` trong error envelope chuẩn, có message an toàn và `requestId` nhưng không có `details`, không session cookie, không CSRF token và không dữ liệu private.
- Request login và đặt lại password bị rate limit theo tổ hợp client signal và account identifier đã normalize. Giới hạn dùng response có biên cùng audit/monitoring signal; chúng không tiết lộ account có tồn tại hay không.
- Request sign-up dùng cùng mô hình rate limit có biên và có giám sát đó: áp giới hạn theo client signal và email đã normalize **trước khi** tạo account hoặc gửi email xác minh. Một email đã normalize chỉ có được một account; một account chưa xác minh đang tồn tại không tạo thêm account thứ hai và không gây gửi xác minh vô hạn, còn mọi lần resend vẫn bị rate limit riêng. Response của sign-up giữ nội dung chung ở những chỗ mà nói cụ thể sẽ làm lộ sự tồn tại của account.

## Đăng ký, xác minh và phục hồi password

1. **Sign up:** validate input, tạo user với password hash Argon2id, tạo verification token đã hash kèm expiry, rồi gửi liên kết xác minh. Không password, raw token hay giá trị dẫn xuất từ credential nào được vào log, activity history hoặc API response.
2. **Verify email:** hash token nhận được, tìm đúng một record khớp còn chưa dùng và chưa hết hạn, đánh dấu email đã xác minh, và tiêu thụ token trong **cùng một transaction**. Gửi lại lần hai thất bại.
3. **Forgot password:** nhận một email, áp rate limit của reset, và trả về cùng một acknowledgement bất kể account có đủ điều kiện hay không. Nếu đủ điều kiện, thay mọi reset token còn hiệu lực bằng một token mới đã hash, dùng một lần, có expiry, rồi gửi liên kết.
4. **Reset password:** validate và tiêu thụ reset token, validate password mới, thay password hash Argon2id, và **revoke mọi active session của user đó trong cùng transaction**. User đăng nhập lại bằng password mới.

Endpoint đổi password khi đã đăng nhập và UI account-settings tương ứng được **hoãn** khỏi MVP. Chúng cần một quyết định sản phẩm riêng bao gồm re-authentication, phục hồi và hành vi session; chúng không được suy ra từ luồng reset password.

Sản phẩm có thể gửi lại email xác minh qua một endpoint có rate limit riêng. Một lần resend **thay thế** verification token chưa dùng trước đó, chứ không tạo ra nhiều liên kết cùng hợp lệ một lúc.

## Opaque session và cookie

Sign-in thành công tạo một session identifier **opaque**, ngẫu nhiên và high-entropy. Nó là một bearer secret — không phải JWT, không phải user ID và không phải role claim đã serialize.

1. Sinh opaque identifier bằng nguồn ngẫu nhiên an toàn về mật mã.
2. Chỉ gửi giá trị thô trong session cookie.
3. Chỉ lưu hash phía server trong `auth_sessions`, cùng user ID, thời điểm phát hành/hết hạn và metadata thu hồi. Giá trị session thô không bao giờ được persist.
4. Ở mỗi request, `SessionGuard` hash giá trị cookie, tra session, và chỉ chấp nhận khi session tồn tại, chưa hết hạn và chưa bị revoke.

Session cookie là host-only và dùng `Path=/`, `HttpOnly`, expiry/max age tường minh, cùng `SameSite=Lax`. Nó dùng `Secure` ở mọi nơi ngoài local development. Production bắt buộc HTTPS và không được làm yếu các attribute này qua proxy hay environment override. `HttpOnly` nghĩa là JavaScript của browser không đọc được bearer secret; session state không được đặt vào local storage.

Việc tạo session **rotate** identifier chứ không chấp nhận session identifier do client cung cấp. Một session có thể bị revoke phía server bất cứ lúc nào. Logout là idempotent: server đánh dấu active session khớp là đã revoke và clear cookie, kể cả khi session đã vắng mặt hoặc đã hết hạn. Expiry, logout tường minh, reset password và thu hồi vì lý do quản trị/bảo mật đều kết thúc một session; session đã revoke hoặc đã hết hạn thì client không thể gia hạn.

## Phòng vệ CSRF

`SameSite=Lax` làm giảm việc cookie được gửi cross-site nhưng **không** phải cơ chế authorization cho CSRF. Với mọi request thay đổi trạng thái phát sinh từ browser (POST, PATCH, PUT, DELETE), API yêu cầu một CSRF token do server phát hành, gắn với session, đặt trong custom request header như `X-CSRF-Token`.

- Token được sinh bằng ngẫu nhiên mật mã khi session được tạo hoặc rotate. Biểu diễn lưu trữ của nó gắn với đúng session đó và được kiểm bằng so sánh constant time.
- Browser chỉ lấy được token qua một hợp đồng bootstrap/response same-origin đã xác thực; nó không bao giờ lấy được session secret `HttpOnly`.
- API còn validate `Origin` thuộc allowlist (hoặc fallback `Referer` qua HTTPS ở nơi cần). Token/origin thiếu, sai hoặc không khớp thì request bị từ chối **trước khi** use case chạy.
- Kiểm tra CSRF phủ cả sign-out và mọi protected mutation, gồm route của project, task, member, column, comment và report-export. Một lần CSRF thất bại không tạo mutation hay activity record nào.

Client không phải browser nằm ngoài MVP. Chúng không được đi vòng qua thiết kế này bằng cách tái dùng hợp đồng cookie của browser.

## Outcome theo vòng đời xác thực

| Sự kiện | Kết quả với session và cookie |
|---|---|
| Sign-in thành công | Tạo server session mới đã hash, set opaque session cookie cùng một CSRF token gắn session. |
| Session hết hạn hoặc bị server revoke | `SessionGuard` từ chối; response clear cookie cũ ở nơi làm được. |
| Sign-out | Revoke server session và clear cookie. |
| Reset password | Tiêu thụ reset token, thay password hash, revoke mọi session của user, và buộc đăng nhập lại. |
| Sign-in khi chưa xác minh | Trả `403 EMAIL_VERIFICATION_REQUIRED` trong error envelope chuẩn; không tạo session hay cookie, rồi đưa user tới verification/resend. |
| Xác minh email | Tiêu thụ verification token; nó không phát sinh và không lộ ra một authentication secret dùng lại được. |

## Điểm tích hợp khi implementation

`SessionGuard` là NestJS guard tương lai chỉ chịu trách nhiệm **xác thực**: nó biến một opaque session hợp lệ thành authenticated actor, hoặc từ chối request là unauthenticated. Nó không quyết định permission của project. `ProjectPermissionGuard` mới thực hiện quyết định action/resource kế tiếp, mô tả trong [authorization-model.md](authorization-model.md).
