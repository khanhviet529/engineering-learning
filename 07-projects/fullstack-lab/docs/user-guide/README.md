# Hướng dẫn sử dụng Flowboard

## Time Tracking (Phase 1.3)

- [Ghi và duyệt giờ theo project](getting-started.md#ghi-và-duyệt-giờ-phase-13) — ghi giờ thực tế hằng ngày, tự chốt hoặc gửi duyệt theo cấu hình Owner.

## Đối tượng và phạm vi

Hướng dẫn này dành cho người dùng cuối của Flowboard: Project Owner, Editor, Viewer và Workspace Admin. Nó giải thích cách dùng các luồng đã được phê duyệt; không thay thế chính sách phân quyền, hợp đồng API hoặc tài liệu thiết kế.

Nội dung hiện tại chỉ mô tả core MVP: workspace, project riêng tư, board có thể cấu hình, task, comment và activity history. Export tiến độ là Phase 1.1; giao report tự động là Phase 1.2; AI, realtime, custom roles, attachments, calendar và ứng dụng mobile không thuộc hướng dẫn MVP này.

## Cách viết guide

Mỗi guide được viết theo cùng cấu trúc để người dùng có thể biết khi nào một luồng áp dụng và kết quả cần mong đợi:

1. **Purpose** — mục tiêu người dùng đạt được.
2. **Prerequisites** — tài khoản, membership hoặc quyền cần có trước khi bắt đầu.
3. **Steps** — các bước thao tác theo thứ tự.
4. **Expected result** — kết quả hệ thống xác nhận khi luồng thành công.
5. **Failure cases** — các trạng thái bị từ chối, hết phiên, xung đột hoặc lỗi mạng và hành động tiếp theo an toàn.
6. **Pencil reference** — Screen ID hoặc flow Pencil sẽ minh họa luồng sau khi thiết kế trực quan được chốt.
7. **Related concepts** — liên kết đến tài liệu giải thích phạm vi, vai trò và hành vi liên quan.

Ngôn ngữ guide dùng động từ thao tác rõ ràng, giải thích outcome theo quyền hiện tại và không hứa một thay đổi đã thành công trước khi server xác nhận. Tên nút, route và hình ảnh chỉ được cập nhật từ nguồn thiết kế đã chốt, không tự suy diễn thêm field hoặc action.

## Quy tắc screenshot và Pencil

Pencil là nguồn chân lý cho bố cục, component trực quan, responsive behavior và screenshot của guide. Sau khi frame Pencil liên quan đạt trạng thái `Ready for build`, guide có thể bổ sung screenshot phiên bản hóa kèm Screen ID, viewport, role/capability outcome và state mà ảnh thể hiện.

Trước mốc đó, guide dùng mô tả văn bản và `Pencil reference`; không dùng ảnh minh họa tạm, không suy diễn giao diện từ Markdown và không để marker screenshot chưa giải quyết. Khi screenshot khác với hành vi đã phê duyệt, cập nhật tài liệu hành vi trước rồi mới cập nhật Pencil và guide.

## Bắt đầu

- [Bắt đầu với Flowboard](getting-started.md) — đăng nhập, vào workspace/project được cấp quyền, đọc action theo role, làm việc với task và xem activity history.

## Glossary

| Thuật ngữ | Nghĩa trong Flowboard |
|---|---|
| Workspace | Ranh giới tenant cấp cao nhất, chứa thành viên workspace và các project. Là thành viên workspace là điều kiện cần, không phải quyền đọc project. |
| Workspace Admin | Vai trò cố định quản lý thành viên/thiết lập workspace và tạo project. Vai trò này không tự cấp quyền vào nội dung project riêng tư. |
| Project | Không gian làm việc riêng tư trong một workspace. Chỉ Project Member được cấp quyền mới đọc được nội dung. |
| Project Owner (Owner) | Vai trò project quản lý cột, thành viên và tên project; đồng thời có toàn bộ action task/comment. Người tạo project trở thành Owner. |
| Editor | Vai trò project có thể tạo, sửa, giao và di chuyển task, cũng như tạo comment; không quản lý cột, thành viên hoặc thiết lập project. |
| Viewer | Vai trò project chỉ đọc board, task, comment và activity history. Viewer không có action ghi dữ liệu. |
| Board | Màn hình làm việc chính của project, hiển thị task theo các cột được Owner cấu hình. |
| Task | Đơn vị công việc thuộc đúng một project và một cột active; có title, description, assignee, priority, due date tùy chọn và version. |
| Activity history | Lịch sử chỉ-ghi-thêm của các thay đổi quan trọng. Người dùng được quyền đọc không sửa hoặc xóa activity. |
| Comment | Thảo luận theo task. Comment là immutable trong MVP: không có sửa hoặc xóa. |
| Capability | Quyền action do server tính cho đúng người dùng và project. UI dùng capability để hiển thị affordance; server vẫn là nơi quyết định cuối cùng. |
| Conflict | Trạng thái `409` khi một task đã thay đổi sau version mà người dùng đang thao tác. Người dùng xem lại bản hiện tại thay vì ghi đè âm thầm. |
| Project membership | Việc một user được thêm tường minh vào một project cùng role Owner, Editor hoặc Viewer. |

## Related concepts

- [Tầm nhìn và phạm vi](../product/vision-and-scope.md) — vòng lặp core MVP và các non-goal.
- [Persona và jobs-to-be-done](../product/personas-and-jobs.md) — nhu cầu và giới hạn của từng vai trò.
- [Hành trình người dùng](../product/user-journeys.md) — outcome thành công và thất bại của Owner, Editor, Viewer và truy cập bị từ chối.
- [Kiến trúc thông tin](../design/information-architecture.md) và [luồng người dùng](../design/user-flows.md) — ngữ cảnh màn hình, state và điều hướng UX.
- [Mô hình phân quyền](../security/authorization-model.md) — nguồn chính thức cho quyền và private-project scope.
