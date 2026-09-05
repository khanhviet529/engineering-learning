import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FbMobileHeader, FbTopbar } from "./topbar.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, accessibility và variant. Test ở đây
 * kiểm đúng những thứ đó — chứ không kiểm lại Ant Design hay Lucide.
 *
 * Một wrapper **không** được fetch, kiểm role hay gọi API; các test dưới đây
 * chỉ truyền dữ liệu vào và đọc DOM ra, đúng như hợp đồng của package.
 */

describe("FbTopbar", () => {
  const base = {
    title: "Bảng công việc",
    user: { displayName: "Nguyễn Khánh", initials: "NK" },
    onOpenAccountMenu: () => {},
    accountMenuOpen: false,
    onToggleTheme: () => {},
  };

  it("tiêu đề là h1 — đúng một điểm neo mỗi trang", () => {
    render(<FbTopbar {...base} />);
    expect(screen.getByRole("heading", { level: 1, name: "Bảng công việc" })).toBeInTheDocument();
  });

  it("khối người dùng khai báo là nút mở menu", () => {
    render(<FbTopbar {...base} />);
    const block = screen.getByRole("button", { name: /Nguyễn Khánh/ });
    expect(block).toHaveAttribute("aria-haspopup", "menu");
    expect(block).toHaveAttribute("aria-expanded", "false");
  });

  it("nút icon-only vẫn có nhãn", () => {
    render(<FbTopbar {...base} />);
    expect(screen.getByRole("button", { name: "Đổi giao diện sáng tối" })).toBeInTheDocument();
  });

  it("nút mở điều hướng chỉ xuất hiện khi chỗ gọi cung cấp handler", () => {
    const { rerender } = render(<FbTopbar {...base} />);
    expect(screen.queryByRole("button", { name: "Mở điều hướng" })).not.toBeInTheDocument();

    rerender(<FbTopbar {...base} onOpenNavigation={() => {}} />);
    expect(screen.getByRole("button", { name: "Mở điều hướng" })).toBeInTheDocument();
  });
});

describe("FbMobileHeader", () => {
  it("chỉ render nút lùi và nút đóng khi có handler tương ứng", () => {
    const { rerender } = render(<FbMobileHeader title="Ghi giờ" />);
    expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đóng" })).not.toBeInTheDocument();

    rerender(<FbMobileHeader title="Ghi giờ" onBack={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Quay lại" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  });
});
