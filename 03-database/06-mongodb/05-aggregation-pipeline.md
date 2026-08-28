---
level: intermediate
area: database
prerequisites:
  - 01-document-model.md
  - 04-indexes-query-planning.md
related:
  - ../00-sql/02-joins-aggregation.md
  - ../00-sql/04-window-functions.md
---

# Aggregation pipeline

> Pipeline là `GROUP BY` của MongoDB, và nó mạnh hơn thế. Nhưng thứ tự stage quyết định query của bạn chạy 5ms hay 5 giây — vì chỉ stage **đầu tiên** dùng được index.

*Baseline: MongoDB 7.x/8.x.*

## Position

```text
Collection (documents)
      ↓
$match → $project → $lookup → $group → $sort → $limit      ← note này
      ↓ mỗi stage nhận output của stage trước
Result
```

## Problem

Bạn cần: doanh thu theo tháng của mỗi khách hàng, chỉ tính order đã trả tiền, sắp theo doanh thu giảm dần, lấy top 10.

Trong SQL, một câu `GROUP BY`. Với `find()` của MongoDB, **không làm được** — `find()` chỉ lọc và chiếu, không tổng hợp.

Ba phản ứng, và hai trong đó tệ:

| Phản ứng | Kết quả |
|---|---|
| Tải hết order về, `reduce` trong JavaScript | tải 5 triệu document qua network; hết RAM |
| Nhiều query rồi ghép thủ công | N+1, vẫn chậm, dễ sai |
| **Aggregation pipeline** | một query, database làm việc nó giỏi |

Nhưng pipeline có một cạm bẫy riêng: viết đúng nghĩa mà sai thứ tự thì nó chậm gấp hàng trăm lần.

## Mental Model

```text
Pipeline = một dãy phép biến đổi trên DÒNG DỮ LIỆU

[docs] → stage 1 → [docs'] → stage 2 → [docs''] → ... → kết quả

Mỗi stage:
  - nhận toàn bộ output của stage trước
  - không biết gì về stage trước đó nữa
```

Hai nguyên tắc suy ra từ mô hình này, và chúng chi phối mọi quyết định:

> **1. Lọc sớm nhất có thể.** Mỗi document bị loại ở stage 1 là một document mọi stage sau không phải xử lý.
>
> **2. Chỉ stage đầu dùng được index.** Sau stage đầu, dữ liệu là kết quả trung gian trong bộ nhớ — không có index nào cho nó.

Nguyên tắc 2 là điều khác biệt lớn nhất so với SQL. Trong PostgreSQL, planner tự đẩy điều kiện xuống và chọn index cho từng phần. Trong MongoDB, **bạn** chịu trách nhiệm đặt `$match` đầu tiên.

(MongoDB có tối ưu hoá tự động đẩy một số `$match` lên trước `$project`/`$unwind` khi an toàn — nhưng đừng dựa vào nó. Viết đúng thứ tự.)

## How It Works

### Các stage chính

```js
db.orders.aggregate([
  // 1. $match — LỌC. Đặt ĐẦU TIÊN để dùng index.
  { $match: { status: "paid", createdAt: { $gte: ISODate("2026-01-01") } } },

  // 2. $project — chọn/tính field. Giảm kích thước dữ liệu đi tiếp.
  { $project: {
      customerId: 1,
      total: 1,
      month: { $dateTrunc: { date: "$createdAt", unit: "month" } }
  }},

  // 3. $group — tổng hợp. _id là khoá nhóm.
  { $group: {
      _id: { customerId: "$customerId", month: "$month" },
      revenue: { $sum: "$total" },
      orderCount: { $sum: 1 },
      avgOrder: { $avg: "$total" }
  }},

  // 4. $sort — sắp xếp trên kết quả đã nhóm
  { $sort: { revenue: -1 } },

  // 5. $limit — cắt
  { $limit: 10 },

  // 6. $lookup — nối, đặt CUỐI khi chỉ cần cho ít document
  { $lookup: {
      from: "customers",
      localField: "_id.customerId",
      foreignField: "_id",
      as: "customer"
  }},
  { $set: { customer: { $first: "$customer" } } }
]);
```

Thứ tự trên là thứ tự tối ưu: lọc → giảm field → nhóm → sắp xếp → cắt → **rồi mới** nối.

`$lookup` ở stage 6 chỉ chạy cho **10** document (sau `$limit`), thay vì cho hàng triệu nếu đặt ở đầu. Đây là một trong những tối ưu có tác động lớn nhất.

### `$group` — khác `GROUP BY` ở một điểm

```js
{ $group: {
    _id: "$status",                        // khoá nhóm (null = nhóm tất cả)
    count: { $sum: 1 },
    total: { $sum: "$amount" },
    avg: { $avg: "$amount" },
    max: { $max: "$amount" },
    first: { $first: "$name" },            // cần $sort TRƯỚC để có nghĩa
    all: { $push: "$name" },               // ⚠️ tạo array — có thể vỡ 16MB
    unique: { $addToSet: "$name" }         // ⚠️ tương tự
}}
```

`$push` và `$addToSet` là nơi pipeline hay vỡ: nếu một nhóm có 500.000 phần tử, document kết quả vượt **16MB** và pipeline thất bại. Giới hạn 16MB áp dụng cho mọi document, kể cả document trung gian.

`$first`/`$last` chỉ có nghĩa khi đã `$sort` trước — nếu không, "đầu tiên" là bất định.

### `$unwind` — tháo array

```js
// Doanh thu theo sản phẩm, khi lines được embed
db.orders.aggregate([
  { $match: { status: "paid" } },
  { $unwind: "$lines" },                   // 1 order 3 lines → 3 document
  { $group: {
      _id: "$lines.productId",
      qty: { $sum: "$lines.qty" },
      revenue: { $sum: { $multiply: ["$lines.qty", "$lines.price"] } }
  }},
  { $sort: { revenue: -1 } },
  { $limit: 20 }
]);
```

`$unwind` **nhân số document** theo độ dài array. 1 triệu order × 5 line = 5 triệu document đi qua các stage sau. Đây là lý do `$match` phải đứng trước nó.

`preserveNullAndEmptyArrays: true` để giữ document có array rỗng — không có nó, chúng bị loại im lặng.

### `$lookup` — nối, và chi phí thật

```js
{ $lookup: {
    from: "customers",
    localField: "customerId",
    foreignField: "_id",
    as: "customer"                          // LUÔN là array, kể cả 1 kết quả
}}
```

Ba điều phải biết:

1. **Kết quả luôn là array.** Cần `$first` hoặc `$unwind` để phẳng.
2. **Cần index trên `foreignField`**, nếu không nó là một collection scan **cho mỗi document đầu vào** — đây là N+1 ở tầng database.
3. **Không tìm thấy = array rỗng**, không phải null. Vì không có foreign key, đây là trạng thái bình thường:

```js
{ $set: { customer: { $ifNull: [{ $first: "$customer" }, { name: "[đã xoá]" }] } } }
```

`$lookup` với sub-pipeline cho phép lọc bên trong:

```js
{ $lookup: {
    from: "orders",
    let: { cid: "$_id" },
    pipeline: [
      { $match: { $expr: { $eq: ["$customerId", "$$cid"] }, status: "paid" } },
      { $sort: { createdAt: -1 } },
      { $limit: 5 }                         // top-5 cho mỗi customer
    ],
    as: "recentOrders"
}}
```

Đây là tương đương `LATERAL JOIN` của PostgreSQL — dùng được cho "N mới nhất của mỗi nhóm".

### `$facet` — nhiều kết quả từ một lần quét

```js
// Vừa lấy dữ liệu trang vừa đếm tổng — MỘT lần quét
db.tasks.aggregate([
  { $match: { projectId: p1 } },
  { $facet: {
      data:  [{ $sort: { createdAt: -1 } }, { $skip: 0 }, { $limit: 20 }],
      total: [{ $count: "n" }],
      byStatus: [{ $group: { _id: "$status", n: { $sum: 1 } } }]
  }}
]);
```

`$facet` giải quyết đúng bài toán "list + count + facet filter" của một trang danh sách. Nhưng nhớ: `$count` trên tập lớn vẫn đắt — xem [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) về việc có nên trả `total` không.

### Các stage khác đáng biết

```js
{ $addFields: { ... } }        // = $set, thêm field mà không bỏ field khác
{ $set: { ... } }              // alias hiện đại của $addFields
{ $unset: "field" }            // bỏ field
{ $count: "total" }
{ $sortByCount: "$status" }    // = $group + $sort, viết ngắn
{ $sample: { size: 100 } }     // lấy mẫu ngẫu nhiên
{ $merge: { into: "summary" } } // GHI kết quả vào collection — materialized view
{ $out: "summary" }             // ghi, thay thế toàn bộ collection
```

`$merge` là công cụ mạnh và ít dùng: nó cho phép **precompute** một báo cáo đắt vào một collection, chạy theo schedule, rồi API chỉ đọc collection đó. Đây là materialized view thủ công.

### Giới hạn bộ nhớ

```text
100 MB   giới hạn mỗi stage ($group, $sort, ...)
         → vượt: lỗi, trừ khi allowDiskUse: true
16 MB    giới hạn mỗi document, kể cả document trung gian
         → $push/$addToSet trên nhóm lớn sẽ vỡ
```

```js
db.orders.aggregate([...], { allowDiskUse: true });   // cho phép tràn ra disk
```

`allowDiskUse` làm query chạy được nhưng chậm hơn nhiều. Nó là công cụ cho báo cáo offline, không phải cách sửa cho query trong đường request.

## Example

```js
// Top 10 khách hàng theo doanh thu tháng — thứ tự stage tối ưu
db.orders.aggregate([
  // 1. Lọc sớm, dùng index { status: 1, createdAt: -1 }
  { $match: { status: "paid", createdAt: { $gte: from, $lt: to } } },

  // 2. Giảm field ngay — mọi stage sau xử lý ít dữ liệu hơn
  { $project: { customerId: 1, total: 1 } },

  // 3. Tổng hợp
  { $group: { _id: "$customerId", revenue: { $sum: "$total" }, orders: { $sum: 1 } } },

  // 4. Sắp xếp + cắt TRƯỚC khi lookup
  { $sort: { revenue: -1 } },
  { $limit: 10 },

  // 5. Lookup chỉ cho 10 document
  { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "c" } },
  { $set: { customer: { $ifNull: [{ $first: "$c" }, { name: "[đã xoá]" }] } } },
  { $unset: "c" }
]);
```

## Prediction

1. `$lookup` đặt trước `$match` với 1 triệu document, sau `$match` còn 100 — `$lookup` chạy bao nhiêu lần?
2. Đảo lại thứ tự — bao nhiêu lần?
3. `$unwind` array 5 phần tử trên 1 triệu document — bao nhiêu document đi vào stage sau?
4. `$group` với `$push` cho một nhóm có 1 triệu phần tử — kết quả?
5. `$lookup` không có index trên `foreignField`, 10.000 document đầu vào — điều gì xảy ra?
6. `$sort` trên 500MB kết quả trung gian, không `allowDiskUse` — chậm hay lỗi?
7. `$lookup` trả về document không tìm thấy — `as` field là gì?
8. `$first` mà không có `$sort` trước — kết quả có xác định không?

<details>
<summary>Đáp án</summary>

1. 1 triệu lần.
2. 100 lần.
3. 5 triệu.
4. Vỡ 16MB — pipeline thất bại.
5. Một collection scan cho **mỗi** document đầu vào — N+1 ở tầng database, cực chậm.
6. **Lỗi** (vượt 100MB mỗi stage).
7. Array **rỗng** `[]`, không phải `null`.
8. Không — bất định.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt `$lookup` trước `$match`, đo thời gian | Chậm gấp hàng nghìn lần |
| Đảo thứ tự | Nhanh |
| Xoá index trên `foreignField` của `$lookup` | `explain` cho thấy scan lặp lại |
| `$unwind` trước `$match` trên collection lớn | Số document trung gian nổ |
| `$group` + `$push` trên nhóm rất lớn | Lỗi 16MB |
| `$sort` tập lớn không `allowDiskUse` | Lỗi 100MB |
| Thêm `allowDiskUse` | Chạy được nhưng chậm |
| Bỏ `preserveNullAndEmptyArrays` với array rỗng | Document bị loại im lặng |
| `$explain` pipeline, xem stage đầu | Xác nhận `IXSCAN` hay `COLLSCAN` |
| So `$facet` vs hai query riêng (data + count) | Một lần quét vs hai |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Mọi stage dùng được index | Chỉ stage **đầu tiên** |
| MongoDB tự tối ưu thứ tự stage | Có một số tối ưu, nhưng đừng dựa vào |
| `$lookup` như JOIN của SQL | Đắt hơn nhiều; cần index; kết quả là array |
| `$lookup` đặt đâu cũng như nhau | Đặt sau `$limit` giảm chi phí hàng nghìn lần |
| `$unwind` chỉ tháo array | Nó **nhân** số document |
| Giới hạn 16MB chỉ cho document lưu trữ | Áp dụng cả document trung gian |
| `allowDiskUse` là cách sửa | Nó là workaround; sửa là lọc sớm + index |
| `$first` cho phần tử đầu tự nhiên | Cần `$sort` trước, nếu không là bất định |

## Debugging

1. **`explain()` cho pipeline** — kiểm tra stage đầu có `IXSCAN` không:
   ```js
   db.orders.explain("executionStats").aggregate([...]);
   ```
   Nếu stage đầu là `COLLSCAN`, mọi tối ưu khác là vô nghĩa.
2. **Chạy từng phần** — thêm `$limit: 5` sau mỗi stage để xem hình dạng dữ liệu trung gian. Đây là cách nhanh nhất tìm stage làm sai:
   ```js
   db.orders.aggregate([ stage1, stage2, { $limit: 5 } ]);
   ```
3. **Đếm document sau mỗi stage** bằng `$count` tạm — nó chỉ ra stage nào làm nổ số lượng.
4. **Lỗi 16MB** → tìm `$push`/`$addToSet` trên nhóm lớn; đổi sang `$sum`/`$count`, hoặc `$limit` trong sub-pipeline.
5. **Lỗi 100MB** → lọc sớm hơn, hoặc thêm index cho `$sort` ở stage đầu.
6. **`$lookup` chậm** → kiểm tra index trên `foreignField`. Đây là nguyên nhân số một.
7. **Profiler** bắt được pipeline chậm giống query thường: `db.setProfilingLevel(1, { slowms: 100 })`.

## Production Considerations

- **`$match` đầu tiên, luôn luôn**, và có index phục vụ nó.
- **`$project`/`$unset` sớm** để giảm dữ liệu đi qua các stage sau.
- **`$lookup` cuối cùng**, sau `$limit` khi có thể; và luôn có index trên `foreignField`.
- **Xử lý array rỗng từ `$lookup`** bằng `$ifNull` — reference mồ côi là trạng thái bình thường khi không có FK.
- **Không chạy aggregation nặng trong đường request.** Precompute bằng `$merge` theo schedule, hoặc đưa vào queue. Xem [Vì sao cần queue](../04-message-queues/01-why-queue.md).
- **`allowDiskUse` chỉ cho báo cáo offline**, không cho endpoint người dùng.
- **Đọc từ secondary** cho aggregation phân tích để không ảnh hưởng primary — nhưng chấp nhận dữ liệu hơi cũ. Xem [Operations & production](07-operations-production.md).
- **Đặt `maxTimeMS`** cho mọi aggregation để nó không chạy vô hạn:
  ```js
  db.orders.aggregate([...], { maxTimeMS: 5000 });
  ```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Aggregation trong DB | không tải dữ liệu về, nhanh | logic nằm trong pipeline, khó test hơn |
| Tính trong application | dễ test, dễ đọc | tải dữ liệu lớn qua network |
| `$lookup` | nối được như JOIN | đắt; cần index; không nên là công cụ chính |
| Denormalize (extended reference) | không cần `$lookup` | dữ liệu lặp, cần đồng bộ |
| `$merge` precompute | đọc rất nhanh | dữ liệu cũ; thêm job |
| `allowDiskUse` | query lớn chạy được | chậm; che vấn đề thiếu index |
| `$facet` | một lần quét cho nhiều kết quả | `$count` vẫn đắt trên tập lớn |

## Explain Without Notes

1. Hai nguyên tắc của pipeline, và vì sao nguyên tắc 2 khác với SQL?
2. Vì sao đặt `$lookup` sau `$limit` giảm chi phí hàng nghìn lần?
3. `$unwind` làm gì với số lượng document?
4. Hai giới hạn bộ nhớ (16MB và 100MB) áp dụng ở đâu?
5. Ba điều phải biết về `$lookup`?
6. Kỹ thuật debug pipeline hiệu quả nhất?

## Related

- [Indexes & query planning](04-indexes-query-planning.md) — index cho `$match` stage đầu
- [Document model](01-document-model.md) — giới hạn 16MB
- [Embed vs reference](02-embed-vs-reference.md) — denormalize để tránh `$lookup`
- [Operations & production](07-operations-production.md) — đọc từ secondary
- [Joins & aggregation](../00-sql/02-joins-aggregation.md) — tương đương SQL
- [Window functions](../00-sql/04-window-functions.md) — MongoDB có `$setWindowFields` tương tự
- [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — `$facet` và chi phí `$count`
- [Vì sao cần queue](../04-message-queues/01-why-queue.md) — aggregation nặng thuộc về job
