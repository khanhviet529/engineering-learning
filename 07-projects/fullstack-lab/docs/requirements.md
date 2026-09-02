# Requirements

## Functional requirements

### Authentication

- Người dùng có thể đăng ký, đăng nhập và đăng xuất.
- Email phải unique; password không bao giờ được trả về API.
- Session/token phải có expiry và logout phải vô hiệu hóa được phiên hiện tại.

### Workspace and membership

- User tạo được workspace và trở thành `admin`.
- Admin invite/remove member.
- Mỗi request tới resource phải kiểm tra membership ở server.

### Projects and tasks

- Member có quyền xem project được phép truy cập.
- Owner/admin tạo, sửa và archive project.
- Task có title bắt buộc; status, priority và assignee có giá trị hợp lệ.
- Task chỉ được assign cho member của workspace.
- Board hỗ trợ chuyển task giữa ba trạng thái mặc định.

### Comments and activity

- Member có quyền trên project được comment vào task.
- Hệ thống ghi activity cho create/update/status change/assignment/comment.
- Activity không được sửa hoặc xóa qua product UI.

### Task planning and review contract

- `title` là field bắt buộc. `category`, `priority`, `startDate`, `dueDate`, assignee và reviewer là optional trừ reviewer khi cột đích yêu cầu review.
- `priority` chỉ nhận `none`, `low`, `medium`, `high`, `urgent`; `category` chỉ nhận `feature`, `bug`, `design`, `research`, `operations`, `other`.
- Nếu cùng có start/end date thì `startDate <= dueDate`. Server trả `dueState` (`none`, `scheduled`, `due_soon`, `due_today`, `overdue`) theo timezone workspace; terminal task không overdue.
- Owner có thể đánh dấu một board column `requiresReviewer`; move/create vào cột đó cần reviewer là Project Member khác assignee. Cột và terminal state vẫn do Owner cấu hình, không hard-code workflow toàn hệ thống.
- Core MVP không có persisted task draft. Form dirty dùng discard confirmation.

## Non-functional requirements

- API trả lỗi theo contract thống nhất, không lộ stack trace.
- Các write quan trọng có validation và transaction phù hợp.
- List task có pagination; query phải đo được bằng `EXPLAIN` khi dữ liệu lớn.
- UI luôn có loading, empty, error và permission state.
- Mọi mutation có request id để debug xuyên suốt web và API.
- Local setup có thể khởi chạy bằng một command sau khi cài dependency.

## Acceptance criteria cho MVP

1. User A tạo workspace, project và task thành công.
2. User B được invite và chỉ thấy project được cấp quyền.
3. User B không thể gọi API để đọc hoặc sửa project ngoài quyền, kể cả khi biết ID.
4. Hai request sửa cùng task không âm thầm làm mất update; behavior conflict được tài liệu hóa.
5. Activity log phản ánh đúng mutation đã commit.
6. Refresh trang không làm mất dữ liệu; lỗi mạng có thông báo và retry phù hợp.

## Explicit non-goals

- Realtime collaboration/WebSocket trong MVP.
- Custom workflow không giới hạn trạng thái.
- Multi-region, event sourcing và microservices.
- SSO, billing, file storage và mobile clients.
