---
level: intermediate
area: database
prerequisites:
  - ../00-sql/01-relational-thinking.md
  - ../00-sql/02-joins-aggregation.md
related:
  - 02-prisma-model-and-client.md
  - 06-raw-sql-escape-hatches.md
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# ORM vs Query Builder vs Raw SQL

> Ba mức trừu tượng cho cùng một việc: biến ý định của application thành SQL. Không cái nào thắng — và trong một codebase thật, bạn thường dùng cả ba.

## Position

```text
Domain logic (object, aggregate)
        ↓
[ ORM | Query Builder | Raw SQL ]   ← note này
        ↓
SQL text
        ↓
PostgreSQL (planner → index → disk)
```

## Problem

Application của bạn nghĩ bằng **object**:

```ts
const order = await getOrder(id);
order.addLine({ productId, qty: 2 });
order.applyDiscount(coupon);
await save(order);
```

Database nghĩ bằng **tập hợp**:

```text
bảng · dòng · khoá · quan hệ · tập kết quả
```

Khoảng cách giữa hai cách nghĩ này gọi là **impedance mismatch**. Nó không phải khái niệm học thuật — nó là năm vấn đề rất cụ thể:

| Vấn đề | Object | Relational |
|---|---|---|
| **Danh tính** | hai object khác nhau trong memory có thể cùng một dòng DB | dòng được định danh bởi khoá chính |
| **Quan hệ** | `order.lines` là một mảng, đi theo con trỏ | JOIN, hoặc query thứ hai |
| **Kế thừa** | `CreditCardPayment extends Payment` | không có kế thừa; phải chọn single-table / class-table / concrete-table |
| **Granularity** | `Money { amount, currency }` là một object | hai cột |
| **Thời điểm nạp** | truy cập `.lines` là tức thì | phải quyết định nạp lúc nào, và đó là nguồn của N+1 |

Ba công cụ trong note này là ba câu trả lời khác nhau cho cùng năm vấn đề đó — và mỗi câu trả lời giấu một phần khác nhau.

## Mental Model

Trục duy nhất cần nhớ: **bạn nhượng bao nhiêu quyền kiểm soát để đổi lấy bao nhiêu tiện lợi.**

```text
                 ít kiểm soát                              nhiều kiểm soát
                 nhiều tiện lợi                            ít tiện lợi
    ORM ──────────── Query Builder ──────────── Raw SQL
     │                    │                        │
  nghĩ bằng object    nghĩ bằng SQL,           nghĩ bằng SQL,
  SQL bị che          cú pháp là TS            viết SQL
     │                    │                        │
  "cho tôi order        "SELECT ... JOIN"      "WITH RECURSIVE ..."
   kèm lines"           có type                 planner hint, CTE
```

Ba câu chốt định hình mọi quyết định về sau:

> **ORM không loại bỏ SQL.** Nó sinh SQL. Bạn vẫn phải đọc được SQL nó sinh ra, vì đó là thứ chạy trên database.
>
> **ORM không tự tạo query tốt.** Nó tạo query *đúng*. Query đúng mà không có index vẫn là seq scan trên 5 triệu dòng.
>
> **ORM không thay thế kiến thức database.** Nó dịch cú pháp, không dịch hiểu biết về index, isolation, lock, query plan.

Ba câu này là lý do folder này nằm trong `03-database/` chứ không nằm trong `02-backend-api/`: data access là một chủ đề **database**, chỉ tình cờ được viết bằng TypeScript.

## How It Works

### ORM — nghĩ bằng object

```ts
// Prisma
const order = await prisma.order.findUnique({
  where: { id },
  include: { lines: { include: { product: true } }, customer: true },
});
```

**Cho bạn:**

- **Mapping tự động** — dòng → object có type, không viết code chuyển đổi.
- **Type safety sinh từ schema** — đổi tên cột trong schema là lỗi compile ở mọi call site. Đây là lợi ích lớn nhất và bị đánh giá thấp nhất.
- **Quan hệ khai báo được** — `include` thay cho JOIN viết tay.
- **Migration có lịch sử** — schema là code, có version.
- **Một API cho nhiều database** (ở mức hạn chế).

**Không cho bạn:**

- Query phức tạp: window function, recursive CTE, `LATERAL`, `DISTINCT ON`, full-text search với ranking.
- Quyền kiểm soát chính xác SQL sinh ra.
- Tính năng riêng của PostgreSQL (`GENERATED`, exclusion constraint, `tsvector`, `jsonb_path_query`).

**Abstraction leak** — chỗ trừu tượng bị vỡ và bạn buộc phải nghĩ bằng SQL trở lại:

| Leak | Biểu hiện |
|---|---|
| N+1 | code đọc rất tự nhiên, sinh 1 + N query |
| Lazy vs eager | không biết query chạy lúc nào |
| Transaction boundary | quên mở transaction cho một business operation |
| Index | ORM không nhắc bạn cần index nào |
| Bulk operation | update 100.000 dòng bằng vòng lặp thay vì một câu UPDATE |
| Query plan | không thấy được nếu không bật log |

Xem [Prisma relations & N+1](03-prisma-relations-and-n-plus-1.md).

### Query Builder — nghĩ bằng SQL, viết bằng TypeScript

```ts
// Kysely — cú pháp phản chiếu SQL gần như 1:1
const rows = await db
  .selectFrom('orders as o')
  .innerJoin('customers as c', 'c.id', 'o.customer_id')
  .select(['o.id', 'o.total', 'c.name'])
  .where('o.status', '=', 'paid')
  .where('o.created_at', '>', since)
  .orderBy('o.created_at', 'desc')
  .limit(20)
  .execute();
```

**Cho bạn:**

- **Minh bạch** — đọc code là biết SQL sinh ra. Không có lazy loading ẩn, không có N+1 ẩn.
- **Type safety** trên tên bảng, tên cột, và cả kiểu của kết quả.
- **Compose được** — ghép điều kiện động mà không nối string.
- **Tiếp cận được gần hết SQL** — CTE, window function, subquery.

**Không cho bạn:**

- Mapping object/quan hệ tự động — kết quả là dòng phẳng; nested object phải tự dựng.
- Migration (Kysely có migration, nhưng không sinh từ schema).
- Change tracking, unit of work.

Query builder là điểm cân bằng bị bỏ qua nhiều nhất. Nó xoá gần hết nhược điểm "SQL bị che" của ORM mà giữ được type safety — nhưng bạn mất mapping và phải viết nhiều hơn.

### Raw SQL — viết SQL

```ts
const rows = await prisma.$queryRaw<RevenueRow[]>`
  WITH monthly AS (
    SELECT date_trunc('month', created_at) AS month,
           customer_id,
           SUM(total) AS revenue
    FROM orders
    WHERE status = 'paid' AND created_at >= ${since}
    GROUP BY 1, 2
  )
  SELECT month, customer_id, revenue,
         RANK() OVER (PARTITION BY month ORDER BY revenue DESC) AS rank
  FROM monthly
  WHERE revenue > ${threshold}
`;
```

**Cho bạn:** toàn quyền — mọi tính năng của PostgreSQL, query plan dự đoán được, tối ưu được tới mức cuối.

**Không cho bạn:** type safety (bạn *khai báo* `RevenueRow`, không ai kiểm tra), refactor an toàn (đổi tên cột không gây lỗi compile), bảo vệ khỏi injection nếu nối string.

Xem [Raw SQL escape hatches](06-raw-sql-escape-hatches.md).

### So sánh trên cùng một bài toán

Lấy "20 order mới nhất của khách hàng, kèm số dòng hàng":

```ts
// ORM — ngắn nhất, nhưng nếu dùng include cho _count thì cần biết cú pháp riêng
await prisma.order.findMany({
  where: { customerId },
  include: { _count: { select: { lines: true } } },
  orderBy: { createdAt: 'desc' },
  take: 20,
});

// Query Builder — thấy rõ SQL, kiểm soát được subquery
await db.selectFrom('orders as o')
  .select(['o.id', 'o.total',
    (eb) => eb.selectFrom('order_lines as l')
      .select(eb.fn.countAll().as('c'))
      .whereRef('l.order_id', '=', 'o.id').as('line_count')])
  .where('o.customer_id', '=', customerId)
  .orderBy('o.created_at', 'desc').limit(20).execute();

// Raw SQL — kiểm soát tuyệt đối
await prisma.$queryRaw`
  SELECT o.id, o.total, COUNT(l.id) AS line_count
  FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
  WHERE o.customer_id = ${customerId}
  GROUP BY o.id ORDER BY o.created_at DESC LIMIT 20`;
```

Cả ba đều đúng. Cả ba đều **cần cùng một index** `(customer_id, created_at DESC)`. Đây là điểm quan trọng nhất của cả note: **chọn công cụ không ảnh hưởng tới việc bạn phải hiểu index.**

## Decision framework

Bảy tiêu chí, không phải một:

| Tiêu chí | ORM | Query Builder | Raw SQL |
|---|---|---|---|
| **Độ phức tạp query** | CRUD, quan hệ đơn giản | JOIN nhiều bảng, aggregate | window, recursive CTE, analytics |
| **Kinh nghiệm team** | SQL yếu → ORM đỡ | SQL khá | SQL tốt |
| **Nhu cầu hiệu năng** | đủ cho phần lớn | tốt | tối ưu được tới cùng |
| **Tính năng riêng của DB** | hạn chế | phần lớn | toàn bộ |
| **Type safety** | cao nhất (sinh từ schema) | cao | thấp (tự khai báo) |
| **Maintainability** | tốt khi schema đổi | tốt | đổi tên cột không ai bắt |
| **Debuggability** | phải bật log mới thấy SQL | đọc code là thấy | thấy ngay |

### Khi nào dùng gì

```text
ORM — mặc định cho 80–90% query của một app CRUD
  ✓ CRUD theo khoá chính, theo quan hệ đơn giản
  ✓ nested write trong một transaction
  ✓ nơi type safety và refactor an toàn quan trọng hơn tối ưu 20ms

Query Builder — khi SQL bắt đầu là chủ thể
  ✓ report có nhiều JOIN và điều kiện động
  ✓ filter/sort do người dùng chọn (allowlist), cần compose an toàn
  ✓ bạn muốn thấy SQL nhưng không muốn mất type safety

Raw SQL — khi cần thứ ORM không diễn đạt được
  ✓ window function, recursive CTE, LATERAL, DISTINCT ON
  ✓ analytics, báo cáo
  ✓ full-text search có ranking
  ✓ bulk operation (một UPDATE thay vì N lần)
  ✓ query nóng cần tối ưu theo query plan
```

### Trộn cả ba — đây là trạng thái bình thường

```ts
class OrderService {
  // ORM: CRUD
  findById(id: string) {
    return this.prisma.order.findUnique({ where: { id }, include: { lines: true } });
  }

  // Raw SQL: analytics — ORM không diễn đạt được
  monthlyRevenue(from: Date) {
    return this.prisma.$queryRaw<Row[]>`SELECT ... RANK() OVER (...) ...`;
  }

  // Raw SQL: bulk — một câu thay vì N lần round-trip
  async expireStale(before: Date) {
    return this.prisma.$executeRaw`
      UPDATE orders SET status = 'expired'
      WHERE status = 'pending' AND created_at < ${before}`;
  }
}
```

Đây **không** phải kiến trúc thất bại. Nó là dùng đúng công cụ cho từng việc, sau một ranh giới thống nhất (service). Điều cần tránh không phải là trộn, mà là **trộn không có lý do rõ ràng** — mỗi lần dùng raw SQL nên trả lời được "vì sao ORM không đủ ở đây".

## Prediction

1. `prisma.order.findMany({ include: { lines: true } })` cho 100 order — bao nhiêu SQL query được gửi? (Trả lời sau khi đọc [note 03](03-prisma-relations-and-n-plus-1.md) nếu chưa chắc.)
2. Bạn đổi tên cột `total` → `amount` trong schema. Với ORM thì bao nhiêu chỗ báo lỗi compile? Với raw SQL?
3. Cùng một query viết bằng ORM và bằng raw SQL, cùng thiếu index — cái nào nhanh hơn?
4. `$queryRaw` với `${userInput}` dùng template literal của Prisma — có bị SQL injection?
5. Cùng câu đó nhưng viết `$queryRawUnsafe('... ' + userInput)` — có bị không?
6. Team không ai đọc được `EXPLAIN ANALYZE`. Chuyển từ raw SQL sang ORM có làm query nhanh hơn?

<details>
<summary>Đáp án</summary>

1. Thường **2** — Prisma tách thành một query `orders` và một query `order_lines WHERE order_id IN (...)`. Không phải 101, cũng không phải 1 JOIN. Chi tiết ở note 03.
2. ORM: mọi call site đọc field đó → lỗi compile. Raw SQL: **không chỗ nào** → lỗi runtime khi query chạy.
3. Như nhau — cả hai sinh ra SQL tương đương và cùng bị seq scan. Công cụ không thay thế index.
4. Không — template tag của Prisma tham số hoá giá trị.
5. Có — `Unsafe` trong tên là cảnh báo thật.
6. Không. Đây là điểm của ba câu chốt: ORM dịch cú pháp, không dịch hiểu biết.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bật query log, chạy một endpoint list có quan hệ | Đếm số query thật — thường nhiều hơn dự đoán |
| Viết vòng lặp `for (const u of users) await prisma.post.findMany({ where: { userId: u.id } })` | N+1 kinh điển; đo thời gian với 100 user |
| Seed 1M dòng, query bằng cả ba công cụ, không index | Cả ba chậm như nhau |
| Thêm index, đo lại cả ba | Cả ba nhanh như nhau |
| Đổi tên cột trong schema, build lại | ORM báo lỗi; raw SQL im lặng tới runtime |
| `$queryRawUnsafe` với input `'; DROP TABLE orders; --` | Injection (thử trên DB dùng một lần) |
| Viết window function bằng ORM | Không diễn đạt được — hiểu vì sao cần escape hatch |
| Update 100.000 dòng bằng vòng lặp ORM vs một `$executeRaw` | Chênh nhau hàng trăm lần |

Thí nghiệm 3 và 4 cạnh nhau là thí nghiệm quan trọng nhất trong note này.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| ORM nghĩa là không cần biết SQL | Bạn cần đọc được SQL nó sinh ra để debug |
| ORM chậm hơn raw SQL | Overhead ORM thường là micro-giây; nút thắt là index và số round-trip |
| ORM tự tối ưu query | Nó tạo query đúng, không phải query nhanh |
| Dùng raw SQL là dấu hiệu thiết kế tồi | Là escape hatch hợp lệ và cần thiết |
| Query builder là "ORM nhẹ" | Nó ở tầng khác: không mapping, không migration, nhưng minh bạch hơn |
| Phải chọn một công cụ cho cả project | Trộn có chủ đích là bình thường |
| ORM giúp đổi database dễ dàng | Trên lý thuyết; thực tế query và tính năng đã gắn với một DB |
| Type safety của raw SQL bằng ORM nếu khai báo type | Khai báo là lời hứa, không phải kiểm tra |

## Debugging

1. **Luôn bật query log trước tiên.** Không thấy SQL thì mọi phán đoán về hiệu năng là đoán.
   ```ts
   new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
     .$on('query', (e) => logger.debug({ sql: e.query, ms: e.duration, params: e.params }));
   ```
2. **Đếm số query cho một request.** Con số này gây bất ngờ thường xuyên hơn thời gian của từng query.
3. **Lấy SQL sinh ra rồi chạy `EXPLAIN ANALYZE` thủ công.** Đây là bước nối giữa "ORM chậm" và nguyên nhân thật. Xem [EXPLAIN ANALYZE workflow](../01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).
4. **So thời gian trong log của ORM với thời gian query trong DB** — chênh lệch lớn nghĩa là vấn đề ở network, pool, hoặc serialization, không ở query.
5. Nếu SQL sinh ra hợp lý mà vẫn chậm → vấn đề là **index hoặc dữ liệu**, không phải công cụ.

## Production Considerations

- **Bật query log ở dev, sampling ở production** (log query chậm hơn ngưỡng). Không log mọi query ở production — nó tốn I/O và có thể lộ dữ liệu.
- **Đặt `statement_timeout`** ở database để một query xấu không giữ connection mãi.
- **Đo số query mỗi request** như một metric; tăng bất thường là dấu hiệu N+1 mới xuất hiện.
- **Allowlist cho filter/sort động** bất kể công cụ nào — xem [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md).
- **Không nối string** để dựng SQL. Query builder hoặc tham số hoá.
- **Connection pool là trần thực tế của mọi concurrency** ở tầng này. Xem [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md).
- Quyết định công cụ nên ghi vào ADR: người sau cần biết vì sao có ba cách truy cập dữ liệu trong cùng codebase.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| ORM làm mặc định | tốc độ phát triển, type safety, refactor an toàn | SQL bị che, dễ N+1, giới hạn tính năng DB |
| Query builder làm mặc định | minh bạch + type safety | phải tự map nested, viết nhiều hơn |
| Raw SQL làm mặc định | kiểm soát tối đa | mất type safety, refactor nguy hiểm, nhiều boilerplate |
| Trộn cả ba | đúng công cụ cho từng việc | cần kỷ luật về ranh giới, người mới khó định hướng |
| Chỉ một công cụ | nhất quán, dễ onboard | phải chịu điểm yếu của nó ở mọi trường hợp |

## Explain Without Notes

1. Impedance mismatch là gì? Nêu 3 trong 5 biểu hiện cụ thể.
2. Ba điều ORM **không** làm được?
3. Query builder khác ORM ở hai điểm nào — nó có gì và mất gì?
4. Cùng một query thiếu index, viết bằng ORM và raw SQL — cái nào nhanh hơn, vì sao?
5. Bảy tiêu chí của decision framework?
6. Vì sao trộn cả ba công cụ không phải dấu hiệu thiết kế tồi?

## Related

- [Prisma model & client](02-prisma-model-and-client.md) — ORM cụ thể của repo này
- [Prisma relations & N+1](03-prisma-relations-and-n-plus-1.md) — abstraction leak lớn nhất
- [Raw SQL escape hatches](06-raw-sql-escape-hatches.md) — khi nào và cách bypass an toàn
- [Repository pattern & testing](07-repository-pattern-testing.md) — có cần thêm một tầng nữa?
- [Relational thinking](../00-sql/01-relational-thinking.md) — nghĩ bằng tập hợp
- [Window functions](../00-sql/04-window-functions.md) — thứ ORM không diễn đạt được
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — công cụ nào cũng cần index
- [SQL injection](../../05-cross-cutting/security/02-injection.md) — rủi ro của nối string
- [Controller–Service–Repository](../../02-backend-api/04-architecture/01-controller-service-repository.md) — data access nằm ở tầng nào
