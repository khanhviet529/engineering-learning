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

/** Chữ cho một `ApiFailure`, theo bảng của feature đang gọi. */
export function messageFor(table: MessageTable, failure: ApiFailure): string {
  return table[failure.code] ?? table.fallback;
}
