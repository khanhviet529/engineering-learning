import type { Permission } from "@flowboard/contracts";
import type { FbSidebarItem } from "@flowboard/ui";
import { can, type CapabilityHolder } from "../authorization/can.ts";

/**
 * Điều hướng được suy từ **capability server trả về**, không từ role.
 *
 * `if (role === "owner")` trong page là duplicate policy — thứ mà
 * [mô hình phân quyền](../../../../../docs/security/authorization-model.md) cấm.
 * Ở đây mỗi mục khai đúng permission mà nó cần, rồi `can` quyết định.
 *
 * Ẩn một mục **không phải** là phân quyền: route trực tiếp vẫn phải đi tới
 * `SYS-01`/`SYS-05` và API vẫn là lớp kiểm cuối cùng. Ẩn chỉ để người dùng
 * không bấm vào thứ chắc chắn bị từ chối.
 */

export interface NavContext {
  /** Workspace đang mở; bỏ trống khi actor mới chỉ ở danh sách workspace. */
  workspaceId?: string | undefined;
  /** Project đang mở, kèm capabilities server tính cho actor trên chính nó. */
  project?: { id: string; capabilities: readonly Permission[] } | undefined;
  /** Capability ở cấp workspace, lấy từ projection của workspace đang mở. */
  workspaceCapabilities?: readonly Permission[] | undefined;
  /** Đường dẫn hiện tại, để đánh dấu mục đang mở. */
  pathname: string;
}

/**
 * Chỉ liệt kê những mục mà **route đã tồn tại ở mốc này**.
 *
 * Artifact `REF-05` vẽ đủ bảy mục, trong đó `Tổng quan` (`PRJ-04`) và
 * `Việc của tôi` (`MYT-01`) vẫn thuộc M4. Một mục nav dẫn tới `404` tệ hơn một
 * mục chưa xuất hiện: nó dạy người dùng rằng điều hướng không đáng tin. Chúng
 * được thêm lại ở đúng mốc dựng màn hình đó.
 *
 * `Bảng công việc` (`BRD-01`) đã có route từ M3 nên nó xuất hiện ở đây.
 */
export function navItemsFor(context: NavContext): FbSidebarItem[] {
  const { workspaceId, project, pathname } = context;
  const items: FbSidebarItem[] = [];
  const workspaceHolder: CapabilityHolder = { capabilities: context.workspaceCapabilities };
  const projectHolder: CapabilityHolder | undefined =
    project === undefined ? undefined : { capabilities: project.capabilities };

  items.push({
    id: "workspaces",
    label: "Không gian làm việc",
    icon: "building-2",
    href: "/khong-gian-lam-viec",
    active: pathname === "/khong-gian-lam-viec",
  });

  if (workspaceId !== undefined) {
    const projectsHref = `/khong-gian-lam-viec/${workspaceId}`;
    items.push({
      id: "projects",
      label: "Dự án",
      icon: "folders",
      href: projectsHref,
      active: pathname === projectsHref,
    });

    // `MYT-01` là màn **cấp workspace nhưng không thuộc project nào**, nên nó
    // đứng cạnh `Dự án` chứ không trong nhóm project. Không có capability
    // riêng để gác: endpoint chỉ đòi membership workspace, và ai thấy được
    // workspace này thì đã có nó.
    items.push({
      id: "my-tasks",
      label: "Việc của tôi",
      icon: "calendar-days",
      href: `/viec-cua-toi?workspace=${workspaceId}`,
      active: pathname === "/viec-cua-toi",
    });

    if (can("workspace:member:manage", workspaceHolder)) {
      const href = `${projectsHref}/thanh-vien`;
      items.push({
        id: "workspace-members",
        label: "Thành viên không gian",
        icon: "users",
        href,
        active: pathname === href,
      });
    }

    if (can("workspace:settings:update", workspaceHolder)) {
      const href = `${projectsHref}/cai-dat`;
      items.push({
        id: "workspace-settings",
        label: "Cài đặt không gian",
        icon: "settings",
        href,
        active: pathname === href,
      });
    }
  }

  if (project !== undefined) {
    // `PRJ-04` chỉ đọc aggregate đã được authorize, nên nó mở cho cả ba vai
    // trò project — cùng quyền với việc đọc task, vì đó chính là những task đó
    // đã được đếm.
    if (can("task:read", projectHolder)) {
      const href = `/du-an/${project.id}/tong-quan`;
      items.push({
        id: "project-overview",
        label: "Tổng quan",
        icon: "gauge",
        href,
        active: pathname === href,
      });
    }

    // Đọc board là `project:read`, không phải `board-column:*`: Viewer thấy
    // bảng, chỉ không cấu hình được cột. Gắn mục nav vào quyền quản lý cột sẽ
    // giấu cả bảng khỏi hai trong ba vai trò.
    if (can("project:read", projectHolder)) {
      const href = `/du-an/${project.id}/bang-cong-viec`;
      items.push({
        id: "project-board",
        label: "Bảng công việc",
        icon: "columns-3",
        href,
        active: pathname === href,
      });
    }

    if (can("project:member:manage", projectHolder)) {
      const href = `/du-an/${project.id}/thanh-vien`;
      items.push({
        id: "project-members",
        label: "Thành viên dự án",
        icon: "users",
        href,
        active: pathname === href,
      });
    }

    if (can("project:update", projectHolder)) {
      const href = `/du-an/${project.id}/cai-dat`;
      items.push({
        id: "project-settings",
        label: "Cài đặt dự án",
        icon: "settings",
        href,
        active: pathname === href,
      });
    }
  }

  return items;
}
