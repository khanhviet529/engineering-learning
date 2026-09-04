/**
 * Cổng kiểm "cột này còn task không?".
 *
 * ## Vì sao là port chứ không phải import chéo
 *
 * Use case archive cần biết cột còn task hay không — dữ liệu của module `tasks`.
 * Nhưng module `board-columns` **không được** import `tasks`, vì `tasks` đã
 * import `board-columns` (nó cần biết cột đích còn active và cùng project).
 * Import hai chiều là một **cycle**, và ADR-0005 cấm che cycle bằng
 * `forwardRef`.
 *
 * Cách giải là dependency inversion, và ADR-0005 gọi đích danh chỗ này:
 * `board-columns` **định nghĩa** port trong domain của nó; module `tasks`
 * implement adapter; composition root nối hai bên. Chiều import ở source code
 * vì vậy chỉ còn `tasks → board-columns`, và đồ thị vẫn acyclic.
 *
 * ## Vì sao dựng port ngay ở M3
 *
 * Bảng `tasks` chưa tồn tại, nên phép kiểm chưa có gì để đọc. Nhưng nếu use
 * case archive được viết mà **không** có chỗ cho phép kiểm này, M4 sẽ phải sửa
 * lại một use case đã chạy và đã có test — và đó đúng là lúc người ta quên.
 * Port biến phép kiểm thành một mắt xích **bắt buộc phải nối**, không phải một
 * việc phải nhớ.
 */
export interface ColumnEmptinessCheck {
  /** `true` khi cột còn ít nhất một task. */
  hasTasks(input: { projectId: string; columnId: string; tx: unknown }): Promise<boolean>;
}

/**
 * Adapter của M3: chưa có bảng `tasks` nên chưa có task nào để giữ.
 *
 * Trả `false` là **đúng sự thật ở M3**, không phải một chỗ nối bị bỏ trống:
 * không tồn tại bảng nào có thể chứa một task. M4 thay adapter này bằng bản
 * thật của module `tasks`, và luật archive không phải viết lại dòng nào.
 */
export class NoTasksYetEmptinessCheck implements ColumnEmptinessCheck {
  async hasTasks(): Promise<boolean> {
    return false;
  }
}
