import { describe, expect, it } from "vitest";
import {
  POSITION_SPACING,
  REBALANCE_THRESHOLD,
  appendPosition,
  midpoint,
  needsRebalance,
  planInsert,
  rebalancedPositions,
  reorderedPositions,
  type PositionedItem,
} from "./ordering.ts";

/**
 * Số học của fractional ordering, tách khỏi database.
 *
 * Phần đáng kiểm nhất ở đây là **đường đi tới ngưỡng**: chèn liên tiếp vào cùng
 * một khe cho tới khi khoảng cách xuống dưới 10⁻⁶. Vòng lặp bên dưới đi thật
 * quãng đường đó — một test mock ngưỡng sẽ xanh mà không chứng minh rằng thuật
 * toán tới được đó.
 */

describe("hằng số", () => {
  it("spacing 1024 và ngưỡng 10⁻⁶ đúng ADR-0006", () => {
    expect(POSITION_SPACING).toBe(1024);
    expect(REBALANCE_THRESHOLD).toBe(1e-6);
  });
});

describe("append", () => {
  it("item đầu tiên nhận 1024, không phải 0", () => {
    // `0` sẽ không còn chỗ chèn phía trước.
    expect(appendPosition(undefined)).toBe(1024);
  });

  it("item sau cộng thêm đúng một spacing", () => {
    expect(appendPosition(1024)).toBe(2048);
    expect(appendPosition(2048)).toBe(3072);
  });
});

describe("midpoint và ngưỡng", () => {
  it("trung điểm nằm đúng giữa", () => {
    expect(midpoint(1024, 2048)).toBe(1536);
    expect(midpoint(0, 1024)).toBe(512);
  });

  it("khoảng cách rộng thì chưa cần rebalance", () => {
    expect(needsRebalance(1024, 2048)).toBe(false);
    expect(needsRebalance(1024, 1024 + 1e-5)).toBe(false);
  });

  it("khoảng cách dưới ngưỡng thì cần", () => {
    expect(needsRebalance(1024, 1024 + 1e-7)).toBe(true);
    expect(needsRebalance(1024, 1024)).toBe(true);
  });

  it("đúng ngưỡng vẫn chưa cần — biên là `<`, không phải `<=`", () => {
    expect(needsRebalance(0, REBALANCE_THRESHOLD)).toBe(false);
  });
});

describe("rebalancedPositions", () => {
  it("giãn thành bội số của 1024, giữ nguyên số lượng", () => {
    expect(rebalancedPositions(3)).toEqual([1024, 2048, 3072]);
    expect(rebalancedPositions(0)).toEqual([]);
  });
});

describe("planInsert", () => {
  const list = (...positions: number[]): PositionedItem[] =>
    positions.map((position, index) => ({ id: `c${String(index)}`, position }));

  it("danh sách rỗng cho 1024", () => {
    expect(planInsert([], null)).toEqual({ position: 1024, rebalance: [] });
  });

  it("chèn vào đầu lấy trung điểm với 0", () => {
    expect(planInsert(list(1024), null).position).toBe(512);
  });

  it("chèn vào cuối cộng một spacing, không rebalance", () => {
    const plan = planInsert(list(1024, 2048), "c1");
    expect(plan).toEqual({ position: 3072, rebalance: [] });
  });

  it("chèn giữa lấy trung điểm", () => {
    expect(planInsert(list(1024, 2048), "c0").position).toBe(1536);
  });

  it("`afterId` không tồn tại là lỗi lập trình, không phải nhánh đoán ý", () => {
    expect(() => planInsert(list(1024), "khong-co")).toThrow();
  });

  /**
   * Đây là test trung tâm của cả file.
   *
   * Chèn liên tiếp vào **cùng một khe** — luôn ngay sau phần tử đầu — và đếm
   * xem bao nhiêu lần thì `planInsert` tự quyết định rebalance. Con số phải nằm
   * quanh 29 theo phân tích của ADR-0006: từ gap 1024, mỗi lần chia đôi, và
   * `1024 / 2^n < 10⁻⁶` lần đầu đúng ở `n = 30`.
   */
  it("chèn liên tiếp cùng một khe thì rebalance tự kích hoạt sau ~29–30 lần", () => {
    let items: PositionedItem[] = [
      { id: "left", position: 1024 },
      { id: "right", position: 2048 },
    ];

    let inserts = 0;
    let rebalanceAt: number | undefined;

    for (let i = 0; i < 60; i++) {
      const plan = planInsert(items, "left");
      inserts += 1;

      if (plan.rebalance.length > 0) {
        rebalanceAt = inserts;
        break;
      }

      // Chèn vào ngay sau `left`, giữ danh sách sắp theo position.
      items = [
        items[0] as PositionedItem,
        { id: `x${String(i)}`, position: plan.position },
        ...items.slice(1),
      ];
    }

    expect(rebalanceAt).toBeDefined();
    expect(rebalanceAt).toBeGreaterThanOrEqual(28);
    expect(rebalanceAt).toBeLessThanOrEqual(32);
  });

  it("khi rebalance chạy, thứ tự giữ nguyên và position thành bội số 1024", () => {
    // Hai neighbor sát nhau: lần chèn kế tiếp buộc phải rebalance.
    const tight: PositionedItem[] = [
      { id: "a", position: 1024 },
      { id: "b", position: 1024 + 1e-8 },
      { id: "c", position: 4096 },
    ];

    const plan = planInsert(tight, "a");

    expect(plan.rebalance.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(plan.rebalance.map((r) => r.position)).toEqual([1024, 2048, 3072]);

    // Và position mới nằm **giữa hai giá trị đã giãn**, không phải giữa hai
    // giá trị cũ — tính trên giá trị cũ sẽ cho một số nằm ngoài khe mới.
    expect(plan.position).toBe(1536);
    expect(plan.position).toBeGreaterThan(1024);
    expect(plan.position).toBeLessThan(2048);
  });

  it("rebalance khi chèn vào đầu cũng tính lại trên giá trị đã giãn", () => {
    const tight: PositionedItem[] = [
      { id: "a", position: 1e-9 },
      { id: "b", position: 4096 },
    ];
    const plan = planInsert(tight, null);

    expect(plan.rebalance.map((r) => r.position)).toEqual([1024, 2048]);
    expect(plan.position).toBe(512);
  });
});

describe("reorderedPositions", () => {
  it("gán lại bội số 1024 theo đúng thứ tự đã cho", () => {
    expect(reorderedPositions(["c", "a", "b"])).toEqual([
      { id: "c", position: 1024 },
      { id: "a", position: 2048 },
      { id: "b", position: 3072 },
    ]);
  });

  it("danh sách rỗng cho mảng rỗng", () => {
    expect(reorderedPositions([])).toEqual([]);
  });
});
