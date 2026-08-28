---
level: advanced
area: database
prerequisites:
  - 01-cache-invalidation.md
related:
  - 05-persistence-failure.md
  - 02-rate-limit-locking.md
---

# Eviction & memory

> Hệ thống chạy ổn định 8 tháng. Rồi một ngày, job hằng đêm không chạy. Không có lỗi, không có log. Điều tra ba giờ mới tìm ra: Redis chạm `maxmemory`, chính sách `allkeys-lru` bắt đầu evict, và nó đã evict **key lock của job** vì key đó ít được truy cập nhất. Cache và lock nằm chung một instance Redis — đó là toàn bộ nguyên nhân.

## Position

```text
App  →  Redis (RAM)  →  maxmemory
                          ↓ chạm trần
                        eviction policy quyết định:
                          xoá key nào  /  từ chối ghi  /  OOM
```

Redis lưu mọi thứ trong RAM. RAM hữu hạn. Điều gì xảy ra khi hết là một **quyết định cấu hình**, và mặc định gần như luôn sai cho production.

## Problem

```text
Không đặt maxmemory (mặc định 0 = không giới hạn)
   → Redis dùng RAM tới khi hệ điều hành hết
   → OOM killer giết process Redis
   → MẤT TOÀN BỘ dữ liệu trong RAM (kể cả queue, session, lock)
   → mọi client mất kết nối cùng lúc
```

Đặt `maxmemory` nhưng sai policy:

```text
noeviction (mặc định khi có maxmemory)
   → Redis TỪ CHỐI mọi lệnh ghi: "OOM command not allowed when used memory > 'maxmemory'"
   → đọc vẫn được
   → với cache: mọi lần ghi cache fail (chấp nhận được nếu code fail-open)
   → với queue/session: hệ thống dừng
```

Và trường hợp ở đầu note — đặt đúng policy cho cache nhưng dùng chung instance với dữ liệu **không được phép** bị evict.

## Mental Model

### Tám chính sách, ba nhóm

```text
KHÔNG XOÁ GÌ
  noeviction          từ chối ghi khi đầy          ← mặc định

CHỈ XOÁ KEY CÓ TTL
  volatile-lru        ít dùng gần đây nhất
  volatile-lfu        ít dùng THƯỜNG XUYÊN nhất
  volatile-ttl        sắp hết hạn nhất
  volatile-random     ngẫu nhiên

XOÁ BẤT KỲ KEY NÀO
  allkeys-lru         ít dùng gần đây nhất         ← cache thuần
  allkeys-lfu         ít dùng thường xuyên nhất    ← cache có key hot rõ rệt
  allkeys-random      ngẫu nhiên
```

Chọn theo **nội dung của instance**:

```text
Instance chỉ chứa cache            → allkeys-lru (hoặc allkeys-lfu)
Instance chứa cả cache và dữ liệu  → volatile-lru + BẮT BUỘC đặt TTL cho cache
  không được mất                     (dữ liệu quan trọng không có TTL ⇒ không bị evict)
Instance chứa queue/session/lock   → noeviction, và theo dõi bộ nhớ như một SLO
```

Và lời khuyên mạnh nhất: **tách instance.** Cache và queue có yêu cầu hoàn toàn khác nhau về eviction, persistence, và cách xử lý khi đầy. Dùng chung là tiết kiệm sai chỗ.

### LRU vs LFU

```text
LRU  "lâu rồi không dùng"      → giữ cái vừa được dùng
     Bẫy: một lần quét toàn bộ dữ liệu (báo cáo, crawler) đẩy hết key hot ra ngoài

LFU  "ít khi được dùng"        → giữ cái được dùng NHIỀU LẦN
     Chống được cú quét đó; tốt hơn khi có key hot rõ rệt
     Có bộ đếm suy giảm theo thời gian (lfu-decay-time) để key cũ không giữ mãi
```

Với cache của một ứng dụng web điển hình (một số trang được xem rất nhiều, phần đuôi dài ít xem), **`allkeys-lfu` thường tốt hơn `allkeys-lru`** — nhưng nó ít được dùng vì `lru` là cái mọi người biết.

Lưu ý về cách hoạt động: Redis **không** duy trì một danh sách LRU chính xác (quá tốn). Nó lấy mẫu `maxmemory-samples` key (mặc định 5) và evict cái tệ nhất trong mẫu. Tăng lên 10 cho kết quả gần chính xác hơn với chi phí CPU nhỏ.

### Bộ nhớ thật lớn hơn dữ liệu

```text
maxmemory tính:  dữ liệu + overhead cấu trúc + buffer client + buffer replication
maxmemory KHÔNG tính:  bộ nhớ phân mảnh, bộ nhớ cho fork khi BGSAVE

⇒ RSS của process có thể lớn hơn maxmemory ĐÁNG KỂ
⇒ đặt maxmemory ≈ 60–70% RAM của máy/container
```

Ba nguồn tiêu thụ ngoài dự kiến:

```text
① fork khi BGSAVE/BGREWRITEAOF
   copy-on-write: về lý thuyết rẻ, nhưng nếu ghi nhiều trong lúc fork
   thì có thể tốn tới gần gấp đôi bộ nhớ

② client output buffer
   một client chậm (hoặc MONITOR, hoặc replica chậm) làm buffer phình
   → client-output-buffer-limit

③ phân mảnh
   INFO memory → mem_fragmentation_ratio
   > 1.5 nghĩa là mất nhiều RAM cho phân mảnh
```

Điểm ① là lý do quan trọng: đặt `maxmemory = 90%` RAM container rồi bật RDB là công thức để bị OOMKilled trong lúc snapshot.

### Tìm cái gì đang chiếm chỗ

```bash
redis-cli INFO memory
# used_memory_human, used_memory_rss_human, maxmemory_human,
# mem_fragmentation_ratio, evicted_keys, maxmemory_policy

redis-cli --bigkeys          # an toàn (dùng SCAN), tìm key lớn nhất mỗi kiểu
redis-cli --memkeys          # ước lượng bộ nhớ theo key (Redis 6.0+)
redis-cli MEMORY USAGE <key> # chính xác cho một key
redis-cli DBSIZE             # tổng số key
```

Chỉ số quan trọng nhất là **`evicted_keys`**: nếu nó tăng, Redis đang xoá dữ liệu để nhường chỗ. Với cache thuần thì đó là hành vi bình thường; với instance chứa lock hay session thì đó là sự cố.

### Key không có TTL: nguồn rò rỉ chậm

```bash
# đếm key không có TTL (mẫu)
redis-cli --scan --pattern '*' | head -1000 | while read k; do
  [ "$(redis-cli TTL "$k")" = "-1" ] && echo "$k"
done | wc -l
```

`TTL` trả `-1` nghĩa là key sống mãi mãi. Ba nguồn phổ biến:

```text
① INCR rồi EXPIRE, process chết ở giữa      → counter vĩnh viễn
② SET không có TTL do quên                   → cache vĩnh viễn
③ Job history không được dọn (BullMQ)        → tăng theo số job
④ Key versioned cũ (v1:) sau khi lên v2:     → mồ côi
```

Với ①, cách sửa là gộp vào một lệnh hoặc Lua:

```bash
SET key 1 EX 60 NX          # thay cho SETNX rồi EXPIRE
```

### Cấu trúc dữ liệu và bộ nhớ

```text
Object nhỏ → Redis dùng biểu diễn NÉN (listpack/intset)
Vượt ngưỡng → chuyển sang biểu diễn đầy đủ, tốn hơn NHIỀU

hash-max-listpack-entries  128    hash ≤128 field: rất tiết kiệm
hash-max-listpack-value    64     mỗi giá trị ≤64 byte
set-max-intset-entries     512    set toàn số nguyên
zset-max-listpack-entries  128
```

Ứng dụng thực tế: thay vì 1 triệu key `user:<id>` riêng lẻ, gom thành hash theo nhóm (`users:<id/1000>` với field là id) có thể tiết kiệm rất nhiều — vì mỗi key riêng lẻ có overhead cố định đáng kể.

Đánh đổi: mất TTL theo từng phần tử (TTL đặt cho cả hash), và mất khả năng evict từng key.

### `SCAN` thay `KEYS`

```bash
# ❌ O(n), BLOCK toàn bộ Redis (single-threaded)
redis-cli KEYS 'session:*'

# ✅ lặp từng phần, không block
redis-cli --scan --pattern 'session:*' --count 100
```

Redis xử lý lệnh **một luồng**. `KEYS` trên 5 triệu key chặn mọi client khác trong vài giây. Cùng lý lẽ với `FLUSHALL` (dùng `FLUSHALL ASYNC`), `DEL` một key khổng lồ (dùng `UNLINK`), và `SMEMBERS` trên set lớn.

```bash
DEL bigkey        # đồng bộ, block theo kích thước
UNLINK bigkey     # giải phóng ở luồng nền — dùng cái này
```

### Redis Cluster: khi một node không đủ

```text
Một Redis: giới hạn ≈ RAM của một máy
Cluster:   16.384 slot chia cho N node, mỗi key thuộc một slot theo CRC16(key)
```

Ba ràng buộc phải biết trước khi chọn cluster:

```text
① Lệnh nhiều key chỉ chạy khi mọi key cùng slot
   MGET a b c  → lỗi CROSSSLOT nếu a, b, c ở khác slot
   → dùng hash tag: {user:42}:profile và {user:42}:settings cùng slot

② Transaction (MULTI/EXEC) và Lua chỉ trong một slot

③ Rebalance khi thêm/bớt node là thao tác vận hành thật, không tự động
```

Trước khi cluster, hãy thử: giảm dữ liệu (TTL ngắn hơn, bỏ key không dùng), nén giá trị lớn, tách theo mục đích (cache/queue/session thành nhiều instance riêng). Phần lớn hệ thống không cần cluster.

## Example

Cấu hình cho hai vai trò khác nhau:

```ini
# ═══ redis-cache.conf ═══ dữ liệu MẤT ĐƯỢC
maxmemory 4gb                    # ~65% RAM container 6GB
maxmemory-policy allkeys-lfu     # cache thuần → evict thoải mái
maxmemory-samples 10
save ""                          # KHÔNG persistence — restart trống là chấp nhận được
appendonly no
```

```ini
# ═══ redis-queue.conf ═══ dữ liệu KHÔNG được mất
maxmemory 2gb
maxmemory-policy noeviction      # thà từ chối ghi còn hơn mất job
appendonly yes
appendfsync everysec
```

Và phía ứng dụng phải xử lý khác nhau:

```ts
// cache: fail-open — mất cache thì chậm hơn
try { await cacheRedis.set(key, val, 'PX', ttl); } catch { /* log + tiếp tục */ }

// queue: fail-loud — không enqueue được là lỗi thật, phải báo
await queueRedis.lpush(queueKey, payload);   // để lỗi lan lên
```

Sự khác biệt trong hai dòng đó chính là điều mà việc dùng chung một instance làm bạn không thể diễn đạt được.

## Prediction

1. Không đặt `maxmemory`, dữ liệu tăng dần vượt RAM — chuyện gì xảy ra?
2. `maxmemory` đặt, policy `noeviction`, cache đầy — `SET` trả gì? `GET` thì sao?
3. Cùng cấu hình nhưng instance chứa queue — hệ thống thế nào?
4. `allkeys-lru`, instance chứa cả cache và lock của cron job — lock có thể bị xoá không?
5. Trong tình huống câu 4, job hằng đêm thế nào? Có log lỗi không?
6. `volatile-lru` nhưng cache được `SET` không có TTL — evict được gì?
7. `INCR` rồi process chết trước `EXPIRE` — key sống bao lâu?
8. `KEYS session:*` trên 5 triệu key — client khác thế nào?
9. `DEL` một list 10 triệu phần tử — Redis thế nào?
10. `UNLINK` cùng key — khác gì?
11. `maxmemory = 90%` RAM container, bật RDB, ghi nhiều trong lúc `BGSAVE` — rủi ro?
12. `MGET user:1 user:2 user:3` trên Redis Cluster — chạy được không?
13. `mem_fragmentation_ratio = 2.5` — nghĩa là gì?

<details>
<summary>Đáp án</summary>

1. Redis dùng hết RAM → **OOM killer giết process** → mất toàn bộ dữ liệu, mọi client mất kết nối.
2. `SET` trả lỗi `OOM command not allowed when used memory > 'maxmemory'`. `GET` vẫn hoạt động bình thường.
3. Không enqueue được job mới → **hệ thống dừng** phần xử lý nền. Với cache thì chấp nhận được; với queue thì không.
4. **Có** — `allkeys-*` evict bất kỳ key nào, kể cả không có TTL, kể cả lock.
5. Job có thể chạy trên nhiều instance cùng lúc (lock biến mất), hoặc không chạy. **Không có log lỗi** — eviction im lặng. Đây là sự cố ở đầu note.
6. Chỉ evict được key **có TTL**. Nếu cache không đặt TTL, Redis không có gì để evict → hành xử như `noeviction`.
7. **Mãi mãi.** Đây là rò rỉ bộ nhớ chậm và rất khó phát hiện.
8. **Bị chặn** trong suốt thời gian quét — Redis single-threaded. Có thể vài giây.
9. Block trong thời gian giải phóng bộ nhớ — có thể đáng kể với 10 triệu phần tử.
10. `UNLINK` giải phóng ở **luồng nền**, trả về ngay.
11. `fork` cho `BGSAVE` với copy-on-write: nếu ghi nhiều, số page bị copy tăng → RSS có thể tiến tới gần gấp đôi → **OOMKilled**.
12. **Không** — lỗi `CROSSSLOT` nếu ba key ở khác slot. Cần hash tag: `{u:1}:profile`...
13. RSS gấp 2,5 lần dữ liệu thật → mất nhiều RAM cho phân mảnh. Có thể cần `activedefrag yes` hoặc restart.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Không `maxmemory`, đổ dữ liệu tới khi hết RAM container | OOMKilled, mất sạch |
| `maxmemory 100mb` + `noeviction`, đổ dữ liệu | Lỗi OOM khi ghi, đọc vẫn được |
| Đổi sang `allkeys-lru`, lặp lại | Ghi thành công, key cũ biến mất |
| Đặt một lock rồi đổ dữ liệu cache cho tới khi evict | Lock biến mất, không có log |
| `volatile-lru` + cache không TTL, đổ dữ liệu | Không evict được gì; lỗi OOM |
| `SETNX` rồi kill process trước `EXPIRE`, kiểm tra `TTL` | `-1` — vĩnh viễn |
| `KEYS *` trên 1 triệu key, đo latency client khác | Bị chặn |
| `--scan` cùng pattern | Không chặn |
| Tạo list 5 triệu phần tử rồi `DEL` vs `UNLINK` | So thời gian block |
| So bộ nhớ 100k key riêng lẻ vs 100 hash mỗi cái 1.000 field | Chênh lệch lớn |
| Vượt `hash-max-listpack-entries` một field | Bộ nhớ tăng vọt |
| `maxmemory` 90% RAM, `BGSAVE` khi đang ghi nhiều | RSS tăng vọt, có thể OOMKilled |
| `MGET` nhiều key khác slot trên cluster | `CROSSSLOT` |
| Thêm hash tag, lặp lại | Hoạt động |

## What Usually Goes Wrong

- **Không đặt `maxmemory`** → OOMKilled, mất toàn bộ.
- **Cache và queue/lock chung một instance** → eviction xoá thứ không được phép mất.
- **`allkeys-*` trên instance có lock/session** → mất im lặng.
- **`volatile-*` nhưng cache không có TTL** → không evict được gì, hành xử như `noeviction`.
- **`maxmemory` quá gần RAM thật** → OOM khi fork cho BGSAVE.
- **Key không TTL tích luỹ** → rò rỉ chậm nhiều tháng.
- **`KEYS` ở production** → chặn toàn bộ Redis.
- **`DEL` key khổng lồ** → block; dùng `UNLINK`.
- **Không theo dõi `evicted_keys`** → không biết đang mất dữ liệu.
- **Không theo dõi `mem_fragmentation_ratio`** → mất RAM cho phân mảnh.
- **Object cache quá lớn** → vài key chiếm phần lớn bộ nhớ.
- **Job history không dọn** → tăng vô hạn.
- **Chuyển sang Cluster mà không biết ràng buộc CROSSSLOT** → lệnh nhiều key vỡ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Redis tự xoá key cũ khi đầy | Chỉ khi cấu hình policy phù hợp |
| Mặc định là evict | Mặc định là `noeviction` — từ chối ghi |
| `maxmemory` là toàn bộ RAM Redis dùng | RSS lớn hơn: phân mảnh, buffer, fork |
| LRU của Redis chính xác | Nó lấy mẫu; tăng `maxmemory-samples` để gần hơn |
| LRU luôn tốt hơn | LFU chống được cú quét toàn bộ |
| Key có TTL thì tự động an toàn khỏi evict | `allkeys-*` evict cả key có và không có TTL |
| Dùng chung một Redis là tiết kiệm | Nó khiến bạn không thể cấu hình đúng cho từng vai trò |
| `KEYS` an toàn nếu pattern hẹp | Nó quét **toàn bộ** keyspace |
| Nhiều key nhỏ và ít key lớn tốn như nhau | Mỗi key có overhead cố định đáng kể |
| Cluster giải quyết mọi vấn đề bộ nhớ | Nó thêm ràng buộc CROSSSLOT và chi phí vận hành |

## Debugging

1. **`INFO memory`** — bốn số: `used_memory`, `used_memory_rss`, `maxmemory`, `mem_fragmentation_ratio`.
2. **`INFO stats | grep evicted`** — `evicted_keys` tăng nghĩa là đang mất dữ liệu.
3. **`CONFIG GET maxmemory-policy`** — kiểm tra policy thật, không phải policy bạn nghĩ.
4. **`--bigkeys` và `--memkeys`** — tìm key chiếm chỗ. Thường vài key chiếm phần lớn.
5. **Key không TTL** — lấy mẫu bằng `--scan` + `TTL`, đếm số `-1`.
6. **Dữ liệu biến mất không rõ lý do** → `evicted_keys` và `expired_keys`. Nếu `evicted` tăng, đó là eviction chứ không phải bug ở app.
7. **`SLOWLOG GET 10`** — lệnh chậm, thường là `KEYS`, `SMEMBERS` set lớn, hoặc Lua nặng.
8. **Phân mảnh cao** → cân nhắc `activedefrag yes`, hoặc restart (với persistence).
9. **`CLIENT LIST`** — tìm client có `omem` lớn (output buffer phình).

## Production Considerations

- **`maxmemory` ≈ 60–70% RAM container.** Chừa chỗ cho fork, buffer và phân mảnh.
- **Tách instance theo vai trò**: cache (`allkeys-lfu`, không persistence) và queue/session (`noeviction`, có AOF). Đây là khuyến nghị quan trọng nhất trong note.
- **Alert trên bốn thứ**: `used_memory / maxmemory > 80%`, `evicted_keys` tăng bất thường, `mem_fragmentation_ratio > 1.5`, và số connection.
- **Mọi key cache phải có TTL** — kể cả khi policy là `allkeys-*`.
- **Đặt `hash-max-listpack-*` phù hợp** nếu bạn dùng nhiều hash nhỏ.
- **`UNLINK` thay `DEL`** cho key lớn; `FLUSHALL ASYNC` thay `FLUSHALL`.
- **Không bao giờ `KEYS`, `MONITOR` dài, hay `SMEMBERS` trên set lớn ở production.**
- **Đo tăng trưởng bộ nhớ theo thời gian** — tăng tuyến tính không giảm là dấu hiệu rò rỉ (key không TTL).
- **Có kế hoạch cho việc Redis trống.** Xem [Cache patterns](03-cache-patterns.md) về thundering herd.
- **Với queue, theo dõi bộ nhớ như một SLO** — `noeviction` nghĩa là đầy = dừng ghi = hệ thống dừng.
- **Rate limit và lock không nên nằm trên instance có eviction.** Mất một lock là mất tính đúng đắn, không phải mất hiệu năng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `noeviction` | không mất dữ liệu | đầy = từ chối ghi |
| `allkeys-lru` | luôn ghi được | mất dữ liệu im lặng |
| `allkeys-lfu` | giữ key hot tốt hơn | phức tạp hơn chút; cần Redis 4+ |
| `volatile-*` | bảo vệ key không TTL | nếu không key nào có TTL thì vô dụng |
| Một instance dùng chung | rẻ, ít vận hành | không cấu hình đúng cho từng vai trò |
| Nhiều instance theo vai trò | cấu hình đúng, cô lập lỗi | nhiều thứ phải vận hành |
| `maxmemory` cao | chứa nhiều dữ liệu | rủi ro OOM khi fork |
| `maxmemory` thấp | an toàn | evict nhiều, hit rate giảm |
| Hash gom nhóm | tiết kiệm bộ nhớ nhiều | mất TTL theo phần tử |
| Key riêng lẻ | TTL và evict theo từng cái | overhead cố định mỗi key |
| Cluster | vượt giới hạn một máy | CROSSSLOT, vận hành phức tạp |

## Explain Without Notes

1. Chuyện gì xảy ra khi không đặt `maxmemory`? Khi đặt nhưng để `noeviction`?
2. Ba nhóm chính sách eviction, và chọn nhóm nào cho loại instance nào?
3. LRU và LFU khác nhau thế nào? Cú quét toàn bộ ảnh hưởng cái nào?
4. Vì sao `maxmemory` không nên đặt gần RAM thật?
5. Vì sao cache và queue không nên chung một Redis? Kể một kịch bản hỏng cụ thể.
6. Ba nguồn key không có TTL, và cách phòng?
7. Vì sao `KEYS` nguy hiểm, và ba lệnh khác cũng có vấn đề tương tự?

## Related

- [Cache & invalidation](01-cache-invalidation.md) — TTL, versioned key
- [Cache patterns](03-cache-patterns.md) — thundering herd khi cache trống
- [Persistence & failure](05-persistence-failure.md) — restart mất gì; fork và bộ nhớ
- [Rate limit & locking](02-rate-limit-locking.md) — vì sao lock không được ở instance có eviction
- [Caching, queues & jobs (NestJS)](../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — `removeOnComplete`
- [Vì sao cần queue](../04-message-queues/01-why-queue.md) — queue cần `noeviction`
- [Memory, CPU & limits](../../04-infrastructure/00-linux/02-memory-cpu-limits.md) — OOMKilled ở tầng OS
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md)

## Version / Context

Redis 7. `allkeys-lfu`/`volatile-lfu` từ Redis 4. `UNLINK` từ 4. `--memkeys` từ 6.0. Tham số `*-max-listpack-*` đổi tên từ `*-max-ziplist-*` ở Redis 7. `activedefrag` cần allocator jemalloc.
