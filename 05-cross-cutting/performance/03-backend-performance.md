---
level: advanced
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - 04-database-performance.md
  - 06-backpressure.md
---

# Backend performance

> Một API Node.js phục vụ 800 rps ổn định. Sau khi thêm tính năng xuất PDF, p99 của **mọi endpoint** tăng từ 90ms lên 3 giây — kể cả endpoint chỉ trả về một dòng từ cache. Tính năng PDF chạy đúng, chỉ tốn 400ms mỗi lần và được gọi 2 lần/phút. Nguyên nhân: nó chạy **đồng bộ trên event loop**. Trong 400ms đó, không request nào khác được xử lý.

## Position

```text
Request đến → [ event loop ] → I/O (DB, cache, API) → [ event loop ] → response
                    ↑ MỘT luồng cho toàn bộ JavaScript
                      chặn nó = chặn TẤT CẢ
```

## Problem

```text
Backend chậm vì một trong bốn lý do, và chúng cần cách sửa khác nhau:

  ① CHẶN EVENT LOOP     một request làm chậm mọi request khác
  ② CHỜ I/O TUẦN TỰ     lời gọi độc lập chạy nối tiếp
  ③ HÀNG ĐỢI Ở POOL     pool nhỏ hơn nhu cầu đồng thời
  ④ CHI PHÍ MỖI REQUEST serialize, validate, log, middleware
```

Chẩn đoán sai nhóm là lý do tối ưu không có tác dụng: thêm instance không sửa được ①, và tối ưu thuật toán không sửa được ③.

## Mental Model

### Event loop: một luồng cho JavaScript

```text
Node.js chạy JavaScript trên MỘT luồng.
I/O là bất đồng bộ (libuv, kernel) → không chặn.
Nhưng TÍNH TOÁN thì chặn:

  JSON.parse của 10 MB        → ~100ms, không request nào được xử lý
  vòng lặp qua 1 triệu phần tử → chặn
  crypto đồng bộ, nén, PDF     → chặn
  regex có backtracking mũ      → có thể chặn RẤT lâu

⇒ Trong 400ms chặn, 800 rps nghĩa là ~320 request bị xếp hàng.
  Đó là lý do p99 của MỌI endpoint tăng.
```

```text
Đo nó bằng event loop lag:
  chênh lệch giữa thời điểm setTimeout ĐƯỢC LÊN LỊCH và thời điểm nó CHẠY
  < 10ms   khoẻ
  > 100ms  có việc chặn
  > 1s     nghiêm trọng
```

```ts
import { monitorEventLoopDelay } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
setInterval(() => {
  eventLoopLag.set(h.mean / 1e6);      // ms — đưa vào metric
  h.reset();
}, 5000);
```

Đây là metric nên có ở mọi service Node.js: nó phát hiện cả một lớp vấn đề mà CPU và độ trễ endpoint riêng lẻ không thể hiện rõ.

### Xử lý việc nặng CPU

```text
① ĐẨY RA KHỎI REQUEST      hàng đợi + worker riêng   ← thường là đúng nhất
② WORKER THREADS            cùng process, luồng khác
③ CHIA NHỎ VÀ NHƯỜNG        setImmediate giữa các lô
④ THƯ VIỆN NATIVE BẤT ĐỒNG BỘ  chạy trong thread pool của libuv
```

```ts
// ③ chia nhỏ — dùng khi không tách được ra worker
async function processLarge(items: Item[]) {
  const BATCH = 500;
  for (let i = 0; i < items.length; i += BATCH) {
    for (const item of items.slice(i, i + BATCH)) transform(item);
    await new Promise(r => setImmediate(r));      // nhường event loop giữa các lô
  }
}
```

```text
Với PDF ở đầu note: lựa chọn ① là đúng.
  → POST trả 202 kèm job id
  → worker riêng render PDF
  → client hỏi trạng thái hoặc nhận webhook
  ⇒ event loop của API không bao giờ bị chặn
```

### Thread pool của libuv: giới hạn ẩn

```text
Một số thao tác KHÔNG dùng kernel async mà chạy trong thread pool:
  · fs (hầu hết)   · dns.lookup()   · crypto (pbkdf2, scrypt, bcrypt native)
  · zlib

Mặc định: UV_THREADPOOL_SIZE = 4

⇒ 4 thao tác bcrypt đồng thời làm CẠN pool
  → mọi thao tác fs và DNS cũng phải chờ
  → triệu chứng: "đăng nhập chậm làm mọi thứ chậm"
```

```text
UV_THREADPOOL_SIZE=<số core> là cấu hình đáng cân nhắc
khi service dùng nhiều bcrypt/zlib/fs.
Nhưng nó không thay thế được việc đẩy CPU nặng ra khỏi process.
```

### Tuần tự khi lẽ ra song song

```ts
// ✗ 3 lời gọi độc lập, tuần tự — 3 × 200ms = 600ms
const user = await this.users.find(id);
const orders = await this.orders.byUser(id);
const prefs = await this.prefs.byUser(id);

// ✓ song song — 200ms
const [user, orders, prefs] = await Promise.all([
  this.users.find(id), this.orders.byUser(id), this.prefs.byUser(id),
]);
```

```text
`for (const x of xs) await f(x)` là dạng phổ biến nhất của lỗi này.

Nhưng đừng chuyển thẳng sang Promise.all trên mảng lớn:
  1000 phần tử × Promise.all = 1000 kết nối DB đồng thời → cạn pool → tệ hơn
  → giới hạn số đồng thời (p-limit hoặc chia lô)
```

```ts
import pLimit from 'p-limit';
const limit = pLimit(10);                    // tối đa 10 cùng lúc
await Promise.all(items.map(i => limit(() => process(i))));
```

Và với `Promise.all`, nhớ rằng **một lỗi làm cả nhóm reject** trong khi các promise khác vẫn chạy. Dùng `Promise.allSettled` khi cần kết quả từng phần.

### Pool: kích thước từ định luật Little

```text
Số kết nối cần = throughput × thời gian giữ kết nối
  200 rps × 20ms giữ kết nối = 4 kết nối

Pool QUÁ NHỎ  → request xếp hàng chờ kết nối
                triệu chứng: độ trễ app cao, độ trễ DB THẤP  ← dấu hiệu đặc trưng
Pool QUÁ LỚN  → database quá tải; vượt max_connections
                và: N pod × pool size là con số DB thực sự thấy
```

Xem [Connection pool](../../03-database/01-postgresql/03-connection-pool.md).

### Chi phí mỗi request: những thứ cộng dồn

```text
JSON serialize    response lớn → CPU đáng kể
                  → phân trang; chọn trường cần thiết
Validate          schema phức tạp trên payload lớn
                  → validate ở biên một lần, không lặp ở mỗi tầng
Log               ghi đồng bộ hoặc log quá nhiều trong vòng nóng
                  → log bất đồng bộ, lấy mẫu
Middleware        mỗi cái chạy cho MỌI request
                  → chỉ gắn vào route cần
Nén               gzip cho response nhỏ tốn hơn tiết kiệm
                  → ngưỡng ~1 KB; nén ở proxy thay vì ở app
ORM hydration     dựng object cho 10.000 dòng
                  → truy vấn thô khi chỉ cần đọc
```

Không cái nào trong danh sách này lớn một mình. Chúng thành vấn đề khi cộng lại và khi nhân với rps.

### Bộ nhớ và GC

```text
Heap gần giới hạn → GC chạy thường xuyên hơn → tạm dừng dài hơn → p99 nổ

Triệu chứng rò rỉ:  heap tăng đều, không giảm sau GC
Nguồn phổ biến:     cache không giới hạn · listener không gỡ · closure giữ tham chiếu lớn
                    · mảng tích luỹ không bao giờ xoá

Trong container:
  heap limit của Node phải < memory limit của container
  → --max-old-space-size ≈ 75% memory limit
  → nếu không: container bị OOMKill (exit 137) mà KHÔNG có stack trace
```

Chi tiết này quan trọng vì nó quyết định bạn nhận được **lỗi có thông tin** (heap out of memory, có stack) hay **cái chết im lặng** (SIGKILL từ kernel).

### N+1: nút thắt phổ biến nhất

```text
100 truy vấn × 2ms = 200ms  → và mỗi truy vấn còn tốn một vòng khứ hồi

Nhận diện trong trace: nhiều span cùng tên, mỗi cái nhanh, xếp liên tiếp.
Sửa: eager load / DataLoader / một truy vấn với JOIN hoặc IN.
```

Xem [Database performance](04-database-performance.md).

### Cache trong process: nhanh nhưng có bẫy

```text
+ nhanh nhất (không qua mạng)
− mỗi pod một bản → tỉ lệ trúng thấp khi có nhiều pod
− không invalidate chung được
− chiếm heap → GC

⇒ dùng cho: dữ liệu nhỏ, ít đổi, không cần nhất quán giữa pod
  (cấu hình, feature flag, kết quả tính toán thuần)
⇒ LUÔN giới hạn kích thước (LRU) và đặt TTL
```

## Example

Chẩn đoán và sửa sự cố ở đầu note:

```text
① TRIỆU CHỨNG
   p99 mọi endpoint: 90ms → 3s
   endpoint chỉ đọc cache cũng chậm  ← manh mối quyết định

② PHÂN LOẠI
   endpoint không chạm DB cũng chậm → KHÔNG phải database
   thêm instance chỉ giúp một phần   → không phải tài nguyên dùng chung
   CPU trung bình 35%                → không phải CPU bão hoà
   event loop lag: 2800ms            → CHẶN EVENT LOOP ✓

③ TÌM NGUỒN
   node --cpu-prof, hoặc `perf_hooks` timerify quanh các hàm nghi ngờ
   → renderPdf() đồng bộ, 400ms mỗi lần
```

```ts
// ✗ trước: chặn event loop
@Post('reports/:id/pdf')
async generatePdf(@Param('id') id: string) {
  const data = await this.reports.load(id);
  const pdf = renderPdfSync(data);              // 400ms CHẶN
  return { url: await this.storage.upload(pdf) };
}
```

```ts
// ✓ sau: đẩy ra khỏi request
@Post('reports/:id/pdf')
@HttpCode(202)
async requestPdf(@Param('id') id: string, @CurrentUser() user: User) {
  const job = await this.pdfQueue.add('render', { reportId: id, userId: user.id },
    { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  return { jobId: job.id, status: 'processing' };
}

@Get('reports/jobs/:jobId')
async status(@Param('jobId') jobId: string) {
  const job = await this.pdfQueue.getJob(jobId);
  return { status: await job?.getState(), url: job?.returnvalue?.url };
}
```

```text
Kết quả:
  p99 mọi endpoint: 3s → 90ms
  event loop lag: 2800ms → 4ms
  PDF vẫn mất 400ms, nhưng ở worker riêng, không ảnh hưởng ai
```

Và metric để nó không tái diễn:

```ts
// alert khi event loop lag > 100ms trong 5 phút
// → bắt được MỌI việc chặn trong tương lai, không chỉ PDF
```

Điểm cuối đáng chú ý: cách sửa đúng không chỉ là chuyển PDF sang worker, mà là **thêm tín hiệu phát hiện cả lớp vấn đề đó**.

## Prediction

1. Một hàm chặn event loop 400ms, service nhận 800 rps — bao nhiêu request bị xếp hàng?
2. Endpoint chỉ đọc từ cache in-process cũng chậm — nút thắt có phải database không?
3. Event loop lag = 2800ms — nghĩa là gì?
4. `UV_THREADPOOL_SIZE=4`, 4 request đăng nhập đồng thời dùng bcrypt — thao tác `fs` tiếp theo thế nào?
5. `for (const id of ids) await fetch(id)` với 50 id, mỗi cái 100ms — tổng?
6. `Promise.all(ids.map(fetch))` — tổng? Rủi ro gì với 1000 id?
7. Pool 5 kết nối, 200 rps, mỗi query giữ 20ms — có đủ không?
8. Độ trễ app cao nhưng độ trễ DB thấp — nghi gì?
9. 10 pod × pool 20 — database thấy bao nhiêu kết nối?
10. Heap limit của Node bằng memory limit của container, heap đầy — chuyện gì xảy ra?
11. Heap limit = 75% memory limit — chuyện gì xảy ra?
12. Cache in-process 10 pod, tỉ lệ trúng lý thuyết 90% — thực tế mỗi pod thấy bao nhiêu?
13. `Promise.all` với một promise reject — các promise khác thế nào?
14. Nén gzip mọi response kể cả 200 byte — tốn hay tiết kiệm?

<details>
<summary>Đáp án</summary>

1. `800 × 0,4 = 320` request.
2. **Không** — nó chỉ ra vấn đề ở tầng process, gần như chắc chắn là event loop.
3. Event loop bị **chặn nghiêm trọng** — có việc đồng bộ nặng.
4. Nó **chờ** — pool đã cạn.
5. **5000ms** — tuần tự.
6. **100ms**; với 1000 id, rủi ro **cạn pool DB và bùng nổ bộ nhớ**.
7. `200 × 0,02 = 4` — **đủ**, nhưng không có biên cho đột biến.
8. **Hàng đợi ở pool** — request chờ kết nối, không chờ database.
9. **200 kết nối** — thường vượt `max_connections` mặc định.
10. **OOMKill (exit 137)** — không có stack trace.
11. **Lỗi "heap out of memory" có stack trace** — chẩn đoán được.
12. Thấp hơn nhiều — mỗi pod có cache riêng, phải làm nóng riêng.
13. Chúng **vẫn chạy**, chỉ là kết quả bị bỏ; dùng `allSettled` nếu cần.
14. **Tốn** — chi phí nén lớn hơn phần tiết kiệm dưới ~1 KB.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm `JSON.parse` một chuỗi 10 MB vào một endpoint | p99 của endpoint KHÁC đổi thế nào? |
| Đo event loop lag khi có tải | Bao nhiêu ms? |
| Chạy 10 bcrypt đồng thời với `UV_THREADPOOL_SIZE=4` | Thao tác fs chậm bao nhiêu? |
| Chuyển vòng lặp `await` sang `Promise.all` | Tiết kiệm bao nhiêu? |
| `Promise.all` trên 1000 phần tử chạm DB | Pool có cạn không? |
| Giảm pool xuống 2 | Độ trễ app và DB đổi thế nào? |
| So độ trễ app và độ trễ DB cho cùng request | Chênh lệch là thời gian chờ pool |
| Chạy tải liên tục 1 giờ, xem heap | Có tăng đều không? |
| Đặt heap limit bằng memory limit rồi làm đầy heap | Exit code là gì? |
| `node --cpu-prof` trong 30 giây khi có tải | Hàm nào chiếm nhiều nhất? |
| Bật nén cho response 200 byte | Nhanh hơn hay chậm hơn? |

## What Usually Goes Wrong

- **Việc CPU nặng chạy trên event loop.**
- **Không đo event loop lag** → cả lớp vấn đề vô hình.
- **`UV_THREADPOOL_SIZE` mặc định** với service dùng nhiều bcrypt/zlib/fs.
- **Vòng lặp `await`** cho lời gọi độc lập.
- **`Promise.all` không giới hạn** trên mảng lớn → cạn pool.
- **Pool nhỏ hơn `λ × W`** → chờ ẩn.
- **`N pod × pool` vượt `max_connections`.**
- **N+1** ẩn sau ORM.
- **Heap limit bằng memory limit** → OOMKill im lặng.
- **Cache in-process không giới hạn** → rò rỉ và GC.
- **Log đồng bộ hoặc log trong vòng nóng.**
- **Middleware toàn cục** làm việc nặng cho mọi request.
- **Trả về toàn bộ dữ liệu** thay vì phân trang.
- **Không có timeout** → một dependency chậm giữ tài nguyên vô hạn.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Node.js không tốt cho việc nặng CPU | Nó không tốt khi việc đó chạy trên event loop |
| Async nghĩa là không chặn | `await` không làm code đồng bộ thành không chặn |
| Thêm instance sửa được mọi vấn đề | Không sửa được chặn event loop trong từng instance |
| Pool càng lớn càng tốt | Nó đẩy vấn đề sang database |
| `Promise.all` luôn tốt hơn tuần tự | Không giới hạn thì nó làm cạn tài nguyên |
| CPU thấp nghĩa là không có vấn đề CPU | Event loop có thể bị chặn ở 30% CPU |
| Worker threads giải quyết mọi việc nặng | Hàng đợi + worker riêng thường đúng hơn |
| Cache in-process luôn nhanh hơn Redis | Với nhiều pod, tỉ lệ trúng thấp hơn nhiều |
| GC là chuyện của runtime | Heap gần giới hạn làm p99 nổ |
| Nén luôn tiết kiệm | Dưới ~1 KB nó tốn hơn |

## Debugging

1. **Đo event loop lag trước tiên** — nó phân loại vấn đề nhanh nhất.
2. **Endpoint không chạm I/O cũng chậm?** → vấn đề ở tầng process, không phải dependency.
3. **`node --cpu-prof`** trong 30 giây khi có tải; mở file `.cpuprofile` trong DevTools và nhìn hàm chiếm nhiều thời gian nhất.
4. **So độ trễ app với độ trễ DB** — chênh lệch là thời gian chờ pool hoặc chờ event loop.
5. **Trace**: bậc thang = tuần tự; span lặp = N+1; khoảng trống trước span DB = chờ pool.
6. **Heap tăng đều** → `node --heap-prof` hoặc chụp heap snapshot ở hai thời điểm và so sánh.
7. **Kiểm tra `UV_THREADPOOL_SIZE`** nếu service dùng bcrypt, zlib, hoặc fs nhiều.
8. **Kiểm tra `N pod × pool` so với `max_connections`** — phép tính này hay bị bỏ qua khi scale.

## Production Considerations

- **Event loop lag là metric hạng nhất**, có alert.
- **Việc CPU nặng ra khỏi request path** — hàng đợi + worker riêng.
- **`UV_THREADPOOL_SIZE`** đặt theo số core khi dùng nhiều thao tác thread-pool.
- **`Promise.all` cho lời gọi độc lập, có giới hạn đồng thời** cho mảng lớn.
- **Pool theo `λ × W`**, và kiểm tra `N pod × pool < max_connections`.
- **Heap limit ≈ 75% memory limit** của container.
- **Cache in-process có LRU và TTL**; Redis khi cần nhất quán giữa pod.
- **Phân trang mặc định**, chọn cột cần thiết, không trả về toàn bộ.
- **Log bất đồng bộ, lấy mẫu log truy cập**, không log trong vòng nóng.
- **Nén ở proxy** với ngưỡng kích thước, không nén ở app.
- **Timeout ở mọi lời gọi ra ngoài**, xếp thứ tự từ ngoài vào trong.
- **Middleware chỉ gắn vào route cần**, không gắn toàn cục theo mặc định.
- **Load test trước khi phát hành tính năng nặng**, đo cả event loop lag.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Đẩy việc nặng sang queue | event loop sạch | phức tạp, cần theo dõi job |
| Worker threads | cùng process, đơn giản hơn queue | vẫn dùng chung tài nguyên máy |
| Chia nhỏ + `setImmediate` | không thêm hạ tầng | code phức tạp, vẫn chiếm CPU |
| Pool lớn | ít chờ ở app | tải lên database |
| Pool nhỏ | bảo vệ database | xếp hàng ở app |
| Cache in-process | nhanh nhất | tỉ lệ trúng thấp với nhiều pod, tốn heap |
| Cache Redis | dùng chung, invalidate được | thêm vòng khứ hồi và một phụ thuộc |
| `Promise.all` không giới hạn | nhanh nhất | cạn tài nguyên |
| Giới hạn đồng thời | ổn định | chậm hơn một chút |
| Nén response | ít băng thông | tốn CPU, phản tác dụng với payload nhỏ |

## Explain Without Notes

1. Vì sao một hàm chặn 400ms làm p99 của mọi endpoint tăng?
2. Event loop lag đo gì và ngưỡng nào là đáng lo?
3. Thread pool của libuv ảnh hưởng tới thao tác nào? Triệu chứng khi nó cạn?
4. Bốn cách xử lý việc nặng CPU, và cái nào thường đúng nhất?
5. Vì sao `Promise.all` không giới hạn có thể làm mọi thứ tệ hơn?
6. Dấu hiệu phân biệt "database chậm" với "chờ pool"?
7. Vì sao heap limit phải nhỏ hơn memory limit của container?
8. Cache in-process phù hợp với loại dữ liệu nào, và vì sao?

## Related

- [Latency & bottleneck](01-latency-throughput-bottleneck.md) — khung tối ưu chung
- [Database performance](04-database-performance.md) — nút thắt ở tầng dưới
- [Backpressure](06-backpressure.md) — khi tải vượt khả năng
- [Profiling & load testing](05-profiling-load-testing.md) — công cụ đo
- [Event loop](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — cơ chế nền tảng
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — kích thước pool
- [Caching, queues & jobs](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — đẩy việc ra khỏi request
- [Memory & CPU limits](../../04-infrastructure/00-linux/02-memory-cpu-limits.md) — cgroup và OOMKill
- [Correlation & tracing](../observability/03-correlation-tracing.md) — đọc trace

## Version / Context

Ví dụ dùng Node.js 20+ (`monitorEventLoopDelay`, `--cpu-prof`, `--heap-prof`), NestJS 10/11, BullMQ, `p-limit`. `UV_THREADPOOL_SIZE` tối đa 1024, mặc định 4. `--max-old-space-size` tính bằng MB và chỉ giới hạn old space — tổng bộ nhớ process còn gồm heap khác, buffer ngoài heap và bộ nhớ native, nên biên 75% là ước lượng an toàn chứ không phải công thức chính xác.
