import { eq } from "drizzle-orm";
import type { Database } from "../../../shared/database/client.ts";
import { projects, workspaces } from "../../../shared/database/schema.ts";
import { isValidTimeZone, toCalendarDate, type WorkspaceClock } from "../domain/due-state.ts";

/**
 * `WorkspaceClock` đọc `workspaces.timezone`.
 *
 * Adapter này thay `ConfiguredWorkspaceClock` của M4, thứ đọc **một** timezone
 * từ cấu hình vì cột chưa tồn tại. Không use case nào phải sửa khi đổi: cả hai
 * đều là cổng, và đó chính là điều mà việc dựng cổng sớm đã mua.
 *
 * ## Vì sao có cache trong phạm vi một request
 *
 * Một request có thể hỏi ngày nhiều lần — `overview` hỏi một lần, list task hỏi
 * một lần, nhưng một use case tương lai gọi nhiều lần là chuyện bình thường. Mỗi
 * lần hỏi là một truy vấn, và timezone của một workspace **không đổi giữa chừng
 * một request**. Cache theo instance, và composition root dựng **một** instance
 * cho cả tiến trình, nên trên thực tế đây là cache cả tiến trình.
 *
 * Đánh đổi đã biết và chấp nhận: đổi timezone của một workspace chỉ có hiệu lực
 * sau khi tiến trình khởi động lại. Ở MVP không có endpoint nào đổi nó, nên
 * đường ghi duy nhất là một câu SQL thủ công — và người chạy câu đó biết mình
 * đang làm gì. Khi Workspace Settings mở field này, cache phải bị vô hiệu ở
 * cùng transaction, và đó là chỗ ghi chú này sẽ được đọc lại.
 */
export class DatabaseWorkspaceClock implements WorkspaceClock {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #byWorkspace = new Map<string, string>();
  readonly #byProject = new Map<string, string>();

  constructor(db: Database, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
  }

  async todayForWorkspace(workspaceId: string): Promise<string> {
    const cached = this.#byWorkspace.get(workspaceId);
    if (cached !== undefined) return toCalendarDate(this.#now(), cached);

    const [row] = await this.#db
      .select({ timezone: workspaces.timezone })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    const timeZone = this.#usable(row?.timezone);
    this.#byWorkspace.set(workspaceId, timeZone);
    return toCalendarDate(this.#now(), timeZone);
  }

  async todayForProject(projectId: string): Promise<string> {
    return toCalendarDate(this.#now(), await this.timeZoneForProject(projectId));
  }

  async timeZoneForProject(projectId: string): Promise<string> {
    const cached = this.#byProject.get(projectId);
    if (cached !== undefined) return cached;

    const [row] = await this.#db
      .select({ timezone: workspaces.timezone })
      .from(projects)
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(eq(projects.id, projectId));

    const timeZone = this.#usable(row?.timezone);
    this.#byProject.set(projectId, timeZone);
    return timeZone;
  }

  /**
   * Timezone không đọc được thì **rơi về mặc định**, không ném.
   *
   * Hai nhánh tới đây, và cả hai đều không phải lỗi của người dùng đang gọi:
   * workspace không tồn tại (guard đã chặn trước, nên đây là dữ liệu không nhất
   * quán), hoặc cột chứa một tên timezone mà runtime này không biết — điều xảy
   * ra được khi tzdata của container tụt lại sau một lần đổi cấu hình.
   *
   * Ném ở đây biến một dashboard thành `500`. Rơi về mặc định cho một `dueState`
   * có thể lệch múi giờ, và đó là mức xuống cấp đúng: sai một ngày ở biên nửa
   * đêm, thay vì không đọc được gì cả.
   */
  #usable(timeZone: string | undefined): string {
    if (timeZone !== undefined && isValidTimeZone(timeZone)) return timeZone;
    return FALLBACK_TIME_ZONE;
  }
}

/** Cùng giá trị với `DEFAULT` của cột, để hai đường cho cùng một kết quả. */
export const FALLBACK_TIME_ZONE = "Asia/Ho_Chi_Minh";
