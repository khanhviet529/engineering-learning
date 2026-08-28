---
level: advanced
area: database
prerequisites:
  - 01-why-queue.md
related:
  - 03-retry-dlq.md
  - 06-outbox-pattern.md
  - ../../06-system-design/03-idempotency-retry.md
---

# Delivery semantics

> Tài liệu của broker ghi "exactly-once delivery". Bạn tin. Sáu tháng sau, một khách hàng bị trừ tiền hai lần, và log cho thấy cùng một job chạy hai lần cách nhau 31 giây. Broker không nói dối — nó chỉ đang nói về một thứ khác với thứ bạn nghĩ. **"Exactly-once" ở tầng vận chuyển không tồn tại; cái tồn tại là exactly-once *effect*, và nó do bạn xây.**

## Position

```text
Producer ──▶ Broker ──▶ Consumer ──▶ Side effect (DB, email, API)
    │           │           │              ↑
    │           │           │       nơi "exactly-once" THẬT SỰ được tạo ra
    └───────────┴───────────┘
      ba chỗ này đều có thể mất hoặc lặp
```

## Problem

### Vấn đề hai tướng quân

```text
Consumer xử lý xong job, gửi ACK cho broker.
Mạng đứt trước khi ACK tới.

Broker thấy: không có ACK → job chưa xong → giao lại
Consumer thấy: đã làm xong

Không có cách nào để broker phân biệt:
  · consumer chết TRƯỚC khi xử lý
  · consumer chết SAU khi xử lý, TRƯỚC khi ack
```

Đây không phải hạn chế của một sản phẩm cụ thể — nó là kết quả bất khả thi đã được chứng minh. Trong một hệ thống phân tán với mạng có thể mất gói, **không tồn tại giao thức nào đảm bảo cả hai bên đạt được đồng thuận chắc chắn**.

Vì thế mọi hệ thống phải chọn một trong hai:

```text
Ack TRƯỚC khi xử lý  →  at-most-once  (có thể MẤT)
Ack SAU khi xử lý    →  at-least-once (có thể LẶP)
```

Không có lựa chọn thứ ba ở tầng vận chuyển.

### Vấn đề thứ hai: ranh giới với thế giới bên ngoài

Ngay cả khi broker hoàn hảo, side effect vẫn có thể lặp:

```text
Consumer:  gửi email ──▶ ghi "đã gửi" vào DB ──▶ ack
                    ↑ crash ở đây: email đã gửi, DB chưa ghi, chưa ack
                    → chạy lại → gửi email lần hai
```

Bạn có thể đảo thứ tự (ghi DB trước, gửi email sau), nhưng khi đó crash ở giữa nghĩa là email **không bao giờ** được gửi trong khi hệ thống nghĩ đã gửi.

Đây là đánh đổi cơ bản, và nó không có lời giải hoàn hảo — chỉ có quyết định: **thà gửi trùng hay thà không gửi?**

## Mental Model

### Ba mức, và cái thứ ba không tồn tại như bạn nghĩ

```text
AT-MOST-ONCE    ack trước khi xử lý
                mất được, không lặp
                → log, metric, telemetry

AT-LEAST-ONCE   ack sau khi xử lý                       ← mặc định của mọi hệ thống thực tế
                không mất, có thể lặp
                → mọi thứ khác

EXACTLY-ONCE    ✗ không tồn tại ở tầng vận chuyển
                ✓ tồn tại ở tầng HIỆU ỨNG:
                  at-least-once + consumer idempotent = exactly-once EFFECT
```

Cách nói chính xác: bạn không thể đảm bảo mỗi tin nhắn được **giao** đúng một lần. Bạn có thể đảm bảo mỗi tin nhắn được **có hiệu lực** đúng một lần.

Về "exactly-once" mà Kafka quảng cáo: nó là exactly-once **trong phạm vi Kafka** — đọc từ topic, xử lý, ghi sang topic khác, tất cả trong một transaction của Kafka. Khoảnh khắc bạn gọi ra ngoài (database, HTTP, email), đảm bảo đó không còn áp dụng.

### Idempotency là hợp đồng, không phải mẹo

```text
f(x) idempotent  ⟺  f(f(x)) = f(x)

Áp dụng cho job:
  chạy job N lần cho cùng trạng thái cuối như chạy 1 lần
```

Bốn cách đạt được, theo thứ tự ưu tiên:

```text
① Tự nhiên idempotent
   SET status = 'shipped'         ✓  (gán, không cộng dồn)
   INCREMENT count BY 1           ✗  (cộng dồn)
   → thiết kế thao tác thành GÁN thay vì CỘNG khi có thể

② Khoá tự nhiên + UNIQUE constraint
   INSERT INTO invoices (order_id, ...) — UNIQUE(order_id)
   → lần hai vi phạm constraint → bắt lỗi 23505 → coi như thành công

③ Bảng idempotency key
   INSERT INTO processed_messages (message_id) — nếu trùng thì bỏ qua
   → tổng quát nhất; cần dọn dẹp định kỳ

④ Kiểm tra trạng thái
   if (order.invoiceSentAt) return;
   → đơn giản nhất; nhưng CÓ KHE HỞ nếu không nguyên tử với side effect
```

Cách ② mạnh nhất khi áp dụng được: **database ép tính duy nhất**, đúng cả dưới concurrency, không cần code kiểm tra.

### Idempotency key phải nguyên tử với công việc

Đây là chi tiết quyết định giữa "idempotent thật" và "idempotent trên giấy":

```ts
// ❌ hai bước tách rời → crash ở giữa = mất dấu, và job chạy lại làm lại từ đầu
if (await redis.exists(`done:${msgId}`)) return;
await doWork();
await redis.set(`done:${msgId}`, '1');
```

```ts
// ✅ đánh dấu và làm việc trong CÙNG transaction
await db.$transaction(async (tx) => {
  try {
    await tx.processedMessage.create({ data: { id: msgId } });   // UNIQUE(id)
  } catch (e) {
    if (isUniqueViolation(e)) return;                             // đã xử lý → thoát
    throw e;
  }
  await doWork(tx);                                               // cùng transaction
});
```

Nếu `doWork` fail, transaction rollback và bản ghi `processedMessage` cũng biến mất — job sẽ được thử lại. Nếu commit, cả hai cùng tồn tại. **Nguyên tử.**

Ràng buộc: `doWork` phải là thao tác database. Nếu nó gọi ra ngoài (email, API), bạn quay lại vấn đề ở phần Problem.

### Side effect ngoài database: ba cách xử lý

```text
① Nhà cung cấp hỗ trợ idempotency key      ← tốt nhất
   Stripe: Idempotency-Key header
   SendGrid, Twilio: một số API hỗ trợ
   → gửi cùng key khi retry, họ trả về kết quả cũ

② Ghi ý định TRƯỚC, thực hiện SAU, đánh dấu SAU
   INSERT email_outbox (id, status='pending')  ← trong transaction với nghiệp vụ
   → worker: gửi → UPDATE status='sent'
   → crash giữa chừng: có thể gửi trùng, KHÔNG mất

③ Chấp nhận trùng
   Với email/thông báo, gửi hai lần thường ít tệ hơn không gửi
   → nhưng phải là quyết định CÓ Ý THỨC, không phải tình cờ
```

Với thanh toán, ① là bắt buộc. Không nhà cung cấp thanh toán nghiêm túc nào thiếu idempotency key — nếu bạn không dùng, đó là lỗi của bạn.

### Ba chỗ tin nhắn bị mất

Nhiều người chỉ nghĩ tới consumer. Thực tế có ba:

```text
① PRODUCER → BROKER
   Gửi xong, broker chưa ghi xuống đĩa, broker chết
   → cần: publisher confirm (RabbitMQ), acks=all (Kafka), và outbox

② TRONG BROKER
   Chưa fsync, node chết; hoặc replication async và primary chết
   → cần: durable queue, đủ replica, cấu hình fsync

③ BROKER → CONSUMER
   Consumer nhận, chết trước khi xử lý xong
   → cần: ack SAU khi xử lý (at-least-once)
```

Chỗ ① là chỗ hay bị bỏ qua nhất và cũng nguy hiểm nhất: nếu `INSERT` vào PostgreSQL thành công nhưng `publish` thất bại, bạn có một đơn hàng mà không hệ thống nào biết. Đó là lý do outbox tồn tại. Xem [Outbox pattern](06-outbox-pattern.md).

### Ack thủ công, không phải tự động

```ts
// ❌ ack tự động khi nhận → at-most-once, mất job khi crash
consumer.consume(queue, handler, { noAck: true });
```

```ts
// ✅ ack sau khi xử lý xong
consumer.consume(queue, async (msg) => {
  try {
    await handle(msg);
    channel.ack(msg);
  } catch (e) {
    channel.nack(msg, false, !isPermanent(e));   // requeue chỉ khi lỗi tạm thời
  }
}, { noAck: false });
```

Và một chi tiết vận hành: **prefetch**.

```ts
await channel.prefetch(10);   // mỗi consumer giữ tối đa 10 tin chưa ack
```

Không giới hạn prefetch, một consumer có thể nhận hàng nghìn tin nhắn vào bộ nhớ, và khi nó chết thì tất cả phải được giao lại — tạo ra một đợt xử lý trùng lớn.

### Visibility timeout / lock duration

```text
Consumer nhận job → broker ẩn job trong N giây
  · xong trước N giây, ack  → job biến mất
  · KHÔNG ack trong N giây  → job hiện lại → consumer khác nhận

⇒ Nếu job chạy LÂU HƠN N, nó sẽ chạy SONG SONG với chính nó.
```

Đây là nguyên nhân phổ biến nhất của "job chạy hai lần" ngoài crash:

```text
SQS:      visibility timeout (mặc định 30 giây)
BullMQ:   lockDuration (mặc định 30 giây), gia hạn tự động bằng heartbeat
RabbitMQ: consumer_timeout (mặc định 30 phút ở phiên bản mới)
Kafka:    max.poll.interval.ms (mặc định 5 phút)
```

Hai cách xử lý job dài: đặt timeout đủ lớn, hoặc gia hạn định kỳ trong lúc chạy (heartbeat). BullMQ làm cái thứ hai tự động miễn là event loop không bị chặn — nên một job CPU-nặng chặn event loop sẽ **mất lock** và bị chạy lại. Xem [Worker threads & CPU](../../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md).

### Thứ tự không được đảm bảo (mặc định)

```text
Gửi: A, B, C
Nhận: A, C, B   ← hoàn toàn hợp lệ với nhiều consumer

Nguyên nhân: nhiều consumer chạy song song; A retry sau khi B, C đã xong
```

Nếu logic của bạn phụ thuộc thứ tự (`created` phải trước `updated`), bạn cần thiết kế riêng. Xem [Ordering & partitioning](04-ordering-partitioning.md).

Cách né tránh tốt nhất: **thiết kế handler không phụ thuộc thứ tự.** Ví dụ, thay vì áp dụng delta, đọc trạng thái hiện tại từ DB và ghi trạng thái mong muốn.

## Example

Một consumer idempotent hoàn chỉnh, và mỗi dòng chống một failure mode:

```ts
@Processor('invoices')
export class InvoiceProcessor extends WorkerHost {
  async process(job: Job<{ orderId: string; v: number }>) {
    const { orderId, v } = job.data;
    if (v !== 1) throw new UnrecoverableError(`unsupported payload version ${v}`);

    return this.db.$transaction(async (tx) => {
      // ① khoá dòng — chống hai worker cùng xử lý một đơn
      const [order] = await tx.$queryRaw<Order[]>`
        SELECT * FROM orders WHERE id = ${orderId} FOR UPDATE`;

      if (!order) throw new UnrecoverableError('order deleted');   // vĩnh viễn → DLQ ngay
      if (order.invoiceId) return order.invoiceId;                 // ② đã làm rồi

      // ③ UNIQUE(order_id) là phòng tuyến cuối, đúng cả khi ① và ② hỏng
      const invoice = await tx.invoice.create({
        data: { orderId, amountCents: order.totalCents },
      });

      await tx.order.update({ where: { id: orderId }, data: { invoiceId: invoice.id } });

      // ④ side effect NGOÀI DB đi qua outbox — không gửi trực tiếp ở đây
      await tx.outbox.create({
        data: { type: 'invoice.email', payload: { invoiceId: invoice.id } },
      });

      return invoice.id;
    });
  }
}
```

Bốn lớp bảo vệ, và chúng bổ sung nhau:

```text
① FOR UPDATE          hai worker đồng thời → một chờ
② kiểm tra trạng thái → nhanh, rẻ, xử lý phần lớn trường hợp
③ UNIQUE constraint   → đúng ngay cả khi ① và ② có bug
④ outbox              → email không gửi trong transaction; không mất, không gửi ma
```

Điểm ④ đáng nhấn: nếu gửi email trực tiếp trong transaction và transaction rollback, email vẫn đã gửi — nói về một hoá đơn không tồn tại.

## Prediction

1. Broker quảng cáo "exactly-once" — bạn có được bỏ idempotency không?
2. Consumer ack **trước** khi xử lý, crash ngay sau ack — job thế nào?
3. Consumer ack **sau** khi xử lý, crash sau khi làm xong nhưng trước ack — job thế nào?
4. Job gửi email rồi ghi "đã gửi" vào DB, crash ở giữa — người dùng nhận mấy email?
5. Đảo thứ tự (ghi DB trước, gửi email sau), crash ở giữa — nhận mấy email?
6. `INSERT INTO processed(id)` và `doWork()` ở hai transaction khác nhau, crash ở giữa — hậu quả?
7. Cả hai trong một transaction, `doWork()` fail — bản ghi `processed` thế nào?
8. Visibility timeout 30 giây, job chạy 45 giây — bao nhiêu consumer xử lý job đó?
9. BullMQ job CPU-nặng chặn event loop 60 giây, `lockDuration` 30 giây — chuyện gì xảy ra?
10. `INSERT` vào PostgreSQL thành công, `publish` lên broker thất bại — hệ quả?
11. Prefetch không giới hạn, consumer nhận 5.000 tin rồi crash — bao nhiêu tin được giao lại?
12. Gửi A, B, C với 3 consumer song song — thứ tự xử lý có đảm bảo không?
13. Job dùng `INCREMENT count BY 1`, chạy hai lần — kết quả? Với `SET count = 5` thì sao?

<details>
<summary>Đáp án</summary>

1. **Không.** "Exactly-once" của broker chỉ áp dụng trong phạm vi của nó; mọi side effect ra ngoài vẫn có thể lặp.
2. **Mất** — broker coi như xong, không giao lại.
3. **Chạy lại** — broker không nhận ack. At-least-once.
4. **Hai** — email đã gửi lần đầu, job chạy lại gửi tiếp.
5. **Không email nào** ở lần đầu; và lần chạy lại thấy DB ghi "đã gửi" nên bỏ qua → **0 email**, hệ thống nghĩ đã gửi.
6. Nếu crash sau `INSERT` trước `doWork`: hệ thống nghĩ đã xử lý nhưng chưa làm gì → **mất việc vĩnh viễn**.
7. Rollback — bản ghi `processed` biến mất → job được thử lại. Đúng.
8. **Hai (hoặc hơn)** — job hiện lại ở giây 30 và consumer khác nhận trong khi consumer đầu vẫn đang chạy.
9. Heartbeat không chạy được (event loop bị chặn) → **mất lock** → job bị giao cho worker khác → chạy song song.
10. Đơn hàng tồn tại nhưng **không hệ thống nào biết** — không email, không kho, không analytics. Cần outbox.
11. **5.000** — và tất cả sẽ được xử lý lại, tạo một đợt trùng lớn.
12. **Không.** Thứ tự nhận không đảm bảo với nhiều consumer.
13. `INCREMENT`: count tăng 2 → **sai**. `SET count = 5`: vẫn là 5 → **idempotent tự nhiên**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Kill worker sau khi xử lý, trước ack (thêm `sleep` rồi `kill -9`) | Job chạy lại |
| Bỏ kiểm tra idempotency, lặp lại | Side effect trùng |
| Thêm `UNIQUE` constraint, lặp lại | Lần hai bị chặn ở DB |
| Đặt idempotency mark ở transaction riêng, kill giữa hai transaction | Mất việc hoặc làm trùng |
| Gộp vào một transaction, ném lỗi trong `doWork` | Mark biến mất, job thử lại |
| Visibility timeout 5 giây, job 20 giây, log timestamp mỗi worker | Chạy chồng nhau |
| Tăng timeout lên 60 giây, lặp lại | Không chồng |
| Job CPU-nặng (vòng lặp bận) 60 giây với `lockDuration` 30 giây | Mất lock, chạy lại |
| Chuyển job đó sang worker thread, lặp lại | Heartbeat chạy, giữ được lock |
| `INSERT` DB rồi làm `publish` thất bại (tắt broker) | Đơn hàng mồ côi |
| Thêm outbox, lặp lại | Sự kiện được phát lại sau |
| Prefetch không giới hạn vs prefetch 10, kill worker | So số tin được giao lại |
| Gửi 100 tin có thứ tự với 5 consumer, log thứ tự xử lý | Không theo thứ tự |
| Handler dùng `INCREMENT` vs `SET`, chạy job hai lần | Sai vs đúng |

## What Usually Goes Wrong

- **Tin vào "exactly-once" của broker** → không viết idempotency → dữ liệu trùng.
- **Ack trước khi xử lý** → mất job im lặng.
- **Idempotency mark ở transaction riêng** → mất việc hoặc làm trùng.
- **Side effect ngoài DB không có idempotency key** → email/thanh toán trùng.
- **Visibility timeout ngắn hơn thời gian chạy** → chạy song song, và không ai biết.
- **Job CPU-nặng chặn event loop** → mất lock dù timeout đủ lớn.
- **Không có outbox** → sự kiện mất khi `publish` fail sau khi `INSERT` thành công.
- **Prefetch không giới hạn** → một crash tạo đợt xử lý trùng lớn.
- **Giả định thứ tự** → xử lý `updated` trước `created`.
- **Dùng thao tác cộng dồn** (`INCREMENT`) thay vì gán → không idempotent.
- **Không dọn bảng idempotency key** → bảng phình vô hạn.
- **Không test idempotency** → nó "đúng trên giấy" cho tới sự cố đầu tiên.
- **Requeue mọi lỗi** → lỗi vĩnh viễn quay vòng mãi mãi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Exactly-once tồn tại | Không ở tầng vận chuyển; chỉ ở tầng hiệu ứng |
| Kafka exactly-once nghĩa là an toàn tuyệt đối | Chỉ trong phạm vi Kafka; side effect ra ngoài thì không |
| At-least-once là cấu hình kém | Đó là lựa chọn đúng cho gần như mọi hệ thống |
| Job chỉ chạy lại khi có lỗi | Nó chạy lại cả khi thành công mà ack không tới |
| Idempotency là "kiểm tra rồi bỏ qua" | Phải nguyên tử với công việc, nếu không có khe hở |
| Broker đảm bảo thứ tự | Không, với nhiều consumer |
| Ack tự động tiện hơn | Nó biến hệ thống thành at-most-once |
| Visibility timeout chỉ là chi tiết cấu hình | Nó quyết định job có chạy song song hay không |
| Có `UNIQUE` constraint là đủ | Đủ cho ghi DB; không đủ cho email/HTTP |
| Test happy path là đủ | Phải test "chạy hai lần" một cách tường minh |

## Debugging

1. **Nghi job chạy nhiều lần** → log `jobId`, `attemptsMade`, `workerId`, `startedAt` cho mọi job. Không có dữ liệu này thì không chẩn đoán được.
2. **`attemptsMade = 1` mà vẫn chạy lại** → không phải retry. Nghi: visibility timeout hết, hoặc producer enqueue trùng.
3. **Tính khoảng thời gian giữa hai lần chạy** — nếu nó xấp xỉ visibility timeout, bạn đã tìm ra nguyên nhân.
4. **Nghi mất tin nhắn** → đếm ở ba chỗ: producer gửi, broker nhận, consumer xử lý. Chênh lệch ở đâu chỉ ra chỗ mất.
5. **Kiểm tra publisher confirm** — producer có xác nhận broker đã nhận không, hay chỉ "gửi rồi quên"?
6. **Test idempotency tường minh**:
   ```ts
   it('chạy hai lần cho cùng kết quả', async () => {
     await processor.process(job);
     const after1 = await snapshot();
     await processor.process(job);              // chạy lại
     expect(await snapshot()).toEqual(after1);
   });
   ```
   Test này bắt được lớp bug đắt nhất trong note, và nó tốn 5 dòng.
7. **Job CPU-nặng mất lock** → đo event loop lag của worker. Nếu lag cao, heartbeat không chạy được.

## Production Considerations

- **Giả định at-least-once, luôn luôn.** Mọi consumer phải idempotent, không có ngoại lệ.
- **Idempotency phải nguyên tử với công việc** — cùng transaction, hoặc dựa trên `UNIQUE` constraint.
- **Dùng idempotency key của nhà cung cấp** cho mọi API bên ngoài có hỗ trợ. Với thanh toán, đây là bắt buộc.
- **Visibility timeout > p99 thời gian chạy**, cộng cơ chế gia hạn cho job dài.
- **Giới hạn prefetch** — nó là bộ đệm trong bộ nhớ, và nó nhân lên khi crash.
- **Publisher confirm** để biết broker đã nhận. Không có nó, "đã gửi" chỉ nghĩa là "đã ghi vào socket".
- **Outbox cho mọi sự kiện quan trọng** — nó đóng khe hở giữa ghi DB và publish.
- **Test idempotency trong CI** — chạy job hai lần và khẳng định trạng thái không đổi.
- **Log đủ để lần theo**: `messageId`, `jobId`, `attempt`, `workerId`, `correlationId`.
- **Dọn bảng idempotency key** theo TTL (ví dụ 30 ngày) — nó tăng vô hạn nếu không.
- **Ghi rõ trong tài liệu mỗi job**: idempotent bằng cách nào, chạy hai lần thì sao. Người trực sự cố cần biết điều này.
- **Với side effect không thể idempotent**, quyết định tường minh: thà trùng hay thà mất — và ghi lại quyết định đó.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| At-most-once | không bao giờ trùng, nhanh | mất tin nhắn |
| At-least-once | không mất | phải xây idempotency |
| Ack sớm | consumer nhanh hơn | mất khi crash |
| Ack muộn | không mất | có thể trùng |
| Idempotency bằng `UNIQUE` | DB ép, đúng dưới concurrency | chỉ cho ghi DB |
| Idempotency bằng bảng key | tổng quát | thêm bảng, cần dọn |
| Idempotency bằng kiểm tra trạng thái | đơn giản | có khe hở nếu không nguyên tử |
| Visibility timeout dài | job dài an toàn | job của worker chết bị kẹt lâu |
| Visibility timeout ngắn | phục hồi nhanh khi worker chết | job dài chạy song song |
| Prefetch cao | throughput cao | đợt trùng lớn khi crash |
| Prefetch thấp | ít trùng khi crash | throughput thấp hơn |
| Outbox | không mất, không sự kiện ma | thêm bảng, thêm worker, độ trễ |
| Publish trực tiếp | đơn giản, nhanh | mất sự kiện hoặc sự kiện ma |

## Explain Without Notes

1. Vì sao exactly-once không tồn tại ở tầng vận chuyển? Giải thích bằng vấn đề ack.
2. Hai lựa chọn ở tầng vận chuyển, và mỗi cái đánh đổi gì?
3. "Exactly-once effect" đạt được thế nào?
4. Bốn cách làm job idempotent, xếp theo độ mạnh?
5. Vì sao idempotency mark phải nguyên tử với công việc? Kể chuỗi sự kiện nếu không.
6. Ba chỗ tin nhắn có thể mất, và cách chống ở mỗi chỗ?
7. Visibility timeout ngắn hơn thời gian chạy gây chuyện gì?
8. Vì sao job CPU-nặng có thể mất lock dù timeout đủ lớn?

## Related

- [Vì sao cần queue](01-why-queue.md) — nền tảng
- [Retry & DLQ](03-retry-dlq.md) — phân loại lỗi, backoff
- [Ordering & partitioning](04-ordering-partitioning.md) — khi thứ tự quan trọng
- [Outbox pattern](06-outbox-pattern.md) — đóng khe hở producer → broker
- [Broker comparison](05-broker-comparison.md) — mỗi broker đảm bảo gì
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — cùng nguyên lý ở tầng hệ thống
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — idempotency ở tầng HTTP
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — nguyên tử với ghi DB
- [Worker threads & CPU](../../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) — vì sao job CPU mất lock
- [Constraints & invariants](../03-data-modeling/01-constraints-invariants.md) — `UNIQUE` làm phòng tuyến cuối

## Version / Context

Khái niệm áp dụng cho mọi hệ thống queue. Số liệu mặc định: SQS visibility timeout 30 giây; BullMQ `lockDuration` 30 giây; Kafka `max.poll.interval.ms` 5 phút; RabbitMQ `consumer_timeout` 30 phút (từ 3.8.15). Kafka transaction cho exactly-once trong phạm vi Kafka từ 0.11.
