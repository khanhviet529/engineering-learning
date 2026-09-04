import { HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema } from "@flowboard/contracts";
import { AppError, mapError } from "./app-error.ts";
import { ErrorFilter } from "./error.filter.ts";

/**
 * Nest tự ném `HttpException` cho những việc trước khi code của ta chạy: route
 * không khớp, method không hỗ trợ, payload quá lớn.
 *
 * Không ánh xạ chúng thì một URL gõ sai trở thành `500`. Hậu quả không chỉ là
 * status sai: client tưởng server hỏng, và log mức error bị lấp bởi những thứ
 * không phải sự cố — đúng lúc cần log để tìm sự cố thật.
 */

/** Dựng `ArgumentsHost` tối thiểu, đủ để filter chạy mà không cần Nest app. */
function fakeHost(url = "/khong-co-route-nay") {
  const sent: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    headers(value: Record<string, string>) {
      sent.headers = value;
      return this;
    },
    send(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: "req000000000001", method: "GET", url }),
      getResponse: () => reply,
    }),
  };
  return { host, sent };
}

const filter = new ErrorFilter();

describe("HttpException của Nest được ánh xạ vào danh mục", () => {
  it.each([
    ["route không khớp", new NotFoundException(), 404, "NOT_FOUND"],
    ["chưa xác thực", new UnauthorizedException(), 401, "UNAUTHENTICATED"],
    ["payload sai", new HttpException("bad", 400), 400, "VALIDATION_FAILED"],
  ])("%s → %i %s", (_label, exception, status, code) => {
    const { host, sent } = fakeHost();
    filter.catch(exception, host as never);

    expect(sent.status).toBe(status);
    const parsed = errorEnvelopeSchema.safeParse(sent.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((sent.body as { error: { code: string } }).error.code).toBe(code);
  });

  it("KHÔNG phản chiếu lại đường dẫn client vừa gửi", () => {
    // Thông điệp của Nest là "Cannot GET /workspaces/<uuid>/projects" — dùng lại
    // nó là trả chính input của client về trong response lỗi.
    const { host, sent } = fakeHost("/workspaces/11111111-1111-4111-8111-111111111111/projects");
    filter.catch(
      new NotFoundException("Cannot GET /workspaces/11111111-1111-4111-8111-111111111111/projects"),
      host as never,
    );

    expect(JSON.stringify(sent.body)).not.toContain("11111111");
    expect(JSON.stringify(sent.body)).not.toContain("Cannot GET");
  });

  it("status Nest không có code tương ứng thì vẫn là INTERNAL_ERROR", () => {
    const { host, sent } = fakeHost();
    // 418 không nằm trong danh mục; không được bịa ra một code cho nó.
    filter.catch(new HttpException("teapot", 418), host as never);
    expect(sent.status).toBe(500);
    expect((sent.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
  });

  it("AppError đi qua nguyên vẹn, không bị ánh xạ lại", () => {
    const { host, sent } = fakeHost();
    filter.catch(new AppError("PROJECT_LAST_OWNER"), host as never);
    expect(sent.status).toBe(409);
    expect((sent.body as { error: { code: string } }).error.code).toBe("PROJECT_LAST_OWNER");
  });

  it("mọi response đều mang requestId trùng header", () => {
    const { host, sent } = fakeHost();
    filter.catch(new NotFoundException(), host as never);
    expect(sent.headers?.["x-request-id"]).toBe("req000000000001");
    expect((sent.body as { requestId: string }).requestId).toBe("req000000000001");
  });

  it("lỗi lạ vẫn giữ nguyên nhân gốc trong log, không trong body", () => {
    const cause = new Error("chi tiết nội bộ");
    const mapped = mapError(cause, "req000000000001");
    expect(mapped.logDetail.cause).toBe(cause);
    expect(JSON.stringify(mapped.body)).not.toContain("chi tiết nội bộ");
  });
});
