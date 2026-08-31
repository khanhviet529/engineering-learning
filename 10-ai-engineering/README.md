---
level: intermediate
area: ai-engineering
---

# AI Engineering

Xây dựng, tích hợp, đánh giá và vận hành **AI/LLM bên trong một application thật**.

```text
09-ai-assisted-development   Developer dùng AI để LÀM VIỆC như thế nào?
10-ai-engineering (đây)      Engineer xây SẢN PHẨM CÓ AI BÊN TRONG như thế nào?
```

Hai track không trùng nhau. Nếu bạn muốn dùng AI để viết code tốt hơn, vào [09-ai-assisted-development/](../09-ai-assisted-development/README.md). Nếu bạn muốn build chatbot, RAG, agent — ở đây.

## Track này dành cho ai

Developer **đã biết web/backend cơ bản** và muốn build AI feature:

```text
Cần trước:  HTTP · API design · React · một backend framework
            PostgreSQL · Redis cơ bản · Docker cơ bản
Không cần:  toán deep learning · kinh nghiệm ML · GPU
```

Nếu bạn thiếu phần nền, đọc [README gốc](../README.md) trước — đặc biệt [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) và [WebSocket & SSE](../01-web-frontend/00-web-foundations/08-websocket-sse.md).

## Track này KHÔNG phải

```text
✗ Khoá Machine Learning     không có backpropagation, không train model từ đầu
✗ Khoá toán                  không có đại số tuyến tính
✗ Bộ sưu tập prompt trick    prompt ở đây là INPUT CONTRACT, không phải câu thần chú
✗ Sách hướng dẫn SDK         provider chỉ là ví dụ; pattern mới là nội dung
✗ Tutorial vector database   RAG ở đây là pipeline có failure mode, không phải demo
✗ Quảng cáo agent            agent = model + vòng lặp + tool + state + policy
```

## Vào đây từ đâu

```text
Chưa chắc token / context window / prompt là gì?
        └──▶ 00-fundamentals/00-ai-vocabulary.md      ← từ vựng, ~12 phút

Muốn thấy bức tranh tổng thể trước?
        └──▶ 00-fundamentals/02-ai-application-architecture.md

Cần build chatbot tuần này?
        └──▶ 02-chatbot-web/                          ← full-stack, 7 note

Đang có AI feature chạy rồi và nó có vấn đề?
        └──▶ 08-scenarios/01-ai-scenarios.md          ← tự chẩn đoán
```

## Thứ tự học

| # | Vùng | Trả lời câu hỏi |
|---|---|---|
| 1 | [00-fundamentals/](./00-fundamentals/README.md) | Application đang gọi cái gì? Request đi qua đâu? Hỏng ở đâu? |
| 2 | [01-context-and-output/](./01-context-and-output/README.md) | Đưa gì vào, và làm sao đưa output vào code an toàn? |
| 3 | [02-chatbot-web/](./02-chatbot-web/README.md) | Chatbot từ browser tới model đi qua những tầng nào? |
| 4 | [03-rag/](./03-rag/README.md) | Làm sao model trả lời về dữ liệu của bạn? |
| 5 | [04-agents-tools/](./04-agents-tools/README.md) | Làm sao AI *hành động*, và làm sao nó không làm việc nguy hiểm? |
| 6 | [05-evaluation/](./05-evaluation/README.md) | Làm sao biết feature tốt hay tệ? |
| 7 | [06-safety/](./06-safety/README.md) | Prompt injection, và vì sao output là dữ liệu không đáng tin |
| 8 | [07-production/](./07-production/README.md) | Observability, chi phí, latency, lỗi, release |
| 9 | [08-scenarios/](./08-scenarios/README.md) | Luyện chẩn đoán trên 5 tình huống thật |

Nếu bạn chỉ đọc được ba note: [00-ai-vocabulary](./00-fundamentals/00-ai-vocabulary.md) → [01-llm-request-lifecycle](./00-fundamentals/01-llm-request-lifecycle.md) → [03-structured-output](./01-context-and-output/03-structured-output.md). Ba note đó chặn được phần lớn sự cố tích hợp.

## Sáu thứ thật sự mới

Phần lớn track này là web engineering bạn đã biết, áp dụng vào một pipeline mới. Chỉ có sáu thứ không quy về kiến thức có sẵn:

```text
① TOKEN BUDGET           ràng buộc kích thước cứng ở MỖI request
② OUTPUT KHÔNG ĐÁNG TIN   về cả cấu trúc lẫn bảo mật
③ KHÔNG XÁC ĐỊNH         nên "test" trở thành "evaluate"
④ CHI PHÍ BIẾN ĐỔI        mỗi request có giá riêng, phụ thuộc dữ liệu
⑤ RETRIEVAL LÀ MỘT TẦNG   chất lượng câu trả lời phụ thuộc nó TRƯỚC cả model
⑥ MODEL TỰ ĐỀ XUẤT HÀNH ĐỘNG  nên authz phải ở tầng thực thi
```

Nếu bạn thấy mình định viết "AI retry framework" hoặc "AI logging library" — hãy đọc lại danh sách trên. Retry, log, trace, cache, queue **đã có trong repo này**.

## Mười hiểu nhầm đắt nhất

1. **"LLM là database."** Nó không tra cứu; nó sinh token có khả năng cao. Muốn nó nói đúng về dữ liệu của bạn → [RAG](./03-rag/README.md).
2. **"context window = bộ nhớ."** Nó là kích thước tối đa của **một** lần gọi. → [00-ai-vocabulary](./00-fundamentals/00-ai-vocabulary.md)
3. **"`temperature: 0` là xác định."** Giảm biến thiên rất nhiều, không loại bỏ. → như trên
4. **"Model chạy tool."** Model **xin**; application **thực thi**. → [tool calling](./04-agents-tools/01-tool-calling.md)
5. **"Prompt là bảo mật."** Prompt là đề nghị. Ranh giới ở tầng thực thi. → [prompt injection](./06-safety/01-prompt-injection.md)
6. **"Tài liệu trong vector DB thì đáng tin."** Nó vào đó qua upload. → như trên
7. **"Cửa sổ 1M nên nhồi hết vào."** Đắt hơn, chậm hơn, và có thể **kém chính xác hơn**. → [context engineering](./01-context-and-output/02-context-engineering.md)
8. **"Chatbot cần WebSocket."** SSE trên POST đủ cho token streaming một chiều. → [streaming](./02-chatbot-web/03-streaming.md)
9. **"Fine-tuning dạy model biết dữ liệu của tôi."** Nó dạy *cách nói*, không dạy *biết gì*. → [RAG vs fine-tuning](./03-rag/05-rag-vs-fine-tuning.md)
10. **"Tôi thử thấy ổn."** Không phải phép đo. → [evaluation](./05-evaluation/01-evaluating-ai-features.md)

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| `Unexpected end of JSON input` rải rác | `finishReason = max_tokens`, không phải lỗi parser → [lifecycle](./00-fundamentals/01-llm-request-lifecycle.md) |
| `400 context too large` chỉ với một số user | history không có trần → [context window](./02-chatbot-web/06-context-window-management.md) |
| Hoá đơn tăng nhiều lần, không ai deploy | prompt cache bị phá; hoặc history phình → [cost](./07-production/02-cost-and-model-routing.md) |
| Chatbot chậm, tối ưu không cải thiện | tối ưu `total` thay vì `TTFT` → [latency](./07-production/04-latency-engineering.md) |
| Stream không hiện dần ở production | proxy buffer → [streaming](./02-chatbot-web/03-streaming.md) |
| F5 mất hội thoại | state chỉ ở React → [chat UX](./02-chatbot-web/04-chat-ux-and-state.md) |
| Hai câu trả lời cho một tin nhắn | thiếu idempotency → [chatbot architecture](./02-chatbot-web/01-chatbot-architecture.md) |
| RAG trả lời sai một chi tiết | chunk mất ngữ cảnh → [RAG failure modes](./03-rag/04-rag-failure-modes.md) |
| Model bịa khi không có dữ liệu | thiếu đường ra `found: false` → [RAG pipeline](./03-rag/03-rag-pipeline.md) |
| Không tìm được mã / ID | vector yếu với định danh → cần hybrid → [vector search](./03-rag/02-vector-search.md) |
| Agent tốn tiền khổng lồ, không có lỗi | thiếu phát hiện không tiến triển → [agent loop](./04-agents-tools/03-agent-loop.md) |
| Người dùng đọc được dữ liệu người khác | authz kiểm action không kiểm object → [tool security](./04-agents-tools/02-tool-security.md) |
| Không biết prompt mới tốt hơn không | không có baseline → [evaluation](./05-evaluation/01-evaluating-ai-features.md) |
| Hành vi đổi mà không ai deploy | provider cập nhật model → [versioning](./07-production/06-versioning-and-release.md) |
| XSS trong câu trả lời chatbot | markdown cho phép HTML thô → [untrusted output](./06-safety/02-untrusted-model-output.md) |

## Position trong xương sống

```text
Browser  ──▶  React/Next.js  ──▶  HTTP  ──▶  NestJS
                                              │
                              ┌───────────────┴──────────────┐
                              │  AI pipeline (track này)     │
                              │  context · model · tool      │
                              │  retrieval · validate · eval │
                              └───────────────┬──────────────┘
                                              │
                    Cache/Queue  ──▶  PostgreSQL + Vector  ──▶  OS/Container
```

AI feature **không phải một hòn đảo**. Nó gọi lại gần như mọi thứ repo này đã dạy — xem bảng đối chiếu đầy đủ trong [02-ai-application-architecture.md](./00-fundamentals/02-ai-application-architecture.md).

## Về provider và phiên bản

Track này **provider-neutral có chủ đích**:

```text
✓ Pattern, trade-off, failure mode      → nội dung chính, không đổi theo vendor
✓ Provider cụ thể                        → chỉ dùng làm ví dụ
✗ Danh sách method của một SDK           → không có; tra tài liệu provider
✗ Giá cụ thể, tên model cụ thể            → thay đổi liên tục; con số trong note
                                            chỉ để thấy TỈ LỆ (output ≈ 5× input)
```

Khi cần chi tiết một provider: đọc tài liệu chính thức của họ. Cái track này dạy là **những câu hỏi cần hỏi**, không phải tên tham số.

## Related

- [09-ai-assisted-development/](../09-ai-assisted-development/README.md) — dùng AI để **làm việc** (track khác)
- [AI-Assisted Learning](../00-roadmap/03-ai-assisted-learning.md) — dùng AI để **học**
- [00-http-api/](../02-backend-api/00-http-api/README.md) — nền của mọi AI endpoint
- [WebSocket & SSE](../01-web-frontend/00-web-foundations/08-websocket-sse.md) — nền của streaming
- [reliability/](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — timeout, retry, breaker
- [security/](../05-cross-cutting/security/README.md) — injection, XSS, SSRF, authz
- [observability/](../05-cross-cutting/observability/README.md) — log, metric, trace
- [02-redis/](../03-database/02-redis/README.md) — cache, rate limit, lock
- [04-message-queues/](../03-database/04-message-queues/README.md) — ingestion, batch, agent run
- [01-postgresql/](../03-database/01-postgresql/README.md) — conversation, message, vector
- [06-system-design/](../06-system-design/README.md)
- [AI engineering coverage report](../00-roadmap/ai-engineering-coverage-report.md) — track này có gì, cố tình thiếu gì
