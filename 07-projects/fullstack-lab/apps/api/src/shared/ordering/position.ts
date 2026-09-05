/**
 * Fractional ordering — [ADR-0006](../../../../../docs/decisions/ADR-0006-fractional-ordering-and-concurrency.md).
 *
 * Hàm thuần, không I/O, không biết database. Dùng chung cho **cả hai** thứ tự
 * mà sản phẩm có: column trong project (M3) và task trong column (M4).
 *
 * ## Vì sao `bigint` chứ không `number` — nợ của M3, trả ở đây
 *
 * M3 đọc `position` bằng `numeric(..., { mode: "number" })` rồi format lại bằng
 * `toFixed(10)`. Ở dải giá trị của column (vài chục row, position quanh 10³)
 * điều đó vô hại, và M3 đã ghi nhận nó là nợ. Task thì khác: một column có thể
 * chứa hàng nghìn task, nên position bò tới 10⁷, và ở đó `double` **không còn**
 * biểu diễn nổi 10 chữ số thập phân. Đo thật:
 *
 * ```text
 * "1024.0000000000"       → 1024.0000000000        (đúng)
 * "1048576.0000000001"    → 1048576.0000000000     (mất chữ số cuối)
 * "10240000.0000000001"   → 10240000.0000000000    (mất chữ số cuối)
 * "99999999.9999999999"   → 100000000.0000000000   (đổi cả phần nguyên)
 * ```
 *
 * Hai hệ quả, và hệ quả thứ hai mới là cái chết người:
 *
 * 1. Thứ tự có thể sai ở mật độ cao — hiếm, vì ngưỡng rebalance giữ khe ở
 *    10⁻⁶ còn ulp của double tại 10⁷ chỉ là 1.9·10⁻⁹.
 * 2. **Round-trip không còn là phép đồng nhất.** `targetPosition` mà client gửi
 *    trong `POST /tasks/:taskId/move` chính là chuỗi server đã cấp trước đó; nếu
 *    server làm biến dạng chuỗi ấy ở đường đọc thì client đang gửi lại một giá
 *    trị *khác* với thứ nó nhận được, và không có lỗi nào nổ ra để báo.
 *
 * Nên position được biểu diễn **đúng như database**: một số nguyên tỉ lệ theo
 * 10¹⁰. `bigint` không có làm tròn, không có ulp, và phép so sánh là so sánh
 * chính xác. Chuyển đổi chỉ xảy ra ở hai đầu — `parsePosition` khi đọc,
 * `formatPosition` khi trả — và không có `number` nào ở giữa.
 */

/** `numeric(20,10)`: 10 chữ số thập phân. */
export const POSITION_SCALE = 10;

const SCALE_FACTOR = 10n ** BigInt(POSITION_SCALE);

/**
 * Khoảng cách khởi tạo giữa hai vị trí liền nhau: **1024**.
 *
 * 1024 chứ không phải 1: mỗi lần chèn giữa chia đôi khoảng cách, nên khoảng
 * cách ban đầu quyết định chèn được bao nhiêu lần trước khi chạm ngưỡng. Từ
 * 1024 cần ~30 lần chèn liên tiếp **cùng một khe**; từ 1 chỉ cần ~20.
 */
export const POSITION_SPACING = 1024n * SCALE_FACTOR;

/**
 * Ngưỡng chạy rebalance: **10⁻⁶**, tức 10⁴ đơn vị đã tỉ lệ.
 *
 * `numeric(20,10)` biểu diễn được tới 10⁻¹⁰. Dừng ở 10⁻⁶ để lại ~13 lần chia
 * đôi dự phòng giữa "quyết định rebalance" và "cạn precision" — đủ chỗ cho race
 * và edge case, nên unique violation do hết chỗ chèn không còn là chế độ hỏng
 * đạt tới được.
 */
export const REBALANCE_THRESHOLD = 10n ** BigInt(POSITION_SCALE - 6);

/**
 * Giá trị lớn nhất mà `numeric(20,10)` chứa được: 20 chữ số, 10 sau dấu phẩy.
 *
 * Kiểm ở tầng ứng dụng thay vì để database ném `numeric field overflow`: lỗi của
 * driver là `500`, còn đây là một bất biến mà server tự biết trước.
 */
export const POSITION_MAX = 10n ** 20n - 1n;

/** Một phần tử đã có vị trí, dùng cho mọi phép tính dưới đây. */
export interface PositionedItem {
  id: string;
  position: bigint;
}

export interface InsertPlan {
  /** Position gán cho item mới. */
  position: bigint;
  /**
   * Position phải ghi lại cho các item hiện có, rỗng khi không cần rebalance.
   *
   * Người gọi ghi **đúng** danh sách này và không ghi gì khác: rebalance chỉ
   * chạm `position`, không chạm `updated_at` và không tăng `version`.
   */
  rebalance: PositionedItem[];
}

const POSITION_PATTERN = /^\d{1,10}(?:\.\d{1,10})?$/;

/**
 * Đọc một chuỗi thập phân thành số nguyên đã tỉ lệ.
 *
 * Nhận đúng hình dạng mà `positionSchema` của hợp đồng công bố (`^\d+(\.\d+)?$`)
 * và không nhận gì hơn — không dấu, không mũ, không khoảng trắng. Một giá trị
 * lạ ở đây nghĩa là dữ liệu đã sai từ trước, nên nó ném chứ không đoán.
 */
export function parsePosition(value: string): bigint {
  if (!POSITION_PATTERN.test(value)) {
    throw new Error(`position không đúng định dạng numeric(20,10): ${value}`);
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(POSITION_SCALE, "0");
  return BigInt(whole) * SCALE_FACTOR + BigInt(padded);
}

/**
 * Ghi một số nguyên đã tỉ lệ thành chuỗi thập phân **đủ 10 chữ số**.
 *
 * Đủ scale chứ không rút gọn: hợp đồng nói `position` là chuỗi thập phân của
 * `numeric(20,10)`, và client chuyển tiếp lại đúng chuỗi đó. Hai cách viết cùng
 * một giá trị (`"1024"` và `"1024.0000000000"`) sẽ làm phép so sánh chuỗi ở phía
 * client thành một cái bẫy.
 */
export function formatPosition(value: bigint): string {
  if (value < 0n) throw new Error("position không được âm");

  const whole = value / SCALE_FACTOR;
  const fraction = value % SCALE_FACTOR;
  return `${whole.toString()}.${fraction.toString().padStart(POSITION_SCALE, "0")}`;
}

/**
 * Vị trí cho một item **thêm vào cuối**.
 *
 * `undefined` nghĩa là danh sách rỗng — item đầu tiên nhận đúng
 * `POSITION_SPACING` chứ không phải `0`, để còn chỗ chèn **phía trước** nó sau
 * này.
 */
export function appendPosition(lastPosition: bigint | undefined): bigint {
  if (lastPosition === undefined) return POSITION_SPACING;
  return lastPosition + POSITION_SPACING;
}

/**
 * Trung điểm hai neighbor.
 *
 * Phép chia số nguyên làm tròn xuống. Kết quả luôn `>= before`, và `< after`
 * khi `after - before >= 2`. Khe hẹp hơn thế là chuyện của `needsRebalance`;
 * gọi `midpoint` trên một khe như vậy là lỗi lập trình, không phải một nhánh
 * cần đoán ý.
 */
export function midpoint(before: bigint, after: bigint): bigint {
  return (before + after) / 2n;
}

/**
 * Khoảng cách tại điểm chèn có còn đủ chỗ không?
 *
 * Người gọi hỏi câu này **trước** khi tính position; trả `true` nghĩa là phải
 * rebalance trước rồi mới gán.
 */
export function needsRebalance(before: bigint, after: bigint): boolean {
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
export function rebalancedPositions(count: number): bigint[] {
  return Array.from({ length: count }, (_, index) => BigInt(index + 1) * POSITION_SPACING);
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
  // nhánh để đoán ý: use case phải validate nó active và cùng scope trước.
  if (afterId != null && afterIndex === -1) {
    throw new Error("afterId không nằm trong danh sách đã cho");
  }

  // Chèn vào cuối: không có neighbor phải, không thể hết chỗ.
  if (afterIndex === ordered.length - 1) {
    return { position: appendPosition(ordered[afterIndex]?.position), rebalance: [] };
  }

  const before = afterIndex === -1 ? 0n : (ordered[afterIndex] as PositionedItem).position;
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
    position: fresh[index] as bigint,
  }));

  const newBefore = afterIndex === -1 ? 0n : (rebalance[afterIndex] as PositionedItem).position;
  const newAfter = (rebalance[afterIndex + 1] as PositionedItem).position;

  return { position: midpoint(newBefore, newAfter), rebalance };
}

/**
 * Kế hoạch chèn theo **một vị trí đích do client gợi ý**, không theo neighbor.
 *
 * Đây là hình dạng mà `POST /tasks/:taskId/move` cần: client gửi
 * `targetPosition` — một giá trị server đã cấp — và server tự tìm ra nó rơi vào
 * khe nào rồi tính lại position thật. Client **không** quyết định position;
 * `targetPosition` chỉ nói "đặt tôi vào chỗ này trong dãy".
 *
 * `exclude` là item đang được di chuyển: nó phải bị loại khỏi dãy trước khi tìm
 * khe, nếu không một task move trong cùng column sẽ tính trung điểm với chính
 * nó và đứng yên tại chỗ cũ.
 */
export function planMove(
  ordered: readonly PositionedItem[],
  targetPosition: bigint,
  exclude?: string,
): InsertPlan {
  const others = exclude === undefined ? [...ordered] : ordered.filter((i) => i.id !== exclude);
  if (others.length === 0) return { position: POSITION_SPACING, rebalance: [] };

  /**
   * Neighbor trái là item cuối cùng có position **nhỏ hơn** đích.
   *
   * Dùng `<` chứ không `<=`: khi client gửi lại đúng position của một item đang
   * có, ý định là "đặt tôi **trước** item đó" — đó là điều một lần thả chuột lên
   * chính hàng ấy trông như thế. Với `<=` thì thả lên hàng đầu tiên sẽ chèn
   * xuống *sau* nó, tức lệch một ô so với thứ người dùng nhìn thấy.
   */
  let afterIndex = -1;
  for (let i = 0; i < others.length; i++) {
    if ((others[i] as PositionedItem).position < targetPosition) afterIndex = i;
    else break;
  }

  const anchor = afterIndex === -1 ? null : (others[afterIndex] as PositionedItem).id;
  return planInsert(others, anchor);
}

/**
 * Vị trí cho một lần reorder toàn phần.
 *
 * Reorder nhận **toàn bộ** item, nên nó không chèn — nó gán lại từ đầu. Luôn
 * dùng bội số của `POSITION_SPACING`: thao tác này đã ghi mọi row rồi, nên giữ
 * lại giá trị fractional cũ chỉ để dành sẵn một lần rebalance trong tương lai
 * mà không được gì.
 */
export function reorderedPositions(orderedIds: readonly string[]): PositionedItem[] {
  const fresh = rebalancedPositions(orderedIds.length);
  return orderedIds.map((id, index) => ({ id, position: fresh[index] as bigint }));
}
