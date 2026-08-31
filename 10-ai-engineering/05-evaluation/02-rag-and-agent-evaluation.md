---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-evaluating-ai-features.md
  - ../03-rag/04-rag-failure-modes.md
related:
  - ../04-agents-tools/03-agent-loop.md
---

# Đánh giá RAG và agent: tách tầng ra mà đo

> Một team đo RAG bằng một con số: "độ chính xác câu trả lời 71%". Họ dành sáu tuần cải thiện prompt generation, con số lên 74%. Rồi một người đo riêng retrieval: **recall@5 là 52%** — gần một nửa số câu hỏi không có tài liệu đúng trong context. Không prompt nào cứu được điều đó. Sáu tuần đã tối ưu tầng không phải nút thắt.

## Position

```text
Một con số cuối
      │
      ▼  ← NOTE NÀY: tách thành các số theo TẦNG
retrieval · generation · từng bước agent
```

## Problem

RAG và agent là **pipeline nhiều tầng**. Một con số cuối cùng không nói được tầng nào đang kém — và tối ưu sai tầng là cách tiêu thời gian phổ biến nhất trong AI engineering.

```text
answer_correctness = f(retrieval, generation)

0.71 có thể là:   retrieval 0.95 × generation 0.75
              hoặc retrieval 0.52 × generation 0.95   ← trường hợp đầu note

Hai tình huống này cần hai kế hoạch hành động HOÀN TOÀN KHÁC NHAU.
```

Nguyên tắc:

> **Đo mỗi tầng riêng, bằng chỉ số riêng của tầng đó.** Con số end-to-end chỉ để biết có vấn đề; con số theo tầng mới nói phải sửa ở đâu.

## Mental Model

### RAG: hai bộ chỉ số

```text
TẦNG RETRIEVAL — không cần model nào để đo
   recall@k        tài liệu đúng CÓ trong top-k không?     ← quan trọng nhất
   MRR             nó ở hạng bao nhiêu?
   precision@k     bao nhiêu trong k là liên quan?
   no-hit rate     tỉ lệ câu hỏi không tìm được gì

TẦNG GENERATION — cho trước context ĐÚNG
   faithfulness    câu trả lời có dựa trên context không? (không bịa)
   answer relevance có trả lời đúng câu hỏi không?
   citation accuracy citation có trỏ đúng đoạn không?
   completeness    có bỏ sót phần nào có trong context không?
```

Điểm quan trọng về tầng generation: **đo nó với context ĐÚNG được cung cấp sẵn.** Nếu bạn đo generation trên context mà retrieval trả về, bạn lại trộn hai tầng.

```text
Eval retrieval:    câu hỏi → retrieve → so với tài liệu đúng đã gán nhãn
Eval generation:   câu hỏi + TÀI LIỆU ĐÚNG (gán tay) → so với câu trả lời đúng
```

Hai suite riêng, hai dataset riêng, hai kết luận riêng.

### recall@k: chỉ số quan trọng nhất và dễ đo nhất

```text
Dataset: câu hỏi + id của (các) tài liệu THẬT SỰ chứa câu trả lời

recall@k = (số câu hỏi có ít nhất một tài liệu đúng trong top-k) / tổng số câu hỏi
```

Nó không cần model, không cần judge, chạy trong vài giây, và **nó đặt trần cho mọi thứ phía sau**:

```text
recall@5 = 0.52  ⇒  answer_correctness KHÔNG THỂ vượt ~0.52
                    (model không thể trả lời đúng từ tài liệu nó không có)
```

Đó là câu giải thích toàn bộ sự cố ở đầu note trong một dòng.

Gán nhãn tài liệu đúng là công việc thủ công, nhưng nó rẻ hơn bạn nghĩ: **50 câu hỏi thật + tài liệu đúng cho mỗi câu** là vài giờ làm việc, và nó cho bạn con số quan trọng nhất của cả hệ thống.

```yaml
# eval/golden/rag-retrieval.yaml
- id: q-001
  question: "Nhân viên trên 3 năm được nghỉ phép bao nhiêu ngày?"
  relevantDocIds: [doc_handbook_4_2]
  tags: [policy]

- id: q-014
  question: "Chính sách hoàn tiền cho SKU-9912?"
  relevantDocIds: [doc_refund_policy, doc_sku_9912]
  tags: [identifier]                       # ← ca vector search yếu

- id: q-031
  question: "Bảo hiểm KHÔNG bao gồm những gì?"
  relevantDocIds: [doc_insurance_exclusions]
  tags: [negation]                         # ← ca vector search yếu
```

Tag `identifier` và `negation` là hai tag đáng có riêng, vì chúng đo đúng hai điểm yếu đã biết của embedding ở [01-embeddings.md](../03-rag/01-embeddings.md). Nếu recall của hai tag đó thấp hơn hẳn phần còn lại, câu trả lời là **hybrid search**, không phải prompt.

### recall@k theo từng bước pipeline

Đo recall ở **nhiều điểm** để biết tầng nào làm mất tài liệu:

```text
recall@50  sau vector search        0.94   ← retrieval thô ổn
recall@50  sau metadata filter      0.94   ← filter không làm mất
recall@8   sau rerank               0.91   ← rerank giữ được
recall@8   sau pack theo token      0.63   ← MẤT Ở ĐÂY  ★
```

Bốn dòng đó chỉ đúng một chỗ để sửa. Không có phân rã này, bạn sẽ đoán.

Bước `pack` làm mất recall thường vì: chunk quá lớn nên chỉ nhét được 3 chunk, hoặc ngân sách token quá hẹp, hoặc pack theo số lượng thay vì điểm.

### faithfulness: đo bằng deterministic trước, judge sau

Nhiều người nhảy thẳng vào LLM-as-judge cho faithfulness. Có hai kiểm tra rẻ hơn nên làm trước:

```text
① CITATION TỒN TẠI (deterministic, rẻ, chạy CI được)
   mọi [doc:id] trong câu trả lời có nằm trong docIds đã đưa vào context?
   → bắt được citation bịa

② TỈ LỆ CÂU KHÔNG CÓ CITATION (deterministic)
   câu khẳng định nào không kèm nguồn?
   → bắt được câu trả lời không grounded

③ JUDGE (đắt) — chỉ khi cần đo sâu hơn
   "Câu trả lời này có được SUY RA HOÀN TOÀN từ <context> không?"
   thang: hoàn toàn / một phần / không
```

Hai kiểm tra đầu chạy trên 100% ca với chi phí gần bằng 0, và chúng đã bắt được các chế độ hỏng tệ nhất. Judge chỉ thêm giá trị cho phần "câu trả lời đúng ngữ pháp nhưng suy diễn quá xa".

Nếu dùng judge cho faithfulness, phải **cho nó context**:

```text
❌ "Câu trả lời này có đúng không?"        → judge dùng kiến thức của nó
✅ "Chỉ dựa vào <context> dưới đây, mọi khẳng định trong <answer>
    có được suy ra từ context không? Nêu câu nào KHÔNG, rồi cho kết luận."
```

### Agent: đo quỹ đạo, không chỉ kết quả

Agent có thể **đạt kết quả đúng bằng đường sai** — và đường sai tốn tiền, chậm, và có thể có side effect ngoài ý muốn.

```text
KẾT QUẢ
  task success       hoàn thành mục tiêu?
  correctness        kết quả đúng?

QUỸ ĐẠO (trajectory)
  step count         bao nhiêu bước? (p50, p95)
  tool call count    bao nhiêu lần gọi tool?
  redundant calls    số tool call trùng lặp     ← chỉ số sức khoẻ tốt nhất
  wrong tool rate    gọi sai tool
  failed tool rate   tool trả lỗi
  stop reason        completed / MAX_STEPS / NO_PROGRESS / ...

CHI PHÍ
  tokens per run     p50, p95, max
  cost per run       p50, p95, max
  cost per SUCCESS   ← con số thật để so sánh
```

Con số cuối là con số đúng để đánh giá agent:

```text
Agent A: thành công 62%, $0.08/run  →  $0.129 / lần thành công
Agent B: thành công 91%, $0.11/run  →  $0.121 / lần thành công

B đắt hơn mỗi run và RẺ HƠN mỗi việc hoàn thành.
```

So sánh `cost/run` sẽ chọn A và sai. Cùng logic như *"đếm chi phí theo việc hoàn thành, không theo request"*.

Và phân bố `stop_reason` là dashboard sức khoẻ agent tốt nhất:

```text
completed    78%   ✓
MAX_STEPS    14%   ← agent không hoàn thành việc; xem lại tool hoặc prompt
NO_PROGRESS   6%   ← có vòng lặp; xem lại tool nào hay fail
MAX_COST      2%
```

`MAX_STEPS` cao nghĩa là agent thiếu tool cần thiết, hoặc mô tả tool không rõ. Nó không phải lý do để tăng `maxSteps`.

### Ba tầng eval cho agent

```text
① UNIT — từng tool
   tool trả đúng dữ liệu? xử lý args sai? authz đúng?
   → test thường, KHÔNG cần model. Rẻ, nên có 100%.

② STEP — quyết định một bước
   cho state cố định, model có chọn đúng tool không?
   → dataset: (state, tool đúng). Deterministic. Rất giá trị.

③ END-TO-END — cả run
   → đắt, chậm, không xác định. Chạy nightly, không chạy mỗi PR.
```

Tầng ② là tầng bị bỏ qua nhiều nhất và có giá trị cao nhất. Nó bắt được lỗi "model chọn sai tool" mà không phải chạy cả run:

```yaml
# eval/golden/agent-step.yaml
- id: step-001
  state:
    messages: [{ role: user, content: "Huỷ đơn #4471 của tôi" }]
  expectTool: getOrderById          # phải TRA TRƯỚC khi huỷ
  notTool: [cancelOrder]            # không được huỷ ngay

- id: step-007
  state:
    messages: [...]                 # đã tra, đơn đã giao
  expectTool: null                  # phải TRẢ LỜI, không gọi tool nữa
  expectTextContains: ["đã giao"]
```

Ca `step-001` đo một điều quan trọng: agent có **kiểm tra trước khi hành động** hay không. Đó là hành vi bạn muốn và đo được, không phải hy vọng.

### Metric online: eval miễn phí từ người dùng

```text
RAG
  tỉ lệ 'no relevant docs'      quá cao → retrieval hoặc ngưỡng
  tỉ lệ citation bịa             > 0 là bug
  tỉ lệ câu trả lời không citation
  tỉ lệ người dùng bấm Regenerate  ← tín hiệu chất lượng mạnh nhất
  tỉ lệ chuyển sang người thật

AGENT
  phân bố stop_reason
  tỉ lệ run cần xác nhận rồi bị người TỪ CHỐI  ← agent đề xuất sai
  redundant tool call rate
```

Dòng "bị người từ chối" là chỉ số tinh tế và hữu ích: nếu người dùng thường xuyên từ chối hành động agent đề xuất, agent đang hiểu sai ý định — và bạn biết điều đó mà không cần eval nào.

## Prediction

1. `answer_correctness = 0.71`. Bạn dành 6 tuần tối ưu prompt. Trường hợp nào công sức đó là vô ích?
2. `recall@5 = 0.52`. Trần trên của answer correctness là bao nhiêu? Sửa ở đâu?
3. Bạn đo generation trên context mà retrieval trả về. Vấn đề gì?
4. Agent A: 62% thành công, $0.08/run. Agent B: 91%, $0.11/run. Chọn cái nào?
5. `stop_reason` có 40% `MAX_STEPS`. Bạn tăng `maxSteps` từ 10 lên 25. Đúng hay sai?
6. Judge cho faithfulness nhưng không được cho context. Nó đo gì?

<details>
<summary>Đáp án</summary>

1. Vô ích khi **retrieval là nút thắt** — đúng trường hợp đầu note. Đo recall trước khi tối ưu generation.
2. Trần khoảng **0.52** — model không trả lời đúng từ tài liệu nó không có. Sửa ở retrieval: hybrid search, rerank, chunking, ngân sách pack.
3. Bạn **trộn hai tầng**: generation kém có thể vì context sai, không vì prompt. Eval generation phải dùng context đúng đã gán nhãn.
4. **B.** `cost per success`: A = $0.129, B = $0.121. B rẻ hơn mỗi việc hoàn thành, và còn tốt hơn về trải nghiệm.
5. **Thường sai.** `MAX_STEPS` cao nghĩa là agent không hoàn thành việc — thường vì thiếu tool, mô tả tool không rõ, hoặc tool hay fail. Tăng trần chỉ làm mỗi run đắt hơn.
6. Nó đo **"câu trả lời có khớp kiến thức của judge không"** — không phải "có grounded trong tài liệu của bạn không". Đó là hai câu hỏi khác nhau, và câu thứ hai mới là faithfulness.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Tối ưu nhiều tháng không cải thiện | tối ưu tầng không phải nút thắt |
| Không biết retrieval hay generation kém | chỉ có một con số end-to-end |
| recall cao mà answer sai | generation, hoặc pack cắt mất chunk đúng |
| Không tìm được câu có mã/ID | thiếu tag `identifier` trong dataset → không biết |
| Judge nói tốt, người dùng nói tệ | judge không được cho context; hoặc thiên vị |
| Agent "thành công" nhưng đắt | chỉ đo kết quả, không đo quỹ đạo |
| Chọn agent rẻ hơn mà tổng đắt hơn | so `cost/run` thay vì `cost/success` |
| Tăng `maxSteps` mà không tốt hơn | `MAX_STEPS` là triệu chứng, không phải nguyên nhân |
| Eval agent chạy 2 giờ | chỉ có end-to-end, thiếu tầng ① và ② |
| Citation bịa không ai biết | không có deterministic check |

## Debugging

```text
1. recall@k trước — con số này đặt trần cho mọi thứ
2. Phân rã recall theo từng bước: vector → filter → rerank → pack
3. Recall theo TAG: identifier? negation? multi-hop? → điểm yếu cụ thể
4. Nếu recall ổn: đo faithfulness với context đúng gán tay
5. Agent: phân bố stop_reason + redundant call rate
6. Agent: cost per SUCCESS, không phải cost per run
7. Metric online: Regenerate rate, no-relevant-docs rate
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Gán nhãn `relevantDocIds` | recall@k — chỉ số quan trọng nhất | công thủ công (vài giờ cho 50 ca) |
| Eval retrieval riêng | biết chính xác tầng nào kém | hai dataset thay vì một |
| Deterministic faithfulness | rẻ, chạy CI, bắt citation bịa | không bắt được suy diễn quá xa |
| Judge cho faithfulness | đo sâu hơn | đắt; cần cho context; cần hiệu chỉnh |
| Eval agent tầng ② (step) | rẻ, bắt lỗi chọn tool | phải gán nhãn state → tool đúng |
| Eval agent end-to-end | đo thật | đắt, chậm, không xác định |
| Metric online | miễn phí, người dùng thật | gián tiếp, có độ trễ |

## Explain Without Notes

1. Một con số end-to-end không nói tầng nào kém — đo **theo tầng**.
2. **recall@k** đặt trần cho mọi thứ phía sau, và nó rẻ nhất để đo.
3. Đo generation với **context đúng gán tay**, nếu không bạn lại trộn hai tầng.
4. Faithfulness: deterministic (citation tồn tại, câu không có nguồn) trước judge.
5. Agent: đo **quỹ đạo** và `cost per success`; `MAX_STEPS` cao là triệu chứng, không phải lý do tăng trần.

## Related

- [Evaluating AI features](./01-evaluating-ai-features.md) — golden dataset, judge, CI
- [RAG failure modes](../03-rag/04-rag-failure-modes.md) — sáu tầng
- [RAG pipeline](../03-rag/03-rag-pipeline.md) — nơi recall bị mất
- [Embedding](../03-rag/01-embeddings.md) — điểm yếu → tag trong dataset
- [Vector search](../03-rag/02-vector-search.md) — đo recall trước/sau khi thêm index
- [Agent loop](../04-agents-tools/03-agent-loop.md) — `stop_reason`, không tiến triển
- [Cost & model routing](../07-production/02-cost-and-model-routing.md) — cost per success
- [AI observability](../07-production/01-ai-observability.md) — metric online
- [Full-stack triage](../../05-cross-cutting/performance/07-full-stack-triage.md) — cùng kỹ năng: tách tầng trước khi đoán
