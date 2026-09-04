import {
  PAGE_LIMIT_DEFAULT,
  type AddProjectMemberRequest,
  type InviteWorkspaceMemberRequest,
  type ListProjectsQuery,
  type Page,
  type Project,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectMember,
  type ProjectRole,
  type SessionResponse,
  type Workspace,
  type WorkspaceMemberListItem,
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

/**
 * Mời một người vào workspace.
 *
 * Theo [ADR-0013](../../../../docs/decisions/ADR-0013-workspace-member-invitation.md),
 * route nhận **email** chứ không nhận `userId`, và **luôn** trả
 * `202 { accepted: true }` — giống hệt nhau dù email đã có account, chưa có,
 * hay đã là member. UI vì vậy không được suy ra điều gì từ response: nó chỉ
 * được nói "đã gửi lời mời nếu địa chỉ hợp lệ".
 *
 * Backend chưa dựng route này, nên hiện tại nó trả `404`. Đó là trạng thái
 * trung thực của khoảng giữa hợp đồng và hiện thực, không phải lỗi cần né.
 */
export function inviteWorkspaceMember(
  workspaceId: string,
  body: InviteWorkspaceMemberRequest,
  intent: Intent,
): Promise<ApiResult<{ accepted: true }>> {
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
 * `GET /workspaces/:workspaceId/projects` — danh sách project actor được phép thấy.
 *
 * Server chỉ trả project mà actor có `project_members` row, nên một Workspace
 * Admin chưa được thêm vào đâu nhận **trang rỗng**, không phải danh sách của
 * người khác. Query chỉ có `cursor` và `limit`: không mở thêm trục lọc, vì mỗi
 * trục là một cách dò xem project nào tồn tại.
 *
 * Mỗi dòng mang `role` của chính actor, nên UI render được affordance ngay mà
 * không cần một lượt gọi thứ hai.
 */
export function listWorkspaceProjects(
  workspaceId: string,
  query: ListProjectsQuery = { limit: PAGE_LIMIT_DEFAULT },
): Promise<ApiResult<ListPayload<ProjectListItem>>> {
  const params = new URLSearchParams({ limit: String(query.limit) });
  // Cursor là giá trị opaque do server phát hành; client chỉ chuyển tiếp lại.
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return transport.request(`/workspaces/${workspaceId}/projects?${params.toString()}`);
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
