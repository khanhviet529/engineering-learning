import { z } from "zod";

/**
 * Kiểu field dùng chung — `docs/api/api-conventions.md`, mục "JSON, tên field và
 * thời gian".
 *
 * Field trong API là `camelCase`; `snake_case` của database không lộ ra hợp đồng.
 */

export const uuidSchema = z.uuid();

/** Instant: chuỗi RFC 3339 ở UTC, ví dụ `2026-09-01T08:30:00Z`. */
export const instantSchema = z.iso.datetime({ offset: false });

/**
 * `dueDate` và `startDate` là ngày theo timezone của workspace, **không có
 * time-of-day**. Vì vậy chúng là `YYYY-MM-DD`, không phải instant.
 */
export const calendarDateSchema = z.iso.date();

/**
 * `position` là giá trị ordering **opaque đối với client**: server trả về dạng
 * chuỗi thập phân của `numeric(20,10)` để không mất chính xác khi đi qua
 * JSON number. Client chỉ chuyển tiếp lại giá trị này, không tự tính toán trên nó.
 */
export const positionSchema = z.string().regex(/^\d+(\.\d+)?$/);

/** Optimistic concurrency: version luôn là số nguyên dương, bắt đầu từ 1. */
export const versionSchema = z.int().positive();

/** Sáu category của Task, đúng theo `CHECK` trong schema database. */
export const TASK_CATEGORIES = [
  "feature",
  "bug",
  "design",
  "research",
  "operations",
  "other",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const taskCategorySchema = z.enum(TASK_CATEGORIES);

/** Năm mức ưu tiên của Task. */
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

/**
 * `dueState` là enum **server-derived**: client đọc để render và để lọc, nhưng
 * không bao giờ gửi nó trong mutation. Khi task nằm ở column `isTerminal`,
 * `dueState` là `none` — trạng thái hoàn thành là thuộc tính của **cột**, không
 * phải một giá trị `dueState` thứ sáu.
 */
export const DUE_STATES = ["none", "scheduled", "due_soon", "due_today", "overdue"] as const;
export type DueState = (typeof DUE_STATES)[number];
export const dueStateSchema = z.enum(DUE_STATES);

/**
 * `evidenceUrl` phải là URL tuyệt đối scheme `https`, tối đa 2048 ký tự.
 * `http`, `javascript:`, `data:`, `file:` và URL quá dài đều là
 * `400 VALIDATION_FAILED` — đây là ranh giới bảo mật, không phải sở thích.
 */
export const EVIDENCE_URL_MAX_LENGTH = 2048;

export const evidenceUrlSchema = z.url({ protocol: /^https$/ }).max(EVIDENCE_URL_MAX_LENGTH);

/** Tham chiếu người dùng rút gọn, dùng trong `createdBy`, `author` và `actor`. */
export const userRefSchema = z
  .object({
    id: uuidSchema,
    displayName: z.string().min(1),
  })
  .strict();

export type UserRef = z.infer<typeof userRefSchema>;
