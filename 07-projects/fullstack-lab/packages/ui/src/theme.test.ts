import { describe, expect, it } from "vitest";
import { theme } from "antd";
import { flowboardTheme } from "./theme.ts";

/**
 * Ant Design **suy** hàng chục biến thể từ vài màu gốc bằng thuật toán palette
 * của nó, và thuật toán đó cần một giá trị màu **thật**. Nó không phân tích
 * được chuỗi `var(...)`: nó rơi về `#000000` rồi suy ra một palette đen.
 *
 * Đo được ngay trong test dưới đây: từ `var(--fb-color-intent-info)` nó cho nền
 * `#404040`, còn từ `#0BA5EC` nó cho `#e6fbff`. Chữ
 * `--fb-color-text-primary` (`#182230`) trên `#404040` là khoảng 1,3:1 — không
 * đọc được.
 *
 * ## Vì sao test tương phản theo cặp token KHÔNG bắt được lỗi này
 *
 * Vì bản thân các token đều đúng. Cặp `intent-info-text` trên
 * `intent-info-subtle` đạt tương phản; vấn đề là antd **không đọc** cặp đó, nó
 * vẽ bằng màu tự suy. Một phép đo trên token vì vậy vẫn xanh trong khi màn hình
 * thật không đọc được — đúng loại lỗi tệ nhất.
 *
 * Test này là lớp chặn còn thiếu: nó khẳng định **mọi** seed color mà chúng ta
 * khai bằng `var()` đều có đủ các biến thể mà component thật sự render, khai
 * tường minh. Xoá một dòng trong `theme.ts` sẽ làm nó đỏ.
 */

const tokens = flowboardTheme.token ?? {};

function isCssVar(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("var(--fb-");
}

describe("cơ chế: antd không suy được palette từ var()", () => {
  it("var() cho ra palette đen, hex cho ra palette thật", () => {
    const fromVar = theme.defaultAlgorithm({
      ...theme.defaultSeed,
      colorInfo: "var(--fb-color-intent-info)",
    });
    const fromHex = theme.defaultAlgorithm({ ...theme.defaultSeed, colorInfo: "#0BA5EC" });

    // Đây là bằng chứng của cả file này, nên nó được khẳng định chứ không chỉ mô tả.
    expect(fromVar.colorInfoBg).toBe("#404040");
    expect(fromHex.colorInfoBg).not.toBe("#404040");
  });

  it("nền đen mà antd tự suy KHÔNG đọc được với chữ của chúng ta", () => {
    // `--fb-color-text-primary` ở theme sáng là `#182230`.
    const ratio = contrast("#182230", "#404040");
    expect(ratio).toBeLessThan(2);
  });
});

/**
 * Seed color, và các biến thể mà component Flowboard thật sự render từ chúng.
 *
 * Danh sách này **đóng và tường minh**: thêm một component dùng thêm biến thể
 * thì thêm dòng vào đây, đừng suy tự động — suy tự động sẽ phủ cả những biến
 * thể không ai render, và một test phủ quá nhiều thì sớm bị nới ra.
 */
const SEED_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  colorPrimary: ["colorPrimaryHover", "colorPrimaryActive", "colorPrimaryBg", "colorPrimaryText"],
  colorInfo: ["colorInfoBg", "colorInfoBorder", "colorInfoText"],
  colorSuccess: ["colorSuccessBg", "colorSuccessBorder", "colorSuccessText"],
  colorWarning: ["colorWarningBg", "colorWarningBorder", "colorWarningText"],
  colorError: ["colorErrorBg", "colorErrorBorder", "colorErrorText"],
};

describe("mọi seed khai bằng var() đều phải khai đủ biến thể", () => {
  it.each(Object.keys(SEED_VARIANTS))("%s", (seed) => {
    const seedValue = (tokens as Record<string, unknown>)[seed];
    if (!isCssVar(seedValue)) return; // Seed là màu thật thì antd suy được, không cần khai.

    const missing = SEED_VARIANTS[seed]!.filter(
      (variant) => !isCssVar((tokens as Record<string, unknown>)[variant]),
    );
    expect(
      missing,
      `\`${seed}\` khai bằng var() nên antd sẽ suy các biến thể này từ đen. ` +
        `Khai tường minh chúng trong theme.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("không có màu thật lọt vào theme", () => {
  it("mọi giá trị màu đều là var(--fb-*), không phải hex", () => {
    const hardcoded = Object.entries(tokens as Record<string, unknown>)
      .filter(([key]) => key.startsWith("color"))
      .filter(([, value]) => typeof value === "string" && /^#|^rgb/.test(value))
      .map(([key]) => key);
    expect(hardcoded).toEqual([]);
  });
});

/** Tương phản theo WCAG, cài lại tại chỗ để test không phụ thuộc gói ngoài. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const parts = [1, 3, 5].map((i) => {
      const channel = Number.parseInt(hex.substr(i, 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]!;
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
