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
import type { WorkspaceRole } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { AsyncSection } from "../system/async-section.tsx";
import { FailureState, SystemState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent, fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import {
  useAddWorkspaceMember,
  useRemoveWorkspaceMember,
  useWorkspaceMembers,
  useWorkspaces,
} from "./queries.ts";
import { MemberTable, type MemberRow } from "../members/member-table.tsx";

/**
 * `WSP-03` — thành viên của một không gian làm việc.
 *
 * Ranh giới quan trọng nhất ở màn này: quyền ở cấp workspace **không** cấp
 * quyền đọc project riêng tư. Thêm một người vào workspace chỉ làm họ **đủ
 * điều kiện** để Owner của một project thêm họ vào project đó.
 */

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  workspace_admin: "Quản trị viên không gian",
  workspace_member: "Thành viên",
};

const ADD_FORM_ID = "add-workspace-member-form";

export function WorkspaceMembersScreen({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { workspaces, failure: workspacesFailure } = useWorkspaces();
  const workspace = workspaces?.find((item) => item.id === workspaceId);
  const manageable = can("workspace:member:manage", workspace);
  // Chỉ hỏi danh sách khi đã biết actor được phép quản lý.
  const { members, loading, failure, refetch } = useWorkspaceMembers(workspaceId, manageable);
  const [adding, setAdding] = useState(false);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Thành viên không gian"
      breadcrumb={workspace?.name}
      pathname={pathname ?? ""}
      workspaceId={workspaceId}
      {...(workspace === undefined ? {} : { workspaceCapabilities: workspace.capabilities })}
      {...(workspace === undefined ? {} : { workspaceName: workspace.name })}
    >
      {children}
    </AppShell>
  );

  // Không đọc được danh sách workspace thì không suy diễn gì thêm.
  if (workspacesFailure !== undefined) {
    return shell(<FailureState failure={workspacesFailure} />);
  }

  // Chưa biết workspace ⇒ đang tải. Không render khung của một bề mặt
  // Owner-only trước khi biết actor có được vào hay không.
  if (workspaces === undefined) return shell(<FbSkeleton lines={4} />);

  // Đã tải danh sách mà không có workspace này: không phải thành viên, hoặc nó
  // không tồn tại. Hai khả năng đó không được phân biệt ⇒ `SYS-05`.
  if (workspace === undefined) return shell(<SystemState screen="SYS-05" />);

  // Là thành viên nhưng thiếu action ⇒ đúng nghĩa `403`.
  if (!manageable) {
    return shell(<SystemState screen="SYS-01" backHref={`/khong-gian-lam-viec/${workspaceId}`} />);
  }

  return shell(
    <>
      <FbPageSection
        heading="Danh sách thành viên"
        description="Quản trị viên không gian quản lý thành viên và quyền ở cấp không gian."
        action={<FbButtonPrimary onClick={() => setAdding(true)}>Thêm thành viên</FbButtonPrimary>}
      >
        <FbAlert
          intent="info"
          title="Quyền ở không gian không cấp quyền đọc dự án riêng tư"
          description="Sau khi được thêm vào không gian, người đó vẫn phải được Owner thêm vào từng dự án với một vai trò cụ thể."
        />

        <AsyncSection
          loading={loading}
          failure={failure}
          data={members}
          onRetry={refetch}
          skeletonLines={4}
        >
          {(items) =>
            items.length === 0 ? (
              <FbAlert
                intent="info"
                title="Không gian này chưa có thành viên nào khác"
                description="Thêm thành viên để họ có thể được mời vào các dự án của không gian."
              />
            ) : (
              <MemberTable
                caption="Thành viên của không gian làm việc"
                columns={["Thành viên", "Vai trò", "Tham gia từ"]}
                rows={items.map<MemberRow>((member) => ({
                  id: member.userId,
                  name: member.displayName,
                  email: member.email,
                  badge: (
                    <FbBadge tone={member.role === "workspace_admin" ? "brand" : "neutral"}>
                      {ROLE_LABEL[member.role]}
                    </FbBadge>
                  ),
                  meta: new Date(member.createdAt).toLocaleDateString("vi-VN"),
                }))}
                renderActions={(row) => <RemoveMemberButton workspaceId={workspaceId} row={row} />}
              />
            )
          }
        </AsyncSection>
      </FbPageSection>

      {adding && (
        <AddWorkspaceMemberDialog workspaceId={workspaceId} onClose={() => setAdding(false)} />
      )}
    </>,
  );
}

function RemoveMemberButton({ workspaceId, row }: { workspaceId: string; row: MemberRow }) {
  const [confirming, setConfirming] = useState(false);
  const intent = useRef(new Intent());
  const mutation = useRemoveWorkspaceMember(workspaceId);
  const failure = toFailure(mutation.error);

  return (
    <>
      <FbButtonSecondary onClick={() => setConfirming(true)} disabled={mutation.isPending}>
        Gỡ khỏi không gian
      </FbButtonSecondary>

      {confirming && (
        <FbModal
          title={`Gỡ ${row.name} khỏi không gian?`}
          subtitle="Việc này không tự gỡ họ khỏi các dự án mà họ đang là thành viên."
          onRequestClose={() => setConfirming(false)}
          closeDisabled={mutation.isPending}
          footer={
            <>
              {/* Phương án an toàn là mặc định: giữ nguyên. */}
              <FbButtonSecondary onClick={() => setConfirming(false)} disabled={mutation.isPending}>
                Giữ nguyên
              </FbButtonSecondary>
              <FbButtonPrimary
                loading={mutation.isPending}
                onClick={() => {
                  mutation.mutate(
                    { userId: row.id, intent: intent.current },
                    { onSuccess: () => setConfirming(false) },
                  );
                }}
              >
                Gỡ thành viên
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
          <p style={{ margin: 0, fontSize: "var(--fb-font-size-body)" }}>
            Server sẽ từ chối nếu việc gỡ làm hỏng một ràng buộc của dự án, ví dụ khi họ vẫn đang
            được giao việc.
          </p>
        </FbModal>
      )}
    </>
  );
}

/**
 * Thêm thành viên workspace.
 *
 * Hợp đồng nhận `{ userId, role }` — **một UUID**, không phải email. Ở MVP
 * chưa có endpoint tra cứu người dùng, nên form phải nhận thẳng ID. Đây là một
 * lỗ hổng hợp đồng đã ghi lại trong báo cáo M2, không phải lựa chọn thiết kế.
 */
function AddWorkspaceMemberDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("workspace_member");
  const submitted = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const mutation = useAddWorkspaceMember(workspaceId);
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
      title="Thêm thành viên không gian"
      subtitle="Thành viên không gian mới chưa có quyền đọc bất kỳ dự án riêng tư nào."
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
            Thêm thành viên
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
          id="member-user-id"
          label="Mã người dùng"
          value={userId}
          onChange={setUserId}
          required
          hint="Dán UUID của người dùng. MVP chưa có tra cứu theo email."
          error={failure === undefined ? undefined : fieldError(failure, "userId")}
          disabled={mutation.isPending}
        />

        <FbSelect
          id="member-role"
          label="Vai trò không gian"
          value={role}
          onChange={(value) => setRole(value as WorkspaceRole)}
          options={[
            { value: "workspace_member", label: ROLE_LABEL.workspace_member },
            { value: "workspace_admin", label: ROLE_LABEL.workspace_admin },
          ]}
          error={failure === undefined ? undefined : fieldError(failure, "role")}
          disabled={mutation.isPending}
        />
      </form>
    </FbModal>
  );
}
