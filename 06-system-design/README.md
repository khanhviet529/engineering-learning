---
level: advanced
area: system-design
---

# System Design

System design không phải một chủ đề mới — nó là **năng lực tổng hợp**: dùng mọi thứ trong repo này để trả lời một câu hỏi cụ thể dưới ràng buộc cụ thể.

Ba câu chi phối toàn bộ folder:

> **Yêu cầu → ràng buộc → đánh đổi → kiến trúc.** Bỏ ba bước đầu là chọn công nghệ theo thói quen.
>
> **Không có kiến trúc "đúng"** — chỉ có kiến trúc phù hợp với một bộ yêu cầu cụ thể. Cùng bài toán, hai bộ số, hai kiến trúc, cả hai đều đúng.
>
> **Mỗi thành phần thêm vào là một hệ thống phải vận hành.** Câu hỏi không phải "có nên dùng X không" mà "vấn đề mới nó tạo ra có rẻ hơn vấn đề nó giải quyết không".

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Requirements & trade-offs](01-requirements-tradeoffs.md) | Vì sao sáu tuần dựng Kafka và K8s cho 40 người dùng? |
| 2 | [Scaling: cache & queue](02-scaling-cache-queue.md) | Cache giảm p99 xuống 200ms — vì sao giá hiển thị sai hai ngày? |
| 3 | [Idempotency & retry](03-idempotency-retry.md) | Bấm lại một lần, vì sao sao kê có hai giao dịch? |
| 4 | [Consistency & availability](04-consistency-availability.md) | 100% uptime trong sự cố, vì sao 340 phòng bị đặt trùng? |
| 5 | [Data partitioning & sharding](05-data-partitioning-sharding.md) | Chia 8 shard, vì sao một shard chịu 60% tải? |
| 6 | [Storage selection](06-storage-selection.md) | "Schema linh hoạt" — schema đi đâu sau 18 tháng? |
| 7 | [Event-driven](07-event-driven.md) | Không service nào phụ thuộc service nào — vì sao đổi một trường làm hỏng ba cái? |
| 8 | [Monolith → microservices](08-monolith-to-microservices.md) | Tách 9 service, vì sao một năm sau gộp về 4? |
| 9 | [Distributed systems fallacies](09-distributed-systems-fallacies.md) | Mọi dòng code đều đúng — vì sao hệ thống chết? |
| 10 | [Design exercise template](10-design-exercise-template.md) | Mười hai hộp và tám mũi tên chứa bao nhiêu quyết định? |

Note 1 và 10 là khung tư duy — đọc trước và quay lại thường xuyên. Note 9 là danh sách kiểm tra giả định, hữu ích trong mọi buổi thiết kế.

## Điều kiện tiên quyết

System design là tầng trên cùng. Nó chỉ có nghĩa khi bạn đã có mental model của các tầng dưới:

```text
① HTTP, API, ranh giới request        → 02-backend-api/00-http-api
② transaction, index, replica         → 03-database/01-postgresql
③ cache và invalidation               → 03-database/02-redis
④ queue, delivery semantics, outbox   → 03-database/04-message-queues
⑤ mạng, container, orchestrator       → 04-infrastructure
⑥ timeout, retry, suy giảm            → 05-cross-cutting/reliability
⑦ trace, metric, SLO                  → 05-cross-cutting/observability

"Dùng Kafka" không có nghĩa gì nếu bạn chưa từng gặp vấn đề mà nó giải quyết.
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Hạ tầng phức tạp hơn nhu cầu nhiều lần | không ước lượng trước khi chọn | [1](01-requirements-tradeoffs.md) |
| "Hệ thống phải nhanh" — không ai đo được | yêu cầu phi chức năng dạng tính từ | [1](01-requirements-tradeoffs.md) |
| Không ai biết vì sao chọn công nghệ X | thiếu ADR | [1](01-requirements-tradeoffs.md) |
| Dữ liệu cũ hiển thị nhiều ngày | cache không có TTL | [2](02-scaling-cache-queue.md) |
| Thêm queue mà hàng đợi vẫn tăng vô hạn | tải trung bình vượt consumer | [2](02-scaling-cache-queue.md) |
| Thao tác chạy hai lần sau timeout | thiếu idempotency key | [3](03-idempotency-retry.md) |
| Event mất im lặng | dual-write thay vì outbox | [3](03-idempotency-retry.md), [7](07-event-driven.md) |
| Uptime cao nhưng dữ liệu sai | chọn A mà không có quy trình hoà giải | [4](04-consistency-availability.md) |
| Người dùng không thấy thay đổi của mình | thiếu read-your-writes | [4](04-consistency-availability.md) |
| Một shard quá tải, phần còn lại nhàn rỗi | khoá chia gây hotspot | [5](05-data-partitioning-sharding.md) |
| Thêm replica mà ghi vẫn quá tải | replica không giúp cho ghi | [5](05-data-partitioning-sharding.md) |
| Truy vấn phải hỏi mọi shard | khoá chia không khớp truy vấn | [5](05-data-partitioning-sharding.md) |
| Năm phiên bản schema cùng tồn tại | schema chuyển vào code | [6](06-storage-selection.md) |
| Hai kho dữ liệu lệch nhau | dual-write, thiếu đối soát | [6](06-storage-selection.md), [7](07-event-driven.md) |
| Đổi một trường event làm hỏng ba service | hợp đồng event không được quản lý | [7](07-event-driven.md) |
| "Đơn hàng này đang ở bước nào" mất hàng giờ | choreography không có trạng thái quy trình | [7](07-event-driven.md) |
| Một tính năng đụng 4 service | ranh giới theo tầng kỹ thuật | [8](08-monolith-to-microservices.md) |
| Hai service luôn deploy cùng nhau | ranh giới sai — nên gộp | [8](08-monolith-to-microservices.md) |
| Dependency chậm kéo sập cả hệ thống | giả định "mạng đáng tin" | [9](09-distributed-systems-fallacies.md) |
| Thứ tự sai giữa hai máy | so sánh timestamp giữa các máy | [9](09-distributed-systems-fallacies.md) |
| Bản vẽ kiến trúc không chứa quyết định nào | vẽ trước khi hỏi | [10](10-design-exercise-template.md) |

## Mười hai quyết định mặc định

```text
Trước khi thiết kế
 1. Yêu cầu bằng SỐ: rps, dung lượng, p99, RPO/RTO. Tính từ không dùng được.
 2. Hỏi "cái gì KHÔNG cần" — nó loại bỏ cả nhánh phức tạp trước khi nó được xây.
 3. Ước lượng bậc độ lớn để biết đang ở vùng nào: 100 · 10.000 · 1.000.000 rps.

Điểm khởi đầu
 4. Modular monolith + PostgreSQL, trừ khi có bằng chứng ngược lại.
 5. Ranh giới rõ TRONG CODE trước ranh giới triển khai.
 6. Mỗi thành phần phải nêu được vấn đề nó giải quyết; không thì xoá.

Khi mở rộng
 7. Thứ tự: làm ít việc hơn → cache → queue → replica → sharding.
 8. Cache luôn có TTL; xoá chứ không cập nhật; jitter cho TTL.
 9. Outbox, không bao giờ dual-write.

Khi phân tán
10. Timeout ở mọi lời gọi mạng — kể cả mạng nội bộ.
11. Idempotency key cho mọi thao tác có tác dụng phụ, đi hết chuỗi dịch vụ.
12. Nhất quán quyết định THEO THAO TÁC, không theo hệ thống.
```

## Ba con số định hình mọi quyết định

```text
① NHÂN SỐ 9 LẠI
   5 phụ thuộc bắt buộc × 99,9% → 99,5% (3,6 giờ/tháng thay vì 43 phút)
   ⇒ biến phụ thuộc thành KHÔNG bắt buộc là cách rẻ nhất tăng độ tin cậy

② KHOẢNG CÁCH GIỮA LỜI GỌI HÀM VÀ LỜI GỌI MẠNG
   10 ns → 500 μs = chậm hơn ~50.000 lần, và có thể thất bại
   ⇒ mỗi ranh giới service là một quyết định, không phải chi tiết triển khai

③ ĐƯỜNG CONG HÀNG ĐỢI
   ρ = 0,7 → chờ 2,3×   ·   0,9 → 9×   ·   0,95 → 19×
   ⇒ 30% "lãng phí" là thứ mua khả năng chịu đột biến
```

## Bốn câu hỏi cho mọi thiết kế

```text
① Con số là bao nhiêu? (rps, dung lượng, p99, tăng trưởng)
② Thành phần này giải quyết vấn đề gì, và đánh đổi gì?
③ Khi nó hỏng, hệ thống thế nào?
④ Quyết định nào ở đây KHÓ ĐẢO NGƯỢC NHẤT?
```

Câu ④ là câu quyết định nơi nên dành thời gian: mô hình dữ liệu, khoá sharding, định danh công khai, hợp đồng event — những thứ đã phát hành ra ngoài thì không rút lại được.

## Position

```text
                  ┌── [1] yêu cầu · [10] quy trình thiết kế ──┐
                  │                                            │
  frontend ─ backend ─ database ─ infra ─ cross-cutting        │
      └──────────────────┬──────────────────────┘              │
                         ↓                                     │
        [2] mở rộng · [5] phân vùng · [6] chọn kho             │
        [3] idempotency · [4] nhất quán                        │
        [7] event-driven · [8] ranh giới service               │
        [9] giả định phân tán ───────────────────────────────┘
```

## Related

- [00-roadmap/](../00-roadmap/README.md) — bản đồ toàn repo
- [02-backend-api/](../02-backend-api/README.md) — nơi thiết kế thành code
- [03-database/](../03-database/README.md) — tầng dữ liệu, nơi phần lớn ràng buộc nằm
- [04-infrastructure/](../04-infrastructure/README.md) — nơi hệ thống thật sự chạy
- [05-cross-cutting/](../05-cross-cutting/README.md) — reliability, observability, security
- [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md) — điểm khởi đầu thực dụng
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi áp dụng vào một hệ thống thật

## Version / Context

Nội dung phần lớn không gắn công nghệ. Ví dụ dùng PostgreSQL 16, Redis 7, NestJS 10/11, Kafka, Kubernetes 1.29+. Tham chiếu: CAP (Brewer 2000, Gilbert & Lynch 2002), PACELC (Abadi 2012), tám ngộ nhận (Deutsch & Gosling 1994–1997), saga (Garcia-Molina & Salem 1987), strangler fig (Fowler), ADR (Nygard). Mỗi note ghi rõ nguồn và phiên bản ở phần cuối.
