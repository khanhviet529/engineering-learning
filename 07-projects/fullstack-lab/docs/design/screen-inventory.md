# Danh mục màn hình Flowboard

## Quy ước ổn định

Screen ID là khóa bền vững cho frame Pencil, test end-to-end, ticket frontend và tài liệu bàn giao. Không đổi ID khi đổi nhãn hoặc bố cục. Màn hình có thể là trang, drawer, modal hoặc full-region state; loại hiển thị được ghi rõ để Pencil không biến lớp phủ thành route mới.

`Route hoặc context` ghi **đúng path người dùng thấy**, theo quy ước segment tiếng Việt không dấu công bố ở [information architecture](information-architecture.md). Query key giữ tiếng Anh (`task`, `panel`, `limit`) vì chúng là tham số kỹ thuật chứ không phải chữ hiển thị. Screen ID mới là khóa bền vững — route đổi được, ID thì không.

`API data cần` mô tả dữ liệu đã được baseline yêu cầu, không mở rộng thành hợp đồng endpoint mới. Dữ liệu project luôn bao gồm capability do server tính cho actor hiện tại; client không tự tính lại role rules. Các endpoint được nêu tên chỉ là những endpoint đã có trong baseline.

| ID | Màn hình và loại | Purpose (mục đích) | Route hoặc context | API data cần | Vai trò được phép | Trạng thái bắt buộc |
|---|---|---|---|---|---|---|
| AUTH-01 | Sign In — trang | Xác thực người dùng và bắt đầu một phiên an toàn. | `/dang-nhap` | trạng thái phiên, phản hồi đăng nhập | Chưa xác thực | Default, validation, Loading, `401 UNAUTHENTICATED` generic, `403 EMAIL_VERIFICATION_REQUIRED` (xóa password, sang `AUTH-05`, không có session/private data), Error, Session expired sau khi quay lại. |
| AUTH-02 | Sign Up — trang | Tạo tài khoản để người dùng có thể bắt đầu xác thực. | `/dang-ky` | phản hồi đăng ký/xác minh | Chưa xác thực | Default, validation, Loading, Error, completed. |
| AUTH-03 | Password Reset Request — trang | Yêu cầu luồng đặt lại mật khẩu mà không tiết lộ tài khoản tồn tại. | `/quen-mat-khau` | phản hồi yêu cầu reset | Chưa xác thực | Default, validation, Loading, Error, completed không tiết lộ email có tồn tại. |
| AUTH-04 | Password Reset Confirm — trang | Đặt mật khẩu mới bằng token reset hợp lệ. | `/dat-lai-mat-khau` | trạng thái token reset, phản hồi đặt lại | Chưa xác thực | Default, token invalid/expired, validation, Loading, Error, completed. |
| AUTH-05 | Email Verification — trang | Hoàn tất xác minh email trước khi vào dữ liệu private. | `/xac-minh-email` | trạng thái token/xác minh email | Chưa xác thực hoặc tài khoản cần xác minh | Loading, verified, token invalid/expired, Error. |
| WSP-01 | Workspace List — trang | Chọn workspace mà người dùng là thành viên. | `/khong-gian-lam-viec` | `GET /workspaces`: workspace người dùng là thành viên; dữ liệu phiên | Phiên hợp lệ | Loading, Empty, Error, Forbidden nếu phiên không còn hợp lệ. |
| WSP-02 | Workspace Create — modal/trang con | Tạo workspace mới khi server cho phép. | từ Workspace List | phản hồi tạo workspace | Actor được server cho phép tạo workspace | Default, validation, Loading, Error, completed. |
| WSP-03 | Workspace Members — trang con | Để Workspace Admin quản lý membership ở đúng cấp workspace. | `/khong-gian-lam-viec/:workspaceId/thanh-vien` | `GET /workspaces/:workspaceId/members`, `GET /workspaces/:workspaceId/invitations` (lời mời `pending`), phản hồi mời/gỡ member, thu hồi lời mời, và capability workspace | Workspace Admin của workspace | Loading, Empty (cả hai danh sách), Error, Forbidden, mutation pending, `202` sau khi mời — không suy ra email có tồn tại hay không. |
| WSP-04 | Workspace Settings — trang con có chặn phạm vi | Cung cấp điểm vào admin cho setting workspace khi hợp đồng cụ thể đã có. | `/khong-gian-lam-viec/:workspaceId/cai-dat` | metadata workspace và capability do server trả; trường chỉnh sửa chỉ xuất hiện khi hợp đồng dữ liệu đã xác định | Workspace Admin của workspace | Loading, Error, Forbidden. Không có form/CTA lưu được suy diễn trong Task 3. |
| WSP-05 | Invitation Accept — trang | Đổi một token lời mời thành membership workspace. | `/loi-moi/chap-nhan` | trạng thái token lời mời, `POST /invitations/accept`, workspace vừa tham gia | Đã xác thực và đã xác minh email; token quyết định workspace nào | Loading, accepted (điều hướng sang `WSP-01`), token invalid/expired/used/revoked — **cùng một thông điệp**, Error tách riêng (lỗi mạng chưa tiêu token nên thử lại được), "cần đăng nhập/đăng ký trước" giữ token qua bước đó, và email không khớp → `403` nói rõ lời mời thuộc địa chỉ khác kèm đường đổi tài khoản. |
| PRJ-01 | Project List — trang | Chọn project private mà actor được phép đọc trong workspace. | `/khong-gian-lam-viec/:workspaceId` | project trong workspace mà actor được phép đọc, capability tạo project | Thành viên workspace; dữ liệu chỉ theo membership project | Loading, Empty, Error, Forbidden. Empty không suy ra project private khác. |
| PRJ-02 | Project Create — modal/trang con | Tạo project private trong workspace và đưa người tạo thành Owner. | context workspace | phản hồi tạo project; workspace đã chọn | Workspace Admin | Default, validation, Loading, Error, completed. Người tạo thành Owner của project mới. |
| PRJ-03 | Project Settings — trang | Để Owner đổi duy nhất tên project, không thêm setting hay action project khác. | `/du-an/:projectId/cai-dat` | `GET /projects/:projectId`: tên/capability project; `PATCH /projects/:projectId` chỉ với `name` | Owner | Loading, default, validation, Saving, Error, Forbidden, unsaved changes; không có description, visibility, deletion/destructive action hay setting khác. |
| BRD-01 | Project Board — trang chính | Điều phối và theo dõi task theo cột trong project được phép đọc. | `/du-an/:projectId/bang-cong-viec` | project/board được phép đọc, cột active có thứ tự, task theo từng cột với `items`, `nextCursor`, `hasMore`, capability, thành viên project cho assignee | Owner, Editor, Viewer của project | Loading, Empty theo cột/filter, Error, Forbidden, per-column loading-more, mobile horizontal. |
| BRD-02 | Column Editor — drawer/modal | Để Owner cấu hình cột board trong đúng project. | `BRD-01` với `panel=columns` | cột active, vị trí, cờ `requiresReviewer` và `isTerminal` của từng cột, capability quản lý cột. **Không** có số task: `boardColumnSchema` không mang count, và việc archive bị chặn được biết từ `409 COLUMN_NOT_EMPTY` của server — một con số đọc trước đó đã cũ vào lúc người dùng bấm. | Owner | Loading, Empty, validation, mutation pending, Error, Forbidden, archive blocked vì cột còn task, unsaved changes. |
| TSK-01 | Task Form — drawer/modal | Tạo hoặc sửa task được phép trong ngữ cảnh board. | `BRD-01` với task mới hoặc task đang sửa | cột project cùng `requiresReviewer`, assignee/reviewer là project member, category/priority allowlist, date range, trường task hiện có khi sửa, `version`, capability ghi task | Owner, Editor | Default, validation date range/reviewer, Loading dữ liệu sửa, saving, Error, Forbidden, Conflict, unsaved changes. |
| TSK-03 | Quan hệ Task — section trong TSK-02 | Xem/sửa cha–con và phụ thuộc blocking của một task (Phase 1.5). | `TSK-02` với `panel=relations` | `parent`, `subtaskSummary`, hai danh sách có biên `blocks`/`blockedBy` kèm `columnIsTerminal`, capability `task:update` | Owner, Editor ghi; Viewer chỉ đọc | Loading, Empty, validation cycle (`409`), vượt giới hạn 50 cạnh, cảnh báo blocker chưa xong khi vào cột terminal, Error, Forbidden. |
| TSK-02 | Task Detail — drawer/modal | Đọc task, comment và activity; cho phép ghi theo capability. | `/du-an/:projectId/bang-cong-viec?task=:taskId` | `GET /tasks/:taskId`, task/version, comment immutable, `GET /tasks/:taskId/activity`, capability | Owner, Editor, Viewer | Loading, content, comment Empty, activity Empty, Error, Forbidden, comment pending/error, edit Conflict. |
| PRM-01 | Project Members — trang con | Để Owner quản lý membership và vai trò của project hiện tại. | `/du-an/:projectId/thanh-vien` | thành viên project/role, danh sách ứng viên đã là member workspace, capability quản lý project member | Owner | Loading, Empty, Error, Forbidden, mutation pending, điều kiện chặn “chưa là thành viên workspace”. |
| MYT-01 | My Tasks — list/calendar | Giúp actor xem task được giao theo hạn và khoảng ngày. | `/viec-cua-toi` | task authorized có `assigneeId = actor`, start/due date, priority, dueState, cursor; workspace timezone | Owner, Editor, Viewer theo task họ được phép đọc | Loading, Empty, Error, due-state filter, multi-day span, mobile list fallback. |
| PRJ-04 | Project Dashboard — read-only | Theo dõi aggregate tiến độ, overdue và workload project. | `/du-an/:projectId/tong-quan` | authorized project task aggregates theo column/dueState/assignee, workspace timezone | Owner, Editor, Viewer của project | Loading, Empty, Error, Forbidden; Viewer chỉ đọc. |
| RPT-01 | Xuất tiến độ — CTA/panel trên Dashboard | Để Owner tạo và tải XLSX tiến độ theo filter snapshot đã được cho phép. | `PRJ-04` với `panel=progress-export` | capability `report:export`, filter canonical, `POST /projects/:projectId/reports/progress-export`, metadata export authorized | Owner trong Phase 1.1 | Default, request pending, ready/download, failed, expired, Forbidden. Editor/Viewer không thấy CTA; workspace admin không có membership không suy ra quyền. |
| USR-01 | Hồ sơ và tùy chọn — trang | Cho actor xem hồ sơ và chọn theme cục bộ. **Không** hiển thị giá trị múi giờ cụ thể: chưa projection nào công bố nó và `workspaces` chưa có cột, nên mọi giá trị hiện ra sẽ là bịa. Múi giờ workspace là dữ liệu **có tải trọng** — `dueDate` được định nghĩa theo nó — nên nó sẽ vào schema ở mốc dựng `tasks`, và USR-01 hiển thị giá trị thật từ lúc đó. | `/tai-khoan`, vào từ khối người dùng trên topbar | actor của session, theme preference local, workspace timezone đang chọn | Actor có phiên hợp lệ | Default, local preference saving, Error khi actor/session không hợp lệ. Display name/email chỉ đọc; timezone theo workspace chỉ đọc; đổi mật khẩu đi qua flow `AUTH-03`; không có quản lý phiên trong MVP. |
| TTS-01 | Cấu hình Time Tracking — section PRJ-03 | Owner bật/tắt, chọn mode, backfill và Editor approver. | `/du-an/:projectId/cai-dat#cham-cong` | settings/version, active Editors, capabilities | Owner | Disabled/enabled, validation, Saving, Conflict, Forbidden; không hồi tố log final. |
| WTL-01 | Nhật ký giờ của tôi — day/week | Author theo dõi WorkLog hằng ngày. | `/du-an/:projectId/gio-cua-toi` | actor logs, task scope, workspace timezone, cursor | Owner, Editor | Loading, Empty, late-date blocked, draft/submitted/approved/rejected, Error. |
| WTL-02 | Form ghi giờ — overlay | Tạo/sửa một user–task–date WorkLog. | `WTL-01`/Task Detail | task select, date, duration, description, support reason, expectedVersion | Owner, Editor | Validation daily limit/support reason/date; Saving, Conflict, Forbidden. |
| WTA-01 | Hàng chờ duyệt giờ | Review đơn lẻ/hàng loạt log submitted. | `/du-an/:projectId/phe-duyet-gio` | submitted logs/cursor, approver capability | Owner, assigned Editor | Loading, Empty, per-row conflict/denied, reject reason, bulk summary. |
| WTR-01 | Báo cáo giờ tháng | Aggregate giờ theo member/project. | `/du-an/:projectId/bao-cao-gio/thang` | selected month, authorized aggregates/drilldown | Owner, assigned Editor | Loading, Empty, Error, Forbidden; final/self/pending/rejected breakdown. |
| SYS-01 | Forbidden — full page hoặc full-region state | Báo truy cập bị từ chối mà không làm lộ dữ liệu private. | route/context bị từ chối | mã lỗi, request ID nếu API trả an toàn, đích quay lại không nhạy cảm | Bất kỳ actor nào có phiên nhưng không được phép; cả Workspace Admin chưa là project member | Forbidden. Không render dữ liệu project, board, task, comment, activity hay membership private. |
| SYS-02 | Session Expired — full page/modal hệ thống | Hướng người dùng đăng nhập lại sau khi phiên không còn hợp lệ. | mutation hoặc fetch báo phiên không hợp lệ | trạng thái phiên và đích quay lại đã kiểm tra | Actor có phiên đã hết hạn | Session expired, đang điều hướng Sign In. Không tự phát lại mutation. |
| SYS-03 | Network or Service Error — full-region state | Giải thích không thể xác nhận dữ liệu/mutation và cho phép thử lại an toàn. | bất kỳ vùng nạp/mutation nào không xác nhận được | error code/message/request ID an toàn, callback retry | Actor đang ở context được phép | Error, retrying. Giữ dữ liệu form chưa gửi; không thay Error bằng Empty. |
| SYS-04 | Conflict Resolution — modal/panel trong task context | Giúp Owner/Editor xem lại task hiện tại sau 409 mà không ghi đè ngầm. | từ `TSK-01`, `TSK-02` hoặc DnD khi nhận `409` | task hiện tại sau khi nạp lại nếu còn được phép, version hiện tại, bản nháp cục bộ | Owner, Editor; vẫn phải qua kiểm tra quyền mới | Conflict, loading-current-version, current-version-ready, Error, Forbidden, Session expired. Không có force overwrite. |
| SYS-05 | Not Found — full page | Báo route/resource không tồn tại mà không suy diễn đó là thiếu quyền. | URL không match route hoặc API trả 404 cho public-safe resource | URL hiện tại, đích quay lại an toàn | Bất kỳ actor nào | 404; CTA về Workspace List hoặc trang trước an toàn. Không render shell/data của project không resolve được. |
| SYS-06 | Service Unavailable — full page/region | Báo dịch vụ tạm không thể phục vụ request đã authorized. | API/gateway trả 503 hoặc service dependency unavailable | safe request ID, callback retry, dữ liệu đã xác nhận trước đó nếu có | Actor ở context được phép | 503, retrying, recovered. Không biến 503 thành Empty hoặc xác nhận mutation chưa commit. |

### Ba loại số đếm mà hợp đồng không mang

`pageSchema` có `nextCursor` và `hasMore`, **không** có `total`. Nên ba thứ artifact vẽ đều không dựng được: `Comments · 3` trên task card, `Đã nạp 6 / 18` ở footer column, và badge số task ở header column (`Chờ thực hiện 4`).

Frontend hiển thị `Đã nạp N · còn nữa` — đúng thứ hợp đồng mang. Đây là **cùng một khuôn mẫu** với lời hứa "số task liên quan" của `BRD-02` đã bỏ ở M3: một con số đếm được ở thời điểm đọc đã cũ vào lúc người dùng nhìn, và để có nó phải chạy `COUNT` trên mỗi lần mở board.

Quyết định cần cho vòng design kế tiếp: hoặc bỏ số đếm khỏi frame, hoặc mở `total` trong hợp đồng và chấp nhận cái giá đó. **Không** chọn cách thứ ba là để frame vẽ một số mà code không điền được.

### `MYT-01` và `PRJ-04` không thuộc M4

Cả hai rời sang M5 vì **thiếu endpoint**, không thiếu công — xem [kế hoạch triển khai](../implementation-plan.md) mục M4. `MYT-01` cần một route task cấp workspace với **một** cursor (fan-out N project cho N cursor không hợp nhất được đúng thứ tự); `PRJ-04` cần aggregate mà `pageSchema` không mang.

### `BRD-02`: đổi thứ tự là thao tác **hoãn**, các lệnh khác gửi ngay

Kéo cột chỉ sửa một bản nháp trong màn hình; **một** `POST /columns/reorder` commit nó; thất bại thì đặt lại về thứ tự server đang giữ. Đó là lý do `unsaved changes` nằm trong danh sách trạng thái bắt buộc ở trên — nếu mỗi lần kéo là một request thì trạng thái đó không mô tả gì cả, và artifact cũng đã vẽ hẳn cặp `Hủy` / `Lưu thứ tự cột`.

Ngược lại, rename, hai cờ và archive **gửi ngay**, vì mỗi cái là một command đơn của `PATCH /columns/:columnId` và không có gì để gộp.

**Không có frame nào cho trạng thái reorder đang gửi.** Frame `BRD-01 · dnd-syncing` là kéo thả **task**, không phải cột — chữ trong nó là "Đang kéo", "Đang đồng bộ vị trí mới…" và "Không chuyển được **công việc** sang …". Trạng thái đang gửi của reorder cột hiện do frontend tự dựng (loading của nút `Lưu thứ tự cột` cộng một live region), và nó nằm trong backlog vòng design kế tiếp.

## Màn hình thêm sau khi Pencil v0.1 đóng băng

`WSP-05` được thêm bởi [ADR-0013](../decisions/ADR-0013-workspace-member-invitation.md), sau khi Pencil v0.1 đã đóng băng — tài liệu quyết định hành vi, design theo sau. Nó **đã có 16 frame** ở freeze v0.2 (blob `dbf46cc8`): 10 desktop 1440 cho năm trạng thái × Light/Dark, và 6 mobile 390 cho ba trạng thái người dùng thật sự gặp trên điện thoại.

Trạng thái thứ sáu — **email không khớp** (`403`) — do hợp đồng yêu cầu và frontend đã dựng, nhưng **không có frame**. Nó nằm trong backlog vòng design kế tiếp; hành vi thì đã chốt ở [hợp đồng endpoint](../api/endpoint-contracts.md).

Một sai lệch cố ý đã ghi nhận: artifact vẽ `WSP-05` theo bố cục hai cột brand + form, frontend dựng bằng `AuthShell` (card giữa trang) như `AUTH-01`…`AUTH-05` đã làm. Giữ hai bố cục cho cùng một loại màn hình vô-phiên là tạo hai nguồn sự thật cho cùng một quyết định.

Hai điều `WSP-05` phải giữ khi được dựng, vì cả hai đều là hệ quả của hợp đồng chứ không phải lựa chọn thẩm mỹ:

- Token invalid, expired và đã dùng cho **cùng một thông điệp**. Ba thông điệp khác nhau nói cho người đang thử token rằng token nào từng tồn tại. Đây là cùng khuôn mẫu đã áp cho `AUTH-04` và `AUTH-05`.
- Người chưa đăng nhập phải **giữ được token** qua bước đăng nhập hoặc đăng ký. Nếu token mất khi chuyển màn, lời mời chỉ dùng được bởi người đã có phiên — nghĩa là người mới, đúng đối tượng của tính năng này, không vào được.

## Hợp đồng màn hình board

`BRD-01` là shell giữ lại trong suốt các lớp phủ `BRD-02`, `TSK-01`, `TSK-02` và `SYS-04`. `PRM-01` **không** còn trong danh sách này: nó là trang con có route riêng. Nó phải cung cấp các vùng sau để Pencil có thể bố trí nhất quán:

1. Context project: tên project và đường quay lại project list; dữ liệu này không xuất hiện nếu `Forbidden`.
2. Điều khiển board: filter, allowed-field search, sort và CTA đúng capability. Viewer chỉ thấy điều khiển đọc.
3. Dải cột ngang: mỗi cột có tiêu đề, danh sách task, Loading/Empty/Error riêng và `Tải thêm` khi `hasMore`.
4. Task card: title, assignee, priority, due date/dueState nếu có và dấu hiệu đồng bộ lạc quan. Không hiển thị field không nằm trong payload được phép.
5. Lớp phủ task: mở trên board, trả focus về card/CTA nguồn khi đóng.

## Ma trận khả năng nhìn thấy theo vai trò project

| Thành phần trong project | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| Board, task detail, comment, activity | Có | Có | Có, chỉ đọc |
| Tạo/sửa/giao task | Có | Có | Không |
| Drag-and-drop task | Có | Có | Không |
| Tạo comment | Có | Có | Không |
| Project Settings (chỉ đổi tên) | Có | Không | Không |
| Column editor | Có | Không | Không |
| Project members | Có | Không | Không |

Workspace Admin chưa là thành viên project không có hàng “chỉ đọc” trong ma trận này: truy cập board hay lớp phủ project phải đi tới `SYS-01 Forbidden`.

## Tập frame tối thiểu cho Pencil

Mỗi Screen ID có frame default và tất cả trạng thái được liệt kê trong bảng. Với `BRD-01`, tối thiểu cần frame desktop content, mobile horizontal content, Loading, Empty, Error và Forbidden. `PRJ-03` cần Owner-only frame Loading, default, validation, Saving, Error, Forbidden và unsaved changes; form chỉ có `name` và annotation `PATCH /projects/:projectId`. Với `TSK-01`/`TSK-02`, tối thiểu cần frame Owner hoặc Editor có thể ghi, Viewer chỉ đọc, validation/unsaved changes và Conflict. Không dùng một frame chung mang nhãn “Admin project”; phải dùng vai trò project cụ thể Owner, Editor hoặc Viewer.

## Màn hình Phase 1.4 — Sprint

| ID | Màn hình và loại | Purpose (mục đích) | Route hoặc context | API data cần | Vai trò được phép | Trạng thái bắt buộc |
|---|---|---|---|---|---|---|
| SPR-01 | Sprint Board — trang | Xem board của sprint đang chọn, gồm cột và task của đúng sprint đó. | `/du-an/:projectId/sprint/:sprintId` | sprint projection, cột active kèm `isTerminal`, task page theo từng cột với filter `sprintId`, capability sprint | Owner, Editor, Viewer | Loading, Empty, Error, Forbidden, feature disabled, sprint closed read-only. |
| SPR-02 | Backlog — trang | Quản lý task chưa thuộc sprint nào và đưa chúng vào sprint. | `/du-an/:projectId/backlog` | task page với `sprintId=backlog`, danh sách sprint `planned`/`active`, capability task update | Owner, Editor, Viewer | Loading, Empty, Error, Forbidden, kết quả từng dòng khi gán nhiều task. |
| SPR-03 | Sprint Settings — section trong PRJ-03 | Owner bật/tắt Sprint và đặt thời lượng mặc định. | `/du-an/:projectId/cai-dat#sprint` | settings/version, capability `sprint:manage` | Owner | Disabled/enabled, validation 7–28 ngày, Saving, Conflict, Forbidden. |
| SPR-04 | Đóng sprint — dialog | Buộc Owner chọn tường minh cách xử lý task chưa hoàn thành khi đóng sprint. | `SPR-01` với `action=close` | số task đang ở column `isTerminal = false`, danh sách sprint `planned` làm đích, `expectedVersion` | Owner | Default, validation thiếu sprint đích, Saving, Conflict, Error; không có carry-over ngầm. |

Sprint không tạo trục workflow thứ hai: cột board vẫn do Owner cấu hình, và `SPR-01` chỉ là cùng board đó với filter `sprintId`. Khi project chưa bật Sprint, các Screen ID này không có entry point và route trực tiếp trả về state feature-disabled/Forbidden.

## Phạm vi mobile mục tiêu (chưa có trong artifact)

> **Chưa build.** Mục này là **phạm vi cần dựng**, không phải mô tả artifact hiện có; báo cáo Canvas v0.4 đã bị rút lại — xem [pencil-handoff.md](pencil-handoff.md).

Các Screen ID sau cần frame mobile 390×844 cho **cả** Light và Dark: `AUTH-01`, `WSP-01`, `PRJ-01`, `BRD-01` (board cuộn ngang, cột kế tiếp lộ mép), `TSK-01` (full-height sheet), `TSK-02` (full-height sheet), `MYT-01`, `PRJ-04`, `USR-01`, `SYS-01`, `WTL-02`, `WTA-01` (filter drawer).

Danh sách này đã được đối chiếu với thực tế dựng: `WSP-01`, `USR-01` và `SYS-01` được thêm vào phạm vi vì chúng đã có frame mobile và đều là bề mặt người dùng gặp trên điện thoại (chọn workspace, tùy chọn cá nhân, bị từ chối quyền). `TSK-01` và `PRJ-04` vẫn thiếu và **bắt buộc phải có**: `TSK-01` vì [interaction specifications §9](interaction-specifications.md) yêu cầu task form là full-height sheet trên mobile, `PRJ-04` vì nó là màn chứa CTA `Xuất tiến độ` và nay đã có đường điều hướng trong [information architecture](information-architecture.md).

`BRD-02` Column Editor **không** thuộc phạm vi mobile bắt buộc dù [§9](interaction-specifications.md) mô tả nó dùng sheet: đây là bề mặt Owner-only ít dùng trên điện thoại, nên nó được hoãn có chủ đích. `PRM-01` cũng ngoài phạm vi, nhưng vì lý do khác: nó nay là trang con có route riêng, nên trên mobile nó là một trang bình thường chứ không cần frame sheet nào. Khi nào có nhu cầu thật thì thêm vào danh sách này trước, rồi mới dựng.

Mobile giữ nguyên Screen ID, hành vi và giới hạn quyền của desktop; khác biệt chỉ ở bố cục — sheet thay drawer/modal, board cuộn ngang, header mobile thay topbar. Không dùng bố cục mobile để bỏ bớt CTA, state hay thông tin mà bản desktop có.
