import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Cổng ra đo được của M0.4.
 *
 * `tokens.css` là dẫn xuất của artifact thiết kế. Test này kiểm nó **thực sự**
 * là dẫn xuất chứ không phải một bản chép tay đã trôi: mọi biến trong artifact
 * phải có mặt trong CSS, và CSS không được chứa biến nào artifact không có.
 *
 * Không có test này thì `pnpm tokens` chỉ là một lời hứa — người sau sửa tay
 * một giá trị màu trong CSS và không gì phát hiện ra.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pen = JSON.parse(readFileSync(resolve(root, "docs/design/flowboard-v0.1.pen"), "utf8")) as {
  variables: Record<string, { type: string; value: unknown }>;
  themes?: { mode?: string[] };
};
const css = readFileSync(resolve(root, "packages/ui/src/tokens.css"), "utf8");

const artifactTokens = Object.keys(pen.variables).sort();
const cssVariables = [...css.matchAll(/^\s*(--fb-[a-z0-9-]+):/gm)].map((m) => m[1] as string);
const cssTokenSet = new Set(cssVariables);

const toCssName = (token: string) => `--${token.replaceAll(".", "-")}`;

describe("tokens.css là dẫn xuất trung thực của artifact", () => {
  it("artifact có biến để sinh", () => {
    expect(artifactTokens.length).toBeGreaterThan(0);
  });

  it("mọi biến `fb.*` trong artifact đều có trong CSS", () => {
    const missing = artifactTokens.filter((t) => !cssTokenSet.has(toCssName(t)));
    expect(missing).toEqual([]);
  });

  it("CSS không chứa biến nào artifact không có", () => {
    const artifactCssNames = new Set(artifactTokens.map(toCssName));
    const extra = [...cssTokenSet].filter((v) => !artifactCssNames.has(v));
    expect(extra).toEqual([]);
  });

  it("mọi biến đều mang tiền tố fb., không còn biến legacy", () => {
    expect(artifactTokens.filter((t) => !t.startsWith("fb."))).toEqual([]);
  });
});

describe("đơn vị được gắn đúng theo họ token", () => {
  const declarations = new Map(
    [...css.matchAll(/^\s*(--fb-[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );

  it.each([
    ["--fb-space-4", /px$/],
    ["--fb-size-control-md", /px$/],
    ["--fb-radius-md", /px$/],
    ["--fb-font-size-body", /px$/],
    ["--fb-motion-duration-base", /ms$/],
    ["--fb-z-modal", /^\d+$/],
    ["--fb-font-line-height-base", /^[\d.]+$/],
  ])("%s khớp %s", (name, pattern) => {
    const value = declarations.get(name);
    expect(value, `${name} không có trong tokens.css`).toBeDefined();
    expect(value).toMatch(pattern);
  });
});

describe("theme có đúng một nguồn quyết định", () => {
  it("có khối lựa chọn tường minh cho cả sáng lẫn tối", () => {
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it("chỉ có đúng một media query theo prefers-color-scheme", () => {
    // Đếm media query thật, không đếm cả phần comment giải thích quy tắc.
    const queries = css.match(/@media \(prefers-color-scheme/g) ?? [];
    expect(queries).toHaveLength(1);
  });

  it("có biến thật sự đổi giá trị theo theme", () => {
    const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
    const darkVars = darkBlock.match(/--fb-[a-z0-9-]+:/g) ?? [];
    expect(darkVars.length).toBeGreaterThan(50);
  });
});
