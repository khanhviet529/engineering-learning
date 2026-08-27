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
| Thứ tự log không như dự đoán | [Event loop & async](../01-web-frontend/01-javascript-typescript/01-event-loop-async.md) |
| Hàm đọc giá trị cũ | [Execution context & closure](../01-web-frontend/01-javascript-typescript/03-execution-context-closure.md) |
| `Promise.all` vs tuần tự, unhandled rejection | [Promise & concurrency](../01-web-frontend/01-javascript-typescript/04-promise-concurrency.md) |
| Process RSS tăng dần | [Memory & GC](../01-web-frontend/01-javascript-typescript/05-memory-gc.md) |
| `Cannot use import outside a module` | [Modules & bundling](../01-web-frontend/01-javascript-typescript/06-modules-bundling.md) |
| Type đúng nhưng runtime sai | [TypeScript ↔ runtime boundary](../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md) |
| Cần mô hình hoá state bằng type | [Type system](../01-web-frontend/01-javascript-typescript/07-typescript-type-system.md) · [Advanced types](../01-web-frontend/01-javascript-typescript/08-typescript-advanced-types.md) |
| Error bị mất, stack trace vô dụng | [Error handling & immutability](../01-web-frontend/01-javascript-typescript/09-error-handling-immutability.md) |

### Tầng React

| Bạn đang gặp | Đọc |
|---|---|
| Không biết cái gì gây re-render | [State → render](../01-web-frontend/02-react/01-state-render.md) |
| List mất state / input reset khi sắp xếp | [Reconciliation & keys](../01-web-frontend/02-react/05-reconciliation-keys.md) |
| Effect chạy 2 lần, chạy vô hạn | [Effects & lifecycle](../01-web-frontend/02-react/02-effects-lifecycle.md) |
| Dữ liệu nhảy sai khi click nhanh | [Async race condition](../01-web-frontend/02-react/03-async-race-condition.md) |
| Fetch trong effect ngày càng khó quản | [Server state & cache](../01-web-frontend/02-react/04-server-state-cache.md) |
| State ở đâu, ai sở hữu | [Props, composition & state design](../01-web-frontend/02-react/06-props-composition-state-design.md) |
| Context làm cả cây re-render | [Context & memoization](../01-web-frontend/02-react/07-context-memoization.md) |
| Input lag, cần focus/scroll DOM | [Refs & uncontrolled](../01-web-frontend/02-react/08-refs-uncontrolled.md) |
| App trắng khi có lỗi | [Error boundaries & Suspense](../01-web-frontend/02-react/09-error-boundaries-suspense.md) |
| Form phức tạp, validate rối | [Forms](../01-web-frontend/02-react/10-forms.md) |
| Muốn tách logic tái dùng | [Custom hooks](../01-web-frontend/02-react/11-custom-hooks.md) |
| App chậm khi list dài | [React performance](../01-web-frontend/02-react/12-performance.md) |
| Không biết test cái gì | [Testing React](../01-web-frontend/02-react/13-testing-react.md) |

### Tầng Next.js

| Bạn đang gặp | Đọc |
|---|---|
| `useState is not defined` / lỗi khi import server code | [Server/Client boundary](../01-web-frontend/03-nextjs/01-server-client-boundary.md) |
| Không biết trang render lúc nào | [Rendering strategies](../01-web-frontend/03-nextjs/04-rendering-strategies.md) |
| Layout không reset, loading không hiện | [Routing & layout](../01-web-frontend/03-nextjs/02-routing-layout-rendering.md) |
| DB đã đổi mà trang vẫn cũ | [Data fetching & cache](../01-web-frontend/03-nextjs/03-data-fetching-cache.md) |
| Cần API endpoint / mutation | [Route Handlers & Server Actions](../01-web-frontend/03-nextjs/05-route-handlers-server-actions.md) |
| Cần bảo vệ route | [Middleware & auth patterns](../01-web-frontend/03-nextjs/06-middleware-auth-patterns.md) |
| SEO, OG image, ảnh chậm | [Metadata, images & assets](../01-web-frontend/03-nextjs/07-metadata-images-assets.md) |
| Build được nhưng production sai | [Deployment & production](../01-web-frontend/03-nextjs/08-deployment-production.md) |

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
| Server treo, latency tăng đều | [Node runtime & concurrency](../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) |
| File lớn làm hết RAM | [Streams & buffers](../02-backend-api/01-nodejs/02-streams-buffers.md) |
| OOM, heap tăng dần | [Process & memory](../02-backend-api/01-nodejs/03-process-memory.md) |
| Tác vụ CPU chặn request khác | [Worker threads & CPU](../02-backend-api/01-nodejs/04-worker-threads-cpu.md) |
| Deploy làm mất request đang xử lý | [Graceful shutdown](../02-backend-api/01-nodejs/05-graceful-shutdown.md) |

### Tầng NestJS

| Bạn đang gặp | Đọc |
|---|---|
| Không biết code mới nên đặt đâu | [Request lifecycle](../02-backend-api/02-nestjs/01-request-lifecycle.md) |
| Circular dependency, provider not found | [Modules & DI](../02-backend-api/02-nestjs/02-modules-di.md) |
| Payload sai không bị chặn | [Validation & errors](../02-backend-api/02-nestjs/03-validation-errors.md) |
| Cần auth / logging / transform response | [Guards & interceptors](../02-backend-api/02-nestjs/04-guards-interceptors.md) |
| Config khác nhau giữa môi trường | [Config & lifecycle](../02-backend-api/02-nestjs/05-config-lifecycle.md) |
| Transaction rải rác nhiều service | [Database integration & transactions](../02-backend-api/02-nestjs/06-database-integration-transactions.md) |
| Request chậm vì việc nặng | [Caching, queues & jobs](../02-backend-api/02-nestjs/07-caching-queues-jobs.md) |
| Cần realtime từ backend | [WebSocket gateway](../02-backend-api/02-nestjs/08-websocket-gateway.md) |
| Test chậm và giòn | [Testing NestJS](../02-backend-api/02-nestjs/09-testing-nestjs.md) |

### Tầng Database

| Bạn đang gặp | Đọc |
|---|---|
| Chưa quen nghĩ bằng quan hệ | [Relational thinking](../03-database/00-sql/01-relational-thinking.md) |
| JOIN ra sai số dòng | [Joins & aggregation](../03-database/00-sql/02-joins-aggregation.md) |
| Query lồng nhau khó đọc | [Subqueries & CTE](../03-database/00-sql/03-subqueries-cte.md) |
| Cần xếp hạng, running total | [Window functions](../03-database/00-sql/04-window-functions.md) |
| Dữ liệu sai khi ghi đồng thời | [Transaction isolation](../03-database/01-postgresql/01-transaction-isolation.md) · [Locking & deadlock](../03-database/01-postgresql/05-locking-deadlock.md) |
| Table phình to dù đã xoá | [MVCC & vacuum](../03-database/01-postgresql/04-mvcc-vacuum.md) |
| Query chậm | [Index & query plan](../03-database/01-postgresql/02-index-query-plan.md) · [EXPLAIN ANALYZE workflow](../03-database/01-postgresql/08-explain-analyze-workflow.md) |
| `too many connections` | [Connection pool](../03-database/01-postgresql/03-connection-pool.md) |
| Cần scale read | [Replication & scaling](../03-database/01-postgresql/09-replication-scaling.md) |
| Schema sẽ đau về sau | [Normalization](../03-database/03-data-modeling/02-normalization.md) · [Relationships & cardinality](../03-database/03-data-modeling/03-relationships-cardinality.md) |
| Migration làm downtime | [Migrations](../03-database/03-data-modeling/04-migrations.md) |

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
| Docker Compose đủ rồi, vì sao cần K8s? | [Vì sao cần Kubernetes](../04-infrastructure/04-kubernetes/04-why-kubernetes.md) |
| Không hiểu quan hệ pod/deployment/service | [Pod, Deployment, Service](../04-infrastructure/04-kubernetes/01-pod-deployment-service.md) |
| Pod restart liên tục | [Readiness & liveness](../04-infrastructure/04-kubernetes/02-health-readiness-liveness.md) · [Debugging K8s](../04-infrastructure/04-kubernetes/10-debugging-k8s.md) |
| `Pending`, không được schedule | [Scheduling & resources](../04-infrastructure/04-kubernetes/05-scheduling-resources.md) |
| Không truy cập được từ ngoài | [Ingress & service discovery](../04-infrastructure/04-kubernetes/06-ingress-service-discovery.md) |
| Deploy gây downtime | [Rollout & rollback](../04-infrastructure/04-kubernetes/07-rollout-rollback.md) |
| Chạy database trên K8s | [Storage & StatefulSet](../04-infrastructure/04-kubernetes/08-storage-statefulset.md) |
| Tải tăng, cần tự scale | [Autoscaling](../04-infrastructure/04-kubernetes/09-autoscaling.md) |

### Tầng xuyên suốt

Xem [05-cross-cutting/README.md](../05-cross-cutting/README.md) cho auth, security, testing, observability, performance, reliability, concurrency.

## Học theo thứ tự nào?

Nếu bạn chỉ muốn một câu trả lời: đi theo [Roadmap 12 behavior](02-roadmap.md) từ trên xuống. Đừng nhảy tới Kubernetes trước behavior 11.

## Related

- [Behavior Index](behavior-index.md)
- [Topic Index](04-topic-index.md)
- [Roadmap](02-roadmap.md)
- [Knowledge Audit](knowledge-audit.md)
