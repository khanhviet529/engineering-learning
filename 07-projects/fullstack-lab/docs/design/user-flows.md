# Luồng người dùng Flowboard

## Quy ước đọc luồng

Mỗi luồng dưới đây mô tả hành vi MVP mà Pencil và frontend phải cùng biểu đạt. Các quyết định quyền cuối cùng thuộc về server. `Owner`, `Editor`, `Viewer` và `Workspace Admin` chỉ được dùng theo kết quả quyền đã được baseline phê duyệt; tài liệu này không bổ sung vai trò hay quyền mới.

Các mutation chỉ được công bố thành công sau khi server xác nhận. Khi request bị `Forbidden`, `Conflict` hoặc `Error`, UI không được để trạng thái trực quan ngụ ý rằng dữ liệu đã được thay đổi.

## F-AUT-01 — Đăng nhập và phiên làm việc

| Bước | Thành công | Nhánh thất bại hoặc thay thế |
|---|---|---|
| 1. Mở màn hình | Người dùng mở `AUTH-01 Sign In`, focus ở trường email. | Nếu đã có phiên hợp lệ, chuyển về đích hợp lệ gần nhất hoặc `WSP-01 Workspace List`. |
| 2. Nhập và gửi | Client kiểm tra trường bắt buộc, gửi email/mật khẩu; nút hiển thị đang gửi. | Lỗi trường hiển thị cạnh trường; không gửi khi thiếu dữ liệu. |
| 3. Xác thực | Server xác nhận phiên; chuyển tới workspace list hoặc đích quay lại đã được kiểm tra. | Sai thông tin đăng nhập hiển thị `401 UNAUTHENTICATED` generic, không làm lộ tài khoản nào tồn tại. Lỗi mạng là `Error`, giữ giá trị đã nhập trừ mật khẩu theo chính sách bảo mật của form. |
| 4. Trạng thái tài khoản | Nếu email chưa verified, server trả `403 EMAIL_VERIFICATION_REQUIRED` trong error envelope chuẩn, không có session/cookie, CSRF token hay private data. Client xóa password, giữ email chỉ trong state form tạm thời (không đưa vào URL), chuyển tới `AUTH-05 Email Verification` và có thể đề nghị resend. | Không retry sign-in tự động hoặc cho phép đi tới dữ liệu project dựa trên client-side redirect. |
| 5. Hết phiên | Khi request sau đó báo phiên hết hạn, dừng mutation đang chờ, xóa dữ liệu project nhạy cảm trong client và hiển thị `SYS-02 Session expired`. | Người dùng chọn đăng nhập lại; sau đó quay về một đích hợp lệ. Không tự gửi lại mutation cũ. |

`AUTH-02 Sign Up`, `AUTH-03 Password Reset Request`, `AUTH-04 Password Reset Confirm` và `AUTH-05 Email Verification` dùng cùng quy tắc form: Loading khi gửi, Error có thể thử lại, thông báo thành công không tiết lộ dữ liệu người dùng khác. Reset/xác minh với token hết hạn hoặc không hợp lệ hiển thị lỗi rõ ràng và một đường bắt đầu lại luồng tương ứng.

## F-WS-01 — Chọn workspace, tạo project và mở project private

1. Người dùng có phiên mở `WSP-01 Workspace List`. Danh sách ở `Loading` cho đến khi API trả workspace mà họ là thành viên; danh sách rỗng là `Empty` và không suy ra quyền tạo workspace.
2. Chọn một workspace mở `PRJ-01 Project List` trong đúng `workspaceId`. Danh sách chỉ chứa project API đã cho phép đọc. Không hiển thị ô “project private khác” hay count suy đoán từ membership workspace.
3. Workspace Admin thấy CTA tạo project. Gửi `PRJ-02 Project Create` thành công tạo project private và người tạo là Owner của project mới; sau đó chuyển tới `BRD-01 Project Board`.
4. Workspace Member không thấy CTA tạo project. Một request trực tiếp bị từ chối giữ project list hiện tại hoặc đưa tới `Forbidden`, tùy resource mà server xác nhận.
5. Nhấn vào project nạp board của project đó. Nếu membership project bị gỡ, Admin chưa được thêm vào project, URL bị sai hoặc server từ chối, hiển thị `SYS-01 Forbidden`; không render board cũ trong nền.
6. Lỗi mạng khi nạp workspace/project là `Error` với `Thử lại`. Bộ lọc, query và selection chưa xác nhận không được biến thành dữ liệu thành công.

## F-WS-02 — Quản lý thành viên workspace

1. Workspace Admin mở `WSP-03 Workspace Members` từ context workspace.
2. Admin xem danh sách ở Loading/Empty/Error chuẩn, thêm hoặc gỡ thành viên workspace theo phản hồi server.
3. Workspace Member không thấy entry point. Nếu đi trực tiếp vào context này hoặc gửi mutation, server từ chối và UI hiển thị `Forbidden`.
4. Owner muốn thêm một người vào project nhưng người đó chưa là thành viên workspace: `PRM-01 Project Members` báo điều kiện chặn, không tạo project membership nửa chừng và không hiển thị nút cấp quyền thay Workspace Admin. Owner được hướng dẫn rằng Workspace Admin phải hoàn tất membership workspace trước.
5. Thành công tại workspace không tự thêm người đó vào bất kỳ project nào. Sau khi membership workspace hợp lệ, Owner vẫn phải thêm tường minh người đó vào project và chọn vai trò project.

## F-PRJ-01 — Owner cấu hình cột board

1. Owner từ `BRD-01 Project Board` mở `BRD-02 Column Editor`. Panel nạp cột active theo thứ tự; Loading dùng hàng skeleton, Empty nêu rõ board chưa có cột.
2. Owner tạo, đổi tên hoặc sắp xếp lại cột. Lệnh thành công cập nhật thứ tự/cột theo phản hồi server và board phản ánh thứ tự đã xác nhận.
3. Khi archive một cột còn task, server không archive. UI giữ panel mở, nêu rõ phải di chuyển hết task trước; không tự di chuyển task sang cột khác.
4. Editor và Viewer không có CTA. Mở panel qua URL hoặc request trực tiếp là `Forbidden`.
5. Error khi lưu giữ dữ liệu form và cho phép thử lại. Nếu quyền bị thay đổi trong lúc panel mở, đóng/loại bỏ nội dung project nhạy cảm theo `Forbidden` thay vì giữ một editor có thể tiếp tục ghi.

## F-PRJ-02 — Owner quản lý thành viên project

1. Owner mở `PRM-01 Project Members`, thấy thành viên hiện tại, vai trò project và trạng thái Loading/Empty/Error.
2. Owner chọn một thành viên workspace hợp lệ và gán một trong các vai trò Owner, Editor hoặc Viewer. Thành công chỉ cập nhật membership của project hiện tại.
3. Owner đổi vai trò hoặc gỡ thành viên theo phản hồi server. Nếu người dùng đang thao tác chính mình bị gỡ hay hạ quyền, request tiếp theo được server đánh giá lại; client nạp lại capability và bỏ affordance không còn hợp lệ.
4. Không có thao tác trong màn hình này để quản lý membership workspace. Người chưa là thành viên workspace là nhánh chặn của F-WS-02.
5. Editor, Viewer và Workspace Admin chưa có membership project gặp `Forbidden` nếu cố truy cập.

## F-PRJ-03 — Owner đổi tên project trong Project Settings

1. Owner mở `PRJ-03 Project Settings` từ project context. Điều kiện trước là phiên hợp lệ, membership Owner hiện tại và project có thể đọc; entry point không xuất hiện cho Editor, Viewer hoặc Workspace Admin chưa là thành viên project.
2. Màn hình nạp tên project hiện tại cùng capability từ `GET /projects/:projectId`. Trong `Loading`, form không hiển thị giá trị giả; khi có dữ liệu, form chỉ có một trường có thể sửa là `name`.
3. Owner nhập tên mới và gửi. Client kiểm tra `name` bắt buộc sau khi bỏ khoảng trắng đầu/cuối; không đặt quy tắc độ dài/ký tự chưa có hợp đồng. Request chỉ gửi `name` qua `PATCH /projects/:projectId`.
4. Khi `Saving`, khóa submit mâu thuẫn nhưng giữ giá trị form. Server xác nhận thành công cập nhật tên ở Project Settings, header/breadcrumb và dữ liệu project đã nạp; form trở thành sạch và thông báo thành công không tự điều hướng Owner khỏi trang.
5. Nếu validation server hoặc Error xảy ra, giữ form mở và giá trị name để Owner sửa hoặc thử lại; không đổi tên trong board/project list theo kiểu lạc quan.
6. Nếu Owner rời trang khi name đã thay đổi mà chưa lưu, hiển thị xác nhận unsaved changes. `Tiếp tục chỉnh sửa` là focus mặc định; `Bỏ thay đổi` quay về board mà không gửi PATCH.
7. Nếu server trả Forbidden vì membership/role đã đổi, bỏ dữ liệu project cached và chuyển `SYS-01 Forbidden`. Editor, Viewer và Workspace Admin chưa là project member đi trực tiếp tới route hoặc gọi PATCH cũng nhận Forbidden; không có tên project hay thay đổi nào được xác nhận cho họ.
8. Không có field hay action nào khác trong flow này: không description, visibility, xóa/archiving project hoặc thao tác project settings khác.

## F-TSK-01 — Tạo và giao task

1. Owner hoặc Editor từ board mở `TSK-01 Task Form` ở context cột đích. Cột mặc định phải thuộc project đang mở; danh sách assignee chỉ gồm thành viên project do API trả.
2. Người dùng nhập title bắt buộc, mô tả, assignee, category, priority, ngày bắt đầu/ngày kết thúc tùy chọn. Khi cột đích yêu cầu reviewer, form/luồng move yêu cầu reviewer khác assignee. Form hiển thị validation trước khi gửi và lỗi server ngay tại trường/bề mặt phù hợp.
3. Nếu có cả ngày bắt đầu và ngày kết thúc, validation báo lỗi tại ngày kết thúc khi ngày bắt đầu muộn hơn; dấu `*` đỏ chỉ đánh dấu field required, không làm toàn bộ field đỏ khi chưa lỗi. Form không có save-draft persisted; rời form dirty đi qua discard confirmation.
3. Khi gửi, form vào trạng thái đang lưu. Sau phản hồi thành công, task xuất hiện ở cột server xác nhận, drawer/modal đóng và focus trở về CTA/card phù hợp.
4. Error không đóng form hoặc xóa nội dung; người dùng có thể sửa rồi gửi lại. Nếu request không còn hợp lệ do quyền, chuyển sang Forbidden và không khẳng định task đã được tạo.
5. Viewer không có đường mở form. Nếu biết route/query hay gọi request trực tiếp, server từ chối và project không thay đổi.

## F-TSK-02 — Mở task, cập nhật, comment và xem activity

1. Người có membership project mở task card. `TSK-02 Task Detail` nạp task, comment immutable và activity append-only trong drawer/modal trên board.
2. Owner/Editor có thể vào chế độ sửa và tạo comment; Viewer chỉ đọc. Các khu vực không có dữ liệu thành công hiển thị Empty riêng, ví dụ task chưa có comment hoặc activity phù hợp.
3. Lưu task sử dụng `version` đang đọc. Nếu thành công, drawer hiển thị dữ liệu server trả về, version mới và activity mới liên quan.
4. Nếu có `409 Conflict`, không ghi đè. Chuyển sang `SYS-04 Conflict Resolution`: tải lại để xem bản hiện tại, giữ bản nháp cục bộ để người dùng có thể tham chiếu hoặc sao chép, rồi yêu cầu họ chủ động áp dụng lại thay đổi trên phiên bản mới.
5. Comment ở trạng thái đang gửi không được trình bày như đã được ghi vĩnh viễn. Error giữ nội dung comment để thử lại an toàn; Forbidden hoặc session hết hạn không tạo comment và bỏ dữ liệu private khi cần.
6. Đóng drawer khi form bẩn phải qua xác nhận unsaved changes. Đóng thành công trả focus về task card gốc, kể cả sau Error hay Conflict đã được giải quyết/hủy.

## F-TSK-03 — Di chuyển task trên board

1. Owner hoặc Editor bắt đầu kéo task bằng chuột/cảm ứng hoặc bàn phím. Board công bố cột/vị trí nguồn và chỉ đánh dấu mục tiêu trong project hiện tại.
2. Khi thả vào cột/vị trí hợp lệ, task di chuyển lạc quan trong UI và có trạng thái đang đồng bộ. Request gửi cột đích, vị trí mục tiêu và version của task theo hợp đồng mutation.
3. Server xác nhận: thay thế dữ liệu lạc quan bằng thứ tự/version server trả về, kết thúc trạng thái đang đồng bộ. Activity có đúng một dấu vết cho lần di chuyển thành công.
4. Error mạng/dịch vụ: hoàn nguyên task về cột/vị trí nguồn đã chụp, giữ focus ở card, thông báo Error và cho phép thử lại từ thao tác mới. Không để bản sao ở hai cột.
5. `409 Conflict`: hoàn nguyên snapshot lạc quan, nạp lại task/board trong phạm vi còn được phép và mở Conflict Resolution. Không gửi lại hay “force move” tự động.
6. Forbidden hoặc session hết hạn: hoàn nguyên; xóa dữ liệu project nếu quyền đọc không còn; không lộ thứ tự hay nội dung task sau khi chuyển sang state hệ thống.
7. Viewer không có drag handle, keyboard drag hay thao tác move.

## F-DATA-01 — Lọc, tìm kiếm, sắp xếp và tải thêm

1. Board nhận filter, sort và search chỉ trong các trường được cho phép. Đổi điều kiện làm mới cursor của từng cột; kết quả cũ không được ghép vào query mới.
2. Mỗi cột nạp trang đầu có giới hạn; nếu `hasMore`, hiển thị `Tải thêm` ở chính cột đó. Người dùng có thể nạp thêm độc lập từng cột.
3. Loading trang đầu dùng skeleton; Loading thêm giữ card đã nạp và hiển thị tiến trình ở chân cột. Empty phân biệt “cột chưa có task” với “không có task khớp filter”.
4. Error trang đầu giữ Error của vùng board. Error khi tải thêm giữ card hiện có, cursor đang thất bại và CTA thử lại tại cột; không tăng cursor hay tạo card trùng.
5. Khi filter làm task đang mở không còn thuộc kết quả board, task detail chỉ đóng sau khi user đóng hoặc dữ liệu task bị từ chối; không tự suy ra rằng task đã bị xóa.

## F-SYS-01 — Truy cập bị từ chối và khôi phục ngữ cảnh

1. Một người chưa có phiên được đưa qua Sign In; không trả nội dung project trước đó.
2. Một người có phiên nhưng không có membership project, bao gồm Workspace Admin chưa được thêm, thấy `SYS-01 Forbidden` với ngôn ngữ không xác nhận project tồn tại ngoài context đã biết.
3. `Forbidden` có hành động quay lại danh sách workspace/project được phép nạp lại từ server. Nó không có CTA yêu cầu quyền, chia sẻ project hay thử lại mutation vô hạn.
4. Nếu quyền thay đổi khi người dùng đang xem board, request kế tiếp là điểm quyết định. Client dừng tương tác ghi, xóa cache private của project đó và render Forbidden.

## Phạm vi cần thể hiện trong Pencil

Pencil phải có cả nhánh thành công và thất bại cho những luồng trên: Loading, Empty, Error, Forbidden, Session expired, Conflict, validation, form bẩn, phân trang/tải thêm, drag-and-drop, thao tác lạc quan và board ngang trên màn hình nhỏ. Không dùng frame cho reports hay AI trong bộ MVP này.
