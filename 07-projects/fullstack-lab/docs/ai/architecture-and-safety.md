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

Tool executor lấy actor, project và capabilities từ request context phía server; argument do model sinh ra chỉ được chứa resource selector hợp lệ trong đúng project đó. Executor resolve resource, authorize ở mức object, validate trạng thái miền rồi mới gọi service/use case bình thường. Tool read-only vẫn phải qua đúng read permission hiện hành. Tool mutation bắt buộc có người xác nhận tường minh trên một thay đổi đã được render và có giới hạn rõ ràng; sau khi xác nhận, executor resolve lại resource, kiểm tra lại permission và trạng thái, rồi ghi audit. Timeout, cancel hay retry không bao giờ được biến một lần ghi không rõ kết quả thành lần ghi thứ hai mù quáng: mutation dùng đúng idempotency key và contract concurrency thông thường.

## Audit, telemetry, cost và privacy

Bản ghi audit cho mỗi lần gọi AI là append-only và tách khỏi phần text do model sinh. Nó ghi: feature và phase, ID của actor và project (chỉ khi đã resolve được), phiên bản prompt và schema, tham chiếu provider/model, timestamp, correlation ID của request hoặc job, quyết định authorize/validate/confirm, tên tool và loại kết quả, cùng liên kết tới Activity Log nghiệp vụ nếu mutation đã commit. Nó không bao giờ lưu secret, session/CSRF/reset token, credential của provider, context riêng tư ở dạng thô (mặc định), file thô, output model tuỳ ý, câu SQL, hay địa chỉ email đầy đủ trong log và label của metric.

Observability cho AI chỉ ghi các field có miền giá trị giới hạn: provider/model, phiên bản prompt, feature, số token vào/ra, latency, finish reason, loại lỗi hoặc lỗi validate ở dạng an toàn, số lượng và nguồn gốc context đã redact, và chi phí ước tính. AI-3 thêm ID đã retrieve, dải điểm, citation và kết quả evaluation, dưới cùng một chính sách lưu trữ và redaction. `requestId` dùng để đối chiếu một HTTP request; ID của worker hoặc execution dùng để đối chiếu công việc bất đồng bộ; **không** ID nào trong số đó cấp quyền truy cập, và không ID nào được dùng làm label high-cardinality của metric.

Ngân sách chi phí và token được enforce **trước** khi gọi provider và trước khi vào vòng lặp tool: chính sách theo từng feature, actor và project phải có giới hạn cho input, output, số lần retrieve và số lần gọi tool, cộng một mức chi phí trần đã qua review. Khi vượt ngân sách thì trả về một kết quả an toàn, không ghi dữ liệu, kèm bản ghi audit và telemetry tương ứng. Trang billing của provider, prompt thô và tiêu đề task không bao giờ được coi là nguồn để phân quyền, cũng không phải log debug bắt buộc.

## Evaluation và cổng phát hành

Trước mỗi AI phase, phải chạy evaluation offline có đánh phiên bản, dùng fixture đã sanitize và có thẩm quyền, kèm một bộ adversarial. AI-1 đo tính hợp lệ của schema, mức hữu dụng của kế hoạch được đề xuất, bước xác nhận, và điều kiện không ghi trước khi xác nhận. AI-2 đo mức bám vào dữ liệu thật cùng cách thể hiện sự không chắc chắn, và đo chi phí/latency. AI-3 đo mức cô lập khi retrieve, mức citation có thật và đúng, cùng chất lượng câu trả lời. AI-4 đo việc chọn tool, việc từ chối argument và schema sai, phân quyền deny-by-default, hành vi timeout/replay/idempotency, bước xác nhận, và mức đầy đủ của audit.

Kết quả evaluation được đánh phiên bản theo feature, prompt/schema, provider/model, và theo phiên bản corpus/index ở những chỗ có liên quan. Mọi thay đổi trên production đối với prompt, schema, provider/model, retrieval/index, allowlist tool, ngân sách hay chính sách lưu trữ đều phải qua review; riêng việc chọn provider và các quyết định về dữ liệu hoặc triển khai khó đảo ngược thì phải có ADR. Một bản demo chạy đẹp không bao giờ miễn được các test phân quyền ở mức HTTP trực tiếp và mức object, test cô lập giữa các project, và test failure.

## No AI MVP bypass

Cho tới khi phase tương ứng được phê duyệt, Flowboard **không** có bề mặt năng lực AI nào. Ở mọi phase sau, AI chỉ là một bên **gọi** các contract phân quyền, dữ liệu theo scope và miền nghiệp vụ đang có — nó không phải administrator, không phải kênh export dữ liệu, không phải worker gửi báo cáo, không thay thế audit, và không được là một đường ghi dữ liệu ẩn. Khi output của AI xung đột với tài liệu product, security, data hay operations thông thường, các contract đang có luôn thắng.

## Ghi chú học tập liên quan

- [Context engineering](../../../../10-ai-engineering/01-context-and-output/02-context-engineering.md), [structured output](../../../../10-ai-engineering/01-context-and-output/03-structured-output.md) và [provider adapter/DTO](../../../../10-ai-engineering/01-context-and-output/04-provider-adapter-and-dto.md).
- [RAG pipeline](../../../../10-ai-engineering/03-rag/03-rag-pipeline.md), [RAG failure modes](../../../../10-ai-engineering/03-rag/04-rag-failure-modes.md) và [tool security](../../../../10-ai-engineering/04-agents-tools/02-tool-security.md).
- [Evaluation](../../../../10-ai-engineering/05-evaluation/01-evaluating-ai-features.md), [AI observability](../../../../10-ai-engineering/07-production/01-ai-observability.md) và [human in the loop](../../../../10-ai-engineering/07-production/07-human-in-the-loop.md).
