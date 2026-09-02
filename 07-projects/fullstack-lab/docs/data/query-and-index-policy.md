# Chính sách query, index và transaction Flowboard

Tài liệu này quy định repository query và transaction theo [mô hình miền](domain-model.md) và [thiết kế database](database-design.md). Query là implementation detail của use case đã được authorize; không có generic endpoint hay client-provided table/column/sort expression.

## Scope bắt buộc trước mọi query

1. Session/authentication và object-level authorization được kiểm tra trước repository.
2. Repository resolve `project_id` từ resource đã authorize hoặc từ project route đã authorize; không nhận một ID resource đơn lẻ rồi query không scope.
3. Mọi đọc/ghi Project data chứa điều kiện project scope: Task dùng `tasks.project_id = :project_id`; Comment join Task và scope `tasks.project_id = :project_id`; ActivityLog/ReportExport/WorkLog dùng `project_id = :project_id`; BoardColumn dùng `project_id = :project_id`.
4. Project membership là điều kiện access. Workspace Admin không có ProjectMember không được nhận row, count, existence result hay metadata private.

Repository scope là defense-in-depth, không thay `ProjectPermissionGuard`. API/UI cũng không được coi một ID hợp lệ là bằng chứng quyền.

## Pagination và cursor

- Mọi list endpoint có page size mặc định **25**, tối đa **100**. `limit` là integer dương; giá trị ngoài `1..100`, không phải integer, hoặc cursor không hợp lệ là validation error, không âm thầm clamp.
- Response dùng `items` và `page: { nextCursor, hasMore }`. `nextCursor` là `null` khi không còn trang; cursor chỉ được phát từ server.
- Cursor là opaque URL-safe value được server ký/chống sửa đổi. Nó chứa schema version, fingerprint của query shape đã chuẩn hóa, last sort-key value(s), `id` tie-breaker và thông tin tối thiểu cần tiếp tục seek pagination. Client không parse, tự tạo, chỉnh sửa hoặc tái dùng cursor cho query khác.
- Query fingerprint bind tối thiểu vào project, column khi có, filters, sort direction và search. Đổi `project_id`, `columnId`, filter, sort hoặc search sẽ reset cursor và tải page đầu; reuse cursor khác fingerprint bị từ chối.
- Mọi order có `id` làm tie-breaker cuối. Cursor không là offset, không là database primary key công khai, và không hỗ trợ page-number/skip arbitrary.

## Task list contract: allowlist tuyệt đối

`GET /projects/:projectId/tasks` chỉ nhận những query field sau. Bất kỳ filter/sort/search field khác, raw SQL, field name, operator hoặc full-text syntax từ client đều bị từ chối.

| Loại | Fields được phép | Quy tắc |
|---|---|---|
| Filter | `columnId`, `assigneeId`, `createdById`, `reviewerId`, `category`, `priority`, `dueState`, `dueFrom`, `dueTo` | UUID/date/enum parse trước query; `dueFrom <= dueTo`; column/user phải thuộc project; `dueState` do server suy ra. |
| Sort | `position`, `createdAt`, `updatedAt`, `dueDate` với `asc`/`desc` | Sort được map server-side sang fixed SQL. `position` chỉ hợp lệ khi có `columnId`; không có `columnId` thì reject vì position chỉ có nghĩa trong column. |
| Search | `search` | Chỉ title và description; không search actor, member, activity, project, raw payload hoặc hidden field. |

- Default cho task list không có `columnId` là `created_at DESC, id DESC`. Khi có `columnId` mà không chỉ định sort, board order là `position ASC, id ASC`.
- `createdAt`/`updatedAt` order bằng timestamp rồi `id`; `dueDate` order dùng `due_date` với `NULLS LAST` rồi `id`; `position` order dùng `position` rồi `id`. Direction của `id` theo direction sort để seek pagination không trùng/mất row.
- Search dùng PostgreSQL full-text expression fixed, **có unaccent đối xứng cả hai phía**: index trên `to_tsvector('simple', fb_unaccent(title || ' ' || description))` và query bằng `websearch_to_tsquery('simple', fb_unaccent(:search))`. Không đối xứng thì `thiet ke` không match `thiết kế` — người Việt gõ không dấu thường xuyên, đây là yêu cầu UX, không phải tối ưu.
  - **Bẫy bắt buộc biết khi implement:** `unaccent()` là function `STABLE` (dictionary có thể đổi), PostgreSQL từ chối dùng nó trực tiếp trong expression index (yêu cầu `IMMUTABLE`). `fb_unaccent(text)` là wrapper SQL function do migration tạo, khai báo `IMMUTABLE PARALLEL SAFE` và **chỉ định tường minh dictionary** (`unaccent('public.unaccent'::regdictionary, $1)`). Khai IMMUTABLE an toàn vì dictionary được pin làm contract; nếu đổi dictionary phải reindex trong cùng migration.
  - Chọn `websearch_to_tsquery` thay `plainto_tsquery` vì nó **không bao giờ throw với input lạ** (an toàn cho input người dùng tùy ý), hỗ trợ cụm trong ngoặc kép và `or`/`-`, và degrade tự nhiên; `plainto_tsquery` không có lợi thế nào bù lại việc phải bọc lỗi parse.
  - `pg_trgm` (prefix/typo tolerance) **không dùng ở MVP** — quyết định có ý thức: GIN trigram trên title+description tốn write amplification và dung lượng đáng kể cho một lợi ích chưa có bằng chứng nhu cầu. Xem lại khi telemetry/user feedback cho thấy search miss vì typo hoặc khi search-as-you-type prefix trở thành yêu cầu sản phẩm.
  - Không có fuzzy search, arbitrary `tsquery`, ranking contract hay search toàn tenant ở MVP.
- Task update chỉ allowlist `title`, `description`, `assignee_id`, `reviewer_id`, `category`, `priority`, `start_date` và `due_date`, cùng `expectedVersion`. Nó từ chối `project_id`, `column_id`, `created_by_user_id`, `position`, `version`, `due_state`, timestamps và audit fields. Đổi `column_id` hoặc `position` bắt buộc dùng dedicated Task move use case/transaction.
- Khi expected version không khớp, Task update hoặc move trả `409 Conflict` có **current version** của Task; transaction rollback và không tạo ActivityLog.

## WorkLog list và monthly aggregate contract (Phase 1.3)

`GET /projects/:projectId/work-logs` chỉ nhận `userId`, `taskId`, `status`, `dateFrom`, `dateTo`, `sort` (`workDate` hoặc `updatedAt`) và `direction`. User/task phải thuộc đúng project; `dateFrom <= dateTo`; status chỉ `draft|submitted|approved|rejected`. Không có search description, raw field, arbitrary member list, timezone hoặc client aggregate expression.

- Default order là `work_date DESC, updated_at DESC, id DESC`; cursor fingerprint bind project, canonical filters, sort/direction và actor-visible scope. Mọi filter/sort thay đổi reset cursor.
- Monthly report chỉ nhận `month=YYYY-MM`, optional `userId` và optional status breakdown fixed. Repository tính aggregate trong SQL đã scope project/capability; total chính thức chỉ sum `status = approved`, đồng thời trả fixed counts/minutes cho `approval_kind=self`, `submitted` và `rejected`.
- Daily-total validation không tin client aggregate: create/update/resubmit lấy PostgreSQL advisory transaction lock ổn định từ `(project_id, logged_by_user_id, work_date)`, sum WorkLog active trong scope đó, validate `<= 1440`, rồi conditional write cùng transaction.
- Review/update dùng `WHERE id = :id AND project_id = :project_id AND version = :expected_version`. Status đã đổi, reviewer invalid hoặc version stale trả `409` safe code/current version và không tạo ActivityLog.
- Bulk review nhận danh sách UUID cùng một project cùng status `submitted`; thực hiện authorization/status/version per-record, trả `items: [{ id, status: 'approved'|'rejected'|'conflict'|'denied', code? }]` và không rollback record đã thành công khi record khác fail.

## Board loading theo cột

Board chỉ load active BoardColumn của một project theo `position ASC, id ASC`. Với mỗi column, repository query Task cùng `project_id` và `column_id`, fixed order `position ASC, id ASC`, default 25/max 100 và cursor riêng.

```text
project + active columns
  ├── column A: items + nextCursor + hasMore
  ├── column B: items + nextCursor + hasMore
  └── column C: items + nextCursor + hasMore
```

Không có board query nào fetch toàn bộ Task của project lớn. `nextCursor` của column A không hợp lệ ở column B. Load-more chỉ nạp thêm Task cho chính column đó, giữ Task đã xác nhận ở các column khác. Filter/search/sort thay đổi reset cursor của các column bị ảnh hưởng.

## Required index baseline

Migrations tạo các index dưới đây cùng constraints ở database design. Tên migration có thể khác, nhưng cột, thứ tự và predicate phải giữ ý nghĩa này.

| Table / index keys | Loại | Query phục vụ | Phase |
|---|---|---|---|
| `users(email)` | unique btree | Sign-in/identity lookup canonical email. | Core MVP |
| `auth_sessions(session_token_hash)` | unique btree | SessionGuard lookup opaque session hash. | Core MVP |
| `idempotency_records(user_id, use_case, key_hash)` | unique btree | Idempotency claim/replay lookup; chặn retry đồng thời cùng key. | Core MVP |
| `idempotency_records(expires_at)` | btree | Purge/overwrite record hết hạn. | Core MVP |
| `workspace_members(workspace_id, user_id)` | unique btree | Membership check, duplicate prevention. | Core MVP |
| `workspace_members(user_id, workspace_id)` | btree | Workspace list của actor. | Core MVP |
| `project_members(project_id, user_id)` | unique btree | Project permission/member lookup, duplicate prevention. | Core MVP |
| `project_members(user_id, project_id)` | btree | Danh sách project accessible của actor. | Core MVP |
| `projects(workspace_id, created_at DESC)` | btree | Workspace project list sau access scope. | Core MVP |
| `board_columns(project_id, position)` | btree | Active board-column order trong project. | Core MVP |
| `tasks(project_id, column_id, position)` | unique btree | Per-column board seek/order; deterministic position. | Core MVP |
| `tasks(project_id, created_at DESC, id DESC)` | btree | Default task-list seek/order `created_at DESC, id DESC`. | Core MVP |
| `tasks(project_id, due_date, id)` | btree | Due-date filter/range và sort `dueDate` với seek tie-breaker. Hướng `asc` (NULLS LAST mặc định của btree) được seek trọn vẹn; hướng `desc` với NULLS LAST không khớp một btree đơn — chấp nhận planner sort trong phạm vi project (bounded, đo bằng explain-plan rule); chỉ thêm index `DESC NULLS LAST` riêng khi telemetry chứng minh cần. | Core MVP |
| `tasks(project_id, assignee_id, updated_at DESC)` | btree | Assignee filter và recent task list trong project. | Core MVP |
| `tasks(project_id, created_by_user_id, updated_at DESC)` | btree | Created-by filter và recent task list trong project. | Core MVP |
| `tasks(project_id, reviewer_id, updated_at DESC)` | btree | Reviewer filter (review workflow của cột `requires_reviewer`), đối xứng với assignee/created-by. | Core MVP |
| `tasks(project_id, updated_at DESC, id DESC)` | btree | Allowlisted `updatedAt` sort với seek tie-breaker. | Core MVP |
| `tasks` GIN trên `to_tsvector('simple', fb_unaccent(title \|\| ' ' \|\| description))` | GIN expression | Allowlisted task search unaccent-symmetric trong một project. Yêu cầu extension `unaccent` + function `fb_unaccent` tạo trước index. | Core MVP |
| `comments(task_id, created_at, id)` | btree | Comment list theo task, khớp order/seek `createdAt, id`. | Core MVP |
| `activity_logs(project_id, created_at DESC)` | btree | Project/task activity history. | Core MVP |
| `activity_logs(project_id, task_id, created_at DESC, id DESC)` | btree | `GET /tasks/:taskId/activity` sau project scope, theo deterministic seek order `created_at DESC, id DESC`. | Core MVP |
| `report_exports(project_id, created_at DESC)` | btree | Export status/history list. | Phase 1.1 only |
| `project_time_approvers(project_id, user_id)` | unique btree | Approver membership/duplicate prevention. | Phase 1.3 only |
| `work_logs(project_id, logged_by_user_id, work_date DESC, id DESC)` | btree | User/day list and monthly aggregate scope. | Phase 1.3 only |
| `work_logs(project_id, task_id, work_date DESC, id DESC)` | btree | Task Detail time-log tab. | Phase 1.3 only |
| `work_logs(project_id, status, work_date DESC, id DESC)` | btree | Approver queue/cursor. | Phase 1.3 only |
| `work_log_access_overrides(project_id, user_id, work_date)` | unique btree | Late-date override lookup. | Phase 1.3 only |

`UNIQUE (project_id, column_id, position)` là index Task order ở trên. `UNIQUE (project_id, position)` của BoardColumn đảm bảo deterministic column ordering. `category` và `priority` **cố ý không có index riêng**: enum cardinality thấp, filter luôn chạy sau project scope (và thường sau column/assignee), nên index composite hiện có + filter residual là đủ — explain-plan rule sẽ bắt nếu giả định này sai với dữ liệu thật. Không thêm speculative indexes hay table cho generic reporting, queue, AI, labels, attachments, timer, payroll/billing hoặc full-project task preload.

## Explain-plan verification rule

Trước khi coi một query/index policy đủ cho production-like data, implementer phải chạy `EXPLAIN (ANALYZE, BUFFERS)` trên PostgreSQL với representative data distribution và đúng project scope/filter/sort/cursor của use case.

- Xác minh plan dùng index phù hợp hoặc document lý do planner chọn cách khác; không chấp nhận index chỉ vì migration tạo thành công.
- Kiểm tra ít nhất: per-column board page/load-more, default task list, task `updatedAt` sort, task due-date range và cả sort `dueDate:desc` (hướng không được index seek trọn vẹn — xem index baseline), assignee + recent sort, reviewer filter, task search unaccent scoped project, comments, task activity history, Phase 1.1 export history, WorkLog user/date page, approver submitted queue, task WorkLog tab và monthly aggregate Phase 1.3.
- Nếu plan scan rộng, sort lớn hoặc join vượt scope không cần thiết, sửa query/index rồi đo lại. Mọi index mới phải gắn với use case cụ thể và được review; không để client thay đổi predicate nhằm ép plan khác.

## Transaction boundaries và ActivityLog

Authorization/resource resolution xảy ra trước transaction khi có thể, nhưng điều kiện dễ đổi phải được đọc lại/khóa trong transaction. ActivityLog luôn nằm trong cùng database transaction với mutation nó mô tả; nếu activity insert fail thì mutation rollback, và nếu mutation fail thì không có activity row.

| Mutation | Transaction bắt buộc | ActivityLog trong cùng transaction |
|---|---|---|
| Task create | Re-check project scope/write permission; xác nhận active same-project column, assignee/reviewer membership, date range, category/priority allowlist và reviewer requirement; chọn/lock phạm vi position cần thiết; insert Task với `created_by_user_id` actor và `version = 1`; insert activity; commit. | `task.created` với task/project context đã xác nhận. |
| Task update | Lock Task hoặc conditional update `WHERE id = :id AND project_id = :project_id AND version = :expected_version`; validate allowlist, date range, assignee/reviewer invariant; từ chối `column_id`/`position` và dùng dedicated move cho chúng; update `updated_at`, tăng version một lần; insert activity; commit. | Chỉ khi update thành công. Version mismatch trả `409 Conflict` kèm current version và không có activity. |
| Task move | Dedicated transaction: re-check permission/scope/expected version; lock task, source/destination ordering rows theo nhu cầu; xác nhận destination active/cùng project và reviewer nếu destination yêu cầu; tính position, update column/position/version, rebalance có kiểm soát nếu cần; insert activity; commit. | Một `task.moved` record đúng một lần cho move commit. |
| Project member change | Lock membership/project state cần thiết; xác nhận target là WorkspaceMember của workspace project, role hợp lệ, còn ít nhất một Owner và resulting assignee invariant; insert/update/delete ProjectMember; insert activity; commit. | Event member add/role change/remove chỉ tồn tại khi membership mutation commit. |
| Column archive | Lock column và kiểm tra trong transaction rằng không tồn tại Task ở column; set `archived_at`/`updated_at`; insert activity; commit. Không tự move/delete Task. | `board_column.archived` chỉ sau archive hợp lệ. |
| Activity logging | Không có mutation public độc lập để ghi ActivityLog. Module mutation tạo event allowlisted và sanitized payload trong transaction của nó. | Đây là điều kiện atomic, không phải best-effort side effect. |
| Idempotency record | Giao thức claim → mutation → outcome theo [database design](database-design.md#idempotency_records): T1 claim `in_progress` commit **trước** mutation (chặn retry đồng thời); T2 mutation + activity + update `completed` atomic; business failure xác định ghi outcome lỗi bằng transaction thứ ba sau rollback. | Record `completed` và mutation/activity commit cùng nhau; không tồn tại mutation đã commit mà record chưa completed. |
| Export request (Phase 1.1) | Sau Owner authorization, validate/canonicalize project-scoped filters; insert `report_exports` với immutable `filter_snapshot`, `status = 'requested'`, expiry; insert activity; commit. File generation diễn ra sau commit; update `ready`/`failed` là transaction status riêng, không sửa snapshot. | `report_export.requested` ghi cùng request insert. |
| Time Tracking settings (Phase 1.3) | Lock/conditional update settings; Owner authorization; validate enabled/mode/backfill and every approver is active Editor; replace approver set atomically; increment version; insert activity. | `time_tracking.settings_changed`, approver add/remove events chỉ sau commit. |
| WorkLog create/update/submit | Re-check feature/capability/project/task; lock advisory daily key; validate backfill/override, support reason, duration total and expected version; write valid state; insert activity; commit. | `work_log.created`, `updated`, `submitted` hoặc `self_closed` only after commit. |
| WorkLog review/bulk review | Re-check approver current membership and author mismatch; lock/conditional update each submitted WorkLog; approved/rejected decision and required rejection note; write per-record activity; commit each safe result. | One approved/rejected activity per successful log; a conflict/denial has no false activity. |
| Backfill override | Owner authorization; validate member/date/expiry/reason; upsert one project/member/date row under lock; insert activity; commit. | `work_log.backfill_opened` only after override commit. |

Task move và rebalance dùng row locks đủ hẹp để không tạo duplicate position hoặc lost update. Rebalance **chỉ ghi `position`** của các row bị ghi lại — không tăng `version`, không chạm `updated_at` (ADR-0006 mục 5) — nên nó không tạo `409` giả cho client đang mở các task đó và không xáo seek pagination của index `tasks(project_id, updated_at DESC, id DESC)`. Unique violation phát sinh **tại commit** của rebalance transaction (constraint deferred) được error mapper chuyển về envelope `5xx INTERNAL_ERROR` chuẩn kèm `requestId`: đây là dấu hiệu bug server (rebalance đáng lẽ đã loại trùng), không phải input user — không có nhánh UI riêng. Không giữ transaction mở khi render XLSX, gửi email, gọi network hoặc thực hiện work queue; các hành vi queue/delivery chỉ thuộc Phase 1.2.
