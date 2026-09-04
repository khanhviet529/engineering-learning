/**
 * Cổng đọc membership workspace, do module `projects` **định nghĩa**.
 *
 * Bất biến: một ProjectMember phải đang là WorkspaceMember của workspace chứa
 * project. Để kiểm được điều đó, `projects` cần một mẩu thông tin thuộc về
 * `workspaces`.
 *
 * Theo ADR-0005, phụ thuộc cross-module chỉ đi qua **application port**, không
 * import Drizzle table hay repository của module khác. Chiều `projects →
 * workspaces` nằm đúng trong đồ thị acyclic đã duyệt.
 *
 * Vì sao không dùng thẳng `MembershipReader` của `shared/authorization`: kernel
 * đó tồn tại để **đánh giá quyền**, và một use case đọc nó cho mục đích khác sẽ
 * làm mờ ranh giới đó — lần sau ai đó sẽ dùng kernel để đọc thêm một thứ nữa,
 * rồi một thứ nữa. Port này nói đúng một câu mà `projects` cần hỏi.
 */
export interface WorkspaceMembershipPort {
  /** User này có phải thành viên của workspace này không? */
  isWorkspaceMember(input: { workspaceId: string; userId: string; tx?: unknown }): Promise<boolean>;
}
