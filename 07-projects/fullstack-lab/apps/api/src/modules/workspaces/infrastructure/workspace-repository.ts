import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { WorkspaceRole } from "@flowboard/contracts";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import {
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "../../../shared/database/schema.ts";

/**
 * Repository của module `workspaces`.
 *
 * Đây là **nơi duy nhất** trong module chạm Drizzle. Mỗi method mang tên đúng
 * truy vấn mà một use case cần — `findWorkspacesForActor`, không phải `findAll`.
 * Lý do không phải là thẩm mỹ: một `findAll(filter)` tổng quát buộc use case
 * phải tự ghép điều kiện scope, và điều kiện scope ghép ở tầng use case là chỗ
 * người ta quên `workspace_id` rồi trả nhầm dữ liệu của tenant khác.
 *
 * Mọi truy vấn ở đây **tự mang scope của nó**. Guard đã chạy trước, nhưng
 * repository không dựa vào điều đó: đây là lớp phòng thủ thứ hai, và nó chỉ có
 * giá trị khi nó độc lập với lớp thứ nhất.
 */

type Executor = Database | Transaction;

export interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceWithRole extends WorkspaceRow {
  role: WorkspaceRole;
}

export interface WorkspaceMemberRow {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
}

/** Vị trí seek của cursor: khoá sort chính cộng `id` tie-breaker. */
export interface SeekPosition {
  createdAt: Date;
  id: string;
}

export class WorkspaceRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Các workspace mà actor **là thành viên** — không phải "tất cả workspace".
   *
   * Join qua `workspace_members` là chính scope: không có dòng membership thì
   * không có hàng nào. Không tồn tại đường gọi method này mà quên lọc theo
   * actor, vì `userId` là tham số bắt buộc và điều kiện nằm bên trong.
   *
   * Đọc `limit + 1` hàng để biết `hasMore` mà không cần một câu `COUNT` thứ hai.
   */
  async findWorkspacesForActor(
    userId: string,
    limit: number,
    after?: SeekPosition,
    tx?: Executor,
  ): Promise<WorkspaceWithRole[]> {
    const scope = eq(workspaceMembers.userId, userId);

    // Seek pagination: `(created_at, id) < (cursor.createdAt, cursor.id)` theo
    // thứ tự giảm dần. Viết thành `or` thay vì row-value comparison để giữ
    // câu SQL đọc được và khớp trực tiếp với index composite.
    const seek =
      after === undefined
        ? undefined
        : or(
            lt(workspaces.createdAt, after.createdAt),
            and(eq(workspaces.createdAt, after.createdAt), lt(workspaces.id, after.id)),
          );

    return (await (tx ?? this.#db)
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(seek === undefined ? scope : and(scope, seek))
      .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
      .limit(limit + 1)) as WorkspaceWithRole[];
  }

  /**
   * Thành viên của **một** workspace đã được authorize.
   *
   * `workspaceId` là tham số bắt buộc và điều kiện `where` dùng nó trực tiếp:
   * không có biến thể "lấy hết member của mọi workspace".
   */
  async findMembersOfWorkspace(
    workspaceId: string,
    limit: number,
    after?: SeekPosition,
    tx?: Executor,
  ): Promise<WorkspaceMemberRow[]> {
    const scope = eq(workspaceMembers.workspaceId, workspaceId);

    const seek =
      after === undefined
        ? undefined
        : or(
            lt(workspaceMembers.createdAt, after.createdAt),
            and(
              eq(workspaceMembers.createdAt, after.createdAt),
              lt(workspaceMembers.userId, after.id),
            ),
          );

    return (await (tx ?? this.#db)
      .select({
        userId: workspaceMembers.userId,
        displayName: users.displayName,
        email: users.email,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(seek === undefined ? scope : and(scope, seek))
      .orderBy(desc(workspaceMembers.createdAt), desc(workspaceMembers.userId))
      .limit(limit + 1)) as WorkspaceMemberRow[];
  }

  /** Tạo workspace và membership admin của creator trong **cùng** transaction. */
  async createWorkspaceWithAdmin(
    input: { name: string; creatorUserId: string; creatorRole: WorkspaceRole },
    tx: Executor,
  ): Promise<WorkspaceRow> {
    const [workspace] = await tx.insert(workspaces).values({ name: input.name }).returning({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    });

    await tx.insert(workspaceMembers).values({
      workspaceId: (workspace as WorkspaceRow).id,
      userId: input.creatorUserId,
      role: input.creatorRole,
    });

    return workspace as WorkspaceRow;
  }

  /** Người dùng theo ID — dùng để xác nhận target của thao tác member tồn tại. */
  async findUserById(
    userId: string,
    tx?: Executor,
  ): Promise<{ id: string; displayName: string; email: string } | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  async findMembership(
    workspaceId: string,
    userId: string,
    tx?: Executor,
  ): Promise<{ role: WorkspaceRole; createdAt: Date } | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ role: workspaceMembers.role, createdAt: workspaceMembers.createdAt })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return row as { role: WorkspaceRole; createdAt: Date } | undefined;
  }

  async addMember(
    input: { workspaceId: string; userId: string; role: WorkspaceRole },
    tx: Executor,
  ): Promise<{ createdAt: Date }> {
    const [row] = await tx
      .insert(workspaceMembers)
      .values(input)
      .returning({ createdAt: workspaceMembers.createdAt });
    return row as { createdAt: Date };
  }

  /**
   * Đếm project membership của một user **trong phạm vi workspace này**.
   *
   * Dùng cho bất biến "gỡ khỏi workspace không được để lại membership project
   * mồ côi". Đếm chứ không trả danh sách: người gọi chỉ cần biết có hay không,
   * và trả danh sách project riêng tư cho một thao tác cấp workspace là lộ dữ
   * liệu mà Workspace Admin không có quyền đọc.
   */
  async countProjectMembershipsInWorkspace(
    workspaceId: string,
    userId: string,
    tx?: Executor,
  ): Promise<number> {
    const [row] = await (tx ?? this.#db)
      .select({ count: sql<number>`count(*)::int` })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projects.workspaceId, workspaceId), eq(projectMembers.userId, userId)));
    return row?.count ?? 0;
  }

  /** Xoá membership theo đúng cặp workspace/user đã được kiểm bất biến. */
  async removeMember(
    input: { workspaceId: string; userId: string },
    tx: Executor,
  ): Promise<number> {
    const removed = await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      )
      .returning({ id: workspaceMembers.id });
    return removed.length;
  }
}
