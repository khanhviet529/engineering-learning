import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX được transform theo `jsx: "react-jsx"` trong tsconfig của package này.
  // Không đặt tuỳ chọn `esbuild` ở đây: Vite 8 dùng oxc và sẽ bỏ qua nó, kèm
  // một cảnh báo — tức là một dòng cấu hình không có tác dụng nhưng trông như có.
  test: {
    // Component test cần DOM. Token test không cần, nhưng một môi trường duy
    // nhất tránh việc phải giữ hai cấu hình đồng bộ.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
  },
});
