"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FbAlert, FbButtonPrimary, FbLink, FbPasswordField, FbTextField } from "@flowboard/ui";
import { signIn } from "../../lib/api.ts";
import { fieldError, type ApiFailure } from "../../lib/transport.ts";

/**
 * `AUTH-01` — đăng nhập.
 *
 * Hai hành vi bắt buộc theo hợp đồng, và cả hai đều dễ làm sai theo hướng
 * "tiện cho người dùng":
 *
 * 1. Gặp `403 EMAIL_VERIFICATION_REQUIRED` thì **xoá mật khẩu**, chỉ giữ email
 *    trong form state tạm, rồi chuyển sang `AUTH-05`.
 * 2. **Không bao giờ tự retry** sign-in. Một lần bấm là một lần thử.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const [retryAfter, setRetryAfter] = useState<number | undefined>(undefined);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(undefined);

    const result = await signIn({ email, password });
    setSubmitting(false);

    if (result.ok) {
      router.push("/");
      return;
    }

    if (result.code === "EMAIL_VERIFICATION_REQUIRED") {
      // Xoá mật khẩu khỏi state trước khi điều hướng: nó không có việc gì ở
      // màn hình tiếp theo, và giữ lại chỉ tăng bề mặt rò rỉ.
      setPassword("");
      router.push(`/xac-minh-email?email=${encodeURIComponent(email)}`);
      return;
    }

    if (result.code === "RATE_LIMITED") setRetryAfter(result.retryAfterSeconds);
    setFailure(result);
  }

  const rateLimited = failure?.code === "RATE_LIMITED";

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "var(--fb-space-4)" }} noValidate>
      {failure !== undefined && (
        <FbAlert
          intent="error"
          title={
            rateLimited && retryAfter !== undefined
              ? `Bạn đã thử quá nhiều lần. Vui lòng chờ ${String(retryAfter)} giây.`
              : failure.message
          }
          description={
            // `requestId` hiện ra để người dùng báo lại được, không phải để trang trí.
            failure.code === "INTERNAL_ERROR" ? `Mã tra cứu: ${failure.requestId}` : undefined
          }
        />
      )}

      <FbTextField
        id="email"
        label="Email"
        value={email}
        onChange={setEmail}
        required
        autoComplete="email"
        error={failure === undefined ? undefined : fieldError(failure, "email")}
        disabled={submitting || rateLimited}
      />

      <FbPasswordField
        id="password"
        label="Mật khẩu"
        value={password}
        onChange={setPassword}
        required
        autoComplete="current-password"
        error={failure === undefined ? undefined : fieldError(failure, "password")}
        disabled={submitting || rateLimited}
      />

      <FbButtonPrimary type="submit" loading={submitting} disabled={rateLimited} block>
        Đăng nhập
      </FbButtonPrimary>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--fb-font-size-body-sm)",
        }}
      >
        <FbLink href="/quen-mat-khau">Quên mật khẩu?</FbLink>
        <FbLink href="/dang-ky">Tạo tài khoản</FbLink>
      </div>
    </form>
  );
}
