---
level: foundation
area: cross-cutting
---

# Behavior Index

Tra cứu theo **hiện tượng bạn quan sát được**, không theo công nghệ.

Dùng file này khi bạn thấy một triệu chứng và chưa biết nó thuộc tầng nào. Ba bản đồ: file này (hiện tượng), [Knowledge Map](knowledge-map.md) (tầng), [Topic Index](04-topic-index.md) (công nghệ).

## Triệu chứng → tầng → note

### "Nó hiển thị sai dữ liệu"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| Dữ liệu nhảy về giá trị cũ sau khi click nhanh | React | [Async race condition](../01-web-frontend/02-react/behavior/03-async-race-condition.md) |
| Giá trị trong callback là giá trị của lần render trước | JavaScript closure | [Execution context & closure](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) · [Effects & lifecycle](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md) |
| DB đã đổi nhưng trang Next.js vẫn cũ | Next.js cache | [Data fetching & cache](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) |
| Đổi DB, xoá Redis rồi mà vẫn cũ | Browser/CDN cache | [HTTP & browser cache](../01-web-frontend/00-web-foundations/02-http-browser-cache.md) |
| Cũ với người này, mới với người kia | Cache per-instance / per-user | [Cache invalidation](../03-database/02-redis/01-cache-invalidation.md) |
| Số tiền / tồn kho sai sau khi có nhiều người dùng | Database concurrency | [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) |
| Input mất chữ khi list re-order | React key | [Reconciliation & keys](../01-web-frontend/02-react/behavior/05-reconciliation-keys.md) |
| Trang 2 của list lặp lại item của trang 1 | API pagination | [Pagination, filtering, sorting](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) |
| Type nói có mà runtime `undefined` | TS ↔ runtime | [TypeScript ↔ runtime boundary](../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md) |

### "Nó chậm"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| Trang trắng lâu trước khi thấy nội dung | Browser critical path | [Rendering pipeline](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md) · [Frontend performance](../05-cross-cutting/performance/02-frontend-performance.md) |
| Gõ vào input bị lag | React render | [React performance](../01-web-frontend/02-react/behavior/12-performance.md) |
| Một endpoint chậm, các endpoint khác cũng chậm theo | Node event loop bị block | [Node runtime & concurrency](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) · [Worker threads & CPU](../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) |
| Nhanh với 1k dòng, chết với 1M dòng | Missing index / seq scan | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| List API gọi database N+1 lần | ORM lazy loading | [Database performance](../05-cross-cutting/performance/04-database-performance.md) |
| Latency p50 ổn nhưng p99 rất tệ | Queue / pool contention | [Latency & throughput](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) · [Connection pool](../03-database/01-postgresql/fundamentals/02-connection-pool.md) |
| Chậm dần theo thời gian, restart lại nhanh | Memory leak / bloat | [Memory & GC](../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md) · [MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |
| Chậm chỉ khi deploy version mới | Cold cache / cold start | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) · [Rollout & rollback](../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) |
| Đột nhiên toàn bộ chậm sau khi cache hết hạn | Cache stampede | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) |

### "Nó không kết nối được"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| `ENOTFOUND` / `getaddrinfo` | DNS | [IP, port, DNS](../04-infrastructure/01-networking/01-ip-port-dns.md) |
| `ECONNREFUSED` | Không có ai listen ở port đó | [Ports & sockets](../04-infrastructure/00-linux/05-ports-sockets.md) · [TCP & UDP](../04-infrastructure/01-networking/02-tcp-udp.md) |
| `ETIMEDOUT` | Packet bị chặn hoặc mất | [NAT, firewall & routing](../04-infrastructure/01-networking/04-nat-firewall-routing.md) |
| Chạy trên máy, chết trong container | `localhost` khác nhau | [Container networking](../04-infrastructure/02-docker/02-container-networking.md) |
| Bind `127.0.0.1` nên ngoài không vào được | Bind address | [Common Docker failures](../04-infrastructure/02-docker/08-common-failures.md) |
| Lỗi `certificate` / `SELF_SIGNED_CERT` | TLS chain | [TLS](../04-infrastructure/01-networking/03-tls.md) |
| Browser chặn dù `curl` gọi được | CORS | [CORS](../01-web-frontend/00-web-foundations/06-cors.md) |
| `too many connections` từ PostgreSQL | Pool sizing | [Connection pool](../03-database/01-postgresql/fundamentals/02-connection-pool.md) |
| Service trong K8s không resolve | Service discovery | [Ingress & service discovery](../04-infrastructure/04-kubernetes/workloads-networking/02-ingress-service-discovery.md) |

### "Nó bị từ chối"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| 400 với payload trông hợp lệ | Validation pipe | [Validation & errors](../02-backend-api/02-nestjs/behavior/03-validation-errors.md) |
| 401 dù vừa login | Cookie/token không được gửi | [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) · [Cookies & storage](../01-web-frontend/00-web-foundations/05-cookies-storage.md) |
| 401 sau đúng 15 phút | Access token hết hạn | [JWT & refresh token](../02-backend-api/03-auth/03-jwt-refresh-token.md) |
| 403 với user đúng role | Ownership check | [Authorization models](../02-backend-api/03-auth/06-authorization-models.md) |
| User A đọc được dữ liệu của user B | Broken access control | [Access control](../05-cross-cutting/security/04-access-control.md) |
| 429 | Rate limit | [Rate limiting](../02-backend-api/00-http-api/07-rate-limiting.md) |
| `permission denied` khi ghi file trong container | UID / filesystem | [Filesystem & permissions](../04-infrastructure/00-linux/03-filesystem-permissions.md) |

### "Nó chạy 2 lần / bị mất"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| Effect chạy 2 lần trong dev | StrictMode | [Effects & lifecycle](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md) |
| Người dùng bị charge 2 lần | Retry không idempotent | [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) · [Idempotency & retry](../06-system-design/03-idempotency-retry.md) |
| Job xử lý 2 lần | At-least-once delivery | [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) |
| Email gửi rồi nhưng DB rollback | Dual write | [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) |
| Job biến mất không dấu vết | Ack sai chỗ / DLQ | [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) |
| Request mất khi deploy | Không graceful shutdown | [Graceful shutdown](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) |
| Dữ liệu container mất sau restart | Không có volume | [Volumes & state](../04-infrastructure/02-docker/03-volumes-state.md) |
| Cron chạy nhiều lần vì có nhiều replica | Không có leader election | [Distributed locks](../05-cross-cutting/concurrency/03-distributed-locks.md) |

### "Nó chết"

| Triệu chứng | Tầng khả nghi | Note |
|---|---|---|
| Pod `CrashLoopBackOff` | Config / probe / lỗi khởi động | [Debugging K8s](../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md) |
| `OOMKilled` | Memory limit | [Memory, CPU & limits](../04-infrastructure/00-linux/02-memory-cpu-limits.md) |
| Node process exit code 137 / 143 | SIGKILL / SIGTERM | [Signals & lifecycle](../04-infrastructure/00-linux/04-signals-lifecycle.md) |
| JS heap out of memory | Leak | [Process & memory](../02-backend-api/01-nodejs/production/01-process-memory.md) |
| Một service chậm làm cả hệ thống sập | Cascading failure | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| Deploy xong toàn bộ 503 | Readiness sai | [Readiness & liveness](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) |
| `deadlock detected` | Thứ tự lock | [Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) |
| App trắng khi có một lỗi render | Không có error boundary | [Error boundaries & Suspense](../01-web-frontend/02-react/behavior/09-error-boundaries-suspense.md) |

### "Tôi không biết chuyện gì đang xảy ra"

| Nhu cầu | Note |
|---|---|
| Cần biết *đã xảy ra gì* cho một request cụ thể | [Structured logging](../05-cross-cutting/observability/02-structured-logging.md) |
| Cần biết *hệ thống đang khoẻ không* | [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md) |
| Cần biết *thời gian đi đâu mất* qua nhiều service | [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) |
| Cần công cụ quan sát ở Linux | [Linux debugging toolbox](../04-infrastructure/00-linux/07-debugging-toolbox.md) |
| Cần công cụ quan sát network | [Network debugging](../04-infrastructure/01-networking/06-network-debugging.md) |
| Cần đọc query plan | [EXPLAIN ANALYZE workflow](../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) |
| Cần alert đúng thứ | [Alerting & dashboards](../05-cross-cutting/observability/05-alerting-dashboards.md) |
| Cần một quy trình debug có kỷ luật | [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) |

## Cùng một vấn đề ở nhiều tầng

Một số họ vấn đề xuất hiện lại ở mọi tầng với tên khác nhau. Nhận ra chúng là dấu hiệu bạn đã hiểu, không chỉ ghi nhớ.

| Họ vấn đề | Ở browser | Ở backend | Ở database | Ở distributed |
|---|---|---|---|---|
| **Race condition** | response cũ ghi đè state mới | hai request cùng sửa một record | lost update | hai worker cùng nhận một job |
| **Cache staleness** | HTTP cache | Next.js data cache | replica lag | eventual consistency |
| **Timeout** | fetch treo | pool cạn | statement timeout | cascading failure |
| **Idempotency** | double submit form | retry POST | upsert | at-least-once delivery |
| **Backpressure** | scroll jank | queue đầy | pool đầy | consumer lag |
| **Isolation** | không có | request context | transaction isolation | tenant isolation |

Note tổng hợp: [Concurrency models](../05-cross-cutting/concurrency/01-concurrency-models.md).

## Related

- [Roadmap](02-roadmap.md) — 12 behavior theo thứ tự học
- [Behavior Map](01-behavior-map.md) — behavior → công nghệ
- [Knowledge Map](knowledge-map.md) — tra cứu theo tầng
- [Topic Index](04-topic-index.md) — tra cứu theo công nghệ
