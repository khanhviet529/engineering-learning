import type { Provider } from "@nestjs/common";
import type { Database } from "../database/client.ts";
import { MembershipReader } from "./membership.ts";
import { AuthorizationService } from "./authorization-service.ts";
import {
  AUTHZ_TOKENS,
  DirectProjectIdResolver,
  ProjectPermissionGuard,
  SessionGuard,
  WorkspacePermissionGuard,
  type ActorResolver,
  type ResourceProjectResolver,
} from "./guards.ts";

/**
 * Cung cấp chuỗi guard cho một module.
 *
 * Guard nhận dependency qua constructor chứ không qua decorator `@Inject`, nên
 * chúng được đăng ký bằng `useValue` với instance đã dựng sẵn. Cách này giữ
 * việc nối dây ở **composition root** — đúng chỗ ADR-0005 nói phải nối
 * `ColumnEmptinessCheck` — thay vì rải `@Injectable` và để Nest tự đoán.
 *
 * Một hàm dùng chung thay vì chép ba dòng provider vào từng module: nếu chuỗi
 * guard đổi hình dạng, nó đổi ở đúng một chỗ, và không module nào có thể vô
 * tình đăng ký thiếu một mắt xích.
 */
export interface AuthorizationDeps {
  db: Database;
  actorResolver: ActorResolver;
  /** Mặc định là resolver của M2; M3/M4 truyền resolver biết `:columnId`, `:taskId`. */
  projectResolver?: ResourceProjectResolver;
}

export interface AuthorizationWiring {
  authorization: AuthorizationService;
  /**
   * Bộ đọc membership đã dựng.
   *
   * Trả ra ngoài để composition root nối lại cho module cần đọc vai trò project
   * — `tasks` phải xác nhận assignee/reviewer là ProjectMember. Dựng một
   * `MembershipReader` thứ hai cũng chạy, nhưng khi đó "ai đọc bảng membership"
   * không còn trả lời được bằng một chỗ.
   */
  membership: MembershipReader;
  providers: Provider[];
}

export function buildAuthorizationWiring(deps: AuthorizationDeps): AuthorizationWiring {
  const membership = new MembershipReader(deps.db);
  const authorization = new AuthorizationService(membership);
  const resolver = deps.projectResolver ?? new DirectProjectIdResolver();

  return {
    authorization,
    membership,
    providers: [
      // Giá trị cho từng token.
      { provide: AUTHZ_TOKENS.actorResolver, useValue: deps.actorResolver },
      { provide: AUTHZ_TOKENS.authorization, useValue: authorization },
      { provide: AUTHZ_TOKENS.projectResolver, useValue: resolver },
      // Guard được Nest dựng từ các token trên. Chúng phải là **class provider**
      // chứ không phải `useValue`: `@UseGuards(Class)` đăng ký enhancer theo
      // class, và Nest dựng enhancer qua injector riêng chứ không tra `providers`
      // — một `useValue` cùng token vẫn bị bỏ qua ở đường đó.
      SessionGuard,
      ProjectPermissionGuard,
      WorkspacePermissionGuard,
    ],
  };
}
