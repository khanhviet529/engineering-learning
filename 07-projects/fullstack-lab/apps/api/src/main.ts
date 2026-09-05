import { KeyRing } from "./shared/security/key-ring.ts";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { loadEnv, ConfigError, type Env } from "./shared/config/env.ts";
import { createDatabase } from "./shared/database/client.ts";
import { SmtpMailer } from "./shared/mail/mailer.ts";
import { RateLimiter, resolveRateLimitRules } from "./shared/http/rate-limit.ts";
import { LIVE_RESULT, checkReadiness } from "./shared/http/health.ts";
import { generateRequestId, normalizeRequestId } from "./shared/observability/request-id.ts";
import { ErrorFilter } from "./shared/errors/error.filter.ts";
import { buildCorsOptions } from "./shared/http/cors.ts";
import { AuthModule } from "./modules/auth/auth.module.ts";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module.ts";
import { ProjectsModule } from "./modules/projects/projects.module.ts";
import { BoardColumnsModule } from "./modules/board-columns/board-columns.module.ts";
import { ColumnRepository } from "./modules/board-columns/infrastructure/column-repository.ts";
import { BoardColumnsProjectQuery } from "./modules/board-columns/infrastructure/project-columns-adapter.ts";
import { TasksModule } from "./modules/tasks/tasks.module.ts";
import { TaskRepository } from "./modules/tasks/infrastructure/task-repository.ts";
import { TaskProjectResolver } from "./modules/tasks/infrastructure/task-project-resolver.ts";
import {
  TaskColumnEmptinessCheck,
  TaskProjectAssigneeCheck,
} from "./modules/tasks/infrastructure/port-adapters.ts";
import { DatabaseWorkspaceClock } from "./modules/tasks/infrastructure/workspace-clock.ts";
import {
  ActivityQueries,
  DrizzleActivityRecorder,
} from "./modules/activity/infrastructure/activity-repository.ts";
import { buildAuthorizationWiring } from "./shared/authorization/index.ts";
import { AuthRepository } from "./modules/auth/infrastructure/auth-repository.ts";
import { AuthUseCases } from "./modules/auth/application/auth-use-cases.ts";
import { SESSION_TTL_MS } from "./modules/auth/domain/session.ts";

/**
 * Điểm khởi động của `apps/api`.
 *
 * Theo [backend conventions](../../docs/engineering/backend-conventions.md),
 * `main.ts` chỉ bootstrap adapter, chính sách HTTP toàn cục và vòng đời tắt máy.
 * Không route nghiệp vụ nào sống ở đây — chúng thuộc về module.
 */

/**
 * Module gốc chỉ làm nhiệm vụ ghép, không chứa gì của riêng nó.
 *
 * Đây là **composition root**: nơi duy nhất biết cả ba module và nối các port
 * lại với nhau. `SessionGuard` nhận `AuthUseCases` làm `ActorResolver` ở đây —
 * nhờ vậy `shared/authorization` không import module `auth`, và đồ thị phụ
 * thuộc của ADR-0005 vẫn acyclic.
 */
function buildRootModule(deps: {
  auth: Parameters<typeof AuthModule.register>[0];
  authUseCases: AuthUseCases;
  db: Parameters<typeof WorkspacesModule.register>[0]["db"];
  cursorKeys: KeyRing;
  csrfKeys: KeyRing;
}) {
  /**
   * `activity` là module leaf và **không có route nào ở M3**, nên nó không cần
   * một Nest module: composition root dựng recorder rồi đưa cho các module ghi.
   * Một `@Module` rỗng ở đây chỉ thêm một lớp gián tiếp mà không nối thêm gì.
   */
  const activity = new DrizzleActivityRecorder();

  /**
   * Một `ColumnRepository` cho cả ba chỗ cần nó: resolver của chuỗi guard,
   * adapter đọc column cho `GET /projects/:projectId`, và use case của
   * `board-columns`. Ba instance sẽ chạy đúng như nhau nhưng giữ ba pool
   * statement riêng mà không ai được gì.
   */
  const columnRepository = new ColumnRepository(deps.db);

  /**
   * `TaskRepository` cũng dùng chung cho bốn chỗ: use case của `tasks`,
   * resolver của chuỗi guard, và **hai adapter port** mà M2 và M3 đã hứa —
   * `ColumnEmptinessCheck` cho archive cột, `ProjectAssigneeCheck` cho gỡ
   * member. M4 là mốc trả cả hai lời hứa đó.
   */
  const taskRepository = new TaskRepository(deps.db);
  const activityQueries = new ActivityQueries(deps.db);
  /**
   * Đồng hồ đọc `workspaces.timezone` — nợ của M4, trả ở M5.
   *
   * **Một** instance cho cả tiến trình, nên cache timezone bên trong nó là cache
   * cả tiến trình. Xem chú thích ở adapter cho đánh đổi đã biết.
   */
  const workspaceClock = new DatabaseWorkspaceClock(deps.db);

  const wiring = buildAuthorizationWiring({
    db: deps.db,
    // `AuthUseCases.resolveSession` khớp đúng hình dạng của `ActorResolver`.
    actorResolver: deps.authUseCases,
    /**
     * M4 mở rộng resolver thêm một lần nữa: chuỗi guard giờ phải resolve được
     * `:taskId` bên cạnh `:projectId`, `:columnId` và `projectId` trong body của
     * `POST /columns/reorder`. Chuỗi guard có **một** resolver, nên đây là một
     * lớp thay thế chứ không phải một lớp thứ hai đứng cạnh.
     */
    projectResolver: new TaskProjectResolver(columnRepository, taskRepository),
  });

  @Module({
    imports: [
      AuthModule.register(deps.auth),
      WorkspacesModule.register({
        db: deps.db,
        authorization: wiring.authorization,
        config: { csrfSecret: deps.csrfKeys },
        cursorSecret: deps.cursorKeys,
        // Cùng instance mailer và limiter mà `auth` dùng: một tiến trình, một
        // transport SMTP, một bộ đếm rate limit.
        mailer: deps.auth.mailer,
        limiter: deps.auth.limiter,
        guards: wiring.providers,
      }),
      ProjectsModule.register({
        db: deps.db,
        authorization: wiring.authorization,
        // Adapter thật, có từ M4: đọc `tasks.assignee_id`.
        assigneeCheck: new TaskProjectAssigneeCheck(taskRepository),
        activity,
        columns: new BoardColumnsProjectQuery(columnRepository),
        config: { csrfSecret: deps.csrfKeys },
        cursorSecret: deps.cursorKeys,
        guards: wiring.providers,
      }),
      BoardColumnsModule.register({
        db: deps.db,
        repository: columnRepository,
        activity,
        // Adapter thật, có từ M4: đếm task trong cột.
        emptiness: new TaskColumnEmptinessCheck(taskRepository),
        config: { csrfSecret: deps.csrfKeys },
        guards: wiring.providers,
      }),
      TasksModule.register({
        db: deps.db,
        repository: taskRepository,
        columns: columnRepository,
        membership: wiring.membership,
        activity,
        activityQueries,
        clock: workspaceClock,
        config: { csrfSecret: deps.csrfKeys },
        cursorSecret: deps.cursorKeys,
        guards: wiring.providers,
      }),
    ],
  })
  class RootModule {}
  return RootModule;
}

function readEnv(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Fail fast, ghi tên biến chứ không ghi giá trị.
      console.error(`[config] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  const env = readEnv();

  const database = createDatabase(env.DATABASE_URL);
  const mailer = new SmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    webOrigin: env.WEB_ORIGIN,
  });
  /**
   * Limiter đọc giới hạn từ config; thiếu cấu hình thì nhận bảng production.
   *
   * `Date.now` truyền tường minh vì `rules` là tham số thứ hai — và một tham số
   * thứ hai bị bỏ trống vì tham số thứ nhất cũng bỏ trống là chỗ dễ nhầm.
   */
  const limiter = new RateLimiter(Date.now, resolveRateLimitRules(env.RATE_LIMIT_OVERRIDES));

  const relaxed = Object.keys(env.RATE_LIMIT_OVERRIDES);
  if (relaxed.length > 0) {
    // Ghi **tên route**, không ghi giá trị: một môi trường đang chạy với giới
    // hạn khác production phải nói ra điều đó ngay ở dòng log đầu tiên.
    console.warn(`[config] rate limit được ghi đè cho: ${relaxed.join(", ")}`);
  }

  // Bucket hết hạn phải được dọn, nếu không một đợt dò email biến Map thành
  // đường rò bộ nhớ. `unref` để tiến trình vẫn thoát được khi tắt máy.
  const pruneTimer = setInterval(() => limiter.prune(), 60_000);
  pruneTimer.unref();

  // Dựng use case của `auth` ở đây vì hai nơi cần chính **một** instance:
  // module `auth`, và `SessionGuard` dùng nó làm `ActorResolver`.
  /**
   * Hai bộ key, một cho mỗi mục đích ký.
   *
   * Dùng chung một bộ cho cursor và CSRF sẽ làm một lần xoay vì lý do của bên
   * này kéo theo cửa sổ xoay của bên kia — và hai bên có hậu quả rất khác nhau
   * khi hết hiệu lực. Xem `shared/security/key-ring.ts`.
   */
  const csrfKeys = new KeyRing("CSRF_SECRET", {
    current: env.CSRF_SECRET,
    previous: env.CSRF_SECRET_PREVIOUS,
  });
  const cursorKeys = new KeyRing("SESSION_SECRET", {
    current: env.SESSION_SECRET,
    previous: env.SESSION_SECRET_PREVIOUS,
  });

  if (csrfKeys.rotating || cursorKeys.rotating) {
    // Ghi **tên** biến, không bao giờ ghi giá trị — cùng quy tắc với ConfigError.
    console.warn(
      `[config] đang trong cửa sổ xoay key: ${[csrfKeys, cursorKeys]
        .filter((ring) => ring.rotating)
        .map((ring) => ring.label)
        .join(", ")}`,
    );
  }

  const authUseCases = new AuthUseCases({
    db: database.db,
    repository: new AuthRepository(database.db),
    mailer,
    csrfSecret: csrfKeys,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    buildRootModule({
      db: database.db,
      authUseCases,
      cursorKeys,
      csrfKeys,
      auth: {
        db: database.db,
        mailer,
        limiter,
        useCases: authUseCases,
        config: {
          nodeEnv: env.NODE_ENV,
          csrfSecret: csrfKeys,
          // `Secure` bật ở mọi nơi trừ development. Nới lỏng cho local là có chủ
          // đích và **không** được rò sang build production.
          cookieSecure: env.NODE_ENV !== "development",
          cookieMaxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
        },
      },
    }),
    new FastifyAdapter(),
    { logger: ["error", "warn"] },
  );

  await app.register(cookie);

  app.useGlobalFilters(new ErrorFilter());

  /**
   * Origin allowlist lấy từ config đã validate, **không** từ header của request.
   *
   * Toàn bộ cấu hình sống ở `shared/http/cors.ts` để fixture của test nạp đúng
   * thứ production nạp. Một cấu hình chỉ có ở `main.ts` là một cấu hình không có
   * test — và đó chính là cách hai mặc định của `@fastify/cors` sống sót qua
   * năm mốc.
   */
  app.enableCors(buildCorsOptions(env.WEB_ORIGIN));

  const instance = app.getHttpAdapter().getInstance();

  /**
   * `requestId` được chuẩn hoá ở ranh giới HTTP và gắn vào request, rồi trả lại
   * trong header. Giá trị client gửi là input không tin cậy: nó sẽ đi vào log.
   */
  instance.addHook("onRequest", (request, reply, done) => {
    const requestId = normalizeRequestId(
      request.headers["x-request-id"] as string | undefined,
      generateRequestId,
    );
    (request as typeof request & { requestId: string }).requestId = requestId;
    void reply.header("x-request-id", requestId);
    done();
  });

  /**
   * Health không đi qua Nest router: nó phải trả lời được ngay cả khi phần còn
   * lại của ứng dụng đang có vấn đề, và nó không được đi qua guard hay use case.
   */
  instance.get("/health/live", async (_request, reply) => {
    await reply.status(LIVE_RESULT.status).send(LIVE_RESULT.body);
  });

  instance.get("/health/ready", async (_request, reply) => {
    const result = await checkReadiness(database.ping);
    await reply.status(result.status).send(result.body);
  });

  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  console.warn(`[api] listening on ${String(env.API_PORT)} (${env.NODE_ENV})`);

  const shutdown = (signal: string): void => {
    console.warn(`[api] ${signal} received, closing`);
    // Đóng HTTP trước rồi mới đóng pool: đóng ngược lại sẽ làm các request đang
    // dở mất kết nối database giữa chừng.
    void app
      .close()
      .then(() => database.close())
      .then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void bootstrap();
