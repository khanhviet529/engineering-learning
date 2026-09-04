"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FbAlert,
  FbBadge,
  FbButtonPrimary,
  FbButtonSecondary,
  FbModal,
  FbPageSection,
  FbSelect,
  FbSkeleton,
  FbTextField,
} from "@flowboard/ui";
import type { ProjectMember, ProjectRole } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState, SystemState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent, fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import {
  useAddProjectMember,
  useChangeProjectMemberRole,
  useProject,
  useRemoveProjectMember,
} from "../projects/queries.ts";
import { MemberTable, type MemberRow } from "./member-table.tsx";

/**
 * `PRM-01` — thành viên của một dự án.
 *
 * Ba bất biến mà UI phải nói đúng, cả ba do **server** cưỡng chế:
 *
 * 1. Chỉ thêm được người **đã là thành viên workspace** chứa dự án.
 * 2. Dự án luôn còn ít nhất một Owner; hạ hoặc gỡ Owner cuối cùng bị từ chối
 *    bằng `409`.
 * 3. Không tự bỏ gán việc: gỡ một người còn đang được giao task bị từ chối.
 *
 * UI **không** kiểm lại ba điều này để quyết định cho phép hay không — nó chỉ
 * hiển thị kết quả server trả về. Tự kiểm là nhân bản policy, và bản sao sẽ
 * lệch khỏi bản gốc.
 */

const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner · Chủ sở hữu",
  editor: "Editor · Có thể chỉnh sửa",
  viewer: "Viewer · Chỉ xem",
};

const ROLE_OPTIONS = [
  { value: "owner", label: ROLE_LABEL.owner },
  { value: "editor", label: ROLE_LABEL.editor },
  { value: "viewer", label: ROLE_LABEL.viewer },
] as const;

const ADD_FORM_ID = "add-project-member-form";

export function ProjectMembersScreen({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { detail, loading, failure, refetch } = useProject(projectId);
  const [adding, setAdding] = useState(false);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Thành viên dự án"
      breadcrumb={detail?.project.name}
      pathname={pathname ?? ""}
      {...(detail === undefined
        ? {}
        : { project: { id: detail.project.id, capabilities: detail.capabilities } })}
      {...(detail === undefined ? {} : { workspaceId: detail.project.workspaceId })}
    >
      {children}
    </AppShell>
  );

  if (failure !== undefined) return shell(<FailureState failure={failure} onRetry={refetch} />);
  if (loading || detail === undefined) return shell(<FbSkeleton lines={4} />);

  const manageable = can("project:member:manage", { capabilities: detail.capabilities });

  // `PRM-01` là bề mặt **Owner-only** theo
  // [kiến trúc thông tin](../../../../../docs/design/information-architecture.md):
  // Editor và Viewer không thấy entry point, và URL trực tiếp là `Forbidden`.
  // Đây là `403` chứ không phải `404`: actor **là** thành viên dự án và nhìn
  // thấy được dự án, chỉ thiếu đúng action này.
  if (!manageable) {
    return shell(
      <SystemState
        screen="SYS-01"
        backHref={`/khong-gian-lam-viec/${detail.project.workspaceId}`}
      />,
    );
  }

  return shell(
    <>
      <FbPageSection
        heading="Thành viên của dự án"
        description="Owner quản lý thành viên và vai trò của chính dự án này."
        action={<FbButtonPrimary onClick={() => setAdding(true)}>Thêm thành viên</FbButtonPrimary>}
      >
        <FbAlert
          intent="info"
          title="Chỉ thêm được người đã là thành viên của không gian"
          description="Nếu người bạn cần chưa ở trong không gian, Quản trị viên không gian phải thêm họ vào trước; vai trò dự án không kế thừa từ không gian."
        />

        {detail.members.length === 0 ? (
          <FbAlert
            intent="info"
            title="Dự án chưa có thành viên nào"
            description="Thêm ít nhất một Owner để dự án có người quản lý."
          />
        ) : (
          <MemberTable
            caption="Thành viên của dự án"
            columns={["Thành viên", "Vai trò", "Phạm vi"]}
            rows={detail.members.map<MemberRow>((member) => ({
              id: member.userId,
              name: member.displayName,
              email: member.email,
              badge: <FbBadge tone={toneFor(member.role)}>{ROLE_LABEL[member.role]}</FbBadge>,
              meta: SCOPE_TEXT[member.role],
            }))}
            renderActions={(row) => (
              <MemberActions
                projectId={projectId}
                row={row}
                member={detail.members.find((item) => item.userId === row.id)}
              />
            )}
          />
        )}
      </FbPageSection>

      {adding && <AddProjectMemberDialog projectId={projectId} onClose={() => setAdding(false)} />}
    </>,
  );
}

const SCOPE_TEXT: Record<ProjectRole, string> = {
  owner: "Toàn quyền trong dự án",
  editor: "Tạo, sửa, giao và di chuyển việc",
  viewer: "Chỉ đọc board, việc, bình luận và lịch sử",
};

function toneFor(role: ProjectRole): "brand" | "info" | "neutral" {
  if (role === "owner") return "brand";
  return role === "editor" ? "info" : "neutral";
}

function MemberActions({
  projectId,
  row,
  member,
}: {
  projectId: string;
  row: MemberRow;
  member: ProjectMember | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ProjectRole>(member?.role ?? "viewer");
  const roleIntent = useRef(new Intent());
  const removeIntent = useRef(new Intent());
  const changeRole = useChangeProjectMemberRole(projectId);
  const removeMember = useRemoveProjectMember(projectId);

  const failure = toFailure(changeRole.error) ?? toFailure(removeMember.error);
  const busy = changeRole.isPending || removeMember.isPending;

  return (
    <>
      <FbButtonSecondary onClick={() => setOpen(true)}>Quản lý</FbButtonSecondary>

      {open && (
        <FbModal
          title={`Quản lý ${row.name}`}
          subtitle="Đổi vai trò hoặc gỡ khỏi dự án. Dự án phải luôn còn ít nhất một Owner."
          onRequestClose={() => setOpen(false)}
          closeDisabled={busy}
          footer={
            <>
              <FbButtonSecondary onClick={() => setOpen(false)} disabled={busy}>
                Đóng
              </FbButtonSecondary>
              <FbButtonPrimary
                loading={changeRole.isPending}
                disabled={member === undefined || role === member.role}
                onClick={() => {
                  changeRole.mutate(
                    { userId: row.id, role, intent: roleIntent.current },
                    { onSuccess: () => setOpen(false) },
                  );
                }}
              >
                Lưu vai trò
              </FbButtonPrimary>
            </>
          }
        >
          {failure !== undefined && (
            <FbAlert
              intent="error"
              title={failure.message}
              description={`Mã tra cứu: ${failure.requestId}`}
            />
          )}

          <FbSelect
            id={`member-role-${row.id}`}
            label="Vai trò trong dự án"
            value={role}
            onChange={(value) => {
              setRole(value as ProjectRole);
              // Payload đổi ⇒ ý định mới.
              roleIntent.current.rotate();
            }}
            options={ROLE_OPTIONS}
            disabled={busy}
          />

          <div
            style={{
              display: "grid",
              gap: "var(--fb-space-2)",
              paddingTop: "var(--fb-space-3)",
              borderTop: "1px solid var(--fb-color-border-subtle)",
            }}
          >
            <span
              style={{
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              Gỡ khỏi dự án sẽ bị từ chối nếu người này là Owner cuối cùng, hoặc vẫn đang được giao
              việc trong dự án.
            </span>
            <div>
              <FbButtonSecondary
                loading={removeMember.isPending}
                disabled={busy}
                onClick={() => {
                  removeMember.mutate(
                    { userId: row.id, intent: removeIntent.current },
                    { onSuccess: () => setOpen(false) },
                  );
                }}
              >
                Gỡ khỏi dự án
              </FbButtonSecondary>
            </div>
          </div>
        </FbModal>
      )}
    </>
  );
}

function AddProjectMemberDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("editor");
  const submitted = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const mutation = useAddProjectMember(projectId);
  const failure = toFailure(mutation.error);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending || userId.trim() === "") return;

    const payload = `${userId.trim()}|${role}`;
    if (submitted.current !== undefined && submitted.current !== payload) intent.current.rotate();
    submitted.current = payload;

    mutation.mutate(
      { userId: userId.trim(), role, intent: intent.current },
      { onSuccess: onClose },
    );
  }

  return (
    <FbModal
      title="Thêm thành viên dự án"
      subtitle="Người được thêm phải đã là thành viên của không gian chứa dự án."
      onRequestClose={onClose}
      closeDisabled={mutation.isPending}
      footer={
        <>
          <FbButtonSecondary onClick={onClose} disabled={mutation.isPending}>
            Hủy
          </FbButtonSecondary>
          <FbButtonPrimary
            type="submit"
            form={ADD_FORM_ID}
            loading={mutation.isPending}
            disabled={userId.trim() === ""}
          >
            Thêm vào dự án
          </FbButtonPrimary>
        </>
      }
    >
      <form
        id={ADD_FORM_ID}
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
          id="project-member-user-id"
          label="Mã người dùng"
          value={userId}
          onChange={setUserId}
          required
          hint="Dán UUID của người dùng. MVP chưa có tra cứu theo email."
          error={failure === undefined ? undefined : fieldError(failure, "userId")}
          disabled={mutation.isPending}
        />

        <FbSelect
          id="project-member-role"
          label="Vai trò trong dự án"
          value={role}
          onChange={(value) => setRole(value as ProjectRole)}
          options={ROLE_OPTIONS}
          error={failure === undefined ? undefined : fieldError(failure, "role")}
          disabled={mutation.isPending}
        />
      </form>
    </FbModal>
  );
}
