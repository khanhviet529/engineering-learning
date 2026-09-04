import { afterEach, describe, expect, it, vi } from "vitest";
import { Intent, Transport, fieldError, formErrors, type ApiFailure } from "./transport.ts";

/**
 * Tầng transport quyết định retry có phục hồi được hay không, nên nó phải có
 * test riêng chứ không chỉ được kiểm gián tiếp qua màn hình.
 */

const baseUrl = "http://api.test";

function mockFetch(response: { status: number; body?: unknown; headers?: Record<string, string> }) {
  const fn = vi.fn(async () =>
    response.status === 204
      ? new Response(null, { status: 204, headers: response.headers })
      : new Response(JSON.stringify(response.body ?? {}), {
          status: response.status,
          headers: { "content-type": "application/json", ...response.headers },
        }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vòng đời Idempotency-Key", () => {
  it("một ý định giữ NGUYÊN key qua nhiều lần gửi lại", () => {
    const intent = new Intent();
    const key = intent.key;
    expect(intent.key).toBe(key);
    expect(intent.key).toBe(key);
  });

  it("xoay key cho một ý định mới", () => {
    const intent = new Intent();
    const before = intent.key;
    intent.rotate();
    expect(intent.key).not.toBe(before);
  });

  it("hai ý định khác nhau có key khác nhau", () => {
    expect(new Intent().key).not.toBe(new Intent().key);
  });

  it("key được gửi trong header khi có intent", async () => {
    const fetchMock = mockFetch({ status: 201, body: { data: {}, requestId: "r1" } });
    const intent = new Intent();
    const transport = new Transport({ baseUrl });

    await transport.request("/auth/sign-up", { method: "POST", body: {}, intent });

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe(intent.key);
  });

  it("KHÔNG gửi key khi không có intent — endpoint không yêu cầu thì không gửi", async () => {
    const fetchMock = mockFetch({ status: 200, body: { data: {}, requestId: "r1" } });
    await new Transport({ baseUrl }).request("/auth/session");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("gửi lại vì lỗi mạng dùng lại CÙNG key — đó chính là mục đích của nó", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const intent = new Intent();
    const keyBefore = intent.key;
    const transport = new Transport({ baseUrl });

    const result = await transport.request("/auth/sign-up", { method: "POST", body: {}, intent });

    expect(result.ok).toBe(false);
    // Transport không tự xoay key: lỗi vận chuyển vẫn là cùng một ý định.
    expect(intent.key).toBe(keyBefore);
  });
});

describe("CSRF", () => {
  it("mutation gửi kèm CSRF token", async () => {
    const fetchMock = mockFetch({ status: 200, body: { data: {}, requestId: "r1" } });
    const transport = new Transport({ baseUrl, csrfToken: "csrf-abc" });

    await transport.request("/auth/sign-out", { method: "POST" });

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe("csrf-abc");
  });

  it("GET KHÔNG gửi CSRF — thừa, và làm token lộ ra nơi không cần biết", async () => {
    const fetchMock = mockFetch({ status: 200, body: { data: {}, requestId: "r1" } });
    await new Transport({ baseUrl, csrfToken: "csrf-abc" }).request("/auth/session");
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBeUndefined();
  });

  it("luôn gửi cookie: session là HttpOnly nên phải yêu cầu tường minh", async () => {
    const fetchMock = mockFetch({ status: 200, body: { data: {}, requestId: "r1" } });
    await new Transport({ baseUrl }).request("/auth/session");
    expect(fetchMock.mock.calls[0]![1]!.credentials).toBe("include");
  });
});

describe("chuẩn hoá lỗi", () => {
  it("VALIDATION_FAILED cho field error đọc được theo tên field", async () => {
    mockFetch({
      status: 400,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "Dữ liệu không hợp lệ.",
          details: [{ field: "password", code: "too_short", message: "Quá ngắn." }],
        },
        requestId: "r1",
      },
    });

    const result = (await new Transport({ baseUrl }).request("/auth/sign-up", {
      method: "POST",
      body: {},
    })) as ApiFailure;

    expect(result.ok).toBe(false);
    expect(fieldError(result, "password")).toBe("Quá ngắn.");
    expect(fieldError(result, "email")).toBeUndefined();
  });

  it("lỗi không thuộc field nào được đưa lên cấp form", async () => {
    mockFetch({
      status: 400,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "x",
          details: [
            { field: "password", code: "too_short", message: "Quá ngắn." },
            { field: "(root)", code: "invalid", message: "Yêu cầu không hợp lệ." },
          ],
        },
        requestId: "r1",
      },
    });

    const result = (await new Transport({ baseUrl }).request("/x", {
      method: "POST",
    })) as ApiFailure;
    expect(formErrors(result, ["password"])).toEqual(["Yêu cầu không hợp lệ."]);
  });

  it("TASK_VERSION_CONFLICT cho currentVersion để dựng màn resolution", async () => {
    mockFetch({
      status: 409,
      body: {
        error: { code: "TASK_VERSION_CONFLICT", message: "x", details: { currentVersion: 7 } },
        requestId: "r1",
      },
    });

    const result = (await new Transport({ baseUrl }).request("/x", {
      method: "POST",
    })) as ApiFailure;
    expect(result.currentVersion).toBe(7);
  });

  it("code KHÔNG công bố details thì fieldErrors rỗng, không đoán bừa", async () => {
    mockFetch({
      status: 403,
      body: { error: { code: "FORBIDDEN", message: "Không có quyền." }, requestId: "r1" },
    });

    const result = (await new Transport({ baseUrl }).request("/x", {
      method: "POST",
    })) as ApiFailure;
    expect(result.code).toBe("FORBIDDEN");
    expect(result.fieldErrors).toEqual([]);
    expect(result.currentVersion).toBeUndefined();
  });

  it("429 mang Retry-After để UI biết khoá control tới bao giờ", async () => {
    mockFetch({
      status: 429,
      body: { error: { code: "RATE_LIMITED", message: "x" }, requestId: "r1" },
      headers: { "retry-after": "42" },
    });

    const result = (await new Transport({ baseUrl }).request("/x", {
      method: "POST",
    })) as ApiFailure;
    expect(result.retryAfterSeconds).toBe(42);
  });

  it("lỗi mạng thành một failure có hình dạng chuẩn, không phải exception ném ra ngoài", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const result = (await new Transport({ baseUrl }).request("/x")) as ApiFailure;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it("body không phải JSON vẫn cho failure đọc được", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    const result = (await new Transport({ baseUrl }).request("/x")) as ApiFailure;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INTERNAL_ERROR");
  });
});

describe("nhánh thành công", () => {
  it("bóc `data` khỏi envelope và giữ requestId", async () => {
    mockFetch({ status: 200, body: { data: { actor: { id: "u1" } }, requestId: "r9" } });
    const result = await new Transport({ baseUrl }).request<{ actor: { id: string } }>(
      "/auth/session",
    );
    expect(result).toEqual({ ok: true, data: { actor: { id: "u1" } }, requestId: "r9" });
  });

  it("204 không có body nhưng vẫn lấy được requestId từ header", async () => {
    mockFetch({ status: 204, headers: { "x-request-id": "r204" } });
    const result = await new Transport({ baseUrl }).request("/auth/sign-out", { method: "POST" });
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("r204");
  });
});
