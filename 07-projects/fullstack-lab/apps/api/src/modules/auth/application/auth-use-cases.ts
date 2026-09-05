import type { KeyRing } from "../../../shared/security/key-ring.ts";
import type { FieldError } from "@flowboard/contracts";
import { AppError, validationError } from "../../../shared/errors/app-error.ts";
import type { Database } from "../../../shared/database/client.ts";
import { type AuthRepository } from "../infrastructure/auth-repository.ts";
import {
  evaluatePassword,
  hashPassword,
  verifyPassword,
  type PasswordRejection,
} from "../domain/password.ts";
import { deriveCsrfToken } from "../../../shared/http/csrf.ts";
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  generateOneTimeToken,
  generateSessionToken,
  hashOneTimeToken,
  hashSessionToken,
  sessionExpiry,
} from "../domain/session.ts";

/**
 * Use case của module `auth`.
 *
 * Use case điều phối: authorize, validate, mở transaction, gọi repository, và
 * quyết định outcome. Nó **không** biết HTTP — không status, không header,
 * không cookie. Việc dịch outcome sang HTTP là của tầng presentation, và giữ
 * ranh giới đó là lý do các use case này test được mà không cần dựng server.
 */

/**
 * Cổng gửi mail nay ở `shared/mail/mailer.port.ts`.
 *
 * Nó chuyển đi khi module `workspaces` cần gửi thư mời: đồ thị phụ thuộc của
 * ADR-0005 không có cạnh `workspaces → auth`, nên để port ở đây buộc phải tạo
 * một cạnh ngoài đồ thị đã duyệt. Re-export để chỗ gọi cũ không phải đổi import
 * — nhưng **định nghĩa** chỉ có một, ở shared.
 */
import type { Mailer } from "../../../shared/mail/mailer.port.ts";
export type { Mailer };

export interface AuthDeps {
  db: Database;
  repository: AuthRepository;
  mailer: Mailer;
  csrfSecret: KeyRing;
  now?: () => Date;
}

/** Chuyển lý do từ chối mật khẩu thành field error an toàn. */
function passwordFieldErrors(rejections: PasswordRejection[], field: string): FieldError[] {
  return rejections.map((rejection) => {
    switch (rejection.kind) {
      case "too_short":
        return { field, code: "too_short", message: "Mật khẩu phải có ít nhất 12 ký tự." };
      case "too_long":
        return { field, code: "too_long", message: "Mật khẩu tối đa 200 ký tự." };
      case "contains_identity":
        return {
          field,
          code: "contains_identity",
          message: "Mật khẩu không được chứa email hoặc tên hiển thị của bạn.",
        };
      case "blocked":
        // Cố ý **không** nói đã khớp danh sách nào: đó là thông tin về nội dung
        // danh sách, không phải thông tin giúp người dùng chọn mật khẩu tốt hơn.
        return {
          field,
          code: "blocked",
          message: "Mật khẩu này quá phổ biến. Hãy chọn một mật khẩu khác.",
        };
    }
  });
}

export class AuthUseCases {
  readonly #deps: AuthDeps;

  constructor(deps: AuthDeps) {
    this.#deps = deps;
  }

  get #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /**
   * Đăng ký.
   *
   * Email trùng **không** trả lỗi riêng: làm vậy là biến endpoint đăng ký thành
   * một máy dò tài khoản. Thay vào đó nó trả đúng response như trường hợp thành
   * công, còn thư gửi đi là thư "email này đã có tài khoản" — người sở hữu hộp
   * thư biết chuyện gì xảy ra, người dò thì không.
   */
  async signUp(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<{ email: string; displayName: string; verificationEmailSent: boolean }> {
    const rejections = evaluatePassword(input.password, {
      email: input.email,
      displayName: input.displayName,
    });
    if (rejections.length > 0) {
      throw validationError(passwordFieldErrors(rejections, "password"));
    }

    const now = this.#now;
    const existing = await this.#deps.repository.findByEmail(input.email);

    if (existing !== undefined) {
      // Không tạo gì, không lộ gì. Response giống hệt nhánh thành công.
      return {
        email: input.email,
        displayName: input.displayName,
        verificationEmailSent: true,
      };
    }

    const token = generateOneTimeToken();
    const passwordHash = await hashPassword(input.password);

    await this.#deps.repository.createUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      emailVerificationTokenHash: hashOneTimeToken(token),
      emailVerificationExpiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    });

    await this.#deps.mailer.sendVerificationEmail({ to: input.email, token });

    return { email: input.email, displayName: input.displayName, verificationEmailSent: true };
  }

  /**
   * Xác minh email.
   *
   * Token sai, hết hạn hoặc dùng lại đều trả **cùng một** lỗi validation an
   * toàn: phân biệt chúng cho kẻ tấn công biết token nào từng tồn tại.
   */
  async verifyEmail(input: { token: string }): Promise<void> {
    const now = this.#now;
    const hash = hashOneTimeToken(input.token);

    const user = await this.#deps.repository.findByVerificationTokenHash(hash);
    const expired =
      user?.emailVerificationExpiresAt !== null &&
      user !== undefined &&
      user.emailVerificationExpiresAt.getTime() <= now.getTime();

    if (user === undefined || expired) {
      throw validationError([
        {
          field: "token",
          code: "invalid",
          message: "Liên kết xác minh không hợp lệ hoặc đã hết hạn.",
        },
      ]);
    }

    const consumed = await this.#deps.repository.consumeVerificationToken(hash, now);
    if (!consumed) {
      // Thua cuộc đua với một request khác dùng cùng token: cùng lỗi an toàn.
      throw validationError([
        {
          field: "token",
          code: "invalid",
          message: "Liên kết xác minh không hợp lệ hoặc đã hết hạn.",
        },
      ]);
    }
  }

  /** Gửi lại thư xác minh. Luôn trả `accepted`, dù account có tồn tại hay không. */
  async resendVerification(input: { email: string }): Promise<void> {
    const user = await this.#deps.repository.findByEmail(input.email);
    if (user === undefined || user.emailVerifiedAt !== null) return;

    const now = this.#now;
    const token = generateOneTimeToken();
    await this.#deps.repository.replaceVerificationToken(
      user.id,
      hashOneTimeToken(token),
      new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    );
    await this.#deps.mailer.sendVerificationEmail({ to: user.email, token });
  }

  /**
   * Đăng nhập.
   *
   * Thứ tự kiểm quan trọng: xác thực credential **trước**, rồi mới kiểm email đã
   * xác minh. Kiểm ngược lại sẽ khiến `403 EMAIL_VERIFICATION_REQUIRED` trở
   * thành lời xác nhận rằng email đó có tài khoản.
   */
  async signIn(input: { email: string; password: string }): Promise<{
    userId: string;
    displayName: string;
    email: string;
    sessionToken: string;
    csrfToken: string;
  }> {
    const user = await this.#deps.repository.findByEmail(input.email);

    // So sánh mật khẩu ngay cả khi không có user, để thời gian phản hồi của hai
    // nhánh không lệch nhau một cách đo được.
    const passwordOk =
      user === undefined
        ? await verifyPassword(DUMMY_HASH, input.password)
        : await verifyPassword(user.passwordHash, input.password);

    if (user === undefined || !passwordOk) {
      throw new AppError("UNAUTHENTICATED");
    }

    if (user.emailVerifiedAt === null) {
      throw new AppError("EMAIL_VERIFICATION_REQUIRED");
    }

    const now = this.#now;
    const sessionToken = generateSessionToken();
    await this.#deps.repository.createSession({
      userId: user.id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: sessionExpiry(now),
    });

    return {
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      sessionToken,
      // Ký bằng **key hiện hành**: token mới luôn thuộc thế hệ mới, và cửa
      // sổ xoay chỉ nới phía verify.
      csrfToken: deriveCsrfToken(sessionToken, this.#deps.csrfSecret.signingKey),
    };
  }

  /** Đọc actor của một session. Trả `undefined` khi session không dùng được. */
  async resolveSession(
    sessionToken: string,
  ): Promise<
    { id: string; email: string; displayName: string; emailVerified: boolean } | undefined
  > {
    const session = await this.#deps.repository.findUsableSession(
      hashSessionToken(sessionToken),
      this.#now,
    );
    if (session === undefined) return undefined;

    const user = await this.#deps.repository.findById(session.userId);
    if (user === undefined) return undefined;

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }

  /** Đăng xuất. Nguyên tắc idempotent: gọi khi không có phiên vẫn là thành công. */
  async signOut(sessionToken: string | undefined): Promise<void> {
    if (sessionToken === undefined) return;
    await this.#deps.repository.revokeSession(
      hashSessionToken(sessionToken),
      "sign_out",
      this.#now,
    );
  }

  /** Quên mật khẩu. Luôn trả `accepted`, kể cả với email không tồn tại. */
  async forgotPassword(input: { email: string }): Promise<void> {
    const user = await this.#deps.repository.findByEmail(input.email);
    if (user === undefined) return;

    const now = this.#now;
    const token = generateOneTimeToken();
    await this.#deps.repository.replaceResetToken(
      user.id,
      hashOneTimeToken(token),
      new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    );
    await this.#deps.mailer.sendPasswordResetEmail({ to: user.email, token });
  }

  /**
   * Đặt lại mật khẩu.
   *
   * Đổi hash và revoke **mọi** phiên đang mở nằm trong **cùng một transaction**.
   * Tách ra hai bước sẽ để lại một cửa sổ mà mật khẩu đã đổi nhưng phiên cũ vẫn
   * dùng được — đúng tình huống mà người dùng đang reset mật khẩu để chấm dứt.
   */
  async resetPassword(input: { token: string; newPassword: string }): Promise<void> {
    const now = this.#now;
    const hash = hashOneTimeToken(input.token);

    const user = await this.#deps.repository.findByResetTokenHash(hash);
    const expired =
      user !== undefined &&
      user.passwordResetExpiresAt !== null &&
      user.passwordResetExpiresAt.getTime() <= now.getTime();

    if (user === undefined || expired) {
      throw validationError([
        {
          field: "token",
          code: "invalid",
          message: "Liên kết đặt lại không hợp lệ hoặc đã hết hạn.",
        },
      ]);
    }

    const rejections = evaluatePassword(input.newPassword, {
      email: user.email,
      displayName: user.displayName,
    });
    if (rejections.length > 0) {
      throw validationError(passwordFieldErrors(rejections, "newPassword"));
    }

    const passwordHash = await hashPassword(input.newPassword);

    await this.#deps.db.transaction(async (tx) => {
      const userId = await this.#deps.repository.consumeResetTokenAndSetPassword(
        hash,
        passwordHash,
        now,
        tx,
      );
      if (userId === undefined) {
        // Token bị tiêu thụ bởi một request khác giữa hai bước.
        throw validationError([
          {
            field: "token",
            code: "invalid",
            message: "Liên kết đặt lại không hợp lệ hoặc đã hết hạn.",
          },
        ]);
      }
      await this.#deps.repository.revokeAllSessions(userId, "password_reset", now, tx);
    });
  }
}

/**
 * Hash giả dùng khi email không tồn tại, để nhánh "không có user" tốn thời gian
 * tương đương nhánh "có user nhưng sai mật khẩu".
 *
 * Không có nó, thời gian phản hồi trở thành một máy dò tài khoản.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9v";
