# MongoDB

MongoDB như một **mô hình dữ liệu khác**, không như "SQL không có SQL". Nếu bạn học nó bằng cách dịch từ vựng (`table → collection`, `row → document`), bạn sẽ viết được query nhưng thiết kế sai — vì khác biệt thật không nằm ở từ vựng mà ở nguyên tắc thiết kế.

*Baseline: MongoDB 7.x/8.x, replica set.*

## Đảo chiều thiết kế

Đây là câu duy nhất cần nhớ nếu bạn chỉ đọc một dòng của folder này:

```text
PostgreSQL:  thiết kế schema (chuẩn hoá) → rồi viết query
MongoDB:     xác định query (access pattern) → rồi thiết kế schema
```

Hệ quả trực tiếp, và nó ngược với trực giác thông thường:

> **MongoDB thưởng cho việc bạn BIẾT RÕ access pattern, và phạt khi access pattern đổi.**
>
> Vì vậy *"chưa biết sẽ query thế nào"* là lý do chọn **PostgreSQL**, không phải MongoDB.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Document model](01-document-model.md) | Analogy "table = collection" bỏ mất điều gì? |
| 2 | [Embed vs reference](02-embed-vs-reference.md) | **Quyết định quan trọng nhất** — nhúng hay tham chiếu? |
| 3 | [Schema design & validation](03-schema-design-validation.md) | "Không có schema" nghĩa là gì thật sự? |
| 4 | [Indexes & query planning](04-indexes-query-planning.md) | Quy tắc ESR, và vì sao thiếu index có thể làm query *lỗi* |
| 5 | [Aggregation pipeline](05-aggregation-pipeline.md) | Vì sao thứ tự stage đổi hiệu năng hàng nghìn lần? |
| 6 | [Transactions & consistency](06-transactions-consistency.md) | Khi một document không đủ |
| 7 | [Operations & production](07-operations-production.md) | Working set, replica set, sharding |
| 8 | [PostgreSQL vs MongoDB](08-postgresql-vs-mongodb.md) | Chọn cái nào, và vì sao có lựa chọn thứ ba |

Note 2 là note quan trọng nhất — nó quyết định cả hiệu năng và nhu cầu transaction. Note 8 nên đọc **trước khi** quyết định dùng MongoDB cho một dự án.

## Bốn con số định hình mọi thiết kế

```text
16 MB    kích thước tối đa một document (kể cả document trung gian trong pipeline)
32 MB    giới hạn sort không dùng index → vượt là query THẤT BẠI
100 MB   giới hạn mỗi stage aggregation
RAM      working set phải vừa RAM — chỉ số quan trọng nhất của MongoDB
```

Giới hạn 16MB là lý do **array không có trần là anti-pattern số một** của MongoDB.

## Tám hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| MongoDB cho khi chưa biết schema | Nó cho khi **biết rõ access pattern** | [1](01-document-model.md), [8](08-postgresql-vs-mongodb.md) |
| MongoDB không có schema | Schema ở application; câu hỏi là **ai ép nó** | [3](03-schema-design-validation.md) |
| MongoDB nghĩa là nhúng mọi thứ | Unbounded array là anti-pattern số một | [2](02-embed-vs-reference.md) |
| `null` và "field không tồn tại" như nhau | Khác nhau, và gây query sai im lặng | [1](01-document-model.md) |
| Thứ tự field trong compound index không quan trọng | ESR quyết định index có phục vụ sort hay không | [4](04-indexes-query-planning.md) |
| Mọi stage pipeline dùng được index | Chỉ stage **đầu tiên** | [5](05-aggregation-pipeline.md) |
| MongoDB không có transaction | Có, nhưng là **escape hatch**, không phải mặc định | [6](06-transactions-consistency.md) |
| "Cần schema linh hoạt" → MongoDB | PostgreSQL JSONB thường đủ, và giữ được FK | [8](08-postgresql-vs-mongodb.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| `BSONObjectTooLarge` | array không có trần → [2](02-embed-vs-reference.md) |
| Ghi chậm dần theo thời gian | document phình → [2](02-embed-vs-reference.md) |
| Query bỏ sót dữ liệu im lặng | kiểu dữ liệu không nhất quán, hoặc `null` vs `$exists` → [1](01-document-model.md), [3](03-schema-design-validation.md) |
| `Sort exceeded memory limit` | thiếu index cho sort → [4](04-indexes-query-planning.md) |
| `explain` có `COLLSCAN` | không có index phù hợp → [4](04-indexes-query-planning.md) |
| `explain` có `SORT` stage | index sai **thứ tự ESR** → [4](04-indexes-query-planning.md) |
| Aggregation chậm gấp nghìn lần | `$lookup` hoặc `$unwind` đặt trước `$match` → [5](05-aggregation-pipeline.md) |
| Pipeline lỗi 16MB | `$push`/`$addToSet` trên nhóm lớn → [5](05-aggregation-pipeline.md) |
| Transaction không rollback | thiếu `{ session }` ở một thao tác → [6](06-transactions-consistency.md) |
| "Transaction numbers only allowed on replica set" | môi trường là standalone → [6](06-transactions-consistency.md) |
| Ghi mất sau failover | `w: 1` thay vì `w: "majority"` → [6](06-transactions-consistency.md) |
| Vừa ghi mà đọc không thấy | replication lag khi đọc secondary → [6](06-transactions-consistency.md) |
| Latency cao dù index đúng | working set không vừa RAM → [7](07-operations-production.md) |
| Một shard nhận hết tải | shard key tăng dần (`ObjectId`) → [7](07-operations-production.md) |
| `$lookup` trả array rỗng | reference mồ côi — không có FK → [3](03-schema-design-validation.md) |

## Ba thói quen

1. **Đọc document thật** (`db.coll.findOne()`) trước khi tin schema bạn nghĩ. Không có schema ép buộc nghĩa là dữ liệu thật thường khác dữ liệu tưởng tượng.
2. **`explain("executionStats")`** cho mọi query mới. Tìm hai thứ: `COLLSCAN` và `SORT`.
3. **Kiểm tra kích thước document và độ dài array định kỳ** — không chờ `BSONObjectTooLarge`:
   ```js
   db.coll.aggregate([{ $project: { s: { $bsonSize: "$$ROOT" } } },
                      { $sort: { s: -1 } }, { $limit: 5 }]);
   ```

## Position

```text
Application → driver (pool) → MongoDB replica set → WiredTiger cache → disk
                                   ↑ folder này
```

## Related

- [08-postgresql-vs-mongodb.md](08-postgresql-vs-mongodb.md) — so sánh trực tiếp, gồm cả lựa chọn PostgreSQL + JSONB
- [01-postgresql/](../01-postgresql/README.md) — mô hình đối chiếu
- [05-data-access/](../05-data-access/README.md) — ORM và data access (Prisma cũng hỗ trợ MongoDB)
- [03-data-modeling/](../03-data-modeling/README.md) — cardinality, normalization
- [Storage selection](../../06-system-design/06-storage-selection.md) — lựa chọn storage rộng hơn
- [Data partitioning & sharding](../../06-system-design/05-data-partitioning-sharding.md)
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — CAP, read/write concern
