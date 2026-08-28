---
level: advanced
area: database
prerequisites:
  - 02-delivery-semantics.md
  - 03-retry-dlq.md
related:
  - 05-broker-comparison.md
  - ../../06-system-design/07-event-driven.md
---

# Ordering & partitioning

> Người dùng đổi email hai lần trong ba giây: `a@x.com` → `b@x.com`. Hai sự kiện được xử lý bởi hai worker song song, và worker xử lý sự kiện **thứ nhất** chậm hơn. Kết quả cuối cùng trong hệ thống downstream: `a@x.com`. Không có lỗi nào, không có job nào fail, và không có gì trong log cho thấy điều gì bất thường.

## Position

```text
Producer ──▶ Broker ──▶ [consumer 1]  ← xử lý song song
                    ├──▶ [consumer 2]     ⇒ THỨ TỰ KHÔNG ĐẢM BẢO
                    └──▶ [consumer 3]

Partition/FIFO group: cùng khoá ──▶ MỘT consumer ──▶ thứ tự trong khoá được giữ
```

## Problem

### Thứ tự mất ở ba chỗ

```text
① Nhiều consumer song song
   A và B được giao cho hai worker; worker nào xong trước là ngẫu nhiên

② Retry
   A fail, retry sau 2 giây. B và C đã xử lý xong.
   ⇒ thứ tự cuối: B, C, A

③ Nhiều producer
   Hai instance API cùng ghi sự kiện cho một entity;
   thứ tự tới broker phụ thuộc mạng
```

Và điểm quan trọng: **mất thứ tự không gây lỗi.** Không có exception, không có job fail. Nó chỉ để lại dữ liệu sai, và bạn phát hiện khi có người đối chiếu.

### Nhưng "giữ thứ tự" có giá rất đắt

```text
Thứ tự toàn cục nghiêm ngặt
  ⇒ MỘT consumer duy nhất
  ⇒ throughput = tốc độ của một consumer
  ⇒ không scale ngang được
  ⇒ một job chậm chặn toàn bộ
```

Đây là đánh đổi cơ bản: **thứ tự và song song là hai thứ đối lập.** Mọi giải pháp thực tế là tìm mức trung gian.

## Mental Model

### Ba mức thứ tự

```text
KHÔNG THỨ TỰ            song song tối đa, throughput cao nhất
                        → hầu hết việc: gửi email, tạo thumbnail, ghi analytics

THỨ TỰ THEO KHOÁ        song song giữa các khoá, tuần tự trong một khoá
  (partition/FIFO group) → mọi sự kiện của user 42 theo thứ tự;
                          user 42 và user 99 chạy song song
                        → ĐÂY LÀ MỨC BẠN THƯỜNG CẦN

THỨ TỰ TOÀN CỤC         một consumer, không song song
                        → hầu như không bao giờ cần thật
```

Câu hỏi phân loại: **"hai sự kiện này có phải về cùng một thực thể không?"**

```text
Hai sự kiện về CÙNG một user   → cần thứ tự
Hai sự kiện về HAI user khác   → không cần
```

Từ đó ra khoá phân vùng tự nhiên: `userId`, `orderId`, `accountId` — thường chính là ID của aggregate.

### Partition hoạt động thế nào

```text
partition = hash(key) % số_partition

user-42  → hash → partition 1  ─┐
user-42  → hash → partition 1  ─┼─▶ consumer A   (thứ tự được giữ trong partition)
user-42  → hash → partition 1  ─┘
user-99  → hash → partition 3  ───▶ consumer C

Quy tắc: MỖI partition được đọc bởi ĐÚNG MỘT consumer trong một group.
```

Hệ quả trực tiếp:

```text
số consumer hoạt động ≤ số partition

10 partition, 20 consumer → 10 consumer NHÀN RỖI
⇒ số partition là trần scale của bạn, và nó khó tăng sau này
```

### Tăng số partition phá vỡ thứ tự lịch sử

```text
Trước:  hash('user-42') % 4  = 2
Sau:    hash('user-42') % 8  = 6

⇒ sự kiện cũ của user-42 ở partition 2, sự kiện mới ở partition 6
⇒ hai partition được xử lý song song ⇒ thứ tự lịch sử KHÔNG còn
```

Vì thế số partition là quyết định khó đảo ngược. Quy tắc thực dụng: **chọn nhiều hơn số consumer bạn nghĩ sẽ cần** (ví dụ 12–24 cho một hệ thống dự kiến 4–8 consumer). Partition thừa gần như không tốn gì; partition thiếu là một cuộc migration.

### Hot partition

```text
Khoá = tenantId, và một tenant chiếm 60% traffic
⇒ một partition nhận 60% tải, các partition khác nhàn rỗi
⇒ scale thêm consumer KHÔNG giúp gì
```

Ba cách xử lý:

```text
① Chọn khoá mịn hơn        tenantId → tenantId:userId
                            (mất thứ tự ở mức tenant, giữ ở mức user)
② Tách riêng tenant lớn     topic/queue riêng cho họ
③ Khoá tổng hợp có bucket   `${tenantId}:${hash(entityId) % 10}`
```

Cách ① là câu hỏi thiết kế: **bạn thật sự cần thứ tự ở mức nào?** Nếu chỉ cần thứ tự cho từng user, đừng phân vùng theo tenant.

### Poison message chặn partition

Đây là mặt trái nghiêm trọng nhất của thứ tự nghiêm ngặt:

```text
Partition 2:  [msg-A(hỏng)] [msg-B] [msg-C] [msg-D] ...
              ↑ luôn fail

Nếu retry vô hạn để giữ thứ tự → B, C, D KHÔNG BAO GIỜ được xử lý
```

Hai lựa chọn, và cả hai đều mất một thứ:

```text
① Bỏ qua msg-A sau N lần, ghi vào DLQ, tiếp tục
   → giữ tiến độ, MẤT tính đúng đắn của thứ tự cho khoá đó
   → PHẢI alert: một sự kiện của khoá này đã bị bỏ

② Dừng partition, chờ người xử lý
   → giữ đúng đắn, MẤT tiến độ (và có SLA)
```

Với hầu hết hệ thống, ① là lựa chọn đúng — nhưng nó chỉ đúng nếu **có alert**. Bỏ qua im lặng là tệ nhất trong cả ba.

### Thiết kế để KHÔNG cần thứ tự

Đây là cách tiếp cận tốt nhất và thường bị bỏ qua: thay vì bắt hạ tầng đảm bảo thứ tự, làm cho handler **không quan tâm** tới thứ tự.

**Bốn kỹ thuật:**

```text
① Gửi TRẠNG THÁI, không gửi DELTA
   ✗ { type: 'balance.changed', delta: -50 }      thứ tự quan trọng
   ✓ { type: 'balance.updated', balance: 150 }    áp dụng lần nào cũng ra 150

② Version / timestamp — bỏ qua sự kiện cũ
   if (event.version <= current.version) return;   ← giải quyết ví dụ mở đầu

③ Đọc lại từ nguồn sự thật
   payload chỉ có ID; handler đọc trạng thái MỚI NHẤT từ DB
   ⇒ thứ tự xử lý không còn quan trọng

④ Thao tác giao hoán
   thêm vào set, gán giá trị — thứ tự nào cũng ra kết quả như nhau
```

Kỹ thuật ② áp dụng cho ví dụ mở đầu:

```ts
// producer gắn version từ dòng DB
await publish({ type: 'user.updated', userId, email, version: user.version });

// consumer bỏ qua sự kiện cũ hơn — NGUYÊN TỬ trong một câu lệnh
await db.userProjection.updateMany({
  where: { userId, version: { lt: event.version } },
  data: { email: event.email, version: event.version },
});
// nếu 0 dòng được cập nhật → sự kiện này cũ hơn → bỏ qua, đúng
```

Điều kiện `version: { lt: ... }` nằm **trong** câu `UPDATE` là chi tiết quyết định: kiểm tra rồi ghi ở hai bước sẽ có race condition. Xem [Transaction isolation](../01-postgresql/01-transaction-isolation.md).

Kỹ thuật ③ đơn giản nhất và mạnh nhất:

```ts
// handler không cần biết sự kiện nào tới trước
async handle({ userId }: { userId: string }) {
  const user = await this.repo.findById(userId);      // trạng thái MỚI NHẤT
  await this.search.index(user);
}
```

Với ③, ba sự kiện `user.updated` liên tiếp cho ra ba lần index cùng một trạng thái cuối — lãng phí một chút, nhưng luôn đúng.

### Rebalance: khi consumer thay đổi

```text
Consumer mới tham gia / cũ rời đi / crash
   → broker phân bổ lại partition
   → trong lúc rebalance, xử lý TẠM DỪNG (vài giây tới vài chục giây)
   → consumer có thể mất partition đang xử lý dở
```

Hai hệ quả:

```text
· Deploy làm rebalance → độ trễ tăng vọt trong lúc rollout
· Consumer chậm bị coi là chết → bị đá ra → rebalance → tệ hơn
```

Với Kafka, `max.poll.interval.ms` là con số quyết định: nếu xử lý một lô mất lâu hơn nó, consumer bị coi là chết. Job dài phải giảm `max.poll.records` hoặc tăng interval.

## Example

Cùng một hệ thống, ba loại sự kiện, ba quyết định khác nhau:

```text
① user.email-changed  → CẦN thứ tự theo user
   Partition key: userId
   Hoặc: gửi trạng thái + version, và bỏ hẳn yêu cầu thứ tự

② order.created → gửi email xác nhận  → KHÔNG cần thứ tự
   Mỗi đơn độc lập; partition ngẫu nhiên, song song tối đa

③ inventory.reserved / released → CẦN thứ tự theo sản phẩm
   Partition key: productId
   Hoặc tốt hơn: KHÔNG dùng delta —
     ✗ { productId, delta: -1 }
     ✓ UPDATE inventory SET qty = qty - 1 WHERE product_id = ? AND qty > 0
       (nguyên tử ở DB; thứ tự sự kiện không còn quan trọng)
```

Trường hợp ③ minh hoạ nguyên tắc chung: **rất nhiều yêu cầu về thứ tự biến mất khi bạn để database làm việc nguyên tử thay vì để consumer áp dụng delta.**

Và khi thật sự cần partition:

```ts
// Kafka
await producer.send({
  topic: 'user-events',
  messages: [{ key: userId, value: JSON.stringify(event) }],   // key → partition
});

// SQS FIFO
await sqs.sendMessage({
  QueueUrl, MessageBody: JSON.stringify(event),
  MessageGroupId: userId,                      // thứ tự trong group
  MessageDeduplicationId: event.id,            // chống trùng trong 5 phút
});

// BullMQ — không có partition; dùng flow hoặc concurrency 1 theo nhóm
// (đây là giới hạn thật của BullMQ; xem Broker comparison)
```

## Prediction

1. Hai sự kiện `email-changed` cho cùng user, 3 consumer song song — thứ tự xử lý đảm bảo không?
2. Sự kiện A fail và retry sau 2 giây, B và C xử lý xong trong lúc đó — thứ tự cuối?
3. Partition key = `userId`, 4 partition, sự kiện của user-42 — đi vào mấy partition?
4. 10 partition, 20 consumer trong một group — bao nhiêu consumer làm việc?
5. Tăng partition từ 4 lên 8 — sự kiện cũ và mới của user-42 ở đâu? Thứ tự thế nào?
6. Partition key = `tenantId`, một tenant chiếm 60% traffic — phân bố tải?
7. Thêm consumer trong tình huống câu 6 — có nhanh hơn không?
8. Poison message ở partition 2, retry vô hạn để giữ thứ tự — job phía sau thế nào?
9. Bỏ qua poison message sau 5 lần nhưng không alert — hậu quả?
10. Handler dùng `balance += delta`, hai sự kiện xử lý sai thứ tự — kết quả?
11. Handler dùng `SET balance = event.balance` với `WHERE version < event.version` — kết quả?
12. Handler chỉ nhận `userId` và đọc lại từ DB, ba sự kiện sai thứ tự — kết quả?
13. Deploy consumer mới, Kafka rebalance — độ trễ trong lúc đó?

<details>
<summary>Đáp án</summary>

1. **Không** — ba consumer xử lý song song, thứ tự hoàn thành ngẫu nhiên.
2. **B, C, A** — retry đẩy A ra sau.
3. **Một** partition duy nhất — cùng key luôn cùng partition.
4. **10** — mỗi partition chỉ một consumer trong group; 10 consumer nhàn rỗi.
5. Cũ ở partition `hash % 4`, mới ở `hash % 8` — có thể khác nhau → hai partition song song → **thứ tự lịch sử mất**.
6. Một partition nhận **60% tải**, phần còn lại chia nhau 40%.
7. **Không** — partition nóng vẫn chỉ có một consumer. Đây là giới hạn cứng.
8. **Bị chặn vĩnh viễn** — không job nào sau nó được xử lý.
9. Sự kiện bị mất **im lặng**. Dữ liệu sai và không ai biết. Đây là kết quả tệ nhất.
10. Balance sai — delta áp dụng đúng số lần nhưng thứ tự không quan trọng với phép cộng... **trừ khi** có sự kiện `set` xen vào. Nguy hiểm thật là khi trộn delta và set.
11. **Đúng** — sự kiện cũ bị bỏ qua vì `version` nhỏ hơn.
12. **Đúng** — cả ba lần đều index trạng thái mới nhất. Lãng phí hai lần, nhưng luôn đúng.
13. Xử lý **tạm dừng** trong lúc rebalance — vài giây tới vài chục giây, tuỳ cấu hình.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gửi 100 sự kiện có số thứ tự, 5 consumer, log thứ tự xử lý | Đếm số cặp đảo |
| Thêm partition key, lặp lại | Thứ tự trong khoá được giữ |
| Làm một sự kiện fail và retry, xem thứ tự cuối | Nó bị đẩy ra sau |
| 4 partition, chạy 10 consumer, đo throughput | Chỉ 4 làm việc |
| Tăng partition từ 4 lên 8 khi đang có dữ liệu cũ | Thứ tự lịch sử mất |
| Partition theo tenant với dữ liệu lệch, đo tải mỗi partition | Hot partition |
| Đổi khoá thành `tenantId:userId`, lặp lại | Phân bố đều hơn |
| Tạo poison message trong partition có thứ tự, retry vô hạn | Partition đứng |
| Đổi sang bỏ qua sau 5 lần | Tiến độ tiếp tục, một sự kiện mất |
| Handler dùng delta, gửi sự kiện sai thứ tự | Kết quả sai |
| Đổi sang gửi trạng thái + version | Kết quả đúng |
| Đổi sang đọc lại từ DB | Đúng, và đơn giản hơn |
| Restart một consumer khi đang chạy, đo độ trễ | Rebalance pause |
| Đặt `max.poll.interval.ms` nhỏ hơn thời gian xử lý một lô | Consumer bị đá ra liên tục |

## What Usually Goes Wrong

- **Giả định thứ tự mà không cấu hình gì** → dữ liệu sai im lặng.
- **Yêu cầu thứ tự toàn cục** → throughput bằng một consumer.
- **Partition key quá thô** (tenant) → hot partition, scale không giúp.
- **Partition key quá mịn** → mất thứ tự ở mức cần thiết.
- **Số partition quá ít** → trần scale thấp, khó tăng sau.
- **Tăng partition khi đang chạy** → mất thứ tự lịch sử.
- **Poison message trong partition có thứ tự** → chặn toàn bộ.
- **Bỏ qua poison message không alert** → mất dữ liệu im lặng.
- **Handler dùng delta** → phụ thuộc thứ tự không cần thiết.
- **Không có version/timestamp trong sự kiện** → không phát hiện được sự kiện cũ.
- **Kiểm tra version rồi ghi ở hai bước** → race condition.
- **Consumer chậm hơn `max.poll.interval.ms`** → bị đá ra, rebalance liên tục.
- **Deploy thường xuyên với nhiều partition** → rebalance làm độ trễ tăng đều đặn.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Queue giữ thứ tự | Chỉ khi có partition/FIFO group và một consumer mỗi khoá |
| FIFO nghĩa là thứ tự đảm bảo với mọi tin nhắn | FIFO **trong một group**, không phải toàn cục |
| Thêm consumer luôn tăng throughput | Không vượt quá số partition |
| Số partition tăng được thoải mái | Tăng phá vỡ thứ tự lịch sử |
| Thứ tự là yêu cầu kỹ thuật | Nó thường là yêu cầu có thể **thiết kế bỏ đi** |
| Retry giữ nguyên thứ tự | Retry đẩy tin nhắn ra sau |
| Một partition = một consumer nghĩa là chậm | Nó vẫn song song **giữa** các partition |
| Poison message chỉ ảnh hưởng chính nó | Trong partition có thứ tự, nó chặn tất cả |
| Timestamp đủ để sắp xếp | Đồng hồ giữa các máy lệch nhau |
| Kafka đảm bảo thứ tự toàn cục | Chỉ trong một partition |

Về timestamp: dùng đồng hồ tường (`Date.now()`) từ nhiều máy để so sánh thứ tự là không đáng tin. Dùng **version tăng dần từ database** (một cột `version` hoặc `xmin`), hoặc offset của broker.

## Debugging

1. **Dữ liệu sai không rõ lý do** → nghi thứ tự trước tiên nếu hệ thống có sự kiện. Log `eventId`, `version`, `receivedAt`, `partition`, `offset`.
2. **Tái hiện**: gửi sự kiện có số thứ tự, log thứ tự xử lý, đếm cặp đảo.
3. **Kiểm tra phân bố partition**:
   ```bash
   kafka-consumer-groups --describe --group my-group
   # LAG theo từng partition — lệch nhiều = hot partition
   ```
4. **Consumer nhàn rỗi** → so số consumer với số partition.
5. **Partition đứng** → lag của một partition tăng còn các partition khác bình thường → poison message.
6. **Rebalance liên tục** → log của consumer group; thường là `max.poll.interval.ms` quá nhỏ so với thời gian xử lý.
7. **Xác nhận handler có phụ thuộc thứ tự không** — test: gửi sự kiện theo thứ tự ngược và khẳng định trạng thái cuối giống nhau.

Test ở bước 7 đáng tự động hoá: nó bắt được lớp bug này trước khi lên production.

## Production Considerations

- **Bắt đầu bằng câu hỏi thiết kế**: có thể làm handler không phụ thuộc thứ tự không? Bốn kỹ thuật ở trên giải quyết phần lớn trường hợp, và chúng rẻ hơn hạ tầng đảm bảo thứ tự.
- **Nếu cần thứ tự, chọn khoá ở mức aggregate** (`userId`, `orderId`), không phải mức tenant.
- **Chọn số partition dư dả từ đầu** — tăng sau phá vỡ thứ tự lịch sử.
- **Theo dõi lag theo từng partition**, không chỉ tổng. Một partition lag cao là hot partition hoặc poison message.
- **Chiến lược poison message rõ ràng**: bỏ qua sau N lần **và alert**. Ghi rõ trong runbook rằng một sự kiện của khoá đó đã bị bỏ.
- **Gắn version vào mọi sự kiện** — nó cho consumer khả năng tự bảo vệ khỏi thứ tự sai.
- **Dùng version từ database, không dùng đồng hồ tường.**
- **Test không phụ thuộc thứ tự** trong CI: gửi ngược thứ tự, khẳng định trạng thái cuối.
- **`max.poll.records` nhỏ** cho job dài, để không bị đá ra trong lúc xử lý.
- **Rebalance là chi phí của deploy** — với nhiều partition và deploy thường xuyên, cân nhắc cooperative rebalancing (Kafka 2.4+) để giảm thời gian dừng.
- **Ghi lại yêu cầu thứ tự của mỗi loại sự kiện** trong tài liệu — nó là thông tin mà code không thể hiện.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không thứ tự | song song tối đa, đơn giản | handler phải chịu được thứ tự bất kỳ |
| Thứ tự theo khoá | song song giữa khoá, đúng trong khoá | trần scale = số partition; rủi ro hot partition |
| Thứ tự toàn cục | đơn giản về ngữ nghĩa | một consumer, không scale |
| Khoá thô (tenant) | ít partition, thứ tự rộng | hot partition |
| Khoá mịn (user) | phân bố đều | mất thứ tự ở mức rộng hơn |
| Nhiều partition | trần scale cao | nhiều connection, rebalance lâu hơn |
| Ít partition | đơn giản | trần scale thấp, khó tăng |
| Bỏ qua poison message | giữ tiến độ | mất một sự kiện (phải alert) |
| Dừng partition | giữ đúng đắn | mất tiến độ, ảnh hưởng SLA |
| Gửi trạng thái | không phụ thuộc thứ tự | payload lớn hơn |
| Gửi delta | payload nhỏ | phụ thuộc thứ tự, khó idempotent |
| Đọc lại từ DB | luôn đúng, đơn giản nhất | thêm một lần đọc mỗi sự kiện |

## Explain Without Notes

1. Ba chỗ thứ tự bị mất, và vì sao mất thứ tự không gây lỗi?
2. Ba mức thứ tự, và câu hỏi để chọn mức?
3. Vì sao số consumer không vượt được số partition?
4. Vì sao tăng số partition phá vỡ thứ tự lịch sử?
5. Hot partition là gì, và ba cách xử lý?
6. Poison message trong partition có thứ tự gây gì? Hai lựa chọn và cái giá của mỗi cái?
7. Bốn kỹ thuật làm handler không phụ thuộc thứ tự? Cái nào đơn giản nhất?
8. Vì sao không dùng timestamp để sắp xếp sự kiện từ nhiều máy?

## Related

- [Delivery semantics](02-delivery-semantics.md) — at-least-once, idempotency
- [Retry & DLQ](03-retry-dlq.md) — retry phá thứ tự; poison message
- [Broker comparison](05-broker-comparison.md) — mỗi broker hỗ trợ thứ tự thế nào
- [Vì sao cần queue](01-why-queue.md) — nền tảng
- [Event-driven](../../06-system-design/07-event-driven.md) — thứ tự trong kiến trúc sự kiện
- [Transaction isolation](../01-postgresql/01-transaction-isolation.md) — kiểm tra version nguyên tử
- [Redis pub/sub & streams](../02-redis/06-pubsub-streams.md) — thứ tự trong Redis Streams
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — eventual consistency

## Version / Context

Kafka: thứ tự trong một partition; cooperative rebalancing từ 2.4. SQS FIFO: thứ tự trong `MessageGroupId`, giới hạn throughput mặc định 300 tin/giây mỗi group (3.000 với batching). RabbitMQ: thứ tự trong một queue với một consumer; consistent hash exchange cần plugin. BullMQ: không có partition sẵn — cần tự thiết kế bằng nhiều queue hoặc concurrency 1.
