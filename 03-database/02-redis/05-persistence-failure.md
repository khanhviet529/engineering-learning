---
level: advanced
area: database
prerequisites:
  - 04-eviction-memory.md
related:
  - 06-pubsub-streams.md
  - ../01-postgresql/06-wal-durability-backup.md
  - ../../05-cross-cutting/reliability/01-failure-modes.md
---

# Persistence & failure

> Redis được restart để nâng cấp. Cache trống — dự kiến được. Nhưng cùng lúc đó: 40.000 người dùng bị đăng xuất (session ở Redis), 1.200 job đang chờ biến mất (queue ở Redis), và rate limit reset về 0 (một bot lợi dụng ngay trong phút đó). Ba hệ quả, và chỉ một trong ba từng được ai đó nghĩ tới.

## Position

```text
Client → Redis (RAM)
             ├──▶ RDB   snapshot định kỳ ra file
             └──▶ AOF   ghi từng lệnh vào file append-only
                          ↓
                   restart: nạp lại từ file
```

Câu hỏi trung tâm: **dữ liệu nào trong Redis mà mất đi là vấn đề?** Câu trả lời quyết định cấu hình persistence, và nó khác nhau cho từng loại dữ liệu — đó là lý do một instance Redis dùng chung cho mọi thứ luôn có cấu hình sai cho ít nhất một loại.

## Problem

Redis lưu trong RAM. RAM mất khi process chết. Mọi thứ khác trong note này là hệ quả.

Bốn loại dữ liệu điển hình trong Redis, với bốn mức chấp nhận mất khác nhau:

```text
Loại              Mất thì sao?                              Cần persistence?
cache             chậm hơn một lúc                           không
session           40.000 người phải đăng nhập lại            nên có
rate limit        cửa sổ tấn công ngắn                       tuỳ, thường không
queue/job         MẤT VIỆC — có thể là tiền                  BẮT BUỘC
lock              job chạy trùng                             không (TTL ngắn)
distributed state tuỳ                                        tuỳ
```

Bốn cột "cần persistence" khác nhau nghĩa là **một cấu hình không thể đúng cho cả bốn**.

## Mental Model

### RDB và AOF: hai cách, hai đánh đổi

```text
RDB (snapshot)
  Ghi toàn bộ dataset ra file nhị phân theo lịch (save 900 1 / 300 10 / 60 10000)
  + file nhỏ, nạp lại RẤT nhanh, tốt để backup và sao chép
  - MẤT dữ liệu từ snapshot cuối tới lúc crash (có thể vài phút)
  - fork() tốn bộ nhớ và có thể gây đứng ngắn

AOF (append-only file)
  Ghi mọi lệnh THAY ĐỔI dữ liệu vào file
  + mất tối đa 1 giây (với appendfsync everysec)
  - file lớn hơn, nạp lại chậm hơn
  - cần rewrite định kỳ để nén lại

CẢ HAI (khuyến nghị khi cần bền vững)
  RDB để backup và khôi phục nhanh; AOF để giảm mất mát
  Redis 7 có "multi-part AOF": AOF gồm một base RDB + các file tăng trưởng
```

### `appendfsync`: nút xoay durability

```text
always     fsync sau MỖI lệnh ghi     → mất 0, chậm ĐÁNG KỂ
everysec   fsync mỗi giây             → mất tối đa ~1 giây      ← mặc định hợp lý
no         để OS quyết định           → mất tới 30 giây
```

Khác biệt so với PostgreSQL đáng chú ý: PostgreSQL mặc định `synchronous_commit = on` (không mất commit đã xác nhận). Redis mặc định `everysec` (mất tối đa 1 giây). **Redis không hứa durability như một database quan hệ**, và mọi thiết kế dùng Redis phải tính đến điều đó.

Với `always`, throughput giảm mạnh vì mỗi lệnh phải chờ đĩa. Trong thực tế hầu như không ai dùng — nếu bạn cần durability đó, dữ liệu nên ở PostgreSQL.

### Chi phí ẩn của snapshot: `fork()`

```text
BGSAVE → fork() một tiến trình con
  · copy-on-write: page chỉ bị copy khi bị GHI
  · nếu Redis ghi nhiều trong lúc snapshot → nhiều page bị copy
  · bộ nhớ có thể tiến tới GẦN GẤP ĐÔI
  · trên máy có dataset lớn, chính lệnh fork() cũng mất vài trăm ms → Redis ĐỨNG
```

Hai hệ quả vận hành:

```text
① maxmemory phải ≤ ~60% RAM nếu bật RDB/AOF-rewrite
② latency spike định kỳ trùng với lịch snapshot
   → INFO stats: latest_fork_usec
```

Đây là lý do một số hệ thống chọn tắt persistence hoàn toàn trên instance cache và dựa vào replica cho tính sẵn sàng.

### Ba kịch bản mất dữ liệu

```text
① Restart có kiểm soát (SIGTERM)
   Redis lưu RDB trước khi thoát (nếu có cấu hình save)
   → mất ít hoặc không mất

② Crash / OOM kill / mất điện
   → mất từ điểm fsync cuối:  RDB → tới vài phút;  AOF everysec → ~1 giây

③ Failover sang replica
   Replication là BẤT ĐỒNG BỘ → replica có thể chậm hơn primary
   → mất phần chưa kịp gửi
```

Kịch bản ③ hay bị bỏ qua: có replica **không** nghĩa là không mất dữ liệu. `WAIT numreplicas timeout` cho phép chờ replica xác nhận, nhưng nó không phải sync replication thật và không đảm bảo trong mọi tình huống mạng.

### Redis không phải database bền vững

Đây là điểm mà nhiều kiến trúc đi sai:

```text
Redis phù hợp cho          Redis KHÔNG phù hợp cho
cache                       nguồn sự thật của dữ liệu nghiệp vụ
session (chấp nhận rủi ro)  giao dịch tài chính
rate limit                  dữ liệu phải audit được
lock ngắn hạn               dữ liệu cần transaction đa bước có rollback
hàng đợi công việc          dữ liệu quan hệ cần JOIN
                            dữ liệu lớn hơn RAM
```

Nếu mất dữ liệu là **không chấp nhận được**, nó phải ở PostgreSQL. Redis có thể là lớp tăng tốc phía trước, không phải nơi cất giữ.

Với queue: BullMQ trên Redis với AOF `everysec` mất tối đa ~1 giây job khi crash. Với job "gửi email" thì ổn. Với job "chuyển tiền" thì không — mẫu đúng là ghi ý định vào PostgreSQL (outbox) rồi mới enqueue. Xem [Outbox pattern](../04-message-queues/06-outbox-pattern.md).

### Sentinel và Cluster: tính sẵn sàng, không phải durability

```text
SENTINEL   giám sát primary; tự động promote replica khi primary chết
           + failover tự động, client tự tìm primary mới
           - vẫn async replication ⇒ VẪN mất dữ liệu khi failover
           - cần ≥3 sentinel để có quorum

CLUSTER    sharding + failover
           + vượt giới hạn RAM một máy
           - ràng buộc CROSSSLOT, vận hành phức tạp
           - vẫn async replication
```

Cả hai giải quyết **availability** (hệ thống còn phục vụ được), không giải quyết **durability** (dữ liệu không mất). Đây là hai thuộc tính khác nhau và thường bị gộp làm một.

### Split-brain

```text
Mạng bị chia cắt → Sentinel promote một replica
Primary cũ vẫn nhận ghi từ một phần client
→ HAI primary, hai nhánh dữ liệu
→ khi mạng lành, một nhánh bị VỨT BỎ
```

Giảm nhẹ:

```ini
# primary từ chối ghi nếu không đủ replica khoẻ
min-replicas-to-write 1
min-replicas-max-lag 10
```

Đây là đánh đổi CAP rõ ràng: chọn nhất quán hơn (từ chối ghi) thay vì sẵn sàng hơn (nhận ghi có thể mất). Xem [Consistency & availability](../../06-system-design/04-consistency-availability.md).

### Managed Redis

Dịch vụ quản lý (ElastiCache, Memorystore, Redis Cloud, Upstash) lo failover, backup, vá lỗi. Nhưng ba điều vẫn thuộc về bạn:

```text
① Chọn cấu hình persistence và eviction phù hợp với TỪNG loại dữ liệu
② Biết RPO thật của dịch vụ (thường vẫn là async replication)
③ Thiết kế ứng dụng chịu được việc Redis trống hoặc không tới được
```

Điều ③ là điều quan trọng nhất và không dịch vụ nào làm hộ.

## Example

Ba instance, ba cấu hình, cho ba loại dữ liệu:

```ini
# ═══ redis-cache ═══  mất hoàn toàn được
maxmemory 4gb
maxmemory-policy allkeys-lfu
save ""                          # không snapshot
appendonly no
# → không có chi phí fork, không có latency spike
# → restart = trống; ứng dụng PHẢI chịu được điều này
```

```ini
# ═══ redis-session ═══  mất = 40.000 người đăng nhập lại
maxmemory 2gb
maxmemory-policy volatile-lru    # session có TTL; dữ liệu khác thì không
appendonly yes
appendfsync everysec
```

```ini
# ═══ redis-queue ═══  mất = mất việc
maxmemory 2gb
maxmemory-policy noeviction      # thà từ chối còn hơn mất job
appendonly yes
appendfsync everysec
save 900 1                       # thêm RDB để khôi phục nhanh
```

Và phía ứng dụng, chịu được việc Redis trống:

```ts
// session: Redis trống → người dùng đăng nhập lại (khó chịu, không hỏng)
// cache:   Redis trống → cache warming + circuit breaker để DB không sập
// queue:   Redis trống → job phải phát lại được TỪ NGUỒN SỰ THẬT (outbox ở PostgreSQL)
```

Dòng cuối là thiết kế quan trọng nhất: **nếu queue của bạn không phát lại được từ database, bạn đang dùng Redis làm nguồn sự thật.**

## Prediction

1. Redis không có persistence, restart — cache, session, queue, rate limit thế nào?
2. Chỉ RDB `save 900 1`, crash sau 800 giây kể từ snapshot cuối — mất bao nhiêu?
3. AOF `everysec`, crash — mất bao nhiêu?
4. AOF `always` — mất bao nhiêu? Throughput thế nào?
5. `BGSAVE` trên dataset 8 GB, Redis đang ghi nhiều — bộ nhớ có thể lên tới bao nhiêu?
6. `maxmemory` đặt 90% RAM container, bật RDB — rủi ro?
7. Có replica, primary chết, Sentinel promote — có mất dữ liệu không?
8. Session ở Redis không persistence, deploy Redis mới — người dùng thấy gì?
9. Queue BullMQ trên Redis không persistence, Redis crash với 1.200 job đang chờ — mất gì? Phát lại được không?
10. Cùng tình huống nhưng job được ghi vào bảng `outbox` ở PostgreSQL trước — phát lại được không?
11. Mạng chia cắt, Sentinel promote replica, primary cũ vẫn nhận ghi — kết quả?
12. `min-replicas-to-write 1` được đặt, mọi replica chết — primary thế nào?
13. Dùng Redis làm nguồn sự thật cho số dư ví, AOF `everysec`, crash — hậu quả?

<details>
<summary>Đáp án</summary>

1. Cache trống (ổn). Session mất → mọi người đăng xuất. Queue mất → mất job. Rate limit reset → cửa sổ lạm dụng.
2. Mất **toàn bộ ghi trong 800 giây** đó (nếu chưa đủ điều kiện `save` khác kích hoạt).
3. Mất tối đa **~1 giây**.
4. Mất **0** (trong giới hạn của đĩa). Throughput giảm mạnh — mỗi lệnh chờ fsync.
5. Về lý thuyết tới **gần 16 GB** trong trường hợp xấu nhất (copy-on-write copy gần hết page).
6. `fork` cho `BGSAVE` làm RSS tăng → vượt giới hạn container → **OOMKilled** giữa lúc snapshot.
7. **Có thể** — replication async; phần chưa kịp gửi bị mất.
8. **Bị đăng xuất hàng loạt.** Đây là sự cố ở đầu note.
9. Mất **1.200 job**. Không phát lại được nếu Redis là nơi duy nhất lưu chúng.
10. **Có** — quét bảng `outbox` tìm bản ghi chưa `sentAt` và enqueue lại. Đây là lý do outbox tồn tại.
11. **Split-brain** — hai primary, hai nhánh dữ liệu; một nhánh sẽ bị vứt khi hợp nhất.
12. Primary **từ chối ghi**. Đó là lựa chọn có chủ đích: nhất quán hơn sẵn sàng.
13. Có thể mất giao dịch cuối. Với số dư ví, đó là **không chấp nhận được** — dữ liệu này thuộc về PostgreSQL.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `redis-cli DEBUG SLEEP 0` rồi `kill -9` Redis, restart | Mất gì tuỳ cấu hình |
| Không persistence, ghi 10.000 key, `kill -9`, restart | Trống hoàn toàn |
| Bật AOF `everysec`, lặp lại | Còn gần hết |
| Bật AOF `always`, đo throughput so với `everysec` | Chênh lệch đáng kể |
| `BGSAVE` trên dataset lớn khi đang ghi, theo dõi RSS | Tăng vọt |
| `INFO stats \| grep latest_fork_usec` | Thời gian fork; tương quan với latency spike |
| Đặt session ở Redis không persistence, restart | Đăng xuất hàng loạt |
| Đẩy 1.000 job vào BullMQ, `kill -9` Redis không AOF, restart | Job biến mất |
| Thêm outbox ở PostgreSQL, lặp lại, chạy job phát lại | Job được khôi phục |
| Dựng Sentinel 3 node, giết primary, đo thời gian failover và số ghi mất | RTO và RPO thật |
| Chia cắt mạng giữa primary và Sentinel | Split-brain |
| Đặt `min-replicas-to-write 1`, giết replica, thử ghi | Primary từ chối |
| Đo thời gian nạp lại AOF 5 GB vs RDB tương đương | RDB nhanh hơn nhiều |

Thí nghiệm về Sentinel đáng làm một lần trên staging: nó cho bạn con số RPO/RTO thật thay vì giả định.

## What Usually Goes Wrong

- **Không phân biệt loại dữ liệu** → một cấu hình cho tất cả, sai cho ít nhất một loại.
- **Session ở Redis không persistence** → đăng xuất hàng loạt mỗi lần restart.
- **Queue ở Redis không persistence và không outbox** → mất job vĩnh viễn.
- **Coi Redis là database bền vững** → mất dữ liệu nghiệp vụ.
- **`maxmemory` quá cao khi bật persistence** → OOM khi fork.
- **Không biết fork gây latency spike** → "Redis chậm định kỳ" không giải thích được.
- **Tưởng có replica là không mất dữ liệu** → replication async.
- **Không diễn tập failover** → RTO/RPO chỉ là giả định.
- **Không có kế hoạch cho Redis trống** → thundering herd làm sập DB.
- **AOF không rewrite** → file phình, restart rất chậm.
- **Chỉ RDB với `save` thưa** → mất nhiều hơn dự kiến khi crash.
- **Split-brain không giảm nhẹ** → mất dữ liệu một nhánh sau khi hợp nhất.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Redis có persistence nên bền vững như database | Mặc định mất tới ~1 giây; RDB có thể mất nhiều phút |
| AOF nghĩa là không mất gì | Chỉ với `appendfsync always` |
| Có replica là không mất dữ liệu | Replication bất đồng bộ |
| Sentinel giải quyết mất dữ liệu | Nó giải quyết **availability**, không phải durability |
| Snapshot miễn phí | `fork` tốn bộ nhớ và gây đứng ngắn |
| Copy-on-write nghĩa là không tốn thêm RAM | Ghi nhiều lúc fork ⇒ copy nhiều page |
| Managed Redis lo hết | Bạn vẫn chọn cấu hình và vẫn phải chịu được Redis trống |
| Restart Redis là thao tác vô hại | Tuỳ vào cái gì đang nằm trong đó |
| Queue trên Redis an toàn như queue trên DB | Nó nhanh hơn nhiều và bền vững kém hơn nhiều |
| AOF luôn tốt hơn RDB | RDB nạp lại nhanh hơn nhiều và tốt hơn để backup |

## Debugging

1. **Kiểm tra cấu hình thật, không phải cấu hình bạn nghĩ**:
   ```bash
   redis-cli CONFIG GET save
   redis-cli CONFIG GET appendonly
   redis-cli CONFIG GET appendfsync
   redis-cli CONFIG GET maxmemory-policy
   ```
2. **Trạng thái persistence**: `redis-cli INFO persistence` — `rdb_last_save_time`, `rdb_last_bgsave_status`, `aof_last_write_status`, `aof_rewrite_in_progress`.
3. **Latency spike định kỳ** → `latest_fork_usec` và lịch snapshot. Tương quan thời gian là bằng chứng.
4. **Sau restart mất dữ liệu** → có file RDB/AOF không? `rdb_last_save_time` là bao giờ? Log khởi động nói nạp từ đâu?
5. **Replication lag**: `redis-cli INFO replication` — `master_repl_offset` so với `slave_repl_offset`.
6. **`redis-cli --latency`** và `--latency-history` — đo latency thật từ phía client.
7. **AOF quá lớn** → `aof_rewrite_in_progress`, `aof_base_size` vs `aof_current_size`. Cân nhắc `BGREWRITEAOF`.
8. **Sau sự cố, đo lại** RPO thật: bao nhiêu ghi bị mất, và có khớp với cấu hình không.

## Production Considerations

- **Phân loại dữ liệu trước, cấu hình sau.** Danh sách "cái gì trong Redis, mất thì sao" là tài liệu đầu tiên cần có.
- **Tách instance theo mức bền vững cần thiết** — cache (không persistence), session/queue (AOF).
- **Dữ liệu không được mất thì không để Redis là nơi duy nhất.** Queue quan trọng phải có outbox ở PostgreSQL.
- **`maxmemory` ≤ 60% RAM khi bật persistence** — chừa chỗ cho fork.
- **Theo dõi `latest_fork_usec`** và lên lịch snapshot vào giờ thấp điểm.
- **Diễn tập failover trên staging**, bấm giờ, đếm số ghi mất. RPO/RTO chỉ có ý nghĩa khi đã đo.
- **`min-replicas-to-write`** nếu mất dữ liệu khi split-brain là không chấp nhận được.
- **Backup RDB ra nơi khác** (object storage) nếu Redis chứa dữ liệu không tái tạo được.
- **Alert trên**: `rdb_last_bgsave_status != ok`, `aof_last_write_status != ok`, replication lag, thời gian từ lần save cuối.
- **Thiết kế ứng dụng chịu được Redis không tới được** — fail-open cho cache, thông báo rõ ràng cho session, phát lại được cho queue.
- **Nâng cấp Redis là thao tác có rủi ro** — lên kế hoạch như một sự kiện, không phải một lệnh.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không persistence | nhanh nhất, không fork | mất sạch khi restart |
| Chỉ RDB | file nhỏ, nạp nhanh, tốt để backup | mất tới vài phút |
| Chỉ AOF | mất tối đa ~1 giây | file lớn, nạp chậm, cần rewrite |
| RDB + AOF | cân bằng tốt nhất | chi phí I/O và fork của cả hai |
| `appendfsync always` | gần như không mất | throughput giảm mạnh |
| `appendfsync everysec` | cân bằng | mất tối đa 1 giây |
| Replica | đọc mở rộng, failover được | async ⇒ vẫn mất khi failover |
| Sentinel | failover tự động | phức tạp, vẫn mất dữ liệu |
| `min-replicas-to-write` | ít mất khi split-brain | primary có thể từ chối ghi |
| Managed service | không vận hành | đắt, ít kiểm soát cấu hình |
| Dữ liệu quan trọng ở PostgreSQL | bền vững thật | chậm hơn, phức tạp hơn |

## Explain Without Notes

1. RDB và AOF khác nhau ở ba điểm nào? Khi nào dùng cả hai?
2. Ba mức `appendfsync` và mất bao nhiêu ở mỗi mức?
3. Vì sao `BGSAVE` có thể làm bộ nhớ tăng gần gấp đôi?
4. Vì sao có replica vẫn mất dữ liệu khi failover?
5. Sentinel giải quyết vấn đề gì, và **không** giải quyết vấn đề gì?
6. Split-brain xảy ra thế nào, và `min-replicas-to-write` đánh đổi cái gì?
7. Bốn loại dữ liệu trong Redis và mức persistence cần thiết cho từng loại?
8. Vì sao queue quan trọng cần outbox ở PostgreSQL?

## Related

- [Eviction & memory](04-eviction-memory.md) — `maxmemory`, fork và OOM
- [Cache patterns](03-cache-patterns.md) — thundering herd khi Redis trống
- [Redis pub/sub & streams](06-pubsub-streams.md) — pub/sub không có persistence
- [WAL, durability & backup](../01-postgresql/06-wal-durability-backup.md) — so sánh với PostgreSQL
- [Outbox pattern](../04-message-queues/06-outbox-pattern.md) — nguồn sự thật cho job
- [Vì sao cần queue](../04-message-queues/01-why-queue.md) — Redis queue vs broker chuyên dụng
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — CAP và `min-replicas-to-write`
- [Failure modes](../../05-cross-cutting/reliability/01-failure-modes.md) — phân loại hỏng hóc
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — sống sót khi Redis mất

## Version / Context

Redis 7. Multi-part AOF (base RDB + incremental) từ Redis 7. `appendfsync everysec` là mặc định khi bật AOF. Sentinel cần ≥3 node để có quorum. Với Redis Cluster, mỗi shard có cơ chế failover riêng.
