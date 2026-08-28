---
level: advanced
area: database
prerequisites:
  - 06-wal-durability-backup.md
  - 03-connection-pool.md
related:
  - ../../06-system-design/04-consistency-availability.md
  - ../../04-infrastructure/04-kubernetes/08-storage-statefulset.md
---

# Replication & scaling

> Bạn thêm read replica và định tuyến mọi `GET` sang đó. Tải trên primary giảm một nửa. Rồi bug xuất hiện: người dùng tạo một task, được chuyển tới trang chi tiết, và nhận **404**. Làm mới trang thì task hiện ra. Không tái hiện được ở local, không có lỗi trong log, và tỉ lệ khoảng 3% — cao hơn vào giờ cao điểm.

## Position

```text
Primary (ghi)  ──WAL──▶  Replica 1 (đọc)
               ──WAL──▶  Replica 2 (đọc)
                              ↑ trễ vài mili giây tới vài giây

App: định tuyến đọc/ghi   ← nơi bug ở trên sinh ra
```

## Problem

Một PostgreSQL instance có giới hạn:

```text
CPU        query nặng, nhiều connection
RAM        shared_buffers, work_mem × connection
Disk I/O   đọc dữ liệu không trong cache, ghi WAL
Ghi        chỉ MỘT node ghi được — đây là giới hạn cứng
```

Ba cách mở rộng, và chúng không thay thế nhau:

```text
VERTICAL      máy to hơn
              + đơn giản nhất, không đổi code
              - có trần, đắt theo cấp số nhân, vẫn là một điểm chết

READ REPLICA  nhân bản đọc
              + giải quyết tải ĐỌC (thường là 80–95% traffic)
              - KHÔNG giúp gì cho ghi
              - sinh ra replication lag → lớp bug mới

SHARDING      chia dữ liệu ra nhiều cụm
              + mở rộng cả ghi
              - phức tạp lớn: không JOIN xuyên shard, không transaction xuyên shard,
                rebalance khó
```

Thứ tự đúng gần như luôn là: **tối ưu query → vertical → read replica → (rất muộn) sharding.** Nhiều hệ thống nhảy sang sharding khi vấn đề thật là một query thiếu index.

## Mental Model

### Streaming replication: gửi WAL đi

```text
Primary                              Replica
  COMMIT                               
    ↓ ghi WAL                          
    ↓ walsender  ──── TCP ────▶  walreceiver
                                       ↓ ghi WAL local
                                       ↓ startup process phát lại
                                       ↓ dữ liệu hiện ra cho query
```

Replica là **read-only**. Mọi `INSERT/UPDATE/DELETE/DDL` trên nó đều lỗi.

Hai chế độ:

```text
ASYNC   (mặc định)  primary COMMIT ngay, không chờ replica
                    → ghi nhanh
                    → mất dữ liệu khi failover (những gì chưa kịp gửi)

SYNC                primary chờ replica xác nhận rồi mới COMMIT
                    → không mất dữ liệu
                    → mỗi ghi tốn thêm một round-trip mạng
                    → replica chết ⇒ primary DỪNG GHI (trừ khi có replica dự phòng)
```

Điểm cuối rất quan trọng: `synchronous_standby_names = 'replica1'` với một replica duy nhất biến replica thành **điểm chết của primary**. Cấu hình an toàn dùng quorum:

```ini
synchronous_standby_names = 'ANY 1 (replica1, replica2)'
```

### Replication lag: nguồn của mọi bug

```sql
-- trên replica
SELECT now() - pg_last_xact_replay_timestamp() AS lag;
```

```text
Bình thường:      1–50 ms
Ghi hàng loạt:    vài giây tới vài phút
Query dài trên replica + hot_standby_feedback: có thể tăng vô hạn
```

Bug ở đầu note, viết ra thành dòng thời gian:

```text
t=0     POST /tasks   → primary → INSERT → COMMIT → trả về id=123
t=0.01  client redirect tới /tasks/123
t=0.02  GET /tasks/123 → REPLICA → chưa nhận WAL → 404
t=0.05  WAL tới replica → giờ mới có
```

Đây là **read-your-own-write**, và nó là lớp bug đặc trưng của kiến trúc có replica. Nó không xuất hiện ở local (không có replica), hiếm ở staging (ít tải), và xuất hiện ở production đúng lúc traffic cao (lag lớn hơn).

### Bốn cách xử lý read-your-own-write

```text
① Ghi rồi đọc TRONG CÙNG request → luôn đọc primary
   Đơn giản nhất, đúng nhất. Nên là mặc định.

② "Sticky primary" sau khi ghi
   Sau một ghi, mọi đọc của user đó đi primary trong N giây.
   Lưu mốc thời gian trong session/cookie.

③ Chờ theo LSN
   Ghi xong lấy pg_current_wal_lsn(); đọc thì chờ replica đạt LSN đó.
   Chính xác nhất, phức tạp nhất.

④ Thiết kế UI không cần đọc lại
   API ghi trả về luôn object vừa tạo; client dùng nó, không GET lại.
   Rẻ nhất, và thường là câu trả lời đúng.
```

Cách ④ đáng cân nhắc trước tiên: nó xoá vấn đề thay vì xử lý nó.

### Định tuyến đọc/ghi: quy tắc rõ ràng

```ts
// quy tắc mặc định
const db = {
  write: primaryPool,
  read:  replicaPool,
};

// PHẢI dùng primary:
//  · mọi ghi
//  · đọc bên trong một transaction có ghi
//  · đọc ngay sau ghi trong cùng request
//  · đọc mà quyết định phụ thuộc vào tính tươi (kiểm tra tồn kho, kiểm tra quyền)
//  · đọc để rồi ghi (SELECT ... FOR UPDATE)

// DÙNG ĐƯỢC replica:
//  · báo cáo, dashboard, analytics
//  · tìm kiếm, danh sách
//  · export
//  · bất cứ gì chấp nhận trễ vài giây
```

Điểm dễ sai nhất là dòng "đọc mà quyết định phụ thuộc vào tính tươi". Kiểm tra quyền trên replica nghĩa là quyền vừa bị thu hồi vẫn còn hiệu lực trong vài giây.

Cảnh báo về ORM: nhiều ORM có tính năng "read replica" tự động định tuyến theo loại câu lệnh. Nó **không** biết ngữ cảnh nghiệp vụ, nên nó sẽ định tuyến sai đúng những trường hợp trên. Dùng nó với một cơ chế opt-out tường minh.

### Xung đột trên replica: query bị huỷ

```text
ERROR: canceling statement due to conflict with recovery
DETAIL: User query might have needed to see row versions that must be removed.
```

Nguyên nhân: replica phải phát lại WAL, trong đó có vacuum xoá version cũ mà query dài trên replica đang cần đọc.

Hai lựa chọn, mỗi cái một cái giá:

```ini
# ① replica báo ngược xmin cho primary → primary không vacuum version đó
hot_standby_feedback = on
#   + query dài trên replica không bị huỷ
#   - primary BỊ CHẶN VACUUM → bloat trên primary
#     (đúng cùng cơ chế với transaction dài — xem MVCC & vacuum)

# ② cho phép replica trễ hơn để query kịp xong
max_standby_streaming_delay = 30s
#   + query không bị huỷ trong 30 giây
#   - lag tăng tới 30 giây
```

Không có lựa chọn miễn phí. Với replica chuyên chạy báo cáo dài, `hot_standby_feedback = on` là hợp lý — nhưng phải theo dõi bloat trên primary.

### Logical replication: khác mục đích hoàn toàn

```sql
-- primary
CREATE PUBLICATION app_pub FOR TABLE orders, users;
-- đích
CREATE SUBSCRIPTION app_sub CONNECTION '...' PUBLICATION app_pub;
```

```text
PHYSICAL (streaming)          LOGICAL
toàn bộ cluster               chọn bảng
cùng version PostgreSQL       khác version được → NÂNG CẤP KHÔNG DOWNTIME
đích là read-only             đích GHI ĐƯỢC
byte-level, rất hiệu quả      giải mã, tốn hơn
```

Ứng dụng chính của logical replication **không** phải scale đọc — nó là:

```text
· nâng cấp major version gần như không downtime
· đồng bộ một tập bảng sang data warehouse
· gộp nhiều database vào một
· CDC (change data capture) cho hệ thống event
```

Hạn chế đáng biết: mặc định nó **không** replicate DDL, sequence, và (tuỳ version) TRUNCATE. Bảng phải có `REPLICA IDENTITY` (thường là primary key) để `UPDATE`/`DELETE` replicate được.

### Failover và split-brain

```text
Primary chết
   ↓
Phát hiện (health check)
   ↓
Chọn replica có LSN cao nhất
   ↓
Promote nó thành primary
   ↓
Chuyển traffic (đổi DNS / cập nhật HAProxy / cập nhật Service)
   ↓
Rebuild các replica còn lại từ primary mới
```

Rủi ro lớn nhất là **split-brain**: primary cũ chưa thật sự chết (chỉ là mạng bị chia cắt) và cả hai đều nhận ghi. Kết quả là hai nhánh dữ liệu không thể gộp lại.

Vì thế **đừng tự viết failover.** Dùng Patroni, repmgr, hoặc dịch vụ managed (RDS, Cloud SQL). Chúng dùng consensus (etcd/Consul) và fencing để đảm bảo chỉ một primary.

Và nhắc lại điều quan trọng nhất: **replica không phải backup.** `DROP TABLE` được replicate trong mili giây. Xem [WAL, durability & backup](06-wal-durability-backup.md).

### Sharding: khi nào, và cái giá

```text
Dấu hiệu thật sự cần sharding:
  · tải GHI vượt khả năng của một node sau khi đã tối ưu
  · dữ liệu lớn hơn đĩa của node lớn nhất
  · yêu cầu pháp lý về vị trí dữ liệu (data residency)

Cái giá:
  · không JOIN xuyên shard
  · không transaction xuyên shard (hoặc cần 2PC/saga)
  · unique toàn cục cần thiết kế riêng (UUID, snowflake)
  · rebalance khi thêm shard là dự án riêng
  · mọi query phải biết shard key
```

Chọn shard key là quyết định khó đảo ngược nhất:

```text
tenant_id / user_id   ✓ hầu hết query nằm trong một tenant
                      ✗ tenant lớn tạo hot shard

hash(id)              ✓ phân bố đều
                      ✗ mọi query theo user phải hỏi mọi shard

theo thời gian        ✓ hợp cho dữ liệu chuỗi thời gian
                      ✗ shard mới nhất luôn nóng
```

Trước khi sharding, hãy chắc rằng đã làm hết: tối ưu query, partition trong một instance, cache, tách dữ liệu lạnh, và vertical scaling. Trong thực tế, phần lớn hệ thống không bao giờ cần đến sharding.

**Partition** (chia bảng trong cùng một instance) khác sharding và rẻ hơn nhiều:

```sql
CREATE TABLE events (id bigserial, created_at timestamptz NOT NULL, ...)
PARTITION BY RANGE (created_at);
CREATE TABLE events_2026_01 PARTITION OF events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

Nó cho: partition pruning (query chỉ chạm partition liên quan), `DROP TABLE` tức thì cho dữ liệu cũ (thay vì `DELETE` tạo bloat), và vacuum/index nhỏ hơn. Đây thường là thứ bạn cần chứ không phải sharding.

## Example

Định tuyến đọc/ghi có kiểm soát:

```ts
@Injectable()
export class DbRouter {
  constructor(private readonly primary: Pool, private readonly replica: Pool) {}

  // mặc định AN TOÀN: primary. Muốn dùng replica phải nói rõ.
  query(sql: string, params: unknown[], opts?: { replica?: boolean }) {
    return (opts?.replica ? this.replica : this.primary).query(sql, params);
  }
}
```

```ts
// dùng ở nơi chấp nhận được trễ
const report = await this.db.query(HEAVY_REPORT_SQL, [from, to], { replica: true });

// mặc định: primary — không thể quên
const task = await this.db.query('SELECT * FROM tasks WHERE id = $1', [id]);
```

Hướng mặc định quan trọng: **mặc định primary, opt-in replica.** Nếu ngược lại, một endpoint mới sẽ vô tình đọc dữ liệu cũ và bug chỉ lộ ở production.

Và theo dõi lag như một metric:

```ts
setInterval(async () => {
  const { rows } = await replica.query(
    `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())), 0) AS lag`);
  metrics.gauge('pg_replica_lag_seconds', Number(rows[0].lag));
}, 5_000);
```

## Prediction

1. Ghi vào primary rồi đọc ngay từ replica trong cùng request — kết quả? Tỉ lệ lỗi phụ thuộc gì?
2. `INSERT` chạy trên replica — kết quả?
3. Replication async, primary chết đột ngột — mất gì?
4. Replication sync với **một** replica, replica chết — primary thế nào?
5. `synchronous_standby_names = 'ANY 1 (r1, r2)'`, r1 chết — primary thế nào?
6. `DROP TABLE users` trên primary — replica thế nào? Có phải backup không?
7. Query báo cáo 10 phút trên replica, primary đang vacuum bảng đó — kết quả?
8. Bật `hot_standby_feedback = on` — sửa được câu 7, nhưng gây gì cho primary?
9. Kiểm tra quyền (`SELECT roles FROM ...`) đọc từ replica, quyền vừa bị thu hồi — hậu quả?
10. ORM tự định tuyến `SELECT` sang replica, có một `SELECT ... FOR UPDATE` — chuyện gì xảy ra?
11. Nâng cấp PostgreSQL 15 → 16, muốn downtime tối thiểu — dùng physical hay logical replication?
12. Sharding theo `tenant_id`, một tenant chiếm 60% dữ liệu — vấn đề gì?
13. Partition theo tháng, xoá dữ liệu 2 năm trước — chi phí so với `DELETE`?

<details>
<summary>Đáp án</summary>

1. Có thể **404 / không thấy dữ liệu**. Tỉ lệ phụ thuộc replication lag so với thời gian giữa ghi và đọc; tăng khi tải cao.
2. Lỗi: `cannot execute INSERT in a read-only transaction`.
3. Mất mọi transaction đã commit trên primary nhưng chưa kịp gửi/áp dụng ở replica.
4. Primary **dừng ghi** — nó chờ xác nhận từ một replica không còn tồn tại.
5. Primary tiếp tục bình thường với r2. Đây là lý do dùng quorum.
6. Bảng bị xoá trên replica trong mili giây. **Không phải backup.**
7. Query có thể bị huỷ: `canceling statement due to conflict with recovery`.
8. Primary **không vacuum được** version mà replica đang cần → bloat trên primary, đúng như một transaction dài.
9. User bị thu hồi quyền vẫn truy cập được trong khoảng thời gian bằng lag. Đây là lỗ hổng bảo mật do quyết định kiến trúc.
10. `FOR UPDATE` trên replica read-only → lỗi. Và nếu ORM định tuyến `SELECT` thường trong một transaction ghi sang replica, bạn có dữ liệu không nhất quán trong transaction.
11. **Logical** — nó replicate được giữa hai major version khác nhau.
12. Hot shard: một shard chịu 60% tải, các shard khác nhàn rỗi. Sharding không giúp gì cho tenant đó.
13. `DROP TABLE events_2024_01` — **tức thì**, không tạo dead tuple. `DELETE` tạo hàng triệu dead tuple và cần vacuum sau đó.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dựng primary + replica bằng Docker, `INSERT` rồi `SELECT` ngay từ replica trong vòng lặp | Đếm số lần không thấy dữ liệu |
| Tạo tải ghi lớn, đo lag trên replica | Lag tăng theo tải |
| Ngắt mạng replica 5 phút rồi nối lại | Lag tăng vọt rồi bắt kịp; xem WAL tích ở primary |
| Cấu hình sync với 1 replica, dừng replica | Primary dừng ghi |
| Đổi sang `ANY 1 (r1, r2)`, dừng r1 | Primary chạy tiếp |
| `INSERT` trên replica | Lỗi read-only |
| Query 5 phút trên replica + `VACUUM` trên primary | Query bị huỷ |
| Bật `hot_standby_feedback`, lặp lại, rồi xem `n_dead_tup` trên primary | Query sống, primary bloat |
| Thu hồi quyền rồi gọi API đọc quyền từ replica ngay | Quyền cũ vẫn hiệu lực |
| Bật định tuyến tự động của ORM rồi tìm chỗ nó định tuyến sai | Ít nhất một chỗ |
| Tạo publication logical, `ALTER TABLE ADD COLUMN` trên nguồn | DDL **không** được replicate |
| Partition theo tháng, `DROP` một partition vs `DELETE` cùng lượng dữ liệu | So thời gian và dead tuple |

## What Usually Goes Wrong

- **Đọc ngay sau ghi từ replica** → 404 ngẫu nhiên, chỉ ở production.
- **Định tuyến tự động của ORM** → sai ở đúng những chỗ quan trọng.
- **Mặc định replica thay vì mặc định primary** → endpoint mới vô tình đọc dữ liệu cũ.
- **Kiểm tra quyền/tồn kho trên replica** → quyết định dựa trên dữ liệu cũ.
- **Sync replication với một replica** → replica thành điểm chết của primary.
- **Coi replica là backup** → không khôi phục được sau lỗi logic.
- **Không theo dõi lag** → không biết cho tới khi người dùng báo.
- **`hot_standby_feedback = on` mà không theo dõi bloat** → primary phình.
- **Replication slot bỏ quên sau khi xoá replica** → WAL đầy đĩa + vacuum bị chặn.
- **Tự viết failover** → split-brain, hai nhánh dữ liệu.
- **Sharding quá sớm** → phức tạp lớn cho vấn đề mà index đã giải quyết được.
- **Chọn shard key sai** → hot shard, và đổi shard key là dự án migration lớn.
- **Quên rằng logical replication không replicate DDL** → schema lệch dần.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Replica giải quyết vấn đề scale | Chỉ scale **đọc**; ghi vẫn một node |
| Replica là backup | Nó replicate cả `DROP TABLE` của bạn |
| Replication lag chỉ vài ms nên bỏ qua được | Nó tăng theo tải, đúng lúc bạn không muốn |
| Sync replication không mất dữ liệu và không có nhược điểm | Replica chết có thể làm primary dừng ghi |
| ORM định tuyến replica là an toàn | Nó không biết ngữ cảnh nghiệp vụ |
| Logical replication để scale đọc | Chủ yếu để nâng cấp version và CDC |
| Logical replication replicate mọi thứ | Không có DDL, sequence; cần `REPLICA IDENTITY` |
| Failover là chuyện đơn giản | Split-brain là rủi ro thật; dùng công cụ có consensus |
| Sharding là bước tiếp theo sau replica | Partition, cache, tối ưu query đứng trước |
| Partition và sharding như nhau | Partition trong một instance; sharding qua nhiều cụm |

## Debugging

1. **Bug "dữ liệu không thấy ngay"** → nghi replication lag trước tiên. Log xem request đó đọc từ đâu.
2. **Đo lag ở cả hai phía**:
   ```sql
   -- trên replica
   SELECT now() - pg_last_xact_replay_timestamp() AS lag;
   -- trên primary
   SELECT application_name, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
          pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_bytes_behind
   FROM pg_stat_replication;
   ```
   Bốn cột LSN cho biết nghẽn ở đâu: mạng (`sent` chậm), đĩa replica (`write`/`flush` chậm), hay replay (`replay` chậm).
3. **Query bị huỷ trên replica** → xem `pg_stat_database_conflicts`.
4. **Ghi thất bại "read-only"** → định tuyến sai.
5. **WAL tích ở primary** → `pg_replication_slots`, tìm slot không active.
6. **Bloat trên primary sau khi thêm replica** → nghi `hot_standby_feedback`.
7. **Sau failover, dữ liệu thiếu** → replication async; kiểm tra lag tại thời điểm failover.

## Production Considerations

- **Mặc định đọc từ primary; opt-in replica cho từng chỗ cụ thể.** Hướng mặc định quyết định lớp bug bạn sẽ gặp.
- **Alert trên replication lag** (> 10 giây là dấu hiệu; > 60 giây là sự cố).
- **Alert trên replication slot không active** — nó gây đầy đĩa và chặn vacuum.
- **Dùng quorum sync** (`ANY 1 (...)`) nếu cần sync, không bao giờ sync với một replica duy nhất.
- **Replica riêng cho báo cáo**, với `max_standby_streaming_delay` cao — tách khỏi replica phục vụ ứng dụng.
- **Dùng công cụ HA có consensus** (Patroni + etcd) hoặc managed service. Failover tự viết là cách tạo split-brain.
- **Diễn tập failover** trên staging, có bấm giờ. RTO chỉ có ý nghĩa khi đã đo.
- **Partition trước khi nghĩ tới sharding.** Nó giải quyết phần lớn vấn đề kích thước với chi phí thấp hơn nhiều.
- **Logical replication cho nâng cấp major version** — đây là cách giảm downtime từ hàng giờ xuống hàng phút.
- **Ghi rõ trong code chỗ nào đọc replica và vì sao chấp nhận được** — dòng comment đó là thứ ngăn người sau định tuyến nhầm.
- **Kiểm tra định kỳ dữ liệu giữa primary và replica** (đếm dòng, checksum một số bảng) — logical replication có thể lệch âm thầm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Vertical scaling | đơn giản, không đổi code | có trần, đắt, một điểm chết |
| Read replica | scale đọc, có node dự phòng | lag, phức tạp định tuyến |
| Async replication | ghi nhanh | mất dữ liệu khi failover |
| Sync replication | RPO = 0 | ghi chậm; rủi ro dừng ghi |
| Quorum sync | cân bằng | cần ≥ 2 replica |
| `hot_standby_feedback = on` | query dài trên replica sống | bloat trên primary |
| `max_standby_delay` cao | query dài sống | lag lớn hơn |
| Mặc định đọc primary | đúng, an toàn | không tận dụng replica hết |
| Mặc định đọc replica | tận dụng tốt | bug read-your-own-write |
| Partition | rẻ, `DROP` tức thì, pruning | thêm phức tạp DDL |
| Sharding | scale ghi | mất JOIN/transaction xuyên shard |
| Managed service | không vận hành | đắt, ít kiểm soát |

## Explain Without Notes

1. Vẽ đường đi của một transaction từ COMMIT trên primary tới khi hiện ra trên replica.
2. Read-your-own-write là gì? Kể bốn cách xử lý và cách nào bạn chọn trước.
3. Vì sao sync replication với một replica biến replica thành điểm chết?
4. Vì sao replica không phải backup? Cho một kịch bản.
5. `hot_standby_feedback` giải quyết gì và gây ra gì?
6. Physical và logical replication khác nhau ở ba điểm nào? Mỗi cái dùng cho gì?
7. Partition khác sharding thế nào, và vì sao nên thử partition trước?
8. Split-brain là gì và vì sao không nên tự viết failover?

## Related

- [WAL, durability & backup](06-wal-durability-backup.md) — WAL là thứ được replicate; replica ≠ backup
- [MVCC & vacuum](04-mvcc-vacuum.md) — `hot_standby_feedback` và replication slot chặn vacuum
- [Connection pool](03-connection-pool.md) — mỗi replica cần pool riêng
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — CAP, eventual consistency
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — replica trong bức tranh lớn
- [Storage & StatefulSet](../../04-infrastructure/04-kubernetes/08-storage-statefulset.md) — chạy PostgreSQL trên K8s
- [Failure modes](../../05-cross-cutting/reliability/01-failure-modes.md) — failover, split-brain
- [Database & transactions (NestJS)](../../02-backend-api/02-nestjs/06-database-integration-transactions.md) — định tuyến ở tầng ứng dụng

## Version / Context

PostgreSQL 16. Logical replication từ 10, cải tiến nhiều ở 15–16 (lọc dòng, lọc cột, replicate từ standby). `max_slot_wal_keep_size` từ 13. Công cụ HA: Patroni, repmgr, pg_auto_failover.
