import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "../../shared/database/client.ts";
import type { Provider } from "@nestjs/common";
import type { AuthorizationService } from "../../shared/authorization/index.ts";
import type { Mailer } from "../../shared/mail/mailer.port.ts";
import type { RateLimiter } from "../../shared/http/rate-limit.ts";
import { WorkspaceRepository } from "./infrastructure/workspace-repository.ts";
import { InvitationRepository } from "./infrastructure/invitation-repository.ts";
import { InvitationUseCases } from "./application/invitation-use-cases.ts";
import { WorkspaceUseCases } from "./application/workspace-use-cases.ts";
import {
  WORKSPACE_TOKENS,
  WorkspacesController,
  type WorkspaceHttpConfig,
} from "./presentation/workspaces.controller.ts";

/**
 * Wiring của module `workspaces`.
 *
 * `workspaces` là **gốc** của đồ thị phụ thuộc sản phẩm theo ADR-0005: nó không
 * import module nào khác. `projects` phụ thuộc nó (qua port đọc membership
 * workspace), không phải ngược lại.
 */
@Module({})
export class WorkspacesModule {
  static register(deps: {
    db: Database;
    authorization: AuthorizationService;
    config: WorkspaceHttpConfig;
    cursorSecret: string;
    mailer: Mailer;
    limiter: RateLimiter;
    guards: Provider[];
  }): DynamicModule {
    const workspaceRepository = new WorkspaceRepository(deps.db);

    const useCases = new WorkspaceUseCases({
      db: deps.db,
      repository: workspaceRepository,
      authorization: deps.authorization,
      cursorSecret: deps.cursorSecret,
    });

    const invitations = new InvitationUseCases({
      db: deps.db,
      invitations: new InvitationRepository(deps.db),
      workspaces: workspaceRepository,
      mailer: deps.mailer,
      cursorSecret: deps.cursorSecret,
    });

    return {
      module: WorkspacesModule,
      controllers: [WorkspacesController],
      providers: [
        ...deps.guards,
        { provide: WORKSPACE_TOKENS.useCases, useValue: useCases },
        { provide: WORKSPACE_TOKENS.invitations, useValue: invitations },
        { provide: WORKSPACE_TOKENS.rateLimiter, useValue: deps.limiter },
        { provide: WORKSPACE_TOKENS.config, useValue: deps.config },
        { provide: WORKSPACE_TOKENS.db, useValue: deps.db },
      ],
    };
  }
}
