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
 * Chỉ ba bảng đầu tiên của thứ tự migration có mặt ở đây, đúng phạm vi M1:
 * `users`, `auth_sessions`, `idempotency_records`. Các bảng còn lại xuất hiện
 * ở mốc tạo ra chúng, không dựng sẵn.
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
