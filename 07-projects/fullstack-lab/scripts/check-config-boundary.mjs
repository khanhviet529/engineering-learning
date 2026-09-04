/**
 * Ranh giới config: script `dev` được nạp file env, `start` thì **không**.
 *
 * Vì sao cần một bộ kiểm thay vì một quy tắc trong tài liệu: hôm nay `start` là
 * `node dist/main.js` và đúng, nhưng nó đúng vì có người viết đúng. Thêm
 * `--env-file` vào `start` cho đỡ phải cấu hình trông như một đơn giản hoá nhỏ,
 * và nó âm thầm đưa secret của production về nằm cạnh code — production phải
 * lấy biến từ environment do nền tảng cấp, không từ file trên đĩa.
 *
 * Cùng lối `web-routes.test.ts` đọc `src/app` trên đĩa: kiểm **thực tại**, không
 * kiểm một hằng số khác. Đọc chính `package.json` mà runtime sẽ chạy.
 *
 * Chạy: `node scripts/check-config-boundary.mjs`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Dấu hiệu một script nạp config từ file. */
const FILE_LOADERS = ["--env-file", "--env-file-if-exists", "dotenv", "loadEnvFile", "env-cmd"];

/**
 * `start` là lệnh production chạy. `build` và `typecheck` không nhận biến runtime
 * nên chúng không nằm trong danh sách; `dev` và `test` được phép nạp file.
 */
const FORBIDDEN_IN = ["start"];

const workspaces = ["apps/api", "apps/web"];
const problems = [];

for (const ws of workspaces) {
  const manifestPath = join(root, ws, "package.json");
  const scripts = JSON.parse(readFileSync(manifestPath, "utf8")).scripts ?? {};

  for (const name of FORBIDDEN_IN) {
    const command = scripts[name];
    if (command === undefined) continue;
    for (const loader of FILE_LOADERS) {
      if (!command.includes(loader)) continue;
      problems.push(
        `${ws}/package.json script "${name}" nạp config từ file (${loader}).\n` +
          `  Lệnh hiện tại: ${command}\n` +
          `  Production đọc biến từ environment do nền tảng cấp, không từ file trên đĩa.\n` +
          `  Cần nạp file cho local thì đặt vào "dev", đừng đặt vào "${name}".\n` +
          `  Xem docs/operations/local-development.md, mục "Configuration và secret policy".`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Ranh giới config bị vi phạm:\n\n" + problems.join("\n\n"));
  process.exit(1);
}

console.warn(`OK — ${workspaces.length} workspace, "start" không nạp config từ file.`);
