import { AppError, validationError } from "../../../shared/errors/app-error.ts";

/**
 * Quy tắc miền của lời mời workspace — [ADR-0013](../../../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Hàm thuần, không I/O. Chúng ở `domain/` vì đây là quy tắc nghiệp vụ có hệ quả
 * bảo mật thật, không phải chi tiết điều phối.
 */

/** Lời mời hết hạn sau 7 ngày, theo ADR-0013 và thiết kế database. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function invitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

/**
 * Một lỗi **duy nhất** cho mọi lý do token không dùng được.
 *
 * Token không tồn tại, hết hạn, đã dùng, đã bị thu hồi — cả bốn cho ra **cùng
 * một** `400 VALIDATION_FAILED`, cùng `code`, cùng `message`, giống nhau từng
 * byte.
 *
 * Vì sao không phân biệt: mỗi nhánh riêng là một câu trả lời cho "token này
 * từng tồn tại chưa?". Một người đang thử token ngẫu nhiên mà nhận được "đã hết
 * hạn" thay vì "không hợp lệ" vừa học được rằng họ đoán trúng một token thật —
 * và biết token nào từng thật là bước đầu của việc đoán token kế tiếp.
 *
 * Hàm này là **chỗ duy nhất** dựng lỗi đó, nên bốn nhánh không thể trôi ra khác
 * nhau theo thời gian.
 */
export function invalidInvitationToken(): AppError {
  return validationError([
    {
      field: "token",
      code: "invalid_invitation",
      message: "Lời mời không hợp lệ hoặc đã hết hiệu lực. Hãy yêu cầu một lời mời mới.",
    },
  ]);
}

/**
 * Actor đăng nhập bằng email khác email được mời.
 *
 * Đây là **ngoại lệ có chủ ý** của quy tắc "đừng phân biệt các nhánh lỗi", và
 * lý do khá hẹp: actor đang **giữ token lấy từ chính hộp thư đó**, nên họ đã
 * biết địa chỉ được mời. Nói mơ hồ ở đây không giấu được gì với họ; nó chỉ làm
 * họ không biết phải đăng nhập bằng tài khoản nào.
 *
 * Thông điệp vì vậy nói rõ **việc phải làm**, nhưng vẫn **không** nhắc lại địa
 * chỉ được mời: người đang cầm token đã biết nó, còn nếu token rơi vào tay
 * người khác thì response này không được là chỗ họ đọc ra địa chỉ đó.
 */
export function invitationEmailMismatch(): AppError {
  return new AppError("FORBIDDEN", {
    message:
      "Lời mời này thuộc về một địa chỉ email khác. " +
      "Hãy đăng nhập bằng đúng tài khoản đã nhận thư mời rồi thử lại.",
  });
}

/**
 * Chuẩn hoá email trước khi so sánh và trước khi lưu.
 *
 * Cùng một phép chuẩn hoá phải chạy ở **mọi** đường: lúc tạo lời mời, lúc so
 * với email của actor, và lúc kiểm trùng ở partial unique index. Lệch một chỗ
 * thì `A@x.test` và `a@x.test` trở thành hai lời mời khác nhau cho cùng một
 * người — và index chống trùng mất tác dụng đúng lúc cần nhất.
 */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
