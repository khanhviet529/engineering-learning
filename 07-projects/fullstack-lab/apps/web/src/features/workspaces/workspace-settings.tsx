"use client";

import { FbAlert, FbBadge, FbPageSection, FbSkeleton } from "@flowboard/ui";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState, SystemState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { useWorkspaces } from "./queries.ts";

/**
 * `WSP-04` — cài đặt không gian làm việc.
 *
 * Màn này **cố ý không có form**. [Danh mục màn hình](../../../../../docs/design/screen-inventory.md)
 * ghi rõ: trường chỉnh sửa chỉ xuất hiện khi hợp đồng dữ liệu đã xác định, và
 * ở baseline hiện tại chưa có trường nào — `workspaceSchema` chỉ có `id`,
 * `name`, `role` và `capabilities`, còn nhóm workspace không có route `PATCH`.
 *
 * Vẽ ra một form không lưu được sẽ tệ hơn là nói thẳng phạm vi: người dùng gõ
 * vào rồi mất công. Vì vậy màn hình hiển thị metadata đọc được, capability
 * server đã tính, và nói rõ điều gì còn thiếu.
 */
export function WorkspaceSettingsScreen({ workspaceId }: { workspaceId: string }) {
  const { workspaces, loading, failure, refetch } = useWorkspaces();
  const workspace = workspaces?.find((item) => item.id === workspaceId);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Cài đặt không gian"
      breadcrumb={workspace?.name}
      workspaceId={workspaceId}
      {...(workspace === undefined ? {} : { workspaceCapabilities: workspace.capabilities })}
      {...(workspace === undefined ? {} : { workspaceName: workspace.name })}
    >
      {children}
    </AppShell>
  );

  if (failure !== undefined) return shell(<FailureState failure={failure} onRetry={refetch} />);
  if (loading) return shell(<FbSkeleton lines={3} />);

  // Danh sách đã tải xong mà không có workspace này: actor không phải thành
  // viên, hoặc nó không tồn tại. Hai khả năng đó **không** được phân biệt cho
  // người dùng, nên đây là `SYS-05` chứ không phải `SYS-01`.
  if (workspace === undefined) return shell(<SystemState screen="SYS-05" />);

  if (!can("workspace:settings:update", workspace)) {
    return shell(<SystemState screen="SYS-01" backHref={`/khong-gian-lam-viec/${workspaceId}`} />);
  }

  return shell(
    <FbPageSection
      heading="Thiết lập không gian"
      description="Chỉ Quản trị viên không gian mở được trang này."
    >
      <dl style={{ display: "grid", gap: "var(--fb-space-3)", margin: 0 }}>
        <div style={{ display: "flex", gap: "var(--fb-space-4)", flexWrap: "wrap" }}>
          <dt style={{ minWidth: 160, color: "var(--fb-color-text-muted)" }}>Tên không gian</dt>
          <dd style={{ margin: 0, fontWeight: "var(--fb-font-weight-semibold)" }}>
            {workspace.name}
          </dd>
        </div>
        <div style={{ display: "flex", gap: "var(--fb-space-4)", flexWrap: "wrap" }}>
          <dt style={{ minWidth: 160, color: "var(--fb-color-text-muted)" }}>Vai trò của bạn</dt>
          <dd style={{ margin: 0 }}>
            <FbBadge tone="brand">
              {workspace.role === "workspace_admin" ? "Quản trị viên không gian" : "Thành viên"}
            </FbBadge>
          </dd>
        </div>
        <div style={{ display: "flex", gap: "var(--fb-space-4)", flexWrap: "wrap" }}>
          <dt style={{ minWidth: 160, color: "var(--fb-color-text-muted)" }}>
            Quyền server đã cấp
          </dt>
          <dd style={{ margin: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {workspace.capabilities.map((capability) => (
              <FbBadge key={capability} tone="neutral">
                {capability}
              </FbBadge>
            ))}
          </dd>
        </div>
      </dl>

      <FbAlert
        intent="warning"
        title="Phạm vi cấu hình đang được giới hạn có chủ đích"
        description="Baseline chưa định nghĩa trường nào của không gian có thể sửa, nên chưa có form và chưa có nút lưu. Khi hợp đồng dữ liệu bổ sung trường, form sẽ xuất hiện đúng ở đây."
      />
    </FbPageSection>,
  );
}
