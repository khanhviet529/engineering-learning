---
level: intermediate
area: database
---

# Database

Tầng nơi dữ liệu **tồn tại lâu hơn process của bạn**. Đó là câu nói đơn giản nhất về vì sao tầng này khác mọi tầng khác: một bug ở frontend biến mất khi F5; một bug ở đây để lại dấu vết vĩnh viễn trong dữ liệu.

Bảy folder, theo thứ tự phụ thuộc:

```text
00-sql            ngôn ngữ: tập hợp, JOIN, NULL, cardinality
01-postgresql     cỗ máy: MVCC, index, planner, khoá, WAL
03-data-modeling  thiết kế: constraint, chuẩn hoá, quan hệ, migration, soft delete
05-data-access    app ↔ DB: ORM vs QB vs raw SQL, Prisma, N+1, repository
02-redis          lớp tăng tốc: cache, lock, eviction, persistence
04-message-queues hạ tầng bất đồng bộ: delivery, retry, outbox
06-mongodb        mô hình khác: document, embed/reference, và PostgreSQL vs MongoDB
```

## Bắt đầu ở đâu

| Bạn đang | Vào |
|---|---|
| Chưa quen viết SQL, hay bị sai số liệu | [00-sql/](./00-sql/README.md) |
| Query chậm, bảng phình, migration làm sập app | [01-postgresql/](./01-postgresql/README.md) |
| Sắp thiết kế schema, hoặc schema đang gây đau | [03-data-modeling/](./03-data-modeling/README.md) |
| Dùng Prisma/ORM, gặp N+1, không rõ có cần repository | [05-data-access/](./05-data-access/README.md) |
| Cần giảm tải đọc, hoặc đang gặp dữ liệu cũ | [02-redis/](./02-redis/README.md) |
| Cần chuyển việc nặng ra khỏi đường request | [04-message-queues/](./04-message-queues/README.md) |
| Đang cân nhắc MongoDB, hoặc đã dùng nó | [06-mongodb/](./06-mongodb/README.md) |

Thứ tự học mặc định: `00 → 01 → 03 → 05`, rồi `02` và `04` khi có nhu cầu thật. `06` khi thật sự đứng trước quyết định chọn database — và [note so sánh](./06-mongodb/08-postgresql-vs-mongodb.md) nên đọc **trước** khi quyết định, không phải sau.

Lưu ý về `05-data-access`: nó nằm trong `03-database/` chứ không phải `02-backend-api/` vì đây là chủ đề **database**, chỉ tình cờ được viết bằng TypeScript. Ba câu chốt của nó — ORM không loại bỏ SQL, không tự tạo query tốt, không thay thế kiến thức database — là lý do nó phải nằm cạnh PostgreSQL.

## Bốn ý tưởng xuyên suốt cả tầng

```text
① MỖI BẢN SAO SẼ LỆCH
   Cache, replica, cột denormalized, projection — tất cả là bản sao,
   và tất cả sẽ lệch với nguồn sự thật. Câu hỏi không phải "có lệch không"
   mà là "lệch bao lâu, và bạn phát hiện bằng cách nào".

② KIỂM TRA RỒI GHI KHÔNG AN TOÀN
   SELECT-rồi-INSERT, GET-rồi-SET, đọc-rồi-cập-nhật — mọi cặp thao tác
   tách rời đều có khe hở cho concurrency.
   Cách sửa luôn giống nhau: làm nó NGUYÊN TỬ, hoặc để DB ép bằng constraint.

③ RANH GIỚI TRANSACTION LÀ RANH GIỚI ĐÚNG ĐẮN
   Trong transaction: nguyên tử. Ngoài: không.
   Email, HTTP call, publish sự kiện đều nằm NGOÀI — đó là gốc của outbox.

④ ĐO TRƯỚC KHI TỐI ƯU
   Thêm index, thêm cache, thêm queue đều có chi phí thường trực.
   `EXPLAIN ANALYZE` và hit rate trả lời được; trực giác thì không.
```

## Bảng chẩn đoán liên tầng

| Triệu chứng | Nghi ngờ đầu tiên | Note |
|---|---|---|
| Báo cáo ra số lớn gấp N lần | fan-out từ JOIN 1:N | [SQL 02](./00-sql/02-joins-aggregation.md) |
| Query trả về 0 dòng, luôn luôn | `NOT IN` với NULL | [SQL 03](./00-sql/03-subqueries-cte.md) |
| Dữ liệu trùng dù code đã kiểm tra | thiếu unique constraint | [Modeling 01](./03-data-modeling/01-constraints-invariants.md) |
| Bán quá số lượng cho phép | `SELECT` rồi `UPDATE` | [PG 01](./01-postgresql/transactions-concurrency/01-transaction-isolation.md) |
| Query chậm dần theo tháng | bloat hoặc thống kê cũ | [PG 04](./01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) · [PG 08](./01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) |
| Bảng 40k dòng chiếm 28 GB | transaction dài chặn vacuum | [PG 04](./01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |
| Migration làm sập toàn bộ app | thiếu `lock_timeout` | [Modeling 04](./03-data-modeling/04-migrations.md) |
| App chậm nhưng DB rảnh | pool cạn; network call trong transaction | [PG 03](./01-postgresql/fundamentals/02-connection-pool.md) |
| Scale app lên 20 pod làm chậm hơn | quá nhiều connection | [PG 03](./01-postgresql/fundamentals/02-connection-pool.md) |
| Tạo xong đọc lại thấy 404 | replication lag | [PG 09](./01-postgresql/operations/02-replication-scaling.md) |
| Dữ liệu "lúc cũ lúc mới" khi F5 | cache in-memory nhiều replica | [Redis 01](./02-redis/01-cache-invalidation.md) |
| Người dùng thấy dữ liệu của người khác | cache key thiếu chiều | [Redis 01](./02-redis/01-cache-invalidation.md) |
| Lock của cron job biến mất | eviction trên instance dùng chung | [Redis 04](./02-redis/04-eviction-memory.md) |
| Deploy Redis làm đăng xuất hàng loạt | session không persistence | [Redis 05](./02-redis/05-persistence-failure.md) |
| Email gửi hai lần | job không idempotent | [MQ 02](./04-message-queues/02-delivery-semantics.md) |
| Đơn hàng tồn tại, không sự kiện nào | dual-write, thiếu outbox | [MQ 06](./04-message-queues/06-outbox-pattern.md) |
| Endpoint chậm tuyến tính theo số dòng | N+1 (vòng lặp `await`, không phải `include`) | [DA 03](./05-data-access/03-prisma-relations-and-n-plus-1.md) |
| `P2024` pool timeout | transaction dài, hoặc `Promise.all` không giới hạn | [DA 04](./05-data-access/04-prisma-transactions.md) |
| Compile sạch mà runtime báo `column does not exist` | schema Prisma lệch database | [DA 02](./05-data-access/02-prisma-model-and-client.md) |
| `Do not know how to serialize a BigInt` | `COUNT(*)` từ raw SQL | [DA 06](./05-data-access/06-raw-sql-escape-hatches.md) |
| Xoá mềm rồi không đăng ký lại được email | unique index thiếu `partialFilterExpression` | [Modeling 05](./03-data-modeling/05-soft-delete-audit-patterns.md) |
| User đã "xoá" vẫn đăng nhập được | query thiếu lọc `deleted_at IS NULL` | [Modeling 05](./03-data-modeling/05-soft-delete-audit-patterns.md) |
| `BSONObjectTooLarge` | array không có trần | [Mongo 02](./06-mongodb/02-embed-vs-reference.md) |
| Aggregation chậm gấp nghìn lần | `$lookup`/`$unwind` đặt trước `$match` | [Mongo 05](./06-mongodb/05-aggregation-pipeline.md) |
| MongoDB: ghi mất sau failover | `w: 1` thay vì `w: "majority"` | [Mongo 06](./06-mongodb/06-transactions-consistency.md) |

Nếu triệu chứng không có ở đây: bắt đầu bằng `EXPLAIN (ANALYZE, BUFFERS)` và `pg_stat_activity`.

## Ba câu lệnh đáng chạy hôm nay

Trên production, ngay bây giờ. Kết quả thường gây bất ngờ:

```sql
-- ① Có transaction nào bị bỏ quên không? (chặn vacuum, giữ connection, giữ khoá)
SELECT pid, application_name, state, now() - xact_start AS age, left(query, 60)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL AND now() - xact_start > interval '1 minute'
ORDER BY age DESC;

-- ② Bảng nào đang bloat, vacuum có chạy không?
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables WHERE n_dead_tup > 10000 ORDER BY n_dead_tup DESC LIMIT 10;

-- ③ Có dữ liệu mồ côi không? (thay bằng bảng của bạn)
SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;
```

## Bảy quyết định định hình cả hệ thống

Rẻ khi làm từ đầu, đắt khi thêm vào sau:

```text
1. Constraint từ migration đầu tiên       → dữ liệu xấu không tích luỹ được
2. Index mọi cột FK                        → PostgreSQL không tự làm
3. statement_timeout + idle_in_transaction_session_timeout
4. pg_stat_statements bật từ ngày đầu      → không có nó, tối ưu là đoán
5. lock_timeout ở đầu mọi migration        → migration fail còn hơn app dừng
6. Cache key có tenant/user, luôn có TTL   → chống rò rỉ và stale vĩnh viễn
7. Outbox cho sự kiện quan trọng           → ghi DB và publish không nguyên tử
```

## Position

```text
NestJS → Repository → [Cache / Queue] → PostgreSQL → OS → disk
                       ↑ folder này (toàn bộ)
```

## Related

- [02-backend-api/](../02-backend-api/README.md) — tầng gọi vào đây
- [Database & transactions (NestJS)](../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) — ranh giới transaction ở tầng ứng dụng
- [Domain logic boundaries](../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — mô hình dữ liệu vs mô hình domain
- [Concurrency](../05-cross-cutting/concurrency/README.md) — cùng họ vấn đề ở tầng khác
- [Database performance](../05-cross-cutting/performance/04-database-performance.md) — đo ở tầng hệ thống
- [Storage & StatefulSet](../04-infrastructure/04-kubernetes/workloads-networking/04-storage-statefulset.md) — chạy database ở đâu
- [Consistency & availability](../06-system-design/04-consistency-availability.md) — replica, CAP
- [Scaling, cache & queue](../06-system-design/02-scaling-cache-queue.md) — ba tầng này ở quy mô hệ thống

## Version / Context

**PostgreSQL 16**, **Redis 7**, BullMQ 5, **Prisma 6.x**, **MongoDB 7.x/8.x**. Lý thuyết quan hệ và các khái niệm queue là chung; cú pháp và hành vi cụ thể là đặc thù từng engine — mỗi note ghi rõ ở phần cuối. Tính năng Prisma còn ở trạng thái preview (`relationJoins`, `typedSql`) được đánh dấu tại chỗ.
