---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-logs-metrics-traces.md
related:
  - 03-correlation-tracing.md
  - ../security/06-secrets-management.md
---

# Structured logging

> Trong một sự cố, đội ngũ cần trả lời: "có bao nhiêu người dùng bị ảnh hưởng?". Log có đủ thông tin — mỗi dòng ghi `Payment failed for user 4821: card declined`. Nhưng để đếm được người dùng duy nhất, ai đó phải viết một biểu thức chính quy, và nó không khớp với ba biến thể khác của cùng thông điệp đã tích tụ qua hai năm. **Câu trả lời mất 40 phút cho một truy vấn lẽ ra là một dòng.**

## Position

```text
log = chuỗi văn bản   → đọc được bởi NGƯỜI, ở quy mô nhỏ
log = sự kiện có cấu trúc → TRUY VẤN ĐƯỢC bởi máy, ở mọi quy mô
                            ↑ note này
```

## Problem

```text
Ở quy mô nhỏ: bạn ĐỌC log.
Ở quy mô thật: bạn TRUY VẤN log.

  "p99 của endpoint nào tăng?"
  "bao nhiêu người dùng duy nhất bị ảnh hưởng?"
  "lỗi này bắt đầu từ phiên bản nào?"
  "tenant nào chiếm 80% lỗi?"

Log dạng chuỗi không trả lời được những câu này mà không có regex —
và regex trên log là thứ luôn hỏng khi thông điệp thay đổi.
```

## Mental Model

### Log là sự kiện có schema, không phải câu văn

```text
✗ logger.info(`Payment failed for user ${userId}: ${reason}`)
   → một chuỗi; muốn dùng phải phân tích ngược

✓ logger.info({ event: 'payment_failed', userId, reason, amountCents, orderId },
              'payment failed')
   → các TRƯỜNG; truy vấn trực tiếp:
     count(distinct userId) where event = 'payment_failed' and reason = 'card_declined'
```

Điểm mấu chốt: **thông điệp là nhãn để người đọc, các trường mới là dữ liệu.** Thông điệp nên là hằng số — nếu nó chứa giá trị nội suy, bạn đang tạo cardinality vô hạn trong một trường đáng lẽ để nhóm.

### Trường bắt buộc trong mọi dòng

```text
timestamp   ISO 8601 với múi giờ (hoặc epoch ms)
level       error | warn | info | debug
message     hằng số, mô tả loại sự kiện
service     tên service
version     phiên bản/commit đang chạy   ← "lỗi bắt đầu từ bản nào?"
env         production | staging
trace_id    ← nối với trace và với các dòng log khác của cùng request
```

Và thêm khi có ngữ cảnh:

```text
user_id, tenant_id, request_id, route, method, status, duration_ms, err
```

Nếu `trace_id` và `version` không có trong mọi dòng, hai câu hỏi phổ biến nhất khi có sự cố đều không trả lời được nhanh.

### Chuẩn hoá tên trường giữa các service

```text
service A: { userId: 42 }
service B: { user_id: 42 }
service C: { uid: 42 }

⇒ không tương quan được, không dashboard chung được

→ chọn MỘT quy ước và ghi vào tài liệu; tốt nhất là dùng
  quy ước OpenTelemetry semantic conventions (`user.id`, `http.route`, ...)
  để tương thích với công cụ có sẵn
```

Đây là loại quyết định rẻ vào ngày đầu và rất đắt vào năm thứ hai.

### Ngữ cảnh tự động: đừng truyền tay

```ts
// ✗ truyền userId qua mọi tầng chỉ để log
async createOrder(dto: Dto, userId: string) {
  this.logger.info({ userId }, 'creating order');
  await this.inventory.reserve(dto.items, userId);   // userId chỉ để log
}
```

```ts
// ✓ AsyncLocalStorage: ngữ cảnh đi theo request, không xuất hiện trong chữ ký hàm
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ traceId: string; userId?: string; tenantId?: string }>();

// middleware
app.use((req, res, next) => {
  const traceId = trace.getActiveSpan()?.spanContext().traceId ?? randomUUID();
  res.setHeader('x-trace-id', traceId);                 // trả về cho client — hỗ trợ dùng được
  requestContext.run({ traceId, userId: req.user?.id, tenantId: req.user?.tenantId }, next);
});

// logger tự lấy ngữ cảnh
const logger = pino({
  mixin: () => requestContext.getStore() ?? {},         // MỌI dòng log tự có traceId, userId
  base: { service: 'api', version: process.env.GIT_SHA, env: process.env.NODE_ENV },
});
```

Sau thay đổi này, mọi dòng log ở mọi tầng — kể cả trong thư viện của bạn, kể cả trong job xử lý lỗi — đều có `trace_id` mà không ai phải nhớ truyền nó.

Trả `x-trace-id` về client là bổ sung nhỏ nhưng đáng giá: người dùng báo lỗi kèm mã đó, và bạn tìm được đúng request trong một truy vấn.

### Redact: đặt ở tầng logger, không ở chỗ gọi

```ts
const logger = pino({
  redact: {
    paths: [
      'password', '*.password', 'token', '*.token', 'secret', '*.secret',
      'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      'creditCard', '*.creditCard', 'ssn', '*.ssn',
    ],
    censor: '[REDACTED]',
  },
});
```

```text
Vì sao ở tầng logger:
  ai đó SẼ viết logger.info({ req }) để debug và quên gỡ
  → redact ở logger biến việc đó thành vô hại
  → dựa vào sự cẩn thận của từng người là chiến lược thất bại
```

Ngoài bí mật, còn dữ liệu cá nhân: email, số điện thoại, địa chỉ. Chúng thường **không cần** trong log — `user_id` là đủ để nối tới dữ liệu thật khi cần, và nó không tạo nghĩa vụ pháp lý cho kho log.

### Ghi log lỗi cho đúng

```ts
// ✗ mất stack trace và mọi thông tin của error
logger.error(`Failed: ${err.message}`);
logger.error({ err: err.message }, 'failed');

// ✓ serializer chuẩn — giữ stack, type, cause
const logger = pino({ serializers: { err: pino.stdSerializers.err } });
logger.error({ err, orderId, userId }, 'order creation failed');
```

```text
Ba thứ phải có trong log lỗi:
  ① stack trace       → biết ở đâu
  ② ngữ cảnh nghiệp vụ → biết cái gì (orderId, userId)
  ③ err.cause          → chuỗi nguyên nhân, nếu bạn dùng `new Error(msg, { cause })`
```

Và một nguyên tắc chống nhiễu: **log lỗi MỘT LẦN, ở nơi nó được xử lý.** Log ở mọi tầng khi ném lại tạo ra năm dòng cho một sự kiện, và làm việc đếm lỗi trở nên vô nghĩa.

### Log ở đâu: stdout, không phải file

```text
Trong container: ghi ra stdout/stderr
  → runtime thu thập, xoay vòng, chuyển tiếp
  → app không cần biết gì về đường dẫn, quyền ghi, xoay file

✗ ghi file trong container → đầy đĩa, mất khi container chết, cần volume
✗ gửi trực tiếp tới hệ thống log từ app
   → app phụ thuộc vào nó; nó chậm thì app chậm
   → dùng agent/sidecar hoặc DaemonSet để chuyển tiếp
```

Xem [Logs & services](../../04-infrastructure/00-linux/06-logs-and-services.md).

### Lấy mẫu log khi lưu lượng lớn

```text
Ở 10.000 rps, log mỗi request là 864 triệu dòng/ngày.

Chiến lược:
  · ERROR       → 100%, không bao giờ lấy mẫu
  · WARN        → 100%
  · INFO nghiệp vụ (đơn hàng, thanh toán) → 100%
  · INFO truy cập (mỗi request HTTP)      → lấy mẫu, ví dụ 1–10%
  · DEBUG       → tắt; bật theo tenant/route khi cần điều tra

Và: nếu một request có LỖI, giữ TOÀN BỘ log của nó (theo trace_id).
```

Nguyên tắc cuối là điều làm lấy mẫu log dùng được: bạn giảm khối lượng mà không mất chính những request cần điều tra.

### Log không phải audit trail

```text
LOG        vận hành, có thể mất, lấy mẫu được, lưu 14–30 ngày
AUDIT      pháp lý/tuân thủ, KHÔNG được mất, không lấy mẫu, lưu nhiều năm
           → ghi vào bảng/kho riêng, có kiểm soát truy cập riêng

Dùng log làm audit trail = mất dữ liệu tuân thủ vào ngày bạn bật lấy mẫu.
```

## Example

Cấu hình đầy đủ và cách nó thay đổi khả năng truy vấn:

```ts
// logger.ts
import pino from 'pino';
import { requestContext } from './context';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'order-api',
    version: process.env.GIT_SHA ?? 'dev',
    env: process.env.NODE_ENV,
  },
  mixin: () => requestContext.getStore() ?? {},
  serializers: { err: pino.stdSerializers.err },
  redact: {
    paths: ['password', '*.password', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),        // "info" thay vì 30 — dễ truy vấn hơn
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

```ts
// dùng: thông điệp là HẰNG SỐ, dữ liệu nằm ở trường
logger.info({ event: 'payment_failed', orderId, reason: 'card_declined', amountCents: 5_000 },
  'payment failed');
```

Một dòng log sinh ra:

```json
{
  "level": "info", "time": "2026-08-28T03:14:07.221Z",
  "service": "order-api", "version": "a1b2c3d", "env": "production",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736", "user_id": "u_482", "tenant_id": "t_9",
  "event": "payment_failed", "orderId": "o_771", "reason": "card_declined", "amountCents": 5000,
  "msg": "payment failed"
}
```

Và những câu hỏi trong sự cố ở đầu note trở thành truy vấn một dòng:

```text
bao nhiêu người dùng bị ảnh hưởng?
  count_distinct(user_id) where event = "payment_failed" and time > now-1h

lý do nào chiếm đa số?
  count() by reason where event = "payment_failed"

bắt đầu từ phiên bản nào?
  count() by version, bin(5m) where event = "payment_failed"

tenant nào bị nặng nhất?
  count() by tenant_id where event = "payment_failed" | sort desc | limit 10

toàn bộ chuyện gì đã xảy ra với một request cụ thể?
  * where trace_id = "4bf92f35..." | sort by time
```

Cùng dữ liệu, khác định dạng — và khác biệt là giữa 40 phút và 40 giây.

## Prediction

1. `logger.info(\`Payment failed for user ${id}\`)` — đếm người dùng duy nhất bị ảnh hưởng thế nào?
2. Cùng thông tin ở dạng trường — thế nào?
3. Thông điệp chứa giá trị nội suy (`Order o_771 created`) — nhóm theo loại sự kiện được không?
4. Không có `version` trong log — trả lời "lỗi bắt đầu từ bản nào" thế nào?
5. Không có `trace_id`, request lỗi đi qua 4 service — ghép log lại thế nào?
6. `logger.error(err.message)` — có stack trace không?
7. `logger.error({ err }, 'failed')` với serializer chuẩn — có gì?
8. Log lỗi ở mỗi tầng khi ném lại, 5 tầng — một lỗi tạo bao nhiêu dòng? Đếm lỗi có đúng không?
9. Ai đó viết `logger.info({ req })` để debug, redact chỉ ở chỗ gọi log khác — hậu quả?
10. Redact ở tầng logger — hậu quả?
11. Ghi log ra file trong container, container bị xoá — log còn không?
12. App gửi log trực tiếp tới hệ thống log, hệ thống đó chậm — app thế nào?
13. Lấy mẫu 1% mọi log, một sự cố ảnh hưởng 50 request — bạn thấy bao nhiêu?
14. Lấy mẫu 1% INFO nhưng giữ 100% ERROR và toàn bộ trace có lỗi — bạn thấy bao nhiêu?

<details>
<summary>Đáp án</summary>

1. Viết **regex** — và nó hỏng với mọi biến thể thông điệp.
2. Một truy vấn `count_distinct(user_id)`.
3. **Không** — mỗi dòng là một thông điệp khác nhau.
4. Đoán theo thời gian deploy — chậm và không chắc chắn.
5. Gần như **không thể** ghép chính xác khi có nhiều request đồng thời.
6. **Không.**
7. Stack, type, message, và `cause` nếu có.
8. **5 dòng** cho một sự kiện; đếm lỗi **sai gấp 5 lần**.
9. **Toàn bộ header gồm `Authorization`** vào log.
10. Bị **redact tự động** — vô hại.
11. **Mất** — trừ khi có volume.
12. **App chậm theo** — log không nên là phụ thuộc đồng bộ.
13. Khoảng **0–1 dòng** — gần như không thấy gì.
14. **Toàn bộ 50** — vì chúng có lỗi.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thử đếm người dùng duy nhất bị ảnh hưởng từ log hiện tại | Mất bao lâu? |
| Tìm mọi dòng log của một request | Có `trace_id` không? |
| Tìm "lỗi này bắt đầu từ phiên bản nào" | Có `version` không? |
| `logger.info({ req })` rồi xem output | Header nhạy cảm có bị redact không? |
| Ném một lỗi và xem log | Có stack trace không? Có `cause` không? |
| Đếm số dòng log cho một lỗi duy nhất | Log nhiều lần ở nhiều tầng? |
| So tên trường giữa hai service | Có chuẩn hoá không? |
| Đo dung lượng log mỗi ngày và chi phí | Bao nhiêu phần là INFO không dùng tới? |
| Xoá container và tìm log của nó | Còn không? |
| Chặn mạng tới hệ thống log | App có chậm không? |
| Tìm email/số điện thoại trong log | Có dữ liệu cá nhân không cần thiết không? |

## What Usually Goes Wrong

- **Log dạng chuỗi nội suy** → không truy vấn được.
- **Thông điệp chứa giá trị** → không nhóm theo loại sự kiện được.
- **Thiếu `trace_id`** → không ghép được các dòng của một request.
- **Thiếu `version`** → không xác định được bản nào gây lỗi.
- **Tên trường không chuẩn** giữa các service.
- **Truyền `userId` qua mọi tầng** chỉ để log — dùng AsyncLocalStorage.
- **Mất stack trace** khi log lỗi.
- **Log lỗi ở mọi tầng** → nhiễu và đếm sai.
- **Redact ở chỗ gọi** thay vì ở tầng logger.
- **Ghi dữ liệu cá nhân** vào log không cần thiết.
- **Ghi log ra file** trong container.
- **App gửi log đồng bộ** tới hệ thống ngoài.
- **Lấy mẫu cả ERROR.**
- **Dùng log làm audit trail.**
- **Không có ngân sách log** → chi phí bùng nổ, rồi cắt thời gian lưu vào lúc tệ nhất.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Log là để người đọc | Ở quy mô thật, log là để truy vấn |
| JSON log khó đọc khi dev | `pino-pretty` giải quyết; đừng đánh đổi production |
| Log nhiều là an toàn | Ngập log = không tìm được gì, và đắt |
| `logger.error(err.message)` là đủ | Mất stack và cause |
| Log lỗi ở mọi tầng cho chắc | Nhiễu và làm sai số liệu |
| Redact ở chỗ gọi là đủ | Ai đó sẽ quên; đặt ở logger |
| Log có thể dùng làm audit trail | Log mất được, audit thì không |
| Lấy mẫu log là nguy hiểm | Nguy hiểm là lấy mẫu ERROR |
| Ghi file rồi chuyển tiếp là chuẩn | Trong container, stdout là chuẩn |
| Thêm trường vào log là miễn phí | Nó có chi phí lưu trữ; chọn có chủ đích |

## Debugging

1. **Không tìm được gì trong log** → thiếu trường để lọc. Thêm `event`, `trace_id`, `tenant_id` trước khi tìm tiếp.
2. **Log quá nhiều** → nhóm theo `event` và đếm; thường vài loại chiếm phần lớn khối lượng.
3. **Không nối được các service** → so tên trường; chuẩn hoá là việc phải làm một lần.
4. **Lỗi không có ngữ cảnh** → thêm trường nghiệp vụ vào chỗ log, không thêm vào thông điệp.
5. **Log bị mất** → kiểm tra buffer của agent, giới hạn tốc độ của backend, và xem app có ghi vào stdout thật không.
6. **Chi phí tăng đột biến** → tìm log mới thêm gần đây; một dòng INFO trong vòng lặp nóng đủ để nhân đôi khối lượng.
7. **Cần DEBUG ở production** → bật theo tenant/route/thời hạn, không bật toàn cục.
8. **Người dùng báo lỗi** → hỏi `x-trace-id` từ response; nếu chưa trả header đó, thêm nó.

## Production Considerations

- **JSON có cấu trúc ở production**, pretty-print chỉ ở local.
- **Thông điệp là hằng số**; dữ liệu nằm ở trường.
- **Trường bắt buộc**: `timestamp`, `level`, `message`, `service`, `version`, `env`, `trace_id`.
- **Chuẩn hoá tên trường** theo OpenTelemetry semantic conventions.
- **AsyncLocalStorage** cho ngữ cảnh tự động.
- **Trả `x-trace-id` trong response** để hỗ trợ tra cứu.
- **Redact ở tầng logger**, bao gồm header và cookie.
- **Không ghi dữ liệu cá nhân** khi `user_id` là đủ.
- **Serializer lỗi chuẩn**; log lỗi **một lần** ở nơi xử lý.
- **Ghi ra stdout**; agent/sidecar chuyển tiếp.
- **Lấy mẫu INFO, giữ 100% ERROR**, và giữ toàn bộ log của trace có lỗi.
- **Bật DEBUG có phạm vi và thời hạn.**
- **Audit trail tách khỏi log** với chính sách lưu trữ riêng.
- **Ngân sách log theo service** và cảnh báo khi vượt.
- **Kiểm tra bằng câu hỏi thật**: chọn ba câu hỏi hay gặp khi có sự cố và thử trả lời bằng log hiện tại.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| JSON có cấu trúc | truy vấn được | khó đọc trực tiếp (giải bằng pretty) |
| Log dạng văn bản | dễ đọc bằng mắt | không truy vấn được ở quy mô |
| Nhiều trường | ngữ cảnh phong phú | chi phí lưu trữ |
| Ít trường | rẻ | thiếu dữ liệu khi điều tra |
| AsyncLocalStorage | ngữ cảnh tự động | chi phí nhỏ, khó theo dõi luồng |
| Truyền tay | tường minh | rác trong chữ ký hàm, dễ quên |
| Lấy mẫu INFO | giảm chi phí lớn | mất ngữ cảnh của request bình thường |
| Giữ 100% | dữ liệu đầy đủ | chi phí |
| Redact rộng | an toàn | đôi khi che mất thứ cần debug |
| Log qua agent | app không phụ thuộc | thêm thành phần vận hành |

## Explain Without Notes

1. Vì sao log dạng chuỗi không dùng được ở quy mô thật? Cho một câu hỏi cụ thể mà nó không trả lời được.
2. Vì sao thông điệp nên là hằng số?
3. Bảy trường bắt buộc và câu hỏi mà mỗi trường trả lời.
4. AsyncLocalStorage giải quyết vấn đề gì trong logging?
5. Vì sao redact phải ở tầng logger?
6. Ba thứ phải có trong một log lỗi.
7. Vì sao log lỗi ở mọi tầng là phản mẫu?
8. Chiến lược lấy mẫu log nào giữ được khả năng điều tra?

## Related

- [Logs, metrics, traces](01-logs-metrics-traces.md) — ba tín hiệu và vai trò
- [Correlation & tracing](03-correlation-tracing.md) — nguồn của `trace_id`
- [Metrics & SLO](04-metrics-slo.md) — khi nào dùng metric thay log
- [Secrets management](../security/06-secrets-management.md) — log là nơi bí mật rò rỉ
- [Error handling strategy](../../02-backend-api/04-architecture/04-error-handling-strategy.md) — log lỗi ở đâu
- [Logs & services](../../04-infrastructure/00-linux/06-logs-and-services.md) — stdout, xoay vòng, journald
- [Request lifecycle](../../02-backend-api/02-nestjs/01-request-lifecycle.md) — nơi đặt middleware ngữ cảnh
- [Access control](../security/04-access-control.md) — log quyết định từ chối

## Version / Context

Ví dụ dùng `pino` v9 (`mixin`, `redact`, `stdSerializers`) với Node.js 20+ và NestJS 10/11. `AsyncLocalStorage` ổn định từ Node 16. Winston có cơ chế tương đương qua format và custom transport. Tên trường theo OpenTelemetry semantic conventions (`user.id`, `http.route`, `service.version`).
