# Bắt đầu với Flowboard

## Ghi và duyệt giờ (Phase 1.3)

Khi Owner bật Time Tracking cho project, Owner/Editor có thể mở **Nhật ký giờ của tôi**, chọn task, ngày làm, số giờ và mô tả đã hoàn thành. Nếu log vào task không giao cho mình, nhập thêm lý do hỗ trợ. Ngày ngoài cửa sổ ghi bù không lưu được cho đến khi Owner mở quyền ghi bù cho đúng ngày.

Project ở chế độ **Tự chốt** tính log ngay khi author chốt. Ở chế độ **Cần duyệt**, author gửi log và Owner hoặc Editor được chỉ định duyệt/trả lại; không ai tự duyệt log của chính mình. Báo cáo giờ tháng chỉ tính log cuối cùng đã được chốt/duyệt, đồng thời cho biết phần đang chờ hoặc bị trả lại.

## Purpose

Hướng dẫn này giúp một người dùng bắt đầu vòng lặp core MVP: đăng nhập, vào workspace và project riêng tư được cấp quyền, hiểu action theo role, tạo hoặc mở task, rồi xem activity history.

## Prerequisites

- Bạn có tài khoản email/mật khẩu Flowboard hợp lệ và đã hoàn tất yêu cầu xác minh email khi hệ thống yêu cầu.
- Bạn đã có hoặc có thể tạo/join một workspace. Chỉ Workspace Admin được tạo project; thành viên workspace thường chỉ thấy project mà họ đã được thêm tường minh.
- Để mở nội dung project, bạn phải là Project Member với role Owner, Editor hoặc Viewer. Là Workspace Admin không tự tạo quyền đọc một project riêng tư.
- Nếu bạn cần tạo hoặc chỉnh sửa task/comment, role của bạn phải là Owner hoặc Editor trong đúng project đó.

## Steps

### 1. Đăng nhập

1. Mở màn hình Sign In và nhập email cùng mật khẩu.
2. Gửi thông tin đăng nhập và chờ hệ thống xác nhận phiên làm việc.
3. Sau khi thành công, mở Workspace List hoặc đích quay lại hợp lệ mà bạn đã yêu cầu trước đó.

Không chia sẻ cookie phiên hoặc thông tin đăng nhập. Khi đăng xuất, đổi hoặc đặt lại mật khẩu, phiên hiện tại có thể kết thúc và bạn cần đăng nhập lại.

### 2. Tạo hoặc join workspace

1. Tại Workspace List, chọn workspace mà bạn đã là thành viên.
2. Nếu danh sách rỗng và hệ thống cho phép tạo workspace, tạo workspace mới theo luồng được cung cấp.
3. Nếu bạn cần vào workspace hiện có, Workspace Admin của workspace đó phải thêm bạn vào membership workspace.

Membership workspace không làm bạn thấy mọi project. Project riêng tư chỉ xuất hiện sau khi bạn được thêm tường minh vào project đó.

### 3. Mở project được cấp quyền

1. Trong workspace, mở Project List.
2. Chọn project xuất hiện trong danh sách được cấp quyền của bạn.
3. Dùng Project Board để xem cột và task đã tải cho project đó.

Nếu nhận một URL project/task từ người khác nhưng không có project membership, Flowboard không hiển thị nội dung riêng tư. Hãy liên hệ Project Owner để được thêm vào project với role phù hợp; Workspace Admin chỉ có thể giải quyết membership workspace, không tự mở project cho bạn.

### 4. Hiểu action theo role

| Role trong project | Bạn có thể làm trong core MVP | Bạn không thể làm |
|---|---|---|
| Owner | Đọc project; tạo/sửa/di chuyển/giao task; tạo comment; quản lý cột, thành viên và tên project. | Không tự cấp quyền cho người chưa là thành viên workspace. |
| Editor | Đọc project; tạo/sửa/di chuyển/giao task; tạo comment. | Quản lý cột, thành viên hoặc tên project. |
| Viewer | Đọc board, task, comment và activity history. | Tạo, sửa, di chuyển hoặc giao task; tạo comment; quản lý project. |
| Workspace Admin chưa là Project Member | Quản lý membership/thiết lập workspace và tạo project. | Đọc hoặc thay đổi nội dung của project riêng tư. |

Flowboard chỉ hiển thị action phù hợp với capability server trả về. Việc một nút không xuất hiện không phải là bằng chứng duy nhất về quyền; server vẫn kiểm tra mọi request.

### 5. Tạo hoặc mở task

1. Owner hoặc Editor mở action tạo task từ board của project được cấp quyền.
2. Nhập title bắt buộc; khi cần, thêm description, assignee là thành viên cùng project, category, priority, ngày bắt đầu và ngày kết thúc dạng ngày tùy chọn. Nếu có cả hai ngày, ngày bắt đầu không được muộn hơn ngày kết thúc.
3. Chọn reviewer khi task được tạo hoặc chuyển vào cột yêu cầu duyệt. Reviewer phải là thành viên project khác người thực hiện.
3. Chọn một cột active của chính project đó, gửi form và chờ server xác nhận.
4. Để xem task có sẵn, chọn task card trên board. Task detail mở trong drawer hoặc modal để vẫn giữ ngữ cảnh board.
5. Owner hoặc Editor có thể cập nhật, giao hoặc di chuyển task. Viewer chỉ đọc chi tiết task.

Khi task đang được người khác thay đổi, Flowboard có thể báo Conflict. Hãy xem bản hiện tại, giữ hoặc sao chép bản nháp cần thiết, rồi chủ động thực hiện lại thay đổi trên version mới. Không có thao tác force overwrite trong MVP.

### 6. Xem activity history

1. Mở Task Detail của một task trong project bạn được quyền đọc.
2. Chọn vùng Activity history để xem các thay đổi quan trọng của task theo thứ tự thời gian.
3. Dùng activity cùng comment để hiểu bối cảnh trước khi tiếp tục công việc hoặc review tiến độ.

Activity history là append-only. Owner, Editor và Viewer có thể đọc activity của project được cấp quyền nhưng không sửa hoặc xóa bản ghi.

## Expected result

Sau khi hoàn tất, bạn đang ở một project riêng tư mà bạn được cấp quyền, biết action nào phù hợp với role hiện tại, có thể mở task và — nếu là Owner hoặc Editor — tạo task đầu tiên. Bạn cũng biết mở Activity history để kiểm tra dấu vết thay đổi mà không rời ngữ cảnh board.

## Failure cases

| Tình huống | Flowboard làm gì | Hành động an toàn của bạn |
|---|---|---|
| Sai thông tin đăng nhập hoặc token đặt lại/xác minh không hợp lệ | Hiển thị lỗi không tiết lộ tài khoản nào tồn tại. | Kiểm tra thông tin, thử lại hoặc bắt đầu lại luồng đặt lại/xác minh phù hợp. |
| Session expired | Dừng mutation đang chờ, xóa dữ liệu project nhạy cảm đã cache và yêu cầu đăng nhập lại. | Đăng nhập lại; không kỳ vọng hệ thống tự gửi lại thay đổi cũ. |
| Bạn không có project membership hoặc quyền action | Không trả nội dung private hoặc từ chối action. | Liên hệ Project Owner để được thêm đúng role; không dùng URL/ID để cố truy cập lại. |
| Người cần thêm vào project chưa là thành viên workspace | Chặn việc tạo membership project dở dang. | Nhờ Workspace Admin thêm người đó vào workspace trước, sau đó Owner thêm họ vào project. |
| Lỗi mạng hoặc dữ liệu chưa tải | Hiển thị Loading, Empty hoặc Error rõ ràng; không xác nhận thay đổi chưa được server chấp nhận. | Thử lại khi phù hợp và giữ form/bản nháp khi giao diện còn cho phép. |
| Task conflict (`409`) | Không ghi đè thay đổi mới hơn; cung cấp đường xem lại bản hiện tại. | Xem lại task, áp dụng lại thay đổi một cách chủ động hoặc hủy bản nháp. |

## Pencil reference

Sau khi Pencil được chốt, hướng dẫn này được minh họa bởi các Screen ID và flow sau: `AUTH-01 Sign In`, `WSP-01 Workspace List`, `PRJ-01 Project List`, `BRD-01 Project Board`, `TSK-01 Task Form`, `TSK-02 Task Detail`, `SYS-01 Forbidden`, `SYS-02 Session expired` và `SYS-04 Conflict Resolution`; cùng `F-AUT-01`, `F-WS-01` và flow task/activity liên quan. Screenshot chỉ được bổ sung theo quy tắc trong [user-guide index](README.md#quy-tắc-screenshot-và-pencil).

## Related concepts

- [Hành trình người dùng](../product/user-journeys.md) — chi tiết journey setup, daily work, review và denied access.
- [Luồng người dùng](../design/user-flows.md) — state loading/error/forbidden/session/conflict và hành vi thao tác.
- [Đặc tả tương tác](../design/interaction-specifications.md) — form, optimistic update, conflict, phân trang và accessibility.
- [Mô hình phân quyền](../security/authorization-model.md) — capability, role và object-level authorization chính thức.
- [Hệ thống thiết kế](../design/design-system.md) — quy ước visual và state mà Pencil thể hiện.
