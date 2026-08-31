---
level: foundation
area: cross-cutting
---

# Roadmap

Roadmap này **không** đặt tên theo công nghệ. Đơn vị học là một **behavior của hệ thống**; framework chỉ là dụng cụ để quan sát behavior đó.

Lý do: nếu học theo công nghệ, bạn sẽ biết `useEffect` nhận mấy tham số nhưng không biết vì sao dữ liệu hiển thị sai khi người dùng click nhanh. Nếu học theo behavior, bạn biết đó là race condition, và bạn sẽ nhận ra cùng vấn đề đó khi nó xuất hiện lại ở tầng database hoặc ở message queue.

## 12 behavior

| # | Behavior | Prerequisite | Công nghệ chạm tới |
|---|---|---|---|
| 01 | [Browser biến một URL thành UI như thế nào?](#behavior-01) | — | DNS, TCP, TLS, HTTP, DOM, CSSOM |
| 02 | [State thay đổi khiến UI thay đổi như thế nào?](#behavior-02) | 01 | JavaScript, React |
| 03 | [UI lấy dữ liệu async và xử lý race condition thế nào?](#behavior-03) | 02 | React, fetch, AbortController, TanStack Query |
| 04 | [Server và client chia việc render thế nào?](#behavior-04) | 02, 03 | Next.js App Router |
| 05 | [Một HTTP request đi qua backend như thế nào?](#behavior-05) | 01 | HTTP, Node.js, NestJS |
| 06 | [Backend quản lý dependency và request lifecycle thế nào?](#behavior-06) | 05 | NestJS DI, guards, interceptors, pipes |
| 07 | [Dữ liệu được lưu bền vững như thế nào?](#behavior-07) | 05 | SQL, PostgreSQL, WAL |
| 08 | [Concurrent transactions gây lỗi dữ liệu như thế nào?](#behavior-08) | 07 | MVCC, isolation, lock |
| 09 | [Vì sao query trở nên chậm?](#behavior-09) | 07 | index, query planner, EXPLAIN |
| 10 | [Cache tăng tốc và gây stale data như thế nào?](#behavior-10) | 07, 09 | Redis, TTL, invalidation |
| 11 | [Process và container giao tiếp qua network thế nào?](#behavior-11) | 05 | Linux, networking, Docker |
| 12 | [Hệ thống production xử lý failure như thế nào?](#behavior-12) | 10, 11 | Kubernetes, observability, reliability |

Behavior 13 không phải một bước mới mà là năng lực tổng hợp: xem [System Design](../06-system-design/README.md).

## Dependency graph

```text
01 Browser → UI
 │
 ├─→ 02 State → UI ──→ 03 Async UI ──→ 04 Server/Client boundary
 │                                            │
 └─→ 05 HTTP → Backend ──→ 06 Request lifecycle
                │
                ├─→ 07 Persistence ──┬─→ 08 Concurrency
                │                    ├─→ 09 Query performance
                │                    └─→ 10 Cache ──┐
                │                                   │
                └─→ 11 Network / Container ─────────┴─→ 12 Production failure
                                                          │
                                                          ↓
                                                    System Design
```

Đọc graph này theo nghĩa: **không nên học Kubernetes trước khi hiểu container, và không nên học container trước khi hiểu process và port**. Nhảy bậc thì bạn sẽ học được cú pháp mà không có mô hình để debug.

---

## Behavior 01

### Browser biến một URL thành UI như thế nào?

**Câu hỏi trung tâm:** giữa lúc bạn gõ Enter và lúc thấy chữ trên màn hình, có bao nhiêu bước, và bước nào có thể chậm hoặc hỏng?

**Cần hiểu được:**

- URL được phân giải thành IP (DNS), kết nối được thiết lập (TCP), được mã hoá (TLS), rồi mới có HTTP.
- HTML → DOM, CSS → CSSOM, rồi layout → paint → composite.
- Vì sao script chặn parsing, và `defer`/`async` đổi điều gì.
- Cache của browser quyết định request nào thực sự đi ra mạng.

**Note:**
[URL → DNS → TCP → TLS](../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) ·
[Browser request → render](../01-web-frontend/00-web-foundations/01-browser-request-render.md) ·
[Rendering pipeline](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md) ·
[HTTP & browser cache](../01-web-frontend/00-web-foundations/02-http-browser-cache.md)

**Xong khi:** bạn mở DevTools Network của một trang thật và giải thích được từng waterfall bar là gì, cái nào chặn cái nào.

---

## Behavior 02

### State thay đổi khiến UI thay đổi như thế nào?

**Câu hỏi trung tâm:** khi bạn gọi `setState`, chính xác điều gì chạy lại, và DOM nào thực sự thay đổi?

**Cần hiểu được:**

- Event loop, microtask/macrotask — vì sao thứ tự log không như bạn nghĩ.
- Closure và stale closure — vì sao hàm của bạn đọc giá trị cũ.
- Render ≠ commit. Component function chạy lại không có nghĩa DOM đổi.
- Reconciliation và `key` — vì sao list mất state khi sắp xếp lại.

**Note:**
[Event loop & async](../01-web-frontend/01-javascript-typescript/async-concurrency/01-event-loop-async.md) ·
[Execution context & closure](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) ·
[State → render](../01-web-frontend/02-react/behavior/01-state-render.md) ·
[Reconciliation & keys](../01-web-frontend/02-react/behavior/05-reconciliation-keys.md) ·
[Effects & lifecycle](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md)

**Xong khi:** bạn dự đoán đúng số lần render của một component trước khi mở React DevTools Profiler.

---

## Behavior 03

### UI lấy dữ liệu async và xử lý race condition thế nào?

**Câu hỏi trung tâm:** hai request gửi theo thứ tự A, B nhưng trả về theo thứ tự B, A — UI hiển thị gì?

**Cần hiểu được:**

- Vì sao response cũ có thể ghi đè state mới.
- Cleanup function tồn tại để làm gì.
- `AbortController` huỷ cái gì và **không** huỷ cái gì.
- Vì sao server state cần cache, và vì sao `useEffect` + `useState` không đủ.

**Note:**
[Async race condition](../01-web-frontend/02-react/behavior/03-async-race-condition.md) ·
[Server state & cache](../01-web-frontend/02-react/behavior/04-server-state-cache.md) ·
[Promise & concurrency](../01-web-frontend/01-javascript-typescript/async-concurrency/02-promise-concurrency.md) ·
[Error boundaries & Suspense](../01-web-frontend/02-react/behavior/09-error-boundaries-suspense.md)

**Xong khi:** bạn tự tạo được race condition có thể tái hiện 100%, rồi sửa nó bằng hai cách khác nhau và nói được trade-off.

---

## Behavior 04

### Server và client chia việc render thế nào?

**Câu hỏi trung tâm:** dòng code này chạy ở đâu — máy chủ hay browser — và làm sao bạn biết?

**Cần hiểu được:**

- Server Component vs Client Component: cái gì qua được boundary, cái gì không.
- Hydration là gì, và hydration mismatch xảy ra vì sao.
- SSR / SSG / ISR / streaming khác nhau ở thời điểm render.
- Cache của Next.js có mấy lớp và lớp nào gây stale data.

**Note:**
[Server/Client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) ·
[Rendering strategies](../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md) ·
[Routing & layout](../01-web-frontend/03-nextjs/behavior/02-routing-layout-rendering.md) ·
[Data fetching & cache](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md)

**Xong khi:** bạn giải thích được vì sao một thay đổi trong database không hiện lên trang, mà không cần đoán.

---

## Behavior 05

### Một HTTP request đi qua backend như thế nào?

**Câu hỏi trung tâm:** từ lúc byte đầu tiên đến socket cho tới lúc response đi ra, request đi qua những trạm nào?

**Cần hiểu được:**

- HTTP/1.1 là text protocol trên TCP (HTTP/2 nhị phân trên TCP, HTTP/3 trên QUIC/UDP); method/status/header có ngữ nghĩa, không phải quy ước tuỳ ý.
- Node.js xử lý nhiều request đồng thời trên một thread JS như thế nào.
- Chỗ nào trong chuỗi có thể block toàn bộ server.

**Note:**
[HTTP request/response](../02-backend-api/00-http-api/01-http-request-response.md) ·
[HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) ·
[Node runtime & concurrency](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) ·
[REST API contract](../02-backend-api/00-http-api/02-rest-api-contract.md)

**Xong khi:** bạn viết được một handler làm treo cả server, giải thích vì sao, rồi sửa.

---

## Behavior 06

### Backend quản lý dependency và request lifecycle thế nào?

**Câu hỏi trung tâm:** validation, auth và error handling nên nằm ở trạm nào, và vì sao?

**Cần hiểu được:**

- Chuỗi middleware → guard → interceptor → pipe → controller → service → repository.
- DI giải quyết vấn đề gì (và tạo ra vấn đề gì).
- Vì sao business logic không nên nằm trong controller.

**Note:**
[Request lifecycle](../02-backend-api/02-nestjs/behavior/01-request-lifecycle.md) ·
[Modules & DI](../02-backend-api/02-nestjs/behavior/02-modules-di.md) ·
[Guards & interceptors](../02-backend-api/02-nestjs/behavior/04-guards-interceptors.md) ·
[Validation & errors](../02-backend-api/02-nestjs/behavior/03-validation-errors.md) ·
[Controller–Service–Repository](../02-backend-api/04-architecture/01-controller-service-repository.md)

**Xong khi:** cho một yêu cầu mới ("chỉ owner được sửa"), bạn biết ngay nó thuộc trạm nào và vì sao không thuộc trạm khác.

---

## Behavior 07

### Dữ liệu được lưu bền vững như thế nào?

**Câu hỏi trung tâm:** khi `COMMIT` trả về thành công, dữ liệu đang ở đâu?

**Cần hiểu được:**

- Quan hệ, key, constraint — database bảo vệ invariant, không chỉ lưu byte.
- Transaction là đơn vị nguyên tử.
- WAL: vì sao commit nhanh mà vẫn bền.

**Note:**
[Relational thinking](../03-database/00-sql/01-relational-thinking.md) ·
[Joins & aggregation](../03-database/00-sql/02-joins-aggregation.md) ·
[Constraints & invariants](../03-database/03-data-modeling/01-constraints-invariants.md) ·
[WAL, durability & backup](../03-database/01-postgresql/operations/01-wal-durability-backup.md)

**Xong khi:** bạn giết process PostgreSQL ngay sau commit, khởi động lại, và dự đoán đúng dữ liệu còn hay mất.

---

## Behavior 08

### Concurrent transactions gây lỗi dữ liệu như thế nào?

**Câu hỏi trung tâm:** hai request cùng trừ tồn kho một lúc — kết quả là gì, và vì sao?

**Cần hiểu được:**

- MVCC: mỗi transaction thấy một snapshot khác nhau.
- Lost update, write skew, phantom read.
- Isolation level đổi anomaly nào, giá phải trả là gì.
- Pessimistic lock vs optimistic version.

**Note:**
[Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) ·
[MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) ·
[Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) ·
[Shared state & races](../05-cross-cutting/concurrency/02-shared-state-races.md)

**Xong khi:** bạn tạo được lost update, deadlock và write skew theo yêu cầu, mỗi cái bằng hai session `psql`.

---

## Behavior 09

### Vì sao query trở nên chậm?

**Câu hỏi trung tâm:** cùng một query, 1.000 dòng thì nhanh, 1.000.000 dòng thì chết — chính xác cái gì đổi?

**Cần hiểu được:**

- Sequential scan vs index scan, và vì sao planner đôi khi chọn seq scan *đúng*.
- Composite index và thứ tự cột.
- Đọc `EXPLAIN ANALYZE`: estimated vs actual rows.
- N+1 query.

**Note:**
[Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) ·
[Index types](../03-database/01-postgresql/indexes-query-planning/02-index-types.md) ·
[EXPLAIN ANALYZE workflow](../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) ·
[Database performance](../05-cross-cutting/performance/04-database-performance.md)

**Xong khi:** bạn tăng dữ liệu lên 10× và dự đoán đúng query nào chậm đi tuyến tính, query nào chậm đi tệ hơn tuyến tính.

---

## Behavior 10

### Cache tăng tốc và gây stale data như thế nào?

**Câu hỏi trung tâm:** dữ liệu đúng trong database nhưng sai trên màn hình — nó sai ở lớp cache nào?

**Cần hiểu được:**

- Cache-aside, TTL, invalidation.
- Cache stampede khi key nóng hết hạn.
- Vì sao "xoá cache khi ghi" khó hơn nó nghe.
- Queue: khi nào nên làm việc sau thay vì làm ngay.

**Note:**
[Cache invalidation](../03-database/02-redis/01-cache-invalidation.md) ·
[Cache patterns](../03-database/02-redis/03-cache-patterns.md) ·
[Eviction & memory](../03-database/02-redis/04-eviction-memory.md) ·
[Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) ·
[Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md)

**Xong khi:** bạn chỉ ra được một dữ liệu sai đang được cache ở mấy lớp (browser, CDN, Next.js, Redis) và lớp nào cần xoá.

---

## Behavior 11

### Process và container giao tiếp qua network thế nào?

**Câu hỏi trung tâm:** app chạy trên máy bạn nhưng chết trong container — biên nào bị vượt?

**Cần hiểu được:**

- Process, port, socket, environment variable, filesystem, permission.
- Container cô lập cái gì (namespace) và giới hạn cái gì (cgroup).
- Vì sao `localhost` trong container không phải máy bạn.
- Vì sao container restart làm mất dữ liệu.

**Note:**
[Process, file, env](../04-infrastructure/00-linux/01-process-files-env.md) ·
[Ports & sockets](../04-infrastructure/00-linux/05-ports-sockets.md) ·
[IP, port, DNS](../04-infrastructure/01-networking/01-ip-port-dns.md) ·
[Image & container](../04-infrastructure/02-docker/01-image-container.md) ·
[Container networking](../04-infrastructure/02-docker/02-container-networking.md) ·
[Volumes & state](../04-infrastructure/02-docker/03-volumes-state.md) ·
[Common Docker failures](../04-infrastructure/02-docker/08-common-failures.md)

**Xong khi:** cho một `connection refused`, bạn xác định được lỗi ở DNS, ở port, ở bind address hay ở firewall — theo thứ tự kiểm tra, không đoán.

---

## Behavior 12

### Hệ thống production xử lý failure như thế nào?

**Câu hỏi trung tâm:** một pod chết lúc 3 giờ sáng — hệ thống tự hồi phục bằng cơ chế nào, và bạn biết chuyện gì đã xảy ra bằng cách nào?

**Cần hiểu được:**

- Desired state reconciliation: vì sao Kubernetes khác `docker run`.
- Readiness vs liveness — nhầm hai cái này gây outage.
- Logs, metrics, traces trả lời ba câu hỏi khác nhau.
- Timeout, retry, circuit breaker phải thiết kế cùng nhau.

**Note:**
[Vì sao cần Kubernetes](../04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md) ·
[Pod, Deployment, Service](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md) ·
[Readiness & liveness](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) ·
[Rollout & rollback](../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) ·
[Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) ·
[Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) ·
[Failure modes](../05-cross-cutting/reliability/01-failure-modes.md)

**Xong khi:** bạn cố tình làm hỏng lab của mình bằng 5 cách khác nhau và mỗi lần đều tìm ra nguyên nhân từ telemetry chứ không từ ký ức.

---

## Cách chạy một behavior

Với mỗi behavior, lặp vòng trong [Learning System](00-learning-system.md):

```text
MODEL     đọc note, vẽ lại mental model bằng tay
   ↓
PREDICT   viết ra dự đoán TRƯỚC khi chạy
   ↓
BUILD     dựng ví dụ nhỏ nhất trong fullstack-lab
   ↓
BREAK     làm nó hỏng theo bảng "Break It" trong note
   ↓
EXPLAIN   giải thích lại không nhìn tài liệu
   ↓
RECALL    buổi sau, 5 phút trả lời lại câu hỏi cũ
```

Ghi lại mỗi buổi vào [08-learning-log/](../08-learning-log/README.md) bằng [template](../templates/learning-log.md). Chỉ ghi cái bạn **dự đoán sai** — đó là chỗ mental model đang lệch.

## Related

- [Learning System](00-learning-system.md) — vòng học chi tiết
- [Behavior Index](behavior-index.md) — tra cứu behavior → note
- [Knowledge Map](knowledge-map.md) — tra cứu theo tầng hệ thống
- [Project Roadmap](project-roadmap.md) — behavior nào build trong phase nào của lab
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi thực hành
