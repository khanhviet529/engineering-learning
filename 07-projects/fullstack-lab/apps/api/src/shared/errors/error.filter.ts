import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ErrorCode } from "@flowboard/contracts";
import { AppError, mapError } from "./app-error.ts";

/**
 * Filter bắt **mọi** lỗi và dựng envelope chuẩn.
 *
 * Nó bắt tất cả chứ không chỉ `AppError`: một lỗi lọt ra ngoài filter sẽ được
 * Nest trả về theo shape mặc định của nó, tức là một response không nằm trong
 * hợp đồng — và client sẽ gặp một shape mà nó chưa từng được dạy cách đọc.
 */

/**
 * Nest tự ném `HttpException` cho những việc trước khi code của ta chạy: route
 * không khớp, method không được hỗ trợ, payload quá lớn.
 *
 * Không ánh xạ chúng thì một URL gõ sai trở thành `500`: client tưởng server
 * hỏng, và log lỗi bị lấp bởi những thứ không phải sự cố. Bảng dưới đây dịch
 * status của Nest sang code trong danh mục, và **chỉ** những status mà danh mục
 * có code tương ứng.
 */
const NEST_STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
};

/**
 * Đổi `HttpException` của Nest thành `AppError`.
 *
 * Thông điệp của Nest **không** được dùng lại: nó chứa chi tiết định tuyến như
 * "Cannot GET /workspaces/<uuid>/projects", tức là phản chiếu lại đường dẫn mà
 * client vừa gửi. Thay vào đó dùng thông điệp mặc định an toàn của chính code.
 */
function toAppError(exception: unknown): unknown {
  if (exception instanceof AppError) return exception;
  if (!(exception instanceof HttpException)) return exception;

  const status = exception.getStatus();
  const code = NEST_STATUS_TO_CODE[status];
  if (code === undefined) return exception;

  return new AppError(code, { cause: exception });
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest & { requestId?: string }>();
    const reply = context.getResponse<FastifyReply>();

    const requestId = request.requestId ?? "unknown";
    const mapped = mapError(toAppError(exception), requestId);

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
