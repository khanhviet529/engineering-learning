---
level: intermediate
area: database
prerequisites:
  - 01-transaction-isolation.md
related:
  - ../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md
  - ../../05-cross-cutting/performance/04-database-performance.md
  - ../../04-infrastructure/04-kubernetes/09-autoscaling.md
---

# Connection pool

> Traffic tăng, bạn scale từ 3 lên 20 pod. Latency **tăng gấp ba**. CPU của database ở mức 30%, disk rảnh, không có query chậm nào trong log. Bạn scale lên 30 pod và mọi thứ tệ hơn nữa. Nguyên nhân không nằm trong app hay trong query — nó nằm ở phép nhân `20 pod × 10 connection = 200`, và PostgreSQL của bạn cấu hình `max_connections = 100`.

## Position

```text
NestJS (N instance)
   │  mỗi instance giữ MỘT pool
   ▼
Connection pool (pg / Prisma / TypeORM)
   │  M connection mỗi pool
   ▼
[PgBouncer]  ← tuỳ chọn, khi N × M quá lớn
   ▼
PostgreSQL — mỗi connection = MỘT PROCESS ở phía server
```

Dòng cuối là gốc của mọi thứ trong note này: **PostgreSQL dùng một process cho mỗi connection**, không phải một thread, không phải một event loop slot.

## Problem

Mở một connection tới PostgreSQL không rẻ:

```text
TCP handshake                    ~1 ms (cùng mạng)
TLS handshake                    ~2–10 ms
Xác thực                         ~1 ms
fork() một process phía server   ~1–5 ms, và ~5–10 MB RAM
──────────────────────────────────────────
tổng                             ~5–20 ms
```

Với một API xử lý 1.000 req/s, mở connection mới cho mỗi request nghĩa là 1.000 lần fork mỗi giây. Database sẽ dành phần lớn thời gian tạo và huỷ process.

Pool giải quyết điều đó: giữ sẵn một tập connection, cho mượn rồi trả lại.

Nhưng pool tạo ra một vấn đề **mới**, và đó là vấn đề thật của note này:

```text
Pool có kích thước GIỚI HẠN.
Khi mọi connection đang bận, request tiếp theo PHẢI CHỜ.
```

Và thời gian chờ đó **không xuất hiện trong log query của database**. Từ phía DB, mọi thứ bình thường. Từ phía người dùng, API chậm. Đây là lý do vấn đề pool khó chẩn đoán: nó là một hàng đợi vô hình.

## Mental Model

### Pool là một tập hữu hạn, giống một bãi đỗ xe

```text
Pool size = 10
┌────────────────────────────────────┐
│ [bận][bận][bận][rảnh][rảnh] ...    │
└────────────────────────────────────┘
      ↑ request lấy 1, dùng, TRẢ LẠI

Khi cả 10 đều bận:
  request 11, 12, 13...  →  xếp hàng  →  chờ tới connectionTimeout  →  LỖI
```

Ba con số quyết định hành vi:

```text
pool size            bao nhiêu connection giữ sẵn
connection timeout   chờ tối đa bao lâu để lấy được một cái   (thường 5–30s)
idle timeout         connection rảnh bao lâu thì đóng          (thường 10s–10 phút)
```

### Phép nhân là chỗ hầu hết hệ thống vỡ

```text
tổng connection tới DB  =  số instance app  ×  pool size mỗi instance
                           + số worker      ×  pool size
                           + migration job, cron job, công cụ admin,
                             replica, dashboard BI, người dùng psql...
```

Ví dụ thật:

```text
20 API pod   × 10 =  200
 4 worker    × 10 =   40
 1 migration ×  5 =    5
 vài công cụ      =   10
────────────────────────
tổng               =  255
max_connections    =  100     ← "FATAL: sorry, too many clients already"
```

Điều nguy hiểm: mọi thứ hoạt động tốt với 3 pod. Vấn đề chỉ xuất hiện khi autoscaler làm việc của nó — tức là **đúng lúc traffic cao nhất**.

### Vì sao pool lớn hơn không nhanh hơn

Đây là phần phản trực giác nhất, và cũng là phần quan trọng nhất.

```text
Nếu server có 8 core, chỉ 8 query có thể THẬT SỰ chạy cùng lúc.
200 connection cùng hoạt động = 200 process tranh 8 core.

Hậu quả:
  · context switching tăng
  · mỗi query có ít CPU hơn → chậm hơn
  · giữ lock lâu hơn (vì chậm hơn) → tranh chấp tăng
  · mỗi process chiếm work_mem cho sort/hash → có thể hết RAM
  · tổng throughput GIẢM
```

```text
throughput
    │        ┌─────╮
    │       ╱       ╲___________
    │      ╱                      ← thêm connection ở đây làm TỆ ĐI
    │     ╱
    │____╱
    └──────────────────────────── số connection
         ↑ điểm tối ưu, thường thấp một cách bất ngờ
```

Công thức khởi điểm được dùng rộng rãi (từ tài liệu HikariCP, và phù hợp với PostgreSQL):

```text
pool size ≈ (số core × 2) + số spindle hiệu dụng
```

Với 8 core + SSD: khoảng **20 connection cho toàn bộ hệ thống**, không phải mỗi instance. Con số này làm nhiều người ngạc nhiên vì nó nhỏ hơn nhiều so với trực giác.

### Node.js: một pool, một event loop

```text
Node có 1 thread JS. Nó không "chạy song song" 50 query.
Nó gửi 50 query và chờ callback.

pool size = 10  ⇒  10 query đang bay, phần còn lại xếp hàng ở POOL
```

Nghĩa là pool size của một instance Node không cần lớn. Nó bị giới hạn bởi số request đồng thời mà instance đó xử lý, và bởi thời gian mỗi query. Xem [Node runtime & concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md).

Một cách ước lượng hữu ích (định luật Little):

```text
connection cần  ≈  request/giây  ×  thời gian giữ connection trung bình

500 req/s × 10ms = 5 connection    ← đủ
500 req/s × 200ms = 100 connection ← không khả thi; hãy sửa 200ms trước
```

Con số thứ hai nói một điều quan trọng: **khi bạn thấy mình cần pool rất lớn, vấn đề thật là query chậm hoặc transaction dài, không phải pool nhỏ.**

## How It Works

### Thứ giữ connection lâu nhất không phải query

```ts
// ❌ giữ connection 3 giây
await db.$transaction(async (tx) => {
  const order = await tx.order.create({ data });         // 2ms
  await paymentGateway.charge(order.total);              // 3000ms  ← giữ connection!
  await tx.order.update({ where: { id: order.id }, data: { paid: true } });
});
```

Với pool 10, mười request như vậy làm cạn pool trong 3 giây. Request thứ 11 chờ. Từ phía DB: hoàn toàn rảnh.

```ts
// ✅ chuẩn bị → transaction NGẮN → side effect
const authorization = await paymentGateway.authorize(total);   // ngoài transaction
await db.$transaction(async (tx) => {                          // 5ms
  await tx.order.create({ data: { ...data, authorizationId: authorization.id } });
});
await paymentGateway.capture(authorization.id);                // ngoài transaction
```

Quy tắc: **không bao giờ gọi mạng bên trong transaction.** Xem [Database & transactions](../../02-backend-api/02-nestjs/06-database-integration-transactions.md).

### PgBouncer: khi phép nhân không kiểm soát được

```text
20 pod × 10  →  200 connection  →  PgBouncer  →  25 connection thật tới PostgreSQL
```

PgBouncer là một proxy nhẹ ghép nhiều connection client vào ít connection server. Ba chế độ:

```text
session      1 client connection ↔ 1 server connection cho tới khi client ngắt
             → gần như không giúp gì về ghép nối

transaction  server connection được trả lại sau MỖI transaction
             → chế độ hữu ích nhất, và cũng là chế độ có ràng buộc

statement    trả lại sau mỗi câu lệnh
             → không dùng được với transaction nhiều câu lệnh
```

**Chế độ `transaction` phá vỡ những thứ phụ thuộc trạng thái phiên:**

```text
✗ prepared statement        (trừ khi bật max_prepared_statements ở PgBouncer >= 1.21)
✗ LISTEN / NOTIFY
✗ advisory lock ở mức session
✗ temporary table
✗ SET ... (không có LOCAL)
✗ cursor giữ qua nhiều transaction
```

Prisma và nhiều driver dùng prepared statement theo mặc định. Với PgBouncer transaction mode, thường phải tắt:

```text
DATABASE_URL="postgres://...?pgbouncer=true"          # Prisma
# hoặc với node-postgres: tránh dùng named prepared statement
```

Đây là lớp lỗi khó chịu vì nó biểu hiện thành lỗi ngẫu nhiên kiểu `prepared statement "s1" already exists` chỉ dưới tải, không tái hiện được ở local.

### Cấu hình đúng, ba tầng phải khớp nhau

```ts
// app
const pool = new Pool({
  max: 10,                          // pool size
  min: 2,                           // giữ sẵn ít nhất 2
  connectionTimeoutMillis: 5_000,   // chờ tối đa 5s để LẤY connection
  idleTimeoutMillis: 30_000,        // đóng connection rảnh sau 30s
  statement_timeout: 10_000,        // giết query chạy > 10s
  query_timeout: 10_000,
  application_name: 'api',          // hiện trong pg_stat_activity — rất hữu ích
});
```

```ini
# postgresql.conf
max_connections = 200
# work_mem là PER SORT/HASH NODE, per connection.
# 200 connection × 3 nút sort × 16MB = 9,6 GB trong trường hợp xấu nhất.
work_mem = 16MB
shared_buffers = 25% RAM
idle_in_transaction_session_timeout = 60s
```

Bất đẳng thức phải giữ:

```text
Σ (instance × pool size) + dự phòng cho superuser/công cụ  <  max_connections
```

PostgreSQL giữ riêng `superuser_reserved_connections` (mặc định 3) để bạn còn vào được khi đầy. Đừng dùng hết phần còn lại.

### `application_name`: một dòng cấu hình rất đáng giá

```sql
SELECT application_name, state, count(*)
FROM pg_stat_activity GROUP BY 1, 2 ORDER BY 3 DESC;
```

```text
 application_name │        state        │ count
──────────────────┼─────────────────────┼───────
 api              │ idle                │    47
 worker           │ active              │     8
 api              │ idle in transaction │    12   ← BUG: transaction bị bỏ quên
 metabase         │ active              │     6
```

Không đặt `application_name`, mọi dòng đều là `unknown` và bạn không biết ai đang chiếm connection.

`idle in transaction` là tín hiệu quan trọng nhất trong bảng này: nó nghĩa là app đã `BEGIN` rồi đi làm việc khác. Mỗi dòng như vậy giữ một connection **và** giữ một snapshot chặn vacuum. Xem [MVCC & vacuum](04-mvcc-vacuum.md).

## Example

Chẩn đoán "API chậm nhưng DB rảnh" trong bốn câu lệnh:

```sql
-- 1. Tổng connection và trạng thái
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
--  active: 6, idle: 180, idle in transaction: 14      ← 180 idle = pool quá lớn

-- 2. Ai giữ chúng
SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;

-- 3. Transaction bị bỏ quên (nguy hiểm nhất)
SELECT pid, application_name, now() - xact_start AS age, left(query, 60)
FROM pg_stat_activity
WHERE state = 'idle in transaction' AND now() - xact_start > interval '30 seconds'
ORDER BY age DESC;

-- 4. Còn bao nhiêu chỗ
SELECT count(*) AS used, current_setting('max_connections')::int AS max FROM pg_stat_activity;
```

Và từ phía app, hai metric phải có:

```ts
// pool.waitingCount là chỉ số quan trọng nhất — nó là hàng đợi vô hình
setInterval(() => {
  metrics.gauge('db_pool_total',   pool.totalCount);
  metrics.gauge('db_pool_idle',    pool.idleCount);
  metrics.gauge('db_pool_waiting', pool.waitingCount);   // > 0 kéo dài = pool nhỏ hoặc query chậm
}, 5_000);
```

`waitingCount > 0` liên tục là bằng chứng trực tiếp cho vấn đề pool. Không có metric này, bạn chỉ thấy "API chậm".

## Prediction

App: 20 pod × pool 10; PostgreSQL: `max_connections = 100`, 8 core.

1. Tổng connection app cố mở? Chuyện gì xảy ra?
2. Thông báo lỗi cụ thể là gì? Nó xuất hiện ở app hay ở DB?
3. Giảm pool xuống 4/instance — tổng bao nhiêu? Có đủ không?
4. `max_connections = 500` và 20 pod × 10 — vấn đề "too many clients" hết, nhưng throughput thế nào với 8 core?
5. Transaction gọi payment API 3 giây, pool 10, 20 request đồng thời — request thứ 11 chờ bao lâu?
6. Trong lúc đó, `pg_stat_activity` cho thấy gì về CPU/hoạt động của DB?
7. `connectionTimeoutMillis: 5000` và pool cạn — client nhận gì sau 5 giây?
8. `idle in transaction` 14 dòng, tồn tại nhiều giờ — hai hậu quả?
9. PgBouncer chế độ `transaction` + Prisma với prepared statement — triệu chứng?
10. Cron job dùng chung pool với API, chạy query 5 phút — ảnh hưởng API thế nào?
11. HPA scale từ 3 lên 30 pod khi traffic tăng đột biến — chuyện gì xảy ra ở DB?
12. `work_mem = 64MB`, 200 connection, mỗi query có 2 nút sort — RAM tối đa?

<details>
<summary>Đáp án</summary>

1. **200** cố mở, `max_connections = 100` → khoảng một nửa số pod không kết nối được.
2. `FATAL: sorry, too many clients already` — xuất hiện ở **app** (lỗi kết nối), và trong log của PostgreSQL.
3. 80 + dự phòng. Đủ, và **nhanh hơn** so với 200 vì bớt tranh chấp.
4. Tệ hơn: 200 process tranh 8 core, context switching tăng, mỗi query chậm hơn, throughput tổng giảm.
5. Chờ tới khi một transaction xong (~3 giây), hoặc timeout nếu `connectionTimeout` ngắn hơn.
6. DB gần như **rảnh** — không có query nào chạy, chỉ có transaction mở đang chờ mạng. Đây là lý do chẩn đoán sai hướng.
7. Lỗi từ pool (`timeout exceeded when trying to connect` / `Connection pool timeout`), không phải lỗi từ DB.
8. (a) Giữ 14 connection vô ích. (b) Giữ snapshot cũ → **chặn vacuum toàn bộ database** → bảng phình.
9. `prepared statement "s0" already exists` hoặc `prepared statement does not exist`, ngẫu nhiên, chỉ dưới tải.
10. Query 5 phút giữ một connection 5 phút. Nếu job chạy nhiều query song song, nó có thể chiếm hết pool và làm API dừng.
11. 30 × 10 = 300 connection đột ngột. Vượt `max_connections` → pod mới không kết nối được → và pod cũ cũng bị ảnh hưởng vì DB đang bận fork process.
12. 200 × 2 × 64MB = **25,6 GB** trong trường hợp xấu nhất — nhiều hơn RAM của hầu hết server.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt pool = 1, chạy 50 request đồng thời | Latency tăng tuyến tính; `waitingCount` cao |
| Đặt pool = 100 trên DB 2 core, chạy load test | Throughput **giảm** so với pool = 10 |
| Thêm `sleep(3000)` trong transaction, 20 request | Pool cạn; DB rảnh |
| Bỏ `sleep` ra ngoài transaction | Pool không cạn |
| `BEGIN` trong psql rồi không làm gì, xem `pg_stat_activity` | `idle in transaction` |
| Để nó 10 phút rồi chạy `VACUUM VERBOSE` bảng khác | Dead tuple không được dọn |
| Đặt `idle_in_transaction_session_timeout = '10s'` | Session bị giết tự động |
| Scale từ 3 lên 30 pod với pool 10, `max_connections = 100` | `too many clients` |
| Thêm PgBouncer, lặp lại | Hoạt động |
| PgBouncer transaction mode + prepared statement | Lỗi ngẫu nhiên dưới tải |
| Không đặt `application_name`, xem `pg_stat_activity` | Không biết ai giữ connection |
| Đặt `application_name` khác nhau cho api/worker/cron | Bức tranh rõ ngay |
| Chạy cron job nặng dùng chung pool với API | API chậm trong lúc job chạy |
| Tách pool riêng cho cron | API không bị ảnh hưởng |

## What Usually Goes Wrong

- **Không tính phép nhân** instance × pool → `too many clients` đúng lúc traffic cao.
- **Pool quá lớn** → tranh chấp CPU, throughput giảm, và tưởng là "DB yếu".
- **Network call trong transaction** → nguyên nhân số một của pool cạn.
- **Transaction bị bỏ quên** (`idle in transaction`) → giữ connection **và** chặn vacuum.
- **Không có `statement_timeout`** → một query hỏng giữ connection vĩnh viễn.
- **Không có `idle_in_transaction_session_timeout`** → bug ở app giữ connection mãi mãi.
- **Chung pool giữa API và job nền** → job nặng làm chết API.
- **Không giới hạn pool ở migration/cron/script** → chúng ăn phần của API.
- **Không đặt `application_name`** → không chẩn đoán được ai giữ gì.
- **Không đo `waitingCount`** → hàng đợi vô hình.
- **Autoscaler không biết giới hạn DB** → scale app làm chết DB.
- **PgBouncer transaction mode với prepared statement / `SET` / advisory lock** → lỗi ngẫu nhiên.
- **Connection rò rỉ** (không trả lại pool khi có lỗi) → pool cạn dần theo thời gian, restart thì hết.

Điểm cuối đáng chú ý: rò rỉ connection biểu hiện giống memory leak — hệ thống chạy tốt vài giờ rồi chậm dần. Nguyên nhân thường là một đường lỗi không có `finally` hoặc không dùng API transaction của driver.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Pool lớn hơn = xử lý được nhiều hơn | Sau một ngưỡng, nó làm giảm throughput |
| Connection rẻ | Mỗi cái là một process và ~5–10 MB ở phía server |
| `max_connections` cao thì an toàn hơn | Nó chỉ dời điểm vỡ và làm RAM thành rủi ro mới |
| Pool cạn thì DB sẽ bận | DB có thể hoàn toàn rảnh |
| Query nhanh nên pool nhỏ là đủ | Đúng — nhưng transaction dài phá vỡ điều đó |
| PgBouncer là thay thế cho pool ở app | Nó bổ sung; app vẫn cần pool |
| PgBouncer trong suốt với ứng dụng | Transaction mode phá prepared statement, `SET`, `LISTEN` |
| Scale app luôn tăng khả năng phục vụ | Chỉ tới giới hạn của DB |
| `idle` connection vô hại | Chúng chiếm slot và RAM |
| `idle in transaction` cũng chỉ là idle | Nó chặn vacuum toàn database |

## Debugging

1. **`waitingCount` của pool** — nếu > 0 kéo dài, vấn đề đã xác định. Đây là bước đầu tiên và rẻ nhất.
2. **`pg_stat_activity` gom theo `state` và `application_name`** — bức tranh trong một câu lệnh.
3. **Tìm `idle in transaction` cũ** — mỗi dòng là một bug ở app.
4. **Nếu nhiều `active` và CPU DB cao** → vấn đề là query, không phải pool. Đi sang [Index & query plan](02-index-query-plan.md).
5. **Nếu ít `active` mà app chậm** → pool cạn hoặc transaction dài. Tìm network call trong transaction.
6. **Đo thời gian giữ connection**, không chỉ thời gian query. Chênh lệch chính là thứ bạn phải sửa.
7. **Đếm connection theo thời gian** cùng với số pod — tương quan cho thấy phép nhân.
8. **Rò rỉ**: `totalCount` tăng đều và không giảm → tìm đường lỗi không trả connection.

## Production Considerations

- **Tính tổng connection cho mọi client**, kể cả công cụ BI, người dùng psql, và replica. Ghi con số này vào tài liệu vận hành.
- **Bắt đầu nhỏ**: pool 5–10 mỗi instance. Tăng chỉ khi `waitingCount` cho thấy cần, và đo throughput sau mỗi lần tăng.
- **`statement_timeout` và `idle_in_transaction_session_timeout`** là hai cấu hình phòng thủ bắt buộc.
- **`application_name` cho mọi client.** Một dòng cấu hình, giá trị chẩn đoán rất lớn.
- **Pool riêng cho công việc nền**, nhỏ hơn pool của API, để job nặng không làm chết đường request.
- **PgBouncer khi số instance lớn** — nhưng đọc kỹ ràng buộc của transaction mode trước, và test prepared statement dưới tải.
- **Kết nối autoscaling với giới hạn DB.** Nếu HPA có thể scale lên 50 pod, `50 × pool` phải nằm trong `max_connections`. Nếu không, hãy giới hạn `maxReplicas` hoặc đặt PgBouncer ở giữa.
- **Alert trên `waitingCount > 0` kéo dài** và trên tỉ lệ `connection_used / max_connections > 80%`.
- **Đo và alert số `idle in transaction` > 30 giây** — nó luôn là bug.
- **`work_mem` × số connection là rủi ro RAM.** Với pool lớn, giữ `work_mem` nhỏ và nâng tạm bằng `SET LOCAL` cho query báo cáo cụ thể.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Pool lớn | chịu được đỉnh ngắn | tranh chấp CPU, tốn RAM, throughput giảm |
| Pool nhỏ | DB hoạt động hiệu quả | request xếp hàng khi có đỉnh |
| `connectionTimeout` dài | ít lỗi khi đỉnh ngắn | người dùng chờ lâu rồi vẫn có thể fail |
| `connectionTimeout` ngắn | fail nhanh, rõ ràng | lỗi khi đỉnh rất ngắn |
| PgBouncer | ghép nối, chịu nhiều instance | thêm một thành phần, ràng buộc transaction mode |
| Không PgBouncer | đơn giản | giới hạn số instance |
| Pool chung API + job | ít cấu hình | job nặng làm chết API |
| Pool tách riêng | cô lập | phải tính tổng cẩn thận hơn |
| `max_connections` cao | ít lỗi kết nối | rủi ro RAM, tranh chấp CPU |
| `statement_timeout` chặt | không có query treo | query báo cáo hợp lệ bị giết |

## Explain Without Notes

1. Vì sao pool lớn hơn không nhanh hơn? Vẽ đường cong throughput theo số connection.
2. Phép nhân nào quyết định tổng connection, và vì sao nó chỉ vỡ khi traffic cao?
3. Vì sao "API chậm nhưng DB rảnh" là dấu hiệu điển hình của vấn đề pool?
4. Điều gì giữ connection lâu nhất trong một hệ thống thật, và cách sửa?
5. `idle` khác `idle in transaction` thế nào? Cái nào nguy hiểm hơn và vì sao?
6. PgBouncer transaction mode phá vỡ những gì?
7. Ba metric tối thiểu để biết pool có vấn đề?

## Related

- [Transaction isolation](01-transaction-isolation.md) — transaction dài và tranh chấp
- [MVCC & vacuum](04-mvcc-vacuum.md) — vì sao `idle in transaction` chặn vacuum
- [Index & query plan](02-index-query-plan.md) — query nhanh giảm áp lực lên pool
- [Node runtime & concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — một event loop, một pool
- [Database & transactions (NestJS)](../../02-backend-api/02-nestjs/06-database-integration-transactions.md) — transaction ngắn
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — đo ở tầng hệ thống
- [Autoscaling](../../04-infrastructure/04-kubernetes/09-autoscaling.md) — scale app trong giới hạn DB
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md) — tài nguyên hữu hạn dùng chung

## Version / Context

PostgreSQL 16 (`max_connections` mặc định 100). PgBouncer 1.21+ hỗ trợ prepared statement ở transaction mode. Ví dụ pool dùng `node-postgres`; Prisma và TypeORM có tham số tương đương (`connection_limit`, `poolSize`).
