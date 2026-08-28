---
level: intermediate
area: infra
prerequisites:
  - 01-process-files-env.md
  - 05-ports-sockets.md
related:
  - ../01-networking/06-network-debugging.md
  - 02-memory-cpu-limits.md
---

# Linux debugging toolbox

> "Server chậm." Đó là toàn bộ thông tin bạn có. Không có APM, không có dashboard, chỉ có một phiên SSH. Note này là danh sách lệnh và **thứ tự** chạy chúng — vì thứ tự quan trọng hơn danh sách: nó biến một cuộc dò dẫm thành một quy trình loại trừ.

## Position

```text
Triệu chứng ("chậm", "lỗi", "không kết nối được")
   ↓  quan sát bằng công cụ, không đoán
Dữ liệu (số liệu, trạng thái, log)
   ↓
Giả thuyết → kiểm chứng → sửa
```

## Problem

Không có quy trình, debug trở thành thử ngẫu nhiên:

```text
"chắc tại DB"     → restart DB      → vẫn chậm
"chắc tại memory" → tăng RAM        → vẫn chậm
"chắc tại code"   → rollback        → hết chậm
   ⇒ nhưng bạn không biết VÌ SAO, nên nó sẽ quay lại
```

Điều làm quy trình khả thi: **mọi tài nguyên chỉ có bốn loại**, và mỗi loại có một cách đo.

## Mental Model

### Bốn tài nguyên, bốn câu hỏi

```text
CPU     có đủ chu kỳ tính toán không?      → có ai đang chờ CPU?
MEMORY  có đủ RAM không?                    → có swap? có OOM?
DISK    I/O có phải nút thắt không?         → có process nào chờ đĩa?
NETWORK gói tin có đi tới nơi không?        → connect được? nhanh không?
```

Cộng thêm hai thứ không phải "tài nguyên" nhưng gây triệu chứng giống hệt:

```text
LOCK/CHỜ  process đang chờ một process khác (khoá DB, mutex, pool)
GIỚI HẠN  chạm trần cấu hình (fd, connection pool, cgroup) trong khi tài nguyên còn dư
```

Hai cái cuối là nguyên nhân của trường hợp khó nhất: **hệ thống chậm trong khi mọi chỉ số tài nguyên đều bình thường.**

### USE: khung ba câu hỏi cho mỗi tài nguyên

```text
UTILIZATION  bận bao nhiêu phần trăm thời gian?
SATURATION   có hàng đợi không? ai đang chờ?
ERRORS       có lỗi không?
```

`SATURATION` là câu hỏi hữu ích nhất và ít được hỏi nhất. CPU 60% nghe ổn — nhưng nếu load average là 40 trên máy 4 core, có 36 tiến trình đang xếp hàng chờ.

## How It Works

### 60 giây đầu tiên

Một chuỗi cố định cho biết vấn đề nằm ở đâu, trước khi đi sâu:

```bash
uptime                    # ① load average — có hàng đợi không?
dmesg | tail -20          # ② kernel có kêu không? (OOM, lỗi đĩa, network)
vmstat 1 5                # ③ CPU / memory / swap / IO tổng quan
free -h                   # ④ memory và swap
df -h                     # ⑤ đĩa đầy chưa
top -b -n1 | head -20     # ⑥ ai đang ăn tài nguyên
ss -s                     # ⑦ tổng quan socket
journalctl -p err --since '30 min ago' --no-pager | tail -30   # ⑧ lỗi hệ thống
```

Tám lệnh, khoảng một phút, và chúng loại trừ được phần lớn khả năng.

### Đọc load average đúng cách

```bash
uptime
# load average: 8.42, 6.11, 3.05     ← 1 phút, 5 phút, 15 phút
nproc                                 # số core
```

```text
load < số core        ổn
load ≈ số core        bận, chưa xếp hàng
load > số core        CÓ HÀNG ĐỢI

Quan trọng: trên Linux, load average tính cả tiến trình ở trạng thái
UNINTERRUPTIBLE SLEEP (D) — tức là đang CHỜ ĐĨA.
⇒ load cao + CPU thấp = vấn đề I/O, không phải CPU
```

Điểm cuối là chi tiết đặc thù Linux mà nhiều người không biết, và nó giải thích "load 30 nhưng CPU 10%".

Xu hướng cũng là thông tin: `8.42, 6.11, 3.05` nghĩa là **đang tăng** (mới xảy ra); `3.05, 6.11, 8.42` nghĩa là đang giảm (đã qua đỉnh).

### CPU

```bash
top -o %CPU                   # sắp theo CPU; nhấn '1' để xem từng core
pidstat 1 5                   # theo process, theo thời gian
mpstat -P ALL 1 3             # từng core — phát hiện lệch tải
```

Đọc các cột của `top`/`vmstat`:

```text
us  user      code ứng dụng
sy  system    syscall, kernel  → cao bất thường = nhiều syscall (I/O, context switch)
wa  iowait    ĐANG CHỜ ĐĨA     → cao = nút thắt I/O, không phải CPU
st  steal     hypervisor lấy mất → máy ảo bị hàng xóm chiếm CPU
id  idle
```

`st` (steal) đáng chú ý trên cloud: nếu nó cao, vấn đề nằm ở nhà cung cấp hoặc ở việc chọn instance type, không nằm trong ứng dụng của bạn.

Một process cụ thể đang làm gì:

```bash
cat /proc/<pid>/status | grep -E 'State|Threads|VmRSS'
top -H -p <pid>               # theo THREAD — thread nào ăn CPU
```

### Memory

```bash
free -h
#               total  used  free  shared  buff/cache  available
# Mem:           16Gi  9Gi   1Gi   0.5Gi   6Gi         6Gi
```

**Chỉ nhìn cột `available`.** `free` thấp là bình thường: Linux dùng RAM rảnh làm page cache, và nó sẽ nhường ngay khi ứng dụng cần. `available` là con số ước lượng thực tế có thể cấp phát.

```bash
ps aux --sort=-%mem | head -10          # top theo RSS
cat /proc/<pid>/status | grep Vm        # chi tiết một process
vmstat 1 | awk '{print $7, $8}'         # si/so — swap in/out
```

Swap đang hoạt động (`si`/`so` > 0 liên tục) là dấu hiệu nghiêm trọng: đĩa chậm hơn RAM hàng nghìn lần, nên hệ thống sẽ chậm một cách thảm hoạ.

Tìm bằng chứng OOM:

```bash
dmesg -T | grep -i -E 'killed process|oom'
journalctl -k --since '1 hour ago' | grep -i oom
```

Trong container, giới hạn thật nằm ở cgroup, không phải `free`:

```bash
cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.current
```

Xem [Memory, CPU & limits](02-memory-cpu-limits.md).

### Disk

```bash
df -h                         # dung lượng
df -i                         # INODE — có thể hết inode dù còn dung lượng
du -xh /var | sort -rh | head -20
iostat -xz 1 3                # %util, await
iotop -o                      # process nào đang I/O
```

```text
%util gần 100%   đĩa bão hoà
await cao        latency mỗi thao tác cao (chờ hàng đợi)
```

`df -i` đáng nhớ: một thư mục với hàng triệu file nhỏ có thể hết **inode** trong khi `df -h` vẫn báo còn 50% dung lượng. Triệu chứng là `No space left on device` — một thông báo gây hiểu nhầm.

Và file đã xoá nhưng còn giữ fd:

```bash
lsof +L1                      # link count = 0 → xoá rồi mà chưa giải phóng
```

### Network

```bash
ss -tlnp                      # ai đang listen
ss -tanp state established | wc -l
ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn   # đếm theo trạng thái
ss -s                         # tổng quan
```

Chi tiết: [Ports & sockets](05-ports-sockets.md) và [Network debugging](../01-networking/06-network-debugging.md).

### Đi sâu vào một process

```bash
lsof -p <pid>                 # mọi fd: file, socket, thư viện
ls -l /proc/<pid>/fd | wc -l  # đếm nhanh
cat /proc/<pid>/limits        # giới hạn thật
cat /proc/<pid>/environ | tr '\0' '\n'
cat /proc/<pid>/cgroup        # thuộc cgroup nào

strace -p <pid> -f -e trace=network,file -T   # syscall (CHẬM — cẩn thận ở production)
strace -c -p <pid>            # thống kê syscall, ít xâm lấn hơn
```

`strace` là công cụ mạnh nhất và nguy hiểm nhất: nó có thể làm process chậm hàng chục lần. Ở production, dùng `-c` (chỉ thống kê) và giới hạn thời gian, hoặc dùng `perf`/eBPF nếu có.

Câu hỏi mà `strace` trả lời và không công cụ nào khác trả lời được: **"process này đang chờ cái gì?"** Nếu nó treo ở một `read()` trên fd 12, `lsof -p <pid>` cho bạn biết fd 12 là gì.

### Trạng thái process trong `ps`

```text
R  running / runnable
S  interruptible sleep    (chờ I/O mạng, timer, event) — bình thường
D  UNINTERRUPTIBLE sleep  (chờ ĐĨA) — nhiều process ở D = nút thắt I/O
Z  zombie                 (chưa được cha reap)
T  stopped
```

```bash
ps -eo pid,stat,wchan:20,comm | awk '$2 ~ /^D/'    # process đang chờ đĩa, và chờ ở đâu
```

Cột `wchan` cho biết **hàm kernel** mà process đang chờ — thông tin rất cụ thể khi bạn cần nó.

### Trong container: công cụ thường không có

```bash
# image production tối giản thường không có ss, curl, ps
kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>
docker run --rm -it --net=container:<id> --pid=container:<id> nicolaka/netshoot
```

Hoặc đọc thẳng từ `/proc` — nó luôn có:

```bash
cat /proc/net/tcp             # socket, dạng hex
cat /proc/1/cmdline | tr '\0' ' '
```

## Example

"Server chậm", không có thông tin gì thêm:

```bash
$ uptime
load average: 42.10, 38.55, 20.11        # 4 core → hàng đợi RẤT dài, đang tăng

$ vmstat 1 3
 r  b   swpd  free  buff  cache   si so    bi     bo   in    cs us sy id wa st
 2 38      0  980M  120M   6.1G    0  0  4200  38000 8200 15000  8  6  4 82  0
#   ↑ 38 process ở trạng thái D                                        ↑ wa 82%

# ⇒ KHÔNG phải CPU (us 8%). Đây là nút thắt I/O.

$ iostat -xz 1 3
Device  r/s    w/s   rkB/s   wkB/s  await  %util
sda     120   3400   4800  380000   210     99.8     # đĩa bão hoà, ghi rất nhiều

$ iotop -o -b -n1 | head
  PID  DISK WRITE  COMMAND
 4821    340 M/s   node dist/main.js

$ ls -l /proc/4821/fd | grep -c log
1                                          # ghi vào một file log

$ ls -lh /var/log/app/app.log
-rw-r--r-- 1 app app 89G

$ tail -1 /var/log/app/app.log
{"level":"debug","msg":"query","sql":"SELECT ...","duration":0.4}

# ⇒ NGUYÊN NHÂN: LOG_LEVEL=debug được bật ở production sau lần deploy gần nhất.
#    Ghi log làm bão hoà đĩa → mọi thao tác I/O (kể cả của DB) chậm theo.
```

Đường đi: `load cao` → `wa cao, us thấp` → `I/O` → `đĩa nào, process nào` → `fd nào` → `nguyên nhân`.

Không bước nào là phỏng đoán, và mỗi bước thu hẹp phạm vi.

## Prediction

1. `load average` 40 trên máy 4 core, CPU idle 90% — nguyên nhân?
2. `free -h` cho thấy `free` chỉ 200 MB nhưng `available` 8 GB — có vấn đề không?
3. `vmstat` cho `si`/`so` > 0 liên tục — hậu quả?
4. `%util` của đĩa 100%, `await` 300ms — ứng dụng thấy gì?
5. `df -h` báo còn 40% nhưng ghi file lỗi `No space left on device` — nguyên nhân?
6. `xoá file log 50 GB` mà `df` không giảm — vì sao? Kiểm tra bằng lệnh nào?
7. Nhiều process ở trạng thái `D` — chúng đang chờ gì? Có kill được không?
8. `st` (steal) 25% trên máy ảo cloud — nguyên nhân nằm ở đâu?
9. `sy` (system) 40% — nghi ngờ gì?
10. `strace -p <pid>` trên process đang chịu 1.000 req/s ở production — hậu quả?
11. Container production không có `ss`, `curl`, `ps` — làm sao debug mạng?
12. `ss -tan` cho 5.000 `CLOSE_WAIT` — bug ở đâu?
13. Process treo, `strace` cho thấy nó chờ ở `read(12, ...)` — bước tiếp theo?

<details>
<summary>Đáp án</summary>

1. Load trên Linux tính cả tiến trình chờ **đĩa** (trạng thái D). CPU thấp + load cao = **nút thắt I/O**.
2. **Không** — Linux dùng RAM rảnh làm page cache và nhường khi cần. Chỉ nhìn `available`.
3. Swap đang hoạt động → đĩa chậm hơn RAM hàng nghìn lần → hệ thống chậm thảm hoạ.
4. Mọi thao tác đĩa mất ~300ms. Query DB, ghi log, đọc file đều chậm theo.
5. Hết **inode** — kiểm tra bằng `df -i`. Thường do hàng triệu file nhỏ.
6. Process vẫn giữ fd → inode chưa giải phóng. `lsof +L1`. Sửa bằng `truncate -s 0` hoặc restart.
7. Chờ **I/O đĩa** (uninterruptible). `kill -9` **không** giết được cho tới khi I/O hoàn tất.
8. Ở **hypervisor** — máy ảo khác đang chiếm CPU vật lý. Không sửa được từ trong máy; đổi instance type hoặc báo nhà cung cấp.
9. Quá nhiều syscall: I/O nhỏ lẻ, context switch nhiều, hoặc `strace` đang chạy.
10. Process chậm hàng chục lần — có thể gây sự cố. Dùng `strace -c` với thời gian ngắn.
11. `kubectl debug` với image có sẵn công cụ, hoặc đọc `/proc/net/tcp` và `/proc/<pid>/fd`.
12. **Trong code**: không gọi `close()` sau khi peer đóng. Cũng là rò rỉ fd.
13. `lsof -p <pid>` để biết fd 12 là gì — file, socket tới đâu, pipe của ai.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `dd if=/dev/zero of=/tmp/x bs=1M count=20000` rồi `iostat -xz 1` | `%util` 100%, `await` cao |
| `uptime` trong lúc đó | Load tăng dù CPU thấp |
| `stress-ng --cpu 8` trên 4 core, `uptime` | Load ≈ 8, CPU 100% |
| Tạo 2 triệu file nhỏ, `df -h` và `df -i` | Dung lượng còn, inode hết |
| Tạo file 10 GB, `rm` khi đang mở, `df -h` | Không giảm |
| `lsof +L1` | Thấy file đã xoá |
| `truncate -s 0`, `df -h` | Giảm |
| Cấp phát RAM tới khi swap, `vmstat 1` | `si`/`so` > 0, hệ thống chậm |
| `strace -p <pid>` trên process bận, đo throughput | Giảm mạnh |
| `strace -c -p <pid>` trong 5 giây | Ít xâm lấn hơn nhiều |
| Viết client không `close()`, `ss -tan` | `CLOSE_WAIT` tăng |
| Chạy container từ image `scratch`, thử `ps` | Không có công cụ |
| `kubectl debug` với netshoot | Có đủ công cụ |

## What Usually Goes Wrong

- **Đoán thay vì đo** → sửa nhầm chỗ, vấn đề quay lại.
- **Đọc `free` thay vì `available`** → tưởng hết RAM.
- **Bỏ qua `wa` trong `top`** → nghĩ CPU là nút thắt trong khi vấn đề là đĩa.
- **Không biết load tính cả trạng thái D** → "load 40 mà CPU rảnh" thành bí ẩn.
- **Quên `df -i`** → `No space left` với đĩa còn trống.
- **`rm` file đang mở** → tưởng đã giải phóng đĩa.
- **`strace` trên production không giới hạn** → làm chậm hoặc treo service.
- **Chỉ nhìn utilization, không nhìn saturation** → bỏ sót hàng đợi.
- **Không có công cụ trong image production** → không debug được đúng lúc cần.
- **Không so với baseline** → không biết con số hiện tại là bất thường hay bình thường.
- **Không ghi lại quá trình debug** → lần sau làm lại từ đầu.
- **Dừng ở triệu chứng đầu tiên tìm được** → sửa cái không phải nguyên nhân gốc.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Load average đo CPU | Trên Linux nó tính cả tiến trình chờ đĩa |
| `free` thấp là hết RAM | Page cache; nhìn `available` |
| Đĩa còn trống thì ghi được | Có thể hết inode |
| `rm` giải phóng đĩa ngay | Chỉ khi mọi fd đóng |
| `kill -9` giết được mọi process | Process ở trạng thái D không chết cho tới khi I/O xong |
| `strace` an toàn để chạy ở production | Nó có thể làm chậm hàng chục lần |
| Utilization cao là vấn đề | Saturation (hàng đợi) mới là vấn đề |
| Container thấy tài nguyên của chính nó | Nhiều công cụ đọc số của host |
| Không có công cụ thì không debug được | `/proc` luôn có |
| Tìm được một nguyên nhân là xong | Thường có nhiều lớp; hỏi "vì sao" thêm vài lần |

## Debugging

Quy trình tổng, áp dụng cho mọi triệu chứng:

```text
① Triệu chứng là gì, ĐO ĐƯỢC không?
   "chậm" → chậm bao nhiêu ms? ở endpoint nào? từ khi nào?

② So với BASELINE
   Bình thường là bao nhiêu? Không có baseline thì không có bất thường.

③ Thu hẹp TẦNG
   client → mạng → LB → app → DB → đĩa
   Đo ở từng điểm, tìm nơi thời gian biến mất.

④ Bốn tài nguyên + hai thứ khác
   CPU / memory / disk / network / lock / giới hạn cấu hình

⑤ Thu hẹp PROCESS
   top, pidstat, iotop → process nào

⑥ Đi sâu
   /proc/<pid>/*, lsof, strace -c

⑦ GIẢ THUYẾT → KIỂM CHỨNG
   Đổi MỘT thứ, đo lại. Không đổi nhiều thứ cùng lúc.

⑧ Ghi lại
   Triệu chứng, cách chẩn đoán, nguyên nhân gốc, cách sửa, cách phòng.
```

Bước ② là bước bị bỏ nhiều nhất và làm hỏng mọi bước sau: không có baseline, bạn không biết `load 8` là bình thường hay là sự cố.

Bước ⑦ cũng vậy: đổi ba thứ cùng lúc rồi thấy hết chậm nghĩa là bạn vẫn không biết nguyên nhân.

## Production Considerations

- **Cài sẵn công cụ chẩn đoán trên node**: `sysstat` (iostat, pidstat, mpstat), `iotop`, `lsof`, `strace`, `ss`, `dstat`.
- **Image production nên tối giản** — dùng ephemeral debug container (`kubectl debug`, netshoot) thay vì nhét công cụ vào image.
- **Ghi lại baseline**: load, memory, disk I/O, số connection ở tải bình thường. Đây là thứ làm cho "bất thường" có nghĩa.
- **Monitoring trước khi cần.** Debug bằng SSH là biện pháp cuối, không phải quy trình chính. Khi có sự cố, dữ liệu lịch sử quan trọng hơn khả năng SSH.
- **Alert trên saturation, không chỉ utilization**: load / core, độ dài hàng đợi đĩa, `waitingCount` của connection pool.
- **`strace` chỉ dùng khi thật cần**, với `-c` và thời gian ngắn. Cân nhắc `perf` hoặc eBPF (`bpftrace`) nếu có.
- **Runbook cho triệu chứng phổ biến** — "đĩa đầy", "load cao", "OOM" — với đúng chuỗi lệnh. Nó biến 30 phút thành 3 phút lúc 3 giờ sáng.
- **Ghi lại mọi cuộc điều tra** vào postmortem, kể cả khi không có sự cố lớn. Lần sau người khác sẽ đọc nó.
- **Tự động hoá những gì lặp lại** — nếu bạn chạy cùng 8 lệnh mỗi lần, viết một script.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Công cụ đầy đủ trên node | debug nhanh | bề mặt tấn công lớn hơn |
| Node tối giản | an toàn hơn | phải dùng debug container |
| Công cụ trong image app | luôn có sẵn | image lớn, rủi ro bảo mật |
| Ephemeral debug container | image sạch, đủ công cụ khi cần | cần quyền, cần biết cách |
| `strace` | thông tin sâu nhất | làm chậm nghiêm trọng |
| `strace -c` | ít xâm lấn | ít chi tiết |
| eBPF / `perf` | overhead thấp, mạnh | cần kernel mới, học nhiều hơn |
| Monitoring đầy đủ | phát hiện sớm, có lịch sử | chi phí, cấu hình |
| Chỉ log | rẻ | không có dữ liệu khi cần điều tra |
| Runbook chi tiết | xử lý nhanh, ai cũng làm được | phải bảo trì khi hệ thống đổi |

## Explain Without Notes

1. Bốn tài nguyên và hai thứ khác gây triệu chứng giống hệt?
2. Vì sao load average cao mà CPU thấp? Điều đó nói lên gì?
3. Vì sao `free` thấp không phải vấn đề? Nhìn cột nào?
4. Hai cách hết chỗ ghi file, và lệnh phân biệt chúng?
5. Vì sao `rm` file log không giải phóng đĩa?
6. Trạng thái `D` nghĩa là gì? Vì sao `kill -9` không giết được?
7. USE là gì, và câu hỏi nào trong ba câu hay bị bỏ nhất?
8. Tám bước của quy trình debug, và bước nào bị bỏ nhiều nhất?

## Related

- [Process, file & env](01-process-files-env.md) — `/proc`, fd
- [Memory, CPU & limits](02-memory-cpu-limits.md) — cgroup, OOM
- [Filesystem & permissions](03-filesystem-permissions.md) — `namei`, quyền
- [Signals & lifecycle](04-signals-lifecycle.md) — exit code
- [Ports & sockets](05-ports-sockets.md) — `ss`, trạng thái TCP
- [Logs & services](06-logs-and-services.md) — `journalctl`, `df`, `du`
- [Network debugging](../01-networking/06-network-debugging.md) — tầng mạng
- [Debugging Kubernetes](../04-kubernetes/operations/02-debugging-k8s.md) — tầng orchestrator
- [Latency & throughput](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — phương pháp chung
- [Logs, metrics & traces](../../05-cross-cutting/observability/01-logs-metrics-traces.md) — quan sát trước khi cần

## Version / Context

Linux. `sysstat` cung cấp `iostat`/`pidstat`/`mpstat`. `ss` thay `netstat`. eBPF (`bpftrace`, `bcc`) cần kernel 4.9+ và là lựa chọn tốt hơn `strace` ở production. macOS dùng bộ công cụ khác (`dtrace`, `fs_usage`, `lsof`).
