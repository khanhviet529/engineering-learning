"use client";

import { useRef, useState } from "react";
import {
  FbAlert,
  FbBadge,
  FbButtonPrimary,
  FbButtonSecondary,
  FbDataTable,
  FbModal,
  type FbDataTableColumn,
  type FbDataTableRow,
} from "@flowboard/ui";
import type { PendingInvitation, WorkspaceRole } from "@flowboard/contracts";
import { AsyncSection } from "../system/async-section.tsx";
import { Intent } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { messageFor } from "../system/messages.ts";
import { INVITATION_REVOKE_ERROR } from "./messages.ts";
import { useRevokeInvitation, useWorkspaceInvitations } from "./queries.ts";

/**
 * Lời mời đang chờ của một không gian làm việc — phần thứ hai của `WSP-03`.
 *
 * Vì sao đây là **một bảng riêng**, không phải thêm vài hàng vào bảng thành
 * viên: hai danh sách nói hai điều khác nhau. Một thành viên **đã có** quyền ở
 * không gian này. Một lời mời `pending` **chưa cấp gì cả** — nó chỉ là một lá
 * thư đang nằm trong hộp thư của ai đó, và cho tới khi được chấp nhận thì
 * `workspace_members` không có dòng nào cho người đó.
 *
 * Gộp chúng lại rồi phân biệt bằng một cột "trạng thái" sẽ để lại đúng ấn
 * tượng sai: rằng mời là một cách thêm người, chỉ hơi chậm. Đó cũng là ấn
 * tượng khiến người quản trị tưởng đã cấp xong quyền cho một người thật ra
 * chưa vào.
 */

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  workspace_admin: "Quản trị viên không gian",
  workspace_member: "Thành viên",
};

const COLUMNS: FbDataTableColumn[] = [
  { key: "email", header: "Email được mời" },
  { key: "role", header: "Vai trò khi tham gia" },
  { key: "invitedBy", header: "Người mời" },
  { key: "createdAt", header: "Ngày mời" },
  { key: "expiresAt", header: "Hết hạn" },
  { key: "actions", header: "Thao tác" },
];

function formatDate(instant: string): string {
  return new Date(instant).toLocaleDateString("vi-VN");
}

export function WorkspaceInvitationsSection({
  workspaceId,
  enabled,
  onRevoked,
}: {
  workspaceId: string;
  enabled: boolean;
  /** Báo kết quả ra vùng live region của màn hình, không tự dựng vùng thứ hai. */
  onRevoked: (email: string) => void;
}) {
  const { invitations, loading, failure, refetch } = useWorkspaceInvitations(workspaceId, enabled);

  return (
    <AsyncSection
      loading={loading}
      failure={failure}
      data={invitations}
      onRetry={refetch}
      skeletonLines={3}
    >
      {(items) =>
        items.length === 0 ? (
          <FbAlert
            intent="info"
            title="Không có lời mời nào đang chờ"
            description="Lời mời đã được chấp nhận sẽ biến mất khỏi đây và người đó xuất hiện ở danh sách thành viên."
          />
        ) : (
          <FbDataTable
            caption="Lời mời đang chờ chấp nhận"
            minWidth={720}
            columns={COLUMNS}
            rows={items.map<FbDataTableRow>((invitation) => ({
              id: invitation.id,
              cells: [
                invitation.email,
                <FbBadge
                  key="role"
                  tone={invitation.role === "workspace_admin" ? "brand" : "neutral"}
                >
                  {ROLE_LABEL[invitation.role]}
                </FbBadge>,
                invitation.invitedBy.displayName,
                formatDate(invitation.createdAt),
                formatDate(invitation.expiresAt),
                <RevokeInvitationButton
                  key="revoke"
                  workspaceId={workspaceId}
                  invitation={invitation}
                  onRevoked={onRevoked}
                />,
              ],
            }))}
          />
        )
      }
    </AsyncSection>
  );
}

/**
 * Thu hồi một lời mời.
 *
 * Có xác nhận trước khi gửi vì thu hồi **có hiệu lực ngay** và không hoàn tác
 * được: token trong thư chết kể từ lúc commit, và người nhận không được báo gì.
 * Muốn mời lại thì phải gửi một lời mời mới, tức là một thư khác.
 */
function RevokeInvitationButton({
  workspaceId,
  invitation,
  onRevoked,
}: {
  workspaceId: string;
  invitation: PendingInvitation;
  onRevoked: (email: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Một `Intent` cho mỗi lời mời: thu hồi lời mời này là một ý định khác với
  // thu hồi lời mời kia, nên chúng không được dùng chung key.
  const intent = useRef(new Intent());
  const mutation = useRevokeInvitation(workspaceId);
  const failure = toFailure(mutation.error);

  return (
    <>
      <FbButtonSecondary onClick={() => setConfirming(true)} disabled={mutation.isPending}>
        Thu hồi
      </FbButtonSecondary>

      {confirming && (
        <FbModal
          title="Thu hồi lời mời này?"
          subtitle={`Liên kết đã gửi tới ${invitation.email} sẽ không dùng được nữa. Muốn mời lại, bạn phải gửi một lời mời mới.`}
          onRequestClose={() => setConfirming(false)}
          closeDisabled={mutation.isPending}
          initialFocus="footer"
          footer={
            <>
              {/* Phương án an toàn là mặc định: giữ nguyên lời mời. */}
              <FbButtonSecondary onClick={() => setConfirming(false)} disabled={mutation.isPending}>
                Giữ lời mời
              </FbButtonSecondary>
              <FbButtonPrimary
                loading={mutation.isPending}
                onClick={() => {
                  mutation.mutate(
                    { invitationId: invitation.id, intent: intent.current },
                    {
                      onSuccess: () => {
                        setConfirming(false);
                        onRevoked(invitation.email);
                      },
                    },
                  );
                }}
              >
                Thu hồi lời mời
              </FbButtonPrimary>
            </>
          }
        >
          {failure !== undefined && (
            <FbAlert
              intent="error"
              title={messageFor(INVITATION_REVOKE_ERROR, failure)}
              description={`Mã tra cứu: ${failure.requestId}`}
            />
          )}
          <p style={{ margin: 0, fontSize: "var(--fb-font-size-body)" }}>
            Người được mời không nhận thông báo nào về việc này.
          </p>
        </FbModal>
      )}
    </>
  );
}
