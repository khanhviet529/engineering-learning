# Kiến trúc thông tin Flowboard

## Mục đích và ranh giới

Tài liệu này xác định nơi người dùng đi, ngữ cảnh nào phải còn nguyên và hành động nào được thấy trong core MVP. Nó giúp Pencil bố cục màn hình mà không tự suy ra quyền, endpoint hay tính năng mới.

Flowboard là workspace quản lý công việc theo project riêng tư. Board là nơi làm việc chính; mở task phải giữ người dùng trong ngữ cảnh board bằng drawer hoặc modal. Báo cáo, AI, realtime, custom roles, attachments, calendar và ứng dụng mobile không có màn hình hay điều hướng trong core MVP.

Các kết quả quyền trong tài liệu này chỉ là hợp đồng UX:

- Owner đọc và thực hiện các thao tác project, task, comment; đồng thời quản lý cột, thành viên project và thiết lập project.
- Editor đọc project và tạo, sửa, giao, di chuyển task; tạo comment; không quản lý cột, thành viên hay thiết lập project.
- Viewer chỉ đọc board, task, comment và activity.
- Workspace Admin quản lý thành viên/thiết lập workspace và có thể tạo project, nhưng không tự đọc một project private. Admin phải là thành viên tường minh của project và dùng đúng vai trò project đã được cấp.

UI chỉ dùng capability do server trả về để hiện hoặc ẩn affordance. API và lớp dữ liệu vẫn là nơi quyết định cho phép hay từ chối; tài liệu này không phải catalog quyền chính thức.

## Cây điều hướng MVP

```text
Authentication
├── Đăng nhập
├── Đăng ký
├── Yêu cầu đặt lại mật khẩu
├── Đặt lại mật khẩu
└── Xác minh email

Workspace
├── Danh sách workspace
├── Tạo workspace
├── Thành viên workspace                 [Workspace Admin]
├── Thiết lập workspace                  [Workspace Admin; không tự mở project]
└── Project của workspace
    ├── Danh sách project được cấp quyền
    ├── Tạo project                      [Workspace Admin]
    └── Project private được cấp quyền
        ├── Tổng quan project             [mọi role; CTA Xuất tiến độ gated `report:export`]
        ├── Board
        │   ├── Bộ lọc, tìm kiếm, sắp xếp và tải thêm theo cột
        │   ├── Tạo/sửa task              [Owner, Editor]
        │   ├── Chi tiết task
        │   │   ├── Comment               [tạo: Owner, Editor]
        │   │   └── Activity history      [chỉ đọc]
        │   └── Quản lý cột               [Owner]
        ├── Thành viên project            [Owner]
        └── Project Settings               [Owner; chỉ đổi tên project]

Hệ thống
├── Forbidden
├── Session expired
├── Error mạng/dịch vụ
└── Conflict Resolution
```

`Thiết lập workspace` chỉ là điểm điều hướng dành cho Workspace Admin theo baseline. Chưa có trường hay hành động chi tiết nào được xác định ở đây; Pencil không được tự vẽ form cài đặt hoặc thao tác lưu cho đến khi có hợp đồng dữ liệu tương ứng.

`PRJ-04 Tổng quan project` (`/projects/:projectId/overview`) là điểm điều hướng cấp project ngang hàng với Board, mở được cho cả Owner, Editor và Viewer vì nó chỉ đọc aggregate đã được authorize. Nó phải có mặt trong nav vì [RPT-01](screen-inventory.md) — CTA `Xuất tiến độ` của Phase 1.1 — sống trên chính màn này; không có đường vào Tổng quan thì luồng export không có entry point nào. Bản thân CTA vẫn gated theo capability `report:export` (Owner, Phase 1.1), nên nav item mở cho mọi role không cấp thêm quyền gì.

`PRJ-03 Project Settings` là một hợp đồng khác: Owner mở màn hình này từ project được cấp quyền để đổi **duy nhất tên project**. Form chỉ nạp/tạo một trường `name` và gửi `PATCH /projects/:projectId` với trường đó. Nó không có description, visibility, thao tác xóa/archiving project hay bất kỳ setting chưa được baseline xác định.

## Mô hình ngữ cảnh

| Ngữ cảnh | Khóa nhận diện | Nội dung phải giữ | Quy tắc riêng tư |
|---|---|---|---|
| Phiên | người dùng đã xác thực | đích quay lại sau đăng nhập, thông báo phiên | Không hiển thị dữ liệu private trước khi phiên hợp lệ. |
| Workspace | `workspaceId` | workspace đang chọn, vai trò workspace, danh sách project được phép thấy | Thành viên workspace là điều kiện cần, không phải quyền đọc project. |
| Project | `projectId` | tên project, thành viên project, vai trò/capability server trả về, board | Chỉ nạp sau khi kiểm tra membership project cho đúng resource. |
| Board | `projectId` + query đang áp dụng | cột đang hoạt động, task đã nạp theo từng cột, filter/sort/search, cursor mỗi cột | Không trộn task hoặc assignee giữa các project. |
| Task | `taskId` trong project | task, `version`, comment, activity, vị trí trả focus trên board | Task detail không được làm mất filter, vị trí cuộn hay cột gốc của board. |

Một URL đến project hoặc task luôn phải được đánh giá lại ở server. Nếu membership đã thay đổi, UI bỏ dữ liệu cũ của project và chuyển sang `Forbidden`, không dựa vào dữ liệu đã có trong bộ nhớ trình duyệt.

## Khung ứng dụng và vị trí thao tác

1. Sau xác thực, thanh đầu trang giữ bộ chọn workspace, đường dẫn ngữ cảnh và menu phiên. Không có project switcher nào được điền bằng project mà người dùng không có quyền đọc.
2. Trang workspace đặt danh sách project làm nội dung chính. Nút tạo project chỉ xuất hiện khi server cho biết người dùng là Workspace Admin của workspace đó.
3. Trang board đặt tên project, bộ lọc/tìm kiếm/sắp xếp và thao tác được phép ở đầu vùng nội dung. Cột board là nội dung chính; không có sidebar thay thế board.
4. Column editor, task form, task detail và project members là lớp phủ có ngữ cảnh project/board rõ ràng. Đóng lớp phủ trả focus về phần tử đã mở nó.
5. Project Settings là route riêng của project, chỉ Owner thấy entry point ở project context. Nó có đường quay lại board và không làm thay đổi filter/cursor board đã có.
6. Comment và activity history là hai vùng trong task detail, không phải màn hình điều hướng độc lập. Viewer nhìn thấy hai vùng chỉ-đọc.

## Quy ước route và lớp phủ

Các route dưới đây là định danh UX ổn định. Tên thư mục Next.js cụ thể có thể triển khai tương đương, nhưng không đổi ý nghĩa hoặc ID màn hình.

| Vùng | Route hoặc route context | Ghi chú hành vi |
|---|---|---|
| Authentication | `/sign-in`, `/sign-up`, `/password/forgot`, `/password/reset`, `/email/verify` | URL có thể mang đích quay lại đã được kiểm tra an toàn; không mang ID project để cấp quyền. |
| Workspace | `/workspaces`, `/workspaces/:workspaceId` | `/workspaces/:workspaceId` là context danh sách project. |
| Project board | `/projects/:projectId/board` | Filter, sort, search và cursor là query state có thể chia sẻ; không đưa dữ liệu private vào URL. |
| Project Settings | `/projects/:projectId/settings` | `PRJ-03` là trang Owner-only; nạp tên/capability project và chỉ cập nhật `name` bằng `PATCH /projects/:projectId`. |
| Task detail | `/projects/:projectId/board?task=:taskId` | Mở drawer/modal trên board; deep link phải tải lại và kiểm tra cả project lẫn task. |
| Task form | context board với `task=new` hoặc `task=:taskId&edit=1` | Là lớp phủ; form mới không được xuất hiện cho Viewer. |
| Column editor | context board với `panel=columns` | Là lớp phủ chỉ Owner. |
| Project members | context project với `panel=members` | Là lớp phủ hoặc trang con chỉ Owner. |
| System | route đã yêu cầu hoặc context thao tác | `Forbidden`, `Session expired`, `Error` và `Conflict` giữ đủ ngữ cảnh để người dùng biết cách quay lại hoặc xem lại. |

## Điều hướng theo vai trò và trạng thái

| Bề mặt | Owner | Editor | Viewer | Workspace Admin chưa là thành viên project |
|---|---|---|---|---|
| Danh sách project của workspace | Thấy project được cấp quyền | Thấy project được cấp quyền | Thấy project được cấp quyền | Chỉ thấy project mà chính Admin đã được thêm; có thể tạo project nếu là Admin. |
| Board và task detail | Đọc, có affordance ghi dữ liệu | Đọc, có affordance ghi dữ liệu task/comment | Đọc, không có affordance ghi dữ liệu | `Forbidden`; không hiển thị nội dung private. |
| Project Settings | Truy cập; chỉ đổi tên project | Không hiển thị; URL trực tiếp là `Forbidden` | Không hiển thị; URL trực tiếp là `Forbidden` | `Forbidden` nếu chưa có membership project. |
| Column editor | Truy cập | Không hiển thị; URL trực tiếp là `Forbidden` | Không hiển thị; URL trực tiếp là `Forbidden` | `Forbidden` nếu chưa có membership project. |
| Sprint board và Backlog (Phase 1.4) | Truy cập khi project đã bật Sprint | Truy cập khi project đã bật Sprint | Truy cập chỉ đọc khi project đã bật Sprint | `Forbidden` nếu chưa có membership project |
| Sprint settings và đóng sprint (Phase 1.4) | Truy cập | Không hiển thị; URL trực tiếp là `Forbidden` | Không hiển thị; URL trực tiếp là `Forbidden` | `Forbidden` nếu chưa có membership project |
| Quan hệ task: cha–con và blocker (Phase 1.5) | Đọc và sửa qua `task:update` | Đọc và sửa qua `task:update` | Chỉ đọc, không có affordance sửa quan hệ | `Forbidden` nếu chưa có membership project |
| Project members | Truy cập | Không hiển thị; URL trực tiếp là `Forbidden` | Không hiển thị; URL trực tiếp là `Forbidden` | `Forbidden` nếu chưa có membership project. |

Mọi vùng dữ liệu đều có cùng ngữ nghĩa trạng thái:

- `Loading`: chưa có dữ liệu đáng tin cậy; dùng skeleton theo cấu trúc của vùng đó, không hiển thị số liệu giả.
- `Empty`: tải thành công nhưng không có bản ghi trong ngữ cảnh hoặc filter hiện tại; nêu rõ điều kiện rỗng và chỉ đặt CTA mà vai trò hiện tại được phép dùng.
- `Error`: không xác nhận được dữ liệu hoặc mutation do lỗi mạng/dịch vụ; giữ hành động `Thử lại` và dữ liệu form chưa gửi.
- `Forbidden`: xác thực có thể hợp lệ nhưng không được đọc/ghi resource; không render nội dung private sau trạng thái này.
- `Conflict`: server từ chối bản task cũ; giữ đường xem phiên bản hiện tại, không có hành động ghi đè ngầm.

## Yêu cầu cho Pencil

Mỗi frame phải ghi Screen ID, viewport, vai trò/khả năng đang giả lập, trạng thái dữ liệu và điểm quay về. Cùng một màn hình không dùng frame “happy path” để ngầm đại diện cho `Loading`, `Empty`, `Error`, `Forbidden` hoặc `Conflict`; các trạng thái này cần frame riêng hoặc variant đã được liên kết rõ ràng.
