import { describe, expect, it } from "vitest";
import type { ErrorCode } from "@flowboard/contracts";
import { messageFor, NO_RESPONSE, type MessageTable } from "./messages.ts";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * `messageFor` có **hai** đường vào, và cho tới M5.5 chỉ một đường được kiểm.
 *
 * Đường thứ hai là lúc không có câu trả lời nào: `Transport.request` bắt được
 * `fetch` ném và trả `status: 0` kèm `code: "INTERNAL_ERROR"` — vì danh mục mã
 * là đóng và không có mã nào cho "chưa biết". Tra theo `code` sẽ rơi vào
 * `fallback` của feature, và mọi `fallback` đều kết bằng "Hãy thử lại".
 *
 * Với một lệnh ghi, đó là lời khuyên sai và nó **tạo ra** một bản ghi thứ hai.
 * Bộ E2E ở M5.5 đo được đúng cảnh đó: chặn response của `POST /workspaces` sau
 * khi server đã ghi xong, rồi đọc chữ trên màn hình.
 */

function failure(code: ErrorCode, status: number): ApiFailure {
  return { ok: false, status, code, message: "diagnostic", requestId: "req-1", fieldErrors: [] };
}

const TABLE: MessageTable = {
  FORBIDDEN: "Bạn không có quyền.",
  fallback: "Không lưu được. Hãy thử lại.",
};

describe("messageFor", () => {
  it("tra theo code khi server có trả lời", () => {
    expect(messageFor(TABLE, failure("FORBIDDEN", 403))).toBe("Bạn không có quyền.");
  });

  it("code không có trong bảng thì dùng fallback", () => {
    expect(messageFor(TABLE, failure("COLUMN_NOT_EMPTY", 409))).toBe(TABLE.fallback);
  });

  it("KHÔNG có câu trả lời nào thì nói đúng điều đó, không nói `thử lại`", () => {
    // `status: 0` là dấu hiệu của tầng transport, không phải một status HTTP.
    const unanswered = failure("INTERNAL_ERROR", 0);
    expect(messageFor(TABLE, unanswered)).toBe(NO_RESPONSE);
    expect(messageFor(TABLE, unanswered)).not.toBe(TABLE.fallback);
  });

  it("`500` thật của server vẫn là fallback, không phải câu `chưa có phản hồi`", () => {
    // Hai chuyện khác nhau: server nói "tôi hỏng" và server không nói gì.
    expect(messageFor(TABLE, failure("INTERNAL_ERROR", 500))).toBe(TABLE.fallback);
  });

  it("câu `chưa có phản hồi` nói ra việc cần làm, và việc đó không phải gửi lại", () => {
    expect(NO_RESPONSE).toContain("tải lại");
    expect(NO_RESPONSE).not.toMatch(/^.*Hãy thử lại\.$/);
  });
});
