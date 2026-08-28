---
level: advanced
area: database
prerequisites:
  - 01-index-query-plan.md
related:
  - 02-index-types.md
  - ../../../05-cross-cutting/performance/04-database-performance.md
---

# EXPLAIN ANALYZE workflow

> Đây không phải note "EXPLAIN là gì". Đây là **quy trình**: từ "một endpoint chậm" tới "tôi biết chính xác vì sao, đã sửa, và đã chứng minh rằng nó vẫn nhanh khi dữ liệu gấp mười".

Phần lớn việc tối ưu query thất bại không phải vì thiếu kiến thức về index, mà vì bỏ qua bước 1 (đo baseline) hoặc bước cuối (tăng dữ liệu rồi đo lại).

## Position

```text
"endpoint chậm"
   ↓  ① tìm QUERY nào chậm        pg_stat_statements
   ↓  ② tái hiện với dữ liệu thật
   ↓  ③ đo baseline               EXPLAIN (ANALYZE, BUFFERS)
   ↓  ④ đọc plan, tìm nút tốn nhất
   ↓  ⑤ đặt giả thuyết → sửa MỘT thứ
   ↓  ⑥ đo lại
   ↓  ⑦ tăng dữ liệu 10×, đo lại  ← bước bị bỏ nhiều nhất
   ↓  ⑧ xác nhận ở production
```

## Problem

Tối ưu hoá không có quy trình trông như thế này:

```text
"Chắc thiếu index"     → thêm index → vẫn chậm
"Chắc phải thêm nữa"   → thêm index → vẫn chậm
"Chắc do ORM"          → viết raw SQL → vẫn chậm
"Chắc DB yếu"          → nâng instance → nhanh hơn chút, tốn tiền gấp đôi
```

Bốn thay đổi, không lần nào biết cái nào có tác dụng, và cuối cùng để lại bốn index thừa làm chậm mọi ghi.

Ba sai lầm quy trình, và chúng đắt hơn mọi sai lầm kỹ thuật:

```text
1. Không đo baseline      → không biết đã cải thiện bao nhiêu
2. Sửa nhiều thứ cùng lúc → không biết cái nào có tác dụng
3. Đo với dữ liệu nhỏ     → kết luận sai; plan đổi theo kích thước
```

## Mental Model

### Plan là một cây, đọc từ trong ra ngoài

```text
Limit                                    ← cuối cùng
  └─ Sort
       └─ Hash Join
            ├─ Seq Scan on orders        ← chạy trước
            └─ Hash
                 └─ Index Scan on users
```

Thụt lề sâu hơn = chạy trước. Mỗi nút nhận dòng từ nút con và đưa lên nút cha.

### Sáu con số trong một nút

```text
Index Scan using idx_orders_user on orders
  (cost=0.43..8.45 rows=1 width=64)
  (actual time=0.021..0.850 rows=1200 loops=3)
  Buffers: shared hit=45 read=1203
```

```text
cost         ước lượng tương đối của planner. KHÔNG phải mili giây. Chỉ để so sánh plan.
rows         ước lượng số dòng
actual time  (thời gian tới dòng ĐẦU) .. (thời gian tới dòng CUỐI), MỖI lần lặp
actual rows  số dòng thật, TRUNG BÌNH mỗi lần lặp
loops        số lần nút này chạy
Buffers      hit = từ cache (RAM), read = từ đĩa
```

Hai cạm bẫy khi đọc, và cả hai gây kết luận sai:

```text
1. actual time là MỖI LẦN LẶP.
   Chi phí thật = actual time × loops.
   Một nút 0,8ms × 3.000 loops = 2,4 giây — nhìn qua tưởng nhanh.

2. rows cũng là TRUNG BÌNH mỗi lần lặp, không phải tổng.
```

### Bốn tín hiệu chẩn đoán

Đây là những gì bạn tìm khi đọc plan, theo thứ tự giá trị:

```text
① rows ước lượng LỆCH XA actual rows  (>10×)
   → thống kê sai → planner chọn plan sai → sửa bằng ANALYZE, không phải bằng index

② Rows Removed by Filter lớn
   → đọc nhiều để loại gần hết → thiếu index hoặc index sai

③ loops lớn ở nhánh trong của Nested Loop
   → thường là N+1 ở tầng SQL → thiếu index trên khoá join

④ Buffers read >> hit
   → dữ liệu không nằm trong cache → có thể bình thường (lần đầu),
     có thể là bloat, có thể là shared_buffers nhỏ
```

Tín hiệu ① là quan trọng nhất và bị bỏ qua nhiều nhất. Khi planner tưởng có 10 dòng mà thực tế 100.000, **mọi** quyết định sau đó của nó sai — và thêm index không sửa được điều đó.

### Ba tuỳ chọn nên luôn dùng

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT ...;
```

```text
ANALYZE   THỰC THI query và đo thật.  ⚠️ với UPDATE/DELETE/INSERT nó GHI THẬT.
BUFFERS   cho biết đọc từ RAM hay đĩa — không có nó bạn đang thiếu một nửa bức tranh.
VERBOSE   hiện tên cột — hữu ích khi plan phức tạp.
```

Với câu lệnh ghi, luôn bọc:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) UPDATE orders SET status = 'x' WHERE ...;
ROLLBACK;
```

Và `SETTINGS` (PostgreSQL 12+) hiện các tham số khác mặc định — hữu ích khi plan trên hai môi trường khác nhau:

```sql
EXPLAIN (ANALYZE, BUFFERS, SETTINGS) SELECT ...;
```

## How It Works

### Bước ①: tìm query nào thật sự tốn

```sql
-- theo TỔNG thời gian, không theo thời gian trung bình
SELECT calls,
       round(mean_exec_time::numeric, 2)  AS avg_ms,
       round(total_exec_time::numeric)    AS total_ms,
       round(100 * total_exec_time / sum(total_exec_time) OVER (), 1) AS pct,
       left(query, 90)
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Sắp theo `total_exec_time` chứ không phải `mean_exec_time`:

```text
Query A:  3.000 ms × 10 lần     =   30 giây tổng
Query B:      5 ms × 1.000.000  = 5.000 giây tổng   ← đây mới là thứ đáng sửa
```

Query B không bao giờ xuất hiện trong "slow query log" với ngưỡng 1 giây, nhưng nó chiếm phần lớn tài nguyên database.

### Bước ②: tái hiện với dữ liệu thật

Đây là bước quyết định tính hợp lệ của mọi kết luận sau đó.

```sql
-- sinh dữ liệu có PHÂN PHỐI GIỐNG THẬT
INSERT INTO orders (user_id, status, total, created_at)
SELECT
  -- phân phối lệch: 20% user tạo 80% đơn — giống thực tế hơn random đều
  CASE WHEN random() < 0.8 THEN (random() * 2000)::int + 1
       ELSE (random() * 100000)::int + 1 END,
  (ARRAY['pending','paid','shipped','cancelled'])[1 + (random()*3)::int],
  (random() * 1000)::numeric(10,2),
  now() - (random() * interval '365 days')
FROM generate_series(1, 5000000);

ANALYZE orders;      -- BẮT BUỘC — không có thống kê thì plan vô nghĩa
```

Phân phối quan trọng hơn số lượng. Với `user_id` random đều, mỗi user có ~50 đơn và planner ước lượng đúng. Với phân phối thật (một số user có 10.000 đơn), planner có thể chọn plan hoàn toàn khác — và đó chính là plan bạn gặp ở production.

### Bước ③–④: đo và đọc

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.total, u.name
FROM orders o JOIN users u ON u.id = o.user_id
WHERE o.status = 'paid' AND o.created_at > now() - interval '30 days'
ORDER BY o.created_at DESC LIMIT 20;
```

```text
Limit  (actual time=4821.3..4821.4 rows=20 loops=1)
  ->  Sort  (actual time=4821.3..4821.3 rows=20 loops=1)
        Sort Key: o.created_at DESC
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Hash Join  (actual time=120.5..4650.2 rows=310000 loops=1)
              ->  Seq Scan on orders o  (actual time=0.1..4200.8 rows=310000 loops=1)
                    Filter: (status = 'paid' AND created_at > ...)
                    Rows Removed by Filter: 4690000          ◀── ② tín hiệu
                    Buffers: shared read=98000               ◀── ④ tín hiệu
              ->  Hash  (actual time=118.9..118.9 rows=100000 loops=1)
                    ->  Seq Scan on users u  (rows=100000)
Execution Time: 4823.1 ms
```

Đọc: quét 5 triệu dòng, loại 4,69 triệu, giữ 310.000 — rồi sort và chỉ lấy 20. Gần như toàn bộ công việc bị vứt đi.

### Bước ⑤–⑥: một thay đổi, đo lại

```sql
CREATE INDEX CONCURRENTLY idx_orders_status_created
  ON orders (status, created_at DESC);
ANALYZE orders;
```

```text
Limit  (actual time=0.08..0.15 rows=20 loops=1)
  ->  Nested Loop  (actual time=0.07..0.14 rows=20 loops=1)
        ->  Index Scan Backward using idx_orders_status_created on orders o
              (actual time=0.04..0.06 rows=20 loops=1)
              Index Cond: (status = 'paid' AND created_at > ...)
              Buffers: shared hit=8
        ->  Index Scan using users_pkey on users u
              (actual time=0.003..0.003 rows=1 loops=20)
Execution Time: 0.19 ms
```

4823ms → 0,19ms. Ba điều đã đổi cùng lúc, và hiểu được vì sao mới là điều quan trọng:

```text
· index cho phép lọc mà không quét toàn bảng
· created_at DESC trong index → KHÔNG cần Sort
· có thứ tự sẵn → LIMIT 20 dừng sau 20 dòng, không cần 310.000 dòng
```

Điểm thứ ba là nguồn của phần lớn cải thiện: không phải "quét ít hơn" mà là "**dừng sớm**".

### Bước ⑦: tăng dữ liệu — bước bị bỏ nhiều nhất

```text
100k dòng   → 0,15 ms
1M dòng     → 0,18 ms
10M dòng    → 0,21 ms      ← tăng theo log(n): plan ĐÚNG
```

```text
Nếu thấy:
100k  → 15 ms
1M    → 150 ms
10M   → 1500 ms            ← tuyến tính: vẫn đang quét, index không giúp
```

Đường cong quan trọng hơn con số. Một query 50ms tăng tuyến tính sẽ là 5 giây sau một năm; một query 200ms tăng theo log sẽ vẫn là 250ms.

### Bảng dịch: tín hiệu → nguyên nhân → cách sửa

| Thấy trong plan | Nguyên nhân thường gặp | Sửa |
|---|---|---|
| `Seq Scan` + `Rows Removed by Filter` lớn | thiếu index / không sargable | thêm index đúng, viết lại điều kiện |
| `rows` lệch `actual rows` > 10× | thống kê cũ | `ANALYZE`; tăng `SET STATISTICS`; extended statistics |
| `Nested Loop` với `loops` rất lớn | thiếu index trên khoá join | index cột join |
| `Sort` + `external merge Disk` | `work_mem` không đủ | `SET LOCAL work_mem`; hoặc index để bỏ sort |
| `Hash` + `Batches: 8` | `work_mem` không đủ cho hash | như trên |
| `Buffers: read` rất cao | không trong cache / bloat | kiểm tra bloat; `shared_buffers` |
| `Heap Fetches` cao ở Index Only Scan | visibility map cũ | `VACUUM` bảng |
| `Filter` sau `Index Cond` với nhiều dòng bị loại | index thiếu cột | thêm cột vào index |
| `Bitmap Heap Scan` + `Recheck Cond` với `lossy` | `work_mem` nhỏ cho bitmap | tăng `work_mem` |
| Plan tốt ở psql, xấu từ app | prepared statement dùng generic plan | xem dưới |

### Generic plan: vì sao psql nhanh mà app chậm

PostgreSQL dùng "custom plan" (tối ưu cho tham số cụ thể) cho 5 lần thực thi đầu của một prepared statement, rồi có thể chuyển sang "generic plan" (một plan cho mọi tham số) nếu nó có vẻ không tệ hơn.

Với dữ liệu lệch — ví dụ `status = 'pending'` có 5.000 dòng còn `status = 'paid'` có 4 triệu — generic plan có thể tệ cho một trong hai.

```sql
-- ép hành vi
SET plan_cache_mode = 'force_custom_plan';    -- luôn tối ưu cho tham số
SET plan_cache_mode = 'auto';                 -- mặc định
```

Đây là nguyên nhân của lớp bug "chỉ chậm ở production, không tái hiện được bằng psql" mà rất khó đoán nếu không biết cơ chế.

## Example

Quy trình đầy đủ, viết thành một checklist chạy được:

```sql
-- ① tìm ứng viên
SELECT calls, round(mean_exec_time::numeric,2) AS avg_ms,
       round(total_exec_time::numeric) AS total_ms, left(query,80)
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- ② dữ liệu thật (xem bước ② ở trên), rồi ANALYZE

-- ③ baseline — chạy 3 lần, lấy lần thứ 2–3 (lần đầu nạp cache)
EXPLAIN (ANALYZE, BUFFERS) <query>;

-- ④ ghi lại: Execution Time, nút tốn nhất, rows vs actual rows, Buffers

-- ⑤ MỘT thay đổi
CREATE INDEX CONCURRENTLY ...;  ANALYZE <table>;

-- ⑥ đo lại, so với ④

-- ⑦ nhân 10 dữ liệu, đo lại — kiểm tra ĐƯỜNG CONG

-- ⑧ sau khi deploy: xác nhận ở pg_stat_statements
SELECT calls, mean_exec_time FROM pg_stat_statements WHERE query LIKE '%orders%';
```

Ghi kết quả vào một bảng ba cột — trước, sau, tỉ lệ. Nó là bằng chứng, và nó cũng là thứ bạn cần khi sáu tháng sau có người hỏi "index này để làm gì".

## Prediction

1. `cost=0.43..8.45` — đơn vị là gì?
2. `actual time=0.5..0.8 rows=100 loops=3000` — tổng chi phí thật của nút này?
3. `rows=10` nhưng `actual rows=50000` — nguyên nhân? Thêm index có sửa được không?
4. `Rows Removed by Filter: 4900000`, trả về 100 dòng — nói lên điều gì?
5. `Sort Method: external merge Disk: 82000kB` — vấn đề gì? Hai cách sửa?
6. `Buffers: shared hit=5 read=98000` — dữ liệu đến từ đâu? Lần chạy thứ hai sẽ khác không?
7. `Index Only Scan` với `Heap Fetches: 45000` — vì sao vẫn chạm heap? Sửa thế nào?
8. `EXPLAIN ANALYZE DELETE FROM orders WHERE ...` — có xoá dữ liệu không?
9. Query nhanh trong psql, chậm từ app với cùng tham số — nghi ngờ gì?
10. Query A: 3s × 10 lần/ngày. Query B: 5ms × 1 triệu lần/ngày. Sửa cái nào trước?
11. Đo với 1.000 dòng thấy Seq Scan dù có index — kết luận gì?
12. Sau khi thêm index, thời gian giảm 10 lần với 100k dòng nhưng tăng tuyến tính khi lên 1M — nghĩa là gì?

<details>
<summary>Đáp án</summary>

1. **Không có đơn vị** — chi phí tương đối của planner (đơn vị quy chiếu là chi phí đọc tuần tự một page). Chỉ dùng để so sánh giữa các plan, không so với mili giây.
2. `0.8ms × 3000 = 2,4 giây`, và tổng số dòng là `100 × 3000 = 300.000`.
3. Thống kê cũ. `ANALYZE` — **không** phải thêm index. Thêm index khi planner đang ước lượng sai thường làm mọi thứ khó đoán hơn.
4. Đọc 4,9 triệu dòng để giữ 100 — lãng phí gần như toàn bộ. Thiếu index hoặc điều kiện không sargable.
5. Sort tràn ra đĩa. Sửa: tăng `work_mem` (tốt nhất là `SET LOCAL` cho query này), hoặc tạo index khớp `ORDER BY` để bỏ hẳn bước sort.
6. Gần như toàn bộ từ **đĩa**. Lần hai sẽ nhiều `hit` hơn — đây là lý do phải chạy 2–3 lần và lấy lần sau.
7. Visibility map chưa cập nhật (autovacuum chưa chạy sau nhiều lần ghi). `VACUUM` bảng đó.
8. **CÓ** — `ANALYZE` thực thi thật. Phải bọc `BEGIN; ... ROLLBACK;`.
9. Generic plan của prepared statement, hoặc tham số khác kiểu dữ liệu (gây ép kiểu), hoặc cấu hình session khác (`work_mem`, `search_path`).
10. **B** — 5.000 giây/ngày so với 30 giây/ngày.
11. Không kết luận được gì — bảng quá nhỏ, Seq Scan đúng. Phải đo với dữ liệu thật.
12. Index giúp một phần nhưng vẫn còn một bước tuyến tính (thường là sort, hoặc một filter không dùng index). Đọc lại plan ở quy mô lớn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy `EXPLAIN ANALYZE` ba lần liên tiếp | Lần đầu chậm hơn nhiều (cache lạnh) |
| Nạp 1 triệu dòng, query ngay **không** `ANALYZE` | `rows` lệch xa `actual rows` |
| Chạy `ANALYZE`, lặp lại | Ước lượng đúng, plan có thể đổi hoàn toàn |
| `SET work_mem = '64kB'`, sort bảng lớn | `external merge Disk` |
| `SET LOCAL work_mem = '256MB'`, lặp lại | `quicksort Memory` |
| Tạo index khớp `ORDER BY`, lặp lại | Nút Sort biến mất hẳn |
| `SET enable_indexscan = off`, chạy query có index | Ép Seq Scan — so thời gian để xác nhận index đáng giá |
| `SET enable_seqscan = off` với query trả 90% bảng | Chậm hơn — chứng minh planner đúng |
| Chèn nhiều dòng rồi chạy Index Only Scan ngay | `Heap Fetches` cao |
| `VACUUM`, lặp lại | `Heap Fetches: 0` |
| `EXPLAIN ANALYZE UPDATE` không bọc transaction | Dữ liệu thay đổi thật |
| Đo với 10k, 100k, 1M, 10M dòng | Vẽ đường cong — log hay tuyến tính |
| `SET plan_cache_mode = 'force_generic_plan'` với dữ liệu lệch | Plan xấu cho một số tham số |

Hai dòng `enable_*` là công cụ chẩn đoán, không phải cấu hình. Chúng trả lời "nếu không dùng cách này thì chậm hơn bao nhiêu" — cách duy nhất để biết một index có thật sự đáng giá.

## What Usually Goes Wrong

- **Không đo baseline** → không biết đã cải thiện gì.
- **Sửa nhiều thứ cùng lúc** → không biết cái nào có tác dụng, và để lại index thừa.
- **Đo với dữ liệu nhỏ** → kết luận sai hoàn toàn.
- **Dữ liệu test phân phối đều** trong khi thật thì lệch → planner chọn plan khác ở production.
- **Quên `ANALYZE`** sau khi nạp dữ liệu → mọi số liệu vô nghĩa.
- **Chạy một lần** → đo cache lạnh và tưởng đó là hiệu năng thật.
- **Nhìn `cost` thay vì `actual time`** → tối ưu một con số không có đơn vị.
- **Quên nhân `loops`** → bỏ sót nút tốn nhất.
- **Bỏ qua `Buffers`** → không phân biệt được "chậm vì đọc đĩa" và "chậm vì tính toán".
- **`EXPLAIN ANALYZE` trên `UPDATE`/`DELETE` không bọc transaction** → sửa dữ liệu thật.
- **Tối ưu query hiếm** thay vì query tốn tổng thời gian nhiều nhất.
- **Không đo lại khi dữ liệu tăng** → plan tốt hôm nay, xấu sau sáu tháng.
- **Không xác nhận ở production** → thay đổi có thể không có tác dụng ở đó.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `cost` là mili giây | Là đơn vị tương đối của planner |
| `EXPLAIN` chạy query | Chỉ `EXPLAIN ANALYZE` mới chạy |
| `EXPLAIN ANALYZE` an toàn với mọi câu lệnh | Nó **thực thi** `UPDATE`/`DELETE`/`INSERT` |
| `actual time` là tổng | Là **mỗi lần lặp** |
| `rows` là tổng | Là trung bình mỗi lần lặp |
| Query chậm nhất là query tốn nhất | `total_exec_time` mới là chỉ số đúng |
| Đo một lần là đủ | Lần đầu là cache lạnh |
| Kết quả ở local áp dụng được cho production | Kích thước, phân phối, cấu hình đều khác |
| `Seq Scan` luôn là vấn đề | Với query trả nhiều dòng, nó đúng |
| Thêm index là cách sửa mặc định | Nhiều khi vấn đề là thống kê hoặc `work_mem` |

## Debugging

Thứ tự cố định, dừng khi tìm ra:

1. **`pg_stat_statements`** sắp theo `total_exec_time` — query nào đáng sửa.
2. **`EXPLAIN (ANALYZE, BUFFERS)`** với dữ liệu thật, chạy 2–3 lần.
3. **Tìm nút tốn nhất**: `actual time × loops` lớn nhất.
4. **So `rows` với `actual rows`** — lệch xa thì `ANALYZE` **trước khi** làm gì khác.
5. **Đọc `Rows Removed by Filter`** — con số này chỉ thẳng vào chỗ lãng phí.
6. **Kiểm tra `Sort Method` và `Batches`** — có tràn `work_mem` không.
7. **Kiểm tra `Buffers`** — `read` cao có thể là bloat, kiểm tra `n_dead_tup`.
8. **Sửa một thứ, đo lại.**
9. **Nhân 10 dữ liệu, đo lại.**
10. **Sau deploy, xác nhận bằng `pg_stat_statements`.**

Công cụ trực quan hữu ích: dán output `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` vào một plan visualizer để thấy nhanh nút nào chiếm phần lớn thời gian.

## Production Considerations

- **`pg_stat_statements` bật từ ngày đầu.** Không có nó, bạn không biết query nào tốn tài nguyên.
- **`auto_explain`** cho query chậm ở production:
  ```ini
  shared_preload_libraries = 'pg_stat_statements,auto_explain'
  auto_explain.log_min_duration = '1s'
  auto_explain.log_analyze = on          # ⚠️ có chi phí; cân nhắc log_timing = off
  auto_explain.log_buffers = on
  ```
  Nó ghi plan thật của query chậm — thứ bạn không tái hiện được sau đó.
- **`log_min_duration_statement = 1000`** như mạng lưới cơ bản.
- **Đừng chạy `EXPLAIN ANALYZE` trên query nặng ở primary lúc cao điểm** — nó thực thi thật. Dùng replica.
- **Ghi lại kết quả tối ưu** (trước/sau/tỉ lệ) trong PR. Nó là bằng chứng, và là tài liệu cho index bạn vừa thêm.
- **Đặt ngân sách hiệu năng**: "endpoint này p95 < 100ms với 10 triệu dòng". Không có số thì không biết khi nào xong.
- **Đo lại định kỳ** — dữ liệu tăng làm plan đổi. Một cảnh báo trên `mean_exec_time` tăng gấp đôi bắt được điều đó sớm.
- **Xoá index không dùng** sau khi tối ưu — dễ tích lại sau nhiều vòng thử nghiệm.
- **Cẩn thận với `work_mem` toàn cục.** Nó là **per sort/hash node, per connection**. Nâng cho một query cụ thể bằng `SET LOCAL` trong transaction, không nâng cho cả server.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Đo kỹ trước khi sửa | sửa đúng chỗ | tốn thời gian ban đầu |
| Sửa theo trực giác | nhanh | thường sai, để lại index thừa |
| Dữ liệu test lớn, phân phối thật | kết luận đáng tin | tốn thời gian và dung lượng |
| Dữ liệu test nhỏ | nhanh | kết luận có thể sai hoàn toàn |
| `auto_explain` với `log_analyze` | có plan thật của query chậm | chi phí runtime |
| `pg_stat_statements` | thấy toàn cảnh | chi phí nhỏ, tốn shared memory |
| `work_mem` cao toàn cục | ít tràn đĩa | rủi ro OOM (nhân với connection × node) |
| `SET LOCAL work_mem` | an toàn, có mục tiêu | phải nhớ đặt ở từng chỗ |
| Thêm index | đọc nhanh | ghi chậm, tốn chỗ |
| Viết lại query | không thêm chi phí ghi | tốn công, cần hiểu sâu |

## Explain Without Notes

1. Kể tám bước của quy trình theo thứ tự.
2. Vì sao sắp `pg_stat_statements` theo `total_exec_time` chứ không phải `mean_exec_time`?
3. `actual time` và `rows` trong plan là tổng hay mỗi lần lặp? Hệ quả khi đọc sai?
4. Bốn tín hiệu chẩn đoán trong một plan, và cái nào quan trọng nhất?
5. `rows` lệch `actual rows` nghĩa là gì, và vì sao thêm index không sửa được?
6. Vì sao phải chạy `EXPLAIN ANALYZE` nhiều lần?
7. Vì sao phải tăng dữ liệu rồi đo lại? Đường cong nào là dấu hiệu tốt?
8. Vì sao một query nhanh trong psql có thể chậm khi gọi từ app?

## Related

- [Index & query plan](01-index-query-plan.md) — vì sao planner chọn hay không chọn index
- [Index types](02-index-types.md) — chọn loại index đúng
- [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md) — bloat làm `Buffers: read` cao; `Heap Fetches`
- [Joins & aggregation](../../00-sql/02-joins-aggregation.md) — thuật toán join trong plan
- [Connection pool](../fundamentals/02-connection-pool.md) — query nhanh vẫn chậm nếu chờ connection
- [Database performance](../../../05-cross-cutting/performance/04-database-performance.md) — đo ở tầng hệ thống
- [Latency & throughput](../../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — phương pháp chung

## Version / Context

PostgreSQL 16. `pg_stat_statements` và `auto_explain` là extension cần `shared_preload_libraries`. `SETTINGS` trong `EXPLAIN` từ PostgreSQL 12. `plan_cache_mode` từ 12. Cột `total_exec_time`/`mean_exec_time` đổi tên từ `total_time`/`mean_time` ở PostgreSQL 13.
