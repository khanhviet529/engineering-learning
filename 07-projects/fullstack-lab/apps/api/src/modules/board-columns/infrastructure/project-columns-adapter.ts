import type {
  ProjectColumnView,
  ProjectColumnsQuery,
} from "../../projects/domain/project-columns-port.ts";
import type { ColumnRepository } from "./column-repository.ts";

/**
 * Adapter cho `ProjectColumnsQuery` mà module `projects` định nghĩa.
 *
 * Chiều import ở đây là `board-columns → projects`, đúng chiều mà ADR-0005 cho
 * phép. Nhờ vậy `GET /projects/:projectId` trả được column thật mà `projects`
 * vẫn không biết gì về bảng `board_columns`.
 *
 * Nó **không** lọc thêm gì: `findActiveColumns` đã scope theo `project_id` và
 * đã loại archived. Thêm một lớp lọc ở đây là nhân bản luật ra hai chỗ, và hai
 * chỗ sẽ trôi khỏi nhau.
 */
export class BoardColumnsProjectQuery implements ProjectColumnsQuery {
  readonly #columns: ColumnRepository;

  constructor(columns: ColumnRepository) {
    this.#columns = columns;
  }

  async activeColumnsOf(projectId: string): Promise<ProjectColumnView[]> {
    const rows = await this.#columns.findActiveColumns(projectId);
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      requiresReviewer: row.requiresReviewer,
      isTerminal: row.isTerminal,
      position: row.position,
      archivedAt: row.archivedAt,
    }));
  }
}
