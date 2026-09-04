"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FbAlert,
  FbBadge,
  FbButtonPrimary,
  FbListRow,
  FbPageSection,
  FbTextField,
} from "@flowboard/ui";
import type { ProjectRole } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { AsyncSection } from "../system/async-section.tsx";
import { can } from "../authorization/can.ts";
import { useWorkspaces } from "../workspaces/queries.ts";
import { useWorkspaceProjects } from "./queries.ts";
import { CreateProjectDialog } from "./create-project-dialog.tsx";

/**
 * Nhãn vai trò dùng đúng ba tên cố định của hợp đồng, kèm phần giải nghĩa mà
 * bàn giao Pencil đã chốt: `Owner · Chủ sở hữu`, `Editor · Có thể chỉnh sửa`,
 * `Viewer · Chỉ xem`.
 */
const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner · Chủ sở hữu",
  editor: "Editor · Có thể chỉnh sửa",
  viewer: "Viewer · Chỉ xem",
};

const ROLE_TONE: Record<ProjectRole, "brand" | "info" | "neutral"> = {
  owner: "brand",
  editor: "info",
  viewer: "neutral",
};

/**
 * `PRJ-01` — danh sách dự án mà actor được phép đọc trong một workspace.
 *
 * Hàng dự án hiển thị đúng những gì `projectListItemSchema` công bố: tên, thời
 * điểm cập nhật, và **vai trò của chính actor** trong dự án đó. Artifact vẽ
 * thêm "4 thành viên" và "12 công việc đang mở"; hợp đồng cố ý không trả hai
 * số đó, vì suy chúng ra từ dữ liệu actor không được đọc chính là cách rò rỉ.
 *
 * Danh sách rỗng **không** suy ra rằng workspace không có dự án nào: nó chỉ
 * nói rằng actor chưa là thành viên của dự án nào ở đây.
 */
export function ProjectListScreen({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { workspaces } = useWorkspaces();
  const workspace = workspaces?.find((item) => item.id === workspaceId);
  const { projects, loading, failure, refetch } = useWorkspaceProjects(workspaceId);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  // Lọc theo tên ngay trên client, và đó là chỗ đúng của nó: query của
  // `GET /workspaces/:workspaceId/projects` **chỉ** có `cursor` và `limit`.
  // Hợp đồng cố ý không mở trục lọc nào, vì mỗi trục là một cách dò xem
  // project nào tồn tại. Danh sách này đã bị giới hạn theo membership nên nó
  // đủ nhỏ để lọc tại chỗ.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (projects === undefined) return undefined;
    if (needle === "") return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(needle));
  }, [projects, search]);

  const canCreate = can("project:create", workspace);

  return (
    <AppShell
      title="Dự án"
      breadcrumb={workspace?.name}
      pathname={pathname ?? ""}
      workspaceId={workspaceId}
      {...(workspace === undefined ? {} : { workspaceCapabilities: workspace.capabilities })}
      {...(workspace === undefined ? {} : { workspaceName: workspace.name })}
    >
      <FbPageSection
        heading="Dự án bạn có thể truy cập"
        description="Chỉ hiển thị dự án riêng tư mà bạn là thành viên."
        action={
          canCreate ? (
            <FbButtonPrimary onClick={() => setCreating(true)}>Tạo dự án</FbButtonPrimary>
          ) : undefined
        }
      >
        <FbTextField
          id="project-search"
          label="Tìm dự án"
          value={search}
          onChange={setSearch}
          hint="Lọc theo tên trong danh sách bạn được phép đọc."
        />

        <AsyncSection
          loading={loading}
          failure={failure}
          data={visible}
          onRetry={refetch}
          skeletonLines={3}
        >
          {(items) =>
            items.length === 0 ? (
              <FbAlert
                intent="info"
                title={
                  search.trim() === ""
                    ? "Bạn chưa là thành viên của dự án nào trong không gian này"
                    : "Không có dự án nào khớp từ khoá"
                }
                description={
                  search.trim() === ""
                    ? canCreate
                      ? "Tạo một dự án mới; người tạo trở thành Owner của dự án đó."
                      : "Đề nghị Owner của dự án thêm bạn vào với vai trò phù hợp."
                    : "Xoá bớt từ khoá để xem lại toàn bộ danh sách."
                }
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
                {items.map((project) => (
                  <li key={project.id}>
                    <FbListRow
                      // Ở M2, bề mặt duy nhất bên trong một dự án là `PRM-01`,
                      // và nó là Owner-only theo kiến trúc thông tin. Vì vậy
                      // hàng chỉ là link khi actor là Owner — dẫn hai vai trò
                      // còn lại vào một trang `403` là biết trước mà vẫn đưa
                      // người ta tới đó. Khi `BRD-01` có ở M3, mọi vai trò đều
                      // có đích và điều kiện này biến mất.
                      {...(project.role === "owner"
                        ? { href: `/du-an/${project.id}/thanh-vien` }
                        : {})}
                      primary={project.name}
                      secondary={`Cập nhật ${new Date(project.updatedAt).toLocaleDateString("vi-VN")}`}
                      trailing={
                        <FbBadge tone={ROLE_TONE[project.role]}>{ROLE_LABEL[project.role]}</FbBadge>
                      }
                    />
                  </li>
                ))}
              </ul>
            )
          }
        </AsyncSection>
      </FbPageSection>

      {creating && (
        <CreateProjectDialog
          workspaceId={workspaceId}
          workspaceName={workspace?.name}
          onClose={() => setCreating(false)}
        />
      )}
    </AppShell>
  );
}
