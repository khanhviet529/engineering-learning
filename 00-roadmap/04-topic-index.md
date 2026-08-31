# Topic Index

Danh sách **toàn bộ note** trong repo, nhóm theo thư mục. Đây là index để **tra cứu theo tên**.

Bốn cách tìm khác, thường nhanh hơn:

| Bạn đang | Dùng |
|---|---|
| Có một triệu chứng cụ thể ("504 khi deploy", "p99 tăng") | [Behavior Index](behavior-index.md) |
| Có một problem thực tế ("màn hình 8 API", "có cần BFF") | [Application Engineering Map](application-engineering-map.md) |
| Muốn thấy bản đồ theo tầng | [Knowledge Map](knowledge-map.md) |
| Muốn một lộ trình học theo thứ tự | [Roadmap](02-roadmap.md) |

Mỗi folder có README riêng với **thứ tự đọc** và **bảng chẩn đoán** của folder đó — đó thường là nơi nên bắt đầu, không phải danh sách phẳng này.

## Tổng số

**294 note** (không tính README gốc và `templates/`).


### `00-roadmap`

- [Learning System](../00-roadmap/00-learning-system.md)
- [Behavior Map](../00-roadmap/01-behavior-map.md)
- [Roadmap](../00-roadmap/02-roadmap.md)
- [AI-Assisted Learning](../00-roadmap/03-ai-assisted-learning.md)
- [Topic Index](../00-roadmap/04-topic-index.md)
- [00 Roadmap](../00-roadmap/README.md)
- [Application Engineering Coverage Report](../00-roadmap/application-engineering-coverage-report.md)
- [Application Engineering Map](../00-roadmap/application-engineering-map.md)
- [Behavior Index](../00-roadmap/behavior-index.md)
- [Final Coverage Report](../00-roadmap/final-coverage-report.md)
- [Foundation Coverage Report](../00-roadmap/foundation-coverage-report.md)
- [Foundation Gap Audit](../00-roadmap/foundation-gap-audit.md)
- [Glossary](../00-roadmap/glossary.md)
- [Knowledge Architecture Audit](../00-roadmap/knowledge-architecture-audit.md)
- [Knowledge Architecture — Final Report](../00-roadmap/knowledge-architecture-final-report.md)
- [Knowledge Audit](../00-roadmap/knowledge-audit.md)
- [Knowledge Map](../00-roadmap/knowledge-map.md)
- [Project Roadmap](../00-roadmap/project-roadmap.md)

### `01-web-frontend`

- [Web & Frontend](../01-web-frontend/README.md)

### `01-web-frontend/00-web-foundations`

- [Từ vựng Web: URL, HTTP, origin](../01-web-frontend/00-web-foundations/00-web-vocabulary.md)
- [Browser: từ request tới render](../01-web-frontend/00-web-foundations/01-browser-request-render.md)
- [HTTP & browser cache](../01-web-frontend/00-web-foundations/02-http-browser-cache.md)
- [URL → DNS → TCP → TLS](../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md)
- [Rendering pipeline: DOM → CSSOM → layout → paint → composite](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md)
- [Cookies, localStorage, sessionStorage](../01-web-frontend/00-web-foundations/05-cookies-storage.md)
- [CORS](../01-web-frontend/00-web-foundations/06-cors.md)
- [CSP & browser security model](../01-web-frontend/00-web-foundations/07-csp-browser-security.md)
- [WebSocket & SSE](../01-web-frontend/00-web-foundations/08-websocket-sse.md)
- [Web Foundations](../01-web-frontend/00-web-foundations/README.md)

### `01-web-frontend/01-javascript-typescript`

- [JavaScript & TypeScript](../01-web-frontend/01-javascript-typescript/README.md)

### `01-web-frontend/01-javascript-typescript/async-concurrency`

- [Event loop & async](../01-web-frontend/01-javascript-typescript/async-concurrency/01-event-loop-async.md)
- [Promise & concurrency](../01-web-frontend/01-javascript-typescript/async-concurrency/02-promise-concurrency.md)

### `01-web-frontend/01-javascript-typescript/fundamentals`

- [Từ vựng JavaScript: giá trị, bộ nhớ, thứ tự chạy](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md)
- [Execution context, scope, closure, `this`, prototype](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md)
- [Module system & bundling](../01-web-frontend/01-javascript-typescript/fundamentals/02-modules-bundling.md)
- [Error handling & immutability](../01-web-frontend/01-javascript-typescript/fundamentals/03-error-handling-immutability.md)

### `01-web-frontend/01-javascript-typescript/runtime-behavior`

- [Memory & garbage collection](../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md)

### `01-web-frontend/01-javascript-typescript/typescript`

- [TypeScript ↔ runtime boundary](../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md)
- [TypeScript type system](../01-web-frontend/01-javascript-typescript/typescript/02-type-system.md)
- [Generics, mapped & conditional types](../01-web-frontend/01-javascript-typescript/typescript/03-advanced-types.md)

### `01-web-frontend/02-react`

- [React](../01-web-frontend/02-react/README.md)

### `01-web-frontend/02-react/behavior`

- [State → render](../01-web-frontend/02-react/behavior/01-state-render.md)
- [Effects & lifecycle](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md)
- [Async race condition trong UI](../01-web-frontend/02-react/behavior/03-async-race-condition.md)
- [Server state & cache](../01-web-frontend/02-react/behavior/04-server-state-cache.md)
- [Reconciliation & keys](../01-web-frontend/02-react/behavior/05-reconciliation-keys.md)
- [Props, composition & state design](../01-web-frontend/02-react/behavior/06-props-composition-state-design.md)
- [Context & memoization](../01-web-frontend/02-react/behavior/07-context-memoization.md)
- [Refs & uncontrolled components](../01-web-frontend/02-react/behavior/08-refs-uncontrolled.md)
- [Error boundaries & Suspense](../01-web-frontend/02-react/behavior/09-error-boundaries-suspense.md)
- [Forms](../01-web-frontend/02-react/behavior/10-forms.md)
- [Custom hooks](../01-web-frontend/02-react/behavior/11-custom-hooks.md)
- [React performance](../01-web-frontend/02-react/behavior/12-performance.md)
- [Testing React](../01-web-frontend/02-react/behavior/13-testing-react.md)
- [useReducer & state machine](../01-web-frontend/02-react/behavior/14-usereducer-state-machines.md)

### `01-web-frontend/02-react/fundamentals`

- [React foundations: từ vựng và mô hình render](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md)
- [Năm hook cốt lõi](../01-web-frontend/02-react/fundamentals/02-hooks-core.md)
- [Bản đồ hooks: cái nào tồn tại, dùng khi nào](../01-web-frontend/02-react/fundamentals/03-hooks-advanced-map.md)

### `01-web-frontend/03-nextjs`

- [Next.js](../01-web-frontend/03-nextjs/README.md)

### `01-web-frontend/03-nextjs/behavior`

- [Server / Client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md)
- [Routing, layout & file conventions](../01-web-frontend/03-nextjs/behavior/02-routing-layout-rendering.md)
- [Data fetching & cache](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md)
- [Rendering strategies: SSR, SSG, ISR, streaming, hydration](../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md)
- [Route Handlers & Server Actions](../01-web-frontend/03-nextjs/behavior/05-route-handlers-server-actions.md)
- [Middleware & auth patterns](../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md)
- [Metadata, images & assets](../01-web-frontend/03-nextjs/behavior/07-metadata-images-assets.md)
- [Deployment & production](../01-web-frontend/03-nextjs/behavior/08-deployment-production.md)

### `01-web-frontend/03-nextjs/fundamentals`

- [Next.js foundations: cấu trúc thư mục và từ vựng routing](../01-web-frontend/03-nextjs/fundamentals/01-app-router-structure.md)
- [Next.js 16: mô hình caching mới và những gì đã đổi](../01-web-frontend/03-nextjs/fundamentals/02-nextjs-16-changes.md)

### `01-web-frontend/04-application-engineering`

- [Một màn hình gọi nhiều API](../01-web-frontend/04-application-engineering/01-multi-api-screen.md)
- [Data fetching architecture](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md)
- [API chậm: tối ưu thật và tối ưu cảm nhận](../01-web-frontend/04-application-engineering/03-slow-api-ux.md)
- [Frontend resilience](../01-web-frontend/04-application-engineering/04-frontend-resilience.md)
- [Frontend Application Engineering](../01-web-frontend/04-application-engineering/README.md)

### `02-backend-api`

- [Backend & API](../02-backend-api/README.md)

### `02-backend-api/00-http-api`

- [Từ vựng API: endpoint, status code, REST, DTO](../02-backend-api/00-http-api/00-api-vocabulary.md)
- [HTTP request & response](../02-backend-api/00-http-api/01-http-request-response.md)
- [REST API contract](../02-backend-api/00-http-api/02-rest-api-contract.md)
- [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md)
- [Pagination, filtering, sorting](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md)
- [Error model](../02-backend-api/00-http-api/05-error-model.md)
- [API versioning & evolution](../02-backend-api/00-http-api/06-api-versioning-evolution.md)
- [Rate limiting](../02-backend-api/00-http-api/07-rate-limiting.md)
- [RPC, GraphQL & alternatives](../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md)
- [Upload & download file](../02-backend-api/00-http-api/09-file-upload-download.md)
- [Export & reporting: CSV, Excel, PDF](../02-backend-api/00-http-api/10-export-and-reporting.md)
- [HTTP & API Design](../02-backend-api/00-http-api/README.md)

### `02-backend-api/01-nodejs`

- [Node.js](../02-backend-api/01-nodejs/README.md)

### `02-backend-api/01-nodejs/fundamentals`

- [Node runtime & concurrency](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md)
- [Module system trong Node](../02-backend-api/01-nodejs/fundamentals/02-module-system.md)
- [Bản đồ core API và package.json](../02-backend-api/01-nodejs/fundamentals/03-core-apis-map.md)

### `02-backend-api/01-nodejs/production`

- [Process & memory](../02-backend-api/01-nodejs/production/01-process-memory.md)
- [Graceful shutdown](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md)

### `02-backend-api/01-nodejs/runtime-io`

- [Streams & buffers](../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md)
- [Worker threads & CPU-bound work](../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md)

### `02-backend-api/02-nestjs`

- [NestJS](../02-backend-api/02-nestjs/README.md)

### `02-backend-api/02-nestjs/behavior`

- [NestJS request lifecycle](../02-backend-api/02-nestjs/behavior/01-request-lifecycle.md)
- [Modules & Dependency Injection](../02-backend-api/02-nestjs/behavior/02-modules-di.md)
- [Validation & errors](../02-backend-api/02-nestjs/behavior/03-validation-errors.md)
- [Guards & interceptors](../02-backend-api/02-nestjs/behavior/04-guards-interceptors.md)
- [Config & lifecycle](../02-backend-api/02-nestjs/behavior/05-config-lifecycle.md)
- [Database integration & transactions](../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md)
- [Caching, queues & jobs](../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md)
- [WebSocket gateway](../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md)
- [Testing NestJS](../02-backend-api/02-nestjs/behavior/09-testing-nestjs.md)

### `02-backend-api/02-nestjs/fundamentals`

- [NestJS building blocks: từ `main.ts` tới database](../02-backend-api/02-nestjs/fundamentals/01-building-blocks.md)
- [Dependency Injection & provider](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md)

### `02-backend-api/03-auth`

- [Authentication vs Authorization](../02-backend-api/03-auth/01-authentication-authorization.md)
- [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md)
- [JWT & refresh token](../02-backend-api/03-auth/03-jwt-refresh-token.md)
- [OAuth 2 & OIDC](../02-backend-api/03-auth/04-oauth-oidc.md)
- [Password & MFA](../02-backend-api/03-auth/05-password-mfa.md)
- [Authorization models](../02-backend-api/03-auth/06-authorization-models.md)
- [Auth](../02-backend-api/03-auth/README.md)

### `02-backend-api/04-architecture`

- [Controller → Service → Repository](../02-backend-api/04-architecture/01-controller-service-repository.md)
- [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md)
- [Domain logic boundaries](../02-backend-api/04-architecture/03-domain-logic-boundaries.md)
- [Error handling strategy](../02-backend-api/04-architecture/04-error-handling-strategy.md)
- [Configuration](../02-backend-api/04-architecture/05-configuration.md)
- [SOLID trong thực tế](../02-backend-api/04-architecture/06-solid-in-practice.md)
- [Clean Architecture — góc nhìn thực dụng](../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md)
- [Service decomposition](../02-backend-api/04-architecture/08-service-decomposition.md)
- [BFF & aggregation](../02-backend-api/04-architecture/09-bff-and-aggregation.md)
- [Backend architecture](../02-backend-api/04-architecture/README.md)

### `02-backend-api/05-integrations`

- [Gửi email](../02-backend-api/05-integrations/01-sending-email.md)
- [Webhook gửi ra](../02-backend-api/05-integrations/02-outgoing-webhooks.md)
- [File storage: S3, CDN, lifecycle](../02-backend-api/05-integrations/03-file-storage.md)
- [Integrations](../02-backend-api/05-integrations/README.md)

### `03-database`

- [Database](../03-database/README.md)

### `03-database/00-sql`

- [SQL basics: từ vựng và bốn câu lệnh](../03-database/00-sql/00-sql-basics.md)
- [Relational thinking](../03-database/00-sql/01-relational-thinking.md)
- [Joins & aggregation](../03-database/00-sql/02-joins-aggregation.md)
- [Subqueries & CTE](../03-database/00-sql/03-subqueries-cte.md)
- [Window functions](../03-database/00-sql/04-window-functions.md)
- [SQL](../03-database/00-sql/README.md)

### `03-database/01-postgresql`

- [PostgreSQL](../03-database/01-postgresql/README.md)

### `03-database/01-postgresql/fundamentals`

- [Kiến trúc PostgreSQL và ACID](../03-database/01-postgresql/fundamentals/01-architecture-and-acid.md)
- [Connection pool](../03-database/01-postgresql/fundamentals/02-connection-pool.md)

### `03-database/01-postgresql/indexes-query-planning`

- [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md)
- [Index types](../03-database/01-postgresql/indexes-query-planning/02-index-types.md)
- [EXPLAIN ANALYZE workflow](../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md)
- [Full-text search trong PostgreSQL](../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md)

### `03-database/01-postgresql/operations`

- [WAL, durability & backup](../03-database/01-postgresql/operations/01-wal-durability-backup.md)
- [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md)

### `03-database/01-postgresql/transactions-concurrency`

- [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md)
- [MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md)
- [Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md)

### `03-database/02-redis`

- [Redis data model: key, value, và các cấu trúc](../03-database/02-redis/00-redis-data-model.md)
- [Cache & invalidation](../03-database/02-redis/01-cache-invalidation.md)
- [Rate limit & locking](../03-database/02-redis/02-rate-limit-locking.md)
- [Cache patterns](../03-database/02-redis/03-cache-patterns.md)
- [Eviction & memory](../03-database/02-redis/04-eviction-memory.md)
- [Persistence & failure](../03-database/02-redis/05-persistence-failure.md)
- [Pub/Sub & Streams](../03-database/02-redis/06-pubsub-streams.md)
- [Redis & caching](../03-database/02-redis/README.md)

### `03-database/03-data-modeling`

- [Constraints & invariants](../03-database/03-data-modeling/01-constraints-invariants.md)
- [Normalization & denormalization](../03-database/03-data-modeling/02-normalization.md)
- [Relationships & cardinality](../03-database/03-data-modeling/03-relationships-cardinality.md)
- [Migrations](../03-database/03-data-modeling/04-migrations.md)
- [Soft delete & audit patterns](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md)
- [ID strategy: serial vs UUIDv4 vs UUIDv7](../03-database/03-data-modeling/06-id-strategy.md)
- [Date, time & timezone](../03-database/03-data-modeling/07-datetime-timezone.md)
- [Tiền & Decimal](../03-database/03-data-modeling/08-money-decimal.md)
- [Data modeling](../03-database/03-data-modeling/README.md)

### `03-database/04-message-queues`

- [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md)
- [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md)
- [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md)
- [Ordering & partitioning](../03-database/04-message-queues/04-ordering-partitioning.md)
- [Chọn broker](../03-database/04-message-queues/05-broker-comparison.md)
- [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md)
- [Message queues](../03-database/04-message-queues/README.md)

### `03-database/05-data-access`

- [ORM vs Query Builder vs Raw SQL](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md)
- [Prisma: schema và client](../03-database/05-data-access/02-prisma-model-and-client.md)
- [Prisma relations & N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md)
- [Prisma transactions](../03-database/05-data-access/04-prisma-transactions.md)
- [Prisma migrations trong production](../03-database/05-data-access/05-prisma-migrations-production.md)
- [Raw SQL escape hatches](../03-database/05-data-access/06-raw-sql-escape-hatches.md)
- [Repository pattern trên Prisma: có cần không?](../03-database/05-data-access/07-repository-pattern-testing.md)
- [Data Access](../03-database/05-data-access/README.md)

### `03-database/06-mongodb`

- [Document model](../03-database/06-mongodb/01-document-model.md)
- [Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md)
- [Schema design & validation](../03-database/06-mongodb/03-schema-design-validation.md)
- [Indexes & query planning](../03-database/06-mongodb/04-indexes-query-planning.md)
- [Aggregation pipeline](../03-database/06-mongodb/05-aggregation-pipeline.md)
- [Transactions & consistency](../03-database/06-mongodb/06-transactions-consistency.md)
- [Operations & production](../03-database/06-mongodb/07-operations-production.md)
- [PostgreSQL vs MongoDB](../03-database/06-mongodb/08-postgresql-vs-mongodb.md)
- [MongoDB](../03-database/06-mongodb/README.md)

### `04-infrastructure`

- [Infrastructure](../04-infrastructure/README.md)

### `04-infrastructure/00-linux`

- [Process, file descriptor & environment](../04-infrastructure/00-linux/01-process-files-env.md)
- [Memory, CPU & limits](../04-infrastructure/00-linux/02-memory-cpu-limits.md)
- [Filesystem & permissions](../04-infrastructure/00-linux/03-filesystem-permissions.md)
- [Signals & lifecycle](../04-infrastructure/00-linux/04-signals-lifecycle.md)
- [Ports & sockets](../04-infrastructure/00-linux/05-ports-sockets.md)
- [Logs & services](../04-infrastructure/00-linux/06-logs-and-services.md)
- [Linux debugging toolbox](../04-infrastructure/00-linux/07-debugging-toolbox.md)
- [Linux](../04-infrastructure/00-linux/README.md)

### `04-infrastructure/01-networking`

- [Từ vựng Network: IP, port, socket, TCP, DNS, TLS](../04-infrastructure/01-networking/00-network-vocabulary.md)
- [IP, port & DNS](../04-infrastructure/01-networking/01-ip-port-dns.md)
- [TCP & UDP](../04-infrastructure/01-networking/02-tcp-udp.md)
- [TLS](../04-infrastructure/01-networking/03-tls.md)
- [NAT, firewall & routing](../04-infrastructure/01-networking/04-nat-firewall-routing.md)
- [Reverse proxy & load balancer](../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md)
- [Network debugging](../04-infrastructure/01-networking/06-network-debugging.md)
- [Networking](../04-infrastructure/01-networking/README.md)

### `04-infrastructure/02-docker`

- [Image & container](../04-infrastructure/02-docker/01-image-container.md)
- [Container networking](../04-infrastructure/02-docker/02-container-networking.md)
- [Volumes & state](../04-infrastructure/02-docker/03-volumes-state.md)
- [Namespaces & cgroups](../04-infrastructure/02-docker/04-namespaces-cgroups.md)
- [Dockerfile & build cache](../04-infrastructure/02-docker/05-dockerfile-build-cache.md)
- [Docker Compose](../04-infrastructure/02-docker/06-compose.md)
- [Production image](../04-infrastructure/02-docker/07-production-image.md)
- [Những lỗi Docker kinh điển](../04-infrastructure/02-docker/08-common-failures.md)
- [Docker](../04-infrastructure/02-docker/README.md)

### `04-infrastructure/03-cicd`

- [CI/CD pipeline](../04-infrastructure/03-cicd/01-pipeline.md)
- [Build & artifact promotion](../04-infrastructure/03-cicd/02-build-artifact-promotion.md)
- [Deployment strategies](../04-infrastructure/03-cicd/03-deployment-strategies.md)
- [CI/CD](../04-infrastructure/03-cicd/README.md)

### `04-infrastructure/04-kubernetes`

- [Kubernetes](../04-infrastructure/04-kubernetes/README.md)

### `04-infrastructure/04-kubernetes/fundamentals`

- [Vì sao cần Kubernetes](../04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md)
- [Bản đồ đối tượng Kubernetes](../04-infrastructure/04-kubernetes/fundamentals/02-object-map.md)

### `04-infrastructure/04-kubernetes/operations`

- [Config, Secret & resources](../04-infrastructure/04-kubernetes/operations/01-config-secrets-resources.md)
- [Debugging Kubernetes](../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md)

### `04-infrastructure/04-kubernetes/scheduling-reliability`

- [Readiness, liveness & startup probe](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md)
- [Scheduling & resources](../04-infrastructure/04-kubernetes/scheduling-reliability/02-scheduling-resources.md)
- [Autoscaling](../04-infrastructure/04-kubernetes/scheduling-reliability/03-autoscaling.md)

### `04-infrastructure/04-kubernetes/workloads-networking`

- [Pod, Deployment, Service](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md)
- [Ingress & service discovery](../04-infrastructure/04-kubernetes/workloads-networking/02-ingress-service-discovery.md)
- [Rollout & rollback](../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md)
- [Storage & StatefulSet](../04-infrastructure/04-kubernetes/workloads-networking/04-storage-statefulset.md)

### `04-infrastructure/05-platforms`

- [Chạy ở đâu: VPS, PaaS, container, serverless, edge](../04-infrastructure/05-platforms/01-where-to-run.md)
- [Cloudflare & edge runtime](../04-infrastructure/05-platforms/02-cloudflare-and-edge.md)
- [Platforms: chạy app ở đâu](../04-infrastructure/05-platforms/README.md)

### `05-cross-cutting`

- [Cross-Cutting Concerns](../05-cross-cutting/README.md)

### `05-cross-cutting/concurrency`

- [Concurrency models](../05-cross-cutting/concurrency/01-concurrency-models.md)
- [Shared state & race conditions](../05-cross-cutting/concurrency/02-shared-state-races.md)
- [Distributed locks](../05-cross-cutting/concurrency/03-distributed-locks.md)
- [Concurrency](../05-cross-cutting/concurrency/README.md)

### `05-cross-cutting/observability`

- [Logs, metrics, traces: ba tín hiệu](../05-cross-cutting/observability/01-logs-metrics-traces.md)
- [Structured logging](../05-cross-cutting/observability/02-structured-logging.md)
- [Correlation & distributed tracing](../05-cross-cutting/observability/03-correlation-tracing.md)
- [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md)
- [Alerting & dashboards](../05-cross-cutting/observability/05-alerting-dashboards.md)
- [Observability](../05-cross-cutting/observability/README.md)

### `05-cross-cutting/performance`

- [Latency, throughput & bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md)
- [Frontend performance](../05-cross-cutting/performance/02-frontend-performance.md)
- [Backend performance](../05-cross-cutting/performance/03-backend-performance.md)
- [Database performance](../05-cross-cutting/performance/04-database-performance.md)
- [Profiling & load testing](../05-cross-cutting/performance/05-profiling-load-testing.md)
- [Backpressure](../05-cross-cutting/performance/06-backpressure.md)
- [Full-stack triage](../05-cross-cutting/performance/07-full-stack-triage.md)
- [Performance](../05-cross-cutting/performance/README.md)

### `05-cross-cutting/reliability`

- [Failure modes: hệ thống hỏng như thế nào](../05-cross-cutting/reliability/01-failure-modes.md)
- [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Graceful degradation](../05-cross-cutting/reliability/03-graceful-degradation.md)
- [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md)
- [Reliability](../05-cross-cutting/reliability/README.md)

### `05-cross-cutting/scenarios`

- [Scenario walkthroughs](../05-cross-cutting/scenarios/01-scenario-walkthroughs.md)
- [Scenarios](../05-cross-cutting/scenarios/README.md)

### `05-cross-cutting/security`

- [Security basics: mô hình đe doạ](../05-cross-cutting/security/01-security-basics.md)
- [Injection](../05-cross-cutting/security/02-injection.md)
- [XSS & CSRF](../05-cross-cutting/security/03-xss-csrf.md)
- [Access control: lớp lỗi số 1](../05-cross-cutting/security/04-access-control.md)
- [SSRF & supply chain](../05-cross-cutting/security/05-ssrf-supply-chain.md)
- [Secrets management](../05-cross-cutting/security/06-secrets-management.md)
- [Secure headers & TLS](../05-cross-cutting/security/07-secure-headers-tls.md)
- [Security](../05-cross-cutting/security/README.md)

### `05-cross-cutting/testing`

- [Test theo behavior, không theo cấu trúc](../05-cross-cutting/testing/01-testing-pyramid-behavior.md)
- [Unit vs integration: chọn tầng](../05-cross-cutting/testing/02-unit-vs-integration.md)
- [API & E2E tests](../05-cross-cutting/testing/03-api-e2e-tests.md)
- [Mocking & test doubles](../05-cross-cutting/testing/04-mocking-test-doubles.md)
- [Testcontainers: hạ tầng thật trong test](../05-cross-cutting/testing/05-testcontainers.md)
- [Deterministic tests: chống flaky](../05-cross-cutting/testing/06-deterministic-tests.md)
- [Contract testing](../05-cross-cutting/testing/07-contract-testing.md)
- [Testing](../05-cross-cutting/testing/README.md)

### `06-system-design`

- [Requirements trước kiến trúc](../06-system-design/01-requirements-tradeoffs.md)
- [Scaling: cache, queue, replica](../06-system-design/02-scaling-cache-queue.md)
- [Idempotency & retry](../06-system-design/03-idempotency-retry.md)
- [Consistency & availability](../06-system-design/04-consistency-availability.md)
- [Data partitioning & sharding](../06-system-design/05-data-partitioning-sharding.md)
- [Chọn kho dữ liệu](../06-system-design/06-storage-selection.md)
- [Event-driven architecture](../06-system-design/07-event-driven.md)
- [Monolith → microservices](../06-system-design/08-monolith-to-microservices.md)
- [Tám ngộ nhận về hệ thống phân tán](../06-system-design/09-distributed-systems-fallacies.md)
- [Template làm bài system design](../06-system-design/10-design-exercise-template.md)
- [System Design](../06-system-design/README.md)

### `07-projects/fullstack-lab`

- [Fullstack Lab](../07-projects/fullstack-lab/README.md)

### `08-learning-log`

- [Learning Logs](../08-learning-log/README.md)

### `09-ai-assisted-development`

- [AI thay đổi cái gì, và không thay đổi cái gì](../09-ai-assisted-development/01-what-ai-changes.md)
- [Context engineering](../09-ai-assisted-development/02-context-engineering.md)
- [Review code do AI sinh](../09-ai-assisted-development/03-reviewing-ai-code.md)
- [Hallucination & verification](../09-ai-assisted-development/04-hallucination-verification.md)
- [Rủi ro bảo mật và giới hạn](../09-ai-assisted-development/05-ai-security-limits.md)
- [AI-Assisted Development](../09-ai-assisted-development/README.md)

