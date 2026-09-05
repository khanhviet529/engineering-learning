import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FbActivityItem, FbDueBadge, FbTabs, FbTaskCard } from "./task.tsx";
import { FbDrawer } from "./overlays.tsx";
import { FbDateField, FbTextArea } from "./components.tsx";

/**
 * Primitive của M4. Test ở đây kiểm **hợp đồng của wrapper** — vai trò ARIA,
 * tên truy cập được, khe nội dung — chứ không kiểm lại `BRD-01` hay `TSK-02`.
 */

describe("FbDueBadge", () => {
  it("mỗi trạng thái có nhãn CHỮ, không chỉ có màu", () => {
    // Hệ thống thiết kế cấm màu là kênh truyền nghĩa duy nhất.
    for (const [state, label] of [
      ["overdue", "Quá hạn"],
      ["due_today", "Đến hạn hôm nay"],
      ["due_soon", "Sắp đến hạn"],
      ["scheduled", "Đã lên lịch"],
    ] as const) {
      const view = render(<FbDueBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("`none` không render gì — không có hạn thì không có gì để nói", () => {
    const { container } = render(<FbDueBadge state="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("kèm ngày khi chỗ gọi truyền vào", () => {
    render(<FbDueBadge state="overdue" date="31/08/2026" />);
    expect(screen.getByText("Quá hạn · 31/08/2026")).toBeInTheDocument();
  });
});

describe("FbTaskCard", () => {
  it("tiêu đề là một nút thật, mở được bằng bàn phím", async () => {
    const actor = userEvent.setup({ delay: null });
    const onOpen = vi.fn();
    render(<FbTaskCard title="Chuẩn hoá hợp đồng lỗi" onOpen={onOpen} />);

    const button = screen.getByRole("button", { name: "Chuẩn hoá hợp đồng lỗi" });
    button.focus();
    await actor.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("không có tay kéo khi chỗ gọi không truyền — đúng những gì Viewer thấy", () => {
    render(<FbTaskCard title="A" onOpen={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("avatar mang tên đầy đủ, vì hai chữ cái không nói được ai", () => {
    render(<FbTaskCard title="A" onOpen={() => {}} assigneeInitials="AT" assigneeName="An Tran" />);
    expect(screen.getByRole("img", { name: "Người thực hiện: An Tran" })).toBeInTheDocument();
  });

  it("đang đồng bộ thì nói ra bằng chữ", () => {
    render(<FbTaskCard title="A" onOpen={() => {}} syncing />);
    expect(screen.getByText("Đang đồng bộ vị trí mới…")).toBeInTheDocument();
  });
});

describe("FbActivityItem", () => {
  it("là một mục danh sách có thông điệp và siêu dữ liệu", () => {
    render(
      <ul>
        <FbActivityItem
          icon="rotate-cw"
          message="An Tran đã mở lại công việc"
          meta="10:12 · task.reopened"
        />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("An Tran đã mở lại công việc")).toBeInTheDocument();
    expect(within(item).getByText("10:12 · task.reopened")).toBeInTheDocument();
  });
});

describe("FbTabs", () => {
  function setup() {
    const onSelect = vi.fn();
    const view = render(
      <FbTabs
        label="Nội dung công việc"
        activeId="overview"
        onSelect={onSelect}
        items={[
          { id: "overview", label: "Tổng quan", content: <p>Nội dung tổng quan</p> },
          { id: "activity", label: "Hoạt động", content: <p>Nội dung hoạt động</p> },
        ]}
      />,
    );
    return { onSelect, view };
  }

  it("theo đúng mẫu ARIA: tablist, tab và tabpanel có liên kết", () => {
    setup();
    const tablist = screen.getByRole("tablist", { name: "Nội dung công việc" });
    const active = within(tablist).getByRole("tab", { selected: true });
    expect(active).toHaveAccessibleName("Tổng quan");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Tổng quan");
  });

  it("chỉ tab đang chọn nằm trong thứ tự Tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Hoạt động" })).toHaveAttribute("tabindex", "-1");
  });

  it("mũi tên phải chuyển sang tab kế tiếp", async () => {
    const actor = userEvent.setup({ delay: null });
    const { onSelect } = setup();

    screen.getByRole("tab", { name: "Tổng quan" }).focus();
    await actor.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith("activity");
  });

  it("panel không được chọn KHÔNG nằm trong cây", () => {
    // Ẩn bằng CSS sẽ giữ nội dung trong cả thứ tự đọc lẫn thứ tự Tab.
    setup();
    expect(screen.queryByText("Nội dung hoạt động")).not.toBeInTheDocument();
  });
});

describe("FbDrawer", () => {
  it("là dialog có tên, trả focus về phần tử đã mở khi đóng", async () => {
    const actor = userEvent.setup({ delay: null });
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Mở
          </button>
          {open && (
            <FbDrawer title="Chi tiết công việc" onRequestClose={() => setOpen(false)}>
              <p>Nội dung</p>
            </FbDrawer>
          )}
        </>
      );
    }
    render(<Host />);

    const opener = screen.getByRole("button", { name: "Mở" });
    await actor.click(opener);
    expect(await screen.findByRole("dialog", { name: "Chi tiết công việc" })).toBeInTheDocument();

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it("`Escape` không đóng khi bị khoá, và không nuốt phím của widget bên trong", async () => {
    const actor = userEvent.setup({ delay: null });
    const onRequestClose = vi.fn();
    const onInnerEscape = vi.fn();
    render(
      <FbDrawer title="Chi tiết" onRequestClose={onRequestClose} closeDisabled>
        <button
          type="button"
          onKeyDown={(event) => {
            if (event.key === "Escape") onInnerEscape();
          }}
        >
          Tay kéo
        </button>
      </FbDrawer>,
    );

    screen.getByRole("button", { name: "Tay kéo" }).focus();
    await actor.keyboard("{Escape}");
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onInnerEscape).toHaveBeenCalledTimes(1);
  });
});

describe("FbTextArea và FbDateField", () => {
  it("textarea nối nhãn, hint và lỗi bằng aria-describedby", () => {
    render(
      <FbTextArea
        id="mo-ta"
        label="Mô tả"
        value=""
        onChange={() => {}}
        hint="Nêu rõ bối cảnh."
        error="Bắt buộc."
      />,
    );
    const field = screen.getByRole("textbox", { name: "Mô tả" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toContain("mo-ta-error");
  });

  it("ô ngày là input type=date — hợp đồng chỉ có YYYY-MM-DD, không có giờ", () => {
    render(<FbDateField id="han" label="Ngày kết thúc" value="2026-09-02" onChange={() => {}} />);
    const field = screen.getByLabelText("Ngày kết thúc");
    expect(field).toHaveAttribute("type", "date");
    expect(field).toHaveValue("2026-09-02");
  });
});
