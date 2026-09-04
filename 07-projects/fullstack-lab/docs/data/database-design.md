# Thiết kế database Flowboard

Tài liệu này là hợp đồng PostgreSQL cho các migration và repository tương lai. Nó dùng các tên `snake_case` đúng như bảng/cột ở đây; DTO API có thể dùng camelCase nhưng không được cho client chọn cột hay biểu thức SQL. Quy tắc miền đi kèm nằm ở [mô hình miền](domain-model.md).

## Quy ước toàn cục

- PostgreSQL là database. Mọi `id` là `UUID PRIMARY KEY` (migration tạo UUID, ví dụ `gen_random_uuid()`); foreign key dùng cùng kiểu `UUID`.
- Mọi instant lưu bằng `TIMESTAMPTZ` ở UTC. Application/repository luôn ghi và serialize UTC; không dùng `timestamp without time zone` cho event, session hay audit time.
- `due_date` của Task là `DATE NULL`: đó là ngày theo workspace timezone, không có giờ trong ngày.
- Tất cả foreign key bên dưới dùng `ON DELETE RESTRICT` trừ khi migration sau được phê duyệt thay thế retention policy. Core MVP không có cascade delete dữ liệu private/audit.
- `created_at` là `TIMESTAMPTZ NOT NULL`; bảng mutable cũng có `updated_at TIMESTAMPTZ NOT NULL`. `comments` và `activity_logs` cố ý không có `updated_at` vì append-only/bất biến; repository không update chúng.
- `text` không áp đặt giới hạn độ dài hoặc enum chưa có product contract. Validation application là authoritative; database chỉ check state/value đã được baseline xác định.
- `jsonb` chỉ dùng cho snapshot/payload có schema do use case sở hữu; không là vùng dữ liệu generic hoặc nơi chứa secret plaintext.

## Bảng core MVP

### `users`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | UUID User. |
| `email` | `text` | No | `UNIQUE` | Lưu canonical lowercase trước persist để unique có ý nghĩa case-insensitive. |
| `display_name` | `text` | No |  | Tên hiển thị. |
| `password_hash` | `text` | No |  | Argon2id hash, không plaintext. |
| `email_verified_at` | `timestamptz` | Yes |  | UTC khi xác minh. |
| `password_reset_token_hash` | `text` | Yes |  | Hash của token reset, dùng một lần. |
| `password_reset_expires_at` | `timestamptz` | Yes |  | UTC expiry của reset token hiện hành. |
| `email_verification_token_hash` | `text` | Yes |  | Hash của token xác minh email, dùng một lần. |
| `email_verification_expires_at` | `timestamptz` | Yes |  | UTC expiry của verification token hiện hành. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Retention: giữ trong lifetime của account; core MVP không có account deletion/anonymization hay purge schedule. Token hash hết hạn không được chấp nhận và bị thay thế/null bởi auth flow; không tạo bảng token plaintext riêng.

### `auth_sessions`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | UUID của bản ghi session. |
| `user_id` | `uuid` | No | FK → `users(id)` | Session owner. |
| `session_token_hash` | `text` | No | `UNIQUE` | Hash của opaque cookie/session ID. |
| `expires_at` | `timestamptz` | No |  | UTC expiry. |
| `revoked_at` | `timestamptz` | Yes |  | Thời điểm revoke, do server ghi, theo UTC. |
| `revocation_reason` | `text` | Yes |  | Logout, password reset hoặc server revocation metadata. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi revoke/metadata đổi. |

Retention: session expired/revoked không xác thực được nhưng record được giữ; purge duration/worker chưa thuộc core MVP và cần retention policy phê duyệt trước khi thêm.

### `workspaces`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Tenant identifier. |
| `name` | `text` | No |  | Workspace name; Workspace Settings chưa có editable-field contract khác. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Retention: workspace và dependent records được giữ; core MVP không có workspace delete/archive behavior.

### `workspace_members`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | UUID membership. |
| `workspace_id` | `uuid` | No | FK → `workspaces(id)` | Workspace scope. |
| `user_id` | `uuid` | No | FK → `users(id)` | Member. |
| `role` | `text` | No | `CHECK (role IN ('workspace_admin', 'workspace_member'))` | Vai trò workspace, cố định. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi role đổi. |

Constraints: `UNIQUE (workspace_id, user_id)`. Retention: giữ membership history hiện hành; core MVP không định nghĩa soft delete hoặc archive membership. Remove chỉ được phép nếu không làm vỡ ProjectMember/assignee invariants trong transaction use case.

### `projects`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Project identifier. |
| `workspace_id` | `uuid` | No | FK → `workspaces(id)` | Project thuộc đúng một workspace. |
| `created_by_user_id` | `uuid` | No | FK → `users(id)` | Actor creator; cùng transaction tạo ProjectMember Owner. |
| `name` | `text` | No |  | Trường duy nhất Project Settings MVP được phép update. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Không có `description`, `visibility`, `archived_at` hay delete marker: tất cả Project MVP là private, và Project Settings chỉ đổi `name`. Retention: giữ project cùng dữ liệu project; không có project archive/delete behavior core MVP.

### `project_members`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | UUID membership. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `user_id` | `uuid` | No | FK → `users(id)` | Member. |
| `role` | `text` | No | `CHECK (role IN ('owner', 'editor', 'viewer'))` | Vai trò project, cố định. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi role đổi. |

Constraints: `UNIQUE (project_id, user_id)`. Retention: giữ membership hiện hành; no soft delete/archive core behavior. Transaction bắt buộc xác nhận `user_id` có WorkspaceMember cùng `projects.workspace_id`, giữ ít nhất một Owner, và không leave assignee invalid.

### `board_columns`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Column identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `name` | `text` | No |  | Column name. |
| `requires_reviewer` | `boolean` | No | `DEFAULT false` | Nếu true, move/create task vào cột này yêu cầu reviewer hợp lệ. |
| `is_terminal` | `boolean` | No | `DEFAULT false` | Owner đánh dấu cột là điểm kết thúc công việc. Một project có 0..n cột terminal (ví dụ cả `Xong` và `Huỷ`); không suy từ `position`. Dùng để suy `due_state` và để nhận biết move ra khỏi terminal là mở lại task ([ADR-0008](../decisions/ADR-0008-terminal-column-and-task-reopen.md)). |
| `position` | `numeric(20,10)` | No | part of unique ordering | Thứ tự dạng fractional. |
| `archived_at` | `timestamptz` | Yes |  | `NULL` nghĩa active; UTC archive time. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

`is_terminal` là biểu diễn schema của **terminal state** mà quy tắc `due_state` và [ADR-0001](../decisions/ADR-0001-task-planning-fields-and-review-workflow.md) dựa vào. Migration additive với `DEFAULT false`: project hiện có không có cột nào là terminal, và không backfill suy đoán cột cuối. Không cần index riêng — bảng column của một project rất ít row và luôn được đọc cùng project đã scope.

Constraints: `UNIQUE (project_id, position)` khai báo `DEFERRABLE INITIALLY IMMEDIATE` (chỉ rebalance transaction mới `SET CONSTRAINTS ... DEFERRED`; xem [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md)) và `UNIQUE (project_id, id)` để Task có thể dùng composite foreign key. Rebalance column position chỉ ghi `position`, không chạm `updated_at` (ADR-0006 mục 5). Retention: archive giữ row cho lịch sử; không delete; unarchive chưa là core behavior. Application transaction là nơi cấm archive khi còn Task.

### `tasks`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Task identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Phạm vi project, bắt buộc. |
| `column_id` | `uuid` | No | with `project_id`: FK → `board_columns(project_id, id)` | Bắt buộc cùng project; active state do use case kiểm tra. |
| `created_by_user_id` | `uuid` | No | FK → `users(id)` | Actor tạo task; projection gọi là `createdBy`, không suy diễn là người giao việc hiện tại. |
| `assignee_id` | `uuid` | Yes | with `project_id`: FK → `project_members(project_id, user_id)` | Optional assignee, phải là ProjectMember khi có giá trị. |
| `reviewer_id` | `uuid` | Yes | with `project_id`: FK → `project_members(project_id, user_id)` | Chỉ required khi cột đích có `requires_reviewer = true`; phải khác assignee. |
| `title` | `text` | No |  | Tiêu đề task, bắt buộc. |
| `description` | `text` | No | `DEFAULT ''` | Không có content nghĩa empty text, không phải `NULL`. |
| `category` | `text` | Yes | `CHECK (category IN ('feature','bug','design','research','operations','other'))` | Optional fixed category; không là custom label. |
| `priority` | `text` | No | `CHECK (priority IN ('none','low','medium','high','urgent'))` | Default `none`; mức tương đối, không phải workflow state. |
| `position` | `numeric(20,10)` | No | unique ordering | Thứ tự dạng fractional trong cột. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Version cho optimistic concurrency. |
| `start_date` | `date` | Yes |  | Optional calendar start date, không time-of-day. |
| `due_date` | `date` | Yes |  | Optional calendar end/due date, không time-of-day. |
| `parent_task_id` | `uuid` | Yes | with `project_id`: FK → `tasks(project_id, id)`, `CHECK (parent_task_id IS NULL OR parent_task_id <> id)` | Task cha, chỉ Phase 1.5. **Sâu đúng một cấp**: task đã có cha không được làm cha của task khác — quy tắc use-case làm đồ thị cha–con cycle-free theo cấu trúc, FK không diễn đạt được ([ADR-0011](../decisions/ADR-0011-task-relations-subtask-and-dependency.md)). |
| `sprint_id` | `uuid` | Yes | with `project_id`: FK → `sprints(project_id, id)` | Sprint đang chứa task, chỉ Phase 1.4. `NULL` nghĩa **backlog** và luôn hợp lệ — sprint không bao giờ bắt buộc ([ADR-0010](../decisions/ADR-0010-sprint-iteration.md)). |
| `evidence_url` | `text` | Yes | validation application | Một liên kết bằng chứng, scheme `https` bắt buộc, tối đa 2048 ký tự. **Server không bao giờ fetch URL này** (không preview, không unfurl, không resolve redirect) — fetch sẽ biến field người dùng nhập thành SSRF vector. Không phải attachment: không upload, không storage, không quota ([ADR-0009](../decisions/ADR-0009-task-evidence-and-comment-formatting.md)). |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: direct `FOREIGN KEY (project_id) REFERENCES projects(id)`; `UNIQUE (project_id, id)` cho child composite FK; `FOREIGN KEY (project_id, column_id) REFERENCES board_columns(project_id, id)`; `FOREIGN KEY (project_id, assignee_id) REFERENCES project_members(project_id, user_id)`; `UNIQUE (project_id, column_id, position)` khai báo `DEFERRABLE INITIALLY IMMEDIATE` — bình thường check ngay như unique thường, chỉ rebalance transaction mới defer tới commit; hai unique position constraint không là FK target hay `ON CONFLICT` arbiter nên DEFERRABLE không đổi behavior khác (xem [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md) cho spacing 1024, ngưỡng rebalance 10⁻⁶ và phân tích precision của `numeric(20,10)`). Rebalance **chỉ ghi `position`** của các row bị ghi lại: không tăng `version`, không chạm `updated_at` — `version` chỉ bảo vệ nội dung client sửa được và move tường minh; `updated_at` chỉ phản ánh thay đổi do user (ADR-0006 mục 5). Với `assignee_id NULL`, composite FK không yêu cầu member. Retention: giữ Task và `version`/timestamp cho lifetime project; core MVP không có task delete/archive. Repository chỉ update content/assignment khi `id`, `project_id` và expected `version` cùng khớp; `column_id` và `position` chỉ được thay đổi bởi dedicated Task move transaction.

#### Bất biến về ngày, review và due state của Task

- `start_date` và `due_date` là `DATE NULL` theo timezone workspace. Khi cùng có giá trị, application validation và database check bắt buộc `start_date <= due_date`.
- `reviewer_id`, nếu có, phải là ProjectMember cùng project và khác `assignee_id`. Task vào cột `requires_reviewer = true` không được commit nếu thiếu reviewer hợp lệ.
- `evidence_url` là optional ở mọi cột, kể cả cột `requires_reviewer = true`: không có nhánh chặn move vì thiếu bằng chứng. Nếu review workflow cần cưỡng chế thì đường đúng là một cờ `requires_evidence` do Owner cấu hình, và đó là quyết định riêng cần ADR mới.
- `due_state` không có cột DB. Server suy ra `none`, `scheduled`, `due_soon`, `due_today`, `overdue` từ workspace-local date, `due_date` và `board_columns.is_terminal` của cột chứa task. Task ở cột `is_terminal = true` luôn có `due_state = none` bất kể `start_date`/`due_date`, nên terminal không bao giờ overdue; `none` mang nghĩa không có tín hiệu due-state, bao trùm cả trường hợp không có ngày. Enum và filter allowlist của `dueState` không đổi; affordance hoàn thành của UI lấy từ `is_terminal`, không phải từ một giá trị `dueState` thứ sáu.
- Task query/mutation projection luôn có `createdBy`; đây là người tạo record, không là lịch sử người giao việc. Activity Log là nguồn lịch sử assignment.

### `comments`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Comment identifier. |
| `task_id` | `uuid` | No | FK → `tasks(id)` | Parent task. |
| `author_user_id` | `uuid` | No | FK → `users(id)` | Comment author. |
| `body` | `text` | No |  | Immutable content. |
| `created_at` | `timestamptz` | No |  | UTC. |

Không có `updated_at`, delete marker hoặc revision columns: comment MVP là immutable. Retention: giữ cùng Task cho audit/context; core MVP không có delete/purge behavior.

### `activity_logs`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Activity identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Scope bắt buộc cho history/access. |
| `task_id` | `uuid` | Yes | FK → `tasks(id)` | Có giá trị với event task, null cho project/member/column/export event. |
| `actor_user_id` | `uuid` | No | FK → `users(id)` | User gây ra mutation. |
| `action` | `text` | No |  | Event name do module allowlist, ví dụ `task.created`, không client-controlled. |
| `payload` | `jsonb` | No | `DEFAULT '{}'::jsonb` | Structured, non-secret context của event. |
| `created_at` | `timestamptz` | No |  | Thời điểm ghi thêm, theo UTC. |

Không có `updated_at`: append-only. Retention: giữ cùng project như audit history; không có public edit/delete hay automatic purge MVP. Mỗi row phải được insert trong transaction của mutation mô tả nó.

### `idempotency_records`

Bảng này hiện thực lời hứa của [idempotency contract](../api/api-conventions.md#idempotency-key): retry cùng `Idempotency-Key` trả lại outcome đã lưu thay vì chạy mutation lần hai. Không có bảng này, header chỉ là trang trí — không có chỗ lưu outcome thì không replay được và không chặn được double-create (task/comment không có natural key).

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Record identifier. |
| `user_id` | `uuid` | No | FK → `users(id)` | Authenticated actor sở hữu key; key không chia sẻ giữa actor. |
| `use_case` | `text` | No |  | Định danh route/use case allowlisted (ví dụ `task.create`), do module gán, không client-controlled. |
| `key_hash` | `text` | No |  | Hash của `Idempotency-Key`; **không lưu key thô** — key là bearer-adjacent secret của client. |
| `request_fingerprint` | `text` | No |  | Hash của canonical request (path params + body đã chuẩn hóa sau parse). |
| `status` | `text` | No | `CHECK (status IN ('in_progress', 'completed'))` | `in_progress` chặn retry đồng thời; `completed` giữ outcome. |
| `response_status` | `smallint` | Yes |  | HTTP status của outcome; non-null khi `completed`. |
| `response_body` | `jsonb` | Yes |  | Phần `data`/error envelope an toàn của outcome khi `completed`; xem quy tắc nội dung dưới. |
| `expires_at` | `timestamptz` | No |  | UTC; `created_at + 24h`. Record hết hạn coi như không tồn tại khi lookup. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi status/outcome đổi. |

Constraints: `UNIQUE (user_id, use_case, key_hash)` — đúng scope "authenticated actor, route/use case" của API conventions; `request_fingerprint` không nằm trong unique key mà dùng để phát hiện reuse (`409 IDEMPOTENCY_KEY_REUSED` khi cùng key nhưng fingerprint khác).

**Giao thức claim → mutation → outcome** (xử lý retry đồng thời — hai request cùng key không được cùng thực thi mutation; đường thành công là hai transaction, transaction outcome thứ ba chỉ chạy khi business failure):

1. **T1 — claim, commit trước mutation:** sau guard/parse, use case `INSERT` record `in_progress` và **commit ngay** trong transaction riêng. `in_progress` phải được commit trước khi mutation bắt đầu, nếu không request retry đồng thời không nhìn thấy nó. Nếu insert vướng unique, đọc record hiện có và rẽ nhánh đủ năm trường hợp: (a) record có `expires_at < now()`, bất kể status → coi như không tồn tại — giành lại bằng compare-and-set ghi đè record hết hạn rồi thực thi như request mới; (b) `completed` + cùng fingerprint → replay outcome đã lưu; (c) `completed` hoặc `in_progress` + khác fingerprint → `409 IDEMPOTENCY_KEY_REUSED`; (d) `in_progress` + cùng fingerprint → `409 IDEMPOTENCY_IN_PROGRESS` (request gốc đang chạy, client chờ theo `Retry-After` rồi retry cùng key); (e) `in_progress` đã quá **takeover TTL 60 giây** → conditional update (compare-and-set trên `updated_at`) giành lại record rồi thực thi.
2. **T2 — mutation:** business mutation + ActivityLog + `UPDATE` record thành `completed` với outcome, tất cả **trong cùng transaction**. Vì completed và mutation atomic, không tồn tại trạng thái "mutation đã commit nhưng record chưa completed".
3. **Business failure xác định** (domain validation, stale version…): T2 rollback; use case ghi outcome lỗi an toàn vào record bằng transaction nhỏ thứ ba → retry cùng key replay đúng lỗi đó; ý định mới của user dùng key mới (fingerprint khác cùng key vẫn là `409 IDEMPOTENCY_KEY_REUSED`).

**Chế độ hỏng còn lại (chấp nhận có ghi nhận):** (a) crash giữa T1 và T2 để lại record `in_progress` — an toàn vì mutation chưa commit; takeover TTL 60s cho phép retry thực thi lại; (b) side effect ngoài database transaction (gửi email của auth flow) không được store bảo vệ — email có thể mất khi crash sau commit; các flow email đã có resend endpoint riêng bù lại; (c) replay trong 24h trả snapshot outcome tại thời điểm commit — actor có thể đã mất quyền đọc resource đó ở hiện tại; chấp nhận vì key scoped theo chính actor tạo mutation và TTL ngắn.

**Quy tắc nội dung `response_body`:** chỉ lưu phần `data` hoặc error envelope an toàn đã trả cho client. Không lưu: cookie/session value, CSRF token, reset/verification token, header nhạy cảm, hay bất kỳ giá trị nào api-conventions cấm trong payload. `requestId` không lưu — replay bọc outcome trong envelope với `requestId` mới của chính request replay. `POST /auth/sign-in` cố ý không nằm trong required-key list (response chứa csrfToken) — giữ nguyên.

Retention: record hết hạn (`expires_at < now()`) bị lookup bỏ qua và có thể bị ghi đè bằng compare-and-set khi cùng key quay lại. Physical purge trong core MVP là lệnh vận hành explicit (cùng chính sách "không cron tự phát" của `auth_sessions`); chuyển thành scheduled job khi Phase 1.2 có worker.

### `workspace_invitations`

Bảng này hiện thực [ADR-0013](../decisions/ADR-0013-workspace-member-invitation.md): thêm workspace member bằng lời mời qua email, không bằng tra cứu người dùng.

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Định danh lời mời. |
| `workspace_id` | `uuid` | No | FK → `workspaces(id)` | Workspace được mời vào. |
| `email` | `text` | No |  | Canonical lowercase. Lưu **thô**, không hash, vì phải gửi thư tới nó — xem quy tắc dữ liệu cá nhân dưới đây. |
| `role` | `text` | No | `CHECK (role IN ('workspace_admin', 'workspace_member'))` | Vai trò sẽ được cấp khi chấp nhận. |
| `invited_by_user_id` | `uuid` | No | FK → `users(id)` | Dấu vết audit; **không** phải nguồn quyết định quyền. |
| `token_hash` | `text` | No | `UNIQUE` | Hash của token một lần. **Không lưu token thô.** |
| `status` | `text` | No | `CHECK (status IN ('pending', 'accepted', 'revoked'))` | Chỉ `pending` là dùng được. |
| `expires_at` | `timestamptz` | No |  | UTC; `created_at + 7 ngày`. |
| `accepted_at` | `timestamptz` | Yes | `CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))` | UTC; non-null khi và chỉ khi `status = 'accepted'`. Ràng buộc này ở database chứ không ở use case: không có nó, một hàng `accepted` thiếu `accepted_at` vẫn ghi được và audit mất đúng cái mốc thời gian nó tồn tại để giữ. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi status đổi. |

Constraint: `UNIQUE (workspace_id, email) WHERE status = 'pending'` bằng **partial unique index** — mỗi cặp workspace/email chỉ có một lời mời đang chờ, và database là nơi cưỡng chế điều đó, không phải use case. Cùng lối mà [ADR-0010](../decisions/ADR-0010-sprint-iteration.md) dùng cho một sprint active mỗi project.

**Tiêu thụ token** đặt điều kiện trong `WHERE` của câu `UPDATE` (`token_hash = $1 AND status = 'pending' AND expires_at > now()`), nên hai request cùng token không thể cùng thành công: câu thứ hai cập nhật 0 dòng. Membership và việc đánh dấu `accepted` nằm trong **cùng một** transaction.

**Dữ liệu cá nhân.** `email` ở đây có thể là địa chỉ của người **chưa** là người dùng Flowboard. Nó không được xuất hiện trong log, không trong metric label, và không trong bất kỳ response nào ngoài `GET /workspaces/:workspaceId/invitations` — nơi caller đã có `workspace:member:manage`. Bản ghi `accepted` và `revoked` được giữ làm audit; retention cho chúng là điều kiện xem lại đã ghi trong ADR-0013.

## Bảng Phase 1.1, không phải core MVP

### `report_exports`

Migration/table này chỉ được tạo khi Phase 1.1 bắt đầu; nó không được dùng để suy diễn queue, email delivery hay worker của core MVP.

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Định danh của bản báo cáo hoặc export. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `requested_by_user_id` | `uuid` | No | FK → `users(id)` | Owner actor tại lúc request. |
| `filter_snapshot` | `jsonb` | No |  | Snapshot filter đã validate, giới hạn trong project. |
| `status` | `text` | No | `CHECK (status IN ('requested', 'ready', 'failed', 'purged'))` | Lifecycle state do server ghi. **Hết hạn logic KHÔNG phải một status**: nó luôn được suy từ `expires_at < now()` để không tồn tại hai nguồn sự thật lệch nhau (row `ready` nhưng đã quá hạn là hợp lệ — file còn tồn tại vật lý nhưng download bị chặn theo `expires_at`). `purged` chỉ được ghi khi physical file đã bị hủy theo retention policy (Phase 1.2 trở đi); nó là sự kiện không đảo ngược, khác với hết hạn logic. |
| `file_storage_key` | `text` | Yes |  | Server-side storage reference, không phải public URL. |
| `file_name` | `text` | Yes |  | Metadata tải về, có khi trạng thái là ready. |
| `content_type` | `text` | Yes |  | Content type XLSX mong đợi, có khi trạng thái là ready. |
| `byte_size` | `bigint` | Yes | `CHECK (byte_size >= 0)` | Metadata kích thước file, có khi trạng thái là ready. |
| `expires_at` | `timestamptz` | No |  | UTC; download bị từ chối khi đã hết hạn. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi status/file metadata đổi. |

Retention: file phải inaccessible sau `expires_at`; export row giữ audit/snapshot metadata sau expiry. Physical file purge schedule, queue retry/idempotency và delivery state thuộc Phase 1.2/retention policy sau, không phải core MVP.

## Bảng Phase 1.5, quan hệ giữa Task

Migration Phase 1.5 là additive. Nó không tạo loại quan hệ nào ngoài blocking, không tạo critical path, Gantt hay quan hệ xuyên project.

### `task_dependencies`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Dependency identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `blocking_task_id` | `uuid` | No | with `project_id`: FK → `tasks(project_id, id)` | Task chặn. |
| `blocked_task_id` | `uuid` | No | with `project_id`: FK → `tasks(project_id, id)` | Task bị chặn. |
| `created_by_user_id` | `uuid` | No | FK → `users(id)` | Actor tạo cạnh. |
| `created_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE (project_id, blocking_task_id, blocked_task_id)`; `CHECK (blocking_task_id <> blocked_task_id)`. Composite FK hai phía làm **phụ thuộc xuyên project bất khả thi ngay ở tầng database**, không chỉ ở use case. Không có `updated_at` vì row chỉ được insert hoặc xoá, không update.

Chống cycle là use-case transaction rule: insert lấy advisory transaction lock theo `(project_id)`, chạy recursive CTE kiểm tra khả năng tới được, rồi mới ghi; cycle trả `409 TASK_DEPENDENCY_CYCLE`. Đây là *aggregate* (khả năng tới được trong đồ thị) nên không constraint nào của database thay thế được — khác với "đúng một sprint active" ở Phase 1.4 vốn chỉ cần partial unique index. Tối đa **50 cạnh mỗi chiều cho một task** để recursive walk luôn có biên.

Retention: **xoá cạnh là xoá row thật** (`DELETE`), là hard delete đầu tiên của schema. Ngoại lệ có chủ đích: row này là cạnh join thuần, không mang nội dung người dùng, và lịch sử nằm ở ActivityLog (`task_dependency.added`, `task_dependency.removed`) đúng nguyên tắc Activity Log là nguồn lịch sử. Soft delete chỉ buộc mọi query filter thêm mà không đổi được gì.

## Bảng Phase 1.4, Sprint theo project

Migration Phase 1.4 là additive và tạo feature disabled cho các project hiện có. Các bảng này không tạo estimate/story point, burndown, capacity planning hay sprint xuyên project.

### `project_sprint_settings`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `project_id` | `uuid` | No | PK, FK → `projects(id)` | Một settings row tối đa cho một project. |
| `enabled` | `boolean` | No | `DEFAULT false` | Owner bật theo project; khi tắt thì không route, không CTA, không field sprint trong projection. |
| `default_duration_days` | `smallint` | No | `CHECK (default_duration_days BETWEEN 7 AND 28)` | Default `14`; chỉ là giá trị gợi ý cho form tạo sprint. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Optimistic concurrency cho bảng settings. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

### `sprints`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Sprint identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `name` | `text` | No |  | Tên sprint; unique trong project. |
| `goal` | `text` | Yes |  | Mục tiêu sprint dạng văn bản. |
| `starts_on` | `date` | No |  | Ngày lịch theo timezone workspace. |
| `ends_on` | `date` | No |  | Ngày lịch theo timezone workspace. |
| `status` | `text` | No | `CHECK (status IN ('planned', 'active', 'closed'))` | Vòng đời một chiều `planned → active → closed`. |
| `closed_at` | `timestamptz` | Yes |  | UTC; non-null khi `status = 'closed'`. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Optimistic concurrency. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE (project_id, id)` cho composite FK của Task; `UNIQUE (project_id, name)`; `CHECK (starts_on <= ends_on)`. **Đúng một sprint `active` mỗi project được cưỡng chế tại database** bằng partial unique index `CREATE UNIQUE INDEX ... ON sprints (project_id) WHERE status = 'active'` — invariant này là *uniqueness* nên database giữ được atomically, khác với tổng 1.440 phút/ngày của WorkLog là *aggregate* nên buộc phải advisory lock. Sprint `closed` là bất biến: không mở lại, không nhận thêm task; muốn tiếp tục thì tạo sprint mới. Retention: giữ sprint đã đóng cho lịch sử; không delete.

## Bảng Phase 1.3, Time Tracking theo project

Migration Phase 1.3 là additive và tạo feature disabled cho các project hiện có. Các bảng này không tạo timer, payroll, billing, queue, worker, email delivery hoặc time-export.

### `project_time_tracking_settings`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `project_id` | `uuid` | No | PK, FK → `projects(id)` | Một settings row tối đa cho một project. |
| `enabled` | `boolean` | No | `DEFAULT false` | Owner bật theo project. |
| `approval_mode` | `text` | No | `CHECK (approval_mode IN ('self_close', 'requires_approval'))` | Default `self_close`. |
| `backfill_days` | `smallint` | No | `CHECK (backfill_days BETWEEN 0 AND 31)` | Default `7`; today + số ngày lịch trước đó. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Optimistic concurrency cho bảng settings. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

### `project_time_approvers`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Record identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `user_id` | `uuid` | No | with `project_id`: FK → `project_members(project_id, user_id)` | User được chỉ định; role Editor check trong use case/transaction. |
| `assigned_by_user_id` | `uuid` | No | FK → `users(id)` | Owner actor đổi settings. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE(project_id, user_id)`. Database FK bảo vệ scope; transaction settings/member-management kiểm tra user hiện là Editor, không biến Owner thành row cần thiết và thu hồi effect ngay khi role/member không còn hợp lệ.

### `work_logs`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | WorkLog identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Phạm vi project, bắt buộc. |
| `task_id` | `uuid` | No | with `project_id`: FK → `tasks(project_id, id)` | Task cùng project. |
| `logged_by_user_id` | `uuid` | No | with `project_id`: FK → `project_members(project_id, user_id)` | Author; Owner/Editor validation ở use case. |
| `work_date` | `date` | No |  | Ngày theo lịch ở múi giờ của workspace. |
| `duration_minutes` | `integer` | No | `CHECK (duration_minutes BETWEEN 1 AND 1440)` | Aggregate của author cho task/ngày. |
| `description` | `text` | No |  | Báo cáo đã làm gì; application validation authoritative. |
| `support_reason` | `text` | Yes |  | Required application-side khi task assignee khác author. |
| `status` | `text` | No | `CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'))` | Lifecycle do use case điều khiển. |
| `approval_kind` | `text` | Yes | `CHECK (approval_kind IN ('self', 'reviewed'))` | Non-null chỉ khi approved. |
| `submitted_at` | `timestamptz` | Yes |  | UTC. |
| `reviewed_at` | `timestamptz` | Yes |  | Theo UTC; thời điểm review approved hoặc rejected. |
| `reviewed_by_user_id` | `uuid` | Yes | FK → `users(id)` | Không bao giờ trùng tác giả khi approval mode yêu cầu review. |
| `review_note` | `text` | Yes |  | Phía ứng dụng bắt buộc điền khi rejected. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Dùng cho cập nhật có điều kiện khi review. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraint: `UNIQUE(project_id, task_id, logged_by_user_id, work_date)`. Các FK composite đòi hỏi `UNIQUE(project_id, id)` trên `tasks` và `UNIQUE(project_id, user_id)` trên `project_members`. Còn lại — tổng giờ mỗi ngày tính trên nhiều hàng, cửa sổ backfill, vai trò approver và tư cách thành viên tại thời điểm review, điều kiện không tự review, và các bước chuyển status — vẫn là quy tắc trong transaction của use case, **không** đẩy xuống trigger.

### `work_log_access_overrides`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Override identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `user_id` | `uuid` | No | with `project_id`: FK → `project_members(project_id, user_id)` | Member được mở ghi bù. |
| `work_date` | `date` | No |  | Một calendar day workspace-local. |
| `expires_at` | `timestamptz` | No |  | UTC, server check trước mutation. |
| `reason` | `text` | No |  | Owner giải thích lý do mở lại. |
| `opened_by_user_id` | `uuid` | No | FK → `users(id)` | Owner actor. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE(project_id, user_id, work_date)`. Reopen/update cùng target dùng optimistic/row lock để không tạo nhiều override mơ hồ; expiry không xóa audit row.

## Migration order và ràng buộc cross-table

1. Tạo `users`, rồi `auth_sessions`, `idempotency_records` (chỉ FK → `users`), `workspaces`, `workspace_members`, `projects`, `project_members`, `board_columns`, `tasks`, `comments`, `activity_logs` theo thứ tự foreign key.
2. Tạo unique/composite foreign keys của Task sau `project_members` và `board_columns`; chúng bảo vệ same-project column/assignee ngay tại database.
3. `CREATE EXTENSION IF NOT EXISTS unaccent` và function `fb_unaccent(text)` (`IMMUTABLE`, pin dictionary — xem [query and index policy](query-and-index-policy.md)) phải chạy **trước** migration tạo GIN search index; extension phải có sẵn trong PostgreSQL image local/CI theo [local development](../operations/local-development.md).
4. Không thể chỉ dùng foreign key để biết BoardColumn còn active, WorkspaceMember tương ứng tồn tại, Owner cuối cùng hay column còn task. Các điều kiện đó là use-case transaction rules, không trigger ngầm.
5. Tạo `report_exports` và index liên quan chỉ với Phase 1.1.
6. Tạo `workspace_invitations` sau `workspaces` và `users`, cùng partial unique index `(workspace_id, email) WHERE status = 'pending'`. Bảng này thuộc core MVP theo [ADR-0013](../decisions/ADR-0013-workspace-member-invitation.md), không phải phase sau.
7. Khi Phase 1.3 bắt đầu, tạo `project_time_tracking_settings`, `project_time_approvers`, `work_logs`, `work_log_access_overrides` sau projects/project_members/tasks; migration additive và settings mặc định disabled.
8. Khi Phase 1.4 bắt đầu, tạo `project_sprint_settings` và `sprints` sau `projects`, rồi thêm `tasks.sprint_id` cùng composite FK và partial unique index của sprint active; migration additive và settings mặc định disabled.
9. Khi Phase 1.5 bắt đầu, thêm `tasks.parent_task_id` cùng composite FK/CHECK và tạo `task_dependencies` sau `tasks`; migration additive.
10. Không tạo bảng queue, email delivery, AI, labels, attachments hay post-MVP table nào cho core behavior; Phase 1.3 không tạo timer/payroll/billing/time-export tables và Phase 1.4 không tạo estimate/velocity/capacity tables.

Index cụ thể và cách query/transaction dùng các bảng này nằm ở [query và index policy](query-and-index-policy.md).
