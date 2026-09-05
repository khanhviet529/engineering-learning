import { z } from "zod";
import { capabilitiesSchema, projectRoleSchema, workspaceRoleSchema } from "./capabilities.js";
import { pageSchema } from "./envelope.js";
import {
  calendarDateSchema,
  dueStateSchema,
  evidenceUrlSchema,
  instantSchema,
  positionSchema,
  taskCategorySchema,
  taskPrioritySchema,
  userRefSchema,
  uuidSchema,
  versionSchema,
} from "./fields.js";

/**
 * Projection của resource — `docs/api/endpoint-contracts.md`, mục "Hình dạng
 * resource trả về".
 *
 * Mỗi response chỉ trả đúng projection mà use case cần. Payload không bao giờ
 * chứa password hash, session ID, CSRF secret, hash của reset/verification
 * token, storage key, audit payload nội bộ, hay dữ liệu của project mà actor
 * không được phép thấy.
 *
 * Mọi schema ở đây là `.strict()`: một field lạ trong response là lỗi hợp đồng,
 * không phải thứ để bỏ qua im lặng.
 */

export const workspaceSchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(1),
    role: workspaceRoleSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();

export type Workspace = z.infer<typeof workspaceSchema>;

export const projectSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string().min(1),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;

/**
 * `requiresReviewer` và `isTerminal` **luôn** có mặt: client cần cái đầu để
 * hiện field reviewer và gửi `reviewerId` khi move, cần cái sau để render
 * affordance hoàn thành và ngữ cảnh mở lại task. Cả hai là điều kiện UI đã nằm
 * trong hợp đồng, không phải cờ do client tự suy.
 */
export const boardColumnSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    name: z.string().min(1),
    requiresReviewer: z.boolean(),
    isTerminal: z.boolean(),
    position: positionSchema,
    archivedAt: instantSchema.nullable(),
  })
  .strict();

export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const taskSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    columnId: uuidSchema,
    createdBy: userRefSchema,
    assigneeId: uuidSchema.nullable(),
    reviewerId: uuidSchema.nullable(),
    title: z.string().min(1),
    description: z.string(),
    // `category` **nullable**: database khai `Null = Yes`, và `other` là một
    // category thật chứ không phải giá trị "chưa đặt" — nên không có giá trị
    // nào trong enum diễn đạt được "bỏ trống". `priority` thì ngược lại:
    // database khai `Null = No` với default `none`, và `none` **là** thành viên
    // của enum, nên projection không nullable là đúng.
    category: taskCategorySchema.nullable(),
    priority: taskPrioritySchema,
    startDate: calendarDateSchema.nullable(),
    dueDate: calendarDateSchema.nullable(),
    dueState: dueStateSchema,
    evidenceUrl: evidenceUrlSchema.nullable(),
    sprintId: uuidSchema.nullable(),
    position: positionSchema,
    version: versionSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();

export type Task = z.infer<typeof taskSchema>;

export const projectMemberSchema = z
  .object({
    userId: uuidSchema,
    displayName: z.string().min(1),
    email: z.email(),
    role: projectRoleSchema,
  })
  .strict();

export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const workspaceMemberSchema = z
  .object({
    userId: uuidSchema,
    displayName: z.string().min(1),
    email: z.email(),
    role: workspaceRoleSchema,
  })
  .strict();

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** Comment là bất biến trong MVP: không có `updatedAt`, không có route sửa hay xoá. */
export const commentSchema = z
  .object({
    id: uuidSchema,
    taskId: uuidSchema,
    author: userRefSchema,
    body: z.string().min(1),
    createdAt: instantSchema,
  })
  .strict();

export type Comment = z.infer<typeof commentSchema>;

/**
 * `summary` do server dựng từ event payload đã allowlist và không chứa secret.
 * Raw `payload` **không bao giờ** đến client.
 */
export const activitySchema = z
  .object({
    id: uuidSchema,
    taskId: uuidSchema.nullable(),
    actor: userRefSchema,
    action: z.string().min(1),
    summary: z.string(),
    createdAt: instantSchema,
  })
  .strict();

export type Activity = z.infer<typeof activitySchema>;

/**
 * Response của project detail và board: gói `project` cùng capabilities do
 * server tính, các column đang active, các member có thể làm assignee, và một
 * trang task có giới hạn theo từng column.
 */
/**
 * Response của `GET /tasks/:taskId`.
 *
 * Trước đây không có schema nào cho nó, nên test conformance phải parse từng
 * mảnh bằng schema rời — tức là hình dạng tổng thể **không** được kiểm, và một
 * field thừa lọt ra ngoài projection sẽ không ai thấy. Backend báo chỗ thiếu
 * này khi dựng M4.
 *
 * `comments` là trang **đầu**; các trang sau đi qua chính use case list comment
 * với cursor, cùng lối `columns` và load-more của board.
 */
export const taskDetailSchema = z
  .object({
    task: taskSchema,
    comments: z.object({ items: z.array(commentSchema), page: pageSchema }).strict(),
    capabilities: capabilitiesSchema,
  })
  .strict();

export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const projectDetailSchema = z
  .object({
    project: projectSchema,
    capabilities: capabilitiesSchema,
    columns: z.array(boardColumnSchema),
    members: z.array(projectMemberSchema),
  })
  .strict();

export type ProjectDetail = z.infer<typeof projectDetailSchema>;
