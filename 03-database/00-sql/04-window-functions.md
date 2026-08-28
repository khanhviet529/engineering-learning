---
level: intermediate
area: database
prerequisites:
  - 02-joins-aggregation.md
related:
  - 03-subqueries-cte.md
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# Window functions

> "Cho tôi danh sách đơn hàng, kèm thứ hạng của mỗi đơn theo giá trị trong tháng đó, và phần trăm so với đơn lớn nhất của khách hàng đó." Với `GROUP BY`, bạn không làm được — vì `GROUP BY` **gom dòng lại**, mà bạn cần **giữ nguyên dòng** và thêm thông tin về nhóm vào cạnh nó.

## Position

```text
SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ...
   ↓
WINDOW FUNCTION  ← chạy SAU khi đã gom nhóm, TRƯỚC ORDER BY/LIMIT
   ↓
ORDER BY / LIMIT
```

Vị trí trong thứ tự thực thi logic quan trọng: window function chạy ở bước 6 (cùng `SELECT`), nên nó **không dùng được trong `WHERE` và `HAVING`** — lý do bạn thường phải bọc nó trong một CTE.

## Problem

`GROUP BY` đánh đổi: bạn được số liệu tổng hợp, bạn **mất** các dòng chi tiết.

```sql
SELECT user_id, sum(total) FROM orders GROUP BY user_id;
-- 1.000 đơn → 200 dòng. Không còn biết từng đơn là gì.
```

Nhưng rất nhiều câu hỏi thật cần **cả hai**:

```text
"Từng đơn hàng, kèm tổng chi tiêu của khách đó"
"Từng đơn, kèm thứ hạng trong tháng"
"Từng đơn, kèm chênh lệch so với đơn liền trước"
"Doanh thu mỗi ngày, kèm tổng luỹ kế từ đầu tháng"
"3 đơn lớn nhất của MỖI khách"
```

Không có window function, mỗi câu trên cần một self-join hoặc một subquery tương quan:

```sql
-- ❌ cách cũ: subquery tương quan, chạy lại cho mỗi dòng
SELECT o.*,
       (SELECT sum(total) FROM orders x WHERE x.user_id = o.user_id) AS user_total,
       (SELECT count(*)   FROM orders x WHERE x.user_id = o.user_id AND x.total > o.total) + 1 AS rank
FROM orders o;
-- 2 subquery × số dòng. Với 100.000 đơn: 200.000 lần quét.
```

```sql
-- ✅ window function: MỘT lần quét
SELECT o.*,
       sum(total) OVER (PARTITION BY user_id)                      AS user_total,
       rank()     OVER (PARTITION BY user_id ORDER BY total DESC)  AS rank
FROM orders o;
```

## Mental Model

### `OVER` = "nhìn sang các dòng khác mà không gom chúng lại"

```text
GROUP BY:  N dòng  →  M nhóm  →  M dòng          (mất chi tiết)
WINDOW:    N dòng  →  N dòng, mỗi dòng có thêm thông tin về nhóm của nó
```

Một cửa sổ (window) được định nghĩa bằng ba phần, và mỗi phần trả lời một câu:

```sql
func() OVER (
  PARTITION BY user_id           -- "nhóm nào?"       (như GROUP BY, nhưng không gom)
  ORDER BY created_at            -- "thứ tự nào?"     (bắt buộc cho rank, lag, luỹ kế)
  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW   -- "phạm vi bao nhiêu dòng?"
)
```

Bỏ `PARTITION BY` = toàn bộ tập kết quả là một cửa sổ.

### Ba nhóm hàm

```text
XẾP HẠNG        row_number()  1,2,3,4     luôn duy nhất
                rank()        1,2,2,4     hoà thì nhảy số
                dense_rank()  1,2,2,3     hoà thì không nhảy
                ntile(4)      chia làm 4 phần bằng nhau (tứ phân vị)
                percent_rank(), cume_dist()

ĐIỀU HƯỚNG      lag(col, 1)    giá trị dòng TRƯỚC
                lead(col, 1)   giá trị dòng SAU
                first_value(), last_value(), nth_value()

TỔNG HỢP        sum(), avg(), count(), min(), max()  — dùng với OVER
```

`row_number` vs `rank` vs `dense_rank` không phải chi tiết vặt — chọn sai cho ra kết quả sai:

```text
điểm:        95  90  90  85
row_number:   1   2   3   4     ← "lấy 1 dòng mỗi nhóm" — dùng cái này
rank:         1   2   2   4     ← "hạng thi đấu" — hai người đồng hạng 2, không có hạng 3
dense_rank:   1   2   2   3     ← "bậc lương" — không bỏ trống bậc
```

Nếu bạn cần "đúng một dòng cho mỗi khách" mà dùng `rank()`, khách có hai đơn cùng giá trị sẽ cho **hai** dòng.

### `ROWS` vs `RANGE`: cái bẫy của tổng luỹ kế

Mặc định khi có `ORDER BY` mà không ghi frame là:

```sql
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

`RANGE` gộp **mọi dòng có cùng giá trị sắp xếp** vào "current row". Với dữ liệu có giá trị trùng, đó không phải điều bạn muốn:

```text
ngày         doanh thu   sum() OVER (ORDER BY ngày)
2026-01-01   100         100
2026-01-01   200         300   ← cả hai dòng đều là 300, vì RANGE gộp cùng ngày
2026-01-02   50          350
```

```sql
-- muốn luỹ kế theo TỪNG DÒNG → ghi ROWS tường minh
sum(amount) OVER (ORDER BY created_at, id ROWS UNBOUNDED PRECEDING)
```

Quy tắc thực dụng: **luôn ghi `ROWS` tường minh cho tổng luỹ kế**, và luôn thêm một cột phá thế hoà vào `ORDER BY`.

Cùng cái bẫy với `last_value`:

```sql
-- ❌ trả về chính dòng hiện tại, không phải dòng cuối
last_value(total) OVER (PARTITION BY user_id ORDER BY created_at)

-- ✅
last_value(total) OVER (PARTITION BY user_id ORDER BY created_at
                        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)

-- ✅ đơn giản hơn: đảo thứ tự và dùng first_value
first_value(total) OVER (PARTITION BY user_id ORDER BY created_at DESC)
```

### Không dùng được trong `WHERE` — bọc bằng CTE

```sql
-- ❌ window function chưa tồn tại ở bước WHERE
SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY total DESC) AS rn
FROM orders WHERE rn <= 3;
-- ERROR: column "rn" does not exist

-- ✅
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY total DESC) AS rn
  FROM orders
)
SELECT * FROM ranked WHERE rn <= 3;
```

Đây là mẫu "top N mỗi nhóm" kinh điển. So với `LATERAL`:

```text
row_number + CTE   xếp hạng TOÀN BỘ bảng rồi lọc
                   → tốt khi tập nhỏ hoặc cần nhiều thông tin xếp hạng

LATERAL + LIMIT    với mỗi nhóm, lấy N dòng đầu rồi dừng
                   → nhanh hơn nhiều khi có index (user_id, total DESC)
                     và số nhóm nhỏ so với số dòng
```

Với 1 triệu đơn của 200 khách và index phù hợp, `LATERAL` thắng rõ rệt. Với 10.000 đơn, khác biệt không đáng kể. **Đo, đừng đoán.**

### `WINDOW` clause: đặt tên cho cửa sổ dùng lại

```sql
SELECT
  user_id, created_at, total,
  sum(total)   OVER w AS running_total,
  row_number() OVER w AS n,
  lag(total)   OVER w AS prev_total
FROM orders
WINDOW w AS (PARTITION BY user_id ORDER BY created_at ROWS UNBOUNDED PRECEDING);
```

Ngoài chuyện đọc gọn hơn, nó đảm bảo ba hàm dùng **đúng cùng một** định nghĩa cửa sổ — sao chép định nghĩa ba lần là cách để chúng lệch nhau sau một lần sửa.

## Example

Bốn bài toán thật, mỗi bài một dòng:

```sql
-- 1. Tổng luỹ kế doanh thu theo ngày
SELECT day, revenue,
       sum(revenue) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) AS cumulative
FROM daily_revenue ORDER BY day;

-- 2. Tăng trưởng so với ngày trước
SELECT day, revenue,
       revenue - lag(revenue) OVER (ORDER BY day) AS delta,
       round(100.0 * (revenue - lag(revenue) OVER (ORDER BY day))
             / nullif(lag(revenue) OVER (ORDER BY day), 0), 1) AS pct_change
FROM daily_revenue ORDER BY day;

-- 3. Top 3 đơn của mỗi khách
WITH ranked AS (
  SELECT id, user_id, total,
         row_number() OVER (PARTITION BY user_id ORDER BY total DESC, id) AS rn
  FROM orders WHERE status = 'paid'
)
SELECT * FROM ranked WHERE rn <= 3;

-- 4. Loại bản ghi trùng, giữ bản mới nhất
WITH d AS (
  SELECT ctid, row_number() OVER (PARTITION BY email ORDER BY created_at DESC) AS rn
  FROM users
)
DELETE FROM users WHERE ctid IN (SELECT ctid FROM d WHERE rn > 1);
```

Ba chi tiết đáng chú ý:

- **`nullif(..., 0)`** trong bài 2: chia cho 0 làm cả query lỗi. `nullif` biến nó thành `NULL`.
- **`, id`** trong `ORDER BY` của bài 3: nếu hai đơn cùng `total`, thứ tự không tất định và `rn` khác nhau giữa các lần chạy.
- **`ctid`** trong bài 4: định danh vật lý của dòng trong PostgreSQL, dùng khi bảng không có khoá chính. Nó **không ổn định** qua `UPDATE`/`VACUUM FULL`, nên chỉ dùng trong một câu lệnh duy nhất.

## Prediction

```text
orders: user 1 có đơn 100, 200, 200;  user 2 có đơn 50
```

1. `sum(total) OVER (PARTITION BY user_id)` — user 1 có mấy dòng kết quả, mỗi dòng giá trị gì?
2. `GROUP BY user_id` với `sum(total)` — user 1 có mấy dòng?
3. `row_number() OVER (ORDER BY total DESC)` cho user 1 — ba số nào?
4. `rank()` cho cùng dữ liệu — ba số nào?
5. `dense_rank()` — ba số nào?
6. `WHERE rank() OVER (...) <= 3` — chạy được không?
7. `sum(x) OVER (ORDER BY day)` khi có hai dòng cùng `day` — hai dòng đó có giá trị luỹ kế khác nhau không?
8. Thêm `ROWS UNBOUNDED PRECEDING` — có khác không?
9. `last_value(total) OVER (PARTITION BY user_id ORDER BY created_at)` — trả về gì?
10. Dùng `rank()` thay `row_number()` để lấy "1 dòng mỗi khách", user 1 có hai đơn cùng 200 — mấy dòng?
11. `lag(revenue)` ở dòng đầu tiên của partition — giá trị gì? Phép chia sau đó?
12. Window function trên 10 triệu dòng không index cột `PARTITION BY` — điều gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **3 dòng**, mỗi dòng `user_total = 500`. Dòng chi tiết được giữ.
2. **1 dòng**. Chi tiết mất.
3. `1, 2, 3` (200, 200, 100) — hai đơn 200 được đánh số tuỳ ý nếu không có cột phá hoà.
4. `1, 1, 3` — hai đơn 200 đồng hạng 1, hạng tiếp theo là 3.
5. `1, 1, 2`.
6. **Không.** `WHERE` chạy trước window function. Phải bọc CTE.
7. **Không khác nhau** — mặc định là `RANGE`, gộp mọi dòng cùng `day`. Cả hai đều là tổng gồm cả hai.
8. **Có.** Với `ROWS`, dòng đầu là 100, dòng thứ hai là 300.
9. **Chính dòng hiện tại** — frame mặc định kết thúc ở current row.
10. **2 dòng** cho user 1. Đây là lỗi kinh điển khi khử trùng lặp.
11. `NULL`. `revenue - NULL = NULL`, và phép chia sau đó cũng `NULL` — nên `pct_change` của dòng đầu là `NULL`, không phải lỗi.
12. Sắp xếp toàn bộ 10 triệu dòng. Nếu vượt `work_mem` thì tràn ra đĩa — chậm hàng chục lần.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi `row_number` thành `rank` trong khử trùng lặp, tạo giá trị trùng | Nhiều dòng hơn dự kiến |
| Bỏ cột phá hoà trong `ORDER BY`, chạy nhiều lần | `rn` gán khác nhau giữa các lần |
| Tính luỹ kế không ghi `ROWS`, dữ liệu có ngày trùng | Các dòng cùng ngày có cùng giá trị |
| Thêm `ROWS UNBOUNDED PRECEDING` | Giá trị đúng theo từng dòng |
| `last_value` không có frame đầy đủ | Trả về current row |
| `WHERE rn <= 3` không bọc CTE | Lỗi cú pháp |
| So `row_number + CTE` với `LATERAL + LIMIT` trên 1 triệu dòng có index | Chênh lệch thời gian |
| Chạy lại sau khi xoá index `(user_id, total DESC)` | `LATERAL` mất lợi thế |
| Đặt `work_mem = '64kB'`, window function trên bảng lớn | `Sort Method: external merge Disk` |
| Chia cho `lag()` mà không `nullif` | Lỗi division by zero làm hỏng cả query |

## What Usually Goes Wrong

- **Dùng `rank` khi cần `row_number`** → nhiều dòng hơn dự kiến khi có giá trị trùng.
- **`ORDER BY` không tất định** → kết quả đổi giữa các lần chạy; test "flaky".
- **Quên `ROWS` cho tổng luỹ kế** → giá trị sai với dữ liệu có khoá sắp xếp trùng.
- **`last_value` không có frame đầy đủ** → trả về current row, im lặng sai.
- **Dùng trong `WHERE`/`HAVING`** → lỗi cú pháp (đây là lỗi "tốt" — nó báo ngay).
- **Sắp xếp bảng lớn không index** → tràn `work_mem` ra đĩa.
- **Nhiều window khác nhau trong một query** → nhiều lần sort. Gộp bằng `WINDOW` clause nếu có thể dùng chung định nghĩa.
- **Chia cho `lag()` không `nullif`** → division by zero.
- **Dùng window function cho việc mà index giải quyết được** — ví dụ `max()` đơn giản: `ORDER BY x DESC LIMIT 1` với index nhanh hơn nhiều.
- **`DELETE` dùng `ctid` qua nhiều câu lệnh** → `ctid` thay đổi; xoá nhầm dòng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Window function thay được `GROUP BY` | Chúng làm hai việc khác nhau: giữ dòng vs gom dòng |
| `rank` và `row_number` như nhau | Khác khi có giá trị trùng |
| Frame mặc định là toàn bộ partition | Mặc định là `RANGE ... AND CURRENT ROW` |
| `RANGE` và `ROWS` như nhau | Khác khi khoá sắp xếp có giá trị trùng |
| `last_value` trả về giá trị cuối partition | Trả về current row với frame mặc định |
| Window function luôn đắt | Một lần sort thường rẻ hơn N subquery tương quan |
| Dùng được trong `WHERE` | Không — chạy sau `WHERE` |
| `PARTITION BY` cần index như `GROUP BY` | Index giúp tránh sort, nhưng không bắt buộc |
| Window function chạy trước `LIMIT` nên `LIMIT` không giúp gì | Đúng — đó là lý do lọc sớm vẫn quan trọng |

## Debugging

1. **Số dòng nhiều hơn dự kiến sau khi lọc `rn`** → `rank` thay vì `row_number`, hoặc `ORDER BY` có giá trị trùng.
2. **Kết quả đổi giữa các lần chạy** → `ORDER BY` chưa tất định; thêm khoá chính.
3. **Luỹ kế sai** → kiểm tra có ghi `ROWS` không.
4. **`last_value` sai** → kiểm tra frame.
5. **Chậm** → `EXPLAIN ANALYZE`, tìm `WindowAgg` và `Sort` bên dưới nó. `Sort Method: external merge Disk` = tràn `work_mem`.
6. **Nhiều `Sort` trong plan** → nhiều định nghĩa cửa sổ khác nhau. Gộp lại nếu được.
7. **So sánh với `LATERAL`** khi làm "top N mỗi nhóm" — hai plan hoàn toàn khác nhau, hãy đo cả hai.

## Production Considerations

- **Index khớp với cửa sổ** giúp planner bỏ qua bước sort: index `(user_id, created_at)` cho `PARTITION BY user_id ORDER BY created_at`.
- **Lọc trước khi mở cửa sổ.** Window function chạy trên toàn bộ tập sau `WHERE`; giới hạn phạm vi thời gian trước là cách giảm chi phí lớn nhất.
- **`work_mem` quyết định sort có tràn đĩa hay không.** Với query báo cáo nặng, có thể nâng tạm trong session: `SET LOCAL work_mem = '256MB'` bên trong transaction — nhớ rằng nó áp dụng cho **mỗi** nút sort, không phải cho cả query.
- **Báo cáo dùng nhiều window function nên chạy trên read replica.**
- **Cân nhắc bảng tổng hợp** cho số liệu tính lại mỗi lần mở dashboard. Tính một lần mỗi giờ rẻ hơn tính lại 500 lần mỗi giờ.
- **Ghi rõ định nghĩa nghiệp vụ**: "thứ hạng" tính theo doanh thu hay số đơn, hoà thì xử lý ra sao. `rank` và `dense_rank` cho hai câu trả lời khác nhau và cả hai đều "đúng" về kỹ thuật.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Window function | một lần quét, giữ chi tiết | cần sort; khó với người mới đọc |
| Subquery tương quan | quen thuộc | N lần quét |
| Self-join | cũ, phổ biến | dài, dễ nhân dòng |
| `row_number` + CTE (top N) | tổng quát, đọc rõ | xếp hạng toàn bộ tập |
| `LATERAL` + `LIMIT` (top N) | dừng sớm, rất nhanh với index | cần index đúng; ít quen |
| `ROWS` tường minh | đúng với dữ liệu trùng | dài hơn |
| Frame mặc định | ngắn | sai im lặng khi có giá trị trùng |
| Tính real-time | luôn tươi | tốn tài nguyên mỗi lần |
| Bảng tổng hợp | rẻ, ổn định | dữ liệu trễ, thêm job |

## Explain Without Notes

1. Window function khác `GROUP BY` ở điều gì cơ bản nhất?
2. Ba phần của một định nghĩa cửa sổ và mỗi phần trả lời câu hỏi gì?
3. `row_number`, `rank`, `dense_rank` cho ba kết quả nào với điểm 95, 90, 90, 85? Chọn cái nào cho "một dòng mỗi nhóm"?
4. Frame mặc định là gì, và nó gây sai ở tình huống nào?
5. Vì sao `last_value` thường trả về sai?
6. Vì sao window function không dùng được trong `WHERE`, và cách vòng qua?
7. Khi nào `LATERAL + LIMIT` thắng `row_number + CTE` cho "top N mỗi nhóm"?

## Related

- [Joins & aggregation](02-joins-aggregation.md) — `GROUP BY` và fan-out
- [Subqueries & CTE](03-subqueries-cte.md) — bọc window function để lọc; `LATERAL`
- [Relational thinking](01-relational-thinking.md) — thứ tự thực thi logic
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — index khớp cửa sổ để bỏ sort
- [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) — đọc `WindowAgg`
- [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — `ORDER BY` tất định

## Version / Context

PostgreSQL 16. Window function là chuẩn SQL:2003. `GROUPS` frame và `EXCLUDE` có từ PostgreSQL 11.
