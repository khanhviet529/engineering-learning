"use client";

import { useEffect, useRef, useState } from "react";
import { FbAlert, FbButtonPrimary, FbButtonSecondary, FbLink } from "@flowboard/ui";
import { resendVerification, verifyEmail } from "../../lib/api.ts";
import { Intent, type ApiFailure } from "../../lib/transport.ts";
import { messageFor } from "../system/messages.ts";
import { VERIFY_EMAIL_ERROR } from "./messages.ts";

type Phase = "pending" | "verifying" | "verified" | "link-expired" | "awaiting-user";

/**
 * `AUTH-05` — xác minh email.
 *
 * Màn hình này phục vụ **hai** đường vào, và chúng khác nhau:
 *
 * - Có `token` trong URL: người dùng vừa bấm link trong thư, nên tự xác minh.
 * - Không có `token`: người dùng bị chuyển tới đây sau `403
 *   EMAIL_VERIFICATION_REQUIRED`, nên chỉ hiện đường gửi lại thư.
 *
 * Cả hai đường đều **không** tự retry sign-in.
 */
export function VerifyEmailPanel({
  token,
  email,
}: {
  token: string | undefined;
  email: string | undefined;
}) {
  const [phase, setPhase] = useState<Phase>(
    token === undefined || token === "" ? "awaiting-user" : "pending",
  );
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const intent = useRef(new Intent());
  const attempted = useRef(false);

  useEffect(() => {
    if (token === undefined || token === "" || attempted.current) return;
    // Token dùng một lần, nên chỉ được gửi **đúng một** request cho một lần
    // mở trang. React 19 gọi effect hai lần ở chế độ strict, và không có chốt
    // này thì lần thứ hai sẽ thấy token đã bị chính lần thứ nhất tiêu thụ.
    attempted.current = true;

    setPhase("verifying");
    void verifyEmail(token).then((result) => {
      if (result.ok) {
        setPhase("verified");
        return;
      }
      setFailure(result);
      setPhase("link-expired");
    });
  }, [token]);

  async function handleResend(): Promise<void> {
    if (email === undefined || resending) return;
    setResending(true);
    await resendVerification(email, intent.current);
    setResending(false);
    // Luôn báo như nhau, dù account có tồn tại hay không.
    setResent(true);
  }

  if (phase === "verifying") {
    return <FbAlert intent="info" title="Đang xác minh liên kết…" />;
  }

  if (phase === "verified") {
    return (
      <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
        <FbAlert intent="success" title="Email đã được xác minh" />
        <FbButtonPrimary block onClick={() => (window.location.href = "/dang-nhap")}>
          Đăng nhập
        </FbButtonPrimary>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
      {phase === "link-expired" && (
        <FbAlert
          intent="error"
          title={
            failure === undefined
              ? VERIFY_EMAIL_ERROR.fallback
              : messageFor(VERIFY_EMAIL_ERROR, failure)
          }
          description="Gửi lại thư để nhận một liên kết mới."
        />
      )}

      {phase === "awaiting-user" && (
        <FbAlert
          intent="warning"
          title="Email của bạn chưa được xác minh"
          description="Nhấn vào liên kết trong thư để kích hoạt tài khoản. Chưa nhận được thì gửi lại."
        />
      )}

      {resent && (
        <FbAlert
          intent="info"
          title="Đã gửi lại thư nếu tài khoản tồn tại"
          description="Liên kết cũ hết hiệu lực ngay khi liên kết mới được tạo."
        />
      )}

      {email !== undefined && (
        <FbButtonSecondary block loading={resending} onClick={handleResend}>
          Gửi lại thư xác minh
        </FbButtonSecondary>
      )}

      <div style={{ fontSize: "var(--fb-font-size-body-sm)" }}>
        <FbLink href="/dang-nhap">Quay lại đăng nhập</FbLink>
      </div>
    </div>
  );
}
