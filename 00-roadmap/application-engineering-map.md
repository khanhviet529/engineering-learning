---
level: intermediate
area: cross-cutting
---

# Application Engineering Map

**Đây là VIEW, không phải nơi chứa kiến thức.** Mọi note nằm ở tầng hệ thống của nó; file này nhóm chúng theo **problem thực tế**.

Dùng nó khi câu hỏi của bạn bắt đầu bằng *"làm sao"* thay vì *"cái gì"*:

```text
"Redis là gì?"                        → dùng Topic Index
"Một màn hình gọi 8 API thì làm sao?" → dùng file này
```

Hai view còn lại: [Behavior Index](behavior-index.md) (tra theo triệu chứng), [Knowledge Map](knowledge-map.md) (tra theo tầng hệ thống).

---

## DATA FETCHING — lấy dữ liệu về UI

**Câu hỏi:** một màn hình cần nhiều nguồn dữ liệu thì tổ chức thế nào?

| Vấn đề | Note |
|---|---|
| Màn hình gọi 8 API — song song, phụ thuộc, partial failure | [Multi-API screen](../01-web-frontend/04-application-engineering/01-multi-api-screen.md) |
| 5 loại state, chọn công cụ nào | [Data fetching architecture](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) |
| Khi nào dùng TanStack Query | [Server state & cache](../01-web-frontend/02-react/behavior/04-server-state-cache.md) |
| Cache client vs Next.js vs Redis khác nhau ở đâu | [Data fetching architecture](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) · [Next.js cache](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) |
| Response cũ ghi đè state mới | [Async race condition](../01-web-frontend/02-react/behavior/03-async-race-condition.md) |
| Fetch ở server hay client | [Server/Client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) · [Rendering strategies](../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md) |
| Khi nào cần BFF | [BFF & aggregation](../02-backend-api/04-architecture/09-bff-and-aggregation.md) |

---

## HỆ THỐNG CHẬM — tìm và sửa

**Câu hỏi:** người dùng nói "chậm" — debug từ browser xuống database thế nào?

| Vấn đề | Note |
|---|---|
| **Playbook: thứ tự kiểm tra 7 trạm** | [Full-stack triage](../05-cross-cutting/performance/07-full-stack-triage.md) |
| Lý thuyết: queueing, tail latency, Amdahl | [Latency & throughput](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) |
| API 5 giây: tối ưu thật vs tối ưu cảm nhận | [Slow API UX](../01-web-frontend/04-application-engineering/03-slow-api-ux.md) |
| Trang tải chậm, LCP/CLS/INP | [Frontend performance](../05-cross-cutting/performance/02-frontend-performance.md) |
| Endpoint chậm, event loop lag | [Backend performance](../05-cross-cutting/performance/03-backend-performance.md) · [Node runtime](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) |
| Query chậm, N+1 | [Database performance](../05-cross-cutting/performance/04-database-performance.md) · [Prisma N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| Trang cuối của list chậm hơn trang đầu | [Pagination](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) |
| Profiling, load test, flame graph | [Profiling & load testing](../05-cross-cutting/performance/05-profiling-load-testing.md) |
| Không biết chuyện gì xảy ra trong production | [Observability](../05-cross-cutting/observability/README.md) |

---

## DATA ACCESS — app nói chuyện với database

**Câu hỏi:** ORM giải quyết gì, và khi nào nên bỏ nó?

| Vấn đề | Note |
|---|---|
| ORM vs Query Builder vs Raw SQL — chọn thế nào | [ORM vs QB vs Raw SQL](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) |
| Prisma schema và client hoạt động ra sao | [Prisma model & client](../03-database/05-data-access/02-prisma-model-and-client.md) |
| N+1 xảy ra thế nào, `include` sinh mấy query | [Prisma relations & N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| Transaction boundary đặt ở đâu | [Prisma transactions](../03-database/05-data-access/04-prisma-transactions.md) |
| Đổi schema production không downtime | [Prisma migrations](../03-database/05-data-access/05-prisma-migrations-production.md) · [Migrations](../03-database/03-data-modeling/04-migrations.md) |
| Khi nào bypass Prisma bằng raw SQL | [Raw SQL escape hatches](../03-database/05-data-access/06-raw-sql-escape-hatches.md) |
| Có nên bọc Prisma trong repository | [Repository pattern & testing](../03-database/05-data-access/07-repository-pattern-testing.md) |
| Hai request đồng thời làm sai dữ liệu | [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) |
| Soft delete, audit log | [Soft delete & audit](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) |

---

## ARCHITECTURE — code đặt ở đâu

**Câu hỏi:** service quá lớn, SOLID áp dụng tới đâu, có cần Clean Architecture?

| Vấn đề | Note |
|---|---|
| SOLID thực tế, và giới hạn của nó | [SOLID trong thực tế](../02-backend-api/04-architecture/06-solid-in-practice.md) |
| Clean Architecture: khi nào cần, khi nào quá mức | [Clean architecture pragmatic](../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md) |
| Service inject 15 dependency | [Service decomposition](../02-backend-api/04-architecture/08-service-decomposition.md) |
| Layering cơ bản | [Controller–Service–Repository](../02-backend-api/04-architecture/01-controller-service-repository.md) |
| Ranh giới module | [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md) |
| Domain logic đặt đâu | [Domain logic boundaries](../02-backend-api/04-architecture/03-domain-logic-boundaries.md) |
| Chiến lược error handling | [Error handling strategy](../02-backend-api/04-architecture/04-error-handling-strategy.md) |
| DI, provider scope (singleton/request/transient) | [DI & providers](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) · [Modules & DI](../02-backend-api/02-nestjs/behavior/02-modules-di.md) |
| Circular import phá DI | [Module system trong Node](../02-backend-api/01-nodejs/fundamentals/02-module-system.md) |
| Tách service thành microservice? | [Monolith → microservices](../06-system-design/08-monolith-to-microservices.md) |

---

## API DESIGN — hợp đồng với client

**Câu hỏi:** RESTful thực sự nghĩa là gì, và đổi API mà không phá client?

| Vấn đề | Note |
|---|---|
| Method, status code có ngữ nghĩa gì | [HTTP request/response](../02-backend-api/00-http-api/01-http-request-response.md) |
| Thiết kế resource, quy ước dữ liệu | [REST API contract](../02-backend-api/00-http-api/02-rest-api-contract.md) |
| User bị charge hai lần | [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) |
| Client cần biết gì khi có lỗi | [Error model](../02-backend-api/00-http-api/05-error-model.md) |
| Đổi API không phá client cũ | [Versioning & evolution](../02-backend-api/00-http-api/06-api-versioning-evolution.md) |
| Một client làm chậm cả hệ thống | [Rate limiting](../02-backend-api/00-http-api/07-rate-limiting.md) |
| REST có phải lựa chọn đúng | [RPC, GraphQL & alternatives](../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md) |

---

## DATABASE CHOICE — chọn nơi lưu dữ liệu

**Câu hỏi:** PostgreSQL hay MongoDB, và theo tiêu chí nào?

| Vấn đề | Note |
|---|---|
| **PostgreSQL vs MongoDB — 10 tiêu chí + lựa chọn JSONB** | [PostgreSQL vs MongoDB](../03-database/06-mongodb/08-postgresql-vs-mongodb.md) |
| Lựa chọn storage rộng hơn (key-value, search, OLAP) | [Storage selection](../06-system-design/06-storage-selection.md) |
| Document model khác relational thế nào | [Document model](../03-database/06-mongodb/01-document-model.md) |
| Embed hay reference | [Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md) |
| MongoDB có schema không | [Schema design & validation](../03-database/06-mongodb/03-schema-design-validation.md) |
| Khi nào cần transaction trong MongoDB | [Transactions & consistency](../03-database/06-mongodb/06-transactions-consistency.md) |
| Schema design quan hệ | [Normalization](../03-database/03-data-modeling/02-normalization.md) · [Relationships & cardinality](../03-database/03-data-modeling/03-relationships-cardinality.md) |
| Cần cache hay cần queue | [Cache patterns](../03-database/02-redis/03-cache-patterns.md) · [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) |

---

## RELIABILITY — khi một phần hỏng

**Câu hỏi:** một service chậm thì cả hệ thống thế nào?

| Vấn đề | Note |
|---|---|
| Timeout, retry, circuit breaker | [Timeout, retry, circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| Một phần hỏng, phần còn lại vẫn dùng được | [Graceful degradation](../05-cross-cutting/reliability/03-graceful-degradation.md) |
| Các kiểu failure và cách chuẩn bị | [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) |
| Đặt giới hạn dựa vào đâu | [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md) |
| 8 trạng thái UI người dùng thật gặp | [Frontend resilience](../01-web-frontend/04-application-engineering/04-frontend-resilience.md) |
| Lỗi mất im lặng | [Error handling & immutability](../01-web-frontend/01-javascript-typescript/fundamentals/03-error-handling-immutability.md) |
| Job chạy 2 lần hoặc bị mất | [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) · [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) |
| Deploy làm mất request | [Graceful shutdown](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) |
| Ghi DB xong nhưng event không gửi được | [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) |

---

## SECURITY — trong application engineering

| Vấn đề | Note |
|---|---|
| User A đọc được dữ liệu user B | [Access control](../05-cross-cutting/security/04-access-control.md) |
| Authorization nên ở tầng nào | [Middleware & auth patterns](../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md) · [Authorization models](../02-backend-api/03-auth/06-authorization-models.md) |
| SQL injection với ORM và raw SQL | [Injection](../05-cross-cutting/security/02-injection.md) · [Raw SQL escape hatches](../03-database/05-data-access/06-raw-sql-escape-hatches.md) |
| Lưu token ở đâu | [Cookies & storage](../01-web-frontend/00-web-foundations/05-cookies-storage.md) · [Session vs token](../02-backend-api/03-auth/02-session-vs-token.md) |

---

## KIẾN THỨC THỰC DỤNG — thứ hay gặp mà ít được dạy

**Câu hỏi:** những thứ mọi ứng dụng thật đều cần nhưng không có trong tutorial nào?

| Vấn đề | Note |
|---|---|
| ID tăng dần hay UUID? Vì sao UUIDv4 làm INSERT chậm dần | [ID strategy](../03-database/03-data-modeling/06-id-strategy.md) |
| "Hôm nay" của ai? Lưu gì, hiển thị gì | [Date, time & timezone](../03-database/03-data-modeling/07-datetime-timezone.md) |
| Tiền: làm tròn, đơn vị nhỏ nhất, thuế, tỉ giá | [Tiền & Decimal](../03-database/03-data-modeling/08-money-decimal.md) |
| Soft delete phá unique constraint; 4 mức audit | [Soft delete & audit](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) |
| Upload file: magic bytes, presigned URL, path traversal | [Upload & download](../02-backend-api/00-http-api/09-file-upload-download.md) |
| Export CSV/Excel/PDF — và **CSV formula injection** | [Export & reporting](../02-backend-api/00-http-api/10-export-and-reporting.md) |
| Vì sao email vào spam: SPF/DKIM/DMARC, bounce | [Gửi email](../02-backend-api/05-integrations/01-sending-email.md) |
| Gửi webhook: ký HMAC, retry, endpoint chết, SSRF | [Webhook gửi ra](../02-backend-api/05-integrations/02-outgoing-webhooks.md) |
| S3/R2, CDN, lifecycle, và dual-write với database | [File storage](../02-backend-api/05-integrations/03-file-storage.md) |
| Tìm kiếm: `tsvector`, tiếng Việt không dấu, khi nào cần Elasticsearch | [Full-text search](../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) |
| Hash mật khẩu: argon2id / bcrypt / scrypt | [Password & MFA](../02-backend-api/03-auth/05-password-mfa.md) |
| Deploy ở đâu: VPS / PaaS / serverless / edge | [Chạy ở đâu](../04-infrastructure/05-platforms/01-where-to-run.md) |
| Cloudflare — và vì sao Workers **không phải** Node.js | [Cloudflare & edge](../04-infrastructure/05-platforms/02-cloudflare-and-edge.md) |

Bốn note đầu là **kiểu dữ liệu dễ làm sai** — chúng ảnh hưởng schema, và schema là thứ khó đổi nhất.

## BÀI TẬP — nối tất cả lại

| | |
|---|---|
| **5 scenario thật, tự chẩn đoán trước khi xem đáp án** | [Scenario walkthroughs](../05-cross-cutting/scenarios/01-scenario-walkthroughs.md) |

---

## Bốn nguyên tắc xuyên suốt lớp kiến thức này

1. **Đo trước khi sửa.** Trong cả 5 scenario, phép đo đầu tiên đổi hoàn toàn hướng giải quyết.
2. **Triệu chứng ≠ nguyên nhân.** "8 API chậm" thật ra là payload; "Prisma chậm" thật ra là thiếu index trên khoá ngoại.
3. **Câu hỏi nghiệp vụ đi trước câu hỏi kỹ thuật.** *"Dữ liệu cũ 5 phút có được không?"* rẻ hơn mọi tối ưu query.
4. **Công cụ không thay thế hiểu biết.** ORM không thay kiến thức index; cache không thay kiến thức về nút thắt; BFF không thay kiến thức về timeout.

## Xây feature có AI bên trong

Đây là một nhóm problem riêng, và nó có track riêng: [10-ai-engineering/](../10-ai-engineering/README.md).

| Câu hỏi | Vào đây |
|---|---|
| "Màn hình chat: state ở đâu, stream thế nào, huỷ thế nào?" | [Chatbot architecture](../10-ai-engineering/02-chatbot-web/01-chatbot-architecture.md) · [Chat UX & state](../10-ai-engineering/02-chatbot-web/04-chat-ux-and-state.md) |
| "Làm sao model trả lời đúng về dữ liệu công ty tôi?" | [RAG pipeline](../10-ai-engineering/03-rag/03-rag-pipeline.md) |
| "AI trả lời sai — lỗi ở tầng nào?" | [RAG failure modes](../10-ai-engineering/03-rag/04-rag-failure-modes.md) |
| "Làm sao cho AI *hành động* mà không gây hại?" | [Tool security](../10-ai-engineering/04-agents-tools/02-tool-security.md) |
| "Hoá đơn AI tăng 30× — tìm ở đâu?" | [Cost & model routing](../10-ai-engineering/07-production/02-cost-and-model-routing.md) |
| "Làm sao biết AI feature tốt hay tệ?" | [Evaluation](../10-ai-engineering/05-evaluation/01-evaluating-ai-features.md) |
| "Chatbot chậm — tối ưu cái gì?" | [Latency engineering](../10-ai-engineering/07-production/04-latency-engineering.md) |

## Related

- [Roadmap](02-roadmap.md) — 12 behavior theo thứ tự học
- [Behavior Index](behavior-index.md) — tra theo triệu chứng
- [Knowledge Map](knowledge-map.md) — tra theo tầng hệ thống
- [Topic Index](04-topic-index.md) — tra theo công nghệ
- [Application Engineering Coverage Report](application-engineering-coverage-report.md) — phiên bổ sung lớp này
