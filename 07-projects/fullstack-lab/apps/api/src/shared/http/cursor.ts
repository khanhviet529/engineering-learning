import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, validationError } from "../errors/app-error.ts";

/**
 * Cursor phân trang — `docs/api/pagination-concurrency-idempotency.md` và
 * `docs/data/query-and-index-policy.md`.
 *
 * Cursor là giá trị **opaque, URL-safe, do server ký**. Client không parse,
 * không tạo, không sửa, và không dùng lại cho một truy vấn khác.
 *
 * Ba thứ nó phải mang, và lý do từng thứ:
 *
 * 1. **Schema version** — khi hình dạng cursor đổi ở một release sau, cursor cũ
 *    trong tab đang mở của người dùng phải bị từ chối gọn ghẽ chứ không được
 *    giải mã sai thành một vị trí ngẫu nhiên.
 * 2. **Fingerprint của truy vấn đã chuẩn hoá** — đổi filter, sort hay scope thì
 *    cursor cũ vô nghĩa. Không có fingerprint, cursor của column A dùng được ở
 *    column B và người dùng nhận một trang lẫn lộn mà không ai báo lỗi.
 * 3. **Khoá sort cuối cùng + `id` tie-breaker** — đủ để seek tiếp, không hơn.
 *
 * Chữ ký HMAC không phải để giữ bí mật (nội dung không bí mật) mà để **chống
 * sửa đổi**: nếu client sửa được `lastId` thì cursor trở thành một tham số truy
 * vấn tuỳ ý, và một tham số truy vấn tuỳ ý là chỗ phạm vi dữ liệu bị rò.
 */

/** Tăng khi hình dạng payload đổi. Cursor version cũ bị từ chối. */
const CURSOR_SCHEMA_VERSION = 1;

/**
 * Nhãn tách miền cho HMAC.
 *
 * Cùng một secret được dùng cho nhiều mục đích, nên mỗi mục đích phải ký dưới
 * một nhãn riêng. Không có nhãn, một giá trị ký cho mục đích này có thể được
 * dùng lại cho mục đích khác.
 */
const CURSOR_HMAC_LABEL = "flowboard:cursor:v1";

export interface CursorPayload {
  /** Giá trị của khoá sort chính ở hàng cuối trang trước, đã serialize. */
  sortKey: string;
  /** Tie-breaker cuối cùng. Mọi order kết thúc bằng `id`. */
  id: string;
}

interface EncodedCursor extends CursorPayload {
  v: number;
  f: string;
}

/**
 * Fingerprint của truy vấn đã chuẩn hoá.
 *
 * Người gọi dựng nó từ **mọi** thứ ảnh hưởng tới tập kết quả và thứ tự: scope
 * (actor, workspace, project), filter, sort và direction. Bỏ sót một chiều là
 * cho phép tái dùng cursor xuyên chiều đó.
 */
export function queryFingerprint(parts: Record<string, string | number | boolean | null>): string {
  const canonical = Object.entries(parts)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return createHmac("sha256", CURSOR_HMAC_LABEL)
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${CURSOR_HMAC_LABEL}:${payload}`, "utf8")
    .digest("base64url");
}

export function encodeCursor(payload: CursorPayload, fingerprint: string, secret: string): string {
  const body: EncodedCursor = { v: CURSOR_SCHEMA_VERSION, f: fingerprint, ...payload };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Giải mã và xác minh cursor.
 *
 * Mọi nhánh hỏng — sai chữ ký, sai version, sai fingerprint, hỏng cấu trúc —
 * cho **cùng một** `400 VALIDATION_FAILED`. Phân biệt chúng trong response là
 * kể cho client biết cách sửa một cursor giả cho hợp lệ.
 */
export function decodeCursor(cursor: string, fingerprint: string, secret: string): CursorPayload {
  const invalid = () =>
    validationError([
      {
        field: "cursor",
        code: "invalid_cursor",
        message: "Cursor không hợp lệ cho truy vấn này. Hãy tải lại từ trang đầu.",
      },
    ]);

  const separator = cursor.lastIndexOf(".");
  if (separator <= 0) throw invalid();

  const encoded = cursor.slice(0, separator);
  const signature = cursor.slice(separator + 1);

  const expected = sign(encoded, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // So sánh theo thời gian hằng định, cùng lý do với CSRF token.
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid();

  let body: EncodedCursor;
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EncodedCursor;
  } catch {
    throw invalid();
  }

  if (body.v !== CURSOR_SCHEMA_VERSION) throw invalid();
  // Fingerprint khác nghĩa là cursor thuộc về một truy vấn khác.
  if (body.f !== fingerprint) throw invalid();
  if (typeof body.sortKey !== "string" || typeof body.id !== "string") throw invalid();

  return { sortKey: body.sortKey, id: body.id };
}

/** `limit` mặc định 25, tối đa 100 — hợp đồng cấm clamp im lặng. */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Dựng một trang từ kết quả đã đọc dư **một** hàng.
 *
 * Đọc `limit + 1` là cách biết `hasMore` mà không cần một câu `COUNT` thứ hai
 * trên cùng điều kiện — `COUNT` trên tập lớn đắt hơn nhiều so với một hàng dư.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  fingerprint: string,
  secret: string,
  toCursor: (row: T) => CursorPayload,
): PageResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(toCursor(last), fingerprint, secret) : null,
  };
}

/** Ném khi ai đó quên truyền secret ký cursor. */
export function requireCursorSecret(secret: string | undefined): string {
  if (secret === undefined || secret.length < 32) {
    throw new AppError("INTERNAL_ERROR", {
      cause: new Error("Thiếu secret ký cursor hoặc secret quá ngắn."),
    });
  }
  return secret;
}
