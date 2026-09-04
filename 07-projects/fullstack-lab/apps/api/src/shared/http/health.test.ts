import { describe, expect, it } from "vitest";
import { LIVE_RESULT, checkReadiness } from "./health.ts";

describe("liveness", () => {
  it("trả 200 và body tối thiểu, không lộ hạ tầng", () => {
    expect(LIVE_RESULT.status).toBe(200);
    expect(LIVE_RESULT.body).toEqual({ status: "ok" });
    expect(JSON.stringify(LIVE_RESULT.body)).not.toMatch(/version|host|postgres|topology/i);
  });
});

describe("readiness", () => {
  it("trả 200 khi dependency dùng được", async () => {
    const result = await checkReadiness(async () => true);
    expect(result.status).toBe(200);
  });

  it("trả 503 khi dependency hỏng", async () => {
    const result = await checkReadiness(async () => false);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: "unavailable" });
  });

  it("probe ném lỗi thì thành 503, không làm sập process", async () => {
    const result = await checkReadiness(async () => {
      throw new Error("database down");
    });
    expect(result.status).toBe(503);
  });

  it("probe treo thì vẫn trả lời trong hạn thời gian", async () => {
    const started = Date.now();
    const result = await checkReadiness(() => new Promise<boolean>(() => {}), 50);
    expect(result.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
