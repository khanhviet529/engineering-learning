---
level: beginner
area: ai-engineering
type: foundation
prerequisites: []
related:
  - 01-llm-request-lifecycle.md
  - 02-ai-application-architecture.md
  - ../../09-ai-assisted-development/02-context-engineering.md
---

# Từ vựng AI Engineering: model, token, context, prompt

## Note này trả lời gì

**Application của bạn đang gọi cái gì, và các danh từ trong đó nghĩa là gì** — model, LLM, token, tokenizer, context window, prompt, completion, inference, role, temperature.

Đây là note **từ vựng**. Nó không dạy RAG, không dạy agent, không dạy cách gọi API. Nó đảm bảo khi bạn đọc `03-rag-pipeline.md` và thấy "context budget 8k token", bạn biết chính xác đó là gì.

> ~12 phút. Nếu bạn giải thích được vì sao `temperature: 0` **không** đảm bảo output giống nhau tuyệt đối, hãy bỏ qua và vào [01-llm-request-lifecycle.md](./01-llm-request-lifecycle.md).

## Vị trí

```text
Code của bạn
   │
   ├─ Bạn gửi gì?        messages (system / user / assistant / tool)
   ├─ Đo bằng gì?        token — cả đầu vào và đầu ra
   ├─ Giới hạn ở đâu?    context window
   └─ Nhận lại gì?       generated text + finish reason + usage
   │
Provider (Anthropic / OpenAI / Google / self-hosted)
```

## Định nghĩa

### Model, LLM, inference

**Model** ở góc nhìn application engineer là **một hàm có trạng thái đóng băng**: bạn đưa vào một chuỗi text, nó trả về một chuỗi text. Trọng số của nó không đổi khi bạn gọi.

**LLM** (Large Language Model) là loại model được huấn luyện để **dự đoán token tiếp theo** trên khối lượng text khổng lồ. Mọi khả năng bạn thấy — trả lời câu hỏi, viết code, tóm tắt — đều là hệ quả của một việc duy nhất đó.

**Inference** là hành động chạy model để sinh ra output. Phân biệt với **training** (tạo ra trọng số). Trong 99% công việc application, bạn chỉ làm inference.

```text
Training   → tạo ra model.      Bạn hầu như không làm.
Inference  → dùng model.        Bạn làm mỗi request.
Fine-tuning→ điều chỉnh model.  Ít khi cần — xem 03-rag/05.
```

Điểm quan trọng nhất, và là gốc của mọi hiểu sai còn lại:

> **Model không "biết" gì cả sau khi trả lời xong.** Mỗi lần gọi là một lần độc lập. Nó không nhớ request trước của bạn.

Cảm giác "chatbot nhớ cuộc nói chuyện" là do **application của bạn gửi lại toàn bộ lịch sử mỗi lần**. Đây là cùng một tính chất `stateless` như HTTP — và giải pháp cũng cùng hình dạng: state phải nằm ở chỗ khác. Xem [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) và [05-conversation-storage.md](../02-chatbot-web/05-conversation-storage.md).

### Token và tokenizer

**Token** là đơn vị mà model đọc và sinh ra. Không phải ký tự, không phải từ — là **mẩu từ**.

```text
"engineering"     → có thể là  ["engineer", "ing"]        2 token
"Xin chào"        → có thể là  ["Xin", " ch", "ào"]       3 token
"const x = 1;"    → có thể là  ["const", " x", " =", " 1", ";"]
```

**Tokenizer** là bộ phận thực hiện việc chia đó. Mỗi họ model có tokenizer riêng, nên **cùng một đoạn text cho ra số token khác nhau giữa các provider**.

Ước lượng thô cho tiếng Anh và code: `1 token ≈ 3–4 ký tự`. Với **tiếng Việt có dấu, con số này tệ hơn đáng kể** — thường 1.5–2.5× số token so với cùng nội dung bằng tiếng Anh, vì dấu và ký tự Unicode bị chia nhỏ hơn.

Hệ quả thực tế: một prompt tiếng Việt "vừa đủ" trong test có thể **vượt giới hạn** khi người dùng thật gõ vào. Đừng ước lượng bằng `str.length`.

```text
❌ if (text.length > 4000) throw ...        // ký tự, không phải token
✅ đếm bằng API count-token của provider    // chính xác cho đúng tokenizer đó
```

Vì sao token quan trọng đến vậy: **nó là đơn vị tính tiền, đơn vị giới hạn, và đơn vị latency.** Ba thứ bạn quan tâm nhất đều đo bằng token.

### Input token và output token

```text
input token   = mọi thứ bạn GỬI (system + toàn bộ history + tài liệu RAG + tool schema)
output token  = mọi thứ model SINH RA
```

Chúng **không cùng giá**. Output đắt hơn input nhiều — thường 4–5×.

| Model (ví dụ, 2026-06) | Input $/1M | Output $/1M | Context |
|---|---|---|---|
| Claude Opus 5 | $5.00 | $25.00 | 1M |
| Claude Sonnet 5 | $2.00 | $10.00 | 1M |
| Claude Haiku 4.5 | $1.00 | $5.00 | 200K |

*Bảng chỉ để thấy hình dạng: output ≈ 5× input, và model mạnh hơn đắt hơn ~2–5×. Giá và model thay đổi liên tục — tra tài liệu provider, đừng tin con số trong note.*

Hệ quả thiết kế, không phải chi tiết kế toán: **giới hạn độ dài output là đòn tiết kiệm hiệu quả nhất mà không ai làm.** Xem [02-cost-and-model-routing.md](../07-production/02-cost-and-model-routing.md).

### Context window

**Context window** là số token tối đa mà model xử lý được trong **một** lần gọi. Nó bao gồm **cả input và output**.

```text
┌─────────── context window (ví dụ 200K) ──────────────┐
│ system │ history │ tài liệu RAG │ tool schema │ output │
└──────────────────────────────────────────────────────┘
                                    └─ output cũng chiếm chỗ
```

Ba điều đi kèm, và cả ba đều trái trực giác:

**① Context window không phải bộ nhớ.** Nó là kích thước tối đa của *một* lần gọi. Hết cuộc gọi là hết. Đây là hiểu sai phổ biến nhất trong toàn bộ chủ đề này.

**② Context window lớn không giải quyết vấn đề, chỉ dời nó.** Nhồi 500K token vào cửa sổ 1M thì: đắt hơn (input token), chậm hơn (TTFT tăng theo độ dài input), và **chất lượng có thể giảm** — thông tin quan trọng bị loãng giữa thông tin không liên quan.

**③ Output có giới hạn riêng, nhỏ hơn context window.** Một model có cửa sổ 1M vẫn có thể chỉ sinh được tối đa 128K token một lần.

### Prompt, message, role

**Prompt** là toàn bộ input bạn gửi cho model trong một lần gọi. Không phải "câu hỏi" — là *tất cả*.

API hiện đại cấu trúc prompt thành danh sách **message**, mỗi message có một **role**:

| Role | Ai viết | Dùng để |
|---|---|---|
| `system` | **bạn**, developer | chỉ thị, quy tắc, persona, output format |
| `user` | người dùng cuối (hoặc bạn) | câu hỏi, dữ liệu đầu vào |
| `assistant` | **model** | câu trả lời trước đó của nó |
| `tool` / `tool_result` | **application của bạn** | kết quả bạn trả về sau khi model xin gọi tool |

```text
[
  { role: 'system',    content: 'Bạn là trợ lý hỗ trợ đơn hàng. Chỉ trả lời...' },
  { role: 'user',      content: 'Đơn #123 của tôi tới đâu rồi?' },
  { role: 'assistant', content: 'Để tôi tra giúp bạn.' },   ← lượt trước
  { role: 'user',      content: 'Còn đơn #124?' },
]
```

Cảnh báo quan trọng nhất về `system`:

> **`system` role là chỉ thị, không phải cơ chế bảo mật.** Nội dung trong `user` message có thể khiến model bỏ qua nó. Xem [01-prompt-injection.md](../06-safety/01-prompt-injection.md).

### Completion / generation, và finish reason

**Completion** (hay *generation*) là text model sinh ra. Nó được sinh **từng token một**, tuần tự — đó là lý do streaming khả thi và là lý do output dài thì chậm.

Cùng với completion, provider trả về **finish reason** (`stop_reason` / `finish_reason`) — *lý do model dừng*:

| Ý nghĩa | Bạn phải làm gì |
|---|---|
| dừng tự nhiên, đã trả lời xong | không gì |
| **chạm giới hạn `max_tokens`** | output **bị cắt giữa câu** — không được coi là hợp lệ |
| model muốn gọi tool | thực thi tool, gọi lại |
| bị chặn bởi bộ lọc an toàn | hiển thị thông báo, không retry vô ích |

Bỏ qua finish reason là bug im lặng phổ biến nhất khi tích hợp LLM: JSON bị cắt giữa dòng, `JSON.parse` ném lỗi, và bạn đi tìm bug trong parser thay vì trong `max_tokens`. Chi tiết và cách normalize giữa các provider: [04-provider-adapter-and-dto.md](../01-context-and-output/04-provider-adapter-and-dto.md).

### Usage metadata

Mỗi response kèm số token đã dùng:

```text
usage: { input_tokens: 1_204, output_tokens: 318, cache_read_input_tokens: 980 }
```

**Log nó cho mọi request.** Không có nó thì bạn không thể trả lời "vì sao hoá đơn tháng này gấp ba", và không thể biết prompt cache có hoạt động hay không. Xem [01-ai-observability.md](../07-production/01-ai-observability.md).

### Temperature và top-p

Model không chọn token tiếp theo một cách chắc chắn — nó tạo ra một **phân bố xác suất** trên toàn bộ từ vựng, rồi lấy mẫu từ đó.

```text
Sau "Thủ đô của Việt Nam là"
   "Hà"      0.94
   "thành"   0.03
   "một"     0.01
   ...
```

**Temperature** điều chỉnh độ "phẳng" của phân bố đó:

```text
temperature thấp (0–0.3)   → phân bố nhọn hơn → chọn token có xác suất cao
                              ⇒ nhất quán, nhàm, phù hợp trích xuất/phân loại
temperature cao (0.8–1.0)  → phân bố phẳng hơn → chọn token ít khả năng hơn
                              ⇒ đa dạng, sáng tạo, phù hợp viết nội dung
```

**Top-p** (nucleus sampling) là cách giới hạn khác: chỉ xét những token đầu bảng có tổng xác suất đạt `p`. Ở mức mental model, nó cùng mục đích với temperature. **Đừng điều chỉnh cả hai cùng lúc** — chọn một.

Và điều phải nói cho đúng:

> **`temperature: 0` không đảm bảo output hoàn toàn giống nhau.**

Vì sao: nó chỉ nói "luôn chọn token có xác suất cao nhất". Nhưng trong hệ thống thật vẫn còn nguồn khác biệt — thứ tự cộng dồn số thực trên GPU khi batch khác nhau, phân bố request lên hardware khác nhau, thay đổi phía provider. Ngoài ra một số model mới **không nhận** `temperature` nữa.

Nghĩa là:

```text
temperature: 0  ⇒  ít biến thiên hơn nhiều.
temperature: 0  ⇏  hàm thuần khiết, xác định, test được bằng so sánh chuỗi.
```

Nếu bạn cần đảm bảo xác định, dùng **code**, không dùng model. Nếu bạn cần test, đừng so khớp chuỗi chính xác — xem [01-evaluating-ai-features.md](../05-evaluation/01-evaluating-ai-features.md).

### Latency: hai con số, không phải một

```text
TTFT   time to first token   ← người dùng thấy con số NÀY
total  toàn bộ generation    ← thường lớn hơn nhiều
```

TTFT phụ thuộc chủ yếu vào **độ dài input** và tải của provider. Total phụ thuộc vào **độ dài output**.

Vì sao phải tách: với 4 giây total, một UI streaming hiện chữ sau 600ms cảm giác nhanh; một UI đợi rồi hiện một lần cảm giác treo. Cùng một con số total. Xem [04-latency-engineering.md](../07-production/04-latency-engineering.md).

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| **LLM là database** | nó không tra cứu; nó sinh token có khả năng cao | tin vào số liệu, tên người, mã sản phẩm mà nó "nhớ" → sai dữ liệu |
| **LLM là search engine** | không có index, không có nguồn, không biết cái gì mới | trả lời về dữ liệu công ty bạn mà nó chưa bao giờ thấy → cần RAG |
| **LLM là hàm xác định** | là lấy mẫu từ phân bố xác suất | test bằng so khớp chuỗi → flaky test |
| `temperature: 0` là hoàn toàn xác định | giảm biến thiên rất nhiều, không loại bỏ | tưởng đã có determinism, xây logic dựa vào đó |
| **context window = bộ nhớ lâu dài** | là kích thước tối đa của **một** lần gọi | tưởng "nó nhớ rồi", không lưu gì → mất hết khi reload |
| **prompt là bảo đảm** | là chỉ thị có xác suất được tuân theo | dùng system prompt làm phân quyền → lỗ hổng |
| Cửa sổ lớn thì cứ nhồi hết vào | đắt hơn, chậm hơn, và có thể **kém chính xác hơn** | hoá đơn tăng, chất lượng giảm |
| Token = từ | token là mẩu từ; tiếng Việt tốn nhiều token hơn | giới hạn tính bằng `length` → tràn context ở production |
| Input và output token cùng giá | output thường đắt ~5× | tối ưu sai chỗ |
| Model mới cùng tên thì hành vi như cũ | cùng prompt + version model mới có thể đổi hành vi | prompt regression khi provider cập nhật |
| Đọc xong response là xong | phải kiểm **finish reason** | JSON bị cắt, parse lỗi, đi tìm bug sai chỗ |

Hai dòng đầu bảng đáng nhắc lại thành một câu, vì gần như mọi thất bại của AI feature đều quy về nó:

> **LLM tạo ra text *nghe có vẻ đúng*. Nó không tra cứu sự thật.** Muốn nó nói đúng về dữ liệu của bạn, bạn phải **đưa dữ liệu đó vào context** — đó là toàn bộ lý do RAG tồn tại.

## Kiểm tra bản thân

1. Model có nhớ cuộc hội thoại trước không? Vậy vì sao chatbot trông như nhớ?
2. Token là gì? Vì sao không đo giới hạn bằng số ký tự? Tiếng Việt khác tiếng Anh ra sao?
3. Context window bao gồm những gì? Output có chiếm chỗ trong đó không?
4. Input token và output token — cái nào đắt hơn, khoảng mấy lần?
5. Bốn role trong messages là gì? Ai viết `tool_result`?
6. `temperature: 0` có cho output giống nhau tuyệt đối không? Vì sao?
7. Finish reason nói gì? Nếu nó là "chạm `max_tokens`" thì output của bạn có dùng được không?
8. TTFT khác total latency thế nào? Người dùng cảm nhận cái nào?
9. Vì sao "context window 1M nên nhồi hết vào" là một quyết định tồi?
10. Model của bạn cần trả lời về dữ liệu nội bộ công ty. Nó có "biết" không? Bạn phải làm gì?

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 01-llm-request-lifecycle.md   ← một request đi qua những gì
        ├──▶ 02-ai-application-architecture.md ← bản đồ toàn track
        ├──▶ ../01-context-and-output/03-structured-output.md ← đưa output vào code an toàn
        └──▶ ../02-chatbot-web/01-chatbot-architecture.md ← full-stack feature đầu tiên
```

## Related

- [LLM request lifecycle](./01-llm-request-lifecycle.md) — request đi qua đâu, hỏng ở đâu
- [AI application architecture](./02-ai-application-architecture.md) — bản đồ toàn track
- [Prompt như input contract](../01-context-and-output/01-prompt-as-input-contract.md)
- [Context engineering](../01-context-and-output/02-context-engineering.md) — chọn gì đưa vào cửa sổ
- [Structured output](../01-context-and-output/03-structured-output.md) — output là dữ liệu không đáng tin
- [Context window management](../02-chatbot-web/06-context-window-management.md) — history dài hơn cửa sổ thì làm gì
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — stateless, DTO, status code
- [Context engineering (dùng AI để làm việc)](../../09-ai-assisted-development/02-context-engineering.md) — cùng khái niệm, mục đích khác
- [Glossary](../../00-roadmap/glossary.md)
