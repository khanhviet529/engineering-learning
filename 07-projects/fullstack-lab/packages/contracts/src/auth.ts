import { z } from "zod";
import { instantSchema, uuidSchema } from "./fields.js";

/**
 * Hợp đồng của các use case xác thực — `docs/api/endpoint-contracts.md` mục
 * Authentication, và `docs/security/authentication.md`.
 *
 * Ba điều dễ làm sai, nên nói rõ ở đây:
 *
 * 1. **Không có schema nào chứa raw session ID hay CSRF secret.** Session đi
 *    trong cookie `HttpOnly`; server chỉ lưu hash của nó.
 * 2. **Không endpoint nào trả raw token** của verification hay reset. Chúng chỉ
 *    tồn tại trong email.
 * 3. **Các endpoint có thể lộ sự tồn tại của account đều trả cùng một body
 *    generic** dù account có tồn tại hay không. Đó là lý do `resend` và
 *    `forgot` cùng trả `{ accepted: true }`.
 */

/**
 * Password 12–200 ký tự, **không có yêu cầu composition** nào — theo ADR-0007,
 * bám NIST SP 800-63B. Mọi ký tự in được đều hợp lệ, gồm cả space và ký tự
 * ngoài ASCII.
 *
 * Giá trị được normalize NFKC **giống nhau** ở sign-up, reset và sign-in, và
 * không bao giờ bị truncate trước khi hash — nếu hai đầu normalize khác nhau
 * thì password chứa ký tự dựng sẵn sẽ đăng nhập được lúc này và không được lúc
 * khác.
 *
 * Blocklist và quy tắc không-chứa-email/tên là **quyết định của server**;
 * client chỉ kiểm được độ dài và quy tắc không-chứa, rồi hiển thị kết quả
 * blocklist dưới dạng field error sau khi submit.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export const passwordSchema = z
  .string()
  .transform((value) => value.normalize("NFKC"))
  .pipe(z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH));

/** Email được normalize về dạng canonical trước khi so khớp hay lưu. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .transform((value) => value.normalize("NFKC"));

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.normalize("NFKC"));

/** Token một lần của verification và reset: opaque với client, chỉ để gửi lại. */
export const oneTimeTokenSchema = z.string().min(1).max(512);

// ---------------------------------------------------------------- sign-up

export const signUpRequestSchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
  })
  .strict();

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const signUpResponseSchema = z
  .object({
    account: z
      .object({
        email: z.email(),
        displayName: z.string().min(1),
        emailVerified: z.literal(false),
      })
      .strict(),
    verificationEmailSent: z.boolean(),
  })
  .strict();

export type SignUpResponse = z.infer<typeof signUpResponseSchema>;

// ------------------------------------------------------- email verification

export const verifyEmailRequestSchema = z.object({ token: oneTimeTokenSchema }).strict();
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const verifyEmailResponseSchema = z.object({ emailVerified: z.literal(true) }).strict();
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;

export const resendVerificationRequestSchema = z.object({ email: emailSchema }).strict();
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/**
 * Body generic dùng chung cho `resend` và `password/forgot`.
 *
 * Nó **luôn** như nhau dù account có tồn tại hay không: đây là ranh giới chống
 * enumeration, không phải sự lười đặc tả.
 */
export const acceptedResponseSchema = z.object({ accepted: z.literal(true) }).strict();
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;

// ---------------------------------------------------------------- sign-in

export const signInRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().transform((value) => value.normalize("NFKC")),
  })
  .strict();

export type SignInRequest = z.infer<typeof signInRequestSchema>;

/**
 * Actor projection an toàn. Không có role claim ở đây: quyền luôn được hỏi theo
 * từng resource qua capability, chứ không suy từ một nhãn mang trong session.
 */
export const actorSchema = z
  .object({
    id: uuidSchema,
    displayName: z.string().min(1),
    email: z.email(),
    emailVerified: z.boolean(),
  })
  .strict();

export type Actor = z.infer<typeof actorSchema>;

export const sessionResponseSchema = z
  .object({
    actor: actorSchema,
    csrfToken: z.string().min(1),
  })
  .strict();

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// --------------------------------------------------------------- password

export const forgotPasswordRequestSchema = z.object({ email: emailSchema }).strict();
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z
  .object({
    token: oneTimeTokenSchema,
    newPassword: passwordSchema,
  })
  .strict();

export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * Reset thay hash và revoke **mọi** session đang hoạt động trong cùng một
 * transaction, nên client buộc phải đăng nhập lại — `signInRequired` nói đúng
 * điều đó chứ không phải một gợi ý UI.
 */
export const resetPasswordResponseSchema = z
  .object({
    passwordReset: z.literal(true),
    signInRequired: z.literal(true),
  })
  .strict();

export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;

/** Metadata của session, dùng cho chẩn đoán; không chứa token nào. */
export const sessionMetadataSchema = z
  .object({
    createdAt: instantSchema,
    expiresAt: instantSchema,
  })
  .strict();

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
