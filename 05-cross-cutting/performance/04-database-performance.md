---
level: advanced
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - ../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md
  - 03-backend-performance.md
---

# Database performance

> Một truy vấn chạy 8ms trong staging và 4 giây trong production. Cùng phiên bản PostgreSQL, cùng schema, cùng index, cùng câu lệnh. Khác biệt duy nhất: staging có 50.000 dòng, production có 40 triệu. Ở 50.000 dòng, planner chọn seq scan và nó nhanh. Ở 40 triệu dòng, nó **vẫn chọn seq scan** — vì thống kê đã cũ và index không khớp thứ tự cột của mệnh đề `WHERE`. **Truy vấn không chậm dần; nó nhảy bậc khi planner đổi quyết định.**

## Position

```text
App  →  pool  →  network  →  parse → PLAN → execute → trả dữ liệu
                                       ↑
                    nơi cùng một câu lệnh cho hai kết quả khác nhau
```

## Problem

```text
Database là nút thắt phổ biến nhất của ứng dụng web, vì:
  · nó là tài nguyên DÙNG CHUNG — thêm pod không giúp
  · hành vi của nó PHỤ THUỘC DỮ LIỆU — nhanh ở dev, chậm ở production
  · chi phí không tuyến tính — index đúng biến O(n) thành O(log n)
  · nó có hàng đợi riêng (lock, pool) mà app không nhìn thấy
```

## Mental Model

### Bốn nguồn chậm, cần bốn cách sửa khác nhau

```text
① QUÁ NHIỀU TRUY VẤN        N+1 — mỗi cái nhanh, tổng thì không
② TRUY VẤN CHẬM              thiếu index, plan sai, quét quá nhiều dòng
③ TRANH CHẤP                 lock, deadlock, transaction dài
④ CHỜ TÀI NGUYÊN             pool cạn, I/O bão hoà, cache miss
```

```text
Phân biệt bằng dấu hiệu:
  nhiều span DB ngắn xếp liên tiếp        → ①
  một span DB dài                          → ②
  thời gian chờ lock cao, throughput thấp  → ③
  độ trễ app cao, độ trễ DB THẤP           → ④
```

### N+1: nguồn chậm số một trong ứng dụng dùng ORM

```ts
// ✗ 1 + 100 truy vấn
const orders = await repo.find({ take: 100 });
for (const o of orders) {
  o.customer = await customerRepo.findOne({ where: { id: o.customerId } });
}
```

```text
100 × 2ms = 200ms, cộng 100 vòng khứ hồi mạng.
Trong cùng datacenter, mỗi vòng ~0,5ms → thêm 50ms chỉ để đi lại.
```

```ts
// ✓ eager load — ORM sinh JOIN hoặc một truy vấn IN
const orders = await repo.find({ take: 100, relations: { customer: true } });

// ✓ hoặc gom thủ công khi cần kiểm soát
const ids = [...new Set(orders.map(o => o.customerId))];
const customers = await customerRepo.find({ where: { id: In(ids) } });
const byId = new Map(customers.map(c => [c.id, c]));
orders.forEach(o => { o.customer = byId.get(o.customerId); });
```

```text
Với GraphQL, N+1 xuất hiện tự nhiên vì mỗi resolver chạy độc lập
→ DataLoader gom các lời gọi trong cùng một tick thành một truy vấn IN
```

Cách phát hiện đáng tin nhất: **bật log truy vấn trong integration test** và đếm. Một test khẳng định "endpoint này chạy tối đa 3 truy vấn" bắt được hồi quy N+1 trước khi nó tới production.

### Index: cấu trúc và thứ tự cột

```text
Index B-tree trên (a, b, c) dùng được cho:
  WHERE a = ?
  WHERE a = ? AND b = ?
  WHERE a = ? AND b = ? AND c = ?
  WHERE a = ? ORDER BY b

KHÔNG dùng được (hoặc dùng kém) cho:
  WHERE b = ?              ← thiếu tiền tố trái
  WHERE c = ?
```

```text
Quy tắc thứ tự cột:
  ① cột dùng với "=" trước
  ② cột dùng với phạm vi (>, <, BETWEEN) sau
  ③ cột dùng cho ORDER BY sau cùng

Vì sau một điều kiện phạm vi, index không còn duy trì thứ tự cho cột tiếp theo.
```

```sql
-- WHERE tenant_id = ? AND created_at > ? ORDER BY created_at DESC
CREATE INDEX idx ON orders (tenant_id, created_at DESC);
--                           ↑ bằng      ↑ phạm vi + sắp xếp
```

```text
Index-only scan: nếu index chứa MỌI cột truy vấn cần,
database không cần đọc bảng.
  CREATE INDEX ... ON orders (tenant_id, created_at) INCLUDE (status, total_cents);
  → nhanh hơn đáng kể cho truy vấn đọc nhiều
```

### Thứ làm index vô hiệu

```sql
-- ✗ hàm trên cột → index thường không dùng được
WHERE LOWER(email) = 'a@b.com'
-- ✓ index biểu thức
CREATE INDEX ON users (LOWER(email));

-- ✗ ép kiểu ngầm
WHERE user_id = '123'          -- user_id là bigint, so với text
-- ✓ đúng kiểu
WHERE user_id = 123

-- ✗ LIKE với ký tự đại diện đầu
WHERE name LIKE '%abc'
-- ✓ trigram index nếu cần tìm giữa chuỗi
CREATE INDEX ON products USING gin (name gin_trgm_ops);

-- ✗ OR giữa các cột khác nhau — thường thành seq scan
WHERE email = ? OR phone = ?
-- ✓ UNION của hai truy vấn dùng được index
```

### Chi phí của index

```text
Mỗi index:
  − làm chậm INSERT/UPDATE/DELETE (phải cập nhật index)
  − chiếm dung lượng và bộ nhớ đệm
  − HOT update bị vô hiệu nếu index chứa cột bị sửa

⇒ index không dùng là chi phí thuần. Tìm chúng:
  SELECT relname, indexrelname, idx_scan
    FROM pg_stat_user_indexes WHERE idx_scan = 0;
```

Và index trùng lặp: index trên `(a)` là **thừa** nếu đã có index trên `(a, b)`.

### Đọc EXPLAIN: tìm gì trước

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

```text
Ba thứ nhìn trước:
  ① rows=<ước lượng> vs actual rows=<thật>
     lệch > 10 lần → THỐNG KÊ SAI → planner chọn nhầm
     → ANALYZE bảng; cân nhắc tăng default_statistics_target

  ② Seq Scan trên bảng lớn với điều kiện lọc chặt
     → thiếu index, hoặc index không dùng được

  ③ Buffers: shared read (đọc từ ĐĨA) vs shared hit (từ CACHE)
     read cao → dữ liệu không nằm trong bộ nhớ đệm
```

```text
Cạm bẫy phổ biến:
  · Nested Loop với ước lượng sai → chạy hàng triệu lần
  · Sort với "external merge Disk" → tăng work_mem
  · Rows Removed by Filter rất lớn → đọc nhiều, dùng ít → index sai
  · loops=N trong node con → nhân thời gian lên N lần
```

Xem [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).

### Vì sao staging nhanh mà production chậm

```text
① KÍCH THƯỚC DỮ LIỆU
   planner đổi chiến lược theo số dòng ước lượng
   → seq scan hợp lý ở 50.000 dòng, thảm hoạ ở 40 triệu

② THỐNG KÊ CŨ
   autovacuum không theo kịp bảng ghi nhiều
   → planner tin vào số cũ

③ PHÂN BỐ DỮ LIỆU LỆCH
   99% dòng có status='completed'
   → index trên status vô dụng cho giá trị đó, hữu ích cho giá trị hiếm
   → cân nhắc partial index: WHERE status = 'pending'

④ TÍNH ĐỒNG THỜI
   staging một người dùng; production có lock và tranh chấp

⑤ CACHE
   staging: dữ liệu nhỏ, nằm hết trong bộ nhớ
   production: dữ liệu vượt shared_buffers → đọc đĩa
```

Hệ quả thực tế: **test hiệu năng trên dữ liệu có kích thước và phân bố gần production**, không phải trên dữ liệu seed.

### Transaction dài: cái giá không nhìn thấy

```text
BEGIN
  ... gọi API bên ngoài 3 giây ...      ← giữ lock và snapshot suốt 3 giây
COMMIT
```

```text
Hậu quả:
  · giữ lock → chặn ghi khác
  · giữ snapshot → vacuum KHÔNG dọn được dead tuple
  · bảng phình (bloat) → mọi truy vấn chậm dần
  · giữ kết nối → pool cạn

⇒ KHÔNG BAO GIỜ gọi I/O ngoài trong transaction.
⇒ Đặt statement_timeout và idle_in_transaction_session_timeout.
```

Điểm về vacuum đáng chú ý: một transaction mở lâu ở **bất kỳ đâu** trong hệ thống cũng ngăn dọn dẹp trên **mọi bảng**. Đây là cách một báo cáo chạy 2 giờ làm chậm toàn bộ database.

### Phân trang: OFFSET không mở rộng được

```sql
-- ✗ OFFSET 100000 → đọc và BỎ 100.000 dòng
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 100000;

-- ✓ keyset pagination — thời gian không đổi theo trang
SELECT * FROM orders
 WHERE (created_at, id) < ($1, $2)         -- con trỏ từ dòng cuối trang trước
 ORDER BY created_at DESC, id DESC
 LIMIT 20;
```

```text
OFFSET 100.000 chậm hơn OFFSET 0 hàng trăm lần.
Keyset pagination có thời gian không đổi — nhưng không nhảy tới trang N được.
Với UI "cuộn vô hạn" hoặc "trang tiếp", keyset là lựa chọn đúng.
```

Và `COUNT(*)` trên bảng lớn cũng đắt: cân nhắc ước lượng từ `pg_class.reltuples` khi con số chính xác không quan trọng.

### Khi nào tối ưu ở tầng khác

```text
Index đúng rồi mà vẫn chậm → cân nhắc theo thứ tự:
  ① CACHE               dữ liệu đọc nhiều, đổi ít
  ② MATERIALIZED VIEW   tổng hợp phức tạp, chấp nhận dữ liệu trễ
  ③ DENORMALIZE         lưu sẵn giá trị tính toán (đổi lấy phức tạp khi ghi)
  ④ REPLICA ĐỌC         tách tải đọc — chú ý độ trễ replica
  ⑤ PHÂN VÙNG           bảng rất lớn với truy vấn theo khoảng thời gian
  ⑥ SHARDING            cuối cùng, và khó đảo ngược
```

## Example

Chẩn đoán truy vấn 4 giây ở sự cố đầu note:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.total_cents, c.name
  FROM orders o JOIN customers c ON c.id = o.customer_id
 WHERE o.tenant_id = 42 AND o.created_at > now() - interval '30 days'
 ORDER BY o.created_at DESC LIMIT 20;
```

```text
Seq Scan on orders  (cost=0..891234 rows=1000 width=..)
                    (actual time=0.3..3821 rows=284119 loops=1)
  Filter: (tenant_id = 42 AND created_at > ...)
  Rows Removed by Filter: 39715881
  Buffers: shared read=412883
                    ↑ đọc 3,2 GB từ đĩa

① ước lượng rows=1000, thực tế 284.119   → thống kê SAI lệch 284 lần
② Seq Scan trên 40 triệu dòng             → không dùng index
③ Rows Removed by Filter: 39,7 triệu      → đọc gần hết bảng để lấy 20 dòng
```

Ba bước sửa, mỗi bước kiểm chứng lại:

```sql
-- ① cập nhật thống kê trước — đôi khi chỉ cần thế
ANALYZE orders;
-- → planner vẫn chọn seq scan: không có index nào phù hợp

-- ② index đúng thứ tự cột: bằng trước, phạm vi + sắp xếp sau
CREATE INDEX CONCURRENTLY idx_orders_tenant_created
    ON orders (tenant_id, created_at DESC);
-- CONCURRENTLY: không khoá bảng khi tạo trên production
```

```text
Sau ②:
Limit  (actual time=0.08..0.42 rows=20 loops=1)
  → Index Scan Backward using idx_orders_tenant_created
      Index Cond: (tenant_id = 42 AND created_at > ...)
      Buffers: shared hit=27

4000ms → 0,4ms.  Đọc 27 buffer thay vì 412.883.
```

```sql
-- ③ nếu cần thêm: index-only scan bằng cách INCLUDE cột được chọn
CREATE INDEX CONCURRENTLY idx_orders_tenant_created_covering
    ON orders (tenant_id, created_at DESC) INCLUDE (total_cents, customer_id);
```

Và test hồi quy để vấn đề không quay lại:

```ts
it('endpoint danh sách đơn hàng chạy tối đa 3 truy vấn', async () => {
  const queries = captureQueries();                    // bật log truy vấn
  await api.as(user).get('/orders?limit=20').expect(200);
  expect(queries.count()).toBeLessThanOrEqual(3);      // bắt N+1 khi nó xuất hiện
});
```

## Prediction

1. Truy vấn 8ms ở staging (50.000 dòng), 4 giây ở production (40 triệu) — nguyên nhân có thể là gì?
2. `EXPLAIN` cho `rows=1000` nhưng `actual rows=284119` — vấn đề gì?
3. Index trên `(a, b, c)`, truy vấn `WHERE b = ?` — index có dùng được không?
4. Truy vấn `WHERE a = ? ORDER BY b` với index `(a, b)` — có cần sort riêng không?
5. Index `(created_at, tenant_id)` cho `WHERE tenant_id = ? AND created_at > ?` — tốt hay kém?
6. `WHERE LOWER(email) = ?` với index trên `email` — index có dùng được không?
7. `WHERE user_id = '123'` với `user_id` kiểu bigint — chuyện gì xảy ra?
8. 100 truy vấn 2ms trong cùng datacenter — tổng thời gian gồm cả mạng?
9. `OFFSET 100000 LIMIT 20` so với `OFFSET 0 LIMIT 20` — chênh bao nhiêu?
10. Keyset pagination — chênh bao nhiêu?
11. Transaction mở 3 giây để gọi API ngoài — ba hậu quả?
12. Một báo cáo chạy 2 giờ trong transaction — nó ảnh hưởng vacuum ở đâu?
13. Bảng có 8 index, thêm một index nữa — INSERT chậm hơn hay nhanh hơn?
14. `CREATE INDEX` không có `CONCURRENTLY` trên bảng production 40 triệu dòng — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. Planner đổi chiến lược theo kích thước; thống kê cũ; phân bố lệch; cache; tranh chấp.
2. **Thống kê sai** → planner chọn nhầm chiến lược.
3. **Không** (hoặc rất kém) — thiếu tiền tố trái.
4. **Không** — index đã cho thứ tự.
5. **Kém** — sau điều kiện phạm vi trên `created_at`, index không lọc `tenant_id` hiệu quả.
6. **Không** — cần index biểu thức trên `LOWER(email)`.
7. Ép kiểu; tuỳ trường hợp có thể **không dùng được index**.
8. 200ms truy vấn **+ ~50ms** vòng khứ hồi.
9. **Hàng trăm lần** — nó đọc và bỏ 100.000 dòng.
10. **Không chênh** — thời gian không đổi theo trang.
11. Giữ lock, chặn vacuum, giữ kết nối trong pool.
12. **Trên mọi bảng** — snapshot cũ ngăn dọn dead tuple toàn hệ thống.
13. **Chậm hơn** — mỗi index phải cập nhật.
14. **Khoá bảng** — mọi ghi bị chặn cho tới khi index xong.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `EXPLAIN (ANALYZE, BUFFERS)` một truy vấn chậm | Ước lượng lệch bao nhiêu? |
| So `rows` ước lượng và thực tế | Cần `ANALYZE` không? |
| Xoá một index rồi chạy lại truy vấn | Chậm bao nhiêu lần? |
| Đảo thứ tự cột trong index | Kết quả đổi thế nào? |
| Bọc cột trong `LOWER()` | Index còn dùng được không? |
| `OFFSET 0` so với `OFFSET 100000` | Chênh bao nhiêu? |
| Bật log truy vấn và đếm cho một endpoint | Có N+1 không? |
| `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0` | Index nào chưa bao giờ dùng? |
| Mở transaction và để idle 5 phút | Vacuum có chạy được không? |
| Chạy tải trên dữ liệu 1000 dòng và 10 triệu dòng | Plan có đổi không? |
| `pg_stat_statements` sắp theo `total_exec_time` | Truy vấn nào tốn nhiều nhất? |

## What Usually Goes Wrong

- **N+1** ẩn sau ORM hoặc GraphQL resolver.
- **Thứ tự cột index sai** — phạm vi trước bằng.
- **Hàm hoặc ép kiểu trên cột** làm index vô hiệu.
- **Thống kê cũ** → planner chọn nhầm.
- **Test hiệu năng trên dữ liệu nhỏ** → plan khác production.
- **`OFFSET` cho phân trang sâu.**
- **`SELECT *`** khi chỉ cần vài cột — chặn index-only scan.
- **Transaction dài** hoặc gọi I/O ngoài trong transaction.
- **Không có `statement_timeout`** → một truy vấn giữ pool.
- **Index thừa và trùng lặp** làm chậm ghi.
- **`CREATE INDEX` không `CONCURRENTLY`** trên production.
- **Không có `pg_stat_statements`** → không biết truy vấn nào tốn nhất.
- **Thêm replica đọc** khi vấn đề là truy vấn chậm, không phải tải đọc.
- **Đếm `COUNT(*)`** trên bảng lớn cho mỗi lần phân trang.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Thêm index luôn cải thiện | Nó làm chậm ghi và có thể không được dùng |
| Index trên mỗi cột trong `WHERE` là đủ | Index tổ hợp đúng thứ tự mới hiệu quả |
| Planner luôn chọn đúng | Nó chọn theo thống kê, và thống kê có thể cũ |
| Nhanh ở dev thì nhanh ở production | Kích thước và phân bố dữ liệu đổi plan |
| ORM sinh SQL tối ưu | Nó sinh SQL đúng, không nhất thiết tối ưu |
| `SELECT *` tiện và vô hại | Nó chặn index-only scan và tốn băng thông |
| `OFFSET` là cách phân trang chuẩn | Nó không mở rộng được |
| Transaction dài chỉ ảnh hưởng bảng liên quan | Nó chặn vacuum trên toàn hệ thống |
| Thêm replica giải quyết chậm | Chỉ giúp khi nút thắt là tải đọc |
| Cache giải quyết mọi vấn đề DB | Cache miss vẫn phải chạy truy vấn chậm đó |

## Debugging

1. **`pg_stat_statements`** sắp theo `total_exec_time` — truy vấn nào tốn nhiều thời gian nhất *tổng cộng*, không phải chậm nhất mỗi lần.
2. **`EXPLAIN (ANALYZE, BUFFERS)`** trên truy vấn đó; nhìn ước lượng vs thực tế, loại scan, và buffers.
3. **Ước lượng lệch nhiều** → `ANALYZE` bảng; nếu vẫn lệch, tăng `default_statistics_target` cho cột đó.
4. **Đếm truy vấn mỗi request** (log query trong dev) → phát hiện N+1.
5. **Kiểm tra chờ lock**: `pg_locks` join `pg_stat_activity` để tìm ai đang chặn ai.
6. **Transaction dài**: `SELECT pid, state, now() - xact_start AS age FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;`
7. **Bloat và vacuum**: `pg_stat_user_tables.n_dead_tup` và `last_autovacuum`.
8. **Chờ pool hay chờ DB**: so độ trễ ở app và `pg_stat_statements.mean_exec_time`. Chênh lệch là hàng đợi ở pool.

## Production Considerations

- **`pg_stat_statements` bật ở mọi môi trường** — không có nó thì mọi câu hỏi hiệu năng là phỏng đoán.
- **Index tổ hợp theo thứ tự: bằng → phạm vi → sắp xếp.**
- **`CREATE INDEX CONCURRENTLY`** trên production.
- **Rà soát index không dùng** định kỳ và xoá.
- **`statement_timeout`** và **`idle_in_transaction_session_timeout`** ở mức role.
- **Không gọi I/O ngoài trong transaction**; giữ transaction ngắn nhất có thể.
- **Keyset pagination** cho danh sách dài.
- **Chọn cột cần thiết**, không `SELECT *`.
- **Test hiệu năng trên dữ liệu có kích thước và phân bố gần production.**
- **Test khẳng định số truy vấn tối đa** cho endpoint quan trọng — chống hồi quy N+1.
- **Theo dõi**: tỉ lệ cache hit, dead tuple, độ trễ replica, số kết nối, chờ lock.
- **`autovacuum` điều chỉnh cho bảng ghi nhiều** — mặc định thường quá bảo thủ.
- **Kiểm tra `N pod × pool < max_connections`** trước mỗi lần scale.
- **Cân nhắc phân vùng** cho bảng rất lớn có truy vấn theo khoảng thời gian, trước khi nghĩ tới sharding.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Thêm index | đọc nhanh | ghi chậm, tốn dung lượng |
| Index covering (INCLUDE) | index-only scan | index lớn hơn |
| Denormalize | đọc nhanh | phức tạp khi ghi, rủi ro không nhất quán |
| Materialized view | tổng hợp nhanh | dữ liệu trễ, cần refresh |
| Cache | giảm tải DB | dữ liệu cũ, invalidation phức tạp |
| Replica đọc | tách tải đọc | độ trễ replica, phức tạp routing |
| Phân vùng | truy vấn theo khoảng nhanh | phức tạp DDL và migration |
| Sharding | mở rộng ghi | rất phức tạp, khó đảo ngược |
| Keyset pagination | thời gian không đổi | không nhảy tới trang N |
| `OFFSET` | đơn giản, nhảy trang được | không mở rộng |
| Transaction ngắn | ít tranh chấp | phải xử lý nhất quán ở tầng ứng dụng |

## Explain Without Notes

1. Bốn nguồn chậm ở tầng database và dấu hiệu phân biệt?
2. Quy tắc thứ tự cột trong index tổ hợp, và vì sao?
3. Ba thứ nhìn đầu tiên trong `EXPLAIN ANALYZE`?
4. Năm lý do truy vấn nhanh ở staging mà chậm ở production?
5. Ba thứ làm index vô hiệu?
6. Vì sao `OFFSET` không mở rộng được, và thay bằng gì?
7. Transaction dài gây ra ba hậu quả nào? Vì sao nó ảnh hưởng toàn hệ thống?
8. Cách phát hiện N+1 đáng tin nhất trong quy trình phát triển?

## Related

- [Latency & bottleneck](01-latency-throughput-bottleneck.md) — khung tối ưu chung
- [Backend performance](03-backend-performance.md) — pool và tầng ứng dụng
- [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) — quy trình chi tiết
- [Index & query plan](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — cách planner quyết định
- [Index types](../../03-database/01-postgresql/indexes-query-planning/02-index-types.md) — B-tree, GIN, GiST, BRIN
- [MVCC & vacuum](../../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — bloat và dead tuple
- [Locking & deadlock](../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) — tranh chấp
- [Connection pool](../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — hàng đợi trước database
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — giảm tải đọc
- [Replication & scaling](../../03-database/01-postgresql/operations/02-replication-scaling.md) — replica đọc

## Version / Context

Ví dụ dùng PostgreSQL 16. `pg_stat_statements` là extension, cần bật trong `shared_preload_libraries`. `INCLUDE` cho index covering có từ PostgreSQL 11. `CREATE INDEX CONCURRENTLY` không chạy trong transaction và có thể thất bại để lại index không hợp lệ (kiểm tra `pg_index.indisvalid`). Trigram index cần extension `pg_trgm`.
