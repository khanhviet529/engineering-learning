import type { DueState, TaskCategory, TaskPriority, TaskSort } from "@flowboard/contracts";

/**
 * Điều kiện lọc của board, dạng **canonical**.
 *
 * Đây là nửa đầu của cơ chế chống stale response mà
 * [đặc tả tương tác §6](../../../../../docs/design/interaction-specifications.md)
 * quy định: cache key của mỗi list request là fingerprint đầy đủ của điều kiện.
 * Đổi một điều kiện ⇒ key mới ⇒ **response của điều kiện cũ không có chỗ để
 * ghi vào**. Không so timestamp, không so tay trong callback — chính việc
 * không tìm thấy key là bảo đảm.
 *
 * Vì vậy fingerprint phải **tất định**: cùng một tập điều kiện luôn cho cùng
 * một chuỗi, bất kể người dùng bấm các control theo thứ tự nào.
 */

export interface BoardFilters {
  search?: string | undefined;
  assigneeId?: string | undefined;
  createdById?: string | undefined;
  category?: TaskCategory | undefined;
  priority?: TaskPriority | undefined;
  dueState?: DueState | undefined;
  sort?: TaskSort | undefined;
}

/**
 * Thứ tự khoá **cố định**. Không dùng `Object.keys().sort()`: thứ tự phải là
 * một quyết định đọc được ở đây, không phải hệ quả của thứ tự chèn.
 */
const KEYS = [
  "search",
  "assigneeId",
  "createdById",
  "category",
  "priority",
  "dueState",
  "sort",
] as const;

export const EMPTY_FILTERS: BoardFilters = {};

/**
 * Chuẩn hoá: bỏ khoảng trắng thừa, và coi chuỗi rỗng **giống hệt** không chọn.
 *
 * Nếu không chuẩn hoá, xoá hết chữ trong ô tìm kiếm sẽ tạo một fingerprint
 * khác với lúc chưa gõ gì — hai key cho cùng một truy vấn, tức là một lần gọi
 * mạng thừa và một trang kết quả trùng nằm trong cache.
 */
export function canonicalFilters(raw: BoardFilters): BoardFilters {
  const out: BoardFilters = {};
  for (const key of KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    const trimmed = typeof value === "string" ? value.trim() : value;
    if (trimmed === "") continue;
    Object.assign(out, { [key]: trimmed });
  }
  return out;
}

/** Chuỗi tất định đại diện cho một tập điều kiện; dùng làm một mảnh của query key. */
export function filterFingerprint(filters: BoardFilters): string {
  const canonical = canonicalFilters(filters);
  return KEYS.filter((key) => canonical[key] !== undefined)
    .map((key) => `${key}=${String(canonical[key])}`)
    .join("&");
}

/** Có điều kiện nào đang áp dụng không — quyết định chữ của trạng thái rỗng. */
export function hasActiveFilters(filters: BoardFilters): boolean {
  return filterFingerprint(filters) !== "";
}

/**
 * Query string gửi lên server cho một cột.
 *
 * `columnId` luôn có mặt: board phân trang **theo từng cột**, và một cursor
 * chỉ có nghĩa với đúng cột đã tạo ra nó.
 */
export function taskQueryParams(
  filters: BoardFilters,
  columnId: string,
  limit: number,
  cursor?: string,
): URLSearchParams {
  const params = new URLSearchParams({ columnId, limit: String(limit) });
  const canonical = canonicalFilters(filters);
  for (const key of KEYS) {
    const value = canonical[key];
    if (value !== undefined) params.set(key, String(value));
  }
  if (cursor !== undefined) params.set("cursor", cursor);
  return params;
}
