import type { ActivityAction } from "./activity-recorder.ts";

/**
 * `summary` — chuỗi mà client đọc được, do **server** dựng.
 *
 * Hợp đồng nói rõ hai chiều của cùng một luật: `summary` do server dựng từ
 * payload đã allowlist, và **raw `payload` không bao giờ đến client**. Đây là
 * chỗ duy nhất biến payload thành chữ, nên nó cũng là chỗ duy nhất phải đúng.
 *
 * ## Vì sao dựng chữ ở server chứ không gửi payload cho client tự dựng
 *
 * Payload là **không gian mở**: nó mang bất cứ context nào mà module ghi event
 * thấy hữu ích, và nội dung đó tiến hoá theo từng mốc. Gửi nguyên payload nghĩa
 * là mọi field từng được thêm vào đó trở thành một phần bề mặt công khai — kể
 * cả field mà người thêm chỉ định dùng cho chẩn đoán. Một allowlist ở tầng
 * render không cứu được điều đó, vì dữ liệu đã ra khỏi server rồi.
 *
 * ## Vì sao chuỗi tiếng Việt cứng chứ không phải khoá i18n
 *
 * Sản phẩm chỉ có một ngôn ngữ ở MVP, và một lớp khoá i18n bây giờ là một tầng
 * gián tiếp không phục vụ ai. Khi có ngôn ngữ thứ hai, chỗ phải đổi là **đúng
 * file này** — đó chính là lý do nó tồn tại như một hàm riêng.
 */

/** Đọc một chuỗi non-empty ra khỏi payload, hoặc `undefined`. */
function str(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bool(payload: Record<string, unknown> | null, key: string): boolean | undefined {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Dựng `summary` cho một dòng activity.
 *
 * Hàm **toàn phần**: mọi action trong allowlist có một nhánh, và một action lạ
 * — chỉ có thể tới từ một dòng ghi trước khi allowlist đổi — nhận một câu trung
 * tính thay vì làm hỏng cả trang lịch sử.
 *
 * Không nhánh nào đọc một field không có tên ở đây. Thêm một field vào payload
 * **không** tự động làm nó hiện ra với người dùng; muốn thế phải sửa file này,
 * tức là phải đi qua review.
 */
export function buildActivitySummary(
  action: string,
  payload: Record<string, unknown> | null,
): string {
  const name = str(payload, "name");
  const title = str(payload, "title");
  const from = str(payload, "from");
  const to = str(payload, "to");

  switch (action as ActivityAction) {
    case "project.created":
      return name === undefined ? "Đã tạo dự án." : `Đã tạo dự án “${name}”.`;
    case "project.updated":
      return from !== undefined && to !== undefined
        ? `Đã đổi tên dự án từ “${from}” thành “${to}”.`
        : "Đã cập nhật dự án.";
    case "project_member.added":
      return "Đã thêm một thành viên vào dự án.";
    case "project_member.role_changed":
      return "Đã đổi vai trò của một thành viên.";
    case "project_member.removed":
      return "Đã gỡ một thành viên khỏi dự án.";

    case "board_column.created":
      return name === undefined ? "Đã tạo một cột." : `Đã tạo cột “${name}”.`;
    case "board_column.renamed":
      return from !== undefined && to !== undefined
        ? `Đã đổi tên cột từ “${from}” thành “${to}”.`
        : "Đã đổi tên một cột.";
    case "board_column.terminal_changed":
      return bool(payload, "to") === true
        ? "Đã đánh dấu cột là điểm kết thúc công việc."
        : "Đã bỏ đánh dấu điểm kết thúc công việc của cột.";
    case "board_column.reviewer_requirement_changed":
      return bool(payload, "to") === true
        ? "Đã bật yêu cầu người duyệt cho cột."
        : "Đã tắt yêu cầu người duyệt cho cột.";
    case "board_column.archived":
      return name === undefined ? "Đã lưu trữ một cột." : `Đã lưu trữ cột “${name}”.`;
    case "board_column.reordered":
      return "Đã sắp lại thứ tự các cột.";

    case "task.created":
      return title === undefined ? "Đã tạo công việc." : `Đã tạo công việc “${title}”.`;
    case "task.updated": {
      /**
       * Chỉ nêu **tên field** đã đổi, không nêu giá trị.
       *
       * Giá trị mới của `description` có thể dài mười nghìn ký tự, và giá trị
       * của `assigneeId` là một định danh chẳng nói gì với người đọc. Danh sách
       * tên field trả lời đúng câu hỏi mà một dòng lịch sử cần trả lời: *cái gì*
       * đã đổi.
       */
      const fields = payload?.["fields"];
      const labels = Array.isArray(fields)
        ? fields.filter((f): f is string => typeof f === "string").map(fieldLabel)
        : [];
      return labels.length === 0 ? "Đã cập nhật công việc." : `Đã cập nhật ${labels.join(", ")}.`;
    }
    case "task.moved":
      return "Đã chuyển công việc sang cột khác.";
    case "task.reopened":
      return "Đã mở lại công việc.";
    case "comment.created":
      return "Đã thêm một bình luận.";

    default:
      // Một action ghi trước khi allowlist đổi. Trang lịch sử vẫn đọc được.
      return "Đã có một thay đổi.";
  }
}

/** Nhãn tiếng Việt của field task; field lạ giữ nguyên tên để không bịa. */
function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: "tiêu đề",
    description: "mô tả",
    assigneeId: "người thực hiện",
    reviewerId: "người duyệt",
    category: "phân loại",
    priority: "mức ưu tiên",
    startDate: "ngày bắt đầu",
    dueDate: "hạn hoàn thành",
    evidenceUrl: "liên kết bằng chứng",
  };
  return labels[field] ?? field;
}
