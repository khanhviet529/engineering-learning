# Đặc tả tương tác Flowboard

## Nguyên tắc chung

- Server là nguồn xác nhận mutation, capability và `version`. UI lạc quan chỉ là phản hồi tức thời, không phải bằng chứng thành công.
- Một trạng thái Error, Forbidden, Session expired hoặc Conflict luôn ưu tiên hơn dữ liệu lạc quan/cached còn lại của resource liên quan.
- `Owner`, `Editor`, `Viewer` quyết định affordance trong project. Workspace Admin không nhận affordance project nếu chưa là thành viên project.
- Mọi thông báo phải xác định hành động tiếp theo: thử lại, xem bản hiện tại, quay lại, hoặc tiếp tục chỉnh sửa. Không dùng thông báo “đã lưu” trước khi server xác nhận.

## 1. Drag-and-drop task

### Điều kiện và phản hồi trực quan

| Pha | Hành vi bắt buộc |
|---|---|
| Khả dụng | Chỉ Owner và Editor thấy drag handle và kích hoạt keyboard drag. Viewer thấy task card không có affordance di chuyển. |
| Bắt đầu | Card nguồn có trạng thái lifted; cột/vị trí nguồn vẫn giữ chỗ. Công bố cho screen reader title task và cột nguồn. |
| Kéo qua mục tiêu | Chỉ cột active trong cùng project là target. Cột/vị trí drop hợp lệ có highlight rõ, không chỉ đổi màu. Không có target nào ngoài board hiện tại. |
| Thả | UI đặt card vào cột/vị trí mục tiêu ngay, đánh dấu `Đang đồng bộ` trên card và khóa lần kéo thứ hai của chính card. Các task khác vẫn có thể thao tác nếu không phụ thuộc request này. |
| Server thành công | Thay state lạc quan bằng cột, vị trí và version server trả về; bỏ nhãn đang đồng bộ. Board có đúng một kết quả di chuyển và activity server tạo đúng một bản ghi. |
| Error | Khôi phục snapshot cột/vị trí nguồn đã chụp trước kéo, giữ focus ở card và hiển thị Error có thể thử lại bằng một lần kéo mới. Không giữ card ở cả hai cột. |
| Forbidden hoặc Session expired | Khôi phục snapshot. Nếu request đọc tiếp theo xác nhận không còn quyền project, xóa dữ liệu private của project và chuyển SYS-01 hoặc SYS-02. |
| 409 Conflict | Khôi phục snapshot, nạp lại bản task/board khi vẫn được phép và mở SYS-04 Conflict Resolution. Không tự phát lại move hay đưa ra nút force move. |

Request move mang cột đích, vị trí mục tiêu và version task mà client đang có theo hợp đồng mutation. Frontend không tự tính lại ordering server; nó chỉ dùng thứ tự phản hồi để đồng bộ UI.

### Chuột, cảm ứng và bàn phím

- Chuột: bắt đầu từ drag handle, không biến cú click vào nội dung card thành kéo ngoài ý muốn.
- Cảm ứng: nhấn giữ trên drag handle mới bắt đầu kéo; cuộn ngang board vẫn là thao tác native khi không ở trạng thái kéo.
- Bàn phím: focus ở drag handle, `Space` nhấc task; phím mũi tên di chuyển vị trí/giữa cột theo mục tiêu hợp lệ; `Space` thả; `Escape` hủy và trả task về source. Live region công bố từng cột/vị trí mới và kết quả thành công/lỗi.
- `Enter` hoặc `Space` trên phần mở task của card mở Task Detail; khi focus ở drag handle, `Space` luôn ưu tiên drag và không mở drawer.

## 2. UI lạc quan và trạng thái đang gửi

| Tương tác | Trước xác nhận server | Sau thành công | Khi Error/Conflict/Forbidden |
|---|---|---|---|
| Move task | Di chuyển card lạc quan, nhãn `Đang đồng bộ`, chụp snapshot để hoàn nguyên. | Nhận vị trí/version server. | Hoàn nguyên; Error cho kéo lại, Conflict mở resolution, Forbidden bỏ dữ liệu private khi cần. |
| Tạo/sửa task | Giữ form mở, nút ở trạng thái saving; không thêm card “đã tạo” giả. | Cập nhật board/drawer bằng task server trả về rồi đóng form. | Giữ giá trị form; Conflict không ghi đè; Forbidden không khẳng định thành công. |
| Tạo comment | Hiển thị comment tạm có nhãn `Đang gửi` và idempotency key cho lần gửi/retry an toàn. | Thay bằng comment server xác nhận. | Giữ bản nháp để thử lại khi Error; bỏ trạng thái tạm nếu Forbidden/Session expired xác nhận. |
| Đổi tên project | Giữ `PRJ-03 Project Settings` ở trạng thái Saving; không đổi header/list theo kiểu lạc quan. | Đồng bộ tên server trả về ở settings và project context. | Giữ form name khi Error; Forbidden bỏ dữ liệu project. Request chỉ là `PATCH /projects/:projectId` với `name`. |
| Thay đổi cột/thành viên | Hàng đang mutation có spinner và khóa thao tác mâu thuẫn. | Đồng bộ danh sách theo phản hồi server. | Giữ form/hàng có ngữ cảnh lỗi; không tự suy diễn thay đổi đã áp dụng. |

Không có optimistic UI cho thay đổi quyền hay archive cột vì dữ liệu xác nhận là quan trọng hơn cảm giác tức thời.

**Giao giữa mutation lạc quan và refetch (version guard):** một refetch có thể trả về state server CŨ HƠN kết quả mutation vừa commit (response list đọc trước khi mutation commit nhưng về sau). Quy tắc: client **không bao giờ thay một task trong cache bằng payload có `version` thấp hơn** version đã được server xác nhận cho task đó; task version là thước so mới/cũ duy nhất phía client. Refetch/invalidate của list bị ảnh hưởng chạy sau khi mutation settle, và kết quả được reconcile theo version guard này — response cũ hơn bị bỏ, không "hoàn nguyên" một mutation đã xác nhận. Guard áp dụng cho resource có `version` (Task, WorkLog, settings); nó không thay thế quy tắc `409` cho mutation.

## 3. Form, validation và unsaved changes

### Validation

- Task form kiểm tra title bắt buộc; description, assignee, category, priority, start date, due date và reviewer điều kiện là các trường được baseline cho phép. Priority chỉ `none|low|medium|high|urgent`; category chỉ fixed allowlist. Start/due date là ngày tùy chọn, không có giờ, recurrence hay notification trong MVP; khi cùng có thì `startDate <= dueDate`.
- `dueState` do server suy ra theo workspace timezone: task terminal không overdue, task quá hạn/hạn hôm nay/sắp hạn chỉ dùng semantic visual token và filter; user không chọn nó như workflow column. Reviewer chỉ required khi cột đích `requiresReviewer`; phải là member project khác assignee.
- Assignee chỉ chọn từ thành viên project do server trả về. Cột đích phải là cột active trong project đang mở.
- `PRJ-03 Project Settings` có đúng một trường editable là `name`; name bắt buộc sau khi bỏ khoảng trắng đầu/cuối. Client không tự đặt giới hạn độ dài/ký tự chưa được hợp đồng. Submit chỉ gửi `{ name }` qua `PATCH /projects/:projectId`, không có description, visibility hay project action khác.
- Form tạo/sửa project, cột, membership và authentication hiển thị lỗi theo trường trước, rồi lỗi tổng quát khi lỗi không gắn trường nào.
- Client validation hỗ trợ phản hồi sớm; validation server là quyết định cuối. Lỗi server giữ giá trị người dùng đã nhập, trừ secret theo chính sách của form.
- Trường lỗi có text lỗi, liên kết mô tả truy cập được và focus chuyển tới trường lỗi đầu tiên sau submit thất bại.

### Dirty state

Form là dirty sau khác biệt có ý nghĩa với giá trị đã nạp/giá trị ban đầu. Áp dụng cho task form, column editor, project create, `PRJ-03 Project Settings` và màn hình membership đang có thay đổi chưa gửi.

| Sự kiện rời form dirty | Hành vi |
|---|---|
| Đóng drawer/modal, đổi route, chuyển task hoặc project | Mở xác nhận: `Tiếp tục chỉnh sửa` là focus mặc định; `Bỏ thay đổi` loại bản nháp và thực hiện ý định rời. Không tự lưu. |
| Click ngoài modal | Không đóng ngay; đi qua xác nhận như trên. |
| `Escape` | Nếu form sạch thì đóng và trả focus; nếu dirty thì mở xác nhận. |
| Tải lại/đóng tab | Dùng cảnh báo trình duyệt khi có thể; không cam kết thông điệp tùy biến. |
| Mutation đang gửi | Không cho đóng theo cách làm mất trạng thái request. Sau Error, form lại có thể chỉnh sửa; sau thành công, đóng theo luồng gọi form. |

### Project Settings (PRJ-03)

- Entry point chỉ có trong project context của Owner. Route trực tiếp của Editor, Viewer hoặc Workspace Admin chưa là member là Forbidden; UI không dựa vào việc ẩn nút để quyết định quyền.
- Loading dùng skeleton cho label/input name. Khi dữ liệu project có capability hợp lệ, form nạp current name và focus ở heading hoặc input theo ý định mở.
- `Lưu tên project` chỉ bật khi form hợp lệ và name khác giá trị ban đầu. Saving khóa submit/điều hướng gây mất request; Error giữ input và focus/aria message phù hợp.
- Thành công thay thế current name ở header, breadcrumb và Project Settings từ response server, đánh dấu form sạch và giữ Owner ở route settings. `Quay lại board` là navigation tường minh sau đó.
- Rời route với form dirty dùng dialog unsaved changes chung. Không tự lưu, không có optimistic rename và không có field/project action thứ hai trong form.

## 4. Xuất tiến độ và tùy chọn cá nhân

### RPT-01 — Xuất tiến độ

- Entry point `Xuất tiến độ` nằm tại `PRJ-04 Dashboard`; chỉ render khi capability server trả `report:export`. Trong Phase 1.1 capability này chỉ thuộc Owner của project; Editor, Viewer và Workspace Admin không phải member không nhìn thấy CTA.
- Nhấn CTA mở modal giữa Dashboard với backdrop. Modal hiển thị snapshot bất biến của project, khoảng thời gian và filter hiện hành trước khi tạo tệp; không để actor sửa query không được server cho phép ngay trong modal.
- `Tạo tệp XLSX` gửi request đã có idempotency key. UI đi qua `pending → ready | failed | expired`; success chỉ xuất hiện khi server trả tệp đã sẵn sàng. `expired` cho phép tạo request mới, không tự gửi email, không schedule và không tự retry write.
- Forbidden sau khi modal đang mở đóng/bỏ dữ liệu project private, chuyển về `SYS-01`; Error giữ snapshot và cho thử lại chủ động.

### USR-01 — Hồ sơ và tùy chọn

- Footer của `FbAppShell` mở route `/account/settings`. Tên hiển thị và email lấy từ actor session, chỉ đọc trong MVP.
- Theme `light|dark|system` là preference cục bộ; thay đổi áp dụng ngay, không tạo mutation API. UI thông báo ngắn khi lưu preference thất bại ở local storage và vẫn cho actor chọn lại.
- Múi giờ là dữ liệu của workspace, chỉ đọc. Không cho mỗi cá nhân đổi timezone vì due state/overdue phải nhất quán cho toàn project.
- `Đổi mật khẩu` điều hướng sang `AUTH-03`; không thiết kế quản lý phiên, thiết bị hay khóa API trong MVP.

### Sidebar dùng chung

- Mỗi item của `FbAppShell` luôn có icon, nhãn, active indicator và accessible name. Sidebar desktop có thể thu gọn còn icon; hover/focus hiển thị tooltip, keyboard focus vẫn nhìn rõ và active state không mất.
- Permission không chỉ là ẩn route: navigation/CTA lấy từ capability, route trực tiếp vẫn có thể thành `SYS-01` và API vẫn là lớp kiểm tra cuối cùng.

## 5. Conflict Resolution (409)

`409 Conflict` nghĩa là task đang thao tác đã thay đổi sau version client đọc. Đây không phải validation error và không được xử lý bằng retry im lặng.

1. Dừng mutation, gắn state Conflict với task nguồn và giữ bản nháp local ở bộ nhớ tạm của phiên.
2. Nạp lại bản task hiện tại cùng version mới nếu actor vẫn có quyền đọc. Loading của bước này là state riêng trong SYS-04.
3. Hiển thị rõ rằng task đã thay đổi ở nơi khác, cùng hai dữ liệu có nhãn `Bản hiện tại` và `Bản nháp của bạn` khi có dữ liệu. Không suy đoán field merge hoặc người thay đổi nếu payload không cung cấp.
4. Người dùng chọn xem bản hiện tại, sao chép nội dung bản nháp hoặc hủy. Muốn lưu thay đổi phải chủ động quay về form trên version hiện tại và gửi lại qua flow thông thường.
5. Nếu nạp lại trả Forbidden hoặc Session expired, ưu tiên state đó và không hiển thị dữ liệu conflict đã cache. Nếu Error, giữ message Conflict và cho `Thử tải bản hiện tại`.

Di chuyển task gặp Conflict dùng cùng flow nhưng không cố dựng UI merge vị trí. Sau khi xem lại board hiện tại, người dùng thực hiện một drag-and-drop mới nếu vẫn có quyền.

## 6. Phân trang, filter và tải thêm

- List endpoint có page mặc định 25 và tối đa 100. Board chỉ nạp số task giới hạn theo từng cột, dùng `items`, `nextCursor`, `hasMore`; không có nút tải toàn bộ project.
- Nút `Tải thêm` nằm ở chân đúng cột. Khi đang nạp thêm, chỉ nút/cột đó vào Loading; card đã nạp không nhảy vị trí và không bị thay bằng skeleton toàn trang.
- Một cursor chỉ dùng cho đúng project, cột, filter, sort và search đã tạo nó. Thay một điều kiện xóa cursor và kết quả của query trước rồi nạp trang đầu query mới.
- **Cơ chế chống stale response** (yêu cầu "kết quả cũ không được ghép vào query mới" của F-DATA-01): cache key của mỗi list request **phải là canonical query fingerprint đầy đủ** — project, column, filters, sort, search, cursor (TanStack Query queryKey theo [frontend conventions](../engineering/frontend-conventions.md)). Response chỉ được ghi vào đúng key đã tạo ra request đó; vì đổi điều kiện tạo key mới, response của điều kiện cũ về muộn **không có chỗ để ghi vào** query hiện tại — key-match là bảo đảm. Khi điều kiện đổi, client đồng thời hủy (abort) các request in-flight của key cũ — abort là tối ưu hóa tài nguyên, không phải cơ chế đúng đắn. Trạng thái "điều kiện hiện tại" sống trong query state của feature (không trong component cục bộ), và phép so khớp xảy ra tại cache layer theo key, không phải so tay trong callback.
- Khi Error tải thêm, giữ task đã xác nhận, hiển thị Error cục bộ và cho thử lại cùng cursor. Không tăng cursor trước khi thành công, không trùng card khi người dùng bấm nhiều lần.
- Empty có hai thông điệp khác nhau: cột chưa có task và không có task khớp filter. Viewer không thấy CTA tạo task trong bất kỳ Empty state nào.

## 7. HTTP 404, 429 và 503

- `404 Not Found`: dùng khi route không tồn tại hoặc resource public-safe không resolve được. Không dùng 404 để thay thế `403 Forbidden` của private project; private project không authorized tiếp tục theo `SYS-01`/API policy không làm lộ dữ liệu. CTA là về Workspace List hoặc route an toàn gần nhất.
- `429 RATE_LIMITED`: đọc header `Retry-After` (giây) và disable control/submit gây ra request đó cho tới hết thời gian chờ, kèm thông báo an toàn có đếm lùi hoặc thời điểm thử lại. Không tự retry mutation; với search, input debounce/throttle để một người gõ nhanh không tự tạo vòng 429. Dữ liệu server-confirmed đang hiển thị được giữ nguyên.
- `503 Service Unavailable`: giữ dữ liệu server-confirmed đang hiển thị nếu có, thông báo lỗi dịch vụ tạm thời và có Retry rõ ràng. Mutation không được xác nhận thành công, không tự retry write và không biến thành Empty.

## 8. Focus, keyboard và lớp phủ

| Tình huống | Quy tắc focus/keyboard |
|---|---|
| Trang mới hoặc Error page | Focus heading trạng thái để screen reader nhận biết context đã đổi. |
| Mở task/detail/form/panel | Focus heading hoặc trường đầu tiên có ý nghĩa; drawer/modal giữ focus bên trong khi mở. |
| Đóng lớp phủ | Trả focus về card, drag handle hoặc CTA đã mở lớp phủ. Nếu phần tử nguồn không còn sau mutation, trả về heading cột hoặc CTA an toàn gần nhất. |
| Form submit lỗi | Focus lỗi trường đầu tiên; `aria-live` không được lặp toàn bộ form. |
| Project Settings | Mở bằng Owner entry point: focus heading/input name; sau `Quay lại board` hoặc discard, trả focus về entry point settings trong project context. |
| Xác nhận bỏ thay đổi/Conflict | Modal có focus trap; `Escape` chỉ đóng khi không bỏ qua một thao tác đã chọn. Focus mặc định là phương án an toàn nhất: tiếp tục chỉnh sửa hoặc xem bản hiện tại. |
| Board | Tab đi qua controls, cột và task theo thứ tự thị giác. Không tạo keyboard trap ở dải cột ngang. Card mở bằng Enter/Space; drag dùng quy ước ở mục 1. |
| Thông báo mutation | Live region công bố saving, success, Error, Forbidden hoặc Conflict ngắn gọn; toast không tự cướp focus. |

## 9. Board ngang trên màn hình nhỏ

MVP hỗ trợ web responsive, không phải ứng dụng mobile native. Ở viewport nhỏ, board vẫn là board nhiều cột:

- Header rút gọn nhưng tên project và hành động thiết yếu còn đọc được. Filter/sort đặt trong control có thể thu gọn, không làm thay đổi query đang áp dụng.
- Cột giữ chiều rộng có thể đọc; vùng board cuộn ngang native. Không ép tất cả cột thành một danh sách dọc và không cắt mất cột cuối.
- Có dấu hiệu cuộn ngang có thể nhận biết bằng thị giác và truy cập được. Focus vào task/card phải được đưa vào vùng nhìn thấy mà không tự đổi cột.
- Kéo cảm ứng bắt đầu bằng drag handle/nhấn giữ; khi chưa kích hoạt kéo, vuốt dùng để cuộn ngang. Khi kéo, target hợp lệ và vị trí nguồn vẫn được biểu đạt rõ.
- Task detail, task form, Column Editor và Project Members trên mobile dùng full-height sheet/drawer có tiêu đề, nút đóng và focus management tương đương desktop. Project Settings giữ route riêng với form name đơn; cửa sổ xác nhận/Conflict không vượt viewport và vẫn cuộn nội dung độc lập.

Pencil phải thể hiện ít nhất desktop và mobile horizontal cho BRD-01, cùng trạng thái DnD, optimistic pending, Error rollback và Conflict của task card.

## 10. Time Tracking và filter control (Phase 1.3)

Finite filter dùng select/dropdown có nhãn/placeholder/chevron: `Người thực hiện` là `assigneeId`, `Người giao` là `createdById`, `Trạng thái` là active Board Column, priority/category/due state là enum; search title/description là input riêng. Open select focus option đang chọn, Escape đóng/trả focus, chọn/clear filter reset cursor và tạo active chip. Mobile đặt cùng controls trong filter drawer.

WorkLog form dùng task async select, date picker, duration minutes, description và `supportReason` conditional khi actor không là assignee. Inline error đỏ xuất hiện dưới field; submit focus lỗi đầu tiên. Daily total >1.440 hoặc date ngoài backfill giữ form values; Owner override là flow riêng, không tự bypass validation.

Trong `self_close`, CTA chốt tạo final self log; trong `requires_approval`, CTA gửi tạo submitted. CTA sửa/gửi/duyệt trên **từng dòng WorkLog** lấy từ `capabilities` per-record do server trả trong chính item đó, không suy từ status/ngày/author phía client. Review panel chỉ hiện cho Owner/assigned Editor, không render approve CTA cho author; reject bắt buộc note. Bulk review hiện summary số log/số giờ và trả kết quả từng row, toast không nói toàn bộ thành công nếu có conflict/denied. Monthly report chỉ cộng approved, tách self/pending/rejected và không có export/email CTA.
