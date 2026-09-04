import type { Transaction } from "../../../shared/database/client.ts";

/**
 * Cổng ghi activity — [ADR-0005](../../../../../docs/decisions/ADR-0005-module-dependency-and-activity-boundary.md).
 *
 * `activity` là **leaf** của đồ thị phụ thuộc: nó sở hữu bảng `activity_logs`,
 * không import module nào, và mọi module mutation ghi qua đúng một port này.
 * Không module nào `INSERT` thẳng vào bảng — nếu có, tên event và hình dạng
 * payload sẽ trôi theo từng chỗ gọi, và không còn ai nói được audit trail chứa
 * những gì.
 *
 * ## Vì sao `record` nhận `tx` chứ không tự mở transaction
 *
 * Row activity và mutation nó mô tả phải **cùng commit hoặc cùng rollback**.
 * Một recorder tự mở transaction riêng sẽ tạo ra hai chế độ hỏng thật:
 *
 * - mutation rollback nhưng activity đã ghi ⇒ lịch sử kể một việc chưa xảy ra;
 * - activity hỏng nhưng mutation đã commit ⇒ một thay đổi không có dấu vết.
 *
 * Nhận transaction đang mở làm cả hai bất khả thi, và đó là lý do chữ ký này
 * **không** có biến thể tiện tay nào nhận `Database`.
 */

/**
 * Tên event được phép ghi.
 *
 * Union đóng, không phải `string`. `action` không bao giờ đến từ client, và
 * kiểu ở đây là lớp chặn đầu tiên: thêm một event mới buộc phải sửa danh sách
 * này, tức là phải đi qua review.
 *
 * Module mutation vẫn sở hữu **ngữ nghĩa** event của mình; danh sách này chỉ
 * nói event nào tồn tại.
 */
export const ACTIVITY_ACTIONS = [
  // Nợ của M2, trả ở M3.
  "project.created",
  "project.updated",
  "project_member.added",
  "project_member.role_changed",
  "project_member.removed",

  // M3.
  "board_column.created",
  "board_column.renamed",
  "board_column.terminal_changed",
  "board_column.reviewer_requirement_changed",
  "board_column.archived",
  "board_column.reordered",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEvent {
  projectId: string;
  actorUserId: string;
  action: ActivityAction;
  /**
   * Context có cấu trúc, **non-secret**.
   *
   * Không token, không hash, không password, không email của người chưa là
   * người dùng. `summary` mà client đọc được do server dựng từ đây; raw payload
   * không bao giờ ra khỏi server.
   */
  payload?: Record<string, unknown>;
  /** `null` cho mọi event của M3; M4 mới có event gắn task. */
  taskId?: string | null;
}

export interface ActivityRecorder {
  record(tx: Transaction, event: ActivityEvent): Promise<void>;
}
