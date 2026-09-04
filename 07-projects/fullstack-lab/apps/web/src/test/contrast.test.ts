import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Đo tương phản của **những cặp token mà M2 thật sự dùng**, ở cả hai theme.
 *
 * Artifact đã được đo và đạt 0 lỗi trên 3.032 text node, nhưng phép đo đó áp
 * cho các cặp có trong artifact. Code M2 tạo ra **cặp mới** — ví dụ chữ
 * `text-secondary` trên nền `surface-raised` trong hàng bảng, hay badge tone
 * `info` mà artifact không dùng ở màn nào. Một cặp mới là một cặp chưa được
 * đo; test này đo nó.
 *
 * Ngưỡng theo [hệ thống thiết kế](../../../../docs/design/design-system.md):
 * 4.5:1 cho chữ thường, 3:1 cho chữ từ 24px hoặc 19px bold.
 */

const TOKENS_CSS = join(process.cwd(), "..", "..", "packages", "ui", "src", "tokens.css");

type Theme = "light" | "dark";

/**
 * Đọc giá trị token theo từng theme từ `tokens.css`.
 *
 * File có ba khối: `:root` (giá trị sáng), khối `prefers-color-scheme: dark`,
 * và `:root[data-theme="dark"]`. Khối thứ ba là bản đầy đủ nhất của theme tối
 * nên nó được dùng làm nguồn cho `dark`.
 */
function readTokens(): Record<Theme, Map<string, string>> {
  const css = readFileSync(TOKENS_CSS, "utf8");
  const light = new Map<string, string>();
  const dark = new Map<string, string>();

  const rootBlock = css.slice(css.indexOf(":root {") + 7, css.indexOf("}", css.indexOf(":root {")));
  const darkStart = css.indexOf(':root[data-theme="dark"] {');
  const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));

  const collect = (block: string, into: Map<string, string>) => {
    for (const match of block.matchAll(/(--fb-[a-z0-9-]+):\s*([^;]+);/g)) {
      into.set(match[1]!, match[2]!.trim());
    }
  };
  collect(rootBlock, light);
  collect(rootBlock, dark);
  collect(darkBlock, dark);

  return { light, dark };
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "").slice(0, 6);
  const channel = (offset: number) => {
    const value = Number.parseInt(clean.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function ratio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

/**
 * Các cặp (chữ, nền) mà component M2 đặt cạnh nhau.
 *
 * Bảng này là **tường minh** thay vì suy ra tự động: nó vừa là phép đo vừa là
 * tài liệu về ý định phối màu, và nó đỏ ngay khi ai đó đổi giá trị một token
 * làm hỏng một cặp đang dùng.
 */
const PAIRS: { where: string; fg: string; bg: string; large?: boolean }[] = [
  // App shell
  {
    where: "sidebar · nav item thường",
    fg: "--fb-color-text-secondary",
    bg: "--fb-color-surface-raised",
  },
  {
    where: "sidebar · nav item active",
    fg: "--fb-color-nav-active-text",
    bg: "--fb-color-nav-active-surface",
  },
  {
    where: "sidebar · tên workspace",
    fg: "--fb-color-text-muted",
    bg: "--fb-color-surface-raised",
  },
  {
    where: "sidebar · dấu thương hiệu",
    fg: "--fb-color-brand-on-surface",
    bg: "--fb-color-brand-surface",
  },
  {
    where: "sidebar · control thu gọn",
    fg: "--fb-color-text-secondary",
    bg: "--fb-color-surface-subtle",
  },
  { where: "topbar · tiêu đề", fg: "--fb-color-text-primary", bg: "--fb-color-surface-raised" },
  { where: "topbar · breadcrumb", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },
  {
    where: "topbar · khối người dùng",
    fg: "--fb-color-text-strong",
    bg: "--fb-color-surface-subtle",
  },
  { where: "topbar · avatar", fg: "--fb-color-brand-text", bg: "--fb-color-brand-subtle" },

  // Menu tài khoản
  { where: "menu · tên", fg: "--fb-color-text-primary", bg: "--fb-color-surface-raised" },
  { where: "menu · email", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },
  { where: "menu · mục thường", fg: "--fb-color-text-secondary", bg: "--fb-color-surface-raised" },
  {
    where: "menu · đăng xuất",
    fg: "--fb-color-intent-danger-text",
    bg: "--fb-color-surface-raised",
  },

  // Khối nội dung và danh sách
  {
    where: "page section · tiêu đề",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-surface-raised",
  },
  { where: "page section · mô tả", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },
  {
    where: "list row · dòng chính",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-surface-raised",
  },
  { where: "list row · dòng phụ", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },

  // Bảng thành viên
  { where: "table · tiêu đề cột", fg: "--fb-color-text-muted", bg: "--fb-color-surface-subtle" },
  { where: "table · ô dữ liệu", fg: "--fb-color-text-strong", bg: "--fb-color-surface-raised" },

  // Badge — sáu tone
  { where: "badge brand", fg: "--fb-color-brand-text", bg: "--fb-color-brand-subtle" },
  { where: "badge neutral", fg: "--fb-color-text-secondary", bg: "--fb-color-surface-muted" },
  {
    where: "badge success",
    fg: "--fb-color-intent-success-text",
    bg: "--fb-color-intent-success-subtle",
  },
  {
    where: "badge warning",
    fg: "--fb-color-intent-warning-text",
    bg: "--fb-color-intent-warning-subtle",
  },
  {
    where: "badge danger",
    fg: "--fb-color-intent-danger-text",
    bg: "--fb-color-intent-danger-subtle",
  },
  { where: "badge info", fg: "--fb-color-intent-info-text", bg: "--fb-color-intent-info-subtle" },

  // Lớp phủ và trạng thái
  { where: "modal · tiêu đề", fg: "--fb-color-text-primary", bg: "--fb-color-surface-raised" },
  { where: "modal · phụ đề", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },
  { where: "modal · nút đóng", fg: "--fb-color-text-secondary", bg: "--fb-color-surface-subtle" },
  { where: "toast", fg: "--fb-color-text-on-inverse", bg: "--fb-color-surface-inverse" },
  { where: "màn hệ thống · mã lỗi", fg: "--fb-color-text-muted", bg: "--fb-color-surface-canvas" },

  // Field và select
  { where: "field · nhãn", fg: "--fb-color-text-primary", bg: "--fb-color-surface-raised" },
  { where: "field · hint", fg: "--fb-color-text-muted", bg: "--fb-color-surface-raised" },
  { where: "field · lỗi", fg: "--fb-color-intent-danger-text", bg: "--fb-color-surface-raised" },
  { where: "select · giá trị", fg: "--fb-color-text-primary", bg: "--fb-color-surface-raised" },
  {
    where: "select · disabled",
    fg: "--fb-color-state-disabled-text",
    bg: "--fb-color-state-disabled-surface",
  },

  // FbAlert — nền do Ant Design render, nhưng nay đọc từ token của ta.
  // Chữ tiêu đề và mô tả của Alert dùng `--ant-color-text` = `text.primary`.
  {
    where: "alert info · chữ trên nền",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-intent-info-subtle",
  },
  {
    where: "alert success · chữ trên nền",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-intent-success-subtle",
  },
  {
    where: "alert warning · chữ trên nền",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-intent-warning-subtle",
  },
  {
    where: "alert danger · chữ trên nền",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-intent-danger-subtle",
  },
  {
    where: "alert warning · icon trên nền",
    fg: "--fb-color-intent-warning-text",
    bg: "--fb-color-intent-warning-subtle",
  },
  {
    where: "alert danger · icon trên nền",
    fg: "--fb-color-intent-danger-text",
    bg: "--fb-color-intent-danger-subtle",
  },

  // Nút primary — hover và active nay đọc từ token thay vì bị antd suy từ đen.
  {
    where: "nút primary · mặc định",
    fg: "--fb-color-brand-on-surface",
    bg: "--fb-color-brand-surface",
  },
  {
    where: "nút primary · hover",
    fg: "--fb-color-brand-on-surface",
    bg: "--fb-color-brand-surface-hover",
  },
  {
    where: "nút primary · active",
    fg: "--fb-color-brand-on-surface",
    bg: "--fb-color-brand-surface-strong",
  },

  // PRJ-01 — badge vai trò trên hàng danh sách
  {
    where: "badge vai trò editor",
    fg: "--fb-color-intent-info-text",
    bg: "--fb-color-intent-info-subtle",
  },

  // USR-01
  { where: "theme option · đang chọn", fg: "--fb-color-brand-text", bg: "--fb-color-brand-subtle" },
  { where: "theme option · thường", fg: "--fb-color-text-strong", bg: "--fb-color-surface-raised" },
  {
    where: "hồ sơ · avatar lớn",
    fg: "--fb-color-brand-text",
    bg: "--fb-color-brand-subtle",
    large: true,
  },
  { where: "hồ sơ · thẻ nền phụ", fg: "--fb-color-text-primary", bg: "--fb-color-surface-subtle" },
];

describe("tương phản của mọi cặp token M2 dùng, ở CẢ HAI theme", () => {
  const tokens = readTokens();

  it("đọc được token của cả hai theme — phép đo không rỗng", () => {
    expect(tokens.light.size).toBeGreaterThan(100);
    expect(tokens.dark.size).toBeGreaterThan(100);
    expect(tokens.light.get("--fb-color-text-primary")).toMatch(/^#/);
    expect(tokens.dark.get("--fb-color-text-primary")).toMatch(/^#/);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`theme ${theme}: mọi cặp đạt ngưỡng`, () => {
      const failures: string[] = [];

      for (const pair of PAIRS) {
        const fg = tokens[theme].get(pair.fg);
        const bg = tokens[theme].get(pair.bg);
        // Token không tồn tại là lỗi nặng hơn tương phản thấp: nó nghĩa là
        // component đang trỏ tới một biến không có giá trị.
        expect(fg, `${pair.fg} thiếu ở theme ${theme}`).toBeDefined();
        expect(bg, `${pair.bg} thiếu ở theme ${theme}`).toBeDefined();

        const minimum = pair.large === true ? 3 : 4.5;
        const measured = ratio(fg!, bg!);
        if (measured < minimum) {
          failures.push(
            `${pair.where}: ${measured}:1 (cần ${minimum}:1) — ${pair.fg} ${fg!} trên ${pair.bg} ${bg!}`,
          );
        }
      }

      expect(failures).toEqual([]);
    });
  }

  it("phép đo thật sự bắt được cặp hỏng", () => {
    // Trắng trên trắng phải trượt; nếu không thì hàm đo đang sai.
    expect(ratio("#FFFFFF", "#FFFFFF")).toBe(1);
    expect(ratio("#000000", "#FFFFFF")).toBe(21);
  });
});
