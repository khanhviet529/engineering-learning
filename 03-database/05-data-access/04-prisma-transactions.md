---
level: intermediate
area: database
prerequisites:
  - 02-prisma-model-and-client.md
  - ../01-postgresql/transactions-concurrency/01-transaction-isolation.md
related:
  - ../01-postgresql/transactions-concurrency/03-locking-deadlock.md
  - ../04-message-queues/06-outbox-pattern.md
---

# Prisma transactions

> Một transaction giữ một connection và giữ lock. Gọi một API bên ngoài ở giữa transaction là cách biến độ trễ của người khác thành sự cố database của bạn.

*Baseline: Prisma 6.x, PostgreSQL.*

## Position

```text
Business operation  ("chuyển task sang done và ghi activity log")
        ↓
transaction boundary          ← note này: đặt ở đâu, rộng bao nhiêu
        ↓
nhiều SQL statement
        ↓
COMMIT / ROLLBACK
```

## Problem

```ts
// Hoàn thành task: 3 thao tác phải cùng thành công hoặc cùng thất bại
await prisma.task.update({ where: { id }, data: { status: 'DONE' } });
await prisma.activityLog.create({ data: { taskId: id, action: 'completed' } });
await prisma.project.update({ where: { id: projectId }, data: { doneCount: { increment: 1 } } });
```

Ba câu lệnh, ba transaction ngầm (mỗi câu tự commit). Nếu câu thứ hai lỗi:

```text
✅ task.status = 'DONE'        ← đã commit, không rollback được
❌ activityLog                 ← không tạo
❌ project.doneCount           ← không tăng
```

Dữ liệu giờ ở trạng thái không nhất quán: task đã done nhưng `doneCount` sai và không có audit trail. Không có lỗi nào được báo về sự không nhất quán đó — nó chỉ âm thầm sai mãi.

Transaction tồn tại để biến ba thao tác thành **một đơn vị nguyên tử**.

## Mental Model

```text
Transaction = { tất cả thành công } HOẶC { không gì xảy ra }

Nó giữ:  1 connection  +  lock trên các dòng bị sửa
Trong:   toàn bộ thời gian từ BEGIN tới COMMIT

→ Transaction dài = giữ connection lâu + giữ lock lâu
→ Giữ lock lâu = request khác chờ = throughput sụp
```

Từ đó ra nguyên tắc chi phối mọi quyết định về transaction:

> **Transaction phải bao đúng những gì cần nguyên tử, và ngắn nhất có thể.**

Prisma có ba cách, và chúng khác nhau ở chỗ **bạn có logic ở giữa hay không**:

```text
1. Nested write        — một lệnh, Prisma tự bọc transaction
2. Sequential ($transaction([...]))  — mảng lệnh, KHÔNG có logic ở giữa
3. Interactive ($transaction(fn))    — có logic, có đọc rồi quyết định
```

## How It Works

### 1. Nested write — rẻ nhất, dùng khi được

```ts
// Một lệnh Prisma, tự động nguyên tử
await prisma.project.create({
  data: {
    name: 'Q4',
    tasks: { create: [{ title: 'A' }, { title: 'B' }] },
  },
});
```

Nếu tạo task thứ hai lỗi, project cũng rollback. Không cần `$transaction`.

Đây nên là lựa chọn đầu tiên: không có callback, không giữ transaction lâu hơn cần thiết, và Prisma tối ưu được thứ tự câu lệnh.

### 2. Sequential — mảng lệnh độc lập

```ts
const [task, log] = await prisma.$transaction([
  prisma.task.update({ where: { id }, data: { status: 'DONE' } }),
  prisma.activityLog.create({ data: { taskId: id, action: 'completed' } }),
  prisma.project.update({ where: { id: projectId }, data: { doneCount: { increment: 1 } } }),
]);
```

Đặc điểm: các lệnh chạy **tuần tự trong một transaction**, nhưng bạn **không** đọc được kết quả của lệnh trước để quyết định lệnh sau. Mảng được xây trước khi transaction bắt đầu.

Ưu điểm: ngắn, không giữ transaction mở trong lúc code JavaScript chạy.

Lưu ý: `{ increment: 1 }` là atomic ở tầng SQL (`SET done_count = done_count + 1`), không phải đọc-rồi-ghi. Đây là cách đúng để đếm — xem phần race condition dưới.

### 3. Interactive — khi cần logic ở giữa

```ts
await prisma.$transaction(
  async (tx) => {
    // Đọc và LOCK dòng — SELECT ... FOR UPDATE
    const [account] = await tx.$queryRaw<Account[]>`
      SELECT * FROM accounts WHERE id = ${id} FOR UPDATE`;

    if (account.balance < amount) {
      throw new InsufficientFundsError();     // throw = rollback
    }

    await tx.account.update({
      where: { id },
      data: { balance: { decrement: amount } },
    });
    await tx.ledger.create({ data: { accountId: id, amount: -amount } });
  },
  {
    timeout: 5_000,                            // trần thời gian giữ transaction
    maxWait: 2_000,                            // chờ lấy connection từ pool
    isolationLevel: 'Serializable',             // khi cần
  },
);
```

Ba tham số đều quan trọng:

| Tham số | Nghĩa | Không đặt thì |
|---|---|---|
| `timeout` | trần từ BEGIN tới COMMIT (mặc định 5s) | transaction treo giữ lock lâu |
| `maxWait` | chờ lấy connection từ pool (mặc định 2s) | request xếp hàng im lặng |
| `isolationLevel` | mức cách ly | dùng mặc định của DB (`ReadCommitted` với PostgreSQL) |

**`throw` trong callback = rollback.** Đây là cơ chế duy nhất; không có `tx.rollback()`.

**Phải dùng `tx`, không phải `prisma`** bên trong callback. Dùng `prisma` là một connection khác, ngoài transaction — lỗi này im lặng và rất khó thấy:

```ts
await prisma.$transaction(async (tx) => {
  await tx.task.update(...);       // ✅ trong transaction
  await prisma.log.create(...);    // ❌ NGOÀI transaction — không rollback
});
```

### Bẫy lớn nhất: gọi network trong transaction

```ts
// ❌ Transaction giữ lock trong lúc chờ Stripe
await prisma.$transaction(async (tx) => {
  const order = await tx.order.update({ where: { id }, data: { status: 'PAYING' } });
  const charge = await stripe.charges.create({ amount: order.total });   // 200ms–30s!
  await tx.payment.create({ data: { orderId: id, chargeId: charge.id } });
});
```

Điều gì xảy ra: nếu Stripe chậm 10 giây, bạn giữ một connection và lock trên dòng `order` suốt 10 giây. Với 50 request đồng thời, pool cạn, `P2024`, và mọi endpoint khác cũng chết — kể cả những endpoint không liên quan tới payment.

Ba cách sửa, theo thứ tự ưu tiên:

```ts
// ✅ A. Tách: transaction ngắn → network → transaction ngắn
const order = await prisma.order.update({
  where: { id, status: 'PENDING' },       // điều kiện = bảo vệ state
  data: { status: 'PAYING' },
});
const charge = await stripe.charges.create({ amount: order.total });   // NGOÀI transaction
await prisma.$transaction([
  prisma.payment.create({ data: { orderId: id, chargeId: charge.id } }),
  prisma.order.update({ where: { id }, data: { status: 'PAID' } }),
]);
```

Đánh đổi: giữa hai transaction có một khoảng mà state là `PAYING`. Nếu process chết ở đó, order kẹt — cần một job dọn các order `PAYING` quá lâu (đối chiếu với Stripe). Đây là đánh đổi đúng: một trạng thái trung gian cần dọn, thay vì cạn pool.

```ts
// ✅ B. Outbox: commit ý định, worker thực hiện
await prisma.$transaction([
  prisma.order.update({ where: { id }, data: { status: 'PAYING' } }),
  prisma.outbox.create({ data: { type: 'charge.requested', payload: { orderId: id } } }),
]);
// worker đọc outbox → gọi Stripe → cập nhật
```

Xem [Outbox pattern](../04-message-queues/06-outbox-pattern.md).

```ts
// ✅ C. Idempotency key nếu buộc phải gọi rồi ghi
// Xem HTTP semantics & idempotency
```

### Race condition — ba mức bảo vệ

**Mức 1 — atomic operation, không cần transaction:**

```ts
// SET done_count = done_count + 1 — an toàn với đồng thời
await prisma.project.update({ where: { id }, data: { doneCount: { increment: 1 } } });

// ❌ Đọc rồi ghi — lost update
const p = await prisma.project.findUnique({ where: { id } });
await prisma.project.update({ where: { id }, data: { doneCount: p.doneCount + 1 } });
```

**Mức 2 — điều kiện trong `updateMany`, không cần lock:**

```ts
const { count } = await prisma.order.updateMany({
  where: { id, status: 'PENDING' },
  data: { status: 'PAID' },
});
if (count === 0) throw new ConflictError('Order không ở trạng thái PENDING');
```

**Mức 3 — optimistic locking bằng version:**

```prisma
model Order { id String @id  version Int @default(0)  total Decimal }
```

```ts
const { count } = await prisma.order.updateMany({
  where: { id, version: currentVersion },
  data: { total: newTotal, version: { increment: 1 } },
});
if (count === 0) throw new ConflictError('Dữ liệu đã bị người khác sửa');
```

**Mức 4 — pessimistic lock, khi ba mức trên không đủ:**

```ts
await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id} FOR UPDATE`;
  // ...
});
```

Thứ tự này quan trọng: ba mức đầu **không giữ lock qua nhiều round-trip**, nên chúng scale tốt hơn. Chỉ xuống mức 4 khi logic thật sự cần đọc-nghĩ-ghi trên dữ liệu không thể diễn đạt bằng điều kiện.

### Isolation level và retry

```ts
{ isolationLevel: 'Serializable' }
```

Với `Serializable`, PostgreSQL có thể abort transaction với `40001` (serialization failure). Đây **không** phải bug — nó là cơ chế, và bạn **phải** retry:

```ts
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      // P2034 = Prisma bọc lỗi write conflict / deadlock
      if (code === 'P2034' && i < tries - 1) {
        await sleep(50 * 2 ** i * (0.5 + Math.random()));    // backoff + jitter
        continue;
      }
      throw e;
    }
  }
  throw new Error('unreachable');
}
```

Tương tự với deadlock (`40P01`). Xem [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) và [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md).

## Example

```ts
// Service: transaction bao đúng phần cần nguyên tử
async completeTask(taskId: string, userId: string) {
  return withRetry(() =>
    this.prisma.$transaction(async (tx) => {
      // Chuyển state có điều kiện — atomic, không cần lock tường minh
      const { count } = await tx.task.updateMany({
        where: { id: taskId, status: 'IN_PROGRESS', assigneeId: userId },
        data: { status: 'DONE', completedAt: new Date() },
      });
      if (count === 0) throw new ConflictError('TASK_NOT_COMPLETABLE');

      await tx.activityLog.create({
        data: { taskId, userId, action: 'completed' },
      });

      const task = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { projectId: true },
      });
      await tx.project.update({
        where: { id: task.projectId },
        data: { doneCount: { increment: 1 } },
      });
    }, { timeout: 5_000 }),
  );
}
// Gửi notification NGOÀI transaction — nó không cần nguyên tử với DB
```

Dòng cuối là quyết định thiết kế: gửi email/notification **không** thuộc transaction. Nếu nó ở trong, một service email chậm sẽ giữ lock; và nếu transaction rollback sau khi email đã gửi thì email cũng không thu hồi được.

## Prediction

1. Ba `await prisma.x.update()` riêng lẻ, câu thứ hai lỗi — trạng thái dữ liệu?
2. `$transaction([...])` cùng ba câu đó, câu thứ hai lỗi — trạng thái?
3. Dùng `prisma` thay vì `tx` bên trong callback — lệnh đó có rollback?
4. `throw` trong interactive transaction — commit hay rollback?
5. Transaction gọi Stripe mất 10 giây, 50 request đồng thời, pool size 10 — điều gì xảy ra?
6. Đọc `doneCount` rồi ghi `doneCount + 1`, hai request đồng thời — kết quả tăng mấy?
7. `{ increment: 1 }` cùng tình huống — tăng mấy?
8. `isolationLevel: 'Serializable'` không có retry — người dùng thấy gì khi có conflict?
9. `timeout: 5000` nhưng transaction cần 8 giây — lỗi gì?

<details>
<summary>Đáp án</summary>

1. Không nhất quán: câu 1 đã commit, câu 2 và 3 không chạy.
2. Rollback toàn bộ — nhất quán.
3. **Không** — nó chạy trên connection khác, ngoài transaction.
4. Rollback.
5. Pool cạn sau 10 request; `P2024` cho phần còn lại; mọi endpoint khác cũng bị ảnh hưởng.
6. Tăng **1** (lost update) — cả hai đọc cùng giá trị.
7. Tăng **2** — atomic ở tầng SQL.
8. Lỗi 500 ngẫu nhiên dưới tải; `40001`/`P2034` là bình thường với Serializable, phải retry.
9. `P2028` transaction timeout, rollback.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Ba lệnh riêng, làm lệnh 2 lỗi | Dữ liệu không nhất quán, không có cảnh báo |
| Gói vào `$transaction`, làm lại | Rollback sạch |
| Dùng `prisma` thay `tx` trong callback | Lệnh đó không rollback — bug im lặng |
| Thêm `await sleep(10_000)` trong transaction, gửi 20 request | Pool cạn, `P2024`, endpoint khác cũng chết |
| Đọc-rồi-ghi counter từ 2 session `psql` song song | Lost update |
| `{ increment: 1 }` cùng thí nghiệm | Đúng |
| Hai transaction lock hai dòng theo thứ tự ngược nhau | `deadlock detected`; Prisma trả `P2034` |
| `Serializable` + hai transaction ghi cùng tập dòng | `40001`; không retry thì 500 |
| `timeout: 100` với transaction cần 1 giây | `P2028` |
| Xem `pg_stat_activity` trong lúc transaction dài chạy | Thấy `idle in transaction` — dấu hiệu xấu |

Thí nghiệm cuối rất hữu ích: `state = 'idle in transaction'` trong `pg_stat_activity` nghĩa là transaction đang mở mà không chạy SQL — tức đang chờ code JavaScript hoặc network.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Mỗi lệnh Prisma đã có transaction nên đủ | Mỗi lệnh có transaction *riêng*; không nguyên tử với nhau |
| `$transaction([...])` cho phép logic ở giữa | Không — mảng được xây trước; cần interactive |
| Có `tx.rollback()` | Không; `throw` là cách rollback |
| Transaction dài chỉ chậm cho request đó | Nó giữ lock và connection, ảnh hưởng toàn hệ thống |
| Nested write cần `$transaction` | Nó đã nguyên tử sẵn |
| `Serializable` an toàn hơn nên nên dùng mặc định | Nó tăng abort; cần retry, và giảm throughput |
| Deadlock là bug cần sửa hết | Là hiện tượng bình thường; thiết kế phải retry |
| Đọc trong transaction thì tự động được lock | Chỉ khi `FOR UPDATE`; `SELECT` thường không lock |

## Debugging

1. **`P2024` (pool timeout)** → transaction dài hoặc quá nhiều query đồng thời. Kiểm tra có network call trong transaction không. Đây là nguyên nhân số một.
2. **`pg_stat_activity`** — câu này chỉ ra transaction đang mở lâu:
   ```sql
   SELECT pid, state, now() - xact_start AS duration, query
   FROM pg_stat_activity
   WHERE state LIKE '%transaction%' AND xact_start < now() - interval '1 second'
   ORDER BY duration DESC;
   ```
   `idle in transaction` = đang chờ application, không chờ database.
3. **Mã lỗi Prisma**: `P2028` transaction timeout · `P2034` write conflict/deadlock (cần retry) · `P2002` unique violation · `P2024` pool timeout.
4. **Lock đang chờ ai** → `pg_locks` join `pg_stat_activity`; hoặc bật `log_lock_waits = on`.
5. **Dữ liệu không nhất quán** → tìm chỗ nhiều lệnh ghi mà không có transaction bao quanh.
6. **Đặt `statement_timeout` và `idle_in_transaction_session_timeout`** ở database — chúng biến bug treo thành lỗi có thể thấy.

## Production Considerations

- **`idle_in_transaction_session_timeout`** (ví dụ 10s) ở PostgreSQL — nó tự kill transaction bị treo bởi application. Đây là lưới an toàn quan trọng nhất.
- **`statement_timeout`** cho từng câu lệnh.
- **Không gọi network trong transaction.** Nếu buộc phải, đặt timeout ngắn cho call đó và `timeout` cho transaction.
- **Retry cho `P2034`** với backoff + jitter, và giới hạn số lần.
- **Đo thời gian transaction** như một metric; p99 tăng là tín hiệu sớm.
- **Ưu tiên atomic operation và điều kiện trong `updateMany`** trước khi dùng lock — chúng scale tốt hơn nhiều.
- **Side effect ngoài DB (email, webhook, cache invalidation) đặt ngoài transaction**, hoặc qua outbox.
- Với PgBouncer ở **transaction pooling mode**, interactive transaction vẫn hoạt động nhưng prepared statement có thể gặp vấn đề — cần `pgbouncer=true` trong connection string.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nested write | ngắn, nguyên tử, không callback | không có logic ở giữa |
| Sequential `$transaction` | không giữ transaction lúc JS chạy | không đọc kết quả giữa các lệnh |
| Interactive | logic đầy đủ | dễ giữ transaction lâu; phải đặt timeout |
| Atomic op (`increment`) | không lock, scale tốt | chỉ cho phép toán đơn giản |
| Optimistic (version) | không lock, throughput cao | phải xử lý conflict ở tầng trên |
| Pessimistic (`FOR UPDATE`) | đơn giản để suy luận | giữ lock, giảm concurrency |
| `Serializable` | đúng đắn mạnh nhất | nhiều abort, cần retry |
| Tách transaction + trạng thái trung gian | không giữ lock qua network | cần job dọn state kẹt |

## Explain Without Notes

1. Vì sao ba lệnh Prisma riêng lẻ không nguyên tử với nhau?
2. Ba cách dùng transaction trong Prisma khác nhau ở điểm nào?
3. Vì sao gọi API bên ngoài trong transaction là nguy hiểm cho **toàn hệ thống**?
4. Bốn mức bảo vệ race condition, theo thứ tự nên thử?
5. Vì sao `Serializable` bắt buộc phải có retry?
6. `idle in transaction` trong `pg_stat_activity` nói lên điều gì?

## Related

- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — isolation level và anomaly
- [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) — lock, deadlock, thứ tự
- [MVCC & vacuum](../01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — transaction dài chặn vacuum
- [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — vì sao transaction dài cạn pool
- [Outbox pattern](../04-message-queues/06-outbox-pattern.md) — side effect ngoài DB
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — retry an toàn
- [Database integration & transactions (NestJS)](../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) — transaction trong DI
- [Shared state & races](../../05-cross-cutting/concurrency/02-shared-state-races.md)
