import type { KeyRing } from "../../../shared/security/key-ring.ts";
import type { ProjectRole } from "@flowboard/contracts";
import type { Database } from "../../../shared/database/client.ts";
import { AppError, validationError } from "../../../shared/errors/app-error.ts";
import type { Actor, AuthorizationService } from "../../../shared/authorization/index.ts";
import { projectCapabilities } from "../../../shared/authorization/index.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import type { ActivityRecorder } from "../../activity/domain/activity-recorder.ts";
import type { ProjectRepository, ProjectRow } from "../infrastructure/project-repository.ts";
import {
  buildPage,
  decodeCursor,
  queryFingerprint,
  type PageResult,
} from "../../../shared/http/cursor.ts";
import type { WorkspaceMembershipPort } from "../domain/workspace-membership-port.ts";
import type { ProjectColumnView, ProjectColumnsQuery } from "../domain/project-columns-port.ts";
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

export interface ProjectDeps {
  db: Database;
  repository: ProjectRepository;
  authorization: AuthorizationService;
  workspaceMembership: WorkspaceMembershipPort;
  assigneeCheck: ProjectAssigneeCheck;
  /**
   * Cổng ghi activity — `activity` là module leaf, và mọi mutation ở đây ghi
   * qua nó **trong cùng transaction** với chính mutation.
   */
  activity: ActivityRecorder;
  /** Đọc board column cho `GET /projects/:projectId` — xem port để biết vì sao. */
  columns: ProjectColumnsQuery;
  /** Secret ký cursor. Cursor phải chống sửa đổi, không chỉ opaque. */
  cursorSecret: KeyRing;
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

/**
 * Một dòng của danh sách project.
 *
 * Đúng những field mà `projectListItemSchema` công bố. Không count thành viên,
 * không count task — xem lý do ở repository.
 */
export interface ProjectListView {
  id: string;
  workspaceId: string;
  name: string;
  role: ProjectRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDetailView {
  project: ProjectView;
  capabilities: string[];
  columns: ProjectColumnView[];
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

      await this.#deps.activity.record(tx, {
        projectId: project.id,
        actorUserId: actor.id,
        action: "project.created",
        payload: { name: project.name, workspaceId: project.workspaceId },
      });

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
   * `GET /workspaces/:workspaceId/projects` — project mà actor được phép thấy.
   *
   * Guard đã cưỡng chế `workspace:read`, nên workspace không accessible đã trả
   * `404` trước khi tới đây. Điều **còn lại** mà use case này phải giữ là ranh
   * giới thứ hai: trong một workspace mà actor đọc được, actor vẫn chỉ thấy
   * project mà mình có `project_members` row.
   *
   * Đây là cùng một ranh giới với `404` của `GET /projects/:projectId`, chỉ khác
   * cách biểu hiện: ở đó là "không tìm thấy", ở đây là "không có dòng đó trong
   * trang". Cả hai đều **không** phải "một dòng bị ẩn ở UI" — hàng không được
   * đọc lên ngay từ câu SQL.
   *
   * Một Workspace Admin chưa được thêm vào project nào vì vậy nhận trang rỗng,
   * không phải `403` và không phải danh sách của người khác.
   */
  async listProjectsForActor(
    actor: Actor,
    workspaceId: string,
    input: { limit: number; cursor?: string },
  ): Promise<PageResult<ProjectListView>> {
    // Fingerprint bind cả actor lẫn workspace: cursor của workspace khác, hay
    // của người khác, không dùng lại được ở đây — nó là `400`, không phải một
    // đường đọc sang scope khác.
    const fingerprint = queryFingerprint({
      list: "workspace-projects",
      actor: actor.id,
      workspace: workspaceId,
      sort: "createdAt:desc,id:desc",
    });

    const after =
      input.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(input.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAt: new Date(decoded.sortKey), id: decoded.id };
          })();

    const rows = await this.#deps.repository.findProjectsForActorInWorkspace(
      workspaceId,
      actor.id,
      input.limit,
      after,
    );

    return buildPage(rows, input.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.id,
    }));
  }

  /**
   * `GET /projects/:projectId` — mở project.
   *
   * Guard đã cưỡng chế `project:read`, nên tới đây actor chắc chắn là member.
   * Repository vẫn đọc theo `projectId` đã resolve, không theo một ID nào khác
   * do client gửi.
   *
   * `columns` là **active column thật** từ M3, đọc qua `ProjectColumnsQuery`.
   * Trước M3 nó là mảng rỗng vì bảng chưa tồn tại; giữ nguyên mảng rỗng sau khi
   * bảng có sẽ biến một sự thật của mốc cũ thành một lời nói dối — board của
   * client sẽ trống dù cột đã được tạo qua API.
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
    const columns = await this.#deps.columns.activeColumnsOf(projectId);

    return {
      project: toProjectView(project),
      capabilities: authorization.capabilities,
      columns,
      members,
    };
  }

  /** `PATCH /projects/:projectId` — đổi **tên** project, và chỉ tên. */
  async renameProject(
    actor: Actor,
    projectId: string,
    input: { name: string },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (detail: { project: ProjectView; capabilities: string[] }) => unknown,
  ): Promise<{ project: ProjectView; capabilities: string[] }> {
    return await this.#deps.db.transaction(async (tx) => {
      // Đọc tên cũ **trước** khi ghi: payload nói "từ gì sang gì", và sau lệnh
      // UPDATE thì tên cũ không còn ở đâu để lấy.
      const before = await this.#deps.repository.findProjectById(projectId, tx);
      if (before === undefined) throw new AppError("NOT_FOUND");

      const updated = await this.#deps.repository.renameProject(
        { projectId, name: input.name, now: this.#now },
        tx,
      );
      if (updated === undefined) throw new AppError("NOT_FOUND");

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "project.updated",
        payload: { field: "name", from: before.name, to: updated.name },
      });

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
    actor: Actor,
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

      /**
       * Payload mang `userId` và `role`, **không** mang email hay tên hiển thị.
       * Activity là dữ liệu lưu lâu và đọc lại về sau; nhét thông tin định danh
       * vào đây là nhân bản chúng ra một bảng không ai nghĩ tới khi rà soát.
       */
      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "project_member.added",
        payload: { userId: input.userId, role: input.role },
      });

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
    actor: Actor,
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

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "project_member.role_changed",
        payload: { userId, from: existing.role, to: input.role },
      });

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
    actor: Actor,
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

      await this.#deps.activity.record(tx, {
        projectId,
        actorUserId: actor.id,
        action: "project_member.removed",
        payload: { userId, role: existing.role },
      });

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
