---
level: intermediate
area: ai-engineering
prerequisites:
  - ../00-fundamentals/01-llm-request-lifecycle.md
related:
  - 02-cost-and-model-routing.md
  - 04-latency-engineering.md
  - ../../05-cross-cutting/observability/README.md
---

# AI observability: nhìn thấy được cái không xác định

> "Chatbot chậm." Đó là toàn bộ báo cáo. Team có log ứng dụng đầy đủ, có APM, có dashboard latency. Nhưng mọi lời gọi AI xuất hiện trong đó dưới dạng **một span duy nhất** tên `POST /api/chat` mất 6.2 giây. Không ai biết 6.2 giây đó là retrieval, là chờ token đầu, là generation, hay là ba tool call tuần tự. Ba ngày điều tra bằng cách thêm log, một câu trả lời trong 30 giây sau khi có trace đúng.

## Position

```text
Mọi note khác trong track sinh ra dữ liệu.
Note này nói dữ liệu đó phải trông thế nào để dùng được.
```

## Problem

AI feature khó quan sát hơn code thường vì ba lý do:

```text
① KHÔNG XÁC ĐỊNH   không reproduce được bằng cách chạy lại
② NHIỀU TẦNG       retrieval + model + tool + validate, mỗi tầng chậm/sai được
③ CÓ CHI PHÍ       "hoạt động đúng" không đủ; còn phải "trong hạn mức"
```

Và một tính chất khiến observability quan trọng hơn bình thường: **bạn không thể debug bằng cách chạy lại.** Với code thường, bạn có input và chạy lại được. Với LLM, chạy lại cho output khác. Nên **cái bạn ghi lúc đó là cái duy nhất bạn có.**

> Với AI feature, observability không phải công cụ để debug. Nó là **điều kiện để debug được**.

## Mental Model

### Một trace, nhiều span — không phải một span

```text
POST /api/chat                                            6.240ms
├─ auth                                                       8ms
├─ rate-limit (redis)                                         3ms
├─ load-conversation (pg)                                     22ms
├─ build-context                                             810ms
│  ├─ embed-query                                             90ms
│  ├─ vector-search                                          140ms
│  ├─ rerank                                                 520ms   ★
│  └─ pack                                                    12ms
├─ llm-call  model=... in=8.204 out=612 cached=6.100        2.980ms
│  └─ ttft                                                   740ms
├─ tool: getOrderById                                        180ms
├─ tool: getRefundPolicy                                      95ms
├─ llm-call (lượt 2)  in=9.100 out=240                     2.010ms
│  └─ ttft                                                   520ms
├─ validate-output                                             4ms
└─ persist (pg)                                               18ms
```

Trace đó trả lời câu hỏi ở đầu note trong vài giây: rerank 520ms là đáng chú ý, và **hai lượt gọi model** là nguyên nhân chính của 6.2 giây.

Đây không phải khái niệm mới — nó là [correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) áp dụng cho một pipeline mới. Điều mới duy nhất là **những trường bạn phải gắn vào span**.

### Trường bắt buộc trên span `llm-call`

```text
NHẬN DIỆN
  requestId · conversationId · userId · orgId · route
  model · promptId · promptVersion            ← thiếu là không truy được regression

TOKEN
  inputTokens · outputTokens · cachedInputTokens
  → cachedInputTokens = 0 liên tục nghĩa là prompt cache không hoạt động

KẾT QUẢ
  finishReason        ← trường quan trọng nhất, và hay bị bỏ nhất
  ttftMs · totalMs
  retryCount

CHI PHÍ
  costUsd (tính từ usage THẬT, không ước lượng)
```

`finishReason` phải là một **dimension trên metric**, không chỉ một field trong log:

```ts
metrics.increment('llm.calls', { route, model, finishReason });
```

Vì với dimension đó, một câu hỏi quan trọng trở thành một truy vấn dashboard: *"bao nhiêu phần trăm câu trả lời bị cắt vì `max_tokens`?"* Không có nó, câu hỏi đó cần một lần grep log.

### Trường bắt buộc trên span retrieval

```text
docIds (đã retrieve và đã PACK — hai danh sách khác nhau)
topScore · scoreAtCutoff
candidateCount · packedCount · packedTokens
embedModel · embedVersion
retrievalMs · rerankMs
```

`docIds` là trường đã được nhắc ba lần trong track này, vì nó là trường duy nhất tách được lỗi retrieval khỏi lỗi generation. Xem [04-rag-failure-modes.md](../03-rag/04-rag-failure-modes.md).

### Trường bắt buộc trên span tool

```text
toolName · decision ('executed'|'denied'|'needs_confirmation'|'failed')
durationMs · argsRedacted
```

`decision` là dimension cho một metric an ninh: chuỗi `denied` tăng vọt nghĩa là ai đó đang thăm dò. Xem [02-tool-security.md](../04-agents-tools/02-tool-security.md).

### Ba tầng dữ liệu, ba mục đích

```text
METRIC (số, dimension thấp, giữ lâu, rẻ)
  llm.calls{route,model,finishReason}
  llm.input_tokens · llm.output_tokens · llm.cost_usd
  llm.ttft_ms · llm.total_ms                    (histogram)
  rag.no_relevant_docs · rag.hallucinated_citation
  tool.calls{name,decision}
  → dùng cho: alert, dashboard, xu hướng

TRACE (một request, có span, lấy mẫu)
  → dùng cho: "request NÀY chậm/sai ở đâu"

SAMPLE (messages + raw output, TTL ngắn, đã redact)
  100% request LỖI + 1% request thành công
  → dùng cho: "model thật sự nhận gì và trả gì"
```

Tầng ba là tầng đặc thù của AI. Với code thường bạn không cần lưu input — bạn chạy lại được. Với LLM, **request đã trôi qua là không lấy lại được**, nên phải lưu ngay.

Nhưng nó chứa dữ liệu người dùng, nên ba quy tắc:

```text
□ TTL ngắn (7–30 ngày), có job dọn theo expires_at
□ REDACT trước khi lưu (email, số điện thoại, thẻ, địa chỉ)
□ Nằm trong checklist xoá dữ liệu người dùng
```

### Đo phần trăm, không đo trung bình

```text
❌ Trung bình chi phí mỗi request = $0.006 → "ổn"
✅ p50 = $0.002 · p95 = $0.031 · p99 = $0.180 · max = $2.40

   → Con số $2.40 là câu hỏi đáng điều tra.
   → Trung bình che nó hoàn toàn.
```

Với AI, phân bố **lệch mạnh hơn** so với latency thường: hội thoại dài, tài liệu lớn, agent lặp — tất cả tạo ra đuôi rất dài. Xem [01-latency-throughput-bottleneck.md](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md).

Và luôn đo **theo chiều**: route, model, promptVersion, org. Chi phí tổng tăng 40% có thể là một org, một route, hoặc một lần đổi prompt.

### Alert đáng có

```text
CHẤT LƯỢNG (không cần người đánh giá)
  rag.hallucinated_citation > 0                   → bug thật
  rag.no_relevant_docs tăng đột ngột              → retrieval hoặc dữ liệu
  llm.finishReason=max_tokens > 2%                → output bị cắt
  llm.invalid_output tăng                         → prompt/model drift

CHI PHÍ
  cost hôm nay > 2× trung bình 7 ngày
  cost của một org/user vượt ngưỡng
  llm.cachedInputTokens ratio giảm mạnh           → cache bị phá

ĐỘ TIN CẬY
  429 rate tăng · 5xx từ provider
  p95 ttft vượt ngưỡng
  tool.decision=denied tăng vọt                   → thăm dò?
  agent stop_reason=NO_PROGRESS tăng              → vòng lặp
```

Nhóm đầu là nhóm đặc biệt: **ba metric đó phát hiện vấn đề chất lượng mà không cần eval hay người đánh giá.** Chúng là thứ nên có trước cả golden dataset.

## Example

```ts
async function tracedLlmCall(req: ChatRequest, ctx: Ctx): Promise<ChatResult> {
  return tracer.startActiveSpan('llm-call', async (span) => {
    span.setAttributes({
      'ai.model': req.model,
      'ai.prompt.id': req.promptId,
      'ai.prompt.version': req.promptVersion,
      'ai.route': ctx.route,
      'ai.request_id': ctx.requestId,
    });

    const t0 = Date.now();
    try {
      const res = await provider.chat(req);
      const cost = price(req.model, res.usage);

      span.setAttributes({
        'ai.tokens.input': res.usage.inputTokens,
        'ai.tokens.output': res.usage.outputTokens,
        'ai.tokens.cached_input': res.usage.cachedInputTokens ?? 0,
        'ai.finish_reason': res.finishReason,
        'ai.ttft_ms': res.ttftMs ?? -1,
        'ai.cost_usd': cost,
      });

      // metric có dimension → dashboard trả lời được câu hỏi
      const tags = { route: ctx.route, model: req.model, finishReason: res.finishReason };
      metrics.increment('llm.calls', tags);
      metrics.histogram('llm.input_tokens', res.usage.inputTokens, tags);
      metrics.histogram('llm.ttft_ms', res.ttftMs ?? 0, tags);
      metrics.histogram('llm.cost_usd', cost, tags);

      // sample: 100% lỗi + 1% thành công
      if (res.finishReason !== 'completed' || Math.random() < 0.01) {
        await traceSamples.save({
          requestId: ctx.requestId,
          messages: redact(req.messages),
          rawOutput: redact(res.text),
          expiresAt: addDays(new Date(), 14),
        });
      }

      return res;
    } catch (e) {
      span.recordException(e as Error);
      metrics.increment('llm.errors', { route: ctx.route, kind: classify(e) });
      throw e;
    } finally {
      span.setAttribute('ai.total_ms', Date.now() - t0);
      span.end();
    }
  });
}
```

Nguyên tắc trong đoạn trên: **mọi thứ ghi lại là ghi trong `finally` hoặc ngay sau khi có kết quả** — không ghi ở nhánh thành công rồi quên nhánh lỗi. Nhánh lỗi là nhánh bạn cần dữ liệu nhất.

## Prediction

1. Bạn có một span duy nhất cho cả `/api/chat`. Người dùng báo chậm. Bạn biết gì?
2. Bạn không log `finishReason`. Bao nhiêu phần trăm câu trả lời bị cắt? Trả lời được không?
3. Bạn đo trung bình chi phí và nó ổn định. Một org có hội thoại 400 lượt. Bạn thấy không?
4. Bạn không lưu sample. Một câu trả lời sai được báo về sau 3 ngày. Bạn điều tra thế nào?
5. `cachedInputTokens` bằng 0 trên mọi request. Nghĩa là gì, và ai bị ảnh hưởng?

<details>
<summary>Đáp án</summary>

1. Chỉ biết **tổng thời gian**. Không biết retrieval, TTFT, generation, hay tool là nút thắt — nên bạn sẽ đoán và tối ưu sai chỗ.
2. **Không trả lời được** mà không grep log. Và nếu không log gì, không trả lời được. Với `finishReason` là dimension, đó là một truy vấn dashboard.
3. **Không thấy** — trung bình bị chi phối bởi đa số hội thoại ngắn. Phải xem p95/p99 và chi phí theo org.
4. Bạn **không điều tra được**. Chạy lại cho output khác; context lúc đó (docIds, promptVersion, history) đã trôi qua. Đây là lý do sample tồn tại.
5. Prompt cache **không hoạt động** — thường vì có biến động (timestamp, UUID) trong phần đầu prompt, hoặc thứ tự tool không xác định. Ảnh hưởng: chi phí input cao hơn nhiều lần mức cần thiết.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| "Chatbot chậm", không biết chậm ở đâu | một span cho cả request |
| Không biết tỉ lệ output bị cắt | `finishReason` không phải dimension |
| Hoá đơn tăng, không biết ở đâu | không đo cost theo route/model/org |
| Không điều tra được lỗi đã báo | không lưu sample; không lưu `docIds` |
| Không tách được lỗi retrieval vs generation | không log `docIds` |
| Chi phí đuôi rất cao mà không ai biết | đo trung bình thay vì p95/p99 |
| Prompt cache không hoạt động mà không ai biết | không đo `cachedInputTokens` |
| Regression sau đổi prompt, không truy được | không log `promptVersion` |
| Sample chứa dữ liệu cá nhân, giữ vô hạn | không redact, không TTL |
| Vấn đề chất lượng phát hiện qua khiếu nại | thiếu 3 metric chất lượng tự động |

## Debugging

```text
1. Mở trace của một request chậm/sai → span nào chiếm thời gian?
2. finishReason của request lỗi?
3. docIds → tài liệu đúng có trong đó?
4. So promptVersion của request lỗi với version hiện tại
5. Đọc sample: messages thật sự gửi đi là gì?
6. cachedInputTokens ratio theo route → cache có hoạt động?
7. Cost p99 theo org → ai ở đuôi phân bố?
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Trace chi tiết mọi span | debug được ngay | overhead nhỏ; lấy mẫu để giảm |
| Lưu sample 1% + 100% lỗi | điều tra được | lưu trữ; rủi ro dữ liệu → cần redact + TTL |
| Lưu sample 100% | điều tra tối đa | tăng trưởng lớn; rủi ro dữ liệu cao |
| Không log nội dung | bề mặt rò rỉ nhỏ | debug khó hơn — bù bằng sample có kiểm soát |
| Metric nhiều dimension | trả lời được nhiều câu hỏi | chi phí lưu metric (cardinality) |
| Alert chất lượng tự động | phát hiện sớm, không cần người | có thể nhiễu lúc đầu; cần hiệu chỉnh ngưỡng |

## Explain Without Notes

1. Với AI, không chạy lại được → **cái bạn ghi lúc đó là cái duy nhất bạn có**.
2. Một trace nhiều span: retrieval · rerank · llm(+ttft) · tool · validate · persist.
3. Ba trường không thể thiếu: `finishReason`, `docIds`, `usage` (kèm `cachedInputTokens`).
4. Đo p95/p99, và theo chiều route/model/promptVersion/org — không đo trung bình.
5. Ba metric chất lượng tự động (citation bịa, no-relevant-docs, max_tokens) đáng có trước cả golden dataset.

## Related

- [LLM request lifecycle](../00-fundamentals/01-llm-request-lifecycle.md) — chín trạm, mỗi trạm một span
- [Cost & model routing](./02-cost-and-model-routing.md) — dùng dữ liệu này để tối ưu
- [Latency engineering](./04-latency-engineering.md) — TTFT vs total từ trace
- [AI caching](./03-ai-caching.md) — `cachedInputTokens`
- [Failure handling](./05-failure-handling.md) — phân loại lỗi để làm dimension
- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — metric online
- [RAG failure modes](../03-rag/04-rag-failure-modes.md) — vì sao cần `docIds`
- [Logs, metrics, traces](../../05-cross-cutting/observability/01-logs-metrics-traces.md)
- [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md)
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md)
- [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md)
