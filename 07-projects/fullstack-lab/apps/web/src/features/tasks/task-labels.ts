import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  type TaskCategory,
  type TaskPriority,
} from "@flowboard/contracts";
import type { FbIconName } from "@flowboard/ui";

/**
 * Chữ tiếng Việt cho các enum của hợp đồng, và ánh xạ action → icon.
 *
 * Nó nằm ở feature chứ không ở `packages/ui` vì đây là **từ vựng sản phẩm**,
 * không phải primitive: một wrapper biết "feature" nghĩa là "Tính năng" là một
 * wrapper biết về Task.
 *
 * Bảng khai theo `Record<Enum, string>` nên thêm một giá trị vào enum của hợp
 * đồng mà quên dịch sẽ là lỗi biên dịch, không phải một ô trống trên màn hình.
 */

export const CATEGORY_LABEL: Readonly<Record<TaskCategory, string>> = {
  feature: "Tính năng",
  bug: "Lỗi",
  design: "Thiết kế",
  research: "Nghiên cứu",
  operations: "Vận hành",
  other: "Khác",
};

/**
 * Nhãn của `category`, kể cả khi nó **chưa được đặt**.
 *
 * `category` là nullable trong hợp đồng: `other` là một nhóm công việc **thật**
 * ("Khác"), không phải giá trị "chưa chọn", nên không thành viên nào của enum
 * diễn đạt được ô trống. `priority` thì khác — `none` là thành viên thật và
 * database không cho `null`, nên `PRIORITY_LABEL` không cần biến thể này.
 *
 * Một hàm thay vì để mỗi chỗ gọi tự chọn chữ: hai màn hiển thị cùng một ô
 * trống bằng hai chữ khác nhau là chỗ người đọc tưởng đó là hai trạng thái.
 */
export function categoryLabel(category: TaskCategory | null): string {
  return category === null ? "Chưa phân nhóm" : CATEGORY_LABEL[category];
}

export const PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = {
  none: "Không đặt",
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
  urgent: "Khẩn cấp",
};

/** Tone của huy hiệu ưu tiên. `none` và `low` không đáng một mảng màu riêng. */
export const PRIORITY_TONE: Readonly<Record<TaskPriority, "neutral" | "warning" | "danger">> = {
  none: "neutral",
  low: "neutral",
  medium: "neutral",
  high: "warning",
  urgent: "danger",
};

export const CATEGORY_OPTIONS = TASK_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABEL[value],
}));

export const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({
  value,
  label: PRIORITY_LABEL[value],
}));

/**
 * Thu hẹp một `string` của DOM về đúng enum của hợp đồng.
 *
 * Một `<select>` luôn trả `string`, còn `CreateTaskRequest.category` là
 * `TaskCategory | null`. Khoảng cách đó từng được lấp bằng `as never` — và
 * `as never` **gán được vào mọi kiểu**, nên nó không thu hẹp gì cả: nó tắt phép
 * kiểm ở đúng chỗ duy nhất phép kiểm có việc để làm. Chính chỗ đó đã giữ im
 * một lỗi thật khi hợp đồng còn nhận `null` cho `priority`.
 *
 * Hai hàm dưới đây là **type predicate**, nên chúng thu hẹp thật: đằng sau
 * `if`, TypeScript biết giá trị thuộc enum, và một giá trị lạ đi tiếp bằng
 * nhánh `else` mà tác giả phải viết ra. Danh sách so sánh lấy thẳng từ
 * `@flowboard/contracts`, cùng nguồn đã sinh ra hai bảng tuỳ chọn ở trên —
 * thêm một giá trị vào enum thì cả ba chỗ đi cùng nhau.
 */
export function isTaskCategory(value: string): value is TaskCategory {
  return TASK_CATEGORIES.some((candidate) => candidate === value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return TASK_PRIORITIES.some((candidate) => candidate === value);
}

/**
 * Icon của một dòng hoạt động.
 *
 * `action` là chuỗi tự do trong hợp đồng (`activitySchema.action` là
 * `z.string()`), nên bảng này **phải** có nhánh mặc định: một action mới do
 * server thêm không được làm hỏng danh sách.
 */
export function activityIcon(action: string): FbIconName {
  if (action.endsWith(".created")) return "plus";
  if (action.endsWith(".updated")) return "pencil";
  if (action.endsWith(".moved")) return "arrow-right";
  if (action.endsWith(".reopened")) return "rotate-cw";
  if (action.startsWith("comment.")) return "message-square";
  return "circle-dot";
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`, không đi qua `Date` để không lệch múi giờ. */
export function formatCalendarDate(date: string | null): string | undefined {
  if (date === null) return undefined;
  const [year, month, day] = date.split("-");
  if (year === undefined || month === undefined || day === undefined) return date;
  return `${day}/${month}/${year}`;
}

/** Thời điểm ISO → giờ và phút theo giờ máy, cho dòng hoạt động. */
export function formatInstant(instant: string): string {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime())
    ? instant
    : parsed.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}
