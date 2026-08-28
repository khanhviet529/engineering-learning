# Data Access

Tầng giữa application và database. Nó nằm trong `03-database/` chứ không phải `02-backend-api/` vì đây là chủ đề **database** — chỉ tình cờ được viết bằng TypeScript.

Nguyên tắc của folder này: **pattern trước tool**. Note 01 dạy bài toán và ba mức trừu tượng; các note sau dạy Prisma như một *instance* của mức "ORM". Nếu bạn nhảy vào note 02 trước, Prisma sẽ trông như một tập API cần ghi nhớ thay vì một lựa chọn có đánh đổi.

*Baseline: Prisma 6.x, PostgreSQL. Tính năng còn ở trạng thái preview được ghi rõ trong từng note.*

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [ORM vs Query Builder vs Raw SQL](01-orm-vs-query-builder-vs-raw-sql.md) | Impedance mismatch là gì, và ba mức trừu tượng đổi gì lấy gì? |
| 2 | [Prisma: schema và client](02-prisma-model-and-client.md) | Vì sao code compile sạch mà chết lúc runtime? |
| 3 | [Prisma relations & N+1](03-prisma-relations-and-n-plus-1.md) | `include` sinh bao nhiêu query — 2 hay 101? |
| 4 | [Prisma transactions](04-prisma-transactions.md) | Transaction bao đúng cái gì, và vì sao không gọi API bên ngoài trong đó? |
| 5 | [Prisma migrations production](05-prisma-migrations-production.md) | Đổi schema mà không downtime và không mất dữ liệu? |
| 6 | [Raw SQL escape hatches](06-raw-sql-escape-hatches.md) | Khi nào bypass ORM, và làm sao cho an toàn? |
| 7 | [Repository pattern & testing](07-repository-pattern-testing.md) | Có cần bọc Prisma trong repository không? |

Note 1 là nền. Note 3 và 4 là hai nơi bug production thường nằm. Note 5 là nơi rủi ro mất dữ liệu cao nhất.

## Ba câu chốt về ORM

Ba câu này giải thích vì sao folder này tồn tại, và vì sao nó không thay thế được kiến thức PostgreSQL:

1. **ORM không loại bỏ SQL** — nó *sinh* SQL. Bạn vẫn phải đọc được SQL nó sinh ra để debug.
2. **ORM không tự tạo query tốt** — nó tạo query *đúng*. Query đúng mà thiếu index vẫn là seq scan trên 5 triệu dòng.
3. **ORM không thay thế kiến thức database** — nó dịch cú pháp, không dịch hiểu biết về index, isolation, lock, query plan.

## Bảy hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| `include` gây N+1 | Prisma tự batch; vòng lặp `await` mới gây | [3](03-prisma-relations-and-n-plus-1.md) |
| `Promise.all` sửa được N+1 | Vẫn N query, và làm cạn connection pool | [3](03-prisma-relations-and-n-plus-1.md) |
| Mỗi lệnh Prisma có transaction nên đủ | Mỗi lệnh có transaction *riêng*, không nguyên tử với nhau | [4](04-prisma-transactions.md) |
| `migrate dev` và `migrate deploy` tương đương | `dev` có thể **reset database** | [5](05-prisma-migrations-production.md) |
| `db push` là "migrate nhanh" | Không tạo lịch sử; chỉ cho DB dùng-một-lần | [5](05-prisma-migrations-production.md) |
| Dùng raw SQL là thiết kế tồi | Là escape hatch hợp lệ của một ORM tốt | [6](06-raw-sql-escape-hatches.md) |
| Repository luôn là kiến trúc tốt | Nếu chỉ chuyển tiếp 1:1, nó là nợ | [7](07-repository-pattern-testing.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Endpoint chậm tuyến tính theo số dòng | N+1 → [3](03-prisma-relations-and-n-plus-1.md) |
| `P2024` pool timeout | transaction dài, hoặc `Promise.all` không giới hạn → [4](04-prisma-transactions.md), [3](03-prisma-relations-and-n-plus-1.md) |
| `P2028` | transaction timeout → [4](04-prisma-transactions.md) |
| `P2034` | write conflict / deadlock — **cần retry** → [4](04-prisma-transactions.md) |
| `P2025` | record không tồn tại (`update`/`delete` throw) → [2](02-prisma-model-and-client.md) |
| `column does not exist` dù compile sạch | schema lệch database → [2](02-prisma-model-and-client.md), [5](05-prisma-migrations-production.md) |
| `too many connections` | nhiều `PrismaClient`, hoặc pool size × số pod quá lớn → [2](02-prisma-model-and-client.md) |
| `Do not know how to serialize a BigInt` | `COUNT(*)` từ raw SQL → [6](06-raw-sql-escape-hatches.md) |
| Item lặp giữa các trang | thiếu tie-breaker trong `orderBy` → [3](03-prisma-relations-and-n-plus-1.md) |
| Dữ liệu không nhất quán sau lỗi | thiếu transaction bao quanh → [4](04-prisma-transactions.md) |
| Test pass nhưng query production sai | mock quá sâu → [7](07-repository-pattern-testing.md) |
| `idle in transaction` trong `pg_stat_activity` | network call trong transaction → [4](04-prisma-transactions.md) |

## Hai thói quen quan trọng nhất

**1. Bật query log và đếm số query.** Không thấy SQL thì mọi phán đoán về hiệu năng là đoán.

```ts
new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
  .$on('query', (e) => logger.debug({ sql: e.query, ms: e.duration }));
```

**2. Đo với latency giống production.** N+1 **không tái hiện được** trên localhost — database local có latency 0,2ms nên 100 query chỉ mất 20ms. Thêm latency giả là cách duy nhất thấy nó trước khi production thấy.

## Position

```text
Controller → Service → [ Prisma Client | raw SQL ] → PostgreSQL
                              ↑ folder này
```

## Related

- [00-sql/](../00-sql/README.md) — SQL là thứ mọi công cụ ở đây sinh ra
- [01-postgresql/](../01-postgresql/README.md) — index, transaction, MVCC: không công cụ nào thay thế được
- [03-data-modeling/](../03-data-modeling/README.md) — constraint và schema design
- [04-architecture/](../../02-backend-api/04-architecture/README.md) — data access nằm ở tầng nào
- [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — trần thực tế của mọi concurrency ở tầng này
- [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — lý thuyết cursor và index
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md)
- [06-mongodb/](../06-mongodb/README.md) — mô hình dữ liệu khác, bài toán data access khác
