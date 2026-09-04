import { Transport, type ApiResult, type Intent } from "./transport.ts";

/**
 * Client gọi API xác thực.
 *
 * Mỗi hàm ứng với **một** endpoint trong hợp đồng. Không hàm nào tự quyết định
 * việc gì ngoài việc dịch tham số thành request — quyền, validation và
 * concurrency đều là quyết định của server.
 */

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const transport = new Transport({ baseUrl });

export interface Actor {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
}

export function signUp(
  input: { email: string; displayName: string; password: string },
  intent: Intent,
): Promise<ApiResult<{ account: Actor; verificationEmailSent: boolean }>> {
  return transport.request("/auth/sign-up", { method: "POST", body: input, intent });
}

export function verifyEmail(token: string): Promise<ApiResult<{ emailVerified: true }>> {
  return transport.request("/auth/email/verify", { method: "POST", body: { token } });
}

export function resendVerification(
  email: string,
  intent: Intent,
): Promise<ApiResult<{ accepted: true }>> {
  return transport.request("/auth/email/verification/resend", {
    method: "POST",
    body: { email },
    intent,
  });
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<ApiResult<{ actor: Actor; csrfToken: string }>> {
  const result = await transport.request<{ actor: Actor; csrfToken: string }>("/auth/sign-in", {
    method: "POST",
    body: input,
  });
  // CSRF token gắn với phiên vừa tạo; giữ lại ngay để mutation kế tiếp dùng được.
  if (result.ok) transport.setCsrfToken(result.data.csrfToken);
  return result;
}

export function forgotPassword(
  email: string,
  intent: Intent,
): Promise<ApiResult<{ accepted: true }>> {
  return transport.request("/auth/password/forgot", { method: "POST", body: { email }, intent });
}

export function resetPassword(
  input: { token: string; newPassword: string },
  intent: Intent,
): Promise<ApiResult<{ passwordReset: true; signInRequired: true }>> {
  return transport.request("/auth/password/reset", { method: "POST", body: input, intent });
}
