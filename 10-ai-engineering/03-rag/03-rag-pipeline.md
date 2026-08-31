---
level: intermediate
area: ai-engineering
prerequisites:
  - 02-vector-search.md
  - ../01-context-and-output/02-context-engineering.md
related:
  - 04-rag-failure-modes.md
  - ../05-evaluation/02-rag-and-agent-evaluation.md
---

# RAG pipeline: từ câu hỏi tới câu trả lời có nguồn

> Một trợ lý tài liệu nội bộ trả lời sai về chính sách nghỉ phép. Nó nói "12 ngày/năm" trong khi tài liệu ghi 15. Điều tra: chunk được lấy đúng, tài liệu đúng, nhưng chunk bị cắt ở giữa bảng — nó chứa dòng *"Nhân viên dưới 3 năm: 12 ngày"* mà **không chứa tiêu đề bảng** nói rằng đó là bảng của một chi nhánh đã ngừng áp dụng. Model đọc đúng cái nó được cho. Cái nó được cho là một mảnh vô nghĩa.

## Position

```text
Ingestion (offline)              Query (online)
document → chunk → embed → store  │  question → embed → retrieve → rerank
                                  │       → build context → model → answer + citation
```

## Problem

RAG tồn tại để giải quyết một giới hạn cụ thể:

> **LLM không biết dữ liệu của bạn.** Nó không biết tài liệu nội bộ, không biết dữ liệu mới hơn thời điểm huấn luyện, không biết dữ liệu riêng của từng khách hàng.

Cách giải quyết là **đưa dữ liệu vào context** — không phải dạy lại model. Xem [05-rag-vs-fine-tuning.md](./05-rag-vs-fine-tuning.md).

Và điểm quan trọng nhất về RAG, nêu ngay từ đầu:

```text
Chất lượng câu trả lời ≤ chất lượng của cái được retrieve.

Model tốt KHÔNG bù được retrieval tệ.
Nó chỉ diễn đạt thông tin sai một cách thuyết phục hơn.
```

## Mental Model

### Hai pipeline, hai vòng đời

```text
INGESTION (offline, chạy trong queue)
  document
     ↓ ① parse           PDF/DOCX/HTML → text + cấu trúc
     ↓ ② clean           bỏ header/footer/nav rác
     ↓ ③ CHUNK           ← bước quyết định chất lượng nhất
     ↓ ④ enrich          thêm metadata: tiêu đề, mục, trang, ngày
     ↓ ⑤ embed           theo lô
     ↓ ⑥ store           transaction: xoá chunk cũ + chèn mới
  chunk sẵn sàng

QUERY (online, trong request)
  question
     ↓ ⑦ transform?      viết lại query nếu cần
     ↓ ⑧ embed
     ↓ ⑨ retrieve        filter tenant TRONG query, top-50
     ↓ ⑩ rerank          top-50 → xếp lại chính xác hơn
     ↓ ⑪ pack            top-5..8 trong token budget
     ↓ ⑫ generate        prompt yêu cầu CHỈ dùng context + trích nguồn
     ↓ ⑬ verify          citation có tồn tại thật không?
  answer + citations
```

Bước ③ và bước ⑬ là hai bước tạo ra khác biệt lớn nhất, và cũng là hai bước hay bị làm sơ sài nhất.

### ③ Chunking: bước quan trọng nhất

Chunk là đơn vị được retrieve. Nên nó phải thoả **một** điều kiện:

> **Mỗi chunk phải tự nó có nghĩa** — đọc riêng nó, không có ngữ cảnh xung quanh, vẫn hiểu được nó nói về cái gì.

Sự cố ở đầu note là vi phạm điều kiện này.

```text
❌ Chia theo số ký tự cố định
   "...Nhân viên dưới 3 năm: 12 ngày. Nhân viên tr" | "ên 3 năm: 15 ngày..."
   → cắt giữa bảng, giữa câu, mất tiêu đề

✅ Chia theo CẤU TRÚC, rồi mới theo kích thước
   heading → đoạn → câu, và mỗi chunk mang theo NGỮ CẢNH CHA
```

Kỹ thuật hiệu quả nhất và đơn giản nhất là **contextual header** — thêm đường dẫn cấu trúc vào đầu mỗi chunk:

```text
[Sổ tay nhân viên 2026 › Chương 4: Phúc lợi › 4.2 Nghỉ phép › Bảng áp dụng
 từ 01/2026 (chi nhánh HN)]

Nhân viên dưới 3 năm: 12 ngày. Nhân viên trên 3 năm: 15 ngày...
```

Header đó vừa giúp embedding (chunk có bối cảnh chủ đề), vừa giúp model (nó biết bảng này áp dụng cho ai), vừa giúp citation (hiện được nguồn cho người dùng). Một thay đổi, ba lợi ích — đây là tối ưu có tỉ lệ lợi ích/công sức cao nhất trong RAG.

**Kích thước chunk — đánh đổi:**

```text
Chunk NHỎ (200–400 token)     retrieval chính xác hơn; dễ thiếu ngữ cảnh
Chunk VỪA (500–800 token)     ✓ điểm khởi đầu tốt cho phần lớn tài liệu
Chunk LỚN (1500+ token)       đủ ngữ cảnh; retrieval nhiễu; tốn budget nhanh
```

**Overlap:** cho 10–20% trùng lặp giữa hai chunk liền nhau để câu bị cắt vẫn xuất hiện đủ ở một trong hai chunk. Overlap quá nhiều thì lãng phí và làm nhiều chunh gần trùng nhau chiếm hết top-k.

**Loại tài liệu quyết định chiến lược:**

| Loại | Chia theo |
|---|---|
| Markdown / HTML có heading | cây heading — dễ nhất và tốt nhất |
| PDF văn bản | trang + đoạn; giữ số trang cho citation |
| **Bảng** | **không cắt giữa bảng**; giữ header cột với mọi phần |
| Code | theo hàm/class, không theo dòng |
| Slide | mỗi slide một chunk |
| Hội thoại / ticket | theo lượt, giữ ai nói gì |

Dòng "Bảng" là dòng gây sự cố thật nhiều nhất. Một bảng bị cắt mất tiêu đề cột trở thành dãy số vô nghĩa mà model vẫn sẽ dùng.

### ⑦ Query transformation: khi nào cần

Câu hỏi người dùng thường không phải query tốt:

```text
Vấn đề                          Cách xử lý
"còn cái kia thì sao?"           → viết lại từ history thành câu hỏi độc lập
"so sánh A và B"                 → tách thành 2 query, retrieve riêng, gộp
"chính sách refund"              → HyDE: sinh câu trả lời giả rồi embed nó
                                   (câu trả lời giả gần chunk hơn câu hỏi ngắn)
```

Nhưng: **mỗi bước transformation là thêm một lần gọi model** → thêm latency vào TTFT và thêm chi phí. Bắt đầu **không** có transformation. Thêm nó khi eval cho thấy nó cải thiện — không phải vì nó nghe hay.

Ngoại lệ đáng làm gần như luôn: **viết lại câu hỏi phụ thuộc ngữ cảnh** trong chatbot nhiều lượt. "Còn cái kia?" retrieve ra rác 100% lần.

### ⑩ Rerank: rẻ hơn bạn nghĩ, hiệu quả hơn bạn nghĩ

```text
Vector search:  nhanh, xấp xỉ, so query với chunk RIÊNG LẺ
Reranker:       chậm hơn, chính xác hơn, xem query VÀ chunk CÙNG NHAU

top-50 (vector) → rerank → top-8
```

Reranker (cross-encoder) trả lời được câu mà embedding không trả lời được: *"chunk này có thật sự trả lời câu hỏi này không?"* — chính là khoảng cách giữa "cùng chủ đề" và "trả lời được" ở [01-embeddings.md](./01-embeddings.md).

Đây thường là cải thiện chất lượng lớn nhất với công sức nhỏ nhất, sau contextual header.

### ⑫ Generate: prompt phải ràng buộc grounding

```text
QUY TẮC
· Chỉ trả lời dựa trên <documents>. Không dùng kiến thức ngoài.
· Mỗi khẳng định phải kèm [doc:id] của tài liệu chứa nó.
· Nếu <documents> không chứa câu trả lời, trả về:
  { "found": false, "reason": "..." }
· KHÔNG suy đoán, không tổng hợp thông tin không có trong tài liệu.

<documents>
[doc:a1b2] (Sổ tay 2026 › 4.2 Nghỉ phép) Nhân viên trên 3 năm: 15 ngày...
[doc:c3d4] (Sổ tay 2026 › 4.3 Nghỉ không lương) ...
</documents>

<question>{{question}}</question>
```

Ba yếu tố bắt buộc, và cả ba **kiểm chứng được bằng code**:

```text
① id tài liệu trong ngoặc → validate được rằng mọi citation tồn tại
② đường ra "found: false" → không có nó, model sẽ BỊA
③ "chỉ dựa trên documents" → đo được: câu nào không có citation?
```

### ⑬ Verify citation: bước hay bị bỏ

Model **có thể bịa id tài liệu** — kể cả id trông đúng format:

```ts
const validIds = new Set(packedDocs.map(d => d.id));
const cited = extractCitations(answer);                 // [doc:xxxx]

const hallucinated = cited.filter(id => !validIds.has(id));
if (hallucinated.length > 0) {
  metrics.increment('rag.hallucinated_citation');
  // tuỳ mức nghiêm: bỏ citation đó, hoặc retry, hoặc degrade
}

// Và: câu trả lời KHÔNG có citation nào cũng là dấu hiệu
if (cited.length === 0 && !answer.includes('found": false')) {
  metrics.increment('rag.ungrounded_answer');
}
```

Hai metric đó là hai metric quan trọng nhất của một hệ thống RAG đang chạy. Chúng phát hiện được vấn đề chất lượng **mà không cần người đánh giá**.

### Ingestion phải là job, không phải request

```text
Upload tài liệu 200 trang trong một HTTP request:
   parse + chunk + embed 400 chunk + ghi DB  →  vài phút
   → timeout, hoặc giữ kết nối rất lâu
   → lỗi giữa đường = dữ liệu ghi một nửa

✅ Upload → lưu file + tạo record status='pending' → trả 202 Accepted
   → job trong queue: parse → chunk → embed theo lô → transaction ghi
   → cập nhật status='ready' hoặc 'failed' + lý do
```

`202 Accepted` là mã đúng ở đây — xem [00-api-vocabulary.md](../../02-backend-api/00-http-api/00-api-vocabulary.md). Và job phải **idempotent**: chạy lại không tạo chunk trùng. Unique index `(document_id, chunk_index, embed_version)` ở [02-vector-search.md](./02-vector-search.md) lo việc đó.

## Example

```ts
async function answerWithRag(input: RagInput): Promise<RagResult> {
  // ⑦ chỉ viết lại khi câu hỏi phụ thuộc ngữ cảnh
  const query = input.history.length > 0
    ? await rewriter.standalone(input.question, input.history)
    : input.question;

  // ⑧⑨ filter TRONG query
  const t0 = Date.now();
  const candidates = await retriever.search(query, {
    orgId: input.orgId, visibleTo: input.userId, topK: 50,
  });
  const retrievalMs = Date.now() - t0;

  // ⑩ rerank
  const ranked = await reranker.rank(query, candidates);

  // ngưỡng: không có gì đủ liên quan thì NÓI THẬT
  const relevant = ranked.filter(c => c.score >= cfg.minScore);
  if (relevant.length === 0) {
    metrics.increment('rag.no_relevant_docs');
    return { found: false, reason: 'NO_RELEVANT_DOCUMENTS', citations: [] };
  }

  // ⑪ pack theo token
  const packed = packWithinBudget(relevant, cfg.docTokenBudget);

  // ⑫ generate
  const res = await provider.chat({
    messages: buildGroundedPrompt(packed, input.question),
    maxOutputTokens: cfg.maxOutput,
  });

  // ⑬ verify
  const { citations, hallucinated } = verifyCitations(res.text, packed);

  logger.info('rag.answer', {
    requestId: res.id,
    docIds: packed.map(d => d.id),            // ← không có dòng này thì không debug được
    topScore: relevant[0]?.score,
    retrievalMs, ttftMs: res.ttftMs,
    citationCount: citations.length,
    hallucinatedCitations: hallucinated.length,
  });

  return { found: true, answer: res.text, citations };
}
```

Đường ra `found: false` khi không có tài liệu liên quan là thiết kế đúng, không phải thất bại. **"Tôi không tìm thấy thông tin này trong tài liệu" là câu trả lời tốt hơn một câu bịa nghe hợp lý.**

## Prediction

1. Bạn chia chunk theo 1000 ký tự cố định. Tài liệu có nhiều bảng. Triệu chứng?
2. Bạn thêm contextual header vào mỗi chunk. Ba thứ nào cải thiện?
3. Bạn không có ngưỡng score và không có `found: false`. Người dùng hỏi điều không có trong tài liệu. Kết quả?
4. Bạn embed 400 chunk trong một HTTP request. Điều gì xảy ra?
5. Bạn thêm HyDE (sinh câu trả lời giả trước khi embed). TTFT thay đổi thế nào?

<details>
<summary>Đáp án</summary>

1. Bảng bị cắt, mất tiêu đề cột và tiêu đề bảng → model đọc dãy số không có nhãn và **vẫn trả lời**. Đây chính là sự cố đầu note, và nó rất khó phát hiện vì câu trả lời trông tự tin.
2. (a) **retrieval** — chunk có bối cảnh chủ đề nên embedding tốt hơn; (b) **generation** — model biết chunk nói về phạm vi nào; (c) **citation** — hiện được đường dẫn nguồn cho người dùng.
3. Model **bịa** một câu trả lời nghe hợp lý từ chunk gần nhất, kể cả khi chunk đó không liên quan. Đây là chế độ hỏng tệ nhất của RAG vì output trông giống output đúng.
4. Timeout hoặc giữ kết nối vài phút; lỗi giữa đường để lại dữ liệu một nửa. Phải là job + `202 Accepted`.
5. **TTFT tăng thêm toàn bộ thời gian sinh câu trả lời giả** (1–3 giây) — trước cả khi retrieval bắt đầu. Chỉ đáng nếu eval chứng minh chất lượng cải thiện đủ để bù.

</details>

## Failure Modes

| Triệu chứng | Bước | Nguyên nhân |
|---|---|---|
| Câu trả lời sai một chi tiết cụ thể | ③ | chunk cắt mất ngữ cảnh (bảng, tiêu đề) |
| Retrieve ra chunk cùng chủ đề nhưng vô dụng | ⑩ | thiếu rerank; embedding chỉ đo chủ đề |
| Model bịa khi không có dữ liệu | ⑫ | thiếu ngưỡng score và đường ra `found: false` |
| Citation trỏ tới tài liệu không tồn tại | ⑬ | không verify citation |
| "Còn cái kia?" trả về rác | ⑦ | không viết lại câu hỏi phụ thuộc ngữ cảnh |
| Tài liệu mới không xuất hiện | ⑥ | job ingestion fail âm thầm; không có status |
| Nội dung cũ và mới cùng xuất hiện | ⑥ | không xoá chunk cũ trong cùng transaction |
| Upload timeout với file lớn | — | ingestion trong request thay vì job |
| top-k đầy chunk gần trùng nhau | ③ | overlap quá lớn; thiếu de-duplicate |
| Chi phí tăng vọt | ⑪ | pack theo số lượng thay vì theo token |

## Debugging

Thứ tự này tách được retrieval khỏi generation — câu hỏi trung tâm của mọi sự cố RAG:

```text
1. docIds của request lỗi → tài liệu ĐÚNG có trong đó không?
     KHÔNG → RETRIEVAL. Đi bước 2.
     CÓ    → GENERATION hoặc CHUNKING. Đi bước 4.

2. Chạy retrieval với index TẮT → tài liệu đúng xuất hiện?
     CÓ → index ANN bỏ sót (xem note 02)
     KHÔNG → embedding/chunking. Đi bước 3.

3. Tìm chunk chứa câu trả lời trong DB bằng LIKE/full-text
     · Nó có tồn tại không? → nếu không: ingestion sai
     · Nội dung nó có tự-đủ-nghĩa không? → nếu không: CHUNKING

4. ĐỌC chunk đã đưa vào context.
     Nó có thật sự chứa câu trả lời? → nếu không: chunking
     Có → prompt/model không dùng đúng nó: kiểm ràng buộc grounding
```

Bước 3 với `LIKE` là bước ít ai làm và hay cho câu trả lời nhất: **nhìn bằng mắt vào chunk thật.** Rất nhiều sự cố "RAG kém" thực ra là "chunk là mảnh vô nghĩa".

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Chunk nhỏ | retrieval chính xác | dễ mất ngữ cảnh |
| Chunk lớn | đủ ngữ cảnh | retrieval nhiễu, tốn budget |
| Contextual header | retrieval + generation + citation đều tốt hơn | thêm token mỗi chunk (đáng) |
| Rerank | cải thiện lớn nhất/công sức | +10–100ms, có thể thêm chi phí |
| Query rewriting | xử lý được câu phụ thuộc ngữ cảnh | +1 lần gọi model vào TTFT |
| HyDE | tốt cho câu hỏi ngắn/mơ hồ | +1 lần gọi model; đo trước khi dùng |
| Ngưỡng score cao | ít trả lời sai | nhiều "không tìm thấy" hơn |
| Verify citation | phát hiện hallucination tự động | thêm một bước xử lý (rẻ) |

## Explain Without Notes

1. Chất lượng câu trả lời **bị chặn trên** bởi chất lượng retrieval; model tốt không bù được.
2. Chunk phải **tự nó có nghĩa** — contextual header là cách rẻ nhất đạt được điều đó.
3. Không cắt giữa bảng, và giữ tiêu đề cột với mọi mảnh.
4. Prompt phải ràng buộc grounding + citation + đường ra `found: false`.
5. Verify citation ở code; và log `docIds` để tách retrieval khỏi generation.

## Related

- [Embedding](./01-embeddings.md) — cùng chủ đề ≠ trả lời được
- [Vector search](./02-vector-search.md) — retrieve, filter, hybrid
- [RAG failure modes](./04-rag-failure-modes.md) — bảng chẩn đoán đầy đủ
- [RAG vs fine-tuning](./05-rag-vs-fine-tuning.md)
- [Context engineering](../01-context-and-output/02-context-engineering.md) — pack theo token
- [Prompt như input contract](../01-context-and-output/01-prompt-as-input-contract.md) — ràng buộc kiểm chứng được
- [RAG & agent evaluation](../05-evaluation/02-rag-and-agent-evaluation.md) — đo recall@k, faithfulness
- [Prompt injection](../06-safety/01-prompt-injection.md) — tài liệu retrieve **không** đáng tin
- [Message queues](../../03-database/04-message-queues/README.md) — ingestion là job
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — `202 Accepted`
