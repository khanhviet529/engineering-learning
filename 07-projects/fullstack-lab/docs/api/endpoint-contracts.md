# Hợp đồng endpoint Flowboard

Các endpoint dưới đây là use case cụ thể của Flowboard. Mọi JSON success/error dùng [api-conventions.md](api-conventions.md); list, task concurrency và retry dùng [pagination-concurrency-idempotency.md](pagination-concurrency-idempotency.md). Quyền action là catalog ở [authorization-model.md](../security/authorization-model.md), và phase reporting theo [delivery-roadmap.md](../product/delivery-roadmap.md).

## Hình dạng resource trả về

Các response chỉ trả projection cần cho use case:

```json
{
  "workspace": { "id": "uuid", "name": "Engineering", "role": "workspace_admin", "capabilities": ["workspace:read", "project:create"] },
  "project": { "id": "uuid", "workspaceId": "uuid", "name": "Launch", "createdAt": "2026-09-01T08:30:00Z", "updatedAt": "2026-09-01T08:30:00Z" },
  "column": { "id": "uuid", "projectId": "uuid", "name": "In progress", "position": "100.0000000000", "archivedAt": null },
  "task": { "id": "uuid", "projectId": "uuid", "columnId": "uuid", "createdBy": { "id": "uuid", "displayName": "Mai" }, "assigneeId": null, "reviewerId": null, "title": "Prepare launch", "description": "", "category": "feature", "priority": "medium", "startDate": null, "dueDate": null, "dueState": "none", "position": "100.0000000000", "version": 1, "createdAt": "2026-09-01T08:30:00Z", "updatedAt": "2026-09-01T08:30:00Z" },
  "member": { "userId": "uuid", "displayName": "Mai", "email": "mai@example.test", "role": "editor" },
  "comment": { "id": "uuid", "taskId": "uuid", "author": { "id": "uuid", "displayName": "Mai" }, "body": "I will take this.", "createdAt": "2026-09-01T08:30:00Z" },
  "activity": { "id": "uuid", "taskId": "uuid-or-null", "actor": { "id": "uuid", "displayName": "Mai" }, "action": "task.created", "summary": "Created task", "createdAt": "2026-09-01T08:30:00Z" }
}
```

`position` chỉ được trả khi rendering board cần thứ tự đã xác nhận. `activity.summary` do server dựng từ event payload allowlisted, không-secret; raw `payload` không bao giờ đến client. Response project detail/board gói `project` cùng `capabilities` do server tính, `columns` active, `members` project có thể làm assignee và task page có giới hạn theo column. Không response nào lộ project private cho Workspace Admin chưa có project membership tường minh.

Mọi protected mutation hoàn tất authentication/resource authorization trước transaction, rồi re-check domain invariant có thể đổi trong transaction. Business mutation thành công ghi ActivityLog event đã nêu trong chính transaction; mutation bị reject/rollback không ghi event nào. Mutation yêu cầu `Idempotency-Key` tuân theo [idempotency contract](api-conventions.md#idempotency-key): retry cùng key/fingerprint replay outcome đã lưu, cùng key khác fingerprint là `409 IDEMPOTENCY_KEY_REUSED`, retry đồng thời khi request gốc đang chạy là `409 IDEMPOTENCY_IN_PROGRESS`.

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

Yêu cầu authenticated actor và workspace-provisioning policy do server kiểm soát; policy này cố ý không suy diễn từ project role. Body đúng shape `{ "name" }` và `Idempotency-Key`; `201` trả workspace summary/capabilities. Creation atomically thiết lập workspace membership/administrative capability của creator cần để quản lý workspace mới. `400`, `401`, `403`, `429` khi áp dụng; không có project ActivityLog vì ActivityLog project-scoped.

### GET /workspaces/:workspaceId/members — xem membership workspace

Yêu cầu `workspace:member:manage` (Workspace Admin). Query chỉ `cursor`, `limit`; `200` trả member projection phân trang `{ userId, displayName, email, role, createdAt }` cùng workspace capabilities. `403` nghĩa là workspace nhìn thấy nhưng thiếu action; workspace không accessible là `404`. Không kèm project membership hay private project data.

### POST /workspaces/:workspaceId/members — thêm member workspace

Yêu cầu `workspace:member:manage` và CSRF. Body đúng shape `{ "userId", "role" }`, với role `workspace_admin` hoặc `workspace_member`; yêu cầu `Idempotency-Key`. `201` trả workspace member đã tạo. Use case reject duplicate membership và user unknown/out-of-policy bằng validation/not-found outcome an toàn; không auto-add user vào project và không tạo project activity.

### DELETE /workspaces/:workspaceId/members/:userId — gỡ member workspace

Yêu cầu `workspace:member:manage`, CSRF và `Idempotency-Key`; không body. `204` chỉ remove membership khi transaction giữ mọi ProjectMember/task-assignee invariant phụ thuộc. Removal bị chặn trả `409 CONFLICT` với invariant-safe code; không silently unassign task, đổi project membership hay ghi activity.

## Projects và project members

### POST /workspaces/:workspaceId/projects — tạo private project

Yêu cầu `project:create` (Workspace Admin), CSRF và `Idempotency-Key`. Body đúng shape `{ "name" }`; `201` trả `{ "project", "capabilities" }`. Một transaction tạo private project, đưa creator thành `owner`, và ghi activity `project.created`. Workspace Member nhận `403`; Workspace Admin không nhận access tới project không liên quan.

### GET /projects/:projectId — mở project board/detail

Yêu cầu `project:read`. Không cần query để mở board: `200` trả project projection, current-project capabilities, active column, assignable project-member projection và page đầu default 25 task độc lập cho mỗi column. Board load bình thường loại archived column và không bao giờ fetch toàn bộ task của project lớn. Load-more của một column dùng explicit task-list use case `GET /projects/:projectId/tasks?columnId=...&cursor=...`, nên không ảnh hưởng page của column khác. ID non-member/cross-project trả `404`; member nhìn thấy project nhưng thiếu action trả `403`.

### PATCH /projects/:projectId — đổi tên project

Yêu cầu `project:update` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "name" }`; client không gửi description, visibility, archive/delete field, workspaceId, timestamp hay audit field. `200` trả `{ "project", "capabilities" }`; transaction ghi activity `project.updated`. Mọi field non-allowlisted/malformed là `400`; Editor/Viewer nhận `403`, hidden project nhận `404`.

### POST /projects/:projectId/members — thêm project member

Yêu cầu `project:member:manage` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "userId", "role" }`, role là một trong `owner|editor|viewer`; `201` trả project member projection. Target phải là WorkspaceMember của workspace chứa project; duplicate/cross-workspace target bị reject mà không có partial membership. Commit ghi activity `project_member.added`.

### PATCH /projects/:projectId/members/:userId — đổi project role

Yêu cầu `project:member:manage`, CSRF và `Idempotency-Key`. Body đúng shape `{ "role" }`, một fixed project role; `200` trả member đã đổi. Transaction giữ tối thiểu một Owner và ghi `project_member.role_changed`; demote Owner cuối cùng trả `409 CONFLICT` và không ghi gì.

### DELETE /projects/:projectId/members/:userId — gỡ project member

Yêu cầu `project:member:manage`, CSRF và `Idempotency-Key`; không body. `204` chỉ remove khi còn tối thiểu một Owner và target không còn là assignee của task trong project. Vi phạm trả `409 CONFLICT`; API không auto-unassign/transfer task. Commit thành công ghi activity `project_member.removed`.

## Board columns

### POST /projects/:projectId/columns — thêm column active

Yêu cầu `board-column:manage` (Owner), CSRF và `Idempotency-Key`. Body đúng shape `{ "name", "afterColumnId" }`; `afterColumnId` nullable và khi có phải active/cùng project; server tính fractional position. `201` trả column projection và ghi activity `board_column.created`. Client không thể gửi projectId, position, archivedAt hay timestamp.

### PATCH /columns/:columnId — đổi tên hoặc archive column

Yêu cầu `board-column:manage`, CSRF và `Idempotency-Key`. Body là đúng một explicit command: `{ "name" }` để rename **hoặc** `{ "archive": true }` để archive; field mixed/unknown invalid. Rename trả `200` cùng column và ghi `board_column.renamed`. Archive trả `200` với `archivedAt`, và chỉ ghi `board_column.archived` khi column không còn task. Archive column còn task trả `409 COLUMN_NOT_EMPTY`; MVP không move/delete task hay unarchive.

### POST /columns/reorder — sắp lại column của một project

Yêu cầu `board-column:manage`, CSRF và `Idempotency-Key`. Body đúng shape `{ "projectId", "orderedColumnIds" }`; ID phải là toàn bộ active column của resolved project, mỗi ID đúng một lần. `200` trả `{ "columns": [...] }` theo committed order và ghi đúng một activity `board_column.reordered`. Use case không nhận arbitrary position, archive flag, task ID hay generic batch update.

## Tasks

### GET /projects/:projectId/tasks — tìm/list task đã scope

Yêu cầu `task:read`. Query chỉ dùng `cursor`, `limit`, `columnId`, `assigneeId`, `createdById`, `reviewerId`, `category`, `priority`, `dueState`, `dueFrom`, `dueTo`, `sort`, `search` trong allowlist. `dueState` là enum server-derived, không là field client truyền vào mutation. `200` trả cursor page của task projection. Mọi user ID/column phải thuộc cùng authorized project; position sort yêu cầu `columnId`. Không side effect/activity. Private project không authorized là `404`; query malformed/disallowed là `400`.

### POST /projects/:projectId/tasks — tạo task trong column active

Yêu cầu `task:create`, CSRF và `Idempotency-Key`. Body đúng shape `{ "title", "description", "columnId", "assigneeId", "category", "priority", "startDate", "dueDate", "reviewerId" }`; ngoại trừ `title`/`columnId`, field có thể null theo schema. Server đặt `createdBy` từ actor, validate allowlist category/priority, `startDate <= dueDate`, project scope assignee/reviewer và yêu cầu reviewer nếu column cần reviewer. `201` trả task với `position` từ server và `version: 1`, sau đó ghi `task.created`. Client không chọn projectId, createdBy, position, version, dueState, timestamp hay audit field.

### GET /tasks/:taskId — đọc task detail và comments ban đầu

Yêu cầu `task:read` và `comment:read`. Query chỉ nhận comment-page `cursor`/`limit` có giới hạn; `200` trả `{ "task", "comments": { "items", "page" }, "capabilities" }`. Comment có order cố định `createdAt, id` và immutable. Task chưa có comment trả empty page, không phải missing task; không activity side effect.

### PATCH /tasks/:taskId — sửa content/assignment task

Yêu cầu `task:update` và khi đổi `assigneeId` thì `task:assign`, CSRF và `Idempotency-Key`. Body phải có `{ "expectedVersion" }` cùng một hoặc nhiều field `title`, `description`, `assigneeId`, `category`, `priority`, `startDate`, `dueDate`, `reviewerId`. `200` trả committed task với version tăng, dueState mới và ghi `task.updated`. Use case reject `projectId`, `columnId`, `createdBy`, `position`, `version`, dueState, timestamp/audit field và empty patch. `expectedVersion` stale trả `409 TASK_VERSION_CONFLICT` cùng current version, không có activity; assignee/reviewer/input cross-project hoặc date invalid bị reject trước commit.

### POST /tasks/:taskId/move — di chuyển task có concurrency check

Yêu cầu `task:move`, CSRF và `Idempotency-Key`. Body đúng shape `{ "destinationColumnId", "targetPosition", "expectedVersion", "reviewerId?" }`; `reviewerId` chỉ được gửi/khi cần nếu destination column có `requiresReviewer`; nếu cột này yêu cầu reviewer, server bắt buộc ProjectMember reviewer khác assignee. `200` trả committed task với destination/position/version/dueState mới. Transaction validate active same-project destination, chỉ lock order range cần thiết, rebalance khi cần và ghi đúng một `task.moved` activity. Version stale là `409` đã định nghĩa; không có force move.

## Comments và activity

### POST /tasks/:taskId/comments — append immutable comment

Yêu cầu `comment:create`, CSRF và `Idempotency-Key`. Body đúng shape `{ "body" }`; `201` trả comment projection. Một transaction insert comment do actor tạo và ghi `comment.created` activity. Cố ý không có PATCH/DELETE/move comment route; unknown field, body empty/invalid, thiếu permission hoặc cross-project task không tạo comment/activity.

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
