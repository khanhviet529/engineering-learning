---
level: intermediate
area: cross-cutting
---

# Observability

Một câu phân biệt observability với monitoring:

> **Monitoring** trả lời câu hỏi bạn đã biết trước sẽ hỏi.
> **Observability** trả lời câu hỏi bạn chưa từng nghĩ tới — lúc 3 giờ sáng, khi có sự cố chưa từng xảy ra.

Và một điều kiện làm nó thành hiện thực: **ba tín hiệu phải nối được với nhau bằng `trace_id`.** Có log, có metric, có trace mà không nối được thì bạn có ba kho dữ liệu, không phải khả năng quan sát.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Logs, metrics, traces](01-logs-metrics-traces.md) | Có đủ ba tín hiệu, vì sao vẫn không tìm ra nguyên nhân? |
| 2 | [Structured logging](02-structured-logging.md) | Vì sao đếm người dùng bị ảnh hưởng mất 40 phút? |
| 3 | [Correlation & tracing](03-correlation-tracing.md) | A nói 3,8 giây, B nói 40ms — thời gian còn lại ở đâu? |
| 4 | [Metrics & SLO](04-metrics-slo.md) | Uptime 99,95% mà khách hàng lớn nhất doạ rời đi? |
| 5 | [Alerting & dashboards](05-alerting-dashboards.md) | Cảnh báo đúng đã kêu ở phút thứ 2 — vì sao không ai thấy? |

Note 2 và 3 là hai note có tác động thực tế lớn nhất: `trace_id` trong mọi dòng log thay đổi tốc độ điều tra nhiều hơn bất kỳ công cụ nào.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Biết p99 tăng nhưng không biết request nào | metric không nối được với trace | [1](01-logs-metrics-traces.md) |
| Hệ thống metric quá tải sau khi thêm một label | cardinality explosion | [1](01-logs-metrics-traces.md), [4](04-metrics-slo.md) |
| Không ghép được log của một request | thiếu `trace_id` | [2](02-structured-logging.md) |
| Đếm gì cũng phải viết regex | log dạng chuỗi | [2](02-structured-logging.md) |
| Không biết lỗi bắt đầu từ bản nào | thiếu `version` trong log | [2](02-structured-logging.md) |
| Bí mật xuất hiện trong log | redact không ở tầng logger | [2](02-structured-logging.md) |
| Hai service đều "nhanh" nhưng request chậm | khoảng trống giữa span | [3](03-correlation-tracing.md) |
| Trace dừng ở một service | context không được truyền tiếp | [3](03-correlation-tracing.md) |
| Job qua queue không nối được với request gốc | context không nhúng vào message | [3](03-correlation-tracing.md) |
| Không có trace của đúng request lỗi | head sampling | [1](01-logs-metrics-traces.md), [3](03-correlation-tracing.md) |
| SLO đạt nhưng khách hàng phàn nàn | SLI chỉ đo toàn cục | [4](04-metrics-slo.md) |
| p99 của 10 pod cộng lại không đúng | dùng summary thay histogram | [4](04-metrics-slo.md) |
| Lỗi 0,9% cả tháng mà không alert nào kêu | alert theo ngưỡng tức thời | [4](04-metrics-slo.md), [5](05-alerting-dashboards.md) |
| Một sự cố sinh 40 thông báo | thiếu gom nhóm và inhibit | [5](05-alerting-dashboards.md) |
| Người trực đã tắt thông báo | alert nhiễu | [5](05-alerting-dashboards.md) |
| Mọi chỉ số xanh nhưng không ai mua được hàng | thiếu tín hiệu nghiệp vụ | [1](01-logs-metrics-traces.md), [5](05-alerting-dashboards.md) |
| Consumer chết lúc 2 giờ sáng, sáng mới biết | không đo tuổi job cũ nhất | [4](04-metrics-slo.md) |

## Mười quyết định mặc định

```text
Nối ba tín hiệu
 1. trace_id trong MỌI dòng log (AsyncLocalStorage) — thay đổi giá trị cao nhất.
 2. Trả x-trace-id trong response để người dùng báo lỗi kèm mã tra cứu.
 3. Exemplar để nhảy từ điểm p99 trên biểu đồ sang một trace cụ thể.

Log
 4. JSON có cấu trúc; thông điệp là HẰNG SỐ, dữ liệu nằm ở trường.
 5. Trường bắt buộc: service, version, env, trace_id, level, timestamp.
 6. Redact ở tầng logger. Log lỗi MỘT LẦN, ở nơi xử lý.

Metric
 7. Histogram cho độ trễ, bucket dày quanh ngưỡng SLO.
 8. Label cardinality thấp: mẫu route, status_class, tier — không dùng ID.

SLO & alert
 9. SLI đo từ góc nhìn người dùng, cắt được theo tenant/region/endpoint.
10. Alert theo TRIỆU CHỨNG với burn rate nhiều cửa sổ; mỗi alert PAGE có runbook.
```

## Ba thứ hầu hết đội ngũ thiếu

```text
① TÍN HIỆU NGHIỆP VỤ
   đơn hàng/phút, đăng ký/giờ
   → bắt được lớp sự cố mà mọi chỉ số kỹ thuật đều xanh

② DẤU MỐC THAY ĐỔI trên dashboard
   deploy, feature flag, thay đổi cấu hình
   → "cái gì đã đổi lúc 14:32" là câu hỏi có tỉ lệ trúng cao nhất

③ TUỔI JOB CŨ NHẤT trong hàng đợi
   → tín hiệu sớm nhất của consumer chết; throughput = 0 trông giống "không có việc"
```

## Quy trình điều tra

```text
① Xác nhận triệu chứng bằng SỐ        chậm bao nhiêu, từ khi nào, bao nhiêu %
② Cái gì đã THAY ĐỔI?                  deploy · flag · cấu hình · lưu lượng · dependency
③ Thu hẹp theo CHIỀU                   endpoint · tenant · region · version
④ Metric → TRACE                       exemplar hoặc truy vấn theo độ trễ
⑤ Đọc HÌNH DẠNG trace                  bậc thang = tuần tự · span lặp = N+1 · khoảng trống = chờ
⑥ Trace → LOG bằng trace_id            chi tiết tại điểm nghi ngờ
⑦ MỘT giả thuyết, MỘT thay đổi
⑧ Postmortem: tín hiệu nào LẼ RA phát hiện sớm hơn?
```

Bước ⑧ là cách hệ thống observability cải thiện theo thời gian. Không có nó, mỗi sự cố dạy được rất ít.

## Kiểm tra nhanh cho một feature mới

```text
□ Nếu nó lỗi lúc 3 giờ sáng, bạn tìm nguyên nhân bằng dữ liệu nào?
□ Log của nó có trace_id, có ngữ cảnh nghiệp vụ không?
□ Nó có metric nào cho biết "đang hoạt động bình thường" không?
□ Nếu nó chậm, trace có cho thấy thời gian tiêu ở đâu không?
□ Nếu nó ngừng hoạt động hoàn toàn, có alert nào kêu không?
□ Alert đó có runbook không?
```

Câu đầu tiên là câu hỏi cross-cutting số hai trong [05-cross-cutting/](../README.md) — nếu chưa trả lời được, feature chưa xong.

## Position

```text
                    ┌─── METRIC  "có gì sai?"  ──────┐
người dùng → app ───┼─── TRACE   "sai ở đâu?"  ──────┼── trace_id nối cả ba
                    └─── LOG     "vì sao sai?" ──────┘
                                     ↓
                            SLO → alert → runbook → hành động
```

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Reliability](../reliability/README.md) — thứ observability giúp bạn giữ
- [Performance](../performance/README.md) — dùng cùng dữ liệu để tối ưu
- [Security](../security/README.md) — audit log và phát hiện bất thường
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — log lúc tắt
- [Debugging Kubernetes](../../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md) — quan sát ở tầng hạ tầng
- [Logs & services](../../04-infrastructure/00-linux/06-logs-and-services.md) — stdout, journald, xoay vòng
- [Explain analyze workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) — quan sát ở tầng database

## Version / Context

OpenTelemetry là chuẩn instrumentation (traces và metrics stable; logs đang hoàn thiện). Ví dụ dùng Node.js 20+, pino v9, Prometheus/`prom-client`, Alertmanager, Grafana, OpenTelemetry Collector. Khái niệm SLI/SLO/error budget và burn rate alerting theo Google SRE Book và The Site Reliability Workbook.
