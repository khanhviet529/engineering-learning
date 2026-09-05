"use client";

import { useRef, useState } from "react";
import { FbAlert, FbButtonPrimary, FbLink, FbTextField } from "@flowboard/ui";
import { forgotPassword } from "../../lib/api.ts";
import { Intent, type ApiFailure } from "../../lib/transport.ts";
import { messageFor } from "../system/messages.ts";
import { FORGOT_PASSWORD_ERROR } from "./messages.ts";

/**
 * `AUTH-03` — quên mật khẩu.
 *
 * Thành công và "email không tồn tại" cho **cùng một** màn hình. Đó không phải
 * sự mơ hồ: phân biệt hai trường hợp biến trang này thành một máy dò tài khoản.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const intent = useRef(new Intent());

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(undefined);
    const result = await forgotPassword(email, intent.current);
    setSubmitting(false);

    if (result.ok) {
      setSent(true);
      return;
    }
    setFailure(result);
  }

  if (sent) {
    return (
      <FbAlert
        intent="info"
        title="Đã gửi hướng dẫn nếu email tồn tại"
        description="Kiểm tra hộp thư của bạn. Liên kết đặt lại có hiệu lực trong 1 giờ và chỉ dùng được một lần."
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--fb-space-4)" }} noValidate>
      {failure !== undefined && (
        <FbAlert intent="error" title={messageFor(FORGOT_PASSWORD_ERROR, failure)} />
      )}

      <FbTextField
        id="email"
        label="Email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        disabled={submitting}
      />

      <FbButtonPrimary type="submit" loading={submitting} disabled={email.length === 0} block>
        Gửi hướng dẫn đặt lại
      </FbButtonPrimary>

      <div style={{ fontSize: "var(--fb-font-size-body-sm)" }}>
        <FbLink href="/dang-nhap">Quay lại đăng nhập</FbLink>
      </div>
    </form>
  );
}
