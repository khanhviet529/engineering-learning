---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-ai-observability.md
related:
  - 03-ai-caching.md
  - 04-latency-engineering.md
---

# Cost engineering và model routing

> Hoá đơn tháng đầu: 340 USD. Tháng thứ tư: 11.200 USD, với lượng người dùng tăng 2.4×. Không ai đổi model. Ba nguyên nhân, tìm ra sau khi thêm metric theo chiều: prompt cache bị phá bởi một dòng timestamp thêm vào tháng thứ hai; `top_k` được tăng từ 5 lên 20 để "chắc chắn"; và hội thoại của người dùng tích cực đã dài tới 200 lượt. Không nguyên nhân nào là "model đắt".

## Position

```text
Mọi quyết định thiết kế trong track này có một cái giá.
Note này nói cách đo và cách giảm — theo thứ tự hiệu quả.
```

## Problem

Chi phí AI khác chi phí hạ tầng thường ở một điểm quyết định:

```text
Hạ tầng thường:  chi phí theo CAPACITY  → ổn định, dự đoán được
AI:              chi phí theo REQUEST và theo ĐỘ DÀI DỮ LIỆU
                 → tăng theo hành vi người dùng, không theo kế hoạch của bạn
```

Nghĩa là: **chi phí có thể tăng gấp mười lần mà không ai deploy gì.** Người dùng chỉ đơn giản là dùng nhiều hơn, hoặc hội thoại dài hơn.

Và công thức đầy đủ, không chỉ token:

```text
cost = input_tokens × giá_input
     + output_tokens × giá_output          ← đắt ~5× input
     + embedding_tokens × giá_embed        ← ingestion + mọi query
     + rerank_calls × giá_rerank
     + số_lần_gọi (retry · tool loop · agent step)   ← nhân TẤT CẢ ở trên
     + hạ tầng (vector DB, Redis, worker)
```

Dòng "số lần gọi" là dòng nhân mọi thứ khác, và là dòng người ta hay quên.

## Mental Model

### Bảy đòn giảm chi phí, theo thứ tự (miễn phí trước, đánh đổi sau)

```text
KHÔNG ĐÁNH ĐỔI CHẤT LƯỢNG
① PROMPT CACHE            50–90% input token nếu prefix ổn định  ★ làm trước
② GIỚI HẠN OUTPUT          output đắt ~5× input
③ CẮT INPUT KHÔNG CẦN      history không trần · top_k quá lớn · few-shot phình
④ CHẶN VÒNG LẶP            retry có trần · agent stop conditions
⑤ BATCH cho việc không gấp thường rẻ hơn đáng kể

CÓ ĐÁNH ĐỔI — cần eval
⑥ MODEL ROUTING            model nhỏ cho tác vụ đơn giản
⑦ FINE-TUNE để dùng model nhỏ  chỉ ở quy mô rất lớn
```

Thứ tự này quan trọng. Người ta thường bắt đầu ở ⑥ (đổi model) vì nó dễ nghĩ tới, trong khi ①–④ **miễn phí về chất lượng** và thường cho mức giảm lớn hơn.

Sự cố ở đầu note nằm trọn trong ①③ — không có gì liên quan tới model.

### ① Prompt cache là đòn lớn nhất, và dễ tự phá nhất

Cache hoạt động theo **tiền tố khớp byte**. Một byte đổi ở đầu là mất toàn bộ.

```text
Thứ tự render:  tools → system → messages

┌── ỔN ĐỊNH (cache được) ────────────────────┐
│ tool schemas (THỨ TỰ XÁC ĐỊNH)             │
│ system prompt (KHÔNG timestamp, KHÔNG UUID)│
│ few-shot                                    │
├── BIẾN ĐỔI (sau breakpoint) ───────────────┤
│ memory · tài liệu RAG · history · câu hỏi  │
└─────────────────────────────────────────────┘
```

Năm thứ phá cache một cách âm thầm:

```text
✗ new Date().toISOString() trong system prompt      ← sự cố đầu note
✗ requestId / userId ở đầu prompt
✗ tool list sinh từ Object.keys / Set (thứ tự không xác định)
✗ JSON không sort key khi serialize schema
✗ đổi model hoặc đổi tham số giữa các request (cache theo model)
```

Cách kiểm duy nhất đáng tin: **`cachedInputTokens` trong `usage`.**

```text
cachedInputTokens = 0 trên mọi request  ⇒  cache KHÔNG hoạt động
                                            (bất kể bạn đã cấu hình gì)
```

Nếu cần thời gian hiện tại trong prompt, đặt nó **sau** phần ổn định — hoặc tốt hơn, làm tròn tới ngày để nó chỉ đổi một lần mỗi ngày.

### ② Output đắt hơn input nhiều — giới hạn nó

```text
Với giá thường gặp (output ≈ 5× input):

Câu trả lời 2000 token thay vì 400 token
  → chi phí output tăng 5×
  → latency tăng (output sinh tuần tự)
  → và người dùng thường KHÔNG đọc hết

Ba cách giảm, không mất chất lượng:
  · maxOutputTokens hợp lý cho từng route (không dùng một số chung)
  · prompt yêu cầu ngắn gọn tường minh ("tối đa 3 câu")
  · structured output — JSON không có văn xuôi thừa
```

### ③ Cắt input không cần: bốn chỗ hay phình

```text
HISTORY không có trần        → chi phí một hội thoại tăng BÌNH PHƯƠNG số lượt
top_k quá lớn                → 20 chunk thay vì 5: 4× token tài liệu
FEW-SHOT phình dần           → mỗi ví dụ tốn token MỖI request
TOOL_RESULT không có trần    → 200KB JSON nằm trong context mọi lượt sau
```

Cả bốn đều có ghi chú ở nơi khác trong track, nhưng đây là chỗ thấy tổng tác động của chúng.

### ⑤ Batch: đòn bị bỏ qua nhiều nhất

```text
Việc KHÔNG cần trả lời ngay:
  · embed tài liệu khi ingest
  · phân loại tồn đọng
  · sinh tóm tắt hằng đêm
  · chạy eval trên golden dataset

→ Nhiều provider có batch API rẻ hơn đáng kể (thường ~50%)
→ Đổi lại: kết quả tới sau (giờ, không phải giây)
```

Nếu bạn có bất kỳ việc nào trong danh sách trên đang chạy đồng bộ, đó là tiết kiệm gần như miễn phí. Xem [04-message-queues/](../../03-database/04-message-queues/README.md).

### ⑥ Model routing: heuristic trước, model phân loại sau

```text
Tác vụ đơn giản, khối lượng lớn      → model nhỏ
  phân loại · trích xuất field · viết lại query · tóm tắt ngắn

Suy luận nhiều bước, giá trị cao      → model mạnh
  phân tích · viết code · quyết định · tổng hợp nhiều tài liệu
```

Ba cách route, theo độ phức tạp:

```text
① THEO ROUTE (đơn giản nhất, làm trước)
   /api/classify  → model nhỏ
   /api/analyze   → model mạnh
   → không cần logic gì; chỉ là config

② THEO HEURISTIC
   độ dài input · có tài liệu không · loại tác vụ · gói của khách hàng

③ ESCALATION (đắt hơn nhưng chất lượng tốt)
   thử model nhỏ → nếu confidence thấp / output không hợp lệ → model mạnh
   ⚠ trường hợp xấu: TỐN CẢ HAI. Chỉ đáng khi tỉ lệ escalate thấp.
```

Cách ① giải quyết phần lớn nhu cầu và không có rủi ro. Đừng xây bộ phân loại độ phức tạp bằng LLM để chọn model — đó là thêm một lần gọi model để tiết kiệm một lần gọi model.

Và cảnh báo về ③:

```text
Tỉ lệ escalate 20%:  0.8 × rẻ + 0.2 × (rẻ + đắt)  → có thể vẫn tiết kiệm
Tỉ lệ escalate 60%:  → ĐẮT HƠN dùng model mạnh ngay từ đầu
```

Phải đo tỉ lệ escalate trước khi kết luận nó tiết kiệm.

### Một lựa chọn rẻ hơn routing: giảm effort trên cùng model

Một số model có tham số điều chỉnh **độ sâu suy luận** (effort/reasoning level). Hạ nó trên cùng model thường:

```text
✓ rẻ hơn đáng kể
✓ giữ nguyên một cache namespace (routing nhiều model làm mất cache reuse)
✓ ít rủi ro chất lượng hơn đổi hẳn sang model khác
```

Nên thử **model tốt ở mức effort thấp** trước khi xây cascade nhiều model. Cascade có chi phí ẩn: cache theo model, nên hai model là hai cache, và eval phải chạy cho cả hai.

### Đo `cost per completed task`, không phải `cost per request`

```text
Route A: model nhỏ, $0.002/request, 30% cần retry hoặc chuyển người
   → chi phí thật/việc xong ≈ $0.002 / 0.7 ≈ $0.0029 + chi phí người

Route B: model mạnh, $0.008/request, 3% cần can thiệp
   → ≈ $0.0082

B đắt gấp 4 mỗi request. Chênh lệch thật nhỏ hơn nhiều —
và nếu tính chi phí NGƯỜI xử lý 30% kia, B có thể rẻ hơn.
```

Đây là lỗi so sánh phổ biến nhất trong tối ưu chi phí AI: **so giá mỗi lần gọi thay vì giá mỗi việc hoàn thành.**

### Cost cap: ba tầng

```text
① THEO USER/NGÀY      chặn lạm dụng cá nhân
② THEO ORG/NGÀY       bảo vệ hợp đồng, chia tài nguyên
③ THEO TỔ CHỨC/NGÀY   chặn thảm hoạ — kill switch cuối
```

Tầng ③ phải là **cứng**: khi vượt, từ chối request mới với thông báo rõ, không phải "cứ chạy rồi báo cáo sau". Một vòng lặp agent lỗi có thể tiêu hết ngân sách tháng trong vài giờ.

```ts
async function assertBudget(ctx: Ctx, estimatedUsd: number) {
  const [user, org, global] = await Promise.all([
    cost.spentToday({ userId: ctx.userId }),
    cost.spentToday({ orgId: ctx.orgId }),
    cost.spentToday({}),
  ]);
  if (user + estimatedUsd > cfg.caps.user) throw new AppError('AI_USER_BUDGET');
  if (org + estimatedUsd > cfg.caps.org) throw new AppError('AI_ORG_BUDGET');
  if (global + estimatedUsd > cfg.caps.global) throw new AppError('AI_GLOBAL_BUDGET');
}
```

## Example

Điều tra hoá đơn tăng, theo thứ tự cho câu trả lời nhanh nhất:

```sql
-- 1. Route nào? (thường một route chiếm 80%)
SELECT route, sum(cost_usd), count(*), sum(cost_usd)/count(*) AS per_call
FROM llm_call_log WHERE day >= current_date - 30
GROUP BY route ORDER BY 2 DESC;

-- 2. Input hay output? (input tăng = context phình; output tăng = trả lời dài)
SELECT day, sum(input_tokens), sum(output_tokens), avg(cached_input_tokens)
FROM llm_call_log GROUP BY day ORDER BY day;

-- 3. Cache còn hoạt động? (cột 3 tụt về 0 = có ai phá prefix)
--    → nhìn avg(cached_input_tokens) theo ngày ở query trên

-- 4. Số lần gọi mỗi request người dùng (retry/tool/agent nhân lên)
SELECT request_id, count(*) AS calls, sum(cost_usd)
FROM llm_call_log WHERE day = current_date
GROUP BY request_id ORDER BY 3 DESC LIMIT 20;

-- 5. Ai ở đuôi phân bố
SELECT org_id, sum(cost_usd) FROM llm_call_log
WHERE day >= current_date - 7 GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

Năm truy vấn đó tìm ra cả ba nguyên nhân ở đầu note. Chúng chỉ chạy được nếu bạn đã log theo [01-ai-observability.md](./01-ai-observability.md).

## Prediction

1. Bạn thêm `Thời gian: ${new Date()}` vào dòng đầu system prompt. Chi phí input thay đổi thế nào?
2. Bạn tăng `top_k` từ 5 lên 20. Chi phí và chất lượng?
3. Hội thoại 200 lượt. Chi phí lượt thứ 200 so với lượt đầu?
4. Bạn dùng escalation: model nhỏ trước, model mạnh nếu confidence thấp. Tỉ lệ escalate 60%. Tiết kiệm không?
5. Route A: $0.002/req nhưng 30% phải chuyển người. Route B: $0.008/req, 3%. Cái nào rẻ hơn?
6. Bạn xây một bộ phân loại bằng LLM để chọn model. Vấn đề?

<details>
<summary>Đáp án</summary>

1. **Tăng mạnh** — mọi request thành cache miss. Nếu trước đó cache đang tiết kiệm 70% input token, chi phí input tăng gần 3×. Đây là nguyên nhân số một trong sự cố đầu note.
2. Chi phí token tài liệu **~4×**; chất lượng có thể **giảm** vì loãng context. Đây là đánh đổi lỗ ở cả hai chiều.
3. Lượt 200 gửi lại ~199 lượt trước → **~200× lượt đầu** về input token cho một lượt. Tổng cả hội thoại tăng theo bình phương.
4. **Không** — có thể đắt hơn dùng model mạnh ngay. `0.4 × rẻ + 0.6 × (rẻ + đắt)` vượt `1 × đắt` khi tỉ lệ escalate cao.
5. Tính theo việc hoàn thành: A ≈ $0.0029 **cộng chi phí người** cho 30%; B ≈ $0.0082. Nếu chi phí người đáng kể (thường là vậy), **B rẻ hơn**.
6. Bạn **thêm một lần gọi model** để tiết kiệm một lần gọi model — và lần thêm đó có latency riêng. Dùng heuristic (route, độ dài, loại tác vụ) hoặc route theo endpoint.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Chi phí tăng gấp nhiều lần, không ai deploy gì | history không trần; hoặc cache bị phá |
| `cachedInputTokens` = 0 | biến động trong tiền tố; tool list không có thứ tự |
| Một org chiếm 70% hoá đơn | thiếu cost cap theo org |
| Escalation không tiết kiệm | tỉ lệ escalate cao; không đo trước |
| Model nhỏ rẻ hơn nhưng tổng chi phí tăng | nhiều retry; nhiều can thiệp người |
| Không biết tối ưu ở đâu | không log cost theo route/model |
| Chi phí embedding cao bất ngờ | embed lại toàn bộ nhiều lần; hoặc embed mỗi query không cache |
| Agent tiêu hết ngân sách trong vài giờ | thiếu stop conditions và cost cap |
| Batch job chạy đồng bộ với giá thường | không dùng batch API |

## Debugging

```text
1. Cost theo ROUTE → thường một route chiếm phần lớn
2. Input vs output token theo ngày → context phình hay trả lời dài?
3. cachedInputTokens theo ngày → mốc nào cache bị phá?
4. Số lần gọi model / request người dùng → retry hay tool loop?
5. Cost p99 theo org/user → ai ở đuôi
6. Có việc nào không gấp đang chạy đồng bộ?
```

## Trade-offs

| Đòn | Giảm chi phí | Rủi ro chất lượng |
|---|---|---|
| Prompt cache | **rất cao** (50–90% input) | không |
| Giới hạn output | cao | thấp — có thể cắt câu trả lời cần dài |
| Trần history | cao | trung — mất ngữ cảnh xa (bù bằng tóm tắt) |
| Giảm top_k | trung–cao | thường **cải thiện** chất lượng |
| Trần tool_result | trung | thấp — cần cờ `truncated` |
| Batch API | cao cho việc nền | không — chỉ chậm hơn |
| Effort thấp cùng model | trung–cao | thấp; giữ được cache |
| Model nhỏ hơn | cao | **cần eval** |
| Escalation | tuỳ tỉ lệ | trung; có thể đắt hơn |
| Fine-tune để dùng model nhỏ | cao ở quy mô | cao; cần eval và bảo trì |

## Explain Without Notes

1. Chi phí AI theo **request và độ dài dữ liệu** → tăng theo hành vi người dùng, không theo kế hoạch.
2. Thứ tự tối ưu: cache → giới hạn output → cắt input → chặn vòng lặp → batch → **rồi mới** đổi model.
3. `cachedInputTokens = 0` là dấu hiệu bạn đang trả nhiều lần mức cần thiết.
4. So sánh bằng **cost per completed task**, không phải cost per request.
5. Ba tầng cost cap, và tầng tổ chức phải là kill switch cứng.

## Related

- [AI observability](./01-ai-observability.md) — dữ liệu để làm mọi thứ trong note này
- [AI caching](./03-ai-caching.md) — đòn ① chi tiết
- [Latency engineering](./04-latency-engineering.md) — cùng đòn, mục tiêu khác
- [Context window management](../02-chatbot-web/06-context-window-management.md) — đòn ③
- [Agent loop](../04-agents-tools/03-agent-loop.md) — đòn ④
- [Tool calling](../04-agents-tools/01-tool-calling.md) — trần `tool_result`
- [Context engineering](../01-context-and-output/02-context-engineering.md) — top_k và budget
- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — cost trong cùng báo cáo
- [RAG vs fine-tuning](../03-rag/05-rag-vs-fine-tuning.md) — đòn ⑦
- [Message queues](../../03-database/04-message-queues/README.md) — batch
- [Latency, throughput, bottleneck](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — đuôi phân bố
