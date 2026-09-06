import { and, asc, eq, gt, notInArray, or } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { users, workspaceMembers } from "../../../shared/database/schema.ts";
import type {
  WorkspaceMembershipPort,
  WorkspaceRosterEntry,
  WorkspaceRosterSeek,
} from "../domain/workspace-membership-port.ts";

/**
 * Adapter cho `WorkspaceMembershipPort`.
 *
 * Port do `projects` định nghĩa; adapter này hiện thực nó bằng những truy vấn
 * đọc hẹp. Mỗi method trả **đúng** thứ một hợp đồng đã công bố cần: một boolean
 * cho câu hỏi membership, và ba field của `memberCandidateSchema` cho roster.
 * Trả rộng hơn thế là mở đường cho `projects` bắt đầu phụ thuộc vào hình dạng
 * dữ liệu của `workspaces` — và cho một field không ai duyệt đi ra response.
 *
 * Ở M2 adapter sống trong `projects/infrastructure` vì `workspaces` chưa export
 * gì cho consumer khác. Khi module `workspaces` cần export port này cho module
 * thứ hai, nó chuyển sang bên đó và composition root nối lại — chiều import
 * không đổi.
 */
export class DrizzleWorkspaceMembershipAdapter implements WorkspaceMembershipPort {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async isWorkspaceMember(input: {
    workspaceId: string;
    userId: string;
    tx?: unknown;
  }): Promise<boolean> {
    const executor = (input.tx as Transaction | undefined) ?? this.#db;
    const [row] = await executor
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      );
    return row !== undefined;
  }

  /**
   * Một trang roster, loại trừ ngay **trong** câu truy vấn.
   *
   * Ba thứ phải nằm cùng một câu, và tách bất kỳ thứ nào ra là một lỗi phân
   * trang khác nhau:
   *
   * 1. **Loại trừ** — `not in (:excluded)`. Lọc sau khi cắt trang làm trang
   *    ngắn không đều và bỏ sót người ở ranh giới.
   * 2. **Seek** — `(display_name, user_id) > (:lastName, :lastId)`, viết thành
   *    `or` thay vì row-value comparison để câu SQL đọc được và khớp thẳng với
   *    thứ tự `order by`. Cùng lối với `findProjectsForActorInWorkspace`.
   * 3. **`limit + 1`** — người gọi đọc dư một hàng để biết `hasMore` mà không
   *    cần một câu `COUNT` thứ hai trên cùng điều kiện.
   *
   * `asc` tường minh cho cả hai cột: `display_name` là `NOT NULL` nên thứ tự
   * NULL không đổi ngữ nghĩa ở đây, nhưng nêu rõ chiều giữ cho câu truy vấn và
   * bất kỳ index nào sau này nói cùng một ngôn ngữ — cùng bài học mà `EXPLAIN`
   * của M4 vừa dạy ở `tasks`.
   *
   * Projection đúng ba field của `memberCandidateSchema`. Không `role`, không
   * `created_at`: adapter trả nhiều hơn hợp đồng là chỗ một field thừa lặng lẽ
   * đi ra ngoài ở lần refactor sau.
   */
  async listWorkspaceRoster(input: {
    workspaceId: string;
    excludeUserIds: readonly string[];
    limit: number;
    after?: WorkspaceRosterSeek;
    tx?: unknown;
  }): Promise<WorkspaceRosterEntry[]> {
    const executor = (input.tx as Transaction | undefined) ?? this.#db;

    const scope = eq(workspaceMembers.workspaceId, input.workspaceId);

    /**
     * Mảng rỗng **không** được đi vào `notInArray`.
     *
     * Drizzle dựng `not in ()` cho mảng rỗng, và đó là SQL không hợp lệ. Một
     * project chưa có member nào là ca bình thường, không phải ca hiếm — bỏ
     * hẳn điều kiện là cách đúng.
     */
    const excluded =
      input.excludeUserIds.length === 0
        ? undefined
        : notInArray(workspaceMembers.userId, [...input.excludeUserIds]);

    const seek =
      input.after === undefined
        ? undefined
        : or(
            gt(users.displayName, input.after.displayName),
            and(
              eq(users.displayName, input.after.displayName),
              gt(workspaceMembers.userId, input.after.userId),
            ),
          );

    const conditions = [scope, excluded, seek].filter((part) => part !== undefined);

    return (await executor
      .select({
        userId: workspaceMembers.userId,
        displayName: users.displayName,
        email: users.email,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(...conditions))
      .orderBy(asc(users.displayName), asc(workspaceMembers.userId))
      .limit(input.limit + 1)) as WorkspaceRosterEntry[];
  }
}
