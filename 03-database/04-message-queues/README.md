---
level: advanced
area: database
---

# Message queues

Queue là **cơ sở hạ tầng có trạng thái**, cùng họ với database và Redis — đó là lý do folder này nằm ở `03-database/` chứ không ở backend.

Ba câu hỏi mà folder này trả lời:

```text
① Việc này có cần làm ngay không?              → có nên dùng queue không
② Tin nhắn có thể mất hoặc lặp không?          → delivery semantics
③ Ghi database và gửi sự kiện có nguyên tử không?  → outbox
```

Câu ③ là câu bị bỏ qua nhiều nhất, và nó là nguyên nhân của lớp bug đắt nhất: **đơn hàng tồn tại nhưng không hệ thống nào biết**.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Vì sao cần queue](01-why-queue.md) | Vì sao một dependency chậm làm chết cả service? |
| 2 | [Delivery semantics](02-delivery-semantics.md) | Vì sao "exactly-once" không tồn tại? |
| 3 | [Retry & DLQ](03-retry-dlq.md) | Vì sao retry làm sự cố tệ hơn? |
| 4 | [Ordering & partitioning](04-ordering-partitioning.md) | Vì sao email cũ ghi đè email mới? |
| 5 | [Broker comparison](05-broker-comparison.md) | PostgreSQL, BullMQ, RabbitMQ, SQS hay Kafka? |
| 6 | [Outbox pattern](06-outbox-pattern.md) | Vì sao đơn hàng tồn tại mà không ai biết? |

Note 2 là nền của 3, 4 và 6 — đừng nhảy cóc.

## Bốn quy tắc

```text
① MỌI hệ thống queue thực tế là AT-LEAST-ONCE.
   Consumer PHẢI idempotent. Không có ngoại lệ.

② Ghi DB và publish sự kiện KHÔNG nguyên tử.
   Cần outbox — trừ khi queue nằm chính trong database.

③ Retry không backoff + jitter là một cuộc tấn công bạn tự thực hiện.

④ Tuổi job cũ nhất quan trọng hơn độ dài hàng đợi.
   Hàng đợi 200 với job cũ 2 giờ = worker đã chết.
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Endpoint chậm làm mọi endpoint chậm | việc nặng chưa đưa vào queue → [1](01-why-queue.md) |
| Job không chạy | sai tên queue, worker chết, không kết nối broker → [1](01-why-queue.md) |
| Hàng đợi dài dần không giảm | vào > ra; backpressure → [1](01-why-queue.md) |
| Hàng đợi ngắn nhưng job cũ 2 giờ | worker chết → [1](01-why-queue.md) |
| Email gửi hai lần, tiền trừ hai lần | job không idempotent → [2](02-delivery-semantics.md) |
| Job chạy lại dù `attemptsMade = 1` | visibility timeout hết giữa chừng → [2](02-delivery-semantics.md) |
| Job CPU-nặng bị chạy trùng | event loop bị chặn → mất lock → [2](02-delivery-semantics.md) |
| Sự cố downstream kéo dài bất thường | retry storm → [3](03-retry-dlq.md) |
| Lỗi vĩnh viễn retry 5 lần | thiếu phân loại lỗi → [3](03-retry-dlq.md) |
| Job chết im lặng | không có DLQ hoặc không có alert → [3](03-retry-dlq.md) |
| Partition đứng, job sau không chạy | poison message → [3](03-retry-dlq.md) · [4](04-ordering-partitioning.md) |
| Giá trị cũ ghi đè giá trị mới | thứ tự sai → [4](04-ordering-partitioning.md) |
| Thêm consumer không nhanh hơn | số consumer > số partition, hoặc hot partition → [4](04-ordering-partitioning.md) |
| Job bị evict khỏi Redis | queue dùng chung Redis với cache → [5](05-broker-comparison.md) |
| Cần phát lại lịch sử nhưng không được | dùng queue thay vì log → [5](05-broker-comparison.md) |
| Đơn hàng tồn tại, không sự kiện nào | dual-write, thiếu outbox → [6](06-outbox-pattern.md) |
| Job xử lý một bản ghi không tồn tại | enqueue trong transaction rồi rollback → [6](06-outbox-pattern.md) |

## Kiến trúc tham chiếu

Kiến trúc đầy đủ cho việc quan trọng, và mỗi thành phần đóng một khe hở:

```text
POST /orders
  │
  └─ TRANSACTION
       ├─ INSERT orders
       └─ INSERT outbox            ◀── nguyên tử: không mất, không sự kiện ma
     COMMIT
  │
  └─ Outbox publisher (advisory lock, ORDER BY id, SKIP LOCKED)
       └─ broker.publish(messageId = outbox.id)   ◀── at-least-once
  │
  └─ Consumer
       ├─ INSERT processed_messages(messageId)    ◀── inbox: khử trùng
       ├─ xử lý  (CÙNG transaction)
       └─ phân loại lỗi → retry có backoff+jitter → DLQ + alert
```

Nó dài hơn `await queue.add(...)` trong controller, và đó là khác biệt giữa "thỉnh thoảng mất một đơn hàng" và "không bao giờ".

**Ngoại lệ đáng nhớ:** nếu queue nằm chính trong PostgreSQL (`SKIP LOCKED`), bạn đã có outbox — job và dữ liệu cùng một transaction. Đó là một lý do mạnh để cân nhắc PostgreSQL trước khi thêm broker.

## Sáu metric

```text
① độ dài hàng đợi
② TUỔI JOB CŨ NHẤT           ← quan trọng nhất; phát hiện worker chết
③ tỉ lệ thất bại
④ thời gian xử lý p95
⑤ kích thước DLQ + tuổi job cũ nhất trong DLQ
⑥ tuổi dòng outbox chưa gửi cũ nhất   ← phát hiện publisher chết
```

Alert trên ②, ⑤ và ⑥. Không có chúng, hệ thống hỏng im lặng.

## Position

```text
API ──▶ [đồng bộ: việc người dùng cần] ──▶ response
    └──▶ QUEUE ──▶ Worker ──▶ DB / API ngoài / email
         ↑ folder này
```

## Related

- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — implementation
- [02-redis/](../02-redis/README.md) — BullMQ chạy trên Redis; Streams; eviction
- [01-postgresql/](../01-postgresql/README.md) — `SKIP LOCKED`, advisory lock, transaction
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — đóng worker đúng cách
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Event-driven](../../06-system-design/07-event-driven.md) — kiến trúc hướng sự kiện
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — nguyên lý ở tầng hệ thống
- [Backpressure](../../05-cross-cutting/performance/06-backpressure.md) — vào > ra
- [Autoscaling](../../04-infrastructure/04-kubernetes/09-autoscaling.md) — scale worker theo hàng đợi

## Version / Context

Ví dụ dùng BullMQ 5 (Redis 7) và PostgreSQL 16. Khái niệm áp dụng cho SQS, RabbitMQ 3.13, Kafka 3.x với tên gọi khác nhau — mỗi note ghi rõ khác biệt ở phần cuối.
