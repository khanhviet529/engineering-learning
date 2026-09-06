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
    // Workspace thứ ba cần đúng bản chỉnh này, sau `apps/web` ở M5 và
    // `apps/api` ở M4. Cùng một nguyên nhân mỗi lần: một lần render dựng cả
    // `ConfigProvider` của Ant Design, và `userEvent` chờ theo đồng hồ thật —
    // nên 5s mặc định của Vitest, vốn chọn cho unit test thuần, hết hạn vì
    // **máy bận** chứ không vì component sai.
    //
    // Đo được: 95 test mất 61s wall. Bài `nhãn trỏ tới input` hết giờ trên CI
    // và trên máy đang chạy song song, xanh khi chạy riêng — đúng loại thất
    // bại chỉ xuất hiện khi cả bộ chạy cùng lúc.
    //
    // Nới **ngưỡng chờ**, không nới điều kiện phải đúng.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // `fileParallelism` **giữ nguyên bật**, khác `apps/web`. Tôi đã tắt nó một
    // lần theo suy diễn — cùng lớp vấn đề nên chắc cùng lời giải — rồi đo:
    // 61s thành 293s, gấp năm, để đổi lấy một thứ chưa ai chứng minh là cần.
    // Thất bại thật ở đây là **hết giờ**, và `testTimeout` một mình đã đủ.
    // `apps/web` tắt nó vì frontend **đo được** flake thật; ở đây thì chưa.
  },
});
