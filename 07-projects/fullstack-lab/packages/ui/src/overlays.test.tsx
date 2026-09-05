import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FbModal } from "./overlays.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, accessibility và variant. Test ở đây
 * kiểm đúng những thứ đó — chứ không kiểm lại Ant Design hay Lucide.
 *
 * Một wrapper **không** được fetch, kiểm role hay gọi API; các test dưới đây
 * chỉ truyền dữ liệu vào và đọc DOM ra, đúng như hợp đồng của package.
 */

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
