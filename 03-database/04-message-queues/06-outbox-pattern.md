---
level: advanced
area: database
prerequisites:
  - 02-delivery-semantics.md
  - ../01-postgresql/01-transaction-isolation.md
related:
  - 05-broker-comparison.md
  - ../../02-backend-api/02-nestjs/06-database-integration-transactions.md
  - ../../06-system-design/07-event-driven.md
---

# Outbox pattern

> Đơn hàng số 8421 tồn tại trong database. Khách hàng không nhận được email xác nhận, kho không trừ tồn, ERP không có bản ghi nào. Log của API cho thấy request trả về `201 Created`. Log của worker không có gì — vì không có job nào được tạo. Giữa `COMMIT` và `queue.add()` có một khoảng thời gian, và tiến trình đã chết đúng trong khoảng đó.

## Position

```text
Service
  ├──▶ PostgreSQL   (transaction)
  └──▶ Broker       (KHÔNG nằm trong transaction đó)
         ↑
    hai hệ thống, không có transaction chung ⇒ khe hở
```

## Problem

### Dual-write: ghi vào hai hệ thống không nguyên tử

```ts
await db.$transaction(async (tx) => {
  await tx.order.create({ data });
});                                    // ✓ committed
await queue.add('send-invoice', { orderId });   // ✗ process chết ở đây
```

Bốn kịch bản, và ba trong số đó là lỗi:

```text
① DB ✓  Queue ✓   → đúng
② DB ✗  Queue ✗   → đúng (không có gì xảy ra)
③ DB ✓  Queue ✗   → SỰ KIỆN MẤT: đơn tồn tại, không ai biết
④ DB ✗  Queue ✓   → SỰ KIỆN MA: job xử lý một đơn không tồn tại
```

Đảo thứ tự không giúp gì — nó chỉ đổi ③ thành ④.

Và một biến thể tinh vi hơn của ④, xảy ra thường xuyên hơn nhiều:

```ts
await db.$transaction(async (tx) => {
  await tx.order.create({ data });
  await queue.add('send-invoice', { orderId });   // ← BÊN TRONG transaction
  await tx.inventory.reserve(...);                 // ← ném lỗi
});
// transaction ROLLBACK → đơn hàng KHÔNG tồn tại
// nhưng job ĐÃ nằm trong Redis → worker xử lý một đơn không có thật
```

Đây là lỗi phổ biến vì đặt `queue.add()` bên trong transaction **trông giống** như cách làm đúng.

### Vì sao không dùng distributed transaction

2PC (two-phase commit) giải quyết được về lý thuyết, nhưng:

```text
· Redis, Kafka, SQS không hỗ trợ 2PC
· 2PC chặn: coordinator chết ⇒ mọi participant giữ khoá chờ
· hiệu năng kém, vận hành phức tạp
· gần như không ai dùng trong hệ thống hiện đại
```

Outbox là cách né vấn đề thay vì giải nó: **biến hai lần ghi thành một lần ghi.**

## Mental Model

```text
GHI (một transaction, nguyên tử)
  ┌──────────────────────────────────┐
  │ INSERT orders   (dữ liệu)        │
  │ INSERT outbox   (Ý ĐỊNH gửi)     │
  └──────────────────────────────────┘
         ↓ cả hai cùng commit, hoặc cả hai cùng rollback

PHÁT TÁN (tiến trình riêng, không đồng bộ)
  worker đọc outbox WHERE sent_at IS NULL
     → publish lên broker
     → UPDATE outbox SET sent_at = now()
```

Tính chất đạt được:

```text
✓ HOẶC cả đơn hàng và ý định gửi cùng tồn tại, HOẶC không cái nào
✓ Broker chết → ý định vẫn nằm trong DB, gửi sau
✓ Worker chết → ý định vẫn còn, worker khác lấy
```

Tính chất **không** đạt được:

```text
✗ Exactly-once. Worker có thể publish rồi chết trước UPDATE
  ⇒ publish lại ⇒ consumer PHẢI idempotent
```

Đó là đánh đổi trung tâm: outbox chuyển bài toán từ **"có thể mất"** sang **"có thể trùng"**. Và "có thể trùng" giải quyết được bằng idempotency, còn "có thể mất" thì không giải quyết được bằng gì cả.

## How It Works

### Bảng outbox

```sql
CREATE TABLE outbox (
  id             bigserial   PRIMARY KEY,      -- tăng dần ⇒ giữ thứ tự ghi
  aggregate_type text        NOT NULL,         -- 'order'
  aggregate_id   text        NOT NULL,         -- '8421'   → dùng làm partition key
  event_type     text        NOT NULL,         -- 'order.created'
  payload        jsonb       NOT NULL,
  version        int         NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  attempts       int         NOT NULL DEFAULT 0,
  last_error     text
);

-- index PARTIAL: chỉ chứa dòng chưa gửi ⇒ nhỏ và nhanh mãi mãi
CREATE INDEX ON outbox (id) WHERE sent_at IS NULL;
```

Partial index là chi tiết quan trọng: bảng outbox tích luỹ hàng triệu dòng đã gửi, nhưng index chỉ chứa vài chục dòng chưa gửi. Xem [Index types](../01-postgresql/07-index-types.md).

### Ghi: một transaction

```ts
await this.db.$transaction(async (tx) => {
  const order = await tx.order.create({ data: dto });
  await tx.inventory.reserve(tx, dto.items);

  await tx.outbox.createMany({
    data: [
      { aggregateType: 'order', aggregateId: order.id,
        eventType: 'order.created', payload: { orderId: order.id, total: order.total } },
      { aggregateType: 'order', aggregateId: order.id,
        eventType: 'order.invoice-requested', payload: { orderId: order.id } },
    ],
  });
});
// lỗi ở bất kỳ đâu → rollback tất cả, kể cả outbox
```

Ba điều đáng chú ý:

- **`payload` nên nhỏ và ổn định** — chỉ đủ để consumer biết chuyện gì xảy ra. Dữ liệu chi tiết thì consumer tự đọc từ DB.
- **`version`** để consumer cũ và mới cùng tồn tại trong lúc deploy.
- **Không gọi mạng trong transaction** — outbox chính là cách tránh điều đó.

### Phát tán: worker polling

```ts
@Injectable()
export class OutboxPublisher {
  @Interval(1000)
  async publish() {
    // advisory lock: chỉ MỘT instance chạy tại một thời điểm
    const [{ locked }] = await this.db.$queryRaw<[{ locked: boolean }]>`
      SELECT pg_try_advisory_lock(hashtext('outbox-publisher')) AS locked`;
    if (!locked) return;

    try {
      for (;;) {
        const batch = await this.db.$queryRaw<OutboxRow[]>`
          SELECT * FROM outbox
          WHERE sent_at IS NULL
          ORDER BY id                       -- giữ thứ tự ghi
          FOR UPDATE SKIP LOCKED            -- nhiều worker không giẫm nhau
          LIMIT 100`;
        if (batch.length === 0) break;

        for (const row of batch) {
          try {
            await this.broker.publish(row.eventType, row.payload, {
              key: row.aggregateId,                    // partition theo aggregate
              messageId: String(row.id),               // consumer khử trùng bằng cái này
            });
            await this.db.outbox.update({
              where: { id: row.id }, data: { sentAt: new Date() },
            });
          } catch (e) {
            await this.db.outbox.update({
              where: { id: row.id },
              data: { attempts: { increment: 1 }, lastError: String(e).slice(0, 500) },
            });
            // KHÔNG break — thử tiếp dòng khác
          }
        }
      }
    } finally {
      await this.db.$queryRaw`SELECT pg_advisory_unlock(hashtext('outbox-publisher'))`;
    }
  }
}
```

Bốn chi tiết, mỗi cái chống một failure mode:

```text
advisory lock       nhiều instance app → chỉ một publisher chạy
ORDER BY id         giữ thứ tự ghi
FOR UPDATE SKIP LOCKED  cho phép nhiều publisher song song nếu cần, không chờ nhau
messageId = row.id  consumer có khoá khử trùng ổn định
```

Và khe hở còn lại, phải nói rõ:

```text
publish ✓ → process chết → UPDATE sent_at ✗
⇒ lần sau publish LẠI cùng sự kiện
⇒ consumer PHẢI idempotent (dùng messageId)
```

Đây là at-least-once, và nó là điều tốt nhất có thể đạt được. Xem [Delivery semantics](02-delivery-semantics.md).

### CDC: thay polling bằng đọc WAL

```text
PostgreSQL WAL ──▶ Debezium ──▶ Kafka
                     ↑ đọc log thay đổi, KHÔNG polling
```

```text
POLLING                          CDC (Debezium)
độ trễ = chu kỳ poll (~1s)       độ trễ ~ mili giây
tải nhẹ lên DB mỗi giây          không query, đọc WAL
đơn giản, không thêm hệ thống    thêm Debezium + Kafka Connect
đủ cho hầu hết                   cho khối lượng lớn / độ trễ thấp
```

Với CDC, bảng outbox vẫn cần thiết — Debezium đọc thay đổi trên chính bảng đó (Debezium có `outbox event router` cho đúng mẫu này). Bạn thậm chí có thể `DELETE` ngay sau `INSERT` trong cùng transaction: WAL vẫn ghi lại cả hai, nên Debezium bắt được sự kiện mà bảng không tích luỹ dòng nào.

Đừng bắt đầu bằng CDC. Polling 1 giây đủ cho phần lớn hệ thống, và nó không thêm hệ thống nào phải vận hành.

### Dọn dẹp: bảng outbox sẽ phình

```sql
-- xoá theo LÔ, không một câu lệnh khổng lồ
DELETE FROM outbox
WHERE id IN (
  SELECT id FROM outbox
  WHERE sent_at IS NOT NULL AND sent_at < now() - interval '7 days'
  LIMIT 10000
);
```

Với khối lượng lớn, `DELETE` định kỳ tạo bloat đáng kể. Giải pháp tốt hơn: **partition theo tháng và `DROP` partition cũ** — tức thì, không tạo dead tuple nào. Xem [MVCC & vacuum](../01-postgresql/04-mvcc-vacuum.md).

Giữ lại 7–30 ngày là hợp lý: đủ để điều tra sự cố, không đủ để thành gánh nặng.

### Inbox: chống trùng ở phía consumer

Outbox đảm bảo không mất. Inbox đảm bảo không xử lý trùng:

```ts
await db.$transaction(async (tx) => {
  try {
    await tx.processedMessage.create({ data: { id: messageId } });   // UNIQUE(id)
  } catch (e) {
    if (isUniqueViolation(e)) return;        // đã xử lý → thoát
    throw e;
  }
  await handleEvent(tx, event);              // CÙNG transaction
});
```

Nguyên tử là điểm mấu chốt: nếu `handleEvent` fail, bản ghi `processedMessage` cũng rollback → sự kiện được thử lại. Nếu tách hai transaction, crash ở giữa làm mất việc.

**Outbox + Inbox = exactly-once effect** — cái duy nhất có thể đạt được. Xem [Delivery semantics](02-delivery-semantics.md).

Và nhớ dọn bảng `processedMessage` theo TTL, nếu không nó tăng vô hạn.

### Khi nào KHÔNG cần outbox

```text
KHÔNG CẦN
· Queue nằm chính trong database (PostgreSQL + SKIP LOCKED)
  → job và dữ liệu đã cùng một transaction, outbox là thừa
· Sự kiện mất được (analytics, telemetry, log)
· Job không phụ thuộc dữ liệu vừa ghi

CẦN
· Sự kiện dẫn tới hành động không thể bỏ (email, thanh toán, cập nhật kho)
· Hệ thống khác phụ thuộc vào sự kiện đó
· Có yêu cầu đối soát / audit
```

Dòng đầu tiên đáng nhấn: nếu bạn dùng PostgreSQL làm queue, **bạn đã có outbox** — chỉ là nó không có tên. Đó là một lý do mạnh để cân nhắc PostgreSQL trước khi thêm broker. Xem [Broker comparison](05-broker-comparison.md).

## Example

Trước và sau, với đầy đủ hệ quả:

```ts
// ❌ TRƯỚC — dual-write
@Post('orders')
async create(@Body() dto: CreateOrderDto) {
  const order = await this.db.$transaction(async (tx) => {
    const o = await tx.order.create({ data: dto });
    await tx.inventory.reserve(tx, dto.items);
    return o;
  });

  await this.queue.add('send-invoice', { orderId: order.id });   // ← khe hở
  await this.queue.add('sync-erp',     { orderId: order.id });   // ← khe hở
  return order;
}
```

```ts
// ✅ SAU — outbox
@Post('orders')
async create(@Body() dto: CreateOrderDto) {
  return this.db.$transaction(async (tx) => {
    const order = await tx.order.create({ data: dto });
    await tx.inventory.reserve(tx, dto.items);

    await tx.outbox.createMany({
      data: [
        { aggregateType: 'order', aggregateId: order.id, eventType: 'invoice.requested',
          payload: { orderId: order.id } },
        { aggregateType: 'order', aggregateId: order.id, eventType: 'erp.sync-requested',
          payload: { orderId: order.id } },
      ],
    });
    return order;
  });
}
```

Ba tính chất mới:

```text
✓ Broker chết hoàn toàn → đơn hàng vẫn tạo được, sự kiện gửi sau khi broker hồi phục
✓ Process chết ngay sau COMMIT → sự kiện vẫn nằm trong DB, publisher lấy sau
✓ Transaction rollback → không có sự kiện ma
```

Ba chi phí:

```text
✗ Độ trễ thêm ~1 giây (chu kỳ poll)
✗ Thêm một bảng + một worker phải vận hành
✗ Consumer phải idempotent (at-least-once)
```

Và một chi tiết vận hành đáng giá: **thêm `correlationId` vào payload** để lần theo từ request HTTP tới sự kiện tới job. Xem [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).

## Prediction

1. `INSERT` đơn hàng commit thành công, process chết trước `queue.add()` — hệ quả cho khách hàng?
2. Đảo thứ tự (`queue.add()` trước, `INSERT` sau), process chết ở giữa — hệ quả?
3. `queue.add()` **bên trong** transaction, transaction rollback — job thế nào?
4. Với outbox, process chết ngay sau `COMMIT` — sự kiện thế nào?
5. Với outbox, broker chết 2 giờ — sự kiện thế nào? Đơn hàng có tạo được không?
6. Publisher publish thành công rồi chết trước `UPDATE sent_at` — chuyện gì xảy ra lần sau?
7. Consumer không idempotent trong tình huống câu 6 — hậu quả?
8. Ba instance app cùng chạy outbox publisher, không có lock — chuyện gì xảy ra?
9. Publisher không `ORDER BY id` — hệ quả cho thứ tự sự kiện?
10. Bảng outbox không có index partial, 10 triệu dòng đã gửi — query lấy dòng chưa gửi thế nào?
11. Không dọn bảng outbox, chạy 2 năm — kích thước? `DELETE` định kỳ gây gì?
12. Inbox mark và `handleEvent` ở hai transaction khác nhau, crash ở giữa — hậu quả?
13. Dùng PostgreSQL làm queue với `SKIP LOCKED` — có cần outbox không?

<details>
<summary>Đáp án</summary>

1. Đơn hàng tồn tại, **không email, không trừ kho, không ERP**. Không có gì trong log cho thấy sai.
2. Job tồn tại nhưng đơn hàng **không** → worker xử lý một `orderId` không có thật → job fail hoặc tạo dữ liệu rác.
3. Job **vẫn nằm trong Redis** — Redis không tham gia transaction của PostgreSQL. Sự kiện ma.
4. Sự kiện **vẫn nằm trong bảng outbox**; publisher lấy ở chu kỳ sau. Không mất.
5. Sự kiện tích luỹ trong outbox; đơn hàng **vẫn tạo được bình thường**. Khi broker hồi phục, chúng được gửi.
6. Publish **lại** cùng sự kiện — vì `sent_at` vẫn NULL.
7. Xử lý trùng: email gửi hai lần, kho trừ hai lần.
8. Cùng một sự kiện được publish nhiều lần. `FOR UPDATE SKIP LOCKED` giảm điều này, nhưng advisory lock làm nó rõ ràng hơn.
9. Sự kiện của cùng một aggregate có thể publish sai thứ tự → consumer nhận `updated` trước `created`.
10. Query phải quét index lớn (hoặc bảng) để tìm vài dòng `sent_at IS NULL` → chậm dần theo thời gian.
11. Hàng chục GB. `DELETE` định kỳ tạo hàng triệu dead tuple → bloat, cần vacuum liên tục.
12. Nếu crash sau mark trước handle: hệ thống nghĩ đã xử lý nhưng chưa làm gì → **mất việc vĩnh viễn**.
13. **Không** — job và dữ liệu đã nằm trong cùng transaction. Bạn đã có outbox rồi.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `kill -9` ngay sau `COMMIT`, trước `queue.add()` | Sự kiện mất |
| Thêm outbox, lặp lại | Sự kiện vẫn còn |
| Đặt `queue.add()` trong transaction rồi ném lỗi sau đó | Job mồ côi trong Redis |
| Với outbox, lặp lại | Không có sự kiện ma |
| Tắt broker hoàn toàn 10 phút, tạo 100 đơn hàng | Outbox tích luỹ; đơn hàng vẫn tạo được |
| Bật broker lại | Sự kiện được gửi hết |
| `kill -9` publisher giữa `publish` và `UPDATE` | Sự kiện gửi trùng |
| Consumer không idempotent, lặp lại | Email trùng |
| Thêm inbox với `UNIQUE(messageId)` | Lần hai bị chặn |
| Chạy 3 publisher không lock, đếm số lần mỗi sự kiện được publish | Trùng lặp |
| Thêm advisory lock, lặp lại | Một lần |
| Bỏ `ORDER BY id`, gửi nhiều sự kiện cho cùng aggregate | Thứ tự sai |
| Bỏ index partial, đổ 5 triệu dòng đã gửi, đo query | Chậm dần |
| Không dọn outbox 1 tháng với tải thật | Đo kích thước bảng và `n_dead_tup` |
| Inbox mark ở transaction riêng, crash giữa hai transaction | Mất việc |

## What Usually Goes Wrong

- **Dual-write không nhận ra là vấn đề** → mất sự kiện ngẫu nhiên, rất khó tái hiện.
- **`queue.add()` bên trong transaction** → sự kiện ma khi rollback.
- **Consumer không idempotent** → outbox chuyển "mất" thành "trùng", và trùng cũng là bug nếu không xử lý.
- **Nhiều publisher không có lock** → sự kiện publish nhiều lần.
- **Không `ORDER BY id`** → thứ tự sự kiện sai.
- **Không có index partial** → publisher chậm dần theo kích thước bảng.
- **Không dọn bảng outbox** → bảng phình, `DELETE` gây bloat.
- **Payload quá lớn** → bảng phình nhanh, WAL lớn.
- **Không version hoá payload** → consumer cũ vỡ khi deploy.
- **Publisher không có alert** → nó chết và sự kiện tích luỹ hàng giờ không ai biết.
- **Inbox mark không nguyên tử với xử lý** → mất việc hoặc làm trùng.
- **Không dọn bảng inbox** → tăng vô hạn.
- **Dùng outbox khi queue đã ở trong DB** → phức tạp thừa.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Outbox cho exactly-once | Nó cho at-least-once; cần inbox để có exactly-once **effect** |
| Đặt `queue.add()` trong transaction là an toàn | Broker không tham gia transaction của DB |
| Đảo thứ tự ghi giải quyết được | Chỉ đổi "mất" thành "ma" |
| 2PC là giải pháp đúng | Hầu hết broker không hỗ trợ; nó chặn và phức tạp |
| Outbox làm chậm hệ thống | Nó thêm ~1 giây độ trễ cho sự kiện, không cho request |
| Cần CDC để làm outbox | Polling 1 giây đủ cho hầu hết |
| Bảng outbox tự dọn | Phải có job dọn hoặc partition |
| Một publisher là đủ, không cần lock | Nhiều instance app = nhiều publisher |
| Outbox chỉ dùng với Kafka | Dùng với mọi broker |
| Nếu dùng PostgreSQL queue vẫn nên thêm outbox | Bạn đã có nó rồi |

## Debugging

1. **Sự kiện mất** → so số dòng: `SELECT count(*) FROM orders WHERE created_at > X` và số sự kiện tương ứng ở consumer. Chênh lệch là số bị mất.
2. **Kiểm tra outbox tồn đọng**:
   ```sql
   SELECT count(*), min(created_at), max(now() - created_at) AS oldest
   FROM outbox WHERE sent_at IS NULL;
   ```
   `oldest` là metric quan trọng nhất — nó phát hiện publisher chết.
3. **Sự kiện có `attempts` cao** → broker không nhận được; đọc `last_error`.
4. **Publisher không chạy** → advisory lock có bị giữ bởi một session chết không? `pg_locks` với `locktype = 'advisory'`.
5. **Sự kiện trùng** → consumer có inbox không? `messageId` có ổn định không?
6. **Thứ tự sai** → publisher có `ORDER BY id` không? Broker có partition theo `aggregateId` không?
7. **Publisher chậm** → index partial còn tồn tại không? Bảng có bloat không?
8. **Đối soát định kỳ**: mỗi ngày, so số aggregate với số sự kiện đã gửi. Chênh lệch khác 0 là bug.

## Production Considerations

- **Alert trên tuổi dòng outbox cũ nhất chưa gửi.** Ngưỡng 1 phút là hợp lý. Đây là metric quan trọng nhất của outbox.
- **Alert trên số dòng chưa gửi** và trên `attempts > 3`.
- **Advisory lock hoặc leader election** cho publisher — nhiều instance app là mặc định.
- **Index partial** `WHERE sent_at IS NULL` — bắt buộc.
- **Dọn dẹp theo lô, hoặc partition theo tháng và `DROP`.** Với khối lượng lớn, partition tốt hơn hẳn.
- **Payload nhỏ và ổn định** — chỉ ID và vài trường cần thiết; consumer đọc chi tiết từ DB.
- **Version hoá payload** ngay từ sự kiện đầu tiên.
- **`messageId = outbox.id`** làm khoá khử trùng cho consumer.
- **`aggregateId` làm partition key** để giữ thứ tự theo aggregate.
- **Inbox ở phía consumer** cho mọi sự kiện có tác dụng phụ không thể hoàn tác.
- **Dọn bảng inbox theo TTL** (30 ngày).
- **Đối soát định kỳ**: một job hằng ngày so số aggregate với số sự kiện. Đây là cách duy nhất phát hiện bug im lặng.
- **Cân nhắc CDC** chỉ khi độ trễ 1 giây là vấn đề thật, hoặc khối lượng vượt khả năng polling.
- **Nếu đang dùng PostgreSQL làm queue, đừng thêm outbox** — bạn đã có nó.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Outbox | không mất sự kiện, không sự kiện ma | +1 bảng, +1 worker, độ trễ ~1s |
| Dual-write | đơn giản, độ trễ 0 | mất sự kiện hoặc sự kiện ma |
| 2PC | nguyên tử thật | không được hỗ trợ, chặn, phức tạp |
| Polling | đơn giản, không thêm hệ thống | độ trễ = chu kỳ, tải nhẹ lên DB |
| CDC (Debezium) | độ trễ mili giây, không query | thêm Debezium + Kafka Connect |
| Payload đầy đủ | consumer không cần đọc DB | bảng phình, dữ liệu có thể cũ |
| Payload chỉ ID | nhỏ, luôn mới nhất | consumer phải đọc DB |
| Giữ outbox lâu | audit, điều tra được | bảng lớn |
| Dọn sớm | bảng nhỏ | mất khả năng điều tra |
| Inbox | exactly-once effect | thêm bảng, thêm transaction |
| Không inbox | ít code | consumer phải idempotent bằng cách khác |
| Partition outbox theo tháng | `DROP` tức thì, không bloat | DDL phức tạp hơn |

## Explain Without Notes

1. Dual-write là gì? Vẽ bốn kịch bản và chỉ ra ba cái sai.
2. Vì sao đặt `queue.add()` bên trong transaction **không** an toàn?
3. Outbox biến bài toán "có thể mất" thành bài toán gì? Vì sao đó là tiến bộ?
4. Khe hở còn lại trong outbox nằm ở đâu, và cái gì bù cho nó?
5. Vì sao publisher cần advisory lock và `ORDER BY id`?
6. Vì sao index partial quan trọng cho bảng outbox?
7. Inbox làm gì, và vì sao mark phải nguyên tử với xử lý?
8. Khi nào **không** cần outbox?

## Related

- [Delivery semantics](02-delivery-semantics.md) — at-least-once, inbox, idempotency
- [Vì sao cần queue](01-why-queue.md) — nền tảng
- [Retry & DLQ](03-retry-dlq.md) — xử lý sự kiện fail ở phía consumer
- [Ordering & partitioning](04-ordering-partitioning.md) — `aggregateId` làm partition key
- [Broker comparison](05-broker-comparison.md) — PostgreSQL queue = outbox có sẵn
- [Transaction isolation](../01-postgresql/01-transaction-isolation.md) — nguyên tử
- [Locking & deadlock](../01-postgresql/05-locking-deadlock.md) — advisory lock, `SKIP LOCKED`
- [MVCC & vacuum](../01-postgresql/04-mvcc-vacuum.md) — bloat từ `DELETE` định kỳ
- [Index types](../01-postgresql/07-index-types.md) — partial index
- [Database & transactions (NestJS)](../../02-backend-api/02-nestjs/06-database-integration-transactions.md) — implementation
- [Event-driven](../../06-system-design/07-event-driven.md) — outbox trong kiến trúc sự kiện
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — lần theo qua outbox

## Version / Context

PostgreSQL 16. `pg_try_advisory_lock` cho leader election. CDC với Debezium 2.x (có `EventRouter` SMT cho đúng mẫu outbox) yêu cầu `wal_level = logical`. Partial index và `SKIP LOCKED` là tính năng PostgreSQL; khái niệm outbox áp dụng cho mọi database có transaction.
