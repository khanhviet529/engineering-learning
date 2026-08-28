---
level: foundation
area: database
prerequisites: []
related:
  - 02-joins-aggregation.md
  - ../03-data-modeling/02-normalization.md
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# Relational thinking

> Bạn viết `SELECT * FROM orders WHERE total > 100` và nhận về 4.000 dòng. Bạn thêm `JOIN order_items` và nhận về 27.000 dòng — cùng một tập đơn hàng. Không có gì sai cả. Nhưng nếu bạn không dự đoán được con số 27.000 trước khi chạy, bạn đang viết SQL bằng cách thử.

## Position

```text
NestJS service → repository → SQL → PostgreSQL planner → storage
                              ↑ note này: cách SUY NGHĨ về SQL,
                                trước khi nghĩ về index hay tối ưu
```

## Problem

Người đến từ JavaScript mang theo một mô hình tính toán cụ thể: **lặp qua từng phần tử, làm gì đó với từng cái.**

```ts
const result = [];
for (const order of orders) {
  const user = users.find((u) => u.id === order.userId);   // tìm thủ công
  if (user.country === 'VN') result.push({ ...order, user });
}
```

Mang mô hình đó vào SQL cho ra code đúng nhưng chậm theo cách không sửa được bằng index:

```ts
const orders = await repo.findAll();                       // 50.000 dòng vào bộ nhớ Node
for (const o of orders) {
  o.user = await userRepo.findById(o.userId);              // 50.000 query
}
```

Đây không phải "chưa tối ưu". Đây là **sai mô hình**: bạn đang dùng database như một cái mảng ở xa, và trả giá bằng độ trễ mạng nhân với số dòng.

Vấn đề thứ hai, tinh vi hơn và gây bug thật:

```sql
SELECT o.id, o.total FROM orders o JOIN order_items i ON i.order_id = o.id;
-- 4.000 đơn hàng → 27.000 dòng
-- SUM(o.total) trên kết quả này = SAI, mỗi đơn hàng bị đếm nhiều lần
```

Báo cáo doanh thu sai gấp 6 lần, và nó trông hoàn toàn hợp lý cho tới khi có người đối chiếu.

## Mental Model

### SQL thao tác trên TẬP HỢP, không trên phần tử

```text
Tư duy thủ tục            Tư duy quan hệ
"với mỗi đơn hàng..."     "tập các đơn hàng THOẢ điều kiện, KẾT với tập user"
lặp                       biến đổi tập hợp
bạn quyết định thứ tự     PLANNER quyết định thứ tự
1 dòng = 1 vòng lặp       1 câu lệnh = mọi dòng
```

Bạn mô tả **cái gì** cần lấy; planner quyết định **làm thế nào**. Đây là điều khiến SQL khác mọi ngôn ngữ bạn biết, và cũng là lý do một câu SQL có thể nhanh hôm nay và chậm sau khi dữ liệu tăng — vì planner đổi ý.

### Mọi thứ là bảng, kể cả kết quả trung gian

```text
bảng gốc      → tập dòng
WHERE         → tập con
JOIN          → tập được ghép
GROUP BY      → tập các NHÓM (mỗi nhóm thành một dòng)
subquery/CTE  → một bảng tạm
view          → một câu query có tên
```

Vì đầu ra của mỗi phép toán lại là một bảng, bạn ghép chúng lại được. Đó là toàn bộ sức mạnh của SQL.

### Thứ tự thực thi LOGIC khác thứ tự bạn viết

Đây là mô hình quan trọng nhất trong note này. Nó giải thích một loạt lỗi "vì sao không được".

```text
Bạn VIẾT:                    Database XỬ LÝ theo thứ tự:
SELECT   ...                 1. FROM      lấy bảng
FROM     ...                 2. JOIN      ghép bảng
JOIN     ...                 3. WHERE     lọc DÒNG
WHERE    ...                 4. GROUP BY  gom nhóm
GROUP BY ...                 5. HAVING    lọc NHÓM
HAVING   ...                 6. SELECT    chọn cột, tính alias
ORDER BY ...                 7. DISTINCT
LIMIT    ...                 8. ORDER BY  sắp xếp
                             9. LIMIT     cắt
```

Ba hệ quả trực tiếp:

```sql
-- ❌ WHERE (bước 3) chạy TRƯỚC SELECT (bước 6) → alias chưa tồn tại
SELECT total * 1.1 AS with_tax FROM orders WHERE with_tax > 100;
-- ERROR: column "with_tax" does not exist

-- ✅ ORDER BY (bước 8) chạy SAU SELECT → alias dùng được
SELECT total * 1.1 AS with_tax FROM orders ORDER BY with_tax DESC;

-- ❌ WHERE không dùng được aggregate (bước 3 trước bước 4)
SELECT user_id FROM orders WHERE COUNT(*) > 5 GROUP BY user_id;

-- ✅ HAVING lọc NHÓM
SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) > 5;
```

Nhớ một câu: **`WHERE` lọc dòng trước khi gom nhóm; `HAVING` lọc nhóm sau khi gom.**

### NULL không phải một giá trị — nó là "không biết"

```sql
NULL = NULL        → NULL   (không phải TRUE!)
NULL <> 5          → NULL
NULL AND FALSE     → FALSE     -- sai gì cũng vẫn sai
NULL AND TRUE      → NULL
5 + NULL           → NULL
'abc' || NULL      → NULL
```

Vì `WHERE` chỉ giữ dòng có điều kiện **TRUE** (không giữ `NULL`), đây là nguồn của bug "thiếu dòng" khó thấy nhất:

```sql
SELECT * FROM users WHERE country <> 'VN';
-- KHÔNG trả về user có country = NULL
-- "mọi user không phải Việt Nam" — nhưng user chưa khai báo quốc gia biến mất
```

```sql
-- đúng
SELECT * FROM users WHERE country IS DISTINCT FROM 'VN';
-- hoặc: WHERE country <> 'VN' OR country IS NULL
```

Bảng đối chiếu đáng thuộc:

| Muốn | Viết |
|---|---|
| bằng NULL | `IS NULL` |
| khác NULL | `IS NOT NULL` |
| so sánh coi NULL là một giá trị | `IS DISTINCT FROM` / `IS NOT DISTINCT FROM` |
| thay NULL bằng mặc định | `COALESCE(col, 0)` |

Và một hệ quả với aggregate:

```sql
SELECT COUNT(*), COUNT(country), AVG(age) FROM users;
-- COUNT(*)       đếm mọi dòng
-- COUNT(country) BỎ QUA dòng NULL
-- AVG(age)       bỏ qua NULL ở mẫu số — khác hẳn với coi NULL là 0
```

`AVG` bỏ qua NULL là hành vi đúng về mặt thống kê và **sai** về mặt nghiệp vụ nếu NULL của bạn thật ra nghĩa là 0. Đây là lý do `NOT NULL DEFAULT 0` thường tốt hơn cho phép NULL.

### Khoá: danh tính và tham chiếu

```text
PRIMARY KEY   danh tính của một dòng. Không NULL, không trùng.
UNIQUE        không trùng, nhưng CHO PHÉP nhiều NULL (trong PostgreSQL)
FOREIGN KEY   tham chiếu tới danh tính ở bảng khác. DB TỪ CHỐI tham chiếu treo.
```

Điểm về `UNIQUE` và NULL hay gây bất ngờ:

```sql
CREATE UNIQUE INDEX ON users (email);
INSERT INTO users (email) VALUES (NULL), (NULL);   -- OK! hai NULL không "bằng nhau"
```

Nếu bạn muốn "mỗi user chỉ có một địa chỉ mặc định" và dùng `NULL` để nghĩa là "không mặc định", unique index thường không làm điều bạn nghĩ. Dùng **partial unique index**:

```sql
CREATE UNIQUE INDEX ON addresses (user_id) WHERE is_default;
```

Về foreign key: nó không chỉ là "tài liệu". Nó là ràng buộc mà **database ép**, đúng cả khi có concurrency, đúng cả khi ai đó sửa dữ liệu bằng tay, đúng cả khi một service khác ghi vào cùng bảng. Không có FK, bạn sẽ có `order_items` trỏ tới `order_id` không tồn tại, và bạn sẽ phát hiện điều đó khi báo cáo ra số lạ.

```sql
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE   -- xoá đơn → xoá dòng hàng
FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE RESTRICT  -- không cho xoá user còn đơn
FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL  -- giữ dòng, bỏ tham chiếu
```

Chọn `ON DELETE` là một quyết định nghiệp vụ, không phải mặc định kỹ thuật. `CASCADE` trên một quan hệ quan trọng có thể xoá dây chuyền nhiều hơn bạn tưởng.

### Cardinality: con số bạn phải dự đoán được

Đây là kỹ năng cốt lõi của "tư duy quan hệ": **trước khi chạy một query, đoán số dòng nó trả về.**

```text
orders           1.000 dòng
order_items      6.000 dòng   (trung bình 6 dòng/đơn)

SELECT ... FROM orders                           → 1.000
SELECT ... FROM orders JOIN order_items          → 6.000   ← mỗi đơn nhân lên
SELECT ... FROM orders JOIN order_items JOIN products
                                                 → 6.000   (products là 1:1 với item)
SELECT ... FROM orders JOIN order_items JOIN shipments
                                                 → 6.000 × số shipment/đơn  ← NHÂN TIẾP
```

Cái bẫy kinh điển: JOIN hai bảng con của cùng một cha.

```sql
-- đơn hàng có 3 item và 2 lần thanh toán
SELECT o.id, SUM(i.qty), SUM(p.amount)
FROM orders o
JOIN order_items i ON i.order_id = o.id      -- 3 dòng
JOIN payments    p ON p.order_id = o.id      -- × 2 = 6 dòng
GROUP BY o.id;
-- SUM(i.qty)   bị nhân 2   ← mỗi item xuất hiện 2 lần
-- SUM(p.amount) bị nhân 3  ← mỗi payment xuất hiện 3 lần
```

Cả hai tổng đều sai, và không có gì báo lỗi. Cách sửa: gom từng bảng con **trước** rồi mới ghép.

```sql
SELECT o.id, i.total_qty, p.total_amount
FROM orders o
LEFT JOIN (SELECT order_id, SUM(qty) AS total_qty FROM order_items GROUP BY order_id) i
       ON i.order_id = o.id
LEFT JOIN (SELECT order_id, SUM(amount) AS total_amount FROM payments GROUP BY order_id) p
       ON p.order_id = o.id;
```

Chi tiết về JOIN và aggregate: [Joins & aggregation](02-joins-aggregation.md).

## Example

Cùng một yêu cầu, hai mô hình:

```ts
// ❌ mô hình mảng: 1 + N query, dữ liệu về Node rồi lọc
const orders = await db.order.findMany();
const rich = [];
for (const o of orders) {
  const u = await db.user.findUnique({ where: { id: o.userId } });
  if (u.country === 'VN') rich.push({ ...o, user: u });
}
```

```sql
-- ✅ mô hình tập hợp: 1 query, DB lọc trước khi trả
SELECT o.id, o.total, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE u.country = 'VN' AND o.created_at >= now() - interval '30 days'
ORDER BY o.created_at DESC
LIMIT 50;
```

Khác biệt không chỉ là tốc độ. Bản SQL **lọc trước khi truyền**: chỉ 50 dòng đi qua mạng thay vì toàn bộ bảng. Với 500.000 đơn hàng, bản đầu tiên làm Node hết bộ nhớ trước khi kịp chậm.

## Prediction

```sql
-- users: 100 dòng, trong đó 20 dòng có country = NULL
-- orders: 500 dòng, 400 dòng có user_id trỏ tới user tồn tại, 100 dòng user_id NULL
```

1. `SELECT count(*) FROM users WHERE country <> 'VN'` — bao nhiêu dòng nếu 30 user có country='VN'?
2. `SELECT count(*), count(country) FROM users` — hai số này bằng nhau không?
3. `SELECT * FROM users u JOIN orders o ON o.user_id = u.id` — bao nhiêu dòng?
4. Đổi thành `LEFT JOIN users u ... orders o` — bao nhiêu dòng?
5. `SELECT total*1.1 AS t FROM orders WHERE t > 100` — chạy được không? Vì sao?
6. `SELECT user_id FROM orders WHERE COUNT(*) > 3 GROUP BY user_id` — chạy được không?
7. `INSERT INTO users (email) VALUES (NULL), (NULL)` với unique index trên email — thành công không?
8. Bảng `orders` 1.000 dòng, `order_items` 6.000 dòng, `payments` 2.000 dòng. JOIN cả ba theo `order_id` — bao nhiêu dòng?
9. `SUM(o.total)` trên kết quả câu 8 — có bằng tổng doanh thu thật không?
10. `DELETE FROM users WHERE id = 1` với `orders.user_id` là FK `ON DELETE RESTRICT` và user 1 có đơn hàng — kết quả?

<details>
<summary>Đáp án</summary>

1. **50** (100 − 30 − 20). 20 dòng NULL bị loại vì `NULL <> 'VN'` là `NULL`, không phải `TRUE`.
2. **Không.** `count(*)` = 100, `count(country)` = 80.
3. **400** — dòng có `user_id` NULL không khớp được với gì.
4. **500** — mọi dòng `orders` được giữ; 100 dòng có cột của `users` là NULL. (Chú ý `LEFT JOIN` giữ bảng bên **trái**.)
5. **Không.** `WHERE` (bước 3) chạy trước `SELECT` (bước 6); alias chưa tồn tại.
6. **Không.** Aggregate không dùng được trong `WHERE`; phải dùng `HAVING`.
7. **Thành công.** Trong PostgreSQL, nhiều NULL không vi phạm unique.
8. **12.000** — 6.000 (items) × 2 (payments trung bình mỗi đơn).
9. **Không** — mỗi đơn hàng bị đếm 12 lần thay vì 1. Tổng sai gấp 12.
10. Lỗi `foreign key violation`. Đây là FK làm đúng việc của nó.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm vài dòng có NULL rồi chạy `WHERE col <> 'x'` | Số dòng thiếu; so với `IS DISTINCT FROM` |
| `COUNT(*)` vs `COUNT(col)` trên cột có NULL | Hai số khác nhau |
| `AVG(col)` với NULL vs với `COALESCE(col,0)` | Kết quả khác hẳn |
| JOIN hai bảng con của cùng cha, rồi `SUM` | So với tổng thật — sai bao nhiêu lần? |
| Đổi `JOIN` thành `LEFT JOIN` và đếm dòng | Chênh lệch = số dòng không khớp |
| `LEFT JOIN` rồi thêm điều kiện bảng phải vào `WHERE` | Nó biến thành INNER JOIN — vì sao? |
| Insert nhiều NULL vào cột UNIQUE | Thành công — chứng minh NULL không "bằng nhau" |
| Xoá FK rồi insert `order_id` không tồn tại | Dữ liệu mồ côi; thử tìm nó sau 1 tháng |
| Đặt `ON DELETE CASCADE` rồi xoá một dòng cha | Đếm số dòng bị xoá dây chuyền |
| `SELECT *` không `ORDER BY`, chạy nhiều lần khi bảng lớn | Thứ tự có thể đổi |

Dòng thứ sáu đáng làm riêng: điều kiện lên bảng phải trong `WHERE` biến `LEFT JOIN` thành `INNER JOIN`, vì `NULL <> 'x'` là `NULL`. Muốn giữ ngữ nghĩa LEFT, đặt điều kiện vào `ON`.

## What Usually Goes Wrong

- **Lặp trong code thay vì JOIN** → N+1, latency nhân theo số dòng.
- **`SELECT *`** → truyền cột không dùng, vỡ khi thêm cột, ngăn index-only scan.
- **Không hiểu NULL** → dòng biến mất khỏi kết quả một cách im lặng.
- **JOIN nhiều bảng con rồi aggregate** → số bị nhân lên, báo cáo sai.
- **Điều kiện bảng phải trong `WHERE` của `LEFT JOIN`** → mất ngữ nghĩa LEFT.
- **Không có FK** → dữ liệu mồ côi, phát hiện rất muộn.
- **Dựa vào thứ tự khi không có `ORDER BY`** → đúng hôm nay, sai khi plan đổi.
- **`LIMIT` không có `ORDER BY`** → phân trang trả về dòng trùng và bỏ sót.
- **Dùng NULL để mã hoá nghiệp vụ** ("chưa nhập" vs "bằng 0" vs "không áp dụng") → mọi phép tính đều phải xử lý riêng.
- **So sánh chuỗi mà không nghĩ về collation/case** → `'ABC' = 'abc'` là FALSE trong PostgreSQL.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| SQL chạy theo thứ tự các mệnh đề được viết | Thứ tự logic là FROM → WHERE → GROUP → HAVING → SELECT → ORDER |
| `NULL = NULL` là TRUE | Là `NULL`; `WHERE` loại nó |
| `COUNT(*)` và `COUNT(col)` như nhau | `COUNT(col)` bỏ qua NULL |
| JOIN không đổi số dòng | JOIN 1:N nhân số dòng lên |
| `SELECT *` tiện và vô hại | Nó ngăn index-only scan và vỡ khi schema đổi |
| Thứ tự dòng ổn định nếu không đổi dữ liệu | Không có `ORDER BY` = không có đảm bảo nào |
| UNIQUE chặn được nhiều NULL | PostgreSQL cho phép nhiều NULL |
| FK làm chậm nên bỏ đi | Chi phí nhỏ; dữ liệu mồ côi đắt hơn nhiều |
| `DISTINCT` là cách sửa JOIN nhân dòng | Nó giấu triệu chứng; tổng vẫn có thể sai |
| ORM giúp bạn khỏi cần hiểu SQL | Nó sinh SQL; bạn vẫn phải đọc được cái nó sinh |

Dòng về `DISTINCT` đáng nhấn: thấy dòng trùng sau JOIN rồi thêm `DISTINCT` là phản xạ sai phổ biến nhất. Nó xoá dòng trùng nhưng không sửa `SUM` bị nhân, và nó thêm một bước sắp xếp tốn kém.

## Debugging

1. **Kết quả nhiều dòng hơn dự kiến** → bỏ hết `SELECT`, chạy `SELECT count(*)` với từng JOIN thêm dần. JOIN nào làm số nhảy vọt chính là JOIN nhân dòng.
2. **Thiếu dòng** → nghi NULL trước tiên. Đổi `<>` thành `IS DISTINCT FROM`; đổi `JOIN` thành `LEFT JOIN` và đếm chênh lệch.
3. **Tổng sai** → đếm dòng trước khi `GROUP BY`. Nếu nhiều hơn số thực thể, bạn đang cộng trùng.
4. **`column does not exist`** → alias trong `WHERE`, hoặc cột của bảng chưa được JOIN. Nhớ thứ tự logic.
5. **`LEFT JOIN` cư xử như `INNER`** → tìm điều kiện bảng phải trong `WHERE`.
6. **Kết quả đổi giữa các lần chạy** → thiếu `ORDER BY`.
7. **Không hiểu query của mình** → chia nhỏ bằng CTE, chạy từng phần. Xem [Subqueries & CTE](03-subqueries-cte.md).

Bước 1 và 3 giải quyết phần lớn bug SQL thật, và cả hai chỉ cần `count(*)`.

## Production Considerations

- **Liệt kê cột tường minh**, không `SELECT *`. Nó ổn định trước thay đổi schema, giảm dữ liệu truyền, và cho phép index-only scan.
- **`LIMIT` luôn đi với `ORDER BY` trên một khoá ổn định** (thường phải thêm `id` để phá thế hoà). Nếu không, phân trang trả trùng và bỏ sót. Xem [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md).
- **FK là biện pháp bảo vệ dữ liệu rẻ nhất bạn có.** Chi phí là một index lookup khi ghi; giá của dữ liệu mồ côi là không đo được.
- **`NOT NULL DEFAULT ...` là mặc định tốt hơn cho phép NULL.** Chỉ cho phép NULL khi "không biết" thật sự là một trạng thái nghiệp vụ.
- **Tránh NULL đa nghĩa.** Nếu `discount = NULL` có thể nghĩa là "chưa nhập" hoặc "không giảm giá", bạn cần hai cột hoặc một enum.
- **Đọc SQL mà ORM sinh ra** — bật query log ở dev. Bạn không cần viết SQL bằng tay, nhưng bạn cần đọc được nó.
- **Đặt tên nhất quán**: `snake_case`, số nhiều cho bảng (`orders`), `<bảng_số_ít>_id` cho FK (`order_id`). Nhất quán quan trọng hơn quy ước cụ thể.
- **Cẩn thận với timezone.** Dùng `timestamptz`, không dùng `timestamp`. Lỗi timezone không báo lỗi — nó chỉ cho số sai.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| JOIN trong DB | 1 round-trip, DB tối ưu được | query khó đọc hơn |
| Lấy về rồi ghép trong code | code quen thuộc | N+1, tốn bộ nhớ, tốn mạng |
| `SELECT` cột tường minh | ổn định, nhanh hơn | phải sửa khi thêm field |
| `SELECT *` | tiện lúc viết | vỡ khi schema đổi |
| FK ràng buộc | dữ liệu luôn nhất quán | ghi chậm hơn chút; migration khó hơn |
| Không FK | ghi nhanh hơn | dữ liệu mồ côi |
| `NOT NULL` mọi nơi có thể | logic đơn giản hơn | phải nghĩ về giá trị mặc định |
| Cho phép NULL | linh hoạt | mọi phép tính phải xử lý NULL |
| `ON DELETE CASCADE` | dọn tự động | xoá dây chuyền ngoài dự kiến |
| `ON DELETE RESTRICT` | an toàn | phải dọn thủ công theo thứ tự |

## Explain Without Notes

1. Kể thứ tự thực thi logic của một câu SELECT và giải thích vì sao alias không dùng được trong `WHERE`.
2. Vì sao `WHERE country <> 'VN'` làm mất dòng? Hai cách sửa?
3. Cho `orders` 1.000 dòng và `order_items` 6.000 dòng, JOIN ra bao nhiêu dòng? Nếu JOIN thêm `payments` (2.000 dòng)?
4. Vì sao `SUM` sau khi JOIN hai bảng con lại sai, và cách sửa đúng?
5. `WHERE` khác `HAVING` ở điểm nào, và vì sao?
6. Vì sao `DISTINCT` không phải cách sửa cho JOIN nhân dòng?
7. Vì sao `LIMIT` không có `ORDER BY` là bug, kể cả khi kết quả trông đúng?

## Related

- [Joins & aggregation](02-joins-aggregation.md) — chi tiết về JOIN và GROUP BY
- [Subqueries & CTE](03-subqueries-cte.md) — chia query lớn thành phần đọc được
- [Window functions](04-window-functions.md) — tính toán theo nhóm mà không gom dòng
- [Normalization](../03-data-modeling/02-normalization.md) — vì sao dữ liệu được chia ra nhiều bảng
- [Relationships & cardinality](../03-data-modeling/03-relationships-cardinality.md) — 1:1, 1:N, N:M
- [Constraints & invariants](../03-data-modeling/01-constraints-invariants.md) — FK, UNIQUE, CHECK
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — vì sao query nhanh hay chậm
- [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — `ORDER BY` ổn định

## Version / Context

PostgreSQL 16. Hành vi NULL và thứ tự logic là chuẩn SQL, đúng với mọi RDBMS. Việc UNIQUE cho phép nhiều NULL đúng với PostgreSQL và chuẩn SQL, nhưng khác ở một số engine (ví dụ SQL Server chỉ cho một NULL).
