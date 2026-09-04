import { z } from "zod";
import { workspaceRoleSchema } from "./capabilities.js";
import { instantSchema, uuidSchema } from "./fields.js";
import { workspaceSchema } from "./resources.js";

/**
 * Use case cấp workspace — `docs/api/endpoint-contracts.md`, mục "Workspaces và
 * workspace members".
 *
 * Điều dễ hiểu nhầm nhất ở tầng này: khả năng cấp workspace **không** hàm ý bất
 * kỳ quyền nào trong project. Một Workspace Admin chưa có `project_members` row
 * vẫn nhận `404` trên project riêng tư — chứ không phải `403`, vì `403` đã là
 * một lời xác nhận rằng project đó tồn tại.
 */

export const workspaceNameSchema = z.string().trim().min(1).max(120);

export const createWorkspaceRequestSchema = z.object({ name: workspaceNameSchema }).strict();
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

/** Projection member workspace, kèm `createdAt` như hợp đồng công bố. */
export const workspaceMemberListItemSchema = z
  .object({
    userId: uuidSchema,
    displayName: z.string().min(1),
    email: z.email(),
    role: workspaceRoleSchema,
    createdAt: instantSchema,
  })
  .strict();

export type WorkspaceMemberListItem = z.infer<typeof workspaceMemberListItemSchema>;

export const addWorkspaceMemberRequestSchema = z
  .object({
    userId: uuidSchema,
    role: workspaceRoleSchema,
  })
  .strict();

export type AddWorkspaceMemberRequest = z.infer<typeof addWorkspaceMemberRequestSchema>;

export const workspaceResponseSchema = z.object({ workspace: workspaceSchema }).strict();
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
