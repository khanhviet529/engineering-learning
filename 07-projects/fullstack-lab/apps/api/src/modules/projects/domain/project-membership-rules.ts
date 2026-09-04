import type { ProjectRole } from "@flowboard/contracts";
import { stateConflict } from "../../../shared/errors/state-conflict.ts";

/**
 * Bất biến membership của project.
 *
 * Hàm thuần, không I/O. Chúng ở `domain/` vì đây là quy tắc nghiệp vụ có ý
 * nghĩa với người dùng — "một dự án luôn phải có người chịu trách nhiệm" —
 * chứ không phải chi tiết điều phối.
 */

/**
 * Cổng kiểm "user này còn là assignee của task nào trong project không?".
 *
 * Bảng `tasks` **chưa tồn tại** ở M2; nó thuộc M4. Nhưng bất biến thì đã có
 * trong hợp đồng từ bây giờ: "`204` chỉ remove khi còn tối thiểu một Owner và
 * target không còn là assignee của task trong project".
 *
 * Đây là dependency inversion đúng như ADR-0005 mô tả cho `ColumnEmptinessCheck`:
 * `projects` **định nghĩa** port trong domain của nó, module `tasks` sẽ cung
 * cấp adapter ở M4, và composition root nối hai bên. Chiều import vì vậy là
 * `tasks → projects`, và đồ thị vẫn acyclic.
 *
 * Vì sao dựng port ngay bây giờ thay vì đợi M4: nếu logic gỡ member được viết
 * mà **không** có chỗ cho phép kiểm này, thì M4 sẽ phải sửa lại use case đã
 * chạy và đã có test — và đó đúng là lúc người ta quên. Port ở đây làm phép
 * kiểm trở thành một mắt xích bắt buộc phải nối, chứ không phải một việc phải
 * nhớ.
 */
export interface ProjectAssigneeCheck {
  /** `true` khi user còn là assignee của ít nhất một task trong project. */
  hasAssignedTasks(input: { projectId: string; userId: string; tx: unknown }): Promise<boolean>;
}

/**
 * Adapter của M2: chưa có bảng `tasks` nên chưa có task nào để giữ.
 *
 * Trả `false` là **đúng sự thật ở M2**, không phải một chỗ nối tạm bị bỏ trống:
 * không tồn tại bảng nào có thể chứa một assignment. M4 thay adapter này bằng
 * adapter thật của module `tasks`.
 */
export class NoTasksYetAssigneeCheck implements ProjectAssigneeCheck {
  async hasAssignedTasks(): Promise<boolean> {
    return false;
  }
}

/**
 * Một project phải luôn còn ít nhất một Owner.
 *
 * Mất Owner cuối cùng nghĩa là không ai còn quản lý được cột, thành viên hay
 * thiết lập của project đó — và không có đường nào sửa qua API, vì thao tác sửa
 * chính là thao tác cần Owner. Nên đây là trạng thái **không thể phục hồi**, và
 * phải bị chặn trước khi commit chứ không phải dọn sau.
 *
 * `ownerCountAfterChange` do use case tính **bên trong transaction**: tính
 * ngoài transaction là đọc một con số có thể đã cũ vào lúc ghi.
 */
export function assertProjectKeepsAnOwner(ownerCountAfterChange: number): void {
  if (ownerCountAfterChange < 1) {
    throw stateConflict(
      "PROJECT_LAST_OWNER",
      "Dự án phải luôn còn ít nhất một Chủ sở hữu. Hãy chỉ định Chủ sở hữu khác trước.",
    );
  }
}

/**
 * Người bị gỡ không được còn là assignee của task trong project.
 *
 * API **không** tự unassign hộ: hợp đồng nói rõ "API không auto-unassign/transfer
 * task". Tự dọn là âm thầm đổi trách nhiệm của một công việc mà không ai quyết
 * định — đúng loại thay đổi phải do người dùng chủ động làm.
 */
export function assertNotAssignedToTasks(hasAssignedTasks: boolean): void {
  if (hasAssignedTasks) {
    throw stateConflict(
      "MEMBER_HAS_ASSIGNED_TASKS",
      "Không thể gỡ thành viên khi họ vẫn là người thực hiện của công việc trong dự án. " +
        "Hãy giao lại hoặc bỏ giao các công việc đó trước.",
    );
  }
}

/** Số Owner còn lại sau khi đổi vai trò của một member. */
export function ownerCountAfterRoleChange(
  currentOwnerCount: number,
  currentRole: ProjectRole,
  nextRole: ProjectRole,
): number {
  if (currentRole === "owner" && nextRole !== "owner") return currentOwnerCount - 1;
  if (currentRole !== "owner" && nextRole === "owner") return currentOwnerCount + 1;
  return currentOwnerCount;
}

/** Số Owner còn lại sau khi gỡ một member. */
export function ownerCountAfterRemoval(
  currentOwnerCount: number,
  removedRole: ProjectRole,
): number {
  return removedRole === "owner" ? currentOwnerCount - 1 : currentOwnerCount;
}
