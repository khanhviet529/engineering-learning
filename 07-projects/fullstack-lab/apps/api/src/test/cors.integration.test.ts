import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORS_ALLOWED_HEADERS, CORS_EXPOSED_HEADERS, CORS_METHODS } from "../shared/http/cors.ts";
import { WEB_ORIGIN, createFixture, type Fixture } from "./fixture.ts";

/**
 * CORS đo qua **socket thật**, không qua `inject()`.
 *
 * ## Vì sao điều đó là cả nội dung của file này
 *
 * Hai lỗi CORS sống qua năm mốc trong khi hơn một nghìn test xanh, và lý do
 * không phải là "chưa ai viết test" mà là **chỗ nào cũng đo sai lớp**:
 *
 * - Test của `apps/api` gọi `app.inject()`, tức là đẩy thẳng một request đã dựng
 *   sẵn vào router của Fastify. Không có browser, nên **không có preflight** —
 *   `OPTIONS` không bao giờ được phát, và `access-control-allow-methods` không
 *   bao giờ được đọc.
 * - Test của `apps/web` chạy jsdom với `fetch` bị stub, nên cũng không có
 *   preflight.
 *
 * Lỗi sống đúng ở khe giữa hai lane. Nên một test dùng `inject()` để kiểm CORS
 * sẽ **xanh cả khi lỗi còn nguyên**: nó bỏ qua chính lớp đang hỏng. File này
 * `listen(0)` một cổng ephemeral và gọi `fetch` thật, đúng đường mà browser đi.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("CORS trên socket thật", () => {
  let f: Fixture;
  let base: string;

  beforeAll(async () => {
    f = await createFixture(url as string);
    /**
     * Cổng `0` là "hệ điều hành tự chọn".
     *
     * Cắm một số cứng nghĩa là test này xung đột với một API đang chạy trên máy
     * lập trình viên, và xung đột đó trông y hệt một lỗi CORS.
     */
    await f.app.listen({ port: 0, host: "127.0.0.1" });
    base = await f.app.getUrl();
  });

  afterAll(async () => {
    await f.cleanup();
  });

  /** Một preflight thật: `OPTIONS` kèm `Origin` và method định gọi. */
  async function preflight(
    method: string,
    options: { origin?: string; requestHeaders?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      origin: options.origin ?? WEB_ORIGIN,
      "access-control-request-method": method,
    };
    if (options.requestHeaders !== undefined) {
      headers["access-control-request-headers"] = options.requestHeaders;
    }
    // Route thật, không phải một đường bịa: preflight của `@fastify/cors` trả
    // lời bất kể route có tồn tại hay không, nên dùng một route thật giữ cho
    // test đo đúng đường mà browser đi.
    return await fetch(`${base}/workspaces`, { method: "OPTIONS", headers });
  }

  function listOf(response: Response, header: string): string[] {
    return (response.headers.get(header) ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
  }

  /* ---------------------------------------------------------------------- *
   * Method
   * ---------------------------------------------------------------------- */

  /**
   * Bốn method mà hợp đồng công bố, **lặp qua danh sách** chứ không viết tay.
   *
   * Viết tay bảy `it` nghĩa là thêm một endpoint `PATCH` ở mốc sau sẽ không có
   * ai nhắc; lặp qua `CORS_METHODS` làm danh sách trở thành một nguồn duy nhất.
   */
  for (const method of CORS_METHODS) {
    it(`preflight cho ${method} được chấp nhận`, async () => {
      const response = await preflight(method);

      expect(response.status).toBeLessThan(300);
      expect(listOf(response, "access-control-allow-methods")).toContain(method.toLowerCase());
    });
  }

  /**
   * `PATCH` và `DELETE` là hai method mà mặc định của `@fastify/cors` bỏ sót.
   *
   * Chúng có `it` riêng dù vòng lặp trên đã phủ, vì bảy endpoint hỏng đều nằm ở
   * đúng hai method này — một test mang tên chúng là thứ người đọc log CI tìm
   * thấy khi bug quay lại.
   */
  it("PATCH và DELETE — hai method mà mặc định của @fastify/cors bỏ sót", async () => {
    for (const method of ["PATCH", "DELETE"]) {
      const allowed = listOf(await preflight(method), "access-control-allow-methods");
      expect(allowed, method).toContain(method.toLowerCase());
    }
  });

  it("method ngoài danh sách không được nhận", async () => {
    const response = await preflight("PUT");
    // `PUT` không có trong hợp đồng, nên nó không được xuất hiện trong danh sách.
    expect(listOf(response, "access-control-allow-methods")).not.toContain("put");
  });

  /* ---------------------------------------------------------------------- *
   * Header client được đọc
   * ---------------------------------------------------------------------- */

  /**
   * `access-control-expose-headers` phải có mặt trên **response thật**, không
   * chỉ trên preflight.
   *
   * Đây là header quyết định browser có cho JavaScript đọc `x-request-id` hay
   * không, và nó chỉ có nghĩa trên response mang dữ liệu.
   */
  it("response thật cho phép đọc x-request-id và retry-after", async () => {
    const response = await fetch(`${base}/workspaces`, {
      headers: { origin: WEB_ORIGIN, cookie: `fb_session=${f.owner.sessionToken}` },
    });

    expect(response.status).toBe(200);
    const exposed = listOf(response, "access-control-expose-headers");
    for (const header of CORS_EXPOSED_HEADERS) {
      expect(exposed, header).toContain(header);
    }

    // Và server thật sự **gửi** header đó — nếu không, cho đọc cũng vô nghĩa.
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("preflight chấp nhận đúng những header mà transport gửi", async () => {
    const response = await preflight("PATCH", {
      requestHeaders: CORS_ALLOWED_HEADERS.join(", "),
    });

    expect(response.status).toBeLessThan(300);
    const allowed = listOf(response, "access-control-allow-headers");
    for (const header of CORS_ALLOWED_HEADERS) {
      expect(allowed, header).toContain(header);
    }
  });

  /* ---------------------------------------------------------------------- *
   * Origin
   * ---------------------------------------------------------------------- */

  /**
   * `access-control-allow-origin` phải là **đúng** `WEB_ORIGIN`, không phải `*`.
   *
   * Với `credentials: true`, spec Fetch cấm wildcard: browser sẽ từ chối
   * response dù server nói `*`. Nên một `*` ở đây không "rộng rãi hơn" — nó là
   * hỏng, theo cách khó chẩn đoán hơn cả bug nó định sửa.
   */
  it("allow-origin là chính WEB_ORIGIN, không phải `*`", async () => {
    const response = await fetch(`${base}/workspaces`, {
      headers: { origin: WEB_ORIGIN, cookie: `fb_session=${f.owner.sessionToken}` },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("origin lạ không được nhận", async () => {
    for (const origin of [
      "http://evil.test",
      "http://localhost:3001",
      "https://localhost:3000",
      `${WEB_ORIGIN}.evil.test`,
    ]) {
      const response = await fetch(`${base}/workspaces`, {
        headers: { origin, cookie: `fb_session=${f.owner.sessionToken}` },
      });
      expect(response.headers.get("access-control-allow-origin"), origin).not.toBe(origin);
      expect(response.headers.get("access-control-allow-origin"), origin).not.toBe("*");
    }
  });

  it("preflight từ origin lạ không cấp method nào", async () => {
    const response = await preflight("PATCH", { origin: "http://evil.test" });
    expect(response.headers.get("access-control-allow-origin")).not.toBe("http://evil.test");
  });

  /* ---------------------------------------------------------------------- *
   * Đường đi thật của một mutation
   * ---------------------------------------------------------------------- */

  /**
   * Preflight rồi **gọi thật** — đúng hai bước mà browser làm.
   *
   * Bảy endpoint hỏng đều là `PATCH`/`DELETE`, và cả bảy hỏng ở bước một. Test
   * này đi cả hai bước trên một route thật để "preflight xanh" không tách rời
   * "request đi được".
   */
  it("preflight rồi PATCH thật: cả hai bước đều qua được lớp CORS", async () => {
    const allowed = listOf(
      await preflight("PATCH", { requestHeaders: "content-type, x-csrf-token, idempotency-key" }),
      "access-control-allow-methods",
    );
    expect(allowed).toContain("patch");

    const response = await fetch(`${base}/projects/${f.projectBId}`, {
      method: "PATCH",
      headers: {
        origin: WEB_ORIGIN,
        "content-type": "application/json",
        "x-csrf-token": f.owner.csrfToken,
        "idempotency-key": `cors-${crypto.randomUUID()}`,
        cookie: `fb_session=${f.owner.sessionToken}`,
      },
      body: JSON.stringify({ name: `Đổi tên qua CORS ${crypto.randomUUID().slice(0, 8)}` }),
    });

    expect(response.status).toBe(200);
    // Và client đọc được mã tra cứu của chính request vừa rồi.
    expect(listOf(response, "access-control-expose-headers")).toContain("x-request-id");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
