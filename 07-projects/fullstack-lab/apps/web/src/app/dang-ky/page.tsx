import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { SignUpForm } from "../../features/auth/sign-up-form.tsx";

export const metadata: Metadata = { title: "Tạo tài khoản · Flowboard" };

/** `AUTH-02` — đăng ký. */
export default function Page() {
  return (
    <AuthShell
      title="Tạo tài khoản"
      description="Bạn sẽ nhận một thư xác minh trước khi đăng nhập lần đầu."
    >
      <SignUpForm />
    </AuthShell>
  );
}
