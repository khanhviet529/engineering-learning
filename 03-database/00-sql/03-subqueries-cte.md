---
level: intermediate
area: database
prerequisites:
  - 02-joins-aggregation.md
related:
  - 04-window-functions.md
  - ../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md
---

# Subqueries & CTE

> Query báo cáo dài 180 dòng, không ai dám sửa. Nó đúng — chắc là vậy — nhưng để kiểm chứng bạn phải giữ toàn bộ nó trong đầu cùng một lúc. Note này về cách chia một query lớn thành những mảnh **kiểm chứng được từng mảnh**, và về hai cái bẫy hiệu năng đi kèm.

## Position

```text
Câu hỏi nghiệp vụ phức tạp
   ↓  chia thành các bước
Subquery / CTE                ← note này
   ↓
Planner: inline hay materialize?
   ↓
Storage
```

## Problem

Câu hỏi thật hiếm khi là một phép lọc. Nó thường là một **chuỗi**:

```text
"Top 10 khách hàng theo doanh thu 90 ngày qua,
 chỉ tính đơn đã thanh toán,
 kèm số đơn và ngày mua gần nhất,
 loại khách nội bộ,
 và chỉ những người có ít nhất 3 đơn"
```

Viết thẳng một câu SELECT cho ra thứ không đọc được. Và quan trọng hơn: **không debug được từng phần**. Khi con số sai, bạn không biết bước nào sai.

Vấn đề thứ hai là hiệu năng, và nó phản trực giác: hai cách viết cho **cùng một kết quả** có thể chênh nhau 1000 lần về tốc độ, tuỳ vào việc planner có "nhìn xuyên" được cấu trúc bạn viết hay không.

## Mental Model

### Bốn công cụ, bốn tình huống

```text
Subquery trong FROM   "một bảng tạm"           → gom trước khi join
Subquery trong WHERE  "một tập giá trị"        → IN / EXISTS
Subquery tương quan   "tính lại cho mỗi dòng"  → LATERAL thường tốt hơn
CTE (WITH)            "đặt tên cho một bước"   → chuỗi bước, đệ quy
```

### CTE là đặt tên, không phải tạo bảng

```sql
WITH paid_orders AS (
  SELECT * FROM orders WHERE status = 'paid' AND created_at >= now() - interval '90 days'
),
customer_stats AS (
  SELECT user_id, count(*) AS n, sum(total) AS revenue, max(created_at) AS last_at
  FROM paid_orders
  GROUP BY user_id
)
SELECT u.name, s.n, s.revenue, s.last_at
FROM customer_stats s
JOIN users u ON u.id = s.user_id
WHERE s.n >= 3 AND u.is_internal = false
ORDER BY s.revenue DESC
LIMIT 10;
```

Đọc từ trên xuống như một chương trình. Mỗi bước có tên, và mỗi bước **chạy độc lập được** để kiểm chứng:

```sql
-- debug: chạy riêng bước 1
SELECT * FROM orders WHERE status = 'paid' AND created_at >= now() - interval '90 days' LIMIT 5;
```

Đó là giá trị lớn nhất của CTE, và nó là giá trị về **con người**, không phải về máy.

### Cái bẫy: CTE từng là hàng rào tối ưu hoá

Đây là chi tiết phụ thuộc phiên bản mà bạn phải biết:

```text
PostgreSQL ≤ 11   CTE LUÔN được materialize — chạy xong, lưu kết quả tạm,
                  planner KHÔNG đẩy điều kiện vào trong được.

PostgreSQL ≥ 12   CTE không đệ quy, không tác dụng phụ và chỉ được tham chiếu
                  MỘT lần sẽ được INLINE (planner nhìn xuyên như subquery thường).
                  CTE được tham chiếu nhiều lần vẫn materialize theo mặc định.
                  Ép tay bằng: WITH x AS MATERIALIZED (...) / AS NOT MATERIALIZED (...)
```

Hệ quả trên PostgreSQL 11:

```sql
WITH all_orders AS (SELECT * FROM orders)          -- 10 triệu dòng, materialize hết
SELECT * FROM all_orders WHERE id = 42;            -- rồi mới lọc → cực chậm
```

Trên PostgreSQL 12+, cùng câu đó được inline và chạy nhanh. Nếu bạn đọc một bài viết cũ nói "CTE luôn chậm", đó là thông tin đúng cho phiên bản ≤ 11 và sai cho phiên bản hiện tại.

Khi nào **cố ý** dùng `MATERIALIZED`:

```sql
-- CTE tốn kém, dùng lại 3 lần → đảm bảo tính đúng một lần
WITH expensive AS MATERIALIZED (
  SELECT user_id, complex_calculation(...) AS score FROM huge_table
)
SELECT * FROM expensive a JOIN expensive b ON ... JOIN expensive c ON ...;
```

Và khi nào cố ý dùng `NOT MATERIALIZED`: khi một CTE được tham chiếu nhiều lần nhưng rẻ, và bạn muốn planner đẩy điều kiện vào trong từng chỗ dùng.

### `IN` vs `EXISTS` vs `JOIN`: ba cách hỏi "có tồn tại không"

```sql
-- IN — đơn giản, tốt khi tập con NHỎ
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);

-- EXISTS — dừng ngay khi tìm thấy dòng đầu tiên (semi-join)
SELECT * FROM users u WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.total > 1000
);

-- JOIN + DISTINCT — dễ NHÂN DÒNG, cần DISTINCT
SELECT DISTINCT u.* FROM users u JOIN orders o ON o.user_id = u.id WHERE o.total > 1000;
```

Ba điều thực tế:

1. **Planner của PostgreSQL thường biến cả ba thành cùng một plan (semi-join).** Đừng "tối ưu" bằng cách đổi qua lại mà không đo.
2. **`JOIN` khác hai cái kia về ngữ nghĩa**: nó nhân dòng nếu một user có nhiều đơn. `DISTINCT` che đi, nhưng nếu bạn `SELECT` thêm cột của `orders` thì kết quả khác hẳn.
3. **`NOT IN` với NULL là bẫy nghiêm trọng** — xem ngay dưới.

### `NOT IN` và NULL: cái bẫy trả về 0 dòng

```sql
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);
-- Nếu orders có MỘT dòng user_id = NULL → kết quả là 0 DÒNG. Luôn luôn.
```

Vì sao: `id NOT IN (1, 2, NULL)` tương đương `id <> 1 AND id <> 2 AND id <> NULL`. Vế cuối là `NULL`, nên toàn bộ biểu thức không bao giờ `TRUE`.

Không có lỗi, không có cảnh báo — chỉ là một danh sách rỗng, và người ta kết luận "không có khách hàng nào chưa mua".

```sql
-- ✅ NOT EXISTS xử lý NULL đúng
SELECT * FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);

-- ✅ hoặc anti-join
SELECT u.* FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.id IS NULL;
```

Quy tắc thực dụng: **dùng `NOT EXISTS`, không dùng `NOT IN`, trừ khi cột chắc chắn `NOT NULL`.**

### Subquery tương quan: chạy lại cho mỗi dòng

```sql
-- chạy một subquery cho MỖI dòng của users
SELECT u.name,
       (SELECT max(created_at) FROM orders o WHERE o.user_id = u.id) AS last_order
FROM users u;
```

Với 100.000 user, đây là 100.000 lần tra cứu. Có index trên `orders(user_id, created_at)` thì vẫn chấp nhận được; không có index thì đó là 100.000 lần quét bảng.

`LATERAL` làm cùng việc nhưng cho phép lấy **nhiều cột** trong một lần:

```sql
SELECT u.name, s.last_order, s.order_count
FROM users u
LEFT JOIN LATERAL (
  SELECT max(created_at) AS last_order, count(*) AS order_count
  FROM orders o WHERE o.user_id = u.id
) s ON true;
```

Với subquery tương quan, mỗi cột cần một subquery riêng — ba cột là ba lần quét. `LATERAL` quét một lần.

Và `LATERAL` là công cụ tự nhiên nhất cho "top N mỗi nhóm" khi cần cả hàng:

```sql
-- 3 đơn hàng gần nhất của mỗi khách
SELECT u.name, o.id, o.created_at
FROM users u
CROSS JOIN LATERAL (
  SELECT id, created_at FROM orders WHERE user_id = u.id
  ORDER BY created_at DESC LIMIT 3
) o;
```

(Cách khác dùng window function — xem [Window functions](04-window-functions.md). `LATERAL` thường nhanh hơn khi có index `(user_id, created_at DESC)` vì nó dừng sau 3 dòng thay vì xếp hạng toàn bộ.)

### CTE đệ quy: dữ liệu phân cấp

```sql
-- mọi task con, cháu, chắt... của một task
WITH RECURSIVE descendants AS (
  SELECT id, parent_id, title, 1 AS depth       -- neo
  FROM tasks WHERE id = :root_id

  UNION ALL                                      -- ALL, không phải UNION

  SELECT t.id, t.parent_id, t.title, d.depth + 1
  FROM tasks t
  JOIN descendants d ON t.parent_id = d.id
  WHERE d.depth < 20                             -- CHẶN AN TOÀN — bắt buộc
)
SELECT * FROM descendants;
```

Ba chi tiết bắt buộc:

1. **`UNION ALL` chứ không `UNION`** — `UNION` phải khử trùng lặp ở mỗi bước, đắt hơn nhiều.
2. **Giới hạn độ sâu.** Nếu dữ liệu có chu trình (A là cha của B, B là cha của A do một bug), query chạy vô hạn cho tới khi hết bộ nhớ.
3. **Index trên `parent_id`** — không có nó, mỗi bước là một lần quét toàn bảng.

Phát hiện chu trình một cách tường minh:

```sql
WITH RECURSIVE d AS (
  SELECT id, parent_id, ARRAY[id] AS path, false AS cycle FROM tasks WHERE id = :root
  UNION ALL
  SELECT t.id, t.parent_id, d.path || t.id, t.id = ANY(d.path)
  FROM tasks t JOIN d ON t.parent_id = d.id
  WHERE NOT d.cycle
)
SELECT * FROM d;
```

## Example

Query báo cáo ở đầu note, viết đúng:

```sql
WITH paid AS (
  SELECT user_id, total, created_at
  FROM orders
  WHERE status = 'paid'
    AND created_at >= now() - interval '90 days'      -- lọc SỚM, dùng được index
),
stats AS (
  SELECT user_id,
         count(*)          AS order_count,
         sum(total)        AS revenue,
         max(created_at)   AS last_order_at
  FROM paid
  GROUP BY user_id
  HAVING count(*) >= 3                                 -- lọc NHÓM ngay tại đây
)
SELECT u.id, u.name, s.order_count, s.revenue, s.last_order_at
FROM stats s
JOIN users u ON u.id = s.user_id
WHERE u.is_internal = false
ORDER BY s.revenue DESC, u.id
LIMIT 10;
```

Bốn tính chất:

```text
đọc được từ trên xuống       mỗi CTE là một bước có tên
kiểm chứng từng bước         chạy riêng "paid" để đếm dòng
lọc sớm                      điều kiện thời gian ở CTE đầu tiên, không ở cuối
ORDER BY tất định            revenue có thể hoà → thêm u.id
```

## Prediction

1. `WITH x AS (SELECT * FROM orders) SELECT * FROM x WHERE id = 42` trên PostgreSQL 11 vs 16 — khác nhau thế nào?
2. `SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders)` khi `orders` có một dòng `user_id` NULL — bao nhiêu dòng?
3. Đổi thành `NOT EXISTS` — bao nhiêu dòng?
4. Một CTE được tham chiếu 3 lần trên PostgreSQL 16, không ghi `MATERIALIZED` — nó được inline hay materialize?
5. Subquery tương quan lấy 3 cột (max, count, sum) — bao nhiêu lần quét bảng con? Với `LATERAL` thì sao?
6. CTE đệ quy dùng `UNION` thay `UNION ALL` — khác gì về hiệu năng?
7. CTE đệ quy trên dữ liệu có chu trình, không giới hạn depth — chuyện gì xảy ra?
8. `JOIN` thay cho `EXISTS` khi một user có 5 đơn thoả điều kiện — bao nhiêu dòng cho user đó?
9. `WHERE created_at >= ...` đặt ở CTE cuối thay vì CTE đầu (PostgreSQL 16) — plan có chắc chắn giống nhau không?
10. `HAVING count(*) >= 3` đổi thành `WHERE count(*) >= 3` — lỗi gì?

<details>
<summary>Đáp án</summary>

1. PostgreSQL 11: materialize toàn bộ bảng rồi mới lọc → rất chậm. PostgreSQL 16: inline, dùng index trên `id` → tức thì.
2. **0 dòng.** Luôn luôn, bất kể dữ liệu.
3. Số dòng đúng — `NOT EXISTS` xử lý NULL theo ngữ nghĩa mong đợi.
4. **Materialize.** Quy tắc inline chỉ áp dụng cho CTE được tham chiếu đúng một lần. Muốn ngược lại thì ghi `NOT MATERIALIZED`.
5. Subquery tương quan: **3 lần** (mỗi cột một subquery). `LATERAL`: **1 lần**.
6. `UNION` khử trùng lặp ở mỗi vòng lặp → thêm một bước sort/hash mỗi bước; chậm hơn đáng kể.
7. Chạy vô hạn, tiêu thụ bộ nhớ tăng dần, cuối cùng lỗi hoặc làm chết instance.
8. **5 dòng** — cần `DISTINCT`. `EXISTS` cho 1 dòng.
9. **Không chắc chắn.** Planner thường đẩy được điều kiện xuống, nhưng có nhiều trường hợp nó không đẩy được (qua aggregate, qua window function, qua `LIMIT`). Lọc sớm là thói quen đúng vì nó không phụ thuộc vào việc planner có làm được hay không.
10. `aggregate functions are not allowed in WHERE` — `WHERE` chạy trước `GROUP BY`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `NOT IN` với subquery có NULL | 0 dòng; thêm `WHERE x IS NOT NULL` và so sánh |
| Chạy cùng CTE trên PostgreSQL 11 và 16 (`EXPLAIN`) | Materialize vs inline |
| Thêm `AS MATERIALIZED` vào CTE nhỏ dùng một lần | Plan xấu đi — chứng minh nó là hàng rào |
| CTE tốn kém dùng 3 lần, có và không có `NOT MATERIALIZED` | So thời gian; cái nào nhanh hơn phụ thuộc chi phí CTE |
| Đổi `LATERAL` thành 3 subquery tương quan | Đếm số lần quét trong `EXPLAIN ANALYZE` |
| CTE đệ quy không giới hạn depth trên dữ liệu có chu trình | Query treo; chuẩn bị `pg_cancel_backend` |
| Đổi `UNION ALL` thành `UNION` trong CTE đệ quy | Đo thời gian |
| Xoá index trên `parent_id`, chạy CTE đệ quy | Mỗi bước là seq scan |
| `EXISTS` vs `IN` vs `JOIN DISTINCT` trên cùng dữ liệu | So plan — có thể giống hệt nhau |
| Đặt điều kiện lọc ở CTE cuối thay vì đầu | So `rows` ở từng nút trong plan |

## What Usually Goes Wrong

- **`NOT IN` với cột nullable** → 0 dòng, im lặng, kết luận nghiệp vụ sai.
- **CTE dùng như hàng rào mà không biết** (PostgreSQL ≤ 11) → chậm không giải thích được.
- **`MATERIALIZED` dùng bừa** → chặn planner tối ưu.
- **Subquery tương quan cho nhiều cột** → nhân số lần quét.
- **Subquery tương quan không có index** → O(n × m).
- **CTE đệ quy không giới hạn depth** → treo khi có chu trình.
- **`UNION` thay `UNION ALL`** → khử trùng lặp không cần thiết ở mỗi bước.
- **Lọc muộn** → xử lý nhiều dòng hơn cần thiết ở mọi bước trung gian.
- **`JOIN` thay `EXISTS`** → nhân dòng, và `DISTINCT` che mất.
- **CTE lồng CTE 8 tầng** → dễ đọc hơn một câu SELECT khổng lồ, nhưng vẫn không ai kiểm chứng được. Cân nhắc view hoặc bảng tổng hợp.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| CTE luôn chậm hơn subquery | Đúng với PostgreSQL ≤ 11; từ 12 thì được inline nếu dùng một lần |
| CTE tạo bảng tạm trên đĩa | Nó là một tên; có materialize hay không do planner |
| `IN` chậm hơn `EXISTS` | Planner thường cho cùng plan; hãy đo |
| `NOT IN` và `NOT EXISTS` tương đương | Khác hẳn khi có NULL |
| Subquery tương quan luôn chậm | Với index phù hợp và tập ngoài nhỏ thì ổn |
| CTE đệ quy chỉ dùng cho cây | Còn dùng cho đồ thị, chuỗi ngày, tính lặp |
| Viết query dài hơn thì chậm hơn | Số dòng SQL không liên quan tới plan |
| `WITH` giúp tái sử dụng nên nhanh hơn | Chỉ khi được materialize; nếu inline thì tính lại |

## Debugging

1. **Kết quả rỗng bất ngờ** → tìm `NOT IN` trước tiên. Đây là nguyên nhân số một.
2. **Chậm không hiểu vì sao** → `EXPLAIN (ANALYZE, BUFFERS)`. Tìm `CTE Scan` (đã materialize) và so `rows` ước lượng với `actual rows`.
3. **Chia để trị**: chạy từng CTE riêng, đếm dòng ở mỗi bước. Bước nào ra số bất ngờ là bước cần xem.
4. **Nghi CTE là hàng rào** → thử `AS NOT MATERIALIZED` và so plan.
5. **Subquery tương quan chậm** → `EXPLAIN ANALYZE` cho biết số vòng lặp (`loops=`). Nhân với thời gian mỗi vòng.
6. **CTE đệ quy treo** → thêm `depth < N` và `path` để phát hiện chu trình.
7. **Không biết bước nào tốn nhất** → đọc plan từ **trong ra ngoài**, tìm nút có `actual time` lớn nhất.

## Production Considerations

- **Lọc càng sớm càng tốt.** Đừng dựa vào việc planner đẩy điều kiện xuống — nó thường làm được, nhưng "thường" không phải "luôn".
- **Đặt tên CTE theo nghĩa nghiệp vụ** (`paid_orders`, `active_customers`), không phải `t1`, `cte2`. Query báo cáo sống nhiều năm.
- **CTE đệ quy phải có giới hạn độ sâu**, không có ngoại lệ. Dữ liệu có chu trình là chuyện *khi nào*, không phải *có hay không*.
- **`statement_timeout`** cho query báo cáo — nó là mạng lưới an toàn cuối cùng khi một CTE đệ quy đi sai hướng.
- **Query báo cáo nặng nên chạy trên read replica**, không trên primary. Xem [Replication & scaling](../01-postgresql/operations/02-replication-scaling.md).
- **View cho query dùng lại nhiều nơi**; materialized view khi chấp nhận được độ trễ. `REFRESH MATERIALIZED VIEW CONCURRENTLY` không khoá đọc nhưng đòi hỏi view có một unique index.
- **Đưa query báo cáo vào version control** cùng code, không để nó sống trong một BI tool mà không ai review.
- **Kiểm tra chéo mọi số liệu tài chính** bằng một query viết theo cách khác. Đây là cách duy nhất bắt được lỗi logic trong query dài.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| CTE | đọc được, debug từng bước | có thể chặn tối ưu nếu materialize |
| Subquery trong FROM | planner tự do nhất | khó đọc khi lồng sâu |
| `MATERIALIZED` tường minh | tránh tính lại | chặn đẩy điều kiện xuống |
| `NOT EXISTS` | đúng với NULL | dài hơn `NOT IN` một chút |
| `NOT IN` | ngắn | sai im lặng với NULL |
| Subquery tương quan | viết tự nhiên | nhân số lần quét theo số cột |
| `LATERAL` | một lần quét, nhiều cột | cú pháp ít quen |
| CTE đệ quy | giải được bài toán phân cấp | rủi ro treo, khó đọc |
| Bảng đóng (closure table) thay đệ quy | đọc nhanh | ghi phức tạp, tốn chỗ |
| View | tái dùng, đặt tên | ẩn chi phí; dễ lồng view vào view |
| Materialized view | nhanh, ổn định | dữ liệu trễ, cần refresh |

## Explain Without Notes

1. Vì sao `NOT IN` trả 0 dòng khi subquery có NULL? Viết lại đúng bằng hai cách.
2. CTE trên PostgreSQL 11 và 16 khác nhau thế nào? Điều kiện để một CTE được inline là gì?
3. Subquery tương quan khác `LATERAL` ở điểm nào khi cần 3 cột?
4. Ba điều bắt buộc của một CTE đệ quy, và điều gì xảy ra khi thiếu từng cái?
5. `EXISTS` khác `JOIN` ở điểm nào về số dòng?
6. Vì sao "lọc sớm" là thói quen đúng dù planner thường tự làm được?

## Related

- [Joins & aggregation](02-joins-aggregation.md) — gom trước khi join để tránh fan-out
- [Window functions](04-window-functions.md) — cách khác cho "top N mỗi nhóm"
- [Relational thinking](01-relational-thinking.md) — NULL, thứ tự logic
- [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) — đọc plan của CTE
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — vì sao subquery tương quan cần index
- [Replication & scaling](../01-postgresql/operations/02-replication-scaling.md) — chạy báo cáo ở đâu

## Version / Context

PostgreSQL 16. Hành vi inline CTE thay đổi ở PostgreSQL 12; `MATERIALIZED`/`NOT MATERIALIZED` có từ 12. `LATERAL` từ 9.3. `WITH RECURSIVE` là chuẩn SQL.
