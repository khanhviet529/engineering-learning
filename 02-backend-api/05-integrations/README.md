---
level: intermediate
area: backend
---

# Integrations

Nói chuyện với thế giới bên ngoài: email, webhook gửi ra, object storage.

Ba note này có **một điểm chung quyết định**, và nó là lý do chúng nằm cùng folder:

> **Chúng đều là dual-write.** Không có transaction nào bao được cả "ghi database" và "gửi ra ngoài".
>
> Vì vậy cả ba đều cần: **outbox**, **idempotency**, **retry có backoff**, và **job dọn trạng thái kẹt**.

Đây không phải chi tiết implementation — nó là hình dạng chung của mọi side effect ra ngoài hệ thống.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Gửi email](01-sending-email.md) | Vì sao email vào spam, và vì sao gửi email trong request là sai? |
| 2 | [Webhook gửi ra](02-outgoing-webhooks.md) | Khi bạn gửi webhook, bạn trở thành provider — nghĩa vụ gì? |
| 3 | [File storage](03-file-storage.md) | Vì sao không có transaction giữa S3 và database? |

Đọc note 1 trước — nó giới thiệu outbox và idempotency ở dạng dễ thấy nhất (email gửi hai lần thì người dùng nhận hai email, rất rõ ràng).

## Ba bài học chung

**1. Side effect ra ngoài không thuộc request.**

```text
❌ await mailer.send()  trong register()
   → provider chậm 3s → API chậm 3s
   → provider lỗi → ĐĂNG KÝ THẤT BẠI

✅ transaction { INSERT user + INSERT outbox }
   → worker gửi, retry được
```

**2. Outbox, không phải `queue.add()`.**

`queue.add()` không tham gia transaction của database. Rollback rồi vẫn gửi email/webhook về một record không tồn tại. Xem [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md).

**3. At-least-once nghĩa là phía nhận phải idempotent** — và với webhook, *bạn* phải tài liệu hoá điều đó cho khách hàng.

## Ba thứ dễ bị bỏ nhất

| Thứ | Hậu quả nếu bỏ |
|---|---|
| **Suppression list** (email) | gửi lại địa chỉ hard-bounce → reputation giảm → email của bạn vào spam cho **mọi** người |
| **Validate URL trước khi gửi** (webhook) | SSRF — khách hàng trỏ webhook vào `169.254.169.254` và server bạn đọc IAM credential cho họ |
| **Job dọn trạng thái kẹt** (cả ba) | orphan tích luỹ: file trả tiền vĩnh viễn, record `PENDING` không ai xử lý |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| API chậm khi tạo user | gửi email trong request → [1](01-sending-email.md) |
| Đăng ký thất bại vì email lỗi | side effect làm sập nghiệp vụ chính → [1](01-sending-email.md) |
| Email vào spam | thiếu SPF/DKIM/DMARC, hoặc reputation đã giảm → [1](01-sending-email.md) |
| Email gửi rồi nhưng transaction rollback | dual-write, thiếu outbox → [1](01-sending-email.md) |
| Khách hàng nói "không nhận được webhook" | thiếu delivery log có response body → [2](02-outgoing-webhooks.md) |
| Webhook retry mãi cho endpoint đã chết | thiếu auto-disable → [2](02-outgoing-webhooks.md) |
| Khách hàng xử lý event hai lần | chưa tài liệu hoá at-least-once, thiếu `id` → [2](02-outgoing-webhooks.md) |
| File mất sau khi container restart | lưu vào filesystem app → [3](03-file-storage.md) |
| File trong storage mà DB không biết | sai thứ tự ghi, thiếu job dọn → [3](03-file-storage.md) |
| Record trỏ vào file 404 | ghi DB READY trước khi upload xong → [3](03-file-storage.md) |
| CDN trả file người này cho người khác | `Cache-Control: public` cho dữ liệu riêng tư → [3](03-file-storage.md) |

## Position

```text
NestJS service
      ↓ outbox (trong transaction)
Worker → [ email provider | webhook endpoint của khách | S3/R2 ]
      ↓ retry, idempotency, job dọn
```

## Related

- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) — nền của cả ba note
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once
- [Retry & DLQ](../../03-database/04-message-queues/03-retry-dlq.md)
- [Upload & download file](../00-http-api/09-file-upload-download.md) — HTTP mechanics của upload
- [Export & reporting](../00-http-api/10-export-and-reporting.md) — file sinh ra
- [SSRF & supply chain](../../05-cross-cutting/security/05-ssrf-supply-chain.md) — rủi ro của webhook gửi ra
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Cloudflare & edge](../../04-infrastructure/05-platforms/02-cloudflare-and-edge.md) — R2
