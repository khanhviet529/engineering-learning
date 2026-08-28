---
level: intermediate
area: infra
prerequisites:
  - 01-process-files-env.md
  - 04-signals-lifecycle.md
related:
  - ../../05-cross-cutting/observability/02-structured-logging.md
  - ../02-docker/01-image-container.md
---

# Logs & services

> Ổ đĩa của server đầy 100%. Database từ chối ghi, ứng dụng crash, và bạn không SSH vào được vì shell không tạo nổi file tạm. Nguyên nhân: `/var/log/app/app.log` đã 340 GB. Ứng dụng ghi log vào file, không ai cấu hình xoay vòng, và nó đã chạy 14 tháng.

## Position

```text
Process ──▶ stdout/stderr (fd 1, 2)
                 │
                 ├─ terminal        → màn hình
                 ├─ systemd         → journald
                 ├─ Docker          → log driver (json-file, journald, fluentd...)
                 └─ Kubernetes      → file trên node → agent thu thập → hệ thống log tập trung
```

Câu hỏi trung tâm: **ai chịu trách nhiệm hứng và xoay vòng log của bạn?** Nếu câu trả lời là "ứng dụng", bạn đang làm sai ở môi trường container.

## Problem

Ba vấn đề riêng biệt, thường bị gộp làm một:

```text
① Log đi đâu?        stdout, file, syslog, hay trực tiếp lên dịch vụ log?
② Ai xoay vòng?      không ai → đĩa đầy
③ Ai giữ process sống?  systemd, Docker restart policy, hay Kubernetes?
```

Và một vấn đề thứ tư, xuất hiện muộn hơn: **log ghi đồng bộ có thể chặn ứng dụng.** Ghi vào stdout khi pipe đầy sẽ block, và với Node.js điều đó nghĩa là event loop dừng.

## Mental Model

### Quy tắc 12-factor: ứng dụng ghi ra stdout, hết

```text
✗ App tự mở file, tự xoay vòng, tự nén, tự xoá
✓ App ghi ra stdout/stderr; MÔI TRƯỜNG lo phần còn lại
```

Lý do không phải thẩm mỹ:

```text
· container có thể bị xoá bất cứ lúc nào → log trong file biến mất cùng nó
· nhiều replica → log ở nhiều nơi, không gộp được
· ứng dụng không nên biết log được lưu ở đâu — đó là quyết định vận hành
· xoay vòng do app tự làm dễ sai (nhiều process cùng ghi, mất dòng khi xoay)
```

Ngoại lệ hợp lý: audit log có yêu cầu pháp lý về lưu trữ — nó nên đi vào **database**, không phải file log.

### stdout vs stderr

```text
stdout (1)  đầu ra bình thường
stderr (2)  lỗi và chẩn đoán
```

Trong container, cả hai thường được gộp lại, nên khác biệt không quan trọng như trên terminal. Điều quan trọng hơn nhiều là **mức log trong bản ghi JSON**, không phải chọn fd nào.

### Log có cấu trúc, không phải chuỗi

```text
✗ console.log(`User ${id} failed login from ${ip}`)
✓ logger.warn({ event: 'login_failed', userId: id, ip, requestId })
```

Với log dạng chuỗi, tìm "mọi lần đăng nhập thất bại của user X trong 3 ngày" là một bài toán regex. Với JSON, nó là một câu truy vấn.

Chi tiết: [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md).

### Xoay vòng log

Nếu bạn **buộc** phải ghi file (VM truyền thống, không container):

```text
/etc/logrotate.d/app
────────────────────
/var/log/app/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  copytruncate       # hoặc: create + gửi SIGHUP để app mở lại file
}
```

Hai cách xoay vòng, và cả hai có nhược điểm:

```text
copytruncate   copy nội dung rồi cắt file gốc về 0
               + app không cần làm gì
               - MẤT dòng ghi giữa lúc copy và truncate

create + SIGHUP  đổi tên file, tạo file mới, báo app mở lại
               + không mất dòng
               - app phải xử lý SIGHUP
```

Với Docker:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

**Không đặt `max-size` là mặc định của Docker**, và đó chính là cách đĩa đầy: một container nói nhiều ghi vô hạn vào `/var/lib/docker/containers/*/`.

Với Kubernetes, kubelet xoay vòng log của container (mặc định 10 MB × 5 file), nhưng **chỉ cho log đi qua stdout/stderr**. App ghi vào file bên trong container thì không ai xoay vòng nó.

### systemd: giữ process sống trên VM

```ini
# /etc/systemd/system/app.service
[Unit]
Description=API service
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/app
EnvironmentFile=/etc/app/env          # KHÔNG để secret trong file .service (nó world-readable)
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=45                      # khớp với thời gian graceful shutdown
LimitNOFILE=65536                      # ulimit -n
MemoryMax=1G                           # cgroup memory limit
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Bốn dòng đáng chú ý:

```text
TimeoutStopSec   systemd chờ bao lâu sau SIGTERM rồi mới SIGKILL
                 → phải LỚN HƠN thời gian graceful shutdown của app
LimitNOFILE      giới hạn fd — mặc định thường quá thấp cho server
MemoryMax        cgroup limit; vượt là bị OOM kill, giống container
EnvironmentFile  secret ở đây với mode 600, không nhúng vào .service
```

```bash
systemctl daemon-reload && systemctl enable --now app
systemctl status app
journalctl -u app -f              # theo dõi
journalctl -u app --since '10 min ago' -p err
```

### `Restart=` và vòng lặp restart

```text
Restart=no            (mặc định)
Restart=on-failure    chỉ khi exit code ≠ 0 hoặc bị signal
Restart=always        kể cả khi exit 0
```

`Restart=always` kèm cấu hình sai làm process restart vô hạn. `StartLimitBurst`/`StartLimitIntervalSec` chặn điều đó:

```ini
StartLimitBurst=5
StartLimitIntervalSec=60      # 5 lần trong 60 giây → systemd bỏ cuộc
```

Đây là tương đương của `CrashLoopBackOff` trong Kubernetes: hệ thống ngừng thử để bạn có cơ hội nhìn thấy vấn đề.

### journald: log có cấu trúc sẵn

```bash
journalctl -u app -f                        # theo dõi
journalctl -u app -p warning                # từ mức warning trở lên
journalctl -u app --since today -o json     # dạng JSON
journalctl --disk-usage
journalctl --vacuum-time=7d                 # dọn
```

```ini
# /etc/systemd/journald.conf — journald không tự giới hạn hợp lý theo mặc định
SystemMaxUse=2G
MaxRetentionSec=14day
```

### Cron vs systemd timer

```text
CRON                                SYSTEMD TIMER
đơn giản, phổ biến                  cấu hình dài hơn
môi trường TỐI GIẢN (bẫy kinh điển)  kế thừa cấu hình của service
không có log tích hợp               log vào journald tự động
chạy chồng nếu lần trước chưa xong   có thể chặn chồng lấn
không "bù" khi máy tắt               Persistent=true chạy bù
```

Bẫy kinh điển của cron:

```bash
# ❌ chạy tay thì được, chạy cron thì "command not found"
0 2 * * * backup.sh

# ✅ đường dẫn tuyệt đối, PATH tường minh, chuyển hướng log
PATH=/usr/local/bin:/usr/bin:/bin
0 2 * * * /opt/app/backup.sh >> /var/log/backup.log 2>&1
```

Cron chạy với môi trường tối giản: không nạp `.bashrc`, `PATH` khác, `HOME` có thể khác. Đây là nguyên nhân số một của "script chạy tay thì được".

Systemd timer:

```ini
# backup.timer
[Timer]
OnCalendar=daily
Persistent=true              # chạy bù nếu máy tắt lúc đến hạn
RandomizedDelaySec=300       # jitter — tránh mọi máy chạy cùng lúc
[Install]
WantedBy=timers.target
```

`RandomizedDelaySec` đáng chú ý: nếu 50 máy cùng chạy backup lúc 2:00:00, chúng tạo một đỉnh tải đồng bộ lên hệ thống lưu trữ.

Và trong Kubernetes, `CronJob` thay thế cả hai — với ưu điểm là mỗi lần chạy là một pod riêng, có log riêng và giới hạn tài nguyên riêng.

### Log có thể chặn ứng dụng

```text
stdout của process là một PIPE.
Pipe có buffer giới hạn (~64 KB trên Linux).
Nếu bên đọc chậm hơn bên ghi → pipe đầy → write() BLOCK.

Với Node.js: stdout tới pipe/file là ĐỒNG BỘ trên Linux
   → log nhiều + bên đọc chậm = EVENT LOOP BỊ CHẶN
```

Đây là một nguyên nhân thật của "app chậm bất thường" mà rất khó nghĩ tới. Hai biện pháp:

```text
① Ghi log ở mức phù hợp — không log mỗi request ở mức debug trong production
② Dùng logger có transport bất đồng bộ (pino với worker thread)
```

### Không log cái gì

```text
✗ mật khẩu, token, API key, cookie phiên
✗ số thẻ, CCCD, dữ liệu sức khoẻ
✗ toàn bộ request body (nó chứa những thứ trên)
✗ chuỗi kết nối có mật khẩu
```

Log thường có phạm vi truy cập **rộng hơn** database — nhiều người xem được log hơn số người có quyền vào DB. Một secret lọt vào log là một secret bị lộ, và nó nằm trong backup của hệ thống log.

Cách chắc chắn: **allowlist** thay vì denylist — chỉ log những trường bạn liệt kê.

## Example

Chẩn đoán đĩa đầy vì log:

```bash
# 1. Đĩa nào đầy
df -h
# /dev/sda1  100G  100G  0  100%  /

# 2. Thư mục nào chiếm chỗ
du -xh / 2>/dev/null | sort -rh | head -20
# 340G  /var/log/app          ← đây
#  12G  /var/lib/docker/containers

# 3. File cụ thể
ls -lhS /var/log/app | head
# -rw-r--r-- 1 app app 340G app.log

# 4. Xử lý NGAY — KHÔNG dùng rm (process vẫn giữ fd, dung lượng không được giải phóng)
truncate -s 0 /var/log/app/app.log
#    hoặc: : > /var/log/app/app.log

# 5. Xác nhận
df -h

# 6. Phòng ngừa: logrotate hoặc chuyển sang stdout + log driver
```

Bước 4 là chi tiết quan trọng: **`rm` một file đang được process mở không giải phóng dung lượng.** File biến mất khỏi thư mục nhưng inode vẫn sống cho tới khi mọi fd đóng — nghĩa là cho tới khi restart process. `truncate` cắt nội dung mà giữ inode, nên dung lượng được giải phóng ngay.

Kiểm tra file đã xoá nhưng còn giữ fd:

```bash
lsof +L1                          # link count = 0 → đã xoá nhưng còn mở
```

## Prediction

1. App ghi log vào file trong container, container bị xoá — log ở đâu?
2. Docker không đặt `max-size`, container ghi 1 GB log/ngày, chạy 1 năm — đĩa thế nào?
3. `rm app.log` khi process đang giữ file — `df` có giảm không? Vì sao?
4. `truncate -s 0 app.log` — có giảm không?
5. Script chạy tay thì được, chạy cron thì `command not found` — nguyên nhân?
6. `TimeoutStopSec=10` nhưng graceful shutdown mất 20 giây — kết quả?
7. `Restart=always` với app crash ngay khi khởi động do config sai — chuyện gì xảy ra?
8. Thêm `StartLimitBurst=5` — khác gì?
9. `LimitNOFILE` không đặt trong systemd unit, server nhận 5.000 kết nối — kết quả?
10. Node.js log 10.000 dòng/giây ra stdout, bên đọc chậm — ảnh hưởng gì tới app?
11. Log toàn bộ request body, có một endpoint nhận mật khẩu — hậu quả?
12. 50 máy cùng chạy cron backup lúc 2:00:00 — vấn đề gì?
13. `journalctl` không giới hạn dung lượng, server chạy 2 năm — `/var/log/journal` thế nào?

<details>
<summary>Đáp án</summary>

1. **Mất cùng container** — filesystem của container không tồn tại sau khi xoá.
2. Khoảng **365 GB** trong `/var/lib/docker/containers/` → đĩa đầy.
3. **Không giảm** — process vẫn giữ fd, inode chưa được giải phóng. Chỉ giảm khi process restart.
4. **Có** — inode giữ nguyên, nội dung bị cắt về 0.
5. Cron có môi trường tối giản: `PATH` khác, không nạp `.bashrc`. Dùng đường dẫn tuyệt đối.
6. systemd gửi SIGKILL ở giây thứ 10 → shutdown bị cắt giữa chừng.
7. Restart vô hạn: crash → restart → crash. Log đầy thông báo giống nhau.
8. Sau 5 lần trong khoảng thời gian cấu hình, systemd **bỏ cuộc** và để service ở trạng thái failed — bạn nhìn thấy vấn đề thay vì một vòng lặp.
9. Dùng mặc định của systemd (thường 1024 hoặc 524288 tuỳ bản) — nếu thấp thì `EMFILE`.
10. Pipe đầy → `write()` chặn → **event loop bị chặn** → mọi request chậm.
11. Mật khẩu nằm trong log, và log thường có phạm vi truy cập rộng hơn database. Nó cũng nằm trong backup của hệ thống log.
12. Đỉnh tải đồng bộ lên hệ thống lưu trữ/mạng. Cần jitter.
13. Có thể chiếm hàng chục GB — journald không tự giới hạn hợp lý theo mặc định.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Container ghi log liên tục không `max-size`, để một ngày | Đo `/var/lib/docker` |
| Thêm `max-size: 10m, max-file: 3`, lặp lại | Giới hạn ~30 MB |
| `rm` file log đang mở rồi `df -h` | Không giảm |
| `lsof +L1` | Thấy file đã xoá còn mở |
| `truncate -s 0`, `df -h` | Giảm ngay |
| Chạy script từ cron với `PATH` mặc định | `command not found` |
| Thêm `PATH=` vào crontab | Chạy được |
| `TimeoutStopSec=5` với shutdown 15 giây | Bị SIGKILL |
| `Restart=always` + config sai | Vòng lặp restart |
| Thêm `StartLimitBurst`, lặp lại | systemd bỏ cuộc, trạng thái failed |
| Log 50.000 dòng/giây ra stdout với `\| slow-reader`, đo event loop lag | Bị chặn |
| Giảm mức log, lặp lại | Bình thường |
| Log request body có mật khẩu, grep trong log | Mật khẩu hiện ra |
| `journalctl --disk-usage` trên server chạy lâu | Có thể rất lớn |

## What Usually Goes Wrong

- **App tự ghi file log trong container** → mất log khi container bị xoá; không ai xoay vòng.
- **Không đặt `max-size` cho Docker log driver** → đĩa đầy.
- **Không cấu hình logrotate trên VM** → đĩa đầy.
- **`rm` file log đang mở** → dung lượng không được giải phóng, và bạn tưởng đã xử lý.
- **`TimeoutStopSec` ngắn hơn thời gian shutdown** → SIGKILL, mất việc đang làm.
- **`Restart=always` không có start limit** → vòng lặp restart che giấu lỗi thật.
- **`LimitNOFILE` không đặt** → `EMFILE` dưới tải.
- **Secret trong file `.service`** → file đó thường world-readable.
- **Cron với môi trường mặc định** → "chạy tay thì được".
- **Cron không có jitter trên nhiều máy** → đỉnh tải đồng bộ.
- **Log đồng bộ khối lượng lớn** → chặn event loop.
- **Log toàn bộ body/header** → secret và PII trong log.
- **Log không có cấu trúc** → không truy vấn được khi cần nhất.
- **journald không giới hạn** → chiếm đĩa âm thầm.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| App nên tự quản lý file log | Trong container, app chỉ ghi stdout |
| `rm` file log giải phóng đĩa ngay | Chỉ khi mọi fd đã đóng |
| Docker tự giới hạn log | Không, trừ khi cấu hình `max-size` |
| Kubernetes xoay vòng mọi log | Chỉ log qua stdout/stderr |
| Ghi log không tốn gì | stdout tới pipe/file là đồng bộ trên Linux |
| stderr quan trọng hơn stdout trong container | Chúng thường được gộp; mức log mới quan trọng |
| Cron kế thừa môi trường của bạn | Nó có môi trường tối giản |
| `Restart=always` luôn tốt | Không có start limit thì nó che lỗi |
| Log là nơi an toàn để debug | Nó thường có phạm vi truy cập rộng hơn DB |
| journald tự dọn hợp lý | Cần đặt `SystemMaxUse` |

## Debugging

1. **Đĩa đầy** → `df -h` → `du -xh / | sort -rh | head -20` → `ls -lhS <dir>`.
2. **Xoá rồi mà không giảm** → `lsof +L1` tìm file đã xoá còn mở; `truncate` hoặc restart process.
3. **Service không chạy** → `systemctl status app` rồi `journalctl -u app -n 100 --no-pager`.
4. **Service restart liên tục** → `systemctl show app -p NRestarts`; đọc log của lần chạy trước.
5. **Cron không chạy** → `journalctl -u cron` (hoặc `-u crond`), kiểm tra `PATH` và đường dẫn tuyệt đối, và kiểm tra script có quyền `x`.
6. **App chậm bất thường** → nghi log: giảm mức log tạm thời và đo lại.
7. **Không tìm được log của một request** → thiếu `requestId`. Xem [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
8. **Log của container**: `docker logs --since 10m -f <c>`, `kubectl logs -f <pod>`, `kubectl logs --previous <pod>` (cho container đã crash — đây là lệnh quan trọng nhất khi debug CrashLoopBackOff).

## Production Considerations

- **App chỉ ghi stdout/stderr.** Mọi thứ khác là việc của môi trường.
- **Log JSON có cấu trúc**, với `requestId`, `userId`, `event`, `level`.
- **Giới hạn log driver của Docker** (`max-size`, `max-file`) — mặc định không giới hạn.
- **Alert trên dung lượng đĩa** ở ngưỡng 80%, không phải 95%.
- **Redact bằng allowlist**, không phải denylist.
- **`TimeoutStopSec` > thời gian graceful shutdown**, và khớp với `terminationGracePeriodSeconds` nếu chạy cả hai môi trường.
- **`LimitNOFILE=65536`** cho service nhiều kết nối.
- **`StartLimitBurst`** để vòng lặp restart không che lỗi.
- **Secret qua `EnvironmentFile` mode 600**, không nhúng vào `.service`.
- **Systemd timer thay cron** khi đã dùng systemd — log tích hợp, chặn chồng lấn, `Persistent`, jitter.
- **Jitter cho job định kỳ chạy trên nhiều máy.**
- **Sampling cho log tần suất cao** — log 1% của một sự kiện xuất hiện 10.000 lần/phút, cộng một counter đầy đủ.
- **Giữ log bao lâu là quyết định có chi phí** — ghi ra và cho người quyết định biết con số.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Log ra stdout | đơn giản, hợp container, môi trường lo xoay vòng | phụ thuộc hạ tầng thu thập |
| Log ra file | kiểm soát, hoạt động khi không có agent | phải tự xoay vòng, mất khi container xoá |
| Log JSON | truy vấn được | khó đọc bằng mắt khi dev |
| Log text | dễ đọc | không truy vấn được |
| Log nhiều | debug dễ | chi phí lưu trữ, rủi ro chặn app, rủi ro PII |
| Log ít | rẻ, nhanh | thiếu dữ liệu khi cần |
| Sampling | rẻ | có thể bỏ lỡ trường hợp hiếm |
| systemd | quản lý tốt, log tích hợp, cgroup | chỉ trên VM/bare metal |
| Docker restart policy | đơn giản | ít tính năng hơn systemd |
| Cron | quen thuộc, có ở mọi nơi | môi trường tối giản, không log, chạy chồng |
| Systemd timer | log, chặn chồng, jitter, bù | cấu hình dài hơn |

## Explain Without Notes

1. Vì sao ứng dụng trong container chỉ nên ghi stdout?
2. Vì sao `rm` file log không giải phóng đĩa, và làm gì thay thế?
3. Hai cách logrotate xoay vòng, và nhược điểm của mỗi cách?
4. Vì sao script chạy tay thì được mà cron thì không?
5. `TimeoutStopSec` liên quan gì tới graceful shutdown?
6. Vì sao ghi log có thể chặn event loop của Node.js?
7. Vì sao log nguy hiểm hơn database về mặt rò rỉ secret?
8. Systemd timer hơn cron ở bốn điểm nào?

## Related

- [Process, file & env](01-process-files-env.md) — fd, stdout, môi trường
- [Signals & lifecycle](04-signals-lifecycle.md) — `TimeoutStopSec`, SIGTERM
- [Memory, CPU & limits](02-memory-cpu-limits.md) — `MemoryMax` của systemd cũng là cgroup
- [Debugging toolbox](07-debugging-toolbox.md) — `df`, `du`, `lsof`, `journalctl`
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md) — hình dạng dòng log
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — `requestId`
- [Image & container](../02-docker/01-image-container.md) — log driver
- [Caching, queues & jobs](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — job định kỳ trên nhiều replica
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — secret trong log

## Version / Context

Linux với systemd (Ubuntu, Debian, RHEL hiện đại). Docker log driver mặc định là `json-file` **không giới hạn dung lượng**. Kubernetes: kubelet xoay vòng log container (mặc định 10Mi × 5), chỉ cho stdout/stderr.
