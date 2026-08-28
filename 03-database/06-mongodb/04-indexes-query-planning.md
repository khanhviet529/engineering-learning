---
level: intermediate
area: database
prerequisites:
  - 01-document-model.md
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
related:
  - 05-aggregation-pipeline.md
  - 08-postgresql-vs-mongodb.md
---

# Indexes & query planning

> Nguyên lý index giống PostgreSQL: **index phải phục vụ access pattern**. Note này không lặp lại lý thuyết B-tree — nó tập trung vào ba thứ đặc thù MongoDB: quy tắc ESR, multikey index cho array, và cách đọc `explain()`.

*Baseline: MongoDB 7.x/8.x. Lý thuyết index chung: [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md), [Index types](../01-postgresql/indexes-query-planning/02-index-types.md).*

## Position

```text
Query / aggregation
      ↓
Query planner → chọn plan → cache plan
      ↓
IXSCAN (dùng index)  hoặc  COLLSCAN (quét toàn bộ)
      ↓
FETCH document (trừ khi covered query)
```

## Problem

Cùng một query, hai kết quả:

```js
db.tasks.find({ projectId: p1, status: "OPEN" }).sort({ dueDate: 1 }).limit(20);
```

| | Không index phù hợp | Index đúng |
|---|---|---|
| Document quét | 2.000.000 | 20 |
| Thời gian | 3.200 ms | 2 ms |
| Bộ nhớ sort | 40 MB (có thể vượt giới hạn) | 0 |

Và điều đặc thù MongoDB: nếu sort không dùng được index và kết quả vượt **32MB**, query **thất bại** với `Sort exceeded memory limit` — không chỉ chậm mà lỗi hẳn. (Có thể bật `allowDiskUse` nhưng đó là che triệu chứng.)

Với PostgreSQL, thiếu index làm query chậm. Với MongoDB, nó có thể làm query **hỏng**.

## Mental Model

### Quy tắc ESR — thứ tự field trong compound index

Đây là quy tắc quan trọng nhất và là điểm khác biệt đáng nhớ nhất so với PostgreSQL:

```text
E — Equality   (so sánh bằng)      đặt TRƯỚC
S — Sort       (sắp xếp)            đặt GIỮA
R — Range      ($gt, $lt, $in)      đặt SAU
```

```js
// Query
db.tasks.find({
  projectId: p1,                       // E — equality
  dueDate: { $gte: today }             // R — range
}).sort({ priority: -1 });             // S — sort

// Index đúng theo ESR
db.tasks.createIndex({ projectId: 1, priority: -1, dueDate: 1 });
//                     └── E ──┘  └── S ────┘  └── R ──┘
```

Vì sao thứ tự này: một index là danh sách đã sắp xếp. Sau khi khoá bằng equality (`projectId = p1`), các entry còn lại **vẫn được sắp xếp theo field tiếp theo** — nên field sort phải ở đó để tận dụng thứ tự có sẵn. Nếu đặt range trước sort, sau khi lọc range các entry không còn thứ tự theo field sort nữa, và MongoDB phải sort trong bộ nhớ.

Kiểm chứng bằng `explain()`: nếu có `SORT` stage trong plan, index của bạn sai thứ tự.

### Chiều của sort trong compound index

```js
db.tasks.createIndex({ projectId: 1, createdAt: -1 });

.sort({ createdAt: -1 })                       // ✅ khớp
.sort({ createdAt: 1 })                        // ✅ đọc index ngược — cũng được
.sort({ projectId: 1, createdAt: -1 })         // ✅
.sort({ projectId: -1, createdAt: -1 })        // ❌ KHÔNG khớp — không đảo được cả cặp
```

Quy tắc: index dùng được cho sort nếu mọi field sort **cùng chiều** hoặc **ngược chiều hoàn toàn** với index. Trộn lẫn thì không.

### Prefix — một index phục vụ nhiều query

```js
db.tasks.createIndex({ projectId: 1, status: 1, dueDate: 1 });

// Dùng được index này:
find({ projectId: p })                                   ✅ prefix 1 field
find({ projectId: p, status: "OPEN" })                   ✅ prefix 2 field
find({ projectId: p, status: "OPEN", dueDate: {...} })    ✅ toàn bộ
find({ projectId: p }).sort({ status: 1 })               ✅

// KHÔNG dùng được (không phải prefix):
find({ status: "OPEN" })                                 ❌ thiếu field đầu
find({ dueDate: {...} })                                 ❌
```

Vì vậy: **thiết kế ít index phủ nhiều query** thay vì một index cho mỗi query. Mỗi index tốn RAM và làm mọi lần ghi chậm hơn.

## How It Works

### Các loại index

```js
// Single field
db.tasks.createIndex({ status: 1 });

// Compound — theo ESR
db.tasks.createIndex({ projectId: 1, dueDate: -1 });

// Unique
db.users.createIndex({ email: 1 }, { unique: true });

// Partial — chỉ index document thoả filter → nhỏ hơn, nhanh hơn
db.tasks.createIndex(
  { dueDate: 1 },
  { partialFilterExpression: { status: { $in: ["OPEN", "IN_PROGRESS"] } } }
);

// TTL — MongoDB tự xoá document sau N giây
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });

// Text search
db.posts.createIndex({ title: "text", body: "text" });

// Multikey — TỰ ĐỘNG khi field là array (không có option riêng)
db.tasks.createIndex({ tagIds: 1 });
```

**TTL index** là tính năng MongoDB có mà PostgreSQL không có sẵn: nó tự xoá document hết hạn (một background job chạy ~mỗi 60 giây). Rất tiện cho session, cache, log tạm. Lưu ý: xoá không tức thì, và nó tạo tải ghi.

**Partial index** thường bị bỏ qua nhưng rất hiệu quả: nếu 95% task đã `DONE` và bạn chỉ query task đang mở, partial index nhỏ hơn 20 lần và vừa RAM dễ hơn.

### Multikey index — đặc thù của array

Khi index một field là array, MongoDB tạo **một entry cho mỗi phần tử**:

```js
// Document
{ _id: 1, tagIds: [g1, g2, g3] }

// Index { tagIds: 1 } tạo 3 entry:
// g1 → doc1,  g2 → doc1,  g3 → doc1
```

Hệ quả và giới hạn:

- Index **lớn hơn** theo tổng số phần tử, không theo số document.
- Query `find({ tagIds: g1 })` dùng được index.
- **Không thể có hai field array trong cùng một compound index** — `{ tags: 1, comments: 1 }` bị từ chối nếu cả hai là array. Lý do: số entry sẽ là tích Descartes.
- Với `$elemMatch` nhiều điều kiện trên cùng array, index chỉ giúp được một phần.

Đây là lý do nữa để array có trần: array 10.000 phần tử tạo 10.000 index entry cho **một** document.

### Đọc `explain()`

```js
db.tasks.find({ projectId: p1, status: "OPEN" })
        .sort({ dueDate: 1 })
        .explain("executionStats");
```

Bốn số cần đọc, theo thứ tự:

```text
executionStats.nReturned            số document trả về
executionStats.totalKeysExamined    số index entry đọc
executionStats.totalDocsExamined    số document đọc từ disk
executionStats.executionTimeMillis  thời gian
```

Chẩn đoán bằng tỉ lệ:

| Dấu hiệu | Nghĩa |
|---|---|
| `totalDocsExamined ≈ nReturned` | index tốt |
| `totalDocsExamined ≫ nReturned` | index thiếu hoặc sai thứ tự |
| `totalKeysExamined ≫ nReturned` | index có nhưng lọc kém — sai thứ tự ESR |
| `totalDocsExamined = 0` | **covered query** — tốt nhất |
| stage `COLLSCAN` | không dùng index |
| stage `SORT` | sort trong bộ nhớ — index không phục vụ được sort |
| stage `IXSCAN` → `FETCH` | bình thường |

Hai stage cần tìm ngay: `COLLSCAN` và `SORT`. Chúng là nguyên nhân của gần như mọi query chậm.

### Covered query

Nếu index chứa **mọi field** query cần (cả filter, sort và projection), MongoDB không đọc document:

```js
db.tasks.createIndex({ projectId: 1, status: 1, title: 1 });

db.tasks.find(
  { projectId: p1, status: "OPEN" },
  { _id: 0, title: 1 }                  // _id: 0 BẮT BUỘC — _id không có trong index
).explain("executionStats");
// → totalDocsExamined: 0
```

`_id: 0` là điều kiện dễ quên nhất: `_id` luôn được trả về theo mặc định, và nếu nó không nằm trong index thì query không thể covered.

### Giới hạn sort trong bộ nhớ

```text
32 MB   giới hạn cho sort không dùng index (mặc định)
        → vượt: query THẤT BẠI, không chỉ chậm
```

```js
// Che triệu chứng
db.tasks.find(...).sort({ x: 1 }).allowDiskUse();

// Sửa nguyên nhân
db.tasks.createIndex({ /* theo ESR, có field sort */ });
```

### Query planner và plan cache

MongoDB thử nhiều plan song song trong lần chạy đầu, chọn plan nhanh nhất, rồi **cache** nó cho shape query đó. Plan cache bị xoá khi: index thay đổi, restart, hoặc plan bắt đầu hoạt động tệ.

Hệ quả thực tế: một query có thể nhanh hơn ở lần thứ hai (do cache), và một query chậm bất thường có thể đang dùng plan cache đã lỗi thời. `db.collection.getPlanCache().clear()` để kiểm tra giả thuyết đó.

### Chi phí của index

```text
Mỗi index thêm:
  + RAM     (working set phải vừa RAM — quan trọng hơn ở MongoDB)
  + disk
  + thời gian mỗi lần ghi   (mọi insert/update/delete phải cập nhật mọi index liên quan)
  − thời gian đọc
```

**Working set vừa RAM** là yếu tố quyết định hiệu năng MongoDB, hơn cả số index. Nếu index không vừa RAM, mỗi lần đọc index là một lần đọc disk và mọi lợi ích biến mất. Xem [Operations & production](07-operations-production.md).

Tìm index không dùng:

```js
db.tasks.aggregate([{ $indexStats: {} }]);
// accesses.ops = 0 sau nhiều ngày → ứng viên để xoá
```

## Example

```js
// Access pattern thật của một app task
// (1) danh sách task đang mở của project, sắp theo hạn
// (2) task của một người, mới nhất trước
// (3) tìm theo tag
// (4) session tự hết hạn

// (1) — ESR: E=projectId, S=dueDate, R=(không có) + partial để index nhỏ
db.tasks.createIndex(
  { projectId: 1, dueDate: 1 },
  { partialFilterExpression: { status: { $in: ["OPEN", "IN_PROGRESS"] } } }
);

// (2) — E=assigneeId, S=createdAt
db.tasks.createIndex({ assigneeId: 1, createdAt: -1 });

// (3) — multikey
db.tasks.createIndex({ tagIds: 1 });

// (4) — TTL
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });

// KHÔNG tạo index cho mọi field "cho chắc" — mỗi index làm ghi chậm hơn
```

## Prediction

1. Index `{ projectId: 1, dueDate: 1 }`, query `find({ dueDate: {...} })` — dùng được index?
2. Index `{ a: 1, b: -1 }`, `.sort({ a: -1, b: 1 })` — dùng được? Còn `.sort({ a: -1, b: -1 })`?
3. Query lọc equality trên `x`, sort theo `y`, range trên `z`. Index đúng thứ tự?
4. Sort 100MB không có index — chậm hay lỗi?
5. Index `{ projectId: 1, title: 1 }`, projection `{ title: 1 }` (không có `_id: 0`) — covered không?
6. Array 5.000 phần tử, index trên field đó — bao nhiêu index entry cho một document?
7. Compound index `{ tags: 1, comments: 1 }` với cả hai là array — tạo được không?
8. `totalKeysExamined: 500000`, `nReturned: 20` — vấn đề gì?

<details>
<summary>Đáp án</summary>

1. **Không** — `dueDate` không phải prefix.
2. `{a:-1, b:1}` **được** (đảo hoàn toàn); `{a:-1, b:-1}` **không** (trộn chiều).
3. `{ x: 1, y: 1, z: 1 }` — ESR.
4. **Lỗi** `Sort exceeded memory limit` (vượt 32MB).
5. Không — `_id` được trả về mặc định và không có trong index. Cần `_id: 0`.
6. 5.000.
7. **Không** — MongoDB từ chối compound index trên hai field array.
8. Index có nhưng lọc kém — sai thứ tự ESR; nhiều khả năng field sort đặt sau range.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Seed 2M document, query không index, `explain()` | `COLLSCAN`, `totalDocsExamined` = 2M |
| Thêm index sai thứ tự (range trước sort) | Có `IXSCAN` nhưng vẫn có `SORT` stage |
| Sửa theo ESR | `SORT` biến mất |
| Sort tập lớn không index | Lỗi `Sort exceeded memory limit` |
| Thêm `allowDiskUse()` | Chạy được nhưng chậm — che triệu chứng |
| Projection thiếu `_id: 0` với index đủ field | `totalDocsExamined > 0`, không covered |
| Thêm `_id: 0` | `totalDocsExamined: 0` |
| Tạo 20 index rồi đo throughput ghi | Ghi chậm rõ rệt |
| `$indexStats` sau một tuần | Thấy index không ai dùng |
| Index trên array 10.000 phần tử, xem `db.stats()` | Index lớn bất thường |
| Đổi index rồi chạy lại query cũ | Plan cache bị xoá; lần đầu chậm hơn |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Thứ tự field trong compound index không quan trọng | ESR quyết định index có phục vụ được sort hay không |
| Thiếu index chỉ làm chậm | Sort vượt 32MB làm query **thất bại** |
| Nhiều index thì an toàn | Mỗi index tốn RAM và làm ghi chậm |
| Multikey index như index thường | Nó tạo một entry mỗi phần tử array |
| Có thể compound index hai field array | MongoDB từ chối |
| `allowDiskUse` là cách sửa sort chậm | Nó che triệu chứng; index mới là cách sửa |
| Covered query chỉ cần index đủ field filter | Cần cả sort và projection, và thường cần `_id: 0` |
| Index vừa disk là đủ | Working set phải vừa **RAM** |

## Debugging

1. **`explain("executionStats")`** là bước đầu tiên, luôn luôn. Tìm hai thứ: `COLLSCAN` và `SORT`.
2. **Đọc tỉ lệ `totalDocsExamined / nReturned`.** Gần 1 là tốt; hàng nghìn là index sai.
3. **Có `SORT` stage** → index không phục vụ sort. Kiểm tra thứ tự ESR, không phải "thiếu index".
4. **Tìm query chậm thật** bằng profiler:
   ```js
   db.setProfilingLevel(1, { slowms: 100 });
   db.system.profile.find().sort({ ts: -1 }).limit(10);
   ```
   Đây là nguồn thông tin tốt nhất cho câu hỏi "query nào đang chậm".
5. **Index không được dùng** → `$indexStats`; và kiểm tra query có khớp prefix.
6. **Query chậm bất thường mà index đúng** → nghi plan cache: `getPlanCache().clear()` rồi đo lại.
7. **Kiểm tra working set vs RAM**: `db.serverStatus().wiredTiger.cache` — tỉ lệ đọc từ disk cao là dấu hiệu RAM không đủ.

## Production Considerations

- **Thiết kế index từ access pattern**, không từ danh sách field. Liệt kê query trước, rồi tìm tập index nhỏ nhất phủ chúng.
- **`createIndex` trên production**: MongoDB 4.2+ build index với lock rất ngắn, nhưng nó vẫn tốn I/O và RAM. Làm ngoài giờ cao điểm; trên replica set, cân nhắc rolling build.
- **`$indexStats` định kỳ** để xoá index không dùng — mỗi index là chi phí ghi vĩnh viễn.
- **Partial index** cho field có phân bố lệch (ví dụ 95% `status: DONE`).
- **TTL index** cho session/log/cache thay vì cron job xoá.
- **Profiler với `slowms`** bật ở production với mức hợp lý; nó là cách duy nhất biết query nào thật sự chậm.
- **Working set phải vừa RAM.** Đây là quyết định capacity quan trọng nhất của MongoDB.
- **Alert trên tỉ lệ `COLLSCAN`** — một query mới không có index sẽ xuất hiện ở đây trước khi người dùng phàn nàn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều index | đọc nhanh cho nhiều pattern | ghi chậm, tốn RAM |
| Ít index phủ nhiều query (prefix) | cân bằng tốt | phải thiết kế cẩn thận |
| Partial index | nhỏ, vừa RAM | chỉ phục vụ query khớp filter |
| Covered query | không đọc document | index rộng hơn, cần `_id: 0` |
| TTL index | tự dọn, không cần cron | xoá không tức thì, tạo tải ghi |
| Multikey | query array nhanh | index lớn theo số phần tử |
| `allowDiskUse` | query không lỗi | chậm; che vấn đề thiếu index |

## Explain Without Notes

1. Quy tắc ESR là gì, và **vì sao** thứ tự đó đúng?
2. Khi nào index dùng được cho sort, và khi nào không (về chiều)?
3. Prefix rule — một index `{a,b,c}` phục vụ những query nào?
4. Bốn số trong `executionStats` và cách chẩn đoán bằng tỉ lệ?
5. Vì sao thiếu index trong MongoDB có thể làm query **lỗi**, không chỉ chậm?
6. Multikey index khác index thường thế nào, và hai giới hạn của nó?

## Related

- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — lý thuyết index chung
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — so sánh loại index
- [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) — quy trình tương đương
- [Document model](01-document-model.md) — kiểu dữ liệu ảnh hưởng index
- [Embed vs reference](02-embed-vs-reference.md) — array lớn làm index lớn
- [Aggregation pipeline](05-aggregation-pipeline.md) — index cho `$match` đầu pipeline
- [Operations & production](07-operations-production.md) — working set và RAM
- [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — index cho pagination
