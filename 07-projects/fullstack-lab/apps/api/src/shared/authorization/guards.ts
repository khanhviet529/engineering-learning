import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { ProjectPermission, WorkspacePermission } from "@flowboard/contracts";
import { AppError, validationError } from "../errors/app-error.ts";
import { SESSION_COOKIE_NAME } from "../http/session-cookie.ts";
import type { AuthorizationService } from "./authorization-service.ts";
import type { Actor } from "./membership.ts";

/**
 * Chuỗi guard bắt buộc — `docs/security/authorization-model.md`:
 *
 * ```text
 * SessionGuard → ResourceProjectResolver → ProjectPermissionGuard → Zod → use case
 * ```
 *
 * Thứ tự này không phải sở thích. `SessionGuard` biến một session opaque hợp lệ
 * thành actor, hoặc từ chối `401` — nó **chỉ** xác thực, không quyết định
 * permission. Resolver lấy project sở hữu từ **chính resource**, không tin
 * `projectId` do client gửi kèm. Guard cuối mới đánh giá action.
 *
 * Bỏ hay đảo một mắt xích là mở một đường vòng: nếu permission được đánh giá
 * trước khi resolve resource, một `projectId` do client chọn sẽ quyết định
 * quyền cho một `taskId` thuộc project khác.
 */

/**
 * Token DI của kernel.
 *
 * Dependency được khai bằng **Symbol tường minh**, không dựa vào kiểu suy ra từ
 * metadata: `emitDecoratorMetadata` chỉ có ở `tsc`, còn esbuild — thứ vitest
 * dùng — không phát `design:paramtypes`. Một constructor dựa vào metadata sẽ
 * chạy khi build và hỏng khi test, và đó là loại khác biệt tệ nhất giữa hai môi
 * trường. Module `auth` đã dùng đúng quy ước này từ M1.
 */
export const AUTHZ_TOKENS = {
  actorResolver: Symbol("ActorResolver"),
  authorization: Symbol("AuthorizationService"),
  projectResolver: Symbol("ResourceProjectResolver"),
} as const;

/* -------------------------------------------------------------------------- *
 * SessionGuard
 * -------------------------------------------------------------------------- */

/**
 * Cổng resolve session → actor.
 *
 * Guard **định nghĩa** port này; module `auth` cung cấp adapter và composition
 * root nối hai bên. Đây là dependency inversion đúng như ADR-0005 mô tả cho
 * `ColumnEmptinessCheck`: nhờ nó, `shared/authorization` không import module
 * nào, kể cả `auth`, và đồ thị phụ thuộc vẫn acyclic.
 */
export interface ActorResolver {
  /**
   * Đổi một session token thô lấy actor, hoặc `undefined` khi token không dùng
   * được (không tồn tại, hết hạn, đã revoke).
   *
   * Tên method mô tả **việc**, không mô tả người hiện thực: bất kỳ nguồn danh
   * tính nào cũng có thể cung cấp nó, và guard không biết nguồn đó là gì.
   */
  resolveSession(sessionToken: string): Promise<Actor | undefined>;
}

/** Request sau khi đi qua chuỗi guard. */
export interface AuthenticatedRequest extends FastifyRequest {
  actor: Actor;
  requestId: string;
}

export function getActor(request: FastifyRequest): Actor {
  const actor = (request as Partial<AuthenticatedRequest>).actor;
  // Không có actor ở đây nghĩa là route quên gắn `SessionGuard`. Ném lỗi nội bộ
  // chứ **không** đoán một actor rỗng: đoán ở đây là bỏ qua xác thực.
  if (actor === undefined) {
    throw new AppError("INTERNAL_ERROR", {
      cause: new Error("Route thiếu SessionGuard: không có actor trên request."),
    });
  }
  return actor;
}

@Injectable()
export class SessionGuard implements CanActivate {
  readonly #resolver: ActorResolver;

  constructor(@Inject(AUTHZ_TOKENS.actorResolver) resolver: ActorResolver) {
    this.#resolver = resolver;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token === undefined) throw new AppError("UNAUTHENTICATED");

    const actor = await this.#resolver.resolveSession(token);
    if (actor === undefined) throw new AppError("UNAUTHENTICATED");

    (request as AuthenticatedRequest).actor = actor;
    return true;
  }
}

/* -------------------------------------------------------------------------- *
 * ResourceProjectResolver
 * -------------------------------------------------------------------------- */

/**
 * Resolve resource của route về project sở hữu nó.
 *
 * Ở M2 chỉ có `:projectId`, nên resolver là phép đồng nhất. Nó vẫn tồn tại như
 * một mắt xích riêng vì hình dạng của chuỗi phải đúng **trước** khi có resource
 * lồng nhau: M3 thêm `:columnId`, M4 thêm `:taskId` và `:commentId`, và mỗi cái
 * resolve về project qua đường riêng của nó.
 *
 * Quy tắc không đổi khi danh sách dài ra: resolver đọc chủ sở hữu từ **chính
 * resource**, và một `projectId` do client gửi trong body hay query không bao
 * giờ ghi đè kết quả đó.
 */
export interface ResolveContext {
  params: Record<string, string>;
  /**
   * Body đã parse bởi Fastify, **chưa** qua Zod của controller.
   *
   * Chỉ đúng một route dùng tới nó: `POST /columns/reorder` mang `projectId`
   * trong body vì nó không có resource nào trên path. Với route đó, `projectId`
   * là **locator của resource**, không phải một lời khai về quyền — an toàn đến
   * từ hai chỗ khác: guard authorize đúng project đó, rồi use case kiểm rằng
   * mọi `columnId` gửi lên thuộc **chính** project ấy.
   *
   * Quy tắc cũ không đổi: khi route đã có resource trên path, một `projectId`
   * trong body **không bao giờ** ghi đè chủ sở hữu đã resolve từ resource.
   */
  body: unknown;
}

export interface ResourceProjectResolver {
  /** Trả `undefined` khi resource không tồn tại — người gọi dịch thành `404`. */
  resolveProjectId(context: ResolveContext): Promise<string | undefined>;
}

/**
 * Định dạng UUID. Một ID sai định dạng **không thể** trỏ tới resource nào, nên
 * nó bị chặn ở đây thay vì được đẩy xuống database.
 *
 * Đẩy xuống thì PostgreSQL ném lỗi kiểu và người dùng nhận `500` cho một request
 * mà lỗi hoàn toàn nằm ở phía họ — vừa sai hợp đồng, vừa làm mọi lần dò ID rác
 * trở thành một dòng lỗi trong log vận hành.
 *
 * `400` ở đây **không** rò rỉ gì: một chuỗi không phải UUID không bao giờ là ID
 * của một resource có thật, nên câu trả lời không phân biệt được tồn tại hay
 * không.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!UUID_PATTERN.test(value)) {
    throw validationError([
      { field, code: "invalid_uuid", message: "Định danh không đúng định dạng." },
    ]);
  }
  return value;
}

/** Resolver của M2: route mang thẳng `:projectId`. */
export class DirectProjectIdResolver implements ResourceProjectResolver {
  async resolveProjectId(context: ResolveContext): Promise<string | undefined> {
    return requireUuid(context.params["projectId"], "projectId");
  }
}

/** Dùng lại phép kiểm UUID cho các resolver ở module khác. */
export { requireUuid as requireResourceUuid };

/* -------------------------------------------------------------------------- *
 * Decorator và guard permission
 * -------------------------------------------------------------------------- */

const PROJECT_PERMISSION_KEY = "flowboard:project-permission";
const WORKSPACE_PERMISSION_KEY = "flowboard:workspace-permission";

/**
 * Khai báo action mà route yêu cầu.
 *
 * Mỗi controller **tự khai** action của mình. Guard không đoán từ HTTP method:
 * `POST /tasks/:id/move` là `task:move`, không phải `task:update`, và chỉ
 * controller mới biết điều đó.
 */
export const RequireProjectPermission = (permission: ProjectPermission) =>
  SetMetadata(PROJECT_PERMISSION_KEY, permission);

export const RequireWorkspacePermission = (permission: WorkspacePermission) =>
  SetMetadata(WORKSPACE_PERMISSION_KEY, permission);

/** Authorization đã resolve, gắn lên request để use case dùng lại. */
export interface AuthorizedRequest extends AuthenticatedRequest {
  projectAuthorization?: { projectId: string; role: string; capabilities: ProjectPermission[] };
  workspaceAuthorization?: {
    workspaceId: string;
    role: string;
    capabilities: WorkspacePermission[];
  };
}

@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  readonly #authorization: AuthorizationService;
  readonly #resolver: ResourceProjectResolver;
  readonly #reflector: Reflector;

  constructor(
    @Inject(AUTHZ_TOKENS.authorization) authorization: AuthorizationService,
    @Inject(AUTHZ_TOKENS.projectResolver) resolver: ResourceProjectResolver,
    @Inject(Reflector) reflector: Reflector,
  ) {
    this.#authorization = authorization;
    this.#resolver = resolver;
    this.#reflector = reflector;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.#reflector.getAllAndOverride<ProjectPermission | undefined>(
      PROJECT_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Route không khai action project thì guard này không có việc gì làm.
    if (permission === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = getActor(request);
    const params = request.params as Record<string, string>;

    const projectId = await this.#resolver.resolveProjectId({ params, body: request.body });
    // Resource không resolve được: `404`, cùng response với "không phải member".
    if (projectId === undefined) throw new AppError("NOT_FOUND");

    const authorization = await this.#authorization.authorizeProject(
      actor.id,
      projectId,
      permission,
    );

    (request as AuthorizedRequest).projectAuthorization = authorization;
    return true;
  }
}

@Injectable()
export class WorkspacePermissionGuard implements CanActivate {
  readonly #authorization: AuthorizationService;
  readonly #reflector: Reflector;

  constructor(
    @Inject(AUTHZ_TOKENS.authorization) authorization: AuthorizationService,
    @Inject(Reflector) reflector: Reflector,
  ) {
    this.#authorization = authorization;
    this.#reflector = reflector;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.#reflector.getAllAndOverride<WorkspacePermission | undefined>(
      WORKSPACE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (permission === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = getActor(request);
    const params = request.params as Record<string, string>;

    const workspaceId = requireUuid(params["workspaceId"], "workspaceId");
    if (workspaceId === undefined) throw new AppError("NOT_FOUND");

    const authorization = await this.#authorization.authorizeWorkspace(
      actor.id,
      workspaceId,
      permission,
    );

    (request as AuthorizedRequest).workspaceAuthorization = authorization;
    return true;
  }
}
