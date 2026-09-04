import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorEnvelopeSchema } from "@flowboard/contracts";
import { AppError, mapError, validationError } from "./app-error.ts";

const requestId = "req000000000001";

describe("mọi error code dựng được envelope hợp lệ", () => {
  it.each(ERROR_CODES)("%s", (code) => {
    const mapped = mapError(new AppError(code), requestId);
    const parsed = errorEnvelopeSchema.safeParse(mapped.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(mapped.body.error.code).toBe(code);
    expect(mapped.body.requestId).toBe(requestId);
  });

  it("status khớp danh mục error code", () => {
    for (const code of ERROR_CODES) {
      const mapped = mapError(new AppError(code), requestId);
      expect(mapped.status).toBe(
        errorEnvelopeSchema.parse(mapped.body).error.code === code ? mapped.status : -1,
      );
      expect(mapped.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("mọi thông điệp mặc định đều không rỗng và bằng tiếng Việt cho người dùng", () => {
    for (const code of ERROR_CODES) {
      expect(new AppError(code).message.length).toBeGreaterThan(0);
    }
  });
});

describe("lỗi không mong đợi không rò rỉ nội bộ", () => {
  it("lỗi lạ thành INTERNAL_ERROR với thông điệp an toàn", () => {
    const secret = "postgres://user:supersecret@db:5432/flowboard";
    const mapped = mapError(new Error(`connect failed: ${secret}`), requestId);

    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(mapped.body)).not.toContain("supersecret");
    expect(JSON.stringify(mapped.body)).not.toContain("postgres://");
  });

  it("không có stack trace trong body", () => {
    const mapped = mapError(new Error("bùm"), requestId);
    expect(JSON.stringify(mapped.body)).not.toMatch(/at .*\.ts:\d+/);
    expect(mapped.body.error).not.toHaveProperty("stack");
  });

  it("nguyên nhân gốc vẫn tới được log, chỉ không tới client", () => {
    const cause = new Error("chi tiết nội bộ");
    const mapped = mapError(cause, requestId);
    expect(mapped.logDetail.cause).toBe(cause);
    expect(JSON.stringify(mapped.body)).not.toContain("chi tiết nội bộ");
  });
});

describe("Retry-After", () => {
  it("mọi 429 đều có Retry-After, kể cả khi không truyền giá trị", () => {
    const mapped = mapError(new AppError("RATE_LIMITED"), requestId);
    expect(mapped.status).toBe(429);
    expect(mapped.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("giá trị truyền vào được dùng đúng", () => {
    const mapped = mapError(new AppError("RATE_LIMITED", { retryAfterSeconds: 17 }), requestId);
    expect(mapped.headers["retry-after"]).toBe("17");
  });

  it("409 IDEMPOTENCY_IN_PROGRESS mang gợi ý khoảng chờ khi có", () => {
    const mapped = mapError(
      new AppError("IDEMPOTENCY_IN_PROGRESS", { retryAfterSeconds: 2 }),
      requestId,
    );
    expect(mapped.headers["retry-after"]).toBe("2");
  });

  it("các code khác không tự sinh Retry-After", () => {
    expect(mapError(new AppError("FORBIDDEN"), requestId).headers["retry-after"]).toBeUndefined();
  });
});

describe("details chỉ thuộc về hai code công bố nó", () => {
  it("VALIDATION_FAILED dùng field-error array", () => {
    const mapped = mapError(
      validationError([{ field: "email", code: "invalid", message: "Email không hợp lệ." }]),
      requestId,
    );
    expect(mapped.status).toBe(400);
    expect(Array.isArray(mapped.body.error.details)).toBe(true);
    expect(errorEnvelopeSchema.safeParse(mapped.body).success).toBe(true);
  });

  it("TASK_VERSION_CONFLICT dùng object currentVersion", () => {
    const mapped = mapError(
      new AppError("TASK_VERSION_CONFLICT", { details: { currentVersion: 7 } }),
      requestId,
    );
    expect(mapped.body.error.details).toEqual({ currentVersion: 7 });
    expect(errorEnvelopeSchema.safeParse(mapped.body).success).toBe(true);
  });

  it("code không công bố details thì không có details", () => {
    const mapped = mapError(new AppError("UNAUTHENTICATED"), requestId);
    expect(mapped.body.error).not.toHaveProperty("details");
  });
});

describe("thông điệp mặc định không tiết lộ enumeration", () => {
  it("UNAUTHENTICATED không nói email hay mật khẩu sai", () => {
    const message = new AppError("UNAUTHENTICATED").message.toLowerCase();
    expect(message).not.toContain("email");
    expect(message).not.toContain("mật khẩu");
  });

  it("NOT_FOUND không nói resource nào", () => {
    const message = new AppError("NOT_FOUND").message.toLowerCase();
    expect(message).not.toMatch(/project|task|dự án|công việc/);
  });
});
