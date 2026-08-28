---
level: foundation
area: database
prerequisites:
  - 01-relational-thinking.md
related:
  - 03-subqueries-cte.md
  - 04-window-functions.md
  - ../01-postgresql/02-index-query-plan.md
---

# Joins & aggregation

> Báo cáo doanh thu tháng chạy đúng suốt một năm. Rồi bộ phận vận hành bật tính năng "thanh toán nhiều lần cho một đơn hàng", và doanh thu tháng đó tăng gấp đôi trên dashboard trong khi tiền vào tài khoản không đổi. Query không hề thay đổi. Cái thay đổi là **cardinality** của một quan hệ.

## Position

```text
Service cần "danh sách + số liệu"
   ↓
SQL: JOIN (ghép) + GROUP BY (gom)   ← note này
   ↓
Planner chọn thuật toán join
   ↓
Storage
```

## Problem

Dữ liệu được chia ra nhiều bảng vì lý do chính đáng ([Normalization](../03-data-modeling/02-normalization.md)). Nhưng câu hỏi nghiệp vụ hầu như luôn cần dữ liệu từ nhiều bảng cùng lúc:

```text
"Danh sách đơn hàng kèm tên khách và tổng số món"
   → orders + users + order_items
```

Ghép chúng lại có hai phép toán, và **cả hai đều thay đổi số dòng**:

```text
JOIN      có thể NHÂN số dòng lên   (1 đơn → 6 dòng)
GROUP BY  GOM nhiều dòng thành một  (6 dòng → 1 dòng)
```

Khi hai phép toán này gặp nhau mà bạn không kiểm soát thứ tự và cardinality, kết quả sai theo cách **không báo lỗi**: một con số trông hợp lý nhưng lớn gấp N lần. Đó là loại bug đắt nhất trong SQL vì nó đi thẳng vào báo cáo tài chính.

## Mental Model

### Bốn kiểu JOIN, và câu hỏi chọn kiểu

```text
A = users (3 dòng: 1,2,3)     B = orders (user_id: 1,1,2,NULL)

INNER JOIN   chỉ dòng KHỚP cả hai         → 3 dòng (u1×2, u2×1)
LEFT JOIN    mọi dòng A + khớp nếu có     → 4 dòng (u1×2, u2×1, u3 với NULL)
RIGHT JOIN   mọi dòng B + khớp nếu có     → 4 dòng (…, order NULL với u NULL)
FULL JOIN    mọi dòng cả hai              → 5 dòng
CROSS JOIN   mọi tổ hợp                   → 3 × 4 = 12 dòng
```

Câu hỏi chọn kiểu chỉ có một: **"tôi có muốn giữ dòng KHÔNG có bản khớp không?"**

```text
"đơn hàng kèm tên khách"          → INNER  (đơn không có khách là dữ liệu hỏng)
"mọi khách kèm số đơn (kể cả 0)"  → LEFT   (khách 0 đơn vẫn phải xuất hiện)
```

Sai kiểu JOIN là cách phổ biến nhất làm **mất dòng im lặng**: dùng `INNER JOIN` cho câu hỏi thứ hai thì mọi khách chưa mua gì biến mất khỏi báo cáo, và bạn kết luận sai về tỉ lệ chuyển đổi.

### `ON` và `WHERE` không thay thế nhau trong LEFT JOIN

Đây là bẫy tinh vi nhất của JOIN.

```sql
-- ✅ giữ mọi user; chỉ đếm đơn năm 2026
SELECT u.name, count(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.created_at >= '2026-01-01'
GROUP BY u.id;
-- user không có đơn nào năm 2026 → count = 0, VẪN XUẤT HIỆN
```

```sql
-- ❌ điều kiện ở WHERE → LEFT JOIN biến thành INNER JOIN
SELECT u.name, count(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= '2026-01-01'
GROUP BY u.id;
-- user không có đơn → o.created_at là NULL → NULL >= '2026-01-01' là NULL → BỊ LOẠI
```

Quy tắc: **điều kiện lọc bảng bên phải của `LEFT JOIN` phải nằm trong `ON`, không nằm trong `WHERE`.** Với `INNER JOIN` thì hai chỗ tương đương.

Ngoại lệ hữu ích — đặt vào `WHERE` **có chủ đích** để tìm dòng không khớp:

```sql
-- "user chưa từng đặt hàng" — anti-join
SELECT u.* FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;
```

### GROUP BY: mỗi nhóm thành đúng một dòng

```text
TRƯỚC GROUP BY          SAU GROUP BY user_id
user_id  amount         user_id  sum   count
1        100            1        250   2
1        150            2        300   1
2        300
```

Quy tắc bất di bất dịch: **mọi cột trong `SELECT` phải hoặc nằm trong `GROUP BY`, hoặc nằm trong hàm aggregate.**

```sql
-- ❌ PostgreSQL từ chối
SELECT user_id, product_name, sum(amount) FROM orders GROUP BY user_id;
-- ERROR: column "product_name" must appear in the GROUP BY clause
--        or be used in an aggregate function
```

Lý do: mỗi nhóm có nhiều `product_name` khác nhau — database không thể tự chọn một cái. (MySQL ở chế độ nới lỏng **tự chọn bừa** một giá trị; đó là nguồn bug im lặng, và là lý do PostgreSQL nghiêm khắc ở đây là điều tốt.)

Ngoại lệ hợp lệ: cột phụ thuộc hàm vào khoá chính đã có trong `GROUP BY`.

```sql
SELECT u.id, u.name, u.email, count(o.id)
FROM users u LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id;          -- name, email hợp lệ vì u.id là PRIMARY KEY
```

### Aggregate và NULL

```sql
COUNT(*)          đếm mọi dòng, kể cả toàn NULL
COUNT(col)        BỎ QUA dòng col IS NULL
COUNT(DISTINCT col) đếm giá trị khác nhau, bỏ NULL
SUM/AVG/MIN/MAX   bỏ qua NULL
SUM của 0 dòng    → NULL, KHÔNG phải 0
```

Dòng cuối gây bug thật:

```sql
SELECT sum(amount) FROM payments WHERE order_id = 999;   -- không có dòng nào
-- → NULL, không phải 0
-- code: total = row.sum + shipping   →  NULL + 5 = NULL  →  "Tổng: null"
```

Luôn bọc: `COALESCE(sum(amount), 0)`.

Và trong `LEFT JOIN` + `GROUP BY`, `COUNT` phải đếm cột của **bảng bên phải**:

```sql
SELECT u.name, count(*) FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id;
-- ❌ user không có đơn → count(*) = 1 (đếm chính dòng u với o là NULL)

SELECT u.name, count(o.id) FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id;
-- ✅ count(o.id) = 0 vì o.id là NULL
```

### Fan-out: bug đắt nhất

```text
orders 1 dòng
  ├── order_items  3 dòng
  └── payments     2 dòng

JOIN cả hai → 3 × 2 = 6 dòng cho MỘT đơn hàng
   mỗi item xuất hiện 2 lần   → SUM(qty)    × 2
   mỗi payment xuất hiện 3 lần → SUM(amount) × 3
```

Đây chính là sự cố ở đầu note: khi mỗi đơn chỉ có 1 payment, `3 × 1 = 3` và `SUM(amount)` bị nhân 3 — nhưng nếu `SUM(amount)` được lấy từ một truy vấn khác thì không ai để ý. Ngày payments trở thành 1:N thật sự, con số nhảy.

Ba cách sửa, theo thứ tự ưu tiên:

```sql
-- 1. Gom TRƯỚC khi ghép (rõ ràng nhất, dễ đọc nhất)
SELECT o.id, i.qty, p.amount
FROM orders o
LEFT JOIN (SELECT order_id, sum(qty)    AS qty    FROM order_items GROUP BY order_id) i ON i.order_id = o.id
LEFT JOIN (SELECT order_id, sum(amount) AS amount FROM payments    GROUP BY order_id) p ON p.order_id = o.id;

-- 2. LATERAL — linh hoạt hơn, dùng được giá trị của o
SELECT o.id, i.qty, p.amount
FROM orders o
LEFT JOIN LATERAL (SELECT sum(qty)    AS qty    FROM order_items WHERE order_id = o.id) i ON true
LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM payments    WHERE order_id = o.id) p ON true;

-- 3. COUNT/SUM DISTINCT — chỉ đúng khi giá trị có id để phân biệt
SELECT o.id, count(DISTINCT i.id), count(DISTINCT p.id)
FROM orders o LEFT JOIN order_items i ON ... LEFT JOIN payments p ON ...
GROUP BY o.id;
-- ⚠️ SUM(DISTINCT amount) SAI nếu hai payment cùng số tiền — chúng bị gộp thành một
```

Cách 3 là cái bẫy: `count(DISTINCT id)` đúng, nhưng `sum(DISTINCT amount)` sai khi có giá trị trùng. Đừng dùng `DISTINCT` để sửa fan-out cho `SUM`.

### `FILTER`: nhiều số liệu trong một lần quét

```sql
SELECT
  date_trunc('day', created_at)                             AS day,
  count(*)                                                  AS total,
  count(*) FILTER (WHERE status = 'paid')                   AS paid,
  count(*) FILTER (WHERE status = 'cancelled')              AS cancelled,
  sum(total) FILTER (WHERE status = 'paid')                 AS revenue,
  round(avg(total) FILTER (WHERE status = 'paid'), 2)       AS avg_order
FROM orders
WHERE created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

`FILTER` (chuẩn SQL, PostgreSQL hỗ trợ) thay thế mẫu `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` và đọc rõ hơn nhiều. Quan trọng hơn: **một lần quét bảng cho sáu số liệu**, thay vì sáu query.

### Thuật toán join — vì sao query chậm

Planner chọn một trong ba, và biết chúng giúp bạn đọc `EXPLAIN`:

```text
NESTED LOOP    với mỗi dòng A, tìm trong B (cần index trên B)
               tốt khi A nhỏ; O(A × chi phí tìm B)

HASH JOIN      dựng bảng băm từ bảng nhỏ hơn, quét bảng lớn
               tốt cho join lớn không có index; cần bộ nhớ (work_mem)

MERGE JOIN     sắp xếp cả hai rồi ghép song song
               tốt khi cả hai đã sắp theo khoá join
```

Hai triệu chứng đáng nhớ:

- **Nested loop trên bảng lớn không index** → chậm theo cấp số nhân. Thường là do thiếu index trên cột FK.
- **Hash join tràn ra đĩa** (`Batches: 8` trong `EXPLAIN ANALYZE`) → `work_mem` không đủ.

Chi tiết: [Index & query plan](../01-postgresql/02-index-query-plan.md) và [EXPLAIN ANALYZE workflow](../01-postgresql/08-explain-analyze-workflow.md).

Một điều quan trọng về index: **PostgreSQL tự tạo index cho PRIMARY KEY nhưng KHÔNG tự tạo index cho FOREIGN KEY.** Đây là nguyên nhân rất phổ biến của join chậm.

```sql
CREATE INDEX ON order_items (order_id);   -- gần như luôn cần
```

## Example

Một query "danh sách + số liệu" viết đúng:

```sql
SELECT
  u.id,
  u.name,
  coalesce(s.order_count, 0)  AS order_count,       -- 0, không phải NULL
  coalesce(s.total_spent, 0)  AS total_spent,
  s.last_order_at
FROM users u
LEFT JOIN LATERAL (
  SELECT count(*)      AS order_count,
         sum(o.total)  AS total_spent,
         max(o.created_at) AS last_order_at
  FROM orders o
  WHERE o.user_id = u.id
    AND o.status = 'paid'
    AND o.created_at >= now() - interval '90 days'
) s ON true
WHERE u.deleted_at IS NULL
ORDER BY s.total_spent DESC NULLS LAST, u.id      -- u.id phá thế hoà → phân trang ổn định
LIMIT 50;
```

Năm quyết định trong query này:

```text
LEFT JOIN LATERAL   giữ mọi user, kể cả user 0 đơn
coalesce(..., 0)    NULL không đi ra API
điều kiện trong subquery  không làm LEFT thành INNER
NULLS LAST          user chưa mua nằm cuối, không phải đầu
ORDER BY ... , u.id  thứ tự tất định → LIMIT/OFFSET không trả trùng
```

## Prediction

```text
users        3 dòng (id 1,2,3)
orders       4 dòng (user_id: 1, 1, 2, NULL)
order_items  9 dòng (3 dòng cho mỗi order 1,2,3)
```

1. `users INNER JOIN orders` — bao nhiêu dòng?
2. `users LEFT JOIN orders` — bao nhiêu dòng?
3. `orders LEFT JOIN order_items` — bao nhiêu dòng?
4. `users LEFT JOIN orders LEFT JOIN order_items` — bao nhiêu dòng?
5. `SELECT u.name, count(*) FROM users u LEFT JOIN orders o ... GROUP BY u.id` — user 3 (không có đơn) có count bằng bao nhiêu?
6. Đổi thành `count(o.id)` — bằng bao nhiêu?
7. `sum(amount)` trên tập rỗng — giá trị gì? Code `sum + 10` cho ra gì?
8. `LEFT JOIN orders o ON o.user_id = u.id WHERE o.status = 'paid'` — user không có đơn paid có xuất hiện không?
9. Đưa `o.status = 'paid'` vào `ON` — thay đổi gì?
10. Đơn hàng có 3 item và 2 payment, JOIN cả hai rồi `sum(i.qty)` — sai bao nhiêu lần?
11. Dùng `sum(DISTINCT p.amount)` để sửa, và hai payment đều là 100.000đ — kết quả?
12. `SELECT user_id, product_name, sum(total) FROM orders GROUP BY user_id` trong PostgreSQL — chạy được không?

<details>
<summary>Đáp án</summary>

1. **3** — dòng `user_id` NULL không khớp.
2. **4** — 3 dòng khớp + user 3 với NULL.
3. **10** — 9 dòng item + order 4 (không có item) với NULL.
4. **10** — bước 1 cho 4 dòng (u1-o1, u1-o2, u2-o3, u3-NULL); order 4 (`user_id` NULL) không tham gia. Bước 2: ba dòng có order nhân lên 3 item = 9, cộng dòng u3 = 1. Tổng **10**.
5. **1** — `count(*)` đếm chính dòng user với các cột order là NULL.
6. **0** — `count(o.id)` bỏ qua NULL.
7. **NULL**. `NULL + 10 = NULL` → API trả `null`, UI hiển thị "null".
8. **Không** — điều kiện ở `WHERE` biến LEFT thành INNER.
9. User không có đơn paid xuất hiện với các cột order là NULL.
10. **2 lần** — mỗi item bị nhân theo số payment.
11. Trả về **100.000** thay vì 200.000 — `DISTINCT` gộp hai giá trị bằng nhau.
12. **Không.** PostgreSQL yêu cầu `product_name` phải trong `GROUP BY` hoặc trong aggregate.
</details>

Nếu bạn phải đoán ở câu 3 và 4 thay vì tính ra được, đó chính là kỹ năng note này muốn bạn luyện: **đếm dòng trước khi chạy**.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi `LEFT` thành `INNER` trong báo cáo "mọi khách hàng" | Bao nhiêu khách biến mất? Tỉ lệ chuyển đổi đổi thế nào? |
| Chuyển điều kiện từ `ON` sang `WHERE` trong LEFT JOIN | Đếm dòng trước/sau |
| JOIN hai bảng con rồi `SUM` | So với tổng thật; tính hệ số sai |
| "Sửa" bằng `DISTINCT` | `count` đúng lên nhưng `sum` vẫn sai — kiểm chứng |
| `count(*)` vs `count(o.id)` trong LEFT JOIN | 1 vs 0 |
| `sum()` trên tập rỗng, trả về API | UI hiển thị `null` |
| Xoá index trên cột FK, chạy `EXPLAIN ANALYZE` join 100k dòng | Nested loop, thời gian tăng vọt |
| Tạo lại index, chạy lại | So sánh plan và thời gian |
| Đặt `work_mem = '64kB'` rồi hash join bảng lớn | `Batches > 1` = tràn đĩa |
| `LIMIT 10 OFFSET 10` với `ORDER BY` cột có giá trị trùng, chạy nhiều lần | Dòng trùng/thiếu giữa các trang |
| Thêm `, id` vào `ORDER BY`, lặp lại | Ổn định |

## What Usually Goes Wrong

- **Fan-out** → aggregate bị nhân, báo cáo sai, không ai phát hiện.
- **Sai kiểu JOIN** → mất dòng im lặng, kết luận nghiệp vụ sai.
- **Điều kiện bảng phải trong `WHERE` của LEFT JOIN** → mất ngữ nghĩa LEFT.
- **`count(*)` thay vì `count(col)`** trong LEFT JOIN → 1 thay vì 0.
- **`sum()` trả NULL** → `null` đi ra API.
- **`DISTINCT` để chữa fan-out** → giấu triệu chứng, `SUM` vẫn sai, thêm chi phí sắp xếp.
- **Không index cột FK** → nested loop chậm; và PostgreSQL **không** tự tạo index này.
- **`ORDER BY` không tất định + `OFFSET`** → phân trang trùng/thiếu.
- **JOIN quá nhiều bảng trong một query** → planner chọn sai (mặc định PostgreSQL chuyển sang genetic optimizer từ 12 bảng).
- **Aggregate trên bảng lớn không có điều kiện thời gian** → quét toàn bảng mỗi lần mở dashboard.
- **`OFFSET` lớn** → database vẫn phải quét và bỏ qua N dòng. Dùng keyset pagination.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| JOIN chỉ ghép, không đổi số dòng | JOIN 1:N nhân số dòng |
| `ON` và `WHERE` tương đương | Chỉ với INNER JOIN |
| `DISTINCT` sửa được fan-out | Nó sửa `count`, không sửa `sum` |
| `count(*)` luôn đúng | Trong LEFT JOIN nó đếm cả dòng không khớp |
| `sum()` của tập rỗng là 0 | Là NULL |
| PostgreSQL tự index FK | Chỉ tự index PRIMARY KEY và UNIQUE |
| Nhiều JOIN thì luôn chậm | Chậm hay không phụ thuộc index và cardinality, không phụ thuộc số bảng |
| `GROUP BY` chỉ để đếm | Nó là phép biến đổi tập → tập nhóm |
| MySQL cho phép cột ngoài GROUP BY nên PostgreSQL khắt khe vô lý | MySQL chọn bừa một giá trị — đó là bug im lặng |
| `OFFSET` là cách phân trang | Với offset lớn nó quét và bỏ qua N dòng |

## Debugging

1. **Số dòng bất ngờ** → xoá `SELECT`, chạy `SELECT count(*)` rồi thêm từng JOIN một. JOIN nào làm số nhảy chính là nó.
2. **Tổng sai** → đếm dòng **trước** `GROUP BY`. Nhiều hơn số thực thể = fan-out.
3. **Thiếu dòng** → đổi `INNER` thành `LEFT` và đếm chênh lệch; kiểm tra điều kiện trong `WHERE`.
4. **`count` ra 1 thay vì 0** → dùng `count(col_bên_phải)`.
5. **`null` trong response** → tìm aggregate không có `coalesce`.
6. **Chậm** → `EXPLAIN (ANALYZE, BUFFERS)`. Tìm `Seq Scan` trên bảng lớn và `Nested Loop` với số vòng lớn.
7. **`rows` ước lượng lệch xa `actual rows`** → thống kê cũ; chạy `ANALYZE <table>`.
8. **Phân trang trả trùng** → `ORDER BY` chưa tất định.

Bước 1 và 2 chỉ cần `count(*)` và giải quyết phần lớn bug JOIN thật.

## Production Considerations

- **Index mọi cột FK bạn join** — PostgreSQL không tự làm.
- **Aggregate trên bảng lớn phải có điều kiện giới hạn phạm vi** (thường là thời gian) và index tương ứng. Một dashboard quét toàn bảng mỗi lần mở là một sự cố đang chờ.
- **Dashboard nặng nên dùng bảng tổng hợp hoặc materialized view**, làm mới định kỳ. Đổi độ tươi lấy độ ổn định — và đó thường là đánh đổi đúng cho báo cáo.
- **Keyset pagination thay `OFFSET`** khi danh sách dài: `WHERE (created_at, id) < (:last_created, :last_id) ORDER BY created_at DESC, id DESC LIMIT 50`. Xem [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md).
- **`statement_timeout`** chặn query báo cáo chạy vô hạn và giữ tài nguyên.
- **Đặt tên alias có nghĩa** (`o`, `oi`, `u` là đủ; `t1`, `t2` thì không) — query báo cáo sống nhiều năm và được đọc nhiều hơn viết.
- **Ghi lại định nghĩa nghiệp vụ của mỗi số liệu** cạnh query. "Doanh thu" tính theo đơn `paid` hay `shipped`, có gồm thuế không, có trừ hoàn tiền không — ba người sẽ cho ba con số khác nhau nếu không ghi.
- **Kiểm tra chéo mọi số liệu tài chính bằng một query độc lập**. Fan-out không báo lỗi; chỉ có đối chiếu mới bắt được.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| JOIN nhiều bảng trong một query | 1 round-trip | planner khó, query khó đọc |
| Nhiều query nhỏ ghép ở app | đơn giản, dễ cache riêng | nhiều round-trip, có thể N+1 |
| Subquery gom trước khi join | đúng, rõ ràng | thêm một bước quét |
| LATERAL | linh hoạt, dùng được giá trị bên ngoài | ít quen thuộc |
| `DISTINCT` | ngắn | giấu vấn đề thật, tốn sắp xếp |
| Aggregate real-time | luôn tươi | tốn tài nguyên mỗi lần gọi |
| Bảng tổng hợp / materialized view | nhanh, ổn định | dữ liệu trễ, phải làm mới |
| `OFFSET` pagination | đơn giản, nhảy trang được | chậm với offset lớn, không ổn định |
| Keyset pagination | nhanh, ổn định | không nhảy tới trang N |

## Explain Without Notes

1. Bốn kiểu JOIN và một câu hỏi để chọn giữa chúng?
2. Vì sao điều kiện ở `WHERE` biến `LEFT JOIN` thành `INNER JOIN`? Giải thích bằng NULL.
3. Fan-out là gì? Vẽ ví dụ với 3 item và 2 payment, chỉ ra hai con số sai.
4. Ba cách sửa fan-out, và vì sao `DISTINCT` không phải một trong số đó cho `SUM`?
5. Vì sao `count(*)` ra 1 còn `count(o.id)` ra 0 trong LEFT JOIN?
6. Ba thuật toán join, và triệu chứng khi mỗi cái chọn sai?
7. Vì sao `ORDER BY` không tất định làm phân trang trả trùng?

## Related

- [Relational thinking](01-relational-thinking.md) — thứ tự logic, NULL, cardinality
- [Subqueries & CTE](03-subqueries-cte.md) — chia query lớn, gom trước khi join
- [Window functions](04-window-functions.md) — số liệu theo nhóm mà **không** gom dòng
- [Index & query plan](../01-postgresql/02-index-query-plan.md) — vì sao join nhanh hay chậm
- [EXPLAIN ANALYZE workflow](../01-postgresql/08-explain-analyze-workflow.md) — đọc plan
- [Index types](../01-postgresql/07-index-types.md) — composite, partial, covering
- [Relationships & cardinality](../03-data-modeling/03-relationships-cardinality.md) — nguồn của fan-out
- [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — keyset vs offset
- [Database & transactions](../../02-backend-api/02-nestjs/06-database-integration-transactions.md) — N+1 từ phía ORM

## Version / Context

PostgreSQL 16. `FILTER` là chuẩn SQL, PostgreSQL hỗ trợ từ 9.4. `LATERAL` từ 9.3. Quy tắc `GROUP BY` cho phép cột phụ thuộc hàm vào PRIMARY KEY có từ PostgreSQL 9.1.
