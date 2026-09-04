import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { ForgotPasswordForm } from "../../features/auth/forgot-password-form.tsx";

export const metadata: Metadata = { title: "Quên mật khẩu · Flowboard" };

/** `AUTH-03` — quên mật khẩu. */
export default function Page() {
  return (
    <AuthShell
      title="Quên mật khẩu"
      description="Nhập email của bạn. Nếu tài khoản tồn tại, chúng tôi gửi liên kết đặt lại."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
