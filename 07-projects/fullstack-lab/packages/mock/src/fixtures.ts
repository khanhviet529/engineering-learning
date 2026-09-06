import type {
  Activity,
  Actor,
  BoardColumn,
  Comment,
  MemberCandidate,
  PendingInvitation,
  Project,
  ProjectMember,
  Task,
  Workspace,
} from "@flowboard/contracts";

/**
 * Fixture tất định, dùng lại **đúng** bộ fixture chuẩn trong
 * `docs/operations/testing-strategy.md`, để một cái tên actor mang cùng một
 * nghĩa ở mọi lớp: unit, integration, E2E và mock.
 *
 * Bố cục:
 *
 * - Một workspace, hai private project.
 * - Project B có Owner, Editor, Viewer; User B là Owner.
 * - Một Workspace Admin **không có** `project_members` row cho Project B — đây
 *   là actor chứng minh rằng quyền workspace không hàm ý quyền project.
 * - User A là Owner của Project A riêng tư trong cùng workspace, không có
 *   membership Project B — actor dùng cho phép thử ID substitution.
 *
 * Mọi ID là UUID cố định để test có thể tham chiếu trực tiếp mà không phải
 * đọc ngược từ response.
 */

export const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  projectA: "22222222-2222-4222-8222-222222222222",
  projectB: "33333333-3333-4333-8333-333333333333",
  userOwnerB: "44444444-4444-4444-8444-444444444444",
  userEditorB: "55555555-5555-4555-8555-555555555555",
  userViewerB: "66666666-6666-4666-8666-666666666666",
  userWorkspaceAdmin: "77777777-7777-4777-8777-777777777777",
  userOwnerA: "88888888-8888-4888-8888-888888888888",
  columnBacklog: "99999999-9999-4999-8999-999999999999",
  columnInProgress: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  columnReview: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  columnDone: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  taskOpen: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  taskOverdue: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  comment: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  invitationPending: "14141414-1414-4141-8141-141414141414",
  invitationSecond: "15151515-1515-4151-8151-151515151515",
  activity: "12121212-1212-4121-8121-121212121212",
  // Thành viên workspace **không** có `project_members` row cho Project B.
  // Họ tồn tại để `GET /projects/:projectId/member-candidates` có nhiều hơn
  // một trang — xem `memberCandidates`.
  userCandidateBinh: "16161616-1616-4161-8161-161616161616",
  userCandidateCuong: "17171717-1717-4171-8171-171717171717",
  userCandidateDung: "18181818-1818-4181-8181-181818181818",
  userCandidateGiang: "19191919-1919-4191-8191-191919191919",
  userCandidateKhanh: "20202020-2020-4202-8202-202020202020",
} as const;

const T0 = "2026-09-01T08:30:00Z";

export const actors: Readonly<Record<string, Actor>> = {
  ownerB: {
    id: ids.userOwnerB,
    displayName: "Mai",
    email: "mai@example.test",
    emailVerified: true,
  },
  editorB: {
    id: ids.userEditorB,
    displayName: "An Tran",
    email: "an@example.test",
    emailVerified: true,
  },
  viewerB: {
    id: ids.userViewerB,
    displayName: "Linh",
    email: "linh@example.test",
    emailVerified: true,
  },
  workspaceAdmin: {
    id: ids.userWorkspaceAdmin,
    displayName: "Quan",
    email: "quan@example.test",
    emailVerified: true,
  },
  ownerA: {
    id: ids.userOwnerA,
    displayName: "Hue",
    email: "hue@example.test",
    emailVerified: true,
  },
  /** Account đã đăng ký nhưng chưa xác minh email — dùng cho nhánh `403`. */
  unverified: {
    id: "13131313-1313-4131-8131-131313131313",
    displayName: "Chua Xac Minh",
    email: "unverified@example.test",
    emailVerified: false,
  },
};

export const workspace: Workspace = {
  id: ids.workspace,
  name: "Engineering",
  role: "workspace_admin",
  capabilities: [
    "workspace:read",
    "workspace:member:manage",
    "workspace:settings:update",
    "project:create",
  ],
};

export const projectB: Project = {
  id: ids.projectB,
  workspaceId: ids.workspace,
  name: "Launch",
  createdAt: T0,
  updatedAt: T0,
};

export const projectA: Project = {
  id: ids.projectA,
  workspaceId: ids.workspace,
  name: "Private A",
  createdAt: T0,
  updatedAt: T0,
};

/**
 * Bốn cột phản ánh đúng các điều kiện mà hợp đồng quan tâm: một cột yêu cầu
 * reviewer, một cột terminal, và hai cột thường.
 */
export const columns: readonly BoardColumn[] = [
  {
    id: ids.columnBacklog,
    projectId: ids.projectB,
    name: "Backlog",
    requiresReviewer: false,
    isTerminal: false,
    position: "1024.0000000000",
    archivedAt: null,
  },
  {
    id: ids.columnInProgress,
    projectId: ids.projectB,
    name: "In progress",
    requiresReviewer: false,
    isTerminal: false,
    position: "2048.0000000000",
    archivedAt: null,
  },
  {
    id: ids.columnReview,
    projectId: ids.projectB,
    name: "Review",
    requiresReviewer: true,
    isTerminal: false,
    position: "3072.0000000000",
    archivedAt: null,
  },
  {
    id: ids.columnDone,
    projectId: ids.projectB,
    name: "Done",
    requiresReviewer: false,
    isTerminal: true,
    position: "4096.0000000000",
    archivedAt: null,
  },
];

export const members: readonly ProjectMember[] = [
  {
    userId: ids.userOwnerB,
    displayName: "Mai",
    email: "mai@example.test",
    role: "owner",
  },
  {
    userId: ids.userEditorB,
    displayName: "An Tran",
    email: "an@example.test",
    role: "editor",
  },
  {
    userId: ids.userViewerB,
    displayName: "Linh",
    email: "linh@example.test",
    role: "viewer",
  },
];

/**
 * `GET /projects/:projectId/member-candidates` — thành viên workspace **chưa**
 * ở trong Project B.
 *
 * Ba người ở `members` cố ý vắng mặt: hợp đồng nói danh sách này là roster
 * workspace **trừ** project member hiện tại, nên một fixture chứa họ sẽ dạy
 * frontend rằng nó phải tự lọc — trong khi server đã lọc rồi.
 *
 * `Quan` là Workspace Admin quen thuộc; năm người còn lại tồn tại **chỉ** cho
 * fixture này. Lý do có họ: bảy dòng đủ để chia hai trang, và một danh sách
 * vừa đúng một trang sẽ để client bỏ quên nhánh `nextCursor` mà không ai thấy.
 * `Hue` (Owner của Project A) cũng là ứng viên hợp lệ — cùng workspace, không
 * phải member của Project B.
 *
 * Thứ tự đúng theo hợp đồng: `displayName`, rồi `userId` để tất định.
 */
export const memberCandidates: readonly MemberCandidate[] = [
  { userId: ids.userCandidateBinh, displayName: "Binh", email: "binh@example.test" },
  { userId: ids.userCandidateCuong, displayName: "Cuong", email: "cuong@example.test" },
  { userId: ids.userCandidateDung, displayName: "Dung", email: "dung@example.test" },
  { userId: ids.userCandidateGiang, displayName: "Giang", email: "giang@example.test" },
  { userId: ids.userOwnerA, displayName: "Hue", email: "hue@example.test" },
  { userId: ids.userCandidateKhanh, displayName: "Khanh", email: "khanh@example.test" },
  { userId: ids.userWorkspaceAdmin, displayName: "Quan", email: "quan@example.test" },
];

export const tasks: readonly Task[] = [
  {
    id: ids.taskOpen,
    projectId: ids.projectB,
    columnId: ids.columnInProgress,
    createdBy: { id: ids.userOwnerB, displayName: "Mai" },
    assigneeId: ids.userEditorB,
    reviewerId: null,
    title: "Chuẩn bị bản phát hành",
    description: "",
    category: "feature",
    priority: "medium",
    startDate: null,
    dueDate: null,
    dueState: "none",
    evidenceUrl: null,
    sprintId: null,
    position: "1024.0000000000",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: ids.taskOverdue,
    projectId: ids.projectB,
    columnId: ids.columnBacklog,
    createdBy: { id: ids.userEditorB, displayName: "An Tran" },
    assigneeId: null,
    reviewerId: null,
    title: "Rà soát nhật ký lỗi",
    description: "Kiểm tra các lỗi phát sinh tuần trước.",
    category: "bug",
    priority: "high",
    startDate: "2026-08-20",
    dueDate: "2026-08-31",
    dueState: "overdue",
    evidenceUrl: null,
    sprintId: null,
    position: "1024.0000000000",
    version: 3,
    createdAt: T0,
    updatedAt: T0,
  },
];

export const comments: readonly Comment[] = [
  {
    id: ids.comment,
    taskId: ids.taskOpen,
    author: { id: ids.userEditorB, displayName: "An Tran" },
    body: "Tôi nhận việc này.",
    createdAt: T0,
  },
];

export const activities: readonly Activity[] = [
  {
    id: ids.activity,
    taskId: ids.taskOpen,
    actor: { id: ids.userOwnerB, displayName: "Mai" },
    action: "task.created",
    summary: "Đã tạo công việc",
    createdAt: T0,
  },
];

/** Capabilities theo từng role project, dẫn xuất từ permission catalog. */
export const capabilitiesByRole = {
  owner: [
    "project:read",
    "project:update",
    "project:member:manage",
    "board-column:read",
    "board-column:manage",
    "task:read",
    "task:create",
    "task:update",
    "task:move",
    "task:assign",
    "comment:read",
    "comment:create",
    "activity:read",
  ],
  editor: [
    "project:read",
    "board-column:read",
    "task:read",
    "task:create",
    "task:update",
    "task:move",
    "task:assign",
    "comment:read",
    "comment:create",
    "activity:read",
  ],
  viewer: ["project:read", "board-column:read", "task:read", "comment:read", "activity:read"],
} as const;

/**
 * Lời mời **đang chờ** — [ADR-0013](../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Chỉ có `pending`: lời mời `accepted` và `revoked` là dữ liệu audit, không
 * phải danh sách để hành động, nên endpoint không trả chúng và fixture cũng
 * không dựng chúng. Một trong hai địa chỉ dưới đây cố ý **không** trùng actor
 * nào trong `actors`, vì mời theo email không cần account tồn tại — đó là cả
 * lý do phương án này được chọn.
 */
export const invitations: readonly PendingInvitation[] = [
  {
    id: ids.invitationPending,
    email: "nguoi-moi@example.test",
    role: "workspace_member",
    invitedBy: { id: ids.userWorkspaceAdmin, displayName: "Quan" },
    createdAt: T0,
    expiresAt: "2026-09-08T08:30:00Z",
  },
  {
    id: ids.invitationSecond,
    email: "quan-tri@example.test",
    role: "workspace_admin",
    invitedBy: { id: ids.userWorkspaceAdmin, displayName: "Quan" },
    createdAt: T0,
    expiresAt: "2026-09-08T08:30:00Z",
  },
];
