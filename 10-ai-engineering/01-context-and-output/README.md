---
level: intermediate
area: ai-engineering
---

# Context & Output

Hai biên của một lời gọi LLM: **cái gì đi vào**, và **làm sao cái đi ra vào được code an toàn**.

Đây là folder có tỉ lệ (giá trị)/(công sức) cao nhất trong track. Ba trong bốn note ở đây chặn được phần lớn sự cố tích hợp mà không cần biết gì về RAG hay agent.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Prompt như input contract](./01-prompt-as-input-contract.md) | Prompt là gì nếu không phải "viết câu hay"? |
| 2 | [Context engineering](./02-context-engineering.md) | Có 40k tài liệu và 32k token. Chọn gì? |
| 3 | [Structured output](./03-structured-output.md) | Làm sao đưa text của model vào code mà không nổ? |
| 4 | [Provider adapter & DTO](./04-provider-adapter-and-dto.md) | Khi nào cần abstraction, khi nào là overengineering? |

Note 3 là note quan trọng nhất nếu bạn chỉ đọc một.

## Bốn ý chính

**① Prompt là input contract, không phải câu thần chú.** Nó có version, có type, có eval, và đi qua code review như code.

**② Ràng buộc tốt là ràng buộc code kiểm được.**

```text
⚠️  "Đừng bịa thông tin."
✅  "Mỗi khẳng định phải kèm [doc:id]." → validate được, đo được
```

**③ Context engineering là pipeline sáu bước, và `filter` phải trước `rank`.**

```text
available → SELECT → FILTER → RANK → COMPRESS → PLACE → vừa budget
                       ↑
             lọc quyền/tenant Ở ĐÂY, không phải sau khi có top-k
```

**④ Output của LLM là input không đáng tin.** Parse → validate schema → kiểm nghiệp vụ → normalize. Kể cả với structured output của provider: **đảm bảo hình dạng ≠ đảm bảo đúng đắn.**

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Có lúc JSON, có lúc text kèm fence | không ràng buộc format → [3](./03-structured-output.md) |
| `Unexpected end of JSON input` | `finishReason = max_tokens`, kiểm trước khi parse → [3](./03-structured-output.md) |
| Parse OK nhưng thiếu field | chỉ `JSON.parse`, không validate schema → [3](./03-structured-output.md) |
| Enum có giá trị lạ | enum không đóng → [1](./01-prompt-as-input-contract.md), [3](./03-structured-output.md) |
| Model bịa khi thiếu dữ liệu | thiếu đường ra `needsInfo`/`found:false` → [1](./01-prompt-as-input-contract.md) |
| `400 context too large` | không có token budget → [2](./02-context-engineering.md) |
| Chất lượng giảm khi thêm tài liệu | loãng context; pack quá nhiều → [2](./02-context-engineering.md) |
| Cache hit ratio = 0 | biến động trong tiền tố prompt → [1](./01-prompt-as-input-contract.md) |
| Người dùng thấy dữ liệu tenant khác | lọc **sau** retrieval → [2](./02-context-engineering.md) |
| Đổi provider = sửa hàng chục file | hình dạng SDK rò vào nghiệp vụ → [4](./04-provider-adapter-and-dto.md) |
| Output bị cắt được coi là hợp lệ | mapper finish reason mặc định `completed` → [4](./04-provider-adapter-and-dto.md) |
| Tiền có phần thập phân | schema dùng `number` thay vì `int` minor unit → [3](./03-structured-output.md) |

## Khi nào KHÔNG cần adapter

Câu hỏi thật, trả lời ở [note 4](./04-provider-adapter-and-dto.md):

```text
Tầng mỏng (~100 dòng) — gần như LUÔN đáng làm, kể cả một provider:
   mapFinishReason · classifyError · log usage · giới hạn output bắt buộc

Interface đa provider — chỉ khi có lý do cụ thể:
   fallback bắt buộc · model routing · eval nhiều model
   "để sau này dễ đổi" là lý do YẾU NHẤT
```

## Position

```text
Dữ liệu thô  ──▶  [ context builder ]  ──▶  Model  ──▶  [ validate ]  ──▶  DTO
                    note 1, 2                             note 3, 4
```

## Related

- [00-fundamentals/](../00-fundamentals/README.md) — token, context window, finish reason
- [02-chatbot-web/](../02-chatbot-web/README.md) — dùng cả bốn note này trong một feature
- [03-rag/](../03-rag/README.md) — nguồn của khối "tài liệu" trong context
- [06-safety/](../06-safety/README.md) — output vào HTML/SQL/URL
- [07-production/03-ai-caching.md](../07-production/03-ai-caching.md) — thứ tự trong prompt quyết định hoá đơn
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — DTO, validation, serialization
- [Money & Decimal](../../03-database/03-data-modeling/08-money-decimal.md)
