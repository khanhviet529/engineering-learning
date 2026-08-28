---
level: advanced
area: cross-cutting
prerequisites:
  - 01-logs-metrics-traces.md
related:
  - 05-alerting-dashboards.md
  - ../reliability/01-failure-modes.md
---

# Metrics & SLO

> Một hệ thống có uptime 99,95% theo báo cáo hằng tháng. Cùng tháng đó, khách hàng lớn nhất doạ rời đi vì "hệ thống không dùng được". Cả hai đều đúng: uptime được đo bằng health check từ một điểm, mỗi 60 giây. Nó không đo endpoint mà khách hàng dùng, không đo độ trễ, và không đo lỗi 500 trả về cho một tenant cụ thể. **Chỉ số đo đúng thứ dễ đo, không đo thứ người dùng cảm nhận.**

## Position

```text
Metric  số liệu thô
SLI     chỉ số ĐO TRẢI NGHIỆM NGƯỜI DÙNG (chọn ra từ metric)
SLO     MỤC TIÊU cho SLI                → quyết định kỹ thuật
SLA     CAM KẾT với khách hàng           → hợp đồng, có hậu quả tài chính
```

## Problem

```text
Hai câu hỏi khác nhau:
  "hệ thống có chạy không?"        → dễ đo, ít giá trị
  "người dùng có dùng được không?" → khó đo hơn, là câu duy nhất quan trọng

Và một câu hỏi thứ ba mà đội ngũ hiếm khi trả lời trước:
  "MỨC ĐỘ TIN CẬY BAO NHIÊU LÀ ĐỦ?"
  → không có câu trả lời → mọi sự cố đều là khủng hoảng
  → và mọi công sức đều đổ vào độ tin cậy thay vì tính năng
```

## Mental Model

### Bốn loại metric

```text
COUNTER    chỉ tăng (số request, số lỗi)
           → dùng rate(): "bao nhiêu mỗi giây"
GAUGE      lên xuống (kết nối đang mở, queue depth, bộ nhớ)
HISTOGRAM  phân bố (độ trễ) → tính được phân vị ở phía server
SUMMARY    phân vị tính ở phía client → KHÔNG tổng hợp được giữa các instance
```

```text
Với độ trễ, luôn dùng HISTOGRAM:
  histogram lưu số đếm theo BUCKET → cộng được giữa 10 pod → p99 toàn hệ thống ĐÚNG
  summary lưu p99 của từng pod      → trung bình của chúng KHÔNG phải p99 toàn hệ thống
```

Đây là quyết định kỹ thuật có hậu quả lâu dài: chọn summary rồi phát hiện không tổng hợp được là lúc phải đo lại từ đầu.

### Bucket của histogram quyết định độ chính xác

```text
Histogram chỉ biết "bao nhiêu request rơi vào mỗi khoảng".
Phân vị được NỘI SUY từ đó.

buckets = [0.5, 1, 5, 10]  với SLO 200ms
  → mọi thứ dưới 500ms nằm chung một bucket
  → p99 = 200ms hay 450ms? Không phân biệt được.

⇒ đặt bucket DÀY quanh ngưỡng SLO:
  [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5]
                          ↑ SLO 200ms nằm giữa vùng dày
```

### Bốn tín hiệu vàng

```text
LATENCY     độ trễ — tách request THÀNH CÔNG và THẤT BẠI
            (lỗi trả về nhanh làm p99 trông đẹp một cách giả tạo)
TRAFFIC     lưu lượng — rps, tin nhắn/giây
ERRORS      tỉ lệ lỗi — cả lỗi rõ ràng (5xx) và lỗi ngầm (200 với nội dung sai)
SATURATION  mức bão hoà — tài nguyên nào gần giới hạn nhất
```

Với hệ thống có hàng đợi, thêm hai tín hiệu nữa mà bốn cái trên không phủ:

```text
QUEUE DEPTH     bao nhiêu việc đang chờ
OLDEST ITEM AGE việc cũ nhất đã chờ bao lâu   ← tín hiệu sớm nhất của consumer chết
```

### SLI: đo từ góc nhìn người dùng

```text
✗ "server có phản hồi health check không"
   → đo từ một điểm, không đo đường người dùng đi

✓ "tỉ lệ request thành công trong 200ms, tính trên endpoint mà người dùng dùng"
```

Ba dạng SLI phổ biến:

```text
AVAILABILITY  tỉ lệ request KHÔNG lỗi
              good = status < 500 (và không phải lỗi ngầm)

LATENCY       tỉ lệ request nhanh hơn ngưỡng
              good = duration < 200ms
              ← "tỉ lệ nhanh hơn ngưỡng" tốt hơn "p99 là bao nhiêu"
                vì nó cộng vào cùng một ngân sách lỗi

FRESHNESS     tỉ lệ dữ liệu mới hơn ngưỡng  (cho hệ thống bất đồng bộ)
              good = age < 5 phút
```

```text
Công thức chung:  SLI = sự kiện TỐT / tổng sự kiện HỢP LỆ

"hợp lệ" quan trọng: loại bỏ request 4xx do client sai,
health check nội bộ, bot — chúng không phản ánh trải nghiệm người dùng.
```

### Error budget: khái niệm biến độ tin cậy thành quyết định

```text
SLO 99,9% trong 30 ngày  →  ngân sách lỗi = 0,1%
                          →  43 phút không đạt yêu cầu MỖI THÁNG

Ngân sách này là thứ bạn ĐƯỢC PHÉP TIÊU:
  · deploy rủi ro          · thử nghiệm
  · bảo trì                · chấp nhận một sự cố nhỏ

Còn ngân sách  → phát hành nhanh, thử nghiệm được
Hết ngân sách  → đóng băng tính năng, chuyển sang việc độ tin cậy
```

Điểm quan trọng nhất không phải con số, mà là: **error budget biến "chúng ta nên cẩn thận hơn không?" từ một cuộc tranh luận thành một phép đo.**

```text
Ba mức SLO và ý nghĩa thực tế:
  99%     7,2 giờ/tháng   → phù hợp với công cụ nội bộ
  99,9%   43 phút/tháng   → mặc định hợp lý cho hầu hết SaaS
  99,99%  4,3 phút/tháng  → cần dự phòng đa vùng, quy trình chặt, chi phí lớn
  99,999% 26 giây/tháng   → hầu hết đội ngũ KHÔNG cần và không đủ khả năng vận hành

Mỗi "số 9" thêm vào thường nhân chi phí lên nhiều lần.
```

### SLO không phải 100%

```text
100% là mục tiêu SAI:
  · không đạt được (mạng, phần cứng, dependency đều hỏng)
  · theo đuổi nó = không bao giờ deploy được gì
  · người dùng KHÔNG PHÂN BIỆT được 99,99% với 100%
    (mạng của chính họ đã kém hơn thế)

⇒ chọn mức đủ để người dùng hài lòng, rồi TIÊU phần còn lại
  vào tốc độ phát triển.
```

### Burn rate: cảnh báo theo tốc độ tiêu ngân sách

```text
Alert theo NGƯỠNG TỨC THỜI:  "tỉ lệ lỗi > 1%"
  → ồn: một đợt tăng 2 phút cũng kêu
  → chậm: lỗi 0,9% liên tục cả tháng thì KHÔNG kêu, mà nó tiêu hết ngân sách

Alert theo BURN RATE: "đang tiêu ngân sách nhanh gấp N lần bình thường"
  burn rate = (tỉ lệ lỗi quan sát được) / (tỉ lệ lỗi cho phép)

  gấp 14,4 lần trong 1 giờ  → tiêu 2% ngân sách/giờ → PAGE (gọi người dậy)
  gấp 6 lần trong 6 giờ     → tiêu 5% ngân sách     → PAGE
  gấp 1 lần trong 3 ngày    → tiêu 10% ngân sách    → ticket, không gọi
```

Cửa sổ ngắn phát hiện sự cố lớn nhanh; cửa sổ dài bắt được rò rỉ chậm. Dùng **cả hai** với ngưỡng khác nhau là cách chuẩn để có cảnh báo vừa nhạy vừa ít nhiễu.

### RED và USE: hai bộ khung bổ sung nhau

```text
RED (cho SERVICE)      Rate · Errors · Duration
USE (cho TÀI NGUYÊN)   Utilization · Saturation · Errors

Service chậm mà RED không giải thích được → nhìn USE của tài nguyên bên dưới
  (CPU throttling, pool cạn, đĩa bão hoà, GC)
```

### Cái bẫy trung bình và tổng hợp

```text
① TRUNG BÌNH che giấu đuôi phân bố    → dùng phân vị
② TRUNG BÌNH CỦA PHÂN VỊ là vô nghĩa  → tổng hợp từ histogram
③ TỔNG HỢP TOÀN HỆ THỐNG che giấu một tenant/region đang hỏng
   → luôn có khả năng cắt theo chiều (tenant tier, region, endpoint)
④ SLO TOÀN CỤC che giấu SLO theo endpoint
   → endpoint quan trọng nhất có thể hỏng mà tổng thể vẫn đạt
```

Mục ③ chính là điều đã xảy ra trong sự cố ở đầu note.

## Example

Instrument một service theo RED, với bucket đặt quanh SLO:

```ts
import { Counter, Histogram, Gauge } from 'prom-client';

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Thời lượng request HTTP',
  labelNames: ['route', 'method', 'status_class'],      // ← cardinality THẤP
  buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5],
});                                //          ↑ dày quanh SLO 200ms

const ordersCreated = new Counter({
  name: 'orders_created_total',
  help: 'Số đơn hàng đã tạo',
  labelNames: ['tenant_tier'],                           // ← tín hiệu NGHIỆP VỤ
});

const queueDepth = new Gauge({
  name: 'job_queue_depth',
  help: 'Số job đang chờ',
  labelNames: ['queue'],
});

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({
      route: req.route?.path ?? 'unknown',               // MẪU route, không phải URL thật
      method: req.method,
      status_class: `${Math.floor(res.statusCode / 100)}xx`,   // 6 giá trị, không phải 60
    });
  });
  next();
});
```

Hai chi tiết chống cardinality: `req.route.path` (`/orders/:id`) thay vì `req.url` (`/orders/8421`), và `status_class` thay vì `status`. Cùng nhau, chúng giữ số chuỗi thời gian ở mức hàng trăm thay vì hàng triệu.

SLI và burn rate alert:

```promql
# SLI khả dụng: tỉ lệ request KHÔNG lỗi, loại bỏ health check và 4xx
sum(rate(http_request_duration_seconds_count{status_class!="5xx", route!="/health"}[5m]))
/
sum(rate(http_request_duration_seconds_count{route!="/health"}[5m]))

# SLI độ trễ: tỉ lệ request nhanh hơn 200ms
sum(rate(http_request_duration_seconds_bucket{le="0.2", route!="/health"}[5m]))
/
sum(rate(http_request_duration_seconds_count{route!="/health"}[5m]))
```

```yaml
# burn rate alert: hai cửa sổ, một cho sự cố lớn, một cho rò rỉ chậm
- alert: ErrorBudgetBurnFast
  expr: |
    (1 - (sum(rate(http_requests_total{status_class!="5xx"}[1h]))
        / sum(rate(http_requests_total[1h])))) > (14.4 * 0.001)
  for: 2m
  labels: { severity: page }
  annotations:
    summary: "Tiêu ngân sách lỗi gấp 14x — hết 2% ngân sách tháng mỗi giờ"
    runbook: "https://wiki/runbooks/error-budget-burn"

- alert: ErrorBudgetBurnSlow
  expr: |
    (1 - (sum(rate(http_requests_total{status_class!="5xx"}[6h]))
        / sum(rate(http_requests_total[6h])))) > (6 * 0.001)
  for: 15m
  labels: { severity: page }
```

`0.001` là tỉ lệ lỗi cho phép của SLO 99,9%. Nhân với hệ số burn rate cho ngưỡng tương ứng với "tiêu bao nhiêu phần trăm ngân sách trong cửa sổ này".

## Prediction

1. Uptime 99,95% đo bằng health check mỗi 60 giây từ một điểm — nó đo trải nghiệm người dùng không?
2. Một tenant chiếm 2% lưu lượng gặp 100% lỗi — SLI toàn cục thay đổi bao nhiêu?
3. Dùng summary cho độ trễ, 10 pod, muốn p99 toàn hệ thống — làm được không?
4. Dùng histogram — làm được không?
5. Bucket `[0.5, 1, 5, 10]` với SLO 200ms — đo được p99 chính xác không?
6. Lỗi trả về trong 5ms, thành công mất 300ms, gộp chung khi tính p99 — số đó nói gì?
7. SLO 99,9% trong 30 ngày — ngân sách lỗi bằng bao nhiêu phút?
8. SLO 99,99% — bao nhiêu phút?
9. Tỉ lệ lỗi 0,9% liên tục cả tháng, alert đặt ở ngưỡng 1% — có kêu không? Ngân sách còn không?
10. Alert theo burn rate — có kêu không?
11. Label `user_id` với 100.000 người dùng — số chuỗi thời gian?
12. Label `status` (60 mã) so với `status_class` (6) trên 20 route — chênh bao nhiêu chuỗi?
13. Đặt SLO 100% — hệ quả với tốc độ phát hành?
14. Consumer chết lúc 2 giờ sáng, chỉ đo throughput chứ không đo tuổi job cũ nhất — bao giờ phát hiện?

<details>
<summary>Đáp án</summary>

1. **Không** — nó đo một endpoint không ai dùng, từ một điểm, mỗi phút.
2. **0,02%** — gần như vô hình trong số tổng. Đây là lý do phải cắt theo chiều.
3. **Không** — phân vị không cộng được.
4. **Có** — cộng bucket rồi nội suy.
5. **Không** — mọi thứ dưới 500ms nằm chung một bucket.
6. Nó **trông đẹp một cách giả tạo** — lỗi nhanh kéo phân vị xuống.
7. **43,2 phút.**
8. **4,3 phút.**
9. Alert ngưỡng **không kêu**; ngân sách 0,1% đã bị tiêu **gấp 9 lần**.
10. **Có** — burn rate ≈ 9, cửa sổ dài sẽ bắt.
11. **100.000+ chuỗi** cho một metric — cardinality explosion.
12. 20×60 = 1200 so với 20×6 = 120 — **gấp 10 lần**.
13. **Không bao giờ deploy được** — mọi thay đổi đều là rủi ro với ngân sách bằng 0.
14. Khi có người phàn nàn — throughput bằng 0 trông giống "không có việc".
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tính SLI cho một tenant cụ thể | Khác số tổng bao nhiêu? |
| Đếm số chuỗi thời gian của mỗi metric | Cái nào bùng nổ? |
| So p99 tính từ histogram và trung bình của p99 các pod | Chênh bao nhiêu? |
| Xem bucket của histogram so với ngưỡng SLO | Có đủ dày không? |
| Tách p99 của request thành công và thất bại | Chênh bao nhiêu? |
| Tính ngân sách lỗi còn lại tháng này | Bao nhiêu phần trăm? |
| Gây lỗi 5% trong 10 phút | Alert nào kêu? Sau bao lâu? |
| Gây lỗi 0,5% trong 12 giờ | Alert nào kêu? |
| Dừng một consumer | Metric nào phát hiện, sau bao lâu? |
| Hỏi "SLO của service này là bao nhiêu" | Có ai trả lời được không? |

## What Usually Goes Wrong

- **Đo thứ dễ đo** (uptime, CPU) thay vì thứ người dùng cảm nhận.
- **SLI chỉ đo toàn cục** → che giấu tenant/region/endpoint đang hỏng.
- **Dùng summary** thay histogram → không tổng hợp được.
- **Bucket không phù hợp với SLO.**
- **Gộp latency của request lỗi và thành công.**
- **Không loại bỏ health check, bot, 4xx** khỏi SLI.
- **Cardinality cao** trong label.
- **URL thật thay vì mẫu route** trong label.
- **Alert theo ngưỡng tức thời** → ồn hoặc bỏ lỡ rò rỉ chậm.
- **SLO 100%** hoặc không có SLO nào.
- **Không ai theo dõi ngân sách lỗi** → nó không ảnh hưởng tới quyết định gì.
- **Không đo tín hiệu nghiệp vụ và độ sâu hàng đợi.**
- **SLA chặt hơn SLO** → không còn biên an toàn.
- **Không có SLO cho công việc bất đồng bộ** (freshness).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Uptime là chỉ số tin cậy | Nó không đo độ trễ, không đo lỗi từng phần |
| SLO càng cao càng tốt | Mỗi số 9 nhân chi phí; 100% chặn phát hành |
| SLA và SLO là một | SLA là hợp đồng; SLO phải chặt hơn SLA |
| p99 là số cần theo dõi | "Tỉ lệ nhanh hơn ngưỡng" cộng vào ngân sách được |
| Có thể lấy trung bình phân vị | Phải tổng hợp từ histogram |
| Nhiều label giúp chẩn đoán tốt hơn | Cardinality cao làm sập hệ thống metric |
| Alert khi lỗi vượt ngưỡng là đủ | Rò rỉ chậm đi lọt; đợt tăng ngắn gây nhiễu |
| Ngân sách lỗi là thứ phải bảo toàn | Nó là thứ để **tiêu** vào tốc độ |
| CPU cao nghĩa là có vấn đề | Bão hoà quan trọng hơn mức sử dụng |
| SLO là việc của SRE | Nó là thoả thuận giữa kỹ thuật và sản phẩm |

## Debugging

1. **SLO đạt nhưng khách hàng phàn nàn** → cắt SLI theo tenant, region, endpoint. Số tổng đang che giấu.
2. **p99 tăng đột ngột** → tách theo route và theo status; lỗi nhanh hay chậm đều làm p99 đổi.
3. **Metric không khớp với trải nghiệm** → SLI có loại bỏ health check và bot không? Có đo từ góc nhìn người dùng không?
4. **Hệ thống metric chậm hoặc hết bộ nhớ** → tìm metric có nhiều chuỗi nhất (`topk(10, count by (__name__)({__name__=~".+"}))`).
5. **Không tính được phân vị chính xác** → bucket quá thưa quanh vùng quan tâm.
6. **Alert quá nhiều** → chuyển sang burn rate với hai cửa sổ.
7. **Alert không kêu khi có sự cố** → kiểm tra cửa sổ dài; và kiểm tra chính alert có đang chạy không (đo "metric vắng mặt").
8. **Từ metric sang trace**: dùng exemplar để mở một trace đại diện thay vì đoán.

## Production Considerations

- **SLI đo từ góc nhìn người dùng**, trên endpoint người dùng thật sự gọi.
- **Luôn có khả năng cắt SLI theo tenant, region, endpoint.**
- **Histogram cho độ trễ**, bucket dày quanh ngưỡng SLO.
- **Tách latency của request thành công và thất bại.**
- **Loại health check, bot, 4xx của client** khỏi mẫu số.
- **Label cardinality thấp**: mẫu route, `status_class`, tier — không dùng ID.
- **SLO 99,9% là mặc định hợp lý**; chỉ tăng khi có lý do và ngân sách vận hành.
- **SLO phải chặt hơn SLA** để có biên an toàn.
- **Alert theo burn rate với nhiều cửa sổ**, không theo ngưỡng tức thời.
- **Theo dõi ngân sách lỗi công khai** và gắn nó với quyết định phát hành.
- **SLO cho công việc bất đồng bộ** dưới dạng freshness và tuổi job cũ nhất.
- **Metric nghiệp vụ** song song metric kỹ thuật.
- **Xem lại SLO định kỳ** — nếu luôn đạt dễ dàng, nó quá lỏng; nếu luôn trượt, nó không thực tế hoặc hệ thống cần đầu tư.
- **Đo cả "metric vắng mặt"** — instrument hỏng trông giống hệ thống khoẻ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| SLO cao | người dùng hài lòng hơn | chi phí tăng nhiều lần, phát hành chậm |
| SLO thấp | phát hành nhanh | rủi ro mất khách |
| Nhiều label | chẩn đoán tốt | cardinality, chi phí |
| Ít label | rẻ | phải đoán khi điều tra |
| Histogram | tổng hợp đúng | tốn nhiều chuỗi hơn (một cho mỗi bucket) |
| Summary | ít chuỗi hơn | không tổng hợp được |
| Burn rate alert | ít nhiễu, bắt cả rò rỉ chậm | cấu hình phức tạp hơn |
| Ngưỡng tức thời | dễ hiểu | ồn hoặc bỏ lỡ |
| SLO theo endpoint | chính xác | nhiều thứ phải theo dõi |
| SLO toàn cục | đơn giản | che giấu vấn đề cục bộ |

## Explain Without Notes

1. SLI, SLO, SLA khác nhau thế nào? Cái nào phải chặt hơn cái nào?
2. Vì sao histogram cho độ trễ, không dùng summary?
3. Bucket ảnh hưởng thế nào tới độ chính xác của phân vị?
4. Error budget là gì và nó biến câu hỏi nào thành phép đo?
5. Vì sao SLO 100% là mục tiêu sai?
6. Burn rate alert giải quyết hai vấn đề gì của alert ngưỡng?
7. Bốn tín hiệu vàng, và hai tín hiệu bổ sung cho hệ thống hàng đợi?
8. Vì sao SLI toàn cục có thể đạt trong khi khách hàng lớn nhất không dùng được?

## Related

- [Logs, metrics, traces](01-logs-metrics-traces.md) — vai trò của metric
- [Alerting & dashboards](05-alerting-dashboards.md) — biến SLO thành hành động
- [Correlation & tracing](03-correlation-tracing.md) — exemplar nối metric với trace
- [Failure modes](../reliability/01-failure-modes.md) — thứ SLO bảo vệ
- [Capacity & limits](../reliability/04-capacity-and-limits.md) — bão hoà và giới hạn
- [Latency & bottleneck](../performance/01-latency-throughput-bottleneck.md) — đọc số độ trễ
- [Autoscaling](../../04-infrastructure/04-kubernetes/scheduling-reliability/03-autoscaling.md) — metric làm đầu vào cho scaling
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — ngân sách lỗi và tốc độ phát hành

## Version / Context

Khái niệm SLI/SLO/error budget theo Google SRE Book và The Site Reliability Workbook; burn rate alerting với nhiều cửa sổ theo chương "Alerting on SLOs". Ví dụ dùng Prometheus (`prom-client` cho Node.js) và PromQL. OpenTelemetry Metrics là chuẩn thay thế cho instrumentation, xuất được sang Prometheus. Bốn tín hiệu vàng từ Google SRE; RED từ Tom Wilkie; USE từ Brendan Gregg.
