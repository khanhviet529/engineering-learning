import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInvitation,
  apiCall,
  createProject,
  createWorkspace,
  inviteToWorkspace,
  newAccount,
  register,
  seedTasks,
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
 *
 * **Trình tự là một phần của bài kiểm.** Hợp đồng không cho gỡ một thành viên
 * còn đang giữ việc, nên việc phải được trả lại trước — nhưng chỉ **sau** khi
 * client đã cầm cursor của trang 3. Nếu trả việc trước khi phân trang thì
 * không còn đủ việc để có trang thứ ba, và bài kiểm sẽ không hỏi được câu nó
 * sinh ra để hỏi.
 *
 * Một điều bài kiểm này **không** tách được: sau bước trả việc, hai mươi việc
 * của dự án phụ rời khỏi danh sách của actor vì hai lý do cùng lúc — chúng
 * không còn được giao cho họ, **và** họ không còn ở dự án đó. Bằng chứng cho
 * "cursor chết vì phạm vi đổi" nằm ở chính mã `400`, không ở việc các dòng đó
 * biến mất.
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

/**
 * Trả mọi việc trong một dự án về `assigneeId: null`.
 *
 * Đây **không** phải một cách né lỗi. [Hợp đồng endpoint](../../docs/api/endpoint-contracts.md)
 * nói `DELETE /projects/:projectId/members/:userId` chỉ trả `204` khi dự án còn
 * tối thiểu một Owner **và** người bị gỡ không còn là assignee của việc nào
 * trong dự án. Gỡ một người đang giữ hai mươi việc phải nhận
 * `409 MEMBER_HAS_ASSIGNED_TASKS`, và đó là câu trả lời **đúng**.
 *
 * Bài kiểm này không sinh ra để kiểm bất biến đó — nó sinh ra để kiểm một
 * cursor chết khi phạm vi đổi. Vì vậy nó phải dọn điều kiện chặn trước, bằng
 * đúng route mà sản phẩm có, rồi mới đổi phạm vi.
 *
 * Thời điểm gọi là một phần của bài kiểm: nó chạy **sau** khi worker đã nạp
 * xong trang 1 và trang 2, nên cursor cho trang 3 đã nằm trong tay client
 * trước khi bất cứ thứ gì đổi.
 */
async function unassignEveryTask(page: Page, projectId: string): Promise<void> {
  const columnId = await firstColumnId(page, projectId);
  const list = await apiCall(
    page,
    "GET",
    `/projects/${projectId}/tasks?columnId=${columnId}&limit=100`,
  );
  expect(list.status, "không đọc được danh sách việc để trả lại").toBe(200);
  const items = (list.body as { data: { items: { id: string; version: number }[] } }).data.items;
  expect(items.length, "dự án phụ phải có việc để trả lại").toBeGreaterThan(0);

  for (const task of items) {
    const patched = await apiCall(page, "PATCH", `/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assigneeId: null },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      patched.status,
      `không trả lại được việc ${task.id}: ${String(patched.status)} ${patched.code ?? ""}`,
    ).toBe(200);
  }
}

async function seedTasksThroughApi(
  page: Page,
  projectId: string,
  assigneeId: string,
  count: number,
  prefix: string,
): Promise<void> {
  await seedTasks(page, {
    projectId,
    columnId: await firstColumnId(page, projectId),
    assigneeId,
    prefix,
    count,
  });
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

  // Dọn điều kiện chặn của hợp đồng **sau khi** cursor trang 3 đã được phát:
  // không ai gỡ được một thành viên còn đang giữ việc. Xem `unassignEveryTask`.
  await unassignEveryTask(ownerPage, secondProject);

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

  // Về trang đầu: đúng một trang, và danh sách chỉ còn việc của dự án chính.
  await expect(workerPage.getByText(`Đã nạp ${String(PAGE_LIMIT)} · còn nữa`)).toBeVisible();
  await expect(
    workerPage.getByRole("rowheader", { name: new RegExp(`^Phu ${stamp}`) }),
  ).toHaveCount(0);
});
