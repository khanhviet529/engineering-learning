---
level: intermediate
area: database
prerequisites:
  - 02-prisma-model-and-client.md
  - ../03-data-modeling/04-migrations.md
related:
  - ../../04-infrastructure/03-cicd/01-pipeline.md
  - ../../02-backend-api/00-http-api/06-api-versioning-evolution.md
---

# Prisma migrations trong production

> `prisma migrate dev` xoá database khi phát hiện drift. Nếu bạn chạy nó trên production một lần, bạn sẽ chỉ chạy nó một lần.

*Baseline: Prisma 6.x, PostgreSQL.*

## Position

```text
schema.prisma  (bạn sửa)
      ↓ migrate dev          — DEV: sinh file SQL + áp dụng
migrations/*/migration.sql   (commit vào git)
      ↓ migrate deploy       — PROD: chỉ áp dụng, không sinh
PostgreSQL
```

## Problem

Thay đổi schema là loại thay đổi **khó hoàn tác nhất** trong một hệ thống. Nó khác code ở ba điểm:

```text
Code:    deploy sai → rollback về version cũ → xong
Schema:  drop column → dữ liệu MẤT → rollback không cứu được
```

Và một vấn đề tinh vi hơn: trong lúc rolling update, **hai version code chạy đồng thời** trên cùng một database.

```text
t=0   3 pod chạy code v1, schema v1
t=1   migration đổi tên cột: title → name
t=2   pod mới (v2) đọc `name`  ✅
      pod cũ (v1) đọc `title`  ❌ 500 cho 1/3 traffic
```

Migration "đúng" vẫn gây outage nếu nó không tương thích với code đang chạy.

## Mental Model

Ba lệnh, ba mục đích hoàn toàn khác nhau. Nhầm chúng là nguồn của mọi sự cố migration:

| Lệnh | Môi trường | Làm gì | Nguy hiểm |
|---|---|---|---|
| `migrate dev` | **chỉ dev** | so sánh schema ↔ DB, sinh file SQL, áp dụng, `generate` | **có thể reset database** khi phát hiện drift |
| `migrate deploy` | **prod/staging/CI** | chỉ áp dụng migration chưa chạy, theo thứ tự | an toàn; không sinh, không reset |
| `db push` | prototype, test | đẩy schema trực tiếp, **không tạo file migration** | mất lịch sử; có thể mất dữ liệu |

```text
db push                          migrate
├─ không có file migration       ├─ có file SQL, commit vào git
├─ không có lịch sử              ├─ lịch sử tuyến tính, review được
├─ không rollback được có kiểm soát │
├─ nhanh, tốt cho prototype      ├─ chậm hơn, dùng cho mọi môi trường thật
└─ dùng cho: spike, test DB      └─ dùng cho: dev → staging → prod
```

Quy tắc một câu:

> **`db push` cho database dùng-một-lần. `migrate` cho mọi database có dữ liệu bạn quan tâm.**

Và nguyên tắc cho production:

> **Mọi migration phải tương thích với code version trước nó.**

Đó là toàn bộ nội dung của expand/contract.

## How It Works

### Shadow database

Khi `migrate dev` chạy, Prisma cần một database trống để kiểm tra migration có sinh ra đúng schema mong đợi hay không. Nó tạo, dùng, rồi xoá — gọi là **shadow database**.

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/app"
SHADOW_DATABASE_URL="postgresql://user:pass@localhost:5432/app_shadow"
```

Cần khai báo tường minh khi user database không có quyền `CREATEDB` (thường gặp với DB managed như RDS, Supabase, Neon). `migrate deploy` **không** cần shadow database — đó là một lý do nữa nó an toàn cho production.

### Drift — vì sao `migrate dev` reset

**Drift** = schema thật của database khác với những gì lịch sử migration mô tả. Nguyên nhân:

- ai đó `ALTER TABLE` bằng psql;
- đã dùng `db push` rồi chuyển sang `migrate`;
- migration bị sửa sau khi đã áp dụng;
- restore một backup cũ.

Khi `migrate dev` phát hiện drift, nó đề nghị **reset** (drop toàn bộ rồi áp dụng lại từ đầu). Trên dev thì tốt. Trên production thì đó là mất toàn bộ dữ liệu.

Đây là lý do `migrate dev` **không bao giờ** xuất hiện trong CI/CD hoặc script production. Kiểm tra bằng `prisma migrate status`.

### Expand / contract — thay đổi không downtime

Mọi thay đổi phá vỡ tương thích phải chia thành nhiều bước, mỗi bước tương thích với bước trước.

**Ví dụ: đổi tên `title` → `name`**

```text
Bước 1 — EXPAND (migration)
  ALTER TABLE tasks ADD COLUMN name VARCHAR(200);
  → schema mới, code cũ vẫn chạy (nó không biết `name`)

Bước 2 — DEPLOY code ghi cả hai
  create: { title: v, name: v }
  read:   name ?? title
  → mọi pod, cũ và mới, đều hoạt động

Bước 3 — BACKFILL
  UPDATE tasks SET name = title WHERE name IS NULL;
  → chạy theo lô, không một câu duy nhất (xem dưới)

Bước 4 — DEPLOY code chỉ dùng `name`
  → không còn ai đọc `title`

Bước 5 — CONTRACT (migration, sau vài ngày)
  ALTER TABLE tasks DROP COLUMN title;
  → chỉ khi chắc chắn không còn code nào đọc nó
```

Năm bước, ít nhất ba lần deploy. Đắt — nhưng không có downtime và có thể dừng lại ở bất kỳ bước nào.

**Backfill phải theo lô.** Một `UPDATE` trên 10 triệu dòng giữ lock và làm table bloat:

```sql
-- ❌ Lock cả bảng, có thể chạy hàng chục phút
UPDATE tasks SET name = title WHERE name IS NULL;

-- ✅ Theo lô, mỗi lô một transaction ngắn
UPDATE tasks SET name = title
WHERE id IN (
  SELECT id FROM tasks WHERE name IS NULL LIMIT 5000
);
-- lặp tới khi 0 dòng bị ảnh hưởng, nghỉ ngắn giữa các lô
```

Xem [MVCC & vacuum](../01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — mỗi `UPDATE` tạo dead tuple, và một lần update 10M dòng làm bảng phình gấp đôi.

### Thao tác an toàn và không an toàn

| Thao tác | An toàn? | Ghi chú |
|---|---|---|
| `ADD COLUMN` nullable | ✅ | không rewrite bảng |
| `ADD COLUMN NOT NULL DEFAULT` | ✅ | PostgreSQL 11+ không rewrite với default hằng |
| `ADD COLUMN NOT NULL` không default | ❌ | fail nếu bảng có dữ liệu |
| `DROP COLUMN` | ⚠️ | nhanh, nhưng phá code cũ → phải là bước contract |
| `RENAME COLUMN` | ❌ | phá code cũ ngay → dùng expand/contract |
| `ALTER TYPE` mở rộng (varchar 100→200) | ✅ | thường không rewrite |
| `ALTER TYPE` thu hẹp hoặc đổi kiểu | ❌ | rewrite bảng, giữ lock |
| `CREATE INDEX` | ❌ | **lock ghi** — dùng `CONCURRENTLY` |
| `CREATE INDEX CONCURRENTLY` | ✅ | không lock; không chạy được trong transaction |
| `ADD CONSTRAINT NOT VALID` rồi `VALIDATE` | ✅ | hai bước, không lock lâu |
| `ADD FOREIGN KEY` trực tiếp | ⚠️ | scan bảng, giữ lock |

**`CREATE INDEX CONCURRENTLY` cần xử lý đặc biệt trong Prisma**, vì Prisma bọc mỗi migration trong một transaction và `CONCURRENTLY` không chạy được trong transaction. Cách làm: sinh migration rồi sửa file SQL bằng tay:

```sql
-- migrations/20260828_add_index/migration.sql
-- Prisma sinh:
-- CREATE INDEX "tasks_project_id_created_at_idx" ON "tasks"("project_id", "created_at" DESC);

-- Sửa thành (và tách ra migration riêng, không kèm thay đổi khác):
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_project_id_created_at_idx"
  ON "tasks"("project_id", "created_at" DESC);
```

Prisma cho phép sửa file migration **trước khi** nó được áp dụng. Sau khi áp dụng thì không được sửa — checksum sẽ lệch và gây drift.

Nếu `CREATE INDEX CONCURRENTLY` thất bại giữa đường, nó để lại một index `INVALID`. Phải `DROP INDEX` rồi tạo lại — kiểm tra bằng `SELECT * FROM pg_index WHERE NOT indisvalid`.

### Migration trong CI/CD

```yaml
# Bước riêng, TRƯỚC khi deploy code mới
- name: Apply migrations
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Thứ tự đúng: **migration (expand) → deploy code → backfill → deploy code → migration (contract)**. Migration đi trước vì nó tương thích ngược; nếu đi sau, pod mới sẽ đọc cột chưa tồn tại.

Trong Kubernetes, dùng một Job (hoặc initContainer với lock) — **không** chạy migration trong entrypoint của mọi pod, vì 3 pod sẽ chạy đồng thời. Prisma có advisory lock nên nó không hỏng, nhưng pod sẽ chờ nhau và có thể timeout khi startup.

### Rollback

Prisma **không có** `migrate down`. Đây là quyết định có chủ đích: rollback schema tự động thường không an toàn (dữ liệu đã ghi vào cột mới sẽ mất).

Cách xử lý:

```text
1. Thiết kế forward-only: mọi sửa lỗi là một migration MỚI
2. Nếu migration fail giữa đường:
   - `prisma migrate resolve --rolled-back <name>`  (đánh dấu đã rollback)
   - hoặc `--applied <name>` nếu đã áp dụng thủ công
3. Backup trước mọi migration có destructive operation
```

## Example

```prisma
// Thêm cột NOT NULL vào bảng có dữ liệu — chia hai migration
// Migration 1: thêm nullable
model Task {
  id       String  @id
  priority Int?                     // nullable trước
}

// (backfill: UPDATE tasks SET priority = 3 WHERE priority IS NULL — theo lô)

// Migration 2: siết lại
model Task {
  id       String  @id
  priority Int     @default(3)      // giờ mới NOT NULL
}
```

## Prediction

1. `prisma migrate dev` trên production có drift — điều gì xảy ra?
2. `prisma migrate deploy` cần shadow database không?
3. `db push` ở dev rồi `migrate deploy` ở prod — lịch sử migration thế nào?
4. `RENAME COLUMN title → name` trong lúc 3 pod đang chạy code cũ — bao nhiêu % request lỗi?
5. `CREATE INDEX` (không `CONCURRENTLY`) trên bảng 10M dòng — ghi vào bảng đó thế nào trong lúc đó?
6. `ADD COLUMN status VARCHAR NOT NULL` không default, bảng có 1000 dòng — thành công?
7. `UPDATE` 10M dòng trong một câu — kích thước bảng sau đó?
8. Sửa file migration đã được áp dụng — Prisma phản ứng thế nào?
9. Migration chạy trong entrypoint của 3 pod cùng lúc — kết quả?

<details>
<summary>Đáp án</summary>

1. Nó đề nghị **reset** — drop toàn bộ dữ liệu. Đây là lý do không bao giờ chạy nó ở production.
2. Không.
3. Lệch — DB prod có lịch sử migration mà dev không có, và ngược lại. Nguồn drift.
4. Khoảng 100% cho pod cũ (2/3 traffic nếu 1 pod đã lên v2), cho tới khi mọi pod được thay.
5. Ghi **bị chặn** cho tới khi index xong — có thể hàng phút.
6. **Thất bại** — không thể thêm cột NOT NULL không default vào bảng có dữ liệu.
7. Phình khoảng gấp đôi (dead tuple), tới khi vacuum dọn.
8. Checksum lệch → báo drift.
9. Prisma dùng advisory lock nên chỉ một pod chạy; hai pod còn lại **chờ**, có thể vượt startup probe timeout.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `ALTER TABLE` bằng psql rồi `migrate dev` | Prisma báo drift, đề nghị reset |
| `migrate status` sau đó | Thấy rõ lệch giữa lịch sử và thực tế |
| `RENAME COLUMN` với 2 version code chạy song song | 500 cho version cũ |
| Làm lại bằng expand/contract | Không lỗi nào |
| `CREATE INDEX` trên bảng lớn, ghi song song | Ghi bị chặn; đo thời gian |
| `CONCURRENTLY`, làm lại | Ghi không bị chặn |
| Kill `CREATE INDEX CONCURRENTLY` giữa đường | Index `INVALID`; `SELECT * FROM pg_index WHERE NOT indisvalid` |
| `UPDATE` toàn bảng 1M dòng, đo `pg_total_relation_size` trước/sau | Phình rõ rệt |
| Backfill theo lô 5000, đo lại | Phình ít hơn, lock ngắn |
| Sửa migration đã áp dụng | Drift do checksum |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `migrate dev` và `migrate deploy` tương đương | `dev` có thể reset database |
| `db push` là "migrate nhanh" | Nó không tạo lịch sử; chỉ cho DB dùng-một-lần |
| Rename column là thao tác an toàn | Nó phá mọi code đang chạy |
| `CREATE INDEX` không ảnh hưởng ghi | Nó lock ghi trừ khi `CONCURRENTLY` |
| Prisma có `migrate down` | Không — thiết kế forward-only |
| Rollback code là đủ khi migration sai | Dữ liệu đã mất không quay lại |
| Migration chạy được ở dev là chạy được ở prod | Prod có dữ liệu, có concurrency, có code cũ đang chạy |
| Thêm cột NOT NULL luôn cần rewrite bảng | PostgreSQL 11+ không rewrite nếu default là hằng |

## Debugging

1. **`prisma migrate status`** — luôn chạy đầu tiên. Nó cho biết migration nào chưa áp dụng và có drift hay không.
2. **Migration treo** → nó đang chờ lock. Tìm ai giữ:
   ```sql
   SELECT pid, state, now() - xact_start AS dur, query
   FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dur DESC;
   ```
   Thường là một transaction dài của application. Xem [Prisma transactions](04-prisma-transactions.md).
3. **Drift** → `prisma migrate diff` để xem chênh lệch chính xác:
   ```bash
   npx prisma migrate diff \
     --from-schema-datasource prisma/schema.prisma \
     --to-schema-datamodel prisma/schema.prisma --script
   ```
4. **Index `INVALID`** → `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` rồi drop và tạo lại.
5. **Migration fail giữa đường** → `migrate resolve --rolled-back <name>` hoặc `--applied <name>` sau khi xử lý thủ công.
6. **Đo trước khi chạy trên production**: restore backup vào một database staging cùng kích thước và bấm giờ. Đây là bước duy nhất cho bạn con số thật.

## Production Considerations

- **Chỉ `migrate deploy` ở mọi môi trường có dữ liệu.** `migrate dev` không được xuất hiện trong bất kỳ script tự động nào.
- **Backup trước migration destructive**, và kiểm tra backup restore được.
- **Expand/contract cho mọi thay đổi phá tương thích.** Khoảng cách giữa expand và contract nên là ngày, không phải phút.
- **`CREATE INDEX CONCURRENTLY`** trong migration riêng, sửa file SQL bằng tay.
- **Backfill theo lô** với nghỉ giữa các lô; theo dõi replication lag nếu có replica.
- **Migration là một Job riêng trong CI/CD**, chạy trước khi deploy code, không chạy trong pod entrypoint.
- **`lock_timeout`** cho session migration (ví dụ `SET lock_timeout = '5s'`) để migration fail nhanh thay vì treo và chặn mọi thứ.
- **Test migration trên bản copy của production** về thời gian và về lock.
- Với DB managed không có `CREATEDB`, khai báo `SHADOW_DATABASE_URL`.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `migrate` (có lịch sử) | review được, tái tạo được, an toàn | chậm hơn, nhiều file |
| `db push` | nhanh, không file | không lịch sử, không dùng được cho prod |
| Expand/contract | zero-downtime, dừng được giữa đường | 3+ lần deploy, code tạm thời phức tạp |
| Migration trực tiếp | một bước | downtime hoặc lỗi cho code cũ |
| Forward-only | đơn giản, không ảo tưởng rollback | phải cẩn thận hơn khi viết |
| `CONCURRENTLY` | không lock ghi | chậm hơn, có thể để lại index invalid |
| Backfill theo lô | lock ngắn, ít bloat | tốn thời gian, cần script |

## Explain Without Notes

1. `migrate dev`, `migrate deploy`, `db push` — mục đích và mức nguy hiểm của mỗi lệnh?
2. Drift là gì, ba nguyên nhân, và vì sao nó nguy hiểm với `migrate dev`?
3. Vì sao rename column gây lỗi dù migration thành công?
4. Năm bước expand/contract để đổi tên một cột?
5. Vì sao `CREATE INDEX` cần `CONCURRENTLY`, và vì sao nó khó với Prisma?
6. Vì sao backfill phải theo lô?

## Related

- [Migrations](../03-data-modeling/04-migrations.md) — nguyên lý chung, không phụ thuộc ORM
- [Prisma model & client](02-prisma-model-and-client.md) — schema và `generate`
- [Prisma transactions](04-prisma-transactions.md) — transaction dài chặn migration
- [MVCC & vacuum](../01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — bloat từ backfill
- [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) — migration chờ lock
- [CI/CD pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — migration là bước riêng
- [API versioning & evolution](../../02-backend-api/00-http-api/06-api-versioning-evolution.md) — cùng nguyên lý expand/contract
- [Rollout & rollback](../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) — hai version chạy song song
