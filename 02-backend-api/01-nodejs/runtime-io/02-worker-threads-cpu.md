---
level: advanced
area: backend
prerequisites:
  - ../fundamentals/01-runtime-concurrency.md
related:
  - ../production/01-process-memory.md
  - ../../../03-database/04-message-queues/01-why-queue.md
---

# Worker threads & CPU-bound work

> Worker thread là lựa chọn **thứ ba**, không phải thứ nhất. Trước khi thêm nó, hãy hỏi: việc này có cần làm trong request không, và database có làm tốt hơn không?

## Position

```text
Request → main thread (event loop)
             ├→ worker_threads   (song song trong CÙNG process)
             ├→ child process    (process riêng)
             └→ queue + worker   (máy khác, thời điểm khác)   ← thường đúng nhất
```

## Problem

Một endpoint tạo báo cáo: đọc 200.000 dòng, tính toán, sinh PDF. Mất 8 giây CPU.

Trong Node, 8 giây CPU nghĩa là 8 giây **mọi** request khác bị chặn — kể cả `/health`. Load balancer đánh dấu instance chết, traffic dồn sang instance khác, chúng cũng nhận request báo cáo, và cũng chết. Đây là cascading failure do một tính năng ít dùng.

Nhưng phản xạ "dùng worker_threads" thường là câu trả lời sai. Bốn lựa chọn, và worker thread chỉ đúng trong một trường hợp hẹp.

## Mental Model

Thứ tự nên thử, từ rẻ nhất tới đắt nhất:

```text
1. KHÔNG LÀM VIỆC ĐÓ TRONG REQUEST      → queue + worker riêng
   → request trả 202 + job id, client poll hoặc nhận webhook
   → scale worker độc lập, retry được, không ảnh hưởng API

2. ĐỂ DATABASE LÀM                      → SQL aggregate, window function
   → PostgreSQL sort/group/aggregate nhanh hơn JS rất nhiều
   → dữ liệu không phải đi qua network

3. WORKER THREADS                        → khi PHẢI làm trong process này
   → và kết quả cần ngay trong request
   → và dữ liệu vào/ra nhỏ

4. CHIA NHỎ + YIELD                      → khi không tách được
   → không nhanh hơn, chỉ không chặn
```

Lựa chọn 1 đúng cho phần lớn báo cáo, export, xử lý ảnh, gửi email. Lựa chọn 2 đúng cho gần như mọi tính toán trên dữ liệu đã có trong database.

Worker thread chỉ thắng khi: kết quả cần **ngay** trong response, việc thuần CPU, và payload nhỏ (vì dữ liệu phải được copy hoặc chuyển giữa thread).

## How It Works

### Chi phí thật của worker thread

```text
Khởi tạo worker      ~10–40ms + ~10MB RAM mỗi worker
Truyền dữ liệu       structuredClone → COPY (tốn thời gian theo kích thước)
                     ArrayBuffer transfer → zero-copy nhưng mất quyền ở phía gửi
                     SharedArrayBuffer → chia sẻ thật, cần Atomics để đồng bộ
```

Vì chi phí khởi tạo cao, **tạo worker cho mỗi request là phản tác dụng**. Cần một pool.

```ts
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

type Job<T, R> = { data: T; resolve: (r: R) => void; reject: (e: Error) => void };

class WorkerPool<T, R> {
  private idle: Worker[] = [];
  private queue: Job<T, R>[] = [];
  private busy = new Map<Worker, Job<T, R>>();

  constructor(private file: string, size = Math.max(1, availableParallelism() - 1)) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn() {
    const w = new Worker(this.file);

    w.on('message', (r: R) => {
      this.busy.get(w)?.resolve(r);
      this.release(w);
    });

    w.on('error', (e) => {
      this.busy.get(w)?.reject(e);
      this.busy.delete(w);
      w.terminate();
      this.spawn();                        // worker chết → tạo lại
    });

    this.idle.push(w);
  }

  private release(w: Worker) {
    this.busy.delete(w);
    const next = this.queue.shift();
    if (next) this.assign(w, next);
    else this.idle.push(w);
  }

  private assign(w: Worker, job: Job<T, R>) {
    this.busy.set(w, job);
    w.postMessage(job.data);
  }

  run(data: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const job = { data, resolve, reject };
      const w = this.idle.pop();
      if (w) this.assign(w, job);
      else this.queue.push(job);           // hàng đợi có giới hạn? xem Production
    });
  }

  async destroy() {
    await Promise.all([...this.idle, ...this.busy.keys()].map(w => w.terminate()));
  }
}
```

```ts
// worker.ts
import { parentPort } from 'node:worker_threads';

parentPort!.on('message', (data: Input) => {
  try {
    parentPort!.postMessage(computeHeavy(data));
  } catch (e) {
    // Ném để 'error' handler ở pool bắt được
    throw e instanceof Error ? e : new Error(String(e));
  }
});
```

Bốn chi tiết quyết định pool dùng được trong production:

1. **Pool size** = `availableParallelism() - 1`, để lại một core cho main thread. Nhiều worker hơn số core chỉ tạo context switch.
2. **Worker chết phải được tạo lại** — một exception không bắt được trong worker sẽ giết nó.
3. **Hàng đợi phải có trần** — không có trần, tải cao làm queue phình và OOM. Đây là một dạng thiếu [backpressure](../../../05-cross-cutting/performance/06-backpressure.md).
4. **`destroy()` trong graceful shutdown** — worker không tự thoát. Xem [Graceful shutdown](../production/02-graceful-shutdown.md).

### Truyền dữ liệu — nơi lợi ích bị mất

```ts
// ❌ Copy 100MB sang worker, copy 100MB về → chi phí copy > lợi ích song song
pool.run({ rows: hundredMBofData });

// ✅ Worker tự đọc dữ liệu (từ DB/file), chỉ trả kết quả nhỏ
pool.run({ reportId: '42', from: '2026-01-01', to: '2026-08-27' });

// ✅ Zero-copy khi dữ liệu là binary
const buf = new ArrayBuffer(50 * 1024 * 1024);
worker.postMessage(buf, [buf]);      // transfer: buf KHÔNG dùng được ở đây nữa
```

Nguyên tắc: **truyền tham số, không truyền dữ liệu.** Nếu bạn phải copy nhiều MB qua boundary, worker thread thường không đáng.

### `worker_threads` vs `child_process`

| | `worker_threads` | `child_process` |
|---|---|---|
| Khởi tạo | ~10–40ms | ~50–200ms |
| Memory | ~10MB (chia sẻ V8 platform) | full process (~40MB+) |
| Chia sẻ memory | được (`SharedArrayBuffer`) | không |
| Cách ly lỗi | crash worker **không** giết process | crash không ảnh hưởng cha |
| Chạy ngôn ngữ khác | không | có (`spawn('python')`) |
| Phù hợp | CPU-bound JS, cần kết quả nhanh | công cụ ngoài, cần cách ly mạnh |

Chọn `child_process` khi cần chạy binary ngoài (ffmpeg, imagemagick) hoặc khi việc đó có thể crash và bạn muốn cách ly tuyệt đối.

### Chia nhỏ + yield — khi không tách được

```ts
async function processMany(items: Item[]) {
  const out: Result[] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(process(items[i]));
    if ((i & 0xff) === 0) await new Promise(r => setImmediate(r));   // mỗi 256 item
  }
  return out;
}
```

Cách này **không** làm tổng thời gian ngắn hơn — nó dài hơn một chút. Nhưng event loop được nhường, nên health check và request khác vẫn được xử lý. Với nhiều trường hợp, đó chính là điều cần.

## Example

```ts
// Lựa chọn 1 (thường đúng nhất): đưa ra khỏi request
@Post('reports')
@HttpCode(202)
async createReport(@Body() dto: CreateReportDto, @CurrentUser() user: User) {
  const job = await this.queue.add('generate-report', {
    userId: user.id, ...dto,
  }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });

  return { jobId: job.id, status: 'queued', statusUrl: `/reports/jobs/${job.id}` };
}
```

Request trả về trong vài ms. Worker chạy trên pod riêng, scale độc lập, retry được, và một báo cáo lỗi không ảnh hưởng API. Xem [Vì sao cần queue](../../../03-database/04-message-queues/01-why-queue.md).

## Prediction

1. Tạo `new Worker()` cho mỗi request, 100 request/giây — điều gì xảy ra?
2. Pool size = 32 trên máy 4 core, tải CPU cao — nhanh hơn pool size 3?
3. Copy 100MB sang worker, tính toán 200ms, copy 100MB về — nhanh hơn làm trên main thread?
4. Worker throw exception không bắt, không có handler `'error'` — pool còn worker đó không?
5. Hàng đợi pool không có trần, 10.000 job đến trong 1 giây — memory?
6. Việc CPU 8 giây chia nhỏ + yield — tổng thời gian ngắn hơn không? `/health` thế nào?
7. Không gọi `terminate()` khi shutdown — process thoát không?
8. `SharedArrayBuffer` ghi từ hai thread không dùng `Atomics` — kết quả?

<details>
<summary>Đáp án</summary>

1. ~1–4 giây/giây chỉ để khởi tạo worker + ~1GB RAM → tệ hơn không dùng worker.
2. Không — chỉ thêm context switch; song song thật bị giới hạn bởi số core.
3. Thường **chậm hơn** — chi phí copy 200MB lớn hơn lợi ích.
4. Không — worker chết và pool mất một slot vĩnh viễn.
5. Tăng không giới hạn → OOM.
6. Tổng thời gian dài hơn chút; `/health` vẫn phản hồi.
7. Không — worker giữ process sống; đây là nguyên nhân "pod không chịu tắt".
8. Data race — kết quả không xác định. Đây là loại bug mà mô hình một thread của Node vốn giúp bạn tránh.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Vòng lặp CPU 8s trong handler, gọi `/health` song song | Health check timeout → cascading failure |
| Tạo worker mỗi request | Đo thời gian và RSS — tệ hơn không dùng |
| Pool size 32 trên 4 core | So throughput với pool size 3 |
| Copy 100MB qua boundary | Đo: chi phí copy vs lợi ích |
| Worker throw, không có `'error'` handler | Pool cạn dần sau vài lỗi |
| Bỏ trần hàng đợi, gửi burst lớn | RSS tăng không giới hạn |
| Không `terminate()` khi SIGTERM | Process treo tới `terminationGracePeriodSeconds` → exit 137 |
| `SharedArrayBuffer` + 2 thread ghi không `Atomics` | Kết quả sai không xác định |
| Đưa việc đó vào queue thay vì worker | So p99 latency của API trước/sau |

## What Usually Goes Wrong

- **Dùng worker thread khi việc đó nên vào queue** — thêm phức tạp trong process mà không giải quyết vấn đề scale.
- **Tạo worker cho mỗi request** thay vì dùng pool.
- **Pool size > số core**.
- **Copy nhiều dữ liệu** qua boundary → mất hết lợi ích.
- **Không tạo lại worker chết** → pool cạn dần.
- **Hàng đợi không có trần** → OOM dưới tải.
- **Không `terminate()`** khi shutdown → process không thoát.
- **Tính toán trong JS thay vì SQL** — database thường nhanh hơn nhiều bậc.
- **`SharedArrayBuffer` không có `Atomics`** → data race, đúng loại bug mà Node vốn tránh được.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Worker thread là cách sửa mặc định cho CPU-bound | Là lựa chọn thứ ba; queue và database thường tốt hơn |
| Nhiều worker = nhanh hơn | Giới hạn bởi số core |
| Truyền dữ liệu giữa thread là miễn phí | `structuredClone` là copy thật |
| Worker chia sẻ biến với main thread | Không, trừ `SharedArrayBuffer` |
| Worker crash làm sập process | Không — nhưng bạn phải xử lý và tạo lại |
| `worker_threads` cho I/O | I/O đã async; worker chỉ cho CPU |
| Chia nhỏ + yield làm nhanh hơn | Nó chỉ nhường event loop, tổng thời gian dài hơn |

## Debugging

1. **Xác nhận đúng là CPU-bound**: đo [event loop lag](../fundamentals/01-runtime-concurrency.md). Lag cao + CPU cao = CPU-bound. Lag cao + CPU thấp = blocking I/O đồng bộ.
2. **Tìm hàm chặn**: `node --cpu-prof` → flamegraph. Hàm rộng nhất là thủ phạm. Đừng đoán.
3. **Đo trước khi thêm worker**: nếu tính toán chỉ 20ms, worker (10–40ms khởi tạo + copy) làm chậm hơn.
4. **Worker "không làm gì"** → kiểm tra `'error'` và `'exit'` handler; lỗi trong worker im lặng nếu không lắng nghe.
5. **Process không thoát** → `process._getActiveHandles()` trong dev, hoặc kiểm tra đã `terminate()` worker chưa.
6. **So sánh ba phương án** trên cùng workload: main thread, worker pool, queue. Số liệu thường bất ngờ.

## Production Considerations

- **Ưu tiên queue.** Nó cho bạn retry, observability, scale độc lập, và không rủi ro cho API. Worker thread không cho gì trong số đó.
- **Nếu dùng worker: pool có size cố định, có trần hàng đợi, có tạo lại worker chết, có `destroy()` trong shutdown.**
- **Timeout cho mỗi job** — worker treo phải bị `terminate()`.
- **Truyền tham số, không truyền dữ liệu.**
- **Đo event loop lag** như metric hạng nhất; nó xác nhận worker có thật sự giúp.
- **Tách endpoint nặng sang service/pod riêng** nếu chúng dùng chung API — blast radius nhỏ hơn.
- Cân nhắc `child_process` khi cần công cụ ngoài (ffmpeg) hoặc cách ly mạnh.

## Trade-offs

| Cách | Được | Mất |
|---|---|---|
| Queue + worker riêng | scale độc lập, retry, không ảnh hưởng API | eventual result, cần hạ tầng queue |
| Để database làm | nhanh nhất, dữ liệu không di chuyển | logic nằm trong SQL, khó test hơn |
| Worker thread pool | kết quả trong request, song song thật | chi phí copy, quản lý pool, phức tạp |
| `child_process` | cách ly mạnh, chạy binary ngoài | khởi tạo và memory tốn hơn |
| Chia nhỏ + yield | đơn giản nhất, không dependency | không nhanh hơn, chỉ không chặn |

## Explain Without Notes

1. Bốn lựa chọn xử lý CPU-bound theo thứ tự nên thử, và lý do thứ tự đó?
2. Ba điều kiện để worker thread là lựa chọn đúng?
3. Vì sao "truyền tham số, không truyền dữ liệu"?
4. Bốn chi tiết bắt buộc của một worker pool production?
5. `worker_threads` khác `child_process` ở ba điểm nào?

## Related

- [Node runtime & concurrency](../fundamentals/01-runtime-concurrency.md) — vì sao CPU-bound chặn tất cả
- [Process & memory](../production/01-process-memory.md) — memory của worker
- [Graceful shutdown](../production/02-graceful-shutdown.md) — `terminate()` worker
- [Vì sao cần queue](../../../03-database/04-message-queues/01-why-queue.md) — lựa chọn thứ nhất
- [Backpressure](../../../05-cross-cutting/performance/06-backpressure.md) — trần hàng đợi
- [Concurrency models](../../../05-cross-cutting/concurrency/01-concurrency-models.md) — so sánh các mô hình
- [Window functions](../../../03-database/00-sql/04-window-functions.md) — để database tính
