---
level: foundation
area: cross-cutting
---

# Application Engineering Coverage Report

Kết quả phiên bổ sung lớp **Real-world Application Engineering + Data Access + MongoDB**.

Thời điểm: 2026-08-28.
Trước phiên: **247 note**. Sau phiên: **273 note** (+26).

---

## Existing coverage reused — không viết lại

Nguyên tắc của phiên này là **cross-link thay vì duplicate**. Bảy vùng đã có coverage tốt và chỉ được liên kết thêm:

| Vùng | Đã có | Xử lý |
|---|---|---|
| Pagination / cursor / tie-breaker / `COUNT(*)` | [04-pagination-filtering-sorting](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) + 7 note khác nhắc tới | Note Prisma chỉ thêm **cú pháp** (`skip/take`, `cursor`) + cross-link. Không lặp lý thuyết OFFSET vs cursor. |
| PostgreSQL index / query planning / EXPLAIN | 3 note trong `indexes-query-planning/` | Note MongoDB index cross-link để **so sánh**, không lặp lý thuyết B-tree. |
| SQL vs NoSQL / storage selection | [06-storage-selection](../06-system-design/06-storage-selection.md) | Note mới là **comparison cụ thể** PostgreSQL vs MongoDB (10 tiêu chí + JSONB), cross-link hai chiều. |
| Async / concurrency | `concurrency/` (3) + `async-concurrency/` (2) + [async race condition](../01-web-frontend/02-react/behavior/03-async-race-condition.md) | Chỉ cross-link từ note application engineering. **Không** tạo note khái niệm mới. |
| REST / API design | cả folder [00-http-api/](../02-backend-api/00-http-api/README.md) (8 note) | Chỉ cross-link. Không tạo "What is REST". |
| DI lifetime (singleton/request/transient) | [02-di-providers](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) | **Đã kiểm chứng độ sâu**: có 3 scope, vấn đề bubble-up, và AsyncLocalStorage như giải pháp thay thế. Không cần mở rộng. |
| Error handling / reliability | 4 note error + `reliability/` (4) | Chỉ cross-link từ [Frontend resilience](../01-web-frontend/04-application-engineering/04-frontend-resilience.md). |
| Performance theory | `performance/` (6 note: queueing, Amdahl, tail latency, coordinated omission, flame graph) | Chỉ thêm **playbook** triage; không lặp lý thuyết. |

**Duplicate đã tránh:** một note pagination mới, một note storage-selection mới, một note "REST fundamentals" mới, một note DI scope mới, một note async mới, một note error handling mới, một note resilience mới — bảy note **không** được viết vì nội dung đã có.

---

## Files created — 26 note + 4 README

### Data access (Batch 1) — `03-database/05-data-access/` — 7 note + README

Thứ tự **pattern trước tool**: note 01 dạy bài toán và ba mức trừu tượng, rồi Prisma là một *instance* của mức "ORM".

| Note | Ý chính |
|---|---|
| [01 ORM vs Query Builder vs Raw SQL](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) | impedance mismatch (5 biểu hiện) · decision framework 7 tiêu chí · vì sao trộn cả ba là bình thường |
| [02 Prisma model & client](../03-database/05-data-access/02-prisma-model-and-client.md) | schema **không phải** database · `findUnique` vs `findFirst` · `updateMany` như công cụ chống race · `select` vs `include` |
| [03 Prisma relations & N+1](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) | `include` batch → **2 query, không phải 101** · 3 dạng N+1 thật · vì sao `Promise.all` làm tệ hơn · `relationLoadStrategy` |
| [04 Prisma transactions](../03-database/05-data-access/04-prisma-transactions.md) | 3 kiểu transaction · **không gọi network trong transaction** · 4 mức bảo vệ race · retry `P2034` |
| [05 Prisma migrations production](../03-database/05-data-access/05-prisma-migrations-production.md) | `migrate dev` có thể **reset prod** · expand/contract 5 bước · `CREATE INDEX CONCURRENTLY` cần sửa SQL tay · backfill theo lô |
| [06 Raw SQL escape hatches](../03-database/05-data-access/06-raw-sql-escape-hatches.md) | tagged template an toàn · `Unsafe` + allowlist cho định danh · `COUNT(*)` trả `BigInt` |
| [07 Repository pattern & testing](../03-database/05-data-access/07-repository-pattern-testing.md) | **bài kiểm tra một câu** · 5 trường hợp repository có giá trị · vì sao "đổi database sau" là lý do giả |

### MongoDB (Batch 2) — `03-database/06-mongodb/` — 8 note + README

| Note | Ý chính |
|---|---|
| [01 Document model](../03-database/06-mongodb/01-document-model.md) | **đảo chiều thiết kế** · `null` vs field không tồn tại · 16MB là ràng buộc thiết kế |
| [02 Embed vs reference](../03-database/06-mongodb/02-embed-vs-reference.md) | 6 câu hỏi quyết định · **"có trần không" > "hiện bao nhiêu"** · snapshot vs bản sao cần đồng bộ · `$slice` |
| [03 Schema design & validation](../03-database/06-mongodb/03-schema-design-validation.md) | schema không mất, nó **chuyển chỗ** · lộ trình 4 bước bật validator không outage · không có FK ⇒ mồ côi là trạng thái bình thường |
| [04 Indexes & query planning](../03-database/06-mongodb/04-indexes-query-planning.md) | **quy tắc ESR** và vì sao thứ tự đó đúng · multikey · thiếu index làm sort **THẤT BẠI**, không chỉ chậm |
| [05 Aggregation pipeline](../03-database/06-mongodb/05-aggregation-pipeline.md) | **chỉ stage đầu dùng index** · `$lookup` sau `$limit` · 16MB áp dụng cả document trung gian |
| [06 Transactions & consistency](../03-database/06-mongodb/06-transactions-consistency.md) | escape hatch ở đây, mặc định ở PostgreSQL · thiếu `{session}` **lỗi im lặng** · `w: 1` mất ghi đã xác nhận |
| [07 Operations & production](../03-database/06-mongodb/07-operations-production.md) | **working set vs RAM** là metric số một · 3 tiêu chí shard key · 5 bước mở rộng trước khi shard |
| [08 PostgreSQL vs MongoDB](../03-database/06-mongodb/08-postgresql-vs-mongodb.md) | 10 tiêu chí · **lựa chọn thứ ba: PostgreSQL + JSONB** · giới hạn thật của JSONB |

### Application engineering (Batch 3) — 11 note + 2 README

**Frontend** — `01-web-frontend/04-application-engineering/` (4 note + README):

| Note | Ý chính |
|---|---|
| [01 Multi-API screen](../01-web-frontend/04-application-engineering/01-multi-api-screen.md) | dependency graph → criticality → boundary · `allSettled` không `all` · 3 tín hiệu **đo được** để cần BFF |
| [02 Data fetching architecture](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) | 5 loại state · **5 lớp cache và cách vô hiệu mỗi lớp** · TanStack Query ≠ Redis · filter thuộc URL |
| [03 Slow API UX](../01-web-frontend/04-application-engineering/03-slow-api-ux.md) | actual vs perceived · `Server-Timing` · ngưỡng UI theo thời gian · `isPending` vs `isFetching` |
| [04 Frontend resilience](../01-web-frontend/04-application-engineering/04-frontend-resilience.md) | **8 trạng thái UI** · empty ≠ error · stale ≠ loading · discriminated union + exhaustiveness |

**Backend** — `02-backend-api/04-architecture/` (append 4):

| Note | Ý chính |
|---|---|
| [06 SOLID trong thực tế](../02-backend-api/04-architecture/06-solid-in-practice.md) | heuristic không phải luật · **câu hỏi một câu** kiểm tra trừu tượng · DRY sai gây coupling · rule of three |
| [07 Clean architecture pragmatic](../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md) | số tầng **không phải** điểm · hàm thuần domain = 90% giá trị, 10% chi phí · thang 5 mức · chi phí thật |
| [08 Service decomposition](../02-backend-api/04-architecture/08-service-decomposition.md) | 15 dependency = **4 bệnh khác nhau** · event giải quyết 7/15 mà không tách class · `forwardRef` = tách sai |
| [09 BFF & aggregation](../02-backend-api/04-architecture/09-bff-and-aggregation.md) | **timeout budget** · một BFF per client type · partial response + `degraded[]` · circuit breaker |

**Cross-cutting** (append 3):

| Note | Ý chính |
|---|---|
| [Soft delete & audit patterns](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) | 4 ý nghĩa của "xoá" · 4 vấn đề `deleted_at` tạo ra · soft delete **không** tuân thủ GDPR · 4 mức audit |
| [Full-stack triage](../05-cross-cutting/performance/07-full-stack-triage.md) | **playbook**, không lý thuyết · TTFB chia bài toán làm hai · bảng CPU × event loop lag · cây quyết định |
| [Scenario walkthroughs](../05-cross-cutting/scenarios/01-scenario-walkthroughs.md) | 5 tình huống, tự chẩn đoán trước · triệu chứng ≠ nguyên nhân |

### Navigation

| File | Vai |
|---|---|
| [Application Engineering Map](application-engineering-map.md) | **VIEW** — nhóm note theo problem, không phải nơi chứa kiến thức |
| Report này | kết quả phiên |

---

## Files modified — 10

| File | Thay đổi |
|---|---|
| [README.md](../README.md) | thêm 2 dòng folder mới · mục mới *"Tôi biết công nghệ rồi — xây application thật thì sao?"* |
| [00-roadmap/README.md](README.md) | thêm view thứ tư vào bảng tra cứu |
| [00-roadmap/04-topic-index.md](04-topic-index.md) | **regenerate** từ disk: 241 → 273 note |
| [00-roadmap/behavior-index.md](behavior-index.md) | thêm nhóm *"Tôi biết công nghệ nhưng không biết xây application"* (12 dòng) |
| [00-roadmap/knowledge-map.md](knowledge-map.md) | thêm `Data Access` vào xương sống runtime · 2 bảng tra cứu mới (data-access, MongoDB) |
| [01-web-frontend/README.md](../01-web-frontend/README.md) | 4 tầng → 5 tầng, giải thích tầng 5 là *application* không phải *công nghệ* |
| [02-backend-api/README.md](../02-backend-api/README.md) | 3 dòng vào bảng "bắt đầu ở đâu" · ghi rõ note 06–09 trả lời câu hỏi khác 01–05 |
| [02-backend-api/04-architecture/README.md](../02-backend-api/04-architecture/README.md) | mục mới *"Khi codebase đã lớn — bốn note về chi phí của trừu tượng"* |
| [03-database/README.md](../03-database/README.md) | 5 → 7 folder · 2 dòng bảng bắt đầu · **10 dòng** bảng chẩn đoán · version baseline |
| [05-cross-cutting/README.md](../05-cross-cutting/README.md) | thêm `scenarios/` với ghi chú nó không chứa khái niệm mới |

Không index nào được cập nhật bằng cách append một list dài — mỗi thay đổi giữ được cấu trúc điều hướng của file đó.

---

## Version-sensitive details verified

| Công nghệ | Baseline ghi trong note | Ghi chú |
|---|---|---|
| Prisma | **6.x**, PostgreSQL | `relationJoins` (`relationLoadStrategy`) và `typedSql` được ghi rõ là **preview**, kèm lời nhắc kiểm tra trạng thái GA cho version đang dùng |
| MongoDB | **7.x/8.x**, replica set | transaction cần replica set (4.0+ replica, 4.2+ sharded); `$lookup` sub-pipeline |
| PostgreSQL | **16** | `ADD COLUMN NOT NULL DEFAULT` không rewrite từ PG 11+ |
| TanStack Query | v5 API | `keepPreviousData` → `placeholderData`, `gcTime` (không phải `cacheTime`) |
| Next.js | **15**, App Router | đã ghi ở note Next.js hiện có; note mới cross-link, không lặp |
| NestJS | 10/11 | `experimentalDecorators: true` (TC39 decorators không emit metadata) |

Không note cũ nào bị viết lại chỉ vì docs đổi — behavior cũ vẫn đúng dưới version đã ghi.

---

## Validation

Chạy sau mỗi batch và lần cuối:

| Kiểm tra | Kết quả |
|---|---|
| **Internal markdown links** | **4.332 link, 12 broken** |
| Broken links **do phiên này** | **0** |
| Broken links pre-existing | 12 (10 = `project-roadmap.md` → `fullstack-lab/phases/` chưa tồn tại; 1 = placeholder trong `templates/topic-note.md`; 1 = link tới report này, giờ đã có) |
| Frontmatter `prerequisites`/`related` | mọi đường dẫn resolve |
| Orphan notes | 0 — mọi note mới được link từ README folder **và** ≥ 1 index |
| Code fences | chẵn ở toàn bộ 26 note mới |
| `<details>` cân bằng | 26/26 |
| Section structure | 13–14 section mỗi note (theo `templates/topic-note.md`) |
| Stub < 1KB | 0 |

Baseline broken-link **không tăng** — đúng yêu cầu.

Đường dẫn đã sửa trong lúc validate: 2 link trỏ sai sau lần restructure trước (`nodejs/production/01-graceful-shutdown` → `02-graceful-shutdown`; `kubernetes/operations/01-rollout-rollback` → `workloads-networking/03-rollout-rollback`).

---

## Remaining deliberate gaps

Những thứ **cố ý** không làm, và lý do:

| Gap | Lý do |
|---|---|
| **Ví dụ trong 24 note cũ chưa thống nhất cú pháp Prisma** | Bạn chọn "chốt Prisma làm mặc định, dạy nó tử tế" (không chọn phương án retrofit 24 file). Ví dụ cũ vẫn đúng về mặt khái niệm nhưng cú pháp hơi lệch nhau. Sửa được sau bằng một pass riêng. |
| `07-projects/fullstack-lab/phases/` — 10 file | TASK yêu cầu **không** implement lab trong phiên này. Đây là 10/12 broken link còn lại. |
| TypeORM / Drizzle chi tiết | [Note 01](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) so sánh ở mức pattern (ORM / query builder / raw SQL). Đi sâu từng thư viện là cheatsheet, không phải kiến thức chuyển giao được. |
| MongoDB Atlas Search, time-series collection, Change Streams | Tính năng chuyên biệt; nền tảng đã đủ để tự đọc docs khi cần. |
| GraphQL federation, Apollo Router | [Note 08](../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md) phủ trade-off; federation là chủ đề riêng, chỉ cần khi có nhiều team. |
| Event sourcing / CQRS | [Soft delete & audit](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) nhắc "audit mức 4"; đi sâu chỉ đáng khi domain thật sự cần. |
| Micro-frontend | Không thuộc lớp kiến thức này. |

---

## Commits

| Commit | Nội dung |
|---|---|
| `knowledge: add data-access and Prisma coverage` | Batch 1 — 7 note + README |
| `knowledge: add MongoDB learning track` | Batch 2 — 8 note + README |
| `knowledge: add real-world application engineering coverage` | Batch 3 — 11 note + 2 README + 10 index/README + report |

---

## Definition of Done — đối chiếu

19 câu hỏi trong TASK, và note trả lời:

| Câu hỏi | Note |
|---|---|
| ORM giải quyết vấn đề gì? | [DA 01](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) |
| ORM vs Query Builder vs Raw SQL chọn thế nào? | [DA 01](../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) — 7 tiêu chí |
| Prisma schema và client hoạt động ra sao? | [DA 02](../03-database/05-data-access/02-prisma-model-and-client.md) |
| N+1 trong Prisma xảy ra thế nào? | [DA 03](../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| Khi nào bypass Prisma bằng raw SQL? | [DA 06](../03-database/05-data-access/06-raw-sql-escape-hatches.md) |
| Có nên bọc Prisma trong repository? | [DA 07](../03-database/05-data-access/07-repository-pattern-testing.md) |
| MongoDB document model khác relational thế nào? | [Mongo 01](../03-database/06-mongodb/01-document-model.md) |
| Embed hay reference? | [Mongo 02](../03-database/06-mongodb/02-embed-vs-reference.md) |
| MongoDB hay PostgreSQL? | [Mongo 08](../03-database/06-mongodb/08-postgresql-vs-mongodb.md) |
| Một màn hình gọi 8 API thì tổ chức thế nào? | [AE 01](../01-web-frontend/04-application-engineering/01-multi-api-screen.md) |
| Request nào chạy parallel? | [AE 01](../01-web-frontend/04-application-engineering/01-multi-api-screen.md) — dependency graph |
| API mất 5 giây thì tối ưu UX ra sao? | [AE 03](../01-web-frontend/04-application-engineering/03-slow-api-ux.md) |
| Cache Browser / Next.js / TanStack / Redis khác nhau ở đâu? | [AE 02](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) — 5 lớp |
| Khi nào dùng BFF? | [Arch 09](../02-backend-api/04-architecture/09-bff-and-aggregation.md) |
| Service inject 15 dependency nói lên điều gì? | [Arch 08](../02-backend-api/04-architecture/08-service-decomposition.md) |
| SOLID áp dụng thực tế ra sao? | [Arch 06](../02-backend-api/04-architecture/06-solid-in-practice.md) |
| Clean Architecture khi nào hữu ích / over-engineering? | [Arch 07](../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md) |
| Hệ thống chậm thì debug theo thứ tự nào? | [Full-stack triage](../05-cross-cutting/performance/07-full-stack-triage.md) |
| Khi nào dùng TanStack Query? | [AE 02](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) + [Server state](../01-web-frontend/02-react/behavior/04-server-state-cache.md) |

---

## Bốn nguyên tắc xuyên suốt lớp kiến thức này

Rút ra từ 26 note, và chúng lặp lại ở mọi tầng:

1. **Đo trước khi sửa.** Trong cả 5 scenario, phép đo đầu tiên đổi hoàn toàn hướng giải quyết.
2. **Triệu chứng ≠ nguyên nhân.** "8 API chậm" thật ra là payload; "Prisma chậm" thật ra là thiếu index trên khoá ngoại; "15 dependency" thật ra là side effect coupling.
3. **Câu hỏi nghiệp vụ đi trước câu hỏi kỹ thuật.** *"Dữ liệu cũ 5 phút có được không?"* rẻ hơn mọi tối ưu query.
4. **Công cụ không thay thế hiểu biết.** ORM không thay kiến thức index; cache không thay kiến thức về nút thắt; BFF không thay kiến thức về timeout.

---

## Next step

```text
07-projects/fullstack-lab/
```

Đây là bước tiếp theo, và nó cũng giải quyết 10/12 broken link còn lại.

Theo TASK: **không mở thêm vòng restructure hay knowledge expansion lớn** nếu không xuất hiện gap từ chính quá trình làm lab. Gap tìm được khi build thật đáng tin hơn gap tìm được khi audit.

## Related

- [Application Engineering Map](application-engineering-map.md) — view theo problem
- [Knowledge Audit](knowledge-audit.md) — audit ban đầu của repo
- [Final Coverage Report](final-coverage-report.md) — báo cáo phiên trước
- [Knowledge Architecture Final Report](knowledge-architecture-final-report.md) — phiên restructure
- [Project Roadmap](project-roadmap.md) — bước tiếp theo
