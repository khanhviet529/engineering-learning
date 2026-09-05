import type { MessageTable } from "../system/messages.ts";

/**
 * Chữ lỗi của năm màn xác thực.
 *
 * Theo [ADR-0016](../../../../../docs/decisions/ADR-0016-error-code-is-contract-message-is-ui.md),
 * server trả `code`, frontend viết câu. Ở nhóm này có một ràng buộc riêng đè
 * lên mọi câu chữ: **không được nói account có tồn tại hay không.** Vì vậy
 * `UNAUTHENTICATED` ở màn đăng nhập nói "email hoặc mật khẩu" chứ không nói
 * cái nào sai, và quên mật khẩu không có nhánh "email này chưa đăng ký".
 */

export const SIGN_IN_ERROR: MessageTable = {
  UNAUTHENTICATED: "Email hoặc mật khẩu không đúng.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  INTERNAL_ERROR: "Không đăng nhập được vào lúc này. Hãy thử lại sau ít phút.",
  VALIDATION_FAILED: "Kiểm tra lại email và mật khẩu bên dưới.",
  fallback: "Không đăng nhập được. Hãy thử lại.",
};

export const SIGN_UP_ERROR: MessageTable = {
  // Cố ý **không** nói "email đã được dùng": đó là một máy dò tài khoản.
  VALIDATION_FAILED: "Kiểm tra lại thông tin bên dưới.",
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  INTERNAL_ERROR: "Không tạo được tài khoản vào lúc này. Hãy thử lại sau ít phút.",
  fallback: "Không tạo được tài khoản. Hãy thử lại.",
};

export const FORGOT_PASSWORD_ERROR: MessageTable = {
  VALIDATION_FAILED: "Địa chỉ email không hợp lệ.",
  RATE_LIMITED: "Bạn đã yêu cầu quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  fallback: "Không gửi được yêu cầu đặt lại mật khẩu. Hãy thử lại.",
};

export const RESET_PASSWORD_ERROR: MessageTable = {
  RATE_LIMITED: "Bạn đã thử quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  fallback: "Không đặt lại được mật khẩu. Hãy yêu cầu một liên kết mới.",
};

export const VERIFY_EMAIL_ERROR: MessageTable = {
  // Token hỏng, hết hạn hay đã dùng đều là **một** câu: phân biệt chúng cho
  // người đang thử token biết token nào từng tồn tại.
  VALIDATION_FAILED: "Liên kết không hợp lệ hoặc đã hết hạn.",
  RATE_LIMITED: "Bạn đã yêu cầu quá nhiều lần. Hãy chờ một lát rồi thử lại.",
  fallback: "Liên kết không hợp lệ hoặc đã hết hạn.",
};
