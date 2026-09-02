# Persona và jobs-to-be-done

## Phạm vi vai trò

Flowboard tách vai trò workspace khỏi vai trò project. Một người phải là thành viên workspace trước khi được thêm vào project. Quyền làm việc với nội dung dự án đến từ thành viên project, không đến từ việc có vai trò quản trị workspace.

| Cấp | Vai trò cố định | Mục đích |
|---|---|---|
| Workspace | Workspace Admin, Workspace Member | Quản lý thành viên/thiết lập workspace hoặc tham gia workspace. |
| Project | Project Owner, Editor, Viewer | Xác định ai có thể đọc, thay đổi và quản lý một project riêng tư. |

Không có custom role trong MVP. Các bảng dưới đây mô tả nhu cầu sản phẩm; quyết định quyền chính thức luôn phải được thực thi theo project.

## Project Owner

| Khía cạnh | Mô tả |
|---|---|
| Mục tiêu | Biến một project thành nơi làm việc đáng tin cậy, biết việc nào cần làm và gỡ được điểm nghẽn. |
| Tần suất | Thường lúc khởi tạo project, khi thay đổi cột/thành viên hoặc khi rà soát tiến độ; vẫn có thể làm việc hằng ngày với task. |
| Jobs-to-be-done | “Khi bắt đầu hoặc điều chỉnh một project, tôi muốn cấu hình board và cấp đúng quyền để nhóm có thể làm việc trong một không gian riêng tư.”; “Khi theo dõi tiến độ, tôi muốn thấy task, thảo luận và history để biết trách nhiệm và thay đổi.” |
| Thông tin phải thấy | Danh sách project mình được cấp quyền, cột board, mọi task trong project, assignee, priority, due date nếu có, comment, activity history, danh sách thành viên project và quyền của họ. |
| Hành động cần có | Đọc toàn bộ project; tạo/sửa/di chuyển/giao task; tạo comment; quản lý cột, thành viên project và thiết lập project. Export tiến độ chỉ có ở Phase 1.1 trở đi. |
| Ràng buộc | Chỉ quản lý thành viên trong project; nếu người cần thêm chưa là thành viên workspace, bước thêm họ vào workspace thuộc thẩm quyền Workspace Admin. |

Người tạo project trở thành Project Owner. Owner không mặc nhiên trở thành Workspace Admin.

## Editor

| Khía cạnh | Mô tả |
|---|---|
| Mục tiêu | Cập nhật trạng thái công việc trong ngày và trao đổi tại đúng task để cả nhóm thấy một nguồn thông tin chung. |
| Tần suất | Hằng ngày hoặc mỗi khi nhận, xử lý, bàn giao hay cập nhật một task. |
| Jobs-to-be-done | “Khi bắt đầu hoặc tiếp tục công việc, tôi muốn nhìn board và các task liên quan để biết việc ưu tiên tiếp theo.”; “Khi công việc thay đổi, tôi muốn cập nhật, giao lại hoặc di chuyển task và để lại ngữ cảnh trong comment.” |
| Thông tin phải thấy | Board và các cột, task trong project, trạng thái/assignee/priority/due date, mô tả task, comment, activity history và các hành động mà mình được phép làm. |
| Hành động cần có | Đọc project; tạo, sửa, di chuyển và giao task; tạo comment. |
| Ràng buộc | Không quản lý cột, thành viên project hoặc thiết lập project. Khi bản task đang xem đã được người khác cập nhật, Editor phải nhận trạng thái conflict và xem lại thay vì ghi đè âm thầm. |

## Viewer

| Khía cạnh | Mô tả |
|---|---|
| Mục tiêu | Theo dõi tiến độ, trách nhiệm và lịch sử của project mà không làm thay đổi dữ liệu. |
| Tần suất | Theo chu kỳ review, trước cuộc họp, hoặc khi cần nắm tình trạng một công việc. |
| Jobs-to-be-done | “Khi cần nắm tình hình, tôi muốn xem board, task, thảo luận và history để có bối cảnh đáng tin cậy mà không vô tình thay đổi project.” |
| Thông tin phải thấy | Project, board, task và mọi trường task được phép công bố, comment, activity history, assignee, priority và due date nếu có. |
| Hành động cần có | Chỉ đọc project, board, task, comment và activity. |
| Ràng buộc | Không tạo/sửa/di chuyển/giao task; không tạo comment; không quản lý cột, thành viên hoặc thiết lập. UI không hiển thị hành động ghi dữ liệu và API cũng phải từ chối mọi thử nghiệm ghi trực tiếp. |

## Workspace Admin

| Khía cạnh | Mô tả |
|---|---|
| Mục tiêu | Giữ workspace sẵn sàng cho đúng người tham gia mà không phá vỡ ranh giới riêng tư của từng project. |
| Tần suất | Thấp hơn luồng board hằng ngày; dùng khi mời/xóa thành viên workspace, thay đổi thiết lập workspace hoặc tạo project. |
| Jobs-to-be-done | “Khi nhóm thay đổi, tôi muốn quản lý thành viên và thiết lập workspace để người phù hợp có thể được thêm vào project, trong khi project riêng tư vẫn giữ kín.” |
| Thông tin phải thấy | Thành viên và thiết lập ở cấp workspace; project chỉ khi Admin đồng thời là thành viên của project đó. |
| Hành động cần có | Quản lý thành viên/thiết lập workspace và tạo project; khi tạo project, người tạo trở thành Project Owner. |
| Ràng buộc bắt buộc | **Workspace Admin không có quyền ngầm định với project riêng tư.** Admin không được đọc board, task, comment, activity, thành viên project hay thiết lập project nếu chưa được thêm tường minh vào danh sách thành viên project. |

## Ma trận nhu cầu thông tin và quyền

| Năng lực project | Owner | Editor | Viewer | Workspace Admin chưa là thành viên project |
|---|:---:|:---:|:---:|:---:|
| Đọc project, board, task, comment, activity | Có | Có | Có | Không |
| Tạo/sửa/di chuyển/giao task | Có | Có | Không | Không |
| Tạo comment | Có | Có | Không | Không |
| Quản lý cột | Có | Không | Không | Không |
| Quản lý thành viên project và thiết lập project | Có | Không | Không | Không |
| Export tiến độ từ Phase 1.1 | Có | Không | Không | Không |

Một Workspace Admin đã được thêm vào project sử dụng quyền theo vai trò **Owner**, **Editor** hoặc **Viewer** đã cấp cho chính project đó; chức danh admin không nâng quyền này.

## Tiêu chí chấp nhận theo persona

- Dữ liệu và hành động hiển thị cho mỗi persona khớp với vai trò project hiện tại, không suy diễn từ vai trò workspace.
- Owner có thể hoàn tất vòng lặp setup và quản trị project; Editor có thể hoàn tất vòng lặp task hằng ngày; Viewer có thể hoàn tất vòng lặp review chỉ-đọc.
- Một Viewer hoặc Workspace Admin chưa có membership project không thể vượt rào bằng URL, thao tác UI hay yêu cầu HTTP trực tiếp.
- Khi một người bị gỡ khỏi project, các lần đọc hoặc ghi tiếp theo phải được đánh giá lại theo membership hiện tại.
