"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FbAlert, FbButtonPrimary, FbButtonSecondary, FbModal, FbTextField } from "@flowboard/ui";
import { Intent, fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useCreateProject } from "./queries.ts";

/**
 * `PRJ-02` — tạo dự án riêng tư.
 *
 * Hai điều hợp đồng chốt và UI phải nói đúng:
 *
 * - Dự án **luôn riêng tư**; không có lựa chọn visibility, vì không có cột
 *   visibility nào tồn tại.
 * - Người tạo trở thành **Owner** của dự án đó, trong cùng transaction.
 *
 * Không gian làm việc là ngữ cảnh của trang, không phải một trường chọn trong
 * form: route đã xác định `workspaceId`, và cho chọn lại ở đây sẽ tạo ra một
 * đường thứ hai để gửi sai workspace.
 */
const FORM_ID = "create-project-form";

export function CreateProjectDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName?: string | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const submitted = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const mutation = useCreateProject(workspaceId);
  const failure = toFailure(mutation.error);

  const trimmed = name.trim();
  const submitting = mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || trimmed === "") return;

    // Người dùng sửa tên ⇒ ý định mới ⇒ key mới. Giữ key cũ với payload khác
    // sẽ nhận `409 IDEMPOTENCY_KEY_REUSED`.
    if (submitted.current !== undefined && submitted.current !== trimmed) intent.current.rotate();
    submitted.current = trimmed;

    mutation.mutate(
      { name: trimmed, intent: intent.current },
      {
        onSuccess: (data) => {
          onClose();
          router.push(`/du-an/${data.project.id}/thanh-vien`);
        },
      },
    );
  }

  return (
    <FbModal
      title="Tạo dự án"
      subtitle={
        workspaceName === undefined
          ? "Dự án mới là riêng tư. Người tạo trở thành Owner."
          : `Trong không gian ${workspaceName}. Dự án mới là riêng tư; người tạo trở thành Owner.`
      }
      onRequestClose={onClose}
      closeDisabled={submitting}
      footer={
        <>
          <FbButtonSecondary onClick={onClose} disabled={submitting}>
            Hủy
          </FbButtonSecondary>
          <FbButtonPrimary
            type="submit"
            form={FORM_ID}
            loading={submitting}
            disabled={trimmed === ""}
          >
            Tạo dự án
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
          id="project-name"
          label="Tên dự án"
          value={name}
          onChange={setName}
          required
          hint="Ví dụ: Làm mới website"
          error={failure === undefined ? undefined : fieldError(failure, "name")}
          disabled={submitting}
        />

        <FbAlert
          intent="info"
          title="Dự án riêng tư theo mặc định"
          description="Quản trị viên không gian không tự có quyền truy cập nếu chưa được thêm vào dự án."
        />
      </form>
    </FbModal>
  );
}
