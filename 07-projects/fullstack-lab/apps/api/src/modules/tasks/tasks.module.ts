import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import type { Database } from "../../shared/database/client.ts";
import type { MembershipReader } from "../../shared/authorization/index.ts";
import type { ActivityRecorder } from "../activity/domain/activity-recorder.ts";
import type { ActivityQueries } from "../activity/infrastructure/activity-repository.ts";
import type { ColumnRepository } from "../board-columns/infrastructure/column-repository.ts";
import type { WorkspaceClock } from "./domain/due-state.ts";
import { CommentRepository } from "./infrastructure/comment-repository.ts";
import type { TaskRepository } from "./infrastructure/task-repository.ts";
import { TaskUseCases } from "./application/task-use-cases.ts";
import { CommentUseCases } from "./application/comment-use-cases.ts";
import {
  TASK_TOKENS,
  TasksController,
  type TaskHttpConfig,
} from "./presentation/tasks.controller.ts";

/**
 * Wiring của module `tasks`.
 *
 * `TaskRepository` và `ColumnRepository` được **truyền vào** chứ không dựng ở
 * đây: composition root cần cùng instance cho chuỗi guard (`TaskProjectResolver`)
 * và cho hai adapter port mà `board-columns` và `projects` phụ thuộc. Dựng bản
 * thứ hai ở đây sẽ chạy đúng nhưng giữ hai pool statement riêng mà không ai
 * được gì — và tệ hơn, che mất việc chỉ có một cái được nối vào guard.
 *
 * `WorkspaceClock` cũng vào từ ngoài: `dueState` phải suy theo timezone
 * workspace, và test cần cắm một đồng hồ đứng yên để khẳng định điều đó thay vì
 * đọc giờ của máy chạy test.
 */
@Module({})
export class TasksModule {
  static register(deps: {
    db: Database;
    repository: TaskRepository;
    columns: ColumnRepository;
    membership: MembershipReader;
    activity: ActivityRecorder;
    activityQueries: ActivityQueries;
    clock: WorkspaceClock;
    config: TaskHttpConfig;
    cursorSecret: string;
    guards: Provider[];
  }): DynamicModule {
    const comments = new CommentRepository(deps.db);

    const tasks = new TaskUseCases({
      db: deps.db,
      repository: deps.repository,
      columns: deps.columns,
      membership: deps.membership,
      activity: deps.activity,
      clock: deps.clock,
      cursorSecret: deps.cursorSecret,
    });

    const commentUseCases = new CommentUseCases({
      db: deps.db,
      comments,
      tasks: deps.repository,
      activity: deps.activity,
      activityQueries: deps.activityQueries,
      cursorSecret: deps.cursorSecret,
    });

    return {
      module: TasksModule,
      controllers: [TasksController],
      providers: [
        ...deps.guards,
        { provide: TASK_TOKENS.tasks, useValue: tasks },
        { provide: TASK_TOKENS.comments, useValue: commentUseCases },
        { provide: TASK_TOKENS.config, useValue: deps.config },
        { provide: TASK_TOKENS.db, useValue: deps.db },
      ],
    };
  }
}
