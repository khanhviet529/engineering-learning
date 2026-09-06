import { describe, expect, it } from "vitest";
import { loadEnv, ConfigError } from "./env.ts";
import { RATE_LIMIT_RULES, RateLimiter, resolveRateLimitRules } from "../http/rate-limit.ts";

/**
 * Giới hạn rate limit đọc được từ config — và **mặc định phải chặt**.
 *
 * Đây là một tham số bảo mật, nên mọi test dưới đây kiểm đúng một câu: cấu hình
 * chỉ **nới được những gì được nêu tên**, mọi thứ khác giữ nguyên giá trị
 * production, và một cấu hình sai làm process **dừng** chứ không im lặng đi
 * tiếp với một giới hạn mà người vận hành tưởng đã đặt.
 */

/** Biến bắt buộc tối thiểu để `loadEnv` chạy; giá trị không quan trọng ở đây. */
const baseEnv = {
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  CURSOR_SECRET: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
};

describe("mặc định là giá trị production", () => {
  it("không có biến thì bảng luật y nguyên", () => {
    const env = loadEnv(baseEnv);
    expect(env.RATE_LIMIT_OVERRIDES).toEqual({});
    expect(resolveRateLimitRules(env.RATE_LIMIT_OVERRIDES)).toEqual(RATE_LIMIT_RULES);
  });

  it("chuỗi rỗng cũng là không có gì, không phải một cấu hình rỗng nguy hiểm", () => {
    for (const raw of ["", "   "]) {
      const env = loadEnv({ ...baseEnv, RATE_LIMIT_OVERRIDES: raw });
      expect(resolveRateLimitRules(env.RATE_LIMIT_OVERRIDES)).toEqual(RATE_LIMIT_RULES);
    }
  });

  /**
   * `RateLimiter` dựng **không tham số** phải nhận giới hạn production.
   *
   * Đây là chỗ dễ hỏng nhất khi thêm một tham số mới: quên truyền nó ở một chỗ
   * gọi nghĩa là chỗ đó chạy không giới hạn, và không gì báo.
   */
  it("limiter không truyền `rules` chạy đúng giới hạn production", () => {
    const limiter = new RateLimiter();
    const rule = RATE_LIMIT_RULES["auth.sign-up"];

    for (let i = 0; i < rule.limit; i++) {
      expect(limiter.consume("auth.sign-up", "1.2.3.4").allowed, `lần ${String(i)}`).toBe(true);
    }
    expect(limiter.consume("auth.sign-up", "1.2.3.4").allowed).toBe(false);
  });
});

describe("override chỉ chạm route được nêu tên", () => {
  it("route được nêu đổi, route khác giữ nguyên", () => {
    const env = loadEnv({
      ...baseEnv,
      RATE_LIMIT_OVERRIDES: JSON.stringify({
        "auth.sign-up": { limit: 1000, windowMs: 60_000 },
      }),
    });

    const rules = resolveRateLimitRules(env.RATE_LIMIT_OVERRIDES);
    expect(rules["auth.sign-up"]).toEqual({ limit: 1000, windowMs: 60_000 });
    // Mọi route khác **không** đổi một giá trị nào.
    expect(rules["auth.sign-in"]).toEqual(RATE_LIMIT_RULES["auth.sign-in"]);
    expect(rules["workspace.invite"]).toEqual(RATE_LIMIT_RULES["workspace.invite"]);
    expect(rules["report.export"]).toEqual(RATE_LIMIT_RULES["report.export"]);
  });

  it("limiter thật sự chạy theo giới hạn đã nới", () => {
    const limiter = new RateLimiter(
      Date.now,
      resolveRateLimitRules({ "auth.sign-up": { limit: 50, windowMs: 60_000 } }),
    );

    for (let i = 0; i < 50; i++) {
      expect(limiter.consume("auth.sign-up", "1.2.3.4").allowed).toBe(true);
    }
    expect(limiter.consume("auth.sign-up", "1.2.3.4").allowed).toBe(false);

    // Route không nới vẫn chặt như production.
    const signIn = RATE_LIMIT_RULES["auth.sign-in"];
    for (let i = 0; i < signIn.limit; i++) {
      expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(true);
    }
    expect(limiter.consume("auth.sign-in", "1.2.3.4").allowed).toBe(false);
  });

  /** Không có đường nào **xoá** một luật — một route không luật là không giới hạn. */
  it("không thể làm một route mất luật", () => {
    const rules = resolveRateLimitRules({});
    for (const route of Object.keys(RATE_LIMIT_RULES) as (keyof typeof RATE_LIMIT_RULES)[]) {
      expect(rules[route], route).toBeDefined();
    }
  });
});

describe("cấu hình sai làm process dừng, không đi tiếp im lặng", () => {
  function expectRejected(raw: string): void {
    try {
      loadEnv({ ...baseEnv, RATE_LIMIT_OVERRIDES: raw });
      throw new Error(`Đáng lẽ phải bị từ chối: ${raw}`);
    } catch (error) {
      expect(error, raw).toBeInstanceOf(ConfigError);
      // Thông báo mang **tên biến**, không mang giá trị.
      expect((error as ConfigError).invalidKeys).toContain("RATE_LIMIT_OVERRIDES");
    }
  }

  it("JSON hỏng bị từ chối", () => {
    expectRejected("{khong-phai-json");
    expectRejected("null");
    expectRejected("[]");
  });

  /**
   * **Tên route lạ bị từ chối**, không bị bỏ qua.
   *
   * Gõ sai tên route mà process vẫn chạy nghĩa là người vận hành tin mình đã
   * nới trong khi chưa — và họ chỉ biết khi E2E đỏ vì `429`, ở một chỗ trông
   * chẳng liên quan gì tới cấu hình.
   */
  it("tên route không có trong danh mục bị từ chối", () => {
    expectRejected(JSON.stringify({ "auth.signup": { limit: 100, windowMs: 60_000 } }));
    expectRejected(JSON.stringify({ "task.list": { limit: 100, windowMs: 60_000 } }));
  });

  it("giá trị vô lý bị từ chối", () => {
    expectRejected(JSON.stringify({ "auth.sign-up": { limit: 0, windowMs: 60_000 } }));
    expectRejected(JSON.stringify({ "auth.sign-up": { limit: -1, windowMs: 60_000 } }));
    // Cửa sổ dưới một giây làm `Retry-After` luôn là `1` và biến giới hạn thành nhiễu.
    expectRejected(JSON.stringify({ "auth.sign-up": { limit: 10, windowMs: 100 } }));
    expectRejected(JSON.stringify({ "auth.sign-up": { limit: 10 } }));
    // Field lạ cũng bị từ chối: `.strict()` chặn một `limits` gõ nhầm số nhiều.
    expectRejected(JSON.stringify({ "auth.sign-up": { limit: 10, windowMs: 60_000, burst: 5 } }));
  });
});
