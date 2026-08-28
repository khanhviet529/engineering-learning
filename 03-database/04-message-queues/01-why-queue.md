---
level: intermediate
area: database
prerequisites:
  - ../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md
related:
  - 02-delivery-semantics.md
  - 05-broker-comparison.md
  - ../../02-backend-api/02-nestjs/07-caching-queues-jobs.md
---

# Vì sao cần queue

> Endpoint `POST /orders` mất 4 giây: ghi DB (20ms), gọi cổng thanh toán (1,2s), gửi email xác nhận (800ms), đồng bộ sang ERP (1,5s), tạo PDF hoá đơn (400ms). Vào ngày cao điểm, cổng thanh toán chậm lại 8 giây. Không chỉ `POST /orders` chết — **mọi endpoint** đều chậm, kể cả `GET /health`. Vấn đề không phải một dependency chậm. Vấn đề là bạn để một dependency chậm giữ tài nguyên dùng chung.

## Position

```text
Request ──▶ API ──▶ [việc PHẢI làm ngay] ──▶ response (nhanh)
                │
                └──▶ QUEUE ──▶ Worker ──▶ [việc có thể làm sau]
                                              email · PDF · ERP · webhook
```

## Problem

### Xử lý đồng bộ giữ tài nguyên dùng chung

Một request HTTP đang chạy giữ: một connection từ client, một socket, một chỗ trong connection pool nếu nó đang query, và bộ nhớ cho state của nó.

```text
4 giây × 50 request đồng thời với pool 20
→ pool cạn
→ request thứ 21 chờ
→ mọi endpoint chậm, kể cả những cái không liên quan
→ health check timeout → orchestrator restart pod → tệ hơn
```

Đây là tính chất khó chấp nhận nhưng đúng:

> **Latency của endpoint chậm nhất quyết định capacity của toàn bộ service**, nếu chúng dùng chung pool.

### Ba vấn đề nữa mà xử lý đồng bộ không giải được

```text
② Không retry được
   Email fail ở giây thứ 3 → cả request fail → nhưng đơn hàng ĐÃ tạo
   → dữ liệu nửa vời, và không có gì thử lại

③ Đỉnh tải làm sập hệ thống
   Flash sale: 10.000 đơn/phút. Hệ thống xử lý được 200/phút.
   Không có bộ đệm ⇒ 9.800 request lỗi.

④ Không cô lập lỗi
   ERP chết → mọi đơn hàng fail, dù việc tạo đơn không cần ERP
```

Queue giải quyết cả bốn bằng cùng một cơ chế: **tách thời điểm nhận việc khỏi thời điểm làm việc.**

## Mental Model

### Queue là một bộ đệm có ba tính chất

```text
Producer ──▶ [ QUEUE ] ──▶ Consumer
              │
              ├─ BỀN VỮNG      job sống qua restart của producer và consumer
              ├─ BỘ ĐỆM        tốc độ vào ≠ tốc độ ra
              └─ RETRY         thất bại không mất việc
```

### Câu hỏi phân loại

```text
"Nếu việc này hoàn tất sau 30 giây thay vì ngay lập tức,
 người dùng có bị CHẶN không?"

KHÔNG → queue
CÓ    → đồng bộ
```

Áp dụng vào ví dụ mở đầu:

```text
ĐỒNG BỘ (người dùng cần kết quả để đi tiếp)
  · validate input
  · ghi đơn hàng vào DB
  · xác thực (authorize) thanh toán   ← cần biết thẻ có hợp lệ không

QUEUE (kết quả không thay đổi màn hình kế tiếp)
  · gửi email xác nhận
  · tạo PDF hoá đơn
  · đồng bộ sang ERP
  · gửi webhook cho đối tác
  · cập nhật chỉ số analytics
```

Kết quả: 4 giây → khoảng 1,3 giây. Và quan trọng hơn con số: ERP chết không còn làm đơn hàng thất bại.

### Backpressure: queue không phải phép màu

```text
Tốc độ VÀO > tốc độ RA, kéo dài
→ hàng đợi dài vô hạn
→ job chờ 6 giờ mới được xử lý
→ Redis/broker hết bộ nhớ
```

Queue **hoãn** vấn đề capacity, nó không xoá vấn đề đó. Nếu bạn nhận 1.000 job/phút và xử lý được 200 job/phút, queue chỉ làm cho việc sụp đổ diễn ra chậm hơn và khó thấy hơn.

Vì thế **tuổi của job cũ nhất** là metric quan trọng hơn độ dài hàng đợi:

```text
Độ dài hàng đợi = 50.000, tuổi job cũ nhất = 10 giây  → ổn, đang xử lý nhanh
Độ dài hàng đợi = 200,    tuổi job cũ nhất = 2 giờ    → worker CHẾT
```

Xem [Backpressure](../../05-cross-cutting/performance/06-backpressure.md).

### Cái giá của queue

Đây là phần thường bị bỏ qua khi người ta khuyên "cứ đưa vào queue":

```text
+ API nhanh, cô lập lỗi, retry, chịu được đỉnh tải, scale riêng

- Trải nghiệm bất đồng bộ: client phải hỏi trạng thái hoặc chờ thông báo
- Job PHẢI idempotent (at-least-once) — đây là công việc thật, không tự có
- Thêm một hệ thống có thể chết (broker)
- Debug khó hơn: lỗi xảy ra ở nơi khác, lúc khác
- Cần quan sát: DLQ, lag, tỉ lệ thất bại — không có thì job chết im lặng
- Payload phải version hoá: job cũ trong hàng đợi gặp code mới
```

Với một hệ thống nhỏ và một dependency đủ nhanh, **xử lý đồng bộ là lựa chọn đúng**. Queue là công cụ cho vấn đề cụ thể, không phải kiến trúc mặc định.

### Bốn mẫu, bốn mục đích khác nhau

```text
① WORK QUEUE     một job → một consumer xử lý
                 "gửi email này", "tạo PDF này"
                 → BullMQ, SQS, RabbitMQ

② PUB/SUB        một sự kiện → nhiều consumer, mỗi bên xử lý theo cách của mình
                 "order.created" → email + kho + analytics
                 → Kafka, RabbitMQ fanout, Redis Streams (nhiều group)

③ SCHEDULED      chạy vào lúc nào đó / lặp lại
                 "gửi nhắc nhở sau 24 giờ"
                 → BullMQ delayed jobs, K8s CronJob

④ STREAM         log sự kiện có thứ tự, phát lại được
                 event sourcing, pipeline dữ liệu
                 → Kafka, Redis Streams
```

Nhầm ① với ② là lỗi thiết kế phổ biến: nếu ba hệ thống cần biết về `order.created` và bạn dùng work queue, chỉ một trong ba nhận được.

## How It Works

### Vòng đời một job

```text
enqueue ──▶ WAITING ──▶ ACTIVE ──┬──▶ COMPLETED
                          ▲       │
                          │       ├──▶ FAILED ──▶ retry (backoff) ──▶ WAITING
                          │       │                  │
                          │       │                  └── hết attempts ──▶ DLQ
                          │       └──▶ (worker crash, không ack)
                          └────────────── stalled: được nhận lại sau timeout
```

Trạng thái `stalled` đáng chú ý: worker nhận job rồi chết trước khi báo kết quả. Broker phải phát hiện (bằng timeout/heartbeat) và giao lại cho worker khác — và đó chính là lý do job có thể chạy hai lần.

### Việc gì nên vào queue

```text
CHẮC CHẮN                              CHẮC CHẮN KHÔNG
gửi email / SMS / push                  validate input
tạo file (PDF, CSV, ảnh thumbnail)      ghi dữ liệu người dùng vừa nhập
gọi API bên thứ ba chậm                 kiểm tra quyền
đồng bộ sang hệ thống ngoài             đọc dữ liệu để hiển thị
xử lý ảnh/video                         bất cứ gì màn hình kế tiếp cần
tính toán nặng, báo cáo lớn
gửi webhook
cập nhật chỉ số, index tìm kiếm
dọn dẹp định kỳ
```

Một trường hợp ở giữa đáng bàn: **thanh toán**. Xác thực (authorize) thường phải đồng bộ — người dùng cần biết thẻ có hợp lệ không. Nhưng ghi nhận (capture), gửi biên lai, đối soát thì nên bất đồng bộ.

### Bốn tính chất bắt buộc của một job

```text
① IDEMPOTENT    chạy 2 lần = chạy 1 lần
                Không phải tuỳ chọn — mọi hệ thống queue thực tế là at-least-once.

② NHỎ           chia được, có checkpoint
                Job 30 phút không sống qua nổi một lần deploy.

③ PAYLOAD NHỎ   truyền ID, không truyền object
                Worker tự đọc dữ liệu mới nhất từ DB.

④ CÓ VERSION    job cũ trong hàng đợi gặp code mới khi deploy
```

Về ③, có một lý do quan trọng ngoài kích thước:

```text
Payload chứa dữ liệu → job xử lý dữ liệu CŨ (lúc enqueue)
Payload chứa ID      → job đọc dữ liệu MỚI NHẤT

Với "gửi email xác nhận đơn hàng", nếu đơn bị huỷ giữa lúc chờ,
job nên biết điều đó — và nó chỉ biết nếu nó đọc lại từ DB.
```

### Idempotency: hai tầng

```ts
// TẦNG 1 — producer: jobId ổn định chống enqueue trùng
await queue.add('send-invoice', { orderId }, { jobId: `invoice:${orderId}` });
```

```ts
// TẦNG 2 — consumer: kiểm tra trạng thái ở đầu. Đây là tầng THẬT SỰ bảo vệ.
async process(job: Job<{ orderId: string }>) {
  const order = await this.repo.findById(job.data.orderId);
  if (!order) throw new UnrecoverableError('order deleted');   // KHÔNG retry
  if (order.invoiceSentAt) return;                              // đã làm rồi

  const url = await this.pdf.generate(order);
  await this.repo.markInvoiceSent(order.id, url);               // ghi nhận ĐÃ làm
  await this.mailer.send(order.email, url);
}
```

Tầng 1 chống người dùng bấm nút hai lần. Tầng 2 chống worker crash sau khi làm xong nhưng trước khi ack — và đó là tình huống mà tầng 1 không cứu được.

Vẫn còn một khe hở ở tầng 2: giữa `markInvoiceSent` và `mailer.send`. Nếu crash ở giữa, email không được gửi nhưng hệ thống nghĩ đã gửi. Đảo thứ tự thì có thể gửi hai lần. **Không có thứ tự nào hoàn hảo** — bạn chọn giữa "có thể gửi trùng" và "có thể không gửi", và với email thì gửi trùng thường ít tệ hơn. Xem [Delivery semantics](02-delivery-semantics.md).

### Ba mô hình triển khai worker

```text
A. Cùng process với API
   + đơn giản nhất, một deployment
   - job CPU-nặng chặn event loop của API → health check timeout
   - scale chung: muốn thêm worker phải thêm cả API

B. Process riêng, cùng codebase                    ← mặc định nên chọn
   + tách tài nguyên, scale riêng, dùng chung model/service
   - hai deployment, hai bộ cấu hình

C. Service riêng
   + độc lập hoàn toàn, ngôn ngữ khác được
   - trùng lặp code, phải version hoá hợp đồng payload
```

Với B, bootstrap khác nhau nhưng chung code:

```ts
// worker.ts
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
// không có app.listen()
```

### Chọn công nghệ

```text
KHÔNG CẦN BROKER RIÊNG
  PostgreSQL + SELECT ... FOR UPDATE SKIP LOCKED
  + không thêm hệ thống; job nguyên tử với dữ liệu nghiệp vụ (cùng transaction!)
  - throughput giới hạn (~vài nghìn/giây), không có sẵn retry/DLQ/UI

ĐÃ CÓ REDIS
  BullMQ
  + retry, backoff, delayed job, repeatable job, UI, DLQ
  - durability = cấu hình Redis (xem Persistence)

CẦN DURABILITY VÀ ĐỘ TIN CẬY CAO
  RabbitMQ / SQS
  + bền vững, routing linh hoạt, hệ sinh thái trưởng thành

CẦN PHÁT LẠI, THỨ TỰ, THÔNG LƯỢNG RẤT CAO
  Kafka
  + log giữ lâu, replay, nhiều consumer group độc lập
  - vận hành nặng
```

Điểm về PostgreSQL đáng nhấn mạnh vì nó bị đánh giá thấp: nếu bạn đã có PostgreSQL và throughput vừa phải, một bảng `jobs` với `SKIP LOCKED` cho bạn một tính chất mà **không** broker nào có được — job được enqueue trong **cùng transaction** với dữ liệu nghiệp vụ, nên không bao giờ có job mồ côi hay sự kiện mất. Đó chính là outbox pattern ở dạng đơn giản nhất. Xem [Locking & deadlock](../01-postgresql/05-locking-deadlock.md) và [Broker comparison](05-broker-comparison.md).

## Example

Chuyển endpoint 4 giây thành 1,3 giây:

```ts
// TRƯỚC — mọi thứ đồng bộ
@Post('orders')
async create(@Body() dto: CreateOrderDto) {
  const order = await this.orders.create(dto);      //   20 ms
  await this.payments.authorize(order);             // 1200 ms
  await this.mailer.sendConfirmation(order);        //  800 ms
  await this.erp.sync(order);                       // 1500 ms
  await this.pdf.generateInvoice(order);            //  400 ms
  return order;                                      // ≈ 3920 ms
}
```

```ts
// SAU — chỉ giữ lại việc người dùng cần
@Post('orders')
async create(@Body() dto: CreateOrderDto) {
  const auth  = await this.payments.authorize(dto);            // 1200 ms — PHẢI đồng bộ
  const order = await this.orders.create(dto, auth.id);        //   20 ms

  // enqueue trong CÙNG transaction với việc tạo đơn (outbox) — không mất, không mồ côi
  await this.outbox.enqueue([
    { type: 'order.confirm-email', orderId: order.id },
    { type: 'order.erp-sync',      orderId: order.id },
    { type: 'order.invoice-pdf',   orderId: order.id },
  ]);

  return { ...order, status: 'processing' };                    // ≈ 1250 ms
}
```

Cái được không chỉ là 2,7 giây:

```text
✓ ERP chết → đơn hàng vẫn tạo được, job retry sau
✓ Email fail → retry tự động, không mất
✓ Đỉnh tải → hàng đợi hấp thụ thay vì lỗi
✓ Scale worker theo độ dài hàng đợi, độc lập với API
```

Cái mất:

```text
✗ Client phải xử lý trạng thái "processing"
✗ Ba job phải idempotent
✗ Cần theo dõi DLQ, lag, tỉ lệ thất bại
✗ Cần bảng outbox + worker phát tán
```

## Prediction

1. Endpoint đồng bộ 4 giây, 50 request đồng thời, pool 20 — request thứ 21 chờ bao lâu?
2. Trong lúc đó, `GET /health` (không chạm DB) thế nào?
3. ERP chết, xử lý đồng bộ — đơn hàng có tạo được không?
4. ERP chết, xử lý qua queue — đơn hàng có tạo được không? Job thế nào?
5. Tốc độ vào 1.000 job/phút, tốc độ ra 200 job/phút, chạy 1 giờ — hàng đợi dài bao nhiêu?
6. Độ dài hàng đợi 200 nhưng tuổi job cũ nhất là 2 giờ — chẩn đoán gì?
7. Job không idempotent, worker crash sau khi gửi email nhưng trước khi ack — người dùng nhận mấy email?
8. Job có `jobId` ổn định nhưng consumer không kiểm tra trạng thái, cùng tình huống — mấy email?
9. Payload chứa toàn bộ object đơn hàng, đơn bị huỷ trong lúc job chờ — job làm gì?
10. Payload chỉ chứa `orderId` — job làm gì?
11. Worker cùng process API, job dùng 100% CPU 5 giây — health check thế nào?
12. Deploy code mới, hàng đợi còn 5.000 job payload định dạng cũ — chuyện gì xảy ra?
13. Enqueue job trong transaction rồi transaction rollback — job thế nào?

<details>
<summary>Đáp án</summary>

1. Chờ tới khi một connection được trả lại — với mỗi request giữ 4 giây, đó là hàng giây, rồi timeout.
2. Nếu nó không cần connection thì vẫn nhanh; nhưng nếu event loop bị chặn hoặc nó cũng ping DB, nó chậm/timeout → orchestrator restart pod.
3. **Không** — cả request fail, dù việc tạo đơn không cần ERP.
4. **Có.** Job `erp-sync` fail và retry theo backoff; các job khác không bị ảnh hưởng.
5. 800 job/phút × 60 = **48.000 job** tồn đọng, và tăng tuyến tính.
6. Worker **chết** hoặc bị kẹt — hàng đợi ngắn nhưng không ai xử lý. Đây là lý do tuổi job quan trọng hơn độ dài.
7. **Hai** — job được giao lại và chạy lại từ đầu.
8. **Hai** — `jobId` chỉ chống enqueue trùng, không chống retry sau crash.
9. Gửi email về một đơn hàng **đã bị huỷ** — dữ liệu trong payload đã cũ.
10. Đọc DB, thấy đơn đã huỷ, bỏ qua. Đây là lý do truyền ID.
11. Event loop bị chặn → health check timeout → pod bị restart → job bị giết → retry → lặp lại.
12. Code mới có thể không đọc được payload cũ → 5.000 job vào DLQ. Đây là lý do version hoá payload.
13. Nếu enqueue vào Redis: **job vẫn tồn tại** và sẽ xử lý một bản ghi không có thật. Nếu enqueue vào bảng outbox trong cùng transaction: job cũng rollback — đúng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Endpoint đồng bộ 4 giây, chạy load test 100 luồng | Đo p95 của **mọi** endpoint khác |
| Chuyển việc chậm sang queue, lặp lại | So sánh |
| Tắt ERP, gọi endpoint đồng bộ | Đơn hàng fail |
| Tắt ERP, gọi endpoint có queue | Đơn hàng thành công; job pending |
| Đẩy 100.000 job, chỉ chạy 1 worker | Đo tuổi job cũ nhất theo thời gian |
| Kill worker giữa chừng, đếm job chạy lại | At-least-once |
| Bỏ kiểm tra trạng thái ở đầu `process`, kill sau khi gửi email | Email trùng |
| Thêm kiểm tra, lặp lại | Không trùng |
| Payload chứa object, sửa dữ liệu gốc trong lúc job chờ | Job dùng dữ liệu cũ |
| Payload chứa ID, lặp lại | Job dùng dữ liệu mới |
| Worker cùng process API, job CPU 5s, ping `/health` song song | Timeout |
| Tách worker riêng, lặp lại | API không ảnh hưởng |
| Enqueue Redis trong transaction rồi rollback | Job mồ côi |
| Dùng bảng outbox, lặp lại | Job cũng rollback |
| Đổi định dạng payload rồi deploy khi hàng đợi còn job cũ | Job cũ fail |

## What Usually Goes Wrong

- **Đưa việc cần kết quả ngay vào queue** → trải nghiệm tệ, client phải polling vô nghĩa.
- **Không đưa việc chậm vào queue** → một dependency chậm làm chết cả service.
- **Job không idempotent** → email trùng, tiền trừ hai lần, file trùng.
- **Payload chứa dữ liệu thay vì ID** → xử lý dữ liệu cũ.
- **Payload quá lớn** → broker phình, khó debug.
- **Không version hoá payload** → job cũ vỡ khi deploy.
- **Job quá dài** → không sống qua nổi một lần deploy.
- **Worker cùng process API** → job CPU làm chết health check.
- **Không đo tuổi job cũ nhất** → worker chết mà không ai biết.
- **Không có DLQ hoặc không ai nhìn DLQ** → job chết im lặng.
- **Enqueue ngoài transaction** → job mồ côi khi rollback, hoặc mất job khi crash.
- **Tin rằng queue giải quyết vấn đề capacity** → nó chỉ hoãn.
- **Retry vô hạn lỗi vĩnh viễn** → log nhiễu, tài nguyên lãng phí.
- **Dùng work queue khi cần pub/sub** → chỉ một trong ba hệ thống nhận sự kiện.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Queue làm hệ thống nhanh hơn | Nó làm **request** nhanh hơn; tổng công việc không đổi |
| Queue giải quyết vấn đề capacity | Nó hoãn; vào > ra kéo dài thì vẫn sụp |
| Queue đảm bảo exactly-once | At-least-once; exactly-once do consumer tạo ra |
| Có queue thì không mất việc | Chỉ khi broker bền vững **và** enqueue nguyên tử với ghi DB |
| Cứ việc gì chậm thì đưa vào queue | Việc mà người dùng cần kết quả thì không |
| Cần Kafka cho mọi hệ thống có queue | PostgreSQL `SKIP LOCKED` đủ cho rất nhiều trường hợp |
| Độ dài hàng đợi là metric quan trọng nhất | Tuổi job cũ nhất quan trọng hơn |
| Job fail thì sẽ có người biết | Chỉ khi có alert trên DLQ |
| Worker cùng process là tiết kiệm | Đúng về hạ tầng, sai về cô lập lỗi |
| Thêm worker luôn tăng throughput | Không, nếu nút thắt là DB hoặc API bên thứ ba |

## Debugging

1. **Job không chạy** — theo thứ tự: worker có sống không → có kết nối broker không → **tên queue ở producer và consumer có giống hệt nhau không** (gõ sai là im lặng tuyệt đối) → job có trong `waiting` không.
2. **Đo bốn metric**: độ dài hàng đợi, **tuổi job cũ nhất**, tỉ lệ thất bại, thời gian xử lý p95.
3. **Job chạy nhiều lần** → xem `attemptsMade`. Nếu là 1 mà vẫn chạy lại → worker crash trước ack, hoặc producer enqueue trùng.
4. **Hàng đợi dài dần** → vào > ra. Tăng worker, tăng concurrency, hay tối ưu job? Câu trả lời phụ thuộc job là CPU-bound hay I/O-bound.
5. **Thêm worker mà không nhanh hơn** → nút thắt ở nơi khác (DB, API bên thứ ba, rate limit của họ).
6. **Job vào DLQ** → đọc lỗi. Tạm thời hay vĩnh viễn? Nếu vĩnh viễn, vì sao nó được retry 5 lần?
7. **Job xử lý dữ liệu sai** → payload chứa gì? Nếu chứa dữ liệu, đó là dữ liệu lúc enqueue.

## Production Considerations

- **Tách worker khỏi API** trước khi bạn *cần* — chuyển sau tốn nhiều công hơn.
- **Bốn metric tối thiểu**, và **tuổi job cũ nhất** là cái quan trọng nhất: nó phát hiện worker chết trong khi độ dài hàng đợi có thể vẫn nhỏ.
- **Alert trên DLQ.** DLQ không có alert là một thư mục rác.
- **Autoscale worker theo độ dài hàng đợi**, không theo CPU (KEDA làm việc này). Worker I/O-bound có CPU thấp trong khi hàng đợi dài.
- **Giới hạn kích thước payload** và chỉ truyền ID.
- **Version hoá payload** ngay từ job đầu tiên — thêm một trường `v`.
- **Job phải idempotent**, và điều đó phải được **test**: chạy cùng job hai lần trong test tích hợp và khẳng định trạng thái không đổi.
- **Enqueue nguyên tử với ghi DB** cho việc quan trọng — dùng outbox. Xem [Outbox pattern](06-outbox-pattern.md).
- **Graceful shutdown cho worker**: ngừng nhận job mới, chờ job hiện tại xong, rồi mới đóng DB/Redis. Xem [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md).
- **Job dài phải có checkpoint** — nó sẽ bị cắt giữa chừng khi deploy.
- **Giới hạn tài nguyên riêng cho worker** (CPU/memory), khác với API.
- **Ghi lại danh sách job**: tên, ý nghĩa, idempotent bằng cách nào, hành vi khi fail. Đây là tài liệu vận hành thật.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Xử lý đồng bộ | đơn giản, kết quả ngay, dễ debug | giữ tài nguyên, không retry, không cô lập |
| Queue | nhanh, chịu lỗi, co giãn | phức tạp, cần idempotency và quan sát |
| Worker cùng process | một deployment | không cô lập tài nguyên |
| Worker riêng | cô lập, scale riêng | hai deployment |
| PostgreSQL `SKIP LOCKED` | nguyên tử với dữ liệu, không thêm hệ thống | throughput giới hạn, tự xây retry/DLQ |
| BullMQ (Redis) | đầy đủ tính năng, dễ dùng | durability = cấu hình Redis |
| RabbitMQ / SQS | bền vững, trưởng thành | thêm hệ thống phải vận hành |
| Kafka | replay, thứ tự, throughput rất cao | vận hành nặng, thừa cho hầu hết |
| Payload chứa dữ liệu | worker không cần đọc DB | dữ liệu cũ, payload lớn |
| Payload chứa ID | luôn mới nhất, nhỏ | thêm một lần đọc DB |
| Retry nhiều | chịu lỗi tạm thời tốt | khuếch đại tải khi downstream chết |
| Retry ít | không làm downstream tệ hơn | mất việc khi lỗi thoáng qua |

## Explain Without Notes

1. Vì sao một endpoint chậm làm chậm cả những endpoint không liên quan?
2. Câu hỏi phân loại việc đồng bộ vs queue?
3. Bốn vấn đề mà queue giải quyết, và bốn cái giá phải trả?
4. Vì sao "tuổi job cũ nhất" quan trọng hơn "độ dài hàng đợi"?
5. Vì sao mọi job phải idempotent, kể cả khi broker "đảm bảo" delivery?
6. Hai tầng idempotency, và tầng nào thật sự bảo vệ bạn?
7. Vì sao payload nên chứa ID thay vì dữ liệu? Cho một ví dụ cụ thể.
8. Khi nào PostgreSQL `SKIP LOCKED` là lựa chọn tốt hơn một broker?

## Related

- [Delivery semantics](02-delivery-semantics.md) — at-least-once, idempotency
- [Retry & DLQ](03-retry-dlq.md) — phân loại lỗi, backoff, poison message
- [Ordering & partitioning](04-ordering-partitioning.md) — khi thứ tự quan trọng
- [Broker comparison](05-broker-comparison.md) — chọn công nghệ
- [Outbox pattern](06-outbox-pattern.md) — enqueue nguyên tử với ghi DB
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — implementation
- [Locking & deadlock](../01-postgresql/05-locking-deadlock.md) — `SKIP LOCKED` làm hàng đợi
- [Node runtime & concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — vì sao job CPU chặn event loop
- [Backpressure](../../05-cross-cutting/performance/06-backpressure.md) — vào > ra
- [Autoscaling](../../04-infrastructure/04-kubernetes/09-autoscaling.md) — scale theo độ dài hàng đợi

## Version / Context

Ví dụ dùng BullMQ 5 trên Redis 7 và PostgreSQL 16. Các khái niệm áp dụng cho SQS, RabbitMQ, Kafka với tên gọi khác nhau.
