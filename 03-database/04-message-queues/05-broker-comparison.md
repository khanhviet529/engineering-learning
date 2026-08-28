---
level: intermediate
area: database
prerequisites:
  - 01-why-queue.md
  - 02-delivery-semantics.md
related:
  - 04-ordering-partitioning.md
  - ../02-redis/05-persistence-failure.md
---

# Chọn broker

> Team quyết định dùng Kafka. Sáu tháng sau: một cụm 3 node + ZooKeeper/KRaft phải vá và giám sát, không ai hiểu rõ `min.insync.replicas`, và khối lượng thật là **40 job mỗi phút** — thứ mà một bảng PostgreSQL xử lý được mà không ai để ý. Kafka không sai. Nó chỉ được chọn để trả lời một câu hỏi mà hệ thống này chưa bao giờ hỏi.

## Position

```text
Yêu cầu  →  CHỌN CÔNG CỤ  →  chi phí vận hành trong 3 năm tới
              ↑ note này
```

Note này không xếp hạng công nghệ. Nó liệt kê **câu hỏi cần trả lời trước**, rồi ánh xạ câu trả lời sang công cụ.

## Problem

"Chúng ta cần một message queue" không phải một yêu cầu — nó là một giải pháp cho một yêu cầu chưa được nói ra. Sáu câu hỏi phía dưới cho ra sáu câu trả lời khác nhau, và chúng dẫn tới các công cụ khác nhau.

Chọn sai theo hai hướng đều tốn:

```text
Chọn QUÁ MẠNH   → chi phí vận hành cho năng lực không dùng tới
                  (Kafka cho 40 job/phút)

Chọn QUÁ YẾU    → phát hiện giới hạn khi đã có dữ liệu và người dùng
                  (Redis cho dữ liệu tài chính không được mất)
```

Hướng thứ nhất tốn tiền và thời gian. Hướng thứ hai tốn dữ liệu.

## Mental Model

### Sáu câu hỏi, theo thứ tự

```text
① Mất một tin nhắn thì sao?
   không sao → công cụ nhẹ  |  mất tiền/dữ liệu → cần durability thật

② Cần PHÁT LẠI lịch sử không?
   không → queue  |  có → log (Kafka, Redis Streams)

③ Một sự kiện có nhiều bên tiêu thụ độc lập không?
   một → work queue  |  nhiều → pub/sub hoặc consumer group

④ Cần THỨ TỰ theo khoá không?
   không → bất kỳ  |  có → partition / FIFO group

⑤ Khối lượng thật là bao nhiêu?
   <1k/s → gần như mọi thứ  |  >100k/s → Kafka

⑥ Ai vận hành nó, và họ có bao nhiêu thời gian?
   ← câu hỏi quyết định nhất, và hay bị bỏ qua nhất
```

Câu ⑥ đáng đặt riêng: một công cụ mạnh mà không ai hiểu là một rủi ro, không phải một tài sản. Nếu team có hai người và không có ai chuyên về hạ tầng, dịch vụ managed hoặc PostgreSQL là lựa chọn đúng — kể cả khi trên giấy nó "kém hơn".

### Bảng so sánh

| | PostgreSQL | BullMQ (Redis) | RabbitMQ | SQS | Kafka |
|---|---|---|---|---|---|
| Thêm hệ thống mới | không | không (nếu có Redis) | có | không (managed) | có |
| Durability | rất cao | = cấu hình Redis | cao | rất cao | rất cao |
| Throughput | ~vài nghìn/s | ~10k/s | ~50k/s | rất cao | rất cao |
| Phát lại lịch sử | có (bảng) | không | không | không | **có** |
| Thứ tự theo khoá | tự làm | tự làm | qua plugin/queue riêng | FIFO group | **partition** |
| Retry / DLQ sẵn | tự làm | **có** | có (DLX) | có | tự làm |
| Delayed job | tự làm | **có** | qua plugin | có (≤15 phút) | tự làm |
| Nguyên tử với ghi DB | **CÓ** | không | không | không | không |
| Chi phí vận hành | ~0 | thấp | trung bình | ~0 (managed) | cao |
| UI/quan sát sẵn | tự làm | có (bull-board) | có | có | có (bên thứ ba) |

Dòng **"nguyên tử với ghi DB"** là dòng bị đánh giá thấp nhất. Chỉ PostgreSQL cho phép enqueue job **trong cùng transaction** với thay đổi dữ liệu nghiệp vụ. Với mọi công cụ khác, bạn cần outbox để đạt được điều đó. Xem [Outbox pattern](06-outbox-pattern.md).

## How It Works

### PostgreSQL: bị đánh giá thấp nhất

```sql
CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text        NOT NULL,
  payload       jsonb       NOT NULL,
  run_at        timestamptz NOT NULL DEFAULT now(),   -- delayed job
  attempts      int         NOT NULL DEFAULT 0,
  max_attempts  int         NOT NULL DEFAULT 5,
  locked_until  timestamptz,
  failed_at     timestamptz,
  last_error    text
);
CREATE INDEX ON jobs (run_at) WHERE failed_at IS NULL AND locked_until IS NULL;
```

```sql
-- nhiều worker lấy job mà không giẫm lên nhau, không ai chờ ai
WITH next AS (
  SELECT id FROM jobs
  WHERE failed_at IS NULL
    AND run_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs SET locked_until = now() + interval '5 minutes', attempts = attempts + 1
FROM next WHERE jobs.id = next.id
RETURNING jobs.*;
```

`SKIP LOCKED` là thứ làm điều này khả thi: worker không chờ nhau. Xem [Locking & deadlock](../01-postgresql/05-locking-deadlock.md).

Điều bạn nhận được và không công cụ nào khác cho:

```sql
BEGIN;
  INSERT INTO orders (...) VALUES (...);
  INSERT INTO jobs (type, payload) VALUES ('send-invoice', '{"orderId": 42}');
COMMIT;
-- HOẶC cả hai cùng tồn tại, HOẶC không cái nào. Không có job mồ côi, không mất sự kiện.
```

Điều bạn phải tự làm: backoff, DLQ, dọn job cũ, UI, và theo dõi. Khoảng 200 dòng code — và với nhiều hệ thống, đó là một đánh đổi tốt so với việc vận hành thêm một hệ thống.

Giới hạn: throughput vài nghìn job/giây, và job tạo tải ghi lên chính database nghiệp vụ (bloat từ `UPDATE` liên tục — cân nhắc `fillfactor` thấp). Xem [MVCC & vacuum](../01-postgresql/04-mvcc-vacuum.md).

### BullMQ: điểm ngọt cho Node.js

```ts
await queue.add('send-email', { orderId }, {
  jobId: `email:${orderId}`,                       // chống enqueue trùng
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  delay: 60_000,                                    // chạy sau 1 phút
  removeOnComplete: { age: 3600, count: 1000 },
});

await queue.add('daily-report', {}, {
  repeat: { pattern: '0 2 * * *' },                 // cron
});
```

Được gần như mọi thứ bạn cần cho work queue, không phải viết gì. Mất: **durability = cấu hình Redis**, nghĩa là mất tối đa ~1 giây với AOF `everysec`, và mất sạch nếu không có persistence. Xem [Persistence & failure](../02-redis/05-persistence-failure.md).

Ba lưu ý vận hành:

```text
· Redis của queue phải noeviction — nếu allkeys-lru, job bị EVICT
· Tách khỏi Redis cache
· Job dài chặn event loop → mất lock → chạy trùng (xem Delivery semantics)
```

### RabbitMQ: routing linh hoạt

```text
Publisher → EXCHANGE → (routing rules) → Queue A
                                       → Queue B
                                       → Queue C
```

Thế mạnh thật là routing: một sự kiện, nhiều queue theo quy tắc (`order.*.vn` → queue A, `order.created.*` → queue B). Nếu topology của bạn phức tạp, RabbitMQ diễn đạt được nó mà công cụ khác thì không.

Kèm theo: dead-letter exchange, TTL theo tin nhắn, priority queue, publisher confirm.

Chi phí: một cụm phải vận hành, và mô hình bộ nhớ/đĩa của nó có những cạm bẫy riêng (queue dài làm chậm cả broker).

### SQS: đơn giản nhất về vận hành

```text
Được:   không vận hành gì, gần như không giới hạn quy mô, DLQ sẵn, rất bền vững
Mất:    độ trễ cao hơn (long polling), phụ thuộc AWS,
        delay tối đa 15 phút, FIFO có giới hạn throughput theo group
```

Nếu bạn đã ở AWS và cần một work queue đáng tin cậy mà không muốn vận hành gì, SQS gần như luôn là lựa chọn đúng.

### Kafka: log, không phải queue

Đây là khác biệt khái niệm quan trọng nhất trong note:

```text
QUEUE: tin nhắn được TIÊU THỤ rồi biến mất
LOG:   sự kiện được GHI THÊM và GIỮ LẠI; consumer đọc theo offset của riêng nó
```

```text
Kafka topic:  [0][1][2][3][4][5][6][7][8][9]...
              consumer-group-A đọc tới offset 7
              consumer-group-B đọc tới offset 3   ← độc lập
              consumer-group-C (mới) bắt đầu từ 0 ← PHÁT LẠI toàn bộ lịch sử
```

Ba năng lực chỉ mô hình log mới có:

```text
① Phát lại: thêm consumer mới, xử lý lại toàn bộ lịch sử
② Nhiều consumer group hoàn toàn độc lập, không ảnh hưởng nhau
③ Thứ tự theo partition, được đảm bảo bởi thiết kế
```

Chi phí: một cụm phải vận hành, các khái niệm phải hiểu (partition, offset, consumer group, rebalance, `min.insync.replicas`, `acks`), và nó **không** cho bạn retry/DLQ/delayed job sẵn — bạn phải tự xây.

Chọn Kafka khi bạn cần ① hoặc ② hoặc thông lượng rất cao. Không chọn nó chỉ để "gửi email bất đồng bộ".

### Cây quyết định

```text
Cần PHÁT LẠI lịch sử hoặc nhiều consumer group độc lập?
├─ CÓ  → Kafka  (hoặc Redis Streams nếu khối lượng nhỏ và đã có Redis)
└─ KHÔNG
   │
   Throughput > ~5.000 job/giây?
   ├─ CÓ  → RabbitMQ / SQS / Kafka
   └─ KHÔNG
      │
      Mất một job có thể gây mất tiền/dữ liệu?
      ├─ CÓ  → PostgreSQL (nguyên tử với nghiệp vụ) hoặc SQS/RabbitMQ + outbox
      └─ KHÔNG
         │
         Đã có Redis và dùng Node.js?
         ├─ CÓ  → BullMQ
         └─ KHÔNG → PostgreSQL + SKIP LOCKED
```

### Đường di trú

Bắt đầu đơn giản không có nghĩa là bị kẹt:

```text
PostgreSQL → BullMQ        dễ: cùng mô hình work queue, đổi lớp enqueue/consume
BullMQ → SQS/RabbitMQ      trung bình: mất delayed/repeatable sẵn, phải xây lại
Bất kỳ → Kafka             KHÓ: mô hình khác hẳn (log vs queue), phải thiết kế lại
```

Vì thế, nếu bạn **biết chắc** sẽ cần phát lại và event sourcing, chọn Kafka từ đầu. Nếu không, bắt đầu ở mức đơn giản nhất đủ dùng.

Cách giữ tuỳ chọn mở: **đặt một lớp trừu tượng mỏng quanh enqueue/consume** — không phải để "đổi broker dễ dàng" (điều đó hiếm khi thành sự thật), mà để nơi gọi không rải rác API của broker khắp codebase.

## Example

Ba hệ thống thật, ba lựa chọn:

```text
① SaaS nội bộ, 50 người dùng, 200 job/ngày
   (gửi email, tạo báo cáo PDF)
   → PostgreSQL + SKIP LOCKED
   Vì sao: khối lượng nhỏ, đã có PostgreSQL, được tính nguyên tử miễn phí.
   Thêm Redis/Kafka ở đây là chi phí thuần.

② Thương mại điện tử, 5.000 đơn/ngày, Node.js, đã có Redis cho cache
   (email, PDF, đồng bộ ERP, webhook)
   → BullMQ (Redis RIÊNG, noeviction, AOF) + outbox ở PostgreSQL
   Vì sao: cần retry/backoff/delayed sẵn; outbox đóng khe hở enqueue.

③ Nền tảng dữ liệu, 200k sự kiện/giây, 6 team tiêu thụ độc lập,
   cần phát lại khi thêm tính năng mới
   → Kafka
   Vì sao: đây là ba năng lực chỉ Kafka có, và khối lượng biện minh cho chi phí.
```

Điểm chung của cả ba: **lựa chọn được suy ra từ yêu cầu**, không phải từ "công nghệ nào hiện đại".

Với ②, kiến trúc đầy đủ đáng ghi ra:

```text
POST /orders
  └─ transaction: INSERT orders + INSERT outbox
       └─ outbox worker: đọc outbox → queue.add() → UPDATE outbox.sent_at
            └─ BullMQ worker: xử lý, retry, DLQ
```

Nó dài hơn "gọi `queue.add()` trong controller", và nó là khác biệt giữa "thỉnh thoảng mất một đơn hàng" và "không bao giờ".

## Prediction

1. 40 job/phút, chọn Kafka — chi phí vận hành so với lợi ích?
2. Dữ liệu tài chính, dùng Redis không persistence, Redis crash — mất gì?
3. Cần phát lại lịch sử để xây một tính năng mới, dùng RabbitMQ — làm được không?
4. Cần thứ tự theo `userId`, dùng BullMQ — có sẵn không?
5. `INSERT` đơn hàng thành công, `queue.add()` thất bại — hệ quả? Công cụ nào tránh được?
6. Job enqueue trong PostgreSQL cùng transaction, transaction rollback — job thế nào?
7. Ba consumer group độc lập cần cùng một sự kiện, dùng work queue — mấy group nhận được?
8. BullMQ trên Redis cấu hình `allkeys-lru`, bộ nhớ đầy — job thế nào?
9. SQS, cần delay job 24 giờ — làm được không?
10. Kafka với 4 partition, cần 10 consumer song song — bao nhiêu làm việc?
11. PostgreSQL queue, 50.000 job/giây — chuyện gì xảy ra?
12. Team 2 người không có kinh nghiệm hạ tầng, chọn Kafka self-hosted — rủi ro lớn nhất?

<details>
<summary>Đáp án</summary>

1. Chi phí: cụm 3 node, giám sát, vá lỗi, học khái niệm. Lợi ích ở khối lượng đó: **gần như không có**.
2. Mọi job chưa xử lý — có thể là giao dịch tiền. **Không khôi phục được** nếu không có nguồn sự thật khác.
3. **Không** — RabbitMQ là queue, tin nhắn biến mất sau khi tiêu thụ.
4. **Không sẵn** — BullMQ không có partition. Phải tự thiết kế (nhiều queue theo hash, hoặc concurrency 1 theo nhóm).
5. Đơn hàng tồn tại nhưng không hệ thống nào biết: không email, không kho. **PostgreSQL queue** tránh được (cùng transaction); các công cụ khác cần **outbox**.
6. Job cũng rollback — **đúng**. Không có job mồ côi.
7. **Một** — work queue giao mỗi tin cho một consumer. Cần pub/sub hoặc consumer group.
8. Job bị **evict** — mất im lặng. Queue phải dùng `noeviction`.
9. **Không** — SQS giới hạn delay 15 phút. Cần scheduler riêng hoặc job trung gian.
10. **4** — số consumer hoạt động không vượt số partition.
11. Vượt xa khả năng: tải ghi lớn lên DB nghiệp vụ, bloat từ `UPDATE` liên tục, và cạnh tranh tài nguyên với truy vấn của người dùng.
12. Không ai hiểu đủ để xử lý sự cố lúc 2 giờ sáng. **Rủi ro vận hành lớn hơn mọi lợi ích kỹ thuật.**
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dựng PostgreSQL queue, chạy 8 worker, đo throughput | Trần thực tế của bạn |
| Bỏ `SKIP LOCKED`, lặp lại | Worker xếp hàng, throughput sụp |
| Enqueue trong transaction rồi `ROLLBACK` | Job biến mất — đúng |
| Cùng thí nghiệm với BullMQ | Job vẫn tồn tại — mồ côi |
| Thêm outbox, lặp lại | Job cũng rollback |
| BullMQ trên Redis `allkeys-lru`, đổ dữ liệu tới khi đầy | Job bị evict |
| Đổi sang `noeviction` | Từ chối ghi thay vì mất job |
| Redis không AOF, `kill -9`, restart | Job biến mất |
| Bật AOF `everysec`, lặp lại | Mất tối đa ~1 giây |
| Kafka 2 partition, chạy 5 consumer | 3 nhàn rỗi |
| Thêm consumer group mới đọc từ offset 0 | Phát lại toàn bộ lịch sử |
| Thử điều đó với RabbitMQ | Không có gì để phát lại |
| Đo thời gian dựng và vận hành mỗi công cụ trên staging | Chi phí thật của lựa chọn |

Dòng cuối đáng làm trước khi quyết định: dựng thử và vận hành một tuần cho bạn thông tin mà bảng so sánh không có.

## What Usually Goes Wrong

- **Chọn công cụ trước khi liệt kê yêu cầu** → thừa hoặc thiếu.
- **Chọn Kafka cho work queue đơn giản** → chi phí vận hành không đổi lấy gì.
- **Chọn Redis cho dữ liệu không được mất** → mất dữ liệu.
- **Không tính chi phí vận hành trong quyết định** → team nhỏ ôm một cụm không ai hiểu.
- **Quên khe hở enqueue** (ghi DB thành công, publish fail) → mất sự kiện.
- **Redis queue dùng chung với cache** → job bị evict.
- **Dùng queue khi cần log** → không phát lại được, và phát hiện khi cần.
- **Dùng log khi cần queue** → phải tự xây retry, DLQ, delayed.
- **Không đo khối lượng thật** → chọn theo dự đoán tăng trưởng không xảy ra.
- **Trừu tượng hoá quá sớm "để đổi broker"** → lớp trừu tượng rò rỉ, và bạn không bao giờ đổi.
- **Bỏ qua giới hạn cụ thể** (SQS delay 15 phút, FIFO throughput, Kafka partition cố định).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Kafka là "message queue tốt hơn" | Nó là **log**, mô hình khác hẳn |
| Kafka có retry/DLQ sẵn | Phải tự xây |
| RabbitMQ phát lại được | Không — tin nhắn biến mất sau khi tiêu thụ |
| Redis queue an toàn như DB queue | Durability = cấu hình Redis |
| PostgreSQL không làm queue được | `SKIP LOCKED` làm rất tốt ở khối lượng vừa |
| Cần broker riêng để làm queue | Chỉ khi vượt khả năng của DB |
| Managed service không có đánh đổi | Độ trễ, phụ thuộc nhà cung cấp, giới hạn cụ thể |
| Trừu tượng hoá cho phép đổi broker dễ | Ngữ nghĩa khác nhau rò rỉ qua mọi lớp trừu tượng |
| Throughput trên trang chủ sản phẩm là con số của bạn | Nó phụ thuộc kích thước tin nhắn, durability, phần cứng |
| Chọn công cụ mạnh nhất là an toàn | Công cụ không ai hiểu là rủi ro vận hành |

## Debugging

Khi đánh giá hoặc xem lại lựa chọn:

1. **Đo khối lượng thật**: job/giây ở đỉnh, kích thước payload trung bình, thời gian xử lý p95.
2. **Liệt kê yêu cầu tường minh**: durability, phát lại, thứ tự, số consumer độc lập, độ trễ chấp nhận được.
3. **Trả lời câu hỏi ⑥**: ai vận hành, họ có bao nhiêu thời gian, và ai trực lúc 2 giờ sáng.
4. **Kiểm tra khe hở enqueue**: `INSERT` DB và `publish` có nguyên tử không? Nếu không, có outbox chưa?
5. **Với hệ thống đang chạy, xem chỉ số**: DLQ có job không? lag bao nhiêu? tỉ lệ retry?
6. **Nếu đang cân nhắc đổi**: chi phí migration so với chi phí ở lại. Đổi sang Kafka là thiết kế lại, không phải thay thư viện.
7. **Test giới hạn trước khi cam kết**: dựng thử, đẩy 10× khối lượng dự kiến, xem cái gì gãy trước.

## Production Considerations

- **Bắt đầu ở mức đơn giản nhất đủ dùng.** PostgreSQL cho hầu hết hệ thống nhỏ và vừa; nó cho tính nguyên tử miễn phí.
- **Chi phí vận hành là một yêu cầu**, ngang hàng với throughput. Ghi nó vào tài liệu quyết định.
- **Dùng managed service khi có thể** — SQS, Amazon MSK, Confluent Cloud, Redis Cloud. Vận hành broker không tạo khác biệt cạnh tranh cho hầu hết sản phẩm.
- **Outbox cho mọi sự kiện quan trọng**, bất kể broker nào (trừ khi queue nằm chính trong DB).
- **Redis của queue tách khỏi Redis cache**, với `noeviction` và AOF.
- **Ghi lại quyết định** (ADR): yêu cầu nào, đã cân nhắc gì, chọn gì, vì sao. Sau hai năm, "vì sao chúng ta dùng cái này" là câu hỏi thật.
- **Đo và xem lại định kỳ** — mỗi năm một lần, khối lượng thật có còn khớp với công cụ không.
- **Lớp trừu tượng mỏng** quanh enqueue/consume, để nơi gọi không phụ thuộc API broker. Không kỳ vọng nó cho phép đổi broker không đau.
- **Với Kafka**: chọn số partition dư dả từ đầu, và hiểu `acks`, `min.insync.replicas`, `retention` **trước** khi lên production.
- **Với BullMQ**: hiểu `lockDuration` và ảnh hưởng của event loop bị chặn.
- **Với SQS FIFO**: biết giới hạn throughput theo `MessageGroupId` trước khi thiết kế khoá.

## Trade-offs

| Công cụ | Chọn khi | Đừng chọn khi |
|---|---|---|
| PostgreSQL + `SKIP LOCKED` | đã có PG, khối lượng vừa, cần nguyên tử với nghiệp vụ | >vài nghìn/s, cần phát lại |
| BullMQ (Redis) | Node.js, đã có Redis, cần retry/delayed sẵn | dữ liệu không được mất mà không có outbox |
| RabbitMQ | routing phức tạp, cần DLX/priority | chỉ cần work queue đơn giản |
| SQS | ở AWS, muốn zero-ops, cần durability cao | cần delay >15 phút, cần độ trễ rất thấp |
| Kafka | phát lại, nhiều consumer group, >100k/s | work queue đơn giản, team nhỏ |
| Redis Streams | đã có Redis, cần consumer group nhẹ | cần giữ lịch sử lâu, durability cao |

## Explain Without Notes

1. Sáu câu hỏi để chọn broker, và câu nào hay bị bỏ qua nhất?
2. Khác biệt khái niệm giữa queue và log? Ba năng lực chỉ log có?
3. Vì sao PostgreSQL queue có một tính chất mà không broker nào có?
4. Vì sao BullMQ cần Redis riêng với `noeviction`?
5. Kafka **không** cho bạn sẵn những gì?
6. Đường di trú nào dễ, đường nào khó, và vì sao?
7. Vì sao "chọn công cụ mạnh nhất" không phải lựa chọn an toàn?

## Related

- [Vì sao cần queue](01-why-queue.md) — có cần queue không đã
- [Delivery semantics](02-delivery-semantics.md) — mỗi broker đảm bảo gì
- [Retry & DLQ](03-retry-dlq.md) — cái nào có sẵn, cái nào tự xây
- [Ordering & partitioning](04-ordering-partitioning.md) — hỗ trợ thứ tự khác nhau
- [Outbox pattern](06-outbox-pattern.md) — đóng khe hở enqueue với mọi broker
- [Locking & deadlock](../01-postgresql/05-locking-deadlock.md) — `SKIP LOCKED`
- [Persistence & failure](../02-redis/05-persistence-failure.md) — durability của Redis
- [Redis pub/sub & streams](../02-redis/06-pubsub-streams.md) — Streams vs broker thật
- [Event-driven](../../06-system-design/07-event-driven.md) — kiến trúc quyết định công cụ
- [Requirements & trade-offs](../../06-system-design/01-requirements-tradeoffs.md) — khung ra quyết định

## Version / Context

Số liệu throughput là bậc độ lớn tham khảo, không phải benchmark — chúng phụ thuộc mạnh vào kích thước tin nhắn, cấu hình durability và phần cứng. Đo trên hệ thống của bạn. Phiên bản tham chiếu: PostgreSQL 16, Redis 7 + BullMQ 5, RabbitMQ 3.13, Kafka 3.x (KRaft, không cần ZooKeeper từ 3.3).
