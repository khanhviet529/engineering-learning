---
level: beginner
area: ai-engineering
type: foundation
prerequisites:
  - ../00-fundamentals/00-ai-vocabulary.md
related:
  - 02-vector-search.md
  - 03-rag-pipeline.md
---

# Embedding: biến text thành vị trí

## Note này trả lời gì

**Embedding là gì, vector là gì, "giống nhau về nghĩa" được tính thế nào** — đủ để đọc được RAG, không đi vào toán.

Đây là note **từ vựng**. Nó không dạy chunking, không dạy vector database. Nó đảm bảo khi bạn đọc `03-rag-pipeline.md` và thấy "cosine similarity 0.83", bạn biết con số đó nghĩa là gì và **không** nghĩa là gì.

> ~10 phút. Nếu bạn giải thích được vì sao không so sánh được embedding từ hai model khác nhau, hãy bỏ qua và vào [02-vector-search.md](./02-vector-search.md).

## Vị trí

```text
text  ──embedding model──▶  vector  ──similarity──▶  các item gần nhất
                             ▲                          ▲
                        note này                   note 02
```

## Định nghĩa

### Vector và embedding

**Vector** ở đây chỉ là một **mảng số thực có độ dài cố định**.

```text
[0.021, -0.114, 0.337, ..., 0.008]      ← ví dụ 1536 số
```

**Embedding** là vector biểu diễn một đoạn text, sinh ra bởi một **embedding model** — một model khác với model sinh text.

Ý tưởng cốt lõi, và là toàn bộ lý do nó hữu ích:

> Embedding model được huấn luyện sao cho **text có nghĩa gần nhau thì vector gần nhau trong không gian**.

```text
"làm sao hoàn tiền?"        ─┐
"tôi muốn trả lại hàng"      ├─ ba vector GẦN nhau
"chính sách refund là gì?"  ─┘

"cách nướng bánh mì"        ─── xa cả ba
```

Không có từ nào trùng giữa ba câu đầu, và chúng vẫn gần nhau. Đó là khác biệt so với tìm theo từ khoá.

### Dimension: chỉ là độ dài

**Dimension** là số phần tử của vector — 384, 768, 1536, 3072 tuỳ model.

```text
Nhiều dimension hơn → biểu diễn được sắc thái nhiều hơn (thường)
                    → tốn bộ nhớ và tính toán nhiều hơn
                    → KHÔNG tự động tốt hơn cho bài toán của bạn
```

Bạn không cần hiểu từng chiều nghĩa là gì. **Không ai hiểu** — chúng không tương ứng với khái niệm người đọc được.

### Similarity: đo bằng góc, không bằng khoảng cách

Cách phổ biến nhất là **cosine similarity** — đo *hướng* của hai vector, bỏ qua độ dài:

```text
cosine =  1.0   cùng hướng      → rất giống về nghĩa
cosine =  0.0   vuông góc       → không liên quan
cosine = -1.0   ngược hướng     → (ít gặp trong thực tế với text)
```

Trực giác hình học, đủ dùng:

```text
        ↗ "hoàn tiền"
       ↗ "trả lại hàng"        góc nhỏ → cosine cao → gần nghĩa
      /
     /________→ "nướng bánh"   góc lớn → cosine thấp
```

Ba điều thực dụng cần biết về con số này:

**① Ngưỡng không phổ quát.** `0.8` với model này có thể tương đương `0.6` với model khác. Bạn phải **đo trên dữ liệu của mình** để chọn ngưỡng, không lấy con số từ blog.

**② Với text thật, cosine hiếm khi thấp.** Hai đoạn tiếng Việt bất kỳ thường đã ở `0.6–0.7` chỉ vì cùng ngôn ngữ, cùng văn phong. Nên khoảng có ý nghĩa thường hẹp: `0.7` vs `0.85` là khác biệt lớn.

**③ Cosine cao ≠ trả lời được câu hỏi.** Đây là điểm quan trọng nhất, và là nguồn của phần lớn thất vọng với RAG:

```text
Câu hỏi:  "Đơn hàng #4471 của tôi đã giao chưa?"
Chunk:    "Chính sách giao hàng: đơn hàng được giao trong 3-5 ngày..."
cosine:   0.86   ← RẤT GIỐNG về chủ đề
Trả lời được câu hỏi?  KHÔNG. Nó không chứa thông tin về đơn #4471.
```

Embedding đo **độ giống về chủ đề**, không đo **khả năng trả lời**. Nhầm hai thứ này là lý do người ta tăng `top_k` mà chất lượng không lên. Xem [04-rag-failure-modes.md](./04-rag-failure-modes.md).

### Embedding model khác model sinh text

```text
Embedding model    text → vector.  Không sinh chữ. Rẻ hơn nhiều. Nhanh hơn nhiều.
Generative model   text → text.
```

Bốn quy tắc bắt buộc về embedding model:

```text
① Query và document PHẢI dùng CÙNG model.
   Vector từ hai model khác nhau không so sánh được — chúng ở
   hai không gian khác nhau. Cosine giữa chúng là số vô nghĩa.

② Đổi embedding model = PHẢI EMBED LẠI TOÀN BỘ.
   Không có cách "chuyển đổi". Đây là chi phí di trú thật, phải lên kế hoạch.

③ Lưu TÊN + VERSION model cùng mỗi vector.
   Không có nó, bạn không biết vector nào thuộc không gian nào.

④ Một số model có prefix riêng cho query vs document
   ("query: ..." / "passage: ..."). Bỏ prefix làm chất lượng giảm âm thầm.
```

Quy tắc ② là quy tắc có hậu quả vận hành lớn nhất trong note này. Với 5 triệu chunk, embed lại là một job hàng giờ và tốn tiền — nên nó phải chạy được **song song với hệ thống đang phục vụ**, không phải dừng để làm.

### Cái embedding KHÔNG làm được

Đây là phần quan trọng nhất của note, vì nó quyết định khi nào bạn cần thêm thứ khác:

```text
✗ Số học và so sánh    "đơn hàng trên 5 triệu" → embedding không hiểu ">"
✗ Lọc chính xác        "chỉ tài liệu năm 2026" → phải dùng METADATA FILTER
✗ Mã và định danh      "#4471", "SKU-9912"    → tìm chính xác thắng xa
✗ Phủ định             "không bao gồm bảo hiểm" thường GẦN với
                       "bao gồm bảo hiểm" — embedding yếu với phủ định
✗ Câu hỏi nhiều bước   "so sánh chính sách A và B rồi kết luận"
✗ Đảm bảo tìm thấy     nó xếp hạng theo độ gần, không đảm bảo recall
```

Hai dòng đầu là lý do vector search **luôn** đi kèm metadata filter, không thay thế nó. Dòng "mã và định danh" là lý do nhiều hệ thống RAG tốt dùng **hybrid search** — kết hợp vector với tìm từ khoá. Xem [02-vector-search.md](./02-vector-search.md) và [04-full-text-search.md](../../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md).

Và một cảnh báo về tiếng Việt: **chất lượng embedding với tiếng Việt khác nhau rất nhiều giữa các model.** Model đa ngôn ngữ thường tốt hơn model chủ yếu tiếng Anh, nhưng đây là điều **phải đo trên dữ liệu của bạn** — không suy từ bảng xếp hạng tiếng Anh.

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| Cosine cao = trả lời được câu hỏi | cao = cùng chủ đề | tăng `top_k` mà chất lượng không lên |
| Ngưỡng 0.8 là "giống" phổ quát | ngưỡng phụ thuộc model và dữ liệu | lọc mất chunk đúng, hoặc nhận toàn rác |
| So sánh được vector từ hai model | hai không gian khác nhau | kết quả tìm kiếm vô nghĩa |
| Đổi model thì chỉ cần đổi config | phải **embed lại toàn bộ** | hệ thống trả rác cho tới khi embed xong |
| Embedding hiểu số và ngày | không hiểu; cần metadata filter | "đơn trên 5 triệu" trả về sai hoàn toàn |
| Embedding xử lý được phủ định | rất yếu với phủ định | trả về chunk nói điều **trái ngược** |
| Nhiều dimension thì tốt hơn | tốn hơn; không tự động tốt hơn | trả tiền cho thứ không đo được |
| Vector search thay được tìm từ khoá | mã, ID, tên riêng cần khớp chính xác | không tìm được `#4471` |
| Embedding là "nén" text, giải nén lại được | là biểu diễn có mất mát, không đảo được | tưởng vector không phải dữ liệu cá nhân |

Dòng cuối có hệ quả pháp lý: **chunk thường lưu cả text gốc** (để đưa vào context), nên vector store chứa một bản sao đầy đủ nội dung. Nó nằm trong checklist xoá dữ liệu. Xem [05-conversation-storage.md](../02-chatbot-web/05-conversation-storage.md).

## Kiểm tra bản thân

1. Embedding là gì? Vector là gì?
2. Cosine similarity đo cái gì — khoảng cách hay góc?
3. Cosine 0.9 có nghĩa là chunk đó trả lời được câu hỏi không? Vì sao?
4. Query và document có thể dùng hai embedding model khác nhau không?
5. Bạn muốn đổi từ model 768 chiều sang 1536 chiều. Việc gì phải làm?
6. "Tìm đơn hàng trên 5 triệu" — embedding làm được không? Cần gì thêm?
7. Vì sao "không bao gồm bảo hiểm" và "bao gồm bảo hiểm" là vấn đề?
8. Bạn cần tìm chính xác mã `SKU-9912`. Vector search có phải lựa chọn tốt nhất?
9. Người dùng yêu cầu xoá dữ liệu. Vector store có liên quan không?

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 02-vector-search.md    ← lưu và tìm vector ở đâu, top-k, ANN
        ├──▶ 03-rag-pipeline.md     ← chunking, retrieval, citation
        └──▶ 04-rag-failure-modes.md ← vì sao cosine cao mà trả lời sai
```

## Related

- [Vector search](./02-vector-search.md) — index, top-k, ANN, metadata filter
- [RAG pipeline](./03-rag-pipeline.md) — embedding nằm ở đâu trong luồng
- [RAG failure modes](./04-rag-failure-modes.md) — cosine cao mà sai
- [RAG vs fine-tuning](./05-rag-vs-fine-tuning.md)
- [Từ vựng AI](../00-fundamentals/00-ai-vocabulary.md) — token, model, inference
- [Full-text search (PostgreSQL)](../../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) — nửa còn lại của hybrid search
- [Conversation storage](../02-chatbot-web/05-conversation-storage.md) — vector store trong checklist xoá
- [Glossary](../../00-roadmap/glossary.md)
