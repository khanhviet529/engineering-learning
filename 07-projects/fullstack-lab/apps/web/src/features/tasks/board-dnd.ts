import type { Task } from "@flowboard/contracts";

/**
 * Trạng thái kéo-thả của board, và phép chiếu lạc quan đi kèm.
 *
 * Phần thuần nằm ở đây, tách khỏi React, vì đây là chỗ dễ sai nhất của `BRD-01`
 * và nó phải kiểm được trực tiếp: một lỗi lệch một chỉ số hiện ra thành "task
 * nhảy sai chỗ rồi tự nhảy lại", một triệu chứng rất khó lần ngược từ giao diện.
 *
 * Điều phép chiếu này **không** làm: nó không đặt `position` và không đổi
 * `version`. Nó chỉ đổi **thứ tự phần tử trong mảng**. Hai giá trị kia do
 * server sở hữu, và hiển thị một con số mình tự tính là cách UI nói dối về
 * trạng thái đã lưu.
 *
 * `DragState` mang theo cả `task`, không chỉ `taskId`. Nhờ vậy mỗi cột tự chiếu
 * được phần của mình mà không cần biết cột khác đang giữ dữ liệu gì — mỗi cột
 * là một query độc lập, và giữ nguyên tính độc lập đó là cả điểm của việc phân
 * trang theo từng cột.
 */

export interface DragState {
  task: Task;
  fromColumnId: string;
  toColumnId: string;
  /** Chỉ số trong cột đích, tính **sau khi** task đã rời khỏi cột nguồn. */
  toIndex: number;
  /** Đang nhấc bằng bàn phím; kéo bằng chuột thì thả là xong nên không có pha này. */
  lifted: boolean;
}

/**
 * Danh sách một cột **đang hiển thị**: dữ liệu server, cộng thao tác kéo chưa
 * xác nhận.
 *
 * Không sửa đầu vào. Đó là điều làm rollback trở nên chính xác — hoàn nguyên
 * chỉ là bỏ `drag` đi, không phải hoàn tác từng bước.
 */
export function projectColumn(
  tasks: readonly Task[],
  columnId: string,
  drag: DragState | null,
): readonly Task[] {
  if (drag === null) return tasks;

  const without = tasks.filter((task) => task.id !== drag.task.id);
  if (drag.toColumnId !== columnId) return without;

  const next = [...without];
  next.splice(Math.max(0, Math.min(drag.toIndex, next.length)), 0, drag.task);
  return next;
}

/**
 * Cột kế tiếp theo hướng di chuyển, kẹp ở hai đầu.
 *
 * Kẹp thay vì cuộn vòng: cuộn vòng ở cột cuối sẽ ném task về cột đầu bằng một
 * lần bấm mũi tên, và người dùng bàn phím không có phản hồi thị giác liên tục
 * như người kéo chuột để nhận ra điều đó.
 */
export function neighbourColumn(
  columnIds: readonly string[],
  current: string,
  delta: -1 | 1,
): string {
  const index = columnIds.indexOf(current);
  if (index === -1) return current;
  return columnIds[Math.max(0, Math.min(index + delta, columnIds.length - 1))] ?? current;
}

/** Câu công bố cho live region khi vị trí thả đổi. */
export function dragAnnouncement(
  taskTitle: string,
  columnName: string,
  index: number,
  total: number,
): string {
  return `${taskTitle}: cột ${columnName}, vị trí ${String(index + 1)} trên ${String(Math.max(total, index + 1))}.`;
}
