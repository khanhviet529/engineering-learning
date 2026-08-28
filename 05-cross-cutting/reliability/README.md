---
level: advanced
area: cross-cutting
---

# Reliability

Một câu chuyển toàn bộ cách nghĩ:

> **Performance hỏi "nhanh bao nhiêu khi mọi thứ ổn".
> Reliability hỏi "chuyện gì xảy ra khi KHÔNG ổn" — và câu trả lời được quyết định lúc thiết kế, không lúc sự cố.**

Và một quan sát phản trực giác nhưng quyết định:

> **Dependency chậm nguy hiểm hơn dependency chết.** Chết thì giải phóng tài nguyên ngay; chậm thì giữ chúng cho tới khi bạn cạn.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Failure modes](01-failure-modes.md) | Vì sao tính năng "gợi ý sản phẩm" kéo sập cả checkout? |
| 2 | [Timeout, retry & circuit breaker](02-timeout-retry-circuit-breaker.md) | Vì sao retry làm 1.400 khách bị tính tiền hai lần? |
| 3 | [Graceful degradation](03-graceful-degradation.md) | 92% đơn hàng có thể hoàn tất — vì sao hệ thống chặn tất cả? |
| 4 | [Capacity & limits](04-capacity-and-limits.md) | Vì sao tăng pod từ 6 lên 20 làm hệ thống sập? |

Note 1 là khung tư duy. Note 2 là ba cơ chế phải đi cùng nhau. Note 3 là vùng giữa "chạy" và "chết" mà hầu hết hệ thống không có. Note 4 là các con số phải biết trước.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Một tính năng phụ làm chết toàn bộ | thiếu timeout, thiếu bulkhead | [1](01-failure-modes.md) |
| Dependency chậm làm cạn worker/pool | không có timeout | [1](01-failure-modes.md), [2](02-timeout-retry-circuit-breaker.md) |
| Sự cố lan sang phần không liên quan | tài nguyên dùng chung không phân vùng | [1](01-failure-modes.md) |
| Health check xanh nhưng dữ liệu sai | fail byzantine — cần metric nghiệp vụ | [1](01-failure-modes.md) |
| Một instance chết, phần còn lại chết theo | chạy ở mức sử dụng quá cao | [1](01-failure-modes.md), [4](04-capacity-and-limits.md) |
| Dependency hỏng nhận gấp 3 lưu lượng | retry không có ngân sách | [2](02-timeout-retry-circuit-breaker.md) |
| Mọi client retry cùng lúc | thiếu jitter | [2](02-timeout-retry-circuit-breaker.md) |
| Thao tác chạy hai lần sau timeout | thiếu idempotency key | [2](02-timeout-retry-circuit-breaker.md) |
| Truy vấn vẫn chạy sau khi API bỏ cuộc | timeout tầng trong lớn hơn tầng ngoài | [2](02-timeout-retry-circuit-breaker.md) |
| Tiếp tục gọi một dịch vụ đã chết | thiếu circuit breaker | [2](02-timeout-retry-circuit-breaker.md) |
| Mất một dependency = mất toàn bộ tính năng | không có fallback | [3](03-graceful-degradation.md) |
| Hệ thống chạy thiếu tính năng nhiều ngày mà không ai biết | suy giảm im lặng | [3](03-graceful-degradation.md) |
| Không tắt được tính năng khi có sự cố | thiếu feature flag dùng được | [3](03-graceful-degradation.md) |
| Hệ thống dao động giữa hai chế độ | thiếu hysteresis | [3](03-graceful-degradation.md) |
| Scale lên làm database từ chối kết nối | `N pod × pool > max_connections` | [4](04-capacity-and-limits.md) |
| Một khách hàng làm chậm mọi khách hàng | thiếu quota theo tenant | [4](04-capacity-and-limits.md) |
| Bị nhà cung cấp chặn | không rate limit phía mình | [4](04-capacity-and-limits.md) |
| Đột biến làm sập dù có autoscaling | scale mất phút, đột biến tính bằng giây | [4](04-capacity-and-limits.md) |

## Mười hai quyết định mặc định

```text
Cô lập
 1. Timeout ở MỌI lời gọi ra ngoài, xếp thứ tự từ ngoài vào trong.
 2. Phân loại mọi dependency bắt buộc/không bắt buộc; giảm số bắt buộc.
 3. Bulkhead theo mức quan trọng: đường sinh doanh thu có phần tài nguyên riêng.

Thử lại
 4. Chỉ retry lỗi tạm thời; danh sách rõ ràng, không đoán.
 5. Exponential backoff + FULL JITTER, luôn luôn.
 6. Ngân sách retry toàn hệ thống (~10%), có metric.
 7. Idempotency key cho mọi thao tác có tác dụng phụ — ràng buộc UNIQUE ở DB làm việc chặn.
 8. Circuit breaker riêng mỗi dependency, ngưỡng theo TỈ LỆ.

Suy giảm
 9. Phân tầng tính năng (0/1/2) TRƯỚC sự cố; tầng 2 không bao giờ làm hỏng tầng 0.
10. Suy giảm phải RÕ RÀNG ở ba nơi: người dùng, response, metric.

Giới hạn
11. Viết ra TRẦN THẬT bằng số; maxReplicas tính từ nó, không đặt tuỳ ý.
12. Kiểm tra bất biến dung lượng lúc khởi động — fail fast thay vì sập lúc cao điểm.
```

## Ba con số nên thuộc lòng

```text
① NHÂN SỐ 9 LẠI
   phụ thuộc BẮT BUỘC vào 5 service, mỗi cái 99,9% → 99,5% (3,6 giờ/tháng)
   → biến phụ thuộc thành KHÔNG bắt buộc là cách rẻ nhất tăng độ tin cậy

② TẢI DỒN KHI MẤT INSTANCE
   ở 90% với 10 instance, mất 1 → phần còn lại lên 100%
   ở 70% với 10 instance, mất 1 → 78%
   → đây là lý do thứ hai (sau đường cong hàng đợi) để không chạy ở mức cao

③ KHUẾCH ĐẠI CỦA RETRY
   3 lần thử × 10.000 request = 30.000 lời gọi tới dịch vụ ĐANG HỎNG
   → ngân sách retry biến nó thành tối đa 11.000
```

## Thang trạng thái

```text
HOẠT ĐỘNG ĐẦY ĐỦ
     ↓  dependency tầng 2 hỏng
SUY GIẢM MỨC 1     ẩn gợi ý, dữ liệu cũ            ← người dùng hầu như không nhận ra
     ↓  tải cao hoặc tầng 1 hỏng
SUY GIẢM MỨC 2     tắt tìm kiếm, chỉ phục vụ cache
     ↓  quá tải
SHED LOAD          chỉ tầng 0, từ chối phần vượt với 503 + Retry-After
     ↓  tầng 0 hỏng
NGỪNG PHỤC VỤ      ← chỉ ở đây mới là "sự cố toàn phần"

Hầu hết hệ thống chỉ có bậc đầu và bậc cuối. Ba bậc giữa phải được THIẾT KẾ.
```

## Bốn câu hỏi cho mọi dependency mới

```text
① Nếu nó CHẾT, tính năng này còn hoạt động không?     → bắt buộc hay không
② Nếu nó CHẬM 30 giây, chuyện gì xảy ra?              → timeout và bulkhead
③ Nếu lời gọi timeout, thử lại có AN TOÀN không?      → idempotency
④ Nếu nó hỏng 1 giờ, người dùng thấy gì?              → fallback và thông báo
```

Bốn câu này mất năm phút và ngăn được phần lớn sự cố trong bảng chẩn đoán ở trên.

## Position

```text
Client
  ↓ timeout · retry có ngân sách · idempotency key      [2]
API  ── bulkhead ──┬── tầng 0 (checkout)                [1]
                   ├── tầng 1 (tìm kiếm)  → suy giảm     [3]
                   └── tầng 2 (gợi ý)     → tắt được     [3]
  ↓ circuit breaker                                      [2]
Dependency ── trần thật: N pod × pool ≤ max_connections  [4]
```

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Performance](../performance/README.md) — đường cong hàng đợi, backpressure
- [Observability](../observability/README.md) — phát hiện và điều tra
- [Testing](../testing/README.md) — test đường suy giảm và đường lỗi
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — thiết kế idempotency
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — đánh đổi nền tảng
- [Readiness & liveness](../../04-infrastructure/04-kubernetes/02-health-readiness-liveness.md) — health check đúng cách
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — rollback là giảm thiểu số một
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — không mất request khi tắt

## Version / Context

Khái niệm bulkhead, circuit breaker, fail fast theo Michael Nygard (*Release It!*); cascading failure, error budget và thực hành on-call theo Google SRE Book. Ví dụ dùng Node.js 20+, NestJS 10/11, PostgreSQL 16, Kubernetes 1.29+. Mỗi note ghi rõ phiên bản ở phần cuối.
