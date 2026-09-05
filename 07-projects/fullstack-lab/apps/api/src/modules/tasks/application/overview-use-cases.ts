import type { OverviewQuery } from "@flowboard/contracts";
import { addDays, daysBetween, type WorkspaceClock } from "../domain/due-state.ts";
import type {
  OverviewAssigneeRow,
  OverviewColumnRow,
  OverviewDueStates,
  OverviewRepository,
} from "../infrastructure/overview-repository.ts";

/**
 * `GET /projects/:projectId/overview` — aggregate cho `PRJ-04`.
 *
 * Không phân trang, không side effect, không activity: kết quả bị chặn bởi số
 * column và số member của **một** project, cả hai đều nhỏ và đều đã có giới hạn
 * ở tầng khác.
 */

export interface OverviewDeps {
  repository: OverviewRepository;
  clock: WorkspaceClock;
}

export interface OverviewView {
  window: { from: string; to: string };
  totals: { tasks: number; createdInWindow: number };
  byColumn: OverviewColumnRow[];
  byAssignee: OverviewAssigneeRow[];
  unassignedCount: number;
  dueStates: OverviewDueStates;
}

/**
 * Cửa sổ mặc định là **tuần hiện tại**, bắt đầu từ **thứ Hai**.
 *
 * Hợp đồng nói "tuần hiện tại" mà không nói tuần bắt đầu ngày nào. Thứ Hai là
 * quy ước ISO-8601 và là quy ước lịch ở Việt Nam; chọn Chủ Nhật sẽ làm "tuần
 * này" của dashboard lệch khỏi tuần mà người dùng đang nghĩ tới suốt một ngày
 * mỗi tuần. Đây là quyết định của tầng hiện thực và được ghi ra để nó là **một**
 * chỗ đổi khi hợp đồng nói rõ.
 */
export function currentWeek(today: string): { from: string; to: string } {
  // `getUTCDay`: 0 là Chủ Nhật. Quy về "số ngày kể từ thứ Hai".
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  const from = addDays(today, -sinceMonday);
  return { from, to: addDays(from, 6) };
}

/**
 * Cửa sổ canonical từ query.
 *
 * Ba nhánh, và nhánh thứ ba là chỗ dễ bỏ sót: client gửi **một** đầu. Suy đầu
 * còn lại bằng một tuần giữ cho `window` luôn là một khoảng đóng — response
 * echo lại nó, và một `to` rỗng sẽ buộc client tự đoán server đã tính tới đâu.
 */
export function resolveWindow(query: OverviewQuery, today: string): { from: string; to: string } {
  if (query.from !== undefined && query.to !== undefined) {
    return { from: query.from, to: query.to };
  }
  if (query.from !== undefined) return { from: query.from, to: addDays(query.from, 6) };
  if (query.to !== undefined) return { from: addDays(query.to, -6), to: query.to };
  return currentWeek(today);
}

export class OverviewUseCases {
  readonly #deps: OverviewDeps;

  constructor(deps: OverviewDeps) {
    this.#deps = deps;
  }

  /**
   * Đọc aggregate của một project.
   *
   * Năm truy vấn, **không** một transaction: đây là một lượt đọc không side
   * effect, và một transaction chỉ mua tính nhất quán giữa năm con số — thứ mà
   * một dashboard làm mới mỗi vài giây không cần tới. Đổi lại, nó không giữ
   * connection suốt năm câu lệnh.
   */
  async getOverview(projectId: string, query: OverviewQuery): Promise<OverviewView> {
    const today = await this.#deps.clock.todayForProject(projectId);
    const timeZone = await this.#deps.clock.timeZoneForProject(projectId);
    const window = resolveWindow(query, today);

    const [totals, byColumn, byAssignee, unassignedCount, dueStates] = await Promise.all([
      this.#deps.repository.totals({ projectId, ...window, timeZone }),
      this.#deps.repository.byColumn(projectId),
      this.#deps.repository.byAssignee(projectId),
      this.#deps.repository.unassignedCount(projectId),
      this.#deps.repository.dueStates({ projectId, today }),
    ]);

    return { window, totals, byColumn, byAssignee, unassignedCount, dueStates };
  }
}

/** Số ngày của cửa sổ — chỉ dùng để test biên, không ra tới response. */
export function windowLength(window: { from: string; to: string }): number {
  return daysBetween(window.from, window.to) + 1;
}
