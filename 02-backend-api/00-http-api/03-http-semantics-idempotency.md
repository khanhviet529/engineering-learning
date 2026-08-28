---
level: intermediate
area: backend
prerequisites:
  - 01-http-request-response.md
related:
  - ../../06-system-design/03-idempotency-retry.md
  - ../../03-database/04-message-queues/02-delivery-semantics.md
---

# HTTP semantics & idempotency

> Người dùng bị charge hai lần. Không ai bấm hai lần. Không có bug trong code xử lý payment. Đây là câu chuyện về việc **network không cho bạn biết request có tới hay không**.

## Position

```text
Client → [mạng có thể mất response] → Server → Payment gateway → DB
              ↑ vấn đề nằm ở đây
```

## Problem

```text
t=0    Client: POST /payments { amount: 100 }
t=1    Server: nhận, charge thành công, ghi DB
t=2    Response bị mất trên đường về (timeout, đứt kết nối, LB restart)
t=3    Client: timeout → retry (hợp lý!)
t=4    Server: nhận request thứ hai → charge LẦN NỮA
```

Không ai làm gì sai. Client retry là đúng — nó không thể biết request đã tới hay chưa. Server xử lý là đúng — nó thấy một request hợp lệ.

Vấn đề gốc, và nó là một tính chất của mạng không thể loại bỏ:

> **Client không thể phân biệt "request không tới" với "response không về".**

Vì vậy retry là bắt buộc, và **server phải chịu được request trùng**. Đây là bài toán idempotency.

## Mental Model

```text
Idempotent = gọi N lần cho cùng KẾT QUẢ như gọi 1 lần
             (không phải "cùng response", mà "cùng trạng thái hệ thống")
```

Phân biệt hai khái niệm hay bị trộn:

```text
Safe        = không đổi state          → GET, HEAD, OPTIONS
Idempotent  = đổi state, nhưng lặp lại không đổi thêm  → PUT, DELETE
```

Vì sao ba method này idempotent tự nhiên:

```text
PUT /tasks/1 { title: 'X' }     → gọi 10 lần: title vẫn là 'X'         ✅
DELETE /tasks/1                 → gọi 10 lần: task vẫn bị xoá          ✅
POST /tasks { title: 'X' }      → gọi 10 lần: 10 task được tạo         ❌
PATCH /tasks/1 { views: +1 }    → gọi 10 lần: +10                      ❌
```

`POST` không idempotent vì server tự sinh ID. Nếu client cung cấp một identity, `POST` có thể được làm idempotent — đó chính là idempotency key.

## How It Works

### Idempotency key

Client sinh một khoá duy nhất cho **ý định** của nó, và dùng lại khoá đó khi retry:

```http
POST /payments HTTP/1.1
Idempotency-Key: 018f4c2e-7a1b-4f3d-9c8e-2b5a1d4f6e8c
Content-Type: application/json

{ "amount": 10000, "currency": "VND", "orderId": "ord_42" }
```

Server:

```ts
async function createPayment(key: string, input: PaymentInput) {
  // 1. Đã xử lý khoá này chưa?
  const existing = await db.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    if (existing.status === 'in_progress') {
      throw new ConflictError('Request đang được xử lý');   // 409
    }
    return existing.response as PaymentResult;              // trả lại KẾT QUẢ CŨ
  }

  // 2. Đặt cọc khoá — unique constraint là thứ thật sự chống race
  try {
    await db.idempotencyKey.create({
      data: { key, status: 'in_progress', requestHash: hash(input) },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Hai request song song cùng khoá — request kia đang xử lý
      throw new ConflictError('Request đang được xử lý');
    }
    throw e;
  }

  // 3. Việc thật
  const result = await paymentGateway.charge(input);

  // 4. Lưu kết quả để retry nhận lại đúng response
  await db.idempotencyKey.update({
    where: { key },
    data: { status: 'done', response: result },
  });

  return result;
}
```

Bốn chi tiết quyết định tính đúng đắn:

1. **Unique constraint ở database** là cơ chế chống race thật — không phải `if (existing)`, vì hai request song song đều đọc thấy "chưa có".
2. **Lưu response**, không chỉ đánh dấu "đã xử lý". Retry phải nhận lại **cùng** kết quả, nếu không client không biết payment ID.
3. **`requestHash`** — nếu cùng khoá nhưng body khác, đó là lỗi của client: trả 422, không phải trả lại kết quả cũ. Nếu không, một client bug có thể "ẩn" một giao dịch khác.
4. **TTL cho khoá** — dọn sau 24–48 giờ, nếu không bảng tăng mãi.

### Cách khác: unique constraint nghiệp vụ

Đôi khi bạn không cần bảng khoá riêng — dữ liệu đã có identity tự nhiên:

```sql
-- Một order chỉ có một payment thành công
CREATE UNIQUE INDEX one_payment_per_order
  ON payments (order_id) WHERE status = 'succeeded';
```

Request thứ hai vi phạm constraint → server bắt lỗi và trả về payment đã tồn tại. Đơn giản hơn và không có bảng phụ.

Đây thường là giải pháp tốt hơn khi có identity nghiệp vụ rõ ràng. Xem [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md).

### State machine — cách thứ ba

```ts
// Chỉ cho phép chuyển trạng thái hợp lệ; lần thứ hai không làm gì
const updated = await db.order.updateMany({
  where: { id, status: 'pending' },        // ← điều kiện là bảo vệ
  data: { status: 'paid', paidAt: new Date() },
});

if (updated.count === 0) {
  const order = await db.order.findUnique({ where: { id } });
  if (order?.status === 'paid') return order;      // đã xử lý — idempotent
  throw new ConflictError(`Không thể chuyển từ ${order?.status}`);
}
```

`updateMany` với điều kiện trạng thái là một câu lệnh atomic — nó chống race mà không cần lock tường minh.

### Retry đúng cách ở client

```ts
async function post<T>(url: string, body: unknown): Promise<T> {
  const key = crypto.randomUUID();          // MỘT key cho tất cả lần retry

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) return res.json();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ApiError(await res.json());   // 4xx: retry vô ích
      }
      // 5xx hoặc 429: rơi xuống retry
    } catch (e) {
      if (attempt === 2) throw e;
    }

    const delay = Math.min(1000 * 2 ** attempt, 8000) * (0.5 + Math.random());
    await sleep(delay);                          // backoff + jitter
  }
  throw new Error('unreachable');
}
```

Ba điều bắt buộc: **key sinh một lần** (ngoài vòng lặp — sinh trong vòng lặp làm idempotency vô nghĩa), **không retry 4xx**, **backoff có jitter**.

## Example

```text
Timeline với idempotency key:

t=0  Client: POST /payments  Idempotency-Key: abc
t=1  Server: chưa thấy abc → charge → lưu { abc: { paymentId: 'pay_1' } }
t=2  Response mất
t=3  Client: retry, CÙNG key abc
t=4  Server: thấy abc, status=done → trả lại { paymentId: 'pay_1' }
     → Không charge lần hai. Client nhận đúng kết quả.
```

## Prediction

1. `PUT /tasks/1 { title: 'X' }` gọi 5 lần — bao nhiêu thay đổi?
2. `POST /tasks { title: 'X' }` gọi 5 lần — bao nhiêu task?
3. Response bị mất, client retry `DELETE /tasks/1` — vấn đề gì?
4. Idempotency key được sinh **trong** vòng lặp retry — bảo vệ còn lại bao nhiêu?
5. Chỉ check `if (existing)` không có unique constraint, 2 request song song cùng key — bao nhiêu lần charge?
6. Cùng key nhưng body khác — server nên làm gì?
7. Server đánh dấu "đã xử lý" nhưng không lưu response — client retry nhận được gì?

<details>
<summary>Đáp án</summary>

1. Một thay đổi hiệu quả (4 lần sau ghi cùng giá trị).
2. 5 task.
3. Không có vấn đề — `DELETE` idempotent.
4. Không còn gì — mỗi lần retry là một key mới, server coi là request mới.
5. Có thể 2 — cả hai đọc thấy "chưa có" trước khi ai ghi. Đây là lý do phải có unique constraint.
6. Trả 422 — đó là lỗi của client, không nên trả lại kết quả cũ.
7. Không có payment ID — client không biết giao dịch nào đã thành công.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Không có idempotency, thêm delay + timeout ở client, retry | Hai record được tạo |
| Sinh key trong vòng lặp retry | Idempotency không hoạt động |
| Chỉ check tồn tại, không unique constraint, gửi 2 request song song | Double charge |
| Thêm unique constraint, làm lại | Một thành công, một 409 |
| Không lưu response, retry sau khi xử lý xong | Client không biết kết quả |
| Cùng key, body khác, server trả lại kết quả cũ | Giao dịch thứ hai bị "ẩn" im lặng |
| Retry 400 Bad Request | Vòng lặp vô ích; đo số request |
| Retry không jitter với 1000 client sau khi server restart | Thundering herd |
| Không có TTL cho bảng key | Bảng tăng mãi; kiểm tra size sau load test |

## What Usually Goes Wrong

- **`POST` không có idempotency key** cho thao tác quan trọng → double charge, duplicate order.
- **Key sinh lại mỗi lần retry** → không có bảo vệ.
- **Chỉ check-then-insert** không có unique constraint → race condition.
- **Không lưu response** → retry thành công nhưng client không có kết quả.
- **Không kiểm tra body hash** → cùng key với body khác trả sai kết quả.
- **Retry 4xx** → tải vô ích.
- **Retry không backoff/jitter** → thundering herd.
- **Không có TTL** cho bảng idempotency key.
- **Webhook không idempotent** — mọi provider gửi lại. Xem [Route Handlers](../../01-web-frontend/03-nextjs/behavior/05-route-handlers-server-actions.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Idempotent = trả cùng response | = cùng **trạng thái hệ thống**; response cũ được lưu lại là cách thực hiện tốt |
| `PATCH` idempotent | Theo chuẩn thì không |
| Disable nút chống được duplicate | Không chống retry của mạng, hai tab, hoặc client khác |
| Retry là lỗi của client | Retry là hành vi đúng; server phải chịu được |
| `if (exists) return` là đủ | Race condition; cần unique constraint |
| Transaction giải quyết được | Transaction bảo vệ trong một request, không giữa hai request |
| Chỉ payment cần idempotency | Mọi mutation gây side effect ngoài DB (email, webhook, job) đều cần |

## Debugging

1. **Duplicate record** → tìm hai record có cùng nội dung, `createdAt` cách nhau vài giây. Đó là dấu hiệu retry.
2. **Đối chiếu log theo request ID** — nếu hai request có cùng `Idempotency-Key` mà đều tạo record, key không được kiểm tra đúng.
3. **Tái hiện** bằng cách thêm delay ở server rồi giảm timeout ở client:
   ```bash
   # Gửi 2 request song song cùng key
   for i in 1 2; do curl -X POST ... -H 'Idempotency-Key: same' & done; wait
   ```
4. **Kiểm tra unique constraint có thật tồn tại** trong DB — không phải chỉ trong code migration chưa chạy.
5. **Đếm số retry** trong log của client — nếu cao bất thường, kiểm tra timeout có quá ngắn.
6. **Log mọi lần hit idempotency key** — nó cho biết retry rate thật của hệ thống.

## Production Considerations

- **`Idempotency-Key` cho mọi `POST` gây side effect không hoàn tác được** (payment, tạo đơn, gửi email, gọi API bên thứ ba).
- **Unique constraint ở database** là lớp cuối, và là lớp duy nhất chống được race.
- **Lưu cả response**, không chỉ trạng thái.
- **TTL 24–48 giờ** cho bảng key, dọn định kỳ.
- **Timeout ở client** phải dài hơn thời gian xử lý p99 của server — nếu ngắn hơn, bạn tự tạo retry storm.
- **Backoff + jitter** cho mọi retry. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **Chỉ retry lỗi transient** (5xx, timeout, 429), không retry 4xx.
- **Webhook**: verify signature + xử lý idempotent theo event ID.
- Metric: retry rate và idempotency hit rate là tín hiệu sớm của vấn đề mạng hoặc timeout sai.

## Trade-offs

| Cách | Được | Mất |
|---|---|---|
| Idempotency key + bảng | tổng quát, dùng cho mọi thao tác | thêm bảng, thêm logic, cần TTL |
| Unique constraint nghiệp vụ | đơn giản, không bảng phụ | chỉ dùng được khi có identity tự nhiên |
| State machine (`updateMany` có điều kiện) | atomic, không bảng phụ | chỉ cho chuyển trạng thái |
| Không idempotency | ít code | duplicate khi có retry — chỉ là vấn đề thời gian |
| Timeout dài | ít retry sai | client chờ lâu, giữ tài nguyên |
| Timeout ngắn | phản hồi nhanh | nhiều retry, nhiều duplicate nếu không idempotent |

## Explain Without Notes

1. Vì sao client không thể biết request đã tới hay chưa? Hệ quả?
2. Phân biệt safe và idempotent, cho ví dụ method cho mỗi loại.
3. Bốn chi tiết bắt buộc của một implementation idempotency key đúng?
4. Vì sao `if (exists) return` không đủ?
5. Vì sao phải lưu response, không chỉ trạng thái?

## Related

- [HTTP request/response](01-http-request-response.md) — tính chất method
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — góc nhìn hệ thống
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once cần idempotency
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — unique constraint
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Async race condition](../../01-web-frontend/02-react/behavior/03-async-race-condition.md) — double submit ở client
- [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md)
