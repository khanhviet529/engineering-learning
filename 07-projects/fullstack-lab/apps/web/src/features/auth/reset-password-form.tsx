"use client";

import { useMemo, useRef, useState } from "react";
import { FbAlert, FbButtonPrimary, FbChecklistRow, FbLink, FbPasswordField } from "@flowboard/ui";
import { resetPassword } from "../../lib/api.ts";
import { Intent, fieldError, type ApiFailure } from "../../lib/transport.ts";
import { checklistSatisfied, passwordChecklist } from "./password-checklist.ts";

/**
 * `AUTH-04` — đặt lại mật khẩu.
 *
 * Nói rõ hệ quả **trước** khi người dùng bấm: đặt lại sẽ đăng xuất mọi thiết bị.
 * Đó là hành vi đúng, nhưng bất ngờ nếu không được báo trước.
 */
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const intent = useRef(new Intent());
  const lastPayload = useRef("");

  // Không có email và tên ở màn này, nên checklist chỉ kiểm được độ dài.
  const checklist = useMemo(
    () => passwordChecklist({ password, email: "", displayName: "" }),
    [password],
  );

  if (token === undefined || token === "") {
    return (
      <FbAlert
        intent="error"
        title="Liên kết không hợp lệ"
        description={
          <>
            Hãy yêu cầu một liên kết mới ở trang{" "}
            <FbLink href="/quen-mat-khau">quên mật khẩu</FbLink>.
          </>
        }
      />
    );
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || !checklistSatisfied(checklist)) return;

    const payload = JSON.stringify({ token, password });
    if (lastPayload.current !== "" && lastPayload.current !== payload) intent.current.rotate();
    lastPayload.current = payload;

    setSubmitting(true);
    setFailure(undefined);
    const result = await resetPassword(
      { token: token as string, newPassword: password },
      intent.current,
    );
    setSubmitting(false);

    if (result.ok) {
      setDone(true);
      return;
    }
    setFailure(result);
  }

  if (done) {
    return (
      <FbAlert
        intent="success"
        title="Đã đổi mật khẩu"
        description={
          <>
            Mọi thiết bị đã được đăng xuất. <FbLink href="/dang-nhap">Đăng nhập lại</FbLink>.
          </>
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--fb-space-4)" }} noValidate>
      {failure !== undefined && (
        <FbAlert
          intent="error"
          title={fieldError(failure, "token") ?? failure.message}
          description={
            fieldError(failure, "token") === undefined ? undefined : (
              <FbLink href="/quen-mat-khau">Yêu cầu liên kết mới</FbLink>
            )
          }
        />
      )}

      <FbPasswordField
        id="newPassword"
        label="Mật khẩu mới"
        value={password}
        onChange={setPassword}
        required
        autoComplete="new-password"
        hint="Đặt lại mật khẩu sẽ đăng xuất mọi thiết bị đang đăng nhập."
        error={failure === undefined ? undefined : fieldError(failure, "newPassword")}
        disabled={submitting}
      />

      <ul style={{ margin: 0, padding: 0, display: "grid", gap: "var(--fb-space-1)" }}>
        {checklist.map((item) => (
          <FbChecklistRow key={item.id} met={item.met}>
            {item.label}
          </FbChecklistRow>
        ))}
      </ul>

      <FbButtonPrimary
        type="submit"
        loading={submitting}
        disabled={!checklistSatisfied(checklist)}
        block
      >
        Đặt lại mật khẩu
      </FbButtonPrimary>
    </form>
  );
}
