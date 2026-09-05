import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Đối chiếu từng endpoint với `docs/api/endpoint-contracts.md`, một dòng một
 * route.
 *
 * Test này tồn tại vì một lý do cụ thể: **Nest mặc định POST là `201`**, còn
 * hợp đồng không phải lúc nào cũng đồng ý — M1 đã dính đúng lỗi đó ở
 * `email/verify` và `sign-in`, và nó chỉ lộ ra khi gọi endpoint thật. Đọc code
 * không bắt được, vì `@HttpCode` vắng mặt trông y hệt `@HttpCode` đúng.
 *
 * Bảng dưới đây vì vậy là bản chép **status thành công** mà hợp đồng công bố,
 * và test gọi thật để so.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("ma trận endpoint ↔ hợp đồng", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  it("21 endpoint trả đúng status thành công đã công bố", async () => {
    f.limiter.reset();

    /**
     * Membership workspace của `spare` nay tới bằng **đường thật**: mời rồi
     * chấp nhận.
     *
     * Trước đây nó được ghi thẳng vào DB, vì route tạo nó đã đổi theo ADR-0013
     * và chưa dựng lại. Nay nó đã dựng, nên đo qua HTTP là đo đúng thứ người
     * dùng đi qua.
     *
     * Chú ý điều `202` **không** làm: nó không tạo membership, nó tạo lời mời.
     * Membership chỉ xuất hiện sau `POST /invitations/accept`. Dùng `202` để
     * dựng một member là hiểu sai chính hợp đồng mà ma trận này đang đo.
     *
     * `spare` là `f.outsider`, và bước cuối cùng của ma trận gỡ member này ra —
     * giữ nguyên tính chất "ngoài workspace" mà test 404 phía dưới dựa vào.
     * Fixture chỉ dựng một lần cho cả describe, nên phép cộng phải về không.
     */
    const spare = f.outsider;

    const results: { route: string; expected: number; actual: number }[] = [];

    const record = async (
      route: string,
      expected: number,
      run: () => Promise<{ status: number }>,
    ): Promise<void> => {
      const response = await run();
      results.push({ route, expected, actual: response.status });
    };

    // 1. GET /workspaces — 200
    await record(
      "GET /workspaces",
      200,
      async () => await call(f, "GET", "/workspaces", { actor: f.wsAdmin }),
    );

    // 2. POST /workspaces — 201
    await record(
      "POST /workspaces",
      201,
      async () =>
        await call(f, "POST", "/workspaces", {
          actor: f.owner,
          idempotencyKey: newKey("m-ws"),
          body: { name: "Ma trận workspace" },
        }),
    );

    // 3. GET /workspaces/:id/members — 200
    await record(
      "GET /workspaces/:workspaceId/members",
      200,
      async () =>
        await call(f, "GET", `/workspaces/${f.workspaceId}/members`, { actor: f.wsAdmin }),
    );

    // 4. POST /workspaces/:id/members — 202 (mời qua email, ADR-0013)
    await record(
      "POST /workspaces/:workspaceId/members",
      202,
      async () =>
        await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-invite"),
          body: { email: spare.email, role: "workspace_member" },
        }),
    );

    // Lời mời chưa phải membership. Bốn route sau cần `spare` **là** member,
    // nên phải chấp nhận lời mời trước — đúng đường mà người dùng đi.
    const acceptToken = f.mailer.lastTokenFor(spare.email);
    expect(acceptToken).toBeTruthy();
    const accepted = await call(f, "POST", "/invitations/accept", {
      actor: spare,
      body: { token: acceptToken as string },
    });
    expect(accepted.status).toBe(200);

    // 5. POST /workspaces/:id/projects — 201
    let matrixProjectId = "";
    await record("POST /workspaces/:workspaceId/projects", 201, async () => {
      const response = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("m-proj"),
        body: { name: "Ma trận project" },
      });
      matrixProjectId = (response.body["data"] as { project: { id: string } }).project.id;
      return response;
    });

    // 6. GET /projects/:id — 200
    await record(
      "GET /projects/:projectId",
      200,
      async () => await call(f, "GET", `/projects/${matrixProjectId}`, { actor: f.wsAdmin }),
    );

    // 7. PATCH /projects/:id — 200
    await record(
      "PATCH /projects/:projectId",
      200,
      async () =>
        await call(f, "PATCH", `/projects/${matrixProjectId}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-rename"),
          body: { name: "Ma trận project đã đổi tên" },
        }),
    );

    // 8. POST /projects/:id/members — 201
    await record(
      "POST /projects/:projectId/members",
      201,
      async () =>
        await call(f, "POST", `/projects/${matrixProjectId}/members`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-pm"),
          body: { userId: spare.id, role: "editor" },
        }),
    );

    // 9. PATCH /projects/:id/members/:userId — 200
    await record(
      "PATCH /projects/:projectId/members/:userId",
      200,
      async () =>
        await call(f, "PATCH", `/projects/${matrixProjectId}/members/${spare.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-pmr"),
          body: { role: "viewer" },
        }),
    );

    // 10. DELETE /projects/:id/members/:userId — 204
    await record(
      "DELETE /projects/:projectId/members/:userId",
      204,
      async () =>
        await call(f, "DELETE", `/projects/${matrixProjectId}/members/${spare.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-pmd"),
        }),
    );

    // 11. POST /projects/:projectId/columns — 201
    let matrixColumnId = "";
    let matrixColumnId2 = "";
    await record("POST /projects/:projectId/columns", 201, async () => {
      const response = await call(f, "POST", `/projects/${matrixProjectId}/columns`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("m-col"),
        body: { name: "Cần làm", afterColumnId: null },
      });
      matrixColumnId = (response.body["data"] as { column: { id: string } }).column.id;
      return response;
    });

    const secondColumn = await call(f, "POST", `/projects/${matrixProjectId}/columns`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("m-col2"),
      body: { name: "Xong", afterColumnId: null },
    });
    matrixColumnId2 = (secondColumn.body["data"] as { column: { id: string } }).column.id;

    // 12. PATCH /columns/:columnId — 200
    await record(
      "PATCH /columns/:columnId",
      200,
      async () =>
        await call(f, "PATCH", `/columns/${matrixColumnId}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-col-patch"),
          body: { name: "Cần làm (đã đổi)" },
        }),
    );

    /**
     * 13. POST /columns/reorder — **200**, không phải `201`.
     *
     * Đây chính là ô mà ma trận này tồn tại để đo: Nest mặc định POST là `201`,
     * và một `@HttpCode(200)` bị quên trông y hệt một `@HttpCode(200)` đúng.
     */
    await record(
      "POST /columns/reorder",
      200,
      async () =>
        await call(f, "POST", "/columns/reorder", {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-col-reorder"),
          body: {
            projectId: matrixProjectId,
            orderedColumnIds: [matrixColumnId2, matrixColumnId],
          },
        }),
    );

    // 14. POST /projects/:projectId/tasks — 201
    let matrixTaskId = "";
    await record("POST /projects/:projectId/tasks", 201, async () => {
      const response = await call(f, "POST", `/projects/${matrixProjectId}/tasks`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("m-task"),
        body: { title: "Ma trận task", columnId: matrixColumnId, description: null },
      });
      matrixTaskId = (response.body["data"] as { task: { id: string } }).task.id;
      return response;
    });

    // 15. GET /projects/:projectId/tasks — 200
    await record(
      "GET /projects/:projectId/tasks",
      200,
      async () => await call(f, "GET", `/projects/${matrixProjectId}/tasks`, { actor: f.wsAdmin }),
    );

    // 16. GET /tasks/:taskId — 200
    await record(
      "GET /tasks/:taskId",
      200,
      async () => await call(f, "GET", `/tasks/${matrixTaskId}`, { actor: f.wsAdmin }),
    );

    // 17. PATCH /tasks/:taskId — 200
    await record(
      "PATCH /tasks/:taskId",
      200,
      async () =>
        await call(f, "PATCH", `/tasks/${matrixTaskId}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-task-patch"),
          body: { title: "Ma trận task đã đổi tên", expectedVersion: 1 },
        }),
    );

    /**
     * 18. POST /tasks/:taskId/move — **200**, không phải `201`.
     *
     * Cùng lý do với `POST /columns/reorder`: move không tạo resource mới, nên
     * `201` là lời khai sai với mọi client đọc status — và `@HttpCode(200)` bị
     * quên trông y hệt `@HttpCode(200)` đúng.
     */
    await record(
      "POST /tasks/:taskId/move",
      200,
      async () =>
        await call(f, "POST", `/tasks/${matrixTaskId}/move`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-task-move"),
          body: {
            destinationColumnId: matrixColumnId2,
            targetPosition: "1024.0000000000",
            expectedVersion: 2,
          },
        }),
    );

    // 19. POST /tasks/:taskId/comments — 201
    await record(
      "POST /tasks/:taskId/comments",
      201,
      async () =>
        await call(f, "POST", `/tasks/${matrixTaskId}/comments`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-comment"),
          body: { body: "Bình luận của ma trận" },
        }),
    );

    // 20. GET /tasks/:taskId/activity — 200
    await record(
      "GET /tasks/:taskId/activity",
      200,
      async () => await call(f, "GET", `/tasks/${matrixTaskId}/activity`, { actor: f.wsAdmin }),
    );

    // 21. DELETE /workspaces/:id/members/:userId — 204
    await record(
      "DELETE /workspaces/:workspaceId/members/:userId",
      204,
      async () =>
        await call(f, "DELETE", `/workspaces/${f.workspaceId}/members/${spare.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("m-wsd"),
        }),
    );

    const mismatched = results.filter((r) => r.actual !== r.expected);
    expect(mismatched).toEqual([]);
    // Con số này là bản đếm tay có chủ ý: nó là thứ duy nhất báo động khi ai đó
    // **thêm** một route vào hợp đồng mà quên thêm dòng đo tương ứng ở đây.
    expect(results).toHaveLength(21);
  });

  it("mọi route project trả 404 (không phải 403) cho actor ngoài project", async () => {
    /**
     * Vòng lặp này là phiên bản máy chạy của câu hỏi tự review: "actor không có
     * quyền **nhìn thấy** resource này nhận gì?".
     *
     * Câu trả lời đúng cho **mọi** route project là `404`. Một route trả `403`
     * đã tự thú nhận rằng project tồn tại.
     */
    /**
     * Một cột thật của Project B, tạo bởi Owner của chính project đó.
     *
     * `:columnId` là **locator, không phải chứng cứ quyền**: người ngoài đoán
     * trúng ID vẫn phải nhận `404`. Dùng một UUID bịa ra sẽ không chứng minh
     * được điều đó — nó `404` vì không tồn tại, không vì bị chặn.
     */
    const columnCreated = await call(f, "POST", `/projects/${f.projectBId}/columns`, {
      actor: f.owner,
      idempotencyKey: newKey("probe-col"),
      body: { name: "Cột của Project B", afterColumnId: null },
    });
    expect(columnCreated.status).toBe(201);
    const columnId = (columnCreated.body["data"] as { column: { id: string } }).column.id;

    /** Một task thật của Project B — cùng lý do với cột: `:taskId` là locator. */
    const taskCreated = await call(f, "POST", `/projects/${f.projectBId}/tasks`, {
      actor: f.owner,
      idempotencyKey: newKey("probe-task"),
      body: { title: "Task của Project B", columnId, description: null },
    });
    expect(taskCreated.status).toBe(201);
    const taskId = (taskCreated.body["data"] as { task: { id: string } }).task.id;

    const routes: { method: "GET" | "PATCH" | "POST" | "DELETE"; path: string; body?: unknown }[] =
      [
        { method: "GET", path: `/projects/${f.projectBId}` },
        { method: "PATCH", path: `/projects/${f.projectBId}`, body: { name: "x" } },
        {
          method: "POST",
          path: `/projects/${f.projectBId}/members`,
          body: { userId: f.userA.id, role: "editor" },
        },
        {
          method: "PATCH",
          path: `/projects/${f.projectBId}/members/${f.editor.id}`,
          body: { role: "viewer" },
        },
        { method: "DELETE", path: `/projects/${f.projectBId}/members/${f.editor.id}` },
        {
          method: "POST",
          path: `/projects/${f.projectBId}/columns`,
          body: { name: "Cột chen ngang", afterColumnId: null },
        },
        { method: "PATCH", path: `/columns/${columnId}`, body: { name: "Đổi tên trộm" } },
        { method: "GET", path: `/projects/${f.projectBId}/tasks` },
        {
          method: "POST",
          path: `/projects/${f.projectBId}/tasks`,
          body: { title: "Task chen ngang", columnId, description: null },
        },
        { method: "GET", path: `/tasks/${taskId}` },
        { method: "PATCH", path: `/tasks/${taskId}`, body: { title: "X", expectedVersion: 1 } },
        {
          method: "POST",
          path: `/tasks/${taskId}/move`,
          body: {
            destinationColumnId: columnId,
            targetPosition: "1024.0000000000",
            expectedVersion: 1,
          },
        },
        { method: "POST", path: `/tasks/${taskId}/comments`, body: { body: "X" } },
        { method: "GET", path: `/tasks/${taskId}/activity` },
        {
          method: "POST",
          path: "/columns/reorder",
          body: { projectId: f.projectBId, orderedColumnIds: [columnId] },
        },
      ];

    // Cả hai actor này đều **không** có dòng `project_members` cho Project B.
    for (const actor of [f.userA, f.wsAdmin]) {
      for (const route of routes) {
        const response = await call(f, route.method, route.path, {
          actor,
          idempotencyKey: newKey("probe404"),
          ...(route.body === undefined ? {} : { body: route.body }),
        });
        expect(
          { actor: actor.email, route: `${route.method} ${route.path}`, status: response.status },
          `${route.method} ${route.path} với ${actor.email}`,
        ).toEqual({
          actor: actor.email,
          route: `${route.method} ${route.path}`,
          status: 404,
        });
      }
    }
  });

  it("mọi route workspace trả 404 cho actor ngoài workspace, 403 cho member thiếu quyền", async () => {
    // Route mời có hạn mức 10/phút; vòng lặp dưới đây gọi nó nhiều lần.
    f.limiter.reset();

    const routes: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown }[] = [
      { method: "GET", path: `/workspaces/${f.workspaceId}/members` },
      {
        method: "POST",
        path: `/workspaces/${f.workspaceId}/members`,
        body: { email: "ai-do@example.test", role: "workspace_member" },
      },
      { method: "GET", path: `/workspaces/${f.workspaceId}/invitations` },
      {
        method: "DELETE",
        path: `/workspaces/${f.workspaceId}/invitations/00000000-0000-4000-8000-000000000001`,
      },
      { method: "DELETE", path: `/workspaces/${f.workspaceId}/members/${f.editor.id}` },
      {
        method: "POST",
        path: `/workspaces/${f.workspaceId}/projects`,
        body: { name: "Không được phép" },
      },
    ];

    for (const route of routes) {
      // `outsider` không thuộc workspace → `404`.
      const outside = await call(f, route.method, route.path, {
        actor: f.outsider,
        idempotencyKey: newKey("ws404"),
        ...(route.body === undefined ? {} : { body: route.body }),
      });
      expect(outside.status, `${route.method} ${route.path} với người ngoài workspace`).toBe(404);

      // `editor` là thành viên workspace nhưng không phải admin → `403`.
      const insideNoRight = await call(f, route.method, route.path, {
        actor: f.editor,
        idempotencyKey: newKey("ws403"),
        ...(route.body === undefined ? {} : { body: route.body }),
      });
      expect(insideNoRight.status, `${route.method} ${route.path} với member thường`).toBe(403);
    }
  });
});
