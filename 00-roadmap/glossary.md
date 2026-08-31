---
level: meta
area: roadmap
---

# Glossary

**Index tra từ.** Mỗi dòng: một câu nhắc để nhận ra từ, và link tới note **định nghĩa** nó.

> Note này **không** định nghĩa gì. Nó chỉ trỏ đường.
>
> Lý do: mỗi khái niệm trong repo này có **đúng một** note sở hữu nó (*canonical owner*). Định nghĩa lại ở đây sẽ tạo ra hai bản lệch nhau, và bạn sẽ không biết tin bản nào. Xem [Foundation gap audit](./foundation-gap-audit.md).

Nếu bạn không tra một từ lẻ mà muốn **học từ đầu một vùng**, đi qua bốn note từ vựng:
[Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) ·
[Network](../04-infrastructure/01-networking/00-network-vocabulary.md) ·
[JavaScript](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) ·
[API](../02-backend-api/00-http-api/00-api-vocabulary.md)

## A

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| ACID | bốn đảm bảo của transaction | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| ack | consumer báo "đã xử lý xong", queue mới xoá job | [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) |
| aggregation pipeline | chuỗi stage biến đổi document trong MongoDB | [Aggregation](../03-database/06-mongodb/05-aggregation-pipeline.md) |
| async | bắt đầu việc rồi đi tiếp, không chặn luồng | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| authentication | "anh là ai?" → `401` | [Authn & authz](../02-backend-api/03-auth/01-authentication-authorization.md) |
| authorization | "anh được làm gì?" → `403` | [Authn & authz](../02-backend-api/03-auth/01-authentication-authorization.md) |
| autoscaling | tự tăng giảm số instance theo tải | [Autoscaling](../04-infrastructure/04-kubernetes/scheduling-reliability/03-autoscaling.md) |

## B

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| backoff | chờ lâu dần giữa các lần retry | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| backpressure | phía chậm buộc phía nhanh chậm lại | [Backpressure](../05-cross-cutting/performance/06-backpressure.md) |
| B-tree | cây sắp xếp — cấu trúc index mặc định | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| bottleneck | nút thắt; luôn có đúng một tại một thời điểm | [Latency, throughput, bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| broker | phần mềm giữ queue (Redis, RabbitMQ, Kafka, SQS) | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| BSON | định dạng nhị phân MongoDB dùng để lưu document | [Document model](../03-database/06-mongodb/01-document-model.md) |
| build cache | layer Docker được dùng lại nếu input không đổi | [Dockerfile & build cache](../04-infrastructure/02-docker/05-dockerfile-build-cache.md) |

## C

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| cache-aside | app đọc cache, miss thì tự đọc DB rồi ghi cache | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) |
| cache hit / miss | dữ liệu có / không có trong cache | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) |
| callback | function truyền cho code khác gọi hộ | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| call stack | chồng lời gọi hàm đang chạy dở — nguồn của stack trace | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| cardinality | quan hệ 1-1, 1-n, n-n giữa hai bảng | [Relationships & cardinality](../03-database/03-data-modeling/03-relationships-cardinality.md) |
| certificate | file server xuất trình để chứng minh danh tính | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| cgroup | cơ chế kernel giới hạn CPU/RAM của nhóm process | [Namespaces & cgroups](../04-infrastructure/02-docker/04-namespaces-cgroups.md) |
| circuit breaker | ngắt gọi upstream đang chết để không lan lỗi | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| client component | component có code gửi xuống browser và chạy ở đó | [Server/client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) |
| closure | function ghi nhớ scope nơi nó **được định nghĩa** | [Execution context & closure](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) |
| collection | tập document trong MongoDB, tương đương bảng | [Document model](../03-database/06-mongodb/01-document-model.md) |
| commit (git/DB) | trong DB: chốt transaction, không quay lại được | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| commit (React) | pha React ghi thay đổi vào DOM thật | [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| component | function trả về mô tả UI | [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| connection pool | tập kết nối DB dùng lại, có giới hạn | [Connection pool](../03-database/01-postgresql/fundamentals/02-connection-pool.md) |
| consumer | process lấy job ra khỏi queue và làm | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| contract | lời hứa của API: nhận gì, trả gì, lỗi ra sao | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| context (React) | cách truyền dữ liệu xuống sâu không qua props | [Hooks advanced](../01-web-frontend/02-react/fundamentals/03-hooks-advanced-map.md) |
| context window | số token mô hình "thấy" trong một lần sinh | [Context engineering](../09-ai-assisted-development/02-context-engineering.md) |
| cookie | chuỗi browser tự động gắn vào request theo domain | [Cookies & storage](../01-web-frontend/00-web-foundations/05-cookies-storage.md) |
| CORS | quy tắc browser dùng để chặn JS đọc response khác origin | [CORS](../01-web-frontend/00-web-foundations/06-cors.md) |
| correlation ID | id nối các log của cùng một request | [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) |
| CSP | header giới hạn nguồn script browser được chạy | [CSP & browser security](../01-web-frontend/00-web-foundations/07-csp-browser-security.md) |
| CSRF | site lạ khiến browser bạn gửi request có credential | [XSS & CSRF](../05-cross-cutting/security/03-xss-csrf.md) |
| cursor pagination | phân trang bằng con trỏ, ổn định khi dữ liệu đổi | [Pagination](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) |

## D

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| deadlock | hai transaction chờ lock của nhau, không ai đi được | [Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) |
| Decimal | kiểu số thập phân chính xác — dùng cho tiền | [Money & Decimal](../03-database/03-data-modeling/08-money-decimal.md) |
| dependency | thứ một class cần có sẵn để làm việc của nó | [DI & provider](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) |
| desired state | trạng thái bạn khai báo; K8s liên tục kéo về đó | [Vì sao cần Kubernetes](../04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md) |
| DI | ai đó bên ngoài quyết định dependency là object nào | [DI & provider](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) |
| DLQ | nơi chứa job thất bại hết số lần retry | [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) |
| DNS | dịch tên thành IP | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| document | bản ghi dạng JSON/BSON trong MongoDB | [Document model](../03-database/06-mongodb/01-document-model.md) |
| DOM | cây object browser tạo từ HTML | [Rendering pipeline](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md) |
| domain | tên bạn đăng ký, ví dụ `shop.com` | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| DTO | hình dạng dữ liệu tại biên, khác entity của DB | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |

## E

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| embed vs reference | nhúng document con hay lưu id trỏ tới | [Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md) |
| endpoint | một method + path mà API trả lời | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| ephemeral port | port OS tự cấp cho phía client | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| ESM / CJS | hai hệ module của JS, không tương thích trực tiếp | [Modules & bundling](../01-web-frontend/01-javascript-typescript/fundamentals/02-modules-bundling.md) |
| eventual consistency | các bản sao rồi sẽ giống nhau, không phải ngay | [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md) |
| event loop | vòng lặp lấy việc từ queue chạy trên một luồng | [Event loop & async](../01-web-frontend/01-javascript-typescript/async-concurrency/01-event-loop-async.md) |
| eviction | Redis đá key ra khi hết bộ nhớ | [Eviction & memory](../03-database/02-redis/04-eviction-memory.md) |
| execution plan | cách PostgreSQL dự định chạy query của bạn | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| expand/contract | migration nhiều bước để không downtime | [Prisma migrations](../03-database/05-data-access/05-prisma-migrations-production.md) |

## F

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| file descriptor | số nguyên OS cấp cho một file/socket đang mở | [Process, file, env](../04-infrastructure/00-linux/01-process-files-env.md) |
| flaky test | test cùng code mà lúc pass lúc fail | [Deterministic tests](../05-cross-cutting/testing/06-deterministic-tests.md) |
| foreign key | cột trỏ tới khoá chính của bảng khác | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| fragment | phần sau `#` trong URL — **không** gửi lên server | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| full-text search | tìm theo từ trong văn bản, không phải `LIKE` | [Full-text search](../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) |

## G–H

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| garbage collector | giải phóng object khi không còn tham chiếu | [Memory & GC](../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md) |
| graceful shutdown | ngừng nhận việc mới, làm xong việc đang có, rồi thoát | [Graceful shutdown](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) |
| guard (Nest) | quyết định request được đi tiếp hay không | [Building blocks](../02-backend-api/02-nestjs/fundamentals/01-building-blocks.md) |
| hallucination | AI nói ra thứ nghe đúng nhưng không tồn tại | [Hallucination & verification](../09-ai-assisted-development/04-hallucination-verification.md) |
| hash | biến đổi một chiều, không đảo được — khác encrypt | [Security basics](../05-cross-cutting/security/01-security-basics.md) |
| header | metadata của HTTP message, dạng `Tên: giá trị` | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| heap | vùng bộ nhớ chứa object, do GC dọn | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| hit ratio | `hits / (hits + misses)` — cache có tác dụng không | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) |
| hoisting | khai báo được xử lý trước khi code chạy | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| host | hostname, kèm port nếu khác mặc định | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| HTTP | quy ước về hình dạng câu hỏi và câu trả lời | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| hydration | React gắn event handler vào HTML server đã render | [Server/client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) |

## I–J

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| idempotent | gọi nhiều lần cho kết quả như gọi một lần | [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) |
| image (Docker) | chồng layer chỉ-đọc; template để tạo container | [Image & container](../04-infrastructure/02-docker/01-image-container.md) |
| index | cấu trúc phụ giúp tìm dòng không cần quét cả bảng | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| IP address | số định danh một máy trên mạng | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| isolation level | mức transaction này thấy được thay đổi của transaction khác | [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) |
| jitter | thêm ngẫu nhiên vào backoff để retry không dồn cục | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| job | một đơn vị việc trong queue | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| JSX | cú pháp mô tả UI, biên dịch thành lời gọi function | [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| JWT | token tự chứa thông tin, có chữ ký, **không** mã hoá | [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) |

## K–M

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| key (React) | định danh giúp React biết item nào là item nào | [State & render](../01-web-frontend/02-react/behavior/01-state-render.md) |
| latency | thời gian cho **một** việc | [Latency, throughput, bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| layer (Docker) | một tầng chỉ-đọc trong image, cache theo input | [Image & container](../04-infrastructure/02-docker/01-image-container.md) |
| load balancer | chia request cho nhiều instance | [Reverse proxy & LB](../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) |
| localStorage | lưu trữ theo origin, JS đọc được — nên XSS đọc được | [Cookies & storage](../01-web-frontend/00-web-foundations/05-cookies-storage.md) |
| lock | cơ chế cho một transaction giữ quyền trên dòng | [Locking & deadlock](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) |
| macrotask | `setTimeout`, I/O — chạy **sau** mọi microtask | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| magic bytes | vài byte đầu file — bằng chứng thật về định dạng | [Upload & download](../02-backend-api/00-http-api/09-file-upload-download.md) |
| metric | số đo tổng hợp theo thời gian | [Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) |
| microtask | `.then`, `await` — chạy **trước** macrotask | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| middleware | code chạy trước handler trên đường đi của request | [Building blocks](../02-backend-api/02-nestjs/fundamentals/01-building-blocks.md) |
| migration | file mô tả thay đổi schema, chạy theo thứ tự | [Prisma migrations](../03-database/05-data-access/05-prisma-migrations-production.md) |
| mock / stub / fake / spy | bốn loại test double, không thay được cho nhau | [Mocking & test doubles](../05-cross-cutting/testing/04-mocking-test-doubles.md) |
| monitoring | trả lời câu hỏi bạn **biết trước** | [Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) |
| MTU | kích thước packet lớn nhất một đường truyền nhận | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| MVCC | mỗi transaction thấy một ảnh chụp riêng của dữ liệu | [MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |

## N–O

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| N+1 | 1 query lấy danh sách + N query lấy chi tiết | [Prisma relations & N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| namespace (Linux) | kernel cho process thấy một "thế giới" riêng | [Namespaces & cgroups](../04-infrastructure/02-docker/04-namespaces-cgroups.md) |
| NAT | đổi IP nguồn khi packet ra khỏi mạng nội bộ | [NAT, firewall, routing](../04-infrastructure/01-networking/04-nat-firewall-routing.md) |
| normalization | tách dữ liệu để không lặp lại | [Normalization](../03-database/03-data-modeling/02-normalization.md) |
| ObjectId | id 12 byte MongoDB sinh, chứa timestamp | [Document model](../03-database/06-mongodb/01-document-model.md) |
| observability | trả lời câu hỏi bạn **chưa** biết trước | [Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) |
| offset pagination | `?page=2&limit=20` — đơn giản, lệch khi dữ liệu đổi | [Pagination](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) |
| origin | `scheme + hostname + port` — đơn vị bảo mật của browser | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| ORM | map bảng ↔ object; **không** thay thế kiến thức SQL | [ORM vs query builder vs raw SQL](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) |
| outbox | ghi ý định gửi vào DB cùng transaction, worker gửi sau | [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) |

## P–Q

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| packet | mẩu nhỏ mà dữ liệu bị chia ra để đi trên mạng | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| p50 / p95 / p99 | phân vị — đuôi phân bố, không phải trung bình | [Latency, throughput, bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| payload | phần dữ liệu thật trong body | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| PID | số định danh một process | [Process, file, env](../04-infrastructure/00-linux/01-process-files-env.md) |
| pipe (Nest) | biến đổi và validate dữ liệu vào trước handler | [Building blocks](../02-backend-api/02-nestjs/fundamentals/01-building-blocks.md) |
| Pod | đơn vị nhỏ nhất K8s chạy — một hoặc vài container | [Pod, Deployment, Service](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md) |
| port | số chỉ ra service nào trên một máy | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| primary key | cột định danh duy nhất một dòng | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| primitive | giá trị bất biến: string, number, boolean, null… | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| probe | K8s hỏi container còn sống / sẵn sàng nhận traffic chưa | [Health, readiness, liveness](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) |
| process | một chương trình đang chạy, có PID riêng | [Process, file, env](../04-infrastructure/00-linux/01-process-files-env.md) |
| producer | code đẩy job vào queue | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| Promise | object đại diện kết quả chưa có, ba trạng thái | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| props | dữ liệu component nhận từ bên ngoài | [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| provider (Nest) | thứ DI container biết cách tạo và tiêm | [DI & provider](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) |
| proxy | máy đứng giữa, đại diện cho **client** | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| query (URL) | phần sau `?`, dạng `key=value` nối bằng `&` | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| query planner | bộ phận PostgreSQL chọn cách chạy query | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| queue | bộ đệm bền vững giữa producer và consumer | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |

## R–S

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| RBAC / ABAC | phân quyền theo vai trò / theo thuộc tính | [Access control](../05-cross-cutting/security/04-access-control.md) |
| reference | biến giữ **địa chỉ** của object, không giữ object | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| render (React) | React gọi component để biết UI **nên** trông thế nào | [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| replica set | nhóm bản sao MongoDB, một primary | [Operations](../03-database/06-mongodb/07-operations-production.md) |
| replication | giữ bản sao dữ liệu trên máy khác | [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md) |
| resource | *thứ* mà endpoint nói về: order, user | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| REST | kiểu kiến trúc; "REST API" thực tế là một quy ước | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| retry | gọi lại sau khi thất bại — chỉ an toàn nếu idempotent | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| reverse proxy | máy đứng giữa, đại diện cho **server** | [Reverse proxy & LB](../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) |
| rollback | huỷ transaction, quay về trạng thái trước `BEGIN` | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| sargable | điều kiện `WHERE` mà index dùng được | [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| scope (JS) | vùng code mà một biến nhìn thấy được | [Execution context & closure](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) |
| serialization | biến object trong bộ nhớ thành chuỗi để gửi đi | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| server component | component **chỉ** chạy trên server, code không gửi xuống browser | [Server/client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) |
| Service (K8s) | tên ổn định trỏ tới nhóm Pod đang thay đổi | [Pod, Deployment, Service](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md) |
| session | state về người dùng, giữ ở phía server | [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) |
| shard | chia dữ liệu ra nhiều máy theo khoá | [Operations](../03-database/06-mongodb/07-operations-production.md) |
| signal | thông báo OS gửi cho process: `SIGTERM`, `SIGKILL` | [Signals & lifecycle](../04-infrastructure/00-linux/04-signals-lifecycle.md) |
| SLO / SLI / SLA | mục tiêu / chỉ số / cam kết về mức phục vụ | [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md) |
| socket | một đầu của một kết nối; là một file descriptor | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| soft delete | đánh dấu đã xoá thay vì `DELETE` thật | [Soft delete & audit](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) |
| SPF / DKIM / DMARC | ba bản ghi DNS chứng minh bạn được gửi email cho domain | [Gửi email](../02-backend-api/05-integrations/01-sending-email.md) |
| SQL injection | dữ liệu người dùng biến thành câu lệnh SQL | [Injection](../05-cross-cutting/security/02-injection.md) |
| SSRF | server bị dụ gọi tới địa chỉ nội bộ | [SSRF & supply chain](../05-cross-cutting/security/05-ssrf-supply-chain.md) |
| stack (bộ nhớ) | vùng chứa giá trị nhỏ, dọn tự động | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| stateless | server không giữ ký ức về request trước | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| status code | ba chữ số nói kết quả của request | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| stream | dữ liệu xử lý dần, không nạp hết vào bộ nhớ | [Streams](../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md) |
| subnet / CIDR | cách chia dải IP thành mạng con | [NAT, firewall, routing](../04-infrastructure/01-networking/04-nat-firewall-routing.md) |

## T–Z

| Từ | Nhắc một câu | Định nghĩa ở |
|---|---|---|
| TCP | đảm bảo tới đủ và đúng thứ tự, hoặc báo lỗi | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| TDZ | khoảng trước dòng `let` — truy cập thì lỗi | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| throughput | số việc xong trong một đơn vị thời gian | [Latency, throughput, bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| timeout | giới hạn thời gian chờ trước khi bỏ | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| TLS | mã hoá kết nối + xác thực server | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| token (API) | chuỗi client mang theo để chứng minh danh tính | [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) |
| token (AI) | đơn vị mô hình đọc — ~3–4 ký tự với code | [Context engineering](../09-ai-assisted-development/02-context-engineering.md) |
| trace / span | đường đi của một request qua nhiều service | [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) |
| transaction | nhóm câu lệnh: cả hai, hoặc không cái nào | [SQL basics](../03-database/00-sql/00-sql-basics.md) |
| TTL | được cache bao lâu, tính bằng giây | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| UDP | gửi và không hỏi lại; mất packet trong im lặng | [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) |
| URL | chuỗi nói đủ để tìm ra một tài nguyên | [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| UUIDv4 / UUIDv7 | id ngẫu nhiên / id ngẫu nhiên **có thứ tự thời gian** | [ID strategy](../03-database/03-data-modeling/06-id-strategy.md) |
| vacuum | dọn dòng chết MVCC để lấy lại chỗ | [MVCC & vacuum](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |
| validation | kiểm tra dữ liệu vào trước khi chạm logic | [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) |
| value vs reference | primitive copy giá trị; object copy địa chỉ | [Từ vựng JS](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| V8 | engine chạy JavaScript trong Chrome và Node | [Node runtime](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) |
| volume | chỗ lưu dữ liệu sống lâu hơn container | [Volumes & state](../04-infrastructure/02-docker/03-volumes-state.md) |
| WAL | log ghi trước, nền của durability và replication | [WAL, durability, backup](../03-database/01-postgresql/operations/01-wal-durability-backup.md) |
| webhook | HTTP request bạn **gửi ra** khi có sự kiện | [Webhook gửi ra](../02-backend-api/05-integrations/02-outgoing-webhooks.md) |
| WebSocket | kết nối hai chiều, giữ mở, trên một socket TCP | [WebSocket & SSE](../01-web-frontend/00-web-foundations/08-websocket-sse.md) |
| worker | process chạy job từ queue, không nằm trong request nào | [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |
| XSS | script của kẻ khác chạy trong trang của bạn | [XSS & CSRF](../05-cross-cutting/security/03-xss-csrf.md) |

## Related

- [Foundation gap audit](./foundation-gap-audit.md) — vì sao lớp foundation tồn tại, và canonical concept rule
- [Foundation coverage report](./foundation-coverage-report.md) — vùng nào đã có, vùng nào cố tình chưa
- [Topic index](./04-topic-index.md) — tra theo **tên công nghệ** thay vì theo từ
- [Behavior index](./behavior-index.md) — tra theo **triệu chứng** đang gặp
- [Knowledge map](./knowledge-map.md) — tra theo **tầng** hệ thống
