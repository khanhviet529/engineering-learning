import { describe, expect, it } from "vitest";
import { columns } from "@flowboard/mock";
import { activeColumns, moveColumn, reconcileOrder, sameOrder } from "./column-order.ts";

/**
 * Phép tính thứ tự cột, kiểm trực tiếp.
 *
 * Bộ kiểm này tồn tại vì hợp đồng reorder rất hẹp: **toàn bộ** active column,
 * mỗi ID đúng một lần. Mọi cách làm sai đều dẫn tới một `400` mà người dùng
 * không đọc ra được nguyên nhân, nên bất biến đó được canh ở đây thay vì chỉ
 * canh qua sáu bước tương tác trong `board.test.tsx`.
 */

const ids = ["a", "b", "c", "d"];

describe("moveColumn", () => {
  it("chuyển xuống một bậc", () => {
    expect(moveColumn(ids, 0, 1)).toEqual(["b", "a", "c", "d"]);
  });

  it("chuyển lên một bậc", () => {
    expect(moveColumn(ids, 3, 2)).toEqual(["a", "b", "d", "c"]);
  });

  it("chuyển từ đầu xuống cuối", () => {
    expect(moveColumn(ids, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("chỉ số ngoài phạm vi trả lại danh sách cũ, không ném", () => {
    // Chỗ gọi là bàn phím: "đã ở đầu danh sách rồi" là chuyện bình thường.
    expect(moveColumn(ids, 0, -1)).toEqual(ids);
    expect(moveColumn(ids, 3, 4)).toEqual(ids);
    expect(moveColumn(ids, 9, 0)).toEqual(ids);
  });

  it("không bao giờ nhân bản hay đánh rơi ID", () => {
    for (let from = 0; from < ids.length; from += 1) {
      for (let to = 0; to < ids.length; to += 1) {
        const moved = moveColumn(ids, from, to);
        expect(moved).toHaveLength(ids.length);
        expect(new Set(moved).size).toBe(ids.length);
      }
    }
  });

  it("không sửa mảng gốc", () => {
    const original = [...ids];
    moveColumn(ids, 0, 3);
    expect(ids).toEqual(original);
  });
});

describe("sameOrder", () => {
  it("bằng nhau khi cùng phần tử cùng vị trí", () => {
    expect(sameOrder(ids, [...ids])).toBe(true);
  });

  it("khác nhau khi đổi vị trí hoặc đổi độ dài", () => {
    expect(sameOrder(ids, ["b", "a", "c", "d"])).toBe(false);
    expect(sameOrder(ids, ["a", "b", "c"])).toBe(false);
  });
});

describe("activeColumns", () => {
  it("bỏ cột đã lưu trữ, vì payload reorder chỉ nhận cột active", () => {
    const archived = { ...columns[0]!, id: "archived", archivedAt: "2026-09-01T00:00:00Z" };
    const result = activeColumns([...columns, archived]);
    expect(result.map((column) => column.id)).not.toContain("archived");
    expect(result).toHaveLength(columns.length);
  });
});

describe("reconcileOrder", () => {
  it("giữ thứ tự người dùng đã sắp", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  it("nối cột vừa thêm vào cuối — đúng chỗ server đặt nó", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });

  it("bỏ cột vừa được lưu trữ", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "c"])).toEqual(["c", "a"]);
  });

  it("kết quả LUÔN là đúng tập ID của server, mỗi ID một lần", () => {
    // Đây là bất biến mà hợp đồng đòi. Một bản nháp lệch tập ID sẽ bị từ chối
    // bằng `400`, và người dùng chỉ thấy "thứ tự không lưu được".
    const cases: [string[], string[]][] = [
      [
        ["c", "a", "b"],
        ["a", "b", "c", "d"],
      ],
      [[], ["a", "b"]],
      [["x", "y"], ["a"]],
      [["a", "b"], []],
    ];
    for (const [draft, server] of cases) {
      const result = reconcileOrder(draft, server);
      expect([...result].sort()).toEqual([...server].sort());
      expect(new Set(result).size).toBe(result.length);
    }
  });
});
