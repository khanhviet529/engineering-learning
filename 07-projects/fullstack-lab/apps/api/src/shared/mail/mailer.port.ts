/**
 * Cổng gửi mail.
 *
 * ## Vì sao port ở `shared/mail/` chứ không ở lại module `auth`
 *
 * ADR-0005 quyết định chỗ này, không phải sở thích. Đồ thị phụ thuộc module
 * trong `apps/api` là **acyclic và đóng**, và nó **không có** cạnh
 * `workspaces → auth`:
 *
 * ```text
 * comments ──► tasks ──► board-columns
 *    │           │  └──► projects ──► workspaces
 *    ▼           ▼             ▼
 * activity ◄── mọi module mutation
 * auth: không phụ thuộc module sản phẩm nào
 * ```
 *
 * `backend-conventions.md` nói tiếp: *"Import cross-module ngoài đồ thị này là
 * vi phạm review; cần sửa ranh giới hoặc mở ADR"*. Cho `workspaces` import
 * `Mailer` từ `modules/auth/application/` vì vậy là một cạnh mới nằm ngoài đồ
 * thị đã duyệt — và nó tạo ra một quan hệ sai về nghĩa: module `workspaces` sẽ
 * phụ thuộc vào module `auth` chỉ để lấy một interface không thuộc về
 * authentication.
 *
 * Cả hai cách còn lại đều tệ hơn:
 *
 * - Khai một `Mailer` thứ hai trong `workspaces` là hai định nghĩa cho cùng
 *   một cổng, và composition root sẽ phải truyền cùng một instance dưới hai
 *   kiểu.
 * - Mở ADR mới để hợp thức hoá cạnh `workspaces → auth` là đổi ranh giới kiến
 *   trúc cho một interface ba dòng.
 *
 * `shared/` không phải một module, nên mọi module import nó là hợp lệ theo đúng
 * đồ thị. Adapter thật (`SmtpMailer`) vốn đã sống ở `shared/mail/` — port nay
 * nằm cạnh chính adapter của nó, đúng chỗ đáng ra nó phải ở từ đầu. Quy tắc hai
 * consumer ở `shared-helper-policy.md` cũng đã đạt: `auth` và `workspaces`.
 *
 * Port này cố ý **không** biết gì về HTTP, transaction hay quyền. Nó nhận đúng
 * dữ liệu cần để soạn một lá thư.
 */

export interface Mailer {
  sendVerificationEmail(input: { to: string; token: string }): Promise<void>;

  sendPasswordResetEmail(input: { to: string; token: string }): Promise<void>;

  /**
   * Thư mời vào workspace.
   *
   * Nhận **nhiều context hơn** hai method kia, và đó là điều kiện để thư dùng
   * được: người nhận có thể **chưa từng nghe về Flowboard**. Một lá thư chỉ có
   * link thì không phân biệt được với phishing — người đọc không biết ai mời,
   * vào đâu, và vì sao họ nhận được nó.
   *
   * `workspaceName` và `invitedByName` vì vậy không phải trang trí; chúng là
   * thứ cho người nhận đủ cơ sở để quyết định có bấm hay không.
   */
  sendWorkspaceInvitationEmail(input: {
    to: string;
    token: string;
    workspaceName: string;
    invitedByName: string;
  }): Promise<void>;
}
