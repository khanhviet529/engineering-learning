---
level: intermediate
area: frontend
prerequisites:
  - 03-slow-api-ux.md
related:
  - ../02-react/behavior/09-error-boundaries-suspense.md
  - ../../05-cross-cutting/reliability/03-graceful-degradation.md
---

# Frontend resilience

> Phần lớn UI được thiết kế cho hai trạng thái: loading và success. Người dùng thật gặp tám. Sáu trạng thái còn lại là nơi họ mất niềm tin vào sản phẩm.

## Position

```text
Network / API (không đáng tin) → UI states → người dùng
                                    ↑ note này
```

## Problem

```tsx
// UI mà 90% code frontend trông như thế này
function TaskList() {
  const { data, isPending } = useQuery({ queryKey: ['tasks'], queryFn: api.getTasks });

  if (isPending) return <Spinner />;
  return <ul>{data.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

Hai trạng thái được xử lý. Những gì xảy ra trong thực tế:

| Tình huống | Code trên làm gì |
|---|---|
| API trả `[]` | hiện danh sách trống, không giải thích gì |
| API lỗi 500 | `data` là `undefined` → **crash** ở `data.map` |
| Mất mạng | crash hoặc treo ở spinner mãi |
| Đang refresh nền | nhấp nháy về spinner |
| Chỉ một phần dữ liệu về được | không có khái niệm này |
| Đang retry | người dùng không biết, bấm lại |
| Request treo 30 giây | spinner vô hạn |

Trường hợp thứ hai là bug thật: thiếu xử lý error làm component crash và [error boundary](../02-react/behavior/09-error-boundaries-suspense.md) hiện fallback — người dùng mất cả vùng UI vì một API lỗi.

## Mental Model

Tám trạng thái, và mỗi cái cần một quyết định UI:

```text
1. loading    lần đầu, chưa có dữ liệu     → skeleton
2. empty      thành công nhưng không có gì  → empty state + hành động
3. success    có dữ liệu                    → nội dung
4. stale      có dữ liệu nhưng đã cũ        → nội dung + badge nhỏ
5. partial    một phần về được              → nội dung + cảnh báo phần thiếu
6. error      thất bại                      → thông báo + nút thử lại
7. offline    không có mạng                 → banner + dữ liệu cache nếu có
8. retrying   đang thử lại                  → indicator, KHÔNG xoá nội dung
```

Hai phân biệt quan trọng nhất, và cả hai đều hay bị gộp:

```text
empty ≠ error
  "Bạn chưa có task nào" (kèm nút Tạo task)
  ≠ "Không tải được danh sách" (kèm nút Thử lại)
  → Gộp chúng làm người dùng không biết nên tạo mới hay thử lại

stale ≠ loading
  Có dữ liệu cũ → HIỆN nó, thêm badge
  Chưa có gì   → skeleton
  → Gộp chúng làm nội dung nhấp nháy mỗi lần refresh nền
```

Cả hai lỗi này xuất phát từ việc UI chỉ mô hình hoá `isLoading` và `data` mà không mô hình hoá **vì sao không có dữ liệu**.

## How It Works

### Mô hình hoá bằng discriminated union

Cách chắc chắn nhất để không quên trạng thái: làm cho trạng thái sai **không biểu diễn được**.

```ts
type ViewState<T> =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'success'; data: T; isStale: boolean; isRefetching: boolean }
  | { kind: 'partial'; data: T; missing: string[] }
  | { kind: 'error'; error: Error; canRetry: boolean }
  | { kind: 'offline'; cached?: T };

function toViewState<T>(q: UseQueryResult<T[]>, online: boolean): ViewState<T[]> {
  if (!online) return { kind: 'offline', cached: q.data };
  if (q.isPending) return { kind: 'loading' };
  if (q.isError) return { kind: 'error', error: q.error as Error, canRetry: true };
  if (!q.data?.length) return { kind: 'empty' };
  return { kind: 'success', data: q.data, isStale: q.isStale, isRefetching: q.isFetching };
}
```

Rồi `switch` với exhaustiveness check — thêm trạng thái mới sẽ là lỗi compile ở mọi chỗ chưa xử lý:

```tsx
function TaskList() {
  const online = useOnlineStatus();
  const q = useQuery({ queryKey: keys.tasks.all, queryFn: api.getTasks });
  const s = toViewState(q, online);

  switch (s.kind) {
    case 'loading':
      return <TaskSkeleton />;

    case 'empty':
      return <EmptyState
        title="Chưa có task nào"
        action={<Button onClick={openCreate}>Tạo task đầu tiên</Button>} />;

    case 'error':
      return <ErrorState
        message="Không tải được danh sách task"
        detail={`Mã: ${(s.error as ApiError).requestId ?? '—'}`}
        onRetry={() => q.refetch()} />;

    case 'offline':
      return (
        <>
          <OfflineBanner />
          {s.cached
            ? <><StaleBadge label="Dữ liệu đã lưu" /><List items={s.cached} /></>
            : <EmptyState title="Cần kết nối mạng để tải dữ liệu" />}
        </>
      );

    case 'partial':
      return <><PartialWarning missing={s.missing} /><List items={s.data} /></>;

    case 'success':
      return (
        <>
          {s.isRefetching && <RefreshingBadge />}
          <List items={s.data} />
        </>
      );

    default: {
      const _exhaustive: never = s;      // thêm trạng thái mới → lỗi compile
      throw new Error('unhandled state');
    }
  }
}
```

Xem [TypeScript type system](../01-javascript-typescript/typescript/02-type-system.md) về discriminated union và exhaustiveness check.

### Empty state — có ba loại

Gộp cả ba làm người dùng bối rối:

```tsx
// 1. Chưa có gì bao giờ → hướng dẫn tạo
<EmptyState title="Chưa có task nào" action={<CreateButton />} />

// 2. Có dữ liệu nhưng filter không khớp → hướng dẫn bỏ filter
<EmptyState title="Không có task nào khớp bộ lọc"
            action={<Button onClick={clearFilters}>Xoá bộ lọc</Button>} />

// 3. Tìm kiếm không kết quả → hướng dẫn đổi từ khoá
<EmptyState title={`Không tìm thấy "${query}"`} hint="Thử từ khoá khác" />
```

Phân biệt loại 1 và 2 quan trọng: người dùng đang lọc `status=archived` và thấy "Chưa có task nào" sẽ nghĩ dữ liệu của họ bị mất.

### Offline

```tsx
function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
```

`navigator.onLine` chỉ biết có **interface mạng**, không biết có tới được server hay không. WiFi kết nối nhưng không có internet vẫn báo `true`. Nó là tín hiệu bổ trợ, không phải nguồn sự thật — lỗi request vẫn là tín hiệu chính.

Khi offline: **vô hiệu hoá hành động ghi** thay vì để chúng thất bại:

```tsx
<Button disabled={!online} title={!online ? 'Cần kết nối mạng' : undefined}>
  Lưu
</Button>
```

### Retry — cho người dùng thấy

```tsx
const q = useQuery({
  queryKey: keys.tasks.all,
  queryFn: api.getTasks,
  retry: (count, err) => {
    if (err instanceof ApiError && err.status < 500) return false;   // 4xx: vô ích
    return count < 3;
  },
  retryDelay: (i) => Math.min(1000 * 2 ** i, 8000),                   // backoff
});

// failureCount > 0 nghĩa là đang retry — nói cho người dùng biết
{q.failureCount > 0 && q.isFetching && (
  <RetryingBadge>Đang thử lại (lần {q.failureCount})…</RetryingBadge>
)}
```

Retry im lặng làm người dùng thấy spinner 10 giây không giải thích — và họ sẽ reload trang, tạo thêm tải.

### Timeout — bắt buộc

```ts
// Không có timeout: spinner vô hạn nếu server treo
queryFn: ({ signal }) => {
  const timeout = AbortSignal.timeout(10_000);
  const combined = AbortSignal.any([signal, timeout]);   // huỷ khi unmount HOẶC timeout
  return api.getTasks(combined);
}
```

`AbortSignal.any` kết hợp signal của React Query (huỷ khi component unmount / key đổi) với timeout. Không có timeout, một request treo giữ spinner mãi và người dùng không biết phải làm gì.

### Partial failure

```tsx
// Widget optional lỗi → phần còn lại vẫn dùng được
function Dashboard({ data }: { data: DashboardData }) {
  return (
    <>
      {data.degraded.length > 0 && (
        <Alert variant="warning">
          Một số dữ liệu chưa tải được: {data.degraded.join(', ')}
          <Button onClick={refetch}>Thử lại</Button>
        </Alert>
      )}
      <MainContent data={data.core} />
      {data.stats ? <Stats data={data.stats} /> : <StatsUnavailable />}
    </>
  );
}
```

Điểm quan trọng: `StatsUnavailable` chứ không phải `null`. Ẩn hẳn widget làm người dùng không biết nó tồn tại; hiện placeholder nói rõ "phần này tạm không có" thì họ biết quay lại sau.

### Error boundary — lưới an toàn cuối

```tsx
// Boundary theo vùng, có reset khi điều hướng
<ErrorBoundary
  fallbackRender={({ error, resetErrorBoundary }) => (
    <WidgetError error={error} onRetry={resetErrorBoundary} />
  )}
  resetKeys={[pathname]}                  // tự reset khi đổi route
>
  <Suspense fallback={<WidgetSkeleton />}>
    <Widget />
  </Suspense>
</ErrorBoundary>
```

`resetKeys` giải quyết vấn đề người dùng bị kẹt ở fallback: không có nó, một lỗi làm vùng đó chết cho tới khi F5.

Nhớ: error boundary **không** bắt lỗi trong event handler. Lỗi mutation phải xử lý bằng `onError`. Xem [Error boundaries & Suspense](../02-react/behavior/09-error-boundaries-suspense.md).

## Example

```text
Checklist cho mỗi vùng dữ liệu — dùng khi review PR

□ loading    có skeleton khớp hình dạng (không spinner nếu < 300ms)
□ empty      phân biệt "chưa có" / "filter không khớp" / "tìm không thấy"
             và mỗi loại có HÀNH ĐỘNG tương ứng
□ error      thông báo bằng tiếng người + nút thử lại + requestId
□ stale      hiện nội dung, badge nhỏ — KHÔNG nhấp nháy về skeleton
□ partial    hiện phần có được + nói rõ phần thiếu
□ offline    banner + dữ liệu cache + vô hiệu hoá hành động ghi
□ retrying   cho người dùng thấy đang thử lại
□ timeout    mọi request có trần thời gian
□ boundary   vùng này lỗi không làm mất vùng khác, và reset được
```

## Prediction

1. `data.map()` khi query lỗi và `data` là `undefined` — điều gì xảy ra?
2. Không có error boundary quanh component đó — người dùng thấy gì?
3. Dùng `isFetching` cho skeleton, `staleTime: 0`, refetch on focus — người dùng chuyển tab đi rồi về thấy gì?
4. `retry: 3` với lỗi 400 — bao nhiêu request vô ích?
5. Không có timeout, server treo — spinner bao lâu?
6. Empty state nói "Chưa có task nào" khi người dùng đang lọc `status=archived` — họ nghĩ gì?
7. `navigator.onLine === true` nhưng WiFi không có internet — request thế nào?
8. Error boundary không có `resetKeys`, người dùng điều hướng sang trang khác rồi về — còn thấy fallback?

<details>
<summary>Đáp án</summary>

1. `TypeError: Cannot read properties of undefined` → component crash.
2. Error boundary gần nhất hiện fallback; nếu không có boundary nào thì **trang trắng**.
3. Nội dung nhấp nháy về skeleton mỗi lần focus.
4. 3 request vô ích — 4xx không bao giờ thành công khi retry.
5. Vô hạn.
6. Nghĩ dữ liệu bị mất — họ sẽ báo bug hoặc mất niềm tin.
7. Request thất bại; `onLine` không phát hiện được. Lỗi request là tín hiệu chính.
8. Có thể — tuỳ boundary có bị unmount không. `resetKeys` làm điều này xác định.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| DevTools → Network → Offline, dùng app | Đếm số chỗ crash hoặc treo |
| Block một API URL, xem UI | Crash, trang trắng, hay degrade? |
| Trả `[]` từ API | Empty state có giải thích gì không |
| Lọc ra tập rỗng | Empty state có phân biệt với "chưa có gì" không |
| Trả 500, xem `data.map` | Crash |
| Thêm xử lý `isError`, làm lại | Hiện lỗi có nút thử lại |
| `isFetching` cho skeleton + refetch on focus | Nhấp nháy |
| Throttle "Slow 3G" và chờ | Có biết đang retry không |
| Server treo (thêm `sleep(60)` ở API) | Spinner vô hạn nếu không timeout |
| Gây lỗi rồi điều hướng qua lại | Có kẹt ở fallback không |
| Offline rồi bấm nút Lưu | Có bị vô hiệu hoá, hay thất bại im lặng |

Thí nghiệm 1 và 2 nên là một bước cố định trong quy trình review — chúng phát hiện phần lớn thiếu sót.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Loading và success là đủ | Người dùng gặp 8 trạng thái |
| Empty và error tương tự | Cần hành động khác nhau hoàn toàn |
| Stale nên hiện loading | Hiện dữ liệu cũ + badge tốt hơn nhiều |
| `navigator.onLine` đáng tin | Chỉ biết có interface, không biết tới được server |
| Retry nên im lặng | Người dùng cần biết, nếu không họ reload |
| Ẩn widget lỗi là đủ | Placeholder nói rõ tốt hơn |
| Error boundary bắt mọi lỗi | Không bắt lỗi event handler |
| Timeout là tối ưu | Là bắt buộc — không có nó là spinner vô hạn |

## Debugging

1. **Bật Offline trong DevTools và dùng app 2 phút.** Đây là bài test rẻ nhất và tìm ra nhiều lỗi nhất.
2. **Block từng API URL** (DevTools → Network → Block request URL) và ghi lại UI làm gì. So với checklist.
3. **Ép từng trạng thái** bằng cách hardcode tạm (`const s = { kind: 'partial', ... }`) để xem UI có tồn tại cho trạng thái đó không.
4. **Tìm chỗ crash**: `grep -rn "data\.\(map\|length\|filter\)" src/` và kiểm tra có xử lý `undefined` chưa.
5. **React Query DevTools** hiện `failureCount`, `isStale`, `isFetching` — đối chiếu với những gì UI đang hiện.
6. **Kiểm tra người dùng có bị kẹt** ở fallback: gây lỗi rồi thử mọi cách thoát (điều hướng, retry, reload).

## Production Considerations

- **Checklist 9 mục ở phần Example là một phần của Definition of Done** cho mỗi vùng dữ liệu, không phải việc làm sau.
- **Discriminated union cho view state** — nó làm việc quên trạng thái thành lỗi compile.
- **Timeout cho mọi request.**
- **`requestId` trong thông báo lỗi** để người dùng báo lại và bạn tìm được log. Xem [Error model](../../02-backend-api/00-http-api/05-error-model.md).
- **Không retry 4xx**; retry 5xx với backoff và **cho người dùng thấy**.
- **Vô hiệu hoá hành động ghi khi offline** thay vì để chúng thất bại.
- **Error boundary theo vùng, có `resetKeys`** theo route.
- **Gửi lỗi frontend về monitoring** (Sentry) với source map — nếu không, bạn không biết người dùng đang gặp lỗi.
- **Xoá cache khi logout** (`queryClient.clear()`) — dữ liệu người trước không nên hiện cho người sau.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| 8 trạng thái đầy đủ | UX tốt, ít mất niềm tin | nhiều code UI, nhiều component |
| Chỉ loading + success | ít code | crash, trang trắng, người dùng bối rối |
| Discriminated union | không quên trạng thái | verbose hơn boolean flags |
| Hiện dữ liệu cũ khi offline | app dùng được | người dùng có thể tưởng là mới |
| Retry tự động | tự hồi phục | tốn request; phải cho người dùng thấy |
| Vô hiệu hoá khi offline | không thất bại vô ích | app cảm giác hạn chế |
| Boundary nhỏ nhiều vùng | degrade tốt | nhiều fallback phải thiết kế |

## Explain Without Notes

1. Kể 8 trạng thái UI và quyết định hiển thị cho mỗi cái.
2. Hai phân biệt quan trọng nhất, và hậu quả khi gộp chúng?
3. Ba loại empty state và hành động tương ứng?
4. Vì sao `navigator.onLine` không đủ?
5. Vì sao retry phải cho người dùng thấy?
6. Discriminated union giúp gì mà boolean flags không giúp được?

## Related

- [Slow API UX](03-slow-api-ux.md) — skeleton, stale-while-revalidate
- [Một màn hình nhiều API](01-multi-api-screen.md) — partial failure
- [Data fetching architecture](02-data-fetching-architecture.md) — trạng thái từ TanStack Query
- [Error boundaries & Suspense](../02-react/behavior/09-error-boundaries-suspense.md) — cơ chế boundary
- [Error handling & immutability](../01-javascript-typescript/fundamentals/03-error-handling-immutability.md) — phân loại lỗi
- [TypeScript type system](../01-javascript-typescript/typescript/02-type-system.md) — discriminated union
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — cùng nguyên lý ở tầng hệ thống
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Error model](../../02-backend-api/00-http-api/05-error-model.md) — `code`, `requestId`
