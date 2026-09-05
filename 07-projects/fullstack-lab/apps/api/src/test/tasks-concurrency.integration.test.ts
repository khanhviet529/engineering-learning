import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../shared/database/client.ts";
import { activityLogs, tasks as tasksTable } from "../shared/database/schema.ts";
import { formatPosition, parsePosition } from "../shared/ordering/position.ts";
import { TaskRepository } from "../modules/tasks/infrastructure/task-repository.ts";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Bốn thí nghiệm hỏng của M4 — `docs/implementation-plan.md`, mục M4.
 *
 * Plan yêu cầu **bốn**, không phải một, và mỗi cái phải quan sát được một điều
 * cụ thể chứ không phải "chạy không lỗi":
 *
 * | Thí nghiệm | Phải thấy |
 * |---|---|
 * | Hai mutation đồng thời cùng `expectedVersion` | Request sau `409` kèm `currentVersion`; **không** task và **không** activity nào ghi cho request thua |
 * | Chèn N task cùng một khe vượt ngưỡng rebalance | Rebalance trong cùng transaction; thứ tự giữ nguyên; **không unique violation ở mọi N** |
 * | Kill process giữa transaction | Không partial write; activity chỉ tồn tại cùng transaction đã commit |
 * | Đổi filter rồi tái dùng cursor cũ | `400 VALIDATION_FAILED` |
 *
 * Bài học của M3 áp thẳng vào đây: **`Promise.all` có thể xanh trong khi lỗ hổng
 * còn nguyên.** Hai request hiếm khi chồng nhau đúng chỗ, nên thí nghiệm thứ
 * nhất xếp hai transaction bằng tay và **quan sát** trạng thái chặn qua
 * `pg_stat_activity` thay vì chờ một khoảng thời gian đoán trước.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface TaskBody {
  id: string;
  columnId: string;
  position: string;
  version: number;
  title: string;
}

describeIfDb("thí nghiệm hỏng — M4", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  async function newProject(label: string): Promise<string> {
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey(label),
      body: { name: `${label} ${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(created.status).toBe(201);
    return (created.body["data"] as { project: { id: string } }).project.id;
  }

  async function newColumn(projectId: string, name: string): Promise<string> {
    const response = await call(f, "POST", `/projects/${projectId}/columns`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("col"),
      body: { name, afterColumnId: null },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { column: { id: string } }).column.id;
  }

  async function createTask(projectId: string, title: string, columnId: string) {
    const response = await call(f, "POST", `/projects/${projectId}/tasks`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("task"),
      body: { title, columnId, description: null },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { task: TaskBody }).task;
  }

  async function rowsOf(projectId: string, columnId?: string) {
    const rows = await f.db
      .select({
        id: tasksTable.id,
        columnId: tasksTable.columnId,
        title: tasksTable.title,
        position: tasksTable.position,
        version: tasksTable.version,
        updatedAt: tasksTable.updatedAt,
      })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))
      .orderBy(tasksTable.position);

    return rows
      .filter((row) => columnId === undefined || row.columnId === columnId)
      .map((row) => ({ ...row, position: parsePosition(row.position) }));
  }

  /* ---------------------------------------------------------------------- *
   * 1 · Hai mutation đồng thời cùng `expectedVersion`
   * ---------------------------------------------------------------------- */

  describe("1 · hai mutation đồng thời cùng expectedVersion", () => {
    /**
     * `Promise.all` một mình **không** chứng minh được gì, và test này bắt đầu
     * bằng cách nói ra điều đó: nó chạy hai `PATCH` song song, khẳng định đúng
     * một cái thắng, rồi thí nghiệm thật ở test kế tiếp mới dựng cửa sổ race.
     */
    it("Promise.all: đúng một request thắng, cái thua nhận 409 kèm currentVersion", async () => {
      const projectId = await newProject("race-patch");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = await createTask(projectId, "Ban đầu", columnId);

      const patch = async (title: string) =>
        await call(f, "PATCH", `/tasks/${task.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("race"),
          body: { title, expectedVersion: 1 },
        });

      const [a, b] = await Promise.all([patch("Người một"), patch("Người hai")]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);

      const loser = a.status === 409 ? a : b;
      const error = loser.body["error"] as {
        code: string;
        details: { currentVersion: number };
      };
      expect(error.code).toBe("TASK_VERSION_CONFLICT");
      expect(error.details).toEqual({ currentVersion: 2 });

      // Đúng một lần ghi: version 2, và **một** dòng `task.updated`.
      const [row] = await rowsOf(projectId);
      expect(row?.version).toBe(2);
      expect(await f.activity.countForProject(projectId, "task.updated")).toBe(1);
    });

    /**
     * Cửa sổ race dựng bằng tay.
     *
     * Hai transaction được xếp thứ tự tường minh và điều kiện "t2 đã chặn" được
     * **quan sát** qua `pg_stat_activity`, không phải chờ một khoảng thời gian
     * đoán trước. Đây là cách M3 đã dùng sau khi phát hiện `Promise.all` xanh
     * trên một lỗ hổng còn nguyên.
     *
     * Điều phải thấy: t2 phát `UPDATE ... WHERE version = 1` **trước** khi t1
     * commit, bị chặn ở row lock, và khi hết chặn nó cập nhật **0 hàng** — vì
     * điều kiện version nằm trong chính câu `UPDATE`, nên nó được đánh giá lại
     * trên hàng đã đổi. Nếu điều kiện nằm ở một lần đọc trước đó thì t2 đã ghi
     * đè âm thầm.
     */
    it("xếp tay: điều kiện version nằm TRONG câu UPDATE nên ghi đè âm thầm là bất khả", async () => {
      const projectId = await newProject("race-manual");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = await createTask(projectId, "Ban đầu", columnId);

      // Ba kết nối: hai transaction và một người quan sát.
      const race = createDatabase(url as string, { max: 3 });

      async function waitUntilBlocked(): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt++) {
          const [row] = await race.db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
                where wait_event_type = 'Lock' and query like '%update "tasks"%'`,
          );
          if ((row?.n ?? 0) > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("không thấy UPDATE nào bị chặn");
      }

      try {
        let releaseFirst = (): void => {};
        const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
        let firstWrote = (): void => {};
        const firstHasWritten = new Promise<void>((resolve) => (firstWrote = resolve));
        let secondRowCount = -1;

        const first = race.db.transaction(async (tx) => {
          await tx
            .update(tasksTable)
            .set({ title: "t1 ghi", version: sql`${tasksTable.version} + 1` })
            .where(eq(tasksTable.id, task.id));
          firstWrote();
          await firstMayCommit;
        });

        await firstHasWritten;

        const second = race.db.transaction(async (tx) => {
          const rows = await tx
            .update(tasksTable)
            .set({ title: "t2 ghi", version: sql`${tasksTable.version} + 1` })
            // Cùng điều kiện mà repository dùng: version nằm **trong** câu ghi.
            .where(sql`${tasksTable.id} = ${task.id} and ${tasksTable.version} = 1`)
            .returning({ id: tasksTable.id });
          secondRowCount = rows.length;
        });

        await waitUntilBlocked();
        releaseFirst();
        await Promise.all([first, second]);

        // t2 chạm **0 hàng**: điều kiện version được đánh giá lại sau khi t1
        // commit, đúng chỗ mà một phép đọc-rồi-ghi sẽ bỏ lỡ.
        expect(secondRowCount).toBe(0);

        const [row] = await rowsOf(projectId);
        expect(row?.title).toBe("t1 ghi");
        expect(row?.version).toBe(2);
      } finally {
        await race.close();
      }
    }, 60_000);

    it("request thua không để lại task nào và không để lại activity nào", async () => {
      const projectId = await newProject("race-noeffect");
      const columnId = await newColumn(projectId, "Cần làm");
      const to = await newColumn(projectId, "Đã xong");
      const task = await createTask(projectId, "Việc", columnId);

      const activityBefore = await f.activity.countForProject(projectId);
      const rowsBefore = await rowsOf(projectId);

      const move = async () =>
        await call(f, "POST", `/tasks/${task.id}/move`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("race-move"),
          body: {
            destinationColumnId: to,
            targetPosition: "1024.0000000000",
            expectedVersion: 1,
          },
        });

      const [a, b] = await Promise.all([move(), move()]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);

      // Đúng **một** dòng lịch sử cho một lần di chuyển thành công.
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(1);
      expect(await f.activity.countForProject(projectId)).toBe(activityBefore + 1);
      // Và đúng một task, không có bản sao nào của request thua.
      expect(await rowsOf(projectId)).toHaveLength(rowsBefore.length);
    });
  });

  /* ---------------------------------------------------------------------- *
   * 2 · Chèn N task vượt ngưỡng rebalance
   * ---------------------------------------------------------------------- */

  describe("2 · chèn liên tiếp cùng một khe, vượt xa ngưỡng rebalance", () => {
    /**
     * Đây là thí nghiệm mà ADR-0006 đặt tên: *"chèn N task liên tiếp vào cùng
     * một khe vượt ngưỡng — rebalance chạy trong transaction, thứ tự giữ nguyên,
     * **không có unique violation ở mọi mức N**"*.
     *
     * `N = 120` cố ý vượt xa hai mốc quan trọng: ~30 lần chia đôi để chạm ngưỡng
     * 10⁻⁶, và ~43 lần để **cạn precision** của `numeric(20,10)`. Nếu rebalance
     * không chạy, lần chèn thứ ~44 sẽ tính ra một midpoint trùng neighbor và
     * unique constraint nổ; nếu nó chạy nhưng sai, thứ tự sẽ lệch.
     *
     * Mỗi lần chèn đi qua **HTTP thật**: không mock, không gọi thẳng `planMove`.
     */
    it("120 lần move vào cùng một khe: không unique violation, thứ tự giữ nguyên", async () => {
      const projectId = await newProject("rebalance");
      const columnId = await newColumn(projectId, "Cần làm");

      const anchor = await createTask(projectId, "Mốc", columnId);
      const right = await createTask(projectId, "Neighbor phải", columnId);

      let rebalanceRuns = 0;
      const inserted: string[] = [];

      for (let i = 0; i < 120; i++) {
        const task = await createTask(projectId, `Chen ${String(i)}`, columnId);

        // Thả vào đúng khe giữa `anchor` và neighbor phải của nó: `targetPosition`
        // là position hiện tại của item ngay sau `anchor`.
        const board = await rowsOf(projectId, columnId);
        const anchorIndex = board.findIndex((row) => row.id === anchor.id);
        const target = board[anchorIndex + 1];
        expect(target).toBeDefined();

        const moved = await call(f, "POST", `/tasks/${task.id}/move`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("move"),
          body: {
            destinationColumnId: columnId,
            targetPosition: formatPosition((target as { position: bigint }).position),
            expectedVersion: task.version,
          },
        });

        expect(moved.status, `lần chèn thứ ${String(i)}`).toBe(200);
        inserted.push(task.id);

        const recent = await f.activity.recentForProject(projectId, 1);
        const payload = recent[0]?.payload as { rebalanced?: number } | undefined;
        if ((payload?.rebalanced ?? 0) > 0) rebalanceRuns += 1;
      }

      // Rebalance **thật sự đã chạy** — không phải một nhánh chưa bao giờ tới.
      expect(rebalanceRuns).toBeGreaterThan(0);

      const board = await rowsOf(projectId, columnId);
      expect(board).toHaveLength(122);

      // Thứ tự: `anchor` đầu, `right` cuối, và các lần chèn xếp ngược thứ tự
      // chèn ở giữa — mỗi cái mới đứng ngay sau `anchor`.
      expect(board[0]?.id).toBe(anchor.id);
      expect(board.at(-1)?.id).toBe(right.id);
      expect(board.slice(1, -1).map((row) => row.id)).toEqual([...inserted].reverse());

      // Position tăng nghiêm ngặt và **duy nhất** — không có hai hàng trùng.
      const positions = board.map((row) => row.position);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] as bigint).toBeGreaterThan(positions[i - 1] as bigint);
      }
      expect(new Set(positions.map((p) => p.toString())).size).toBe(positions.length);
    }, 300_000);

    /**
     * Rebalance **chỉ ghi `position`** — ADR-0006 mục 5.
     *
     * Không tăng `version`: tăng cho N row tạo ra một loạt `409` **giả** cho mọi
     * client đang mở các task đó. Không chạm `updated_at`: chạm sẽ xáo seek
     * pagination theo `updated_at DESC` và làm người đang cuộn thấy row trùng
     * hoặc mất row.
     */
    it("rebalance không tăng version và không chạm updated_at của hàng bị ghi lại", async () => {
      const projectId = await newProject("rebalance-side");
      const columnId = await newColumn(projectId, "Cần làm");

      const anchor = await createTask(projectId, "Mốc", columnId);
      await createTask(projectId, "Neighbor phải", columnId);

      let before: Map<string, { version: number; updatedAt: number }> | undefined;
      let rebalanced = false;

      for (let i = 0; i < 80 && !rebalanced; i++) {
        const snapshot = new Map(
          (await rowsOf(projectId, columnId)).map((row) => [
            row.id,
            { version: row.version, updatedAt: row.updatedAt.getTime() },
          ]),
        );

        const task = await createTask(projectId, `Chen ${String(i)}`, columnId);
        const board = await rowsOf(projectId, columnId);
        const anchorIndex = board.findIndex((row) => row.id === anchor.id);
        const target = board[anchorIndex + 1] as { position: bigint };

        const moved = await call(f, "POST", `/tasks/${task.id}/move`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("move"),
          body: {
            destinationColumnId: columnId,
            targetPosition: formatPosition(target.position),
            expectedVersion: task.version,
          },
        });
        expect(moved.status).toBe(200);

        const recent = await f.activity.recentForProject(projectId, 1);
        const payload = recent[0]?.payload as { rebalanced?: number } | undefined;
        if ((payload?.rebalanced ?? 0) > 0) {
          rebalanced = true;
          before = snapshot;
        }
      }

      expect(rebalanced, "rebalance chưa bao giờ chạy — ngưỡng hoặc spacing đã đổi").toBe(true);

      const after = await rowsOf(projectId, columnId);
      const movedId = after.find((row) => !(before as Map<string, unknown>).has(row.id))?.id;

      let compared = 0;
      for (const row of after) {
        const was = (before as Map<string, { version: number; updatedAt: number }>).get(row.id);
        if (was === undefined) continue;
        // Task **được move** thì tăng version như hợp đồng; các hàng khác thì không.
        if (row.id === movedId) continue;
        compared += 1;
        expect(row.version, `version của ${row.title} bị rebalance chạm vào`).toBe(was.version);
        expect(row.updatedAt.getTime(), `updated_at của ${row.title} bị rebalance chạm vào`).toBe(
          was.updatedAt,
        );
      }

      // Một phép so rỗng luôn đúng — đó là đúng thứ mốc này tồn tại để loại bỏ.
      expect(compared).toBeGreaterThan(1);
    }, 300_000);

    /**
     * `DEFERRABLE` có thật sự cần không? Thử **không** defer.
     *
     * Nếu ai đó tạo lại constraint qua Drizzle và mất thuộc tính `DEFERRABLE`,
     * nhánh thứ hai của test này đỏ.
     */
    it("DEFERRABLE là thứ khiến rebalance ghi được", async () => {
      const projectId = await newProject("deferrable");
      const columnId = await newColumn(projectId, "Cần làm");

      const a = await createTask(projectId, "A", columnId);
      const b = await createTask(projectId, "B", columnId);
      const c = await createTask(projectId, "C", columnId);

      const reversal: [string, string][] = [
        [c.id, formatPosition(parsePosition("1024"))],
        [b.id, formatPosition(parsePosition("2048"))],
        [a.id, formatPosition(parsePosition("3072"))],
      ];

      // Không defer: lệnh đầu đã trùng với một row khác.
      await expect(
        f.db.transaction(async (tx) => {
          for (const [id, position] of reversal) {
            await tx.update(tasksTable).set({ position }).where(eq(tasksTable.id, id));
          }
        }),
      ).rejects.toThrow();

      expect((await rowsOf(projectId, columnId)).map((r) => r.title)).toEqual(["A", "B", "C"]);

      // Có defer: cùng dãy đó đi qua một trạng thái trung gian **trùng thật** rồi commit.
      await f.db.transaction(async (tx) => {
        await tx.execute(sql`set constraints "tasks_project_column_position_uniq" deferred`);

        await tx
          .update(tasksTable)
          .set({ position: reversal[0]?.[1] as string })
          .where(eq(tasksTable.id, reversal[0]?.[0] as string));

        const [duplicates] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(tasksTable)
          .where(sql`${tasksTable.columnId} = ${columnId} and ${tasksTable.position} = 1024`);
        expect(duplicates?.n, "trạng thái trung gian trùng position đã không xảy ra").toBe(2);

        for (const [id, position] of reversal.slice(1)) {
          await tx.update(tasksTable).set({ position }).where(eq(tasksTable.id, id));
        }
      });

      expect((await rowsOf(projectId, columnId)).map((r) => r.title)).toEqual(["C", "B", "A"]);
    });

    /**
     * `FOR UPDATE` một mình để lọt race **thêm** task — bài học M3, quy mô M4.
     *
     * Advisory lock khoá theo **column**, không theo project: khoá theo project
     * sẽ tuần tự hoá toàn bộ board và giết throughput của chính tính năng chính.
     */
    it("advisory lock theo column bịt được race thêm task, và chỉ khoá đúng column đó", async () => {
      const projectId = await newProject("create-race");
      const columnA = await newColumn(projectId, "A");
      const columnB = await newColumn(projectId, "B");
      await createTask(projectId, "Nền A", columnA);

      const race = createDatabase(url as string, { max: 3 });
      const repository = new TaskRepository(race.db);

      async function waitUntilBlocked(pattern: string): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt++) {
          const [row] = await race.db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
                where wait_event_type = 'Lock' and query like ${pattern}`,
          );
          if ((row?.n ?? 0) > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`không thấy câu lệnh nào bị chặn khớp ${pattern}`);
      }

      try {
        let releaseFirst = (): void => {};
        const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
        let firstLocked = (): void => {};
        const firstHasLock = new Promise<void>((resolve) => (firstLocked = resolve));

        let secondSaw = -1;
        let otherColumnBlocked = true;

        const first = race.db.transaction(async (tx) => {
          await repository.lockColumnOrdering(columnA, tx);
          await repository.lockColumnTasks(projectId, columnA, tx);
          firstLocked();
          await firstMayCommit;
        });

        await firstHasLock;

        // Column **khác** không bị chặn: khoá hẹp đúng phạm vi của nó.
        await race.db.transaction(async (tx) => {
          await repository.lockColumnOrdering(columnB, tx);
          otherColumnBlocked = false;
        });
        expect(otherColumnBlocked, "khoá column A đã chặn nhầm column B").toBe(false);

        const second = race.db.transaction(async (tx) => {
          await repository.lockColumnOrdering(columnA, tx);
          secondSaw = (await repository.lockColumnTasks(projectId, columnA, tx)).length;
        });

        await waitUntilBlocked("%pg_advisory_xact_lock%");
        releaseFirst();
        await Promise.all([first, second]);

        // t2 chặn **trước** câu SELECT, nên khi chạy nó là một câu lệnh mới với
        // snapshot mới và thấy đủ dữ liệu đã commit.
        expect(secondSaw).toBe(1);
      } finally {
        await race.close();
      }
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- *
   * 3 · "Kill process" giữa transaction
   * ---------------------------------------------------------------------- */

  describe("3 · mất tiến trình giữa một transaction", () => {
    /**
     * Không `process.kill` thật, và lý do đáng nói ra: giết tiến trình chạy test
     * sẽ giết **cả bộ test**, nên nó không phải một thí nghiệm chạy lại được.
     * Thứ tương đương và quan sát được là cắt **kết nối** đang giữ transaction
     * dở — từ phía database, bằng `pg_terminate_backend`.
     *
     * Với PostgreSQL đó là **cùng một sự kiện**: một client biến mất giữa chừng.
     * Server không có cơ hội `COMMIT`, nên transaction bị abort và mọi thứ trong
     * nó biến mất cùng nhau — task, và dòng activity kể về nó.
     */
    it("kết nối chết giữa transaction: không partial write, không activity mồ côi", async () => {
      const projectId = await newProject("kill");
      const columnId = await newColumn(projectId, "Cần làm");
      await createTask(projectId, "Có sẵn", columnId);

      const rowsBefore = await rowsOf(projectId);
      const activityBefore = await f.activity.countForProject(projectId);

      const victim = createDatabase(url as string, { max: 1 });
      const executioner = createDatabase(url as string, { max: 1 });

      const doomedTitle = `Không bao giờ commit ${crypto.randomUUID().slice(0, 8)}`;

      try {
        let inserted = (): void => {};
        const hasInserted = new Promise<void>((resolve) => (inserted = resolve));
        let pid = 0;

        const doomed = victim.db
          .transaction(async (tx) => {
            const [row] = await tx.execute<{ pid: number }>(
              sql`select pg_backend_pid()::int as pid`,
            );
            pid = (row as { pid: number }).pid;

            const [task] = await tx
              .insert(tasksTable)
              .values({
                projectId,
                columnId,
                createdByUserId: f.wsAdmin.id,
                title: doomedTitle,
                description: "",
                priority: "none",
                position: formatPosition(parsePosition("9999")),
              })
              .returning({ id: tasksTable.id });

            // Activity **trong cùng transaction** — đúng như mọi use case làm.
            await tx.insert(activityLogs).values({
              projectId,
              taskId: (task as { id: string }).id,
              actorUserId: f.wsAdmin.id,
              action: "task.created",
              payload: { taskId: (task as { id: string }).id, title: doomedTitle },
            });

            inserted();
            // Chờ bị giết. Nếu không ai giết, timeout của test sẽ báo.
            await new Promise((resolve) => setTimeout(resolve, 30_000));
          })
          .catch((error: unknown) => error);

        await hasInserted;
        expect(pid).toBeGreaterThan(0);

        // Cắt kết nối đúng lúc transaction đang dở.
        await executioner.db.execute(sql`select pg_terminate_backend(${pid})`);

        const outcome = await doomed;
        expect(outcome, "transaction bị cắt phải thất bại, không được im lặng").toBeInstanceOf(
          Error,
        );
      } finally {
        await victim.close().catch(() => undefined);
        await executioner.close();
      }

      // Không có gì sống sót: không task, và **không** dòng activity mồ côi.
      const rowsAfter = await rowsOf(projectId);
      expect(rowsAfter).toHaveLength(rowsBefore.length);
      expect(rowsAfter.some((row) => row.title === doomedTitle)).toBe(false);
      expect(await f.activity.countForProject(projectId)).toBe(activityBefore);

      // Và hệ thống vẫn dùng được ngay sau đó — không kẹt khoá, không hỏng pool.
      const after = await createTask(projectId, "Sau khi chạy lại", columnId);
      expect(after.id).toBeTruthy();
    }, 120_000);
  });

  /* ---------------------------------------------------------------------- *
   * 4 · Đổi filter rồi tái dùng cursor cũ
   * ---------------------------------------------------------------------- */

  describe("4 · đổi filter rồi tái dùng cursor cũ", () => {
    it("mọi chiều của filter đổi đều làm cursor cũ chết bằng 400", async () => {
      const projectId = await newProject("cursor-death");
      const columnA = await newColumn(projectId, "A");
      const columnB = await newColumn(projectId, "B");

      for (let i = 0; i < 4; i++) {
        await call(f, "POST", `/projects/${projectId}/tasks`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("task"),
          body: {
            title: `Việc ${String(i)}`,
            columnId: i % 2 === 0 ? columnA : columnB,
            description: null,
            priority: i % 2 === 0 ? "high" : "low",
            category: i % 2 === 0 ? "bug" : "feature",
            dueDate: `2026-09-1${String(i)}`,
          },
        });
      }

      const base = `?columnId=${columnA}&priority=high&limit=1`;
      const first = await call(f, "GET", `/projects/${projectId}/tasks${base}`, {
        actor: f.wsAdmin,
      });
      expect(first.status).toBe(200);
      const cursor = (first.body["data"] as { page: { nextCursor: string | null } }).page
        .nextCursor;
      expect(cursor, "cần một cursor để thí nghiệm").toBeTruthy();

      const encoded = encodeURIComponent(cursor as string);

      /**
       * Mỗi dòng dưới đây đổi **đúng một** chiều của truy vấn.
       *
       * Fingerprint bind toàn bộ filter canonical, nên bỏ sót một chiều nghĩa là
       * cursor dùng lại được xuyên chiều đó — và người dùng nhận một trang lẫn
       * lộn mà không ai báo lỗi.
       */
      const changed: [string, string][] = [
        ["đổi column", `?columnId=${columnB}&priority=high&limit=1&cursor=${encoded}`],
        ["đổi priority", `?columnId=${columnA}&priority=low&limit=1&cursor=${encoded}`],
        ["bỏ filter priority", `?columnId=${columnA}&limit=1&cursor=${encoded}`],
        [
          "thêm filter category",
          `?columnId=${columnA}&priority=high&category=bug&limit=1&cursor=${encoded}`,
        ],
        [
          "đổi sort",
          `?columnId=${columnA}&priority=high&sort=dueDate:asc&limit=1&cursor=${encoded}`,
        ],
        ["thêm search", `?columnId=${columnA}&priority=high&search=viec&limit=1&cursor=${encoded}`],
      ];

      for (const [label, query] of changed) {
        const response = await call(f, "GET", `/projects/${projectId}/tasks${query}`, {
          actor: f.wsAdmin,
        });
        expect(response.status, label).toBe(400);
        expect((response.body["error"] as { code: string }).code, label).toBe("VALIDATION_FAILED");
      }

      // Và **cùng** filter thì cursor vẫn dùng được — nếu không, test trên chỉ
      // chứng minh rằng mọi cursor đều chết.
      const same = await call(f, "GET", `/projects/${projectId}/tasks${base}&cursor=${encoded}`, {
        actor: f.wsAdmin,
      });
      expect(same.status).toBe(200);
    });

    it("cursor bị sửa một ký tự cũng chết — chữ ký HMAC, không chỉ opaque", async () => {
      const projectId = await newProject("cursor-tamper");
      const columnId = await newColumn(projectId, "A");
      await createTask(projectId, "Một", columnId);
      await createTask(projectId, "Hai", columnId);

      const first = await call(f, "GET", `/projects/${projectId}/tasks?limit=1`, {
        actor: f.wsAdmin,
      });
      const cursor = (first.body["data"] as { page: { nextCursor: string } }).page.nextCursor;

      const tampered = `${cursor.slice(0, -2)}${cursor.at(-1) === "A" ? "B" : "A"}`;
      const response = await call(
        f,
        "GET",
        `/projects/${projectId}/tasks?limit=1&cursor=${encodeURIComponent(tampered)}`,
        { actor: f.wsAdmin },
      );

      expect(response.status).toBe(400);
    });
  });
});
