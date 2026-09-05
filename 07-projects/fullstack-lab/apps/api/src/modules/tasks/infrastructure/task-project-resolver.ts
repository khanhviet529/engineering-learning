import {
  requireResourceUuid,
  type ResolveContext,
  type ResourceProjectResolver,
} from "../../../shared/authorization/index.ts";
import type { ColumnRepository } from "../../board-columns/infrastructure/column-repository.ts";
import type { TaskRepository } from "./task-repository.ts";

/**
 * Resolver của M4: bốn hình dạng route, bốn đường tìm project sở hữu.
 *
 * | Route | Resource nằm ở | Cách resolve |
 * |---|---|---|
 * | `.../projects/:projectId/...` | path `:projectId` | chính nó |
 * | `PATCH /columns/:columnId` | path `:columnId` | tra `board_columns` |
 * | `GET|PATCH|POST /tasks/:taskId/...` | path `:taskId` | tra `tasks` |
 * | `POST /columns/reorder` | body `projectId` | chính nó |
 *
 * Điều giữ nguyên qua cả bốn: **chủ sở hữu được đọc từ chính resource**, và
 * `:taskId` là một *locator* chứ không phải bằng chứng quyền. Một người đoán
 * trúng `taskId` của project khác vẫn chỉ nhận `404`, vì resolver trả về project
 * **thật sự** sở hữu task đó và guard sẽ thấy actor không có membership ở đó.
 *
 * Resolver này thay thế `ColumnProjectResolver` của M3 chứ không đứng cạnh nó:
 * chuỗi guard có **một** resolver, và hai cái đăng ký cùng token nghĩa là một
 * cái bị bỏ qua im lặng. Nó bao trọn cả bốn route vì đó là chỗ duy nhất biết đủ
 * bốn đường.
 */
export class TaskProjectResolver implements ResourceProjectResolver {
  readonly #columns: ColumnRepository;
  readonly #tasks: TaskRepository;

  constructor(columns: ColumnRepository, tasks: TaskRepository) {
    this.#columns = columns;
    this.#tasks = tasks;
  }

  async resolveProjectId(context: ResolveContext): Promise<string | undefined> {
    const direct = requireResourceUuid(context.params["projectId"], "projectId");
    if (direct !== undefined) return direct;

    const columnId = requireResourceUuid(context.params["columnId"], "columnId");
    if (columnId !== undefined) {
      // Cột không tồn tại ⇒ `undefined` ⇒ guard trả `404`, đúng cùng một
      // response với "tồn tại nhưng bạn không phải member".
      return await this.#columns.findOwningProjectId(columnId);
    }

    const taskId = requireResourceUuid(context.params["taskId"], "taskId");
    if (taskId !== undefined) {
      return await this.#tasks.findOwningProjectId(taskId);
    }

    /**
     * `POST /columns/reorder`: không có resource nào trên path.
     *
     * Lấy `projectId` từ body và validate định dạng. Nó **chưa** cho quyền gì —
     * guard vẫn authorize project đó như mọi route khác, và use case còn kiểm
     * rằng mọi `columnId` gửi lên thuộc đúng project ấy. Hai lớp đó là chỗ an
     * toàn đến từ, không phải chỗ này.
     */
    const body = context.body;
    if (body !== null && typeof body === "object" && "projectId" in body) {
      const fromBody = (body as { projectId: unknown }).projectId;
      if (typeof fromBody === "string") return requireResourceUuid(fromBody, "projectId");
    }

    return undefined;
  }
}
