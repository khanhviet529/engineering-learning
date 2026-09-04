import { z } from "zod";

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

    /** Vật liệu ký session và CSRF. Bắt buộc đủ dài để không bị đoán. */
    SESSION_SECRET: z.string().min(32),
    CSRF_SECRET: z.string().min(32),

    /** SMTP local (Mailpit). Không relay ra Internet. */
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: portSchema,

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
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
