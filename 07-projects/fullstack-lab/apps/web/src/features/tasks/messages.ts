import type { MessageTable } from "../system/messages.ts";

/**
 * Chữ lỗi của `BRD-01`, `TSK-01`, `TSK-02`, `MYT-01` và `PRJ-04`.
 *
 * Nhiều bảng cho nhiều đường vào, và đó là chủ đích của
 * [ADR-0016](../../../../../docs/decisions/ADR-0016-error-code-is-contract-message-is-ui.md):
 * cùng `NOT_FOUND` nghĩa là "công việc đã bị xoá" khi đang đứng trên board, và
 * nghĩa là "liên kết trỏ tới thứ không còn nữa" khi vừa mở từ một đường dẫn
 * dán vào. Server không biết người dùng đến từ đâu; feature thì biết.
 */

export const TASK_SAVE_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không lưu được công việc này.",
  NOT_FOUND: "Công việc này không còn tồn tại. Hãy mở lại bảng công việc.",
  RATE_LIMITED: "Bạn đã lưu quá nhiều lần trong thời gian ngắn. Hãy chờ một lát.",
  fallback: "Không lưu được công việc. Nội dung bạn nhập vẫn được giữ.",
};

export const COMMENT_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không bình luận được.",
  NOT_FOUND: "Công việc này không còn tồn tại, nên bình luận chưa được gửi.",
  VALIDATION_FAILED: "Bình luận phải có nội dung và không quá 10.000 ký tự.",
  fallback: "Không gửi được bình luận. Nội dung bạn viết vẫn được giữ.",
};

/**
 * `TSK-02` mở từ một **deep link**.
 *
 * Khác `TASK_SAVE_ERROR` ở đúng chỗ ADR-0016 nói tới: ở đây người dùng chưa
 * từng thấy công việc đó, nên "hãy mở lại bảng" là một chỉ dẫn vô nghĩa —
 * điều họ cần biết là chính đường dẫn đã hỏng.
 */
export const TASK_DEEP_LINK_ERROR: MessageTable = {
  FORBIDDEN: "Bạn không có quyền xem công việc này.",
  NOT_FOUND: "Liên kết trỏ tới một công việc không còn tồn tại, hoặc bạn không được xem nó.",
  fallback: "Không mở được công việc từ liên kết này.",
};

/** `MYT-01` — danh sách cắt ngang project, nên chữ nói theo phạm vi đó. */
export const MY_TASKS_ERROR: MessageTable = {
  FORBIDDEN: "Bạn không còn quyền xem danh sách công việc của không gian này.",
  NOT_FOUND: "Không gian làm việc này không còn tồn tại, hoặc bạn không còn là thành viên.",
  fallback: "Không tải được danh sách công việc của bạn.",
};

/** `PRJ-04` — aggregate chỉ đọc. */
export const OVERVIEW_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không xem được tổng quan dự án.",
  NOT_FOUND: "Dự án này không còn tồn tại, hoặc bạn không còn là thành viên.",
  fallback: "Không tải được số liệu tổng quan của dự án.",
};
