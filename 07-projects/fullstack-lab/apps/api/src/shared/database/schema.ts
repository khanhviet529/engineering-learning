import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
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
