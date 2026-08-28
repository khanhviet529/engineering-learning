---
level: intermediate
area: database
prerequisites:
  - 01-constraints-invariants.md
related:
  - ../05-data-access/07-repository-pattern-testing.md
  - ../../05-cross-cutting/security/04-access-control.md
---

# Soft delete & audit patterns

> Soft delete trông như một cột thêm vào. Thực tế nó thay đổi **mọi** query, phá **mọi** unique constraint, và tạo ra một lớp lỗ hổng bảo mật mới. Nó không phải mặc định cho mọi bảng.

## Position

```text
Domain: "xoá" nghĩa là gì?
      ↓
Schema: DELETE thật | deleted_at | trạng thái | archive
      ↓
Query (mọi query!) · constraint · index · quyền truy cập
```

## Problem

```sql
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
```

Một cột. Rồi bốn vấn đề xuất hiện, và không cái nào rõ ràng lúc thêm cột:

**1. Mọi query phải nhớ lọc:**

```sql
SELECT * FROM users WHERE email = $1;                      -- ❌ trả cả user đã xoá
SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL; -- ✅
```

Có 200 query trong codebase. Quên một chỗ là một bug — và bug đó có thể là **lỗ hổng bảo mật** (người dùng đã bị vô hiệu hoá vẫn đăng nhập được).

**2. Unique constraint vỡ:**

```sql
CREATE UNIQUE INDEX ON users (email);
-- Xoá mềm user a@b.com → email vẫn chiếm chỗ
-- Người đó không đăng ký lại được. Và bạn không thể tạo user mới cùng email.
```

**3. Foreign key vẫn trỏ tới bản ghi "đã xoá":**

```sql
-- order.user_id trỏ tới user đã soft-delete
-- FK không vi phạm (dòng vẫn tồn tại) → không có cảnh báo nào
-- JOIN vẫn trả về dữ liệu của user "đã xoá"
```

**4. Dữ liệu không bao giờ nhỏ lại:**

```text
5 triệu dòng, 60% đã soft-delete
→ index chứa cả 5 triệu
→ mọi query chậm hơn 2,5 lần vì phải bỏ qua 3 triệu dòng chết
```

## Mental Model

Câu hỏi đúng **không** phải "soft delete hay hard delete", mà:

> **"Xoá" trong domain của bạn thật sự nghĩa là gì?**

Bốn ý nghĩa khác nhau, bốn cách làm khác nhau:

| Ý nghĩa | Cách làm | Ví dụ |
|---|---|---|
| **Người dùng không muốn thấy nữa** | trạng thái (`archived`) | task đã xong, email đã archive |
| **Hết hiệu lực nhưng phải giữ để đối chiếu** | trạng thái + lịch sử | order đã huỷ, hợp đồng hết hạn |
| **Phải xoá theo luật** (GDPR) | **hard delete** hoặc anonymize | dữ liệu cá nhân khi có yêu cầu |
| **Xoá nhầm, cần hoàn tác** | soft delete có TTL | thùng rác 30 ngày |

Ba nhận xét quan trọng:

- Hàng 1 và 2 **không phải soft delete** — chúng là **trạng thái nghiệp vụ**, và mô hình hoá bằng `status` rõ ràng hơn `deleted_at` rất nhiều.
- Hàng 3 **loại trừ** soft delete — GDPR yêu cầu xoá thật, và `deleted_at` không phải xoá.
- Chỉ hàng 4 thật sự cần soft delete, và nó nên có **TTL**.

> **Soft delete không phải mặc định. Nó là lựa chọn cho một yêu cầu cụ thể: hoàn tác được.**

Với phần lớn bảng, câu trả lời là: **hard delete**, hoặc **trạng thái nghiệp vụ tường minh**.

## How It Works

### Nếu dùng soft delete — bốn thứ bắt buộc

**1. Partial unique index**

```sql
-- ❌ Chiếm chỗ mãi mãi
CREATE UNIQUE INDEX users_email_key ON users (email);

-- ✅ Chỉ ép unique trên dòng còn sống
CREATE UNIQUE INDEX users_email_active
  ON users (email) WHERE deleted_at IS NULL;
```

```prisma
// Prisma chưa hỗ trợ partial index trong schema (kiểm tra version bạn dùng)
// → viết trong migration SQL bằng tay
model User {
  id        String    @id @default(uuid())
  email     String                          // KHÔNG @unique
  deletedAt DateTime? @map("deleted_at")
  @@map("users")
}
```

**2. Partial index cho query nóng**

```sql
-- Index chỉ chứa dòng còn sống → nhỏ hơn nhiều, vừa RAM dễ hơn
CREATE INDEX idx_tasks_project_active
  ON tasks (project_id, created_at DESC) WHERE deleted_at IS NULL;
```

Nếu 60% dòng đã xoá, partial index nhỏ hơn 2,5 lần. Xem [Index types](../01-postgresql/indexes-query-planning/02-index-types.md).

**3. Lọc mặc định — không dựa vào việc nhớ**

Ba cách, theo độ an toàn tăng dần:

```ts
// A. Prisma extension — lọc tự động ở tầng client
const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async findMany({ args, query }) {
        args.where = { deletedAt: null, ...args.where };
        return query(args);
      },
      async findFirst({ args, query }) {
        args.where = { deletedAt: null, ...args.where };
        return query(args);
      },
    },
  },
});
```

```sql
-- B. View — database đảm bảo, không lách được từ SQL
CREATE VIEW active_users AS SELECT * FROM users WHERE deleted_at IS NULL;
-- Application chỉ query view; bảng gốc chỉ dùng cho admin/audit
```

```sql
-- C. Row Level Security — mạnh nhất
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY hide_deleted ON users FOR SELECT USING (deleted_at IS NULL);
```

Cách A dễ nhất nhưng **lách được** (raw SQL bỏ qua extension). Cách B và C là bảo đảm thật. Với dữ liệu nhạy cảm, chọn B hoặc C.

**4. TTL — dọn thật sau N ngày**

```sql
-- Job định kỳ: xoá thật sau 30 ngày, theo lô
DELETE FROM users
WHERE id IN (
  SELECT id FROM users
  WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
  LIMIT 1000
);
```

Không có bước này, bảng chỉ lớn lên mãi. Soft delete **không có TTL** là quyết định giữ dữ liệu vĩnh viễn — và đó thường không phải điều bạn muốn (cả về hiệu năng và về luật).

### Trạng thái nghiệp vụ — thường tốt hơn

```prisma
enum TaskStatus {
  OPEN
  IN_PROGRESS
  DONE
  ARCHIVED         // ← rõ nghĩa hơn deleted_at
}

model Task {
  id         String     @id
  status     TaskStatus @default(OPEN)
  archivedAt DateTime?  @map("archived_at")   // khi nào, để hiển thị
  @@index([projectId, status, createdAt(sort: Desc)])
}
```

Vì sao tốt hơn:

- **Rõ nghĩa** — `ARCHIVED` nói được ý định; `deleted_at IS NOT NULL` thì không.
- **Nhiều trạng thái** — bạn có thể có `ARCHIVED`, `CANCELLED`, `EXPIRED` với ý nghĩa khác nhau.
- **Query tự nhiên** — `WHERE status = 'OPEN'` không phải điều kiện "phải nhớ", nó là điều kiện nghiệp vụ.
- **Không phá unique constraint** theo cách bất ngờ.

### GDPR — soft delete không đủ

```text
"Quyền được xoá" yêu cầu dữ liệu cá nhân THẬT SỰ mất.
deleted_at = dữ liệu vẫn còn → KHÔNG tuân thủ.
```

Cách thực tế: **anonymize** thay vì xoá dòng, để giữ tính toàn vẹn tham chiếu:

```sql
UPDATE users SET
  email       = 'deleted-' || id || '@invalid',
  name        = '[đã xoá]',
  phone       = NULL,
  address     = NULL,
  avatar_url  = NULL,
  anonymized_at = now()
WHERE id = $1;
-- order, invoice vẫn trỏ tới dòng này → không mồ côi, không mất lịch sử giao dịch
```

Nhớ xoá cả ở những nơi khác: backup, log, cache, analytics, search index, email provider. Đây là phần bị bỏ nhiều nhất.

## Audit — bốn mức khác nhau

Bốn thứ hay bị gọi chung là "audit" nhưng khác nhau hoàn toàn:

```text
1. TIMESTAMP        created_at, updated_at
   → "khi nào" — rẻ nhất, nên có ở mọi bảng

2. AUDIT COLUMN     created_by, updated_by, deleted_by
   → "ai" — đủ cho phần lớn nhu cầu

3. AUDIT LOG        bảng riêng: ai, khi nào, đổi gì (before/after)
   → "đổi gì" — cần cho compliance, điều tra sự cố

4. EVENT LOG        append-only, mọi thay đổi là một event
   → "toàn bộ lịch sử" — event sourcing, đắt nhất
```

Phần lớn hệ thống cần mức 1–2. Mức 3 khi có yêu cầu compliance hoặc cần điều tra "ai đổi cái này". Mức 4 rất ít khi cần.

### Mức 1–2

```prisma
model Task {
  createdAt DateTime  @default(now())    @map("created_at")
  updatedAt DateTime  @updatedAt         @map("updated_at")
  createdBy String                        @map("created_by")
  updatedBy String?                       @map("updated_by")
}
```

Cảnh báo: `@updatedAt` của Prisma do **client** quản. Nếu ai đó `UPDATE` bằng SQL trực tiếp hoặc từ một service khác, nó không cập nhật. Muốn database bảo đảm thì cần trigger:

```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Mức 3 — audit log

```sql
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  entity_type text        NOT NULL,
  entity_id   text        NOT NULL,
  action      text        NOT NULL,          -- created | updated | deleted
  actor_id    text,                           -- NULL = system/job
  changes     jsonb,                          -- { field: { from, to } }
  request_id  text,                           -- nối với application log
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX ON audit_log (actor_id, at DESC);
```

Ba nguyên tắc:

**1. Append-only.** Audit log bị sửa được thì nó không phải audit log:

```sql
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
```

**2. Chỉ ghi field đã đổi**, không ghi cả snapshot — nếu không bảng phình rất nhanh:

```ts
function diff<T extends object>(before: T, after: T) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) changes[k as string] = { from: before[k], to: after[k] };
  }
  return changes;
}
```

**3. Không ghi dữ liệu nhạy cảm.** `passwordHash`, token, số thẻ — audit log thường có nhiều người đọc được hơn bảng gốc, nên nó là nơi rò rỉ tiềm ẩn:

```ts
const REDACT = new Set(['passwordHash', 'token', 'cardNumber', 'ssn']);
const safe = Object.fromEntries(
  Object.entries(changes).filter(([k]) => !REDACT.has(k)),
);
```

**4. Ghi trong cùng transaction** với thay đổi — nếu không, audit có thể thiếu khi transaction rollback hoặc process chết:

```ts
await prisma.$transaction([
  prisma.task.update({ where: { id }, data }),
  prisma.auditLog.create({ data: { entityType: 'task', entityId: id, action: 'updated', changes: safe, actorId, requestId } }),
]);
```

### Partition audit log

Audit log tăng mãi. Partition theo tháng để xoá dữ liệu cũ rẻ:

```sql
CREATE TABLE audit_log (…) PARTITION BY RANGE (at);
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- Xoá dữ liệu cũ: DROP TABLE audit_log_2025_08 — tức thì, không bloat
```

`DROP TABLE` một partition là tức thì; `DELETE` 50 triệu dòng thì không. Xem [Data partitioning](../../06-system-design/05-data-partitioning-sharding.md).

## Example

```text
Quyết định cho từng bảng — không dùng một chính sách cho tất cả

users
  → hard delete + anonymize (GDPR)
  → audit log mức 3 (ai vô hiệu hoá ai)
  → partial unique index trên email

tasks
  → status: ARCHIVED (trạng thái nghiệp vụ, không phải soft delete)
  → audit column mức 2 (created_by, updated_by)

orders
  → KHÔNG BAO GIỜ xoá — status: CANCELLED/REFUNDED
  → audit log mức 3 (compliance, đối chiếu tài chính)

sessions
  → hard delete + TTL index (không cần audit)

uploaded_files
  → soft delete có TTL 30 ngày (thùng rác, hoàn tác được)
  → job dọn thật sau 30 ngày, xoá cả file trên S3
```

## Prediction

1. Thêm `deleted_at` mà không sửa query — user đã xoá còn đăng nhập được không?
2. Unique index thường trên `email` + soft delete — người đó đăng ký lại được không?
3. Partial unique index `WHERE deleted_at IS NULL` — được không?
4. 60% dòng soft-deleted, index thường vs partial index — chênh kích thước bao nhiêu?
5. Prisma extension lọc `deletedAt: null`, code dùng `$queryRaw` — có được lọc?
6. `@updatedAt` của Prisma, ai đó `UPDATE` bằng psql — cột đổi không?
7. GDPR yêu cầu xoá, bạn set `deleted_at` — tuân thủ chưa?
8. Audit log ghi cả snapshot mỗi lần update, bảng 1M dòng update 10 lần/dòng — kích thước?
9. Audit log không trong cùng transaction, transaction rollback — audit thế nào?

<details>
<summary>Đáp án</summary>

1. **Có** — lỗ hổng bảo mật thật.
2. **Không** — email vẫn bị chiếm.
3. Có — đây là cách sửa.
4. Khoảng 2,5 lần.
5. **Không** — raw SQL lách extension.
6. **Không** — nó do client quản, không phải trigger.
7. **Chưa** — dữ liệu vẫn còn.
8. Rất lớn — chỉ nên ghi field đã đổi.
9. Audit ghi một thay đổi **không xảy ra** — sai lệch.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm `deleted_at`, bỏ lọc ở một query auth | User đã xoá đăng nhập được |
| Unique index thường + soft delete + đăng ký lại | Bị chặn |
| Đổi sang partial unique index | Hoạt động |
| Seed 1M dòng, 60% soft-deleted, so `EXPLAIN` index thường vs partial | Số block đọc chênh rõ |
| Prisma extension lọc, rồi gọi `$queryRaw` | Trả cả dòng đã xoá |
| Đổi sang view hoặc RLS, làm lại | Được lọc |
| `UPDATE` bằng psql, xem `updated_at` | Không đổi |
| Thêm trigger, làm lại | Đổi |
| Audit log ghi cả snapshot, chạy load test | Bảng audit lớn hơn bảng gốc |
| Cấp `UPDATE` trên audit_log rồi sửa một dòng | Audit không còn đáng tin |
| Audit ngoài transaction, gây rollback | Audit ghi thay đổi không tồn tại |
| Ghi `passwordHash` vào audit, cho một người đọc audit | Rò rỉ |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Soft delete là mặc định an toàn | Nó thay đổi mọi query và phá unique constraint |
| `deleted_at` là một cột thêm vào | Nó là quyết định ảnh hưởng toàn bộ data access |
| Soft delete tuân thủ GDPR | Không — cần hard delete hoặc anonymize |
| Filter ở application là đủ | Raw SQL, script, service khác lách được |
| Soft delete giữ dữ liệu để phân tích | Trạng thái nghiệp vụ hoặc archive table làm việc đó tốt hơn |
| Audit log là bảng thường | Phải append-only, không thì vô nghĩa |
| `@updatedAt` là trigger DB | Do Prisma client quản |
| Audit log nên ghi snapshot đầy đủ | Ghi diff; snapshot làm bảng phình |
| Audit log không nhạy cảm | Nó thường có nhiều người đọc hơn bảng gốc |

## Debugging

1. **Tìm query thiếu lọc** — bước quan trọng nhất và dễ bỏ nhất:
   ```bash
   grep -rn "findMany\|findFirst\|findUnique" src/ | grep -v "deletedAt"
   ```
   Với auth và authorization, mỗi chỗ thiếu là một lỗ hổng.
2. **Kiểm tra tỉ lệ dòng chết**:
   ```sql
   SELECT count(*) FILTER (WHERE deleted_at IS NOT NULL) * 100.0 / count(*) AS pct_deleted
   FROM users;
   ```
   Trên 30% → cần partial index và TTL.
3. **Kiểm tra unique constraint** có partial chưa:
   ```sql
   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users';
   ```
4. **Kích thước audit log**: `SELECT pg_size_pretty(pg_total_relation_size('audit_log'));` — nếu lớn hơn bảng gốc, bạn đang ghi snapshot.
5. **Audit log có bị sửa được không**: kiểm tra grant. `\dp audit_log` trong psql.
6. **Dữ liệu đã xoá vẫn xuất hiện** → kiểm tra cache, search index, analytics, backup. Xoá ở DB không xoá ở những nơi đó.

## Production Considerations

- **Quyết định per-table, không có chính sách chung.** Bảng khác nhau có ý nghĩa "xoá" khác nhau.
- **Ưu tiên trạng thái nghiệp vụ** (`ARCHIVED`, `CANCELLED`) hơn `deleted_at` — rõ nghĩa hơn và ít bẫy hơn.
- **Nếu soft delete: partial unique index + partial index + lọc mặc định + TTL.** Cả bốn, không phải một.
- **Lọc bằng view hoặc RLS** cho dữ liệu nhạy cảm — application-level filter lách được.
- **GDPR: hard delete hoặc anonymize**, và nhớ cả backup/log/cache/search index/provider bên thứ ba.
- **`created_at`/`updated_at` ở mọi bảng**, bằng trigger nếu cần bảo đảm ở tầng DB.
- **Audit log: append-only, ghi diff, redact field nhạy cảm, cùng transaction, partition theo thời gian.**
- **`request_id` trong audit log** để nối với application log — đây là thứ làm audit thật sự dùng được khi điều tra.
- **Test authorization với dữ liệu đã xoá**: user bị vô hiệu hoá không được đăng nhập, không được truy cập API. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Hard delete | đơn giản, bảng nhỏ, không bẫy | không hoàn tác được |
| Soft delete | hoàn tác được | mọi query phải lọc, unique vỡ, bảng phình |
| Trạng thái nghiệp vụ | rõ nghĩa, nhiều trạng thái | vẫn giữ dữ liệu, vẫn cần lọc |
| Anonymize | giữ tham chiếu, tuân thủ GDPR | mất dữ liệu gốc |
| Archive table | bảng chính nhỏ, giữ lịch sử | phải quản hai bảng, query lịch sử phức tạp hơn |
| Audit column (mức 2) | rẻ, đủ cho phần lớn | không biết đổi **gì** |
| Audit log (mức 3) | biết đổi gì, compliance | bảng lớn, cần partition, chi phí ghi |
| Event log (mức 4) | lịch sử đầy đủ, replay được | phức tạp nhất |

## Explain Without Notes

1. Bốn ý nghĩa của "xoá" và cách làm tương ứng?
2. Bốn vấn đề mà `deleted_at` tạo ra?
3. Bốn thứ bắt buộc nếu dùng soft delete?
4. Vì sao soft delete không tuân thủ GDPR, và cách làm đúng?
5. Bốn mức audit và khi nào cần mức nào?
6. Bốn nguyên tắc của audit log?

## Related

- [Constraints & invariants](01-constraints-invariants.md) — unique, partial unique
- [Normalization](02-normalization.md) · [Relationships & cardinality](03-relationships-cardinality.md)
- [Migrations](04-migrations.md) — thêm `deleted_at` là một migration cần expand/contract
- [Index types](../01-postgresql/indexes-query-planning/02-index-types.md) — partial index
- [Repository pattern & testing](../05-data-access/07-repository-pattern-testing.md) — nơi đặt lọc mặc định
- [Prisma model & client](../05-data-access/02-prisma-model-and-client.md) — extension, `@updatedAt`
- [Access control](../../05-cross-cutting/security/04-access-control.md) — user đã xoá không được truy cập
- [Data partitioning & sharding](../../06-system-design/05-data-partitioning-sharding.md) — partition audit log
- [Schema design & validation (MongoDB)](../06-mongodb/03-schema-design-validation.md) — partial unique index tương đương
