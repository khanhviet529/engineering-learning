---
level: foundation
area: backend
prerequisites:
  - ../../01-web-frontend/01-javascript-typescript/01-event-loop-async.md
related:
  - 04-worker-threads-cpu.md
  - ../../05-cross-cutting/concurrency/01-concurrency-models.md
---

# Node runtime & concurrency

> Một thread xử lý 10.000 kết nối đồng thời. Cùng một thread bị một vòng lặp `for` 3 giây làm đứng hoàn toàn. Hiểu vì sao cả hai đều đúng là hiểu Node.js.

## Position

```text
OS socket → libuv (thread pool + event loop) → V8 (JS, MỘT thread) → code của bạn
                        ↑ note này
```

## Problem

Bạn có một endpoint tính toán hash mật khẩu hoặc resize ảnh:

```ts
@Get('/report')
getReport() {
  const data = heavyComputation();     // 3 giây CPU
  return data;
}
```

Kết quả trong production: **mọi** request khác — kể cả `/health` — cũng chờ 3 giây. Health check timeout, load balancer đánh dấu instance là chết, traffic dồn sang instance khác, và chúng cũng chết theo.

Ngược lại, một endpoint chờ database 3 giây **không** gây vấn đề gì: hàng nghìn request khác vẫn được xử lý bình thường.

Khác biệt giữa hai trường hợp là toàn bộ nội dung của note này: **I/O-bound vs CPU-bound**.

## Mental Model

```text
┌─────────────────────────────────────────────────────────┐
│  MỘT thread chạy JavaScript (V8)                        │
│  → code của bạn KHÔNG BAO GIỜ chạy song song với chính nó│
│  → không có data race trong một tick                     │
│  → một task nặng chặn TẤT CẢ                             │
└─────────────────────────────────────────────────────────┘
              ↕ libuv điều phối
┌─────────────────────────────────────────────────────────┐
│  Thread pool (mặc định 4) — cho việc KHÔNG async ở OS   │
│  → filesystem, DNS lookup, crypto (pbkdf2, scrypt), zlib│
│                                                          │
│  Async ở tầng OS (epoll/kqueue/IOCP) — KHÔNG dùng pool  │
│  → network socket: TCP, HTTP, database, Redis            │
└─────────────────────────────────────────────────────────┘
```

Phân biệt quan trọng nhất:

```text
I/O-bound  (chờ mạng, chờ disk)
  → thread rảnh trong lúc chờ → xử lý được request khác
  → Node RẤT tốt ở đây

CPU-bound  (tính toán, JSON lớn, sort, hash đồng bộ, regex)
  → thread bị chiếm → không ai được xử lý
  → Node RẤT tệ ở đây
```

Và điều bất ngờ với nhiều người: **network I/O không dùng thread pool.** Nó dùng epoll/kqueue của OS. Chỉ filesystem, DNS (`dns.lookup`), một số hàm crypto và zlib mới dùng pool 4 thread.

Hệ quả: nếu bạn đọc 100 file cùng lúc, chỉ 4 việc chạy thật, 96 việc xếp hàng. Nhưng nếu bạn gọi 100 HTTP request cùng lúc, cả 100 đều đang bay.

## How It Works

### Các phase của event loop

```text
   ┌──────────────────────────┐
┌─→│  timers                  │  setTimeout, setInterval đã đến hạn
│  ├──────────────────────────┤
│  │  pending callbacks       │  một số callback I/O bị hoãn
│  ├──────────────────────────┤
│  │  idle, prepare           │  nội bộ
│  ├──────────────────────────┤
│  │  poll                    │  ← CHỜ Ở ĐÂY: nhận I/O mới
│  ├──────────────────────────┤
│  │  check                   │  setImmediate
│  ├──────────────────────────┤
└──│  close callbacks         │  socket.on('close')
   └──────────────────────────┘

Giữa MỖI phase: làm cạn process.nextTick queue, rồi Promise microtask queue
```

Thứ tự ưu tiên khi có nhiều loại callback chờ:

```text
process.nextTick  →  Promise microtask  →  phase hiện tại
```

`process.nextTick` có ưu tiên cao hơn cả Promise. Đệ quy `nextTick` làm event loop **không bao giờ** tiến sang phase tiếp — treo hoàn toàn, và khó chẩn đoán hơn một vòng lặp `while` vì CPU không nhất thiết 100%.

### Event loop lag — metric quan trọng nhất

```ts
import { monitorEventLoopDelay } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  const p99 = h.percentile(99) / 1e6;         // nanosecond → millisecond
  metrics.gauge('event_loop_lag_p99_ms', p99);
  h.reset();
}, 10_000);
```

Đọc chỉ số này:

| Lag p99 | Nghĩa |
|---|---|
| < 10ms | khoẻ |
| 10–50ms | có tải, còn ổn |
| 50–200ms | request đang xếp hàng; latency tăng |
| > 200ms | có việc CPU-bound đang chặn; health check sẽ timeout |

Đây là metric mà mọi Node service nên có. Nó phát hiện vấn đề mà CPU usage không phát hiện được: CPU 60% với lag 500ms nghĩa là bạn có một task đồng bộ dài, không phải thiếu CPU.

### Thread pool size

```bash
UV_THREADPOOL_SIZE=8 node server.js     # mặc định 4, tối đa 1024
```

Tăng pool giúp khi bạn làm nhiều filesystem/crypto/zlib. **Không** giúp cho network I/O (không dùng pool) và **không** giúp cho code JS (một thread).

Một sai lầm phổ biến: tăng `UV_THREADPOOL_SIZE` để "làm Node nhanh hơn" khi bottleneck là CPU-bound JavaScript. Nó không có tác dụng gì.

### Xử lý CPU-bound

Bốn lựa chọn, theo thứ tự nên thử:

```text
1. Đưa việc ra khỏi request     → queue + worker process   ← thường đúng nhất
2. Đưa xuống database           → SQL làm sort/aggregate tốt hơn JS
3. worker_threads               → khi phải làm trong process này
4. Chia nhỏ + yield             → khi không tách được
```

```ts
// 4. Chia nhỏ để nhường event loop
async function processMany(items: Item[]) {
  for (let i = 0; i < items.length; i++) {
    process(items[i]);
    if (i % 100 === 0) await new Promise(r => setImmediate(r));   // nhường
  }
}
```

Cách 4 không làm tổng thời gian ngắn hơn — nó chỉ giữ cho các request khác được xử lý. Đó thường là điều bạn cần.

Chi tiết: [Worker threads & CPU](04-worker-threads-cpu.md).

### Cluster — dùng hết CPU

```ts
// Một process Node dùng MỘT core. Máy 8 core → 7 core rảnh.
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

if (cluster.isPrimary) {
  for (let i = 0; i < availableParallelism(); i++) cluster.fork();
  cluster.on('exit', () => cluster.fork());       // restart worker chết
} else {
  startServer();
}
```

Trong Kubernetes, thường **không** dùng cluster: chạy nhiều pod, mỗi pod một process. Lý do: scheduler và metric của K8s hoạt động ở mức pod, và một pod một process dễ quan sát hơn. Xem [Scheduling & resources](../../04-infrastructure/04-kubernetes/05-scheduling-resources.md).

## Example

```ts
// ❌ CPU-bound trong handler — chặn mọi request
app.get('/hash', (req, res) => {
  const hash = crypto.pbkdf2Sync(req.query.pw, 'salt', 600_000, 64, 'sha512');
  res.json({ hash: hash.toString('hex') });
});

// ✅ Bản async dùng thread pool — không chặn event loop
app.get('/hash', async (req, res) => {
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.pbkdf2(req.query.pw, 'salt', 600_000, 64, 'sha512',
      (err, key) => err ? reject(err) : resolve(key)));
  res.json({ hash: hash.toString('hex') });
});
```

Chú ý: bản async vẫn chiếm **một thread trong pool 4**. Bốn request đồng thời làm cạn pool, và request thứ năm phải chờ — cùng với mọi filesystem operation khác. Với hash mật khẩu ở tải cao, giải pháp đúng là tăng pool size và/hoặc giới hạn concurrency.

## Prediction

1. Handler có `while (Date.now() - t < 3000) {}`. Trong 3 giây đó, `/health` trả về sau bao lâu?
2. Handler `await db.query()` mất 3 giây. Trong 3 giây đó, `/health` thế nào?
3. `fs.readFileSync` cho 100 file trong một handler — event loop lag?
4. `fs.readFile` (async) cho 100 file cùng lúc, pool = 4 — bao nhiêu chạy thật?
5. 100 HTTP request cùng lúc bằng `fetch` — bao nhiêu đang bay?
6. Đệ quy `process.nextTick` — CPU usage bao nhiêu? Event loop có tiến không?
7. Máy 8 core, một process Node, tải CPU cao — bao nhiêu core được dùng?
8. `UV_THREADPOOL_SIZE=64` cho một app chỉ gọi HTTP và Postgres — nhanh hơn không?

<details>
<summary>Đáp án</summary>

1. Sau ~3 giây — event loop bị chặn.
2. Bình thường, vài ms.
3. Lag rất cao — `readFileSync` chặn thread chính, không dùng pool.
4. 4 chạy thật, 96 xếp hàng.
5. Cả 100 — network không dùng pool.
6. CPU 100% và event loop **không bao giờ** tiến sang phase khác.
7. Một.
8. Không — cả hai đều không dùng thread pool.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Vòng lặp CPU 3s trong handler, gọi `/health` song song | Health check timeout → LB đánh dấu instance chết |
| `JSON.parse` chuỗi 100MB | Event loop lag hàng giây; đo bằng `monitorEventLoopDelay` |
| `fs.readFileSync` trong handler | So lag với bản async |
| `readFile` async 100 file, pool 4 | Đo thời gian; tăng `UV_THREADPOOL_SIZE=16` và đo lại |
| `pbkdf2` đồng bộ vs async, 10 request song song | So event loop lag |
| Đệ quy `process.nextTick` | Process không phản hồi; `SIGTERM` cũng không được xử lý |
| Đệ quy `setImmediate` | Vẫn phản hồi — nó nhường giữa các vòng |
| Tải CPU cao trên máy 8 core, một process | `top` cho thấy ~100% (một core), không phải 800% |
| Thêm cluster | Dùng được nhiều core |

Thí nghiệm 6 và 7 cạnh nhau cho thấy sự khác biệt thật giữa `nextTick` và `setImmediate`.

## What Usually Goes Wrong

- **CPU-bound trong request handler** → chặn mọi request, health check timeout, cascading failure.
- **Hàm `*Sync`** (`readFileSync`, `pbkdf2Sync`, `execSync`) trong đường xử lý request.
- **`JSON.parse`/`JSON.stringify` payload lớn** — đồng bộ và đắt hơn nhiều người nghĩ.
- **Regex catastrophic backtracking** — một regex xấu với input thù địch chặn event loop vô thời hạn (ReDoS).
- **Không đo event loop lag** → không biết vấn đề tồn tại.
- **Tăng `UV_THREADPOOL_SIZE`** khi bottleneck là JS.
- **Một process trên máy nhiều core** → dùng 1/N năng lực.
- **`sort`/`filter`/`map` trên mảng rất lớn** trong handler.
- **Đệ quy `nextTick`** → treo hoàn toàn, khó chẩn đoán.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Node là multi-threaded | JS chạy một thread; libuv có pool cho một số việc I/O |
| `async` làm code chạy song song | Chỉ giúp với I/O; CPU-bound vẫn chặn |
| Network I/O dùng thread pool | Không — dùng epoll/kqueue của OS |
| Tăng thread pool luôn giúp | Chỉ cho fs/dns/crypto/zlib |
| Node không phù hợp cho app lớn | Rất phù hợp cho I/O-bound; sai chỗ là CPU-bound |
| CPU 100% nghĩa là cần thêm CPU | Có thể là một task đồng bộ dài; xem event loop lag |
| `setImmediate` và `nextTick` như nhau | `nextTick` ưu tiên cao hơn và không nhường phase |
| Một process dùng hết máy | Một process = một core cho JS |

## Debugging

1. **Đo event loop lag trước tiên.** Nếu lag cao, vấn đề là code đồng bộ, không phải thiếu tài nguyên. Đây là bước quan trọng nhất và hay bị bỏ.
2. **Tìm code chặn** → `node --cpu-prof` hoặc `clinic doctor`/`0x` để có flamegraph. Hàm rộng nhất là thủ phạm.
3. **`grep -rn "Sync(" src/`** → danh sách hàm đồng bộ; kiểm tra cái nào nằm trong đường request.
4. **Latency tăng đều theo tải nhưng CPU không cao** → nghi thread pool cạn (fs/crypto) hoặc connection pool cạn (DB). Xem [Connection pool](../../03-database/01-postgresql/03-connection-pool.md).
5. **Process không phản hồi** → `kill -SIGUSR1 <pid>` để bật inspector, rồi kết nối DevTools; hoặc dùng `node --inspect` từ đầu.
6. **So sánh CPU usage và event loop lag** — hai chỉ số này cùng nhau cho biết vấn đề là năng lực hay là blocking.

## Production Considerations

- **Event loop lag là metric hạng nhất**, cùng với p99 latency và error rate. Alert khi p99 lag > 100ms.
- **Không có việc CPU-bound trong request handler.** Đưa vào queue hoặc worker.
- **Timeout ở mọi outbound call** — không có nó, một dependency chậm giữ tài nguyên vô hạn.
- **Giới hạn concurrency** cho việc dùng thread pool (crypto, fs) — nếu không, pool cạn và mọi thứ chậm.
- **Nhiều pod thay vì cluster** trong Kubernetes; giới hạn CPU/memory ở mức pod.
- **Graceful shutdown** để không mất request khi deploy. Xem [Graceful shutdown](05-graceful-shutdown.md).
- **Giới hạn kích thước body** — `JSON.parse` một request 100MB là DoS.
- **Bảo vệ khỏi ReDoS**: giới hạn độ dài input, tránh regex có nested quantifier.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Một thread + async I/O | đơn giản (không lock, không data race), scale tốt với I/O | một task nặng chặn tất cả |
| Cluster | dùng nhiều core trong một container | quản lý process, memory nhân lên |
| Nhiều pod | quan sát dễ, scheduler K8s quản lý | overhead container |
| Worker threads | song song trong process | serialize dữ liệu, phức tạp |
| Queue + worker riêng | request nhanh, chịu tải đột biến | eventual consistency, thêm hạ tầng |
| Tăng thread pool | nhiều fs/crypto song song | tốn memory, không giúp JS |

## Explain Without Notes

1. Vì sao Node xử lý được 10.000 kết nối nhưng đứng vì một vòng lặp 3 giây?
2. Phân biệt I/O-bound và CPU-bound, cho ví dụ mỗi loại.
3. Network I/O có dùng thread pool không? Cái gì dùng?
4. Event loop lag cho biết điều gì mà CPU usage không cho biết?
5. Bốn cách xử lý CPU-bound, theo thứ tự nên thử?

## Related

- [Event loop & async](../../01-web-frontend/01-javascript-typescript/01-event-loop-async.md) — cơ chế nền
- [Worker threads & CPU](04-worker-threads-cpu.md) — song song thật
- [Streams & buffers](02-streams-buffers.md) — xử lý dữ liệu lớn không chặn
- [Process & memory](03-process-memory.md) — giới hạn heap
- [Graceful shutdown](05-graceful-shutdown.md)
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — một loại cạn tài nguyên khác
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md) — so với thread và distributed
- [Latency & throughput](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md)
