import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceMembers } from "../shared/database/schema.ts";
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

  it("10 endpoint đã dựng trả đúng status thành công đã công bố", async () => {
    // Dựng sẵn một người để thêm/gỡ, không đụng tới fixture chuẩn.
    //
    // Membership workspace của `spare` được ghi **thẳng vào DB**, không qua HTTP:
    // route tạo nó đã đổi theo ADR-0013 và chưa dựng lại (xem mục 4 dưới đây).
    // Bốn route sau vẫn cần một workspace member thật để đo được, và việc đo
    // chúng không phụ thuộc vào việc member đó tới bằng đường nào.
    //
    // `spare` là `f.outsider`, và bước cuối cùng của ma trận gỡ member này ra —
    // giữ nguyên tính chất "ngoài workspace" mà test 404 phía dưới dựa vào.
    // Fixture chỉ dựng một lần cho cả describe, nên phép cộng phải về không.
    const spare = f.outsider;
    await f.db
      .insert(workspaceMembers)
      .values({ workspaceId: f.workspaceId, userId: spare.id, role: "workspace_member" });

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

    // 4. POST /workspaces/:id/members — CHƯA DỰNG, xem ADR-0013.
    // ADR-0013 (Accepted 04/09/2026) đổi route này sang mời theo email và
    // thêm ba route lời mời; hợp đồng đã cập nhật, hiện thực chưa. Dòng này
    // bị lược khỏi ma trận thay vì đổi sang khẳng định `404`: khẳng định
    // `404` là khoá cứng một trạng thái tạm thành hành vi mong đợi, và ai đó
    // sẽ phải nhớ xoá nó — trong khi chỗ trống này tự nói ra việc còn thiếu.

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

    // 11. DELETE /workspaces/:id/members/:userId — 204
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
    // 11 route workspace/project đã công bố, trừ đúng một route chờ ADR-0013.
    expect(results).toHaveLength(10);
  });

  it("mọi route project trả 404 (không phải 403) cho actor ngoài project", async () => {
    /**
     * Vòng lặp này là phiên bản máy chạy của câu hỏi tự review: "actor không có
     * quyền **nhìn thấy** resource này nhận gì?".
     *
     * Câu trả lời đúng cho **mọi** route project là `404`. Một route trả `403`
     * đã tự thú nhận rằng project tồn tại.
     */
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
    const routes: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown }[] = [
      { method: "GET", path: `/workspaces/${f.workspaceId}/members` },
      // `POST /workspaces/:workspaceId/members` không có ở đây: ADR-0013 đổi nó
      // sang mời theo email và hiện thực chưa có, nên nó trả `404` cho **mọi**
      // actor — kể cả người có quyền. Giữ nó trong danh sách này sẽ cho một test
      // xanh vì lý do sai: đúng status, sai nguyên nhân.
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
