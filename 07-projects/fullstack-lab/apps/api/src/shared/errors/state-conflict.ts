import { AppError } from "./app-error.ts";
import type { ErrorCode } from "@flowboard/contracts";

/**
 * Vi phạm bất biến trạng thái — `409`, không phải `400`.
 *
 * ## Vì sao chúng có code riêng
 *
 * Hợp đồng từng viết `409 CONFLICT` ở bốn chỗ trong khi danh mục error code
 * không có code `CONFLICT` nào. Đó là một lỗ hổng thật, và nó đã được vá ngày
 * 04/09/2026 bằng **bốn code riêng** thay vì một `CONFLICT` chung — vì
 * `api-conventions.md` nói rõ "mỗi invariant nghiệp vụ khác dùng một code
 * riêng", và một code chung buộc client đọc `message` để biết chuyện gì xảy ra,
 * tức là quay lại đúng chỗ mà việc có danh mục sinh ra để tránh.
 *
 * ## Vì sao không dùng lại một code `*_VERSION_CONFLICT`
 *
 * Ba code `409` sẵn có đều là **optimistic concurrency**. Dùng lại một trong số
 * chúng ở đây sẽ nói dối client rằng "tải lại rồi gửi lại sẽ xong", trong khi
 * tải lại không giúp được gì: người dùng phải **đổi thứ tự thao tác** — chỉ định
 * Owner khác, hoặc giao lại công việc — trước khi request này có thể thành công.
 *
 * ## Vì sao không có `details`
 *
 * Danh mục công bố ba code này **không có `details`**. Thông điệp đã nói đủ việc
 * cần làm, và client render nó ở cấp form. Thêm một shape `details` thứ ba chỉ
 * để chỉ vào một field mà người dùng không sửa được bằng cách gõ lại là đổi
 * hình dạng hợp đồng cho một lợi ích không có thật.
 */

/** Ba code thuộc nhóm này ở core MVP; Phase 1.5 thêm `TASK_DEPENDENCY_DUPLICATE`. */
export type StateConflictCode = Extract<
  ErrorCode,
  | "PROJECT_LAST_OWNER"
  | "MEMBER_HAS_ASSIGNED_TASKS"
  | "WORKSPACE_MEMBER_IN_PROJECTS"
  | "TASK_DEPENDENCY_DUPLICATE"
>;

export function stateConflict(code: StateConflictCode, message: string): AppError {
  return new AppError(code, { message });
}
