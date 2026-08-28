---
level: intermediate
area: database
prerequisites:
  - 02-prisma-model-and-client.md
related:
  - ../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md
  - ../../05-cross-cutting/performance/04-database-performance.md
  - 06-raw-sql-escape-hatches.md
---

# Prisma relations & N+1

> Code đọc rất tự nhiên. Nó sinh 101 query. Đây là abstraction leak lớn nhất của mọi ORM, và nó không có cảnh báo nào lúc compile.

*Baseline: Prisma 6.x, PostgreSQL.*

## Position

```text
Domain logic  "cho tôi user kèm post của họ"
      ↓
Prisma include/select
      ↓
1 query? 2 query? 101 query?     ← note này
      ↓
PostgreSQL
```

## Problem

```ts
// Endpoint: danh sách 100 task, mỗi task hiện tên người được giao
const tasks = await prisma.task.findMany({ take: 100 });

for (const task of tasks) {
  const assignee = task.assigneeId
    ? await prisma.user.findUnique({ where: { id: task.assigneeId } })
    : null;
  results.push({ ...task, assigneeName: assignee?.name });
}
```

Code này **đúng**. Nó chạy. Test pass. Trên máy dev với 10 task và database local (latency 0,2ms) nó mất 20ms.

Trên production với 100 task và database ở AZ khác (latency 2ms):

```text
1 query cho tasks      →   2ms
100 query cho users    → 200ms
                         ─────
                         202ms  cho một việc lẽ ra 4ms
```

Và nó tệ đi **tuyến tính** theo số dòng, nên nó không xuất hiện trong staging và xuất hiện trong production.

Đây là **N+1**: một query để lấy danh sách, N query để lấy quan hệ của từng phần tử.

## Mental Model

```text
N+1     1 query (danh sách)  +  N query (mỗi phần tử một lần)
        → thời gian = 1 round-trip + N round-trip
        → nút thắt là SỐ ROUND-TRIP, không phải độ phức tạp query

Gộp    1 query (danh sách)  +  1 query (tất cả quan hệ, WHERE id IN (...))
        → thời gian = 2 round-trip
```

Điều quan trọng: **N query nhỏ chậm hơn 1 query lớn**, kể cả khi mỗi query nhỏ chỉ mất 0,5ms. Chi phí không nằm ở việc đọc dữ liệu mà ở round-trip: gửi, chờ, nhận, parse, ×N.

Và câu hỏi trung tâm khi dùng ORM:

> **Mỗi dòng code truy cập quan hệ sinh ra bao nhiêu query?**

Với Prisma, câu trả lời phụ thuộc bạn viết thế nào — và mặc định thì tốt hơn nhiều người tưởng.

## How It Works

### Prisma nạp quan hệ bằng cách nào

Mặc định, Prisma **không** JOIN. Nó tách thành nhiều query rồi ghép trong bộ nhớ:

```ts
await prisma.task.findMany({ take: 100, include: { assignee: true } });
```

```sql
-- Query 1
SELECT id, title, assignee_id, ... FROM tasks LIMIT 100;
-- Query 2  ← MỘT query cho tất cả, không phải 100
SELECT id, name, email FROM users WHERE id IN ($1, $2, ..., $n);
```

**Hai** query, không phải 101. Prisma tự batch quan hệ. Đây là điều nhiều người không biết, và nó có nghĩa: **`include` không gây N+1.** Vòng lặp `await` mới gây N+1.

Với quan hệ lồng nhau, mỗi *tầng* thêm một query:

```ts
await prisma.project.findMany({
  include: { tasks: { include: { assignee: true, comments: true } } },
});
// → 4 query: projects, tasks, users, comments
```

Số query = số **tầng quan hệ** + 1, không phụ thuộc số dòng. Đó là tính chất tốt.

### `relationLoadStrategy` — JOIN thật

Prisma 5.10+ có preview feature `relationJoins` cho PostgreSQL/MySQL, cho phép chọn chiến lược:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["relationJoins"]
}
```

```ts
await prisma.task.findMany({
  relationLoadStrategy: 'join',    // một query dùng LATERAL JOIN
  include: { assignee: true },
});
```

*Kiểm tra trạng thái GA của tính năng này cho version Prisma bạn dùng — nó còn ở preview tại thời điểm baseline.*

Khi nào `join` tốt hơn `query` (mặc định):

| | `query` (mặc định) | `join` |
|---|---|---|
| Số round-trip | 1 + số tầng | 1 |
| Latency DB cao | tệ hơn | **tốt hơn** |
| Quan hệ 1-N nhiều dòng con | **tốt hơn** (không nhân dữ liệu) | tệ hơn (JOIN nhân dòng) |
| Cần index | trên khoá ngoại | trên khoá ngoại |

Quy tắc: latency cao → thử `join`. Một cha có hàng trăm con → giữ `query`, vì JOIN sẽ trả cha lặp lại hàng trăm lần qua network.

### Ba dạng N+1 thật

Prisma tự batch `include`, nên N+1 chỉ đến từ code của bạn:

**1. Vòng lặp có `await`** — dạng phổ biến nhất:

```ts
// ❌
for (const t of tasks) {
  const u = await prisma.user.findUnique({ where: { id: t.assigneeId } });
}

// ✅ include
const tasks = await prisma.task.findMany({ include: { assignee: true } });

// ✅ hoặc batch thủ công khi không có quan hệ khai báo
const ids = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))];
const users = await prisma.user.findMany({ where: { id: { in: ids } } });
const byId = new Map(users.map(u => [u.id, u]));
```

**2. Query trong resolver / getter / method của DTO:**

```ts
// ❌ Mỗi lần serialize một task lại query
class TaskDto {
  get assigneeName() { return prisma.user.findUnique(...); }   // async getter, còn tệ hơn
}
```

Trong GraphQL đây là mặc định, và giải pháp là DataLoader. Xem [RPC, GraphQL & alternatives](../../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md).

**3. `Promise.all` trong vòng lặp — nhanh hơn nhưng vẫn N query:**

```ts
// ⚠️ 100 query song song: nhanh hơn tuần tự, nhưng cạn connection pool
await Promise.all(tasks.map(t => prisma.user.findUnique({ where: { id: t.assigneeId } })));
```

Đây là bẫy tinh vi: nó *trông* như đã sửa vì thời gian giảm, nhưng nó đẩy 100 query đồng thời vào một pool có 10 connection. Kết quả là `P2024` pool timeout dưới tải. Xem [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md).

### Quan hệ trong schema

```prisma
// 1-1
model User    { id String @id  profile Profile? }
model Profile { id String @id  user User @relation(fields: [userId], references: [id])
                userId String @unique }   // @unique làm nó thành 1-1

// 1-N — bên "N" giữ khoá ngoại
model Project { id String @id  tasks Task[] }
model Task    { id String @id  project Project @relation(fields: [projectId], references: [id])
                projectId String }

// M-N implicit — Prisma tự tạo bảng nối, bạn không thấy nó
model Task { id String @id  tags Tag[] }
model Tag  { id String @id  tasks Task[] }

// M-N explicit — khi bảng nối cần field riêng
model TaskTag {
  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId String
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  tagId  String
  addedBy String
  addedAt DateTime @default(now())
  @@id([taskId, tagId])
}
```

**Chọn implicit hay explicit:** implicit gọn nhưng bạn không truy vấn được bảng nối và không thêm được cột. Khi cần biết "ai gắn tag này, lúc nào" thì phải explicit — và chuyển từ implicit sang explicit là một migration khó. Nên nghĩ trước.

**Owning side:** bên có `@relation(fields: [...])` là bên giữ cột khoá ngoại. Bên kia chỉ là field ảo. Điều này quyết định `onDelete` đặt ở đâu.

### Nested write

```ts
// Tạo project + tasks trong MỘT transaction ngầm
await prisma.project.create({
  data: {
    name: 'Q4',
    tasks: {
      create: [{ title: 'A' }, { title: 'B' }],
    },
  },
});

// connect: gắn vào record đã tồn tại
await prisma.task.create({
  data: { title: 'C', project: { connect: { id: projectId } } },
});

// connectOrCreate: gắn nếu có, tạo nếu chưa
tags: { connectOrCreate: [{ where: { name: 'urgent' }, create: { name: 'urgent' } }] }
```

Nested write **tự động nằm trong một transaction**. Đây là lý do nó tốt hơn nhiều lệnh riêng lẻ: nếu tạo task thứ hai lỗi, project cũng rollback. Xem [Prisma transactions](04-prisma-transactions.md).

### Pagination với Prisma

Repo đã có lý thuyết OFFSET vs cursor đầy đủ ở [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — **không lặp lại ở đây**. Chỉ phần cú pháp Prisma:

```ts
// skip/take — tương đương OFFSET/LIMIT. Chậm dần theo skip.
await prisma.task.findMany({ skip: 100, take: 20, orderBy: { createdAt: 'desc' } });

// cursor — luôn nhanh. LƯU Ý: skip: 1 để không lặp lại chính cursor.
await prisma.task.findMany({
  take: 20,
  skip: 1,
  cursor: { id: lastId },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],   // tie-breaker BẮT BUỘC
});
```

Ba điều Prisma **không** làm hộ bạn:

1. **Tie-breaker.** `orderBy: { createdAt: 'desc' }` một mình không ổn định — item lặp/bỏ khi nhiều dòng cùng `createdAt`. Phải thêm `{ id: 'desc' }`.
2. **Index.** `orderBy` cần index khớp, gồm cả chiều: `@@index([projectId, createdAt(sort: Desc)])`.
3. **`cursor` của Prisma dùng một field unique**, nên nếu bạn sort theo `createdAt` mà cursor là `id`, kết quả chỉ đúng khi `orderBy` có `id` làm tie-breaker. Với cursor phức hợp thật sự, dùng raw SQL với so sánh tuple `(created_at, id) < (?, ?)`.

Và `_count` thay cho `COUNT(*)` riêng:

```ts
await prisma.project.findMany({ include: { _count: { select: { tasks: true } } } });
```

## Example

```ts
// Endpoint list: 2 query, select tường minh, cursor có tie-breaker
export async function listTasks(projectId: string, cursor?: string, limit = 20) {
  const rows = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true, title: true, status: true,
      assignee: { select: { id: true, name: true } },   // batch, không N+1
      _count: { select: { comments: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasMore = rows.length > limit;
  return { data: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
```

## Prediction

1. `findMany({ take: 100, include: { assignee: true } })` — bao nhiêu SQL query?
2. Vòng lặp `for (const t of tasks) await prisma.user.findUnique(...)` với 100 task — bao nhiêu?
3. `include: { tasks: { include: { assignee: true, comments: true } } }` — bao nhiêu?
4. `Promise.all(tasks.map(t => prisma.user.findUnique(...)))` với 100 task và pool size 10 — bao nhiêu query? Lỗi gì có thể xảy ra?
5. `orderBy: { createdAt: 'desc' }` với 50 task cùng `createdAt`, phân trang cursor — item có lặp?
6. `relationLoadStrategy: 'join'` cho một project có 500 task — dữ liệu project được trả về bao nhiêu lần qua network?
7. M-N implicit, bạn cần thêm cột `addedAt` vào bảng nối — làm được không?
8. Nested `create` cho project + 3 task, task thứ 2 vi phạm constraint — project có được tạo?

<details>
<summary>Đáp án</summary>

1. **2** — Prisma tự batch.
2. **101**.
3. **4** — projects, tasks, users, comments. Không phụ thuộc số dòng.
4. Vẫn 100 query, gửi đồng thời. Rủi ro `P2024` pool timeout và làm chậm mọi request khác.
5. **Có** — thiếu tie-breaker.
6. 500 lần (JOIN nhân dòng cha). Đây là lý do `join` không phải luôn tốt hơn.
7. Không — phải chuyển sang explicit M-N, là một migration khó.
8. **Không** — nested write nằm trong một transaction, rollback toàn bộ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bật query log, chạy endpoint list có quan hệ | Đếm query thật; so với dự đoán |
| Viết vòng lặp `await` cho 100 dòng, đo thời gian | Tăng tuyến tính theo số dòng |
| Đổi sang `include`, đo lại | 2 query, gần như phẳng theo số dòng |
| `Promise.all` 200 query với pool size 10 | `P2024` pool timeout; các request khác cũng chậm |
| Thêm 100ms latency giả tới DB (`tc netem` hoặc DB ở region khác) | N+1 lộ ra ngay; đây là cách tái hiện production |
| Cursor pagination bỏ tie-breaker, seed 100 dòng cùng timestamp | Item lặp giữa các trang |
| `relationLoadStrategy: 'join'` với cha có 500 con | Đo payload — dữ liệu cha lặp 500 lần |
| `include` bảng có cột TEXT lớn | Đo thời gian và bộ nhớ |
| Xoá index trên khoá ngoại, chạy `include` | Query thứ hai (`WHERE id IN`) chậm |

Thí nghiệm 5 là quan trọng nhất: **N+1 không tái hiện được trên localhost.** Thêm latency giả là cách duy nhất thấy nó trước khi production thấy.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `include` gây N+1 | Prisma tự batch; vòng lặp `await` mới gây |
| `include` sinh một JOIN | Mặc định là nhiều query + ghép trong memory |
| N+1 chỉ là vấn đề hiệu năng nhỏ | Nó tăng tuyến tính theo dữ liệu và làm cạn pool |
| `Promise.all` sửa được N+1 | Nó chỉ song song hoá; vẫn N query, và cạn pool |
| `relationLoadStrategy: 'join'` luôn nhanh hơn | JOIN nhân dòng cha; xấu với quan hệ 1-N lớn |
| Prisma tự thêm tie-breaker cho cursor | Không — bạn phải tự thêm |
| M-N implicit chuyển sang explicit dễ | Là migration khó, cần nghĩ trước |
| ORM nào cũng có N+1 như nhau | Cơ chế batch khác nhau; phải đo cho từng ORM |

## Debugging

1. **Đếm số query cho một request.** Đây là chỉ số quan trọng nhất, và hầu như không ai đo nó:
   ```ts
   let n = 0;
   prisma.$on('query', () => n++);
   // ...gọi endpoint... rồi log n
   ```
   Nếu `n` tăng theo số dòng trả về, bạn có N+1.
2. **Bật log kèm thời gian** và tìm nhóm query giống nhau lặp lại — dấu hiệu đặc trưng của N+1.
3. **Middleware đếm query mỗi request** và log cảnh báo khi vượt ngưỡng (ví dụ 20). Đây là cách phát hiện N+1 mới trước khi nó lên production:
   ```ts
   prisma.$extends({ query: { async $allOperations({ args, query }) {
     requestContext.queryCount++;
     return query(args);
   }}});
   ```
4. **Tracing** — nếu đã có OpenTelemetry, span của mỗi query hiện rõ thành một chuỗi dài. Xem [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
5. **Thêm latency giả ở dev** để N+1 trở nên nhìn thấy được.
6. Nếu số query đã đúng (2–4) mà vẫn chậm → vấn đề là **index hoặc kích thước payload**, không phải N+1. Xem [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).

## Production Considerations

- **Alert trên số query mỗi request** — ngưỡng cứng (ví dụ > 30) bắt được N+1 mới.
- **Index trên mọi khoá ngoại** dùng trong `include`. PostgreSQL **không** tự tạo index cho khoá ngoại (khác với khoá chính).
- **`select` thay `include`** ở tầng API để giới hạn payload.
- **Giới hạn độ sâu `include`** — mỗi tầng thêm một query và nhân kích thước dữ liệu.
- **Không `Promise.all` không giới hạn** trên query DB; concurrency phải nhỏ hơn pool size.
- **Đo với latency giống production** — dev trên localhost che hoàn toàn lớp bug này.
- Với danh sách lớn cần nhiều quan hệ, cân nhắc một raw SQL có JOIN thay vì 5 tầng `include`. Xem [Raw SQL escape hatches](06-raw-sql-escape-hatches.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `include` (mặc định `query`) | ít round-trip, không nhân dữ liệu | nhiều query hơn `join` |
| `relationLoadStrategy: 'join'` | 1 round-trip | nhân dòng cha; preview feature |
| Batch thủ công (`in` + Map) | kiểm soát hoàn toàn | code dài hơn |
| Raw SQL có JOIN | một query, kiểm soát plan | mất type safety, tự map |
| M-N implicit | schema gọn | không truy vấn/mở rộng bảng nối |
| M-N explicit | linh hoạt | verbose hơn |

## Explain Without Notes

1. Vì sao N query nhỏ chậm hơn 1 query lớn? Chi phí thật nằm ở đâu?
2. `include` cho 100 dòng sinh bao nhiêu query, và vì sao không phải 101?
3. Ba dạng N+1 thật trong code Prisma?
4. Vì sao `Promise.all` không sửa được N+1, và nó tạo ra vấn đề gì mới?
5. Khi nào `relationLoadStrategy: 'join'` **tệ hơn** mặc định?
6. Ba thứ Prisma không làm hộ bạn trong cursor pagination?

## Related

- [Prisma model & client](02-prisma-model-and-client.md) — `select` vs `include`
- [Prisma transactions](04-prisma-transactions.md) — nested write và transaction
- [Raw SQL escape hatches](06-raw-sql-escape-hatches.md) — khi `include` không đủ
- [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — lý thuyết cursor, tie-breaker, index
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — N+1 ở tầng hệ thống
- [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — vì sao `Promise.all` nguy hiểm
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — index cho khoá ngoại và `orderBy`
- [RPC, GraphQL & alternatives](../../02-backend-api/00-http-api/08-rpc-graphql-alternatives.md) — DataLoader cho cùng vấn đề
