import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `failure.message` không được render cho người dùng.
 *
 * [ADR-0016](../../../../docs/decisions/ADR-0016-error-code-is-contract-message-is-ui.md):
 * `code` là hợp đồng, `message` là **chẩn đoán**. Chữ hiển thị thuộc frontend
 * và sống ở `features/x/messages.ts` của từng feature, vì cùng một `NOT_FOUND`
 * phải nói khác nhau ở board và ở lời mời.
 *
 * ADR nói rõ vì sao guard này tồn tại: "quy tắc chỉ nằm trong tài liệu thì
 * không chặn được ai; ba mốc vừa rồi đã chứng minh điều đó nhiều lần." Nó dựng
 * **sau** khi trả nợ, không phải trước — dựng trước thì nó đỏ 18 lần rồi bị
 * tắt, và một guard bị tắt thì không bảo vệ gì.
 *
 * Cùng lối với `no-hardcoded-colors.test.ts`: quét đĩa, không quét một hằng số.
 */

const WEB_SRC = join(process.cwd(), "src");

/** Chỉ quét nơi có bề mặt người dùng. Xem ghi chú ở `DIAGNOSTIC_USE`. */
const SCANNED = ["features", "app"];

/**
 * Bắt `x.message` khi `x` là một failure.
 *
 * Chỉ những tên gợi đúng nghĩa — `failure`, `rowFailure`, `stage.failure`… —
 * chứ không phải mọi `.message` trong cây: `error.message` của một `Error`
 * chuẩn, hay `issue.message` của Zod, là chuyện khác hẳn.
 */
const FAILURE_MESSAGE = /\b[A-Za-z]*[Ff]ailure(?:\?)?\.message\b/g;

/**
 * Ngoại lệ, **đóng và đếm được** — đúng bảng ở ADR-0016 mục 4.
 *
 * Danh sách này được so **bằng nhau chính xác**, nên nó đỏ theo cả hai chiều:
 * thêm một chỗ render `message` mà không khai ở đây thì đỏ, mà gỡ một ngoại lệ
 * khỏi code rồi quên xoá dòng này cũng đỏ. Một quy tắc mềm không làm được điều
 * thứ hai.
 *
 * ADR ghi ngưỡng xét lại: quá **ba** dòng nghĩa là ranh giới đang bị đẩy dần,
 * và phải chuyển sang mở `details` theo code thay vì thêm ngoại lệ văn xuôi.
 */
const EXCEPTIONS: { file: string; why: string }[] = [
  {
    file: join("features", "invitations", "accept-invitation.tsx"),
    why: "FORBIDDEN của POST /invitations/accept khi email actor không khớp email được mời — ngoại lệ duy nhất có tên trong ADR-0016 mục 4.",
  },
];

/**
 * `lib/query.tsx` gọi `super(failure.message)`.
 *
 * Đó **không** phải vi phạm và cũng không phải một ngoại lệ: `.message` của một
 * `Error` chính là vai chẩn đoán mà ADR mô tả — nó đi vào stack trace, không đi
 * ra màn hình.
 *
 * Vì vậy phạm vi quét là `features/` và `app/`, nơi có bề mặt người dùng.
 * `lib/` là tầng kỹ thuật và được canh bằng một khẳng định riêng bên dưới:
 * đúng **một** lần dùng, và nó là lần `super()` đó.
 */
const DIAGNOSTIC_USE = join("lib", "query.tsx");

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
      if (entry.endsWith(".tsx")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Bỏ chú thích trước khi quét: nhắc tới quy tắc không phải là vi phạm quy tắc. */
function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line))
    .join("\n");
}

function offendersIn(file: string): number {
  return [...withoutComments(readFileSync(file, "utf8")).matchAll(FAILURE_MESSAGE)].length;
}

describe("ADR-0016 — chữ hiển thị thuộc frontend", () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(join(WEB_SRC, dir)));

  it("quét được một tập tệp không rỗng", () => {
    // Một guard quét nhầm thư mục rỗng sẽ luôn xanh và không bảo vệ gì.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.includes(`features${sep}tasks`))).toBe(true);
  });

  it("chỉ những tệp trong bảng ngoại lệ render message của server", () => {
    const found = files
      .filter((file) => offendersIn(file) > 0)
      .map((file) => relative(WEB_SRC, file))
      .sort();

    expect(found).toEqual(EXCEPTIONS.map((entry) => entry.file).sort());
  });

  it("bảng ngoại lệ vẫn đúng một dòng", () => {
    // ADR-0016 đặt ngưỡng xét lại ở ba dòng. Khẳng định con số hôm nay để lần
    // thêm thứ hai là một quyết định có người đọc, không phải một dòng trôi vào.
    expect(EXCEPTIONS).toHaveLength(1);
    for (const entry of EXCEPTIONS) expect(entry.why.length).toBeGreaterThan(40);
  });

  it("mỗi feature có chữ lỗi đều để nó ở `messages.ts`", () => {
    // Gom theo feature là điều làm giọng văn **rà được**: đọc mười tệp thay vì
    // grep mười sáu component.
    const featureRoot = join(WEB_SRC, "features");
    const withMessages = readdirSync(featureRoot).filter((feature) => {
      try {
        return statSync(join(featureRoot, feature, "messages.ts")).isFile();
      } catch {
        return false;
      }
    });
    expect(withMessages.sort()).toEqual(
      ["auth", "board", "members", "projects", "system", "tasks", "workspaces"].sort(),
    );
  });

  it("`lib/` dùng message đúng một lần, và đó là vai chẩn đoán", () => {
    const libFiles = sourceFiles(join(WEB_SRC, "lib")).concat(join(WEB_SRC, "lib", "transport.ts"));
    const uses = libFiles.flatMap((file) =>
      [...withoutComments(readFileSync(file, "utf8")).matchAll(FAILURE_MESSAGE)].map(() => file),
    );
    expect(uses.map((file) => relative(WEB_SRC, file))).toEqual([DIAGNOSTIC_USE]);
    expect(readFileSync(join(WEB_SRC, DIAGNOSTIC_USE), "utf8")).toContain("super(failure.message)");
  });

  it("guard thật sự bắt được vi phạm", () => {
    // Nếu không tự kiểm điều này thì một regex hỏng sẽ làm cả guard vô dụng mà
    // vẫn xanh mãi mãi.
    const sample = "<FbAlert title={failure.message} />";
    expect([...sample.matchAll(FAILURE_MESSAGE)]).toHaveLength(1);
    const scoped = "<FbAlert title={reorderFailure.message} />";
    expect([...scoped.matchAll(FAILURE_MESSAGE)]).toHaveLength(1);
  });

  it("guard KHÔNG bắt nhầm `.message` của Error hay của field error", () => {
    for (const safe of [
      "super(error.message)",
      "issue.message",
      "return failure.fieldErrors.find((e) => e.field === field)?.message;",
    ]) {
      expect([...safe.matchAll(FAILURE_MESSAGE)]).toHaveLength(0);
    }
  });
});
