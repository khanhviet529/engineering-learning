---
level: intermediate
area: database
prerequisites:
  - ../00-sql/01-relational-thinking.md
related:
  - 02-normalization.md
  - ../01-postgresql/transactions-concurrency/01-transaction-isolation.md
  - ../../02-backend-api/04-architecture/03-domain-logic-boundaries.md
---

# Constraints & invariants

> Sau hai năm, bảng `orders` có 340 dòng với `total` âm, 1.200 dòng trỏ tới `user_id` không còn tồn tại, và 89 cặp email trùng nhau. Không ai biết chúng đến từ đâu. Code hiện tại kiểm tra tất cả những điều đó. Vấn đề là dữ liệu xấu không đến từ code hiện tại — nó đến từ một script import năm ngoái, một hotfix chạy tay, một service khác, và một khoảnh khắc hai request đến cùng lúc.

## Position

```text
Client → Validation (DTO)     "hình dạng đúng không?"      → 400
       → Service (invariant)  "hợp lệ trong ngữ cảnh?"     → 409/422
       → CONSTRAINT (schema)  "database CÓ CHẤP NHẬN?"     ← note này
                              phòng tuyến CUỐI, không ai đi vòng được
```

## Problem

Mọi kiểm tra ở tầng ứng dụng đều có một đặc điểm chung: **đi vòng được**.

```text
Ai ghi vào database của bạn?
  · API chính                    ← chỗ duy nhất có validation đầy đủ
  · script import dữ liệu
  · migration
  · một service khác (nếu chung DB)
  · admin panel viết vội
  · một người vào psql lúc 2 giờ sáng để "sửa nhanh"
  · phiên bản CŨ của code đang chạy song song trong lúc rolling update
```

Bảy đường vào, một chỗ có kiểm tra. Và ngay cả đường vào có kiểm tra cũng thất bại dưới concurrency:

```ts
const existing = await repo.findByEmail(email);
if (existing) throw new ConflictError();
await repo.create({ email });
// hai request đồng thời: cả hai thấy "chưa tồn tại", cả hai INSERT
```

Constraint không có đặc điểm đó. Nó là **thuộc tính của dữ liệu**, không phải của code đọc dữ liệu.

Và có một tính chất thứ hai, ít được nói tới nhưng quan trọng không kém: constraint là **tài liệu duy nhất không thể lỗi thời**. Đọc `CHECK (total >= 0)` là biết chắc chắn không có dòng nào vi phạm. Đọc một dòng code kiểm tra chỉ cho biết *đường đó* có kiểm tra.

## Mental Model

### Bất biến ở đâu thì được ép ở đó

```text
Loại bất biến                             Ép ở đâu
"là số nguyên dương"                      CHECK
"không được trống"                        NOT NULL
"duy nhất trong hệ thống"                 UNIQUE
"duy nhất trong một điều kiện"            UNIQUE partial index
"phải tồn tại ở bảng khác"                FOREIGN KEY
"hai khoảng thời gian không chồng lấn"    EXCLUDE
"chỉ một trong các cột được có giá trị"   CHECK với num_nonnulls()
"tổng của các dòng con = giá trị ở cha"   ✗ không ép được bằng constraint
"chỉ user premium mới tạo được project"   ✗ cần trạng thái ở nơi khác → service
```

Hai dòng cuối là ranh giới thật: constraint mạnh cho bất biến **cục bộ** (trong một dòng, hoặc giữa các dòng có quan hệ trực tiếp). Bất biến cần tổng hợp hoặc cần trạng thái ở nơi khác thuộc về tầng ứng dụng, và ở đó bạn phải tự lo concurrency.

### Constraint không thay validation, và ngược lại

```text
                     Validation (DTO)        Constraint (DB)
Ai đi vòng được      mọi đường vào khác      không ai
Thông báo lỗi        rõ ràng, cho người dùng vô nghĩa: "23505"
Chi phí              0 round-trip            1 round-trip
Đúng dưới concurrency không                  CÓ
Là tài liệu          không                   CÓ
```

Chúng bổ sung nhau: **validation cho trải nghiệm, constraint cho tính đúng đắn.** Bỏ cái nào cũng để lại một lỗ.

## How It Works

### `NOT NULL` và `DEFAULT`

```sql
CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users(id),
  status      text        NOT NULL DEFAULT 'pending',
  total_cents bigint      NOT NULL CHECK (total_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

Ba quyết định trong khối này:

- **`NOT NULL` là mặc định đúng.** Chỉ cho phép NULL khi "không biết" thật sự là một trạng thái nghiệp vụ. Mỗi cột nullable là một nhánh `if` ở mọi nơi đọc nó.
- **`timestamptz`, không phải `timestamp`.** `timestamp` không có múi giờ — nó lưu một con số mà không ai biết thuộc múi nào. Bug timezone không báo lỗi, nó chỉ cho số sai.
- **`total_cents bigint`, không phải `total numeric` hay `float`.** Tiền lưu bằng đơn vị nhỏ nhất, dạng số nguyên. `float` không biểu diễn được `0.1` chính xác; `numeric` đúng nhưng chậm hơn và vẫn cho phép chia lẻ. Xem [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md).

### `CHECK`: bất biến trong một dòng

```sql
CHECK (total_cents >= 0)
CHECK (status IN ('pending','paid','shipped','cancelled'))
CHECK (ends_at > starts_at)
CHECK (discount_pct BETWEEN 0 AND 100)
CHECK (email = lower(email))                       -- ép chuẩn hoá lúc ghi
CHECK (num_nonnulls(user_id, api_key_id) = 1)      -- đúng MỘT trong hai
```

Dòng cuối giải quyết một mẫu phổ biến: "hoặc là user, hoặc là API key, không được cả hai, không được cả không". Ép bằng code thì mỗi đường ghi phải nhớ; ép bằng `CHECK` thì không ai quên được.

`CHECK` chỉ nhìn thấy **một dòng**. Nó không truy vấn được bảng khác. (Có thể lách bằng hàm, nhưng hàm đó không được đảm bảo đúng dưới concurrency — đừng làm.)

### `UNIQUE`, và cái bẫy NULL

```sql
CREATE UNIQUE INDEX ON users (email);
INSERT INTO users (email) VALUES (NULL), (NULL);   -- ✓ THÀNH CÔNG
```

Trong PostgreSQL, hai `NULL` không "bằng nhau", nên unique index cho phép nhiều NULL. Từ PostgreSQL 15 có thể đổi:

```sql
CREATE UNIQUE INDEX ON users (email) NULLS NOT DISTINCT;   -- chỉ cho MỘT NULL
```

Và **partial unique index** là công cụ giải quyết hai bài toán mà nhiều codebase xử lý sai:

```sql
-- ① "mỗi user chỉ có MỘT địa chỉ mặc định"
CREATE UNIQUE INDEX ON addresses (user_id) WHERE is_default;

-- ② soft delete: email unique trong số user CÒN SỐNG
CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL;
--    → xoá mềm rồi đăng ký lại cùng email: được
--    → hai user sống cùng email: không bao giờ
```

Cả hai thường được xử lý bằng code ở tầng service — và code đó sai dưới concurrency.

### `FOREIGN KEY` và `ON DELETE`

```sql
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE RESTRICT
FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
```

Chọn `ON DELETE` là quyết định **nghiệp vụ**:

```text
CASCADE   "dòng con không có ý nghĩa khi cha biến mất"
          order_items khi xoá order — hợp lý
          ⚠️ có thể xoá dây chuyền nhiều hơn bạn tưởng; kiểm tra trước

RESTRICT  "không cho xoá cha khi còn con"
          không cho xoá user còn đơn hàng — an toàn, mặc định tốt

SET NULL  "giữ dòng con, bỏ tham chiếu"
          author_id của bài viết khi xoá tác giả
```

Hai chi tiết vận hành:

1. **PostgreSQL không tự index cột FK.** Không có index trên cột con, mỗi `DELETE` ở bảng cha phải quét toàn bộ bảng con để kiểm tra. Với bảng con lớn, `DELETE` một dòng cha có thể mất vài giây.
   ```sql
   CREATE INDEX ON order_items (order_id);   -- gần như luôn cần
   ```
2. **FK lấy khoá trên dòng cha khi ghi dòng con** — đây là một nguồn deadlock ít rõ ràng. Xem [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md).

### `EXCLUDE`: bất biến giữa nhiều dòng

Đây là constraint mạnh nhất và ít được biết nhất:

```sql
CREATE EXTENSION btree_gist;

ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, during WITH &&);
--        "không có hai booking cùng phòng mà khoảng thời gian chồng lấn"
```

Nó đúng **kể cả khi hai request đến cùng một mili giây**. Không có cách nào viết logic ở tầng ứng dụng đạt được điều đó mà không dùng khoá.

Đây là ví dụ rõ nhất cho nguyên tắc của cả note: bất biến quan trọng nên được ép ở nơi không ai đi vòng được.

### `DEFERRABLE`: hoãn kiểm tra tới cuối transaction

```sql
ALTER TABLE nodes ADD CONSTRAINT fk_parent
  FOREIGN KEY (parent_id) REFERENCES nodes(id) DEFERRABLE INITIALLY DEFERRED;
```

Dùng khi cần chèn dữ liệu có tham chiếu vòng, hoặc khi thứ tự chèn không thể kiểm soát (import hàng loạt). Constraint được kiểm tra khi `COMMIT`.

Cái giá: lỗi xuất hiện ở `COMMIT` chứ không ở câu lệnh gây ra nó, nên khó tìm hơn. Chỉ dùng khi thật sự cần.

### Thêm constraint vào bảng đang chạy

```sql
-- ❌ quét toàn bảng, giữ ACCESS EXCLUSIVE → app dừng
ALTER TABLE orders ADD CONSTRAINT total_positive CHECK (total_cents >= 0);

-- ✅ hai bước, mỗi bước khoá ngắn
ALTER TABLE orders ADD CONSTRAINT total_positive
  CHECK (total_cents >= 0) NOT VALID;        -- áp dụng cho dòng MỚI, không quét dòng cũ
-- (dọn dữ liệu cũ vi phạm, theo lô)
ALTER TABLE orders VALIDATE CONSTRAINT total_positive;   -- quét, chỉ khoá nhẹ (SHARE UPDATE EXCLUSIVE)
```

Tương tự cho `NOT NULL` trên bảng lớn (PostgreSQL 12+):

```sql
ALTER TABLE orders ADD CONSTRAINT user_id_not_null CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT user_id_not_null;
ALTER TABLE orders ALTER COLUMN user_id SET NOT NULL;   -- nhanh: PG tin CHECK đã validate
ALTER TABLE orders DROP CONSTRAINT user_id_not_null;
```

Xem [Migrations](04-migrations.md) và [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md).

### Dịch lỗi constraint thành lỗi có nghĩa

Constraint cho tính đúng đắn, nhưng thông báo của nó vô nghĩa với người dùng. Dịch ở repository — nơi duy nhất biết mã lỗi nghĩa là gì:

```ts
try {
  return await this.db.user.create({ data });
} catch (e: any) {
  switch (e.code) {
    case '23505': throw new ConflictError('email đã được đăng ký');       // unique_violation
    case '23503': throw new ValidationError('tham chiếu không tồn tại');  // foreign_key_violation
    case '23514': throw new ValidationError('giá trị không hợp lệ');      // check_violation
    case '23502': throw new ValidationError('thiếu trường bắt buộc');     // not_null_violation
    case '23P01': throw new ConflictError('khoảng thời gian bị trùng');   // exclusion_violation
    default: throw e;
  }
}
```

Và một điểm quan trọng về thiết kế: **đây cũng là cách xử lý race condition đúng.** Thay vì `SELECT` kiểm tra rồi `INSERT`, hãy `INSERT` và bắt `23505`. Nó vừa đúng dưới concurrency vừa tiết kiệm một round-trip.

## Example

Cùng một bảng, hai cách:

```sql
-- ❌ mọi bất biến nằm trong code
CREATE TABLE bookings (
  id bigserial PRIMARY KEY,
  room_id bigint,
  user_id bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  price numeric
);
```

```sql
-- ✅ bất biến nằm trong schema
CREATE TABLE bookings (
  id          bigserial PRIMARY KEY,
  room_id     bigint      NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  during      tstzrange   NOT NULL,
  price_cents bigint      NOT NULL CHECK (price_cents > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (upper(during) > lower(during)),
  CHECK (upper(during) - lower(during) <= interval '30 days'),
  EXCLUDE USING gist (room_id WITH =, during WITH &&)
);
CREATE INDEX ON bookings (room_id);
CREATE INDEX ON bookings (user_id);
```

Bảng thứ hai làm cho những trạng thái sau **không thể tồn tại**, bất kể ai ghi và bao nhiêu request đến cùng lúc:

```text
✗ booking không có phòng hoặc không có người
✗ phòng/người không tồn tại
✗ giá âm hoặc bằng 0
✗ kết thúc trước khi bắt đầu
✗ đặt phòng 3 năm
✗ hai booking chồng lấn cùng phòng
```

Và nó đọc như một đặc tả nghiệp vụ — thứ mà không tài liệu nào giữ được chính xác lâu như vậy.

## Prediction

1. Không có FK, xoá một `user` còn đơn hàng — chuyện gì xảy ra với các đơn đó?
2. Có FK `ON DELETE RESTRICT` — chuyện gì xảy ra?
3. `ON DELETE CASCADE` trên `orders` và `order_items` cũng cascade — xoá một user, bao nhiêu bảng bị ảnh hưởng?
4. Unique index trên `email`, insert hai dòng `email = NULL` — thành công?
5. `NULLS NOT DISTINCT` (PostgreSQL 15+) — thành công?
6. Soft delete với unique index thường trên `email`, xoá mềm rồi đăng ký lại cùng email — được không?
7. Đổi sang partial unique `WHERE deleted_at IS NULL` — được không?
8. `EXCLUDE` chống chồng lấn, hai request đặt cùng phòng cùng giờ trong cùng mili giây — kết quả?
9. Không có `EXCLUDE`, dùng `SELECT` kiểm tra rồi `INSERT`, cùng tình huống — kết quả?
10. `ALTER TABLE ADD CHECK` trên bảng 50 triệu dòng đang có traffic — chuyện gì xảy ra?
11. Cùng câu lệnh với `NOT VALID` — khác gì?
12. FK không có index trên cột con, `DELETE` một dòng cha khi bảng con có 10 triệu dòng — mất bao lâu?
13. Lưu tiền bằng `float`, cộng 0.1 + 0.2 rồi so sánh với 0.3 — kết quả?

<details>
<summary>Đáp án</summary>

1. Đơn hàng thành **mồ côi** — `user_id` trỏ tới dòng không tồn tại. Mọi JOIN sau đó âm thầm bỏ chúng, và báo cáo thiếu.
2. `DELETE` bị từ chối với `foreign_key_violation`. Đây là FK làm đúng việc.
3. Có thể nhiều hơn bạn tưởng — cascade lan theo mọi FK có `CASCADE`. Kiểm tra bằng `EXPLAIN` hoặc thử trong transaction rồi `ROLLBACK`.
4. **Thành công** — hai NULL không bằng nhau.
5. **Thất bại** ở dòng thứ hai.
6. **Không** — email cũ vẫn chiếm chỗ trong index.
7. **Được** — chỉ dòng `deleted_at IS NULL` bị ràng buộc.
8. Một cái thành công, một cái nhận `23P01 exclusion_violation`. Bất biến được giữ.
9. Cả hai `SELECT` thấy "trống", cả hai `INSERT` thành công → **hai booking chồng lấn**.
10. Quét toàn bảng, giữ `ACCESS EXCLUSIVE` → **mọi query vào bảng đó bị chặn**, kể cả `SELECT`, trong suốt thời gian quét.
11. `NOT VALID` chỉ kiểm tra dòng mới, không quét — khoá rất ngắn. Sau đó `VALIDATE` quét với khoá nhẹ hơn, không chặn đọc/ghi thông thường.
12. Có thể **vài giây** — mỗi lần xoá phải quét bảng con để kiểm tra tham chiếu.
13. `0.1 + 0.2 = 0.30000000000000004` → so sánh sai. Đây là lý do tiền phải là số nguyên đơn vị nhỏ nhất.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá FK, insert `user_id` không tồn tại | Dữ liệu mồ côi; thử tìm nó sau 1 tháng |
| Chạy JOIN sau đó | Dòng mồ côi biến mất khỏi kết quả — báo cáo thiếu |
| Xoá unique index, chạy 50 request đồng thời tạo cùng email | Đếm số dòng trùng |
| Thêm lại unique index | Không tạo được vì đã có dữ liệu trùng — phải dọn trước |
| Unique thường + soft delete + đăng ký lại | Bị chặn |
| Partial unique `WHERE deleted_at IS NULL` | Được |
| `EXCLUDE` + hai request đồng thời | Một cái bị từ chối |
| Bỏ `EXCLUDE`, dùng kiểm tra ở app + hai request đồng thời | Hai booking chồng lấn |
| `ADD CHECK` không `NOT VALID` trên bảng lớn, đồng thời chạy `SELECT` | `SELECT` bị chặn |
| `ADD CHECK ... NOT VALID` rồi `VALIDATE` | Không bị chặn |
| Xoá index trên cột FK, `DELETE` dòng cha | Đo thời gian |
| Lưu tiền bằng `float`, cộng 1.000 lần 0.01 | Sai số tích luỹ |
| Cột `timestamp` thay `timestamptz`, đổi timezone của session | Giá trị đọc ra khác nhau |
| `ON DELETE CASCADE` sâu 3 tầng, xoá một dòng gốc trong transaction rồi `ROLLBACK` | Đếm số dòng bị ảnh hưởng |

## What Usually Goes Wrong

- **Không có FK** → dữ liệu mồ côi, phát hiện sau nhiều tháng qua báo cáo lệch.
- **Không index cột FK** → `DELETE` ở bảng cha chậm bất ngờ.
- **Kiểm tra unique bằng code** → dữ liệu trùng dưới concurrency.
- **Unique thường với soft delete** → không đăng ký lại được email đã xoá.
- **`CHECK` chỉ ở tầng app** → dữ liệu xấu từ script, migration, service khác.
- **Cho phép NULL bừa bãi** → mọi nơi đọc phải xử lý NULL; NULL đa nghĩa.
- **`timestamp` thay `timestamptz`** → bug timezone không báo lỗi.
- **Tiền bằng `float`** → sai số tích luỹ, đối soát không khớp.
- **`ADD CONSTRAINT` không `NOT VALID` trên bảng lớn** → khoá dài, app dừng.
- **`ON DELETE CASCADE` không cân nhắc** → xoá dây chuyền ngoài dự kiến.
- **Không dịch mã lỗi constraint** → 500 thay vì 409, và lộ tên constraint ra client.
- **`SELECT` kiểm tra rồi `INSERT`** thay vì bắt `23505` → race condition + một round-trip thừa.
- **Thêm constraint sau khi đã có dữ liệu xấu** → `ALTER` thất bại, và phải dọn thủ công.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Validation ở app là đủ | Nhiều đường vào khác, và không đúng dưới concurrency |
| Constraint làm chậm database | Chi phí nhỏ; dữ liệu xấu đắt hơn nhiều |
| FK chỉ là tài liệu | Nó là ràng buộc database ép, kể cả với ghi tay |
| PostgreSQL tự index FK | Chỉ tự index PRIMARY KEY và UNIQUE |
| `UNIQUE` chặn nhiều NULL | Cho phép nhiều NULL (trừ `NULLS NOT DISTINCT`) |
| `CHECK` truy vấn được bảng khác | Chỉ nhìn thấy một dòng |
| Constraint bắt được mọi bất biến | Bất biến tổng hợp cần tầng ứng dụng |
| Thêm constraint là thao tác nhanh | Trên bảng lớn nó quét toàn bảng và khoá |
| `numeric` là kiểu đúng cho tiền | Số nguyên đơn vị nhỏ nhất an toàn hơn |
| `timestamp` và `timestamptz` gần như nhau | `timestamp` không có múi giờ — bug im lặng |

## Debugging

1. **Tìm dữ liệu vi phạm bất biến chưa được ép**:
   ```sql
   SELECT count(*) FROM orders WHERE total_cents < 0;
   SELECT count(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;
   SELECT email, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1 HAVING count(*) > 1;
   ```
   Chạy ba câu này trên production ngay hôm nay. Kết quả thường gây bất ngờ.
2. **Xem constraint hiện có**: `\d+ tablename` trong psql.
3. **`ALTER` thất bại** → có dữ liệu vi phạm; tìm nó bằng chính điều kiện của constraint.
4. **Lỗi `23505` không rõ constraint nào** → tên constraint nằm trong `e.constraint` (node-postgres) hoặc trong `DETAIL` của lỗi.
5. **`DELETE` chậm bất thường** → kiểm tra FK trỏ tới bảng đó và index trên cột con.
6. **Deadlock khi `INSERT`** → có thể là khoá FK trên dòng cha; kiểm tra thứ tự chèn.
7. **Constraint bị vi phạm mà không hiểu vì sao** → tìm đường ghi khác: script, migration, service khác.

## Production Considerations

- **Constraint từ migration đầu tiên.** Thêm sau nghĩa là phải dọn dữ liệu xấu đã tích luỹ — và việc đó thường bất khả thi vì không ai biết dữ liệu đúng phải là gì.
- **`NOT VALID` rồi `VALIDATE`** cho mọi constraint thêm vào bảng lớn đang chạy.
- **Index mọi cột FK.**
- **Chạy "kiểm tra bất biến" định kỳ** như một job: đếm số dòng vi phạm những bất biến chưa ép được bằng constraint. Số đó phải bằng 0; khác 0 là có một đường ghi bạn chưa biết.
- **Dịch mã lỗi constraint ở repository**, không để lộ tên constraint ra client (nó tiết lộ schema).
- **Đặt tên constraint có nghĩa** — `orders_total_cents_positive` chứ không phải `orders_check1`. Tên xuất hiện trong log lỗi và là manh mối đầu tiên.
- **Bất biến quan trọng nên có cả hai lớp**: kiểm tra ở domain (thông báo tốt, test rẻ) và constraint ở DB (đúng tuyệt đối).
- **Cẩn thận với `ON DELETE CASCADE` trên dữ liệu quan trọng.** Cân nhắc soft delete + `RESTRICT` thay vì xoá thật.
- **`EXCLUDE` cho mọi bài toán chồng lấn** (lịch, đặt chỗ, khoảng giá theo thời gian). Nó rẻ hơn và đúng hơn mọi giải pháp ở tầng ứng dụng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều constraint | dữ liệu luôn đúng, là tài liệu | migration khó hơn, cần dọn dữ liệu cũ |
| Ít constraint | linh hoạt, migration dễ | dữ liệu xấu tích luỹ |
| FK | không có mồ côi | cần index, ghi chậm chút, deadlock qua khoá cha |
| `CASCADE` | dọn tự động | xoá dây chuyền ngoài dự kiến |
| `RESTRICT` | an toàn | phải xoá theo thứ tự thủ công |
| `NOT NULL` mặc định | logic đơn giản | phải nghĩ về giá trị mặc định |
| Cho phép NULL | linh hoạt | NULL đa nghĩa, mọi nơi phải xử lý |
| `EXCLUDE` | đúng tuyệt đối cho chồng lấn | ít quen thuộc, cần extension |
| Kiểm tra chỉ ở app | thông báo tốt, không round-trip | đi vòng được, sai dưới concurrency |
| Kiểm tra ở cả hai | tốt nhất về mọi mặt | trùng lặp logic, phải giữ đồng bộ |

## Explain Without Notes

1. Kể bảy đường ghi vào database, và giải thích vì sao validation ở app không đủ.
2. Constraint và validation khác nhau ở bốn điểm nào?
3. Vì sao partial unique index là câu trả lời cho soft delete và cho "chỉ một cái mặc định"?
4. `EXCLUDE` giải quyết bài toán gì mà code ở tầng app không giải được sạch?
5. Vì sao thêm constraint vào bảng lớn nguy hiểm, và `NOT VALID` giải quyết thế nào?
6. Vì sao tiền phải lưu bằng số nguyên đơn vị nhỏ nhất?
7. Constraint **không** ép được loại bất biến nào? Cho hai ví dụ.

## Related

- [Normalization](02-normalization.md) — cấu trúc bảng quyết định constraint nào khả thi
- [Relationships & cardinality](03-relationships-cardinality.md) — FK và các loại quan hệ
- [Migrations](04-migrations.md) — thêm constraint an toàn ở production
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — vì sao kiểm tra ở app sai dưới concurrency
- [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) — FK và deadlock; `ACCESS EXCLUSIVE` khi `ALTER`
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — partial unique, exclusion constraint
- [Validation & errors](../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — tầng validation và dịch lỗi
- [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — bất biến ở domain

## Version / Context

PostgreSQL 16. `NULLS NOT DISTINCT` từ 15. `EXCLUDE` cần `btree_gist` cho toán tử `=` trên kiểu thường. `NOT VALID` cho `CHECK` và `FOREIGN KEY` từ 9.1; tối ưu `SET NOT NULL` dựa trên `CHECK` đã validate từ 12.
