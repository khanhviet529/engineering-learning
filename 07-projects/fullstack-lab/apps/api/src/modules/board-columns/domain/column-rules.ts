import { AppError, validationError } from "../../../shared/errors/app-error.ts";

/**
 * Bất biến của board column.
 *
 * Hàm thuần, không I/O. Ba trong số chúng nói về **điều không được làm**, và cả
 * ba đều dễ bị "sửa" thành hồi tố vì hồi tố nghe có lý hơn — xem từng chỗ.
 */

/**
 * Archive chỉ được phép khi cột **không còn task**.
 *
 * API **không** tự dời task đi đâu cả. Hợp đồng nói rõ: `409 COLUMN_NOT_EMPTY`,
 * và MVP không move/delete task. Dời hộ là âm thầm đổi chỗ công việc của người
 * khác như một tác dụng phụ của thao tác cấu hình — đúng loại thay đổi phải do
 * người dùng chủ động làm.
 */
export function assertColumnEmpty(hasTasks: boolean): void {
  if (hasTasks) {
    throw new AppError("COLUMN_NOT_EMPTY", {
      message:
        "Cột vẫn còn công việc. Hãy di chuyển hết công việc sang cột khác trước khi lưu trữ.",
    });
  }
}

/**
 * Archive là transition **một chiều** của MVP.
 *
 * Cột đã archive không nhận task mới, không nhận move, và không unarchive được
 * — unarchive chưa là core behavior đã được định nghĩa. Archive lần hai vì vậy
 * là thao tác trên một cột không còn ở trạng thái nhận được lệnh đó.
 */
export function assertNotArchived(archivedAt: Date | null): void {
  if (archivedAt !== null) {
    throw validationError([
      {
        field: "archive",
        code: "already_archived",
        message: "Cột này đã được lưu trữ.",
      },
    ]);
  }
}

/**
 * `afterColumnId` phải là một cột **active, cùng project**.
 *
 * Nó là một *gợi ý vị trí* do client gửi, không phải một bằng chứng gì cả:
 * server validate lại rồi tự tính position. Một ID thuộc project khác mà lọt
 * qua đây sẽ đặt cột mới vào giữa dãy position của project khác — và unique
 * constraint sẽ không bắt được, vì nó scope theo `project_id`.
 */
export function assertValidAnchor(found: boolean): void {
  if (!found) {
    throw validationError([
      {
        field: "afterColumnId",
        code: "invalid_anchor",
        message: "Cột được chọn làm mốc không tồn tại hoặc đã được lưu trữ.",
      },
    ]);
  }
}

/**
 * Reorder phải nhận **đúng** tập active column của project.
 *
 * Thiếu một ID, thừa một ID, hay một ID của project khác đều bị từ chối. Lý do
 * không nhận danh sách con: server sẽ phải **đoán** vị trí cho các cột vắng
 * mặt, và mọi cách đoán đều là một quyết định sản phẩm không ai duyệt.
 *
 * Thông điệp cố ý **không** liệt kê ID nào thiếu hay thừa: với một ID thuộc
 * project khác, câu trả lời chi tiết sẽ xác nhận ID đó có thật.
 */
export function assertCompleteReorder(input: {
  submitted: readonly string[];
  activeIds: readonly string[];
}): void {
  const submitted = new Set(input.submitted);
  const active = new Set(input.activeIds);

  const complete =
    submitted.size === input.submitted.length &&
    submitted.size === active.size &&
    [...active].every((id) => submitted.has(id));

  if (!complete) {
    throw validationError([
      {
        field: "orderedColumnIds",
        code: "incomplete_order",
        message: "Danh sách phải chứa đúng toàn bộ cột đang hoạt động của dự án, mỗi cột một lần.",
      },
    ]);
  }
}
