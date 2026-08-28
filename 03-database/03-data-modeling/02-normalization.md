---
level: intermediate
area: database
prerequisites:
  - ../00-sql/01-relational-thinking.md
related:
  - 03-relationships-cardinality.md
  - 01-constraints-invariants.md
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# Normalization & denormalization

> Bảng `orders` có cột `customer_email`. Khách đổi email. Bây giờ 4.000 đơn hàng cũ có email cũ, 12 đơn mới có email mới, và không ai biết cái nào đúng. Nhưng khoan — với **hoá đơn**, email tại thời điểm đặt hàng mới là cái đúng. Cùng một cấu trúc dữ liệu, hai kết luận trái ngược. Câu hỏi thật không phải "chuẩn hoá hay không" mà là "**giá trị này thuộc về ai, và nó có được phép thay đổi theo thời gian không**".

## Position

```text
Yêu cầu nghiệp vụ
   ↓
Thiết kế schema   ← note này: dữ liệu nằm ở đâu, lặp lại chỗ nào
   ↓
Constraint · Index · Query
   ↓
Hiệu năng · Tính đúng đắn
```

Đây là quyết định khó đảo ngược nhất trong toàn bộ hệ thống. Đổi framework mất một tháng; đổi mô hình dữ liệu của một sản phẩm đang chạy mất một năm.

## Problem

Bắt đầu bằng cách tự nhiên nhất — một bảng chứa mọi thứ:

```text
orders
id | customer_name | customer_email | customer_city | product_names        | total
1  | Anh           | a@x.com        | Hà Nội        | "Áo, Quần"           | 500
2  | Anh           | a@x.com        | Hà Nội        | "Mũ"                 | 100
3  | Bình          | b@x.com        | Đà Nẵng       | "Áo, Giày, Tất"      | 800
```

Bốn vấn đề, và chúng có tên gọi riêng vì chúng xuất hiện ở mọi hệ thống chưa chuẩn hoá:

```text
UPDATE anomaly   Anh đổi email → phải sửa MỌI dòng của Anh.
                 Sót một dòng ⇒ dữ liệu mâu thuẫn, và không có gì phát hiện ra.

INSERT anomaly   Không thêm được khách hàng chưa có đơn nào —
                 không có chỗ nào để đặt thông tin đó.

DELETE anomaly   Xoá đơn cuối cùng của Bình ⇒ mất luôn thông tin về Bình.

Không truy vấn được  "sản phẩm nào bán chạy nhất?"
                 → phải parse chuỗi "Áo, Quần". Không index được, không JOIN được,
                   không đếm được.
```

Vấn đề thứ tư là nghiêm trọng nhất về lâu dài: **dữ liệu nhồi trong một chuỗi không còn là dữ liệu quan hệ.** Bạn đã tự loại mình khỏi mọi công cụ mà database cung cấp.

## Mental Model

### Chuẩn hoá là "mỗi sự thật ở đúng một chỗ"

```text
Không chuẩn hoá:  một sự thật ở nhiều chỗ ⇒ chúng SẼ lệch nhau
Chuẩn hoá:        một sự thật ở một chỗ   ⇒ không thể lệch
```

Ba dạng chuẩn đầu đủ cho 99% công việc thực tế, và diễn đạt bằng ngôn ngữ thường thì rất đơn giản:

```text
1NF  Mỗi ô chứa MỘT giá trị.
     ✗ product_names = "Áo, Quần"
     ✓ bảng order_items riêng

2NF  Mọi cột phụ thuộc vào TOÀN BỘ khoá chính, không phải một phần.
     ✗ order_items(order_id, product_id, product_name)
        — product_name chỉ phụ thuộc product_id
     ✓ product_name thuộc bảng products

3NF  Không cột nào phụ thuộc vào cột KHÔNG PHẢI khoá.
     ✗ orders(id, customer_id, customer_city)
        — city phụ thuộc customer_id, không phụ thuộc order id
     ✓ city thuộc bảng customers
```

Cách kiểm tra thực dụng, không cần nhớ tên dạng chuẩn:

> **"Nếu sự thật này thay đổi, tôi phải sửa bao nhiêu dòng?"**
> Nhiều hơn một → nó đang ở sai chỗ.

Sau khi chuẩn hoá:

```sql
customers   (id, name, email, city)
products    (id, name, price_cents)
orders      (id, customer_id, created_at, total_cents)
order_items (order_id, product_id, qty, unit_price_cents)
```

### Ngoại lệ quan trọng: giá trị lịch sử

Đây là chỗ mà "chuẩn hoá triệt để" trở nên **sai**:

```sql
order_items (order_id, product_id, qty, unit_price_cents)
                                        ↑ TRÙNG LẶP có chủ đích với products.price_cents
```

Điều này trông như vi phạm chuẩn hoá. Thực ra không:

```text
products.price_cents      = "giá HIỆN TẠI của sản phẩm"
order_items.unit_price    = "giá TẠI THỜI ĐIỂM đặt hàng"

Đây là HAI SỰ THẬT KHÁC NHAU, chỉ tình cờ bằng nhau lúc tạo đơn.
```

Không lưu `unit_price` nghĩa là hoá đơn cũ thay đổi khi bạn đổi giá sản phẩm. Đó không phải tối ưu hoá — đó là dữ liệu sai.

Cùng lý lẽ áp dụng cho: địa chỉ giao hàng, tên người nhận, thuế suất, tỉ giá. **Bất cứ thứ gì xuất hiện trên một chứng từ đều phải được đóng băng tại thời điểm phát hành.**

Quay lại ví dụ mở đầu: `customer_email` trên bảng `orders` là **sai** nếu nó để hiển thị thông tin liên hệ hiện tại, và **đúng** nếu nó ghi lại "email đã nhận xác nhận đơn hàng này". Hai mục đích, hai cách thiết kế.

Cách phân biệt: đặt tên cho ý định.

```sql
-- rõ ràng là ảnh chụp lịch sử, không phải cache
order_items.unit_price_cents_at_purchase
orders.shipping_address_snapshot  jsonb
```

### Denormalization: trùng lặp có chủ đích, có cái giá rõ ràng

```text
Chuẩn hoá    ghi đơn giản (một chỗ), đọc cần JOIN
Phi chuẩn    đọc nhanh (không JOIN), ghi phải ĐỒNG BỘ nhiều chỗ
```

Denormalize khi **đã đo** và JOIN thật sự là nút thắt. Ba dạng, tăng dần về chi phí bảo trì:

```sql
-- ① Cột đếm sẵn — cập nhật bằng trigger hoặc trong cùng transaction
ALTER TABLE posts ADD COLUMN comment_count int NOT NULL DEFAULT 0;

-- ② Materialized view — làm mới định kỳ, chấp nhận trễ
CREATE MATERIALIZED VIEW daily_revenue AS
SELECT date_trunc('day', created_at) AS day, sum(total_cents) AS revenue
FROM orders WHERE status = 'paid' GROUP BY 1;
CREATE UNIQUE INDEX ON daily_revenue (day);        -- cần cho REFRESH CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;

-- ③ Bảng tổng hợp riêng — cập nhật bằng job
CREATE TABLE customer_stats (customer_id bigint PRIMARY KEY, order_count int, ...);
```

Với ①, đây là câu hỏi phải trả lời trước khi viết: **ai giữ cho nó đúng, và chuyện gì xảy ra khi nó lệch?**

```sql
-- cập nhật trong CÙNG transaction với thao tác gây ra nó
BEGIN;
  INSERT INTO comments (...) VALUES (...);
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1;
COMMIT;
```

Và một job đối soát định kỳ, vì nó **sẽ** lệch:

```sql
UPDATE posts p SET comment_count = c.n
FROM (SELECT post_id, count(*) AS n FROM comments GROUP BY post_id) c
WHERE c.post_id = p.id AND p.comment_count <> c.n;
```

Nếu bạn không viết job đối soát, bạn đã chọn "sống với dữ liệu lệch" — chỉ là chưa biết.

Trigger là lựa chọn khác: nó đảm bảo mọi đường ghi đều cập nhật counter, kể cả script và migration. Cái giá là logic ẩn — người đọc code ứng dụng không thấy nó.

### JSONB: khi nào hợp lý, khi nào là cái bẫy

```sql
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  type       text        NOT NULL,          -- cột thật: cần index và constraint
  user_id    bigint      REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  payload    jsonb       NOT NULL           -- phần thay đổi theo type
);
CREATE INDEX ON events USING gin (payload jsonb_path_ops);
```

```text
HỢP LÝ                                  BẪY
schema thật sự thay đổi theo dòng       nhét mọi thứ vào jsonb "cho linh hoạt"
dữ liệu từ bên ngoài, hình dạng đa dạng  dữ liệu có schema rõ ràng và ổn định
audit log, webhook payload thô           quan hệ (FK không hoạt động trong jsonb)
cấu hình theo tenant                     giá trị cần constraint (CHECK không tiện)
```

Ba điều mất khi dùng jsonb cho dữ liệu có schema:

```text
· không có FK       → không phát hiện tham chiếu treo
· không có NOT NULL / CHECK tiện lợi → không ép được bất biến
· query dài dòng và chậm hơn: payload->>'user_id' = '42'
  (cần expression index riêng, và phải viết biểu thức giống hệt)
```

Quy tắc: **cột thật cho thứ bạn lọc, join, hoặc ràng buộc; jsonb cho phần còn lại.**

### Nhận diện over-normalization

Chuẩn hoá cũng đi quá đà được:

```text
✗ Bảng riêng cho mọi enum có 3 giá trị
   order_statuses(id, name) với đúng 4 dòng, không bao giờ đổi
   → CHECK (status IN (...)) hoặc kiểu enum đơn giản hơn nhiều

✗ EAV (Entity-Attribute-Value)
   attributes(entity_id, key, value)
   → mất kiểu dữ liệu, mất constraint, query khủng khiếp
   → nếu cần linh hoạt, dùng jsonb — nó ít nhất có index và toán tử

✗ Tách bảng chỉ vì "nghe có vẻ sạch"
   users + user_profiles 1:1 mà luôn được đọc cùng nhau
   → một JOIN cho mọi query, không được lợi ích gì
```

Tách 1:1 chỉ hợp lý khi có lý do cụ thể: cột rất lớn ít khi đọc, dữ liệu nhạy cảm cần phân quyền riêng, hoặc vòng đời khác nhau.

## Example

Cùng một yêu cầu, ba mức thiết kế:

```sql
-- ① Chuẩn hoá — mặc định đúng
customers   (id, name, email, city)
products    (id, name, price_cents)
orders      (id, customer_id, status, created_at)
order_items (order_id, product_id, qty, unit_price_cents)   -- giá LỊCH SỬ

-- ② Thêm ảnh chụp lịch sử cho chứng từ
ALTER TABLE orders ADD COLUMN shipping_address_snapshot jsonb NOT NULL;
--   khách đổi địa chỉ → đơn cũ vẫn ghi đúng nơi đã giao

-- ③ Denormalize SAU KHI ĐO — chỉ khi JOIN là nút thắt thật
ALTER TABLE orders ADD COLUMN total_cents bigint NOT NULL DEFAULT 0;
--   tính trong cùng transaction với order_items
--   + job đối soát hằng đêm
```

Điểm quan trọng về thứ tự: ① là mặc định, ② là yêu cầu nghiệp vụ (không phải tối ưu hoá), ③ chỉ xuất hiện sau khi `EXPLAIN ANALYZE` chứng minh cần thiết.

Kiểm tra ③ có đáng không:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, sum(i.qty * i.unit_price_cents) AS total
FROM orders o JOIN order_items i ON i.order_id = o.id
WHERE o.customer_id = 42 GROUP BY o.id;
-- nếu đây là 2ms với index đúng → KHÔNG cần denormalize
-- nếu đây là 800ms trên bảng thật → cân nhắc
```

## Prediction

1. `orders.customer_email` (không phải snapshot), khách đổi email — đơn cũ hiển thị email nào? Đúng hay sai?
2. Cùng cấu trúc nhưng dùng cho **hoá đơn** — bây giờ đúng hay sai?
3. `order_items` không lưu `unit_price`, bạn tăng giá sản phẩm 20% — hoá đơn tháng trước thế nào?
4. `product_names = "Áo, Quần"`, câu hỏi "sản phẩm nào bán chạy nhất" — làm được không?
5. Xoá đơn hàng cuối cùng của một khách trong bảng gộp — mất gì?
6. `comment_count` cập nhật ngoài transaction của `INSERT comments`, lỗi giữa chừng — hậu quả?
7. `comment_count` không có job đối soát, chạy 1 năm — số đó còn đúng không?
8. Dữ liệu có schema rõ ràng nhưng lưu trong `jsonb`, cần FK tới `users` — làm được không?
9. `WHERE payload->>'user_id' = '42'` không có expression index, bảng 10 triệu dòng — nhanh hay chậm?
10. EAV với 20 thuộc tính, query lọc theo 3 thuộc tính — SQL trông thế nào?
11. Tách `users` và `user_profiles` 1:1, mọi màn hình đều cần cả hai — được gì?
12. `REFRESH MATERIALIZED VIEW` (không `CONCURRENTLY`) trên view lớn — đọc có bị chặn không?

<details>
<summary>Đáp án</summary>

1. Đơn cũ hiển thị email **cũ**. **Sai** nếu mục đích là thông tin liên hệ hiện tại.
2. **Đúng** — hoá đơn phải ghi thông tin tại thời điểm phát hành.
3. Hoá đơn tháng trước **thay đổi giá trị**. Đây là dữ liệu sai, và với kế toán thì là vấn đề nghiêm trọng.
4. Không — phải parse chuỗi. Không index được, không JOIN được, không đếm chính xác được.
5. Mất toàn bộ thông tin về khách hàng đó — DELETE anomaly.
6. `comment_count` lệch với số comment thật. Không có gì báo lỗi.
7. Gần như chắc chắn **không** — lỗi tích luỹ từ mọi đường ghi bất thường.
8. **Không** — FK không hoạt động với giá trị bên trong jsonb.
9. **Chậm** — Seq Scan. Cần `CREATE INDEX ON events ((payload->>'user_id'))`.
10. Ba lần self-join hoặc ba subquery, mỗi cái cho một thuộc tính. Khó đọc, khó tối ưu, và không có kiểu dữ liệu.
11. Gần như không được gì — thêm một JOIN cho mọi query.
12. **Có** — `REFRESH` thường lấy `ACCESS EXCLUSIVE`. `CONCURRENTLY` tránh được nhưng cần unique index và chậm hơn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gộp `customer_email` vào `orders`, đổi email, đếm dòng không khớp | Update anomaly |
| Bỏ `unit_price` khỏi `order_items`, đổi giá sản phẩm, in lại hoá đơn cũ | Số tiền thay đổi |
| Lưu danh sách sản phẩm dạng chuỗi, thử viết query "top sản phẩm" | Không viết được |
| Xoá đơn cuối cùng của một khách trong bảng gộp | Mất thông tin khách |
| Cập nhật `comment_count` ngoài transaction, ném lỗi giữa chừng | Lệch |
| Chạy job đối soát, đếm số dòng lệch sau một tuần dùng thật | Số khác 0 |
| Lưu quan hệ trong jsonb, thử tạo FK | Không được |
| Query `payload->>'x'` không index trên 5 triệu dòng | Seq Scan; đo thời gian |
| Thêm expression index, đo lại | Nhanh hơn nhiều |
| Viết query lọc 3 thuộc tính trên schema EAV | Đếm số dòng SQL |
| `REFRESH MATERIALIZED VIEW` không `CONCURRENTLY` trong lúc có `SELECT` | `SELECT` bị chặn |
| So thời gian query có JOIN và query đọc cột denormalized | Chênh lệch thật sự bao nhiêu? |

Dòng cuối là bài kiểm tra quan trọng nhất trước khi quyết định denormalize: rất nhiều lần chênh lệch là 2ms so với 3ms, và cái giá bảo trì không đáng.

## What Usually Goes Wrong

- **Nhiều giá trị trong một ô** → không truy vấn được, không index được.
- **Lặp dữ liệu không có chủ đích** → update anomaly, dữ liệu mâu thuẫn.
- **Không lưu giá trị lịch sử** → hoá đơn cũ thay đổi khi dữ liệu gốc đổi.
- **Denormalize trước khi đo** → phức tạp không cần thiết.
- **Cột đếm sẵn không có job đối soát** → lệch dần, không ai biết.
- **Cập nhật cột đếm ngoài transaction** → lệch ngay lần đầu có lỗi.
- **jsonb cho dữ liệu có schema** → mất FK, mất constraint, query chậm và dài dòng.
- **Không index jsonb** → Seq Scan trên bảng lớn.
- **EAV** → mất kiểu, mất constraint, query không đọc được.
- **Over-normalization** → bảng enum 4 dòng, JOIN vô ích, 1:1 không lý do.
- **Không đặt tên thể hiện ý định** → không phân biệt được "cache" và "ảnh chụp lịch sử"; người sau xoá nhầm cột.
- **Đổi mô hình dữ liệu muộn** → migration lớn, rủi ro cao, và thường bị hoãn vô hạn.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Chuẩn hoá càng cao càng tốt | Đến một mức nó thành over-normalization |
| Trùng lặp luôn xấu | Giá trị lịch sử **phải** trùng lặp |
| Denormalize để nhanh hơn | Chỉ sau khi đo; JOIN có index thường rất nhanh |
| JOIN là chậm | Với index đúng, JOIN thường tính bằng mili giây |
| jsonb làm schema linh hoạt hơn | Nó chuyển việc ép schema sang tầng ứng dụng |
| jsonb tránh được migration | Bạn vẫn phải migrate dữ liệu, chỉ là không có công cụ giúp |
| Cột đếm sẵn tự đúng | Nó sẽ lệch; cần đối soát |
| EAV linh hoạt | Nó xoá mọi lợi ích của mô hình quan hệ |
| Tách 1:1 cho sạch | Chỉ đáng khi có lý do cụ thể |
| Có thể sửa mô hình dữ liệu sau | Đây là quyết định khó đảo ngược nhất |

## Debugging

1. **Nghi có dữ liệu mâu thuẫn** — tìm cùng một sự thật ở nhiều nơi:
   ```sql
   SELECT customer_id, count(DISTINCT customer_email) FROM orders
   GROUP BY 1 HAVING count(DISTINCT customer_email) > 1;
   ```
2. **Kiểm tra cột denormalized có lệch không** — chạy query đối soát, đếm số dòng khác nhau.
3. **"Sự thật này thay đổi thì sửa mấy dòng?"** — nếu > 1, nó ở sai chỗ.
4. **Tìm cột nhồi nhiều giá trị** — cột `text` chứa dấu phẩy, `array`, hoặc jsonb chứa danh sách id.
5. **Trước khi denormalize, chạy `EXPLAIN ANALYZE`** trên query có JOIN với dữ liệu thật. Rất thường xuyên nó đã đủ nhanh.
6. **jsonb chậm** → có expression index hoặc GIN index chưa? Biểu thức trong query có khớp index không?
7. **Không rõ cột là cache hay lịch sử** → xem code ghi nó. Nếu nó được ghi một lần lúc tạo và không bao giờ cập nhật, đó là ảnh chụp lịch sử.

## Production Considerations

- **Bắt đầu chuẩn hoá.** Denormalize là tối ưu hoá, và tối ưu hoá phải đến sau phép đo.
- **Ảnh chụp lịch sử cho mọi chứng từ** — hoá đơn, đơn hàng, hợp đồng. Đây là yêu cầu nghiệp vụ, không phải lựa chọn kỹ thuật.
- **Đặt tên thể hiện ý định**: `_at_purchase`, `_snapshot`, `_cached`. Người sau sẽ biết được phép làm gì với cột đó.
- **Mọi giá trị denormalized cần một job đối soát** và một metric "số dòng lệch". Không có nó, bạn không biết mình đang phục vụ số sai.
- **Cập nhật giá trị denormalized trong cùng transaction** với thao tác gây ra nó, hoặc dùng trigger.
- **Materialized view cần `REFRESH CONCURRENTLY`** ở production (và do đó cần một unique index).
- **jsonb phải có index phù hợp** (GIN hoặc expression) nếu được dùng để lọc.
- **Validate hình dạng jsonb ở tầng ứng dụng** — database không làm hộ. Cân nhắc một `CHECK` với `jsonb_typeof` cho những field quan trọng.
- **Ghi lại quyết định thiết kế** — vì sao cột này trùng lặp, ai giữ nó đúng. Sáu tháng sau sẽ có người muốn "dọn dẹp" nó.
- **Kiểm tra mô hình bằng câu hỏi nghiệp vụ thật** trước khi viết code: liệt kê 10 câu hỏi mà sản phẩm cần trả lời, và thử viết query cho từng câu.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Chuẩn hoá | không mâu thuẫn, ghi đơn giản | cần JOIN khi đọc |
| Denormalize | đọc nhanh, ít JOIN | phải đồng bộ, sẽ lệch |
| Ảnh chụp lịch sử | dữ liệu lịch sử đúng | tốn chỗ, "trùng lặp" nhìn qua |
| Không lưu lịch sử | ít chỗ, một nguồn sự thật | chứng từ cũ thay đổi |
| Cột thật | FK, constraint, index, kiểu dữ liệu | phải migrate khi đổi schema |
| jsonb | linh hoạt, không migrate cấu trúc | mất constraint, query dài, cần index riêng |
| Cột đếm sẵn | đọc rất nhanh | cần đồng bộ và đối soát |
| Tính lúc đọc | luôn đúng | tốn tài nguyên mỗi lần |
| Materialized view | nhanh, không đụng đường ghi | dữ liệu trễ, cần refresh |
| Bảng enum riêng | thêm giá trị không cần migration | JOIN thêm, thường không đáng cho enum ổn định |

## Explain Without Notes

1. Kể bốn anomaly của bảng chưa chuẩn hoá, mỗi cái một ví dụ.
2. Câu hỏi kiểm tra thực dụng thay cho việc nhớ 1NF/2NF/3NF là gì?
3. Vì sao `order_items.unit_price` **không** vi phạm chuẩn hoá?
4. Cùng một cột `customer_email` trên `orders` — khi nào đúng, khi nào sai?
5. Ba điều bạn mất khi lưu dữ liệu có schema trong jsonb?
6. Điều kiện để denormalize, và hai thứ bắt buộc phải có kèm theo?
7. Vì sao EAV tệ hơn jsonb?

## Related

- [Relationships & cardinality](03-relationships-cardinality.md) — 1:1, 1:N, N:M và bảng nối
- [Constraints & invariants](01-constraints-invariants.md) — chuẩn hoá quyết định constraint nào khả thi
- [Migrations](04-migrations.md) — đổi mô hình dữ liệu ở production
- [Relational thinking](../00-sql/01-relational-thinking.md) — vì sao dữ liệu được chia ra
- [Joins & aggregation](../00-sql/02-joins-aggregation.md) — cái giá thật của JOIN
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — GIN cho jsonb, expression index
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — đo trước khi denormalize
- [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — mô hình dữ liệu và mô hình domain

## Version / Context

PostgreSQL 16. `jsonb` từ 9.4; `jsonb_path_ops` cho index nhỏ hơn; `REFRESH MATERIALIZED VIEW CONCURRENTLY` từ 9.4 (cần unique index). Các dạng chuẩn là lý thuyết quan hệ, đúng với mọi RDBMS.
