import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { actors, workspace } from "@flowboard/mock";
import { mockRoutes, ok, renderWithProviders, resetNavigation, user } from "./harness.tsx";
import { WorkspaceListScreen } from "../features/workspaces/workspace-list.tsx";
import { AccountSettingsScreen } from "../features/account/account-settings.tsx";

/**
 * Hành vi ở màn hình hẹp.
 *
 * Đây là một trong ba thứ mà artifact không diễn đạt được, nên nó phải được
 * chốt bằng test. Quy tắc từ [hệ thống thiết kế](../../../../docs/design/design-system.md):
 * bố cục mobile **không được** bỏ bớt CTA, state hay thông tin mà bản desktop
 * có — nó chỉ đổi cách sắp xếp.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

/** Ép `matchMedia` trả về đúng một kết quả, để test chọn được viewport. */
function setViewport(compact: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: compact && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("màn hình hẹp — sidebar thành lớp phủ", () => {
  it("sidebar KHÔNG chiếm chỗ cố định, và có nút mở điều hướng", async () => {
    setViewport(true);
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    expect(screen.queryByRole("navigation", { name: "Điều hướng chính" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở điều hướng" })).toBeInTheDocument();
  });

  it("mở điều hướng thì mọi mục vẫn ở đó, không bị cắt bớt", async () => {
    setViewport(true);
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    await user().click(screen.getByRole("button", { name: "Mở điều hướng" }));

    const nav = await screen.findByRole("navigation", { name: "Điều hướng chính" });
    expect(within(nav).getByRole("link", { name: "Không gian làm việc" })).toBeInTheDocument();
  });

  it("bề rộng thường thì sidebar là cột cố định và KHÔNG có nút mở điều hướng", async () => {
    setViewport(false);
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    expect(screen.getByRole("navigation", { name: "Điều hướng chính" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở điều hướng" })).not.toBeInTheDocument();
  });
});

describe("USR-01 vẫn tới được trên màn hình hẹp", () => {
  it("khối người dùng có mặt trong header mobile và mở được menu tài khoản", async () => {
    const actor = user();
    setViewport(true);
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    // Ở chế độ hẹp khối người dùng chỉ còn avatar, nên tên đi vào `aria-label`.
    const block = screen.getByRole("button", { name: actors.ownerB!.displayName });
    expect(block).toHaveAttribute("aria-haspopup", "menu");

    await actor.click(block);
    expect(await screen.findByRole("menu", { name: "Menu tài khoản" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Hồ sơ và tùy chọn/ })).toBeInTheDocument();
  });

  it("tiêu đề trang vẫn là h1 duy nhất ở header mobile", async () => {
    setViewport(true);
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    await screen.findByRole("region", { name: "Tài khoản của bạn" });
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Hồ sơ và tùy chọn");
  });
});
