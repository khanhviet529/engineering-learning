import { describe, expect, it } from "vitest";
import {
  POSITION_SPACING,
  REBALANCE_THRESHOLD,
  appendPosition,
  formatPosition,
  midpoint,
  needsRebalance,
  parsePosition,
  planInsert,
  planMove,
  rebalancedPositions,
  reorderedPositions,
  type PositionedItem,
} from "./position.ts";

/**
 * Số học của fractional ordering, tách khỏi database.
 *
 * Phần đáng kiểm nhất ở đây là **đường đi tới ngưỡng**: chèn liên tiếp vào cùng
 * một khe cho tới khi khoảng cách xuống dưới 10⁻⁶. Vòng lặp bên dưới đi thật
 * quãng đường đó — một test mock ngưỡng sẽ xanh mà không chứng minh rằng thuật
 * toán tới được đó.
 *
 * Mọi giá trị ở đây là **số nguyên đã tỉ lệ theo 10¹⁰**, đúng như cách
 * PostgreSQL lưu `numeric(20,10)`. `p()` viết cho gọn.
 */

/** Đổi một số thập phân đọc được thành đơn vị đã tỉ lệ. */
const p = (value: string): bigint => parsePosition(value);

describe("hằng số", () => {
  it("spacing 1024 và ngưỡng 10⁻⁶ đúng ADR-0006", () => {
    expect(POSITION_SPACING).toBe(p("1024"));
    expect(REBALANCE_THRESHOLD).toBe(p("0.000001"));
  });
});

/**
 * Nợ của M3, và lý do cả file này dùng `bigint`.
 *
 * Bốn giá trị dưới đây round-trip **đúng** qua `bigint` và **sai** qua `double`.
 * Chúng không phải giá trị bịa: chúng là position mà một column vài nghìn task
 * sinh ra sau vài lần chèn giữa.
 */
describe("round-trip không được làm biến dạng giá trị", () => {
  const samples = [
    "1024.0000000000",
    "1048576.0000000001",
    "10240000.0000000001",
    "10240000.0000019073",
    "99999999.9999999999",
  ];

  it("parse rồi format trả lại **đúng** chuỗi ban đầu", () => {
    for (const sample of samples) {
      expect(formatPosition(parsePosition(sample)), sample).toBe(sample);
    }
  });

  it("cùng bộ giá trị đó, `double` làm hỏng ba trong năm", () => {
    // Đây là bằng chứng cho quyết định, không phải một khẳng định về sản phẩm:
    // nếu một ngày `double` đủ chính xác thì test này đỏ và quyết định được xét
    // lại có bằng chứng, thay vì bị đảo vì cảm giác.
    const broken = samples.filter((s) => Number(s).toFixed(10) !== s);
    expect(broken).toEqual(["1048576.0000000001", "10240000.0000000001", "99999999.9999999999"]);
  });

  it("format luôn đủ 10 chữ số thập phân", () => {
    expect(formatPosition(p("1024"))).toBe("1024.0000000000");
    expect(formatPosition(0n)).toBe("0.0000000000");
    expect(formatPosition(1n)).toBe("0.0000000001");
  });

  it("chuỗi sai định dạng bị từ chối chứ không đoán", () => {
    for (const bad of ["", "-1", "1e3", " 1024", "1024.", "abc", "1024.00000000001"]) {
      expect(() => parsePosition(bad), bad).toThrow();
    }
  });
});

describe("append", () => {
  it("item đầu tiên nhận 1024, không phải 0", () => {
    // `0` sẽ không còn chỗ chèn phía trước.
    expect(appendPosition(undefined)).toBe(p("1024"));
  });

  it("item sau cộng thêm đúng một spacing", () => {
    expect(appendPosition(p("1024"))).toBe(p("2048"));
    expect(appendPosition(p("2048"))).toBe(p("3072"));
  });
});

describe("midpoint và ngưỡng", () => {
  it("trung điểm nằm đúng giữa", () => {
    expect(midpoint(p("1024"), p("2048"))).toBe(p("1536"));
    expect(midpoint(0n, p("1024"))).toBe(p("512"));
  });

  it("khoảng cách rộng thì chưa cần rebalance", () => {
    expect(needsRebalance(p("1024"), p("2048"))).toBe(false);
    expect(needsRebalance(p("1024"), p("1024.00001"))).toBe(false);
  });

  it("khoảng cách dưới ngưỡng thì cần", () => {
    expect(needsRebalance(p("1024"), p("1024.0000001"))).toBe(true);
    expect(needsRebalance(p("1024"), p("1024"))).toBe(true);
  });

  it("đúng ngưỡng vẫn chưa cần — biên là `<`, không phải `<=`", () => {
    expect(needsRebalance(0n, REBALANCE_THRESHOLD)).toBe(false);
  });
});

describe("rebalancedPositions", () => {
  it("giãn thành bội số của 1024, giữ nguyên số lượng", () => {
    expect(rebalancedPositions(3)).toEqual([p("1024"), p("2048"), p("3072")]);
    expect(rebalancedPositions(0)).toEqual([]);
  });
});

describe("planInsert", () => {
  const list = (...positions: string[]): PositionedItem[] =>
    positions.map((position, index) => ({ id: `c${String(index)}`, position: p(position) }));

  it("danh sách rỗng cho 1024", () => {
    expect(planInsert([], null)).toEqual({ position: p("1024"), rebalance: [] });
  });

  it("chèn vào đầu lấy trung điểm với 0", () => {
    expect(planInsert(list("1024"), null).position).toBe(p("512"));
  });

  it("chèn vào cuối cộng một spacing, không rebalance", () => {
    const plan = planInsert(list("1024", "2048"), "c1");
    expect(plan).toEqual({ position: p("3072"), rebalance: [] });
  });

  it("chèn giữa lấy trung điểm", () => {
    expect(planInsert(list("1024", "2048"), "c0").position).toBe(p("1536"));
  });

  it("`afterId` không tồn tại là lỗi lập trình, không phải nhánh đoán ý", () => {
    expect(() => planInsert(list("1024"), "khong-co")).toThrow();
  });

  /**
   * Đây là test trung tâm của cả file.
   *
   * Chèn liên tiếp vào **cùng một khe** — luôn ngay sau phần tử đầu — và đếm
   * xem bao nhiêu lần thì `planInsert` tự quyết định rebalance. Con số phải nằm
   * quanh 30 theo phân tích của ADR-0006: từ gap 1024, mỗi lần chia đôi, và
   * `1024 / 2ⁿ < 10⁻⁶` lần đầu đúng ở `n = 30`.
   */
  it("chèn liên tiếp cùng một khe thì rebalance tự kích hoạt sau ~29–31 lần", () => {
    let items: PositionedItem[] = [
      { id: "left", position: p("1024") },
      { id: "right", position: p("2048") },
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
      { id: "a", position: p("1024") },
      { id: "b", position: p("1024.00000001") },
      { id: "c", position: p("4096") },
    ];

    const plan = planInsert(tight, "a");

    expect(plan.rebalance.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(plan.rebalance.map((r) => r.position)).toEqual([p("1024"), p("2048"), p("3072")]);

    // Và position mới nằm **giữa hai giá trị đã giãn**, không phải giữa hai
    // giá trị cũ — tính trên giá trị cũ sẽ cho một số nằm ngoài khe mới.
    expect(plan.position).toBe(p("1536"));
  });

  it("rebalance khi chèn vào đầu cũng tính lại trên giá trị đã giãn", () => {
    const tight: PositionedItem[] = [
      { id: "a", position: p("0.0000000001") },
      { id: "b", position: p("4096") },
    ];
    const plan = planInsert(tight, null);

    expect(plan.rebalance.map((r) => r.position)).toEqual([p("1024"), p("2048")]);
    expect(plan.position).toBe(p("512"));
  });
});

describe("planMove", () => {
  const list = (...positions: string[]): PositionedItem[] =>
    positions.map((position, index) => ({ id: `t${String(index)}`, position: p(position) }));

  it("column rỗng cho 1024", () => {
    expect(planMove([], p("5000"))).toEqual({ position: p("1024"), rebalance: [] });
  });

  it("đích lớn hơn mọi position là append", () => {
    expect(planMove(list("1024", "2048"), p("9999")).position).toBe(p("3072"));
  });

  it("đích nhỏ hơn mọi position là chèn đầu", () => {
    expect(planMove(list("1024", "2048"), p("1")).position).toBe(p("512"));
  });

  it("đích trùng đúng position của một item nghĩa là đứng **trước** item đó", () => {
    // Thả lên hàng đầu tiên phải cho ra một vị trí trước nó, không phải sau.
    expect(planMove(list("1024", "2048"), p("1024")).position).toBe(p("512"));
    expect(planMove(list("1024", "2048"), p("2048")).position).toBe(p("1536"));
  });

  it("item đang di chuyển bị loại khỏi dãy trước khi tìm khe", () => {
    const items = list("1024", "2048", "3072");
    // `t1` chuyển xuống cuối: nếu không loại nó ra, khe cuối vẫn là 3072→∞ nhưng
    // dãy trung gian sẽ tính sai khi đích rơi cạnh chính nó.
    const plan = planMove(items, p("9999"), "t1");
    expect(plan.position).toBe(p("4096"));
  });

  it("khe quá hẹp thì rebalance rồi mới đặt", () => {
    const tight: PositionedItem[] = [
      { id: "a", position: p("1024") },
      { id: "b", position: p("1024.00000001") },
    ];
    const plan = planMove(tight, p("1024.000000005"));

    expect(plan.rebalance.map((r) => r.position)).toEqual([p("1024"), p("2048")]);
    expect(plan.position).toBe(p("1536"));
  });
});

describe("reorderedPositions", () => {
  it("gán lại bội số 1024 theo đúng thứ tự đã cho", () => {
    expect(reorderedPositions(["c", "a", "b"])).toEqual([
      { id: "c", position: p("1024") },
      { id: "a", position: p("2048") },
      { id: "b", position: p("3072") },
    ]);
  });

  it("danh sách rỗng cho mảng rỗng", () => {
    expect(reorderedPositions([])).toEqual([]);
  });
});
