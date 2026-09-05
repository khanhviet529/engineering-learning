import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInvitation,
  apiCall,
  createTask,
  inviteToWorkspace,
  newAccount,
  register,
  setupBoard,
  visit,
  type Account,
} from "../src/app.ts";
import { disposeMailpit } from "../src/mailpit.ts";

/**
 * Viewer gọi thẳng HTTP.
 *
 * Ẩn nút không phải là phân quyền. Bài này lấy cookie **thật** của một Viewer
 * thật rồi gọi những endpoint mà giao diện cố tình không cho họ thấy, để chứng
 * minh server tự đứng vững khi không có giao diện nào che chắn.
 *
 * Và nó tách hai câu trả lời mà rất dễ bị gộp:
 *
 * - `403` cho một action mà actor **đã thấy được resource** nhưng thiếu quyền.
 * - `404` cho một resource **ngoài phạm vi** actor. Trả `403` ở đây là đã xác
 *   nhận rằng dự án đó có thật — một rò rỉ nhỏ mà đủ để dò cả hệ thống.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await disposeMailpit();
});

async function newSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test("Viewer bị từ chối ở server, và dự án ngoài phạm vi là 404 chứ không phải 403", async ({
  browser,
}) => {
  const owner: Account = newAccount("chuso2");
  const viewer: Account = newAccount("chixem");

  const ownerPage = await newSession(browser);
  const viewerPage = await newSession(browser);

  await register(ownerPage, owner);
  const { workspaceId, projectId } = await setupBoard(ownerPage, ["Chờ làm", "Xong"]);

  const taskTitle = `Viec chi xem ${Date.now().toString(36)}`;
  await createTask(ownerPage, { title: taskTitle, column: "Chờ làm" });

  // Dự án thứ hai, **cùng workspace**, mà Viewer sẽ không bao giờ được thêm vào.
  const hiddenProject = await apiCall(ownerPage, "POST", `/workspaces/${workspaceId}/projects`, {
    body: { name: `Du an kin ${Date.now().toString(36)}` },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(hiddenProject.status).toBe(201);
  const hiddenProjectId = (hiddenProject.body as { data: { project: { id: string } } }).data.project
    .id;

  // Viewer vào workspace, rồi vào dự án đầu với vai trò `viewer`.
  await register(viewerPage, viewer);
  await inviteToWorkspace(ownerPage, workspaceId, viewer.email);
  await acceptInvitation(viewerPage, viewer.email);

  const members = await apiCall(ownerPage, "GET", `/workspaces/${workspaceId}/members`);
  const viewerId = (
    members.body as { data: { items: { userId: string; email: string }[] } }
  ).data.items.find((item) => item.email === viewer.email)?.userId;
  expect(viewerId, "không tìm được userId của Viewer").toBeDefined();

  const added = await apiCall(ownerPage, "POST", `/projects/${projectId}/members`, {
    body: { userId: viewerId, role: "viewer" },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(added.status).toBe(201);

  // Viewer mở board thật — từ đây trở đi cookie là cookie của một Viewer thật.
  await visit(viewerPage, `/du-an/${projectId}/bang-cong-viec`);
  await expect(viewerPage.getByRole("region", { name: "Chờ làm" })).toBeVisible();
  await expect(viewerPage.getByRole("button", { name: "Tạo công việc" })).toHaveCount(0);

  const taskId = await firstTaskId(viewerPage, projectId);

  await test.step("mutation mà giao diện không cho Viewer thấy → 403", async () => {
    const created = await apiCall(viewerPage, "POST", `/projects/${projectId}/tasks`, {
      body: {
        title: "Viewer khong duoc tao",
        columnId: await firstColumnId(viewerPage, projectId),
      },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(created.status, "Viewer tạo được công việc bằng HTTP trực tiếp").toBe(403);
    expect(created.code).toBe("FORBIDDEN");

    const commented = await apiCall(viewerPage, "POST", `/tasks/${taskId}/comments`, {
      body: { body: "Viewer khong duoc binh luan" },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(commented.status, "Viewer bình luận được bằng HTTP trực tiếp").toBe(403);
    expect(commented.code).toBe("FORBIDDEN");

    const moved = await apiCall(viewerPage, "POST", `/tasks/${taskId}/move`, {
      body: { destinationColumnId: await firstColumnId(viewerPage, projectId), expectedVersion: 1 },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(moved.status, "Viewer di chuyển được công việc bằng HTTP trực tiếp").toBe(403);
    expect(moved.code).toBe("FORBIDDEN");

    // Và cùng cookie đó **đọc** được — nếu không thì `403` ở trên chỉ đang nói
    // "phiên hỏng" chứ không nói "thiếu quyền".
    const read = await apiCall(viewerPage, "GET", `/tasks/${taskId}`);
    expect(read.status).toBe(200);
  });

  await test.step("dự án không phải thành viên → 404, KHÔNG phải 403", async () => {
    const detail = await apiCall(viewerPage, "GET", `/projects/${hiddenProjectId}`);
    expect(
      detail.status,
      `dự án ngoài phạm vi trả ${String(detail.status)} ${detail.code ?? ""} — một 403 ở đây đã xác nhận dự án tồn tại`,
    ).toBe(404);
    expect(detail.code).toBe("NOT_FOUND");

    const tasks = await apiCall(viewerPage, "GET", `/projects/${hiddenProjectId}/tasks?limit=1`);
    expect(tasks.status).toBe(404);
    expect(tasks.code).toBe("NOT_FOUND");

    // Ghi cũng vậy: `404` chứ không phải `403`.
    const write = await apiCall(viewerPage, "POST", `/projects/${hiddenProjectId}/tasks`, {
      body: { title: "Khong duoc phep", columnId: "00000000-0000-4000-8000-000000000000" },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(write.status).toBe(404);
    expect(write.code).toBe("NOT_FOUND");

    // Và một id hoàn toàn không tồn tại phải trả **đúng cùng** câu trả lời:
    // hai câu khác nhau là một máy dò xem project nào có thật.
    const missing = await apiCall(
      viewerPage,
      "GET",
      "/projects/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
    expect(missing.code).toBe(detail.code);
  });
});

async function firstColumnId(page: Page, projectId: string): Promise<string> {
  const detail = await apiCall(page, "GET", `/projects/${projectId}`);
  const columns = (detail.body as { data: { columns: { id: string }[] } }).data.columns;
  const id = columns[0]?.id;
  if (id === undefined) throw new Error("dự án không có cột nào");
  return id;
}

async function firstTaskId(page: Page, projectId: string): Promise<string> {
  const columnId = await firstColumnId(page, projectId);
  const list = await apiCall(
    page,
    "GET",
    `/projects/${projectId}/tasks?columnId=${columnId}&limit=1`,
  );
  const items = (list.body as { data: { items: { id: string }[] } }).data.items;
  const id = items[0]?.id;
  if (id === undefined) throw new Error("cột đầu tiên không có công việc nào");
  return id;
}
