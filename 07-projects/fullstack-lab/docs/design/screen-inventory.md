# Danh mục màn hình Flowboard

## Quy ước ổn định

Screen ID là khóa bền vững cho frame Pencil, test end-to-end, ticket frontend và tài liệu bàn giao. Không đổi ID khi đổi nhãn hoặc bố cục. Màn hình có thể là trang, drawer, modal hoặc full-region state; loại hiển thị được ghi rõ để Pencil không biến lớp phủ thành route mới.

`API data cần` mô tả dữ liệu đã được baseline yêu cầu, không mở rộng thành hợp đồng endpoint mới. Dữ liệu project luôn bao gồm capability do server tính cho actor hiện tại; client không tự tính lại role rules. Các endpoint được nêu tên chỉ là những endpoint đã có trong baseline.

| ID | Màn hình và loại | Purpose (mục đích) | Route hoặc context | API data cần | Vai trò được phép | Trạng thái bắt buộc |
|---|---|---|---|---|---|---|
| AUTH-01 | Sign In — trang | Xác thực người dùng và bắt đầu một phiên an toàn. | `/sign-in` | trạng thái phiên, phản hồi đăng nhập | Chưa xác thực | Default, validation, Loading, `401 UNAUTHENTICATED` generic, `403 EMAIL_VERIFICATION_REQUIRED` (xóa password, sang `AUTH-05`, không có session/private data), Error, Session expired sau khi quay lại. |
| AUTH-02 | Sign Up — trang | Tạo tài khoản để người dùng có thể bắt đầu xác thực. | `/sign-up` | phản hồi đăng ký/xác minh | Chưa xác thực | Default, validation, Loading, Error, completed. |
| AUTH-03 | Password Reset Request — trang | Yêu cầu luồng đặt lại mật khẩu mà không tiết lộ tài khoản tồn tại. | `/password/forgot` | phản hồi yêu cầu reset | Chưa xác thực | Default, validation, Loading, Error, completed không tiết lộ email có tồn tại. |
| AUTH-04 | Password Reset Confirm — trang | Đặt mật khẩu mới bằng token reset hợp lệ. | `/password/reset` | trạng thái token reset, phản hồi đặt lại | Chưa xác thực | Default, token invalid/expired, validation, Loading, Error, completed. |
| AUTH-05 | Email Verification — trang | Hoàn tất xác minh email trước khi vào dữ liệu private. | `/email/verify` | trạng thái token/xác minh email | Chưa xác thực hoặc tài khoản cần xác minh | Loading, verified, token invalid/expired, Error. |
| WSP-01 | Workspace List — trang | Chọn workspace mà người dùng là thành viên. | `/workspaces` | `GET /workspaces`: workspace người dùng là thành viên; dữ liệu phiên | Phiên hợp lệ | Loading, Empty, Error, Forbidden nếu phiên không còn hợp lệ. |
| WSP-02 | Workspace Create — modal/trang con | Tạo workspace mới khi server cho phép. | từ Workspace List | phản hồi tạo workspace | Actor được server cho phép tạo workspace | Default, validation, Loading, Error, completed. |
| WSP-03 | Workspace Members — panel/trang con | Để Workspace Admin quản lý membership ở đúng cấp workspace. | context `/workspaces/:workspaceId` | `GET /workspaces/:workspaceId/members`, phản hồi thêm/gỡ member và capability workspace | Workspace Admin của workspace | Loading, Empty, Error, Forbidden, mutation pending. |
| WSP-04 | Workspace Settings — trang/panel có chặn phạm vi | Cung cấp điểm vào admin cho setting workspace khi hợp đồng cụ thể đã có. | context `/workspaces/:workspaceId` | metadata workspace và capability do server trả; trường chỉnh sửa chỉ xuất hiện khi hợp đồng dữ liệu đã xác định | Workspace Admin của workspace | Loading, Error, Forbidden. Không có form/CTA lưu được suy diễn trong Task 3. |
| PRJ-01 | Project List — trang | Chọn project private mà actor được phép đọc trong workspace. | `/workspaces/:workspaceId` | project trong workspace mà actor được phép đọc, capability tạo project | Thành viên workspace; dữ liệu chỉ theo membership project | Loading, Empty, Error, Forbidden. Empty không suy ra project private khác. |
| PRJ-02 | Project Create — modal/trang con | Tạo project private trong workspace và đưa người tạo thành Owner. | context workspace | phản hồi tạo project; workspace đã chọn | Workspace Admin | Default, validation, Loading, Error, completed. Người tạo thành Owner của project mới. |
| PRJ-03 | Project Settings — trang | Để Owner đổi duy nhất tên project, không thêm setting hay action project khác. | `/projects/:projectId/settings` | `GET /projects/:projectId`: tên/capability project; `PATCH /projects/:projectId` chỉ với `name` | Owner | Loading, default, validation, Saving, Error, Forbidden, unsaved changes; không có description, visibility, deletion/destructive action hay setting khác. |
| BRD-01 | Project Board — trang chính | Điều phối và theo dõi task theo cột trong project được phép đọc. | `/projects/:projectId/board` | project/board được phép đọc, cột active có thứ tự, task theo từng cột với `items`, `nextCursor`, `hasMore`, capability, thành viên project cho assignee | Owner, Editor, Viewer của project | Loading, Empty theo cột/filter, Error, Forbidden, per-column loading-more, mobile horizontal. |
| BRD-02 | Column Editor — drawer/modal | Để Owner cấu hình cột board trong đúng project. | `BRD-01` với `panel=columns` | cột active, vị trí, số task liên quan nếu cần chặn archive, capability quản lý cột | Owner | Loading, Empty, validation, mutation pending, Error, Forbidden, archive blocked vì cột còn task, unsaved changes. |
| TSK-01 | Task Form — drawer/modal | Tạo hoặc sửa task được phép trong ngữ cảnh board. | `BRD-01` với task mới hoặc task đang sửa | cột project cùng `requiresReviewer`, assignee/reviewer là project member, category/priority allowlist, date range, trường task hiện có khi sửa, `version`, capability ghi task | Owner, Editor | Default, validation date range/reviewer, Loading dữ liệu sửa, saving, Error, Forbidden, Conflict, unsaved changes. |
| TSK-02 | Task Detail — drawer/modal | Đọc task, comment và activity; cho phép ghi theo capability. | `BRD-01?task=:taskId` | `GET /tasks/:taskId`, task/version, comment immutable, `GET /tasks/:taskId/activity`, capability | Owner, Editor, Viewer | Loading, content, comment Empty, activity Empty, Error, Forbidden, comment pending/error, edit Conflict. |
| PRM-01 | Project Members — drawer/modal hoặc trang con | Để Owner quản lý membership và vai trò của project hiện tại. | project context với `panel=members` | thành viên project/role, danh sách ứng viên đã là member workspace, capability quản lý project member | Owner | Loading, Empty, Error, Forbidden, mutation pending, điều kiện chặn “chưa là thành viên workspace”. |
| MYT-01 | My Tasks — list/calendar | Giúp actor xem task được giao theo hạn và khoảng ngày. | `/my-tasks` | task authorized có `assigneeId = actor`, start/due date, priority, dueState, cursor; workspace timezone | Owner, Editor, Viewer theo task họ được phép đọc | Loading, Empty, Error, due-state filter, multi-day span, mobile list fallback. |
| PRJ-04 | Project Dashboard — read-only | Theo dõi aggregate tiến độ, overdue và workload project. | `/projects/:projectId/overview` | authorized project task aggregates theo column/dueState/assignee, workspace timezone | Owner, Editor, Viewer của project | Loading, Empty, Error, Forbidden; Viewer chỉ đọc. |
| RPT-01 | Xuất tiến độ — CTA/panel trên Dashboard | Để Owner tạo và tải XLSX tiến độ theo filter snapshot đã được cho phép. | `PRJ-04` với `panel=progress-export` | capability `report:export`, filter canonical, `POST /projects/:projectId/reports/progress-export`, metadata export authorized | Owner trong Phase 1.1 | Default, request pending, ready/download, failed, expired, Forbidden. Editor/Viewer không thấy CTA; workspace admin không có membership không suy ra quyền. |
| USR-01 | Hồ sơ và tùy chọn — trang | Cho actor xem hồ sơ, chọn theme cục bộ và thấy múi giờ dữ liệu đang dùng. | `/account/settings` từ footer sidebar | actor của session, theme preference local, workspace timezone đang chọn | Actor có phiên hợp lệ | Default, local preference saving, Error khi actor/session không hợp lệ. Display name/email chỉ đọc; timezone theo workspace chỉ đọc; đổi mật khẩu đi qua flow `AUTH-03`; không có quản lý phiên trong MVP. |
| TTS-01 | Cấu hình Time Tracking — section PRJ-03 | Owner bật/tắt, chọn mode, backfill và Editor approver. | `/projects/:projectId/settings#time-tracking` | settings/version, active Editors, capabilities | Owner | Disabled/enabled, validation, Saving, Conflict, Forbidden; không hồi tố log final. |
| WTL-01 | Nhật ký giờ của tôi — day/week | Author theo dõi WorkLog hằng ngày. | `/projects/:projectId/my-work-logs` | actor logs, task scope, workspace timezone, cursor | Owner, Editor | Loading, Empty, late-date blocked, draft/submitted/approved/rejected, Error. |
| WTL-02 | Form ghi giờ — overlay | Tạo/sửa một user–task–date WorkLog. | `WTL-01`/Task Detail | task select, date, duration, description, support reason, expectedVersion | Owner, Editor | Validation daily limit/support reason/date; Saving, Conflict, Forbidden. |
| WTA-01 | Hàng chờ duyệt giờ | Review đơn lẻ/hàng loạt log submitted. | `/projects/:projectId/time-approvals` | submitted logs/cursor, approver capability | Owner, assigned Editor | Loading, Empty, per-row conflict/denied, reject reason, bulk summary. |
| WTR-01 | Báo cáo giờ tháng | Aggregate giờ theo member/project. | `/projects/:projectId/time-reports/monthly` | selected month, authorized aggregates/drilldown | Owner, assigned Editor | Loading, Empty, Error, Forbidden; final/self/pending/rejected breakdown. |
| SYS-01 | Forbidden — full page hoặc full-region state | Báo truy cập bị từ chối mà không làm lộ dữ liệu private. | route/context bị từ chối | mã lỗi, request ID nếu API trả an toàn, đích quay lại không nhạy cảm | Bất kỳ actor nào có phiên nhưng không được phép; cả Workspace Admin chưa là project member | Forbidden. Không render dữ liệu project, board, task, comment, activity hay membership private. |
| SYS-02 | Session Expired — full page/modal hệ thống | Hướng người dùng đăng nhập lại sau khi phiên không còn hợp lệ. | mutation hoặc fetch báo phiên không hợp lệ | trạng thái phiên và đích quay lại đã kiểm tra | Actor có phiên đã hết hạn | Session expired, đang điều hướng Sign In. Không tự phát lại mutation. |
| SYS-03 | Network or Service Error — full-region state | Giải thích không thể xác nhận dữ liệu/mutation và cho phép thử lại an toàn. | bất kỳ vùng nạp/mutation nào không xác nhận được | error code/message/request ID an toàn, callback retry | Actor đang ở context được phép | Error, retrying. Giữ dữ liệu form chưa gửi; không thay Error bằng Empty. |
| SYS-04 | Conflict Resolution — modal/panel trong task context | Giúp Owner/Editor xem lại task hiện tại sau 409 mà không ghi đè ngầm. | từ `TSK-01`, `TSK-02` hoặc DnD khi nhận `409` | task hiện tại sau khi nạp lại nếu còn được phép, version hiện tại, bản nháp cục bộ | Owner, Editor; vẫn phải qua kiểm tra quyền mới | Conflict, loading-current-version, current-version-ready, Error, Forbidden, Session expired. Không có force overwrite. |
| SYS-05 | Not Found — full page | Báo route/resource không tồn tại mà không suy diễn đó là thiếu quyền. | URL không match route hoặc API trả 404 cho public-safe resource | URL hiện tại, đích quay lại an toàn | Bất kỳ actor nào | 404; CTA về Workspace List hoặc trang trước an toàn. Không render shell/data của project không resolve được. |
| SYS-06 | Service Unavailable — full page/region | Báo dịch vụ tạm không thể phục vụ request đã authorized. | API/gateway trả 503 hoặc service dependency unavailable | safe request ID, callback retry, dữ liệu đã xác nhận trước đó nếu có | Actor ở context được phép | 503, retrying, recovered. Không biến 503 thành Empty hoặc xác nhận mutation chưa commit. |

## Hợp đồng màn hình board

`BRD-01` là shell giữ lại trong suốt các lớp phủ `BRD-02`, `TSK-01`, `TSK-02`, `PRM-01` và `SYS-04`. Nó phải cung cấp các vùng sau để Pencil có thể bố trí nhất quán:

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
