---
level: advanced
area: backend
prerequisites:
  - 02-modules-di.md
  - ../../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md
related:
  - ../../../03-database/01-postgresql/fundamentals/02-connection-pool.md
  - ../../../03-database/04-message-queues/06-outbox-pattern.md
  - ../../04-architecture/01-controller-service-repository.md
---

# Database integration & transactions

> `OrderService.checkout()` gọi `InventoryService.reserve()`, `PaymentService.charge()` và `NotificationService.send()`. Mỗi service tự mở transaction của nó. Thanh toán thành công, trừ kho thất bại. Tiền đã trừ, hàng chưa giữ. Không có exception nào bị nuốt — mỗi service đã làm đúng phần việc của nó.

## Position

```text
Controller
   ↓
Service  ◀── transaction boundary thuộc về ĐÂY (không phải repository, không phải controller)
   ↓
Repository / ORM
   ↓
Connection pool  ◀── mỗi transaction GIỮ một connection cho tới khi commit/rollback
   ↓
PostgreSQL — MVCC, lock, isolation level
```

Câu hỏi trung tâm của note này chỉ có một: **ai quyết định ranh giới transaction, và làm sao truyền ranh giới đó xuống các tầng bên dưới mà không biến mọi hàm thành một hàm nhận thêm tham số `tx`.**

## Problem

### Vấn đề 1: transaction propagation

```ts
@Injectable()
export class OrdersService {
  async checkout(userId: string, cart: Cart) {
    const order = await this.orders.create(userId, cart);      // transaction 1
    await this.inventory.reserve(cart.items);                  // transaction 2
    await this.payments.charge(userId, order.total);           // transaction 3
    await this.notifications.send(userId, order.id);           // gửi email
    return order;
  }
}
```

Bốn thao tác, ba transaction riêng biệt, một side effect không thể hoàn tác. Mọi điểm dừng giữa chừng để lại hệ thống ở trạng thái không hợp lệ:

```text
lỗi sau bước 1 → order "pending" mãi mãi, không ai xử lý
lỗi sau bước 2 → kho bị giữ nhưng không có thanh toán → hàng "biến mất" khỏi tồn kho
lỗi sau bước 3 → đã trừ tiền, khách không nhận được gì
lỗi sau bước 4 → mọi thứ đúng, chỉ thiếu email  (chấp nhận được)
```

Cách sửa hiển nhiên là bọc tất cả trong một transaction. Nhưng làm thế nào? `InventoryService` không biết nó đang được gọi từ trong một transaction. Nó cần một *transactional client*, và cái đó nằm ở `OrdersService`.

Giải pháp thô sơ: truyền `tx` xuống mọi nơi.

```ts
async checkout(userId: string, cart: Cart) {
  return this.prisma.$transaction(async (tx) => {
    const order = await this.orders.create(userId, cart, tx);
    await this.inventory.reserve(cart.items, tx);
    await this.payments.charge(userId, order.total, tx);
    return order;
  });
}
```

Nó **hoạt động**, và với nhiều dự án nó là câu trả lời cuối cùng. Nhưng nó lây lan: mọi method của mọi service và repository trên đường đi phải nhận thêm tham số `tx`, kể cả những method không bao giờ chạy trong transaction. Sau 6 tháng, `tx?: Tx` xuất hiện trong 200 chữ ký hàm.

### Vấn đề 2: side effect không rollback được

Dòng thứ tư ở trên — gửi email — là một loại vấn đề khác hẳn:

```ts
await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ ... });
  await this.mailer.send(order.userId, 'Đơn hàng đã tạo');   // ❌ không nằm trong transaction
  await tx.inventory.decrement({ ... });                      // ← nếu dòng này lỗi
});
// → transaction rollback, order KHÔNG tồn tại
// → nhưng email ĐÃ GỬI, nói về một đơn hàng không có thật
```

Database rollback được. Email, HTTP call, message queue thì không. Đây không phải bug của ORM — đây là giới hạn cơ bản: **transaction chỉ bao được thứ nằm trong database.**

## Mental Model

### Transaction là một khoảng thời gian giữ tài nguyên

```text
BEGIN ─────────────────────────────────────────── COMMIT
  │                                                  │
  ├─ giữ 1 connection từ pool (pool có 10)          │
  ├─ giữ row lock trên mọi row đã UPDATE            │
  ├─ giữ một snapshot, ngăn VACUUM dọn version cũ   │
  └─ mọi thay đổi VÔ HÌNH với transaction khác      │
```

Bốn dòng đó là toàn bộ lý do transaction phải **ngắn**. Một transaction 3 giây không chỉ chậm — nó giữ 1/10 khả năng đồng thời của app, khoá row mà request khác đang chờ, và làm autovacuum không dọn được. Xem [Connection pool](../../../03-database/01-postgresql/fundamentals/02-connection-pool.md) và [MVCC & vacuum](../../../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md).

Hệ quả trực tiếp và quan trọng nhất:

> **Không bao giờ gọi mạng bên trong transaction.**
> HTTP call 2 giây bên trong transaction = giữ connection 2 giây = pool cạn dưới tải.

### Ba tầng, ba trách nhiệm

```text
CONTROLLER    không biết transaction tồn tại
SERVICE       QUYẾT ĐỊNH ranh giới: "những thao tác này phải cùng sống hoặc cùng chết"
REPOSITORY    THAM GIA vào transaction đang có; không tự mở
```

Repository tự mở transaction là lỗi thiết kế phổ biến: nó khiến hai repository không bao giờ nằm chung một transaction được.

### Ba cách truyền transaction

```text
A. Truyền tường minh      checkout(dto, tx)
   + rõ ràng, không magic, dễ đọc
   - lây lan qua mọi chữ ký hàm

B. AsyncLocalStorage       transactionContext.run(tx, () => ...)
   + chữ ký hàm sạch, repository tự lấy tx từ context
   - ngữ cảnh ẩn; quên `run` thì im lặng chạy ngoài transaction

C. @Transactional decorator (dựng trên B)
   + khai báo, gọn nhất
   - magic nhất; giới hạn của decorator (this-call không đi qua proxy)
```

Không có lựa chọn đúng tuyệt đối. **A cho dự án nhỏ và team mới; B cho codebase lớn đã thấy rõ chi phí của A.** Điều sai duy nhất là trộn cả ba trong một codebase.

## How It Works

### Cách A — truyền tường minh, làm cho gọn bằng một kiểu chung

```ts
// một alias cho "client có thể là pool hoặc transaction"
export type Tx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // tx mặc định là prisma → gọi ngoài transaction vẫn chạy bình thường
  create(data: CreateOrder, tx: Tx = this.prisma) {
    return tx.order.create({ data });
  }
}
```

```ts
@Injectable()
export class OrdersService {
  async checkout(userId: string, cart: Cart) {
    // 1. Mọi việc TỐN THỜI GIAN làm TRƯỚC transaction
    const priced = await this.pricing.calculate(cart);          // có thể gọi mạng
    const authorization = await this.payments.authorize(userId, priced.total);  // gọi PSP

    // 2. Transaction NGẮN — chỉ ghi database
    const order = await this.prisma.$transaction(async (tx) => {
      const o = await this.orders.create({ userId, total: priced.total }, tx);
      await this.inventory.reserve(cart.items, tx);
      await this.outbox.enqueue({ type: 'order.created', orderId: o.id }, tx);   // xem dưới
      return o;
    }, { timeout: 5_000, isolationLevel: 'ReadCommitted' });

    // 3. Side effect SAU transaction
    await this.payments.capture(authorization.id);
    return order;
  }
}
```

Cấu trúc ba khối này — *chuẩn bị → transaction ngắn → hiệu ứng phụ* — là mẫu nên dùng mặc định. Nó giải quyết cùng lúc: pool không bị giữ lâu, không có network call trong transaction, và side effect không bị rollback bỏ rơi.

### Cách B — `AsyncLocalStorage`

```ts
@Injectable()
export class TransactionContext {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  run<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>) {
    return this.als.run(tx, fn);
  }
  get(): Prisma.TransactionClient | undefined {
    return this.als.getStore();
  }
}

@Injectable()
export class TransactionManager {
  constructor(private readonly prisma: PrismaClient, private readonly ctx: TransactionContext) {}

  run<T>(fn: () => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    if (this.ctx.get()) return fn();                    // đã ở trong transaction → tham gia
    return this.prisma.$transaction((tx) => this.ctx.run(tx, fn), opts);
  }
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaClient, private readonly ctx: TransactionContext) {}
  private get db() { return this.ctx.get() ?? this.prisma; }   // tự chọn client

  create(data: CreateOrder) { return this.db.order.create({ data }); }
}
```

Bây giờ chữ ký hàm sạch:

```ts
async checkout(userId: string, cart: Cart) {
  return this.tx.run(async () => {
    const order = await this.orders.create({ userId, total });   // không có tham số tx
    await this.inventory.reserve(cart.items);
    return order;
  });
}
```

Cái giá: **quên `tx.run` thì code vẫn chạy** — chỉ là mỗi câu lệnh nằm trong transaction ngầm riêng của nó. Không lỗi, không cảnh báo, chỉ mất tính nguyên tử. Đây là chế độ hỏng im lặng, và cách duy nhất bắt được nó là test tích hợp có kịch bản "ném lỗi ở giữa rồi kiểm tra không có gì được ghi".

### Nested transaction và savepoint

PostgreSQL không có transaction lồng nhau thật; nó có **savepoint**.

```sql
BEGIN;
  INSERT INTO orders ...;
  SAVEPOINT sp1;
    INSERT INTO order_items ...;      -- lỗi
  ROLLBACK TO sp1;                    -- huỷ phần bên trong, transaction ngoài vẫn sống
  INSERT INTO order_items ...;        -- thử cách khác
COMMIT;
```

Ý nghĩa thực tế trong code: khi `TransactionManager.run` được gọi lồng nhau, phải chọn ngữ nghĩa và ghi rõ:

| Ngữ nghĩa | Hành vi | Khi nào dùng |
|---|---|---|
| JOIN (mặc định nên có) | tham gia transaction ngoài; lỗi bên trong làm hỏng cả ngoài | gần như luôn luôn |
| SAVEPOINT | lỗi bên trong chỉ huỷ phần bên trong | "thử, nếu không được thì làm cách khác" |
| REQUIRES_NEW | transaction độc lập, commit riêng | ghi audit log phải tồn tại kể cả khi nghiệp vụ rollback |

Cái sai phổ biến nhất là dùng JOIN nhưng **bắt lỗi bên trong rồi tiếp tục**:

```ts
await this.tx.run(async () => {
  await this.orders.create(...);
  try {
    await this.inventory.reserve(...);     // lỗi → transaction đã bị đánh dấu abort
  } catch { /* bỏ qua, không sao đâu */ }
  await this.log.write(...);               // ❌ "current transaction is aborted"
});
```

Một khi PostgreSQL báo lỗi trong transaction, **mọi câu lệnh tiếp theo đều bị từ chối** cho tới `ROLLBACK` hoặc `ROLLBACK TO SAVEPOINT`. Bắt lỗi trong JavaScript không "sửa" được trạng thái phía server.

### Side effect: outbox pattern, ngắn gọn

```ts
// TRONG transaction: chỉ ghi ý định vào bảng, không gửi gì cả
await tx.outbox.create({ data: { type: 'order.created', payload: { orderId }, sentAt: null } });
```

```ts
// NGOÀI transaction: một worker đọc bảng và gửi thật
const pending = await this.prisma.outbox.findMany({ where: { sentAt: null }, take: 100 });
for (const e of pending) {
  await this.queue.publish(e.type, e.payload);          // có thể gửi TRÙNG → consumer phải idempotent
  await this.prisma.outbox.update({ where: { id: e.id }, data: { sentAt: new Date() } });
}
```

Tính chất đạt được: **hoặc cả order và event cùng tồn tại, hoặc không cái nào.** Tính chất **không** đạt được: gửi đúng một lần. Nếu worker crash giữa `publish` và `update`, event được gửi lại. Consumer bắt buộc phải idempotent. Chi tiết: [Outbox pattern](../../../03-database/04-message-queues/06-outbox-pattern.md) và [Delivery semantics](../../../03-database/04-message-queues/02-delivery-semantics.md).

### N+1: cái chậm không nhìn thấy trong code

```ts
const projects = await this.prisma.project.findMany({ take: 20 });      // 1 query
for (const p of projects) {
  p.tasks = await this.prisma.task.findMany({ where: { projectId: p.id } });   // 20 query
}
// tổng: 21 query. Local với 20 row: 15ms. Production với latency 3ms/query: 63ms+ và tăng tuyến tính.
```

```ts
// sửa: để database làm việc join
const projects = await this.prisma.project.findMany({
  take: 20,
  include: { tasks: { take: 5, orderBy: { createdAt: 'desc' } } },
});
```

Vì sao N+1 không lộ ra khi phát triển: local có latency ~0.1ms và dữ liệu nhỏ. Nó chỉ xuất hiện khi (a) DB ở máy khác và (b) danh sách dài. Cả hai điều kiện chỉ có ở production.

Cách phát hiện, theo thứ tự rẻ → đắt:

1. Bật query log ở dev và **đếm số query mỗi request** (Prisma: `log: ['query']`).
2. Đặt một ngưỡng trong test tích hợp: "endpoint này không được vượt quá 5 query".
3. Trong production: `pg_stat_statements` — query nào có `calls` cao bất thường.

Xem [Index & query plan](../../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md).

### Kiểm tra rồi ghi — vì sao nó không an toàn

```ts
// ❌ hai request đồng thời cùng lọt qua
const exists = await tx.user.findUnique({ where: { email } });
if (exists) throw new ConflictError('email taken');
await tx.user.create({ data: { email } });
```

Ở isolation `READ COMMITTED` (mặc định của PostgreSQL), hai transaction đồng thời đều thấy "chưa tồn tại". Chỉ unique constraint cứu bạn:

```ts
// ✅ để database phân xử
try {
  return await tx.user.create({ data: { email } });
} catch (e) {
  if (e.code === 'P2002') throw new ConflictError('email taken');   // 23505 với pg thuần
  throw e;
}
```

Với cập nhật đồng thời trên cùng một row, hai công cụ:

```ts
// khoá bi quan — request thứ hai CHỜ
const [row] = await tx.$queryRaw`SELECT * FROM accounts WHERE id = ${id} FOR UPDATE`;

// khoá lạc quan — request thứ hai FAIL và retry
const r = await tx.account.updateMany({
  where: { id, version },                                  // version đọc được lúc đầu
  data: { balance: newBalance, version: { increment: 1 } },
});
if (r.count === 0) throw new ConflictError('concurrent modification');
```

Đánh đổi: `FOR UPDATE` đơn giản nhưng tạo hàng đợi và có thể deadlock; optimistic lock không khoá gì nhưng đẩy việc retry sang client. Xem [Locking & deadlock](../../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md).

### Deadlock: quy tắc một dòng

```text
Transaction A: UPDATE account 1 → UPDATE account 2
Transaction B: UPDATE account 2 → UPDATE account 1     ⇒ deadlock
```

PostgreSQL phát hiện và giết một trong hai (`40P01`). Cách phòng gần như miễn phí: **luôn khoá theo một thứ tự cố định.**

```ts
const [first, second] = [fromId, toId].sort();     // thứ tự toàn cục
```

Và vì deadlock là lỗi **tạm thời**, nó là một trong số ít lỗi DB đáng retry tự động (2–3 lần, có jitter).

### Migration không thuộc về runtime của app

```text
❌ onModuleInit → prisma migrate deploy      (3 replica chạy song song)
✅ bước riêng trong pipeline / initContainer / Job  → rồi mới rollout app
```

Và migration phải **tương thích ngược** vì trong lúc rolling update có hai phiên bản code cùng chạy trên một schema:

```text
Thêm cột NOT NULL không default → code cũ INSERT thiếu cột → lỗi ngay lập tức
Đổi tên cột                     → một trong hai phiên bản không tìm thấy cột
```

Mẫu an toàn là ba bước qua ba lần deploy: *thêm (nullable) → ghi cả hai chỗ, backfill → xoá cái cũ*. Xem [Migrations](../../../03-database/03-data-modeling/04-migrations.md).

## Example

Toàn bộ mẫu, gói trong một hàm đọc được:

```ts
async transfer(fromId: string, toId: string, amount: number) {
  if (amount <= 0) throw new RuleViolation('amount must be positive');
  const [a, b] = [fromId, toId].sort();                       // chống deadlock

  return this.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Account[]>`
      SELECT * FROM accounts WHERE id IN (${a}, ${b}) FOR UPDATE`;   // khoá theo thứ tự
    const from = rows.find((r) => r.id === fromId)!;
    if (from.balance < amount) throw new RuleViolation('insufficient funds');

    await tx.account.update({ where: { id: fromId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: toId },   data: { balance: { increment: amount } } });
    await tx.outbox.create({ data: { type: 'transfer.done', payload: { fromId, toId, amount } } });
  }, { timeout: 5_000 });
  // email/webhook do worker outbox gửi — KHÔNG gọi ở đây
}
```

Và một `CHECK (balance >= 0)` trong schema, vì mọi kiểm tra trong code đều có thể bị bỏ sót ở một đường vào khác.

## Prediction

1. Ba service, mỗi service tự mở transaction, service thứ hai lỗi — trạng thái DB sau đó?
2. `await fetch(...)` mất 3 giây bên trong `$transaction`, pool tối đa 10, 20 request đồng thời — chuyện gì xảy ra với request thứ 11?
3. Gửi email bên trong transaction rồi transaction rollback — email có được thu hồi không?
4. Bắt lỗi bên trong transaction rồi chạy tiếp câu lệnh khác — PostgreSQL trả gì?
5. Hai request đồng thời `SELECT` kiểm tra email rồi `INSERT`, có unique index — bao nhiêu row? Client thứ hai nhận status nào nếu không bắt lỗi?
6. Vẫn hai request đó nhưng **không** có unique index — bao nhiêu row?
7. `findMany` 20 project rồi lặp lấy task — bao nhiêu query? Vì sao local không thấy chậm?
8. Hai transaction cập nhật hai row theo thứ tự ngược nhau — lỗi gì, ai bị giết?
9. Transaction chạy 60 giây trong khi có một `DELETE` lớn ở bảng khác — autovacuum dọn được row đã xoá không?
10. `prisma migrate deploy` trong `onModuleInit` với 3 replica — kết quả?
11. Thêm cột `NOT NULL` không default rồi rolling update — pod cũ còn ghi được không?

<details>
<summary>Đáp án</summary>

1. Transaction 1 đã commit và **giữ nguyên**; transaction 2 rollback. Dữ liệu ở trạng thái nửa vời — không có gì tự dọn nó.
2. Request 11 chờ connection. Khi chờ quá `pool timeout`, nó nhận lỗi timeout. Triệu chứng ở app là "DB chậm" trong khi DB hoàn toàn rảnh.
3. **Không.** Email đã rời khỏi hệ thống.
4. `current transaction is aborted, commands ignored until end of transaction block`.
5. **1 row.** Request thứ hai nhận unique violation → nếu không bắt, **500** thay vì 409.
6. **2 row.** Dữ liệu trùng, và không có gì phát hiện ra cho tới khi có người thắc mắc.
7. 21 query. Local: latency ~0.1ms và 20 row → không cảm nhận được. Production: latency mạng × 21, và số project tăng.
8. Deadlock `40P01`; PostgreSQL giết transaction nó chọn (thường là cái ít tốn kém hơn để huỷ).
9. **Không.** Snapshot của transaction dài ngăn VACUUM dọn version cũ hơn nó → bảng phình.
10. Ba tiến trình migration song song. Prisma có advisory lock nên thường một cái chạy và hai cái chờ, nhưng bạn vừa buộc thời gian khởi động phụ thuộc migration — và với công cụ khác thì có thể hỏng thật.
11. **Không.** Pod cũ `INSERT` thiếu cột → lỗi tức thì cho tới khi rollout xong. Đây là downtime tự gây ra.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt `sleep(3000)` trong transaction, chạy 20 request đồng thời với pool 10 | Đo latency; xem lỗi pool timeout |
| Ném lỗi giữa transaction, kiểm tra DB | Không có gì được ghi — xác nhận nguyên tử |
| Ném lỗi giữa transaction nhưng repository **quên** dùng `tx` | Một phần dữ liệu vẫn được ghi — đây là bug đắt nhất trong note này |
| Gửi email trong transaction rồi rollback | Kiểm tra hộp thư: email vẫn tới |
| Bắt lỗi trong transaction rồi chạy tiếp | `current transaction is aborted` |
| Xoá unique index, chạy 50 request đồng thời tạo cùng email | Đếm row trùng |
| Bật `log: ['query']`, gọi endpoint list | Đếm query — tìm N+1 |
| Hai script cập nhật 2 row theo thứ tự ngược nhau, chạy song song | Deadlock; đọc `pg_locks` |
| Thêm `.sort()` cho thứ tự khoá, chạy lại | Deadlock biến mất |
| Mở transaction rồi `sleep(60s)`, song song `DELETE` nhiều row ở bảng khác rồi `VACUUM VERBOSE` | Xem số dead tuple không giảm |
| Bọc side effect bằng outbox, kill worker giữa publish và update | Event gửi trùng — chứng minh vì sao consumer phải idempotent |
| Thêm cột `NOT NULL` rồi chạy đồng thời code cũ | Lỗi ghi ngay lập tức |

Dòng thứ ba đáng làm hai lần: đó là chế độ hỏng của cách B (`AsyncLocalStorage`) — quên lấy `tx` từ context thì mọi thứ trông vẫn hoạt động cho tới ngày có lỗi giữa chừng.

## What Usually Goes Wrong

- **Không có ranh giới transaction rõ ràng** → dữ liệu nửa vời khi lỗi giữa chừng, và không ai biết cho tới khi có báo cáo lệch số.
- **Network call trong transaction** → pool cạn dưới tải; triệu chứng trông như "DB chậm".
- **Side effect không rollback được** → email/webhook nói về dữ liệu không tồn tại.
- **Repository tự mở transaction** → không bao giờ ghép được hai repository vào một transaction.
- **Quên dùng `tx` ở một repository** (cách B) → mất nguyên tử một cách im lặng.
- **Bắt lỗi trong transaction rồi tiếp tục** → `transaction is aborted`.
- **`SELECT` rồi `INSERT` thay vì unique constraint** → dữ liệu trùng dưới concurrency.
- **N+1** → nhanh ở local, chậm tuyến tính ở production.
- **Transaction dài** → khoá lâu, chặn vacuum, giữ connection.
- **Deadlock không xử lý** → lỗi 500 ngẫu nhiên dưới tải, không tái hiện được ở local.
- **Migration trong `onModuleInit`** → chạy song song, thời gian khởi động phụ thuộc migration.
- **Migration không tương thích ngược** → downtime trong lúc rolling update.
- **`synchronize: true` (TypeORM) ở production** → schema đổi tự động, có thể mất cột.
- **Không có `statement_timeout`** → một query hỏng giữ tài nguyên đến hết đời.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| ORM tự lo transaction | Nó chỉ cung cấp API; ranh giới do bạn quyết định |
| Mỗi `save()` trong một transaction là đủ | Nguyên tử ở mức câu lệnh, không phải mức nghiệp vụ |
| Transaction lồng nhau tồn tại trong PostgreSQL | Chỉ có savepoint |
| Rollback hoàn tác được mọi thứ | Chỉ hoàn tác thứ trong database |
| Kiểm tra trùng trước khi ghi là đủ | Có khe thời gian; cần unique constraint |
| `READ COMMITTED` ngăn được lost update | Không; cần `FOR UPDATE` hoặc optimistic lock |
| Deadlock là bug phải sửa bằng cách bỏ khoá | Là hệ quả của thứ tự khoá; sửa bằng thứ tự cố định + retry |
| Transaction dài chỉ ảnh hưởng chính nó | Nó chặn vacuum toàn bộ database |
| N+1 là vấn đề nhỏ | Nó nhân latency mạng với số dòng |
| Migration nên chạy khi app khởi động | Nên chạy như một bước riêng, một lần |
| Retry mọi lỗi DB | Chỉ retry lỗi tạm thời (deadlock, serialization failure), không retry constraint violation |

## Debugging

1. **Dữ liệu nửa vời** → thao tác đó có nằm trong `$transaction` không? Nếu dùng `AsyncLocalStorage`: repository có thật sự lấy `tx` từ context không? Log `this.ctx.get() ? 'tx' : 'pool'` trong repository.
2. **Pool timeout / "DB chậm" nhưng DB rảnh** → `SELECT state, count(*), max(now() - xact_start) FROM pg_stat_activity GROUP BY state`. Có transaction `idle in transaction` không? Nếu có, tìm network call bên trong transaction.
3. **Endpoint chậm dần theo kích thước danh sách** → bật query log, đếm query. Tăng tuyến tính = N+1.
4. **Lỗi 500 ngẫu nhiên chỉ dưới tải** → tìm `40P01` (deadlock) và `40001` (serialization failure) trong log DB.
5. **`current transaction is aborted`** → tìm `try/catch` bên trong transaction.
6. **Query treo** → `pg_locks` join `pg_stat_activity` để xem ai chờ ai:
   ```sql
   SELECT blocked.pid, blocked.query, blocking.pid, blocking.query
   FROM pg_stat_activity blocked
   JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
   ```
7. **Bảng phình dù đã xoá nhiều** → tìm transaction dài đang mở (`xact_start` cũ) — nó chặn vacuum.
8. **Lỗi chỉ khi deploy** → migration có tương thích ngược không? Có hai phiên bản code cùng chạy không?

## Production Considerations

- **`statement_timeout` ở mức connection** (ví dụ 10s) là mạng lưới an toàn cuối cùng. Không có nó, một query hỏng giữ tài nguyên vô hạn.
- **`idle_in_transaction_session_timeout`** (ví dụ 30s) giết transaction bị bỏ quên do bug ở app. Đây là cấu hình phòng thủ, không phải cấu hình tối ưu.
- **Kích thước pool không phải càng lớn càng tốt.** `pool_size × số instance < max_connections`, và PostgreSQL xử lý tốt hơn với ít connection bận rộn hơn là nhiều connection nhàn rỗi. Với nhiều instance, dùng PgBouncer — nhưng chế độ `transaction` của PgBouncer **không tương thích** với prepared statement và session state, hãy đọc kỹ trước. Xem [Connection pool](../../../03-database/01-postgresql/fundamentals/02-connection-pool.md).
- **Đặt `timeout` cho `$transaction`.** Prisma mặc định có giới hạn; đặt tường minh để nó là một quyết định.
- **Retry chỉ cho lỗi tạm thời**: `40001` (serialization failure), `40P01` (deadlock). Không retry `23505` (unique violation) — nó sẽ fail mãi mãi.
- **Đọc từ replica cho báo cáo**, nhưng nhớ replication lag: ghi rồi đọc ngay từ replica có thể không thấy dữ liệu vừa ghi. Xem [Replication & scaling](../../../03-database/01-postgresql/operations/02-replication-scaling.md).
- **Đo số query mỗi request** như một metric. Đột biến sau một lần deploy thường là N+1 mới sinh ra.
- **Migration là một bước deploy riêng**, chạy một lần, có thể rollback, và tương thích ngược với phiên bản code đang chạy.
- **Đừng log query có tham số ở production** — chúng chứa dữ liệu người dùng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Truyền `tx` tường minh | rõ ràng, không magic | lây lan qua mọi chữ ký hàm |
| `AsyncLocalStorage` | chữ ký sạch, repository tự lo | ngữ cảnh ẩn; quên = mất nguyên tử im lặng |
| `@Transactional` decorator | gọn nhất | magic; không hoạt động với gọi nội bộ `this.x()` |
| Transaction lớn bao trọn use case | nguyên tử thật sự | giữ connection lâu, khoá nhiều |
| Nhiều transaction nhỏ + bù trừ | throughput cao | phải viết logic bù trừ, phức tạp |
| Pessimistic lock (`FOR UPDATE`) | đơn giản, đúng | tạo hàng đợi, rủi ro deadlock |
| Optimistic lock (`version`) | không khoá, mở rộng tốt | client phải retry, code phức tạp hơn |
| Outbox | không mất event | thêm bảng, thêm worker, at-least-once |
| Publish trực tiếp trong transaction | ít hạ tầng | mất event hoặc gửi event ma |
| `include` sâu (chống N+1) | ít round-trip | payload lớn, có thể chậm hơn ở DB |

## Explain Without Notes

1. Kể ba tài nguyên mà một transaction đang mở giữ, và vì sao mỗi cái khiến transaction phải ngắn.
2. Mô tả mẫu ba khối (chuẩn bị → transaction → side effect) và vấn đề mà mỗi khối giải quyết.
3. So sánh truyền `tx` tường minh với `AsyncLocalStorage`: chế độ hỏng của mỗi cách là gì?
4. Vì sao "kiểm tra tồn tại rồi ghi" không an toàn, và hai cách sửa?
5. Vì sao rollback không cứu được email đã gửi, và outbox giải quyết chuyện gì (và **không** giải quyết chuyện gì)?
6. Vì sao N+1 không xuất hiện ở local? Hai cách phát hiện nó trước khi lên production.
7. Deadlock xảy ra thế nào và cách phòng gần như miễn phí là gì?

## Related

- [Transaction isolation](../../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) — mức isolation và anomaly
- [Locking & deadlock](../../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) — khoá, hàng đợi, deadlock
- [Connection pool](../../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — vì sao transaction dài làm cạn pool
- [MVCC & vacuum](../../../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — vì sao transaction dài làm phình bảng
- [Index & query plan](../../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — N+1 và query chậm
- [Migrations](../../../03-database/03-data-modeling/04-migrations.md) — migration tương thích ngược
- [Outbox pattern](../../../03-database/04-message-queues/06-outbox-pattern.md) — side effect nguyên tử
- [Delivery semantics](../../../03-database/04-message-queues/02-delivery-semantics.md) — vì sao consumer phải idempotent
- [Controller → Service → Repository](../../04-architecture/01-controller-service-repository.md) — ai sở hữu ranh giới
- [Validation & errors](03-validation-errors.md) — dịch lỗi constraint thành 409

## Version / Context

NestJS 10/11, PostgreSQL 16. Ví dụ dùng Prisma 5; khái niệm áp dụng như nhau cho TypeORM (`DataSource.transaction`, `QueryRunner`) và Drizzle (`db.transaction`), chỉ khác tên API.
