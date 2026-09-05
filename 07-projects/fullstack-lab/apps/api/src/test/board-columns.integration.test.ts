import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { columnResponseSchema, columnsResponseSchema } from "@flowboard/contracts";
import { createDatabase } from "../shared/database/client.ts";
import { formatPosition, parsePosition } from "../shared/ordering/position.ts";
import { boardColumns } from "../shared/database/schema.ts";
import { ColumnRepository } from "../modules/board-columns/infrastructure/column-repository.ts";
import { call, createFixture, newKey, type Fixture, type TestActor } from "./fixture.ts";

/**
 * Board column trên PostgreSQL thật — M3.
 *
 * Ba nhóm điều chỉ chứng minh được ở đây, không ở unit test:
 *
 * 1. **Fractional ordering thật sự chạy hết vòng đời của nó.** Số học đã có
 *    test riêng ở `domain/ordering.test.ts`; thứ còn lại là rebalance có thật
 *    sự ghi xuống database không, và constraint `DEFERRABLE` có thật sự là điều
 *    khiến nó ghi được không. Cả hai câu đó cần một database.
 * 2. **Ba luật không hồi tố.** Chúng nói về những cột *không* bị đổi, và cách
 *    duy nhất kiểm là đọc hàng trước và sau rồi so.
 * 3. **Status thật của ba route.** `@HttpCode` vắng mặt trông y hệt `@HttpCode`
 *    đúng; chỉ một lần gọi thật mới phân biệt được `200` với `201`.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface ColumnBody {
  id: string;
  projectId: string;
  name: string;
  requiresReviewer: boolean;
  isTerminal: boolean;
  position: string;
  archivedAt: string | null;
}

describeIfDb("board column", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  /**
   * Mỗi nhóm test dựng project riêng.
   *
   * Ordering là trạng thái toàn cục của một project: một test chèn cột sẽ đổi
   * dãy position mà test khác đang khẳng định. Dùng chung một project là cách
   * biến thứ tự chạy thành một phần của kết quả.
   */
  async function newProject(label: string): Promise<string> {
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey(label),
      body: { name: `${label} ${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(created.status).toBe(201);
    return (created.body["data"] as { project: { id: string } }).project.id;
  }

  async function createColumn(
    projectId: string,
    name: string,
    extra: Partial<{
      afterColumnId: string | null;
      isTerminal: boolean;
      requiresReviewer: boolean;
    }> = {},
    actor: TestActor = f.wsAdmin,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return await call(f, "POST", `/projects/${projectId}/columns`, {
      actor,
      idempotencyKey: newKey("col"),
      body: { name, afterColumnId: null, ...extra },
    });
  }

  /** Column trong response, sau khi đã khẳng định request thành công. */
  function columnOf(response: { body: Record<string, unknown> }): ColumnBody {
    return (response.body["data"] as { column: ColumnBody }).column;
  }

  /** Board đọc qua `GET /projects/:projectId` — đúng đường mà client đi. */
  async function boardOf(projectId: string, actor: TestActor = f.wsAdmin): Promise<ColumnBody[]> {
    const response = await call(f, "GET", `/projects/${projectId}`, { actor });
    expect(response.status).toBe(200);
    return (response.body["data"] as { columns: ColumnBody[] }).columns;
  }

  /** Hàng thật trong database, kể cả archived. */
  async function rowsOf(projectId: string) {
    const rows = await f.db
      .select({
        id: boardColumns.id,
        name: boardColumns.name,
        position: boardColumns.position,
        isTerminal: boardColumns.isTerminal,
        requiresReviewer: boardColumns.requiresReviewer,
        archivedAt: boardColumns.archivedAt,
        updatedAt: boardColumns.updatedAt,
      })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(boardColumns.position);

    // `position` là chuỗi thập phân của `numeric(20,10)`; test so sánh nó dưới
    // dạng số nguyên đã tỉ lệ, đúng cách phần còn lại của hệ thống làm.
    return rows.map((row) => ({ ...row, position: parsePosition(row.position) }));
  }

  /* ---------------------------------------------------------------------- *
   * POST /projects/:projectId/columns
   * ---------------------------------------------------------------------- */

  describe("POST /projects/:projectId/columns", () => {
    it("cột đầu tiên nhận đúng 1024, và response khớp hợp đồng", async () => {
      const projectId = await newProject("first-col");

      const response = await createColumn(projectId, "Cần làm");

      expect(response.status).toBe(201);
      const parsed = columnResponseSchema.safeParse(response.body["data"]);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

      const column = columnOf(response);
      // Chuỗi thập phân đủ scale, không phải JSON number.
      expect(column.position).toBe("1024.0000000000");
      expect(column.projectId).toBe(projectId);
      expect(column.isTerminal).toBe(false);
      expect(column.requiresReviewer).toBe(false);
      expect(column.archivedAt).toBeNull();
    });

    it("`afterColumnId: null` là **append**: cột kế tiếp nhận max + 1024", async () => {
      const projectId = await newProject("append");

      await createColumn(projectId, "Cần làm");
      const second = await createColumn(projectId, "Đang làm");
      const third = await createColumn(projectId, "Xong");

      expect(columnOf(second).position).toBe("2048.0000000000");
      expect(columnOf(third).position).toBe("3072.0000000000");
      expect((await boardOf(projectId)).map((c) => c.name)).toEqual([
        "Cần làm",
        "Đang làm",
        "Xong",
      ]);
    });

    it("chèn giữa nhận trung điểm, và board đọc lại theo đúng thứ tự mới", async () => {
      const projectId = await newProject("midpoint");

      const first = await createColumn(projectId, "Cần làm");
      await createColumn(projectId, "Xong");

      const middle = await createColumn(projectId, "Đang làm", {
        afterColumnId: columnOf(first).id,
      });

      expect(middle.status).toBe(201);
      expect(columnOf(middle).position).toBe("1536.0000000000");
      expect((await boardOf(projectId)).map((c) => c.name)).toEqual([
        "Cần làm",
        "Đang làm",
        "Xong",
      ]);
    });

    it("`isTerminal` và `requiresReviewer` được giữ đúng như client gửi", async () => {
      const projectId = await newProject("flags");

      const response = await createColumn(projectId, "Chờ duyệt", {
        isTerminal: true,
        requiresReviewer: true,
      });

      const column = columnOf(response);
      expect(column.isTerminal).toBe(true);
      expect(column.requiresReviewer).toBe(true);
    });

    it("`afterColumnId` của project khác → 400, và không cột nào được tạo", async () => {
      const projectId = await newProject("anchor-cross");
      const otherProjectId = await newProject("anchor-owner");

      const foreign = await createColumn(otherProjectId, "Cột của project khác");
      const before = await rowsOf(projectId);

      const response = await createColumn(projectId, "Chen ngang", {
        afterColumnId: columnOf(foreign).id,
      });

      expect(response.status).toBe(400);
      expect((response.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
      // Cột lạ **không** bị kéo vào dãy position của project này.
      expect(await rowsOf(projectId)).toEqual(before);
      expect(await rowsOf(otherProjectId)).toHaveLength(1);
    });

    it("`afterColumnId` trỏ cột đã archive → 400", async () => {
      const projectId = await newProject("anchor-archived");

      const keep = await createColumn(projectId, "Giữ lại");
      const doomed = await createColumn(projectId, "Sắp archive");

      const archived = await call(f, "PATCH", `/columns/${columnOf(doomed).id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("arch"),
        body: { archive: true },
      });
      expect(archived.status).toBe(200);

      const response = await createColumn(projectId, "Sau cột đã archive", {
        afterColumnId: columnOf(doomed).id,
      });
      expect(response.status).toBe(400);

      // Cột còn lại vẫn nguyên vị trí — nhánh từ chối không ghi gì.
      expect((await boardOf(projectId)).map((c) => c.id)).toEqual([columnOf(keep).id]);
    });

    it("client không gửi được `position`, `projectId` hay timestamp — body strict", async () => {
      const projectId = await newProject("strict");

      for (const body of [
        { name: "X", afterColumnId: null, position: "1.0" },
        { name: "X", afterColumnId: null, projectId },
        { name: "X", afterColumnId: null, archivedAt: null },
        { name: "X", afterColumnId: null, createdAt: new Date().toISOString() },
      ]) {
        const response = await call(f, "POST", `/projects/${projectId}/columns`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("strict"),
          body,
        });
        expect(response.status, JSON.stringify(body)).toBe(400);
      }

      expect(await rowsOf(projectId)).toHaveLength(0);
    });

    /**
     * Hai lần thêm cột chồng nhau — và vì sao `FOR UPDATE` một mình không đủ.
     *
     * Test này dựng **đúng** cửa sổ race thay vì bắn hai request rồi hy vọng
     * chúng va nhau: gọi `Promise.all` hai lần `POST` gần như luôn xanh, kể cả
     * khi lỗ hổng còn nguyên, vì hai transaction hiếm khi chồng nhau đúng chỗ.
     * Một test như thế xanh mà không kiểm được gì.
     *
     * Ở đây hai transaction được xếp bằng tay, và điều kiện "t2 đã chặn" được
     * **quan sát** qua `pg_stat_activity` chứ không phải chờ một khoảng thời
     * gian đoán trước.
     *
     * Kết quả cần thấy:
     *
     * - Chỉ `FOR UPDATE`: t2 phát `SELECT` **trước** khi t1 commit, nên snapshot
     *   của câu lệnh đó không bao giờ chứa row t1 vừa thêm. Sau khi hết chặn,
     *   t2 vẫn thấy board cũ và sẽ tính ra đúng `position` mà t1 đã dùng.
     * - Có `pg_advisory_xact_lock`: t2 chặn **trước** câu `SELECT`, nên khi chạy
     *   nó là một câu lệnh mới với snapshot mới và thấy đủ cả hai cột.
     */
    it("FOR UPDATE một mình để lọt race thêm cột; advisory lock bịt nó", async () => {
      const projectId = await newProject("create-race");
      await createColumn(projectId, "Cột nền");

      /**
       * Pool riêng: kịch bản cần **ba** kết nối cùng lúc (hai transaction và một
       * người quan sát), còn pool của fixture cố ý chỉ có hai.
       */
      const race = createDatabase(url as string, { max: 3 });
      const repository = new ColumnRepository(race.db);

      /** Chờ tới khi có một câu lệnh đang bị chặn đúng như mô tả. */
      async function waitUntilBlocked(queryLike: string): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt++) {
          const [row] = await race.db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
                where wait_event_type = 'Lock' and query like ${queryLike}`,
          );
          if ((row?.n ?? 0) > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`không thấy câu lệnh nào bị chặn khớp ${queryLike}`);
      }

      try {
        // ---- Chỉ `FOR UPDATE`: t2 đọc thiếu row của t1 ----------------------
        let releaseFirst = (): void => {};
        const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
        let firstLocked = (): void => {};
        const firstHasLocks = new Promise<void>((resolve) => (firstLocked = resolve));
        let secondSaw: { id: string }[] = [];

        const first = race.db.transaction(async (tx) => {
          await repository.lockActiveColumns(projectId, tx);
          // Chỉ khi t1 **đã** cầm khoá thì t2 mới được bắt đầu: thứ tự hai
          // transaction là một phần của kịch bản, không phải may rủi.
          firstLocked();
          await firstMayCommit;
          await repository.insertColumn(
            {
              projectId,
              name: "Của t1",
              position: parsePosition("2048"),
              isTerminal: false,
              requiresReviewer: false,
            },
            tx,
          );
        });

        await firstHasLocks;
        const second = race.db.transaction(async (tx) => {
          secondSaw = await repository.lockActiveColumns(projectId, tx);
        });

        await waitUntilBlocked("%board_columns%for update%");
        releaseFirst();
        await Promise.all([first, second]);

        // Đây là lỗ hổng, nói thẳng ra: t2 không hề thấy cột mà t1 vừa thêm.
        expect(secondSaw).toHaveLength(1);
        expect(secondSaw.map((row) => row.id)).not.toContain(
          (await rowsOf(projectId)).find((row) => row.name === "Của t1")?.id,
        );

        // ---- Thêm advisory lock: t2 chặn sớm hơn và đọc lại đúng ------------
        let releaseThird = (): void => {};
        const thirdMayCommit = new Promise<void>((resolve) => (releaseThird = resolve));
        let thirdLocked = (): void => {};
        const thirdHasLocks = new Promise<void>((resolve) => (thirdLocked = resolve));
        let fourthSaw: { name: string }[] = [];

        const third = race.db.transaction(async (tx) => {
          await repository.lockProjectOrdering(projectId, tx);
          await repository.lockActiveColumns(projectId, tx);
          thirdLocked();
          await thirdMayCommit;
          await repository.insertColumn(
            {
              projectId,
              name: "Của t3",
              position: parsePosition("3072"),
              isTerminal: false,
              requiresReviewer: false,
            },
            tx,
          );
        });

        await thirdHasLocks;
        const fourth = race.db.transaction(async (tx) => {
          await repository.lockProjectOrdering(projectId, tx);
          fourthSaw = await repository.lockActiveColumns(projectId, tx);
        });

        await waitUntilBlocked("%pg_advisory_xact_lock%");
        releaseThird();
        await Promise.all([third, fourth]);

        expect(fourthSaw).toHaveLength(3);
        expect(fourthSaw.map((row) => row.name)).toContain("Của t3");
      } finally {
        await race.close();
      }
    }, 60_000);

    it("Editor có board-column:read nhưng không có manage → 403, không ghi gì", async () => {
      const before = await rowsOf(f.projectBId);
      const activityBefore = await f.activity.countForProject(f.projectBId);

      const response = await call(f, "POST", `/projects/${f.projectBId}/columns`, {
        actor: f.editor,
        idempotencyKey: newKey("editor-col"),
        body: { name: "Editor tạo cột", afterColumnId: null },
      });

      expect(response.status).toBe(403);
      expect(await rowsOf(f.projectBId)).toEqual(before);
      expect(await f.activity.countForProject(f.projectBId)).toBe(activityBefore);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Rebalance
   * ---------------------------------------------------------------------- */

  describe("rebalance", () => {
    /**
     * Chèn thật, qua HTTP, **cho tới khi** rebalance tự chạy.
     *
     * Không mock, không gọi thẳng `planInsert`. Một rebalance chưa từng chạy
     * trong test là một rebalance chưa được kiểm, và đây là đường duy nhất
     * chứng minh nó chạy được trên schema thật — nơi `DEFERRABLE`, row lock và
     * `numeric(20,10)` đều tham gia.
     *
     * Mỗi lần chèn đều lấy **cùng một mốc**, nên khe giữa mốc và neighbor phải
     * của nó chia đôi sau mỗi lần: từ 1024 tới dưới 10⁻⁶ mất khoảng 30 lần.
     */
    it("chèn liên tiếp cùng một khe làm rebalance tự chạy, và nó chỉ ghi position", async () => {
      const projectId = await newProject("rebalance");

      const anchor = await createColumn(projectId, "Mốc");
      await createColumn(projectId, "Neighbor phải");
      const anchorId = columnOf(anchor).id;

      let insertsBeforeRebalance: number | undefined;
      let updatedAtBefore = new Map<string, number>();

      for (let attempt = 1; attempt <= 60; attempt++) {
        // Ảnh chụp `updated_at` **ngay trước** lần chèn có thể rebalance.
        const snapshot = new Map(
          (await rowsOf(projectId)).map((row) => [row.id, row.updatedAt.getTime()]),
        );

        const response = await createColumn(projectId, `Chen ${String(attempt)}`, {
          afterColumnId: anchorId,
        });
        expect(response.status).toBe(201);

        // `board_column.created` mang theo số row đã bị rebalance. Rebalance
        // không có response field nào, nên payload này là chỗ duy nhất quan sát
        // được nó — và ở đây nó là bằng chứng rằng nó đã chạy thật.
        const recent = await f.activity.recentForProject(projectId, 1);
        const payload = recent[0]?.payload as { rebalanced?: number } | undefined;

        if ((payload?.rebalanced ?? 0) > 0) {
          insertsBeforeRebalance = attempt;
          updatedAtBefore = snapshot;
          break;
        }
      }

      expect(
        insertsBeforeRebalance,
        "rebalance chưa bao giờ chạy — ngưỡng hoặc spacing đã đổi",
      ).toBeDefined();
      // Đo thật trên PostgreSQL: **31** lần chèn. ADR-0006 dự đoán ~29–30 từ
      // `1024 / 2^n < 10⁻⁶`; lần thứ 31 là lần đầu *khe hiện tại* nhỏ hơn ngưỡng.
      // Biên rộng vì đây là số học dấu phẩy động đi qua `numeric(20,10)`.
      expect(insertsBeforeRebalance).toBeGreaterThanOrEqual(25);
      expect(insertsBeforeRebalance).toBeLessThanOrEqual(35);

      const after = await rowsOf(projectId);

      /**
       * Rebalance **không** chạm `updated_at`.
       *
       * ADR-0006 mục 5: `position` do server sở hữu tuyệt đối, nên không có gì
       * để một `version` bảo vệ; còn chạm `updated_at` sẽ xáo seek pagination
       * theo `updated_at DESC` và làm người đang cuộn thấy row trùng hoặc mất
       * row. Đây là chỗ duy nhất kiểm được điều đó.
       */
      let compared = 0;
      for (const row of after) {
        const was = updatedAtBefore.get(row.id);
        if (was === undefined) continue; // Cột vừa được tạo trong chính lần này.
        compared += 1;
        expect(row.updatedAt.getTime(), `updated_at của ${row.name} bị rebalance chạm vào`).toBe(
          was,
        );
      }
      // Không có gì để so thì phép so ở trên rỗng — và một khẳng định rỗng là
      // đúng thứ mốc này tồn tại để loại bỏ.
      expect(compared).toBeGreaterThan(1);

      // Sau rebalance dãy vẫn tăng nghiêm ngặt và khe đã rộng trở lại.
      const positions = after.map((row) => row.position);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] as bigint).toBeGreaterThan(positions[i - 1] as bigint);
      }
      const gaps = positions.slice(1).map((p, i) => p - (positions[i] as bigint));
      const smallestGap = gaps.reduce((a, b) => (b < a ? b : a));
      // Ngưỡng 10⁻⁶ là 10⁴ đơn vị đã tỉ lệ theo 10¹⁰.
      expect(smallestGap > 10n ** 4n).toBe(true);
    }, 180_000);

    /**
     * `DEFERRABLE` có thật sự cần không?
     *
     * Câu hỏi này chỉ trả lời được bằng cách **thử không defer**. Test dựng ba
     * cột `1024/2048/3072` rồi ghi lại đúng dãy update mà một lần đảo thứ tự
     * sinh ra:
     *
     * - Không defer: lệnh update **đầu tiên** đã trùng với một row khác và
     *   transaction bị từ chối.
     * - Có defer: cùng dãy đó đi qua một trạng thái trung gian có hai row cùng
     *   position — test khẳng định trạng thái đó **tồn tại thật** — rồi commit.
     *
     * Nếu ai đó tạo lại constraint qua Drizzle và mất thuộc tính `DEFERRABLE`,
     * nhánh thứ hai sẽ đỏ.
     */
    it("DEFERRABLE là thứ khiến rebalance ghi được: không defer thì trùng ngay lệnh đầu", async () => {
      const projectId = await newProject("deferrable");

      const a = columnOf(await createColumn(projectId, "A")).id;
      const b = columnOf(await createColumn(projectId, "B")).id;
      const c = columnOf(await createColumn(projectId, "C")).id;

      // Đảo thứ tự: C→1024, B→2048, A→3072.
      const reversal: [string, string][] = [
        [c, formatPosition(parsePosition("1024"))],
        [b, formatPosition(parsePosition("2048"))],
        [a, formatPosition(parsePosition("3072"))],
      ];

      await expect(
        f.db.transaction(async (tx) => {
          for (const [id, position] of reversal) {
            await tx.update(boardColumns).set({ position }).where(eq(boardColumns.id, id));
          }
        }),
      ).rejects.toThrow();

      // Trạng thái không đổi: transaction bị từ chối đã rollback trọn vẹn.
      expect((await rowsOf(projectId)).map((r) => r.name)).toEqual(["A", "B", "C"]);

      await f.db.transaction(async (tx) => {
        await tx.execute(sql`set constraints "board_columns_project_position_uniq" deferred`);

        await tx
          .update(boardColumns)
          .set({ position: formatPosition(parsePosition("1024")) })
          .where(eq(boardColumns.id, reversal[0]?.[0] as string));

        // Đúng chỗ này, hai row của cùng project cùng mang position 1024.
        const [duplicates] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(boardColumns)
          .where(and(eq(boardColumns.projectId, projectId), sql`${boardColumns.position} = 1024`));
        expect(duplicates?.n, "trạng thái trung gian trùng position đã không xảy ra").toBe(2);

        for (const [id, position] of reversal.slice(1)) {
          await tx.update(boardColumns).set({ position }).where(eq(boardColumns.id, id));
        }
      });

      expect((await rowsOf(projectId)).map((r) => r.name)).toEqual(["C", "B", "A"]);
    });
  });

  /* ---------------------------------------------------------------------- *
   * PATCH /columns/:columnId
   * ---------------------------------------------------------------------- */

  describe("PATCH /columns/:columnId", () => {
    async function patch(columnId: string, body: unknown, actor: TestActor = f.wsAdmin) {
      return await call(f, "PATCH", `/columns/${columnId}`, {
        actor,
        idempotencyKey: newKey("patch"),
        body,
      });
    }

    it("rename → 200, ghi board_column.renamed", async () => {
      const projectId = await newProject("rename");
      const columnId = columnOf(await createColumn(projectId, "Tên cũ")).id;

      const response = await patch(columnId, { name: "Tên mới" });

      expect(response.status).toBe(200);
      expect(columnResponseSchema.safeParse(response.body["data"]).success).toBe(true);
      expect(columnOf(response).name).toBe("Tên mới");
      expect(await f.activity.countForProject(projectId, "board_column.renamed")).toBe(1);
    });

    /**
     * Trộn hai command phải là `400`.
     *
     * `updateColumnRequestSchema` là `z.union`, và union chọn **nhánh khớp đầu
     * tiên** — không thể dựa vào nó để khẳng định ý định "đúng một command".
     * Test này khẳng định hành vi, không khẳng định cách hiện thực.
     */
    it("trộn hai command `{ name, archive: true }` → 400, không đổi gì", async () => {
      const projectId = await newProject("mixed");
      const columnId = columnOf(await createColumn(projectId, "Nguyên vẹn")).id;
      const before = await rowsOf(projectId);

      const response = await patch(columnId, { name: "Đổi tên", archive: true });

      expect(response.status).toBe(400);
      expect((response.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
      expect(await rowsOf(projectId)).toEqual(before);
      expect(await f.activity.countForProject(projectId, "board_column.renamed")).toBe(0);
      expect(await f.activity.countForProject(projectId, "board_column.archived")).toBe(0);
    });

    it("mọi tổ hợp trộn và field lạ đều 400", async () => {
      const projectId = await newProject("mixed-more");
      const columnId = columnOf(await createColumn(projectId, "Nguyên vẹn")).id;

      for (const body of [
        { name: "X", isTerminal: true },
        { isTerminal: true, requiresReviewer: true },
        { requiresReviewer: true, archive: true },
        { archive: true, name: "X" },
        { archive: false },
        { position: "2048" },
        {},
        { name: "X", unknownField: 1 },
      ]) {
        const response = await patch(columnId, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });

    it("đổi isTerminal **không hồi tố**: chỉ cờ đó đổi, không position, không archived_at", async () => {
      const projectId = await newProject("terminal");
      const first = columnOf(await createColumn(projectId, "Cần làm")).id;
      const second = columnOf(await createColumn(projectId, "Xong")).id;

      const before = await rowsOf(projectId);
      const beforeById = new Map(before.map((row) => [row.id, row]));

      const response = await patch(second, { isTerminal: true });
      expect(response.status).toBe(200);
      expect(columnOf(response).isTerminal).toBe(true);

      const after = await rowsOf(projectId);
      for (const row of after) {
        const was = beforeById.get(row.id);
        expect(row.position).toBe(was?.position);
        expect(row.archivedAt).toEqual(was?.archivedAt ?? null);
        expect(row.requiresReviewer).toBe(was?.requiresReviewer);
        // Cột không bị nhắm tới thì không đổi gì cả, kể cả `updated_at`.
        if (row.id === first) {
          expect(row.isTerminal).toBe(was?.isTerminal);
          expect(row.updatedAt.getTime()).toBe(was?.updatedAt.getTime());
        }
      }

      // Activity cũ **không** bị viết lại: chỉ có đúng một dòng mới, đúng loại.
      expect(await f.activity.countForProject(projectId, "board_column.terminal_changed")).toBe(1);
      expect(await f.activity.countForProject(projectId, "board_column.renamed")).toBe(0);
      expect(await f.activity.countForProject(projectId, "board_column.created")).toBe(2);
    });

    it("đổi requiresReviewer **không hồi tố**: không cột nào khác bị chạm", async () => {
      const projectId = await newProject("reviewer");
      const a = columnOf(await createColumn(projectId, "A")).id;
      const b = columnOf(await createColumn(projectId, "B")).id;
      const before = await rowsOf(projectId);

      const response = await patch(b, { requiresReviewer: true });
      expect(response.status).toBe(200);
      expect(columnOf(response).requiresReviewer).toBe(true);

      const after = await rowsOf(projectId);
      expect(after.find((row) => row.id === a)).toEqual(before.find((row) => row.id === a));

      expect(
        await f.activity.countForProject(projectId, "board_column.reviewer_requirement_changed"),
      ).toBe(1);
    });

    /**
     * Archive cột còn task → `409 COLUMN_NOT_EMPTY`, và **không task nào bị
     * dời**.
     *
     * Bảng `tasks` thuộc M4, nên phép đếm task thật chưa tồn tại. Thứ kiểm được
     * bây giờ là đường đi: use case hỏi `ColumnEmptinessCheck`, câu trả lời
     * `true` chặn thao tác trước khi ghi, và cột vẫn active.
     */
    it("archive cột còn task → 409 COLUMN_NOT_EMPTY, cột vẫn active", async () => {
      const projectId = await newProject("not-empty");
      const columnId = columnOf(await createColumn(projectId, "Còn việc")).id;
      const before = await rowsOf(projectId);

      f.setColumnHasTasks(true);
      try {
        const response = await patch(columnId, { archive: true });

        expect(response.status).toBe(409);
        expect((response.body["error"] as { code: string }).code).toBe("COLUMN_NOT_EMPTY");
        expect(await rowsOf(projectId)).toEqual(before);
        expect(await f.activity.countForProject(projectId, "board_column.archived")).toBe(0);
      } finally {
        f.setColumnHasTasks(false);
      }

      // Khi cột đã rỗng thì archive được — đối chứng cho nhánh chặn phía trên.
      const after = await patch(columnId, { archive: true });
      expect(after.status).toBe(200);
      expect(columnOf(after).archivedAt).not.toBeNull();
      expect(await f.activity.countForProject(projectId, "board_column.archived")).toBe(1);
    });

    it("cột đã archive biến mất khỏi board và không archive lần hai được", async () => {
      const projectId = await newProject("archived-twice");
      const keep = columnOf(await createColumn(projectId, "Giữ")).id;
      const gone = columnOf(await createColumn(projectId, "Bỏ")).id;

      expect((await patch(gone, { archive: true })).status).toBe(200);
      expect((await boardOf(projectId)).map((c) => c.id)).toEqual([keep]);

      const again = await patch(gone, { archive: true });
      expect(again.status).toBe(400);
      expect(await f.activity.countForProject(projectId, "board_column.archived")).toBe(1);
    });

    /**
     * `:columnId` là **locator, không phải chứng cứ quyền**.
     *
     * User A là Owner của Project A, cùng workspace với Project B. Đoán trúng ID
     * một cột của Project B không cho họ gì cả — và câu trả lời là `404`, không
     * phải `403`, vì `403` đã xác nhận cột đó có thật.
     */
    it("cột của project không đọc được → 404, không phải 403, và không đổi gì", async () => {
      const created = await createColumn(f.projectBId, "Của Project B", {}, f.owner);
      expect(created.status).toBe(201);
      const columnId = columnOf(created).id;
      const before = await rowsOf(f.projectBId);

      // Cả hai actor này đều **không** có dòng `project_members` cho Project B.
      for (const actor of [f.userA, f.wsAdmin]) {
        const response = await patch(columnId, { name: "Chiếm quyền" }, actor);
        expect(response.status, actor.email).toBe(404);
      }

      expect(await rowsOf(f.projectBId)).toEqual(before);
    });

    it("columnId không tồn tại → 404, giống hệt cột không đọc được", async () => {
      const response = await patch("00000000-0000-4000-8000-0000000000aa", { name: "X" });
      expect(response.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------------- *
   * POST /columns/reorder
   * ---------------------------------------------------------------------- */

  describe("POST /columns/reorder", () => {
    async function reorder(
      projectId: string,
      orderedColumnIds: string[],
      actor: TestActor = f.wsAdmin,
    ) {
      return await call(f, "POST", "/columns/reorder", {
        actor,
        idempotencyKey: newKey("reorder"),
        body: { projectId, orderedColumnIds },
      });
    }

    async function threeColumns(label: string): Promise<{ projectId: string; ids: string[] }> {
      const projectId = await newProject(label);
      const ids: string[] = [];
      for (const name of ["A", "B", "C"]) {
        ids.push(columnOf(await createColumn(projectId, name)).id);
      }
      return { projectId, ids };
    }

    /**
     * `200`, không phải `201`.
     *
     * Nest mặc định POST là `201`. Route này khai `@HttpCode(200)`, và đây là
     * chỗ duy nhất phân biệt được một `@HttpCode` đúng với một `@HttpCode` bị
     * quên — đọc code không bắt được.
     */
    it("trả 200 (KHÔNG phải 201) và ghi đúng MỘT activity board_column.reordered", async () => {
      const { projectId, ids } = await threeColumns("reorder-ok");
      const reversed = [...ids].reverse();

      const response = await reorder(projectId, reversed);

      expect(response.status).toBe(200);
      expect(columnsResponseSchema.safeParse(response.body["data"]).success).toBe(true);

      const columns = (response.body["data"] as { columns: ColumnBody[] }).columns;
      expect(columns.map((c) => c.id)).toEqual(reversed);
      // Committed order, đọc lại từ database chứ không phải echo lại body.
      expect((await boardOf(projectId)).map((c) => c.id)).toEqual(reversed);

      // **Một** dòng lịch sử cho một thao tác của người dùng, không phải N dòng.
      expect(await f.activity.countForProject(projectId, "board_column.reordered")).toBe(1);
    });

    it("reorder gán lại bội số 1024 và không đụng cột đã archive", async () => {
      const { projectId, ids } = await threeColumns("reorder-positions");

      const archivedId = ids[2] as string;
      await call(f, "PATCH", `/columns/${archivedId}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("arch"),
        body: { archive: true },
      });
      const archivedBefore = (await rowsOf(projectId)).find((row) => row.id === archivedId);

      const active = [ids[1] as string, ids[0] as string];
      expect((await reorder(projectId, active)).status).toBe(200);

      const byId = new Map((await rowsOf(projectId)).map((row) => [row.id, row]));
      expect(byId.get(active[0] as string)?.position).toBe(parsePosition("1024"));
      expect(byId.get(active[1] as string)?.position).toBe(parsePosition("2048"));
      // Cột archive không nằm trong tập active nên không được chạm.
      expect(byId.get(archivedId)).toEqual(archivedBefore);
    });

    it("danh sách thiếu, thừa, trùng hay có ID project khác đều 400 và không ghi gì", async () => {
      const { projectId, ids } = await threeColumns("reorder-bad");
      const foreign = columnOf(await createColumn(await newProject("reorder-foreign"), "Lạ")).id;
      const before = await rowsOf(projectId);

      const bodies: string[][] = [
        [ids[0] as string, ids[1] as string], // thiếu
        [...ids, foreign], // thừa một ID project khác
        [ids[0] as string, ids[0] as string, ids[1] as string], // trùng
        [ids[0] as string, ids[1] as string, foreign], // đủ số lượng nhưng sai tập
      ];

      for (const orderedColumnIds of bodies) {
        const response = await reorder(projectId, orderedColumnIds);
        expect(response.status, JSON.stringify(orderedColumnIds)).toBe(400);
        // Thông điệp không được liệt kê ID nào thiếu/thừa: với ID của project
        // khác, câu trả lời chi tiết sẽ xác nhận ID đó có thật.
        expect(JSON.stringify(response.body)).not.toContain(foreign);
      }

      expect(await rowsOf(projectId)).toEqual(before);
      expect(await f.activity.countForProject(projectId, "board_column.reordered")).toBe(0);
    });

    it("projectId trong body chỉ là locator: người ngoài project nhận 404", async () => {
      const { projectId, ids } = await threeColumns("reorder-authz");
      const before = await rowsOf(projectId);

      const outside = await reorder(projectId, [...ids].reverse(), f.userA);
      expect(outside.status).toBe(404);

      expect(await rowsOf(projectId)).toEqual(before);
    });

    /**
     * Hai reorder đồng thời.
     *
     * `lockActiveColumns` dùng `FOR UPDATE`, nên hai transaction bị tuần tự hoá:
     * cái thứ hai đọc lại dãy **sau** khi cái thứ nhất commit. Không có khoá,
     * cả hai đọc cùng một ảnh chụp và kết quả cuối có thể không phải thứ tự nào
     * trong hai request — hoặc một unique violation.
     */
    it("hai reorder đồng thời: cả hai thành công, kết quả là một trong hai thứ tự", async () => {
      const { projectId, ids } = await threeColumns("reorder-race");
      const orderOne = [ids[2], ids[1], ids[0]] as string[];
      const orderTwo = [ids[1], ids[0], ids[2]] as string[];

      const [first, second] = await Promise.all([
        reorder(projectId, orderOne),
        reorder(projectId, orderTwo),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);

      const committed = (await boardOf(projectId)).map((c) => c.id);
      expect([orderOne, orderTwo]).toContainEqual(committed);
      // Đúng hai thao tác, đúng hai dòng lịch sử.
      expect(await f.activity.countForProject(projectId, "board_column.reordered")).toBe(2);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Idempotency
   * ---------------------------------------------------------------------- */

  describe("Idempotency-Key", () => {
    it("thiếu key → 400 trên cả ba route", async () => {
      const projectId = await newProject("no-key");
      const columnId = columnOf(await createColumn(projectId, "A")).id;

      const create = await call(f, "POST", `/projects/${projectId}/columns`, {
        actor: f.wsAdmin,
        body: { name: "B", afterColumnId: null },
      });
      const update = await call(f, "PATCH", `/columns/${columnId}`, {
        actor: f.wsAdmin,
        body: { name: "B" },
      });
      const reordered = await call(f, "POST", "/columns/reorder", {
        actor: f.wsAdmin,
        body: { projectId, orderedColumnIds: [columnId] },
      });

      expect([create.status, update.status, reordered.status]).toEqual([400, 400, 400]);
    });

    it("retry cùng key phát lại outcome, không tạo cột thứ hai", async () => {
      const projectId = await newProject("replay");
      const key = newKey("replay");
      const body = { name: "Chỉ một lần", afterColumnId: null };

      const first = await call(f, "POST", `/projects/${projectId}/columns`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });
      const second = await call(f, "POST", `/projects/${projectId}/columns`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });

      expect(first.status).toBe(201);
      // Status phát lại lấy từ outcome đã lưu, không từ `@HttpCode` của route.
      expect(second.status).toBe(201);
      expect(columnOf(second).id).toBe(columnOf(first).id);
      expect(await rowsOf(projectId)).toHaveLength(1);
      expect(await f.activity.countForProject(projectId, "board_column.created")).toBe(1);
    });

    it("business failure được phát lại y nguyên: 409 vẫn là 409", async () => {
      const projectId = await newProject("replay-fail");
      const columnId = columnOf(await createColumn(projectId, "Còn việc")).id;
      const key = newKey("replay-409");

      f.setColumnHasTasks(true);
      try {
        const first = await call(f, "PATCH", `/columns/${columnId}`, {
          actor: f.wsAdmin,
          idempotencyKey: key,
          body: { archive: true },
        });
        expect(first.status).toBe(409);
      } finally {
        f.setColumnHasTasks(false);
      }

      // Cột nay đã "rỗng", nhưng retry cùng key phải phát lại kết luận cũ chứ
      // không chạy lại mutation và cho một kết quả khác.
      const replay = await call(f, "PATCH", `/columns/${columnId}`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body: { archive: true },
      });
      expect(replay.status).toBe(409);
      expect((replay.body["error"] as { code: string }).code).toBe("COLUMN_NOT_EMPTY");
      expect((await rowsOf(projectId))[0]?.archivedAt).toBeNull();
    });
  });
});
