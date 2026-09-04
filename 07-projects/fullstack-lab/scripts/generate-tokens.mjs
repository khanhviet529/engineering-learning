#!/usr/bin/env node
/**
 * Sinh `packages/ui/src/tokens.css` từ artifact thiết kế đã freeze.
 *
 * Lý do script này tồn tại thay vì một file CSS chép tay: Pencil v0.1 có 171
 * biến `fb.*` với hai theme. Chép tay là tạo ra một bản sao thứ hai, và bản sao
 * thứ hai luôn trôi khỏi bản gốc — chỉ là sớm hay muộn. Ở đây artifact là nguồn
 * duy nhất, còn CSS là dẫn xuất tái tạo được.
 *
 * `.pen` là JSON thuần và được ghim `eol=lf` trong `.gitattributes`, nên đọc nó
 * ở build time là tất định.
 *
 * Chạy: `pnpm tokens`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const penPath = resolve(root, "docs/design/flowboard-v0.1.pen");
const outPath = resolve(root, "packages/ui/src/tokens.css");

const doc = JSON.parse(readFileSync(penPath, "utf8"));
const variables = doc.variables ?? {};

const names = Object.keys(variables).sort();
if (names.length === 0) {
  throw new Error("Không đọc được biến nào từ artifact — dừng thay vì sinh ra file rỗng.");
}

const nonPrefixed = names.filter((n) => !n.startsWith("fb."));
if (nonPrefixed.length > 0) {
  throw new Error(
    `Artifact còn ${nonPrefixed.length} biến không mang tiền tố fb.: ${nonPrefixed.join(", ")}. ` +
      "Chúng phải được remap trước khi sinh token.",
  );
}

/** `fb.color.text.primary` -> `--fb-color-text-primary` */
const cssName = (token) => `--${token.replaceAll(".", "-")}`;

/** Giá trị của một biến ở một theme mode. */
function valueFor(definition, mode) {
  const raw = definition.value;
  if (!Array.isArray(raw)) return raw;
  const hit = raw.find((entry) => entry.theme?.mode === mode) ?? raw[0];
  return hit?.value;
}

/**
 * Gắn đơn vị theo họ token.
 *
 * Phát số trần ra CSS buộc mọi nơi dùng phải viết `calc(var(--fb-space-4) * 1px)`,
 * và chỉ cần một chỗ quên là layout sai âm thầm. Danh sách dưới đây là
 * **đóng**: token rơi ngoài nó sẽ làm script dừng thay vì đoán đơn vị.
 */
const PX_PREFIXES = [
  "fb.space.",
  "fb.size.",
  "fb.radius.",
  "fb.border.width.",
  "fb.breakpoint.",
  "fb.font.size.",
  "fb.shadow.",
];
const MS_PREFIXES = ["fb.motion.duration."];
const UNITLESS_PREFIXES = ["fb.z.", "fb.font.line-height.", "fb.font.weight."];

function withUnit(name, value) {
  if (PX_PREFIXES.some((p) => name.startsWith(p))) return `${value}px`;
  if (MS_PREFIXES.some((p) => name.startsWith(p))) return `${value}ms`;
  if (UNITLESS_PREFIXES.some((p) => name.startsWith(p))) return String(value);
  throw new Error(
    `Token số \`${name}\` không thuộc họ nào đã biết đơn vị. Thêm nó vào một trong ba danh sách ` +
      "trong scripts/generate-tokens.mjs thay vì để script đoán.",
  );
}

function formatValue(name, definition, mode) {
  const value = valueFor(definition, mode);
  if (value === undefined || value === null) return null;
  // Biến tham chiếu biến khác: `$fb.color.x` -> `var(--fb-color-x)`
  if (typeof value === "string" && value.startsWith("$")) {
    return `var(${cssName(value.slice(1))})`;
  }
  if (typeof value === "number") {
    return withUnit(name, value);
  }
  return String(value);
}

const modes = doc.themes?.mode ?? ["light", "dark"];
const [lightMode, darkMode] = [modes[0] ?? "light", modes[1] ?? "dark"];

/** Biến có giá trị khác nhau giữa hai theme thì mới cần khai lại ở khối dark. */
const lightBlock = [];
const darkBlock = [];

for (const name of names) {
  const def = variables[name];
  const light = formatValue(name, def, lightMode);
  const dark = formatValue(name, def, darkMode);
  if (light === null) continue;
  lightBlock.push(`  ${cssName(name)}: ${light};`);
  if (dark !== null && dark !== light) {
    darkBlock.push(`  ${cssName(name)}: ${dark};`);
  }
}

const header = `/*
 * SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.
 *
 * Nguồn: docs/design/flowboard-v0.1.pen (Pencil v0.1, freeze 04/09/2026)
 * Sinh lại bằng: pnpm tokens
 *
 * ${names.length} biến, ${darkBlock.length} biến có giá trị riêng cho theme tối.
 *
 * Theme có ba trạng thái và chỉ một nguồn quyết định:
 *   - \`[data-theme="light"]\` và \`[data-theme="dark"]\` là lựa chọn tường minh của người dùng.
 *   - Không có thuộc tính đó thì đi theo \`prefers-color-scheme\` của hệ điều hành.
 * Không component nào được tự đọc \`prefers-color-scheme\` riêng.
 */
`;

const css = `${header}
:root {
${lightBlock.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${darkBlock.map((line) => `  ${line}`).join("\n")}
  }
}

:root[data-theme="dark"] {
${darkBlock.join("\n")}
}
`;

writeFileSync(outPath, css, "utf8");

console.warn(
  `tokens: ${names.length} biến -> ${outPath.replace(root, ".")} (${darkBlock.length} biến theo theme)`,
);
