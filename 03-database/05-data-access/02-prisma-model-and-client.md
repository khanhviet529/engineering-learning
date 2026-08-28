---
level: intermediate
area: database
prerequisites:
  - 01-orm-vs-query-builder-vs-raw-sql.md
related:
  - 03-prisma-relations-and-n-plus-1.md
  - 05-prisma-migrations-production.md
  - ../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md
---

# Prisma: schema và client

> `schema.prisma` **không phải** database. Nó là mô tả của bạn về database. Khi hai thứ đó lệch nhau, Prisma vẫn tin bản mô tả — và đó là nguồn của một lớp bug đặc trưng.

*Baseline: Prisma 6.x, PostgreSQL. Các tính năng còn ở trạng thái preview được ghi rõ.*

## Position

```text
schema.prisma  (nguồn sự thật của BẠN)
      ↓ prisma generate
Prisma Client (TypeScript có type)
      ↓ query
PostgreSQL  (nguồn sự thật THẬT)
      ↑ prisma migrate — nơi hai bên được đồng bộ
```

## Problem

Bạn cần một tầng data access thoả bốn điều cùng lúc:

1. Type an toàn — đổi cột là lỗi compile, không phải lỗi runtime lúc 3h sáng.
2. Không viết code mapping dòng → object bằng tay.
3. Schema có version, review được như code.
4. Quan hệ khai báo được, không nối JOIN bằng string.

Prisma giải quyết cả bốn bằng một ý tưởng duy nhất: **schema là code, client được sinh ra từ schema**.

Nhưng chính ý tưởng đó tạo ra vấn đề riêng của nó: giờ có **hai** mô tả về cấu trúc dữ liệu — file schema và database thật — và chúng có thể lệch nhau.

## Mental Model

```text
┌─────────────────┐
│ schema.prisma   │  bạn viết
└────────┬────────┘
         │ prisma generate  (chỉ sinh code TypeScript, KHÔNG chạm database)
         ▼
┌─────────────────┐
│ @prisma/client  │  code có type, nằm trong node_modules
└────────┬────────┘
         │ query lúc runtime
         ▼
┌─────────────────┐
│   PostgreSQL    │
└─────────────────┘
         ▲
         │ prisma migrate  (thứ DUY NHẤT thay đổi database)
```

Phân biệt hai lệnh này là điều quan trọng nhất khi mới dùng Prisma:

| Lệnh | Làm gì | Chạm database? |
|---|---|---|
| `prisma generate` | sinh Prisma Client từ schema | **Không** |
| `prisma migrate dev` | sinh + áp dụng migration | **Có** |
| `prisma db push` | đẩy schema trực tiếp, không tạo migration | **Có** |
| `prisma db pull` | đọc database → ghi vào schema (ngược chiều) | đọc |

Hệ quả: `generate` thành công **không** có nghĩa database khớp schema. Client của bạn có thể có type cho một cột chưa tồn tại — code compile sạch rồi chết lúc runtime với lỗi từ PostgreSQL.

Đây là phiên bản Prisma của [ranh giới TypeScript ↔ runtime](../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md): type nói có, database nói không.

## How It Works

### Cấu trúc schema

```prisma
// datasource: kết nối tới đâu
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")     // đọc lúc RUNTIME, không nhúng lúc build
}

// generator: sinh ra cái gì
generator client {
  provider = "prisma-client-js"
}

enum TaskStatus {
  OPEN
  IN_PROGRESS
  DONE
}

model Task {
  // scalar fields
  id          String     @id @default(uuid()) @db.Uuid
  title       String     @db.VarChar(200)
  description String?                          // ? = nullable
  status      TaskStatus @default(OPEN)
  dueDate     DateTime?  @map("due_date")      // tên cột thật trong DB
  createdAt   DateTime   @default(now())  @map("created_at")
  updatedAt   DateTime   @updatedAt        @map("updated_at")

  // relation fields — KHÔNG phải cột trong database
  project     Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String     @map("project_id") @db.Uuid
  assignee    User?      @relation(fields: [assigneeId], references: [id], onDelete: SetNull)
  assigneeId  String?    @map("assignee_id") @db.Uuid

  @@index([projectId, createdAt(sort: Desc)])   // index cho pagination
  @@map("tasks")                                 // tên bảng thật
}
```

Bốn điều đáng chú ý:

- **`@map` / `@@map`** tách tên trong code (camelCase) khỏi tên trong DB (snake_case). Không có nó, bảng của bạn tên `Task` với cột `dueDate` — không theo quy ước SQL và khó dùng từ raw SQL.
- **Relation field (`project`) không phải cột.** Cột thật là `projectId`. Đây là chỗ hay nhầm khi đọc SQL sinh ra.
- **`@updatedAt` do Prisma quản, không phải database.** Nếu ai đó `UPDATE` bằng SQL trực tiếp, cột này **không** tự cập nhật. Muốn database bảo đảm thì cần trigger.
- **`@@index` khai báo được trong schema** — nên đặt ở đây thay vì tạo tay, để index có version cùng schema.

### `enum` — nơi Prisma và PostgreSQL gặp nhau

`enum` trong Prisma tạo một **native enum type** trong PostgreSQL. Điều đó nghĩa là thêm một giá trị mới là một thay đổi schema (migration), không phải thay đổi code.

Đánh đổi thật:

| | Native enum | `String` + check constraint |
|---|---|---|
| Thêm giá trị | cần migration | cần migration (sửa constraint) |
| Xoá giá trị | rất khó | dễ hơn |
| Đổi tên giá trị | khó | dễ hơn |
| Type safety trong TS | có | có (nếu dùng Zod/union) |

Với domain hay thay đổi trạng thái, `String` + validation ở tầng app đôi khi thực dụng hơn. Với domain ổn định, native enum tốt hơn vì database tự bảo vệ.

### Client được sinh ra

```ts
import { PrismaClient } from '@prisma/client';

// MỘT instance cho cả process — nó quản connection pool
export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
});
```

Trong NestJS, đây là một provider singleton với lifecycle hook:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }   // quan trọng cho graceful shutdown
}
```

Tạo nhiều `PrismaClient` là lỗi phổ biến nhất về vận hành: mỗi instance mở pool riêng, và bạn cạn `max_connections` của PostgreSQL rất nhanh. Xem [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) và [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md).

Trong dev với hot reload, dùng global để không tạo lại client mỗi lần reload:

```ts
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
```

### CRUD — ý nghĩa, không phải danh sách API

Điều cần nhớ về mỗi method là **nó ném lỗi hay trả null**, và **nó nhận điều kiện gì** — chứ không phải chữ ký đầy đủ:

| Method | Nhận điều kiện | Không tìm thấy |
|---|---|---|
| `findUnique` | chỉ field **unique** | `null` |
| `findUniqueOrThrow` | chỉ field unique | **throw** |
| `findFirst` | điều kiện bất kỳ + `orderBy` | `null` |
| `findMany` | điều kiện bất kỳ | `[]` |
| `create` | — | — |
| `update` | chỉ field unique | **throw** `P2025` |
| `updateMany` | điều kiện bất kỳ | trả `{ count: 0 }` |
| `delete` | chỉ field unique | **throw** `P2025` |
| `deleteMany` | điều kiện bất kỳ | `{ count: 0 }` |
| `upsert` | chỉ field unique | tạo mới |

Hai phân biệt có hệ quả thực tế:

**1. `update` vs `updateMany` — đây là công cụ chống race condition.**

```ts
// ❌ Đọc rồi ghi: hai request đồng thời đều thấy status = 'pending'
const order = await prisma.order.findUnique({ where: { id } });
if (order.status !== 'pending') throw new ConflictError();
await prisma.order.update({ where: { id }, data: { status: 'paid' } });

// ✅ Một câu atomic: điều kiện nằm TRONG câu UPDATE
const { count } = await prisma.order.updateMany({
  where: { id, status: 'pending' },      // ← điều kiện là bảo vệ
  data: { status: 'paid', paidAt: new Date() },
});
if (count === 0) throw new ConflictError('Order không ở trạng thái pending');
```

`updateMany` cho phép điều kiện không-unique, nên nó diễn đạt được "chỉ đổi nếu đang ở trạng thái X". Đây là optimistic concurrency ở mức đơn giản nhất. Xem [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md).

**2. `upsert` không atomic tuyệt đối.** Nó vẫn có thể ném unique violation khi hai request chạy song song. Cách đúng là bắt `P2002` và retry, hoặc dùng `ON CONFLICT` qua raw SQL.

### `select` vs `include`

```ts
// include: lấy TẤT CẢ scalar field của Task + thêm quan hệ
await prisma.task.findMany({ include: { assignee: true } });
// → SELECT tasks.* ... rồi SELECT users.* WHERE id IN (...)

// select: chỉ lấy field được liệt kê. include và select LOẠI TRỪ nhau ở cùng cấp
await prisma.task.findMany({
  select: {
    id: true,
    title: true,
    assignee: { select: { id: true, name: true } },   // nested select
  },
});
// → SELECT id, title FROM tasks ... SELECT id, name FROM users WHERE id IN (...)
```

Vì sao điều này quan trọng hơn nó trông:

- **Over-fetching thật sự tốn.** Một bảng có cột `description TEXT` 50KB; `include` kéo nó về cho 100 dòng = 5MB qua network, rồi serialize, rồi gửi cho client.
- **`select` là cách shape response** — nó khớp với nguyên tắc "không trả entity của DB ra API". Xem [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md).
- **`select` giúp index-only scan.** Nếu index đã chứa mọi cột cần, PostgreSQL không phải đọc heap. Xem [Index types](../01-postgresql/indexes-query-planning/02-index-types.md).

Quy tắc thực dụng: **`select` ở tầng đọc cho API; `include` khi cần cả entity để xử lý domain logic.**

### Schema lệch database

Ba cách lệch, ba biểu hiện:

| Nguyên nhân | Biểu hiện |
|---|---|
| Sửa schema, chạy `generate`, quên `migrate` | compile sạch, runtime lỗi `column does not exist` |
| Ai đó `ALTER TABLE` bằng SQL trực tiếp | Prisma không biết; migration sau có thể xung đột |
| `db push` ở dev, `migrate deploy` ở prod | lịch sử migration không khớp trạng thái thật |

Kiểm tra: `prisma migrate status` cho biết migration nào chưa áp dụng. `prisma db pull` cho biết database thật đang có gì (nó sẽ ghi đè schema — commit trước khi chạy).

## Example

```ts
// Tầng đọc cho API: select tường minh, không trả entity thô
export async function listTasks(projectId: string, cursor?: string, limit = 20) {
  return prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],   // tie-breaker
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
}
```

Lưu ý `orderBy` có tie-breaker `id` — không có nó, cursor pagination lặp/bỏ item. Chi tiết trong [note 03](03-prisma-relations-and-n-plus-1.md) và [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md).

## Prediction

1. Bạn thêm cột vào schema, chạy `prisma generate`, không chạy `migrate`. Code compile không? Runtime?
2. `findUnique({ where: { status: 'OPEN' } })` — được không?
3. `update({ where: { id: 'không-tồn-tại' } })` — trả `null` hay throw?
4. `updateMany({ where: { id, status: 'pending' } })` khi status đã là `paid` — throw hay `count: 0`?
5. `include: { assignee: true }` cho 100 task — bao nhiêu SQL query?
6. Tạo `new PrismaClient()` trong mỗi request handler, 50 request đồng thời — bao nhiêu connection tới PostgreSQL?
7. Ai đó `UPDATE tasks SET title = 'x'` bằng psql — cột `updatedAt` (`@updatedAt`) có đổi không?
8. `select` và `include` cùng một cấp trong một query — được không?

<details>
<summary>Đáp án</summary>

1. Compile **sạch** (client đã có type mới); runtime lỗi từ PostgreSQL `column ... does not exist`.
2. Không — `findUnique` chỉ nhận field unique. Dùng `findFirst`.
3. **Throw** `P2025`.
4. `{ count: 0 }` — không throw. Đây là lý do nó dùng được cho state machine.
5. **2** — một cho `tasks`, một cho `users WHERE id IN (...)`.
6. Rất nhiều — mỗi client một pool. Đây là cách cạn `max_connections`.
7. **Không** — `@updatedAt` do Prisma quản ở tầng client, không phải trigger DB.
8. Không — chúng loại trừ nhau ở cùng cấp.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Sửa schema, `generate`, bỏ `migrate`, gọi query | Lỗi runtime dù compile sạch |
| `new PrismaClient()` trong handler, load test | `too many connections`; đếm bằng `pg_stat_activity` |
| Bật query log, gọi endpoint có `include` | Đếm số query — thường nhiều hơn dự đoán |
| `include` một bảng có cột TEXT lớn cho 100 dòng | Đo kích thước payload và thời gian |
| Đổi sang `select` chỉ field cần | So lại |
| `ALTER TABLE` bằng psql rồi chạy `migrate dev` | Prisma phát hiện drift, đề nghị reset |
| `upsert` từ 2 request song song cùng key | Có thể `P2002` |
| Đọc-rồi-ghi state transition, gửi 2 request song song | Cả hai thành công — lost update |
| Đổi sang `updateMany` có điều kiện status | Một thành công, một `count: 0` |
| `UPDATE` bằng psql rồi kiểm tra `updatedAt` | Không đổi |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `schema.prisma` là database | Là mô tả của bạn; `migrate` mới đồng bộ |
| `prisma generate` cập nhật database | Nó chỉ sinh code TypeScript |
| `include` chỉ thêm quan hệ | Nó cũng lấy **mọi** scalar field của bảng gốc |
| `findUnique` nhận điều kiện bất kỳ | Chỉ field unique |
| `update` trả null khi không tìm thấy | Nó throw `P2025` |
| `upsert` atomic tuyệt đối | Vẫn có thể unique violation khi song song |
| `@updatedAt` là trigger trong DB | Do Prisma quản ở tầng client |
| Relation field là cột trong DB | Cột thật là field khoá ngoại (`projectId`) |
| Prisma tự tạo index cần thiết | Chỉ tạo cho `@id`, `@unique`, và `@@index` bạn khai báo |

## Debugging

1. **Bật query log** trước mọi phán đoán:
   ```ts
   prisma.$on('query', (e) => logger.debug({ sql: e.query, params: e.params, ms: e.duration }));
   ```
2. **Lỗi runtime mà compile sạch** → gần như luôn là schema lệch DB. `prisma migrate status`.
3. **Đọc mã lỗi Prisma**, chúng cụ thể: `P2002` unique violation · `P2003` foreign key · `P2025` record không tồn tại · `P1001` không kết nối được · `P2024` **pool timeout** (dấu hiệu cạn connection hoặc query chậm giữ connection).
4. **`too many connections`** → đếm số `PrismaClient` được tạo; kiểm tra pool size trong connection string (`?connection_limit=`).
5. **Query chậm** → lấy SQL từ log, chạy `EXPLAIN ANALYZE` thủ công. Đừng đoán từ code Prisma.
6. **Không rõ database thật đang có gì** → `prisma db pull` vào một branch throwaway rồi diff.

## Production Considerations

- **Một `PrismaClient` cho cả process**, đóng bằng `$disconnect()` trong graceful shutdown.
- **`connection_limit` trong `DATABASE_URL`** phải tính theo số instance: `số_pod × connection_limit ≤ max_connections × 0.8`. Với nhiều pod, cân nhắc PgBouncer.
- **`migrate deploy` trong CI/CD**, không bao giờ `migrate dev` hay `db push` ở production. Xem [note 05](05-prisma-migrations-production.md).
- **Khai báo index trong schema** (`@@index`) để nó có version; không tạo tay trên production.
- **`select` cho mọi endpoint đọc** — không trả entity thô ra API.
- **`statement_timeout`** ở database, và timeout ở tầng app.
- **Log query chậm** với sampling ở production; không log toàn bộ (tốn I/O, có thể lộ dữ liệu trong `params`).
- Đặt `@map`/`@@map` từ đầu — đổi về sau là một migration rename toàn bộ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Schema-first (Prisma) | một nguồn sự thật, type sinh tự động | schema có thể lệch DB; ràng buộc vào Prisma |
| `include` | code ngắn, có cả entity | over-fetching, dễ N+1 |
| `select` | payload nhỏ, index-only scan khả thi | verbose, phải cập nhật khi thêm field |
| Native `enum` | DB tự bảo vệ giá trị | thêm/đổi giá trị cần migration |
| `String` + validation app | linh hoạt | DB không bảo vệ |
| `@map` snake_case | thân thiện SQL, dễ dùng raw SQL | thêm dòng trong schema |

## Explain Without Notes

1. Vẽ chuỗi `schema.prisma → generate → client → database`, và nói lệnh nào chạm database.
2. Vì sao code có thể compile sạch mà chết lúc runtime?
3. `findUnique` khác `findFirst` ở đâu? `update` khác `updateMany` ở đâu?
4. Vì sao `updateMany` dùng được để chống race condition mà `update` thì không?
5. `select` vs `include` — ba lý do `select` tốt hơn cho tầng API?
6. Vì sao tạo nhiều `PrismaClient` là vấn đề vận hành?

## Related

- [ORM vs Query Builder vs Raw SQL](01-orm-vs-query-builder-vs-raw-sql.md) — vì sao chọn ORM
- [Prisma relations & N+1](03-prisma-relations-and-n-plus-1.md) — `include` sinh bao nhiêu query
- [Prisma transactions](04-prisma-transactions.md) — nhiều statement trong một business operation
- [Prisma migrations](05-prisma-migrations-production.md) — đồng bộ schema với database
- [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — trần concurrency
- [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md) — cùng một lớp bug
- [Constraints & invariants](../03-data-modeling/01-constraints-invariants.md) — database bảo vệ gì
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — không trả entity thô
