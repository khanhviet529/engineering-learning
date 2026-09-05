import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FbAccountMenu } from "./account-menu.tsx";

/**
 * Wrapper tồn tại để giữ ổn định token, accessibility và variant. Test ở đây
 * kiểm đúng những thứ đó — chứ không kiểm lại Ant Design hay Lucide.
 *
 * Một wrapper **không** được fetch, kiểm role hay gọi API; các test dưới đây
 * chỉ truyền dữ liệu vào và đọc DOM ra, đúng như hợp đồng của package.
 */

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
