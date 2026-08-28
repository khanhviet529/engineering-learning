---
level: advanced
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - ../reliability/02-timeout-retry-circuit-breaker.md
  - ../../03-database/04-message-queues/01-why-queue.md
---

# Backpressure

> Một đợt khuyến mãi đẩy lưu lượng lên 6 lần trong hai phút. Hệ thống không từ chối request nào — nó nhận tất cả. Hàng đợi nội bộ phình lên 40.000 request đang chờ, bộ nhớ tăng, GC chạy liên tục, và độ trễ leo lên 90 giây. Người dùng bấm lại vì tưởng hỏng, nhân đôi tải. Khi lưu lượng trở lại bình thường sau 15 phút, hệ thống **vẫn mất thêm 40 phút** để xử lý hết hàng tồn — trong đó phần lớn là request mà không ai còn chờ nữa.

## Position

```text
Producer nhanh hơn Consumer:
  ① nhận hết và XẾP HÀNG      → hàng đợi vô hạn → sập
  ② LÀM CHẬM producer          → backpressure
  ③ TỪ CHỐI phần vượt          → shed load
  ④ BỎ BỚT dữ liệu             → sampling / degradation

②③④ đều là backpressure hiểu theo nghĩa rộng: TÍN HIỆU "tôi không theo kịp".
```

## Problem

```text
Hàng đợi không giới hạn có vẻ tử tế: "không mất request nào".
Thực tế nó là cách hỏng tệ nhất:

  · độ trễ tăng vô hạn → mọi request đều hỏng, không chỉ phần vượt
  · bộ nhớ tăng → OOM → mất TẤT CẢ, kể cả việc đang xử lý dở
  · người dùng bấm lại → tải nhân lên
  · hàng tồn kéo dài rất lâu sau khi tải đã bình thường
  · phần lớn công việc trong hàng đợi đã VÔ NGHĨA (client đã timeout)
```

```text
So sánh hai cách hỏng:
  không giới hạn:  100% request chậm 90 giây, rồi sập, phục hồi rất lâu
  có giới hạn:      70% request thành công nhanh, 30% nhận 503 ngay
                    → phục hồi tức thì khi tải giảm
```

Cách thứ hai phục vụ được nhiều người hơn. Đây là điểm phản trực giác trung tâm của chủ đề này.

## Mental Model

### Định luật Little cho biết hàng đợi dài bao nhiêu là chấp nhận được

```text
W = L / λ         thời gian chờ = số việc trong hàng / tốc độ xử lý

Consumer xử lý 100 việc/giây, hàng đợi có 40.000 việc:
  W = 40.000 / 100 = 400 giây

⇒ Với timeout client 30 giây, MỌI việc quá vị trí thứ 3.000 đều vô nghĩa.
⇒ Giới hạn hàng đợi nên đặt theo CÔNG THỨC này, không đặt theo cảm tính:
     max_queue ≈ throughput × timeout_chấp_nhận_được
     100/s × 5s = 500 — không phải 40.000
```

Đây là phép tính nên làm cho mọi hàng đợi trong hệ thống: pool kết nối, thread pool, buffer, queue nghiệp vụ.

### Hàng đợi ẩn ở khắp nơi

```text
TCP backlog (SYN queue, accept queue)   listen(backlog)
Hàng đợi của load balancer
Hàng đợi HTTP server                    số kết nối đang chờ handler
Pool kết nối DB                         request chờ kết nối
Thread pool của libuv
Hàng đợi trong ứng dụng                 mảng, Set, EventEmitter buffer
Message queue                           Redis/RabbitMQ/Kafka
Bộ đệm stream                            highWaterMark

Mỗi cái có giới hạn mặc định — và mặc định thường là "rất lớn" hoặc "không giới hạn".
Hàng đợi bạn không biết là hàng đợi bạn không giới hạn.
```

### Bốn cơ chế, theo thứ tự nên áp dụng

```text
① GIỚI HẠN ĐẦU VÀO (rate limit / quota)
   chặn ở BIÊN, trước khi tải vào hệ thống
   → rẻ nhất, bảo vệ mọi thứ phía sau

② GIỚI HẠN SỐ ĐỒNG THỜI (bulkhead)
   tối đa N request đang xử lý; phần vượt bị từ chối NGAY
   → khác rate limit: giới hạn theo TRẠNG THÁI, không theo tốc độ

③ HÀNG ĐỢI CÓ GIỚI HẠN + LOẠI BỎ
   khi đầy: từ chối mới, hoặc bỏ cũ nhất (tuỳ loại việc)

④ BACKPRESSURE THẬT SỰ (làm chậm producer)
   TCP flow control, stream pause/resume, `prefetch` của consumer
   → chỉ dùng được khi producer chấp nhận bị làm chậm
```

```text
Với HTTP, ② thường đúng hơn ①:
  rate limit theo tốc độ không biết hệ thống đang bận thế nào
  giới hạn đồng thời phản ánh trực tiếp khả năng thực tế
```

### Load shedding: bỏ cái gì

```text
Không phải mọi request đáng giá như nhau khi quá tải:

ƯU TIÊN THẤP → bỏ trước
  · bot, crawler                      · analytics, telemetry
  · prefetch, gợi ý                   · retry (chúng đã có một lần thử)

ƯU TIÊN CAO → giữ tới cùng
  · thanh toán, checkout               · đăng nhập
  · health check                       · người dùng đã ở giữa một luồng
```

```text
Và một quy tắc quan trọng: BỎ SỚM, BỎ RẺ.
  từ chối ở biên với 503 tốn ~0
  từ chối SAU khi đã query database tốn đúng bằng việc phục vụ nó
⇒ kiểm tra tải TRƯỚC khi làm việc, không phải sau.
```

### Deadline propagation: đừng làm việc vô nghĩa

```text
Client timeout 5 giây. Request nằm trong hàng đợi 8 giây rồi mới được xử lý.
→ xử lý nó là LÃNG PHÍ THUẦN TUÝ; không ai còn chờ.

Giải pháp: mang DEADLINE theo request và kiểm tra trước mỗi bước:
  ① client gửi deadline (hoặc server tính từ timeout đã biết)
  ② mỗi tầng kiểm tra: còn thời gian không? không → bỏ ngay
  ③ truyền deadline còn lại xuống tầng dưới
```

Trong hệ thống quá tải, kiểm tra deadline là cơ chế phục hồi mạnh nhất: nó tự động loại bỏ chính phần công việc đã mất giá trị, và làm hàng tồn tan nhanh thay vì kéo dài.

### Retry làm quá tải tệ hơn

```text
Hệ thống quá tải → trả lỗi → client retry → tải TĂNG → tệ hơn
  → "retry storm"

Ba biện pháp bắt buộc đi cùng nhau:
  ① exponential backoff + JITTER   (không có jitter → mọi client retry cùng lúc)
  ② giới hạn tổng số retry và ngân sách retry (ví dụ ≤10% tổng request)
  ③ circuit breaker                 (ngừng thử khi rõ ràng đang hỏng)

Và ở phía server: `Retry-After` trong 429/503 để client biết chờ bao lâu.
```

Xem [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md).

### Stream: backpressure đã có sẵn nếu bạn dùng đúng

```ts
// ✗ đọc hết vào bộ nhớ — file 2 GB thành 2 GB heap
const data = await fs.readFile('huge.csv');
await process(data);

// ✗ bỏ qua tín hiệu backpressure của write
for await (const chunk of readable) {
  writable.write(chunk);              // không kiểm tra giá trị trả về
}

// ✓ pipeline tôn trọng backpressure tự động
import { pipeline } from 'node:stream/promises';
await pipeline(
  createReadStream('huge.csv'),
  parseCsv(),
  transform(),
  createWriteStream('out.json'),
);
```

`writable.write()` trả về `false` khi buffer vượt `highWaterMark` — đó chính là tín hiệu backpressure. `pipeline` xử lý nó (và cả việc dọn dẹp khi lỗi) thay bạn.

### Consumer của message queue

```text
prefetch / concurrency = số message consumer nhận cùng lúc

quá CAO   → consumer ôm nhiều việc, bộ nhớ tăng, phân phối không đều
            (một consumer ôm hết trong khi consumer khác rảnh)
quá THẤP  → không tận dụng được, throughput thấp

⇒ đặt theo: prefetch ≈ số việc xử lý song song được, cộng biên nhỏ
```

Và hai tín hiệu phải theo dõi:

```text
queue depth      → có đang tích luỹ không
oldest item age  → việc cũ nhất chờ bao lâu   ← tín hiệu quan trọng hơn
```

`oldest item age` quan trọng hơn vì nó trả lời trực tiếp "người dùng phải chờ bao lâu", và nó phát hiện được cả trường hợp consumer chết (depth có thể ổn định nếu producer cũng chậm lại).

## Example

Thêm giới hạn đồng thời và deadline vào một service:

```ts
// ① BULKHEAD: giới hạn số request đang xử lý, từ chối phần vượt NGAY
class ConcurrencyLimiter {
  private active = 0;
  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;      // KHÔNG xếp hàng — từ chối luôn
    this.active++;
    return true;
  }
  release() { this.active--; }
  get inFlight() { return this.active; }
}

const limiter = new ConcurrencyLimiter(200);        // đo từ load test, không đoán

@Injectable()
export class LoadShedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    if (CRITICAL_PATHS.has(req.route?.path)) return true;    // ② ưu tiên: không bao giờ bỏ

    if (!limiter.tryAcquire()) {
      shedCounter.inc({ route: req.route?.path });
      res.setHeader('Retry-After', '2');                     // ③ nói client chờ bao lâu
      throw new ServiceUnavailableException('quá tải');
    }
    res.on('finish', () => limiter.release());
    return true;
  }
}
```

```ts
// ④ DEADLINE: không làm việc mà không ai còn chờ
export const deadlineContext = new AsyncLocalStorage<{ deadline: number }>();

app.use((req, res, next) => {
  const budgetMs = Number(req.headers['x-request-timeout'] ?? 5000);
  deadlineContext.run({ deadline: Date.now() + budgetMs }, next);
});

export function checkDeadline(step: string) {
  const ctx = deadlineContext.getStore();
  if (ctx && Date.now() > ctx.deadline) {
    deadlineExceeded.inc({ step });
    throw new RequestTimeoutException(`hết thời gian trước bước ${step}`);
  }
}

export function remainingMs(): number {
  const ctx = deadlineContext.getStore();
  return ctx ? Math.max(0, ctx.deadline - Date.now()) : 5000;
}
```

```ts
// dùng: kiểm tra trước mỗi bước tốn kém, và truyền phần còn lại xuống dưới
async function handleOrder(dto: Dto) {
  checkDeadline('validate');
  const cart = await this.carts.find(dto.cartId);

  checkDeadline('pricing');
  const price = await this.pricing.calculate(cart, {
    timeoutMs: Math.min(2000, remainingMs()),      // không chờ lâu hơn thời gian còn lại
  });

  checkDeadline('persist');
  return this.orders.create(cart, price);
}
```

Và consumer với prefetch và kiểm tra tuổi job:

```ts
new Worker('orders', async (job) => {
  const ageMs = Date.now() - job.timestamp;
  if (ageMs > 5 * 60_000) {                        // ⑤ job quá cũ: bỏ, không xử lý
    staleJobs.inc({ queue: 'orders' });
    return { skipped: 'stale' };
  }
  return process(job.data);
}, {
  concurrency: 10,                                  // ⑥ bằng khả năng xử lý song song thật
  limiter: { max: 100, duration: 1000 },            // trần tốc độ để bảo vệ DB phía sau
});
```

```text
Kết quả trong kịch bản đột biến 6x:
  trước:  0 request bị từ chối · p99 = 90s · OOM · phục hồi 40 phút
  sau:    ~35% nhận 503 ngay · p99 của phần còn lại = 180ms
          · không OOM · phục hồi tức thì khi tải giảm
```

## Prediction

1. Hàng đợi không giới hạn, đột biến 6x trong 2 phút — chuyện gì xảy ra với độ trễ?
2. Với bộ nhớ?
3. Consumer xử lý 100/s, hàng đợi có 40.000 việc — việc cuối chờ bao lâu?
4. Client timeout 30 giây — bao nhiêu việc trong hàng đợi đó còn có nghĩa?
5. Hàng đợi giới hạn 500, cùng đột biến — bao nhiêu phần trăm thành công nhanh?
6. Phục hồi sau khi tải giảm: không giới hạn so với có giới hạn?
7. Từ chối request SAU khi đã query database — tiết kiệm được gì?
8. Từ chối ở biên trước khi làm gì — tiết kiệm được gì?
9. Client retry không có jitter, 1000 client cùng nhận lỗi — chuyện gì xảy ra sau backoff?
10. Có jitter — khác thế nào?
11. `writable.write()` trả về `false` mà code bỏ qua — chuyện gì xảy ra?
12. Prefetch = 1000 với consumer xử lý 10 việc/lúc — vấn đề gì?
13. Chỉ theo dõi queue depth, consumer chết và producer cũng chậm lại — có phát hiện được không?
14. Theo dõi oldest item age — có phát hiện được không?

<details>
<summary>Đáp án</summary>

1. Tăng **vô hạn** — mọi request đều chậm, không chỉ phần vượt.
2. Tăng cho tới **OOM** — mất cả việc đang xử lý dở.
3. `40.000 / 100 = 400 giây`.
4. Khoảng **3.000 việc đầu** — phần còn lại client đã bỏ.
5. Khoảng **70%** thành công nhanh, phần vượt nhận 503 ngay.
6. Không giới hạn: **rất lâu** (hàng tồn); có giới hạn: **tức thì**.
7. Gần như **không gì** — chi phí đã bỏ ra rồi.
8. **Toàn bộ chi phí xử lý.**
9. Tất cả retry **cùng lúc** — đột biến đồng bộ, thường tệ hơn lần đầu.
10. Retry **trải đều** theo thời gian.
11. Buffer phình trong bộ nhớ — **rò rỉ bộ nhớ** với dữ liệu lớn.
12. Consumer **ôm 1000 việc**, bộ nhớ tăng, phân phối không đều giữa các consumer.
13. **Khó** — depth có thể ổn định trong khi không việc nào được xử lý.
14. **Có** — tuổi tăng đều là tín hiệu rõ ràng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gửi tải gấp 5 lần khả năng trong 2 phút | Độ trễ, bộ nhớ, tỉ lệ lỗi? |
| Đo thời gian phục hồi sau khi tải giảm | Bao lâu để trở lại bình thường? |
| Thêm giới hạn đồng thời rồi lặp lại | Khác thế nào? |
| Tính `max_queue = throughput × timeout` | Giới hạn hiện tại có hợp lý không? |
| Liệt kê mọi hàng đợi trong hệ thống | Cái nào không có giới hạn? |
| Đọc file 2 GB bằng `readFile` | Bộ nhớ tăng bao nhiêu? |
| Dùng `pipeline` | Bao nhiêu? |
| Đặt prefetch = 1000 | Bộ nhớ consumer và phân phối việc? |
| Dừng consumer 10 phút rồi bật lại | Job cũ có bị bỏ không? |
| Cho 1000 client retry không jitter | Hình dạng tải sau backoff? |
| Kiểm tra `Retry-After` trong response 503 | Có không? |

## What Usually Goes Wrong

- **Hàng đợi không giới hạn** ở đâu đó trong chuỗi.
- **Không biết hàng đợi nào tồn tại** — TCP backlog, pool, buffer, stream.
- **Giới hạn đặt theo cảm tính** thay vì `throughput × timeout`.
- **Từ chối muộn**, sau khi đã tốn tài nguyên.
- **Không phân biệt ưu tiên** — bỏ cả checkout lẫn analytics.
- **Không có deadline propagation** → xử lý việc không ai còn chờ.
- **Retry không có jitter** → đột biến đồng bộ.
- **Không có ngân sách retry** → retry chiếm phần lớn tải.
- **Không trả `Retry-After`** → client đoán.
- **Bỏ qua giá trị trả về của `write()`** → buffer phình.
- **Prefetch quá cao** → consumer ôm việc, phân phối lệch.
- **Không theo dõi tuổi job cũ nhất.**
- **Autoscale thay vì shed load** → scale không kịp trong 2 phút, và làm sập database.
- **Coi 503 là thất bại** trong monitoring → gỡ bỏ chính cơ chế bảo vệ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Không từ chối request nào là tử tế | Nó làm mọi request hỏng thay vì một phần |
| Hàng đợi lớn hấp thụ được đột biến | Nó chỉ hoãn và khuếch đại vấn đề |
| Autoscaling thay được backpressure | Scale mất phút; đột biến tính bằng giây |
| Backpressure chỉ liên quan tới stream | Nó là khái niệm cho mọi ranh giới producer/consumer |
| 503 là thất bại | Từ chối lịch sự là hành vi đúng khi quá tải |
| Retry luôn cải thiện độ tin cậy | Khi quá tải, nó làm mọi thứ tệ hơn |
| Timeout ở client là đủ | Server vẫn làm việc vô nghĩa nếu không có deadline |
| Prefetch cao tăng throughput | Nó gây mất cân bằng và tăng bộ nhớ |
| Queue depth là chỉ số đủ | Tuổi item cũ nhất nói nhiều hơn |
| Chỉ hệ thống lớn mới cần | Một endpoint chậm cũng đủ làm cạn pool |

## Debugging

1. **Liệt kê mọi hàng đợi** trong đường đi của request và ghi giới hạn hiện tại của từng cái. Cái không có giới hạn là nghi phạm.
2. **Tính `W = L / λ`** cho hàng đợi đang dài — so với timeout của client để biết bao nhiêu việc đã vô nghĩa.
3. **Độ trễ tăng nhưng throughput không tăng** → đang xếp hàng ở đâu đó.
4. **Bộ nhớ tăng cùng với tải và không giảm** → buffer hoặc hàng đợi trong process.
5. **Kiểm tra `oldest item age`**, không chỉ depth.
6. **Đếm tỉ lệ retry trong tổng request** — nếu cao, retry đang là một phần của vấn đề.
7. **Sau khi tải giảm mà hệ thống vẫn chậm** → đang xử lý hàng tồn; kiểm tra có bỏ job quá cũ không.
8. **Kiểm tra hành vi phục hồi** trong load test spike, không chỉ hành vi lúc đỉnh.

## Production Considerations

- **Mọi hàng đợi phải có giới hạn**, đặt theo `throughput × timeout_chấp_nhận_được`.
- **Giới hạn số đồng thời ở biên**, đo từ load test.
- **Từ chối sớm và rẻ**, trước khi làm việc.
- **Phân loại ưu tiên**: đường sinh doanh thu và đăng nhập không bao giờ bị bỏ.
- **Deadline propagation** và kiểm tra trước mỗi bước tốn kém.
- **Bỏ job quá cũ** trong consumer.
- **`Retry-After` trong 429/503.**
- **Retry có backoff + jitter + ngân sách + circuit breaker.**
- **`pipeline` cho stream**, không tự nối `write()`.
- **Prefetch bằng khả năng xử lý song song thật**, cộng biên nhỏ.
- **Theo dõi**: số đang xử lý, tỉ lệ bị từ chối, queue depth, **tuổi item cũ nhất**.
- **Coi tỉ lệ shed là chỉ số bình thường**, không phải lỗi — alert khi nó vượt ngưỡng, không alert khi nó khác 0.
- **Test hành vi quá tải** trong spike test, gồm cả thời gian phục hồi.
- **Chaos test**: dừng consumer, làm chậm dependency, xem hệ thống có suy giảm lịch sự không.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Hàng đợi không giới hạn | không mất request | sập, phục hồi lâu |
| Hàng đợi có giới hạn | ổn định, phục hồi nhanh | từ chối một phần |
| Giới hạn chặt | bảo vệ tốt | từ chối cả khi còn khả năng |
| Giới hạn lỏng | tận dụng tối đa | rủi ro quá tải |
| Từ chối sớm | rẻ | có thể từ chối request lẽ ra phục vụ được |
| Từ chối muộn | quyết định chính xác hơn | đã tốn tài nguyên |
| Deadline propagation | không lãng phí | phức tạp, phải truyền qua mọi tầng |
| Ưu tiên theo loại | giữ đường quan trọng | phức tạp, cần phân loại đúng |
| Autoscaling | tăng khả năng thật | chậm, và có thể làm sập dependency |
| Load shedding | tức thì | từ chối người dùng thật |

## Explain Without Notes

1. Vì sao hàng đợi không giới hạn là cách hỏng tệ nhất?
2. Dùng định luật Little để đặt giới hạn hàng đợi như thế nào?
3. Kể sáu hàng đợi ẩn trong một ứng dụng web điển hình.
4. Bốn cơ chế backpressure và thứ tự nên áp dụng?
5. Vì sao "bỏ sớm, bỏ rẻ"?
6. Deadline propagation giải quyết vấn đề gì khi hệ thống quá tải?
7. Ba biện pháp bắt buộc đi cùng retry, và vì sao jitter quan trọng?
8. Vì sao `oldest item age` là tín hiệu tốt hơn queue depth?

## Related

- [Latency & bottleneck](01-latency-throughput-bottleneck.md) — định luật Little và hàng đợi
- [Backend performance](03-backend-performance.md) — pool và event loop
- [Profiling & load testing](05-profiling-load-testing.md) — đo giới hạn thật
- [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md) — retry an toàn
- [Graceful degradation](../reliability/03-graceful-degradation.md) — suy giảm có kiểm soát
- [Capacity & limits](../reliability/04-capacity-and-limits.md) — lập kế hoạch dung lượng
- [Why queue](../../03-database/04-message-queues/01-why-queue.md) — hàng đợi như một công cụ
- [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md) — giới hạn ở biên
- [Streams](../../02-backend-api/01-nodejs/02-streams-buffers.md) — backpressure trong Node.js
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — hàng đợi trước database

## Version / Context

Ví dụ dùng Node.js 20+ (`stream/promises.pipeline`, `AsyncLocalStorage`), NestJS 10/11, BullMQ (`concurrency`, `limiter`). `Retry-After` theo RFC 9110 (giá trị là số giây hoặc HTTP-date). Khái niệm bulkhead và circuit breaker theo Michael Nygard (*Release It!*); deadline propagation là mẫu phổ biến trong gRPC (`context.WithTimeout`) và được áp dụng lại ở tầng HTTP.
