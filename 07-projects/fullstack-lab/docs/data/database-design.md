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
| `password_reset_token_hash` | `text` | Yes |  | One-time reset token hash. |
| `password_reset_expires_at` | `timestamptz` | Yes |  | UTC expiry của reset token hiện hành. |
| `email_verification_token_hash` | `text` | Yes |  | One-time verification token hash. |
| `email_verification_expires_at` | `timestamptz` | Yes |  | UTC expiry của verification token hiện hành. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Retention: giữ trong lifetime của account; core MVP không có account deletion/anonymization hay purge schedule. Token hash hết hạn không được chấp nhận và bị thay thế/null bởi auth flow; không tạo bảng token plaintext riêng.

### `auth_sessions`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | UUID session record. |
| `user_id` | `uuid` | No | FK → `users(id)` | Session owner. |
| `session_token_hash` | `text` | No | `UNIQUE` | Hash của opaque cookie/session ID. |
| `expires_at` | `timestamptz` | No |  | UTC expiry. |
| `revoked_at` | `timestamptz` | Yes |  | UTC server-side revocation time. |
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
| `role` | `text` | No | `CHECK (role IN ('workspace_admin', 'workspace_member'))` | Fixed workspace role. |
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
| `role` | `text` | No | `CHECK (role IN ('owner', 'editor', 'viewer'))` | Fixed project role. |
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
| `position` | `numeric(20,10)` | No | part of unique ordering | Gap/fractional order. |
| `archived_at` | `timestamptz` | Yes |  | `NULL` nghĩa active; UTC archive time. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE (project_id, position)` khai báo `DEFERRABLE INITIALLY IMMEDIATE` (chỉ rebalance transaction mới `SET CONSTRAINTS ... DEFERRED`; xem [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md)) và `UNIQUE (project_id, id)` để Task có thể dùng composite foreign key. Retention: archive giữ row cho lịch sử; không delete; unarchive chưa là core behavior. Application transaction là nơi cấm archive khi còn Task.

### `tasks`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Task identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Mandatory project scope. |
| `column_id` | `uuid` | No | with `project_id`: FK → `board_columns(project_id, id)` | Bắt buộc cùng project; active state do use case kiểm tra. |
| `created_by_user_id` | `uuid` | No | FK → `users(id)` | Actor tạo task; projection gọi là `createdBy`, không suy diễn là người giao việc hiện tại. |
| `assignee_id` | `uuid` | Yes | with `project_id`: FK → `project_members(project_id, user_id)` | Optional assignee, phải là ProjectMember khi có giá trị. |
| `reviewer_id` | `uuid` | Yes | with `project_id`: FK → `project_members(project_id, user_id)` | Chỉ required khi cột đích có `requires_reviewer = true`; phải khác assignee. |
| `title` | `text` | No |  | Required task title. |
| `description` | `text` | No | `DEFAULT ''` | Không có content nghĩa empty text, không phải `NULL`. |
| `category` | `text` | Yes | `CHECK (category IN ('feature','bug','design','research','operations','other'))` | Optional fixed category; không là custom label. |
| `priority` | `text` | No | `CHECK (priority IN ('none','low','medium','high','urgent'))` | Default `none`; mức tương đối, không phải workflow state. |
| `position` | `numeric(20,10)` | No | unique ordering | Gap/fractional order trong column. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Optimistic concurrency version. |
| `start_date` | `date` | Yes |  | Optional calendar start date, không time-of-day. |
| `due_date` | `date` | Yes |  | Optional calendar end/due date, không time-of-day. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: direct `FOREIGN KEY (project_id) REFERENCES projects(id)`; `UNIQUE (project_id, id)` cho child composite FK; `FOREIGN KEY (project_id, column_id) REFERENCES board_columns(project_id, id)`; `FOREIGN KEY (project_id, assignee_id) REFERENCES project_members(project_id, user_id)`; `UNIQUE (project_id, column_id, position)` khai báo `DEFERRABLE INITIALLY IMMEDIATE` — bình thường check ngay như unique thường, chỉ rebalance transaction mới defer tới commit; hai unique position constraint không là FK target hay `ON CONFLICT` arbiter nên DEFERRABLE không đổi behavior khác (xem [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md) cho spacing 1024, ngưỡng rebalance 10⁻⁶ và phân tích precision của `numeric(20,10)`). Với `assignee_id NULL`, composite FK không yêu cầu member. Retention: giữ Task và `version`/timestamp cho lifetime project; core MVP không có task delete/archive. Repository chỉ update content/assignment khi `id`, `project_id` và expected `version` cùng khớp; `column_id` và `position` chỉ được thay đổi bởi dedicated Task move transaction.

#### Task date, review and due-state invariants

- `start_date` và `due_date` là `DATE NULL` theo timezone workspace. Khi cùng có giá trị, application validation và database check bắt buộc `start_date <= due_date`.
- `reviewer_id`, nếu có, phải là ProjectMember cùng project và khác `assignee_id`. Task vào cột `requires_reviewer = true` không được commit nếu thiếu reviewer hợp lệ.
- `due_state` không có cột DB. Server suy ra `none`, `scheduled`, `due_soon`, `due_today`, `overdue` từ workspace-local date, `due_date` và terminal state; task terminal không bao giờ overdue.
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
| `created_at` | `timestamptz` | No |  | UTC append time. |

Không có `updated_at`: append-only. Retention: giữ cùng project như audit history; không có public edit/delete hay automatic purge MVP. Mỗi row phải được insert trong transaction của mutation mô tả nó.

## Bảng Phase 1.1, không phải core MVP

### `report_exports`

Migration/table này chỉ được tạo khi Phase 1.1 bắt đầu; nó không được dùng để suy diễn queue, email delivery hay worker của core MVP.

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `id` | `uuid` | No | PK | Report/export identifier. |
| `project_id` | `uuid` | No | FK → `projects(id)` | Project scope. |
| `requested_by_user_id` | `uuid` | No | FK → `users(id)` | Owner actor tại lúc request. |
| `filter_snapshot` | `jsonb` | No |  | Validated, project-scoped filter snapshot. |
| `status` | `text` | No | `CHECK (status IN ('requested', 'ready', 'failed', 'expired'))` | Phase 1.1 lifecycle state. |
| `file_storage_key` | `text` | Yes |  | Server-side storage reference, không phải public URL. |
| `file_name` | `text` | Yes |  | Download metadata khi ready. |
| `content_type` | `text` | Yes |  | Expected XLSX content type khi ready. |
| `byte_size` | `bigint` | Yes | `CHECK (byte_size >= 0)` | File metadata khi ready. |
| `expires_at` | `timestamptz` | No |  | UTC; download bị từ chối khi đã hết hạn. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC khi status/file metadata đổi. |

Retention: file phải inaccessible sau `expires_at`; export row giữ audit/snapshot metadata sau expiry. Physical file purge schedule, queue retry/idempotency và delivery state thuộc Phase 1.2/retention policy sau, không phải core MVP.

## Bảng Phase 1.3, Time Tracking theo project

Migration Phase 1.3 là additive và tạo feature disabled cho các project hiện có. Các bảng này không tạo timer, payroll, billing, queue, worker, email delivery hoặc time-export.

### `project_time_tracking_settings`

| Cột | PostgreSQL type | Null | Key / constraint | Ghi chú |
|---|---|:---:|---|---|
| `project_id` | `uuid` | No | PK, FK → `projects(id)` | Một settings row tối đa cho một project. |
| `enabled` | `boolean` | No | `DEFAULT false` | Owner bật theo project. |
| `approval_mode` | `text` | No | `CHECK (approval_mode IN ('self_close', 'requires_approval'))` | Default `self_close`. |
| `backfill_days` | `smallint` | No | `CHECK (backfill_days BETWEEN 0 AND 31)` | Default `7`; today + số ngày lịch trước đó. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Optimistic concurrency cho settings. |
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
| `project_id` | `uuid` | No | FK → `projects(id)` | Mandatory project scope. |
| `task_id` | `uuid` | No | with `project_id`: FK → `tasks(project_id, id)` | Task cùng project. |
| `logged_by_user_id` | `uuid` | No | with `project_id`: FK → `project_members(project_id, user_id)` | Author; Owner/Editor validation ở use case. |
| `work_date` | `date` | No |  | Workspace-local calendar date. |
| `duration_minutes` | `integer` | No | `CHECK (duration_minutes BETWEEN 1 AND 1440)` | Aggregate của author cho task/ngày. |
| `description` | `text` | No |  | Báo cáo đã làm gì; application validation authoritative. |
| `support_reason` | `text` | Yes |  | Required application-side khi task assignee khác author. |
| `status` | `text` | No | `CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'))` | Lifecycle do use case điều khiển. |
| `approval_kind` | `text` | Yes | `CHECK (approval_kind IN ('self', 'reviewed'))` | Non-null chỉ khi approved. |
| `submitted_at` | `timestamptz` | Yes |  | UTC. |
| `reviewed_at` | `timestamptz` | Yes |  | UTC; approved/rejected review. |
| `reviewed_by_user_id` | `uuid` | Yes | FK → `users(id)` | Never same author when approval mode requires review. |
| `review_note` | `text` | Yes |  | Required application-side cho rejected. |
| `version` | `integer` | No | `DEFAULT 1`, `CHECK (version > 0)` | Conditional update/review. |
| `created_at` | `timestamptz` | No |  | UTC. |
| `updated_at` | `timestamptz` | No |  | UTC. |

Constraints: `UNIQUE(project_id, task_id, logged_by_user_id, work_date)`; composite FKs require `UNIQUE(project_id, id)` on `tasks` and `UNIQUE(project_id, user_id)` on `project_members`. Cross-row daily total, backfill window, approver role/current membership, no self-review and status transition remain use-case transaction rules, not trigger magic.

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

1. Tạo `users`, rồi `auth_sessions`, `workspaces`, `workspace_members`, `projects`, `project_members`, `board_columns`, `tasks`, `comments`, `activity_logs` theo thứ tự foreign key.
2. Tạo unique/composite foreign keys của Task sau `project_members` và `board_columns`; chúng bảo vệ same-project column/assignee ngay tại database.
3. Không thể chỉ dùng foreign key để biết BoardColumn còn active, WorkspaceMember tương ứng tồn tại, Owner cuối cùng hay column còn task. Các điều kiện đó là use-case transaction rules, không trigger ngầm.
4. Tạo `report_exports` và index liên quan chỉ với Phase 1.1.
5. Khi Phase 1.3 bắt đầu, tạo `project_time_tracking_settings`, `project_time_approvers`, `work_logs`, `work_log_access_overrides` sau projects/project_members/tasks; migration additive và settings mặc định disabled.
6. Không tạo bảng queue, email delivery, AI, labels, attachments hay post-MVP table nào cho core behavior; Phase 1.3 cũng không tạo timer/payroll/billing/time-export tables.

Index cụ thể và cách query/transaction dùng các bảng này nằm ở [query và index policy](query-and-index-policy.md).
