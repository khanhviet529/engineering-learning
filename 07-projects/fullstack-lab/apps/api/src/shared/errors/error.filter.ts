import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { mapError } from "./app-error.ts";

/**
 * Filter bắt **mọi** lỗi và dựng envelope chuẩn.
 *
 * Nó bắt tất cả chứ không chỉ `AppError`: một lỗi lọt ra ngoài filter sẽ được
 * Nest trả về theo shape mặc định của nó, tức là một response không nằm trong
 * hợp đồng — và client sẽ gặp một shape mà nó chưa từng được dạy cách đọc.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest & { requestId?: string }>();
    const reply = context.getResponse<FastifyReply>();

    const requestId = request.requestId ?? "unknown";
    const mapped = mapError(exception, requestId);

    if (mapped.status >= 500) {
      // Nguyên nhân gốc chỉ đi vào log, không bao giờ vào response.
      console.error(
        JSON.stringify({
          level: "error",
          requestId,
          method: request.method,
          route: request.url,
          statusCode: mapped.status,
          code: mapped.logDetail.code,
          cause:
            mapped.logDetail.cause instanceof Error ? mapped.logDetail.cause.message : undefined,
        }),
      );
    }

    void reply.status(mapped.status).headers(mapped.headers).send(mapped.body);
  }
}
