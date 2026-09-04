import type { BoardColumn } from "@flowboard/contracts";

/**
 * Phép tính thứ tự cột — thuần, không React, không request.
 *
 * Nó ở riêng một tệp vì thứ tự là chỗ dễ sai nhất trong `BRD-02`: hợp đồng
 * yêu cầu gửi **toàn bộ** active column, mỗi ID đúng một lần, và một lỗi lệch
 * một chỉ số sẽ tạo ra một `400` mà người dùng không hiểu nổi. Tách ra thì nó
 * kiểm được trực tiếp, không phải qua sáu bước tương tác.
 */

/** Chỉ cột active mới nằm trong payload reorder; cột đã lưu trữ thì không. */
export function activeColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.archivedAt === null);
}

/**
 * Chuyển cột ở `from` tới vị trí `to`, giữ nguyên mọi cột khác.
 *
 * Chỉ số ngoài phạm vi trả lại chính danh sách cũ thay vì ném: chỗ gọi là bàn
 * phím và chuột, nơi "đã ở đầu danh sách rồi" là chuyện bình thường chứ không
 * phải lỗi lập trình.
 */
export function moveColumn<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];

  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}

/** Hai thứ tự bằng nhau khi cùng độ dài và cùng phần tử ở từng vị trí. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Ghép bản nháp thứ tự với danh sách server vừa trả về.
 *
 * Vì sao cần hàm này thay vì "cứ nạp lại từ server": payload reorder phải là
 * **toàn bộ** active column, mỗi ID đúng một lần. Nếu Owner đang sắp dở rồi
 * thêm một cột, một bản nháp không có ID mới sẽ bị server từ chối bằng `400` —
 * và người dùng không có cách nào đoán ra vì sao.
 *
 * Nên: giữ thứ tự người dùng đã sắp cho những cột còn tồn tại, bỏ cột đã biến
 * mất, và **nối cột mới vào cuối** — đúng chỗ mà server vừa đặt nó, vì
 * `afterColumnId` khi thêm luôn là cột cuối.
 */
export function reconcileOrder(draft: readonly string[], serverIds: readonly string[]): string[] {
  const present = new Set(serverIds);
  const kept = draft.filter((id) => present.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...serverIds.filter((id) => !keptSet.has(id))];
}
