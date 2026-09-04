# Hợp đồng endpoint Flowboard

Các endpoint dưới đây là use case cụ thể của Flowboard. Mọi JSON success/error dùng [api-conventions.md](api-conventions.md); list, task concurrency và retry dùng [pagination-concurrency-idempotency.md](pagination-concurrency-idempotency.md). Quyền action là catalog ở [authorization-model.md](../security/authorization-model.md), và phase reporting theo [delivery-roadmap.md](../product/delivery-roadmap.md).

## Hình dạng resource trả về

Các response chỉ trả projection cần cho use case:

```json
{
  "workspace": { "id": "uuid", "name": "Engineering", "role": "workspace_admin", "capabilities": ["workspace:read", "project:create"] },
  "project": { "id": "uuid", "workspaceId": "uuid", "name": "Launch", "createdAt": "2026-09-01T08:30:00Z", "updatedAt": "2026-09-01T08:30:00Z" },
  "column": { "id": "uuid", "projectId": "uuid", "name": "In progress", "requiresReviewer": false, "isTerminal": false, "position": "100.0000000000", "archivedAt": null },
  "task": { "id": "uuid", "projectId": "uuid", "columnId": "uuid", "createdBy": { "id": "uuid", "displayName": "Mai" }, "assigneeId": null, "reviewerId": null, "title": "Prepare launch", "description": "", "category": "feature", "priority": "medium", "startDate": null, "dueDate": null, "dueState": "none", "evidenceUrl": null, "sprintId": null, "position": "100.0000000000", "version": 1, "createdAt": "2026-09-01T08:30:00Z", "updatedAt": "2026-09-01T08:30:00Z" },
  "member": { "userId": "uuid", "displayName": "Mai", "email": "mai@example.test", "role": "editor" },
  "comment": { "id": "uuid", "taskId": "uuid", "author": { "id": "uuid", "displayName": "Mai" }, "body": "I will take this.", "createdAt": "2026-09-01T08:30:00Z" },
  "activity": { "id": "uuid", "taskId": "uuid-or-null", "actor": { "id": "uuid", "displayName": "Mai" }, "action": "task.created", "summary": "Created task", "createdAt": "2026-09-01T08:30:00Z" }
}
```

`position` chỉ được trả khi rendering board cần thứ tự đã xác nhận. `requiresReviewer` và `isTerminal` luôn có trong column projection: client cần `requiresReviewer` để hiện field reviewer ở `TSK-01` và gửi `reviewerId` trong move, và cần `isTerminal` để render affordance hoàn thành cùng ngữ cảnh mở lại task. Cả hai là điều kiện UI đã có trong hợp đồng, không phải cờ do client tự suy; riêng `isTerminal` **không** được biểu diễn như một giá trị `dueState`. `activity.summary` do server dựng từ event payload allowlisted, không-secret; raw `payload` không bao giờ đến client. Response project detail/board gói `project` cùng `capabilities` do server tính, `columns` active, `members` project có thể làm assignee và task page có giới hạn theo column. Không response nào lộ project private cho Workspace Admin chưa có project membership tường minh.

Mọi protected mutation hoàn tất authentication/resource authorization trước transaction, rồi re-check domain invariant có thể đổi trong transaction. Business mutation thành công ghi ActivityLog event đã nêu trong chính transaction; mutation bị reject/rollback không ghi event nào. Mutation yêu cầu `Idempotency-Key` tuân theo [idempotency contract](api-conventions.md#idempotency-key): retry cùng key/fingerprint replay outcome đã lưu, cùng key khác fingerprint là `409 IDEMPOTENCY_KEY_REUSED`, retry đồng thời khi request gốc đang chạy là `409 IDEMPOTENCY_IN_PROGRESS`.


## Danh mục error code

Bảng này là **danh mục đầy đủ** các `error.code` đã công bố, đặt tại đây vì endpoint contract là owner của code nghiệp vụ. [API conventions](api-conventions.md) chốt hành vi chung của envelope và **không** nhân bản danh sách này; khi thêm code mới thì thêm vào đúng một chỗ: bảng dưới đây.

| `error.code` | Status | Có `details`? | Ai phát ra | Client phải làm gì |
|---|:---:|:---:|---|---|
| `VALIDATION_FAILED` | 400 | field-error array | Mọi endpoint | Render lỗi theo từng field; sửa input rồi gửi lại. |
| `UNAUTHENTICATED` | 401 | Không | Mọi endpoint cần session | Về sign-in; không tự phát lại mutation cũ. |
| `EMAIL_VERIFICATION_REQUIRED` | 403 | Không | `POST /auth/sign-in` | Xóa password, sang `AUTH-05`; không retry sign-in. |
| `FORBIDDEN` | 403 | Không | Mọi endpoint project-data | Bỏ affordance; không thử lại cùng request. |
| `NOT_FOUND` | 404 | Không | Mọi endpoint project-data | Về route an toàn; **không** suy ra resource có tồn tại. |
| `TASK_VERSION_CONFLICT` | 409 | `{ currentVersion }` | `PATCH /tasks/:taskId`, `POST /tasks/:taskId/move` | Hoàn nguyên optimistic, tải bản hiện tại, gửi lại bằng ý định mới (`expectedVersion` mới + key mới). |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Không | Mọi mutation có `Idempotency-Key` | Đây là **bug client**: đã dùng lại key cho payload khác. Không hiện nhánh UI riêng. |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Không | Mọi mutation có `Idempotency-Key` | Chờ theo `Retry-After` rồi gửi lại **cùng key**. |
| `COLUMN_NOT_EMPTY` | 409 | Không | `PATCH /columns/:columnId` (archive) | Yêu cầu di chuyển hết task trước; không tự move task. |
| `PROJECT_LAST_OWNER` | 409 | Không | `PATCH`/`DELETE /projects/:projectId/members/:userId` | Chọn một Owner khác trước; đừng gửi lại cùng request. |
| `MEMBER_HAS_ASSIGNED_TASKS` | 409 | Không | `DELETE /projects/:projectId/members/:userId`, `DELETE /workspaces/:workspaceId/members/:userId` | Giao lại task cho người khác trước; API **không** tự unassign. |
| `WORKSPACE_MEMBER_IN_PROJECTS` | 409 | Không | `DELETE /workspaces/:workspaceId/members/:userId` | Gỡ khỏi từng project trước; API **không** tự gỡ hộ. |
| `RATE_LIMITED` | 429 | Không | Auth endpoint và endpoint đắt | Disable control tới hết `Retry-After`; không tự retry mutation. |
| `INTERNAL_ERROR` | 5xx | Không | Mọi endpoint | Thông báo an toàn kèm `requestId`; **không** coi mutation là đã thành công. |
| `REPORT_NOT_READY` | 409 | Không | `GET /reports/:reportId/download` — Phase 1.1 | Chờ trạng thái `ready`; không retry vòng lặp. |
| `REPORT_EXPIRED` | 410 | Không | `GET /reports/:reportId/download` — Phase 1.1 | Tạo request export mới. |
| `TIME_TRACKING_DISABLED` | 403 | Không | Mọi route Time Tracking — Phase 1.3 | Ẩn bề mặt Time Tracking; deny xảy ra **sau** scope resolution nên non-member vẫn nhận `404`. |
| `WORK_LOG_BACKFILL_CLOSED` | 400 | Không | WorkLog create/update — Phase 1.3 | Giữ giá trị form; cần Owner mở override cho đúng ngày. |
| `WORK_LOG_DAILY_LIMIT_EXCEEDED` | 400 | Không | WorkLog create/update/submit — Phase 1.3 | Giữ form và giảm số phút; tổng ngày không vượt 1.440. |
| `WORK_LOG_TASK_SUPPORT_REASON_REQUIRED` | 400 | Không | WorkLog create/update — Phase 1.3 | Hiện field lý do hỗ trợ; task không giao cho actor cần lý do. |
| `WORK_LOG_SELF_REVIEW_FORBIDDEN` | 403 | Không | `POST /work-logs/:id/review` — Phase 1.3 | Không hiện CTA duyệt cho author, kể cả Owner. |
| `WORK_LOG_VERSION_CONFLICT` | 409 | Không | WorkLog update/submit/review — Phase 1.3 | Tải lại log; gửi lại bằng ý định mới. |
| `SPRINT_DISABLED` | 403 | Không | Mọi route Sprint — Phase 1.4 | Ẩn bề mặt Sprint; deny sau scope resolution như Time Tracking. |
| `SPRINT_ALREADY_ACTIVE` | 409 | Không | `POST /sprints/:sprintId/activate` — Phase 1.4 | Đóng sprint đang active trước; không retry. |
| `SPRINT_CLOSED` | 409 | Không | Sprint update và task update có `sprintId` — Phase 1.4 | Chọn sprint khác hoặc tạo sprint mới; sprint đã đóng là bất biến. |
| `SPRINT_VERSION_CONFLICT` | 409 | Không | Sprint/sprint-settings update — Phase 1.4 | Tải lại sprint/settings rồi gửi lại. |
| `TASK_DEPENDENCY_DUPLICATE` | 409 | Không | `POST /tasks/:taskId/dependencies` — Phase 1.5 | Cạnh đã tồn tại; coi như đã xong, không hiện lỗi cho người dùng. |
| `TASK_DEPENDENCY_CYCLE` | 409 | Không | `POST /tasks/:taskId/dependencies` — Phase 1.5 | Bỏ cạnh gây chu trình; không retry cùng cặp task. |

Code của một phase chưa mở vẫn nằm trong bảng: kết quả của nó được chốt từ bây giờ để client và test không phải đoán khi phase đó khởi động. Không có code nào ngoài bảng này được phép xuất hiện trong response.

## Authentication

### POST /auth/sign-up — tạo account chưa xác minh

Anonymous. Body đúng shape `{ "email", "displayName", "password" }`; email được normalize, display name và password qua validation của auth module. Client gửi `Idempotency-Key`; rate limit áp dụng trước account creation/email send. `201` trả `{ "account": { "email", "displayName", "emailVerified": false }, "verificationRequired": true }`. Use case tạo một User Argon2id và một verification token đã hash/có expiry; raw token/password không xuất hiện trong response/log/activity. `400`, `429` hoặc auth failure generic-safe không tiết lộ account/session.

### POST /auth/email/verify — dùng one-time verification token

Anonymous. Body `{ "token" }`; `200` trả `{ "emailVerified": true }`. Use case hash, validate, consume one-time token và đánh dấu email verified atomically. Token invalid, expired hoặc replay trả `400 VALIDATION_FAILED` an toàn; không tạo session hay activity record.

### POST /auth/email/verification/resend — thay verification token

Anonymous. Body `{ "email" }` và `Idempotency-Key`. `202` luôn trả generic `{ "accepted": true }` ở nơi account existence có thể bị lộ. Theo rate limit, use case thay verification token chưa dùng bằng token hash mới có expiry và schedule mail; không trả raw token. `400` chỉ báo parse/schema error; `429` có giới hạn và không enumeration account.

### POST /auth/sign-in — tạo opaque session mới

Anonymous. Body đúng shape `{ "email", "password" }`. `200` set HttpOnly opaque session cookie và trả `{ "actor": { "id", "displayName", "email", "emailVerified" }, "csrfToken": "session-bound-token" }`. Raw session ID chỉ ở cookie; server chỉ lưu hash. Credentials sai trả `401 UNAUTHENTICATED` generic; rate limit trả `429`. Valid credentials for an unverified account trả `403 EMAIL_VERIFICATION_REQUIRED` with `{ "error": { "code": "EMAIL_VERIFICATION_REQUIRED", "message": "Verify your email to sign in." }, "requestId": "01J..." }`; response has no `details`, session cookie, CSRF token, actor, or private data. Frontend clears the password and navigates to `AUTH-05 Email Verification`, where it may offer `POST /auth/email/verification/resend`; it does not retry sign-in automatically.

### GET /auth/session — bootstrap actor và CSRF token

Yêu cầu valid session. `200` trả actor projection an toàn hiện tại và session-bound `csrfToken`; `401` clear/reject stale session khi áp dụng. Endpoint không có activity side effect và không bao giờ trả role claim thay cho capability theo resource.

### POST /auth/sign-out — revoke current session

Yêu cầu session và `X-CSRF-Token`; không có request body. `204` revoke active server session khớp nếu có và clear cookie. Use case semantically idempotent kể cả khi cookie/session vắng mặt hoặc expired; không tạo ActivityLog.

### POST /auth/password/forgot — yêu cầu reset không enumeration

Anonymous. Body `{ "email" }`, `Idempotency-Key`; `202` trả generic `{ "accepted": true }` cho cả account eligible và unknown. Rate limit dùng client signal và normalized identifier. Với account eligible, use case thay reset token còn hiệu lực bằng một token hash, one-time, có expiry; body/log/activity không lộ token hay account existence.

### POST /auth/password/reset — dùng token và revoke sessions

Anonymous. Body `{ "token", "newPassword" }`, `Idempotency-Key`. `200` trả `{ "passwordReset": true, "signInRequired": true }`. Use case validate/consume token, thay Argon2id hash và revoke mọi active session trong một transaction. Token invalid/expired/replayed trả validation/auth failure an toàn; không tạo session.

## Workspaces và workspace members

### GET /workspaces — chọn workspace mà actor là member

Yêu cầu `workspace:read` trên từng workspace được trả. Query chỉ `cursor` và `limit`; `200` trả workspace summary phân trang cùng workspace role và workspace capability của caller. Không trả project-private name, count hay metadata chỉ vì actor là workspace member/admin. Không session là `401`; pagination invalid là `400`.

### POST /workspaces — tạo workspace khi server cho phép

Yêu cầu authenticated actor và workspace-provisioning policy do server kiểm soát; policy này cố ý không suy diễn từ project role. Catalog permission vì vậy **không** có `workspace:create`, và đó là chủ đích: client **luôn** hiển thị CTA tạo workspace rồi xử lý `403` nếu bị từ chối. Ẩn CTA sẽ chặn đúng người vừa được cấp quyền, vì client không có cách nào biết policy hiện tại là gì. Body đúng shape `{ "name" }` và `Idempotency-Key`; `201` trả workspace summary/capabilities. Creation atomically thiết lập workspace membership/administrative capability của creator cần để quản lý workspace mới. `400`, `401`, `403`, `429` khi áp dụng; không có project ActivityLog vì ActivityLog project-scoped.

### GET /workspaces/:workspaceId/members — xem membership workspace

Yêu cầu `workspace:member:manage` (Workspace Admin). Query chỉ `cursor`, `limit`; `200` trả member projection phân trang `{ userId, displayName, email, role, createdAt }`. Nó **không** kèm capabilities: envelope của list endpoint là `{ items, page }` theo [quy ước API](api-conventions.md), và caller đã có capabilities của workspace từ `GET /workspaces` — trả lần hai chỉ tạo ra hai nguồn cho cùng một dữ liệu. `403` nghĩa là workspace nhìn thấy nhưng thiếu action; workspace không accessible là `404`. Không kèm project membership hay private project data.

### POST /workspaces/:workspaceId/members — thêm member workspace

Yêu cầu `workspace:member:manage` và CSRF. Body đúng shape `{ "userId", "role" }`, với role `workspace_admin` hoặc `workspace_member`; yêu cầu `Idempotency-Key`. `201` trả workspace member đã tạo. Use case reject duplicate membership và user unknown/out-of-policy bằng validation/not-found outcome an toàn; không auto-add user vào project và không tạo project activity.

### DELETE /workspaces/:workspaceId/members/:userId — gỡ member workspace

Yêu cầu `workspace:member:manage`, CSRF và `Idempotency-Key`; không body. `204` chỉ remove membership khi transaction giữ mọi ProjectMember/task-assignee invariant phụ thuộc. Removal bị chặn trả `409 WORKSPACE_MEMBER_IN_PROJECTS` khi target còn `project_members` row, hoặc `409 MEMBER_HAS_ASSIGNED_TASKS` khi target còn là assignee của task; không silently unassign task, đổi project membership hay ghi activity. Kiểm theo đúng thứ tự đó, để thông điệp nói đúng việc cần làm trước.

## Projects và project members

### GET /workspaces/:workspaceId/projects — danh sách project actor được phép thấy

Yêu cầu `workspace:read` trên workspace, và trả **chỉ** những project mà actor có `project_members` row. Query chỉ `cursor` và `limit`. `200` trả cursor page của project projection cùng `role` của actor trong từng project.

Endpoint này **không** làm rò rỉ project riêng tư: một Workspace Admin chưa được thêm vào project nào sẽ nhận một trang rỗng, không phải danh sách project của người khác. Nó cũng không trả count thành viên hay count task — không projection nào công bố chúng, và suy ra chúng từ dữ liệu actor không được đọc chính là cách rò rỉ.

Thứ tự cố định là `createdAt DESC, id DESC`, khớp seek order mặc định trong [chính sách query và index](../data/query-and-index-policy.md). Workspace không accessible là `404`.

### POST /workspaces/:workspaceId/projects — tạo private project

Yêu cầu `project:create` (Workspace Admin), CSRF và `Idempotency-Key`. Body đúng shape `{ "name" }`; `201` trả `{ "project", "capabilities" }`. Một transaction tạo private project, đưa creator thành `owner`, và ghi activity `project.created`. Workspace Member nhận `403`; Workspace Admin không nhận access tới project không liên quan.

### GET /projects/:projectId — mở project board/detail

Yêu cầu `project:read`. Không cần query để mở board: `200` trả project projection, current-project capabilities, active column, assignable project-member projection và page đầu default 25 task độc lập cho mỗi column. **Phần task và column chỉ có mặt từ mốc dựng bảng của chúng**: `columns` từ M3, `tasks` từ M4. Ở M2, response đúng là `{ project, capabilities, columns: [], members }` — trả một mảng rỗng là trung thực, còn bỏ hẳn field sẽ buộc client viết hai nhánh cho cùng một endpoint. Board load bình thường loại archived column và không bao giờ fetch toàn bộ task của project lớn. Load-more của một column dùng explicit task-list use case `GET /projects/:projectId/tasks?columnId=...&cursor=...`, nên không ảnh hưởng page của column khác. ID non-member/cross-project trả `404`; member nhìn thấy project nhưng thiếu action trả `403`.

### PATCH /projects/:projectId — đổi tên project

Yêu cầu `project:update` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "name" }`; client không gửi description, visibility, archive/delete field, workspaceId, timestamp hay audit field. `200` trả `{ "project", "capabilities" }`; transaction ghi activity `project.updated`. Mọi field non-allowlisted/malformed là `400`; Editor/Viewer nhận `403`, hidden project nhận `404`.

### POST /projects/:projectId/members — thêm project member

Yêu cầu `project:member:manage` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "userId", "role" }`, role là một trong `owner|editor|viewer`; `201` trả project member projection. Target phải là WorkspaceMember của workspace chứa project; duplicate/cross-workspace target bị reject mà không có partial membership. Commit ghi activity `project_member.added`.

### PATCH /projects/:projectId/members/:userId — đổi project role

Yêu cầu `project:member:manage`, CSRF và `Idempotency-Key`. Body đúng shape `{ "role" }`, một fixed project role; `200` trả member đã đổi. Transaction giữ tối thiểu một Owner và ghi `project_member.role_changed`; demote Owner cuối cùng trả `409 PROJECT_LAST_OWNER` và không ghi gì.

### DELETE /projects/:projectId/members/:userId — gỡ project member

Yêu cầu `project:member:manage`, CSRF và `Idempotency-Key`; không body. `204` chỉ remove khi còn tối thiểu một Owner và target không còn là assignee của task trong project. Gỡ Owner cuối cùng trả `409 PROJECT_LAST_OWNER`; target còn là assignee trả `409 MEMBER_HAS_ASSIGNED_TASKS`. API không auto-unassign/transfer task. Commit thành công ghi activity `project_member.removed`.

## Board columns

### POST /projects/:projectId/columns — thêm column active

Yêu cầu `board-column:manage` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "name", "afterColumnId", "isTerminal", "requiresReviewer" }`; `afterColumnId` nullable và khi có phải active/cùng project; `isTerminal` và `requiresReviewer` optional, cùng default `false`; server tính fractional position. `201` trả column projection và ghi activity `board_column.created`. Client không thể gửi projectId, position, archivedAt hay timestamp.

### PATCH /columns/:columnId — đổi tên hoặc archive column

Yêu cầu `board-column:manage`, CSRF và `Idempotency-Key`. Body là đúng một explicit command: `{ "name" }` để rename, `{ "isTerminal": boolean }` để đổi terminal flag, `{ "requiresReviewer": boolean }` để đổi yêu cầu reviewer, **hoặc** `{ "archive": true }` để archive; field mixed/unknown invalid. Rename trả `200` cùng column và ghi `board_column.renamed`. Đổi terminal flag trả `200` cùng column và ghi `board_column.terminal_changed`; nó chỉ đổi cách suy `due_state` từ thời điểm đó, không viết lại activity cũ, không đổi `position`/`archived_at` và không di chuyển task nào. Đổi `requiresReviewer` trả `200` cùng column và ghi `board_column.reviewer_requirement_changed`; nó chỉ áp cho các lần create/move **sau đó**, **không** hồi tố lên task đang nằm trong cột — task đã ở đó mà thiếu `reviewerId` vẫn ở nguyên, vì hồi tố sẽ biến một thao tác cấu hình thành một đợt vi phạm invariant hàng loạt không ai yêu cầu. Archive trả `200` với `archivedAt`, và chỉ ghi `board_column.archived` khi column không còn task. Archive column còn task trả `409 COLUMN_NOT_EMPTY`; MVP không move/delete task hay unarchive.

### POST /columns/reorder — sắp lại column của một project

Yêu cầu `board-column:manage`, CSRF và `Idempotency-Key`. Body đúng shape `{ "projectId", "orderedColumnIds" }`; ID phải là toàn bộ active column của resolved project, mỗi ID đúng một lần. `200` trả `{ "columns": [...] }` theo committed order và ghi đúng một activity `board_column.reordered`. Use case không nhận arbitrary position, archive flag, task ID hay generic batch update.

## Tasks

### GET /projects/:projectId/tasks — tìm/list task đã scope

Yêu cầu `task:read`. Query chỉ dùng `cursor`, `limit`, `columnId`, `assigneeId`, `createdById`, `reviewerId`, `category`, `priority`, `dueState`, `dueFrom`, `dueTo`, `sort`, `search` trong allowlist. `dueState` là enum server-derived, không là field client truyền vào mutation. `200` trả cursor page của task projection. Mọi user ID/column phải thuộc cùng authorized project; position sort yêu cầu `columnId`. Không side effect/activity. Private project không authorized là `404`; query malformed/disallowed là `400`.

### POST /projects/:projectId/tasks — tạo task trong column active

Yêu cầu `task:create`, CSRF và `Idempotency-Key`. Body đúng shape `{ "title", "description", "columnId", "assigneeId", "category", "priority", "startDate", "dueDate", "reviewerId", "evidenceUrl" }`; ngoại trừ `title`/`columnId`, field có thể null theo schema. `evidenceUrl` phải là URL tuyệt đối scheme `https`, tối đa 2048 ký tự; `http`, `javascript:`, `data:`, `file:` và URL quá dài trả `400 VALIDATION_FAILED`. Server đặt `createdBy` từ actor, validate allowlist category/priority, `startDate <= dueDate`, project scope assignee/reviewer và yêu cầu reviewer nếu column cần reviewer. `201` trả task với `position` từ server và `version: 1`, sau đó ghi `task.created`. Client không chọn projectId, createdBy, position, version, dueState, timestamp hay audit field.

### GET /tasks/:taskId — đọc task detail và comments ban đầu

Yêu cầu `task:read` và `comment:read`. Query chỉ nhận comment-page `cursor`/`limit` có giới hạn; `200` trả `{ "task", "comments": { "items", "page" }, "capabilities" }`. Comment có order cố định `createdAt, id` và immutable. Task chưa có comment trả empty page, không phải missing task; không activity side effect.

### PATCH /tasks/:taskId — sửa content/assignment task

Yêu cầu `task:update` và khi đổi `assigneeId` thì `task:assign`, CSRF và `Idempotency-Key`. Body phải có `{ "expectedVersion" }` cùng một hoặc nhiều field `title`, `description`, `assigneeId`, `category`, `priority`, `startDate`, `dueDate`, `reviewerId`, `evidenceUrl` (gửi `null` để xoá liên kết) `sprintId` ở Phase 1.4 (`null` để đưa task về backlog; sprint phải cùng project và chưa `closed`) và `parentTaskId` ở Phase 1.5 (`null` để bỏ cha; xem mục quan hệ Task). `200` trả committed task với version tăng, dueState mới và ghi `task.updated`. Use case reject `projectId`, `columnId`, `createdBy`, `position`, `version`, dueState, timestamp/audit field và empty patch. `expectedVersion` stale trả `409 TASK_VERSION_CONFLICT` cùng current version, không có activity; assignee/reviewer/input cross-project hoặc date invalid bị reject trước commit.

### POST /tasks/:taskId/move — di chuyển task có concurrency check

Yêu cầu `task:move`, CSRF và `Idempotency-Key`. Body đúng shape `{ "destinationColumnId", "targetPosition", "expectedVersion", "reviewerId?" }`; `reviewerId` chỉ được gửi/khi cần nếu destination column có `requiresReviewer`; nếu cột này yêu cầu reviewer, server bắt buộc ProjectMember reviewer khác assignee. `200` trả committed task với destination/position/version/dueState mới. Transaction validate active same-project destination, chỉ lock order range cần thiết, rebalance khi cần và ghi đúng một `task.moved` activity. Version stale là `409` đã định nghĩa; không có force move. Khi cột nguồn có `isTerminal = true` và cột đích có `isTerminal = false`, move này là **mở lại task**: transaction ghi đúng một activity `task.reopened` thay cho `task.moved` (vẫn đúng một activity cho một move commit), không cần permission, endpoint hay body field nào khác, và mọi validation reviewer/version/idempotency áp dụng như move thường.

## Comments và activity

### POST /tasks/:taskId/comments — append immutable comment

Yêu cầu `comment:create`, CSRF và `Idempotency-Key`. Body đúng shape `{ "body" }`; `201` trả comment projection. `body` là **plain text bất biến**: server lưu đúng những gì người dùng gõ, không normalize, không sanitize-rồi-lưu, không chuyển sang HTML. Cú pháp Markdown trong `body` là quy ước trình bày do client render theo subset allowlist ([ADR-0009](../decisions/ADR-0009-task-evidence-and-comment-formatting.md)), không phải một content type khác. Một transaction insert comment do actor tạo và ghi `comment.created` activity. Cố ý không có PATCH/DELETE/move comment route; unknown field, body empty/invalid, thiếu permission hoặc cross-project task không tạo comment/activity.

### GET /tasks/:taskId/activity — xem audit history của task

Yêu cầu `activity:read`. Query chỉ `cursor` và `limit`; `200` trả cursor page activity scope task theo `createdAt:desc, id:desc`. Chỉ gồm summary/action/actor/time an toàn từ server, không raw internal payload. Không có public activity create/update/delete endpoint. Task event được đọc qua authorized project scope của task, nên ID substitution trả `404`.

## Progress export — Phase 1.1, không phải core MVP

Các route trong phần này không được implement, advertise hoặc đưa vào MVP UI trước Phase 1.1. Chúng vẫn giữ contract quyền để phase sau không tự mở rộng scope.

Phase 1.1 chỉ hỗ trợ Owner request và download export. Phase 1.2 mới thêm Redis/BullMQ worker, bounded retry, delivery và job observability sau commit; web/API request vẫn chỉ tạo/snapshot export và trả prompt. Phase 1.2 không tạo generic report API, không tự giao file vào core MVP, và không thay permission `report:export` hay các route ở dưới.

### POST /projects/:projectId/reports/progress-export — yêu cầu export

Chỉ Phase 1.1. Yêu cầu `report:export` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "filters" }`, trong đó `filters` là task-filter subset canonical đã allowlist và project-scoped; không raw query/table/column. `202` trả report `{ "id", "projectId", "status": "requested", "expiresAt", "createdAt" }`. Transaction snapshot validated filters, ghi `report_export.requested`, và không giữ DB transaction khi generate file. Editor/Viewer/non-member Workspace Admin không thể request.

### GET /reports/:reportId — xem trạng thái export

Chỉ Phase 1.1. Yêu cầu `report:export`; `200` trả report metadata an toàn `{ id, projectId, status, fileName?, contentType?, byteSize?, expiresAt, createdAt, updatedAt }`. `status` là giá trị server ghi (`requested|ready|failed|purged`); trạng thái "expired" trong UI là **derived từ `expiresAt`**, không phải một status ghi trong database — client so `expiresAt` với thời điểm hiện tại để hiển thị và disable download. Không bao giờ trả `fileStorageKey`, filter snapshot của project khác hay download URL. Hidden project/report trả `404`; report hết hạn được biểu diễn/xử lý mà không lộ usable file.

### GET /reports/:reportId/download — tải export sẵn sàng

Chỉ Phase 1.1. Yêu cầu `report:export`. Khi status là `ready` và chưa expired, `200` stream XLSX với `Content-Type`, disposition và `X-Request-Id` an toàn; không bọc file trong JSON. `requested`/`failed` trả `409 REPORT_NOT_READY`, sau expiry trả `410 REPORT_EXPIRED`, report out-of-scope trả `404`. Download authorization được kiểm tra lại lúc request.

## Quan hệ Task — Phase 1.5, không phải core MVP

Các route dưới đây chỉ tồn tại khi Phase 1.5 bắt đầu. Chúng dùng cùng guard chain và **không** thêm permission mới: thay đổi quan hệ là thay đổi nội dung task nên dùng `task:update`.

`PATCH /tasks/:taskId` nhận thêm `parentTaskId` (`null` để bỏ cha). Cha phải cùng project, khác chính task, và **không được có cha của riêng nó** — subtask sâu đúng một cấp; vi phạm trả `400 VALIDATION_FAILED`. Gán cha không di chuyển task và không kéo theo con.

`POST /tasks/:taskId/dependencies` yêu cầu `task:update`, CSRF và `Idempotency-Key`; body đúng shape `{ "blockingTaskId" }` — task hiện tại là bên bị chặn. Cả hai task phải cùng project. `201` trả cạnh đã tạo. Cạnh tạo chu trình trả `409 TASK_DEPENDENCY_CYCLE`; vượt 50 cạnh mỗi chiều trả `400 VALIDATION_FAILED`; cạnh trùng trả `409 TASK_DEPENDENCY_DUPLICATE`. Transaction ghi `task_dependency.added`.

`DELETE /task-dependencies/:dependencyId` yêu cầu `task:update`, CSRF và `Idempotency-Key`; không body. `204` xoá cạnh và ghi `task_dependency.removed`. Đây là hard delete có chủ đích; lịch sử nằm ở Activity Log.

`GET /tasks/:taskId` trả thêm `parent` (projection tối giản `{ id, title }` hoặc `null`), `subtaskSummary` (`{ total, done }` đếm con ở column `isTerminal = true`), cùng hai danh sách **có biên** `blocks` và `blockedBy`, mỗi phần tử `{ id, title, columnId, columnIsTerminal }`. Vì giới hạn 50 cạnh nên hai danh sách này không dùng cursor.

**Task bị chặn vẫn move được:** server không chặn việc đưa một task đang bị block vào column terminal. Cưỡng chế cứng đòi phải có đường vượt quyền và audit của nó; ở phase này blocking là thông tin, UI hiển thị cảnh báo và `task:move` giữ nguyên contract.

## Sprint — Phase 1.4, không phải core MVP

Các route Sprint chỉ tồn tại khi Phase 1.4 bắt đầu và project đã bật feature; khi tắt, chúng deny `SPRINT_DISABLED` sau scope resolution và task projection không có `sprintId`. Chúng dùng cùng `SessionGuard → ResourceProjectResolver → ProjectPermissionGuard → use case → scoped repository`; không có generic table endpoint.

`GET/PATCH /projects/:projectId/sprint-settings` yêu cầu `sprint:manage` (Owner). PATCH body chỉ nhận `{ enabled, defaultDurationDays, expectedVersion }` với `defaultDurationDays` là integer 7–28; `200` trả settings/version/capabilities, version stale trả `409 SPRINT_VERSION_CONFLICT`.

`GET /projects/:projectId/sprints` yêu cầu `sprint:read`; query chỉ `status`, `cursor`, `limit`. `200` trả cursor page sprint projection `{ id, projectId, name, goal, startsOn, endsOn, status, closedAt, version, createdAt, updatedAt }`.

`POST /projects/:projectId/sprints` yêu cầu `sprint:manage`, CSRF và `Idempotency-Key`; body đúng shape `{ "name", "goal", "startsOn", "endsOn" }`. Sprint mới luôn ở `planned`; `startsOn <= endsOn` và tên phải unique trong project. `PATCH /sprints/:sprintId` nhận `{ name?, goal?, startsOn?, endsOn?, expectedVersion }` và chỉ áp dụng cho sprint chưa `closed`.

`POST /sprints/:sprintId/activate` yêu cầu `sprint:manage`, CSRF, `Idempotency-Key` và `{ expectedVersion }`. Chỉ sprint `planned` được activate; nếu project đã có sprint `active` thì partial unique index từ chối và API trả `409 SPRINT_ALREADY_ACTIVE` — hai request đồng thời không thể cùng thành công.

`POST /sprints/:sprintId/close` yêu cầu `sprint:manage`, CSRF, `Idempotency-Key`; body đúng shape `{ "unfinishedTasks": "backlog" | "move_to_sprint", "targetSprintId"?, "expectedVersion" }`. `targetSprintId` bắt buộc và chỉ hợp lệ khi `unfinishedTasks = "move_to_sprint"`, phải là sprint `planned` cùng project. "Chưa hoàn thành" là task đang ở column `isTerminal = false`. `200` trả sprint đã đóng cùng số task đã chuyển; sprint `closed` sau đó từ chối mọi thay đổi và mọi gán task với `409 SPRINT_CLOSED`.

Gán hoặc bỏ gán sprint cho task dùng `PATCH /tasks/:taskId` với `sprintId` (hoặc `null` để về backlog) — không có bulk endpoint ở phase này; UI planning gửi N request và hiển thị kết quả từng dòng.

## Time Tracking — Phase 1.3, không phải core MVP

Các route Time Tracking chỉ tồn tại khi Phase 1.3 bắt đầu. Chúng dùng cùng `SessionGuard → ResourceProjectResolver → ProjectPermissionGuard → use case → scoped repository`; không có generic table endpoint. Mọi `workDate` là `YYYY-MM-DD` theo workspace timezone, mọi timestamp response là UTC ISO-8601 và mọi list dùng cursor page chung.

### Settings và approver

`GET/PATCH /projects/:projectId/time-tracking/settings` yêu cầu `time-tracking:settings:update` (Owner). PATCH body chỉ nhận `{ enabled, approvalMode, backfillDays, approverIds, expectedVersion }`; `approvalMode` là `self_close|requires_approval`, `backfillDays` là integer 0–31, `approverIds` không duplicate và từng user phải là active Editor cùng project. `200` trả settings/version/capabilities; version stale trả `409 WORK_LOG_VERSION_CONFLICT`. Không expose settings/approver list cho non-Owner.

### WorkLog list và mutation

`GET /projects/:projectId/work-logs` yêu cầu `work-log:read`, với query allowlist `userId`, `taskId`, `status`, `dateFrom`, `dateTo`, `sort`, `direction`, `cursor`, `limit`. `status` chỉ `draft|submitted|approved|rejected`; sort chỉ `workDate|updatedAt`; filter change reset cursor. Response `{ items, page }` không trả internal lock/audit payload. Mỗi WorkLog item mang **`capabilities` per-record do server tính** (subset của `work-log:update:self`, `work-log:submit:self`, `work-log:review` theo [Time Tracking conditions](../security/authorization-model.md#time-tracking-conditions-phase-13)) — quyết định theo status/date window/author của chính record đó; client không tự suy các cờ này từ status hay ngày.

`POST /projects/:projectId/work-logs` yêu cầu `work-log:create:self`, CSRF và `Idempotency-Key`; body `{ taskId, workDate, durationMinutes, description, supportReason? }`. Actor là author do server gán, không nhận `loggedByUserId`. `PATCH /work-logs/:workLogId` yêu cầu `work-log:update:self`, body allowlist cùng `expectedVersion`; chỉ draft/rejected trong backfill/override. Các lỗi nghiệp vụ dùng `TIME_TRACKING_DISABLED`, `WORK_LOG_BACKFILL_CLOSED`, `WORK_LOG_DAILY_LIMIT_EXCEEDED`, `WORK_LOG_TASK_SUPPORT_REASON_REQUIRED` hoặc `WORK_LOG_VERSION_CONFLICT`.

`POST /work-logs/:workLogId/submit` yêu cầu `work-log:submit:self` và `{ expectedVersion }`. Mode self-close trả approved với `approvalKind: self`; mode requires-approval trả submitted. `POST /work-logs/:workLogId/review` yêu cầu `work-log:review`, body `{ decision: "approved"|"rejected", note?, expectedVersion }`; note bắt buộc khi rejected, self-review trả `403 WORK_LOG_SELF_REVIEW_FORBIDDEN`, non-submitted/stale trả `409`.

`POST /projects/:projectId/work-logs/bulk-review` yêu cầu `work-log:review`, CSRF và `Idempotency-Key`; body `{ items: [{ id, decision, note?, expectedVersion }] }`. Tất cả id phải resolve cùng project; response `200` trả `items` per record với `approved|rejected|conflict|denied` và safe `code?`, không atomic toàn danh sách.

`POST /projects/:projectId/work-log-access-overrides` yêu cầu `work-log:backfill:override`; body `{ userId, workDate, expiresAt, reason }`. Owner-only; user phải là current ProjectMember, reason non-empty, expiry ở tương lai. `201` trả override metadata an toàn.

### Monthly report

`GET /projects/:projectId/time-reports/monthly` yêu cầu `time-report:read`; query `{ month: "YYYY-MM", userId?, status? }`. Response aggregate theo member gồm `finalMinutes`, `selfClosedMinutes`, `submittedMinutes`, `rejectedMinutes` và cursor/drilldown-safe fields. `finalMinutes` chỉ tính approved WorkLog; endpoint không sinh XLSX, email, schedule hoặc background job.
