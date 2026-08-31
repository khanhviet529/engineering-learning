---
level: beginner
area: ai-engineering
prerequisites:
  - 00-ai-vocabulary.md
related:
  - 02-ai-application-architecture.md
  - ../01-context-and-output/04-provider-adapter-and-dto.md
  - ../07-production/05-failure-handling.md
---

# LLM request lifecycle

> Một tính năng "tóm tắt hội thoại" chạy tốt hai tuần rồi bắt đầu lỗi rải rác. Log ứng dụng chỉ có `SyntaxError: Unexpected end of JSON input`. Team sửa parser, thêm `try/catch`, lỗi vẫn còn. Nguyên nhân thật: hội thoại dài dần, output chạm `max_tokens`, model bị **cắt giữa câu** — và provider trả về HTTP **200** kèm `finish_reason` cho biết điều đó. Không ai đọc field đó.

## Position

```text
Browser → Backend của bạn → [ LIFECYCLE NÀY ] → Provider → ... → Browser
                                   ▲
                    note này mở hộp đen ở giữa
```

## Problem

Với người mới, gọi LLM trông như một dòng code:

```ts
const answer = await llm.chat(userMessage);
```

Và vì nó trông như một dòng, người ta xử lý nó như một dòng: không timeout, không kiểm tra finish reason, không đo token, không phân loại lỗi. Rồi bốn nhóm sự cố xuất hiện, tất cả đều **không** có dấu vết trong log nếu bạn không chủ động ghi:

```text
① Output bị cắt giữa câu     → HTTP 200, parse lỗi ở chỗ khác
② Request quá lớn            → HTTP 400, nhưng chỉ với một số user
③ Provider chậm hoặc 429     → request treo, hoặc retry làm tệ thêm
④ Hoá đơn tăng gấp ba        → không ai biết tăng ở endpoint nào
```

Cả bốn đều là **hệ quả của việc không nhìn thấy lifecycle**.

## Mental Model

### Chín trạm của một LLM request

```text
① Application            có dữ liệu thô: user input, history, tài liệu
        ↓
② Build context          chọn / lọc / xếp thứ tự / cắt → messages[]
        ↓
③ Serialize request      messages + tools + max_tokens + model
        ↓  ─────── mạng, TLS, xác thực ───────
④ Provider nhận          xác thực, kiểm quota, kiểm kích thước
        ↓
⑤ Inference              sinh token, TỪNG CÁI MỘT
        ↓  ─────── streaming trả về dần ở đây ───────
⑥ Provider response      content + finish_reason + usage
        ↓
⑦ Validate / normalize   finish reason OK? parse được? đúng schema?
        ↓
⑧ Persist                lưu message, usage, trace
        ↓
⑨ Application result     DTO trả cho frontend
```

Điều đáng nhớ: **bạn sở hữu trạm ②, ⑦, ⑧, ⑨.** Đó là bốn chỗ duy nhất bạn kiểm soát được, và cũng là bốn chỗ hầu hết code tích hợp LLM bỏ trống.

### Trạm ⑤ nhìn kỹ hơn: vì sao output dài thì chậm

Model sinh token **tuần tự** — mỗi token cần một lượt chạy, và lượt sau phụ thuộc lượt trước.

```text
Input:   xử lý được SONG SONG    ⇒ 10k token input ≈ nhanh
Output:  buộc phải TUẦN TỰ       ⇒ 1k token output ≈ chậm hơn nhiều
```

Đây là lý do vật lý của hai điều bạn sẽ gặp suốt track này:

```text
TTFT (time to first token)  ← chi phối bởi ĐỘ DÀI INPUT + tải provider
total latency               ← chi phối bởi ĐỘ DÀI OUTPUT
```

Và là lý do **giới hạn output** vừa tiết kiệm tiền vừa giảm latency, trong khi cắt input chỉ giúp TTFT.

### Ba tầng lỗi, ba cách xử lý khác nhau

Đây là phần quan trọng nhất của note. Ba tầng lỗi trông giống nhau trong `try/catch` nhưng cần xử lý hoàn toàn khác:

```text
TẦNG A — LỖI TRANSPORT / HTTP
   429 rate limit · 5xx · timeout · connection reset
   → HTTP status khác 2xx, SDK ném exception
   → RETRY được (với backoff + jitter)

TẦNG B — LỖI HỢP LỆ CỦA REQUEST
   400 context too large · 400 schema sai · 401 key sai
   → HTTP 4xx, SDK ném exception
   → RETRY VÔ ÍCH. Phải sửa request hoặc sửa code.

TẦNG C — "THÀNH CÔNG" NHƯNG KHÔNG DÙNG ĐƯỢC     ← tầng bị bỏ qua
   HTTP 200, nhưng:
     · finish_reason = chạm max_tokens  → output bị cắt
     · finish_reason = bị chặn/từ chối  → không có nội dung
     · output không parse được thành JSON
     · output parse được nhưng sai schema
   → SDK KHÔNG ném gì. Bạn phải tự kiểm.
```

Tầng C là nơi sự cố ở đầu note sống. Nó không xuất hiện trong bất kỳ dashboard lỗi nào cho tới khi bạn tự tạo ra metric cho nó.

```ts
// ❌ Chỉ bắt tầng A và B
try {
  const res = await provider.chat(messages);
  return JSON.parse(res.text);        // tầng C nổ ở đây, lỗi nói về JSON
} catch (e) {
  logger.error('LLM failed', e);      // và log nói sai nguyên nhân
}

// ✅ Kiểm tầng C tường minh
const res = await provider.chat(messages);

if (res.finishReason === 'max_tokens') {
  metrics.increment('llm.truncated', { route });
  throw new AppError('LLM_OUTPUT_TRUNCATED', { requestId: res.id });
}
if (res.finishReason === 'blocked') {
  throw new AppError('LLM_CONTENT_BLOCKED', { requestId: res.id });
}
```

Hai điều cần chú ý trong đoạn trên: lỗi có **`code` máy đọc được** và có **`requestId`** — đúng error model mà repo này đã dạy ở [05-error-model.md](../../02-backend-api/00-http-api/05-error-model.md). AI không phải ngoại lệ; nó chỉ thêm một tầng lỗi mới.

### Streaming vs non-streaming ở tầng lifecycle

```text
NON-STREAMING
  request ──────────────── chờ ──────────────▶ toàn bộ response
  · đơn giản: một object, có finish_reason và usage ngay
  · người dùng thấy: không gì, trong nhiều giây
  · rủi ro: output dài có thể chạm HTTP timeout của SDK/proxy

STREAMING
  request ──▶ chunk ─▶ chunk ─▶ chunk ─▶ ... ─▶ sự kiện kết thúc
  · người dùng thấy chữ sau ~TTFT
  · finish_reason và usage tới Ở CUỐI — không có sẵn khi bắt đầu
  · phức tạp hơn: phải xử lý ngắt giữa dòng, huỷ, ghép lại
```

Điểm gây bug nhiều nhất: với streaming, **bạn không biết request có thành công cho tới khi stream kết thúc.** Một stream ngắt ở token thứ 300 trông giống một câu trả lời ngắn. Chi tiết: [03-streaming.md](../02-chatbot-web/03-streaming.md).

Một điều thực dụng nữa: với `max_tokens` lớn, streaming **không chỉ để UX** — nó tránh việc request bị timeout ở tầng HTTP trước khi model kịp sinh xong.

## Example

Đây là hình dạng tối thiểu của một lời gọi LLM **đúng** trong backend. Không phải SDK cụ thể nào — đây là những gì mọi lời gọi cần có:

```ts
async function callModel(input: BuildContextInput): Promise<ModelResult> {
  const messages = buildContext(input);              // ② — có budget, xem 01-context-and-output/02

  const started = Date.now();
  const res = await withTimeout(
    provider.chat({
      model: cfg.model,                              // ③ — model từ config, KHÔNG hard-code
      messages,
      maxOutputTokens: cfg.maxOutput,                //     giới hạn output tường minh
    }),
    cfg.timeoutMs,                                   // luôn có timeout
  );

  // ⑦ validate — tầng C
  assertUsableFinishReason(res.finishReason, res.id);
  const parsed = OutputSchema.safeParse(tryParse(res.text));
  if (!parsed.success) {
    metrics.increment('llm.invalid_output', { route: input.route });
    throw new AppError('LLM_INVALID_OUTPUT', { requestId: res.id });
  }

  // ⑧ observability — không phải tuỳ chọn
  logger.info('llm.call', {
    requestId: res.id,
    route: input.route,
    model: cfg.model,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    cachedInputTokens: res.usage.cachedInputTokens,
    finishReason: res.finishReason,
    ttftMs: res.ttftMs,
    totalMs: Date.now() - started,
  });

  return { data: parsed.data, usage: res.usage };    // ⑨
}
```

Đọc lại đoạn trên và đếm: **timeout, giới hạn output, kiểm finish reason, validate schema, log usage.** Năm thứ đó là khác biệt giữa một prototype và một tính năng chạy được ở production. Không có cái nào trong số đó là về AI — chúng là kỷ luật tích hợp dịch vụ bên ngoài, đúng như [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) đã dạy.

## Prediction

Trả lời trước khi đọc phần sau.

1. Bạn tăng `max_tokens` từ 500 lên 4000. TTFT thay đổi thế nào? Total latency thế nào? Chi phí thế nào?
2. Bạn thêm 50KB tài liệu RAG vào mỗi request. TTFT thay đổi thế nào? Total?
3. Hội thoại dài dần theo thời gian. Lỗi đầu tiên bạn sẽ gặp là gì — và ở HTTP status nào?
4. Provider trả về `429`. Retry ngay lập tức 3 lần. Chuyện gì xảy ra với hệ thống?
5. Với streaming, người dùng đóng tab ở giây thứ 2 của một generation 10 giây. Bạn có bị tính tiền không? Bạn có lưu gì không?

<details>
<summary>Đáp án</summary>

1. **TTFT gần như không đổi** (`max_tokens` chỉ là giới hạn trên, không phải công việc phải làm). **Total tăng** nếu model thật sự sinh dài hơn. **Chi phí tăng** theo số token sinh thực tế, không theo `max_tokens`.
2. **TTFT tăng** (input dài hơn phải xử lý trước khi sinh token đầu). **Total tăng theo TTFT**, nhưng phần generation không đổi. Và chi phí input tăng mỗi request — 50KB × mọi request là nguồn hoá đơn bất ngờ phổ biến nhất.
3. Không phải lỗi cắt output trước — mà là **`400 context too large`**, khi `system + history + RAG` vượt cửa sổ. Đây là tầng B: retry vô ích, phải cắt/tóm tắt history.
4. Retry ngay làm **tăng tải lên provider đang quá tải**, và nếu nhiều instance cùng làm thì tất cả retry đồng thời. Cần **backoff + jitter**, và tôn trọng `Retry-After` nếu provider gửi.
5. **Bạn vẫn bị tính tiền** phần đã sinh — huỷ ở phía client không dừng inference nếu bạn không abort request về provider. Và nếu bạn chỉ lưu ở lúc stream kết thúc thành công, bạn **mất toàn bộ** phần đã sinh. Xem [03-streaming.md](../02-chatbot-web/03-streaming.md).

</details>

## Failure Modes

| Triệu chứng | Trạm | Nguyên nhân |
|---|---|---|
| `Unexpected end of JSON input` rải rác | ⑦ | output chạm `max_tokens`, không kiểm finish reason |
| `400 context too large` chỉ với một số user | ② | history dài, hoặc tài liệu RAG lớn, không có token budget |
| Request treo vô hạn | ③ | không đặt timeout |
| `429` dồn dập sau khi scale lên 3 instance | ④ | rate limit là của **cả tổ chức**, không phải per-instance |
| Hoá đơn tăng gấp ba, không rõ vì sao | ⑧ | không log `usage` theo route |
| Output hợp lệ nhưng thiếu field | ⑦ | parse được ≠ đúng schema; thiếu validate |
| Latency p99 tệ hơn nhiều p50 | ⑤ | output dài ở đuôi phân bố; hoặc provider throttle |
| Chạy tốt ở dev, chậm ở production | ② | context ở production lớn hơn nhiều (history thật, tài liệu thật) |
| Stream dừng giữa câu, không có lỗi | ⑥ | kết nối ngắt; không phân biệt được với "trả lời ngắn" |

## Debugging

Thứ tự kiểm tra khi một AI feature "hỏng":

```text
1. finish_reason là gì?          ← 40% sự cố dừng ở đây
2. usage.input_tokens bao nhiêu?  so với cửa sổ của model?
3. usage.output_tokens có bằng đúng max_tokens? → bị cắt
4. HTTP status là gì? 4xx (sửa request) hay 5xx/429 (retry)?
5. TTFT hay total chậm? → input dài hay output dài?
6. So sánh messages[] thật sự gửi đi với cái bạn NGHĨ đã gửi
```

Bước 6 là bước hay bị bỏ và hay ra kết quả nhất: **log lại toàn bộ `messages` đã gửi** (có redact dữ liệu nhạy cảm) cho một sample request. Rất nhiều bug "model không tuân theo instruction" thực ra là "instruction không có trong request" — bị một bước build context ghi đè hoặc cắt mất.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Streaming | TTFT thấp, UX tốt, tránh HTTP timeout | phức tạp: huỷ, ngắt giữa dòng, `usage` tới cuối |
| Non-streaming | đơn giản, có `finish_reason` + `usage` ngay | người dùng chờ trong im lặng; rủi ro timeout với output dài |
| `max_tokens` cao | không bị cắt | latency và chi phí đuôi cao hơn |
| `max_tokens` thấp | chi phí dự đoán được | output bị cắt — **phải** xử lý tầng C |
| Timeout ngắn | không treo tài nguyên | huỷ oan những request chậm-nhưng-sẽ-thành-công |
| Retry tự động | chịu được lỗi tạm | nhân đôi chi phí; nguy hiểm nếu request có side effect |

## Explain Without Notes

Giải thích cho một đồng nghiệp trong 3 phút:

1. Một LLM request đi qua chín trạm; bạn chỉ sở hữu bốn.
2. Có **ba** tầng lỗi, không phải một — và tầng nguy hiểm nhất trả về HTTP 200.
3. TTFT do input quyết định, total do output quyết định.
4. Năm thứ mọi lời gọi phải có: timeout, giới hạn output, kiểm finish reason, validate schema, log usage.

## Related

- [Từ vựng AI](./00-ai-vocabulary.md) — token, context window, finish reason
- [AI application architecture](./02-ai-application-architecture.md) — chín trạm này nằm ở đâu trong hệ thống
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — normalize finish reason giữa các provider
- [Structured output](../01-context-and-output/03-structured-output.md) — trạm ⑦ chi tiết
- [Context engineering](../01-context-and-output/02-context-engineering.md) — trạm ② chi tiết
- [Streaming](../02-chatbot-web/03-streaming.md) — lifecycle khi response tới dần
- [Failure handling](../07-production/05-failure-handling.md) — phân loại retryability
- [AI observability](../07-production/01-ai-observability.md) — trạm ⑧
- [Error model](../../02-backend-api/00-http-api/05-error-model.md) — `code` + `requestId`, áp dụng nguyên vẹn
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — backoff + jitter
