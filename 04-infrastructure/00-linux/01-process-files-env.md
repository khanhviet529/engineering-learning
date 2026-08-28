---
level: foundation
area: infra
prerequisites: []
related:
  - 04-signals-lifecycle.md
  - 05-ports-sockets.md
  - 07-debugging-toolbox.md
---

# Process, file descriptor & environment

> `docker run` báo lỗi `EMFILE: too many open files` sau 6 giờ chạy. Trong code không có chỗ nào mở file. Nhưng mỗi kết nối HTTP, mỗi connection tới database, mỗi socket đều là một **file descriptor** — và Linux giới hạn số fd mà một process được mở. Nếu bạn không biết fd là gì, lỗi này là một bí ẩn; nếu biết, nó là một dòng lệnh.

## Position

```text
Container / máy
   └─ PROCESS (PID)
        ├─ file descriptor  0,1,2 (stdin/out/err), file, socket, pipe
        ├─ environment      biến môi trường, copy tại lúc exec
        ├─ working directory
        ├─ user/group (UID/GID)
        └─ thread, bộ nhớ ảo
```

Mọi thứ ở tầng trên — Docker, Kubernetes, Node.js — đều là trừu tượng hoá của bốn thứ này. Khi trừu tượng hoá rò rỉ (và nó sẽ rò rỉ), bạn cần biết bên dưới là gì.

## Problem

Ba lớp lỗi mà không có mô hình process thì không giải thích được:

```text
① EMFILE / ENFILE            "too many open files"
② PID 1 không nhận SIGTERM   container mất 30 giây mới tắt, exit 137
③ Biến môi trường undefined  chạy ở máy thì được, trong container thì không
```

Cả ba đều là hành vi **bình thường** của Linux. Chúng chỉ trông như bug vì tầng trừu tượng phía trên che mất cơ chế.

## Mental Model

### Process là gì

```text
Một chương trình ĐANG CHẠY, với:
  PID        định danh
  PPID       process cha
  UID/GID    chạy dưới danh nghĩa ai
  cwd        thư mục làm việc
  env        bản SAO của biến môi trường tại lúc exec
  fd table   bảng số → tài nguyên đang mở
  memory     không gian địa chỉ ảo riêng
```

Hai tính chất quan trọng:

- **`env` là bản sao.** Đổi biến môi trường của shell không ảnh hưởng process đang chạy. Đây là lý do "xoay secret" bằng env var đòi hỏi restart.
- **Process con kế thừa** env, fd, cwd, UID từ cha tại thời điểm `fork`.

### File descriptor: mọi thứ là một con số

```text
fd  0  stdin
fd  1  stdout
fd  2  stderr
fd  3+ file, SOCKET, pipe, epoll, timer, inotify...
```

Điểm mấu chốt: **socket cũng là fd**. Nên với một server:

```text
1.000 kết nối HTTP đồng thời  = 1.000 fd
+ 20 connection tới PostgreSQL = 20 fd
+ vài file log, vài socket nội bộ
────────────────────────────────
≈ 1.030 fd
```

Nếu `ulimit -n` là 1024, bạn hết fd ở khoảng kết nối thứ 1.000 — và lỗi hiện ra dưới dạng `EMFILE`, `ECONNREFUSED`, hoặc đơn giản là request bị treo.

```bash
ulimit -n                        # giới hạn mềm hiện tại
ulimit -Hn                       # giới hạn cứng
cat /proc/<pid>/limits           # giới hạn thật của một process đang chạy
ls /proc/<pid>/fd | wc -l        # đang mở bao nhiêu
ls -l /proc/<pid>/fd | head      # chúng là gì
```

`/proc/<pid>/fd` là công cụ chẩn đoán trực tiếp nhất: nó cho bạn thấy **chính xác** process đang giữ cái gì.

### Rò rỉ fd

```ts
// ❌ mỗi lần gọi mở một fd và không bao giờ đóng
const stream = fs.createReadStream(path);
stream.pipe(res);                 // res đóng sớm → stream KHÔNG được dọn
```

Triệu chứng đặc trưng: hệ thống chạy tốt vài giờ rồi bắt đầu lỗi, restart thì hết. Giống memory leak nhưng con số tăng là số fd, không phải RSS.

```bash
# đếm fd theo thời gian — tăng đều không giảm = rò rỉ
watch -n5 'ls /proc/$(pgrep -f node)/fd | wc -l'
```

### PID 1 đặc biệt

Trong một container, process đầu tiên là PID 1, và Linux đối xử với PID 1 khác mọi process khác:

```text
① PID 1 KHÔNG có handler mặc định cho SIGTERM
   → nếu app không tự đăng ký handler, SIGTERM bị BỎ QUA
   → orchestrator chờ hết grace period rồi SIGKILL → exit 137

② PID 1 chịu trách nhiệm "reap" process con mồ côi
   → không làm → zombie process tích luỹ
```

Và hệ quả thực tế phổ biến nhất:

```dockerfile
# ❌ shell là PID 1; npm là con; SIGTERM tới shell, KHÔNG tới node
CMD npm start

# ✅ node là PID 1, nhận signal trực tiếp
CMD ["node", "dist/main.js"]

# ✅ hoặc dùng init nhỏ để forward signal và reap zombie
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

Kiểm tra trong 5 giây:

```bash
docker exec <container> ps -o pid,ppid,comm
# PID 1 phải là 'node', không phải 'sh' hay 'npm'
```

Chi tiết đầy đủ: [Signals & lifecycle](04-signals-lifecycle.md).

### Biến môi trường

```bash
printenv                          # env của shell hiện tại
cat /proc/<pid>/environ | tr '\0' '\n'   # env THẬT của một process đang chạy
docker exec <c> env               # env trong container
```

Câu lệnh thứ hai giải quyết phần lớn tranh cãi "biến đó có được set không": nó đọc env **thật** mà kernel giữ cho process đó, không phải env của shell bạn đang gõ.

Ba điều đáng biết:

```text
① env là bản sao lúc exec — đổi sau không ảnh hưởng
② env hiển thị trong /proc/<pid>/environ → SECRET trong env KHÔNG kín
   (bất kỳ ai đọc được /proc của process đó, và mọi crash dump)
③ shell khác nhau nạp file khác nhau (.bashrc vs .profile vs non-interactive)
   → "chạy được trong terminal, không chạy trong cron/systemd"
```

Điểm ③ là nguyên nhân kinh điển của "script chạy bằng tay thì được, chạy bằng cron thì không": cron chạy với môi trường tối giản, không nạp `.bashrc`, và `PATH` khác hẳn.

### `exec` và ba mô hình chạy lệnh

```bash
# ① fork + exec: tạo process CON
node app.js &

# ② exec: THAY THẾ process hiện tại, giữ nguyên PID
exec node app.js

# ③ shell wrapper: shell là PID 1, node là con
sh -c "node app.js"
```

Trong entrypoint script, `exec` là chi tiết quyết định:

```bash
#!/bin/sh
# ... setup ...
exec node dist/main.js      # ← không có 'exec', shell giữ PID 1 và nuốt signal
```

### User và quyền

```bash
id                                # UID/GID hiện tại
ps -o pid,user,comm -p <pid>      # process chạy dưới user nào
```

```dockerfile
# ❌ mặc định: chạy root trong container
# ✅ tạo user không đặc quyền
RUN addgroup -S app && adduser -S app -G app
USER app
```

Chạy root trong container là mặc định, và nó là một rủi ro thật: nếu attacker thoát được ra khỏi container (qua lỗ hổng runtime hoặc do cấu hình `--privileged`, mount `/var/run/docker.sock`), họ có root trên host.

Nhưng đổi sang non-root tạo ra một lớp lỗi mới: `permission denied` khi ghi vào volume. Xem [Filesystem & permissions](03-filesystem-permissions.md).

### `/proc`: kernel như một hệ thống file

```bash
/proc/<pid>/cmdline    lệnh đầy đủ đã chạy
/proc/<pid>/environ    biến môi trường thật
/proc/<pid>/fd/        mọi fd đang mở
/proc/<pid>/limits     giới hạn tài nguyên
/proc/<pid>/status     bộ nhớ, threads, UID
/proc/<pid>/cgroup     thuộc cgroup nào (→ giới hạn của container)
```

Đây là nguồn sự thật khi mọi công cụ khác nói những điều mâu thuẫn. Xem [Debugging toolbox](07-debugging-toolbox.md).

## Example

Chẩn đoán `EMFILE` từ đầu tới cuối:

```bash
# 1. Tìm process
pgrep -a node
# 4821 node dist/main.js

# 2. Giới hạn là bao nhiêu
cat /proc/4821/limits | grep 'open files'
# Max open files   1024   4096   files      ← mềm 1024, cứng 4096

# 3. Đang dùng bao nhiêu
ls /proc/4821/fd | wc -l
# 1019                                       ← sát trần

# 4. Chúng là cái gì — bước quyết định
ls -l /proc/4821/fd | awk '{print $NF}' | sed 's/:.*//' | sort | uniq -c | sort -rn | head
#  870 socket
#  120 /var/log/app/upload-tmp-...            ← 120 file tạm không được đóng → RÒ RỈ
#   20 anon_inode
```

Bước 4 phân biệt hai kết luận hoàn toàn khác nhau:

```text
Phần lớn là socket    → tải cao thật → tăng ulimit
Nhiều file lặp lại    → RÒ RỈ trong code → tăng ulimit chỉ hoãn vấn đề
```

Sửa giới hạn (khi đó thật sự là tải cao):

```yaml
# Kubernetes
securityContext:
  # trong K8s, ulimit thường được đặt ở tầng container runtime hoặc sysctl của node
# Docker
docker run --ulimit nofile=65536:65536 ...
# docker-compose
ulimits:
  nofile: { soft: 65536, hard: 65536 }
```

## Prediction

1. `ulimit -n` là 1024, server nhận 1.200 kết nối đồng thời — chuyện gì xảy ra?
2. `CMD npm start` trong Dockerfile, gửi SIGTERM — Node có nhận không? Exit code?
3. Đổi thành `CMD ["node", "dist/main.js"]` — khác gì?
4. Entrypoint script không có `exec` trước lệnh cuối — PID 1 là gì?
5. Đặt biến môi trường trong shell sau khi process đã chạy — process thấy giá trị mới không?
6. `cat /proc/<pid>/environ` với process chứa `DATABASE_URL` — ai đọc được?
7. Script chạy bằng tay thì được, chạy bằng cron thì `command not found` — nguyên nhân?
8. Container chạy root, ghi vào volume mount từ host với owner `1000:1000` — ghi được không?
9. Đổi sang `USER app` (UID 1001), cùng volume — ghi được không?
10. Process mở file trong vòng lặp không đóng — triệu chứng theo thời gian?
11. `ls /proc/<pid>/fd | wc -l` trả 950 với `ulimit -n` = 1024, phần lớn là socket — tải cao hay rò rỉ?
12. Process cha chết, process con còn chạy — con thành con của ai?
13. PID 1 không reap process con — chuyện gì tích luỹ?

<details>
<summary>Đáp án</summary>

1. Ở khoảng kết nối thứ 1.000: `EMFILE: too many open files`. Kết nối mới bị từ chối; nhìn từ client là `ECONNREFUSED` hoặc treo.
2. **Không nhận** — `npm` là PID 1 và không forward signal. Sau grace period → SIGKILL → exit **137**.
3. `node` là PID 1, nhận SIGTERM trực tiếp, chạy handler, exit **0**.
4. **Shell** là PID 1 — nó nuốt signal, và ứng dụng không bao giờ thấy SIGTERM.
5. **Không** — env là bản sao lúc exec.
6. Bất kỳ ai đọc được `/proc` của process đó (cùng UID, hoặc root), và mọi crash dump. Secret trong env **không kín**.
7. Cron chạy với môi trường tối giản: `PATH` khác, không nạp `.bashrc`. Dùng đường dẫn tuyệt đối hoặc set `PATH` trong crontab.
8. **Ghi được** — root bỏ qua kiểm tra quyền thông thường.
9. **Không** (thường là `permission denied`) — UID 1001 không sở hữu thư mục owner 1000.
10. Số fd tăng đều; sau vài giờ `EMFILE`; restart thì hết. Giống memory leak nhưng đơn vị là fd.
11. Không kết luận được từ con số — phải xem fd **là gì**. Socket nhiều = tải cao; file trùng lặp = rò rỉ.
12. Thành con của **PID 1** (được "nhận nuôi").
13. **Zombie process** — process đã chết nhưng entry trong bảng process chưa được dọn; chúng chiếm PID.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `ulimit -n 64` rồi chạy server, mở 100 kết nối | `EMFILE` |
| Đếm `/proc/<pid>/fd` khi tăng số kết nối | Tương quan 1:1 |
| Mở file trong vòng lặp không đóng, theo dõi fd count | Tăng đều |
| `CMD npm start` + `docker stop`, đo thời gian và exit code | ~10s (grace period) rồi 137 |
| Đổi sang `CMD ["node", ...]`, lặp lại | Thoát nhanh, exit 0 |
| Entrypoint không có `exec`, `ps -o pid,comm` trong container | PID 1 là `sh` |
| Thêm `exec`, lặp lại | PID 1 là `node` |
| `cat /proc/<pid>/environ \| tr '\0' '\n' \| grep -i secret` | Secret hiện ra |
| Chạy script từ cron với `PATH` mặc định | `command not found` |
| So `env` trong shell và `docker exec <c> env` | Khác nhau |
| Container non-root ghi vào volume owner khác | `permission denied` |
| `chown` volume theo UID của container, lặp lại | Ghi được |
| Tạo process con rồi kill cha, `ps -ef` | Con có PPID = 1 |

## What Usually Goes Wrong

- **`ulimit -n` mặc định quá thấp** cho server nhiều kết nối → `EMFILE` dưới tải.
- **Rò rỉ fd** → giống memory leak, chỉ lộ sau nhiều giờ.
- **Tăng `ulimit` để "sửa" rò rỉ** → hoãn vấn đề, không sửa.
- **`CMD npm start`** → PID 1 sai, không nhận SIGTERM, exit 137 mỗi lần deploy.
- **Entrypoint thiếu `exec`** → cùng vấn đề.
- **Secret trong env var** → lộ trong `/proc/<pid>/environ`, `docker inspect`, crash dump.
- **Giả định env giống nhau giữa shell và cron/systemd/container** → "chạy máy tôi thì được".
- **Chạy root trong container** → tăng thiệt hại nếu bị thoát container.
- **Đổi sang non-root mà không xử lý quyền volume** → `permission denied` khi ghi.
- **Không reap zombie** khi app tự spawn process con → tích luỹ PID.
- **Không biết `/proc`** → chẩn đoán bằng đoán thay vì bằng dữ liệu.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| fd chỉ dành cho file | Socket, pipe, epoll đều là fd |
| `ulimit -n` là giới hạn toàn hệ thống | Nó là giới hạn **mỗi process** |
| Đổi env của shell ảnh hưởng process đang chạy | env là bản sao lúc exec |
| Secret trong env var là kín | Đọc được qua `/proc`, `docker inspect`, crash dump |
| PID 1 giống mọi process khác | Nó không có handler signal mặc định và phải reap con |
| Container luôn nhận SIGTERM | Chỉ khi PID 1 là app của bạn (hoặc có init forward) |
| Chạy root trong container là an toàn vì đã cô lập | Cô lập không tuyệt đối; giảm quyền là lớp phòng thủ rẻ |
| `docker exec ... env` bằng env của process | Gần đúng, nhưng `/proc/1/environ` mới là env thật của PID 1 |
| Zombie process tốn CPU/RAM | Chúng chỉ chiếm một entry PID — nhưng PID là tài nguyên hữu hạn |

## Debugging

Thứ tự cố định khi gặp vấn đề ở tầng process:

1. **Process nào?** `pgrep -a <tên>` hoặc `ps aux | grep`.
2. **Nó đang mở gì?** `ls -l /proc/<pid>/fd` — nhóm theo loại.
3. **Giới hạn là gì?** `cat /proc/<pid>/limits`.
4. **Env thật?** `cat /proc/<pid>/environ | tr '\0' '\n'`.
5. **Chạy dưới user nào?** `ps -o pid,user,comm -p <pid>`.
6. **PID 1 là gì (trong container)?** `docker exec <c> ps -o pid,comm`.
7. **Nó thuộc cgroup nào?** `cat /proc/<pid>/cgroup` → dẫn tới giới hạn memory/CPU. Xem [Memory, CPU & limits](02-memory-cpu-limits.md).

Bước 2 là bước có tỉ lệ giá trị/chi phí cao nhất và ít người dùng nhất.

## Production Considerations

- **Đặt `ulimit -n` tường minh** cho service nhiều kết nối (65536 là con số thường dùng). Đừng dựa vào mặc định.
- **Theo dõi số fd như một metric** — nó phát hiện rò rỉ trước khi có sự cố. Node: `process.report` hoặc đọc `/proc/self/fd`.
- **PID 1 phải là ứng dụng của bạn**, hoặc dùng `tini`/`--init`. Kiểm tra điều này trong smoke test.
- **Không chạy root trong container**; tạo user riêng trong Dockerfile và xử lý quyền volume tương ứng.
- **Secret nên qua file mount, không qua env** khi có thể — file có thể phân quyền và không lộ qua `/proc/<pid>/environ`. Xem [Secrets management](../../05-cross-cutting/security/06-secrets-management.md).
- **Đường dẫn tuyệt đối trong cron và systemd** — môi trường ở đó khác shell tương tác.
- **`exec` ở cuối mọi entrypoint script.**
- **Ghi lại danh sách biến môi trường bắt buộc** và validate lúc khởi động. Xem [Configuration](../../02-backend-api/04-architecture/05-configuration.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `ulimit -n` cao | chịu nhiều kết nối | che rò rỉ fd lâu hơn |
| `ulimit -n` thấp | rò rỉ lộ sớm | giới hạn tải hợp lệ |
| Chạy non-root | giảm thiệt hại khi bị thoát container | phải xử lý quyền volume |
| Chạy root | không vướng quyền | rủi ro cao hơn |
| `tini` làm init | reap zombie, forward signal đúng | thêm một binary vào image |
| App làm PID 1 trực tiếp | đơn giản nhất | phải tự xử lý signal và (nếu spawn con) reap |
| Secret qua env | đơn giản, chạy mọi nơi | lộ qua `/proc`, không xoay nóng được |
| Secret qua file | kín hơn, xoay được | phức tạp hơn |
| Entrypoint script | linh hoạt lúc khởi động | phải nhớ `exec` |

## Explain Without Notes

1. File descriptor là gì, và vì sao một web server hết fd?
2. Vì sao PID 1 đặc biệt? Hai trách nhiệm riêng của nó?
3. Vì sao `CMD npm start` làm graceful shutdown không hoạt động?
4. Vì sao đổi biến môi trường của shell không ảnh hưởng process đang chạy?
5. Vì sao secret trong env var không kín?
6. Vì sao script chạy bằng tay thì được mà cron thì không?
7. Ba lệnh đầu tiên bạn chạy khi gặp `EMFILE`?

## Related

- [Signals & lifecycle](04-signals-lifecycle.md) — SIGTERM, exit code, PID 1
- [Memory, CPU & limits](02-memory-cpu-limits.md) — cgroup, OOMKilled
- [Filesystem & permissions](03-filesystem-permissions.md) — UID và volume
- [Ports & sockets](05-ports-sockets.md) — socket là fd
- [Debugging toolbox](07-debugging-toolbox.md) — `/proc`, `lsof`, `strace`
- [Process & memory (Node.js)](../../02-backend-api/01-nodejs/production/01-process-memory.md) — phía runtime
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — PID 1 và SIGTERM
- [Image & container](../02-docker/01-image-container.md) — process trong container
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — env var ở tầng ứng dụng
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md)

## Version / Context

Linux (mọi bản phân phối hiện đại). `/proc` là procfs của Linux — macOS không có nó (dùng `lsof` thay thế). `tini` được tích hợp sẵn trong Docker qua `--init`.
