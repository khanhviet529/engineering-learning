---
level: intermediate
area: ai-engineering
---

# RAG — Retrieval-Augmented Generation

Làm sao model trả lời được về **dữ liệu của bạn** — dữ liệu nội bộ, dữ liệu mới, dữ liệu riêng của từng khách hàng.

Câu quan trọng nhất của cả folder, nêu trước:

> **Chất lượng câu trả lời bị chặn trên bởi chất lượng retrieval.** Model tốt không bù được retrieval tệ — nó chỉ diễn đạt thông tin sai một cách thuyết phục hơn.

## Vào đây từ đâu

```text
Chưa chắc embedding / vector / cosine là gì?
        └──▶ 01-embeddings.md          ← từ vựng, ~10 phút

Muốn dựng RAG?
        └──▶ 03-rag-pipeline.md        ← luồng đầy đủ, chunking là bước quyết định

RAG đã chạy và trả lời sai?
        └──▶ 04-rag-failure-modes.md   ← cây quyết định 6 tầng
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Embedding](./01-embeddings.md) | vector, cosine, dimension — **là gì**, và **không làm được gì** |
| 2 | [Vector search](./02-vector-search.md) | Lưu ở đâu? ANN đổi gì? Hybrid search là gì? |
| 3 | [RAG pipeline](./03-rag-pipeline.md) | Chunking, retrieval, rerank, grounding, citation |
| 4 | [RAG failure modes](./04-rag-failure-modes.md) | Trả lời sai — lỗi ở tầng nào trong sáu tầng? |
| 5 | [RAG vs fine-tuning](./05-rag-vs-fine-tuning.md) | Khi nào RAG, khi nào fine-tune, khi nào chỉ cần **code** |

## Bốn ý chính

**① Cosine cao ≠ trả lời được câu hỏi.** Embedding đo *độ giống chủ đề*, không đo *khả năng trả lời*. Đây là lý do tăng `top_k` thường không cải thiện gì.

**② Chunk phải tự nó có nghĩa.** Cách rẻ nhất đạt được điều đó là **contextual header**:

```text
[Sổ tay 2026 › Ch.4 Phúc lợi › 4.2 Nghỉ phép › Bảng áp dụng từ 01/2026]

Nhân viên dưới 3 năm: 12 ngày...
```

Một thay đổi, ba lợi ích: retrieval tốt hơn, model hiểu phạm vi, và citation hiện được nguồn.

**③ Bắt đầu với `pgvector` trong PostgreSQL bạn đã có.** Lý do mạnh nhất không phải hiệu năng mà là **transaction + JOIN + filter tenant** — chunk cần lọc theo `org_id`, `visible_to`, `deleted_at`, những cột nằm cùng dữ liệu nghiệp vụ.

**④ Fine-tuning dạy model *cách nói*, không dạy nó *biết gì*.** Nhu cầu "model cần biết dữ liệu của tôi" → RAG. Nhu cầu "kết quả phải đúng theo quy tắc" → **code**.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Sai một con số / một điều kiện cụ thể | chunk mất tiêu đề bảng → [3](./03-rag-pipeline.md), [4](./04-rag-failure-modes.md) |
| "Không tìm thấy" dù tài liệu tồn tại | ingestion / embedding / filter → [4](./04-rag-failure-modes.md) |
| Trả lời về sai đối tượng, sai phạm vi | chunk mất heading cha → [3](./03-rag-pipeline.md) |
| Bịa hoàn toàn khi không có dữ liệu | thiếu ngưỡng score + `found:false` → [3](./03-rag-pipeline.md) |
| Không tìm được mã / ID (`SKU-9912`) | vector yếu với định danh → hybrid → [2](./02-vector-search.md) |
| Trả về điều **trái ngược** | truy vấn có phủ định → [1](./01-embeddings.md) |
| Chất lượng tụt sau khi thêm index | ANN bỏ sót; không đo recall → [2](./02-vector-search.md) |
| Chất lượng tụt sau khi thêm nhiều tài liệu | loãng context; pack quá nhiều → [4](./04-rag-failure-modes.md) |
| Citation trỏ tài liệu không tồn tại | không verify citation → [3](./03-rag-pipeline.md) |
| Người dùng thấy tài liệu tenant khác | lọc **sau** retrieval → [2](./02-vector-search.md) |
| Một nửa chunk là menu website | parse không bỏ `<nav>` → [4](./04-rag-failure-modes.md) |
| Nội dung cũ và mới cùng xuất hiện | re-index không xoá chunk cũ → [2](./02-vector-search.md) |
| Kết quả vô nghĩa sau khi đổi embed model | trộn hai không gian → [1](./01-embeddings.md) |
| Upload file lớn bị timeout | ingestion trong request thay vì job → [3](./03-rag-pipeline.md) |
| Fine-tune xong vẫn bịa số liệu | dùng fine-tuning cho bài toán kiến thức → [5](./05-rag-vs-fine-tuning.md) |

## Thứ tự sửa khi RAG kém

Từ rẻ nhất tới đắt nhất — và **không** phải thứ tự người ta hay làm:

```text
⑤ context  giảm top_k, pack theo token          ← rất rẻ, thử trước
① ingestion sửa parse, bỏ boilerplate            ← rẻ, hiệu quả cao nếu đang có rác
② chunking  contextual header, không cắt bảng    ← re-index, hiệu quả cao nhất
④ retrieval thêm rerank, thêm hybrid             ← rẻ–trung, hiệu quả cao
⑥ generation sửa prompt grounding                ← rẻ, nhưng ít khi là nguyên nhân
③ embedding đổi model                            ← ĐẮT NHẤT, ít khi là nguyên nhân
```

Đổi embedding model là việc đắt nhất và người ta hay làm sớm nhất.

## Position

```text
INGEST (offline, trong queue)
  document → parse → clean → CHUNK → enrich → embed → store

QUERY (online)
  question → rewrite? → embed → retrieve (filter tenant) → rerank
           → pack theo token → model (grounded prompt) → verify citation
```

## Related

- [00-fundamentals/](../00-fundamentals/README.md) — token, context window
- [01-context-and-output/02-context-engineering.md](../01-context-and-output/02-context-engineering.md) — pack theo budget
- [02-chatbot-web/](../02-chatbot-web/README.md) — RAG trong một chatbot
- [05-evaluation/02-rag-and-agent-evaluation.md](../05-evaluation/02-rag-and-agent-evaluation.md) — recall@k đặt trần cho mọi thứ
- [06-safety/01-prompt-injection.md](../06-safety/01-prompt-injection.md) — tài liệu retrieve **không** đáng tin
- [Full-text search (PostgreSQL)](../../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) — nửa còn lại của hybrid
- [Index & query plan](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — đọc `EXPLAIN`
- [PostgreSQL vs MongoDB](../../03-database/06-mongodb/08-postgresql-vs-mongodb.md) — cách chọn store
- [Message queues](../../03-database/04-message-queues/README.md) — ingestion là job
