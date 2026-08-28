---
level: intermediate
area: frontend
prerequisites:
  - ../02-react/behavior/04-server-state-cache.md
  - ../01-javascript-typescript/async-concurrency/02-promise-concurrency.md
related:
  - 02-data-fetching-architecture.md
  - ../../02-backend-api/04-architecture/09-bff-and-aggregation.md
---

# Một màn hình gọi nhiều API

> Dashboard cần 8 nguồn dữ liệu. Câu hỏi không phải "gọi thế nào" — mà là **cái nào phụ thuộc cái nào**, **cái nào được phép fail**, và **người dùng thấy gì trong lúc chờ**.

## Position

```text
Dashboard (8 nguồn dữ liệu)
      ↓ orchestration: parallel? sequential? ai fail được?
HTTP × N  hoặc  BFF × 1
      ↓
Backend services → DB
```

## Problem

```tsx
// Dashboard thật: 6 widget, mỗi widget một nguồn
function Dashboard() {
  const user     = useQuery({ queryKey: ['user'],     queryFn: api.getUser });
  const perms    = useQuery({ queryKey: ['perms'],    queryFn: api.getPermissions });
  const stats    = useQuery({ queryKey: ['stats'],    queryFn: api.getStats });
  const orders   = useQuery({ queryKey: ['orders'],   queryFn: api.getRecentOrders });
  const notifs   = useQuery({ queryKey: ['notifs'],   queryFn: api.getNotifications });
  const activity = useQuery({ queryKey: ['activity'], queryFn: api.getActivity });

  if (user.isPending || perms.isPending || stats.isPending ||
      orders.isPending || notifs.isPending || activity.isPending) {
    return <Spinner />;                     // ← chờ CÁI CHẬM NHẤT
  }
  if (user.isError || perms.isError || /* ... */) {
    return <ErrorPage />;                   // ← MỘT lỗi mất CẢ trang
  }
  // ...
}
```

Hai quyết định trong đoạn này sai, và cả hai đều là quyết định mặc định mà người ta không nhận ra mình đang ra:

1. **Loading gộp** — nếu `activity` mất 4 giây, người dùng chờ 4 giây cho *mọi thứ*, kể cả `user` đã có sau 80ms.
2. **Error gộp** — nếu widget `activity` lỗi, người dùng mất cả dashboard: không xem được đơn hàng, không thấy thông báo, không làm được gì.

Câu hỏi thật:

> **Một widget fail có nên làm cả trang fail?**

Gần như luôn là **không**. Nhưng code mặc định thì có.

## Mental Model

Ba việc phải làm, theo thứ tự:

```text
1. VẼ DEPENDENCY GRAPH     cái nào cần kết quả của cái nào?
2. PHÂN LOẠI CRITICALITY   cái nào thiếu thì trang vô nghĩa?
3. ĐẶT BOUNDARY            mỗi vùng độc lập có loading + error riêng
```

### Bước 1 — dependency graph

```text
user ─────────┬─→ permissions(user.orgId)  ← PHỤ THUỘC: phải chờ user
              └─→ stats(user.orgId)         ← PHỤ THUỘC

orders ───────── độc lập
notifications ── độc lập
activity ─────── độc lập
```

Từ graph này ra ngay chiến lược:

```text
Tầng 1 (song song):  user, orders, notifications, activity
Tầng 2 (sau user):   permissions, stats

Thời gian = max(tầng 1) + max(tầng 2)
          KHÔNG PHẢI tổng của 6
```

Sai lầm phổ biến là coi mọi request là phụ thuộc (viết `await` tuần tự) hoặc coi mọi request là độc lập (rồi phát hiện `permissions` cần `user.orgId`).

### Bước 2 — criticality

| Loại | Nghĩa | Thiếu thì |
|---|---|---|
| **Critical** | trang vô nghĩa nếu thiếu | hiện error page |
| **Important** | trang dùng được nhưng thiếu chức năng | hiện lỗi trong vùng đó |
| **Optional** | trang trisch hoạt động bình thường | ẩn widget, hoặc hiện placeholder |

Với dashboard trên:

```text
user, permissions  → CRITICAL   (không biết ai đang đăng nhập, không render được gì)
orders, stats      → IMPORTANT  (nội dung chính, nhưng thiếu vẫn dùng được phần khác)
notifications      → OPTIONAL   (ẩn được)
activity           → OPTIONAL
```

Phân loại này là quyết định **sản phẩm**, không phải kỹ thuật — và đó là lý do nó thường không ai ra. Kết quả là mặc định "tất cả critical".

### Bước 3 — boundary

```text
❌ Một loading + một error cho cả trang
✅ Mỗi vùng độc lập một boundary
```

## How It Works

### Song song có phụ thuộc — ở client

```tsx
function Dashboard() {
  // Tầng 1: song song, không phụ thuộc gì
  const user = useQuery({ queryKey: ['user'], queryFn: api.getUser });

  // Tầng 2: chờ user — `enabled` là cơ chế diễn đạt phụ thuộc
  const perms = useQuery({
    queryKey: ['perms', user.data?.orgId],
    queryFn: () => api.getPermissions(user.data!.orgId),
    enabled: !!user.data?.orgId,
  });

  // CRITICAL: chỉ hai cái này chặn trang
  if (user.isPending || perms.isPending) return <DashboardSkeleton />;
  if (user.isError) return <ErrorPage error={user.error} onRetry={user.refetch} />;

  // Còn lại: mỗi widget tự quản loading/error của nó
  return (
    <Layout user={user.data}>
      <OrdersWidget />          {/* important — tự hiện lỗi trong khung */}
      <StatsWidget orgId={user.data.orgId} />
      <NotificationsWidget />   {/* optional — tự ẩn nếu lỗi */}
      <ActivityWidget />
    </Layout>
  );
}

// Mỗi widget: một query, một boundary
function NotificationsWidget() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['notifs'], queryFn: api.getNotifications,
  });

  if (isPending) return <WidgetSkeleton />;
  if (isError)   return null;              // optional → ẩn, không phá layout
  return <List items={data} />;
}
```

Điểm quan trọng: **widget tự fetch dữ liệu của nó.** Nó không nhận qua props từ parent. Nhờ vậy nó có boundary riêng, và parent không cần biết widget cần gì.

Điều này trông giống N+1 nhưng không phải — TanStack Query dedupe theo `queryKey`, nên hai widget cùng key chỉ tạo một request.

### `Promise.allSettled` — khi phải gọi thủ công

```ts
// Trong Server Component hoặc BFF, không có TanStack Query
const [userR, ordersR, notifsR] = await Promise.allSettled([
  api.getUser(),
  api.getRecentOrders(),
  api.getNotifications(),
]);

// Critical: fail là fail
if (userR.status === 'rejected') throw userR.reason;

// Optional: fail thì degrade
return {
  user: userR.value,
  orders: ordersR.status === 'fulfilled' ? ordersR.value : [],
  notifications: notifsR.status === 'fulfilled' ? notifsR.value : null,
  degraded: [ordersR, notifsR].some(r => r.status === 'rejected'),
};
```

`Promise.all` **không** dùng được ở đây: một reject là mất tất cả. `allSettled` cho bạn quyền quyết định từng cái. Xem [Promise & concurrency](../01-javascript-typescript/async-concurrency/02-promise-concurrency.md).

Field `degraded` là chi tiết nhỏ có giá trị: UI có thể hiện "một số dữ liệu chưa tải được" thay vì âm thầm hiện danh sách rỗng — người dùng cần biết sự khác biệt giữa "không có đơn hàng" và "không tải được đơn hàng".

### Streaming — với Next.js App Router

Cách tốt nhất nếu bạn dùng RSC: mỗi vùng là một Server Component tự fetch, bọc trong `Suspense`.

```tsx
export default async function DashboardPage() {
  const user = await getUser();            // critical — chặn shell

  return (
    <Layout user={user}>
      {/* Mỗi vùng stream độc lập, xong trước hiện trước */}
      <ErrorBoundary fallback={<WidgetError />}>
        <Suspense fallback={<WidgetSkeleton />}><Orders orgId={user.orgId} /></Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={null}>
        <Suspense fallback={<WidgetSkeleton />}><Notifications /></Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

async function Orders({ orgId }: { orgId: string }) {
  const orders = await getOrders(orgId);   // fetch trong component
  return <OrdersList orders={orders} />;
}
```

Được: không JS cho widget chỉ hiển thị, không waterfall client→server, và mỗi vùng có boundary riêng. Xem [Rendering strategies](../03-nextjs/behavior/04-rendering-strategies.md).

### Huỷ request khi không cần nữa

```tsx
// TanStack Query cấp signal — dùng nó
useQuery({
  queryKey: ['orders', filter],
  queryFn: ({ signal }) => api.getOrders(filter, signal),
});
```

Khi người dùng đổi filter hoặc rời trang, request cũ bị abort. Không có nó, bạn giữ kết nối vô ích và có [race condition](../02-react/behavior/03-async-race-condition.md).

### Khi nào chuyển sang BFF

Ba tín hiệu, và chúng đo được:

```text
1. Số round-trip × latency là nút thắt
   8 request tuần tự × 200ms (mobile 4G) = 1,6s chỉ riêng network
   → BFF: 1 round-trip

2. Waterfall không tránh được ở client
   client cần A để biết phải gọi B → hai round-trip client↔server
   → BFF gọi A rồi B trong cùng datacenter (2 × 5ms)

3. Over-fetching lớn
   6 API trả 500KB, UI dùng 20KB
   → BFF trả đúng 20KB
```

Và ba lý do **không** dùng BFF:

```text
✗ "Sạch hơn"                     → không phải lý do kỹ thuật
✗ Chỉ để gộp 2 request nhanh      → chi phí vận hành > lợi ích
✗ Nhưng chưa đo latency thật      → đo trước
```

BFF thêm một service phải deploy, monitor, và có timeout budget riêng. Xem [BFF & aggregation](../../02-backend-api/04-architecture/09-bff-and-aggregation.md).

## Example

```text
Dashboard 6 nguồn — so sánh ba cách, trên mobile 4G (RTT ~150ms)

A. Tuần tự (mỗi await một dòng)
   150 × 6 + xử lý = ~1000ms, người dùng thấy spinner suốt

B. Song song ở client, loading gộp
   max(150 × 2 tầng) = ~300ms, nhưng vẫn chờ cái chậm nhất
   Một widget lỗi → cả trang lỗi

C. Song song + boundary theo vùng + streaming
   shell hiện ở ~150ms
   widget nhanh hiện ở ~200ms
   widget chậm hiện ở ~600ms, có skeleton trong lúc chờ
   Widget lỗi → chỉ vùng đó hiện lỗi
```

Khác biệt giữa B và C không phải tổng thời gian — nó là **thời điểm người dùng thấy nội dung đầu tiên** và **thiệt hại khi có lỗi**.

## Prediction

1. 6 request `await` tuần tự, mỗi cái 150ms — tổng thời gian?
2. Cùng 6 request với `Promise.all` — tổng?
3. Có 2 tầng phụ thuộc (4 độc lập, 2 phụ thuộc) — tổng tối thiểu?
4. `Promise.all` với 6 request, cái thứ 3 reject — nhận được mấy kết quả?
5. `Promise.allSettled` cùng tình huống — mấy?
6. Loading gộp, `activity` mất 4 giây, `user` mất 80ms — người dùng thấy `user` khi nào?
7. Hai widget cùng `queryKey: ['user']` — bao nhiêu HTTP request?
8. Widget optional lỗi, code `if (isError) return null` — layout có nhảy không?

<details>
<summary>Đáp án</summary>

1. ~900ms.
2. ~150ms.
3. ~300ms (2 × 150).
4. **Không kết quả nào** — `Promise.all` reject ngay; 5 request kia vẫn chạy nhưng bạn không nhận được.
5. Cả 6, mỗi cái có `status`.
6. Sau 4 giây — đó là vấn đề của loading gộp.
7. Một — TanStack Query dedupe theo key.
8. Có thể — nếu widget chiếm chỗ trong grid. Cân nhắc placeholder giữ kích thước.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| DevTools → Network → throttle "Slow 4G", tải dashboard | Waterfall lộ rõ; đếm số round-trip tuần tự |
| Đổi 6 `await` tuần tự thành `Promise.all` | Đo lại tổng thời gian |
| Chặn một API bằng DevTools (Block request URL), loading gộp | Cả trang lỗi |
| Thêm boundary theo vùng, làm lại | Chỉ vùng đó lỗi |
| Widget optional lỗi trả `null` | Xem layout có nhảy |
| Bỏ `enabled` cho query phụ thuộc | Query chạy với `undefined` → lỗi hoặc kết quả sai |
| Bỏ `signal`, đổi filter 10 lần nhanh | Request cũ vẫn chạy; có thể race |
| Đo tổng payload 6 API vs dữ liệu UI thật dùng | Over-fetching thường lớn hơn dự đoán |
| So B và C (streaming) bằng Performance panel | Thời điểm nội dung đầu tiên khác rõ rệt |

Thí nghiệm 3 và 4 cạnh nhau là thí nghiệm quan trọng nhất — nó cho thấy giá trị thật của boundary.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Nhiều API = phải có BFF | Chỉ khi round-trip/latency là nút thắt đo được |
| `Promise.all` là cách gọi song song đúng | Với dữ liệu optional, dùng `allSettled` |
| Một loading cho cả trang là đơn giản hơn | Nó làm người dùng chờ cái chậm nhất |
| Widget lỗi thì nên hiện error page | Gần như luôn nên degrade cục bộ |
| Widget tự fetch gây N+1 | Thư viện dedupe theo key |
| Mọi request nên song song | Phụ thuộc thật phải tuần tự; vẽ graph trước |
| Ẩn widget lỗi là đủ | Người dùng cần biết "lỗi" khác "rỗng" |
| Gộp API luôn nhanh hơn | Gộp làm cache granularity tệ hơn, và một phần chậm chặn cả gộp |

## Debugging

1. **DevTools → Network với throttling.** Waterfall dạng bậc thang = request tuần tự không cần thiết. Đây là bước đầu tiên và cho nhiều thông tin nhất.
2. **Đếm số round-trip tuần tự** (không phải tổng số request). Đó là con số quyết định latency trên mạng chậm.
3. **Chặn từng API** (DevTools → Block request URL) và xem trang còn dùng được không. Đây là cách kiểm tra criticality đã phân loại đúng chưa.
4. **React Query DevTools** hiện mọi query, trạng thái, và dedupe — nó trả lời "vì sao request này chạy".
5. **So payload trả về với dữ liệu UI dùng** — over-fetching là lý do phổ biến để cân nhắc BFF hoặc field selection.
6. **Performance panel** để đo thời điểm nội dung đầu tiên, không chỉ thời điểm hoàn thành.

## Production Considerations

- **Phân loại criticality tường minh** cho mỗi nguồn dữ liệu, và ghi vào code (comment hoặc type). Không có nó, mặc định là "tất cả critical".
- **Boundary theo vùng chức năng**, không phải một boundary cho cả trang.
- **Phân biệt "rỗng" và "lỗi"** trong UI — người dùng cần biết dữ liệu chưa tải được.
- **`signal` cho mọi request** để huỷ được.
- **Đo trên mạng thật của người dùng** (RUM), không trên localhost. Số round-trip nhân với RTT thật mới là con số có ý nghĩa.
- **Prefetch** cho điều hướng dự đoán được (hover vào link, bước tiếp theo của wizard).
- **Timeout cho mỗi request**, và fallback cho nguồn optional. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- Nếu chuyển sang BFF: nó cần timeout budget, partial response, và [graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — không chỉ là gộp request.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Song song ở client | đơn giản, cache theo từng nguồn | nhiều round-trip trên mạng chậm |
| BFF gộp | 1 round-trip, payload đúng | thêm service, cache thô hơn |
| Loading gộp | code đơn giản | chờ cái chậm nhất |
| Boundary theo vùng | thấy nội dung sớm, degrade cục bộ | nhiều skeleton, có thể nhấp nháy |
| Streaming (RSC) | TTFB tốt, ít JS | ràng buộc framework |
| Widget tự fetch | boundary rõ, độc lập | cần thư viện dedupe |
| Prefetch | điều hướng tức thì | tải dữ liệu có thể không dùng |

## Explain Without Notes

1. Ba bước để tổ chức một màn hình nhiều API?
2. Vì sao `Promise.all` sai cho dữ liệu optional?
3. Ba mức criticality và cách xử lý mỗi mức?
4. Vì sao loading gộp là quyết định tệ, dù code đơn giản hơn?
5. Ba tín hiệu đo được để chuyển sang BFF, và ba lý do không nên?
6. Vì sao widget tự fetch không gây N+1?

## Related

- [Data fetching architecture](02-data-fetching-architecture.md) — cache layering, chọn công cụ
- [Slow API UX](03-slow-api-ux.md) — khi một nguồn thật sự chậm
- [Frontend resilience](04-frontend-resilience.md) — các trạng thái UI
- [BFF & aggregation](../../02-backend-api/04-architecture/09-bff-and-aggregation.md) — phía backend
- [Server state & cache](../02-react/behavior/04-server-state-cache.md) — dedupe, queryKey
- [Async race condition](../02-react/behavior/03-async-race-condition.md) — huỷ request
- [Promise & concurrency](../01-javascript-typescript/async-concurrency/02-promise-concurrency.md) — `allSettled`
- [Error boundaries & Suspense](../02-react/behavior/09-error-boundaries-suspense.md) — cơ chế boundary
- [Rendering strategies](../03-nextjs/behavior/04-rendering-strategies.md) — streaming
