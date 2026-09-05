import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FbBadge, FbListRow, FbSkeleton, FbToast } from "./data-display.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, accessibility và variant. Test ở đây
 * kiểm đúng những thứ đó — chứ không kiểm lại Ant Design hay Lucide.
 *
 * Một wrapper **không** được fetch, kiểm role hay gọi API; các test dưới đây
 * chỉ truyền dữ liệu vào và đọc DOM ra, đúng như hợp đồng của package.
 */

describe("FbListRow", () => {
  it("có href thì CẢ HÀNG là một link duy nhất", () => {
    render(<FbListRow href="/x" primary="Dự án" secondary="Cập nhật hôm nay" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/Dự án/);
  });

  it("không có href thì không phải link", () => {
    render(<FbListRow primary="Chỉ đọc" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("FbBadge và FbToast", () => {
  it("badge luôn mang nhãn chữ, không chỉ màu", () => {
    render(<FbBadge tone="danger">Quá hạn</FbBadge>);
    expect(screen.getByText("Quá hạn")).toBeInTheDocument();
  });

  it("toast lỗi được công bố ngay, toast thành công thì không cắt ngang", () => {
    const { rerender } = render(<FbToast message="Đã lưu." />);
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu.");

    rerender(<FbToast message="Không lưu được." intent="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không lưu được.");
  });
});

describe("FbSkeleton", () => {
  it("nói cho screen reader biết đang tải", () => {
    render(<FbSkeleton lines={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải dữ liệu");
  });
});
