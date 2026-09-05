import type { DueState } from "@flowboard/contracts";

/**
 * Suy `dueState` — [ADR-0001](../../../../../../docs/decisions/ADR-0001-task-planning-fields-and-review-workflow.md)
 * và [ADR-0008](../../../../../../docs/decisions/ADR-0008-terminal-column-and-task-reopen.md).
 *
 * `due_state` **không có cột trong database**. Nó được suy từ ba thứ, và cả ba
 * đều phải có mặt ở chỗ suy: ngày hôm nay **theo timezone workspace**,
 * `due_date` của task, và `is_terminal` của cột đang chứa task.
 *
 * ## Vì sao nó là hàm thuần nhận `today` chứ không tự gọi `new Date()`
 *
 * Một hàm tự đọc đồng hồ hệ thống chỉ kiểm được bằng cách giả lập đồng hồ toàn
 * cục, và nó sẽ **âm thầm dùng timezone của máy chạy** — nghĩa là cùng một task
 * cho ra `overdue` trên CI ở UTC và `due_today` trên máy lập trình viên ở GMT+7.
 * Đó không phải một lỗi test; đó là lỗi sản phẩm mà test không thấy.
 */

/**
 * Cửa sổ "sắp đến hạn", tính bằng ngày.
 *
 * **Chưa tài liệu nào định nghĩa con số này.** Enum `dueState` được năm tài liệu
 * nhắc tên, nhưng không chỗ nào nói `due_soon` rộng bao nhiêu ngày. 3 ngày là
 * lựa chọn của tầng hiện thực, đặt tên ở đây để nó là **một** quyết định thấy
 * được thay vì một hằng số rải trong câu lệnh SQL — và để đổi nó là sửa một
 * dòng khi hợp đồng nói rõ con số thật.
 *
 * Từ M5, `GET /projects/:projectId/overview` đọc **chính** hằng số này: hợp đồng
 * nói `dueStates` phải dùng cùng cửa sổ với list task, và cùng cửa sổ chỉ có
 * nghĩa khi nó là cùng một giá trị.
 */
export const DUE_SOON_WINDOW_DAYS = 3;

/**
 * Ngày hôm nay theo timezone của workspace.
 *
 * ## Cổng này đã đổi hình dạng ở M5, và đó là điều đã hẹn trước
 *
 * M4 khai `today()` không tham số, vì bảng `workspaces` chưa có cột timezone và
 * tầng hiện thực chạy tạm bằng **một** timezone cho cả ứng dụng. Ghi chú của M4
 * nói rõ chữ ký sẽ nhận scope khi cột tồn tại; M5 thêm cột và đây là lần đổi đó.
 *
 * ## Vì sao **hai** method chứ không phải `today(workspaceId)`
 *
 * Vì hai nhóm chỗ gọi cầm hai định danh khác nhau, và cả hai đều đúng:
 *
 * - `GET /workspaces/:workspaceId/tasks` và mọi thứ cấp workspace cầm
 *   `workspaceId`.
 * - `GET /projects/:projectId/tasks`, `overview`, create/update/move task cầm
 *   `projectId` — và **chỉ** `projectId`: chúng được authorize ở cấp project, và
 *   bắt chúng tự tra workspace là bắt mỗi use case tự viết một đường đọc mà
 *   chính cổng này sinh ra để giữ ở một chỗ.
 *
 * Ép tất cả về `today(workspaceId)` sẽ đẩy phép tra `project → workspace` ra
 * ngoài, tới đúng những chỗ không nên biết nó — nên cổng nhận cả hai và tự biết
 * đường đi từ mỗi cái tới timezone.
 */
export interface WorkspaceClock {
  /** `YYYY-MM-DD` theo timezone của workspace. */
  todayForWorkspace(workspaceId: string): Promise<string>;
  /** `YYYY-MM-DD` theo timezone của workspace **chứa** project này. */
  todayForProject(projectId: string): Promise<string>;
  /**
   * Chính tên timezone, không phải ngày.
   *
   * `overview` cần nó để quy `tasks.created_at` — một `timestamptz` — về **ngày
   * lịch trong timezone workspace** trước khi so với cửa sổ. So bằng UTC sẽ đếm
   * nhầm mọi task tạo trong bảy giờ đầu ngày ở GMT+7.
   *
   * Nó ở cùng cổng với `today*` vì cùng một nguồn sự thật; tách ra thành cổng
   * thứ hai nghĩa là hai chỗ đọc `workspaces.timezone` và hai chỗ có thể trôi.
   */
  timeZoneForProject(projectId: string): Promise<string>;
}

/**
 * Một instant thành ngày lịch trong một timezone.
 *
 * `en-CA` cho ra đúng `YYYY-MM-DD`, nhưng dựa vào locale để định dạng là dựa
 * vào một chi tiết có thể đổi giữa các bản ICU. `formatToParts` nói thẳng ý
 * định và không phụ thuộc thứ tự mà locale chọn.
 */
export function toCalendarDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Một tên timezone có dùng được không?
 *
 * `Intl.DateTimeFormat` ném `RangeError` với tên lạ. Hỏi nó là hỏi **chính thứ
 * sẽ đọc giá trị** — an toàn hơn một danh sách chép tay, thứ sẽ lệch khỏi bản
 * tzdata của runtime ngay lần cập nhật đầu tiên.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Số ngày từ `from` tới `to`, cả hai là `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  // `Date.UTC` trên một ngày lịch: cả hai đầu cùng một quy ước nên hiệu số là
  // số ngày đúng, không bị DST của bất kỳ timezone nào chạm vào.
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Cộng `days` ngày lịch vào `date` (`YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return toCalendarDate(shifted, "UTC");
}

/**
 * `dueState` của một task.
 *
 * Thứ tự các nhánh là một phần của đặc tả:
 *
 * 1. **Terminal thắng tất cả.** Task trong cột `is_terminal = true` luôn là
 *    `none`, bất kể `due_date` đã quá hạn bao lâu — "terminal không bao giờ
 *    overdue" (ADR-0008 mục 3). Đặt nhánh này sau nhánh ngày sẽ cho một task đã
 *    xong vẫn hiện đỏ.
 * 2. Không có `due_date` cũng là `none`: `none` nghĩa "không có tín hiệu due
 *    state", bao trùm cả hai trường hợp.
 */
export function deriveDueState(input: {
  dueDate: string | null;
  isTerminal: boolean;
  today: string;
}): DueState {
  if (input.isTerminal) return "none";
  if (input.dueDate === null) return "none";

  const remaining = daysBetween(input.today, input.dueDate);
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "due_today";
  if (remaining <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "scheduled";
}
