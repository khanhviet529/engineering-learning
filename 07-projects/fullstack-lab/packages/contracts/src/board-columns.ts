import { z } from "zod";
import { uuidSchema } from "./fields.js";
import { boardColumnSchema } from "./resources.js";

/**
 * Use case cấp board column — `docs/api/endpoint-contracts.md`, mục "Board
 * columns".
 *
 * `position` không nằm trong bất kỳ request body nào: server tính fractional
 * position, client chỉ nói **đứng sau cột nào**. Đây là lý do reorder không thể
 * trở thành một bulk table update.
 */

export const columnNameSchema = z.string().trim().min(1).max(120);

export const createColumnRequestSchema = z
  .object({
    name: columnNameSchema,
    afterColumnId: uuidSchema.nullable(),
    isTerminal: z.boolean().default(false),
    requiresReviewer: z.boolean().default(false),
  })
  .strict();

export type CreateColumnRequest = z.infer<typeof createColumnRequestSchema>;

/**
 * PATCH nhận **đúng một** command. Union phân biệt bằng hình dạng chứ không
 * bằng một field `op`, đúng như hợp đồng mô tả; body trộn nhiều command hoặc có
 * field lạ là `400 VALIDATION_FAILED`.
 *
 * Đổi `isTerminal` chỉ đổi cách suy `dueState` **từ thời điểm đó**, và đổi
 * `requiresReviewer` chỉ áp cho create/move **sau đó**. Cả hai đều không hồi tố
 * và không di chuyển task nào.
 */
export const updateColumnRequestSchema = z.union([
  z.object({ name: columnNameSchema }).strict(),
  z.object({ isTerminal: z.boolean() }).strict(),
  z.object({ requiresReviewer: z.boolean() }).strict(),
  z.object({ archive: z.literal(true) }).strict(),
]);

export type UpdateColumnRequest = z.infer<typeof updateColumnRequestSchema>;

/**
 * Reorder nhận **toàn bộ** active column của project, mỗi ID đúng một lần —
 * không phải một danh sách con. Nhờ vậy thứ tự cuối là tất định và server không
 * phải đoán ý cho các cột vắng mặt.
 */
export const reorderColumnsRequestSchema = z
  .object({
    projectId: uuidSchema,
    orderedColumnIds: z
      .array(uuidSchema)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "orderedColumnIds không được lặp ID."),
  })
  .strict();

export type ReorderColumnsRequest = z.infer<typeof reorderColumnsRequestSchema>;

export const columnResponseSchema = z.object({ column: boardColumnSchema }).strict();
export type ColumnResponse = z.infer<typeof columnResponseSchema>;

export const columnsResponseSchema = z.object({ columns: z.array(boardColumnSchema) }).strict();
export type ColumnsResponse = z.infer<typeof columnsResponseSchema>;
