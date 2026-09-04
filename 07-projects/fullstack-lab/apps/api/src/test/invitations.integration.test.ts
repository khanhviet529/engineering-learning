import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { listEnvelopeSchema, pendingInvitationSchema } from "@flowboard/contracts";
import { workspaceInvitations, workspaceMembers } from "../shared/database/schema.ts";
import { hashOneTimeToken } from "../shared/security/one-time-token.ts";
import { call, createFixture, newKey, type Fixture, type TestActor } from "./fixture.ts";

/**
 * Lời mời workspace — [ADR-0013](../../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Điều test này phải chứng minh khó hơn "endpoint chạy đúng": nó phải chứng
 * minh rằng ba nhánh của việc mời **không phân biệt được từ bên ngoài**. Một
 * response đúng ở nhánh này và một response đúng ở nhánh kia chưa đủ — chúng
 * phải **giống hệt nhau**, và cách duy nhất kiểm được điều đó là so trực tiếp
 * hai response với nhau, không phải so từng cái với một hằng số.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("lời mời workspace", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  /**
   * Đưa fixture về đúng tiền đề trước **mỗi** test, thay vì tin vào việc test
   * trước đã dọn.
   *
   * Nhiều test ở đây dùng `f.outsider` với nghĩa "có account, **chưa** là
   * member" — đó là điều làm nó rơi vào nhánh 2 chứ không phải nhánh 3. Nếu một
   * test thêm họ vào workspace rồi không gỡ ra (ví dụ vì một assertion trước đó
   * ném), test kế tiếp sẽ đo **nhầm nhánh** và đỏ vì lý do không liên quan tới
   * thứ nó kiểm.
   *
   * Dọn ở `beforeEach` thay vì `afterEach` là có chủ đích: `afterEach` không
   * chạy phần còn lại khi test ném giữa chừng, nên nó bảo vệ đúng những lúc
   * không cần bảo vệ. `beforeEach` thì luôn chạy.
   */
  beforeEach(async () => {
    // Hạn mức mời là 10/phút cho một địa chỉ. Cả suite gọi từ cùng một IP, nên
    // không dọn thì các case sau đo `429` thay vì đo thứ chúng định đo.
    f.limiter.reset();

    await f.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, f.workspaceId),
          eq(workspaceMembers.userId, f.outsider.id),
        ),
      );
  });

  afterAll(async () => {
    await f.cleanup();
  });

  const invite = async (
    actor: TestActor,
    email: string,
    role: "workspace_admin" | "workspace_member" = "workspace_member",
    workspaceId?: string,
  ) =>
    await call(f, "POST", `/workspaces/${workspaceId ?? f.workspaceId}/members`, {
      actor,
      idempotencyKey: newKey("inv"),
      body: { email, role },
    });

  const listInvitations = async (actor: TestActor, query = "", workspaceId?: string) =>
    await call(f, "GET", `/workspaces/${workspaceId ?? f.workspaceId}/invitations${query}`, {
      actor,
    });

  const accept = async (actor: TestActor, token: string) =>
    await call(f, "POST", "/invitations/accept", { actor, body: { token } });

  /** Xoá mọi lời mời của workspace fixture, để mỗi case bắt đầu từ trạng thái biết trước. */
  const clearInvitations = async (): Promise<void> => {
    await f.db
      .delete(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, f.workspaceId));
  };

  const pendingRow = async (email: string) => {
    const [row] = await f.db
      .select({
        id: workspaceInvitations.id,
        status: workspaceInvitations.status,
        tokenHash: workspaceInvitations.tokenHash,
        role: workspaceInvitations.role,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, f.workspaceId),
          eq(workspaceInvitations.email, email),
        ),
      );
    return row;
  };

  /** Bỏ `requestId` — phần duy nhất được phép khác giữa hai response. */
  const comparable = (body: Record<string, unknown>) => ({ ...body, requestId: "<redacted>" });

  describe("ba nhánh của 202 không phân biệt được từ bên ngoài", () => {
    it("email chưa có account, email đã có account, và đã là member cho CÙNG một response", async () => {
      await clearInvitations();

      // Nhánh 1: địa chỉ chưa từng có account nào.
      const strangerEmail = `nguoi-la-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const stranger = await invite(f.wsAdmin, strangerEmail);

      // Nhánh 2: `userA` có account nhưng chưa thuộc workspace này? — không,
      // `userA` **là** member. Dùng `outsider`: có account, ngoài workspace.
      const withAccount = await invite(f.wsAdmin, f.outsider.email);

      // Nhánh 3: `editor` đã là member của chính workspace này.
      const alreadyMember = await invite(f.wsAdmin, f.editor.email);

      // Cả ba: cùng status.
      expect(stranger.status).toBe(202);
      expect(withAccount.status).toBe(202);
      expect(alreadyMember.status).toBe(202);

      // Cả ba: cùng body, so **với nhau** chứ không so với hằng số. Một lỗi ở
      // hằng số sẽ làm cả ba cùng sai mà vẫn pass; so chéo thì không.
      expect(comparable(stranger.body)).toEqual(comparable(withAccount.body));
      expect(comparable(withAccount.body)).toEqual(comparable(alreadyMember.body));
      expect(stranger.body["data"]).toEqual({ accepted: true });

      // Và cùng bộ header — không có header nào rò ra nhánh nào đã chạy.
      const headerKeys = (r: typeof stranger) => Object.keys(r.headers).sort();
      expect(headerKeys(stranger)).toEqual(headerKeys(alreadyMember));
    });

    it("nhánh 'đã là member' KHÔNG tạo lời mời và KHÔNG gửi thư", async () => {
      await clearInvitations();
      const before = f.mailer.invitations.length;

      await invite(f.wsAdmin, f.editor.email);

      // Không có bản ghi nào cho địa chỉ đó.
      expect(await pendingRow(f.editor.email)).toBeUndefined();
      // Và không lá thư nào đi ra — người đã là member không cần thư mời.
      expect(f.mailer.invitations.length).toBe(before);
    });

    it("nhánh 'đã là member' thu hồi lời mời pending cũ nếu có", async () => {
      await clearInvitations();

      // Mời `outsider` (chưa là member) rồi cho họ vào workspace bằng đường khác.
      await invite(f.wsAdmin, f.outsider.email);
      expect((await pendingRow(f.outsider.email))?.status).toBe("pending");

      await f.db
        .insert(workspaceMembers)
        .values({ workspaceId: f.workspaceId, userId: f.outsider.id, role: "workspace_member" });

      try {
        // Mời lại: nay họ đã là member.
        const response = await invite(f.wsAdmin, f.outsider.email);
        expect(response.status).toBe(202);

        /**
         * Lời mời cũ phải thành `revoked`.
         *
         * Để nó treo thì chấp nhận nó sau đó sẽ cố tạo membership thứ hai và
         * đâm vào unique constraint — một `500` cho một trạng thái lẽ ra không
         * nên tồn tại.
         */
        expect((await pendingRow(f.outsider.email))?.status).toBe("revoked");
      } finally {
        await f.db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, f.workspaceId),
              eq(workspaceMembers.userId, f.outsider.id),
            ),
          );
      }
    });

    it("email không xuất hiện trong body của bất kỳ response nào", async () => {
      await clearInvitations();
      const secret = `bi-mat-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const response = await invite(f.wsAdmin, secret);
      expect(JSON.stringify(response.body)).not.toContain(secret);
    });
  });

  describe("email không được vào log", () => {
    it("không dòng log nào chứa địa chỉ được mời", async () => {
      await clearInvitations();
      const secret = `khong-log-${crypto.randomUUID().slice(0, 8)}@example.test`;

      /**
       * Bắt **cả ba** kênh console, kể cả `log`.
       *
       * `no-console` cấm `console.log` vì lý do đúng: nó không nên có trong code
       * chạy thật. Nhưng test này tồn tại để chứng minh rằng **không kênh nào**
       * mang địa chỉ email ra ngoài, và chỉ bắt hai kênh được phép sẽ để hở đúng
       * kênh mà một lệnh debug bỏ quên hay dùng nhất.
       */
      const captured: string[] = [];
      /* eslint-disable no-console */
      const original = { log: console.log, warn: console.warn, error: console.error };
      const capture = (...args: unknown[]): void => void captured.push(args.map(String).join(" "));
      console.log = capture;
      console.warn = capture;
      console.error = capture;
      /* eslint-enable no-console */

      try {
        // Nhánh thành công.
        await invite(f.wsAdmin, secret);
        // Nhánh lỗi: `403` cho người không đủ quyền — message của lỗi cũng
        // không được nhắc lại địa chỉ.
        await invite(f.editor, secret);
        // Nhánh `404`: workspace không thấy được.
        await invite(f.outsider, secret);
      } finally {
        /* eslint-disable no-console */
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
        /* eslint-enable no-console */
      }

      const joined = captured.join("\n");
      expect(joined).not.toContain(secret);
      // Kể cả phần local-part cũng không được lọt ra.
      expect(joined).not.toContain(secret.split("@")[0] as string);
    });
  });

  describe("partial unique index giữ đúng một lời mời pending", () => {
    it("mời hai lần cho cùng cặp (workspace, email) chỉ để lại MỘT hàng", async () => {
      await clearInvitations();
      const email = `ghi-de-${crypto.randomUUID().slice(0, 8)}@example.test`;

      await invite(f.wsAdmin, email, "workspace_member");
      await invite(f.wsAdmin, email, "workspace_admin");

      const [row] = await f.db
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.workspaceId, f.workspaceId),
            eq(workspaceInvitations.email, email),
          ),
        );
      expect(row?.n).toBe(1);

      // Ghi đè cũng cập nhật `role` của lời mời.
      expect((await pendingRow(email))?.role).toBe("workspace_admin");
    });

    it("token cũ mất hiệu lực NGAY khi token mới sinh ra", async () => {
      await clearInvitations();
      const email = f.outsider.email;

      await invite(f.wsAdmin, email);
      const firstToken = f.mailer.lastTokenFor(email);
      expect(firstToken).toBeTruthy();

      await invite(f.wsAdmin, email);
      const secondToken = f.mailer.lastTokenFor(email);
      expect(secondToken).not.toBe(firstToken);

      // Token cũ: không dùng được nữa.
      const withOld = await accept(f.outsider, firstToken as string);
      expect(withOld.status).toBe(400);

      // Token mới: dùng được — đối chứng dương, để "400" ở trên không phải vì
      // một lý do khác.
      const withNew = await accept(f.outsider, secondToken as string);
      expect(withNew.status).toBe(200);

      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
    });

    it("database chặn hai hàng pending, không phải use case", async () => {
      await clearInvitations();
      const email = `truc-tiep-${crypto.randomUUID().slice(0, 8)}@example.test`;

      const row = {
        workspaceId: f.workspaceId,
        email,
        role: "workspace_member" as const,
        invitedByUserId: f.wsAdmin.id,
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
      };

      await f.db.insert(workspaceInvitations).values({ ...row, tokenHash: "hash-mot" });

      /**
       * Insert thứ hai đi **thẳng vào database**, bỏ qua mọi use case.
       *
       * Đây là điều phân biệt "index cưỡng chế" với "use case cưỡng chế": nếu
       * quy tắc chỉ nằm ở use case, câu này sẽ thành công và workspace có hai
       * lời mời pending với hai token — thu hồi một cái không giết được cái kia.
       */
      await expect(
        f.db.insert(workspaceInvitations).values({ ...row, tokenHash: "hash-hai" }),
      ).rejects.toThrow();

      // Nhưng một hàng **không** pending thì được: index là partial.
      await f.db.insert(workspaceInvitations).values({
        ...row,
        tokenHash: "hash-ba",
        status: "revoked",
      });
    });
  });

  describe("chấp nhận lời mời", () => {
    it("tạo membership và trả workspace vừa tham gia", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email, "workspace_admin");
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;

      const response = await accept(f.outsider, token);
      expect(response.status).toBe(200);

      const workspace = (response.body["data"] as { workspace: { id: string; role: string } })
        .workspace;
      expect(workspace.id).toBe(f.workspaceId);
      expect(workspace.role).toBe("workspace_admin");

      const [membership] = await f.db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
      expect(membership?.role).toBe("workspace_admin");

      // Lời mời đã bị tiêu thụ.
      expect((await pendingRow(f.outsider.email))?.status).toBe("accepted");

      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
    });

    it("hai request cùng token: đúng MỘT thành công", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;

      /**
       * Gửi **đồng thời**, không tuần tự.
       *
       * Tuần tự chỉ chứng minh "lần hai thấy trạng thái đã đổi" — điều đúng cả
       * khi code dùng `SELECT` rồi `UPDATE`. Đồng thời mới chạm được cửa sổ
       * giữa hai câu lệnh đó, và điều kiện trong `WHERE` của `UPDATE` là thứ
       * đóng cửa sổ ấy.
       */
      const [a, b] = await Promise.all([accept(f.outsider, token), accept(f.outsider, token)]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 400]);

      // Đúng một membership, không phải hai.
      const [count] = await f.db
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
      expect(count?.n).toBe(1);

      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
    });

    it("email không khớp → 403, và lời mời vẫn dùng được cho người đúng", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;

      // `userA` đăng nhập bằng email khác.
      const wrong = await accept(f.userA, token);
      expect(wrong.status).toBe(403);
      expect((wrong.body["error"] as { code: string }).code).toBe("FORBIDDEN");

      // Thông điệp chỉ đúng việc phải làm...
      const message = (wrong.body["error"] as { message: string }).message;
      expect(message).toContain("đăng nhập");
      // ...nhưng **không** nhắc lại địa chỉ được mời: nếu token rơi vào tay
      // người khác, response này không được là chỗ họ đọc ra địa chỉ đó.
      expect(message).not.toContain(f.outsider.email);

      /**
       * Và quan trọng nhất: lời mời **vẫn `pending`**.
       *
       * Use case tiêu thụ token trước rồi mới so email, nên nhánh này chỉ đúng
       * khi lỗi được ném **trong** transaction và rollback. Nếu ai đó chuyển
       * phép so email ra sau transaction, test này đỏ.
       */
      expect((await pendingRow(f.outsider.email))?.status).toBe("pending");

      const right = await accept(f.outsider, token);
      expect(right.status).toBe(200);

      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
    });

    it("invalid, hết hạn, đã dùng, đã thu hồi → CÙNG một 400, giống nhau từng byte", async () => {
      await clearInvitations();

      // (1) token bịa
      const invalid = await accept(f.outsider, "khong-phai-token-that-nhung-du-dai-de-qua-schema");

      // (2) hết hạn
      await f.db.insert(workspaceInvitations).values({
        workspaceId: f.workspaceId,
        email: f.outsider.email,
        role: "workspace_member",
        invitedByUserId: f.wsAdmin.id,
        tokenHash: hashOneTimeToken("token-het-han"),
        status: "pending",
        expiresAt: new Date(Date.now() - 1_000),
      });
      const expired = await accept(f.outsider, "token-het-han");
      await clearInvitations();

      // (3) đã dùng
      await invite(f.wsAdmin, f.outsider.email);
      const usedToken = f.mailer.lastTokenFor(f.outsider.email) as string;
      await accept(f.outsider, usedToken);
      const used = await accept(f.outsider, usedToken);
      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
      await clearInvitations();

      // (4) đã thu hồi
      await invite(f.wsAdmin, f.outsider.email);
      const revokedToken = f.mailer.lastTokenFor(f.outsider.email) as string;
      const invitationId = (await pendingRow(f.outsider.email))?.id as string;
      await call(f, "DELETE", `/workspaces/${f.workspaceId}/invitations/${invitationId}`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("rev"),
      });
      const revoked = await accept(f.outsider, revokedToken);

      for (const response of [invalid, expired, used, revoked]) {
        expect(response.status).toBe(400);
      }

      /**
       * So **chéo** cả bốn, không so với một hằng số.
       *
       * Bốn nhánh riêng lẻ đều "đúng" khi mỗi cái trả `400`; điều phải chứng
       * minh là chúng không phân biệt được. Một `message` khác nhau ở một nhánh
       * là câu trả lời cho "token này từng tồn tại chưa?".
       */
      expect(comparable(expired.body)).toEqual(comparable(invalid.body));
      expect(comparable(used.body)).toEqual(comparable(invalid.body));
      expect(comparable(revoked.body)).toEqual(comparable(invalid.body));
    });

    it("thu hồi có hiệu lực NGAY — revoke rồi accept trong cùng một test", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;
      const invitationId = (await pendingRow(f.outsider.email))?.id as string;

      const revoked = await call(
        f,
        "DELETE",
        `/workspaces/${f.workspaceId}/invitations/${invitationId}`,
        { actor: f.wsAdmin, idempotencyKey: newKey("rev-now") },
      );
      expect(revoked.status).toBe(204);

      // Không có bước dọn nào ở giữa: token chết từ chính lúc commit.
      expect((await accept(f.outsider, token)).status).toBe(400);
    });

    it("không có session → 401, và không tạo membership", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;

      const response = await call(f, "POST", "/invitations/accept", { body: { token } });
      expect(response.status).toBe(401);

      // Endpoint này không tạo account và không tạo membership cho người lạ.
      expect((await pendingRow(f.outsider.email))?.status).toBe("pending");
    });

    it("thiếu CSRF → 403", async () => {
      await clearInvitations();
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;

      const response = await call(f, "POST", "/invitations/accept", {
        actor: f.outsider,
        csrf: false,
        body: { token },
      });
      expect(response.status).toBe(403);
      expect((await pendingRow(f.outsider.email))?.status).toBe("pending");
    });
  });

  describe("GET /workspaces/:workspaceId/invitations", () => {
    it("chỉ trả pending, đúng projection, không rò tokenHash", async () => {
      await clearInvitations();
      const email = `hien-thi-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, email);

      const response = await listInvitations(f.wsAdmin);
      expect(response.status).toBe(200);

      const schema = listEnvelopeSchema(pendingInvitationSchema);
      expect(() => schema.parse(response.body)).not.toThrow();

      const serialized = JSON.stringify(response.body);
      const row = await pendingRow(email);
      expect(serialized).not.toContain(row?.tokenHash as string);
      expect(serialized).not.toContain("tokenHash");
      expect(serialized).not.toContain("status");
    });

    it("không trả lời mời đã accepted hay revoked", async () => {
      await clearInvitations();
      const base = {
        workspaceId: f.workspaceId,
        role: "workspace_member" as const,
        invitedByUserId: f.wsAdmin.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      await f.db.insert(workspaceInvitations).values([
        { ...base, email: "cho@example.test", tokenHash: "h-pending", status: "pending" },
        {
          ...base,
          email: "da-nhan@example.test",
          tokenHash: "h-accepted",
          status: "accepted",
          acceptedAt: new Date(),
        },
        { ...base, email: "da-thu-hoi@example.test", tokenHash: "h-revoked", status: "revoked" },
      ]);

      const body = (await listInvitations(f.wsAdmin)).body as unknown as {
        data: { items: { email: string }[] };
      };
      const emails = body.data.items.map((i) => i.email);

      expect(emails).toContain("cho@example.test");
      expect(emails).not.toContain("da-nhan@example.test");
      expect(emails).not.toContain("da-thu-hoi@example.test");
    });

    it("không trả lời mời đã hết hạn", async () => {
      await clearInvitations();
      await f.db.insert(workspaceInvitations).values({
        workspaceId: f.workspaceId,
        email: "qua-han@example.test",
        role: "workspace_member",
        invitedByUserId: f.wsAdmin.id,
        tokenHash: "h-expired",
        status: "pending",
        expiresAt: new Date(Date.now() - 1_000),
      });

      const body = (await listInvitations(f.wsAdmin)).body as unknown as {
        data: { items: { email: string }[] };
      };
      // Vẫn mang `status = 'pending'` trong database, nhưng không dùng được nữa
      // — trả nó ra danh sách "đang chờ" là nói sai với người đang quản trị.
      expect(body.data.items.map((i) => i.email)).not.toContain("qua-han@example.test");
    });

    it("không trả lời mời của workspace khác", async () => {
      await clearInvitations();

      const other = await call(f, "POST", "/workspaces", {
        actor: f.wsAdmin,
        idempotencyKey: newKey("ws-khac"),
        body: { name: "Không gian khác" },
      });
      const otherWorkspaceId = (other.body["data"] as { workspace: { id: string } }).workspace.id;

      const hereEmail = `o-day-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const thereEmail = `o-kia-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, hereEmail);
      await invite(f.wsAdmin, thereEmail, "workspace_member", otherWorkspaceId);

      const here = (await listInvitations(f.wsAdmin)).body as unknown as {
        data: { items: { email: string }[] };
      };
      expect(here.data.items.map((i) => i.email)).toContain(hereEmail);
      expect(here.data.items.map((i) => i.email)).not.toContain(thereEmail);

      // Đối chứng dương: ở workspace của nó thì thấy được.
      const there = (await listInvitations(f.wsAdmin, "", otherWorkspaceId)).body as unknown as {
        data: { items: { email: string }[] };
      };
      expect(there.data.items.map((i) => i.email)).toContain(thereEmail);
    });

    it("thứ tự createdAt DESC, id DESC và cursor đi hết danh sách", async () => {
      await clearInvitations();
      for (let i = 0; i < 3; i++) {
        await invite(
          f.wsAdmin,
          `thu-tu-${String(i)}-${crypto.randomUUID().slice(0, 6)}@example.test`,
        );
      }

      const full = (await listInvitations(f.wsAdmin, "?limit=100")).body as unknown as {
        data: { items: { id: string; createdAt: string }[] };
      };
      const items = full.data.items;
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1] as { id: string; createdAt: string };
        const cur = items[i] as { id: string; createdAt: string };
        const older = prev.createdAt > cur.createdAt;
        const sameInstantLowerId = prev.createdAt === cur.createdAt && prev.id > cur.id;
        expect(older || sameInstantLowerId).toBe(true);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const query: string =
          cursor === null ? "?limit=1" : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
        const page = (await listInvitations(f.wsAdmin, query)).body as unknown as {
          data: { items: { id: string }[]; page: { nextCursor: string | null } };
        };
        seen.push(...page.data.items.map((i) => i.id));
        cursor = page.data.page.nextCursor;
        guard += 1;
      } while (cursor !== null && guard < 30);

      expect(seen).toEqual(items.map((i) => i.id));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("cursor của workspace khác → 400", async () => {
      await clearInvitations();
      const other = await call(f, "POST", "/workspaces", {
        actor: f.wsAdmin,
        idempotencyKey: newKey("ws-cursor"),
        body: { name: "Không gian cursor" },
      });
      const otherWorkspaceId = (other.body["data"] as { workspace: { id: string } }).workspace.id;

      for (let i = 0; i < 2; i++) {
        await invite(
          f.wsAdmin,
          `cursor-${String(i)}-${crypto.randomUUID().slice(0, 6)}@example.test`,
          "workspace_member",
          otherWorkspaceId,
        );
      }

      const page = (await listInvitations(f.wsAdmin, "?limit=1", otherWorkspaceId))
        .body as unknown as { data: { page: { nextCursor: string } } };
      const cursor = page.data.page.nextCursor;
      expect(cursor).toBeTruthy();

      const reused = await listInvitations(
        f.wsAdmin,
        `?limit=1&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(reused.status).toBe(400);
    });

    it("query field lạ và limit ngoài khoảng → 400", async () => {
      expect((await listInvitations(f.wsAdmin, "?status=pending")).status).toBe(400);
      expect((await listInvitations(f.wsAdmin, "?limit=0")).status).toBe(400);
      expect((await listInvitations(f.wsAdmin, "?limit=101")).status).toBe(400);
    });
  });

  describe("DELETE .../invitations/:invitationId — bốn nhánh cùng một 404", () => {
    it("không tồn tại, workspace khác, đã accepted, đã revoked", async () => {
      await clearInvitations();

      const revoke = async (invitationId: string, workspaceId?: string) =>
        await call(
          f,
          "DELETE",
          `/workspaces/${workspaceId ?? f.workspaceId}/invitations/${invitationId}`,
          { actor: f.wsAdmin, idempotencyKey: newKey("rev4") },
        );

      // (1) không tồn tại
      const missing = await revoke("00000000-0000-4000-8000-0000000000ff");

      // (2) thuộc workspace khác — ID **có thật**, chỉ là không phải của
      // workspace trên URL. Đây là chỗ `workspace_id` trong `WHERE` chứng minh
      // giá trị của nó: thiếu nó, câu này sẽ thu hồi thành công.
      const other = await call(f, "POST", "/workspaces", {
        actor: f.wsAdmin,
        idempotencyKey: newKey("ws-404"),
        body: { name: "Không gian 404" },
      });
      const otherWorkspaceId = (other.body["data"] as { workspace: { id: string } }).workspace.id;
      const otherEmail = `khac-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, otherEmail, "workspace_member", otherWorkspaceId);
      const [otherRow] = await f.db
        .select({ id: workspaceInvitations.id, status: workspaceInvitations.status })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, otherWorkspaceId));
      const crossWorkspace = await revoke(otherRow?.id as string);

      // (3) đã accepted
      await invite(f.wsAdmin, f.outsider.email);
      const token = f.mailer.lastTokenFor(f.outsider.email) as string;
      const acceptedId = (await pendingRow(f.outsider.email))?.id as string;
      await accept(f.outsider, token);
      const alreadyAccepted = await revoke(acceptedId);

      // (4) đã revoked
      const revokedEmail = `da-thu-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, revokedEmail);
      const revokedId = (await pendingRow(revokedEmail))?.id as string;
      expect((await revoke(revokedId)).status).toBe(204);
      const alreadyRevoked = await revoke(revokedId);

      for (const response of [missing, crossWorkspace, alreadyAccepted, alreadyRevoked]) {
        expect(response.status).toBe(404);
      }
      // Cùng body, so chéo — không nhánh nào tiết lộ trạng thái lời mời.
      expect(comparable(crossWorkspace.body)).toEqual(comparable(missing.body));
      expect(comparable(alreadyAccepted.body)).toEqual(comparable(missing.body));
      expect(comparable(alreadyRevoked.body)).toEqual(comparable(missing.body));

      // Lời mời của workspace khác **vẫn nguyên**: `404` không phải là một lần
      // thu hồi im lặng.
      const [stillThere] = await f.db
        .select({ status: workspaceInvitations.status })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, otherRow?.id as string));
      expect(stillThere?.status).toBe("pending");

      await f.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, f.workspaceId),
            eq(workspaceMembers.userId, f.outsider.id),
          ),
        );
    });
  });

  describe("phân quyền", () => {
    it("member thường không mời được → 403; người ngoài workspace → 404", async () => {
      const inside = await invite(f.editor, "ai-do@example.test");
      expect(inside.status).toBe(403);

      const outside = await invite(f.outsider, "ai-do@example.test");
      expect(outside.status).toBe(404);
    });

    it("mọi route lời mời: ngoài workspace → 404, member thiếu quyền → 403", async () => {
      const routes: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown }[] = [
        { method: "GET", path: `/workspaces/${f.workspaceId}/invitations` },
        {
          method: "POST",
          path: `/workspaces/${f.workspaceId}/members`,
          body: { email: "x@example.test", role: "workspace_member" },
        },
        {
          method: "DELETE",
          path: `/workspaces/${f.workspaceId}/invitations/00000000-0000-4000-8000-000000000001`,
        },
      ];

      for (const route of routes) {
        const outside = await call(f, route.method, route.path, {
          actor: f.outsider,
          idempotencyKey: newKey("perm404"),
          ...(route.body === undefined ? {} : { body: route.body }),
        });
        expect(outside.status, `${route.method} ${route.path} — ngoài workspace`).toBe(404);

        const insideNoRight = await call(f, route.method, route.path, {
          actor: f.editor,
          idempotencyKey: newKey("perm403"),
          ...(route.body === undefined ? {} : { body: route.body }),
        });
        expect(insideNoRight.status, `${route.method} ${route.path} — member thường`).toBe(403);
      }
    });
  });

  describe("rate limit", () => {
    it("vượt hạn mức → 429 kèm Retry-After, và KHÔNG gửi thêm thư", async () => {
      f.limiter.reset();
      const sent = f.mailer.invitations.length;

      let limited: Awaited<ReturnType<typeof invite>> | undefined;
      for (let i = 0; i < 15; i++) {
        const response = await invite(
          f.wsAdmin,
          `spam-${String(i)}-${crypto.randomUUID().slice(0, 6)}@example.test`,
        );
        if (response.status === 429) {
          limited = response;
          break;
        }
      }

      expect(limited).toBeDefined();
      expect(limited?.status).toBe(429);
      expect(limited?.headers["retry-after"]).toBeDefined();

      // Hạn mức là 10/phút: số thư đi ra không được vượt quá nó.
      expect(f.mailer.invitations.length - sent).toBeLessThanOrEqual(10);
    });

    it("rate limit chạy TRƯỚC khi gửi thư", async () => {
      f.limiter.reset();
      // Dùng hết hạn mức.
      for (let i = 0; i < 10; i++) {
        await invite(
          f.wsAdmin,
          `dung-het-${String(i)}-${crypto.randomUUID().slice(0, 6)}@example.test`,
        );
      }

      const before = f.mailer.invitations.length;
      const blocked = await invite(
        f.wsAdmin,
        `bi-chan-${crypto.randomUUID().slice(0, 6)}@example.test`,
      );

      expect(blocked.status).toBe(429);
      // Không một lá thư nào đi ra cho request bị chặn. Giới hạn đặt **sau**
      // lần gửi là giới hạn đã cho phép lá thư đó đi.
      expect(f.mailer.invitations.length).toBe(before);
    });
  });

  describe("idempotency", () => {
    it("retry cùng key và payload phát lại 202, không tạo lời mời thứ hai", async () => {
      await clearInvitations();
      const email = `idem-${crypto.randomUUID().slice(0, 8)}@example.test`;
      const key = newKey("idem-inv");
      const body = { email, role: "workspace_member" as const };

      const first = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });
      const sentAfterFirst = f.mailer.invitations.length;

      const second = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
        actor: f.wsAdmin,
        idempotencyKey: key,
        body,
      });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(comparable(second.body)).toEqual(comparable(first.body));

      // Replay **không** gửi lá thư thứ hai.
      expect(f.mailer.invitations.length).toBe(sentAfterFirst);

      const [count] = await f.db
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.workspaceId, f.workspaceId),
            eq(workspaceInvitations.email, email),
          ),
        );
      expect(count?.n).toBe(1);
    });

    it("thiếu Idempotency-Key → 400 trước khi gửi thư", async () => {
      await clearInvitations();
      const before = f.mailer.invitations.length;

      const response = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
        actor: f.wsAdmin,
        body: { email: "khong-key@example.test", role: "workspace_member" },
      });

      expect(response.status).toBe(400);
      expect(f.mailer.invitations.length).toBe(before);
    });
  });

  describe("nội dung thư", () => {
    it("mang tên workspace và tên người mời — đủ để phân biệt với phishing", async () => {
      await clearInvitations();
      const email = `noi-dung-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, email);

      const mail = f.mailer.invitations.at(-1);
      expect(mail?.to).toBe(email);
      expect(mail?.workspaceName).toBeTruthy();
      expect(mail?.invitedByName).toBe(f.wsAdmin.displayName);
      // Token thô đi trong thư — đó là mục đích của nó.
      expect(mail?.token).toBeTruthy();
    });

    it("token trong thư là token thô, database chỉ giữ hash", async () => {
      await clearInvitations();
      const email = `hash-${crypto.randomUUID().slice(0, 8)}@example.test`;
      await invite(f.wsAdmin, email);

      const token = f.mailer.lastTokenFor(email) as string;
      const row = await pendingRow(email);

      expect(row?.tokenHash).not.toBe(token);
      expect(row?.tokenHash).toBe(hashOneTimeToken(token));
    });
  });
});
