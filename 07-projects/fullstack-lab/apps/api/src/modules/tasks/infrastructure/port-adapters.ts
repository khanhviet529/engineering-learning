import type { Transaction } from "../../../shared/database/client.ts";
import type { ColumnEmptinessCheck } from "../../board-columns/domain/column-emptiness-check.ts";
import type { ProjectAssigneeCheck } from "../../projects/domain/project-membership-rules.ts";
import type { TaskRepository } from "./task-repository.ts";

/**
 * Hai adapter mà M2 và M3 đã hứa, và M4 là lúc trả.
 *
 * Cả hai port được **định nghĩa ở module cần chúng** và **hiện thực ở module có
 * dữ liệu** — đúng khuôn dependency inversion mà ADR-0005 mô tả:
 *
 * - `board-columns` định nghĩa `ColumnEmptinessCheck` vì luật "không archive cột
 *   còn task" là luật của nó; `tasks` biết bảng `tasks` nên hiện thực nó.
 * - `projects` định nghĩa `ProjectAssigneeCheck` vì luật "không gỡ member đang
 *   giữ việc" là luật của nó; `tasks` hiện thực nó.
 *
 * Chiều import ở source code vì vậy chỉ có `tasks → board-columns → projects`,
 * và đồ thị vẫn acyclic. Không `forwardRef` nào phải xuất hiện.
 *
 * ## Vì sao đây là bằng chứng chứ không phải thủ tục
 *
 * M2 và M3 đã có **test** cho hai luật này, chạy qua một adapter điều khiển
 * được từ fixture. Những test đó chứng minh **đường đi**: use case thật sự hỏi
 * port, và một câu trả lời `true` thật sự chặn được thao tác. Việc còn lại ở
 * đây chỉ là nối dây tới dữ liệu thật — và vì luật không phải viết lại dòng
 * nào, cái giá của việc dựng port sớm được trả lại đúng ở chỗ này.
 */

/** `ColumnEmptinessCheck` thật: cột còn task hay không, đọc từ bảng `tasks`. */
export class TaskColumnEmptinessCheck implements ColumnEmptinessCheck {
  readonly #tasks: TaskRepository;

  constructor(tasks: TaskRepository) {
    this.#tasks = tasks;
  }

  async hasTasks(input: { projectId: string; columnId: string; tx: unknown }): Promise<boolean> {
    /**
     * Dùng **đúng** transaction mà use case archive đang mở.
     *
     * Port khai `tx: unknown` vì `board-columns` không được biết kiểu
     * transaction của Drizzle — nếu nó biết, port đã không còn là port. Ép kiểu
     * ở đây là chỗ duy nhất trong toàn hệ thống biết cả hai đầu, và nó có mặt
     * để phép đếm chạy trong cùng ảnh chụp với lệnh ghi: hỏi ngoài transaction
     * là đọc một con số có thể đã cũ vào lúc archive commit.
     */
    return await this.#tasks.columnHasTasks(
      input.projectId,
      input.columnId,
      input.tx as Transaction,
    );
  }
}

/** `ProjectAssigneeCheck` thật: người này còn giữ task nào trong project không. */
export class TaskProjectAssigneeCheck implements ProjectAssigneeCheck {
  readonly #tasks: TaskRepository;

  constructor(tasks: TaskRepository) {
    this.#tasks = tasks;
  }

  async hasAssignedTasks(input: {
    projectId: string;
    userId: string;
    tx: unknown;
  }): Promise<boolean> {
    return await this.#tasks.userHasAssignedTasks(
      input.projectId,
      input.userId,
      input.tx as Transaction,
    );
  }
}
