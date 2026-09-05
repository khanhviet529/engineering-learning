import {
  PAGE_LIMIT_DEFAULT,
  type AcceptInvitationResponse,
  type AddProjectMemberRequest,
  type Activity,
  type ColumnResponse,
  type ColumnsResponse,
  type Comment,
  type CommentResponse,
  type CreateColumnRequest,
  type CreateCommentRequest,
  type CreateTaskRequest,
  type InviteWorkspaceMemberRequest,
  type ListInvitationsQuery,
  type PendingInvitation,
  type ListProjectsQuery,
  type Page,
  type Project,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectMember,
  type MoveTaskRequest,
  type ProjectOverview,
  type ProjectRole,
  type ReorderColumnsRequest,
  type Task,
  type TaskResponse,
  type UpdateTaskRequest,
  type WorkspaceTaskProjectRef,
  type SessionResponse,
  type UpdateColumnRequest,
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

/**
 * `GET /workspaces/:workspaceId/invitations` — lời mời **đang chờ**.
 *
 * Đây là một danh sách khác danh sách thành viên, không phải một bộ lọc của nó:
 * một lời mời `pending` chưa cấp quyền gì. Server chỉ trả `pending`, nên không
 * có tham số `status` để truyền và cũng không có gì để lọc.
 */
export function listWorkspaceInvitations(
  workspaceId: string,
  query: ListInvitationsQuery = { limit: PAGE_LIMIT_DEFAULT },
): Promise<ApiResult<ListPayload<PendingInvitation>>> {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return transport.request(`/workspaces/${workspaceId}/invitations?${params.toString()}`);
}

/**
 * `DELETE /workspaces/:workspaceId/invitations/:invitationId` — thu hồi.
 *
 * Hợp đồng endpoint yêu cầu `Idempotency-Key` cho route này, còn bảng khoá bắt
 * buộc trong tài liệu pagination/concurrency lại không liệt kê nó. Hai tài liệu
 * lệch nhau, và hướng an toàn chỉ có một: gửi thừa một key là vô hại, thiếu một
 * key bắt buộc là `400`. Chỗ lệch đã được báo cho chủ hợp đồng.
 */
export function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
  intent: Intent,
): Promise<ApiResult<void>> {
  return transport.request(`/workspaces/${workspaceId}/invitations/${invitationId}`, {
    method: "DELETE",
    intent,
  });
}

/**
 * `POST /invitations/accept` — chấp nhận lời mời.
 *
 * Route này **tiêu thụ** token: nó validate và tạo membership trong cùng một
 * transaction, không có endpoint "chỉ kiểm token" nào để gọi trước. Vì vậy chỗ
 * gọi phải chắc chắn nó chỉ chạy **một lần** cho một token.
 *
 * Không nhận `Intent`: hợp đồng không yêu cầu `Idempotency-Key` ở đây, vì chính
 * điều kiện tiêu thụ nằm trong mệnh đề `WHERE` của câu `UPDATE` — hai request
 * cùng token không thể cùng thành công dù có key hay không.
 */
export function acceptInvitation(token: string): Promise<ApiResult<AcceptInvitationResponse>> {
  return transport.request("/invitations/accept", { method: "POST", body: { token } });
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

// ----------------------------------------------------------- board columns

/**
 * `POST /projects/:projectId/columns` — thêm một cột active.
 *
 * Client nói **đứng sau cột nào**, không nói vị trí: `position` là fractional
 * và do server tính. Đó cũng là lý do không có đường nào để client gửi
 * `projectId`, `position`, `archivedAt` hay timestamp trong body này.
 */
export function createColumn(
  projectId: string,
  body: CreateColumnRequest,
  intent: Intent,
): Promise<ApiResult<ColumnResponse>> {
  return transport.request(`/projects/${projectId}/columns`, { method: "POST", body, intent });
}

/**
 * `PATCH /columns/:columnId` — **đúng một** command mỗi lần gọi.
 *
 * Kiểu `UpdateColumnRequest` là một union bốn nhánh, mỗi nhánh `.strict()`, nên
 * "đổi tên và bật cờ kết thúc cùng lúc" không biểu đạt được ở đây — TypeScript
 * chặn nó trước khi server phải trả `400`. Muốn làm hai việc thì gọi hai lần.
 */
export function updateColumn(
  columnId: string,
  command: UpdateColumnRequest,
  intent: Intent,
): Promise<ApiResult<ColumnResponse>> {
  return transport.request(`/columns/${columnId}`, { method: "PATCH", body: command, intent });
}

/**
 * `POST /columns/reorder` — gửi **toàn bộ** active column theo thứ tự mới.
 *
 * Không delta, không position. Danh sách đầy đủ làm thứ tự cuối cùng trở thành
 * tất định: server không phải đoán ý cho những cột vắng mặt, và hai client gửi
 * cùng lúc không thể ghép thành một thứ tự mà không ai yêu cầu.
 */
export function reorderColumns(
  body: ReorderColumnsRequest,
  intent: Intent,
): Promise<ApiResult<ColumnsResponse>> {
  return transport.request("/columns/reorder", { method: "POST", body, intent });
}

// ------------------------------------------------------------------- tasks

/**
 * `GET /projects/:projectId/tasks` — một trang task đã scope.
 *
 * Query đã được dựng sẵn bởi `features/tasks/task-filters.ts`, và nó **luôn**
 * mang `columnId`: board phân trang theo từng cột, nên một cursor chỉ có nghĩa
 * với đúng cột, đúng filter và đúng sort đã tạo ra nó.
 */
export function listTasks(
  projectId: string,
  params: URLSearchParams,
): Promise<ApiResult<ListPayload<Task>>> {
  return transport.request(`/projects/${projectId}/tasks?${params.toString()}`);
}

export function createTask(
  projectId: string,
  body: CreateTaskRequest,
  intent: Intent,
): Promise<ApiResult<TaskResponse>> {
  return transport.request(`/projects/${projectId}/tasks`, { method: "POST", body, intent });
}

/** `GET /tasks/:taskId` — task, trang bình luận đầu tiên và capabilities. */
export function readTask(taskId: string): Promise<
  ApiResult<{
    task: Task;
    comments: { items: Comment[]; page: Page };
    capabilities: string[];
  }>
> {
  return transport.request(`/tasks/${taskId}`);
}

/**
 * `PATCH /tasks/:taskId` — patch nội dung, luôn kèm `expectedVersion`.
 *
 * `409 TASK_VERSION_CONFLICT` là câu trả lời bình thường của route này, không
 * phải sự cố: chỗ gọi phải mở `SYS-04` chứ không được gửi lại im lặng.
 */
export function updateTask(
  taskId: string,
  body: UpdateTaskRequest,
  intent: Intent,
): Promise<ApiResult<TaskResponse>> {
  return transport.request(`/tasks/${taskId}`, { method: "PATCH", body, intent });
}

/**
 * `POST /tasks/:taskId/move` — use case riêng, không phải một nhánh của update.
 *
 * `targetPosition` là gợi ý; `position` và `version` trong response mới là sự
 * thật. Xem `features/tasks/position.ts`.
 */
export function moveTask(
  taskId: string,
  body: MoveTaskRequest,
  intent: Intent,
): Promise<ApiResult<TaskResponse>> {
  return transport.request(`/tasks/${taskId}/move`, { method: "POST", body, intent });
}

export function createComment(
  taskId: string,
  body: CreateCommentRequest,
  intent: Intent,
): Promise<ApiResult<CommentResponse>> {
  return transport.request(`/tasks/${taskId}/comments`, { method: "POST", body, intent });
}

export function listTaskActivity(
  taskId: string,
  limit = PAGE_LIMIT_DEFAULT,
): Promise<ApiResult<ListPayload<Activity>>> {
  return transport.request(`/tasks/${taskId}/activity?limit=${String(limit)}`);
}

// ---------------------------------------------------------------- M5 · MYT-01

/**
 * `GET /workspaces/:workspaceId/tasks` — task cấp workspace.
 *
 * **Một** cursor cho cả workspace, không phải N cursor gộp lại. Đó là toàn bộ
 * lý do endpoint này tồn tại: fan-out qua từng project trả N trang đầu độc
 * lập, và phần đầu của danh sách gộp có thể sai thứ tự — một danh sách "hạn
 * gần nhất" sai tệ hơn không có, vì người dùng tin nó.
 *
 * `projects` là **bảng tra cứu** cho đúng trang này, không phải dữ liệu lồng
 * trong từng task.
 */
export function listWorkspaceTasks(
  workspaceId: string,
  params: URLSearchParams,
): Promise<ApiResult<{ items: Task[]; projects: WorkspaceTaskProjectRef[]; page: Page }>> {
  return transport.request(`/workspaces/${workspaceId}/tasks?${params.toString()}`);
}

// ---------------------------------------------------------------- M5 · PRJ-04

/**
 * `GET /projects/:projectId/overview` — aggregate chỉ đọc.
 *
 * Server trả **số đếm**; phần trăm do client tính. Trả cả hai là hai nguồn cho
 * cùng một sự thật, và chúng lệch ngay ở lần làm tròn đầu tiên.
 *
 * Không phân trang: kết quả bị chặn bởi số column và số member của một project.
 */
export function readProjectOverview(
  projectId: string,
  query: { from?: string; to?: string } = {},
): Promise<ApiResult<ProjectOverview>> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  const suffix = params.toString();
  return transport.request(`/projects/${projectId}/overview${suffix === "" ? "" : `?${suffix}`}`);
}
