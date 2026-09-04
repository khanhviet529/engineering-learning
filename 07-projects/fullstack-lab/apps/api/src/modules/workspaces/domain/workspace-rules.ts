import type { WorkspaceRole } from "@flowboard/contracts";
import { AppError } from "../../../shared/errors/app-error.ts";
import { stateConflict } from "../../../shared/errors/state-conflict.ts";

/**
 * Quy tắc miền của workspace.
 *
 * Hàm thuần, không I/O — để invariant kiểm được mà không phải dựng database.
 * Chúng ở `domain/` chứ không ở `application/` vì chúng là quy tắc nghiệp vụ,
 * không phải điều phối.
 */

/**
 * Chính sách cấp phát workspace.
 *
 * Hợp đồng endpoint nói `POST /workspaces` cần "workspace-provisioning policy
 * do server kiểm soát", và nói rõ policy này **không** suy diễn từ project
 * role — nhưng không nói policy đó là gì.
 *
 * Lựa chọn ở đây, và lý do: **actor đã xác minh email được tạo workspace**, và
 * trở thành `workspace_admin` của workspace mới.
 *
 * - "Đã xác minh email" là rào chắn thật duy nhất đang có trong MVP; nếu không
 *   có nó, một account chưa xác minh tạo được tenant, và luồng xác minh mất ý
 *   nghĩa.
 * - Không suy từ role nào khác, đúng như hợp đồng yêu cầu.
 * - Policy nằm ở **một hàm có tên**, không phải một câu `if` trong controller,
 *   vì đây là thứ chắc chắn sẽ đổi khi có invite hay billing.
 */
export function canProvisionWorkspace(actor: { emailVerified: boolean }): boolean {
  return actor.emailVerified;
}

export function assertCanProvisionWorkspace(actor: { emailVerified: boolean }): void {
  if (!canProvisionWorkspace(actor)) {
    throw new AppError("FORBIDDEN", {
      message: "Bạn cần xác minh email trước khi tạo không gian làm việc.",
    });
  }
}

/** Vai trò của người tạo workspace: luôn là admin của chính workspace mình tạo. */
export const CREATOR_WORKSPACE_ROLE: WorkspaceRole = "workspace_admin";

/**
 * Gỡ một workspace member có an toàn không?
 *
 * Bất biến: **không được để lại project membership mồ côi**. Một người đã rời
 * workspace mà vẫn là ProjectMember của một project trong workspace đó sẽ giữ
 * nguyên quyền đọc project riêng tư — đúng thứ mà "membership workspace là điều
 * kiện cần cho membership project" phải ngăn.
 *
 * API **không** tự dọn hộ: hợp đồng nói rõ removal bị chặn thì báo lỗi, và
 * không silently đổi project membership. Dọn là quyết định của Owner từng
 * project, không phải hiệu ứng phụ của một thao tác cấp workspace.
 *
 * Thông điệp cố ý **không** nói người đó thuộc project nào: người gọi là
 * Workspace Admin, và Workspace Admin không có quyền ngầm định để biết một
 * project riêng tư nào tồn tại. Chỉ nói "còn thuộc dự án" là đủ để hành động
 * mà không lộ danh sách.
 */
export function assertNoDependentProjectMembership(count: number): void {
  if (count > 0) {
    throw stateConflict(
      "WORKSPACE_MEMBER_IN_PROJECTS",
      "Không thể gỡ thành viên khi họ vẫn thuộc một dự án trong không gian làm việc này. " +
        "Chủ dự án cần gỡ họ khỏi dự án trước.",
    );
  }
}
