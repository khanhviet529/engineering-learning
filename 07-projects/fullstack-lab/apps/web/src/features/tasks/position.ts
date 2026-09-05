import type { Task } from "@flowboard/contracts";

/**
 * Gợi ý vị trí gửi kèm lệnh move.
 *
 * `targetPosition` **là một gợi ý**, không phải kết quả:
 * [ADR-0006](../../../../../docs/decisions/ADR-0006-fractional-ordering-and-concurrency.md)
 * nói rõ "server tính mọi giá trị; `targetPosition` của client chỉ là gợi ý vị
 * trí đã được server validate lại". Server có thể rebalance cả cột trong cùng
 * transaction và trả về một con số khác hẳn.
 *
 * Nên quy tắc ở đây là: **tính để gửi, không bao giờ để hiển thị.** Giao diện
 * lạc quan chỉ đổi *thứ tự phần tử trong mảng*; `position` và `version` mà
 * người dùng thấy luôn là của server.
 */

/** `positionSchema` chỉ nhận thập phân thường: không dấu âm, không ký hiệu mũ. */
const POSITION = /^\d+(\.\d+)?$/;

/** Khoảng cách mặc định giữa hai item, theo ADR-0006. */
const SPACING = 1024;

function toNumber(position: string | undefined): number | undefined {
  if (position === undefined) return undefined;
  const value = Number(position);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Vị trí gợi ý khi thả **giữa** `before` và `after`.
 *
 * - Có cả hai: điểm giữa.
 * - Chỉ `before` (thả xuống cuối cột): `before + 1024`.
 * - Chỉ `after` (thả lên đầu cột): một nửa `after`.
 * - Không có gì (cột rỗng): `1024`, đúng spacing khởi đầu của ADR-0006.
 *
 * Giá trị luôn được kẹp về đúng dạng mà `positionSchema` chấp nhận; nếu phép
 * tính cho ra thứ gì đó không biểu diễn được thì rơi về `1024` — một gợi ý sai
 * chỉ khiến server tự chọn chỗ, còn một chuỗi sai dạng là `400`.
 */
export function positionHint(before?: string, after?: string): string {
  const low = toNumber(before);
  const high = toNumber(after);

  let value: number;
  if (low !== undefined && high !== undefined) value = (low + high) / 2;
  else if (low !== undefined) value = low + SPACING;
  else if (high !== undefined) value = high / 2;
  else value = SPACING;

  if (!Number.isFinite(value) || value <= 0) return String(SPACING);
  const text = value.toFixed(10);
  return POSITION.test(text) ? text : String(SPACING);
}

/**
 * Gợi ý vị trí để chèn `index` vào một cột, bỏ qua chính task đang được kéo.
 *
 * `index` là vị trí **sau khi** task đã rời khỏi danh sách, tức là chỉ số
 * người dùng nhìn thấy khi thả.
 */
export function positionForIndex(
  columnTasks: readonly Task[],
  index: number,
  movingTaskId: string,
): string {
  const others = columnTasks.filter((task) => task.id !== movingTaskId);
  const before = others[index - 1]?.position;
  const after = others[index]?.position;
  return positionHint(before, after);
}
