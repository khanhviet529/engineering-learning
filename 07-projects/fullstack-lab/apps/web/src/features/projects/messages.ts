import type { MessageTable } from "../system/messages.ts";

/** Chữ lỗi của `PRJ-02 Tạo dự án` và `PRJ-03 Cài đặt dự án`. */

export const PROJECT_CREATE_ERROR: MessageTable = {
  FORBIDDEN: "Chỉ Quản trị viên không gian mới tạo được dự án ở đây.",
  NOT_FOUND: "Không gian làm việc này không còn tồn tại.",
  RATE_LIMITED: "Bạn đã tạo quá nhiều dự án trong thời gian ngắn. Hãy chờ một lát.",
  fallback: "Không tạo được dự án. Hãy thử lại.",
};

export const PROJECT_RENAME_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không đổi được tên dự án.",
  NOT_FOUND: "Dự án này không còn tồn tại.",
  fallback: "Không lưu được tên dự án. Tên bạn nhập vẫn được giữ nguyên.",
};
