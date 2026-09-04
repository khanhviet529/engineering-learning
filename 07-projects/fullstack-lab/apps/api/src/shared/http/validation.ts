import type { ZodType } from "zod";
import { validationError } from "../errors/app-error.ts";

/**
 * Zod là boundary parser — `docs/engineering/backend-conventions.md`.
 *
 * Parse xảy ra **trước** use case. Schema chỉ nhận field trong allowlist và từ
 * chối field lạ (mọi schema của `@flowboard/contracts` là `.strict()`), nên
 * mass assignment không có đường vào: một `role` hay `projectId` lén trong body
 * là lỗi validation, không phải một field bị bỏ qua im lặng.
 *
 * Ở `shared/` vì cả ba module hiện có đều parse theo cùng cách và cùng phải
 * dựng field-error array giống nhau.
 */

/**
 * Parse một giá trị theo schema contract; lỗi thành `400 VALIDATION_FAILED`
 * với field-error array.
 *
 * `field` là **JSON path của request**, không phải tên cột database — hợp đồng
 * nói rõ điều đó, và lộ tên cột ra client là rò rỉ hình dạng schema.
 */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw validationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      code: issue.code,
      message: issue.message,
    })),
  );
}
