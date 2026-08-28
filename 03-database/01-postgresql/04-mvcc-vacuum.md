---
level: advanced
area: database
prerequisites:
  - 01-transaction-isolation.md
related:
  - 05-locking-deadlock.md
  - 03-connection-pool.md
  - 06-wal-durability-backup.md
---

# MVCC & vacuum

> Bảng `sessions` có 40.000 dòng. `pg_total_relation_size` báo **28 GB**. Bạn chạy `DELETE FROM sessions WHERE expired` mỗi đêm và nó xoá hàng triệu dòng. Dung lượng không giảm — nó **tăng**. Và query trên bảng đó ngày càng chậm dù index vẫn đúng.

## Position

```text
Transaction  →  MVCC: mỗi UPDATE/DELETE tạo VERSION mới, giữ version cũ
                   ↓
                dead tuple tích lại
                   ↓
                VACUUM đánh dấu chỗ trống để tái sử dụng
                   ↓
                Storage: page 8 KB
```

MVCC là lý do PostgreSQL đọc không chặn ghi và ghi không chặn đọc. Vacuum là cái giá phải trả cho điều đó. Không hiểu cặp này thì bảng phình, query chậm dần, và không có cách nào giải thích được.

## Problem

Hai transaction cùng lúc: A đọc dòng X, B sửa dòng X. Có ba cách xử lý:

```text
1. B chờ A đọc xong          → đọc chặn ghi. Kinh khủng cho hệ thống nhiều đọc.
2. A chờ B ghi xong          → ghi chặn đọc. Cũng kinh khủng.
3. A đọc BẢN CŨ, B ghi BẢN MỚI  → không ai chờ ai.   ← MVCC
```

PostgreSQL chọn (3), và cái giá là:

```text
UPDATE không sửa tại chỗ. Nó:
  1. ghi một dòng MỚI với dữ liệu mới
  2. đánh dấu dòng CŨ là "đã chết từ transaction N"
  3. cập nhật MỌI index để trỏ tới dòng mới

⇒ UPDATE ≈ INSERT + DELETE về chi phí lưu trữ
⇒ dòng cũ vẫn chiếm chỗ cho tới khi VACUUM dọn
```

Từ đó ra ba hệ quả mà mọi người dùng PostgreSQL đều gặp:

```text
1. DELETE không giải phóng dung lượng ngay
2. UPDATE nhiều làm bảng phình (bloat)
3. Một transaction mở lâu NGĂN vacuum dọn — của TOÀN BỘ database
```

Điểm 3 là nguyên nhân của sự cố ở đầu note.

## Mental Model

### Mỗi dòng có hai cột ẩn

```text
xmin — transaction id đã TẠO ra version này
xmax — transaction id đã XOÁ/thay thế version này (0 nếu còn sống)
```

```sql
SELECT xmin, xmax, id, name FROM users WHERE id = 1;
```

Một transaction thấy một version nếu:

```text
xmin đã commit VÀ xmin <= snapshot của tôi
   VÀ (xmax = 0  HOẶC  xmax chưa commit  HOẶC  xmax > snapshot của tôi)
```

Diễn đạt bằng lời: *"version này được tạo trước khi tôi bắt đầu, và chưa bị xoá tại thời điểm tôi bắt đầu."*

```text
Lịch sử của một dòng:
  v1 (xmin=100, xmax=205)   ← UPDATE ở transaction 205 làm nó chết
  v2 (xmin=205, xmax=0)     ← version hiện tại

Transaction 150 (bắt đầu trước 205) vẫn thấy v1.
Transaction 300 thấy v2.
v1 KHÔNG THỂ bị dọn cho tới khi không còn transaction nào có thể thấy nó.
```

Dòng cuối là toàn bộ vấn đề: **một transaction mở từ 3 giờ trước giữ cho mọi version cũ hơn nó không bị dọn — trên mọi bảng.**

### Ba mức dọn dẹp

```text
VACUUM              đánh dấu dead tuple là chỗ trống TÁI SỬ DỤNG ĐƯỢC
                    · KHÔNG trả dung lượng về OS (trừ chỗ trống ở cuối file)
                    · KHÔNG khoá bảng — chạy song song với traffic
                    · autovacuum làm việc này tự động

VACUUM FULL         viết lại toàn bộ bảng, trả dung lượng về OS
                    · KHOÁ ĐỘC QUYỀN — bảng không đọc/ghi được
                    · cần thêm dung lượng bằng kích thước bảng
                    · KHÔNG dùng ở production giờ cao điểm

pg_repack           như VACUUM FULL nhưng gần như không khoá
                    · extension, phải cài
                    · cần thêm dung lượng
```

Sai lầm phổ biến: thấy bảng phình rồi chạy `VACUUM FULL` trên production lúc 10 giờ sáng. Bảng 50 GB có thể khoá 20 phút.

### Bloat: vì sao bảng phình và query chậm

```text
Page 8 KB, ban đầu 50 dòng:
[d1][d2][d3]...[d50]

Sau 10 lần UPDATE mỗi dòng, chưa vacuum:
[dead][dead][dead]...[d1'][d2']...   ← 500 dead tuple, 50 dòng sống

Hệ quả:
  · Seq Scan đọc gấp 10 lần số page
  · Index lớn hơn (mỗi version có entry riêng)
  · shared_buffers chứa được ít dữ liệu THẬT hơn
  · thống kê lệch → planner chọn sai
```

Đo bloat:

```sql
SELECT relname,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       pg_size_pretty(pg_total_relation_size(relid)) AS size,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

`dead_pct > 20%` liên tục là dấu hiệu autovacuum không theo kịp.

### Autovacuum: vì sao nó "không chạy"

Ngưỡng mặc định:

```text
autovacuum_vacuum_threshold        = 50
autovacuum_vacuum_scale_factor     = 0.2       ← 20%!

⇒ chạy khi dead tuple > 50 + 0.2 × số dòng
```

Với bảng 50 triệu dòng, đó là **10 triệu dead tuple** trước khi autovacuum động tay. Đây là lý do mặc định không phù hợp cho bảng lớn:

```sql
-- bảng lớn, cập nhật nhiều: giảm scale factor
ALTER TABLE events SET (
  autovacuum_vacuum_scale_factor = 0.02,       -- 2% thay vì 20%
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2             -- vacuum nhanh hơn (mặc định 2ms ở PG12+)
);
```

Bốn lý do autovacuum không dọn được, theo thứ tự tần suất:

```text
1. Transaction mở lâu       — giữ snapshot, version cũ hơn nó KHÔNG được dọn
2. Replication slot bỏ quên — slot không active giữ WAL và giữ xmin
3. Prepared transaction bị bỏ (2PC) — cùng hiệu ứng, và rất dễ quên
4. Autovacuum bị bóp        — cost_delay cao, quá ít worker, hoặc bị tắt
```

Tìm thủ phạm của cả bốn trong một câu lệnh:

```sql
SELECT 'backend' AS src, pid::text, now() - xact_start AS age, left(query, 50) AS info
FROM pg_stat_activity WHERE xact_start IS NOT NULL
UNION ALL
SELECT 'repl_slot', slot_name, NULL, active::text FROM pg_replication_slots WHERE NOT active
UNION ALL
SELECT 'prepared_xact', gid, now() - prepared, NULL FROM pg_prepared_xacts
ORDER BY age DESC NULLS LAST;
```

### Transaction ID wraparound: chế độ hỏng nghiêm trọng nhất

Transaction ID là số 32 bit → khoảng 4 tỉ, và nó **quay vòng**. PostgreSQL dùng phép so sánh modulo, nên "quá khứ" chỉ là 2 tỉ transaction gần nhất. Nếu một dòng có `xmin` cũ hơn 2 tỉ transaction, nó sẽ **đột nhiên trông như đến từ tương lai** và biến mất.

Để tránh, vacuum "đóng băng" (freeze) các dòng cũ. Nếu vacuum không chạy được đủ lâu:

```text
WARNING: database "app" must be vacuumed within 10000000 transactions
...
ERROR: database is not accepting commands to avoid wraparound data loss
        in database "app"
```

Ở trạng thái này database **từ chối mọi ghi** cho tới khi bạn vacuum xong — và vacuum một database khổng lồ chưa từng được vacuum có thể mất nhiều giờ. Đây là một trong số ít sự cố PostgreSQL gây downtime dài.

Theo dõi:

```sql
SELECT datname, age(datfrozenxid) AS xid_age,
       round(100.0 * age(datfrozenxid) / 2000000000, 1) AS pct_to_wraparound
FROM pg_database ORDER BY xid_age DESC;
```

`age > 1 tỉ` là lúc phải hành động; `> 1,5 tỉ` là khẩn cấp.

Nguyên nhân gần như luôn là một trong bốn lý do ở trên — đặc biệt là replication slot bị bỏ quên.

### HOT update: cách tránh bloat ở index

```text
UPDATE thường:  dòng mới ở page khác → MỌI index phải cập nhật
HOT update:     dòng mới ở CÙNG page và KHÔNG cột nào có index bị đổi
                → index vẫn trỏ tới dòng cũ, có một con trỏ nội bộ tới dòng mới
                → KHÔNG cập nhật index nào
```

Hai điều kiện để có HOT update, và cả hai đều nằm trong tầm kiểm soát của bạn:

```sql
-- 1. Chừa chỗ trống trong page để dòng mới nằm cùng page
ALTER TABLE sessions SET (fillfactor = 80);   -- mặc định 100 (không chừa chỗ)

-- 2. Đừng index cột bị cập nhật thường xuyên
DROP INDEX idx_sessions_last_seen_at;         -- cột này update mỗi request
```

Đo tỉ lệ HOT:

```sql
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables WHERE n_tup_upd > 1000 ORDER BY n_tup_upd DESC;
```

`hot_pct` thấp trên bảng cập nhật nhiều là cơ hội tối ưu rất lớn: tăng `fillfactor` và bỏ index thừa có thể giảm bloat hàng chục lần.

## Example

Chẩn đoán bảng `sessions` 28 GB ở đầu note:

```sql
-- 1. Xác nhận bloat
SELECT n_live_tup, n_dead_tup, last_autovacuum, last_vacuum
FROM pg_stat_user_tables WHERE relname = 'sessions';
--  n_live_tup: 40.000 | n_dead_tup: 89.000.000 | last_autovacuum: NULL   ← chưa bao giờ chạy

-- 2. Vì sao autovacuum không chạy — kiểm tra cả bốn nguyên nhân
SELECT pid, now() - xact_start AS age, state, left(query, 60)
FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY age DESC LIMIT 5;
--  pid 1234 | 6 days 04:12:33 | idle in transaction | BEGIN     ← thủ phạm

SELECT slot_name, active, pg_size_pretty(
         pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;

-- 3. Xử lý
SELECT pg_terminate_backend(1234);
VACUUM (VERBOSE, ANALYZE) sessions;      -- giờ mới dọn được

-- 4. Trả dung lượng về OS (chọn một)
--    pg_repack -t sessions      → gần như không khoá, cần extension
--    VACUUM FULL sessions       → khoá độc quyền, chỉ trong cửa sổ bảo trì

-- 5. Phòng ngừa
ALTER TABLE sessions SET (autovacuum_vacuum_scale_factor = 0.02, fillfactor = 85);
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
SELECT pg_reload_conf();

-- 6. Với dữ liệu dạng chuỗi thời gian, cân nhắc partition + DROP thay vì DELETE
```

Bước 6 là giải pháp gốc: xoá hàng triệu dòng mỗi đêm sẽ luôn tạo bloat. `DROP TABLE` một partition cũ là **tức thì** và không tạo dead tuple nào.

## Prediction

1. `UPDATE users SET name = 'x' WHERE id = 1` — bao nhiêu version của dòng đó tồn tại ngay sau đó?
2. `DELETE FROM logs WHERE created_at < '2025-01-01'` xoá 10 triệu dòng — dung lượng bảng thay đổi thế nào ngay sau đó?
3. Sau `VACUUM` — dung lượng trả về OS chưa?
4. Sau `VACUUM FULL` — dung lượng? Bảng có đọc được trong lúc chạy không?
5. Một transaction `BEGIN` rồi để im 6 ngày — vacuum dọn được dead tuple sinh ra trong 6 ngày đó không? Ở bảng nào?
6. Replication slot của một replica đã bị xoá nhưng slot còn — hai hậu quả?
7. Bảng 50 triệu dòng, autovacuum mặc định — cần bao nhiêu dead tuple để nó chạy?
8. Bảng có 6 index, `UPDATE` một cột **không** được index, `fillfactor = 100` — bao nhiêu index phải cập nhật?
9. Cùng bảng, `fillfactor = 80` và có chỗ trống trong page — bao nhiêu index?
10. `age(datfrozenxid)` đạt 2 tỉ — chuyện gì xảy ra với ứng dụng?
11. Bảng bloat 90%, index vẫn đúng — query nhanh hay chậm hơn? Vì sao?
12. Chạy `VACUUM FULL` trên bảng 50 GB lúc cao điểm — ảnh hưởng?

<details>
<summary>Đáp án</summary>

1. **Hai** — version cũ (`xmax` đặt) và version mới. Cũ tồn tại cho tới khi vacuum dọn.
2. **Không đổi** (hoặc tăng chút vì WAL). Dòng chỉ được đánh dấu chết.
3. **Chưa** — `VACUUM` đánh dấu chỗ trống để tái sử dụng, không trả về OS (trừ chỗ trống liên tục ở cuối file).
4. Trả về OS. Bảng **không đọc/ghi được** trong suốt thời gian chạy (`ACCESS EXCLUSIVE`).
5. **Không dọn được** — và điều này áp dụng cho **mọi bảng trong database**, không chỉ bảng mà transaction đó chạm.
6. (a) WAL tích lại vô hạn → đầy đĩa. (b) `xmin` bị giữ → vacuum không dọn được → bloat + rủi ro wraparound.
7. 50 + 0,2 × 50.000.000 = **10.000.050** dead tuple.
8. **0** — nếu là HOT update. Nhưng với `fillfactor = 100` thường không còn chỗ trong page → không HOT → **6 index** phải cập nhật.
9. **0** — HOT update.
10. Database **từ chối mọi ghi**: `database is not accepting commands to avoid wraparound data loss`. Chỉ phục hồi bằng vacuum, có thể mất nhiều giờ.
11. **Chậm hơn** — nhiều page hơn phải đọc, cache chứa ít dữ liệu thật hơn, thống kê lệch.
12. Khoá độc quyền: mọi đọc và ghi vào bảng đó dừng. Với 50 GB có thể là 10–30 phút. Đó là một sự cố tự gây ra.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `UPDATE` 100k dòng 20 lần, xem `pg_total_relation_size` | Bảng phình dù số dòng không đổi |
| `VACUUM VERBOSE`, xem lại kích thước | Không giảm, nhưng `n_dead_tup` về 0 |
| `VACUUM FULL`, xem lại | Giảm mạnh |
| `BEGIN` ở psql, để mở, rồi `UPDATE` nhiều ở session khác, rồi `VACUUM` | Dead tuple không giảm |
| `COMMIT` transaction kia rồi `VACUUM` lại | Giảm |
| Tạo replication slot không dùng, chờ, xem `pg_wal` | WAL tích lại |
| `SELECT xmin, xmax FROM t WHERE id = 1` trước/sau `UPDATE` | Giá trị đổi |
| `fillfactor = 100` + index trên cột hay đổi, `UPDATE` 100k lần | `hot_pct` gần 0, index phình |
| `fillfactor = 80` + bỏ index đó, lặp lại | `hot_pct` cao, ít bloat |
| Đặt `autovacuum_vacuum_scale_factor = 0.001` trên bảng test | Autovacuum chạy liên tục — quan sát chi phí |
| Tắt autovacuum trên một bảng test, `UPDATE` nhiều | Bloat tăng không giới hạn |
| `SELECT age(datfrozenxid) FROM pg_database` | Khoảng cách tới wraparound |

## What Usually Goes Wrong

- **Transaction mở lâu** (`idle in transaction`) → chặn vacuum toàn database. Nguyên nhân số một.
- **Replication slot bỏ quên** → WAL đầy đĩa **và** chặn vacuum. Nguyên nhân số hai, và khó nghĩ tới nhất.
- **Prepared transaction (2PC) bị bỏ** → cùng hiệu ứng, hầu như không ai kiểm tra.
- **Autovacuum mặc định trên bảng lớn** → 20% ngưỡng quá cao.
- **`UPDATE` hàng loạt thường xuyên** → bloat nhanh; cân nhắc batch nhỏ hoặc partition.
- **`DELETE` lớn định kỳ** → bloat; dùng partition + `DROP` thay thế.
- **Index trên cột cập nhật liên tục** (`last_seen_at`, `updated_at`) → phá HOT update.
- **`fillfactor = 100` trên bảng nhiều `UPDATE`** → không có chỗ cho HOT.
- **`VACUUM FULL` ở giờ cao điểm** → downtime tự gây ra.
- **Không theo dõi `datfrozenxid`** → wraparound emergency.
- **Không theo dõi `n_dead_tup`** → phát hiện bloat khi đã 90%.
- **Đổ lỗi cho "PostgreSQL chậm"** khi thật ra bảng bloat 10 lần.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `DELETE` giải phóng dung lượng | Chỉ đánh dấu chết; cần vacuum, và vacuum không trả về OS |
| `UPDATE` sửa dòng tại chỗ | Nó tạo version mới; dòng cũ vẫn chiếm chỗ |
| `VACUUM` trả dung lượng về OS | `VACUUM FULL` mới trả; `VACUUM` chỉ đánh dấu tái dùng |
| `VACUUM` khoá bảng | Không; chỉ `VACUUM FULL` khoá |
| Autovacuum lo hết | Mặc định không đủ cho bảng lớn hoặc ghi nhiều |
| Transaction dài chỉ ảnh hưởng chính nó | Nó chặn vacuum **toàn database** |
| Bloat chỉ tốn dung lượng | Nó làm chậm mọi query trên bảng đó |
| Wraparound là lý thuyết | Là sự cố có thật, và gây downtime dài |
| Nhiều index chỉ làm chậm ghi | Chúng còn phá HOT update, làm bloat tệ hơn |
| `pg_repack` giống `VACUUM FULL` | Nó gần như không khoá — khác biệt lớn ở production |

## Debugging

1. **Bảng lớn bất thường** → `n_live_tup` vs `n_dead_tup` vs `pg_total_relation_size`.
2. **`n_dead_tup` cao và `last_autovacuum` cũ hoặc NULL** → autovacuum bị chặn.
3. **Tìm cái chặn** — kiểm tra cả bốn: transaction dài, replication slot không active, prepared transaction, cấu hình autovacuum.
4. **Xử lý cái chặn trước**, rồi mới vacuum. Vacuum khi vẫn còn transaction dài là vô ích.
5. **`VACUUM (VERBOSE)`** in ra bao nhiêu tuple được dọn và bao nhiêu **không thể** dọn (`nonremovable`) — con số thứ hai xác nhận có cái chặn.
6. **Kiểm tra wraparound**: `age(datfrozenxid)` theo database và `age(relfrozenxid)` theo bảng.
7. **`hot_pct` thấp** → xem `fillfactor` và danh sách index.
8. **Bloat index riêng** → `pg_stat_user_indexes` + `REINDEX CONCURRENTLY`.

## Production Considerations

- **`idle_in_transaction_session_timeout = 60s`** là cấu hình phòng thủ có giá trị cao nhất trong note này. Nó chặn nguyên nhân số một.
- **Alert trên bốn thứ**: `n_dead_tup` theo bảng, `age(datfrozenxid)`, replication slot không active, transaction > 5 phút.
- **Giảm `autovacuum_vacuum_scale_factor` cho bảng lớn** xuống 0,01–0,05.
- **Tăng `autovacuum_max_workers`** nếu có nhiều bảng lớn, và giảm `autovacuum_vacuum_cost_delay` để vacuum chạy nhanh hơn (đánh đổi bằng I/O).
- **`fillfactor` 70–90 cho bảng nhiều `UPDATE`**; giữ 100 cho bảng chỉ ghi thêm (append-only).
- **Xoá index không dùng** — chúng vừa tốn ghi vừa phá HOT.
- **Partition cho dữ liệu chuỗi thời gian**, rồi `DROP` partition cũ thay vì `DELETE`. Đây là khác biệt giữa "mỗi đêm tạo 10 triệu dead tuple" và "mỗi đêm tốn 50ms".
- **`pg_repack` thay `VACUUM FULL`** ở production. Nếu buộc phải `VACUUM FULL`, làm trong cửa sổ bảo trì và chuẩn bị dung lượng gấp đôi.
- **`REINDEX CONCURRENTLY`** cho index bloat (PostgreSQL 12+).
- **Không bao giờ tắt autovacuum** để "tăng hiệu năng". Nó luôn kết thúc bằng một sự cố lớn hơn nhiều.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| MVCC | đọc không chặn ghi | bloat, cần vacuum |
| Autovacuum tích cực | ít bloat | tốn I/O và CPU nền |
| Autovacuum thưa | ít nhiễu | bloat, thống kê cũ, rủi ro wraparound |
| `fillfactor` thấp | nhiều HOT update | bảng lớn hơn khi mới tạo |
| `fillfactor` 100 | chặt nhất khi ghi lần đầu | ít HOT, bloat nhiều hơn |
| Nhiều index | đọc nhanh | ghi chậm, phá HOT, bloat |
| `VACUUM FULL` | trả dung lượng, gọn nhất | khoá độc quyền |
| `pg_repack` | gần như không khoá | cần extension, cần dung lượng dư |
| Partition + `DROP` | xoá tức thì, không bloat | phức tạp hơn khi thiết kế |
| `DELETE` định kỳ | đơn giản | bloat, tốn I/O, tốn WAL |

## Explain Without Notes

1. Vì sao `UPDATE` trong PostgreSQL tạo ra một dòng mới thay vì sửa tại chỗ?
2. `xmin`/`xmax` quyết định điều gì? Viết quy tắc "tôi thấy version này khi nào".
3. Vì sao một transaction mở lâu chặn vacuum **toàn database**, không chỉ bảng nó chạm?
4. `VACUUM` và `VACUUM FULL` khác nhau ở hai điểm nào?
5. Bốn nguyên nhân làm autovacuum không dọn được?
6. HOT update là gì, hai điều kiện để có nó, và vì sao index thừa phá nó?
7. Transaction ID wraparound gây chuyện gì, và vì sao nó là sự cố dài?

## Related

- [Transaction isolation](01-transaction-isolation.md) — snapshot đến từ đâu
- [Locking & deadlock](05-locking-deadlock.md) — `VACUUM FULL` và các mức khoá
- [Connection pool](03-connection-pool.md) — `idle in transaction` là nguyên nhân chung
- [WAL, durability & backup](06-wal-durability-backup.md) — replication slot giữ WAL
- [Index & query plan](02-index-query-plan.md) — bloat làm plan sai; visibility map và Index Only Scan
- [Index types](07-index-types.md) — index thừa và HOT update
- [Migrations](../03-data-modeling/04-migrations.md) — `UPDATE` hàng loạt trong migration
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md)

## Version / Context

PostgreSQL 16. `REINDEX CONCURRENTLY` từ PostgreSQL 12. Mặc định `autovacuum_vacuum_cost_delay` giảm từ 20ms xuống 2ms ở PostgreSQL 12. PostgreSQL 17 thêm cải tiến bộ nhớ cho vacuum, nhưng mô hình MVCC không đổi.
