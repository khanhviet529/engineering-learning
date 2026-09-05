import { expect, request, test } from "@playwright/test";
import { API_BASE_URL, WEB_BASE_URL } from "../src/env.ts";

/**
 * Preflight của CORS phải cho phép **mọi method mà hợp đồng dùng**.
 *
 * Đây là bài kiểm nhỏ nhất trong cả bộ và nó tồn tại vì một lý do cụ thể: web
 * ở `:3000`, api ở `:3001`, nên **mọi** request là cross-origin, và mọi
 * `PATCH`/`DELETE` phải qua một preflight `OPTIONS`. Nếu preflight không liệt
 * kê method đó, trình duyệt chặn request **trước khi nó rời máy** — server
 * không thấy gì, log không có gì, và client chỉ nhận một `TypeError` của
 * `fetch`. Ở giao diện, nó hiện ra thành "không kết nối được máy chủ".
 *
 * Không bộ kiểm nào ở hai lane kia chạm được vào lớp này: `apps/api` gọi
 * `inject()` thẳng vào Fastify nên không có preflight nào, còn `apps/web` chạy
 * trong jsdom với `fetch` bị stub nên cũng không có. Nó chỉ lộ ra trong một
 * trình duyệt thật, gọi qua hai origin thật.
 *
 * Bài kiểm này không dùng trình duyệt: nó hỏi thẳng preflight bằng HTTP, vì
 * câu trả lời nằm ở header chứ không ở màn hình.
 */

/** Đúng những method mà `apps/web/src/lib/workspace-api.ts` phát ra. */
const REQUIRED = ["GET", "POST", "PATCH", "DELETE"] as const;

test("preflight cho phép mọi method mà client thật sự gửi", async () => {
  const api = await request.newContext();

  const response = await api.fetch(`${API_BASE_URL}/tasks/preflight-probe`, {
    method: "OPTIONS",
    headers: {
      origin: WEB_BASE_URL,
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "content-type,x-csrf-token,idempotency-key",
    },
  });

  expect(response.status(), "preflight không được trả lời").toBeLessThan(400);
  expect(response.headers()["access-control-allow-origin"]).toBe(WEB_BASE_URL);
  expect(response.headers()["access-control-allow-credentials"]).toBe("true");

  const allowed = (response.headers()["access-control-allow-methods"] ?? "")
    .split(",")
    .map((method) => method.trim().toUpperCase())
    .filter((method) => method !== "");

  const missing = REQUIRED.filter((method) => !allowed.includes(method));
  expect(
    missing,
    `Access-Control-Allow-Methods là "${allowed.join(",")}". Thiếu ${missing.join(", ")}, nên trình duyệt chặn mọi lệnh đó trước khi chúng rời máy. Bảy chỗ gọi trong apps/web/src/lib/workspace-api.ts dùng chúng: sửa task, đổi tên/cờ/lưu trữ cột, đổi tên dự án, đổi vai trò thành viên dự án, gỡ thành viên dự án, gỡ thành viên workspace, thu hồi lời mời.`,
  ).toEqual([]);

  await api.dispose();
});
