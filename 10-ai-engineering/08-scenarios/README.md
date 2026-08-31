---
level: intermediate
area: ai-engineering
---

# AI Scenarios

Năm tình huống thật, để luyện **chẩn đoán** thay vì đọc.

```text
Đọc phân tích mà không dự đoán trước cho cảm giác hiểu
nhưng không tạo ra khả năng chẩn đoán lần sau.
```

Mỗi scenario có phần *Câu hỏi* trước phần *Phân tích*. **Viết câu trả lời ra giấy trước khi mở phân tích.** Đó là bước duy nhất tạo ra học tập thật — xem [Learning System](../../00-roadmap/00-learning-system.md).

## Nội dung

| Scenario | Tình huống | Kỹ năng luyện |
|---|---|---|
| **A** | Chatbot cơ bản, 2 ngày tới demo | state ở đâu · idempotency · abort · lỗi chỉ có ở production |
| **B** | Chatbot + RAG multi-tenant, có citation | filter trong query · `found:false` · tách retrieval/generation · injection qua tài liệu |
| **C** | "Huỷ đơn #123 giúp tôi" | authz trên object · tham số nào KHÔNG từ model · quy tắc ở code · audit |
| **D** | TTFT = 8 giây, người dùng bỏ đi | tách `pre_model_ms` vs `provider_ttft` · song song hoá · tối ưu đúng con số |
| **E** | Hội thoại 400 lượt, chỉ một user lỗi | tăng trưởng bình phương · p99 vs trung bình · bốn chiến lược cắt |

→ [01-ai-scenarios.md](./01-ai-scenarios.md)

## Nên đọc khi nào

```text
SAU khi đọc 00-fundamentals và 02-chatbot-web  → làm được A, D, E
SAU 03-rag                                      → làm được B
SAU 04-agents-tools                             → làm được C
```

Không cần đọc hết track. Làm scenario tương ứng với vùng bạn vừa học sẽ hiệu quả hơn làm cả năm cái một lúc.

## Bốn câu tự kiểm sau khi xong

```text
① Câu trả lời RAG sai — kiểm theo thứ tự nào để tách sáu tầng?
② "Chatbot chậm" — hai con số nào tách trước tiên?
③ Tool có side effect — bảy lớp bảo vệ ở tầng thực thi là gì?
④ Ba trường log nào mà thiếu chúng thì không debug được?
```

Câu ④ có đáp án ngắn: **`finishReason` · `retrieved_doc_ids` · `usage`** (kèm `cachedInputTokens`), cộng `promptVersion` và `model`.

## Related

- [01-ai-scenarios.md](./01-ai-scenarios.md) — năm scenario
- [Scenario walkthroughs (web/backend)](../../05-cross-cutting/scenarios/01-scenario-walkthroughs.md) — 5 scenario không AI, cùng phương pháp
- [AI application architecture](../00-fundamentals/02-ai-application-architecture.md) — sơ đồ chung
- [RAG failure modes](../03-rag/04-rag-failure-modes.md) — cây quyết định của Scenario B
- [Learning system](../../00-roadmap/00-learning-system.md) — vì sao phải dự đoán trước
- [Behavior index](../../00-roadmap/behavior-index.md) — tra theo triệu chứng
