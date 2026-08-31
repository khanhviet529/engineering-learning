---
level: beginner
area: ai-engineering
---

# AI Fundamentals

Application của bạn **đang gọi cái gì**, và request đó đi qua đâu.

Đọc folder này trước mọi thứ khác trong track. Lý do: RAG, agent, evaluation đều dùng lại cùng một bộ từ vựng (token, context window, finish reason, usage), và mọi chế độ hỏng của chúng đều là biến thể của những chế độ hỏng ở đây.

## Vào đây từ đâu

```text
Chưa chắc token / context window / prompt là gì?
        └──▶ 00-ai-vocabulary.md        ← từ vựng, ~12 phút, không có failure mode

Đã có từ vựng, muốn biết request hỏng ở đâu?
        └──▶ 01-llm-request-lifecycle.md

Muốn thấy bức tranh tổng trước khi đi sâu?
        └──▶ 02-ai-application-architecture.md
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0 | [Từ vựng AI](./00-ai-vocabulary.md) | token, context window, prompt, role, temperature, finish reason — **là gì?** |
| 1 | [LLM request lifecycle](./01-llm-request-lifecycle.md) | Một request đi qua chín trạm nào, và hỏng ở đâu? |
| 2 | [AI application architecture](./02-ai-application-architecture.md) | Bản đồ toàn track: sáu trạm bạn sở hữu, ba ranh giới không được nhập |

Note 0 là **từ vựng** — bỏ qua nếu bạn giải thích được vì sao `temperature: 0` không hoàn toàn xác định.

## Ba điều quan trọng nhất của folder này

**① Model không nhớ gì.** Cảm giác "chatbot nhớ hội thoại" là do bạn gửi lại toàn bộ lịch sử mỗi lần. Đây là cùng tính chất `stateless` như HTTP.

**② Có ba tầng lỗi, và tầng nguy hiểm nhất trả về HTTP 200.**

```text
A  429 · 5xx · timeout          → retry được
B  400 context too large · 401  → retry VÔ ÍCH
C  HTTP 200 nhưng KHÔNG DÙNG ĐƯỢC   ← SDK không ném gì
   finishReason = max_tokens (output bị cắt) · bị chặn · JSON không parse được
```

**③ Năm thứ mọi lời gọi LLM phải có:**

```text
timeout · giới hạn output · kiểm finish reason · validate schema · log usage
```

Không thứ nào trong năm thứ đó là về AI. Chúng là kỷ luật tích hợp dịch vụ bên ngoài.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| `Unexpected end of JSON input` rải rác | `finishReason = max_tokens` → [1](./01-llm-request-lifecycle.md) |
| `400 context too large` với một số user | không có token budget → [1](./01-llm-request-lifecycle.md) |
| Request treo vô hạn | thiếu timeout → [1](./01-llm-request-lifecycle.md) |
| Hoá đơn tăng, không biết ở đâu | không log `usage` theo route → [1](./01-llm-request-lifecycle.md) |
| Model "quên" điều vừa nói | không gửi lại history, hoặc bị cắt → [0](./00-ai-vocabulary.md) |
| Test AI feature flaky | output không xác định → [0](./00-ai-vocabulary.md) |
| Code AI thành controller 700 dòng | không có ranh giới → [2](./02-ai-application-architecture.md) |

## Position

```text
Code của bạn
   │  messages · tools · maxOutputTokens
   ▼
Provider  ──▶  inference  ──▶  content + finishReason + usage
   │
   ▼
Validate · persist · trace       ← bốn trạm bạn sở hữu
```

## Related

- [01-context-and-output/](../01-context-and-output/README.md) — tiếp theo: đưa gì vào, lấy gì ra
- [02-chatbot-web/](../02-chatbot-web/README.md) — feature full-stack đầu tiên
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — stateless, DTO, status code
- [Error model](../../02-backend-api/00-http-api/05-error-model.md) — `code` + `requestId`
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Glossary](../../00-roadmap/glossary.md)
