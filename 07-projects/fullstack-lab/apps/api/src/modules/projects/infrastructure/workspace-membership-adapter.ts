import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { workspaceMembers } from "../../../shared/database/schema.ts";
import type { WorkspaceMembershipPort } from "../domain/workspace-membership-port.ts";

/**
 * Adapter cho `WorkspaceMembershipPort`.
 *
 * Port do `projects` định nghĩa; adapter này hiện thực nó bằng một truy vấn
 * đọc hẹp. Nó cố ý **chỉ** trả một boolean: `projects` chỉ cần biết "có phải
 * thành viên không", và trả nhiều hơn thế sẽ mở đường cho `projects` bắt đầu
 * phụ thuộc vào hình dạng dữ liệu của `workspaces`.
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
}
