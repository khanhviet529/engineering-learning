---
level: intermediate
area: cross-cutting
related:
  - 02-shared-state-races.md
  - ../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md
---

# Concurrency models

> Một team chuyển một service xử lý ảnh từ Node.js sang worker threads vì "Node đơn luồng nên chậm". Sau khi chuyển, throughput tăng 3 lần — đúng như mong đợi. Nhưng một service khác, chỉ gọi database và API, cũng được chuyển theo "cho nhất quán". Nó chậm đi 15% và tốn gấp đôi bộ nhớ. **Cùng một mô hình đồng thời, hai kết quả ngược nhau — vì hai loại công việc khác nhau.**

## Position

```text
Concurrency  NHIỀU VIỆC ĐANG DIỄN RA — không nhất thiết cùng lúc
Parallelism  NHIỀU VIỆC CHẠY CÙNG LÚC — cần nhiều lõi

Một người pha cà phê trong lúc chờ bánh mì nướng   → concurrency
Hai người, mỗi người làm một việc                   → parallelism
```

Nhầm hai khái niệm này là gốc của phần lớn quyết định sai về mô hình đồng thời.

## Problem

```text
Việc chờ và việc tính toán có bản chất khác nhau:

  I/O-BOUND   phần lớn thời gian CHỜ (mạng, đĩa, DB)
              → CPU rảnh trong lúc chờ
              → cần concurrency: xử lý việc khác trong lúc chờ

  CPU-BOUND   phần lớn thời gian TÍNH
              → CPU bận liên tục
              → cần parallelism: nhiều lõi làm cùng lúc

Chọn nhầm mô hình = tốn tài nguyên mà không nhanh hơn, hoặc chậm hơn.
```

## Mental Model

### Bốn mô hình

```text
① MULTI-PROCESS
   mỗi việc một process, bộ nhớ RIÊNG
   + cô lập tốt, một process chết không kéo cái khác
   − tốn bộ nhớ, giao tiếp qua IPC đắt
   → nginx, PostgreSQL, Node cluster

② MULTI-THREAD
   nhiều luồng, bộ nhớ CHUNG
   + nhẹ hơn process, chia sẻ dữ liệu dễ
   − RACE CONDITION, lock, deadlock
   → Java, Go (goroutine là luồng nhẹ), .NET

③ EVENT LOOP (async I/O)
   MỘT luồng, chuyển việc khi gặp I/O
   + rất hiệu quả với I/O, không race trong JS
   − việc CPU nặng chặn tất cả
   → Node.js, nginx, Redis

④ ACTOR / CSP
   đơn vị độc lập giao tiếp bằng THÔNG ĐIỆP, không chia sẻ bộ nhớ
   + không race theo thiết kế
   − thay đổi cách viết code
   → Erlang/Elixir, Go channel, Akka
```

### Vì sao event loop hiệu quả với I/O

```text
Xử lý 1000 request, mỗi cái chờ DB 50ms:

MỘT LUỒNG CHẶN     1000 × 50ms = 50 giây (tuần tự)
1000 LUỒNG          ~50ms, nhưng 1000 × ~1MB stack = 1 GB, cộng context switch
EVENT LOOP          ~50ms, một luồng, vài MB
                    → trong lúc chờ, nó xử lý request khác
```

```text
Nhưng cùng phép tính với việc CPU 50ms mỗi request:
EVENT LOOP          1000 × 50ms = 50 giây — KHÔNG khá hơn tuần tự
                    vì CPU không rảnh để làm việc khác
```

Đây chính là lý do hai service trong sự cố ở đầu note cho kết quả ngược nhau.

### Node.js: nơi việc thực sự chạy

```text
① EVENT LOOP (1 luồng)      toàn bộ JavaScript của bạn
② THREAD POOL libuv (4)     fs, dns.lookup, crypto (pbkdf2/scrypt/bcrypt), zlib
③ KERNEL async              mạng — KHÔNG dùng thread pool
④ WORKER THREADS            bạn tạo tường minh, mỗi cái một event loop riêng
⑤ CHILD PROCESS / CLUSTER   process riêng, bộ nhớ riêng
```

```text
Hệ quả thực tế:
  · request HTTP song song hàng nghìn cái → không tốn luồng nào  (③)
  · 5 bcrypt đồng thời → cạn thread pool → fs và DNS cũng chờ    (②)
  · một vòng lặp tính toán → chặn mọi thứ                         (①)
```

### Chọn công cụ theo loại việc

```text
VIỆC                              CÔNG CỤ
────────────────────────────────────────────────────────────
gọi API/DB song song              Promise.all (có giới hạn đồng thời)
tận dụng nhiều lõi cho HTTP       cluster / nhiều pod
tính toán nặng trong request      → ĐẨY RA QUEUE (thường đúng nhất)
tính toán nặng phải trong process worker_threads
chạy chương trình ngoài           child_process
việc chạy nền, có thể chậm        message queue + worker riêng
```

```text
Với dịch vụ chạy trong container, "nhiều pod" thường tốt hơn "cluster trong pod":
  + orchestrator quản lý được từng đơn vị
  + scale mịn hơn, health check độc lập
  − nhiều kết nối DB hơn (N pod × pool)
```

### Concurrency trong JavaScript không có race — nhưng có logic race

```text
JavaScript đơn luồng ⇒ KHÔNG có data race (hai luồng ghi cùng biến)

Nhưng VẪN có race về LOGIC:
  hai request cùng đọc số dư → cùng thấy 100 → cùng trừ 30 → ghi 70
  đáng lẽ 40
  ← không có luồng nào tranh chấp; vấn đề là ĐỌC-SỬA-GHI không nguyên tử
```

```text
Ranh giới: MỌI `await` là điểm mà request khác có thể chen vào.
  → giữa `await read()` và `await write()`, trạng thái có thể đã đổi
```

Xem [Shared state & races](02-shared-state-races.md).

### Giới hạn đồng thời: nhiều hơn không phải luôn tốt hơn

```text
Tăng số việc đồng thời:
  ít  → không tận dụng được, throughput thấp
  vừa → throughput tối đa
  nhiều → TRANH CHẤP tăng: pool cạn, context switch, bộ nhớ, lock

⇒ có một điểm tối ưu, và nó phải ĐO, không đoán.
```

```ts
import pLimit from 'p-limit';

const limit = pLimit(10);                 // đo từ load test
const results = await Promise.all(items.map(i => limit(() => process(i))));
```

`Promise.all` không giới hạn trên mảng lớn là lỗi phổ biến: 1000 phần tử chạm database cùng lúc làm cạn pool và biến tối ưu thành sự cố.

### Async không phải parallel

```ts
// TUẦN TỰ — 3 × 200ms = 600ms
const a = await fetchA();
const b = await fetchB();
const c = await fetchC();

// ĐỒNG THỜI — 200ms (không phải "parallel": vẫn một luồng, chỉ là chờ chồng nhau)
const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]);
```

```text
Và bốn biến thể `Promise` với ngữ nghĩa khác nhau:
  all         một lỗi → reject cả nhóm (các promise khác VẪN CHẠY)
  allSettled  chờ tất cả, trả kết quả từng cái   → dùng khi cần kết quả một phần
  race        cái đầu tiên settle (kể cả reject) → dùng cho timeout
  any         cái đầu tiên FULFILL               → dùng cho fallback nhiều nguồn
```

### Ba cách phối hợp giữa các đơn vị

```text
CHIA SẺ BỘ NHỚ    nhanh nhất, cần lock, dễ sai
                  → SharedArrayBuffer + Atomics trong worker_threads
THÔNG ĐIỆP        không race, tốn chi phí serialize
                  → postMessage, IPC, message queue
STORE BÊN NGOÀI   nhiều process/máy dùng chung
                  → database, Redis
```

```text
Với hệ thống nhiều instance, chỉ cách ③ hoạt động:
  biến trong process KHÔNG được chia sẻ giữa các pod
  → cache in-process, rate limit in-memory, khoá in-memory
    đều SAI khi có nhiều instance
```

Đây là lỗi hay gặp khi hệ thống chuyển từ một instance sang nhiều: code vẫn chạy, chỉ là nó ngừng đúng.

## Example

Ba loại việc, ba mô hình:

```ts
// ① I/O-BOUND: event loop, có giới hạn đồng thời
async function enrichOrders(orders: Order[]) {
  const limit = pLimit(20);                        // 20 lời gọi HTTP cùng lúc
  return Promise.all(orders.map(o => limit(async () => ({
    ...o,
    customer: await this.customers.fetch(o.customerId),
  }))));
}
```

```ts
// ② CPU-BOUND, phải trong process: worker_threads
import { Worker } from 'node:worker_threads';

function resizeImage(buffer: Buffer, width: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./image-worker.js', { workerData: { buffer, width } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`exit ${code}`)); });
  });
}
```

```text
Lưu ý về chi phí: tạo worker mất ~10–40ms.
Với việc ngắn, chi phí đó lớn hơn phần tiết kiệm.
→ dùng WORKER POOL (piscina) thay vì tạo mới mỗi lần.
```

```ts
// ③ CPU-BOUND, không cần kết quả ngay: queue + worker riêng — thường ĐÚNG NHẤT
@Post('images/:id/process')
@HttpCode(202)
async process(@Param('id') id: string) {
  const job = await this.imageQueue.add('resize', { imageId: id });
  return { jobId: job.id };
}

// worker chạy trong POD RIÊNG, scale độc lập, không ảnh hưởng API
new Worker('images', async (job) => resizeImage(await load(job.data.imageId), 800), {
  concurrency: os.cpus().length,        // CPU-bound: bằng số lõi
});
```

Chú ý `concurrency` khác nhau theo loại việc:

```text
CPU-bound:  ≈ số lõi         (nhiều hơn chỉ tăng context switch)
I/O-bound:  cao hơn nhiều    (giới hạn bởi pool DB, rate limit, bộ nhớ)
```

Và cách sai phổ biến khi chuyển sang nhiều instance:

```ts
// ✗ chỉ đúng khi có MỘT instance
const seen = new Set<string>();
if (seen.has(key)) return;
seen.add(key);

// ✓ đúng với nhiều instance — trạng thái ở store dùng chung
const ok = await redis.set(`seen:${key}`, '1', 'NX', 'EX', 3600);
if (!ok) return;
```

## Prediction

1. 1000 request, mỗi cái chờ DB 50ms, một luồng chặn — tổng thời gian?
2. Cùng vậy với event loop — tổng?
3. 1000 request, mỗi cái tính CPU 50ms, event loop — tổng?
4. 1000 luồng, mỗi luồng ~1MB stack — bộ nhớ?
5. Node.js: 5000 request HTTP đồng thời — tốn bao nhiêu luồng trong thread pool?
6. 5 thao tác bcrypt đồng thời với `UV_THREADPOOL_SIZE=4` — thao tác thứ 5 và mọi `fs` tiếp theo thế nào?
7. JavaScript đơn luồng — có data race không? Có logic race không?
8. Hai request cùng đọc số dư 100, cùng trừ 30, cùng ghi — kết quả?
9. `Promise.all` trên 1000 phần tử chạm database, pool 20 — chuyện gì xảy ra?
10. `Promise.all` với một promise reject — các promise khác thế nào?
11. Tạo worker thread cho việc mất 5ms, chi phí tạo worker 20ms — nhanh hơn hay chậm hơn?
12. `concurrency = 100` cho worker CPU-bound trên máy 4 lõi — throughput thế nào?
13. `Set` in-memory để khử trùng lặp, chạy 5 pod — nó hoạt động không?
14. Service chỉ gọi DB và API, chuyển sang worker threads — nhanh hơn không?

<details>
<summary>Đáp án</summary>

1. **50 giây** — tuần tự.
2. **~50ms** — chờ chồng nhau.
3. **50 giây** — CPU không rảnh để làm việc khác.
4. Khoảng **1 GB**, cộng chi phí context switch.
5. **Không luồng nào** — mạng dùng kernel async.
6. Thao tác thứ 5 và mọi `fs` sau đó **phải chờ** — pool đã cạn.
7. Không data race; **có** logic race.
8. **70**, đáng lẽ 40 — mất một lần trừ.
9. Pool **cạn**, request xếp hàng, có thể timeout — tệ hơn làm tuần tự có giới hạn.
10. Chúng **vẫn chạy**, chỉ là kết quả bị bỏ.
11. **Chậm hơn** — chi phí tạo lớn hơn phần tiết kiệm.
12. **Không tốt hơn 4**, và tệ hơn vì context switch và bộ nhớ.
13. **Không** — mỗi pod có `Set` riêng.
14. **Không** — việc đó đã không chặn event loop; chỉ thêm chi phí.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm vòng lặp tính toán 500ms vào một endpoint | Endpoint khác có chậm không? |
| Đo event loop lag khi đó | Bao nhiêu ms? |
| Chạy 10 bcrypt đồng thời | Thao tác `fs` chậm bao nhiêu? |
| Tăng `UV_THREADPOOL_SIZE` lên số lõi | Khác thế nào? |
| Chuyển vòng lặp `await` sang `Promise.all` | Nhanh hơn bao nhiêu? |
| `Promise.all` không giới hạn trên 1000 phần tử | Pool có cạn không? |
| Thêm `p-limit(10)` | Khác thế nào? |
| Tạo worker thread cho việc 5ms | Nhanh hơn hay chậm hơn? |
| Đặt `concurrency` cao gấp 10 số lõi cho việc CPU | Throughput đổi thế nào? |
| Dùng `Set` in-memory rồi chạy 3 instance | Khử trùng lặp còn đúng không? |
| Chạy hai request đồng thời trên cùng bản ghi | Kết quả có đúng không? |

## What Usually Goes Wrong

- **Chọn mô hình theo thói quen** thay vì theo loại việc.
- **Việc CPU nặng trên event loop.**
- **Không biết thread pool của libuv tồn tại** → cạn mà không hiểu vì sao.
- **`Promise.all` không giới hạn** trên mảng lớn.
- **Tuần tự khi lẽ ra đồng thời** (`for...await`).
- **Nhầm concurrency với parallelism** → thêm worker cho việc I/O.
- **Worker thread cho việc quá ngắn** → chi phí lớn hơn lợi ích.
- **Tạo worker mới mỗi lần** thay vì dùng pool.
- **`concurrency` sai loại**: bằng số lõi cho I/O, hoặc rất lớn cho CPU.
- **Trạng thái in-memory** khi có nhiều instance.
- **Giả định `await` là nguyên tử** → logic race.
- **Không đo điểm tối ưu của số đồng thời.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Concurrency = parallelism | Một cái về cấu trúc, một cái về thực thi |
| Node.js chậm vì đơn luồng | Nó rất hiệu quả với I/O; chỉ kém với CPU |
| Thêm luồng luôn tăng throughput | Có điểm tối ưu; vượt qua thì tranh chấp thắng |
| `async` nghĩa là chạy song song | Nó nghĩa là không chặn trong lúc chờ |
| JavaScript đơn luồng nên không có race | Không có data race, nhưng có logic race |
| Mọi thao tác Node đều bất đồng bộ thật | fs, dns, crypto, zlib dùng thread pool |
| Worker threads là giải pháp cho mọi việc nặng | Queue + worker riêng thường đúng hơn |
| `Promise.all` luôn nhanh hơn | Không giới hạn thì nó làm cạn tài nguyên |
| Biến trong process chia sẻ giữa các pod | Mỗi pod có bộ nhớ riêng |
| `await` tạo điểm nguyên tử | Nó là điểm request khác chen vào được |

## Debugging

1. **Xác định loại việc trước**: đo CPU và event loop lag khi có tải. CPU thấp + độ trễ cao = I/O; CPU cao = tính toán.
2. **Event loop lag cao** → có việc chặn; `node --cpu-prof` để tìm hàm.
3. **Thao tác `fs`/DNS chậm bất thường** → nghi cạn thread pool; kiểm tra `UV_THREADPOOL_SIZE` và lượng bcrypt/zlib.
4. **Throughput không tăng khi tăng số đồng thời** → đã chạm nút thắt khác (pool, DB, rate limit).
5. **Throughput GIẢM khi tăng số đồng thời** → tranh chấp; giảm xuống và đo lại.
6. **Kết quả sai khi có tải** → logic race; xem [Shared state & races](02-shared-state-races.md).
7. **Hoạt động với một pod, sai với nhiều pod** → trạng thái in-memory.
8. **Đo điểm tối ưu**: chạy load test với các giá trị đồng thời khác nhau và vẽ throughput — nó có đỉnh rõ ràng.

## Production Considerations

- **Phân loại việc I/O-bound hay CPU-bound** trước khi chọn công cụ.
- **Việc CPU nặng ra khỏi request path** — queue + worker riêng là mặc định.
- **Worker pool** (piscina) nếu phải dùng worker threads.
- **`UV_THREADPOOL_SIZE`** theo số lõi khi dùng nhiều bcrypt/zlib/fs.
- **Giới hạn đồng thời cho mọi thao tác hàng loạt** — đo, không đoán.
- **`concurrency` của worker**: ≈ số lõi cho CPU, cao hơn cho I/O nhưng bị chặn bởi pool DB.
- **Nhiều pod thay vì cluster trong pod** khi chạy trên orchestrator — nhớ tính lại `N pod × pool`.
- **Trạng thái dùng chung ở Redis/DB**, không trong process.
- **Đo event loop lag** như một metric hạng nhất.
- **Test với nhiều instance** — lỗi trạng thái in-memory chỉ lộ ra ở đó.
- **Tài liệu ghi rõ giả định đồng thời** của mỗi thành phần: nó chạy được với bao nhiêu instance?

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Event loop | hiệu quả với I/O, không data race | việc CPU chặn tất cả |
| Multi-thread | tận dụng nhiều lõi, chia sẻ dễ | race, lock, deadlock |
| Multi-process | cô lập tốt | tốn bộ nhớ, IPC đắt |
| Actor/CSP | không race theo thiết kế | thay đổi cách viết code |
| Worker threads | dùng nhiều lõi trong process | chi phí tạo, giao tiếp qua message |
| Queue + worker riêng | cô lập hoàn toàn, scale độc lập | hạ tầng, độ trễ, theo dõi job |
| Đồng thời cao | throughput cao | tranh chấp, bộ nhớ |
| Đồng thời thấp | ổn định | không tận dụng hết |
| Trạng thái in-memory | nhanh nhất | sai với nhiều instance |
| Trạng thái ở Redis | đúng với mọi số instance | thêm vòng khứ hồi và một phụ thuộc |

## Explain Without Notes

1. Concurrency và parallelism khác nhau thế nào? Cho ví dụ đời thường.
2. Vì sao event loop hiệu quả với I/O mà kém với CPU? Đưa phép tính.
3. Năm nơi việc có thể chạy trong Node.js?
4. Vì sao 5000 request HTTP đồng thời không tốn luồng nào, mà 5 bcrypt thì cạn pool?
5. JavaScript đơn luồng — loại race nào không có, loại nào vẫn có?
6. Vì sao `Promise.all` không giới hạn có thể tệ hơn làm tuần tự?
7. `concurrency` nên đặt bao nhiêu cho việc CPU-bound và I/O-bound? Vì sao khác nhau?
8. Vì sao trạng thái in-memory sai khi có nhiều instance, và code vẫn "chạy"?

## Related

- [Shared state & races](02-shared-state-races.md) — logic race và cách chặn
- [Distributed locks](03-distributed-locks.md) — phối hợp giữa nhiều instance
- [Event loop](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — cơ chế chi tiết
- [Streams & buffers](../../02-backend-api/01-nodejs/02-streams-buffers.md) — xử lý dữ liệu lớn
- [Backend performance](../performance/03-backend-performance.md) — chặn event loop và thread pool
- [Backpressure](../performance/06-backpressure.md) — giới hạn số đồng thời
- [Caching, queues & jobs](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — đẩy việc ra queue
- [Why queue](../../03-database/04-message-queues/01-why-queue.md) — khi nào cần hàng đợi
- [Process, files & env](../../04-infrastructure/00-linux/01-process-files-env.md) — process ở tầng OS

## Version / Context

Ví dụ dùng Node.js 20+ (`worker_threads`, `p-limit`, `piscina`), NestJS 10/11, BullMQ. `UV_THREADPOOL_SIZE` mặc định 4, tối đa 1024, phải đặt trước khi process khởi động. `Promise.any` có từ Node 15. Mô hình actor tham chiếu Erlang/OTP; CSP tham chiếu Go channel.
