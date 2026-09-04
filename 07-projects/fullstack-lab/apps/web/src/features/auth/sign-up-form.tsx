"use client";

import { useMemo, useRef, useState } from "react";
import {
  FbAlert,
  FbButtonPrimary,
  FbChecklistRow,
  FbLink,
  FbPasswordField,
  FbTextField,
} from "@flowboard/ui";
import { signUp } from "../../lib/api.ts";
import { Intent, fieldError, type ApiFailure } from "../../lib/transport.ts";
import { checklistSatisfied, passwordChecklist } from "./password-checklist.ts";

/**
 * `AUTH-02` — đăng ký.
 *
 * Checklist mật khẩu có **hai** dòng live, đúng theo ADR-0007: độ dài, và
 * không chứa email hay tên hiển thị. Blocklist là quyết định của server và
 * hiện thành field error **sau khi submit** — client không mang danh sách đó.
 */
export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const [sent, setSent] = useState(false);

  /**
   * Một ý định = một lần bấm "Tạo tài khoản".
   *
   * Key sống trong `ref` nên nó **không** đổi khi component render lại, và
   * chỉ xoay khi người dùng sửa payload — đúng vòng đời trong quy ước frontend.
   */
  const intent = useRef(new Intent());
  const lastPayload = useRef("");

  const checklist = useMemo(
    () => passwordChecklist({ password, email, displayName }),
    [password, email, displayName],
  );
  const canSubmit = checklistSatisfied(checklist) && email.length > 0 && displayName.length > 0;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || !canSubmit) return;

    // Payload đổi so với lần gửi trước nghĩa là một ý định mới, nên xoay key.
    // Gửi lại y nguyên payload thì giữ key: đó là retry, không phải ý định mới.
    const payload = JSON.stringify({ email, displayName, password });
    if (lastPayload.current !== "" && lastPayload.current !== payload) {
      intent.current.rotate();
    }
    lastPayload.current = payload;

    setSubmitting(true);
    setFailure(undefined);

    const result = await signUp({ email, displayName, password }, intent.current);
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
        intent="success"
        title="Đã gửi thư xác minh"
        description={
          <>
            Kiểm tra hộp thư <strong>{email}</strong> và nhấn vào liên kết để kích hoạt tài khoản.
            Liên kết có hiệu lực trong 24 giờ.
          </>
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--fb-space-4)" }} noValidate>
      {failure !== undefined && <FbAlert intent="error" title={failure.message} />}

      <FbTextField
        id="email"
        label="Email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        error={failure === undefined ? undefined : fieldError(failure, "email")}
        disabled={submitting}
      />

      <FbTextField
        id="displayName"
        label="Tên hiển thị"
        value={displayName}
        onChange={setDisplayName}
        required
        autoComplete="name"
        error={failure === undefined ? undefined : fieldError(failure, "displayName")}
        disabled={submitting}
      />

      <FbPasswordField
        id="password"
        label="Mật khẩu"
        value={password}
        onChange={setPassword}
        required
        autoComplete="new-password"
        error={failure === undefined ? undefined : fieldError(failure, "password")}
        disabled={submitting}
      />

      <ul style={{ margin: 0, padding: 0, display: "grid", gap: "var(--fb-space-1)" }}>
        {checklist.map((item) => (
          <FbChecklistRow key={item.id} met={item.met}>
            {item.label}
          </FbChecklistRow>
        ))}
      </ul>

      <FbButtonPrimary type="submit" loading={submitting} disabled={!canSubmit} block>
        Tạo tài khoản
      </FbButtonPrimary>

      <div style={{ fontSize: "var(--fb-font-size-body-sm)" }}>
        Đã có tài khoản? <FbLink href="/dang-nhap">Đăng nhập</FbLink>
      </div>
    </form>
  );
}
