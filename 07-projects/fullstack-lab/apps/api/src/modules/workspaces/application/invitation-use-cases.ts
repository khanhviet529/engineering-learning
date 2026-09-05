import type { KeyRing } from "../../../shared/security/key-ring.ts";
import type { WorkspaceRole } from "@flowboard/contracts";
import type { Database } from "../../../shared/database/client.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import type { Actor } from "../../../shared/authorization/index.ts";
import { workspaceCapabilities } from "../../../shared/authorization/index.ts";
import type { Mailer } from "../../../shared/mail/mailer.port.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import {
  buildPage,
  decodeCursor,
  queryFingerprint,
  type PageResult,
} from "../../../shared/http/cursor.ts";
import { generateOneTimeToken, hashOneTimeToken } from "../../../shared/security/one-time-token.ts";
import {
  canonicalizeEmail,
  invalidInvitationToken,
  invitationEmailMismatch,
  invitationExpiry,
} from "../domain/invitation-rules.ts";
import type { InvitationRepository } from "../infrastructure/invitation-repository.ts";
import type { WorkspaceRepository } from "../infrastructure/workspace-repository.ts";

/**
 * Use case lời mời workspace — [ADR-0013](../../../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Nguyên tắc chi phối cả file: **không nhánh nào của việc gửi lời mời được
 * quan sát khác nhau từ bên ngoài.** Ba nhánh — email có account, không có
 * account, đã là member — cùng đi qua một đường trả về, và đường đó không nhận
 * tham số nào phân biệt chúng.
 */

export interface InvitationDeps {
  db: Database;
  invitations: InvitationRepository;
  workspaces: WorkspaceRepository;
  mailer: Mailer;
  cursorSecret: KeyRing;
  now?: () => Date;
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: { id: string; displayName: string };
  createdAt: Date;
  expiresAt: Date;
}

export interface JoinedWorkspaceView {
  id: string;
  name: string;
  role: WorkspaceRole;
  capabilities: string[];
}

export class InvitationUseCases {
  readonly #deps: InvitationDeps;

  constructor(deps: InvitationDeps) {
    this.#deps = deps;
  }

  get #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /**
   * `POST /workspaces/:workspaceId/members` — gửi lời mời.
   *
   * ## Ba nhánh, một kết quả quan sát được
   *
   * | Nhánh | Việc làm bên trong | Điều bên ngoài thấy |
   * |---|---|---|
   * | Email chưa có account | tạo lời mời, gửi thư | `202 { accepted: true }` |
   * | Email đã có account | tạo lời mời, gửi thư | `202 { accepted: true }` |
   * | Đã là member workspace này | **không** tạo lời mời, **không** gửi thư | `202 { accepted: true }` |
   *
   * Nhánh thứ ba là nhánh dễ làm sai nhất, vì một thông điệp kiểu "người này đã
   * là thành viên" trông hoàn toàn vô hại và còn có ích cho người dùng. Nó
   * không vô hại: nó biến route thành máy dò tài khoản trong phạm vi workspace,
   * và vì **ai xác minh email cũng tạo được workspace để tự thành Workspace
   * Admin**, máy dò đó mở cho mọi người vừa đăng ký. Đó là toàn bộ lý do
   * ADR-0013 tồn tại; làm hỏng chỗ này là làm hỏng chính quyết định.
   *
   * Hàm vì vậy trả `void`. Không có giá trị trả về nào để controller lỡ tay
   * dịch thành một response khác nhau giữa các nhánh.
   *
   * Nhánh "đã là member" vẫn **thu hồi** lời mời `pending` cũ nếu có: để một
   * lời mời treo cho người đã vào rồi nghĩa là chấp nhận nó sau đó sẽ đâm vào
   * unique constraint của `workspace_members` — một lỗi `500` cho một trạng
   * thái lẽ ra không nên tồn tại.
   */
  async inviteMember(
    actor: Actor,
    workspaceId: string,
    input: { email: string; role: WorkspaceRole },
    recordOutcome?: RecordOutcome,
    outcomeBody?: unknown,
  ): Promise<void> {
    const email = canonicalizeEmail(input.email);
    const now = this.#now;

    // Token sinh **ngoài** transaction và chỉ tồn tại trong biến này cùng lá
    // thư; database chỉ nhận hash.
    const token = generateOneTimeToken();

    const mail = await this.#deps.db.transaction(async (tx) => {
      const workspace = await this.#deps.workspaces.findWorkspaceById(workspaceId, tx);
      // Guard đã authorize workspace, nên đây là bất thường dữ liệu, không phải
      // một nhánh người dùng gặp.
      if (workspace === undefined) throw new AppError("NOT_FOUND");

      const existingUser = await this.#deps.workspaces.findUserByEmail(email, tx);

      if (existingUser !== undefined) {
        const membership = await this.#deps.workspaces.findMembership(
          workspaceId,
          existingUser.id,
          tx,
        );

        if (membership !== undefined) {
          // Đã là member: dọn lời mời treo, không tạo mới, không gửi thư.
          await this.#deps.invitations.revokePendingForEmail({ workspaceId, email, now }, tx);
          if (recordOutcome !== undefined) await recordOutcome(tx, outcomeBody);
          return undefined;
        }
      }

      await this.#deps.invitations.upsertPending(
        {
          workspaceId,
          email,
          role: input.role,
          invitedByUserId: actor.id,
          tokenHash: hashOneTimeToken(token),
          expiresAt: invitationExpiry(now),
          now,
        },
        tx,
      );

      if (recordOutcome !== undefined) await recordOutcome(tx, outcomeBody);

      return {
        to: email,
        token,
        workspaceName: workspace.name,
        invitedByName: actor.displayName,
      };
    });

    /**
     * Gửi thư **sau khi commit**, không phải bên trong transaction.
     *
     * Giữ transaction mở trong lúc gọi SMTP là giữ khoá database suốt một lượt
     * network I/O; `query-and-index-policy.md` cấm việc đó tường minh. Hệ quả
     * được chấp nhận: crash giữa commit và send làm mất lá thư, và người mời
     * gửi lại — cùng chế độ hỏng đã ghi nhận cho email xác minh ở M1.
     */
    if (mail !== undefined) {
      await this.#deps.mailer.sendWorkspaceInvitationEmail(mail);
    }
  }

  /**
   * `GET /workspaces/:workspaceId/invitations` — lời mời đang chờ.
   *
   * Chỉ `pending` **và còn hạn**, chỉ của workspace này. Projection không có
   * `tokenHash` và không có `status`: danh sách chỉ trả một trạng thái nên một
   * cột status chỉ mang đúng một giá trị, và `tokenHash` là bí mật — nó không
   * ra khỏi database ở bất kỳ đường nào.
   */
  async listPendingInvitations(
    actor: Actor,
    workspaceId: string,
    input: { limit: number; cursor?: string },
  ): Promise<PageResult<PendingInvitationView>> {
    const fingerprint = queryFingerprint({
      list: "workspace-invitations",
      actor: actor.id,
      workspace: workspaceId,
      sort: "createdAt:desc,id:desc",
    });

    const after =
      input.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(input.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAt: new Date(decoded.sortKey), id: decoded.id };
          })();

    const rows = await this.#deps.invitations.findPendingForWorkspace(
      workspaceId,
      input.limit,
      this.#now,
      after,
    );

    return buildPage(
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        invitedBy: { id: row.invitedByUserId, displayName: row.invitedByDisplayName },
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      })),
      input.limit,
      fingerprint,
      this.#deps.cursorSecret,
      (row) => ({ sortKey: row.createdAt.toISOString(), id: row.id }),
    );
  }

  /**
   * `DELETE /workspaces/:workspaceId/invitations/:invitationId` — thu hồi.
   *
   * Bốn nhánh cho **cùng một** `404`: lời mời không tồn tại, thuộc workspace
   * khác, đã `accepted`, hoặc đã `revoked`. Trả `409` cho "đã dùng rồi" là tiết
   * lộ trạng thái của một lời mời mà caller không có quyền biết — và với lời
   * mời thuộc workspace khác, nó còn xác nhận rằng ID đó có thật.
   *
   * Thu hồi có hiệu lực **ngay tại commit**: hàng chỉ giữ một `status`, và
   * `consumeByTokenHash` yêu cầu `status = 'pending'`. Không có bước dọn nào ở
   * giữa, nên không có cửa sổ nào token đã thu hồi vẫn dùng được.
   */
  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    recordOutcome?: RecordOutcome,
  ): Promise<void> {
    await this.#deps.db.transaction(async (tx) => {
      const revoked = await this.#deps.invitations.revokePending(
        { workspaceId, invitationId, now: this.#now },
        tx,
      );
      if (revoked === 0) throw new AppError("NOT_FOUND");

      if (recordOutcome !== undefined) await recordOutcome(tx, null);
    });
  }

  /**
   * `POST /invitations/accept` — chấp nhận lời mời.
   *
   * Một transaction duy nhất, đúng thứ tự: tiêu thụ token → kiểm email khớp →
   * tạo membership.
   *
   * Tiêu thụ **trước** là có chủ đích. Câu `UPDATE` mang điều kiện trong `WHERE`
   * nên nó vừa kiểm vừa chiếm chỗ trong một thao tác nguyên tử; hai request
   * cùng token thì câu thứ hai đổi 0 hàng. Nếu kiểm email trước rồi mới tiêu
   * thụ, hai request vẫn cùng qua được bước kiểm.
   *
   * Email không khớp thì **rollback** — lời mời quay về `pending` và người đúng
   * vẫn dùng được token. Đây là lý do phép kiểm nằm trong cùng transaction chứ
   * không phải sau nó.
   */
  async acceptInvitation(actor: Actor, input: { token: string }): Promise<JoinedWorkspaceView> {
    const now = this.#now;

    return await this.#deps.db.transaction(async (tx) => {
      const invitation = await this.#deps.invitations.consumeByTokenHash(
        { tokenHash: hashOneTimeToken(input.token), now },
        tx,
      );

      // Không tồn tại, hết hạn, đã dùng, đã thu hồi — cùng một lỗi, không phân
      // biệt được từ bên ngoài.
      if (invitation === undefined) throw invalidInvitationToken();

      if (canonicalizeEmail(actor.email) !== invitation.email) {
        // Ném trong transaction ⇒ rollback ⇒ lời mời vẫn `pending`.
        throw invitationEmailMismatch();
      }

      /**
       * Endpoint này **không** tạo account: actor phải đã đăng nhập, và
       * `SessionGuard` đã bảo đảm điều đó. Không đường nào ở đây tạo credential
       * mà bỏ qua chính sách mật khẩu của ADR-0007.
       */
      const existing = await this.#deps.workspaces.findMembership(
        invitation.workspaceId,
        actor.id,
        tx,
      );

      // Đã là member (ví dụ được thêm bằng đường khác giữa lúc mời và lúc chấp
      // nhận): lời mời vẫn được tiêu thụ, membership giữ nguyên vai trò hiện có.
      // Không hạ hay nâng quyền một cách âm thầm.
      if (existing === undefined) {
        await this.#deps.workspaces.addMember(
          { workspaceId: invitation.workspaceId, userId: actor.id, role: invitation.role },
          tx,
        );
      }

      const role = existing?.role ?? invitation.role;

      return {
        id: invitation.workspaceId,
        name: invitation.workspaceName,
        role,
        capabilities: workspaceCapabilities(role),
      };
    });
  }
}
