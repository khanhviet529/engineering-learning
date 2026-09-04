import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { SignInForm } from "../../features/auth/sign-in-form.tsx";

export const metadata: Metadata = { title: "Đăng nhập · Flowboard" };

/** `AUTH-01` — đăng nhập. `?next=` là đích quay lại, được kiểm trước khi dùng. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Đăng nhập" description="Dùng email và mật khẩu của bạn để tiếp tục.">
      <SignInForm next={next} />
    </AuthShell>
  );
}
