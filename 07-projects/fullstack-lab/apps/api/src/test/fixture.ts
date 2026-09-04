import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, type Database, type DatabaseHandle } from "../shared/database/client.ts";
import {
  authSessions,
  idempotencyRecords,
  projectMembers,
  projects,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "../shared/database/schema.ts";
import { ErrorFilter } from "../shared/errors/error.filter.ts";
import { RateLimiter } from "../shared/http/rate-limit.ts";
import { deriveCsrfToken } from "../shared/http/csrf.ts";
import { SESSION_COOKIE_NAME } from "../shared/http/session-cookie.ts";
import { generateRequestId, normalizeRequestId } from "../shared/observability/request-id.ts";
import { buildAuthorizationWiring } from "../shared/authorization/index.ts";
import { AuthModule } from "../modules/auth/auth.module.ts";
import { AuthRepository } from "../modules/auth/infrastructure/auth-repository.ts";
import { AuthUseCases, type Mailer } from "../modules/auth/application/auth-use-cases.ts";
import { hashSessionToken, sessionExpiry } from "../modules/auth/domain/session.ts";
import { hashPassword } from "../modules/auth/domain/password.ts";
import { WorkspacesModule } from "../modules/workspaces/workspaces.module.ts";
import { ProjectsModule } from "../modules/projects/projects.module.ts";
import type { ProjectAssigneeCheck } from "../modules/projects/domain/project-membership-rules.ts";

/**
 * Fixture chuẩn — `docs/operations/testing-strategy.md`.
 *
 * Cùng một tên actor mang **cùng một nghĩa** ở mọi lớp test, mọi mốc. Đây là
 * lý do fixture nằm ở `test/` dùng chung chứ không nằm trong file test của một
 * module: nếu mỗi test tự dựng "một Viewer", hai test sẽ dần hiểu "Viewer" theo
 * hai cách và ma trận phân quyền mất ý nghĩa đối chiếu.
 *
 * Bộ actor:
 *
 * - **Project B** có `owner`, `editor`, `viewer`; **User B** là Owner của nó.
 * - Một **Workspace Admin không có dòng `project_members`** cho Project B.
 * - **User A** là Owner của **Project A** riêng tư trong **cùng** workspace, và
 *   không có membership Project B.
 *
 * Điểm tinh tế: Project A và Project B ở **cùng** workspace. Nếu chúng ở hai
 * workspace khác nhau thì test "User A dùng ID của User B" sẽ pass ngay cả khi
 * scope chỉ được kiểm ở tầng workspace — tức là test không chứng minh được
 * điều nó nói. Cùng workspace buộc phép kiểm phải xảy ra ở tầng project.
 */

export interface TestActor {
  id: string;
  email: string;
  displayName: string;
  sessionToken: string;
  csrfToken: string;
}

export interface Fixture {
  app: NestFastifyApplication;
  db: Database;
  handle: DatabaseHandle;

  workspaceId: string;
  projectAId: string;
  projectBId: string;

  owner: TestActor;
  editor: TestActor;
  viewer: TestActor;
  wsAdmin: TestActor;
  userA: TestActor;
  userB: TestActor;

  /** Actor không thuộc workspace nào — dùng cho nhánh danh sách rỗng. */
  outsider: TestActor;

  /**
   * Hộp thư của test.
   *
   * Token lời mời thô chỉ tồn tại trong lá thư — database chỉ giữ hash. Test
   * muốn chấp nhận một lời mời thì phải đọc token ở đúng chỗ người dùng thật
   * đọc, và đây là chỗ đó.
   */
  mailer: SilentMailer;
  /** Bộ đếm rate limit dùng chung, để test tự dọn giữa các case. */
  limiter: RateLimiter;

  cleanup: () => Promise<void>;
  /** Bật/tắt kết quả của `ProjectAssigneeCheck` để kiểm bất biến của M4 từ M2. */
  setHasAssignedTasks: (value: boolean) => void;
}

const CSRF_SECRET = "c".repeat(32);
const SESSION_SECRET = "s".repeat(32);

/**
 * Mailer của test: không gửi gì ra ngoài, nhưng **ghi lại** thư mời.
 *
 * Token thô chỉ tồn tại đúng một lần — trong thư. Server chỉ lưu hash, nên
 * không có đường nào lấy lại nó từ database. Test muốn chấp nhận một lời mời
 * thì phải đọc token ở đúng chỗ người dùng thật đọc: hộp thư.
 *
 * Đây cũng là chỗ test kiểm được rằng thư mang đủ context (tên workspace, tên
 * người mời) — thứ phân biệt một lời mời với một thư phishing.
 */
class SilentMailer implements Mailer {
  readonly invitations: {
    to: string;
    token: string;
    workspaceName: string;
    invitedByName: string;
  }[] = [];

  async sendVerificationEmail(): Promise<void> {}
  async sendPasswordResetEmail(): Promise<void> {}

  async sendWorkspaceInvitationEmail(input: {
    to: string;
    token: string;
    workspaceName: string;
    invitedByName: string;
  }): Promise<void> {
    this.invitations.push(input);
  }

  /** Token của lời mời gần nhất gửi tới địa chỉ này, nếu có. */
  lastTokenFor(email: string): string | undefined {
    return this.invitations.filter((i) => i.to === email).at(-1)?.token;
  }
}

/**
 * Adapter `ProjectAssigneeCheck` điều khiển được từ test.
 *
 * Bảng `tasks` thuộc M4, nên ở M2 không có cách nào tạo một assignment thật.
 * Nhưng bất biến "không gỡ member đang giữ việc" đã nằm trong hợp đồng, và
 * đường đi của nó — use case gọi port, port trả `true`, use case từ chối — thì
 * kiểm được ngay từ bây giờ bằng một adapter điều khiển được.
 *
 * Cái test này chứng minh: **use case thật sự hỏi port**, và trả lời `true` thật
 * sự chặn được thao tác. M4 chỉ cần thay adapter, không phải viết lại luật.
 */
class ControllableAssigneeCheck implements ProjectAssigneeCheck {
  value = false;
  async hasAssignedTasks(): Promise<boolean> {
    return this.value;
  }
}

export async function createFixture(databaseUrl: string): Promise<Fixture> {
  /**
   * Pool **2**, không phải 5.
   *
   * Một fixture phát request tuần tự, nên nó không bao giờ dùng hết 5 kết nối —
   * con số đó chỉ là mặc định chép lại. Nhưng vitest chạy các file test song
   * song, mỗi file dựng một fixture, nên số kết nối nhân theo số file: bảy
   * fixture × 5 là 35 kết nối cho một việc cần nhiều nhất 14.
   *
   * Điều đó có hậu quả đo được: hai lần trong lúc phát triển, một lượt chạy đầy
   * đủ báo lỗi ở `beforeAll` và bỏ qua cả trăm test — dấu hiệu của việc giành
   * kết nối chứ không phải của một assertion sai. Giảm pool bỏ luôn nguồn áp
   * lực đó mà không đánh đổi gì, vì phần dư chưa từng được dùng.
   */
  const handle = createDatabase(databaseUrl, { max: 2 });
  const db = handle.db;

  /**
   * **Một** mailer và **một** limiter cho cả tiến trình test.
   *
   * Trước đây fixture dựng hai `SilentMailer` riêng — vô hại khi không ai đọc
   * chúng, nhưng nay test phải lấy token lời mời từ hộp thư, và một instance
   * thứ hai nghĩa là thư rơi vào cái mà test không cầm. Cùng lý do với limiter:
   * hai bộ đếm là hai hạn mức, và test rate limit sẽ đo nhầm cái không được
   * dùng.
   */
  const mailer = new SilentMailer();
  const limiter = new RateLimiter();

  const authUseCases = new AuthUseCases({
    db,
    repository: new AuthRepository(db),
    mailer,
    csrfSecret: CSRF_SECRET,
  });

  const assigneeCheck = new ControllableAssigneeCheck();

  const wiring = buildAuthorizationWiring({ db, actorResolver: authUseCases });

  @Module({
    imports: [
      AuthModule.register({
        db,
        mailer,
        limiter,
        useCases: authUseCases,
        config: {
          nodeEnv: "test",
          csrfSecret: CSRF_SECRET,
          cookieSecure: true,
          cookieMaxAgeSeconds: 3600,
        },
      }),
      WorkspacesModule.register({
        db,
        authorization: wiring.authorization,
        config: { csrfSecret: CSRF_SECRET },
        cursorSecret: SESSION_SECRET,
        mailer,
        limiter,
        guards: wiring.providers,
      }),
      ProjectsModule.register({
        db,
        authorization: wiring.authorization,
        assigneeCheck,
        config: { csrfSecret: CSRF_SECRET },
        cursorSecret: SESSION_SECRET,
        guards: wiring.providers,
      }),
    ],
  })
  class TestRootModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    TestRootModule,
    new FastifyAdapter(),
    { logger: ["error"], abortOnError: false },
  );
  await app.register(cookie);
  app.useGlobalFilters(new ErrorFilter());

  const instance = app.getHttpAdapter().getInstance();
  instance.addHook("onRequest", (request, reply, done) => {
    const requestId = normalizeRequestId(
      request.headers["x-request-id"] as string | undefined,
      generateRequestId,
    );
    (request as typeof request & { requestId: string }).requestId = requestId;
    void reply.header("x-request-id", requestId);
    done();
  });

  await app.init();
  await instance.ready();

  const suffix = crypto.randomUUID().slice(0, 8);
  const createdUserIds: string[] = [];

  /**
   * Hash Argon2id **thật**, băm một lần rồi dùng lại cho mọi actor của fixture.
   *
   * Nhét một chuỗi giả dạng hash vào đây thì rẻ hơn, nhưng nó sẽ phá một khẳng
   * định bảo mật có thật của M1: "không bản ghi nào trong `users` có
   * `password_hash` không phải Argon2id". Một fixture làm hỏng phép kiểm đó
   * biến nó thành vô dụng cho mọi mốc sau — và phép kiểm đó chính là thứ sẽ bắt
   * được một ngày nào đó ai đó lưu nhầm plaintext.
   *
   * Băm một lần vì Argon2 cố ý chậm; bảy actor × một lần băm là lãng phí không
   * mua thêm được gì.
   */
  const fixturePasswordHash = await hashPassword("mot mat khau fixture du dai");

  /** Tạo một user đã xác minh email cùng một session đang hoạt động. */
  async function makeActor(label: string): Promise<TestActor> {
    const email = `${label}-${suffix}@example.test`;
    const [user] = await db
      .insert(users)
      .values({
        email,
        displayName: `Actor ${label}`,
        passwordHash: fixturePasswordHash,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });

    const id = (user as { id: string }).id;
    createdUserIds.push(id);

    const sessionToken = `session-${label}-${suffix}`;
    await db.insert(authSessions).values({
      userId: id,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: sessionExpiry(),
    });

    return {
      id,
      email,
      displayName: `Actor ${label}`,
      sessionToken,
      csrfToken: deriveCsrfToken(sessionToken, CSRF_SECRET),
    };
  }

  const owner = await makeActor("owner");
  const editor = await makeActor("editor");
  const viewer = await makeActor("viewer");
  const wsAdmin = await makeActor("wsadmin");
  const userA = await makeActor("usera");
  const userB = await makeActor("userb");
  const outsider = await makeActor("outsider");

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Workspace ${suffix}` })
    .returning({ id: workspaces.id });
  const workspaceId = (workspace as { id: string }).id;

  // Mọi actor trừ `outsider` đều là thành viên workspace; chỉ `wsAdmin` là admin.
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: owner.id, role: "workspace_member" },
    { workspaceId, userId: editor.id, role: "workspace_member" },
    { workspaceId, userId: viewer.id, role: "workspace_member" },
    { workspaceId, userId: wsAdmin.id, role: "workspace_admin" },
    { workspaceId, userId: userA.id, role: "workspace_member" },
    { workspaceId, userId: userB.id, role: "workspace_member" },
  ]);

  const [projectA] = await db
    .insert(projects)
    .values({ workspaceId, name: `Project A ${suffix}`, createdByUserId: userA.id })
    .returning({ id: projects.id });
  const projectAId = (projectA as { id: string }).id;

  const [projectB] = await db
    .insert(projects)
    .values({ workspaceId, name: `Project B ${suffix}`, createdByUserId: userB.id })
    .returning({ id: projects.id });
  const projectBId = (projectB as { id: string }).id;

  await db.insert(projectMembers).values([
    // Project A: chỉ User A.
    { projectId: projectAId, userId: userA.id, role: "owner" },
    // Project B: User B là Owner, cộng ba vai trò của ma trận.
    { projectId: projectBId, userId: userB.id, role: "owner" },
    { projectId: projectBId, userId: owner.id, role: "owner" },
    { projectId: projectBId, userId: editor.id, role: "editor" },
    { projectId: projectBId, userId: viewer.id, role: "viewer" },
    // `wsAdmin` cố ý **không** có dòng nào cho Project B.
  ]);

  return {
    app,
    db,
    handle,
    workspaceId,
    projectAId,
    projectBId,
    owner,
    editor,
    viewer,
    wsAdmin,
    userA,
    userB,
    outsider,
    mailer,
    limiter,
    setHasAssignedTasks: (value: boolean) => {
      assigneeCheck.value = value;
    },
    cleanup: async () => {
      await app.close();

      /**
       * Dọn theo **chiều ngược của foreign key**, và theo *tất cả* project mà
       * test đã tạo — không chỉ hai project seed.
       *
       * Mọi FK của M2 là `ON DELETE RESTRICT` (đúng hợp đồng: core MVP không
       * cascade dữ liệu private). Nghĩa là dọn sai thứ tự thì database từ chối,
       * và một test tạo thêm project sẽ làm cleanup vỡ. Đó là hành vi **đúng**
       * của schema; chỗ phải thích ứng là cleanup.
       */
      const ownedProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId));
      const projectIds = ownedProjects.map((row) => row.id);

      if (projectIds.length > 0) {
        await db.delete(projectMembers).where(inArray(projectMembers.projectId, projectIds));
        await db.delete(projects).where(inArray(projects.id, projectIds));
      }

      // Workspace mà chính test tạo ra (qua `POST /workspaces`) cũng phải dọn.
      const extraWorkspaces = await db
        .select({ id: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(inArray(workspaceMembers.userId, createdUserIds));
      const workspaceIds = [...new Set([workspaceId, ...extraWorkspaces.map((r) => r.id)])];

      for (const id of workspaceIds) {
        const rows = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, id));
        if (rows.length > 0) {
          const ids = rows.map((r) => r.id);
          await db.delete(projectMembers).where(inArray(projectMembers.projectId, ids));
          await db.delete(projects).where(inArray(projects.id, ids));
        }
        await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, id));
        /**
         * Lời mời cũng phải dọn trước workspace.
         *
         * FK của `workspace_invitations` là `ON DELETE RESTRICT`, đúng quy ước
         * "core MVP không cascade dữ liệu private hay audit". Nghĩa là database
         * **từ chối** xoá workspace khi còn lời mời — và đó là hành vi đúng;
         * chỗ phải thích ứng là cleanup, không phải constraint.
         */
        await db.delete(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, id));
      }
      await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));

      await db.delete(idempotencyRecords).where(inArray(idempotencyRecords.userId, createdUserIds));
      await db.delete(authSessions).where(inArray(authSessions.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
      await handle.close();
    },
  };
}

export interface RequestOptions {
  actor?: TestActor;
  /** Gửi CSRF token. Mặc định `true` cho mutation khi có actor. */
  csrf?: boolean;
  idempotencyKey?: string;
  body?: unknown;
}

/**
 * Gọi HTTP thật qua Fastify `inject`.
 *
 * Đi qua **toàn bộ** chuỗi: hook `requestId` → guard → validation → use case →
 * error filter. Đây là điều mà gọi thẳng use case không chứng minh được, và là
 * lý do các test phân quyền phải ở mức này: hợp đồng nói "Viewer gọi HTTP trực
 * tiếp bị `403`", không phải "hàm nội bộ ném lỗi".
 */
export async function call(
  fixture: Fixture,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  if (options.actor !== undefined) {
    cookies[SESSION_COOKIE_NAME] = options.actor.sessionToken;
    const wantsCsrf = options.csrf ?? method !== "GET";
    if (wantsCsrf) headers["x-csrf-token"] = options.actor.csrfToken;
  }

  if (options.idempotencyKey !== undefined) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  const response = await fixture.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers,
      cookies,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });

  let body: Record<string, unknown> = {};
  if (response.body.length > 0) {
    try {
      body = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      body = { raw: response.body };
    }
  }

  return { status: response.statusCode, body, headers: response.headers };
}

/** Key duy nhất cho mỗi ý định — giống cách client sinh key. */
export function newKey(label = "k"): string {
  return `${label}-${crypto.randomUUID()}`;
}
