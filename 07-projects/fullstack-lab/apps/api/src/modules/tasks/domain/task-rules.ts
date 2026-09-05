import { AppError, validationError } from "../../../shared/errors/app-error.ts";

/**
 * Bất biến của Task.
 *
 * Hàm thuần, không I/O. Mỗi hàm nhận **kết quả** của một phép đọc chứ không tự
 * đọc: nhờ vậy chúng kiểm được đầy đủ ở lớp unit, và use case là chỗ duy nhất
 * quyết định phép đọc nào chạy trong transaction nào.
 */

/**
 * `409 TASK_VERSION_CONFLICT` — **kèm `currentVersion`**.
 *
 * Con số đó không phải trang trí: client dùng nó để hiện đường "xem lại dữ liệu
 * hiện tại" thay vì hỏi người dùng thử lại một cách mù. Danh mục error code
 * công bố `TASK_VERSION_CONFLICT` là **một trong hai** code duy nhất được mang
 * `details`, và `details` của nó là object `{ currentVersion }`, không phải
 * field-error array.
 */
export function versionConflict(currentVersion: number): AppError {
  return new AppError("TASK_VERSION_CONFLICT", {
    message:
      "Công việc đã được người khác cập nhật. Hãy tải lại để xem thay đổi mới nhất trước khi lưu.",
    details: { currentVersion },
  });
}

/**
 * Cột đích phải **active và cùng project**.
 *
 * Cột đã archive không nhận task mới và không nhận move: archive là transition
 * một chiều của MVP, và một cột đã archive vẫn nhận task sẽ làm chính khái niệm
 * archive vô nghĩa.
 *
 * Cột của project khác thì `400` chứ không `404`: người gọi **đã** được
 * authorize trên project này, nên câu trả lời không tiết lộ gì về sự tồn tại
 * của cột kia — nó chỉ nói input sai.
 */
export function assertUsableColumn(column: { archivedAt: Date | null } | undefined): void {
  if (column === undefined) {
    throw validationError([
      {
        field: "columnId",
        code: "unknown_column",
        message: "Cột được chọn không tồn tại trong dự án này.",
      },
    ]);
  }
  if (column.archivedAt !== null) {
    throw validationError([
      {
        field: "columnId",
        code: "column_archived",
        message: "Cột này đã được lưu trữ nên không nhận thêm công việc.",
      },
    ]);
  }
}

/** Assignee, nếu có, phải là ProjectMember **cùng project**. */
export function assertAssigneeIsMember(isMember: boolean): void {
  if (!isMember) {
    throw validationError([
      {
        field: "assigneeId",
        code: "not_project_member",
        message: "Người được giao việc phải là thành viên của dự án.",
      },
    ]);
  }
}

export function assertReviewerIsMember(isMember: boolean): void {
  if (!isMember) {
    throw validationError([
      {
        field: "reviewerId",
        code: "not_project_member",
        message: "Người duyệt phải là thành viên của dự án.",
      },
    ]);
  }
}

/**
 * Reviewer phải **khác** assignee.
 *
 * Một người tự duyệt việc của mình thì bước duyệt không còn là một bước — nó
 * chỉ là một field. Database cũng cưỡng chế điều này bằng `CHECK`; ở đây là
 * tầng cho ra `400` đọc được thay vì một lỗi constraint.
 */
export function assertReviewerNotAssignee(input: {
  assigneeId: string | null;
  reviewerId: string | null;
}): void {
  if (
    input.reviewerId !== null &&
    input.assigneeId !== null &&
    input.reviewerId === input.assigneeId
  ) {
    throw validationError([
      {
        field: "reviewerId",
        code: "reviewer_is_assignee",
        message: "Người duyệt phải khác người thực hiện.",
      },
    ]);
  }
}

/**
 * Cột yêu cầu reviewer thì task **không được** vào đó mà thiếu reviewer.
 *
 * Luật này chỉ áp cho create và move **từ thời điểm cờ được bật** — nó **không
 * hồi tố** lên task đã nằm sẵn trong cột (M3 đã chốt, ADR-0009 nhắc lại). Đó là
 * lý do phép kiểm nằm ở đường create/move chứ không ở một job quét bảng.
 */
export function assertReviewerWhenColumnRequires(input: {
  columnRequiresReviewer: boolean;
  reviewerId: string | null;
}): void {
  if (input.columnRequiresReviewer && input.reviewerId === null) {
    throw validationError([
      {
        field: "reviewerId",
        code: "reviewer_required",
        message: "Cột này yêu cầu người duyệt. Hãy chọn một thành viên khác người thực hiện.",
      },
    ]);
  }
}

/**
 * `reviewerId` chỉ được **gửi** khi cột đích yêu cầu reviewer.
 *
 * Hợp đồng move nói rõ: *"`reviewerId` chỉ được gửi/khi cần nếu destination
 * column có `requiresReviewer`"*. Nhận im lặng một `reviewerId` cho cột không
 * yêu cầu sẽ biến move thành một đường thứ hai để sửa nội dung task — trong khi
 * đường đúng là `PATCH /tasks/:taskId`, nơi có `task:update` và activity riêng.
 */
export function assertReviewerOnlyWhenRequired(input: {
  columnRequiresReviewer: boolean;
  reviewerSent: boolean;
}): void {
  if (input.reviewerSent && !input.columnRequiresReviewer) {
    throw validationError([
      {
        field: "reviewerId",
        code: "reviewer_not_accepted",
        message: "Cột đích không yêu cầu người duyệt, nên không nhận trường này.",
      },
    ]);
  }
}

/**
 * `startDate <= dueDate` sau khi đã áp patch.
 *
 * Schema của hợp đồng kiểm được điều này **trong một request**, nhưng không
 * kiểm được nó sau khi trộn với giá trị đang có: gửi mỗi `dueDate` có thể tạo
 * ra một cặp ngày ngược so với `startDate` đã lưu. Phép kiểm thật vì vậy phải ở
 * đây, trên trạng thái **sau** patch.
 */
export function assertDateOrder(input: { startDate: string | null; dueDate: string | null }): void {
  if (input.startDate !== null && input.dueDate !== null && input.startDate > input.dueDate) {
    throw validationError([
      {
        field: "startDate",
        code: "start_after_due",
        message: "Ngày bắt đầu phải trước hoặc trùng hạn hoàn thành.",
      },
    ]);
  }
}
