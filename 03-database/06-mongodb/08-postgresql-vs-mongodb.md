---
level: intermediate
area: database
prerequisites:
  - 01-document-model.md
  - 02-embed-vs-reference.md
related:
  - ../../06-system-design/06-storage-selection.md
  - ../01-postgresql/fundamentals/01-architecture-and-acid.md
---

# PostgreSQL vs MongoDB

> Không có bên thắng. Có hai câu hỏi quyết định: **access pattern của bạn có ổn định không**, và **dữ liệu của bạn có quan hệ không**. Và một điều bất ngờ: "cần schema linh hoạt" thường **không** phải lý do chọn MongoDB.

*Baseline: PostgreSQL 16+, MongoDB 7.x/8.x. Note này là so sánh cụ thể — lựa chọn storage rộng hơn (key-value, wide-column, search, OLAP) ở [Storage selection](../../06-system-design/06-storage-selection.md).*

## Position

```text
Yêu cầu nghiệp vụ + access pattern
        ↓
[ PostgreSQL | PostgreSQL + JSONB | MongoDB ]     ← note này
        ↓
schema design → index → operations
```

## Problem

Cuộc tranh luận thường diễn ra sai:

```text
"MongoDB nhanh hơn"          → nhanh hơn cho pattern nào?
"PostgreSQL đáng tin hơn"     → cả hai đều ACID ở phạm vi tương ứng
"MongoDB cho schema linh hoạt" → PostgreSQL có JSONB
"MongoDB scale tốt hơn"        → PostgreSQL có partitioning và replica
```

Bốn phát biểu trên đều quá chung để dùng được. Quyết định thật nằm ở việc đối chiếu **mười tiêu chí cụ thể** với domain của bạn.

Và có một lựa chọn thứ ba thường bị bỏ qua, mà lại là lựa chọn đúng trong nhiều trường hợp: **PostgreSQL + JSONB**.

## Mental Model

Hai câu hỏi quyết định, theo thứ tự:

```text
1. Dữ liệu của bạn có QUAN HỆ không?
   Nhiều thực thể tham chiếu nhau, cần toàn vẹn, cần JOIN từ nhiều hướng?
   → PostgreSQL

2. ACCESS PATTERN có ổn định không?
   Bạn biết chắc dữ liệu nào đọc/ghi cùng nhau, và điều đó ít đổi?
   → MongoDB khả thi
   Chưa biết, hoặc sẽ đổi nhiều?
   → PostgreSQL (chuẩn hoá cho phép query từ hướng chưa nghĩ tới)
```

Câu 2 là chỗ hiểu nhầm lớn nhất:

> **MongoDB thưởng cho việc bạn BIẾT RÕ access pattern.**
> **Nó phạt khi access pattern thay đổi.**
>
> Vì vậy "chưa biết sẽ query thế nào" là lý do chọn **PostgreSQL**, không phải MongoDB.

Lý do: trong MongoDB bạn thiết kế document theo access pattern. Nếu pattern đổi, bạn phải đổi mô hình dữ liệu — và không có `ALTER TABLE`, không có JOIN linh hoạt để bù. Trong PostgreSQL, schema chuẩn hoá cho phép query từ mọi hướng với giá là JOIN.

## So sánh theo mười tiêu chí

| Tiêu chí | PostgreSQL | MongoDB |
|---|---|---|
| **Quan hệ** | JOIN native, tối ưu tốt, query từ mọi hướng | `$lookup` đắt; thiết kế để tránh JOIN |
| **Transaction** | mặc định, rẻ, xuyên nhiều bảng | có nhưng là escape hatch; cần replica set |
| **Constraint** | FK, CHECK, UNIQUE, EXCLUDE, NOT NULL | chỉ unique index + `$jsonSchema`; **không có FK** |
| **Schema evolution** | `ALTER TABLE`; cần expand/contract cho thay đổi phá vỡ | thêm field miễn phí; đổi tên/kiểu cần backfill thủ công |
| **Access pattern** | linh hoạt, chịu được thay đổi | phải biết trước; đổi pattern = đổi mô hình |
| **Ghi/đọc một đơn vị lớn** | JOIN nhiều bảng, hoặc JSONB | một document, một lần đọc — **điểm mạnh nhất** |
| **Aggregation/report** | SQL, window function, CTE — rất mạnh | pipeline mạnh nhưng khó hơn với query phức tạp |
| **Index** | B-tree, GIN, GiST, BRIN, partial, expression | B-tree, compound (ESR), multikey, partial, TTL |
| **Scale ghi ngang** | partitioning; sharding cần thêm công cụ | sharding built-in |
| **Vận hành** | rất trưởng thành, nhiều người biết | trưởng thành; shard key khó đổi |

Hai hàng đáng chú ý:

- **Constraint**: không có foreign key nghĩa là reference mồ côi là trạng thái **bình thường** trong MongoDB, phải xử lý ở tầng đọc. Với domain cần toàn vẹn (kế toán, quyền hạn, kho), đây là chi phí lớn.
- **Ghi/đọc một đơn vị lớn**: đây là nơi MongoDB thật sự thắng, và nó không nhỏ. Một document 50KB đọc bằng một lần I/O, trong khi cùng dữ liệu chuẩn hoá là JOIN 5 bảng.

## PostgreSQL + JSONB — lựa chọn thứ ba

Đây là phần quan trọng nhất của note, vì nó phá vỡ nhị phân sai.

```sql
CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,           -- có cấu trúc: constraint thật
  name        text NOT NULL,
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  category_id uuid NOT NULL REFERENCES categories(id),   -- FOREIGN KEY thật
  attributes  jsonb NOT NULL DEFAULT '{}',     -- linh hoạt: khác nhau theo loại sản phẩm
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index cho JSONB — GIN cho toán tử containment
CREATE INDEX idx_products_attrs ON products USING gin (attributes);

-- Index cho MỘT key cụ thể trong JSONB — B-tree, hiệu quả hơn nếu query cố định
CREATE INDEX idx_products_brand ON products ((attributes->>'brand'));

-- Query
SELECT * FROM products WHERE attributes @> '{"brand": "Logitech"}';
SELECT * FROM products WHERE attributes->>'color' = 'black';
SELECT * FROM products WHERE attributes ? 'warranty';          -- key tồn tại
```

Bạn có **cả hai**: constraint và foreign key cho phần có cấu trúc, linh hoạt schema cho phần thay đổi.

Vì vậy:

> **"Cần schema linh hoạt" một mình KHÔNG phải lý do chọn MongoDB.**

Lý do hợp lệ để chọn MongoDB là mạnh hơn thế: **toàn bộ đơn vị dữ liệu được đọc/ghi cùng nhau, hình dạng thay đổi đáng kể giữa các bản ghi, và không cần quan hệ.**

Giới hạn của JSONB (để công bằng):

| | JSONB | MongoDB document |
|---|---|---|
| Query trong nested | được, cú pháp nặng hơn | tự nhiên (dot notation) |
| Update một field nested | `jsonb_set` — nặng, ghi lại cả JSONB | `$set` trực tiếp |
| Index nested sâu | GIN, hoặc expression index từng key | tự nhiên |
| Kích thước | TOAST cho giá trị lớn; ghi lại toàn bộ khi update | 16MB, update tại chỗ |
| Kiểu dữ liệu | JSON types (không có Date, Decimal128) | BSON types đầy đủ |

Điểm quan trọng nhất: **update một field nhỏ trong JSONB lớn ghi lại toàn bộ giá trị JSONB.** Nếu bạn update nested field rất thường xuyên trên document lớn, MongoDB hiệu quả hơn rõ rệt.

## Ví dụ quyết định cụ thể

### PostgreSQL — khi có quan hệ và cần toàn vẹn

```text
Payments, orders, ledger
  → transaction xuyên nhiều bảng là chuyện thường ngày
  → cần constraint (số dư không âm, không double-charge)
  → cần audit chính xác
  → report và đối chiếu bằng SQL

Permissions / RBAC
  → user ↔ role ↔ permission là quan hệ m-n thuần
  → cần JOIN từ mọi hướng ("ai có quyền X?", "user Y có quyền gì?")
  → dữ liệu nhỏ, quan hệ dày

Inventory
  → invariant "không bán quá tồn kho" cần transaction + constraint
  → nhiều thực thể tham chiếu nhau

Bất kỳ domain có báo cáo phức tạp
  → window function, CTE, GROUP BY nhiều tầng
```

### MongoDB — khi đơn vị dữ liệu độc lập

```text
CMS / content documents
  → mỗi bài viết là một đơn vị hoàn chỉnh, đọc/ghi cả document
  → hình dạng khác nhau nhiều giữa các loại content (article, video, gallery)
  → không cần JOIN

Event / activity log, telemetry
  → append-only, khối lượng lớn
  → mỗi event độc lập, đọc theo khoảng thời gian
  → TTL index tự dọn

Product catalog với thuộc tính rất khác nhau
  → laptop có RAM/CPU; áo có size/màu; sách có tác giả/ISBN
  → (nhưng cân nhắc JSONB trước)

Real-time analytics đơn giản, cấu hình per-tenant
  → document tự chứa, không quan hệ
```

### Kết hợp — thường là kiến trúc thực tế

```text
PostgreSQL   → user, order, payment, permission (quan hệ, transaction, constraint)
MongoDB      → content, activity log, per-tenant config (document độc lập)
Redis        → cache, session, rate limit
Elasticsearch → full-text search
```

Đây không phải thoả hiệp — nó là dùng đúng công cụ cho từng loại dữ liệu. Chi phí: nhiều hệ thống phải vận hành, và **không có transaction xuyên database** — cần [outbox pattern](../04-message-queues/06-outbox-pattern.md) để giữ nhất quán.

## Prediction

1. Domain cần transaction xuyên 4 thực thể mỗi request — database nào?
2. "Chúng tôi chưa biết sẽ query thế nào" — database nào?
3. Cần schema linh hoạt cho một cột, nhưng có foreign key và transaction — giải pháp?
4. Đọc "order kèm 20 dòng hàng" 10.000 lần/giây — bên nào ít I/O hơn?
5. Query "sản phẩm nào bán chạy nhất theo tháng, so với tháng trước" — bên nào dễ hơn?
6. Update một field nested trong document/JSONB 500KB, 1000 lần/giây — bên nào hiệu quả hơn?
7. Cần "user nào có quyền X" và "quyền nào user Y có" — bên nào?
8. Ghi 500.000 event/giây, mỗi event độc lập, giữ 30 ngày — bên nào?

<details>
<summary>Đáp án</summary>

1. PostgreSQL — transaction là mặc định và rẻ.
2. **PostgreSQL** — chuẩn hoá cho phép query từ hướng chưa nghĩ tới.
3. **PostgreSQL + JSONB** — có cả hai.
4. MongoDB — một document, một lần đọc (nếu embed).
5. PostgreSQL — window function (`LAG`) làm việc này tự nhiên.
6. MongoDB — JSONB ghi lại **toàn bộ** giá trị khi update.
7. PostgreSQL — quan hệ m-n cần JOIN hai hướng.
8. MongoDB (hoặc một time-series store chuyên dụng) — append-only, độc lập, TTL.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Mô hình quan hệ m-n dày trong MongoDB, query hai hướng | Nhiều `$lookup`, chậm và phức tạp |
| Cùng mô hình đó trong PostgreSQL | JOIN đơn giản |
| Chuẩn hoá order + lines trong PostgreSQL, đọc 10k lần | Đo I/O so với MongoDB embed |
| Cùng dữ liệu trong JSONB, update một field nested | Đo write amplification (ghi lại toàn bộ JSONB) |
| Cùng update đó trong MongoDB (`$set`) | Nhỏ hơn nhiều |
| Xoá một user trong MongoDB, query post kèm author | Reference mồ côi, `$lookup` trả rỗng |
| Cùng thao tác với FK `ON DELETE` trong PostgreSQL | DB tự bảo vệ hoặc cascade |
| Window function trong pipeline vs SQL | So độ phức tạp |
| Đổi access pattern sau khi đã embed theo pattern cũ | Phải migrate mô hình, không có `ALTER TABLE` |

Thí nghiệm 4 và 5 là thí nghiệm quyết định cho câu hỏi "JSONB có thay được MongoDB không".

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| MongoDB nhanh hơn PostgreSQL | Nhanh hơn cho *access pattern nó được thiết kế cho* |
| MongoDB không ACID | ACID ở mức document; có transaction đa document từ 4.0 |
| PostgreSQL không xử lý được JSON | JSONB rất mạnh, có GIN index |
| "Cần schema linh hoạt" → MongoDB | JSONB thường đủ, và giữ được FK + transaction |
| MongoDB scale tốt hơn nên chọn trước | Phần lớn app chưa bao giờ chạm giới hạn một PostgreSQL |
| Chọn MongoDB khi chưa biết schema | Ngược lại — chưa biết access pattern là lý do chọn PostgreSQL |
| PostgreSQL không sharding được | Có partitioning; sharding qua Citus/công cụ khác |
| Phải chọn một database cho cả hệ thống | Kết hợp là kiến trúc thực tế |

## Debugging — chọn sai thì nhận ra thế nào

Dấu hiệu **MongoDB không phù hợp** với domain của bạn:

```text
✗ Cần transaction xuyên document như chuyện thường ngày
✗ Phần lớn query cần $lookup
✗ Phải tự viết logic bảo vệ toàn vẹn mà FK làm miễn phí
✗ Báo cáo cần window function, và pipeline ngày càng khó đọc
✗ Access pattern đổi mỗi quý, mỗi lần phải migrate mô hình
✗ Reference mồ côi xuất hiện thường xuyên trong dữ liệu
```

Dấu hiệu **PostgreSQL đang bị dùng sai**:

```text
✗ 30 cột nullable vì mỗi loại bản ghi dùng một tập khác nhau
   → cân nhắc JSONB cho phần biến thiên
✗ Mọi lần đọc là JOIN 6 bảng cho dữ liệu luôn dùng cùng nhau
   → cân nhắc JSONB hoặc denormalize
✗ EAV pattern (entity-attribute-value) với hàng triệu dòng
   → JSONB gần như luôn tốt hơn EAV
```

Đây là danh sách nên đọc lại sau 6 tháng dùng — nó biến "cảm giác sai" thành tín hiệu cụ thể.

## Production Considerations

- **Mặc định là PostgreSQL** cho phần lớn ứng dụng nghiệp vụ. Nó chịu được thay đổi yêu cầu tốt hơn, và đó là điều bạn cần nhiều nhất khi chưa biết sản phẩm sẽ đi đâu.
- **Thử JSONB trước MongoDB** khi lý do duy nhất là schema linh hoạt.
- **Chọn MongoDB có chủ đích**, với access pattern đã viết ra — không phải vì nó "hiện đại" hoặc "dễ bắt đầu".
- **Nếu dùng cả hai**: xác định rõ database nào là nguồn sự thật cho dữ liệu nào; không có transaction xuyên database, cần outbox/event để đồng bộ.
- **Đừng chọn theo benchmark trên internet** — benchmark đo pattern của người viết, không phải của bạn. Prototype với dữ liệu và query thật của bạn.
- **Chi phí đổi database sau này rất cao** (nhiều tháng), nên quyết định này đáng bỏ ra vài ngày prototype.
- Team skill là tiêu chí thật: một PostgreSQL được vận hành tốt thắng một MongoDB không ai hiểu, và ngược lại.

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| PostgreSQL | quan hệ, transaction, constraint, SQL mạnh, linh hoạt query | JOIN cho dữ liệu luôn đọc cùng nhau |
| PostgreSQL + JSONB | cả constraint và linh hoạt | update nested ghi lại toàn bộ JSONB; cú pháp nặng hơn |
| MongoDB | đọc/ghi một đơn vị nhanh, nguyên tử document, sharding built-in | không FK, transaction đắt, access pattern phải ổn định |
| Cả hai | đúng công cụ cho từng loại dữ liệu | hai hệ thống vận hành, không transaction xuyên DB |

## Explain Without Notes

1. Hai câu hỏi quyết định, theo thứ tự?
2. Vì sao "chưa biết access pattern" là lý do chọn PostgreSQL?
3. Vì sao "cần schema linh hoạt" một mình không đủ để chọn MongoDB?
4. Giới hạn thật của JSONB so với document — điểm nào quan trọng nhất?
5. Hậu quả thực tế của việc MongoDB không có foreign key?
6. Kể ba dấu hiệu MongoDB không phù hợp, và ba dấu hiệu PostgreSQL đang bị dùng sai.

## Related

- [Document model](01-document-model.md) — đảo chiều thiết kế
- [Embed vs reference](02-embed-vs-reference.md) — quyết định trung tâm của MongoDB
- [Transactions & consistency](06-transactions-consistency.md) — transaction là escape hatch
- [Operations & production](07-operations-production.md) — chi phí vận hành
- [Storage selection](../../06-system-design/06-storage-selection.md) — lựa chọn rộng hơn
- [PostgreSQL architecture & ACID](../01-postgresql/fundamentals/01-architecture-and-acid.md)
- [Normalization](../03-data-modeling/02-normalization.md) · [Relationships & cardinality](../03-data-modeling/03-relationships-cardinality.md)
- [Outbox pattern](../04-message-queues/06-outbox-pattern.md) — đồng bộ khi dùng nhiều database
- [Requirements & trade-offs](../../06-system-design/01-requirements-tradeoffs.md)
