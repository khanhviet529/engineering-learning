import type { ErrorCode } from "@flowboard/contracts";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * Khuôn để mỗi feature tự viết chữ lỗi của mình.
 *
 * [ADR-0016](../../../../../docs/decisions/ADR-0016-error-code-is-contract-message-is-ui.md):
 * `code` là hợp đồng, `message` là **chẩn đoán**. Frontend không render
 * `failure.message` cho người dùng — nó dành cho log và cho `requestId` khi
 * truy vết.
 *
 * Đây **không** phải một catalogue trung tâm `code → chữ`. Nó chỉ là kiểu và
 * phép tra; bảng chữ sống trong `features/x/messages.ts` của từng feature, vì
 * cùng một `NOT_FOUND` phải nói khác nhau ở board và ở lời mời. Khoá chọn chữ
 * là **màn hình**, không phải loại resource — và feature đã biết mình là màn
 * nào mà không cần ai gửi kèm thông tin đó.
 */

/**
 * Một bảng chữ: vài code có câu riêng, cộng **một** câu bắt buộc cho phần còn
 * lại.
 *
 * `fallback` không optional, và đó là điểm chính: 28 code là một danh mục đóng
 * nhưng vẫn dài, và một bảng thiếu nhánh mặc định sẽ hiện ra chuỗi rỗng đúng
 * vào lúc gặp code mà không ai lường trước.
 */
export type MessageTable = Partial<Record<ErrorCode, string>> & { fallback: string };

/**
 * Câu duy nhất cho **một lần không nhận được câu trả lời nào**.
 *
 * `Transport.request` đặt `status: 0` khi chính `fetch` ném — mạng đứt, CORS
 * chặn, server đóng kết nối. Nó cũng đặt `code: "INTERNAL_ERROR"`, vì hợp đồng
 * là một danh mục đóng và không có mã nào cho "chưa có câu trả lời". Hệ quả:
 * nếu chỉ tra theo `code`, một lần mất kết nối rơi vào `fallback` của feature,
 * và mọi `fallback` đều kết bằng "Hãy thử lại".
 *
 * Với một lệnh **ghi**, đó là lời khuyên sai. Đo được ở M5.5: chặn response của
 * `POST /workspaces` sau khi server đã ghi xong, giao diện nói "Không tạo được
 * không gian làm việc. Hãy thử lại." — trong khi không gian **đã** tồn tại.
 * Người dùng bấm lại và tin rằng lần đầu không tính.
 *
 * Vì sao rẽ theo `status` chứ không theo `code`: `status: 0` không phải một
 * status HTTP mà server trả về, nó là **dấu hiệu không có phản hồi** do chính
 * tầng transport đặt. Rẽ theo nó không vi phạm quy tắc "không rẽ nhánh theo
 * HTTP status" — quy tắc đó nói về câu trả lời của server, và ở đây không có
 * câu trả lời nào.
 */
export const NO_RESPONSE =
  "Không nhận được phản hồi từ máy chủ. Nếu bạn vừa gửi một thay đổi, nó có thể đã được ghi — hãy tải lại để xem trước khi gửi lại.";

/** Chữ cho một `ApiFailure`, theo bảng của feature đang gọi. */
export function messageFor(table: MessageTable, failure: ApiFailure): string {
  if (failure.status === 0) return NO_RESPONSE;
  return table[failure.code] ?? table.fallback;
}
