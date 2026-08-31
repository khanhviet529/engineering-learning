---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-prompt-as-input-contract.md
related:
  - ../02-chatbot-web/06-context-window-management.md
  - ../03-rag/03-rag-pipeline.md
  - ../07-production/02-cost-and-model-routing.md
---

# Context engineering: chọn gì đưa vào cửa sổ

> Một trợ lý nội bộ trả lời rất tốt trong demo với 3 tài liệu. Khi bật cho toàn công ty với 40.000 tài liệu, nó tệ hơn — không phải vì thiếu thông tin, mà vì mỗi request giờ nhồi 20 chunk "liên quan" vào context, và câu trả lời đúng nằm ở chunk thứ 14. Hoá đơn tăng 6×. Đội tăng `top_k` từ 20 lên 40 để "chắc chắn có tài liệu đúng". Chất lượng giảm tiếp.

## Position

```text
Dữ liệu có sẵn (rất nhiều)
        │
        ▼  ← NOTE NÀY: pipeline chọn lọc
   context vừa budget
        │
        ▼
      Model
```

## Problem

Context không phải "càng nhiều càng tốt". Nó là **bài toán tối ưu có ràng buộc cứng**:

```text
Có sẵn:   system prompt · 200 message lịch sử · 40k tài liệu ·
          memory người dùng · 12 tool schema · dữ liệu đơn hàng
Ràng buộc: 32k token (hoặc 200k — vẫn là ràng buộc)
Mục tiêu:  câu trả lời đúng, với chi phí và latency thấp nhất
```

Ba lý do "nhồi hết vào" sai, kể cả khi cửa sổ rất lớn:

```text
① CHI PHÍ    input token × mọi request. Tuyến tính, mãi mãi.
② LATENCY    TTFT tăng theo độ dài input.
③ CHẤT LƯỢNG thông tin đúng bị loãng giữa thông tin không liên quan.
```

Lý do ③ là lý do phản trực giác nhất và là lý do thật của sự cố ở đầu note.

## Mental Model

### Context engineering là một pipeline sáu bước

```text
available          mọi thứ bạn CÓ THỂ đưa vào
    ↓
SELECT             nguồn nào liên quan tới yêu cầu này?
    ↓
FILTER             bỏ cái sai quyền, sai tenant, quá cũ, trùng lặp
    ↓
RANK               cái nào quan trọng nhất?
    ↓
COMPRESS           tóm tắt / trích đoạn / bỏ phần thừa
    ↓
PLACE              đặt ở đâu trong prompt, theo thứ tự nào
    ↓
context vừa budget
```

Điểm quan trọng: **FILTER phải đứng trước RANK.** Lọc là về *tính đúng đắn* (quyền truy cập, tenant, thời hạn); xếp hạng là về *độ liên quan*. Xếp hạng trước rồi lọc sau nghĩa là bạn đã tiêu ngân sách xếp hạng vào những thứ không được phép xuất hiện — và trong trường hợp tệ nhất, một chunk của tenant khác lọt vào vì nó "liên quan hơn".

```text
❌ retrieve top-20 → rồi lọc theo tenant → còn 3 chunk
✅ lọc theo tenant NGAY TRONG QUERY → retrieve top-20 trong phạm vi đó
```

### Token budget: phân bổ tường minh, không phải hy vọng

Không có budget tường minh, context là **thứ tự nhiên phình ra**. Với budget, nó là một quyết định.

```text
Cửa sổ model:              200.000
Dành cho output:           - 4.000        ← output cũng chiếm chỗ
An toàn (đếm token lệch):  - 2.000
────────────────────────────────────
Ngân sách input:            194.000

Phân bổ:
  system prompt + few-shot    2.000   ổn định, cache được
  tool schemas                1.500   ổn định, cache được
  memory / user facts            800
  tài liệu RAG               12.000   ← có TRẦN, không phải "top_k tài liệu"
  lịch sử hội thoại          16.000   ← có TRẦN, cắt/tóm tắt khi vượt
  câu hỏi hiện tại              500
────────────────────────────────────
  dùng thật                  32.800
```

Chú ý hai điều trong bảng trên.

**Thứ nhất: bạn không cần dùng hết cửa sổ.** Cửa sổ 200k không có nghĩa phải gửi 194k. Ví dụ trên dùng 32k và đó là một lựa chọn có chủ đích — nhanh hơn, rẻ hơn, chính xác hơn.

**Thứ hai: trần theo *token*, không theo *số lượng*.** `top_k = 20` không phải giới hạn — 20 chunk có thể là 3k token hoặc 60k token tuỳ tài liệu.

```ts
// ❌ giới hạn theo số lượng — không giới hạn gì cả
const docs = await retrieve(query, { topK: 20 });

// ✅ giới hạn theo token, cắt tại ranh giới chunk
function packWithinBudget(chunks: Chunk[], budget: number): Chunk[] {
  const out: Chunk[] = [];
  let used = 0;
  for (const c of chunks) {                 // đã xếp hạng giảm dần
    if (used + c.tokens > budget) break;    // KHÔNG cắt giữa chunk
    out.push(c);
    used += c.tokens;
  }
  return out;
}
```

Cắt giữa một chunk tạo ra tài liệu vô nghĩa và làm citation sai — tệ hơn là bỏ hẳn chunk đó.

### Vị trí quan trọng: đầu và cuối được chú ý hơn giữa

Với context dài, model có xu hướng dùng thông tin ở **đầu** và **cuối** tốt hơn thông tin ở **giữa**. Mức độ khác nhau theo model và cải thiện dần qua các thế hệ, nhưng hướng thì nhất quán đủ để thiết kế theo.

```text
Thứ tự thực dụng:

① system prompt + quy tắc        ← đầu: được chú ý, và CACHE được
② few-shot                        ← đầu, ổn định
③ tool schemas                    ← ổn định
④ tài liệu RAG (liên quan nhất TRƯỚC)
⑤ lịch sử đã tóm tắt (cũ)
⑥ lịch sử gần đây (nguyên văn)
⑦ câu hỏi hiện tại                ← CUỐI: được chú ý nhất
```

Hai hệ quả:

- Câu hỏi của người dùng luôn ở **cuối**.
- Trong khối RAG, chunk điểm cao nhất đặt **trước** — không phải theo thứ tự tài liệu.

Và một hệ quả về chi phí: thứ tự ①②③ ở đầu **không đổi giữa các request**, nên nó là tiền tố cache được. Đảo một biến động lên đầu là phá toàn bộ cache.

### Recency vs relevance: hai trục khác nhau

```text
RECENCY (gần đây)    quan trọng cho: hội thoại, trạng thái, "cái tôi vừa nói"
RELEVANCE (liên quan) quan trọng cho: tài liệu, kiến thức, dữ kiện
```

Áp dụng sai trục là lỗi thiết kế phổ biến:

```text
❌ Lấy 20 message GẦN NHẤT làm context cho câu hỏi về chính sách hoàn tiền
   → 20 message gần nhất có thể là chuyện khác hoàn toàn

❌ Lấy chunk LIÊN QUAN NHẤT làm "lịch sử" hội thoại
   → mất mạch hội thoại, model trả lời như chưa từng nói chuyện

✅ Lịch sử: gần đây (+ tóm tắt phần cũ)
✅ Tài liệu: liên quan nhất
✅ Trạng thái nghiệp vụ: luôn luôn đưa vào, không xếp hạng
```

Dòng cuối là điều hay bị bỏ: dữ liệu **bắt buộc phải đúng** (số dư, trạng thái đơn hàng, quyền của user) không được đưa vào cuộc thi xếp hạng. Nó phải có chỗ cố định trong budget.

### Compression: bốn cách, khác nhau về cái bị mất

| Cách | Làm gì | Mất gì | Dùng khi |
|---|---|---|---|
| **Truncate** | bỏ phần cũ | mất hẳn, im lặng | rẻ nhất; chấp nhận được nếu phần cũ không quan trọng |
| **Sliding window** | giữ N message gần nhất | mất mạch dài | chat ngắn, không cần nhớ đầu |
| **Summarize** | model tóm tắt phần cũ | mất chi tiết; **tốn thêm một lần gọi** | hội thoại dài cần liên tục |
| **Extract** | chỉ lấy dữ kiện cần | mất ngữ cảnh quanh dữ kiện | tài liệu dài, câu hỏi hẹp |

Chi tiết và cách chọn: [06-context-window-management.md](../02-chatbot-web/06-context-window-management.md).

Một cạm bẫy về tóm tắt: **tóm tắt là một lần gọi LLM, nên nó cũng có thể sai và cũng tốn tiền.** Tóm tắt sai làm mọi lượt sau đó sai theo, và lỗi tích luỹ. Vì vậy: giữ nguyên văn N lượt gần nhất, chỉ tóm tắt phần cũ, và **lưu lại bản tóm tắt** để không tóm tắt lại mỗi request.

## Example

Context builder tối thiểu nhưng đầy đủ ý:

```ts
async function buildContext(input: BuildInput): Promise<Message[]> {
  const budget = allocate(cfg.model);            // bảng phân bổ ở trên

  // ① SELECT + ② FILTER — lọc quyền TRONG query, không sau query
  const docs = input.needsRetrieval
    ? await retriever.search(input.question, {
        tenantId: input.tenantId,                // filter ở tầng truy vấn
        visibleTo: input.userId,
        topK: 30,                                // lấy rộng để còn chỗ rerank
      })
    : [];

  // ③ RANK
  const ranked = await reranker.rank(input.question, docs);

  // ④ COMPRESS — theo TOKEN, cắt ở ranh giới chunk
  const packedDocs = packWithinBudget(ranked, budget.docs);

  const history = await compressHistory(input.conversationId, budget.history);

  // ⑤ PLACE — ổn định trước, biến đổi sau, câu hỏi cuối cùng
  return [
    { role: 'system', content: renderSystem(SUPPORT_PROMPT) },   // cache được
    ...(input.memory ? [{ role: 'system', content: renderMemory(input.memory) }] : []),
    ...history,
    { role: 'user', content: renderQuestion(packedDocs, input.question) },
  ];
}
```

Bốn thứ đáng chú ý, và cả bốn đều là quyết định kiến trúc chứ không phải chi tiết:

```text
① filter quyền nằm trong search(), không phải .filter() sau khi có kết quả
② topK 30 → rerank → pack theo token: lấy rộng, giữ hẹp
③ packWithinBudget nhận BUDGET, không nhận số lượng
④ câu hỏi và tài liệu đi cùng nhau ở message cuối
```

Và một điều phải luôn ghi lại:

```ts
logger.info('context.built', {
  requestId,
  promptVersion: SUPPORT_PROMPT.version,
  docIds: packedDocs.map(d => d.id),      // ← để debug được retrieval
  docTokens: sum(packedDocs, 'tokens'),
  historyTokens, historyStrategy: 'summarize+window',
  totalInputTokens,
});
```

Không có `docIds` trong log, câu hỏi *"model trả lời sai vì retrieval sai hay vì suy luận sai"* là **không trả lời được**. Đây là một trong hai hoặc ba dòng log quan trọng nhất của toàn bộ track.

## Prediction

1. Bạn tăng `top_k` từ 5 lên 25 vì "để chắc chắn có tài liệu đúng". Ba con số nào thay đổi, theo hướng nào?
2. Bạn đặt tài liệu RAG **sau** câu hỏi người dùng thay vì trước. Ảnh hưởng gì?
3. Bạn tóm tắt lịch sử ở **mỗi** request thay vì lưu bản tóm tắt lại. Chi phí và latency?
4. Bạn lọc theo `tenantId` bằng `.filter()` sau khi vector search trả về top-20. Rủi ro?
5. Model của bạn có cửa sổ 1M. Bạn có nên bỏ luôn context engineering không?

<details>
<summary>Đáp án</summary>

1. **Chi phí input tăng ~5×**, **TTFT tăng**, và **chất lượng có thể giảm** — tài liệu đúng bị loãng giữa 20 tài liệu lệch. Đây chính là sự cố đầu note. Cách đúng: `topK` rộng cho **rerank**, nhưng chỉ **pack** những chunk điểm cao trong budget.
2. Câu hỏi bị đẩy khỏi vị trí cuối — vị trí được chú ý nhất. Thường tuân thủ kém hơn. Đưa tài liệu và câu hỏi vào cùng message cuối, tài liệu trước, câu hỏi sau.
3. **Nhân đôi số lần gọi model** cho mỗi lượt chat, cộng thêm latency của lần tóm tắt vào TTFT của người dùng. Tóm tắt phải được **lưu và tái dùng**, và cập nhật theo lô.
4. Bạn có thể còn **0 chunk** sau khi lọc (cả 20 thuộc tenant khác) → câu trả lời rỗng, trong khi tài liệu đúng vẫn tồn tại ở hạng 21+. Tệ hơn: nếu quên lọc ở đâu đó, **dữ liệu tenant khác lọt vào context** — một lỗ hổng phân quyền thật.
5. **Không.** Cửa sổ lớn dời ràng buộc từ "vừa không" sang "đắt bao nhiêu và đúng bao nhiêu". Cả ba lý do ①②③ ở phần Problem vẫn còn nguyên.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| `400 context too large` với một số user | không có budget; history của họ dài hơn |
| Chi phí tăng dần theo tuần, không rõ vì sao | history hoặc few-shot phình; không có trần |
| Chất lượng giảm khi thêm nhiều tài liệu | loãng context; thiếu rerank; pack quá nhiều |
| Model "quên" điều vừa nói 3 lượt trước | sliding window quá hẹp, hoặc tóm tắt mất chi tiết |
| Model bỏ qua quy tắc trong system prompt | context quá dài; hoặc quy tắc bị đặt vào giữa |
| Câu trả lời trích dẫn tài liệu không liên quan | pack theo số lượng thay vì điểm; hoặc thiếu ngưỡng score |
| Cache hit ratio ≈ 0 | biến động (timestamp, id) nằm trong tiền tố ổn định |
| Người dùng thấy dữ liệu của tenant khác | lọc **sau** retrieval thay vì trong query |
| Latency p99 rất tệ | input dài ở đuôi phân bố — thường là history không có trần |

## Debugging

```text
1. In ra token thực tế của TỪNG khối cho request lỗi
     system / few-shot / tools / memory / docs / history / question
   → gần như luôn có một khối chiếm 80%
2. docIds có chứa tài liệu đúng không?
     KHÔNG → vấn đề ở retrieval (03-rag/04)
     CÓ    → vấn đề ở generation hoặc ở thứ tự/độ loãng
3. Thử bỏ hết docs, chỉ để câu hỏi → model có tuân thủ format không?
4. Thử giảm docs từ 20 xuống 5 chunk điểm cao nhất → tốt lên hay tệ đi?
5. Kiểm cache_read_input_tokens: 0 nghĩa là tiền tố bị phá
```

Bước 4 là thí nghiệm rẻ nhất và hay cho kết quả ngược với trực giác nhất.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Context nhỏ, chọn lọc kỹ | rẻ, nhanh, chính xác hơn | cần retrieval/rerank tốt; rủi ro thiếu thông tin |
| Context lớn, ít chọn lọc | ít công sức; ít rủi ro thiếu | đắt, chậm, có thể kém chính xác |
| Tóm tắt lịch sử | giữ được mạch dài trong budget | một lần gọi nữa; lỗi tóm tắt tích luỹ |
| Sliding window | đơn giản, rẻ, không thêm lỗi | mất hẳn phần cũ |
| Rerank | chất lượng pack tốt hơn nhiều | thêm latency (10–100ms) và có thể thêm chi phí |
| Trần cứng theo token | không bao giờ tràn cửa sổ | đôi khi cắt mất thông tin cần |

## Explain Without Notes

1. Context engineering = select → **filter** → rank → compress → place, và filter phải trước rank.
2. Budget tính bằng **token**, phân bổ tường minh cho từng khối; không cần dùng hết cửa sổ.
3. Ổn định trước (cache được), biến đổi sau, **câu hỏi cuối cùng**.
4. Recency cho hội thoại, relevance cho tài liệu, và dữ liệu nghiệp vụ bắt buộc thì không xếp hạng.
5. Log `docIds` — không có nó thì không tách được lỗi retrieval khỏi lỗi generation.

## Related

- [Prompt như input contract](./01-prompt-as-input-contract.md) — viết phần bên trong context
- [Context window management](../02-chatbot-web/06-context-window-management.md) — cắt và tóm tắt lịch sử
- [RAG pipeline](../03-rag/03-rag-pipeline.md) — nguồn của khối "tài liệu"
- [RAG failure modes](../03-rag/04-rag-failure-modes.md) — khi retrieval là nguyên nhân
- [Memory](../02-chatbot-web/07-memory.md) — nguồn của khối "memory"
- [AI caching](../07-production/03-ai-caching.md) — vì sao thứ tự quyết định hoá đơn
- [Cost & model routing](../07-production/02-cost-and-model-routing.md)
- [Latency engineering](../07-production/04-latency-engineering.md) — input dài → TTFT cao
- [Access control](../../05-cross-cutting/security/04-access-control.md) — lọc theo tenant là phân quyền
- [Context engineering (dùng AI để làm việc)](../../09-ai-assisted-development/02-context-engineering.md)
