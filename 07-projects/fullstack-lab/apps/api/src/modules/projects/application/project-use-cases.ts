import type { ProjectRole } from "@flowboard/contracts";
import type { Database } from "../../../shared/database/client.ts";
import { AppError, validationError } from "../../../shared/errors/app-error.ts";
import type { Actor, AuthorizationService } from "../../../shared/authorization/index.ts";
import { projectCapabilities } from "../../../shared/authorization/index.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import type { ProjectRepository, ProjectRow } from "../infrastructure/project-repository.ts";
import type { WorkspaceMembershipPort } from "../domain/workspace-membership-port.ts";
import {
  assertNotAssignedToTasks,
  assertProjectKeepsAnOwner,
  ownerCountAfterRemoval,
  ownerCountAfterRoleChange,
  type ProjectAssigneeCheck,
} from "../domain/project-membership-rules.ts";

/**
 * Use case của module `projects`.
 *
 * Thứ tự trong mỗi mutation là cố định và có lý do:
 * **resolve → authorize → mở transaction → re-check bất biến → ghi → outcome**.
 *
 * Bước "re-check bên trong transaction" không phải thừa: authorization chạy ở
 * guard, ngoài transaction, và giữa hai thời điểm đó một Owner khác có thể vừa
 * đổi vai trò của actor. Điều kiện dễ đổi phải được đọc lại dưới cùng một ảnh
 * chụp với lệnh ghi.
 */

/**
 * ## Nợ đã biết: ActivityLog chưa được ghi ở mốc này
 *
 * Hợp đồng endpoint yêu cầu năm mutation dưới đây ghi activity **trong cùng
 * transaction** với chính mutation đó:
 *
 * | Use case | Event |
 * |---|---|
 * | `createProject` | `project.created` |
 * | `renameProject` | `project.updated` |
 * | `addProjectMember` | `project_member.added` |
 * | `changeProjectMemberRole` | `project_member.role_changed` |
 * | `removeProjectMember` | `project_member.removed` |
 *
 * Chúng **chưa được ghi**, vì bảng `activity_logs` chưa tồn tại: phạm vi
 * migration của M2 dừng ở `workspaces`, `workspace_members`, `projects`,
 * `project_members`. Đây là một khoảng trống có ý thức, không phải một chỗ bị
 * bỏ sót.
 *
 * Hệ quả phải nhớ khi đọc test: những khẳng định dạng "deny không tạo activity
 * row" hiện **đúng một cách rỗng** — không có bảng nào để ghi vào. Chúng chỉ
 * trở thành bằng chứng thật khi `activity_logs` tồn tại.
 *
 * Khi mốc tạo `activity_logs` bắt đầu, module `activity` export
 * `ActivityRecorder.record(tx, event)` theo ADR-0005, và **năm** chỗ trong file
 * này phải gọi nó bên trong transaction đang có sẵn. Transaction đã đúng hình
 * dạng cho việc đó rồi; chỗ còn thiếu chỉ là port và lời gọi.
 */

export interface ProjectDeps {
  db: Database;
  repository: ProjectRepository;
  authorization: AuthorizationService;
  workspaceMembership: WorkspaceMembershipPort;
  assigneeCheck: ProjectAssigneeCheck;
  now?: () => Date;
}

export interface ProjectView {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMemberView {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectRole;
}

export interface ProjectDetailView {
  project: ProjectView;
  capabilities: string[];
  members: ProjectMemberView[];
}

export class ProjectUseCases {
  readonly #deps: ProjectDeps;

  constructor(deps: ProjectDeps) {
    this.#deps = deps;
  }

  get #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /**
   * `POST /workspaces/:workspaceId/projects` — tạo project riêng tư.
   *
   * Guard đã cưỡng chế `project:create` ở cấp workspace (Workspace Admin). Một
   * transaction tạo project **và** đưa creator thành `owner`: tách hai bước ra
   * là chấp nhận khả năng tồn tại một project không có Owner, và không có
   * đường nào sửa nó qua API vì mọi thao tác sửa đều cần Owner.
   */
  async createProject(
    actor: Actor,
    workspaceId: string,
    input: { name: string },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (detail: { project: ProjectView; capabilities: string[] }) => unknown,
  ): Promise<{ project: ProjectView; capabilities: string[] }> {
    return await this.#deps.db.transaction(async (tx) => {
      const project = await this.#deps.repository.createProjectWithOwner(
        { workspaceId, name: input.name, creatorUserId: actor.id },
        tx,
      );

      const result = {
        project: toProjectView(project),
        capabilities: projectCapabilities("owner"),
      };

      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(result));
      }

      return result;
    });
  }

  /**
   * `GET /projects/:projectId` — mở project.
   *
   * Guard đã cưỡng chế `project:read`, nên tới đây actor chắc chắn là member.
   * Repository vẫn đọc theo `projectId` đã resolve, không theo một ID nào khác
   * do client gửi.
   *
   * `columns` trả mảng rỗng ở M2: bảng `board_columns` thuộc M3. Trả rỗng chứ
   * **không** bỏ field — client đã được viết theo `projectDetailSchema`, và một
   * field biến mất là lỗi hợp đồng, trong khi một mảng rỗng là sự thật đúng của
   * mốc này.
   */
  async getProjectDetail(actor: Actor, projectId: string): Promise<ProjectDetailView> {
    const authorization = await this.#deps.authorization.requireProjectMembership(
      actor.id,
      projectId,
    );

    const project = await this.#deps.repository.findProjectById(projectId);
    // Membership tồn tại nhưng project không: dữ liệu không nhất quán. Vẫn trả
    // `404` — cùng response với mọi nhánh "không thấy", không có nhánh riêng để
    // dò.
    if (project === undefined) throw new AppError("NOT_FOUND");

    const members = await this.#deps.repository.findMembersOfProject(projectId);

    return {
      project: toProjectView(project),
      capabilities: authorization.capabilities,
      members,
    };
  }

  /** `PATCH /projects/:projectId` — đổi **tên** project, và chỉ tên. */
  async renameProject(
    projectId: string,
    input: { name: string },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (detail: { project: ProjectView; capabilities: string[] }) => unknown,
  ): Promise<{ project: ProjectView; capabilities: string[] }> {
    return await this.#deps.db.transaction(async (tx) => {
      const updated = await this.#deps.repository.renameProject(
        { projectId, name: input.name, now: this.#now },
        tx,
      );
      if (updated === undefined) throw new AppError("NOT_FOUND");

      // Guard đã xác nhận actor là Owner để có `project:update`, nên
      // capabilities của response là của Owner.
      const result = {
        project: toProjectView(updated),
        capabilities: projectCapabilities("owner"),
      };

      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(result));
      }

      return result;
    });
  }

  /**
   * `POST /projects/:projectId/members` — thêm member.
   *
   * Bất biến quan trọng nhất ở đây: **target phải là WorkspaceMember của
   * workspace chứa project**. Không có nó, một Owner có thể kéo người ngoài
   * workspace vào project riêng tư, và ranh giới tenant mất ý nghĩa.
   */
  async addProjectMember(
    projectId: string,
    input: { userId: string; role: ProjectRole },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (member: ProjectMemberView) => unknown,
  ): Promise<ProjectMemberView> {
    return await this.#deps.db.transaction(async (tx) => {
      const project = await this.#deps.repository.findProjectById(projectId, tx);
      if (project === undefined) throw new AppError("NOT_FOUND");

      const target = await this.#deps.repository.findUserById(input.userId, tx);
      if (target === undefined) {
        throw validationError([
          { field: "userId", code: "unknown_user", message: "Không tìm thấy người dùng này." },
        ]);
      }

      const isWorkspaceMember = await this.#deps.workspaceMembership.isWorkspaceMember({
        workspaceId: project.workspaceId,
        userId: input.userId,
        tx,
      });
      if (!isWorkspaceMember) {
        throw validationError([
          {
            field: "userId",
            code: "not_workspace_member",
            message:
              "Người này chưa thuộc không gian làm việc của dự án. " +
              "Quản trị viên không gian làm việc cần thêm họ trước.",
          },
        ]);
      }

      const existing = await this.#deps.repository.findMembership(projectId, input.userId, tx);
      if (existing !== undefined) {
        throw validationError([
          {
            field: "userId",
            code: "already_member",
            message: "Người dùng này đã là thành viên của dự án.",
          },
        ]);
      }

      await this.#deps.repository.addMember(
        { projectId, userId: input.userId, role: input.role },
        tx,
      );

      const member: ProjectMemberView = {
        userId: target.id,
        displayName: target.displayName,
        email: target.email,
        role: input.role,
      };

      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(member));
      }

      return member;
    });
  }

  /**
   * `PATCH /projects/:projectId/members/:userId` — đổi vai trò.
   *
   * Đếm Owner dưới `FOR UPDATE` **trước** khi ghi: hai request đồng thời hạ
   * quyền hai Owner khác nhau đều thấy "còn 2 Owner" nếu không khoá, và cả hai
   * commit thành công — project mất Owner cuối cùng dù mỗi request đều hợp lệ
   * khi xét riêng.
   */
  async changeProjectMemberRole(
    projectId: string,
    userId: string,
    input: { role: ProjectRole },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (member: ProjectMemberView) => unknown,
  ): Promise<ProjectMemberView> {
    return await this.#deps.db.transaction(async (tx) => {
      const existing = await this.#deps.repository.findMembership(projectId, userId, tx);
      if (existing === undefined) throw new AppError("NOT_FOUND");

      const ownerCount = await this.#deps.repository.countOwnersForUpdate(projectId, tx);
      assertProjectKeepsAnOwner(ownerCountAfterRoleChange(ownerCount, existing.role, input.role));

      await this.#deps.repository.changeMemberRole(
        { projectId, userId, role: input.role, now: this.#now },
        tx,
      );

      const target = await this.#deps.repository.findUserById(userId, tx);
      if (target === undefined) throw new AppError("NOT_FOUND");

      const member: ProjectMemberView = {
        userId: target.id,
        displayName: target.displayName,
        email: target.email,
        role: input.role,
      };

      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(member));
      }

      return member;
    });
  }

  /**
   * `DELETE /projects/:projectId/members/:userId` — gỡ member.
   *
   * Hai bất biến, cả hai kiểm **bên trong** transaction: còn ít nhất một Owner,
   * và target không còn là assignee của task nào. Phép kiểm thứ hai đi qua
   * `ProjectAssigneeCheck` — ở M2 adapter trả `false` vì bảng `tasks` chưa tồn
   * tại; M4 thay bằng adapter thật của module `tasks`.
   */
  async removeProjectMember(
    projectId: string,
    userId: string,
    recordOutcome?: RecordOutcome,
  ): Promise<void> {
    await this.#deps.db.transaction(async (tx) => {
      const existing = await this.#deps.repository.findMembership(projectId, userId, tx);
      if (existing === undefined) throw new AppError("NOT_FOUND");

      const ownerCount = await this.#deps.repository.countOwnersForUpdate(projectId, tx);
      assertProjectKeepsAnOwner(ownerCountAfterRemoval(ownerCount, existing.role));

      const hasAssignedTasks = await this.#deps.assigneeCheck.hasAssignedTasks({
        projectId,
        userId,
        tx,
      });
      assertNotAssignedToTasks(hasAssignedTasks);

      await this.#deps.repository.removeMember({ projectId, userId }, tx);

      if (recordOutcome !== undefined) await recordOutcome(tx, null);
    });
  }
}

function toProjectView(row: ProjectRow): ProjectView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
