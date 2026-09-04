import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv } from "./env.ts";

const valid = {
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://flowboard:local@localhost:5432/flowboard",
  SESSION_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
};

describe("cấu hình fail fast", () => {
  it("nhận môi trường hợp lệ và áp default", () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("dừng khi thiếu biến bắt buộc, và nêu tên biến", () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    try {
      loadEnv(rest);
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).invalidKeys).toContain("DATABASE_URL");
    }
  });

  it("thông báo lỗi KHÔNG chứa giá trị của biến", () => {
    const secret = "gia-tri-bi-mat-khong-duoc-lo-ra-log";
    try {
      loadEnv({ ...valid, SESSION_SECRET: "qua-ngan", DATABASE_URL: secret });
      expect.unreachable("phải ném ConfigError");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("SESSION_SECRET");
      expect(message).not.toContain(secret);
      expect(message).not.toContain("qua-ngan");
    }
  });

  it("từ chối secret quá ngắn", () => {
    expect(() => loadEnv({ ...valid, CSRF_SECRET: "ngan" })).toThrow(ConfigError);
  });

  it("bỏ qua biến môi trường lạ thay vì nạp bừa", () => {
    const env = loadEnv({ ...valid, SOMETHING_ELSE: "x" });
    expect(Object.keys(env)).not.toContain("SOMETHING_ELSE");
  });
});
