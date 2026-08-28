---
level: intermediate
area: database
prerequisites:
  - ../../00-sql/02-joins-aggregation.md
related:
  - 02-index-types.md
  - 03-explain-analyze-workflow.md
  - ../../../05-cross-cutting/performance/04-database-performance.md
---

# Index & query plan

> Endpoint chạy 40ms ở local với 5.000 dòng. Production có 4 triệu dòng và nó mất 8 giây. Bạn thêm index — vẫn 8 giây. Bạn thêm index nữa — vẫn 8 giây. Vấn đề không phải "thiếu index" mà là **planner không dùng được index bạn tạo**, và cho tới khi bạn đọc plan, bạn chỉ đang đoán.

## Position

```text
SQL text
  ↓  parser
cây cú pháp
  ↓  planner  ← dùng THỐNG KÊ để ước lượng chi phí, chọn plan rẻ nhất
plan (cây các nút)
  ↓  executor
đọc từ shared_buffers hoặc từ đĩa
```

Điểm mấu chốt: **bạn không ra lệnh cho PostgreSQL cách chạy query.** Bạn mô tả kết quả; planner chọn cách. Tối ưu hoá nghĩa là *cho planner lựa chọn tốt hơn* (index) và *cho nó thông tin đúng* (thống kê).

## Problem

Không có index, tìm một dòng nghĩa là đọc mọi dòng:

```text
4.000.000 dòng × 100 byte = 400 MB phải đọc để tìm 1 dòng
```

Index đổi việc đó lấy một cấu trúc cây:

```text
B-tree độ sâu 4:  4 lần đọc trang ≈ 32 KB
                  → nhanh hơn ~12.000 lần
```

Nhưng index không miễn phí, và cái giá không hiển nhiên:

```text
Mỗi INSERT/UPDATE/DELETE phải cập nhật MỌI index của bảng
Index chiếm dung lượng (thường 10–50% kích thước bảng)
Index chiếm shared_buffers — cạnh tranh với dữ liệu thật
Index không dùng đến vẫn phải trả toàn bộ chi phí ghi
```

Và cái bẫy lớn nhất: **một index tồn tại không có nghĩa là nó được dùng.**

## Mental Model

### B-tree: cây sắp xếp

```text
                   [50]
              /            \
        [20, 35]          [70, 85]
       /   |    \        /   |    \
    ...  ...   ...     ...  ...   ...   ← leaf: (giá trị, con trỏ tới dòng)
```

Từ đó suy ra **chính xác** những gì index dùng được:

```text
DÙNG ĐƯỢC                          KHÔNG DÙNG ĐƯỢC
=  <  >  <=  >=  BETWEEN           <>  (không phải một khoảng)
IN (danh sách)                     NOT IN
IS NULL / IS NOT NULL              function(col) = x     ← xem dưới
LIKE 'abc%'   (neo đầu)            LIKE '%abc'  hoặc  '%abc%'
ORDER BY theo đúng thứ tự index    ORDER BY thứ tự khác hẳn
```

Lý do `LIKE '%abc'` không dùng được: cây được sắp theo **tiền tố**. Không biết ký tự đầu thì không biết đi nhánh nào.

### Sargable: điều kiện phải "chạm được" index

```sql
-- ❌ hàm bọc quanh CỘT → planner không biết kết quả hàm nằm ở đâu trong cây
WHERE date(created_at) = '2026-01-01'
WHERE lower(email) = 'a@b.c'
WHERE extract(year FROM created_at) = 2026
WHERE total::text LIKE '1%'

-- ✅ cột trần một bên, biểu thức bên kia
WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02'
WHERE email = 'a@b.c'                              -- và lưu email đã chuẩn hoá
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'
```

Nếu bắt buộc phải dùng hàm, tạo **index trên biểu thức**:

```sql
CREATE INDEX ON users (lower(email));
-- giờ  WHERE lower(email) = 'a@b.c'  dùng được index
```

### Composite index: quy tắc tiền tố trái

Đây là quy tắc bị hiểu sai nhiều nhất về index.

```sql
CREATE INDEX ON orders (user_id, status, created_at);
```

Index này giống một danh bạ sắp theo (họ, tên, ngày sinh):

```text
DÙNG ĐƯỢC (tiền tố trái)                    KHÔNG (bỏ qua cột đầu)
WHERE user_id = 1                            WHERE status = 'paid'
WHERE user_id = 1 AND status = 'paid'        WHERE created_at > '...'
WHERE user_id = 1 AND status = 'paid'        WHERE status = 'paid'
      AND created_at > '...'                       AND created_at > '...'
```

Và một quy tắc tinh vi hơn: **cột sau một điều kiện khoảng chỉ dùng được hạn chế.**

```sql
WHERE user_id = 1 AND created_at > '2026-01-01' AND status = 'paid'
-- với index (user_id, created_at, status):
--   user_id     → tìm chính xác  ✓
--   created_at  → quét khoảng    ✓
--   status      → CHỈ lọc trong lúc quét, không thu hẹp phạm vi
```

Từ đó ra thứ tự cột đúng:

```text
1. Cột dùng với  =        (equality) — đặt TRƯỚC
2. Cột dùng với  khoảng   (range)    — đặt SAU
3. Cột chỉ để  ORDER BY   hoặc để  covering — cuối cùng
```

Với `WHERE user_id = ? AND status = ? AND created_at > ?`, thứ tự đúng là `(user_id, status, created_at)`, không phải `(created_at, user_id, status)`.

Hệ quả thực dụng: **một index composite tốt thay được nhiều index đơn.** `(user_id, status)` phục vụ cả `WHERE user_id = ?`. Đừng tạo cả hai.

### Vì sao planner từ chối index của bạn

Đây là phần trả lời câu hỏi ở đầu note. Sáu lý do, theo tần suất:

```text
1. Query trả về QUÁ NHIỀU dòng (>5–10% bảng)
   → seq scan thật sự rẻ hơn: đọc tuần tự nhanh hơn nhiều lần random access
   → đây không phải lỗi; planner đúng

2. Thống kê cũ
   → planner tưởng bảng có 1.000 dòng, thực tế 4 triệu
   → ANALYZE table;

3. Điều kiện không sargable
   → hàm bọc quanh cột

4. Sai kiểu dữ liệu
   → cột bigint, tham số là text → phải ép kiểu → mất index
   → cột varchar so với số

5. Index không khớp tiền tố trái

6. Bảng quá nhỏ
   → dưới vài trăm dòng, seq scan luôn thắng. Đây là lý do
     "index không hoạt động ở local nhưng cần ở production".
```

Lý do 6 giải thích một hiểu lầm phổ biến: bạn thêm index ở local, `EXPLAIN` cho thấy seq scan, và bạn kết luận index sai. Thực ra bảng chỉ có 200 dòng.

### Đọc plan: bốn thứ cần nhìn

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

```text
Index Scan using idx_orders_user on orders  (cost=0.43..8.45 rows=1 width=64)
                                            (actual time=0.021..0.023 rows=1 loops=1)
  Index Cond: (user_id = 42)
  Buffers: shared hit=4
Planning Time: 0.14 ms
Execution Time: 0.05 ms
```

```text
1. LOẠI NÚT       Seq Scan / Index Scan / Index Only Scan / Bitmap Heap Scan
2. rows ƯỚC LƯỢNG vs actual rows   ← lệch >10 lần = thống kê sai
3. loops                            ← nhân với actual time để ra chi phí thật
4. Buffers: shared hit vs read      ← hit = từ RAM, read = từ đĩa
```

Điểm 2 là chẩn đoán quan trọng nhất: nếu planner ước lượng 10 dòng mà thực tế 100.000, mọi quyết định sau đó của nó đều sai — và cách sửa là `ANALYZE`, không phải thêm index.

Bốn loại scan:

```text
Seq Scan          đọc toàn bảng. Đúng khi lấy phần lớn dòng.
Index Scan        đi cây → lấy từng dòng từ heap. Đúng khi ít dòng.
Bitmap Heap Scan  đi cây → dựng bitmap các trang → đọc trang theo thứ tự.
                  Đúng cho số dòng "vừa" (hàng trăm–hàng nghìn).
Index Only Scan   đọc XONG trong index, KHÔNG chạm heap. Nhanh nhất.
```

`Index Only Scan` cần hai điều: mọi cột query cần đều có trong index, **và** trang đó đã "all-visible" (visibility map cập nhật, tức là autovacuum đã chạy). Đây là lý do một query đôi khi chuyển từ Index Only Scan sang Index Scan sau nhiều lần ghi. Xem [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md).

### Covering index

```sql
-- query chỉ cần 3 cột
SELECT user_id, status, created_at FROM orders WHERE user_id = 42;

CREATE INDEX ON orders (user_id, status, created_at);   -- đủ để Index Only Scan
```

```sql
-- hoặc INCLUDE: cột chỉ để trả về, không tham gia tìm kiếm
CREATE INDEX ON orders (user_id) INCLUDE (status, total);
-- index nhỏ hơn (cột INCLUDE chỉ ở leaf) nhưng vẫn tránh chạm heap
```

## Example

Quy trình đủ để giải quyết phần lớn query chậm:

```sql
-- 1. Baseline: đo trước khi làm gì
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, created_at FROM tasks
WHERE project_id = 42 AND status = 'open'
ORDER BY created_at DESC LIMIT 20;
--  Seq Scan on tasks  (rows=4000000)  actual time=1240ms
--  Filter: ...  Rows Removed by Filter: 3999980
--  Buffers: shared read=52000

-- "Rows Removed by Filter" khổng lồ = đọc 4 triệu dòng để lấy 20 → cần index

-- 2. Index: equality trước, order by sau
CREATE INDEX CONCURRENTLY idx_tasks_project_status_created
  ON tasks (project_id, status, created_at DESC);

-- 3. Cập nhật thống kê
ANALYZE tasks;

-- 4. Đo lại
--  Index Scan using idx_tasks_project_status_created  actual time=0.08ms
--  Buffers: shared hit=6
--  → 1240ms → 0.08ms
```

Ba chi tiết:

- **`CONCURRENTLY`** — không khoá bảng khi tạo index trên production. Chậm hơn, không chạy được trong transaction, và có thể để lại index `INVALID` nếu thất bại (kiểm tra rồi `DROP` và làm lại).
- **`created_at DESC` trong index** — khớp với `ORDER BY ... DESC` để planner bỏ được bước sort.
- **`ANALYZE` sau khi tạo index** — thống kê mới giúp planner ước lượng đúng.

Và bước cuối, thường bị bỏ: **tăng dữ liệu rồi đo lại.** Một plan đúng với 100.000 dòng có thể sai với 10 triệu.

## Prediction

Bảng `orders` 4 triệu dòng, index `(user_id, status, created_at)`:

1. `WHERE user_id = 42` — dùng index không?
2. `WHERE status = 'paid'` — dùng index không? Vì sao?
3. `WHERE user_id = 42 AND created_at > '2026-01-01'` — dùng được phần nào của index?
4. `WHERE date(created_at) = '2026-01-01'` — dùng index không?
5. `WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02'` — khác câu 4 thế nào?
6. `WHERE status <> 'cancelled'` (95% dòng thoả) — planner chọn gì? Đó có phải quyết định sai không?
7. Bảng 200 dòng, có index, `WHERE user_id = 42` — planner chọn gì?
8. Cột `user_id` là `bigint`, tham số truyền vào là chuỗi `'42'` — index có được dùng không?
9. `SELECT * FROM orders WHERE user_id = 42` vs `SELECT user_id, status FROM ...` — loại scan khác nhau thế nào?
10. `rows=10` trong ước lượng nhưng `actual rows=100000` — nguyên nhân? Sửa thế nào?
11. Bảng có 12 index, chạy `INSERT` 1 triệu dòng — so với bảng 2 index?
12. Tạo index không có `CONCURRENTLY` trên bảng 4 triệu dòng đang có traffic ghi — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **Có** — tiền tố trái.
2. **Không** (thường là seq scan) — `status` không phải cột đầu tiên. Planner có thể chọn index-only scan toàn bộ index nếu nó nhỏ hơn bảng nhiều, nhưng đừng trông chờ.
3. `user_id` tìm chính xác, `created_at` quét khoảng — nhưng `status` bị bỏ qua vì nó nằm giữa và không có điều kiện.
4. **Không** — hàm bọc quanh cột.
5. Câu 5 sargable → dùng index. Cùng kết quả, khác plan hoàn toàn.
6. **Seq Scan**, và đó là **quyết định đúng**: đọc tuần tự 95% bảng rẻ hơn 3,8 triệu lần random access.
7. **Seq Scan** — bảng quá nhỏ. Không phải lỗi.
8. Tuỳ: PostgreSQL ép được `'42'` sang `bigint` nên thường vẫn dùng index. Nhưng nếu cột là `text` và bạn so với số, hoặc ngược lại theo hướng cần ép **cột**, index mất tác dụng. Luôn kiểm tra bằng `EXPLAIN`.
9. `SELECT *` → Index Scan (phải chạm heap lấy các cột khác). Chỉ 2 cột trong index → **Index Only Scan**.
10. Thống kê cũ. `ANALYZE orders;`. Nếu vẫn lệch, tăng `ALTER TABLE ... ALTER COLUMN x SET STATISTICS 500`.
11. Chậm hơn nhiều — mỗi dòng phải cập nhật 12 cây thay vì 2. Thường 3–5 lần chậm hơn.
12. Index thường (`CREATE INDEX`) lấy `SHARE` lock: **chặn mọi ghi** vào bảng cho tới khi xong. Trên 4 triệu dòng có thể là vài phút downtime ghi.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Sinh 1 triệu dòng, query không index, `EXPLAIN ANALYZE` | Seq Scan, thời gian, `Buffers: read` |
| Thêm index, đo lại | Index Scan, `Buffers: hit` |
| Bọc cột trong `date()` | Quay lại Seq Scan |
| Tạo index trên biểu thức `date(created_at)` | Index Scan trở lại |
| Query trả 90% bảng dù có index | Planner chọn Seq Scan — xác nhận nó đúng bằng cách ép `SET enable_seqscan = off` và so thời gian |
| Xoá thống kê: `DELETE FROM pg_statistic` (chỉ ở DB thử nghiệm) hoặc chèn 1 triệu dòng rồi query ngay | `rows` ước lượng lệch xa |
| `ANALYZE`, đo lại | Ước lượng đúng, có thể đổi plan |
| Index `(a, b)` rồi query `WHERE b = ?` | Không dùng được |
| Index `(b, a)` rồi query `WHERE a = ? AND b = ?` | Dùng được — thứ tự trong `WHERE` không quan trọng |
| Thêm 10 index vào bảng, đo `INSERT` 100k dòng | So thời gian trước/sau |
| `SELECT *` vs chỉ cột trong index | Index Scan vs Index Only Scan |
| Chèn nhiều dòng rồi chạy Index Only Scan ngay | `Heap Fetches` > 0 — visibility map chưa cập nhật |
| `VACUUM` rồi chạy lại | `Heap Fetches: 0` |
| `CREATE INDEX` (không CONCURRENTLY) trên bảng lớn, đồng thời chạy `INSERT` | `INSERT` bị chặn |

Dòng về `enable_seqscan = off` là công cụ chẩn đoán hữu ích: nó **ép** planner dùng index, và nếu kết quả chậm hơn thì planner đã đúng ngay từ đầu. Không dùng nó ở production.

## What Usually Goes Wrong

- **Thêm index mà không đọc plan** → không biết nó có được dùng không.
- **Điều kiện không sargable** → index bị bỏ qua im lặng.
- **Sai thứ tự cột trong composite index** → chỉ dùng được một phần.
- **Tạo index đơn cho từng cột** thay vì một composite → nhiều index, hiệu quả kém hơn.
- **Thống kê cũ** → plan sai. Đặc biệt sau khi nạp dữ liệu lớn hoặc sau migration.
- **Index thừa** → làm chậm mọi ghi, không giúp đọc.
- **Index trùng lặp** — `(a)` khi đã có `(a, b)` là thừa hoàn toàn.
- **`CREATE INDEX` không `CONCURRENTLY` ở production** → chặn ghi.
- **Tối ưu bằng cách nhìn code thay vì nhìn plan** → sửa nhầm chỗ.
- **Đo với dữ liệu nhỏ** → kết luận sai; plan đổi theo kích thước.
- **Không đo lại sau khi dữ liệu tăng** → plan tốt hôm nay, xấu sau sáu tháng.
- **Index trên cột có ít giá trị khác nhau** (`status` với 3 giá trị, `boolean`) → thường vô dụng, trừ khi dùng partial index.
- **Bỏ qua `Rows Removed by Filter`** — con số này chỉ thẳng vào chỗ lãng phí.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Thêm index thì query nhanh hơn | Chỉ khi planner dùng được và chọn dùng nó |
| Index nào cũng tốt, cứ thêm | Mỗi index là chi phí trên mọi ghi |
| Seq Scan luôn xấu | Với query trả nhiều dòng, nó là lựa chọn đúng |
| Index đơn cho mỗi cột là đủ | Composite thường mạnh hơn nhiều |
| Thứ tự cột trong composite không quan trọng | Nó quyết định index dùng được hay không |
| Thứ tự cột trong `WHERE` quan trọng | Không — planner tự sắp xếp |
| PostgreSQL tự index foreign key | Chỉ tự index PRIMARY KEY và UNIQUE |
| `EXPLAIN` chạy query | Không; `EXPLAIN ANALYZE` mới chạy (kể cả `INSERT`/`UPDATE`!) |
| Index Only Scan luôn tránh được heap | Chỉ khi visibility map cập nhật |
| Index trên `boolean` hữu ích | Hầu như không, trừ khi partial |

Về `EXPLAIN ANALYZE` với `UPDATE`/`DELETE`: nó **thật sự thực thi**. Bọc trong `BEGIN; ... ROLLBACK;` khi thử nghiệm.

## Debugging

Theo thứ tự, dừng lại khi tìm ra:

1. **`EXPLAIN (ANALYZE, BUFFERS)`** — luôn là bước đầu tiên. Không đoán.
2. **Tìm nút tốn nhất**: đọc từ trong ra ngoài; nút có `actual time` lớn nhất (nhớ nhân với `loops`).
3. **`Seq Scan` trên bảng lớn với `Rows Removed by Filter` cao** → thiếu index hoặc không sargable.
4. **`rows` lệch `actual rows` >10 lần** → `ANALYZE <table>`. Nếu vẫn lệch, tăng statistics target hoặc tạo extended statistics cho cột tương quan.
5. **Có index nhưng không dùng** → kiểm tra theo thứ tự: sargable? tiền tố trái? kiểu dữ liệu? tỉ lệ dòng trả về?
6. **`Buffers: read` cao** → dữ liệu không nằm trong cache. Có thể là bình thường (lần đầu) hoặc là dấu hiệu `shared_buffers` quá nhỏ.
7. **Tìm index chưa bao giờ dùng**:
   ```sql
   SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
   FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;
   ```
8. **Tìm query tốn nhất toàn hệ thống**:
   ```sql
   SELECT calls, round(mean_exec_time::numeric, 2) AS avg_ms,
          round(total_exec_time::numeric) AS total_ms, left(query, 80)
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
   ```

Bước 8 quan trọng hơn nó có vẻ: query chậm nhất chưa chắc là query tốn nhất. Một query 5ms chạy 1 triệu lần tốn hơn một query 3 giây chạy mười lần.

## Production Considerations

- **`CREATE INDEX CONCURRENTLY`** luôn luôn, trên bảng có traffic. Kiểm tra `indisvalid` sau khi xong; nếu `false`, `DROP` và làm lại.
- **`pg_stat_statements`** là extension quan trọng nhất cho hiệu năng. Bật nó từ đầu.
- **Xoá index không dùng.** Chúng làm chậm mọi ghi và chiếm bộ nhớ cache. Kiểm tra `idx_scan = 0` sau vài tuần chạy đủ chu kỳ nghiệp vụ (nhớ cả báo cáo cuối tháng).
- **`autovacuum` phải hoạt động** để giữ thống kê tươi và giữ visibility map cho Index Only Scan.
- **Sau nạp dữ liệu lớn hoặc migration, chạy `ANALYZE` tường minh.** Đừng chờ autovacuum.
- **Bảng lớn nên có index phù hợp với truy vấn bảo trì**, không chỉ truy vấn của người dùng. Một job dọn dẹp `DELETE ... WHERE created_at < ...` không có index sẽ quét toàn bảng mỗi đêm.
- **Đo lại plan khi dữ liệu tăng 10 lần.** Điểm chuyển giữa index scan và seq scan dịch theo kích thước.
- **Đặt ngân sách rõ ràng**: "endpoint list phải dưới 100ms ở p95 với 10 triệu dòng". Không có số, không có cách biết đã xong.
- **Đừng dùng index hint** — PostgreSQL không có. Nếu planner chọn sai một cách nhất quán, nguyên nhân gần như luôn là thống kê hoặc mô hình dữ liệu.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Thêm index | đọc nhanh | ghi chậm, tốn chỗ, tốn cache |
| Composite index | phục vụ nhiều query | chỉ dùng theo tiền tố trái |
| Nhiều index đơn | linh hoạt | kém hiệu quả hơn composite, tốn ghi |
| Covering index (`INCLUDE`) | Index Only Scan | index lớn hơn |
| Partial index | nhỏ, rẻ | chỉ dùng cho một phần dữ liệu |
| Index trên biểu thức | cứu điều kiện không sargable | phải viết query khớp chính xác |
| `CONCURRENTLY` | không downtime | chậm hơn, không trong transaction |
| Chuẩn hoá dữ liệu lúc ghi (lowercase email) | query đơn giản, index thẳng | phải xử lý ở mọi đường ghi |
| Denormalize / cột tính sẵn | đọc rất nhanh | phải đồng bộ, có thể lệch |

## Explain Without Notes

1. Vì sao `WHERE date(created_at) = x` không dùng được index, còn `WHERE created_at >= x AND < y` thì được?
2. Quy tắc tiền tố trái là gì? Cho một ví dụ index không dùng được.
3. Thứ tự cột đúng trong composite index, và vì sao?
4. Sáu lý do planner từ chối index — kể ít nhất bốn.
5. Bốn loại scan và khi nào mỗi loại là lựa chọn đúng?
6. `rows` lệch `actual rows` nghĩa là gì, và sửa thế nào?
7. Vì sao Seq Scan đôi khi là lựa chọn đúng?
8. Chi phí thật của một index không được dùng là gì?

## Related

- [Index types](02-index-types.md) — B-tree, GIN, GiST, BRIN, partial, expression
- [EXPLAIN ANALYZE workflow](03-explain-analyze-workflow.md) — quy trình đo đầy đủ
- [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md) — visibility map, Index Only Scan, bloat
- [Joins & aggregation](../../00-sql/02-joins-aggregation.md) — thuật toán join
- [Connection pool](../fundamentals/02-connection-pool.md) — query nhanh vô nghĩa nếu không có connection
- [Database performance](../../../05-cross-cutting/performance/04-database-performance.md) — đo ở tầng hệ thống
- [Database & transactions (NestJS)](../../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) — N+1
- [Pagination](../../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — keyset dùng index tốt hơn offset

## Version / Context

PostgreSQL 16. `INCLUDE` cho covering index có từ PostgreSQL 11. `CREATE INDEX CONCURRENTLY` từ 8.2. `pg_stat_statements` là extension, phải thêm vào `shared_preload_libraries`.
