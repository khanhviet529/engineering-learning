import { describe, expect, it } from "vitest";
import {
  DUE_SOON_WINDOW_DAYS,
  addDays,
  daysBetween,
  deriveDueState,
  isValidTimeZone,
  toCalendarDate,
} from "./due-state.ts";

/**
 * `dueState` là enum **server-derived**, và cả file này tồn tại để một câu duy
 * nhất không bao giờ đúng ngẫu nhiên: *"suy theo timezone workspace, không theo
 * UTC, không theo giờ của máy chạy test"*.
 */

describe("toCalendarDate", () => {
  /**
   * Cùng một instant, ba timezone, **ba ngày lịch khác nhau**.
   *
   * 17:00 UTC ngày 04/09 đã là 00:00 ngày 05/09 ở GMT+7. Một task có
   * `due_date = 2026-09-05` vì vậy là `due_today` với người ở Việt Nam và vẫn
   * là `due_soon` với một server đọc UTC — đúng loại lệch mà một test đọc
   * `new Date()` không bao giờ nhìn thấy.
   */
  it("cùng một instant cho ngày khác nhau ở timezone khác nhau", () => {
    const instant = new Date("2026-09-04T17:00:00Z");

    expect(toCalendarDate(instant, "UTC")).toBe("2026-09-04");
    expect(toCalendarDate(instant, "Asia/Ho_Chi_Minh")).toBe("2026-09-05");
    expect(toCalendarDate(instant, "America/Los_Angeles")).toBe("2026-09-04");
  });

  it("qua nửa đêm địa phương thì ngày đổi, dù UTC chưa đổi", () => {
    const before = new Date("2026-09-04T16:59:59Z");
    const after = new Date("2026-09-04T17:00:00Z");

    expect(toCalendarDate(before, "Asia/Ho_Chi_Minh")).toBe("2026-09-04");
    expect(toCalendarDate(after, "Asia/Ho_Chi_Minh")).toBe("2026-09-05");
    // UTC vẫn là cùng một ngày ở cả hai thời điểm.
    expect(toCalendarDate(before, "UTC")).toBe(toCalendarDate(after, "UTC"));
  });

  it("luôn đủ hai chữ số cho tháng và ngày", () => {
    expect(toCalendarDate(new Date("2026-01-02T12:00:00Z"), "UTC")).toBe("2026-01-02");
  });
});

describe("isValidTimeZone", () => {
  /**
   * Hỏi `Intl` thay vì giữ một danh sách chép tay.
   *
   * Danh sách IANA đổi theo bản tzdata; một bản chép sẽ lệch khỏi runtime ngay
   * lần cập nhật đầu tiên, và lệch theo hướng tệ nhất — nó nói "hợp lệ" cho một
   * tên mà `Intl` sẽ ném khi đọc.
   */
  it("nhận tên IANA thật và từ chối tên bịa", () => {
    for (const zone of ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles", "Europe/Berlin"]) {
      expect(isValidTimeZone(zone), zone).toBe(true);
    }
    for (const zone of ["", "Khong/Ton_Tai", "GMT+7 giờ", "Asia/Hanoi_City"]) {
      expect(isValidTimeZone(zone), zone).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("cộng ngày lịch, qua cả ranh giới tháng và năm", () => {
    expect(addDays("2026-09-05", 0)).toBe("2026-09-05");
    expect(addDays("2026-09-05", 3)).toBe("2026-09-08");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("daysBetween", () => {
  it("đếm đúng số ngày, kể cả qua ranh giới tháng và năm", () => {
    expect(daysBetween("2026-09-05", "2026-09-05")).toBe(0);
    expect(daysBetween("2026-09-05", "2026-09-08")).toBe(3);
    expect(daysBetween("2026-09-05", "2026-09-04")).toBe(-1);
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  /**
   * DST không được chạm vào phép đếm.
   *
   * Cả hai đầu được đọc dưới cùng một quy ước UTC, nên một ngày mất 23 hoặc 25
   * giờ ở đâu đó không làm hiệu số lệch — nếu tính bằng `Date` địa phương thì
   * `Math.round` sẽ cứu phần lớn trường hợp và im lặng sai ở phần còn lại.
   */
  it("không bị DST làm lệch", () => {
    // 08/03/2026 là ngày đổi giờ ở Mỹ; khoảng này vẫn đúng 7 ngày.
    expect(daysBetween("2026-03-05", "2026-03-12")).toBe(7);
  });
});

describe("deriveDueState", () => {
  const today = "2026-09-05";

  it("không có hạn là `none`", () => {
    expect(deriveDueState({ dueDate: null, isTerminal: false, today })).toBe("none");
  });

  it("quá hạn là `overdue`", () => {
    expect(deriveDueState({ dueDate: "2026-09-04", isTerminal: false, today })).toBe("overdue");
  });

  it("đúng hôm nay là `due_today`", () => {
    expect(deriveDueState({ dueDate: today, isTerminal: false, today })).toBe("due_today");
  });

  it("trong cửa sổ sắp tới hạn là `due_soon`", () => {
    expect(deriveDueState({ dueDate: "2026-09-06", isTerminal: false, today })).toBe("due_soon");
    expect(deriveDueState({ dueDate: "2026-09-08", isTerminal: false, today })).toBe("due_soon");
  });

  it("ngoài cửa sổ là `scheduled`", () => {
    expect(deriveDueState({ dueDate: "2026-09-09", isTerminal: false, today })).toBe("scheduled");
  });

  it("biên của cửa sổ đúng bằng `DUE_SOON_WINDOW_DAYS`", () => {
    const inside = new Date(Date.parse(`${today}T00:00:00Z`) + DUE_SOON_WINDOW_DAYS * 86_400_000);
    const outside = new Date(
      Date.parse(`${today}T00:00:00Z`) + (DUE_SOON_WINDOW_DAYS + 1) * 86_400_000,
    );

    expect(
      deriveDueState({ dueDate: toCalendarDate(inside, "UTC"), isTerminal: false, today }),
    ).toBe("due_soon");
    expect(
      deriveDueState({ dueDate: toCalendarDate(outside, "UTC"), isTerminal: false, today }),
    ).toBe("scheduled");
  });

  /**
   * **Terminal thắng tất cả** — ADR-0008 mục 3.
   *
   * Task ở cột kết thúc luôn là `none`, bất kể quá hạn bao lâu. Đặt nhánh này
   * sau nhánh ngày sẽ cho một task đã xong vẫn hiện đỏ, và nó cũng sẽ xuất hiện
   * trong bộ lọc `overdue` — nơi không ai muốn thấy việc đã xong.
   */
  it("task ở cột terminal luôn là `none`, dù quá hạn", () => {
    expect(deriveDueState({ dueDate: "2020-01-01", isTerminal: true, today })).toBe("none");
    expect(deriveDueState({ dueDate: today, isTerminal: true, today })).toBe("none");
    expect(deriveDueState({ dueDate: "2030-01-01", isTerminal: true, today })).toBe("none");
  });
});
