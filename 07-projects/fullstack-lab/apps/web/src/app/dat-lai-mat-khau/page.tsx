import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { ResetPasswordForm } from "../../features/auth/reset-password-form.tsx";

export const metadata: Metadata = { title: "Đặt lại mật khẩu · Flowboard" };

/** `AUTH-04` — đặt lại mật khẩu bằng token một lần từ thư. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Đặt lại mật khẩu" description="Chọn một mật khẩu mới cho tài khoản của bạn.">
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
