---
level: advanced
area: database
prerequisites:
  - 01-transaction-isolation.md
  - 04-mvcc-vacuum.md
related:
  - ../03-data-modeling/04-migrations.md
  - ../../05-cross-cutting/concurrency/03-distributed-locks.md
---

# Locking & deadlock

> Bạn thêm một cột vào bảng `users`. Migration chạy 2 mili giây trên staging. Trên production nó treo — và trong 40 giây tiếp theo **mọi** query chạm bảng `users` cũng treo, kể cả `SELECT`. Toàn bộ ứng dụng dừng. Rồi migration hoàn tất và mọi thứ trở lại bình thường như chưa có gì xảy ra.

## Position

```text
Transaction  →  yêu cầu khoá  →  cấp ngay  hoặc  XẾP HÀNG
                                              ↓
                                        hàng đợi khoá  ← nơi ứng dụng "treo"
                                              ↓
                                       deadlock detector (mỗi 1 giây)
```

MVCC lo phần đọc — đọc không cần khoá. Khoá tồn tại cho phần **ghi**, và cho những thao tác thay đổi cấu trúc.

## Problem

MVCC cho phép đọc và ghi song song, nhưng nó không giải quyết được hai transaction cùng **ghi** vào một dòng. Ở đó phải có ai đó chờ.

Ba loại vấn đề khoá, khác nhau hoàn toàn về nguyên nhân và cách sửa:

```text
1. CHỜ           B chờ A. Bình thường, trừ khi A quá lâu.
2. DEADLOCK      A chờ B, B chờ A. PostgreSQL phát hiện và giết một cái.
3. KHOÁ DÂY CHUYỀN  Một DDL chờ một transaction dài, và MỌI query mới xếp hàng
                    SAU nó. Đây là cái làm sập ứng dụng.
```

Loại 3 là sự cố ở đầu note, và nó phản trực giác vì `SELECT` bình thường không bao giờ chờ `SELECT` khác.

## Mental Model

### Khoá ở hai mức

```text
ROW LOCK    tự động khi UPDATE/DELETE, hoặc tường minh với SELECT ... FOR UPDATE
            → chỉ ảnh hưởng dòng đó

TABLE LOCK  tự động ở mọi câu lệnh, với mức độ khác nhau
            → có thể ảnh hưởng TOÀN BỘ bảng
```

Bảng khoá ở mức bảng, rút gọn còn phần cần nhớ:

```text
Mức khoá                    Do câu lệnh nào     Chặn cái gì
ACCESS SHARE                SELECT              chỉ chặn ACCESS EXCLUSIVE
ROW SHARE                   SELECT FOR UPDATE   ...
ROW EXCLUSIVE               INSERT/UPDATE/DELETE chặn DDL, không chặn nhau
SHARE                       CREATE INDEX        chặn mọi GHI
SHARE ROW EXCLUSIVE         CREATE TRIGGER      ...
EXCLUSIVE                   REFRESH MAT VIEW CONCURRENTLY  chặn mọi thứ trừ SELECT
ACCESS EXCLUSIVE            ALTER TABLE, DROP,  chặn MỌI THỨ, kể cả SELECT
                            VACUUM FULL, TRUNCATE
```

Hai dòng đáng thuộc:

- **`ROW EXCLUSIVE` không chặn nhau.** Hai `UPDATE` vào hai dòng khác nhau chạy song song bình thường.
- **`ACCESS EXCLUSIVE` chặn cả `SELECT`.** Đây là mức mà `ALTER TABLE` lấy.

### Vì sao một `ALTER TABLE` nhanh lại làm sập ứng dụng

Đây là cơ chế quan trọng nhất trong note này:

```text
t=0    Transaction A (báo cáo) đang chạy:  SELECT ... FROM users  (mất 60 giây)
       → A giữ ACCESS SHARE trên users

t=1    ALTER TABLE users ADD COLUMN x int;
       → cần ACCESS EXCLUSIVE
       → xung đột với ACCESS SHARE của A
       → ALTER XẾP HÀNG

t=2    SELECT * FROM users WHERE id = 1;    (một request bình thường)
       → cần ACCESS SHARE
       → KHÔNG xung đột với A...
       → NHƯNG hàng đợi khoá là FIFO: nó xếp hàng SAU ALTER
       → TREO

t=3..  Mọi query mới chạm users đều treo. Ứng dụng dừng.

t=60   A xong → ALTER chạy (2ms) → hàng đợi giải phóng
```

**Hàng đợi khoá của PostgreSQL là FIFO.** Một yêu cầu khoá mạnh đang chờ sẽ chặn mọi yêu cầu khoá yếu đến sau nó, kể cả những yêu cầu vốn tương thích với transaction đang giữ khoá.

Đây là lý do một migration "vô hại" có thể gây downtime, và vì sao nó không bao giờ xảy ra trên staging (staging không có query dài chạy song song).

Cách phòng, và nó chỉ là một dòng:

```sql
SET lock_timeout = '3s';
ALTER TABLE users ADD COLUMN x int;
-- không lấy được khoá trong 3 giây → HUỶ, thử lại sau
-- Thà migration fail còn hơn ứng dụng dừng 60 giây.
```

### `FOR UPDATE` và các biến thể

```sql
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;         -- khoá ghi, người khác CHỜ
SELECT * FROM accounts WHERE id = 1 FOR NO KEY UPDATE;  -- yếu hơn, cho phép FK tham chiếu
SELECT * FROM accounts WHERE id = 1 FOR SHARE;          -- nhiều người đọc-khoá cùng lúc
SELECT * FROM accounts WHERE id = 1 FOR UPDATE NOWAIT;  -- LỖI ngay nếu bận
SELECT * FROM accounts WHERE id = 1 FOR UPDATE SKIP LOCKED;  -- BỎ QUA dòng bận
```

`SKIP LOCKED` là công cụ chuẩn để làm hàng đợi công việc trong PostgreSQL:

```sql
-- nhiều worker cùng lấy job mà không giẫm lên nhau, không ai chờ ai
WITH next_job AS (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE jobs SET status = 'running', started_at = now()
FROM next_job WHERE jobs.id = next_job.id
RETURNING jobs.*;
```

Không có `SKIP LOCKED`, mọi worker sẽ xếp hàng chờ cùng một dòng và bạn có một hàng đợi tuần tự.

### Deadlock

```text
Transaction A                    Transaction B
UPDATE accounts SET .. id = 1    UPDATE accounts SET .. id = 2
  (giữ khoá dòng 1)                (giữ khoá dòng 2)
UPDATE accounts SET .. id = 2    UPDATE accounts SET .. id = 1
  (chờ B)                          (chờ A)
                    ⇒ DEADLOCK
```

PostgreSQL chạy deadlock detector mỗi `deadlock_timeout` (mặc định 1 giây), phát hiện chu trình, và **giết một transaction** với `40P01`:

```text
ERROR: deadlock detected
DETAIL: Process 123 waits for ShareLock on transaction 456; blocked by process 789.
        Process 789 waits for ShareLock on transaction 455; blocked by process 123.
```

Cách phòng gần như miễn phí — **luôn khoá theo một thứ tự cố định**:

```ts
const [first, second] = [fromId, toId].sort();   // thứ tự toàn cục, bất kể chiều chuyển tiền
await tx.$queryRaw`SELECT * FROM accounts WHERE id IN (${first}, ${second}) FOR UPDATE`;
```

Bốn nguồn deadlock ít rõ ràng hơn:

```text
1. Foreign key       INSERT vào bảng con lấy khoá trên dòng cha
                     → hai INSERT theo thứ tự cha khác nhau ⇒ deadlock

2. UPDATE hàng loạt  UPDATE ... WHERE status = 'x' khoá theo thứ tự PLANNER chọn
                     → hai câu lệnh có thể đi ngược chiều nhau
                     → thêm ORDER BY vào một sub-select với FOR UPDATE

3. Trigger           trigger ghi vào bảng khác → thứ tự khoá ẩn

4. Index unique      hai INSERT cùng giá trị unique chờ nhau
```

Và vì deadlock là lỗi **tạm thời**, nó nằm trong nhóm hiếm hoi đáng retry tự động.

### Advisory lock: khoá không gắn với dòng nào

```sql
-- khoá theo transaction, tự thả khi COMMIT/ROLLBACK  ← nên dùng cái này
SELECT pg_advisory_xact_lock(hashtext('import:daily'));

-- khoá theo session, phải thả TAY — dễ rò rỉ
SELECT pg_advisory_lock(12345);
SELECT pg_advisory_unlock(12345);

-- không chờ
SELECT pg_try_advisory_xact_lock(12345);   -- true/false ngay lập tức
```

Dùng cho: "chỉ một instance được chạy job này", "chỉ một migration chạy tại một thời điểm". Đây là một lựa chọn tốt hơn Redis lock **khi bạn đã có PostgreSQL** — nó không có TTL nên không có vấn đề "lock hết hạn giữa chừng". Xem [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md).

Cảnh báo: không gian khoá là **toàn cục cho cả database**. Dùng `hashtext('tên có ý nghĩa')` thay vì số ngẫu nhiên, và ghi lại danh sách khoá bạn dùng — nếu không, hai tính năng khác nhau sẽ dùng trùng số.

## Example

Tái hiện sự cố khoá dây chuyền trong ba cửa sổ `psql`:

```sql
-- Session 1: mô phỏng một báo cáo dài
BEGIN;
SELECT count(*) FROM users;
-- để mở, KHÔNG commit
```

```sql
-- Session 2: migration
ALTER TABLE users ADD COLUMN test_col int;
-- TREO — chờ ACCESS EXCLUSIVE
```

```sql
-- Session 3: một request bình thường
SELECT * FROM users LIMIT 1;
-- CŨNG TREO — xếp hàng sau session 2, dù nó không xung đột với session 1
```

```sql
-- Session 4: xem toàn cảnh
SELECT a.pid, a.state, now() - a.xact_start AS age,
       a.wait_event_type, pg_blocking_pids(a.pid) AS blocked_by, left(a.query, 50)
FROM pg_stat_activity a
WHERE a.datname = current_database() AND a.pid <> pg_backend_pid();
```

Rồi lặp lại với `SET lock_timeout = '2s';` trước `ALTER TABLE` ở session 2, và quan sát: ALTER fail sau 2 giây, session 3 chạy bình thường ngay. **Ứng dụng không bao giờ dừng.**

Ba phút thí nghiệm này giải thích một lớp sự cố production mà nhiều người mất nhiều năm mới gặp và hiểu.

## Prediction

1. Hai `UPDATE` vào **hai dòng khác nhau** cùng bảng — có chờ nhau không?
2. Hai `UPDATE` vào **cùng một dòng** — cái thứ hai thế nào?
3. `SELECT` bình thường trong khi có `UPDATE` trên cùng dòng — có chờ không?
4. `ALTER TABLE ADD COLUMN` trong khi có một `SELECT` chạy 60 giây — mất bao lâu?
5. Trong 60 giây đó, một `SELECT` mới đến — nó chạy hay chờ? Vì sao?
6. Thêm `SET lock_timeout = '2s'` trước `ALTER` — kết quả cho cả ba?
7. A khoá dòng 1 rồi 2; B khoá dòng 2 rồi 1 — kết quả và mã lỗi?
8. Thêm `.sort()` cho thứ tự khoá — kết quả?
9. 10 worker cùng chạy `SELECT ... FOR UPDATE LIMIT 1` trên bảng jobs — chuyện gì xảy ra?
10. Thêm `SKIP LOCKED` — chuyện gì xảy ra?
11. `pg_advisory_lock` (session-level) và connection bị trả về pool mà chưa unlock — hậu quả?
12. `CREATE INDEX` (không `CONCURRENTLY`) trên bảng đang có `INSERT` — `INSERT` thế nào?
13. `SELECT` trong lúc `CREATE INDEX` thường chạy — có chờ không?

<details>
<summary>Đáp án</summary>

1. **Không** — khoá ở mức dòng.
2. **Chờ** cho tới khi transaction đầu commit hoặc rollback.
3. **Không** — MVCC; `SELECT` đọc version cũ.
4. **60 giây** (chờ) + 2ms (chạy).
5. **Chờ.** Hàng đợi FIFO: nó xếp sau `ALTER` đang chờ, dù nó tương thích với `SELECT` dài.
6. `ALTER` fail sau 2 giây với `canceling statement due to lock timeout`. `SELECT` dài chạy tiếp. `SELECT` mới **không bị chặn**.
7. Deadlock. PostgreSQL giết một transaction với `40P01 deadlock detected` sau ~1 giây.
8. Không deadlock — B chờ A rồi chạy.
9. Chín worker **xếp hàng** chờ cùng một dòng. Hàng đợi trở thành tuần tự.
10. Mỗi worker lấy một dòng khác nhau, không ai chờ. Đây là hành vi mong muốn.
11. Khoá **không được thả**. Connection tiếp theo mượn nó vẫn giữ khoá → deadlock logic hoặc job không bao giờ chạy được nữa. Đây là lý do luôn dùng `pg_advisory_xact_lock`.
12. `INSERT` **bị chặn** — `CREATE INDEX` lấy `SHARE`, xung đột với `ROW EXCLUSIVE`.
13. **Không chờ** — `SHARE` không xung đột với `ACCESS SHARE`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Kịch bản ba session ở phần Example | Query bình thường bị treo |
| Thêm `lock_timeout` rồi lặp lại | Không bị treo |
| Hai script `UPDATE` hai dòng theo thứ tự ngược nhau, chạy song song | Deadlock sau ~1 giây |
| Thêm `.sort()` | Deadlock biến mất |
| `INSERT` vào bảng con theo thứ tự cha ngược nhau | Deadlock qua khoá FK |
| 10 worker lấy job không `SKIP LOCKED` | Đo throughput |
| Thêm `SKIP LOCKED` | Đo lại — khác biệt lớn |
| `pg_advisory_lock` rồi đóng connection mà không unlock | Khoá thả khi session kết thúc, nhưng với pool thì session không kết thúc |
| Đổi sang `pg_advisory_xact_lock` | Thả khi commit |
| `CREATE INDEX` vs `CREATE INDEX CONCURRENTLY` với `INSERT` song song | Chặn vs không chặn |
| `TRUNCATE` trong khi có `SELECT` chạy | `ACCESS EXCLUSIVE` — chờ |
| `UPDATE ... WHERE status = 'x'` hai chiều trên tập giao nhau | Deadlock do thứ tự planner |

## What Usually Goes Wrong

- **DDL không có `lock_timeout`** → khoá dây chuyền, ứng dụng dừng. Sự cố migration phổ biến nhất.
- **Không có thứ tự khoá cố định** → deadlock ngẫu nhiên dưới tải.
- **Không retry deadlock** → 500 ngẫu nhiên không tái hiện được.
- **Transaction dài giữ khoá** → mọi thứ sau nó chờ.
- **Hàng đợi job không `SKIP LOCKED`** → worker tuần tự hoá, throughput bằng một worker.
- **`pg_advisory_lock` session-level với connection pool** → khoá rò rỉ theo connection.
- **`CREATE INDEX` không `CONCURRENTLY`** → chặn ghi.
- **`ALTER TABLE` nhiều thao tác trong một câu** → giữ `ACCESS EXCLUSIVE` lâu hơn cần thiết.
- **Deadlock qua FK không nhận ra** → tìm mãi trong code ứng dụng.
- **`UPDATE` hàng loạt không `ORDER BY`** → thứ tự khoá do planner quyết định, không tất định.
- **Không đo lock wait** → chỉ thấy "app chậm".

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `SELECT` không bao giờ bị chặn | Bị chặn bởi `ACCESS EXCLUSIVE`, và bởi hàng đợi FIFO |
| `ALTER TABLE ADD COLUMN` luôn nhanh | Việc *chạy* nhanh; việc *chờ khoá* thì không |
| Deadlock là bug phải sửa bằng cách bỏ khoá | Là hệ quả của thứ tự khoá; sửa bằng thứ tự + retry |
| PostgreSQL treo mãi khi deadlock | Nó phát hiện sau ~1 giây và giết một cái |
| `FOR UPDATE` chặn cả đọc thường | Không — MVCC vẫn cho đọc |
| Khoá ở mức bảng chỉ do DDL | `CREATE INDEX`, `TRUNCATE`, `VACUUM FULL` cũng vậy |
| Advisory lock gắn với một bảng | Nó là số toàn cục cho cả database |
| Yêu cầu khoá đang chờ không ảnh hưởng ai | Nó chặn mọi yêu cầu đến sau (FIFO) |
| `lock_timeout` và `statement_timeout` như nhau | `lock_timeout` chỉ giới hạn thời gian **chờ khoá** |

## Debugging

1. **Ai chờ ai** — câu lệnh quan trọng nhất:
   ```sql
   SELECT blocked.pid AS blocked_pid, left(blocked.query, 60) AS blocked_query,
          blocking.pid AS blocking_pid, left(blocking.query, 60) AS blocking_query,
          now() - blocked.query_start AS waiting_for
   FROM pg_stat_activity blocked
   JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
   ORDER BY waiting_for DESC;
   ```
2. **Xem khoá chi tiết**: `SELECT * FROM pg_locks WHERE NOT granted;`
3. **Tìm transaction dài**: `pg_stat_activity` sắp theo `now() - xact_start`.
4. **Deadlock trong log**: bật `log_lock_waits = on` và `deadlock_timeout = '1s'` — PostgreSQL sẽ log cả hai câu lệnh tham gia deadlock, đó là thông tin bạn cần để tìm thứ tự khoá.
5. **Giải cứu khẩn cấp**: `pg_cancel_backend(pid)` (huỷ query, nhẹ nhàng) rồi `pg_terminate_backend(pid)` (giết session) nếu không được.
6. **Sau sự cố**: đọc log tìm `deadlock detected` và `process ... still waiting for ... after ...ms`.

## Production Considerations

- **Mọi migration bắt đầu bằng `SET lock_timeout`.** Đây là dòng có giá trị cao nhất trong toàn bộ note.
  ```sql
  SET lock_timeout = '3s';
  SET statement_timeout = '30s';
  ALTER TABLE ... ;
  ```
- **Chia `ALTER TABLE` nhiều thao tác thành nhiều câu lệnh riêng**, mỗi câu giữ khoá ngắn nhất có thể.
- **`CREATE INDEX CONCURRENTLY`** luôn luôn ở production.
- **Retry deadlock (`40P01`) và serialization failure (`40001`)** với backoff + jitter, tối đa 3 lần.
- **Thứ tự khoá cố định** — ghi thành quy ước trong codebase, không để mỗi người tự nghĩ.
- **`SKIP LOCKED` cho mọi hàng đợi trong DB.**
- **`pg_advisory_xact_lock`, không bao giờ dùng `pg_advisory_lock`** khi có connection pool.
- **`log_lock_waits = on`** để biết khi nào có ai chờ khoá quá `deadlock_timeout`.
- **Alert trên số deadlock/phút** và trên transaction > 5 phút.
- **Với bảng rất nóng** (một dòng counter được cập nhật hàng nghìn lần/giây), khoá dòng trở thành nút thắt. Giải pháp là chia nhỏ: nhiều dòng counter cộng lại khi đọc, hoặc chuyển sang Redis rồi định kỳ đồng bộ.
- **Migration lớn nên tách khỏi deploy code** — chạy trong cửa sổ riêng, có thể huỷ và thử lại.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `FOR UPDATE` | chính xác, dễ hiểu | tạo hàng đợi, rủi ro deadlock |
| Optimistic lock | không khoá, mở rộng tốt | client phải retry |
| `SKIP LOCKED` | worker song song thật sự | thứ tự xử lý không đảm bảo |
| `NOWAIT` | fail nhanh, rõ ràng | phải xử lý lỗi ở app |
| `lock_timeout` ngắn | không gây khoá dây chuyền | migration có thể phải thử lại nhiều lần |
| `lock_timeout` dài / không có | migration chắc chắn xong | rủi ro dừng ứng dụng |
| Advisory lock | không cần bảng, không TTL | không gian tên toàn cục, dễ trùng |
| Redis lock | không đụng DB | có TTL → lock có thể hết hạn giữa chừng |
| Retry deadlock | chịu tranh chấp | ẩn vấn đề thiết kế nếu tỉ lệ cao |
| Chia nhỏ dòng nóng | throughput cao | đọc phải cộng lại, phức tạp |

## Explain Without Notes

1. Vì sao `SELECT` bị treo khi có một `ALTER TABLE` đang chờ, dù `SELECT` không xung đột với transaction đang giữ khoá?
2. `lock_timeout` giải quyết vấn đề đó thế nào, và vì sao "migration fail" là kết quả tốt hơn?
3. Deadlock xảy ra thế nào? Cách phòng gần như miễn phí là gì?
4. Ba nguồn deadlock không rõ ràng (không phải hai `UPDATE` trực tiếp)?
5. `SKIP LOCKED` giải quyết vấn đề gì trong hàng đợi công việc?
6. Vì sao `pg_advisory_lock` nguy hiểm với connection pool?
7. Câu lệnh nào cho biết "ai đang chờ ai" ngay lập tức?

## Related

- [Transaction isolation](01-transaction-isolation.md) — MVCC, `FOR UPDATE`, optimistic lock
- [MVCC & vacuum](04-mvcc-vacuum.md) — `VACUUM FULL` và `ACCESS EXCLUSIVE`
- [Connection pool](03-connection-pool.md) — transaction dài giữ cả connection lẫn khoá
- [Migrations](../03-data-modeling/04-migrations.md) — DDL an toàn ở production
- [Index & query plan](02-index-query-plan.md) — `CREATE INDEX CONCURRENTLY`
- [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md) — advisory lock vs Redis lock
- [Shared state & races](../../05-cross-cutting/concurrency/02-shared-state-races.md)
- [Vì sao cần queue](../04-message-queues/01-why-queue.md) — `SKIP LOCKED` làm hàng đợi

## Version / Context

PostgreSQL 16. `SKIP LOCKED` và `NOWAIT` từ 9.5. `pg_blocking_pids()` từ 9.6. `lock_timeout` từ 9.3. Mặc định `deadlock_timeout = 1s`.
