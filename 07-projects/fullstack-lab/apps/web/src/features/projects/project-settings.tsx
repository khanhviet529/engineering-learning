"use client";

import { useEffect, useRef, useState } from "react";
import {
  FbAlert,
  FbButtonPrimary,
  FbButtonSecondary,
  FbModal,
  FbPageSection,
  FbSkeleton,
  FbTextField,
  FbToast,
} from "@flowboard/ui";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState, SystemState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent, fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useProject, useRenameProject } from "./queries.ts";

/**
 * `PRJ-03` — cài đặt dự án. Owner-only, và **chỉ đổi tên**.
 *
 * Không có description, visibility, xoá hay archive: mỗi thứ đó là một quyết
 * định sản phẩm riêng chưa được chốt. Form gửi đúng `{ name }` qua
 * `PATCH /projects/:projectId`.
 *
 * Bốn hành vi bắt buộc theo [đặc tả tương tác](../../../../../docs/design/interaction-specifications.md):
 *
 * 1. `Lưu` chỉ bật khi form hợp lệ **và** tên khác giá trị ban đầu.
 * 2. Không có optimistic rename — header và danh sách chỉ đổi theo tên server
 *    xác nhận.
 * 3. Rời trang khi form bẩn phải đi qua xác nhận, với "Tiếp tục chỉnh sửa" là
 *    lựa chọn mặc định an toàn.
 * 4. Lỗi giữ nguyên giá trị đã nhập.
 */
const FORM_ID = "project-settings-form";

export function ProjectSettingsScreen({ projectId }: { projectId: string }) {
  const { detail, loading, failure, refetch } = useProject(projectId);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Cài đặt dự án"
      breadcrumb={detail?.project.name}
      {...(detail === undefined
        ? {}
        : { project: { id: detail.project.id, capabilities: detail.capabilities } })}
      {...(detail === undefined ? {} : { workspaceId: detail.project.workspaceId })}
    >
      {children}
    </AppShell>
  );

  if (failure !== undefined) return shell(<FailureState failure={failure} onRetry={refetch} />);
  if (loading || detail === undefined) return shell(<FbSkeleton lines={3} />);

  // Đọc được project nhưng thiếu `project:update` ⇒ đúng nghĩa `403`: actor là
  // thành viên, nhìn thấy dự án, nhưng không có action này.
  if (!can("project:update", { capabilities: detail.capabilities })) {
    return shell(<SystemState screen="SYS-01" backHref={`/du-an/${projectId}/thanh-vien`} />);
  }

  return shell(<ProjectNameForm projectId={projectId} initialName={detail.project.name} />);
}

function ProjectNameForm({ projectId, initialName }: { projectId: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitted = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const mutation = useRenameProject(projectId);
  const failure = toFailure(mutation.error);

  // Server xác nhận tên mới ⇒ đó là giá trị ban đầu mới, và form trở lại sạch.
  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const trimmed = name.trim();
  const dirty = trimmed !== initialName;
  const submitting = mutation.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || trimmed === "" || !dirty) return;

    if (submitted.current !== undefined && submitted.current !== trimmed) intent.current.rotate();
    submitted.current = trimmed;

    mutation.mutate(
      { name: trimmed, intent: intent.current },
      {
        onSuccess: () => {
          setSaved(true);
          // Ý định tiếp theo là một ý định khác, kể cả khi người dùng đổi tên
          // lần nữa ngay sau đó.
          intent.current.rotate();
          submitted.current = undefined;
        },
      },
    );
  }

  return (
    <>
      <FbPageSection
        heading="Tên dự án"
        description="Owner đổi được tên dự án. Đây là thiết lập duy nhất của dự án ở phiên bản này."
      >
        <form
          id={FORM_ID}
          onSubmit={handleSubmit}
          noValidate
          style={{ display: "grid", gap: "var(--fb-space-4)", maxWidth: 620 }}
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
            onChange={(value) => {
              setName(value);
              setSaved(false);
            }}
            required
            error={failure === undefined ? undefined : fieldError(failure, "name")}
            disabled={submitting}
          />

          <div style={{ display: "flex", gap: "var(--fb-space-2)", flexWrap: "wrap" }}>
            <FbButtonPrimary
              type="submit"
              form={FORM_ID}
              loading={submitting}
              disabled={!dirty || trimmed === ""}
            >
              Lưu tên dự án
            </FbButtonPrimary>
            <FbButtonSecondary
              disabled={submitting}
              onClick={() => {
                // Rời form bẩn đi qua xác nhận; form sạch thì đi thẳng.
                if (dirty) setConfirmingDiscard(true);
                else window.location.assign(`/du-an/${projectId}/thanh-vien`);
              }}
            >
              Quay lại dự án
            </FbButtonSecondary>
          </div>
        </form>

        {saved && !dirty && <FbToast message="Đã lưu tên dự án." />}
      </FbPageSection>

      {confirmingDiscard && (
        <FbModal
          title="Bỏ thay đổi chưa lưu?"
          subtitle="Tên dự án bạn vừa sửa sẽ không được gửi đi."
          onRequestClose={() => setConfirmingDiscard(false)}
          // Focus mặc định vào phương án an toàn ở đầu footer, không vào nút
          // đóng — một `Enter` theo phản xạ phải giữ dữ liệu, không vứt nó đi.
          initialFocus="footer"
          footer={
            <>
              {/* Phương án an toàn đứng **đầu** footer; `initialFocus="footer"`
                  ở trên đưa focus vào đúng nó. */}
              <FbButtonPrimary onClick={() => setConfirmingDiscard(false)}>
                Tiếp tục chỉnh sửa
              </FbButtonPrimary>
              <FbButtonSecondary
                onClick={() => {
                  setName(initialName);
                  setConfirmingDiscard(false);
                  window.location.assign(`/du-an/${projectId}/thanh-vien`);
                }}
              >
                Bỏ thay đổi
              </FbButtonSecondary>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: "var(--fb-font-size-body)" }}>
            Không có thay đổi nào được lưu tự động.
          </p>
        </FbModal>
      )}
    </>
  );
}
