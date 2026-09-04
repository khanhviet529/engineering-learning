import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import {
  actors,
  capabilitiesByRole,
  columns,
  ids,
  members,
  projectB,
  workspace,
} from "@flowboard/mock";
import { mockRoutes, ok, renderWithProviders, resetNavigation, user } from "./harness.tsx";
import { WorkspaceListScreen } from "../features/workspaces/workspace-list.tsx";
import { ProjectMembersScreen } from "../features/members/project-members.tsx";

/**
 * Accessibility là hợp đồng, không phải phần thêm.
 *
 * Ba thứ được kiểm ở đây vì chúng là những thứ artifact **không diễn đạt
 * được** và vì vậy dễ bị bỏ sót nhất: thứ tự focus của bàn phím, focus trap và
 * focus return của lớp phủ, và tên truy cập được của control chỉ có icon.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app shell điều hướng được bằng bàn phím", () => {
  it("mục nav đang mở có aria-current, không chỉ có màu nền", async () => {
    resetNavigation("/khong-gian-lam-viec");
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    const nav = screen.getByRole("navigation", { name: "Điều hướng chính" });
    const active = within(nav).getByRole("link", { name: "Không gian làm việc" });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("control thu gọn có nhãn truy cập được và phản ánh trạng thái", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    const collapse = screen.getByRole("button", { name: "Thu gọn thanh điều hướng" });
    expect(collapse).toHaveAttribute("aria-pressed", "false");

    await user().click(collapse);

    // Sau khi thu gọn, control đổi nhãn và trạng thái — cùng một control, hai
    // hướng, đúng như đặc tả tương tác yêu cầu.
    const expand = await screen.findByRole("button", { name: "Mở rộng thanh điều hướng" });
    expect(expand).toHaveAttribute("aria-pressed", "true");
  });

  it("sidebar thu gọn vẫn giữ tên của từng mục cho screen reader", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    await user().click(screen.getByRole("button", { name: "Thu gọn thanh điều hướng" }));

    const nav = await screen.findByRole("navigation", { name: "Điều hướng chính" });
    // Nhãn bị ẩn khỏi mắt nhưng **không** bị gỡ khỏi cây accessibility.
    expect(within(nav).getByRole("link", { name: "Không gian làm việc" })).toBeInTheDocument();
  });

  it("nút đổi theme là icon-only nhưng có nhãn", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    expect(
      await screen.findByRole("button", { name: "Đổi giao diện sáng tối" }),
    ).toBeInTheDocument();
  });
});

describe("menu tài khoản — entry point duy nhất của USR-01", () => {
  it("mở từ khối người dùng trên topbar, KHÔNG từ footer sidebar", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    const userBlock = await screen.findByRole("button", { name: /Mai/ });
    expect(userBlock).toHaveAttribute("aria-haspopup", "menu");
    expect(userBlock).toHaveAttribute("aria-expanded", "false");

    await actor.click(userBlock);
    expect(await screen.findByRole("menu", { name: "Menu tài khoản" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Hồ sơ và tùy chọn/ })).toBeInTheDocument();

    // Footer sidebar chỉ có control thu gọn — không có đường thứ hai vào USR-01.
    const nav = screen.getByRole("navigation", { name: "Điều hướng chính" });
    expect(within(nav).queryByRole("link", { name: /Hồ sơ và tùy chọn/ })).not.toBeInTheDocument();
  });

  it("Escape đóng menu và TRẢ FOCUS về chính khối người dùng", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    const userBlock = await screen.findByRole("button", { name: /Mai/ });
    await actor.click(userBlock);
    await screen.findByRole("menu", { name: "Menu tài khoản" });

    await actor.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Mai/ })).toHaveFocus();
  });

  it("mở menu thì focus vào mục đầu tiên, không ở lại nút mở", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await actor.click(await screen.findByRole("button", { name: /Mai/ }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /Hồ sơ và tùy chọn/ })).toHaveFocus();
    });
  });
});

describe("lớp phủ giữ focus và trả focus", () => {
  const detailRoute = `/projects/${ids.projectB}`;

  async function openManageDialog() {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: ok({
        project: projectB,
        capabilities: capabilitiesByRole.owner,
        columns,
        members,
      }),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    await screen.findByRole("table");
    const trigger = screen.getAllByRole("button", { name: "Quản lý" })[0]!;
    await actor.click(trigger);
    const dialog = await screen.findByRole("dialog");
    return { actor, dialog, trigger };
  }

  it("modal có role dialog, aria-modal và được đặt tên bằng chính tiêu đề", async () => {
    const { dialog } = await openManageDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).not.toBeNull();
    expect(document.getElementById(labelId!)?.textContent).toContain("Quản lý");
  });

  it("Tab không đi ra khỏi modal — vòng focus khép kín", async () => {
    const { actor, dialog } = await openManageDialog();

    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);

    // Tab qua đủ số phần tử rồi thêm một lần nữa: focus phải quay lại phần tử
    // đầu, chứ không rơi xuống trang nền.
    for (let step = 0; step < focusables.length + 1; step += 1) {
      await actor.tab();
    }
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape đóng modal và trả focus về đúng nút đã mở nó", async () => {
    const { actor, trigger } = await openManageDialog();

    await actor.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("mở modal thì focus đi vào trong, không ở lại nút mở", async () => {
    const { dialog, trigger } = await openManageDialog();

    expect(trigger).not.toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("bảng thành viên đọc được bằng screen reader", () => {
  it("là table thật, có caption và tiêu đề cột có scope", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [`/projects/${ids.projectB}`]: ok({
        project: projectB,
        capabilities: capabilitiesByRole.owner,
        columns,
        members,
      }),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    const table = await screen.findByRole("table", { name: "Thành viên của dự án" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Thành viên",
      "Vai trò",
      "Phạm vi",
      "Thao tác",
    ]);
    // Mỗi hàng có một `th scope="row"`: tên thành viên là nhãn của hàng đó.
    expect(within(table).getAllByRole("rowheader")).toHaveLength(members.length);
  });
});

describe("đi hết một màn hình chỉ bằng bàn phím", () => {
  it("Tab đi qua shell rồi vào nội dung, theo thứ tự đọc và không có bẫy", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);
    await screen.findByText(workspace.name);

    // Tab lần lượt và ghi lại tên của phần tử đang focus. Không dùng danh sách
    // cứng: điều cần chứng minh là **mọi** control quan trọng đều tới được
    // bằng bàn phím, không phải là chúng nằm ở đúng chỉ số nào.
    const visited: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await actor.tab();
      const active = document.activeElement;
      if (active === null || active === document.body) break;
      visited.push(active.getAttribute("aria-label") ?? (active.textContent ?? "").trim());
    }

    const has = (needle: string) => visited.some((name) => name.includes(needle));

    expect(has("Không gian làm việc")).toBe(true); // nav item
    expect(has("Thu gọn thanh điều hướng")).toBe(true); // footer sidebar
    expect(has("Đổi giao diện sáng tối")).toBe(true); // topbar
    expect(has("Mai")).toBe(true); // khối người dùng — entry point USR-01
    expect(has("Tạo không gian")).toBe(true); // CTA của trang
    expect(has(workspace.name)).toBe(true); // hàng danh sách

    // Không bẫy: focus vẫn di chuyển được, không dừng lại ở một phần tử.
    expect(new Set(visited).size).toBeGreaterThan(4);
  });
});
