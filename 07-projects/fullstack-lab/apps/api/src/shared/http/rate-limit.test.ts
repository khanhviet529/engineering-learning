import { describe, expect, it } from "vitest";
import { RATE_LIMIT_RULES, RateLimiter } from "./rate-limit.ts";

/** Đồng hồ giả để kiểm ranh giới cửa sổ mà không phải chờ thật. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("token bucket theo cửa sổ cố định", () => {
  it("cho qua tới đúng giới hạn rồi chặn", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    const { limit } = RATE_LIMIT_RULES["auth.sign-in"];

    for (let i = 0; i < limit; i += 1) {
      expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(true);
    }
    expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(false);
  });

  it("mở lại sau khi hết cửa sổ", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    const rule = RATE_LIMIT_RULES["auth.sign-in"];

    for (let i = 0; i < rule.limit; i += 1) limiter.consume("auth.sign-in", "1.2.3.4");
    expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(false);

    clock.advance(rule.windowMs);
    expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(true);
  });

  it("hai subject khác nhau có bucket riêng", () => {
    const limiter = new RateLimiter(fakeClock().now);
    const rule = RATE_LIMIT_RULES["auth.sign-in"];
    for (let i = 0; i < rule.limit; i += 1) limiter.consume("auth.sign-in", "a");
    expect(limiter.consume("auth.sign-in", "a").allowed).toBe(false);
    expect(limiter.consume("auth.sign-in", "b").allowed).toBe(true);
  });

  it("hai route khác nhau có bucket riêng cho cùng subject", () => {
    const limiter = new RateLimiter(fakeClock().now);
    const rule = RATE_LIMIT_RULES["auth.sign-up"];
    for (let i = 0; i < rule.limit; i += 1) limiter.consume("auth.sign-up", "a");
    expect(limiter.consume("auth.sign-up", "a").allowed).toBe(false);
    expect(limiter.consume("auth.sign-in", "a").allowed).toBe(true);
  });
});

describe("Retry-After", () => {
  it("khi bị chặn thì báo số giây còn lại", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    const rule = RATE_LIMIT_RULES["auth.sign-in"];

    for (let i = 0; i < rule.limit; i += 1) limiter.consume("auth.sign-in", "a");
    clock.advance(20_000);

    const blocked = limiter.consume("auth.sign-in", "a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(40);
  });

  it("không bao giờ trả 0 — trả 0 là mời client thử lại ngay", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    const rule = RATE_LIMIT_RULES["auth.sign-in"];

    for (let i = 0; i < rule.limit; i += 1) limiter.consume("auth.sign-in", "a");
    clock.advance(rule.windowMs - 1);

    expect(limiter.consume("auth.sign-in", "a").retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("khi được phép thì retryAfter là 0 và remaining giảm dần", () => {
    const limiter = new RateLimiter(fakeClock().now);
    const first = limiter.consume("auth.sign-up", "a");
    const second = limiter.consume("auth.sign-up", "a");
    expect(first.retryAfterSeconds).toBe(0);
    expect(second.remaining).toBe(first.remaining - 1);
  });
});

describe("dọn bucket hết hạn", () => {
  it("không dọn thì Map lớn dần theo số subject — đó là đường rò bộ nhớ", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);

    for (let i = 0; i < 1_000; i += 1) limiter.consume("auth.sign-in", `attacker-${String(i)}`);
    expect(limiter.size).toBe(1_000);

    clock.advance(RATE_LIMIT_RULES["auth.sign-in"].windowMs + 1);
    expect(limiter.prune()).toBe(1_000);
    expect(limiter.size).toBe(0);
  });

  it("không dọn nhầm bucket còn hiệu lực", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock.now);
    limiter.consume("auth.sign-in", "a");
    clock.advance(1_000);
    expect(limiter.prune()).toBe(0);
    expect(limiter.size).toBe(1);
  });
});

describe("giá trị khởi điểm khớp hợp đồng", () => {
  it.each([
    ["task.search", 30, 60_000],
    ["time-report.monthly", 20, 60_000],
    ["report.export", 10, 3_600_000],
    ["work-log.bulk-review", 12, 60_000],
  ] as const)("%s là %i request mỗi %i ms", (route, limit, windowMs) => {
    expect(RATE_LIMIT_RULES[route]).toEqual({ limit, windowMs });
  });
});
