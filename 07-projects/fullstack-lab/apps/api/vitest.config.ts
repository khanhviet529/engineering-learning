import { defineConfig } from "vitest/config";

/**
 * Bộ test của `apps/api` phần lớn là **integration**: chúng dựng app Nest thật,
 * nối PostgreSQL thật và gọi HTTP thật. Một test như vậy đắt hơn một unit test
 * hai bậc độ lớn, và ngân sách 5s mặc định của Vitest được chọn cho unit test.
 *
 * Chỗ này đã cắn thật: `endpoint-contract-matrix` gọi tuần tự **21** route trong
 * một test — con số đó lớn dần qua từng mốc (11 → 14 → 21) trong khi ngưỡng chờ
 * đứng yên, nên nó hết giờ vì **khối lượng đã tăng**, không vì hành vi sai. Đây
 * không phải nhiễu để chạy lại cho tới khi xanh: một cổng đỏ ngẫu nhiên thôi là
 * bằng chứng, và đó là lý do `pnpm test` đã chuyển các workspace sang chạy tuần
 * tự ở M2.
 *
 * Nới **ngưỡng chờ**, không nới điều kiện phải đúng. Cùng cách đã áp cho
 * `apps/web`, và cùng lý do ghi ở [ci-cd.md](../../docs/operations/ci-cd.md).
 */
export default defineConfig({
  test: {
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
