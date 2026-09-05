import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listEnvelopeSchema,
  taskSchema,
  workspaceTaskProjectRefSchema,
} from "@flowboard/contracts";
import { z } from "zod";
import { call, createFixture, newKey, type Fixture, type TestActor } from "./fixture.ts";

/**
 * `GET /workspaces/:workspaceId/tasks` — task cấp workspace cho `MYT-01`.
 *
 * Hai điều làm endpoint này khác hẳn list cấp project, và cả hai đều là chỗ một
 * bản hiện thực chạy được vẫn có thể sai:
 *
 * 1. **Phạm vi là giao của hai điều kiện.** Bỏ vế thứ hai — membership project —
 *    thì truy vấn vẫn chạy, vẫn trả dữ liệu, và rò task của project riêng tư.
 * 2. **Một cursor cho cả workspace.** Fan-out qua từng project cho N trang đầu
 *    độc lập, và phần đầu của danh sách gộp lại có thể sai.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

interface TaskBody {
  id: string;
  projectId: string;
  title: string;
  dueDate: string | null;
  dueState: string;
}

describeIfDb("task cấp workspace", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
    f.setToday("2026-09-05");
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

  async function addMember(projectId: string, actor: TestActor, role = "editor"): Promise<void> {
    const response = await call(f, "POST", `/projects/${projectId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("member"),
      body: { userId: actor.id, role },
    });
    expect(response.status).toBe(201);
  }

  async function removeMember(projectId: string, actor: TestActor): Promise<void> {
    const response = await call(f, "DELETE", `/projects/${projectId}/members/${actor.id}`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("unmember"),
    });
    expect(response.status).toBe(204);
  }

  async function newColumn(projectId: string, name = "Cần làm"): Promise<string> {
    const response = await call(f, "POST", `/projects/${projectId}/columns`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("col"),
      body: { name, afterColumnId: null },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { column: { id: string } }).column.id;
  }

  async function createTask(
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const response = await call(f, "POST", `/projects/${projectId}/tasks`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("task"),
      body: { description: null, ...body },
    });
    expect(response.status).toBe(201);
    return (response.body["data"] as { task: { id: string } }).task;
  }

  async function listWorkspaceTasks(query = "", actor: TestActor = f.wsAdmin) {
    return await call(f, "GET", `/workspaces/${f.workspaceId}/tasks${query}`, { actor });
  }

  function itemsOf(response: { body: Record<string, unknown> }): TaskBody[] {
    return (response.body["data"] as { items: TaskBody[] }).items;
  }

  function projectsOf(response: { body: Record<string, unknown> }): { id: string; name: string }[] {
    return (response.body["data"] as { projects: { id: string; name: string }[] }).projects;
  }

  function pageOf(response: { body: Record<string, unknown> }): {
    nextCursor: string | null;
    hasMore: boolean;
  } {
    return (response.body["data"] as { page: { nextCursor: string | null; hasMore: boolean } })
      .page;
  }

  /* ---------------------------------------------------------------------- *
   * Hình dạng
   * ---------------------------------------------------------------------- */

  it("trả 200 với `items`, `projects` và `page`, khớp hợp đồng từng phần", async () => {
    const projectId = await newProject("ws-shape");
    await addMember(projectId, f.editor);
    const columnId = await newColumn(projectId);
    await createTask(projectId, { title: "Việc của tôi", columnId, assigneeId: f.editor.id });

    const response = await listWorkspaceTasks("", f.editor);

    expect(response.status).toBe(200);
    const data = response.body["data"] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["items", "page", "projects"]);
    expect(() => z.array(taskSchema).parse(data["items"])).not.toThrow();
    expect(() => z.array(workspaceTaskProjectRefSchema).parse(data["projects"])).not.toThrow();
    // `items` cũng phải parse được bằng chính schema của list envelope.
    expect(() =>
      listEnvelopeSchema(taskSchema).parse({
        data: { items: data["items"], page: data["page"] },
        requestId: response.body["requestId"],
      }),
    ).not.toThrow();
  });

  /**
   * `projects` là **bảng tra cứu**, chỉ chứa project xuất hiện trong `items` của
   * trang này — không phải mọi project mà actor thấy được.
   */
  it("`projects` chỉ chứa project của đúng trang này", async () => {
    const a = await newProject("ws-ref-a");
    const b = await newProject("ws-ref-b");
    await addMember(a, f.editor);
    await addMember(b, f.editor);
    const columnA = await newColumn(a);
    const columnB = await newColumn(b);

    await createTask(a, { title: "A1", columnId: columnA });
    await createTask(b, { title: "B1", columnId: columnB });

    const full = await listWorkspaceTasks("?limit=100", f.editor);
    const ids = new Set(itemsOf(full).map((t) => t.projectId));
    expect(
      projectsOf(full)
        .map((p) => p.id)
        .sort(),
    ).toEqual([...ids].sort());

    // Một trang chỉ chứa một task ⇒ bảng tra cứu chỉ có một project.
    const single = await listWorkspaceTasks("?limit=1", f.editor);
    expect(itemsOf(single)).toHaveLength(1);
    expect(projectsOf(single)).toHaveLength(1);
    expect(projectsOf(single)[0]?.id).toBe(itemsOf(single)[0]?.projectId);
  });

  /* ---------------------------------------------------------------------- *
   * Phạm vi — **hai vế**
   * ---------------------------------------------------------------------- */

  /**
   * Vế thứ nhất: task của project ở **workspace khác** không lọt.
   *
   * Đây là vế dễ; nó hỏng ngay cả với một bản hiện thực cẩu thả.
   */
  it("vế 1 — task của workspace khác không lọt", async () => {
    const mine = await newProject("ws-scope-mine");
    await addMember(mine, f.editor);
    await createTask(mine, { title: "Trong workspace", columnId: await newColumn(mine) });

    // Một workspace hoàn toàn khác, do chính `editor` tạo nên họ là admin ở đó.
    const created = await call(f, "POST", "/workspaces", {
      actor: f.editor,
      idempotencyKey: newKey("other-ws"),
      body: { name: `Workspace khác ${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(created.status).toBe(201);
    const otherWorkspaceId = (created.body["data"] as { workspace: { id: string } }).workspace.id;

    const otherProject = await call(f, "POST", `/workspaces/${otherWorkspaceId}/projects`, {
      actor: f.editor,
      idempotencyKey: newKey("other-project"),
      body: { name: "Project bên kia" },
    });
    const otherProjectId = (otherProject.body["data"] as { project: { id: string } }).project.id;

    const otherColumn = await call(f, "POST", `/projects/${otherProjectId}/columns`, {
      actor: f.editor,
      idempotencyKey: newKey("other-col"),
      body: { name: "Cần làm", afterColumnId: null },
    });
    const otherColumnId = (otherColumn.body["data"] as { column: { id: string } }).column.id;

    const outside = await call(f, "POST", `/projects/${otherProjectId}/tasks`, {
      actor: f.editor,
      idempotencyKey: newKey("other-task"),
      body: { title: "Ngoài workspace", columnId: otherColumnId, description: null },
    });
    const outsideId = (outside.body["data"] as { task: { id: string } }).task.id;

    const listed = itemsOf(await listWorkspaceTasks("?limit=100", f.editor));

    expect(listed.map((t) => t.id)).not.toContain(outsideId);
    expect(listed.every((t) => t.projectId !== otherProjectId)).toBe(true);
  });

  /**
   * Vế thứ hai: task của project **cùng workspace** mà actor **không** là member
   * cũng không lọt.
   *
   * Đây là vế dễ quên, và nó là vế nguy hiểm: một truy vấn chỉ lọc theo
   * `workspace_id` vẫn chạy, vẫn trả dữ liệu, và rò toàn bộ task của mọi project
   * riêng tư trong workspace — kể cả cho một Workspace Admin chưa được thêm vào
   * project nào.
   */
  it("vế 2 — task của project cùng workspace mà actor KHÔNG là member cũng không lọt", async () => {
    const mine = await newProject("ws-scope-member-mine");
    const theirs = await newProject("ws-scope-member-theirs");

    await addMember(mine, f.editor);
    // `editor` **không** được thêm vào `theirs`.
    await addMember(theirs, f.viewer, "viewer");

    const mineTask = await createTask(mine, {
      title: "Của tôi",
      columnId: await newColumn(mine),
    });
    const theirTask = await createTask(theirs, {
      title: "Của người khác",
      columnId: await newColumn(theirs),
    });

    const listed = itemsOf(await listWorkspaceTasks("?limit=100", f.editor));

    expect(listed.map((t) => t.id)).toContain(mineTask.id);
    expect(listed.map((t) => t.id)).not.toContain(theirTask.id);
    expect(listed.every((t) => t.projectId !== theirs)).toBe(true);
    // Và bảng tra cứu cũng không lộ **tên** project mà họ không thấy được.
    expect(
      projectsOf(await listWorkspaceTasks("?limit=100", f.editor)).map((p) => p.id),
    ).not.toContain(theirs);
  });

  /**
   * Workspace Admin **không** có đặc quyền ở đây.
   *
   * Cùng luật với `GET /workspaces/:workspaceId/projects` của M2: quyền quản trị
   * workspace không hàm ý bất kỳ entry nào trong catalog của project.
   */
  it("Workspace Admin không có membership project nhận trang rỗng, không phải task người khác", async () => {
    const fresh = await createFixture(url as string);
    try {
      fresh.setToday("2026-09-05");

      // `owner` tạo project riêng trong workspace của fixture mới, `wsAdmin`
      // không được thêm vào.
      const created = await call(fresh, "POST", `/workspaces/${fresh.workspaceId}/projects`, {
        actor: fresh.wsAdmin,
        idempotencyKey: newKey("admin-proj"),
        body: { name: "Riêng tư" },
      });
      const projectId = (created.body["data"] as { project: { id: string } }).project.id;
      const column = await call(fresh, "POST", `/projects/${projectId}/columns`, {
        actor: fresh.wsAdmin,
        idempotencyKey: newKey("col"),
        body: { name: "Cần làm", afterColumnId: null },
      });
      const columnId = (column.body["data"] as { column: { id: string } }).column.id;
      await call(fresh, "POST", `/projects/${projectId}/tasks`, {
        actor: fresh.wsAdmin,
        idempotencyKey: newKey("task"),
        body: { title: "Việc riêng", columnId, description: null },
      });

      // `owner` là member workspace nhưng **không** có membership ở project này.
      const response = await call(fresh, "GET", `/workspaces/${fresh.workspaceId}/tasks`, {
        actor: fresh.owner,
      });
      expect(response.status).toBe(200);
      expect((response.body["data"] as { items: unknown[] }).items).toEqual([]);
      expect((response.body["data"] as { projects: unknown[] }).projects).toEqual([]);
    } finally {
      await fresh.cleanup();
    }
  });

  it("người ngoài workspace nhận 404", async () => {
    const response = await listWorkspaceTasks("", f.outsider);
    expect(response.status).toBe(404);
  });

  it("chưa xác thực → 401", async () => {
    const response = await call(f, "GET", `/workspaces/${f.workspaceId}/tasks`);
    expect(response.status).toBe(401);
  });

  /* ---------------------------------------------------------------------- *
   * Một cursor, thứ tự đúng qua nhiều project
   * ---------------------------------------------------------------------- */

  /**
   * Đây là chính thứ fan-out **không** làm được.
   *
   * Ba project, due date xen kẽ nhau. Fan-out sẽ lấy trang đầu của mỗi project
   * rồi gộp, và phần đầu của danh sách gộp có thể thiếu một task hạn sớm nằm ở
   * trang hai của project khác. Một cursor duy nhất trên toàn workspace thì
   * không có chỗ nào để sai.
   */
  it("một cursor: phân trang qua nhiều project vẫn đúng thứ tự tổng thể", async () => {
    const projectIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await newProject(`ws-cursor-${String(i)}`);
      await addMember(id, f.userB);
      projectIds.push(id);
    }
    const columns = await Promise.all(projectIds.map(async (id) => await newColumn(id)));

    /**
     * Due date **xen kẽ** giữa ba project: task hạn sớm nhất, thứ hai và thứ ba
     * nằm ở ba project khác nhau. Gieo tất cả vào một project sẽ làm fan-out
     * trông đúng, và test khi ấy không kiểm được gì.
     */
    const expected: string[] = [];
    for (let day = 1; day <= 9; day++) {
      const index = (day - 1) % 3;
      const task = await createTask(projectIds[index] as string, {
        title: `Hạn ngày ${String(day)}`,
        columnId: columns[index] as string,
        dueDate: `2026-09-${String(day).padStart(2, "0")}`,
      });
      expected.push(task.id);
    }

    const full = itemsOf(await listWorkspaceTasks("?sort=dueDate:asc&limit=100", f.userB));
    expect(full.map((t) => t.id)).toEqual(expected);

    // Phân trang từng trang 2 phải cho **đúng** cùng dãy đó.
    const paged: string[] = [];
    const seenProjects = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const query: string = `?sort=dueDate:asc&limit=2${
        cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`
      }`;
      const response = await listWorkspaceTasks(query, f.userB);
      expect(response.status).toBe(200);

      const items = itemsOf(response);
      paged.push(...items.map((t) => t.id));
      for (const item of items) seenProjects.add(item.projectId);

      // Bảng tra cứu của **trang này**, không phải của cả workspace.
      const refs = projectsOf(response)
        .map((p) => p.id)
        .sort();
      expect(refs).toEqual([...new Set(items.map((t) => t.projectId))].sort());

      cursor = pageOf(response).nextCursor;
      if (cursor === null) break;
    }

    expect(paged).toEqual(expected);
    // Và nó thật sự cắt ngang cả ba project — nếu không, test trên không kiểm gì.
    expect(seenProjects.size).toBe(3);
  });

  /* ---------------------------------------------------------------------- *
   * Cursor chết khi phạm vi hoặc filter đổi
   * ---------------------------------------------------------------------- */

  /**
   * **Gỡ actor khỏi một project giữa hai trang ⇒ cursor cũ chết bằng `400`.**
   *
   * Hợp đồng nói cursor bind cả phạm vi actor nhìn thấy được: membership đổi thì
   * cursor cũ không còn mô tả cùng một tập, và trả tiếp trên nó sẽ hoặc bỏ sót
   * hoặc lặp. Đây là điều mà bind-theo-filter một mình **không** bắt được.
   */
  it("cursor chết khi actor bị gỡ khỏi một project giữa hai trang", async () => {
    const stay = await newProject("ws-scope-stay");
    const leave = await newProject("ws-scope-leave");
    await addMember(stay, f.viewer, "viewer");
    await addMember(leave, f.viewer, "viewer");

    const stayColumn = await newColumn(stay);
    const leaveColumn = await newColumn(leave);
    for (let i = 0; i < 3; i++) {
      await createTask(stay, { title: `S${String(i)}`, columnId: stayColumn });
      await createTask(leave, { title: `L${String(i)}`, columnId: leaveColumn });
    }

    const first = await listWorkspaceTasks("?limit=2", f.viewer);
    expect(first.status).toBe(200);
    const cursor = pageOf(first).nextCursor as string;
    expect(cursor).toBeTruthy();

    // Cùng cursor, chưa đổi gì: vẫn dùng được.
    const stillValid = await listWorkspaceTasks(
      `?limit=2&cursor=${encodeURIComponent(cursor)}`,
      f.viewer,
    );
    expect(stillValid.status).toBe(200);

    // Gỡ khỏi một project ⇒ phạm vi đổi ⇒ cursor cũ chết.
    await removeMember(leave, f.viewer);

    const afterChange = await listWorkspaceTasks(
      `?limit=2&cursor=${encodeURIComponent(cursor)}`,
      f.viewer,
    );
    expect(afterChange.status).toBe(400);
    expect((afterChange.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");

    /**
     * Và trang đầu mới **không còn** task của project vừa bị gỡ.
     *
     * Khẳng định "chỉ còn task của `stay`" sẽ sai vì một lý do không liên quan:
     * fixture dùng chung, nên `viewer` còn là thành viên của những project mà
     * test khác trong file này đã tạo. Điều đúng để kiểm là **project bị gỡ biến
     * mất**, không phải "chỉ còn đúng một project".
     */
    const fresh = itemsOf(await listWorkspaceTasks("?limit=100", f.viewer));
    expect(fresh.some((t) => t.projectId === leave)).toBe(false);
    expect(fresh.some((t) => t.projectId === stay)).toBe(true);
  });

  /**
   * **Đổi phạm vi mà giữ nguyên số lượng project** cũng phải giết cursor.
   *
   * Test này ra đời vì một thí nghiệm thất bại: khi cursor bind theo *số lượng*
   * project thay vì *nội dung* phạm vi, cả bộ test vẫn xanh — vì mọi test khác
   * đều gỡ một project, và số lượng đổi theo. Mất một project rồi được thêm một
   * project khác giữ nguyên con số nhưng đổi hẳn tập kết quả, và đó chính là
   * trường hợp mà bind-theo-số-lượng bỏ lọt.
   */
  it("cursor chết khi phạm vi đổi mà số lượng project không đổi", async () => {
    const stay = await newProject("ws-swap-stay");
    const out = await newProject("ws-swap-out");
    const into = await newProject("ws-swap-into");

    await addMember(stay, f.userB, "viewer");
    await addMember(out, f.userB, "viewer");
    // `into` chưa có `userB`.

    for (const [project, prefix] of [
      [stay, "S"],
      [out, "O"],
      [into, "I"],
    ] as const) {
      const columnId = await newColumn(project);
      for (let i = 0; i < 2; i++) {
        await createTask(project, { title: `${prefix}${String(i)}`, columnId });
      }
    }

    const first = await listWorkspaceTasks("?limit=1", f.userB);
    expect(first.status).toBe(200);
    const cursor = encodeURIComponent(pageOf(first).nextCursor as string);
    const before = await listWorkspaceTasks("?limit=100", f.userB);
    const countBefore = new Set(itemsOf(before).map((t) => t.projectId)).size;

    // Hoán đổi: rời `out`, vào `into`. **Số lượng project không đổi.**
    await removeMember(out, f.userB);
    await addMember(into, f.userB, "viewer");

    const after = await listWorkspaceTasks("?limit=100", f.userB);
    expect(new Set(itemsOf(after).map((t) => t.projectId)).size).toBe(countBefore);
    // Nhưng **tập** thì đổi hẳn.
    expect(itemsOf(after).some((t) => t.projectId === into)).toBe(true);
    expect(itemsOf(after).some((t) => t.projectId === out)).toBe(false);

    const reused = await listWorkspaceTasks(`?limit=1&cursor=${cursor}`, f.userB);
    expect(reused.status).toBe(400);
    expect((reused.body["error"] as { code: string }).code).toBe("VALIDATION_FAILED");
  });

  it("cursor chết khi bất kỳ filter hoặc sort nào đổi", async () => {
    const projectId = await newProject("ws-cursor-filter");
    await addMember(projectId, f.userA);
    const columnId = await newColumn(projectId);
    for (let i = 0; i < 4; i++) {
      await createTask(projectId, {
        title: `Việc ${String(i)}`,
        columnId,
        priority: i % 2 === 0 ? "high" : "low",
        category: i % 2 === 0 ? "bug" : "feature",
        dueDate: `2026-09-0${String(i + 1)}`,
      });
    }

    const base = "?priority=high&limit=1";
    const first = await listWorkspaceTasks(base, f.userA);
    const cursor = encodeURIComponent(pageOf(first).nextCursor as string);

    const changed: [string, string][] = [
      ["đổi priority", `?priority=low&limit=1&cursor=${cursor}`],
      ["bỏ filter", `?limit=1&cursor=${cursor}`],
      ["thêm category", `?priority=high&category=bug&limit=1&cursor=${cursor}`],
      ["đổi sort", `?priority=high&sort=dueDate:asc&limit=1&cursor=${cursor}`],
      ["thêm search", `?priority=high&search=viec&limit=1&cursor=${cursor}`],
    ];

    for (const [label, query] of changed) {
      const response = await listWorkspaceTasks(query, f.userA);
      expect(response.status, label).toBe(400);
    }

    // Cùng filter thì vẫn dùng được — nếu không, test trên chỉ chứng minh rằng
    // mọi cursor đều chết.
    expect((await listWorkspaceTasks(`${base}&cursor=${cursor}`, f.userA)).status).toBe(200);
  });

  /* ---------------------------------------------------------------------- *
   * Allowlist query
   * ---------------------------------------------------------------------- */

  it("`columnId` và `sort=position:*` bị từ chối ở phạm vi workspace", async () => {
    const projectId = await newProject("ws-query");
    await addMember(projectId, f.userA);
    const columnId = await newColumn(projectId);

    expect((await listWorkspaceTasks(`?columnId=${columnId}`, f.userA)).status).toBe(400);
    expect((await listWorkspaceTasks("?sort=position:asc", f.userA)).status).toBe(400);
    expect((await listWorkspaceTasks("?sort=position:desc", f.userA)).status).toBe(400);
    // Field lạ cũng vậy.
    expect((await listWorkspaceTasks("?projectId=" + projectId, f.userA)).status).toBe(400);
  });

  it("mọi filter còn lại trong allowlist đều thu hẹp đúng", async () => {
    const projectId = await newProject("ws-filters");
    await addMember(projectId, f.userA);
    await addMember(projectId, f.editor);
    const columnId = await newColumn(projectId);

    const target = await createTask(projectId, {
      title: "Thiết kế lại bảng",
      columnId,
      assigneeId: f.editor.id,
      category: "design",
      priority: "urgent",
      dueDate: "2026-09-20",
    });
    await createTask(projectId, { title: "Việc khác", columnId, priority: "low" });

    const cases: [string, boolean][] = [
      [`?assigneeId=${f.editor.id}`, true],
      ["?category=design", true],
      ["?priority=urgent", true],
      ["?dueFrom=2026-09-15&dueTo=2026-09-25", true],
      ["?search=thiet%20ke", true],
      ["?priority=low", false],
      ["?category=bug", false],
    ];

    for (const [query, shouldContain] of cases) {
      const ids = itemsOf(await listWorkspaceTasks(`${query}&limit=100`, f.userA)).map((t) => t.id);
      expect(ids.includes(target.id), query).toBe(shouldContain);
    }
  });

  it("`dueState` dùng cùng đồng hồ workspace với list cấp project", async () => {
    const projectId = await newProject("ws-due");
    await addMember(projectId, f.userA);
    const columnId = await newColumn(projectId);
    await createTask(projectId, { title: "Quá hạn", columnId, dueDate: "2026-08-01" });
    await createTask(projectId, { title: "Hôm nay", columnId, dueDate: "2026-09-05" });

    /**
     * So **cùng một project** ở hai phạm vi.
     *
     * Danh sách cấp workspace còn chứa task của mọi project khác mà `userA` là
     * thành viên, nên phép so phải lọc về đúng project đang kiểm — nếu không,
     * test đo trạng thái tích luỹ của fixture chứ không đo hai đường suy
     * `dueState`.
     */
    const workspaceScoped = itemsOf(
      await listWorkspaceTasks("?dueState=overdue&limit=100", f.userA),
    ).filter((t) => t.projectId === projectId);

    const projectScoped = (
      (
        await call(f, "GET", `/projects/${projectId}/tasks?dueState=overdue&limit=100`, {
          actor: f.userA,
        })
      ).body["data"] as { items: TaskBody[] }
    ).items;

    expect(workspaceScoped.map((t) => t.id)).toEqual(projectScoped.map((t) => t.id));
    expect(workspaceScoped).toHaveLength(1);
  });

  it("không side effect: không activity nào được ghi", async () => {
    const projectId = await newProject("ws-no-effect");
    await addMember(projectId, f.userA);
    const columnId = await newColumn(projectId);
    await createTask(projectId, { title: "Việc", columnId });

    const before = await f.activity.countForProject(projectId);
    await listWorkspaceTasks("?limit=100", f.userA);
    await listWorkspaceTasks("?search=viec", f.userA);
    expect(await f.activity.countForProject(projectId)).toBe(before);
  });
});
