---
level: intermediate
area: cross-cutting
prerequisites:
  - 04-metrics-slo.md
related:
  - ../reliability/01-failure-modes.md
  - 03-correlation-tracing.md
---

# Alerting & dashboards

> Kênh cảnh báo của một đội ngũ nhận trung bình 200 thông báo mỗi ngày. Người trực đã đặt bộ lọc để chúng không hiện thông báo. Trong sự cố kéo dài 90 phút, cảnh báo đúng đã kêu ở phút thứ hai — nó nằm giữa 47 cảnh báo khác về CPU tạm thời và pod restart bình thường. **Vấn đề không phải là thiếu cảnh báo; vấn đề là cảnh báo đã ngừng mang thông tin.**

## Position

```text
Metric/log/trace  → DỮ LIỆU
Dashboard         → dữ liệu cho người ĐANG NHÌN
Alert             → dữ liệu tự tìm đến người KHÔNG nhìn
                    ↑ nó gọi người dậy lúc 3 giờ sáng — đặt tiêu chuẩn tương xứng
```

## Problem

```text
Alert có một chi phí mà dashboard không có: SỰ CHÚ Ý CỦA CON NGƯỜI.

Chi phí đó không tuyến tính:
  5 alert/ngày   → mỗi cái được đọc
  50 alert/ngày  → đọc lướt
  200 alert/ngày → lọc đi, và cảnh báo THẬT chết chung với chúng

⇒ Alert nhiễu không phải "hơi phiền". Nó VÔ HIỆU HOÁ toàn bộ hệ thống cảnh báo.
```

## Mental Model

### Một câu hỏi trước mỗi alert

```text
"Người nhận sẽ LÀM GÌ, NGAY BÂY GIỜ?"

không có câu trả lời cụ thể  → đây không phải alert
                              → nó là dashboard, hoặc là ticket, hoặc là nên xoá
```

Ba mức, và mỗi mức có kênh riêng:

```text
PAGE    người dùng đang bị ảnh hưởng, cần hành động NGAY
        → gọi điện, đánh thức
        → phải có runbook

TICKET  cần xử lý nhưng không gấp (đĩa 70%, cert hết hạn 21 ngày nữa)
        → hàng đợi công việc, giờ hành chính

INFO    ghi nhận, không cần ai làm gì
        → dashboard hoặc log, KHÔNG PHẢI alert
```

Phần lớn alert nhiễu là mục INFO bị gửi nhầm vào kênh PAGE.

### Cảnh báo theo TRIỆU CHỨNG, không theo NGUYÊN NHÂN

```text
✗ NGUYÊN NHÂN:  CPU > 80% · pod restart · queue depth > 1000 · memory > 90%
   → có thể hoàn toàn bình thường
   → và không phủ hết: hệ thống hỏng theo cách bạn chưa nghĩ tới

✓ TRIỆU CHỨNG:  tỉ lệ lỗi tăng · độ trễ vượt SLO · đơn hàng/phút giảm bất thường
   → phủ MỌI nguyên nhân, kể cả nguyên nhân chưa biết
   → tương ứng trực tiếp với trải nghiệm người dùng
```

```text
Ngoại lệ hợp lý cho alert theo nguyên nhân:
  · thứ dẫn tới hỏng CHẮC CHẮN và có thời gian phản ứng
    (đĩa đầy trong 4 giờ, chứng chỉ hết hạn trong 14 ngày)
  · thứ triệu chứng KHÔNG thể hiện được
    (backup thất bại, replica lag tăng, consumer đã chết)
```

Nguyên tắc: alert triệu chứng cho **cái đang xảy ra**, alert nguyên nhân cho **cái sắp chắc chắn xảy ra**.

### Bốn thuộc tính của một alert dùng được

```text
① CHÍNH XÁC   nó kêu khi có vấn đề thật (ít dương tính giả)
② NHẠY        nó kêu khi có vấn đề (ít âm tính giả)
③ KỊP THỜI    đủ sớm để hành động có ích
④ HÀNH ĐỘNG ĐƯỢC  người nhận biết phải làm gì
```

```text
① và ② đối nghịch nhau. Burn rate với nhiều cửa sổ là cách cân bằng chuẩn:
  cửa sổ NGẮN + ngưỡng CAO  → bắt sự cố lớn nhanh, không kêu vì dao động nhỏ
  cửa sổ DÀI  + ngưỡng THẤP → bắt rò rỉ chậm mà cửa sổ ngắn bỏ qua
```

Xem [Metrics & SLO](04-metrics-slo.md).

### Nội dung của một alert

```text
Alert kém:  "HighErrorRate fired on api-prod"
            → người nhận phải tự tìm mọi thứ

Alert tốt phải trả lời năm câu ngay trong thông báo:
  ① CÁI GÌ đang sai (bằng số)
  ② ẢNH HƯỞNG tới ai, bao nhiêu
  ③ TỪ KHI NÀO
  ④ LÀM GÌ tiếp theo (link runbook)
  ⑤ NHÌN Ở ĐÂU (link dashboard đã lọc sẵn đúng ngữ cảnh)
```

```yaml
annotations:
  summary: "checkout 5xx đạt {{ $value | humanizePercentage }} (SLO: 0.1%)"
  description: >
    Ảnh hưởng ~{{ with query "sum(rate(http_requests_total{route='/checkout',status_class='5xx'}[5m]))*300" }}
    {{ . | first | value | humanize }}{{ end }} request trong 5 phút qua.
    Tiêu ngân sách lỗi gấp 14x.
  runbook: "https://wiki/runbooks/checkout-5xx"
  dashboard: "https://grafana/d/checkout?var-env=prod&from=now-1h"
```

### Runbook: thứ biến alert thành hành động

```text
Runbook KHÔNG phải tài liệu kiến trúc. Nó là danh sách việc làm ngay:

  ① Xác nhận: truy vấn/dashboard nào chứng minh vấn đề có thật?
  ② Ảnh hưởng: cách đo bao nhiêu người dùng bị ảnh hưởng?
  ③ Giảm thiểu TRƯỚC: rollback? tắt feature flag? tăng replica? chuyển traffic?
  ④ Chẩn đoán: ba giả thuyết phổ biến nhất và cách loại trừ từng cái
  ⑤ Leo thang: ai, khi nào, liên hệ thế nào
```

Thứ tự ③ trước ④ là có chủ đích: **giảm thiểu trước, hiểu sau**. Rollback trước rồi điều tra nguyên nhân trong giờ hành chính là quyết định đúng trong đa số trường hợp.

Một alert không có runbook là một alert chưa hoàn thành.

### Chống nhiễu

```text
`for:` (chờ trước khi kêu)     lọc dao động ngắn
GOM NHÓM theo service/sự cố    một sự cố = một thông báo, không phải 47
ỨC CHẾ (inhibit)               "cả cluster down" thì im mọi alert của service trong đó
IM LẶNG (silence) có thời hạn  trong lúc bảo trì — LUÔN có hạn, không vĩnh viễn
KHỬ TRÙNG LẶP                  cùng alert từ 20 pod = một thông báo
```

```yaml
# Alertmanager: gom nhóm và ức chế
route:
  group_by: ['alertname', 'service']
  group_wait: 30s          # chờ gom các alert liên quan
  group_interval: 5m
  repeat_interval: 4h      # không lặp lại quá thường xuyên

inhibit_rules:
  - source_matchers: [severity="critical", alertname="ClusterDown"]
    target_matchers: [severity="warning"]
    equal: ['cluster']     # cluster down → im mọi cảnh báo warning của cluster đó
```

### Dashboard: thiết kế theo CÂU HỎI

```text
✗ dashboard "mọi metric của service X"
   → 40 biểu đồ, không cái nào trả lời câu hỏi nào

✓ ba loại dashboard, ba mục đích:

  ① TỔNG QUAN (một màn hình, không cuộn)
     SLI hiện tại · ngân sách lỗi còn lại · RED · sự cố đang mở
     → trả lời: "hệ thống có ổn không?"

  ② SỰ CỐ (dùng khi có alert)
     bố cục theo THỨ TỰ ĐIỀU TRA: triệu chứng → theo chiều → dependency → tài nguyên
     → trả lời: "sai ở đâu?"

  ③ CHUYÊN SÂU (một khía cạnh)
     database, queue, cache
     → trả lời: "thành phần này đang thế nào?"
```

### Bốn quy tắc thiết kế dashboard

```text
① SỰ KIỆN THAY ĐỔI vẽ lên mọi biểu đồ (deploy, feature flag, cấu hình)
   → "cái gì đã đổi lúc 14:32" là câu hỏi đầu tiên của mọi sự cố

② SO SÁNH VỚI QUÁ KHỨ (cùng giờ tuần trước)
   → không có baseline thì không có bất thường

③ CÙNG TRỤC THỜI GIAN cho mọi biểu đồ trên một trang
   → so sánh trực quan được

④ NGƯỠNG SLO vẽ thành đường ngang
   → biết ngay đang ở trong hay ngoài mục tiêu
```

### On-call bền vững

```text
Chỉ số sức khoẻ của hệ thống cảnh báo:
  · số lần bị GỌI DẬY BAN ĐÊM mỗi tuần    → nếu > 1–2, hệ thống đang hỏng
  · tỉ lệ alert DẪN TỚI HÀNH ĐỘNG          → nếu < 50%, quá nhiễu
  · thời gian từ alert tới giảm thiểu      → nếu dài, runbook chưa đủ

Xem lại alert hằng tháng:
  · alert nào kêu nhiều nhất mà không cần hành động?  → sửa ngưỡng hoặc xoá
  · sự cố nào KHÔNG có alert?                          → thêm
  · alert nào chưa bao giờ kêu?                        → nó có còn hoạt động không?
```

Câu hỏi cuối đáng chú ý: một alert chưa bao giờ kêu có thể vì hệ thống ổn định, hoặc vì nó đã hỏng từ lâu. Cần **kiểm tra alert vẫn hoạt động** — Prometheus có `ALERTS` metric, và một "deadman switch" (alert luôn kêu, dùng để xác nhận đường dẫn cảnh báo còn sống) là cách chuẩn.

## Example

Bộ alert tối thiểu cho một service — năm alert, không phải năm mươi:

```yaml
groups:
- name: checkout-slo
  rules:
  # ① triệu chứng: tiêu ngân sách nhanh — sự cố lớn
  - alert: CheckoutErrorBudgetFastBurn
    expr: |
      (1 - (sum(rate(http_requests_total{route="/checkout",status_class!="5xx"}[1h]))
          / sum(rate(http_requests_total{route="/checkout"}[1h])))) > 0.0144
    for: 2m
    labels: { severity: page, service: checkout }
    annotations:
      summary: "checkout lỗi {{ $value | humanizePercentage }} — tiêu ngân sách gấp 14x"
      runbook: "https://wiki/runbooks/checkout-errors"
      dashboard: "https://grafana/d/checkout?from=now-1h"

  # ② triệu chứng: rò rỉ chậm — cửa sổ dài, ngưỡng thấp
  - alert: CheckoutErrorBudgetSlowBurn
    expr: |
      (1 - (sum(rate(http_requests_total{route="/checkout",status_class!="5xx"}[6h]))
          / sum(rate(http_requests_total{route="/checkout"}[6h])))) > 0.006
    for: 15m
    labels: { severity: page, service: checkout }

  # ③ triệu chứng: độ trễ vượt SLO
  - alert: CheckoutLatencySLOBreach
    expr: |
      (sum(rate(http_request_duration_seconds_bucket{route="/checkout",le="0.5"}[30m]))
     / sum(rate(http_request_duration_seconds_count{route="/checkout"}[30m]))) < 0.99
    for: 10m
    labels: { severity: page, service: checkout }

  # ④ triệu chứng NGHIỆP VỤ — bắt được thứ ba cái trên bỏ lỡ
  - alert: OrdersDroppedVsLastWeek
    expr: |
      sum(rate(orders_created_total[30m]))
        < 0.5 * sum(rate(orders_created_total[30m] offset 1w))
    for: 15m
    labels: { severity: page, service: checkout }
    annotations:
      summary: "Đơn hàng giảm >50% so với cùng giờ tuần trước"
      description: "Hệ thống có thể 'khoẻ' theo mọi chỉ số kỹ thuật mà vẫn không bán được hàng."

  # ⑤ nguyên nhân — nhưng là loại DẪN TỚI HỎNG CHẮC CHẮN, có thời gian phản ứng
  - alert: DiskWillFillIn4Hours
    expr: predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[1h], 4*3600) < 0
    for: 10m
    labels: { severity: ticket }
```

Alert ④ là cái đáng giá nhất trong danh sách: nó bắt được lớp sự cố mà mọi chỉ số kỹ thuật đều xanh — thanh toán bị từ chối bởi nhà cung cấp, feature flag sai làm ẩn nút mua, deploy frontend hỏng nhưng backend vẫn trả 200.

Và một deadman switch để biết chính hệ thống cảnh báo còn sống:

```yaml
  - alert: AlertingPipelineAlive
    expr: vector(1)
    labels: { severity: heartbeat }
    annotations:
      summary: "Alert này LUÔN kêu. Nếu nó IM, đường dẫn cảnh báo đã hỏng."
```

## Prediction

1. 200 alert/ngày, cảnh báo đúng kêu ở phút thứ 2 — người trực thấy nó không?
2. Alert "CPU > 80%" trên service chạy batch job — nó kêu bao nhiêu lần/ngày?
3. Alert "tỉ lệ lỗi vượt SLO" — nó kêu khi nào?
4. Nguyên nhân mới chưa từng gặp làm hệ thống hỏng — alert theo nguyên nhân có bắt được không?
5. Alert theo triệu chứng — có bắt được không?
6. Alert không có runbook, người trực mới vào đội 2 tuần — mất bao lâu để hành động?
7. Có runbook với bước "rollback trước" — mất bao lâu?
8. Cả cluster down, 40 service mỗi cái một alert — người trực nhận bao nhiêu thông báo?
9. Có inhibit rule — bao nhiêu?
10. Silence không thời hạn đặt trong lúc bảo trì, quên gỡ — hậu quả?
11. Alert chưa bao giờ kêu trong 6 tháng — nó ổn hay đã hỏng?
12. Deadman switch im lặng — nghĩa là gì?
13. Hệ thống trả 200 cho mọi request nhưng frontend hỏng, không ai mua được — alert kỹ thuật có kêu không?
14. Có alert "đơn hàng giảm 50% so với tuần trước" — có kêu không?

<details>
<summary>Đáp án</summary>

1. **Không** — nó nằm giữa 47 cảnh báo khác và bộ lọc đã tắt thông báo.
2. Rất nhiều — CPU cao là **trạng thái bình thường** của batch job.
3. Khi **người dùng thật sự bị ảnh hưởng**.
4. **Không** — bạn chỉ cảnh báo những nguyên nhân đã nghĩ tới.
5. **Có** — triệu chứng phủ mọi nguyên nhân.
6. Lâu — phải tự tìm hiểu hệ thống trong lúc đang có sự cố.
7. Vài phút để **giảm thiểu**, rồi điều tra sau.
8. **40 thông báo** cho một sự cố.
9. **Một.**
10. Alert đó **im vĩnh viễn** — và không ai nhớ để bật lại.
11. **Không biết được** nếu không kiểm tra — có thể nó đã hỏng.
12. **Đường dẫn cảnh báo đã hỏng** — bạn đang mù mà không biết.
13. **Không** — mọi chỉ số kỹ thuật đều xanh.
14. **Có** — đây là lý do tín hiệu nghiệp vụ quan trọng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm số alert nhận được trong 7 ngày qua | Bao nhiêu dẫn tới hành động? |
| Chọn một alert bất kỳ, hỏi "làm gì bây giờ" | Có runbook không? |
| Xem alert kêu nhiều nhất tháng qua | Nó có nên tồn tại không? |
| Liệt kê sự cố 6 tháng qua | Cái nào không có alert? |
| Gây lỗi 5% trong staging | Alert nào kêu, sau bao lâu? |
| Tắt một dependency | Alert theo triệu chứng có bắt được không? |
| Xem dashboard chính, hỏi "hệ thống ổn không" | Trả lời được trong 10 giây không? |
| Tìm "deploy lúc X" trên dashboard | Có đường dọc không? |
| Đặt silence rồi quên | Có cơ chế hết hạn không? |
| Ngắt kết nối tới hệ thống cảnh báo | Deadman switch có phát hiện không? |
| Hỏi ai đó chưa từng trực xử lý một alert | Họ có làm được không? |

## What Usually Goes Wrong

- **Quá nhiều alert** → bộ lọc → cảnh báo thật chết chung.
- **Alert theo nguyên nhân** thay vì triệu chứng.
- **Alert không hành động được** — INFO gửi vào kênh PAGE.
- **Không có runbook.**
- **Không gom nhóm / không inhibit** → 40 thông báo cho một sự cố.
- **Silence không thời hạn** → alert im vĩnh viễn.
- **Ngưỡng tức thời** → ồn hoặc bỏ lỡ rò rỉ chậm.
- **Không có alert nghiệp vụ** → bỏ lỡ sự cố mà mọi chỉ số kỹ thuật đều xanh.
- **Không có deadman switch** → không biết hệ thống cảnh báo đã chết.
- **Dashboard 40 biểu đồ** không trả lời câu hỏi nào.
- **Không đánh dấu deploy** trên dashboard.
- **Không so với baseline.**
- **Không xem lại alert định kỳ** → danh sách chỉ tăng.
- **Không đo sức khoẻ on-call** → kiệt sức âm thầm.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Nhiều alert = an toàn hơn | Nhiều alert = không alert nào được đọc |
| Alert khi tài nguyên cao là hợp lý | Tài nguyên cao thường là bình thường |
| Mọi alert đều nên gọi người | Phần lớn nên là ticket hoặc dashboard |
| Runbook là tài liệu kiến trúc | Nó là danh sách việc làm ngay |
| Phải hiểu nguyên nhân rồi mới xử lý | Giảm thiểu trước, hiểu sau |
| Dashboard đẹp = observability tốt | Câu hỏi nó trả lời mới quan trọng |
| Alert im nghĩa là hệ thống khoẻ | Có thể đường dẫn cảnh báo đã hỏng |
| Silence là giải pháp cho alert ồn | Nó giấu vấn đề; sửa hoặc xoá alert |
| Alert kỹ thuật đủ để phát hiện sự cố | Có lớp sự cố chỉ tín hiệu nghiệp vụ thấy |
| On-call vất vả là bình thường | Nó là chỉ báo hệ thống cảnh báo đang hỏng |

## Debugging

1. **Alert kêu**: đọc summary và mở dashboard trong annotation — nếu phải tự tìm, alert cần cải thiện.
2. **Giảm thiểu trước**: rollback, tắt feature flag, chuyển traffic. Điều tra sau khi người dùng đã ổn.
3. **"Cái gì đã đổi?"** là câu hỏi đầu tiên — deploy, flag, cấu hình, lưu lượng, dependency.
4. **Thu hẹp theo chiều** trên dashboard sự cố: endpoint, tenant, region, phiên bản.
5. **Từ metric sang trace sang log** bằng `trace_id`.
6. **Alert không kêu khi có sự cố** → kiểm tra rule có đang chạy (`ALERTS` metric), có bị silence, có bị inhibit không.
7. **Quá nhiều alert** → nhóm theo `alertname` và đếm 30 ngày; danh sách top là danh sách việc cần sửa.
8. **Sau sự cố**: thêm mục "tín hiệu nào lẽ ra phải phát hiện sớm hơn" vào postmortem — đây là cách hệ thống cảnh báo cải thiện theo thời gian.

## Production Considerations

- **Mỗi alert phải trả lời được "làm gì bây giờ"** — nếu không, xoá hoặc hạ cấp.
- **Alert theo triệu chứng** (SLO burn rate); alert nguyên nhân chỉ cho thứ dẫn tới hỏng chắc chắn.
- **Ba mức PAGE/TICKET/INFO** với ba kênh khác nhau.
- **Runbook bắt buộc cho mọi alert PAGE**, với "giảm thiểu trước".
- **Gom nhóm, inhibit, khử trùng lặp** ở Alertmanager.
- **Silence luôn có thời hạn** và có người chịu trách nhiệm.
- **Alert nghiệp vụ** song song alert kỹ thuật.
- **Deadman switch** để biết đường dẫn cảnh báo còn sống.
- **Dashboard theo mục đích**: tổng quan / sự cố / chuyên sâu.
- **Đánh dấu deploy và feature flag** trên mọi dashboard.
- **So sánh với cùng giờ tuần trước** làm baseline mặc định.
- **Đường ngưỡng SLO** trên biểu đồ.
- **Xem lại alert hằng tháng**: cái nào ồn, cái nào thiếu, cái nào chết.
- **Đo sức khoẻ on-call**: số lần bị đánh thức, tỉ lệ alert dẫn tới hành động.
- **Diễn tập sự cố định kỳ** — nó kiểm chứng cả alert, runbook và con người.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Alert nhạy | phát hiện sớm | nhiễu, mệt mỏi |
| Alert bảo thủ | ít nhiễu | phát hiện muộn |
| Alert triệu chứng | phủ nguyên nhân chưa biết | biết có vấn đề, chưa biết ở đâu |
| Alert nguyên nhân | chỉ thẳng nguyên nhân | chỉ phủ cái đã nghĩ tới, dễ nhiễu |
| `for:` dài | lọc dao động | phát hiện muộn hơn |
| Gom nhóm | ít thông báo | có thể che alert riêng lẻ |
| Nhiều dashboard | chuyên sâu | không ai biết mở cái nào |
| Một dashboard | dễ nhớ | không đủ chi tiết |
| Runbook chi tiết | ai cũng xử lý được | tốn công viết và cập nhật |
| Không runbook | không tốn công | phụ thuộc người biết việc |

## Explain Without Notes

1. Câu hỏi duy nhất cần hỏi trước khi tạo một alert?
2. Vì sao alert theo triệu chứng tốt hơn theo nguyên nhân? Ngoại lệ hợp lý là gì?
3. Ba mức alert và kênh tương ứng?
4. Năm câu mà một alert tốt phải trả lời ngay trong thông báo?
5. Năm mục của một runbook, và vì sao "giảm thiểu" đứng trước "chẩn đoán"?
6. Năm cơ chế chống nhiễu?
7. Ba loại dashboard và câu hỏi mỗi loại trả lời?
8. Deadman switch giải quyết vấn đề gì?

## Related

- [Metrics & SLO](04-metrics-slo.md) — burn rate và ngân sách lỗi
- [Logs, metrics, traces](01-logs-metrics-traces.md) — nguồn dữ liệu
- [Correlation & tracing](03-correlation-tracing.md) — từ alert tới nguyên nhân
- [Failure modes](../reliability/01-failure-modes.md) — thứ cần cảnh báo
- [Graceful degradation](../reliability/03-graceful-degradation.md) — giảm thiểu trong runbook
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — rollback là bước giảm thiểu số một
- [Debugging Kubernetes](../../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md) — điều tra ở tầng hạ tầng

## Version / Context

Ví dụ dùng Prometheus và Alertmanager (`group_by`, `inhibit_rules`, `repeat_interval`) với Grafana cho dashboard. Nguyên tắc "cảnh báo theo triệu chứng" và multi-window burn rate theo Google SRE Book / Workbook. `predict_linear` là hàm PromQL để dự báo tuyến tính. Deadman switch tương ứng với `Watchdog` alert trong Prometheus Operator.
