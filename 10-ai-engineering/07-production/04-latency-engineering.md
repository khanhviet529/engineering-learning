---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-ai-observability.md
related:
  - ../02-chatbot-web/03-streaming.md
  - 02-cost-and-model-routing.md
---

# Latency engineering: TTFT là con số người dùng cảm nhận

> Team tối ưu chatbot trong ba tuần: đổi sang model nhanh hơn, giảm `max_tokens`, thêm index cho vector search. Total latency giảm từ 5.8s xuống 3.9s — cải thiện 33%. Điểm hài lòng người dùng **không đổi**. Nguyên nhân: TTFT vẫn là 2.9 giây, vì mỗi request chạy một lần viết lại query, rồi retrieval, rồi rerank — **tuần tự** — trước khi gọi model chính. Ba tuần tối ưu phần người dùng không cảm nhận.

## Position

```text
request ──▶ [ trước khi có token đầu ] ──▶ token đầu ──▶ ... ──▶ xong
             ↑ TTFT — người dùng cảm nhận       ↑ total — ít quan trọng hơn
```

## Problem

Với AI, "chậm" là hai con số khác nhau, và tối ưu sai con số là cách tiêu thời gian phổ biến nhất:

```text
TTFT (time to first token)
   = mọi thứ TRƯỚC khi model sinh token đầu
   = auth + rate limit + DB + retrieval + rerank + gửi request
     + provider xử lý toàn bộ INPUT
   ⇒ chi phối bởi: ĐỘ DÀI INPUT và SỐ BƯỚC TUẦN TỰ TRƯỚC ĐÓ

TOTAL
   = TTFT + thời gian sinh toàn bộ output
   ⇒ chi phối bởi: ĐỘ DÀI OUTPUT (sinh tuần tự, không song song hoá được)
```

Và điều làm chúng không tương đương về mặt trải nghiệm:

```text
TTFT 0.6s, total 6.0s   →  chữ chạy từ giây 0.6. Cảm giác: NHANH.
TTFT 2.9s, total 3.9s   →  im lặng 2.9 giây. Cảm giác: TREO.

Total của trường hợp thứ hai TỐT HƠN. Trải nghiệm TỆ HƠN.
```

Đây là hệ quả trực tiếp của **latency cảm nhận** đã dạy ở [03-slow-api-ux.md](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) — AI chỉ làm nó rõ hơn vì response rất dài.

## Mental Model

### Phân rã TTFT: bốn nhóm, xử lý khác nhau

```text
① CỐ ĐỊNH, NHỎ         auth · rate limit · load conversation      ~30ms
② TIỀN XỬ LÝ TUẦN TỰ    rewrite query · embed · retrieve · rerank  ~200–900ms  ★
③ ĐỘ DÀI INPUT          provider xử lý toàn bộ prompt             ~200–2000ms ★
④ HÀNG ĐỢI PROVIDER     tải của provider, không kiểm soát được    thay đổi
```

Nhóm ② và ③ là hai nhóm bạn kiểm soát được, và là hai nhóm gây sự cố ở đầu note.

### Nhóm ②: song song hoá, đừng xếp hàng

```text
❌ TUẦN TỰ — 780ms trước khi gọi model
   rewrite query (300ms) → embed (90ms) → retrieve (140ms) → rerank (250ms)

✅ SONG SONG những gì độc lập — 480ms
   ┌─ embed câu hỏi gốc (90ms) → retrieve (140ms) ─┐
   ├─ rewrite query (300ms) ───────────────────────┤ → rerank (250ms)
   └─ load memory / user data (40ms) ──────────────┘
   → 300ms (nhánh dài nhất) + 250ms rerank = 550ms... vẫn còn rerank
```

Ba kỹ thuật, theo hiệu quả:

**① Bỏ bước không chứng minh được giá trị.** Rewrite query 300ms có cải thiện chất lượng đo được không? Nếu chưa đo, bỏ nó — đó là 300ms TTFT cho mọi người dùng.

```text
Rewrite chỉ khi CẦN:  chỉ chạy khi câu hỏi phụ thuộc ngữ cảnh
                      ("còn cái kia?") — phát hiện bằng heuristic rẻ
                      ⇒ 90% request không phải trả 300ms đó
```

**② Song song hoá phần độc lập.**

```ts
const [docs, memory, userData] = await Promise.all([
  retriever.search(question, { orgId, topK: 50 }),
  memoryService.relevantFacts(userId),
  users.contextFor(userId),
]);
```

**③ Chuyển việc ra khỏi đường request.** Tóm tắt hội thoại, cập nhật memory, ghi analytics — tất cả có thể xảy ra **sau** khi trả lời, trong queue.

```text
❌ tóm tắt history → build context → gọi model
✅ build context với summary ĐANG CÓ → gọi model → xếp job tóm tắt
```

### Nhóm ③: input dài làm TTFT cao

```text
8k token input   → TTFT ~500ms
80k token input  → TTFT ~2000ms+

Cùng model, cùng output. Chỉ khác độ dài input.
```

Nên mọi đòn giảm input ở [02-cost-and-model-routing.md](./02-cost-and-model-routing.md) **cũng là đòn giảm TTFT**:

```text
trần history · giảm top_k · trần tool_result · few-shot gọn
→ vừa rẻ hơn VỪA nhanh hơn
```

Đây là điểm đáng chú ý: chi phí và TTFT **cùng chiều**. Rất ít khi bạn phải chọn giữa hai cái.

Và prompt cache giúp cả hai:

```text
Prefix đã cache → provider không phải xử lý lại phần đó
→ TTFT giảm đáng kể, không chỉ chi phí giảm
```

### Total latency: chỉ có ba cách giảm

```text
① OUTPUT NGẮN HƠN        maxOutputTokens + prompt yêu cầu ngắn gọn
② MODEL SINH NHANH HƠN    model nhỏ hơn; hoặc chế độ tốc độ cao nếu provider có
③ KHÔNG CHỜ ĐỦ           streaming — người dùng đọc trong lúc sinh
```

Cách ③ không giảm total mà **làm total gần như không quan trọng**. Đó là lý do streaming là đòn đầu tiên, không phải đòn cuối. Xem [03-streaming.md](../02-chatbot-web/03-streaming.md).

### Tool và nhiều lượt: chỗ latency ẩn

```text
Một lượt có tool:
  llm-call-1 (TTFT 700ms + sinh 400ms)
  → tool (200ms)
  → llm-call-2 (TTFT 800ms + sinh 2000ms)
  = ~4.1s, và người dùng thấy KHOẢNG LẶNG giữa hai lượt
```

Ba biện pháp:

```text
① SONG SONG tool độc lập  → Promise.all, không tuần tự
② TIMEOUT NGẮN cho tool    → tool chậm không giữ cả request
③ HIỂN THỊ TRẠNG THÁI     → "đang tra đơn hàng..." trong khoảng lặng
```

Biện pháp ③ không giảm latency chút nào và **cải thiện trải nghiệm nhiều nhất**. Khoảng lặng có giải thích khác hoàn toàn khoảng lặng không giải thích. Xem [04-chat-ux-and-state.md](../02-chatbot-web/04-chat-ux-and-state.md).

### Đo ở đâu: bốn điểm

```text
① Browser        người dùng thật cảm nhận gì (kể cả mạng của họ)
② Backend nhận   loại trừ mạng
③ Trước llm-call  = nhóm ①+②  ← con số bạn tối ưu được nhiều nhất
④ ttft từ provider = nhóm ③+④
```

Điểm ③ là điểm hay bị bỏ đo, và là điểm chứa nút thắt ở đầu note. Không có nó, bạn không biết 2.9 giây là do mình hay do provider.

```ts
span.setAttributes({
  'ai.pre_model_ms': preModelMs,      // ③ — của BẠN
  'ai.provider_ttft_ms': res.ttftMs,  // ④ — của provider
  'ai.total_ms': totalMs,
});
```

## Example

Ngân sách TTFT — đặt mục tiêu rồi đo, không tối ưu ngẫu nhiên:

```text
Mục tiêu TTFT p95: 1.200ms

  auth + rate limit + load conv        80ms
  build context (SONG SONG)           300ms
     ├─ retrieval (embed+search)      230ms
     ├─ memory                         40ms
     └─ rewrite (CHỈ 10% request)     300ms  ← không tính vào p95 chung
  rerank                              250ms   ← ứng viên cắt đầu tiên
  provider ttft (input ~9k, cached)   550ms
  ──────────────────────────────────────────
  tổng                              ~1.180ms
```

Bảng này làm được ba việc: nói rõ mục tiêu, chỉ ra ứng viên cắt, và cho phép biết khi nào một thay đổi làm hỏng mục tiêu.

Và tối ưu có điều kiện thay vì tối ưu cho mọi request:

```ts
// Rewrite chỉ khi câu hỏi thật sự phụ thuộc ngữ cảnh
const needsRewrite = history.length > 0 && looksContextDependent(question);
// looksContextDependent: heuristic RẺ — câu rất ngắn, có đại từ, không có danh từ chính

const [docs, memory] = await Promise.all([
  (async () => {
    const q = needsRewrite ? await rewriter.standalone(question, history) : question;
    return retriever.search(q, { orgId, topK: 50 });
  })(),
  memoryService.relevantFacts(userId),
]);

// Rerank chỉ khi có nhiều ứng viên và điểm sát nhau
const ranked = docs.length > 12 && scoresAreClose(docs)
  ? await reranker.rank(question, docs)
  : docs;
```

Hai điều kiện đó giữ chất lượng cho ca cần và cắt 250–550ms cho phần lớn request.

## Prediction

1. Bạn giảm total từ 5.8s xuống 3.9s nhưng TTFT giữ 2.9s. Người dùng thấy khác không?
2. Bạn thêm rewrite query (300ms) cho mọi request. TTFT p95 đổi thế nào? Ai được lợi?
3. Bạn tăng input từ 8k lên 80k token. TTFT và total đổi thế nào?
4. Bạn chạy 3 tool tuần tự, mỗi cái 200ms. Song song thì tiết kiệm bao nhiêu?
5. Bạn hiện "đang tra đơn hàng..." trong khoảng lặng. Latency đổi bao nhiêu?
6. Prompt cache hoạt động. Ngoài chi phí, còn gì cải thiện?

<details>
<summary>Đáp án</summary>

1. **Gần như không** — họ vẫn im lặng 2.9 giây trước khi thấy chữ. Đây là sự cố đầu note: ba tuần tối ưu con số người dùng không cảm nhận.
2. TTFT p95 **tăng ~300ms cho mọi người**. Chỉ ~10% request (câu hỏi phụ thuộc ngữ cảnh) được lợi. Chạy có điều kiện.
3. **TTFT tăng mạnh** (provider phải xử lý toàn bộ input trước khi sinh); phần sinh output **không đổi**, nên total tăng bằng phần TTFT tăng.
4. Từ 600ms xuống ~200ms — **tiết kiệm 400ms**, và nó nằm trong khoảng lặng người dùng cảm nhận rõ nhất.
5. **Không đổi chút nào.** Nhưng trải nghiệm cải thiện đáng kể — khoảng lặng có giải thích khác khoảng lặng không giải thích.
6. **TTFT giảm** — provider không phải xử lý lại phần prefix đã cache. Cache là đòn duy nhất cải thiện cả chi phí và TTFT mà không đánh đổi gì.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Tối ưu nhiều mà người dùng không thấy | tối ưu total thay vì TTFT |
| TTFT cao dù model nhanh | tiền xử lý tuần tự; hoặc input quá dài |
| Khoảng lặng dài giữa các lượt tool | tool tuần tự; không hiện trạng thái |
| Latency tăng dần theo hội thoại | history không trần → input dài dần |
| p99 rất tệ so với p50 | output dài ở đuôi; hoặc provider throttle |
| "Nhanh ở dev, chậm ở production" | context thật lớn hơn nhiều; hoặc thiếu cache |
| Không biết chậm do mình hay provider | không đo `pre_model_ms` riêng khỏi `ttft` |
| Stream không hiện dần ở production | proxy buffer (xem note streaming) |
| Rewrite/rerank làm chậm mọi request | chạy vô điều kiện thay vì có điều kiện |

## Debugging

```text
1. Tách TTFT vs total. Nếu chưa tách được → làm điều này trước.
2. Trong TTFT: pre_model_ms là bao nhiêu? provider_ttft là bao nhiêu?
     pre_model cao → nút thắt Ở BẠN (nhóm ②)
     provider_ttft cao → input dài (nhóm ③) hoặc tải provider (④)
3. Trace: bước nào trong build-context chiếm nhiều nhất?
4. Có bước nào tuần tự mà độc lập được không?
5. Có bước nào chưa chứng minh được giá trị (rewrite, rerank)?
6. input_tokens p95 = ? Có trần chưa?
7. cachedInputTokens > 0? Cache giúp cả TTFT.
```

Bước 2 là bước tách trách nhiệm quan trọng nhất — và nó cần một trường trong span, không cần công cụ mới.

## Trade-offs

| Đòn | Giảm | Mất |
|---|---|---|
| Streaming | TTFT cảm nhận | phức tạp vòng đời (huỷ, ngắt) |
| Song song hoá tiền xử lý | TTFT | code phức tạp hơn một chút |
| Bỏ rewrite/rerank | TTFT rõ rệt | chất lượng cho một số ca |
| Rewrite/rerank có điều kiện | TTFT cho phần lớn request | cần heuristic; heuristic có thể sai |
| Giảm input (trần history, top_k) | TTFT **và** chi phí | có thể mất ngữ cảnh |
| Prompt cache | TTFT **và** chi phí | không mất gì — chỉ cần prefix ổn định |
| Model nhỏ hơn | TTFT + total | chất lượng — cần eval |
| Output ngắn hơn | total + chi phí | có thể cắt câu trả lời cần dài |
| Hiện trạng thái tool | không giảm gì | trải nghiệm tốt hơn nhiều; rẻ nhất |

Hai dòng đáng chú ý: **prompt cache** và **hiện trạng thái** là hai đòn không có mặt "mất" thật sự. Làm chúng trước.

## Explain Without Notes

1. TTFT là con số người dùng cảm nhận; total thì ít hơn nhiều nếu có streaming.
2. TTFT = tiền xử lý của bạn + độ dài input; total = độ dài output.
3. Đo `pre_model_ms` riêng khỏi `provider_ttft` — không có nó bạn không biết lỗi ở đâu.
4. Song song hoá phần độc lập; chạy rewrite/rerank **có điều kiện**; đẩy việc nền ra queue.
5. Giảm input và prompt cache cải thiện **cả** chi phí và TTFT — hiếm khi phải chọn.

## Related

- [Streaming](../02-chatbot-web/03-streaming.md) — đòn số một cho latency cảm nhận
- [AI observability](./01-ai-observability.md) — đo TTFT và pre_model_ms
- [Cost & model routing](./02-cost-and-model-routing.md) — cùng đòn, cùng chiều
- [AI caching](./03-ai-caching.md) — cache giúp cả TTFT
- [Context window management](../02-chatbot-web/06-context-window-management.md) — input dài dần
- [Chat UX & state](../02-chatbot-web/04-chat-ux-and-state.md) — hiện trạng thái tool
- [RAG pipeline](../03-rag/03-rag-pipeline.md) — rewrite, rerank có giá latency
- [Slow API UX](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) — latency thật vs cảm nhận
- [Latency, throughput, bottleneck](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md)
- [Full-stack triage](../../05-cross-cutting/performance/07-full-stack-triage.md)
