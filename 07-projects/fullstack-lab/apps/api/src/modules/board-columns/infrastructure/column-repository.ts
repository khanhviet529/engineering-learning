import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { boardColumns } from "../../../shared/database/schema.ts";
import type { PositionedItem } from "../domain/ordering.ts";

/**
 * Repository của module `board-columns`.
 *
 * **Nơi duy nhất** trong module chạm Drizzle, và mọi truy vấn tự mang scope
 * `project_id`. Guard đã authorize trước, nhưng repository không dựa vào điều
 * đó: `:columnId` là **locator, không phải bằng chứng quyền**, và hai lớp chỉ
 * có giá trị khi lớp này không giả định lớp kia đã chạy đúng.
 */

type Executor = Database | Transaction;

export interface ColumnRow {
  id: string;
  projectId: string;
  name: string;
  requiresReviewer: boolean;
  isTerminal: boolean;
  position: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const columnProjection = {
  id: boardColumns.id,
  projectId: boardColumns.projectId,
  name: boardColumns.name,
  requiresReviewer: boardColumns.requiresReviewer,
  isTerminal: boardColumns.isTerminal,
  position: boardColumns.position,
  archivedAt: boardColumns.archivedAt,
  createdAt: boardColumns.createdAt,
  updatedAt: boardColumns.updatedAt,
} as const;

export class ColumnRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Khoá **dãy ordering của một project** trong suốt transaction.
   *
   * `FOR UPDATE` một mình không đủ, và lý do đáng viết ra: nó khoá *các row đã
   * đọc được*. Hai lần `POST /columns` đồng thời đều đọc cùng một tập cột, đều
   * khoá đúng tập đó — rồi cả hai `INSERT` một row **mới**, thứ không nằm trong
   * tập nào cả. Ở READ COMMITTED, transaction thứ hai không hề thấy row của
   * transaction thứ nhất, nên cả hai tính ra cùng `max + 1024` và cái thua nhận
   * một unique violation, tức `500` cho một request hoàn toàn hợp lệ.
   *
   * Cùng lỗ hổng ở chiều create-rồi-reorder: reorder quét trước, create commit
   * xen vào, và `assertCompleteReorder` sẽ hài lòng với một tập cột đã cũ — cột
   * mới ở lại vị trí cũ mà không ai báo.
   *
   * Advisory lock đóng cả hai vì nó khoá **ý định** ("tôi đang sắp lại cột của
   * project này") chứ không khoá một tập row cụ thể. `xact` nghĩa là nó tự nhả
   * lúc commit hay rollback, nên không có đường quên nhả.
   *
   * Không khoá row `projects` thay thế: rename project sẽ phải xếp hàng sau một
   * lần reorder, và hai thao tác đó không có gì chung.
   */
  async lockProjectOrdering(projectId: string, tx: Transaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId + ":board_columns"}))`);
  }

  /** Cột **active** của một project, theo thứ tự board. */
  async findActiveColumns(projectId: string, tx?: Executor): Promise<ColumnRow[]> {
    return (await (tx ?? this.#db)
      .select(columnProjection)
      .from(boardColumns)
      .where(and(eq(boardColumns.projectId, projectId), isNull(boardColumns.archivedAt)))
      .orderBy(asc(boardColumns.position), asc(boardColumns.id))) as ColumnRow[];
  }

  /**
   * Cột active của một project, **có khoá hàng**.
   *
   * `FOR UPDATE` là thứ tuần tự hoá hai request cùng chèn hoặc cùng reorder một
   * project. Không khoá thì cả hai đọc cùng một dãy position, cả hai tính cùng
   * một trung điểm, và cả hai ghi — một cái thắng ở unique constraint, hoặc tệ
   * hơn, cả hai thắng ở hai khe khác nhau và thứ tự cuối không phải thứ tự nào
   * trong hai request.
   *
   * ADR-0006 mục 4 gọi đây là "row lock trên các row bị ảnh hưởng". Nó là lớp
   * thứ hai: `lockProjectOrdering` tuần tự hoá các lần sắp lại, còn `FOR UPDATE`
   * giữ đúng những row sắp bị ghi khỏi bị một thao tác khác (archive, rename)
   * đổi giữa lúc đọc và lúc ghi.
   */
  async lockActiveColumns(projectId: string, tx: Executor): Promise<ColumnRow[]> {
    return (await tx
      .select(columnProjection)
      .from(boardColumns)
      .where(and(eq(boardColumns.projectId, projectId), isNull(boardColumns.archivedAt)))
      .orderBy(asc(boardColumns.position), asc(boardColumns.id))
      .for("update")) as ColumnRow[];
  }

  /** Một cột theo ID, **scope theo project** đã được authorize. */
  async findColumnInProject(
    projectId: string,
    columnId: string,
    tx?: Executor,
  ): Promise<ColumnRow | undefined> {
    const [row] = await (tx ?? this.#db)
      .select(columnProjection)
      .from(boardColumns)
      .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)));
    return row as ColumnRow | undefined;
  }

  /**
   * Project sở hữu một cột — dùng bởi `ResourceProjectResolver`.
   *
   * Đây là lượt đọc **trước** authorization, và nó cố ý chỉ trả `project_id`:
   * resolver cần biết cột thuộc project nào để authorize, không cần gì khác.
   */
  async findOwningProjectId(columnId: string, tx?: Executor): Promise<string | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ projectId: boardColumns.projectId })
      .from(boardColumns)
      .where(eq(boardColumns.id, columnId));
    return row?.projectId;
  }

  async insertColumn(
    input: {
      projectId: string;
      name: string;
      position: number;
      isTerminal: boolean;
      requiresReviewer: boolean;
    },
    tx: Executor,
  ): Promise<ColumnRow> {
    const [row] = await tx.insert(boardColumns).values(input).returning(columnProjection);
    return row as ColumnRow;
  }

  /**
   * Ghi lại position cho một tập row — **chỉ** `position`.
   *
   * Không `updated_at`, không version. ADR-0006 mục 5: `position` do server sở
   * hữu tuyệt đối nên `version` không có gì để bảo vệ ở đây, và chạm
   * `updated_at` sẽ xáo seek pagination theo `updated_at DESC` — người đang
   * cuộn nhận row trùng hoặc mất row.
   *
   * `SET CONSTRAINTS ... DEFERRED` phải chạy **trước** lệnh ghi đầu tiên: với
   * giá trị hiện hành tuỳ ý, không tồn tại thứ tự update nào tránh được trùng ở
   * mọi bước trung gian mà không dùng mẹo hai lượt. Defer cho phép trạng thái
   * trung gian trùng; uniqueness vẫn được kiểm đầy đủ tại commit.
   */
  async applyPositions(positions: readonly PositionedItem[], tx: Transaction): Promise<void> {
    if (positions.length === 0) return;

    await tx.execute(sql`set constraints "board_columns_project_position_uniq" deferred`);

    for (const item of positions) {
      await tx
        .update(boardColumns)
        .set({ position: item.position })
        .where(eq(boardColumns.id, item.id));
    }
  }

  /** Đổi tên. Đây là thay đổi do user nên `updated_at` **được** cập nhật. */
  async renameColumn(
    input: { projectId: string; columnId: string; name: string; now: Date },
    tx: Executor,
  ): Promise<ColumnRow | undefined> {
    const [row] = await tx
      .update(boardColumns)
      .set({ name: input.name, updatedAt: input.now })
      .where(and(eq(boardColumns.id, input.columnId), eq(boardColumns.projectId, input.projectId)))
      .returning(columnProjection);
    return row as ColumnRow | undefined;
  }

  /**
   * Đổi cờ `is_terminal`.
   *
   * Chỉ chạm đúng cột đó cùng `updated_at`. **Không** `position`, **không**
   * `archived_at`, và không task nào bị dời: cờ này chỉ đổi cách suy `due_state`
   * **từ thời điểm đó**.
   */
  async setTerminal(
    input: { projectId: string; columnId: string; isTerminal: boolean; now: Date },
    tx: Executor,
  ): Promise<ColumnRow | undefined> {
    const [row] = await tx
      .update(boardColumns)
      .set({ isTerminal: input.isTerminal, updatedAt: input.now })
      .where(and(eq(boardColumns.id, input.columnId), eq(boardColumns.projectId, input.projectId)))
      .returning(columnProjection);
    return row as ColumnRow | undefined;
  }

  /**
   * Đổi cờ `requires_reviewer`.
   *
   * Chỉ áp cho create/move **sau đó**; không hồi tố lên task đang nằm trong
   * cột. Hồi tố sẽ biến một thao tác cấu hình thành một đợt vi phạm invariant
   * hàng loạt mà không ai yêu cầu.
   */
  async setRequiresReviewer(
    input: { projectId: string; columnId: string; requiresReviewer: boolean; now: Date },
    tx: Executor,
  ): Promise<ColumnRow | undefined> {
    const [row] = await tx
      .update(boardColumns)
      .set({ requiresReviewer: input.requiresReviewer, updatedAt: input.now })
      .where(and(eq(boardColumns.id, input.columnId), eq(boardColumns.projectId, input.projectId)))
      .returning(columnProjection);
    return row as ColumnRow | undefined;
  }

  /** Archive: đặt `archived_at`. Row được giữ cho lịch sử, không delete. */
  async archiveColumn(
    input: { projectId: string; columnId: string; now: Date },
    tx: Executor,
  ): Promise<ColumnRow | undefined> {
    const [row] = await tx
      .update(boardColumns)
      .set({ archivedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(boardColumns.id, input.columnId),
          eq(boardColumns.projectId, input.projectId),
          isNull(boardColumns.archivedAt),
        ),
      )
      .returning(columnProjection);
    return row as ColumnRow | undefined;
  }
}
