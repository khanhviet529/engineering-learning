---
level: advanced
area: database
prerequisites:
  - ../../00-sql/01-relational-thinking.md
related:
  - 02-mvcc-vacuum.md
  - 03-locking-deadlock.md
  - ../../../05-cross-cutting/concurrency/02-shared-state-races.md
---

# Transaction isolation

> Hệ thống bán vé có 100 vé. Log ghi nhận 103 vé được bán. Không có bug logic: code kiểm tra `if (remaining > 0)` trước mỗi lần bán, và kiểm tra đó **đúng** ở thời điểm nó chạy. Ba request đồng thời đều thấy `remaining = 1`, và cả ba đều đúng.

## Position

```text
NestJS service  →  BEGIN ... COMMIT   ← ranh giới bạn chọn
                      ↓
                   PostgreSQL: MVCC snapshot, lock
                      ↓
                   WAL → disk
```

Isolation level là **hợp đồng về những gì một transaction được phép nhìn thấy** khi có transaction khác chạy song song. Chọn sai không gây lỗi — nó gây dữ liệu sai.

## Problem

Một transaction đơn lẻ dễ hiểu: `BEGIN`, làm vài việc, `COMMIT`, tất cả hoặc không gì cả. Vấn đề bắt đầu khi có **hai** transaction cùng lúc.

```ts
// bán vé — trông hoàn toàn đúng
const { remaining } = await tx.query('SELECT remaining FROM events WHERE id = $1', [id]);
if (remaining <= 0) throw new SoldOutError();
await tx.query('UPDATE events SET remaining = remaining - 1 WHERE id = $1', [id]);
```

Ba request đồng thời khi `remaining = 1`:

```text
t=0   A: SELECT → remaining = 1   ✓ qua kiểm tra
t=0   B: SELECT → remaining = 1   ✓ qua kiểm tra
t=0   C: SELECT → remaining = 1   ✓ qua kiểm tra
t=1   A: UPDATE remaining = 0
t=1   B: UPDATE remaining = -1
t=1   C: UPDATE remaining = -2
```

Ba vé được bán khi chỉ còn một. Đây **không** phải bug của bạn theo nghĩa thông thường — mỗi transaction đọc một trạng thái nhất quán và ra quyết định đúng dựa trên nó. Cái sai là **giả định rằng thế giới không đổi giữa `SELECT` và `UPDATE`**.

Và điểm quan trọng: bug này **không xuất hiện ở local**. Nó cần hai request thật sự đồng thời, và bạn hiếm khi tạo ra điều đó khi test bằng tay.

## Mental Model

### Isolation trả lời: "transaction của tôi thấy gì?"

```text
SERIALIZABLE      như thể mọi transaction chạy LẦN LƯỢT
REPEATABLE READ   snapshot cố định từ câu lệnh đầu tiên tới hết transaction
READ COMMITTED    mỗi CÂU LỆNH thấy dữ liệu đã commit tại thời điểm nó bắt đầu  ← MẶC ĐỊNH
READ UNCOMMITTED  (PostgreSQL xử lý như READ COMMITTED — không có dirty read)
```

Càng lên trên càng an toàn, càng dễ bị xung đột và phải retry.

### Bốn anomaly, và cái nào bị chặn ở đâu

```text                          RC          RR          SER
Dirty read                    không        không       không     (PostgreSQL không bao giờ có)
Non-repeatable read           CÓ THỂ       không       không
Phantom read                  CÓ THỂ       không*      không
Lost update                   CÓ THỂ       phát hiện   phát hiện
Write skew                    CÓ THỂ       CÓ THỂ      không
```

\* PostgreSQL dùng snapshot isolation cho `REPEATABLE READ`, nên nó chặn phantom read — mạnh hơn chuẩn SQL yêu cầu.

Từng anomaly bằng ví dụ cụ thể:

```text
NON-REPEATABLE READ (chỉ ở READ COMMITTED)
  A: SELECT balance → 100
  B: UPDATE balance = 50; COMMIT
  A: SELECT balance → 50        ← cùng transaction, hai kết quả khác nhau

PHANTOM READ (chỉ ở READ COMMITTED)
  A: SELECT count(*) WHERE status='open' → 5
  B: INSERT một dòng open; COMMIT
  A: SELECT count(*) WHERE status='open' → 6   ← dòng "ma" xuất hiện

LOST UPDATE
  A: SELECT qty → 10
  B: SELECT qty → 10
  A: UPDATE qty = 10 - 1 = 9; COMMIT
  B: UPDATE qty = 10 - 1 = 9; COMMIT           ← trừ hai lần, kết quả 9 thay vì 8

WRITE SKEW  (đây là cái tinh vi nhất)
  Quy tắc: "luôn phải có ít nhất 1 bác sĩ trực"
  A: SELECT count(*) WHERE on_call → 2, ok, tôi nghỉ được
  B: SELECT count(*) WHERE on_call → 2, ok, tôi nghỉ được
  A: UPDATE me SET on_call = false; COMMIT
  B: UPDATE me SET on_call = false; COMMIT     ← 0 bác sĩ trực. Cả hai đều "đúng".
```

Write skew đặc biệt vì hai transaction **ghi vào hai dòng khác nhau** — không có xung đột nào để phát hiện ở mức dòng. Chỉ `SERIALIZABLE` bắt được.

### Điều quan trọng nhất về `READ COMMITTED`

Mặc định của PostgreSQL là `READ COMMITTED`, và tính chất của nó hay bị hiểu sai:

> **Mỗi CÂU LỆNH lấy một snapshot mới**, không phải mỗi transaction.

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1;   -- 100
-- transaction khác COMMIT một UPDATE ở đây
SELECT balance FROM accounts WHERE id = 1;   -- 50   ← khác!
COMMIT;
```

Nghĩa là: **bạn không thể tin vào giá trị vừa đọc ở câu lệnh trước.** Đó là toàn bộ nguồn gốc của bug bán vé.

Và một hành vi riêng của `UPDATE` trong `READ COMMITTED`:

```text
A: UPDATE accounts SET balance = balance - 10 WHERE id = 1;   -- giữ lock
B: UPDATE accounts SET balance = balance - 10 WHERE id = 1;   -- CHỜ A
A: COMMIT
B: đọc LẠI dòng (giá trị mới nhất) rồi áp dụng UPDATE
```

Đây gọi là "re-check". Nó là lý do `UPDATE ... SET x = x - 1` **an toàn** trong khi `SELECT` rồi `UPDATE x = <giá trị tính ở app>` thì không.

## How It Works

### Ba cách sửa bug bán vé

```sql
-- CÁCH 1: cập nhật nguyên tử + constraint. Đơn giản nhất, an toàn nhất.
UPDATE events SET remaining = remaining - 1
WHERE id = $1 AND remaining > 0
RETURNING remaining;
-- 0 dòng trả về = hết vé. Không có khe hở nào giữa kiểm tra và ghi.

-- và phòng tuyến cuối trong schema:
ALTER TABLE events ADD CONSTRAINT remaining_non_negative CHECK (remaining >= 0);
```

```sql
-- CÁCH 2: pessimistic lock. Khi cần đọc rồi tính toán phức tạp.
BEGIN;
SELECT remaining FROM events WHERE id = $1 FOR UPDATE;   -- khoá dòng, B phải CHỜ
-- ... logic phức tạp ...
UPDATE events SET remaining = remaining - 1 WHERE id = $1;
COMMIT;
```

```sql
-- CÁCH 3: optimistic lock. Khi xung đột hiếm và không muốn khoá.
UPDATE events SET remaining = remaining - 1, version = version + 1
WHERE id = $1 AND version = $2;
-- 0 dòng = có người khác đã sửa → báo lỗi cho client hoặc retry
```

Chọn thế nào:

| Tình huống | Cách |
|---|---|
| Cập nhật một cột dựa trên chính nó | **1** — nguyên tử, không khoá gì thêm |
| Đọc nhiều dòng, tính toán, rồi ghi | **2** — `FOR UPDATE` |
| Xung đột hiếm, người dùng sửa form lâu | **3** — báo "dữ liệu đã thay đổi" |
| Quy tắc xuyên nhiều dòng (write skew) | `SERIALIZABLE` + retry |

Cách 1 nên là lựa chọn mặc định. Nó không cần isolation level đặc biệt, không cần retry, không tạo hàng đợi.

### `SERIALIZABLE` và vòng lặp retry

PostgreSQL dùng **SSI** (Serializable Snapshot Isolation): nó không khoá thêm, mà theo dõi phụ thuộc giữa các transaction và **huỷ** transaction nào tạo ra chu trình.

```ts
async function runSerializable<T>(fn: (tx: Tx) => Promise<T>, maxRetry = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e: any) {
      if (e.code !== '40001' || attempt >= maxRetry) throw e;   // 40001 = serialization_failure
      await sleep(2 ** attempt * 10 + Math.random() * 10);      // backoff + jitter
    }
  }
}
```

**Dùng `SERIALIZABLE` mà không có vòng lặp retry là một lỗi cấu hình**, không phải một lựa chọn. Transaction sẽ bị huỷ với `40001`, và nếu bạn không retry thì người dùng nhận lỗi 500 ngẫu nhiên dưới tải.

Điều kiện để retry đúng: **hàm `fn` phải chạy lại được từ đầu**. Nghĩa là không có side effect ngoài database bên trong nó — không gửi email, không gọi API. Xem [Database & transactions](../../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md).

### `REPEATABLE READ`: snapshot cố định

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM orders;              -- 1.000
-- 500 đơn hàng mới được commit ở đây
SELECT count(*) FROM orders;              -- vẫn 1.000
SELECT sum(total) FROM orders;            -- nhất quán với 1.000 đơn đó
COMMIT;
```

Đây là công cụ đúng cho **báo cáo đọc nhiều bảng**: mọi con số trong báo cáo cùng thuộc một thời điểm. Không có nó, tổng doanh thu và số đơn hàng có thể lệch nhau vì chúng đọc ở hai thời điểm khác nhau.

`pg_dump` dùng chính cơ chế này để backup nhất quán.

Cái giá: nếu transaction cố `UPDATE` một dòng đã bị transaction khác sửa sau khi snapshot được lấy, nó bị huỷ với `40001` — nên `REPEATABLE READ` **cũng cần retry** nếu nó ghi.

### Isolation không phải giải pháp cho mọi thứ

Ba điều isolation **không** giải quyết:

```text
1. Xung đột với thế giới bên ngoài
   Bạn giữ transaction mở trong khi gọi payment gateway — isolation không giúp gì,
   và bạn vừa giữ một connection trong 3 giây.

2. Ràng buộc mà database không biết
   "một user chỉ được có một subscription active" — dùng UNIQUE partial index,
   không dùng SERIALIZABLE.

3. Hành vi của người dùng
   Hai người sửa cùng một tài liệu trong 10 phút — đó là vấn đề UX
   (optimistic lock + thông báo), không phải vấn đề isolation.
```

## Example

Tái hiện bug bán vé trong 30 giây, không cần công cụ đặc biệt — mở **hai** cửa sổ `psql`:

```sql
-- chuẩn bị
CREATE TABLE events (id int PRIMARY KEY, remaining int);
INSERT INTO events VALUES (1, 1);
```

```sql
-- Session A                          -- Session B
BEGIN;
SELECT remaining FROM events
  WHERE id = 1;        -- 1
                                      BEGIN;
                                      SELECT remaining FROM events
                                        WHERE id = 1;      -- 1  ← cũng thấy 1
UPDATE events SET remaining = 0
  WHERE id = 1;
COMMIT;
                                      UPDATE events SET remaining = 0
                                        WHERE id = 1;      -- ghi đè
                                      COMMIT;
-- remaining = 0, nhưng ĐÃ BÁN 2 VÉ
```

Bây giờ lặp lại với `FOR UPDATE` ở cả hai session, và quan sát B **chờ**. Rồi lặp lại với cách 1 (`WHERE remaining > 0`) và quan sát B nhận 0 dòng.

Ba lần chạy đó dạy nhiều hơn mọi bảng isolation level.

## Prediction

Với hai session, `remaining = 1`, isolation mặc định:

1. Cả hai `SELECT` rồi cả hai `UPDATE remaining = 0` — kết quả cuối? Bao nhiêu vé đã bán?
2. Cả hai dùng `UPDATE ... SET remaining = remaining - 1 WHERE remaining > 0` — kết quả? B nhận mấy dòng?
3. Cả hai `SELECT ... FOR UPDATE` — B thấy gì ngay lập tức?
4. Trong `READ COMMITTED`, A `SELECT` hai lần, B `COMMIT` một `UPDATE` ở giữa — A thấy gì ở lần hai?
5. Cùng kịch bản với `REPEATABLE READ` — A thấy gì?
6. `REPEATABLE READ`, A đọc rồi `UPDATE` một dòng mà B đã sửa và commit — A nhận gì?
7. Write skew (2 bác sĩ trực, cả hai xin nghỉ) ở `READ COMMITTED` — kết quả?
8. Cùng kịch bản ở `SERIALIZABLE` — kết quả? Mã lỗi?
9. `SERIALIZABLE` không có vòng lặp retry, tải cao — người dùng thấy gì?
10. Transaction giữ mở 3 giây để gọi payment API, pool 10, 20 request đồng thời — chuyện gì xảy ra?
11. `CHECK (remaining >= 0)` có, nhưng code dùng `SELECT` rồi `UPDATE` — có bán quá vé được không?

<details>
<summary>Đáp án</summary>

1. `remaining = 0`, nhưng **2 vé đã bán**. Lost update.
2. `remaining = 0`. B nhận **0 dòng** → biết là hết vé. Đúng.
3. B **bị chặn**, chờ cho tới khi A commit hoặc rollback.
4. Giá trị **mới** — `READ COMMITTED` lấy snapshot mới mỗi câu lệnh.
5. Giá trị **cũ** — snapshot cố định từ câu lệnh đầu tiên.
6. Lỗi `40001 could not serialize access due to concurrent update`. Phải retry.
7. **0 bác sĩ trực.** Không có xung đột ở mức dòng nên không gì phát hiện được.
8. Một transaction bị huỷ với `40001`; quy tắc được giữ.
9. Lỗi 500 ngẫu nhiên, tăng theo tải, không tái hiện được ở local.
10. Pool cạn; request thứ 11 trở đi chờ rồi timeout. Triệu chứng trông như "DB chậm".
11. **Không bán quá được** — `CHECK` chặn ở dòng cuối. Nhưng người dùng nhận lỗi 500 khó hiểu thay vì "hết vé", nên vẫn cần sửa ở tầng query.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Hai `psql`, kịch bản `SELECT` rồi `UPDATE` | Lost update |
| Đổi sang `UPDATE ... WHERE remaining > 0` | 0 dòng cho session thứ hai |
| Thêm `FOR UPDATE` | Session B bị chặn — xem `pg_locks` |
| `SELECT ... FROM pg_stat_activity WHERE wait_event_type = 'Lock'` khi B đang chờ | Ai chờ ai |
| `READ COMMITTED`: đọc hai lần quanh một commit | Hai giá trị khác nhau |
| `REPEATABLE READ`: cùng thí nghiệm | Giá trị không đổi |
| `REPEATABLE READ` + `UPDATE` dòng đã bị sửa | `40001` |
| Kịch bản write skew ở `READ COMMITTED` rồi ở `SERIALIZABLE` | Bất biến bị phá vs `40001` |
| Bỏ vòng lặp retry với `SERIALIZABLE`, chạy 50 request đồng thời | Đếm số 500 |
| Thêm retry + backoff, lặp lại | Số 500 về 0 |
| Giữ transaction mở 5 giây, chạy `pg_stat_activity` | `state = idle in transaction` |
| Đặt `idle_in_transaction_session_timeout = '5s'` | Transaction bị giết tự động |
| Chạy load test 100 luồng bán vé với mỗi cách trong ba cách sửa | So throughput |

Dòng cuối cho một kết quả đáng nhớ: cách 1 (`UPDATE ... WHERE`) thường có throughput cao nhất, và `SERIALIZABLE` thấp nhất khi tranh chấp cao — vì tỉ lệ retry tăng.

## What Usually Goes Wrong

- **`SELECT` rồi `UPDATE` dựa trên giá trị đã đọc** → lost update. Bug phổ biến nhất trong danh sách.
- **Kiểm tra tồn tại rồi `INSERT`** → dữ liệu trùng. Cần `UNIQUE` constraint.
- **`SERIALIZABLE` không có retry** → 500 ngẫu nhiên dưới tải.
- **Retry một hàm có side effect ngoài DB** → email gửi hai lần.
- **Không phân biệt lỗi tạm thời và vĩnh viễn** → retry `23505` (unique violation) 5 lần vô ích.
- **Transaction dài** → giữ connection, giữ lock, chặn vacuum. Xem [MVCC & vacuum](02-mvcc-vacuum.md).
- **Network call trong transaction** → transaction dài, và pool cạn dưới tải.
- **Khoá theo thứ tự khác nhau** → deadlock. Xem [Locking & deadlock](03-locking-deadlock.md).
- **Dựa hoàn toàn vào isolation, không có constraint** → một đường vào khác (script, migration, service khác) phá bất biến.
- **Test chỉ ở local với một request** → không bao giờ thấy lớp bug này.
- **Nâng isolation "cho chắc"** mà không đo → throughput giảm, tỉ lệ retry tăng, vấn đề gốc vẫn còn.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Transaction làm code an toàn với concurrency | Nó cho tính nguyên tử; isolation là chuyện khác |
| `READ COMMITTED` cho snapshot ổn định | Snapshot mới ở **mỗi câu lệnh** |
| `SERIALIZABLE` làm mọi thứ tuần tự thật | PostgreSQL dùng SSI — vẫn song song, nhưng huỷ khi xung đột |
| `SERIALIZABLE` không cần retry | Nó **bắt buộc** cần retry |
| Isolation cao hơn thì luôn tốt hơn | Đổi lấy throughput và tỉ lệ retry |
| PostgreSQL có dirty read ở `READ UNCOMMITTED` | Không — nó xử lý như `READ COMMITTED` |
| Lost update chỉ xảy ra khi tải rất cao | Hai request cách nhau 5ms là đủ |
| Constraint DB thay được xử lý concurrency | Nó là phòng tuyến cuối, thông báo lỗi tệ |
| `FOR UPDATE` chặn cả `SELECT` thường | Không — `SELECT` thường vẫn đọc được (MVCC) |
| Write skew hiếm nên bỏ qua được | Nó xảy ra ở mọi bất biến "ít nhất N" hoặc "nhiều nhất N" |

## Debugging

1. **Nghi lost update** → thêm cột `version`, đếm số lần `UPDATE` trả về 0 dòng. Nếu bạn không có cách phát hiện, bạn sẽ không bao giờ biết.
2. **Tái hiện bằng hai `psql`** — nhanh hơn viết test đồng thời, và dạy nhiều hơn.
3. **Xem ai đang chờ ai**:
   ```sql
   SELECT blocked.pid, blocked.query AS blocked_query,
          blocking.pid AS blocking_pid, blocking.query AS blocking_query
   FROM pg_stat_activity blocked
   JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
   ```
4. **Tìm transaction dài**:
   ```sql
   SELECT pid, state, now() - xact_start AS age, left(query, 80)
   FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY age DESC;
   ```
5. **Đếm lỗi serialization** trong log ứng dụng theo mã `40001` và `40P01`. Tăng đột ngột = tranh chấp tăng.
6. **500 ngẫu nhiên chỉ khi tải cao** → tìm `40001`/`40P01` trước tiên.
7. **Kiểm tra isolation level thực tế**: `SHOW transaction_isolation;` bên trong transaction. ORM có thể đặt khác mặc định của server.

## Production Considerations

- **`READ COMMITTED` + cập nhật nguyên tử + constraint** giải quyết đa số trường hợp. Nâng isolation là lựa chọn cuối, không phải đầu.
- **Mọi bất biến quan trọng phải có một constraint ở DB.** Code có thể bị bỏ qua; constraint thì không.
- **Transaction phải ngắn.** Không network call, không chờ người dùng, không tính toán nặng.
- **`idle_in_transaction_session_timeout`** (30–60s) giết transaction bị bỏ quên do bug.
- **`statement_timeout`** chặn một câu lệnh giữ lock vô hạn.
- **Retry chỉ cho `40001` và `40P01`**, với exponential backoff **và jitter**. Không jitter thì các transaction retry đồng loạt và va nhau lần nữa.
- **Đo tỉ lệ retry như một metric.** Tăng dần nghĩa là tranh chấp tăng — thường là dấu hiệu cần thiết kế lại (chia nhỏ dòng nóng, dùng counter riêng), không phải cần thêm retry.
- **Test đồng thời thật sự** trong CI cho những use case có tiền: chạy N request song song, khẳng định bất biến. Đây là loại test duy nhất bắt được lớp bug này.
- **Ghi rõ isolation level trong code** cho những transaction quan trọng, đừng dựa vào mặc định của ORM.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `READ COMMITTED` (mặc định) | throughput cao nhất | phải tự xử lý lost update |
| `REPEATABLE READ` | báo cáo nhất quán | cần retry khi ghi |
| `SERIALIZABLE` | đúng cho mọi bất biến | throughput thấp hơn, bắt buộc retry |
| Cập nhật nguyên tử (`SET x = x - 1`) | đơn giản, nhanh, không khoá thêm | chỉ dùng được cho phép toán đơn giản |
| `FOR UPDATE` | dễ hiểu, chính xác | tạo hàng đợi, rủi ro deadlock |
| Optimistic lock | không khoá, mở rộng tốt | client phải xử lý xung đột |
| Constraint DB | đúng tuyệt đối | thông báo lỗi xấu, tốn một round-trip |
| Retry nhiều lần | chịu tranh chấp tốt | ẩn vấn đề thiết kế, tăng độ trễ đuôi |
| Chia nhỏ dòng nóng (sharded counter) | giảm tranh chấp mạnh | đọc phải cộng lại, phức tạp hơn |

## Explain Without Notes

1. Vì sao `SELECT` rồi `UPDATE` không an toàn, dù mỗi câu lệnh đều đúng?
2. `READ COMMITTED` lấy snapshot ở mức nào? Điều đó gây hệ quả gì?
3. Kể bốn anomaly và mức isolation chặn được từng cái.
4. Write skew khác lost update ở điểm nào, và vì sao chỉ `SERIALIZABLE` bắt được?
5. Vì sao `SERIALIZABLE` bắt buộc phải có retry? Điều kiện để retry an toàn?
6. Ba cách sửa bug bán vé, và tiêu chí chọn giữa chúng?
7. Vì sao constraint DB vẫn cần dù đã xử lý đúng ở tầng query?

## Related

- [MVCC & vacuum](02-mvcc-vacuum.md) — cơ chế tạo ra snapshot
- [Locking & deadlock](03-locking-deadlock.md) — `FOR UPDATE`, hàng đợi, deadlock
- [Connection pool](../fundamentals/02-connection-pool.md) — vì sao transaction dài làm cạn pool
- [Constraints & invariants](../../03-data-modeling/01-constraints-invariants.md) — phòng tuyến cuối
- [Database & transactions (NestJS)](../../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md) — ranh giới transaction trong code
- [Shared state & races](../../../05-cross-cutting/concurrency/02-shared-state-races.md) — cùng họ vấn đề ở tầng khác
- [Distributed locks](../../../05-cross-cutting/concurrency/03-distributed-locks.md) — khi dữ liệu không ở cùng một DB
- [Idempotency & retry](../../../06-system-design/03-idempotency-retry.md) — retry an toàn

## Version / Context

PostgreSQL 16. SSI cho `SERIALIZABLE` có từ PostgreSQL 9.1. Mã lỗi: `40001` serialization_failure, `40P01` deadlock_detected, `23505` unique_violation.
