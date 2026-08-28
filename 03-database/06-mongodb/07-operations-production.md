---
level: advanced
area: database
prerequisites:
  - 04-indexes-query-planning.md
  - 06-transactions-consistency.md
related:
  - ../01-postgresql/operations/02-replication-scaling.md
  - ../../06-system-design/05-data-partitioning-sharding.md
---

# Operations & production

> Điều quyết định hiệu năng MongoDB không phải số index hay cách viết query. Nó là: **working set có vừa RAM không?** Mọi thứ khác là thứ yếu.

*Baseline: MongoDB 7.x/8.x. Note này ở mức conceptual — không phải hướng dẫn vận hành DBA.*

## Position

```text
Application → driver (connection pool)
      ↓
Replica set:  primary ⇄ secondary ⇄ secondary
      ↓ (nếu shard)
Sharded cluster: mongos → shard 1, shard 2, ... (mỗi shard là một replica set)
      ↓
WiredTiger cache (RAM)  →  disk
```

## Problem

Cùng một cluster, cùng một query, hai kết quả:

```text
Working set vừa RAM       → 2 ms     (đọc từ WiredTiger cache)
Working set không vừa RAM → 40 ms    (đọc từ disk, mỗi lần)
```

Hệ số 20 lần, và nó không sửa được bằng index hay bằng viết query tốt hơn. Khi index không vừa RAM, mỗi lần tra index là một lần đọc disk — và bạn mất toàn bộ lợi ích của index.

**Working set** = dữ liệu + index mà truy vấn thực tế chạm tới thường xuyên. Không phải toàn bộ database.

Đây là lý do câu hỏi capacity đầu tiên của MongoDB là về RAM, không về CPU hay disk.

## Mental Model

### Replica set — đơn vị triển khai tối thiểu

```text
        ┌─────────┐
   ghi →│ PRIMARY │──── oplog ────┐
        └─────────┘               ↓
                          ┌───────────┐  ┌───────────┐
                          │ SECONDARY │  │ SECONDARY │
                          └───────────┘  └───────────┘
                                 ↑ đọc (tuỳ chọn)
```

- **Một** primary nhận mọi ghi. Không có multi-master.
- Secondary replicate qua **oplog** (một capped collection ghi lại mọi thay đổi).
- **Failover tự động**: primary chết → secondary bầu primary mới (~10–30 giây).
- Bầu cử cần **đa số**. Vì vậy số node **lẻ** (3, 5) — cụm 2 node không failover được, và mất một node là mất luôn khả năng bầu.

Replica set là bắt buộc cho: transaction, `w: "majority"`, và mọi triển khai production. Standalone chỉ dành cho thử nghiệm.

**Oplog window** là khái niệm vận hành quan trọng: oplog có kích thước cố định. Nếu một secondary tụt lại xa hơn oplog window, nó **không thể catch up** và phải resync toàn bộ từ đầu — một thao tác nặng. Đây là lý do phải monitor replication lag.

### Sharding — chỉ khi thật cần

```text
mongos (router)
   ├── Shard A (replica set)   shard key range [min, "m")
   ├── Shard B (replica set)   shard key range ["m", "t")
   └── Shard C (replica set)   shard key range ["t", max)
   Config servers (metadata)
```

Sharding là quyết định **rất khó hoàn tác**. Thứ tự đúng để mở rộng:

```text
1. Index đúng + working set vừa RAM        ← giải quyết phần lớn vấn đề
2. Scale up (thêm RAM)                      ← rẻ hơn nhiều so với shard
3. Đọc từ secondary (nếu chấp nhận lag)
4. Archive dữ liệu cũ / tách collection nóng
5. Shard                                     ← cuối cùng
```

Chỉ shard khi: dữ liệu vượt khả năng một máy, hoặc write throughput vượt khả năng một primary.

### Shard key — quyết định không hoàn tác được

Đây là quyết định quan trọng nhất khi shard. Ba tiêu chí phải thoả **đồng thời**:

| Tiêu chí | Vì sao | Vi phạm thì |
|---|---|---|
| **Cardinality cao** | đủ giá trị khác nhau để chia | ít giá trị → không chia được |
| **Phân bố đều ghi** | không dồn vào một shard | **hot shard** — một shard nhận hết tải |
| **Xuất hiện trong query** | để query targeted, không scatter-gather | mọi query hỏi **mọi** shard |

```js
// ❌ ObjectId — tăng dần theo thời gian → mọi ghi mới vào CÙNG một shard
sh.shardCollection("app.orders", { _id: 1 });

// ❌ Cardinality thấp
sh.shardCollection("app.orders", { status: 1 });     // chỉ vài giá trị

// ⚠️ Hashed — phân bố đều nhưng range query phải scatter-gather
sh.shardCollection("app.orders", { customerId: "hashed" });

// ✅ Compound: phân bố đều + xuất hiện trong query
sh.shardCollection("app.orders", { customerId: 1, createdAt: 1 });
```

Hai chế độ query sau khi shard:

```text
Targeted       query có shard key → mongos gửi tới ĐÚNG shard    → nhanh
Scatter-gather query không có     → gửi tới MỌI shard, gộp lại   → chậm, không scale
```

Nếu phần lớn query của bạn là scatter-gather, sharding không giúp gì — bạn chỉ thêm độ phức tạp.

### Đọc từ secondary

```js
readPreference: "primary"             // mặc định — luôn mới
readPreference: "primaryPreferred"    // primary, fallback secondary khi failover
readPreference: "secondary"           // chỉ secondary
readPreference: "secondaryPreferred"  // secondary, fallback primary
readPreference: "nearest"             // độ trễ thấp nhất
```

Đọc từ secondary scale được read, nhưng có replication lag — và điều đó gây [đọc-sau-ghi sai](06-transactions-consistency.md). Dùng cho: báo cáo, analytics, dashboard. **Không** dùng cho: đọc ngay sau khi ghi.

## How It Works

### Connection pool

```js
new MongoClient(uri, {
  maxPoolSize: 20,                    // mỗi INSTANCE app, không phải toàn hệ thống
  minPoolSize: 5,
  maxIdleTimeMS: 60_000,
  waitQueueTimeoutMS: 5_000,          // chờ lấy connection — quan trọng
  serverSelectionTimeoutMS: 5_000,
  retryWrites: true,                  // mặc định true — tự retry ghi khi failover
  retryReads: true,
});
```

Tính toán như PostgreSQL: `số_instance × maxPoolSize ≤ giới hạn kết nối của cluster`. Xem [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — nguyên lý giống nhau.

**`retryWrites: true`** (mặc định) là tính năng quan trọng: khi failover, driver tự retry ghi **một lần**. Nó chỉ an toàn vì MongoDB dùng transaction number để đảm bảo ghi không bị áp dụng hai lần — tức là idempotent ở tầng protocol.

Một `MongoClient` cho cả process, đóng khi shutdown. Tạo nhiều client là lỗi vận hành giống như tạo nhiều `PrismaClient`.

### Backup

```text
mongodump / mongorestore     → logic, chậm, không dùng cho DB lớn
Filesystem snapshot          → nhanh, cần journal enabled và fsync
Oplog-based PITR             → point-in-time recovery, phức tạp
Managed (Atlas)              → continuous backup + PITR
```

Điều duy nhất thật sự quan trọng về backup:

> **Backup chưa được restore thử không phải backup.**

Kiểm tra định kỳ: restore vào một cluster riêng và chạy sanity check. Xem [WAL, durability & backup](../01-postgresql/operations/01-wal-durability-backup.md) — cùng nguyên tắc.

### Index build trên production

MongoDB 4.2+ build index với lock rất ngắn, nhưng nó vẫn tốn I/O và RAM. Trên replica set, cách an toàn nhất là **rolling build**: build trên từng secondary một, rồi step down primary và build trên node cuối. Đây là thao tác cần kế hoạch, không phải chạy giữa giờ cao điểm.

### Monitoring — sáu chỉ số

```text
1. WiredTiger cache hit ratio    ← QUAN TRỌNG NHẤT
   db.serverStatus().wiredTiger.cache
   "pages read into cache" tăng nhanh → working set không vừa RAM

2. Replication lag
   rs.printSecondaryReplicationInfo()
   → lag lớn = đọc secondary cho dữ liệu cũ; nguy cơ vượt oplog window

3. Oplog window
   rs.printReplicationInfo()
   → window ngắn (< vài giờ) = secondary chậm sẽ phải resync toàn bộ

4. Slow queries
   db.setProfilingLevel(1, { slowms: 100 })
   → nguồn thông tin tốt nhất cho "query nào chậm"

5. Connection count
   db.serverStatus().connections
   → gần giới hạn = pool sizing sai

6. Lock / queue
   db.serverStatus().globalLock.currentQueue
   → queue dài = quá tải
```

Chỉ số 1 là chỉ số bạn nên xem trước mọi chỉ số khác. Nếu cache hit ratio thấp, không có tối ưu query nào cứu được.

### Ước lượng working set

```js
// Kích thước dữ liệu và index
db.stats();                       // dataSize, indexSize
db.collection.stats();            // theo collection

// Quy tắc thô: index PHẢI vừa RAM; dữ liệu nóng nên vừa RAM
// RAM cần ≈ tổng indexSize (của index đang dùng) + dữ liệu truy cập thường xuyên
```

Nếu `indexSize` đã lớn hơn RAM, mọi query đều đọc disk. Đây là lúc: xoá index không dùng (`$indexStats`), dùng partial index, archive dữ liệu cũ, hoặc thêm RAM.

### Bảo mật — mặc định không an toàn

```text
❌ Không bật authentication         → ai kết nối cũng làm được mọi thứ
❌ Bind 0.0.0.0 không firewall      → MongoDB bị scan và ransomware
✅ --auth + user theo role (RBAC)
✅ TLS cho kết nối
✅ Bind vào interface nội bộ, firewall chặt
✅ Encryption at rest (enterprise/Atlas)
```

MongoDB không bật auth theo mặc định trong nhiều cách cài đặt. Đã có nhiều đợt ransomware quét internet tìm MongoDB mở — đây là rủi ro thật, không phải lý thuyết. Xem [Secrets management](../../05-cross-cutting/security/06-secrets-management.md).

## Example

```text
Lộ trình mở rộng thực tế, theo thứ tự chi phí

Giai đoạn 1 — một replica set 3 node
  ├── index đúng theo access pattern (ESR)
  ├── working set vừa RAM              ← kiểm tra cache hit ratio
  ├── w: "majority" cho ghi quan trọng
  └── profiler bật với slowms
      → phục vụ được phần lớn ứng dụng

Giai đoạn 2 — vẫn một replica set
  ├── xoá index không dùng ($indexStats)
  ├── partial index cho field lệch
  ├── đọc secondary cho báo cáo/analytics
  ├── archive dữ liệu cũ sang collection/cluster riêng
  └── scale up RAM
      → rẻ hơn shard rất nhiều

Giai đoạn 3 — shard (chỉ khi 1 và 2 không đủ)
  ├── chọn shard key: cardinality cao + phân bố đều + có trong query
  ├── kiểm tra phần lớn query là targeted, không scatter-gather
  └── chấp nhận độ phức tạp vận hành tăng đáng kể
```

## Prediction

1. Working set 100GB, RAM 16GB — query nhanh hay chậm? Thêm index có giúp?
2. Replica set 2 node, một node chết — cụm còn ghi được không?
3. Shard key là `_id` (`ObjectId`) — ghi mới phân bố thế nào?
4. Query không chứa shard key trên cụm 10 shard — bao nhiêu shard được hỏi?
5. Secondary tụt lại xa hơn oplog window — nó catch up thế nào?
6. `w: 1`, primary chết ngay sau khi xác nhận ghi — ghi đó còn?
7. MongoDB không bật auth, bind `0.0.0.0`, có public IP — điều gì xảy ra?
8. `retryWrites: true`, failover giữa lúc ghi — ghi bị áp dụng mấy lần?

<details>
<summary>Đáp án</summary>

1. Chậm — mỗi lần đọc là đọc disk. Thêm index **không** giúp vì index cũng không vừa RAM.
2. **Không** — mất đa số, không bầu được primary. Đây là lý do dùng số node lẻ.
3. Dồn hết vào một shard (hot shard) — `ObjectId` tăng dần.
4. Cả 10 — scatter-gather.
5. **Không catch up được** — phải resync toàn bộ từ đầu.
6. Có thể **mất**.
7. Bị scan và tấn công — đã có nhiều đợt ransomware nhắm vào MongoDB mở.
8. Một lần — transaction number đảm bảo idempotent ở tầng protocol.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Giới hạn RAM container xuống dưới `indexSize`, chạy query | `pages read into cache` tăng vọt; latency tăng |
| Tăng RAM, đo lại | Cải thiện lớn hơn mọi tối ưu query |
| Replica set 3 node, kill primary, bấm giờ | Failover 10–30 giây; ghi thất bại trong khoảng đó |
| `retryWrites: false` + cùng thí nghiệm | Ghi lỗi thay vì tự retry |
| Shard theo `ObjectId`, ghi 1M document, xem phân bố | Một shard nhận hết |
| Query không có shard key, xem `explain` | `SHARD_MERGE` — mọi shard được hỏi |
| Chặn network tới một secondary vài giờ | Lag tăng; kiểm tra oplog window |
| Ghi rất nhiều rồi đọc secondary ngay | Dữ liệu cũ |
| Chạy `mongorestore` từ backup vào cluster test | Xác nhận backup dùng được — hoặc phát hiện nó không |
| `$indexStats` sau một tuần | Index không ai dùng |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Sharding là cách scale mặc định | Là bước cuối; index + RAM giải quyết phần lớn |
| Có thể đổi shard key sau | Rất khó (MongoDB 5.0+ có reshard, nhưng vẫn nặng) |
| Đọc secondary luôn tốt để scale | Replication lag gây đọc-sau-ghi sai |
| Replica set 2 node có HA | Không failover được; cần số lẻ |
| MongoDB an toàn theo mặc định | Nhiều cài đặt không bật auth |
| Thêm index luôn giúp | Không, nếu index không vừa RAM |
| `mongodump` là chiến lược backup cho DB lớn | Quá chậm; dùng snapshot |
| Backup tồn tại là đủ | Backup chưa restore thử không phải backup |

## Debugging

1. **Latency cao** → kiểm tra **WiredTiger cache hit ratio trước tiên**. Nếu thấp, đó là nguyên nhân và mọi thứ khác là thứ yếu.
2. **Query nào chậm** → profiler:
   ```js
   db.setProfilingLevel(1, { slowms: 100 });
   db.system.profile.find({ millis: { $gt: 100 } }).sort({ ts: -1 }).limit(20);
   ```
3. **Dữ liệu cũ** → `rs.printSecondaryReplicationInfo()` cho lag; kiểm tra `readPreference` của client.
4. **Secondary không catch up** → `rs.printReplicationInfo()` cho oplog window. Window ngắn hơn thời gian downtime = phải resync.
5. **Lỗi kết nối dưới tải** → `db.serverStatus().connections` so với `maxPoolSize × số instance`.
6. **Một shard nóng** → `db.collection.getShardDistribution()`; nếu lệch, shard key sai.
7. **Thao tác đang chạy** → `db.currentOp({ secs_running: { $gt: 5 } })`; `db.killOp(opid)` để dừng query xấu.
8. **Cluster health** → `rs.status()` cho trạng thái từng node.

## Production Considerations

- **RAM là quyết định capacity số một.** Working set (index đang dùng + dữ liệu nóng) phải vừa RAM.
- **Replica set 3 node tối thiểu**, số lẻ, ở nhiều availability zone.
- **`w: "majority"` cho ghi quan trọng** — mặc định `w: 1` có thể mất dữ liệu.
- **Bật auth và TLS** ngay từ đầu; không bao giờ expose MongoDB ra internet.
- **Profiler với `slowms`** bật thường trực ở mức hợp lý.
- **Alert trên**: cache hit ratio, replication lag, oplog window, connection count.
- **`maxTimeMS` cho mọi query từ application** để một query xấu không chạy vô hạn.
- **Test restore backup định kỳ** — đây là việc bị bỏ nhiều nhất và tốn nhất khi cần.
- **Trì hoãn sharding** tới khi thật sự cần; khi shard, chọn shard key cẩn thận vì rất khó đổi.
- **TTL index và archive** để giữ working set nhỏ — thường hiệu quả hơn thêm hardware.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Scale up (RAM) | đơn giản, hiệu quả nhất cho MongoDB | có trần, chi phí tăng |
| Sharding | vượt giới hạn một máy | phức tạp vận hành, shard key khó đổi |
| Đọc secondary | scale read, giảm tải primary | replication lag, đọc-sau-ghi sai |
| `w: majority` | bền | chậm hơn, cần đa số node sống |
| Hashed shard key | phân bố đều | range query scatter-gather |
| Compound shard key | targeted query + phân bố tốt | phải thiết kế cẩn thận |
| Oplog lớn | secondary chịu được downtime dài | tốn disk |
| Nhiều index | đọc nhanh nhiều pattern | tốn RAM — trực tiếp ảnh hưởng working set |

## Explain Without Notes

1. Working set là gì, và vì sao nó là chỉ số quan trọng nhất của MongoDB?
2. Vì sao replica set cần số node lẻ?
3. Ba tiêu chí của shard key, và vi phạm mỗi cái gây hậu quả gì?
4. Targeted vs scatter-gather query — khác nhau thế nào?
5. Oplog window là gì, và vì sao vượt nó là vấn đề nghiêm trọng?
6. Thứ tự 5 bước mở rộng trước khi shard?

## Related

- [Indexes & query planning](04-indexes-query-planning.md) — index và RAM
- [Transactions & consistency](06-transactions-consistency.md) — write concern, đọc secondary
- [Aggregation pipeline](05-aggregation-pipeline.md) — chạy analytics trên secondary
- [Replication & scaling (PostgreSQL)](../01-postgresql/operations/02-replication-scaling.md) — đối chiếu
- [WAL, durability & backup](../01-postgresql/operations/01-wal-durability-backup.md) — nguyên tắc backup
- [Connection pool](../01-postgresql/fundamentals/02-connection-pool.md) — cùng nguyên lý sizing
- [Data partitioning & sharding](../../06-system-design/05-data-partitioning-sharding.md) — lý thuyết sharding
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md)
- [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md)
