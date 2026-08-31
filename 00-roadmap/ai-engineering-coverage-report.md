---
level: meta
area: roadmap
---

# AI Engineering Coverage Report

Báo cáo cho track mới: [`10-ai-engineering/`](../10-ai-engineering/README.md).

## Ranh giới với track có sẵn

```text
09-ai-assisted-development   Developer dùng AI để LÀM VIỆC          (5 note, đã có)
10-ai-engineering            Engineer xây SẢN PHẨM CÓ AI BÊN TRONG  (34 note, mới)
```

Kiểm tra chống trùng lặp trước khi viết. Vùng duy nhất có nguy cơ trùng là bảo mật:

| Nội dung | Ở 09 | Ở 10 | Xử lý |
|---|---|---|---|
| Prompt injection | mục "Nhóm ③ — AI trong sản phẩm" trong `05-ai-security-limits.md` — mức **nhận thức** | `06-safety/01-prompt-injection.md` — mức **thực thi**: hai dạng, bốn mục tiêu tấn công, tách phiên theo mức tin cậy, metric phát hiện | cross-link hai chiều; nói rõ ranh giới trong cả hai README |
| Output không đáng tin | nêu nguyên tắc | `06-safety/02-untrusted-model-output.md` — bảng 13 đích đến, cấu hình markdown, ba đích luôn "không" | như trên |
| Context window | định nghĩa ngắn (tôi thêm phiên trước) | `00-fundamentals/00-ai-vocabulary.md` — định nghĩa đầy đủ | **chuyển canonical owner sang 10**; 09 thêm dòng trỏ tới, glossary cập nhật |

Không có nội dung nào bị viết hai lần.

## Existing AI content reused

Track này **không** viết lại thứ repo đã có. Bảng đối chiếu (dùng làm mục lục cross-link):

| Cần | Dùng lại từ | Cho việc gì |
|---|---|---|
| HTTP semantics, status code, error model | [00-http-api/](../02-backend-api/00-http-api/README.md) | AI endpoint là HTTP endpoint bình thường; `code` + `requestId` |
| Idempotency key | [03-http-semantics-idempotency.md](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) | double-click gửi tin nhắn; retry tool có side effect |
| SSE / streaming | [08-websocket-sse.md](../01-web-frontend/00-web-foundations/08-websocket-sse.md) | token streaming; vì sao **không** cần WebSocket |
| Timeout, retry, backoff, jitter, circuit breaker | [reliability/](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) | provider chậm, `429`, `5xx` |
| Graceful degradation | [reliability/03](../05-cross-cutting/reliability/03-graceful-degradation.md) | bốn bậc degradation của AI feature |
| Redis: cache, rate limit, lock | [02-redis/](../03-database/02-redis/README.md) | prompt/embedding cache, rate limit theo token, lock cho agent run |
| Cache-aside, version-prefixed key | [01-cache-invalidation.md](../03-database/02-redis/01-cache-invalidation.md) | `corpusVersion` để invalidate retrieval cache |
| Queue + outbox | [04-message-queues/](../03-database/04-message-queues/README.md) | ingestion, embedding, tóm tắt, agent run, batch eval |
| PostgreSQL + transaction | [01-postgresql/](../03-database/01-postgresql/README.md) | conversation, message, chunk, eval result |
| Index & `EXPLAIN` | [01-index-query-plan.md](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) | đọc plan của truy vấn vector |
| Full-text search | [04-full-text-search.md](../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) | nửa còn lại của hybrid search |
| Expand/contract migration | [05-prisma-migrations-production.md](../03-database/05-data-access/05-prisma-migrations-production.md) | đổi embedding model không downtime |
| Soft delete & audit | [05-soft-delete-audit-patterns.md](../03-database/03-data-modeling/05-soft-delete-audit-patterns.md) | xoá hội thoại; audit tool tách khỏi message |
| Money là số nguyên minor unit | [08-money-decimal.md](../03-database/03-data-modeling/08-money-decimal.md) | schema cho output trích xuất hoá đơn |
| Tie-breaker khi sắp xếp | [04-pagination-filtering-sorting.md](../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) | `seq` thay vì `created_at` cho thứ tự hội thoại |
| Injection, XSS, SSRF, authz, secrets | [security/](../05-cross-cutting/security/README.md) | output của model là input không đáng tin |
| CSP | [07-csp-browser-security.md](../01-web-frontend/00-web-foundations/07-csp-browser-security.md) | lớp phòng thủ thứ hai khi render markdown |
| Log, metric, trace, correlation ID | [observability/](../05-cross-cutting/observability/README.md) | AI trace là span, không phải khái niệm mới |
| Server state vs client state | [02-data-fetching-architecture.md](../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) | state streaming vs state đã lưu |
| Latency cảm nhận | [03-slow-api-ux.md](../01-web-frontend/04-application-engineering/03-slow-api-ux.md) | TTFT vs total |
| Đuôi phân bố, p95/p99 | [01-latency-throughput-bottleneck.md](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) | vì sao chi phí trung bình che mất vấn đề |
| Tách tầng trước khi đoán | [07-full-stack-triage.md](../05-cross-cutting/performance/07-full-stack-triage.md) | cây quyết định 6 tầng của RAG |
| Stateless, nhiều instance | [01-where-to-run.md](../04-infrastructure/05-platforms/01-where-to-run.md) | agent state không nằm trong RAM |
| Reverse proxy buffer | [05-reverse-proxy-load-balancer.md](../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) | vì sao stream "biến mất" ở production |
| CI/CD quality gate | [03-cicd/](../04-infrastructure/03-cicd/README.md) | eval chặn merge |

**26 vùng kiến thức có sẵn được dùng lại.** Đây là điểm thiết kế chính của track: AI engineering là feature full-stack, không phải một hòn đảo.

## New taxonomy

9 folder, 34 note, 10 README. Không tạo folder một-note.

```text
10-ai-engineering/
├── README.md
├── 00-fundamentals/        3   từ vựng · lifecycle · architecture
├── 01-context-and-output/  4   prompt · context engineering · structured output · adapter
├── 02-chatbot-web/         7   architecture · gọi provider · streaming · UX/state ·
│                               storage · context window · memory
├── 03-rag/                 5   embedding · vector search · pipeline · failure modes · vs fine-tuning
├── 04-agents-tools/        3   tool calling · tool security · agent loop
├── 05-evaluation/          2   evaluating features · RAG & agent eval
├── 06-safety/              2   prompt injection · untrusted output
├── 07-production/          7   observability · cost/routing · caching · latency ·
│                               failure handling · versioning · human in the loop
└── 08-scenarios/           1   5 scenario (A–E)
```

Sai khác so với cấu trúc đề xuất trong TASK, và lý do:

| Đề xuất | Đã làm | Vì sao |
|---|---|---|
| `01-llm-runtime/` riêng | gộp vào `00-fundamentals/01-llm-request-lifecycle.md` | cùng một chủ đề; tách ra tạo folder một-note |
| `02-prompt-context/` riêng | gộp `01-context-and-output/` (prompt + context + output + adapter) | bốn note cùng nói về **hai biên của một lời gọi**; đọc liền mạch hơn |
| `05-memory/` riêng | `02-chatbot-web/07-memory.md` | memory là state của hội thoại → thuộc cùng folder với storage và context window |
| `08-observability-safety/` gộp | tách `06-safety/` và `07-production/01-observability` | safety là chủ đề bảo mật độc lập; observability là chủ đề vận hành |
| — | thêm `08-scenarios/` | theo tiền lệ [05-cross-cutting/scenarios/](../05-cross-cutting/scenarios/README.md) |

## Notes created

| Folder | Note | Kích thước |
|---|---|---|
| 00-fundamentals | `00-ai-vocabulary.md` (foundation, 7 mục) | 13 KB |
| | `01-llm-request-lifecycle.md` | 11 KB |
| | `02-ai-application-architecture.md` | 11 KB |
| 01-context-and-output | `01-prompt-as-input-contract.md` | 12 KB |
| | `02-context-engineering.md` | 12 KB |
| | `03-structured-output.md` | 12 KB |
| | `04-provider-adapter-and-dto.md` | 12 KB |
| 02-chatbot-web | `01-chatbot-architecture.md` | 12 KB |
| | `02-calling-provider-from-web.md` | 12 KB |
| | `03-streaming.md` | 13 KB |
| | `04-chat-ux-and-state.md` | 12 KB |
| | `05-conversation-storage.md` | 13 KB |
| | `06-context-window-management.md` | 12 KB |
| | `07-memory.md` | 12 KB |
| 03-rag | `01-embeddings.md` (foundation, 7 mục) | 10 KB |
| | `02-vector-search.md` | 13 KB |
| | `03-rag-pipeline.md` | 14 KB |
| | `04-rag-failure-modes.md` | 13 KB |
| | `05-rag-vs-fine-tuning.md` | 11 KB |
| 04-agents-tools | `01-tool-calling.md` | 13 KB |
| | `02-tool-security.md` | 14 KB |
| | `03-agent-loop.md` | 13 KB |
| 05-evaluation | `01-evaluating-ai-features.md` | 13 KB |
| | `02-rag-and-agent-evaluation.md` | 12 KB |
| 06-safety | `01-prompt-injection.md` | 14 KB |
| | `02-untrusted-model-output.md` | 13 KB |
| 07-production | `01-ai-observability.md` | 12 KB |
| | `02-cost-and-model-routing.md` | 13 KB |
| | `03-ai-caching.md` | 13 KB |
| | `04-latency-engineering.md` | 12 KB |
| | `05-failure-handling.md` | 12 KB |
| | `06-versioning-and-release.md` | 12 KB |
| | `07-human-in-the-loop.md` | 13 KB |
| 08-scenarios | `01-ai-scenarios.md` | 13 KB |

**34 note + 10 README = 44 file, ~704 KB.** Không có stub; note nhỏ nhất > 8 KB.

## Coverage theo yêu cầu của TASK

40 phần của TASK, đối chiếu:

| TASK | Ở đâu |
|---|---|
| 1 Fundamentals · misconceptions | `00-fundamentals/00-ai-vocabulary.md` — 10 hiểu sai, gồm cả 6 cái TASK nêu |
| 2 Request/response lifecycle | `00-fundamentals/01-llm-request-lifecycle.md` — 9 trạm, 3 tầng lỗi |
| 3 Prompt & context engineering | `01-context-and-output/01`, `02` — pipeline 6 bước select→filter→rank→compress→place |
| 4 Structured output | `01-context-and-output/03` — 4 mức ràng buộc, pipeline 7 bước, 4 bậc fallback |
| 5 Provider adapter | `01-context-and-output/04` — 6 thứ normalize; **và khi nào là overengineering** |
| 6 Chatbot architecture | `02-chatbot-web/01` — 15 trạm |
| 7 Chat UX | `02-chatbot-web/04` — 8 trạng thái, 13 UI state, 4 hành động khác nhau |
| 8 Streaming | `02-chatbot-web/03` — SSE vs WS theo use case, vòng đời, huỷ 3 khâu |
| 9 External API integration | `02-chatbot-web/02` — 7 thứ gateway, 3 timeout, `NEXT_PUBLIC_*` bẫy |
| 10 Provider → web response | `01-context-and-output/04` — mapper finish reason, nhánh `default` |
| 11 Application DTO | `01-context-and-output/04` — 3 DTO, 3 lý do đổi, `ChatEvent` union |
| 12 Conversation storage | `02-chatbot-web/05` — schema đủ cho 5 nhu cầu |
| 13 Context window management | `02-chatbot-web/06` — 4 chiến lược, tóm tắt lũy tiến |
| 14 Memory | `02-chatbot-web/07` — 6 thứ bị gọi là memory; 5 điều bắt buộc mỗi fact |
| 15 Embeddings | `03-rag/01` (foundation) |
| 16 Vector search | `03-rag/02` — pgvector, HNSW/IVFFlat, hybrid, RRF |
| 17 RAG | `03-rag/03` — 2 pipeline, contextual header |
| 17b RAG failure modes | `03-rag/04` — cây quyết định 6 tầng |
| 18 RAG vs fine-tuning | `03-rag/05` — **và** "khi nào chỉ cần code" |
| 19 Tool calling | `04-agents-tools/01` |
| 20 Tool security | `04-agents-tools/02` — 7 lớp, phân loại R/R+/W/W!/$/X |
| 21 Agent loop | `04-agents-tools/03` |
| 22 Stop conditions | `04-agents-tools/03` — 6 điều kiện, phát hiện không tiến triển |
| 23 Evaluation | `05-evaluation/01` — 4 loại kiểm tra, 7 chiều |
| 24 RAG evaluation | `05-evaluation/02` — recall@k đặt trần |
| 25 AI observability | `07-production/01` |
| 26 Cost engineering | `07-production/02` — 7 đòn theo thứ tự |
| 27 Model routing | `07-production/02` — 3 cách, cảnh báo escalation |
| 28 AI caching | `07-production/03` — 4 loại theo mức an toàn |
| 29 Safety / guardrails | `06-safety/01` |
| 30 Untrusted model output | `06-safety/02` — 13 đích đến |
| 31 Prompt injection in RAG | `06-safety/01` — indirect injection |
| 32 AI + web security | `06-safety/02` — markdown, CSP, tên file, log |
| 33 Latency engineering | `07-production/04` — TTFT vs total, `pre_model_ms` |
| 34 Failure handling | `07-production/05` — 10 trạng thái, retryability |
| 35 Chatbot production states | `02-chatbot-web/04` — state machine |
| 36 Multi-model / multi-provider | `01-context-and-output/04` + `07-production/02` |
| 37 AI API versioning | `07-production/06` — 5 thứ version, canary eval |
| 38 AI feature release | `07-production/06` — flag, shadow, canary, ramp |
| 39 Human in the loop | `07-production/07` — 4 mức, ma trận quyết định |
| 40 AI application architecture | `00-fundamentals/02` |
| Scenarios A–E | `08-scenarios/01-ai-scenarios.md` |

**40/40 phần được phủ.** Không có phần nào bị bỏ.

## Provider-specific details intentionally avoided

```text
✗ Danh sách method của một SDK          → tra tài liệu provider
✗ Tên tham số cụ thể của từng provider   → chỉ nêu khi minh hoạ khác biệt
✗ Hướng dẫn cài đặt SDK                  → không phải nội dung học
✗ Giá cố định                            → có bảng nhưng ghi rõ "để thấy TỈ LỆ"
                                            (output ≈ 5× input; model mạnh ≈ 2–5× model nhỏ)
```

Cái được giữ, vì nó là **hình dạng** không phụ thuộc vendor:

```text
✓ finish reason có những giá trị nào và mỗi cái dẫn tới xử lý gì
✓ prompt cache khớp theo tiền tố byte, thứ tự tools → system → messages
✓ tool result phải trả về đủ cho MỌI tool call, gom trong MỘT message
✓ structured output đảm bảo hình dạng, không đảm bảo đúng đắn
✓ streaming cần ba timeout, và usage tới ở CUỐI
```

Ví dụ mã dùng pseudo-TypeScript theo phong cách NestJS/Prisma của repo, không dùng SDK cụ thể nào — trừ khi so sánh khác biệt giữa provider.

## Cross-links & integration

| File | Thêm gì |
|---|---|
| [README gốc](../README.md) | dòng "Xây sản phẩm có AI" trong bảng học-X; mục nguyên tắc AI; nav table |
| [knowledge-map.md](./knowledge-map.md) | mục **"Tầng AI (chạy song song)"** — AI cắt qua mọi tầng, có sơ đồ ánh xạ |
| [behavior-index.md](./behavior-index.md) | mục **"Triệu chứng của AI feature"** — 19 triệu chứng → tầng → note |
| [04-topic-index.md](./04-topic-index.md) | 45 entry cho `10-ai-engineering` |
| [glossary.md](./glossary.md) | **24 từ AI mới**; chuyển canonical owner của `context window` sang track 10 |
| [application-engineering-map.md](./application-engineering-map.md) | mục **"Xây feature có AI bên trong"** — 7 câu hỏi problem-first |
| [09-ai-assisted-development/README.md](../09-ai-assisted-development/README.md) | mục phân biệt hai track; trỏ tới `06-safety/` cho mức thực thi |
| [09/02-context-engineering.md](../09-ai-assisted-development/02-context-engineering.md) | dòng trỏ tới canonical owner mới |

`04-topic-index.md` được **sửa thủ công**, không sinh lại từ đĩa — để không đưa vào index những file đang được viết trong `07-projects/` (công việc song song của người dùng).

## Remaining deliberate gaps

Những thứ **cố tình không có**, ghi ra để lần sau không ai tưởng là sót:

| Không có | Vì sao |
|---|---|
| Toán deep learning, backprop, kiến trúc transformer | không cần để build AI feature; TASK loại trừ |
| Train model từ đầu, TensorFlow/PyTorch | ngoài phạm vi application engineering |
| Hướng dẫn fine-tuning từng bước | `03-rag/05` nói **khi nào** và **điều kiện tiên quyết**; thao tác thuộc tài liệu provider |
| Tutorial một vector database cụ thể | `03-rag/02` nói cách **chọn** và các đánh đổi; không phải sách hướng dẫn Pinecone/Qdrant |
| Multimodal (ảnh, audio, video) | chưa phải nhu cầu phổ biến của repo; sẽ thêm nếu cần |
| Realtime voice / WebRTC | kiến trúc khác hẳn; chỉ nêu như ngoại lệ ephemeral token ở `02-chatbot-web/02` |
| Chi tiết framework agent (LangGraph, CrewAI…) | `04-agents-tools/03` dạy vòng lặp và điều kiện dừng — framework là implementation |
| MCP, function-calling protocol cụ thể | pattern đã có ở tool calling; protocol thay đổi nhanh |
| Self-hosted model, GPU, quantization | ngoài phạm vi; hầu hết dự án dùng API |
| Bảng so sánh model theo benchmark | lỗi thời trong vài tuần; và benchmark tiếng Anh không suy ra tiếng Việt |
| Giá cụ thể của từng provider | thay đổi liên tục; note nói rõ chỉ dùng để thấy tỉ lệ |
| Labs / bài tập chạy được | chờ [07-projects/fullstack-lab/](../07-projects/fullstack-lab/README.md) — đang được xây song song |

## Validation

| Kiểm tra | Kết quả |
|---|---|
| Broken link | **11 — bằng baseline, không tăng** |
| Broken link còn lại | 10 × `07-projects/fullstack-lab/phases/` (đang xây) + 1 placeholder trong `templates/topic-note.md` |
| Link mới trong track | ~250 link, **0 sai ở lần chạy đầu** |
| Frontmatter `prerequisites`/`related` không giải được | 0 |
| Code fence lệch | 0 |
| Stub < 1 KB | 0 (note nhỏ nhất > 8 KB) |
| Orphan note | 0 trong `10-ai-engineering/` |
| Glossary: dòng bảng sai số cột | 0 |
| Khái niệm có 2 canonical owner | 0 (`context window` đã chuyển và cross-link) |

## Recommended labs

Track này là kiến thức; nó cần một nơi để chạy. Bốn lab theo thứ tự (giá trị học tập)/(chi phí):

```text
LAB 1 — Chatbot streaming tối thiểu, làm ĐÚNG
  POST + SSE · optimistic UI · abort 3 khâu · lưu partial trong finally
  · idempotency theo clientMessageId
  → BREAK: đóng tab giữa stream · double-click Gửi · deploy sau Nginx
            không có X-Accel-Buffering
  → đo: TTFT vs total · cachedInputTokens

LAB 2 — RAG trên pgvector với 2 tenant
  chunking có contextual header · filter org TRONG query · verify citation
  → BREAK: bỏ contextual header rồi so recall@5 · lọc tenant SAU retrieval
            · upload tài liệu chứa chỉ thị nhắm vào model
  → đo: recall@5 trước/sau khi thêm index HNSW  ← thí nghiệm quan trọng nhất

LAB 3 — Một tool ghi, làm đúng bảy lớp
  cancelOrder: authz trên object · policy ở code · confirm với preview do code sinh
  · audit bảng riêng
  → BREAK: đặt quy tắc hạn mức vào prompt rồi thử thuyết phục nó
  → đo: tỉ lệ denied trong audit

LAB 4 — Tăng lên 2 instance
  → phát hiện: state agent trong RAM · rate limit cục bộ × 2 · hạn mức provider
    dùng chung · cache per-instance
  → đây là lab có tỉ lệ giá trị/chi phí cao nhất, giống kết luận ở 05-platforms/
```

Lab 2 chứa thí nghiệm đáng làm nhất của cả track: **đo recall@5 trước và sau khi thêm index ANN.** Nó cho thấy một cách cụ thể rằng "nhanh hơn" có thể đi kèm "bỏ sót im lặng" — và bỏ sót đó không có triệu chứng nào ngoài chất lượng câu trả lời.

## Related

- [10-ai-engineering/](../10-ai-engineering/README.md) — track
- [09-ai-assisted-development/](../09-ai-assisted-development/README.md) — track khác, dùng AI để làm việc
- [Knowledge map](./knowledge-map.md) — tầng AI cắt qua mọi tầng
- [Behavior index](./behavior-index.md) — 19 triệu chứng AI
- [Application engineering map](./application-engineering-map.md) — problem-first
- [Glossary](./glossary.md) — 24 từ AI mới
- [Foundation coverage report](./foundation-coverage-report.md) — phiên trước
- [Foundation accuracy report](./foundation-accuracy-report.md) — phiên trước
