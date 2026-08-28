---
level: advanced
area: database
---

# PostgreSQL

SQL là ngôn ngữ. PostgreSQL là **một cỗ máy có hành vi cụ thể**, và gần như mọi sự cố database ở production đều đến từ việc không biết một trong bốn hành vi sau:

```text
① MVCC       UPDATE tạo dòng mới; dòng cũ tồn tại cho tới khi vacuum dọn
② KHOÁ       hàng đợi khoá là FIFO — một DDL đang chờ chặn mọi query đến sau
③ PLANNER    bạn không ra lệnh cách chạy; bạn cho nó lựa chọn và thông tin
④ CONNECTION mỗi connection là một process, và pool lớn hơn không nhanh hơn
```

Bốn dòng đó giải thích: bảng phình không rõ lý do, migration làm sập app, index thêm vào mà không được dùng, và "app chậm nhưng DB rảnh".

## Cấu trúc

```text
fundamentals/               kiến trúc process, ACID, kiểu dữ liệu, connection pool
transactions-concurrency/   isolation, MVCC, lock, deadlock
indexes-query-planning/     index, planner, EXPLAIN
operations/                 WAL, backup, replication
```

## Thứ tự đọc

### Bước 0 — nền

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0a | [Kiến trúc & ACID](./fundamentals/01-architecture-and-acid.md) | Vì sao kết nối đắt? ACID đảm bảo gì và KHÔNG đảm bảo gì? |
| 0b | [Connection pool](./fundamentals/02-connection-pool.md) | Bao nhiêu kết nối là đủ, và vì sao tăng `max_connections` không giúp? |

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Transaction isolation](./transactions-concurrency/01-transaction-isolation.md) | Vì sao bán 103 vé khi chỉ có 100? |
| 2 | [Index & query plan](./indexes-query-planning/01-index-query-plan.md) | Vì sao thêm index mà query vẫn chậm? |
| 3 | [Connection pool](./fundamentals/02-connection-pool.md) | Vì sao scale app lên 20 pod làm mọi thứ chậm hơn? |
| 4 | [MVCC & vacuum](./transactions-concurrency/02-mvcc-vacuum.md) | Vì sao bảng 40k dòng chiếm 28 GB? |
| 5 | [Locking & deadlock](./transactions-concurrency/03-locking-deadlock.md) | Vì sao `ADD COLUMN` 2ms làm app dừng 40 giây? |
| 6 | [WAL, durability & backup](./operations/01-wal-durability-backup.md) | Mất điện thì mất gì? Khôi phục về 14:36 được không? |
| 7 | [Index types](./indexes-query-planning/02-index-types.md) | Vì sao `LIKE '%x%'` không dùng được index nào? |
| 8 | [EXPLAIN ANALYZE workflow](./indexes-query-planning/03-explain-analyze-workflow.md) | Quy trình từ "chậm" tới "đã sửa và chứng minh được" |
| 9 | [Replication & scaling](./operations/02-replication-scaling.md) | Vì sao tạo xong rồi mở ra lại 404? |

Note 1, 2, 4 là nền. Note 8 là note bạn sẽ mở lại nhiều nhất.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Bán/đặt quá số lượng cho phép | `SELECT` rồi `UPDATE` → [1](./transactions-concurrency/01-transaction-isolation.md) |
| Dữ liệu trùng dù đã kiểm tra tồn tại | thiếu unique constraint → [1](./transactions-concurrency/01-transaction-isolation.md) |
| 500 ngẫu nhiên chỉ khi tải cao | deadlock `40P01` / serialization `40001` → [5](./transactions-concurrency/03-locking-deadlock.md) · [1](./transactions-concurrency/01-transaction-isolation.md) |
| Query chậm dần theo thời gian | bloat, hoặc thống kê cũ → [4](./transactions-concurrency/02-mvcc-vacuum.md) · [8](./indexes-query-planning/03-explain-analyze-workflow.md) |
| Bảng lớn hơn nhiều so với số dòng | bloat; vacuum bị chặn → [4](./transactions-concurrency/02-mvcc-vacuum.md) |
| `DELETE` xong dung lượng không giảm | MVCC + `VACUUM` không trả về OS → [4](./transactions-concurrency/02-mvcc-vacuum.md) |
| Đĩa đầy vì `pg_wal` | slot bỏ quên hoặc archive fail → [6](./operations/01-wal-durability-backup.md) |
| `too many clients already` | instance × pool > `max_connections` → [3](./fundamentals/02-connection-pool.md) |
| App chậm nhưng DB rảnh | pool cạn; network call trong transaction → [3](./fundamentals/02-connection-pool.md) |
| Scale app lên nhiều pod làm chậm hơn | quá nhiều connection tranh CPU → [3](./fundamentals/02-connection-pool.md) |
| Migration làm sập toàn bộ app | khoá dây chuyền FIFO → [5](./transactions-concurrency/03-locking-deadlock.md) |
| `SELECT` bị treo không rõ lý do | có DDL đang chờ khoá → [5](./transactions-concurrency/03-locking-deadlock.md) |
| Thêm index nhưng vẫn Seq Scan | không sargable / sai tiền tố / thống kê / quá nhiều dòng → [2](./indexes-query-planning/01-index-query-plan.md) |
| `LIKE '%x%'` chậm dù có index | cần trigram, không phải B-tree → [7](./indexes-query-planning/02-index-types.md) |
| Nhanh ở psql, chậm từ app | generic plan của prepared statement → [8](./indexes-query-planning/03-explain-analyze-workflow.md) |
| `rows` lệch xa `actual rows` | thống kê cũ → `ANALYZE` → [8](./indexes-query-planning/03-explain-analyze-workflow.md) |
| Tạo xong rồi đọc lại thấy 404 | replication lag → [9](./operations/02-replication-scaling.md) |
| Sau failover mất một ít dữ liệu | async replication → [9](./operations/02-replication-scaling.md) |
| Khôi phục sau xoá nhầm không được | không có PITR → [6](./operations/01-wal-durability-backup.md) |

## Bốn câu lệnh chẩn đoán

Bốn câu này trả lời phần lớn câu hỏi "chuyện gì đang xảy ra":

```sql
-- ① Ai đang làm gì, ai chờ ai
SELECT pid, application_name, state, now() - xact_start AS xact_age,
       wait_event_type, pg_blocking_pids(pid) AS blocked_by, left(query, 60)
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY xact_age DESC NULLS LAST;

-- ② Bảng nào bloat, vacuum có chạy không
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 10;

-- ③ Query nào tốn tài nguyên nhất (theo TỔNG, không theo trung bình)
SELECT calls, round(mean_exec_time::numeric, 2) AS avg_ms,
       round(total_exec_time::numeric) AS total_ms, left(query, 80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- ④ Index nào chưa bao giờ được dùng
SELECT relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10;
```

## Mười cấu hình đáng có ngay từ đầu

```ini
# Phòng thủ — chặn cả một lớp sự cố
statement_timeout = 30s                        # query treo không giữ tài nguyên mãi
idle_in_transaction_session_timeout = 60s      # transaction bị bỏ quên → chặn vacuum
lock_timeout = 3s                              # đặt trong session migration, không toàn cục

# Quan sát — không có thì debug bằng đoán
shared_preload_libraries = 'pg_stat_statements,auto_explain'
auto_explain.log_min_duration = '1s'
log_min_duration_statement = 1000
log_lock_waits = on

# Vacuum — mặc định không đủ cho bảng lớn
ALTER TABLE <bảng lớn> SET (autovacuum_vacuum_scale_factor = 0.02);

# Bền vững — đừng động vào trừ khi hiểu rõ
fsync = on                                     # KHÔNG BAO GIỜ tắt ở production
max_slot_wal_keep_size = '50GB'                # slot hỏng không làm đầy đĩa
```

Và một dòng ở phía ứng dụng có giá trị chẩn đoán rất cao:

```ts
new Pool({ application_name: 'api' })   // 'worker', 'cron', 'migration'...
```

## Sáu hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| Transaction làm code an toàn với concurrency | Nó cho nguyên tử; isolation là chuyện khác | [1](./transactions-concurrency/01-transaction-isolation.md) |
| Pool lớn hơn xử lý được nhiều hơn | Sau một ngưỡng, throughput **giảm** | [3](./fundamentals/02-connection-pool.md) |
| `DELETE` giải phóng dung lượng | Cần vacuum, và vacuum không trả về OS | [4](./transactions-concurrency/02-mvcc-vacuum.md) |
| `SELECT` không bao giờ bị chặn | Bị chặn bởi hàng đợi khoá FIFO | [5](./transactions-concurrency/03-locking-deadlock.md) |
| Replica là backup | Nó replicate cả `DROP TABLE` | [6](./operations/01-wal-durability-backup.md) · [9](./operations/02-replication-scaling.md) |
| Thêm index thì nhanh hơn | Chỉ khi planner dùng được **và** chọn dùng | [2](./indexes-query-planning/01-index-query-plan.md) |

## Position

```text
NestJS → Repository → SQL → PostgreSQL (planner, MVCC, lock, WAL) → OS → disk
                             ↑ folder này
```

## Related

- [00-sql/](../00-sql/README.md) — ngôn ngữ SQL, đọc trước
- [03-data-modeling/](../03-data-modeling/README.md) — schema, constraint, migration
- [02-redis/](../02-redis/README.md) — giảm tải đọc bằng cache
- [04-message-queues/](../04-message-queues/README.md) — chuyển việc nặng ra khỏi đường request
- [Database & transactions (NestJS)](../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) — phía ứng dụng
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — đo ở tầng hệ thống
- [Concurrency](../../05-cross-cutting/concurrency/README.md) — cùng họ vấn đề ở tầng khác
- [Storage & StatefulSet](../../04-infrastructure/04-kubernetes/workloads-networking/04-storage-statefulset.md) — chạy PostgreSQL ở đâu

## Version / Context

Toàn bộ folder viết cho **PostgreSQL 16**. Hành vi vacuum, planner và replication thay đổi giữa các major version — mỗi note ghi rõ tính năng nào cần version nào ở phần cuối.
