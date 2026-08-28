---
level: advanced
area: database
prerequisites:
  - 01-document-model.md
  - 02-embed-vs-reference.md
related:
  - ../01-postgresql/transactions-concurrency/01-transaction-isolation.md
  - ../../06-system-design/04-consistency-availability.md
---

# Transactions & consistency

> MongoDB có multi-document transaction từ 4.0. Nhưng nếu bạn cần nó **thường xuyên**, đó là tín hiệu mô hình dữ liệu — hoặc lựa chọn database — đang chống lại use case của bạn.

*Baseline: MongoDB 7.x/8.x, replica set.*

## Position

```text
Một document           → nguyên tử MIỄN PHÍ, không cần transaction
Nhiều document         → cần transaction (và cần replica set)
Nhiều shard            → transaction được, nhưng đắt hơn nhiều
```

## Problem

Chuyển tiền giữa hai account nằm ở hai document:

```js
// ❌ Hai thao tác riêng — không nguyên tử
await accounts.updateOne({ _id: from }, { $inc: { balance: -100 } });
// ← process chết ở đây: tiền BỐC HƠI
await accounts.updateOne({ _id: to },   { $inc: { balance:  100 } });
```

Trong PostgreSQL, đây là bài toán đã giải: một transaction. Trong MongoDB, transaction cũng có — nhưng câu hỏi đầu tiên không phải "dùng transaction thế nào" mà:

> **Vì sao hai giá trị cần nhất quán tuyệt đối lại nằm ở hai document?**

Nếu câu trả lời là "vì chúng là hai thực thể độc lập" thì transaction là đúng. Nếu câu trả lời là "vì tôi thiết kế theo kiểu relational" thì mô hình cần xem lại.

## Mental Model

```text
Mức 1 — MỘT document
  updateOne với nhiều toán tử → NGUYÊN TỬ, không cần gì thêm
  → thiết kế để business operation = một document là cách tốt nhất

Mức 2 — nhiều document, một collection/database
  session + transaction → hoạt động, chi phí trung bình

Mức 3 — nhiều shard
  distributed transaction → hoạt động, chi phí CAO

Mức 4 — không cần nhất quán tức thì
  eventual consistency + idempotency + compensation
```

Nguyên tắc chi phối:

> **Trong MongoDB, transaction là escape hatch, không phải công cụ hàng ngày.**
>
> Trong PostgreSQL thì ngược lại — transaction là công cụ mặc định.

Sự đảo ngược này là một trong những khác biệt tư duy quan trọng nhất giữa hai database, và nó không phải vì transaction của MongoDB "kém" — mà vì document model được thiết kế để bạn **không cần** nó.

## How It Works

### Mức 1 — một document, nguyên tử miễn phí

```js
// Nhiều toán tử trên nhiều field, kể cả array lồng — TẤT CẢ nguyên tử
db.orders.updateOne(
  { _id: orderId, status: "pending" },        // điều kiện = bảo vệ state
  {
    $set: { status: "paid", paidAt: new Date() },
    $inc: { version: 1 },
    $push: { history: { action: "paid", at: new Date() } }
  }
);
```

Nếu bạn thiết kế được sao cho một business operation chạm đúng một document, bạn có tính nguyên tử mà không có chi phí nào. Đây là lý do [embed vs reference](02-embed-vs-reference.md) là quyết định quan trọng nhất — nó quyết định bạn có cần transaction hay không.

**`findOneAndUpdate`** cho read-modify-write nguyên tử:

```js
// Lấy job và đánh dấu đang xử lý — không hai worker nào lấy cùng job
const job = await jobs.findOneAndUpdate(
  { status: "queued" },
  { $set: { status: "processing", startedAt: new Date(), workerId } },
  { sort: { priority: -1, createdAt: 1 }, returnDocument: "after" }
);
```

Đây là pattern quan trọng: nó thay thế hoàn toàn nhu cầu lock cho work queue.

### Optimistic concurrency — không cần transaction

```js
// Version field — như optimistic locking trong PostgreSQL
const res = await orders.updateOne(
  { _id: orderId, version: currentVersion },
  { $set: { total: newTotal }, $inc: { version: 1 } }
);

if (res.matchedCount === 0) {
  throw new ConflictError('Dữ liệu đã bị người khác sửa');
}
```

`matchedCount === 0` nghĩa là điều kiện không khớp — ai đó đã sửa trước. Đây là mức bảo vệ nên thử **trước** transaction.

### Mức 2 — multi-document transaction

```js
const session = client.startSession();
try {
  await session.withTransaction(
    async () => {
      const from = await accounts.findOneAndUpdate(
        { _id: fromId, balance: { $gte: amount } },     // điều kiện trong query
        { $inc: { balance: -amount } },
        { session, returnDocument: "after" }
      );
      if (!from) throw new InsufficientFundsError();     // throw = abort

      await accounts.updateOne(
        { _id: toId },
        { $inc: { balance: amount } },
        { session }
      );

      await ledger.insertOne(
        { fromId, toId, amount, at: new Date() },
        { session }
      );
    },
    {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: 5000
    }
  );
} finally {
  await session.endSession();
}
```

Bốn điều bắt buộc, và bỏ sót một cái làm transaction vô nghĩa:

1. **Truyền `{ session }` vào **mọi** thao tác.** Thao tác thiếu `session` chạy **ngoài** transaction — không rollback. Đây là lỗi phổ biến nhất, và nó im lặng.
2. **`withTransaction`** thay vì `startTransaction`/`commitTransaction` thủ công — nó **tự retry** khi gặp `TransientTransactionError`.
3. **`throw` để abort** — không có API rollback riêng.
4. **Callback có thể chạy nhiều lần** (do retry), nên nó phải **idempotent**. Không đặt side effect ngoài DB trong đó.

Điểm 4 là bẫy tinh vi: `withTransaction` retry toàn bộ callback. Nếu callback gửi email ở giữa, email được gửi nhiều lần.

### Yêu cầu và giới hạn

```text
BẮT BUỘC: replica set (hoặc sharded cluster)
          → standalone mongod KHÔNG hỗ trợ transaction
          → dev environment phải là replica set 1 node

Giới hạn:  60 giây mặc định (transactionLifetimeLimitSeconds)
          16 MB tổng oplog entry của transaction
          không tạo collection/index trong transaction (trước 4.4)
```

Yêu cầu replica set là bất ngờ hay gặp: transaction chạy trên staging (replica set) nhưng lỗi trên máy dev (standalone). Chạy `mongod --replSet rs0` rồi `rs.initiate()` cho dev.

### Read concern và write concern

Đây là nơi MongoDB cho bạn kiểm soát rõ ràng hơn PostgreSQL: bạn chọn mức đảm bảo cho **từng** thao tác.

```js
// Write concern — bao nhiêu node phải xác nhận trước khi trả về
{ w: 1 }                              // chỉ primary — nhanh, CÓ THỂ MẤT nếu failover
{ w: "majority" }                     // đa số node — bền
{ w: "majority", j: true }             // + ghi journal xuống disk
{ w: "majority", wtimeout: 5000 }      // + timeout

// Read concern — đọc dữ liệu ở mức nào
{ level: "local" }                     // dữ liệu local, CÓ THỂ bị rollback
{ level: "majority" }                  // đã được đa số xác nhận, không rollback
{ level: "snapshot" }                  // snapshot nhất quán (dùng trong transaction)
{ level: "linearizable" }              // mạnh nhất, chậm nhất
```

Bảng đánh đổi:

| Cấu hình | Bền | Nhanh | Rủi ro |
|---|---|---|---|
| `w: 1` + `read: local` | thấp | nhanh nhất | mất ghi khi failover; đọc dữ liệu bị rollback |
| `w: majority` + `read: majority` | cao | trung bình | — |
| `w: majority, j: true` + `linearizable` | cao nhất | chậm nhất | — |

**`w: 1` là nơi dữ liệu bị mất im lặng.** Nếu primary xác nhận ghi rồi chết trước khi replicate, ghi đó biến mất sau failover — và client đã nhận "thành công". Với dữ liệu quan trọng, `w: "majority"` là bắt buộc.

Đây là điểm khác biệt đáng chú ý so với PostgreSQL: MongoDB mặc định nghiêng về tốc độ và cho bạn opt-in độ bền; PostgreSQL mặc định bền và cho bạn opt-out (`synchronous_commit = off`).

### Đọc từ secondary — nguồn của "dữ liệu cũ"

```js
db.collection.find().readPref("secondaryPreferred");
```

Secondary có **replication lag**. Hệ quả kinh điển:

```text
POST /orders   → ghi vào primary        → 201 Created
GET  /orders   → đọc từ secondary       → order vừa tạo KHÔNG CÓ
```

Người dùng tạo đơn rồi không thấy đơn của mình. Hai cách sửa:

```js
// A. Đọc-sau-ghi từ primary
db.orders.find({ ... }).readPref("primary");

// B. Causal consistency — session bảo đảm đọc thấy ghi của chính nó
const session = client.startSession({ causalConsistency: true });
await orders.insertOne(doc, { session });
await orders.find({ ... }, { session });     // thấy doc vừa ghi
```

Causal consistency là công cụ đúng cho vấn đề này và ít được biết tới.

### Mức 4 — khi transaction là dấu hiệu sai

Nếu bạn thấy mình cần transaction xuyên nhiều document **liên tục**, ba lựa chọn:

```text
1. THIẾT KẾ LẠI: gộp vào một document
   → order + lines trong một document → không cần transaction

2. EVENTUAL CONSISTENCY + compensation
   → ghi trạng thái trung gian, worker hoàn tất, job dọn cái kẹt
   → giống Outbox pattern

3. ĐỔI DATABASE
   → nếu domain của bạn là quan hệ + transaction nhiều (payment, kế toán,
     quản lý kho), PostgreSQL phù hợp hơn
```

Lựa chọn 3 là kết luận hợp lệ, không phải thất bại. Xem [PostgreSQL vs MongoDB](08-postgresql-vs-mongodb.md).

## Example

```js
// Chuyển trạng thái + ghi log trong MỘT document — không cần transaction
db.orders.updateOne(
  { _id: orderId, status: "pending" },
  {
    $set: { status: "paid", paidAt: new Date() },
    $push: { history: { $each: [{ action: "paid", at: new Date() }], $slice: -50 } }
  },
  { writeConcern: { w: "majority" } }
);
// matchedCount === 0 → order không ở trạng thái pending (đã xử lý, hoặc không tồn tại)
```

`$slice: -50` giữ 50 entry lịch sử gần nhất — array có trần, đúng nguyên tắc [note 02](02-embed-vs-reference.md).

## Prediction

1. `updateOne` với `$set`, `$inc`, `$push` cùng lúc — cần transaction để nguyên tử?
2. Transaction trên standalone `mongod` — chạy được?
3. Một thao tác trong transaction thiếu `{ session }` — nó có rollback khi abort?
4. `withTransaction` callback gửi email, transaction bị retry 2 lần — bao nhiêu email?
5. `w: 1`, primary xác nhận rồi chết trước khi replicate — ghi đó còn không?
6. `POST` ghi primary, `GET` ngay sau đọc `secondaryPreferred` — thấy dữ liệu vừa ghi?
7. `updateOne({ _id, version: 5 }, ...)` khi version thật là 6 — `matchedCount` là bao nhiêu?
8. Transaction chạy 90 giây — kết quả?

<details>
<summary>Đáp án</summary>

1. **Không** — mọi thay đổi trong một document là nguyên tử.
2. **Không** — transaction cần replica set.
3. **Không** — nó chạy ngoài transaction. Lỗi im lặng.
4. 2 email — callback chạy lại toàn bộ.
5. **Mất** — client đã nhận "thành công" nhưng ghi biến mất sau failover.
6. Có thể **không** — replication lag. Dùng `readPref("primary")` hoặc causal consistency.
7. `0` — dùng nó để phát hiện conflict.
8. Abort (vượt `transactionLifetimeLimitSeconds`, mặc định 60s).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Transaction trên standalone mongod | Lỗi rõ ràng về replica set |
| Bỏ `{ session }` ở một thao tác, rồi abort | Thao tác đó vẫn được ghi |
| Callback `withTransaction` có `console.log`, gây conflict để retry | Log xuất hiện nhiều lần |
| `w: 1` + kill primary ngay sau ghi + failover | Ghi mất |
| `w: "majority"` + cùng thí nghiệm | Ghi còn |
| Ghi rồi đọc secondary ngay | Không thấy dữ liệu |
| Thêm `causalConsistency: true` | Thấy |
| Hai transaction ghi cùng document | Một bị `WriteConflict`, `withTransaction` tự retry |
| Transaction giữ 90 giây | Abort |
| `$push` không `$slice` trong document có transaction | Document phình, có thể vượt 16MB oplog |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| MongoDB không có transaction | Có từ 4.0 (replica set), 4.2 (sharded) |
| Transaction MongoDB dùng như PostgreSQL | Nó là escape hatch, không phải công cụ mặc định |
| Cần transaction để update nhiều field | Một document đã nguyên tử |
| `w: 1` là an toàn | Ghi có thể mất khi failover |
| Đọc secondary luôn an toàn để scale read | Replication lag gây đọc-sau-ghi sai |
| `withTransaction` callback chạy một lần | Có thể chạy nhiều lần do retry |
| Transaction trên sharded cluster giống trên replica set | Đắt hơn nhiều |
| Cần transaction nhiều là bình thường | Là tín hiệu mô hình hoặc database chưa phù hợp |

## Debugging

1. **"Transaction numbers are only allowed on replica set"** → môi trường là standalone. Chuyển dev sang replica set 1 node.
2. **Dữ liệu không rollback** → tìm thao tác thiếu `{ session }`. Đây là nguyên nhân số một; grep mọi call trong callback.
3. **`WriteConflict` thường xuyên** → hai transaction tranh cùng document. Cân nhắc optimistic concurrency thay vì transaction.
4. **Dữ liệu vừa ghi không đọc thấy** → đang đọc secondary. Kiểm tra `readPreference`; đo lag:
   ```js
   rs.printSecondaryReplicationInfo();
   ```
5. **Ghi mất sau sự cố** → kiểm tra `writeConcern`. `w: 1` là nguyên nhân.
6. **Transaction chậm/abort** → đo thời gian callback; tìm network call bên trong (cùng vấn đề như [Prisma transactions](../05-data-access/04-prisma-transactions.md)).
7. **`db.currentOp()`** để xem transaction đang mở lâu.

## Production Considerations

- **`w: "majority"` cho mọi ghi quan trọng.** Đây là quyết định có hệ quả mất dữ liệu, không phải tối ưu hiệu năng.
- **Thiết kế để không cần transaction**: một business operation = một document, nếu được.
- **Ưu tiên `findOneAndUpdate` và optimistic concurrency** trước transaction.
- **`withTransaction`** (có retry sẵn), callback **idempotent**, không có side effect ngoài DB bên trong.
- **Truyền `session` vào mọi thao tác** — cân nhắc một wrapper để không thể quên.
- **`maxCommitTimeMS`** và transaction ngắn; không gọi network bên trong.
- **Replica set cho cả dev environment** — nếu không, bug transaction chỉ xuất hiện ở staging.
- **Causal consistency** cho luồng đọc-sau-ghi khi dùng secondary read.
- **Monitor replication lag** như metric hạng nhất nếu đọc từ secondary.
- Nếu domain cần transaction xuyên nhiều thực thể như chuyện thường ngày → đánh giá lại lựa chọn database. Xem [note 08](08-postgresql-vs-mongodb.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Một document (embed) | nguyên tử miễn phí | giới hạn 16MB, mô hình gắn với access pattern |
| Multi-document transaction | nhất quán như relational | chi phí, cần replica set, dễ dùng sai |
| Optimistic concurrency | không lock, nhanh | phải xử lý conflict ở tầng trên |
| `w: 1` | ghi nhanh nhất | có thể mất dữ liệu |
| `w: majority` | bền | chậm hơn, phụ thuộc đa số node sống |
| Đọc secondary | scale read | replication lag, đọc-sau-ghi sai |
| Causal consistency | đọc thấy ghi của mình | thêm overhead, phải dùng session |
| Eventual consistency + compensation | scale tốt nhất | phức tạp, cần idempotency và job dọn |

## Explain Without Notes

1. Bốn mức nhất quán trong MongoDB, từ rẻ nhất tới đắt nhất?
2. Vì sao transaction là escape hatch trong MongoDB mà là mặc định trong PostgreSQL?
3. Bốn điều bắt buộc khi dùng transaction, và cái nào gây lỗi im lặng nếu bỏ sót?
4. `w: 1` mất dữ liệu trong tình huống nào?
5. Đọc-sau-ghi sai xảy ra thế nào, và hai cách sửa?
6. Khi nào "cần transaction thường xuyên" là tín hiệu về lựa chọn database?

## Related

- [Document model](01-document-model.md) — nguyên tử ở mức document
- [Embed vs reference](02-embed-vs-reference.md) — quyết định này quyết định nhu cầu transaction
- [Operations & production](07-operations-production.md) — replica set, failover, lag
- [PostgreSQL vs MongoDB](08-postgresql-vs-mongodb.md) — khi transaction là tiêu chí chọn
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — đối chiếu
- [Prisma transactions](../05-data-access/04-prisma-transactions.md) — cùng nguyên tắc "transaction ngắn"
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — CAP
- [Outbox pattern](../04-message-queues/06-outbox-pattern.md) — eventual consistency có kiểm soát
- [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md)
