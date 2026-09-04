import type {
  AddProjectMemberRequest,
  AddWorkspaceMemberRequest,
  Page,
  Project,
  ProjectDetail,
  ProjectMember,
  ProjectRole,
  SessionResponse,
  Workspace,
  WorkspaceMemberListItem,
} from "@flowboard/contracts";
import { transport, type ApiResult, type Intent } from "./api.ts";

/**
 * Client gọi API của mốc M2 — workspace, project và membership.
 *
 * Mỗi hàm ứng với **một** endpoint trong
 * [hợp đồng endpoint](../../../../docs/api/endpoint-contracts.md). Không hàm
 * nào tự quyết định gì ngoài việc dịch tham số thành request: quyền,
 * validation và concurrency đều là quyết định của server.
 *
 * Mutation nào hợp đồng yêu cầu `Idempotency-Key` thì nhận `Intent` — kiểu bắt
 * buộc, không optional. Quên gửi key là lỗi mà TypeScript bắt được, chứ không
 * phải lỗi chỉ lộ ra khi một lần retry tạo ra bản ghi thứ hai.
 */

interface ListPayload<T> {
  items: T[];
  page: Page;
}

// ------------------------------------------------------------------ session

export function readSession(): Promise<ApiResult<SessionResponse>> {
  return transport.request("/auth/session");
}

export function signOut(): Promise<ApiResult<void>> {
  return transport.request("/auth/sign-out", { method: "POST" });
}

// --------------------------------------------------------------- workspaces

export function listWorkspaces(): Promise<ApiResult<ListPayload<Workspace>>> {
  return transport.request("/workspaces");
}

export function createWorkspace(
  name: string,
  intent: Intent,
): Promise<ApiResult<{ workspace: Workspace }>> {
  return transport.request("/workspaces", { method: "POST", body: { name }, intent });
}

export function listWorkspaceMembers(
  workspaceId: string,
): Promise<ApiResult<ListPayload<WorkspaceMemberListItem>>> {
  return transport.request(`/workspaces/${workspaceId}/members`);
}

export function addWorkspaceMember(
  workspaceId: string,
  body: AddWorkspaceMemberRequest,
  intent: Intent,
): Promise<ApiResult<{ member: WorkspaceMemberListItem }>> {
  return transport.request(`/workspaces/${workspaceId}/members`, {
    method: "POST",
    body,
    intent,
  });
}

export function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
  intent: Intent,
): Promise<ApiResult<void>> {
  return transport.request(`/workspaces/${workspaceId}/members/${userId}`, {
    method: "DELETE",
    intent,
  });
}

/**
 * **HỢP ĐỒNG CÒN THIẾU — chưa được duyệt.**
 *
 * `PRJ-01 Project List` cần danh sách project mà actor được phép đọc trong một
 * workspace, nhưng [hợp đồng endpoint](../../../../docs/api/endpoint-contracts.md)
 * **không có** route nào trả danh sách đó: nhóm workspace chỉ có `GET /workspaces`,
 * `GET/POST/DELETE .../members` và `POST .../projects`.
 *
 * Đường dẫn dưới đây là chỗ **duy nhất** trong toàn bộ frontend giả định một
 * route chưa tồn tại, và nó được đặt tên để grep ra được. Nó **không** được
 * coi là hợp đồng: `packages/contracts` không có schema cho nó, và không có
 * field nào ngoài `Project` (thứ hợp đồng đã công bố) được đọc từ response.
 * Khi route thật được duyệt và thêm vào contract, chỗ phải sửa là đúng hàm này.
 *
 * Xem mục "Hợp đồng còn thiếu" trong báo cáo bàn giao M2.
 */
export const PENDING_CONTRACT_PROJECT_LIST = "/workspaces/{workspaceId}/projects";

export function listWorkspaceProjects(
  workspaceId: string,
): Promise<ApiResult<ListPayload<Project>>> {
  return transport.request(`/workspaces/${workspaceId}/projects`);
}

export function createProject(
  workspaceId: string,
  name: string,
  intent: Intent,
): Promise<ApiResult<{ project: Project; capabilities: string[] }>> {
  return transport.request(`/workspaces/${workspaceId}/projects`, {
    method: "POST",
    body: { name },
    intent,
  });
}

// ----------------------------------------------------------------- projects

export function readProject(projectId: string): Promise<ApiResult<ProjectDetail>> {
  return transport.request(`/projects/${projectId}`);
}

export function renameProject(
  projectId: string,
  name: string,
  intent: Intent,
): Promise<ApiResult<{ project: Project; capabilities: string[] }>> {
  // Hợp đồng: body đúng shape `{ name }`. Không description, không visibility,
  // không archive — thêm field ở đây là hợp thức hoá một field chưa ai duyệt.
  return transport.request(`/projects/${projectId}`, { method: "PATCH", body: { name }, intent });
}

export function addProjectMember(
  projectId: string,
  body: AddProjectMemberRequest,
  intent: Intent,
): Promise<ApiResult<{ member: ProjectMember }>> {
  return transport.request(`/projects/${projectId}/members`, { method: "POST", body, intent });
}

export function changeProjectMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
  intent: Intent,
): Promise<ApiResult<{ member: ProjectMember }>> {
  return transport.request(`/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
    intent,
  });
}

export function removeProjectMember(
  projectId: string,
  userId: string,
  intent: Intent,
): Promise<ApiResult<void>> {
  return transport.request(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
    intent,
  });
}
