import { z } from "zod";

/**
 * Catalog permission — bản dịch của `docs/security/authorization-model.md`.
 *
 * Phân quyền là **deny by default**: một action chỉ được phép khi actor có
 * session hợp lệ, nằm đúng phạm vi workspace và project, và có đúng permission
 * cố định đó.
 *
 * Capability trong response là **affordance cho UI**, không phải quyết định
 * quyền. Server vẫn là nơi quyết định cuối cùng ở mọi request.
 */

/**
 * Quản trị workspace là một phạm vi riêng. Các khả năng ở cấp workspace
 * **không** hàm ý bất kỳ entry nào trong catalog của project — một Workspace
 * Admin chưa có project membership vẫn ở ngoài mọi project riêng tư.
 */
export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:member:manage",
  "workspace:settings:update",
  "project:create",
] as const;

/** Catalog đầy đủ của permission cấp project trong MVP và các phase đã đặc tả. */
export const PROJECT_PERMISSIONS = [
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

  // Phase 1.1
  "report:export",

  // Phase 1.4
  "sprint:read",
  "sprint:manage",

  // Phase 1.3
  "time-tracking:settings:update",
  "work-log:read",
  "work-log:create:self",
  "work-log:update:self",
  "work-log:submit:self",
  "work-log:review",
  "work-log:backfill:override",
  "time-report:read",
] as const;

export const PERMISSIONS = [...WORKSPACE_PERMISSIONS, ...PROJECT_PERMISSIONS] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];
export type Permission = WorkspacePermission | ProjectPermission;

export const permissionSchema = z.enum(PERMISSIONS);
export const workspacePermissionSchema = z.enum(WORKSPACE_PERMISSIONS);
export const projectPermissionSchema = z.enum(PROJECT_PERMISSIONS);

/** Ba vai trò project cố định. Không có custom role trong MVP. */
export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export const projectRoleSchema = z.enum(PROJECT_ROLES);

/** Hai vai trò workspace cố định. */
export const WORKSPACE_ROLES = ["workspace_admin", "workspace_member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);

/**
 * Danh sách capability do server tính cho chính actor trên chính resource đó.
 *
 * Client gọi `can(action, resource)` và **không** tự suy affordance từ role,
 * status, ngày hay tác giả — đó là duplicate policy bị authorization model cấm.
 */
export const capabilitiesSchema = z.array(permissionSchema);
