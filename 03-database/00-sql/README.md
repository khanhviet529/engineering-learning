---
level: foundation
area: database
---

# SQL

SQL không phải "cú pháp để lấy dữ liệu". Nó là một **ngôn ngữ thao tác trên tập hợp**, và mọi khó khăn với nó đều bắt nguồn từ việc mang tư duy vòng lặp vào một nơi không có vòng lặp.

Ba câu hỏi mà folder này luyện, theo thứ tự quan trọng:

```text
1. Query này trả về bao nhiêu DÒNG?      ← đoán được trước khi chạy
2. Con số này có bị đếm TRÙNG không?     ← nguồn của báo cáo sai
3. NULL đi đâu trong logic này?          ← nguồn của dòng biến mất
```

Ba câu đó bắt được gần hết bug SQL thật, và không câu nào liên quan tới tối ưu hoá.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Relational thinking](01-relational-thinking.md) | Vì sao tư duy mảng làm SQL vừa chậm vừa sai? |
| 2 | [Joins & aggregation](02-joins-aggregation.md) | Vì sao báo cáo doanh thu ra số lớn gấp 6 lần? |
| 3 | [Subqueries & CTE](03-subqueries-cte.md) | Làm sao chia một query 180 dòng thành phần kiểm chứng được? |
| 4 | [Window functions](04-window-functions.md) | Làm sao có số liệu của nhóm mà vẫn giữ từng dòng? |

## Ba bảng phải thuộc

**Thứ tự thực thi logic** — giải thích hầu hết lỗi "vì sao không được":

```text
FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT
```

**NULL** — giải thích hầu hết lỗi "thiếu dòng":

| Biểu thức | Kết quả |
|---|---|
| `NULL = NULL` | `NULL` (không phải TRUE) |
| `x <> 'a'` khi `x IS NULL` | `NULL` → dòng bị `WHERE` loại |
| `count(*)` vs `count(col)` | đếm mọi dòng vs bỏ qua NULL |
| `sum()` trên 0 dòng | `NULL`, không phải 0 |
| `x NOT IN (…, NULL)` | không bao giờ TRUE → **0 dòng** |

**Cardinality** — giải thích hầu hết lỗi "số sai":

```text
orders 1.000  ×  order_items (6/đơn)  =  6.000 dòng
                 ×  payments (2/đơn)  = 12.000 dòng
→ SUM(item.qty) bị nhân 2,  SUM(payment.amount) bị nhân 3
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Nhiều dòng hơn dự kiến | fan-out từ JOIN 1:N → [2](02-joins-aggregation.md) |
| Tổng tiền lớn gấp N lần | aggregate sau fan-out → [2](02-joins-aggregation.md) |
| Thiếu dòng không rõ lý do | NULL trong điều kiện → [1](01-relational-thinking.md) |
| `LEFT JOIN` cư xử như `INNER` | điều kiện bảng phải nằm trong `WHERE` → [2](02-joins-aggregation.md) |
| `count` ra 1 thay vì 0 | `count(*)` thay vì `count(cột_bên_phải)` → [2](02-joins-aggregation.md) |
| API trả `null` cho một tổng | `sum()` trên tập rỗng → [2](02-joins-aggregation.md) |
| Query trả về **0 dòng**, luôn luôn | `NOT IN` với subquery có NULL → [3](03-subqueries-cte.md) |
| `column "x" does not exist` trong `WHERE` | alias của `SELECT`, chưa tồn tại → [1](01-relational-thinking.md) |
| `aggregate functions are not allowed in WHERE` | cần `HAVING` → [1](01-relational-thinking.md) |
| Phân trang trả dòng trùng | `ORDER BY` không tất định → [1](01-relational-thinking.md) |
| Kết quả đổi giữa các lần chạy | thiếu `ORDER BY` hoặc thiếu cột phá hoà → [4](04-window-functions.md) |
| Lấy "1 dòng mỗi nhóm" mà ra 2 dòng | dùng `rank()` thay `row_number()` → [4](04-window-functions.md) |
| Tổng luỹ kế sai ở các dòng cùng ngày | frame mặc định là `RANGE` → [4](04-window-functions.md) |
| Query CTE chậm bất thường | CTE bị materialize → [3](03-subqueries-cte.md) |
| JOIN chậm trên bảng lớn | thiếu index trên cột FK → [2](02-joins-aggregation.md) |

## Bảy thói quen

```sql
-- 1. Liệt kê cột, không SELECT *
SELECT id, title, created_at FROM tasks;

-- 2. LIMIT luôn đi với ORDER BY tất định (thêm khoá chính để phá hoà)
ORDER BY created_at DESC, id DESC LIMIT 50

-- 3. NOT EXISTS, không NOT IN
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)

-- 4. coalesce mọi aggregate đi ra API
coalesce(sum(total), 0) AS revenue

-- 5. Điều kiện bảng phải của LEFT JOIN nằm trong ON
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'

-- 6. Gom trước khi join, để tránh fan-out
LEFT JOIN (SELECT order_id, sum(qty) AS qty FROM order_items GROUP BY order_id) i ON ...

-- 7. Index mọi cột FK — PostgreSQL KHÔNG tự tạo
CREATE INDEX ON order_items (order_id);
```

## Cách kiểm chứng một query

Trước khi tin một con số:

```sql
-- 1. Đếm dòng ở từng bước, thêm dần JOIN
SELECT count(*) FROM orders;
SELECT count(*) FROM orders JOIN order_items ON ...;      -- nhảy vọt? → fan-out

-- 2. Đếm dòng TRƯỚC khi GROUP BY, so với số thực thể mong đợi

-- 3. Viết lại bằng cách khác và so kết quả — bắt buộc với số liệu tài chính
```

## Position

```text
Service → Repository → SQL → PostgreSQL planner → storage
                        ↑ folder này (SQL chuẩn, không đặc thù engine)
```

Đặc thù PostgreSQL — MVCC, index, plan, lock — nằm ở [01-postgresql/](../01-postgresql/README.md).

## Related

- [01-postgresql/](../01-postgresql/README.md) — engine bên dưới: index, plan, MVCC, lock
- [03-data-modeling/](../03-data-modeling/README.md) — vì sao dữ liệu được chia ra nhiều bảng
- [Database & transactions](../../02-backend-api/02-nestjs/06-database-integration-transactions.md) — SQL qua ORM, N+1
- [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — keyset vs offset
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — đo và tối ưu

## Version / Context

Ví dụ viết cho **PostgreSQL 16**. Thứ tự thực thi logic, ngữ nghĩa NULL, JOIN và window function là chuẩn SQL và đúng với mọi RDBMS; các chi tiết được đánh dấu PostgreSQL thì không.
