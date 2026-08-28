---
level: intermediate
area: database
prerequisites:
  - 01-index-query-plan.md
  - 02-index-types.md
related:
  - ../../../06-system-design/06-storage-selection.md
  - ../../05-data-access/06-raw-sql-escape-hatches.md
---

# Full-text search trong PostgreSQL

> `LIKE '%từ khoá%'` không dùng được index và không hiểu tiếng Việt. `tsvector` giải quyết cả hai — nhưng nó **không** giải quyết được lỗi chính tả và tìm không dấu, và đó là lúc bạn cần công cụ khác.

*Baseline: PostgreSQL 16.*

## Position

```text
Người dùng nhập "áo thun nam"
      ↓
LIKE?  ILIKE?  tsvector?  pg_trgm?  Elasticsearch?
      ↓
GIN index → ranking → kết quả
```

## Problem

```sql
-- Tìm sản phẩm — cách ai cũng viết đầu tiên
SELECT * FROM products WHERE name ILIKE '%áo thun%';
```

Bốn vấn đề, và chúng cộng dồn:

| Vấn đề | Chi tiết |
|---|---|
| **Không dùng index** | `%` ở đầu → B-tree vô dụng → seq scan toàn bảng |
| **Không có ranking** | không biết kết quả nào liên quan hơn |
| **Không hiểu từ** | tìm "chạy" không ra "chạy bộ"; tìm "running" không ra "run" |
| **Không tìm được không dấu** | người dùng gõ "ao thun" → 0 kết quả |

Vấn đề thứ tư là vấn đề đặc thù tiếng Việt và là vấn đề người dùng gặp nhiều nhất — họ gõ không dấu vì nhanh hơn.

## Mental Model

Bốn công cụ, bốn bài toán khác nhau. Chọn sai là dùng búa cho việc cần tuốc nơ vít:

```text
1. LIKE 'prefix%'      tìm theo TIỀN TỐ
                       → B-tree index bình thường HOẠT ĐỘNG
                       → autocomplete đơn giản

2. tsvector / tsquery  tìm theo TỪ, có ranking
                       → GIN index
                       → "tìm tài liệu chứa những từ này"

3. pg_trgm             tìm theo ĐỘ TƯƠNG TỰ (fuzzy)
                       → GIN/GiST index, hoạt động cả với '%từ%'
                       → sai chính tả, tìm không dấu, tên riêng

4. Elasticsearch       tìm phức tạp: facet, synonym, ngôn ngữ tự nhiên,
   / Meilisearch       typo tolerance, relevance tuning
                       → khi 1–3 không đủ
```

Và một điều quan trọng về tiếng Việt:

> **PostgreSQL không có text search configuration cho tiếng Việt.** Không có bộ stemmer, không có danh sách stop word.
>
> Vì vậy với tiếng Việt, `tsvector` với `'simple'` config + **`unaccent`** + **`pg_trgm`** thường thực dụng hơn là cố dùng stemming.

Đây là điểm khác biệt lớn so với tiếng Anh, nơi `to_tsvector('english', ...)` làm rất tốt.

## How It Works

### `tsvector` — từ và vị trí

```sql
SELECT to_tsvector('simple', 'Áo thun nam cotton cao cấp');
-- 'cotton':4 'cao':5 'cấp':6 'nam':3 'thun':2 'áo':1
--   từ đã chuẩn hoá : vị trí trong văn bản

SELECT to_tsvector('english', 'The running shoes are running fast');
-- 'fast':6 'run':2,5 'shoe':3
--   → stemming: running → run;  bỏ stop word: the, are
```

`'english'` làm stemming và bỏ stop word. `'simple'` chỉ lowercase và tách từ — và đó là những gì bạn có với tiếng Việt.

```sql
-- Truy vấn
SELECT to_tsquery('simple', 'áo & thun');        -- AND
SELECT to_tsquery('simple', 'áo | quần');        -- OR
SELECT to_tsquery('simple', 'áo & !trẻ');        -- NOT
SELECT phraseto_tsquery('simple', 'áo thun');    -- cụm liền nhau
SELECT websearch_to_tsquery('simple', 'áo thun -trẻ "cao cấp"');
--        ↑ NÊN DÙNG CÁI NÀY cho input người dùng
```

**`websearch_to_tsquery` là hàm nên dùng cho input từ người dùng**: nó nhận cú pháp kiểu Google (`-` để loại trừ, `"..."` cho cụm) và **không bao giờ throw** với input rác. `to_tsquery` throw với input như `áo &&` — nghĩa là người dùng gõ sai làm API của bạn trả 500.

### Cột `tsvector` được sinh tự động

```sql
-- PostgreSQL 12+: GENERATED column — luôn đồng bộ, không cần trigger
ALTER TABLE products
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(unaccent(name), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(unaccent(brand), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(unaccent(description), '')), 'C')
  ) STORED;

CREATE INDEX idx_products_search ON products USING gin (search_vector);
```

Bốn chi tiết quyết định:

1. **`GENERATED ALWAYS ... STORED`** thay vì trigger — nó không thể lệch với dữ liệu. Trigger có thể bị quên khi ai đó `UPDATE` bằng SQL trực tiếp.
2. **`setweight` A/B/C/D** — cho phép ranking: khớp trong `name` quan trọng hơn khớp trong `description`.
3. **`coalesce(..., '')`** — `NULL` làm cả biểu thức thành `NULL`, và bạn mất toàn bộ vector của dòng đó. Đây là bug im lặng phổ biến.
4. **`unaccent`** — chìa khoá cho tiếng Việt, xem dưới.

Lưu ý: `unaccent` trong GENERATED column yêu cầu function `IMMUTABLE`. `unaccent(text)` mặc định là `STABLE`, nên cần wrapper:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Wrapper IMMUTABLE để dùng được trong GENERATED column và index
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
```

Rồi dùng `immutable_unaccent` thay cho `unaccent` trong định nghĩa cột.

### Tìm không dấu — vấn đề tiếng Việt

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

SELECT unaccent('Áo thun nam');     -- 'Ao thun nam'
```

Nguyên tắc: **bỏ dấu ở cả hai phía** — lúc index và lúc query.

```sql
-- Index đã bỏ dấu (như GENERATED column ở trên)
-- Query cũng bỏ dấu:
SELECT id, name,
       ts_rank(search_vector, q) AS rank
FROM products,
     websearch_to_tsquery('simple', immutable_unaccent($1)) q
WHERE search_vector @@ q
ORDER BY rank DESC, id
LIMIT 20;
```

Giờ "ao thun", "áo thun", "Áo Thun" đều tìm ra cùng kết quả.

Đánh đổi: bỏ dấu làm mất khả năng phân biệt. `'hoa'` và `'hoà'` thành cùng một từ. Với tìm kiếm sản phẩm thì đó là điều bạn **muốn**; với tìm kiếm chính xác trong văn bản pháp lý thì không.

### Ranking

```sql
-- ts_rank: dựa vào tần suất từ + weight (A/B/C/D)
-- ts_rank_cd: cover density — ưu tiên các từ khớp GẦN NHAU
SELECT id, name,
       ts_rank_cd(search_vector, q, 32) AS rank
FROM products, websearch_to_tsquery('simple', immutable_unaccent($1)) q
WHERE search_vector @@ q
ORDER BY rank DESC, id DESC        -- tie-breaker để pagination ổn định
LIMIT 20;
```

`ts_rank_cd` thường cho kết quả tốt hơn cho câu nhiều từ — nó ưu tiên tài liệu mà các từ khớp nằm gần nhau.

**Kết hợp với tín hiệu nghiệp vụ** — đây là nơi bạn thường thắng được search engine mặc định:

```sql
ORDER BY
  ts_rank_cd(search_vector, q) * 1.0
  + (CASE WHEN p.is_featured THEN 0.5 ELSE 0 END)
  + log(1 + p.sold_count) * 0.1
  + (CASE WHEN p.in_stock THEN 0.2 ELSE 0 END)
  DESC
```

Sản phẩm còn hàng và bán chạy nên xếp trên — thông tin đó không nằm trong text.

### Highlight

```sql
SELECT ts_headline(
  'simple',
  description,
  websearch_to_tsquery('simple', immutable_unaccent($1)),
  'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10'
) AS snippet
FROM products WHERE ...;
```

`ts_headline` **đắt** — nó xử lý văn bản gốc, không dùng index. Chỉ gọi nó cho các dòng đã được `LIMIT`:

```sql
WITH hits AS (
  SELECT id, description, ts_rank_cd(search_vector, q) r
  FROM products, websearch_to_tsquery('simple', immutable_unaccent($1)) q
  WHERE search_vector @@ q
  ORDER BY r DESC LIMIT 20
)
SELECT id, ts_headline('simple', description, websearch_to_tsquery('simple', immutable_unaccent($1))) 
FROM hits;
```

### `pg_trgm` — fuzzy và `%từ%`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram: chia chuỗi thành cụm 3 ký tự
SELECT show_trgm('áo thun');    -- {"  á"," áo","ao ","o t"...}

-- Index cho ILIKE '%...%' — GIN trigram HOẠT ĐỘNG với % ở đầu
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Giờ cái này dùng được index:
SELECT * FROM products WHERE name ILIKE '%thun%';

-- Fuzzy: chịu được sai chính tả
SELECT name, similarity(name, 'ao thn nam') AS sim
FROM products
WHERE name % 'ao thn nam'                  -- toán tử % = similarity vượt ngưỡng
ORDER BY sim DESC LIMIT 10;

SET pg_trgm.similarity_threshold = 0.3;    -- mặc định 0.3
```

`pg_trgm` là công cụ giải quyết hai thứ `tsvector` không làm được: **sai chính tả** và **tìm chuỗi con** (`%từ%`).

**Kết hợp cả hai** thường là giải pháp thực tế nhất:

```sql
-- tsvector cho độ chính xác, trgm làm fallback khi không có kết quả
WITH exact AS (
  SELECT id, name, ts_rank_cd(search_vector, q) * 2 AS score
  FROM products, websearch_to_tsquery('simple', immutable_unaccent($1)) q
  WHERE search_vector @@ q
),
fuzzy AS (
  SELECT id, name, similarity(immutable_unaccent(name), immutable_unaccent($1)) AS score
  FROM products
  WHERE immutable_unaccent(name) % immutable_unaccent($1)
)
SELECT DISTINCT ON (id) id, name, score
FROM (SELECT * FROM exact UNION ALL SELECT * FROM fuzzy) s
ORDER BY id, score DESC;
```

### Autocomplete — dùng prefix, không dùng full-text

```sql
-- ✅ Prefix: B-tree index bình thường, rất nhanh
CREATE INDEX idx_products_name_prefix ON products (lower(immutable_unaccent(name)) text_pattern_ops);

SELECT name FROM products
WHERE lower(immutable_unaccent(name)) LIKE lower(immutable_unaccent($1)) || '%'
ORDER BY sold_count DESC LIMIT 10;

-- Hoặc tsquery với prefix matching
SELECT * FROM products WHERE search_vector @@ to_tsquery('simple', 'áo:*');
```

Autocomplete có yêu cầu khác search: nó cần **rất nhanh** (< 50ms) và chỉ khớp **tiền tố**. Dùng full-text search cho autocomplete là dùng sai công cụ.

`text_pattern_ops` là bắt buộc nếu database dùng collation không phải `C` — không có nó, `LIKE 'prefix%'` không dùng được index.

### Khi nào cần Elasticsearch / Meilisearch

PostgreSQL FTS đủ cho phần lớn ứng dụng. Chuyển khi có **tín hiệu cụ thể**, không vì "search cần Elasticsearch":

```text
✅ Vẫn dùng PostgreSQL khi:
   - < vài triệu document
   - tìm theo từ khoá + filter + sort
   - đã có PostgreSQL, không muốn thêm hệ thống
   - relevance đơn giản (text + vài tín hiệu nghiệp vụ)

⚠️ Cân nhắc Meilisearch/Typesense khi:
   - cần typo tolerance TỐT out-of-the-box
   - cần autocomplete instant (< 20ms) trên tập lớn
   - muốn cấu hình relevance mà không viết SQL

⚠️ Cân nhắc Elasticsearch/OpenSearch khi:
   - hàng chục triệu+ document
   - facet/aggregation phức tạp trên kết quả search
   - synonym, phân tích ngôn ngữ chuyên biệt
   - relevance tuning là công việc thường xuyên
   - search là tính năng CỐT LÕI của sản phẩm
```

Chi phí thật của việc thêm search engine:

```text
+ Một hệ thống nữa phải vận hành, monitor, backup
+ ĐỒNG BỘ dữ liệu: PostgreSQL → search index
  → dual-write → cần outbox/CDC, nếu không index sẽ lệch
+ Không có transaction giữa DB và index
+ Reindex khi đổi mapping (có thể mất hàng giờ)
```

Vấn đề đồng bộ là vấn đề lớn nhất và bị đánh giá thấp nhất — nó là cùng bài toán dual-write với [outbox pattern](../../04-message-queues/06-outbox-pattern.md). Xem [Storage selection](../../../06-system-design/06-storage-selection.md).

## Example

```text
Search sản phẩm — kiến trúc thực dụng, chỉ dùng PostgreSQL

Extension:  unaccent, pg_trgm + immutable_unaccent()
Cột:        search_vector GENERATED (name A, brand B, description C, đã unaccent)
Index:      GIN (search_vector)
            GIN (immutable_unaccent(name) gin_trgm_ops)     — fuzzy
            BTREE (lower(immutable_unaccent(name)) text_pattern_ops) — autocomplete

Query:      websearch_to_tsquery (không throw với input rác)
Ranking:    ts_rank_cd + is_featured + log(sold_count) + in_stock
Fallback:   nếu 0 kết quả → pg_trgm similarity
Highlight:  ts_headline CHỈ trên 20 dòng đã LIMIT
Pagination: cursor với tie-breaker (rank, id)
```

## Prediction

1. `WHERE name ILIKE '%thun%'` với index B-tree trên `name` — dùng index không?
2. Cùng query với GIN trigram index — dùng index không?
3. `to_tsquery('simple', 'áo &&')` từ input người dùng — kết quả?
4. `websearch_to_tsquery` cùng input — kết quả?
5. `to_tsvector('simple', name || ' ' || description)` với `description IS NULL` — vector là gì?
6. Người dùng gõ "ao thun" (không dấu), index có dấu — bao nhiêu kết quả?
7. `to_tsvector('english', 'running')` và `to_tsvector('english', 'run')` — khớp nhau không?
8. Cùng thí nghiệm với `'simple'` — khớp không?
9. `ts_headline` trên 100.000 dòng khớp — chi phí?
10. Thêm Elasticsearch, ghi DB thành công nhưng index lỗi — trạng thái?

<details>
<summary>Đáp án</summary>

1. **Không** — `%` ở đầu làm B-tree vô dụng → seq scan.
2. **Có** — GIN trigram hoạt động với `%` ở đầu.
3. **Throw** — API trả 500 vì người dùng gõ sai.
4. Trả kết quả bình thường — nó không bao giờ throw.
5. `NULL` — mất toàn bộ vector của dòng đó. Cần `coalesce`.
6. **0** — phải `unaccent` cả hai phía.
7. **Có** — stemming đưa cả hai về `run`.
8. **Không** — `'simple'` không stem.
9. Rất đắt — nó xử lý văn bản gốc, không dùng index. Chỉ chạy sau `LIMIT`.
10. Index lệch với DB — dual-write, cần outbox/CDC.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `EXPLAIN ANALYZE` với `ILIKE '%x%'` và B-tree index | Seq scan |
| Thêm GIN trigram, làm lại | Bitmap Index Scan |
| `to_tsquery` với input `'a &'` | Throw |
| Đổi sang `websearch_to_tsquery` | Không throw |
| Bỏ `coalesce` với một dòng có `description NULL` | Dòng đó không tìm được |
| Index có dấu, query không dấu | 0 kết quả |
| Thêm `unaccent` hai phía | Tìm ra |
| `ts_headline` trước `LIMIT` trên bảng lớn | Đo thời gian; so với sau `LIMIT` |
| `LIKE 'prefix%'` không có `text_pattern_ops` (collation không phải C) | Không dùng index |
| Thêm `text_pattern_ops` | Index scan |
| Cập nhật `name` bằng SQL, xem `search_vector` (GENERATED) | Tự cập nhật |
| Cùng thí nghiệm với trigger thay vì GENERATED, quên trigger | Vector lệch |
| Thêm ES, ghi DB rồi kill process trước khi index | Index thiếu document |

Thí nghiệm 11–12 cạnh nhau cho thấy vì sao `GENERATED` tốt hơn trigger.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `ILIKE '%x%'` chậm vì dữ liệu lớn | Chậm vì không dùng được index; trigram sửa được |
| PostgreSQL FTS hỗ trợ tiếng Việt | Không có config tiếng Việt; dùng `'simple'` + `unaccent` |
| `to_tsquery` dùng được cho input người dùng | Nó throw; dùng `websearch_to_tsquery` |
| `tsvector` xử lý được sai chính tả | Không — cần `pg_trgm` |
| Search cần Elasticsearch | PostgreSQL đủ cho phần lớn ứng dụng |
| Thêm ES là thêm một index | Nó là dual-write, cần outbox/CDC |
| `ts_headline` rẻ như `ts_rank` | Nó xử lý văn bản gốc, rất đắt |
| Autocomplete dùng full-text search | Prefix + B-tree nhanh hơn nhiều bậc |
| GIN index cập nhật nhanh như B-tree | GIN ghi chậm hơn; có `fastupdate` để cân bằng |
| `unaccent` dùng được ngay trong GENERATED column | Cần wrapper `IMMUTABLE` |

## Debugging

1. **Search chậm** → `EXPLAIN ANALYZE` trước tiên. Tìm `Seq Scan` — nếu có, index không được dùng và mọi thứ khác là thứ yếu.
2. **Index không được dùng** → kiểm tra toán tử khớp với loại index: `@@` cần GIN trên `tsvector`; `ILIKE '%x%'` cần `gin_trgm_ops`; `LIKE 'x%'` cần `text_pattern_ops`.
3. **Kết quả 0 dù dữ liệu có** → in ra vector và query để so:
   ```sql
   SELECT search_vector FROM products WHERE id = $1;
   SELECT websearch_to_tsquery('simple', immutable_unaccent('ao thun'));
   ```
   Đây là cách nhanh nhất thấy vấn đề unaccent hoặc config.
4. **Một số dòng không bao giờ tìm được** → nghi `NULL` trong biểu thức vector; kiểm tra `coalesce`.
5. **Ranking không hợp lý** → thử `ts_rank_cd` thay `ts_rank`, và kiểm tra `setweight` có đúng thứ tự ưu tiên.
6. **API 500 khi người dùng gõ ký tự lạ** → đang dùng `to_tsquery`; đổi sang `websearch_to_tsquery`.
7. **Index GIN lớn/ghi chậm** → xem `fastupdate` và `gin_pending_list_limit`; và cân nhắc có cần index cả `description` không.

## Production Considerations

- **`GENERATED ALWAYS ... STORED`** thay vì trigger — không thể lệch.
- **`coalesce` cho mọi cột** trong biểu thức vector.
- **`websearch_to_tsquery` cho mọi input người dùng** — không bao giờ `to_tsquery` trực tiếp.
- **`unaccent` hai phía** cho tiếng Việt, qua wrapper `IMMUTABLE`.
- **`ts_headline` chỉ sau `LIMIT`.**
- **Kết hợp `tsvector` + `pg_trgm`** — chính xác trước, fuzzy làm fallback.
- **Autocomplete tách riêng** bằng prefix index.
- **Ranking kết hợp tín hiệu nghiệp vụ** (còn hàng, bán chạy) — đây là lợi thế của việc search nằm cùng database.
- **Cursor pagination với tie-breaker** `(rank, id)` — rank có thể trùng.
- **GIN index ghi chậm hơn B-tree**; với bảng ghi nhiều, đo trước và cân nhắc chỉ index cột thật cần.
- **Chỉ thêm search engine khi có tín hiệu cụ thể**, và khi đó **thiết kế đồng bộ trước** (outbox/CDC), không phải sau.
- **Rate limit endpoint search** — nó đắt và dễ bị lạm dụng. Xem [Rate limiting](../../../02-backend-api/00-http-api/07-rate-limiting.md).

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| `LIKE 'prefix%'` | rất nhanh, B-tree thường | chỉ tiền tố |
| `tsvector` + GIN | ranking, hiểu từ, nhanh | không fuzzy, cần config ngôn ngữ |
| `pg_trgm` | fuzzy, `%x%` dùng index | index lớn, ranking thô hơn |
| Cả hai kết hợp | phủ hầu hết nhu cầu | query phức tạp hơn |
| `unaccent` | tìm không dấu | mất phân biệt dấu |
| PostgreSQL FTS | không thêm hệ thống, join được với dữ liệu khác, transaction | relevance tuning hạn chế, không typo tolerance tốt |
| Meilisearch/Typesense | typo tolerance, instant search | thêm hệ thống, đồng bộ |
| Elasticsearch | mạnh nhất, facet, scale | vận hành nặng, dual-write, reindex đắt |

## Explain Without Notes

1. Bốn vấn đề của `ILIKE '%x%'`?
2. Bốn công cụ search và mỗi cái giải quyết bài toán gì?
3. Vì sao tiếng Việt cần `unaccent` + `'simple'` thay vì stemming?
4. Vì sao `websearch_to_tsquery` thay vì `to_tsquery`?
5. Vì sao `coalesce` bắt buộc trong biểu thức `tsvector`?
6. Chi phí thật của việc thêm Elasticsearch — điều gì lớn nhất?

## Related

- [Index & query plan](01-index-query-plan.md) — vì sao `%` ở đầu phá B-tree
- [Index types](02-index-types.md) — GIN, GiST, expression index
- [EXPLAIN ANALYZE workflow](03-explain-analyze-workflow.md) — đo search
- [Raw SQL escape hatches](../../05-data-access/06-raw-sql-escape-hatches.md) — FTS cần raw SQL
- [Storage selection](../../../06-system-design/06-storage-selection.md) — khi nào cần search engine riêng
- [Outbox pattern](../../04-message-queues/06-outbox-pattern.md) — đồng bộ DB → search index
- [Pagination](../../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — cursor với tie-breaker
- [Rate limiting](../../../02-backend-api/00-http-api/07-rate-limiting.md)
