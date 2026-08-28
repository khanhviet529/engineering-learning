---
level: advanced
area: database
prerequisites:
  - 01-constraints-invariants.md
  - ../01-postgresql/transactions-concurrency/03-locking-deadlock.md
related:
  - ../../04-infrastructure/03-cicd/01-pipeline.md
  - ../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md
---

# Migrations

> Migration thêm một cột `NOT NULL` chạy 40 mili giây trên staging. Trên production, hai chuyện xảy ra cùng lúc: nó chờ khoá 30 giây (làm mọi query vào bảng đó treo), rồi khi chạy xong, các pod **phiên bản cũ** vẫn đang chạy bắt đầu lỗi `null value in column "x" violates not-null constraint` cho mọi `INSERT`. Downtime 4 phút, và không có gì trong migration đó là sai về mặt SQL.

## Position

```text
CI: build image
  ↓
MIGRATION  ← bước riêng, chạy MỘT lần, trước rollout   ← note này
  ↓
Rolling update: v_cũ và v_mới CHẠY SONG SONG vài phút
  ↓                    ↑
  └── cả hai phiên bản dùng CÙNG một schema
```

Dòng cuối là ràng buộc trung tâm: trong lúc rollout, schema phải tương thích với **cả hai** phiên bản code. Mọi quy tắc trong note này đều là hệ quả của nó.

## Problem

Ba vấn đề độc lập, và một migration tệ có thể mắc cả ba:

```text
① KHOÁ           DDL lấy ACCESS EXCLUSIVE → chặn cả SELECT
                 và hàng đợi khoá là FIFO → mọi query mới xếp sau
                 ⇒ ứng dụng dừng, dù migration chỉ mất 2ms để CHẠY

② TƯƠNG THÍCH    Trong rolling update có 2 phiên bản code, 1 schema
                 ⇒ schema phải hợp lệ với cả hai

③ THỜI GIAN      UPDATE 50 triệu dòng trong một transaction
                 ⇒ khoá lâu, WAL khổng lồ, bloat, không huỷ được giữa chừng
```

Điều làm ba vấn đề này khó là chúng **không bao giờ xuất hiện ở local hay staging**: local không có traffic đồng thời, staging không có 50 triệu dòng, và không nơi nào chạy hai phiên bản code song song.

## Mental Model

### Migration phải tương thích ngược — luôn luôn

```text
Thời điểm      Code                Schema         Phải hoạt động?
t0             v1                  s1             ✓
t1 (migrate)   v1                  s2             ✓ ← điểm hay bị bỏ qua
t2 (rollout)   v1 + v2 lẫn lộn     s2             ✓
t3             v2                  s2             ✓
t4 (rollback!) v1                  s2             ✓ ← và cả điểm này nữa
```

Từ bảng này ra một quy tắc duy nhất:

> **Mỗi migration phải hoạt động với phiên bản code TRƯỚC nó và SAU nó.**

Nếu quy tắc đó không giữ được trong một bước, hãy chia thành nhiều bước qua nhiều lần deploy.

### Expand → Migrate → Contract

Đây là mẫu giải quyết mọi thay đổi phá vỡ:

```text
① EXPAND    thêm cái mới, GIỮ cái cũ         (schema tương thích cả hai)
② MIGRATE   code ghi cả hai, backfill dữ liệu (deploy code mới)
③ CONTRACT  xoá cái cũ                        (sau khi chắc không ai dùng)

Ba lần deploy. Không có bước nào phá vỡ.
```

Ví dụ: đổi tên `users.name` → `users.full_name`.

```sql
-- Deploy 1 (EXPAND)
ALTER TABLE users ADD COLUMN full_name text;
-- code v2: ĐỌC coalesce(full_name, name), GHI cả hai cột
```

```sql
-- Deploy 2 (MIGRATE) — backfill theo LÔ, ngoài transaction lớn
UPDATE users SET full_name = name
WHERE full_name IS NULL AND id BETWEEN 1 AND 10000;    -- lặp
-- rồi: ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;  (kiểu NOT VALID → VALIDATE)
-- code v3: chỉ đọc/ghi full_name
```

```sql
-- Deploy 3 (CONTRACT) — sau khi v3 đã chạy ổn định vài ngày
ALTER TABLE users DROP COLUMN name;
```

Chậm hơn? Có. Nhưng `ALTER TABLE users RENAME COLUMN name TO full_name` trong một bước **chắc chắn** gây downtime bằng thời gian rollout, vì code cũ tìm cột không còn tồn tại.

### Thao tác nào an toàn, thao tác nào không

```text
AN TOÀN (khoá rất ngắn, không quét bảng)
  ADD COLUMN (nullable, không default)
  ADD COLUMN ... DEFAULT <hằng số>          — PostgreSQL 11+, không viết lại bảng
  DROP COLUMN                                — chỉ đánh dấu, không viết lại
  CREATE INDEX CONCURRENTLY
  ADD CONSTRAINT ... NOT VALID
  VALIDATE CONSTRAINT                        — khoá nhẹ, không chặn đọc/ghi
  ALTER COLUMN DROP NOT NULL
  RENAME (nhanh, nhưng PHÁ VỠ code cũ)

NGUY HIỂM (quét toàn bảng, giữ ACCESS EXCLUSIVE)
  ADD COLUMN ... DEFAULT <biểu thức không hằng>   — ví dụ now(), random()
  ALTER COLUMN TYPE                                — hầu hết trường hợp viết lại bảng
  ADD CONSTRAINT (không NOT VALID)
  SET NOT NULL (cách trực tiếp)
  CREATE INDEX (không CONCURRENTLY)
  ADD PRIMARY KEY
  CLUSTER, VACUUM FULL
```

Điểm về `ADD COLUMN ... DEFAULT` đáng nhớ: trước PostgreSQL 11, nó viết lại toàn bộ bảng. Từ 11, với default là **hằng số**, nó chỉ ghi metadata — tức thì. Với biểu thức không hằng (`now()`, `gen_random_uuid()`), nó vẫn viết lại.

### `lock_timeout`: dòng quan trọng nhất

```sql
SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE users ADD COLUMN full_name text;
```

Không có nó, một transaction dài đang chạy làm migration chờ, và **mọi query đến sau xếp hàng phía sau migration** (hàng đợi khoá FIFO). Ứng dụng dừng.

Với `lock_timeout`, migration fail sau 3 giây. Đó là kết quả **tốt hơn**: bạn thử lại lúc khác, không ai bị ảnh hưởng.

Mẫu retry:

```bash
for i in 1 2 3 4 5; do
  psql -c "SET lock_timeout='3s'; ALTER TABLE users ADD COLUMN full_name text;" && break
  echo "lock timeout, thử lại sau 30s..."; sleep 30
done
```

Xem [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) cho cơ chế đầy đủ.

### Backfill: theo lô, ngoài transaction lớn

```sql
-- ❌ một transaction, 50 triệu dòng
UPDATE users SET full_name = name;
--   · khoá mọi dòng cho tới khi xong
--   · WAL khổng lồ → có thể đầy đĩa
--   · 50 triệu dead tuple → bloat
--   · huỷ giữa chừng = rollback toàn bộ, mất hết công
```

```sql
-- ✅ theo lô, mỗi lô một transaction
DO $$
DECLARE
  batch_size int := 5000;
  updated    int;
BEGIN
  LOOP
    UPDATE users SET full_name = name
    WHERE id IN (SELECT id FROM users WHERE full_name IS NULL LIMIT batch_size);
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    COMMIT;                          -- PostgreSQL 11+ cho phép COMMIT trong DO
    PERFORM pg_sleep(0.1);           -- nhường I/O cho traffic thật
  END LOOP;
END $$;
```

Bốn tính chất của backfill theo lô:

```text
· khoá ngắn                → không chặn traffic
· huỷ được giữa chừng      → phần đã làm vẫn giữ
· tiếp tục được            → điều kiện WHERE tự nhiên là "chưa làm"
· autovacuum theo kịp      → không bloat mất kiểm soát
```

Yêu cầu: backfill phải **idempotent** (`WHERE full_name IS NULL` đảm bảo điều đó) và cần index trên cột dùng để lọc.

### Đổi kiểu dữ liệu

```sql
-- ❌ viết lại toàn bộ bảng, giữ ACCESS EXCLUSIVE
ALTER TABLE orders ALTER COLUMN total TYPE bigint;
```

```sql
-- ✅ expand → migrate → contract
ALTER TABLE orders ADD COLUMN total_cents bigint;                    -- 1
-- code ghi cả hai
-- backfill theo lô: UPDATE orders SET total_cents = (total*100)::bigint WHERE total_cents IS NULL
ALTER TABLE orders ADD CONSTRAINT total_cents_nn
  CHECK (total_cents IS NOT NULL) NOT VALID;                          -- 2
ALTER TABLE orders VALIDATE CONSTRAINT total_cents_nn;
ALTER TABLE orders ALTER COLUMN total_cents SET NOT NULL;             -- nhanh nhờ CHECK đã validate
ALTER TABLE orders DROP CONSTRAINT total_cents_nn;
-- code chỉ dùng total_cents
ALTER TABLE orders DROP COLUMN total;                                 -- 3
```

Một số thay đổi kiểu **không** viết lại bảng (ví dụ `varchar(50)` → `varchar(100)`, `varchar` → `text`). Nhưng danh sách đó phụ thuộc version — luôn kiểm tra bằng `EXPLAIN`-tương đương: chạy thử trên bản sao dữ liệu thật và đo.

### Rollback: thứ hầu như không tồn tại

```text
Rollback CODE:    dễ — deploy image cũ
Rollback SCHEMA:  hầu như KHÔNG

DROP COLUMN đã chạy → dữ liệu MẤT. "Down migration" tạo lại cột rỗng.
UPDATE đã chạy      → giá trị cũ không còn ở đâu.
```

Vì thế chiến lược thực tế không phải "viết down migration tốt" mà là:

```text
① Mọi migration tương thích ngược ⇒ rollback CODE luôn an toàn
② Thao tác phá huỷ (DROP) tách thành deploy RIÊNG, sau vài ngày
③ Backup trước mọi migration lớn
④ Với thay đổi rủi ro cao: đổi tên thay vì xoá
   ALTER TABLE users RENAME COLUMN name TO name_deprecated_20260115;
   → có thể đổi ngược lại; xoá thật sau 30 ngày
```

Down migration hữu ích ở local và CI. Ở production, hãy thiết kế để **không cần** nó.

### Chạy migration ở đâu

```text
❌ onModuleInit của app
   → chạy trên MỌI replica, song song
   → thời gian khởi động phụ thuộc migration
   → không rollback được nếu app crash giữa chừng

✅ Bước riêng trong pipeline / K8s Job / initContainer với leader election
   → chạy đúng một lần
   → thất bại thì DỪNG deploy, phiên bản cũ vẫn phục vụ
   → log riêng, thời gian riêng, có thể huỷ
```

Với K8s, `Job` chạy trước khi cập nhật `Deployment` là mẫu chuẩn. Nhiều công cụ migration cũng có advisory lock riêng (Prisma, Flyway) để chống chạy song song — nhưng đừng dựa vào đó thay cho việc tách bước.

### Migration cũng là code review

Ba câu hỏi bắt buộc trong mọi PR có migration:

```text
1. Nó có tương thích với code ĐANG chạy ở production không?
2. Nó khoá bảng bao lâu trên dữ liệu THẬT (không phải staging)?
3. Nếu phải rollback code, schema này còn hoạt động không?
```

Công cụ hỗ trợ: `squawk` (linter cho migration PostgreSQL) bắt được phần lớn thao tác nguy hiểm tự động, và nên chạy trong CI.

## Example

Thêm cột `NOT NULL` có default vào bảng 50 triệu dòng, an toàn:

```sql
-- ═══ Deploy 1 ═══
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN currency text;              -- nullable, tức thì
-- code v2: ghi currency = 'VND' cho dòng mới; đọc coalesce(currency, 'VND')
```

```sql
-- ═══ Deploy 2 ═══ backfill theo lô (chạy như job riêng, có thể mất vài giờ)
DO $$
DECLARE updated int;
BEGIN
  LOOP
    UPDATE orders SET currency = 'VND'
    WHERE id IN (SELECT id FROM orders WHERE currency IS NULL LIMIT 5000);
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    COMMIT;
    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;

SET lock_timeout = '3s';
ALTER TABLE orders ADD CONSTRAINT currency_nn CHECK (currency IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT currency_nn;       -- khoá nhẹ, quét nền
ALTER TABLE orders ALTER COLUMN currency SET NOT NULL;    -- nhanh
ALTER TABLE orders DROP CONSTRAINT currency_nn;
ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'VND';
```

So với cách một bước:

```sql
-- ❌ trên 50 triệu dòng: viết lại bảng (nếu default không hằng),
--    hoặc ít nhất quét toàn bảng cho NOT NULL, giữ ACCESS EXCLUSIVE
ALTER TABLE orders ADD COLUMN currency text NOT NULL DEFAULT 'VND';
```

Trên PostgreSQL 11+ với default hằng số, câu này thật ra **nhanh** — nhưng nó vẫn cần `ACCESS EXCLUSIVE` trong khoảnh khắc, và nếu có transaction dài đang chạy thì bạn vẫn gặp vấn đề khoá dây chuyền. `lock_timeout` vẫn bắt buộc.

## Prediction

1. `ALTER TABLE ADD COLUMN x int` (nullable) trên bảng 50 triệu dòng — mất bao lâu để **chạy**?
2. Cùng câu đó khi có một transaction đang mở 60 giây — mất bao lâu để **hoàn tất**? Query khác thì sao?
3. Thêm `SET lock_timeout = '3s'` — kết quả cho migration và cho query khác?
4. `ADD COLUMN x int NOT NULL DEFAULT 0` trên PostgreSQL 16 — có viết lại bảng không?
5. `ADD COLUMN x timestamptz NOT NULL DEFAULT now()` — có viết lại bảng không? Vì sao khác câu 4?
6. `RENAME COLUMN name TO full_name`, rồi rolling update 3 pod — pod cũ thế nào?
7. `UPDATE users SET x = y` trên 50 triệu dòng trong một transaction — ba vấn đề?
8. Backfill theo lô bị huỷ ở lô thứ 200 — mất công không? Chạy lại thế nào?
9. Migration chạy trong `onModuleInit` với 3 replica — chuyện gì xảy ra?
10. `DROP COLUMN` rồi phát hiện sai, chạy down migration tạo lại cột — dữ liệu?
11. `ADD CONSTRAINT CHECK` không `NOT VALID` trên bảng lớn — `SELECT` có bị chặn không?
12. Code v2 cần cột mới, migration chạy **sau** khi rollout code — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **Vài mili giây** — chỉ ghi metadata, không đụng dữ liệu.
2. Chờ **60 giây** để lấy khoá. Và mọi query mới vào bảng đó **cũng chờ** (hàng đợi FIFO) — ứng dụng dừng 60 giây.
3. Migration fail sau 3 giây với `canceling statement due to lock timeout`. Query khác **không bị ảnh hưởng**. Bạn thử lại sau.
4. **Không** — từ PostgreSQL 11, default hằng số chỉ ghi metadata.
5. **Có** — `now()` không phải hằng số; mỗi dòng cần một giá trị, nên bảng bị viết lại.
6. Pod cũ query cột `name` không còn tồn tại → **lỗi mọi request** cho tới khi rollout xong.
7. (a) Khoá mọi dòng tới khi xong. (b) WAL khổng lồ, có thể đầy đĩa. (c) 50 triệu dead tuple → bloat. (Và huỷ giữa chừng = mất toàn bộ công.)
8. **Không mất công** — 199 lô đầu đã commit. Chạy lại: điều kiện `WHERE x IS NULL` tự bỏ qua phần đã làm.
9. Ba migration chạy song song. Công cụ tốt có advisory lock nên hai cái chờ; nhưng thời gian khởi động của app giờ phụ thuộc migration, và nếu migration lỗi thì app không start được.
10. **Dữ liệu đã mất.** Cột mới rỗng. Chỉ khôi phục được từ backup.
11. **Có** — `ACCESS EXCLUSIVE` chặn cả `SELECT`, trong suốt thời gian quét toàn bảng.
12. Code v2 lỗi cho mọi request cần cột đó, từ lúc rollout tới lúc migration xong. **Migration phải chạy trước.**
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Mở transaction dài, chạy `ALTER TABLE`, rồi `SELECT` từ session thứ ba | `SELECT` treo |
| Thêm `lock_timeout`, lặp lại | `SELECT` không bị ảnh hưởng |
| `ADD COLUMN ... DEFAULT 0` vs `DEFAULT now()` trên bảng 1 triệu dòng | So thời gian |
| `RENAME COLUMN` rồi chạy code cũ | Lỗi ngay |
| `UPDATE` 1 triệu dòng một transaction, xem `pg_wal` và `n_dead_tup` | WAL và bloat |
| Backfill theo lô, `Ctrl-C` giữa chừng, đếm dòng đã xong | Phần đã làm được giữ |
| Chạy lại backfill | Bỏ qua phần đã làm |
| `ADD CONSTRAINT` không `NOT VALID` trên bảng lớn, `SELECT` song song | Bị chặn |
| Với `NOT VALID` rồi `VALIDATE` | Không bị chặn |
| `CREATE INDEX` vs `CREATE INDEX CONCURRENTLY` với `INSERT` song song | Chặn vs không |
| Huỷ `CREATE INDEX CONCURRENTLY` giữa chừng, xem `pg_index.indisvalid` | Index `INVALID` còn lại |
| Chạy migration ở `onModuleInit` với 3 instance | Đọc log ba nơi |
| Chạy `squawk` trên thư mục migration hiện có | Đếm cảnh báo |

Dòng về `CREATE INDEX CONCURRENTLY` bị huỷ đáng nhớ: nó để lại một index **không hợp lệ** vẫn tốn chi phí ghi nhưng không được dùng. Phải `DROP INDEX` rồi tạo lại.

## What Usually Goes Wrong

- **Không có `lock_timeout`** → khoá dây chuyền, ứng dụng dừng. Nguyên nhân số một.
- **Migration không tương thích ngược** → downtime bằng thời gian rollout.
- **`RENAME`/`DROP` trong cùng deploy với code** → phiên bản cũ vỡ.
- **Backfill một transaction** → khoá lâu, WAL lớn, bloat, không huỷ được.
- **Migration chạy sau rollout code** → code mới lỗi cho tới khi migration xong.
- **Migration trong `onModuleInit`** → chạy song song, thời gian khởi động phụ thuộc migration.
- **`ADD CONSTRAINT` không `NOT VALID`** trên bảng lớn → chặn cả đọc.
- **`CREATE INDEX` không `CONCURRENTLY`** → chặn ghi.
- **Huỷ `CREATE INDEX CONCURRENTLY`** → index `INVALID` bị bỏ quên.
- **Tin vào down migration** → dữ liệu đã mất không quay lại được.
- **Không test trên dữ liệu thật** → thời gian và khoá khác hoàn toàn.
- **Không backup trước migration lớn** → không có đường lui.
- **Nhiều thay đổi trong một migration** → thất bại giữa chừng, trạng thái không rõ.
- **Migration phụ thuộc thứ tự chạy mà không khai báo** → chạy lại ở môi trường mới thì lỗi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Migration nhanh nên an toàn | Thời gian **chờ khoá** mới là vấn đề |
| `ADD COLUMN` luôn tức thì | Với default không hằng, nó viết lại bảng |
| Down migration cho phép rollback | Dữ liệu đã xoá không quay lại |
| Staging đủ để kiểm chứng | Không có traffic đồng thời, không có dữ liệu thật |
| Rolling update chạy một phiên bản | Hai phiên bản song song vài phút |
| Migration nên chạy khi app khởi động | Bước riêng, một lần, trước rollout |
| Đổi tên cột là thao tác nhỏ | Nó phá vỡ mọi code đang chạy |
| `DROP COLUMN` giải phóng dung lượng ngay | Chỉ đánh dấu; cần `VACUUM FULL`/`pg_repack` |
| Transaction bao quanh migration làm nó an toàn | Nó làm khoá giữ lâu hơn |
| `CREATE INDEX CONCURRENTLY` không có rủi ro | Huỷ giữa chừng để lại index `INVALID` |

## Debugging

1. **Migration treo** → xem ai giữ khoá:
   ```sql
   SELECT blocked.pid, left(blocked.query,50) AS blocked_query,
          blocking.pid AS by_pid, left(blocking.query,50) AS blocking_query
   FROM pg_stat_activity blocked
   JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
   ```
2. **Ứng dụng dừng khi migrate** → gần như chắc chắn là khoá dây chuyền. Huỷ migration (`pg_cancel_backend`) là cách khôi phục nhanh nhất.
3. **Lỗi sau khi deploy** → phiên bản nào lỗi? Nếu là phiên bản **cũ**, migration không tương thích ngược.
4. **Backfill chậm** → đo thời gian một lô, nhân với số lô. Nếu quá lâu, tăng `batch_size` hoặc giảm `pg_sleep`, và theo dõi ảnh hưởng tới traffic.
5. **Kiểm tra index `INVALID`**:
   ```sql
   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
   ```
6. **Migration đã chạy hay chưa** — bảng lịch sử của công cụ (`_prisma_migrations`, `schema_migrations`, `flyway_schema_history`).
7. **Schema thật khác schema mong đợi** → `pg_dump --schema-only` rồi diff với schema trong repo. Drift thường đến từ thay đổi thủ công.

## Production Considerations

- **`SET lock_timeout` ở đầu mọi migration.** Một dòng, chặn cả một lớp sự cố.
- **Migration là bước riêng**, chạy trước rollout, thất bại thì dừng deploy.
- **Expand → migrate → contract** cho mọi thay đổi phá vỡ. Ba deploy thay vì một.
- **Backfill theo lô, ngoài giờ cao điểm**, với `pg_sleep` giữa các lô.
- **Test trên bản sao dữ liệu production** — đây là cách duy nhất biết thời gian thật và khoá thật.
- **Backup (hoặc snapshot) trước migration lớn**, và biết RTO của việc restore.
- **Một migration làm một việc.** Thất bại giữa chừng của migration nhiều bước để lại trạng thái không rõ.
- **`squawk` hoặc tương đương trong CI** để chặn thao tác nguy hiểm tự động.
- **Thao tác phá huỷ tách thành deploy riêng**, sau vài ngày, và tốt hơn là đổi tên trước rồi mới xoá.
- **Ghi lại thời gian dự kiến** trong PR của migration lớn, và ai đứng canh khi chạy.
- **Với bảng rất lớn, cân nhắc công cụ chuyên biệt** (`pg_repack` cho viết lại bảng) thay vì `ALTER` trực tiếp.
- **Kiểm tra schema drift định kỳ** giữa production và repo — thay đổi thủ công lúc 2 giờ sáng sẽ xảy ra.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Expand-migrate-contract | không downtime | 3 deploy, code phải hỗ trợ cả hai |
| Migration một bước | nhanh, đơn giản | downtime bằng thời gian rollout |
| `lock_timeout` ngắn | không gây khoá dây chuyền | migration phải thử lại nhiều lần |
| Không `lock_timeout` | chắc chắn chạy được | rủi ro dừng ứng dụng |
| Backfill theo lô | không chặn traffic, huỷ được | mất nhiều giờ, cần theo dõi |
| Backfill một lần | nhanh, đơn giản | khoá lâu, WAL lớn, bloat |
| Đổi tên rồi xoá sau | có đường lui | cột thừa tồn tại một thời gian |
| Xoá thẳng | gọn | không hồi phục được |
| Migration trong CI/CD | tự động, nhất quán | cần quyền, cần xử lý thất bại |
| Migration thủ công | kiểm soát, có người canh | dễ quên, dễ lệch giữa môi trường |

## Explain Without Notes

1. Vì sao một migration chạy 2ms có thể gây downtime 40 giây?
2. Quy tắc tương thích ngược phát biểu thế nào, và nó đến từ đâu?
3. Ba bước của expand-migrate-contract, với ví dụ đổi tên cột.
4. Vì sao backfill phải theo lô? Kể bốn lợi ích.
5. Vì sao down migration không phải chiến lược rollback thật?
6. Vì sao migration không nên chạy trong `onModuleInit`?
7. `ADD COLUMN ... DEFAULT 0` và `DEFAULT now()` khác nhau thế nào, và vì sao?

## Related

- [Constraints & invariants](01-constraints-invariants.md) — `NOT VALID` → `VALIDATE`
- [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) — khoá dây chuyền, `lock_timeout`
- [MVCC & vacuum](../01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) — vì sao `UPDATE` hàng loạt gây bloat
- [Normalization](02-normalization.md) — thay đổi mô hình dữ liệu
- [Relationships & cardinality](03-relationships-cardinality.md) — đổi quan hệ là migration lớn
- [CI/CD pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — migration ở đâu trong pipeline
- [Rollout & rollback](../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) — hai phiên bản song song
- [WAL, durability & backup](../01-postgresql/operations/01-wal-durability-backup.md) — backup trước migration
- [Config & lifecycle](../../02-backend-api/02-nestjs/behavior/05-config-lifecycle.md) — vì sao không chạy ở `onModuleInit`

## Version / Context

PostgreSQL 16. `ADD COLUMN ... DEFAULT <hằng>` không viết lại bảng từ 11. `COMMIT` trong khối `DO`/procedure từ 11. Tối ưu `SET NOT NULL` dựa trên `CHECK` đã validate từ 12. `REINDEX CONCURRENTLY` từ 12. Linter: `squawk`.
