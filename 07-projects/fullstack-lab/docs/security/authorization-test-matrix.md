# Ma trận kiểm thử phân quyền Flowboard

Ma trận này là bắt buộc cho coverage ở cả unit, integration và end-to-end. Nó kiểm chứng catalog cố định trong [authorization-model.md](authorization-model.md), bao gồm cả các lần gọi HTTP trực tiếp đi vòng qua frontend.

## Fixture và quy tắc outcome

Mục tiêu là **Project B** private trong một workspace.

- **Owner**, **Editor** và **Viewer** là member của Project B với đúng role project được nêu, và đều là Workspace Member thường.
- **Workspace Admin chưa là project member** là admin trong cùng workspace nhưng không có row `project_members` nào cho Project B.
- **User A** là Workspace Member và là Owner của một Project A private khác trong cùng workspace. User A không có membership Project B và dùng các ID thuộc User B/Project B.
- **User B** là Workspace Member và là Owner của Project B. User B cung cấp các resource mục tiêu cho test ID substitution.

`Allow` nghĩa là request chỉ thành công **sau khi** qua validation bình thường và các phép kiểm concurrency/domain của nó. `Deny` nghĩa là không có business mutation, không có activity record, không có response body chứa resource được bảo vệ, và không có capability cho action đó. Request chưa xác thực nhận `401`; request tới resource nằm ngoài phạm vi project mà actor được thấy nhận `404`; một member của Project B thiếu action nhận `403`.

## Ma trận action đầy đủ

### Action ở cấp workspace

| Actor | `workspace:read` | `workspace:member:manage` | `workspace:settings:update` | `project:create` |
|---|:---:|:---:|:---:|:---:|
| Owner | Allow | Deny | Deny | Deny |
| Editor | Allow | Deny | Deny | Deny |
| Viewer | Allow | Deny | Deny | Deny |
| Workspace Admin chưa là project member | Allow | Allow | Allow | Allow |
| User A | Allow | Deny | Deny | Deny |
| User B | Allow | Deny | Deny | Deny |

### Action đọc, ghi, quản lý và export trên Project B

| Actor | `project:read` | `project:update` | `project:member:manage` | `board-column:read` | `board-column:manage` | `task:read` | `task:create` | `task:update` | `task:move` | `task:assign` | `comment:read` | `comment:create` | `activity:read` | `report:export` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Owner | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow |
| Editor | Allow | Deny | Deny | Allow | Deny | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Deny |
| Viewer | Allow | Deny | Deny | Allow | Deny | Allow | Deny | Deny | Deny | Deny | Allow | Deny | Allow | Deny |
| Workspace Admin chưa là project member | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |
| User A | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |
| User B | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow |

### Action theo phase trên Project B — Time Tracking (1.3) và Sprint (1.4)

Các permission này đã tồn tại trong catalog nên kết quả Allow/Deny của chúng được chốt từ bây giờ, dù route chỉ xuất hiện cùng phase của nó. Hai fixture actor được thêm vào vì hai trong số các permission này không phải quyền theo role thuần: một Editor **đang giữ** record `ProjectTimeApprover` cho Project B, và một Editor **không giữ**.

| Actor | `time-tracking:settings:update` | `work-log:read` | `work-log:create:self` | `work-log:update:self` | `work-log:submit:self` | `work-log:review` | `work-log:backfill:override` | `time-report:read` | `sprint:read` | `sprint:manage` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Owner | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow |
| Editor, không phải Time Approver | Deny | Allow | Allow | Allow | Allow | Deny | Deny | Deny | Allow | Deny |
| Editor, đang là Time Approver | Deny | Allow | Allow | Allow | Allow | Allow | Deny | Allow | Allow | Deny |
| Viewer | Deny | Allow | Deny | Deny | Deny | Deny | Deny | Deny | Allow | Deny |
| Workspace Admin chưa là project member | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |
| User A | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |

Ba điều kiện nằm **trên** mọi ô ở bảng trên và mỗi điều kiện phải có test riêng, vì một ô `Allow` tự nó chưa đủ để cho phép:

- **Tính năng bật theo từng project.** Mọi permission Phase 1.3 còn yêu cầu Time Tracking đang bật cho Project B, và mọi permission Phase 1.4 yêu cầu Sprint đang bật. Khi tắt, use case deny bằng `TIME_TRACKING_DISABLED` hoặc `SPRINT_DISABLED` **sau** khi resolve scope, nên người không phải member vẫn nhận `404` và không project private nào bị tiết lộ.
- **Trạng thái theo từng record.** `work-log:update:self` và `work-log:submit:self` chỉ áp dụng cho bản ghi `draft`/`rejected` của chính actor, trong cửa sổ ngày được phép hoặc khi có override còn hiệu lực; server công bố điều này thành `capabilities` theo từng record trên projection của WorkLog, và client không được tự suy lại.
- **Không bao giờ tự duyệt.** `work-log:review` deny khi `work_log.logged_by_user_id` chính là actor, kể cả với Owner. Các ô `Allow` ở trên nghĩa là "được duyệt log của author khác", không bao giờ nghĩa là "được duyệt mọi log".

Quan hệ giữa Task (Phase 1.5) **cố ý không** thêm dòng nào ở đây: đặt `parentTaskId` và thêm/xoá một dependency là những lượt `task:update` bình thường. Cái chúng thêm là coverage cho **invariant**, không phải coverage cho role — xem các test quan hệ ở dưới.

`report:export` được kiểm khi route export của Phase 1.1 tồn tại; dù vậy kết quả Owner-only của nó vẫn được chốt từ bây giờ. Sửa/xoá comment và sửa/xoá activity không có action nào trong MVP nên deny với mọi actor. Thay đổi project settings trong MVP chỉ giới hạn ở tên project.

## Các test phân quyền bắt buộc

| Test | Thiết lập và request | Kết quả mong đợi |
|---|---|---|
| Unit test cho role policy | Đánh giá `AuthorizationService.can` cho **từng ô** của cả hai ma trận. | Đúng kết quả Allow/Deny cho từng cặp actor/action; không có lượt cấp quyền ngầm từ admin sang project. |
| Integration cho decorator/guard | Route khai báo `@RequireProjectPermission('task:update')`; thử với Owner, Editor, Viewer, admin chưa là member, User A và User B. | `ProjectPermissionGuard` ra quyết định theo ma trận **trước** use case. |
| ID substitution: task | User A gửi `GET /tasks/:userBTaskId`, `PATCH /tasks/:userBTaskId` và `POST /tasks/:userBTaskId/comments`. | `404`; không body task/comment/activity, không mutation, không tín hiệu tồn tại. |
| ID substitution: column và report | User A dùng một column của Project B trong `PATCH /columns/:id`, hoặc một report ID của Project B trong `GET /reports/:id` và download. | `404`; resolver scope resource về Project B **trước** khi gọi repository. |
| Parent/child ID không khớp | Actor gửi một route ID của Project A cùng với task, comment, column hay report ID của Project B. | Deny (`404` cho resource ngoài scope); parent ID do client gửi không bao giờ ghi đè ownership đã resolve. |
| Viewer gọi mutation trực tiếp qua HTTP | Viewer gọi thẳng project update, quản lý member, quản lý column, task create/update/move/assign, comment create và route export. | `403`; việc frontend ẩn hay disable là không liên quan; không có side effect và không có activity row nào. |
| Admin chưa là member gọi mutation trực tiếp | Workspace Admin chưa có membership Project B gọi mọi route của Project B, kể cả các lượt đọc. | `404`; quản trị workspace không tiết lộ và không cấp nội dung Project B. |
| Cưỡng chế query scope | Gọi từng project repository với scope Project B đã authorize nhưng truyền ID của User A/Project A, rồi soi SQL/điều kiện query sinh ra. | Không row nào được đọc hay ghi trừ khi resource cũng khớp `project_id` đã authorize; comment join qua task đã scope. |
| Update field ẩn | Owner hoặc Editor gửi `projectId`, `columnId`, `position`, `version`, timestamp, audit field hay key nào khác ngoài allowlist tới `PATCH /tasks/:id`. | Lỗi validation `400`; không mutation. `columnId`/`position` bắt buộc dùng endpoint move riêng đã authorize, và `version` do server điều khiển (chỉ `expectedVersion` là precondition). |
| Assign/move xuyên project | Owner hoặc Editor thử giao task cho người không phải member, hoặc move task vào một column của Project A. | Reject trước commit; không có update xuyên project và không có activity row. |
| Capability trong response | Lấy Project B bằng từng actor rồi soi `capabilities`. | Chỉ xuất hiện các action Project B được phép do server tính; admin chưa là member và User A không nhận dữ liệu hay capability nào của Project B. |
| Invariant một sprint active | Activate đồng thời hai sprint `planned` khác nhau của Project B với vai Owner. | Đúng một cái commit; cái còn lại thất bại ở partial unique index và trả `409 SPRINT_ALREADY_ACTIVE`. Không dùng advisory lock, và không bao giờ tồn tại sprint active thứ hai. |
| Sprint đã đóng là bất biến | Gán một task vào sprint `closed`, và sửa chính sprint đó, với vai Owner. | Cả hai bị deny bằng `409 SPRINT_CLOSED`; không mutation task/sprint và không activity row. |
| Cycle dependency dưới điều kiện đồng thời | Dựng chuỗi A→B→…→N trong Project B, rồi gửi hai request đồng thời mà mỗi cái đều đóng chu trình về A. | Advisory lock theo project tuần tự hoá chúng; không request nào tạo được cycle, cái thua trả `409 TASK_DEPENDENCY_CYCLE`, và số cạnh vẫn trong biên. |
| Giới hạn độ sâu subtask | Gán cha cho một task, rồi thử biến subtask đó thành cha của một task thứ ba, và thử gán cha cho một task đã có con. | Cả hai bị reject bằng `400 VALIDATION_FAILED` trước commit; độ sâu cha–con không bao giờ vượt một cấp. |
| Quan hệ xuyên project | Đặt `parentTaskId` trỏ tới một task của Project A, và thêm một dependency mà phía còn lại là task của Project A, với vai Owner của Project B. | Bị composite foreign key và phép kiểm scope reject trước mọi lượt ghi; response không bao giờ xác nhận task của Project A có tồn tại. |
| Phơi field trong response | Kiểm schema của success, `403` và `404` cho route project/task/comment/activity/report. | Response đã authorize chỉ chứa field thuộc allowlist của endpoint và capabilities của project hiện tại. Chúng không bao giờ phơi password hash, session ID thô hay đã hash, reset/verification token hay hash của chúng, CSRF secret, dữ liệu/số đếm private của project khác, audit payload nội bộ, hay tín hiệu tồn tại của resource bị từ chối. Response bị deny chỉ chứa error envelope chuẩn. |

## Hồi quy về authentication/bảo mật gắn với phân quyền

| Test | Kết quả mong đợi |
|---|---|
| Lưu trữ opaque session | Sign-in set một cookie opaque `HttpOnly`; database chỉ chứa hash, và không tìm thấy giá trị cookie thô trong storage hay log fixture. |
| Vòng đời session | Session đã hết hạn, đã revoke, đã logout, đã reset password và đã đổi password đều bị `SessionGuard` từ chối; reset/change revoke mọi session trước đó. |
| Hợp đồng cookie | Cookie production có `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, phạm vi host-only và expiry tường minh. |
| CSRF | Một protected mutation thiếu `X-CSRF-Token` hợp lệ gắn session, hoặc thiếu origin được phép, bị từ chối và không tạo mutation/activity record. |
| Vòng đời token | Reset và verification token đều được hash, dùng một lần, có expiry, và thất bại khi bị gửi lại. |
| Rate limiting | Các lần thử sign-in và reset password liên tiếp bị chặn có biên mà không làm lộ sự tồn tại của account. |

Bộ test phải chạy cả coverage API trực tiếp và các phép kiểm UI theo role. Test UI chứng minh frontend dùng `can(action, resource)` cho affordance; chúng không bao giờ thay thế cho `SessionGuard`, `ResourceProjectResolver`, `ProjectPermissionGuard`, `AuthorizationService`, `RequireProjectPermission` hay scoped repository query.
