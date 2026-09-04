import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { WorkspaceRole } from "@flowboard/contracts";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { users, workspaceInvitations, workspaces } from "../../../shared/database/schema.ts";

/**
 * Repository lời mời workspace.
 *
 * **Nơi duy nhất** trong module chạm Drizzle cho bảng này, và mọi truy vấn tự
 * mang scope `workspace_id` của nó — trừ đúng một chỗ: tiêu thụ token, nơi
 * chính `token_hash` là scope (nó `UNIQUE` và không đoán được).
 */

type Executor = Database | Transaction;

export interface PendingInvitationRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByUserId: string;
  invitedByDisplayName: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SeekPosition {
  createdAt: Date;
  id: string;
}

/** Lời mời đã tiêu thụ thành công, cùng dữ liệu cần dựng response. */
export interface ConsumedInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
}

export class InvitationRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Tạo lời mời, **ghi đè** lời mời `pending` cũ của cùng cặp workspace/email.
   *
   * Ghi đè bằng `ON CONFLICT ... DO UPDATE` trên chính partial unique index,
   * chứ **không** phải "select rồi quyết định insert hay update". Hai request
   * đồng thời trong cách thứ hai đều đọc "chưa có" và đều insert; index thì
   * không có cửa sổ đó, và một câu lệnh nguyên tử luôn cho đúng một hàng.
   *
   * Ghi đè `token_hash` là điều làm token cũ **chết ngay**: hàng chỉ giữ được
   * một hash, và hash cũ không còn ở đâu để khớp.
   */
  async upsertPending(
    input: {
      workspaceId: string;
      email: string;
      role: WorkspaceRole;
      invitedByUserId: string;
      tokenHash: string;
      expiresAt: Date;
      now: Date;
    },
    tx: Executor,
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(workspaceInvitations)
      .values({
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        invitedByUserId: input.invitedByUserId,
        tokenHash: input.tokenHash,
        status: "pending",
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        // Đúng partial unique index: `(workspace_id, email) WHERE status = 'pending'`.
        target: [workspaceInvitations.workspaceId, workspaceInvitations.email],
        targetWhere: eq(workspaceInvitations.status, "pending"),
        set: {
          role: input.role,
          invitedByUserId: input.invitedByUserId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          updatedAt: input.now,
        },
      })
      .returning({ id: workspaceInvitations.id });

    return row as { id: string };
  }

  /**
   * Lời mời `pending` **còn hạn** của một workspace.
   *
   * Lọc `expires_at > now` ngay trong truy vấn: một lời mời quá hạn vẫn mang
   * `status = 'pending'` cho tới khi ai đó dọn, nhưng nó không dùng được nữa —
   * trả nó ra danh sách "đang chờ" là nói sai với người đang quản trị.
   *
   * Dùng `gt(...)` với `Date` chứ không phải `now()` trong template `sql` thô:
   * một `Date` nhét thẳng vào template không được gắn kiểu `timestamptz` và
   * driver từ chối. Lỗi này đã dính hai lần trong repo này.
   */
  async findPendingForWorkspace(
    workspaceId: string,
    limit: number,
    now: Date,
    after?: SeekPosition,
    tx?: Executor,
  ): Promise<PendingInvitationRow[]> {
    const scope = and(
      eq(workspaceInvitations.workspaceId, workspaceId),
      eq(workspaceInvitations.status, "pending"),
      gt(workspaceInvitations.expiresAt, now),
    );

    const seek =
      after === undefined
        ? undefined
        : or(
            lt(workspaceInvitations.createdAt, after.createdAt),
            and(
              eq(workspaceInvitations.createdAt, after.createdAt),
              lt(workspaceInvitations.id, after.id),
            ),
          );

    return (await (tx ?? this.#db)
      .select({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
        invitedByUserId: workspaceInvitations.invitedByUserId,
        invitedByDisplayName: users.displayName,
        createdAt: workspaceInvitations.createdAt,
        expiresAt: workspaceInvitations.expiresAt,
      })
      .from(workspaceInvitations)
      .innerJoin(users, eq(users.id, workspaceInvitations.invitedByUserId))
      .where(seek === undefined ? scope : and(scope, seek))
      .orderBy(desc(workspaceInvitations.createdAt), desc(workspaceInvitations.id))
      .limit(limit + 1)) as PendingInvitationRow[];
  }

  /**
   * Thu hồi một lời mời `pending` của **đúng** workspace này.
   *
   * `workspace_id` nằm trong `WHERE` dù `id` đã là khoá chính. Đó không phải
   * thừa: `:invitationId` là **locator, không phải bằng chứng quyền**, và guard
   * chỉ authorize workspace trên URL. Không có điều kiện này, một admin của
   * workspace A thu hồi được lời mời của workspace B chỉ bằng cách đoán đúng ID.
   *
   * Trả số hàng đã đổi để use case dịch `0` thành `404` — cùng một `404` cho cả
   * bốn nhánh: không tồn tại, workspace khác, đã accepted, đã revoked.
   */
  async revokePending(
    input: { workspaceId: string; invitationId: string; now: Date },
    tx: Executor,
  ): Promise<number> {
    const rows = await tx
      .update(workspaceInvitations)
      .set({ status: "revoked", updatedAt: input.now })
      .where(
        and(
          eq(workspaceInvitations.id, input.invitationId),
          eq(workspaceInvitations.workspaceId, input.workspaceId),
          eq(workspaceInvitations.status, "pending"),
        ),
      )
      .returning({ id: workspaceInvitations.id });
    return rows.length;
  }

  /**
   * Tiêu thụ token: đánh dấu `accepted` **và** trả lời mời, trong một câu lệnh.
   *
   * Điều kiện tiêu thụ nằm trong `WHERE` của chính câu `UPDATE`:
   *
   * ```sql
   * WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
   * ```
   *
   * Nên hai request cùng token **không thể cùng thành công**: câu thứ hai cập
   * nhật 0 hàng và `returning` rỗng. Đây là lý do không được viết
   * `SELECT` rồi `UPDATE` — hai câu là hai thời điểm, và khoảng giữa chúng đủ
   * cho một request thứ hai đọc cùng trạng thái `pending`.
   *
   * Trả `undefined` khi không tiêu thụ được, và **không** nói vì sao: người gọi
   * dịch cả bốn lý do thành cùng một lỗi.
   */
  async consumeByTokenHash(
    input: { tokenHash: string; now: Date },
    tx: Executor,
  ): Promise<ConsumedInvitation | undefined> {
    const [row] = await tx
      .update(workspaceInvitations)
      .set({ status: "accepted", acceptedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(workspaceInvitations.tokenHash, input.tokenHash),
          eq(workspaceInvitations.status, "pending"),
          gt(workspaceInvitations.expiresAt, input.now),
        ),
      )
      .returning({
        id: workspaceInvitations.id,
        workspaceId: workspaceInvitations.workspaceId,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
      });

    if (row === undefined) return undefined;

    // Tên workspace cho response; đọc sau khi đã tiêu thụ nên không có nhánh
    // nào lộ tên workspace cho một token không hợp lệ.
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId));

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: workspace?.name ?? "",
      email: row.email,
      role: row.role as WorkspaceRole,
    };
  }

  /**
   * Huỷ hiệu lực mọi lời mời `pending` của một email trong một workspace.
   *
   * Dùng khi người đó **đã** là member: không tạo lời mời mới, nhưng cũng không
   * để một lời mời cũ còn treo — chấp nhận nó sau đó sẽ cố tạo membership thứ
   * hai và va vào unique constraint.
   */
  async revokePendingForEmail(
    input: { workspaceId: string; email: string; now: Date },
    tx: Executor,
  ): Promise<number> {
    const rows = await tx
      .update(workspaceInvitations)
      .set({ status: "revoked", updatedAt: input.now })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, input.workspaceId),
          eq(workspaceInvitations.email, input.email),
          eq(workspaceInvitations.status, "pending"),
        ),
      )
      .returning({ id: workspaceInvitations.id });
    return rows.length;
  }

  /** Chỉ dùng cho test/chẩn đoán: đếm lời mời theo trạng thái. */
  async countByStatus(workspaceId: string, status: string, tx?: Executor): Promise<number> {
    const [row] = await (tx ?? this.#db)
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.status, status),
        ),
      );
    return row?.n ?? 0;
  }
}
