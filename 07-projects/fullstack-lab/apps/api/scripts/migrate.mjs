/**
 * Command migration **có tên**, theo `docs/operations/local-development.md`:
 *
 * > "Chỉ một command migration có tên rõ ràng được gọi explicit bởi developer
 * > hoặc deploy controller; nó báo database target, migration version/result và
 * > fail non-zero."
 *
 * Trước đây không có script nào và CI gọi thẳng `drizzle-kit migrate`. Khác
 * biệt không phải hình thức: một lệnh migration **không nói nó sắp sửa cái gì**
 * là một lệnh người ta chạy nhầm môi trường, và người chạy chỉ biết khi dữ liệu
 * đã đổi.
 *
 * Chạy: `pnpm --filter @flowboard/api migrate`
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "drizzle");

/**
 * Mô tả database **không kèm mật khẩu**.
 *
 * Cùng quy tắc với `ConfigError`: log ghi *tên* chứ không ghi *giá trị*. Một
 * thông báo tiện tay in ra connection string là một lần rò secret vào log CI,
 * và log CI thì ai cũng đọc được.
 */
function describeTarget(url) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "") || "(mặc định)";
    // `username` an toàn để in — nó không phải bí mật, và nó là thứ phân biệt
    // một identity migration với một identity runtime.
    const user = parsed.username || "(không rõ)";
    return { host: parsed.host, database, user };
  } catch {
    return undefined;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[migrate] Thiếu DATABASE_URL.\n" +
      "  Chạy trên host: nạp .env và .env.host, hoặc đặt biến trước khi gọi.\n" +
      "  Giá trị cố ý không được in ra.",
  );
  process.exit(1);
}

const target = describeTarget(url);
if (!target) {
  console.error("[migrate] DATABASE_URL không phải một URL hợp lệ. Giá trị không được in ra.");
  process.exit(1);
}

/** Migration đã có trên đĩa — "version" mà lệnh này sắp áp dụng tới. */
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

console.warn("[migrate] database đích:");
console.warn(`[migrate]   host     ${target.host}`);
console.warn(`[migrate]   database ${target.database}`);
console.warn(`[migrate]   user     ${target.user}`);
console.warn(`[migrate] migration trên đĩa: ${String(files.length)} file`);
console.warn(`[migrate] mới nhất: ${files.at(-1) ?? "(chưa có)"}`);

/**
 * `drizzle-kit` là thứ thật sự áp migration; script này chỉ nói trước nó sắp
 * làm gì rồi chuyển tiếp mã thoát.
 *
 * `shell: true` trên Windows để `npx.cmd` được tìm thấy; đối số cố định, không
 * có gì từ input người dùng đi vào dòng lệnh.
 */
const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
  cwd: join(here, ".."),
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.error(`[migrate] THẤT BẠI trên ${target.host}/${target.database}.`);
  // Fail non-zero: một migration hỏng mà trả `0` sẽ để deploy đi tiếp.
  process.exit(result.status ?? 1);
}

console.warn(
  `[migrate] xong — ${target.host}/${target.database} đã ở ${files.at(-1) ?? "(trống)"}`,
);
