---
level: intermediate
area: cross-cutting
related:
  - 02-structured-logging.md
  - 03-correlation-tracing.md
---

# Logs, metrics, traces: ba tín hiệu

> Lúc 3 giờ sáng, API chậm. Dashboard cho thấy p99 tăng từ 200ms lên 4 giây. Đội ngũ có đủ ba thứ: log, metric, trace. Nhưng log không có `requestId`, metric không tách theo endpoint, và trace chỉ bật cho 1% request — không cái nào trong số đó là request chậm. **Có ba tín hiệu không đồng nghĩa với có khả năng quan sát; chúng phải nối được với nhau.**

## Position

```text
Monitoring    "hệ thống có khoẻ không?"      → câu hỏi BIẾT TRƯỚC
Observability "vì sao nó cư xử như thế này?" → câu hỏi CHƯA BIẾT TRƯỚC

Ba tín hiệu là NGUYÊN LIỆU. Khả năng nối chúng lại mới là năng lực.
```

## Problem

```text
Sự cố production có một hình dạng cố định:
  ① CÓ GÌ ĐÓ SAI           → phát hiện          → metric / alert
  ② SAI Ở ĐÂU               → thu hẹp            → metric theo chiều, trace
  ③ VÌ SAO SAI              → nguyên nhân        → log, trace chi tiết

Ba câu hỏi, ba loại dữ liệu, ba đặc tính chi phí khác nhau.
Dùng sai loại cho sai câu hỏi là lý do điều tra kéo dài hàng giờ.
```

## Mental Model

### Ba tín hiệu, ba tính chất

```text
METRIC   số ĐÃ TỔNG HỢP theo thời gian
         + rẻ, giữ được lâu, truy vấn nhanh, hợp cho alert
         − mất chi tiết: biết p99 tăng, KHÔNG biết request nào
         → trả lời "CÓ GÌ SAI" và "SAI Ở ĐÂU (theo chiều)"

LOG      sự kiện rời rạc, có ngữ cảnh
         + chi tiết đầy đủ tại một điểm
         − đắt để lưu, khó tổng hợp, dễ ngập
         → trả lời "VÌ SAO" tại MỘT điểm

TRACE    một request đi qua NHIỀU service/thành phần
         + thấy được thời gian tiêu ở đâu, thứ tự nhân quả
         − chi phí cao → thường lấy mẫu
         → trả lời "THỜI GIAN ĐI ĐÂU" xuyên hệ thống
```

### Chúng phải nối được với nhau

Đây là điểm quyết định, và cũng là điều thiếu trong sự cố ở đầu note:

```text
metric bất thường  ──trace_id trong exemplar──>  trace cụ thể
trace              ──trace_id──>                 log của đúng request đó
log                ──trace_id──>                 trace đầy đủ

⇒ MỘT ĐỊNH DANH DUY NHẤT xuất hiện trong CẢ BA
  → điều tra đi từ "p99 tăng" tới "dòng code này" trong vài phút
  → không có nó: ba kho dữ liệu độc lập, phải đoán để nối
```

`trace_id` trong mọi dòng log là **thay đổi có tỉ lệ giá trị/chi phí cao nhất** trong toàn bộ observability. Xem [Correlation & tracing](03-correlation-tracing.md).

### Chiều (dimension) quyết định giá trị của metric

```text
http_requests_total = 1_240_000        ← gần như vô dụng
http_requests_total{route="/orders", method="POST", status="500"} = 340
                    ↑ CHIỀU biến số thành công cụ chẩn đoán
```

```text
Nhưng: mỗi tổ hợp giá trị = một chuỗi thời gian riêng (cardinality)
  route (20) × method (4) × status (6) = 480 chuỗi     → ổn
  thêm user_id (100.000)                → 48.000.000  → sập hệ thống metric

⇒ CHIỀU CÓ TẬP GIÁ TRỊ HỮU HẠN VÀ NHỎ.
  user_id, order_id, URL đầy đủ → thuộc về LOG và TRACE, không thuộc metric.
```

Cardinality explosion là sự cố vận hành phổ biến nhất của hệ thống metric, và nó luôn đến từ việc thêm một chiều "chỉ để tiện".

### Trung bình nói dối, phân vị thì không

```text
1000 request: 990 cái 50ms, 10 cái 5000ms
  trung bình = 99.5ms   ← trông ổn
  p99        = 5000ms   ← 10 người dùng đang chờ 5 giây

⇒ luôn dùng p50 / p95 / p99, không dùng trung bình cho độ trễ
⇒ p99 quan trọng hơn cảm giác ban đầu: với 20 lời gọi phụ trợ mỗi trang,
  xác suất một người dùng gặp p99 là ~18%, không phải 1%
```

Và một cảnh báo về phân vị: **không được lấy trung bình của phân vị**. Trung bình p99 của 10 pod không phải p99 toàn hệ thống. Tổng hợp phải làm từ histogram, không từ số phân vị đã tính.

### Lấy mẫu trace: giữ cái đáng giữ

```text
Head sampling   quyết định NGAY ĐẦU (ví dụ giữ 1%)
                + rẻ, đơn giản
                − request chậm/lỗi thường KHÔNG nằm trong 1% đó ← sự cố ở đầu note

Tail sampling   quyết định SAU khi trace hoàn tất
                + giữ 100% trace LỖI và CHẬM, lấy mẫu phần còn lại
                − cần buffer toàn bộ trace (collector), tốn bộ nhớ

⇒ Với hệ thống có sự cố cần điều tra, tail sampling là lựa chọn đúng.
```

### Log: mức độ và chi phí

```text
ERROR  cần người xử lý           → alert được
WARN   bất thường, chưa cần xử lý ngay
INFO   sự kiện nghiệp vụ quan trọng (đơn tạo, thanh toán, đăng nhập)
DEBUG  chi tiết điều tra          → TẮT ở production, bật theo yêu cầu

Log INFO cho MỌI thứ = ngập, đắt, và không tìm được gì khi cần.
```

```text
Chi phí log không tuyến tính:
  10 GB/ngày  → rẻ, tìm kiếm nhanh
  1 TB/ngày   → đắt, tìm kiếm chậm, và bạn sẽ bị ép giảm thời gian lưu
                → mất đúng dữ liệu lịch sử cần cho điều tra
```

Quy tắc thực dụng: metric cho **mọi request**, log cho **sự kiện đáng chú ý**, trace cho **mẫu đại diện + toàn bộ lỗi**.

### Cardinality thuộc về đâu

```text
                 cardinality thấp    cardinality cao
METRIC           ✓                   ✗ (sập)
LOG              ✓                   ✓  ← user_id, order_id ở đây
TRACE (attribute) ✓                  ✓  ← và ở đây

⇒ Đừng cố nhét chi tiết vào metric. Đó là việc của log và trace,
  và trace_id là thứ nối chúng lại.
```

### Ba thứ thường bị bỏ quên

```text
① SỰ KIỆN THAY ĐỔI (deploy, feature flag, thay đổi cấu hình)
   → vẽ lên dashboard dưới dạng đường dọc
   → "chuyện gì đã đổi lúc 14:32?" là câu hỏi đầu tiên trong mọi sự cố

② TÍN HIỆU NGHIỆP VỤ (đơn hàng/phút, đăng ký/giờ)
   → phát hiện được lớp sự cố mà metric kỹ thuật hoàn toàn bỏ lỡ:
     hệ thống "khoẻ" theo mọi chỉ số nhưng không ai mua được hàng

③ HÀNG ĐỢI VÀ ĐỘ TRỄ XỬ LÝ (queue depth, consumer lag, tuổi job cũ nhất)
   → trong hệ thống bất đồng bộ, đây là tín hiệu sớm nhất
```

Mục ② là tín hiệu duy nhất trong ba mục mà **luôn đúng** — nếu số đơn hàng bình thường, hệ thống đang phục vụ được người dùng, bất kể dashboard kỹ thuật nói gì.

## Example

Một endpoint được trang bị đủ ba tín hiệu, nối bằng `trace_id`:

```ts
@Post('orders')
async create(@Body() dto: CreateOrderDto, @CurrentUser() user: User) {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;

  // ① TRACE: thuộc tính cardinality CAO — ở đây thì được
  span?.setAttributes({ 'user.id': user.id, 'tenant.id': user.tenantId, 'cart.id': dto.cartId });

  const stop = orderCreateDuration.startTimer({ tenant_tier: user.tier });  // ② METRIC

  try {
    const order = await this.orders.create(dto, user);

    // ③ LOG: sự kiện nghiệp vụ, có ngữ cảnh, có trace_id
    this.logger.info({ traceId, orderId: order.id, userId: user.id, totalCents: order.totalCents },
      'order created');

    stop({ status: 'success' });
    ordersCreated.inc({ tenant_tier: user.tier });          // ← tín hiệu NGHIỆP VỤ
    return order;
  } catch (err) {
    stop({ status: 'error' });
    span?.recordException(err as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    this.logger.error({ traceId, userId: user.id, cartId: dto.cartId, err }, 'order creation failed');
    throw err;
  }
}
```

Chú ý sự phân công cardinality:

```text
metric  chỉ có `tenant_tier` (3 giá trị) và `status` (2) → 6 chuỗi
log     có userId, orderId, cartId → cardinality cao, đúng chỗ
trace   có user.id, tenant.id, cart.id → cardinality cao, đúng chỗ
traceId xuất hiện trong log → nối được cả ba
```

Nếu `user.id` bị thêm vào metric label, hệ thống metric sẽ sập khi số người dùng tăng — và nó sẽ sập vào đúng lúc bạn thành công.

## Prediction

1. Log không có `requestId`/`trace_id`, cần tìm mọi dòng log của một request chậm — làm thế nào?
2. Có `trace_id` trong mọi dòng — làm thế nào?
3. `http_requests_total` không có label nào, 500 tăng — bạn biết endpoint nào không?
4. Thêm label `user_id` với 100.000 người dùng — chuyện gì xảy ra với hệ thống metric?
5. 990 request 50ms, 10 request 5000ms — trung bình là bao nhiêu? p99?
6. Lấy trung bình của p99 từ 10 pod — nó có bằng p99 toàn hệ thống không?
7. Head sampling 1%, một request lỗi hiếm — xác suất có trace của nó?
8. Tail sampling giữ 100% lỗi — xác suất đó?
9. Log INFO cho mọi request, 10.000 rps — bao nhiêu dòng mỗi ngày?
10. Không vẽ deploy lên dashboard, sự cố bắt đầu lúc 14:32 — câu hỏi đầu tiên mất bao lâu để trả lời?
11. Mọi metric kỹ thuật bình thường nhưng số đơn hàng/phút giảm 90% — bạn biết không, nếu không đo nó?
12. Trang gọi 20 API phụ trợ, mỗi cái p99 = 1%  — xác suất người dùng gặp ít nhất một lời gọi p99?
13. Queue depth không được đo, consumer chết lúc 2 giờ sáng — bao giờ phát hiện?

<details>
<summary>Đáp án</summary>

1. Đoán theo thời gian và grep — chậm, và **không chắc chắn** khi có nhiều request đồng thời.
2. Một truy vấn: `trace_id = "..."`.
3. **Không** — số tổng không nói được gì về nơi.
4. **Cardinality explosion** — hệ thống metric quá tải hoặc sập.
5. Trung bình **99.5ms**; p99 **5000ms**.
6. **Không** — phân vị không cộng trung bình được; phải tổng hợp từ histogram.
7. **~1%** — gần như chắc chắn không có.
8. **100%.**
9. **864 triệu dòng** — chi phí lưu trữ và tìm kiếm rất lớn.
10. Lâu — phải hỏi người, tra git, tra CI. Thường là phần lớn thời gian điều tra.
11. **Không** — đây là lớp sự cố mà metric kỹ thuật hoàn toàn bỏ lỡ.
12. `1 - 0.99^20 ≈ 18%`.
13. Khi người dùng phàn nàn — có thể hàng giờ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tìm mọi log của một request cụ thể | Mất bao lâu? Có chắc chắn không? |
| Xem một metric bất kỳ, hỏi "endpoint nào" | Có chiều đủ không? |
| Đếm số chuỗi thời gian của một metric | Cardinality có kiểm soát không? |
| So trung bình và p99 của độ trễ | Chênh bao nhiêu? |
| Tìm trace của một lỗi hiếm | Sampling có giữ nó không? |
| Đo dung lượng log mỗi ngày | Bao nhiêu là DEBUG/INFO không dùng tới? |
| Tìm "deploy lúc 14:32" trên dashboard | Có thấy không? |
| Hỏi "có bao nhiêu đơn hàng trong 5 phút qua" | Có metric nghiệp vụ không? |
| Tắt một consumer và chờ | Có alert nào không? |
| Chọn một alert bất kỳ, hỏi "người trực làm gì" | Có runbook không? |

## What Usually Goes Wrong

- **Ba tín hiệu không nối được** — thiếu `trace_id` chung.
- **Metric không có chiều** hoặc **có chiều cardinality cao**.
- **Dùng trung bình** thay vì phân vị; **lấy trung bình của phân vị**.
- **Head sampling** → không có trace của đúng request cần xem.
- **Log mọi thứ ở INFO** → ngập, đắt, không tìm được.
- **Log không có cấu trúc** → không truy vấn được.
- **Không đo tín hiệu nghiệp vụ** → bỏ lỡ cả một lớp sự cố.
- **Không đánh dấu deploy/feature flag** trên dashboard.
- **Không đo queue depth và consumer lag** trong hệ thống bất đồng bộ.
- **Chỉ thêm observability sau sự cố** — quá muộn cho chính sự cố đó.
- **Dashboard đẹp nhưng không trả lời câu hỏi nào** khi có sự cố.
- **Đo cái dễ đo** (CPU) thay vì cái người dùng cảm nhận (độ trễ, tỉ lệ lỗi).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Có log, metric, trace = có observability | Chúng phải nối được với nhau |
| Monitoring và observability là một | Một cái trả lời câu biết trước, một cái không |
| Trung bình đủ để theo dõi độ trễ | Nó che giấu đúng phần người dùng đau |
| Có thể lấy trung bình của p99 | Phân vị không cộng được |
| Thêm label vào metric là miễn phí | Mỗi tổ hợp là một chuỗi thời gian |
| Log càng nhiều càng tốt | Ngập log = không tìm được gì |
| Sampling 1% là đủ | Không đủ cho lỗi hiếm — cần tail sampling |
| Trace thay được log | Trace cho hình dạng, log cho chi tiết |
| CPU và memory là chỉ số quan trọng nhất | Người dùng cảm nhận độ trễ và lỗi |
| Observability là việc của SRE | Nó bắt đầu từ dòng code |

## Debugging

Khung điều tra dùng được cho hầu hết sự cố:

1. **Xác nhận triệu chứng bằng số**: chậm bao nhiêu, từ khi nào, ảnh hưởng bao nhiêu phần trăm request?
2. **Cái gì đã thay đổi?** Deploy, feature flag, cấu hình, lưu lượng, dependency. Đây là câu hỏi có tỉ lệ trúng cao nhất.
3. **Thu hẹp theo chiều**: endpoint nào? tenant nào? region nào? phiên bản nào? Nếu metric không có chiều để cắt, dừng lại và thêm nó.
4. **Từ metric sang trace**: tìm một trace đại diện cho request chậm (exemplar hoặc truy vấn theo thời gian + độ trễ).
5. **Đọc trace**: thời gian tiêu ở span nào? Chờ hay tính toán? Có N+1 không?
6. **Từ trace sang log**: `trace_id` → mọi dòng log của đúng request đó.
7. **Kiểm chứng giả thuyết bằng một thay đổi duy nhất.**
8. **Ghi lại**: triệu chứng, đã loại trừ gì, nguyên nhân, và **tín hiệu nào lẽ ra phải phát hiện sớm hơn** — mục cuối là thứ cải thiện observability theo thời gian.

## Production Considerations

- **`trace_id` trong mọi dòng log** — thay đổi giá trị cao nhất trong danh sách này.
- **Metric có chiều hữu ích, cardinality thấp**; chi tiết đi vào log và trace.
- **Histogram cho độ trễ**, không phải gauge trung bình.
- **Tail sampling** giữ 100% lỗi và request chậm.
- **Log có cấu trúc, mức độ đúng**, DEBUG tắt ở production nhưng bật được theo yêu cầu.
- **Metric nghiệp vụ** song song với metric kỹ thuật.
- **Đánh dấu deploy và feature flag** trên mọi dashboard.
- **Queue depth, consumer lag, tuổi job cũ nhất** cho mọi hệ thống bất đồng bộ.
- **Chuẩn hoá tên trường** giữa các service (`trace_id`, `user_id`, `tenant_id`) — không thống nhất thì không tương quan được.
- **Ngân sách chi phí observability** đặt trước, không phát hiện sau khi nhận hoá đơn.
- **Thời gian lưu theo tầng**: metric lâu (13 tháng), log ngắn hơn (14–30 ngày), trace ngắn nhất.
- **Kiểm tra khả năng quan sát bằng cách diễn tập**: gây lỗi có kiểm soát và xem có phát hiện được không.
- **OpenTelemetry làm chuẩn instrumentation** — tránh khoá vào một nhà cung cấp.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều chiều trong metric | chẩn đoán tốt | cardinality, chi phí |
| Ít chiều | rẻ, ổn định | phải đoán khi điều tra |
| Log mọi request | ngữ cảnh đầy đủ | chi phí, khó tìm |
| Log chọn lọc | rẻ, tìm nhanh | thiếu dữ liệu khi cần |
| Head sampling | rẻ, đơn giản | mất trace của lỗi hiếm |
| Tail sampling | giữ đúng cái cần | cần collector, tốn bộ nhớ |
| Trace 100% | thấy mọi thứ | chi phí rất cao |
| Lưu log lâu | điều tra được quá khứ | chi phí lưu trữ |
| Metric nghiệp vụ | bắt được sự cố thật | thêm việc instrument |
| OpenTelemetry | chuẩn, đổi nhà cung cấp được | thêm một lớp cấu hình |

## Explain Without Notes

1. Ba tín hiệu trả lời ba câu hỏi nào, và vì sao dùng sai loại làm điều tra kéo dài?
2. Điều gì biến "có ba tín hiệu" thành "có khả năng quan sát"?
3. Cardinality là gì? Cái gì thuộc về metric, cái gì thuộc về log/trace?
4. Vì sao trung bình nói dối về độ trễ? Vì sao không lấy trung bình của p99?
5. Head và tail sampling khác nhau ra sao, và cái nào hợp với điều tra sự cố?
6. Ba thứ hay bị bỏ quên trong observability, và vì sao tín hiệu nghiệp vụ đặc biệt?
7. Vì sao "cái gì đã thay đổi" là câu hỏi có tỉ lệ trúng cao nhất?
8. Với 20 lời gọi phụ trợ mỗi trang, p99 ảnh hưởng bao nhiêu phần trăm người dùng?

## Related

- [Structured logging](02-structured-logging.md) — log truy vấn được
- [Correlation & tracing](03-correlation-tracing.md) — `trace_id` nối ba tín hiệu
- [Metrics & SLO](04-metrics-slo.md) — đo cái gì và ngưỡng nào
- [Alerting & dashboards](05-alerting-dashboards.md) — biến tín hiệu thành hành động
- [Latency & bottleneck](../performance/01-latency-throughput-bottleneck.md) — đọc số độ trễ
- [Failure modes](../reliability/01-failure-modes.md) — thứ cần quan sát
- [Debugging Kubernetes](../../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md) — quan sát ở tầng hạ tầng
- [Debugging toolbox](../../04-infrastructure/00-linux/07-debugging-toolbox.md) — khi cần xuống tầng OS

## Version / Context

OpenTelemetry là chuẩn instrumentation hiện hành (traces và metrics đã stable; logs đang hoàn thiện). Ví dụ dùng Node.js với `@opentelemetry/sdk-node`, Prometheus cho metric, pino cho log. Tail sampling qua OpenTelemetry Collector (`tail_sampling` processor). Exemplar (nối metric với trace) được Prometheus hỗ trợ từ v2.26 với `--enable-feature=exemplar-storage`.
