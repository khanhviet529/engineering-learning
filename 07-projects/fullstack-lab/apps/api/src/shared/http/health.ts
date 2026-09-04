/**
 * Liveness và readiness — `docs/operations/observability.md`.
 *
 * Hai endpoint này trả lời hai câu **khác nhau**, và trộn chúng là một lỗi vận
 * hành thật chứ không phải chuyện hình thức:
 *
 * - `GET /health/live`: process còn sống để nhận traffic không? Nó **không**
 *   query PostgreSQL, Mailpit hay bất kỳ dependency nào. Liveness fail là lý do
 *   restart process.
 * - `GET /health/ready`: API phục vụ được request lõi *bây giờ* không? Nó kiểm
 *   PostgreSQL bằng timeout ngắn. Dependency outage chỉ làm readiness fail —
 *   nếu nó cũng làm liveness fail thì orchestrator sẽ restart process trong khi
 *   lỗi nằm ở database, và restart không sửa được gì.
 *
 * Cả hai không đi qua authorization hay use case, không log secret, không tạo
 * activity, và body **không** lộ version, credential, topology hay chi tiết
 * dependency.
 */

export interface HealthResult {
  status: number;
  body: { status: "ok" } | { status: "unavailable" };
}

export const LIVE_RESULT: HealthResult = { status: 200, body: { status: "ok" } };

/** Hàm kiểm một dependency; trả `true` khi dependency dùng được. */
export type DependencyProbe = () => Promise<boolean>;

/**
 * Chạy probe với hạn thời gian cứng.
 *
 * Nếu không có timeout, một database treo sẽ làm readiness treo theo, và
 * orchestrator mất luôn tín hiệu để hành động — đúng lúc nó cần tín hiệu nhất.
 */
export async function checkReadiness(
  probe: DependencyProbe,
  timeoutMs = 2_000,
): Promise<HealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    const healthy = await Promise.race([probe().catch(() => false), timeout]);
    return healthy
      ? { status: 200, body: { status: "ok" } }
      : { status: 503, body: { status: "unavailable" } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
