import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { activityLogs, users } from "../../../shared/database/schema.ts";
import type { ActivityEvent, ActivityRecorder } from "../domain/activity-recorder.ts";

/**
 * Adapter Drizzle cho `ActivityRecorder`.
 *
 * **Nơi duy nhất** trong toàn bộ ứng dụng `INSERT` vào `activity_logs`. Nó
 * không mở transaction: nó ghi vào transaction mà use case đưa cho, nên row
 * activity chia đúng số phận với mutation.
 */
export class DrizzleActivityRecorder implements ActivityRecorder {
  async record(tx: Transaction, event: ActivityEvent): Promise<void> {
    await tx.insert(activityLogs).values({
      projectId: event.projectId,
      // `null` xuyên suốt M3: mọi event của mốc này là project/member/column.
      taskId: event.taskId ?? null,
      actorUserId: event.actorUserId,
      action: event.action,
      payload: event.payload ?? {},
    });
  }
}

/**
 * Đọc activity.
 *
 * Ở M3 lớp này chỉ phục vụ test và chẩn đoán — nó ra đời sớm vì test của M3
 * phải **đếm row thật** để chứng minh các khẳng định "deny không tạo activity
 * row" không còn rỗng. M4 thêm đường đọc thật cho
 * `GET /tasks/:taskId/activity`, và nó vẫn ở đây vì `activity` là module sở hữu
 * bảng: một câu SQL trên `activity_logs` viết ở module khác là kiến thức bị
 * nhân bản ra ngoài chủ sở hữu.
 *
 * Điều lớp này **không** làm: nó không trả `payload` ra ngoài đường đọc công
 * khai. `summary` do `buildActivitySummary` dựng, và raw payload dừng lại ở
 * ranh giới server.
 */
export class ActivityQueries {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Đếm activity của một project, tuỳ chọn lọc theo `action`. */
  async countForProject(projectId: string, action?: string): Promise<number> {
    const scope =
      action === undefined
        ? eq(activityLogs.projectId, projectId)
        : and(eq(activityLogs.projectId, projectId), eq(activityLogs.action, action));

    const [row] = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(scope);
    return row?.n ?? 0;
  }

  /**
   * Đếm activity trên **một tập project**.
   *
   * Test cần một con số bao trọn "mọi thứ mà request này có thể đã ghi", kể cả
   * khi request tạo ra một project mới. Đếm bằng cách tự viết SQL trong file
   * test sẽ nhân bản kiến thức về bảng ra ngoài module sở hữu nó — đúng thứ mà
   * ADR-0005 đặt module `activity` ra để tránh.
   */
  async countForProjects(projectIds: readonly string[]): Promise<number> {
    if (projectIds.length === 0) return 0;

    const [row] = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(inArray(activityLogs.projectId, [...projectIds]));
    return row?.n ?? 0;
  }

  /**
   * Lịch sử của **một task**, mới nhất trước, có seek pagination.
   *
   * Scope theo `project_id` **và** `task_id`, không chỉ `task_id`: `:taskId` là
   * locator chứ không phải bằng chứng quyền, và project đã authorize là thứ duy
   * nhất giới hạn phạm vi đọc. Thiếu vế `project_id`, một task ID đoán trúng sẽ
   * đọc được lịch sử của project khác.
   */
  async findForTask(
    input: {
      projectId: string;
      taskId: string;
      limit: number;
      /** Khoá seek dạng chuỗi đủ microsecond — xem `CommentSeek` để biết vì sao. */
      after?: { createdAtKey: string; id: string };
    },
    tx?: Database | Transaction,
  ): Promise<
    {
      id: string;
      taskId: string | null;
      actorUserId: string;
      actorDisplayName: string;
      action: string;
      payload: unknown;
      createdAt: Date;
      /** Khoá cursor đủ microsecond — xem `comment-repository.ts` để biết vì sao. */
      createdAtKey: string;
    }[]
  > {
    const scope = and(
      eq(activityLogs.projectId, input.projectId),
      eq(activityLogs.taskId, input.taskId),
    );

    const after = input.after;
    const seek =
      after === undefined
        ? undefined
        : sql`(${activityLogs.createdAt} < ${after.createdAtKey}::timestamptz
               or (${activityLogs.createdAt} = ${after.createdAtKey}::timestamptz
                   and ${activityLogs.id} < ${after.id}))`;

    // Đọc dư **một** hàng để biết `hasMore` mà không cần một câu `COUNT` thứ hai.
    return await (tx ?? this.#db)
      .select({
        id: activityLogs.id,
        taskId: activityLogs.taskId,
        actorUserId: activityLogs.actorUserId,
        actorDisplayName: users.displayName,
        action: activityLogs.action,
        payload: activityLogs.payload,
        createdAt: activityLogs.createdAt,
        createdAtKey: sql<string>`to_char(${activityLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(activityLogs)
      .innerJoin(users, eq(users.id, activityLogs.actorUserId))
      .where(seek === undefined ? scope : and(scope, seek))
      /**
       * `desc nulls last` tường minh: index `activity_logs(project_id, task_id,
       * created_at DESC NULLS LAST)` chỉ phục vụ được `ORDER BY` khi thứ tự NULL
       * khớp. Mặc định của `ORDER BY x DESC` là NULLS FIRST, và lệch đó đủ để
       * planner bỏ index — xem chú thích dài ở `tasks/infrastructure/task-repository.ts`.
       */
      .orderBy(sql`${activityLogs.createdAt} desc nulls last`, desc(activityLogs.id))
      .limit(input.limit + 1);
  }

  /** Activity gần nhất của một project, mới nhất trước. */
  async recentForProject(
    projectId: string,
    limit = 20,
  ): Promise<{ action: string; actorUserId: string; payload: unknown; createdAt: Date }[]> {
    return await this.#db
      .select({
        action: activityLogs.action,
        actorUserId: activityLogs.actorUserId,
        payload: activityLogs.payload,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(eq(activityLogs.projectId, projectId))
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(limit);
  }
}
