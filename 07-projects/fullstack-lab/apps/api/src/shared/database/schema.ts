import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Schema PostgreSQL — bản dịch của `docs/data/database-design.md`.
 *
 * Bảng xuất hiện theo đúng mốc tạo ra chúng, không dựng sẵn. M1 mang `users`,
 * `auth_sessions`, `idempotency_records`; M2 mang `workspaces`,
 * `workspace_members`, `projects`, `project_members`, và `workspace_invitations`
 * theo ADR-0013. `board_columns`, `tasks`, `comments` và `activity_logs` thuộc
 * M3 và M4.
 *
 * Quy ước: cột dùng `snake_case` và **không** lộ thành API contract; projection
 * `camelCase` là việc của `@flowboard/contracts`.
 */

/** Mọi instant lưu ở UTC, có timezone. */
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Lưu **canonical lowercase** trước khi persist, để `UNIQUE` có nghĩa
   * case-insensitive mà không cần index trên biểu thức.
   */
  email: text("email").notNull().unique(),

  displayName: text("display_name").notNull(),

  /** Argon2id hash. Không bao giờ là plaintext, và không bao giờ ra khỏi server. */
  passwordHash: text("password_hash").notNull(),

  emailVerifiedAt: utc("email_verified_at"),

  /**
   * Token reset và verification chỉ lưu **hash**, mỗi loại đúng một token còn
   * hiệu lực. Cấp token mới thì token cũ mất hiệu lực ngay, vì cột bị ghi đè.
   */
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: utc("password_reset_expires_at"),
  emailVerificationTokenHash: text("email_verification_token_hash"),
  emailVerificationExpiresAt: utc("email_verification_expires_at"),

  createdAt: utc("created_at").notNull().defaultNow(),
  updatedAt: utc("updated_at").notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    /**
     * Hash của session ID opaque. Giá trị thô chỉ tồn tại trong cookie của
     * trình duyệt — server không bao giờ lưu nó, nên rò rỉ database không cho
     * kẻ tấn công một session dùng được.
     */
    sessionTokenHash: text("session_token_hash").notNull().unique(),

    expiresAt: utc("expires_at").notNull(),

    /**
     * Session hết hạn hoặc bị revoke thì không xác thực được nữa, nhưng bản ghi
     * **được giữ lại**: nó là bằng chứng cho điều tra sự cố. Purge cần một
     * retention policy riêng, chưa thuộc core MVP.
     */
    revokedAt: utc("revoked_at"),
    revocationReason: text("revocation_reason"),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Key thuộc về đúng một actor; không chia sẻ giữa các actor. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    /** Định danh use case do **module** gán, không bao giờ do client gửi. */
    useCase: text("use_case").notNull(),

    /**
     * Hash của `Idempotency-Key`. **Không lưu key thô**: nó là bí mật của
     * client, gần với bearer token.
     */
    keyHash: text("key_hash").notNull(),

    /** Hash của request đã chuẩn hoá — dùng để phát hiện tái dùng key sai. */
    requestFingerprint: text("request_fingerprint").notNull(),

    status: text("status").notNull(),

    responseStatus: smallint("response_status"),

    /**
     * Chỉ phần `data` hoặc error envelope an toàn đã trả cho client. Không bao
     * giờ chứa cookie, CSRF token, hash token, hay payload nội bộ.
     */
    responseBody: jsonb("response_body"),

    /** `created_at + 24h`. Record hết hạn coi như không tồn tại khi lookup. */
    expiresAt: utc("expires_at").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Đúng scope "authenticated actor, route/use case" của API conventions.
    // `request_fingerprint` cố ý **không** nằm trong unique key: nó dùng để
    // phân biệt tái dùng key, chứ không để cho phép hai record cùng key.
    uniqueIndex("idempotency_records_actor_use_case_key_idx").on(
      table.userId,
      table.useCase,
      table.keyHash,
    ),
    index("idempotency_records_expires_at_idx").on(table.expiresAt),
    check("idempotency_records_status_check", sql`${table.status} in ('in_progress', 'completed')`),
  ],
);

/* ------------------------------------------------------------------------- *
 * M2 — workspace và project scope
 *
 * Bước 1 và 2 của thứ tự migration ở `docs/data/database-design.md`. Thứ tự
 * khai báo ở đây trùng thứ tự foreign key: `workspaces` → `workspace_members` →
 * `projects` → `project_members`.
 *
 * Mọi foreign key dùng `ON DELETE RESTRICT` theo quy ước toàn cục của thiết kế
 * database: core MVP **không** cascade delete dữ liệu private hay audit. Xoá
 * một hàng mà còn hàng phụ thuộc phải là quyết định tường minh của use case,
 * không phải hiệu ứng phụ âm thầm của database.
 * ------------------------------------------------------------------------- */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: utc("created_at").notNull().defaultNow(),
  updatedAt: utc("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /**
     * Hai vai trò workspace cố định. `CHECK` ở database là lớp phòng thủ thứ
     * hai sau Zod: một đường ghi bỏ qua validation vẫn không tạo được vai trò
     * mà catalog permission không biết tới.
     */
    role: text("role").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Membership check và chặn trùng — index baseline.
    uniqueIndex("workspace_members_workspace_user_idx").on(table.workspaceId, table.userId),
    // Chiều ngược lại phục vụ `GET /workspaces`: danh sách workspace của actor.
    index("workspace_members_user_workspace_idx").on(table.userId, table.workspaceId),
    check(
      "workspace_members_role_check",
      sql`${table.role} in ('workspace_admin', 'workspace_member')`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),

    /**
     * Actor tạo project. Cùng transaction tạo một `project_members` vai trò
     * `owner` cho chính người này — cột này là dấu vết lịch sử, **không** phải
     * nguồn quyết định quyền. Quyền đọc từ `project_members`, luôn luôn.
     */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Trường duy nhất Project Settings của MVP được phép update. */
    name: text("name").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Danh sách project trong workspace, sau khi đã lọc theo access scope.
    index("projects_workspace_created_at_idx").on(table.workspaceId, table.createdAt.desc()),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Ba vai trò project cố định; không có custom role trong MVP. */
    role: text("role").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * `UNIQUE (project_id, user_id)` phục vụ hai việc cùng lúc: chặn membership
     * trùng, và làm **target cho composite foreign key** của các bảng sau —
     * `tasks(project_id, assignee_id)`, `tasks(project_id, reviewer_id)`,
     * `work_logs(project_id, logged_by_user_id)`. Nhờ nó, "assignee phải là
     * thành viên **cùng project**" được database cưỡng chế, chứ không chỉ được
     * use case hứa.
     */
    uniqueIndex("project_members_project_user_idx").on(table.projectId, table.userId),
    // Chiều ngược lại: danh sách project mà actor truy cập được.
    index("project_members_user_project_idx").on(table.userId, table.projectId),
    check("project_members_role_check", sql`${table.role} in ('owner', 'editor', 'viewer')`),
  ],
);

/* ------------------------------------------------------------------------- *
 * ADR-0013 — lời mời workspace qua email
 *
 * Bước 6 của thứ tự migration: sau `workspaces` và `users`.
 *
 * Bảng này tồn tại vì thêm workspace member bằng **tra cứu người dùng** là một
 * oracle dò email. Ai xác minh email cũng tạo được workspace để tự thành
 * Workspace Admin, nên một endpoint "chỉ dành cho admin" không thu hẹp gì —
 * nó mở cho mọi người vừa đăng ký. Mời theo email không cần biết account có
 * tồn tại, nên không có gì để dò.
 * ------------------------------------------------------------------------- */

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),

    /**
     * Canonical lowercase, lưu **thô** chứ không hash — vì phải gửi thư tới nó.
     *
     * Đây là dữ liệu cá nhân của người **có thể chưa từng là người dùng
     * Flowboard**: họ chưa đồng ý gì cả. Nên nó không được xuất hiện trong log,
     * trong metric label, hay trong bất kỳ response nào ngoài
     * `GET /workspaces/:workspaceId/invitations` — nơi caller đã có
     * `workspace:member:manage`.
     */
    email: text("email").notNull(),

    /** Vai trò sẽ được cấp **khi chấp nhận**, không phải quyền có ngay. */
    role: text("role").notNull(),

    /** Dấu vết audit; **không** phải nguồn quyết định quyền. */
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /**
     * Hash của token một lần. **Không lưu token thô** — cùng lối với session
     * token và token xác minh email: rò rỉ database không cho ai một lời mời
     * dùng được.
     */
    tokenHash: text("token_hash").notNull().unique(),

    status: text("status").notNull(),

    /** UTC; `created_at + 7 ngày`. */
    expiresAt: utc("expires_at").notNull(),

    /** UTC; non-null khi `status = 'accepted'`. */
    acceptedAt: utc("accepted_at"),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * Mỗi cặp workspace/email chỉ có **một** lời mời đang chờ, và **database**
     * là nơi cưỡng chế điều đó.
     *
     * Một use case kiểm trước rồi insert sau là một race có hai nhánh cùng
     * thắng: hai request đồng thời cùng đọc "chưa có", cùng insert, và workspace
     * có hai lời mời pending với hai token khác nhau — thu hồi một cái không
     * giết được cái kia. Partial unique index thì không có cửa sổ đó.
     *
     * Cùng lối mà ADR-0010 dùng cho "đúng một sprint active mỗi project".
     */
    uniqueIndex("workspace_invitations_pending_uniq")
      .on(table.workspaceId, table.email)
      .where(sql`${table.status} = 'pending'`),

    // Danh sách lời mời pending của một workspace, theo seek order mặc định.
    index("workspace_invitations_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
    ),

    check(
      "workspace_invitations_role_check",
      sql`${table.role} in ('workspace_admin', 'workspace_member')`,
    ),
    check(
      "workspace_invitations_status_check",
      sql`${table.status} in ('pending', 'accepted', 'revoked')`,
    ),
    /**
     * `accepted_at` và `status` không được nói hai điều khác nhau. Không có
     * check này, một bản ghi `accepted` mà thiếu `accepted_at` vẫn ghi được, và
     * audit mất một mốc thời gian mà không ai phát hiện.
     */
    check(
      "workspace_invitations_accepted_at_check",
      sql`(${table.status} = 'accepted') = (${table.acceptedAt} is not null)`,
    ),
  ],
);

/* ------------------------------------------------------------------------- *
 * M3 — board column và activity log
 *
 * `board_columns` mang **fractional ordering** (ADR-0006) và cờ `is_terminal`
 * (ADR-0008). `activity_logs` được kéo từ M4 sang M3 để sáu event của mốc này
 * không cộng dồn vào năm event M2 còn nợ.
 * ------------------------------------------------------------------------- */

export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),

    name: text("name").notNull(),

    /**
     * Move/create task vào cột này yêu cầu reviewer hợp lệ.
     *
     * Có mặt **ngay từ migration này** dù tác dụng chỉ thấy ở M4: thêm một cột
     * vào bảng đã có dữ liệu đắt hơn nhiều so với việc khai nó lúc tạo bảng.
     * Đổi cờ này **không hồi tố** — task đã nằm trong cột mà thiếu reviewer vẫn
     * ở nguyên.
     */
    requiresReviewer: boolean("requires_reviewer").notNull().default(false),

    /**
     * Cột là điểm kết thúc công việc (ADR-0008).
     *
     * Một project có **0..n** cột terminal — cả `Xong` lẫn `Huỷ` đều có thể là
     * terminal — và nó **không** suy được từ `position`: Owner reorder thì cột
     * cuối đổi, còn ý nghĩa "đã xong" thì không.
     */
    isTerminal: boolean("is_terminal").notNull().default(false),

    /**
     * Thứ tự fractional, `numeric(20,10)`.
     *
     * `mode: "string"`, **không** phải `"number"`.
     *
     * M3 đọc cột này bằng `number` và ghi nhận đó là nợ; M4 trả nợ vì task đẩy
     * position lên dải 10⁷, nơi `double` không còn giữ nổi 10 chữ số thập phân
     * — `"99999999.9999999999"` quay về thành `"100000000.0000000000"`. Số học
     * ordering sống ở `shared/ordering/position.ts` và làm việc trên `bigint`
     * đã tỉ lệ theo 10¹⁰, đúng như database lưu.
     *
     * Precision 10 chữ số thập phân là biên: từ gap 1024, chia đôi liên tiếp
     * cùng một khe khoảng 43 lần thì midpoint tròn về trùng neighbor. Ngưỡng
     * rebalance 10⁻⁶ dừng trước đó ~13 lần chia đôi, nên cạn precision không
     * còn là chế độ hỏng đạt tới được.
     */
    position: numeric("position", { precision: 20, scale: 10, mode: "string" }).notNull(),

    /** `NULL` nghĩa active. Archive là transition một chiều của MVP. */
    archivedAt: utc("archived_at"),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * `UNIQUE (project_id, position)` — **`DEFERRABLE INITIALLY IMMEDIATE`**.
     *
     * Drizzle không khai được thuộc tính `DEFERRABLE`, nên nó được thêm bằng
     * tay trong `drizzle/0003_board_columns_and_activity.sql`. Ở đây khai
     * `unique()` (constraint, **không** phải `uniqueIndex()`) là có chủ đích:
     * PostgreSQL chỉ cho phép `DEFERRABLE` trên **constraint**, còn
     * `CREATE UNIQUE INDEX` thì không bao giờ deferrable được.
     *
     * Vì sao cần defer: rebalance ghi lại position của N row trong một
     * transaction, và với giá trị hiện hành tuỳ ý **không tồn tại** một thứ tự
     * update đơn giản nào tránh được trùng ở mọi bước trung gian mà không dùng
     * mẹo hai lượt (dịch sang dải âm rồi ghi lại) — gấp đôi số write và dễ sai.
     * Defer cho phép trạng thái trung gian trùng, và uniqueness vẫn được kiểm
     * đầy đủ tại commit.
     *
     * An toàn vì constraint này không là target của foreign key nào (FK trỏ
     * `(project_id, id)`) và không endpoint nào dùng nó làm `ON CONFLICT`
     * arbiter.
     */
    unique("board_columns_project_position_uniq").on(table.projectId, table.position),

    /**
     * `UNIQUE (project_id, id)` — **vô dụng ở M3 và vẫn phải có**.
     *
     * Nó là target cho composite FK `tasks(project_id, column_id)` ở M4, thứ
     * làm "task thuộc cột **cùng project**" được database cưỡng chế thay vì chỉ
     * được use case hứa. Thêm nó sau nghĩa là một migration trên bảng đã có
     * dữ liệu.
     */
    unique("board_columns_project_id_uniq").on(table.projectId, table.id),

    // Đọc board: cột active của một project theo thứ tự.
    index("board_columns_project_position_idx").on(table.projectId, table.position),
  ],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),

    /**
     * Nullable, và **chưa có foreign key** ở M3.
     *
     * FK trỏ `tasks(id)`, mà `tasks` chưa tồn tại; M4 thêm bằng
     * `ALTER TABLE ... ADD CONSTRAINT`. Mọi event của M3 là project/member/
     * column nên cột này là `NULL` xuyên suốt — không có dữ liệu nào cần
     * backfill khi constraint được thêm.
     */
    taskId: uuid("task_id"),

    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /**
     * Tên event do **module allowlist**, không bao giờ đến từ client.
     *
     * Không có `CHECK` liệt kê giá trị: allowlist sống ở tầng ứng dụng nơi mỗi
     * module sở hữu event của mình, và một `CHECK` ở đây sẽ buộc mọi mốc thêm
     * event phải chạy migration — đúng loại ma sát khiến người ta lách bằng
     * cách dùng lại một event sai nghĩa.
     */
    action: text("action").notNull(),

    /** Structured, non-secret. `summary` mà client thấy do server dựng từ đây. */
    payload: jsonb("payload").notNull().default({}),

    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Lịch sử của một project, mới nhất trước.
    index("activity_logs_project_created_at_idx").on(table.projectId, table.createdAt.desc()),
    /**
     * Lịch sử theo task, cho `GET /tasks/:taskId/activity` ở M4. Tạo sẵn ở đây
     * vì bảng đang rỗng — dựng index trên bảng rỗng gần như miễn phí, còn dựng
     * nó sau khi có dữ liệu thật là một thao tác khoá bảng.
     */
    index("activity_logs_project_task_created_at_idx").on(
      table.projectId,
      table.taskId,
      table.createdAt.desc(),
    ),
  ],
);

/* ------------------------------------------------------------------------- *
 * M4 — `tasks` và `comments`
 *
 * Bước cuối của thứ tự migration: sau `board_columns` và `project_members`, vì
 * `tasks` trỏ composite foreign key tới cả hai.
 *
 * `activity_logs.task_id` nhận foreign key ở **cùng migration này** bằng
 * `ALTER TABLE ... ADD CONSTRAINT`: M3 cố ý tạo cột nullable không FK vì bảng
 * `tasks` chưa tồn tại, và mọi event của M3 để `task_id` là `NULL` nên không có
 * dữ liệu nào phải backfill.
 * ------------------------------------------------------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),

    /**
     * Không có `.references()` đơn lẻ: khoá thật là **composite**
     * `(project_id, column_id) → board_columns(project_id, id)`, khai ở phần
     * constraint bên dưới. Một FK chỉ trên `column_id` sẽ cho phép task trỏ
     * sang cột của project khác — đúng thứ mà composite key sinh ra để chặn.
     */
    columnId: uuid("column_id").notNull(),

    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Composite FK tới `project_members(project_id, user_id)`; `NULL` là hợp lệ. */
    assigneeId: uuid("assignee_id"),

    /**
     * Reviewer, cũng là ProjectMember cùng project.
     *
     * Chỉ **bắt buộc** khi cột đích có `requires_reviewer = true`, và luôn phải
     * khác assignee. Luật thứ hai database diễn đạt được bằng `CHECK`; luật thứ
     * nhất thì không — nó phụ thuộc một hàng ở bảng khác.
     */
    reviewerId: uuid("reviewer_id"),

    title: text("title").notNull(),

    /** Không có nội dung nghĩa là chuỗi rỗng, **không** phải `NULL`. */
    description: text("description").notNull().default(""),

    category: text("category"),
    priority: text("priority").notNull().default("none"),

    /**
     * Thứ tự fractional trong **một cột**, `numeric(20,10)`.
     *
     * `mode: "string"` vì cùng lý do với `board_columns.position`, và ở đây lý
     * do nặng hơn: một cột có thể chứa hàng nghìn task nên position bò tới dải
     * mà `double` không giữ nổi 10 chữ số thập phân. Xem
     * `shared/ordering/position.ts`.
     */
    position: numeric("position", { precision: 20, scale: 10, mode: "string" }).notNull(),

    /** Optimistic concurrency cho **nội dung** client sửa được, và cho move. */
    version: integer("version").notNull().default(1),

    /** Ngày lịch theo timezone workspace, không có giờ trong ngày. */
    startDate: date("start_date"),
    dueDate: date("due_date"),

    /**
     * Một liên kết bằng chứng, `https` bắt buộc, tối đa 2048 ký tự.
     *
     * **Server không bao giờ fetch URL này** — không preview, không unfurl,
     * không resolve redirect. Fetch biến một field do người dùng nhập thành
     * SSRF vector nhắm vào mạng nội bộ (ADR-0009). Không index: nó không phải
     * filter, không phải sort, không search.
     */
    evidenceUrl: text("evidence_url"),

    createdAt: utc("created_at").notNull().defaultNow(),
    updatedAt: utc("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * `UNIQUE (project_id, column_id, position)` — **`DEFERRABLE INITIALLY
     * IMMEDIATE`**, thêm bằng tay trong migration vì Drizzle không khai được
     * thuộc tính đó. Cùng lý do với `board_columns`: rebalance ghi lại position
     * của N row trong một transaction và trạng thái trung gian được phép trùng.
     */
    unique("tasks_project_column_position_uniq").on(
      table.projectId,
      table.columnId,
      table.position,
    ),

    /** Target cho composite FK của Phase 1.5 (`parent_task_id`) và của sprint. */
    unique("tasks_project_id_uniq").on(table.projectId, table.id),

    /** Task thuộc cột **cùng project** — database cưỡng chế, không phải use case hứa. */
    foreignKey({
      name: "tasks_project_column_fk",
      columns: [table.projectId, table.columnId],
      foreignColumns: [boardColumns.projectId, boardColumns.id],
    }).onDelete("restrict"),

    /** Assignee phải là ProjectMember **cùng project**; `NULL` không bị ràng buộc. */
    foreignKey({
      name: "tasks_project_assignee_fk",
      columns: [table.projectId, table.assigneeId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
    }).onDelete("restrict"),

    foreignKey({
      name: "tasks_project_reviewer_fk",
      columns: [table.projectId, table.reviewerId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
    }).onDelete("restrict"),

    check(
      "tasks_category_check",
      sql`${table.category} is null or ${table.category} in ('feature', 'bug', 'design', 'research', 'operations', 'other')`,
    ),
    check(
      "tasks_priority_check",
      sql`${table.priority} in ('none', 'low', 'medium', 'high', 'urgent')`,
    ),
    check("tasks_version_check", sql`${table.version} > 0`),

    /**
     * `start_date <= due_date` được cưỡng chế ở **cả hai** tầng.
     *
     * Application validation cho ra `400` có field-error đọc được; `CHECK` là
     * lưới cuối cho mọi đường ghi khác — migration, script, một use case tương
     * lai quên kiểm. Hai tầng không thừa: chúng trả lời hai câu hỏi khác nhau.
     */
    check(
      "tasks_date_order_check",
      sql`${table.startDate} is null or ${table.dueDate} is null or ${table.startDate} <= ${table.dueDate}`,
    ),

    /** Reviewer khác assignee — bất biến duy nhất của review mà `CHECK` nói được. */
    check(
      "tasks_reviewer_not_assignee_check",
      sql`${table.reviewerId} is null or ${table.assigneeId} is null or ${table.reviewerId} <> ${table.assigneeId}`,
    ),

    /** Thứ tự mặc định của danh sách task: `created_at DESC, id DESC`. */
    index("tasks_project_created_at_idx").on(
      table.projectId,
      table.createdAt.desc(),
      table.id.desc(),
    ),

    /** Filter/sort theo `dueDate` với tie-breaker cho seek. */
    index("tasks_project_due_date_idx").on(table.projectId, table.dueDate, table.id),

    /** Sort `updatedAt` (nằm trong allowlist), kèm tie-breaker. */
    index("tasks_project_updated_at_idx").on(
      table.projectId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),

    index("tasks_project_assignee_updated_at_idx").on(
      table.projectId,
      table.assigneeId,
      table.updatedAt.desc(),
    ),
    index("tasks_project_created_by_updated_at_idx").on(
      table.projectId,
      table.createdByUserId,
      table.updatedAt.desc(),
    ),
    index("tasks_project_reviewer_updated_at_idx").on(
      table.projectId,
      table.reviewerId,
      table.updatedAt.desc(),
    ),
  ],
);

/**
 * Comment: **bất biến**.
 *
 * Không `updated_at`, không delete marker, không revision. MVP cố ý không có
 * route sửa hay xoá, nên một cột `updated_at` ở đây sẽ là một lời hứa mà không
 * đường code nào giữ.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),

    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /**
     * Plain text **đúng như người dùng gõ**: không normalize, không
     * sanitize-rồi-lưu, không chuyển sang HTML (ADR-0009). Cú pháp Markdown
     * trong body là quy ước trình bày do client render theo allowlist đóng.
     */
    body: text("body").notNull(),

    createdAt: utc("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Danh sách comment của một task, khớp thứ tự và seek `createdAt, id`.
    index("comments_task_created_at_idx").on(table.taskId, table.createdAt, table.id),
  ],
);
