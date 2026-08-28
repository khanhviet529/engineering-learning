---
level: intermediate
area: infra
prerequisites:
  - 01-process-files-env.md
related:
  - 04-signals-lifecycle.md
  - ../../02-backend-api/01-nodejs/production/01-process-memory.md
  - ../04-kubernetes/scheduling-reliability/02-scheduling-resources.md
---

# Memory, CPU & limits

> Pod bị restart lúc 3 giờ sáng. Không có log lỗi, không có stack trace, dòng log cuối cùng hoàn toàn bình thường. `kubectl describe pod` cho một dòng: `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`. Ứng dụng không crash — nó bị **kernel giết**, và kernel không báo trước.

## Position

```text
Process  →  cgroup (memory.max, cpu.max)  →  kernel
                  ↑ Docker `-m`, K8s `resources.limits` đặt giá trị ở đây
```

Docker và Kubernetes không tự giới hạn tài nguyên. Chúng chỉ **ghi số vào cgroup**, và kernel thực thi. Hiểu cgroup nghĩa là hiểu vì sao container bị giết, vì sao nó chậm bất thường, và vì sao ứng dụng nhìn thấy sai thông tin về máy.

## Problem

### Memory: kernel giết, không thương lượng

```text
Process dùng memory > memory.max của cgroup
   → kernel OOM killer chọn nạn nhân trong cgroup đó
   → SIGKILL (9)  ← KHÔNG BẮT ĐƯỢC, không có handler, không có log từ app
   → exit code 137 (128 + 9)
```

Không có cảnh báo, không có cơ hội dọn dẹp, không có dòng log nào từ ứng dụng. Đây là lý do sự cố OOM khó chẩn đoán: **bằng chứng duy nhất nằm ngoài ứng dụng.**

### CPU: kernel không giết, nó bóp

```text
Process dùng CPU > cpu.max
   → kernel THROTTLE: dừng process cho tới chu kỳ tiếp theo (mặc định 100ms)
   → không có lỗi, không có log
   → chỉ là... CHẬM
```

Đây là chế độ hỏng nguy hiểm hơn OOM vì nó **im lặng hoàn toàn**. Ứng dụng hoạt động đúng, chỉ chậm, và mọi chỉ số CPU trông bình thường (vì nó đang bị giới hạn ở đúng mức cấu hình).

### Ứng dụng nhìn thấy sai thông tin

```text
Container giới hạn 512 MB, chạy trên host 64 GB.
Ứng dụng gọi os.totalmem() hoặc đọc /proc/meminfo
   → thấy 64 GB (thông tin của HOST)
   → tự cấu hình theo 64 GB
   → bị OOMKilled ngay
```

Cùng vấn đề với CPU: `os.cpus().length` trả về số core của **host**, không phải của cgroup. Thư viện tự đặt kích thước thread pool theo con số đó sẽ tạo ra số thread hoàn toàn sai.

## Mental Model

### cgroup: kế toán tài nguyên theo nhóm

```text
cgroup v2:
  /sys/fs/cgroup/<path>/
    memory.max      trần cứng — vượt là bị GIẾT
    memory.high     ngưỡng mềm — vượt thì bị bóp (throttle) và ép reclaim
    memory.current  đang dùng bao nhiêu
    memory.events   đếm số lần chạm giới hạn (`oom`, `oom_kill`, `high`, `max`)
    cpu.max         "quota period" — ví dụ "50000 100000" = 0,5 CPU
    cpu.stat        nr_throttled, throttled_usec
```

Ánh xạ sang công cụ quen thuộc:

```text
docker run -m 512m --cpus=0.5
K8s: resources.limits.memory=512Mi, limits.cpu=500m
   ↓
memory.max = 536870912
cpu.max    = "50000 100000"
```

### Memory: RSS không phải toàn bộ câu chuyện

```text
VIRT (virtual)   không gian địa chỉ đã map — có thể rất lớn, KHÔNG có ý nghĩa
RSS  (resident)  đang thật sự nằm trong RAM   ← con số thường được nhìn
                 (bao gồm cả trang dùng chung với process khác)
cgroup memory.current  cái mà kernel dùng để QUYẾT ĐỊNH giết
                       = RSS + page cache + kernel memory của cgroup
```

Điểm quan trọng và hay bị bỏ qua: **page cache tính vào giới hạn cgroup**. Một ứng dụng đọc file lớn có thể chạm `memory.max` mà RSS vẫn thấp — kernel sẽ reclaim page cache trước khi giết, nhưng nếu tốc độ ghi/đọc quá nhanh, nó không kịp.

### `memory.high` vs `memory.max`

```text
memory.high   → vượt: kernel BÓP process và ép reclaim; không giết
memory.max    → vượt và không reclaim được: GIẾT
```

Kubernetes chỉ đặt `memory.max` (từ `limits.memory`). Đặt `memory.high` thấp hơn một chút cho phép hệ thống "kêu" trước khi giết — hữu ích, nhưng không có sẵn qua API của K8s.

### CPU: request vs limit là hai thứ khác nhau

Đây là điểm gây nhầm lẫn nhiều nhất:

```text
CPU REQUEST   phần được ĐẢM BẢO khi có tranh chấp; dùng để SCHEDULE
              → ánh xạ sang cpu.weight (tỉ lệ chia khi cạnh tranh)
              → có thể dùng NHIỀU HƠN nếu node còn rảnh

CPU LIMIT     trần CỨNG; vượt là bị THROTTLE
              → ánh xạ sang cpu.max (quota mỗi chu kỳ)
              → dùng ít hơn cũng KHÔNG được "để dành"
```

```text
Memory: request để schedule, limit để giết
CPU:    request để chia phần, limit để bóp
```

Khác biệt cốt lõi: **memory không nén được** (cần bao nhiêu là bấy nhiêu), **CPU nén được** (chờ thêm một chút là xong). Đó là lý do vượt memory bị giết còn vượt CPU chỉ bị chậm.

### CPU throttling: cái bẫy của quota theo chu kỳ

```text
cpu.max = "50000 100000"  → 50ms CPU mỗi chu kỳ 100ms

Ứng dụng cần 80ms CPU liên tục cho một request:
  t=0..50ms    chạy
  t=50..100ms  BỊ DỪNG (hết quota)
  t=100..130ms chạy nốt
  ⇒ request mất 130ms thay vì 80ms
```

Với ứng dụng đa luồng, tình hình tệ hơn: 4 thread tiêu quota nhanh gấp 4 lần, nên quota 50ms bị dùng hết trong 12,5ms và 87,5ms còn lại là chờ.

Triệu chứng đặc trưng: **latency p99 cao bất thường trong khi CPU usage trung bình thấp**. Kiểm tra:

```bash
cat /sys/fs/cgroup/cpu.stat
# nr_periods 12000
# nr_throttled 3400          ← 28% chu kỳ bị bóp
# throttled_usec 1250000000
```

`nr_throttled / nr_periods > 5%` là dấu hiệu limit quá chặt.

Vì lý do này, một thực hành phổ biến (và gây tranh cãi) là **đặt CPU request nhưng KHÔNG đặt CPU limit** cho workload nhạy về latency: bạn vẫn được đảm bảo phần của mình khi có tranh chấp, nhưng không bị bóp khi node còn rảnh. Đánh đổi: một pod có thể ăn hết CPU dư và làm pod khác chậm hơn dự kiến.

**Memory thì ngược lại: luôn đặt limit.** Không có limit, một memory leak làm chết cả node.

### Container không thấy giới hạn của chính nó

```js
os.totalmem()        // RAM của HOST
os.cpus().length     // core của HOST
```

Node.js hiện đại (18+) đọc cgroup cho heap mặc định, nhưng nhiều thư viện thì không. Với Java trước 10, JVM tự đặt heap theo RAM host và bị OOMKilled ngay — một lớp sự cố kinh điển.

Cách đúng: **đọc từ cgroup, hoặc truyền giá trị qua biến môi trường.**

```bash
# cgroup v2
cat /sys/fs/cgroup/memory.max        # "536870912" hoặc "max"
cat /sys/fs/cgroup/cpu.max           # "50000 100000"
```

```yaml
# K8s: đưa limit vào env — đơn giản và rõ ràng nhất
env:
  - name: MEMORY_LIMIT_BYTES
    valueFrom: { resourceFieldRef: { resource: limits.memory } }
```

### Node.js: heap limit phải nhỏ hơn container limit

```text
Container limit  512 Mi
Node heap mặc định (V8)  tuỳ phiên bản và RAM thấy được
Bộ nhớ NGOÀI heap: Buffer, native module, stack, code  ← KHÔNG tính vào heap

⇒ heap 512 MB + external 100 MB = 612 MB > 512 Mi → OOMKilled
```

```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=384"   # ~75% của limit 512Mi
```

Lợi ích lớn nhất không phải tiết kiệm bộ nhớ, mà là **đổi chế độ hỏng**:

```text
Không đặt:  container OOMKilled → SIGKILL → không log, không stack trace
Có đặt:     V8 ném "JavaScript heap out of memory" → CÓ stack trace
```

Một lỗi có stack trace đáng giá hơn nhiều một exit code 137. Xem [Process & memory](../../02-backend-api/01-nodejs/production/01-process-memory.md).

### Exit code

```text
0    thoát bình thường
1    lỗi ứng dụng
137  128 + 9  = SIGKILL   → OOMKilled, hoặc hết grace period khi shutdown
143  128 + 15 = SIGTERM   → tắt bình thường theo yêu cầu
```

Phân biệt hai nguyên nhân của 137:

```bash
kubectl describe pod <pod> | grep -A3 'Last State'
# Reason: OOMKilled        → vượt memory limit
# Reason: Error            → SIGKILL vì lý do khác (thường là hết grace period)
```

## Example

Chẩn đoán OOMKilled đầy đủ:

```bash
# 1. Xác nhận
kubectl describe pod api-7f8b | grep -A5 'Last State'
#   Last State: Terminated
#     Reason: OOMKilled
#     Exit Code: 137

# 2. Giới hạn là bao nhiêu
kubectl get pod api-7f8b -o jsonpath='{.spec.containers[0].resources}'
#   {"limits":{"memory":"512Mi"},"requests":{"memory":"256Mi"}}

# 3. Nó dùng bao nhiêu TRƯỚC KHI chết (cần metric lịch sử — đây là lý do phải có)
#    Prometheus: container_memory_working_set_bytes

# 4. Trong container: bên trong là gì
kubectl exec api-7f8b -- cat /sys/fs/cgroup/memory.max        # 536870912
kubectl exec api-7f8b -- cat /sys/fs/cgroup/memory.current    # 498073600  ← sát trần
kubectl exec api-7f8b -- cat /sys/fs/cgroup/memory.events     # oom_kill 3

# 5. Node.js: heap hay external?
kubectl exec api-7f8b -- node -e "console.log(process.memoryUsage())"
#   { rss: 490M, heapUsed: 180M, external: 260M }   ← EXTERNAL lớn = Buffer
```

Bước 5 quyết định hướng sửa:

```text
heapUsed lớn      → rò rỉ trong JS (Map global, listener, closure)
external lớn      → Buffer không giải phóng → đang buffer thay vì STREAM
rss >> cả hai     → native module, hoặc phân mảnh
```

Với `external` lớn, `--max-old-space-size` **không** giúp — nó chỉ giới hạn heap. Vấn đề là code đang đọc file/response vào bộ nhớ thay vì stream. Xem [Streams & buffers](../../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md).

## Prediction

1. Container limit 512Mi, app dùng 600 MB — chuyện gì xảy ra? Có log không?
2. Exit code là bao nhiêu? Nó có nghĩa gì?
3. CPU limit 500m, app cần 1 CPU liên tục — bị giết hay bị chậm?
4. `nr_throttled / nr_periods = 40%` — triệu chứng người dùng thấy?
5. `os.cpus().length` trong container giới hạn 0,5 CPU trên host 32 core — trả về gì?
6. Thư viện tạo thread pool theo `os.cpus().length` trong tình huống trên — bao nhiêu thread? Hệ quả?
7. Không đặt `--max-old-space-size`, container limit 512Mi — chế độ hỏng?
8. Đặt `--max-old-space-size=384` — chế độ hỏng đổi thế nào?
9. `heapUsed` 180MB nhưng RSS 490MB, limit 512Mi — nguyên nhân? `--max-old-space-size` có giúp không?
10. CPU request 500m, limit không đặt, node còn rảnh — app dùng được bao nhiêu CPU?
11. Cùng cấu hình, node bị tranh chấp nặng — app được đảm bảo bao nhiêu?
12. Memory request 256Mi, limit 512Mi, app dùng 400MB ổn định — pod có bị giết không? Nó thuộc QoS class nào?
13. Đọc một file 2 GB bằng `fs.readFile` trong container 512Mi — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. Kernel OOM killer gửi **SIGKILL**. **Không có log nào từ ứng dụng** — SIGKILL không bắt được.
2. **137** = 128 + 9 (SIGKILL). Cần `kubectl describe` để biết `Reason: OOMKilled`.
3. **Bị chậm** (throttled). CPU nén được nên kernel bóp thay vì giết.
4. Latency p99 cao bất thường, trong khi CPU usage trung bình trông bình thường.
5. **32** — thông tin của host, không phải của cgroup.
6. 32 thread cho 0,5 CPU → context switching liên tục, throughput thấp hơn nhiều so với 1–2 thread.
7. V8 có thể đặt heap lớn hơn container limit → **OOMKilled, không stack trace**.
8. V8 ném `JavaScript heap out of memory` → **có stack trace** trước khi chết. Dễ chẩn đoán hơn nhiều.
9. `external` lớn (Buffer) hoặc native memory. `--max-old-space-size` **không giúp** — nó chỉ giới hạn heap.
10. **Nhiều hơn 500m** — không có limit thì không bị bóp; nó dùng CPU rảnh của node.
11. **Ít nhất 500m** — request là phần được đảm bảo khi tranh chấp.
12. **Không bị giết** (400 < 512). QoS **Burstable** (request ≠ limit) — nó bị evict trước pod Guaranteed khi node thiếu memory.
13. `fs.readFile` nạp **toàn bộ** 2 GB vào bộ nhớ → OOMKilled ngay. Phải dùng stream.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `docker run -m 100m` với app cấp phát 200MB | OOMKilled, exit 137, không log app |
| Xem `docker inspect <c> \| grep OOMKilled` | `true` |
| `--cpus=0.1` với vòng lặp bận, đo thời gian | Chậm gấp nhiều lần |
| `cat /sys/fs/cgroup/cpu.stat` trong container đó | `nr_throttled` cao |
| `os.cpus().length` và `os.totalmem()` trong container giới hạn | Số của host |
| Đọc `/sys/fs/cgroup/memory.max`, so sánh | Số thật của cgroup |
| Không đặt `--max-old-space-size`, làm app leak tới OOM | Exit 137, không stack |
| Đặt `--max-old-space-size` = 75% limit, lặp lại | `heap out of memory` có stack |
| Cấp phát Buffer lớn (`Buffer.alloc`) tới khi OOM với heap limit thấp | Vẫn OOMKilled — heap limit không chặn Buffer |
| `fs.readFile` file 1 GB trong container 256Mi | OOMKilled |
| Đổi sang `createReadStream` + `pipeline` | RSS ổn định |
| Đặt CPU limit rất thấp cho app đa luồng, đo p99 | Throttling rõ rệt |
| Bỏ CPU limit (giữ request), lặp lại | p99 cải thiện |

## What Usually Goes Wrong

- **Không đặt memory limit** → một leak làm chết cả node, ảnh hưởng mọi pod trên đó.
- **Memory limit quá sát** → OOMKilled ngẫu nhiên khi có đỉnh tải.
- **CPU limit quá chặt** → throttling im lặng, p99 cao, không ai nghĩ tới cgroup.
- **Không đặt CPU request** → pod không được đảm bảo gì khi node tranh chấp.
- **Không đặt `--max-old-space-size`** → OOMKilled không có stack trace.
- **Đặt `--max-old-space-size` = limit** (không phải 75%) → vẫn OOM vì bộ nhớ ngoài heap.
- **Thư viện tự đặt kích thước theo `os.cpus()`** → sai hoàn toàn trong container.
- **Không theo dõi `container_memory_working_set_bytes`** → không có dữ liệu lịch sử khi điều tra.
- **Không theo dõi `nr_throttled`** → throttling không bao giờ được phát hiện.
- **Nhầm request với limit** → cấu hình sai và không hiểu vì sao.
- **Đọc file lớn vào bộ nhớ** → OOM ở kích thước dữ liệu thật.
- **Tăng limit để "sửa" leak** → hoãn vấn đề, tốn tiền.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| OOMKilled là app crash | Kernel giết bằng SIGKILL; app không biết gì |
| Sẽ có log khi OOM | SIGKILL không bắt được; log duy nhất ở tầng orchestrator |
| Vượt CPU limit thì bị giết | Chỉ bị throttle |
| Request và limit gần như nhau | Request để schedule/chia phần; limit để giết/bóp |
| Container thấy tài nguyên của chính nó | Nhiều API trả số của host |
| `--max-old-space-size` giới hạn toàn bộ memory | Chỉ heap; Buffer và native không tính |
| RSS là con số kernel dùng để quyết định giết | Kernel dùng `memory.current` của cgroup (gồm cả page cache) |
| CPU limit luôn nên đặt | Với workload nhạy latency, request-không-limit thường tốt hơn |
| Memory limit có thể bỏ qua | Không — memory không nén được, leak giết cả node |
| Exit 137 luôn là OOM | Cũng có thể là hết grace period khi shutdown |

## Debugging

1. **Pod restart không rõ lý do** → `kubectl describe pod` → `Last State.Reason`. Đây luôn là bước đầu.
2. **`OOMKilled`** → so `limits.memory` với metric bộ nhớ lịch sử. Không có metric lịch sử thì bạn đang đoán.
3. **Trong container**: `cat /sys/fs/cgroup/memory.current`, `memory.max`, `memory.events`.
4. **Node.js**: `process.memoryUsage()` — phân biệt `heapUsed` / `external` / `rss`. Ba hướng sửa khác nhau.
5. **Chậm không rõ lý do, CPU trung bình thấp** → `cat /sys/fs/cgroup/cpu.stat`, xem `nr_throttled`.
6. **`kubectl top pod`** cho con số hiện tại; Prometheus cho lịch sử. Điều tra OOM cần lịch sử.
7. **Rò rỉ hay tải cao?** — bộ nhớ tăng đều không giảm kể cả khi tải thấp = rò rỉ. Tăng theo tải rồi giảm = bình thường.
8. **Heap snapshot** khi nghi rò rỉ JS: `kill -USR2 <pid>` (nếu đã cấu hình) hoặc `--heapsnapshot-signal`.

## Production Considerations

- **Luôn đặt memory limit.** Không có nó, một pod lỗi làm chết node và mọi pod khác trên đó.
- **Memory request = mức dùng bình thường; limit = đỉnh + biên an toàn 30–50%.**
- **`--max-old-space-size` ≈ 75% memory limit** cho Node.js — đổi chế độ hỏng từ SIGKILL sang lỗi có stack trace.
- **Cân nhắc bỏ CPU limit** (giữ request) cho service nhạy về latency; theo dõi `nr_throttled` để quyết định.
- **Đặt CPU request thực tế** — nó quyết định pod được schedule ở đâu và được đảm bảo bao nhiêu.
- **Alert trên `nr_throttled / nr_periods > 5%`** và trên `memory working set / limit > 80%`.
- **Giữ metric bộ nhớ ít nhất 7 ngày** — điều tra OOM cần biết nó tăng thế nào trước khi chết.
- **Đọc giới hạn từ cgroup hoặc từ env**, không dùng `os.totalmem()`/`os.cpus()` để cấu hình.
- **QoS class trong K8s** ảnh hưởng thứ tự bị evict: `Guaranteed` (request = limit) an toàn nhất, `BestEffort` (không đặt gì) bị evict đầu tiên.
- **Load test tới điểm gãy** để biết giới hạn thật, thay vì chọn số tròn.
- **Stream thay vì buffer** cho mọi dữ liệu có thể lớn — đây là cách sửa gốc cho phần lớn OOM.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Memory limit chặt | phát hiện leak sớm, mật độ pod cao | OOMKilled khi có đỉnh |
| Memory limit rộng | ít restart | lãng phí, leak lộ muộn |
| Không memory limit | không bao giờ OOMKilled | một pod giết cả node |
| CPU limit | công bằng, dự đoán được | throttling, p99 xấu |
| Không CPU limit (có request) | p99 tốt, tận dụng CPU rảnh | pod khác có thể chậm hơn dự kiến |
| Request = limit (Guaranteed) | ổn định, không bị evict sớm | tốn tài nguyên, mật độ thấp |
| Request < limit (Burstable) | mật độ cao, chịu được đỉnh | bị evict trước, hành vi khó đoán hơn |
| `--max-old-space-size` thấp | lỗi có stack, không OOMKilled | GC chạy nhiều hơn |
| `--max-old-space-size` cao/không đặt | ít GC | OOMKilled im lặng |

## Explain Without Notes

1. Vì sao OOMKilled không có log từ ứng dụng?
2. Vì sao vượt memory thì bị giết còn vượt CPU thì chỉ bị chậm?
3. Request và limit khác nhau thế nào, cho cả CPU và memory?
4. CPU throttling gây triệu chứng gì, và kiểm tra bằng lệnh nào?
5. Vì sao container thấy sai số CPU/RAM, và hậu quả cụ thể?
6. Vì sao đặt `--max-old-space-size` = 75% limit, không phải 100%?
7. `heapUsed` nhỏ nhưng RSS lớn — nguyên nhân và hướng sửa?
8. Exit 137 có hai nguyên nhân — phân biệt thế nào?

## Related

- [Process, file & env](01-process-files-env.md) — process, `/proc`
- [Signals & lifecycle](04-signals-lifecycle.md) — SIGKILL, exit code
- [Debugging toolbox](07-debugging-toolbox.md) — công cụ quan sát
- [Process & memory (Node.js)](../../02-backend-api/01-nodejs/production/01-process-memory.md) — heap vs external
- [Streams & buffers](../../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md) — cách sửa gốc cho OOM
- [Worker threads & CPU](../../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) — CPU-bound và throttling
- [Scheduling & resources (K8s)](../04-kubernetes/scheduling-reliability/02-scheduling-resources.md) — request/limit và QoS
- [Image & container](../02-docker/01-image-container.md) — cgroup từ phía Docker
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md) — tài nguyên hữu hạn

## Version / Context

cgroup v2 (mặc định trên các bản phân phối Linux hiện đại và Kubernetes 1.25+). Đường dẫn cgroup v1 khác: `/sys/fs/cgroup/memory/memory.limit_in_bytes`, `/sys/fs/cgroup/cpu/cpu.cfs_quota_us`. Node.js 18+ tôn trọng cgroup memory cho heap mặc định, nhưng `os.totalmem()`/`os.cpus()` vẫn trả số của host.
