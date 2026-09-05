import type { KeyRing } from "../../../shared/security/key-ring.ts";
import type { Database } from "../../../shared/database/client.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import type { Actor } from "../../../shared/authorization/index.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import {
  buildPage,
  decodeCursor,
  queryFingerprint,
  type PageResult,
} from "../../../shared/http/cursor.ts";
import type { ActivityRecorder } from "../../activity/domain/activity-recorder.ts";
import type { ActivityQueries } from "../../activity/infrastructure/activity-repository.ts";
import { buildActivitySummary } from "../../activity/domain/activity-summary.ts";
import type { CommentRepository, CommentRow } from "../infrastructure/comment-repository.ts";
import type { TaskRepository } from "../infrastructure/task-repository.ts";

/**
 * Comment và lịch sử của một task.
 *
 * Hai use case rất khác nhau về hình dạng — một ghi, một đọc — nhưng cùng một
 * bất biến phạm vi: **task phải thuộc project đã authorize**. Guard đã kiểm
 * điều đó, và mỗi lượt đọc ở đây kiểm lại bằng cách scope theo `project_id`.
 * `:taskId` là locator, không phải bằng chứng quyền.
 */

export interface CommentDeps {
  db: Database;
  comments: CommentRepository;
  tasks: TaskRepository;
  activity: ActivityRecorder;
  activityQueries: ActivityQueries;
  cursorSecret: KeyRing;
}

export interface CommentView {
  id: string;
  taskId: string;
  authorId: string;
  authorDisplayName: string;
  body: string;
  createdAt: Date;
}

export interface ActivityView {
  id: string;
  taskId: string | null;
  actorId: string;
  actorDisplayName: string;
  action: string;
  summary: string;
  createdAt: Date;
}

function toCommentView(row: CommentRow): CommentView {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorUserId,
    authorDisplayName: row.authorDisplayName,
    body: row.body,
    createdAt: row.createdAt,
  };
}

export class CommentUseCases {
  readonly #deps: CommentDeps;

  constructor(deps: CommentDeps) {
    this.#deps = deps;
  }

  /**
   * Comment của một task, thứ tự cố định `createdAt, id` tăng dần.
   *
   * Task chưa có comment trả **trang rỗng**, không phải `404`: "chưa ai bình
   * luận" và "không có task này" là hai câu trả lời khác nhau, và trộn chúng
   * làm client phải đoán.
   */
  async listComments(
    projectId: string,
    taskId: string,
    page: { limit: number; cursor?: string },
  ): Promise<PageResult<CommentView>> {
    await this.#requireTask(projectId, taskId);

    const fingerprint = queryFingerprint({ list: "task-comments", task: taskId });

    const after =
      page.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(page.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAtKey: decoded.sortKey, id: decoded.id };
          })();

    const rows = await this.#deps.comments.findCommentsForTask(taskId, page.limit, after);

    const built = buildPage(rows, page.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: row.createdAtKey,
      id: row.id,
    }));

    return { ...built, items: built.items.map(toCommentView) };
  }

  /**
   * `POST /tasks/:taskId/comments`.
   *
   * Một transaction: insert comment **và** ghi `comment.created`. Không có
   * PATCH, không có DELETE, không có move — cố ý, và cố ý cả ở tầng repository.
   */
  async createComment(
    actor: Actor,
    projectId: string,
    taskId: string,
    input: { body: string },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (comment: CommentView) => unknown,
  ): Promise<CommentView> {
    return await this.#deps.db.transaction(async (tx) => {
      const task = await this.#deps.tasks.findTaskInProject(projectId, taskId, tx);
      if (task === undefined) throw new AppError("NOT_FOUND");

      const created = await this.#deps.comments.insertComment(
        { taskId, authorUserId: actor.id, body: input.body },
        tx,
      );

      await this.#deps.activity.record(tx, {
        projectId,
        taskId,
        actorUserId: actor.id,
        action: "comment.created",
        /**
         * Payload mang `commentId`, **không** mang `body`.
         *
         * Nội dung comment đã có một chỗ ở, và đó là bảng `comments`. Chép nó
         * sang `activity_logs` tạo ra một bản sao thứ hai mà không route nào
         * dọn được — MVP không có xoá comment, nhưng nếu một ngày có thì bản sao
         * trong lịch sử sẽ sống sót qua lần xoá đó.
         */
        payload: { commentId: created.id, taskId },
      });

      const view = toCommentView(created);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /**
   * `GET /tasks/:taskId/activity`.
   *
   * Trả `summary` do server dựng; **raw `payload` không bao giờ ra khỏi đây**.
   * Đó là lý do projection dưới đây liệt kê từng field thay vì trải row.
   */
  async listTaskActivity(
    projectId: string,
    taskId: string,
    page: { limit: number; cursor?: string },
  ): Promise<PageResult<ActivityView>> {
    await this.#requireTask(projectId, taskId);

    const fingerprint = queryFingerprint({ list: "task-activity", task: taskId });

    const after =
      page.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(page.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAtKey: decoded.sortKey, id: decoded.id };
          })();

    const rows = await this.#deps.activityQueries.findForTask({
      projectId,
      taskId,
      limit: page.limit,
      ...(after === undefined ? {} : { after }),
    });

    const built = buildPage(rows, page.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: row.createdAtKey,
      id: row.id,
    }));

    return {
      ...built,
      items: built.items.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        actorId: row.actorUserId,
        actorDisplayName: row.actorDisplayName,
        action: row.action,
        summary: buildActivitySummary(
          row.action,
          (row.payload ?? null) as Record<string, unknown> | null,
        ),
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * Task phải tồn tại **trong project đã authorize**.
   *
   * Guard đã trả `404` cho task của project khác, nên `undefined` ở đây nghĩa là
   * task không tồn tại. Phép kiểm vẫn ở lại: nó là lớp thứ hai, và hai lớp chỉ
   * có giá trị khi lớp này không giả định lớp kia đã chạy đúng.
   */
  async #requireTask(projectId: string, taskId: string): Promise<void> {
    const task = await this.#deps.tasks.findTaskInProject(projectId, taskId);
    if (task === undefined) throw new AppError("NOT_FOUND");
  }
}
