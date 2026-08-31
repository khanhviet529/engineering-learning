---
level: intermediate
area: ai-engineering
---

# Chatbot & Web Integration

Chatbot như một **feature full-stack**, không như một lời gọi API.

Đây là folder lớn nhất và thực chiến nhất của track. Ý chính của cả folder gói trong một câu:

> Một tin nhắn chat đi qua **15 trạm**. Chỉ **một** trạm là "gọi AI". Mười bốn trạm còn lại là web engineering bạn đã biết — và chúng là nơi chatbot thực sự hỏng.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Chatbot architecture](./01-chatbot-architecture.md) | 15 trạm từ browser tới model và về; bốn quyết định định hình phần còn lại |
| 2 | [Gọi provider từ web](./02-calling-provider-from-web.md) | Có nên gọi provider từ frontend? Bảy thứ gateway phải làm |
| 3 | [Streaming](./03-streaming.md) | SSE hay WebSocket? Huỷ thế nào? Vì sao stream "biến mất" ở production? |
| 4 | [Chat UX & state](./04-chat-ux-and-state.md) | Tám trạng thái, không phải `loading: boolean` |
| 5 | [Conversation storage](./05-conversation-storage.md) | Lưu gì để debug được, tính tiền được, xoá được |
| 6 | [Context window management](./06-context-window-management.md) | Hội thoại 400 lượt thì làm gì? |
| 7 | [Memory](./07-memory.md) | Sáu thứ bị gọi là "memory"; bốn trong đó không cần cơ chế mới |

Đọc 1 → 3 → 4 nếu bạn cần chatbot chạy được tuần này. Đọc 5 → 6 trước khi có người dùng thật.

## Bốn quyết định quan trọng nhất

```text
① LƯU tin nhắn user TRƯỚC khi gọi model
   → model lỗi = tin nhắn còn đó, có nút Thử lại
   → gọi trước = người dùng mất đoạn họ vừa gõ

② SERVER TÍCH LUỸ text, không chỉ chuyển tiếp
   → đóng tab giữa stream vẫn lưu được phần đã sinh
   → bạn ĐÃ TRẢ TIỀN cho những token đó

③ IDEMPOTENCY theo clientMessageId
   → double-click = một câu trả lời, không phải hai

④ RATE LIMIT theo TOKEN, không chỉ theo request
   → 20 request × 150k token đắt hơn 2000 request ngắn
```

## Ba nơi giữ state — và ai là nguồn sự thật

```text
POSTGRESQL   nguồn sự thật. Sống qua reload, qua deploy, qua instance khác.
REDIS        ngắn hạn: rate limit, idempotency, lock. TTL rõ ràng.
BROWSER      đang stream + optimistic. Không bền. Phải hoà giải lại.
```

Giữ hội thoại trong RAM của backend là lỗi kinh điển: nó chạy trên laptop và chết ngay khi có instance thứ hai.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| F5 mất hội thoại | state chỉ ở React → [4](./04-chat-ux-and-state.md), [5](./05-conversation-storage.md) |
| Hai câu trả lời cho một tin nhắn | thiếu idempotency → [1](./01-chatbot-architecture.md) |
| Hai stream đan xen chữ | không abort stream cũ → [4](./04-chat-ux-and-state.md) |
| Tin nhắn user biến mất khi model lỗi | lưu sau khi gọi model → [1](./01-chatbot-architecture.md) |
| Đóng tab = mất câu trả lời đã tốn tiền | không tích luỹ + lưu trong `finally` → [1](./01-chatbot-architecture.md) |
| Stream không hiện dần ở production | proxy buffer, thiếu `X-Accel-Buffering: no` → [3](./03-streaming.md) |
| `JSON.parse` lỗi ngẫu nhiên ở FE | không buffer SSE theo `\n\n` → [3](./03-streaming.md) |
| Kết nối chết sau ~60–100s | thiếu heartbeat qua proxy/CDN → [3](./03-streaming.md) |
| Bị tính tiền sau khi bấm Dừng | không truyền abort xuống provider → [3](./03-streaming.md) |
| "Đã dừng" hiện như lỗi | không tách `cancelled` khỏi `error` → [4](./04-chat-ux-and-state.md) |
| Hoá đơn tăng vọt vì một user | rate limit theo request → [1](./01-chatbot-architecture.md) |
| Key AI nằm trong bundle JS | `NEXT_PUBLIC_*` được nhúng vào bundle → [2](./02-calling-provider-from-web.md) |
| `429` liên tục sau khi scale | hạn mức provider dùng chung → [2](./02-calling-provider-from-web.md) |
| Thứ tự hội thoại lộn xộn | `ORDER BY created_at` thay vì `seq` → [5](./05-conversation-storage.md) |
| `400 context too large` sau vài chục lượt | history không có trần → [6](./06-context-window-management.md) |
| Chatbot chậm dần theo độ dài hội thoại | input dài dần; hoặc tóm tắt mỗi lượt → [6](./06-context-window-management.md) |
| Trợ lý khẳng định điều sai về người dùng | fact không nguồn, không xoá được → [7](./07-memory.md) |

## Position

```text
Browser
  │  optimistic · streaming render · cancel        ← note 4
  ▼
POST /conversations/:id/messages  (SSE)             ← note 3
  │
  ▼
auth · rate limit · idempotency · LƯU              ← note 1, 2, 5
  │
  ▼
build context (history cắt/tóm tắt + memory)       ← note 6, 7
  │
  ▼
model (stream, abort được)  ──▶  tích luỹ + LƯU    ← note 1, 3
```

## Related

- [00-fundamentals/](../00-fundamentals/README.md) — lifecycle, ba tầng lỗi
- [01-context-and-output/](../01-context-and-output/README.md) — context builder, `ChatEvent`
- [03-rag/](../03-rag/README.md) — thêm tài liệu vào context
- [04-agents-tools/](../04-agents-tools/README.md) — trạm ⑪ (vòng lặp tool)
- [07-production/](../07-production/README.md) — observability, chi phí, latency
- [WebSocket & SSE](../../01-web-frontend/00-web-foundations/08-websocket-sse.md)
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md)
- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md)
- [Data fetching architecture](../../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) — server vs client state
- [Chạy ở đâu](../../04-infrastructure/05-platforms/01-where-to-run.md) — vì sao state không ở RAM
