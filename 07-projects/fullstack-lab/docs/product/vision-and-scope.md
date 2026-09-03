# Tầm nhìn và phạm vi Flowboard

## Mục đích

Nhóm nhỏ thường chia công việc giữa tin nhắn, bảng tính tạm thời và ghi chú cá nhân. Khi đó, các câu hỏi cơ bản — việc nào cần làm, ai chịu trách nhiệm, việc đã đổi ra sao và vì sao bị chặn — không có một câu trả lời đáng tin cậy.

**Flowboard là workspace quản lý công việc riêng tư theo từng project, giúp nhóm product và engineering 2–15 người lập kế hoạch, thực thi trên board, trao đổi đúng ngữ cảnh và xem lại lịch sử thay đổi quan trọng.**

Sản phẩm hướng tới một project workspace tập trung, không phải bộ công cụ quản trị danh mục hay vận hành doanh nghiệp.

## Nguyên tắc sản phẩm

- Project là riêng tư theo mặc định. Có mặt trong workspace không đồng nghĩa có quyền đọc một project.
- Quyền trong project là cố định: **Owner**, **Editor** và **Viewer**. Giao diện chỉ hiển thị hành động phù hợp với quyền, nhưng API và truy vấn dữ liệu mới là nơi quyết định cho phép hay từ chối.
- Một tính năng chỉ thuộc core MVP khi nó hoàn tất hoặc bảo vệ trực tiếp vòng lặp quản lý công việc chính. Tính năng tạo thêm cách làm việc mới nhưng không cần để hoàn tất vòng lặp phải được hoãn.
- Board là màn hình làm việc chính; chi tiết task, comment và activity phải giữ được ngữ cảnh của board.

## Vòng lặp quản lý công việc chính

Core MVP chỉ cam kết hoàn tất luồng sau:

```text
Đăng nhập
→ mở workspace
→ tạo hoặc mở project mà người dùng được cấp quyền
→ cấu hình cột board
→ thêm thành viên project
→ tạo và giao task
→ di chuyển task qua board
→ bình luận và xem activity history
```

Một tính năng được đưa vào MVP khi đáp ứng cả hai điều kiện:

1. Người dùng cần nó để đi hết luồng trên một cách an toàn và có trách nhiệm rõ ràng; hoặc
2. Không có nó thì quyền riêng tư, tính đúng đắn dữ liệu, khả năng xử lý lỗi hay dấu vết thay đổi của luồng trên bị phá vỡ.

Ví dụ, phân quyền theo project, xử lý xung đột khi cập nhật task và activity history thuộc MVP vì chúng bảo vệ luồng chính. Realtime hay AI không thuộc MVP vì luồng vẫn hoàn tất mà không cần chúng.

## Phạm vi core MVP

| Nhóm năng lực | Cam kết có trong MVP | Tiêu chí chấp nhận ở mức sản phẩm |
|---|---|---|
| Tài khoản | Đăng ký, đăng nhập, đăng xuất, đặt lại mật khẩu và xác minh email bằng email/mật khẩu. | Người dùng có thể vào và rời phiên làm việc; các trạng thái chưa xác minh hoặc cần đặt lại mật khẩu không cấp quyền truy cập project trái phép. |
| Workspace và project | Workspace, thành viên workspace và project riêng tư bên trong workspace. | Chỉ người là thành viên workspace mới có thể trở thành thành viên project; project không xuất hiện hoặc trả dữ liệu cho người không được thêm vào project đó. |
| Vai trò project | Owner, Editor, Viewer cho từng project. | Owner quản lý cột, thành viên và thiết lập project; Owner và Editor tạo/sửa/di chuyển/giao task, tạo comment; Viewer chỉ đọc board, task, comment và activity. |
| Board | Cột có thể cấu hình theo project; task có tiêu đề, mô tả, cột, người được giao, độ ưu tiên, hạn tùy chọn và phiên bản đồng thời. | Owner có thể sắp xếp board cho project; task chỉ được đặt hoặc giao trong đúng project; cập nhật cũ không được âm thầm ghi đè cập nhật mới hơn. |
| Cộng tác trong ngữ cảnh | Comment và activity history chỉ-ghi-thêm. | Owner/Editor có thể để lại comment; Viewer đọc được nhưng không thay đổi dữ liệu; activity cho biết các thay đổi quan trọng; comment MVP không sửa hoặc xóa. |
| Khả năng dùng được | Danh sách có phân trang, lọc, sắp xếp và tìm kiếm trong trường được cho phép; giao diện có trạng thái loading, empty, lỗi mạng, conflict và permission denied. | Một project lớn không buộc tải toàn bộ task cùng lúc; khi thiếu quyền, có xung đột hoặc mất mạng, người dùng nhận được trạng thái rõ ràng thay vì thấy dữ liệu sai hoặc mất thay đổi. |

## Ràng buộc về quyền riêng tư

- Project luôn cần danh sách thành viên riêng. Quyền workspace không thay thế thành viên project.
- Workspace Admin chỉ quản lý thành viên và thiết lập ở cấp workspace, đồng thời có thể tạo project; vai trò này **không có quyền ngầm định** để đọc hoặc sửa project riêng tư.
- Muốn vào một project riêng tư, kể cả Workspace Admin phải được thêm tường minh vào danh sách thành viên project. Người tạo project trở thành Project Owner.
- Viewer không có đường đi hợp lệ để ghi dữ liệu. Việc ẩn nút trên UI không đủ: mọi yêu cầu trực tiếp cũng phải bị từ chối.

## Addendum: task planning and personal planning views

Task MVP có creator, assignee, category fixed, priority fixed, start/end date optional và reviewer điều kiện. `overdue` là derived display/filter state theo timezone workspace, không là board status. Owner cấu hình column nào cần reviewer; workflow này không tạo role mới và không bắt buộc với mọi project. Task draft persisted không thuộc MVP.

MVP mở rộng thêm `My Tasks` list/calendar và Project Dashboard chỉ đọc. Hai view này dùng cùng Task/Activity data đã authorized, không có bảng planning riêng trong core MVP (Sprint là lớp planning riêng của Phase 1.4), không có recurring task, notification, dependency, attachment hay custom field. Dashboard chỉ trả aggregate project-scoped; My Tasks chỉ trả task mà actor được phép đọc và được giao cho actor.

## Phase 1.5: quan hệ giữa Task

Subtask và phụ thuộc không thuộc core MVP; chúng là Phase 1.5, sau Sprint. Subtask là một Task đầy đủ có cha, **sâu đúng một cấp** (task đã có cha không làm cha của task khác), nên vẫn gán được người, di chuyển được trên board và ghi giờ được như mọi task. Phụ thuộc chỉ có một loại là blocking, có chống chu trình, và **không** chặn việc move: blocking là thông tin cảnh báo, không phải cưỡng chế.

Cây nhiều tầng, epic, quan hệ ngoài blocking, phụ thuộc xuyên project, critical path và Gantt không thuộc Phase 1.5.

## Phase 1.4: Sprint theo project

Sprint không thuộc core MVP. Đây là lớp **planning** tùy chọn do Owner bật cho từng project: sprint có tên, mục tiêu, khoảng ngày và vòng đời `planned → active → closed`, mỗi project có tối đa một sprint đang active. Task gán vào sprint qua chính task update; `sprintId` rỗng nghĩa là **backlog**, nên sprint không bao giờ bắt buộc và backlog vẫn là nơi hợp lệ để ý tưởng nằm chờ.

Story point/estimation, velocity, burndown, capacity planning, auto-rollover, sprint xuyên project và báo cáo giờ theo sprint không thuộc Phase 1.4. Sprint không suy ra `startDate`/`dueDate` của task và không đổi `dueState`.

## Phase 1.3: Time Tracking theo project

Time Tracking không thuộc core MVP. Đây là module tùy chọn do Owner bật cho từng project sau khi vòng lặp task riêng tư đã ổn định. Module có WorkLog theo user–task–ngày, tổng giờ tháng và hai chế độ: thành viên tự chốt hoặc gửi Owner/Editor được chỉ định duyệt. Owner cấu hình approver và thời hạn ghi bù; Viewer vẫn chỉ đọc. Task start/end date là kế hoạch, không được dùng để suy ra giờ thực tế.

Timer, payroll, billing, invoice, time export, email, queue, worker, custom role và quyền Workspace Admin vào project riêng tư không thuộc Phase 1.3.

## Không thuộc core MVP

Các mục sau bị loại trừ có chủ đích, không phải hạng mục còn thiếu của bản phát hành đầu:

- AI, realtime collaboration và custom roles;
- labels, checklists, recurring tasks và templates;
- calendar/daily-planning views, attachments, public API, billing và ứng dụng mobile;
- microservices, multi-region deployment và tự động gửi email báo cáo.

Export tiến độ do Owner tải xuống là Phase 1.1; gửi báo cáo theo lịch hoặc theo yêu cầu là Phase 1.2. AI chỉ bắt đầu sau core MVP, theo các phase có biên an toàn riêng.

## Tín hiệu thành công

Các tín hiệu dưới đây là tiêu chí quan sát để đánh giá MVP, không phải cam kết KPI số học trước khi có dữ liệu sử dụng:

- Một Owner có thể thiết lập một project riêng tư, cấu hình board, thêm đúng thành viên và đưa ít nhất một task vào luồng làm việc mà không cần công cụ theo dõi bên ngoài.
- Một Editor có thể hoàn tất công việc hằng ngày: tạo hoặc cập nhật task, giao việc, di chuyển task, comment và kiểm tra activity trong project được cấp quyền.
- Một Viewer có thể theo dõi tiến độ và lịch sử mà không có khả năng làm thay đổi project.
- Một người không là thành viên project — bao gồm Workspace Admin chưa được thêm — không thể suy ra nội dung project từ UI, API hay dữ liệu trả về.
- Khi hai người cùng cập nhật một task, hệ thống chỉ chấp nhận cập nhật hợp lệ; người có dữ liệu cũ được yêu cầu tải lại/xem xét thay vì vô tình ghi đè thay đổi mới hơn.

## Điều kiện hoàn tất phạm vi MVP

Core MVP chỉ được coi là hoàn tất khi có thể chứng minh toàn bộ vòng lặp chính cho Owner, Editor và Viewer, đồng thời chứng minh các trường hợp bị từ chối quyền và xung đột không làm lộ dữ liệu hoặc mất thay đổi. Hoàn thành CRUD đơn lẻ không thay thế được điều kiện này.
