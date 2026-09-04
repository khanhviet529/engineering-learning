import { and, eq, sql } from "drizzle-orm";
import type { ProjectRole } from "@flowboard/contracts";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { projectMembers, projects, users } from "../../../shared/database/schema.ts";

/**
 * Repository của module `projects`.
 *
 * **Nơi duy nhất** trong module chạm Drizzle, và mọi truy vấn tự mang scope
 * `project_id` của nó. Guard đã authorize trước đó, nhưng repository không dựa
 * vào điều đó — hai lớp độc lập, và một lớp chỉ có giá trị khi nó không giả
 * định lớp kia đã chạy đúng.
 *
 * Tên method mô tả **truy vấn cụ thể** mà use case cần. Không có `findById` trần
 * hay `update(id, patch)`: cả hai đều mời gọi người gọi tự quyết định scope, và
 * đó là chỗ `project_id` bị quên.
 */

type Executor = Database | Transaction;

export interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMemberRow {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectRole;
}

export class ProjectRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Một project theo ID. Authorization đã xảy ra trước; đây là lượt đọc dữ liệu. */
  async findProjectById(projectId: string, tx?: Executor): Promise<ProjectRow | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row;
  }

  /**
   * Thành viên của **một** project đã được authorize.
   *
   * Không phân trang: hợp đồng của `GET /projects/:projectId` trả "assignable
   * project-member projection" như một danh sách đầy đủ, vì nó dùng để đổ vào
   * bộ chọn assignee — một bộ chọn phân trang không dùng được. Danh sách member
   * của một project nhóm nhỏ có biên tự nhiên; nếu nó lớn tới mức cần cursor
   * thì đó là thay đổi hợp đồng, không phải chỉnh sửa ở đây.
   */
  async findMembersOfProject(projectId: string, tx?: Executor): Promise<ProjectMemberRow[]> {
    return (await (tx ?? this.#db)
      .select({
        userId: projectMembers.userId,
        displayName: users.displayName,
        email: users.email,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(users.displayName, projectMembers.userId)) as ProjectMemberRow[];
  }

  /** Tạo project và membership Owner của creator trong **cùng** transaction. */
  async createProjectWithOwner(
    input: { workspaceId: string; name: string; creatorUserId: string },
    tx: Executor,
  ): Promise<ProjectRow> {
    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        createdByUserId: input.creatorUserId,
      })
      .returning({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      });

    await tx.insert(projectMembers).values({
      projectId: (project as ProjectRow).id,
      userId: input.creatorUserId,
      role: "owner",
    });

    return project as ProjectRow;
  }

  /**
   * Đổi tên project.
   *
   * Điều kiện `where` mang `project_id` dù `id` đã là khoá chính: nó làm chữ ký
   * của method nói đúng phạm vi, và giữ hình dạng chung với các update sau này
   * vốn **bắt buộc** phải có scope (task, comment, column).
   *
   * Chỉ ghi `name` và `updated_at` — không có đường nào từ method này đổi
   * `workspace_id` hay `created_by_user_id`.
   */
  async renameProject(
    input: { projectId: string; name: string; now: Date },
    tx: Executor,
  ): Promise<ProjectRow | undefined> {
    const [row] = await tx
      .update(projects)
      .set({ name: input.name, updatedAt: input.now })
      .where(eq(projects.id, input.projectId))
      .returning({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      });
    return row;
  }

  async findMembership(
    projectId: string,
    userId: string,
    tx?: Executor,
  ): Promise<{ role: ProjectRole } | undefined> {
    const [row] = await (tx ?? this.#db)
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return row as { role: ProjectRole } | undefined;
  }

  /**
   * Đếm Owner của một project.
   *
   * Dùng `FOR UPDATE` để tuần tự hoá hai request cùng lúc hạ quyền hai Owner
   * khác nhau. Không khoá thì cả hai đọc `2`, cả hai kết luận "vẫn còn một
   * Owner", cả hai commit — và project mất Owner cuối cùng dù mỗi request đều
   * đúng khi xét riêng.
   */
  async countOwnersForUpdate(projectId: string, tx: Executor): Promise<number> {
    const rows = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "owner")))
      .for("update");
    return rows.length;
  }

  async addMember(
    input: { projectId: string; userId: string; role: ProjectRole },
    tx: Executor,
  ): Promise<void> {
    await tx.insert(projectMembers).values(input);
  }

  async changeMemberRole(
    input: { projectId: string; userId: string; role: ProjectRole; now: Date },
    tx: Executor,
  ): Promise<number> {
    const rows = await tx
      .update(projectMembers)
      .set({ role: input.role, updatedAt: input.now })
      .where(
        and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)),
      )
      .returning({ id: projectMembers.id });
    return rows.length;
  }

  async removeMember(input: { projectId: string; userId: string }, tx: Executor): Promise<number> {
    const rows = await tx
      .delete(projectMembers)
      .where(
        and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)),
      )
      .returning({ id: projectMembers.id });
    return rows.length;
  }

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

  /** Dùng cho chẩn đoán index; không nằm trên đường đi của request nào. */
  async explainProjectListForActor(userId: string, tx?: Executor): Promise<string[]> {
    const rows = await (tx ?? this.#db).execute<{ "QUERY PLAN": string }>(
      sql`explain (analyze, buffers)
          select p.id, p.name, p.created_at, pm.role
          from project_members pm
          join projects p on p.id = pm.project_id
          where pm.user_id = ${userId}
          order by p.created_at desc, p.id desc
          limit 26`,
    );
    return [...rows].map((row) => row["QUERY PLAN"]);
  }
}
