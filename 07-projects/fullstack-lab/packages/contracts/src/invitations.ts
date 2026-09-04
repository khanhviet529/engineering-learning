import { z } from "zod";
import { workspaceRoleSchema } from "./capabilities.js";
import { emailSchema, oneTimeTokenSchema } from "./auth.js";
import { instantSchema, userRefSchema, uuidSchema } from "./fields.js";
import { paginationQuerySchema } from "./envelope.js";
import { workspaceSchema } from "./resources.js";

/**
 * Lời mời vào workspace — [ADR-0013](../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Vì sao route nhận **email** chứ không nhận `userId`: bất kỳ ai xác minh email
 * cũng tạo được workspace và trở thành Workspace Admin của nó, nên một endpoint
 * tra cứu người dùng "chỉ dành cho admin" thực chất mở cho mọi người vừa đăng
 * ký — tức là một máy dò tài khoản. Mời theo email không cần biết account có
 * tồn tại, nên không có gì để dò.
 */

/**
 * Response của việc gửi lời mời.
 *
 * **Luôn** như nhau: email đã có account, chưa có account, hay đã là member đều
 * cho đúng body này. Đó là cả lý do phương án này được chọn — ai sở hữu hộp thư
 * sẽ biết chuyện gì xảy ra, người đi dò thì không.
 *
 * Nó dùng lại đúng `acceptedResponseSchema` của `password/forgot` và
 * `verification/resend`, vì cùng một khuôn mẫu chống enumeration.
 */
export const inviteWorkspaceMemberRequestSchema = z
  .object({
    email: emailSchema,
    role: workspaceRoleSchema,
  })
  .strict();

export type InviteWorkspaceMemberRequest = z.infer<typeof inviteWorkspaceMemberRequestSchema>;

/**
 * Một lời mời **đang chờ**.
 *
 * Không có `tokenHash` và không có `status`: danh sách chỉ trả `pending`, nên
 * một cột status chỉ mang đúng một giá trị. Lời mời `accepted` và `revoked` là
 * dữ liệu audit, không phải danh sách để hành động.
 */
export const pendingInvitationSchema = z
  .object({
    id: uuidSchema,
    email: z.email(),
    role: workspaceRoleSchema,
    invitedBy: userRefSchema,
    createdAt: instantSchema,
    expiresAt: instantSchema,
  })
  .strict();

export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

/** Query danh sách lời mời: chỉ `cursor` và `limit`, không filter nào. */
export const listInvitationsQuerySchema = paginationQuerySchema.strict();
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

/**
 * Chấp nhận lời mời.
 *
 * Token là giá trị opaque với client — nó chỉ chuyển tiếp lại thứ nhận được
 * trong thư, đúng như token xác minh email và token reset mật khẩu.
 */
export const acceptInvitationRequestSchema = z.object({ token: oneTimeTokenSchema }).strict();
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/** Chấp nhận thành công trả về workspace vừa tham gia, kèm role và capabilities. */
export const acceptInvitationResponseSchema = z.object({ workspace: workspaceSchema }).strict();

export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
