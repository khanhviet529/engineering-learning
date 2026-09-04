import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FbBoardColumn, FbBoardScroller, FbToggle } from "./board.tsx";
import { FbModal } from "./overlays.tsx";

/**
 * Primitive của board. Test ở đây kiểm **hợp đồng của wrapper** — vai trò
 * ARIA, nhãn, khe nội dung — chứ không kiểm lại `BRD-01` hay `BRD-02`; hai màn
 * đó có bộ kiểm riêng ở `apps/web`.
 */

describe("FbToggle", () => {
  function setup(checked = false) {
    const onChange = vi.fn();
    render(
      <FbToggle
        id="terminal"
        label="Cột kết thúc"
        hint="Không áp cho công việc đang có."
        checked={checked}
        onChange={onChange}
      />,
    );
    return { onChange };
  }

  it("là một switch thật, đọc được trạng thái bật/tắt", () => {
    setup(true);
    const toggle = screen.getByRole("switch", { name: "Cột kết thúc" });
    expect(toggle).toBeChecked();
  });

  it("nhãn gắn với control, nên bấm vào chữ cũng bật được", async () => {
    const actor = userEvent.setup({ delay: null });
    const { onChange } = setup(false);

    await actor.click(screen.getByText("Cột kết thúc"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Space bật/tắt được mà không cần chuột", async () => {
    const actor = userEvent.setup({ delay: null });
    const { onChange } = setup(false);

    screen.getByRole("switch", { name: "Cột kết thúc" }).focus();
    await actor.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("gợi ý được nối bằng aria-describedby, không phải chỉ nằm cạnh", () => {
    setup();
    const toggle = screen.getByRole("switch", { name: "Cột kết thúc" });
    const describedBy = toggle.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "Không áp cho công việc đang có.",
    );
  });

  it("disabled thì không phát onChange", async () => {
    const actor = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<FbToggle id="t" label="Cột kết thúc" checked={false} onChange={onChange} disabled />);

    await actor.click(screen.getByRole("switch", { name: "Cột kết thúc" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FbBoardColumn", () => {
  it("là một vùng có tên, với tiêu đề cấp 3", () => {
    render(<FbBoardColumn name="Đang làm" />);
    const heading = screen.getByRole("heading", { name: "Đang làm", level: 3 });
    expect(heading).toBeInTheDocument();
    // Vùng lấy tên từ chính tiêu đề: screen reader liệt kê được các cột và
    // nhảy thẳng tới cột cần đọc thay vì cuộn tuần tự.
    expect(screen.getByRole("region", { name: "Đang làm" })).toBeInTheDocument();
  });

  it("render đủ bốn khe: badge, trạng thái, thẻ và chân cột", () => {
    render(
      <FbBoardColumn
        name="Đang làm"
        badges={<span>Cột kết thúc</span>}
        state={<p>Không tải được cột này.</p>}
        footer={<button type="button">Tải thêm</button>}
      >
        <article>Một công việc</article>
      </FbBoardColumn>,
    );

    const region = screen.getByRole("region", { name: "Đang làm" });
    expect(within(region).getByText("Cột kết thúc")).toBeInTheDocument();
    expect(within(region).getByText("Không tải được cột này.")).toBeInTheDocument();
    expect(within(region).getByText("Một công việc")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Tải thêm" })).toBeInTheDocument();
  });
});

describe("FbBoardScroller", () => {
  /** jsdom báo 0 cho mọi kích thước, nên phép đo tràn phải được dựng tay. */
  function withWidths(scrollWidth: number, clientWidth: number) {
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(scrollWidth);
    const client = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(clientWidth);
    return () => {
      scroll.mockRestore();
      client.mockRestore();
    };
  }

  it("là một nhóm có tên và nhận được focus để cuộn bằng bàn phím", () => {
    const restore = withWidths(0, 0);
    render(
      <FbBoardScroller label="Cột của bảng công việc">
        <div>Cột</div>
      </FbBoardScroller>,
    );
    const group = screen.getByRole("group", { name: "Cột của bảng công việc" });
    expect(group).toHaveAttribute("tabindex", "0");
    restore();
  });

  it("KHÔNG hiện gợi ý cuộn khi nội dung vừa khung", () => {
    const restore = withWidths(500, 900);
    render(
      <FbBoardScroller label="Cột" hint="Cuộn ngang để xem các cột khác">
        <div>Cột</div>
      </FbBoardScroller>,
    );
    // Nói "cuộn ngang" với người đang thấy đủ cột là một chỉ dẫn sai.
    expect(screen.queryByText("Cuộn ngang để xem các cột khác")).not.toBeInTheDocument();
    restore();
  });

  it("hiện gợi ý cuộn khi nội dung tràn", async () => {
    const restore = withWidths(1600, 390);
    render(
      <FbBoardScroller label="Cột" hint="Cuộn ngang để xem các cột khác">
        <div>Cột</div>
      </FbBoardScroller>,
    );
    expect(await screen.findByText("Cuộn ngang để xem các cột khác")).toBeInTheDocument();
    restore();
  });
});

describe("FbModal — Escape khi lớp phủ không được phép đóng", () => {
  it("không đóng, và KHÔNG nuốt phím của widget bên trong", async () => {
    const actor = userEvent.setup({ delay: null });
    const onRequestClose = vi.fn();
    const onInnerEscape = vi.fn();

    render(
      <FbModal title="Quản lý cột" onRequestClose={onRequestClose} closeDisabled>
        <button
          type="button"
          onKeyDown={(event) => {
            if (event.key === "Escape") onInnerEscape();
          }}
        >
          Grip
        </button>
      </FbModal>,
    );

    screen.getByRole("button", { name: "Grip" }).focus();
    await actor.keyboard("{Escape}");

    expect(onRequestClose).not.toHaveBeenCalled();
    // Listener của lớp phủ chạy ở pha **capture** trên `document`, tức là
    // trước mọi handler con. Nếu nó `stopPropagation` vô điều kiện thì một
    // thao tác đang dở bên trong sẽ mất phím hủy của chính nó.
    expect(onInnerEscape).toHaveBeenCalledTimes(1);
  });

  it("vẫn đóng bình thường khi không bị khóa", async () => {
    const actor = userEvent.setup({ delay: null });
    const onRequestClose = vi.fn();
    render(
      <FbModal title="Quản lý cột" onRequestClose={onRequestClose}>
        <button type="button">Grip</button>
      </FbModal>,
    );

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(onRequestClose).toHaveBeenCalledTimes(1);
    });
  });
});
