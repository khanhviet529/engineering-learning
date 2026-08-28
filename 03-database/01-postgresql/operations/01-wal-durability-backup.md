---
level: advanced
area: database
prerequisites:
  - ../transactions-concurrency/01-transaction-isolation.md
  - ../transactions-concurrency/02-mvcc-vacuum.md
related:
  - 02-replication-scaling.md
  - ../../../05-cross-cutting/reliability/01-failure-modes.md
---

# WAL, durability & backup

> Server mất điện lúc 14:03. Bật lại lúc 14:09. Câu hỏi duy nhất quan trọng: **những transaction đã trả về "thành công" cho người dùng trước 14:03 có còn không?** Và câu hỏi thứ hai, thường không ai hỏi cho tới khi cần: **nếu ổ đĩa hỏng hẳn thì sao?**

## Position

```text
COMMIT
   ↓
WAL buffer  →  fsync  →  pg_wal/*.wal trên đĩa    ← điểm "đã bền vững"
   ↓ (bất đồng bộ, sau đó)
shared_buffers  →  checkpoint  →  file dữ liệu
   ↓
archive_command / replication slot  →  backup, replica
```

WAL (Write-Ahead Log) là cơ chế nền của **ba** thứ tưởng như không liên quan: durability khi crash, replication, và point-in-time recovery. Hiểu WAL là hiểu cả ba cùng lúc.

## Problem

Ghi dữ liệu ra đĩa ngẫu nhiên là chậm:

```text
Một transaction sửa 3 dòng ở 3 bảng khác nhau
  → 3 page 8 KB ở 3 vị trí ngẫu nhiên trên đĩa
  → 3 lần random write + fsync
  → trên HDD: ~30 ms.  Ngay cả trên SSD, fsync ngẫu nhiên vẫn đắt.
```

Và nếu crash xảy ra **giữa** ba lần ghi đó, database ở trạng thái nửa vời — không phục hồi được.

WAL giải quyết cả hai bằng một ý tưởng:

```text
Trước khi sửa file dữ liệu, ghi "TÔI SẼ SỬA GÌ" vào một file TUẦN TỰ.
COMMIT chỉ cần fsync file tuần tự đó.
File dữ liệu được cập nhật sau, thong thả.
```

```text
Được:
  · ghi tuần tự nhanh hơn ghi ngẫu nhiên nhiều lần
  · một fsync cho cả transaction, bất kể sửa bao nhiêu bảng
  · crash → phát lại WAL từ checkpoint gần nhất → trạng thái nhất quán
  · WAL cũng chính là thứ gửi cho replica
  · giữ lại WAL = khôi phục về BẤT KỲ thời điểm nào
```

## Mental Model

### Quy tắc write-ahead

```text
"Bản ghi WAL mô tả một thay đổi phải nằm trên đĩa TRƯỚC KHI thay đổi đó
 được ghi vào file dữ liệu."
```

Từ đó ra chuỗi của một `COMMIT`:

```text
1. UPDATE       → sửa page trong shared_buffers (RAM), page thành "dirty"
                → ghi bản ghi WAL vào WAL buffer (RAM)
2. COMMIT       → ghi bản ghi commit vào WAL buffer
3.              → fsync WAL ra đĩa            ◀── ĐIỂM BỀN VỮNG. Sau đây mới trả về client.
4. (sau đó)     → checkpoint ghi dirty page ra file dữ liệu
5. (sau đó)     → WAL cũ được tái sử dụng hoặc archive
```

Điểm quan trọng: **bước 3 là điểm duy nhất quyết định dữ liệu có mất hay không.** Bước 4 chậm hay nhanh không ảnh hưởng tới durability.

### Crash recovery

```text
Crash lúc t. Khi khởi động lại:
  1. Tìm checkpoint gần nhất trong pg_control
  2. Phát lại WAL từ đó tới bản ghi cuối cùng đọc được
  3. Transaction có bản ghi COMMIT  → giữ
     Transaction không có           → bỏ (như chưa từng xảy ra)
  4. Sẵn sàng nhận kết nối
```

Thời gian phục hồi ≈ lượng WAL kể từ checkpoint cuối. Đây là đánh đổi trực tiếp:

```text
checkpoint thường xuyên  →  phục hồi nhanh, nhưng I/O nền cao
checkpoint thưa          →  I/O thấp, nhưng phục hồi lâu (có thể nhiều phút)
```

### `synchronous_commit`: nút xoay durability

```text
on         (mặc định)  fsync WAL trước khi trả về  → KHÔNG mất commit đã xác nhận
off                    trả về NGAY, fsync sau      → mất tối đa ~3× wal_writer_delay
                                                     (mặc định ~600ms) khi crash
local                  chỉ chờ đĩa local, không chờ replica
remote_apply           chờ replica ÁP DỤNG xong    → chậm nhất, nhất quán nhất
```

Điều quan trọng về `synchronous_commit = off`: nó **không** làm hỏng dữ liệu. Database vẫn nhất quán sau crash — bạn chỉ mất vài trăm mili giây transaction cuối cùng. Đó là đánh đổi hợp lý cho log, analytics, session; không hợp lý cho thanh toán.

Và nó đặt được **theo transaction**:

```sql
SET LOCAL synchronous_commit = off;    -- chỉ transaction này
INSERT INTO page_views (...) VALUES (...);
```

Đây là cách có cả hai: đơn hàng thì bền vững tuyệt đối, page view thì nhanh.

### `fsync = off`: đừng

```text
fsync = off  → PostgreSQL không bắt OS ghi thật ra đĩa
             → nhanh hơn nhiều
             → crash = HỎNG DỮ LIỆU, không phải mất dữ liệu
             → không phục hồi được, phải restore từ backup
```

Khác biệt giữa `synchronous_commit = off` (mất vài trăm ms) và `fsync = off` (hỏng database) là khác biệt cơ bản. Chỉ dùng `fsync = off` trên môi trường test có thể xoá đi làm lại.

### Ba loại backup, ba khả năng khác nhau

```text
pg_dump              dump logic (SQL / định dạng riêng)
                     + nhỏ, portable, restore một bảng được, đổi version được
                     - CHẬM với DB lớn, restore chậm hơn nữa
                     - chỉ khôi phục về thời điểm dump

pg_basebackup        copy vật lý toàn bộ data directory
                     + nhanh, restore nhanh
                     - cùng version, cùng kiến trúc; không chọn bảng được

Base backup + WAL    pg_basebackup + archive WAL liên tục
archiving            = POINT-IN-TIME RECOVERY (PITR)
                     + khôi phục về BẤT KỲ giây nào
                     - phức tạp nhất, tốn dung lượng lưu WAL
```

Chọn theo câu hỏi: *"nếu ai đó chạy `DELETE FROM users` không có `WHERE` lúc 14:37, tôi khôi phục được về 14:36 không?"*

Chỉ PITR trả lời được "có". `pg_dump` hàng đêm nghĩa là mất tới 24 giờ dữ liệu.

### RPO và RTO: hai con số phải quyết định trước

```text
RPO (Recovery Point Objective)  chấp nhận mất bao nhiêu dữ liệu?
RTO (Recovery Time Objective)   chấp nhận downtime bao lâu?

pg_dump hàng đêm        RPO = tối đa 24 giờ   RTO = giờ (restore chậm)
pg_dump 6 giờ/lần       RPO = tối đa 6 giờ    RTO = giờ
PITR (WAL archive)      RPO = giây            RTO = phút–giờ (restore + replay)
Streaming replica       RPO ≈ 0               RTO = giây (promote)
Sync replica            RPO = 0               RTO = giây, nhưng ghi chậm hơn
```

Đây là quyết định **kinh doanh**, không phải kỹ thuật. Nhưng nó phải được quyết định — mặc định "chúng ta có backup hàng đêm" là một câu trả lời ngầm cho RPO = 24 giờ, và thường không ai đồng ý với nó khi được hỏi thẳng.

Lưu ý về replica: **replica không phải backup.** `DELETE` nhầm được replicate sang replica trong mili giây. Replica bảo vệ khỏi hỏng phần cứng, không bảo vệ khỏi lỗi con người. Xem [Replication & scaling](02-replication-scaling.md).

### PITR trong thực tế

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'   # dùng công cụ thật ở production
```

```bash
# backup nền, định kỳ
pg_basebackup -D /backup/base -Fp -Xs -P

# khôi phục về đúng thời điểm trước sự cố
# postgresql.conf trong thư mục restore:
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-01-15 14:36:00+07'
recovery_target_action = 'promote'
# tạo file recovery.signal rồi khởi động
```

Ở production thực tế, dùng **pgBackRest** hoặc **WAL-G** thay vì `cp` — chúng lo nén, mã hoã, song song, xác minh checksum, và lưu lên object storage. `archive_command = 'cp ...'` không xử lý được lỗi một cách đáng tin.

### WAL tích lại: nguồn của "đĩa đầy"

Ba thứ giữ WAL không cho xoá:

```text
1. Replication slot không active  — slot giữ WAL cho một replica không còn tồn tại
2. archive_command thất bại       — PostgreSQL KHÔNG xoá WAL chưa archive được
3. wal_keep_size lớn              — cấu hình giữ lại
```

Nguyên nhân 1 và 2 đều dẫn tới **đĩa đầy**, và đĩa đầy làm PostgreSQL dừng ghi. Đây là một trong những sự cố PostgreSQL phổ biến nhất.

```sql
-- theo dõi
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots ORDER BY 3 DESC;

SELECT last_archived_wal, last_failed_wal, failed_count FROM pg_stat_archiver;
```

`max_slot_wal_keep_size` (PostgreSQL 13+) đặt trần cho lượng WAL một slot được giữ — vượt trần thì slot bị vô hiệu hoá thay vì làm đầy đĩa. Đây là đánh đổi đúng: mất một replica còn hơn mất cả primary.

## Example

Kịch bản khôi phục sau khi xoá nhầm, và cái giá của từng chiến lược:

```text
14:37  Ai đó chạy:  DELETE FROM users WHERE tenant_id = 42;   -- nhầm tenant
14:39  Phát hiện

CHIẾN LƯỢC A — chỉ có pg_dump lúc 02:00
  → restore về 02:00
  → MẤT 12,5 giờ dữ liệu của MỌI tenant
  → thực tế: thường không dám restore, phải sửa tay từng phần

CHIẾN LƯỢC B — PITR
  → restore base backup vào một instance MỚI
  → replay WAL tới 14:36:59
  → export riêng dữ liệu tenant 42 từ instance đó
  → import ngược vào production
  → mất 0 dữ liệu, downtime 0 cho tenant khác

CHIẾN LƯỢC C — có replica, không có PITR
  → replica đã replicate DELETE trong 50ms
  → replica KHÔNG giúp gì
```

Chiến lược B là lý do PITR tồn tại, và điểm mấu chốt là nó khôi phục vào **instance mới**, không ghi đè production — nên bạn lấy được đúng phần dữ liệu cần mà không ảnh hưởng ai.

## Prediction

1. `synchronous_commit = on`, mất điện ngay sau khi client nhận "thành công" — transaction đó còn không?
2. `synchronous_commit = off`, cùng tình huống — còn không? Database có hỏng không?
3. `fsync = off`, mất điện — kết quả?
4. Checkpoint 30 phút một lần, crash ngay trước checkpoint — phục hồi mất bao lâu (tương đối)?
5. Chỉ có `pg_dump` hàng đêm 02:00, xoá nhầm lúc 14:37 — mất bao nhiêu dữ liệu?
6. Có streaming replica, xoá nhầm lúc 14:37 — replica giúp được gì?
7. `archive_command` thất bại âm thầm 3 ngày, WAL sinh 20 GB/ngày — chuyện gì xảy ra?
8. Replication slot của một replica đã bị xoá, slot còn lại — hai hậu quả?
9. Đĩa `pg_wal` đầy — PostgreSQL làm gì?
10. Backup chưa bao giờ được restore thử — xác suất nó dùng được khi cần?
11. `SET LOCAL synchronous_commit = off` cho bảng `page_views`, `on` cho `orders` — mất gì khi crash?
12. `pg_dump` một database 500 GB — thời gian dump và thời gian restore, cái nào lâu hơn?

<details>
<summary>Đáp án</summary>

1. **Còn.** Đó là định nghĩa của `synchronous_commit = on`: WAL đã fsync trước khi trả về.
2. **Có thể mất** (tối đa vài trăm ms transaction cuối). Database **không hỏng** — vẫn nhất quán.
3. Có thể **hỏng dữ liệu** — không phục hồi được, phải restore từ backup.
4. Lâu — phải replay gần 30 phút WAL. Với hệ thống ghi nhiều, đó có thể là nhiều phút downtime.
5. Tới **12,5 giờ** dữ liệu của toàn bộ database.
6. **Không gì cả** — `DELETE` đã được replicate. Replica không bảo vệ khỏi lỗi logic.
7. WAL không được xoá → `pg_wal` tăng ~60 GB → đĩa đầy.
8. (a) WAL tích lại vô hạn → đĩa đầy. (b) Slot giữ `xmin` → vacuum không dọn được → bloat và rủi ro wraparound.
9. PostgreSQL **dừng ghi** và có thể tắt để tránh hỏng dữ liệu (`PANIC: could not write to file`).
10. Thấp. Backup chưa test là giả định, không phải backup.
11. Mất vài trăm ms `page_views` cuối cùng; **không mất** `orders` nào.
12. **Restore lâu hơn nhiều** — nó phải chạy lại mọi `INSERT` và dựng lại mọi index. Đây là lý do RTO của `pg_dump` tệ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `pg_ctl stop -m immediate` (mô phỏng crash) rồi khởi động lại | Log recovery; kiểm tra transaction cuối còn không |
| Đặt `synchronous_commit = off`, chạy INSERT liên tục, kill -9 | Đếm số dòng mất |
| So throughput INSERT với `on` và `off` | Chênh lệch có thể vài lần |
| `fsync = off` trên DB test, kill -9 giữa lúc ghi | Có thể không khởi động lại được |
| Tạo replication slot không dùng, chờ, xem `pg_wal` | WAL tăng không giới hạn |
| Đặt `max_slot_wal_keep_size = '1GB'`, lặp lại | Slot bị vô hiệu, WAL được dọn |
| Đặt `archive_command = 'false'` | `pg_stat_archiver.failed_count` tăng, WAL tích lại |
| Điền đầy phân vùng `pg_wal` | PostgreSQL dừng ghi |
| `pg_dump` rồi `pg_restore` vào DB mới, so số dòng từng bảng | Xác minh backup dùng được |
| Đo thời gian restore full | RTO thật của bạn |
| PITR: base backup, tạo dữ liệu, ghi lại thời điểm, `DROP TABLE`, restore về trước đó | Diễn tập đầy đủ |
| Giảm `checkpoint_timeout` xuống `1min`, đo I/O | Đánh đổi checkpoint |

Dòng áp chót là bài tập quan trọng nhất trong danh sách. **Một chiến lược backup chưa từng được diễn tập không phải chiến lược.**

## What Usually Goes Wrong

- **Backup chưa bao giờ được restore thử** → phát hiện nó hỏng đúng lúc cần.
- **Chỉ có `pg_dump` hàng đêm** → RPO 24 giờ mà không ai từng đồng ý với con số đó.
- **Tưởng replica là backup** → lỗi logic được replicate ngay lập tức.
- **`archive_command` thất bại âm thầm** → WAL tích lại, đĩa đầy, và bạn cũng không còn PITR.
- **Replication slot bỏ quên** → đĩa đầy + vacuum bị chặn.
- **`fsync = off` ở production** → hỏng dữ liệu khi crash.
- **Không đo RTO thật** → "chúng ta có backup" nhưng restore mất 8 giờ.
- **Backup lưu cùng nơi với database** → mất cả hai cùng lúc.
- **Backup không mã hoá** → bản sao đầy đủ dữ liệu người dùng nằm ở nơi ít được bảo vệ hơn database.
- **Không theo dõi tuổi backup** → backup job chết 3 tuần trước mà không ai biết.
- **Checkpoint quá thưa** → thời gian phục hồi dài ngoài dự kiến.
- **`pg_wal` cùng phân vùng với dữ liệu** → WAL tăng đột biến làm đầy cả hai.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| WAL chỉ để phục hồi sau crash | Nó cũng là nền của replication và PITR |
| COMMIT ghi dữ liệu ra file dữ liệu | COMMIT chỉ fsync WAL; file dữ liệu cập nhật sau |
| `synchronous_commit = off` làm hỏng dữ liệu | Chỉ mất vài trăm ms cuối; DB vẫn nhất quán |
| `fsync = off` cũng chỉ mất vài giây | Nó làm **hỏng** database |
| Replica là backup | Nó replicate cả lỗi của bạn |
| `pg_dump` là đủ cho production | RPO = chu kỳ dump; RTO = rất chậm với DB lớn |
| Có backup nghĩa là khôi phục được | Chỉ khi đã diễn tập restore |
| Checkpoint càng thường xuyên càng tốt | Nó đánh đổi với I/O nền |
| WAL tự dọn | Chỉ khi đã archive xong và không slot nào giữ |
| PITR khôi phục vào chính production | Thường restore vào instance mới rồi lấy phần cần |

## Debugging

1. **Đĩa đầy vì `pg_wal`** → kiểm tra hai thứ: `pg_replication_slots` (slot không active) và `pg_stat_archiver` (`failed_count`).
2. **Kiểm tra sức khoẻ archive**:
   ```sql
   SELECT last_archived_wal, last_archived_time, last_failed_wal, failed_count
   FROM pg_stat_archiver;
   ```
3. **Tốc độ sinh WAL** — hữu ích để dự trù dung lượng:
   ```sql
   SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'));  -- tổng từ đầu
   ```
4. **Sau crash, đọc log khởi động**: `database system was not properly shut down; automatic recovery in progress` → `redo starts at` → `redo done at`. Khoảng giữa là thời gian phục hồi thật.
5. **Nghi mất dữ liệu** → kiểm tra `synchronous_commit` và `fsync` trước tiên.
6. **Backup có dùng được không** → chỉ có một cách biết: restore vào instance mới và so số dòng.
7. **Đo RTO** — bấm giờ một lần restore đầy đủ, mỗi quý.

## Production Considerations

- **PITR là mặc định đúng cho hệ thống có dữ liệu người dùng.** `pg_dump` hàng đêm là mức tối thiểu cho hệ thống nội bộ.
- **Dùng pgBackRest hoặc WAL-G**, không tự viết `archive_command`. Chúng lo retry, nén, mã hoá, xác minh, song song.
- **Backup lưu ở nơi khác** — khác máy, khác vùng, và lý tưởng là khác tài khoản cloud (chống cả ransomware lẫn xoá nhầm).
- **Mã hoá backup.** Nó là bản sao đầy đủ của database.
- **Diễn tập restore theo lịch** — mỗi quý, có bấm giờ, có ghi lại kết quả. Đây là hoạt động phân biệt "có backup" và "khôi phục được".
- **Alert trên**: tuổi backup gần nhất, `pg_stat_archiver.failed_count`, slot không active, dung lượng `pg_wal`, `%` đĩa.
- **`max_slot_wal_keep_size`** để một slot hỏng không làm đầy đĩa.
- **`pg_wal` trên phân vùng riêng** — WAL tăng đột biến không làm đầy phân vùng dữ liệu.
- **Ghi RPO/RTO thành văn bản** và cho người ra quyết định kinh doanh xác nhận. Nếu không hỏi, bạn đã ngầm chọn hộ họ.
- **`synchronous_commit` theo transaction** — bền vững tuyệt đối cho dữ liệu tiền bạc, nới lỏng cho log/analytics.
- **Checksum dữ liệu** (`initdb --data-checksums`, mặc định bật ở nhiều bản đóng gói) để phát hiện hỏng đĩa âm thầm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `synchronous_commit = on` | không mất commit đã xác nhận | ghi chậm hơn |
| `synchronous_commit = off` | throughput cao hơn nhiều | mất vài trăm ms cuối khi crash |
| `fsync = off` | nhanh nhất | hỏng dữ liệu khi crash |
| Checkpoint thường xuyên | phục hồi nhanh | I/O nền cao |
| Checkpoint thưa | I/O thấp | phục hồi lâu |
| `pg_dump` | portable, chọn bảng, đổi version | chậm, RPO kém |
| Base backup + WAL (PITR) | RPO tính bằng giây | phức tạp, tốn lưu trữ |
| Sync replication | RPO = 0 | ghi chậm; replica chết làm primary chậm/dừng |
| Async replication | ghi nhanh | mất dữ liệu khi failover |
| Backup cùng vùng | rẻ, restore nhanh | mất cả hai khi vùng sự cố |
| Backup khác vùng | chống thảm hoạ | tốn tiền, restore chậm hơn |

## Explain Without Notes

1. Vì sao ghi WAL tuần tự nhanh hơn ghi thẳng vào file dữ liệu?
2. Điểm chính xác nào trong chuỗi `COMMIT` quyết định dữ liệu bền vững?
3. `synchronous_commit = off` khác `fsync = off` thế nào? Cái nào chấp nhận được ở production?
4. Vì sao replica không phải backup? Cho một kịch bản cụ thể.
5. RPO và RTO của "pg_dump hàng đêm" là bao nhiêu? Của PITR?
6. Ba thứ giữ WAL không cho xoá, và hậu quả chung?
7. Vì sao PITR thường restore vào instance mới thay vì ghi đè production?

## Related

- [Replication & scaling](02-replication-scaling.md) — WAL là thứ được gửi đi
- [MVCC & vacuum](../transactions-concurrency/02-mvcc-vacuum.md) — replication slot chặn vacuum
- [Transaction isolation](../transactions-concurrency/01-transaction-isolation.md) — COMMIT nghĩa là gì
- [Failure modes](../../../05-cross-cutting/reliability/01-failure-modes.md) — phân loại hỏng hóc
- [Storage & StatefulSet](../../../04-infrastructure/04-kubernetes/workloads-networking/04-storage-statefulset.md) — chạy DB trên K8s
- [Consistency & availability](../../../06-system-design/04-consistency-availability.md) — sync vs async ở tầng hệ thống
- [Migrations](../../03-data-modeling/04-migrations.md) — backup trước migration lớn

## Version / Context

PostgreSQL 16. `max_slot_wal_keep_size` từ PostgreSQL 13. `recovery_target_*` chuyển từ `recovery.conf` vào `postgresql.conf` + `recovery.signal` từ PostgreSQL 12. Công cụ khuyến nghị: pgBackRest 2.x, WAL-G.
