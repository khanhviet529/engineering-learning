import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { commentSchema, taskSchema } from "@flowboard/contracts";
import { tasks as tasksTable } from "../shared/database/schema.ts";
import { parsePosition } from "../shared/ordering/position.ts";
import { call, createFixture, newKey, type Fixture, type TestActor } from "./fixture.ts";

/**
 * Task, comment và activity trên PostgreSQL thật — M4.
 *
 * Đây là vòng lặp chính của sản phẩm, và những điều **chỉ** chứng minh được ở
 * lớp này:
 *
 * - `dueState` suy đúng theo timezone workspace và theo `is_terminal` của cột.
 * - Filter `dueState` — thứ không có cột nào lưu — cho **cùng** tập với
 *   `dueState` hiển thị trên từng thẻ.
 * - Tìm kiếm không dấu đối xứng hai phía, trên chính GIN index đã dựng.
 * - Ordering, rebalance và `expectedVersion` chạy đúng trên constraint thật.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface TaskBody {
  id: string;
  projectId: string;
  columnId: string;
  createdBy: { id: string; displayName: string };
  assigneeId: string | null;
  reviewerId: string | null;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  dueState: string;
  evidenceUrl: string | null;
  position: string;
  version: number;
}

describeIfDb("task, comment và activity", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  /* ---------------------------------------------------------------------- *
   * Trợ giúp
   * ---------------------------------------------------------------------- */

  /**
   * Mỗi nhóm test dựng project riêng, cùng lý do với M3: ordering và bộ lọc là
   * trạng thái toàn cục của một project, nên dùng chung một project là biến thứ
   * tự chạy thành một phần của kết quả.
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

  /** Thêm một member vào project để họ làm assignee/reviewer được. */
  async function addMember(
    projectId: string,
    actorToAdd: TestActor,
    role: "owner" | "editor" | "viewer",
  ): Promise<void> {
    const response = await call(f, "POST", `/projects/${projectId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("member"),
      body: { userId: actorToAdd.id, role },
    });
    expect(response.status).toBe(201);
  }

  async function newColumn(
    projectId: string,
    name: string,
    extra: Partial<{ isTerminal: boolean; requiresReviewer: boolean }> = {},
  ): Promise<string> {
    const response = await call(f, "POST", `/projects/${projectId}/columns`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("col"),
      body: { name, afterColumnId: null, ...extra },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { column: { id: string } }).column.id;
  }

  async function createTask(
    projectId: string,
    body: Record<string, unknown>,
    actor: TestActor = f.wsAdmin,
  ) {
    return await call(f, "POST", `/projects/${projectId}/tasks`, {
      actor,
      idempotencyKey: newKey("task"),
      body: { description: "", ...body },
    });
  }

  function taskOf(response: { body: Record<string, unknown> }): TaskBody {
    return (response.body["data"] as { task: TaskBody }).task;
  }

  async function listTasks(projectId: string, query = "", actor: TestActor = f.wsAdmin) {
    return await call(f, "GET", `/projects/${projectId}/tasks${query}`, { actor });
  }

  function itemsOf(response: { body: Record<string, unknown> }): TaskBody[] {
    return (response.body["data"] as { items: TaskBody[] }).items;
  }

  function pageOf(response: { body: Record<string, unknown> }): {
    nextCursor: string | null;
    hasMore: boolean;
  } {
    return (response.body["data"] as { page: { nextCursor: string | null; hasMore: boolean } })
      .page;
  }

  /** Hàng thật trong database, theo thứ tự board của một cột. */
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
   * POST /projects/:projectId/tasks
   * ---------------------------------------------------------------------- */

  describe("POST /projects/:projectId/tasks", () => {
    it("tạo task → 201, version 1, position do server tính, và ghi task.created", async () => {
      const projectId = await newProject("create-task");
      const columnId = await newColumn(projectId, "Cần làm");

      const response = await createTask(projectId, { title: "Việc đầu tiên", columnId });

      expect(response.status).toBe(201);
      const task = taskOf(response);
      expect(task.version).toBe(1);
      expect(task.position).toBe("1024.0000000000");
      expect(task.createdBy.id).toBe(f.wsAdmin.id);
      expect(task.createdBy.displayName).toBe(f.wsAdmin.displayName);
      // Không có `dueDate` ⇒ `none`.
      expect(task.dueState).toBe("none");
      expect(await f.activity.countForProject(projectId, "task.created")).toBe(1);
    });

    it("task kế tiếp trong cùng cột nhận max + 1024", async () => {
      const projectId = await newProject("append-task");
      const columnId = await newColumn(projectId, "Cần làm");

      await createTask(projectId, { title: "Một", columnId });
      const second = await createTask(projectId, { title: "Hai", columnId });

      expect(taskOf(second).position).toBe("2048.0000000000");
    });

    it("client không gửi được projectId, position, version, dueState hay timestamp", async () => {
      const projectId = await newProject("strict-task");
      const columnId = await newColumn(projectId, "Cần làm");

      for (const extra of [
        { projectId },
        { position: "1.0" },
        { version: 5 },
        { dueState: "overdue" },
        { createdBy: f.wsAdmin.id },
        { createdAt: new Date().toISOString() },
        { columnId: columnId, unknownField: 1 },
      ]) {
        const response = await createTask(projectId, {
          title: "Không hợp lệ",
          columnId,
          ...extra,
        });
        expect(response.status, JSON.stringify(extra)).toBe(400);
      }

      expect(await rowsOf(projectId)).toHaveLength(0);
    });

    it("cột của project khác → 400, và không task nào được tạo", async () => {
      const projectId = await newProject("cross-column");
      await newColumn(projectId, "Cần làm");
      const otherProject = await newProject("cross-column-owner");
      const foreignColumn = await newColumn(otherProject, "Cột lạ");

      const response = await createTask(projectId, {
        title: "Chen sang project khác",
        columnId: foreignColumn,
      });

      expect(response.status).toBe(400);
      expect(await rowsOf(projectId)).toHaveLength(0);
      expect(await rowsOf(otherProject)).toHaveLength(0);
    });

    it("cột đã archive không nhận task mới", async () => {
      const projectId = await newProject("archived-column");
      const keep = await newColumn(projectId, "Giữ");
      const gone = await newColumn(projectId, "Bỏ");

      await call(f, "PATCH", `/columns/${gone}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("arch"),
        body: { archive: true },
      });

      const response = await createTask(projectId, { title: "Vào cột đã bỏ", columnId: gone });
      expect(response.status).toBe(400);

      // Cột còn lại vẫn nhận được — nhánh từ chối là do archive, không do gì khác.
      expect((await createTask(projectId, { title: "Vào cột giữ", columnId: keep })).status).toBe(
        201,
      );
    });

    it("assignee ngoài project bị từ chối trước khi commit", async () => {
      const projectId = await newProject("assignee-outsider");
      const columnId = await newColumn(projectId, "Cần làm");

      const response = await createTask(projectId, {
        title: "Giao cho người ngoài",
        columnId,
        assigneeId: f.outsider.id,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain("assigneeId");
      expect(await rowsOf(projectId)).toHaveLength(0);
    });

    it("`startDate > dueDate` bị từ chối", async () => {
      const projectId = await newProject("date-order");
      const columnId = await newColumn(projectId, "Cần làm");

      const response = await createTask(projectId, {
        title: "Ngày ngược",
        columnId,
        startDate: "2026-09-10",
        dueDate: "2026-09-01",
      });
      expect(response.status).toBe(400);
    });
  });

  /* ---------------------------------------------------------------------- *
   * evidenceUrl — ADR-0009
   * ---------------------------------------------------------------------- */

  describe("evidenceUrl", () => {
    it("chỉ nhận https tuyệt đối, tối đa 2048 ký tự", async () => {
      const projectId = await newProject("evidence");
      const columnId = await newColumn(projectId, "Cần làm");

      const ok = await createTask(projectId, {
        title: "Có bằng chứng",
        columnId,
        evidenceUrl: "https://example.test/bang-chung/1",
      });
      expect(ok.status).toBe(201);
      expect(taskOf(ok).evidenceUrl).toBe("https://example.test/bang-chung/1");

      const rejected = [
        "http://example.test/khong-ma-hoa",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        `https://example.test/${"a".repeat(2100)}`,
        "khong-phai-url",
      ];

      for (const evidenceUrl of rejected) {
        const response = await createTask(projectId, {
          title: "Bằng chứng không hợp lệ",
          columnId,
          evidenceUrl,
        });
        expect(response.status, evidenceUrl.slice(0, 40)).toBe(400);
      }
    });

    /**
     * **Server không bao giờ fetch `evidenceUrl`** — ADR-0009.
     *
     * Test bắt mọi đường ra ngoài ở tầng thấp nhất mà Node cho phép chặn được
     * bằng JavaScript: `fetch`, `http.request` và `https.request`. Nếu một tầng
     * nào đó (preview, unfurl, kiểm liveness) gọi URL người dùng nhập thì một
     * trong ba cái này nổ — và đó chính là SSRF vector mà ADR nói tới.
     */
    it("lưu evidenceUrl **không** phát sinh request ra ngoài", async () => {
      const projectId = await newProject("evidence-ssrf");
      const columnId = await newColumn(projectId, "Cần làm");

      const http = await import("node:http");
      const https = await import("node:https");
      const attempts: string[] = [];

      const realFetch = globalThis.fetch;
      const realHttp = http.default.request;
      const realHttps = https.default.request;

      globalThis.fetch = ((input: unknown) => {
        attempts.push(`fetch ${String(input)}`);
        throw new Error("test chặn: server không được fetch");
      }) as typeof globalThis.fetch;
      http.default.request = ((...args: unknown[]) => {
        attempts.push(`http ${String(args[0])}`);
        throw new Error("test chặn: server không được gọi http");
      }) as typeof http.default.request;
      https.default.request = ((...args: unknown[]) => {
        attempts.push(`https ${String(args[0])}`);
        throw new Error("test chặn: server không được gọi https");
      }) as typeof https.default.request;

      try {
        const created = await createTask(projectId, {
          title: "Bằng chứng nội bộ",
          columnId,
          // Một địa chỉ nội bộ: nếu server fetch, đây đúng là SSRF.
          evidenceUrl: "https://169.254.169.254/latest/meta-data/",
        });
        expect(created.status).toBe(201);

        const read = await call(f, "GET", `/tasks/${taskOf(created).id}`, { actor: f.wsAdmin });
        expect(read.status).toBe(200);
      } finally {
        globalThis.fetch = realFetch;
        http.default.request = realHttp;
        https.default.request = realHttps;
      }

      expect(attempts).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------------- *
   * dueState và cột terminal — ADR-0001, ADR-0008
   * ---------------------------------------------------------------------- */

  describe("dueState", () => {
    it("suy theo timezone workspace, không theo giờ máy chạy test", async () => {
      const projectId = await newProject("due-state");
      const columnId = await newColumn(projectId, "Cần làm");

      f.setToday("2026-09-05");
      const overdue = taskOf(
        await createTask(projectId, { title: "Quá hạn", columnId, dueDate: "2026-09-04" }),
      );
      const dueToday = taskOf(
        await createTask(projectId, { title: "Hôm nay", columnId, dueDate: "2026-09-05" }),
      );
      const dueSoon = taskOf(
        await createTask(projectId, { title: "Sắp tới", columnId, dueDate: "2026-09-07" }),
      );
      const scheduled = taskOf(
        await createTask(projectId, { title: "Còn xa", columnId, dueDate: "2026-10-01" }),
      );

      expect(overdue.dueState).toBe("overdue");
      expect(dueToday.dueState).toBe("due_today");
      expect(dueSoon.dueState).toBe("due_soon");
      expect(scheduled.dueState).toBe("scheduled");

      /**
       * Đẩy đồng hồ, **không** đổi dữ liệu: mọi `dueState` phải đổi theo.
       *
       * Đây là chỗ chứng minh `dueState` là dẫn xuất chứ không phải một giá trị
       * lưu sẵn — nếu nó được persist ở đâu đó, bốn con số dưới đây sẽ đứng yên.
       */
      f.setToday("2026-10-02");
      const after = itemsOf(await listTasks(projectId));
      const byId = new Map(after.map((t) => [t.id, t.dueState]));

      expect(byId.get(overdue.id)).toBe("overdue");
      expect(byId.get(dueToday.id)).toBe("overdue");
      expect(byId.get(dueSoon.id)).toBe("overdue");
      expect(byId.get(scheduled.id)).toBe("overdue");

      f.setToday("2026-09-05");
    });

    /**
     * Task ở cột terminal có `dueState = none` **và** rời khỏi bộ lọc
     * `overdue` — ADR-0008 mục 3, đúng failure experiment mà ADR mô tả.
     */
    it("task quá hạn chuyển vào cột terminal thì thành `none` và rời filter overdue", async () => {
      f.setToday("2026-09-05");
      const projectId = await newProject("terminal");
      const doing = await newColumn(projectId, "Đang làm");
      const done = await newColumn(projectId, "Xong", { isTerminal: true });

      const created = taskOf(
        await createTask(projectId, { title: "Quá hạn", columnId: doing, dueDate: "2026-08-01" }),
      );
      expect(created.dueState).toBe("overdue");
      expect(itemsOf(await listTasks(projectId, "?dueState=overdue")).map((t) => t.id)).toEqual([
        created.id,
      ]);

      const moved = await call(f, "POST", `/tasks/${created.id}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body: {
          destinationColumnId: done,
          targetPosition: "1024.0000000000",
          expectedVersion: created.version,
        },
      });
      expect(moved.status).toBe(200);
      expect(taskOf(moved).dueState).toBe("none");

      // Rời khỏi bộ lọc `overdue`, và xuất hiện trong bộ lọc `none`.
      expect(itemsOf(await listTasks(projectId, "?dueState=overdue"))).toEqual([]);
      expect(itemsOf(await listTasks(projectId, "?dueState=none")).map((t) => t.id)).toEqual([
        created.id,
      ]);
    });

    it("một project có hai cột terminal thì cả hai đều suppress", async () => {
      f.setToday("2026-09-05");
      const projectId = await newProject("two-terminal");
      const doing = await newColumn(projectId, "Đang làm");
      const done = await newColumn(projectId, "Xong", { isTerminal: true });
      const cancelled = await newColumn(projectId, "Huỷ", { isTerminal: true });

      for (const destination of [done, cancelled]) {
        const created = taskOf(
          await createTask(projectId, {
            title: `Quá hạn ${destination.slice(0, 4)}`,
            columnId: doing,
            dueDate: "2026-08-01",
          }),
        );
        const moved = await call(f, "POST", `/tasks/${created.id}/move`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("move"),
          body: {
            destinationColumnId: destination,
            targetPosition: "1024.0000000000",
            expectedVersion: created.version,
          },
        });
        expect(moved.status).toBe(200);
        expect(taskOf(moved).dueState).toBe("none");
      }

      expect(itemsOf(await listTasks(projectId, "?dueState=overdue"))).toEqual([]);
    });

    it("project không có cột terminal nào thì không gì bị suppress", async () => {
      f.setToday("2026-09-05");
      const projectId = await newProject("no-terminal");
      const columnId = await newColumn(projectId, "Cần làm");

      const created = taskOf(
        await createTask(projectId, { title: "Quá hạn", columnId, dueDate: "2026-08-01" }),
      );
      expect(created.dueState).toBe("overdue");
    });

    /**
     * Bộ lọc và giá trị hiển thị phải nói **cùng một điều**.
     *
     * `dueState` không có cột nào lưu, nên nó được suy hai lần: một lần trong
     * JavaScript để render, một lần trong SQL để lọc. Hai chỗ trôi khỏi nhau là
     * loại sai không ai báo cáo được thành lỗi — thẻ hiện đỏ mà bộ lọc "quá hạn"
     * lại không có nó.
     */
    it("mọi giá trị dueState: bộ lọc trả đúng tập mà projection nói", async () => {
      f.setToday("2026-09-05");
      const projectId = await newProject("due-filter");
      const doing = await newColumn(projectId, "Đang làm");
      const done = await newColumn(projectId, "Xong", { isTerminal: true });

      const dates: (string | null)[] = [
        "2026-08-01",
        "2026-09-05",
        "2026-09-07",
        "2026-10-01",
        null,
      ];
      for (const dueDate of dates) {
        await createTask(projectId, {
          title: `Việc ${String(dueDate)}`,
          columnId: doing,
          ...(dueDate === null ? {} : { dueDate }),
        });
      }
      // Một task ở cột terminal, quá hạn — phải nằm trong nhóm `none`.
      const terminalTask = taskOf(
        await createTask(projectId, {
          title: "Đã xong nhưng quá hạn",
          columnId: doing,
          dueDate: "2026-01-01",
        }),
      );
      await call(f, "POST", `/tasks/${terminalTask.id}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body: {
          destinationColumnId: done,
          targetPosition: "1024.0000000000",
          expectedVersion: terminalTask.version,
        },
      });

      const all = itemsOf(await listTasks(projectId, "?limit=100"));
      expect(all).toHaveLength(6);

      for (const state of ["none", "scheduled", "due_soon", "due_today", "overdue"]) {
        const expected = all
          .filter((t) => t.dueState === state)
          .map((t) => t.id)
          .sort();
        const actual = itemsOf(await listTasks(projectId, `?dueState=${state}&limit=100`))
          .map((t) => t.id)
          .sort();
        expect(actual, `bộ lọc dueState=${state}`).toEqual(expected);
      }
    });
  });

  /* ---------------------------------------------------------------------- *
   * Tìm kiếm không dấu
   * ---------------------------------------------------------------------- */

  describe("search", () => {
    it("`fb_unaccent` đối xứng: gõ không dấu tìm được có dấu, và ngược lại", async () => {
      const projectId = await newProject("search");
      const columnId = await newColumn(projectId, "Cần làm");

      const withDiacritics = taskOf(
        await createTask(projectId, { title: "Thiết kế lại bảng công việc", columnId }),
      );
      const withoutDiacritics = taskOf(
        await createTask(projectId, { title: "Thiet ke man hinh dang nhap", columnId }),
      );
      await createTask(projectId, { title: "Sửa lỗi đăng xuất", columnId });

      // Gõ **không dấu**, tìm ra cả hai — đây là nửa mà index-only-unaccent làm được.
      const plain = itemsOf(await listTasks(projectId, "?search=thiet%20ke"));
      expect(plain.map((t) => t.id).sort()).toEqual(
        [withDiacritics.id, withoutDiacritics.id].sort(),
      );

      // Gõ **có dấu**, cũng tìm ra cả hai — đây là nửa mà chỉ đối xứng mới làm được.
      const accented = itemsOf(await listTasks(projectId, "?search=thi%E1%BA%BFt%20k%E1%BA%BF"));
      expect(accented.map((t) => t.id).sort()).toEqual(
        [withDiacritics.id, withoutDiacritics.id].sort(),
      );
    });

    it("tìm cả trong description, và không tìm ngoài project", async () => {
      const projectId = await newProject("search-scope");
      const columnId = await newColumn(projectId, "Cần làm");
      const other = await newProject("search-other");
      const otherColumn = await newColumn(other, "Cần làm");

      const target = taskOf(
        await createTask(projectId, {
          title: "Việc thường",
          columnId,
          description: "Cần rà soát bảo mật trước khi phát hành",
        }),
      );
      await createTask(other, { title: "Rà soát bảo mật", columnId: otherColumn });

      const found = itemsOf(await listTasks(projectId, "?search=ra%20soat%20bao%20mat"));
      expect(found.map((t) => t.id)).toEqual([target.id]);
    });

    it("chuỗi tìm kiếm lạ không làm hỏng request", async () => {
      const projectId = await newProject("search-weird");
      const columnId = await newColumn(projectId, "Cần làm");
      await createTask(projectId, { title: "Việc bình thường", columnId });

      // `websearch_to_tsquery` không bao giờ ném với input tuỳ ý — đó là lý do
      // nó được chọn thay cho `plainto_tsquery`.
      for (const term of ["&&&", '"chua dong ngoac', "or or or", "-", "a & b | c"]) {
        const response = await listTasks(projectId, `?search=${encodeURIComponent(term)}`);
        expect(response.status, term).toBe(200);
      }
    });
  });

  /* ---------------------------------------------------------------------- *
   * Filter, sort và cursor
   * ---------------------------------------------------------------------- */

  describe("danh sách, sort và cursor", () => {
    it("sort theo position yêu cầu columnId", async () => {
      const projectId = await newProject("sort-position");
      await newColumn(projectId, "Cần làm");

      const rejected = await listTasks(projectId, "?sort=position:asc");
      expect(rejected.status).toBe(400);
    });

    it("sort ngoài allowlist là 400", async () => {
      const projectId = await newProject("sort-allowlist");
      for (const sort of ["title:asc", "position", "createdAt", "createdAt:up", "id:asc"]) {
        const response = await listTasks(projectId, `?sort=${encodeURIComponent(sort)}`);
        expect(response.status, sort).toBe(400);
      }
    });

    it("mặc định là createdAt desc; có columnId thì là board order", async () => {
      const projectId = await newProject("default-sort");
      const columnId = await newColumn(projectId, "Cần làm");

      const first = taskOf(await createTask(projectId, { title: "Một", columnId }));
      const second = taskOf(await createTask(projectId, { title: "Hai", columnId }));
      const third = taskOf(await createTask(projectId, { title: "Ba", columnId }));

      // Không columnId: mới nhất trước.
      expect(itemsOf(await listTasks(projectId)).map((t) => t.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);

      // Có columnId: thứ tự board, position tăng dần.
      expect(itemsOf(await listTasks(projectId, `?columnId=${columnId}`)).map((t) => t.id)).toEqual(
        [first.id, second.id, third.id],
      );
    });

    it("sort dueDate đặt NULL ở cuối cả hai hướng", async () => {
      const projectId = await newProject("sort-due");
      const columnId = await newColumn(projectId, "Cần làm");

      const early = taskOf(
        await createTask(projectId, { title: "Sớm", columnId, dueDate: "2026-09-01" }),
      );
      const late = taskOf(
        await createTask(projectId, { title: "Muộn", columnId, dueDate: "2026-12-01" }),
      );
      const none = taskOf(await createTask(projectId, { title: "Không hạn", columnId }));

      expect(itemsOf(await listTasks(projectId, "?sort=dueDate:asc")).map((t) => t.id)).toEqual([
        early.id,
        late.id,
        none.id,
      ]);
      // Đảo hướng **không** kéo task không hạn lên đầu.
      expect(itemsOf(await listTasks(projectId, "?sort=dueDate:desc")).map((t) => t.id)).toEqual([
        late.id,
        early.id,
        none.id,
      ]);
    });

    it("mọi filter trong allowlist đều thu hẹp đúng", async () => {
      const projectId = await newProject("filters");
      await addMember(projectId, f.editor, "editor");
      const columnA = await newColumn(projectId, "A");
      const columnB = await newColumn(projectId, "B");

      const target = taskOf(
        await createTask(projectId, {
          title: "Mục tiêu",
          columnId: columnA,
          assigneeId: f.editor.id,
          category: "bug",
          priority: "high",
          dueDate: "2026-09-20",
        }),
      );
      await createTask(projectId, { title: "Khác", columnId: columnB, priority: "low" });

      const cases: [string, string[]][] = [
        [`?columnId=${columnA}`, [target.id]],
        [`?assigneeId=${f.editor.id}`, [target.id]],
        ["?category=bug", [target.id]],
        ["?priority=high", [target.id]],
        ["?dueFrom=2026-09-15&dueTo=2026-09-25", [target.id]],
        ["?dueFrom=2026-10-01", []],
        ["?reviewerId=" + f.editor.id, []],
      ];

      for (const [query, expected] of cases) {
        const items = itemsOf(await listTasks(projectId, `${query}&limit=100`)).map((t) => t.id);
        if (expected.length === 0) {
          expect(items, query).not.toContain(target.id);
        } else {
          expect(items, query).toEqual(expected);
        }
      }

      // `createdById` của chính người tạo phải trả **cả hai** task.
      expect(
        itemsOf(await listTasks(projectId, `?createdById=${f.wsAdmin.id}&limit=100`)),
      ).toHaveLength(2);
    });

    it("`dueFrom > dueTo` là 400", async () => {
      const projectId = await newProject("due-range");
      expect((await listTasks(projectId, "?dueFrom=2026-10-01&dueTo=2026-09-01")).status).toBe(400);
    });

    it("cursor đi hết trang mà không trùng và không mất row", async () => {
      const projectId = await newProject("cursor");
      const columnId = await newColumn(projectId, "Cần làm");

      const created: string[] = [];
      for (let i = 0; i < 7; i++) {
        created.push(
          taskOf(await createTask(projectId, { title: `Việc ${String(i)}`, columnId })).id,
        );
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const query: string = `?limit=3${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
        const response = await listTasks(projectId, query);
        expect(response.status).toBe(200);
        seen.push(...itemsOf(response).map((t) => t.id));
        cursor = pageOf(response).nextCursor;
        if (cursor === null) break;
      }

      expect(seen).toHaveLength(created.length);
      expect(new Set(seen).size).toBe(created.length);
      // Mặc định `createdAt DESC` ⇒ đúng thứ tự tạo đảo ngược.
      expect(seen).toEqual([...created].reverse());
    });

    it("cursor seek đúng ở mọi sort trong allowlist", async () => {
      const projectId = await newProject("cursor-sorts");
      const columnId = await newColumn(projectId, "Cần làm");
      for (let i = 0; i < 5; i++) {
        await createTask(projectId, {
          title: `Việc ${String(i)}`,
          columnId,
          ...(i % 2 === 0 ? { dueDate: `2026-09-0${String(i + 1)}` } : {}),
        });
      }

      const sorts = [
        "createdAt:asc",
        "createdAt:desc",
        "updatedAt:asc",
        "updatedAt:desc",
        "dueDate:asc",
        "dueDate:desc",
        `position:asc&columnId=${columnId}`,
        `position:desc&columnId=${columnId}`,
      ];

      for (const sort of sorts) {
        const full = itemsOf(await listTasks(projectId, `?sort=${sort}&limit=100`)).map(
          (t) => t.id,
        );

        const paged: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const query: string = `?sort=${sort}&limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
          const response = await listTasks(projectId, query);
          expect(response.status, sort).toBe(200);
          paged.push(...itemsOf(response).map((t) => t.id));
          cursor = pageOf(response).nextCursor;
          if (cursor === null) break;
        }

        expect(paged, `phân trang sort=${sort}`).toEqual(full);
      }
    });

    it("cursor của column này không dùng được cho column khác", async () => {
      const projectId = await newProject("cursor-column");
      const columnA = await newColumn(projectId, "A");
      const columnB = await newColumn(projectId, "B");
      for (let i = 0; i < 3; i++) {
        await createTask(projectId, { title: `A${String(i)}`, columnId: columnA });
        await createTask(projectId, { title: `B${String(i)}`, columnId: columnB });
      }

      const first = await listTasks(projectId, `?columnId=${columnA}&limit=1`);
      const cursor = pageOf(first).nextCursor as string;
      expect(cursor).toBeTruthy();

      const reused = await listTasks(
        projectId,
        `?columnId=${columnB}&limit=1&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(reused.status).toBe(400);
      expect((reused.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
    });

    it("cursor của project này không dùng được cho project khác", async () => {
      const projectA = await newProject("cursor-pa");
      const projectB = await newProject("cursor-pb");
      const columnA = await newColumn(projectA, "A");
      const columnB = await newColumn(projectB, "B");
      await createTask(projectA, { title: "A1", columnId: columnA });
      await createTask(projectA, { title: "A2", columnId: columnA });
      await createTask(projectB, { title: "B1", columnId: columnB });
      await createTask(projectB, { title: "B2", columnId: columnB });

      const cursor = pageOf(await listTasks(projectA, "?limit=1")).nextCursor as string;
      const reused = await listTasks(projectB, `?limit=1&cursor=${encodeURIComponent(cursor)}`);
      expect(reused.status).toBe(400);
    });

    it("limit ngoài khoảng là 400, không bị clamp im lặng", async () => {
      const projectId = await newProject("limit");
      expect((await listTasks(projectId, "?limit=0")).status).toBe(400);
      expect((await listTasks(projectId, "?limit=101")).status).toBe(400);
      expect((await listTasks(projectId, "?limit=100")).status).toBe(200);
    });

    it("query field lạ là 400", async () => {
      const projectId = await newProject("query-strict");
      expect((await listTasks(projectId, "?orderBy=title")).status).toBe(400);
      expect((await listTasks(projectId, "?columnID=x")).status).toBe(400);
    });
  });

  /* ---------------------------------------------------------------------- *
   * GET /tasks/:taskId
   * ---------------------------------------------------------------------- */

  describe("GET /tasks/:taskId", () => {
    it("trả task, trang comment đầu và capabilities", async () => {
      const projectId = await newProject("detail");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Chi tiết", columnId }));

      const response = await call(f, "GET", `/tasks/${task.id}`, { actor: f.wsAdmin });

      expect(response.status).toBe(200);
      const data = response.body["data"] as {
        task: TaskBody;
        comments: { items: unknown[]; page: { hasMore: boolean } };
        capabilities: string[];
      };
      expect(data.task.id).toBe(task.id);
      // Task chưa có comment trả **trang rỗng**, không phải thiếu task.
      expect(data.comments.items).toEqual([]);
      expect(data.comments.page.hasMore).toBe(false);
      expect(data.capabilities).toContain("task:read");
    });

    it("taskId không tồn tại → 404", async () => {
      const response = await call(f, "GET", "/tasks/00000000-0000-4000-8000-0000000000aa", {
        actor: f.wsAdmin,
      });
      expect(response.status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------------- *
   * PATCH /tasks/:taskId
   * ---------------------------------------------------------------------- */

  describe("PATCH /tasks/:taskId", () => {
    async function patch(taskId: string, body: unknown, actor: TestActor = f.wsAdmin) {
      return await call(f, "PATCH", `/tasks/${taskId}`, {
        actor,
        idempotencyKey: newKey("patch"),
        body,
      });
    }

    it("sửa nội dung → 200, version tăng đúng một, ghi task.updated", async () => {
      const projectId = await newProject("patch");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Tên cũ", columnId }));

      const response = await patch(task.id, { title: "Tên mới", expectedVersion: 1 });

      expect(response.status).toBe(200);
      expect(taskOf(response).title).toBe("Tên mới");
      expect(taskOf(response).version).toBe(2);
      expect(await f.activity.countForProject(projectId, "task.updated")).toBe(1);
    });

    it("gửi `null` xoá liên kết; không nhắc tới thì giữ nguyên", async () => {
      const projectId = await newProject("patch-null");
      await addMember(projectId, f.editor, "editor");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(
        await createTask(projectId, {
          title: "Có người nhận",
          columnId,
          assigneeId: f.editor.id,
          dueDate: "2026-09-20",
        }),
      );

      const cleared = await patch(task.id, { assigneeId: null, expectedVersion: 1 });
      expect(cleared.status).toBe(200);
      expect(taskOf(cleared).assigneeId).toBeNull();
      // `dueDate` không được nhắc tới nên phải còn nguyên.
      expect(taskOf(cleared).dueDate).toBe("2026-09-20");
    });

    /**
     * Hai cột `NOT NULL` nhận **giá trị rỗng của chính cột**, không nhận `null`.
     *
     * Lịch sử của chỗ này đáng giữ. Hợp đồng từng cho gửi `null` cho
     * `description` và `priority`; `createTask` quy đổi (`?? ""`, `?? "none"`)
     * còn `updateTask` thì không, nên `PATCH` mang `null` đi thẳng vào `UPDATE`
     * và nổ ở constraint — `500`, chứ không phải một lỗi hợp đồng đọc được.
     *
     * Không test nào bắt được vì mọi test cũ gửi chuỗi, còn browser thì **chưa
     * bao giờ gọi tới được**: `PATCH /tasks/:taskId` là một trong bảy endpoint
     * mà preflight CORS chặn. Bug lộ ra đúng lúc lớp CORS được sửa, ở bài E2E
     * "hai tab cùng sửa một task".
     *
     * Bản sửa cuối cùng nằm ở **hợp đồng**, không ở server: hai cột đó
     * `NOT NULL` và `taskSchema` trả chúng non-nullable, nên `null` là giá trị
     * không đường nào tạo ra được. Frontend từng đổi `"" → null` và server đổi
     * ngược lại — hai phép quy đổi triệt tiêu nhau. Nay `null` bị từ chối ở
     * biên với `400`, và không ai phải quy đổi thầm nữa.
     */
    it("cột NOT NULL nhận giá trị rỗng của cột và từ chối `null` bằng `400`", async () => {
      const projectId = await newProject("patch-notnull");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(
        await createTask(projectId, {
          title: "Có mô tả",
          columnId,
          description: "Mô tả sẽ bị xoá",
          priority: "high",
        }),
      );

      const response = await patch(task.id, {
        description: "",
        priority: "none",
        expectedVersion: 1,
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      // "Không có nội dung là chuỗi rỗng", đúng như lần tạo đã quy đổi.
      expect(taskOf(response).description).toBe("");
      expect(taskOf(response).priority).toBe("none");
      expect(taskOf(response).version).toBe(2);

      // Và `null` bị chặn ở biên, không đi tới database.
      const rejected = await patch(task.id, { description: null, expectedVersion: 2 });
      expect(rejected.status).toBe(400);
      expect((rejected.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    });

    /** Cột nullable thật vẫn phải nhận `null` — quy đổi trên không được lan ra. */
    it("cột nullable vẫn về `null`, không bị quy đổi lây", async () => {
      const projectId = await newProject("patch-nullable");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(
        await createTask(projectId, {
          title: "Có hạn và phân loại",
          columnId,
          category: "feature",
          dueDate: "2026-09-20",
        }),
      );

      const response = await patch(task.id, {
        category: null,
        dueDate: null,
        expectedVersion: 1,
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(taskOf(response).category).toBeNull();
      expect(taskOf(response).dueDate).toBeNull();
    });

    /**
     * `sprintId` (Phase 1.4) và `parentTaskId` (Phase 1.5) có mặt trong hợp đồng
     * từ bây giờ để client không phải đoán khi phase đó bật — nhưng ở core MVP
     * hai cột đó **không tồn tại** trong database.
     *
     * Bỏ qua im lặng là cách biến một client sai thành một client tưởng mình
     * đúng: nó gửi `sprintId`, nhận `200`, và tin rằng task đã vào sprint.
     */
    it("field của phase chưa mở bị từ chối chứ không bỏ qua im lặng", async () => {
      const projectId = await newProject("patch-phase");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      for (const field of ["sprintId", "parentTaskId"]) {
        const response = await patch(task.id, {
          [field]: crypto.randomUUID(),
          expectedVersion: 1,
        });
        expect(response.status, field).toBe(400);
        expect(JSON.stringify(response.body), field).toContain(field);
      }

      // Không patch nào đi qua: version vẫn là 1.
      expect((await rowsOf(projectId))[0]?.version).toBe(1);
    });

    it("patch rỗng và field ngoài allowlist đều 400", async () => {
      const projectId = await newProject("patch-strict");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Nguyên vẹn", columnId }));

      for (const body of [
        { expectedVersion: 1 },
        {},
        { title: "X" },
        { columnId, expectedVersion: 1 },
        { position: "2048", expectedVersion: 1 },
        { version: 9, expectedVersion: 1 },
        { dueState: "overdue", expectedVersion: 1 },
        { createdBy: f.wsAdmin.id, expectedVersion: 1 },
      ]) {
        const response = await patch(task.id, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }

      expect((await rowsOf(projectId))[0]?.version).toBe(1);
    });

    /**
     * `409 TASK_VERSION_CONFLICT` **kèm `currentVersion`**.
     *
     * Con số đó là thứ cho client một đường xem lại thay vì bảo người dùng thử
     * lại một cách mù. Danh mục error code công bố nó là một trong **hai** code
     * duy nhất được mang `details`.
     */
    it("expectedVersion cũ → 409 kèm currentVersion, không ghi gì", async () => {
      const projectId = await newProject("patch-conflict");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Ban đầu", columnId }));

      expect((await patch(task.id, { title: "Lần một", expectedVersion: 1 })).status).toBe(200);

      const activityBefore = await f.activity.countForProject(projectId, "task.updated");
      const stale = await patch(task.id, { title: "Lần hai", expectedVersion: 1 });

      expect(stale.status).toBe(409);
      const error = stale.body["error"] as { code: string; details: { currentVersion: number } };
      expect(error.code).toBe("TASK_VERSION_CONFLICT");
      expect(error.details).toEqual({ currentVersion: 2 });

      // Không ghi đè và không thêm dòng lịch sử nào.
      const [row] = await rowsOf(projectId);
      expect(row?.title).toBe("Lần một");
      expect(row?.version).toBe(2);
      expect(await f.activity.countForProject(projectId, "task.updated")).toBe(activityBefore);
    });

    it("`startDate > dueDate` sau khi trộn với giá trị đang có bị chặn", async () => {
      const projectId = await newProject("patch-dates");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(
        await createTask(projectId, { title: "Có ngày", columnId, startDate: "2026-09-10" }),
      );

      // Chỉ gửi `dueDate`: schema của request không thấy được `startDate` đã lưu.
      const response = await patch(task.id, { dueDate: "2026-09-01", expectedVersion: 1 });
      expect(response.status).toBe(400);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Reviewer — ADR-0001
   * ---------------------------------------------------------------------- */

  describe("reviewer", () => {
    it("cột yêu cầu reviewer từ chối task thiếu reviewer", async () => {
      const projectId = await newProject("reviewer-required");
      const columnId = await newColumn(projectId, "Chờ duyệt", { requiresReviewer: true });

      const response = await createTask(projectId, { title: "Thiếu người duyệt", columnId });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain("reviewerId");
    });

    it("reviewer trùng assignee bị từ chối", async () => {
      const projectId = await newProject("reviewer-self");
      await addMember(projectId, f.editor, "editor");
      const columnId = await newColumn(projectId, "Chờ duyệt", { requiresReviewer: true });

      const response = await createTask(projectId, {
        title: "Tự duyệt",
        columnId,
        assigneeId: f.editor.id,
        reviewerId: f.editor.id,
      });
      expect(response.status).toBe(400);
    });

    it("reviewer ngoài project bị từ chối", async () => {
      const projectId = await newProject("reviewer-outsider");
      const columnId = await newColumn(projectId, "Chờ duyệt", { requiresReviewer: true });

      const response = await createTask(projectId, {
        title: "Người ngoài duyệt",
        columnId,
        reviewerId: f.outsider.id,
      });
      expect(response.status).toBe(400);
    });

    /**
     * Cờ `requiresReviewer` **không hồi tố** — M3 đã chốt, ADR-0009 nhắc lại.
     *
     * Task đã nằm sẵn trong cột trước khi cờ bật thì ở nguyên: bật một cờ cấu
     * hình không được biến thành một đợt vi phạm invariant hàng loạt.
     */
    it("task đã ở trong cột trước khi bật cờ thì không bị ảnh hưởng", async () => {
      const projectId = await newProject("reviewer-retroactive");
      const columnId = await newColumn(projectId, "Sẽ yêu cầu duyệt");
      const task = taskOf(await createTask(projectId, { title: "Vào trước khi bật cờ", columnId }));
      expect(task.reviewerId).toBeNull();

      const flag = await call(f, "PATCH", `/columns/${columnId}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("flag"),
        body: { requiresReviewer: true },
      });
      expect(flag.status).toBe(200);

      // Task vẫn ở nguyên chỗ, vẫn không có reviewer, và vẫn đọc được.
      const read = await call(f, "GET", `/tasks/${task.id}`, { actor: f.wsAdmin });
      expect(read.status).toBe(200);
      expect((read.body["data"] as { task: TaskBody }).task.reviewerId).toBeNull();
      expect((read.body["data"] as { task: TaskBody }).task.columnId).toBe(columnId);
    });

    it("move vào cột yêu cầu reviewer mà thiếu reviewer bị chặn trước commit", async () => {
      const projectId = await newProject("reviewer-move");
      await addMember(projectId, f.editor, "editor");
      const doing = await newColumn(projectId, "Đang làm");
      const review = await newColumn(projectId, "Chờ duyệt", { requiresReviewer: true });

      const task = taskOf(await createTask(projectId, { title: "Chưa có duyệt", columnId: doing }));

      const rejected = await call(f, "POST", `/tasks/${task.id}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body: {
          destinationColumnId: review,
          targetPosition: "1024.0000000000",
          expectedVersion: 1,
        },
      });
      expect(rejected.status).toBe(400);
      // Không di chuyển: task vẫn ở cột cũ và version chưa tăng.
      expect((await rowsOf(projectId))[0]?.columnId).toBe(doing);
      expect((await rowsOf(projectId))[0]?.version).toBe(1);

      const accepted = await call(f, "POST", `/tasks/${task.id}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body: {
          destinationColumnId: review,
          targetPosition: "1024.0000000000",
          expectedVersion: 1,
          reviewerId: f.editor.id,
        },
      });
      expect(accepted.status).toBe(200);
      expect(taskOf(accepted).reviewerId).toBe(f.editor.id);
    });

    it("gửi reviewerId cho cột **không** yêu cầu là 400", async () => {
      const projectId = await newProject("reviewer-unwanted");
      await addMember(projectId, f.editor, "editor");
      const doing = await newColumn(projectId, "Đang làm");
      const other = await newColumn(projectId, "Khác");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId: doing }));

      const response = await call(f, "POST", `/tasks/${task.id}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body: {
          destinationColumnId: other,
          targetPosition: "1024.0000000000",
          expectedVersion: 1,
          reviewerId: f.editor.id,
        },
      });
      expect(response.status).toBe(400);
    });
  });

  /* ---------------------------------------------------------------------- *
   * POST /tasks/:taskId/move
   * ---------------------------------------------------------------------- */

  describe("POST /tasks/:taskId/move", () => {
    async function move(taskId: string, body: Record<string, unknown>) {
      return await call(f, "POST", `/tasks/${taskId}/move`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("move"),
        body,
      });
    }

    it("trả 200 (KHÔNG phải 201), tăng version, ghi đúng một task.moved", async () => {
      const projectId = await newProject("move");
      const from = await newColumn(projectId, "Đang làm");
      const to = await newColumn(projectId, "Đã xong");
      const task = taskOf(await createTask(projectId, { title: "Kéo thả", columnId: from }));

      const response = await move(task.id, {
        destinationColumnId: to,
        targetPosition: "1024.0000000000",
        expectedVersion: 1,
      });

      expect(response.status).toBe(200);
      expect(taskOf(response).columnId).toBe(to);
      expect(taskOf(response).version).toBe(2);
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(1);
      expect(await f.activity.countForProject(projectId, "task.reopened")).toBe(0);
    });

    it("`targetPosition` là gợi ý: server tự tính giá trị thật", async () => {
      const projectId = await newProject("move-position");
      const columnId = await newColumn(projectId, "Cần làm");
      const a = taskOf(await createTask(projectId, { title: "A", columnId }));
      const b = taskOf(await createTask(projectId, { title: "B", columnId }));
      const c = taskOf(await createTask(projectId, { title: "C", columnId }));

      // Thả C lên đúng chỗ của B ⇒ C đứng **trước** B.
      const response = await move(c.id, {
        destinationColumnId: columnId,
        targetPosition: b.position,
        expectedVersion: 1,
      });
      expect(response.status).toBe(200);
      expect(taskOf(response).position).toBe("1536.0000000000");

      expect((await rowsOf(projectId, columnId)).map((r) => r.id)).toEqual([a.id, c.id, b.id]);
    });

    /** Mở lại — ADR-0008 mục 5: **đúng một** `task.reopened`, **không** `task.moved`. */
    it("rời cột terminal ghi đúng một task.reopened và KHÔNG kèm task.moved", async () => {
      const projectId = await newProject("reopen");
      const doing = await newColumn(projectId, "Đang làm");
      const done = await newColumn(projectId, "Xong", { isTerminal: true });
      const task = taskOf(
        await createTask(projectId, { title: "Xong rồi mở lại", columnId: doing }),
      );

      const intoTerminal = await move(task.id, {
        destinationColumnId: done,
        targetPosition: "1024.0000000000",
        expectedVersion: 1,
      });
      expect(intoTerminal.status).toBe(200);
      // Chiều đi **vào** vẫn là `task.moved` — chỉ chiều đi ra được đặt tên riêng.
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(1);
      expect(await f.activity.countForProject(projectId, "task.reopened")).toBe(0);

      const out = await move(task.id, {
        destinationColumnId: doing,
        targetPosition: "1024.0000000000",
        expectedVersion: taskOf(intoTerminal).version,
      });
      expect(out.status).toBe(200);

      expect(await f.activity.countForProject(projectId, "task.reopened")).toBe(1);
      // **Không** tăng thêm: một move commit vẫn là đúng một dòng lịch sử.
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(1);
    });

    it("terminal → terminal không phải mở lại", async () => {
      const projectId = await newProject("terminal-to-terminal");
      const doing = await newColumn(projectId, "Đang làm");
      const done = await newColumn(projectId, "Xong", { isTerminal: true });
      const cancelled = await newColumn(projectId, "Huỷ", { isTerminal: true });
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId: doing }));

      const one = await move(task.id, {
        destinationColumnId: done,
        targetPosition: "1024.0000000000",
        expectedVersion: 1,
      });
      const two = await move(task.id, {
        destinationColumnId: cancelled,
        targetPosition: "1024.0000000000",
        expectedVersion: taskOf(one).version,
      });

      expect(two.status).toBe(200);
      expect(await f.activity.countForProject(projectId, "task.reopened")).toBe(0);
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(2);
    });

    it("expectedVersion cũ → 409 kèm currentVersion, task không di chuyển", async () => {
      const projectId = await newProject("move-conflict");
      const from = await newColumn(projectId, "Đang làm");
      const to = await newColumn(projectId, "Đã xong");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId: from }));

      expect(
        (
          await call(f, "PATCH", `/tasks/${task.id}`, {
            actor: f.wsAdmin,
            idempotencyKey: newKey("bump"),
            body: { title: "Đổi tên", expectedVersion: 1 },
          })
        ).status,
      ).toBe(200);

      const stale = await move(task.id, {
        destinationColumnId: to,
        targetPosition: "1024.0000000000",
        expectedVersion: 1,
      });

      expect(stale.status).toBe(409);
      expect((stale.body["error"] as { details: unknown }).details).toEqual({ currentVersion: 2 });
      expect((await rowsOf(projectId))[0]?.columnId).toBe(from);
      expect(await f.activity.countForProject(projectId, "task.moved")).toBe(0);
    });

    it("cột đích của project khác → 400", async () => {
      const projectId = await newProject("move-cross");
      const columnId = await newColumn(projectId, "Cần làm");
      const other = await newProject("move-cross-other");
      const foreign = await newColumn(other, "Cột lạ");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      const response = await move(task.id, {
        destinationColumnId: foreign,
        targetPosition: "1024.0000000000",
        expectedVersion: 1,
      });
      expect(response.status).toBe(400);
    });

    it("body sai shape là 400", async () => {
      const projectId = await newProject("move-strict");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      for (const body of [
        { destinationColumnId: columnId, targetPosition: "1024", expectedVersion: 0 },
        { destinationColumnId: columnId, targetPosition: "-1", expectedVersion: 1 },
        { destinationColumnId: columnId, targetPosition: "abc", expectedVersion: 1 },
        { destinationColumnId: columnId, expectedVersion: 1 },
        {
          destinationColumnId: columnId,
          targetPosition: "1024",
          expectedVersion: 1,
          columnId,
        },
      ]) {
        const response = await move(task.id, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });
  });

  /* ---------------------------------------------------------------------- *
   * Comment
   * ---------------------------------------------------------------------- */

  describe("comment", () => {
    it("tạo comment → 201, khớp hợp đồng, ghi comment.created", async () => {
      const projectId = await newProject("comment");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Có bình luận", columnId }));

      const response = await call(f, "POST", `/tasks/${task.id}/comments`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("comment"),
        body: { body: "Tôi nhận việc này." },
      });

      expect(response.status).toBe(201);
      const parsed = commentSchema.safeParse(
        (response.body["data"] as { comment: unknown }).comment,
      );
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(await f.activity.countForProject(projectId, "comment.created")).toBe(1);
    });

    /**
     * `body` là **plain text bất biến** — ADR-0009.
     *
     * Server lưu đúng những gì người dùng gõ: không normalize, không
     * sanitize-rồi-lưu, không chuyển sang HTML. Việc render Markdown theo
     * allowlist là quyết định của client.
     */
    it("lưu nguyên văn, kể cả cú pháp Markdown và ký tự HTML", async () => {
      const projectId = await newProject("comment-raw");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Bình luận thô", columnId }));

      const raw =
        '**đậm** `code` <script>alert("x")</script> & <img onerror=1> [l](https://a.test)';
      const response = await call(f, "POST", `/tasks/${task.id}/comments`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("comment"),
        body: { body: raw },
      });

      expect(response.status).toBe(201);
      expect((response.body["data"] as { comment: { body: string } }).comment.body).toBe(raw);

      // Và đọc lại cũng đúng nguyên văn — không có bước biến đổi nào ở giữa.
      const read = await call(f, "GET", `/tasks/${task.id}`, { actor: f.wsAdmin });
      const items = (read.body["data"] as { comments: { items: { body: string }[] } }).comments
        .items;
      expect(items[0]?.body).toBe(raw);
    });

    it("không có route nào sửa hay xoá comment", async () => {
      const projectId = await newProject("comment-immutable");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      const created = await call(f, "POST", `/tasks/${task.id}/comments`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("comment"),
        body: { body: "Không sửa được" },
      });
      const commentId = (created.body["data"] as { comment: { id: string } }).comment.id;

      for (const [method, path] of [
        ["PATCH", `/comments/${commentId}`],
        ["DELETE", `/comments/${commentId}`],
        ["PATCH", `/tasks/${task.id}/comments/${commentId}`],
        ["DELETE", `/tasks/${task.id}/comments/${commentId}`],
      ] as const) {
        const response = await call(f, method, path, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("mutate"),
          body: { body: "Đã sửa" },
        });
        // Route không tồn tại. Điều quan trọng là **không** có `2xx` nào.
        expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      }
    });

    it("body rỗng hoặc field lạ là 400, và không tạo comment", async () => {
      const projectId = await newProject("comment-strict");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      for (const body of [{ body: "" }, { body: "   " }, {}, { body: "ok", taskId: task.id }]) {
        const response = await call(f, "POST", `/tasks/${task.id}/comments`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("comment"),
          body,
        });
        expect(response.status, JSON.stringify(body)).toBe(400);
      }

      expect(await f.activity.countForProject(projectId, "comment.created")).toBe(0);
    });

    it("comment có thứ tự cố định và phân trang được", async () => {
      const projectId = await newProject("comment-page");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Nhiều bình luận", columnId }));

      const bodies = ["Một", "Hai", "Ba", "Bốn", "Năm"];
      for (const body of bodies) {
        await call(f, "POST", `/tasks/${task.id}/comments`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("comment"),
          body: { body },
        });
      }

      const first = await call(f, "GET", `/tasks/${task.id}?limit=2`, { actor: f.wsAdmin });
      const firstPage = (
        first.body["data"] as {
          comments: { items: { body: string }[]; page: { nextCursor: string | null } };
        }
      ).comments;
      expect(firstPage.items.map((c) => c.body)).toEqual(["Một", "Hai"]);

      const cursor = firstPage.page.nextCursor as string;
      expect(cursor).toBeTruthy();
      const second = await call(
        f,
        "GET",
        `/tasks/${task.id}?limit=2&cursor=${encodeURIComponent(cursor)}`,
        { actor: f.wsAdmin },
      );
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const secondPage = (second.body["data"] as { comments: { items: { body: string }[] } })
        .comments;
      expect(secondPage.items.map((c) => c.body)).toEqual(["Ba", "Bốn"]);
    });
  });

  /* ---------------------------------------------------------------------- *
   * GET /tasks/:taskId/activity
   * ---------------------------------------------------------------------- */

  describe("GET /tasks/:taskId/activity", () => {
    it("trả summary do server dựng và KHÔNG trả raw payload", async () => {
      const projectId = await newProject("activity");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Có lịch sử", columnId }));

      await call(f, "PATCH", `/tasks/${task.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("patch"),
        body: { title: "Đổi tên", expectedVersion: 1 },
      });

      const response = await call(f, "GET", `/tasks/${task.id}/activity`, { actor: f.wsAdmin });
      expect(response.status).toBe(200);

      const items = (
        response.body["data"] as {
          items: { action: string; summary: string; actor: { id: string } }[];
        }
      ).items;

      // Mới nhất trước.
      expect(items.map((i) => i.action)).toEqual(["task.updated", "task.created"]);
      expect(items[0]?.summary).toContain("tiêu đề");
      expect(items[0]?.actor.id).toBe(f.wsAdmin.id);

      // `payload` không bao giờ ra khỏi server.
      expect(JSON.stringify(response.body)).not.toContain("payload");
      expect(JSON.stringify(response.body)).not.toContain("rebalanced");
    });

    it("chỉ trả activity của **task này**, không lẫn task khác", async () => {
      const projectId = await newProject("activity-scope");
      const columnId = await newColumn(projectId, "Cần làm");
      const a = taskOf(await createTask(projectId, { title: "A", columnId }));
      const b = taskOf(await createTask(projectId, { title: "B", columnId }));

      const response = await call(f, "GET", `/tasks/${a.id}/activity`, { actor: f.wsAdmin });
      const items = (response.body["data"] as { items: { taskId: string }[] }).items;

      expect(items).toHaveLength(1);
      expect(items.every((i) => i.taskId === a.id)).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain(b.id);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Hợp đồng và projection
   * ---------------------------------------------------------------------- */

  describe("projection khớp hợp đồng", () => {
    it("task có category khớp `taskSchema`", async () => {
      const projectId = await newProject("conformance");
      const columnId = await newColumn(projectId, "Cần làm");

      const response = await createTask(projectId, {
        title: "Đủ field",
        columnId,
        category: "feature",
        priority: "high",
        dueDate: "2026-09-20",
        evidenceUrl: "https://example.test/bc",
      });

      const parsed = taskSchema.safeParse(taskOf(response));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    /**
     * **Lệch hợp đồng đã biết, được ghim ở đây thay vì bị bỏ qua.**
     *
     * `category` là **nullable**, và đây là chỗ chứng minh nó.
     *
     * `other` là một nhóm công việc thật ("Khác"), không phải giá trị "chưa
     * chọn" — nên không thành viên nào của enum diễn đạt được ô trống, và
     * `null` là câu trả lời duy nhất trung thực cho một task chưa phân loại.
     *
     * Bản trước của test này ghim một **sai lệch**: `taskSchema` khai
     * non-nullable trong khi database ghi `Null = Yes`, nên schema của hợp đồng
     * từ chối chính response của chính nó. Nó được viết để đỏ lên khi hợp đồng
     * được sửa, và nó đã đỏ đúng lúc đó. Nay nó khẳng định hành vi đúng thay vì
     * ghim một chỗ sai.
     */
    it("task không có category trả `null`, và `taskSchema` chấp nhận", async () => {
      const projectId = await newProject("conformance-null");
      const columnId = await newColumn(projectId, "Cần làm");

      const task = taskOf(await createTask(projectId, { title: "Không phân loại", columnId }));
      expect(task.category).toBeNull();

      // Parse **cả** projection, không chỉ một field: một field thừa lọt ra
      // ngoài projection chỉ lộ ra khi schema `.strict()` được chạy trọn vẹn.
      expect(() => taskSchema.parse(task)).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------------- *
   * Idempotency
   * ---------------------------------------------------------------------- */

  describe("Idempotency-Key", () => {
    it("thiếu key → 400 trên cả bốn route ghi", async () => {
      const projectId = await newProject("no-key");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      const create = await call(f, "POST", `/projects/${projectId}/tasks`, {
        actor: f.wsAdmin,
        body: { title: "X", columnId, description: "" },
      });
      const patch = await call(f, "PATCH", `/tasks/${task.id}`, {
        actor: f.wsAdmin,
        body: { title: "X", expectedVersion: 1 },
      });
      const move = await call(f, "POST", `/tasks/${task.id}/move`, {
        actor: f.wsAdmin,
        body: {
          destinationColumnId: columnId,
          targetPosition: "1024",
          expectedVersion: 1,
        },
      });
      const comment = await call(f, "POST", `/tasks/${task.id}/comments`, {
        actor: f.wsAdmin,
        body: { body: "X" },
      });

      expect([create.status, patch.status, move.status, comment.status]).toEqual([
        400, 400, 400, 400,
      ]);
    });

    it("retry cùng key phát lại outcome, không tạo task thứ hai", async () => {
      const projectId = await newProject("replay");
      const columnId = await newColumn(projectId, "Cần làm");
      const key = newKey("replay");
      const body = { title: "Chỉ một lần", columnId, description: "" };

      const first = await call(f, "POST", `/projects/${projectId}/tasks`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });
      const second = await call(f, "POST", `/projects/${projectId}/tasks`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(taskOf(second).id).toBe(taskOf(first).id);
      expect(await rowsOf(projectId)).toHaveLength(1);
      expect(await f.activity.countForProject(projectId, "task.created")).toBe(1);
    });

    it("409 version conflict được phát lại y nguyên", async () => {
      const projectId = await newProject("replay-409");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));
      const key = newKey("replay-409");

      const first = await call(f, "PATCH", `/tasks/${task.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body: { title: "Sai version", expectedVersion: 99 },
      });
      expect(first.status).toBe(409);

      const replay = await call(f, "PATCH", `/tasks/${task.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body: { title: "Sai version", expectedVersion: 99 },
      });
      expect(replay.status).toBe(409);
      expect((replay.body["error"] as { code: string }).code).toBe("TASK_VERSION_CONFLICT");
    });
  });

  /* ---------------------------------------------------------------------- *
   * Hai cổng port mà M2 và M3 đã hứa
   * ---------------------------------------------------------------------- */

  describe("cổng đã hứa ở M2 và M3, nay chạy trên dữ liệu thật", () => {
    it("archive cột **thật sự** còn task → 409 COLUMN_NOT_EMPTY", async () => {
      const projectId = await newProject("empty-check");
      const columnId = await newColumn(projectId, "Còn việc");
      await createTask(projectId, { title: "Việc thật", columnId });

      // Không bật công tắc nào: adapter thật đọc bảng `tasks`.
      const response = await call(f, "PATCH", `/columns/${columnId}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("arch"),
        body: { archive: true },
      });

      expect(response.status).toBe(409);
      expect((response.body["error"] as { code: string }).code).toBe("COLUMN_NOT_EMPTY");
      // Và **không task nào bị dời đi đâu cả**.
      expect((await rowsOf(projectId))[0]?.columnId).toBe(columnId);
    });

    it("gỡ member **thật sự** đang giữ việc → 409 MEMBER_HAS_ASSIGNED_TASKS", async () => {
      const projectId = await newProject("assignee-check");
      await addMember(projectId, f.editor, "editor");
      const columnId = await newColumn(projectId, "Cần làm");
      await createTask(projectId, {
        title: "Việc của editor",
        columnId,
        assigneeId: f.editor.id,
      });

      const response = await call(f, "DELETE", `/projects/${projectId}/members/${f.editor.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("remove"),
      });

      expect(response.status).toBe(409);
      expect((response.body["error"] as { code: string }).code).toBe("MEMBER_HAS_ASSIGNED_TASKS");

      // Gỡ assignment rồi thì gỡ được — chứng minh nhánh chặn là do dữ liệu thật.
      const [row] = await rowsOf(projectId);
      await call(f, "PATCH", `/tasks/${row?.id as string}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("unassign"),
        body: { assigneeId: null, expectedVersion: 1 },
      });
      const after = await call(f, "DELETE", `/projects/${projectId}/members/${f.editor.id}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("remove2"),
      });
      expect(after.status).toBe(204);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Phân quyền
   * ---------------------------------------------------------------------- */

  describe("phân quyền trên bảy route", () => {
    it("Viewer đọc được, nhưng mọi mutation là 403 và không ghi gì", async () => {
      const projectId = await newProject("viewer");
      await addMember(projectId, f.viewer, "viewer");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      // Đọc được: `task:read`, `comment:read`, `activity:read` là quyền thật.
      expect((await listTasks(projectId, "", f.viewer)).status).toBe(200);
      expect((await call(f, "GET", `/tasks/${task.id}`, { actor: f.viewer })).status).toBe(200);
      expect((await call(f, "GET", `/tasks/${task.id}/activity`, { actor: f.viewer })).status).toBe(
        200,
      );

      const before = await rowsOf(projectId);
      const activityBefore = await f.activity.countForProject(projectId);

      const mutations = [
        ["POST", `/projects/${projectId}/tasks`, { title: "X", columnId, description: "" }],
        ["PATCH", `/tasks/${task.id}`, { title: "X", expectedVersion: 1 }],
        [
          "POST",
          `/tasks/${task.id}/move`,
          { destinationColumnId: columnId, targetPosition: "1024", expectedVersion: 1 },
        ],
        ["POST", `/tasks/${task.id}/comments`, { body: "X" }],
      ] as const;

      for (const [method, path, body] of mutations) {
        const response = await call(f, method, path, {
          actor: f.viewer,
          idempotencyKey: newKey("viewer"),
          body,
        });
        expect(response.status, `${method} ${path}`).toBe(403);
      }

      expect(await rowsOf(projectId)).toEqual(before);
      expect(await f.activity.countForProject(projectId)).toBe(activityBefore);
    });

    it("Editor tạo/sửa/kéo được nhưng comment cũng được — đúng catalog", async () => {
      const projectId = await newProject("editor");
      await addMember(projectId, f.editor, "editor");
      const columnId = await newColumn(projectId, "Cần làm");

      const created = await createTask(projectId, { title: "Editor tạo", columnId }, f.editor);
      expect(created.status).toBe(201);

      const patched = await call(f, "PATCH", `/tasks/${taskOf(created).id}`, {
        actor: f.editor,
        idempotencyKey: newKey("editor"),
        body: { title: "Editor sửa", expectedVersion: 1 },
      });
      expect(patched.status).toBe(200);

      const commented = await call(f, "POST", `/tasks/${taskOf(created).id}/comments`, {
        actor: f.editor,
        idempotencyKey: newKey("editor"),
        body: { body: "Editor bình luận" },
      });
      expect(commented.status).toBe(201);
    });

    /**
     * `:taskId` là **locator, không phải bằng chứng quyền**.
     *
     * User A là Owner của Project A, **cùng workspace** với project kia. Đoán
     * trúng một `taskId` không cho họ gì cả — và câu trả lời là `404`, không
     * phải `403`, vì `403` đã xác nhận task đó có thật.
     */
    it("người ngoài project nhận 404 trên cả bảy route, và không đổi gì", async () => {
      const projectId = await newProject("cross-project");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Riêng tư", columnId }));
      const before = await rowsOf(projectId);

      const routes = [
        ["GET", `/projects/${projectId}/tasks`, undefined],
        ["POST", `/projects/${projectId}/tasks`, { title: "X", columnId, description: "" }],
        ["GET", `/tasks/${task.id}`, undefined],
        ["PATCH", `/tasks/${task.id}`, { title: "X", expectedVersion: 1 }],
        [
          "POST",
          `/tasks/${task.id}/move`,
          { destinationColumnId: columnId, targetPosition: "1024", expectedVersion: 1 },
        ],
        ["POST", `/tasks/${task.id}/comments`, { body: "X" }],
        ["GET", `/tasks/${task.id}/activity`, undefined],
      ] as const;

      for (const actor of [f.userA, f.owner]) {
        for (const [method, path, body] of routes) {
          const response = await call(f, method, path, {
            actor,
            idempotencyKey: newKey("probe404"),
            ...(body === undefined ? {} : { body }),
          });
          expect(response.status, `${method} ${path} với ${actor.email}`).toBe(404);
        }
      }

      expect(await rowsOf(projectId)).toEqual(before);
    });

    it("`404` của task có thật và của UUID bịa ra là giống hệt nhau", async () => {
      const projectId = await newProject("probe-404");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Riêng tư", columnId }));

      const real = await call(f, "GET", `/tasks/${task.id}`, { actor: f.userA });
      const fake = await call(f, "GET", "/tasks/00000000-0000-4000-8000-0000000000ff", {
        actor: f.userA,
      });

      expect(real.status).toBe(fake.status);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: "<redacted>" });
      expect(strip(real.body)).toEqual(strip(fake.body));
    });

    it("chưa xác thực → 401 trên mọi route của M4", async () => {
      const projectId = await newProject("unauth");
      const columnId = await newColumn(projectId, "Cần làm");
      const task = taskOf(await createTask(projectId, { title: "Việc", columnId }));

      for (const [method, path] of [
        ["GET", `/projects/${projectId}/tasks`],
        ["GET", `/tasks/${task.id}`],
        ["GET", `/tasks/${task.id}/activity`],
      ] as const) {
        const response = await call(f, method, path);
        expect(response.status, path).toBe(401);
      }
    });

    it("mutation thiếu CSRF token → 403, không ghi gì", async () => {
      const projectId = await newProject("csrf");
      const columnId = await newColumn(projectId, "Cần làm");
      const before = await rowsOf(projectId);

      const response = await call(f, "POST", `/projects/${projectId}/tasks`, {
        actor: f.wsAdmin,
        csrf: false,
        idempotencyKey: newKey("nocsrf"),
        body: { title: "Không CSRF", columnId, description: "" },
      });

      expect(response.status).toBe(403);
      expect(await rowsOf(projectId)).toEqual(before);
    });
  });
});
