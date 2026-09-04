import type {
  ProjectPermission,
  ProjectRole,
  WorkspacePermission,
  WorkspaceRole,
} from "@flowboard/contracts";
import { AppError } from "../errors/app-error.ts";
import type { Executor, MembershipReader } from "./membership.ts";
import {
  projectCapabilities,
  projectRoleAllows,
  workspaceCapabilities,
  workspaceRoleAllows,
} from "./permissions.ts";

/**
 * `AuthorizationService` — bộ đánh giá policy **duy nhất**.
 *
 * Controller và use case cung cấp actor, một action trong catalog, và một
 * resource đã resolve; chúng không tự viết câu `if` theo role. Lý do không phải
 * là thẩm mỹ: một `if (role === "owner")` rải trong controller là một bản sao
 * của catalog, và bản sao thứ hai luôn trôi khỏi bản gốc.
 *
 * ## Vì sao `404` chứ không phải `403`
 *
 * Đây là quyết định trung tâm của cả file. Một actor **không có dòng
 * membership** nhận `404`, kể cả khi project có thật và kể cả khi actor là
 * Workspace Admin. Chỉ actor **đã nhìn thấy được** resource nhưng thiếu action
 * mới nhận `403`.
 *
 * Trả `403` cho người ngoài là đã trả lời một câu hỏi mà họ không được phép
 * hỏi: "project này có tồn tại không?". Với private project, chính sự tồn tại
 * là thông tin — tên khách hàng, tên dự án nội bộ, thời điểm một dự án được
 * lập. Vì vậy "không tồn tại" và "tồn tại nhưng không phải việc của bạn" phải
 * cho ra **cùng một** response.
 */

export interface ProjectAuthorization {
  projectId: string;
  role: ProjectRole;
  capabilities: ProjectPermission[];
}

export interface WorkspaceAuthorization {
  workspaceId: string;
  role: WorkspaceRole;
  capabilities: WorkspacePermission[];
}

export class AuthorizationService {
  readonly #membership: MembershipReader;

  constructor(membership: MembershipReader) {
    this.#membership = membership;
  }

  /**
   * Đánh giá thuần: actor có vai trò này thì có được làm action này không?
   *
   * Không chạm database. Dùng khi vai trò đã được resolve rồi và người gọi chỉ
   * cần phép kiểm — ví dụ use case cần kiểm một action thứ hai sau khi guard đã
   * kiểm action chính.
   */
  canWithProjectRole(
    role: ProjectRole | undefined,
    permission: ProjectPermission,
    context: { isTimeApprover?: boolean } = {},
  ): boolean {
    return projectRoleAllows(role, permission, context);
  }

  canWithWorkspaceRole(role: WorkspaceRole | undefined, permission: WorkspacePermission): boolean {
    return workspaceRoleAllows(role, permission);
  }

  /**
   * Cưỡng chế một action cấp project và trả về authorization đã resolve.
   *
   * Ném `404` khi không phải member, `403` khi là member nhưng thiếu action.
   * Trả về `role` và `capabilities` để người gọi không phải hỏi database lần
   * hai cho cùng một thông tin.
   */
  async authorizeProject(
    actorId: string,
    projectId: string,
    permission: ProjectPermission,
    tx?: Executor,
  ): Promise<ProjectAuthorization> {
    const role = await this.#membership.projectRole(projectId, actorId, tx);

    // Không có dòng membership → resource **không tồn tại** đối với actor này.
    // Nhánh này bao trùm cả ba trường hợp và cố ý không phân biệt chúng:
    // project không có thật, project của workspace khác, và project có thật mà
    // actor chưa được thêm vào.
    if (role === undefined) throw new AppError("NOT_FOUND");

    if (!projectRoleAllows(role, permission)) throw new AppError("FORBIDDEN");

    return { projectId, role, capabilities: projectCapabilities(role) };
  }

  /**
   * Resolve vai trò project mà **không** cưỡng chế action nào.
   *
   * Dùng cho các use case cần biết vai trò để tính capabilities sau khi guard
   * đã cưỡng chế action chính. Vẫn ném `404` cho người ngoài: kể cả một lượt
   * đọc phụ cũng không được xác nhận project tồn tại.
   */
  async requireProjectMembership(
    actorId: string,
    projectId: string,
    tx?: Executor,
  ): Promise<ProjectAuthorization> {
    const role = await this.#membership.projectRole(projectId, actorId, tx);
    if (role === undefined) throw new AppError("NOT_FOUND");
    return { projectId, role, capabilities: projectCapabilities(role) };
  }

  /**
   * Cưỡng chế một action cấp workspace.
   *
   * Cùng nguyên tắc: không phải thành viên workspace → `404`; là thành viên
   * nhưng thiếu action → `403`. Hợp đồng endpoint nói đúng điều này cho
   * `GET /workspaces/:workspaceId/members`: "`403` nghĩa là workspace nhìn thấy
   * nhưng thiếu action; workspace không accessible là `404`".
   */
  async authorizeWorkspace(
    actorId: string,
    workspaceId: string,
    permission: WorkspacePermission,
    tx?: Executor,
  ): Promise<WorkspaceAuthorization> {
    const role = await this.#membership.workspaceRole(workspaceId, actorId, tx);
    if (role === undefined) throw new AppError("NOT_FOUND");
    if (!workspaceRoleAllows(role, permission)) throw new AppError("FORBIDDEN");
    return { workspaceId, role, capabilities: workspaceCapabilities(role) };
  }

  async requireWorkspaceMembership(
    actorId: string,
    workspaceId: string,
    tx?: Executor,
  ): Promise<WorkspaceAuthorization> {
    const role = await this.#membership.workspaceRole(workspaceId, actorId, tx);
    if (role === undefined) throw new AppError("NOT_FOUND");
    return { workspaceId, role, capabilities: workspaceCapabilities(role) };
  }
}
