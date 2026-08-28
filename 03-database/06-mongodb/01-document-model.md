---
level: intermediate
area: database
prerequisites:
  - ../00-sql/01-relational-thinking.md
related:
  - 02-embed-vs-reference.md
  - 08-postgresql-vs-mongodb.md
  - ../../06-system-design/06-storage-selection.md
---

# Document model

> "Table = collection, row = document" là cách nhanh nhất để hiểu cú pháp MongoDB và cũng là cách nhanh nhất để thiết kế sai. Analogy đó bỏ mất điều duy nhất thật sự khác biệt.

*Baseline: MongoDB 7.x/8.x.*

## Position

```text
Application (object)
      ↓  gần như không cần mapping
MongoDB: database → collection → document (BSON)
      ↓
storage engine (WiredTiger) → disk
```

## Problem

Trong PostgreSQL, một order với 3 dòng hàng nằm ở hai bảng:

```sql
orders(id, customer_id, total, created_at)
order_lines(id, order_id, product_id, qty, price)
```

Đọc một order = một JOIN, hoặc hai query. Ghi một order = hai `INSERT` trong một transaction. Cấu trúc này tối ưu cho việc **không lặp dữ liệu** và **truy vấn linh hoạt từ mọi hướng**.

Nhưng nếu 95% thao tác của bạn là "đọc toàn bộ một order" và "ghi toàn bộ một order", thì mỗi lần bạn phải tháo object thành hai bảng rồi ghép lại. Chi phí đó là thật: JOIN, transaction, mapping code, và nhiều round-trip nếu làm sai.

MongoDB đặt câu hỏi khác:

> **Nếu dữ liệu luôn được đọc và ghi cùng nhau, sao không lưu nó cùng nhau?**

## Mental Model

Analogy quen thuộc và **giới hạn** của nó:

| Relational | MongoDB | Nhưng khác ở đâu |
|---|---|---|
| database | database | tương đương |
| table | collection | collection **không** ép schema chung |
| row | document | document có thể **lồng nhau nhiều tầng** |
| column | field | field có thể là array hoặc object |
| primary key | `_id` | luôn tồn tại, tự sinh nếu không đặt |
| JOIN | `$lookup` | có, nhưng đắt hơn và không phải công cụ chính |
| schema (bắt buộc) | schema (tuỳ chọn) | schema vẫn tồn tại — chỉ là ai ép nó |

Bốn hàng cuối là chỗ analogy vỡ. Nhưng khác biệt **quan trọng nhất** không nằm trong bảng này — nó nằm ở nguyên tắc thiết kế:

```text
Relational:  chuẩn hoá trước, JOIN khi cần
             "mỗi sự thật ở đúng một chỗ"
             → tối ưu cho tính toàn vẹn và truy vấn linh hoạt

MongoDB:     mô hình theo TRUY VẤN
             "dữ liệu nào được đọc/ghi cùng nhau thì lưu cùng nhau"
             → tối ưu cho một access pattern cụ thể
```

Đây là đảo chiều thiết kế:

> **Trong PostgreSQL, bạn thiết kế schema rồi viết query.**
> **Trong MongoDB, bạn xác định query rồi thiết kế schema.**

Hệ quả trực tiếp: MongoDB **thưởng** cho việc bạn biết trước access pattern và **phạt** khi access pattern thay đổi. PostgreSQL thì ngược lại — schema chuẩn hoá cho phép query từ hướng bạn chưa nghĩ tới, với giá là JOIN.

Điều này giải thích một hiểu nhầm phổ biến: MongoDB không phải "database cho khi bạn chưa biết schema". Nó là database cho khi bạn **biết rõ** access pattern. Không biết access pattern là lý do để chọn PostgreSQL, không phải MongoDB.

## How It Works

### Document và BSON

```js
// Một document — order kèm luôn dòng hàng
{
  _id: ObjectId("66cf1a2b3c4d5e6f7a8b9c0d"),
  customerId: ObjectId("66cf1a2b3c4d5e6f7a8b9c01"),
  status: "paid",
  total: NumberDecimal("1250000"),        // Decimal128 — dùng cho tiền
  createdAt: ISODate("2026-08-28T10:00:00Z"),
  shipping: {                             // object lồng
    city: "Hà Nội",
    ward: "Cầu Giấy"
  },
  lines: [                                // array of object
    { productId: ObjectId("..."), name: "Bàn phím", qty: 1, price: NumberDecimal("850000") },
    { productId: ObjectId("..."), name: "Chuột",    qty: 2, price: NumberDecimal("200000") }
  ],
  tags: ["urgent", "gift"]                // array of scalar
}
```

**BSON** (Binary JSON) là định dạng lưu trữ. Nó khác JSON ở chỗ có **kiểu dữ liệu thật**:

| BSON type | Vì sao quan trọng |
|---|---|
| `ObjectId` | 12 byte, chứa timestamp — sắp xếp được theo thời gian tạo |
| `Date` | kiểu ngày thật, không phải string |
| `Decimal128` | **dùng cho tiền** — `Double` gây sai số |
| `Int32` / `Int64` | phân biệt, quan trọng khi tổng hợp |
| `Binary` | dữ liệu nhị phân |
| `null` vs field không tồn tại | **hai thứ khác nhau** — xem dưới |

Hai bẫy kiểu dữ liệu gây bug thật:

```js
// 1. Double cho tiền — sai số tích luỹ, giống float trong mọi ngôn ngữ
{ price: 0.1 }                      // ❌ Double
{ price: NumberDecimal("0.1") }     // ✅ Decimal128

// 2. null KHÁC field không tồn tại
db.users.find({ phone: null })
// → khớp CẢ document có phone: null VÀ document KHÔNG CÓ field phone
db.users.find({ phone: { $type: "null" } })   // chỉ phone: null
db.users.find({ phone: { $exists: false } })  // chỉ không có field
```

Bẫy thứ hai không có tương đương trong SQL (nơi mọi dòng đều có mọi cột) và là nguồn của query trả về nhiều hơn mong đợi.

### `ObjectId`

```js
ObjectId("66cf1a2b3c4d5e6f7a8b9c0d")
//        └──┬──┘└────┬────┘└─┬─┘
//      timestamp   random  counter
//        4 byte    5 byte  3 byte
```

Vì 4 byte đầu là timestamp, `ObjectId` **tăng dần theo thời gian**. Ba hệ quả:

- Sắp xếp theo `_id` ≈ sắp xếp theo thời gian tạo → dùng được làm cursor pagination.
- Lấy được thời gian tạo mà không cần field riêng: `objectId.getTimestamp()`.
- Ghi tuần tự vào cuối index (tốt cho write throughput), nhưng **là shard key tệ** — mọi document mới đi vào cùng một shard. Xem [Operations & production](07-operations-production.md).

### Giới hạn cứng phải biết trước

Đây là những con số định hình mọi quyết định thiết kế:

```text
16 MB      kích thước tối đa MỘT document   ← giới hạn quan trọng nhất
100 tầng   độ sâu lồng tối đa
~1024 byte kích thước tối đa một index entry
64 index   tối đa mỗi collection
```

**16MB** là lý do "nhúng mọi thứ vào một document" không phải chiến lược chung. Một user với 100.000 bài post không thể embed. Nó cũng là lý do array không giới hạn (unbounded array) là anti-pattern số một của MongoDB. Xem [Embed vs reference](02-embed-vs-reference.md).

### Đọc và ghi một document là nguyên tử

```js
// Cập nhật nhiều field, kể cả trong array lồng — NGUYÊN TỬ, không cần transaction
db.orders.updateOne(
  { _id: orderId, "lines.productId": productId },
  {
    $inc: { "lines.$.qty": 1, total: 200000 },
    $set: { updatedAt: new Date() },
    $push: { history: { action: "qty_changed", at: new Date() } }
  }
);
```

Đây là điểm mạnh thật của document model: nếu bạn thiết kế sao cho **một business operation = một document**, bạn không cần transaction. Ba thao tác trên (`$inc` hai field, `$set`, `$push`) đều nguyên tử với nhau.

So sánh: cùng việc đó trong PostgreSQL chuẩn hoá cần một transaction bao `UPDATE orders` + `UPDATE order_lines` + `INSERT order_history`.

Ngược lại: nếu business operation của bạn **luôn** chạm nhiều document, document model đang chống lại bạn — và đó là tín hiệu về mô hình dữ liệu hoặc về lựa chọn database. Xem [Transactions & consistency](06-transactions-consistency.md).

### Query cơ bản

```js
// Tìm — dot notation đi vào field lồng và cả array
db.orders.find({ "shipping.city": "Hà Nội", status: "paid" });
db.orders.find({ "lines.productId": pid });        // khớp NẾU BẤT KỲ phần tử array khớp
db.orders.find({ total: { $gte: 500000 } });

// Projection — tương đương SELECT cột
db.orders.find({ status: "paid" }, { _id: 1, total: 1, "shipping.city": 1 });

// Toán tử array
db.orders.find({ tags: { $all: ["urgent", "gift"] } });
db.orders.find({ lines: { $elemMatch: { qty: { $gt: 1 }, price: { $lt: 300000 } } } });
```

`$elemMatch` quan trọng: nó yêu cầu **cùng một phần tử** thoả mọi điều kiện. Không có nó, `{ "lines.qty": { $gt: 1 }, "lines.price": { $lt: 300000 } }` khớp khi *một* phần tử có qty > 1 và *một phần tử khác* có price < 300000 — gần như luôn không phải ý bạn.

## Example

```text
Cùng một domain, hai mô hình

PostgreSQL (chuẩn hoá)              MongoDB (mô hình theo truy vấn)
─────────────────────               ──────────────────────────────
orders                              orders
  id, customer_id, total              _id, customerId, total, status
order_lines                           lines: [ { productId, name, qty, price } ]
  id, order_id, product_id,           shipping: { city, ward }
  qty, price
order_shipping
  order_id, city, ward

Đọc 1 order: JOIN 3 bảng           Đọc 1 order: 1 document, 1 lần đọc
Sửa giá sản phẩm: 1 UPDATE         Sửa tên sản phẩm: phải cập nhật MỌI order
Query "sản phẩm bán nhiều nhất":   Query đó: cần aggregation pipeline
  GROUP BY dễ                        phức tạp hơn
```

Bảng này là toàn bộ đánh đổi. Không có bên nào thắng — có bên phù hợp với access pattern của bạn.

Chú ý dòng "sửa tên sản phẩm": vì `name` được **nhúng** vào mỗi order line, đổi tên sản phẩm không lan sang order cũ. Đó có thể là **bug** (danh mục sản phẩm cần đồng bộ) hoặc **tính năng** (order phải giữ tên tại thời điểm mua — snapshot lịch sử). Quyết định điều này là nội dung của [note 02](02-embed-vs-reference.md).

## Prediction

1. `db.users.find({ phone: null })` — khớp document không có field `phone` không?
2. Document 20MB — insert được không?
3. `{ price: 0.1 }` cộng dồn 1000 lần — kết quả chính xác?
4. Sắp xếp theo `_id` tăng dần — có tương đương sắp xếp theo thời gian tạo?
5. `updateOne` với `$inc` hai field và `$push` một array — có cần transaction để nguyên tử?
6. `db.orders.find({ "lines.qty": { $gt: 5 }, "lines.price": { $lt: 100 } })` — có yêu cầu cùng một phần tử thoả cả hai?
7. `_id` làm shard key với `ObjectId` — dữ liệu phân bố thế nào?
8. Collection không khai báo schema — hai document có thể có cấu trúc khác nhau hoàn toàn?

<details>
<summary>Đáp án</summary>

1. **Có** — `null` khớp cả "field bằng null" và "field không tồn tại". Dùng `$type` hoặc `$exists` để phân biệt.
2. **Không** — vượt giới hạn 16MB.
3. Không — `Double` có sai số. Dùng `Decimal128`.
4. Gần đúng — 4 byte đầu của `ObjectId` là timestamp (độ phân giải giây).
5. **Không** — mọi thay đổi trong một document là nguyên tử.
6. **Không** — cần `$elemMatch`.
7. Dồn hết vào một shard (hot shard) vì `ObjectId` tăng dần.
8. Có — nhưng schema vẫn tồn tại ở tầng application. Xem [note 03](03-schema-design-validation.md).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Insert document có `phone: null`, một document không có `phone`, rồi `find({ phone: null })` | Cả hai được trả về |
| Cố insert document > 16MB | Lỗi `BSONObjectTooLarge` |
| `$push` vào array 100.000 lần | Document phình dần tới giới hạn; thời gian ghi tăng |
| Lưu tiền bằng `Double`, cộng 1000 giao dịch | Sai số |
| Insert document với `qty` là string ở một doc và number ở doc khác | `find({ qty: { $gt: 5 } })` bỏ qua doc string — im lặng |
| Query hai điều kiện trên cùng array không dùng `$elemMatch` | Trả nhiều hơn mong đợi |
| Đọc một order embed vs JOIN 3 bảng trong PostgreSQL | So số round-trip |
| Đổi tên một sản phẩm được embed trong 10.000 order | Phải update 10.000 document |

Thí nghiệm 5 là quan trọng: **kiểu dữ liệu không nhất quán làm query im lặng bỏ sót dữ liệu.** Không có schema ép buộc, đây là lỗi thường gặp nhất.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Table = collection, row = document là đủ | Bỏ mất khác biệt về nguyên tắc thiết kế |
| MongoDB cho khi chưa biết schema | Nó cho khi **biết rõ access pattern**; không biết → chọn PostgreSQL |
| MongoDB không có schema | Schema tồn tại; câu hỏi là ai ép nó |
| Không có JOIN trong MongoDB | Có `$lookup`, nhưng đắt và không phải công cụ chính |
| Document lớn tuỳ ý | Giới hạn cứng 16MB |
| `null` và thiếu field như nhau | Khác nhau; ảnh hưởng kết quả query |
| MongoDB nhanh hơn PostgreSQL | Nhanh hơn cho *access pattern nó được thiết kế cho*; chậm hơn ở nơi khác |
| Nhúng mọi thứ là cách MongoDB | Unbounded array là anti-pattern số một |

## Debugging

1. **Query trả nhiều/ít hơn mong đợi** → nghi `null` vs `$exists`, và kiểu dữ liệu không nhất quán:
   ```js
   db.orders.aggregate([{ $group: { _id: { $type: "$qty" }, n: { $sum: 1 } } }]);
   ```
   Nếu thấy nhiều hơn một type cho cùng field, đó là nguyên nhân.
2. **Kiểm tra kích thước document** trước khi nó thành vấn đề:
   ```js
   db.orders.aggregate([
     { $project: { size: { $bsonSize: "$$ROOT" } } },
     { $sort: { size: -1 } }, { $limit: 5 }
   ]);
   ```
3. **`db.collection.stats()`** cho kích thước trung bình document và tổng dung lượng index.
4. **Array đang phình** → tìm document có array dài nhất:
   ```js
   db.users.aggregate([{ $project: { n: { $size: { $ifNull: ["$posts", []] } } } },
                       { $sort: { n: -1 } }, { $limit: 5 }]);
   ```
5. **Xem document thật** thay vì tin schema tưởng tượng: `db.orders.findOne()`. Với MongoDB, đọc dữ liệu thật là bước đầu tiên, không phải bước cuối.

## Production Considerations

- **`Decimal128` cho tiền**, luôn luôn. `Double` là bug đang chờ.
- **Không để array không giới hạn.** Nếu một array có thể lớn vô hạn, nó phải thành collection riêng.
- **Chuẩn hoá kiểu dữ liệu ngay từ tầng application** — không có database nào ép giúp bạn nếu không bật validation. Xem [note 03](03-schema-design-validation.md).
- **`_id` tuỳ chỉnh** khi có khoá nghiệp vụ tự nhiên (ví dụ `orderNumber`) — nó tiết kiệm một index.
- **Theo dõi kích thước document p99**, không chỉ trung bình.
- **Xác định access pattern trước khi thiết kế** — đây không phải lời khuyên chung, nó là điều kiện để dùng MongoDB đúng.
- Nếu bạn thấy mình cần `$lookup` ở phần lớn query, mô hình dữ liệu đang sai — hoặc bạn cần PostgreSQL. Xem [note 08](08-postgresql-vs-mongodb.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Document model | đọc/ghi một đơn vị nhanh, nguyên tử miễn phí | lặp dữ liệu, query từ hướng khác đắt |
| Chuẩn hoá (relational) | một sự thật một chỗ, query linh hoạt | JOIN, transaction, mapping |
| `_id` là `ObjectId` | tự sinh, sắp xếp theo thời gian | shard key tệ |
| `_id` là khoá nghiệp vụ | tiết kiệm index, ý nghĩa rõ | phải bảo đảm duy nhất |
| Không schema ép buộc | thay đổi nhanh | kiểu không nhất quán, query im lặng sai |

## Explain Without Notes

1. Analogy "table = collection" bỏ mất điều gì quan trọng nhất?
2. Đảo chiều thiết kế giữa PostgreSQL và MongoDB là gì?
3. Vì sao "chưa biết schema" là lý do chọn PostgreSQL, không phải MongoDB?
4. `null` khác "field không tồn tại" thế nào, và vì sao nó gây bug?
5. Giới hạn 16MB ảnh hưởng thiết kế ra sao?
6. Vì sao `ObjectId` là shard key tệ?

## Related

- [Embed vs reference](02-embed-vs-reference.md) — quyết định thiết kế trung tâm
- [Schema design & validation](03-schema-design-validation.md) — schema vẫn tồn tại
- [Indexes & query planning](04-indexes-query-planning.md) — index phục vụ access pattern
- [Aggregation pipeline](05-aggregation-pipeline.md) — khi cần tổng hợp
- [Transactions & consistency](06-transactions-consistency.md) — khi một document không đủ
- [PostgreSQL vs MongoDB](08-postgresql-vs-mongodb.md) — chọn thế nào
- [Relational thinking](../00-sql/01-relational-thinking.md) — mô hình đối chiếu
- [Storage selection](../../06-system-design/06-storage-selection.md) — bức tranh rộng hơn
