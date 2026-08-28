---
level: advanced
area: database
prerequisites:
  - 01-cache-invalidation.md
related:
  - ../../02-backend-api/00-http-api/07-rate-limiting.md
  - ../../05-cross-cutting/concurrency/03-distributed-locks.md
  - ../01-postgresql/transactions-concurrency/03-locking-deadlock.md
---

# Rate limit & locking

> Rate limit đặt 100 request/phút. Bạn có 4 pod, mỗi pod đếm trong bộ nhớ của nó. Người dùng thật sự gửi được **400 request/phút**. Và trong lúc đó, một job "gửi hoá đơn hằng tháng" chạy trên cả 4 pod vì lock bạn viết bằng `SETNX` đã hết hạn giữa chừng. Cả hai vấn đề có cùng một gốc: **trạng thái dùng chung giữa nhiều tiến trình cần một nơi lưu trữ dùng chung, và cần các thao tác nguyên tử.**

## Position

```text
4 API pod  ──┐
             ├──▶ REDIS  (single-threaded ⇒ mọi lệnh là NGUYÊN TỬ)
2 worker   ──┘         counter · lock · token bucket
```

Tính chất làm Redis phù hợp cho việc này không phải tốc độ, mà là: **Redis chạy một luồng lệnh duy nhất**, nên mỗi lệnh (và mỗi script Lua) là nguyên tử với mọi client.

## Problem

### Trạng thái trong bộ nhớ không tồn tại khi có nhiều instance

```ts
// ❌ đúng với 1 pod, sai với N pod
const counts = new Map<string, number>();
if ((counts.get(userId) ?? 0) > 100) throw new TooManyRequestsException();
```

```text
1 pod:  giới hạn thật = 100
4 pod:  giới hạn thật = 400 (mỗi pod đếm riêng)
autoscale 4→12 pod: giới hạn thật = 1.200
⇒ "giới hạn" của bạn là một hàm của số pod, không phải một con số bạn chọn
```

Cùng lý lẽ với lock, distributed counter, và mọi thứ cần "chỉ một" hoặc "tối đa N".

### Read-modify-write không nguyên tử

```ts
// ❌ ba thao tác riêng biệt → race condition
const current = await redis.get(key);
if (Number(current) >= limit) throw new TooManyRequestsException();
await redis.set(key, Number(current) + 1);
```

Hai request đồng thời đều đọc `99`, cả hai ghi `100`. Bộ đếm mất một lần tăng, và giới hạn bị vượt.

Đây là cùng một họ vấn đề với lost update trong PostgreSQL — chỉ khác chỗ xảy ra. Xem [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md).

## Mental Model

### Nguyên tử: một lệnh, hoặc một script Lua

```text
✓ NGUYÊN TỬ                          ✗ KHÔNG nguyên tử
INCR key                              GET rồi SET
INCRBY key n                          GET rồi so sánh rồi SET
SET key val NX PX 5000                EXISTS rồi SET
EVAL <lua script>                     nhiều lệnh không trong script/MULTI
MULTI ... EXEC (transaction)
```

Quy tắc: **nếu logic cần đọc một giá trị rồi quyết định dựa trên nó, hãy đưa cả logic đó vào Lua.** Redis thực thi script như một lệnh duy nhất.

### Bốn thuật toán rate limit

```text
① FIXED WINDOW      INCR key:<user>:<phút>, EXPIRE 60
   + đơn giản nhất, 1 lệnh, ít bộ nhớ
   - BURST ở biên: 100 req cuối phút 1 + 100 req đầu phút 2 = 200 trong 2 giây

② SLIDING WINDOW LOG  ZSET timestamp, xoá cái cũ, đếm
   + chính xác tuyệt đối
   - lưu MỌI timestamp: 1.000 req/user = 1.000 phần tử

③ SLIDING WINDOW COUNTER  nội suy giữa hai cửa sổ cố định
   + gần chính xác, bộ nhớ như ①
   - xấp xỉ, không hoàn hảo ở biên

④ TOKEN BUCKET      token nạp đều theo thời gian, mỗi request tiêu 1
   + CHO PHÉP burst có kiểm soát — thường đúng nhất về nghiệp vụ
   - hai giá trị mỗi key (số token, thời điểm nạp cuối)
```

Chọn: **① cho hầu hết trường hợp** (đơn giản thắng), **④ khi burst là hành vi hợp lệ** (client đồng bộ dữ liệu, mobile app vừa mở), **② khi phải chính xác tuyệt đối** (giới hạn theo hợp đồng, tính tiền).

### Fixed window

```ts
const key = `rl:${userId}:${Math.floor(Date.now() / 60_000)}`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 120);      // TTL > cửa sổ để tránh mất khi lệch đồng hồ
if (count > 100) throw new TooManyRequestsException();
```

Hai chi tiết:

- **`INCR` tạo key với giá trị 1 nếu chưa tồn tại** — không cần kiểm tra trước.
- **Chỉ `EXPIRE` khi `count === 1`** để không gia hạn TTL mỗi request. Nhưng có một khe hở: nếu process chết giữa `INCR` và `EXPIRE`, key sống mãi. Gộp vào Lua để nguyên tử hoàn toàn.

### Token bucket bằng Lua

```lua
-- KEYS[1] = key;  ARGV: 1=capacity 2=refill_per_sec 3=now_ms 4=cost
local b        = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now

tokens = math.min(capacity, tokens + (now - ts) / 1000 * refill)   -- nạp theo thời gian trôi qua

if tokens < cost then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
  redis.call('EXPIRE', KEYS[1], 3600)
  return {0, math.ceil((cost - tokens) / refill)}                  -- từ chối + retry_after giây
end

redis.call('HSET', KEYS[1], 'tokens', tokens - cost, 'ts', now)
redis.call('EXPIRE', KEYS[1], 3600)
return {1, 0}
```

```ts
const [allowed, retryAfter] = await redis.eval(script, 1, key, 100, 2, Date.now(), 1);
if (!allowed) {
  res.setHeader('Retry-After', String(retryAfter));
  throw new TooManyRequestsException();
}
```

Toàn bộ logic đọc-tính-ghi nằm trong một script → nguyên tử, không có race condition.

Về `Date.now()` truyền từ client: dùng đồng hồ của app nghĩa là các pod có thể lệch nhau. Dùng `redis.call('TIME')` bên trong Lua thì nhất quán hơn, nhưng script trở thành non-deterministic (ảnh hưởng tới replication ở Redis cũ; từ Redis 5 với replication theo hiệu ứng thì không còn là vấn đề).

### Phản hồi rate limit đúng chuẩn

```text
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30
```

Không có `Retry-After`, client sẽ retry ngay lập tức và làm tình hình tệ hơn. Xem [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md).

### Distributed lock: và vì sao nó không bao giờ tuyệt đối

```ts
// lấy lock — token NGẪU NHIÊN là bắt buộc
const token = randomUUID();
const got = await redis.set(`lock:${resource}`, token, 'PX', 30_000, 'NX');
if (!got) return;                                    // người khác đang giữ

try {
  await doWork();
} finally {
  // thả lock CHỈ KHI nó vẫn là của mình — phải nguyên tử ⇒ Lua
  await redis.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
    1, `lock:${resource}`, token);
}
```

Vì sao token ngẫu nhiên và Lua là bắt buộc:

```text
t=0    A lấy lock, TTL 30s
t=35   A vẫn đang chạy (chậm hơn dự kiến); lock HẾT HẠN
t=36   B lấy được lock
t=40   A xong, gọi DEL lock       ← XOÁ LOCK CỦA B!
t=41   C lấy được lock            ← giờ B và C chạy song song
```

Với token, A kiểm tra `GET == token của mình` → không khớp → không xoá. Nhưng lưu ý: **điều này vẫn không cứu được việc A và B chạy song song từ t=36 tới t=40.**

Và đó là điểm quan trọng nhất về distributed lock:

> **Lock có TTL không đảm bảo loại trừ lẫn nhau.**
> Nếu công việc chạy lâu hơn TTL, hai tiến trình sẽ chạy song song.

Ba hệ quả thực tế:

```text
① Công việc bên trong lock PHẢI idempotent — lock chỉ giảm xác suất, không loại bỏ
② TTL phải > thời gian chạy tối đa (p99), và có cơ chế gia hạn cho việc dài
③ Với việc mà chạy hai lần là THẢM HOẠ (chuyển tiền), lock Redis là KHÔNG ĐỦ
   → dùng transaction + constraint ở database
```

Về Redlock (thuật toán lock trên nhiều Redis độc lập): nó tăng độ chịu lỗi khi một node Redis chết, nhưng **không** giải quyết vấn đề TTL ở trên, và tính đúng đắn của nó gây tranh cãi trong cộng đồng. Với hầu hết trường hợp: một Redis + lock có TTL + công việc idempotent là đủ; nếu cần đảm bảo thật sự, dùng database.

### Gia hạn lock cho việc dài

```ts
const RENEW_MS = 10_000, TTL_MS = 30_000;
const timer = setInterval(async () => {
  await redis.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
    1, key, token, TTL_MS);
}, RENEW_MS);
timer.unref();
try { await doWork(); } finally { clearInterval(timer); await releaseLock(); }
```

Nếu process chết, timer dừng, lock hết hạn sau tối đa 30 giây. Đây là hành vi đúng — nhưng nhớ rằng nếu process chỉ **treo** (không chết), nó có thể vẫn đang giữ tài nguyên trong khi lock đã được người khác lấy.

### PostgreSQL advisory lock: lựa chọn thường tốt hơn

Nếu bạn đã có PostgreSQL:

```sql
SELECT pg_advisory_xact_lock(hashtext('monthly-invoice'));
-- tự thả khi COMMIT/ROLLBACK — KHÔNG có TTL, KHÔNG hết hạn giữa chừng
```

```text
Redis lock                       PostgreSQL advisory lock
có TTL → hết hạn giữa chừng      không TTL → giữ tới hết transaction
nhanh hơn                        chậm hơn chút
không cần DB                     cần một connection
Redis chết = lock biến mất       connection chết = lock tự thả (đúng)
```

Với "chỉ một instance được chạy job này", advisory lock thường là lựa chọn đúng hơn vì nó không có chế độ hỏng "lock hết hạn khi việc chưa xong". Xem [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) và [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md).

### Redis cho những việc khác

```ts
// đếm duy nhất xấp xỉ — 12 KB cho hàng triệu phần tử, sai số ~0,81%
await redis.pfadd(`uv:${day}`, userId);
await redis.pfcount(`uv:${day}`);

// leaderboard
await redis.zincrby('leaderboard:weekly', score, userId);
await redis.zrevrange('leaderboard:weekly', 0, 9, 'WITHSCORES');

// idempotency key cho API — chống xử lý trùng
const first = await redis.set(`idem:${key}`, '1', 'EX', 86400, 'NX');
if (!first) return await getCachedResponse(key);

// session store
await redis.setex(`sess:${sid}`, 1800, JSON.stringify(session));
```

`PFADD`/`PFCOUNT` (HyperLogLog) đáng biết: đếm chính xác 10 triệu user duy nhất cần một `SET` hàng trăm MB; HyperLogLog cần 12 KB với sai số dưới 1%. Với "số người dùng hoạt động hằng ngày", đó là đánh đổi rõ ràng.

## Example

Rate limit nhiều tầng, mỗi tầng bảo vệ một thứ khác nhau:

```ts
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly rules = [
    { name: 'ip-burst',  key: (r) => `rl:ip:${r.ip}`,           limit: 20,   window: 1    },
    { name: 'ip-minute', key: (r) => `rl:ip:${r.ip}`,           limit: 300,  window: 60   },
    { name: 'user',      key: (r) => `rl:u:${r.user?.id}`,      limit: 1000, window: 60   },
    { name: 'endpoint',  key: (r) => `rl:e:${r.user?.id}:${r.route.path}`, limit: 10, window: 60 },
  ];

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    for (const rule of this.rules) {
      if (!rule.key(req)) continue;
      const { allowed, retryAfter } = await this.check(rule, req);
      if (!allowed) {
        ctx.switchToHttp().getResponse().setHeader('Retry-After', String(retryAfter));
        this.metrics.increment('rate_limited', { rule: rule.name });   // biết tầng nào chặn
        throw new HttpException('Too many requests', 429);
      }
    }
    return true;
  }
}
```

Bốn tầng vì chúng chống bốn thứ khác nhau:

```text
ip-burst    chống flood tức thời từ một nguồn
ip-minute   chống lạm dụng kéo dài từ một nguồn
user        giới hạn theo hợp đồng/gói dịch vụ
endpoint    bảo vệ endpoint đắt tiền (export, gửi email, tìm kiếm)
```

Và metric theo `rule` là thứ cho biết tầng nào đang chặn — không có nó, "429" chỉ là một con số.

## Prediction

1. Rate limit đếm trong bộ nhớ, 4 pod, giới hạn cấu hình 100/phút — giới hạn thật là bao nhiêu?
2. Autoscale từ 4 lên 12 pod — giới hạn thật đổi thế nào?
3. `GET` rồi `SET` để tăng counter, hai request đồng thời khi giá trị là 99 — kết quả?
4. `INCR` cho cùng tình huống — kết quả?
5. Fixed window 100/phút, client gửi 100 req lúc 12:00:59 và 100 req lúc 12:01:00 — bao nhiêu request trong 2 giây?
6. `INCR` thành công nhưng process chết trước `EXPIRE` — key sống bao lâu?
7. Lock `SET NX PX 30000`, công việc chạy 45 giây — có bao nhiêu tiến trình chạy song song từ giây 30?
8. Thả lock bằng `DEL` không kiểm tra token, trong tình huống câu 7 — chuyện gì xảy ra ở giây 45?
9. Thêm token + Lua để thả — điều gì được sửa? Điều gì **không** được sửa?
10. Redis chết hoàn toàn, rate limit không bắt lỗi — API thế nào?
11. Rate limit fail-open khi Redis chết — điều gì bị mất?
12. Đếm 10 triệu user duy nhất bằng `SET` vs `HyperLogLog` — bộ nhớ chênh bao nhiêu?
13. Dùng Redis lock cho "chuyển tiền chỉ một lần" — đủ chưa?

<details>
<summary>Đáp án</summary>

1. **400/phút** — mỗi pod đếm riêng.
2. **1.200/phút.** Giới hạn của bạn là một hàm của số pod.
3. Cả hai đọc 99, cả hai ghi 100. **Mất một lần tăng** → giới hạn bị vượt.
4. 100 rồi 101 — đúng. `INCR` nguyên tử.
5. **200 request trong khoảng 2 giây** — burst ở biên cửa sổ, đúng gấp đôi giới hạn danh nghĩa.
6. **Mãi mãi** — key không có TTL. Rò rỉ bộ nhớ chậm. Gộp `INCR`+`EXPIRE` vào Lua để tránh.
7. Từ giây 30, lock hết hạn → tiến trình thứ hai lấy được → **hai tiến trình chạy song song** trong 15 giây.
8. Tiến trình đầu gọi `DEL` và **xoá lock của tiến trình thứ hai** → tiến trình thứ ba vào → ba tiến trình.
9. **Sửa**: không xoá nhầm lock của người khác. **Không sửa**: hai tiến trình vẫn chạy song song từ giây 30 tới 45.
10. **API chết** — rate limit trở thành single point of failure.
11. Mất bảo vệ: mọi request đi qua. Đây thường là lựa chọn đúng (chậm còn hơn chết), nhưng phải biết và phải có alert.
12. `SET`: hàng trăm MB. HyperLogLog: **12 KB**, sai số ~0,81%.
13. **Chưa.** Lock có TTL nên không loại trừ tuyệt đối. Cần transaction + unique constraint ở database (ví dụ một bảng `transfers` với unique idempotency key).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Rate limit in-memory, chạy 4 instance, đo giới hạn thật | Gấp 4 |
| Chuyển sang Redis `INCR`, lặp lại | Đúng giới hạn |
| Dùng `GET` rồi `SET`, chạy 1.000 request đồng thời | Counter thấp hơn số request thật |
| Fixed window, gửi burst đúng ranh giới phút | Gấp đôi giới hạn trong 2 giây |
| Đổi sang token bucket, lặp lại | Burst bị kiểm soát |
| `INCR` không `EXPIRE`, chạy một ngày, đếm key | Key tích luỹ |
| Lock TTL 5s, công việc 20s, hai worker, log thời điểm bắt đầu | Chạy chồng nhau |
| Thả lock bằng `DEL` không token trong tình huống trên | Xoá nhầm lock |
| Thêm token + Lua | Không xoá nhầm; nhưng vẫn chồng |
| Thêm gia hạn định kỳ | Không chồng nữa (trừ khi process treo) |
| Dùng `pg_advisory_xact_lock` thay Redis | Không có chế độ hết hạn giữa chừng |
| `redis-cli shutdown` khi API đang chạy, không bắt lỗi | API chết |
| Thêm fail-open | API sống, không còn giới hạn |
| So bộ nhớ `SADD` 1 triệu phần tử vs `PFADD` | Chênh hàng nghìn lần |

## What Usually Goes Wrong

- **Trạng thái trong bộ nhớ với nhiều instance** → giới hạn là hàm của số pod.
- **`GET` rồi `SET`** → race condition, đếm sai.
- **`INCR` không `EXPIRE`** (hoặc không nguyên tử) → key tích luỹ vô hạn.
- **Fixed window ở biên** → gấp đôi giới hạn trong thời gian ngắn.
- **Lock không có token** → xoá nhầm lock của người khác.
- **Thả lock không nguyên tử** (`GET` rồi `DEL`) → cùng vấn đề.
- **TTL lock ngắn hơn thời gian chạy** → chạy song song, và không ai biết.
- **Coi lock là đảm bảo tuyệt đối** → công việc không idempotent chạy hai lần.
- **Dùng Redis lock cho việc tài chính** → không đủ; cần constraint ở DB.
- **Rate limit fail-closed** → Redis chết = API chết.
- **Không trả `Retry-After`** → client retry ngay, làm tệ hơn.
- **Rate limit chỉ theo IP** → nhiều người sau NAT bị chặn oan; và attacker đổi IP dễ.
- **Redis dùng chung cho cache và lock/counter với `allkeys-lru`** → lock bị evict giữa chừng.
- **Không đo tỉ lệ bị chặn** → không biết giới hạn quá chặt hay quá lỏng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Rate limit trong bộ nhớ đủ dùng | Chỉ đúng với đúng một instance |
| `INCR` rồi `EXPIRE` là nguyên tử | Hai lệnh; process chết ở giữa để lại key vĩnh viễn |
| Distributed lock đảm bảo loại trừ | TTL hết giữa chừng = chạy song song |
| Redlock giải quyết vấn đề đó | Nó tăng chịu lỗi node, không sửa vấn đề TTL |
| Có lock rồi thì không cần idempotent | Lock giảm xác suất, không loại bỏ |
| Fixed window là chính xác | Cho phép gấp đôi ở biên |
| Token bucket phức tạp hơn nên tốt hơn | Nó **cho phép** burst — có thể đúng hoặc sai tuỳ nghiệp vụ |
| Rate limit theo IP là đủ | NAT, proxy, IPv6 rotation |
| Redis transaction (`MULTI`) như transaction SQL | Không rollback được; lệnh lỗi không huỷ các lệnh khác |
| Lua script chậm | Nó chạy trong Redis, nhanh hơn nhiều round-trip |

Về `MULTI/EXEC`: nó đảm bảo các lệnh chạy liên tiếp không xen kẽ, nhưng **không có rollback**. Nếu lệnh thứ ba lỗi, hai lệnh đầu vẫn có hiệu lực. Với logic có điều kiện, Lua là công cụ đúng.

## Debugging

1. **Giới hạn không như cấu hình** → đếm ở đâu? In key thật ra log. Nếu là in-memory, đó là nguyên nhân.
2. **Người dùng bị chặn oan** → key có đúng chiều không (IP vs user)? Nhiều người sau cùng một NAT?
3. **Job chạy nhiều lần** → log `lockToken` và thời điểm bắt đầu/kết thúc trên mọi instance. So thời gian chạy với TTL.
4. **Lock bị xoá nhầm** → có token không? Thả có qua Lua không?
5. **Key tích luỹ** → `redis-cli --bigkeys` và `DBSIZE` theo thời gian. Tìm key không có TTL:
   ```bash
   redis-cli --scan --pattern 'rl:*' | head -100 | xargs -L1 redis-cli TTL
   ```
6. **Xem lệnh chậm**: `redis-cli SLOWLOG GET 10`.
7. **Đo tỉ lệ chặn theo rule** — nếu một rule chưa bao giờ chặn ai, nó vô dụng; nếu một rule chặn 20% traffic, nó quá chặt.

## Production Considerations

- **Rate limit ở nhiều tầng**: reverse proxy/CDN (rẻ nhất, chặn sớm nhất) → API gateway → ứng dụng. Tầng ngoài bảo vệ tầng trong.
- **Rate limit theo cả IP và user.** IP chống flood ẩn danh; user chống lạm dụng có tài khoản.
- **Fail-open cho rate limit** (Redis chết thì cho qua) nhưng **alert ngay** — nếu không, bạn mất bảo vệ mà không biết.
- **Tách Redis cho cache và cho lock/counter**, hoặc ít nhất không dùng `allkeys-lru` trên instance chứa lock. Lock bị evict là chế độ hỏng khó chẩn đoán nhất. Xem [Eviction & memory](04-eviction-memory.md).
- **Trả đầy đủ header** `Retry-After`, `RateLimit-*`.
- **TTL lock = p99 thời gian chạy × 2**, cộng cơ chế gia hạn cho việc dài.
- **Công việc trong lock phải idempotent.** Không có ngoại lệ.
- **Việc quan trọng về tiền dùng constraint ở database**, không dùng Redis lock. Ví dụ: bảng `transfers` với `UNIQUE (idempotency_key)`.
- **Đo tỉ lệ 429 theo endpoint và theo rule.** Đột biến thường là client mới deploy sai, và bạn muốn biết trước khi họ báo.
- **Đưa giới hạn vào tài liệu API** — client không đoán được, và họ sẽ thiết kế sai nếu không biết.
- **Cân nhắc `pg_advisory_xact_lock`** nếu đã có PostgreSQL và việc cần "chỉ một" — nó không có chế độ hỏng theo TTL.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Rate limit in-memory | nhanh nhất, không phụ thuộc | sai với nhiều instance |
| Rate limit Redis | đúng, dùng chung | +1 round-trip, thêm phụ thuộc |
| Fixed window | 1 lệnh, ít bộ nhớ | burst gấp đôi ở biên |
| Sliding log | chính xác tuyệt đối | tốn bộ nhớ theo số request |
| Sliding counter | gần đúng, rẻ | vẫn là xấp xỉ |
| Token bucket | cho phép burst có kiểm soát | phức tạp hơn, cần Lua |
| Redis lock | nhanh, không cần DB | TTL hết giữa chừng |
| PostgreSQL advisory lock | không hết hạn giữa chừng | cần một connection, chậm hơn |
| Lock + idempotent | an toàn thật sự | phải thiết kế idempotency |
| Chỉ lock | ít code | không đủ cho việc quan trọng |
| Fail-open | không chết theo Redis | mất bảo vệ |
| Fail-closed | luôn có bảo vệ | Redis chết = API chết |
| HyperLogLog | 12 KB cho hàng triệu | sai số ~0,81%, không liệt kê được |

## Explain Without Notes

1. Vì sao rate limit trong bộ nhớ sai khi có nhiều instance? Giới hạn thật là gì?
2. Vì sao `GET` rồi `SET` không dùng được, và hai cách sửa?
3. Bốn thuật toán rate limit và tiêu chí chọn giữa chúng?
4. Fixed window cho phép burst thế nào? Vẽ dòng thời gian.
5. Vì sao lock cần token ngẫu nhiên và Lua để thả? Kể chuỗi sự kiện nếu thiếu.
6. Vì sao lock có TTL không đảm bảo loại trừ lẫn nhau? Ba hệ quả?
7. Khi nào PostgreSQL advisory lock tốt hơn Redis lock?
8. Rate limit nên fail-open hay fail-closed? Vì sao?

## Related

- [Rate limiting (HTTP)](../../02-backend-api/00-http-api/07-rate-limiting.md) — hợp đồng API, 429, header
- [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md) — giới hạn cơ bản của lock phân tán
- [Locking & deadlock](../01-postgresql/transactions-concurrency/03-locking-deadlock.md) — advisory lock, `SKIP LOCKED`
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — cùng họ vấn đề ở tầng DB
- [Cache & invalidation](01-cache-invalidation.md) — Redis trong vai trò cache
- [Eviction & memory](04-eviction-memory.md) — vì sao không trộn lock với cache
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — `@Cron` + lock
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — vì sao idempotent quan trọng hơn lock
- [Guards & interceptors](../../02-backend-api/02-nestjs/behavior/04-guards-interceptors.md) — nơi đặt rate limit guard

## Version / Context

Redis 7. `SET key val NX PX ms` nguyên tử từ Redis 2.6.12. Lua script qua `EVAL`/`EVALSHA`. Header `RateLimit-*` theo bản nháp IETF; `Retry-After` là chuẩn RFC 9110.
