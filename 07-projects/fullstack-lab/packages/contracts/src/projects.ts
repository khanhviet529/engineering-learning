import { z } from "zod";
import { capabilitiesSchema, projectRoleSchema } from "./capabilities.js";
import { paginationQuerySchema } from "./envelope.js";
import { uuidSchema } from "./fields.js";
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
