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
/** Một dòng roster: đúng ba field mà `memberCandidateSchema` công bố, không hơn. */
export interface WorkspaceRosterEntry {
  userId: string;
  displayName: string;
  email: string;
}

/** Vị trí seek của cursor roster: khoá sort chính cộng `userId` tie-breaker. */
export interface WorkspaceRosterSeek {
  displayName: string;
  userId: string;
}

/** Đúng những câu hỏi về membership workspace mà `projects` cần hỏi. */
export interface WorkspaceMembershipPort {
  /** User này có phải thành viên của workspace này không? */
  isWorkspaceMember(input: { workspaceId: string; userId: string; tx?: unknown }): Promise<boolean>;

  /**
   * Một **trang** roster workspace, sắp theo `(displayName, userId)`, trừ những
   * user được nêu tên.
   *
   * ## Vì sao `excludeUserIds` chứ không phải `excludeProjectId`
   *
   * Câu hỏi mà `GET /projects/:projectId/member-candidates` cần trả lời là
   * "workspace member nào **chưa** ở trong project này". Cách viết thẳng tay là
   * cho port nhận `projectId` rồi anti-join `project_members` — và đó là chỗ
   * hỏng: `project_members` là bảng của module `projects`. Một port tên
   * "workspace membership" mà adapter của nó đọc bảng của `projects` không còn
   * trả lời một câu hỏi về workspace nữa, và quan trọng hơn, nó **không di
   * chuyển được**. Doc của adapter đã hứa sẵn đường đi: khi `workspaces` export
   * port này cho consumer thứ hai, adapter chuyển sang bên đó. Một method đọc
   * `project_members` sẽ biến lần chuyển đó thành cạnh `workspaces → projects`,
   * tức đúng chu trình mà ADR-0005 cấm.
   *
   * Nên `projects` đọc **bảng của chính nó** để biết ai đã là member, rồi đưa
   * danh sách id sang. Port giữ nguyên từ vựng workspace và vẫn chuyển được.
   *
   * ## Vì sao loại trừ nằm trong SQL, không nằm sau khi phân trang
   *
   * Lọc sau khi đã cắt trang làm số phần tử mỗi trang không đều và bỏ sót người
   * ở ranh giới: trang đầu đọc 25 hàng, bỏ 3 người đã là member, trả 22; trang
   * sau bắt đầu từ hàng thứ 25 và ba người bị bỏ **không được ai thế chỗ**.
   * `limit` và điều kiện loại trừ vì vậy phải đi cùng nhau trong một câu truy
   * vấn. Người gọi đọc dư một hàng để biết `hasMore`.
   *
   * Cái giá: danh sách id đi kèm mỗi trang. Nó bị chặn bởi số member của một
   * project, vốn đã được đọc nguyên vẹn không phân trang ở
   * `findMembersOfProject` với cùng lập luận về biên tự nhiên của nhóm nhỏ.
   */
  listWorkspaceRoster(input: {
    workspaceId: string;
    excludeUserIds: readonly string[];
    limit: number;
    after?: WorkspaceRosterSeek;
    tx?: unknown;
  }): Promise<WorkspaceRosterEntry[]>;
}
