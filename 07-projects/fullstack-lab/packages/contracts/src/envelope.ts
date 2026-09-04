import { z } from "zod";
import { errorCodeSchema } from "./error-codes.js";

/**
 * Envelope thành công và envelope lỗi — `docs/api/api-conventions.md`.
 *
 * `requestId` có mặt trong cả JSON lẫn header `X-Request-Id`. `204 No Content`
 * không có body nhưng vẫn gửi header. File download là ngoại lệ: body nhị phân,
 * có header, không có envelope JSON.
 */

/** Một phần tử của field-error array. `field` là JSON path của request, không phải tên cột database. */
export const fieldErrorSchema = z
  .object({
    field: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export type FieldError = z.infer<typeof fieldErrorSchema>;

/** `details` của `TASK_VERSION_CONFLICT`: object, không phải field-error array. */
export const versionConflictDetailsSchema = z
  .object({ currentVersion: z.int().positive() })
  .strict();

export type VersionConflictDetails = z.infer<typeof versionConflictDetailsSchema>;

/**
 * Error envelope. `error.code` là discriminator: client rẽ nhánh theo code chứ
 * không theo HTTP status hay `typeof details`.
 *
 * Chỉ hai variant công bố `details`; các code còn lại bỏ trống field này.
 */
export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1),
        details: z.union([z.array(fieldErrorSchema), versionConflictDetailsSchema]).optional(),
      })
      .strict(),
    requestId: z.string().min(1),
  })
  .strict()
  .refine(
    (v) =>
      v.error.details === undefined ||
      (v.error.code === "VALIDATION_FAILED" && Array.isArray(v.error.details)) ||
      (v.error.code === "TASK_VERSION_CONFLICT" && !Array.isArray(v.error.details)),
    {
      message:
        "details chỉ hợp lệ với VALIDATION_FAILED (field-error array) và TASK_VERSION_CONFLICT (object currentVersion).",
      path: ["error", "details"],
    },
  );

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Envelope thành công cho một payload bất kỳ. */
export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, requestId: z.string().min(1) }).strict();

/**
 * Cursor page. `limit` mặc định 25, tối đa 100; API **không** clamp im lặng —
 * giá trị ngoài khoảng là `400 VALIDATION_FAILED`.
 */
export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

export const pageSchema = z
  .object({
    nextCursor: z.string().min(1).nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export type Page = z.infer<typeof pageSchema>;

/** Envelope của một list endpoint: `items` và `page` nằm **trong** `data`. */
export const listEnvelopeSchema = <T extends z.ZodType>(item: T) =>
  successEnvelopeSchema(z.object({ items: z.array(item), page: pageSchema }).strict());

/**
 * Query phân trang dùng chung. Cursor là giá trị opaque gắn fingerprint của
 * filter và sort: dùng cursor của một truy vấn khác (khác column, khác project,
 * khác filter) là `400 VALIDATION_FAILED`, không phải đọc sang scope khác.
 */
export const paginationQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
