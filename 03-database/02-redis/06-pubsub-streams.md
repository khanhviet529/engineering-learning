---
level: advanced
area: database
prerequisites:
  - 05-persistence-failure.md
related:
  - ../04-message-queues/02-delivery-semantics.md
  - ../../02-backend-api/02-nestjs/08-websocket-gateway.md
---

# Pub/Sub & Streams

> Tính năng thông báo realtime hoạt động hoàn hảo. Rồi một người dùng mất mạng 20 giây và không bao giờ nhận được ba thông báo trong khoảng đó. Không có lỗi, không có log, không có gì để phát lại. Redis Pub/Sub làm đúng những gì nó hứa — vấn đề là bạn kỳ vọng nó hứa nhiều hơn.

## Position

```text
Publisher  ──▶  Redis  ──▶  Subscriber(s)
                  │
                  ├─ PUB/SUB   fire-and-forget, KHÔNG lưu
                  └─ STREAMS   append-only log, CÓ lưu, có consumer group
```

Hai cơ chế trông giống nhau ở API nhưng khác nhau ở tính chất quan trọng nhất: **cái gì xảy ra khi người nhận không có mặt.**

## Problem

Nhiều tình huống cần "một thành phần báo cho thành phần khác":

```text
· pod này gửi tin nhắn, pod kia phải broadcast tới WebSocket của nó
· một service ghi dữ liệu, service khác cần invalidate cache
· job xong, cần thông báo cho người dùng
· một sự kiện nghiệp vụ, ba service khác nhau cần biết
```

Redis có sẵn Pub/Sub và nó rất dễ dùng. Nhưng nó có một tính chất mà bạn phải quyết định là chấp nhận được hay không:

```text
PUBLISH gửi tới các subscriber ĐANG KẾT NỐI tại thời điểm đó.
Không có ai nghe → tin nhắn BIẾN MẤT. Không lưu, không phát lại, không lỗi.
```

`PUBLISH` trả về số subscriber đã nhận. Nếu là `0`, tin nhắn đã đi vào hư không — và code của bạn thường không kiểm tra con số đó.

## Mental Model

```text                  PUB/SUB                    STREAMS
Lưu trữ                 không                      CÓ (append-only log)
Subscriber offline      MẤT tin nhắn               đọc lại được từ ID bất kỳ
Nhiều consumer          MỌI subscriber nhận        broadcast HOẶC chia việc
Xác nhận (ack)          không                      XACK
Xử lý lại khi lỗi       không                      XPENDING / XCLAIM
Thứ tự                  theo channel               theo stream, có ID tăng dần
Bộ nhớ                  ~0 (không lưu)             tăng theo số entry → cần cắt
Độ phức tạp             1 lệnh                     nhiều lệnh, cần quản lý group
```

Câu hỏi chọn giữa hai cái chỉ có một:

> **"Nếu người nhận không có mặt lúc đó, việc mất tin nhắn có sao không?"**
>
> Không sao → Pub/Sub. Có sao → Streams (hoặc một broker thật).

## How It Works

### Pub/Sub

```ts
// publisher
await redis.publish('cache:invalidate', JSON.stringify({ entity: 'project', id: 42 }));

// subscriber — connection RIÊNG, không dùng lại connection thường
const sub = redis.duplicate();
await sub.subscribe('cache:invalidate');
sub.on('message', (channel, msg) => {
  const { entity, id } = JSON.parse(msg);
  localCache.delete(`${entity}:${id}`);
});
```

Chi tiết bắt buộc: **connection đã `SUBSCRIBE` không chạy được lệnh khác.** Nó chuyển sang chế độ subscriber. Dùng chung connection với `GET`/`SET` sẽ lỗi. Luôn `duplicate()`.

Hai ứng dụng mà Pub/Sub là lựa chọn **đúng**:

```text
① Invalidate cache trong bộ nhớ (L1) giữa các instance
   Mất một thông báo → một instance giữ cache cũ tới hết TTL. Chấp nhận được
   vì TTL của L1 vốn đã rất ngắn.

② Broadcast WebSocket xuyên pod
   Người dùng offline lúc đó vốn đã không nhận được gì.
   → Nhưng nguồn sự thật phải là DATABASE, và client phải sync được khi reconnect.
   Xem WebSocket gateway.
```

Trong cả hai, Pub/Sub là kênh **thông báo nhanh**, không phải nơi lưu trữ.

### Streams

```ts
// ghi — ID '*' để Redis tự sinh theo thời gian
const id = await redis.xadd('events:orders', '*', 'type', 'created', 'orderId', '42');
// id = "1737000000000-0"  (mili giây - số thứ tự)

// tạo consumer group một lần, bắt đầu từ đầu stream ('0') hoặc từ giờ ('$')
await redis.xgroup('CREATE', 'events:orders', 'billing', '0', 'MKSTREAM');
```

```ts
// consumer — mỗi instance một tên khác nhau
while (running) {
  const res = await redis.xreadgroup(
    'GROUP', 'billing', `worker-${instanceId}`,
    'COUNT', 10, 'BLOCK', 5000,
    'STREAMS', 'events:orders', '>');           // '>' = chỉ tin nhắn CHƯA ai nhận

  for (const [, entries] of res ?? []) {
    for (const [id, fields] of entries) {
      try {
        await handle(fields);
        await redis.xack('events:orders', 'billing', id);   // XÁC NHẬN
      } catch (e) {
        logger.error({ id, e }, 'handler failed');           // KHÔNG ack → còn ở pending
      }
    }
  }
}
```

Ba tính chất mà Pub/Sub không có:

```text
① Consumer offline rồi quay lại → đọc tiếp từ chỗ dừng
② Không ack → tin nhắn ở trạng thái "pending", xử lý lại được
③ Nhiều consumer trong CÙNG group → CHIA việc; khác group → mỗi group nhận đủ
```

Điểm ③ là mô hình quan trọng: một stream, nhiều group (`billing`, `analytics`, `notifications`), mỗi group nhận **mọi** sự kiện và tự chia việc trong nội bộ group.

### Xử lý tin nhắn bị treo

Consumer crash sau khi nhận nhưng trước khi ack → tin nhắn nằm mãi ở pending. Cần một cơ chế thu hồi:

```ts
// XAUTOCLAIM: lấy lại tin nhắn pending quá 60 giây từ consumer khác
const [cursor, claimed] = await redis.xautoclaim(
  'events:orders', 'billing', `worker-${instanceId}`,
  60_000, '0', 'COUNT', 10);

for (const [id, fields] of claimed) {
  await handle(fields);
  await redis.xack('events:orders', 'billing', id);
}
```

Không có bước này, một consumer chết để lại tin nhắn không bao giờ được xử lý — và không có gì báo cho bạn. Theo dõi bằng:

```bash
redis-cli XPENDING events:orders billing          # tổng quan
redis-cli XINFO GROUPS events:orders              # lag của mỗi group
```

Và một tin nhắn bị claim lại nhiều lần (`delivery_count` cao) thường là "poison message" — nó luôn làm handler lỗi. Cần chuyển nó sang một stream DLQ sau N lần.

### Streams tăng vô hạn — phải cắt

```ts
// giới hạn XẤP XỈ (~) — rẻ hơn nhiều so với chính xác
await redis.xadd('events:orders', 'MAXLEN', '~', 100000, '*', 'type', 'created');

// hoặc theo thời gian (Redis 6.2+)
await redis.xadd('events:orders', 'MINID', '~', Date.now() - 7 * 86400_000, '*', ...);
```

Không cắt, stream lớn dần cho tới khi Redis chạm `maxmemory`. Và nếu instance đó dùng `noeviction` (đúng cho dữ liệu quan trọng), Redis sẽ **từ chối ghi** — hệ thống dừng.

Cảnh báo: `MAXLEN` cắt cả tin nhắn **chưa được consumer nào xử lý**. Nếu một consumer group tụt lại xa, cắt stream nghĩa là mất dữ liệu của group đó. Theo dõi lag của mọi group trước khi đặt `MAXLEN` chặt.

### Streams vs một broker thật

```text
REDIS STREAMS                     KAFKA / RABBITMQ
đã có Redis rồi                   thêm một hệ thống phải vận hành
durability = cấu hình Redis       durability là thiết kế cốt lõi
dữ liệu trong RAM                 trên đĩa, giữ được lâu (Kafka: hàng tháng)
đủ cho throughput vừa             thiết kế cho throughput rất cao
không có schema registry,         hệ sinh thái đầy đủ
  không có công cụ replay mạnh
```

Redis Streams là lựa chọn tốt khi: bạn đã có Redis, khối lượng vừa phải, và mất một ít dữ liệu trong tình huống xấu là chấp nhận được. Nó **không** thay thế Kafka cho event sourcing hay pipeline dữ liệu quy mô lớn. Xem [Vì sao cần queue](../04-message-queues/01-why-queue.md).

### Keyspace notification: dùng dè dặt

```bash
redis-cli CONFIG SET notify-keyspace-events Ex     # E=keyevent, x=expired
```

```ts
sub.subscribe('__keyevent@0__:expired');
sub.on('message', (_ch, key) => { /* key vừa hết hạn */ });
```

Nghe hấp dẫn cho "làm gì đó khi TTL hết". Ba lý do nên tránh cho logic quan trọng:

```text
① Nó dùng Pub/Sub ⇒ không lưu ⇒ subscriber offline = MẤT sự kiện
② Sự kiện `expired` phát khi Redis THẬT SỰ xoá key, không phải khi TTL hết
   (lazy expiration: key có thể "sống" một thời gian sau khi hết hạn)
③ Tốn hiệu năng khi bật rộng
```

Với "hết hạn thì làm gì đó", một job quét định kỳ trên bảng ở database đáng tin hơn nhiều.

## Example

Cùng một yêu cầu, hai lựa chọn khác nhau:

```text
YÊU CẦU A: "Khi project đổi tên, mọi pod xoá cache L1 của nó"
  → PUB/SUB
  Mất một thông báo ⇒ một pod giữ cache cũ tới hết TTL (5 giây). Chấp nhận được.
  Chi phí: 1 lệnh.

YÊU CẦU B: "Khi đơn hàng được tạo, gửi email + cập nhật kho + ghi analytics"
  → STREAMS (hoặc broker thật)
  Mất một sự kiện ⇒ khách không nhận email, kho sai. KHÔNG chấp nhận được.
  Cần: 3 consumer group độc lập, ack, retry, DLQ.
```

```ts
// B với Streams
await redis.xadd('events:orders', 'MAXLEN', '~', 100000, '*',
  'type', 'order.created', 'orderId', order.id, 'v', '1');

// ba group độc lập, mỗi group nhận MỌI sự kiện
await redis.xgroup('CREATE', 'events:orders', 'email',     '0', 'MKSTREAM');
await redis.xgroup('CREATE', 'events:orders', 'inventory', '0', 'MKSTREAM');
await redis.xgroup('CREATE', 'events:orders', 'analytics', '0', 'MKSTREAM');
```

Nhưng với B, còn một câu hỏi nữa: **`XADD` có nằm trong cùng transaction với việc tạo đơn hàng không?** Không — Redis và PostgreSQL là hai hệ thống. Nếu `INSERT` thành công và `XADD` thất bại, sự kiện mất. Đó là lý do outbox tồn tại. Xem [Outbox pattern](../04-message-queues/06-outbox-pattern.md).

Và trường `v: '1'` trong payload: version của schema sự kiện. Consumer cũ và mới sẽ cùng tồn tại trong lúc deploy.

## Prediction

1. `PUBLISH` khi không có subscriber nào — tin nhắn đi đâu? Lệnh trả về gì?
2. Subscriber mất mạng 20 giây rồi kết nối lại — nhận được tin nhắn trong 20 giây đó không?
3. Cùng tình huống với Streams và consumer group — nhận được không?
4. Ba pod cùng `SUBSCRIBE` một channel, `PUBLISH` một tin — mấy pod nhận?
5. Ba consumer cùng một group đọc `XREADGROUP`, một tin nhắn tới — mấy consumer xử lý?
6. Ba consumer ở **ba group khác nhau** — mấy consumer xử lý?
7. Consumer nhận tin nhắn rồi crash trước `XACK` — tin nhắn ở đâu? Ai xử lý nó?
8. Không có `XAUTOCLAIM`, consumer đó không bao giờ quay lại — tin nhắn thế nào?
9. Stream không đặt `MAXLEN`, 1.000 sự kiện/giây, chạy một tuần — bao nhiêu entry? Redis thế nào?
10. Đặt `MAXLEN ~ 1000` nhưng một consumer group tụt lại 5.000 tin — group đó mất gì?
11. Dùng cùng một connection cho `SUBSCRIBE` và `GET` — kết quả?
12. Keyspace notification cho `expired`, subscriber offline 1 phút — sự kiện thế nào?
13. `XADD` thất bại sau khi `INSERT` vào PostgreSQL thành công — hệ quả?

<details>
<summary>Đáp án</summary>

1. **Biến mất.** `PUBLISH` trả về `0` (số subscriber nhận được) — và hầu như không ai kiểm tra giá trị này.
2. **Không** — Pub/Sub không lưu gì.
3. **Có** — đọc tiếp từ chỗ dừng bằng consumer group.
4. **Cả ba** — Pub/Sub là broadcast tới mọi subscriber.
5. **Một** — trong cùng group, tin nhắn được chia, không nhân bản.
6. **Cả ba** — mỗi group nhận đầy đủ mọi tin nhắn.
7. Ở trạng thái **pending** của consumer đó. Không ai xử lý cho tới khi có `XCLAIM`/`XAUTOCLAIM`.
8. **Kẹt vĩnh viễn** ở pending, và không có gì báo cho bạn. Đây là lý do phải theo dõi `XPENDING`.
9. 604,8 triệu entry. Redis chạm `maxmemory` → tuỳ policy: evict (mất dữ liệu) hoặc từ chối ghi (hệ thống dừng).
10. Mất **4.000 tin nhắn** chưa xử lý — `MAXLEN` cắt bất kể ai đã đọc hay chưa.
11. Lỗi — connection ở chế độ subscriber chỉ chấp nhận lệnh subscribe/unsubscribe (và ping/quit).
12. **Mất** — keyspace notification dùng Pub/Sub.
13. Sự kiện mất; email không được gửi, kho không cập nhật. Đơn hàng tồn tại nhưng hệ thống không phản ứng. Cần outbox.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `PUBLISH` khi không có subscriber, kiểm tra giá trị trả về | `0` |
| Ngắt subscriber 10 giây, publish 5 tin, kết nối lại | Mất 5 tin |
| Cùng thí nghiệm với Streams + consumer group | Nhận đủ 5 |
| Ba consumer cùng group, publish 100 tin, đếm mỗi consumer xử lý bao nhiêu | Tổng = 100 |
| Ba consumer khác group, lặp lại | Mỗi group xử lý 100 |
| Nhận tin rồi `kill -9` trước `XACK`, chạy `XPENDING` | Tin nhắn kẹt |
| Thêm `XAUTOCLAIM`, khởi động consumer khác | Tin được xử lý lại |
| Handler luôn ném lỗi, để chạy 100 lần | `delivery_count` tăng — poison message |
| Stream không `MAXLEN`, đẩy 1 triệu entry, xem `INFO memory` | Bộ nhớ tăng tuyến tính |
| `MAXLEN ~ 100` khi một group tụt lại 500 | Group mất dữ liệu |
| Dùng chung connection cho `SUBSCRIBE` và `GET` | Lỗi |
| Bật keyspace notification, ngắt subscriber, để key hết hạn | Sự kiện mất |
| Đặt TTL 1 giây, xem thời điểm sự kiện `expired` thật sự phát | Có thể trễ (lazy expiration) |
| `XADD` khi Redis `noeviction` và đã đầy | Lỗi OOM, sự kiện không được ghi |

## What Usually Goes Wrong

- **Dùng Pub/Sub cho dữ liệu quan trọng** → mất im lặng khi subscriber offline.
- **Không kiểm tra giá trị trả về của `PUBLISH`** → không biết có ai nhận không.
- **Dùng chung connection cho subscribe và lệnh thường** → lỗi.
- **Streams không `MAXLEN`** → bộ nhớ tăng vô hạn.
- **`MAXLEN` quá chặt khi có group tụt lại** → mất dữ liệu chưa xử lý.
- **Không `XACK`** → pending tăng, tin nhắn xử lý lại mãi.
- **Không có `XAUTOCLAIM`** → consumer chết để lại tin nhắn kẹt vĩnh viễn.
- **Không xử lý poison message** → một tin nhắn hỏng chặn tiến độ hoặc lặp vô hạn.
- **Không theo dõi `XPENDING` và lag của group** → không biết consumer chết.
- **Coi Redis Streams như Kafka** → kỳ vọng giữ dữ liệu hàng tháng trong RAM.
- **`XADD` không nằm trong transaction với ghi DB** → sự kiện mất hoặc sự kiện ma.
- **Keyspace notification cho logic quan trọng** → mất sự kiện, và thời điểm không chính xác.
- **Không version hoá payload sự kiện** → consumer cũ vỡ khi deploy schema mới.
- **Consumer không idempotent** → xử lý lại gây tác dụng phụ trùng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Pub/Sub có lưu trữ tạm | Không lưu gì; không ai nghe = mất |
| Subscriber tự nhận lại tin nhắn khi reconnect | Không có gì để nhận lại |
| Streams là queue đầy đủ | Nó là log; retry/DLQ phải tự xây |
| `XACK` tự động khi đọc | Phải gọi tường minh |
| Nhiều consumer luôn chia việc | Chỉ trong **cùng** group |
| `MAXLEN` chỉ cắt tin đã xử lý | Nó cắt theo số lượng, bất kể ai đã đọc |
| Redis Streams thay được Kafka | Khác nhau về durability, dung lượng, hệ sinh thái |
| Keyspace notification đáng tin | Nó là Pub/Sub, và thời điểm không chính xác |
| `PUBLISH` trả về nghĩa là đã gửi thành công | Nó trả về **số** subscriber; `0` là hợp lệ |
| Streams đảm bảo exactly-once | At-least-once; consumer phải idempotent |

## Debugging

1. **Tin nhắn không tới** → Pub/Sub hay Streams? Với Pub/Sub, kiểm tra `PUBLISH` trả về mấy.
2. **Xem subscriber hiện có**: `redis-cli PUBSUB CHANNELS` và `PUBSUB NUMSUB <channel>`.
3. **Với Streams, xem toàn cảnh**:
   ```bash
   redis-cli XINFO STREAM events:orders
   redis-cli XINFO GROUPS events:orders     # lag của mỗi group
   redis-cli XPENDING events:orders billing # tin nhắn chưa ack
   redis-cli XPENDING events:orders billing - + 10   # chi tiết, có delivery_count
   ```
4. **`lag` của group tăng dần** → consumer chậm hơn producer, hoặc consumer chết.
5. **Tin nhắn xử lý lại nhiều lần** → `delivery_count` cao. Handler có lỗi, hoặc ack không chạy.
6. **Poison message** → `delivery_count` rất cao cho một ID cụ thể. Chuyển sang DLQ.
7. **Bộ nhớ tăng** → `XLEN` theo thời gian; kiểm tra `MAXLEN`.
8. **Consumer không nhận gì** → tên group đúng chưa? Đọc `>` hay đọc từ ID cụ thể? Group được tạo từ `0` hay `$`?

Điểm cuối là lỗi phổ biến: tạo group với `$` nghĩa là "chỉ nhận tin nhắn từ giờ trở đi" — mọi tin nhắn cũ bị bỏ qua.

## Production Considerations

- **Quyết định dựa trên một câu hỏi**: mất tin nhắn khi không ai nghe có sao không? Ghi câu trả lời vào tài liệu, không để nó là mặc định.
- **Pub/Sub chỉ cho thông báo có thể mất** — invalidate cache L1, broadcast WebSocket (với sync từ DB khi reconnect).
- **Streams cần đủ bốn thứ**: `MAXLEN`, `XACK`, `XAUTOCLAIM`, và theo dõi `XPENDING`. Thiếu một cái là một chế độ hỏng im lặng.
- **Alert trên lag của mỗi consumer group** và trên `pending` cũ hơn N phút.
- **DLQ cho poison message**: sau `delivery_count > 5`, `XADD` sang stream `*:dlq` rồi `XACK` bản gốc.
- **Version hoá payload sự kiện** (`v: '1'`) — consumer cũ và mới cùng chạy trong lúc deploy.
- **Consumer phải idempotent** — Streams là at-least-once.
- **Stream trên instance `noeviction`** — nếu để `allkeys-lru`, cả stream có thể bị evict.
- **`XADD` không nguyên tử với ghi PostgreSQL** — dùng outbox cho sự kiện quan trọng.
- **Cân nhắc broker thật** khi: cần giữ sự kiện hàng ngày/tuần, cần replay, cần throughput rất cao, hoặc cần hệ sinh thái (schema registry, connector).
- **Không dùng keyspace notification cho logic nghiệp vụ.** Job quét database đáng tin hơn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Pub/Sub | 1 lệnh, không tốn bộ nhớ | mất tin khi không ai nghe |
| Streams | lưu trữ, ack, consumer group | phức tạp, tốn bộ nhớ, phải cắt |
| Streams + `MAXLEN` chặt | bộ nhớ ổn định | mất tin của group chậm |
| Streams + `MAXLEN` rộng | an toàn cho group chậm | tốn RAM |
| Một group nhiều consumer | chia việc, scale ngang | thứ tự không đảm bảo giữa các consumer |
| Nhiều group | mỗi hệ thống nhận đủ | mỗi group tăng chi phí theo dõi |
| Redis Streams | đã có Redis, đơn giản hơn | durability và dung lượng hạn chế |
| Kafka/RabbitMQ | durability thật, hệ sinh thái | thêm một hệ thống phải vận hành |
| Keyspace notification | không cần code publish | không đáng tin, thời điểm không chính xác |
| Job quét DB định kỳ | đáng tin, đơn giản | độ trễ bằng chu kỳ quét |

## Explain Without Notes

1. Câu hỏi duy nhất để chọn giữa Pub/Sub và Streams?
2. `PUBLISH` trả về gì, và vì sao giá trị đó quan trọng?
3. Consumer group chia việc thế nào? Nhiều group thì sao?
4. Điều gì xảy ra khi consumer crash trước `XACK`, và cơ chế nào cứu?
5. `MAXLEN` có rủi ro gì với consumer chậm?
6. Ba lý do không dùng keyspace notification cho logic quan trọng?
7. Vì sao `XADD` sau khi ghi PostgreSQL vẫn có thể mất sự kiện?
8. Redis Streams khác Kafka ở ba điểm nào?

## Related

- [Persistence & failure](05-persistence-failure.md) — Streams mất gì khi Redis restart
- [Eviction & memory](04-eviction-memory.md) — vì sao stream cần `noeviction`
- [Delivery semantics](../04-message-queues/02-delivery-semantics.md) — at-least-once, idempotency
- [Retry & DLQ](../04-message-queues/03-retry-dlq.md) — poison message
- [Outbox pattern](../04-message-queues/06-outbox-pattern.md) — sự kiện nguyên tử với ghi DB
- [Vì sao cần queue](../04-message-queues/01-why-queue.md) — chọn công cụ
- [WebSocket gateway](../../02-backend-api/02-nestjs/08-websocket-gateway.md) — Pub/Sub cho broadcast xuyên pod
- [Event-driven](../../06-system-design/07-event-driven.md) — kiến trúc hướng sự kiện
- [Cache & invalidation](01-cache-invalidation.md) — Pub/Sub cho invalidate L1

## Version / Context

Redis 7. Streams từ Redis 5. `XAUTOCLAIM` từ 6.2. `MINID` cho `XADD`/`XTRIM` từ 6.2. Trường `lag` trong `XINFO GROUPS` từ Redis 7. Với Redis Cluster, một stream nằm trọn trong một slot — nó không tự sharding.
