---
level: intermediate
area: database
---

# Redis & caching

Folder này **không** dạy danh sách lệnh Redis. Nó dạy bốn quyết định mà Redis buộc bạn phải đưa ra, và mỗi quyết định có một chế độ hỏng riêng:

```text
① Dữ liệu này có bản sao thứ hai      → nó SẼ lệch. Bạn kiểm soát cửa sổ lệch thế nào?
② RAM hữu hạn                          → đầy thì xoá gì? Ai được phép bị xoá?
③ RAM mất khi restart                  → cái gì trong đó mà mất là vấn đề?
④ Không ai nghe thì tin nhắn mất       → chấp nhận được không?
```

Bốn câu đó giải thích gần như mọi sự cố liên quan tới Redis: dữ liệu cũ, rò rỉ chéo người dùng, lock biến mất, session bay hết sau deploy, và thông báo realtime mất im lặng.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Cache & invalidation](01-cache-invalidation.md) | Vì sao tên cũ vẫn hiện ở 3 chỗ sau khi đã đổi? |
| 2 | [Rate limit & locking](02-rate-limit-locking.md) | Vì sao giới hạn 100/phút thành 400/phút với 4 pod? |
| 3 | [Cache patterns](03-cache-patterns.md) | Cache-aside, write-through, write-behind — chọn cái nào? |
| 4 | [Eviction & memory](04-eviction-memory.md) | Vì sao lock của cron job biến mất lúc 2 giờ sáng? |
| 5 | [Persistence & failure](05-persistence-failure.md) | Restart Redis thì mất gì? |
| 6 | [Pub/Sub & Streams](06-pubsub-streams.md) | Vì sao thông báo mất khi người dùng offline 20 giây? |

Note 1 là nền. Note 4 và 5 là hai note giải thích những sự cố khó chẩn đoán nhất.

## Redis là gì, và không là gì

```text
LÀ                                   KHÔNG LÀ
kho key-value trong RAM               database bền vững
cấu trúc dữ liệu có sẵn (hash,        nơi cất giữ nguồn sự thật
  set, sorted set, stream, HLL)       hệ thống có transaction rollback
single-threaded ⇒ lệnh NGUYÊN TỬ      nơi để dữ liệu lớn hơn RAM
rất nhanh (~0,2ms)                    Kafka
```

Tính chất quyết định nhất không phải tốc độ, mà là **single-threaded**: mỗi lệnh (và mỗi script Lua) nguyên tử với mọi client. Đó là lý do Redis phù hợp cho counter, lock, và rate limit.

Và hệ quả mặt trái: một lệnh chậm (`KEYS`, `SMEMBERS` set lớn, Lua nặng) **chặn mọi client khác**.

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ |
|---|---|
| Dữ liệu cũ hiện ở một số chỗ | invalidation không đầy đủ → [1](01-cache-invalidation.md) |
| Người dùng thấy dữ liệu của người khác | cache key thiếu chiều → [1](01-cache-invalidation.md) |
| DB tăng tải theo chu kỳ đều đặn | key hết hạn đồng loạt → [1](01-cache-invalidation.md) |
| DB bị đập khi một key hot hết hạn | cache stampede → [1](01-cache-invalidation.md) |
| Rate limit không đúng như cấu hình | đếm trong bộ nhớ với nhiều pod → [2](02-rate-limit-locking.md) |
| Cron job chạy nhiều lần | thiếu distributed lock → [2](02-rate-limit-locking.md) |
| Có lock mà job vẫn chạy trùng | TTL hết giữa chừng → [2](02-rate-limit-locking.md) |
| Cache hit rate thấp | TTL ngắn / key phân mảnh → [3](03-cache-patterns.md) |
| Redis restart làm DB sập | thundering herd → [3](03-cache-patterns.md) |
| Redis bị OOMKilled | không đặt `maxmemory` → [4](04-eviction-memory.md) |
| `OOM command not allowed` | `maxmemory` + `noeviction` → [4](04-eviction-memory.md) |
| Key biến mất không rõ lý do | eviction — kiểm tra `evicted_keys` → [4](04-eviction-memory.md) |
| Lock/session biến mất | `allkeys-*` trên instance dùng chung → [4](04-eviction-memory.md) |
| Bộ nhớ tăng đều không giảm | key không có TTL → [4](04-eviction-memory.md) |
| Latency spike định kỳ | fork cho BGSAVE → [5](05-persistence-failure.md) |
| Deploy Redis làm đăng xuất hàng loạt | session không persistence → [5](05-persistence-failure.md) |
| Mất job sau khi Redis crash | queue không persistence, không outbox → [5](05-persistence-failure.md) |
| Thông báo realtime mất khi user offline | Pub/Sub không lưu → [6](06-pubsub-streams.md) |
| Tin nhắn Stream kẹt không ai xử lý | thiếu `XAUTOCLAIM` → [6](06-pubsub-streams.md) |
| Toàn bộ Redis đứng vài giây | ai đó chạy `KEYS` → [4](04-eviction-memory.md) |

## Nguyên tắc quan trọng nhất: tách instance theo vai trò

```ini
# ═══ cache ═══  mất được
maxmemory-policy allkeys-lfu
appendonly no
# → evict thoải mái, restart trống là chấp nhận được

# ═══ queue / session / lock ═══  KHÔNG mất được
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
# → thà từ chối ghi còn hơn mất dữ liệu
```

Dùng chung một instance nghĩa là bạn phải chọn **một** cấu hình cho hai yêu cầu trái ngược — và cấu hình đó sẽ sai cho một trong hai. Sự cố "lock của cron job bị evict" ở note 4 là hệ quả trực tiếp.

## Tám quy tắc

```ts
// 1. Mọi chiều ảnh hưởng kết quả đều nằm trong key
`v2:project:${tenantId}:${userId}:${id}`

// 2. Luôn có TTL — kể cả khi đã có invalidation chủ động
await redis.set(key, val, 'PX', ttl);

// 3. Jitter để key không hết hạn đồng loạt
const ttl = base * (0.9 + Math.random() * 0.2);

// 4. Ghi DB TRƯỚC, xoá cache SAU — và DEL an toàn hơn SET
await repo.update(...); await cache.del(key);

// 5. Cache fail-open: Redis chết thì chậm hơn, không chết theo
try { return await cache.get(key); } catch { return undefined; }

// 6. Nguyên tử: một lệnh hoặc Lua. KHÔNG GET rồi SET.
await redis.incr(key);

// 7. Lock có token ngẫu nhiên, thả bằng Lua — và việc bên trong PHẢI idempotent
await redis.set(lockKey, token, 'PX', ttl, 'NX');

// 8. KHÔNG BAO GIỜ: KEYS, MONITOR dài, SMEMBERS set lớn, DEL key khổng lồ
await redis.unlink(bigKey);   // thay cho DEL
```

## Bốn lệnh chẩn đoán

```bash
redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|fragmentation'
redis-cli INFO stats  | grep -E 'evicted_keys|keyspace_hits|keyspace_misses'
redis-cli --bigkeys                    # an toàn (dùng SCAN)
redis-cli SLOWLOG GET 10               # lệnh chậm — thường là KEYS
```

`evicted_keys` tăng trên instance chứa lock/session là **sự cố**, không phải hành vi bình thường.

## Position

```text
Browser cache → CDN → Next.js cache → REDIS → PostgreSQL
                                       ↑ folder này
                                       (nguồn sự thật vẫn là PostgreSQL)
```

Dòng cuối là ràng buộc bao trùm: **Redis là lớp tăng tốc, không phải nơi cất giữ.** Mọi thiết kế trong folder này đều dựa trên giả định đó.

## Related

- [01-postgresql/](../01-postgresql/README.md) — nguồn sự thật
- [04-message-queues/](../04-message-queues/README.md) — Redis Streams/BullMQ trong bức tranh queue
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — implementation
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — lớp cache ngoài cùng
- [Data fetching & cache (Next.js)](../../01-web-frontend/03-nextjs/03-data-fetching-cache.md) — lớp framework
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md) — hợp đồng API
- [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md) — giới hạn cơ bản của lock
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — cache ở tầng kiến trúc
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — sống khi Redis chết

## Version / Context

Redis 7. `allkeys-lfu` từ 4, Streams từ 5, `XAUTOCLAIM` từ 6.2, multi-part AOF từ 7. Tham số `*-max-listpack-*` đổi tên từ `*-max-ziplist-*` ở Redis 7.
