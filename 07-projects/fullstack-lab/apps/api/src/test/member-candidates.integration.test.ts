import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { listEnvelopeSchema, memberCandidateSchema } from "@flowboard/contracts";
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "../shared/database/schema.ts";
import { call, createFixture, type Fixture, type TestActor } from "./fixture.ts";

/**
 * `GET /projects/:projectId/member-candidates` trên PostgreSQL thật.
 *
 * Endpoint này **nới phạm vi nhìn thấy** có chủ đích: hôm nay một workspace
 * member thường không đọc được roster workspace (`GET
 * /workspaces/:workspaceId/members` đòi Workspace Admin), còn ở đây một project
 * Owner đọc được tên và email của mọi workspace member.
 *
 * Nên bộ test này dành phần lớn công sức chứng minh **giới hạn**, không chứng
 * minh happy path. Ba giới hạn, và chúng hỏng theo ba kiểu khác nhau:
 *
 * 1. **Ai được gọi** — Editor/Viewer phải nhận `403`, không phải một trang
 *    rỗng. Trang rỗng nói dối rằng workspace không có ai để thêm.
 * 2. **Thấy được gì** — đúng ba field. Một field lỡ thêm vào projection sau này
 *    là một lần nới nữa mà không ai duyệt, nên shape được khẳng định bằng chính
 *    `memberCandidateSchema.strict()`.
 * 3. **Phân trang có bỏ sót ai không** — loại trừ và `limit` phải đi cùng một
 *    câu truy vấn, và cursor phải mang khoá hai cột. Cả hai lỗi đều **im lặng**:
 *    chúng trả `200` với một danh sách thiếu người.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface Candidate {
  userId: string;
  displayName: string;
  email: string;
}

interface ListBody {
  data: {
    items: Candidate[];
    page: { nextCursor: string | null; hasMore: boolean };
  };
}

describeIfDb("GET /projects/:projectId/member-candidates", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  const list = async (
    actor: TestActor,
    projectId: string,
    query = "",
  ): Promise<{ status: number; body: Record<string, unknown> }> =>
    await call(f, "GET", `/projects/${projectId}/member-candidates${query}`, { actor });

  const itemsOf = (body: Record<string, unknown>): Candidate[] =>
    (body as unknown as ListBody).data.items;

  const pageOf = (body: Record<string, unknown>): { nextCursor: string | null; hasMore: boolean } =>
    (body as unknown as ListBody).data.page;

  /* ---------------------------------------------------------------------- *
   * Ai được gọi
   * ---------------------------------------------------------------------- */

  describe("chỉ project Owner", () => {
    /**
     * Project B có bốn member: `userB` và `owner` là Owner, `editor` là Editor,
     * `viewer` là Viewer. Cả bốn đều **thấy** project — nên `403` ở đây chứng
     * minh đúng điều cần: quyền đọc project không kéo theo quyền đọc roster.
     */
    it("Editor và Viewer của project nhận 403, không phải danh sách rỗng", async () => {
      for (const actor of [f.editor, f.viewer]) {
        const response = await list(actor, f.projectBId);
        expect(response.status, actor.email).toBe(403);
        // Không được rò một mảnh nào của roster vào thân lỗi.
        expect(JSON.stringify(response.body)).not.toContain(f.userA.email);
      }
    });

    /** Đối chứng dương: cùng project đó, một Owner **có** đọc được. */
    it("Owner của cùng project đó đọc được", async () => {
      const response = await list(f.owner, f.projectBId);
      expect(response.status).toBe(200);
    });

    /**
     * `wsAdmin` là Workspace Admin — người **đã** đọc được roster qua
     * `GET /workspaces/:workspaceId/members`. Họ vẫn nhận `404` ở đây, vì họ
     * không có dòng `project_members` cho project này.
     *
     * Đây là ca đắt nhất trong nhóm: nó chứng minh `404` đến từ *membership của
     * project*, không phải từ việc actor thiếu quyền đọc dữ liệu bên trong.
     */
    it("người ngoài project nhận 404, kể cả Workspace Admin", async () => {
      for (const actor of [f.outsider, f.wsAdmin, f.userA]) {
        const response = await list(actor, f.projectBId);
        expect(response.status, actor.email).toBe(404);
      }
    });

    it("project không tồn tại cũng là 404, cùng response", async () => {
      const response = await list(f.owner, "00000000-0000-0000-0000-000000000000");
      expect(response.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Thấy được gì
   * ---------------------------------------------------------------------- */

  describe("projection đúng ba field", () => {
    /**
     * Khẳng định bằng **chính schema của hợp đồng**, ở chế độ `strict`.
     *
     * Một `expect(item.userId).toBeDefined()` viết tay sẽ xanh kể cả khi
     * response mọc thêm `role` hay `workspaceRole`. `strict()` làm điều ngược
     * lại: field lạ là lỗi, và đó là thứ giữ cho lần nới phạm vi này có biên.
     */
    it("mỗi item khớp memberCandidateSchema.strict(), không thừa field nào", async () => {
      const response = await list(f.owner, f.projectBId);
      expect(response.status).toBe(200);

      const envelope = listEnvelopeSchema(memberCandidateSchema.strict());
      const parsed = envelope.safeParse(response.body);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      expect(itemsOf(response.body).length).toBeGreaterThan(0);
    });

    it("không lộ role workspace, cũng không lộ project nào người đó đang ở", async () => {
      const response = await list(f.owner, f.projectBId);
      const raw = JSON.stringify(itemsOf(response.body));

      for (const leak of ["role", "workspace_role", "workspaceRole", "projects", "projectId"]) {
        expect(raw, `không được có "${leak}"`).not.toContain(`"${leak}"`);
      }
      // `wsAdmin` là ứng viên hợp lệ ở Project B — nhưng vai trò admin của họ
      // không được đi kèm.
      expect(raw).not.toContain("workspace_admin");
    });
  });

  /* ---------------------------------------------------------------------- *
   * Ai bị loại
   * ---------------------------------------------------------------------- */

  describe("người đã là project member không xuất hiện", () => {
    /**
     * Project B có bốn member; workspace có sáu người. Ứng viên vì vậy phải là
     * đúng hai người còn lại — và **cả hai** khẳng định đều cần: chỉ kiểm sự
     * vắng mặt sẽ xanh với một danh sách rỗng do query hỏng.
     */
    it("trả đúng phần bù, không nhiều không ít", async () => {
      const response = await list(f.owner, f.projectBId);
      const ids = itemsOf(response.body)
        .map((item) => item.userId)
        .sort();

      expect(ids).toEqual([f.wsAdmin.id, f.userA.id].sort());
    });

    /** Hợp đồng nêu riêng ca này: Owner cũng là member, nên Owner cũng bị loại. */
    it("Owner của project — kể cả chính actor đang gọi — không tự xuất hiện", async () => {
      const response = await list(f.owner, f.projectBId);
      const ids = itemsOf(response.body).map((item) => item.userId);

      expect(ids, "actor tự thấy mình trong danh sách ứng viên").not.toContain(f.owner.id);
      expect(ids, "Owner còn lại của project vẫn lọt vào").not.toContain(f.userB.id);
    });

    /**
     * Project A chỉ có một member (`userA`), nên phần bù là năm người còn lại.
     * Ca này canh một lỗi khác với ca trên: một `not in` dựng sai với tập một
     * phần tử, hoặc một anti-join loại nhầm cả workspace.
     */
    it("project một member: đúng năm ứng viên còn lại", async () => {
      const response = await list(f.userA, f.projectAId);
      expect(response.status).toBe(200);

      const ids = itemsOf(response.body)
        .map((item) => item.userId)
        .sort();
      expect(ids).toEqual([f.owner.id, f.editor.id, f.viewer.id, f.wsAdmin.id, f.userB.id].sort());
      expect(ids).not.toContain(f.outsider.id);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Query
   * ---------------------------------------------------------------------- */

  describe("query chỉ nhận cursor và limit", () => {
    it("field lạ là 400", async () => {
      for (const query of ["?search=abc", "?role=owner", "?workspaceId=x", "?sort=email"]) {
        const response = await list(f.owner, f.projectBId, query);
        expect(response.status, query).toBe(400);
      }
    });

    it("limit ngoài dải là 400, không phải clamp im lặng", async () => {
      for (const query of ["?limit=0", "?limit=101", "?limit=abc"]) {
        const response = await list(f.owner, f.projectBId, query);
        expect(response.status, query).toBe(400);
      }
    });

    /**
     * Cursor của **người khác, project khác** không dùng lại được.
     *
     * `userA` phân trang ứng viên của Project A; cursor đó mang fingerprint của
     * `(actor=userA, project=A)`. Đưa nó cho `owner` gọi Project B phải là
     * `400` — không phải một trang lệch trả về `200`.
     */
    it("cursor của actor khác và project khác là 400", async () => {
      const mine = await list(f.userA, f.projectAId, "?limit=1");
      expect(mine.status).toBe(200);
      const cursor = pageOf(mine.body).nextCursor;
      expect(cursor, "Project A có năm ứng viên nên limit=1 phải còn trang sau").not.toBeNull();

      const response = await list(f.owner, f.projectBId, `?cursor=${encodeURIComponent(cursor!)}`);
      expect(response.status).toBe(400);
    });

    /** Cursor bịa hoàn toàn cũng là `400`, cùng một thông điệp. */
    it("cursor bịa là 400", async () => {
      const response = await list(f.owner, f.projectBId, "?cursor=khong-phai-cursor.chu-ky-gia");
      expect(response.status).toBe(400);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Ranh giới trang — nơi hai lỗi im lặng sống
   * ---------------------------------------------------------------------- */

  describe("phân trang: loại trừ trong SQL, cursor hai cột", () => {
    /**
     * Một workspace riêng, dựng để **đặt chính xác** hai ranh giới:
     *
     * ```text
     * roster đầy đủ, sắp theo (displayName, userId):
     *   Cand-01          ứng viên
     *   Cand-02 (X)      ứng viên      ─┐ trùng tên
     *   Cand-02 (Y)      ứng viên      ─┘
     *   Cand-03          ĐÃ LÀ MEMBER  → phải bị loại
     *   Cand-04          ứng viên
     *   Cand-05          ứng viên
     * ```
     *
     * Với `limit=2`, hai ranh giới rơi đúng chỗ cần:
     *
     * - Ranh giới trang 1|2 nằm **giữa hai người trùng tên** (`Cand-02 X` và
     *   `Cand-02 Y`). Một cursor chỉ mang `displayName` sẽ seek
     *   `name > 'Cand-02'` và **nuốt mất Y**. Không có ca này thì cursor một
     *   cột vẫn xanh.
     * - Trang 2 phải nhảy qua `Cand-03` để lấy `Cand-04`. Nếu việc loại trừ xảy
     *   ra **sau** khi cắt trang, trang 2 đọc `[Y, Cand-03]`, bỏ một, và trả về
     *   **một** phần tử — trang ngắn không đều, đúng triệu chứng mà câu hỏi 2
     *   cảnh báo.
     */
    let workspaceId: string;
    let projectId: string;
    let extraUserIds: string[] = [];
    /** `[userId, displayName]` theo đúng thứ tự roster mong đợi. */
    let roster: { id: string; name: string }[] = [];

    beforeAll(async () => {
      const suffix = Math.random().toString(36).slice(2, 8);

      const [workspace] = await f.db
        .insert(workspaces)
        .values({ name: `Roster ${suffix}` })
        .returning({ id: workspaces.id });
      workspaceId = (workspace as { id: string }).id;

      const [project] = await f.db
        .insert(projects)
        .values({ workspaceId, name: `Roster project ${suffix}`, createdByUserId: f.owner.id })
        .returning({ id: projects.id });
      projectId = (project as { id: string }).id;

      // `f.owner` là Owner của project này — họ gọi endpoint, và họ cũng phải
      // **không** xuất hiện trong kết quả.
      await f.db.insert(workspaceMembers).values({
        workspaceId,
        userId: f.owner.id,
        role: "workspace_member",
      });
      await f.db.insert(projectMembers).values({ projectId, userId: f.owner.id, role: "owner" });

      /**
       * Hai người mang **cùng** `displayName` `Cand-02`.
       *
       * Thứ tự giữa họ do `userId` quyết định, và `userId` là UUID ngẫu nhiên —
       * nên test không giả định ai trước, nó **đọc lại** thứ tự sau khi tạo.
       */
      const names = ["Cand-01", "Cand-02", "Cand-02", "Cand-03", "Cand-04", "Cand-05"];
      const created: { id: string; name: string }[] = [];
      for (const [index, name] of names.entries()) {
        const [row] = await f.db
          .insert(users)
          .values({
            email: `cand-${String(index)}-${suffix}@example.test`,
            displayName: name,
            /**
             * Bắt đầu bằng `$argon2id$` là **bắt buộc**, không phải trang trí.
             *
             * `auth-use-cases.integration.test.ts` khẳng định trên **toàn bảng**
             * `users` rằng không hàng nào có `password_hash not like
             * '$argon2id$%'`. Vitest chạy các file song song trên cùng một
             * database, nên một placeholder sai hình dạng ở đây làm test của
             * file kia đỏ theo cách không ai truy được. Những user này không
             * bao giờ đăng nhập; chuỗi này chỉ cần **không phải plaintext** và
             * không phá được phép kiểm kia.
             */
            passwordHash: "$argon2id$fixture-placeholder-khong-dung-de-dang-nhap",
          })
          .returning({ id: users.id });
        const id = (row as { id: string }).id;
        created.push({ id, name });
        await f.db
          .insert(workspaceMembers)
          .values({ workspaceId, userId: id, role: "workspace_member" });
      }
      extraUserIds = created.map((entry) => entry.id);

      // Thứ tự roster thật: theo `displayName`, rồi `userId`.
      roster = [...created].sort((a, b) =>
        a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1,
      );

      // `Cand-03` đã là project member → bị loại, và nó nằm ngay sau ranh giới.
      const excluded = roster.find((entry) => entry.name === "Cand-03");
      await f.db.insert(projectMembers).values({ projectId, userId: excluded!.id, role: "editor" });
    });

    afterAll(async () => {
      // Dọn theo chiều ngược của FK: mọi FK ở đây là `ON DELETE RESTRICT`.
      await f.db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
      await f.db.delete(projects).where(eq(projects.id, projectId));
      await f.db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
      await f.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await f.db.delete(users).where(inArray(users.id, extraUserIds));
    });

    it("trang đầy đủ ở giữa, và không ai bị bỏ sót ở ranh giới", async () => {
      const expected = roster.filter((entry) => entry.name !== "Cand-03");
      expect(expected).toHaveLength(5);

      const seen: Candidate[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 10; page += 1) {
        const query: string =
          cursor === null ? "?limit=2" : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
        const response = await list(f.owner, projectId, query);
        expect(response.status, `trang ${String(page)}`).toBe(200);

        seen.push(...itemsOf(response.body));
        sizes.push(itemsOf(response.body).length);

        const info = pageOf(response.body);
        if (!info.hasMore) {
          expect(info.nextCursor, "trang cuối không được mang cursor").toBeNull();
          break;
        }
        expect(info.nextCursor).not.toBeNull();
        cursor = info.nextCursor;
      }

      /**
       * Ba khẳng định, và mỗi cái bắt một lỗi khác nhau:
       *
       * - **Kích thước trang** bắt lỗi lọc-sau-khi-cắt: nó cho `[1, 1, 1, 1, 1]`
       *   thay vì `[2, 2, 1]`.
       * - **Danh sách nối lại** bắt lỗi cursor một cột: nó nuốt mất người thứ
       *   hai trong cặp trùng tên.
       * - **Không trùng lặp** bắt lỗi seek dùng `>=` thay vì `>`.
       */
      expect(sizes, "trang giữa phải đầy; trang ngắn là dấu lọc sau khi cắt").toEqual([2, 2, 1]);
      expect(seen.map((item) => item.userId)).toEqual(expected.map((entry) => entry.id));
      expect(new Set(seen.map((item) => item.userId)).size).toBe(seen.length);
    });

    it("hai người trùng displayName đều có mặt, theo thứ tự userId", async () => {
      const response = await list(f.owner, projectId, "?limit=100");
      const pair = itemsOf(response.body).filter((item) => item.displayName === "Cand-02");

      expect(pair, "trùng tên là ca bình thường, không phải ca bị loại").toHaveLength(2);
      expect(pair[0]!.userId < pair[1]!.userId, "tie-break phải theo userId tăng dần").toBe(true);
    });

    it("người đã là member vắng mặt ở mọi trang, và Owner cũng vậy", async () => {
      const excluded = roster.find((entry) => entry.name === "Cand-03")!;
      const response = await list(f.owner, projectId, "?limit=100");
      const ids = itemsOf(response.body).map((item) => item.userId);

      expect(ids).not.toContain(excluded.id);
      expect(ids).not.toContain(f.owner.id);
      expect(ids).toHaveLength(5);
    });

    /**
     * Cursor gắn fingerprint theo **project**, không theo workspace.
     *
     * Hai project cùng workspace có hai tập loại trừ khác nhau, nên một cursor
     * đi lạc sang project kia sẽ trả một trang lệch — im lặng, `200`, sai.
     */
    it("cursor của project khác trong cùng workspace là 400", async () => {
      const first = await list(f.owner, projectId, "?limit=2");
      const cursor = pageOf(first.body).nextCursor;
      expect(cursor).not.toBeNull();

      const other = await list(f.owner, f.projectBId, `?cursor=${encodeURIComponent(cursor!)}`);
      expect(other.status).toBe(400);
    });
  });

  afterAll(async () => {
    await f.cleanup();
  });
});
