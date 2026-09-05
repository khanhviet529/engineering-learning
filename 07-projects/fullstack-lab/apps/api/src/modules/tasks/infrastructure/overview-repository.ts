import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../../shared/database/client.ts";
import { boardColumns, tasks, users } from "../../../shared/database/schema.ts";
import { DUE_SOON_WINDOW_DAYS } from "../domain/due-state.ts";

/**
 * Aggregate cho `GET /projects/:projectId/overview`.
 *
 * Tách khỏi `TaskRepository` vì hình dạng truy vấn khác hẳn: đây là bốn phép
 * `GROUP BY` trên cùng một phạm vi, không phải một trang task. Trộn chúng vào
 * cùng một lớp sẽ cho một lớp mà một nửa method trả row còn nửa kia trả số đếm.
 *
 * **Server trả số đếm, client tính phần trăm** — hợp đồng nói thẳng, và lý do
 * là hai nguồn cho cùng một sự thật sẽ lệch ở lần làm tròn đầu tiên. Không
 * method nào ở đây trả một tỉ lệ.
 */

export interface OverviewColumnRow {
  columnId: string;
  name: string;
  isTerminal: boolean;
  taskCount: number;
}

export interface OverviewAssigneeRow {
  userId: string;
  displayName: string;
  taskCount: number;
}

export interface OverviewDueStates {
  overdue: number;
  dueToday: number;
  dueSoon: number;
  /** Còn hạn nhưng ngoài cửa sổ `due_soon`. */
  scheduled: number;
  /** Cột terminal, hoặc không có `due_date` — không có hạn để nói. */
  none: number;
}

export class OverviewRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Tổng số task của project, và số task **tạo trong cửa sổ**.
   *
   * `createdInWindow` chỉ cần `tasks.created_at` — đó chính là lý do
   * `+4 tuần này` có mặt trong hợp đồng còn `+12% so với tuần trước` thì không:
   * cái sau cần dựng lại lịch sử column của từng task, thứ `activity_logs`
   * không nói được vì `is_terminal` đổi được và không hồi tố.
   *
   * Cửa sổ là **ngày lịch theo timezone workspace**, nên biên phải so trên
   * `created_at` đã quy về ngày trong chính timezone đó — không phải trên UTC.
   * So bằng UTC sẽ đếm nhầm mọi task tạo trong 7 giờ đầu ngày ở GMT+7.
   */
  async totals(input: {
    projectId: string;
    from: string;
    to: string;
    timeZone: string;
  }): Promise<{ tasks: number; createdInWindow: number }> {
    const localDate = sql`(${tasks.createdAt} at time zone ${input.timeZone})::date`;

    const [row] = await this.#db
      .select({
        tasks: sql<number>`count(*)::int`,
        createdInWindow: sql<number>`count(*) filter (
          where ${localDate} >= ${input.from}::date and ${localDate} <= ${input.to}::date
        )::int`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, input.projectId));

    return { tasks: row?.tasks ?? 0, createdInWindow: row?.createdInWindow ?? 0 };
  }

  /**
   * Số task theo column **active**, giữ nguyên thứ tự `position` của board.
   *
   * `left join` chứ không `inner join`: một cột rỗng vẫn phải xuất hiện với
   * `taskCount: 0`. Bỏ nó đi làm dashboard và board hiện hai danh sách cột khác
   * nhau — đúng thứ mà "cùng một trật tự" trong hợp đồng tồn tại để chặn.
   */
  async byColumn(projectId: string): Promise<OverviewColumnRow[]> {
    return (await this.#db
      .select({
        columnId: boardColumns.id,
        name: boardColumns.name,
        isTerminal: boardColumns.isTerminal,
        taskCount: sql<number>`count(${tasks.id})::int`,
      })
      .from(boardColumns)
      .leftJoin(
        tasks,
        and(eq(tasks.columnId, boardColumns.id), eq(tasks.projectId, boardColumns.projectId)),
      )
      .where(and(eq(boardColumns.projectId, projectId), isNull(boardColumns.archivedAt)))
      .groupBy(boardColumns.id, boardColumns.name, boardColumns.isTerminal, boardColumns.position)
      .orderBy(asc(boardColumns.position), asc(boardColumns.id))) as OverviewColumnRow[];
  }

  /**
   * Số task theo người thực hiện — **chỉ** task có assignee.
   *
   * Task chưa giao được đếm riêng ở `unassignedCount`: một danh sách người mà
   * một phần tử không phải người là chỗ mọi client phải viết một nhánh đặc biệt.
   *
   * Thứ tự **tất định**: nhiều việc trước, rồi theo tên, rồi theo `id`. Hợp đồng
   * không nói thứ tự, nhưng một danh sách không có thứ tự tất định sẽ đổi chỗ
   * giữa hai lần tải với cùng dữ liệu — và người dùng đọc đó là "có gì đó vừa
   * thay đổi".
   */
  async byAssignee(projectId: string): Promise<OverviewAssigneeRow[]> {
    return (await this.#db
      .select({
        userId: users.id,
        displayName: users.displayName,
        taskCount: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.assigneeId))
      .where(eq(tasks.projectId, projectId))
      .groupBy(users.id, users.displayName)
      .orderBy(sql`count(*) desc`, asc(users.displayName), asc(users.id))) as OverviewAssigneeRow[];
  }

  /** Task chưa giao cho ai. */
  async unassignedCount(projectId: string): Promise<number> {
    const [row] = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.assigneeId)));
    return row?.n ?? 0;
  }

  /**
   * Bốn nhóm `dueState`, dịch từ **đúng** ba nguyên liệu mà `deriveDueState`
   * dùng: `today` theo timezone workspace, `due_date`, và `is_terminal` của cột
   * chứa task.
   *
   * Hợp đồng nói `dueStates` phải dùng cùng `WorkspaceClock` và cùng
   * `DUE_SOON_WINDOW_DAYS` với list task — nên `today` được **truyền vào** từ
   * cùng một cổng, và cửa sổ là **chính** hằng số kia, không phải một bản chép.
   */
  async dueStates(input: { projectId: string; today: string }): Promise<OverviewDueStates> {
    const due = tasks.dueDate;
    const terminal = boardColumns.isTerminal;
    const today = sql`${input.today}::date`;
    const soonEnd = sql`(${input.today}::date + ${DUE_SOON_WINDOW_DAYS}::int)`;

    const active = sql`${terminal} = false and ${due} is not null`;

    const [row] = await this.#db
      .select({
        overdue: sql<number>`count(*) filter (where ${active} and ${due} < ${today})::int`,
        dueToday: sql<number>`count(*) filter (where ${active} and ${due} = ${today})::int`,
        dueSoon: sql<number>`count(*) filter (
          where ${active} and ${due} > ${today} and ${due} <= ${soonEnd}
        )::int`,
        /**
         * `scheduled` tách khỏi `none` từ 05/09/2026.
         *
         * Bản đầu gom hai nhóm lại làm một dưới tên `none`, nên tổng vẫn bằng
         * `totals.tasks` — và **chính vì tổng vẫn khớp** nên phép cộng không
         * bao giờ lộ ra rằng `dueStates.none` không bằng số task lọc
         * `dueState=none`. Cùng một tên mang hai nghĩa ở hai endpoint. Backend
         * ghim chỗ lệch bằng test rồi báo; hợp đồng nay có đủ **năm** khoá,
         * đúng bằng năm thành viên `DUE_STATES`.
         *
         * `scheduled`: còn hạn nhưng ngoài cửa sổ `due_soon`.
         * `none`: cột terminal, hoặc không có `due_date` — không có hạn để nói.
         */
        scheduled: sql<number>`count(*) filter (where ${active} and ${due} > ${soonEnd})::int`,
        none: sql<number>`count(*) filter (
          where ${terminal} = true or ${due} is null
        )::int`,
      })
      .from(tasks)
      .innerJoin(
        boardColumns,
        and(eq(boardColumns.id, tasks.columnId), eq(boardColumns.projectId, tasks.projectId)),
      )
      .where(eq(tasks.projectId, input.projectId));

    return {
      overdue: row?.overdue ?? 0,
      dueToday: row?.dueToday ?? 0,
      dueSoon: row?.dueSoon ?? 0,
      scheduled: row?.scheduled ?? 0,
      none: row?.none ?? 0,
    };
  }
}
