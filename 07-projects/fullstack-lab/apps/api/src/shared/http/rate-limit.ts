/**
 * Rate limit in-process — `docs/api/api-conventions.md`, mục "Rate limit và
 * `Retry-After`".
 *
 * Cơ chế ở core MVP là **token bucket trong bộ nhớ của từng API instance**. Đây
 * là quyết định có ý thức, không phải chỗ chưa làm xong: đưa Redis vào chỉ để
 * đếm request là vi phạm quy tắc "chỉ thêm hạ tầng khi behavior cần nó".
 *
 * Hai giới hạn được chấp nhận và ghi lại:
 *
 * 1. Counter reset khi process restart.
 * 2. Chạy nhiều instance làm quota bị nhân lên theo số instance.
 *
 * Vì vậy "limiter per-instance = limiter toàn cục" chỉ đúng **có điều kiện**
 * single-instance, đúng topology Compose hiện tại. Chạy nhiều instance là điều
 * kiện chuyển sang limiter dùng Redis, trong một change có ADR, **trước** khi
 * topology đó nhận traffic thật.
 */

export interface RateLimitRule {
  /** Số request cho phép trong một cửa sổ. */
  limit: number;
  /** Độ dài cửa sổ, tính bằng mili giây. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Số giây client phải chờ; chỉ có nghĩa khi `allowed` là `false`. */
  retryAfterSeconds: number;
  remaining: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Giá trị khởi điểm cho các route đắt, theo hợp đồng. Chúng được tune bằng
 * telemetry và **không phải cam kết SLA**.
 */
export const RATE_LIMIT_RULES = {
  /** Auth: chống abuse và enumeration. */
  "auth.sign-in": { limit: 10, windowMs: 60_000 },
  "auth.sign-up": { limit: 5, windowMs: 60_000 },
  "auth.password.forgot": { limit: 5, windowMs: 60_000 },
  "auth.password.reset": { limit: 5, windowMs: 60_000 },
  "auth.email.resend": { limit: 5, windowMs: 60_000 },

  /**
   * Gửi lời mời workspace — ADR-0013.
   *
   * Route này gửi thư tới **địa chỉ do người gọi tự nhập**, tới người có thể
   * chưa từng là người dùng Flowboard. Không có giới hạn, nó là một máy gửi thư
   * rác mang tên miền của sản phẩm, và người bị hại là người nhận chứ không
   * phải chúng ta. Vì vậy nó nằm cùng nhóm với các route auth, không phải nhóm
   * "endpoint đắt" — cái giá ở đây là uy tín tên miền, không phải CPU.
   */
  "workspace.invite": { limit: 10, windowMs: 60_000 },

  /** Endpoint đắt, theo bảng trong API conventions. */
  "task.search": { limit: 30, windowMs: 60_000 },
  "time-report.monthly": { limit: 20, windowMs: 60_000 },
  "report.export": { limit: 10, windowMs: 3_600_000 },
  "work-log.bulk-review": { limit: 12, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitedRoute = keyof typeof RATE_LIMIT_RULES;

/**
 * Limiter fixed-window.
 *
 * Chọn fixed window thay vì sliding window vì nó rẻ và đủ cho mục tiêu chống
 * abuse. Nhược điểm đã biết: một client có thể dồn `2 × limit` request quanh
 * ranh giới cửa sổ. Với ngưỡng chống abuse thì mức đó chấp nhận được; với
 * ngưỡng bảo vệ tài nguyên thì không, và khi ấy phải đổi thuật toán chứ không
 * phải hạ ngưỡng.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Ghi nhận một request và cho biết nó có được phép hay không.
   *
   * `subject` phải là tín hiệu định danh **đã chuẩn hoá** — địa chỉ IP, hoặc
   * email đã canonical, hoặc `actorId`. Không bao giờ là giá trị thô do client
   * gửi, vì như vậy client tự chọn được bucket của mình.
   */
  consume(route: RateLimitedRoute, subject: string): RateLimitResult {
    const rule = RATE_LIMIT_RULES[route];
    const key = `${route}:${subject}`;
    const now = this.#now();

    const bucket = this.#buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.#buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - 1 };
    }

    if (bucket.count >= rule.limit) {
      return {
        allowed: false,
        // Làm tròn lên: trả `0` sẽ mời client thử lại ngay lập tức.
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        remaining: 0,
      };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - bucket.count };
  }

  /**
   * Xoá sạch mọi bucket.
   *
   * Khác `prune()`: `prune` chỉ bỏ bucket **đã hết hạn** và là việc vận hành
   * định kỳ; `reset` bỏ tất cả, kể cả bucket đang đếm.
   *
   * Nó tồn tại cho test: một suite gọi cùng một route hàng chục lần từ cùng một
   * địa chỉ sẽ chạm hạn mức và bắt đầu đo `429` thay vì đo hành vi nó định đo.
   * Cách khác là chờ hết cửa sổ (một phút cho mỗi case) hoặc nới hạn mức trong
   * test — cái đầu làm suite không chạy nổi, cái sau làm test không còn kiểm
   * đúng cấu hình production.
   */
  reset(): void {
    this.#buckets.clear();
  }

  /**
   * Dọn bucket đã hết hạn.
   *
   * Không có bước này thì Map lớn dần theo số subject từng gặp, và một đợt tấn
   * công dò email biến thành một đường rò bộ nhớ.
   */
  prune(): number {
    const now = this.#now();
    let removed = 0;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#buckets.size;
  }
}
