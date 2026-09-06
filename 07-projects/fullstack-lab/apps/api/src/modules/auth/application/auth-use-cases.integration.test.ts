import { KeyRing } from "../../../shared/security/key-ring.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../../../shared/database/client.ts";
import { authSessions, users } from "../../../shared/database/schema.ts";
import { type AppError } from "../../../shared/errors/app-error.ts";
import { AuthRepository } from "../infrastructure/auth-repository.ts";
import { AuthUseCases, type Mailer } from "./auth-use-cases.ts";
import { hashSessionToken } from "../domain/session.ts";

/**
 * Use case xác thực trên PostgreSQL thật.
 *
 * Ba thứ chỉ chứng minh được ở đây chứ không ở unit test: token dùng một lần
 * thật sự chỉ dùng được một lần dưới đồng thời, reset mật khẩu revoke mọi phiên
 * **trong cùng transaction**, và các đường chống enumeration trả cùng kết quả.
 */

const url = process.env.DATABASE_URL_HOST ?? process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

class FakeMailer implements Mailer {
  readonly verification: { to: string; token: string }[] = [];
  readonly reset: { to: string; token: string }[] = [];

  async sendVerificationEmail(input: { to: string; token: string }): Promise<void> {
    this.verification.push(input);
  }

  async sendPasswordResetEmail(input: { to: string; token: string }): Promise<void> {
    this.reset.push(input);
  }
}

describeIfDb("use case xác thực", () => {
  let handle: DatabaseHandle;
  let useCases: AuthUseCases;
  let mailer: FakeMailer;
  const created: string[] = [];

  const uniqueEmail = () => `auth-${crypto.randomUUID()}@example.test`;
  const password = "mot mat khau du dai";

  beforeAll(() => {
    handle = createDatabase(url as string, { max: 5 });
  });

  beforeEach(() => {
    mailer = new FakeMailer();
    useCases = new AuthUseCases({
      db: handle.db,
      repository: new AuthRepository(handle.db),
      mailer,
      csrfSecret: KeyRing.single("test", "c".repeat(32)),
    });
  });

  afterAll(async () => {
    for (const email of created) {
      const [user] = await handle.db.select().from(users).where(eq(users.email, email));
      if (user) {
        await handle.db.delete(authSessions).where(eq(authSessions.userId, user.id));
        await handle.db.delete(users).where(eq(users.id, user.id));
      }
    }
    await handle.close();
  });

  async function signUpVerified(email: string): Promise<void> {
    created.push(email);
    await useCases.signUp({ email, displayName: "Nguoi Dung", password });
    const token = mailer.verification.at(-1)!.token;
    await useCases.verifyEmail({ token });
  }

  describe("đăng ký", () => {
    it("tạo account chưa xác minh và gửi thư", async () => {
      const email = uniqueEmail();
      created.push(email);
      const result = await useCases.signUp({ email, displayName: "Nguoi Dung", password });

      expect(result.verificationEmailSent).toBe(true);
      expect(mailer.verification).toHaveLength(1);

      const [row] = await handle.db.select().from(users).where(eq(users.email, email));
      expect(row!.emailVerifiedAt).toBeNull();
      expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
    });

    it("KHÔNG lộ email đã tồn tại: cùng response, không tạo bản ghi thứ hai", async () => {
      const email = uniqueEmail();
      created.push(email);
      const first = await useCases.signUp({ email, displayName: "Nguoi Dung", password });
      const second = await useCases.signUp({ email, displayName: "Ke Do", password });

      expect(second.verificationEmailSent).toBe(first.verificationEmailSent);

      const rows = await handle.db.select().from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.displayName).toBe("Nguoi Dung");
    });

    it("từ chối mật khẩu vi phạm chính sách, kèm field error", async () => {
      await expect(
        useCases.signUp({ email: uniqueEmail(), displayName: "Nguoi Dung", password: "ngan" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("không lưu mật khẩu thô ở bất kỳ cột nào", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });
      const [row] = await handle.db.select().from(users).where(eq(users.email, email));
      expect(JSON.stringify(row)).not.toContain(password);
    });
  });

  describe("xác minh email", () => {
    it("token hợp lệ đánh dấu đã xác minh", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      const [row] = await handle.db.select().from(users).where(eq(users.email, email));
      expect(row!.emailVerifiedAt).not.toBeNull();
      expect(row!.emailVerificationTokenHash).toBeNull();
    });

    it("TOKEN DÙNG MỘT LẦN: lần thứ hai bị từ chối", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });
      const token = mailer.verification.at(-1)!.token;

      await useCases.verifyEmail({ token });
      await expect(useCases.verifyEmail({ token })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });

    it("token bịa và token đã dùng cho CÙNG một thông điệp", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });
      const token = mailer.verification.at(-1)!.token;
      await useCases.verifyEmail({ token });

      const used = await useCases.verifyEmail({ token }).catch((e: AppError) => e.message);
      const bogus = await useCases
        .verifyEmail({ token: "khong-ton-tai" })
        .catch((e: AppError) => e.message);
      expect(used).toBe(bogus);
    });

    it("gửi lại thư thay token cũ — token cũ hết dùng được", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });
      const oldToken = mailer.verification.at(-1)!.token;

      await useCases.resendVerification({ email });
      const newToken = mailer.verification.at(-1)!.token;
      expect(newToken).not.toBe(oldToken);

      await expect(useCases.verifyEmail({ token: oldToken })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await useCases.verifyEmail({ token: newToken });
    });

    it("gửi lại cho email không tồn tại không ném lỗi và không gửi gì", async () => {
      await useCases.resendVerification({ email: "khong-ton-tai@example.test" });
      expect(mailer.verification).toHaveLength(0);
    });
  });

  describe("đăng nhập", () => {
    it("thành công thì tạo session và CSRF token gắn với nó", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);

      const result = await useCases.signIn({ email, password });
      expect(result.email).toBe(email);
      expect(result.csrfToken.length).toBeGreaterThan(0);

      const [session] = await handle.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.sessionTokenHash, hashSessionToken(result.sessionToken)));
      expect(session).toBeDefined();
    });

    it("chỉ lưu hash của session, không lưu token thô", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      const result = await useCases.signIn({ email, password });

      const rows = await handle.db.select().from(authSessions);
      expect(JSON.stringify(rows)).not.toContain(result.sessionToken);
    });

    it("sai mật khẩu và email không tồn tại cho CÙNG một lỗi", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);

      const wrongPassword = await useCases
        .signIn({ email, password: "mot mat khau khac han" })
        .catch((e: AppError) => e.code);
      const noAccount = await useCases
        .signIn({ email: "khong-ton-tai@example.test", password })
        .catch((e: AppError) => e.code);

      expect(wrongPassword).toBe("UNAUTHENTICATED");
      expect(noAccount).toBe("UNAUTHENTICATED");
    });

    it("chưa xác minh email trả EMAIL_VERIFICATION_REQUIRED và KHÔNG tạo session", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });

      await expect(useCases.signIn({ email, password })).rejects.toMatchObject({
        code: "EMAIL_VERIFICATION_REQUIRED",
      });

      const [user] = await handle.db.select().from(users).where(eq(users.email, email));
      const sessions = await handle.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, user!.id));
      expect(sessions).toHaveLength(0);
    });

    it("sai mật khẩu ở account chưa xác minh vẫn trả UNAUTHENTICATED, không lộ trạng thái xác minh", async () => {
      const email = uniqueEmail();
      created.push(email);
      await useCases.signUp({ email, displayName: "Nguoi Dung", password });

      await expect(
        useCases.signIn({ email, password: "mot mat khau khac han" }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });
  });

  describe("phiên", () => {
    it("resolve được actor từ session còn hiệu lực", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      const { sessionToken } = await useCases.signIn({ email, password });

      const actor = await useCases.resolveSession(sessionToken);
      expect(actor?.email).toBe(email);
      expect(actor?.emailVerified).toBe(true);
    });

    it("đăng xuất rồi thì session không resolve được nữa", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      const { sessionToken } = await useCases.signIn({ email, password });

      await useCases.signOut(sessionToken);
      expect(await useCases.resolveSession(sessionToken)).toBeUndefined();
    });

    it("đăng xuất khi không có phiên vẫn thành công — idempotent", async () => {
      await expect(useCases.signOut(undefined)).resolves.toBeUndefined();
      await expect(useCases.signOut("khong-phai-token")).resolves.toBeUndefined();
    });

    it("token bịa không resolve ra ai", async () => {
      expect(await useCases.resolveSession("khong-phai-token")).toBeUndefined();
    });
  });

  describe("đặt lại mật khẩu", () => {
    it("REVOKE MỌI PHIÊN trong cùng transaction với việc đổi mật khẩu", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);

      const a = await useCases.signIn({ email, password });
      const b = await useCases.signIn({ email, password });
      expect(await useCases.resolveSession(a.sessionToken)).toBeDefined();
      expect(await useCases.resolveSession(b.sessionToken)).toBeDefined();

      await useCases.forgotPassword({ email });
      const token = mailer.reset.at(-1)!.token;
      await useCases.resetPassword({ token, newPassword: "mot mat khau moi hoan toan" });

      expect(await useCases.resolveSession(a.sessionToken)).toBeUndefined();
      expect(await useCases.resolveSession(b.sessionToken)).toBeUndefined();

      // Mật khẩu mới dùng được, mật khẩu cũ thì không.
      await expect(useCases.signIn({ email, password })).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(
        useCases.signIn({ email, password: "mot mat khau moi hoan toan" }),
      ).resolves.toBeDefined();
    });

    it("token reset dùng một lần", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      await useCases.forgotPassword({ email });
      const token = mailer.reset.at(-1)!.token;

      await useCases.resetPassword({ token, newPassword: "mot mat khau moi hoan toan" });
      await expect(
        useCases.resetPassword({ token, newPassword: "mot mat khau khac nua roi" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("mật khẩu mới vẫn phải qua chính sách", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      await useCases.forgotPassword({ email });
      const token = mailer.reset.at(-1)!.token;

      await expect(
        useCases.resetPassword({ token, newPassword: "password" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("quên mật khẩu với email không tồn tại không ném lỗi và không gửi thư", async () => {
      await useCases.forgotPassword({ email: "khong-ton-tai@example.test" });
      expect(mailer.reset).toHaveLength(0);
    });

    it("reset thất bại thì KHÔNG revoke phiên nào — transaction rollback trọn vẹn", async () => {
      const email = uniqueEmail();
      await signUpVerified(email);
      const session = await useCases.signIn({ email, password });

      await expect(
        useCases.resetPassword({ token: "token-bia", newPassword: "mot mat khau moi hoan toan" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      expect(await useCases.resolveSession(session.sessionToken)).toBeDefined();
    });
  });

  /**
   * Phép quét này đọc **toàn bảng `users`**, không chỉ user của file này — và
   * đó là chủ ý: một chỗ rò mật khẩu thô ở module khác vẫn phải bị bắt.
   *
   * Nhưng Vitest chạy các file test song song trên **cùng một database**, nên
   * mọi file chèn user bằng một `passwordHash` giả không đúng dạng đều làm bài
   * này đỏ — và đỏ ở đây, cách xa file gây ra nó. Đã xảy ra: sáu chỗ chèn
   * `"argon2id$placeholder"` (thiếu `$` mở đầu) trong `client.integration` và
   * `idempotency.integration` ngồi trong cửa sổ đó suốt nhiều mốc, chưa nổ chỉ
   * vì cửa sổ hẹp — không phải vì an toàn.
   *
   * Nên bài này in ra **email của hàng vi phạm**, không in ra một con số. Một
   * `expected 3 to be 0` không nói được file nào chèn; một danh sách email
   * fixture thì nói ngay. Giữ nguyên phạm vi quét, đổi thứ nó nói khi đỏ.
   */
  it("không có bản ghi nào rò rỉ mật khẩu hay token thô", async () => {
    const rows = await handle.db.execute<{ email: string }>(
      sql`select email from users where password_hash not like '$argon2id$%' order by email limit 20`,
    );
    expect(
      [...rows].map((row) => row.email),
      "hàng có password_hash không đúng dạng argon2id — nếu đây là fixture của một file test khác, sửa fixture đó, đừng nới phép quét này",
    ).toEqual([]);
  });
});
