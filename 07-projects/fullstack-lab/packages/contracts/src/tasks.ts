import { z } from "zod";
import { capabilitiesSchema } from "./capabilities.js";
import { paginationQuerySchema } from "./envelope.js";
import {
  calendarDateSchema,
  dueStateSchema,
  evidenceUrlSchema,
  positionSchema,
  taskCategorySchema,
  taskPrioritySchema,
  uuidSchema,
  versionSchema,
} from "./fields.js";
import { taskSchema } from "./resources.js";

/**
 * Use case cấp task — `docs/api/endpoint-contracts.md` mục Tasks, và
 * `docs/api/pagination-concurrency-idempotency.md`.
 *
 * Ba field client **không bao giờ** gửi, dù ở create hay update: `projectId`,
 * `position`, `version`, `createdBy`, `dueState` và mọi timestamp. Chúng do
 * server quyết. Gửi chúng là `400 VALIDATION_FAILED`, không phải bị bỏ qua im
 * lặng — vì bỏ qua im lặng biến một client sai thành một client tưởng mình đúng.
 */

export const taskTitleSchema = z.string().trim().min(1).max(200);
export const taskDescriptionSchema = z.string().max(10_000);

/** Sort nằm trong allowlist đóng; ngoài danh sách này là `400`. */
export const TASK_SORTS = [
  "position:asc",
  "position:desc",
  "createdAt:asc",
  "createdAt:desc",
  "updatedAt:asc",
  "updatedAt:desc",
  "dueDate:asc",
  "dueDate:desc",
] as const;

export type TaskSort = (typeof TASK_SORTS)[number];
export const taskSortSchema = z.enum(TASK_SORTS);

/**
 * Query của task list. Mọi filter đều nằm trong allowlist; không có filter
 * operator, field selector hay sort expression do client dựng.
 *
 * `position` chỉ có nghĩa **trong một column**, nên sort theo position mà không
 * có `columnId` bị từ chối thay vì trả một thứ tự vô nghĩa.
 */
export const listTasksQuerySchema = paginationQuerySchema
  .extend({
    columnId: uuidSchema.optional(),
    assigneeId: uuidSchema.optional(),
    createdById: uuidSchema.optional(),
    reviewerId: uuidSchema.optional(),
    category: taskCategorySchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueState: dueStateSchema.optional(),
    dueFrom: calendarDateSchema.optional(),
    dueTo: calendarDateSchema.optional(),
    sort: taskSortSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((q) => !q.sort?.startsWith("position:") || q.columnId !== undefined, {
    message: "sort theo position yêu cầu columnId, vì position chỉ có nghĩa trong một column.",
    path: ["sort"],
  })
  .refine((q) => !q.dueFrom || !q.dueTo || q.dueFrom <= q.dueTo, {
    message: "dueFrom phải nhỏ hơn hoặc bằng dueTo.",
    path: ["dueFrom"],
  });

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const createTaskRequestSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.nullable().default(null),
    columnId: uuidSchema,
    assigneeId: uuidSchema.nullable().default(null),
    category: taskCategorySchema.nullable().default(null),
    priority: taskPrioritySchema.nullable().default(null),
    startDate: calendarDateSchema.nullable().default(null),
    dueDate: calendarDateSchema.nullable().default(null),
    reviewerId: uuidSchema.nullable().default(null),
    evidenceUrl: evidenceUrlSchema.nullable().default(null),
  })
  .strict()
  .refine((b) => !b.startDate || !b.dueDate || b.startDate <= b.dueDate, {
    message: "startDate phải nhỏ hơn hoặc bằng dueDate.",
    path: ["startDate"],
  });

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/**
 * Update là một patch: bắt buộc có `expectedVersion` và **ít nhất một** field
 * nội dung. Patch rỗng bị từ chối — nó không phải no-op vô hại, nó là dấu hiệu
 * client đang gửi thứ mình không định gửi.
 *
 * `sprintId` (Phase 1.4) và `parentTaskId` (Phase 1.5) **không** có ở đây, dù
 * `taskSchema` vẫn trả `sprintId` (luôn `null` ở MVP). Bất đối xứng đó có chủ ý:
 * giữ chỗ trong **response** là một field chỉ đọc, vô hại; giữ chỗ trong
 * **request** là một lời hứa server không giữ được — cột chưa tồn tại, nên mọi
 * client gửi chúng đều nhận `400`. Một schema nhận field mà server luôn từ chối
 * là một schema nói sai. Thêm lại khi phase bật là additive.
 */
const updateTaskFields = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.nullable(),
    assigneeId: uuidSchema.nullable(),
    category: taskCategorySchema.nullable(),
    priority: taskPrioritySchema.nullable(),
    startDate: calendarDateSchema.nullable(),
    dueDate: calendarDateSchema.nullable(),
    reviewerId: uuidSchema.nullable(),
    evidenceUrl: evidenceUrlSchema.nullable(),
  })
  .partial();

export const updateTaskRequestSchema = updateTaskFields
  .extend({ expectedVersion: versionSchema })
  .strict()
  .refine((b) => Object.keys(b).some((k) => k !== "expectedVersion"), {
    message: "Patch phải có ít nhất một field nội dung ngoài expectedVersion.",
  })
  .refine(
    (b) =>
      b.startDate === undefined ||
      b.dueDate === undefined ||
      b.startDate === null ||
      b.dueDate === null ||
      b.startDate <= b.dueDate,
    { message: "startDate phải nhỏ hơn hoặc bằng dueDate.", path: ["startDate"] },
  );

export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

/**
 * Move là use case riêng, không phải một nhánh của update.
 *
 * `targetPosition` là **gợi ý vị trí**, opaque với client. Theo ADR-0006 mục 1,
 * server tính mọi giá trị `position`; giá trị client gửi chỉ là gợi ý đã được
 * validate lại, và server **bỏ qua** nó khi column đích rỗng — lúc đó không có
 * giá trị nào từng được cấp và không có neighbour nào để chen giữa.
 *
 * Nó luôn là decimal có giới hạn, **không bao giờ** là một SQL expression.
 * Client không hiển thị và không tính toán trên nó.
 *
 * `reviewerId` chỉ được gửi khi column đích có `requiresReviewer`.
 */
export const moveTaskRequestSchema = z
  .object({
    destinationColumnId: uuidSchema,
    targetPosition: positionSchema,
    expectedVersion: versionSchema,
    reviewerId: uuidSchema.optional(),
  })
  .strict();

export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;

export const taskResponseSchema = z
  .object({
    task: taskSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();

export type TaskResponse = z.infer<typeof taskResponseSchema>;
