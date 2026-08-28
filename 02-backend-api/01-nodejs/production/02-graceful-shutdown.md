---
level: intermediate
area: backend
prerequisites:
  - ../fundamentals/01-runtime-concurrency.md
related:
  - ../../../04-infrastructure/00-linux/04-signals-lifecycle.md
  - ../../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md
---

# Graceful shutdown

> Mỗi lần deploy, một số request đang xử lý bị cắt giữa đường. Với 10 deploy/ngày và 3 replica, đó là hàng trăm lỗi mà không ai điều tra vì "chỉ là do deploy".

## Position

```text
Kubernetes gửi SIGTERM → app ngừng nhận request MỚI → xử lý xong request CŨ
  → đóng DB/Redis/worker → exit 0
  (nếu quá terminationGracePeriodSeconds → SIGKILL → exit 137)
```

## Problem

```ts
// Mặc định: không có handler nào
const server = app.listen(3000);
// SIGTERM → process thoát NGAY
// → request đang xử lý bị cắt (client nhận ECONNRESET)
// → transaction đang mở bị rollback giữa đường
// → job đang chạy mất, không ai biết
// → connection tới DB không được đóng sạch
```

Nhưng có một vấn đề tinh vi hơn và nó là nguyên nhân của phần lớn 502 khi deploy:

```text
t=0     K8s gửi SIGTERM cho pod
t=0     K8s BẮT ĐẦU xoá pod khỏi Service endpoints  (bất đồng bộ!)
t=0.05  App đóng server ngay → ngừng nhận kết nối
t=0.2   Load balancer VẪN CHƯA cập nhật → gửi request tới pod này
        → connection refused → 502
t=1.5   LB cập nhật xong
```

Việc xoá endpoint khỏi Service và việc gửi SIGTERM xảy ra **song song**, không tuần tự. Nếu app đóng server ngay khi nhận SIGTERM, sẽ có một khoảng 1–2 giây mà LB vẫn gửi traffic tới một cổng đã đóng.

Vì vậy graceful shutdown đúng phải **chờ một chút trước khi đóng**.

## Mental Model

```text
SIGTERM
   │
   ├─ 1. readiness = false          → LB bắt đầu rút traffic
   │
   ├─ 2. CHỜ (3–5 giây)             ← bước hay bị bỏ, gây 502
   │
   ├─ 3. server.close()             → ngừng nhận kết nối MỚI
   │                                  (request đang xử lý vẫn tiếp tục)
   ├─ 4. chờ request đang xử lý xong (có timeout)
   │
   ├─ 5. đóng dependency            → queue worker, DB pool, Redis, worker threads
   │
   └─ 6. process.exit(0)
```

Thứ tự này quan trọng. Đảo bước 1 và 3 (đóng server trước khi báo not-ready) là nguyên nhân trực tiếp của 502 khi deploy.

Và ràng buộc thời gian:

```text
tổng thời gian shutdown  <  terminationGracePeriodSeconds  (mặc định 30s)
```

Vượt quá → SIGKILL → exit 137, mất mọi thứ đang xử lý. Xem [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md).

## How It Works

### Implementation đầy đủ

```ts
let shuttingDown = false;
const SHUTDOWN_DELAY_MS = 5_000;      // chờ LB rút traffic
const DRAIN_TIMEOUT_MS = 15_000;      // trần cho request đang xử lý

// Readiness probe đọc cờ này
app.get('/ready', (_req, res) =>
  shuttingDown ? res.status(503).json({ status: 'shutting_down' })
               : res.status(200).json({ status: 'ok' }));

const server = app.listen(3000);

// Keep-alive connection cần được theo dõi để đóng được
server.keepAliveTimeout = 5_000;
server.headersTimeout = 6_000;        // phải > keepAliveTimeout

async function shutdown(signal: string) {
  if (shuttingDown) return;           // idempotent — K8s có thể gửi lại
  shuttingDown = true;
  logger.info({ signal }, 'shutdown started');

  // 2. Chờ LB rút traffic (readiness đã trả 503 từ lúc này)
  await sleep(SHUTDOWN_DELAY_MS);

  // 3 + 4. Ngừng nhận mới, chờ request cũ xong
  await Promise.race([
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))),
    sleep(DRAIN_TIMEOUT_MS).then(() => {
      logger.warn('drain timeout — forcing close');
      server.closeAllConnections?.();          // Node 18.2+
    }),
  ]);

  // 5. Đóng dependency — thứ tự: consumer trước, storage sau
  try {
    await queueWorker.close();        // ngừng nhận job mới, chờ job hiện tại
    await workerPool.destroy();       // terminate worker threads
    await redis.quit();
    await db.$disconnect();           // hoặc pool.end()
  } catch (err) {
    logger.error({ err }, 'error closing dependencies');
  }

  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

Năm chi tiết dễ bỏ:

1. **Cờ `shuttingDown` phải idempotent** — K8s có thể gửi SIGTERM nhiều lần; hai lần shutdown chạy song song gây lỗi lạ.
2. **`SHUTDOWN_DELAY_MS`** — bước duy nhất chống 502. Không có nó, mọi thứ khác vô nghĩa.
3. **`keepAliveTimeout`** — `server.close()` **không** đóng connection keep-alive đang idle. Không đặt timeout này, `close()` treo cho tới khi client tự ngắt.
4. **`headersTimeout` > `keepAliveTimeout`** — nếu ngược lại, có race gây lỗi 502 ngẫu nhiên ngay cả khi không deploy.
5. **Thứ tự đóng dependency**: consumer (queue worker) trước, storage (DB, Redis) sau. Đóng DB trước khi worker xong làm job đang chạy lỗi.

### Queue worker

```ts
// BullMQ — worker phải xong job hiện tại trước khi thoát
await worker.close();          // ngừng nhận job mới, chờ job đang chạy

// Job dài hơn grace period? Thiết kế job CHIA NHỎ và có checkpoint,
// hoặc dùng job.updateProgress + resume, để mất tiến độ không đắt.
```

Với job dài (>30 giây), graceful shutdown không cứu được — grace period sẽ hết. Giải pháp là thiết kế job **idempotent và có checkpoint** để retry sau khi restart không mất công. Xem [Retry & DLQ](../../../03-database/04-message-queues/03-retry-dlq.md).

### Cấu hình Kubernetes tương ứng

```yaml
spec:
  terminationGracePeriodSeconds: 45        # > SHUTDOWN_DELAY + DRAIN_TIMEOUT + margin
  containers:
    - name: api
      readinessProbe:
        httpGet: { path: /ready, port: 3000 }
        periodSeconds: 2                   # ngắn để rút traffic nhanh
        failureThreshold: 1
      livenessProbe:
        httpGet: { path: /health, port: 3000 }   # KHÔNG đọc cờ shuttingDown
        periodSeconds: 20
```

Điểm quan trọng: **liveness probe không được trả 503 khi đang shutdown.** Nếu nó trả 503, K8s coi pod là chết và gửi SIGKILL ngay — cắt ngắn graceful shutdown. Chỉ readiness phản ánh trạng thái shutdown.

Xem [Readiness & liveness](../../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md).

### PID 1 trong container

```dockerfile
# ❌ Shell làm PID 1 và KHÔNG forward SIGTERM cho node
CMD npm start

# ✅ node là PID 1, nhận signal trực tiếp
CMD ["node", "dist/main.js"]

# ✅ Hoặc dùng init để reap zombie và forward signal
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

`CMD npm start` là nguyên nhân rất phổ biến của "graceful shutdown không hoạt động": `npm` là PID 1, nó không forward SIGTERM, nên Node không bao giờ thấy signal và bị SIGKILL sau grace period.

Kiểm tra: `docker exec <c> ps -o pid,comm` — PID 1 phải là `node`.

## Example

```text
Timeline một rolling update đúng cách:

t=0.0   K8s: SIGTERM → pod A;  bắt đầu xoá endpoint của A
t=0.0   App A: shuttingDown = true → /ready trả 503
t=0.1   Readiness probe fail → K8s xoá A khỏi Service
t=1.0   LB đã cập nhật, không gửi request mới tới A
t=5.0   App A: server.close() — 3 request đang xử lý vẫn tiếp tục
t=6.2   3 request xong → server closed
t=6.3   queue worker close → redis quit → db disconnect
t=6.4   exit 0

→ 0 request bị cắt, 0 lỗi 502
```

## Prediction

1. Không có SIGTERM handler, rolling update 3 replica, 100 req/s — bao nhiêu request bị cắt?
2. Có handler nhưng đóng `server.close()` ngay (không delay) — client thấy gì trong 1–2 giây đầu?
3. `CMD npm start` trong Dockerfile — Node có nhận SIGTERM không? Exit code cuối cùng?
4. Không đặt `keepAliveTimeout`, client dùng keep-alive — `server.close()` khi nào resolve?
5. `headersTimeout` < `keepAliveTimeout` — hậu quả?
6. Shutdown mất 40 giây, `terminationGracePeriodSeconds: 30` — kết quả?
7. Liveness probe cũng trả 503 khi shutting down — điều gì xảy ra?
8. Đóng DB pool trước khi queue worker xong — job đang chạy thế nào?

<details>
<summary>Đáp án</summary>

1. Mọi request đang bay tại thời điểm mỗi pod thoát — hàng chục tới hàng trăm.
2. `ECONNREFUSED`/502 — LB chưa cập nhật.
3. Không; `npm` không forward. Sau grace period → SIGKILL → **137**.
4. Không resolve cho tới khi client tự ngắt — có thể treo tới grace period.
5. Race giữa hai timeout → 502 ngẫu nhiên, kể cả khi không deploy.
6. SIGKILL ở giây 30 → exit 137, mất request và job đang xử lý.
7. K8s coi pod chết → SIGKILL ngay → graceful shutdown bị cắt ngắn.
8. Lỗi "connection closed" giữa job.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ SIGTERM handler, chạy load test rồi `kubectl rollout restart` | Đếm lỗi ở client trong lúc deploy |
| Thêm handler nhưng bỏ `SHUTDOWN_DELAY` | Vẫn có 502 trong 1–2 giây đầu |
| Thêm delay 5s | Lỗi về 0 |
| `CMD npm start`, gửi SIGTERM | `docker ps` cho thấy container mất ~grace period rồi exit 137 |
| Đổi sang `CMD ["node", ...]` | Exit 0 gần như tức thì sau khi drain xong |
| Bỏ `keepAliveTimeout`, client giữ keep-alive | `server.close()` treo |
| `headersTimeout < keepAliveTimeout` | 502 ngẫu nhiên ngay cả khi không deploy |
| Shutdown 40s với grace period 30s | Exit 137, mất request đang xử lý |
| Liveness probe đọc cờ `shuttingDown` | SIGKILL ngay, graceful shutdown bị cắt |
| Đóng DB trước queue worker | Job lỗi "connection closed" |
| Gửi SIGTERM hai lần nhanh | Nếu không idempotent: hai luồng shutdown, lỗi lạ |

## What Usually Goes Wrong

- **Không có handler nào** → mất request mỗi lần deploy, và không ai điều tra vì "chỉ do deploy".
- **Đóng server ngay, không delay** → 502 vì LB chưa cập nhật. Đây là lỗi phổ biến nhất trong các implementation "đã có graceful shutdown".
- **`CMD npm start`** → Node không nhận SIGTERM, luôn bị SIGKILL.
- **Không đặt `keepAliveTimeout`** → `close()` treo.
- **`headersTimeout` ≤ `keepAliveTimeout`** → 502 ngẫu nhiên.
- **Grace period ngắn hơn thời gian shutdown** → SIGKILL.
- **Liveness probe phản ánh trạng thái shutdown** → K8s kill ngay.
- **Thứ tự đóng dependency sai** → job/transaction lỗi giữa đường.
- **Không đóng worker threads** → process không thoát. Xem [Worker threads](../runtime-io/02-worker-threads-cpu.md).
- **Handler không idempotent** → hai luồng shutdown song song.
- **Job dài hơn grace period** → không có cách nào cứu; phải thiết kế job có checkpoint.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `server.close()` là đủ | Cần readiness=false + delay trước đó |
| K8s xoá endpoint trước khi gửi SIGTERM | Hai việc xảy ra **song song** |
| `server.close()` đóng mọi connection | Không đóng keep-alive đang idle |
| Node tự xử lý SIGTERM đúng cách | Mặc định thoát ngay, cắt request |
| `npm start` trong container là ổn | `npm` không forward signal |
| Grace period mặc định 30s luôn đủ | Phụ thuộc thời gian drain và job đang chạy |
| Liveness và readiness nên cùng logic | Chỉ readiness được phản ánh shutdown |
| Deploy mất vài request là bình thường | Có thể về 0 với ~40 dòng code |

## Debugging

1. **Đếm lỗi trong lúc deploy**: chạy `autocannon`/`k6` với tải ổn định rồi `kubectl rollout restart`. Số lỗi là chỉ số duy nhất đáng tin — không dựa vào cảm giác.
2. **Exit code**: `kubectl get pod -o jsonpath='{..containerStatuses[0].lastState.terminated.exitCode}'`. `0` = graceful; `137` = bị SIGKILL (grace period hết hoặc PID 1 sai).
3. **Kiểm tra PID 1**: `kubectl exec <pod> -- ps -o pid,comm`. PID 1 phải là `node`.
4. **App có thấy SIGTERM không** → log ngay dòng đầu của handler. Không có log = signal không tới (PID 1 sai).
5. **`close()` treo** → kiểm tra `keepAliveTimeout`; log số connection còn mở trước khi close.
6. **502 chỉ trong lúc deploy** → tăng `SHUTDOWN_DELAY_MS`, giảm `readinessProbe.periodSeconds`.
7. **Đo thời gian shutdown thật** (log timestamp từng bước) rồi đặt `terminationGracePeriodSeconds` = thời gian đó × 1,5.

## Production Considerations

- **`terminationGracePeriodSeconds` > `SHUTDOWN_DELAY` + `DRAIN_TIMEOUT` + thời gian đóng dependency + margin.**
- **`readinessProbe.periodSeconds` ngắn (2s), `failureThreshold: 1`** để rút traffic nhanh.
- **`keepAliveTimeout` < `headersTimeout`**, và cả hai nhỏ hơn idle timeout của LB.
- **PID 1 là `node`** hoặc dùng `tini`.
- **Job dài phải idempotent và có checkpoint** — graceful shutdown không cứu được job 10 phút.
- **Log từng bước shutdown với timestamp** — đây là cách duy nhất biết bước nào chậm.
- **Metric: số lỗi trong cửa sổ deploy.** Nếu không đo, bạn không biết graceful shutdown có hoạt động.
- **`preStop` hook** là cách khác để tạo delay nếu không muốn sửa code:
  ```yaml
  lifecycle:
    preStop:
      exec: { command: ["sh", "-c", "sleep 5"] }
  ```
  Nó chạy **trước** SIGTERM, nên cũng giải quyết vấn đề LB chưa cập nhật.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Delay dài (5–10s) | không mất request | deploy chậm hơn (× số pod nếu tuần tự) |
| Delay ngắn | deploy nhanh | rủi ro 502 |
| Drain timeout dài | request dài kịp xong | pod sống lâu, rollout chậm |
| `closeAllConnections()` sau timeout | rollout đúng hạn | cắt request chưa xong |
| `preStop` hook | không sửa code | logic shutdown chia hai chỗ |
| Job có checkpoint | restart không mất công | phức tạp hơn khi viết job |

## Explain Without Notes

1. Vẽ 6 bước của graceful shutdown theo đúng thứ tự, và nói vì sao thứ tự đó.
2. Vì sao cần delay trước `server.close()`? Điều gì xảy ra nếu bỏ nó?
3. Vì sao `CMD npm start` làm graceful shutdown không hoạt động?
4. Vì sao liveness probe không được phản ánh trạng thái shutdown?
5. Job chạy 10 phút — graceful shutdown giải quyết được không? Nếu không thì làm gì?

## Related

- [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md) — SIGTERM, SIGKILL, exit code
- [Readiness & liveness](../../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) — vai của từng probe
- [Rollout & rollback](../../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) — rolling update
- [Worker threads](../runtime-io/02-worker-threads-cpu.md) — phải `terminate()` khi shutdown
- [Process & memory](01-process-memory.md) — exit code 137 vs 143
- [Retry & DLQ](../../../03-database/04-message-queues/03-retry-dlq.md) — job idempotent, checkpoint
- [Deployment & production (Next.js)](../../../01-web-frontend/03-nextjs/behavior/08-deployment-production.md)
