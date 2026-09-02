# Hành trình người dùng Flowboard

## Quy ước chung

Mọi hành trình đều diễn ra trong project riêng tư. Có mặt trong workspace là điều kiện cần để trở thành thành viên project, nhưng không tự cấp quyền đọc project. Giao diện có thể ẩn hành động không hợp lệ; lần kiểm tra quyết định phải diễn ra khi xử lý yêu cầu với đúng resource.

## 1. Owner thiết lập project

| Thành phần | Nội dung |
|---|---|
| Điểm vào | Người dùng đã đăng nhập mở workspace hoặc tạo workspace, rồi bắt đầu tạo project. |
| Điều kiện trước | Người dùng có quyền tạo workspace hoặc là Workspace Admin của workspace đích; các người dự định thêm vào project trước hết phải là thành viên workspace. |
| Luồng thành công | Mở/tạo workspace → tạo project riêng tư → người tạo trở thành Owner → cấu hình cột board → thêm các thành viên workspace vào project với vai trò Owner, Editor hoặc Viewer → tạo và giao task đầu tiên → mở task để trao đổi và xem activity. |
| Kết quả thành công | Một project riêng tư có board, thành viên đúng quyền và ít nhất một task có thể đi qua luồng làm việc chính. Owner có thể xem ai được quyền gì và lịch sử thay đổi quan trọng. |
| Kết quả thất bại | Nếu người dùng không có quyền tạo project, yêu cầu bị từ chối và không tạo project. Nếu người cần mời chưa là thành viên workspace, họ không được thêm vào project; cần được Workspace Admin thêm vào workspace trước. Nếu có lỗi mạng, form không được tạo một project hoặc membership mơ hồ. |

**Điều kiện chấp nhận:** Sau setup, chỉ Owner quản lý được cột, thành viên và thiết lập project. Việc một Workspace Admin chưa được thêm vào project không làm thay đổi tính riêng tư của project vừa tạo.

## 2. Editor xử lý task hằng ngày

| Thành phần | Nội dung |
|---|---|
| Điểm vào | Editor đăng nhập và mở project mình là thành viên, từ danh sách project hoặc đường dẫn project hợp lệ. |
| Điều kiện trước | Người dùng đang là Project Editor; project và board tồn tại. Người được giao task phải thuộc đúng project. |
| Luồng thành công | Xem board và trạng thái task → tạo task mới hoặc mở task có sẵn → cập nhật title/mô tả/priority/due date theo nhu cầu → giao task cho thành viên project → di chuyển task sang cột phù hợp → thêm comment → kiểm tra activity history. |
| Kết quả thành công | Board phản ánh trạng thái mới của task, assignee nhận đúng ngữ cảnh project, comment và activity giữ dấu vết thay đổi. Editor tiếp tục làm việc mà không cần chuyển sang công cụ theo dõi khác. |
| Kết quả thất bại | Nếu membership bị gỡ hoặc role chuyển thành Viewer, các hành động ghi bị từ chối. Nếu task đã đổi từ nơi khác, cập nhật cũ nhận conflict; Editor phải tải lại/xem lại phiên bản hiện tại, không được ghi đè âm thầm. Lỗi mạng, loading hoặc empty state phải nói rõ dữ liệu chưa sẵn sàng thay vì giả vờ cập nhật thành công. |

**Điều kiện chấp nhận:** Editor làm được tạo, sửa, di chuyển, giao task và tạo comment; không có hành động quản lý cột, thành viên hay thiết lập project. Di chuyển task phải giữ task trong phạm vi project và tạo đúng một dấu vết activity cho thao tác thành công.

## 3. Viewer review tiến độ

| Thành phần | Nội dung |
|---|---|
| Điểm vào | Viewer đăng nhập và mở một project mà mình đã được thêm tường minh với vai trò Viewer. |
| Điều kiện trước | Project là private nhưng Viewer có membership project đang hiệu lực. |
| Luồng thành công | Mở board → xem task theo cột và các trường được công bố → mở task để đọc mô tả, assignee, priority, due date nếu có, comment và activity history → quay lại board để tiếp tục theo dõi. |
| Kết quả thành công | Viewer hiểu tiến độ, trách nhiệm và ngữ cảnh thay đổi của project mà không cần có quyền chỉnh sửa. |
| Kết quả thất bại | Viewer không thể tạo, sửa, di chuyển hoặc giao task; không thể tạo comment hay quản lý cột/thành viên/thiết lập. Nếu cố gọi một thao tác ghi trực tiếp, API từ chối yêu cầu và project không thay đổi. |

**Điều kiện chấp nhận:** UI không đưa Viewer vào một luồng ghi dữ liệu, và mọi endpoint ghi vẫn từ chối Viewer ngay cả khi họ biết ID của resource.

## 4. Truy cập bị từ chối

| Thành phần | Nội dung |
|---|---|
| Điểm vào | Người dùng mở URL project/task/comment/column/report, nhận liên kết từ người khác, hoặc gửi yêu cầu trực tiếp với ID resource. |
| Điều kiện trước | Người dùng chưa đăng nhập, không là thành viên project, đã bị gỡ khỏi project, hoặc là Workspace Admin nhưng chưa được thêm vào project. |
| Luồng thành công | Hệ thống xác thực phiên nếu có → xác định resource/project → đánh giá membership và action đối với resource đó → không trả dữ liệu hoặc khả năng thao tác nếu không được phép → hiện trạng thái permission denied phù hợp. |
| Kết quả thành công | Không lộ board, task, comment, activity, membership project, thiết lập hay dữ liệu báo cáo. Workspace Admin không nhận ngoại lệ chỉ vì là admin. |
| Kết quả thất bại | Bất kỳ dữ liệu project, trường dữ liệu nhạy cảm hoặc thao tác thay đổi nào xuất hiện cho người không có membership là lỗi bảo mật; việc chỉ ẩn nút nhưng vẫn cho API thành công cũng là thất bại. |

**Điều kiện chấp nhận:** Mọi yêu cầu có project, task, comment, column hoặc report ID phải kiểm tra quyền theo object. Thử truy cập chéo giữa hai người dùng hoặc gọi HTTP trực tiếp với role Viewer phải cho kết quả từ chối và không tạo side effect.

## Kiểm tra toàn bộ vòng lặp

Một bản MVP đạt yêu cầu hành trình khi Owner thiết lập project, Editor đưa task đi qua board và Viewer review được kết quả trong cùng một project; đồng thời một người không có membership project không thể xem hoặc thay đổi cùng dữ liệu đó. Điều này kiểm tra cả đường đi thành công lẫn ranh giới thất bại của sản phẩm.
