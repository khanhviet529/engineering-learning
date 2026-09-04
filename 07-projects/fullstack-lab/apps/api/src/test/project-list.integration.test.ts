import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { listEnvelopeSchema, projectListItemSchema } from "@flowboard/contracts";
import { projectMembers, projects } from "../shared/database/schema.ts";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * `GET /workspaces/:workspaceId/projects` trên PostgreSQL thật.
 *
 * Ranh giới mà endpoint này phải giữ khác với các endpoint project khác ở
 * **cách biểu hiện**, không ở bản chất: ở `GET /projects/:projectId` một actor
 * ngoài project nhận `404`; ở đây họ nhận một **trang không chứa dòng đó**.
 *
 * Điều đó có nghĩa là test phải chứng minh sự **vắng mặt**, và vắng mặt là thứ
 * dễ chứng minh sai nhất: một trang rỗng vì query đúng và một trang rỗng vì
 * query hỏng trông giống hệt nhau. Nên mỗi test dưới đây đều có một **đối
 * chứng dương** đi kèm — cùng dữ liệu đó, một actor khác *có* thấy nó.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface ListBody {
  data: {
    items: { id: string; workspaceId: string; name: string; role: string }[];
    page: { nextCursor: string | null; hasMore: boolean };
  };
}

describeIfDb("GET /workspaces/:workspaceId/projects", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  const list = async (
    actor: Fixture["owner"],
    query = "",
    workspaceId?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> =>
    await call(f, "GET", `/workspaces/${workspaceId ?? f.workspaceId}/projects${query}`, {
      actor,
    });

  describe("chỉ trả project mà actor có project_members row", () => {
    it("Workspace Admin chưa là member của project nào nhận TRANG RỖNG", async () => {
      /**
       * Fixture có sẵn hai project trong workspace này (A và B), và `wsAdmin`
       * **không** có dòng `project_members` cho project nào.
       *
       * Ba khẳng định, không phải một: đúng `200` (không phải `403` — họ đọc
       * được workspace), `items` rỗng, và không có mảnh dữ liệu nào của Project
       * A hay B lọt vào body.
       */
      const response = await list(f.wsAdmin);

      expect(response.status).toBe(200);
      const body = response.body as unknown as ListBody;
      expect(body.data.items).toEqual([]);
      expect(body.data.page).toEqual({ nextCursor: null, hasMore: false });

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(f.projectAId);
      expect(serialized).not.toContain(f.projectBId);
    });

    it("đối chứng: hai project đó CÓ tồn tại và người khác thấy được", async () => {
      // Nếu thiếu test này, test trên vẫn xanh khi query hỏng và luôn trả rỗng.
      const ofUserB = (await list(f.userB)).body as unknown as ListBody;
      const ofUserA = (await list(f.userA)).body as unknown as ListBody;

      expect(ofUserB.data.items.map((p) => p.id)).toContain(f.projectBId);
      expect(ofUserA.data.items.map((p) => p.id)).toContain(f.projectAId);
    });

    it("User A chỉ thấy Project A, không thấy Project B — cùng workspace", async () => {
      /**
       * Hai project **cùng** một workspace. Nếu scope chỉ được áp ở tầng
       * workspace, User A sẽ thấy cả hai. Đây là chỗ chứng minh phép lọc xảy ra
       * ở tầng membership project.
       */
      const body = (await list(f.userA)).body as unknown as ListBody;
      const ids = body.data.items.map((p) => p.id);

      expect(ids).toContain(f.projectAId);
      expect(ids).not.toContain(f.projectBId);
    });

    it("actor có 2 trong 5 project của workspace nhận đúng 2 dòng", async () => {
      // Ba project mới, `viewer` chỉ được thêm vào hai trong số đó.
      const created: string[] = [];
      for (const name of ["Năm-1", "Năm-2", "Năm-3"]) {
        const response = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("five"),
          body: { name: `Dự án ${name}` },
        });
        created.push((response.body["data"] as { project: { id: string } }).project.id);
      }

      for (const projectId of created.slice(0, 2)) {
        await call(f, "POST", `/projects/${projectId}/members`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("five-member"),
          body: { userId: f.viewer.id, role: "viewer" },
        });
      }

      const body = (await list(f.viewer)).body as unknown as ListBody;
      const ids = body.data.items.map((p) => p.id);

      // `viewer` cũng là member của Project B từ fixture, nên tổng là 3.
      expect(ids.filter((id) => created.includes(id))).toHaveLength(2);
      expect(ids).toContain(created[0]);
      expect(ids).toContain(created[1]);
      expect(ids).not.toContain(created[2]);

      // `wsAdmin` tạo cả ba nên là Owner cả ba — đối chứng dương.
      const adminBody = (await list(f.wsAdmin)).body as unknown as ListBody;
      const adminIds = adminBody.data.items.map((p) => p.id);
      for (const projectId of created) expect(adminIds).toContain(projectId);
    });
  });

  describe("projection", () => {
    it("parse được bằng chính projectListItemSchema — .strict() bắt field thừa", async () => {
      const response = await list(f.userB);
      const schema = listEnvelopeSchema(projectListItemSchema);
      expect(() => schema.parse(response.body)).not.toThrow();
    });

    it("role là vai trò của CHÍNH actor, không phải của người khác", async () => {
      // `owner` và `editor` cùng là member của Project B với hai vai trò khác nhau.
      const asOwner = (await list(f.owner)).body as unknown as ListBody;
      const asEditor = (await list(f.editor)).body as unknown as ListBody;

      expect(asOwner.data.items.find((p) => p.id === f.projectBId)?.role).toBe("owner");
      expect(asEditor.data.items.find((p) => p.id === f.projectBId)?.role).toBe("editor");
    });

    it("không có count thành viên, count task, hay field ngoài projection", async () => {
      const response = await list(f.userB);
      const body = response.body as unknown as ListBody;
      const allowed = ["id", "workspaceId", "name", "role", "createdAt", "updatedAt"];

      for (const item of body.data.items) {
        expect(Object.keys(item).sort()).toEqual([...allowed].sort());
      }

      const serialized = JSON.stringify(response.body);
      for (const leak of [
        "memberCount",
        "taskCount",
        "createdByUserId",
        "members",
        "capabilities",
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });
  });

  describe("thứ tự và phân trang", () => {
    it("sắp theo createdAt DESC, id DESC", async () => {
      const body = (await list(f.wsAdmin)).body as unknown as ListBody;
      const items = body.data.items as unknown as { id: string; createdAt: string }[];

      for (let i = 1; i < items.length; i++) {
        const previous = items[i - 1] as { id: string; createdAt: string };
        const current = items[i] as { id: string; createdAt: string };
        const older = previous.createdAt > current.createdAt;
        const sameInstantLowerId =
          previous.createdAt === current.createdAt && previous.id > current.id;
        expect(older || sameInstantLowerId).toBe(true);
      }
    });

    it("cursor đi hết danh sách, không trùng và không mất dòng", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const query: string =
          cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
        const body = (await list(f.wsAdmin, query)).body as unknown as ListBody;
        seen.push(...body.data.items.map((p) => p.id));
        cursor = body.data.page.nextCursor;
        guard += 1;
      } while (cursor !== null && guard < 50);

      const full = (await list(f.wsAdmin, "?limit=100")).body as unknown as ListBody;
      expect(seen).toEqual(full.data.items.map((p) => p.id));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("cursor của một workspace khác → 400", async () => {
      // Workspace thứ hai, cùng actor: chỉ khác chiều `workspace` trong fingerprint.
      const other = await call(f, "POST", "/workspaces", {
        actor: f.wsAdmin,
        idempotencyKey: newKey("other-ws"),
        body: { name: "Không gian khác" },
      });
      const otherWorkspaceId = (other.body["data"] as { workspace: { id: string } }).workspace.id;

      await call(f, "POST", `/workspaces/${otherWorkspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("other-proj-1"),
        body: { name: "Dự án khác 1" },
      });
      await call(f, "POST", `/workspaces/${otherWorkspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("other-proj-2"),
        body: { name: "Dự án khác 2" },
      });

      const page = (await list(f.wsAdmin, "?limit=1", otherWorkspaceId))
        .body as unknown as ListBody;
      const cursor = page.data.page.nextCursor;
      expect(cursor).toBeTruthy();

      const reused = await list(
        f.wsAdmin,
        `?limit=1&cursor=${encodeURIComponent(cursor as string)}`,
      );
      expect(reused.status).toBe(400);
      expect((reused.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
    });

    it("cursor của actor khác trên cùng workspace → 400", async () => {
      const page = (await list(f.wsAdmin, "?limit=1")).body as unknown as ListBody;
      const cursor = page.data.page.nextCursor;
      expect(cursor).toBeTruthy();

      const stolen = await list(f.userB, `?limit=1&cursor=${encodeURIComponent(cursor as string)}`);
      expect(stolen.status).toBe(400);
    });

    it("cursor bịa và limit ngoài khoảng → 400, không clamp im lặng", async () => {
      expect((await list(f.wsAdmin, "?cursor=khong-phai-cursor")).status).toBe(400);
      expect((await list(f.wsAdmin, "?limit=0")).status).toBe(400);
      expect((await list(f.wsAdmin, "?limit=101")).status).toBe(400);
    });

    it("query field lạ → 400", async () => {
      // `listProjectsQuerySchema` là `.strict()`: không có trục lọc nào khác,
      // vì mỗi trục thêm vào là một cách dò xem project nào tồn tại.
      expect((await list(f.wsAdmin, "?sort=name")).status).toBe(400);
      expect((await list(f.wsAdmin, "?workspaceId=x")).status).toBe(400);
    });
  });

  describe("phạm vi workspace", () => {
    it("workspace không accessible → 404", async () => {
      const response = await list(f.outsider);
      expect(response.status).toBe(404);
      expect((response.body["error"] as { code: string }).code).toBe("NOT_FOUND");
    });

    it("workspace không tồn tại → 404, giống hệt workspace có thật mà không thấy được", async () => {
      const real = await list(f.outsider);
      const fake = await list(f.outsider, "", "00000000-0000-4000-8000-0000000000ff");

      expect(real.status).toBe(fake.status);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: "<redacted>" });
      expect(strip(real.body)).toEqual(strip(fake.body));
    });

    it("workspaceId sai định dạng → 400, không phải 500", async () => {
      const response = await call(f, "GET", "/workspaces/khong-phai-uuid/projects", {
        actor: f.wsAdmin,
      });
      expect(response.status).toBe(400);
    });

    it("không có session → 401", async () => {
      const response = await call(f, "GET", `/workspaces/${f.workspaceId}/projects`);
      expect(response.status).toBe(401);
    });

    it("project của workspace khác không lọt vào trang của workspace này", async () => {
      /**
       * `wsAdmin` là Owner của project ở **cả hai** workspace, nên nếu điều kiện
       * `projects.workspace_id` bị bỏ, project của workspace kia sẽ xuất hiện ở
       * đây. Membership một mình không bắt được lỗi đó.
       */
      const other = await call(f, "POST", "/workspaces", {
        actor: f.wsAdmin,
        idempotencyKey: newKey("iso-ws"),
        body: { name: "Không gian cách ly" },
      });
      const otherWorkspaceId = (other.body["data"] as { workspace: { id: string } }).workspace.id;

      const created = await call(f, "POST", `/workspaces/${otherWorkspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("iso-proj"),
        body: { name: "Dự án cách ly" },
      });
      const isolatedId = (created.body["data"] as { project: { id: string } }).project.id;

      const here = (await list(f.wsAdmin, "?limit=100")).body as unknown as ListBody;
      expect(here.data.items.map((p) => p.id)).not.toContain(isolatedId);

      // Đối chứng dương: ở đúng workspace của nó thì thấy được.
      const there = (await list(f.wsAdmin, "?limit=100", otherWorkspaceId))
        .body as unknown as ListBody;
      expect(there.data.items.map((p) => p.id)).toContain(isolatedId);
    });

    it("mất membership project thì dòng đó biến khỏi trang ngay lần đọc sau", async () => {
      const before = (await list(f.viewer, "?limit=100")).body as unknown as ListBody;
      const idsBefore = before.data.items.map((p) => p.id);
      expect(idsBefore).toContain(f.projectBId);
      // Viewer là member của nhiều hơn một project ở thời điểm này; con số đó là
      // thứ chứng minh lệnh xoá dưới đây có scope đúng.
      expect(idsBefore.length).toBeGreaterThan(1);

      /**
       * `and(...)` chứ **không** phải `.where().where()`.
       *
       * Drizzle coi lần gọi `.where()` thứ hai là **thay thế**, không phải AND:
       * `.where(project).where(user)` sinh ra `where user_id = $1` và xoá
       * membership của Viewer ở **mọi** project. Bản đầu của test này viết như
       * vậy — nó vẫn xanh, vì khẳng định "Project B biến mất" đúng cả khi xoá
       * quá tay. Đó là một test xanh vì lý do sai, và nó âm thầm làm hỏng
       * fixture cho các test sau.
       */
      await f.db
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.projectId, f.projectBId), eq(projectMembers.userId, f.viewer.id)),
        );

      const after = (await list(f.viewer, "?limit=100")).body as unknown as ListBody;
      const idsAfter = after.data.items.map((p) => p.id);
      expect(idsAfter).not.toContain(f.projectBId);
      // Đúng **một** dòng biến mất: các membership khác của Viewer còn nguyên.
      expect(idsAfter).toEqual(idsBefore.filter((id) => id !== f.projectBId));

      // Trả fixture về nguyên trạng: các test khác dựa vào Viewer là member.
      await f.db
        .insert(projectMembers)
        .values({ projectId: f.projectBId, userId: f.viewer.id, role: "viewer" });
      const restored = (await list(f.viewer, "?limit=100")).body as unknown as ListBody;
      expect(restored.data.items.map((p) => p.id).sort()).toEqual([...idsBefore].sort());
    });
  });

  describe("dữ liệu khớp database", () => {
    it("mỗi dòng trả về khớp đúng hàng trong projects", async () => {
      const body = (await list(f.userB, "?limit=100")).body as unknown as ListBody;
      const item = body.data.items.find((p) => p.id === f.projectBId);
      expect(item).toBeDefined();

      const [row] = await f.db
        .select({ name: projects.name, workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, f.projectBId));

      expect(item?.name).toBe(row?.name);
      expect(item?.workspaceId).toBe(row?.workspaceId);
    });
  });
});
