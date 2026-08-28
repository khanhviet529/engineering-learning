---
level: intermediate
area: database
prerequisites:
  - 01-document-model.md
related:
  - 03-schema-design-validation.md
  - 04-indexes-query-planning.md
  - ../03-data-modeling/03-relationships-cardinality.md
---

# Embed vs reference

> Đây là quyết định quan trọng nhất khi thiết kế MongoDB. Nó không có đáp án đúng chung — nó có một bộ câu hỏi, và câu trả lời phụ thuộc vào access pattern của bạn.

*Baseline: MongoDB 7.x/8.x.*

## Position

```text
Access pattern (đọc gì, ghi gì, tần suất nào)
        ↓
[ Embed  |  Reference  |  Kết hợp ]        ← note này
        ↓
Cấu trúc document → index → hiệu năng thật
```

## Problem

Bạn có `User` và `Post`. Hai lựa chọn:

```js
// A. Embed — post nằm trong user
{
  _id: ObjectId("u1"),
  name: "Khánh",
  posts: [
    { title: "Bài 1", body: "...", createdAt: ISODate("...") },
    { title: "Bài 2", body: "...", createdAt: ISODate("...") }
  ]
}

// B. Reference — post ở collection riêng
// users
{ _id: ObjectId("u1"), name: "Khánh" }
// posts
{ _id: ObjectId("p1"), authorId: ObjectId("u1"), title: "Bài 1", body: "..." }
{ _id: ObjectId("p2"), authorId: ObjectId("u1"), title: "Bài 2", body: "..." }
```

Lựa chọn A: đọc user kèm post = **một** lần đọc. Nhưng nếu user có 50.000 post, document vượt 16MB và **không insert được nữa**. Và mỗi lần đọc tên user, bạn tải cả 50.000 post.

Lựa chọn B: mở rộng vô hạn. Nhưng đọc "user kèm 10 post mới nhất" = hai query, và bạn mất tính nguyên tử giữa user và post.

Không có lựa chọn nào đúng cho mọi trường hợp. Có lựa chọn đúng cho **access pattern cụ thể**.

## Mental Model

Sáu câu hỏi, theo thứ tự quan trọng:

```text
1. ĐỌC CÙNG NHAU?        Mỗi lần đọc A có luôn cần B?        → có: nghiêng embed
2. GHI CÙNG NHAU?        Sửa A và B trong một thao tác?      → có: nghiêng embed
3. CARDINALITY?          A có bao nhiêu B?                    → nhiều/vô hạn: reference
4. KÍCH THƯỚC?           Tổng có gần 16MB?                    → có: reference
5. B TỒN TẠI ĐỘC LẬP?    Query B mà không qua A?             → có: reference
6. LẶP DỮ LIỆU ỔN KHÔNG? Đổi B phải cập nhật bao nhiêu chỗ?  → nhiều: reference
```

Cardinality là câu quyết định nhanh nhất:

```text
one-to-few        (1–vài chục, có trần)         → EMBED
                  order → lines, user → addresses, post → tags

one-to-many       (hàng trăm–nghìn, có trần)    → REFERENCE, hoặc embed một phần
                  post → comments, project → tasks

one-to-squillions (không có trần)               → REFERENCE, luôn luôn
                  user → posts, sensor → readings, account → transactions
```

Từ "có trần" là mấu chốt. Câu hỏi không phải "hiện tại có bao nhiêu" mà **"có giới hạn trên nào không?"** Một order có tối đa vài chục dòng hàng — có trần. Một user có thể có vô hạn post — không trần. Array không có trần là anti-pattern số một của MongoDB, kể cả khi hôm nay nó chỉ có 3 phần tử.

## How It Works

### Embed — khi dữ liệu là một phần của cha

```js
// Order + lines: đọc cùng nhau, ghi cùng nhau, có trần
{
  _id: ObjectId("o1"),
  customerId: ObjectId("c1"),
  status: "paid",
  total: NumberDecimal("1250000"),
  lines: [
    { productId: ObjectId("p1"), name: "Bàn phím", qty: 1, price: NumberDecimal("850000") },
    { productId: ObjectId("p2"), name: "Chuột",    qty: 2, price: NumberDecimal("200000") }
  ]
}
```

Được:

- **Một lần đọc** cho toàn bộ order.
- **Nguyên tử miễn phí** — `$inc` total và sửa line trong một `updateOne`, không cần transaction.
- Không có JOIN, không có N+1.

Chú ý `name` và `price` được **nhúng** vào line. Đây là chủ đích: order phải giữ giá và tên **tại thời điểm mua**. Nếu sản phẩm tăng giá tháng sau, order cũ không được đổi. Đây là **snapshot lịch sử**, không phải dữ liệu lặp cần đồng bộ — và đó là lý do embed đúng ở đây.

Phân biệt này quan trọng:

```text
Lặp dữ liệu cần đồng bộ    → vấn đề (phải cập nhật nhiều chỗ)
Snapshot tại thời điểm     → tính năng (phải KHÔNG đổi)
```

### Reference — khi dữ liệu tồn tại độc lập

```js
// users
{ _id: ObjectId("u1"), name: "Khánh", email: "..." }

// posts — có thể vô hạn, query độc lập
{ _id: ObjectId("p1"), authorId: ObjectId("u1"), title: "...", body: "...", createdAt: ISODate("...") }
```

Đọc "10 post mới nhất của user":

```js
db.posts.find({ authorId: u1 }).sort({ createdAt: -1 }).limit(10);
// cần index: { authorId: 1, createdAt: -1 }
```

Được: mở rộng vô hạn, query post độc lập, sửa post không chạm user.

Mất: hai query cho "user + post", không nguyên tử giữa hai collection.

### Extended reference — kết hợp, thường là đáp án đúng

Nhúng **vài field đọc nhiều** cùng với reference:

```js
// posts: nhúng tên tác giả để render danh sách không cần $lookup
{
  _id: ObjectId("p1"),
  author: {
    _id: ObjectId("u1"),
    name: "Khánh",          // nhúng — đọc nhiều, đổi ít
    avatarUrl: "..."
  },
  title: "...",
  body: "..."
}
```

Đây là pattern dùng nhiều nhất trong MongoDB thực tế. Nó đổi **một chút dữ liệu lặp** lấy **loại bỏ hoàn toàn `$lookup`** ở đường đọc nóng.

Chi phí: khi user đổi tên, phải cập nhật mọi post. Nhưng:

```js
// Cập nhật hàng loạt — một câu, chạy nền
db.posts.updateMany({ "author._id": u1 }, { $set: { "author.name": newName } });
```

Đánh đổi này đúng khi: **đọc nhiều hơn ghi rất nhiều lần**, và **eventual consistency chấp nhận được** cho field đó. Tên hiển thị chậm cập nhật vài giây là ổn; số dư tài khoản thì không.

### Subset pattern — embed một phần, reference phần còn lại

```js
// Post: nhúng 5 comment mới nhất (đủ cho màn hình đầu), phần còn lại ở collection riêng
{
  _id: ObjectId("p1"),
  title: "...",
  commentCount: 1523,
  recentComments: [                   // giữ đúng 5, có trần
    { _id: ObjectId("c1"), author: "A", text: "...", createdAt: ISODate("...") }
  ]
}
// comments — toàn bộ, phân trang được
{ _id: ObjectId("c1"), postId: ObjectId("p1"), author: "A", text: "..." }
```

```js
// Giữ đúng 5 phần tử mới nhất — $slice làm array có trần
db.posts.updateOne(
  { _id: postId },
  {
    $push: { recentComments: { $each: [newComment], $sort: { createdAt: -1 }, $slice: 5 } },
    $inc: { commentCount: 1 }
  }
);
```

`$slice` là công cụ biến một array **không trần** thành **có trần** — nó giải quyết chính xác anti-pattern lớn nhất. Kết quả: màn hình chi tiết post cần **một** lần đọc; ai muốn xem thêm comment thì query collection `comments`.

### Many-to-many

```js
// Cách 1: array of reference ở BÊN CÓ ÍT hơn và CÓ TRẦN
// Một task có tối đa ~10 tag → nhúng tagIds vào task
{ _id: ObjectId("t1"), title: "...", tagIds: [ObjectId("g1"), ObjectId("g2")] }
// Index: { tagIds: 1 } — multikey index, query cả hai chiều được
db.tasks.find({ tagIds: g1 });                    // task của một tag
db.tags.find({ _id: { $in: task.tagIds } });      // tag của một task

// Cách 2: collection nối, khi quan hệ có thuộc tính riêng
{ _id: ..., taskId: ObjectId("t1"), tagId: ObjectId("g1"), addedBy: ObjectId("u1"), addedAt: ISODate("...") }
```

Cách 1 chỉ hoạt động khi **một bên có trần**. Nếu cả hai bên có thể vô hạn (user ↔ group với hàng triệu thành viên), phải dùng collection nối.

### Bảng quyết định

| Quan hệ | Cardinality | Đọc cùng? | Chọn |
|---|---|---|---|
| order → lines | few, có trần | luôn | **embed** |
| user → addresses | few, có trần | thường | **embed** |
| post → tags | few, có trần | luôn | **embed** (array of string hoặc id) |
| product → reviews | many, không trần | một phần | **subset** (nhúng 3–5 mới nhất) |
| post → comments | many, không trần | một phần | **subset** |
| user → posts | squillions | không | **reference** |
| account → transactions | squillions | không | **reference** |
| post → author | 1 | luôn | **extended reference** (nhúng name, avatar) |
| task ↔ tags | m-n, một bên có trần | thường | **array of reference** |
| user ↔ groups | m-n, cả hai vô hạn | không | **collection nối** |

## Example

```js
// Cùng domain, thiết kế theo access pattern đã biết
// Access pattern: (1) mở màn hình order → cần đủ thông tin hiển thị
//                 (2) danh sách order của khách → chỉ cần tóm tắt
//                 (3) báo cáo sản phẩm bán chạy → aggregation trên lines

// orders — embed lines (có trần), extended reference cho customer
{
  _id: ObjectId("o1"),
  customer: { _id: ObjectId("c1"), name: "Khánh", phone: "..." },   // snapshot lúc đặt
  status: "paid",
  total: NumberDecimal("1250000"),
  lines: [
    { productId: ObjectId("p1"), name: "Bàn phím", qty: 1, price: NumberDecimal("850000") }
  ],
  createdAt: ISODate("2026-08-28T10:00:00Z")
}

// Index cho access pattern (2)
db.orders.createIndex({ "customer._id": 1, createdAt: -1 });
// Access pattern (1): findOne theo _id — một lần đọc, không $lookup
// Access pattern (3): aggregation $unwind lines → $group productId
```

Chú ý: `customer.name` và `phone` là **snapshot lúc đặt hàng** — đúng về mặt nghiệp vụ (hoá đơn phải giữ thông tin tại thời điểm giao dịch), nên đây không phải dữ liệu lặp cần đồng bộ.

## Prediction

1. User có 50.000 post, embed hết — điều gì xảy ra khi insert post thứ N?
2. `$push` liên tục vào array không có `$slice` — kích thước document theo thời gian?
3. Extended reference nhúng `author.name` vào 10.000 post, user đổi tên — bao nhiêu document phải update?
4. Embed 5 comment mới nhất bằng `$slice: 5` — array có phình không?
5. Đọc "order kèm chi tiết" với embed vs reference — bao nhiêu round-trip mỗi cách?
6. `tagIds: [ObjectId, ...]` với index `{ tagIds: 1 }` — query "task của tag X" dùng được index không?
7. Order embed `price` của sản phẩm, sản phẩm tăng giá — order cũ đổi không? Đó là bug hay tính năng?
8. Array 10.000 phần tử, `$push` thêm một phần tử — MongoDB ghi lại bao nhiêu?

<details>
<summary>Đáp án</summary>

1. Vượt 16MB → `BSONObjectTooLarge`, **không insert được nữa**. Và không có cách sửa nhanh — phải migrate mô hình.
2. Tăng không giới hạn tới khi vỡ 16MB.
3. 10.000 — nhưng bằng **một** `updateMany`, chạy nền được.
4. Không — `$slice` giữ trần cố định.
5. Embed: 1. Reference: 2 (hoặc 1 với `$lookup`, nhưng đắt hơn).
6. Có — multikey index phục vụ được.
7. Không đổi — và đó là **tính năng** (snapshot lịch sử của hoá đơn).
8. Có thể ghi lại **cả document** nếu nó không còn vừa chỗ cũ — đây là lý do array lớn làm ghi chậm dần.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `$push` 200.000 phần tử vào một array, đo thời gian mỗi 10.000 lần | Ghi chậm dần rõ rệt |
| Tiếp tục tới khi vỡ 16MB | `BSONObjectTooLarge`; document không cứu được |
| Thêm `$slice: 5`, làm lại | Kích thước phẳng, thời gian ghi ổn định |
| Embed 1000 sub-document rồi đọc chỉ 1 field của cha | Tải toàn bộ document qua network |
| Thêm projection `{ name: 1 }` | Nhỏ hơn nhiều — nhưng vẫn phải đọc document từ disk |
| Extended reference, đổi tên user, không update post | Dữ liệu lệch — quan sát eventual consistency |
| Reference + `$lookup` cho 1000 document | Đo so với embed |
| Array of reference cho m-n mà cả hai bên vô hạn | Một bên phình tới giới hạn |

Thí nghiệm 1 và 3 cạnh nhau là thí nghiệm quan trọng nhất của note này.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Embed luôn nhanh hơn | Embed document lớn làm mọi lần đọc đắt |
| MongoDB nghĩa là nhúng mọi thứ | Unbounded array là anti-pattern số một |
| Reference là "làm như SQL" nên sai | Reference là lựa chọn hợp lệ và thường đúng |
| Lặp dữ liệu luôn xấu | Snapshot lịch sử là tính năng, không phải lỗi |
| `$lookup` tương đương JOIN của SQL | Đắt hơn, hạn chế hơn; không nên là công cụ chính |
| Array nhỏ hôm nay thì embed an toàn | Câu hỏi là **có trần không**, không phải "hiện bao nhiêu" |
| Chọn embed/reference một lần là xong | Access pattern đổi thì mô hình phải đổi |
| Extended reference gây bất nhất nên tránh | Đánh đổi hợp lệ khi đọc ≫ ghi |

## Debugging

1. **Tìm array đang phình** — làm việc này định kỳ, không chờ sự cố:
   ```js
   db.users.aggregate([
     { $project: { n: { $size: { $ifNull: ["$posts", []] } }, size: { $bsonSize: "$$ROOT" } } },
     { $sort: { size: -1 } }, { $limit: 10 }
   ]);
   ```
2. **Kích thước document p99** — trung bình che mất outlier:
   ```js
   db.orders.aggregate([{ $project: { s: { $bsonSize: "$$ROOT" } } },
                        { $group: { _id: null, avg: { $avg: "$s" }, max: { $max: "$s" } } }]);
   ```
3. **Ghi chậm dần** → nghi document phình; MongoDB phải di chuyển document khi nó không vừa chỗ cũ.
4. **Dữ liệu lệch giữa bản nhúng và bản gốc** → tìm chỗ update thiếu `updateMany` cho extended reference.
5. **Nhiều `$lookup` trong query nóng** → dấu hiệu mô hình không khớp access pattern. Cân nhắc extended reference.
6. **Đọc dữ liệu thật** (`findOne()`) trước khi kết luận — với MongoDB, cấu trúc thật thường khác cấu trúc bạn nghĩ.

## Production Considerations

- **Mọi array phải có trần**, thực thi bằng `$slice` hoặc bằng validation. Đây là quy tắc quan trọng nhất.
- **Xác định access pattern trước khi thiết kế.** Nếu chưa biết, đó là lý do chọn PostgreSQL — không phải lý do chọn MongoDB. Xem [note 08](08-postgresql-vs-mongodb.md).
- **Monitor kích thước document p99 và độ dài array max** như metric.
- **Extended reference cần một job đồng bộ** hoặc một event handler; đừng dựa vào việc "nhớ update".
- **Ghi rõ field nào là snapshot** (không đồng bộ) và field nào là bản sao (phải đồng bộ) — trong schema comment hoặc ADR. Người sau không đoán được.
- **Index cho mọi field reference** dùng trong query (`authorId`, `customer._id`).
- Khi mô hình cần đổi, viết migration script và chạy theo lô — không có `ALTER TABLE` ở đây. Xem [note 03](03-schema-design-validation.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Embed | 1 lần đọc, nguyên tử miễn phí | giới hạn 16MB, đọc cha là tải cả con |
| Reference | mở rộng vô hạn, query độc lập | nhiều query, không nguyên tử |
| Extended reference | loại bỏ `$lookup` ở đường nóng | dữ liệu lặp, cần đồng bộ |
| Subset | 1 lần đọc cho màn hình đầu + mở rộng vô hạn | hai nơi lưu, logic phức tạp hơn |
| Array of reference (m-n) | query hai chiều bằng multikey index | chỉ dùng được khi một bên có trần |
| Collection nối (m-n) | không giới hạn, quan hệ có thuộc tính | nhiều query hơn |

## Explain Without Notes

1. Sáu câu hỏi để quyết định embed hay reference?
2. Vì sao "có trần không" quan trọng hơn "hiện có bao nhiêu"?
3. Phân biệt "dữ liệu lặp cần đồng bộ" và "snapshot lịch sử" — cho ví dụ mỗi loại.
4. Extended reference đổi gì lấy gì? Khi nào đánh đổi đó đúng?
5. `$slice` giải quyết anti-pattern nào?
6. Khi nào array of reference **không** dùng được cho m-n?

## Related

- [Document model](01-document-model.md) — giới hạn 16MB, BSON
- [Schema design & validation](03-schema-design-validation.md) — ép trần array bằng validation
- [Indexes & query planning](04-indexes-query-planning.md) — multikey index cho array
- [Aggregation pipeline](05-aggregation-pipeline.md) — `$lookup` và chi phí
- [Transactions & consistency](06-transactions-consistency.md) — khi reference cần nguyên tử
- [PostgreSQL vs MongoDB](08-postgresql-vs-mongodb.md)
- [Relationships & cardinality](../03-data-modeling/03-relationships-cardinality.md) — cùng bài toán ở tầng relational
- [Cache patterns](../02-redis/03-cache-patterns.md) — extended reference là một dạng denormalization như cache
