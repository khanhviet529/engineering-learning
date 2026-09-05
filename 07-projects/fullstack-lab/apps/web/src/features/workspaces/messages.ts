import type { MessageTable } from "../system/messages.ts";

/** Chữ lỗi của `WSP-02`, `WSP-03` và khối lời mời đang chờ trong đó. */

export const WORKSPACE_CREATE_ERROR: MessageTable = {
  // Không có capability nào để ẩn CTA trước, nên `403` ở đây là một câu trả
  // lời bình thường của route và nó phải nói được thành lời.
  FORBIDDEN: "Tài khoản của bạn chưa được phép tạo không gian làm việc mới.",
  RATE_LIMITED: "Bạn đã tạo quá nhiều không gian trong thời gian ngắn. Hãy chờ một lát.",
  fallback: "Không tạo được không gian làm việc. Hãy thử lại.",
};

export const WORKSPACE_INVITE_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không mời được người vào không gian này.",
  NOT_FOUND: "Không gian làm việc này không còn tồn tại.",
  RATE_LIMITED: "Bạn đã gửi quá nhiều lời mời trong thời gian ngắn. Hãy chờ một lát.",
  fallback: "Không gửi được lời mời. Hãy thử lại.",
};

export const INVITATION_REVOKE_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không thu hồi được lời mời.",
  // `404` ở route này gộp cả "không tồn tại", "thuộc workspace khác" và "đã
  // được chấp nhận hoặc thu hồi rồi" — cố ý, để không lộ trạng thái của một
  // lời mời mà người gọi không có quyền biết. Câu chữ vì vậy cũng không đoán.
  NOT_FOUND: "Lời mời này không còn trong danh sách chờ.",
  fallback: "Không thu hồi được lời mời. Hãy thử lại.",
};

export const WORKSPACE_MEMBER_REMOVE_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không gỡ được thành viên.",
  NOT_FOUND: "Người này không còn là thành viên của không gian.",
  fallback: "Không gỡ được thành viên khỏi không gian.",
};
