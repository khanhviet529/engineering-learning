import {
  PROJECT_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  type ProjectPermission,
  type ProjectRole,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@flowboard/contracts";

/**
 * Catalog permission dưới dạng dữ liệu — bản dịch của bảng trong
 * `docs/security/authorization-model.md`.
 *
 * Đây là **quyết định thuần tuý**: không I/O, không database, không HTTP. Tách
 * ra như vậy để toàn bộ ma trận Allow/Deny kiểm được ở lớp unit, từng ô một,
 * mà không phải dựng server hay seed dữ liệu. Ma trận là thứ dễ sai âm thầm
 * nhất trong cả hệ thống, và một bảng dữ liệu thì đọc-đối-chiếu được với tài
 * liệu bằng mắt, còn một chuỗi `if` thì không.
 *
 * Phân quyền là **deny by default**: không có trong map nghĩa là Deny.
 */

/**
 * Vai trò project → tập permission.
 *
 * Bảng này chép đúng catalog, **gồm cả** permission của các phase chưa mở. Lý
 * do: ma trận test bắt buộc đánh giá mọi ô, và kết quả Allow/Deny của các phase
 * sau đã được chốt từ bây giờ để client và test không phải đoán khi phase đó
 * khởi động. Việc một route chưa tồn tại là chuyện khác — xem `CORE_MVP_*` bên
 * dưới.
 */
const PROJECT_ROLE_PERMISSIONS: Readonly<Record<ProjectRole, readonly ProjectPermission[]>> = {
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
    "report:export",
    "sprint:read",
    "sprint:manage",
    "time-tracking:settings:update",
    "work-log:read",
    "work-log:create:self",
    "work-log:update:self",
    "work-log:submit:self",
    "work-log:review",
    "work-log:backfill:override",
    "time-report:read",
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
    "sprint:read",
    "work-log:read",
    "work-log:create:self",
    "work-log:update:self",
    "work-log:submit:self",
    // `work-log:review` và `time-report:read` **không** nằm ở đây: chúng không
    // phải quyền theo role thuần. Editor chỉ có chúng khi đang giữ một record
    // `ProjectTimeApprover` — điều kiện đó nằm ở `TIME_APPROVER_PERMISSIONS`.
  ],
  viewer: [
    "project:read",
    "board-column:read",
    "task:read",
    "comment:read",
    "activity:read",
    "sprint:read",
    "work-log:read",
  ],
};

/**
 * Permission mà một Editor **chỉ** có khi đang là Time Approver của project đó
 * (Phase 1.3).
 *
 * Tách riêng thay vì nhét vào `editor` là có chủ đích: nếu chúng nằm chung,
 * `can()` sẽ trả Allow cho mọi Editor và điều kiện approver trở thành một phép
 * kiểm bổ sung mà ai đó sẽ quên gọi. Ở đây, quên truyền `isTimeApprover` thì
 * kết quả là Deny — hướng an toàn.
 */
const TIME_APPROVER_PERMISSIONS: readonly ProjectPermission[] = [
  "work-log:review",
  "time-report:read",
];

/** Vai trò workspace → tập permission. */
const WORKSPACE_ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly WorkspacePermission[]>> =
  {
    workspace_admin: [
      "workspace:read",
      "workspace:member:manage",
      "workspace:settings:update",
      "project:create",
    ],
    // Workspace Member chỉ đọc workspace của mình. Không tạo project, không quản
    // trị — và quan trọng nhất, không có gì trong catalog của project.
    workspace_member: ["workspace:read"],
  };

/**
 * Tập permission mà **capabilities trong response** được phép công bố.
 *
 * Hẹp hơn catalog một cách có chủ đích. `capabilities` là affordance cho UI:
 * nói với frontend rằng nó làm được một việc mà server sẽ từ chối là tệ hơn
 * việc không nói gì. Ba nhóm bị loại:
 *
 * - `report:export` (Phase 1.1) — route chưa tồn tại.
 * - `sprint:*` (Phase 1.4) — còn phụ thuộc `project_sprint_settings.enabled`.
 * - `work-log:*`, `time-*` (Phase 1.3) — còn phụ thuộc
 *   `project_time_tracking_settings.enabled` và, với hai cái, record approver.
 *
 * Khi phase tương ứng mở, permission của nó được đưa vào đây **cùng** với điều
 * kiện per-project của nó, không sớm hơn.
 */
export const CORE_MVP_PROJECT_PERMISSIONS: readonly ProjectPermission[] = [
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
];

/** Điều kiện phụ thuộc trạng thái, ngoài vai trò. */
export interface ProjectPermissionContext {
  /** Actor đang giữ record `ProjectTimeApprover` của project này (Phase 1.3). */
  isTimeApprover?: boolean;
}

/**
 * Vai trò project này có được phép thực hiện action này không?
 *
 * Hàm thuần, không I/O. Membership đã được resolve trước khi gọi: `role`
 * `undefined` nghĩa là **không phải thành viên**, và đó luôn là Deny.
 */
export function projectRoleAllows(
  role: ProjectRole | undefined,
  permission: ProjectPermission,
  context: ProjectPermissionContext = {},
): boolean {
  if (role === undefined) return false;

  if (PROJECT_ROLE_PERMISSIONS[role].includes(permission)) return true;

  // Owner là approver ngầm định; Editor cần record approver hiện hành.
  if (TIME_APPROVER_PERMISSIONS.includes(permission)) {
    if (role === "owner") return true;
    if (role === "editor") return context.isTimeApprover === true;
  }

  return false;
}

/** Vai trò workspace này có được phép thực hiện action cấp workspace này không? */
export function workspaceRoleAllows(
  role: WorkspaceRole | undefined,
  permission: WorkspacePermission,
): boolean {
  if (role === undefined) return false;
  return WORKSPACE_ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Capabilities công bố cho frontend, tính cho đúng actor trên đúng project.
 *
 * Giữ thứ tự của `CORE_MVP_PROJECT_PERMISSIONS` để response ổn định giữa các
 * lần gọi — một mảng đảo thứ tự ngẫu nhiên làm cache và snapshot test nhiễu mà
 * không mang thêm thông tin nào.
 */
export function projectCapabilities(role: ProjectRole | undefined): ProjectPermission[] {
  if (role === undefined) return [];
  return CORE_MVP_PROJECT_PERMISSIONS.filter((permission) => projectRoleAllows(role, permission));
}

/** Capabilities cấp workspace cho đúng actor trên đúng workspace. */
export function workspaceCapabilities(role: WorkspaceRole | undefined): WorkspacePermission[] {
  if (role === undefined) return [];
  return WORKSPACE_PERMISSIONS.filter((permission) => workspaceRoleAllows(role, permission));
}

/** Dùng cho test đối chiếu: catalog phải phủ đúng danh sách của contract. */
export const ALL_PROJECT_PERMISSIONS = PROJECT_PERMISSIONS;
export const ALL_WORKSPACE_PERMISSIONS = WORKSPACE_PERMISSIONS;
