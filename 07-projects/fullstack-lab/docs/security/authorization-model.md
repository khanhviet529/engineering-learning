# Mô hình phân quyền Flowboard

Tài liệu này là hợp đồng kiểm soát truy cập trung tâm cho frontend, NestJS guard, repository, test và AI tool tương lai. Nó là thẩm quyền về hành vi role của MVP; UI chỉ phản ánh quyết định do server tính.

## Phạm vi, role và mặc định

Flowboard là sản phẩm theo tenant workspace. Một user phải là member của workspace trước khi được thêm vào một project của workspace đó. Mọi project MVP đều private: không có fallback nào cho anonymous, cho toàn workspace, hay cho public project.

Role workspace là cố định:

| Role workspace | Hành vi workspace được phép | Ảnh hưởng tới nội dung project |
|---|---|---|
| Workspace Admin | Đọc workspace của mình, quản lý membership và settings của workspace, và tạo project. | Không có gì tự thân. Admin còn phải là Project Member mới đọc hoặc thay đổi được một project private. |
| Workspace Member | Đọc workspace của mình và được thêm vào project. | Không có gì tự thân. |

Role project là cố định và được version-control trong application code. Người tạo project là Owner của project đó. Một project phải luôn còn ít nhất một Owner; việc gỡ hoặc hạ quyền làm mất Owner cuối cùng bị từ chối. Workspace Admin không bao giờ được tự thêm hay tự nâng quyền trong một project.

| Role project | Đọc nội dung project | Ghi task/comment | Quản lý project | Export |
|---|:---:|:---:|:---:|:---:|
| Owner | Có | Có | Cột, thành viên và project settings | Có, bắt đầu từ Phase 1.1 |
| Editor | Có | Task và comment | Không | Không |
| Viewer | Có | Không | Không | Không |

Phân quyền là **deny by default**. Một action chỉ được phép khi actor có session hợp lệ, nằm trong đúng phạm vi workspace và project, và có đúng permission cố định đó. Thiếu membership, resource không resolve được, action không nằm trong danh sách dưới đây, resource thuộc project khác, hay một tính năng tương lai chưa hỗ trợ — tất cả đều bị từ chối.

## Permission catalog

Các permission project sau đây là catalog đầy đủ của MVP:

| Permission | Owner | Editor | Viewer | Ý nghĩa |
|---|:---:|:---:|:---:|---|
| `project:read` | Allow | Allow | Allow | Đọc project và metadata được phép của nó. |
| `project:update` | Allow | Deny | Deny | Đổi project settings; MVP chỉ cho đổi tên project. |
| `project:member:manage` | Allow | Deny | Deny | Thêm, đổi role hoặc gỡ project member, tuân theo các invariant về membership. |
| `board-column:read` | Allow | Allow | Allow | Đọc board column active của project. |
| `board-column:manage` | Allow | Deny | Deny | Tạo, sắp lại hoặc archive cột. |
| `task:read` | Allow | Allow | Allow | Đọc task trong project. |
| `task:create` | Allow | Allow | Deny | Tạo task trong một cột active cùng project. |
| `task:update` | Allow | Allow | Deny | Cập nhật các task content field thuộc allowlist. |
| `task:move` | Allow | Allow | Deny | Di chuyển task qua use case move riêng. |
| `task:assign` | Allow | Allow | Deny | Giao task cho một member cùng project. |
| `comment:read` | Allow | Allow | Allow | Đọc comment của một task đã được authorize. |
| `comment:create` | Allow | Allow | Deny | Thêm comment. Comment là bất biến trong MVP. |
| `activity:read` | Allow | Allow | Allow | Đọc activity append-only của project/task. |
| `report:export` | Allow | Deny | Deny | Yêu cầu và tải export tiến độ project ở Phase 1.1. |
| `sprint:read` | Allow | Allow | Allow | Đọc sprint và board theo sprint ở Phase 1.4, khi project đã bật tính năng. |
| `sprint:manage` | Allow | Deny | Deny | Tạo, sửa, activate và đóng sprint, và đổi sprint settings, ở Phase 1.4. |
| `time-tracking:settings:update` | Allow | Deny | Deny | Bật/tắt, chọn mode, đặt backfill và danh sách Time Approver ở Phase 1.3. |
| `work-log:read` | Allow | Allow | Allow | Đọc WorkLog đã được authorize của project/task khi tính năng đang bật. |
| `work-log:create:self` | Allow | Allow | Deny | Tạo bản ghi do chính actor là author; không cập nhật Task. |
| `work-log:update:self` | Allow | Allow | Deny | Sửa bản ghi `draft`/`rejected` của chính actor, chỉ trong cửa sổ ngày được phép. |
| `work-log:submit:self` | Allow | Allow | Deny | Gửi hoặc tự chốt bản ghi hợp lệ của chính actor. |
| `work-log:review` | Allow | Editor được chỉ định | Deny | Duyệt WorkLog `submitted` của người khác trong mode cần duyệt. |
| `work-log:backfill:override` | Allow | Deny | Deny | Mở quyền ghi ngày quá hạn, có biên và có lý do. |
| `time-report:read` | Allow | Editor được chỉ định | Deny | Đọc aggregate tháng của Phase 1.3 trong phạm vi project. |

Quản trị workspace là một phạm vi riêng: `workspace:read` mở cho cả hai role workspace; `workspace:member:manage`, `workspace:settings:update` và `project:create` yêu cầu Workspace Admin. Những khả năng ở cấp workspace đó **không** hàm ý bất kỳ entry nào trong catalog của project.

Các ma trận role/visibility trong [screen inventory](../design/screen-inventory.md) và [information architecture](../design/information-architecture.md) là **phái sinh** của catalog này, không bao giờ là nguồn độc lập. Khi bất kỳ ma trận nào lệch với catalog thì catalog thắng, và ma trận phái sinh là tài liệu phải sửa. Một thay đổi permission chưa hoàn tất khi hai ma trận phái sinh đó chưa được kiểm lại; [chiến lược kiểm thử](../operations/testing-strategy.md) giữ test cưỡng chế điều này.

### Điều kiện của Sprint (Phase 1.4)

`sprint:read` và `sprint:manage` còn yêu cầu project đã bật Sprint trong `project_sprint_settings`. Khi tắt, các route sprint deny bằng `SPRINT_DISABLED` **sau** khi resolve scope, đúng như Time Tracking đang làm, và không projection nào có field sprint. Gán task vào sprint là một `task:update` bình thường nên nó không cần permission sprint riêng; một sprint đã `closed` không nhận thêm gán task bất kể role. Viewer vẫn read-only, và Workspace Admin chưa là ProjectMember vẫn nằm ngoài mọi route sprint.

### Điều kiện của Time Tracking (Phase 1.3)

`work-log:review` và `time-report:read` của Editor không phải permission theo role thuần: `AuthorizationService` còn yêu cầu một record `ProjectTimeApprover` hiện hành cho đúng project đó. Owner là approver ngầm định. Người duyệt phải khác `work_log.logged_by_user_id`; tự duyệt log của chính mình bị từ chối kể cả khi actor là Owner. Khi Time Tracking đang tắt, các use case write/review/report deny bằng `TIME_TRACKING_DISABLED` sau khi resolve scope.

Viewer giữ nguyên hợp đồng read-only của core: Viewer chỉ đọc được WorkLog khi tính năng của project đang bật và khi phạm vi đọc project/task bình thường cho phép, nhưng không tạo, không sửa, không gửi, không duyệt, không override và không nhận CTA báo cáo tháng. Workspace Admin chưa là ProjectMember vẫn nằm ngoài mọi route Time Tracking.

## Luồng phân quyền ở mức object

Mọi endpoint nhận ID của project, task, comment, column hay report đều đi theo trình tự sau. **ID là locator, không bao giờ là bằng chứng có quyền.**

```text
request
  -> SessionGuard
  -> ResourceProjectResolver
  -> ProjectPermissionGuard (@RequireProjectPermission)
  -> use case domain validation
  -> scoped repository query/mutation
```

1. **`SessionGuard`** xác thực opaque server session và đặt actor. Nó trả `401` khi không có session hợp lệ.
2. **`ResourceProjectResolver`** resolve resource của route về project sở hữu nó. Project ID resolve trực tiếp; task resolve qua `task.project_id`; comment qua task của nó; column qua `column.project_id`; report qua `report.project_id`. Nó không bao giờ tin một `projectId` do client gửi mà mâu thuẫn với owner đã resolve được.
3. **`ProjectPermissionGuard`** nhận permission bắt buộc do **`RequireProjectPermission`** khai báo rồi gọi **`AuthorizationService.can(actor, action, resource)`**. Nó kiểm workspace membership, project membership, quan hệ resource-với-project, và mapping role cố định. Guard trả `404` cho resource nằm ngoài phạm vi project mà actor được thấy, nên nó không xác nhận sự tồn tại của một project private khác; nó trả `403` khi một project member thấy được project nhưng thiếu action được yêu cầu.
4. Use case của application vẫn cưỡng chế quy tắc miền: cột đích active, assignee cùng project, bảo vệ Owner cuối cùng, comment/activity bất biến, optimistic concurrency, và các field thuộc allowlist.
5. Repository dùng đúng phạm vi project đã được authorize cho mọi lượt đọc và ghi. Guard đi qua thành công **không** phải giấy phép để phát một query không scope.

`AuthorizationService` là bộ đánh giá policy duy nhất. Controller và AI tool tương lai cung cấp actor, một action trong catalog, và một resource đã resolve; chúng không tự viết câu `if` theo role. Resource identity hay role claim do AI sinh ra đều là **không đáng tin** và được resolve rồi authorize độc lập qua đúng luồng này.

## Hợp đồng repository đã scope

Một query hoặc mutation của repository trên dữ liệu project nhận `projectId`/phạm vi project đã được authorize, không nhận một resource ID trần tùy ý. Tối thiểu nó áp các predicate sau:

| Resource | Phạm vi project bắt buộc |
|---|---|
| Project | `projects.id = :projectId` sau khi authorize project membership. |
| Board column | `board_columns.project_id = :projectId`. |
| Task | `tasks.project_id = :projectId`. |
| Comment | Join task và yêu cầu `tasks.project_id = :projectId`. |
| Activity log / report export | `activity_logs.project_id = :projectId` / `report_exports.project_id = :projectId`. |

Repository đã scope còn áp các allowlist cố định về field/filter/sort của endpoint. Ví dụ, task update từ chối `projectId`, `columnId`, `position`, `version`, timestamp và audit field; di chuyển task là transaction `task:move` riêng. Lớp phòng vệ nhiều tầng này ngăn một lần ID substitution, một payload có hidden field, hay một query vô tình không scope vượt qua ranh giới project.

## Capabilities cho frontend

Response của project có kèm capabilities do server tính cho đúng actor đã xác thực và đúng project đó, ví dụ:

```json
{
  "project": { "id": "project-uuid", "name": "Launch" },
  "capabilities": ["project:read", "task:create", "task:update", "task:move", "task:assign", "comment:create"]
}
```

Frontend chỉ phơi ra một primitive, **`can(action, resource)`**, đọc các capability đó để ẩn hoặc disable control không khả dụng và để optimistic UI không thử một action đã biết chắc bị từ chối. Nó không nhân bản mapping role vào page component, và nó không coi một capability response là thẩm quyền sau khi server đã từ chối. API vẫn là điểm quyết định cuối cùng; giá trị capability được server tính lại ở mỗi response liên quan.

Một danh sách phẳng ở mức project **không** biểu diễn được permission phụ thuộc trạng thái của từng record. `work-log:update:self` và `work-log:submit:self` phụ thuộc status và cửa sổ ngày của chính WorkLog đó; `work-log:review` phụ thuộc việc author của WorkLog đó khác actor. Với những permission này, server tính một **danh sách `capabilities` theo từng record, đặt ngay trên projection của resource** — ví dụ một WorkLog item mang `"capabilities": ["work-log:update:self", "work-log:submit:self"]` — đánh giá theo đúng các điều kiện Time Tracking ở trên. Thứ tự resolve của `can(action, resource)`: khi projection của resource đã resolve có `capabilities` riêng thì danh sách đó quyết định affordance cho các action ở mức record; nếu không thì danh sách ở mức project quyết định. Frontend **không bao giờ** tự suy lại các giá trị này từ status, ngày hay author — làm vậy là nhân bản policy xuống client, điều mà tài liệu này cấm.

## Các primitive sẽ implementation

| Primitive | Trách nhiệm |
|---|---|
| `SessionGuard` | Xác thực opaque session đã hash và thiết lập actor. |
| `ResourceProjectResolver` | Resolve resource của route về project sở hữu nó, trước khi authorize. |
| `RequireProjectPermission` | Decorator ở controller, khai báo một action trong catalog, ví dụ `task:update`. |
| `ProjectPermissionGuard` | Cưỡng chế action đã khai báo, đối chiếu với actor và resource project đã resolve. |
| `AuthorizationService` | Cung cấp phép đánh giá policy dùng chung `can(actor, action, resource)`. |
| Scoped repository query | Áp predicate project đã được authorize vào mọi lượt đọc/ghi dữ liệu project. |
| `can(action, resource)` | Capability helper của frontend; chỉ là tầng affordance, không bao giờ là quyết định authorization của server. Đọc `capabilities` trên chính projection của resource khi có (action ở mức record), nếu không thì đọc danh sách ở mức project. |
