import { describe, expect, it } from "vitest";
import type { Permission } from "@flowboard/contracts";
import { capabilitiesByRole } from "@flowboard/mock";
import { navItemsFor } from "./nav-items.ts";

/**
 * Điều hướng phải suy từ capability, không từ role.
 *
 * Test này là chỗ bắt được việc ai đó viết `if (role === "owner")`: khi nav
 * đọc capability thật, một Owner **không có** capability sẽ không thấy mục
 * tương ứng, và một Editor **có** capability thì sẽ thấy.
 */

const ids = (items: { id: string }[]) => items.map((item) => item.id);

const wsAdmin: readonly Permission[] = [
  "workspace:read",
  "workspace:member:manage",
  "workspace:settings:update",
  "project:create",
];
const wsMember: readonly Permission[] = ["workspace:read"];

describe("mục cấp workspace theo capability", () => {
  it("chưa chọn workspace thì chỉ có một mục", () => {
    expect(ids(navItemsFor({ pathname: "/khong-gian-lam-viec" }))).toEqual(["workspaces"]);
  });

  it("Workspace Admin thấy thành viên và cài đặt không gian", () => {
    const items = ids(
      navItemsFor({ pathname: "/", workspaceId: "w1", workspaceCapabilities: wsAdmin }),
    );
    expect(items).toContain("workspace-members");
    expect(items).toContain("workspace-settings");
  });

  it("Workspace Member KHÔNG thấy hai mục đó", () => {
    const items = ids(
      navItemsFor({ pathname: "/", workspaceId: "w1", workspaceCapabilities: wsMember }),
    );
    expect(items).toContain("projects");
    expect(items).not.toContain("workspace-members");
    expect(items).not.toContain("workspace-settings");
  });
});

describe("mục cấp project theo capability, không theo role", () => {
  it("Owner của project thấy Thành viên và Cài đặt dự án", () => {
    const items = ids(
      navItemsFor({
        pathname: "/",
        workspaceId: "w1",
        project: { id: "p1", capabilities: capabilitiesByRole.owner as readonly Permission[] },
      }),
    );
    expect(items).toContain("project-members");
    expect(items).toContain("project-settings");
  });

  it("Editor KHÔNG thấy hai mục đó", () => {
    const items = ids(
      navItemsFor({
        pathname: "/",
        workspaceId: "w1",
        project: { id: "p1", capabilities: capabilitiesByRole.editor as readonly Permission[] },
      }),
    );
    expect(items).not.toContain("project-members");
    expect(items).not.toContain("project-settings");
  });

  it("Viewer KHÔNG thấy hai mục đó", () => {
    const items = ids(
      navItemsFor({
        pathname: "/",
        workspaceId: "w1",
        project: { id: "p1", capabilities: capabilitiesByRole.viewer as readonly Permission[] },
      }),
    );
    expect(items).not.toContain("project-members");
    expect(items).not.toContain("project-settings");
  });

  it("capability quyết định chứ không phải tên vai trò: cấp thẳng một capability thì mục hiện ra", () => {
    // Không có role nào ở đây — chỉ một capability đơn lẻ.
    const items = ids(
      navItemsFor({
        pathname: "/",
        workspaceId: "w1",
        project: { id: "p1", capabilities: ["project:update"] },
      }),
    );
    // `my-tasks` không gác bằng capability project nào: `MYT-01` là màn cấp
    // workspace, và endpoint của nó chỉ đòi membership workspace. Ai thấy được
    // workspace này thì đã có điều kiện đó.
    expect(items).toEqual(["workspaces", "projects", "my-tasks", "project-settings"]);
  });
});

describe("mục đang mở được đánh dấu", () => {
  it("active đúng theo pathname", () => {
    const items = navItemsFor({ pathname: "/khong-gian-lam-viec/w1", workspaceId: "w1" });
    expect(items.find((item) => item.id === "projects")?.active).toBe(true);
    expect(items.find((item) => item.id === "workspaces")?.active).toBe(false);
  });
});
