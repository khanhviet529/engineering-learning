import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, type Database, type DatabaseHandle } from "../shared/database/client.ts";
import {
  activityLogs,
  authSessions,
  boardColumns,
  comments,
  idempotencyRecords,
  projectMembers,
  projects,
  users,
  workspaceInvitations,
  tasks,
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
import { TasksModule } from "../modules/tasks/tasks.module.ts";
import { TaskRepository } from "../modules/tasks/infrastructure/task-repository.ts";
import { TaskProjectResolver } from "../modules/tasks/infrastructure/task-project-resolver.ts";
import {
  TaskColumnEmptinessCheck,
  TaskProjectAssigneeCheck,
} from "../modules/tasks/infrastructure/port-adapters.ts";
import type { WorkspaceClock } from "../modules/tasks/domain/due-state.ts";
import { BoardColumnsModule } from "../modules/board-columns/board-columns.module.ts";
import { ColumnRepository } from "../modules/board-columns/infrastructure/column-repository.ts";
import { BoardColumnsProjectQuery } from "../modules/board-columns/infrastructure/project-columns-adapter.ts";
import {
  ActivityQueries,
  DrizzleActivityRecorder,
} from "../modules/activity/infrastructure/activity-repository.ts";

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

  /**
   * Đọc `activity_logs` — thứ biến các khẳng định "deny không tạo activity row"
   * từ **đúng một cách rỗng** thành bằng chứng thật.
   */
  activity: ActivityQueries;

  cleanup: () => Promise<void>;
  /** Bật/tắt kết quả của `ProjectAssigneeCheck` để kiểm bất biến của M4 từ M2. */
  setHasAssignedTasks: (value: boolean) => void;
  /**
   * Ép `ColumnEmptinessCheck` trả `true` mà không cần tạo task thật.
   *
   * Từ M4, cổng này đã có adapter **thật** đọc bảng `tasks`, nên đường mặc định
   * là đường thật. Công tắc ở lại vì test của M3 dùng nó để kiểm *đường đi* —
   * use case hỏi port, port trả `true`, use case trả `409` — và giữ được test
   * đó nguyên vẹn là bằng chứng rằng luật không phải viết lại khi adapter đổi.
   */
  setColumnHasTasks: (value: boolean) => void;
  /**
   * Ngày "hôm nay" mà server dùng để suy `dueState`.
   *
   * Đồng hồ của fixture **đứng yên** cho tới khi test đẩy nó: `dueState` phải
   * theo timezone workspace, và một test đọc `new Date()` sẽ cho kết quả khác
   * nhau giữa CI ở UTC và máy lập trình viên ở GMT+7 — một khác biệt mà chính
   * test không nhìn thấy.
   */
  setToday: (date: string) => void;
  today: () => string;
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
 * Đồng hồ workspace đứng yên, đẩy được từ test.
 *
 * `dueState` là thứ **duy nhất** trong hệ thống phụ thuộc "hôm nay", nên nó là
 * thứ duy nhất cần một đồng hồ giả — và nó cần thật: nếu không, một test khẳng
 * định "quá hạn" sẽ tự hỏng vào đúng ngày mà `due_date` cứng trong test trôi qua.
 */
class FrozenClock implements WorkspaceClock {
  value = "2026-09-05";
  today(): string {
    return this.value;
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

  /** Công tắc của M3, giữ lại để test "archive cột còn task" khỏi phải tạo task. */
  let columnHasTasksOverride = false;

  const authUseCases = new AuthUseCases({
    db,
    repository: new AuthRepository(db),
    mailer,
    csrfSecret: CSRF_SECRET,
  });

  /**
   * M4 **thay** hai adapter điều khiển được bằng adapter thật.
   *
   * `ControllableAssigneeCheck` vẫn còn để test của M2 chứng minh *đường đi*
   * (use case có hỏi port không), nhưng mặc định fixture nối bản đọc bảng
   * `tasks` — vì từ M4 câu trả lời đúng là câu trả lời thật, và một test kiểm
   * "gỡ member đang giữ việc" bằng một adapter giả sẽ xanh kể cả khi truy vấn
   * thật sai.
   */
  const activity = new DrizzleActivityRecorder();
  const columnRepository = new ColumnRepository(db);
  const taskRepository = new TaskRepository(db);
  const activityQueries = new ActivityQueries(db);
  const clock = new FrozenClock();
  const assigneeCheck = new ControllableAssigneeCheck();
  const realAssigneeCheck = new TaskProjectAssigneeCheck(taskRepository);
  const emptinessCheck = new TaskColumnEmptinessCheck(taskRepository);

  const wiring = buildAuthorizationWiring({
    db,
    actorResolver: authUseCases,
    // Cùng resolver mà `main.ts` dùng: test phải chạy đúng chuỗi guard của
    // production, không phải một chuỗi dễ hơn.
    projectResolver: new TaskProjectResolver(columnRepository, taskRepository),
  });

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
        // Cổng thật, cộng một công tắc: `setHasAssignedTasks(true)` vẫn chặn
        // được để test của M2 kiểm đường đi mà không cần dựng một task thật.
        assigneeCheck: {
          hasAssignedTasks: async (input) =>
            assigneeCheck.value || (await realAssigneeCheck.hasAssignedTasks(input)),
        },
        activity,
        columns: new BoardColumnsProjectQuery(columnRepository),
        config: { csrfSecret: CSRF_SECRET },
        cursorSecret: SESSION_SECRET,
        guards: wiring.providers,
      }),
      BoardColumnsModule.register({
        db,
        repository: columnRepository,
        activity,
        emptiness: {
          hasTasks: async (input) =>
            columnHasTasksOverride || (await emptinessCheck.hasTasks(input)),
        },
        config: { csrfSecret: CSRF_SECRET },
        guards: wiring.providers,
      }),
      TasksModule.register({
        db,
        repository: taskRepository,
        columns: columnRepository,
        membership: wiring.membership,
        activity,
        activityQueries,
        clock,
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
    activity: activityQueries,
    setHasAssignedTasks: (value: boolean) => {
      assigneeCheck.value = value;
    },
    setColumnHasTasks: (value: boolean) => {
      columnHasTasksOverride = value;
    },
    setToday: (date: string) => {
      clock.value = date;
    },
    today: () => clock.value,
    cleanup: async () => {
      await app.close();

      /**
       * Comment trỏ task, task trỏ column và membership — tất cả `RESTRICT`.
       * Dọn sai thứ tự thì database từ chối, và đó là hành vi **đúng** của
       * schema; chỗ phải thích ứng là cleanup.
       */
      const deleteTasksAndComments = async (projectIds: string[]): Promise<void> => {
        if (projectIds.length === 0) return;
        const taskRows = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds));
        const taskIds = taskRows.map((row) => row.id);
        if (taskIds.length > 0) {
          await db.delete(comments).where(inArray(comments.taskId, taskIds));
          // Activity của task phải đi trước task: FK `activity_logs.task_id`.
          await db.delete(activityLogs).where(inArray(activityLogs.taskId, taskIds));
          await db.delete(tasks).where(inArray(tasks.id, taskIds));
        }
      };

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
        // Mọi FK là `ON DELETE RESTRICT`, nên thứ tự dọn là chiều ngược của
        // đồ thị: comment → task → activity → column → membership → project.
        await deleteTasksAndComments(projectIds);
        await db.delete(activityLogs).where(inArray(activityLogs.projectId, projectIds));
        await db.delete(boardColumns).where(inArray(boardColumns.projectId, projectIds));
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
          await deleteTasksAndComments(ids);
          await db.delete(activityLogs).where(inArray(activityLogs.projectId, ids));
          await db.delete(boardColumns).where(inArray(boardColumns.projectId, ids));
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
