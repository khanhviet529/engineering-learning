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

  // Board (M3). Cột đứng trên nền `surface-subtle`, không phải `surface-raised`
  // như phần lớn bề mặt khác — nên đây là ba cặp mới, không phải cặp đã đo.
  { where: "board · tiêu đề cột", fg: "--fb-color-text-strong", bg: "--fb-color-surface-subtle" },
  {
    where: "board · chỗ chứa công việc còn trống",
    fg: "--fb-color-text-muted",
    bg: "--fb-color-surface-subtle",
  },
  {
    where: "BRD-02 · nhãn công tắc",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-surface-raised",
  },

  // Task, bình luận và tab (M4).
  {
    where: "TSK-02 · tab đang chọn",
    fg: "--fb-color-brand-text",
    bg: "--fb-color-surface-raised",
  },
  {
    where: "bình luận · liên kết trong Markdown",
    fg: "--fb-color-brand-text",
    bg: "--fb-color-surface-raised",
  },
  {
    where: "bình luận · khối code",
    fg: "--fb-color-text-primary",
    bg: "--fb-color-surface-subtle",
  },
  {
    where: "task card · nhóm công việc",
    fg: "--fb-color-text-muted",
    bg: "--fb-color-surface-raised",
  },

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

/**
 * Đóng `noOpaqueBg 22`.
 *
 * Ba vòng freeze liên tiếp báo `noOpaqueBg: 22` mà không ai đóng: 22 text node
 * trong artifact **không có tổ tiên nào mang nền đục**, nên phép đo tương phản
 * của chúng không xác định — và `below: 0` vì vậy không có nghĩa là "không có
 * vấn đề".
 *
 * Đo lại trên `flowboard.pen` cho đúng 22 node, và cả 22 nằm trong **frame
 * component** của `packages/ui`: `FbBrandMark`, `FbLink`, `FbTextField`,
 * `FbPasswordField`, `FbChecklistRow`, `FbSelect`, `FbDateField`,
 * `FbActivityItem`, `FbPageSection` và `FbNavGroupTimeTracking`. Đó là kết quả
 * **đúng** cho canvas: một component tồn tại để được đặt lên một bề mặt, nên
 * bản thân nó không mang nền.
 *
 * Nên cách đóng không phải là gán nền cho từng component — làm vậy sẽ dán một
 * hình chữ nhật đục vào mọi chỗ đặt chúng. Cách đóng là **chứng minh chúng
 * luôn rơi xuống một nền đã được đo**: trong ứng dụng chỉ có ba bề mặt chứa
 * nội dung, và bài kiểm dưới đây đo từng màu chữ của 22 node đó với **cả ba**.
 * Đặt ở đâu cũng đọc được thì "không xác định" biến mất.
 */

/** Ba bề mặt đục duy nhất mà nội dung của ứng dụng nằm lên. */
const CONTENT_SURFACES = [
  "--fb-color-surface-canvas",
  "--fb-color-surface-raised",
  "--fb-color-surface-subtle",
] as const;

/**
 * 22 node, gom theo màu chữ. Tên node giữ nguyên như trong artifact để đối
 * chiếu được, vì đây là bằng chứng đóng một con số đã đứng ba vòng.
 */
const NO_OPAQUE_BG_NODES: { fg: string; nodes: string[]; large?: boolean }[] = [
  {
    fg: "--fb-color-text-primary",
    nodes: ["FbBrandMark · Wordmark", "FbPageSection · Section title"],
    // 18px bold ⇒ ngưỡng 3:1 theo hệ thống thiết kế.
    large: true,
  },
  { fg: "--fb-color-brand-text", nodes: ["FbLink · Label"] },
  {
    fg: "--fb-color-text-strong",
    nodes: [
      "FbTextField · Label",
      "FbPasswordField · Label",
      "FbSelect · Label",
      "FbDateField · Label",
    ],
  },
  {
    fg: "--fb-color-intent-danger-text",
    nodes: [
      "FbTextField · Required Mark",
      "FbPasswordField · Required Mark",
      "FbSelect · Required Mark",
      "FbDateField · Required Mark",
    ],
  },
  {
    fg: "--fb-color-text-muted",
    nodes: [
      "FbTextField · Helper",
      "FbSelect · Helper",
      "FbDateField · Helper",
      "FbActivityItem · Activity meta",
      "FbPageSection · Section description",
      // Chuyển từ `text.subtle` sang đây ở vòng design v0.5: hai token cách
      // nhau 0,006 luminance là **một màu**, nên bậc chữ thứ tư bị gộp vào
      // `muted`. Node **chuyển nhóm** chứ không biến mất — tổng vẫn phải là 22,
      // vì phép đóng `noOpaqueBg` nói về cùng một tập node.
      "FbNavGroupTimeTracking · Group Label",
    ],
  },
  {
    fg: "--fb-color-text-secondary",
    nodes: [
      "FbChecklistRow · Criterion",
      "FbActivityItem · Activity message",
      "FbNavGroupTimeTracking · Nav Nhật ký giờ",
      "FbNavGroupTimeTracking · Nav Phê duyệt giờ",
      "FbNavGroupTimeTracking · Nav Báo cáo giờ",
    ],
  },
];

/**
 * Màu chữ **không** đạt ngưỡng trên cả ba bề mặt.
 *
 * Danh sách này là một **phát hiện đã báo**, không phải một sự chấp nhận. Nó
 * được ghim bằng một phép so bằng chính xác, nên nó đỏ theo cả hai chiều: thêm
 * một token hỏng thì đỏ, mà sửa được token này cũng đỏ — và lần đỏ thứ hai là
 * lời nhắc xoá dòng đi.
 *
 * `--fb-color-text-subtle` chỉ xuất hiện ở `FbNavGroupTimeTracking`, một
 * component của Phase 1.3 **chưa được dựng** trong `packages/ui`. Vì vậy nó
 * không có bề mặt nào để sửa trong code hôm nay; việc sửa thuộc vòng design.
 */
const KNOWN_UNREADABLE: Record<Theme, string[]> = {
  // **Rỗng từ 06/09/2026.** `--fb-color-text-subtle` từng ở đây với `#94A3B8`
  // — khoảng 2,6–2,8:1 trên ba nền sáng, trong khi theme tối cùng token đó lại
  // đạt, nên nó là lỗi của **bảng màu sáng**. Vòng design v0.4 đổi sang
  // `#6B7280` (4,84:1) và danh sách này rỗng lại.
  //
  // Đường đi của bản sửa đáng nhớ hơn bản sửa. Màu đúng nằm trong artifact từ
  // vòng freeze, nhưng `tokens.css` là file **được sinh ra** và không ai chạy
  // `pnpm tokens`, nên ứng dụng vẫn ship màu cũ qua hai commit. Cổng bắt được
  // là bước CI `pnpm tokens && git diff --exit-code` — bước đó đã tồn tại từ
  // lâu và **chưa từng thực thi**, vì workflow nằm sai thư mục.
  light: [],
  dark: [],
};

describe("noOpaqueBg 22 — 22 node không có nền đục trong artifact", () => {
  const tokens = readTokens();

  it("đếm đủ 22 node, không nhiều không ít", () => {
    // Con số phải khớp với báo cáo freeze. Lệch nghĩa là artifact đã đổi và
    // phép đóng này không còn nói về cùng một tập node.
    const total = NO_OPAQUE_BG_NODES.reduce((sum, group) => sum + group.nodes.length, 0);
    expect(total).toBe(22);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`theme ${theme}: mọi màu chữ đọc được trên CẢ BA bề mặt`, () => {
      const unreadable: string[] = [];

      for (const group of NO_OPAQUE_BG_NODES) {
        const fg = tokens[theme].get(group.fg);
        expect(fg, `${group.fg} thiếu ở theme ${theme}`).toBeDefined();
        const threshold = group.large === true ? 3 : 4.5;

        const failed = CONTENT_SURFACES.filter((surface) => {
          const bg = tokens[theme].get(surface);
          expect(bg, `${surface} thiếu ở theme ${theme}`).toBeDefined();
          return ratio(fg as string, bg as string) < threshold;
        });
        if (failed.length > 0) unreadable.push(group.fg);
      }

      expect(unreadable).toEqual(KNOWN_UNREADABLE[theme]);
    });
  }
});
