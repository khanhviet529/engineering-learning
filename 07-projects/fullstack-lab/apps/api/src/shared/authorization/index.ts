/**
 * Public entry point của kernel authorization.
 *
 * Module import **từ đây**, không deep-import file bên trong: giữ bề mặt hẹp là
 * cách duy nhất để sau này đổi cấu trúc bên trong mà không phải sửa mọi module.
 */

export { MembershipReader, type Actor, type Executor } from "./membership.ts";
export {
  AuthorizationService,
  type ProjectAuthorization,
  type WorkspaceAuthorization,
} from "./authorization-service.ts";
export {
  CORE_MVP_PROJECT_PERMISSIONS,
  projectCapabilities,
  projectRoleAllows,
  workspaceCapabilities,
  workspaceRoleAllows,
} from "./permissions.ts";
export {
  DirectProjectIdResolver,
  ProjectPermissionGuard,
  RequireProjectPermission,
  RequireWorkspacePermission,
  SessionGuard,
  WorkspacePermissionGuard,
  getActor,
  type ActorResolver,
  type AuthenticatedRequest,
  type AuthorizedRequest,
  type ResourceProjectResolver,
} from "./guards.ts";
export {
  buildAuthorizationWiring,
  type AuthorizationDeps,
  type AuthorizationWiring,
} from "./providers.ts";
