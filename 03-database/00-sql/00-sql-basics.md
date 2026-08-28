---
level: foundation
area: database
related:
  - 01-relational-thinking.md
  - ../01-postgresql/fundamentals/01-architecture-and-acid.md
---

# SQL basics: từ vựng và bốn câu lệnh

> Một dev viết `DELETE FROM orders` trong công cụ quản trị, định xoá một dòng. Họ đã viết `WHERE` ở dòng dưới nhưng chỉ bôi đen và chạy dòng đầu. 40.000 đơn hàng biến mất. **Không có gì trong cú pháp SQL cảnh báo rằng thiếu `WHERE` nghĩa là "tất cả".**

## Position

```text
Note này là TỪ VỰNG SQL: cấu trúc dữ liệu quan hệ và bốn câu lệnh DML.
Đọc trước `01-relational-thinking` (tư duy tập hợp) và mọi note PostgreSQL.
```

## Cấu trúc: bảng, dòng, cột

```text
TABLE     một tập hợp các dòng cùng cấu trúc
ROW       một bản ghi — một thực thể
COLUMN    một thuộc tính, có KIỂU cố định
NULL      "không biết" — KHÔNG phải 0, không phải chuỗi rỗng
```

```sql
CREATE TABLE orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id),
  total_cents  integer NOT NULL CHECK (total_cents >= 0),
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT status_valid CHECK (status IN ('pending','paid','cancelled'))
);
```

## Ràng buộc: nơi tính đúng đắn thật sự sống

```text
PRIMARY KEY   định danh duy nhất, KHÔNG NULL. Mỗi bảng nên có đúng một.
FOREIGN KEY   tham chiếu tới khoá của bảng khác
              → database TỪ CHỐI dòng trỏ tới thứ không tồn tại
              → và quyết định điều gì xảy ra khi bản ghi cha bị xoá
UNIQUE        không trùng. Cũng tạo index.
NOT NULL      bắt buộc có giá trị
CHECK         điều kiện tuỳ ý trên một hoặc nhiều cột
DEFAULT       giá trị khi không truyền
```

```text
Vì sao ràng buộc quan trọng hơn nó có vẻ:

  kiểm tra trong CODE  → bỏ qua được: script thủ công, endpoint mới quên,
                         hai request đồng thời cùng vượt qua `if`
  ràng buộc ở DB       → KHÔNG bỏ qua được, kể cả từ psql

⇒ ràng buộc là lớp phòng thủ duy nhất không thể quên.
⇒ và với đồng thời, chỉ `UNIQUE` mới thật sự chặn được trùng lặp.
```

```sql
-- hành vi khi xoá bản ghi cha — phải chọn có ý thức
REFERENCES customers(id) ON DELETE RESTRICT   -- ✓ mặc định an toàn: chặn xoá
REFERENCES customers(id) ON DELETE CASCADE    -- xoá luôn dòng con (nguy hiểm)
REFERENCES customers(id) ON DELETE SET NULL   -- để trống tham chiếu
```

## `SELECT`: thứ tự viết khác thứ tự chạy

```sql
SELECT   customer_id, count(*) AS n, sum(total_cents) AS total
FROM     orders
WHERE    created_at >= now() - interval '30 days'
GROUP BY customer_id
HAVING   count(*) > 3
ORDER BY total DESC
LIMIT    20;
```

```text
Thứ tự bạn VIẾT:    SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT
Thứ tự nó CHẠY:     FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT

Hai hệ quả trực tiếp:

① `WHERE` chạy TRƯỚC `GROUP BY` → lọc DÒNG
   `HAVING` chạy SAU  `GROUP BY` → lọc NHÓM
   → lọc theo `count(*)` phải dùng HAVING, không dùng WHERE

② `SELECT` chạy SAU `WHERE` → alias đặt trong SELECT KHÔNG dùng được ở WHERE
   nhưng dùng được ở ORDER BY (chạy sau SELECT)
```

## Bốn câu lệnh DML

```sql
-- SELECT: đọc
SELECT id, status FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20;

-- INSERT: thêm
INSERT INTO orders (customer_id, total_cents) VALUES ($1, $2)
RETURNING id, created_at;              -- ← lấy lại giá trị DB sinh ra

-- UPDATE: sửa
UPDATE orders SET status = 'paid', paid_at = now()
 WHERE id = $1 AND status = 'pending'  -- ← điều kiện trạng thái NGAY TRONG lệnh
RETURNING id;                          -- 0 dòng = không ở trạng thái pending

-- DELETE: xoá
DELETE FROM orders WHERE id = $1;
```

```text
`RETURNING` là đặc sản của PostgreSQL và rất đáng dùng:
  · lấy id/timestamp do DB sinh mà không cần SELECT thêm
  · biết lệnh có tác động lên dòng nào không → dùng làm kiểm tra điều kiện
```

```text
Ba thói quen chặn sự cố ở đầu note:

① VIẾT `WHERE` TRƯỚC, viết `DELETE`/`UPDATE` sau
② Chạy `SELECT` với cùng `WHERE` để xem sẽ đụng bao nhiêu dòng
③ Bọc trong transaction khi làm thủ công:
     BEGIN; DELETE FROM orders WHERE ...;   -- xem số dòng
     -- đúng → COMMIT;  sai → ROLLBACK;
```

## `WHERE`: và cái bẫy NULL

```sql
WHERE status = 'paid'
WHERE total_cents BETWEEN 1000 AND 5000
WHERE status IN ('paid','shipped')
WHERE email LIKE '%@example.com'        -- ký tự đại diện ĐẦU → không dùng được index
WHERE created_at >= now() - interval '7 days'
WHERE deleted_at IS NULL                -- ✓ phải dùng IS NULL
```

```text
NULL không phải một giá trị — nó là "KHÔNG BIẾT".

  NULL = NULL        → NULL (không phải true!)
  NULL <> 'a'        → NULL
  WHERE x = NULL     → không bao giờ khớp dòng nào
  WHERE x IS NULL    → ✓ đúng cách

  status <> 'paid'   → BỎ QUA dòng có status = NULL
                     → vì `NULL <> 'paid'` là NULL, không phải true
  → muốn gồm cả NULL: `status IS DISTINCT FROM 'paid'`
```

Đây là nguồn của lớp bug "báo cáo thiếu dòng mà không ai giải thích được".

## `ORDER BY` và phân trang

```sql
ORDER BY created_at DESC, id DESC       -- ← thêm khoá phụ để thứ tự ỔN ĐỊNH
LIMIT 20 OFFSET 40;
```

```text
Hai điều phải nhớ:

① KHÔNG có `ORDER BY` thì KHÔNG có thứ tự đảm bảo.
   Nó có thể ổn định trong dev (bảng nhỏ) và đổi ở production (plan khác).

② `ORDER BY` không duy nhất → phân trang có thể LẶP hoặc BỎ SÓT dòng
   → luôn thêm một cột duy nhất làm khoá phụ

Và `OFFSET` lớn thì chậm: nó đọc rồi BỎ đủ số dòng đó.
   → xem keyset pagination trong note database performance.
```

## ACID trong một câu lệnh

```sql
BEGIN;
  UPDATE accounts SET balance = balance - 100 WHERE id = 1;
  UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;                                  -- cả hai, hoặc không cái nào
```

```text
Không có `BEGIN`, mỗi câu lệnh là một transaction riêng
→ mất điện giữa hai lệnh = tiền biến mất.

Và lưu ý cách viết `balance = balance - 100`:
  database tự tính từ giá trị hiện tại → NGUYÊN TỬ
  ✗ đọc balance vào app, trừ, rồi ghi lại → race condition
```

## Prediction

1. `DELETE FROM orders;` không có `WHERE` — bao nhiêu dòng bị xoá?
2. `WHERE status <> 'paid'` — dòng có `status = NULL` có được trả về không?
3. `WHERE x = NULL` — khớp bao nhiêu dòng?
4. Lọc theo `count(*) > 3` bằng `WHERE` — kết quả?
5. Dùng alias đặt trong `SELECT` ở mệnh đề `WHERE` — được không? Ở `ORDER BY`?
6. `SELECT * FROM orders LIMIT 20` không có `ORDER BY`, chạy hai lần — cùng kết quả không?
7. `ORDER BY created_at` mà nhiều dòng cùng thời điểm, phân trang — rủi ro gì?
8. Kiểm tra trùng email bằng `if` trong code, hai request đồng thời — có chặn được không?
9. Có `UNIQUE` trên email — có chặn được không?
10. Hai `UPDATE` không có `BEGIN`, mất điện ở giữa — trạng thái dữ liệu?
11. `balance = balance - 100` so với đọc-trừ-ghi trong app — khác gì khi có đồng thời?
12. `ON DELETE CASCADE` trên khoá ngoại, xoá một customer — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **Tất cả.**
2. **Không** — `NULL <> 'paid'` là NULL, không phải true.
3. **Không dòng nào** — phải dùng `IS NULL`.
4. **Lỗi** — hàm tổng hợp không dùng được trong `WHERE`; dùng `HAVING`.
5. `WHERE`: **không**. `ORDER BY`: **có** — nó chạy sau `SELECT`.
6. **Không đảm bảo** — không có `ORDER BY` thì không có thứ tự.
7. Trang sau có thể **lặp hoặc bỏ sót** dòng.
8. **Không** — cả hai vượt qua `if` trước khi cái nào ghi.
9. **Có** — chỉ một `INSERT` thành công.
10. Tiền **bị trừ mà không được cộng**.
11. Nguyên tử so với **lost update**.
12. **Mọi đơn hàng của customer đó bị xoá theo** — thường không phải điều bạn muốn.
</details>

## What Usually Goes Wrong

- **`DELETE`/`UPDATE` thiếu `WHERE`.**
- **So sánh với `NULL` bằng `=`** thay vì `IS NULL`.
- **Quên rằng `<>` loại bỏ dòng NULL.**
- **Lọc theo hàm tổng hợp bằng `WHERE`** thay vì `HAVING`.
- **Phân trang không có khoá sắp xếp duy nhất.**
- **Dựa vào thứ tự khi không có `ORDER BY`.**
- **Kiểm tra tính duy nhất trong code** thay vì bằng `UNIQUE`.
- **Nhiều câu lệnh liên quan không nằm trong transaction.**
- **Đọc-sửa-ghi trong app** thay vì để DB tự tính.
- **`ON DELETE CASCADE` mặc định** → xoá dây chuyền ngoài ý muốn.
- **Không dùng `RETURNING`** → thêm một truy vấn không cần thiết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `NULL = NULL` là true | Nó là NULL |
| `x <> 'a'` bao gồm dòng NULL | Không — chúng bị loại |
| SQL chạy theo thứ tự bạn viết | `FROM` → `WHERE` → `GROUP BY` → … → `SELECT` |
| `WHERE` và `HAVING` thay thế nhau | Một lọc dòng, một lọc nhóm |
| Kết quả có thứ tự ổn định mặc định | Không có `ORDER BY` thì không có gì đảm bảo |
| Kiểm tra trùng trong code là đủ | Chỉ `UNIQUE` chặn được đồng thời |
| Mỗi câu lệnh tự động an toàn | Nhiều lệnh liên quan cần transaction |
| `varchar` nhanh hơn `text` | Trong PostgreSQL chúng như nhau |

## Explain Without Notes

1. Thứ tự thực thi logic của `SELECT`, và hai hệ quả của nó.
2. `WHERE` và `HAVING` khác nhau ở đâu?
3. Ba hành vi bất ngờ của `NULL`.
4. Vì sao ràng buộc ở database mạnh hơn kiểm tra trong code?
5. Vì sao phân trang cần khoá sắp xếp duy nhất?
6. `balance = balance - 100` khác đọc-trừ-ghi trong app thế nào?
7. Ba thói quen tránh xoá nhầm dữ liệu.
8. `RETURNING` dùng để làm gì?

## Related

- [Relational thinking](01-relational-thinking.md) — tư duy tập hợp, NULL, cardinality
- [Joins & aggregation](02-joins-aggregation.md) — kết hợp nhiều bảng
- [Subqueries & CTE](03-subqueries-cte.md)
- [Window functions](04-window-functions.md)
- [Constraints & invariants](../03-data-modeling/01-constraints-invariants.md) — thiết kế ràng buộc
- [Relationships & cardinality](../03-data-modeling/03-relationships-cardinality.md) — 1-1, 1-n, n-n
- [PostgreSQL architecture & ACID](../01-postgresql/fundamentals/01-architecture-and-acid.md)
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md)
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — OFFSET và keyset pagination

## Version / Context

Cú pháp theo chuẩn SQL; ví dụ dùng PostgreSQL **16**. `RETURNING` là mở rộng của PostgreSQL (MySQL 8 không có; SQL Server dùng `OUTPUT`). `gen_random_uuid()` có sẵn từ PostgreSQL 13 không cần extension. `IS DISTINCT FROM` là chuẩn SQL và được PostgreSQL hỗ trợ đầy đủ.
