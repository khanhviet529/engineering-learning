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

const envObjectSchema = z
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
     * Vật liệu ký **cursor phân trang**. Bắt buộc đủ dài để không bị đoán.
     *
     * Tên cũ là `SESSION_SECRET`, và nó được đặt theo thứ nó **không** làm:
     * session token là 32 byte ngẫu nhiên, không ký bằng gì, database giữ
     * SHA-256 của nó. Không key nào vô hiệu được một session. Thứ biến này ký
     * là cursor (`shared/http/cursor.ts`), nên đổi key làm cursor đang mở chết
     * → `400`, client về trang đầu.
     *
     * Cái tên sai đã tốn một vòng thật: yêu cầu của M5 viết "đổi
     * `SESSION_SECRET` là vô hiệu mọi session" và tiền đề đó sai hoàn toàn.
     * `SESSION_SECRET` vẫn được nhận qua bảng `RENAMED_KEYS` bên dưới, trong
     * **một** khoảng chuyển tiếp có cảnh báo.
     */
    CURSOR_SECRET: z.string().min(32),
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
    CURSOR_SECRET_PREVIOUS: z.string().min(32).optional(),
    CSRF_SECRET_PREVIOUS: z.string().min(32).optional(),

    /** SMTP. Ở local và CI là Mailpit; nó không relay ra Internet. */
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: portSchema,

    /**
     * Credential SMTP — **optional**, và đúng nghĩa optional.
     *
     * Không đặt hai biến này thì transport giữ nguyên hành vi Mailpit hôm nay
     * (`secure: false`, `ignoreTLS: true`, không xác thực). Đặt cả hai thì
     * transport bật TLS và xác thực. Không có trạng thái thứ ba: một nửa
     * credential là **`ConfigError`** lúc khởi động, xem `.superRefine` bên
     * dưới. Gửi không xác thực trong khi người vận hành tin là đã xác thực là
     * cách credential đi ra ngoài mà không ai biết.
     */
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),

    /**
     * Địa chỉ `From` của thư gửi đi.
     *
     * Mặc định giữ đúng giá trị đang ghi cứng hôm nay, nên không đặt biến thì
     * không có gì đổi. Nhưng `.test` là TLD **dành riêng** (RFC 2606): nó
     * không phân giải được và không ký SPF/DKIM/DMARC được, nên một provider
     * thật sẽ từ chối. Đó là lý do giá trị này phải cấu hình được **trước** khi
     * có provider, chứ không phải sau.
     */
    MAIL_FROM: z.string().min(1).default("Flowboard <no-reply@flowboard.test>"),

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

/**
 * Tên biến mà schema biết. Dùng cho `loadEnv` và cho bộ kiểm template
 * `.env.production.example` — cả hai phải đọc **cùng một** nguồn, nếu không
 * template sẽ trôi khỏi schema mà không ai thấy.
 */
export const ENV_KEYS: readonly string[] = Object.keys(envObjectSchema.shape).sort();

/** Biến bắt buộc: không có `.optional()` và không có `.default()`. */
export const REQUIRED_ENV_KEYS: readonly string[] = ENV_KEYS.filter((key) => {
  const field = envObjectSchema.shape[key as keyof typeof envObjectSchema.shape];
  return field.safeParse(undefined).success === false;
});

/**
 * Ràng buộc **giữa các biến**, không thuộc về biến nào một mình.
 *
 * `superRefine` chạy sau khi từng field đã hợp lệ, nên nó chỉ nói về quan hệ.
 * Issue được gắn vào đúng tên biến **đang thiếu**, để `ConfigError.invalidKeys`
 * chỉ vào thứ người vận hành phải đặt chứ không vào thứ họ đã đặt đúng.
 */
export const envSchema = envObjectSchema.superRefine((value, ctx) => {
  const hasUser = value.SMTP_USER !== undefined;
  const hasPassword = value.SMTP_PASSWORD !== undefined;
  if (hasUser === hasPassword) return;

  const missing = hasUser ? "SMTP_PASSWORD" : "SMTP_USER";
  const present = hasUser ? "SMTP_USER" : "SMTP_PASSWORD";
  ctx.addIssue({
    code: "custom",
    path: [missing],
    message:
      `${present} được đặt nhưng ${missing} thì không. Một nửa credential không phải ` +
      "cấu hình hợp lệ: nó sẽ gửi mail **không xác thực** trong khi người vận hành tin " +
      "là đã xác thực. Đặt cả hai, hoặc bỏ cả hai để dùng SMTP không xác thực (Mailpit).",
  });
});

export type Env = z.infer<typeof envSchema>;

/**
 * Biến đã đổi tên, và khoảng chuyển tiếp nhận **cả hai**.
 *
 * Vì sao không xoá tên cũ trong cùng một lượt: một lần deploy bắt mọi môi
 * trường đổi biến **đồng thời** là một lần deploy sẽ có môi trường bị bỏ quên,
 * và triệu chứng của nó là API không khởi động được. Tên mới thắng khi có cả
 * hai; chỉ có tên cũ thì vẫn chạy, kèm đúng **một** cảnh báo nói phải đổi sang
 * tên gì.
 */
export const RENAMED_KEYS: readonly { readonly from: string; readonly to: string }[] = [
  { from: "SESSION_SECRET", to: "CURSOR_SECRET" },
  { from: "SESSION_SECRET_PREVIOUS", to: "CURSOR_SECRET_PREVIOUS" },
];

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
        "Giá trị cố ý không được in ra. " +
        // Con trỏ tới **danh sách đầy đủ**, để người deploy không phải đọc
        // schema hay bốn tài liệu mới biết mình còn thiếu gì.
        "Danh sách biến và biến nào bắt buộc: `.env.production.example`.",
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
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
  options: { warn?: (message: string) => void } = {},
): Env {
  const warn = options.warn ?? ((message: string) => void console.warn(message));

  /**
   * Chuỗi rỗng là **không có**, không phải "có, giá trị rỗng".
   *
   * Đây không phải sự dễ dãi mà là hình dạng thật của môi trường: Compose viết
   * `CURSOR_SECRET: ${CURSOR_SECRET:-}` để khỏi cảnh báo biến chưa đặt, và một
   * `.env` viết `SMTP_USER=` là cách người ta ghi "chưa dùng". Cả hai đi vào
   * process là `""`. Không quy đổi ở đây thì một biến optional bỏ trống sẽ
   * thành `ConfigError`, và thông điệp sẽ nói biến "sai định dạng" trong khi
   * người vận hành cố ý để trống nó.
   */
  const present = (value: string | undefined): string | undefined =>
    value === undefined || value === "" ? undefined : value;

  const resolved: Record<string, string | undefined> = {};
  for (const key of Object.keys(source)) resolved[key] = present(source[key]);

  /**
   * Đưa tên cũ về tên mới **trước** khi validate.
   *
   * Gộp thành đúng một cảnh báo cho cả bảng, không một cảnh báo cho mỗi biến:
   * hai dòng cảnh báo cho cùng một việc phải làm là hai dòng người ta học cách
   * bỏ qua.
   */
  const legacyOnly: string[] = [];
  const bothSet: string[] = [];

  for (const { from, to } of RENAMED_KEYS) {
    const legacy = resolved[from];
    if (legacy === undefined) continue;
    if (resolved[to] === undefined) {
      resolved[to] = legacy;
      legacyOnly.push(`${from} → ${to}`);
    } else if (resolved[to] !== legacy) {
      // Tên mới thắng. Nhưng bỏ qua **im lặng** một giá trị người vận hành đã
      // cố ý đặt là cách họ tin mình đã đổi key trong khi chưa.
      bothSet.push(`${from} (dùng ${to})`);
    }
  }

  if (legacyOnly.length > 0) {
    warn(
      `[config] đang dùng tên biến cũ: ${legacyOnly.join(", ")}. ` +
        "Tên cũ vẫn được nhận trong khoảng chuyển tiếp này rồi sẽ bị bỏ — " +
        "đổi trong môi trường của bạn. Giá trị cố ý không được in ra.",
    );
  }
  if (bothSet.length > 0) {
    warn(
      `[config] có cả tên cũ lẫn tên mới với giá trị khác nhau: ${bothSet.join(", ")}. ` +
        "Tên mới thắng; tên cũ bị bỏ qua. Giá trị cố ý không được in ra.",
    );
  }

  // Chỉ lấy các key schema biết: biến lạ trong môi trường không phải lỗi của
  // ứng dụng, nhưng cũng không được lọt vào cấu hình.
  const picked: Record<string, unknown> = {};
  for (const key of ENV_KEYS) {
    if (resolved[key] !== undefined) picked[key] = resolved[key];
  }

  const result = envSchema.safeParse(picked);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "(unknown)")))];
    throw new ConfigError(keys.sort());
  }
  return result.data;
}
