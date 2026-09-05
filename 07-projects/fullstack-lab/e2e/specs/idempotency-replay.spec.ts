import { expect, test, type Request } from "@playwright/test";
import { apiCall, newAccount, register, signIn, visit } from "../src/app.ts";
import { count, literal } from "../src/db.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * `Idempotency-Key` được **phát lại**, không phải được gửi lần đầu hai lần.
 *
 * Hợp đồng nói: cùng một key với cùng một payload phải trả **kết quả đã lưu**,
 * và không tạo hiệu ứng thứ hai. Bộ kiểm ở `apps/web` chỉ chứng minh được
 * client giữ nguyên key — nó không chạm được vào phần "server nhớ". Bài này
 * chạm, và nó **đếm số hàng trong bảng** thay vì tin vào màn hình: hai hàng mà
 * danh sách chỉ hiện một là đúng hình dạng của bug này.
 *
 * Cách chặn response mô phỏng đúng ca tệ nhất: request **đã tới server và đã
 * được thực thi**, nhưng client không bao giờ thấy câu trả lời. Đó là lý do
 * `Idempotency-Key` tồn tại; một bài kiểm chặn request *trước* khi nó tới
 * server sẽ không kiểm gì cả.
 */

test.describe.configure({ mode: "serial" });

/** Một tài khoản cho cả tệp — cùng lý do như `session-csrf.spec.ts`. */
const ACTOR = newAccount("replay");
let registered = false;

async function ready(page: Parameters<typeof register>[0]): Promise<void> {
  if (registered) {
    await signIn(page, ACTOR);
    return;
  }
  await register(page, ACTOR);
  registered = true;
}

test.afterAll(async () => {
  await disposeMailpit();
});

test("response bị nuốt rồi gửi lại cùng key: đúng một workspace được tạo", async ({ page }) => {
  await ready(page);

  const name = `Replay ${Date.now().toString(36)}`;
  const where = `select count(*) from workspaces where name = ${literal(name)}`;
  expect(count(where), "tên workspace phải là mới").toBe(0);

  const keys: string[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/workspaces")) return;
    const key = request.headers()["idempotency-key"];
    if (key !== undefined) keys.push(key);
  });

  let seen = 0;
  await page.route("**/workspaces", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    seen += 1;
    if (seen > 1) {
      await route.continue();
      return;
    }
    // Lần đầu: **cho request đi tới server** rồi vứt câu trả lời. Client thấy
    // một lỗi vận chuyển và không biết server đã ghi hay chưa.
    //
    // `timeout` để một lần rớt kết nối không treo cả spec: dù `fetch` có kết
    // thúc hay không, request đã rời đi và bước kế tiếp **đếm hàng trong bảng**
    // để biết server đã ghi hay chưa. Câu trả lời đến từ database, không từ đây.
    try {
      await route.fetch({ timeout: 20_000 });
    } catch {
      // Nuốt đúng chỗ này thôi: chính việc client không thấy câu trả lời là
      // điều kiện mà bài kiểm dựng ra.
    }
    await route.abort("connectionaborted");
  });

  await visit(page, "/khong-gian-lam-viec");
  await page.getByRole("button", { name: "Tạo không gian" }).first().click();
  await page.getByLabel("Tên không gian").fill(name);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Tạo không gian" }).click();

  // Giao diện phải nói đúng điều đã xảy ra: **chưa có câu trả lời**, không phải
  // "thất bại, hãy thử lại". Đây là chỗ M5.5 bắt được một lỗi chữ nghĩa có hậu
  // quả thật — xem `NO_RESPONSE` trong `features/system/messages.ts`.
  await expect(dialog.getByText(/Không nhận được phản hồi từ máy chủ/)).toBeVisible();
  await expect(dialog.getByText(/Hãy thử lại\.$/)).toHaveCount(0);

  // Server **đã** ghi, dù client không biết.
  expect(count(where), "request đầu chưa từng tới server, bài kiểm này không kiểm được gì").toBe(1);

  // Người dùng bấm lại đúng nút đó, không sửa gì. Đây là retry, không phải ý
  // định mới, nên key phải giữ nguyên.
  await dialog.getByRole("button", { name: "Tạo không gian" }).click();
  await page.waitForURL(/\/khong-gian-lam-viec\/[0-9a-f-]{36}$/);

  expect(keys.length, `mong đợi đúng hai lần gửi, nhận được ${String(keys.length)}`).toBe(2);
  expect(keys[0], "client xoay key khi chỉ gửi lại vì lỗi mạng — đó là bug của client").toBe(
    keys[1],
  );

  // Và đây là câu hỏi thật: server có nhớ không.
  expect(
    count(where),
    "gửi lại cùng Idempotency-Key tạo ra workspace thứ hai — hợp đồng nói phải trả kết quả đã lưu",
  ).toBe(1);
});

test("cùng key nhưng payload khác: server phải từ chối, không âm thầm ghi đè", async ({ page }) => {
  await ready(page);

  const key = crypto.randomUUID();
  const first = `Reuse mot ${Date.now().toString(36)}`;
  const second = `Reuse hai ${Date.now().toString(36)}`;

  const created = await apiCall(page, "POST", "/workspaces", {
    body: { name: first },
    idempotencyKey: key,
  });
  expect(created.status).toBe(201);

  const reused = await apiCall(page, "POST", "/workspaces", {
    body: { name: second },
    idempotencyKey: key,
  });

  // Không được là `201`: nghĩa là key bị bỏ qua. Không được là `200` với kết
  // quả cũ mà không báo gì: client sẽ tưởng tên mới đã được ghi.
  expect(
    reused.code,
    `dùng lại key với payload khác trả ${String(reused.status)} ${reused.code ?? "(không có code)"}`,
  ).toBe("IDEMPOTENCY_KEY_REUSED");
  expect(count(`select count(*) from workspaces where name = ${literal(second)}`)).toBe(0);
});
