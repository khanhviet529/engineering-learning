import { expect, test } from "@playwright/test";
import { apiCall, createWorkspace, newAccount, register, signIn, visit } from "../src/app.ts";
import { API_BASE_URL } from "../src/env.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * Phiên và CSRF, đo **trong trình duyệt thật**.
 *
 * Không bộ kiểm nào ở `apps/web` chạm được vào những thứ dưới đây, vì jsdom
 * không có cookie jar theo `SameSite`, không cưỡng chế `Secure`, và không có
 * khái niệm cross-origin thật. Mà đúng bốn thuộc tính đó là thứ quyết định
 * sản phẩm chạy được hay không trên máy người dùng.
 *
 * `Secure` là cái bẫy im lặng: bật nó trên `http://localhost` thì trình duyệt
 * **không gửi cookie**, mọi request thành `401`, và triệu chứng trông như
 * "backend hỏng" chứ không như "cấu hình cookie sai".
 */

test.describe.configure({ mode: "serial" });

/**
 * **Một** tài khoản cho cả tệp.
 *
 * `POST /auth/sign-up` bị giới hạn 5 lần mỗi phút mỗi IP, và cả bộ E2E đi ra từ
 * một IP. Ba bài kiểm dưới đây không cần ba danh tính khác nhau — chúng cần ba
 * **phiên** khác nhau, mà đăng nhập lại là đủ. Tạo ba tài khoản chỉ để tiêu
 * ngân sách của giới hạn đó.
 */
const ACTOR = newAccount("phien");
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

test("cookie phiên: HttpOnly, SameSite dùng được cross-origin, và KHÔNG Secure ở local", async ({
  page,
  context,
}) => {
  await ready(page);

  const cookies = await context.cookies();
  expect(cookies.length, "đăng nhập xong mà không có cookie nào").toBeGreaterThan(0);

  // Không đoán tên cookie: lấy cookie do chính origin của API đặt.
  const apiHost = new URL(API_BASE_URL).hostname;
  const session = cookies.find(
    (cookie) => cookie.domain.replace(/^\./, "") === apiHost && cookie.value !== "",
  );
  expect(
    session,
    `không có cookie nào từ ${apiHost}; cookie thấy được: ${describe(cookies)}`,
  ).toBeDefined();
  if (session === undefined) return;

  // Phiên là cookie opaque và **không** được đọc từ JavaScript.
  expect(session.httpOnly, `${session.name} phải là HttpOnly`).toBe(true);

  // `http://localhost` không có TLS. Cookie `Secure` sẽ không bao giờ được gửi,
  // và triệu chứng là `401` ở khắp nơi chứ không phải một lỗi đọc được.
  expect(session.secure, `${session.name} không được Secure khi chạy trên http`).toBe(false);

  // Cookie phải phủ toàn bộ API, không chỉ một nhánh đường dẫn.
  expect(session.path).toBe("/");

  // `document.cookie` không được nhìn thấy nó.
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain(session.value);

  // Và điều **thật sự** phải đúng: cookie đi được từ web (:3000) sang api
  // (:3001). Khẳng định một giá trị `SameSite` cụ thể ở đây sẽ là kiểm nhầm
  // thứ — `SameSite` tính theo *site* chứ không theo origin, và hai cổng của
  // cùng `localhost` là cùng site, nên `Lax` vẫn gửi được. Bài kiểm hỏi kết
  // quả, không hỏi thuộc tính.
  const [request] = await Promise.all([
    page.waitForRequest(
      (candidate) => candidate.url().startsWith(API_BASE_URL) && candidate.method() === "GET",
    ),
    page.goto("/khong-gian-lam-viec"),
  ]);
  expect(
    await request.headerValue("cookie"),
    "request từ :3000 sang :3001 không mang cookie phiên",
  ).toContain(session.name);
  await expect(page.getByRole("heading", { name: "Chọn không gian làm việc" })).toBeVisible();
});

test("CSRF token đi trọn một vòng: thiếu header thì mutation bị từ chối", async ({ page }) => {
  await ready(page);

  // Đường bình thường: transport đọc token từ `GET /auth/session` rồi gắn vào
  // header. Bắt đúng request đó để chắc chắn nó **thực sự** được gửi đi.
  const [request] = await Promise.all([
    page.waitForRequest(
      (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/workspaces"),
    ),
    createWorkspace(page, `Csrf ${Date.now().toString(36)}`),
  ]);
  const sent = await request.headerValue("x-csrf-token");
  expect(sent, "mutation gửi đi mà không có x-csrf-token").toBeTruthy();

  // Đường bị chặn: cùng cookie, cùng body, **thiếu** token.
  const withoutToken = await apiCall(page, "POST", "/workspaces", {
    body: { name: `Khong token ${Date.now().toString(36)}` },
    idempotencyKey: crypto.randomUUID(),
    csrfToken: null,
  });
  expect(
    withoutToken.status,
    `mutation không có CSRF token vẫn được chấp nhận (${withoutToken.status}) — cookie một mình là đủ để ghi`,
  ).toBe(403);

  // Đường bị chặn thứ hai: token sai, không phải token thiếu.
  const wrongToken = await apiCall(page, "POST", "/workspaces", {
    body: { name: `Sai token ${Date.now().toString(36)}` },
    idempotencyKey: crypto.randomUUID(),
    csrfToken: "khong-phai-token-cua-phien-nay",
  });
  expect(wrongToken.status, "token sai vẫn ghi được").toBe(403);
});

test("mất cookie giữa chừng: mutation kế tiếp là 401 và UI đi tới SYS-02", async ({
  page,
  context,
}) => {
  await ready(page);
  const workspaceId = await createWorkspace(page, `Mat cookie ${Date.now().toString(36)}`);

  // Người dùng vẫn đang ở trong app, màn hình vẫn đầy dữ liệu — rồi cookie biến
  // mất. Đây đúng là hình dạng của một phiên hết hạn giữa chừng.
  await visit(page, `/khong-gian-lam-viec/${workspaceId}`);
  await expect(page.getByRole("heading", { name: "Dự án bạn có thể truy cập" })).toBeVisible();

  await context.clearCookies();

  const afterLogout = await apiCall(page, "POST", `/workspaces/${workspaceId}/projects`, {
    body: { name: "Sau khi mat cookie" },
    idempotencyKey: crypto.randomUUID(),
    csrfToken: null,
  });
  expect(afterLogout.status, "không có cookie mà vẫn ghi được").toBe(401);
  expect(afterLogout.code).toBe("UNAUTHENTICATED");

  // Và giao diện phải nói "phiên đã kết thúc", không phải "lỗi kết nối":
  // `SYS-03` sẽ mời người dùng thử lại một việc chắc chắn không bao giờ chạy.
  await page.reload();
  await expect(page.locator('[data-screen="SYS-02"]')).toBeVisible();
  await expect(page.getByText("Phiên làm việc đã kết thúc")).toBeVisible();
  await expect(page.locator('[data-screen="SYS-03"]')).toHaveCount(0);
});

function describe(cookies: readonly { name: string; domain: string }[]): string {
  return cookies.map((cookie) => `${cookie.name}@${cookie.domain}`).join(", ") || "(không có)";
}
