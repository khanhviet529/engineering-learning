/**
 * Điểm khởi động của `apps/api`.
 *
 * Ở mốc M0.5, file này chỉ làm đúng ba việc mà [backend conventions]
 * (../../docs/engineering/backend-conventions.md) cho phép `main.ts` làm:
 * validate cấu hình, dựng HTTP boundary, và tắt có trật tự. Không route nghiệp
 * vụ, không business logic — chúng thuộc về module, và module đầu tiên (`auth`)
 * xuất hiện ở M1.
 */

import { createServer } from "node:http";
import { loadEnv, ConfigError } from "./shared/config/env.ts";
import { LIVE_RESULT, checkReadiness } from "./shared/http/health.ts";
import { generateRequestId, normalizeRequestId } from "./shared/observability/request-id.ts";

function bootstrap(): void {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Fail fast, ghi tên biến chứ không ghi giá trị.
      console.error(`[config] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // M0.5 chưa có PostgreSQL client, nên readiness khai báo trung thực là chưa
  // sẵn sàng thay vì trả `ok` sai. Probe thật được nối ở M1 cùng database
  // boundary. Trả `ok` ở đây sẽ khiến Compose và orchestrator tin API phục vụ
  // được trong khi nó chưa có gì để phục vụ.
  const databaseProbe = async (): Promise<boolean> => false;

  const server = createServer((req, res) => {
    const requestId = normalizeRequestId(
      req.headers["x-request-id"] as string | undefined,
      generateRequestId,
    );
    res.setHeader("x-request-id", requestId);
    res.setHeader("content-type", "application/json; charset=utf-8");

    const url = req.url ?? "/";

    if (url === "/health/live") {
      res.writeHead(LIVE_RESULT.status);
      res.end(JSON.stringify(LIVE_RESULT.body));
      return;
    }

    if (url === "/health/ready") {
      void checkReadiness(databaseProbe).then((result) => {
        res.writeHead(result.status);
        res.end(JSON.stringify(result.body));
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found." }, requestId }));
  });

  server.listen(env.API_PORT, () => {
    console.warn(`[api] listening on ${String(env.API_PORT)} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string): void => {
    console.warn(`[api] ${signal} received, closing`);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap();
