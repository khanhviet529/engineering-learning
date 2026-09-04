import type { WorkspaceRole } from "@flowboard/contracts";
import type { Database } from "../../../shared/database/client.ts";
import type { RecordOutcome } from "../../../shared/http/idempotency-runner.ts";
import { AppError } from "../../../shared/errors/app-error.ts";
import type { Actor, AuthorizationService } from "../../../shared/authorization/index.ts";
import { workspaceCapabilities } from "../../../shared/authorization/index.ts";
import {
  buildPage,
  decodeCursor,
  queryFingerprint,
  type PageResult,
} from "../../../shared/http/cursor.ts";
import {
  CREATOR_WORKSPACE_ROLE,
  assertCanProvisionWorkspace,
  assertNoDependentProjectMembership,
} from "../domain/workspace-rules.ts";
import type { WorkspaceRepository } from "../infrastructure/workspace-repository.ts";

/**
 * Use case của module `workspaces`.
 *
 * Use case điều phối: authorize, validate, mở transaction, gọi repository và
 * quyết định outcome. Nó **không** biết HTTP — không status, không header,
 * không cookie. Nhờ vậy chúng test được mà không cần dựng server.
 */

/**
 * ## Nợ đã biết: activity của workspace
 *
 * Hợp đồng nói rõ các mutation cấp workspace **không** tạo project ActivityLog,
 * vì ActivityLog là project-scoped: "không có project ActivityLog vì ActivityLog
 * project-scoped" (`POST /workspaces`), và "không auto-add user vào project và
 * không tạo project activity" (`POST /workspaces/:id/members`).
 *
 * Nên ở tầng này **không có nợ activity nào** — khác với module `projects`, nơi
 * năm mutation đang thiếu event cho tới khi bảng `activity_logs` tồn tại.
 */

export interface WorkspaceDeps {
  db: Database;
  repository: WorkspaceRepository;
  authorization: AuthorizationService;
  /** Secret ký cursor. Cursor phải chống sửa đổi, không chỉ opaque. */
  cursorSecret: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  capabilities: string[];
}

export interface WorkspaceMemberView {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export class WorkspaceUseCases {
  readonly #deps: WorkspaceDeps;

  constructor(deps: WorkspaceDeps) {
    this.#deps = deps;
  }

  /**
   * `GET /workspaces` — workspace mà actor là thành viên.
   *
   * Không có guard permission ở route này vì không có resource cụ thể để
   * authorize: scope **chính là** kết quả. Repository chỉ trả workspace có dòng
   * membership của actor, nên một người không thuộc workspace nào nhận danh
   * sách rỗng — không phải `403`, và không phải một tín hiệu rằng có workspace
   * nào đó tồn tại.
   */
  async listWorkspacesForActor(
    actor: Actor,
    input: { limit: number; cursor?: string },
  ): Promise<PageResult<WorkspaceSummary>> {
    // Fingerprint bind actor: cursor của người này không dùng được cho người
    // kia, kể cả khi ai đó bắt được giá trị cursor trên đường truyền.
    const fingerprint = queryFingerprint({
      list: "workspaces",
      actor: actor.id,
      sort: "createdAt:desc,id:desc",
    });

    const after =
      input.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(input.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAt: new Date(decoded.sortKey), id: decoded.id };
          })();

    const rows = await this.#deps.repository.findWorkspacesForActor(actor.id, input.limit, after);

    return buildPage(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        capabilities: workspaceCapabilities(row.role),
        createdAt: row.createdAt,
      })),
      input.limit,
      fingerprint,
      this.#deps.cursorSecret,
      (row) => ({ sortKey: row.createdAt.toISOString(), id: row.id }),
    ) as PageResult<WorkspaceSummary>;
  }

  /**
   * `POST /workspaces` — tạo workspace.
   *
   * Creation **atomically** thiết lập membership admin của creator: nếu hai
   * bước tách ra và bước thứ hai hỏng, kết quả là một workspace không ai quản
   * trị được, và không có đường nào sửa qua API.
   */
  async createWorkspace(
    actor: Actor,
    input: { name: string },
    recordOutcome?: RecordOutcome,
    toOutcomeBody?: (summary: WorkspaceSummary) => unknown,
  ): Promise<WorkspaceSummary> {
    assertCanProvisionWorkspace(actor);

    return await this.#deps.db.transaction(async (tx) => {
      const workspace = await this.#deps.repository.createWorkspaceWithAdmin(
        { name: input.name, creatorUserId: actor.id, creatorRole: CREATOR_WORKSPACE_ROLE },
        tx,
      );

      const summary: WorkspaceSummary = {
        id: workspace.id,
        name: workspace.name,
        role: CREATOR_WORKSPACE_ROLE,
        capabilities: workspaceCapabilities(CREATOR_WORKSPACE_ROLE),
      };

      // Outcome idempotency ghi trong **cùng** transaction với mutation.
      if (recordOutcome !== undefined && toOutcomeBody !== undefined) {
        await recordOutcome(tx, toOutcomeBody(summary));
      }

      return summary;
    });
  }

  /**
   * `GET /workspaces/:workspaceId/members`.
   *
   * Guard đã cưỡng chế `workspace:member:manage` trước khi tới đây, nên actor
   * chắc chắn là Workspace Admin của đúng workspace này. Repository vẫn scope
   * theo `workspaceId` — lớp thứ hai, độc lập.
   */
  async listWorkspaceMembers(
    actor: Actor,
    workspaceId: string,
    input: { limit: number; cursor?: string },
  ): Promise<PageResult<WorkspaceMemberView>> {
    const fingerprint = queryFingerprint({
      list: "workspace-members",
      actor: actor.id,
      workspace: workspaceId,
      sort: "createdAt:desc,userId:desc",
    });

    const after =
      input.cursor === undefined
        ? undefined
        : (() => {
            const decoded = decodeCursor(input.cursor, fingerprint, this.#deps.cursorSecret);
            return { createdAt: new Date(decoded.sortKey), id: decoded.id };
          })();

    const rows = await this.#deps.repository.findMembersOfWorkspace(
      workspaceId,
      input.limit,
      after,
    );

    return buildPage(rows, input.limit, fingerprint, this.#deps.cursorSecret, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.userId,
    }));
  }

  /**
   * `addWorkspaceMember` (thêm trực tiếp bằng `userId`) đã bị **xoá**.
   *
   * ADR-0013 thay nó bằng lời mời qua email; use case mới ở
   * `application/invitation-use-cases.ts`. Giữ lại hàm cũ nghĩa là giữ một
   * đường tạo membership thứ hai không đi qua lời mời — và đường đó chính là
   * thứ ADR-0013 loại bỏ.
   *
   * `repository.addMember` vẫn còn, vì luồng chấp nhận lời mời gọi nó.
   */

  /**
   * `DELETE /workspaces/:workspaceId/members/:userId`.
   *
   * Bất biến được kiểm **bên trong** transaction, không phải trước khi mở nó:
   * giữa một lần đọc ngoài transaction và lần ghi sau đó, một Owner ở project
   * khác có thể vừa thêm chính người này vào project. Đọc và ghi phải nhìn cùng
   * một ảnh chụp.
   */
  async removeWorkspaceMember(
    workspaceId: string,
    userId: string,
    recordOutcome?: RecordOutcome,
  ): Promise<void> {
    await this.#deps.db.transaction(async (tx) => {
      const existing = await this.#deps.repository.findMembership(workspaceId, userId, tx);
      // Không có membership: `404`. Đây là resource của chính route
      // (`/members/:userId`), nên "không tồn tại" là câu trả lời đúng.
      if (existing === undefined) throw new AppError("NOT_FOUND");

      const dependents = await this.#deps.repository.countProjectMembershipsInWorkspace(
        workspaceId,
        userId,
        tx,
      );
      assertNoDependentProjectMembership(dependents);

      await this.#deps.repository.removeMember({ workspaceId, userId }, tx);

      if (recordOutcome !== undefined) await recordOutcome(tx, null);
    });
  }
}
