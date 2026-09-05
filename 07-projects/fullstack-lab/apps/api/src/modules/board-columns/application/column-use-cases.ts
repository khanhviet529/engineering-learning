import type { Database } from "../../../shared/database/client.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import type { Actor } from "../../../shared/authorization/index.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import type { ActivityRecorder } from "../../activity/domain/activity-recorder.ts";
import {
  assertColumnEmpty,
  assertCompleteReorder,
  assertNotArchived,
  assertValidAnchor,
} from "../domain/column-rules.ts";
import type { ColumnEmptinessCheck } from "../domain/column-emptiness-check.ts";
import { planInsert, reorderedPositions } from "../../../shared/ordering/position.ts";
import type { ColumnRepository, ColumnRow } from "../infrastructure/column-repository.ts";

/**
 * Use case của module `board-columns`.
 *
 * Thứ tự trong mỗi mutation là cố định: **khoá dãy ordering → đọc lại trạng
 * thái → validate → ghi → activity → outcome**, tất cả trong một transaction.
 *
 * Khoá **trước khi đọc** là điểm dễ làm ngược. Đọc rồi mới khoá nghĩa là hai
 * request cùng nhìn một dãy position, cùng tính một trung điểm, rồi mới tranh
 * nhau ghi — và cái thua nhận một unique violation thay vì một thứ tự đúng.
 */

export interface ColumnDeps {
  db: Database;
  repository: ColumnRepository;
  activity: ActivityRecorder;
  emptiness: ColumnEmptinessCheck;
  now?: () => Date;
}

export interface ColumnView {
  id: string;
  projectId: string;
  name: string;
  requiresReviewer: boolean;
  isTerminal: boolean;
  position: bigint;
  archivedAt: Date | null;
}

function toView(row: ColumnRow): ColumnView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    requiresReviewer: row.requiresReviewer,
    isTerminal: row.isTerminal,
    position: row.position,
    archivedAt: row.archivedAt,
  };
}

export class ColumnUseCases {
  readonly #deps: ColumnDeps;

  constructor(deps: ColumnDeps) {
    this.#deps = deps;
  }

  get #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /**
   * `POST /projects/:projectId/columns`.
   *
   * `afterColumnId` là *gợi ý vị trí*: server validate lại rằng nó active và
   * cùng project, rồi **tự tính** position. Client không gửi position ở bất kỳ
   * đâu — đó là lý do reorder không thể trở thành một bulk table update.
   *
   * ## `afterColumnId: null` nghĩa là **append**, không phải prepend
   *
   * Hợp đồng chỉ nói `afterColumnId` nullable, không nói `null` nghĩa gì. Hai
   * cách đọc đều có lý, nên chỗ quyết định là hai bằng chứng khác:
   *
   * - `packages/mock` trả `position: "5120.0000000000"` cho `afterColumnId:
   *   null` trên một board có bốn cột `1024..4096` — tức `max + 1024`, append.
   *   Đó là thứ frontend đang viết theo.
   * - ADR-0006 mục 1 liệt kê append (`max(position) + 1024`) là một trong ba
   *   trường hợp cơ bản; với `null` = prepend thì append chỉ gọi được bằng cách
   *   client tự tìm cột cuối, và affordance "thêm cột" nằm ở **cuối** board sẽ
   *   đẻ ra một cột ở đầu.
   *
   * Hệ quả: M3 **không** có đường prepend qua HTTP. Đó là mất mát thật nhưng
   * nhỏ — reorder làm được việc đó — và nó được ghi ra đây thay vì im lặng.
   * `planInsert` vẫn giữ nhánh prepend vì M4 dùng lại nó cho task, nơi thả một
   * task lên đầu column là thao tác có thật.
   */
  async createColumn(
    actor: Actor,
    projectId: string,
    input: {
      name: string;
      afterColumnId: string | null;
      isTerminal: boolean;
      requiresReviewer: boolean;
    },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (column: ColumnView) => unknown,
  ): Promise<ColumnView> {
    return await this.#deps.db.transaction(async (tx) => {
      // Khoá dãy ordering trước khi đọc nó — xem `lockProjectOrdering` để biết
      // vì sao `FOR UPDATE` một mình không đủ cho một lệnh **thêm** row.
      await this.#deps.repository.lockProjectOrdering(projectId, tx);
      const existing = await this.#deps.repository.lockActiveColumns(projectId, tx);

      if (input.afterColumnId !== null) {
        assertValidAnchor(existing.some((column) => column.id === input.afterColumnId));
      }

      // Không có mốc ⇒ append: mốc là cột cuối cùng, hoặc `null` khi board rỗng.
      const anchorId = input.afterColumnId ?? existing.at(-1)?.id ?? null;

      const plan = planInsert(
        existing.map((column) => ({ id: column.id, position: column.position })),
        anchorId,
      );

      /**
       * Rebalance **trước** khi chèn, trong cùng transaction.
       *
       * `planInsert` đã tính `plan.position` trên các giá trị **sau** rebalance,
       * nên hai bước này phải đi cùng nhau: ghi position mới cho các row cũ rồi
       * mới insert.
       */
      await this.#deps.repository.applyPositions(plan.rebalance, tx);

      const created = await this.#deps.repository.insertColumn(
        {
          projectId,
          name: input.name,
          position: plan.position,
          isTerminal: input.isTerminal,
          requiresReviewer: input.requiresReviewer,
        },
        tx,
      );

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "board_column.created",
        payload: {
          columnId: created.id,
          name: created.name,
          isTerminal: created.isTerminal,
          requiresReviewer: created.requiresReviewer,
          /**
           * Số row bị rebalance trong chính lần chèn này.
           *
           * Rebalance là hành vi **của server**, không có endpoint và không có
           * response field nào nói nó vừa chạy — nên nếu không ghi ở đây thì
           * không tồn tại chỗ nào quan sát được nó, kể cả từ test. Con số này
           * là `0` ở gần như mọi lần chèn; khác `0` là dấu hiệu một project vừa
           * chạm ngưỡng mật độ.
           */
          rebalanced: plan.rebalance.length,
        },
      });

      const view = toView(created);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /**
   * `PATCH /columns/:columnId` — đúng **một** command mỗi request.
   *
   * Bốn nhánh, và ba trong số đó cố ý **không hồi tố**. Xem `column-rules.ts`
   * và repository cho lý do từng cái.
   */
  async updateColumn(
    actor: Actor,
    projectId: string,
    columnId: string,
    command:
      | { kind: "rename"; name: string }
      | { kind: "terminal"; isTerminal: boolean }
      | { kind: "reviewer"; requiresReviewer: boolean }
      | { kind: "archive" },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (column: ColumnView) => unknown,
  ): Promise<ColumnView> {
    return await this.#deps.db.transaction(async (tx) => {
      const current = await this.#deps.repository.findColumnInProject(projectId, columnId, tx);
      // Cột của project khác đã bị guard chặn bằng `404`; tới đây `undefined`
      // nghĩa là cột không tồn tại.
      if (current === undefined) throw new AppError("NOT_FOUND");

      const now = this.#now;
      let updated: ColumnRow | undefined;
      let action:
        | "board_column.renamed"
        | "board_column.terminal_changed"
        | "board_column.reviewer_requirement_changed"
        | "board_column.archived";
      let payload: Record<string, unknown>;

      switch (command.kind) {
        case "rename": {
          updated = await this.#deps.repository.renameColumn(
            { projectId, columnId, name: command.name, now },
            tx,
          );
          action = "board_column.renamed";
          payload = { columnId, from: current.name, to: command.name };
          break;
        }

        case "terminal": {
          updated = await this.#deps.repository.setTerminal(
            { projectId, columnId, isTerminal: command.isTerminal, now },
            tx,
          );
          action = "board_column.terminal_changed";
          payload = { columnId, from: current.isTerminal, to: command.isTerminal };
          break;
        }

        case "reviewer": {
          updated = await this.#deps.repository.setRequiresReviewer(
            { projectId, columnId, requiresReviewer: command.requiresReviewer, now },
            tx,
          );
          action = "board_column.reviewer_requirement_changed";
          payload = { columnId, from: current.requiresReviewer, to: command.requiresReviewer };
          break;
        }

        case "archive": {
          assertNotArchived(current.archivedAt);

          /**
           * Hỏi port **bên trong** transaction.
           *
           * Hỏi ngoài transaction là đọc một con số có thể đã cũ vào lúc ghi:
           * giữa lần đọc và lần ghi, một Editor có thể vừa tạo task vào đúng
           * cột này.
           */
          const hasTasks = await this.#deps.emptiness.hasTasks({ projectId, columnId, tx });
          assertColumnEmpty(hasTasks);

          updated = await this.#deps.repository.archiveColumn({ projectId, columnId, now }, tx);
          action = "board_column.archived";
          payload = { columnId, name: current.name };
          break;
        }
      }

      if (updated === undefined) throw new AppError("NOT_FOUND");

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action,
        payload,
      });

      const view = toView(updated);
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(view));
      }
      return view;
    });
  }

  /**
   * `POST /columns/reorder`.
   *
   * Nhận **toàn bộ** cột active, mỗi ID đúng một lần, và ghi **đúng một**
   * activity — không phải một event mỗi cột. Một event mỗi cột sẽ biến một
   * thao tác của người dùng thành N dòng lịch sử, và người đọc audit không còn
   * thấy được rằng đó là một lần sắp lại.
   */
  async reorderColumns(
    actor: Actor,
    projectId: string,
    orderedColumnIds: readonly string[],
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (columns: ColumnView[]) => unknown,
  ): Promise<ColumnView[]> {
    return await this.#deps.db.transaction(async (tx) => {
      await this.#deps.repository.lockProjectOrdering(projectId, tx);
      const active = await this.#deps.repository.lockActiveColumns(projectId, tx);

      assertCompleteReorder({
        submitted: orderedColumnIds,
        activeIds: active.map((column) => column.id),
      });

      const positions = reorderedPositions(orderedColumnIds);
      await this.#deps.repository.applyPositions(positions, tx);

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "board_column.reordered",
        payload: { columnIds: [...orderedColumnIds] },
      });

      // Đọc lại để trả **thứ tự đã commit**, không phải thứ tự client gửi: hai
      // thứ này phải trùng nhau, và đọc lại là cách chứng minh chúng trùng.
      const committed = await this.#deps.repository.findActiveColumns(projectId, tx);
      const views = committed.map(toView);

      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(views));
      }
      return views;
    });
  }
}
