import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FbAlert,
  FbButtonPrimary,
  FbButtonSecondary,
  FbChecklistRow,
  FbLink,
  FbPasswordField,
  FbStatePanel,
  FbTextField,
} from "./components.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, trạng thái accessibility và copy. Vì
 * vậy test ở đây kiểm đúng những thứ đó — nhãn nối với input, lỗi được thông
 * báo, link ra ngoài có `rel` an toàn — chứ không kiểm lại Ant Design.
 */

describe("field nối nhãn, hint và lỗi đúng cách", () => {
  it("nhãn trỏ tới input, nên bấm nhãn là focus vào input", async () => {
    const user = userEvent.setup();
    render(<FbTextField id="email" label="Email" value="" onChange={() => {}} />);

    await user.click(screen.getByText("Email"));
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("lỗi được nối bằng aria-describedby và có role alert", () => {
    render(
      <FbTextField
        id="email"
        label="Email"
        value=""
        onChange={() => {}}
        error="Email không hợp lệ."
      />,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("email-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Email không hợp lệ.");
  });

  it("hint cũng được nối, và cùng lúc với lỗi thì cả hai đều được nối", () => {
    render(
      <FbTextField
        id="pw"
        label="Mật khẩu"
        value=""
        onChange={() => {}}
        hint="Ít nhất 12 ký tự."
        error="Quá ngắn."
      />,
    );
    const described = screen.getByLabelText("Mật khẩu").getAttribute("aria-describedby") ?? "";
    expect(described).toContain("pw-hint");
    expect(described).toContain("pw-error");
  });

  it("không có lỗi thì không có aria-invalid true và không có alert", () => {
    render(<FbTextField id="email" label="Email" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gõ vào field gọi onChange với giá trị mới", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FbTextField id="email" label="Email" value="" onChange={onChange} />);

    await user.type(screen.getByLabelText("Email"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("password field cũng nối nhãn và lỗi như text field", () => {
    render(
      <FbPasswordField
        id="pw"
        label="Mật khẩu"
        value=""
        onChange={() => {}}
        error="Mật khẩu quá ngắn."
      />,
    );
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Mật khẩu quá ngắn.");
  });
});

describe("nút", () => {
  it("primary và secondary là hai component tách biệt", async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <>
        <FbButtonPrimary onClick={onPrimary}>Đăng nhập</FbButtonPrimary>
        <FbButtonSecondary onClick={onSecondary}>Huỷ</FbButtonSecondary>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await user.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(onPrimary).toHaveBeenCalledOnce();
    expect(onSecondary).toHaveBeenCalledOnce();
  });

  it("đang loading thì không bấm được — chống submit hai lần", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <FbButtonPrimary loading onClick={onClick}>
        Đang lưu
      </FbButtonPrimary>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled thì không bấm được", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <FbButtonPrimary disabled onClick={onClick}>
        Gửi
      </FbButtonPrimary>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("link ra ngoài luôn an toàn", () => {
  it("link nội bộ không có target hay rel", () => {
    render(<FbLink href="/dang-nhap">Đăng nhập</FbLink>);
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("link ra ngoài LUÔN có rel noopener noreferrer — không có ngoại lệ", () => {
    render(
      <FbLink href="https://example.test" external>
        Tài liệu
      </FbLink>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("alert", () => {
  it("lỗi dùng role alert để được thông báo ngay", () => {
    render(<FbAlert intent="error" title="Không đăng nhập được." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không đăng nhập được.");
  });

  it("thông tin dùng role status để không cắt ngang người dùng", () => {
    render(<FbAlert intent="info" title="Đã gửi thư." />);
    expect(screen.getByRole("status")).toHaveTextContent("Đã gửi thư.");
  });
});

describe("hàng checklist là chỉ báo trạng thái, không nhận tương tác", () => {
  it("không phải nút và không nhận focus", () => {
    render(
      <ul>
        <FbChecklistRow met={false}>Ít nhất 12 ký tự</FbChecklistRow>
      </ul>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("trạng thái được nói thành lời, không chỉ bằng màu và ký hiệu", () => {
    const { rerender } = render(
      <ul>
        <FbChecklistRow met={false}>Ít nhất 12 ký tự</FbChecklistRow>
      </ul>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("chưa đạt");

    rerender(
      <ul>
        <FbChecklistRow met>Ít nhất 12 ký tự</FbChecklistRow>
      </ul>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("đã đạt");
  });
});

describe("state panel", () => {
  it("hiện tiêu đề, mô tả và hành động do Flowboard quyết định", () => {
    render(
      <FbStatePanel
        state="session-expired"
        title="Phiên đã hết hạn"
        description="Vui lòng đăng nhập lại để tiếp tục."
        action={<FbButtonPrimary>Đăng nhập lại</FbButtonPrimary>}
      />,
    );
    expect(screen.getByText("Phiên đã hết hạn")).toBeInTheDocument();
    expect(screen.getByText("Vui lòng đăng nhập lại để tiếp tục.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng nhập lại" })).toBeInTheDocument();
  });
});
