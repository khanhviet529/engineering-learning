import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { loadEnv, ConfigError, type Env } from "./shared/config/env.ts";
import { createDatabase } from "./shared/database/client.ts";
import { SmtpMailer } from "./shared/mail/mailer.ts";
import { RateLimiter } from "./shared/http/rate-limit.ts";
import { LIVE_RESULT, checkReadiness } from "./shared/http/health.ts";
import { generateRequestId, normalizeRequestId } from "./shared/observability/request-id.ts";
import { ErrorFilter } from "./shared/errors/error.filter.ts";
import { AuthModule } from "./modules/auth/auth.module.ts";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module.ts";
import { ProjectsModule, NoTasksYetAssigneeCheck } from "./modules/projects/projects.module.ts";
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
  cursorSecret: string;
  csrfSecret: string;
}) {
  const wiring = buildAuthorizationWiring({
    db: deps.db,
    // `AuthUseCases.resolveSession` khớp đúng hình dạng của `ActorResolver`.
    actorResolver: deps.authUseCases,
  });

  @Module({
    imports: [
      AuthModule.register(deps.auth),
      WorkspacesModule.register({
        db: deps.db,
        authorization: wiring.authorization,
        config: { csrfSecret: deps.csrfSecret },
        cursorSecret: deps.cursorSecret,
        // Cùng instance mailer và limiter mà `auth` dùng: một tiến trình, một
        // transport SMTP, một bộ đếm rate limit.
        mailer: deps.auth.mailer,
        limiter: deps.auth.limiter,
        guards: wiring.providers,
      }),
      ProjectsModule.register({
        db: deps.db,
        authorization: wiring.authorization,
        // M4 thay bằng adapter thật của module `tasks`.
        assigneeCheck: new NoTasksYetAssigneeCheck(),
        config: { csrfSecret: deps.csrfSecret },
        cursorSecret: deps.cursorSecret,
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
  const limiter = new RateLimiter();

  // Bucket hết hạn phải được dọn, nếu không một đợt dò email biến Map thành
  // đường rò bộ nhớ. `unref` để tiến trình vẫn thoát được khi tắt máy.
  const pruneTimer = setInterval(() => limiter.prune(), 60_000);
  pruneTimer.unref();

  // Dựng use case của `auth` ở đây vì hai nơi cần chính **một** instance:
  // module `auth`, và `SessionGuard` dùng nó làm `ActorResolver`.
  const authUseCases = new AuthUseCases({
    db: database.db,
    repository: new AuthRepository(database.db),
    mailer,
    csrfSecret: env.CSRF_SECRET,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    buildRootModule({
      db: database.db,
      authUseCases,
      cursorSecret: env.SESSION_SECRET,
      csrfSecret: env.CSRF_SECRET,
      auth: {
        db: database.db,
        mailer,
        limiter,
        useCases: authUseCases,
        config: {
          nodeEnv: env.NODE_ENV,
          csrfSecret: env.CSRF_SECRET,
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

  // Origin allowlist lấy từ config đã validate, **không** từ header của request.
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });

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
