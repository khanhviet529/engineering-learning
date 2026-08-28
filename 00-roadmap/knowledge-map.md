---
level: foundation
area: cross-cutting
---

# Knowledge Map

Bản đồ theo **tầng hệ thống**. Dùng file này khi bạn biết vấn đề đang xảy ra ở đâu nhưng chưa biết đọc note nào.

Hai bản đồ còn lại: [Behavior Index](behavior-index.md) (theo hiện tượng) và [Topic Index](04-topic-index.md) (theo công nghệ).

## Xương sống runtime

Mọi note trong repo này phải định vị được trên đường đi sau. Nếu một note không định vị được, note đó đang thiếu context.

```text
User
 │
 ▼
Browser ──────────────────── 01-web-frontend/00-web-foundations
 │  DNS · TCP · TLS · HTTP · DOM · CSSOM · event loop
 ▼
React / Next.js ──────────── 01-web-frontend/02-react · 03-nextjs
 │  state · render · hydration · server/client boundary
 ▼
HTTP ─────────────────────── 02-backend-api/00-http-api
 │  method · status · header · cookie · idempotency
 ▼
Reverse proxy / Gateway ──── 04-infrastructure/01-networking
 │  TLS termination · load balancing · timeout
 ▼
NestJS ───────────────────── 02-backend-api/02-nestjs
 │  middleware → guard → interceptor → pipe → controller
 ▼
Application / Domain ─────── 02-backend-api/04-architecture
 │  service · use case · invariant
 ▼
Data Access (ORM) ────────── 03-database/05-data-access
 │  Prisma · N+1 · transaction · migration · raw SQL
 ▼
Cache / Queue ────────────── 03-database/02-redis · 04-message-queues
 │  cache-aside · TTL · producer/consumer · retry · DLQ
 ▼
PostgreSQL ───────────────── 03-database/00-sql · 01-postgresql
 │  MVCC · index · WAL · lock · connection pool
 ▼
Operating System ─────────── 04-infrastructure/00-linux
 │  process · fd · signal · memory · permission
 ▼
Container ────────────────── 04-infrastructure/02-docker
 │  image · layer · namespace · cgroup · volume
 ▼
Network ──────────────────── 04-infrastructure/01-networking
 │  IP · subnet · routing · NAT · firewall
 ▼
Kubernetes / Infra ───────── 04-infrastructure/04-kubernetes
    pod · service · ingress · probe · rollout
```

Xuyên qua **toàn bộ** các tầng trên: [05-cross-cutting/](../05-cross-cutting/README.md).

## Tra cứu theo tầng

### Tầng Browser

| Bạn đang gặp | Đọc |
|---|---|
| Trang tải chậm, không biết bước nào chậm | [Browser request → render](../01-web-frontend/00-web-foundations/01-browser-request-render.md) · [Rendering pipeline](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md) |
| Không rõ vì sao request không đi ra mạng | [HTTP & browser cache](../01-web-frontend/00-web-foundations/02-http-browser-cache.md) |
| `CORS error` trong console | [CORS](../01-web-frontend/00-web-foundations/06-cors.md) |
| Không biết lưu token ở đâu | [Cookies & storage](../01-web-frontend/00-web-foundations/05-cookies-storage.md) · [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) |
| Cần realtime | [WebSocket & SSE](../01-web-frontend/00-web-foundations/08-websocket-sse.md) |
| Muốn chặn XSS ở tầng browser | [CSP & browser security](../01-web-frontend/00-web-foundations/07-csp-browser-security.md) |

### Tầng JavaScript / TypeScript

| Bạn đang gặp | Đọc |
|---|---|
| Thứ tự log không như dự đoán | [Event loop & async](../01-web-frontend/01-javascript-typescript/async-concurrency/01-event-loop-async.md) |
| Hàm đọc giá trị cũ | [Execution context & closure](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) |
| `Promise.all` vs tuần tự, unhandled rejection | [Promise & concurrency](../01-web-frontend/01-javascript-typescript/async-concurrency/02-promise-concurrency.md) |
| Process RSS tăng dần | [Memory & GC](../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md) |
| `Cannot use import outside a module` | [Modules & bundling](../01-web-frontend/01-javascript-typescript/fundamentals/02-modules-bundling.md) |
| Type đúng nhưng runtime sai | [TypeScript ↔ runtime boundary](../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md) |
| Cần mô hình hoá state bằng type | [Type system](../01-web-frontend/01-javascript-typescript/typescript/02-type-system.md) · [Advanced types](../01-web-frontend/01-javascript-typescript/typescript/03-advanced-types.md) |
| Error bị mất, stack trace vô dụng | [Error handling & immutability](../01-web-frontend/01-javascript-typescript/fundamentals/03-error-handling-immutability.md) |

### Tầng React

| Bạn đang gặp | Đọc |
|---|---|
| Không biết cái gì gây re-render | [State → render](../01-web-frontend/02-react/behavior/01-state-render.md) |
| List mất state / input reset khi sắp xếp | [Reconciliation & keys](../01-web-frontend/02-react/behavior/05-reconciliation-keys.md) |
| Effect chạy 2 lần, chạy vô hạn | [Effects & lifecycle](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md) |
| Dữ liệu nhảy sai khi click nhanh | [Async race condition](../01-web-frontend/02-react/behavior/03-async-race-condition.md) |
| Fetch trong effect ngày càng khó quản | [Server state & cache](../01-web-frontend/02-react/behavior/04-server-state-cache.md) |
| State ở đâu, ai sở hữu | [Props, composition & state design](../01-web-frontend/02-react/behavior/06-props-composition-state-design.md) |
| Context làm cả cây re-render | [Context & memoization](../01-web-frontend/02-react/behavior/07-context-memoization.md) |
| Input lag, cần focus/scroll DOM | [Refs & uncontrolled](../01-web-frontend/02-react/behavior/08-refs-uncontrolled.md) |
| App trắng khi có lỗi | [Error boundaries & Suspense](../01-web-frontend/02-react/behavior/09-error-boundaries-suspense.md) |
| Form phức tạp, validate rối | [Forms](../01-web-frontend/02-react/behavior/10-forms.md) |
| Muốn tách logic tái dùng | [Custom hooks](../01-web-frontend/02-react/behavior/11-custom-hooks.md) |
| App chậm khi list dài | [React performance](../01-web-frontend/02-react/behavior/12-performance.md) |
| Không biết test cái gì | [Testing React](../01-web-frontend/02-react/behavior/13-testing-react.md) |

### Tầng Next.js

| Bạn đang gặp | Đọc |
|---|---|
| `useState is not defined` / lỗi khi import server code | [Server/Client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) |
| Không biết trang render lúc nào | [Rendering strategies](../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md) |
| Layout không reset, loading không hiện | [Routing & layout](../01-web-frontend/03-nextjs/behavior/02-routing-layout-rendering.md) |
| DB đã đổi mà trang vẫn cũ | [Data fetching & cache](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) |
| Cần API endpoint / mutation | [Route Handlers & Server Actions](../01-web-frontend/03-nextjs/behavior/05-route-handlers-server-actions.md) |
| Cần bảo vệ route | [Middleware & auth patterns](../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md) |
| SEO, OG image, ảnh chậm | [Metadata, images & assets](../01-web-frontend/03-nextjs/behavior/07-metadata-images-assets.md) |
| Build được nhưng production sai | [Deployment & production](../01-web-frontend/03-nextjs/behavior/08-deployment-production.md) |

### Tầng HTTP / API

| Bạn đang gặp | Đọc |
|---|---|
| Chọn method / status code | [HTTP request/response](../02-backend-api/00-http-api/01-http-request-response.md) · [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) |
| Thiết kế resource, URL | [REST API contract](../02-backend-api/00-http-api/02-rest-api-contract.md) |
| List API chậm, trang lệch dữ liệu | [Pagination, filtering, sorting](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) |
| Client không phân biệt được lỗi | [Error model](../02-backend-api/00-http-api/05-error-model.md) |
| Cần đổi API mà không phá client | [Versioning & evolution](../02-backend-api/00-http-api/06-api-versioning-evolution.md) |
| Bị abuse / cần bảo vệ tài nguyên | [Rate limiting](../02-backend-api/00-http-api/07-rate-limiting.md) |
| REST có phải lựa chọn đúng? | [RPC, GraphQL & alternatives](../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md) |

### Tầng Node.js

| Bạn đang gặp | Đọc |
|---|---|
| Server treo, latency tăng đều | [Node runtime & concurrency](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) |
| File lớn làm hết RAM | [Streams & buffers](../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md) |
| OOM, heap tăng dần | [Process & memory](../02-backend-api/01-nodejs/production/01-process-memory.md) |
| Tác vụ CPU chặn request khác | [Worker threads & CPU](../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) |
| Deploy làm mất request đang xử lý | [Graceful shutdown](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) |

### Tầng NestJS

| Bạn đang gặp | Đọc |
|---|---|
| Không biết code mới nên đặt đâu | [Request lifecycle](../02-backend-api/02-nestjs/behavior/01-request-lifecycle.md) |
| Circular dependency, provider not found | [Modules & DI](../02-backend-api/02-nestjs/behavior/02-modules-di.md) |
| Payload sai không bị chặn | [Validation & errors](../02-backend-api/02-nestjs/behavior/03-validation-errors.md) |
| Cần auth / logging / transform response | [Guards & interceptors](../02-backend-api/02-nestjs/behavior/04-guards-interceptors.md) |
| Config khác nhau giữa môi trường | [Config & lifecycle](../02-backend-api/02-nestjs/behavior/05-config-lifecycle.md) |
| Transaction rải rác nhiều service | [Database integration & transactions](../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) |
| Request chậm vì việc nặng | [Caching, queues & jobs](../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) |
| Cần realtime từ backend | [WebSocket gateway](../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md) |
| Test chậm và giòn | [Testing NestJS](../02-backend-api/02-nestjs/behavior/09-testing-nestjs.md) |

### Tầng Database

| Bạn đang gặp | Đọc |
|---|---|
| Chưa quen nghĩ bằng quan hệ | [Relational thinking](../03-database/00-sql/01-relational-thinking.md) |
| JOIN ra sai số dòng | [Joins & aggregation](../03-database/00-sql/02-joins-aggregation.md) |
| Query lồng nhau khó đọc | [Subqueries & CTE](../03-database/00-sql/03-subqueries-cte.md) |
| Cần xếp hạng, running total | [Window functions](../03-database/00-sql/04-window-functions.md) |
| Dữ liệu sai khi ghi đồng thời | [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) · [Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) |
| Table phình to dù đã xoá | [MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |
| Query chậm | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) · [EXPLAIN ANALYZE workflow](../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) |
| `too many connections` | [Connection pool](../03-database/01-postgresql/fundamentals/02-connection-pool.md) |
| Cần scale read | [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md) |
| Schema sẽ đau về sau | [Normalization](../03-database/03-data-modeling/02-normalization.md) · [Relationships & cardinality](../03-database/03-data-modeling/03-relationships-cardinality.md) |
| Migration làm downtime | [Migrations](../03-database/03-data-modeling/04-migrations.md) |
| Soft delete phá unique constraint | [Soft delete & audit](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) |

### Tầng Data Access (ORM)

| Bạn đang gặp | Đọc |
|---|---|
| Không rõ nên dùng ORM, query builder hay raw SQL | [ORM vs QB vs Raw SQL](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) |
| Compile sạch mà runtime báo cột không tồn tại | [Prisma model & client](../03-database/05-data-access/02-prisma-model-and-client.md) |
| Endpoint chậm tuyến tính theo số dòng | [Prisma relations & N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| `P2024` pool timeout, dữ liệu không nhất quán | [Prisma transactions](../03-database/05-data-access/04-prisma-transactions.md) |
| Đổi schema production mà không downtime | [Prisma migrations](../03-database/05-data-access/05-prisma-migrations-production.md) |
| Cần window function / CTE / `FOR UPDATE` | [Raw SQL escape hatches](../03-database/05-data-access/06-raw-sql-escape-hatches.md) |
| Không rõ có cần repository | [Repository pattern & testing](../03-database/05-data-access/07-repository-pattern-testing.md) |

### Tầng MongoDB

| Bạn đang gặp | Đọc |
|---|---|
| Đang chọn giữa PostgreSQL và MongoDB | [PostgreSQL vs MongoDB](../03-database/06-mongodb/08-postgresql-vs-mongodb.md) |
| Chưa rõ document model khác quan hệ ở đâu | [Document model](../03-database/06-mongodb/01-document-model.md) |
| Không biết nên nhúng hay tham chiếu | [Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md) |
| `BSONObjectTooLarge`, ghi chậm dần | [Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md) |
| Query bỏ sót dữ liệu im lặng | [Schema design & validation](../03-database/06-mongodb/03-schema-design-validation.md) |
| `Sort exceeded memory limit`, `COLLSCAN` | [Indexes & query planning](../03-database/06-mongodb/04-indexes-query-planning.md) |
| Aggregation chậm gấp nghìn lần | [Aggregation pipeline](../03-database/06-mongodb/05-aggregation-pipeline.md) |
| Cần transaction đa document | [Transactions & consistency](../03-database/06-mongodb/06-transactions-consistency.md) |
| Latency cao dù index đúng | [Operations & production](../03-database/06-mongodb/07-operations-production.md) |

### Tầng Cache / Queue

| Bạn đang gặp | Đọc |
|---|---|
| Dữ liệu cũ hiện trên UI | [Cache invalidation](../03-database/02-redis/01-cache-invalidation.md) |
| Chọn chiến lược cache | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) |
| Redis hết RAM, key biến mất | [Eviction & memory](../03-database/02-redis/04-eviction-memory.md) |
| Redis restart mất dữ liệu | [Persistence & failure](../03-database/02-redis/05-persistence-failure.md) |
| Cần rate limit / lock | [Rate limit & locking](../03-database/02-redis/02-rate-limit-locking.md) |
| Request phải chờ việc nặng | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| Job chạy 2 lần / bị mất | [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) · [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) |
| Event mất khi DB commit nhưng publish fail | [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) |

### Tầng OS / Container / Network

| Bạn đang gặp | Đọc |
|---|---|
| `EADDRINUSE`, không rõ ai giữ port | [Ports & sockets](../04-infrastructure/00-linux/05-ports-sockets.md) |
| `permission denied` khi ghi file | [Filesystem & permissions](../04-infrastructure/00-linux/03-filesystem-permissions.md) |
| Container bị `OOMKilled` | [Memory, CPU & limits](../04-infrastructure/00-linux/02-memory-cpu-limits.md) |
| Process không chịu tắt | [Signals & lifecycle](../04-infrastructure/00-linux/04-signals-lifecycle.md) |
| Không biết dùng công cụ gì để xem | [Linux debugging toolbox](../04-infrastructure/00-linux/07-debugging-toolbox.md) · [Network debugging](../04-infrastructure/01-networking/06-network-debugging.md) |
| `ENOTFOUND` / DNS sai | [IP, port, DNS](../04-infrastructure/01-networking/01-ip-port-dns.md) |
| `connection refused` vs `timeout` | [TCP & UDP](../04-infrastructure/01-networking/02-tcp-udp.md) |
| Lỗi certificate | [TLS](../04-infrastructure/01-networking/03-tls.md) |
| Cần đặt gì trước app | [Reverse proxy & load balancer](../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) |
| Image quá lớn, build chậm | [Dockerfile & build cache](../04-infrastructure/02-docker/05-dockerfile-build-cache.md) · [Production image](../04-infrastructure/02-docker/07-production-image.md) |
| `localhost` trong container không tới đâu | [Container networking](../04-infrastructure/02-docker/02-container-networking.md) |
| Restart mất dữ liệu | [Volumes & state](../04-infrastructure/02-docker/03-volumes-state.md) |

### Tầng Kubernetes

| Bạn đang gặp | Đọc |
|---|---|
| Docker Compose đủ rồi, vì sao cần K8s? | [Vì sao cần Kubernetes](../04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md) |
| Không hiểu quan hệ pod/deployment/service | [Pod, Deployment, Service](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md) |
| Pod restart liên tục | [Readiness & liveness](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) · [Debugging K8s](../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md) |
| `Pending`, không được schedule | [Scheduling & resources](../04-infrastructure/04-kubernetes/scheduling-reliability/02-scheduling-resources.md) |
| Không truy cập được từ ngoài | [Ingress & service discovery](../04-infrastructure/04-kubernetes/workloads-networking/02-ingress-service-discovery.md) |
| Deploy gây downtime | [Rollout & rollback](../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) |
| Chạy database trên K8s | [Storage & StatefulSet](../04-infrastructure/04-kubernetes/workloads-networking/04-storage-statefulset.md) |
| Tải tăng, cần tự scale | [Autoscaling](../04-infrastructure/04-kubernetes/scheduling-reliability/03-autoscaling.md) |

### Tầng xuyên suốt

| Bạn đang gặp | Đọc |
|---|---|
| Đổi ID trong URL xem được dữ liệu người khác | [Access control](../05-cross-cutting/security/04-access-control.md) · [Authorization models](../02-backend-api/03-auth/06-authorization-models.md) |
| Không biết bảo vệ cái gì, khỏi ai | [Security basics](../05-cross-cutting/security/01-security-basics.md) |
| Dùng ORM khắp nơi vẫn lo injection | [Injection](../05-cross-cutting/security/02-injection.md) |
| Script chạy trong origin của mình | [XSS & CSRF](../05-cross-cutting/security/03-xss-csrf.md) |
| Tính năng "nhập từ URL" gọi được địa chỉ nội bộ | [SSRF & supply chain](../05-cross-cutting/security/05-ssrf-supply-chain.md) |
| Không xoay được credential vì sợ downtime | [Secrets management](../05-cross-cutting/security/06-secrets-management.md) |
| Cookie `secure` không được đặt ở production | [Secure headers & TLS](../05-cross-cutting/security/07-secure-headers-tls.md) |
| Refactor làm hỏng hàng trăm test | [Test theo behavior](../05-cross-cutting/testing/01-testing-pyramid-behavior.md) |
| Unit test xanh nhưng lỗi ở kiểu dữ liệu | [Unit vs integration](../05-cross-cutting/testing/02-unit-vs-integration.md) · [Testcontainers](../05-cross-cutting/testing/05-testcontainers.md) |
| CI đỏ ngẫu nhiên, đội ngũ bỏ qua kết quả | [Deterministic tests](../05-cross-cutting/testing/06-deterministic-tests.md) · [API & E2E](../05-cross-cutting/testing/03-api-e2e-tests.md) |
| Mock trôi khỏi API thật | [Mocking & test doubles](../05-cross-cutting/testing/04-mocking-test-doubles.md) · [Contract testing](../05-cross-cutting/testing/07-contract-testing.md) |
| Có log, metric, trace mà vẫn không tìm ra nguyên nhân | [Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) |
| Không ghép được log của một request | [Structured logging](../05-cross-cutting/observability/02-structured-logging.md) · [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) |
| SLO đạt nhưng khách hàng phàn nàn | [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md) |
| Người trực đã tắt thông báo cảnh báo | [Alerting & dashboards](../05-cross-cutting/observability/05-alerting-dashboards.md) |
| Tối ưu xong mà p99 không đổi | [Latency & bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| Lighthouse cao nhưng người dùng vẫn kêu chậm | [Frontend performance](../05-cross-cutting/performance/02-frontend-performance.md) |
| Endpoint không chạm I/O cũng chậm | [Backend performance](../05-cross-cutting/performance/03-backend-performance.md) |
| Truy vấn nhanh ở staging, chậm ở production | [Database performance](../05-cross-cutting/performance/04-database-performance.md) |
| Load test đẹp, production sập | [Profiling & load testing](../05-cross-cutting/performance/05-profiling-load-testing.md) |
| Đột biến làm sập và rất lâu phục hồi | [Backpressure](../05-cross-cutting/performance/06-backpressure.md) |
| Một tính năng phụ kéo sập cả hệ thống | [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) |
| Retry làm dependency hỏng nặng hơn | [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| Mất một dependency = mất toàn bộ tính năng | [Graceful degradation](../05-cross-cutting/reliability/03-graceful-degradation.md) |
| Scale lên làm database từ chối kết nối | [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md) |
| Thêm worker threads mà không nhanh hơn | [Concurrency models](../05-cross-cutting/concurrency/01-concurrency-models.md) |
| Giới hạn 100 suất mà bán được 137 | [Shared state & races](../05-cross-cutting/concurrency/02-shared-state-races.md) |
| Hai job cùng chạy dù đã có khoá | [Distributed locks](../05-cross-cutting/concurrency/03-distributed-locks.md) |

Tổng quan: [05-cross-cutting/README.md](../05-cross-cutting/README.md).

### Tầng System Design

| Bạn đang gặp | Đọc |
|---|---|
| Không biết bắt đầu thiết kế từ đâu | [Requirements & trade-offs](../06-system-design/01-requirements-tradeoffs.md) · [Design exercise template](../06-system-design/10-design-exercise-template.md) |
| Cần chịu tải cao hơn | [Scaling: cache & queue](../06-system-design/02-scaling-cache-queue.md) |
| Người dùng bị tính tiền hai lần | [Idempotency & retry](../06-system-design/03-idempotency-retry.md) |
| Uptime cao nhưng dữ liệu sai | [Consistency & availability](../06-system-design/04-consistency-availability.md) |
| Một database không đủ cho tải ghi | [Data partitioning & sharding](../06-system-design/05-data-partitioning-sharding.md) |
| Không biết chọn kho dữ liệu nào | [Storage selection](../06-system-design/06-storage-selection.md) |
| Luồng nghiệp vụ không còn ở chỗ nào | [Event-driven](../06-system-design/07-event-driven.md) |
| Cân nhắc tách microservices | [Monolith → microservices](../06-system-design/08-monolith-to-microservices.md) |
| Mọi dòng code đúng mà hệ thống vẫn chết | [Distributed systems fallacies](../06-system-design/09-distributed-systems-fallacies.md) |

### Tầng làm việc với AI

| Bạn đang gặp | Đọc |
|---|---|
| Code merge nhanh, sửa bug chậm | [AI thay đổi cái gì](../09-ai-assisted-development/01-what-ai-changes.md) |
| Kết quả AI không khớp hệ thống của mình | [Context engineering](../09-ai-assisted-development/02-context-engineering.md) |
| PR sạch, test xanh, vẫn lọt bug nghiêm trọng | [Reviewing AI code](../09-ai-assisted-development/03-reviewing-ai-code.md) |
| Cấu hình apply thành công mà không có tác dụng | [Hallucination & verification](../09-ai-assisted-development/04-hallucination-verification.md) |
| Đưa tính năng AI vào sản phẩm | [AI security & limits](../09-ai-assisted-development/05-ai-security-limits.md) |

## Học theo thứ tự nào?

Nếu bạn chỉ muốn một câu trả lời: đi theo [Roadmap 12 behavior](02-roadmap.md) từ trên xuống. Đừng nhảy tới Kubernetes trước behavior 11.

## Related

- [Behavior Index](behavior-index.md)
- [Topic Index](04-topic-index.md)
- [Roadmap](02-roadmap.md)
- [Knowledge Audit](knowledge-audit.md)
