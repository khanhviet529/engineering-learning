"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FbAlert, FbBadge, FbButtonPrimary, FbListRow, FbPageSection } from "@flowboard/ui";
import { AppShell } from "../navigation/app-shell.tsx";
import { AsyncSection } from "../system/async-section.tsx";
import { can } from "../authorization/can.ts";
import { useWorkspaces } from "./queries.ts";
import { CreateWorkspaceDialog } from "./create-workspace-dialog.tsx";

/**
 * `WSP-01` — chọn workspace mà actor là thành viên.
 *
 * Hai ràng buộc quyền riêng tư ở màn này, cả hai đến từ
 * [hợp đồng endpoint](../../../../../docs/api/endpoint-contracts.md):
 *
 * 1. Danh sách **chỉ** gồm workspace mà actor là member. Rỗng nghĩa là rỗng,
 *    không suy ra rằng có workspace khác đang ẩn.
 * 2. `GET /workspaces` **không** trả tên, số lượng hay metadata của project
 *    riêng tư. Vì vậy thẻ workspace ở đây không hiển thị số dự án — xem ghi
 *    chú lệch artifact trong báo cáo M2.
 */
export function WorkspaceListScreen() {
  const pathname = usePathname();
  const { workspaces, loading, failure, refetch } = useWorkspaces();
  const [creating, setCreating] = useState(false);

  return (
    <AppShell title="Không gian làm việc" pathname={pathname ?? "/khong-gian-lam-viec"}>
      <FbPageSection
        heading="Chọn không gian làm việc"
        description="Bạn chỉ thấy các không gian mà mình là thành viên."
        action={
          // Quyền tạo workspace là **policy của server**, không suy từ role.
          // Khi chưa có workspace nào để đọc capability, CTA vẫn hiện: server
          // là nơi từ chối, và giấu nó sẽ chặn đúng người vừa được cấp quyền.
          <FbButtonPrimary onClick={() => setCreating(true)}>Tạo không gian</FbButtonPrimary>
        }
      >
        <AsyncSection
          loading={loading}
          failure={failure}
          data={workspaces}
          onRetry={refetch}
          skeletonLines={3}
        >
          {(items) =>
            items.length === 0 ? (
              <FbAlert
                intent="info"
                title="Bạn chưa thuộc không gian làm việc nào"
                description="Hãy tạo một không gian mới, hoặc đề nghị quản trị viên của một không gian thêm bạn vào."
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
                {items.map((workspace) => (
                  <li key={workspace.id}>
                    <FbListRow
                      href={`/khong-gian-lam-viec/${workspace.id}`}
                      primary={workspace.name}
                      secondary={
                        workspace.role === "workspace_admin"
                          ? "Bạn là Quản trị viên không gian"
                          : "Bạn là thành viên"
                      }
                      trailing={
                        can("project:create", workspace) ? (
                          <FbBadge tone="brand">Tạo được dự án</FbBadge>
                        ) : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )
          }
        </AsyncSection>

        <FbAlert
          intent="info"
          title="Dự án riêng tư không xuất hiện chỉ vì bạn ở trong không gian"
          description="Bạn phải được thêm vào từng dự án với một vai trò cụ thể mới đọc được nội dung của nó."
        />
      </FbPageSection>

      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </AppShell>
  );
}
