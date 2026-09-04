import { defineConfig } from "vitest/config";

/**
 * `apps/web` có hai loại test và **một** môi trường: transport là logic thuần,
 * còn feature là component. Giữ hai cấu hình song song sẽ đòi hai chỗ phải
 * đồng bộ mãi mãi, nên cả hai chạy trên jsdom.
 *
 * `oxc.jsx` phải khai tường minh. `tsconfig.json` của app đặt
 * `jsx: "preserve"` — đúng cho Next, vì Next tự transform JSX ở bước build —
 * nhưng Vite thì đọc chính giá trị đó và để nguyên JSX, rồi báo "invalid JS
 * syntax". Ghi đè ở đây thay vì sửa tsconfig: đổi tsconfig sẽ đổi cách Next
 * build, tức là sửa production để chiều test.
 */
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    // Màn hình M2 dựng cả app shell (sidebar, topbar, antd ConfigProvider) nên
    // một lần render đắt hơn một component đơn lẻ nhiều. 5s mặc định đủ cho
    // phần lớn test nhưng không đủ cho các test có nhiều bước tương tác.
    testTimeout: 20_000,
  },
});
