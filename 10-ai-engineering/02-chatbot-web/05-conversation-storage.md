---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-chatbot-architecture.md
related:
  - 06-context-window-management.md
  - 07-memory.md
  - ../../03-database/03-data-modeling/README.md
---

# Conversation storage: lưu gì, và lưu thế nào

> Sáu tháng sau khi ra mắt, team cần trả lời ba câu hỏi từ ba phía. Tài chính: "chi phí AI theo khách hàng là bao nhiêu?" Kỹ thuật: "câu trả lời sai hôm 12/03 dựa trên tài liệu nào?" Pháp lý: "hãy xoá toàn bộ dữ liệu của người dùng này." Cả ba đều không trả lời được. Bảng `messages` có đúng bốn cột: `id`, `role`, `content`, `created_at`.

## Position

```text
Lượt chat ──▶ [ POSTGRESQL ] ──▶ đọc lại · tính tiền · debug · eval · xoá
                    ▲
        note này: schema và ranh giới lưu/gửi
```

## Problem

Bảng message trông như thứ đơn giản nhất trong hệ thống. Nhưng nó là nơi **năm nhu cầu khác nhau** gặp nhau, và một schema tối giản chỉ phục vụ được nhu cầu thứ nhất:

```text
① Hiển thị lại hội thoại               → cần: role, content, thứ tự
② Dựng context cho lượt sau            → cần: token count, tóm tắt, cờ partial
③ Tính chi phí theo user/tổ chức       → cần: usage, model
④ Debug một câu trả lời cụ thể         → cần: promptVersion, docIds, toolCalls, requestId
⑤ Xoá dữ liệu theo yêu cầu / theo hạn  → cần: user gắn với mọi dòng, chiến lược retention
```

Và ranh giới trung tâm, đã nêu ở [02-ai-application-architecture.md](../00-fundamentals/02-ai-application-architecture.md), nhưng đây là nơi nó thành schema:

> **Lịch sử đã lưu là nguồn sự thật, đầy đủ, không mất. Context gửi cho model là *phái sinh*, vừa budget, tính lại được.**

Nhập hai cái này lại là lý do người ta không thể đổi chiến lược cắt context mà không mất dữ liệu — hoặc phải "xoá" tin nhắn cũ để "tiết kiệm context".

## Mental Model

### Schema tối thiểu nhưng đủ

```sql
CREATE TABLE conversation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES app_user(id),
  org_id            UUID NOT NULL,              -- multi-tenant: lọc ở MỌI query
  title             TEXT,                        -- sinh từ lượt đầu
  system_prompt_id  TEXT NOT NULL,               -- prompt nào tạo ra hội thoại này
  model             TEXT NOT NULL,               -- model mặc định của hội thoại
  summary           TEXT,                        -- tóm tắt phần cũ (xem note 06)
  summary_upto_seq  INT,                         -- tóm tắt tới message nào
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ                  -- soft delete
);
CREATE INDEX ON conversation (user_id, last_message_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE conversation_message (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  seq                INT  NOT NULL,              -- thứ tự TRONG hội thoại
  role               TEXT NOT NULL,              -- 'user'|'assistant'|'tool'|'system'
  content            TEXT NOT NULL,

  -- idempotency (xem note 01)
  client_message_id  UUID,

  -- ② dựng context
  token_count        INT,
  is_partial         BOOLEAN NOT NULL DEFAULT false,
  finish_reason      TEXT,

  -- ③ chi phí
  model              TEXT,
  input_tokens       INT,
  output_tokens      INT,
  cached_input_tokens INT,

  -- ④ debug / eval
  prompt_version     INT,
  request_id         TEXT,
  retrieved_doc_ids  TEXT[],                     -- ← dòng quan trọng nhất cho debug
  tool_calls         JSONB,
  latency_ms         INT,
  ttft_ms            INT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON conversation_message (conversation_id, seq);
CREATE UNIQUE INDEX ON conversation_message (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;          -- idempotency, partial index
CREATE INDEX ON conversation_message (conversation_id, seq DESC);
```

Bốn quyết định trong schema đáng giải thích:

**`seq` chứ không chỉ `created_at`.** Hai message có thể cùng timestamp tới millisecond, và `ORDER BY created_at` khi đó cho thứ tự không xác định. Thứ tự hội thoại là **ngữ nghĩa**, không phải thời gian — nên nó cần một cột số nguyên. Đây đúng vấn đề tie-breaker mà [04-pagination-filtering-sorting.md](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) đã dạy.

**`retrieved_doc_ids`** là dòng cho phép trả lời câu hỏi *"câu trả lời sai vì retrieval hay vì generation"*. Không có nó, câu hỏi đó không có câu trả lời sau một tuần.

**`is_partial` + `finish_reason`** là những cột cho phép UI hiện "câu trả lời bị ngắt" và cho phép context builder biết lượt đó không đầy đủ.

**`org_id` trên `conversation`** để mọi truy vấn lọc được theo tenant ở tầng query — không phải `.filter()` sau khi đọc.

### Unique index cho idempotency: partial index

```sql
CREATE UNIQUE INDEX ON conversation_message (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
```

`WHERE` là phần bắt buộc. Message do assistant tạo không có `client_message_id`; trong PostgreSQL nhiều `NULL` không xung đột unique, nhưng partial index nói rõ ý định và nhỏ hơn.

### Không lưu context đã gửi vào cùng bảng

Câu hỏi hay gặp: có nên lưu nguyên `messages[]` đã gửi cho model?

```text
Lợi:  reproduce chính xác được một lượt; debug tốt nhất
Hại:  dữ liệu nhân lên (mỗi lượt chứa lại toàn bộ history);
      bảng phình nhanh; và nó là dữ liệu PHÁI SINH
```

Cách cân bằng thực dụng:

```text
✅ Lưu ĐỦ ĐỂ DỰNG LẠI:  prompt_version + retrieved_doc_ids +
                        summary_upto_seq + model + chiến lược cắt
✅ Lưu RAW PROMPT chỉ cho SAMPLE (ví dụ 1% request, hoặc mọi request LỖI),
   ở bảng riêng, có TTL ngắn (7–30 ngày), đã redact
❌ Lưu toàn bộ messages[] cho MỌI request, vĩnh viễn
```

Bảng sample riêng là thứ đáng có:

```sql
CREATE TABLE llm_trace_sample (
  request_id   TEXT PRIMARY KEY,
  messages     JSONB NOT NULL,       -- đã redact
  raw_output   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL  -- job dọn theo cột này
);
```

### Tool call lưu ở đâu

Hai lựa chọn, và lựa chọn quyết định bởi việc bạn có cần hiển thị tool cho người dùng:

```text
① JSONB trên message assistant     đơn giản; đủ cho audit và hiển thị
② Bảng riêng tool_call             query được, đo được, join được với audit log
```

Chọn ① trước. Chuyển sang ② khi bạn cần trả lời "tool nào hay fail nhất" hoặc "tool nào tốn nhiều thời gian nhất" — nghĩa là khi bạn có agent thật. Xem [03-agent-loop.md](../04-agents-tools/03-agent-loop.md).

Quan trọng hơn chỗ lưu: **tool có side effect phải có audit log riêng**, độc lập với bảng message. Message có thể bị xoá theo yêu cầu người dùng; audit log về hành động đã xảy ra thì không. Xem [02-tool-security.md](../04-agents-tools/02-tool-security.md).

### Sửa & gửi lại: cắt cứng hay phân nhánh

```text
CẮT CỨNG (mặc định nên chọn)
  sửa message seq=5 → xoá mềm mọi message seq > 5
  + đơn giản, một đường thẳng, query dễ
  − mất nhánh cũ

PHÂN NHÁNH
  message thêm parent_id; conversation thêm active_leaf_id
  + so sánh được nhánh; không mất gì
  − mọi query phải đi theo cây; UI phải có bộ chọn nhánh;
    context builder phải đi từ leaf lên root
```

Đừng chọn phân nhánh vì nó "linh hoạt hơn". Chọn nó khi có yêu cầu sản phẩm rõ ràng về so sánh nhánh — nếu không, bạn trả giá phức tạp cho một tính năng không ai dùng.

### Retention và xoá: thiết kế từ đầu, không vá sau

```text
Ba nhu cầu xoá khác nhau:

① NGƯỜI DÙNG xoá một hội thoại        → soft delete, ẩn khỏi UI
② NGƯỜI DÙNG yêu cầu xoá dữ liệu       → HARD delete, kể cả bản sao
③ HẠN LƯU TRỮ của tổ chức              → job định kỳ theo tuổi
```

Nhu cầu ② là nhu cầu làm lộ mọi chỗ bạn đã sao chép dữ liệu:

```text
Khi xoá cứng dữ liệu một người dùng, bạn phải nhớ:
  □ conversation + conversation_message      (CASCADE lo được)
  □ llm_trace_sample                          ← bảng riêng, dễ quên
  □ log ứng dụng có chứa nội dung             ← đừng log nội dung, hoặc redact
  □ embedding + chunk của tài liệu họ upload  ← VECTOR STORE, rất dễ quên
  □ memory / user facts đã trích xuất         ← xem note 07
  □ bản backup                                ← chính sách, không phải code
```

Dòng vector store là dòng làm nhiều team bất ngờ: **embedding là dữ liệu phái sinh từ nội dung, và nó vẫn nằm đó sau khi bạn xoá nội dung gốc.** Nếu chunk lưu cả text (thường có, để đưa vào context), thì đó là một bản sao đầy đủ. Xem [02-vector-search.md](../03-rag/02-vector-search.md).

Nguyên tắc thực dụng để giảm bề mặt: **đừng log nội dung tin nhắn.** Log `requestId`, `conversationId`, độ dài, token — không log content. Nội dung nằm ở đúng một chỗ có chủ đích.

Soft delete và audit ở đây dùng lại nguyên [05-soft-delete-audit-patterns.md](../../03-database/03-data-modeling/05-soft-delete-audit-patterns.md).

## Example

Đọc lịch sử để dựng context — tránh N+1 và lấy đúng phần cần:

```ts
// Chỉ lấy cột cần cho context, và chỉ lấy phần SAU tóm tắt
async function listForContext(conversationId: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { summary: true, summaryUptoSeq: true, model: true, systemPromptId: true },
  });

  const messages = await prisma.conversationMessage.findMany({
    where: {
      conversationId,
      seq: { gt: conv.summaryUptoSeq ?? 0 },      // ← phần cũ đã có trong summary
      role: { in: ['user', 'assistant'] },
    },
    orderBy: { seq: 'asc' },
    select: { role: true, content: true, tokenCount: true, isPartial: true },
  });

  return { summary: conv.summary, messages };
}
```

Ba điều trong query trên:

```text
① select cụ thể → không kéo về tool_calls JSONB và retrieved_doc_ids
                   (chúng dùng cho debug, không cho context)
② seq > summaryUptoSeq → không đọc phần đã được tóm tắt
③ orderBy seq, KHÔNG orderBy createdAt
```

Và ghi một lượt — trong transaction, với usage:

```ts
await prisma.$transaction(async (tx) => {
  const next = await nextSeq(tx, conversationId);
  await tx.conversationMessage.create({
    data: {
      conversationId, seq: next, role: 'assistant', content: acc,
      isPartial: finishReason !== 'completed', finishReason,
      model: cfg.model, promptVersion: PROMPT.version, requestId,
      inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
      cachedInputTokens: usage?.cachedInputTokens,
      retrievedDocIds: docIds, toolCalls: toolCalls.length ? toolCalls : undefined,
      ttftMs, latencyMs,
    },
  });
  await tx.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
});
```

`nextSeq` trong transaction là chỗ có thể có race nếu hai request cùng ghi vào một hội thoại. Với `UNIQUE (conversation_id, seq)`, race thứ hai sẽ **fail rõ ràng** thay vì tạo thứ tự sai — và bạn retry. Đó là lý do unique constraint tồn tại. Xem [04-prisma-transactions.md](../../03-database/05-data-access/04-prisma-transactions.md).

## Prediction

1. Bạn `ORDER BY created_at` và hai message được ghi trong cùng millisecond. Hội thoại hiển thị thế nào?
2. Bạn không lưu `retrieved_doc_ids`. Một tháng sau có khiếu nại về câu trả lời sai. Bạn điều tra thế nào?
3. Bạn lưu toàn bộ `messages[]` gửi đi cho mọi request. Sau 6 tháng với 100k hội thoại, bảng lớn cỡ nào so với bảng message?
4. Người dùng yêu cầu xoá dữ liệu. Bạn `DELETE FROM conversation`. Còn gì lại?
5. Bạn không có `is_partial`. Một câu trả lời bị ngắt ở giữa được dùng làm context cho lượt sau. Kết quả?

<details>
<summary>Đáp án</summary>

1. **Thứ tự không xác định** — có thể đúng, có thể đảo, và có thể đổi giữa các lần query. Cần `seq` làm tie-breaker hoặc thứ tự chính.
2. **Bạn không điều tra được** — chỉ đoán. Đây là lý do một cột `TEXT[]` đáng giá hơn nhiều so với kích thước của nó.
3. **Lớn hơn bậc độ lớn** — mỗi lượt chứa lại toàn bộ history trước nó, nên tăng theo bình phương độ dài hội thoại. Đó là lý do chỉ lưu sample.
4. Còn: trace sample, log có nội dung, **embedding + chunk text trong vector store**, memory đã trích xuất, và backup. Xoá cứng phải là một checklist, không phải một câu lệnh.
5. Model coi câu bị cắt là câu trả lời hoàn chỉnh của chính nó → dễ tiếp tục theo hướng sai, hoặc lặp lại. Nên đánh dấu partial và xử lý tường minh (bỏ, hoặc gắn nhãn "câu trả lời trước bị ngắt").

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Thứ tự hội thoại lộn xộn | dùng `created_at` thay vì `seq` |
| Hai câu trả lời cho một tin nhắn | thiếu unique index cho `client_message_id` |
| Không tính được chi phí theo khách hàng | không lưu `usage` + `model` trên message |
| Không debug được câu trả lời sai | không lưu `retrieved_doc_ids`, `prompt_version` |
| Bảng message phình bất thường | lưu cả context đã gửi cho mọi request |
| Xoá dữ liệu không sạch | dữ liệu đã sao chép sang vector store / log / trace |
| Query lịch sử chậm khi hội thoại dài | thiếu index `(conversation_id, seq DESC)`; hoặc `select *` |
| Người dùng A thấy hội thoại của B | thiếu lọc `user_id`/`org_id` ở tầng query |
| Câu trả lời bị cắt được coi là hoàn chỉnh | thiếu `is_partial` / `finish_reason` |
| Ghi đồng thời tạo `seq` trùng | thiếu unique constraint → thứ tự sai âm thầm |

## Debugging

```text
1. SELECT seq, role, is_partial, finish_reason, input_tokens, output_tokens
   FROM conversation_message WHERE conversation_id = ? ORDER BY seq;
   → thấy ngay lượt nào bị cắt, lượt nào phình token
2. SUM(input_tokens + output_tokens) theo user/org/tháng → chi phí
3. retrieved_doc_ids của lượt lỗi → tài liệu đúng có trong đó không?
4. COUNT(*) GROUP BY client_message_id HAVING COUNT(*) > 1 → idempotency
5. EXPLAIN query đọc lịch sử → có dùng index không?
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Lưu `usage` trên mỗi message | tính chi phí theo bất kỳ chiều nào | vài cột int (rẻ) |
| Lưu `retrieved_doc_ids` | debug retrieval được | một mảng text (rẻ) |
| Lưu raw prompt cho sample | reproduce được lỗi | bảng riêng + job dọn |
| Lưu raw prompt cho mọi request | debug tối đa | tăng trưởng bình phương; rủi ro dữ liệu nhạy cảm |
| Cắt cứng khi sửa | đơn giản | mất nhánh cũ |
| Phân nhánh | giữ lịch sử đầy đủ | phức tạp ở schema, query, UI, context builder |
| Soft delete | phục hồi được, audit được | mọi query phải nhớ `WHERE deleted_at IS NULL` |
| Không log nội dung | bề mặt xoá nhỏ, ít rủi ro rò rỉ | debug khó hơn — bù bằng trace sample có TTL |

## Explain Without Notes

1. Bảng message phục vụ **năm** nhu cầu; schema bốn cột chỉ phục vụ một.
2. Thứ tự hội thoại là `seq`, không phải `created_at`.
3. Lịch sử đã lưu là nguồn sự thật; context gửi đi là phái sinh, tính lại được.
4. `retrieved_doc_ids` + `prompt_version` + `usage` là ba thứ khiến hệ thống debug được và tính tiền được.
5. Xoá cứng là một checklist — vector store là chỗ dễ quên nhất.

## Related

- [Chatbot architecture](./01-chatbot-architecture.md) — trạm ⑦⑬
- [Context window management](./06-context-window-management.md) — `summary`, `summary_upto_seq`
- [Memory](./07-memory.md) — dữ liệu trích xuất, cũng phải xoá được
- [Chat UX & state](./04-chat-ux-and-state.md) — sửa & gửi lại
- [Vector search](../03-rag/02-vector-search.md) — bản sao nội dung trong chunk
- [Tool security](../04-agents-tools/02-tool-security.md) — audit log tách khỏi message
- [Data modeling](../../03-database/03-data-modeling/README.md)
- [Soft delete & audit patterns](../../03-database/03-data-modeling/05-soft-delete-audit-patterns.md)
- [ID strategy](../../03-database/03-data-modeling/06-id-strategy.md) — UUID vs serial
- [Prisma transactions](../../03-database/05-data-access/04-prisma-transactions.md)
- [Pagination & tie-breaker](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md)
