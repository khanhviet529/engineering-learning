import { z } from "zod";
import { capabilitiesSchema, projectRoleSchema } from "./capabilities.js";
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
