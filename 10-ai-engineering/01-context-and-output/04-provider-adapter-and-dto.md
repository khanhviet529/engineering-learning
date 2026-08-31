---
level: intermediate
area: ai-engineering
prerequisites:
  - 03-structured-output.md
related:
  - ../07-production/06-versioning-and-release.md
  - ../02-chatbot-web/03-streaming.md
---

# Provider adapter và DTO của application

> Một team viết `openai.chat.completions.create(...)` rải rác trong 23 file. Khi cần thêm fallback sang provider khác vì rate limit, họ ước lượng hai ngày. Thực tế mất ba tuần — không phải vì SDK mới khó, mà vì `finish_reason`, hình dạng tool call, cấu trúc streaming event và cách báo lỗi đều khác nhau, và **frontend đang đọc trực tiếp trường `choices[0].message.content`** ở bốn nơi.

## Position

```text
Provider SDK  →  ADAPTER  →  Application result  →  DTO cho frontend
                    ▲              ▲                      ▲
              note này         contract          contract công khai,
                              nội bộ             phải version
```

## Problem

Mọi provider LLM làm cùng một việc, và không có hai provider nào mô tả nó giống nhau:

```text
Cùng khái niệm "vì sao model dừng":
  finish_reason: "stop" | "length" | "tool_calls"     (một provider)
  stop_reason:   "end_turn" | "max_tokens" | "tool_use" | "refusal"  (khác)
  finishReason:  "STOP" | "MAX_TOKENS" | "SAFETY"     (khác nữa)
```

Nếu code nghiệp vụ của bạn viết `if (res.finish_reason === 'length')`, bạn đã **ghim** application vào một provider — không phải bằng một quyết định kiến trúc, mà bằng một chuỗi ký tự.

Nhưng đây là chỗ dễ overengineer nhất trong track. Nên note này phải trả lời cả hai câu:

```text
Khi nào adapter là cần thiết?
Khi nào nó chỉ là tầng trung gian vô ích?
```

## Mental Model

### Ba DTO, ba lý do đổi

Đây là ý chính của note. Ba tầng dữ liệu, và **chúng đổi vì những lý do khác nhau**:

```text
① PROVIDER RESPONSE      đổi khi provider cập nhật SDK / API
        │ adapter
        ▼
② APPLICATION RESULT     đổi khi NGHIỆP VỤ của bạn đổi
        │ mapper
        ▼
③ FRONTEND DTO / EVENT   đổi khi UI cần thứ khác — và phải VERSION
```

Nhập ①với② nghĩa là mọi lần provider đổi SDK, bạn sửa code nghiệp vụ. Nhập ②với③ nghĩa là mọi lần UI cần field mới, bạn đổi contract công khai. Cả hai đều là cùng một sai lầm ở hai chỗ khác nhau — và repo này đã dạy nó ở [02-rest-api-contract.md](../../02-backend-api/00-http-api/02-rest-api-contract.md).

### Normalize cái gì: sáu thứ, không phải toàn bộ SDK

Adapter **không** phải bọc lại mọi tính năng của provider. Nó normalize sáu thứ mà code nghiệp vụ thật sự cần:

```text
① finish reason        → enum của BẠN
② usage                → { inputTokens, outputTokens, cachedInputTokens }
③ text content         → string
④ tool calls           → { id, name, args: unknown }  ← args CHƯA validate
⑤ lỗi                  → phân loại theo retryability
⑥ stream events        → union type của BẠN
```

Mọi thứ khác — tính năng riêng của provider — để nguyên trong adapter, dùng qua `providerMeta` khi cần.

### ① Finish reason: enum của bạn

```ts
export type FinishReason =
  | 'completed'      // dừng tự nhiên — dùng được
  | 'max_tokens'     // BỊ CẮT — output không hợp lệ
  | 'tool_call'      // model xin gọi tool
  | 'blocked'        // bộ lọc an toàn từ chối
  | 'cancelled'      // client huỷ
  | 'error';         // provider trả lỗi giữa stream
```

Sáu giá trị này là **quyết định nghiệp vụ**, không phải bản dịch. Chúng được chọn vì mỗi cái dẫn tới một xử lý khác:

```text
completed  → dùng output
max_tokens → KHÔNG dùng output; tăng max_tokens hoặc thu gọn yêu cầu
tool_call  → thực thi tool, gọi lại
blocked    → thông báo cho người dùng; retry vô ích
cancelled  → lưu partial nếu có; không tính là lỗi
error      → phân loại retryability
```

Mapper phải xử lý cả giá trị **chưa biết** — provider sẽ thêm giá trị mới:

```ts
function mapFinishReason(raw: string | null): FinishReason {
  switch (raw) {
    case 'end_turn': case 'stop': case 'STOP':            return 'completed';
    case 'max_tokens': case 'length': case 'MAX_TOKENS':  return 'max_tokens';
    case 'tool_use': case 'tool_calls':                   return 'tool_call';
    case 'refusal': case 'content_filter': case 'SAFETY': return 'blocked';
    default:
      // KHÔNG im lặng coi là 'completed' — đó là cách bug lọt qua
      logger.warn('unknown finish reason', { raw });
      metrics.increment('llm.unknown_finish_reason', { raw: String(raw) });
      return 'error';
  }
}
```

Nhánh `default` là dòng quan trọng nhất trong file. Mặc định `'completed'` nghĩa là khi provider thêm một lý do dừng mới, bạn **âm thầm** coi output bị chặn hoặc bị cắt là hợp lệ.

### ⑤ Lỗi: phân loại theo retryability, không theo tên

Code nghiệp vụ không cần biết `RateLimitError` của SDK nào. Nó cần biết **có nên thử lại**:

```ts
export type ProviderErrorKind =
  | 'rate_limited'      // retry, tôn trọng Retry-After
  | 'transient'         // 5xx, timeout, mạng → retry với backoff + jitter
  | 'context_too_large' // KHÔNG retry — phải thu gọn context
  | 'invalid_request'   // KHÔNG retry — bug của bạn
  | 'auth'              // KHÔNG retry — sai key/quyền
  | 'content_policy'    // KHÔNG retry — nội dung bị từ chối
  | 'unknown';
```

Phân loại này là lý do adapter tồn tại ngay cả khi bạn chỉ có **một** provider: nó là chỗ duy nhất biết `429` khác `400` khác `413`. Không có nó, logic retry bị copy khắp nơi và mỗi bản một kiểu. Nguyên tắc y hệt [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — chỉ khác là thêm hai loại lỗi mới (`context_too_large`, `content_policy`).

### ⑥ Stream events: union type là contract với frontend

Đây là DTO tầng ③, và là chỗ đáng thiết kế kỹ nhất vì frontend phụ thuộc trực tiếp vào nó:

```ts
export type ChatEvent =
  | { type: 'text-delta';  text: string }
  | { type: 'tool-start';  toolCallId: string; tool: string }
  | { type: 'tool-result'; toolCallId: string; ok: boolean }
  | { type: 'citation';    sourceId: string; quote?: string }
  | { type: 'done';        finishReason: FinishReason; usage: Usage }
  | { type: 'error';       code: string; retryable: boolean };
```

Bốn quyết định trong union trên:

```text
① type là discriminant   → frontend switch exhaustive, TS bắt thiếu case
② 'done' MANG finishReason → FE biết câu trả lời bị cắt hay không
③ 'error' mang retryable   → FE biết có nên hiện nút "Thử lại"
④ 'tool-result' KHÔNG mang dữ liệu thô của tool
```

Quyết định ④ là quyết định bảo mật: kết quả tool có thể chứa dữ liệu nội bộ. Gửi `ok: boolean` cho UI biết tool đã chạy; nội dung chỉ đi vào context của model, không đi ra frontend — trừ khi bạn cố ý chọn field nào được ra.

Và như mọi contract công khai: **event này phải version.** Thêm một `type` mới là tương thích (FE cũ bỏ qua case không biết — miễn là bạn đã viết `default` ở FE). Đổi nghĩa một field đang có là breaking. Xem [06-api-versioning-evolution.md](../../02-backend-api/00-http-api/06-api-versioning-evolution.md).

## Example

Interface là contract của **bạn**, viết theo nhu cầu của bạn — không phải bản sao SDK:

```ts
export interface ModelProvider {
  readonly id: string;                               // 'anthropic' | ...
  chat(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  countTokens(req: Pick<ChatRequest, 'messages' | 'tools'>): Promise<number>;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  maxOutputTokens: number;                           // BẮT BUỘC, không tuỳ chọn
  jsonSchema?: JsonSchema;
  signal?: AbortSignal;                              // để huỷ được
}

export interface ChatResult {
  id: string;
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  ttftMs?: number;
  providerMeta?: Record<string, unknown>;            // thoát hiểm, KHÔNG dùng ở nghiệp vụ
}
```

Ba chi tiết đáng chú ý:

```text
① maxOutputTokens BẮT BUỘC → không thể quên giới hạn output
② signal có sẵn trong contract → huỷ là tính năng hạng nhất, không phải vá sau
③ providerMeta là thoát hiểm CÓ TÊN → dùng nó ở nghiệp vụ là mùi code rõ ràng
```

Fallback thì đơn giản khi đã có adapter — nhưng có một cái bẫy về chất lượng:

```ts
async function chatWithFallback(req: ChatRequest): Promise<ChatResult> {
  for (const p of [primary, secondary]) {
    try {
      return await p.chat({ ...req, model: cfg.modelFor(p.id) });
    } catch (e) {
      const kind = classify(e);
      if (kind === 'rate_limited' || kind === 'transient') {
        logger.warn('provider failover', { from: p.id, kind });
        continue;                                    // thử provider sau
      }
      throw e;                                       // lỗi của ta → không failover
    }
  }
  throw new AppError('ALL_PROVIDERS_FAILED');
}
```

> **Fallback đổi model, và đổi model đổi chất lượng.** Một provider dự phòng chưa chạy eval không phải "dự phòng" — nó là một hành vi khác mà bạn chưa đo. Xem [01-evaluating-ai-features.md](../05-evaluation/01-evaluating-ai-features.md).

## Khi nào adapter là overengineering

Trả lời thẳng, vì đây là câu hỏi thật:

| Tình huống | Nên làm |
|---|---|
| Prototype, một provider, một route | Gọi SDK trực tiếp. **Không cần adapter.** |
| Một provider, nhiều route trong production | **Cần một tầng mỏng**: mapper finish reason + phân loại lỗi + log usage. Không cần interface đa provider. |
| Có yêu cầu fallback (uptime/rate limit) | Cần interface đầy đủ. |
| Muốn eval nhiều model | Cần interface đầy đủ — eval là lý do tốt nhất. |
| Muốn model routing theo chi phí | Cần interface đầy đủ. |
| "Để sau này dễ đổi provider" | **Chưa cần.** Đây là lý do yếu nhất, và là lý do người ta hay dùng. |

Ranh giới thực dụng:

```text
Tầng mỏng (~100 dòng, gần như luôn đáng làm):
   ✓ mapFinishReason      ✓ classifyError
   ✓ log usage + ttft     ✓ giới hạn output bắt buộc

Interface đa provider (chỉ khi có lý do trong bảng trên):
   ✓ ModelProvider        ✓ nhiều adapter
   ✓ fallback             ✓ routing
```

Tầng mỏng đáng làm ngay cả với một provider, vì bốn thứ trong nó là bốn thứ bạn **cần** bất kể có bao nhiêu provider.

Và một điều thường bị bỏ qua: **multi-provider có chi phí kiểm thử.** Hai provider = hai bộ eval, hai lần regression khi có model mới, hai cách stream, hai kiểu tool-call. Đừng trả giá đó vì một khả năng chưa xảy ra.

## Prediction

1. Mapper của bạn mặc định giá trị lạ thành `'completed'`. Provider thêm lý do dừng mới. Bạn thấy triệu chứng gì?
2. Frontend đọc trực tiếp `res.choices[0].message.content`. Bạn muốn thêm citation. Phải sửa gì?
3. Bạn failover sang provider B khi A trả `400 context too large`. Kết quả?
4. Bạn có adapter đầy đủ nhưng chỉ một provider. Đã bỏ ra công sức đó có đáng?

<details>
<summary>Đáp án</summary>

1. **Không thấy triệu chứng gì rõ ràng** — đó là vấn đề. Output bị cắt hoặc bị chặn được coi là hợp lệ, đi vào database. Bạn phát hiện qua khiếu nại người dùng, không qua log.
2. Sửa cả frontend **và** mọi nơi khác đọc hình dạng đó, đồng thời đây là breaking change với client cũ vì không có version. Với `ChatEvent`, thêm `{ type: 'citation' }` là thay đổi tương thích.
3. **Provider B cũng fail** — context quá lớn là lỗi của *request*, không của provider. Bạn vừa nhân đôi chi phí và latency cho một request chắc chắn thất bại. Đây chính là lý do phân loại lỗi theo retryability tồn tại.
4. **Tầng mỏng: đáng.** Interface đa provider đầy đủ: chưa — trừ khi bạn đang chạy eval nhiều model. Nhưng nó khó bị coi là sai nếu nó nhỏ; cái sai là khi adapter tự bọc lại 40 tính năng của SDK.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Đổi provider = sửa hàng chục file | không có adapter; hình dạng SDK rò rỉ vào nghiệp vụ |
| Output bị cắt được coi là hợp lệ | mapper mặc định `'completed'` |
| Retry cho lỗi không thể retry | không phân loại lỗi theo retryability |
| Frontend hỏng khi backend đổi provider | DTO frontend không tách khỏi provider |
| Fallback làm chất lượng tụt âm thầm | không eval provider dự phòng |
| `providerMeta` xuất hiện trong service nghiệp vụ | abstraction đã rò; adapter không đủ |
| Không so sánh được chi phí giữa model | `usage` không normalize, không log theo `model` |
| Tool call args gây crash | adapter trả `args` đã cast sẵn thay vì `unknown` |

Dòng cuối đáng nói rõ: `toolCall.args` phải có kiểu **`unknown`** khi ra khỏi adapter. Nó do model sinh ra, nên nó phải qua schema validation như mọi output khác. Adapter cast nó thành type nghiệp vụ là bỏ qua bước validate. Và luôn `JSON.parse` chuỗi args — đừng so khớp chuỗi trên nó.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tầng mỏng (mapper + classify + log) | 4 thứ cần thiết, ~100 dòng | gần như không mất gì |
| Interface đa provider | fallback, routing, eval nhiều model | code nhiều hơn; **kiểm thử nhân đôi** |
| Union `ChatEvent` cho FE | exhaustive check; version được | phải thiết kế trước; đổi nghĩa field là breaking |
| `providerMeta` | không mất tính năng riêng của provider | rò rỉ nếu dùng ở nghiệp vụ |
| Fallback tự động | chịu được rate limit / sự cố | chất lượng đổi âm thầm nếu chưa eval |

## Explain Without Notes

1. Ba DTO, ba lý do đổi: provider · application · frontend.
2. Adapter normalize **sáu** thứ, không bọc lại cả SDK.
3. Nhánh `default` của mapper finish reason phải là `'error'`, không phải `'completed'`.
4. Lỗi phân loại theo **retryability**, và `context_too_large` không retry được.
5. Tầng mỏng gần như luôn đáng; interface đa provider chỉ khi có lý do cụ thể — eval là lý do tốt nhất.

## Related

- [Structured output](./03-structured-output.md) — `toolCall.args` là `unknown`
- [LLM request lifecycle](../00-fundamentals/01-llm-request-lifecycle.md) — ba tầng lỗi
- [Streaming](../02-chatbot-web/03-streaming.md) — `ChatEvent` trên dây
- [Versioning & release](../07-production/06-versioning-and-release.md) — model version đổi hành vi
- [Cost & model routing](../07-production/02-cost-and-model-routing.md) — routing cần adapter
- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — eval provider dự phòng
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — DTO tầng ③
- [API versioning & evolution](../../02-backend-api/00-http-api/06-api-versioning-evolution.md)
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [SOLID trong thực tế](../../02-backend-api/04-architecture/06-solid-in-practice.md) — khi abstraction đáng giá
