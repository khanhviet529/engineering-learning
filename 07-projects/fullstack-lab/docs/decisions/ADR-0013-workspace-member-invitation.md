# ADR-0013: Thêm workspace member bằng lời mời qua email, không bằng tra cứu người dùng

**Status:** Proposed

**Date:** 2026-09-04

**Owners:** Chủ dự án phê duyệt; controller thực thi

**Related docs:** [hợp đồng endpoint](../api/endpoint-contracts.md) (mục Workspaces và workspace members), [mô hình phân quyền](../security/authorization-model.md), [xác thực](../security/authentication.md), [ADR-0007](ADR-0007-password-policy.md), [kế hoạch triển khai](../implementation-plan.md) (mục nợ hợp đồng), [thiết kế database](../data/database-design.md), [danh mục màn hình](../design/screen-inventory.md) (`WSP-03`)

## Context

`POST /workspaces/:workspaceId/members` nhận `{ userId, role }`, và **không có endpoint nào cho phép tìm `userId`** từ một cái tên hay một địa chỉ email. Frontend vì vậy chỉ có thể cho người dùng dán một UUID vào form. Cả hai agent đều gặp và đều báo cùng chỗ này khi làm M2; nó chặn đúng phần "thêm thành viên" của `WSP-03`.

Đây không phải một chi tiết hợp đồng bỏ quên mà sửa là xong. Mọi cách sửa đều chạm vào một trong hai thứ: **vòng đời danh tính**, hoặc **bề mặt enumeration**. Vì vậy nó cần một quyết định được ghi lại, không phải một lựa chọn của người viết code.

### Dữ kiện làm thay đổi câu trả lời

Chính sách cấp workspace mà implementation đã chọn — và hợp đồng cố ý không quy định — là: **bất kỳ actor nào đã xác minh email đều tạo được workspace, và trở thành Workspace Admin của workspace mình tạo**.

Hệ quả: một endpoint tra cứu người dùng "chỉ dành cho Workspace Admin" **không** là một bề mặt hạn chế. Bất kỳ ai đăng ký xong, xác minh email, rồi tạo một workspace rỗng đều có quyền đó. Nói cách khác, kiểm quyền `workspace:member:manage` không thu hẹp gì đáng kể ở đây; nó chỉ thêm ba bước vào một cuộc dò email.

Điều này loại bỏ phương án tra cứu, chứ không chỉ làm nó bớt hấp dẫn.

### Vì sao việc này không thể hoãn

Thêm người thứ hai vào một workspace là điều kiện để vòng lặp Owner/Editor/Viewer có nghĩa. Không có nó, ba vai trò project chỉ tồn tại trên giấy: một mình người tạo workspace không thể vừa là Owner vừa là Viewer để kiểm chứng bất kỳ ràng buộc quyền nào ngoài fixture của test.

Phạm vi áp dụng: core MVP. Ngoài scope của ADR này: mời vào **project** (target đã buộc phải là WorkspaceMember, nên frontend chọn từ `GET /workspaces/:workspaceId/members` là đủ), quản lý tổ chức nhiều cấp, và bất kỳ hình thức đăng ký tự phục vụ nào.

## Decision

Đổi `POST /workspaces/:workspaceId/members` sang **mời theo email**, và lưu lời mời như một bản ghi có vòng đời tường minh.

### Hợp đồng

| Route | Hành vi |
|---|---|
| `POST /workspaces/:workspaceId/members` | Body `{ email, role }`. Yêu cầu `workspace:member:manage`, CSRF, `Idempotency-Key`. **Luôn** trả `202 { accepted: true }` — giống hệt nhau dù email đã có account, chưa có account, hay đã là member |
| `GET /workspaces/:workspaceId/invitations` | Yêu cầu `workspace:member:manage`. Danh sách lời mời `pending` của **chính workspace này**, có cursor. Không trả lời mời của workspace khác |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | Yêu cầu `workspace:member:manage`, CSRF, `Idempotency-Key`. Thu hồi lời mời `pending`. `204` |
| `POST /invitations/accept` | Anonymous. Body `{ token }`. Tạo membership rồi tiêu thụ token, **trong một transaction**. Actor phải đã đăng nhập bằng đúng email được mời |

### Ba ràng buộc quan trọng hơn danh sách route

**`202` là giống hệt nhau ở mọi nhánh.** Đây là cả lý do phương án này được chọn: người gửi lời mời không học được gì về việc email đó có account hay không. Ai sở hữu hộp thư sẽ nhận được thư và biết chuyện gì xảy ra; người đi dò thì không. Đây đúng lối mà `POST /auth/password/forgot` và `POST /auth/email/verification/resend` đã dùng, nên nó không phải một khuôn mẫu mới cần học.

**Token dùng lối đã có, không phát minh lại.** Sinh 32 byte ngẫu nhiên mật mã, chỉ lưu SHA-256, tiêu thụ bằng cách đặt hash vào `WHERE` của câu `UPDATE` — nên hai request cùng token không thể cùng thành công. Hết hạn sau 7 ngày. Mỗi cặp `(workspace, email)` chỉ có **một** lời mời `pending`: gửi lại thì ghi đè, và token cũ mất hiệu lực ngay.

**Chấp nhận lời mời không tự tạo account.** Nếu email chưa có account, thư dẫn tới `AUTH-02` kèm token; account được tạo qua đường sign-up bình thường, rồi token mới được tiêu thụ. Không có đường nào tạo credential mà bỏ qua chính sách mật khẩu của [ADR-0007](ADR-0007-password-policy.md).

### Schema

Một bảng `workspace_invitations`, tạo ở migration của mốc thực thi:

`id`, `workspace_id` (FK), `email` (canonical lowercase), `role`, `invited_by_user_id` (FK), `token_hash`, `status` (`CHECK IN ('pending','accepted','revoked')`), `expires_at`, `accepted_at`, `created_at`, `updated_at`; `UNIQUE (workspace_id, email) WHERE status = 'pending'` bằng partial unique index — cùng lối mà [ADR-0010](ADR-0010-sprint-iteration.md) dùng cho một sprint active.

`email` được lưu ở dạng thô trong bảng này (không hash), vì phải gửi thư tới nó. Đó là dữ liệu cá nhân, nên nó **không** xuất hiện trong log, không trong metric label, và bản ghi `revoked`/`accepted` cần một retention policy khi có — ghi vào điều kiện xem lại dưới đây.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| **Mời theo email, có bản ghi lời mời (được chọn)** | Dùng được thật; không tiết lộ account nào tồn tại; mời được người chưa đăng ký; tái dùng lối token và lối `202` generic đã dựng ở M1 | Thêm một bảng, ba route và một luồng chấp nhận vào MVP. Đây là cái giá thật, và nó là cái giá nhỏ nhất trong các phương án còn dùng được |
| `GET /users?email=` cho Workspace Admin | Sửa nhỏ nhất; không thêm thực thể | **Bị loại vì một dữ kiện, không vì sở thích:** ai xác minh email cũng tạo được workspace và thành admin, nên "chỉ admin" không thu hẹp gì — đây là một oracle dò email mở cho mọi người đăng ký. Rate limit và audit làm nó chậm hơn, không làm nó thôi là oracle. Nó cũng không mời được người chưa có account |
| Thêm trực tiếp bằng email, báo lỗi nếu không có account | Không thêm thực thể; form dùng được | Cùng oracle như trên, chỉ ẩn hơn: thông điệp lỗi *chính là* câu trả lời cho "email này có đăng ký chưa" |
| Giữ nguyên UUID | Không thêm gì | Không ai dùng được. Đây là hoãn, không phải quyết định — và nó hoãn luôn khả năng kiểm chứng ba vai trò project bằng người thật |
| Hoãn hẳn việc thêm workspace member khỏi MVP | Giữ phạm vi nhỏ nhất | Bỏ luôn điều kiện để vòng lặp Owner/Editor/Viewer có nghĩa. Nếu chọn hướng này thì phải nói rõ MVP không kiểm chứng được phân quyền bằng người thật, và đó là mất mát lớn hơn một bảng |

## Consequences

**Tích cực.** `WSP-03` dùng được. Ba vai trò project kiểm chứng được bằng người thật, không chỉ bằng fixture. Không có endpoint nào trả lời câu hỏi "email này đã đăng ký chưa". Luồng token tái dùng đúng cơ chế đã có test ở M1.

**Chi phí.** Một bảng, ba route, một luồng chấp nhận, hai màn hình (danh sách lời mời trong `WSP-03`, và một màn chấp nhận). Thư mời là một loại mail thứ ba sau verification và reset.

**Rủi ro và cách chặn.** Lời mời là một đường tạo membership, nên nó phải đi qua đúng những cổng mà mọi mutation khác đi qua: CSRF, `Idempotency-Key`, và rate limit trên route gửi mời — thiếu rate limit thì nó thành một máy gửi thư rác dùng tên miền của sản phẩm. Một lời mời `pending` **không** cấp quyền gì cho tới khi được chấp nhận; và thu hồi phải có hiệu lực ngay, nên chấp nhận một lời mời đã `revoked` là lỗi validation an toàn, cùng thông điệp với token hết hạn.

**Ảnh hưởng tới private-project authorization: không.** Lời mời chỉ tạo `workspace_members`. Workspace Admin vẫn **không** có quyền ngầm định với project riêng tư, và quy tắc `404` thay vì `403` không đổi.

**Cần cập nhật cùng lúc:** hợp đồng endpoint, `packages/contracts`, thiết kế database và thứ tự migration, danh mục error code nếu luồng chấp nhận cần code riêng, ma trận test phân quyền, `screen-inventory.md` cho `WSP-03` và màn chấp nhận, và artifact Pencil — bảng lời mời trong `WSP-03` là dữ liệu **có** projection, khác với cột "Đang chờ lời mời" vừa bị bỏ ở vòng cập nhật design vì lúc đó chưa có khái niệm này.

## Revisit When

- **Chính sách cấp workspace đổi.** Nếu việc tạo workspace bị giới hạn cho một tập actor được duyệt trước, thì phương án tra cứu người dùng đáng được xem lại — lúc đó nó không còn là oracle mở cho mọi người đăng ký. Đó là tiền đề duy nhất đã loại nó, nên tiền đề đổi thì kết luận phải được xem lại.
- **Có retention policy cho dữ liệu cá nhân.** Bảng này lưu email thô của người **chưa** là người dùng. Khi Flowboard có chính sách lưu trữ và xoá, lời mời `revoked` và `accepted` phải nằm trong phạm vi đó.
- **Xuất hiện nhu cầu mời hàng loạt hoặc mời theo tên miền.** Cả hai đổi bề mặt lạm dụng, nên chúng là quyết định khác chứ không phải mở rộng ADR này.
- **Nếu lời mời trở thành đường đăng ký chính** (người dùng mới vào sản phẩm phần lớn qua lời mời), thì quan hệ giữa nó và `AUTH-02` cần được thiết kế lại như một luồng, không phải hai luồng nối nhau.
