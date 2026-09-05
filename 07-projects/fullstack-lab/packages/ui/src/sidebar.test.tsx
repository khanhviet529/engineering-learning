import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FbSidebar, FbSidebarCollapsed, type FbSidebarItem } from "./sidebar.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, accessibility và variant. Test ở đây
 * kiểm đúng những thứ đó — chứ không kiểm lại Ant Design hay Lucide.
 *
 * Một wrapper **không** được fetch, kiểm role hay gọi API; các test dưới đây
 * chỉ truyền dữ liệu vào và đọc DOM ra, đúng như hợp đồng của package.
 */

const ITEMS: FbSidebarItem[] = [
  { id: "workspaces", label: "Không gian làm việc", icon: "building-2", href: "/w" },
  { id: "projects", label: "Dự án", icon: "folders", href: "/p", active: true },
];

describe("FbSidebar", () => {
  it("là landmark điều hướng có tên", () => {
    render(<FbSidebar items={ITEMS} />);
    expect(screen.getByRole("navigation", { name: "Điều hướng chính" })).toBeInTheDocument();
  });

  it("mục đang mở dùng aria-current, không chỉ dùng màu", () => {
    render(<FbSidebar items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Dự án" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Không gian làm việc" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("footer có control thu gọn ở trạng thái MỞ RỘNG — nếu không thì không có đường vào", async () => {
    const onToggle = vi.fn();
    render(<FbSidebar items={ITEMS} onToggleCollapse={onToggle} />);

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole("button", { name: "Thu gọn thanh điều hướng" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("tên workspace chỉ hiện khi có", () => {
    const { rerender } = render(<FbSidebar items={ITEMS} />);
    expect(screen.queryByText("Micace")).not.toBeInTheDocument();

    rerender(<FbSidebar items={ITEMS} workspaceName="Micace" />);
    expect(screen.getByText("Micace")).toBeInTheDocument();
  });
});

describe("FbSidebarCollapsed", () => {
  it("giữ accessible name của mọi mục dù nhãn bị ẩn khỏi mắt", () => {
    render(<FbSidebarCollapsed items={ITEMS} />);
    const nav = screen.getByRole("navigation", { name: "Điều hướng chính" });

    expect(within(nav).getByRole("link", { name: "Không gian làm việc" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dự án" })).toBeInTheDocument();
  });

  it("cũng có control, và nó nói đúng hướng", () => {
    render(<FbSidebarCollapsed items={ITEMS} />);
    const control = screen.getByRole("button", { name: "Mở rộng thanh điều hướng" });
    expect(control).toHaveAttribute("aria-pressed", "true");
  });
});
