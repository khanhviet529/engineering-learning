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
 */
export const DUE_SOON_WINDOW_DAYS = 3;

/**
 * Ngày hôm nay theo timezone của workspace.
 *
 * ## Vì sao là một cổng, và vì sao nó chưa nhận `workspaceId`
 *
 * Năm tài liệu nói `due_date` và `dueState` theo **timezone workspace**, nhưng
 * bảng `workspaces` **không có cột timezone** — cùng loại thiếu khớp mà ADR-0008
 * đã phải mở ra để vá cho `is_terminal`. Thêm một cột ở đây là tự phát minh hợp
 * đồng, nên tầng hiện thực làm điều nhỏ nhất khiến hành vi đã được đặc tả chạy
 * được: **một timezone cho toàn ứng dụng**, lấy từ cấu hình.
 *
 * Cổng này là chỗ mà quyết định đó sẽ đổi. Khi `workspaces.timezone` tồn tại,
 * chữ ký thành `today(workspaceId)` và mọi chỗ gọi đã đi qua đây rồi.
 */
export interface WorkspaceClock {
  /** `YYYY-MM-DD` theo timezone workspace. */
  today(): string;
}

/** Đồng hồ thật: một timezone IANA từ cấu hình, đọc qua `Intl`. */
export class ConfiguredWorkspaceClock implements WorkspaceClock {
  readonly #timeZone: string;
  readonly #now: () => Date;

  constructor(timeZone: string, now: () => Date = () => new Date()) {
    this.#timeZone = timeZone;
    this.#now = now;
  }

  today(): string {
    return toCalendarDate(this.#now(), this.#timeZone);
  }
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

/** Số ngày từ `from` tới `to`, cả hai là `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 86_400_000;
  // `Date.UTC` trên một ngày lịch: cả hai đầu cùng một quy ước nên hiệu số là
  // số ngày đúng, không bị DST của bất kỳ timezone nào chạm vào.
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
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
