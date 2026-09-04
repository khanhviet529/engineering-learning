import { z } from "zod";
import { commentSchema } from "./resources.js";

/**
 * Use case comment — `docs/api/endpoint-contracts.md`, mục "Comments và
 * activity".
 *
 * `body` là **plain text bất biến**: server lưu đúng những gì người dùng gõ,
 * không normalize, không sanitize-rồi-lưu. Việc render Markdown là quyết định
 * của **client**, theo allowlist tường minh trong quy ước frontend — bold,
 * italic, inline code, code block, list, link — với raw HTML tắt tuyệt đối.
 *
 * Hệ quả có chủ ý: một client không render Markdown sẽ hiển thị ký tự cú pháp.
 * Đó là mức xuống cấp chấp nhận được, đổi lại nội dung gốc không bao giờ bị
 * biến đổi ở tầng lưu trữ.
 *
 * MVP không có route sửa hay xoá comment, nên projection cũng không có
 * `updatedAt`.
 */

export const COMMENT_BODY_MAX_LENGTH = 10_000;

export const commentBodySchema = z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH);

export const createCommentRequestSchema = z.object({ body: commentBodySchema }).strict();
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentResponseSchema = z.object({ comment: commentSchema }).strict();
export type CommentResponse = z.infer<typeof commentResponseSchema>;
