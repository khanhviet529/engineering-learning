# Kiến trúc và an toàn AI Flowboard

Tài liệu này định nghĩa boundary cho AI-1 đến AI-4, không phải implementation authorization riêng. Nó áp dụng [authentication](../security/authentication.md), [authorization model](../security/authorization-model.md), [authorization test matrix](../security/authorization-test-matrix.md), [API conventions](../api/api-conventions.md), [observability](../operations/observability.md) và [AI roadmap](roadmap.md). Core MVP không khởi tạo các module ở đây.

## Kiến trúc application-owned

```text
authorized request / confirmed UI action
  -> server-derived actor + project + capabilities
  -> ContextBuilder (scoped queries, redaction, budget)
  -> ProviderAdapter (provider-independent DTO)
  -> raw model response
  -> parse -> schema validation -> normalization -> policy validation
  -> read response | confirmation draft | ToolRegistry/Executor
  -> normal domain use case + Activity Log/audit when a confirmed write succeeds
```

Future module boundaries là `context`, `provider`, `structured-output`, `conversations`, `retrieval`, `tools`, `evaluation` và `observability`. Mỗi module có một contract hẹp; không module nào tự query tất cả workspace, tự chọn actor/project từ prompt, hay gọi database/provider/tool bằng input chưa validate.

### Context, conversations và retrieval

`ContextBuilder` bắt đầu từ authenticated actor và resource đã resolve, gọi `AuthorizationService.can`, rồi dùng repository query đã project-scope. Nó allowlist fields, caps record/token count, marks provenance và redacts secrets/tokens/internal metadata trước provider call. Client/model-supplied workspace/project IDs, role text, “ignore policy” instruction và links không thay được scope.

Conversation record, nếu AI-3 cần, gắn immutable `project_id`, actor/visibility policy, prompt/version metadata và retention policy đã duyệt. Lần đọc hay append sau đó phải re-authorize project scope; conversation không là cache chung của workspace và không mang memory qua project. Không log transcript/raw prompt mặc định; persistence, export/deletion/retention là design/ADR riêng trước khi dữ liệu conversation tồn tại.

Retrieval lấy authorization/project filter ở query boundary, trước ranking/context window. Index/chunk metadata phải chứa project/source identity để reject record không scope; client-side filtering hay model instruction không đủ. Citation chỉ được tạo từ retrieved, authorized source và phải revalidate link/resource lúc user mở nó.

### Provider abstraction và DTO

Chỉ `ProviderAdapter` biết provider SDK/request/response. Application/frontend sử dụng canonical DTO, chẳng hạn `AiGenerationRequest { feature, promptVersion, messages, responseSchema, maxOutputTokens }` và `AiGenerationResult { text, structured?, finishReason, usage, modelRef }`; chúng không lộ provider-specific role, tool call, usage hay error shape. Adapter normalizes timeout, cancellation, retry classification and safe error code.

Provider/model selection, data residency, retention mode, model routing, quota and failover là configuration + ADR tại lúc implementation, không hard-code trong product DTO. Provider failure không tự đổi permission/scope, không fallback sang provider chưa được privacy review và không silently biến structured request thành free-form write. Xem [provider adapter and DTO](../../../../10-ai-engineering/01-context-and-output/04-provider-adapter-and-dto.md) và [cost/model routing](../../../../10-ai-engineering/07-production/02-cost-and-model-routing.md).

## Model output là untrusted input

Raw model output có thể malformed, overlong, injected, stale, hallucinated hoặc chứa tool arguments nguy hiểm. Luồng bắt buộc là parse trong resource limit → validate exact schema/version → normalize → validate application policy/domain state → render proposal/read result hoặc yêu cầu confirmation. Validation failure không execute tool/write, không retry bằng cách tự nới schema, và chỉ trả safe outcome; telemetry ghi validation category đã redact.

Structured output schema không cấp quyền. Field như `projectId`, `workspaceId`, `actorId`, role, `fileStorageKey`, recipient, SQL, URL, timestamp, audit fields, position/version do client/model tự gửi bị reject hoặc ignored theo DTO. Mọi normal mutation lấy identity/scope từ server, check permission lại gần transaction và tiếp tục dùng idempotency/optimistic concurrency của use case.

Prompt injection là untrusted instruction chứ không phải policy override. System/context instruction chỉ nói model được làm gì; authorization, retrieval filter, tool allowlist, confirmation và server validation mới là enforcement. Xem [prompt injection](../../../../10-ai-engineering/06-safety/01-prompt-injection.md) và [untrusted model output](../../../../10-ai-engineering/06-safety/02-untrusted-model-output.md).

## Tool registry và controlled execution

`ToolRegistry` allowlist tools theo AI phase/feature. Mỗi declaration xác định input/output schema, underlying action permission, max result size, timeout, rate/cost budget, idempotency behavior và audit event name. `ToolExecutor` không expose generic repository, SQL client, filesystem, environment, arbitrary HTTP, provider secret hay email client.

Tool executor derives actor/project/capabilities from server request context; model argument chỉ có resource selector hợp lệ trong project đó. Nó resolve resource, authorize object-level, validate domain state and invoke normal service/use case. Read-only tool vẫn enforces current read permission. Mutation tool bắt buộc explicit human confirmation of a rendered, bounded change; after confirmation executor re-resolves resource, re-checks permission/state and records audit. Timeout/cancel/retry never converts an uncertain write into a second blind write; mutation uses normal idempotency key and concurrency contract.

## Audit, telemetry, cost và privacy

AI invocation/audit is append-only and distinct from model text. It records feature/phase, actor/project IDs only when resolved, prompt and schema version, provider/model reference, timestamp, request/job correlation ID, authorization/validation/confirmation decision, tool name/result category, and linked business Activity Log for a committed mutation. It never stores secrets, session/CSRF/reset tokens, provider credentials, raw private context by default, raw file, arbitrary model output, SQL or full email recipient in logs/metric labels.

AI observability records bounded fields: provider/model, prompt version, feature, token input/output, latency, finish reason, safe error/validation category, redacted context counts/provenance and cost estimate. AI-3 adds retrieved IDs/score bands/citations and evaluation result under the same retention/redaction policy. `requestId` correlates an HTTP request; worker/execution IDs correlate asynchronous work; neither grants access or becomes a metric high-cardinality label.

Cost/token budgets are enforced before provider calls and tool loops: per feature/actor/project policy must have bounded input, output, retrieval and tool-call limits, plus a reviewed cost ceiling. Exceeded budget returns a safe, non-mutating result and audit/telemetry outcome. Provider billing pages, raw prompts and task titles are never treated as a source of authorization or a required debug log.

## Evaluation and release gate

Before each AI phase, run versioned offline evaluation with sanitized/authorized fixtures and an adversarial suite. AI-1 measures schema validity, proposed-plan usefulness, confirmation and no-write-before-confirmation. AI-2 measures factual grounding/uncertainty and cost/latency. AI-3 measures retrieval isolation, citation support/correctness and answer quality. AI-4 measures tool selection, argument/schema rejection, deny-by-default authorization, timeout/replay/idempotency, confirmation and audit completeness.

Evaluation results are versioned by feature, prompt/schema, provider/model and corpus/index version where relevant. Production changes to prompt, schema, provider/model, retrieval/index, tool allowlist, budget or retention policy require review; provider selection and difficult-to-reverse data/deployment decisions require ADR. A green demo never waives direct HTTP/object-level authorization, cross-project isolation or failure tests.

## No AI MVP bypass

Until the corresponding phase is approved, Flowboard has no AI capability surface. At every later phase, AI is a caller of existing authorization, scoped data and domain contracts—not an administrator, data export channel, report-delivery worker, audit substitute or hidden write path. Any conflict between AI output and the normal product/security/data/operations documents is resolved in favor of those existing contracts.

## Ghi chú học tập liên quan

- [Context engineering](../../../../10-ai-engineering/01-context-and-output/02-context-engineering.md), [structured output](../../../../10-ai-engineering/01-context-and-output/03-structured-output.md) và [provider adapter/DTO](../../../../10-ai-engineering/01-context-and-output/04-provider-adapter-and-dto.md).
- [RAG pipeline](../../../../10-ai-engineering/03-rag/03-rag-pipeline.md), [RAG failure modes](../../../../10-ai-engineering/03-rag/04-rag-failure-modes.md) và [tool security](../../../../10-ai-engineering/04-agents-tools/02-tool-security.md).
- [Evaluation](../../../../10-ai-engineering/05-evaluation/01-evaluating-ai-features.md), [AI observability](../../../../10-ai-engineering/07-production/01-ai-observability.md) và [human in the loop](../../../../10-ai-engineering/07-production/07-human-in-the-loop.md).
