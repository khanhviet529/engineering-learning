---
level: foundation
area: cross-cutting
---

# Knowledge Audit

Ảnh chụp trạng thái repository **trước** khi mở rộng, và kế hoạch xử lý. Đây là tài liệu chẩn đoán, không phải tài liệu học.

Thời điểm audit: 2026-08-27.
Trạng thái ban đầu: **83 file Markdown**, tổng nội dung ~40 KB.

## Phát hiện tổng quát

Repository ban đầu là một **skeleton tốt nhưng rỗng**:

- Cây thư mục đã phản ánh đúng runtime path (browser → frontend → API → backend → DB → infra). Đây là điểm mạnh, giữ nguyên.
- Nhưng **không có note nào thực sự dạy được gì**. Note lớn nhất là 526 byte (`01-event-loop-async.md`). Trung bình mỗi topic note khoảng 320 byte, tức 3–6 dòng.
- Phần lớn note chỉ có `Position` + một dòng mental model + một dòng "experiment". Đó là *ghi chú ý định học*, chưa phải kiến thức.
- Không có note nào có: failure mode, thứ tự debug, misconception, trade-off, production consideration.
- 30/83 file là `README.md` chỉ liệt kê link — khoảng 36% repository là index chứ không phải nội dung.

Kết luận: vấn đề không phải "thiếu vài topic". Vấn đề là **toàn bộ nội dung mới ở mức tiêu đề**.

## Existing topics

| Vùng | File ban đầu | Đánh giá |
|---|---|---|
| Roadmap / Learning system | 6 | Phương pháp học (MODEL → PREDICT → BREAK → EXPLAIN) đã rõ và đáng giữ. Roadmap còn đặt tên theo phase công nghệ. |
| Web foundations | 3 | Chỉ browser render + HTTP cache. Thiếu gần hết tầng network và browser security. |
| JavaScript / TypeScript | 3 | Chỉ event loop + type boundary. Thiếu closure, prototype, memory, type system. |
| React | 5 | 4 note đúng hướng behavior (state/effect/race/server-state). Thiếu reconciliation, context, refs, forms, Suspense, performance, testing. |
| Next.js | 4 | Có boundary + routing + data cache ở mức một đoạn. Thiếu rendering strategies, Server Actions, middleware, deployment. |
| HTTP / API | 3 | Rất mỏng. Thiếu idempotency, pagination, error model, versioning, rate limit. |
| Node.js | 2 | Chỉ 1 note runtime. Thiếu streams, memory, worker threads, graceful shutdown. |
| NestJS | 4 | Có lifecycle/DI/validation. Thiếu guards/interceptors chi tiết, transaction, queue, testing. |
| Auth | 2 | 1 note gộp authentication + authorization. Cần tách. |
| Backend architecture | 2 | Chỉ controller-service-repository. |
| SQL | 3 | Thiếu subquery, CTE, window function, transaction SQL. |
| PostgreSQL | 4 | Có isolation/index/pool ở mức 2–3 dòng. Thiếu MVCC, vacuum, lock, WAL, replication, storage. |
| Redis | 3 | Thiếu cache patterns, eviction, persistence, pub/sub. |
| Data modeling | 2 | Chỉ constraints. Thiếu normalization, cardinality, migration. |
| Linux | 2 | Chỉ process/file/env. |
| Networking | 2 | Chỉ IP/port/DNS. Thiếu TCP, TLS, proxy, LB. |
| Docker | 4 | 3 note behavior đúng hướng. Thiếu namespace/cgroup, build cache, compose, production image. |
| CI/CD | 2 | Chỉ 1 note pipeline. |
| Kubernetes | 4 | Có pod/health/config. Thiếu "vì sao cần K8s", scheduling, ingress, rollout, storage, autoscaling, debug. |
| Security | 2 | 1 note gộp toàn bộ security — không đủ cho bất kỳ mục đích nào. |
| Testing | 2 | 1 note pyramid. |
| Observability | 2 | 1 note logs/metrics/traces. |
| Performance | 2 | 1 note latency/throughput. |
| System design | 5 | 4 note, mỗi note một đoạn. |
| Projects | 1 | `fullstack-lab/README.md` có milestone list nhưng chưa có phase chi tiết. |
| Learning log | 1 | Chỉ hướng dẫn đặt tên file. |
| Templates | 3 | `topic-pass2.md` là template tốt nhưng thiếu Prediction / Break It / Debugging / Misconceptions. |

## Missing topics

**Không có folder nào chứa:**

- `message-queues` — producer/consumer, delivery semantics, retry, DLQ, ordering, outbox. Roadmap nhắc "Queue" nhưng không có nơi chứa kiến thức đó.
- `reliability` — timeout, retry budget, circuit breaker, graceful degradation, capacity.
- `concurrency` — mô hình concurrency, shared state, distributed lock. Đang rải rác giữa Node.js và PostgreSQL, không có nơi tổng hợp.
- `ai-assisted-development` — chỉ có 1 note ngắn về *học* với AI, không có gì về *làm việc* với AI (review code AI sinh, hallucination, context engineering, security review).

**Thiếu trong folder đã có:**

- Web: URL → DNS → TCP → TLS chain, rendering pipeline chi tiết, cookies vs storage, CORS (chỉ được nhắc trong bảng behavior map), CSP, WebSocket/SSE.
- JavaScript: execution context, scope, closure, `this`, prototype, memory/GC, module system, error handling, immutability.
- TypeScript: structural typing, generics, narrowing, discriminated union, mapped/conditional types, utility types, `type` vs `interface`.
- React: reconciliation & key, controlled/uncontrolled, refs, context, memoization, derived state, state colocation, custom hooks, error boundary, Suspense, forms, performance, testing.
- Next.js: SSR/SSG/ISR/streaming/hydration phân biệt rõ, Route Handlers, Server Actions, middleware, metadata, images, deployment.
- API: HTTP semantics, idempotency, pagination, filtering, sorting, error model, versioning, rate limiting, REST vs RPC vs GraphQL.
- Node.js: streams, buffers, process, memory, worker threads, graceful shutdown.
- NestJS: guards/interceptors sâu, exception filter, config, lifecycle hooks, transaction, cache, queue, scheduled job, WebSocket, testing, modular monolith.
- Database design: normalization, denormalization, cardinality, soft delete, audit field, migration.
- PostgreSQL: page/tuple storage, MVCC, vacuum/autovacuum, lock, deadlock, WAL, checkpoint, index types (B-tree/partial/composite/covering), query planner, EXPLAIN ANALYZE workflow, replication, backup/restore.
- Redis: cache-aside, write-through, stampede, eviction policy, persistence (RDB/AOF), pub/sub, streams, session store.
- Linux: thread, memory, filesystem, permission, signal, port/socket, systemd, log, resource limit, debug toolbox.
- Networking: subnet, routing, TCP vs UDP, TLS handshake, NAT, firewall, reverse proxy, load balancer, debug toolbox.
- Docker: namespace, cgroup, layer/build cache, multi-stage, secrets, healthcheck, resource limit, security, các failure kinh điển.
- CI/CD: artifact promotion, deployment strategies, secrets.
- Kubernetes: cluster/control plane, replica set, ingress, namespace, scheduling, requests/limits, rolling update, rollback, PV, service discovery, autoscaling, failure recovery, debug.
- Security: XSS, CSRF, SQL injection, SSRF, command injection, path traversal, broken access control, secrets, TLS, dependency security, secure headers, input validation, output encoding, least privilege, threat modeling.
- Auth: session, cookie, JWT, refresh token, OAuth 2, OIDC, password hashing, MFA, session fixation; RBAC, ABAC, ownership, tenant isolation.
- Testing: unit, integration, component, API, E2E, contract, mocking, testcontainers, determinism.
- Observability: structured logging, correlation ID, distributed tracing, OpenTelemetry, 4 golden signals, dashboard, alert.
- Performance: frontend rendering, profiling, benchmarking, load testing, backpressure.
- System design: CAP, replication, partitioning, sharding, load balancing, event-driven, circuit breaker, service discovery, monolith → modular monolith → microservices.

## Duplicate topics

Không có duplicate nghiêm trọng (repo quá nhỏ để trùng). Nhưng có **chồng lấn cần phân vai rõ**:

| Chồng lấn | Xử lý |
|---|---|
| Browser HTTP cache vs Next.js data cache vs Redis cache | Tách theo tầng: browser cache = HTTP semantics; Next.js cache = framework-level; Redis = application-level. Link chéo, không lặp nội dung. |
| Race condition trong React vs concurrency trong PostgreSQL vs distributed lock | Giữ 3 note riêng (khác tầng, khác cơ chế) và thêm note tổng hợp trong `05-cross-cutting/concurrency/` giải thích chúng cùng một họ vấn đề. |
| Idempotency ở system design vs HTTP semantics vs message queue | System design = nguyên lý; HTTP = ngữ nghĩa method; queue = hệ quả của at-least-once. |
| Rate limiting ở Redis vs API design | Redis = cơ chế (counter, sliding window); API = contract (429, `Retry-After`). |
| Auth ở backend vs security cross-cutting | Auth = cơ chế nhận diện và cấp quyền, đặt ở backend vì đó là nơi implement. Security = tập tấn công và phòng thủ, xuyên tầng. |
| Connection pool ở PostgreSQL vs Node.js concurrency | Pool là nơi hai tầng gặp nhau — giữ ở PostgreSQL, link từ Node.js. |
| `03-ai-assisted-learning.md` vs folder `09-ai-assisted-development/` | Roadmap note = dùng AI để **học**. Folder mới = dùng AI để **làm việc**. Giữ cả hai, link chéo. |

## Misplaced topics

| Nội dung | Đang ở | Xử lý |
|---|---|---|
| Authentication + Authorization gộp 1 file | `02-backend-api/03-auth/01-...` | Tách thành 6 note trong cùng folder. Hai vấn đề khác nhau: "anh là ai" vs "anh được làm gì"; gộp làm mờ cả hai. |
| Security chỉ 1 file | `05-cross-cutting/security/` | Tách theo lớp tấn công + 1 note mindset. Một file không thể phủ OWASP mindset và 10 loại lỗ hổng. |
| Cache invalidation nằm trong folder Redis | `03-database/02-redis/` | Giữ chỗ, nhưng viết lại đi từ "vì sao cần cache" chứ không từ "Redis có command gì". Cache là concept, Redis là công cụ. |
| Queue chỉ được nhắc trong roadmap | — | Tạo `03-database/04-message-queues/`. Queue là stateful infrastructure, đặt cạnh DB/Redis hợp lý hơn là nhét vào backend. |
| HTTP browser cache | `01-web-frontend/00-web-foundations/` | Đúng chỗ. Nhưng phải link tới HTTP semantics ở backend. |

## Topics requiring expansion

Tất cả 47 topic note ban đầu đều cần mở rộng. Ưu tiên theo mức độ nền tảng:

**Ưu tiên 1 — nền của mọi thứ khác:** `01-event-loop-async`, `01-browser-request-render`, `01-state-render`, `01-http-request-response`, `01-node-runtime-concurrency`, `01-relational-thinking`, `01-transaction-isolation`, `02-index-query-plan`, `01-image-container`.

**Ưu tiên 2 — behavior hay gây bug thật:** `02-effects-lifecycle`, `03-async-race-condition`, `01-server-client-boundary`, `03-data-fetching-cache`, `01-request-lifecycle`, `03-connection-pool`, `01-cache-invalidation`, `02-container-networking`, `03-volumes-state`.

**Ưu tiên 3 — production:** `01-logs-metrics-traces`, `01-latency-throughput-bottleneck`, `02-health-readiness-liveness`, `01-pipeline`, toàn bộ `06-system-design/`.

## Topics requiring restructure

1. **Roadmap đặt tên theo công nghệ** (`Phase 1 — Web runtime và React`). Đổi sang 12 behavior đánh số, mỗi behavior có prerequisite. Công nghệ trở thành *dụng cụ* của behavior.
2. **Không có `05-cross-cutting/README.md`** — folder xuyên tầng mà không có trang giải thích nó xuyên cái gì.
3. **`templates/topic-pass2.md` thiếu section quan trọng**: Prediction, Break It, Common Misconceptions, Debugging. Bổ sung `templates/topic-note.md` đầy đủ.
4. **`04-topic-index.md` ghi "Tổng số note/topic khởi tạo: 50"** trong khi có 83 file — index đã lệch thực tế. Regenerate.
5. **Navigation chỉ có một chiều** (README liệt kê file trong folder). Cần 3 trục tra cứu: theo behavior, theo topic, theo tầng hệ thống.
6. **`fullstack-lab` chỉ có milestone list.** Mỗi milestone phải thành một phase file có: behavior cần hiểu, feature cần build, lỗi cần cố tình tạo, prediction, tiêu chí hoàn thành.
7. **Không có metadata.** Thêm frontmatter nhẹ (`level`, `area`, `prerequisites`, `related`) cho note quan trọng.

## Outdated content

Repo quá mới để lỗi thời, nhưng vài chỗ cần ghim version vì behavior phụ thuộc phiên bản:

- **Next.js**: note không ghi App Router hay Pages Router. Behavior caching/rendering khác nhau đáng kể giữa hai router và giữa Next 14 ↔ 15. *Quyết định: toàn bộ note Next.js viết cho App Router trên Next.js 15, ghi rõ trong note.*
- **React**: `02-effects-lifecycle.md` không phân biệt StrictMode double-invoke — một nguồn nhầm lẫn lớn. Ghi baseline React 19.
- **NestJS**: không ghi version; DI và lifecycle ổn định nên ghi baseline NestJS 10/11.
- **PostgreSQL**: behavior vacuum/planner thay đổi giữa các major. Ghi baseline PostgreSQL 16.
- **Kubernetes**: API version của Ingress/HPA đã đổi nhiều lần. Ghi baseline v1.29+.

## Isolated notes

Ban đầu **mọi note đều isolated**: chỉ có dòng `Position` dạng text, không có Markdown link nào giữa các note nội dung. Duy nhất README chứa link, và chỉ link tới file trong cùng folder.

Hệ quả: không thể đi từ "React race condition" → "AbortController" → "HTTP timeout" → "retry" — dù đó chính là đường mà một người debug thật sẽ đi.

Xử lý: mỗi note có section `Related` với link thật, và `Position` là đường runtime cụ thể chứ không phải nhãn.

## Suggested new topics

Ngoài các topic thiếu đã liệt kê, những topic **không nằm trong kế hoạch ban đầu nhưng nên có**:

1. **`05-cross-cutting/concurrency/01-concurrency-models.md`** — note tổng hợp: event loop (1 thread, async) vs thread pool vs process vs distributed. Giải thích vì sao race condition trong React, trong PostgreSQL và trong Kubernetes là *cùng một họ vấn đề* với cơ chế khác nhau. Đây là mảnh ghép làm toàn bộ repo dính vào nhau.
2. **`05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md`** — ba cơ chế luôn bị dạy rời rạc nhưng phải thiết kế cùng nhau: retry không có timeout = tăng tải; timeout không có circuit breaker = cascading failure.
3. **`04-infrastructure/01-networking/06-network-debugging.md`** và **`00-linux/07-debugging-toolbox.md`** — repo dạy nhiều behavior nhưng không dạy *công cụ để quan sát* behavior. Không có `ss`, `dig`, `curl -v`, `strace` thì mọi experiment chỉ là suy đoán.
4. **`03-database/01-postgresql/08-explain-analyze-workflow.md`** — không phải "EXPLAIN là gì" mà là quy trình: baseline → đo → đọc plan → sửa → đo lại → tăng dữ liệu → đo lại.
5. **`06-system-design/09-distributed-systems-fallacies.md`** — 8 fallacies of distributed computing làm khung phát hiện giả định sai.
6. **`06-system-design/10-design-exercise-template.md`** — template làm bài system design theo requirement → constraint → trade-off, tránh vẽ box-arrow.
7. **`02-backend-api/04-architecture/02-modular-monolith.md`** — đích thực tế của hầu hết dự án, thường bị bỏ qua giữa "monolith" và "microservices".
8. **`03-database/04-message-queues/06-outbox-pattern.md`** — dual-write (ghi DB + publish event) là bug phổ biến và hầu như không bao giờ được dạy sớm.
9. **`09-ai-assisted-development/04-hallucination-verification.md`** — kỹ năng bắt buộc hiện nay: xác minh API/flag/config mà AI sinh ra có thật tồn tại.
10. **`01-web-frontend/01-javascript-typescript/09-error-handling-immutability.md`** — error handling trong async JS (unhandled rejection, error trong callback) là nguồn bug production lớn.

## Kế hoạch triển khai

| Phase | Nội dung |
|---|---|
| 1 | Audit (file này) |
| 2 | Information architecture: template, navigation, roadmap behavior-based |
| 3 | Foundation: web, network, JS/TS |
| 4 | Frontend: React, Next.js |
| 5 | Backend: HTTP/API, Node.js, NestJS, architecture |
| 6 | Database: SQL, PostgreSQL, Redis, modeling, queue |
| 7 | Infrastructure: Linux, networking, Docker, CI/CD, Kubernetes |
| 8 | Cross-cutting: auth, security, testing, observability, performance, reliability, concurrency |
| 9 | System design |
| 10 | AI-assisted development |
| 11 | Projects / experiments |
| 12 | Cross-link toàn bộ note |
| 13 | Final knowledge-gap audit |

Kết quả cuối: [final-coverage-report.md](final-coverage-report.md).

## Related

- [Learning System](00-learning-system.md) — cách dùng repo này
- [Knowledge Map](knowledge-map.md) — bản đồ theo tầng hệ thống
- [Behavior Index](behavior-index.md) — bản đồ theo behavior
- [Topic Index](04-topic-index.md) — bản đồ theo công nghệ
