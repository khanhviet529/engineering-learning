import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "../../shared/database/client.ts";
import type { Provider } from "@nestjs/common";
import type { AuthorizationService } from "../../shared/authorization/index.ts";
import { ProjectRepository } from "./infrastructure/project-repository.ts";
import { DrizzleWorkspaceMembershipAdapter } from "./infrastructure/workspace-membership-adapter.ts";
import { ProjectUseCases } from "./application/project-use-cases.ts";
import {
  NoTasksYetAssigneeCheck,
  type ProjectAssigneeCheck,
} from "./domain/project-membership-rules.ts";
import {
  PROJECT_TOKENS,
  ProjectsController,
  type ProjectHttpConfig,
} from "./presentation/projects.controller.ts";

/**
 * Wiring của module `projects`.
 *
 * Composition root nối hai port mà domain của module này định nghĩa:
 *
 * - `WorkspaceMembershipPort` → adapter đọc `workspace_members`.
 * - `ProjectAssigneeCheck` → ở M2 là `NoTasksYetAssigneeCheck`; **M4 thay bằng
 *   adapter thật của module `tasks`** khi bảng `tasks` tồn tại.
 *
 * `assigneeCheck` là tham số **bắt buộc** chứ không có giá trị mặc định ẩn:
 * một mặc định im lặng ở đây nghĩa là M4 có thể quên nối adapter thật mà không
 * gì báo, và bất biến "không gỡ người đang giữ việc" sẽ âm thầm luôn đúng.
 */
@Module({})
export class ProjectsModule {
  static register(deps: {
    db: Database;
    authorization: AuthorizationService;
    assigneeCheck: ProjectAssigneeCheck;
    config: ProjectHttpConfig;
    cursorSecret: string;
    guards: Provider[];
  }): DynamicModule {
    const useCases = new ProjectUseCases({
      db: deps.db,
      repository: new ProjectRepository(deps.db),
      authorization: deps.authorization,
      workspaceMembership: new DrizzleWorkspaceMembershipAdapter(deps.db),
      assigneeCheck: deps.assigneeCheck,
      cursorSecret: deps.cursorSecret,
    });

    return {
      module: ProjectsModule,
      controllers: [ProjectsController],
      providers: [
        ...deps.guards,
        { provide: PROJECT_TOKENS.useCases, useValue: useCases },
        { provide: PROJECT_TOKENS.config, useValue: deps.config },
        { provide: PROJECT_TOKENS.db, useValue: deps.db },
      ],
    };
  }
}

export { NoTasksYetAssigneeCheck };
