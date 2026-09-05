import { defineConfig, devices } from "@playwright/test";
import { API_BASE_URL, WEB_BASE_URL } from "./src/env.ts";

/**
 * Playwright cho Flowboard.
 *
 * Ba quyết định ở đây không phải mặc định, và mỗi cái đóng một cách nói dối:
 *
 * 1. **`retries: 0`.** Retry biến một bug đua (race) thành một lần chạy xanh ở
 *    lượt thứ hai, và bộ E2E lập tức dạy người đọc rằng "chạy lại là được".
 *    Mốc này tồn tại để **tìm** bug, nên một lần đỏ phải ở lại màn hình.
 * 2. **`workers: 1`, `fullyParallel: false`.** Bốn service dùng **một**
 *    PostgreSQL, và vài bài kiểm đếm số hàng trong bảng để chứng minh
 *    idempotency. Chạy song song thì phép đếm đó đo lẫn dữ liệu của bài khác.
 * 3. **Không `webServer`.** Stack là Compose, và việc nó lên được hay không
 *    chính là một phần của bài kiểm — Playwright tự dựng server sẽ giấu đúng
 *    thứ mốc này muốn nhìn thấy.
 *
 * Không có `waitForTimeout` cố định ở bất cứ đâu trong bộ này. Chờ một con số
 * giây là chờ một thứ không ai đo được, và nó hỏng trên máy chậm hơn.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Trần cho **cả** spec, không cho một assertion. Rộng vì hai lý do có thật:
  // đăng ký bị giữ nhịp theo hạn mức 5 lần/phút của server, và vài spec dựng
  // hàng chục công việc qua HTTP trước khi bắt đầu đo.
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // `http://localhost` — cookie phiên **không** được `Secure`, nếu không
    // browser sẽ không gửi nó và mọi thứ hỏng theo cách không đọc được.
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  metadata: { apiBaseUrl: API_BASE_URL },
});
