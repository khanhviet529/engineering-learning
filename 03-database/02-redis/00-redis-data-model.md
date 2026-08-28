---
level: foundation
area: database
related:
  - 01-cache-invalidation.md
  - 04-eviction-memory.md
---

# Redis data model: key, value, và các cấu trúc

> Một team lưu session bằng cách `JSON.stringify` cả object rồi `SET`. Mỗi lần cập nhật một trường — ví dụ `lastSeenAt` — họ `GET`, parse, sửa, `SET` lại. Ở tải cao, hai request đồng thời cùng đọc, cùng sửa hai trường khác nhau, và một trong hai thay đổi biến mất. Redis có `HSET` để sửa **một field** một cách nguyên tử. **Vấn đề không phải Redis — mà là dùng nó như một kho chuỗi khi nó là một kho cấu trúc dữ liệu.**

## Position

```text
Note này: Redis LÀ CÁI GÌ và có những cấu trúc nào.
Đọc trước các note behavior (invalidation, rate limit, eviction, persistence).

Không phải command reference — redis.io làm việc đó tốt hơn.
```

## Mental Model

### Redis là một server cấu trúc dữ liệu, đơn luồng, trong bộ nhớ

```text
① TRONG BỘ NHỚ   dữ liệu nằm ở RAM → nhanh, nhưng CÓ GIỚI HẠN và CÓ THỂ MẤT
② ĐƠN LUỒNG      một lệnh chạy trọn vẹn trước lệnh tiếp theo
                 → mọi lệnh đơn lẻ là NGUYÊN TỬ, không cần khoá
                 → nhưng một lệnh CHẬM chặn TẤT CẢ
③ CẤU TRÚC DỮ LIỆU  không phải chỉ chuỗi: hash, list, set, sorted set, stream
                 → chọn đúng cấu trúc thay đổi hoàn toàn cách bạn viết code
```

```text
Hệ quả của ② quan trọng hơn nó có vẻ:

  `KEYS *` trên 10 triệu key → chặn server vài giây → mọi client timeout
  `LRANGE list 0 -1` trên list 1 triệu phần tử → tương tự
  script Lua chạy lâu → tương tự

⇒ trong Redis, "một lệnh chậm" không chỉ chậm cho bạn.
```

### Key: một không gian phẳng

```text
Redis KHÔNG có bảng, không có schema. Chỉ có một map key → value khổng lồ.
Cấu trúc duy nhất là QUY ƯỚC ĐẶT TÊN của bạn.

  user:1234:session          ← quy ước phổ biến: <loại>:<id>:<thuộc tính>
  cache:v3:product:abc       ← version trong key: đổi cấu trúc = tăng version
  ratelimit:tenant:42:1m

Ba quy tắc:
  · tiền tố theo miền → xoá/đếm theo nhóm được, và tránh va chạm
  · version trong key → đổi định dạng không cần xoá thủ công
  · GỒM tenant/user khi dữ liệu riêng → thiếu nó là lỗ hổng, không phải lỗi cache
```

### Expiration: TTL gắn với KEY

```text
SET key value EX 300        đặt và hết hạn sau 300 giây
TTL key                     còn bao nhiêu giây (-1 = không hết hạn, -2 = không tồn tại)
EXPIRE key 300              đặt TTL cho key đã có
PERSIST key                 bỏ TTL

⚠ Ghi đè key bằng SET (không kèm EX) sẽ XOÁ TTL → key sống mãi mãi.
  Đây là nguồn của "cache không bao giờ hết hạn" mà không ai giải thích được.
  → dùng `SET key value KEEPTTL` nếu muốn giữ.
```

```text
Redis xoá key hết hạn theo hai cách:
  · LAZY     khi có ai truy cập key đó
  · ACTIVE   lấy mẫu ngẫu nhiên định kỳ

⇒ key hết hạn vẫn CHIẾM BỘ NHỚ cho tới khi một trong hai cơ chế chạm tới nó.
⇒ `TTL` là hợp đồng về tính đúng đắn, không phải về bộ nhớ.
```

### Sáu cấu trúc và bài toán của từng cái

| Cấu trúc | Là gì | Dùng cho | Lệnh chính |
|---|---|---|---|
| **String** | chuỗi/số nhị phân | cache object đã serialize, bộ đếm, cờ | `GET` `SET` `INCR` `SETNX` |
| **Hash** | map field → value | object mà bạn sửa **từng field** | `HGET` `HSET` `HINCRBY` `HGETALL` |
| **List** | danh sách hai đầu | hàng đợi đơn giản, log gần đây | `LPUSH` `RPOP` `LRANGE` `BLPOP` |
| **Set** | tập không trùng, không thứ tự | tư cách thành viên, khử trùng lặp | `SADD` `SISMEMBER` `SINTER` |
| **Sorted set** | tập có điểm số | bảng xếp hạng, hàng đợi ưu tiên, sliding window | `ZADD` `ZRANGE` `ZREMRANGEBYSCORE` |
| **Stream** | log append-only có consumer group | event, hàng đợi có ack | `XADD` `XREADGROUP` `XACK` |

```text
Chọn cấu trúc — ba câu hỏi:

"tôi có cần sửa MỘT PHẦN của giá trị không?"
  có  → Hash    (không phải String)
"tôi có cần THỨ TỰ theo một số điểm nào đó không?"
  có  → Sorted set
"tôi có cần biết đã XỬ LÝ hay chưa (ack, retry)?"
  có  → Stream  (không phải List)
```

### String vs Hash: sự cố ở đầu note

```ts
// ✗ String: sửa một field = đọc, parse, sửa, ghi lại toàn bộ
const s = JSON.parse(await redis.get(`session:${id}`));
s.lastSeenAt = Date.now();
await redis.set(`session:${id}`, JSON.stringify(s));
// → hai request đồng thời: lost update

// ✓ Hash: sửa đúng field, nguyên tử, không đọc trước
await redis.hset(`session:${id}`, 'lastSeenAt', Date.now());
await redis.hincrby(`session:${id}`, 'requestCount', 1);
```

```text
Đánh đổi:
  String  đơn giản, đọc cả object một lần, dễ serialize object lồng nhau
  Hash    sửa từng field nguyên tử, đọc một field không tải cả object
          nhưng: giá trị field là chuỗi phẳng — object lồng nhau phải tự mã hoá

⇒ dữ liệu đọc-cả-cụm và ít sửa  → String
⇒ dữ liệu sửa từng phần thường xuyên → Hash
```

### Sorted set: cấu trúc bị đánh giá thấp nhất

```ts
// bảng xếp hạng
await redis.zadd('leaderboard', score, userId);
await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');   // top 10

// sliding window rate limit — điểm số là TIMESTAMP
const now = Date.now();
await redis.zremrangebyscore(key, 0, now - 60_000);   // bỏ sự kiện cũ hơn 1 phút
const count = await redis.zcard(key);                  // còn bao nhiêu trong cửa sổ
if (count < limit) await redis.zadd(key, now, `${now}-${randomUUID()}`);

// hàng đợi ưu tiên / lịch: điểm số là THỜI ĐIỂM CHẠY
await redis.zadd('scheduled', runAt, jobId);
const due = await redis.zrangebyscore('scheduled', 0, Date.now(), 'LIMIT', 0, 100);
```

Điểm số là một số thực tuỳ ý — dùng nó làm timestamp, độ ưu tiên, hay điểm số đều được. Đó là lý do một cấu trúc phục vụ được ba bài toán rất khác nhau.

### List vs Stream cho hàng đợi

```text
LIST     LPUSH / BRPOP
  ✓ đơn giản, đủ cho việc nhẹ
  ✗ lấy ra là MẤT — worker chết giữa chừng thì job biến mất
  ✗ không có consumer group, không có ack, không có retry

STREAM   XADD / XREADGROUP / XACK
  ✓ message ở lại cho tới khi ACK
  ✓ consumer group: nhiều worker chia việc
  ✓ XAUTOCLAIM lấy lại message của worker đã chết
  ✗ phức tạp hơn, cần dọn stream (XTRIM)

⇒ mất một job có sao không?
   không sao → List.  có sao → Stream (hoặc một message broker thật).
```

### Điều Redis KHÔNG phải

```text
✗ KHÔNG phải nguồn sự thật cho dữ liệu không được mất
  → nó là bộ nhớ; persistence là "giảm mất mát", không phải "không mất"

✗ KHÔNG phải database quan hệ
  → không join, không transaction đa bước như SQL, không truy vấn tuỳ ý

✗ KHÔNG phải nơi lưu dữ liệu lớn không giới hạn
  → hết bộ nhớ → eviction (theo chính sách) hoặc từ chối ghi

✓ Redis là: bộ nhớ dùng chung, rất nhanh, có cấu trúc, giữa nhiều process.
```

### Nguyên tử: một lệnh, MULTI, hay Lua

```text
MỘT LỆNH      luôn nguyên tử — kể cả lệnh phức tạp như ZREMRANGEBYSCORE
MULTI/EXEC    gom nhiều lệnh chạy liên tiếp không xen kẽ
              ✗ KHÔNG có rollback; ✗ không đọc-rồi-quyết-định giữa chừng
WATCH         optimistic lock: EXEC thất bại nếu key bị đổi → phải retry
LUA (EVAL)    logic đọc-quyết-định-ghi trong MỘT lần chạy nguyên tử
              → dùng khi cần "kiểm tra rồi hành động"
```

```lua
-- ví dụ: chỉ xoá khoá nếu nó là của mình (đọc + so sánh + xoá, nguyên tử)
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

Không có Lua, `GET` rồi `DEL` là hai lệnh — key có thể hết hạn ở giữa và bạn xoá khoá của người khác. Xem [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md).

## Prediction

1. `SET key value` lên một key đang có TTL — TTL còn không?
2. Cách giữ TTL khi ghi đè?
3. `KEYS *` trên 10 triệu key — ảnh hưởng tới client khác thế nào?
4. Dùng lệnh nào thay thế?
5. Sửa một field bằng `GET` + parse + `SET`, hai request đồng thời — chuyện gì xảy ra?
6. Dùng `HSET` cho cùng việc — chuyện gì xảy ra?
7. Key đã hết hạn nhưng chưa ai truy cập — nó còn chiếm bộ nhớ không?
8. Worker lấy job bằng `BRPOP` rồi chết trước khi xử lý xong — job thế nào?
9. Dùng Stream với `XACK` — job thế nào?
10. Cần rate limit sliding window — cấu trúc nào?
11. `GET` rồi `DEL` để giải phóng khoá, key hết hạn giữa hai lệnh — chuyện gì xảy ra?
12. Redis là nguồn sự thật duy nhất cho số dư ví — rủi ro gì?

<details>
<summary>Đáp án</summary>

1. **Bị xoá** — key sống vĩnh viễn.
2. `SET key value KEEPTTL`.
3. **Chặn server** vài giây — Redis đơn luồng; mọi client timeout.
4. `SCAN` — lặp theo lô, không chặn.
5. **Lost update** — một trong hai thay đổi biến mất.
6. Cả hai field được cập nhật; `HSET` chỉ đụng field đó.
7. **Có** — cho tới khi lazy hoặc active expiration chạm tới.
8. **Mất** — List không có ack.
9. Nó ở trong pending list, `XAUTOCLAIM` lấy lại được.
10. **Sorted set** với điểm số là timestamp.
11. Bạn **xoá khoá của người khác** — cần Lua.
12. Redis là bộ nhớ, có giới hạn và **có thể mất dữ liệu**.
</details>

## What Usually Goes Wrong

- **`SET` ghi đè làm mất TTL** → key sống vĩnh viễn.
- **`KEYS` trong production** → chặn server.
- **Dùng String cho dữ liệu sửa từng phần** → lost update.
- **Dùng List cho việc không được mất** → job biến mất khi worker chết.
- **Key không có tiền tố/version** → không xoá theo nhóm được, va chạm tên.
- **Khoá cache thiếu tenant/user** → rò rỉ dữ liệu chéo.
- **Không có TTL** → bộ nhớ đầy dần.
- **`GET` rồi `DEL`** thay vì Lua nguyên tử.
- **Coi Redis là nguồn sự thật** cho dữ liệu quan trọng.
- **Lệnh chạy trên tập rất lớn** (`LRANGE 0 -1`, `SMEMBERS` trên set khổng lồ).
- **Script Lua chạy lâu** → chặn toàn bộ server.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Redis chỉ lưu chuỗi | Nó là server cấu trúc dữ liệu |
| Đơn luồng nghĩa là chậm | Nó nhanh, và cho bạn tính nguyên tử miễn phí |
| Đơn luồng nghĩa là an toàn với mọi lệnh | Một lệnh chậm chặn tất cả |
| TTL đảm bảo bộ nhớ được giải phóng đúng lúc | Key hết hạn vẫn chiếm chỗ tới khi bị dọn |
| `SET` giữ nguyên TTL | Nó xoá TTL trừ khi có `KEEPTTL` |
| `MULTI` là transaction có rollback | Không có rollback |
| List là hàng đợi đủ dùng | Không có ack, không retry |
| Redis có persistence nên không mất dữ liệu | Nó giảm mất mát, không loại bỏ |
| Redis thay được database | Không join, không truy vấn tuỳ ý, giới hạn bộ nhớ |

## Explain Without Notes

1. Ba tính chất định nghĩa Redis, và hệ quả của tính đơn luồng.
2. Ba quy tắc đặt tên key, và quy tắc nào là vấn đề bảo mật nếu bỏ?
3. Vì sao `SET` có thể làm key sống vĩnh viễn?
4. Ba câu hỏi để chọn cấu trúc dữ liệu.
5. String và Hash — khi nào dùng cái nào, và lỗi gì xảy ra khi chọn sai?
6. Vì sao sorted set phục vụ được bảng xếp hạng, rate limit và hàng đợi lịch?
7. List và Stream khác nhau ở điều gì quyết định?
8. Khi nào cần Lua thay vì nhiều lệnh liên tiếp?

## Related

- [Cache invalidation](01-cache-invalidation.md) — TTL, xoá, phiên bản
- [Rate limit & locking](02-rate-limit-locking.md) — sorted set và Lua trong thực tế
- [Cache patterns](03-cache-patterns.md) — cache-aside, stampede, penetration
- [Eviction & memory](04-eviction-memory.md) — khi hết bộ nhớ
- [Persistence & failure](05-persistence-failure.md) — RDB, AOF, mất dữ liệu
- [Pub/Sub & streams](06-pubsub-streams.md) — consumer group
- [Distributed locks](../../05-cross-cutting/concurrency/03-distributed-locks.md) — vì sao cần Lua
- [Storage selection](../../06-system-design/06-storage-selection.md) — Redis đúng vai trò
- [Why queue](../04-message-queues/01-why-queue.md) — khi nào cần broker thật

## Version / Context

Redis **7.x**. `KEEPTTL` có từ Redis 6.0. Streams và consumer group từ 5.0; `XAUTOCLAIM` từ 6.2. `SCAN` là lệnh thay thế an toàn cho `KEYS` trong mọi phiên bản. Từ Redis 7, một số thao tác nền (như giải phóng bộ nhớ) chạy trên luồng riêng, nhưng **việc thực thi lệnh vẫn đơn luồng** — mọi lời khuyên về lệnh chậm vẫn áp dụng. Valkey là bản fork tương thích API sau khi Redis đổi giấy phép năm 2024.
