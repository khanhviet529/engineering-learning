import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  forgotPasswordRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  signInRequestSchema,
  signUpRequestSchema,
  verifyEmailRequestSchema,
} from "@flowboard/contracts";
import type { ZodType } from "zod";
import { AppError, validationError } from "../../../shared/errors/app-error.ts";
import { SESSION_COOKIE_NAME, csrfTokenMatches, deriveCsrfToken } from "../domain/session.ts";
import type { AuthUseCases } from "../application/auth-use-cases.ts";
import type { RateLimiter, RateLimitedRoute } from "../../../shared/http/rate-limit.ts";

/**
 * Controller của module `auth`.
 *
 * Nó biết HTTP và không biết gì khác: mỗi route ánh xạ **một** use case, parse
 * body bằng schema của `@flowboard/contracts`, rồi dịch outcome sang status,
 * header và cookie. Không quy tắc nghiệp vụ nào sống ở đây.
 */

export const AUTH_TOKENS = {
  useCases: Symbol("AuthUseCases"),
  rateLimiter: Symbol("RateLimiter"),
  config: Symbol("AuthConfig"),
} as const;

export interface AuthConfig {
  nodeEnv: string;
  csrfSecret: string;
  cookieSecure: boolean;
  cookieMaxAgeSeconds: number;
}

/** Envelope thành công. `requestId` do middleware đặt vào request. */
function ok<T>(request: FastifyRequest, data: T): { data: T; requestId: string } {
  return { data, requestId: getRequestId(request) };
}

function getRequestId(request: FastifyRequest): string {
  return (request as FastifyRequest & { requestId?: string }).requestId ?? "unknown";
}

/** Parse body theo schema contract; lỗi thành `400` với field-error array. */
function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw validationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      code: issue.code,
      message: issue.message,
    })),
  );
}

/**
 * Tín hiệu định danh dùng cho rate limit.
 *
 * Địa chỉ IP của kết nối, **không** phải header do client gửi: một header như
 * `X-Forwarded-For` mà không có proxy tin cậy phía trước thì client tự chọn
 * được bucket của mình, tức là rate limit thành vô nghĩa.
 */
function clientSignal(request: FastifyRequest): string {
  return request.socket.remoteAddress ?? "unknown";
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_TOKENS.useCases) private readonly useCases: AuthUseCases,
    @Inject(AUTH_TOKENS.rateLimiter) private readonly limiter: RateLimiter,
    @Inject(AUTH_TOKENS.config) private readonly config: AuthConfig,
  ) {}

  #enforceRateLimit(request: FastifyRequest, route: RateLimitedRoute): void {
    const result = this.limiter.consume(route, clientSignal(request));
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", { retryAfterSeconds: result.retryAfterSeconds });
    }
  }

  #setSessionCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
      path: "/",
      maxAge: this.config.cookieMaxAgeSeconds,
    });
  }

  #clearSessionCookie(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  }

  #sessionToken(request: FastifyRequest): string | undefined {
    return request.cookies[SESSION_COOKIE_NAME];
  }

  /**
   * Mọi mutation có session phải mang `X-CSRF-Token` hợp lệ.
   *
   * Token được suy lại từ session token, nên không cần tra database: nếu cookie
   * hợp lệ thì giá trị mong đợi tính được ngay, và kẻ tấn công cross-site không
   * đọc được cookie `HttpOnly` để tính ra nó.
   */
  #requireCsrf(request: FastifyRequest): void {
    const sessionToken = this.#sessionToken(request);
    if (sessionToken === undefined) throw new AppError("UNAUTHENTICATED");

    const received = request.headers["x-csrf-token"];
    const expected = deriveCsrfToken(sessionToken, this.config.csrfSecret);
    if (typeof received !== "string" || !csrfTokenMatches(expected, received)) {
      throw new AppError("FORBIDDEN", { message: "Yêu cầu thiếu hoặc sai CSRF token." });
    }
  }

  @Post("sign-up")
  @HttpCode(201)
  async signUp(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.#enforceRateLimit(request, "auth.sign-up");
    const input = parse(signUpRequestSchema, body);
    const result = await this.useCases.signUp(input);
    return ok(request, {
      account: {
        email: result.email,
        displayName: result.displayName,
        emailVerified: false as const,
      },
      verificationEmailSent: result.verificationEmailSent,
    });
  }

  @Post("email/verify")
  // Nest mặc định POST là `201`; hợp đồng ghi `200` cho route này.
  @HttpCode(200)
  async verifyEmail(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parse(verifyEmailRequestSchema, body);
    await this.useCases.verifyEmail(input);
    return ok(request, { emailVerified: true as const });
  }

  @Post("email/verification/resend")
  @HttpCode(202)
  async resendVerification(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.#enforceRateLimit(request, "auth.email.resend");
    const input = parse(resendVerificationRequestSchema, body);
    await this.useCases.resendVerification(input);
    // Luôn `accepted`, dù account có tồn tại hay không.
    return ok(request, { accepted: true as const });
  }

  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    this.#enforceRateLimit(request, "auth.sign-in");
    const input = parse(signInRequestSchema, body);
    const result = await this.useCases.signIn(input);

    this.#setSessionCookie(reply, result.sessionToken);

    // Session ID thô **chỉ** nằm trong cookie; nó không bao giờ vào JSON.
    return ok(request, {
      actor: {
        id: result.userId,
        displayName: result.displayName,
        email: result.email,
        emailVerified: true,
      },
      csrfToken: result.csrfToken,
    });
  }

  @Get("session")
  async session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const sessionToken = this.#sessionToken(request);
    if (sessionToken === undefined) throw new AppError("UNAUTHENTICATED");

    const actor = await this.useCases.resolveSession(sessionToken);
    if (actor === undefined) {
      // Cookie cũ không còn giá trị: xoá để trình duyệt thôi gửi nó.
      this.#clearSessionCookie(reply);
      throw new AppError("UNAUTHENTICATED");
    }

    return ok(request, {
      actor,
      csrfToken: deriveCsrfToken(sessionToken, this.config.csrfSecret),
    });
  }

  @Post("sign-out")
  @HttpCode(204)
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.#requireCsrf(request);
    await this.useCases.signOut(this.#sessionToken(request));
    this.#clearSessionCookie(reply);
  }

  @Post("password/forgot")
  @HttpCode(202)
  async forgotPassword(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.#enforceRateLimit(request, "auth.password.forgot");
    const input = parse(forgotPasswordRequestSchema, body);
    await this.useCases.forgotPassword(input);
    return ok(request, { accepted: true as const });
  }

  @Post("password/reset")
  @HttpCode(200)
  async resetPassword(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.#enforceRateLimit(request, "auth.password.reset");
    const input = parse(resetPasswordRequestSchema, body);
    await this.useCases.resetPassword(input);
    return ok(request, { passwordReset: true as const, signInRequired: true as const });
  }
}
