# Lộ trình AI Flowboard

AI là capability sau core MVP, không phải shortcut quanh product rules. Tài liệu này kế thừa [vision and scope](../product/vision-and-scope.md), [delivery roadmap](../product/delivery-roadmap.md), [authorization model](../security/authorization-model.md), [data model](../data/domain-model.md) và [AI architecture and safety](architecture-and-safety.md). Không có UI, endpoint, provider, vector store, conversation store, tool hay quyền AI nào trong core MVP.

## Quy tắc mở phase

Identity, workspace/project scope và capability luôn do server suy ra từ session, resource resolver và authorization policy. Workspace Admin không có private-project access mặc định. AI không thể nâng quyền, chọn project khác, ghi trực tiếp database hay thay thế Activity Log/audit. Mỗi phase chỉ bắt đầu sau khi phase trước có dữ liệu, test và telemetry cần thiết; provider choice là ADR sau đánh giá capability, privacy, latency và cost.

| Phase | Prerequisite product data | Giá trị và actor được phép | Input → output | Không bao gồm | Acceptance signal để đi tiếp |
|---|---|---|---|---|---|
| AI-1 | Project, Board Column, Task, project membership/Owner policy ổn định | Owner đề xuất plan từ goal trong một project | Goal đã validate + server context tối thiểu → proposal task/column có schema | Auto-create, auto-assign, generic project generation, cross-project context | Structured validation, Owner confirmation, authorization/domain/audit test và proposal acceptance/rejection telemetry ổn định |
| AI-2 | AI-1 safety baseline; task, due_date, activity và project state đủ tin cậy | Mọi actor có quyền đọc dữ liệu nguồn của project có thể xin summary | Server-built project context → progress/risk summary, uncertainty và evidence summary | Write, task mutation, background monitoring, implicit workspace summary | Token/latency/cost telemetry, redaction, summary evaluation và actionable-user feedback được review |
| AI-3 | AI-2 context/telemetry; project-scoped content corpus và access-aware retrieval | Actor có quyền đọc source trong một project hỏi/semantic search | Question + server-derived project/read scope → answer/search results với citations | Global corpus, cross-project retrieval, citation bịa, mutation tool | Retrieval/citation correctness, isolation/adversarial tests, RAG evaluation và safe failure rate đạt gate đã duyệt |
| AI-4 | AI-3 evaluation/observability; stable normal use cases và audit | Actor chỉ gọi tool mà normal policy cho phép; write cần confirmation | Structured tool request → bounded result hoặc explicit confirmation → normal use case | Arbitrary code/SQL/HTTP, identity arguments từ model, autonomous admin, unattended writes | Tool authorization/timeout/idempotency/confirmation/audit tests và production evaluation/review đạt gate |

## AI-1 — đề xuất task từ mục tiêu Owner

Chỉ Project Owner được khởi tạo. Server resolve project trước khi lấy goal/context; model chỉ trả proposal structured (ví dụ tên đề xuất, description, priority, due date có thể có và dependency rationale ở dạng text), không trả payload có thể tự viết trực tiếp vào persistence. Output được parse, schema-validate, normalize, giới hạn size/count và hiển thị như bản nháp.

Owner phải xem, sửa nếu cần và xác nhận tường minh chính proposal/version đó trước mọi write. Sau confirmation, server re-check session, Owner authorization, project scope, column/member/domain invariant và dùng normal task/column use case với idempotency/concurrency rules. Proposal có thể bị từ chối/expired khi context hoặc quyền thay đổi; không có silent retry làm xuất hiện task. Audit phân biệt `ai.proposal_generated`, Owner confirmation/rejection và các business Activity Log (`task.created`, v.v.) mà mutation thực sự tạo.

## AI-2 — tóm tắt tiến độ và rủi ro

AI-2 chỉ đọc. Context builder query theo một project đã authorize và chỉ lấy fields mà actor được phép đọc; model không được diễn giải `projectId`, workspace hoặc role từ prompt. Output diễn đạt progress/risk, missing information và uncertainty để người dùng kiểm chứng, không phải quyết định deadline, role hay trạng thái task.

Mỗi request ghi prompt/version, provider/model, token input/output, latency, finish reason, validation result, redacted context metadata và cost estimate theo [observability contract](architecture-and-safety.md). Quota/budget/routing là server policy; raw prompt, task description nhạy cảm, session/token và private payload không thành metric label hay log mặc định. AI-2 không tự chạy theo lịch, không gửi notification, không tạo task và không thay reporting Phase 1.2.

## AI-3 — copilot, semantic search và RAG theo project

Retrieval filter `project_id` và source-level authorization được áp dụng **trước** vector/keyword retrieval và trước context assembly. Kết quả chỉ gồm content mà actor có quyền đọc trong project đã resolve; không retrieve global rồi lọc ở prompt/client. Conversation memory cũng phải gắn project/actor/scope, không tự mang context từ project hoặc workspace khác.

Mọi answer có claim dựa trên source phải có citation an toàn tới source đã retrieve (loại resource, stable ID/link đã authorize, optional excerpt được allowlist). Citation không chứng minh content chưa retrieve, không lộ storage key/internal score thô và không thể dẫn tới resource ngoài scope. Nếu evidence không đủ, model nói rõ giới hạn thay vì suy đoán. Lưu retrieved identifiers, score bands/citations và evaluation outcome theo redaction policy để audit/evaluate, không lưu toàn bộ private corpus như telemetry.

## AI-4 — bounded tools

AI-4 bắt đầu read-only với tool registry allowlisted. Mỗi tool có purpose hẹp, input schema, output projection, timeout, size/rate limit và action permission riêng; executor lấy actor/project/resource từ server context, không bao giờ từ model arguments. Tool call qua `AuthorizationService.can`, resource resolution, validated use case và project-scoped repository như request HTTP thông thường.

Write tool chỉ được thêm từng use case sau review. Model trả intent/arguments đã validate; UI yêu cầu actor xác nhận tường minh, rồi server re-check permission, current resource/domain state, idempotency và optimistic concurrency trước write. Mọi attempt/result/denial/timeout/confirmation được audit với tool/prompt/model version và correlation IDs đã redact. Tool không có generic CRUD, raw SQL, arbitrary URL/file access, credential access, send-email-to-anyone hay background autonomous mutation.

## Links đến AI engineering notes

- AI-1: [prompt as input contract](../../../../10-ai-engineering/01-context-and-output/01-prompt-as-input-contract.md), [structured output](../../../../10-ai-engineering/01-context-and-output/03-structured-output.md), [untrusted model output](../../../../10-ai-engineering/06-safety/02-untrusted-model-output.md), [human in the loop](../../../../10-ai-engineering/07-production/07-human-in-the-loop.md).
- AI-2: [context engineering](../../../../10-ai-engineering/01-context-and-output/02-context-engineering.md), [AI observability](../../../../10-ai-engineering/07-production/01-ai-observability.md), [cost and model routing](../../../../10-ai-engineering/07-production/02-cost-and-model-routing.md).
- AI-3: [embeddings](../../../../10-ai-engineering/03-rag/01-embeddings.md), [RAG pipeline](../../../../10-ai-engineering/03-rag/03-rag-pipeline.md), [RAG failure modes](../../../../10-ai-engineering/03-rag/04-rag-failure-modes.md), [RAG and agent evaluation](../../../../10-ai-engineering/05-evaluation/02-rag-and-agent-evaluation.md).
- AI-4: [tool calling](../../../../10-ai-engineering/04-agents-tools/01-tool-calling.md), [tool security](../../../../10-ai-engineering/04-agents-tools/02-tool-security.md), [evaluating AI features](../../../../10-ai-engineering/05-evaluation/01-evaluating-ai-features.md).
