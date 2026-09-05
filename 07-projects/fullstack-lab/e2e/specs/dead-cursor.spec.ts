import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInvitation,
  apiCall,
  createProject,
  createWorkspace,
  inviteToWorkspace,
  newAccount,
  register,
  visit,
  type Account,
} from "../src/app.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * Cursor chết vì **phạm vi đổi**, không phải vì filter sai.
 *
 * `MYT-01` phân trang cả workspace bằng **một** cursor, và cursor đó gắn với
 * tập project mà actor nhìn thấy **tại lúc nó được phát**. Gỡ actor khỏi một
 * project ở giữa chừng làm cursor mất nghĩa, và server phải nói ra — trả tiếp
 * một trang "gần đúng" là trả một danh sách mà người dùng tin nhưng sai.
 *
 * Điều bộ kiểm này canh ở phía frontend: `400` ở **trang sau** là "danh sách
 * đã đổi", còn `400` ở **trang đầu** vẫn là lỗi thật. Gộp hai ca lại sẽ giấu
 * một lỗi lập trình sau một câu trấn an.
 *
 * `PAGE_LIMIT_DEFAULT` là 25, nên cần hơn 50 việc để còn một trang thứ ba mà
 * hỏi. Chúng được tạo bằng HTTP thật, cookie thật, `Idempotency-Key` thật —
 * chỉ là không qua form, vì 55 lần điền form không kiểm thêm được gì mà bài
 * này chưa kiểm ở golden path.
 */

const PAGE_LIMIT = 25;
const TASKS_IN_MAIN = 40;
const TASKS_IN_SECOND = 20;

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await disposeMailpit();
});

async function newSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function firstColumnId(page: Page, projectId: string): Promise<string> {
  const detail = await apiCall(page, "GET", `/projects/${projectId}`);
  const columns = (detail.body as { data: { columns: { id: string }[] } }).data.columns;
  const id = columns[0]?.id;
  if (id === undefined) throw new Error("dự án không có cột nào");
  return id;
}

async function addColumnViaApi(page: Page, projectId: string, name: string): Promise<void> {
  const result = await apiCall(page, "POST", `/projects/${projectId}/columns`, {
    body: { name, afterColumnId: null, isTerminal: false, requiresReviewer: false },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(result.status, `không tạo được cột ${name}`).toBe(201);
}

async function seedTasksThroughApi(
  page: Page,
  projectId: string,
  assigneeId: string,
  count: number,
  prefix: string,
): Promise<void> {
  const columnId = await firstColumnId(page, projectId);
  for (let index = 0; index < count; index += 1) {
    const result = await apiCall(page, "POST", `/projects/${projectId}/tasks`, {
      body: { title: `${prefix} ${String(index).padStart(2, "0")}`, columnId, assigneeId },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result.status, `không tạo được việc thứ ${String(index)}`).toBe(201);
  }
}

test("MYT-01: gỡ actor khỏi một dự án giữa chừng thì cursor chết và màn hình nói ra", async ({
  browser,
}) => {
  const owner: Account = newAccount("quantri");
  const worker: Account = newAccount("nhanviec");

  const ownerPage = await newSession(browser);
  const workerPage = await newSession(browser);

  await register(ownerPage, owner);
  await register(workerPage, worker);

  const stamp = Date.now().toString(36);
  const workspaceId = await createWorkspace(ownerPage, `Pham vi ${stamp}`);
  await inviteToWorkspace(ownerPage, workspaceId, worker.email);
  await acceptInvitation(workerPage, worker.email);

  const members = await apiCall(ownerPage, "GET", `/workspaces/${workspaceId}/members`);
  const workerId = (
    members.body as { data: { items: { userId: string; email: string }[] } }
  ).data.items.find((item) => item.email === worker.email)?.userId;
  expect(workerId, "không tìm được userId của người được giao việc").toBeDefined();
  if (workerId === undefined) return;

  const mainProject = await createProject(ownerPage, workspaceId, `Du an chinh ${stamp}`);
  const secondProject = await createProject(ownerPage, workspaceId, `Du an phu ${stamp}`);

  for (const projectId of [mainProject, secondProject]) {
    await addColumnViaApi(ownerPage, projectId, "Chờ làm");
    const added = await apiCall(ownerPage, "POST", `/projects/${projectId}/members`, {
      body: { userId: workerId, role: "editor" },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(added.status).toBe(201);
  }

  await seedTasksThroughApi(ownerPage, mainProject, workerId, TASKS_IN_MAIN, `Chinh ${stamp}`);
  await seedTasksThroughApi(ownerPage, secondProject, workerId, TASKS_IN_SECOND, `Phu ${stamp}`);

  // Trang 1 → 25 việc, còn nữa.
  await visit(workerPage, `/viec-cua-toi?workspace=${workspaceId}`);
  await expect(workerPage.getByRole("table", { name: "Việc được giao cho tôi" })).toBeVisible();
  await expect(workerPage.getByText(`Đã nạp ${String(PAGE_LIMIT)} · còn nữa`)).toBeVisible();

  // Trang 2 → 50 việc, vẫn còn nữa: cursor cho trang 3 đã được phát.
  await workerPage.getByRole("button", { name: "Tải thêm" }).click();
  await expect(workerPage.getByText(`Đã nạp ${String(PAGE_LIMIT * 2)} · còn nữa`)).toBeVisible();

  // Phạm vi đổi **dưới chân người dùng**: Owner gỡ họ khỏi dự án phụ.
  const removed = await apiCall(
    ownerPage,
    "DELETE",
    `/projects/${secondProject}/members/${workerId}`,
    { idempotencyKey: crypto.randomUUID() },
  );
  expect(
    removed.status,
    `không gỡ được thành viên: ${String(removed.status)} ${removed.code ?? ""}`,
  ).toBe(204);

  // Trang 3 dùng cursor phát ra dưới phạm vi cũ.
  const pageThree = workerPage.waitForResponse((response) =>
    response.url().includes(`/workspaces/${workspaceId}/tasks`),
  );
  await workerPage.getByRole("button", { name: "Tải thêm" }).click();
  const response = await pageThree;

  expect(
    response.status(),
    `cursor phát dưới phạm vi cũ vẫn được phục vụ (${String(response.status())}) — trang trả về không còn nghĩa`,
  ).toBe(400);

  // Và màn hình nói **danh sách đã đổi**, không phải một màn lỗi hệ thống.
  await expect(workerPage.getByText("Danh sách đã thay đổi trong lúc bạn đang xem")).toBeVisible();
  await expect(workerPage.locator('[data-screen="SYS-03"]')).toHaveCount(0);
  await expect(workerPage.locator('[data-screen="SYS-01"]')).toHaveCount(0);

  // Về trang đầu: đúng một trang, và không còn việc nào của dự án đã bị gỡ.
  await expect(workerPage.getByText(`Đã nạp ${String(PAGE_LIMIT)} · còn nữa`)).toBeVisible();
  await expect(
    workerPage.getByRole("rowheader", { name: new RegExp(`^Phu ${stamp}`) }),
  ).toHaveCount(0);
});
