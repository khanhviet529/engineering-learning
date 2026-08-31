---
level: intermediate
area: ai-engineering
prerequisites:
  - ../00-fundamentals/01-llm-request-lifecycle.md
related:
  - 04-provider-adapter-and-dto.md
  - ../06-safety/02-untrusted-model-output.md
  - ../../02-backend-api/00-http-api/00-api-vocabulary.md
---

# Structured output: đưa output của model vào code

> Một tính năng trích xuất hoá đơn chạy 40.000 lần không lỗi. Lần thứ 40.001, model trả về JSON kèm một dòng giải thích ở đầu: *"Dựa trên hoá đơn, đây là dữ liệu:"*. `JSON.parse` ném lỗi, exception không được bắt ở đúng tầng, và job import dừng — sau khi đã ghi 1.200 dòng vào database. Không có transaction bao quanh, vì không ai nghĩ bước parse có thể lỗi.

## Position

```text
Model output (TEXT)
      ↓
   ┌──────────────────────────┐
   │  parse                   │
   │  schema validate         │  ← note này
   │  normalize               │
   └──────────────────────────┘
      ↓
Application DTO  →  business logic
```

## Problem

Model trả về **text**. Code của bạn cần **dữ liệu có kiểu**. Khoảng giữa hai thứ đó là nơi AI feature hỏng nhiều nhất, vì nó vi phạm một giả định mà mọi developer đều mang theo:

```text
Giả định: cùng input → cùng hình dạng output
Thực tế:  model là stochastic. Hình dạng output cũng stochastic.
```

Nghĩa là: **99.9% đúng vẫn là một bug**, chỉ là bug xuất hiện mỗi 1000 request.

Và nguyên tắc trung tâm của note này:

> **Output của LLM là input không đáng tin.** Đối xử với nó y như bạn đối xử với body của một HTTP request từ Internet: parse, validate, normalize — rồi mới dùng.

Đây không phải phép ẩn dụ. Nó *thật sự* là dữ liệu chịu ảnh hưởng của người dùng, vì người dùng viết input cho model. Xem [02-untrusted-model-output.md](../06-safety/02-untrusted-model-output.md).

## Mental Model

### Bốn mức ràng buộc output, từ yếu đến mạnh

```text
① TEXT TỰ DO
   "hãy trả lời câu hỏi"
   → không parse được. Chỉ dùng khi output ĐI THẲNG cho người đọc.

② YÊU CẦU JSON TRONG PROMPT
   "chỉ trả về JSON đúng schema này"
   → hoạt động phần lớn thời gian. Vẫn hỏng: markdown fence,
     text mở đầu, trailing comma, field thiếu.

③ CHẾ ĐỘ JSON CỦA PROVIDER
   "json mode" — provider đảm bảo output là JSON HỢP LỆ
   → hết lỗi cú pháp. VẪN có thể sai schema: thiếu field, sai enum.

④ SCHEMA-CONSTRAINED (structured output / strict tool)
   provider ràng buộc theo JSON Schema bạn cung cấp
   → hình dạng được đảm bảo. VẪN phải validate ở app.
```

Điều phải nói rõ về mức ④, vì đây là chỗ người ta dừng sai:

> **Đảm bảo hình dạng không phải đảm bảo tính đúng đắn.** Schema đảm bảo `orderId` là string. Nó **không** đảm bảo đơn hàng đó tồn tại, thuộc về user này, hay đang ở trạng thái cho phép. Kiểm tra nghiệp vụ vẫn hoàn toàn thuộc về bạn.

Vì vậy: **luôn validate lại ở tầng application**, kể cả với mức ④. Chi phí là vài microsecond; cái nó chặn là dữ liệu rác đi vào database.

### Pipeline bảy bước

```text
raw text
   ↓ ① kiểm FINISH REASON        ← trước tiên. Bị cắt thì không parse.
   ↓ ② bóc vỏ                    ```json fence, text mở đầu/kết
   ↓ ③ parse                     JSON.parse trong try/catch
   ↓ ④ validate schema           zod / class-validator
   ↓ ⑤ kiểm ràng buộc nghiệp vụ  id tồn tại? quyền? trạng thái?
   ↓ ⑥ normalize                 trim, ép kiểu, giá trị mặc định
   ↓ ⑦ → DTO của application
```

Bước ① là bước quan trọng nhất và bị bỏ nhiều nhất. **JSON bị cắt giữa dòng là JSON không hợp lệ** — và triệu chứng lại xuất hiện ở bước ③, khiến bạn đi sửa parser.

```ts
// Bước ① — kiểm trước khi parse
if (res.finishReason === 'max_tokens') {
  // KHÔNG parse. Đây không phải lỗi JSON.
  throw new AppError('LLM_OUTPUT_TRUNCATED', { requestId: res.id });
}
```

### Bước ② — bóc vỏ: cần thiết ở mức ②, không cần ở mức ④

```ts
function extractJson(text: string): string {
  const t = text.trim();
  // ```json ... ``` hoặc ``` ... ```
  const fence = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fence) return fence[1].trim();
  // text mở đầu: lấy từ dấu { hoặc [ đầu tiên tới ký tự đóng cuối cùng
  const start = t.search(/[[{]/);
  if (start > 0) {
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (end > start) return t.slice(start, end + 1);
  }
  return t;
}
```

Hàm này là **cái vá**, không phải giải pháp. Nếu bạn thấy mình mở rộng nó bằng heuristic thứ tư, hãy chuyển sang mức ③ hoặc ④.

### Bước ④ — schema là nguồn sự thật duy nhất

Định nghĩa schema **một lần**, dùng cho cả prompt và validation. Hai bản định nghĩa sẽ lệch nhau, và ngày chúng lệch là ngày bug xuất hiện.

```ts
const InvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  issuedAt: z.string().date(),                        // ISO 8601
  currency: z.enum(['VND', 'USD', 'EUR']),            // enum ĐÓNG
  totalMinorUnits: z.number().int().nonnegative(),    // tiền = số nguyên
  lines: z.array(z.object({
    description: z.string(),
    quantity: z.number().int().positive(),
    unitPriceMinorUnits: z.number().int().nonnegative(),
  })).min(1),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
});

// CÙNG một schema sinh ra ràng buộc gửi cho provider
const jsonSchema = zodToJsonSchema(InvoiceSchema);
```

Ba lựa chọn thiết kế trong schema trên đáng chú ý:

```text
① currency là ENUM ĐÓNG      → model không trả về "đồng", "vnđ", "VN Dong"
② tiền là SỐ NGUYÊN minor unit → không bao giờ float cho tiền
③ có needsReview + confidence  → model có ĐƯỜNG RA khi không chắc
```

Mục ② dùng lại nguyên nguyên tắc ở [08-money-decimal.md](../../03-database/03-data-modeling/08-money-decimal.md) — LLM không phải ngoại lệ, và model rất hay trả `1234.56` cho tiền.

Mục ③ là mục quan trọng nhất về chất lượng: **cho model một cách nói "tôi không biết"**. Không có nó, nó sẽ đoán, và cái đoán trông giống dữ liệu thật.

### Bước ⑤ — ràng buộc nghiệp vụ: schema không thay thế được

```ts
// Schema nói: orderId là string. Chỉ vậy.
// Những câu này schema KHÔNG trả lời được:
const order = await orders.findUnique({ where: { id: parsed.orderId } });
if (!order) throw new AppError('LLM_REFERENCED_UNKNOWN_ORDER');
if (order.userId !== ctx.userId) throw new ForbiddenError();   // ← phân quyền
if (!CANCELLABLE.includes(order.status)) throw new ConflictError();
```

Đoạn trên là ranh giới giữa một demo và một hệ thống. Model **đề xuất** một `orderId`; application **kiểm tra** nó. Xem [02-tool-security.md](../04-agents-tools/02-tool-security.md).

### Partial output khi streaming

Với streaming, JSON tới **từng mẩu** — và JSON dở dang không parse được:

```text
chunk 1: {"invoiceNu
chunk 2: mber":"INV-1
chunk 3: 001","curren
```

Ba cách xử lý, chọn theo nhu cầu:

| Cách | Cách làm | Khi nào |
|---|---|---|
| **Đợi hết** | ghép rồi parse một lần | mặc định — đơn giản, đúng |
| **Stream text, JSON ở cuối** | phần người đọc stream, phần cấu trúc cuối | chatbot có citation |
| **Partial JSON parser** | parser chịu được JSON dở | UI cần render dần từng field |

Mặc định nên là **đợi hết**. Nếu output là JSON để đưa vào code, người dùng không có gì để đọc dần — streaming chỉ thêm phức tạp mà không thêm giá trị.

### Fallback: bốn bậc, theo thứ tự chi phí

```text
① RETRY nguyên xi                 lỗi ngẫu nhiên → thường hết
② RETRY kèm thông báo lỗi         "output trước sai schema: <lỗi>. Sửa lại."
③ RETRY với model mạnh hơn        model nhỏ hay sai format
④ DEGRADE                        trả 'cần người xem' — KHÔNG bịa dữ liệu
```

Hai điều bắt buộc về retry ở đây:

**Số lần retry phải có trần** (thường 1–2). Không có trần là một vòng lặp tốn tiền thật.

**Bậc ④ không phải thất bại — nó là thiết kế đúng.** Trả về "không xử lý được, cần người xem" tốt hơn nhiều so với ghi dữ liệu sai vào database. Xem [07-human-in-the-loop.md](../07-production/07-human-in-the-loop.md).

```ts
async function extractInvoice(doc: string): Promise<Result<Invoice>> {
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const res = await provider.chat(buildMessages(doc, lastError));
    if (res.finishReason === 'max_tokens') { lastError = 'output bị cắt'; continue; }

    const parsed = InvoiceSchema.safeParse(tryParse(extractJson(res.text)));
    if (parsed.success) {
      metrics.increment('extract.ok', { attempt });
      return ok(parsed.data);
    }
    lastError = formatZodError(parsed.error);
    metrics.increment('extract.invalid_output', { attempt });
  }
  metrics.increment('extract.degraded');
  return needsHumanReview();                     // ← bậc ④, không phải throw
}
```

## Prediction

1. Bạn dùng structured output của provider (mức ④). Còn cần `zod` validate ở app không? Vì sao?
2. Model trả về `{"total": 1234.56}` cho tiền VND. Schema là `z.number()`. Lỗi sẽ xuất hiện ở đâu?
3. Bạn retry vô hạn khi output sai schema. Điều gì xảy ra khi provider có sự cố làm mọi output sai?
4. Bạn thêm một field bắt buộc vào schema nhưng quên cập nhật prompt. Kết quả?
5. Output JSON của bạn thường dài 3000 token. `max_tokens` đặt 2048. Bao lâu thì bạn phát hiện?

<details>
<summary>Đáp án</summary>

1. **Vẫn cần.** Ba lý do: (a) đảm bảo hình dạng ≠ đảm bảo nghiệp vụ; (b) schema bạn gửi và schema bạn validate có thể lệch nếu không sinh từ cùng nguồn; (c) khi bạn đổi provider hoặc fallback sang mức thấp hơn, validation là thứ duy nhất còn lại.
2. Nếu schema là `z.number()` thì **nó pass** — và `1234.56` VND đi vào database. Lỗi xuất hiện sau đó ở kế toán, không ở parser. Dùng `z.number().int()` cho minor unit.
3. Vòng lặp tốn tiền thật, và khuếch đại tải lên provider đang lỗi. Retry phải có **trần** và nên có **circuit breaker**.
4. Nếu ở mức ④ với schema sinh từ cùng nguồn: provider tự ràng buộc, có thể vẫn đúng. Nếu ở mức ②: model **không biết** field mới, mọi request fail validation → tỉ lệ degrade 100%. Đây là lý do schema phải là nguồn sự thật duy nhất.
5. Nếu không kiểm `finishReason`: bạn phát hiện qua log `JSON.parse` lỗi — và có thể mất nhiều ngày vì bạn sẽ đi sửa parser. Nếu có kiểm: **ngay lần đầu**, với `code = LLM_OUTPUT_TRUNCATED`.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| `Unexpected token ` ở đầu | model thêm text mở đầu, hoặc markdown fence |
| `Unexpected end of JSON input` | chạm `max_tokens` — **không phải lỗi parser** |
| Parse OK nhưng field thiếu | không validate schema, chỉ `JSON.parse` |
| Enum có giá trị lạ (`"vnđ"`) | enum không đóng trong prompt/schema |
| Tiền có phần thập phân | schema dùng `number` thay vì `int` minor unit |
| Ngày tháng lệch múi giờ | không ràng buộc ISO 8601; model trả `"12/03/2026"` |
| Tỉ lệ lỗi tăng sau khi provider cập nhật model | prompt/format tinh chỉnh cho version cũ |
| Job import dừng giữa, dữ liệu ghi một nửa | parse ném lỗi ngoài transaction |
| Chi phí gấp đôi âm thầm | retry không có trần, hoặc retry mặc định của SDK |
| Model bịa `orderId` trông rất hợp lý | thiếu bước ⑤; và thiếu `needsReview` để nó nói "không biết" |

Dòng "job import dừng giữa" là bài học kiến trúc, không phải bài học AI: **bước parse là một bước có thể thất bại, nên nó phải nằm trong cùng ranh giới giao dịch với bước ghi** — hoặc ghi phải idempotent để chạy lại được. Xem [04-prisma-transactions.md](../../03-database/05-data-access/04-prisma-transactions.md).

## Debugging

```text
1. finishReason = ?                    → bị cắt thì dừng ở đây
2. Log RAW text output (đã redact)      → xem model thật sự trả gì
3. Chạy schema.safeParse trên raw đó    → lỗi validation cụ thể là gì
4. So field lỗi với prompt              → prompt có nói về field đó không?
5. Đo tỉ lệ theo route + promptVersion  → mới hỏng hay hỏng từ đầu?
```

Bước 2 là bước không thể thiếu: **nếu bạn không log raw output, bạn đang debug bằng cách đoán.** Lưu raw output cho các request lỗi (có TTL và có redact) là đầu tư nhỏ nhất với lợi ích lớn nhất trong track này.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Mức ④ schema-constrained | hình dạng đảm bảo, ít retry | phụ thuộc provider; schema phức tạp có thể bị hạn chế |
| Mức ② prompt-only | dùng được với mọi provider/model | tỉ lệ lỗi cao hơn; cần bóc vỏ + retry |
| Schema chặt (enum đóng, int, min/max) | bắt lỗi sớm, dữ liệu sạch | validation fail nhiều hơn → cần fallback tốt |
| Schema lỏng | ít fail | dữ liệu rác vào DB — **luôn tệ hơn** |
| Retry với thông báo lỗi | tỉ lệ thành công cao hơn rõ | nhân đôi chi phí + latency cho request đó |
| Degrade sang người xem | không bao giờ ghi dữ liệu sai | cần quy trình cho người xem |

## Explain Without Notes

1. Output của LLM là **input không đáng tin** — parse, validate, normalize như body HTTP từ Internet.
2. Bốn mức ràng buộc; mức cao nhất đảm bảo **hình dạng**, không đảm bảo **tính đúng đắn**.
3. Kiểm `finishReason` **trước** khi parse — JSON bị cắt là lỗi `max_tokens`, không phải lỗi parser.
4. Schema là nguồn sự thật duy nhất, sinh ra cả ràng buộc gửi provider và validation ở app.
5. Cho model đường ra (`needsReview`), và cho hệ thống đường ra (degrade sang người xem).

## Related

- [LLM request lifecycle](../00-fundamentals/01-llm-request-lifecycle.md) — tầng lỗi C
- [Provider adapter & DTO](./04-provider-adapter-and-dto.md) — normalize finish reason giữa provider
- [Prompt như input contract](./01-prompt-as-input-contract.md) — nêu format trong prompt
- [Untrusted model output](../06-safety/02-untrusted-model-output.md) — output vào HTML/SQL/URL
- [Tool security](../04-agents-tools/02-tool-security.md) — validate argument của tool call
- [Human in the loop](../07-production/07-human-in-the-loop.md) — bậc fallback ④
- [Money & Decimal](../../03-database/03-data-modeling/08-money-decimal.md) — vì sao tiền là số nguyên
- [Date/time & timezone](../../03-database/03-data-modeling/07-datetime-timezone.md) — ràng buộc ISO 8601
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — DTO, validation, serialization
- [Prisma transactions](../../03-database/05-data-access/04-prisma-transactions.md) — parse lỗi giữa job ghi
