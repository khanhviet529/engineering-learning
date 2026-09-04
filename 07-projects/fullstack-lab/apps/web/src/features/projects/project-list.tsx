"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { FbAlert, FbButtonPrimary, FbListRow, FbPageSection, FbTextField } from "@flowboard/ui";
import { AppShell } from "../navigation/app-shell.tsx";
import { AsyncSection } from "../system/async-section.tsx";
import { can } from "../authorization/can.ts";
import { useWorkspaces } from "../workspaces/queries.ts";
import { useWorkspaceProjects } from "./queries.ts";
import { CreateProjectDialog } from "./create-project-dialog.tsx";

/**
 * `PRJ-01` — danh sách dự án mà actor được phép đọc trong một workspace.
 *
 * Thẻ dự án ở đây chỉ hiển thị những gì hợp đồng công bố cho một `Project`:
 * tên và thời điểm cập nhật. Artifact vẽ thêm "4 thành viên · Bạn là Owner" và
 * "12 công việc đang mở", nhưng không projection nào chứa các số đó — xem ghi
 * chú lệch artifact trong báo cáo M2.
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

  // Lọc theo tên ngay trên client: danh sách này chưa có endpoint, nên cũng
  // chưa có hợp đồng filter phía server. Khi route thật xuất hiện kèm allowlist
  // query, phép lọc chuyển sang server và cursor được reset theo đúng hợp đồng.
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
                      href={`/du-an/${project.id}/thanh-vien`}
                      primary={project.name}
                      secondary={`Cập nhật ${new Date(project.updatedAt).toLocaleDateString("vi-VN")}`}
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
