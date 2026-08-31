---
level: intermediate
area: ai-engineering
prerequisites:
  - ../00-fundamentals/01-llm-request-lifecycle.md
related:
  - ../02-chatbot-web/04-chat-ux-and-state.md
  - ../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
---

# Failure handling: mười trạng thái, không phải một

> Chatbot có một thông báo lỗi: *"Đã có lỗi xảy ra. Vui lòng thử lại."* Nó hiện cho cả mười tình huống: provider quá tải, hội thoại quá dài, nội dung bị chặn, người dùng bấm Dừng, tool thất bại, hết hạn mức, JSON không parse được, mạng đứt, key hết hạn, và không tìm thấy tài liệu. Người dùng bấm "thử lại" cho tất cả — trong đó có sáu tình huống mà thử lại **chắc chắn** thất bại, và một tình huống mà thử lại **nhân đôi chi phí** cho một việc đã thành công.

## Position

```text
Bất kỳ tầng nào lỗi
      │
      ▼  ← NOTE NÀY: phân loại, và mỗi loại có UI + hành động riêng
người dùng biết phải làm gì
```

## Problem

AI feature có nhiều chế độ hỏng hơn một endpoint thường, và chúng khác nhau ở hai chiều mà UI phải phản ánh:

```text
① CÓ RETRY ĐƯỢC KHÔNG?     retry sai = tốn tiền, hoặc làm sự cố tệ hơn
② NGƯỜI DÙNG LÀM GÌ ĐƯỢC?   "thử lại" · "rút ngắn câu hỏi" · "đợi" · "không gì"
```

Gộp mười trạng thái thành một thông báo làm người dùng không biết phải làm gì, và làm hệ thống retry những thứ không thể thành công.

## Mental Model

### Mười trạng thái, phân loại đầy đủ

| Trạng thái | Retry? | Thông báo cho người dùng | Hành động của hệ thống |
|---|---|---|---|
| **provider quá tải** (`429`) | ✓ tự động, backoff | "hệ thống đang tải cao, đợi chút" | retry ≤2, tôn trọng `Retry-After` |
| **provider lỗi** (`5xx`) | ✓ tự động | như trên | retry ≤2 + jitter; circuit breaker |
| **timeout / mạng** | ✓ tự động | như trên | retry ≤1 (đắt) |
| **context quá dài** (`400`) | ✗ | "hội thoại quá dài" + nút *Bắt đầu chủ đề mới* | thu gọn tự động rồi thử **một** lần |
| **output bị cắt** (`max_tokens`) | ⚠ có điều kiện | "câu trả lời bị cắt" + *Tiếp tục* | tăng limit **một** lần, hoặc để người quyết |
| **nội dung bị chặn** | ✗ | "không thể trả lời yêu cầu này" | không retry; log để xem xét |
| **output không hợp lệ** | ⚠ ≤1 lần | thường ẩn với người dùng | retry kèm thông báo lỗi; rồi degrade |
| **tool thất bại** | tuỳ tool | "không tra được đơn hàng lúc này" | trả `tool_result` lỗi; model tự xử lý |
| **hết hạn mức / ngân sách** | ✗ | "đã dùng hết hạn mức hôm nay" + khi nào reset | không retry; hiện hạn mức |
| **người dùng huỷ** | — | "đã dừng" (**không phải lỗi**) | lưu partial; hiện *Tiếp tục* |
| **không tìm thấy tài liệu** | ✗ | "không tìm thấy thông tin này trong tài liệu" | **không phải lỗi** — là câu trả lời |

Hai dòng cuối đáng nhấn: **huỷ và "không tìm thấy" không phải lỗi.** Hiện chúng bằng UI lỗi làm người dùng tưởng hệ thống hỏng.

### Ba nhóm theo hành động

```text
NHÓM A — HỆ THỐNG TỰ XỬ LÝ, người dùng không cần biết
   429 · 5xx · timeout · output không hợp lệ (lần 1)
   → retry im lặng, có trần

NHÓM B — NGƯỜI DÙNG LÀM ĐƯỢC GÌ ĐÓ
   context quá dài → bắt đầu chủ đề mới, hoặc rút ngắn
   output bị cắt → bấm Tiếp tục
   hết hạn mức → đợi, hoặc nâng gói
   → thông báo phải nói RÕ HÀNH ĐỘNG, không chỉ nói "lỗi"

NHÓM C — KHÔNG AI LÀM ĐƯỢC GÌ NGAY
   nội dung bị chặn · key sai · lỗi cấu hình
   → thông báo trung thực, KHÔNG hiện nút "Thử lại"
```

Nút "Thử lại" cho nhóm C là phản diện thiết kế: nó mời người dùng làm một việc chắc chắn thất bại.

### Hai trạng thái đặc biệt: `cancelled` và `not-found`

```text
CANCELLED
  người dùng chủ động dừng
  → UI trung tính, không màu đỏ: "Đã dừng"
  → hiện partial đã sinh
  → nút chính: TIẾP TỤC (không phải Thử lại)
  → không tính vào metric lỗi

NOT-FOUND (RAG)
  không có tài liệu đủ liên quan
  → đây là CÂU TRẢ LỜI, không phải lỗi
  → "Tôi không tìm thấy thông tin này trong tài liệu của bạn."
  → có thể kèm: gợi ý từ khoá khác, hoặc nút chuyển người thật
```

Trạng thái `not-found` là thiết kế đúng đã nêu ở [03-rag-pipeline.md](../03-rag/03-rag-pipeline.md): **nói thật tốt hơn bịa.** Nhưng nó chỉ có giá trị nếu UI trình bày nó như một câu trả lời, không như một thất bại.

### Retry: ba quy tắc và một cái bẫy

```text
① CHỈ retry nhóm A. Không retry 4xx (trừ 429).
② TRẦN 1–2 lần cho request tương tác.
   Retry mất 8 giây thường tệ hơn một lỗi có nút Thử lại.
③ BACKOFF + JITTER, tôn trọng Retry-After.
```

Cái bẫy: **SDK thường tự retry mặc định.** Cộng với retry của bạn, cộng với retry của agent loop, một request có thể thành nhiều lần gọi. Kiểm và đặt tường minh.

```ts
const client = new Provider({ maxRetries: 0 });   // ← tắt của SDK, tự quản
```

Và với request **có side effect** (tool đã chạy, email đã gửi), retry phải qua idempotency key — nếu không bạn làm việc đó hai lần. Xem [03-http-semantics-idempotency.md](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md).

### Degradation: bốn bậc

```text
① ĐẦY ĐỦ            RAG + tool + model mạnh
② GIẢM CHẤT LƯỢNG    model nhỏ hơn / không rerank / ít tài liệu hơn
③ KHÔNG AI           trả kết quả tìm kiếm thô, hoặc bài viết FAQ liên quan
④ TRUNG THỰC         "tính năng này tạm không dùng được" + đường khác
```

Bậc ③ là bậc bị bỏ qua nhiều nhất và giá trị cao nhất: **khi model không dùng được, kết quả tìm kiếm vẫn hữu ích.** Người dùng đọc được ba đoạn tài liệu liên quan còn tốt hơn nhìn một thông báo lỗi.

```ts
async function answer(q: Query): Promise<Answer> {
  try {
    return await fullPipeline(q);                       // ①
  } catch (e) {
    const kind = classify(e);

    if (kind === 'rate_limited' || kind === 'transient') {
      try {
        return await degradedPipeline(q);               // ② model nhỏ, không rerank
      } catch { /* rơi xuống ③ */ }
    }

    if (q.docs?.length) {
      metrics.increment('ai.degraded_to_search');
      return searchOnlyAnswer(q.docs);                  // ③ vẫn hữu ích
    }

    return honestUnavailable(kind);                     // ④
  }
}
```

### Circuit breaker: khi provider đang chết

```text
Không có breaker:  mọi request chờ timeout → thread/connection cạn
                   → toàn bộ ứng dụng chậm, kể cả phần không dùng AI

Có breaker:        sau N lỗi liên tiếp → mở → fail NGAY
                   → degrade sang bậc ③ tức thì, không ai phải chờ
```

Đây là [circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) không đổi gì — nhưng nó quan trọng hơn bình thường với AI, vì AI request **chậm** (nhiều giây), nên chờ timeout tiêu tài nguyên lâu hơn nhiều.

Một điểm cần cẩn thận: breaker nên **theo provider**, không theo toàn bộ tính năng. Nếu bạn có fallback provider, breaker mở ở provider A phải cho đường sang B.

### Thông báo lỗi: nói được ba điều

```text
❌ "Đã có lỗi xảy ra. Vui lòng thử lại."
   → không nói gì xảy ra, không nói làm gì, mời làm việc có thể vô ích

✅ Ba phần:
   ① CÁI GÌ  "Hội thoại này đã quá dài để xử lý."
   ② LÀM GÌ  "Hãy bắt đầu một chủ đề mới, hoặc rút ngắn câu hỏi."
   ③ TRUY VẾT "Mã lỗi: CONTEXT_TOO_LARGE · req_01HX3..."
```

Phần ③ là phần biến "app lỗi" thành một dòng log tìm được — đúng error model của repo ở [05-error-model.md](../../02-backend-api/00-http-api/05-error-model.md). AI không cần error model riêng; nó cần **thêm `code` cho các lỗi mới**.

```ts
export type AiErrorCode =
  | 'AI_PROVIDER_OVERLOADED'     // 429  · retryable
  | 'AI_PROVIDER_UNAVAILABLE'    // 5xx  · retryable
  | 'AI_TIMEOUT'                 //      · retryable
  | 'AI_CONTEXT_TOO_LARGE'       // 400  · KHÔNG
  | 'AI_OUTPUT_TRUNCATED'        // 200! · có điều kiện
  | 'AI_CONTENT_BLOCKED'         //      · KHÔNG
  | 'AI_INVALID_OUTPUT'          // 200! · ≤1 lần
  | 'AI_TOOL_FAILED'             //      · tuỳ tool
  | 'AI_BUDGET_EXCEEDED'         //      · KHÔNG
  | 'AI_NO_RELEVANT_DOCUMENTS';  //      · không phải lỗi
```

Chú ý hai mã có `200!`: chúng đến từ HTTP **thành công**. Đây là tầng lỗi C ở [01-llm-request-lifecycle.md](../00-fundamentals/01-llm-request-lifecycle.md), và nó là lý do danh sách này không suy ra được từ HTTP status.

## Example

```ts
function toUserFacing(code: AiErrorCode, ctx: { requestId: string; resetAt?: Date }) {
  const M: Record<AiErrorCode, { title: string; action?: string; retryable: boolean }> = {
    AI_PROVIDER_OVERLOADED: {
      title: 'Hệ thống đang tải cao.', action: 'Thử lại sau vài giây.', retryable: true },
    AI_CONTEXT_TOO_LARGE: {
      title: 'Hội thoại này đã quá dài.',
      action: 'Bắt đầu một chủ đề mới, hoặc rút ngắn câu hỏi.', retryable: false },
    AI_OUTPUT_TRUNCATED: {
      title: 'Câu trả lời bị cắt giữa.', action: 'Bấm Tiếp tục.', retryable: false },
    AI_CONTENT_BLOCKED: {
      title: 'Không thể trả lời yêu cầu này.', retryable: false },
    AI_BUDGET_EXCEEDED: {
      title: 'Đã dùng hết hạn mức hôm nay.',
      action: ctx.resetAt ? `Hạn mức reset lúc ${fmt(ctx.resetAt)}.` : undefined,
      retryable: false },
    AI_NO_RELEVANT_DOCUMENTS: {
      title: 'Không tìm thấy thông tin này trong tài liệu của bạn.',
      action: 'Thử diễn đạt khác, hoặc liên hệ hỗ trợ.', retryable: false },
    // ...
  };
  return { ...M[code], code, requestId: ctx.requestId };
}
```

Frontend chỉ hiện nút Thử lại khi `retryable === true`. Một dòng, và nó loại bỏ toàn bộ nhóm sự cố "người dùng bấm thử lại vô ích".

Và với `AI_CONTEXT_TOO_LARGE`, hệ thống nên thử **tự sửa một lần** trước khi báo:

```ts
if (classify(e) === 'context_too_large' && !alreadyShrunk) {
  const shrunk = await contextBuilder.build({ ...input, aggressiveTruncation: true });
  return retryOnce(shrunk);            // MỘT lần, rồi mới báo người dùng
}
```

## Prediction

1. Bạn hiện một thông báo lỗi cho mọi tình huống. Người dùng bấm Thử lại khi `context_too_large`. Kết quả?
2. Bạn retry `400 content_blocked` 3 lần với backoff. Chi phí và kết quả?
3. Người dùng bấm Dừng. UI hiện lỗi đỏ. Họ nghĩ gì?
4. Provider chết. Không có circuit breaker. Điều gì xảy ra với phần không dùng AI của ứng dụng?
5. SDK có `maxRetries: 2`, bạn retry 2 lần, agent loop có 5 bước. Tối đa bao nhiêu lần gọi provider?
6. RAG không tìm thấy tài liệu. Bạn hiện "Đã có lỗi xảy ra". Vấn đề?

<details>
<summary>Đáp án</summary>

1. **Thất bại y như vậy**, và có thể vài lần. Bạn tiêu latency + có thể tiêu token cho một việc chắc chắn không thành. Thông báo phải nói *"bắt đầu chủ đề mới"*.
2. Ba lần fail chắc chắn — nội dung bị chặn không phụ thuộc thời điểm. Tốn latency, làm người dùng chờ lâu hơn.
3. Họ nghĩ **hệ thống hỏng**, trong khi chính họ vừa dừng. `cancelled` phải là UI trung tính kèm nút Tiếp tục.
4. AI request **chậm** nên mọi request chờ timeout → thread/connection cạn → **toàn bộ ứng dụng chậm**, kể cả trang không liên quan AI. Đây là lý do breaker quan trọng hơn bình thường.
5. Trường hợp xấu nhất: `5 bước × (1 + 2 của bạn) × 3 của SDK` = **45 lần gọi**. Phải tắt retry của SDK và đặt trần tường minh ở mỗi tầng.
6. Bạn biến một **câu trả lời hợp lệ** thành một lỗi. Người dùng mất niềm tin vào hệ thống, và bạn mất cơ hội gợi ý họ diễn đạt khác.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Người dùng bấm Thử lại vô ích | thông báo không phân biệt retryable |
| Chi phí tăng vì retry | retry lỗi không thể retry; retry nhiều tầng |
| Toàn bộ app chậm khi provider chết | thiếu circuit breaker |
| Người dùng tưởng hỏng khi họ tự dừng | `cancelled` hiện như lỗi |
| "Không tìm thấy" hiện như lỗi | không tách `not-found` khỏi error |
| Hành động chạy hai lần sau retry | thiếu idempotency key |
| Không biết vì sao lỗi | thiếu `code` và `requestId` |
| Người dùng mất tin nhắn dài | xoá optimistic message khi lỗi |
| Lỗi `max_tokens` báo là lỗi parse | không kiểm `finishReason` trước khi parse |
| Số lần gọi provider gấp nhiều lần dự kiến | retry của SDK không tắt |

## Debugging

```text
1. Phân bố mã lỗi theo route → mã nào nhiều nhất?
2. Với mã đó: có retryable đúng không? UI hiện gì?
3. Số lần gọi provider / request người dùng → retry cộng dồn?
4. finishReason=max_tokens có được phân loại riêng, hay lẫn vào lỗi parse?
5. cancelled có bị tính vào metric lỗi không? (nó không nên)
6. Circuit breaker có mở khi provider chết? Có degrade được không?
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Retry tự động | ẩn lỗi tạm khỏi người dùng | latency; chi phí; có thể làm sự cố tệ hơn |
| Để người dùng retry | rẻ, minh bạch, họ sửa được câu hỏi | nhiều lỗi hiện ra hơn |
| Thu gọn context tự động 1 lần | tự khỏi lỗi thường gặp nhất | có thể mất ngữ cảnh mà không nói |
| Degrade sang tìm kiếm thô | vẫn hữu ích khi model chết | chất lượng thấp hơn rõ |
| Circuit breaker | bảo vệ cả ứng dụng | có thể mở oan khi lỗi lẻ tẻ |
| Thông báo chi tiết | người dùng biết làm gì | có thể tiết lộ chi tiết nội bộ — dùng `code`, không dùng message provider |

## Explain Without Notes

1. **Mười** trạng thái, không phải một; mỗi trạng thái có UI và hành động riêng.
2. Phân loại theo **retryable** trước, và chỉ hiện nút Thử lại khi retryable.
3. `cancelled` và `not-found` **không phải lỗi**.
4. Retry: chỉ nhóm A, trần 1–2, và **tắt retry của SDK** để không cộng dồn.
5. Bốn bậc degradation; bậc "trả kết quả tìm kiếm thô" bị bỏ qua nhiều nhất và giá trị cao.

## Related

- [LLM request lifecycle](../00-fundamentals/01-llm-request-lifecycle.md) — ba tầng lỗi, tầng C
- [Chat UX & state](../02-chatbot-web/04-chat-ux-and-state.md) — trạng thái ở FE
- [Gọi provider từ web](../02-chatbot-web/02-calling-provider-from-web.md) — timeout, retry
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — phân loại lỗi
- [AI observability](./01-ai-observability.md) — mã lỗi là dimension
- [Structured output](../01-context-and-output/03-structured-output.md) — `AI_INVALID_OUTPUT`
- [RAG pipeline](../03-rag/03-rag-pipeline.md) — `not-found` là câu trả lời
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md)
- [Error model](../../02-backend-api/00-http-api/05-error-model.md) — `code` + `requestId`
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md)
