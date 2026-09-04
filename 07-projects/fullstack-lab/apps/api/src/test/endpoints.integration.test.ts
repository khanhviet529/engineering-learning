import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { projectMembers, projects, workspaceMembers } from "../shared/database/schema.ts";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Hành vi của 11 endpoint M2 trên PostgreSQL thật.
 *
 * Test ở đây trả lời ba câu mà chỉ chạy thật mới trả lời được:
 *
 * 1. Status và hình dạng response có **đúng hợp đồng** không? (Nest mặc định
 *    POST là `201`; hợp đồng không phải lúc nào cũng đồng ý.)
 * 2. Bất biến có được cưỡng chế **trước khi commit** không?
 * 3. Retry cùng `Idempotency-Key` có thật sự không tạo hiệu ứng thứ hai không?
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("endpoint workspace và project", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  async function countProjectMembers(projectId: string): Promise<number> {
    const [row] = await f.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    return row?.n ?? 0;
  }

  async function roleOf(projectId: string, userId: string): Promise<string | undefined> {
    const [row] = await f.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return row?.role;
  }

  describe("GET /workspaces", () => {
    it("trả workspace của actor cùng role và capabilities do server tính", async () => {
      const response = await call(f, "GET", "/workspaces", { actor: f.wsAdmin });
      expect(response.status).toBe(200);

      const data = response.body["data"] as {
        items: { id: string; role: string; capabilities: string[] }[];
        page: { nextCursor: string | null; hasMore: boolean };
      };

      const workspace = data.items.find((w) => w.id === f.workspaceId);
      expect(workspace?.role).toBe("workspace_admin");
      expect(workspace?.capabilities).toContain("project:create");
      // `items` và `page` nằm **trong** `data`, không ở top-level.
      expect(data.page).toEqual({ nextCursor: null, hasMore: false });
    });

    it("member thường thấy cùng workspace nhưng capabilities hẹp hơn", async () => {
      const response = await call(f, "GET", "/workspaces", { actor: f.editor });
      const data = response.body["data"] as { items: { id: string; capabilities: string[] }[] };

      const workspace = data.items.find((w) => w.id === f.workspaceId);
      expect(workspace?.capabilities).toEqual(["workspace:read"]);
      expect(workspace?.capabilities).not.toContain("project:create");
    });

    it("actor không thuộc workspace nào nhận danh sách rỗng, không phải lỗi", async () => {
      const response = await call(f, "GET", "/workspaces", { actor: f.outsider });
      expect(response.status).toBe(200);

      const data = response.body["data"] as { items: unknown[] };
      expect(data.items).toEqual([]);
    });

    it("limit ngoài khoảng bị từ chối, không clamp im lặng", async () => {
      const tooBig = await call(f, "GET", "/workspaces?limit=101", { actor: f.owner });
      const zero = await call(f, "GET", "/workspaces?limit=0", { actor: f.owner });

      expect(tooBig.status).toBe(400);
      expect((tooBig.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
      expect(zero.status).toBe(400);
    });

    it("cursor của actor khác bị từ chối — không đọc sang scope khác", async () => {
      // Tạo đủ workspace để có cursor thật.
      for (let i = 0; i < 2; i++) {
        await call(f, "POST", "/workspaces", {
          actor: f.owner,
          idempotencyKey: newKey("ws"),
          body: { name: `Workspace phụ ${String(i)}` },
        });
      }

      const page = await call(f, "GET", "/workspaces?limit=1", { actor: f.owner });
      const cursor = (page.body["data"] as { page: { nextCursor: string } }).page.nextCursor;
      expect(cursor).toBeTruthy();

      const stolen = await call(
        f,
        "GET",
        `/workspaces?limit=1&cursor=${encodeURIComponent(cursor)}`,
        {
          actor: f.editor,
        },
      );
      expect(stolen.status).toBe(400);
    });
  });

  describe("POST /workspaces", () => {
    it("trả 201 và đưa creator thành workspace_admin trong cùng transaction", async () => {
      const response = await call(f, "POST", "/workspaces", {
        actor: f.editor,
        idempotencyKey: newKey("create-ws"),
        body: { name: "Không gian mới" },
      });

      expect(response.status).toBe(201);
      const workspace = (response.body["data"] as { workspace: { id: string; role: string } })
        .workspace;
      expect(workspace.role).toBe("workspace_admin");

      const [membership] = await f.db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.userId, f.editor.id),
          ),
        );
      expect(membership?.role).toBe("workspace_admin");

      // Không dọn tay ở đây: `cleanup` của fixture xoá theo đúng chiều foreign
      // key cho mọi workspace mà actor của fixture đã tạo.
    });

    it("thiếu Idempotency-Key → 400 trước khi chạy use case", async () => {
      const before = await f.db.select({ n: sql<number>`count(*)::int` }).from(projects);

      const response = await call(f, "POST", "/workspaces", {
        actor: f.editor,
        body: { name: "Không có key" },
      });

      expect(response.status).toBe(400);
      const details = (response.body["error"] as { details: { field: string }[] }).details;
      expect(details[0]?.field).toBe("Idempotency-Key");

      const after = await f.db.select({ n: sql<number>`count(*)::int` }).from(projects);
      expect(after[0]?.n).toBe(before[0]?.n);
    });

    it("field lạ trong body → 400, không bị bỏ qua im lặng", async () => {
      const response = await call(f, "POST", "/workspaces", {
        actor: f.editor,
        idempotencyKey: newKey("strict"),
        body: { name: "Hợp lệ", isAdmin: true },
      });
      expect(response.status).toBe(400);
    });
  });

  describe("POST /workspaces/:workspaceId/projects", () => {
    it("Workspace Admin tạo project, creator thành Owner, trả 201", async () => {
      const response = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("create-project"),
        body: { name: "Dự án của Admin" },
      });

      expect(response.status).toBe(201);
      const data = response.body["data"] as {
        project: { id: string; workspaceId: string };
        capabilities: string[];
      };
      expect(data.project.workspaceId).toBe(f.workspaceId);
      expect(data.capabilities).toContain("project:member:manage");

      expect(await roleOf(data.project.id, f.wsAdmin.id)).toBe("owner");

      // Admin nay **là** member của project mình tạo, nên đọc được nó.
      const read = await call(f, "GET", `/projects/${data.project.id}`, { actor: f.wsAdmin });
      expect(read.status).toBe(200);
      // Nhưng vẫn không đọc được Project B, nơi họ không có membership.
      const denied = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.wsAdmin });
      expect(denied.status).toBe(404);
    });
  });

  describe("GET /projects/:projectId", () => {
    it("trả project, capabilities, members và columns rỗng của M2", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.owner });
      expect(response.status).toBe(200);

      const data = response.body["data"] as {
        project: { id: string; name: string };
        capabilities: string[];
        columns: unknown[];
        members: { userId: string; role: string }[];
      };

      expect(data.project.id).toBe(f.projectBId);
      // `columns` có mặt nhưng rỗng: bảng `board_columns` thuộc M3.
      expect(data.columns).toEqual([]);
      expect(data.members.map((m) => m.role).sort()).toEqual([
        "editor",
        "owner",
        "owner",
        "viewer",
      ]);
    });

    it("không lộ password hash hay bất kỳ giá trị nhạy cảm nào", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.viewer });
      const serialized = JSON.stringify(response.body);

      expect(serialized).not.toContain("passwordHash");
      expect(serialized).not.toContain("argon2id");
      expect(serialized).not.toContain("sessionTokenHash");
      expect(serialized).not.toContain("createdByUserId");
    });
  });

  describe("PATCH /projects/:projectId", () => {
    it("Owner đổi tên, trả 200 và tên đã commit", async () => {
      const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        actor: f.owner,
        idempotencyKey: newKey("rename"),
        body: { name: "Tên mới của Project B" },
      });

      expect(response.status).toBe(200);
      const data = response.body["data"] as { project: { name: string } };
      expect(data.project.name).toBe("Tên mới của Project B");

      const [row] = await f.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, f.projectBId));
      expect(row?.name).toBe("Tên mới của Project B");
    });

    it("Editor không đổi được tên → 403", async () => {
      const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        actor: f.editor,
        idempotencyKey: newKey("rename-editor"),
        body: { name: "Editor đổi" },
      });
      expect(response.status).toBe(403);
    });

    it("field ngoài allowlist → 400", async () => {
      for (const body of [
        { name: "Hợp lệ", description: "mô tả" },
        { name: "Hợp lệ", workspaceId: f.workspaceId },
        { name: "Hợp lệ", archivedAt: null },
        { description: "chỉ mô tả" },
      ]) {
        const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
          actor: f.owner,
          idempotencyKey: newKey("bad-field"),
          body,
        });
        expect(response.status).toBe(400);
      }
    });
  });

  describe("POST /projects/:projectId/members", () => {
    it("Owner thêm member là workspace member → 201", async () => {
      const response = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("add-member"),
        body: { userId: f.userA.id, role: "viewer" },
      });

      expect(response.status).toBe(201);
      expect((response.body["data"] as { member: { role: string } }).member.role).toBe("viewer");
      expect(await roleOf(f.projectBId, f.userA.id)).toBe("viewer");

      // Dọn lại để không ảnh hưởng test khác.
      await f.db
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.projectId, f.projectBId), eq(projectMembers.userId, f.userA.id)),
        );
    });

    it("target chưa là workspace member bị chặn — ranh giới tenant giữ nguyên", async () => {
      const before = await countProjectMembers(f.projectBId);

      const response = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("outsider"),
        body: { userId: f.outsider.id, role: "editor" },
      });

      expect(response.status).toBe(400);
      const details = (response.body["error"] as { details: { code: string }[] }).details;
      expect(details[0]?.code).toBe("not_workspace_member");
      expect(await countProjectMembers(f.projectBId)).toBe(before);
    });

    it("thêm trùng bị chặn, không tạo membership thứ hai", async () => {
      const before = await countProjectMembers(f.projectBId);

      const response = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("dup"),
        body: { userId: f.editor.id, role: "viewer" },
      });

      expect(response.status).toBe(400);
      expect(await countProjectMembers(f.projectBId)).toBe(before);
      // Vai trò cũ **không** bị đổi thành `viewer`.
      expect(await roleOf(f.projectBId, f.editor.id)).toBe("editor");
    });

    it("role ngoài enum → 400", async () => {
      const response = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("bad-role"),
        body: { userId: f.userA.id, role: "admin" },
      });
      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /projects/:projectId/members/:userId — bảo vệ Owner cuối cùng", () => {
    it("hạ quyền một Owner khi còn Owner khác thì được", async () => {
      // Project B có hai Owner: `owner` và `userB`.
      const response = await call(f, "PATCH", `/projects/${f.projectBId}/members/${f.owner.id}`, {
        actor: f.userB,
        idempotencyKey: newKey("demote-ok"),
        body: { role: "editor" },
      });

      expect(response.status).toBe(200);
      expect(await roleOf(f.projectBId, f.owner.id)).toBe("editor");

      // Trả lại vai trò cũ cho các test sau.
      await call(f, "PATCH", `/projects/${f.projectBId}/members/${f.owner.id}`, {
        actor: f.userB,
        idempotencyKey: newKey("restore"),
        body: { role: "owner" },
      });
      expect(await roleOf(f.projectBId, f.owner.id)).toBe("owner");
    });

    it("hạ quyền Owner **cuối cùng** bị chặn, không ghi gì", async () => {
      // Dựng một project chỉ có đúng một Owner.
      const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("solo"),
        body: { name: "Dự án một Owner" },
      });
      const projectId = (created.body["data"] as { project: { id: string } }).project.id;

      const response = await call(f, "PATCH", `/projects/${projectId}/members/${f.wsAdmin.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("demote-last"),
        body: { role: "viewer" },
      });

      // `409 PROJECT_LAST_OWNER` — code riêng, thêm vào danh mục ngày 04/09/2026
      // để vá chỗ hợp đồng từng ghi `409 CONFLICT` mà danh mục không có code đó.
      //
      // `409` chứ không phải `400`: yêu cầu hợp lệ, chỉ trạng thái hiện tại
      // không cho phép. Và **không** dùng lại một code `*_VERSION_CONFLICT`, vì
      // tải lại rồi gửi lại không giải quyết được gì — người dùng phải chỉ định
      // một Owner khác trước.
      expect(response.status).toBe(409);
      expect((response.body["error"] as { code: string }).code).toBe("PROJECT_LAST_OWNER");
      // Danh mục công bố code này KHÔNG có `details`.
      expect(response.body["error"]).not.toHaveProperty("details");

      // Vai trò không đổi — đây là phần quan trọng nhất của test này.
      expect(await roleOf(projectId, f.wsAdmin.id)).toBe("owner");
    });
  });

  describe("DELETE /projects/:projectId/members/:userId", () => {
    it("gỡ member thường → 204 và membership biến mất", async () => {
      await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("add-for-remove"),
        body: { userId: f.userA.id, role: "viewer" },
      });
      expect(await roleOf(f.projectBId, f.userA.id)).toBe("viewer");

      const response = await call(f, "DELETE", `/projects/${f.projectBId}/members/${f.userA.id}`, {
        actor: f.owner,
        idempotencyKey: newKey("remove"),
      });

      expect(response.status).toBe(204);
      expect(await roleOf(f.projectBId, f.userA.id)).toBeUndefined();
    });

    it("gỡ Owner cuối cùng bị chặn, không ghi gì", async () => {
      const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("solo2"),
        body: { name: "Dự án một Owner 2" },
      });
      const projectId = (created.body["data"] as { project: { id: string } }).project.id;

      const response = await call(f, "DELETE", `/projects/${projectId}/members/${f.wsAdmin.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("remove-last"),
      });

      expect(response.status).toBe(409);
      expect((response.body["error"] as { code: string }).code).toBe("PROJECT_LAST_OWNER");
      expect(await roleOf(projectId, f.wsAdmin.id)).toBe("owner");
    });

    it("gỡ member đang là assignee bị chặn, KHÔNG tự unassign", async () => {
      /**
       * Bảng `tasks` thuộc M4, nên không tạo được một assignment thật ở đây.
       * Thứ test này chứng minh là **đường đi**: use case thật sự hỏi
       * `ProjectAssigneeCheck`, và một câu trả lời `true` thật sự chặn được thao
       * tác trước khi commit.
       *
       * M4 chỉ thay adapter bằng bản đọc `tasks`; luật và test này không đổi.
       */
      await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: newKey("add-assignee"),
        body: { userId: f.userA.id, role: "editor" },
      });

      f.setHasAssignedTasks(true);
      try {
        const response = await call(
          f,
          "DELETE",
          `/projects/${f.projectBId}/members/${f.userA.id}`,
          { actor: f.owner, idempotencyKey: newKey("remove-assignee") },
        );

        expect(response.status).toBe(409);
        expect((response.body["error"] as { code: string }).code).toBe("MEMBER_HAS_ASSIGNED_TASKS");

        // Membership còn nguyên: API không auto-unassign rồi gỡ.
        expect(await roleOf(f.projectBId, f.userA.id)).toBe("editor");
      } finally {
        f.setHasAssignedTasks(false);
      }

      // Khi không còn giữ việc thì gỡ được — chứng minh nhánh chặn là do port,
      // không phải do một lỗi khác.
      const after = await call(f, "DELETE", `/projects/${f.projectBId}/members/${f.userA.id}`, {
        actor: f.owner,
        idempotencyKey: newKey("remove-after"),
      });
      expect(after.status).toBe(204);
    });
  });

  describe("DELETE /workspaces/:workspaceId/members/:userId", () => {
    it("gỡ workspace member còn membership project bị chặn", async () => {
      const response = await call(
        f,
        "DELETE",
        `/workspaces/${f.workspaceId}/members/${f.viewer.id}`,
        { actor: f.wsAdmin, idempotencyKey: newKey("ws-remove") },
      );

      expect(response.status).toBe(409);
      expect((response.body["error"] as { code: string }).code).toBe(
        "WORKSPACE_MEMBER_IN_PROJECTS",
      );

      // Không im lặng đổi project membership.
      expect(await roleOf(f.projectBId, f.viewer.id)).toBe("viewer");
      // Và thông điệp không nói project nào — Workspace Admin không được biết.
      const message = (response.body["error"] as { message: string }).message;
      expect(message).not.toContain("Project B");
    });

    it("gỡ workspace member không thuộc project nào → 204", async () => {
      await f.db
        .insert(workspaceMembers)
        .values({ workspaceId: f.workspaceId, userId: f.outsider.id, role: "workspace_member" });

      const response = await call(
        f,
        "DELETE",
        `/workspaces/${f.workspaceId}/members/${f.outsider.id}`,
        { actor: f.wsAdmin, idempotencyKey: newKey("ws-remove-ok") },
      );

      expect(response.status).toBe(204);
    });

    it("gỡ người không phải member → 404", async () => {
      const response = await call(
        f,
        "DELETE",
        `/workspaces/${f.workspaceId}/members/${f.outsider.id}`,
        { actor: f.wsAdmin, idempotencyKey: newKey("ws-remove-missing") },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("idempotency", () => {
    it("retry cùng key và cùng payload phát lại outcome, không tạo bản thứ hai", async () => {
      const key = newKey("replay");
      const body = { name: "Dự án gửi hai lần" };

      const first = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });
      const second = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });

      // Replay trả **đúng status đã lưu**, không phải một status "đã thấy rồi"
      // riêng: hợp đồng nói retry nhận lại outcome đã lưu, và status là một phần
      // của outcome đó.
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const firstId = (first.body["data"] as { project: { id: string } }).project.id;
      const secondId = (second.body["data"] as { project: { id: string } }).project.id;
      // Cùng một project, không phải hai.
      expect(secondId).toBe(firstId);

      const [count] = await f.db
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.workspaceId, f.workspaceId), eq(projects.name, body.name)));
      expect(count?.n).toBe(1);
    });

    it("cùng key với payload khác → 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const key = newKey("reuse");

      await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body: { name: "Ý định thứ nhất" },
      });
      const second = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body: { name: "Ý định thứ hai" },
      });

      expect(second.status).toBe(409);
      expect((second.body["error"] as { code: string }).code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("key của actor này không đụng tới key của actor kia", async () => {
      const key = "cung-mot-chuoi-key";

      const a = await call(f, "POST", "/workspaces", {
        actor: f.owner,
        idempotencyKey: key,
        body: { name: "Của owner" },
      });
      const b = await call(f, "POST", "/workspaces", {
        actor: f.editor,
        idempotencyKey: key,
        body: { name: "Của editor" },
      });

      // Cùng chuỗi key nhưng khác actor: cả hai đều là ý định độc lập.
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((a.body["data"] as { workspace: { id: string } }).workspace.id).not.toBe(
        (b.body["data"] as { workspace: { id: string } }).workspace.id,
      );
    });

    it("business failure được lưu và phát lại y nguyên", async () => {
      const key = newKey("fail");
      const body = { userId: f.outsider.id, role: "editor" as const };

      const first = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: key,
        body,
      });
      const second = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.owner,
        idempotencyKey: key,
        body,
      });

      expect(first.status).toBe(400);
      // Retry nhận lại đúng lỗi đó, không chạy lại mutation.
      expect(second.status).toBe(400);
      expect((second.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
    });
  });

  describe("envelope và requestId", () => {
    it("mọi response thành công có requestId khớp header X-Request-Id", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.owner });
      expect(response.body["requestId"]).toBe(response.headers["x-request-id"]);
    });

    it("envelope lỗi cũng có requestId khớp header", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.userA });
      expect(response.body["requestId"]).toBe(response.headers["x-request-id"]);
    });

    it("UUID sai định dạng trong path → 400, không phải 500", async () => {
      const response = await call(f, "GET", "/projects/khong-phai-uuid", { actor: f.owner });
      expect(response.status).toBe(400);
    });
  });
});
