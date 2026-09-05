import type { MessageTable } from "../system/messages.ts";

/**
 * Chữ lỗi của `BRD-02 Quản lý cột`.
 *
 * Ba bảng vì ba thao tác có **hệ quả khác nhau** khi hỏng: thứ tự là một bản
 * nháp cục bộ nên hỏng là mất bản nháp; một lệnh trên hàng thì không mất gì;
 * và thêm cột thì chưa có gì để mất.
 */

export const COLUMN_REORDER_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không sắp lại được thứ tự cột.",
  NOT_FOUND: "Dự án hoặc một cột trong danh sách không còn tồn tại.",
  VALIDATION_FAILED: "Danh sách cột gửi đi không còn khớp với dự án. Hãy mở lại bảng công việc.",
  fallback: "Không lưu được thứ tự cột.",
};

export const COLUMN_COMMAND_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không đổi được cột này.",
  NOT_FOUND: "Cột này không còn tồn tại. Hãy mở lại bảng công việc.",
  fallback: "Không áp dụng được thay đổi cho cột này.",
};

export const COLUMN_CREATE_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không thêm được cột.",
  NOT_FOUND: "Dự án này không còn tồn tại.",
  fallback: "Không thêm được cột mới.",
};
