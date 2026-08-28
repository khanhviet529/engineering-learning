---
level: advanced
area: database
prerequisites:
  - 01-index-query-plan.md
related:
  - 03-explain-analyze-workflow.md
  - ../transactions-concurrency/02-mvcc-vacuum.md
---

# Index types

> Bảng `products` có index trên `name`. Query `WHERE name ILIKE '%áo thun%'` mất 6 giây và `EXPLAIN` cho thấy Seq Scan. Bạn thêm index nữa, vẫn Seq Scan. Vấn đề không phải thiếu index — B-tree **về mặt cấu trúc** không trả lời được câu hỏi "chứa chuỗi này ở giữa". Cần một loại index khác.

## Position

```text
Query pattern  →  chọn LOẠI index  →  planner dùng được hay không
                     ↑ note này
```

[Index & query plan](01-index-query-plan.md) nói về B-tree và vì sao planner dùng hay không dùng index. Note này về **các loại index khác** và biến thể của B-tree, cho những câu hỏi mà B-tree thẳng không trả lời được.

## Problem

B-tree sắp xếp giá trị theo thứ tự. Điều đó trả lời tốt: "bằng", "lớn hơn", "trong khoảng", "bắt đầu bằng". Nhưng nhiều câu hỏi thật không có dạng đó:

```text
"chứa từ khoá này"                → toàn văn
"chứa chuỗi con này"              → ILIKE '%x%'
"JSON có key này"                 → jsonb @>
"mảng chứa phần tử này"           → tags @> ARRAY['x']
"khoảng thời gian này chồng lấn"  → tstzrange &&
"gần điểm này nhất"               → địa lý
"chỉ 2% dòng thoả, phần còn lại vô nghĩa" → cần index nhỏ hơn
```

Dùng sai loại index cho ra Seq Scan im lặng: index tồn tại, chiếm chỗ, làm chậm ghi, và không bao giờ được dùng.

## Mental Model

### Chọn loại index theo hình dạng câu hỏi

```text
Câu hỏi                                  Loại
=  <  >  BETWEEN  IN  ORDER BY           B-tree      (mặc định, 95% trường hợp)
"chứa" — mảng, jsonb, toàn văn, trigram  GIN
phạm vi chồng lấn, hình học, KNN         GiST
dữ liệu tương quan với thứ tự vật lý     BRIN
chỉ kiểm tra bằng, không cần thứ tự      Hash        (hiếm khi đáng dùng)
```

Và ba **biến thể** của B-tree, quan trọng hơn các loại lạ:

```text
PARTIAL       CREATE INDEX ... WHERE <điều kiện>     — index nhỏ hơn nhiều
EXPRESSION    CREATE INDEX ... (lower(email))        — cứu điều kiện không sargable
COVERING      CREATE INDEX ... INCLUDE (a, b)        — Index Only Scan
```

Trong thực tế, **partial index là công cụ bị đánh giá thấp nhất** và cho lợi ích lớn nhất.

## How It Works

### Partial index

```sql
-- 10 triệu đơn hàng, chỉ 5.000 đang 'pending'
CREATE INDEX idx_orders_pending ON orders (created_at)
  WHERE status = 'pending';
```

```text
Index đầy đủ trên (status, created_at):  ~400 MB
Partial index:                            ~0,2 MB
→ nằm trọn trong cache, cập nhật rẻ hơn nhiều
```

Điều kiện để planner dùng được: `WHERE` của query phải **hàm ý** `WHERE` của index.

```sql
✓ WHERE status = 'pending' AND created_at > now() - interval '1 day'
✓ WHERE status = 'pending'
✗ WHERE status IN ('pending', 'processing')     -- không hàm ý
✗ WHERE created_at > ...                        -- không nhắc status
```

Ba ứng dụng đáng nhớ:

```sql
-- 1. Hàng đợi: chỉ index phần chưa xử lý
CREATE INDEX ON jobs (created_at) WHERE processed_at IS NULL;

-- 2. Soft delete: bỏ hẳn dòng đã xoá khỏi index
CREATE INDEX ON users (email) WHERE deleted_at IS NULL;

-- 3. Unique CÓ ĐIỀU KIỆN — B-tree thường không làm được
CREATE UNIQUE INDEX ON addresses (user_id) WHERE is_default;
--    "mỗi user chỉ có MỘT địa chỉ mặc định"
CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL;
--    "email unique trong số user còn sống" — cho phép đăng ký lại email đã xoá
```

Ứng dụng thứ ba giải quyết một bài toán mà nhiều người xử lý bằng code ở tầng ứng dụng — và xử lý sai dưới concurrency.

### Expression index

```sql
CREATE INDEX ON users (lower(email));
-- giờ WHERE lower(email) = 'a@b.c'  dùng được index

CREATE INDEX ON events ((payload->>'user_id'));
-- WHERE payload->>'user_id' = '42'

CREATE INDEX ON orders (date_trunc('day', created_at));
-- WHERE date_trunc('day', created_at) = '2026-01-15'
```

Ràng buộc: **query phải viết biểu thức giống hệt index.** `lower(email)` và `LOWER(email)` thì được (SQL không phân biệt hoa thường ở tên hàm), nhưng `lower(trim(email))` thì không khớp với index trên `lower(email)`.

Và một lựa chọn thường tốt hơn: **chuẩn hoá dữ liệu lúc ghi**. Lưu `email` đã lowercase, rồi index bình thường. Nó tránh được cả lớp vấn đề "quên viết đúng biểu thức" — đổi lại phải xử lý ở mọi đường ghi.

Với so sánh không phân biệt hoa thường, PostgreSQL còn có kiểu `citext` (extension) — nó xử lý ở tầng kiểu dữ liệu, không cần expression index.

### GIN: cho "chứa"

```sql
-- jsonb
CREATE INDEX ON events USING gin (payload);
SELECT * FROM events WHERE payload @> '{"type": "click"}';

-- jsonb chỉ với toán tử containment → index nhỏ hơn, nhanh hơn
CREATE INDEX ON events USING gin (payload jsonb_path_ops);

-- mảng
CREATE INDEX ON posts USING gin (tags);
SELECT * FROM posts WHERE tags @> ARRAY['postgres'];

-- toàn văn
CREATE INDEX ON articles USING gin (to_tsvector('simple', title || ' ' || body));
SELECT * FROM articles
WHERE to_tsvector('simple', title || ' ' || body) @@ plainto_tsquery('simple', 'index postgres');
```

Đặc điểm của GIN:

```text
+ tìm "chứa" cực nhanh
- GHI CHẬM: một dòng có 20 tag = 20 entry index
- index thường LỚN hơn B-tree
- có "pending list" để gom ghi (fastupdate) → đôi khi query chậm bất thường
  cho tới khi list được gộp; tắt bằng WITH (fastupdate = off) nếu cần độ trễ ổn định
```

Về tiếng Việt: PostgreSQL không có text search configuration cho tiếng Việt sẵn. Dùng `'simple'` (chỉ tách token và lowercase, không stemming) hoặc `unaccent` để bỏ dấu. Với nhu cầu tìm kiếm nghiêm túc, cân nhắc một search engine riêng.

### Trigram: cho `LIKE '%x%'`

```sql
CREATE EXTENSION pg_trgm;
CREATE INDEX ON products USING gin (name gin_trgm_ops);

SELECT * FROM products WHERE name ILIKE '%áo thun%';          -- ✓ dùng index
SELECT * FROM products WHERE name % 'ao thun';                -- ✓ tìm gần đúng
SELECT name, similarity(name, 'ao thun') AS s FROM products
ORDER BY name <-> 'ao thun' LIMIT 10;                          -- ✓ xếp theo độ giống
```

Đây là câu trả lời cho vấn đề ở đầu note. Trigram chia chuỗi thành các cụm 3 ký tự và index chúng, nên "chứa ở giữa" trở thành "chứa các trigram này".

Giới hạn: chuỗi tìm kiếm ngắn hơn 3 ký tự không tạo được trigram đầy đủ → index kém hiệu quả.

### BRIN: index tí hon cho dữ liệu theo thời gian

```sql
CREATE INDEX ON events USING brin (created_at);
```

```text
B-tree trên 1 tỉ dòng:   ~20 GB
BRIN trên cùng dữ liệu:  ~200 KB     (100.000 lần nhỏ hơn)
```

BRIN lưu min/max cho mỗi khối 128 page. Nó chỉ hữu ích khi **thứ tự vật lý tương quan với giá trị** — đúng với bảng append-only theo thời gian, sai hoàn toàn với dữ liệu ghi ngẫu nhiên hoặc cập nhật nhiều.

```sql
-- kiểm tra tương quan TRƯỚC khi chọn BRIN
SELECT attname, correlation FROM pg_stats
WHERE tablename = 'events' AND attname = 'created_at';
-- gần 1 hoặc -1  → BRIN tốt
-- gần 0          → BRIN vô dụng, dùng B-tree
```

Đánh đổi: BRIN cho phạm vi quét rộng hơn B-tree (nó chỉ loại được khối, không định vị dòng), nên nó chậm hơn B-tree nhưng nhỏ hơn hàng nghìn lần. Với bảng log 1 tỉ dòng, đó thường là đánh đổi đúng.

### Hash và các loại còn lại

```sql
CREATE INDEX ON sessions USING hash (token);
```

Hash index chỉ hỗ trợ `=`. Nó nhỏ hơn B-tree một chút cho chuỗi dài. Nhưng B-tree cũng làm `=` rất tốt **và** làm được thứ tự, nên hash hiếm khi đáng dùng. (Trước PostgreSQL 10 nó còn không được ghi WAL — không crash-safe.)

GiST: dùng cho phạm vi (`tstzrange &&`), hình học, và KNN. Ứng dụng thực tế phổ biến nhất:

```sql
-- "không cho hai lịch đặt phòng chồng lấn" — một constraint, không cần code
CREATE EXTENSION btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, during WITH &&);
```

Đây là ví dụ đẹp của việc để database ép bất biến: không có cách nào tạo hai booking chồng lấn, kể cả khi hai request đến cùng lúc.

## Example

Bốn query, bốn loại index:

```sql
-- 1. Lọc + sắp xếp thông thường → B-tree composite
SELECT * FROM orders WHERE user_id = 42 AND status = 'paid'
ORDER BY created_at DESC LIMIT 20;
CREATE INDEX ON orders (user_id, status, created_at DESC);

-- 2. Hàng đợi — chỉ 0,05% dòng → partial
SELECT * FROM jobs WHERE processed_at IS NULL ORDER BY created_at LIMIT 10;
CREATE INDEX ON jobs (created_at) WHERE processed_at IS NULL;

-- 3. Tìm chuỗi con → trigram
SELECT * FROM products WHERE name ILIKE '%thun%';
CREATE INDEX ON products USING gin (name gin_trgm_ops);

-- 4. Bảng log 1 tỉ dòng, append-only, lọc theo thời gian → BRIN
SELECT count(*) FROM events WHERE created_at BETWEEN '2026-01-01' AND '2026-01-02';
CREATE INDEX ON events USING brin (created_at);
```

Với mỗi cái, quy trình xác nhận giống nhau:

```sql
EXPLAIN (ANALYZE, BUFFERS) <query>;    -- trước
CREATE INDEX ...;
ANALYZE <table>;
EXPLAIN (ANALYZE, BUFFERS) <query>;    -- sau — index có được dùng không? nhanh hơn bao nhiêu?
```

Bước cuối không phải nghi thức: index sai loại vẫn được tạo thành công và vẫn cho Seq Scan.

## Prediction

1. B-tree trên `name`, query `WHERE name LIKE 'áo%'` — dùng index không?
2. Cùng index, `WHERE name LIKE '%áo%'` — dùng không? Vì sao?
3. Thêm GIN trigram, lặp lại câu 2 — dùng không?
4. Partial index `WHERE status = 'pending'`, query `WHERE status IN ('pending','processing')` — dùng không?
5. Bảng 10 triệu dòng, 5.000 dòng `pending` — partial index nhỏ hơn full index bao nhiêu lần (ước lượng)?
6. Expression index trên `lower(email)`, query `WHERE email = 'A@B.C'` — dùng không?
7. Query `WHERE lower(trim(email)) = 'a@b.c'` với index trên `lower(email)` — dùng không?
8. GIN trên `tags`, insert một dòng có 30 tag — bao nhiêu entry index?
9. BRIN trên `created_at` của bảng có `correlation = 0.02` — hiệu quả thế nào?
10. Hash index trên `token`, query `WHERE token > 'abc'` — dùng không?
11. Unique index thường trên `email`, hai dòng có `email = NULL` — insert thành công không?
12. `CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL`, xoá mềm user rồi đăng ký lại cùng email — được không?

<details>
<summary>Đáp án</summary>

1. **Có** — neo đầu, là một tiền tố.
2. **Không** — B-tree sắp theo tiền tố; không biết ký tự đầu thì không biết đi nhánh nào.
3. **Có** — trigram index câu này được (với `ILIKE` cần chuỗi ≥ 3 ký tự để hiệu quả).
4. **Không** — `IN ('pending','processing')` không hàm ý `status = 'pending'`.
5. Khoảng **2.000 lần** (tỉ lệ 5.000/10.000.000), cộng thêm chênh lệch về chiều cao cây.
6. **Không** — query dùng `email` trần, index dùng `lower(email)`. Phải viết `WHERE lower(email) = lower('A@B.C')`.
7. **Không** — biểu thức phải khớp chính xác.
8. **30 entry** — đây là lý do GIN ghi chậm.
9. Gần như **vô dụng** — dữ liệu không tương quan với thứ tự vật lý, mỗi khối đều chứa mọi khoảng giá trị.
10. **Không** — hash chỉ hỗ trợ `=`.
11. **Thành công** — nhiều NULL không vi phạm unique trong PostgreSQL.
12. **Được** — partial unique index chỉ ràng buộc trên dòng chưa xoá. Đây chính là lý do dùng nó.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `LIKE '%x%'` với B-tree, xem `EXPLAIN` | Seq Scan |
| Thêm GIN trigram, xem lại | Bitmap Index Scan |
| So kích thước hai index (`pg_relation_size`) | Trigram lớn hơn nhiều |
| Đo thời gian `INSERT` 100k dòng trước/sau khi thêm GIN | Ghi chậm hơn rõ rệt |
| Tạo partial index rồi query bằng điều kiện rộng hơn | Không dùng được |
| So kích thước partial vs full index | Chênh lệch hàng nghìn lần |
| Expression index rồi viết biểu thức hơi khác | Không dùng |
| BRIN trên cột có `correlation` thấp | Hầu như không lọc được gì |
| Kiểm tra `correlation` trong `pg_stats` trước và sau khi `CLUSTER` bảng | BRIN hiệu quả hơn hẳn |
| Unique index thường + hai NULL | Thành công — chứng minh NULL không "bằng nhau" |
| Partial unique + soft delete + đăng ký lại | Thành công |
| Tạo 10 index rồi đo `INSERT` hàng loạt | So với 2 index |
| `EXCLUDE USING gist` cho booking, thử tạo hai booking chồng lấn đồng thời | DB từ chối cả khi song song |

## What Usually Goes Wrong

- **Dùng B-tree cho `LIKE '%x%'`** → Seq Scan, thêm index không giúp.
- **Không biết partial index tồn tại** → index gấp nghìn lần kích thước cần thiết.
- **Partial index với điều kiện không khớp query** → không bao giờ được dùng.
- **Expression index viết khác query** → không được dùng, im lặng.
- **GIN trên bảng ghi nhiều** → ghi chậm đáng kể, và ít ai đo trước.
- **BRIN trên dữ liệu không tương quan** → vô dụng nhưng vẫn tốn ghi.
- **Hash index vì "hash nhanh hơn"** → B-tree làm tốt hơn và linh hoạt hơn.
- **Index cho mọi cột "cho chắc"** → ghi chậm, bloat, phá HOT update.
- **Không đo lại sau khi tạo index** → không biết nó có được dùng không.
- **Quên `ANALYZE`** sau khi tạo index trên bảng lớn.
- **Không dùng partial unique cho soft delete** → không đăng ký lại được email đã xoá, hoặc phải xử lý bằng code (và sai dưới concurrency).
- **Dùng `LIKE`/`ILIKE` cho tìm kiếm nghiêm túc** thay vì full-text hoặc search engine.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Một loại index đủ cho mọi thứ | Loại index phải khớp hình dạng câu hỏi |
| Thêm index thì `LIKE '%x%'` nhanh hơn | Cần trigram, không phải B-tree |
| GIN chỉ dùng cho toàn văn | Còn cho jsonb, mảng, trigram |
| GIN miễn phí | Ghi chậm rõ rệt, index lớn |
| BRIN luôn tốt cho cột thời gian | Chỉ khi có tương quan vật lý cao |
| Hash nhanh hơn B-tree cho `=` | Chênh lệch không đáng kể; B-tree linh hoạt hơn nhiều |
| Partial index chỉ để tiết kiệm chỗ | Nó còn cho phép **unique có điều kiện** |
| Expression index tự khớp mọi biến thể | Phải viết biểu thức giống hệt |
| Unique index chặn nhiều NULL | PostgreSQL cho phép nhiều NULL |
| Index càng nhiều càng an toàn | Mỗi index là chi phí trên mọi ghi và phá HOT |

## Debugging

1. **`EXPLAIN (ANALYZE, BUFFERS)`** — index có được dùng không? Đây luôn là bước đầu.
2. **Index tồn tại nhưng Seq Scan** → theo thứ tự: đúng loại index chưa? điều kiện có sargable không? partial có khớp không? biểu thức có khớp không? tỉ lệ dòng trả về?
3. **Liệt kê index của một bảng**: `\d+ tablename` trong psql, hoặc `pg_indexes`.
4. **Index nào chưa từng được dùng**:
   ```sql
   SELECT relname, indexrelname, idx_scan,
          pg_size_pretty(pg_relation_size(indexrelid)) AS size
   FROM pg_stat_user_indexes WHERE idx_scan = 0
   ORDER BY pg_relation_size(indexrelid) DESC;
   ```
5. **Kiểm tra tương quan trước khi chọn BRIN**: `pg_stats.correlation`.
6. **Index bloat** → `REINDEX CONCURRENTLY` (PostgreSQL 12+).
7. **GIN chậm bất thường lúc query** → pending list chưa gộp; `VACUUM` bảng đó hoặc tắt `fastupdate`.

## Production Considerations

- **Bắt đầu bằng B-tree.** Chỉ đổi loại khi `EXPLAIN` chứng minh nó không dùng được.
- **Partial index nên là phản xạ** khi query luôn có một điều kiện cố định (`status = 'pending'`, `deleted_at IS NULL`).
- **Partial unique index cho soft delete và cho "chỉ một cái mặc định"** — đây là hai bài toán mà nhiều codebase xử lý sai ở tầng ứng dụng.
- **`CREATE INDEX CONCURRENTLY`** luôn ở production; kiểm tra `indisvalid` sau đó.
- **Đo chi phí ghi trước khi thêm GIN** trên bảng nóng.
- **Xoá index không dùng** sau khi đã chạy đủ một chu kỳ nghiệp vụ đầy đủ (nhớ cả báo cáo cuối tháng và cuối quý).
- **Với bảng rất lớn theo thời gian, cân nhắc partition trước khi cân nhắc BRIN** — partition pruning mạnh hơn và còn cho phép `DROP` partition cũ.
- **Tìm kiếm nghiêm túc thì dùng công cụ tìm kiếm.** PostgreSQL full-text tốt cho quy mô vừa; nó không thay được một search engine khi bạn cần ranking, facet, gợi ý, và nhiều ngôn ngữ.
- **Ghi lại lý do tồn tại của mỗi index không hiển nhiên** (partial, expression, GIN) trong migration — nếu không, sáu tháng sau sẽ có người xoá nó.

## Trade-offs

| Loại | Được | Mất |
|---|---|---|
| B-tree | linh hoạt nhất, cân bằng nhất | không làm được "chứa" |
| Partial | rất nhỏ, unique có điều kiện | chỉ dùng cho query khớp điều kiện |
| Expression | cứu điều kiện không sargable | phải viết biểu thức giống hệt |
| Covering (`INCLUDE`) | Index Only Scan | index lớn hơn |
| GIN | tìm "chứa" rất nhanh | ghi chậm, index lớn |
| GIN `jsonb_path_ops` | nhỏ hơn, nhanh hơn | chỉ hỗ trợ `@>` |
| GiST | phạm vi, hình học, exclusion constraint | chậm hơn GIN cho tìm kiếm |
| BRIN | nhỏ đến mức không đáng kể | chỉ đúng khi tương quan cao; quét rộng hơn |
| Hash | nhỏ hơn chút cho chuỗi dài | chỉ `=`; hiếm khi đáng |
| Không index | ghi nhanh nhất | đọc quét toàn bảng |

## Explain Without Notes

1. Vì sao B-tree không làm được `LIKE '%x%'`? Cái gì làm được?
2. Partial index tiết kiệm bao nhiêu, và điều kiện để planner dùng nó?
3. Nêu hai bài toán mà **chỉ** partial unique index giải được sạch sẽ.
4. Expression index và chuẩn hoá dữ liệu lúc ghi — mỗi cách được gì mất gì?
5. GIN nhanh ở đâu và chậm ở đâu? Nêu con số cụ thể cho một dòng có 30 tag.
6. Điều kiện để BRIN hữu ích? Kiểm tra nó bằng câu lệnh nào?
7. Vì sao hash index hiếm khi đáng dùng?

## Related

- [Index & query plan](01-index-query-plan.md) — B-tree, sargable, vì sao planner từ chối index
- [EXPLAIN ANALYZE workflow](03-explain-analyze-workflow.md) — xác nhận index được dùng
- [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md) — index thừa phá HOT update; index bloat
- [Constraints & invariants](../../03-data-modeling/01-constraints-invariants.md) — unique có điều kiện, exclusion constraint
- [Relational thinking](../../00-sql/01-relational-thinking.md) — NULL và unique
- [Database performance](../../../05-cross-cutting/performance/04-database-performance.md)

## Version / Context

PostgreSQL 16. `pg_trgm`, `btree_gist`, `citext` là extension (`CREATE EXTENSION`). `jsonb_path_ops` từ 9.4. `INCLUDE` từ 11. `REINDEX CONCURRENTLY` từ 12. BRIN cải tiến đáng kể ở PostgreSQL 14 (`multi-minmax`).
