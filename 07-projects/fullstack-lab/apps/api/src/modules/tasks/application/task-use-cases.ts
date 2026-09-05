import type { KeyRing } from "../../../shared/security/key-ring.ts";
import type {
  CreateTaskRequest,
  DueState,
  ListTasksQuery,
  ListWorkspaceTasksQuery,
  MoveTaskRequest,
  TaskSort,
  UpdateTaskRequest,
} from "@flowboard/contracts";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { AppError, validationError } from "../../../shared/errors/app-error.ts";
import type { Actor, MembershipReader } from "../../../shared/authorization/index.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import {
  buildPage,
  decodeCursor,
  queryFingerprint,
  type PageResult,
} from "../../../shared/http/cursor.ts";
import { planInsert, planMove, parsePosition } from "../../../shared/ordering/position.ts";
import type { ActivityRecorder } from "../../activity/domain/activity-recorder.ts";
import type { ColumnRepository } from "../../board-columns/infrastructure/column-repository.ts";
import { deriveDueState, type WorkspaceClock } from "../domain/due-state.ts";
import {
  assertAssigneeIsMember,
  assertDateOrder,
  assertReviewerIsMember,
  assertReviewerNotAssignee,
  assertReviewerOnlyWhenRequired,
  assertReviewerWhenColumnRequires,
  assertUsableColumn,
  versionConflict,
} from "../domain/task-rules.ts";
import {
  defaultSort,
  taskSortKey,
  type TaskRepository,
  type TaskRow,
} from "../infrastructure/task-repository.ts";

/**
 * Use case của module `tasks`.
 *
 * Thứ tự trong mỗi mutation là cố định: **khoá dãy ordering → đọc lại trạng
 * thái → validate → ghi có điều kiện version → activity → outcome**, tất cả
 * trong một transaction.
 *
 * Hai chỗ dễ làm ngược, và cả hai đã tốn tiền ở mốc trước:
 *
 * 1. **Khoá trước khi đọc.** Đọc rồi mới khoá nghĩa là hai request cùng nhìn
 *    một dãy position, cùng tính một trung điểm, rồi mới tranh nhau ghi.
 * 2. **Điều kiện `version` nằm trong câu `UPDATE`**, không phải trong một lần
 *    đọc trước đó. Đọc-rồi-ghi để lại một khe giữa hai câu lệnh, và cả hai
 *    request đều tin mình đang ghi lên cùng một version.
 */

export interface TaskDeps {
  db: Database;
  repository: TaskRepository;
  columns: ColumnRepository;
  membership: MembershipReader;
  activity: ActivityRecorder;
  clock: WorkspaceClock;
  /** Secret ký cursor. Cursor phải chống sửa đổi, không chỉ opaque. */
  cursorSecret: KeyRing;
  now?: () => Date;
}

export interface TaskView {
  id: string;
  projectId: string;
  columnId: string;
  createdByUserId: string;
  createdByDisplayName: string;
  assigneeId: string | null;
  reviewerId: string | null;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  dueState: DueState;
  evidenceUrl: string | null;
  position: bigint;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Field nội dung mà `PATCH` được phép chạm — allowlist đóng. */
const PATCH_FIELDS = [
  "title",
  "description",
  "assigneeId",
  "reviewerId",
  "category",
  "priority",
  "startDate",
  "dueDate",
  "evidenceUrl",
] as const;

export class TaskUseCases {
  readonly #deps: TaskDeps;

  constructor(deps: TaskDeps) {
    this.#deps = deps;
  }

  get #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /* ---------------------------------------------------------------------- *
   * Đọc
   * ---------------------------------------------------------------------- */

  /**
   * `GET /projects/:projectId/tasks`.
   *
   * Không side effect, không activity. Mọi filter nằm trong allowlist đóng, và
   * `dueState` — thứ không có cột nào lưu — được dịch lại thành điều kiện trên
   * `due_date` cộng `is_terminal` ở repository.
   */
  async listTasks(
    actor: Actor,
    projectId: string,
    query: ListTasksQuery,
  ): Promise<PageResult<TaskView>> {
    const sort: TaskSort = query.sort ?? defaultSort(query.columnId);
    const today = await this.#deps.clock.todayForProject(projectId);

    /**
     * Fingerprint bind **toàn bộ** filter canonical, cộng sort và scope.
     *
     * Bỏ sót một chiều là cho phép tái dùng cursor xuyên chiều đó: cursor của
     * column A dùng được ở column B, và người dùng nhận một trang lẫn lộn mà
     * không ai báo lỗi. `sort` cũng phải có mặt — cùng một tập kết quả với thứ
     * tự khác thì một `sortKey` cũ trỏ vào chỗ khác hẳn.
     *
     * `today` **không** nằm trong fingerprint: nó không phải lựa chọn của người
     * dùng, và đưa vào sẽ làm mọi cursor chết lúc nửa đêm.
     */
    const fingerprint = queryFingerprint({
      list: "project-tasks",
      actor: actor.id,
      project: projectId,
      column: query.columnId ?? null,
      assignee: query.assigneeId ?? null,
      createdBy: query.createdById ?? null,
      reviewer: query.reviewerId ?? null,
      category: query.category ?? null,
      priority: query.priority ?? null,
      dueState: query.dueState ?? null,
      dueFrom: query.dueFrom ?? null,
      dueTo: query.dueTo ?? null,
      search: query.search ?? null,
      sort,
    });

    const after =
      query.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(query.cursor, fingerprint, this.#deps.cursorSecret);
            return { sortKey: decoded.sortKey, id: decoded.id };
          })();

    const rows = await this.#deps.repository.findTasks({
      projectId,
      sort,
      limit: query.limit,
      today,
      ...(after === undefined ? {} : { after }),
      ...(query.columnId === undefined ? {} : { columnId: query.columnId }),
      ...(query.assigneeId === undefined ? {} : { assigneeId: query.assigneeId }),
      ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
      ...(query.reviewerId === undefined ? {} : { reviewerId: query.reviewerId }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.dueState === undefined ? {} : { dueState: query.dueState }),
      ...(query.dueFrom === undefined ? {} : { dueFrom: query.dueFrom }),
      ...(query.dueTo === undefined ? {} : { dueTo: query.dueTo }),
      ...(query.search === undefined ? {} : { search: query.search }),
    });

    const page = buildPage(rows, query.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: taskSortKey(sort, row),
      id: row.id,
    }));

    return { ...page, items: page.items.map((row) => this.#toView(row, today)) };
  }

  /**
   * `GET /workspaces/:workspaceId/tasks`.
   *
   * Phạm vi là **giao** của hai điều kiện — task thuộc project trong workspace
   * này, **và** actor có `project_members` row ở chính project đó. Cả hai nằm
   * trong câu SQL (xem `findWorkspaceTasks`); ở đây là phần cursor.
   */
  async listWorkspaceTasks(
    actor: Actor,
    workspaceId: string,
    query: ListWorkspaceTasksQuery,
  ): Promise<PageResult<TaskView> & { projects: { id: string; name: string }[] }> {
    // Không có `columnId` ở phạm vi này, nên sort mặc định là danh sách theo
    // thời gian — board order không có nghĩa khi cắt ngang nhiều project.
    const sort: TaskSort = query.sort ?? "createdAt:desc";
    const today = await this.#deps.clock.todayForWorkspace(workspaceId);

    /**
     * Fingerprint bind cả **phạm vi actor nhìn thấy được**, không chỉ filter.
     *
     * Membership project đổi giữa hai trang thì cursor cũ không còn mô tả cùng
     * một tập, và trả tiếp trên nó sẽ hoặc bỏ sót hoặc lặp. Danh sách project
     * mà actor thấy được vì vậy là **một phần của truy vấn**, đúng như hợp đồng
     * nói — và nó được đọc lại ở mỗi trang, nên một lần bị gỡ khỏi project sẽ
     * làm cursor cũ chết bằng `400` thay vì trả một trang lệch âm thầm.
     */
    const visible = await this.#deps.repository.visibleProjectIds(workspaceId, actor.id);

    const fingerprint = queryFingerprint({
      list: "workspace-tasks",
      actor: actor.id,
      workspace: workspaceId,
      // Nội dung phạm vi, không phải chỉ số lượng: mất một project và được thêm
      // một project khác cho cùng một con số nhưng khác hẳn tập kết quả.
      scope: visible.join(","),
      assignee: query.assigneeId ?? null,
      createdBy: query.createdById ?? null,
      reviewer: query.reviewerId ?? null,
      category: query.category ?? null,
      priority: query.priority ?? null,
      dueState: query.dueState ?? null,
      dueFrom: query.dueFrom ?? null,
      dueTo: query.dueTo ?? null,
      search: query.search ?? null,
      sort,
    });

    const after =
      query.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(query.cursor, fingerprint, this.#deps.cursorSecret);
            return { sortKey: decoded.sortKey, id: decoded.id };
          })();

    const rows = await this.#deps.repository.findWorkspaceTasks({
      workspaceId,
      actorId: actor.id,
      sort,
      limit: query.limit,
      today,
      ...(after === undefined ? {} : { after }),
      ...(query.assigneeId === undefined ? {} : { assigneeId: query.assigneeId }),
      ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
      ...(query.reviewerId === undefined ? {} : { reviewerId: query.reviewerId }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.dueState === undefined ? {} : { dueState: query.dueState }),
      ...(query.dueFrom === undefined ? {} : { dueFrom: query.dueFrom }),
      ...(query.dueTo === undefined ? {} : { dueTo: query.dueTo }),
      ...(query.search === undefined ? {} : { search: query.search }),
    });

    const page = buildPage(rows, query.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: taskSortKey(sort, row),
      id: row.id,
    }));

    // Bảng tra cứu cho **đúng** trang này, không phải mọi project của workspace.
    const projectIds = [...new Set(page.items.map((row) => row.projectId))];
    const projects = await this.#deps.repository.findProjectRefs(projectIds);

    return { ...page, items: page.items.map((row) => this.#toView(row, today)), projects };
  }

  /** Một task, đã scope theo project đã authorize. */
  async getTask(projectId: string, taskId: string): Promise<TaskView> {
    const row = await this.#deps.repository.findTaskInProject(projectId, taskId);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return this.#toView(row, await this.#deps.clock.todayForProject(projectId));
  }

  /* ---------------------------------------------------------------------- *
   * Ghi
   * ---------------------------------------------------------------------- */

  /**
   * `POST /projects/:projectId/tasks`.
   *
   * `position` do server tính và **append vào cuối cột**: hợp đồng create không
   * có field nào để client nói vị trí, và đó là có chủ đích — sắp xếp là việc
   * của `POST /tasks/:taskId/move`, nơi có `expectedVersion` và activity riêng.
   */
  async createTask(
    actor: Actor,
    projectId: string,
    input: CreateTaskRequest,
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (task: TaskView) => unknown,
  ): Promise<TaskView> {
    const today = await this.#deps.clock.todayForProject(projectId);

    return await this.#deps.db.transaction(async (tx) => {
      const column = await this.#deps.columns.findColumnInProject(projectId, input.columnId, tx);
      assertUsableColumn(column);
      const target = column as NonNullable<typeof column>;

      await this.#validatePeople(tx, projectId, {
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
      });
      assertReviewerNotAssignee({
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
      });
      assertReviewerWhenColumnRequires({
        columnRequiresReviewer: target.requiresReviewer,
        reviewerId: input.reviewerId,
      });
      assertDateOrder({ startDate: input.startDate, dueDate: input.dueDate });

      // Khoá dãy ordering của **cột đích** trước khi đọc nó.
      await this.#deps.repository.lockColumnOrdering(input.columnId, tx);
      const existing = await this.#deps.repository.lockColumnTasks(projectId, input.columnId, tx);

      // Append: mốc là task cuối cùng, hoặc `null` khi cột rỗng.
      const plan = planInsert(existing, existing.at(-1)?.id ?? null);
      await this.#deps.repository.applyPositions(plan.rebalance, tx);

      const taskId = await this.#deps.repository.insertTask(
        {
          projectId,
          columnId: input.columnId,
          createdByUserId: actor.id,
          assigneeId: input.assigneeId,
          reviewerId: input.reviewerId,
          title: input.title,
          // Hợp đồng cho `description: null`; database nói "không có nội dung
          // là chuỗi rỗng, không phải NULL". Quy đổi ở đúng ranh giới này.
          description: input.description ?? "",
          category: input.category,
          priority: input.priority ?? "none",
          position: plan.position,
          startDate: input.startDate,
          dueDate: input.dueDate,
          evidenceUrl: input.evidenceUrl,
        },
        tx,
      );

      await this.#deps.activity.record(tx, {
        projectId,
        taskId,
        actorUserId: actor.id,
        action: "task.created",
        payload: {
          taskId,
          title: input.title,
          columnId: input.columnId,
          rebalanced: plan.rebalance.length,
        },
      });

      const created = await this.#deps.repository.findTaskInProject(projectId, taskId, tx);
      if (created === undefined) throw new AppError("INTERNAL_ERROR");

      const view = this.#toView(created, today);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /**
   * `PATCH /tasks/:taskId` — nội dung và assignment, **không** column/position.
   *
   * Đổi `column_id` hay `position` bắt buộc đi qua move: chúng có bất biến
   * ordering riêng, và một đường ghi thứ hai nghĩa là hai chỗ phải cùng đúng.
   */
  async updateTask(
    actor: Actor,
    projectId: string,
    taskId: string,
    input: UpdateTaskRequest,
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (task: TaskView) => unknown,
  ): Promise<TaskView> {
    const today = await this.#deps.clock.todayForProject(projectId);

    return await this.#deps.db.transaction(async (tx) => {
      const current = await this.#deps.repository.findTaskInProject(projectId, taskId, tx);
      // Task của project khác đã bị guard chặn bằng `404`; tới đây `undefined`
      // nghĩa là task không tồn tại.
      if (current === undefined) throw new AppError("NOT_FOUND");

      assertNoUnopenedPhaseFields(input);

      const patch = pickPatch(input);
      const next = { ...current, ...patch } as TaskRow;

      // Chỉ kiểm người **vừa được gửi lên**: một giá trị đã lưu từ trước đã đi
      // qua đúng phép kiểm này ở lần ghi của nó, và kiểm lại sẽ biến việc gỡ một
      // member khỏi project thành một quả mìn dưới mọi lần sửa task cũ.
      await this.#validatePeople(tx, projectId, {
        assigneeId: (patch["assigneeId"] as string | null | undefined) ?? null,
        reviewerId: (patch["reviewerId"] as string | null | undefined) ?? null,
      });
      assertReviewerNotAssignee({ assigneeId: next.assigneeId, reviewerId: next.reviewerId });
      assertDateOrder({ startDate: next.startDate, dueDate: next.dueDate });

      /**
       * Gỡ reviewer khỏi một task đang ở cột yêu cầu reviewer bị từ chối.
       *
       * Cờ `requiresReviewer` **không hồi tố** lên task đã nằm sẵn trong cột —
       * nhưng đó là về những task server không đụng tới. Một `PATCH` chủ động
       * gỡ reviewer thì có đụng tới, và để nó đi qua là mở một đường vòng quanh
       * chính luật mà move đang cưỡng chế.
       */
      assertReviewerWhenColumnRequires({
        columnRequiresReviewer: current.columnRequiresReviewer,
        reviewerId: next.reviewerId,
      });

      const updated = await this.#deps.repository.updateTaskContent(
        { projectId, taskId, expectedVersion: input.expectedVersion, now: this.#now, patch },
        tx,
      );

      if (updated === undefined) {
        // Điều kiện version không khớp. Đọc lại version hiện tại để client có
        // đường xem lại dữ liệu thay vì thử lại một cách mù.
        const currentVersion = await this.#deps.repository.currentVersion(projectId, taskId, tx);
        if (currentVersion === undefined) throw new AppError("NOT_FOUND");
        throw versionConflict(currentVersion);
      }

      await this.#deps.activity.record(tx, {
        projectId,
        taskId,
        actorUserId: actor.id,
        action: "task.updated",
        // Chỉ **tên** field đã đổi. Giá trị mới của `description` có thể dài
        // mười nghìn ký tự và không giúp gì cho một dòng lịch sử.
        payload: { taskId, fields: Object.keys(patch) },
      });

      const after = await this.#deps.repository.findTaskInProject(projectId, taskId, tx);
      if (after === undefined) throw new AppError("INTERNAL_ERROR");

      const view = this.#toView(after, today);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /**
   * `POST /tasks/:taskId/move`.
   *
   * `targetPosition` là **gợi ý vị trí**, không phải position sẽ được ghi:
   * server tìm xem nó rơi vào khe nào rồi tự tính giá trị thật, đúng như
   * ADR-0006 mục 1 nói. Nhờ vậy hai client cùng thả vào một chỗ không thể cùng
   * ghi một giá trị.
   */
  async moveTask(
    actor: Actor,
    projectId: string,
    taskId: string,
    input: MoveTaskRequest,
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (task: TaskView) => unknown,
  ): Promise<TaskView> {
    const today = await this.#deps.clock.todayForProject(projectId);

    return await this.#deps.db.transaction(async (tx) => {
      const current = await this.#deps.repository.findTaskInProject(projectId, taskId, tx);
      if (current === undefined) throw new AppError("NOT_FOUND");

      const destination = await this.#deps.columns.findColumnInProject(
        projectId,
        input.destinationColumnId,
        tx,
      );
      assertUsableColumn(destination);
      const target = destination as NonNullable<typeof destination>;

      assertReviewerOnlyWhenRequired({
        columnRequiresReviewer: target.requiresReviewer,
        reviewerSent: input.reviewerId !== undefined,
      });

      const effectiveReviewer = input.reviewerId ?? current.reviewerId;
      if (input.reviewerId !== undefined) {
        assertReviewerIsMember(
          (await this.#deps.membership.projectRole(projectId, input.reviewerId, tx)) !== undefined,
        );
      }
      assertReviewerNotAssignee({
        assigneeId: current.assigneeId,
        reviewerId: effectiveReviewer,
      });
      assertReviewerWhenColumnRequires({
        columnRequiresReviewer: target.requiresReviewer,
        reviewerId: effectiveReviewer,
      });

      // Khoá dãy ordering của **cột đích** trước khi đọc nó.
      await this.#deps.repository.lockColumnOrdering(input.destinationColumnId, tx);
      const siblings = await this.#deps.repository.lockColumnTasks(
        projectId,
        input.destinationColumnId,
        tx,
      );

      const plan = planMove(siblings, parsePosition(input.targetPosition), taskId);
      await this.#deps.repository.applyPositions(plan.rebalance, tx);

      const moved = await this.#deps.repository.moveTask(
        {
          projectId,
          taskId,
          expectedVersion: input.expectedVersion,
          columnId: input.destinationColumnId,
          position: plan.position,
          reviewerId: input.reviewerId,
          now: this.#now,
        },
        tx,
      );

      if (moved === undefined) {
        const currentVersion = await this.#deps.repository.currentVersion(projectId, taskId, tx);
        if (currentVersion === undefined) throw new AppError("NOT_FOUND");
        throw versionConflict(currentVersion);
      }

      /**
       * **Đúng một** activity cho một move commit — ADR-0008 mục 5.
       *
       * Rời một cột terminal sang cột không terminal là **mở lại**, và nó ghi
       * `task.reopened` **thay cho** `task.moved`, không phải thêm vào. Ghi cả
       * hai sẽ biến một thao tác thành hai dòng lịch sử và làm mọi phép đếm
       * rework sai gấp đôi.
       */
      const reopened = current.columnIsTerminal && !target.isTerminal;

      await this.#deps.activity.record(tx, {
        projectId,
        taskId,
        actorUserId: actor.id,
        action: reopened ? "task.reopened" : "task.moved",
        payload: {
          taskId,
          fromColumnId: current.columnId,
          toColumnId: input.destinationColumnId,
          rebalanced: plan.rebalance.length,
        },
      });

      const after = await this.#deps.repository.findTaskInProject(projectId, taskId, tx);
      if (after === undefined) throw new AppError("INTERNAL_ERROR");

      const view = this.#toView(after, today);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /* ---------------------------------------------------------------------- *
   * Nội bộ
   * ---------------------------------------------------------------------- */

  /** Assignee và reviewer, nếu có, phải là ProjectMember cùng project. */
  async #validatePeople(
    tx: Transaction,
    projectId: string,
    people: { assigneeId: string | null; reviewerId: string | null },
  ): Promise<void> {
    if (people.assigneeId !== null) {
      assertAssigneeIsMember(
        (await this.#deps.membership.projectRole(projectId, people.assigneeId, tx)) !== undefined,
      );
    }
    if (people.reviewerId !== null) {
      assertReviewerIsMember(
        (await this.#deps.membership.projectRole(projectId, people.reviewerId, tx)) !== undefined,
      );
    }
  }

  #toView(row: TaskRow, today: string): TaskView {
    return {
      id: row.id,
      projectId: row.projectId,
      columnId: row.columnId,
      createdByUserId: row.createdByUserId,
      createdByDisplayName: row.createdByDisplayName,
      assigneeId: row.assigneeId,
      reviewerId: row.reviewerId,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      startDate: row.startDate,
      dueDate: row.dueDate,
      dueState: deriveDueState({
        dueDate: row.dueDate,
        isTerminal: row.columnIsTerminal,
        today,
      }),
      evidenceUrl: row.evidenceUrl,
      position: row.position,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Field của phase chưa mở: **từ chối**, không bỏ qua im lặng.
 *
 * `updateTaskRequestSchema` nhận cả `sprintId` (Phase 1.4) và `parentTaskId`
 * (Phase 1.5) — chúng có mặt trong hợp đồng từ bây giờ để client không phải
 * đoán khi phase đó bật. Nhưng ở core MVP hai cột đó **không tồn tại** trong
 * database, nên một patch mang chúng không thể được thực hiện.
 *
 * Bỏ qua im lặng là cách biến một client sai thành một client tưởng mình đúng:
 * nó gửi `sprintId`, nhận `200`, và tin rằng task đã vào sprint. `400` nói
 * thẳng rằng phase chưa mở.
 */
function assertNoUnopenedPhaseFields(input: UpdateTaskRequest): void {
  const body = input as Record<string, unknown>;
  const unopened: { field: string; phase: string }[] = [
    { field: "sprintId", phase: "1.4" },
    { field: "parentTaskId", phase: "1.5" },
  ];

  const sent = unopened.filter((entry) => entry.field in body);
  if (sent.length === 0) return;

  throw validationError(
    sent.map((entry) => ({
      field: entry.field,
      code: "phase_not_enabled",
      message: `Trường này thuộc Phase ${entry.phase} và chưa được bật.`,
    })),
  );
}

/**
 * Lấy đúng các field nội dung mà client gửi.
 *
 * Duyệt theo **allowlist** chứ không xoá `expectedVersion` khỏi body: xoá theo
 * danh sách đen nghĩa là một field mới thêm vào schema sẽ tự động đi thẳng vào
 * câu `UPDATE`. Ở đây thêm một field phải sửa `PATCH_FIELDS`.
 */
function pickPatch(input: UpdateTaskRequest): Record<string, unknown> {
  const body = input as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    // `field in body` chứ không `body[field] !== undefined`: gửi `null` tường
    // minh là "xoá liên kết", và nó phải đi vào patch. Bỏ qua `undefined` mà
    // giữ `null` là đúng khác biệt giữa "không nhắc tới" và "đặt về rỗng".
    if (field in body) patch[field] = emptyValueForColumn(field, body[field]);
  }
  return patch;
}

/**
 * Quy đổi "rỗng" của hợp đồng sang "rỗng" của database — đúng một chỗ.
 *
 * Hợp đồng cho `description` và `priority` nhận `null` ("xoá nội dung", "bỏ độ
 * ưu tiên"), nhưng hai cột đó là `NOT NULL DEFAULT ''` và `NOT NULL DEFAULT
 * 'none'`. `createTask` đã quy đổi từ M4; **`updateTask` thì chưa**, nên một
 * `PATCH` mang `description: null` đi thẳng vào `UPDATE` và nổ ở constraint —
 * `500 INTERNAL_ERROR`, không phải một lỗi hợp đồng.
 *
 * Vì sao chưa ai thấy: đó chính là một trong bảy endpoint mà preflight CORS
 * chặn, nên `PATCH /tasks/:taskId` **chưa bao giờ rời được trình duyệt**. Test
 * `inject()` của `apps/api` thì luôn gửi `description` là chuỗi, nên cũng không
 * chạm vào nhánh này. Lỗi sống ở đúng khe mà M5.5 mở ra.
 *
 * Quy đổi đặt ở đây, không ở repository: repository nhận một patch đã là hình
 * dạng của database, và một `?? ""` nằm rải trong câu `UPDATE` là chỗ lần sau
 * thêm cột sẽ quên.
 */
function emptyValueForColumn(field: string, value: unknown): unknown {
  if (value !== null) return value;
  if (field === "description") return "";
  if (field === "priority") return "none";
  // Mọi field còn lại (`assigneeId`, `reviewerId`, `category`, ngày tháng,
  // `evidenceUrl`) là cột nullable thật: `null` ở đó **là** giá trị cần ghi.
  return null;
}
