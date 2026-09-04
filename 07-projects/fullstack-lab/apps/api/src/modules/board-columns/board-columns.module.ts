import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import type { Database } from "../../shared/database/client.ts";
import type { ActivityRecorder } from "../activity/domain/activity-recorder.ts";
import { ColumnUseCases } from "./application/column-use-cases.ts";
import {
  NoTasksYetEmptinessCheck,
  type ColumnEmptinessCheck,
} from "./domain/column-emptiness-check.ts";
import type { ColumnRepository } from "./infrastructure/column-repository.ts";
import {
  COLUMN_TOKENS,
  ColumnsController,
  type ColumnHttpConfig,
} from "./presentation/columns.controller.ts";

/**
 * Wiring của module `board-columns`.
 *
 * Hai port được nối từ ngoài vào, và cả hai đều **bắt buộc** chứ không có mặc
 * định ẩn:
 *
 * - `activity` → `DrizzleActivityRecorder` của module leaf `activity`.
 * - `emptiness` → ở M3 là `NoTasksYetEmptinessCheck`; **M4 thay bằng adapter
 *   thật của module `tasks`**.
 *
 * Một mặc định im lặng cho `emptiness` nghĩa là M4 có thể quên nối adapter thật
 * mà không gì báo — và luật "không archive cột còn task" sẽ âm thầm luôn đúng,
 * đúng kiểu test xanh vì không có gì để kiểm.
 *
 * `ColumnProjectResolver` **không** được đăng ký ở đây: nó là mắt xích của chuỗi
 * guard, nên composition root truyền nó vào `buildAuthorizationWiring` cùng lúc
 * với `ActorResolver`. Đăng ký hai chỗ sẽ tạo hai instance resolver và chỉ một
 * cái được guard dùng.
 */
@Module({})
export class BoardColumnsModule {
  static register(deps: {
    db: Database;
    /** Cùng instance mà chuỗi guard và `ProjectColumnsQuery` dùng. */
    repository: ColumnRepository;
    activity: ActivityRecorder;
    emptiness: ColumnEmptinessCheck;
    config: ColumnHttpConfig;
    guards: Provider[];
  }): DynamicModule {
    const useCases = new ColumnUseCases({
      db: deps.db,
      repository: deps.repository,
      activity: deps.activity,
      emptiness: deps.emptiness,
    });

    return {
      module: BoardColumnsModule,
      controllers: [ColumnsController],
      providers: [
        ...deps.guards,
        { provide: COLUMN_TOKENS.useCases, useValue: useCases },
        { provide: COLUMN_TOKENS.config, useValue: deps.config },
        { provide: COLUMN_TOKENS.db, useValue: deps.db },
      ],
    };
  }
}

export { NoTasksYetEmptinessCheck };
