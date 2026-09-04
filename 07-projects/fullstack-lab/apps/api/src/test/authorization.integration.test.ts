import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { projectMembers, projects, workspaceMembers } from "../shared/database/schema.ts";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Ma trận phân quyền ở mức HTTP, trên PostgreSQL thật.
 *
 * Unit test đã phủ từng ô của catalog. Những gì **chỉ** chứng minh được ở đây:
 *
 * - Guard thật sự chạy, và chạy **đúng thứ tự** trên request thật.
 * - `404` với người ngoài không rò rỉ sự tồn tại qua bất kỳ kênh nào — status,
 *   body, hay số bản ghi bị đụng tới.
 * - Deny **không để lại side effect**: không mutation, không dòng nào bị ghi.
 *
 * `docs/operations/testing-strategy.md` nói rõ mock repository không đủ cho
 * những điều này, và nó đúng: một repository giả sẽ trả đúng thứ mà test mong
 * đợi, kể cả khi câu SQL thật thiếu điều kiện scope.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("phân quyền workspace và project", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  /**
   * Đếm mọi dòng có thể bị một mutation chạm tới — **kể cả `activity_logs`**.
   *
   * Cho tới M2, `activity` không có trong ảnh chụp này vì bảng chưa tồn tại, và
   * mọi câu "deny không tạo activity row" trong file này vì thế **đúng một cách
   * rỗng**: không có gì để đếm thì không có gì để sai. Từ M3 bảng có thật và
   * năm mutation của `projects` thật sự ghi vào nó, nên con số dưới đây là phần
   * duy nhất biến những câu đó thành bằng chứng.
   *
   * Đếm theo **mọi project của workspace**, không chỉ Project B: một request bị
   * từ chối vẫn có thể là request tạo project, và ảnh chụp phải bao được cả
   * activity của một project vừa ra đời.
   */
  async function snapshot(): Promise<{
    members: number;
    projects: number;
    wsMembers: number;
    activity: number;
  }> {
    const [pm] = await f.db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, f.projectBId));
    const projectRows = await f.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, f.workspaceId));
    const [wm] = await f.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, f.workspaceId));

    return {
      members: pm?.n ?? 0,
      projects: projectRows.length,
      wsMembers: wm?.n ?? 0,
      activity: await f.activity.countForProjects(projectRows.map((row) => row.id)),
    };
  }

  /**
   * Phép kiểm đối chứng cho chính `snapshot()`.
   *
   * Một ảnh chụp luôn bằng nhau vì nó **không đếm gì** trông y hệt một ảnh chụp
   * đúng. Test này chạy một mutation **được phép**, rồi khẳng định con số
   * `activity` đã nhích lên — tức là trường đó thật sự phản ứng với việc ghi, và
   * `toEqual(before)` ở các case deny là một khẳng định có nội dung.
   */
  it("snapshot().activity phản ứng với một mutation được phép", async () => {
    const before = await snapshot();

    const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
      actor: f.owner,
      idempotencyKey: newKey("probe"),
      body: { name: `Tên hợp lệ ${Date.now().toString()}` },
    });

    expect(response.status).toBe(200);
    expect((await snapshot()).activity).toBe(before.activity + 1);
  });

  describe("Viewer gọi HTTP trực tiếp", () => {
    /**
     * Hợp đồng: "Viewer gọi thẳng project update, quản lý member … `403`; việc
     * frontend ẩn hay disable là không liên quan; **không có side effect và
     * không có activity row nào**".
     *
     * Nên mỗi case dưới đây kiểm hai thứ: status, và trạng thái database không
     * đổi. Chỉ kiểm status là bỏ sót đúng nửa nguy hiểm — một endpoint có thể
     * trả `403` **sau khi** đã ghi.
     */
    const mutations: {
      name: string;
      method: "POST" | "PATCH" | "DELETE";
      path: (f: Fixture) => string;
      body?: unknown;
    }[] = [
      {
        name: "PATCH /projects/:id — đổi tên",
        method: "PATCH",
        path: (x) => `/projects/${x.projectBId}`,
        body: { name: "Tên do Viewer đổi" },
      },
      {
        name: "POST /projects/:id/members — thêm member",
        method: "POST",
        path: (x) => `/projects/${x.projectBId}/members`,
        body: { userId: "00000000-0000-4000-8000-000000000001", role: "editor" },
      },
      {
        name: "PATCH /projects/:id/members/:userId — đổi vai trò",
        method: "PATCH",
        path: (x) => `/projects/${x.projectBId}/members/${x.editor.id}`,
        body: { role: "owner" },
      },
      {
        name: "DELETE /projects/:id/members/:userId — gỡ member",
        method: "DELETE",
        path: (x) => `/projects/${x.projectBId}/members/${x.editor.id}`,
      },
    ];

    for (const mutation of mutations) {
      it(`${mutation.name} → 403, không ghi gì`, async () => {
        const before = await snapshot();

        const response = await call(f, mutation.method, mutation.path(f), {
          actor: f.viewer,
          idempotencyKey: newKey("viewer"),
          ...(mutation.body === undefined ? {} : { body: mutation.body }),
        });

        expect(response.status).toBe(403);
        expect((response.body["error"] as { code: string }).code).toBe("FORBIDDEN");
        // Envelope lỗi không mang dữ liệu project nào.
        expect(JSON.stringify(response.body)).not.toContain("Project B");

        expect(await snapshot()).toEqual(before);
      });
    }

    it("Viewer vẫn đọc được project — read-only là quyền thật, không phải bị chặn hết", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.viewer });
      expect(response.status).toBe(200);

      const data = response.body["data"] as { capabilities: string[] };
      // Capabilities của Viewer không chứa action ghi nào.
      expect(data.capabilities).toContain("project:read");
      expect(data.capabilities).not.toContain("project:update");
      expect(data.capabilities).not.toContain("task:create");
      expect(data.capabilities).not.toContain("project:member:manage");
    });
  });

  describe("User A dùng ID của User B — ID là locator, không phải chứng cứ quyền", () => {
    /**
     * User A là Owner của Project A, **cùng workspace** với Project B. Nếu scope
     * chỉ được kiểm ở tầng workspace, mọi request dưới đây sẽ lọt. `404` chứng
     * minh phép kiểm xảy ra ở tầng project.
     */
    it("GET /projects/:projectBId → 404, không body, không tín hiệu tồn tại", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.userA });

      expect(response.status).toBe(404);
      expect((response.body["error"] as { code: string }).code).toBe("NOT_FOUND");
      expect(response.body["data"]).toBeUndefined();

      // Không tên project, không ID member, không count nào.
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("Project B");
      expect(serialized).not.toContain(f.userB.id);
      expect(serialized).not.toContain(f.userB.email);
    });

    it("`404` của project có thật và của UUID bịa ra là **giống hệt nhau**", async () => {
      const real = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.userA });
      const fake = await call(f, "GET", "/projects/00000000-0000-4000-8000-0000000000ff", {
        actor: f.userA,
      });

      expect(real.status).toBe(fake.status);
      // So sánh body sau khi bỏ `requestId` — phần duy nhất được phép khác.
      const strip = (b: Record<string, unknown>) => ({
        ...b,
        requestId: "<redacted>",
      });
      expect(strip(real.body)).toEqual(strip(fake.body));
    });

    it("PATCH của User A lên project của User B → 404, không đổi tên", async () => {
      const before = await f.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, f.projectBId));

      const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        actor: f.userA,
        idempotencyKey: newKey("usera"),
        body: { name: "Bị chiếm quyền" },
      });

      expect(response.status).toBe(404);

      const after = await f.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, f.projectBId));
      expect(after[0]?.name).toBe(before[0]?.name);
    });

    it("thêm member vào project của User B → 404, không tạo membership", async () => {
      const before = await snapshot();

      const response = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.userA,
        idempotencyKey: newKey("usera"),
        body: { userId: f.userA.id, role: "owner" },
      });

      expect(response.status).toBe(404);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("Workspace Admin chưa là project member", () => {
    /**
     * Đây là ô dễ sai nhất của toàn bộ mô hình. Một Workspace Admin **có** quyền
     * quản trị workspace, nên phản xạ tự nhiên là cho họ `403` ("bạn thấy được
     * nhưng không đủ quyền"). Nhưng `403` đã là câu trả lời cho "project này có
     * tồn tại không?" — và với project riêng tư, chính sự tồn tại là thông tin.
     */
    it("GET /projects/:projectBId → 404, KHÔNG phải 403", async () => {
      const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.wsAdmin });

      expect(response.status).toBe(404);
      expect((response.body["error"] as { code: string }).code).toBe("NOT_FOUND");
    });

    it("mọi mutation project → 404, không ghi gì", async () => {
      const before = await snapshot();

      const rename = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("wsadmin"),
        body: { name: "Admin đổi tên" },
      });
      const addMember = await call(f, "POST", `/projects/${f.projectBId}/members`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("wsadmin"),
        body: { userId: f.wsAdmin.id, role: "owner" },
      });

      expect(rename.status).toBe(404);
      expect(addMember.status).toBe(404);
      expect(await snapshot()).toEqual(before);
    });

    it("nhưng vẫn quản trị được workspace — quyền workspace là thật", async () => {
      const response = await call(f, "GET", `/workspaces/${f.workspaceId}/members`, {
        actor: f.wsAdmin,
      });
      expect(response.status).toBe(200);

      const data = response.body["data"] as { items: unknown[] };
      expect(data.items.length).toBeGreaterThan(0);
    });

    it("admin của workspace này không đọc được member của workspace khác", async () => {
      const other = await call(f, "GET", `/workspaces/${f.workspaceId}/members`, {
        actor: f.outsider,
      });
      // `outsider` không thuộc workspace → `404`, không phải `403`.
      expect(other.status).toBe(404);
    });
  });

  describe("Workspace member thường không phải admin", () => {
    it("GET members của workspace mình thuộc về → 403, vì thấy được nhưng thiếu action", async () => {
      const response = await call(f, "GET", `/workspaces/${f.workspaceId}/members`, {
        actor: f.editor,
      });

      // Khác với `outsider`: `editor` **là** thành viên workspace, nên workspace
      // "nhìn thấy được" và câu trả lời đúng là `403`, không phải `404`.
      expect(response.status).toBe(403);
      expect((response.body["error"] as { code: string }).code).toBe("FORBIDDEN");
    });

    it("không tạo được project → 403", async () => {
      const before = await snapshot();

      const response = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.editor,
        idempotencyKey: newKey("editor"),
        body: { name: "Project của Editor" },
      });

      expect(response.status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("chưa xác thực", () => {
    it("không có cookie session → 401 trên mọi route được bảo vệ", async () => {
      for (const [method, path] of [
        ["GET", "/workspaces"],
        ["GET", `/projects/${f.projectBId}`],
        ["GET", `/workspaces/${f.workspaceId}/members`],
      ] as const) {
        const response = await call(f, method, path);
        expect(response.status).toBe(401);
        expect((response.body["error"] as { code: string }).code).toBe("UNAUTHENTICATED");
      }
    });

    it("session không tồn tại → 401, không phải 500", async () => {
      const response = await call(f, "GET", "/workspaces", {
        actor: { ...f.owner, sessionToken: "khong-ton-tai" },
      });
      expect(response.status).toBe(401);
    });
  });

  describe("CSRF", () => {
    it("mutation thiếu CSRF token → 403, không ghi gì", async () => {
      const before = await snapshot();

      const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        actor: f.owner,
        csrf: false,
        idempotencyKey: newKey("nocsrf"),
        body: { name: "Không có CSRF" },
      });

      expect(response.status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it("CSRF token của phiên khác không dùng được", async () => {
      const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
        // Cookie của owner, nhưng CSRF token suy từ session của editor.
        actor: { ...f.owner, csrfToken: f.editor.csrfToken },
        idempotencyKey: newKey("wrongcsrf"),
        body: { name: "CSRF chéo phiên" },
      });

      expect(response.status).toBe(403);
    });
  });
});
