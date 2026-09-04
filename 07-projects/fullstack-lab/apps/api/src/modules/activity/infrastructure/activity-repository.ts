import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { activityLogs } from "../../../shared/database/schema.ts";
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
 * Đọc activity — chỉ dùng cho test và chẩn đoán ở M3.
 *
 * Route đọc lịch sử (`GET /tasks/:taskId/activity`) thuộc M4. Repository này
 * tồn tại sớm vì test của M3 phải **đếm row thật** để chứng minh rằng các
 * khẳng định "deny không tạo activity row" không còn rỗng, và một test đếm row
 * bằng cách tự viết SQL sẽ nhân bản kiến thức về bảng ra ngoài module sở hữu nó.
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
