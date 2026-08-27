---
level: intermediate
area: backend
prerequisites:
  - 01-http-request-response.md
related:
  - ../../03-database/02-redis/02-rate-limit-locking.md
  - ../../05-cross-cutting/reliability/04-capacity-and-limits.md
---

# Rate limiting

> Rate limit không phải chỉ để chống abuse. Nó là cách bạn **quyết định trước** ai bị từ chối khi hệ thống quá tải — thay vì để hệ thống tự chọn bằng cách sập cho tất cả mọi người.

## Position

```text
Client → CDN/WAF → Reverse proxy → API Gateway → App → DB
             ↑          ↑                          ↑
        lớp thô     lớp chung               lớp theo nghiệp vụ
```

## Problem

Bốn tình huống khác nhau cần bốn giới hạn khác nhau:

1. Một script gọi `/api/search` 1000 lần/giây → database quá tải, **mọi** người dùng bị ảnh hưởng.
2. Ai đó brute-force `/auth/login` với 10.000 mật khẩu.
3. Một client bug gửi request trong vòng lặp vô hạn.
4. Endpoint gửi email bị lạm dụng để spam.

Nếu không có giới hạn, một client làm hỏng dịch vụ cho tất cả. Đây không phải rủi ro giả định — một vòng lặp `while(true) fetch()` trong code của một client là đủ.

Và ngược lại: giới hạn quá chặt hoặc đặt sai chiều làm người dùng hợp lệ bị chặn (ví dụ: giới hạn theo IP khi nhiều người dùng ở sau cùng một NAT công ty).

## Mental Model

Ba câu hỏi, theo thứ tự:

```text
1. Giới hạn theo CÁI GÌ?     → user, API key, IP, tenant, endpoint
2. Giới hạn BAO NHIÊU?        → dựa trên năng lực thật, không phải số tròn
3. Khi vượt thì LÀM GÌ?       → từ chối (429) | xếp hàng | làm chậm | degrade
```

Câu 1 quan trọng nhất và hay bị làm sai:

| Giới hạn theo | Phù hợp | Vấn đề |
|---|---|---|
| **IP** | endpoint công khai chưa đăng nhập | NAT/office chia sẻ IP; IPv6 dễ đổi; proxy che IP thật |
| **User ID** | API đã xác thực | attacker tạo nhiều account |
| **API key** | API cho bên thứ ba | tốt nhất khi có |
| **Tenant** | SaaS multi-tenant | một tenant không ảnh hưởng tenant khác |
| **Endpoint + user** | thao tác đắt cụ thể | phức tạp hơn nhưng chính xác nhất |

Thực tế cần **nhiều lớp cùng lúc**: IP cho request chưa đăng nhập, user cho request đã đăng nhập, và giới hạn riêng chặt hơn cho các endpoint đắt (search, export, login).

### Bốn thuật toán

```text
Fixed window        [0-60s]: 100 request
                    ❌ burst ở biên: 100 request lúc 0:59 + 100 lúc 1:00 = 200 trong 2 giây

Sliding window log  lưu timestamp mỗi request, đếm trong 60s gần nhất
                    ✅ chính xác   ❌ tốn memory (mỗi request một entry)

Sliding window counter  chia nhỏ window thành nhiều bucket, nội suy
                    ✅ gần chính xác, ít memory   → lựa chọn tốt trong thực tế

Token bucket        bucket có N token, hồi phục R token/giây
                    ✅ CHO PHÉP BURST có kiểm soát, tốc độ trung bình vẫn giới hạn
                    → phù hợp nhất với hành vi người dùng thật
```

Token bucket là mặc định tốt nhất cho API người dùng: người dùng thật hoạt động theo cụm (mở trang → 10 request cùng lúc → im lặng 30 giây). Fixed window chặn họ ở cụm đầu tiên dù mức trung bình rất thấp.

## How It Works

### Token bucket với Redis

```ts
// Lua script — atomic, chạy trong Redis, không có race giữa đọc và ghi
const SCRIPT = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])   -- token mỗi giây
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local b = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(b[1]) or capacity
local ts     = tonumber(b[2]) or now

-- hồi phục token theo thời gian đã trôi
tokens = math.min(capacity, tokens + (now - ts) * rate)

local allowed = tokens >= cost
if allowed then tokens = tokens - cost end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / rate) * 2)

return { allowed and 1 or 0, math.floor(tokens) }
`;

async function consume(key: string, cost = 1) {
  const [allowed, remaining] = await redis.eval(
    SCRIPT, 1, key, CAPACITY, RATE, Date.now() / 1000, cost,
  ) as [number, number];
  return { allowed: allowed === 1, remaining };
}
```

Vì sao Lua script: đọc rồi ghi bằng hai lệnh Redis riêng tạo race condition — hai request đồng thời đều đọc thấy còn token. Script chạy atomic trong Redis. Xem [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md).

**`cost`** là tham số quan trọng: không phải request nào cũng tốn như nhau. Một `GET /tasks/1` tốn 1 token; một `POST /reports/export` tốn 50. Đây là cách giới hạn theo *tài nguyên* thay vì theo *số request*.

### Response khi bị giới hạn

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 30
Content-Type: application/json

{ "error": { "code": "RATE_LIMITED", "message": "Quá nhiều yêu cầu", "requestId": "018f..." } }
```

`Retry-After` là bắt buộc. Không có nó, client retry ngay lập tức và làm tình hình tệ hơn — bạn vừa biến một vấn đề tải thành một vòng lặp.

Trả header `RateLimit-*` cả khi **chưa** vượt giúp client tự điều tiết trước khi bị chặn.

### Nhiều lớp

```ts
// Guard trong NestJS — nhiều giới hạn cùng lúc
@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;
    const ip = getClientIp(req);                    // cẩn thận với X-Forwarded-For

    const checks = userId
      ? [
          { key: `u:${userId}`, cap: 1000, rate: 1000 / 60 },
          { key: `u:${userId}:${req.route.path}`, cap: 60, rate: 1 },
        ]
      : [{ key: `ip:${ip}`, cap: 60, rate: 1 }];

    for (const c of checks) {
      const { allowed, remaining } = await consume(c.key, getCost(req));
      if (!allowed) throw new RateLimitError(computeRetryAfter(c));
      req.res.setHeader('RateLimit-Remaining', String(remaining));
    }
    return true;
  }
}
```

### Giới hạn chặt cho endpoint nhạy cảm

```text
POST /auth/login          → 5/phút theo IP + 10/giờ theo email
                            (hai chiều: chống brute-force một account VÀ spray nhiều account)
POST /auth/reset-password → 3/giờ theo email
POST /invitations         → 20/ngày theo user
GET  /search              → 30/phút theo user, cost cao
POST /reports/export      → 5/giờ theo user, cost rất cao
```

Login cần **hai** giới hạn vì có hai kiểu tấn công: brute-force (nhiều mật khẩu, một account) và credential spray (một mật khẩu, nhiều account). Giới hạn theo IP bắt kiểu một; giới hạn theo email bắt kiểu hai.

### `X-Forwarded-For` — bẫy bảo mật

```ts
// ❌ Attacker tự đặt header này → bypass rate limit hoàn toàn
const ip = req.headers['x-forwarded-for'];

// ✅ Chỉ tin proxy của bạn, lấy IP ở vị trí đúng
app.set('trust proxy', 1);          // số hop proxy bạn kiểm soát
const ip = req.ip;
```

Nếu app tin `X-Forwarded-For` một cách vô điều kiện, rate limit theo IP trở nên vô nghĩa: attacker gửi IP ngẫu nhiên trong mỗi request.

## Example

```text
Token bucket: capacity 20, rate 1 token/giây

t=0    bucket đầy (20)
       user mở trang → 10 request cùng lúc → còn 10 token   ✅ burst được phép
t=1    còn 11
t=5    còn 15
t=6    script gọi 20 request → còn 0 sau 15 request, 5 request cuối bị 429
t=7    còn 1 → 1 request qua
```

Người dùng thật (burst rồi nghỉ) không bao giờ chạm giới hạn. Script (liên tục) bị giới hạn về đúng 1 request/giây.

## Prediction

1. Fixed window 100/phút: client gửi 100 request lúc 0:59 và 100 lúc 1:00 — bao nhiêu request trong 2 giây?
2. Token bucket capacity 20 rate 1/s: burst 20 request tức thì — qua hết không? Rồi 20 request nữa ngay sau?
3. Trả 429 không có `Retry-After`, client có retry logic — điều gì xảy ra?
4. Rate limit theo IP, 50 người dùng ở một office sau NAT — ai bị chặn?
5. App tin `X-Forwarded-For` vô điều kiện, attacker gửi IP random — rate limit hoạt động?
6. Rate limit lưu counter trong memory của app, 3 instance — giới hạn thực tế là bao nhiêu?
7. Login chỉ giới hạn theo IP, attacker dùng 1000 IP thử 1 mật khẩu cho 1000 account — bị chặn?

<details>
<summary>Đáp án</summary>

1. 200 trong ~2 giây — lỗ hổng biên của fixed window.
2. Burst đầu qua hết; burst thứ hai gần như bị chặn hết (bucket rỗng).
3. Retry ngay → tăng tải → nhiều 429 hơn → vòng lặp.
4. Cả 50 người dùng chung một quota — người dùng hợp lệ bị chặn.
5. Không — bypass hoàn toàn.
6. 3× giới hạn dự định (mỗi instance một counter).
7. Không — cần giới hạn theo email/account nữa.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Fixed window, gửi burst ở biên window | 2× giới hạn trong thời gian ngắn |
| Bỏ `Retry-After`, client retry tự động | Vòng lặp retry |
| Rate limit in-memory, scale lên 3 instance | Giới hạn thực tế 3× |
| Tin `X-Forwarded-For`, gửi IP random | Bypass hoàn toàn |
| Đọc-rồi-ghi Redis bằng 2 lệnh, gửi 100 request song song | Vượt giới hạn (race condition) |
| Đổi sang Lua script, làm lại | Chính xác |
| Rate limit theo IP, test từ sau NAT | Người dùng hợp lệ bị chặn |
| Không giới hạn `/auth/login` | Brute-force 10.000 mật khẩu |
| Cùng cost cho mọi endpoint, spam endpoint đắt nhất | Database quá tải dù chưa chạm giới hạn request |

## What Usually Goes Wrong

- **Rate limit in-memory với nhiều instance** → giới hạn nhân theo số instance.
- **Đọc-rồi-ghi không atomic** → race condition, vượt giới hạn.
- **Không có `Retry-After`** → retry storm.
- **Tin `X-Forwarded-For`** → bypass.
- **Chỉ giới hạn theo IP** → chặn người dùng sau NAT, và không chặn được attacker nhiều IP.
- **Không giới hạn endpoint auth** → brute-force.
- **Cùng cost cho mọi endpoint** → endpoint đắt vẫn làm sập DB.
- **Giới hạn quá chặt** → người dùng hợp lệ bị chặn; không đo trước khi đặt số.
- **Không có metric** → không biết ai bị chặn và vì sao.
- **Đếm cả request bị chặn** vào quota → user bị khoá lâu hơn dự định (thường là hành vi mong muốn cho attacker, không mong muốn cho client bug).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Rate limit chỉ chống abuse | Nó cũng bảo vệ hệ thống khỏi client bug và quyết định trước ai bị từ chối |
| Fixed window đủ dùng | Có lỗ hổng biên 2× |
| Rate limit theo IP là đủ | NAT chặn oan; nhiều IP bypass |
| In-memory counter ổn cho production | Chỉ khi có đúng một instance |
| 429 nghĩa là attacker | Thường là client bug hoặc giới hạn đặt sai |
| Giới hạn càng chặt càng an toàn | Chặn người dùng hợp lệ là một loại outage |
| Rate limit ở app là đủ | Cần cả lớp thô ở CDN/WAF cho tấn công lớn |

## Debugging

1. **Người dùng báo bị chặn** → log mỗi lần 429 với key, giới hạn, và giá trị hiện tại. Không có log này thì không debug được.
2. **Metric theo key type** (ip/user/endpoint) → xem chiều nào đang chặn.
3. **Vượt giới hạn** → kiểm tra atomic (Lua script hay hai lệnh?) và kiểm tra store dùng chung (Redis hay memory?).
4. **Kiểm tra IP thật** → log `req.ip` và `X-Forwarded-For` đầy đủ; xác nhận `trust proxy` đúng số hop.
5. **Tái hiện** bằng burst:
   ```bash
   for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code}\n' <url> & done; wait | sort | uniq -c
   ```
6. **Giới hạn có hợp lý?** → so với p99 số request/phút của người dùng thật. Đặt giới hạn ở khoảng 5–10× mức đó.

## Production Considerations

- **Store dùng chung (Redis)** cho mọi rate limit khi có nhiều instance.
- **Atomic bằng Lua script** hoặc `INCR` + `EXPIRE` đúng thứ tự.
- **Nhiều lớp**: CDN/WAF (thô, chống DDoS) → proxy (chung) → app (theo nghiệp vụ).
- **Token bucket** cho API người dùng; cost khác nhau theo endpoint.
- **Header `RateLimit-*`** để client tự điều tiết; `Retry-After` khi 429.
- **Giới hạn chặt hai chiều cho auth** (IP và account).
- **Fail open hay fail closed?** Nếu Redis chết: fail open (cho qua) giữ dịch vụ nhưng mất bảo vệ; fail closed (chặn hết) an toàn nhưng gây outage. Với endpoint auth thì fail closed; với endpoint đọc thông thường thì fail open. Đây là quyết định phải làm tường minh.
- **Metric và alert** trên tỉ lệ 429 — tăng đột ngột là dấu hiệu tấn công hoặc client bug.
- Đặt giới hạn dựa trên **năng lực đo được** của hệ thống, không dựa trên số tròn. Xem [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Token bucket | cho phép burst tự nhiên | phức tạp hơn fixed window |
| Fixed window | đơn giản nhất | lỗ hổng biên 2× |
| Sliding log | chính xác nhất | tốn memory theo số request |
| Theo IP | không cần auth | NAT chặn oan, nhiều IP bypass |
| Theo user | chính xác | cần auth trước khi kiểm tra |
| Redis dùng chung | đúng với nhiều instance | thêm dependency, thêm latency |
| Fail open | giữ dịch vụ khi Redis chết | mất bảo vệ |
| Fail closed | luôn được bảo vệ | Redis chết = outage |

## Explain Without Notes

1. Ba câu hỏi khi thiết kế rate limit?
2. Lỗ hổng của fixed window, và token bucket sửa nó thế nào?
3. Vì sao token bucket phù hợp với hành vi người dùng thật?
4. Vì sao cần Lua script thay vì đọc-rồi-ghi?
5. Vì sao login cần hai chiều giới hạn?
6. Fail open vs fail closed — chọn thế nào?

## Related

- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md) — implementation chi tiết
- [HTTP request/response](01-http-request-response.md) — 429, `Retry-After`
- [Error model](05-error-model.md) — `RATE_LIMITED`
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md) — chọn con số
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Password & MFA](../03-auth/05-password-mfa.md) — brute-force protection
- [Guards & interceptors](../02-nestjs/04-guards-interceptors.md) — nơi đặt trong NestJS
