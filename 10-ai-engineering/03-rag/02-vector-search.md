---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-embeddings.md
related:
  - 03-rag-pipeline.md
  - ../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# Vector search: lưu và tìm vector

> Một hệ thống tra cứu tài liệu nội bộ chạy tốt với 20.000 chunk. Ở 2 triệu chunk, truy vấn mất 4 giây. Team thêm index ANN, latency về 40ms — và **chất lượng tụt** mà không ai đo được, vì không có bộ eval. Tài liệu đúng vẫn nằm trong database; index xấp xỉ chỉ đơn giản là không tìm ra nó nữa. Ba tuần sau họ mới biết, từ khiếu nại người dùng.

## Position

```text
query ──embed──▶ [ VECTOR SEARCH ] ──▶ top-k chunk + score + metadata
                        ▲
              note này: lưu ở đâu, tìm thế nào,
              và đánh đổi gì để nhanh
```

## Problem

Tìm vector gần nhất là bài toán đơn giản về mặt định nghĩa và đắt về mặt tính toán:

```text
Chính xác (exact / brute force):
   so query với TẤT CẢ vector → luôn đúng, O(n)
   1 triệu vector × 1536 chiều = ~6 GB phép nhân mỗi truy vấn

Xấp xỉ (ANN — approximate nearest neighbor):
   dựng cấu trúc dữ liệu → nhanh hơn hàng trăm lần
   ĐỔI LẠI: có thể BỎ SÓT kết quả đúng, và bỏ sót IM LẶNG
```

Chữ "im lặng" là toàn bộ vấn đề. Một index chậm thì bạn biết ngay. Một index bỏ sót thì **không có triệu chứng nào ngoài chất lượng câu trả lời** — và nếu bạn không có eval, bạn biết qua khiếu nại.

## Mental Model

### Ba lựa chọn về nơi lưu

| | PostgreSQL + `pgvector` | Vector DB chuyên dụng | Managed service |
|---|---|---|---|
| Quy mô hợp | tới ~vài triệu chunk | hàng chục triệu+ | tuỳ gói |
| Transaction với dữ liệu nghiệp vụ | **có** — cùng DB | không | không |
| Metadata filter | SQL đầy đủ, JOIN được | tuỳ sản phẩm, hạn chế hơn | tuỳ |
| Vận hành | **không thêm hệ thống nào** | thêm một hệ thống stateful | thuê ngoài |
| Backup / khôi phục | đã có sẵn | phải làm riêng | thuê ngoài |

Khuyến nghị thực dụng, và nó nhất quán với cách repo này nghĩ về [PostgreSQL vs MongoDB](../../03-database/06-mongodb/08-postgresql-vs-mongodb.md):

> **Bắt đầu với `pgvector` trong PostgreSQL bạn đã có.** Chuyển sang hệ thống chuyên dụng khi bạn *đo được* rằng nó không đủ — không phải khi bạn đọc rằng nó không đủ.

Lý do mạnh nhất không phải hiệu năng, mà là **transaction và JOIN**: chunk cần lọc theo `tenant_id`, `visible_to`, `deleted_at`, `updated_at` — những cột nằm cùng dữ liệu nghiệp vụ. Hai hệ thống riêng nghĩa là hai nguồn sự thật có thể lệch, và không có transaction nào bao được cả hai. Đó chính là bài toán **dual-write** ở [05-integrations/](../../02-backend-api/05-integrations/README.md).

### Schema chunk

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_chunk (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL,                    -- lọc tenant, MỌI query
  chunk_index   INT  NOT NULL,

  content       TEXT NOT NULL,                    -- ← bản sao nội dung
  token_count   INT  NOT NULL,

  embedding     vector(1536) NOT NULL,
  embed_model   TEXT NOT NULL,                    -- ← model nào sinh ra
  embed_version INT  NOT NULL DEFAULT 1,

  -- metadata để filter và để hiển thị nguồn
  source_uri    TEXT,
  page_number   INT,
  section_title TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX ON doc_chunk (org_id, document_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ON doc_chunk (document_id, chunk_index, embed_version);
```

Hai cột đáng nhấn:

**`embed_model` + `embed_version`** thực thi quy tắc ③ ở [01-embeddings.md](./01-embeddings.md). Nó cũng là cách bạn di trú model **không downtime**: embed lại vào `embed_version = 2` song song, rồi đổi phiên bản đang dùng bằng một dòng config, rồi mới xoá version 1. Đây đúng mẫu **expand/contract** của [05-prisma-migrations-production.md](../../03-database/05-data-access/05-prisma-migrations-production.md).

**`content`** là bản sao đầy đủ của nội dung. Nó cần thiết (bạn phải đưa text vào context), nhưng nó nghĩa là vector store nằm trong checklist xoá dữ liệu.

### Index ANN: hai họ, một đánh đổi

```text
HNSW (graph)
  · build chậm hơn, bộ nhớ nhiều hơn
  · truy vấn nhanh, recall tốt
  · tham số: m (số liên kết), ef_construction (build), ef_search (query)
  · ef_search CAO → recall cao hơn, chậm hơn   ← điều chỉnh lúc chạy

IVFFlat (chia cụm)
  · build nhanh, nhẹ hơn
  · recall thường thấp hơn HNSW ở cùng độ nhanh
  · tham số: lists (số cụm), probes (số cụm quét khi query)
  · CẦN dữ liệu đại diện lúc build — build trên bảng rỗng cho index vô dụng
```

Ba điều thực dụng:

```text
① KHÔNG dùng index khi dữ liệu còn nhỏ (< ~50k chunk).
   Quét tuần tự vừa nhanh vừa CHÍNH XÁC TUYỆT ĐỐI.

② `ef_search` / `probes` là núm điều chỉnh recall ↔ latency LÚC CHẠY.
   Đây là núm bạn sẽ dùng nhiều nhất.

③ Xây index trên bảng gần rỗng rồi mới nạp dữ liệu (nhất là IVFFlat)
   → index không đại diện → recall tệ. Nạp trước, index sau.
```

Và điều bắt buộc: **đo recall trước và sau khi thêm index.**

```sql
-- ground truth: quét chính xác (tắt index cho session này)
SET LOCAL enable_indexscan = off;
SET LOCAL enable_bitmapscan = off;
-- chạy top-20 cho 200 query mẫu → lưu lại tập id

-- rồi bật index, chạy lại, so sánh
-- recall@20 = |giao nhau| / 20
```

Không có bước này, bạn đang ở đúng tình huống đầu note.

### Metadata filter: phần khó bị đánh giá thấp

Đây là chỗ vector search khác biệt nhất với tìm kiếm thông thường, và là chỗ dễ tạo lỗ hổng:

```text
❌ SAI — lọc SAU khi tìm
   top-20 theo vector → .filter(c => c.orgId === orgId)
   → có thể còn 0 chunk; và tài liệu đúng nằm ở hạng 21+
   → tệ hơn: quên lọc ở một đường code = RÒ DỮ LIỆU TENANT KHÁC

✅ ĐÚNG — lọc TRONG truy vấn
   WHERE org_id = $1 AND deleted_at IS NULL
   ORDER BY embedding <=> $2 LIMIT 20
```

Nhưng lọc trong truy vấn có một cái bẫy hiệu năng riêng, và nó là **lý do lớn nhất để chọn PostgreSQL**: khi filter rất chọn lọc (một tenant nhỏ trong hàng triệu chunk), planner có thể **bỏ index ANN** và quét chính xác trong phạm vi đã lọc — điều đó **vừa nhanh vừa chính xác**. Một vector DB không có planner của PostgreSQL thường phải chọn trước: hoặc filter trước hoặc dùng index.

Đọc `EXPLAIN ANALYZE` để biết nó chọn cách nào — đúng kỹ năng đã học ở [01-index-query-plan.md](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md). Vector không phải ngoại lệ; nó là một kiểu index nữa mà planner phải cân nhắc.

### Hybrid search: vector + từ khoá

Vector yếu với mã, ID, tên riêng. Tìm từ khoá yếu với diễn đạt khác nhau. Kết hợp cả hai thắng từng cái riêng lẻ trong hầu hết hệ thống thật:

```text
query "chính sách hoàn tiền cho SKU-9912"
   ├─ vector search   → chunk về chủ đề hoàn tiền
   └─ full-text search → chunk chứa CHÍNH XÁC "SKU-9912"
        ↓ hợp nhất điểm (RRF hoặc trọng số)
      top-k cuối
```

**RRF** (Reciprocal Rank Fusion) là cách hợp nhất đơn giản và bền: nó dùng **thứ hạng**, không dùng điểm thô — nên không cần chuẩn hoá hai loại điểm khác thang.

```sql
-- Ý tưởng RRF: điểm = Σ 1/(k + rank) trên mỗi danh sách
WITH v AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $emb) AS rank
  FROM doc_chunk WHERE org_id = $org AND deleted_at IS NULL LIMIT 50
),
f AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS rank
  FROM doc_chunk, websearch_to_tsquery('simple', $text) q
  WHERE org_id = $org AND deleted_at IS NULL AND tsv @@ q LIMIT 50
)
SELECT id, SUM(1.0 / (60 + rank)) AS score
FROM (SELECT * FROM v UNION ALL SELECT * FROM f) x
GROUP BY id ORDER BY score DESC LIMIT 20;
```

Cả hai nửa nằm trong **cùng một database**, cùng một transaction, cùng một filter tenant. Chi tiết nửa full-text (và vì sao tiếng Việt dùng `'simple'` + `unaccent`): [04-full-text-search.md](../../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md).

### top-k: lấy rộng để rerank, giữ hẹp để pack

```text
retrieve top-50   →  rerank  →  pack top-5..8 trong token budget
     ↑ rộng            ↑ chính xác hơn      ↑ hẹp
```

Đây là điểm nối với [02-context-engineering.md](../01-context-and-output/02-context-engineering.md): `top_k` của retrieval **không phải** số chunk đưa vào context. Nhầm hai cái là lý do người ta nhồi 20 chunk vào prompt.

## Prediction

1. Bạn có 30.000 chunk và thêm index HNSW. Latency và recall thay đổi thế nào?
2. Bạn tạo index IVFFlat trên bảng rỗng rồi import 2 triệu chunk. Kết quả tìm kiếm?
3. Bạn lọc `orgId` bằng `.filter()` sau khi lấy top-20. Hai rủi ro là gì?
4. Bạn đổi embedding model và cập nhật config. Người dùng thấy gì?
5. Người dùng tìm "SKU-9912". Chỉ có vector search. Kết quả?

<details>
<summary>Đáp án</summary>

1. Latency có thể **không tốt hơn đáng kể** (30k chunk quét tuần tự vẫn nhanh), và recall **giảm từ 100% xuống có thể 90–95%**. Ở quy mô này, index thường là đánh đổi lỗ. Đo trước.
2. **Recall rất tệ.** IVFFlat học các cụm lúc build; build trên bảng rỗng nghĩa là các cụm không đại diện dữ liệu thật. Phải nạp dữ liệu rồi mới tạo index (hoặc tạo lại).
3. (a) **Có thể còn 0 chunk** dù tài liệu đúng tồn tại ở hạng 21+; (b) nếu quên lọc ở một đường code nào đó, **chunk của tenant khác đi vào context** — lỗ hổng phân quyền thật.
4. **Rác** — cho tới khi embed lại xong. Query vector ở không gian mới, chunk vector ở không gian cũ, cosine giữa chúng vô nghĩa. Phải embed song song vào `embed_version` mới rồi mới chuyển.
5. Thường **không tìm được** — hoặc trả về chunk cùng chủ đề mà không chứa mã đó. Cần hybrid search.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Chất lượng tụt sau khi thêm index | ANN bỏ sót; không đo recall trước/sau |
| Recall tệ ngay từ đầu với IVFFlat | build index trên bảng rỗng/nhỏ |
| Truy vấn chậm dần theo dữ liệu | chưa có index, hoặc filter không dùng index |
| Trả về 0 kết quả dù tài liệu tồn tại | lọc sau retrieval; hoặc ngưỡng score quá cao |
| Chunk của tenant khác xuất hiện | thiếu filter trong query ở một đường code |
| Không tìm được mã / ID | chỉ vector, thiếu hybrid |
| Kết quả vô nghĩa sau khi đổi model | trộn hai không gian embedding |
| Xoá tài liệu nhưng vẫn trả về | chunk không CASCADE / không lọc `deleted_at` |
| Tài liệu đã cập nhật nhưng trả nội dung cũ | chunk cũ chưa xoá khi re-index |
| Bộ nhớ DB tăng vọt | HNSW tốn RAM; hoặc `content` lớn không giới hạn |

Dòng "tài liệu đã cập nhật" là bug im lặng phổ biến: khi re-index một tài liệu, phải **xoá chunk cũ trong cùng transaction** với việc chèn chunk mới, nếu không bạn có cả hai phiên bản cùng lúc.

```ts
await prisma.$transaction(async (tx) => {
  await tx.docChunk.deleteMany({ where: { documentId, embedVersion } });
  await tx.docChunk.createMany({ data: newChunks });
});
```

## Debugging

```text
1. EXPLAIN ANALYZE truy vấn retrieval → dùng index gì? quét bao nhiêu dòng?
2. Chạy query với index TẮT → tài liệu đúng có xuất hiện không?
     CÓ  → index bỏ sót (tăng ef_search/probes, hoặc bỏ index)
     KHÔNG → embedding/chunking sai, không phải index (xem note 04)
3. Đếm chunk sau filter tenant → còn bao nhiêu trước khi xếp hạng?
4. Kiểm embed_model của chunk == model đang dùng cho query?
5. Đo recall@k trên 200 query mẫu — con số, không phải cảm giác
6. Thử hybrid với đúng query đó → có tốt hơn không?
```

Bước 2 là bước tách nguyên nhân quan trọng nhất trong toàn bộ RAG: nó phân biệt **lỗi index** với **lỗi chunking/embedding**.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `pgvector` trong PostgreSQL | một hệ thống, transaction, JOIN, backup có sẵn | giới hạn quy mô (nhưng cao hơn nhiều người nghĩ) |
| Vector DB chuyên dụng | quy mô rất lớn, tính năng chuyên biệt | thêm hệ thống stateful, dual-write, không transaction |
| Không index (quét tuần tự) | recall 100% | chậm khi lớn |
| HNSW | nhanh + recall tốt | RAM nhiều, build chậm |
| IVFFlat | build nhanh, nhẹ | recall thấp hơn; cần dữ liệu lúc build |
| `ef_search` cao | recall cao | latency cao |
| Hybrid search | mạnh với cả ngữ nghĩa và mã | hai index; phải hợp nhất điểm |
| Lưu `content` trong chunk | không cần đọc lại file gốc | bản sao dữ liệu → nằm trong checklist xoá |

## Explain Without Notes

1. ANN đổi **recall** lấy **latency**, và bỏ sót là bỏ sót **im lặng** — phải đo recall.
2. Bắt đầu với `pgvector`; lý do mạnh nhất là transaction + JOIN + filter, không phải hiệu năng.
3. Filter tenant nằm **trong** truy vấn, không phải sau.
4. `embed_model` + `embed_version` cho phép đổi model theo mẫu expand/contract.
5. Vector yếu với mã/ID → hybrid search; và `top_k` retrieval ≠ số chunk vào context.

## Related

- [Embedding](./01-embeddings.md) — cùng model cho query và document
- [RAG pipeline](./03-rag-pipeline.md) — chunking và luồng đầy đủ
- [RAG failure modes](./04-rag-failure-modes.md) — phân biệt lỗi index vs lỗi chunk
- [Context engineering](../01-context-and-output/02-context-engineering.md) — filter trước rank; pack theo token
- [Index & query plan](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — đọc `EXPLAIN`
- [Full-text search](../../03-database/01-postgresql/indexes-query-planning/04-full-text-search.md) — nửa còn lại của hybrid
- [PostgreSQL vs MongoDB](../../03-database/06-mongodb/08-postgresql-vs-mongodb.md) — cách chọn store
- [Prisma migrations production](../../03-database/05-data-access/05-prisma-migrations-production.md) — expand/contract
- [Integrations](../../02-backend-api/05-integrations/README.md) — dual-write khi có hai store
- [Message queues](../../03-database/04-message-queues/README.md) — job embedding hàng loạt
