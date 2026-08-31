---
level: intermediate
area: ai-engineering
prerequisites:
  - 00-ai-vocabulary.md
  - 01-llm-request-lifecycle.md
related:
  - ../02-chatbot-web/01-chatbot-architecture.md
  - ../../06-system-design/README.md
---

# AI application architecture

> Một team dựng chatbot RAG trong hai tuần và demo rất tốt. Sáu tuần sau, không ai dám sửa nó. Toàn bộ logic — build prompt, gọi vector search, gọi model, parse output, ghi DB — nằm trong một controller 700 dòng. Không có chỗ nào để thêm evaluation, không có chỗ nào để đổi model, không có chỗ nào để đo retrieval riêng khỏi generation. Vấn đề không phải AI. Vấn đề là **không có ranh giới nào**.

## Position

```text
Đây là bản đồ của toàn bộ track 10-ai-engineering.
Mọi note khác đào sâu một khối trong sơ đồ dưới đây.
```

## Problem

AI feature dễ prototype và khó vận hành hơn hầu hết feature khác, vì nó có **bốn tính chất mà code truyền thống không có**:

```text
① Output không xác định        → không test được bằng so khớp
② Chi phí theo từng request    → một vòng lặp sai = hoá đơn thật
③ Chất lượng không nhị phân    → "hoạt động" không còn là câu trả lời đủ
④ Output là dữ liệu KHÔNG TIN  → là bề mặt tấn công mới
```

Bốn tính chất đó không được giải quyết bằng thư viện. Chúng được giải quyết bằng **kiến trúc**: đặt mỗi thứ vào chỗ có thể quan sát, thay thế và kiểm chứng độc lập.

## Mental Model

### Kiến trúc đầy đủ của một AI feature

```text
                          Browser
                             │  optimistic UI · streaming render · cancel
                             ▼
                      Next.js / React                  ← 02-chatbot-web/04
                             │  SSE / fetch stream
                             ▼
┌────────────────────── Application API (NestJS) ─────────────────────────┐
│                                                                         │
│  Auth ──▶ Rate limit ──▶ Validate input                                 │
│     │        (Redis)         (DTO)                                      │
│     ▼                                                                   │
│  Conversation service          ← lịch sử ĐÃ LƯU                         │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─ CONTEXT BUILDER ──────────────────────────────┐  ← 01-context/02    │
│  │   system prompt (phiên bản hoá)                │                     │
│  │   + memory / user facts        ← 02-chatbot/07 │                     │
│  │   + retrieved docs             ← 03-rag/       │                     │
│  │   + history đã cắt/tóm tắt     ← 02-chatbot/06 │                     │
│  │   + tool schemas               ← 04-agents/01  │                     │
│  │   ─── tất cả nằm trong TOKEN BUDGET ───        │                     │
│  └────────────────────────────────────────────────┘                     │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─ MODEL ADAPTER ────────────────────────────────┐  ← 01-context/04    │
│  │   normalize request  ·  normalize response     │                     │
│  │   finish reason  ·  usage  ·  lỗi  ·  fallback │                     │
│  └────────────────────────────────────────────────┘                     │
│     │                          ▲                                        │
│     ▼                          │ tool_result                            │
│  Provider ──▶ tool call? ──▶ TOOL EXECUTOR       ← 04-agents/01,02      │
│                              (authz + validate + audit)                 │
│     │                                                                   │
│     ▼                                                                   │
│  Validate output (schema)      ← 01-context/03                          │
│     │                                                                   │
│     ▼                                                                   │
│  Stream events ──▶ Persist ──▶ Emit trace + cost   ← 07-production/01   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
        │              │            │            │             │
        ▼              ▼            ▼            ▼             ▼
   PostgreSQL       Redis      Vector search    Queue      Observability
   conversation   cache/rate    embeddings    ingestion    trace/metric
   message        limit/lock    chunks        embedding    cost/eval
   eval result    idem key      metadata      batch job
```

Đọc sơ đồ theo một câu: **AI feature không phải "gọi API model" — nó là một pipeline có 6 trạm bạn sở hữu, và model chỉ là một trong số đó.**

### Sáu trạm bạn sở hữu

| Trạm | Trách nhiệm | Nếu thiếu |
|---|---|---|
| **Context builder** | quyết định *cái gì* vào cửa sổ, trong *budget* nào | `400 context too large`, chi phí không kiểm soát |
| **Model adapter** | biến API provider thành hình dạng của app bạn | đổi model = sửa 40 file |
| **Tool executor** | thực thi hành động model *xin*, sau khi kiểm quyền | model gọi được hàm xoá dữ liệu |
| **Output validator** | biến text thành DTO đã kiểm | raw output đi vào business logic |
| **Persistence** | lưu message, usage, trace | không debug được, không tính được tiền |
| **Evaluation** | biết feature tốt hay tệ | "tôi thử thấy ổn" |

Trạm cuối là trạm bị bỏ nhiều nhất và tốn nhất về sau. Xem [05-evaluation/](../05-evaluation/README.md).

### Ba ranh giới không được nhập nhằng

Ba ranh giới này là điều làm code AI đọc được sau sáu tháng:

**① Lịch sử đã lưu ≠ context gửi cho model**

```text
conversation_message (PostgreSQL)     ← nguồn sự thật, đầy đủ, không mất
        │  select / truncate / summarize
        ▼
messages[] gửi đi                     ← phái sinh, vừa budget, có thể tính lại
```

Nhập hai cái này lại là lý do người ta không thể đổi chiến lược cắt context mà không mất dữ liệu. Xem [05-conversation-storage.md](../02-chatbot-web/05-conversation-storage.md).

**② DTO của provider ≠ DTO của application ≠ DTO của frontend**

```text
provider response  →  application result  →  stream event cho FE
(đổi khi provider     (contract nội bộ       (contract công khai,
 đổi SDK)              của bạn)               phải version)
```

Xem [04-provider-adapter-and-dto.md](../01-context-and-output/04-provider-adapter-and-dto.md).

**③ Model *đề xuất* hành động ≠ application *thực thi* hành động**

```text
Model:        "tôi muốn gọi cancelOrder({ orderId: '123' })"
Application:  user này có quyền huỷ đơn 123 không?
              đơn 123 có thuộc user này không?
              đơn đã giao chưa?
              hành động này cần xác nhận không?
              → RỒI mới chạy, và ghi audit log
```

Đây là ranh giới quan trọng nhất trong toàn track về mặt an toàn. Xem [02-tool-security.md](../04-agents-tools/02-tool-security.md).

### AI feature dùng lại gần hết repo này

Đây là điểm mà track này muốn bạn thấy rõ nhất: **AI engineering không phải một hòn đảo.** Nó là một feature full-stack, và nó gọi lại gần như mọi thứ repo đã dạy:

| Bạn cần | Đã có ở | Dùng cho |
|---|---|---|
| HTTP semantics, status code, error model | [00-http-api/](../../02-backend-api/00-http-api/README.md) | AI endpoint là HTTP endpoint bình thường |
| SSE / streaming | [08-websocket-sse.md](../../01-web-frontend/00-web-foundations/08-websocket-sse.md) | token streaming |
| Timeout, retry, backoff, circuit breaker | [reliability/](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) | provider chậm, `429`, `5xx` |
| Redis | [02-redis/](../../03-database/02-redis/README.md) | prompt cache, rate limit, distributed lock cho agent |
| Message queue + outbox | [04-message-queues/](../../03-database/04-message-queues/README.md) | ingestion, embedding, batch eval |
| PostgreSQL + transaction | [01-postgresql/](../../03-database/01-postgresql/README.md) | conversation, message, eval result |
| Prisma, N+1, migration | [05-data-access/](../../03-database/05-data-access/README.md) | truy vấn conversation không N+1 |
| Injection, XSS, SSRF, authz | [security/](../../05-cross-cutting/security/README.md) | output của model là input không đáng tin |
| Log, metric, trace, correlation ID | [observability/](../../05-cross-cutting/observability/README.md) | AI trace là span, không phải khái niệm mới |
| React state, server state | [02-react/](../../01-web-frontend/02-react/README.md) | streaming UI state |
| Stateless, nhiều instance | [05-platforms/](../../04-infrastructure/05-platforms/README.md) | agent state không nằm trong RAM |

Nếu bạn thấy mình định viết một "AI retry framework", hãy đọc lại dòng thứ ba của bảng: **bạn đã có nó.**

### Cái gì thật sự MỚI

Chỉ có sáu thứ trong track này không quy về kiến thức có sẵn:

```text
① Token budget          — ràng buộc kích thước cứng ở mỗi request
② Output không tin cậy   — theo nghĩa cả bảo mật lẫn cấu trúc
③ Không xác định         — nên "test" trở thành "evaluate"
④ Chi phí biến đổi       — mỗi request có giá riêng, phụ thuộc dữ liệu
⑤ Retrieval là một tầng  — chất lượng câu trả lời phụ thuộc nó trước cả model
⑥ Model tự đề xuất hành động — nên authz phải ở tầng thực thi
```

Sáu thứ đó là nội dung thật của track. Phần còn lại là web engineering bạn đã biết.

## Example

Hình dạng module tối thiểu, theo đúng cách repo này dạy về [service decomposition](../../02-backend-api/04-architecture/08-service-decomposition.md):

```text
src/ai/
├── context/
│   ├── context-builder.service.ts     chọn + xếp + cắt trong budget
│   └── token-counter.service.ts       đếm bằng tokenizer của provider
├── provider/
│   ├── model-provider.interface.ts    contract của BẠN
│   ├── anthropic.adapter.ts           một implementation
│   └── finish-reason.mapper.ts        normalize
├── tools/
│   ├── tool-registry.ts               allowlist + schema
│   └── tool-executor.service.ts       authz + validate + audit + timeout
├── retrieval/
│   ├── embedding.service.ts
│   └── retriever.service.ts           trả về chunk + metadata + score
├── conversation/
│   ├── conversation.service.ts        lưu / đọc lịch sử
│   └── message.repository.ts
├── chat/
│   ├── chat.controller.ts             HTTP + SSE, mỏng
│   └── chat.orchestrator.ts           điều phối các trạm trên
└── eval/
    ├── golden-dataset/
    └── evaluator.service.ts
```

Điểm quan trọng: `chat.controller.ts` **mỏng**. Nếu controller của bạn biết về vector search, prompt và parse JSON, bạn đang ở tình huống đầu note.

Và `model-provider.interface.ts` là contract của **bạn**, không phải của provider:

```ts
export interface ModelProvider {
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  countTokens(messages: Message[]): Promise<number>;
}
```

## Prediction

1. Bạn muốn thêm evaluation cho tính năng RAG. Nếu retrieval và generation nằm trong cùng một hàm, bạn đo được cái gì?
2. Provider tăng giá model đang dùng gấp đôi. Với kiến trúc ở đầu note (controller 700 dòng), bạn phải sửa bao nhiêu chỗ?
3. Câu trả lời sai. Làm sao biết là retrieval lấy sai tài liệu, hay model đọc đúng tài liệu mà suy luận sai?
4. Agent của bạn chạy trên 3 instance. State của vòng lặp agent nằm trong RAM. Chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **Chỉ đo được kết quả cuối** — "câu trả lời đúng hay sai". Không tách được nguyên nhân. Đó là lý do trạm retrieval phải trả về **chunk + score + metadata** như một giá trị quan sát được, không phải biến cục bộ. Xem [02-rag-and-agent-evaluation.md](../05-evaluation/02-rag-and-agent-evaluation.md).
2. Không sửa được an toàn — không có chỗ nào đại diện cho "model đang dùng". Với model adapter + config, đó là **một dòng config** cộng một lần chạy eval để kiểm chất lượng.
3. Chỉ trả lời được nếu bạn **log lại chunk đã retrieve cùng request**. Nếu retrieval không được ghi, câu hỏi này không có câu trả lời — bạn chỉ còn cách đoán.
4. Request tiếp theo có thể rơi vào instance khác và **mất state vòng lặp**. Đúng cùng lỗi như session in-memory ở [01-where-to-run.md](../../04-infrastructure/05-platforms/01-where-to-run.md) — không phải vấn đề mới của AI.

</details>

## Trade-offs

| Quyết định | Khi nào đúng | Khi nào là overengineering |
|---|---|---|
| Model adapter interface | ≥ 2 model, hoặc cần fallback, hoặc cần eval nhiều model | một model, một route, prototype tuần đầu |
| Tách context builder thành service | context có ≥ 3 nguồn (history + RAG + memory) | chỉ có system prompt + 1 câu hỏi |
| Tool registry + executor | có bất kỳ tool nào có side effect | không dùng tool |
| Golden dataset + eval pipeline | feature đã có người dùng thật | demo nội bộ một lần |
| Semantic cache | traffic lặp lại cao và đã đo được | trước khi đo hit ratio |
| Multi-provider ngay từ đầu | có yêu cầu hợp đồng/compliance rõ | gần như luôn là quá sớm |

Nguyên tắc chung, giống mọi chỗ khác trong repo này: **tách khi bạn đã cảm nhận được đau, không tách vì sơ đồ trông đẹp.** Cái duy nhất nên làm sớm bất kể quy mô là **log `usage` + `finishReason` + retrieval sources** — vì thiếu chúng thì bạn không biết mình đang đau ở đâu.

## Explain Without Notes

1. AI feature là pipeline 6 trạm bạn sở hữu; model là một trạm.
2. Ba ranh giới không được nhập: lưu vs gửi · DTO provider vs app vs FE · model đề xuất vs app thực thi.
3. Sáu thứ thật sự mới: token budget, output không tin cậy, không xác định, chi phí biến đổi, retrieval là một tầng, model đề xuất hành động.
4. Phần còn lại là web engineering đã có trong repo — đừng viết lại.

## Related

- [Từ vựng AI](./00-ai-vocabulary.md)
- [LLM request lifecycle](./01-llm-request-lifecycle.md) — chín trạm bên trong khối "Provider"
- [Chatbot architecture](../02-chatbot-web/01-chatbot-architecture.md) — sơ đồ này dưới dạng một feature cụ thể
- [Context engineering](../01-context-and-output/02-context-engineering.md) — trạm context builder
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — trạm adapter
- [Tool security](../04-agents-tools/02-tool-security.md) — ranh giới ③
- [Evaluation](../05-evaluation/01-evaluating-ai-features.md) — trạm bị bỏ nhiều nhất
- [AI observability](../07-production/01-ai-observability.md)
- [Service decomposition](../../02-backend-api/04-architecture/08-service-decomposition.md) — tách service đúng lý do
- [System design](../../06-system-design/README.md)
- [AI scenarios](../08-scenarios/01-ai-scenarios.md) — luyện chẩn đoán trên sơ đồ này
