import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../shared/database/client.ts";

/**
 * Kiểm chứng index bằng `EXPLAIN (ANALYZE, BUFFERS)` trên dữ liệu có phân bố
 * đại diện — `docs/data/query-and-index-policy.md`:
 *
 * > "Xác minh plan dùng index phù hợp hoặc document lý do planner chọn cách
 * > khác; **không chấp nhận index chỉ vì migration tạo thành công**."
 *
 * ## Vì sao là test chứ không phải một script chạy tay
 *
 * M2 kiểm bằng một script `psql` mà người ta phải nhớ chạy. Một phép kiểm phải
 * nhớ mới chạy là một phép kiểm sẽ không chạy — và index thoái hoá âm thầm:
 * thêm một cột vào `ORDER BY`, đổi một hướng sort, và plan tụt về seq scan mà
 * không gì đỏ. Ở đây nó là một test, nên nó chạy mỗi lần.
 *
 * ## Vì sao phải seed nhiều dữ liệu
 *
 * Trên một bảng vài chục dòng, PostgreSQL **luôn** chọn seq scan và phép đo
 * không nói lên điều gì. Toàn bộ seed nằm trong **một transaction rồi
 * ROLLBACK**: nó không để lại dữ liệu và chạy lại được bao nhiêu lần cũng được.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

/** Một dòng của bảng kết quả — cũng chính là bảng đưa vào báo cáo. */
interface PlanCheck {
  name: string;
  /** Index phải xuất hiện trong plan. `null` nghĩa là cố ý chấp nhận sort. */
  expectedIndex: string | null;
  plan: string;
}

const checks: PlanCheck[] = [];

/**
 * Bảng EXPLAIN được ghi ra đây sau mỗi lượt chạy, để đưa vào báo cáo mốc.
 *
 * Tên không mang số mốc: file này đã phủ cả truy vấn của M4 lẫn truy vấn cắt
 * ngang workspace của M5, và một cái tên gắn số mốc sẽ sai ngay ở mốc sau.
 */
const EXPLAIN_TABLE_PATH = "explain.generated.md";

describeIfDb("EXPLAIN — index của M4 thật sự được dùng", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    // Pool 1: mọi thứ chạy trong **một** transaction để rollback được trọn vẹn.
    handle = createDatabase(url as string, { max: 1 });
  });

  afterAll(async () => {
    await handle.close();

    /**
     * Ghi bảng ra **file** thay vì `console.log`.
     *
     * Vitest gom stdout của `afterAll` lại và thường nuốt nó, nên một bảng in
     * ra console là một bảng không ai đọc được. File thì luôn ở đó, và nó là
     * thứ đưa thẳng vào báo cáo mốc.
     */
    const rows = checks.map((check) => {
      const node = firstScanNode(check.plan);
      return `| ${check.name} | ${check.expectedIndex ?? "(chấp nhận sort)"} | ${node} |`;
    });
    const header = ["| Truy vấn | Index mong đợi | Node đầu tiên trong plan |", "|---|---|---|"];
    const fs = await import("node:fs");
    const NEWLINE = String.fromCharCode(10);
    fs.writeFileSync(EXPLAIN_TABLE_PATH, [...header, ...rows].join(NEWLINE) + NEWLINE, "utf8");
  });

  /** Dòng scan đầu tiên của plan — đủ để nói "index hay seq". */
  function firstScanNode(plan: string): string {
    const line = plan
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /Scan/.test(l));
    return (line ?? plan.split("\n")[0] ?? "").replace(/\s+\(cost.*$/, "").slice(0, 90);
  }

  /**
   * Chạy toàn bộ phép đo trong **một** transaction rồi rollback.
   *
   * Drizzle không có API "mở transaction rồi giữ", nên seed + đo + khẳng định
   * nằm trong một callback, và cuối callback ném ra để rollback.
   */
  it("mọi truy vấn có index đều dùng index, không seq scan", async () => {
    const ROLLBACK = "explain-rollback";

    const outcome = await handle.db
      .transaction(async (tx) => {
        /* ---------------- Seed: một project lớn, phân bố lệch --------------- */

        await tx.execute(sql`
          insert into users (id, email, display_name, password_hash, email_verified_at)
          select gen_random_uuid(), 'explain-m4-' || i || '@example.test', 'Nguoi dung ' || i,
                 '$argon2id$v=19$m=19456,t=2,p=1$explainseed$explainseedexplainseedexplainseed', now()
          from generate_series(1, 40) as i`);

        await tx.execute(sql`
          insert into workspaces (id, name) values (gen_random_uuid(), 'Explain M4 workspace')`);

        await tx.execute(sql`
          insert into workspace_members (workspace_id, user_id, role)
          select w.id, u.id, 'workspace_member'
          from workspaces w cross join users u
          where w.name = 'Explain M4 workspace' and u.email like 'explain-m4-%'`);

        await tx.execute(sql`
          insert into projects (id, workspace_id, created_by_user_id, name)
          select gen_random_uuid(), w.id, (select id from users where email = 'explain-m4-1@example.test'),
                 'Explain M4 project ' || p
          from workspaces w cross join generate_series(1, 5) as p
          where w.name = 'Explain M4 workspace'`);

        await tx.execute(sql`
          insert into project_members (project_id, user_id, role)
          select p.id, u.id, 'editor'
          from projects p cross join users u
          where p.name like 'Explain M4 project %' and u.email like 'explain-m4-%'`);

        /**
         * Một actor **hẹp**: thành viên của đúng **một** project trong năm.
         *
         * Mọi user khác của seed thuộc tất cả project, và với một actor như thế
         * thì truy vấn cấp workspace đọc gần như cả bảng — ở tỉ lệ đó `Seq Scan`
         * thật sự **là** plan rẻ hơn, và phép đo không nói gì về index. Hình
         * dạng thật của `MYT-01` là ngược lại: một người tham gia vài project
         * trong một workspace có nhiều project.
         *
         * Đây là bài học đã lặp lại lần thứ ba trong file này: phép đo phải đo
         * hình dạng của sản phẩm, không phải hình dạng của seed.
         */
        await tx.execute(sql`
          insert into users (id, email, display_name, password_hash, email_verified_at)
          values (gen_random_uuid(), 'explain-m4-narrow@example.test', 'Nguoi dung hep',
                  '$argon2id$v=19$m=19456,t=2,p=1$explainseed$explainseedexplainseedexplainseed', now())`);

        await tx.execute(sql`
          insert into workspace_members (workspace_id, user_id, role)
          select w.id, u.id, 'workspace_member'
          from workspaces w cross join users u
          where w.name = 'Explain M4 workspace' and u.email = 'explain-m4-narrow@example.test'`);

        await tx.execute(sql`
          insert into project_members (project_id, user_id, role)
          select p.id, u.id, 'viewer'
          from projects p cross join users u
          where p.name = 'Explain M4 project 1' and u.email = 'explain-m4-narrow@example.test'`);

        await tx.execute(sql`
          insert into board_columns (id, project_id, name, position, is_terminal)
          select gen_random_uuid(), p.id, 'Cot ' || c, (c * 1024)::numeric(20,10), c = 5
          from projects p cross join generate_series(1, 5) as c
          where p.name like 'Explain M4 project %'`);

        /**
         * 12.500 task trên **5** project — đủ để planner có lựa chọn, và đủ nhỏ
         * để transaction seed không giữ tài nguyên lâu.
         *
         * Hai con số đều quan trọng, và cái thứ hai đã học được bằng cách sai:
         *
         * - **Tổng số dòng** từng là 25.000. Một lượt chạy đầy đủ đỏ đúng một
         *   lần vì tranh tài nguyên với các file chạy song song, và một bộ test
         *   đỏ ngẫu nhiên là tín hiệu sai — tệ hơn một phép đo chậm.
         * - **Số project** phải giữ ở 5. Rút xuống 3 làm project được đo chiếm
         *   33% bảng, và ở tỉ lệ đó `Seq Scan` thật sự **là** plan rẻ hơn —
         *   phép đo khi ấy không còn nói gì về index. Một workspace thật có
         *   nhiều project, nên 20% mới là hình dạng đúng để đo.
         *
         * Phân bố cố ý lệch: một project giữ phần lớn task, và trong project đó
         * một assignee giữ phần lớn việc. Dữ liệu đều tay là dữ liệu dễ, và
         * index nào cũng trông tốt trên dữ liệu dễ.
         */
        await tx.execute(sql`
          insert into tasks (
            id, project_id, column_id, created_by_user_id, assignee_id, reviewer_id,
            title, description, category, priority, position, due_date, created_at, updated_at
          )
          select
            gen_random_uuid(),
            c.project_id,
            c.id,
            (select id from users where email = 'explain-m4-1@example.test'),
            case when i % 3 = 0 then m.user_id else null end,
            case when i % 7 = 0 then r.user_id else null end,
            case when i % 200 = 0 then 'Thiết kế lại bảng công việc ' || i
                 else 'Cong viec so ' || i end,
            'Mo ta cua cong viec ' || i || ' can ra soat bao mat',
            (array['feature','bug','design','research','operations','other'])[1 + (i % 6)],
            (array['none','low','medium','high','urgent'])[1 + (i % 5)],
            (i * 1024)::numeric(20,10),
            case when i % 4 = 0 then current_date + ((i % 60) - 30) else null end,
            now() - (i || ' seconds')::interval,
            now() - (i || ' seconds')::interval
          from board_columns c
          cross join generate_series(1, 500) as i
          cross join lateral (
            select user_id from project_members
            where project_id = c.project_id
            order by case when i % 5 = 0 then user_id::text else '' end
            limit 1
          ) m
          cross join lateral (
            select user_id from project_members
            where project_id = c.project_id and user_id <> m.user_id
            limit 1
          ) r
          where c.project_id in (select id from projects where name like 'Explain M4 project %')`);

        await tx.execute(sql`
          insert into comments (task_id, author_user_id, body, created_at)
          select t.id, t.created_by_user_id, 'Binh luan ' || g, now() - (g || ' seconds')::interval
          from tasks t
          cross join generate_series(1, 2) as g
          where t.project_id = (select id from projects where name = 'Explain M4 project 1')`);

        await tx.execute(sql`
          insert into activity_logs (project_id, task_id, actor_user_id, action, payload, created_at)
          select t.project_id, t.id, t.created_by_user_id, 'task.updated', '{}'::jsonb,
                 now() - (g || ' seconds')::interval
          from tasks t
          cross join generate_series(1, 3) as g
          where t.project_id = (select id from projects where name = 'Explain M4 project 1')`);

        await tx.execute(sql`analyze tasks`);
        await tx.execute(sql`analyze comments`);
        await tx.execute(sql`analyze activity_logs`);
        await tx.execute(sql`analyze board_columns`);
        await tx.execute(sql`analyze project_members`);

        const [sizes] = await tx.execute<{ tasks: number; comments: number; activity: number }>(
          sql`select (select count(*)::int from tasks) as tasks,
                     (select count(*)::int from comments) as comments,
                     (select count(*)::int from activity_logs) as activity`,
        );
        /**
         * Cả ba bảng đều phải đủ lớn, không chỉ `tasks`.
         *
         * Một lượt chạy đã đỏ vì `comments` chỉ có 300 dòng — và trên 300 dòng
         * PostgreSQL chọn `Seq Scan`, hoàn toàn đúng. Phép đo khi ấy đo kích
         * thước seed chứ không đo index.
         */
        expect((sizes as { tasks: number }).tasks).toBeGreaterThan(10_000);
        expect((sizes as { comments: number }).comments).toBeGreaterThan(3_000);
        expect((sizes as { activity: number }).activity).toBeGreaterThan(5_000);

        const [ids] = await tx.execute<{
          project_id: string;
          column_id: string;
          assignee_id: string;
          reviewer_id: string;
          creator_id: string;
          task_id: string;
          narrow_id: string;
        }>(sql`
          select p.id as project_id,
                 (select id from board_columns where project_id = p.id order by position limit 1) as column_id,
                 (select assignee_id from tasks where project_id = p.id and assignee_id is not null limit 1) as assignee_id,
                 (select reviewer_id from tasks where project_id = p.id and reviewer_id is not null limit 1) as reviewer_id,
                 (select created_by_user_id from tasks where project_id = p.id limit 1) as creator_id,
                 (select id from tasks where project_id = p.id order by position limit 1) as task_id,
                 (select id from users where email = 'explain-m4-narrow@example.test') as narrow_id
          from projects p where p.name = 'Explain M4 project 1'`);

        const probe = ids as {
          project_id: string;
          column_id: string;
          assignee_id: string;
          reviewer_id: string;
          creator_id: string;
          task_id: string;
          /** Actor chỉ thuộc một project — hình dạng thật của `MYT-01`. */
          narrow_id: string;
        };

        /* ------------------------------- Đo ------------------------------- */

        async function explain(
          name: string,
          expectedIndex: string | null,
          query: ReturnType<typeof sql>,
        ): Promise<string> {
          const rows = await tx.execute<Record<string, string>>(
            sql`explain (analyze, buffers) ${query}`,
          );
          const plan = rows.map((row) => Object.values(row)[0] ?? "").join("\n");
          checks.push({ name, expectedIndex, plan });
          return plan;
        }

        /** Plan phải dùng index đã nêu tên, và **không** seq scan `tasks`. */
        function expectIndex(plan: string, index: string, label: string): void {
          expect(plan, `${label}: không thấy ${index} trong plan\n${plan}`).toContain(index);
          expect(plan, `${label}: rơi về seq scan trên tasks\n${plan}`).not.toMatch(
            /Seq Scan on tasks/,
          );
        }

        const boardPage = await explain(
          "Board một cột (position asc)",
          "tasks_project_column_position_uniq",
          sql`select id, title, position from tasks
              where project_id = ${probe.project_id} and column_id = ${probe.column_id}
              order by position asc, id asc limit 26`,
        );
        expectIndex(boardPage, "tasks_project_column_position_uniq", "board page");

        const defaultList = await explain(
          "Danh sách mặc định (createdAt desc)",
          "tasks_project_created_at_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id}
              order by created_at desc nulls last, id desc nulls last limit 26`,
        );
        expectIndex(defaultList, "tasks_project_created_at_idx", "default list");

        const updatedSort = await explain(
          "Sort updatedAt desc",
          "tasks_project_updated_at_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id}
              order by updated_at desc nulls last, id desc nulls last limit 26`,
        );
        expectIndex(updatedSort, "tasks_project_updated_at_idx", "updatedAt sort");

        const dueRange = await explain(
          "Khoảng due_date",
          "tasks_project_due_date_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id}
                and due_date >= current_date and due_date <= current_date + 7
              order by due_date asc, id asc limit 26`,
        );
        expectIndex(dueRange, "tasks_project_due_date_idx", "due range");

        /**
         * `dueDate:desc` với `NULLS LAST` **không** khớp một btree đơn.
         *
         * Chính sách index đã ghi nhận và chấp nhận điều này: planner sort trong
         * phạm vi project, bounded. Ghi lại đây để bảng EXPLAIN nói ra lý do
         * thay vì để một node `Sort` trông như một thiếu sót.
         */
        const dueDesc = await explain(
          "Sort dueDate desc (NULLS LAST)",
          null,
          sql`select id, title from tasks
              where project_id = ${probe.project_id}
              order by due_date desc nulls last, id desc limit 26`,
        );
        /**
         * Điều đúng để khẳng định ở đây **không** phải "không seq scan".
         *
         * Không index nào phục vụ được `desc nulls last`, nên planner chọn cách
         * rẻ nhất cho phạm vi project — bitmap khi bảng lớn, seq scan khi bảng
         * nhỏ. Cả hai đều là "sort trong phạm vi project", đúng thứ chính sách
         * index đã ghi nhận và chấp nhận. Khẳng định "không seq scan" ở đây sẽ
         * đo kích thước bảng của test chứ không đo hành vi của sản phẩm.
         *
         * Thứ phải đúng: có một node `Sort` (nên ta **biết** vì sao nó chậm hơn)
         * và phạm vi vẫn bị chặn bởi `project_id` (nên nó bounded).
         */
        expect(
          dueDesc,
          `dueDate:desc phải sort có kiểm soát
${dueDesc}`,
        ).toMatch(/Sort/);
        expect(
          dueDesc,
          `dueDate:desc phải bị chặn theo project
${dueDesc}`,
        ).toContain(probe.project_id);

        const assignee = await explain(
          "Lọc assignee + updatedAt desc",
          "tasks_project_assignee_updated_at_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id} and assignee_id = ${probe.assignee_id}
              order by updated_at desc nulls last limit 26`,
        );
        expectIndex(assignee, "tasks_project_assignee_updated_at_idx", "assignee filter");

        const reviewer = await explain(
          "Lọc reviewer + updatedAt desc",
          "tasks_project_reviewer_updated_at_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id} and reviewer_id = ${probe.reviewer_id}
              order by updated_at desc nulls last limit 26`,
        );
        expectIndex(reviewer, "tasks_project_reviewer_updated_at_idx", "reviewer filter");

        const createdBy = await explain(
          "Lọc createdBy + updatedAt desc",
          "tasks_project_created_by_updated_at_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id} and created_by_user_id = ${probe.creator_id}
              order by updated_at desc nulls last limit 26`,
        );
        expectIndex(createdBy, "tasks_project_created_by_updated_at_idx", "createdBy filter");

        /**
         * Search: GIN trên biểu thức, **đối xứng dấu**.
         *
         * Query phải dùng **đúng** biểu thức của index (`fb_unaccent` cả hai
         * phía); lệch một chữ là planner bỏ index và rơi về seq scan — nên test
         * này đo cả tính đúng lẫn tính nhanh bằng một phép đo.
         *
         * Từ khoá phải **hiếm**, và đó là một bài học đã tốn một lượt chạy đỏ.
         * Ở phiên bản trước, cụm này khớp ~9% số task của project và planner đôi
         * lúc chọn quét theo `project_id` rồi lọc — rẻ hơn theo ước lượng của
         * nó, và **đúng** với một từ khoá phổ biến. Một phép đo dao động theo
         * ước lượng thống kê là một phép đo không nói lên điều gì; seed hiện
         * gieo cụm này cho ~0,5% số task, là hình dạng mà một lượt tìm kiếm
         * thật có.
         */
        const search = await explain(
          "Tìm kiếm không dấu (GIN)",
          "tasks_search_idx",
          sql`select id, title from tasks
              where project_id = ${probe.project_id}
                and to_tsvector('simple', fb_unaccent(title || ' ' || description))
                    @@ websearch_to_tsquery('simple', fb_unaccent('thiet ke'))
              order by created_at desc nulls last, id desc nulls last limit 26`,
        );
        expectIndex(search, "tasks_search_idx", "search");

        /**
         * Truy vấn **cắt ngang nhiều project** — `GET /workspaces/:workspaceId/tasks`.
         *
         * Hình dạng khác hẳn list cấp project: điểm vào không còn là một
         * `project_id` cố định mà là **membership của actor**. Với một actor
         * thuộc vài project trong một workspace nhiều project, đường rẻ nhất là
         * đi từ `project_members(user_id, project_id)` rồi mới tới task — và đó
         * chính là index mà M2 dựng cho `GET /workspaces/:id/projects`.
         *
         * Điều phải đúng: **không** seq scan trên `tasks`, và membership là một
         * phần của kế hoạch chứ không phải một bộ lọc chạy sau.
         */
        const workspaceScoped = await explain(
          "Task cấp workspace (giao membership)",
          "project_members",
          sql`select t.id, t.title
              from tasks t
              join board_columns c on c.id = t.column_id and c.project_id = t.project_id
              join users u on u.id = t.created_by_user_id
              join projects p on p.id = t.project_id
              join project_members pm on pm.project_id = t.project_id and pm.user_id = ${probe.narrow_id}
              where p.workspace_id = (select workspace_id from projects where id = ${probe.project_id})
              order by t.created_at desc nulls last, t.id desc nulls last
              limit 26`,
        );
        expect(
          workspaceScoped,
          `task cấp workspace: rơi về seq scan trên tasks\n${workspaceScoped}`,
        ).not.toMatch(/Seq Scan on tasks/);
        expect(
          workspaceScoped,
          `task cấp workspace: membership không nằm trong plan\n${workspaceScoped}`,
        ).toContain("project_members");

        const commentPage = await explain(
          "Comment của một task",
          "comments_task_created_at_idx",
          sql`select id, body from comments
              where task_id = ${probe.task_id}
              order by created_at asc, id asc limit 26`,
        );
        expect(commentPage, `comment page\n${commentPage}`).toContain(
          "comments_task_created_at_idx",
        );

        const activityPage = await explain(
          "Lịch sử của một task",
          "activity_logs_project_task_created_at_idx",
          sql`select id, action from activity_logs
              where project_id = ${probe.project_id} and task_id = ${probe.task_id}
              order by created_at desc nulls last, id desc limit 26`,
        );
        expect(activityPage, `activity page\n${activityPage}`).toContain(
          "activity_logs_project_task_created_at_idx",
        );

        // Ném để rollback: seed không được để lại gì.
        throw new Error(ROLLBACK);
      })
      .catch((error: unknown) => error);

    expect((outcome as Error).message, JSON.stringify(outcome)).toBe(ROLLBACK);

    // Không dòng nào sống sót.
    const [left] = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from projects where name like 'Explain M4 project %'`,
    );
    expect((left as { n: number }).n).toBe(0);
  }, 600_000);
});
