"use client";

import { useRef, useState } from "react";
import {
  FbAlert,
  FbBadge,
  FbButtonPrimary,
  FbButtonSecondary,
  FbModal,
  FbPageSection,
  FbSelect,
  FbSkeleton,
} from "@flowboard/ui";
import type { ProjectMember, ProjectRole } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState, SystemState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent, fieldError } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { messageFor } from "../system/messages.ts";
import { MEMBER_CANDIDATES_ERROR, PROJECT_MEMBER_ERROR } from "./messages.ts";
import {
  useAddProjectMember,
  useChangeProjectMemberRole,
  useMemberCandidates,
  useProject,
  useRemoveProjectMember,
  type MemberCandidates,
} from "../projects/queries.ts";
import { MemberTable, type MemberRow } from "./member-table.tsx";
import { MembershipConflictNotice, isMembershipConflict } from "./membership-conflict.tsx";

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
  const { detail, loading, failure, refetch } = useProject(projectId);
  const [adding, setAdding] = useState(false);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Thành viên dự án"
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
  /** Vai trò đã bị server từ chối gần nhất, để biết lựa chọn hiện tại có mới không. */
  const roleRejected = useRef<ProjectRole | undefined>(undefined);
  const changeRole = useChangeProjectMemberRole(projectId);
  const removeMember = useRemoveProjectMember(projectId);

  const roleFailure = toFailure(changeRole.error);
  const removeFailure = toFailure(removeMember.error);
  const failure = roleFailure ?? removeFailure;
  const busy = changeRole.isPending || removeMember.isPending;

  // Một xung đột membership không tự hết bằng cách gửi lại **cùng** request:
  // người dùng phải đi làm việc khác trước. Vì vậy đúng hành động đã bị từ
  // chối bị khoá lại, kèm chữ giải thích ngay bên trên — `disabled` chỉ hợp lệ
  // khi người dùng biết lý do, và ở đây họ biết.
  //
  // Đổi vai trò sang một giá trị **khác** lại là một request khác, nên nút lưu
  // mở lại ngay khi lựa chọn đổi: khoá nó vĩnh viễn sẽ chặn cả đường đi đúng.
  const roleBlocked = isMembershipConflict(roleFailure) && role === roleRejected.current;
  const removeBlocked = isMembershipConflict(removeFailure);

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
                disabled={member === undefined || role === member.role || roleBlocked}
                onClick={() => {
                  roleRejected.current = role;
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
          {isMembershipConflict(failure) ? (
            <MembershipConflictNotice failure={failure} />
          ) : (
            failure !== undefined && (
              <FbAlert
                intent="error"
                title={messageFor(PROJECT_MEMBER_ERROR, failure)}
                description={`Mã tra cứu: ${failure.requestId}`}
              />
            )
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
                disabled={busy || removeBlocked}
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

/**
 * Chọn người, **không** dán mã.
 *
 * Trước đây ô này là một `FbTextField` với hint "Dán UUID của người dùng".
 * Không màn hình nào trong sản phẩm hiển thị `userId` của ai, nên không có chỗ
 * hợp lệ nào để copy giá trị đó ra: màn hình có mặt nhưng không dùng được.
 * `GET /projects/:projectId/member-candidates` tồn tại để đóng đúng khoảng
 * trống đó.
 *
 * `userId` vẫn là thứ đi trong body — nó chỉ thôi đi qua bàn phím người dùng.
 */
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
  const list = useMemberCandidates(projectId);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending || userId === "") return;

    // Vòng đời `Idempotency-Key` giữ nguyên: một ý định là **một người, một
    // vai trò**. Đổi người hoặc đổi vai trò là ý định khác nên key xoay; gửi
    // lại y nguyên sau lỗi mạng thì giữ key, và đó là lý do key tồn tại.
    const payload = `${userId}|${role}`;
    if (submitted.current !== undefined && submitted.current !== payload) intent.current.rotate();
    submitted.current = payload;

    mutation.mutate({ userId, role, intent: intent.current }, { onSuccess: onClose });
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
            disabled={userId === ""}
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
            title={messageFor(PROJECT_MEMBER_ERROR, failure)}
            description={`Mã tra cứu: ${failure.requestId}`}
          />
        )}

        <CandidatePicker
          list={list}
          selected={userId}
          onSelect={setUserId}
          disabled={mutation.isPending}
          error={failure === undefined ? undefined : fieldError(failure, "userId")}
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

/**
 * Danh sách ứng viên, chọn được bằng bàn phím.
 *
 * `<fieldset>` + `<input type="radio">` thật, không phải một danh sách `div` có
 * `onClick`. Nhờ vậy nó có sẵn: điều hướng bằng mũi tên, thông báo "1 trong N"
 * cho screen reader, và **focus ring do trình duyệt vẽ trên đúng phần tử nhận
 * focus** — đúng quy tắc `REF-15` của design v0.5. Không có wrapper nào bọc
 * thêm và không chỗ nào tắt `outline` rồi dựng lại: cả hai đều là gỡ một hành
 * vi accessibility có sẵn để vẽ lại nó bằng tay.
 *
 * `userId` **không** hiển thị. Nó là khoá gửi lên, không phải thứ người dùng
 * đọc để nhận ra ai; `email` mới là thứ phân biệt hai người trùng tên.
 */
function CandidatePicker({
  list,
  selected,
  onSelect,
  disabled,
  error,
}: {
  list: MemberCandidates;
  selected: string;
  onSelect: (userId: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const describedBy = error === undefined ? undefined : "project-member-candidate-error";
  const candidates = list.candidates;

  return (
    <fieldset
      style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: "var(--fb-space-2)" }}
      {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
    >
      <legend
        style={{
          padding: 0,
          fontSize: "var(--fb-font-size-body-sm)",
          fontWeight: "var(--fb-font-weight-medium)",
          color: "var(--fb-color-text-primary)",
        }}
      >
        Chọn người để thêm
      </legend>

      {/* Ba trạng thái viết thẳng ở đây thay vì dùng `AsyncSection`, và đó là
          một quyết định chứ không phải một lần quên: `AsyncSection` ánh xạ
          failure sang **màn hình hệ thống** (`SYS-01`, `SYS-05`) kèm nút "Về
          không gian làm việc". Bên trong một hộp thoại, cái nút đó đưa người
          dùng ra khỏi cả ứng dụng trong khi lớp phủ vẫn mở, và một panel cấp
          trang nằm lọt trong modal là sai cấp. Phần còn lại của chính hộp
          thoại này đã báo lỗi bằng `FbAlert` + `messageFor`; đây đi cùng lối
          đó. */}
      {list.failure !== undefined ? (
        <>
          <FbAlert
            intent="error"
            title={messageFor(MEMBER_CANDIDATES_ERROR, list.failure)}
            description={`Mã tra cứu: ${list.failure.requestId}`}
          />
          <div>
            {/* Không có nút này thì đường thoát duy nhất là đóng rồi mở lại hộp
                thoại — một thao tác không ai đoán ra, cho một lỗi thường chỉ là
                mạng chập. */}
            <FbButtonSecondary onClick={list.retry} disabled={disabled}>
              Thử lại
            </FbButtonSecondary>
          </div>
        </>
      ) : list.loading || candidates === undefined ? (
        <FbSkeleton lines={4} label="Đang tải danh sách ứng viên" />
      ) : candidates.length === 0 ? (
        // Rỗng ở đây là **chuyện bình thường** của một workspace nhỏ, không
        // phải lỗi và không phải trạng thái cần sửa. Câu chữ nói đúng hiện
        // trạng và không hứa một hành động mà người đọc có thể không có
        // quyền làm: mời người vào không gian là bề mặt của Quản trị viên
        // không gian, còn màn này chỉ đòi Owner của dự án.
        <FbAlert
          intent="info"
          title="Mọi thành viên của không gian đã ở trong dự án này"
          description="Muốn thêm người mới, họ phải được mời vào không gian làm việc trước."
        />
      ) : (
        <>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--fb-space-1)",
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {candidates.map((candidate) => {
              const active = selected === candidate.userId;
              return (
                <li key={candidate.userId}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--fb-space-3)",
                      padding: "var(--fb-space-3)",
                      borderRadius: "var(--fb-radius-md)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      border: `1px solid ${
                        active ? "var(--fb-color-brand-border)" : "var(--fb-color-border-default)"
                      }`,
                      background: active
                        ? "var(--fb-color-brand-subtle)"
                        : "var(--fb-color-surface-raised)",
                    }}
                  >
                    <input
                      type="radio"
                      name="project-member-candidate"
                      value={candidate.userId}
                      checked={active}
                      disabled={disabled}
                      onChange={() => onSelect(candidate.userId)}
                    />
                    <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: "var(--fb-font-size-body-sm)",
                          fontWeight: "var(--fb-font-weight-semibold)",
                          color: "var(--fb-color-text-strong)",
                        }}
                      >
                        {candidate.displayName}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--fb-font-size-caption)",
                          color: "var(--fb-color-text-muted)",
                        }}
                      >
                        {candidate.email}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {list.hasMore && (
            <div>
              {/* Một trang không phải là hết. Không có nút này thì người
                      thứ hai mươi sáu của workspace không bao giờ chọn được. */}
              <FbButtonSecondary
                onClick={list.loadMore}
                loading={list.loadingMore}
                disabled={disabled}
              >
                Tải thêm ứng viên
              </FbButtonSecondary>
            </div>
          )}
        </>
      )}

      {error !== undefined && (
        <span
          id={describedBy}
          style={{
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-intent-danger-text)",
          }}
        >
          {error}
        </span>
      )}
    </fieldset>
  );
}
