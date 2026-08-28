---
level: advanced
area: backend
prerequisites:
  - 06-database-integration-transactions.md
  - ../../../03-database/02-redis/01-cache-invalidation.md
related:
  - ../../../03-database/04-message-queues/01-why-queue.md
  - ../../../03-database/04-message-queues/03-retry-dlq.md
  - ../../../03-database/02-redis/03-cache-patterns.md
---

# Caching, queues & jobs

> Endpoint `POST /reports` mất 40 giây: query 2 triệu dòng, render PDF, upload S3, gửi email. Bạn tăng timeout của nginx lên 60 giây và nó "hoạt động". Ba tuần sau, dữ liệu tăng gấp đôi, timeout lại nổ, và lúc này 8 request đồng thời giữ 8 connection trong 40 giây mỗi cái — cả API chết, kể cả những endpoint không liên quan.

## Position

```text
Request ──▶ NestJS ──▶ [cache?] ──▶ service ──▶ PostgreSQL
              │
              ├──▶ enqueue job ──▶ Redis (BullMQ) ──▶ WORKER (process khác)
              │         (trả về ngay)                     │
              │                                            ├──▶ PostgreSQL
              └──▶ @Cron scheduler                         └──▶ S3 / email / webhook
                    (chạy trên MỌI replica — vấn đề riêng)
```

Note này về ba cơ chế giải quyết ba câu hỏi khác nhau:

```text
CACHE      — "có thể KHÔNG làm việc này không?"        (tránh việc)
QUEUE      — "có thể làm việc này SAU không?"           (hoãn việc)
SCHEDULE   — "có thể làm việc này ĐỊNH KỲ không?"       (chủ động)
```

## Problem

### Vấn đề 1: request đồng bộ giữ tài nguyên

Một request HTTP giữ: một connection từ client, một socket, một chỗ trong connection pool nếu nó đang query, và bộ nhớ cho state của nó. Với 40 giây × 8 request đồng thời, bạn không chỉ làm chậm 8 người dùng — bạn làm cạn tài nguyên dùng chung.

Đây là một tính chất khó chấp nhận nhưng đúng: **latency của endpoint chậm nhất quyết định capacity của toàn bộ service**, nếu chúng dùng chung pool.

Nguyên tắc phân loại:

```text
NGƯỜI DÙNG PHẢI CHỜ (đồng bộ):  kết quả cần cho bước tiếp theo của họ
                                 → đọc dữ liệu, ghi dữ liệu, validate

NGƯỜI DÙNG KHÔNG CẦN CHỜ (queue): kết quả không thay đổi màn hình kế tiếp
                                 → email, PDF, thumbnail, webhook, đồng bộ hệ thống ngoài,
                                   tính toán nặng, gọi API bên thứ ba chậm
```

Câu hỏi kiểm tra: *"nếu việc này hoàn tất sau 30 giây thay vì ngay lập tức, người dùng có bị chặn không?"* Nếu không → queue.

### Vấn đề 2: cache trong bộ nhớ nói dối khi có nhiều instance

```ts
@Injectable()
export class SettingsService {
  private cache = new Map<string, Settings>();      // ❌
}
```

Một instance: hoạt động. Ba instance sau load balancer:

```text
t=0   user sửa setting → request tới instance A → A xoá cache của A
t=1   user F5           → request tới instance B → B trả cache CŨ
t=2   user F5 lần nữa   → request tới instance C → C trả cache CŨ (khác của B nữa)
```

Người dùng thấy giá trị **nhảy qua nhảy lại** giữa cũ và mới tuỳ vào load balancer định tuyến đâu. Đây là bug được báo cáo là "lúc được lúc không" và tốn rất nhiều thời gian nếu không nghĩ tới nhiều instance.

### Vấn đề 3: cron chạy trên mọi replica

```ts
@Cron('0 2 * * *')
async sendDailyDigest() {
  const users = await this.users.findAll();
  for (const u of users) await this.mailer.sendDigest(u);
}
```

Ba replica → **ba email mỗi ngày cho mỗi người dùng**. Và với job kiểu "tính hoá đơn", ba lần tính. Đây có lẽ là lỗi phổ biến nhất khi một app Nest lần đầu được scale lên nhiều pod, vì ở local nó luôn đúng.

## Mental Model

### Cache: bốn lớp, bốn phạm vi

```text
Browser HTTP cache   → mỗi người dùng      → Cache-Control
CDN                  → toàn cầu, công khai → chỉ cho nội dung không riêng tư
App in-memory        → MỖI INSTANCE        → nhanh nhất, không nhất quán
Redis                → dùng chung          → chậm hơn ~1ms, NHẤT QUÁN
```

Quyết định nằm ở một câu hỏi: **nếu hai instance trả lời khác nhau thì có sao không?**

- Danh mục quốc gia, tỉ giá cập nhật hàng giờ → in-memory ổn.
- Quyền của người dùng, tồn kho, cấu hình có thể sửa → **bắt buộc Redis**, hoặc không cache.

### Queue: bốn tính chất bắt buộc của một job

```text
1. IDEMPOTENT   — chạy 2 lần cho cùng kết quả như chạy 1 lần
2. NHỎ          — chia được, có checkpoint; job 30 phút không sống qua nổi một lần deploy
3. RETRY ĐƯỢC   — lỗi tạm thời tự khỏi; lỗi vĩnh viễn đi thẳng DLQ
4. QUAN SÁT ĐƯỢC — biết đang chờ bao nhiêu, thất bại bao nhiêu, chậm bao lâu
```

Tính chất 1 không phải tuỳ chọn. Mọi hệ thống queue thực tế là **at-least-once**: worker crash sau khi làm xong nhưng trước khi ack → job chạy lại. "Exactly-once" không tồn tại ở tầng vận chuyển; nó chỉ đạt được bằng cách làm consumer idempotent. Xem [Delivery semantics](../../../03-database/04-message-queues/02-delivery-semantics.md).

### Ba mô hình triển khai worker

```text
A. Cùng process với API
   + đơn giản nhất, một deployment
   - job nặng ăn CPU của API; scale chung, không tách được

B. Process riêng, cùng codebase
   + tách tài nguyên, scale riêng, cùng model/service
   - hai deployment, hai lần cấu hình

C. Service riêng
   + độc lập hoàn toàn
   - trùng lặp code, phải version hoá payload
```

Mặc định nên là **B**: cùng repo, cùng `AppModule` nhưng bootstrap khác nhau, hai Deployment trên K8s. A chấp nhận được lúc đầu nhưng phải biết rằng bạn đang trì hoãn quyết định.

## How It Works

### Cache trong NestJS

```ts
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        stores: [createKeyv(cfg.getOrThrow('REDIS_URL'))],   // Redis, KHÔNG phải in-memory
        ttl: 60_000,                                          // ms
      }),
    }),
  ],
})
export class AppModule {}
```

```ts
@Injectable()
export class ProjectsService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async findOne(id: string, tenantId: string) {
    const key = `project:${tenantId}:${id}`;              // tenant TRONG key — bắt buộc
    const hit = await this.cache.get<Project>(key);
    if (hit) return hit;

    const project = await this.repo.findOne(id, tenantId);
    if (project) await this.cache.set(key, project, 60_000);
    return project;
  }

  async update(id: string, tenantId: string, dto: UpdateProjectDto) {
    const updated = await this.repo.update(id, tenantId, dto);
    await this.cache.del(`project:${tenantId}:${id}`);     // xoá SAU khi ghi
    return updated;
  }
}
```

Bốn quyết định trong 15 dòng đó:

1. **`tenantId` trong key.** Thiếu nó là rò rỉ dữ liệu chéo tenant — lớp lỗi nghiêm trọng nhất của caching.
2. **Xoá cache *sau* khi ghi DB**, không phải trước. Xoá trước thì một request đọc xen vào giữa sẽ nạp lại giá trị cũ và cache lại nó.
3. **Xoá, không cập nhật.** `del` rồi để lần đọc sau nạp lại đơn giản và ít sai hơn `set` giá trị mới (giá trị mới có thể đã lỗi thời so với một ghi khác).
4. **TTL luôn có.** TTL là mạng lưới an toàn cho invalidation mà bạn quên. Cache không TTL là cache sai vĩnh viễn.

Vẫn còn một khe hở: giữa `repo.update` và `cache.del`, một request khác có thể đọc giá trị cũ và ghi lại vào cache **sau** khi `del` chạy. Xác suất thấp nhưng khác 0. Giải pháp đầy đủ (delayed double delete, versioned key) ở [Cache invalidation](../../../03-database/02-redis/01-cache-invalidation.md).

### Cache stampede

```text
key hết hạn lúc 12:00:00
→ 500 request đồng thời đều miss
→ 500 query giống hệt nhau đập vào PostgreSQL
→ DB chậm → request chậm → hàng đợi dài → sập
```

Cách rẻ nhất: cho phép **một** người nạp lại, số còn lại chờ hoặc dùng giá trị cũ.

```ts
async getWithLock<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await this.cache.get<T>(key);
  if (hit !== undefined) return hit;

  const lockKey = `lock:${key}`;
  const got = await this.redis.set(lockKey, '1', 'PX', 5_000, 'NX');   // chỉ 1 người thắng
  if (!got) {
    await sleep(50);
    return (await this.cache.get<T>(key)) ?? load();                    // fallback: tự làm
  }
  try {
    const value = await load();
    await this.cache.set(key, value, ttlMs);
    return value;
  } finally {
    await this.redis.del(lockKey);
  }
}
```

Thêm jitter vào TTL (`ttl ± 10%`) để các key không hết hạn cùng lúc — đặc biệt quan trọng sau khi restart, khi mọi thứ được nạp trong cùng một giây.

### Queue với BullMQ

```ts
// module
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({ connection: { url: cfg.getOrThrow('REDIS_URL') } }),
}),
BullModule.registerQueue({
  name: 'reports',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },   // 2s, 4s, 8s, 16s
    removeOnComplete: { age: 3600, count: 1_000 },     // KHÔNG giữ mãi — Redis là RAM
    removeOnFail: { age: 7 * 24 * 3600 },              // giữ lâu hơn để điều tra
  },
});
```

```ts
// producer — endpoint trả về NGAY
@Post('reports')
async create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthUser) {
  const report = await this.reports.createPending(dto, user.id);   // 202 + id để hỏi trạng thái
  await this.queue.add('generate', { reportId: report.id }, {
    jobId: `report:${report.id}`,        // ID ỔN ĐỊNH → chống enqueue trùng
  });
  return { id: report.id, status: 'pending' };
}
```

```ts
// consumer
@Processor('reports', { concurrency: 5 })
export class ReportsProcessor extends WorkerHost {
  async process(job: Job<{ reportId: string }>) {
    const report = await this.repo.findById(job.data.reportId);

    if (report.status === 'done') return report.url;      // IDEMPOTENT: đã làm rồi thì thôi
    if (!report) throw new UnrecoverableError('report deleted');   // KHÔNG retry

    await job.updateProgress(10);
    const rows = await this.repo.streamRows(report.query);   // stream, không load hết vào RAM
    await job.updateProgress(50);
    const url = await this.storage.upload(await renderPdf(rows));
    await this.repo.markDone(report.id, url);
    return url;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error({ jobId: job.id, attempts: job.attemptsMade, err: err.message }, 'job failed');
  }
}
```

Ba chi tiết quyết định job này sống được ở production:

**`jobId` ổn định.** Người dùng bấm nút hai lần → hai request → nhưng cùng `jobId` → BullMQ chỉ nhận một. Đây là idempotency ở phía *producer*.

**Kiểm tra trạng thái ở đầu `process`.** Đây là idempotency ở phía *consumer*, và nó là lớp thật sự bảo vệ bạn — vì worker có thể crash sau khi làm xong nhưng trước khi ack, và khi đó job chạy lại với cùng `jobId`.

**`UnrecoverableError` cho lỗi vĩnh viễn.** Retry một job mà dữ liệu của nó đã bị xoá là lãng phí 5 lần và làm nhiễu log. Phân loại lỗi là việc của bạn, không phải của queue:

```text
tạm thời  → retry:      timeout mạng, 503 từ API ngoài, deadlock, Redis mất kết nối
vĩnh viễn → DLQ ngay:   payload sai định dạng, bản ghi không tồn tại, 400 từ API ngoài
```

Xem [Retry & DLQ](../../../03-database/04-message-queues/03-retry-dlq.md).

### Worker là process riêng

```ts
// worker.ts — bootstrap khác, không listen HTTP
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  // không có app.listen()
}
```

```yaml
# hai Deployment, hai profile tài nguyên, scale độc lập
api:    replicas: 3, cpu: 500m
worker: replicas: 2, cpu: 2000m
```

Lợi ích cụ thể chứ không phải lý thuyết: một job render PDF ăn 100% CPU **không** làm event loop của API bị đói, và bạn scale worker theo độ dài hàng đợi thay vì theo số request. Xem [Worker threads & CPU](../../01-nodejs/runtime-io/02-worker-threads-cpu.md) cho trường hợp phải giữ trong cùng process.

### Scheduled job: giải quyết chuyện chạy trên mọi replica

Ba cách, tăng dần về độ chắc chắn:

```ts
// (1) Distributed lock — đơn giản, đủ cho hầu hết trường hợp
@Cron('0 2 * * *')
async dailyDigest() {
  const token = randomUUID();
  const got = await this.redis.set('cron:digest', token, 'PX', 10 * 60_000, 'NX');
  if (!got) return;                                   // replica khác đã nhận
  try {
    await this.doWork();
  } finally {
    // chỉ xoá nếu lock vẫn là của mình (tránh xoá lock của người khác sau khi hết hạn)
    if (await this.redis.get('cron:digest') === token) await this.redis.del('cron:digest');
  }
}
```

```text
(2) Kubernetes CronJob   — pod riêng, chạy đúng một lần, log riêng, retry riêng
                            Nhược điểm: khởi động chậm hơn, phải đóng gói entrypoint riêng.

(3) Job lặp lại của BullMQ (repeatable job) — queue tự đảm bảo một lần, và bạn được
    retry/DLQ/observability miễn phí như mọi job khác.
```

Lưu ý về (1): lock có TTL, và nếu công việc chạy **lâu hơn** TTL thì replica khác có thể nhận lock giữa chừng và chạy song song. Không có cách nào làm distributed lock đúng tuyệt đối chỉ với TTL — đó là lý do job vẫn phải idempotent kể cả khi đã có lock. Xem [Distributed locks](../../../05-cross-cutting/concurrency/03-distributed-locks.md).

Với việc quan trọng về tiền bạc hoặc gửi ra ngoài, (2) hoặc (3) đáng giá hơn (1).

### Shutdown: nơi job bị mất

```ts
// BullMQ tự xử lý nếu bạn để Nest quản lý worker và đã bật shutdown hook
app.enableShutdownHooks();
// thứ tự: ngừng nhận job mới → chờ job hiện tại xong → đóng Redis → đóng DB
```

Nếu job chạy lâu hơn `terminationGracePeriodSeconds`, nó bị SIGKILL giữa chừng. Không có cấu hình nào cứu được điều đó — chỉ có thiết kế: **job phải có checkpoint và phải idempotent**, để lần chạy lại không tốn công và không tạo dữ liệu trùng.

```ts
// checkpoint: ghi tiến độ để lần sau tiếp tục, không làm lại từ đầu
for (const chunk of chunks) {
  if (chunk.index <= report.lastProcessedChunk) continue;   // bỏ qua phần đã xong
  await this.process(chunk);
  await this.repo.saveProgress(report.id, chunk.index);
}
```

## Example

Chuyển một endpoint 40 giây thành 200 mili giây:

```text
TRƯỚC                                    SAU
POST /reports                            POST /reports
  query 2M rows      (12s)                 tạo bản ghi status=pending   (30ms)
  render PDF         (18s)                 queue.add({reportId})         (5ms)
  upload S3          (8s)                  → 202 { id, status:'pending' }
  send email         (2s)
  → 200 { url }                          GET /reports/:id  → { status, url? }
                                          (hoặc WebSocket/SSE báo khi xong)
```

Cái được không chỉ là 200ms. Cái được thật sự là: request timeout không còn làm mất công việc, retry là tự động, và một report lớn không còn làm chậm những người dùng khác.

Cái mất: client phải xử lý trạng thái `pending`, và bạn vừa thêm Redis vào danh sách những thứ có thể chết.

## Prediction

1. Cache bằng `Map` trong bộ nhớ, 3 replica, user sửa dữ liệu rồi F5 nhiều lần — họ thấy gì?
2. Cache key không có `tenantId`, tenant A đọc rồi tenant B đọc cùng resource id — B thấy gì?
3. Key hết hạn lúc tải cao, 500 request cùng miss — DB nhận bao nhiêu query?
4. `@Cron` trên 3 replica, không có lock — job chạy mấy lần?
5. Có Redis lock nhưng job chạy 15 phút, lock TTL 10 phút — có thể chạy song song không?
6. Job không có `jobId` ổn định, người dùng bấm nút 3 lần — bao nhiêu job?
7. Worker crash **sau** khi upload S3 nhưng **trước** khi ack — chuyện gì xảy ra khi retry? File S3 thế nào?
8. `attempts: 5`, `backoff exponential 2s`, lỗi vĩnh viễn (bản ghi đã xoá) — mất bao lâu để job vào DLQ? Có đáng không?
9. `removeOnComplete` không đặt, 1 triệu job/ngày — Redis thế nào sau một tuần?
10. Job chạy 10 phút, `terminationGracePeriodSeconds: 30`, deploy — job thế nào?
11. Xoá cache **trước** khi ghi DB, một request đọc xen vào giữa — cache chứa gì sau đó?
12. Worker cùng process với API, job dùng 100% CPU 5 giây — health check của API thế nào?

<details>
<summary>Đáp án</summary>

1. Giá trị nhảy giữa cũ và mới tuỳ instance nào phục vụ. Báo cáo sẽ là "lúc được lúc không".
2. B thấy dữ liệu của A. Rò rỉ dữ liệu chéo tenant.
3. **500 query giống hệt nhau** — cache stampede. Có thể đủ để làm sập DB.
4. **3 lần.** Ba email cho mỗi người dùng.
5. **Có.** Lock hết hạn khi job chưa xong → replica khác nhận. Đây là lý do job vẫn phải idempotent.
6. **3 job.** Ba report giống hệt nhau.
7. Job chạy lại. Nếu không kiểm tra trạng thái ở đầu → upload lần hai, có hai file, và có thể gửi hai email.
8. 2+4+8+16 = 30 giây cho một lỗi không bao giờ tự khỏi. Không đáng — dùng `UnrecoverableError`.
9. Redis phình cho tới khi chạm `maxmemory`, rồi tuỳ policy: từ chối ghi hoặc evict cả những key đang cần. Xem [Eviction & memory](../../../03-database/02-redis/04-eviction-memory.md).
10. SIGKILL ở giây 30, job mất giữa chừng. Nó sẽ được retry — và nếu không idempotent, phần đã làm bị làm lại.
11. Giá trị **cũ**, và nó sống tới hết TTL. Đây là lý do phải xoá sau khi ghi.
12. Event loop bị chặn → health check timeout → K8s restart pod → job bị giết → retry → lặp lại. Xem [Node runtime & concurrency](../../01-nodejs/fundamentals/01-runtime-concurrency.md).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy 3 instance với cache in-memory, sửa dữ liệu, F5 20 lần | Đếm số lần thấy giá trị cũ |
| Bỏ `tenantId` khỏi cache key, đăng nhập 2 tenant | Dữ liệu chéo |
| Xoá key thủ công (`DEL`) khi đang có tải, đếm query ở DB | Stampede |
| Thêm lock + jitter, lặp lại | Số query về 1 |
| Deploy 3 replica có `@Cron` mỗi phút ghi log | Đếm dòng log mỗi phút |
| Thêm Redis lock, lặp lại | 1 dòng |
| Đặt lock TTL 5s cho job chạy 20s | Job chạy song song — chứng minh lock không đủ |
| Bỏ kiểm tra trạng thái ở đầu `process`, kill worker giữa chừng | Đếm số file S3 / số email |
| Kill worker **sau** khi làm xong, trước khi ack | Job chạy lại; hệ quả tuỳ mức idempotent |
| `attempts: 5` cho lỗi vĩnh viễn | Đo thời gian tới DLQ và số dòng log rác |
| Bỏ `removeOnComplete`, đẩy 100k job | Đo `INFO memory` của Redis |
| Job 10 phút + grace period 30s, `kubectl rollout restart` | Job bị giết; kiểm tra dữ liệu nửa vời |
| Worker cùng process API, job CPU 5s, gọi `/health` song song | Health check timeout |
| Redis tắt hoàn toàn khi API đang chạy | Endpoint đọc còn hoạt động không? (nên có: cache miss = đi DB) |

Dòng cuối là bài test quan trọng nhất về khả năng chống chịu: **cache chết phải làm hệ thống chậm, không phải chết.** Nếu `cache.get` ném lỗi và bạn không bắt, Redis chết kéo theo API chết.

```ts
async getCached<T>(key: string): Promise<T | undefined> {
  try { return await this.cache.get<T>(key); }
  catch (e) { this.logger.warn({ e }, 'cache unavailable'); return undefined; }   // degrade
}
```

## What Usually Goes Wrong

- **Cache in-memory với nhiều replica** → không nhất quán, "lúc được lúc không".
- **Key thiếu chiều tenant/user** → rò rỉ dữ liệu. Lỗi nghiêm trọng nhất trong note này.
- **Cache không TTL** → sai vĩnh viễn khi invalidation có lỗ hổng.
- **Xoá cache trước khi ghi DB** → cache lại giá trị cũ.
- **Không chống stampede** → key hết hạn thành sự cố.
- **Redis chết kéo theo API chết** → cache trở thành single point of failure thay vì tối ưu hoá.
- **`@Cron` không có lock** → chạy N lần với N replica.
- **Lock TTL ngắn hơn thời gian chạy** → chạy song song dù có lock.
- **Job không idempotent** → email trùng, tiền trừ hai lần, file trùng.
- **Không phân loại lỗi** → retry lỗi vĩnh viễn 5 lần, hoặc không retry lỗi tạm thời.
- **Không có DLQ hoặc không ai nhìn DLQ** → job chết im lặng; phát hiện khi khách hàng hỏi.
- **Không giới hạn job đã hoàn thành** → Redis hết bộ nhớ.
- **Job quá dài** → không sống qua nổi một lần deploy.
- **Worker cùng process API** → job CPU làm chết health check.
- **Không đo độ dài hàng đợi** → hàng đợi dài dần trong nhiều ngày mà không ai biết.
- **Enqueue trong transaction rồi transaction rollback** → job xử lý một bản ghi không tồn tại. Dùng outbox: [Outbox pattern](../../../03-database/04-message-queues/06-outbox-pattern.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cache là tối ưu hoá vô hại | Nó thêm một nguồn sự thật thứ hai — và hai nguồn thì sẽ lệch |
| In-memory cache đủ dùng | Chỉ đúng khi có đúng một instance, mãi mãi |
| TTL ngắn thì không cần invalidation | TTL 60s nghĩa là dữ liệu có thể sai 60 giây |
| Queue đảm bảo exactly-once | At-least-once; exactly-once phải do consumer tạo ra |
| Job thất bại thì sẽ có người biết | Chỉ khi có alert trên DLQ |
| `@Cron` chạy một lần | Chạy trên **mọi** replica |
| Distributed lock giải quyết triệt để | Lock có TTL; job vẫn phải idempotent |
| Redis persistent nên job an toàn | Tuỳ cấu hình; AOF `everysec` có thể mất 1 giây cuối |
| Worker cùng process là tiết kiệm | Đúng về hạ tầng, sai về cô lập lỗi |
| Cache chết thì chỉ chậm hơn | Chỉ nếu bạn viết code để nó chỉ chậm hơn |

## Debugging

1. **Dữ liệu cũ xuất hiện** → in-memory hay Redis? Nếu in-memory và >1 replica, dừng lại, nguyên nhân là đây.
2. **Dữ liệu của người khác xuất hiện** → in cache key thật ra log. Gần như luôn thiếu một chiều.
3. **DB đột ngột tăng tải theo chu kỳ** → khớp thời điểm với TTL. Nhiều key hết hạn cùng lúc.
4. **Job không chạy** → theo thứ tự: worker có sống không (`kubectl get pods`) → có kết nối Redis không → tên queue producer và consumer có **giống hệt** nhau không (lỗi gõ sai tên queue là im lặng tuyệt đối) → job có trong `waiting` không (`bull-board` hoặc `LLEN bull:reports:wait`).
5. **Job chạy nhiều lần** → xem `attemptsMade`. Nếu là 1 mà vẫn chạy lại → producer enqueue trùng hoặc worker crash trước khi ack.
6. **Job chạy chậm dần** → độ dài hàng đợi tăng nghĩa là tốc độ vào > tốc độ ra. Tăng `concurrency` hay tăng số worker là hai lựa chọn khác nhau (CPU-bound vs I/O-bound).
7. **Cron chạy nhiều lần** → đếm số replica trước tiên.
8. **Redis đầy** → `INFO memory`, `--bigkeys`. Thường là job history không được dọn.

## Production Considerations

- **Bốn metric queue tối thiểu**: độ dài hàng đợi (`waiting`), tuổi job cũ nhất, tỉ lệ thất bại, thời gian xử lý p95. Trong đó **tuổi job cũ nhất** là tín hiệu tốt nhất — nó phát hiện worker chết trong khi độ dài hàng đợi có thể vẫn nhỏ.
- **Alert trên DLQ.** DLQ không có alert là một thư mục rác.
- **Tách worker khỏi API** trước khi bạn *cần* — chuyển sau tốn nhiều công hơn.
- **Autoscale worker theo độ dài hàng đợi**, không theo CPU (KEDA làm việc này). CPU của worker có thể thấp trong khi hàng đợi dài, nếu job là I/O-bound.
- **`removeOnComplete`/`removeOnFail` là bắt buộc.** Redis là RAM.
- **Cache phải fail-open.** Bọc mọi thao tác cache trong try/catch.
- **Đo cache hit rate.** Dưới ~70% thường nghĩa là TTL quá ngắn hoặc key quá phân mảnh — và một cache hit rate thấp là chi phí thuần (thêm một round-trip cho mỗi miss).
- **Đặt `maxmemory-policy`** phù hợp: `allkeys-lru` cho cache thuần; **không** dùng cho instance chứa cả queue — job sẽ bị evict. Tách Redis cache và Redis queue nếu tải lớn.
- **Version hoá payload của job.** Job đang nằm trong hàng đợi khi bạn deploy code mới; code mới phải đọc được payload cũ.
- **Không nhét object lớn vào payload.** Nhét id, worker tự đọc. Payload lớn làm Redis phình và làm job khó debug.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cache in-memory | nhanh nhất, không thêm hạ tầng | không nhất quán khi >1 instance |
| Cache Redis | nhất quán, dùng chung | +1ms mỗi lần, thêm một thứ có thể chết |
| TTL dài | ít tải DB | dữ liệu cũ lâu hơn |
| TTL ngắn | tươi hơn | ít lợi ích, dễ stampede |
| Xử lý đồng bộ | đơn giản, kết quả ngay | giữ tài nguyên, timeout, không retry |
| Queue | co giãn, retry, cô lập lỗi | phức tạp, cần idempotency, cần quan sát |
| Worker cùng process | một deployment | không cô lập tài nguyên |
| Worker riêng | cô lập, scale riêng | hai deployment, hai bộ cấu hình |
| `@Cron` + lock | đơn giản, cùng codebase | lock có TTL, không tuyệt đối |
| K8s CronJob | đảm bảo một lần, log riêng | khởi động chậm, thêm artifact |
| Retry nhiều | chịu lỗi tạm thời tốt | khuếch đại tải khi downstream đang chết |
| Retry ít | không làm downstream tệ hơn | mất việc khi lỗi thoáng qua |

Dòng áp chót đáng nhớ: retry hung hăng khi downstream đang quá tải là cách biến một sự cố nhỏ thành một sự cố lớn. Retry phải có backoff, jitter, và giới hạn. Xem [Timeout, retry & circuit breaker](../../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## Explain Without Notes

1. Câu hỏi nào quyết định một việc nên đồng bộ hay đưa vào queue?
2. Vì sao cache in-memory sai khi có nhiều replica? Mô tả triệu chứng mà người dùng thấy.
3. Cache stampede xảy ra thế nào, và hai cách rẻ để chống?
4. Vì sao mọi job phải idempotent kể cả khi queue "đảm bảo" delivery?
5. `@Cron` trên 3 replica gây chuyện gì, và ba cách sửa khác nhau ở điểm nào?
6. Vì sao distributed lock có TTL không đủ để đảm bảo chạy một lần?
7. Điều gì xảy ra với một job 10 phút khi deploy, và thiết kế nào làm nó chấp nhận được?

## Related

- [Vì sao cần queue](../../../03-database/04-message-queues/01-why-queue.md) — vấn đề nền
- [Delivery semantics](../../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once và idempotency
- [Retry & DLQ](../../../03-database/04-message-queues/03-retry-dlq.md) — phân loại lỗi, backoff
- [Outbox pattern](../../../03-database/04-message-queues/06-outbox-pattern.md) — enqueue nguyên tử với ghi DB
- [Cache invalidation](../../../03-database/02-redis/01-cache-invalidation.md) — invalidation đầy đủ
- [Cache patterns](../../../03-database/02-redis/03-cache-patterns.md) — cache-aside, write-through
- [Eviction & memory](../../../03-database/02-redis/04-eviction-memory.md) — `maxmemory-policy`
- [Distributed locks](../../../05-cross-cutting/concurrency/03-distributed-locks.md) — giới hạn của lock
- [Worker threads & CPU](../../01-nodejs/runtime-io/02-worker-threads-cpu.md) — khi phải ở cùng process
- [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md) — đóng worker đúng cách
- [Autoscaling](../../../04-infrastructure/04-kubernetes/scheduling-reliability/03-autoscaling.md) — scale theo độ dài hàng đợi

## Version / Context

NestJS 10/11, `@nestjs/bullmq` với BullMQ 5, `@nestjs/cache-manager` 2/3 (cache-manager 5/6 dùng Keyv làm store). Redis 7.
