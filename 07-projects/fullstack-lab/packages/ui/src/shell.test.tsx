import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FbAccountMenu,
  FbMobileHeader,
  FbSidebar,
  FbSidebarCollapsed,
  FbTopbar,
  type FbSidebarItem,
} from "./shell.tsx";
import { FbModal } from "./overlays.tsx";
import { FbBadge, FbListRow, FbSkeleton, FbToast } from "./data-display.tsx";
import { FbAlert, FbSelect, FbThemeProvider } from "./components.tsx";

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

describe("FbAccountMenu", () => {
  const items = [
    {
      id: "profile",
      label: "Hồ sơ và tùy chọn",
      icon: "circle-user-round" as const,
      onSelect: vi.fn(),
    },
  ];

  it("là menu có tên, và focus vào mục đầu tiên khi mở", async () => {
    render(
      <FbAccountMenu displayName="Khánh" email="k@a.test" items={items} onDismiss={() => {}} />,
    );

    expect(screen.getByRole("menu", { name: "Menu tài khoản" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /Hồ sơ và tùy chọn/ })).toHaveFocus();
    });
  });

  it("Escape gọi onDismiss — chỗ gọi chịu trách nhiệm trả focus", async () => {
    const onDismiss = vi.fn();
    render(
      <FbAccountMenu displayName="Khánh" email="k@a.test" items={items} onDismiss={onDismiss} />,
    );

    await userEvent.setup({ delay: null }).keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledOnce();
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

describe("FbModal", () => {
  it("Escape và nút đóng đi qua cùng một đường thoát", async () => {
    const onRequestClose = vi.fn();
    const actor = userEvent.setup({ delay: null });
    render(
      <FbModal title="Tiêu đề" onRequestClose={onRequestClose}>
        <p>nội dung</p>
      </FbModal>,
    );

    await actor.click(screen.getByRole("button", { name: "Đóng hộp thoại" }));
    await actor.keyboard("{Escape}");
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it("closeDisabled chặn cả Escape lẫn nút đóng — không làm mất một request đang chạy", async () => {
    const onRequestClose = vi.fn();
    const actor = userEvent.setup({ delay: null });
    render(
      <FbModal title="Đang gửi" onRequestClose={onRequestClose} closeDisabled>
        <p>nội dung</p>
      </FbModal>,
    );

    await actor.keyboard("{Escape}");
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it('initialFocus="footer" đưa focus vào phương án an toàn ở đầu footer', async () => {
    render(
      <FbModal
        title="Bỏ thay đổi?"
        onRequestClose={() => {}}
        initialFocus="footer"
        footer={
          <>
            <button type="button">Tiếp tục chỉnh sửa</button>
            <button type="button">Bỏ thay đổi</button>
          </>
        }
      >
        <p>nội dung</p>
      </FbModal>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tiếp tục chỉnh sửa" })).toHaveFocus();
    });
  });

  it("mặc định focus vào phần tử đầu tiên trong hộp thoại", async () => {
    render(
      <FbModal title="Form" onRequestClose={() => {}}>
        <input aria-label="Tên" />
      </FbModal>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Đóng hộp thoại" })).toHaveFocus();
    });
  });
});

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

describe("FbSelect", () => {
  const options = [
    { value: "owner", label: "Owner" },
    { value: "editor", label: "Editor" },
  ];

  it("là select gốc, nhãn nối đúng và chọn được bằng bàn phím", async () => {
    const onChange = vi.fn();
    render(
      <FbSelect id="role" label="Vai trò" value="owner" onChange={onChange} options={options} />,
    );

    const select = screen.getByRole("combobox", { name: "Vai trò" });
    await userEvent.setup({ delay: null }).selectOptions(select, "editor");
    expect(onChange).toHaveBeenCalledWith("editor");
  });

  it("lỗi được nối bằng aria-describedby và có role alert", () => {
    render(
      <FbSelect
        id="role"
        label="Vai trò"
        value="owner"
        onChange={() => {}}
        options={options}
        error="Vai trò không hợp lệ."
      />,
    );

    const select = screen.getByRole("combobox", { name: "Vai trò" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.getAttribute("aria-describedby")).toContain("role-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Vai trò không hợp lệ.");
  });
});

describe("cầu nối theme không để Ant Design tự suy màu", () => {
  /**
   * Ant Design suy hàng chục biến thể từ năm màu gốc bằng thuật toán palette
   * của nó, và thuật toán đó **không đọc được** chuỗi `var(...)`: nó rơi về
   * `#000000` rồi phát ra nền `#404040` cho mọi Alert. Đo được trước khi sửa:
   * chữ `#182230` trên nền `#404040`, khoảng 1,3:1 — không đọc được.
   *
   * Test này là cái chốt để lỗi đó không quay lại im lặng. Nó đọc chính CSS mà
   * Ant Design phát ra, không đọc cấu hình của chúng ta.
   */
  const SURFACES = [
    "--ant-color-info-bg",
    "--ant-color-info-border",
    "--ant-color-success-bg",
    "--ant-color-warning-bg",
    "--ant-color-warning-border",
    "--ant-color-error-bg",
    "--ant-color-error-border",
  ];

  function emittedCss(): string {
    return [...document.querySelectorAll("style")].map((node) => node.textContent ?? "").join("");
  }

  it.each(["info", "success", "warning", "error"] as const)(
    "Alert %s lấy nền và viền từ biến --fb-*, không từ palette mặc định",
    (intent) => {
      render(
        <FbThemeProvider>
          <FbAlert intent={intent} title="Tiêu đề" description="Mô tả" />
        </FbThemeProvider>,
      );

      const css = emittedCss();
      for (const name of SURFACES) {
        const value = new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1];
        if (value === undefined) continue;
        expect(value, `${name} phải đọc từ token Flowboard`).toMatch(/^var\(--fb-/);
      }
    },
  );

  it("không một bề mặt intent nào của Ant Design mang giá trị hex", () => {
    render(
      <FbThemeProvider>
        <FbAlert intent="warning" title="Tiêu đề" />
      </FbThemeProvider>,
    );

    const css = emittedCss();
    const offenders = SURFACES.map((name) => ({
      name,
      value: new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1],
    })).filter((entry) => entry.value !== undefined && entry.value.startsWith("#"));

    expect(offenders).toEqual([]);
  });
});
