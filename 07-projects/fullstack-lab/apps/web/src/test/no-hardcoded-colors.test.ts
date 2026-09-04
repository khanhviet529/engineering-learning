import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Không một giá trị màu nào được viết thẳng trong code frontend.
 *
 * Đây là cổng bảo vệ toàn bộ công kiểm tương phản đã làm ở giai đoạn thiết kế.
 * Artifact đạt **0 hex ghi cứng** và mọi cặp chữ/nền đều được đo ở cả hai
 * theme; một `#fff` viết tay trong code là một giá trị **không** nằm trong
 * phép đo đó, và nó sẽ không đổi theo theme. Token `--fb-*` được sinh từ chính
 * artifact, nên đọc token là cách duy nhất giữ hai bên khớp nhau.
 *
 * Bộ kiểm này quét cả `apps/web/src` lẫn `packages/ui/src`, vì một wrapper
 * dùng hex cũng phá cùng một cam kết như một màn hình dùng hex.
 */

// Vitest chạy với cwd là gốc của workspace `apps/web`. Không dùng
// `import.meta.url`: trong môi trường jsdom nó là một URL `http`, không phải
// `file`, nên `fileURLToPath` ném ngay.
const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, "..", "..");
const ROOTS = [join(WEB_ROOT, "src"), join(REPO_ROOT, "packages", "ui", "src")];

/**
 * Hex màu: `#abc`, `#aabbcc`, `#aabbccdd`.
 *
 * Chỉ bắt khi nó nằm trong chuỗi hoặc sau dấu hai chấm — để không bắt nhầm
 * một `#` trong văn bản tiếng Việt hay trong đường dẫn có fragment.
 */
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

/** Hàm màu của CSS. `color-mix` cũng bị cấm: nó tạo ra một màu không đo được. */
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/g;

/**
 * Tên màu CSS chỉ bị cấm khi nó đứng làm **giá trị** của một thuộc tính màu.
 * `background: "white"` là vi phạm; chữ "white" trong một câu tiếng Anh thì không.
 */
const NAMED_COLOR_VALUE =
  /\b(?:background|backgroundColor|color|borderColor|outlineColor|fill|stroke)\s*:\s*["'](?:white|black|red|blue|green|yellow|orange|purple|gray|grey|silver|navy|teal|olive|maroon|lime|aqua|fuchsia)["']/g;

/**
 * Bốn tệp được miễn, và **chỉ** bốn tệp này. Danh sách là allowlist tường minh:
 * một quy tắc dạng "bỏ qua mọi file test" sẽ mở cửa cho màu ghi cứng ở mọi
 * component test, tức là bỏ luôn nửa số nơi cần canh.
 *
 * - `tokens.css` là **đầu ra** của `pnpm tokens`, sinh từ artifact; nó là chỗ
 *   duy nhất được phép chứa giá trị màu, và có bộ test riêng đối chiếu từng
 *   biến với artifact.
 * - Ba bộ kiểm màu bên dưới cố ý chứa hex trong **code** — chúng đo màu, nên
 *   chúng phải gọi tên màu. `contrast.test.ts` đo cặp chữ/nền;
 *   `theme.test.ts` chứng minh thuật toán palette của Ant Design cho ra
 *   `#404040` khi seed là một chuỗi `var()`; và chính tệp này giữ mẫu vi phạm
 *   để tự kiểm regex. Quét chúng sẽ luôn đỏ vì đúng lý do sai.
 */
const EXEMPT = new Set([
  "tokens.css",
  "no-hardcoded-colors.test.ts",
  "contrast.test.ts",
  "theme.test.ts",
]);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (EXEMPT.has(entry)) continue;
      if (/\.(ts|tsx|css|scss)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Bỏ phần **chú thích** trước khi quét.
 *
 * Quy tắc cấm là cấm một giá trị màu **được render**, không cấm việc viết ra
 * một giá trị màu để giải thích một lỗi. Ví dụ thật: chú thích của cầu nối
 * theme phải nói rõ Ant Design từng phát ra nền `#404040`, vì không có con số
 * đó thì người đọc sau không biết lỗi trông như thế nào.
 *
 * Chỉ bỏ khối chú thích và những dòng **bắt đầu** bằng `//` hoặc `*`. Không
 * cắt tại `//` giữa dòng: một `https://` trong chuỗi sẽ làm mất phần còn lại
 * của dòng, và một vi phạm thật có thể trốn ngay sau nó.
 */
function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line))
    .join("\n");
}

function violationsIn(file: string): string[] {
  const source = withoutComments(readFileSync(file, "utf8"));
  const found: string[] = [];

  for (const [label, pattern] of [
    ["hex", HEX],
    ["hàm màu", COLOR_FUNCTION],
    ["tên màu CSS", NAMED_COLOR_VALUE],
  ] as const) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      found.push(`${label} "${match[0]}" tại dòng ${String(line)}`);
    }
  }
  return found;
}

describe("không có giá trị màu viết thẳng trong code frontend", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("quét được ít nhất một tệp ở mỗi workspace — bộ kiểm không rỗng", () => {
    // Một bộ kiểm quét nhầm thư mục rỗng sẽ luôn xanh và không bảo vệ gì.
    expect(files.some((file) => file.includes(`apps${sep}web`))).toBe(true);
    expect(files.some((file) => file.includes(`packages${sep}ui`))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it("mọi tệp chỉ dùng biến --fb-*", () => {
    const report = files
      .map((file) => ({ file: relative(REPO_ROOT, file), hits: violationsIn(file) }))
      .filter((entry) => entry.hits.length > 0)
      .map((entry) => `${entry.file}: ${entry.hits.join("; ")}`);

    expect(report).toEqual([]);
  });

  it("bộ kiểm thật sự bắt được vi phạm", () => {
    // Nếu không tự kiểm điều này thì một regex hỏng sẽ làm cả bộ kiểm vô dụng
    // mà vẫn xanh mãi mãi.
    const sample = 'const a = { background: "#ff0000", color: "rgb(0,0,0)", fill: "white" };';
    const matches = [
      ...sample.matchAll(HEX),
      ...sample.matchAll(COLOR_FUNCTION),
      ...sample.matchAll(NAMED_COLOR_VALUE),
    ];
    expect(matches).toHaveLength(3);
  });

  it("bỏ chú thích nhưng KHÔNG bỏ code — vi phạm thật vẫn bị bắt", () => {
    // Nếu phép bỏ chú thích quá tay, cả bộ kiểm sẽ mù mà vẫn xanh.
    const source = [
      "// Trước khi sửa, Ant Design phát ra nền " + "#404040" + ".",
      "/* Khối chú thích cũng nhắc " + "#182230" + ". */",
      ' * JSDoc nhắc "' + "#000000" + '" nữa.',
      'const style = { background: "' + "#ff0000" + '" };',
    ].join("\n");

    const scanned = withoutComments(source);
    const hits = [...scanned.matchAll(HEX)].map((match) => match[0]);
    expect(hits).toEqual(["#ff0000"]);
  });
});
