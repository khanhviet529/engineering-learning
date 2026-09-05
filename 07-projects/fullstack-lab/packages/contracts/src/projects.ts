import { z } from "zod";
import { capabilitiesSchema, projectRoleSchema } from "./capabilities.js";
import { paginationQuerySchema } from "./envelope.js";
import { calendarDateSchema, userRefSchema, uuidSchema } from "./fields.js";
import { projectMemberSchema, projectSchema } from "./resources.js";

/**
 * Use case cấp project — `docs/api/endpoint-contracts.md`, mục "Projects và
 * project members".
 *
 * MVP chỉ cho đổi **tên** project. Không có description, visibility, archive
 * hay delete: mỗi thứ đó là một quyết định sản phẩm riêng chưa được chốt, và
 * thêm chúng vào schema "cho tiện" là cách hợp thức hoá một field chưa ai duyệt.
 */

export const projectNameSchema = z.string().trim().min(1).max(120);

/**
 * Query của `GET /workspaces/:workspaceId/projects`.
 *
 * Chỉ `cursor` và `limit`. Không filter, không sort do client chọn: danh sách
 * này đã bị giới hạn theo membership của actor, và mở thêm trục lọc ở đây là mở
 * thêm cách để dò xem project nào tồn tại.
 */
export const listProjectsQuerySchema = paginationQuerySchema.strict();
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/**
 * Một dòng trong danh sách project.
 *
 * Có `role` của actor để UI biết ngay cần render affordance nào, nhưng **không**
 * có count thành viên hay count task: không projection nào công bố chúng, và
 * suy ra chúng từ dữ liệu actor không được đọc chính là cách rò rỉ.
 */
export const projectListItemSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string().min(1),
    role: projectRoleSchema,
    createdAt: z.iso.datetime({ offset: false }),
    updatedAt: z.iso.datetime({ offset: false }),
  })
  .strict();

export type ProjectListItem = z.infer<typeof projectListItemSchema>;

export const createProjectRequestSchema = z.object({ name: projectNameSchema }).strict();
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const renameProjectRequestSchema = z.object({ name: projectNameSchema }).strict();
export type RenameProjectRequest = z.infer<typeof renameProjectRequestSchema>;

/** Mọi response project đi kèm capabilities do server tính cho chính actor đó. */
export const projectResponseSchema = z
  .object({
    project: projectSchema,
    capabilities: capabilitiesSchema,
  })
  .strict();

export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const addProjectMemberRequestSchema = z
  .object({
    userId: uuidSchema,
    role: projectRoleSchema,
  })
  .strict();

export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequestSchema>;

export const changeProjectMemberRoleRequestSchema = z.object({ role: projectRoleSchema }).strict();

export type ChangeProjectMemberRoleRequest = z.infer<typeof changeProjectMemberRoleRequestSchema>;

export const projectMemberResponseSchema = z.object({ member: projectMemberSchema }).strict();
export type ProjectMemberResponse = z.infer<typeof projectMemberResponseSchema>;

/**
 * Aggregate của `PRJ-04` — `GET /projects/:projectId/overview`.
 *
 * **Server trả số đếm, client tính phần trăm.** Trả cả hai là hai nguồn cho
 * cùng một sự thật, và chúng lệch nhau ở lần làm tròn đầu tiên.
 *
 * Không có `page`: kết quả bị chặn bởi số column và số member của **một**
 * project. Không có delta tuần-so-tuần và không có "đang bị chặn" — cả hai cần
 * thứ MVP không có, lý do ghi ở hợp đồng endpoint.
 */
export const overviewWindowSchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema })
  .strict();

export const overviewColumnSchema = z
  .object({
    columnId: uuidSchema,
    name: z.string().min(1),
    /** Đi kèm để client **không** phải đoán cột nào là "đã xong" từ tên cột. */
    isTerminal: z.boolean(),
    taskCount: z.int().nonnegative(),
  })
  .strict();

export const overviewAssigneeSchema = z
  .object({ user: userRefSchema, taskCount: z.int().nonnegative() })
  .strict();

export const projectOverviewSchema = z
  .object({
    window: overviewWindowSchema,
    totals: z
      .object({
        tasks: z.int().nonnegative(),
        /** Chỉ cần `tasks.created_at`; không cần lịch sử nào. */
        createdInWindow: z.int().nonnegative(),
      })
      .strict(),
    /** Chỉ column active, giữ nguyên thứ tự `position` của board. */
    byColumn: z.array(overviewColumnSchema),
    byAssignee: z.array(overviewAssigneeSchema),
    /**
     * Tách khỏi `byAssignee` thay vì để một phần tử `user: null`: một danh sách
     * người mà một phần tử không phải người là chỗ mọi client phải viết một
     * nhánh đặc biệt.
     */
    unassignedCount: z.int().nonnegative(),
    /** Cùng `WorkspaceClock` và cùng `DUE_SOON_WINDOW_DAYS` với list task. */
    dueStates: z
      .object({
        overdue: z.int().nonnegative(),
        dueToday: z.int().nonnegative(),
        dueSoon: z.int().nonnegative(),
        none: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const overviewQuerySchema = z
  .object({ from: calendarDateSchema.optional(), to: calendarDateSchema.optional() })
  .strict();

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
