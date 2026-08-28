---
level: intermediate
area: database
prerequisites:
  - 01-constraints-invariants.md
related:
  - ../01-postgresql/indexes-query-planning/02-index-types.md
  - ../../02-backend-api/00-http-api/02-rest-api-contract.md
---

# ID strategy: serial vs UUIDv4 vs UUIDv7

> UUIDv4 làm ghi rải khắp index. Đây là lý do một hệ thống chậm dần theo tháng mà `EXPLAIN` vẫn nói "Index Scan" — và gần như không ai nghi kiểu khoá chính.

## Position

```text
Chọn kiểu ID
      ↓
cách ghi vào B-tree → phân mảnh index → WAL → tốc độ ghi
      ↓
và: đoán được không? lộ thông tin gì? sinh ở đâu?
```

## Problem

Bạn chọn khoá chính ở migration đầu tiên, trong 10 giây, và không nghĩ lại. Ba năm sau:

```text
Chọn serial          → khách hàng thấy /orders/1042 và đoán /orders/1043
                     → và biết bạn có ~1000 đơn hàng
Chọn UUIDv4          → sau 20 triệu dòng, INSERT chậm dần
                     → index 3× lớn hơn cần thiết, WAL phình
Chọn nào cũng được?  → không. Đây là quyết định gần như không đổi được
```

Đổi kiểu khoá chính trên bảng có dữ liệu và có foreign key trỏ tới là một dự án nhiều tuần, không phải một migration.

## Mental Model

B-tree là cấu trúc **được sắp xếp**. Kiểu ID quyết định bạn ghi **vào đâu** trong cấu trúc đó:

```text
serial / bigserial / UUIDv7 / ULID  — TĂNG DẦN
  ┌───┬───┬───┬───┬───┐
  │   │   │   │   │ ← │  luôn ghi vào trang cuối
  └───┴───┴───┴───┴───┘
  → trang cuối nằm trong RAM (vừa dùng) → không đọc disk
  → trang đầy rồi mới tạo trang mới → không split giữa
  → fill factor gần 100%

UUIDv4 — NGẪU NHIÊN
  ┌───┬───┬───┬───┬───┐
  │ ← │   │ ← │   │ ← │  ghi vào chỗ ngẫu nhiên
  └───┴───┴───┴───┴───┘
  → phải ĐỌC trang đó từ disk trước khi ghi (random read)
  → trang đầy → PAGE SPLIT → index phình
  → mỗi lần ghi làm dirty một trang khác → WAL nhiều hơn
```

Ba hệ quả của UUIDv4, và chúng cộng dồn:

| Hệ quả | Vì sao |
|---|---|
| **INSERT chậm dần** | mỗi ghi là một random read; càng nhiều dữ liệu, càng ít khả năng trang đó trong cache |
| **Index lớn hơn 2–3×** | page split để lại trang nửa rỗng |
| **WAL phình** | mỗi lần dirty một trang là một full-page write |

Và điều quan trọng: **`EXPLAIN` không cho bạn thấy điều này.** Query đọc vẫn "Index Scan". Vấn đề nằm ở **ghi** và ở **kích thước index** — hai thứ không xuất hiện trong query plan.

## So sánh ba lựa chọn

| | `bigserial` | `uuid` v4 | `uuid` v7 / ULID |
|---|---|---|---|
| Kích thước | 8 byte | 16 byte | 16 byte |
| Ghi vào index | tuần tự ✅ | **ngẫu nhiên ❌** | tuần tự ✅ |
| Sinh ở đâu | **chỉ database** | client hoặc server | client hoặc server |
| Đoán được? | **có ❌** | không ✅ | một phần (timestamp) |
| Lộ số lượng? | **có ❌** | không ✅ | không ✅ |
| Sortable theo thời gian | có | **không ❌** | có ✅ |
| Merge 2 database | **xung đột ❌** | an toàn ✅ | an toàn ✅ |
| Offline-first / client sinh trước | **không ❌** | có ✅ | có ✅ |
| Hỗ trợ sẵn | mọi nơi | mọi nơi | **cần thư viện** |

Đọc bảng này theo nghĩa: `bigserial` thắng về hiệu năng và kích thước; UUIDv4 thắng về bảo mật và phân tán; **UUIDv7 lấy được gần hết cả hai**.

### Vì sao UUIDv7 giải quyết được

```text
UUIDv7:  0190a3f2-1c4b-7000-8000-1a2b3c4d5e6f
         └────┬────┘
         48 bit timestamp (millisecond) ở ĐẦU
         → so sánh byte-wise ≈ so sánh thời gian
         → ghi tuần tự vào B-tree như serial
         → 74 bit còn lại là random → không đoán được ID kế tiếp
```

Đánh đổi còn lại: nó **tiết lộ thời điểm tạo**. Với phần lớn dữ liệu điều đó vô hại (bạn đã có `created_at`). Với dữ liệu mà thời điểm tạo là bí mật (ví dụ ID của một báo cáo nội bộ), dùng UUIDv4.

## How It Works

### Trong PostgreSQL

```sql
-- bigserial: tuần tự, 8 byte
CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  ...
);

-- UUIDv4: PostgreSQL 13+ có sẵn gen_random_uuid()
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);

-- UUIDv7: PostgreSQL 18 có uuidv7() built-in.
-- Với PG 16/17 (baseline của repo này): sinh ở APPLICATION, hoặc dùng extension.
CREATE TABLE orders (
  id uuid PRIMARY KEY,          -- KHÔNG có DEFAULT: app truyền vào
  ...
);
```

*Kiểm tra version PostgreSQL của bạn — `uuidv7()` là tính năng mới; với PG ≤ 17 thì sinh ở application là cách thực dụng nhất.*

### Với Prisma

```prisma
// bigserial
model Order {
  id BigInt @id @default(autoincrement())
}

// UUIDv4
model Order {
  id String @id @default(uuid()) @db.Uuid
}

// UUIDv7 — Prisma 6.x hỗ trợ uuid(7); kiểm tra version bạn dùng
model Order {
  id String @id @default(uuid(7)) @db.Uuid
}
```

Hai chi tiết dễ bỏ:

- **`@db.Uuid`** là bắt buộc. Không có nó, Prisma dùng `text` — 36 byte thay vì 16, và mất kiểm tra định dạng của database.
- **`BigInt` trong JavaScript không serialize được bằng `JSON.stringify`.** Nếu dùng `autoincrement()` với `BigInt`, mọi response API phải convert. Đây là lý do nhiều dự án dùng `Int` (giới hạn ~2,1 tỉ) hoặc chuyển sang UUID.

### Sinh ID ở client — lợi ích bị bỏ qua

```ts
// Client sinh ID TRƯỚC khi gọi API
const id = uuidv7();

// 1. Optimistic UI: render ngay, không cần chờ server trả ID
addOptimistic({ id, title, pending: true });

// 2. Idempotency miễn phí: retry với cùng ID → unique constraint chặn trùng
await api.createTask({ id, title });   // gọi 3 lần vẫn 1 record
```

Đây là lợi ích thực tế lớn nhất của UUID mà `serial` không có: **client biết ID trước khi ghi**. Nó làm optimistic update đơn giản hơn (không phải map ID tạm → ID thật) và cho idempotency mà không cần bảng riêng. Xem [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md).

### ID công khai vs ID nội bộ — cách có cả hai

Nếu bạn muốn hiệu năng của `bigserial` **và** không lộ thông tin:

```sql
CREATE TABLE orders (
  id          bigserial PRIMARY KEY,              -- nội bộ: FK, JOIN, index
  public_id   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- API dùng cái này
  ...
);
CREATE UNIQUE INDEX ON orders (public_id);
```

- FK và JOIN dùng `id` 8 byte → index nhỏ, ghi tuần tự.
- API chỉ trả `public_id` → không đoán được, không lộ số lượng.

Giá phải trả: một index nữa, và mọi lookup từ API là một lần tra `public_id` → `id`.

Biến thể nhẹ hơn: giữ `bigserial` nhưng **mã hoá** khi trả ra (Sqids/Hashids) — `1042` → `"Xk3n9"`. Lưu ý: đây là **obfuscation, không phải bảo mật** — nó không thay thế authorization. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).

### Quy ước ở tầng API

Bất kể kiểu ID trong database, **API luôn trả string**:

```json
{ "id": "1042" }        // ✅ kể cả khi DB dùng bigserial
{ "id": 1042 }          // ❌
```

Lý do: JavaScript mất chính xác với số > 2⁵³, và đổi từ `serial` sang UUID về sau không phá client. Xem [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md).

## Example

```text
Quyết định theo bảng — không dùng một kiểu cho mọi bảng

users, orders, payments        → UUIDv7
  ID xuất hiện trong URL, không được đoán, client cần sinh trước

audit_log, events, metrics     → bigserial
  chỉ nội bộ, không bao giờ ra API, khối lượng lớn → 8 byte quan trọng
  và tuần tự là lý tưởng cho append-only

bảng nối (task_tags)           → composite PK (task_id, tag_id)
  không cần ID riêng

lookup nhỏ (countries, roles)  → text PK ('VN', 'admin')
  ý nghĩa rõ, không cần JOIN để đọc tên
```

Hàng cuối đáng chú ý: với bảng tra cứu nhỏ và ổn định, khoá chính dạng text (`'VN'`) làm nhiều query **không cần JOIN** — bạn đọc được giá trị ngay từ bảng con.

## Prediction

1. Bảng 50 triệu dòng, khoá chính UUIDv4 — INSERT nhanh hơn hay chậm hơn so với lúc 1 triệu dòng?
2. Cùng bảng với `bigserial` — có chậm dần không?
3. `EXPLAIN` một `SELECT ... WHERE id = ?` trên bảng UUIDv4 — có thấy dấu hiệu vấn đề không?
4. UUIDv4 vs UUIDv7 trên cùng workload ghi — index nào lớn hơn?
5. Prisma `@default(uuid())` **không** có `@db.Uuid` — cột là kiểu gì, bao nhiêu byte?
6. `bigserial` + `BigInt` trong Prisma, trả về API bằng `res.json()` — kết quả?
7. Client sinh UUIDv7 rồi retry request 3 lần với cùng ID, có unique constraint — bao nhiêu record?
8. Merge database của 2 chi nhánh, cả hai dùng `bigserial` — vấn đề gì?

<details>
<summary>Đáp án</summary>

1. **Chậm hơn** — càng nhiều dữ liệu, càng ít khả năng trang ngẫu nhiên đó nằm trong cache.
2. Gần như không — luôn ghi vào trang cuối, vốn đang trong RAM.
3. **Không** — plan vẫn là Index Scan. Vấn đề ở *ghi* và *kích thước index*, không ở plan đọc.
4. UUIDv4 — page split để lại trang nửa rỗng.
5. `text`, 36 byte thay vì 16, và mất kiểm tra định dạng.
6. `TypeError: Do not know how to serialize a BigInt`.
7. Một — unique constraint chặn hai lần sau. Idempotency miễn phí.
8. ID trùng nhau ở cả hai bên — phải remap toàn bộ FK.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Seed 5M dòng với UUIDv4, đo thời gian mỗi 500k | Thời gian INSERT tăng dần |
| Cùng thí nghiệm với `bigserial` hoặc UUIDv7 | Gần như phẳng |
| So kích thước index: `pg_relation_size('orders_pkey')` | UUIDv4 lớn hơn rõ rệt |
| Đo WAL sinh ra: `pg_current_wal_lsn()` trước/sau | UUIDv4 nhiều hơn |
| `SELECT * FROM pg_stat_user_indexes` sau mỗi trường hợp | So `idx_blks_read` |
| Bỏ `@db.Uuid` trong Prisma, xem `\d orders` trong psql | Cột là `text` |
| Trả `BigInt` qua `res.json()` | Throw |
| Đoán URL: `/orders/1042` → `/orders/1043` | Nếu thiếu authz, bạn đọc được đơn của người khác |
| Tạo 100 record với `serial`, xem ID lớn nhất | Lộ số lượng |

Thí nghiệm 1–3 cạnh nhau là thí nghiệm quan trọng nhất — nó cho thấy vấn đề mà `EXPLAIN` không cho thấy.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| UUID chỉ tốn thêm 8 byte | Vấn đề chính là **ghi ngẫu nhiên**, không phải kích thước |
| `EXPLAIN` sẽ cho thấy vấn đề UUIDv4 | Không — plan đọc vẫn tốt |
| UUID an toàn nên không cần authorization | ID khó đoán **không** phải kiểm soát truy cập |
| Mọi UUID như nhau | v4 ngẫu nhiên, v7 tuần tự — hành vi ghi hoàn toàn khác |
| `serial` luôn nhanh hơn nên tốt hơn | Nó lộ thông tin, không merge được, client không sinh trước được |
| Phải chọn một kiểu cho cả database | Quyết định theo từng bảng |
| Sqids/Hashids là bảo mật | Là obfuscation; không thay authz |
| Đổi kiểu ID sau này cũng được | Là dự án nhiều tuần khi đã có FK và dữ liệu |

## Debugging

1. **INSERT chậm dần theo thời gian** → nghi khoá chính ngẫu nhiên. Kiểm tra kiểu ID trước khi tìm chỗ khác.
2. **So kích thước index với số dòng**:
   ```sql
   SELECT relname, pg_size_pretty(pg_relation_size(indexrelid)) AS idx_size, idx_scan
   FROM pg_stat_user_indexes WHERE relname = 'orders';
   ```
   Index khoá chính lớn bất thường so với số dòng = page split nhiều.
3. **Kiểm tra bloat index**: extension `pgstattuple`, hoặc so với `REINDEX` trên bản copy.
4. **`REINDEX CONCURRENTLY`** dồn lại index phân mảnh — nó là cách giảm đau tạm thời, không sửa nguyên nhân.
5. **Kiểm tra kiểu cột thật** (không tin schema Prisma): `\d+ orders` trong psql. Tìm `text` thay vì `uuid`.
6. **Nghi lộ thông tin** → thử đoán ID lân cận trên môi trường staging; nếu đọc được dữ liệu người khác thì vấn đề là **authorization**, không phải kiểu ID.

## Production Considerations

- **UUIDv7 là mặc định tốt** cho ID xuất hiện trong URL hoặc API. Nó lấy được hiệu năng ghi của serial và tính không-đoán-được của UUID.
- **`bigserial` cho bảng nội bộ khối lượng lớn** (audit log, event, metric) — không bao giờ ra API.
- **Luôn `@db.Uuid`** trong Prisma; luôn kiểu `uuid` trong PostgreSQL, không phải `text`.
- **API trả ID dạng string** bất kể kiểu trong DB.
- **ID khó đoán không thay authorization.** Mọi endpoint vẫn phải kiểm tra quyền. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).
- **Nếu đã dùng UUIDv4 và bảng lớn**: `REINDEX CONCURRENTLY` giảm bloat; chuyển sang v7 cho **dòng mới** là được (cùng kiểu `uuid`, chỉ khác cách sinh) — không cần migrate dữ liệu cũ. Đây là điểm thực dụng quan trọng.
- **Quyết định sớm và ghi vào ADR** — đây là một trong ít quyết định gần như không đổi được.

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| `bigserial` | nhỏ nhất, ghi nhanh nhất, đơn giản | đoán được, lộ số lượng, không merge, client không sinh trước |
| UUIDv4 | không đoán được, phân tán an toàn | ghi ngẫu nhiên → chậm dần, index phình, WAL nhiều |
| UUIDv7 / ULID | ghi tuần tự + không đoán được + client sinh trước | 16 byte, lộ thời điểm tạo, cần thư viện |
| serial + `public_id` UUID | hiệu năng nội bộ + an toàn đối ngoại | thêm index, thêm một lần lookup |
| serial + Sqids ở API | không đổi schema | chỉ obfuscation; thêm encode/decode |
| Text PK cho lookup nhỏ | đọc được không cần JOIN | chỉ dùng cho bảng nhỏ, giá trị ổn định |

## Explain Without Notes

1. Vì sao UUIDv4 làm INSERT chậm dần, và ba hệ quả của nó?
2. Vì sao `EXPLAIN` không cho thấy vấn đề này?
3. UUIDv7 giải quyết được gì, và đánh đổi còn lại là gì?
4. Hai lợi ích của việc client sinh ID trước khi gọi API?
5. Pattern `id` + `public_id` cho bạn gì, và tốn gì?
6. Vì sao ID khó đoán không thay thế authorization?

## Related

- [Constraints & invariants](01-constraints-invariants.md) — unique constraint và idempotency
- [Relationships & cardinality](03-relationships-cardinality.md) — FK dùng kiểu ID nào
- [Migrations](04-migrations.md) — vì sao đổi kiểu ID rất đắt
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — B-tree, page split
- [Prisma model & client](../05-data-access/02-prisma-model-and-client.md) — `@db.Uuid`, `BigInt`
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — ID là string ở API
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — client-generated ID
- [Access control](../../05-cross-cutting/security/04-access-control.md) — ID khó đoán ≠ authz
- [Data partitioning & sharding](../../06-system-design/05-data-partitioning-sharding.md) — ID và shard key
