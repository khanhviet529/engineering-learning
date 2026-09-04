import { and, eq } from "drizzle-orm";
import type { ProjectRole, WorkspaceRole } from "@flowboard/contracts";
import type { Database, Transaction } from "../database/client.ts";
import { projectMembers, projects, workspaceMembers } from "../database/schema.ts";

/**
 * Kernel đọc membership và role — [ADR-0005](../../../../../docs/decisions/ADR-0005-module-dependency-and-activity-boundary.md).
 *
 * Đây là một **ngoại lệ có chủ đích** của quy tắc "module không đọc bảng của
 * module khác". Lý do ngoại lệ tồn tại, và vì sao nó an toàn:
 *
 * - Nhiều module cần biết vai trò của actor trước khi chạy use case. Nếu mỗi
 *   module tự đọc `project_members`, quyết định quyền sẽ có nhiều bản sao, và
 *   một bản sao sửa sót là một lỗ hổng.
 * - Kernel **không import module nào**, nên nó không thể tạo cycle trong đồ thị
 *   phụ thuộc. Chiều phụ thuộc chỉ có một: module → kernel.
 * - Nó **chỉ đọc**. Mọi mutation membership vẫn thuộc duy nhất module
 *   `workspaces` và `projects`. Một kernel biết ghi sẽ nhanh chóng trở thành
 *   đường vòng để sửa quyền mà không đi qua invariant của use case.
 */

export type Executor = Database | Transaction;

/** Actor đã xác thực. Kernel nhận nó, không tự resolve session. */
export interface Actor {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
}

export class MembershipReader {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Vai trò workspace của actor, hoặc `undefined` khi không phải thành viên.
   *
   * Trả `undefined` thay vì ném lỗi là có chủ đích: "không phải thành viên"
   * không phải một trường hợp ngoại lệ, nó là câu trả lời bình thường và phổ
   * biến nhất. Người gọi quyết định nó thành `404` hay `403`.
   */
  async workspaceRole(
    workspaceId: string,
    userId: string,
    tx?: Executor,
  ): Promise<WorkspaceRole | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return row?.role as WorkspaceRole | undefined;
  }

  /** Vai trò project của actor, hoặc `undefined` khi không có dòng membership. */
  async projectRole(
    projectId: string,
    userId: string,
    tx?: Executor,
  ): Promise<ProjectRole | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return row?.role as ProjectRole | undefined;
  }

  /**
   * Workspace sở hữu một project.
   *
   * `ResourceProjectResolver` cần nó để trả lời "project này thuộc workspace
   * nào", chứ **không** phải để cấp quyền: biết workspace của một project không
   * cho ai quyền đọc project đó.
   */
  async projectWorkspaceId(projectId: string, tx?: Executor): Promise<string | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row?.workspaceId;
  }
}
