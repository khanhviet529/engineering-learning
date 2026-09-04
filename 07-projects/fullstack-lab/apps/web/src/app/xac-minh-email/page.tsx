import type { Metadata } from "next";
import { AuthShell } from "../../features/auth/auth-shell.tsx";
import { VerifyEmailPanel } from "../../features/auth/verify-email-panel.tsx";

export const metadata: Metadata = { title: "Xác minh email · Flowboard" };

/** `AUTH-05` — xác minh email, phục vụ cả đường có token lẫn đường gửi lại thư. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;
  return (
    <AuthShell title="Xác minh email" description="Bước cuối trước khi bạn đăng nhập lần đầu.">
      <VerifyEmailPanel token={token} email={email} />
    </AuthShell>
  );
}
