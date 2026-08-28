---
level: advanced
area: backend
prerequisites:
  - ../00-http-api/02-rest-api-contract.md
  - 08-service-decomposition.md
related:
  - ../../01-web-frontend/04-application-engineering/01-multi-api-screen.md
  - ../../05-cross-cutting/reliability/03-graceful-degradation.md
---

# BFF & aggregation

> BFF không phải "một API gộp cho tiện". Nó là một service riêng với timeout budget, partial response và degradation của riêng nó. Nếu bạn không thiết kế ba thứ đó, BFF chỉ chuyển vấn đề từ client sang server.

## Position

```text
Web / Mobile / Partner
        ↓
    BFF (một per client type)      ← note này
        ↓ fan-out song song
User · Orders · Permissions · Notifications
        ↓
      DB / cache
```

## Problem

Màn hình dashboard cần 6 nguồn. Client gọi 6 API:

```text
Mobile trên 4G, RTT ~150ms
  6 request song song  = ~200ms (nếu độc lập hoàn toàn)
  2 tầng phụ thuộc     = ~350ms
  Payload: 6 × 80KB    = 480KB, UI dùng 30KB
```

Ba vấn đề, và chúng đo được:

1. **Round-trip trên mạng chậm** — mỗi tầng phụ thuộc là một RTT nữa.
2. **Over-fetching** — API được thiết kế chung, trả nhiều hơn màn hình cần.
3. **Client biết quá nhiều** — thứ tự gọi, endpoint nào của service nào, cách ghép dữ liệu. Đổi backend là đổi client (và mobile app không update được ngay).

BFF giải quyết cả ba. Nhưng nó tạo ra ba vấn đề mới mà phần lớn implementation bỏ qua: **timeout budget**, **partial failure**, và **thêm một service phải vận hành**.

## Mental Model

```text
API Gateway                       BFF
─────────────                     ───
routing, auth, rate limit         gộp dữ liệu, shape response
KHÔNG biết nghiệp vụ              BIẾT màn hình cần gì
một cho cả hệ thống               MỘT PER CLIENT TYPE
không thay đổi payload            thay đổi payload theo client
```

Ba lớp, ba vai:

```text
Client → API Gateway (auth, rate limit, TLS) → BFF (gộp, shape) → Services
```

Điểm quan trọng nhất về BFF, và là điểm hay bị làm sai:

> **BFF thuộc về team frontend, và có một BFF cho mỗi loại client.**

Nếu web và mobile dùng chung một BFF, nó sẽ tích tụ tham số điều kiện (`?platform=mobile&fields=...`) và trở thành đúng cái API chung mà nó lẽ ra thay thế. Web cần 30 field cho màn hình rộng; mobile cần 8. Đó là hai response khác nhau, không phải một response có flag.

### Timeout budget — khái niệm cốt lõi

```text
Client timeout:  3000ms
      ↓
BFF budget:      2500ms   (để dành 500ms cho network + serialize)
      ↓ fan-out SONG SONG, mỗi call có timeout RIÊNG
  user:          500ms   (critical)
  orders:        800ms   (important)
  stats:        1500ms   (optional — timeout dài hơn nhưng vẫn trong budget)
  notifications: 300ms   (optional)

Tổng thời gian = max(các call), KHÔNG PHẢI tổng
→ nhưng mỗi call phải có trần để một service chậm không ăn hết budget
```

Nguyên tắc: **timeout giảm dần khi đi vào trong.** Nếu BFF timeout 5s trong khi client timeout 3s, client đã bỏ đi trong khi BFF vẫn giữ tài nguyên chờ — và bạn tích luỹ công việc zombie. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## How It Works

### Fan-out với partial failure

```ts
type Criticality = 'critical' | 'important' | 'optional';

async function fetchWithBudget<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  return fn(AbortSignal.timeout(ms));
}

@Injectable()
export class DashboardBff {
  constructor(
    private readonly users: UserClient,
    private readonly orders: OrderClient,
    private readonly stats: StatsClient,
    private readonly notifs: NotificationClient,
  ) {}

  async getDashboard(userId: string) {
    // Tầng 1: critical — phải có, và phải xong trước
    const user = await fetchWithBudget((s) => this.users.get(userId, s), 500);

    // Tầng 2: song song, mỗi cái có timeout riêng
    const [orders, stats, notifs] = await Promise.allSettled([
      fetchWithBudget((s) => this.orders.recent(user.orgId, s), 800),
      fetchWithBudget((s) => this.stats.summary(user.orgId, s), 1500),
      fetchWithBudget((s) => this.notifs.unread(userId, s), 300),
    ]);

    const degraded: string[] = [];
    const pick = <T>(r: PromiseSettledResult<T>, name: string, fallback: T): T => {
      if (r.status === 'fulfilled') return r.value;
      this.logger.warn({ source: name, err: r.reason }, 'bff partial failure');
      degraded.push(name);
      return fallback;
    };

    return {
      // Shape THEO MÀN HÌNH, không theo entity của service
      user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      recentOrders: pick(orders, 'orders', []).slice(0, 5).map(toOrderCard),
      stats: pick(stats, 'stats', null),
      unreadCount: pick(notifs, 'notifications', 0),
      degraded,                        // ← client HIỂN THỊ được điều này
    };
  }
}
```

Bốn quyết định trong đoạn trên:

1. **`Promise.allSettled`, không `Promise.all`** — một service optional chết không được làm sập cả response.
2. **Timeout riêng cho mỗi call**, tổng nằm trong budget.
3. **Fallback theo criticality** — `[]`, `null`, `0` thay vì lỗi.
4. **`degraded` trong response** — client hiện "một số dữ liệu chưa tải được" thay vì âm thầm hiện rỗng. Đây là chi tiết nhỏ có giá trị lớn: người dùng phải phân biệt được "không có đơn hàng" và "không tải được đơn hàng".

### Critical vs optional — quyết định phải tường minh

```ts
// critical: fail là fail cả response
const user = await this.users.get(userId);      // throw → 500/503

// optional: fail thì degrade
const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
```

Nếu không phân loại, mặc định là "tất cả critical" — và một service phụ chết làm sập dashboard. Xem [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md).

### Circuit breaker — cần thiết cho BFF

```ts
// Service đang chết → đừng gọi nữa, trả fallback ngay
if (this.breaker.isOpen('stats')) {
  return { ...base, stats: null, degraded: [...degraded, 'stats'] };
}
```

Không có circuit breaker, một service chết làm **mọi** request tới BFF chờ hết timeout (1500ms) — và BFF cạn connection/thread. Đây là cách một service phụ làm sập BFF.

### Cache trong BFF

```ts
// Dữ liệu ít đổi → cache ở BFF, giảm fan-out
const perms = await this.cache.wrap(
  `perms:${user.orgId}`,
  60,                                          // TTL 60s
  () => this.permissions.get(user.orgId),
);
```

Nhưng chú ý đánh đổi: **cache ở BFF thô hơn cache ở service.** Một response gộp cache 60s nghĩa là mọi phần trong đó cũ tới 60s, kể cả phần lẽ ra luôn mới. Cache từng phần thường tốt hơn cache cả response.

### GraphQL như BFF

GraphQL giải quyết đúng bài toán "mỗi client cần dữ liệu khác nhau" mà không cần một BFF cho mỗi client. Nhưng nó đổi tập vấn đề:

```text
Được:  client tự chọn field; một endpoint cho mọi client
Mất:   cache HTTP (POST), N+1 mặc định (cần DataLoader),
       phải giới hạn depth/complexity, monitoring theo status code không hoạt động
```

Xem [RPC, GraphQL & alternatives](../00-http-api/08-rpc-graphql-alternatives.md).

### Khi nào **không** cần BFF

```text
✗ Monolith với một API — đã có toàn quyền shape response
✗ Chỉ một loại client
✗ 2–3 request nhanh, latency chưa phải nút thắt
✗ "Cho sạch" — không phải lý do kỹ thuật
✗ Chưa ĐO round-trip và payload thật
```

Chi phí thật của BFF:

```text
+ Một service nữa phải deploy, monitor, on-call
+ Một hop network nữa (thêm latency cho request đơn giản)
+ Một chỗ nữa phải xử lý auth, timeout, retry, circuit breaker
+ Logic gộp có thể tích tụ thành business logic (nó KHÔNG nên)
+ Deploy coupling: đổi màn hình → đổi BFF → deploy
```

Hàng cuối là rủi ro dài hạn lớn nhất: BFF dễ trở thành nơi chứa business logic, và khi đó bạn có hai nơi chứa quy tắc nghiệp vụ.

## Example

```text
Quyết định có cần BFF — đo trước, không đoán

Đo hiện tại (từ RUM, không từ localhost):
  số round-trip tuần tự:  3 tầng
  RTT p75 của người dùng: 180ms
  → 540ms chỉ riêng network
  payload tổng:           480KB
  payload UI thật dùng:   30KB
  → 94% over-fetching

Ngưỡng quyết định:
  ✓ round-trip × RTT > 300ms          → BFF giúp
  ✓ over-fetching > 5×                → BFF giúp
  ✓ client cần biết thứ tự gọi        → BFF giúp
  → CÓ, làm BFF

Thiết kế BFF:
  budget 2500ms (client timeout 3000ms)
  user 500ms critical / orders 800ms important
  stats 1500ms optional / notifs 300ms optional
  Promise.allSettled + fallback + degraded[]
  circuit breaker cho mỗi upstream
  cache 60s cho permissions (ít đổi)
  KHÔNG có business logic — chỉ gọi, ghép, shape
```

## Prediction

1. 6 request, 3 tầng phụ thuộc, RTT 180ms — thời gian network tối thiểu ở client? Qua BFF (RTT nội bộ 5ms)?
2. BFF dùng `Promise.all`, service `notifications` chết — client nhận gì?
3. Đổi sang `allSettled` với fallback — client nhận gì?
4. BFF timeout 5s, client timeout 3s, upstream chậm 4s — điều gì xảy ra?
5. Không có circuit breaker, một service chết hoàn toàn, 100 req/s tới BFF — trạng thái BFF?
6. Web và mobile dùng chung một BFF — nó tiến hoá thành gì?
7. Cache cả response 60s, trong đó có số dư tài khoản — vấn đề gì?
8. Business logic bị đặt vào BFF — hệ quả khi có client thứ hai?

<details>
<summary>Đáp án</summary>

1. Client: 3 × 180 = 540ms. BFF: 180 + 3 × 5 = ~195ms.
2. **Không nhận gì** — cả response fail vì một service optional.
3. Dashboard đầy đủ, `unreadCount: 0`, `degraded: ['notifications']`.
4. Client bỏ đi ở 3s; BFF vẫn giữ tài nguyên chờ tới 4s — công việc zombie.
5. Mọi request chờ hết timeout → cạn connection/thread → BFF chết theo.
6. Tích tụ tham số điều kiện, thành đúng cái API chung nó thay thế.
7. Số dư cũ tới 60s — cache gộp không phân biệt được độ tươi từng phần.
8. Hai nơi chứa quy tắc; client thứ hai hoặc phải dùng BFF của client thứ nhất, hoặc copy logic.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đo round-trip × RTT thật từ RUM | Con số thường lớn hơn dự đoán |
| So payload trả về với dữ liệu UI dùng | Over-fetching thường > 5× |
| `Promise.all` trong BFF, kill một upstream optional | Cả response fail |
| Đổi sang `allSettled` + fallback | Degrade cục bộ |
| BFF timeout > client timeout, upstream chậm | Zombie work; đo connection đang mở ở BFF |
| Kill một upstream hoàn toàn, gửi 100 req/s, không circuit breaker | BFF cạn tài nguyên |
| Thêm circuit breaker, làm lại | BFF vẫn phản hồi nhanh với fallback |
| Cache cả response 60s, sửa dữ liệu | Mọi phần cũ 60s |
| Dùng một BFF cho web + mobile, thêm 3 màn hình | Đếm số tham số điều kiện xuất hiện |
| Bỏ `degraded` khỏi response | Client không phân biệt "rỗng" và "lỗi" |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| BFF là API gộp cho tiện | Là service có budget, partial response, degradation riêng |
| Một BFF cho cả hệ thống | Một per **client type** |
| BFF = API Gateway | Gateway: routing/auth. BFF: gộp/shape, biết nghiệp vụ màn hình |
| BFF luôn nhanh hơn | Thêm một hop; chỉ thắng khi round-trip là nút thắt |
| `Promise.all` là cách fan-out đúng | Với upstream optional, phải `allSettled` |
| Không cần circuit breaker vì đã có timeout | Timeout không ngăn được việc gọi service đã chết |
| BFF có thể chứa business logic | Nó sẽ thành nơi thứ hai chứa quy tắc — tránh |
| Cache cả response là tối ưu tốt | Nó làm mất độ tươi của phần lẽ ra luôn mới |

## Debugging

1. **Đo trước khi làm BFF**: số round-trip tuần tự × RTT p75 thật, và tỉ lệ over-fetching. Không có hai số này thì quyết định là đoán.
2. **Đo latency của từng upstream trong BFF** riêng biệt — nếu không, bạn chỉ biết "BFF chậm" mà không biết vì ai.
3. **Log `degraded`** như một metric: tỉ lệ request bị degrade theo từng upstream là tín hiệu sớm của service đang xuống.
4. **Kiểm tra timeout giảm dần** từ client → BFF → upstream. Vi phạm thứ tự này gây zombie work.
5. **Correlation ID xuyên BFF → upstream** — không có nó, debug một request qua 4 service là không khả thi. Xem [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
6. **Đếm tham số điều kiện trong BFF** — tăng đều nghĩa là nó đang bị dùng cho nhiều loại client.
7. **Grep business logic trong BFF**: `if` chứa quy tắc nghiệp vụ là dấu hiệu logic đang rò rỉ vào đây.

## Production Considerations

- **Timeout budget tường minh**, giảm dần từ ngoài vào trong, và ghi vào code/config.
- **`Promise.allSettled` + fallback theo criticality**; `degraded` trong response.
- **Circuit breaker cho mỗi upstream** — timeout một mình không đủ.
- **Một BFF per client type**; đừng gộp web và mobile.
- **BFF không chứa business logic** — chỉ gọi, ghép, shape. Đây là quy tắc cần enforce trong review.
- **Cache từng phần, không cache cả response** — giữ được độ tươi khác nhau.
- **Observability**: correlation ID xuyên tầng, metric per-upstream (latency, error rate, degraded rate).
- **Auth ở gateway hoặc BFF, nhưng authz vẫn ở service** — BFF không được là nơi duy nhất kiểm tra quyền. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).
- **BFF thuộc team frontend** — họ biết màn hình cần gì và deploy cùng nhịp với UI.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Client gọi nhiều API | không thêm service, cache theo từng nguồn | nhiều round-trip, over-fetching, client biết nhiều |
| BFF | 1 round-trip, payload đúng, client đơn giản | thêm service, thêm hop, thêm chỗ xử lý reliability |
| Một BFF per client | shape tối ưu cho từng client | nhiều BFF phải bảo trì |
| BFF chung | ít service | tích tụ tham số điều kiện |
| GraphQL | client tự chọn field, một endpoint | mất cache HTTP, N+1, cần bảo vệ query |
| Cache ở BFF | giảm fan-out | độ tươi thô, invalidation phức tạp |
| `allSettled` + degrade | chịu lỗi từng phần | client phải xử lý dữ liệu một phần |

## Explain Without Notes

1. BFF khác API Gateway ở đâu?
2. Vì sao một BFF per client type, không phải một BFF chung?
3. Timeout budget là gì, và vì sao timeout phải giảm dần vào trong?
4. Bốn quyết định trong một fan-out đúng?
5. Vì sao timeout một mình không đủ, cần circuit breaker?
6. Ba ngưỡng đo được để quyết định có cần BFF?

## Related

- [Một màn hình nhiều API](../../01-web-frontend/04-application-engineering/01-multi-api-screen.md) — phía client
- [Service decomposition](08-service-decomposition.md) — orchestration service
- [REST API contract](../00-http-api/02-rest-api-contract.md) — `expand`/`fields` giải quyết một phần over-fetching
- [RPC, GraphQL & alternatives](../00-http-api/08-rpc-graphql-alternatives.md) — GraphQL như BFF
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md)
- [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md)
- [Monolith → microservices](../../06-system-design/08-monolith-to-microservices.md)
- [Access control](../../05-cross-cutting/security/04-access-control.md)
