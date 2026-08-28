---
level: advanced
area: backend
prerequisites:
  - ../../03-database/04-message-queues/02-delivery-semantics.md
related:
  - 01-sending-email.md
  - ../../03-database/04-message-queues/06-outbox-pattern.md
  - ../../05-cross-cutting/security/05-ssrf-supply-chain.md
---

# Webhook gửi ra

> Khi bạn **nhận** webhook, bạn là client. Khi bạn **gửi** webhook, bạn trở thành một provider — và giờ bạn phải giải quyết những bài toán mà Stripe giải quyết cho bạn: ký, retry, ordering, endpoint chết, và SSRF.

## Position

```text
Sự kiện trong hệ thống bạn
      ↓ outbox (cùng transaction)
Dispatcher (queue) → HTTP POST → endpoint của KHÁCH HÀNG
      ↓ họ trả 5xx hoặc timeout
Retry có backoff → DLQ → disable endpoint
```

Note này về **chiều gửi ra**. Chiều nhận vào (verify signature, raw body, idempotent) ở [Route Handlers & Server Actions](../../01-web-frontend/03-nextjs/behavior/05-route-handlers-server-actions.md).

## Problem

```ts
// Khách hàng muốn nhận thông báo khi đơn hàng đổi trạng thái
async updateOrderStatus(id: string, status: OrderStatus) {
  const order = await this.prisma.order.update({ where: { id }, data: { status } });

  // Gửi webhook cho khách hàng
  await fetch(order.webhookUrl, {
    method: 'POST',
    body: JSON.stringify({ orderId: id, status }),
  });

  return order;
}
```

Bảy vấn đề, và chúng đều là vấn đề của **bạn**, không phải của khách hàng:

| Vấn đề | Hậu quả |
|---|---|
| Gửi trong request | endpoint khách chậm 30 giây → API của bạn chậm 30 giây |
| Không timeout | một khách hàng treo endpoint → cạn connection pool của bạn |
| Không retry | endpoint tạm lỗi → sự kiện mất vĩnh viễn |
| Không ký | khách hàng **không thể** biết request thật đến từ bạn |
| Không idempotency | retry → khách xử lý hai lần |
| `webhookUrl` do khách nhập | **SSRF** — trỏ vào `169.254.169.254` để đọc metadata cloud của bạn |
| Endpoint chết vĩnh viễn | retry mãi, tốn tài nguyên, không ai biết |

Vấn đề SSRF là nghiêm trọng nhất: khách hàng đăng ký `http://169.254.169.254/latest/meta-data/iam/security-credentials/` và **server của bạn** sẽ gọi nó, rồi (nếu bạn log response hoặc trả lỗi kèm body) tiết lộ credential IAM. Xem [SSRF](../../05-cross-cutting/security/05-ssrf-supply-chain.md).

## Mental Model

```text
Bạn đang xây một API, nhưng CHIỀU NGƯỢC LẠI:
  - Bạn là client, khách hàng là server
  - Bạn không kiểm soát độ tin cậy của phía kia
  - Bạn phải chịu đựng endpoint chậm, sai, và chết

⇒ Mọi nguyên tắc reliability áp dụng, nhưng bạn ở phía PHẢI RETRY
```

Bốn cam kết bạn phải chọn và **tài liệu hoá** — khách hàng cần biết để viết handler đúng:

```text
1. DELIVERY     at-least-once (thực tế duy nhất khả thi)
                ⇒ khách hàng PHẢI idempotent
2. ORDERING     không đảm bảo, HOẶC đảm bảo theo từng resource
                ⇒ gửi kèm sequence/timestamp để họ tự sắp
3. RETRY        bao nhiêu lần, backoff thế nào, sau bao lâu thì bỏ
4. SIGNATURE    thuật toán, header nào, cách tính
```

Không tài liệu hoá bốn thứ này nghĩa là mọi khách hàng sẽ tự đoán, và một nửa sẽ đoán sai.

## How It Works

### Ký payload — HMAC với timestamp

```ts
import crypto from 'node:crypto';

function sign(payload: string, secret: string, timestamp: number): string {
  // Timestamp TRONG chuỗi được ký → chống replay
  const signed = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(signed).digest('hex');
}

// Gửi
const body = JSON.stringify(event);
const ts = Math.floor(Date.now() / 1000);

await fetch(endpoint.url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Id': event.id,                        // để khách dedupe
    'X-Webhook-Timestamp': String(ts),
    'X-Webhook-Signature': `v1=${sign(body, endpoint.secret, ts)}`,
  },
  body,
  signal: AbortSignal.timeout(10_000),
});
```

Ba chi tiết quyết định tính an toàn:

1. **Timestamp nằm trong chuỗi được ký.** Nếu chỉ ký payload, attacker chặn được một request hợp lệ có thể **replay** nó mãi mãi. Khách hàng phải từ chối request có timestamp lệch > 5 phút.
2. **Prefix version (`v1=`)** — để bạn đổi thuật toán sau này mà không phá khách hàng. Gửi cả hai (`v1=...,v2=...`) trong giai đoạn chuyển đổi.
3. **Secret riêng cho từng endpoint**, và cho phép **rotate** (hai secret cùng hợp lệ trong một khoảng).

Và điều bạn phải viết trong tài liệu cho khách hàng — họ **phải** so sánh bằng hàm constant-time:

```ts
// Tài liệu cho khách hàng
crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));   // ✅
received === expected;                                                  // ❌ timing attack
```

### Chống SSRF — validate URL khi đăng ký VÀ khi gửi

```ts
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

async function assertSafeWebhookUrl(raw: string): Promise<void> {
  const url = new URL(raw);

  // 1. Chỉ HTTPS
  if (url.protocol !== 'https:') throw new ValidationError('Chỉ hỗ trợ HTTPS');

  // 2. Không port lạ
  if (url.port && !['', '443'].includes(url.port)) {
    throw new ValidationError('Chỉ hỗ trợ port 443');
  }

  // 3. Resolve DNS rồi kiểm tra IP — KHÔNG chỉ kiểm tra hostname
  const records = await lookup(url.hostname, { all: true });
  for (const { address } of records) {
    const ip = ipaddr.parse(address);
    const range = ip.range();
    // private, loopback, linkLocal (169.254.x — metadata cloud!), uniqueLocal...
    if (range !== 'unicast') {
      throw new ValidationError('URL trỏ vào địa chỉ nội bộ');
    }
  }
}
```

Điểm quan trọng: kiểm tra hostname **không đủ**. `evil.com` có thể có A record trỏ về `127.0.0.1`. Phải resolve và kiểm tra **IP**.

Và vẫn chưa đủ — có **DNS rebinding**: khách hàng cho hostname resolve về IP công khai lúc đăng ký, rồi đổi sang IP nội bộ lúc bạn gửi. Ba cách phòng:

```text
1. Validate lại NGAY TRƯỚC khi gửi (không chỉ lúc đăng ký)
2. Resolve một lần, gửi tới IP đó, đặt Host header — chặn rebinding
3. Gửi webhook từ một egress proxy / network riêng KHÔNG có quyền
   truy cập metadata service và VPC nội bộ    ← biện pháp mạnh nhất
```

Cách 3 là biện pháp kiến trúc và nó loại bỏ cả lớp vấn đề — nếu process gửi webhook không có đường tới `169.254.169.254`, SSRF không lấy được gì.

### Retry — backoff dài, không phải backoff ngắn

```ts
// Webhook khác API call thông thường: khách hàng có thể down HÀNG GIỜ
const RETRY_SCHEDULE_SEC = [
  10,        // 10 giây
  60,        // 1 phút
  300,       // 5 phút
  1800,      // 30 phút
  7200,      // 2 giờ
  21600,     // 6 giờ
  86400,     // 24 giờ
];   // tổng ~31 giờ, 7 lần thử
```

So sánh với retry của một API call nội bộ (3 lần trong 10 giây): webhook cần **lịch retry dài hơn nhiều bậc**, vì nguyên nhân thất bại thường là "khách hàng đang deploy" hoặc "server họ down qua đêm".

```ts
@Processor('webhook')
export class WebhookProcessor {
  @Process('deliver')
  async deliver(job: Job<DeliveryJob>) {
    const { deliveryId } = job.data;
    const delivery = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId }, include: { endpoint: true },
    });

    // Circuit breaker: endpoint đang chết → đừng gọi
    if (delivery.endpoint.status === 'DISABLED') {
      await this.markSkipped(deliveryId, 'ENDPOINT_DISABLED');
      return;
    }

    await assertSafeWebhookUrl(delivery.endpoint.url);      // validate LẠI

    const started = Date.now();
    try {
      const res = await this.post(delivery);

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: res.ok ? 'DELIVERED' : 'FAILED',
          responseStatus: res.status,
          // Lưu MỘT PHẦN response để khách hàng tự debug
          responseBody: (await res.text()).slice(0, 2000),
          durationMs: Date.now() - started,
          attempt: delivery.attempt + 1,
        },
      });

      if (!res.ok) {
        // 4xx (trừ 429) = lỗi của khách, retry vô ích
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          await this.recordPermanentFailure(delivery);
          return;                        // KHÔNG throw → không retry
        }
        throw new Error(`HTTP ${res.status}`);   // 5xx/429 → retry
      }

      await this.resetFailureCount(delivery.endpointId);
    } catch (err) {
      await this.incrementFailureCount(delivery.endpointId);
      throw err;                          // để BullMQ retry theo schedule
    }
  }
}
```

Hai điều quan trọng:

- **Không retry 4xx** (trừ 429). `400` nghĩa là payload của bạn sai theo họ, hoặc handler của họ có bug — retry 7 lần trong 31 giờ không sửa được gì.
- **Lưu response body (giới hạn)** — đây là thứ khách hàng cần khi họ hỏi "vì sao webhook không tới". Không có nó, bạn không trả lời được.

### Endpoint chết — phải tự disable

```ts
async incrementFailureCount(endpointId: string) {
  const ep = await this.prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { consecutiveFailures: { increment: 1 } },
  });

  // Sau N lần thất bại LIÊN TIẾP: tạm dừng và thông báo
  if (ep.consecutiveFailures >= 20) {
    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { status: 'DISABLED', disabledAt: new Date() },
    });
    await this.mailer.send(ep.ownerEmail, 'webhook-disabled', { url: ep.url });
  }
}
```

Không có bước này, một endpoint đã tắt vĩnh viễn (khách hàng ngừng dùng, domain hết hạn) sẽ nhận retry mãi — và với 1000 khách hàng, đó là tải thật.

Và **phải có cách bật lại**: một nút "Test & re-enable" trong dashboard, gửi một ping và bật lại nếu thành công.

### Ordering — không đảm bảo, nhưng giúp khách hàng xử lý

```ts
// Gửi kèm thông tin để khách tự sắp xếp
{
  "id": "evt_01j8x...",              // unique, để dedupe
  "type": "order.status_changed",
  "createdAt": "2026-08-28T10:00:00.123Z",
  "sequence": 42,                     // tăng dần THEO RESOURCE
  "data": {
    "orderId": "ord_123",
    "status": "shipped",
    "previousStatus": "paid"          // giúp khách phát hiện event bị thiếu
  }
}
```

Ba trường giúp khách hàng xử lý đúng dù thứ tự sai:

- **`id`** — dedupe (at-least-once nghĩa là họ sẽ nhận trùng).
- **`sequence` theo resource** — họ bỏ event có sequence nhỏ hơn cái đã xử lý.
- **`previousStatus`** — họ phát hiện được nếu bỏ mất một event ở giữa.

Nếu bạn cần **đảm bảo thứ tự**, phải serialize theo resource: một queue riêng cho mỗi `orderId`, hoặc lock. Điều đó giảm throughput đáng kể — nên chỉ làm khi nghiệp vụ thật sự cần.

### Outbox — sự kiện không được mất

```ts
// Sự kiện và dữ liệu commit CÙNG NHAU
await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.update({ where: { id }, data: { status } });

  const endpoints = await tx.webhookEndpoint.findMany({
    where: { orgId: order.orgId, status: 'ACTIVE', events: { has: 'order.status_changed' } },
  });

  await tx.outbox.createMany({
    data: endpoints.map((ep) => ({
      type: 'webhook.deliver',
      payload: { endpointId: ep.id, event: buildEvent(order) },
      idempotencyKey: `${order.id}:${status}:${ep.id}`,
    })),
  });
});
// Poller đọc outbox → queue → worker gửi
```

Không có outbox: `queue.add()` ngoài transaction thì rollback vẫn gửi webhook về trạng thái không tồn tại. Xem [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md).

## Example

```text
Kiến trúc webhook gửi ra

Sự kiện → outbox (trong transaction)
       → poller → queue (một queue, hoặc một queue per endpoint nếu cần ordering)
       → worker: validate URL → sign → POST (timeout 10s)
                 ├─ 2xx        → DELIVERED, reset failure count
                 ├─ 4xx        → FAILED PERMANENT, không retry
                 ├─ 5xx/429/timeout → retry theo schedule [10s…24h]
                 └─ 20 lần liên tiếp thất bại → DISABLE endpoint + email

Bảng cần có:
  webhook_endpoint    url, secret, events[], status, consecutiveFailures
  webhook_delivery    eventId, endpointId, attempt, status, responseStatus,
                      responseBody (2KB), durationMs, nextRetryAt

Dashboard cho khách hàng:
  danh sách delivery + response + nút "Resend"    ← giảm rất nhiều support ticket
```

Bảng `webhook_delivery` với `responseBody` là thứ biến "webhook không hoạt động" từ một cuộc tranh luận thành một câu trả lời có bằng chứng.

## Prediction

1. `await fetch(customerUrl)` trong request, endpoint khách chậm 30 giây — API của bạn chậm bao lâu?
2. Không có timeout, 50 khách hàng có endpoint treo — pool của bạn thế nào?
3. Ký chỉ payload, không có timestamp — attacker chặn được một request hợp lệ làm gì được?
4. Khách hàng đăng ký `https://evil.com/hook`, `evil.com` có A record `127.0.0.1` — kiểm tra hostname có phát hiện?
5. Validate URL lúc đăng ký, khách đổi DNS sau đó — bạn gửi tới đâu?
6. Retry 3 lần trong 10 giây, khách hàng deploy mất 5 phút — sự kiện còn không?
7. Retry `400 Bad Request` 7 lần trong 31 giờ — được gì?
8. Không disable endpoint chết, 1000 khách, 100 endpoint chết vĩnh viễn — tải retry?
9. Khách hàng nhận cùng event 2 lần (at-least-once), họ không dedupe — hậu quả?
10. Không lưu response body, khách hỏi "vì sao webhook fail" — bạn trả lời thế nào?

<details>
<summary>Đáp án</summary>

1. 30 giây — độ trễ của khách hàng thành độ trễ của bạn.
2. Cạn — mỗi endpoint treo giữ một connection.
3. **Replay** request đó vô hạn.
4. **Không** — phải resolve DNS và kiểm tra IP.
5. Tới IP mới — DNS rebinding. Phải validate lại trước khi gửi.
6. **Mất** — retry hết trước khi họ sẵn sàng.
7. Không gì — 4xx là lỗi không tự khỏi.
8. 100 endpoint × 7 lần retry, lặp lại mỗi sự kiện — tải thật và vô ích.
9. Xử lý trùng (charge hai lần, gửi hai email) — nhưng đó là lỗi của họ nếu bạn đã tài liệu hoá at-least-once.
10. Không trả lời được — đây là lý do phải lưu.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Endpoint test trả về sau 60 giây, gọi trong request | API của bạn chậm 60 giây |
| Bỏ timeout, 20 endpoint treo song song | Đếm connection đang mở |
| Ký không có timestamp, replay request cũ | Được chấp nhận |
| Thêm timestamp + kiểm tra lệch 5 phút | Replay bị từ chối |
| Đăng ký URL trỏ `http://169.254.169.254/latest/meta-data/` | Nếu không validate IP, server bạn gọi nó |
| Validate IP, làm lại | Bị chặn |
| Đổi DNS sau khi đăng ký (dùng dịch vụ rebinding test) | Gửi tới IP nội bộ nếu không validate lại |
| Retry 3 lần/10 giây, tắt endpoint 5 phút rồi bật | Sự kiện mất |
| Đổi sang schedule dài | Sự kiện tới sau khi endpoint sống lại |
| Endpoint trả 400 mãi, retry đầy đủ | Đếm request vô ích |
| 50 endpoint chết, không disable, gửi 1000 sự kiện | Đo tải và thời gian queue |
| Không có `id` trong payload, khách nhận trùng | Họ xử lý hai lần |

Thí nghiệm 5–6 nên chạy trong lab một lần — SSRF qua webhook là lỗ hổng thật và dễ bỏ sót.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Gửi webhook là gọi một `fetch` | Bạn đang trở thành provider với đầy đủ nghĩa vụ |
| Ký payload là đủ | Cần timestamp trong chuỗi ký để chống replay |
| Kiểm tra hostname chặn được SSRF | Phải resolve và kiểm tra IP; và cả rebinding |
| Retry như API call thường | Webhook cần schedule dài hàng giờ |
| Nên retry mọi lỗi | 4xx (trừ 429) retry vô ích |
| Endpoint chết không sao | Nó tạo tải retry vô hạn |
| Đảm bảo được ordering | Chỉ nếu serialize theo resource, và nó giảm throughput |
| Khách hàng sẽ tự idempotent | Chỉ nếu bạn tài liệu hoá at-least-once và gửi `id` |
| Không cần lưu response | Đó là thứ duy nhất trả lời được "vì sao fail" |

## Debugging

1. **Khách hàng nói "không nhận được webhook"** → tra bảng `webhook_delivery` theo `endpointId` và khoảng thời gian. Có `responseStatus` và `responseBody` thì câu trả lời là dứt khoát, không phải tranh luận.
2. **Không có delivery record nào** → sự kiện chưa vào outbox. Kiểm tra điều kiện `events: { has: ... }` và `status: 'ACTIVE'`.
3. **Delivery `FAILED` với 4xx** → gửi `responseBody` cho khách hàng; lỗi ở handler của họ.
4. **Delivery treo ở `PENDING`** → queue không xử lý; kiểm tra worker và `nextRetryAt`.
5. **Endpoint bị disable** → xem `consecutiveFailures` và delivery gần nhất; thường là domain hết hạn hoặc URL đổi.
6. **Nghi SSRF** → thử đăng ký URL nội bộ trên staging; nếu qua được, validation đang thiếu.
7. **Metric cần có**: delivery success rate theo endpoint, p99 duration, số endpoint bị disable, độ sâu queue.

## Production Considerations

- **Outbox trong transaction** — sự kiện không được mất và không được gửi khi rollback.
- **Gửi qua queue với worker riêng**, không trong request.
- **Timeout 10 giây** cho mỗi lần POST; và **`AbortSignal.timeout`**, không chỉ config của HTTP client.
- **HMAC + timestamp + version prefix**; secret riêng mỗi endpoint, hỗ trợ rotate.
- **Validate URL cả lúc đăng ký và lúc gửi**; và gửi từ **network riêng không có quyền truy cập metadata/VPC** — đây là biện pháp mạnh nhất chống SSRF.
- **Retry schedule dài** (tới ~24–48 giờ), không retry 4xx.
- **Auto-disable sau N lần thất bại liên tiếp** + email cho khách hàng + cách re-enable.
- **Lưu delivery log với response body giới hạn** (1–2KB) và TTL (30–90 ngày).
- **Dashboard cho khách hàng**: xem delivery, xem response, nút Resend. Nó giảm support ticket nhiều hơn mọi tài liệu.
- **Tài liệu hoá bốn cam kết**: at-least-once, ordering, retry schedule, cách verify signature — kèm code mẫu.
- **Rate limit số webhook gửi tới một endpoint** để một khách hàng có nhiều sự kiện không làm sập endpoint của họ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Gửi trong request | đơn giản, biết ngay | độ trễ của khách thành của bạn |
| Queue + outbox | tin cậy, retry, không mất | thêm hạ tầng, eventual |
| Retry schedule dài | chịu được downtime của khách | sự kiện có thể tới rất muộn |
| Retry ngắn | phản hồi nhanh | mất sự kiện khi khách down lâu |
| Đảm bảo ordering | khách xử lý đơn giản hơn | throughput giảm, phức tạp |
| Không đảm bảo ordering | scale tốt | khách phải tự xử lý |
| Auto-disable | không tốn tài nguyên vô ích | khách có thể mất sự kiện nếu không để ý email |
| Egress proxy riêng | chặn SSRF ở tầng kiến trúc | thêm hạ tầng |
| Lưu response body | debug được | tốn storage, có thể chứa dữ liệu của khách |

## Explain Without Notes

1. Vì sao gửi webhook biến bạn thành provider, và bốn cam kết phải tài liệu hoá?
2. Vì sao timestamp phải nằm **trong** chuỗi được ký?
3. Vì sao kiểm tra hostname không chặn được SSRF, và ba lớp phòng?
4. Vì sao retry schedule của webhook dài hơn API call thường nhiều bậc?
5. Vì sao không retry 4xx?
6. Ba trường nào trong payload giúp khách hàng xử lý đúng dù thứ tự sai?

## Related

- [Gửi email](01-sending-email.md) — cùng họ side effect ra ngoài
- [File storage](03-file-storage.md)
- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) — sự kiện không mất
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once
- [Retry & DLQ](../../03-database/04-message-queues/03-retry-dlq.md)
- [Ordering & partitioning](../../03-database/04-message-queues/04-ordering-partitioning.md)
- [SSRF & supply chain](../../05-cross-cutting/security/05-ssrf-supply-chain.md) — rủi ro chính
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Route Handlers & Server Actions](../../01-web-frontend/03-nextjs/behavior/05-route-handlers-server-actions.md) — chiều nhận webhook
- [Event-driven systems](../../06-system-design/07-event-driven.md)
