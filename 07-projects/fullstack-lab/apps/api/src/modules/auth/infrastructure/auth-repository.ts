import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { authSessions, users } from "../../../shared/database/schema.ts";

/**
 * Repository của module `auth`.
 *
 * Đây là **nơi duy nhất** trong module chạm tới Drizzle. Method diễn đạt đúng
 * query mà use case cần, chứ không phải một lớp bọc chung quanh bảng: một
 * `findAll` hay `updateById` tổng quát sẽ mời gọi use case tự ghép điều kiện,
 * và điều kiện ghép ở tầng use case là chỗ phạm vi dữ liệu bị rò.
 */

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: Date | null;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: Date | null;
}

type Executor = Database | Transaction;

export class AuthRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Email đã canonical trước khi tới đây; repository không tự chuẩn hoá lại. */
  async findByEmail(email: string, tx?: Executor): Promise<UserRecord | undefined> {
    const [row] = await (tx ?? this.#db).select().from(users).where(eq(users.email, email));
    return row;
  }

  async findById(id: string, tx?: Executor): Promise<UserRecord | undefined> {
    const [row] = await (tx ?? this.#db).select().from(users).where(eq(users.id, id));
    return row;
  }

  async findByVerificationTokenHash(hash: string, tx?: Executor): Promise<UserRecord | undefined> {
    const [row] = await (tx ?? this.#db)
      .select()
      .from(users)
      .where(eq(users.emailVerificationTokenHash, hash));
    return row;
  }

  async findByResetTokenHash(hash: string, tx?: Executor): Promise<UserRecord | undefined> {
    const [row] = await (tx ?? this.#db)
      .select()
      .from(users)
      .where(eq(users.passwordResetTokenHash, hash));
    return row;
  }

  async createUser(
    input: {
      email: string;
      displayName: string;
      passwordHash: string;
      emailVerificationTokenHash: string;
      emailVerificationExpiresAt: Date;
    },
    tx?: Executor,
  ): Promise<UserRecord> {
    const [row] = await (tx ?? this.#db).insert(users).values(input).returning();
    return row as UserRecord;
  }

  /**
   * Thay token xác minh hiện hành.
   *
   * Ghi đè chứ không thêm dòng: mỗi account chỉ có **một** token còn hiệu lực,
   * nên cấp token mới tự động vô hiệu hoá token cũ mà không cần bước dọn riêng.
   */
  async replaceVerificationToken(
    userId: string,
    hash: string,
    expiresAt: Date,
    tx?: Executor,
  ): Promise<void> {
    await (tx ?? this.#db)
      .update(users)
      .set({
        emailVerificationTokenHash: hash,
        emailVerificationExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  /**
   * Đánh dấu email đã xác minh và **tiêu thụ** token trong cùng một câu lệnh.
   *
   * Điều kiện `emailVerificationTokenHash = hash` nằm trong `WHERE`, nên hai
   * request cùng token không thể cùng thành công: câu lệnh thứ hai cập nhật 0
   * dòng. Đây là lý do hàm trả về số dòng đã đổi thay vì `void`.
   */
  async consumeVerificationToken(hash: string, now: Date, tx?: Executor): Promise<boolean> {
    const rows = await (tx ?? this.#db)
      .update(users)
      .set({
        emailVerifiedAt: now,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(users.emailVerificationTokenHash, hash))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async replaceResetToken(
    userId: string,
    hash: string,
    expiresAt: Date,
    tx?: Executor,
  ): Promise<void> {
    await (tx ?? this.#db)
      .update(users)
      .set({
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  /** Tiêu thụ token reset và đổi hash mật khẩu; cùng lý do trả boolean như trên. */
  async consumeResetTokenAndSetPassword(
    hash: string,
    passwordHash: string,
    now: Date,
    tx?: Executor,
  ): Promise<string | undefined> {
    const rows = await (tx ?? this.#db)
      .update(users)
      .set({
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(users.passwordResetTokenHash, hash))
      .returning({ id: users.id });
    return rows[0]?.id;
  }

  async createSession(
    input: { userId: string; sessionTokenHash: string; expiresAt: Date },
    tx?: Executor,
  ): Promise<void> {
    await (tx ?? this.#db).insert(authSessions).values(input);
  }

  /** Chỉ trả session **còn dùng được**: chưa revoke và chưa hết hạn. */
  async findUsableSession(
    sessionTokenHash: string,
    now: Date,
    tx?: Executor,
  ): Promise<{ userId: string } | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ userId: authSessions.userId })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.sessionTokenHash, sessionTokenHash),
          isNull(authSessions.revokedAt),
          // `gt` thay vì `sql` thô: một `Date` trong template không được gắn kiểu
          // timestamptz, và driver từ chối nó ngay lúc bind tham số.
          gt(authSessions.expiresAt, now),
        ),
      );
    return row;
  }

  async revokeSession(
    sessionTokenHash: string,
    reason: string,
    now: Date,
    tx?: Executor,
  ): Promise<void> {
    await (tx ?? this.#db)
      .update(authSessions)
      .set({ revokedAt: now, revocationReason: reason, updatedAt: now })
      .where(
        and(eq(authSessions.sessionTokenHash, sessionTokenHash), isNull(authSessions.revokedAt)),
      );
  }

  /**
   * Revoke **mọi** session đang hoạt động của một user.
   *
   * Dùng khi reset mật khẩu. Phải chạy trong cùng transaction với việc đổi hash,
   * nếu không sẽ có một cửa sổ mà mật khẩu đã đổi nhưng phiên cũ vẫn dùng được.
   */
  async revokeAllSessions(
    userId: string,
    reason: string,
    now: Date,
    tx?: Executor,
  ): Promise<number> {
    const rows = await (tx ?? this.#db)
      .update(authSessions)
      .set({ revokedAt: now, revocationReason: reason, updatedAt: now })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return rows.length;
  }
}
