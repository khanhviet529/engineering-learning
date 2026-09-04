import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { SignInForm } from "../../features/auth/sign-in-form.tsx";

export const metadata: Metadata = { title: "Đăng nhập · Flowboard" };

/** `AUTH-01` — đăng nhập. */
export default function Page() {
  return (
    <AuthShell title="Đăng nhập" description="Dùng email và mật khẩu của bạn để tiếp tục.">
      <SignInForm />
    </AuthShell>
  );
}
