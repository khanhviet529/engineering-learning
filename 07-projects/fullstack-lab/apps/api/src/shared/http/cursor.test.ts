import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.ts";
import { buildPage, decodeCursor, encodeCursor, queryFingerprint } from "./cursor.ts";

/**
 * Cursor là bề mặt mà client chạm vào được, nên nó là bề mặt tấn công.
 *
 * Các test dưới đây kiểm đúng điều đó: một cursor bị sửa, ký bằng secret khác,
 * hay thuộc về một truy vấn khác đều bị từ chối — và tất cả bị từ chối theo
 * **cùng một** cách, để không ai dò được cách làm giả một cursor hợp lệ.
 */

const secret = "s".repeat(32);
const fingerprint = queryFingerprint({ scope: "user-1", sort: "createdAt:desc" });

function expectRejected(fn: () => unknown): void {
  try {
    fn();
    throw new Error("Đáng lẽ phải bị từ chối");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_FAILED");
    expect((error as AppError).status).toBe(400);
  }
}

describe("mã hoá và giải mã", () => {
  it("round-trip giữ nguyên khoá sort và id", () => {
    const cursor = encodeCursor(
      { sortKey: "2026-09-04T00:00:00.000Z", id: "abc" },
      fingerprint,
      secret,
    );
    expect(decodeCursor(cursor, fingerprint, secret)).toEqual({
      sortKey: "2026-09-04T00:00:00.000Z",
      id: "abc",
    });
  });

  it("là URL-safe — không có ký tự cần escape", () => {
    const cursor = encodeCursor({ sortKey: "a+b/c=", id: "x y" }, fingerprint, secret);
    expect(cursor).toBe(encodeURIComponent(cursor));
  });

  it("không lộ nội dung dưới dạng đọc được ngay", () => {
    const cursor = encodeCursor({ sortKey: "bi-mat", id: "id-1" }, fingerprint, secret);
    expect(cursor).not.toContain("bi-mat");
  });
});

describe("chống sửa đổi", () => {
  it("đổi một ký tự trong payload làm chữ ký sai", () => {
    const cursor = encodeCursor({ sortKey: "k", id: "id-1" }, fingerprint, secret);
    const [body, signature] = cursor.split(".");
    const tampered = `${(body as string).slice(0, -1)}A.${signature as string}`;
    expectRejected(() => decodeCursor(tampered, fingerprint, secret));
  });

  it("cursor ký bằng secret khác bị từ chối", () => {
    const cursor = encodeCursor({ sortKey: "k", id: "id-1" }, fingerprint, "t".repeat(32));
    expectRejected(() => decodeCursor(cursor, fingerprint, secret));
  });

  it("chuỗi tự bịa bị từ chối", () => {
    expectRejected(() => decodeCursor("khong-phai-cursor", fingerprint, secret));
    expectRejected(() => decodeCursor("", fingerprint, secret));
    expectRejected(() => decodeCursor(".", fingerprint, secret));
  });

  it("payload hợp lệ nhưng không phải JSON bị từ chối", () => {
    const encoded = Buffer.from("khong-phai-json", "utf8").toString("base64url");
    // Ký đúng nhưng nội dung hỏng: chữ ký không cứu được cấu trúc sai.
    const cursor = encodeCursor({ sortKey: "x", id: "y" }, fingerprint, secret);
    const signature = cursor.split(".")[1] as string;
    expectRejected(() => decodeCursor(`${encoded}.${signature}`, fingerprint, secret));
  });
});

describe("fingerprint gắn cursor với đúng một truy vấn", () => {
  it("cursor của truy vấn khác bị từ chối", () => {
    const other = queryFingerprint({ scope: "user-1", sort: "createdAt:asc" });
    const cursor = encodeCursor({ sortKey: "k", id: "id-1" }, fingerprint, secret);
    expectRejected(() => decodeCursor(cursor, other, secret));
  });

  it("cursor của actor khác bị từ chối — không đọc sang scope khác", () => {
    const otherActor = queryFingerprint({ scope: "user-2", sort: "createdAt:desc" });
    const cursor = encodeCursor({ sortKey: "k", id: "id-1" }, fingerprint, secret);
    expectRejected(() => decodeCursor(cursor, otherActor, secret));
  });

  it("fingerprint không phụ thuộc thứ tự khai báo field", () => {
    expect(queryFingerprint({ a: "1", b: "2" })).toBe(queryFingerprint({ b: "2", a: "1" }));
  });

  it("đổi bất kỳ chiều nào cũng đổi fingerprint", () => {
    const base = { scope: "p1", sort: "createdAt", direction: "desc", filter: null };
    expect(queryFingerprint({ ...base, direction: "asc" })).not.toBe(queryFingerprint(base));
    expect(queryFingerprint({ ...base, filter: "x" })).not.toBe(queryFingerprint(base));
    expect(queryFingerprint({ ...base, scope: "p2" })).not.toBe(queryFingerprint(base));
  });
});

describe("dựng trang", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `id-${String(i)}`,
    key: `k-${String(i)}`,
  }));
  const toCursor = (row: { id: string; key: string }) => ({ sortKey: row.key, id: row.id });

  it("đọc dư một hàng thì hasMore đúng và hàng dư bị cắt", () => {
    const page = buildPage(rows, 4, fingerprint, secret, toCursor);
    expect(page.items).toHaveLength(4);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it("trang cuối không có cursor — `null`, không phải chuỗi rỗng", () => {
    const page = buildPage(rows.slice(0, 3), 4, fingerprint, secret, toCursor);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("cursor trỏ đúng hàng cuối của trang đã cắt, không phải hàng dư", () => {
    const page = buildPage(rows, 4, fingerprint, secret, toCursor);
    expect(decodeCursor(page.nextCursor as string, fingerprint, secret)).toEqual({
      sortKey: "k-3",
      id: "id-3",
    });
  });

  it("tập rỗng cho trang rỗng, không ném lỗi", () => {
    const page = buildPage([], 25, fingerprint, secret, toCursor);
    expect(page).toEqual({ items: [], hasMore: false, nextCursor: null });
  });
});
