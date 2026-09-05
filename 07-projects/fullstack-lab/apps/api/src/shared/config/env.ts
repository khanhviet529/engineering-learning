import { z } from "zod";
import { RATE_LIMITED_ROUTES, type RateLimitRules } from "../http/rate-limit.ts";

/**
 * Cấu hình được validate **tại lúc process khởi động**, bằng một schema hẹp —
 * `docs/operations/local-development.md`.
 *
 * Hai quy tắc quan trọng hơn bản thân danh sách biến:
 *
 * 1. **Fail fast với lý do an toàn.** Thiếu hoặc sai một biến bắt buộc thì
 *    process dừng ngay, chứ không chạy tiếp rồi hỏng ở request thứ một nghìn.
 * 2. **Log ghi *tên* biến, không bao giờ ghi *giá trị*.** Một thông báo lỗi
 *    tiện tay in ra connection string là một lần rò rỉ secret vào log.
 */

const portSchema = z.coerce.number().int().min(1).max(65_535);

export const envSchema = z
  .object({
    /** Tên environment, dùng cho log và telemetry — không phải để rẽ nhánh business logic. */
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    /** Cổng API lắng nghe. */
    API_PORT: portSchema.default(3001),

    /** Origin công khai của web, dùng cho CORS allowlist và cookie. Không lấy từ request. */
    WEB_ORIGIN: z.url(),

    /** Kết nối PostgreSQL. API là consumer duy nhất của credential này. */
    DATABASE_URL: z.string().min(1),

    /**
     * Vật liệu ký. Bắt buộc đủ dài để không bị đoán.
     *
     * Tên `SESSION_SECRET` là di sản: nó **không** ký session (session token là
     * 32 byte ngẫu nhiên và database chỉ giữ SHA-256 của nó). Thứ nó ký là
     * **cursor phân trang**. Đổi tên biến là một thay đổi vận hành cho mọi môi
     * trường đang chạy, nên nó được **báo cáo** chứ không tự đổi ở đây.
     */
    SESSION_SECRET: z.string().min(32),
    CSRF_SECRET: z.string().min(32),

    /**
     * Key của **thế hệ trước**, chỉ có mặt trong cửa sổ xoay.
     *
     * Ký luôn bằng key hiện hành; hai biến này chỉ nới phía **verify**, để một
     * cursor hoặc một CSRF token cấp trước lúc xoay vẫn dùng được cho tới khi
     * client lấy giá trị mới. Không đặt chúng thì hành vi y hệt trước đây.
     *
     * Đóng cửa sổ xoay là một **bước con người**: xoá biến. `KeyRing` đếm số
     * lần key cũ cứu một request để trả lời đúng câu hỏi khiến người ta do dự —
     * "đóng được chưa?". Xem `shared/security/key-ring.ts`.
     */
    SESSION_SECRET_PREVIOUS: z.string().min(32).optional(),
    CSRF_SECRET_PREVIOUS: z.string().min(32).optional(),

    /** SMTP local (Mailpit). Không relay ra Internet. */
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: portSchema,

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    /**
     * Nới giới hạn rate limit cho **một số route đã đặt tên**, dạng JSON.
     *
     * ```
     * RATE_LIMIT_OVERRIDES='{"auth.sign-up":{"limit":1000,"windowMs":60000}}'
     * ```
     *
     * Bốn ràng buộc, và cả bốn đều là ràng buộc bảo mật chứ không phải tiện
     * dụng:
     *
     * 1. **Mặc định là giá trị chặt.** Thiếu biến ⇒ bảng production nguyên vẹn.
     *    Không tồn tại giá trị nào nghĩa là "không giới hạn".
     * 2. **Tên route phải có thật.** Một khoá lạ là `ConfigError` lúc khởi
     *    động, không phải một dòng bị bỏ qua im lặng — gõ sai tên route mà vẫn
     *    chạy nghĩa là người vận hành tin mình đã nới trong khi chưa.
     * 3. **Không đọc từ bất cứ thứ gì client gửi.** Nó là biến môi trường, đọc
     *    một lần lúc khởi động; không có endpoint nào đổi được nó.
     * 4. `limit >= 1` và `windowMs >= 1000`: một cửa sổ dưới một giây làm
     *    `Retry-After` luôn là `1` và biến giới hạn thành nhiễu.
     */
    RATE_LIMIT_OVERRIDES: z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined || raw.trim().length === 0) return {} as Partial<RateLimitRules>;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ctx.addIssue({ code: "custom", message: "RATE_LIMIT_OVERRIDES không phải JSON hợp lệ." });
          return z.NEVER;
        }

        /**
         * `partialRecord`, **không** phải `record`.
         *
         * Với một khoá enum, `z.record` của Zod 4 là **exhaustive**: nó đòi đủ
         * mọi route mới hợp lệ. Đó là ngược hẳn ý định ở đây — override chỉ nêu
         * tên vài route, phần còn lại giữ giá trị production. Bản đầu dùng
         * `record` và test "route được nêu đổi, route khác giữ nguyên" đỏ ngay,
         * đúng chỗ nó phải đỏ.
         */
        const shape = z
          .partialRecord(
            z.enum(RATE_LIMITED_ROUTES as [string, ...string[]]),
            z.object({ limit: z.int().min(1), windowMs: z.int().min(1000) }).strict(),
          )
          .safeParse(parsed);

        if (!shape.success) {
          ctx.addIssue({
            code: "custom",
            message:
              'RATE_LIMIT_OVERRIDES sai hình dạng: cần {"<tên route>":{"limit":n,"windowMs":n}} ' +
              "với tên route nằm trong danh mục và limit>=1, windowMs>=1000.",
          });
          return z.NEVER;
        }

        return shape.data as Partial<RateLimitRules>;
      }),
  })
  .strict();

export type Env = z.infer<typeof envSchema>;

/**
 * Lỗi cấu hình: mang tên biến, tuyệt đối không mang giá trị.
 *
 * Field được khai tường minh thay vì dùng parameter property: cú pháp đó phải
 * *sinh* code nên Node không chạy được ở chế độ chỉ bóc kiểu.
 */
export class ConfigError extends Error {
  readonly invalidKeys: readonly string[];

  constructor(invalidKeys: readonly string[]) {
    super(
      `Cấu hình không hợp lệ. Các biến sau thiếu hoặc sai định dạng: ${invalidKeys.join(", ")}. ` +
        "Giá trị cố ý không được in ra.",
    );
    this.name = "ConfigError";
    this.invalidKeys = invalidKeys;
  }
}

/**
 * Đọc và validate environment.
 *
 * Nhận `source` để test kiểm được cả nhánh hỏng mà không phải sửa
 * `process.env` toàn cục.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Chỉ lấy các key schema biết: biến lạ trong môi trường không phải lỗi của
  // ứng dụng, nhưng cũng không được lọt vào cấu hình.
  const known = Object.keys(envSchema.shape);
  const picked: Record<string, unknown> = {};
  for (const key of known) {
    if (source[key] !== undefined) picked[key] = source[key];
  }

  const result = envSchema.safeParse(picked);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "(unknown)")))];
    throw new ConfigError(keys.sort());
  }
  return result.data;
}
