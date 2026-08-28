---
level: intermediate
area: database
prerequisites:
  - 01-cache-invalidation.md
related:
  - 04-eviction-memory.md
  - ../../06-system-design/02-scaling-cache-queue.md
---

# Cache patterns

> Hai team trong cùng công ty, cùng dùng Redis, cùng cache dữ liệu người dùng. Team A: dữ liệu đôi khi cũ 5 phút, không ai phàn nàn. Team B: dữ liệu mất hẳn khi Redis restart, và họ mất hai ngày để khôi phục. Khác biệt không nằm ở công cụ — nó nằm ở việc **ai là nguồn sự thật**, và đó là điều mà tên gọi của mẫu cache nói cho bạn biết.

## Position

```text
Application
    │
    ├──▶ Cache  ──▶  ?           ← mẫu quyết định mũi tên này đi đâu
    │
    └──▶ Database
```

## Problem

"Dùng cache" không phải một quyết định — nó là bốn quyết định:

```text
① Ai ĐỌC từ database khi cache miss?      app, hay cache?
② Ai GHI vào database?                     app, hay cache?
③ Ghi cache TRƯỚC hay SAU khi ghi DB?
④ Cache miss có nạp lại không, hay chỉ để trống?
```

Bốn câu trả lời cho ra các mẫu có tên gọi. Và mỗi mẫu có một **chế độ hỏng đặc trưng** — biết tên mẫu nghĩa là biết trước nó sẽ hỏng thế nào.

## Mental Model

```text
CACHE-ASIDE (lazy loading)      app đọc cache → miss → app đọc DB → app ghi cache
  ai cũng dùng cái này          ⇒ chỉ dữ liệu ĐƯỢC YÊU CẦU mới vào cache

READ-THROUGH                    app chỉ nói chuyện với cache; cache tự đọc DB
  cần thư viện/proxy hỗ trợ     ⇒ app đơn giản hơn, ít kiểm soát hơn

WRITE-THROUGH                   app ghi cache → cache ghi DB → xong
  ⇒ cache LUÔN tươi, ghi chậm hơn

WRITE-BEHIND (write-back)       app ghi cache → trả về NGAY → nền ghi DB sau
  ⇒ ghi rất nhanh, CÓ THỂ MẤT DỮ LIỆU

REFRESH-AHEAD                   làm mới trước khi hết hạn
  ⇒ không ai gặp cache miss, tốn tài nguyên nền
```

Và một trục thứ hai, quan trọng hơn tên gọi:

```text
CACHE LÀ BẢN SAO   (cache-aside, read/write-through, refresh-ahead)
  → mất cache = chậm hơn, không mất dữ liệu

CACHE LÀ NGUỒN SỰ THẬT TẠM THỜI  (write-behind)
  → mất cache = MẤT DỮ LIỆU
```

Sự cố của team B ở đầu note là hệ quả của việc dùng nhóm thứ hai mà tưởng mình đang ở nhóm thứ nhất.

## How It Works

### Cache-aside: mẫu mặc định

```ts
async findOne(tenantId: string, id: string): Promise<Project | null> {
  const key = `v2:project:${tenantId}:${id}`;

  const hit = await this.cache.get<Project>(key);
  if (hit !== undefined) return hit;              // chú ý: undefined, không phải falsy

  const row = await this.repo.findOne(tenantId, id);
  if (row) await this.cache.set(key, row, jitter(300_000));
  return row;
}
```

Ba chi tiết dễ sai:

**① `hit !== undefined`, không phải `if (hit)`.** Nếu giá trị hợp lệ là `0`, `false`, hoặc chuỗi rỗng, kiểm tra falsy sẽ coi hit là miss — và bạn có một cache không bao giờ hoạt động cho những giá trị đó.

**② Cache cả kết quả rỗng (negative caching).** Nếu không, mọi request tới một id không tồn tại đều đi tới DB. Đó là một vector tấn công: gửi 10.000 id ngẫu nhiên và mọi request đều xuống database.

```ts
if (row) await this.cache.set(key, row, 300_000);
else     await this.cache.set(key, NULL_SENTINEL, 30_000);   // TTL NGẮN hơn nhiều
```

TTL ngắn cho negative cache vì "không tồn tại" thường chuyển thành "tồn tại" (vừa được tạo), và ngược lại thì hiếm.

**③ Chỉ dữ liệu được yêu cầu mới vào cache.** Sau khi Redis restart, cache trống hoàn toàn và mọi request đều miss — xem phần *thundering herd* ở dưới.

### Write-through: cache luôn tươi

```ts
async update(tenantId: string, id: string, dto: UpdateDto) {
  const updated = await this.repo.update(tenantId, id, dto);   // DB trước
  await this.cache.set(this.key(tenantId, id), updated, 300_000);
  return updated;
}
```

So với "ghi DB rồi **xoá** cache" (cache-aside invalidation):

```text
SET sau khi ghi         cache luôn có dữ liệu → không có miss sau ghi
                        NHƯNG: nếu hai ghi đồng thời, cái ghi cache SAU có thể là
                        giá trị CŨ hơn → cache lệch với DB

DEL sau khi ghi         lần đọc sau miss một lần → nhưng luôn đọc lại từ DB
                        an toàn hơn khi có ghi đồng thời
```

Quy tắc thực dụng: **`DEL` an toàn hơn `SET`.** Chỉ dùng `SET` khi bạn chắc chắn về thứ tự ghi, hoặc khi việc nạp lại đắt tới mức đáng chấp nhận rủi ro.

### Write-behind: nhanh, và nguy hiểm

```ts
// ghi vào cache, trả về ngay
await this.cache.set(key, value);
await this.queue.add('persist', { key, value });   // ghi DB ở nền
```

```text
Được:   ghi cực nhanh; gộp được nhiều ghi thành một (10.000 lượt xem → 1 UPDATE)
Mất:    Redis chết trước khi flush ⇒ MẤT DỮ LIỆU
        đọc từ DB thấy dữ liệu cũ
        thứ tự ghi phức tạp
```

Chỉ dùng khi **mất một ít dữ liệu là chấp nhận được**:

```text
✓ đếm lượt xem, đếm click, analytics
✓ "last seen at" của người dùng
✗ đơn hàng, thanh toán, bất cứ gì người dùng nhìn thấy xác nhận
```

Với đếm lượt xem, write-behind là lựa chọn đúng và tiết kiệm rất nhiều:

```ts
await redis.hincrby('views:pending', postId, 1);        // trong request: 1 lệnh Redis
// job mỗi phút: đọc hết, UPDATE database theo lô, xoá
```

10.000 lượt xem/phút → 1 `UPDATE` thay vì 10.000. Nếu Redis chết, bạn mất tối đa một phút đếm — và đó là dữ liệu mà không ai đối soát.

### Refresh-ahead: không ai gặp miss

```ts
type Entry<T> = { value: T; softExpiry: number };

async get<T>(key: string, load: () => Promise<T>, softMs: number, hardMs: number): Promise<T> {
  const entry = await this.cache.get<Entry<T>>(key);

  if (entry) {
    if (Date.now() > entry.softExpiry) {
      void this.refresh(key, load, softMs, hardMs);      // KHÔNG await
    }
    return entry.value;                                   // trả ngay, kể cả hơi cũ
  }
  return this.refresh(key, load, softMs, hardMs);         // miss thật → phải chờ
}
```

Hai mốc thời gian: `softExpiry` (bắt đầu làm mới ở nền) và TTL thật của Redis (`hardMs`, lớn hơn nhiều). Người dùng gần như không bao giờ chờ.

Đây là mẫu đúng cho dashboard, trang chủ, và những chỗ có key hot cố định. Nó cũng chống stampede tự nhiên — chỉ cần thêm một lock quanh `refresh` để đảm bảo một người làm mới.

Cái giá: tải nền liên tục, kể cả với dữ liệu không ai xem nữa.

### Thundering herd sau restart

```text
Redis restart → cache trống hoàn toàn
→ 100% request miss
→ database nhận 100% traffic mà nó chưa bao giờ phải chịu
→ database sập
→ restart database
→ cache vẫn trống → sập lại
```

Đây là chế độ hỏng nghiêm trọng nhất của kiến trúc có cache, và nó là một vòng lặp — hệ thống không tự phục hồi.

Bốn biện pháp:

```text
① Cache warming        nạp trước các key hot khi khởi động
② Bật lại từ từ        cho traffic vào 10% → 50% → 100%
③ Persistence (RDB/AOF) restart giữ được dữ liệu — xem note Persistence
④ Circuit breaker      DB quá tải → trả lỗi/degraded thay vì làm nó sập hẳn
```

Và một biện pháp phòng ngừa quan trọng hơn cả bốn cái trên: **biết database chịu được bao nhiêu phần trăm traffic khi không có cache.** Nếu câu trả lời là 20%, bạn đang phụ thuộc cache để tồn tại — và đó là một quyết định kiến trúc cần được nói ra, không phải một tình cờ.

### Cache nhiều tầng

```ts
// L1: trong process (μs, mỗi instance riêng)   L2: Redis (ms, dùng chung)
async get<T>(key: string): Promise<T | undefined> {
  const l1 = this.local.get(key);                       // LRU nhỏ, TTL rất ngắn
  if (l1 !== undefined) return l1;

  const l2 = await this.redis.get(key);
  if (l2 !== undefined) { this.local.set(key, l2, 5_000); return l2; }

  return undefined;
}
```

L1 có ý nghĩa khi một key được đọc nhiều lần trong vài giây (config, feature flag, danh mục). Nó tiết kiệm cả round-trip mạng.

Cái giá: **L1 không nhất quán giữa các instance.** Vì thế TTL của L1 phải rất ngắn (1–10 giây) và chỉ dùng cho dữ liệu chấp nhận được độ trễ đó. Xem [Caching, queues & jobs](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md).

### Chọn cấu trúc dữ liệu Redis

```ts
// ① Chuỗi JSON — đơn giản, đọc/ghi toàn bộ
await redis.set(key, JSON.stringify(user), 'PX', ttl);

// ② Hash — cập nhật/đọc TỪNG field, không phải serialize cả object
await redis.hset(`user:${id}`, { name: 'An', email: 'a@b.c' });
await redis.hget(`user:${id}`, 'name');            // chỉ lấy 1 field

// ③ Sorted set — bảng xếp hạng, dữ liệu theo thời gian
await redis.zadd('recent', Date.now(), postId);

// ④ Set — kiểm tra thành viên
await redis.sismember(`project:${id}:members`, userId);
```

Hash đáng cân nhắc khi object lớn và bạn chỉ cần vài field: nó tránh việc truyền và parse toàn bộ JSON mỗi lần đọc.

Về nén: với object lớn (> 10 KB), nén trước khi lưu tiết kiệm RAM và băng thông đáng kể — đổi lấy CPU. Đo trước khi làm.

### Cache những gì — và những gì không

```text
CACHE TỐT                                KHÔNG NÊN CACHE
đọc nhiều, ghi ít                         ghi nhiều, đọc ít
tính toán đắt (aggregate, JOIN nhiều)     query đã 2ms với index
giống nhau cho nhiều người dùng           riêng cho mỗi người và mỗi lần khác nhau
chấp nhận được độ trễ                     tồn kho, số dư, quyền
dữ liệu tham chiếu (danh mục, cấu hình)   dữ liệu thay đổi mỗi giây
```

Quy tắc bị bỏ qua nhiều nhất: **đo trước khi cache.** Thêm cache cho một query 2ms nghĩa là bạn thêm một round-trip Redis (~0,5ms) cho mọi hit và ~2,5ms cho mọi miss, cộng với toàn bộ độ phức tạp của invalidation. Với hit rate 40%, bạn có thể đang làm hệ thống **chậm hơn**.

## Example

Chọn mẫu theo loại dữ liệu, trong cùng một hệ thống:

```text
Dữ liệu                Mẫu              TTL      Lý do
danh mục quốc gia      cache-aside      24 giờ   gần như không đổi
                       + warm lúc start
trang chủ (top 20)     refresh-ahead    5 phút   key hot cố định, không được miss
profile người dùng     cache-aside      5 phút   + xoá khi update
                       + DEL khi ghi
đếm lượt xem           write-behind     —        mất 1 phút chấp nhận được
số dư tài khoản        KHÔNG CACHE      —        sai = mất tiền
quyền của user         cache-aside      30 giây  + xoá khi đổi quyền; cửa sổ 30s là RỦI RO ĐÃ BIẾT
kết quả tìm kiếm       cache-aside      60 giây  + negative cache 10 giây
```

Dòng "quyền" đáng chú ý: cache quyền là một đánh đổi bảo mật có ý thức. Với TTL 30 giây, một quyền bị thu hồi vẫn còn hiệu lực tối đa 30 giây. Chấp nhận được hay không là quyết định nghiệp vụ — nhưng nó phải được **quyết định**, không phải xảy ra tình cờ.

## Prediction

1. `if (cachedValue)` với giá trị hợp lệ là `0` — cache có hoạt động không?
2. Không negative cache, attacker gửi 10.000 request với id ngẫu nhiên — DB nhận bao nhiêu query?
3. Có negative cache TTL 30 giây, cùng tấn công — DB nhận bao nhiêu?
4. Negative cache TTL 1 giờ, một bản ghi vừa được tạo — người dùng thấy gì?
5. Write-behind cho đơn hàng, Redis chết trước khi flush — mất gì?
6. Write-behind cho đếm lượt xem, cùng tình huống — mất gì?
7. Redis restart, cache trống, DB chịu được 30% traffic — chuyện gì xảy ra?
8. Có cache warming cho 100 key hot — khác gì?
9. Refresh-ahead, key không ai xem nữa nhưng vẫn được làm mới — hậu quả?
10. `SET` cache sau khi ghi, hai request ghi đồng thời với giá trị khác nhau — cache chứa gì?
11. `DEL` cache sau khi ghi, cùng tình huống — cache chứa gì?
12. L1 cache trong process TTL 60 giây, 4 instance, người dùng đổi dữ liệu — họ thấy gì khi F5?
13. Cache một query vốn chạy 2ms, hit rate 40% — nhanh hơn hay chậm hơn?

<details>
<summary>Đáp án</summary>

1. **Không** — `0` là falsy, mọi lần đều coi là miss. Phải dùng `!== undefined`.
2. **10.000 query** — mọi id không tồn tại đều xuống DB.
3. Khoảng **10.000 lần đầu**, nhưng nếu attacker lặp lại cùng id thì các lần sau được chặn. Negative cache chỉ giúp với id lặp lại — với id hoàn toàn ngẫu nhiên, cần rate limit.
4. Thấy "không tồn tại" trong tối đa **1 giờ** dù bản ghi đã có. Đây là lý do TTL negative phải ngắn.
5. **Mất đơn hàng** đã được xác nhận với người dùng. Đây là lý do write-behind không dùng cho dữ liệu quan trọng.
6. Mất tối đa một chu kỳ flush đếm — chấp nhận được.
7. DB nhận 100% traffic → **sập**. Restart DB → cache vẫn trống → sập lại. Vòng lặp không tự thoát.
8. Các key hot được phục vụ từ cache ngay → DB chỉ nhận phần đuôi dài → có thể sống sót.
9. Tốn tài nguyên nền vô ích. Cần cơ chế dừng làm mới key không được truy cập một thời gian.
10. Có thể chứa giá trị **cũ hơn** — nếu ghi A hoàn tất DB sau B nhưng ghi cache trước B.
11. Cache trống → lần đọc sau lấy từ DB → luôn đúng. An toàn hơn.
12. Giá trị **nhảy** giữa cũ và mới tuỳ instance nào phục vụ, trong tối đa 60 giây. TTL L1 phải rất ngắn.
13. Có thể **chậm hơn**: 60% request trả thêm ~0,5ms (miss) + ~0,5ms (ghi cache), và 40% tiết kiệm ~1,5ms. Phải đo.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Cache một giá trị `0` với `if (cached)` | Không bao giờ hit |
| Bỏ negative cache, gọi 1.000 id không tồn tại | Đếm query ở DB |
| Thêm negative cache, lặp lại với id lặp | Query giảm mạnh |
| Negative cache TTL 1 giờ, tạo bản ghi rồi đọc | Vẫn "không tồn tại" |
| Write-behind, `redis-cli shutdown` trước flush | Đếm dữ liệu mất |
| `FLUSHALL` khi đang có tải, đo query ở DB | Thundering herd |
| Thêm cache warming, lặp lại | Đỉnh thấp hơn nhiều |
| Refresh-ahead, log số lần refresh cho key không ai xem | Tải nền vô ích |
| `SET` sau ghi với hai ghi đồng thời (thêm delay ngẫu nhiên) | Cache lệch DB |
| Đổi sang `DEL`, lặp lại | Không lệch |
| L1 TTL 60 giây, 3 instance, đổi dữ liệu, F5 20 lần | Giá trị nhảy |
| Giảm L1 TTL xuống 3 giây | Nhảy ít hơn nhiều |
| Cache một query 2ms, đo p50/p95 trước và sau | Có thể tệ hơn |
| Đo hit rate thật trong 24 giờ | Thường thấp hơn dự đoán |

## What Usually Goes Wrong

- **`if (cached)` thay vì `!== undefined`** → cache không hoạt động cho `0`/`false`/`''`.
- **Không negative cache** → id không tồn tại đi thẳng xuống DB.
- **Negative cache TTL quá dài** → bản ghi mới tạo "không tồn tại".
- **Write-behind cho dữ liệu quan trọng** → mất dữ liệu khi Redis chết.
- **Không có kế hoạch cho cache trống** → thundering herd, và hệ thống không tự phục hồi.
- **`SET` sau ghi với ghi đồng thời** → cache lệch DB.
- **L1 TTL dài** → dữ liệu nhảy giữa các instance.
- **Cache trước khi đo** → phức tạp không đổi lấy gì.
- **Không đo hit rate** → không biết cache có hoạt động không.
- **Cache object quá lớn** → tốn RAM, băng thông, CPU serialize.
- **Không biết DB chịu được bao nhiêu % traffic khi cache chết** → phụ thuộc cache mà không biết.
- **Cache dữ liệu quyền/số dư** mà không nhận ra đó là đánh đổi bảo mật/chính xác.
- **Refresh-ahead cho key không hot** → tải nền vô ích.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cache-aside và read-through như nhau | Khác ở chỗ **ai** đọc DB khi miss |
| Write-through làm ghi nhanh hơn | Nó làm ghi **chậm hơn**; nó làm cache luôn tươi |
| Write-behind chỉ là tối ưu | Nó chuyển cache thành nguồn sự thật tạm thời |
| Cache miss chỉ chậm hơn một chút | Cache trống hoàn toàn có thể làm sập DB |
| `SET` sau ghi tốt hơn `DEL` | `DEL` an toàn hơn khi có ghi đồng thời |
| Negative cache không cần thiết | Không có nó là một vector tấn công |
| L1 + L2 luôn tốt hơn | L1 không nhất quán giữa instance |
| Cache mọi thứ thì nhanh hơn | Với query đã nhanh, cache làm chậm hơn |
| Hit rate cao là đủ | Cũng cần đúng, và cần đo cả trường hợp miss |
| Redis luôn nhanh hơn database | Query có index trên dữ liệu nóng có thể nhanh tương đương |

## Debugging

1. **Cache có hoạt động không** → đo hit/miss theo từng loại cache (không chỉ tổng). Hit rate 0% thường là bug kiểm tra falsy hoặc key không khớp giữa đọc và ghi.
2. **Key khớp không** → in key ở cả chỗ đọc và chỗ ghi, so từng ký tự. Đây là bug phổ biến bất ngờ.
3. **Dữ liệu cũ** → xác định mẫu đang dùng. `SET` hay `DEL` sau ghi? Có L1 không?
4. **DB tăng tải đột ngột** → cache có bị flush/restart không? `redis-cli INFO stats` xem `keyspace_hits`/`misses`.
5. **Redis đầy** → `--bigkeys`; object cache quá lớn là nguyên nhân thường gặp.
6. **Đo giá trị thật của cache**: tắt cache trong một môi trường có tải thật và so p50/p95. Nếu chênh lệch nhỏ, cache đang không đáng.
7. **Kiểm tra khả năng sống sót**: chủ động `FLUSHALL` trên staging có tải và xem DB có chịu được không. Kết quả cho biết bạn phụ thuộc cache đến mức nào.

## Production Considerations

- **Cache-aside là mặc định.** Chỉ đổi mẫu khi có lý do cụ thể.
- **`DEL` thay vì `SET` sau khi ghi**, trừ khi việc nạp lại rất đắt.
- **Negative cache với TTL ngắn** (10–60 giây) cho mọi endpoint tra cứu theo id.
- **Biết DB chịu được bao nhiêu % traffic khi cache chết.** Test điều đó, đừng đoán. Nếu dưới 100%, bạn cần cache warming, bật lại từ từ, và circuit breaker.
- **Cache warming cho key hot** khi khởi động, và sau mỗi lần Redis restart.
- **Persistence (RDB hoặc AOF)** nếu cache trống là thảm hoạ — nó biến restart từ sự cố thành phiền phức. Xem [Persistence & failure](05-persistence-failure.md).
- **L1 TTL rất ngắn** (1–10 giây) và chỉ cho dữ liệu tham chiếu.
- **Đo hit rate theo từng loại cache**, và xoá cache nào dưới ~70% — nó đang tốn nhiều hơn tiết kiệm.
- **Giới hạn kích thước object cache.** Object > 100 KB nên xem lại: có thể chỉ cần cache phần được đọc.
- **Write-behind cần đo "độ trễ flush"** như một metric, và alert khi hàng đợi chưa flush tăng.
- **Ghi lại mẫu và TTL của mỗi cache** ở một chỗ. Đây là tài liệu ngăn team sau dùng nhầm mẫu.

## Trade-offs

| Mẫu | Được | Mất |
|---|---|---|
| Cache-aside | đơn giản, chỉ cache cái được dùng | miss lần đầu; code cache ở mọi nơi |
| Read-through | app đơn giản | cần thư viện; ít kiểm soát |
| Write-through | cache luôn tươi | ghi chậm hơn; cache cả thứ không ai đọc |
| Write-behind | ghi rất nhanh, gộp được | có thể mất dữ liệu |
| Refresh-ahead | không ai gặp miss | tải nền liên tục |
| Negative cache | chặn tra cứu id không tồn tại | bản ghi mới "không tồn tại" trong TTL |
| L1 + L2 | nhanh nhất | L1 không nhất quán |
| Chỉ L2 (Redis) | nhất quán | +1 round-trip cho mọi lần |
| TTL dài | hit rate cao | stale lâu |
| TTL ngắn | tươi | ít lợi ích, dễ stampede |
| Không cache | luôn đúng, đơn giản | tải và latency |

## Explain Without Notes

1. Bốn câu hỏi xác định một mẫu cache?
2. Cache-aside khác read-through ở điểm nào?
3. Vì sao write-behind biến cache thành nguồn sự thật, và điều đó nguy hiểm ở đâu?
4. Vì sao `DEL` an toàn hơn `SET` sau khi ghi?
5. Negative caching giải quyết gì, và TTL của nó nên thế nào?
6. Thundering herd sau restart xảy ra thế nào, và vì sao nó là một vòng lặp?
7. Khi nào L1 cache đáng dùng, và cái giá của nó?
8. Vì sao cache một query 2ms có thể làm hệ thống chậm hơn?

## Related

- [Cache & invalidation](01-cache-invalidation.md) — key, TTL, stampede, invalidation
- [Eviction & memory](04-eviction-memory.md) — khi Redis đầy
- [Persistence & failure](05-persistence-failure.md) — Redis restart mất gì
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — implementation
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — cache ở tầng kiến trúc
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — sống sót khi cache chết
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — đo trước khi cache

## Version / Context

Redis 7. Các mẫu là khái niệm chung, áp dụng cho Memcached, cache trong process, hay CDN — chỉ khác công cụ.
