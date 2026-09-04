/**
 * Fractional ordering — [ADR-0006](../../../../../docs/decisions/ADR-0006-fractional-ordering-and-concurrency.md).
 *
 * Hàm thuần, không I/O, không biết database. Tách ra như vậy vì đây là phần
 * **số học** của thuật toán, và số học kiểm được đầy đủ ở lớp unit: mọi tổ hợp
 * neighbor, mọi biên, và cả đường đi tới ngưỡng rebalance — không cần dựng
 * transaction nào.
 *
 * M4 áp lại đúng module này cho task position trong column. Đó là lý do mốc
 * này làm ordering ở column trước: column ít hơn task rất nhiều, nên sai thì
 * phát hiện sớm và sửa nhẹ.
 */

/**
 * Khoảng cách khởi tạo giữa hai vị trí liền nhau.
 *
 * 1024 chứ không phải 1: mỗi lần chèn giữa chia đôi khoảng cách, nên khoảng
 * cách ban đầu quyết định chèn được bao nhiêu lần trước khi chạm ngưỡng. Từ
 * 1024 cần ~29 lần chèn liên tiếp **cùng một khe**; từ 1 chỉ cần ~19.
 */
export const POSITION_SPACING = 1024;

/**
 * Ngưỡng chạy rebalance.
 *
 * `numeric(20,10)` biểu diễn được tới 10⁻¹⁰. Dừng ở 10⁻⁶ để lại ~13 lần chia
 * đôi dự phòng giữa "quyết định rebalance" và "cạn precision" — đủ chỗ cho
 * race và edge case, nên unique violation do hết chỗ chèn không còn là chế độ
 * hỏng đạt tới được trong vận hành bình thường.
 */
export const REBALANCE_THRESHOLD = 1e-6;

/**
 * Vị trí cho một item **thêm vào cuối**.
 *
 * `undefined` nghĩa là danh sách rỗng — item đầu tiên nhận đúng `POSITION_SPACING`
 * chứ không phải `0`, để còn chỗ chèn **phía trước** nó sau này.
 */
export function appendPosition(lastPosition: number | undefined): number {
  if (lastPosition === undefined) return POSITION_SPACING;
  return lastPosition + POSITION_SPACING;
}

/** Trung điểm hai neighbor. */
export function midpoint(before: number, after: number): number {
  return (before + after) / 2;
}

/**
 * Khoảng cách tại điểm chèn có còn đủ chỗ không?
 *
 * Người gọi hỏi câu này **trước** khi tính position; trả `true` nghĩa là phải
 * rebalance trước rồi mới gán.
 */
export function needsRebalance(before: number, after: number): boolean {
  return after - before < REBALANCE_THRESHOLD;
}

/**
 * Vị trí mới sau khi rebalance: bội số của `POSITION_SPACING` theo **thứ tự
 * hiện tại**.
 *
 * Rebalance không sắp xếp lại gì — nó chỉ giãn đều các giá trị đã có. Người gọi
 * truyền danh sách **đã sắp theo position tăng dần**, và hàm trả về đúng số
 * phần tử đó theo cùng thứ tự.
 */
export function rebalancedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_SPACING);
}

export interface PositionedItem {
  id: string;
  position: number;
}

export interface InsertPlan {
  /** Position gán cho item mới. */
  position: number;
  /**
   * Position phải ghi lại cho các item hiện có, rỗng khi không cần rebalance.
   *
   * Người gọi ghi **đúng** danh sách này và không ghi gì khác: rebalance chỉ
   * chạm `position`, không chạm `updated_at` và không tăng `version`.
   */
  rebalance: PositionedItem[];
}

/**
 * Tính vị trí chèn, kèm rebalance khi cần — trong **một** phép tính.
 *
 * Gộp hai quyết định vào một hàm là có chủ đích: nếu "có cần rebalance không"
 * và "position mới là bao nhiêu" nằm ở hai chỗ, người gọi có thể hỏi câu đầu
 * rồi tính câu sau trên dữ liệu **trước** rebalance — và gán một giá trị vừa bị
 * giãn ra khỏi chỗ.
 *
 * @param ordered  Item hiện có, **đã sắp theo position tăng dần**.
 * @param afterId  Chèn ngay sau item này; `null`/`undefined` nghĩa chèn vào đầu.
 */
export function planInsert(
  ordered: readonly PositionedItem[],
  afterId: string | null | undefined,
): InsertPlan {
  // Chèn vào đầu danh sách rỗng.
  if (ordered.length === 0) return { position: POSITION_SPACING, rebalance: [] };

  const afterIndex = afterId == null ? -1 : ordered.findIndex((item) => item.id === afterId);

  // `afterId` không có trong danh sách là lỗi của người gọi, không phải một
  // nhánh để đoán ý: use case phải validate nó active và cùng project trước.
  if (afterId != null && afterIndex === -1) {
    throw new Error("afterId không nằm trong danh sách đã cho");
  }

  // Chèn vào cuối: không có neighbor phải, không thể hết chỗ.
  if (afterIndex === ordered.length - 1) {
    return { position: appendPosition(ordered[afterIndex]?.position), rebalance: [] };
  }

  const before = afterIndex === -1 ? 0 : (ordered[afterIndex] as PositionedItem).position;
  const after = (ordered[afterIndex + 1] as PositionedItem).position;

  if (!needsRebalance(before, after)) {
    return { position: midpoint(before, after), rebalance: [] };
  }

  /**
   * Hết chỗ: giãn đều **rồi mới** tính lại điểm chèn trên giá trị mới.
   *
   * Tính điểm chèn trên giá trị cũ sẽ cho một số nằm ngoài khoảng vừa được
   * giãn ra, và thứ tự sẽ sai ngay ở chính lần chèn kích hoạt rebalance.
   */
  const fresh = rebalancedPositions(ordered.length);
  const rebalance = ordered.map((item, index) => ({
    id: item.id,
    position: fresh[index] as number,
  }));

  const newBefore = afterIndex === -1 ? 0 : (rebalance[afterIndex] as PositionedItem).position;
  const newAfter = (rebalance[afterIndex + 1] as PositionedItem).position;

  return { position: midpoint(newBefore, newAfter), rebalance };
}

/**
 * Vị trí cho một lần reorder toàn phần.
 *
 * Reorder nhận **toàn bộ** cột active, nên nó không chèn — nó gán lại từ đầu.
 * Luôn dùng bội số của `POSITION_SPACING`: thao tác này đã ghi mọi row rồi, nên
 * giữ lại giá trị fractional cũ chỉ để dành sẵn một lần rebalance trong tương
 * lai mà không được gì.
 */
export function reorderedPositions(orderedIds: readonly string[]): PositionedItem[] {
  const fresh = rebalancedPositions(orderedIds.length);
  return orderedIds.map((id, index) => ({ id, position: fresh[index] as number }));
}
