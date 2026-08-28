---
level: intermediate
area: frontend
prerequisites:
  - 02-data-fetching-architecture.md
related:
  - ../../05-cross-cutting/performance/07-full-stack-triage.md
  - ../../03-database/04-message-queues/01-why-queue.md
---

# API chậm: tối ưu thật và tối ưu cảm nhận

> Một API mất 5 giây có hai bài toán độc lập: **làm nó nhanh hơn** và **làm 5 giây đó không tệ**. Chúng cần hai loại công việc khác nhau, và bạn thường phải làm cả hai.

## Position

```text
Actual latency    (backend, DB, network)     → giảm bằng kỹ thuật
Perceived latency (người dùng cảm nhận)      → giảm bằng UX
        ↓ hai bài toán, hai bộ công cụ
```

## Problem

```text
GET /api/dashboard → 5.200 ms
```

Hai phản ứng sai đối lập nhau:

| Phản ứng | Vấn đề |
|---|---|
| "Thêm spinner là xong" | Người dùng vẫn chờ 5 giây, chỉ có thứ để nhìn |
| "Phải tối ưu xuống 200ms rồi mới làm UI" | Có thể mất nhiều tuần; và một số việc **không thể** nhanh hơn |

Đúng là: **làm cả hai, và biết cái nào giải quyết được cái gì.**

Một điều quan trọng: `actual` và `perceived` không tỉ lệ với nhau. Một trang 800ms với skeleton đúng chỗ cảm giác nhanh hơn một trang 400ms nhảy layout ba lần.

## Mental Model

```text
Actual latency
  = thời gian thật, đo được bằng máy
  → profiling, index, cache, song song hoá, precompute, queue

Perceived latency
  = thời gian người dùng CẢM NHẬN
  → hiện gì đó ngay, hiện dần, hiện dữ liệu cũ, hiện trước khi xong
```

Bốn chiến lược cho perceived, theo mức độ hiệu quả:

```text
1. HIỆN NGAY DỮ LIỆU CŨ        (stale-while-revalidate)  → cảm giác 0ms
2. HIỆN DẦN                     (streaming, progressive)   → cảm giác = phần nhanh nhất
3. HIỆN TRƯỚC KHI XONG          (optimistic UI)            → cảm giác 0ms cho mutation
4. HIỆN KHUNG                   (skeleton)                 → cảm giác ngắn hơn thực tế
```

Chiến lược 1 mạnh nhất và bị bỏ qua nhiều nhất: nếu bạn đã có dữ liệu cũ, hiện nó ngay là cách duy nhất đạt cảm giác tức thì.

## Actual latency — tìm nút thắt trước

Đừng đoán. Đo theo thứ tự:

```text
1. Server-Timing header      → thời gian ở đâu TRONG backend
2. Số query DB               → N+1?
3. EXPLAIN ANALYZE           → index?
4. External API              → chờ ai?
5. Song song hoá             → cái gì đang tuần tự không cần thiết?
```

```ts
// Server-Timing — cho bạn breakdown ngay trong DevTools, không cần APM
const t0 = performance.now();
const user = await getUser(id);
const t1 = performance.now();
const stats = await computeStats(id);
const t2 = performance.now();

res.setHeader('Server-Timing',
  `db;dur=${(t1 - t0).toFixed(0)}, stats;dur=${(t2 - t1).toFixed(0)}`);
```

DevTools → Network → chọn request → tab **Timing** hiện các phần này. Đây là cách rẻ nhất để biết 5 giây đi đâu, và nó hoạt động ngay cả khi bạn chưa có tracing.

Năm nguyên nhân theo thứ tự phổ biến:

| Nguyên nhân | Cách xác nhận | Cách sửa |
|---|---|---|
| **N+1 query** | đếm query mỗi request | `include`/batch → [note](../../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) |
| **Thiếu index** | `EXPLAIN ANALYZE` | thêm index → [note](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) |
| **`await` tuần tự** | đọc code, xem Server-Timing | `Promise.all` |
| **External API chậm** | Server-Timing tách riêng | cache, timeout, queue |
| **Tính toán nặng** | CPU profile | precompute, queue, worker |

```ts
// Song song hoá — nút thắt phổ biến nhất và dễ sửa nhất
// ❌ 200 + 800 + 300 = 1300ms
const user = await getUser(id);
const stats = await getStats(id);
const orders = await getOrders(id);

// ✅ max(200, 800, 300) = 800ms
const [user, stats, orders] = await Promise.all([getUser(id), getStats(id), getOrders(id)]);
```

### Khi nào chuyển sang queue

Nếu công việc **không cần xong trong request**, nó không thuộc request:

```text
Báo cáo, export, gửi email, xử lý ảnh, đồng bộ bên thứ ba
  → 202 Accepted + jobId, client poll hoặc nhận webhook
  → request trả về trong vài ms
```

Đây không phải tối ưu — nó là **đổi bài toán**. 5 giây trở thành 20ms, và job chạy nền có thể mất 30 giây mà không ai chờ. Xem [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md).

### Precompute

```text
Query aggregate 5 giây, chạy 10.000 lần/ngày
  → precompute mỗi 5 phút vào một bảng/collection summary
  → đọc: 2ms
  → đánh đổi: dữ liệu cũ tối đa 5 phút
```

Với dashboard và báo cáo, dữ liệu cũ 5 phút gần như luôn chấp nhận được — và đó là câu hỏi nên hỏi trước khi tối ưu query.

## Perceived latency

### 1. Stale-while-revalidate — mạnh nhất

```tsx
// Có dữ liệu cũ → hiện NGAY, refresh nền
const { data, isFetching } = useQuery({
  queryKey: keys.dashboard,
  queryFn: api.getDashboard,
  staleTime: 60_000,
});

// isPending: chưa có dữ liệu NÀO (lần đầu) → skeleton
// isFetching: đang tải, CÓ THỂ đã có dữ liệu cũ → indicator nhỏ
if (isPending) return <DashboardSkeleton />;

return (
  <>
    {isFetching && <RefreshingBadge />}     {/* không xoá nội dung */}
    <Dashboard data={data} />
  </>
);
```

Phân biệt `isPending` và `isFetching` là chi tiết quyết định UX ở đây: dùng `isFetching` cho skeleton làm nội dung nhấp nháy mỗi lần refresh nền — và người dùng cảm nhận app *chậm hơn* dù dữ liệu về nhanh hơn.

### 2. Streaming / progressive rendering

```tsx
// Next.js: shell hiện ngay, phần chậm stream sau
export default async function Page() {
  const user = await getUser();            // 80ms — chặn shell

  return (
    <Layout user={user}>
      <Suspense fallback={<StatsSkeleton />}>
        <Stats />                          {/* 5s — stream, không chặn */}
      </Suspense>
    </Layout>
  );
}
```

TTFB xuống 80ms. Người dùng thấy layout, navigation dùng được, và stats hiện khi xong. Xem [Rendering strategies](../03-nextjs/behavior/04-rendering-strategies.md).

### 3. Optimistic UI — cho mutation

```tsx
const toggle = useMutation({
  mutationFn: api.toggleTask,
  onMutate: async (id) => {
    const prev = qc.getQueryData(keys.tasks.all);
    qc.setQueryData(keys.tasks.all, (old: Task[] = []) =>
      old.map(t => t.id === id ? { ...t, done: !t.done } : t));
    return { prev };
  },
  onError: (_e, _v, ctx) => {
    qc.setQueryData(keys.tasks.all, ctx?.prev);      // rollback
    toast.error('Không lưu được, đã hoàn tác');       // NÓI cho người dùng biết
  },
  onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks.all }),
});
```

Dùng optimistic khi: xác suất thành công cao, thao tác dễ hoàn tác (toggle, like, reorder).
**Không** dùng khi: thanh toán, xoá vĩnh viễn, hoặc thao tác mà thất bại khó giải thích.

Và bắt buộc: rollback **kèm thông báo**. Rollback im lặng làm người dùng nghĩ họ đã bấm sai.

### 4. Skeleton — làm đúng cách

```tsx
// ❌ Spinner: không cho thông tin gì, và gây layout shift khi nội dung về
{isPending && <Spinner />}

// ✅ Skeleton khớp hình dạng nội dung thật → không nhảy layout
{isPending && (
  <div className="space-y-3">
    <div className="h-8 w-48 rounded bg-gray-200" />
    <div className="h-24 rounded bg-gray-200" />
  </div>
)}
```

Skeleton hơn spinner ở hai điểm: nó báo *cái gì* đang tải, và nó **giữ chỗ** nên không có layout shift (CLS). Xem [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md).

### 5. Prefetch — loại bỏ chờ hoàn toàn

```tsx
<Link
  href={`/tasks/${id}`}
  onMouseEnter={() => qc.prefetchQuery({
    queryKey: keys.tasks.detail(id),
    queryFn: () => api.getTask(id),
  })}
/>
```

Người dùng hover 300ms trước khi click. Nếu request mất 200ms, điều hướng cảm giác **tức thì**.

### Ngưỡng thời gian và UI tương ứng

```text
< 100ms      cảm giác tức thì            → không cần loading state
100–300ms    nhận biết được nhưng mượt   → không cần spinner (nó gây nhấp nháy)
300ms–1s     cần feedback                → skeleton
1–5s         cần tiến độ                 → skeleton + progress nếu biết được
> 5s         cần đổi mô hình             → background job + thông báo
> 10s        không nên là request đồng bộ → queue, gửi email/notification khi xong
```

Hàng thứ hai đáng chú ý: **hiện spinner cho request 200ms làm UX tệ hơn** — nó nhấp nháy. Dùng `delay` trước khi hiện loading:

```tsx
// Chỉ hiện skeleton nếu chờ quá 200ms
const [showSkeleton, setShow] = useState(false);
useEffect(() => {
  if (!isPending) return setShow(false);
  const t = setTimeout(() => setShow(true), 200);
  return () => clearTimeout(t);
}, [isPending]);
```

## Example

```text
Dashboard 5,2 giây — xử lý theo hai hướng song song

ACTUAL (giảm 5,2s → 600ms)
  ├── Server-Timing: stats 4,1s / user 0,2s / orders 0,9s
  ├── stats: N+1 (1 + 200 query) → include → 4,1s → 0,3s
  ├── orders: thiếu index (project_id, created_at) → 0,9s → 0,05s
  ├── ba fetch tuần tự → Promise.all → tổng = max, không phải sum
  └── còn 600ms: chấp nhận được

PERCEIVED (600ms → cảm giác tức thì)
  ├── shell + user hiện ở 150ms (streaming)
  ├── skeleton khớp hình dạng, không layout shift
  ├── lần thứ hai: stale-while-revalidate → 0ms cảm nhận
  └── prefetch khi hover → điều hướng tức thì

Nếu stats KHÔNG thể nhanh hơn (ví dụ aggregate trên 100M dòng):
  └── precompute mỗi 5 phút → đọc 2ms, dữ liệu cũ ≤ 5 phút
```

## Prediction

1. API 5 giây, thêm spinner — actual latency đổi không? Perceived?
2. Ba fetch tuần tự 200/800/300ms → `Promise.all` — tổng?
3. `isFetching` dùng cho skeleton, refetch nền mỗi 30s — người dùng thấy gì?
4. Dùng `isPending` thay vào — thấy gì?
5. Request 180ms có spinner hiện ngay — cảm giác thế nào?
6. Optimistic update fail, rollback im lặng không toast — người dùng nghĩ gì?
7. Job 30 giây chạy đồng bộ trong request — điều gì xảy ra với timeout của proxy?
8. Prefetch on hover, người dùng hover 300ms, request 200ms — cảm giác chờ bao lâu?

<details>
<summary>Đáp án</summary>

1. Actual không đổi; perceived cải thiện chút — nhưng vẫn chờ 5 giây.
2. ~800ms.
3. Nội dung **nhấp nháy** về skeleton mỗi 30 giây — cảm giác app chậm/lỗi.
4. Nội dung giữ nguyên, chỉ badge nhỏ hiện.
5. Nhấp nháy — tệ hơn không có spinner.
6. Nghĩ mình bấm sai, hoặc app bị lỗi — họ sẽ bấm lại.
7. Vượt `proxy_read_timeout` (thường 60s) hoặc timeout của LB → 504 dù job vẫn chạy.
8. Gần như 0 — dữ liệu đã có khi họ click.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm `Server-Timing` cho một endpoint chậm | DevTools → Timing hiện breakdown; thường bất ngờ |
| Đếm query DB cho request đó | N+1 lộ ra |
| Đổi 3 `await` tuần tự thành `Promise.all` | Đo lại |
| Dùng `isFetching` cho skeleton, đặt `staleTime: 0` | Nội dung nhấp nháy liên tục |
| Đổi sang `isPending` | Mượt |
| Hiện spinner ngay cho request 150ms | Nhấp nháy khó chịu |
| Thêm delay 200ms trước khi hiện | Mượt hơn rõ rệt |
| Skeleton kích thước khác nội dung thật | Layout shift; xem Rendering → Layout Shift Regions |
| Optimistic update, chặn API, không rollback | UI nói dối vĩnh viễn |
| Job 30s đồng bộ qua nginx mặc định | 504 sau 60s (hoặc sớm hơn) |
| Bỏ `Suspense` cho phần chậm trong RSC | TTFB = thời gian phần chậm nhất |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Thêm spinner là giải quyết API chậm | Không đổi actual; và spinner sai chỗ làm tệ hơn |
| Phải tối ưu xong mới làm UX | Làm song song; một số việc không thể nhanh hơn |
| Perceived tỉ lệ với actual | 800ms mượt cảm giác nhanh hơn 400ms nhảy layout |
| Skeleton và spinner tương đương | Skeleton giữ chỗ (không CLS) và báo cái gì đang tải |
| Loading state nên hiện ngay | < 300ms thì hiện ngay gây nhấp nháy |
| Optimistic UI luôn tốt | Không có rollback + thông báo thì tệ hơn |
| Cache giải quyết mọi vấn đề chậm | Lần đầu vẫn chậm; và cache có thể sai |
| Job dài chỉ cần tăng timeout | Nó nên là background job |

## Debugging

1. **`Server-Timing` trước tiên.** Nó chia 5 giây thành các phần và bạn biết ngay nên đào ở đâu. Rẻ hơn dựng APM.
2. **Đếm số query DB cho một request** — con số này gây bất ngờ thường xuyên hơn thời gian từng query.
3. **`EXPLAIN ANALYZE`** cho query chậm nhất. Xem [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).
4. **DevTools → Performance** để phân biệt: chậm ở network (chờ) hay ở render (main thread)? Hai nguyên nhân hoàn toàn khác.
5. **Đo perceived bằng field data**: LCP và INP từ người dùng thật, không từ máy bạn.
6. **Kiểm tra ngưỡng**: nếu request < 300ms mà có spinner, bỏ spinner đi và đo lại cảm nhận.
7. Quy trình đầy đủ từ browser xuống DB: [Full-stack triage](../../05-cross-cutting/performance/07-full-stack-triage.md).

## Production Considerations

- **`Server-Timing` cho mọi endpoint chậm** ở môi trường dev/staging — nó là công cụ debug rẻ nhất.
- **Ngưỡng UI**: không loading state < 300ms; skeleton 300ms–5s; background job > 5–10s.
- **`isPending` cho skeleton, `isFetching` cho indicator nhỏ.** Đừng trộn.
- **Skeleton khớp kích thước nội dung** để không có CLS.
- **Optimistic update phải có rollback + thông báo.**
- **Timeout ở mọi tầng**, và timeout của client phải nhỏ hơn của proxy. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **Việc > 10 giây không thuộc request đồng bộ** — dù bạn tăng được timeout.
- **Đo trên thiết bị và mạng thật** của người dùng; RTT 150ms trên 4G đổi hoàn toàn tính toán so với localhost.
- Hỏi câu hỏi nghiệp vụ trước câu hỏi kỹ thuật: **"dữ liệu này cũ 5 phút có được không?"** Nếu được, precompute rẻ hơn mọi tối ưu query.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tối ưu actual (index, N+1) | nhanh thật, mọi client hưởng lợi | tốn thời gian điều tra |
| Precompute | đọc rất nhanh | dữ liệu cũ, thêm job |
| Background job | request nhanh, chịu tải tốt | eventual result, thêm hạ tầng |
| Stale-while-revalidate | cảm giác tức thì | người dùng thấy dữ liệu cũ |
| Streaming | TTFB tốt | cần thiết kế fallback |
| Optimistic UI | phản hồi tức thì | cần rollback; UI có thể nói dối |
| Skeleton | không CLS, báo được cái gì tải | phải bảo trì song song với UI |
| Prefetch | điều hướng tức thì | tải dữ liệu có thể không dùng |

## Explain Without Notes

1. Actual và perceived latency khác nhau thế nào? Vì sao chúng không tỉ lệ?
2. Bốn chiến lược perceived, theo mức hiệu quả?
3. `isPending` vs `isFetching` — dùng cái nào cho skeleton, và vì sao?
4. Ngưỡng thời gian và UI tương ứng cho mỗi mức?
5. Vì sao spinner cho request 180ms làm UX tệ hơn?
6. Khi nào một công việc không nên là request đồng bộ nữa?

## Related

- [Một màn hình nhiều API](01-multi-api-screen.md) — song song hoá và boundary
- [Data fetching architecture](02-data-fetching-architecture.md) — stale-while-revalidate, prefetch
- [Frontend resilience](04-frontend-resilience.md) — các trạng thái UI
- [Full-stack triage](../../05-cross-cutting/performance/07-full-stack-triage.md) — quy trình tìm nút thắt
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md) — LCP, INP, CLS
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — N+1, index
- [Prisma relations & N+1](../../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md)
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md) — đổi bài toán
- [Rendering strategies](../03-nextjs/behavior/04-rendering-strategies.md) — streaming
