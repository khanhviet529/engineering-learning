---
level: foundation
area: infra
---

# Linux

Docker và Kubernetes không phát minh ra gì mới. Chúng là **cách đóng gói và điều phối** bốn cơ chế của Linux:

```text
namespace  →  container "thấy" thế giới riêng (mạng, process, filesystem)
cgroup     →  giới hạn tài nguyên (memory.max, cpu.max)
process    →  PID 1, signal, file descriptor
filesystem →  layer, mount, quyền theo UID
```

Khi trừu tượng hoá rò rỉ — và nó sẽ rò rỉ — bạn cần bốn cơ chế này. Đó là lý do folder này đứng trước Docker.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Process, file & env](01-process-files-env.md) | Vì sao `EMFILE` sau 6 giờ chạy? |
| 2 | [Memory, CPU & limits](02-memory-cpu-limits.md) | Vì sao pod bị giết mà không có log nào? |
| 3 | [Filesystem & permissions](03-filesystem-permissions.md) | Vì sao chuyển sang non-root làm hỏng ghi volume? |
| 4 | [Signals & lifecycle](04-signals-lifecycle.md) | Vì sao handler shutdown không bao giờ chạy? |
| 5 | [Ports & sockets](05-ports-sockets.md) | Vì sao `curl` từ host bị refused? |
| 6 | [Logs & services](06-logs-and-services.md) | Vì sao đĩa đầy 340 GB log? |
| 7 | [Debugging toolbox](07-debugging-toolbox.md) | "Server chậm" — chạy lệnh gì, theo thứ tự nào? |

Note 7 là note bạn sẽ mở lại nhiều nhất.

## Bốn con số phải biết đọc

```text
EXIT CODE
  0    tắt sạch
  137  = 128+9  SIGKILL  → OOMKilled, hoặc hết grace period
  143  = 128+15 SIGTERM  → thoát ngay, KHÔNG dọn dẹp

LOAD AVERAGE
  so với số core; trên Linux tính cả tiến trình CHỜ ĐĨA
  → load cao + CPU thấp = nút thắt I/O

MEMORY
  nhìn `available`, KHÔNG nhìn `free`
  trong container: /sys/fs/cgroup/memory.max, không phải free -h

FILE DESCRIPTOR
  socket cũng là fd; `ulimit -n` là giới hạn MỖI PROCESS
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| `EMFILE: too many open files` | `ulimit -n` thấp, hoặc rò rỉ fd | [1](01-process-files-env.md) |
| Exit 137, không log | OOMKilled | [2](02-memory-cpu-limits.md) |
| Chậm bất thường, CPU trung bình thấp | CPU throttling (cgroup) | [2](02-memory-cpu-limits.md) |
| App thấy 64 GB RAM trong container 512Mi | đọc thông tin của host | [2](02-memory-cpu-limits.md) |
| `EACCES` khi ghi volume | UID không khớp | [3](03-filesystem-permissions.md) |
| Container mất ~30s mới tắt | PID 1 sai | [4](04-signals-lifecycle.md) |
| Exit 143 mỗi lần deploy | không có handler SIGTERM | [4](04-signals-lifecycle.md) |
| 502 chỉ trong lúc deploy | đóng listener trước khi LB rút traffic | [4](04-signals-lifecycle.md) |
| `connection refused` từ host | bind `127.0.0.1` | [5](05-ports-sockets.md) |
| `EADDRINUSE` | process cũ còn giữ port | [5](05-ports-sockets.md) |
| `CLOSE_WAIT` tăng đều | code không `close()` → rò rỉ fd | [5](05-ports-sockets.md) |
| `EADDRNOTAVAIL` ở client | cạn ephemeral port; thiếu keep-alive | [5](05-ports-sockets.md) |
| Đĩa đầy | log không xoay vòng | [6](06-logs-and-services.md) |
| `No space left` nhưng `df` còn trống | hết inode (`df -i`) | [7](07-debugging-toolbox.md) |
| Xoá file mà đĩa không giảm | process còn giữ fd (`lsof +L1`) | [7](07-debugging-toolbox.md) |
| Script chạy tay được, cron không | môi trường cron tối giản | [6](06-logs-and-services.md) |
| Load 40, CPU 10% | chờ đĩa (trạng thái D) | [7](07-debugging-toolbox.md) |

## 60 giây đầu tiên khi có sự cố

```bash
uptime                    # load vs số core — có hàng đợi không?
dmesg -T | tail -20       # kernel có kêu không? (OOM, lỗi đĩa)
vmstat 1 5                # us/sy/wa/st, si/so
free -h                   # nhìn cột available
df -h && df -i            # dung lượng VÀ inode
top -b -n1 | head -20     # ai đang ăn tài nguyên
ss -s                     # tổng quan socket
journalctl -p err --since '30 min ago' --no-pager | tail -30
```

## Năm quyết định cho container

Năm dòng này giải quyết phần lớn lớp lỗi trong folder:

```dockerfile
CMD ["node", "dist/main.js"]        # 1. PID 1 là app, không phải sh/npm
USER app                             # 2. non-root
ENV NODE_OPTIONS="--max-old-space-size=384"   # 3. ~75% memory limit
```

```ts
app.listen(port, '0.0.0.0');         // 4. bind mọi interface trong container
process.on('SIGTERM', shutdown);     // 5. handler idempotent, có delay trước khi đóng
```

## Position

```text
App → RUNTIME (process, fd, signal) → cgroup/namespace → kernel → phần cứng
       ↑ folder này
```

## Related

- [01-networking/](../01-networking/README.md) — tầng mạng phía trên socket
- [02-docker/](../02-docker/README.md) — namespace và cgroup được đóng gói
- [04-kubernetes/](../04-kubernetes/README.md) — điều phối nhiều container
- [Process & memory (Node.js)](../../02-backend-api/01-nodejs/03-process-memory.md) — phía runtime
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — signal ở tầng ứng dụng
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md)
- [Latency & throughput](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md)

## Version / Context

Linux với systemd và cgroup v2 (mặc định trên bản phân phối hiện đại và Kubernetes 1.25+). Đường dẫn cgroup v1 khác; các note ghi rõ khi cần. macOS không có `/proc` — dùng `lsof`, `dtrace`, `fs_usage`.
