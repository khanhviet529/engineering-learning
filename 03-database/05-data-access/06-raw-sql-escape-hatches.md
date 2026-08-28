---
level: intermediate
area: database
prerequisites:
  - 01-orm-vs-query-builder-vs-raw-sql.md
  - 02-prisma-model-and-client.md
related:
  - ../../05-cross-cutting/security/02-injection.md
  - ../00-sql/04-window-functions.md
---

# Raw SQL escape hatches

> Dùng raw SQL không phải thất bại của kiến trúc. Nó là **tính năng** của một ORM tốt: nó biết giới hạn của mình và để cửa mở.

*Baseline: Prisma 6.x, PostgreSQL.*

## Position

```text
Prisma Client (type-safe, 80–90% query)
      │
      └─ $queryRaw / $executeRaw     ← note này: cửa thoát có kiểm soát
              ↓
         SQL text → PostgreSQL
```

## Problem

Bạn cần bảng xếp hạng doanh thu theo tháng, có thứ hạng trong từng tháng:

```sql
WITH monthly AS (
  SELECT date_trunc('month', created_at) AS month, customer_id, SUM(total) AS revenue
  FROM orders WHERE status = 'paid'
  GROUP BY 1, 2
)
SELECT month, customer_id, revenue,
       RANK() OVER (PARTITION BY month ORDER BY revenue DESC) AS rank
FROM monthly;
```

Prisma **không diễn đạt được** query này. Không có `RANK()`, không có `PARTITION BY`, không có CTE.

Ba phản ứng, hai trong đó tệ:

| Phản ứng | Kết quả |
|---|---|
| Lấy hết dữ liệu về rồi tính trong JavaScript | tải 5 triệu dòng vào memory, chậm hơn 1000 lần |
| Ép bằng nhiều query + ghép thủ công | code phức tạp, vẫn chậm, vẫn sai |
| **Dùng raw SQL** | một query, database làm việc nó giỏi |

Lựa chọn thứ ba là đúng. Vấn đề chỉ là làm nó **an toàn**.

## Mental Model

```text
Prisma Client        → CRUD, quan hệ, transaction, type-safe
      ↓ khi không diễn đạt được
$queryRaw            → SELECT, trả về dòng
$executeRaw          → INSERT/UPDATE/DELETE/DDL, trả về số dòng ảnh hưởng
      ↓ KHÔNG BAO GIỜ
$queryRawUnsafe      → chỉ khi SQL được dựng từ nguồn bạn kiểm soát 100%
$executeRawUnsafe
```

Hai câu quyết định mọi thứ về an toàn:

> **Template literal của Prisma (`` $queryRaw`...${x}...` ``) tham số hoá giá trị. An toàn.**
>
> **`$queryRawUnsafe(string)` nhận SQL đã ghép. Chữ `Unsafe` trong tên là mô tả chính xác.**

Và câu hỏi để quyết định có nên dùng raw SQL:

> **Prisma có diễn đạt được điều này không? Nếu có, dùng Prisma. Nếu không, raw SQL — và ghi lý do.**

## How It Works

### An toàn: tham số hoá

```ts
// ✅ Tagged template — mỗi ${} thành một placeholder $1, $2...
const rows = await prisma.$queryRaw<Row[]>`
  SELECT id, title FROM tasks
  WHERE project_id = ${projectId} AND status = ${status}
  ORDER BY created_at DESC LIMIT ${limit}
`;
// SQL gửi đi: SELECT ... WHERE project_id = $1 AND status = $2 ... LIMIT $3
```

```ts
// ❌ Nối string — SQL injection
const rows = await prisma.$queryRawUnsafe(
  `SELECT * FROM tasks WHERE status = '${status}'`,
);
// status = "x' OR '1'='1" → trả về mọi dòng
// status = "x'; DROP TABLE tasks; --" → tệ hơn nhiều
```

### Nơi tham số hoá **không** hoạt động

Placeholder chỉ dùng được cho **giá trị**, không dùng được cho **định danh** (tên bảng, tên cột) hay **cấu trúc** (`ASC`/`DESC`, `ORDER BY`):

```ts
// ❌ Không hoạt động — PostgreSQL không nhận placeholder ở vị trí tên cột
await prisma.$queryRaw`SELECT * FROM tasks ORDER BY ${column} ${direction}`;

// ✅ Allowlist — map từ input sang giá trị bạn kiểm soát
const COLUMNS = { createdAt: 'created_at', dueDate: 'due_date', title: 'title' } as const;
const DIRS = { asc: 'ASC', desc: 'DESC' } as const;

const col = COLUMNS[input.sortBy];      // undefined nếu không hợp lệ
const dir = DIRS[input.order];
if (!col || !dir) throw new ValidationError('sortBy/order không hợp lệ');

// Giờ mới an toàn để nội suy, vì giá trị đến từ hằng số của bạn
const rows = await prisma.$queryRawUnsafe<Row[]>(
  `SELECT id, title FROM tasks WHERE project_id = $1 ORDER BY ${col} ${dir} LIMIT $2`,
  projectId, limit,
);
```

Đây là pattern quan trọng nhất trong note này: **`Unsafe` + allowlist + tham số cho giá trị**. `Unsafe` không có nghĩa "cấm dùng"; nó có nghĩa "compiler không bảo vệ bạn ở đây, nên bạn phải tự bảo vệ".

Xem [SQL injection](../../05-cross-cutting/security/02-injection.md) và [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md).

### Điều kiện động an toàn

Khi số điều kiện thay đổi, dùng `Prisma.sql` để ghép **có tham số hoá**:

```ts
import { Prisma } from '@prisma/client';

const conds: Prisma.Sql[] = [Prisma.sql`project_id = ${projectId}`];
if (filter.status)     conds.push(Prisma.sql`status = ${filter.status}`);
if (filter.assigneeId) conds.push(Prisma.sql`assignee_id = ${filter.assigneeId}`);
if (filter.since)      conds.push(Prisma.sql`created_at >= ${filter.since}`);

const rows = await prisma.$queryRaw<Row[]>`
  SELECT id, title, status FROM tasks
  WHERE ${Prisma.join(conds, ' AND ')}
  ORDER BY created_at DESC, id DESC
  LIMIT ${limit}
`;
```

`Prisma.join` giữ mọi giá trị ở dạng placeholder. Đây là cách dựng query động mà không bao giờ nối string.

### Type safety — bạn tự khai báo, không ai kiểm tra

```ts
type Row = { id: string; title: string; revenue: number };
const rows = await prisma.$queryRaw<Row[]>`SELECT id, title, revenue FROM ...`;
// TypeScript TIN bạn. Nếu SQL trả về cột khác, không ai báo.
```

Đây là chi phí thật của raw SQL, và nó cùng bản chất với [`as` trong TypeScript](../../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md): một lời hứa không được kiểm tra.

Hai cách giảm rủi ro:

```ts
// 1. Validate ở ranh giới bằng Zod — biến lời hứa thành kiểm tra thật
const RowSchema = z.object({
  id: z.string(),
  title: z.string(),
  revenue: z.coerce.number(),
});
const rows = RowSchema.array().parse(await prisma.$queryRaw(...));

// 2. TypedSQL (Prisma 5.19+, preview) — sinh type TỪ SQL, kiểm tra lúc build
// Cần previewFeatures = ["typedSql"], SQL đặt trong prisma/sql/*.sql
// Kiểm tra trạng thái GA cho version bạn dùng.
```

### Bẫy kiểu dữ liệu

Raw SQL bỏ qua tầng chuyển đổi kiểu của Prisma, nên bạn nhận kiểu thô từ driver:

| PostgreSQL | Prisma Client | `$queryRaw` |
|---|---|---|
| `BIGINT` | `BigInt` | `BigInt` — **`JSON.stringify` sẽ throw** |
| `NUMERIC`/`DECIMAL` | `Decimal` | `Decimal` hoặc string, tuỳ driver |
| `COUNT(*)` | — | **`BigInt`**, không phải `number` |
| `DATE` | `Date` | `Date` |
| `JSONB` | object | object |

`COUNT(*)` trả `BigInt` là bẫy gặp thường xuyên nhất:

```ts
const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
  SELECT COUNT(*) AS count FROM tasks`;

return { total: Number(count) };            // ✅ chuyển tường minh
// return { total: count };                  // ❌ JSON.stringify throw
```

Hoặc cast ngay trong SQL: `SELECT COUNT(*)::int AS count`.

### `$executeRaw` — cho ghi

```ts
// Bulk update: một câu thay vì N round-trip
const affected = await prisma.$executeRaw`
  UPDATE orders SET status = 'expired'
  WHERE status = 'pending' AND created_at < ${cutoff}
`;
logger.info({ affected }, 'expired stale orders');
```

Với 100.000 dòng, đây là một query ~vài giây; làm bằng vòng lặp Prisma là 100.000 round-trip.

`UPSERT` thật sự atomic — thứ `prisma.upsert` không đảm bảo:

```ts
await prisma.$executeRaw`
  INSERT INTO counters (key, value) VALUES (${key}, 1)
  ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
`;
```

### Raw SQL trong transaction

```ts
await prisma.$transaction(async (tx) => {
  // Dùng tx, KHÔNG dùng prisma
  await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id} FOR UPDATE`;
  await tx.account.update({ where: { id }, data: { balance: { decrement: amt } } });
});
```

`SELECT ... FOR UPDATE` chỉ có qua raw SQL — Prisma Client không có API cho pessimistic lock. Đây là một trong những lý do phổ biến nhất phải dùng raw SQL. Xem [Prisma transactions](04-prisma-transactions.md).

### Khi nào dùng raw SQL — danh sách cụ thể

```text
✅ Window function        RANK(), LAG(), SUM() OVER (...)
✅ Recursive CTE          cây, đồ thị, bill of materials
✅ DISTINCT ON            "dòng mới nhất của mỗi nhóm" (đặc thù PostgreSQL)
✅ LATERAL join           top-N cho mỗi nhóm
✅ Full-text search       tsvector, ts_rank, websearch_to_tsquery
✅ SELECT ... FOR UPDATE  pessimistic lock
✅ ON CONFLICT            upsert atomic thật
✅ Bulk operation         một UPDATE/DELETE thay vì N lần
✅ Analytics/report       aggregate nhiều tầng
✅ Query nóng cần tối ưu  khi cần kiểm soát chính xác plan
✅ JSONB nâng cao         jsonb_path_query, toán tử @>, ?

❌ CRUD thường            Prisma làm tốt hơn và an toàn hơn
❌ "vì tôi quen SQL hơn"  mất type safety mà không được gì
❌ Vì nghĩ ORM chậm       đo trước; overhead ORM hầu như không đáng kể
```

## Example

```ts
// Đóng gói raw SQL sau một method có tên nghiệp vụ, có validate output
export class RevenueRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Top khách hàng theo doanh thu mỗi tháng.
   * Raw SQL vì cần RANK() OVER — Prisma Client không diễn đạt được window function.
   */
  async monthlyTopCustomers(from: Date, limit = 10) {
    const rows = await this.prisma.$queryRaw`
      WITH monthly AS (
        SELECT date_trunc('month', created_at) AS month,
               customer_id,
               SUM(total)::float8 AS revenue
        FROM orders
        WHERE status = 'paid' AND created_at >= ${from}
        GROUP BY 1, 2
      ), ranked AS (
        SELECT *, RANK() OVER (PARTITION BY month ORDER BY revenue DESC) AS rank
        FROM monthly
      )
      SELECT month, customer_id, revenue, rank::int AS rank
      FROM ranked WHERE rank <= ${limit}
      ORDER BY month DESC, rank ASC
    `;
    return RowSchema.array().parse(rows);      // kiểm tra thật, không chỉ khai báo
  }
}
```

Ba chi tiết: comment **giải thích vì sao** cần raw SQL, `::float8`/`::int` cast trong SQL để tránh `Decimal`/`BigInt`, và Zod validate output.

## Prediction

1. `` $queryRaw`... WHERE status = ${input}` `` với `input = "x' OR '1'='1"` — có injection?
2. `$queryRawUnsafe("... WHERE status = '" + input + "'")` cùng input — có?
3. `SELECT COUNT(*) AS count`, rồi `res.json({ count })` — kết quả?
4. `$queryRaw<Row[]>` khai báo 3 field nhưng SQL trả 2 — lỗi ở đâu, lúc nào?
5. `$queryRaw` với `ORDER BY ${column}` dùng tagged template — hoạt động?
6. Update 100.000 dòng bằng vòng lặp Prisma vs một `$executeRaw` — chênh bao nhiêu?
7. `prisma.$queryRaw` (không phải `tx.$queryRaw`) bên trong `$transaction` — nó ở trong transaction?
8. `SELECT SUM(total)` trên cột `NUMERIC` — kiểu trả về trong JS?

<details>
<summary>Đáp án</summary>

1. Không — tagged template tham số hoá.
2. **Có** — injection thật.
3. `TypeError: Do not know how to serialize a BigInt`. Cần `Number(count)` hoặc `::int`.
4. Không lỗi compile, không lỗi runtime từ Prisma — chỉ `undefined` khi truy cập, ở nơi xa nguồn lỗi.
5. **Không** — placeholder không dùng được cho định danh; PostgreSQL báo lỗi cú pháp.
6. Hàng trăm lần (100.000 round-trip vs 1).
7. **Không** — connection khác, ngoài transaction.
8. `Decimal` (hoặc string) — không phải `number`. Cast `::float8` nếu muốn `number`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `$queryRawUnsafe` với `'; DROP TABLE x; --` | Injection (chỉ thử trên DB dùng một lần) |
| Cùng input với tagged template | An toàn — xem SQL trong query log |
| `SELECT COUNT(*)` rồi `JSON.stringify` | Throw về BigInt |
| Cast `::int`, làm lại | Hoạt động |
| Khai báo type sai cho `$queryRaw` | Không ai báo; `undefined` ở nơi khác |
| Thêm Zod parse | Lỗi rõ ràng, đúng chỗ |
| `ORDER BY ${col}` bằng tagged template | Lỗi cú pháp SQL |
| Vòng lặp update 10.000 dòng vs `$executeRaw` | Đo cả hai |
| `prisma.$queryRaw` trong `$transaction`, gây lỗi sau đó | Lệnh raw không rollback |
| Đổi tên cột trong DB, chạy raw SQL cũ | Lỗi runtime; không có lỗi compile |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Dùng raw SQL là thiết kế tồi | Là escape hatch hợp lệ; ORM tốt luôn có nó |
| `$queryRaw` không an toàn | Tagged template tham số hoá; `Unsafe` mới là nguy hiểm |
| Có thể tham số hoá tên cột | Chỉ giá trị; định danh cần allowlist |
| `$queryRaw<T>` kiểm tra kiểu trả về | Là lời hứa, như `as` |
| Raw SQL luôn nhanh hơn | Cùng SQL thì cùng tốc độ; index mới quyết định |
| `COUNT(*)` trả `number` | Trả `BigInt` |
| Raw SQL trong transaction tự động dùng transaction đó | Phải dùng `tx.$queryRaw` |
| Nên tránh raw SQL để giữ khả năng đổi database | Khả năng đó phần lớn là lý thuyết |

## Debugging

1. **Xem SQL thật gửi đi** qua query log — với raw SQL, nó cho thấy placeholder đã được tham số hoá đúng hay chưa. Đây là cách xác nhận an toàn, không phải đọc code.
2. **Lỗi kiểu khi serialize** → tìm `BigInt`/`Decimal`; cast trong SQL hoặc chuyển tường minh.
3. **Kết quả `undefined`** → so tên cột trong SQL với type khai báo. Alias trong SQL phải khớp chính xác tên field.
4. **Query chậm** → copy SQL từ log, chạy `EXPLAIN ANALYZE`. Với raw SQL bạn có lợi thế: SQL đã là thứ bạn viết. Xem [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).
5. **Audit injection** → `grep -rn "RawUnsafe" src/` và kiểm tra từng chỗ có allowlist chưa. Nên là một bước trong code review.
6. **Sau khi đổi schema** → grep các raw SQL chạm bảng/cột đó; không có compiler nào làm việc này cho bạn.

## Production Considerations

- **`grep` cho `RawUnsafe` trong CI** và yêu cầu comment giải thích ở mỗi chỗ dùng. Cân nhắc ESLint rule cấm nó ngoài một allowlist file.
- **Đóng gói raw SQL trong repository/service method có tên nghiệp vụ** — không rải `$queryRaw` khắp controller.
- **Comment lý do** ở mỗi raw SQL: "vì sao Prisma không đủ ở đây". Người sau cần biết.
- **Validate output bằng Zod** cho raw SQL trả về dữ liệu quan trọng.
- **Cast kiểu trong SQL** (`::int`, `::float8`) để tránh `BigInt`/`Decimal` rò rỉ vào tầng API.
- **Test raw SQL bằng integration test với database thật** — unit test với mock không phát hiện SQL sai. Xem [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md).
- **Sau mỗi migration đổi tên**, kiểm tra lại toàn bộ raw SQL.
- **`statement_timeout`** đặc biệt quan trọng cho analytics query.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Raw SQL cho query phức tạp | diễn đạt được mọi thứ, kiểm soát plan | mất type safety, refactor nguy hiểm |
| Ép bằng Prisma Client | type-safe | có thể không diễn đạt được, hoặc chậm |
| Tính trong JavaScript | không cần SQL | tải dữ liệu lớn, chậm hơn nhiều bậc |
| `$queryRaw` tagged template | an toàn, đủ cho hầu hết | không nội suy được định danh |
| `$queryRawUnsafe` + allowlist | linh hoạt tối đa | phải tự bảo đảm an toàn |
| Zod validate output | bắt lỗi đúng chỗ | thêm code và chi phí runtime nhỏ |
| TypedSQL (preview) | type sinh từ SQL | preview feature, thêm bước build |

## Explain Without Notes

1. Vì sao raw SQL không phải dấu hiệu kiến trúc tồi?
2. Tagged template an toàn ở đâu, và **không** dùng được ở đâu?
3. Pattern an toàn cho `ORDER BY` động — ba thành phần?
4. `$queryRaw<T>` cho type safety gì và **không** cho gì?
5. Kể 5 trường hợp Prisma không diễn đạt được.
6. Vì sao `COUNT(*)` gây lỗi khi trả về API?

## Related

- [ORM vs Query Builder vs Raw SQL](01-orm-vs-query-builder-vs-raw-sql.md) — khi nào chọn mức nào
- [Prisma model & client](02-prisma-model-and-client.md) — giới hạn của Prisma Client
- [Prisma transactions](04-prisma-transactions.md) — `FOR UPDATE` cần raw SQL
- [Repository pattern & testing](07-repository-pattern-testing.md) — nơi đóng gói raw SQL
- [SQL injection](../../05-cross-cutting/security/02-injection.md) — rủi ro chính
- [Window functions](../00-sql/04-window-functions.md) · [Subqueries & CTE](../00-sql/03-subqueries-cte.md)
- [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md)
- [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md) — test SQL thật
