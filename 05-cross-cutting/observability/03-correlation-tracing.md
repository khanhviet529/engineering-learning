---
level: advanced
area: cross-cutting
prerequisites:
  - 02-structured-logging.md
related:
  - 04-metrics-slo.md
  - ../performance/01-latency-throughput-bottleneck.md
---

# Correlation & distributed tracing

> Một request mất 4 giây. API log cho thấy nó gọi service thanh toán và chờ 3,8 giây. Service thanh toán log cho thấy nó xử lý trong 40ms. Cả hai đều đúng. Sự thật nằm ở khoảng trống giữa hai con số: **request nằm trong hàng đợi kết nối 3,7 giây trước khi service thanh toán nhìn thấy nó** — và không log nào của cả hai bên đo được khoảng đó.

## Position

```text
Log      chi tiết tại MỘT điểm
Metric   số tổng hợp
Trace    một request đi qua NHIỀU điểm — kèm THỜI GIAN và QUAN HỆ NHÂN QUẢ
         ↑ thứ duy nhất thấy được khoảng trống GIỮA các thành phần
```

## Problem

```text
Trong hệ thống nhiều thành phần, mỗi thành phần chỉ biết phần của nó:
  · "tôi mất 40ms"        · "tôi mất 3,8 giây chờ anh"
  → cộng lại không ra bức tranh; và khoảng trống thì không ai đo

Câu hỏi không trả lời được nếu không có trace:
  · thời gian thực sự tiêu ở ĐÂU?
  · lời gọi nào chạy tuần tự mà lẽ ra song song?
  · có N+1 ở tầng nào không?
  · một request chậm đã đi qua những service nào, theo thứ tự nào?
```

## Mental Model

### Trace là một cây span

```text
trace_id = 4bf92f35...          ← một request, xuyên toàn hệ thống

├─ span: POST /orders                              [====================] 4.0s
│  ├─ span: auth.verify                            [=]                    20ms
│  ├─ span: db.query cart                          [==]                   50ms
│  ├─ span: http POST payment-service              [================]     3.8s
│  │  └─ span: (bên payment) charge                              [=]      40ms
│  │     ↑ KHOẢNG TRỐNG 3.7s giữa hai span = chờ kết nối / hàng đợi
│  └─ span: db.insert order                        [=]                    30ms

Mỗi span:  trace_id · span_id · parent_span_id · tên · bắt đầu · thời lượng · thuộc tính
```

Khoảng trống giữa span cha và span con ở service khác là thông tin **chỉ trace mới cho thấy**. Nó thường là: chờ trong pool kết nối, chờ DNS, chờ TLS handshake, hoặc hàng đợi ở phía nhận.

### Context propagation: cách trace không bị đứt

```text
Service A gửi HTTP tới B, kèm header chuẩn W3C Trace Context:

  traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
               │  │                                │                │
               │  trace_id (giữ nguyên cả trace)   span_id của A    flags (đã lấy mẫu)
               version

B đọc header → tạo span con với parent = span_id của A → trace liền mạch
```

```text
Trace ĐỨT khi:
  ✗ một service không truyền header đi tiếp
  ✗ đi qua message queue mà không nhúng context vào message
  ✗ dùng thư viện HTTP chưa được instrument
  ✗ vượt qua ranh giới bất đồng bộ (setTimeout, job, worker) mất context
  ✗ dùng chuẩn cũ (B3 của Zipkin) lẫn với W3C mà không cấu hình cả hai
```

Một service không truyền header là đủ để mọi thứ **phía sau nó** biến mất khỏi trace.

### Auto-instrumentation làm được 80%

```ts
// tracing.ts — nạp TRƯỚC mọi module khác
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  serviceName: 'order-api',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },   // quá ồn
  })],
}).start();
```

```text
Tự động có được: HTTP vào/ra, truy vấn DB, Redis, gRPC, kết nối queue
  → đã đủ để thấy hình dạng và tìm nút thắt

Phải thêm tay: span cho ĐOẠN LOGIC quan trọng và THUỘC TÍNH nghiệp vụ
  → "tính giá mất 800ms" không xuất hiện nếu không tự tạo span
```

Lưu ý về thứ tự nạp: instrumentation hoạt động bằng cách vá module, nên nó phải chạy **trước** khi ứng dụng import các thư viện đó (`node --require ./tracing.js` hoặc `--import`).

### Span thủ công: đặt ở đâu cho có giá trị

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('order-service');

async function calculatePricing(cart: Cart, user: User) {
  return tracer.startActiveSpan('pricing.calculate', async (span) => {
    span.setAttributes({
      'cart.item_count': cart.items.length,        // ← số, dùng để tương quan với thời lượng
      'user.tier': user.tier,
    });
    try {
      const result = await doCalculate(cart, user);
      span.setAttribute('pricing.rules_evaluated', result.rulesEvaluated);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();                                   // ← LUÔN end, kể cả khi lỗi
    }
  });
}
```

```text
Đặt span ở:
  ✓ ranh giới giữa các thành phần
  ✓ đoạn tính toán có thể chậm
  ✓ vòng lặp gọi I/O (để thấy N+1)
  ✗ mọi hàm — trace thành nhiễu và tốn chi phí
```

Thuộc tính **dạng số** đặc biệt giá trị: `cart.item_count` cho phép trả lời "có phải giỏ hàng lớn thì chậm không" bằng cách nhìn tương quan, thay vì đoán.

### Trace qua message queue

Đây là chỗ trace hay đứt nhất, và cũng là chỗ nó có giá trị cao nhất:

```ts
// producer — nhúng context vào message
import { propagation, context } from '@opentelemetry/api';

const carrier: Record<string, string> = {};
propagation.inject(context.active(), carrier);            // ghi traceparent vào carrier

await queue.add('process-order', { orderId, _otel: carrier });
```

```ts
// consumer — khôi phục context
const parentCtx = propagation.extract(context.active(), job.data._otel ?? {});

await context.with(parentCtx, async () => {
  await tracer.startActiveSpan('process-order', async (span) => {
    span.setAttribute('messaging.message.age_ms', Date.now() - job.timestamp);   // ← THỜI GIAN CHỜ
    try { await handle(job.data); } finally { span.end(); }
  });
});
```

`messaging.message.age_ms` là thuộc tính đáng đo nhất trong xử lý bất đồng bộ: nó tách **thời gian chờ trong hàng đợi** khỏi **thời gian xử lý**, hai đại lượng thường bị gộp làm một và có nguyên nhân hoàn toàn khác nhau.

Lưu ý ngữ nghĩa: producer và consumer thường **không** cùng một trace theo nghĩa "cha–con đồng bộ" — với hàng đợi, quan hệ đúng là **link** giữa hai trace, đặc biệt khi một message được xử lý lại hoặc một batch gộp nhiều message. Với hàng đợi đơn giản một-một, parent–child dùng được và dễ đọc hơn.

### Lấy mẫu: quyết định ở đâu

```text
HEAD sampling      quyết định lúc bắt đầu trace, theo tỉ lệ
                   + rẻ, không cần buffer
                   − mất trace của lỗi hiếm và request chậm

TAIL sampling      collector giữ toàn bộ span, quyết định KHI TRACE XONG
                   + giữ 100% lỗi và chậm; lấy mẫu phần còn lại
                   − cần bộ nhớ ở collector; span của một trace phải tới CÙNG collector

PARENT-BASED       theo quyết định của service gọi đến (flag trong traceparent)
                   → bắt buộc để một trace không bị lấy mẫu nửa vời
```

```yaml
# collector: tail sampling
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow
        type: latency
        latency: { threshold_ms: 1000 }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }
```

### Nối trace với log và metric

```text
LOG    mọi dòng có trace_id (qua AsyncLocalStorage)   → 02-structured-logging.md
METRIC exemplar: gắn trace_id vào một mẫu của histogram
       → nhìn thấy p99 tăng trên biểu đồ, bấm vào → mở đúng một trace chậm

Đây là thứ biến ba kho dữ liệu rời rạc thành một công cụ điều tra.
```

### Chi phí và cái bẫy cardinality

```text
Trace không rẻ:
  · mỗi span là dữ liệu gửi đi và lưu trữ
  · instrumentation có chi phí CPU (thường 1–5%)
  · thuộc tính cardinality cao trong SPAN thì ổn (khác metric)
    nhưng TÊN SPAN thì không:
      ✗ span name = "GET /orders/8421"   → hàng triệu tên span
      ✓ span name = "GET /orders/:id"    → gộp được; id nằm ở THUỘC TÍNH
```

Nhầm lẫn giữa tên span và thuộc tính là lỗi phổ biến nhất khi tự tạo span, và nó làm hỏng khả năng tổng hợp của toàn bộ hệ thống trace.

## Example

Trace phơi bày một N+1 mà log và metric đều không thấy:

```text
POST /orders/summary                                    [========================] 2.4s
├─ db.query SELECT orders                               [=]                        30ms
├─ db.query SELECT customer WHERE id = ?                [=]                        18ms
├─ db.query SELECT customer WHERE id = ?                [=]                        19ms
├─ db.query SELECT customer WHERE id = ?                [=]                        17ms
│  ... (97 span nữa, mỗi cái ~18ms)
└─ render                                               [=]                        40ms

Metric nói:  p99 độ trễ endpoint = 2.4s, db_query_duration p99 = 20ms  ← "database nhanh mà?"
Log nói:     "summary generated in 2400ms"                              ← không biết vì sao
Trace nói:   100 truy vấn giống nhau, mỗi cái nhanh, tổng thì không
```

Đây là hình dạng đặc trưng của N+1 trong trace: **nhiều span cùng tên, mỗi cái nhanh, xếp liên tiếp**. Nhận ra hình dạng này nhanh hơn nhiều so với đọc code.

Và hình dạng thứ hai — tuần tự thay vì song song:

```text
├─ http GET inventory-service     [=====]              400ms
├─ http GET pricing-service       ⤷    [=====]         400ms
└─ http GET shipping-service      ⤷         [=====]    400ms
                                  tổng: 1200ms

sau khi chuyển sang Promise.all:
├─ http GET inventory-service     [=====]
├─ http GET pricing-service       [=====]
└─ http GET shipping-service      [=====]
                                  tổng: 400ms
```

Ba span xếp bậc thang là dấu hiệu trực quan của lời gọi tuần tự không cần thiết. Không có trace, nó ẩn trong một con số duy nhất.

## Prediction

1. Service A gọi B, A log 3,8 giây, B log 40ms — thời gian còn lại ở đâu?
2. Không có trace, làm sao biết khoảng trống đó tồn tại?
3. Một service ở giữa không truyền `traceparent` — trace trông thế nào?
4. Producer không nhúng context vào message — trace của consumer thế nào?
5. Head sampling 1%, một lỗi xảy ra 5 lần/ngày — xác suất có trace?
6. Tail sampling giữ 100% lỗi — xác suất đó?
7. Một trace bị lấy mẫu ở service A nhưng không ở B (không dùng parent-based) — kết quả?
8. Tên span là `GET /orders/8421` — chuyện gì xảy ra sau một triệu request?
9. Tên span là `GET /orders/:id`, id ở thuộc tính — thế nào?
10. 100 span `db.query` giống nhau xếp liên tiếp — đây là hình dạng của lỗi gì?
11. Ba span HTTP xếp bậc thang, mỗi cái 400ms — sửa thế nào và tiết kiệm bao nhiêu?
12. `span.end()` không được gọi khi có lỗi — span đó thế nào?
13. Instrumentation nạp sau khi app đã import thư viện HTTP — có trace không?
14. Consumer đo `message.age_ms` thấy 45 giây — vấn đề ở xử lý hay ở hàng đợi?

<details>
<summary>Đáp án</summary>

1. **Khoảng trống giữa hai span**: pool kết nối, DNS, TLS, hoặc hàng đợi phía nhận.
2. Rất khó — phải suy luận từ hai con số không khớp nhau.
3. **Đứt** — mọi thứ phía sau service đó biến mất khỏi trace.
4. Trace **riêng biệt**, không nối được với request gốc.
5. **~1%** cho mỗi lần — gần như chắc chắn không có.
6. **100%.**
7. Trace **thiếu một nửa** — không đọc được.
8. **Hàng triệu tên span** — không tổng hợp được, hệ thống trace quá tải.
9. Gộp được, và vẫn tìm được theo id qua thuộc tính.
10. **N+1.**
11. `Promise.all` — từ 1200ms xuống **400ms**.
12. Span **treo**, không bao giờ được gửi, hoặc bị đánh dấu lỗi khi hết timeout.
13. **Không** — instrumentation phải vá module trước khi chúng được import.
14. **Ở hàng đợi** — xử lý có thể rất nhanh; đây là lý do phải tách hai đại lượng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gọi một endpoint và mở trace của nó | Thời gian tiêu ở đâu? |
| Tìm span cùng tên xếp liên tiếp | N+1? |
| Tìm span xếp bậc thang | Tuần tự không cần thiết? |
| Gỡ instrumentation của một service | Trace đứt ở đâu? |
| Gửi request không có `traceparent` | Service có tạo trace mới không? |
| Đẩy một job qua queue và tìm trace | Có nối được không? |
| Đếm số tên span duy nhất | Có bùng nổ không? |
| Tìm trace của một lỗi hiếm | Sampling có giữ không? |
| Bấm từ điểm p99 trên dashboard | Có mở được trace không (exemplar)? |
| Tìm `trace_id` của một dòng log trong hệ thống trace | Nối được không? |
| Nạp instrumentation sau khi import express | Còn span HTTP không? |

## What Usually Goes Wrong

- **Trace đứt** vì một service không truyền context.
- **Không nhúng context vào message** qua queue.
- **Mất context** qua ranh giới bất đồng bộ (`setTimeout`, worker, callback thư viện cũ).
- **Tên span có cardinality cao** (chứa ID).
- **Head sampling** → không có trace của thứ cần xem.
- **Không dùng parent-based sampling** → trace bị cắt nửa.
- **`span.end()` không được gọi** trong đường lỗi.
- **Instrumentation nạp sai thứ tự.**
- **Instrument mọi hàm** → nhiễu và tốn chi phí.
- **Không có thuộc tính nghiệp vụ** → thấy chậm nhưng không tương quan được với nguyên nhân.
- **Không nối trace với log** (thiếu `trace_id` trong log).
- **Không đo thời gian chờ trong hàng đợi** → gộp nhầm với thời gian xử lý.
- **Trộn W3C và B3** mà không cấu hình cả hai propagator.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Trace chỉ cần cho microservices | Monolith cũng có DB, cache, queue, API ngoài |
| Auto-instrumentation là đủ | Nó không biết logic nghiệp vụ của bạn |
| Trace thay được log | Trace cho hình dạng, log cho chi tiết |
| Trace 100% mới hữu ích | Tail sampling giữ đúng cái cần với chi phí thấp |
| Thuộc tính cardinality cao là xấu | Trong span thì ổn — chỉ **tên span** mới phải thấp |
| Trace tự nối qua queue | Phải nhúng context thủ công |
| Trace không có chi phí | 1–5% CPU cộng chi phí lưu trữ |
| Một service không có trace cũng không sao | Nó làm đứt mọi thứ phía sau |
| Span cha bao trọn span con | Khoảng trống giữa chúng là thông tin quan trọng |
| trace_id chỉ dùng cho trace | Nó là khoá nối log, metric và trace |

## Debugging

1. **Bắt đầu từ trace chậm nhất**, không từ trace trung bình.
2. **Nhìn hình dạng trước khi đọc số**: bậc thang = tuần tự; nhiều span cùng tên = N+1; span dài không có con = chờ hoặc tính toán.
3. **Khoảng trống giữa span cha và con ở service khác** → mạng, pool kết nối, hàng đợi phía nhận.
4. **Trace đứt** → kiểm tra service cuối cùng còn xuất hiện; nó là nơi context bị mất.
5. **Không có span nào** → instrumentation có được nạp trước không? exporter có tới được collector không (`OTEL_LOG_LEVEL=debug`)?
6. **Span treo/không kết thúc** → tìm đường lỗi không gọi `end()`; dùng `finally`.
7. **Từ trace sang log**: copy `trace_id` và truy vấn log — đây là bước cho chi tiết mà trace không có.
8. **Tương quan thuộc tính với thời lượng**: lọc span theo `cart.item_count > 50` và so thời lượng — biến giả thuyết thành số.

## Production Considerations

- **OpenTelemetry với W3C Trace Context** làm chuẩn; cấu hình thêm B3 nếu có hệ thống cũ.
- **Nạp instrumentation trước mọi import** (`--require`/`--import`).
- **Auto-instrumentation + span thủ công cho đoạn logic quan trọng.**
- **Tên span cardinality thấp**; ID và giá trị đi vào thuộc tính.
- **Thuộc tính nghiệp vụ dạng số** để tương quan được.
- **Tail sampling**: 100% lỗi, 100% chậm, tỉ lệ nhỏ cho phần còn lại.
- **Parent-based sampling** để trace không bị cắt nửa.
- **Nhúng context vào message queue** và đo `message.age_ms`.
- **`trace_id` trong mọi dòng log**; trả `x-trace-id` cho client.
- **Exemplar** để nhảy từ metric sang trace.
- **`span.end()` trong `finally`**, luôn luôn.
- **Collector đứng giữa app và backend** — app không phụ thuộc trực tiếp vào hệ thống trace.
- **Giới hạn số span mỗi trace** để một vòng lặp không sinh ra trace khổng lồ.
- **Đo chi phí**: CPU của instrumentation và khối lượng span gửi đi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Auto-instrumentation | rẻ, phủ rộng | nhiễu, không có ngữ cảnh nghiệp vụ |
| Span thủ công | đúng chỗ cần | công sức, dễ quên `end()` |
| Trace 100% | thấy mọi thứ | chi phí rất cao |
| Head sampling | rẻ, đơn giản | mất lỗi hiếm |
| Tail sampling | giữ đúng cái cần | collector cần bộ nhớ, cấu hình phức tạp |
| Nhiều thuộc tính | tương quan tốt | dung lượng |
| Parent–child qua queue | dễ đọc | sai ngữ nghĩa với batch/retry |
| Span link qua queue | đúng ngữ nghĩa | khó đọc hơn |
| Collector trung gian | tách app khỏi backend | thêm thành phần vận hành |
| Không trace | không chi phí | mù với khoảng trống giữa các thành phần |

## Explain Without Notes

1. Trace thấy được điều gì mà log và metric không thấy? Cho một ví dụ cụ thể.
2. `traceparent` chứa gì và context propagation hoạt động ra sao?
3. Năm cách làm trace đứt.
4. Vì sao tên span phải cardinality thấp trong khi thuộc tính thì không sao?
5. Head và tail sampling khác nhau thế nào? Vì sao cần parent-based?
6. Hai hình dạng trace cho biết vấn đề gì — span cùng tên xếp liên tiếp, và span xếp bậc thang?
7. Vì sao phải đo `message.age_ms` riêng với thời gian xử lý?
8. Ba tín hiệu được nối với nhau bằng gì, và điều đó thay đổi việc điều tra ra sao?

## Related

- [Logs, metrics, traces](01-logs-metrics-traces.md) — vai trò của từng tín hiệu
- [Structured logging](02-structured-logging.md) — `trace_id` trong log
- [Metrics & SLO](04-metrics-slo.md) — exemplar nối metric với trace
- [Latency & bottleneck](../performance/01-latency-throughput-bottleneck.md) — đọc trace để tìm nút thắt
- [Database performance](../performance/04-database-performance.md) — N+1 nhìn từ trace
- [Ordering & partitioning](../../03-database/04-message-queues/04-ordering-partitioning.md) — context qua queue
- [Connection pool](../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — nguồn của khoảng trống chờ
- [Modules & DI](../../02-backend-api/02-nestjs/behavior/02-modules-di.md) — nơi đặt tracer trong NestJS

## Version / Context

OpenTelemetry: traces stable; `@opentelemetry/sdk-node` và `auto-instrumentations-node` cho Node.js 20+. W3C Trace Context là chuẩn khuyến nghị (`traceparent`, `tracestate`); B3 là chuẩn cũ của Zipkin. Tail sampling qua OpenTelemetry Collector (`tail_sampling` processor) — yêu cầu mọi span của một trace tới cùng instance collector (dùng `loadbalancing` exporter khi có nhiều instance).
