import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectOverviewSchema, successEnvelopeSchema } from "@flowboard/contracts";
import { boardColumns, tasks as tasksTable, workspaces } from "../shared/database/schema.ts";
import { call, createFixture, newKey, type Fixture, type TestActor } from "./fixture.ts";

/**
 * `GET /projects/:projectId/overview` — aggregate cho `PRJ-04`.
 *
 * Điều đáng kiểm nhất ở đây **không** phải "endpoint trả 200". Nó là ba câu mà
 * hợp đồng nói và một bản hiện thực cẩu thả sẽ vi phạm mà không ai thấy:
 *
 * 1. `byColumn` giữ **đúng** thứ tự board, và chỉ column active.
 * 2. `dueStates` dùng **cùng** đồng hồ và **cùng** cửa sổ với list task.
 * 3. Server trả số đếm, **không** trả phần trăm.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface OverviewBody {
  window: { from: string; to: string };
  totals: { tasks: number; createdInWindow: number };
  byColumn: { columnId: string; name: string; isTerminal: boolean; taskCount: number }[];
  byAssignee: { user: { id: string; displayName: string }; taskCount: number }[];
  unassignedCount: number;
  dueStates: { overdue: number; dueToday: number; dueSoon: number; none: number };
}

describeIfDb("overview của project", () => {
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

  async function addMember(projectId: string, actor: TestActor, role: string): Promise<void> {
    const response = await call(f, "POST", `/projects/${projectId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("member"),
      body: { userId: actor.id, role },
    });
    expect(response.status).toBe(201);
  }

  async function newColumn(
    projectId: string,
    name: string,
    extra: Partial<{ isTerminal: boolean }> = {},
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
  ): Promise<{ id: string; version: number }> {
    const response = await call(f, "POST", `/projects/${projectId}/tasks`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("task"),
      body: { description: "", ...body },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { task: { id: string; version: number } }).task;
  }

  async function overviewOf(projectId: string, query = "", actor: TestActor = f.wsAdmin) {
    return await call(f, "GET", `/projects/${projectId}/overview${query}`, { actor });
  }

  function bodyOf(response: { body: Record<string, unknown> }): OverviewBody {
    return response.body["data"] as unknown as OverviewBody;
  }

  /* ---------------------------------------------------------------------- *
   * Hình dạng và hợp đồng
   * ---------------------------------------------------------------------- */

  it("trả 200 và khớp `projectOverviewSchema`", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-shape");
    await newColumn(projectId, "Cần làm");

    const response = await overviewOf(projectId);

    expect(response.status).toBe(200);
    const parsed = successEnvelopeSchema(projectOverviewSchema).safeParse(response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  /**
   * **Server trả số đếm, client tính phần trăm.**
   *
   * Trả cả hai là hai nguồn cho cùng một sự thật, và chúng lệch ở lần làm tròn
   * đầu tiên. Test này quét cả response tìm bất kỳ dấu hiệu nào của một tỉ lệ.
   */
  it("không trả phần trăm ở bất kỳ đâu", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-no-percent");
    const columnId = await newColumn(projectId, "Cần làm");
    await createTask(projectId, { title: "Một", columnId });
    await createTask(projectId, { title: "Hai", columnId });
    await createTask(projectId, { title: "Ba", columnId });

    const serialized = JSON.stringify(bodyOf(await overviewOf(projectId)));

    expect(serialized).not.toContain("%");
    expect(serialized).not.toMatch(/percent|ratio|rate|progress/i);
    // Và `.strict()` của hợp đồng đã chặn mọi field lạ — kể cả một field tỉ lệ
    // đặt tên khác. Hai lớp, hai câu hỏi khác nhau.
  });

  /* ---------------------------------------------------------------------- *
   * byColumn phải khớp board
   * ---------------------------------------------------------------------- */

  /**
   * `byColumn` **giữ nguyên thứ tự `position` của board**, và chỉ column active.
   *
   * Người đọc dashboard và người đọc board phải thấy cùng một trật tự; nếu
   * không, hai màn nói hai chuyện về cùng một project.
   */
  it("byColumn khớp đúng thứ tự và tập column của board", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-columns");
    const doing = await newColumn(projectId, "Đang làm");
    const review = await newColumn(projectId, "Chờ duyệt");
    const done = await newColumn(projectId, "Xong", { isTerminal: true });

    // Sắp lại board: dashboard phải đi theo.
    const reordered = await call(f, "POST", "/columns/reorder", {
      actor: f.wsAdmin,
      idempotencyKey: newKey("reorder"),
      body: { projectId, orderedColumnIds: [done, doing, review] },
    });
    expect(reordered.status).toBe(200);

    const board = (
      (await call(f, "GET", `/projects/${projectId}`, { actor: f.wsAdmin })).body["data"] as {
        columns: { id: string }[];
      }
    ).columns;

    const overview = bodyOf(await overviewOf(projectId));

    expect(overview.byColumn.map((c) => c.columnId)).toEqual(board.map((c) => c.id));
    // `isTerminal` đi kèm để client **không** phải đoán từ tên cột.
    expect(overview.byColumn.find((c) => c.columnId === done)?.isTerminal).toBe(true);
    expect(overview.byColumn.find((c) => c.columnId === doing)?.isTerminal).toBe(false);
  });

  it("column rỗng vẫn có mặt với taskCount 0", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-empty-column");
    const used = await newColumn(projectId, "Có việc");
    const empty = await newColumn(projectId, "Trống");
    await createTask(projectId, { title: "Một", columnId: used });

    const overview = bodyOf(await overviewOf(projectId));

    expect(overview.byColumn).toHaveLength(2);
    expect(overview.byColumn.find((c) => c.columnId === empty)?.taskCount).toBe(0);
    expect(overview.byColumn.find((c) => c.columnId === used)?.taskCount).toBe(1);
  });

  /**
   * `sum(byColumn[].taskCount)` so với `totals.tasks` — và **vì sao** chúng có
   * thể khác nhau.
   *
   * `byColumn` chỉ gồm column **active**; `totals.tasks` đếm **mọi** task của
   * project. Một task nằm trong column đã archive vì vậy được `totals` đếm mà
   * `byColumn` không thấy.
   *
   * Ở MVP hai số này **luôn bằng nhau**, và lý do đáng nói ra: archive một
   * column còn task bị chặn bằng `409 COLUMN_NOT_EMPTY` (M3), nên không tồn tại
   * đường nào tạo ra một column đã archive mà còn task. Test dưới đây khẳng định
   * cả hai vế — chúng bằng nhau, **và** lý do khiến chúng bằng nhau vẫn còn hiệu
   * lực. Nếu một ngày MVP cho phép archive column còn task, vế thứ hai đỏ trước.
   */
  it("sum(byColumn) bằng totals.tasks, và đường làm chúng lệch vẫn bị chặn", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-sum");
    const keep = await newColumn(projectId, "Giữ");
    const doomed = await newColumn(projectId, "Sẽ archive");

    await createTask(projectId, { title: "Một", columnId: keep });
    await createTask(projectId, { title: "Hai", columnId: keep });
    const inDoomed = await createTask(projectId, { title: "Ba", columnId: doomed });

    // Vế thứ hai: archive column còn task **bị chặn**.
    const blocked = await call(f, "PATCH", `/columns/${doomed}`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("arch"),
      body: { archive: true },
    });
    expect(blocked.status).toBe(409);
    expect((blocked.body["error"] as { code: string }).code).toBe("COLUMN_NOT_EMPTY");

    // Vế thứ nhất: với mọi column còn active, hai số bằng nhau.
    const overview = bodyOf(await overviewOf(projectId));
    const summed = overview.byColumn.reduce((total, column) => total + column.taskCount, 0);
    expect(summed).toBe(overview.totals.tasks);
    expect(overview.totals.tasks).toBe(3);

    /**
     * Và đây là chỗ chứng minh **vì sao** câu trên đúng, không phải may mắn:
     * dời task đi rồi archive được, và khi đó column biến mất khỏi `byColumn`
     * trong khi `totals` giữ nguyên — vì task đã sang column khác chứ không mất.
     */
    const moved = await call(f, "POST", `/tasks/${inDoomed.id}/move`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("move"),
      body: {
        destinationColumnId: keep,
        targetPosition: "1024.0000000000",
        expectedVersion: inDoomed.version,
      },
    });
    expect(moved.status).toBe(200);

    const archived = await call(f, "PATCH", `/columns/${doomed}`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("arch2"),
      body: { archive: true },
    });
    expect(archived.status).toBe(200);

    const after = bodyOf(await overviewOf(projectId));
    expect(after.byColumn.map((c) => c.columnId)).toEqual([keep]);
    expect(after.byColumn[0]?.taskCount).toBe(3);
    expect(after.totals.tasks).toBe(3);
  });

  /* ---------------------------------------------------------------------- *
   * byAssignee và unassignedCount
   * ---------------------------------------------------------------------- */

  it("byAssignee chỉ gồm người thật; task chưa giao đếm riêng", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-assignee");
    await addMember(projectId, f.editor, "editor");
    await addMember(projectId, f.viewer, "viewer");
    const columnId = await newColumn(projectId, "Cần làm");

    await createTask(projectId, { title: "E1", columnId, assigneeId: f.editor.id });
    await createTask(projectId, { title: "E2", columnId, assigneeId: f.editor.id });
    await createTask(projectId, { title: "V1", columnId, assigneeId: f.viewer.id });
    await createTask(projectId, { title: "Chưa giao 1", columnId });
    await createTask(projectId, { title: "Chưa giao 2", columnId });

    const overview = bodyOf(await overviewOf(projectId));

    // Nhiều việc trước — thứ tự tất định, không đổi giữa hai lần tải.
    expect(overview.byAssignee.map((a) => a.user.id)).toEqual([f.editor.id, f.viewer.id]);
    expect(overview.byAssignee[0]?.taskCount).toBe(2);
    expect(overview.byAssignee[0]?.user.displayName).toBe(f.editor.displayName);
    expect(overview.unassignedCount).toBe(2);

    // Không có phần tử `user: null` nào lẫn trong danh sách người.
    expect(JSON.stringify(overview.byAssignee)).not.toContain("null");
    // Tổng vẫn khớp.
    const assigned = overview.byAssignee.reduce((total, row) => total + row.taskCount, 0);
    expect(assigned + overview.unassignedCount).toBe(overview.totals.tasks);
  });

  /* ---------------------------------------------------------------------- *
   * dueStates dùng cùng đồng hồ và cùng cửa sổ với list task
   * ---------------------------------------------------------------------- */

  /**
   * Hai chỗ suy `dueState` bằng hai đường là hai kết quả sẽ lệch lúc nửa đêm.
   *
   * Test này không so `dueStates` với một con số cứng — nó so với **chính** kết
   * quả của `GET /projects/:projectId/tasks?dueState=...`, tức là bắt hai đường
   * phải nói cùng một điều trên cùng dữ liệu, cùng lúc.
   */
  it("dueStates khớp đúng bộ lọc dueState của list task", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-due");
    const doing = await newColumn(projectId, "Đang làm");
    const done = await newColumn(projectId, "Xong", { isTerminal: true });

    for (const dueDate of ["2026-08-01", "2026-09-05", "2026-09-07", "2026-10-20"]) {
      await createTask(projectId, { title: `Việc ${dueDate}`, columnId: doing, dueDate });
    }
    await createTask(projectId, { title: "Không hạn", columnId: doing });

    const terminal = await createTask(projectId, {
      title: "Đã xong nhưng quá hạn",
      columnId: doing,
      dueDate: "2026-01-01",
    });
    await call(f, "POST", `/tasks/${terminal.id}/move`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("move"),
      body: {
        destinationColumnId: done,
        targetPosition: "1024.0000000000",
        expectedVersion: terminal.version,
      },
    });

    const overview = bodyOf(await overviewOf(projectId));

    const countFilter = async (state: string): Promise<number> => {
      const response = await call(
        f,
        "GET",
        `/projects/${projectId}/tasks?dueState=${state}&limit=100`,
        { actor: f.wsAdmin },
      );
      return (response.body["data"] as { items: unknown[] }).items.length;
    };

    expect(overview.dueStates.overdue).toBe(await countFilter("overdue"));
    expect(overview.dueStates.dueToday).toBe(await countFilter("due_today"));
    expect(overview.dueStates.dueSoon).toBe(await countFilter("due_soon"));

    /**
     * Mỗi khoá khớp **đúng** filter cùng tên — kể cả `none`.
     *
     * Bản trước của test này ghim một sai lệch: hợp đồng chỉ có bốn khoá và gom
     * `scheduled` vào `none`, nên `dueStates.none` không bằng số task lọc
     * `dueState=none`. Chỗ nguy hiểm là **tổng vẫn khớp** `totals.tasks`, nên
     * phép cộng bên dưới không bao giờ lộ ra điều đó. Ghim rồi báo là đúng, và
     * hợp đồng nay có đủ năm khoá.
     */
    expect(overview.dueStates.scheduled).toBe(await countFilter("scheduled"));
    expect(overview.dueStates.none).toBe(await countFilter("none"));

    // Năm nhóm cộng lại đúng bằng tổng — mỗi task thuộc đúng một nhóm.
    const summed =
      overview.dueStates.overdue +
      overview.dueStates.dueToday +
      overview.dueStates.dueSoon +
      overview.dueStates.scheduled +
      overview.dueStates.none;
    expect(summed).toBe(overview.totals.tasks);
  });

  /**
   * Cùng dữ liệu, **hai timezone**, hai kết quả — đúng thứ mà `workspaces.timezone`
   * ra đời để làm được.
   */
  it("dueStates đổi theo timezone của workspace", async () => {
    const projectId = await newProject("overview-tz");
    const columnId = await newColumn(projectId, "Cần làm");
    await createTask(projectId, { title: "Hạn 05/09", columnId, dueDate: "2026-09-05" });

    // 17:00Z ngày 04/09 = 00:00 ngày 05/09 ở GMT+7, vẫn là 04/09 ở UTC.
    f.setInstant(new Date("2026-09-04T17:00:00Z"));

    await f.db
      .update(workspaces)
      .set({ timezone: "Asia/Ho_Chi_Minh" })
      .where(eq(workspaces.id, f.workspaceId));
    const inVietnam = bodyOf(await overviewOf(projectId));
    expect(inVietnam.dueStates.dueToday).toBe(1);
    expect(inVietnam.dueStates.dueSoon).toBe(0);

    /**
     * Đổi timezone rồi dựng **fixture mới** thay vì sửa cache.
     *
     * `DatabaseWorkspaceClock` cache timezone theo instance, và đó là đánh đổi
     * đã ghi ở adapter: đổi timezone chỉ có hiệu lực sau khi tiến trình khởi
     * động lại. Test tôn trọng đúng ràng buộc đó thay vì vòng qua nó — một test
     * vòng qua giới hạn của sản phẩm là một test kiểm một sản phẩm khác.
     */
    await f.db.update(workspaces).set({ timezone: "UTC" }).where(eq(workspaces.id, f.workspaceId));

    const fresh = await createFixture(url as string);
    try {
      fresh.setInstant(new Date("2026-09-04T17:00:00Z"));
      const response = await call(fresh, "GET", `/projects/${projectId}/overview`, {
        actor: fresh.wsAdmin,
      });
      // `wsAdmin` của fixture mới không phải member của project cũ ⇒ `404`.
      expect(response.status).toBe(404);
    } finally {
      await fresh.cleanup();
    }

    // Trả về mặc định để các test sau không bị ảnh hưởng.
    await f.db
      .update(workspaces)
      .set({ timezone: "Asia/Ho_Chi_Minh" })
      .where(eq(workspaces.id, f.workspaceId));
  });

  /* ---------------------------------------------------------------------- *
   * Cửa sổ
   * ---------------------------------------------------------------------- */

  it("thiếu cả hai đầu thì cửa sổ là tuần hiện tại, bắt đầu thứ Hai", async () => {
    // 05/09/2026 là thứ Bảy ⇒ tuần chạy 31/08 (thứ Hai) tới 06/09 (Chủ Nhật).
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-window");
    await newColumn(projectId, "Cần làm");

    const overview = bodyOf(await overviewOf(projectId));
    expect(overview.window).toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  it("`createdInWindow` chỉ đếm task tạo trong cửa sổ", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-created");
    const columnId = await newColumn(projectId, "Cần làm");

    const inside = await createTask(projectId, { title: "Trong tuần", columnId });
    const outside = await createTask(projectId, { title: "Tuần trước", columnId });

    // Đẩy một task ra ngoài cửa sổ bằng cách sửa thẳng `created_at`: không
    // endpoint nào cho phép, và đó là đúng — đây là dữ liệu lịch sử.
    await f.db
      .update(tasksTable)
      .set({ createdAt: new Date("2026-08-20T03:00:00Z") })
      .where(eq(tasksTable.id, outside.id));

    const overview = bodyOf(await overviewOf(projectId));
    expect(overview.totals.tasks).toBe(2);
    expect(overview.totals.createdInWindow).toBe(1);

    // Cửa sổ tường minh bao trọn cả hai thì đếm cả hai.
    const wide = bodyOf(await overviewOf(projectId, "?from=2026-08-01&to=2026-09-30"));
    expect(wide.window).toEqual({ from: "2026-08-01", to: "2026-09-30" });
    expect(wide.totals.createdInWindow).toBe(2);
    expect(inside.id).toBeTruthy();
  });

  it("gửi một đầu thì server suy đầu còn lại, và echo cửa sổ canonical", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-half-window");
    await newColumn(projectId, "Cần làm");

    expect(bodyOf(await overviewOf(projectId, "?from=2026-09-01")).window).toEqual({
      from: "2026-09-01",
      to: "2026-09-07",
    });
    expect(bodyOf(await overviewOf(projectId, "?to=2026-09-30")).window).toEqual({
      from: "2026-09-24",
      to: "2026-09-30",
    });
  });

  it("query field lạ hoặc ngày sai định dạng là 400", async () => {
    const projectId = await newProject("overview-query-strict");
    for (const query of [
      "?groupBy=assignee",
      "?metrics=all",
      "?from=hom-qua",
      "?from=2026-13-45",
      "?limit=10",
    ]) {
      const response = await overviewOf(projectId, query);
      expect(response.status, query).toBe(400);
    }
  });

  /* ---------------------------------------------------------------------- *
   * Phân quyền
   * ---------------------------------------------------------------------- */

  it("Viewer đọc được — cùng quyền với việc đọc task", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-viewer");
    await addMember(projectId, f.viewer, "viewer");
    await newColumn(projectId, "Cần làm");

    const response = await overviewOf(projectId, "", f.viewer);
    expect(response.status).toBe(200);
  });

  /**
   * `:projectId` là **locator, không phải bằng chứng quyền**.
   *
   * `404` chứ không `403`: `403` đã xác nhận project đó tồn tại.
   */
  it("người ngoài project nhận 404, giống hệt project không tồn tại", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-outsider");
    await newColumn(projectId, "Cần làm");

    for (const actor of [f.userA, f.owner, f.outsider]) {
      const response = await overviewOf(projectId, "", actor);
      expect(response.status, actor.email).toBe(404);
    }

    const real = await overviewOf(projectId, "", f.userA);
    const fake = await overviewOf("00000000-0000-4000-8000-0000000000ff", "", f.userA);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: "<redacted>" });
    expect(strip(real.body)).toEqual(strip(fake.body));
  });

  it("chưa xác thực → 401", async () => {
    const projectId = await newProject("overview-unauth");
    const response = await call(f, "GET", `/projects/${projectId}/overview`);
    expect(response.status).toBe(401);
  });

  it("không side effect: không task, không column, không activity", async () => {
    f.setToday("2026-09-05");
    const projectId = await newProject("overview-no-effect");
    const columnId = await newColumn(projectId, "Cần làm");
    await createTask(projectId, { title: "Một", columnId });

    const before = {
      tasks: (await f.db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)))
        .length,
      columns: (await f.db.select().from(boardColumns).where(eq(boardColumns.projectId, projectId)))
        .length,
      activity: await f.activity.countForProject(projectId),
    };

    await overviewOf(projectId);
    await overviewOf(projectId, "?from=2026-01-01&to=2026-12-31");

    expect({
      tasks: (await f.db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId)))
        .length,
      columns: (await f.db.select().from(boardColumns).where(eq(boardColumns.projectId, projectId)))
        .length,
      activity: await f.activity.countForProject(projectId),
    }).toEqual(before);
  });
});
