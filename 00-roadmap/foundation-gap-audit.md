---
level: meta
area: roadmap
---

# Foundation Gap Audit

Audit toàn repository để tìm **hidden prerequisite**: khái niệm mà note dùng như thể người đọc đã biết, nhưng repo chưa bao giờ định nghĩa ở đâu.

## Vấn đề được audit

Repo này viết theo behavior-first. Mọi note mở đầu bằng một sự cố production thật:

```text
03-url-dns-tcp-tls.md    mở đầu bằng  ERR_NAME_NOT_RESOLVED / ENOTFOUND
01-ip-port-dns.md        mở đầu bằng  DNS TTL làm traffic đi sai sau khi đổi IP
05-ports-sockets.md      mở đầu bằng  bind 127.0.0.1 trong container
01-process-files-env.md  mở đầu bằng  EMFILE: too many open files
```

Cách mở đầu này rất tốt cho người **đã có từ vựng**: nó gắn kiến thức vào một hậu quả có thật.

Nó **thất bại** với người chưa có từ vựng: đọc hết `03-url-dns-tcp-tls.md` vẫn không trả lời được *"port là gì"*, *"socket là gì"*, *"TCP làm gì"*.

Repo cần phục vụ **hai chế độ đọc**:

```text
Chế độ 1  "tôi không biết từ này là gì"     → Foundation note  → hiểu NÓ LÀ GÌ
Chế độ 2  "tôi muốn biết nó hoạt động sao"  → Behavior note    → failure / debugging / production
```

Trước audit này, nhiều vùng của repo chỉ có chế độ 2.

## Phương pháp

1. Liệt kê ~170 khái niệm theo 24 vùng (A–X).
2. Với mỗi khái niệm, đếm: (a) bao nhiêu note **dùng** nó, (b) bao nhiêu note có nó làm **heading** — dấu hiệu của giải thích thật.
3. Khái niệm nhiều note dùng nhưng **không note nào** có heading = ứng viên hidden prerequisite.
4. Đọc note ứng cử làm canonical owner để xác nhận có định nghĩa thật hay không — đếm heading cho khá nhiều dương tính giả, nên bước này bắt buộc.

Kết quả bước 2 — các khái niệm được dùng nhiều nhất:

```text
execution plan 255   API 242   log 204   context 191   async/await 188
Service 165   HTTP 153   timeout 144   process 131   transaction 117
state 115   index 109   dependency 107   retry 107   URL 93
connection 93   Promise 86   schema 79   DNS 52   port 47
```

Khái niệm **không có heading ở bất kỳ note nào**:

```text
primary key 22   origin 20   cache hit 16   telemetry 15   server component 14
producer 14   V8 12   agent 11   SQL injection 9   eventual consistency 9
prompt 5   saturation 3   fixture 0   context window 0
```

## 6 tiêu chí để tạo một concept note

Không tạo concept note chỉ vì một từ chưa được định nghĩa. Phải đạt **tất cả**:

1. Khái niệm được **≥ 3 note** dùng như prerequisite.
2. Không hiểu nó thì **không đọc được** note behavior tương ứng.
3. Repo **chưa có** chỗ nào định nghĩa nó — nhắc tên không phải định nghĩa.
4. Có **misconception thật** khiến hiểu sai gây lỗi thật.
5. Định nghĩa được trong **≤ 15 dòng**. Cần nhiều hơn nghĩa là nó là behavior note.
6. Có một **canonical owner** tự nhiên — folder đã sở hữu khái niệm đó.

Không đạt đủ 6 → `CROSS_LINK` hoặc `DEFER`, không tạo file.

## Canonical concept rule

> Mỗi khái niệm có **đúng một** note định nghĩa nó. Mọi note khác **link tới**, không định nghĩa lại.

Vi phạm rule này tạo ra hai định nghĩa lệch nhau, và người đọc không biết tin cái nào.

## Kết quả audit theo vùng

Cột **Action**: `KEEP` (đã có foundation tốt) · `EXPAND` (thêm định nghĩa ngắn vào note có sẵn) · `CREATE` (tạo concept note mới) · `CROSS_LINK` (chỉ cần link) · `DEFER`.

Dấu ✅ = đã kiểm chứng bằng cách đọc note, không chỉ đếm heading.

### A. Web fundamentals

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| URL, scheme, host, path, query, fragment | 93 | có sơ đồ anatomy trong `03-url-dns-tcp-tls.md`, nhưng không định nghĩa host vs domain vs hostname | `00-web-foundations/00-web-vocabulary.md` | **CREATE** P0 |
| origin (scheme + host + port) | 20 | **không heading nào** — `06-cors.md` dùng liên tục | như trên | **CREATE** P0 |
| HTTP message: method / status / header / body | 153 | `01-http-request-response.md` mô tả behavior, không phải anatomy | `00-web-vocabulary.md` (anatomy) | **CREATE** P0 |
| request / response / client / server | — | dùng như hiển nhiên khắp repo | `00-web-vocabulary.md` | **CREATE** P0 |
| cookie vs localStorage vs sessionStorage | 21 | `05-cookies-storage.md` đủ sâu | `05-cookies-storage.md` | **KEEP** + CROSS_LINK |
| DOM, CSSOM, render tree | 40+ | `04-rendering-pipeline.md` định nghĩa rõ | `04-rendering-pipeline.md` | **KEEP** |

### B. Networking

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| IP address, IPv4/IPv6, private vs public | ~50 | **không có** — `01-ip-port-dns.md` mở bằng sự cố TTL | `01-networking/00-network-vocabulary.md` | **CREATE** P0 |
| port | 47 | `05-ports-sockets.md` giả định đã biết | như trên | **CREATE** P0 |
| socket | 30+ | `05-ports-sockets.md` có sơ đồ syscall, không có "socket là gì" | như trên | **CREATE** P0 |
| packet, MTU | ~15 | rải rác trong `02-tcp-udp.md` | như trên | **CREATE** P0 |
| TCP vs UDP (ở mức *là gì*) | 40+ | `02-tcp-udp.md` sâu về behavior | như trên (định nghĩa) + `02-tcp-udp.md` (behavior) | **CREATE** P0 |
| DNS: record, resolver, TTL | 52 | `01-ip-port-dns.md` sâu, thiếu "DNS là gì" | như trên | **CREATE** P0 |
| TLS, certificate, CA | 30+ | `03-tls.md` sâu về handshake/failure | như trên (định nghĩa) | **CREATE** P0 |
| proxy, reverse proxy, load balancer | 30+ | `05-reverse-proxy-load-balancer.md` định nghĩa rõ | note đó | **KEEP** + CROSS_LINK |
| subnet, CIDR, NAT, firewall | ~12 | `04-nat-firewall-routing.md` | note đó | **KEEP** |

### C. JavaScript / TypeScript

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| value vs reference, primitive vs object | ~30 | **không có** — `03-error-handling-immutability.md` giả định đã biết | `01-javascript-typescript/fundamentals/00-js-vocabulary.md` | **CREATE** P0 |
| stack vs heap, call stack | ~25 | `01-execution-context-closure.md` mở bằng bug stale closure | như trên | **CREATE** P0 |
| sync vs async, blocking | 188 | `01-event-loop-async.md` sâu về event loop, không định nghĩa "async nghĩa là gì" | như trên (định nghĩa) | **CREATE** P0 |
| callback, và Promise **là gì** | 86 | `02-promise-concurrency.md` dạy `Promise.all` vs `allSettled`, không dạy Promise là object có 3 state | như trên | **CREATE** P0 |
| task vs microtask | 20+ | `01-event-loop-async.md` định nghĩa rõ | note đó | **KEEP** |
| scope, closure | 40+ | `01-execution-context-closure.md` | note đó | **KEEP** |
| module, ESM vs CJS | 30+ | `02-modules-bundling.md` + `06-module-system-node.md` | `02-modules-bundling.md` | **KEEP** |
| type vs runtime value, structural typing | ~25 | `typescript/` có note riêng | `typescript/` | **KEEP** |

### D. React

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| component, props, state, render | 115+ | `react/fundamentals/01-components-and-rendering-model.md` tự nhận là "TỪ ĐIỂN + MÔ HÌNH NỀN" | note đó | **KEEP** ✅ |
| JSX, element vs component | 30+ | như trên | như trên | **KEEP** ✅ |
| hook, rules of hooks | 40+ | `react/fundamentals/` | như trên | **KEEP** |
| reconciliation, key | 20+ | note behavior riêng | note đó | **KEEP** |

### E. Next.js

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| server component vs client component | 14 (**no heading**) | có note RSC boundary sâu | note RSC boundary | **EXPAND** P2 |
| hydration | 20+ | note hydration mismatch | note đó | **KEEP** |
| App Router, route segment | 20+ | `nextjs/fundamentals/` | như trên | **KEEP** |

### F. HTTP API

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| API, endpoint, resource | 242 | **không có định nghĩa** — `02-rest-api-contract.md` bắt đầu từ contract | `00-http-api/00-api-vocabulary.md` | **CREATE** P0 |
| status code theo lớp; 400 vs 404 vs 409 vs 422 | 40+ | `05-error-model.md` sâu về error model, không có bảng nghĩa từng mã | như trên | **CREATE** P0 |
| REST vs RESTful vs "REST API" | 30+ | `02-rest-api-contract.md` | như trên (định nghĩa) | **CREATE** P0 |
| stateless | 20+ | rải rác, không định nghĩa | như trên | **CREATE** P0 |
| DTO, serialization, validation | 40+ | NestJS pipes note | như trên (định nghĩa) + NestJS (behavior) | **CREATE** P0 |
| idempotent, safe, cacheable | 40+ | `03-http-semantics-idempotency.md` định nghĩa rõ | note đó | **KEEP** ✅ |

### G. Node.js

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| process, PID | 131 | `linux/01-process-files-env.md` | note đó | **KEEP** ✅ |
| file descriptor | 20+ | note đó nói thẳng "nếu bạn không biết fd là gì, lỗi này là một bí ẩn" | note đó | **KEEP** ✅ |
| V8, libuv, thread pool | 12 (**no heading**) | `nodejs/fundamentals/` mô tả sâu | `nodejs/fundamentals/` | **EXPAND** P2 |
| stream, Buffer | 25+ | note stream riêng | note đó | **KEEP** |
| signal, SIGTERM | 25+ | `linux/04-signals-lifecycle.md` | note đó | **KEEP** |

### H. NestJS

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| **dependency** (trước khi nói injection) | 107 | `nestjs/fundamentals/02-di-providers.md` nhảy thẳng vào DI container | note đó | **EXPAND** P1 |
| DI, provider, token, module | 60+ | note đó sâu | note đó | **KEEP** |
| decorator, metadata | 30+ | `06-module-system-node.md` + nestjs fundamentals | như trên | **KEEP** |
| guard, interceptor, pipe, middleware | 40+ | note request lifecycle | note đó | **KEEP** |

### I. SQL

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| table, row, column, NULL | 90+ | `00-sql/00-sql-basics.md` có heading "Cấu trúc: bảng, dòng, cột" | note đó | **KEEP** ✅ |
| primary key, foreign key | 22 (**no heading**) | `00-sql-basics.md` có mục "Ràng buộc" bao PK/FK | note đó | **KEEP** ✅ + CROSS_LINK |
| constraint, UNIQUE, CHECK | 30+ | như trên | như trên | **KEEP** |
| transaction, ACID | 117 | `00-sql-basics.md` "ACID trong một câu lệnh" + `postgresql/fundamentals/01` | hai note đó | **KEEP** ✅ |
| JOIN, cardinality | 30+ | `00-sql/` + `03-relationships-cardinality.md` | như trên | **KEEP** |

### J. PostgreSQL

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| PostgreSQL là gì ở mức process | — | `postgresql/fundamentals/01-architecture-and-acid.md` nói rõ "note này giải thích PostgreSQL là CÁI GÌ" | note đó | **KEEP** ✅ |
| connection, connection pool | 93 | `fundamentals/02-connection-pool.md` | note đó | **KEEP** |
| index, B-tree | 109 | `01-index-query-plan.md` có "B-tree: cây sắp xếp" | note đó | **KEEP** ✅ |
| execution plan, planner | 255 | `01-index-query-plan.md` "Đọc plan: bốn thứ cần nhìn" | note đó | **KEEP** ✅ |
| MVCC, WAL, vacuum | 40+ | note riêng từng cái | như trên | **KEEP** |
| isolation level, lock, deadlock | 60+ | `01-transaction-isolation.md` | note đó | **KEEP** |

### K. Data access / Prisma

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| ORM, query builder, raw SQL | 40+ | `05-data-access/01-orm-vs-query-builder-vs-raw-sql.md` định nghĩa cả ba | note đó | **KEEP** ✅ |
| migration | 40+ | `05-prisma-migrations-production.md` | note đó | **KEEP** |
| N+1 | 20+ | `03-prisma-relations-and-n-plus-1.md` | note đó | **KEEP** |

### L. Data modeling

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| normalization, 1NF–3NF | ~15 | `03-data-modeling/` | như trên | **KEEP** |
| surrogate vs natural key, UUID vs serial | 20+ | `06-id-strategy.md` | note đó | **KEEP** |
| timestamp, timezone, UTC | 30+ | `07-datetime-timezone.md` định nghĩa "ba loại thời gian" | note đó | **KEEP** ✅ |
| Decimal vs float, minor unit | 20+ | `08-money-decimal.md` | note đó | **KEEP** |

### M. MongoDB

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| document, collection, BSON, ObjectId | 40+ | `06-mongodb/01-document-model.md` định nghĩa cả bốn | note đó | **KEEP** ✅ |
| embed vs reference | 20+ | note 02 | note đó | **KEEP** |
| replica set, shard | 20+ | note operations | note đó | **KEEP** |

### N. Redis / cache

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| Redis là gì | — | `00-redis-data-model.md`: "Redis là một server cấu trúc dữ liệu, đơn luồng, trong bộ nhớ" | note đó | **KEEP** ✅ |
| key, TTL, expiration | 40+ | note đó: "Expiration: TTL gắn với KEY" | note đó | **KEEP** ✅ |
| cache hit / miss / hit ratio | 16 (**no heading**) | note cache-aside dùng liên tục nhưng không định nghĩa | note cache-aside | **EXPAND** P1 |
| eviction, maxmemory | 20+ | note eviction | note đó | **KEEP** |

### O. Message queue

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| queue, job | 60+ | `01-why-queue.md` có sơ đồ `Producer ──▶ [QUEUE] ──▶ Consumer` | note đó | **KEEP** |
| producer, consumer, broker | 14 (**no heading**) | sơ đồ có nhãn nhưng không có câu định nghĩa | `01-why-queue.md` | **EXPAND** P1 |
| ack, at-least-once, DLQ | 40+ | `02-delivery-semantics.md`, `03-retry-dlq.md` | như trên | **KEEP** |

### P. Linux

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| kernel, syscall, user space | 30+ | `00-linux/` | như trên | **KEEP** |
| process, fd, env var | 131 | `01-process-files-env.md` | note đó | **KEEP** ✅ |
| permission, UID, ownership | 20+ | `03-filesystem-permissions.md` | note đó | **KEEP** |
| namespace, cgroup | 20+ | `06-namespaces-cgroups.md` | note đó | **KEEP** |

### Q. Docker

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| image vs container | 100+ | `01-image-container.md`: "Image là chồng layer chỉ-đọc" + "Container là process, không phải máy ảo" | note đó | **KEEP** ✅ |
| layer, build cache | 40+ | note đó | note đó | **KEEP** ✅ |
| volume, registry, tag | 30+ | note volume + note registry | như trên | **KEEP** |

### R. Kubernetes

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| Pod, Deployment, Service | 165 | `k8s/fundamentals/` có note object model | note đó | **KEEP** |
| desired state, controller loop | 20+ | `01-why-kubernetes.md` + note control plane | như trên | **KEEP** |
| probe: liveness / readiness / startup | 30+ | note probe | note đó | **KEEP** |

### S. Security

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| authentication vs authorization | 60+ | `03-auth/01-authentication-authorization.md` phân biệt rõ ("anh là AI?" → 401 vs "được làm gì?" → 403) | note đó | **KEEP** ✅ |
| session vs token vs JWT | 60+ | `03-auth/` note riêng | như trên | **KEEP** |
| hash vs encrypt vs encode | 40+ | note password hashing | note đó | **KEEP** |
| RBAC / ABAC | 20+ | note authorization models | note đó | **KEEP** |
| XSS, CSRF, SQL injection, SSRF | 40+ | `05-cross-cutting/security/` có note injection riêng | `security/` | **KEEP** + CROSS_LINK |

### T. Testing

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| unit / integration / e2e | 40+ | `01-testing-pyramid-behavior.md` | note đó | **KEEP** |
| mock / stub / fake / spy / dummy | 30+ | `04-mocking-test-doubles.md`: "Năm loại double — chúng không tương đương nhau" | note đó | **KEEP** ✅ |
| flaky test | 10+ | `06-deterministic-tests.md` | note đó | **KEEP** |
| fixture | **0 hit** | không dùng ở đâu | — | **DEFER** |

### U. Observability

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| monitoring vs observability | 20+ | `01-logs-metrics-traces.md` phân biệt bằng "câu hỏi biết trước vs không biết trước" | note đó | **KEEP** ✅ |
| log / metric / trace / span | 204 | note đó | note đó | **KEEP** ✅ |
| correlation ID / requestId | 30+ | note correlation | note đó | **KEEP** |
| SLO / SLI / SLA | 20+ | note SLO | note đó | **KEEP** |
| telemetry, OpenTelemetry | 15 (**no heading**) | dùng như tên công cụ, không phải prerequisite | — | **CROSS_LINK** |

### V. Performance

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| latency vs throughput | 40+ | `01-latency-throughput-bottleneck.md`: "Latency và throughput không đổi cho nhau" | note đó | **KEEP** ✅ |
| p50 / p95 / p99, percentile | 47 | note đó: "Đuôi phân bố quan trọng hơn trung bình" + "Con số nên thuộc lòng" — đủ | note đó | **KEEP** ✅ |
| bottleneck | 30+ | note đó: "Nút thắt: luôn có đúng một" | note đó | **KEEP** ✅ |
| saturation | 3 | dùng quá ít để là prerequisite | — | **DEFER** |

### W. Reliability

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| timeout, retry, backoff, jitter | 144 / 107 | `02-timeout-retry-circuit-breaker.md` | note đó | **KEEP** ✅ |
| circuit breaker | 20+ | note đó | note đó | **KEEP** |
| graceful degradation | 20+ | note degradation | note đó | **KEEP** |

### X. System design & AI

| Khái niệm | Note dùng | Foundation hiện có | Canonical owner | Action |
|---|---|---|---|---|
| vertical vs horizontal scaling | 30+ | `06-system-design/` | như trên | **KEEP** |
| stateless vs stateful | 30+ | như trên + `05-platforms/01-where-to-run.md` | như trên | **KEEP** |
| replication, partitioning, sharding | 40+ | note riêng | như trên | **KEEP** |
| consistency, eventual consistency | 9 (**no heading**) | note CAP / replication | note đó | **EXPAND** P2 |
| hallucination | 20+ | `04-hallucination-verification.md` | note đó | **KEEP** |
| context window | **0 hit** | `02-context-engineering.md` nói về context nhưng không định nghĩa cửa sổ | note đó | **EXPAND** P1 |

## Kết luận của audit

Con số quan trọng nhất: **trong 24 vùng, 18 vùng đã có foundation layer đủ dùng.**

Đó là kết quả trực tiếp của lần restructure trước (`fundamentals/` + `behavior/`): phần lớn `fundamentals/01-*` **đã là** foundation note — chỉ không được gọi tên như vậy, và không được điều hướng tới từ vị trí mà người mới sẽ đứng.

Khoảng trống thật tập trung ở **4 vùng nền nhất — đúng những vùng người mới gặp đầu tiên**:

| Vùng | Vì sao trống | Hệ quả cụ thể |
|---|---|---|
| **Web fundamentals** | folder viết cho người đã biết web | không biết origin là gì → không thể hiểu CORS |
| **Networking** | mọi note mở bằng sự cố vận hành | không biết port/socket → Docker networking là phép thuật |
| **JavaScript runtime** | `fundamentals/01` bắt đầu ở execution context | không biết value vs reference → mọi bug immutability là bí ẩn |
| **HTTP API** | folder bắt đầu ở contract design | không biết 400 vs 404 vs 422 → tự nghĩ ra error model sai |

Đây là một kết luận đáng chú ý: repo **không thiếu chiều sâu**, nó thiếu **cửa vào**.

## Kế hoạch thực thi

### CREATE — 4 note (P0)

Theo convention có sẵn của repo (`00-sql-basics.md`, `00-redis-data-model.md`): đánh số `00-`, nằm ở folder sở hữu khái niệm. **Không** tạo folder `concepts/` ở root.

| File | Bao khái niệm | Gộp vì |
|---|---|---|
| `01-web-frontend/00-web-foundations/00-web-vocabulary.md` | URL anatomy, scheme, host/domain/hostname, origin, HTTP message, method, header, body, request/response, client/server | tất cả trả lời "một request HTTP gồm những gì" — tách thành 9 file 400 byte là vô dụng |
| `04-infrastructure/01-networking/00-network-vocabulary.md` | IP, private vs public, port, socket, packet, TCP vs UDP, DNS, TLS/certificate | tất cả trả lời "byte đi từ máy A sang máy B thế nào" |
| `01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md` | value vs reference, primitive vs object, stack vs heap, sync vs async, callback, Promise là gì, task vs microtask | tất cả trả lời "JS giữ dữ liệu ở đâu, và chạy theo thứ tự nào" |
| `02-backend-api/00-http-api/00-api-vocabulary.md` | API, endpoint, resource, status code theo lớp, 400/401/403/404/409/422, REST vs RESTful, stateless, DTO, serialization | tất cả trả lời "một HTTP API nói bằng ngôn ngữ gì" |

### EXPAND — 5 chỗ (P1/P2)

Chèn tối đa ~10 dòng định nghĩa vào note có sẵn. **Không** viết lại note behavior.

| Note | Thêm gì |
|---|---|
| `02-nestjs/fundamentals/02-di-providers.md` | "dependency là gì" trước khi nói injection |
| `03-database/02-redis/` note cache-aside | cache hit / miss / hit ratio |
| `03-database/04-message-queues/01-why-queue.md` | producer / consumer / broker / job — một câu mỗi cái |
| `09-ai-assisted-development/02-context-engineering.md` | context window là gì, và vì sao nó là ràng buộc vật lý |
| `01-web-frontend/03-nextjs/` note RSC | server component vs client component, định nghĩa 2 dòng |

### CROSS_LINK

Thêm link ở **ba vị trí** mỗi note, không phải mọi lần xuất hiện:

1. **Lần đầu** khái niệm xuất hiện, trong Position hoặc Problem.
2. Frontmatter `prerequisites`.
3. Mục `Related`.

Link ở mọi lần xuất hiện làm note không đọc được.

### Điều hướng

README của mỗi vùng P0 thêm khối 3 lựa chọn:

```text
Mới hoàn toàn?     → 00-*-vocabulary.md
Đã biết từ vựng?   → 01-*.md (behavior)
Đang debug?        → bảng chẩn đoán
```

Và `00-roadmap/glossary.md`: **chỉ là index** — term → nghĩa 1 dòng → note sâu. Không định nghĩa lại, vì đó là vi phạm canonical rule.

### DEFER

`fixture` (0 hit), `saturation` (3 hit), `telemetry` (tên công cụ), CSS layout, HTML semantics, data structure & algorithm, toán học của consensus.

Không phải hidden prerequisite của bất kỳ note nào hiện có trong repo. Thêm chúng là biến repo thành encyclopedia.

## Template foundation note (7 mục, nhẹ)

Foundation phải **rẻ để đọc**. Không dùng template behavior 14 mục.

```text
1. Note này trả lời gì      — 1 câu
2. Vị trí                   — sơ đồ 3–6 dòng
3. Định nghĩa               — mỗi khái niệm ≤ 5 dòng, có ví dụ cụ thể
4. Hiểu sai thường gặp      — bảng: hiểu sai | thực tế | hậu quả
5. Kiểm tra bản thân        — 5–8 câu tự trả lời
6. Đọc gì tiếp              — link sang behavior note
7. Related
```

Không có Break It, không có Production, không có Trade-offs. Những mục đó thuộc behavior note, và đưa vào đây sẽ làm foundation đắt như behavior.

## Related

- [Foundation coverage report](./foundation-coverage-report.md) — kết quả sau khi thực thi
- [Glossary](./glossary.md) — index tra từ
- [Knowledge audit](./knowledge-audit.md) — audit lần đầu (coverage, không phải prerequisite)
- [Learning system](./00-learning-system.md)
