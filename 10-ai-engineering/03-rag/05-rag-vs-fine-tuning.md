---
level: intermediate
area: ai-engineering
prerequisites:
  - 03-rag-pipeline.md
related:
  - ../01-context-and-output/01-prompt-as-input-contract.md
  - ../05-evaluation/01-evaluating-ai-features.md
---

# RAG vs fine-tuning vs code

> Một công ty bỏ sáu tuần và một khoản tiền đáng kể để fine-tune model trên 40.000 tài liệu nội bộ, với kỳ vọng "model sẽ biết dữ liệu của chúng ta". Kết quả: model nói về các chủ đề đó **tự nhiên hơn**, và **vẫn bịa số liệu**. Nó không tra cứu được tài liệu nào, vì fine-tuning không tạo ra khả năng tra cứu. Sáu tuần sau, họ dựng RAG trong hai tuần và nó hoạt động.

## Position

```text
"Model cần biết / làm điều X"
        │
        ▼  ← NOTE NÀY: X thuộc loại nào, và công cụ nào đúng
   RAG · fine-tuning · prompt · CODE
```

## Problem

Câu hỏi hay được đặt sai từ đầu:

```text
❌ "RAG hay fine-tuning tốt hơn?"
✅ "Điều tôi cần model làm thuộc loại nào?"
```

Vì chúng giải quyết **hai bài toán khác nhau**, và trong nhiều trường hợp câu trả lời đúng là **cả hai đều không cần**.

## Mental Model

### Ba loại nhu cầu, ba công cụ

```text
① "Model cần BIẾT thông tin gì"      → KIẾN THỨC     → RAG
② "Model cần TRẢ LỜI THEO KIỂU nào"  → HÀNH VI/FORMAT → prompt, rồi fine-tuning
③ "Hệ thống cần LÀM ĐÚNG việc gì"    → QUY TẮC        → CODE
```

Câu quan trọng nhất của note:

> **Fine-tuning dạy model *cách nói*, không dạy nó *biết gì*.**

Nó điều chỉnh phân bố xác suất của model — làm nó có xu hướng sinh ra output theo một kiểu nhất định. Nó **không** tạo ra một cơ chế tra cứu, không đảm bảo dữ kiện nào được nhớ chính xác, và không cập nhật được khi dữ liệu đổi.

Đó chính xác là lý do sự cố ở đầu note xảy ra.

### Cây quyết định

```text
Bạn cần gì?
│
├─ Câu trả lời phải ĐÚNG theo một QUY TẮC XÁC ĐỊNH?
│   (tính tiền, kiểm quyền, xác thực định dạng, áp dụng chính sách rõ ràng)
│   ─▶ CODE. Không phải AI.
│      Đừng để model tính toán điều mà một hàm tính đúng 100%.
│
├─ Model cần biết dữ liệu RIÊNG / MỚI / THAY ĐỔI?
│   ─▶ RAG
│      · dữ liệu đổi hằng ngày         → RAG (fine-tuning không theo được)
│      · cần trích nguồn                → RAG (fine-tuning không có nguồn)
│      · cần phân quyền theo người dùng → RAG (filter ở retrieval)
│
├─ Model cần theo một FORMAT / VĂN PHONG / QUY TRÌNH cụ thể?
│   ─▶ ① prompt + few-shot trước       ← thử cái này TRƯỚC, luôn luôn
│      ② structured output nếu là format
│      ③ fine-tuning nếu ① và ② đã hết cách VÀ bạn có eval chứng minh
│
└─ Model cần LÀM ĐƯỢC một tác vụ nó chưa làm được?
    ─▶ thử model mạnh hơn trước; rồi tool calling; rồi mới fine-tuning
```

Nhánh đầu tiên là nhánh bị bỏ qua nhiều nhất. Rất nhiều "AI feature" nên là một hàm:

```text
❌ "Hỏi model: đơn hàng này có được hoàn tiền không?"
✅ isRefundable(order) — một hàm, đúng 100%, test được, audit được
   (model chỉ dùng để GIẢI THÍCH kết quả cho khách bằng lời)
```

### So sánh trực tiếp

| | RAG | Fine-tuning |
|---|---|---|
| Giải quyết | model không biết dữ liệu của bạn | model không nói theo kiểu bạn muốn |
| Cập nhật dữ liệu | thêm/sửa tài liệu → tức thì | phải huấn luyện lại |
| Trích nguồn | **có** — citation | không có |
| Phân quyền theo user | **có** — filter ở retrieval | không — model là một, cho mọi người |
| Chi phí ban đầu | trung bình (pipeline) | cao (dữ liệu + huấn luyện) |
| Chi phí mỗi request | cao hơn (input token nhiều) | thấp hơn (prompt ngắn hơn) |
| Latency | cao hơn (retrieval + input dài) | thấp hơn |
| Xoá một phần dữ liệu | xoá chunk | **không thể** — đã nằm trong trọng số |
| Khi dữ liệu sai | sửa tài liệu | huấn luyện lại |
| Debug được | **có** — xem chunk đã dùng | rất khó |

Hai dòng đáng chú ý nhất là **phân quyền** và **xoá một phần**.

Phân quyền: một model fine-tuned trên dữ liệu của mọi khách hàng có thể nói ra thông tin của khách hàng A cho khách hàng B. Không có cơ chế nào chặn ở tầng model. Với RAG, đó chỉ là một điều kiện `WHERE org_id = $1`.

Xoá: nếu người dùng yêu cầu xoá dữ liệu và dữ liệu đó đã nằm trong trọng số model, bạn **không xoá được** — bạn phải huấn luyện lại từ dataset đã loại bỏ nó. Đây là rủi ro tuân thủ mà nhiều team không tính khi chọn fine-tuning.

### Khi nào fine-tuning THẬT SỰ đúng

Nó có chỗ đứng hợp pháp, nhưng hẹp hơn nhiều người nghĩ:

```text
✓ Văn phong/định dạng RẤT đặc thù mà prompt dài không đạt được
  (và prompt dài đang tốn nhiều token mỗi request)

✓ Tác vụ hẹp, lặp lại, KHỐI LƯỢNG LỚN
  → mục tiêu: dùng model NHỎ HƠN với chất lượng như model lớn
  → đây là lý do tốt nhất, vì nó tiết kiệm thật ở quy mô

✓ Cần latency thấp và prompt ngắn ở quy mô rất lớn

✓ Ngôn ngữ/lĩnh vực mà model nền yếu (thuật ngữ chuyên ngành hẹp)
```

Điều kiện tiên quyết, không thể bỏ:

```text
□ Có GOLDEN DATASET và có eval TRƯỚC khi fine-tune
  → không có nó, bạn không biết fine-tuning làm tốt lên hay tệ đi
□ Đã thử prompt + few-shot + structured output và đo được giới hạn
□ Có kế hoạch huấn luyện lại khi model nền được cập nhật
□ Dữ liệu huấn luyện đã được kiểm về quyền sử dụng và dữ liệu cá nhân
```

Điều kiện đầu là điều kiện quyết định. Fine-tuning **không có eval** là đốt tiền vào một thay đổi bạn không đo được. Xem [01-evaluating-ai-features.md](../05-evaluation/01-evaluating-ai-features.md).

### RAG + fine-tuning cùng lúc

Chúng không loại trừ nhau, vì chúng ở hai trục khác nhau:

```text
Fine-tune để model:  trả lời theo đúng format công ty, dùng đúng thuật ngữ,
                     luôn kèm citation, không lan sang chủ đề khác
RAG để model:        biết chính sách hiện tại là gì
```

Nhưng: **làm RAG trước.** Nó giải quyết vấn đề *đúng/sai*, và đúng/sai quan trọng hơn *hay/dở*. Fine-tuning chỉ đáng khi bạn đã đúng và muốn rẻ hơn hoặc nhất quán hơn.

### Ba lựa chọn rẻ hơn nên thử trước

```text
① MODEL MẠNH HƠN
   Thường giải quyết được vấn đề "làm không được" với chi phí bằng
   một dòng config. Đo bằng eval, rồi tính chi phí.

② TOOL CALLING
   "Model không tính được tổng đơn hàng" — nó không cần tính.
   Cho nó một tool gọi hàm của bạn. Kết quả đúng 100%.
   → 04-agents-tools/01-tool-calling.md

③ PROMPT + FEW-SHOT + STRUCTURED OUTPUT
   Giải quyết phần lớn vấn đề về FORMAT với chi phí gần bằng 0.
   → 01-context-and-output/01, 03
```

Lựa chọn ② đáng nhấn: rất nhiều nhu cầu "fine-tune để model chính xác hơn về số liệu" thực ra là nhu cầu **cho model một tool**. Model không nên tính; nó nên gọi hàm tính.

## Prediction

1. Bạn fine-tune trên 40.000 tài liệu nội bộ. Người dùng hỏi một số liệu cụ thể. Model có tra được không?
2. Chính sách công ty đổi hôm nay. Với fine-tuning, bao lâu model biết? Với RAG?
3. Bạn fine-tune trên dữ liệu của mọi khách hàng. Khách hàng A hỏi. Rủi ro?
4. Một khách hàng yêu cầu xoá toàn bộ dữ liệu của họ. Model đã fine-tune trên đó. Bạn làm gì?
5. Bạn cần model luôn trả về JSON đúng schema. Fine-tuning hay cái khác?

<details>
<summary>Đáp án</summary>

1. **Không tra được.** Fine-tuning không tạo cơ chế tra cứu. Model sẽ sinh ra một số **nghe hợp lý** — và đó là chế độ hỏng tệ nhất, vì output trông giống output đúng.
2. Fine-tuning: **cho tới khi bạn huấn luyện lại** (ngày tới tuần). RAG: **ngay khi tài liệu được ingest** (giây tới phút).
3. Model có thể nói ra thông tin của khách hàng khác. **Không có cơ chế phân quyền nào ở tầng model.** Với RAG đó chỉ là một điều kiện filter.
4. **Bạn phải huấn luyện lại** từ dataset đã loại dữ liệu đó — tốn kém và chậm. Đây là rủi ro tuân thủ nên tính từ lúc chọn kiến trúc.
5. **Structured output** (schema-constrained), không phải fine-tuning. Nó đảm bảo hình dạng bằng cơ chế, không bằng xu hướng.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Fine-tune xong vẫn bịa số liệu | dùng fine-tuning cho bài toán kiến thức |
| Model nói tự nhiên hơn nhưng sai như cũ | fine-tuning sửa *cách nói*, không sửa *biết gì* |
| Không biết fine-tuning có tốt hơn không | không có golden dataset / eval trước-sau |
| Dữ liệu cũ trong câu trả lời | dữ liệu nằm trong trọng số, không cập nhật được |
| Rò rỉ dữ liệu giữa khách hàng | một model cho mọi tenant |
| Không xoá được dữ liệu người dùng | dữ liệu trong trọng số |
| Phải fine-tune lại khi model nền cập nhật | phụ thuộc phiên bản model nền |
| RAG chậm và đắt | dùng RAG cho thứ đáng lẽ là một hàm code |
| Model tính toán sai | không cho tool; để model làm việc của code |

Hai dòng cuối là hai chiều ngược nhau của cùng một sai lầm: **giao cho AI việc mà code làm đúng hơn.**

## Trade-offs

| Công cụ | Chi phí ban đầu | Chi phí mỗi request | Cập nhật | Đúng đắn |
|---|---|---|---|---|
| **Code** | thấp | ~0 | deploy | **100% xác định** |
| **Prompt + few-shot** | rất thấp | thấp | tức thì | phụ thuộc model |
| **Structured output** | thấp | thấp | tức thì | hình dạng đảm bảo |
| **Tool calling** | trung | trung | tức thì | kết quả tool đúng 100% |
| **RAG** | trung | cao hơn | tức thì | có nguồn, kiểm được |
| **Model mạnh hơn** | ~0 | cao hơn | một dòng config | phụ thuộc model |
| **Fine-tuning** | **cao** | thấp hơn | huấn luyện lại | không có nguồn |

Đọc bảng từ trên xuống: **thứ tự thử nên đúng theo thứ tự các dòng.** Fine-tuning ở cuối không phải vì nó tệ, mà vì nó là lựa chọn khó đảo ngược nhất và cần điều kiện tiên quyết nhiều nhất.

## Explain Without Notes

1. Fine-tuning dạy model **cách nói**, RAG cho model **biết gì**, code đảm bảo **đúng**.
2. Nhu cầu "quy tắc xác định" → viết hàm, không dùng AI.
3. RAG có: cập nhật tức thì, trích nguồn, phân quyền theo user, xoá được. Fine-tuning không có bốn thứ đó.
4. Lý do tốt nhất để fine-tune là **dùng model nhỏ hơn ở quy mô lớn** — và nó cần eval trước.
5. Thử theo thứ tự: code → prompt → structured output → tool → RAG → model mạnh hơn → fine-tuning.

## Related

- [RAG pipeline](./03-rag-pipeline.md)
- [RAG failure modes](./04-rag-failure-modes.md)
- [Tool calling](../04-agents-tools/01-tool-calling.md) — cho model một hàm thay vì dạy nó tính
- [Prompt như input contract](../01-context-and-output/01-prompt-as-input-contract.md)
- [Structured output](../01-context-and-output/03-structured-output.md) — đảm bảo format bằng cơ chế
- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — điều kiện tiên quyết của fine-tuning
- [Cost & model routing](../07-production/02-cost-and-model-routing.md) — model nhỏ hơn ở quy mô
- [ORM vs query builder vs raw SQL](../../03-database/05-data-access/01-orm-vs-query-builder-vs-raw-sql.md) — cùng kiểu quyết định: công cụ theo bài toán
