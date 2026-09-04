import {
  requireResourceUuid,
  type ResolveContext,
  type ResourceProjectResolver,
} from "../../../shared/authorization/index.ts";
import type { ColumnRepository } from "./column-repository.ts";

/**
 * Resolver của M3: ba hình dạng route, ba đường tìm project sở hữu.
 *
 * | Route | Resource nằm ở | Cách resolve |
 * |---|---|---|
 * | `POST /projects/:projectId/columns` | path `:projectId` | chính nó |
 * | `PATCH /columns/:columnId` | path `:columnId` | tra `board_columns` |
 * | `POST /columns/reorder` | body `projectId` | chính nó |
 *
 * Điều giữ nguyên qua cả ba: **chủ sở hữu được đọc từ chính resource**, và
 * `:columnId` là một *locator* chứ không phải bằng chứng quyền. Một người đoán
 * trúng `columnId` của project khác vẫn chỉ nhận `404`, vì resolver trả về
 * project **thật sự** sở hữu cột đó và guard sẽ thấy actor không có membership
 * ở đó.
 *
 * Adapter này sống trong `board-columns` — module sở hữu bảng — chứ không trong
 * `shared/authorization`. Kernel authorization chỉ được đọc membership/role;
 * đó là ngoại lệ hẹp mà ADR-0005 ghi nhận, và đọc thêm `board_columns` sẽ nới
 * ngoại lệ đó thành một thói quen.
 */
export class ColumnProjectResolver implements ResourceProjectResolver {
  readonly #columns: ColumnRepository;

  constructor(columns: ColumnRepository) {
    this.#columns = columns;
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
