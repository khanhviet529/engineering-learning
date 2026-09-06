import type { MessageTable } from "../system/messages.ts";
import type { MembershipConflictCode } from "./membership-conflict.tsx";

/** Chữ lỗi của `PRM-01 Thành viên dự án` và của ba xung đột membership. */

export const PROJECT_MEMBER_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không quản lý được thành viên dự án.",
  NOT_FOUND: "Dự án hoặc người này không còn nằm trong phạm vi bạn thấy được.",
  VALIDATION_FAILED: "Kiểm tra lại thông tin bên dưới.",
  fallback: "Không áp dụng được thay đổi thành viên.",
};

/**
 * Chữ lỗi khi **nạp danh sách ứng viên** — một bảng riêng, không dùng chung với
 * `PROJECT_MEMBER_ERROR`.
 *
 * Cùng một `FORBIDDEN` nói hai việc khác nhau ở hai chỗ: ở bảng thành viên nó
 * nghĩa là "bạn không đổi được membership", còn ở đây nghĩa là "bạn không xem
 * được ai có thể thêm vào" — và người đọc đang ở giữa một thao tác thêm người,
 * nên câu chữ phải nói đúng cái họ vừa mất. Đó chính là lý do ADR-0016 để chữ
 * ở feature chứ không ở một catalogue trung tâm theo `code`.
 */
export const MEMBER_CANDIDATES_ERROR: MessageTable = {
  FORBIDDEN: "Vai trò hiện tại của bạn không xem được danh sách ứng viên.",
  NOT_FOUND: "Dự án này không còn nằm trong phạm vi bạn thấy được.",
  fallback: "Không tải được danh sách người có thể thêm vào dự án.",
};

/**
 * Tiêu đề của ba xung đột membership.
 *
 * Trước ADR-0016, tiêu đề ở đây là `failure.message` của server — nó được chọn
 * vì "server đã nói đúng việc cần làm". ADR-0016 đảo lại phân vai đó: chữ hiển
 * thị thuộc frontend, và ba câu dưới đây thay cho ba câu của server.
 *
 * Chúng **không** phải version conflict: tải lại rồi gửi lại không giải quyết
 * gì, người dùng phải đổi thứ tự thao tác. Tiêu đề vì vậy nêu **hiện trạng**,
 * còn việc phải làm trước nằm ở phần mô tả ngay cạnh nó.
 */
export const MEMBERSHIP_CONFLICT_TITLE: Record<MembershipConflictCode, string> = {
  PROJECT_LAST_OWNER: "Dự án sẽ không còn Owner nào",
  MEMBER_HAS_ASSIGNED_TASKS: "Người này vẫn đang được giao việc",
  WORKSPACE_MEMBER_IN_PROJECTS: "Người này vẫn thuộc ít nhất một dự án",
};
