---
level: intermediate
area: ai-engineering
---

# Production

Bốn thứ quyết định AI feature sống được ở production: **thấy được · trả được · nhanh đủ · hỏng đúng cách**.

Cộng thêm hai thứ về vận hành: release được, và biết khi nào cần người.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [AI observability](./01-ai-observability.md) | Ghi gì để debug được cái không chạy lại được? |
| 2 | [Cost & model routing](./02-cost-and-model-routing.md) | Hoá đơn tăng 30× — tìm ở đâu, giảm theo thứ tự nào? |
| 3 | [AI caching](./03-ai-caching.md) | Bốn loại cache, và vì sao key phải chứa `userId` |
| 4 | [Latency engineering](./04-latency-engineering.md) | TTFT vs total — con số nào người dùng cảm nhận? |
| 5 | [Failure handling](./05-failure-handling.md) | Mười trạng thái, không phải một thông báo lỗi |
| 6 | [Versioning & release](./06-versioning-and-release.md) | Hành vi đổi mà không ai deploy — phát hiện thế nào? |
| 7 | [Human in the loop](./07-human-in-the-loop.md) | Khi nào AI được tự động, khi nào phải có người? |

Đọc note 1 trước. Năm note sau đều cần dữ liệu mà note 1 nói cách thu thập.

## Năm ý chính

**① Với AI, bạn không debug bằng cách chạy lại.** Chạy lại cho output khác. Nên **cái bạn ghi lúc đó là cái duy nhất bạn có** — observability không phải công cụ để debug, nó là *điều kiện* để debug được.

**② Ba trường log mà thiếu chúng thì không debug được:**

```text
finishReason          → output bị cắt? bị chặn? (HTTP 200 vẫn có thể vô dụng)
retrieved_doc_ids     → tách được lỗi retrieval khỏi lỗi generation
usage + cachedInput   → chi phí, và cache có hoạt động không
```

Cộng `promptVersion` + `model` để truy được regression.

**③ Thứ tự giảm chi phí — miễn phí trước, đánh đổi sau:**

```text
① prompt cache        50–90% input token, KHÔNG đổi chất lượng   ★ làm trước
② giới hạn output     output đắt ~5× input
③ cắt input không cần history · top_k · few-shot · tool_result
④ chặn vòng lặp       retry có trần · agent stop conditions
⑤ batch               việc không gấp thường rẻ hơn đáng kể
──────────────────────────────────────────────────
⑥ model routing       ← người ta hay BẮT ĐẦU ở đây, và đó là sai thứ tự
⑦ fine-tune           chỉ ở quy mô rất lớn
```

**④ TTFT là con số người dùng cảm nhận, không phải total.**

```text
TTFT 0.6s, total 6.0s  →  cảm giác NHANH
TTFT 2.9s, total 3.9s  →  cảm giác TREO
Total của cái thứ hai TỐT HƠN.
```

**⑤ Ngưỡng tự động hoá phụ thuộc hậu quả × khả năng đảo ngược, không phụ thuộc độ chính xác.** 94% chính xác đủ tốt cho gợi ý tag, và không đủ cho hoàn tiền tự động.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| "Chatbot chậm", không biết ở đâu | một span cho cả request → [1](./01-ai-observability.md) |
| Hoá đơn tăng nhiều lần, không ai deploy | cache bị phá; history phình → [2](./02-cost-and-model-routing.md), [3](./03-ai-caching.md) |
| `cachedInputTokens` = 0 | biến động trong tiền tố prompt → [3](./03-ai-caching.md) |
| Một org chiếm 70% hoá đơn | thiếu cost cap theo org → [2](./02-cost-and-model-routing.md) |
| Người dùng nhận câu trả lời của người khác | cache key thiếu `userId` → [3](./03-ai-caching.md) |
| Tối ưu nhiều mà người dùng không thấy | tối ưu total thay vì TTFT → [4](./04-latency-engineering.md) |
| TTFT cao dù model nhanh | tiền xử lý tuần tự; input dài → [4](./04-latency-engineering.md) |
| Người dùng bấm Thử lại vô ích | không phân biệt retryable → [5](./05-failure-handling.md) |
| Toàn bộ app chậm khi provider chết | thiếu circuit breaker → [5](./05-failure-handling.md) |
| "Đã dừng" hiện như lỗi | `cancelled` không tách khỏi `error` → [5](./05-failure-handling.md) |
| Hành vi đổi mà không ai deploy | provider cập nhật model → [6](./06-versioning-and-release.md) |
| Không rollback nhanh được | model hard-code trong code → [6](./06-versioning-and-release.md) |
| Regression tích luỹ không ai thấy | baseline không cập nhật → [6](./06-versioning-and-release.md) |
| Một ca sai gây hậu quả lớn | tự động hoá theo độ chính xác trung bình → [7](./07-human-in-the-loop.md) |
| Model tự tin nhưng sai, vẫn tự động | confidence làm ngưỡng duy nhất → [7](./07-human-in-the-loop.md) |
| Số lần gọi provider gấp nhiều lần dự kiến | retry của SDK không tắt → [5](./05-failure-handling.md) |

## Ba metric chất lượng đáng có TRƯỚC cả golden dataset

Chúng phát hiện vấn đề **mà không cần người đánh giá**:

```text
rag.hallucinated_citation   > 0 là bug thật
rag.no_relevant_docs        tăng đột ngột = retrieval hoặc dữ liệu có vấn đề
llm.finishReason=max_tokens > 2% = output đang bị cắt
```

Cộng ba tín hiệu hành vi người dùng, cũng miễn phí:

```text
tỉ lệ Regenerate · tỉ lệ chuyển sang người thật · tỉ lệ từ chối hành động agent
```

## Danh sách kiểm trước khi bật cho người dùng thật

```text
□ trace có span riêng cho retrieval / model / tool
□ log finishReason · docIds · usage · promptVersion · model
□ timeout: TTFT + idle giữa chunk + tổng
□ retry: có trần, đã TẮT retry của SDK
□ rate limit theo user, VÀ theo token
□ cost cap: user / org / tổ chức (kill switch cứng)
□ prompt cache: đo cachedInputTokens > 0
□ circuit breaker cho provider
□ mọi mã lỗi có `retryable` và thông báo nói HÀNH ĐỘNG
□ model + prompt trong CONFIG (rollback bằng giây)
□ canary eval hằng ngày (30–50 ca)
□ hành động khó đảo ngược: có xác nhận người, preview do CODE sinh
```

## Position

```text
AI feature đang chạy
   │
   ├─ THẤY ĐƯỢC   trace · metric · sample        note 1
   ├─ TRẢ ĐƯỢC    cache · trần · routing          note 2, 3
   ├─ NHANH ĐỦ    TTFT · song song · streaming    note 4
   ├─ HỎNG ĐÚNG   10 trạng thái · degrade         note 5
   ├─ ĐỔI ĐƯỢC    version · canary · rollback     note 6
   └─ CÓ NGƯỜI    khi hậu quả cao                 note 7
```

## Related

- [00-fundamentals/01-llm-request-lifecycle.md](../00-fundamentals/01-llm-request-lifecycle.md) — chín trạm, mỗi trạm một span
- [02-chatbot-web/03-streaming.md](../02-chatbot-web/03-streaming.md) — đòn số một cho latency cảm nhận
- [02-chatbot-web/06-context-window-management.md](../02-chatbot-web/06-context-window-management.md) — nguồn của chi phí tăng dần
- [05-evaluation/](../05-evaluation/README.md) — eval trước rollout
- [Logs, metrics, traces](../../05-cross-cutting/observability/01-logs-metrics-traces.md)
- [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md)
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md)
- [Cache patterns (Redis)](../../03-database/02-redis/03-cache-patterns.md)
- [Latency, throughput, bottleneck](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md)
- [CI/CD](../../04-infrastructure/03-cicd/README.md)
