import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createTask,
  newAccount,
  register,
  setupBoard,
  signIn,
  visit,
  type Account,
} from "../src/app.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * Hai tab, một công việc.
 *
 * Đây là bài kiểm mà mock không dựng được: nó cần **hai phiên trình duyệt
 * thật** đọc cùng một `version`, rồi cùng ghi. Bộ kiểm ở `apps/web` chỉ chứng
 * minh được rằng khi server trả `409` thì `SYS-04` mở ra — nó không chứng minh
 * được rằng server **thật sự** trả `409` thay vì để người sau ghi đè người
 * trước.
 *
 * Ba điều phải đúng cùng lúc:
 *
 * 1. Đúng **một** bên thắng.
 * 2. Bên thua nhận `409` kèm `currentVersion`, không phải một lỗi chung chung.
 * 3. `SYS-04` mở một **đường xem lại dữ liệu hiện tại**, không có nút ghi đè.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await disposeMailpit();
});

async function newSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("hai tab cùng sửa một công việc: một bên thắng, bên kia thấy SYS-04", async ({ browser }) => {
  const account: Account = newAccount("haitab");
  const tabA = await newSession(browser);
  const tabB = await newSession(browser);

  await register(tabA, account);
  const { projectId } = await setupBoard(tabA, ["Chờ làm", "Xong"]);

  const original = `Viec tranh chap ${Date.now().toString(36)}`;
  await createTask(tabA, { title: original, column: "Chờ làm" });

  // Tab thứ hai là **cùng người dùng, phiên khác** — đúng hình dạng "mở hai tab".
  // Tài khoản đã tồn tại và đã xác minh, nên chỉ đăng nhập.
  await signIn(tabB, account);

  // Cả hai mở form sửa **trước khi** bên nào ghi: cùng đọc một `version`.
  for (const tab of [tabA, tabB]) {
    await visit(tab, `/du-an/${projectId}/bang-cong-viec`);
    await tab
      .getByRole("region", { name: "Chờ làm" })
      .getByRole("button", { name: original, exact: true })
      .click();
    await expect(tab.getByRole("dialog", { name: original })).toBeVisible();
    await tab.getByRole("button", { name: "Sửa công việc" }).click();
    await expect(tab.getByLabel("Tiêu đề")).toHaveValue(original);
  }

  const winnerTitle = `${original} — ban A`;
  const loserTitle = `${original} — ban B`;

  // A lưu trước và thắng. Neo vào việc form **đóng lại**, không vào câu công
  // bố: cùng một câu được phát cho cả lần tạo lẫn lần sửa, nên một câu còn sót
  // sẽ làm bài kiểm xanh trong khi lần sửa vừa thất bại.
  await tabA.getByLabel("Tiêu đề").fill(winnerTitle);
  await tabA.getByRole("button", { name: "Lưu công việc" }).click();
  await expect(
    tabA.getByRole("dialog", { name: "Sửa công việc" }),
    "bên thắng cũng không lưu được — xem cors-preflight.spec.ts trước khi đọc tiếp",
  ).toHaveCount(0);

  // B lưu sau, trên `expectedVersion` đã cũ.
  // Timeout ngắn và có chủ ý: nếu `PATCH` không **rời được trình duyệt** — ví
  // dụ preflight CORS không liệt kê method — thì không response nào tới, và
  // chờ năm phút chỉ làm thông điệp lỗi khó đọc hơn.
  const conflictResponse = tabB.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/tasks\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname),
    { timeout: 20_000 },
  );
  await tabB.getByLabel("Tiêu đề").fill(loserTitle);
  await tabB.getByRole("button", { name: "Lưu công việc" }).click();

  const response = await conflictResponse;
  expect(response.status(), "bên thứ hai ghi đè được — không có optimistic lock").toBe(409);

  const payload = (await response.json()) as {
    error?: { code?: string; details?: { currentVersion?: number } };
  };
  expect(payload.error?.code).toBe("TASK_VERSION_CONFLICT");
  expect(
    payload.error?.details?.currentVersion,
    "409 không mang currentVersion, nên client không có gì để gửi lại",
  ).toBeGreaterThan(0);

  // `SYS-04`: không có nút ghi đè, và có đường xem lại bản hiện tại.
  const conflict = tabB.getByRole("dialog", { name: "Công việc đã được thay đổi" });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByText("Không có nút ghi đè.")).toBeVisible();
  await expect(conflict.getByRole("button", { name: /Ghi đè/ })).toHaveCount(0);
  await expect(conflict.getByRole("button", { name: "Bỏ bản nháp" })).toBeVisible();

  // Đường xem lại phải mở form trên **dữ liệu hiện tại**, tức là bản của A.
  await conflict.getByRole("button", { name: "Sửa trên bản hiện tại" }).click();
  await expect(tabB.getByLabel("Tiêu đề")).toHaveValue(winnerTitle);

  // Và bản của B chưa từng được ghi.
  await tabA.reload();
  await expect(
    tabA
      .getByRole("region", { name: "Chờ làm" })
      .getByRole("button", { name: winnerTitle, exact: true }),
  ).toBeVisible();
  await expect(tabA.getByRole("button", { name: loserTitle, exact: true })).toHaveCount(0);
});
