---
level: intermediate
area: database
prerequisites:
  - ../01-postgresql/indexes-query-planning/01-index-query-plan.md
related:
  - 03-cache-patterns.md
  - 04-eviction-memory.md
  - ../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md
---

# Cache & invalidation

> Người dùng đổi tên hiển thị. Trang profile cập nhật ngay. Nhưng tên cũ vẫn xuất hiện trong danh sách thành viên, trong header, và trong kết quả tìm kiếm — mỗi chỗ hết hạn vào một thời điểm khác nhau. Tính năng "đổi tên" không hỏng. Cái hỏng là bạn có **bốn bản sao của một sự thật** và chỉ cập nhật một.

## Position

```text
Browser cache → CDN → Next.js cache → REDIS → PostgreSQL
                                       ↑ note này
                                       (nguồn sự thật vẫn là PostgreSQL)
```

Note này về **cache như một khái niệm** — vì sao nó tồn tại, nó tạo ra vấn đề gì, và invalidation. Redis chỉ là công cụ để quan sát điều đó. Các mẫu cụ thể ở [Cache patterns](03-cache-patterns.md).

## Problem

### Vì sao cần cache

```text
Query PostgreSQL (có index, cùng datacenter)     1–10 ms
Query PostgreSQL (JOIN 4 bảng, aggregate)       50–500 ms
Redis GET (cùng mạng)                          0,2–1 ms
Bộ nhớ trong process                          0,0001 ms
```

Nhưng con số không phải lý do chính. Lý do chính là **hình dạng của tải**:

```text
Trang chủ gọi cùng một query "top 20 sản phẩm" 10.000 lần/phút.
Dữ liệu đổi 3 lần/ngày.
⇒ 9.999 lần trong số đó là công việc lặp lại hoàn toàn.
```

Cache biến 10.000 query thành 3.

### Cái giá: hai nguồn sự thật

Khoảnh khắc bạn thêm cache, bạn có **hai bản sao** của cùng một dữ liệu. Và hai bản sao thì sẽ lệch.

```text
t=0   PostgreSQL: name = "An"      Redis: name = "An"      ✓
t=1   UPDATE users SET name = 'Bình'
t=2   PostgreSQL: name = "Bình"    Redis: name = "An"      ✗ STALE
```

Cửa sổ giữa t=1 và lúc cache được cập nhật là **cửa sổ stale**. Toàn bộ chủ đề invalidation là về việc kiểm soát cửa sổ đó — làm nó ngắn, làm nó có thể dự đoán được, và quyết định xem bao nhiêu là chấp nhận được.

Câu nói kinh điển của Phil Karlton — *"chỉ có hai vấn đề khó trong khoa học máy tính: cache invalidation và đặt tên"* — không phải đùa. Lý do nó khó không phải kỹ thuật, mà là: **bạn phải biết mọi nơi một dữ liệu được cache, và mọi nơi nó bị thay đổi.** Cả hai danh sách đều tăng theo thời gian, và không có công cụ nào giữ chúng đồng bộ.

## Mental Model

### Ba câu hỏi cho mỗi cache

```text
① KEY        cái gì định danh dữ liệu này một cách DUY NHẤT?
             (thiếu một chiều ⇒ rò rỉ dữ liệu chéo người dùng)

② TTL        sai trong bao lâu thì chấp nhận được?
             (đây là câu hỏi NGHIỆP VỤ, không phải kỹ thuật)

③ INVALIDATE ai xoá nó, khi nào?
             (nếu câu trả lời là "TTL tự lo" thì hãy nói rõ ràng như vậy)
```

Không trả lời được một trong ba câu này nghĩa là cache đó sẽ gây bug.

### Cache key: nơi rò rỉ dữ liệu xảy ra

```ts
// ❌ thiếu chiều → user B nhận dữ liệu của user A
`dashboard`

// ❌ thiếu tenant → rò rỉ chéo tổ chức
`project:${projectId}`

// ✅ mọi chiều ảnh hưởng tới KẾT QUẢ đều phải có trong key
`v2:dashboard:${tenantId}:${userId}:${role}:${locale}`
```

Quy tắc: **mọi biến ảnh hưởng tới kết quả phải nằm trong key.** Bao gồm cả những thứ dễ quên: locale, timezone, feature flag, quyền, phiên bản của schema response.

Tiền tố `v2:` là một kỹ thuật đơn giản và mạnh: khi hình dạng dữ liệu cache thay đổi, tăng version thay vì xoá cache. Cache cũ tự hết hạn, và bạn không có khoảnh khắc nào mà code mới đọc dữ liệu định dạng cũ.

Và một quy ước đặt tên nhất quán trả cổ tức khi debug:

```text
<version>:<entity>:<scope>:<id>[:<biến thể>]
v2:user:profile:123
v2:project:list:tenant-42:page-1
v2:report:revenue:tenant-42:2026-01
```

### TTL là quyết định nghiệp vụ

```text
Loại dữ liệu                        TTL hợp lý     Lý do
danh mục quốc gia, tỉ giá           1–24 giờ       gần như không đổi
danh sách sản phẩm                  1–5 phút       đổi vài lần/ngày, sai vài phút ổn
số lượng tồn kho                    0 (không cache) sai = bán quá hàng
quyền của người dùng                0–30 giây      sai = lỗ hổng bảo mật
kết quả tìm kiếm                    30–60 giây     người dùng chấp nhận độ trễ nhỏ
báo cáo tổng hợp                    5–60 phút      vốn đã là dữ liệu quá khứ
```

Cách đặt câu hỏi đúng: **"nếu người dùng thấy dữ liệu cũ 5 phút, chuyện gì xảy ra?"** Nếu câu trả lời là "không ai để ý" → cache thoải mái. Nếu là "họ mua một món đã hết hàng" → không cache, hoặc cache với invalidation chặt.

Và một nguyên tắc: **luôn có TTL, kể cả khi đã có invalidation.** TTL là mạng lưới an toàn cho những lần invalidation bị bỏ sót — và sẽ có những lần như vậy.

### Bốn chiến lược invalidation

```text
① TTL only              đơn giản nhất; stale tối đa = TTL
                        → mặc định tốt cho dữ liệu ít quan trọng

② Xoá khi ghi           stale rất ngắn; phải biết MỌI key liên quan
   (write-through
    invalidation)       → dùng khi dữ liệu quan trọng và biết rõ key

③ Versioned key         không cần xoá gì; cache cũ tự hết hạn
                        → dùng khi một thay đổi ảnh hưởng NHIỀU key

④ Event-based           service khác phát event, cache listener xoá
                        → dùng khi nhiều service cùng ghi
```

### ② Xoá khi ghi — và thứ tự quan trọng

```ts
// ✅ ghi DB trước, xoá cache SAU
await this.repo.update(id, dto);
await this.cache.del(`v2:project:${tenantId}:${id}`);
```

```ts
// ❌ xoá trước → một request đọc xen vào giữa nạp lại giá trị CŨ
await this.cache.del(key);
// ← request khác đọc ở đây: cache miss → đọc DB (giá trị cũ) → ghi lại cache
await this.repo.update(id, dto);
// cache giờ chứa giá trị cũ, và nó sống tới hết TTL
```

Nhưng thứ tự đúng vẫn còn một khe hở:

```text
t=0   A: đọc, cache miss → SELECT → nhận giá trị CŨ (chưa ghi vào cache)
t=1   B: UPDATE database
t=2   B: DEL cache                    (không có gì để xoá)
t=3   A: SET cache = giá trị CŨ       ← cache stale, tới hết TTL
```

Xác suất thấp nhưng khác 0, và nó tăng khi query chậm. Hai cách giảm:

```ts
// delayed double delete — xoá lần nữa sau khi mọi đọc đang bay đã xong
await this.repo.update(id, dto);
await this.cache.del(key);
setTimeout(() => this.cache.del(key), 500).unref();
```

```ts
// hoặc: versioned key — không có gì để xoá nhầm
const v = await this.redis.incr(`ver:project:${id}`);
// key đọc: `v2:project:${id}:${v}`  → phiên bản cũ tự hết hạn
```

Versioned key giải quyết triệt để, đổi lại tốn thêm một lần đọc để lấy version (thường gộp được vào cùng một pipeline).

### ③ Versioned key cho invalidation hàng loạt

Vấn đề: một thay đổi ảnh hưởng tới hàng nghìn key.

```text
Đổi tên một project → phải xoá:
  project:42
  project:42:members
  project:list:tenant-7:page-1..100      ← 100 key
  search:tenant-7:*                      ← không biết bao nhiêu
```

```ts
// thay vì xoá từng cái, tăng một version chung
await this.redis.incr(`ver:tenant:${tenantId}`);

// mọi key đọc đều mang version
const v = await this.redis.get(`ver:tenant:${tenantId}`);
const key = `v2:project:list:${tenantId}:v${v}:page-${page}`;
```

Key cũ trở thành mồ côi và bị eviction dọn (hoặc hết TTL). Đây là lý do **TTL vẫn bắt buộc** với chiến lược này — nếu không, Redis đầy dần bằng key không ai đọc.

Điều **không** nên làm để xoá hàng loạt:

```text
❌ KEYS project:*        — O(n) trên toàn bộ keyspace, BLOCK Redis. Không bao giờ ở production.
⚠️ SCAN ... MATCH        — không block nhưng vẫn quét toàn bộ; chậm và không nguyên tử
✅ versioned key         — O(1)
✅ Redis SET chứa danh sách key liên quan, xoá theo tập
```

### Cache stampede

```text
Key hết hạn lúc 12:00:00 khi đang có 500 req/s
→ 500 request đồng thời đều miss
→ 500 query giống hệt nhau đập vào PostgreSQL
→ DB chậm → request chậm → hàng đợi dài → có thể sập
```

Nghịch lý: **cache càng hiệu quả thì stampede càng nguy hiểm**, vì database chưa bao giờ phải chịu tải đó và có thể không có đủ capacity.

Ba biện pháp, dùng kết hợp:

```ts
// ① Jitter — key không hết hạn cùng lúc
const ttl = baseTtl * (0.9 + Math.random() * 0.2);   // ±10%
```

```ts
// ② Lock — chỉ MỘT request nạp lại
async function getWithLock<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const got = await redis.set(`lock:${key}`, '1', 'PX', 5000, 'NX');
  if (!got) {
    await sleep(50);
    const retry = await redis.get(key);
    if (retry) return JSON.parse(retry);
    return load();                                    // fallback: tự làm, đừng chờ mãi
  }
  try {
    const value = await load();
    await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
    return value;
  } finally {
    await redis.del(`lock:${key}`);
  }
}
```

```ts
// ③ Refresh-ahead — làm mới TRƯỚC khi hết hạn, người dùng không bao giờ gặp miss
// lưu kèm thời điểm hết hạn "mềm"; nếu quá hạn mềm, trả giá trị cũ NGAY
// và kích hoạt làm mới ở nền
if (Date.now() > entry.softExpiry) {
  void refreshInBackground(key, load);    // không await
}
return entry.value;                        // trả ngay, kể cả hơi cũ
```

③ cho trải nghiệm tốt nhất (không ai gặp latency của cache miss) nhưng phức tạp nhất. ① rẻ nhất và nên có mặc định.

### Cache phải fail-open

```ts
// ❌ Redis chết → API chết. Cache trở thành single point of failure.
const cached = await this.cache.get(key);
```

```ts
// ✅ Redis chết → API chậm hơn, vẫn hoạt động
async safeGet<T>(key: string): Promise<T | undefined> {
  try {
    return await this.cache.get<T>(key);
  } catch (e) {
    this.logger.warn({ err: e }, 'cache unavailable');
    this.metrics.increment('cache_error_total');
    return undefined;                                  // coi như miss
  }
}
```

Nhưng lưu ý: nếu hệ thống của bạn **phụ thuộc** vào cache để chịu tải (database không đủ sức phục vụ 100% traffic), thì fail-open nghĩa là database sập thay vì API sập. Đó vẫn thường là lựa chọn đúng, nhưng phải biết và phải có circuit breaker. Xem [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## Example

Một service cache đầy đủ, ngắn gọn:

```ts
@Injectable()
export class ProjectsService {
  private key(tenantId: string, id: string) { return `v2:project:${tenantId}:${id}`; }

  async findOne(tenantId: string, id: string): Promise<Project | null> {
    const key = this.key(tenantId, id);
    const hit = await this.safeGet<Project>(key);
    if (hit) { this.metrics.increment('cache_hit', { entity: 'project' }); return hit; }

    this.metrics.increment('cache_miss', { entity: 'project' });
    const project = await this.repo.findOne(tenantId, id);
    if (project) {
      const ttl = 300_000 * (0.9 + Math.random() * 0.2);      // jitter
      await this.safeSet(key, project, ttl);
    }
    return project;
  }

  async update(tenantId: string, id: string, dto: UpdateProjectDto) {
    const updated = await this.repo.update(tenantId, id, dto);   // DB TRƯỚC
    await this.safeDel(this.key(tenantId, id));                  // cache SAU
    await this.redis.incr(`ver:tenant:${tenantId}`);             // vô hiệu mọi danh sách
    return updated;
  }
}
```

Sáu quyết định trong đoạn này, mỗi cái chống một failure mode:

```text
tenantId trong key       chống rò rỉ chéo tenant
tiền tố v2:              đổi hình dạng không cần xoá cache
jitter                   chống hết hạn đồng loạt
DB trước, cache sau      chống cache lại giá trị cũ
version cho danh sách    invalidation hàng loạt O(1)
safeGet/safeSet/safeDel  Redis chết thì chậm, không chết
metric hit/miss          biết cache có hoạt động không
```

## Prediction

1. Cache key thiếu `userId`, user A gọi rồi user B gọi cùng endpoint — B thấy gì?
2. Cache key thiếu `tenantId` trong hệ thống multi-tenant — hậu quả nghiêm trọng đến đâu?
3. Xoá cache **trước** khi ghi DB, một request đọc xen vào giữa — cache chứa gì sau đó, và trong bao lâu?
4. Xoá cache **sau** khi ghi DB — còn khe hở nào không?
5. Cache không có TTL và một lần invalidation bị bỏ sót — dữ liệu sai bao lâu?
6. 500 request đồng thời khi một key hot vừa hết hạn — DB nhận bao nhiêu query?
7. Thêm lock — DB nhận bao nhiêu?
8. Thêm jitter ±10% cho 10.000 key được nạp cùng lúc sau restart — phân bố hết hạn thế nào?
9. `KEYS project:*` trên Redis có 5 triệu key — chuyện gì xảy ra với mọi client khác?
10. Redis chết hoàn toàn, code không bắt lỗi cache — API thế nào?
11. Code bắt lỗi cache (fail-open), Redis chết, DB chỉ chịu được 30% traffic — chuyện gì xảy ra?
12. Cache hit rate 40% — điều đó nói lên gì? Nó có tệ hơn không cache không?

<details>
<summary>Đáp án</summary>

1. B thấy **dữ liệu của A**. Rò rỉ dữ liệu cá nhân.
2. Rò rỉ **chéo tổ chức** — nghiêm trọng hơn nhiều: dữ liệu của khách hàng này lộ cho khách hàng khác. Đây là loại sự cố phải báo cáo.
3. Chứa **giá trị cũ**, và nó sống **tới hết TTL** (hoặc mãi mãi nếu không có TTL).
4. **Còn** — khe hở giữa "đọc DB" và "ghi cache" của một request đọc đang chạy song song. Giảm bằng delayed double delete hoặc versioned key.
5. **Vĩnh viễn**, cho tới khi có người phát hiện và xoá tay.
6. **500 query giống hệt nhau** — cache stampede.
7. **1** (số còn lại chờ hoặc dùng fallback).
8. Trải đều trong khoảng ±10% quanh thời điểm hết hạn — thay vì 10.000 key hết hạn trong cùng một giây.
9. `KEYS` là **O(n) và blocking** — Redis là single-threaded, nên mọi client khác bị chặn trong suốt thời gian quét. Với 5 triệu key có thể là vài giây. Đây là cách làm sập một hệ thống bằng một lệnh.
10. **API chết** — cache trở thành single point of failure.
11. API sống nhưng **database sập** vì nhận 100% traffic. Fail-open cần đi kèm circuit breaker và/hoặc degradation.
12. Hit rate thấp nghĩa là TTL quá ngắn, key quá phân mảnh, hoặc dữ liệu vốn không lặp lại. Với 40%, bạn đang trả thêm một round-trip cho 60% request — có thể **tệ hơn** không cache. Cần đo.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ `userId` khỏi key, đăng nhập 2 tài khoản, gọi cùng endpoint | Dữ liệu chéo |
| Bỏ `tenantId`, thử với 2 tenant | Rò rỉ chéo tổ chức |
| Xoá cache trước khi ghi DB, chạy đọc song song trong vòng lặp | Cache chứa giá trị cũ |
| Đổi thứ tự, lặp lại | Khe hở nhỏ hơn nhiều nhưng vẫn có |
| Thêm delayed double delete | Khe hở gần như biến mất |
| `DEL` một key hot thủ công khi đang có tải, đếm query ở DB | Stampede |
| Thêm lock, lặp lại | 1 query |
| Bỏ jitter, restart app (mọi key nạp cùng lúc), chờ tới TTL | Đỉnh tải đồng loạt |
| Thêm jitter, lặp lại | Tải trải đều |
| `KEYS *` trên Redis có 1 triệu key, đo latency của client khác | Bị chặn |
| Đổi sang `SCAN` với `COUNT 100` | Không chặn, nhưng chậm |
| `redis-cli shutdown` khi API đang chạy, không bắt lỗi | API chết |
| Thêm try/catch fail-open, lặp lại | API chậm hơn nhưng sống |
| Cùng thí nghiệm với DB chỉ chịu 30% tải | DB sập — cần circuit breaker |
| Đo hit rate thật trong 24 giờ | Có thể thấp hơn bạn nghĩ |

## What Usually Goes Wrong

- **Key thiếu chiều** → rò rỉ dữ liệu. Lỗi nghiêm trọng nhất trong note này.
- **Xoá cache trước khi ghi DB** → cache lại giá trị cũ.
- **Không có TTL** → invalidation bỏ sót = sai vĩnh viễn.
- **Không chống stampede** → key hết hạn thành sự cố.
- **Không jitter** → hết hạn đồng loạt sau restart.
- **`KEYS` ở production** → chặn toàn bộ Redis.
- **Cache chết kéo theo API chết** → tối ưu hoá thành điểm chết.
- **Fail-open mà không có circuit breaker** → Redis chết kéo DB sập.
- **Cache dữ liệu quyền/tồn kho** → lỗ hổng bảo mật hoặc bán quá hàng.
- **Không đo hit rate** → không biết cache có giúp gì không.
- **Cache endpoint có tác dụng phụ** (POST/PATCH) → hành vi sai hoàn toàn.
- **Không biết hết nơi một dữ liệu được cache** → invalidation không đầy đủ; đây là gốc của ví dụ mở đầu.
- **Cache object quá lớn** → tốn RAM, tốn băng thông, và serialize/deserialize tốn CPU.
- **Cache trước khi đo** → thêm phức tạp cho một query vốn đã 2ms.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cache là tối ưu hoá vô hại | Nó thêm một nguồn sự thật thứ hai |
| TTL ngắn thì không cần invalidation | TTL 60s nghĩa là sai tối đa 60 giây |
| Xoá cache là đủ để đảm bảo tươi | Có khe hở giữa đọc DB và ghi cache |
| `KEYS pattern` an toàn nếu ít key | Nó quét **toàn bộ** keyspace, không phải phần khớp |
| Cache miss chỉ chậm hơn một chút | Với key hot, nó là stampede |
| Redis nhanh nên cache mọi thứ | Mỗi lần cache là +1 round-trip cho miss |
| Hit rate cao nghĩa là cache tốt | Cũng cần đúng; hit trên dữ liệu sai còn tệ hơn |
| Cache chết thì chỉ chậm hơn | Chỉ nếu bạn viết code để nó chỉ chậm hơn |
| Invalidation là vấn đề kỹ thuật | Nó là vấn đề **biết mọi nơi dữ liệu được sao chép** |
| Cache một object lớn tốt hơn nhiều object nhỏ | Tuỳ; object lớn tốn băng thông và khó invalidate từng phần |

## Debugging

1. **Dữ liệu cũ xuất hiện** → cache ở tầng nào? Có bốn ứng viên: browser, CDN, framework, Redis. Kiểm tra theo thứ tự từ ngoài vào.
2. **Nếu là Redis** → in cache key thật ra log, rồi `redis-cli GET <key>` và `TTL <key>`.
3. **Dữ liệu của người khác xuất hiện** → in key, tìm chiều bị thiếu. Đây gần như luôn là nguyên nhân.
4. **DB tăng tải theo chu kỳ** → khớp với TTL. Nhiều key hết hạn cùng lúc.
5. **Đo hit rate**:
   ```bash
   redis-cli INFO stats | grep keyspace
   # keyspace_hits / (keyspace_hits + keyspace_misses)
   ```
   Nhưng metric ở tầng ứng dụng (theo entity) hữu ích hơn nhiều — nó cho biết *cache nào* không hiệu quả.
6. **Tìm key lớn bất thường**: `redis-cli --bigkeys` (an toàn, dùng `SCAN` bên trong).
7. **Xem lệnh đang chạy**: `redis-cli MONITOR` (⚠️ tốn hiệu năng, chỉ dùng ngắn) hoặc `SLOWLOG GET 10`.
8. **Không biết dữ liệu được cache ở đâu** → grep toàn bộ codebase tìm tên entity trong chuỗi key. Nếu không tìm thấy hết, đó chính là vấn đề.

## Production Considerations

- **Mọi cache phải có TTL**, kể cả khi có invalidation chủ động.
- **Key có version prefix** (`v2:`) — đổi hình dạng dữ liệu không cần xoá gì.
- **Đo hit rate theo từng loại cache**, không chỉ tổng thể. Cache dưới 70% hit thường không đáng.
- **Đo cả tỉ lệ lỗi cache** (`cache_error_total`) — nó cho biết Redis có vấn đề trước khi người dùng thấy.
- **Fail-open + circuit breaker.** Nếu Redis chết và DB không chịu nổi, cần degradation: trả dữ liệu tối giản, hoặc từ chối một phần traffic có kiểm soát.
- **Không bao giờ `KEYS` ở production.** Dùng versioned key hoặc `SCAN` với `COUNT` nhỏ.
- **Đặt `maxmemory` và `maxmemory-policy`** phù hợp. Không đặt = Redis dùng hết RAM và bị OOM kill. Xem [Eviction & memory](04-eviction-memory.md).
- **Tách Redis cache khỏi Redis queue.** Cache dùng `allkeys-lru`; queue **không** được evict. Xem [Vì sao cần queue](../04-message-queues/01-why-queue.md).
- **Không cache dữ liệu nhạy cảm về quyền** — hoặc nếu có, TTL rất ngắn và biết rõ cửa sổ mà quyền bị thu hồi vẫn còn hiệu lực.
- **Ghi lại danh sách cache** ở một chỗ: key pattern, TTL, ai invalidate. Đây là tài liệu ngăn ví dụ mở đầu xảy ra.
- **Cache nhất quán giữa các instance** — nghĩa là dùng Redis, không dùng `Map` trong bộ nhớ. Xem [Caching, queues & jobs](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cache | giảm tải, giảm latency | nguồn sự thật thứ hai; dữ liệu stale |
| Không cache | luôn đúng | tải cao, latency cao |
| TTL dài | hit rate cao, tải thấp | stale lâu hơn |
| TTL ngắn | tươi hơn | ít lợi ích, dễ stampede |
| TTL only | đơn giản nhất | stale tới hết TTL |
| Xoá khi ghi | stale rất ngắn | phải biết mọi key liên quan |
| Versioned key | invalidation hàng loạt O(1) | thêm một lần đọc; key mồ côi |
| Lock chống stampede | DB không bị đập | request chờ; thêm phức tạp |
| Refresh-ahead | không ai gặp miss | phức tạp nhất; tải nền liên tục |
| Fail-open | Redis chết không kéo API | DB có thể không chịu nổi |
| Fail-closed | bảo vệ DB | Redis chết = API chết |
| Cache in-memory | nhanh nhất | không nhất quán giữa instance |

## Explain Without Notes

1. Ba câu hỏi phải trả lời cho mỗi cache, và điều gì hỏng khi bỏ qua từng câu?
2. Vì sao phải ghi DB **trước** rồi mới xoá cache? Khe hở còn lại là gì?
3. Cache stampede xảy ra thế nào, và ba biện pháp khác nhau ở điểm nào?
4. Vì sao `KEYS` nguy hiểm ở production, và thay bằng gì?
5. Versioned key giải quyết vấn đề gì mà `DEL` không giải quyết được?
6. Fail-open nghĩa là gì, và khi nào nó **không** đủ?
7. Vì sao TTL vẫn cần dù đã có invalidation chủ động?

## Related

- [Cache patterns](03-cache-patterns.md) — cache-aside, write-through, write-behind
- [Eviction & memory](04-eviction-memory.md) — `maxmemory-policy`, key biến mất
- [Persistence & failure](05-persistence-failure.md) — Redis restart mất gì
- [Rate limit & locking](02-rate-limit-locking.md) — Redis ngoài vai trò cache
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — implementation
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — lớp cache ngoài cùng
- [Data fetching & cache (Next.js)](../../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) — lớp framework
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — khi cache chết
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — cache ở tầng kiến trúc

## Version / Context

Redis 7. Lệnh `SET key value PX ms NX` là cách chuẩn để lấy lock có TTL nguyên tử. `--bigkeys` dùng `SCAN` nên an toàn ở production; `KEYS` và `MONITOR` thì không.
