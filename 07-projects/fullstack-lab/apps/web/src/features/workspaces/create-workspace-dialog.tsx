"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FbAlert, FbButtonPrimary, FbButtonSecondary, FbModal, FbTextField } from "@flowboard/ui";
import { Intent } from "../../lib/transport.ts";
import { fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useCreateWorkspace } from "./queries.ts";

/**
 * `WSP-02` — tạo không gian làm việc.
 *
 * Vòng đời `Idempotency-Key`, đúng
 * [quy ước frontend](../../../../../docs/engineering/frontend-conventions.md#vòng-đời-idempotency-key-phía-client):
 *
 * - Key sinh **một lần cho một ý định** và sống trong `ref`, nên nó không đổi
 *   khi component render lại.
 * - Gửi lại vì lỗi vận chuyển (`status 0`, `5xx`) **giữ nguyên** key — đó là
 *   toàn bộ lý do key tồn tại: replay trả lại kết quả đã lưu thay vì tạo
 *   workspace thứ hai.
 * - Người dùng **sửa tên** là một ý định mới, nên key được xoay.
 */
const FORM_ID = "create-workspace-form";

export function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // Tên tại thời điểm gửi gần nhất; so với nó để biết payload có đổi không.
  const submittedName = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const mutation = useCreateWorkspace();
  const failure = toFailure(mutation.error);

  const trimmed = name.trim();
  const submitting = mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || trimmed === "") return;

    if (submittedName.current !== undefined && submittedName.current !== trimmed) {
      // Payload đã đổi ⇒ ý định mới. Giữ key cũ ở đây sẽ nhận
      // `409 IDEMPOTENCY_KEY_REUSED`, và đó là bug của client chứ không phải
      // trạng thái nghiệp vụ để hiển thị cho người dùng.
      intent.current.rotate();
    }
    submittedName.current = trimmed;

    mutation.mutate(
      { name: trimmed, intent: intent.current },
      {
        onSuccess: (data) => {
          onClose();
          router.push(`/khong-gian-lam-viec/${data.workspace.id}`);
        },
      },
    );
  }

  return (
    <FbModal
      title="Tạo không gian làm việc"
      subtitle="Không gian tách thành viên, dự án và quy tắc làm việc."
      onRequestClose={onClose}
      closeDisabled={submitting}
      footer={
        <>
          <FbButtonSecondary onClick={onClose} disabled={submitting}>
            Hủy
          </FbButtonSecondary>
          {/* Nút nằm ngoài thẻ `form` nên nó dùng thuộc tính HTML `form` để
              liên kết. `Enter` trong input vẫn submit đúng form đó. */}
          <FbButtonPrimary
            type="submit"
            form={FORM_ID}
            loading={submitting}
            disabled={trimmed === ""}
          >
            Tạo không gian
          </FbButtonPrimary>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        style={{ display: "grid", gap: "var(--fb-space-4)" }}
      >
        {failure !== undefined && failure.code !== "VALIDATION_FAILED" && (
          <FbAlert
            intent="error"
            title={failure.message}
            description={`Mã tra cứu: ${failure.requestId}`}
          />
        )}

        <FbTextField
          id="workspace-name"
          label="Tên không gian"
          value={name}
          onChange={setName}
          required
          hint="Ví dụ: Nhóm phát triển sản phẩm"
          error={failure === undefined ? undefined : fieldError(failure, "name")}
          disabled={submitting}
        />
      </form>
    </FbModal>
  );
}
