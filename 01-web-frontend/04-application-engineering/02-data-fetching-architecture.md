---
level: intermediate
area: frontend
prerequisites:
  - 01-multi-api-screen.md
  - ../02-react/behavior/04-server-state-cache.md
related:
  - ../03-nextjs/behavior/03-data-fetching-cache.md
  - ../../03-database/02-redis/03-cache-patterns.md
---

# Data fetching architecture

> Năm loại state, và mỗi loại cần một công cụ khác. Phần lớn "state management phức tạp" là hệ quả của việc dùng một công cụ cho cả năm.

## Position

```text
Browser HTTP cache → Next.js cache → TanStack Query cache → API → Redis → PostgreSQL
        └────────────── note này: các lớp này KHÔNG thay thế nhau ──────────────┘
```

## Problem

Hai câu hỏi mà mọi dự án frontend đều phải trả lời, và trả lời sai thì đau lâu:

**1. State này thuộc loại nào?**

```ts
const [isModalOpen, setModalOpen] = useState(false);        // ?
const [tasks, setTasks] = useState<Task[]>([]);            // ?
const [filter, setFilter] = useState('open');               // ?
const [user, setUser] = useState<User | null>(null);        // ?
const [total, setTotal] = useState(0);                      // ?
```

Năm dòng, năm loại state khác nhau, cùng một công cụ. Kết quả: `tasks` bị lệch với server, `filter` mất khi refresh (không share được URL), `user` bị fetch lại ở mỗi component, và `total` lệch với `tasks`.

**2. Dữ liệu cũ đến từ lớp cache nào?**

Bạn sửa database, reload trang, vẫn thấy dữ liệu cũ. Có **năm** lớp có thể đang giữ nó, và mỗi lớp vô hiệu theo cách khác nhau.

## Mental Model

### Năm loại state

```text
1. LOCAL UI STATE      modal mở, tab đang chọn, accordion
   → useState. Không share, không bền, không cần đồng bộ.

2. URL STATE           filter, sort, page, search query, tab (nếu cần share)
   → searchParams. Share được, back/forward hoạt động, refresh giữ nguyên.

3. SERVER STATE        dữ liệu từ API — tasks, user, orders
   → TanStack Query / RSC. Có owner khác, có thể cũ, cần đồng bộ.

4. GLOBAL CLIENT STATE theme, sidebar, giỏ hàng chưa gửi, draft
   → Context (ít đổi) hoặc Zustand (đổi thường xuyên)

5. DERIVED STATE       total = items.length, filtered = items.filter(...)
   → TÍNH TRỰC TIẾP. Không phải state.
```

Bảng quyết định:

| Câu hỏi | Kết luận |
|---|---|
| Tính được từ state khác? | **derived** — tính trong render, không lưu |
| Server sở hữu nó? | **server state** — TanStack Query hoặc RSC |
| Người dùng cần share/bookmark/back được? | **URL state** — searchParams |
| Chỉ một component dùng? | **local** — useState |
| Nhiều nơi dùng, client sở hữu? | **global client** — Context/store |

Hai lỗi phổ biến nhất:

```ts
// ❌ Server state trong useState → tự viết lại cache, invalidation, dedupe
const [tasks, setTasks] = useState<Task[]>([]);
useEffect(() => { api.getTasks().then(setTasks); }, []);

// ❌ Derived state trong state → hai nguồn sự thật, chắc chắn lệch
const [tasks, setTasks] = useState<Task[]>([]);
const [total, setTotal] = useState(0);        // phải nhớ cập nhật cùng lúc
```

Xem [Props & state design](../02-react/behavior/06-props-composition-state-design.md).

### URL state — loại bị bỏ qua nhiều nhất

```tsx
// ❌ Filter trong useState: refresh mất, không share được link, back không hoạt động
const [status, setStatus] = useState('open');

// ✅ Filter trong URL
'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

function TaskFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get('status') ?? 'open';

  const setStatus = (v: string) => {
    const next = new URLSearchParams(params);
    v === 'open' ? next.delete('status') : next.set('status', v);   // giữ URL sạch
    router.replace(`${pathname}?${next}`, { scroll: false });        // replace, không push
  };
  // ...
}
```

Quy tắc: **nếu người dùng có thể muốn gửi link này cho đồng nghiệp, nó thuộc URL.** Filter, sort, page, search — gần như luôn thuộc URL. Và khi nó ở URL, nó tự động trở thành `queryKey` cho server state.

`replace` thay vì `push` cho filter: nếu dùng `push`, mỗi lần đổi filter thêm một entry vào history và nút Back trở nên vô dụng.

## Cache layering

Đây là phần quan trọng nhất của note. Năm lớp cache, **không** thay thế nhau:

```text
┌──────────────────────────────────────────────────────────────┐
│ 1. Browser HTTP cache                                        │
│    Phạm vi: một người dùng, một browser                      │
│    Điều khiển: Cache-Control, ETag                           │
│    Vô hiệu: hết TTL, hoặc URL đổi (hash)                     │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ 2. Next.js cache (Router / Full Route / Data)                │
│    Phạm vi: Router = một user; Data = MỌI user, per-instance  │
│    Điều khiển: fetch options, revalidate, tags                │
│    Vô hiệu: revalidateTag/Path, router.refresh()             │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ 3. TanStack Query cache (in-memory, client)                   │
│    Phạm vi: một tab, mất khi reload                          │
│    Điều khiển: staleTime, gcTime, queryKey                   │
│    Vô hiệu: invalidateQueries                                │
└──────────────────────────────────────────────────────────────┘
        ↓ API
┌──────────────────────────────────────────────────────────────┐
│ 4. Redis                                                      │
│    Phạm vi: MỌI user, MỌI instance — dùng chung               │
│    Điều khiển: TTL, key design                               │
│    Vô hiệu: DEL khi ghi                                       │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ 5. PostgreSQL (shared buffer)                                 │
│    Không phải cache ứng dụng — DB tự quản                     │
└──────────────────────────────────────────────────────────────┘
```

Ba khác biệt quyết định:

| | TanStack Query | Redis |
|---|---|---|
| Ở đâu | RAM của **browser** | server dùng chung |
| Phạm vi | một tab, một user | mọi user, mọi instance |
| Mất khi | reload trang | Redis restart (hoặc TTL) |
| Giải quyết | round-trip mạng, UX | tải database |
| Ai vô hiệu được | chỉ tab đó | mọi instance thấy ngay |

Câu chốt: **TanStack Query không thay thế Redis, và Redis không thay thế TanStack Query.** Chúng giải quyết hai vấn đề khác nhau:

```text
TanStack Query giảm: số HTTP request từ browser
Redis giảm:          số query tới database
```

Một app có thể cần cả hai, hoặc không cần cái nào — tuỳ nút thắt ở đâu.

### Xác định lớp nào đang giữ dữ liệu cũ

Đi từ ngoài vào trong. Đây là quy trình nên thuộc lòng:

```text
1. Hard reload (Ctrl+Shift+R) → hết cũ?
   → Browser cache hoặc Router Cache

2. curl trực tiếp API → thấy dữ liệu mới?
   → cache ở CLIENT (TanStack Query hoặc Next.js Router)

3. curl thấy cũ, restart server → hết cũ?
   → Next.js Data Cache / Full Route Cache (in-memory, per-instance)

4. Vẫn cũ sau restart?
   → Redis, hoặc CDN

5. Query DB trực tiếp → đúng?
   → vấn đề ở tầng cache. Nếu sai → vấn đề ở ghi, không phải cache
```

Không có quy trình này, "sửa cache" thành thử ngẫu nhiên: xoá Redis, restart, hard reload, và không biết cái nào có tác dụng.

## How It Works

### Fetch ở đâu — server hay client

```text
Fetch ở SERVER (RSC)                  Fetch ở CLIENT (TanStack Query)
✓ không JS gửi xuống                  ✓ cache trong tab, không round-trip khi back
✓ không waterfall client→server       ✓ refetch on focus, polling, optimistic
✓ secret an toàn                       ✓ tương tác (filter, infinite scroll)
✓ gần database                         ✓ realtime, mutation
✗ mỗi navigation là round-trip        ✗ JS bundle, cần hydrate
✗ không cache client                   ✗ waterfall nếu phụ thuộc
```

Mặc định thực dụng với App Router:

```text
Dữ liệu đọc, hiển thị lần đầu    → RSC (server)
Dữ liệu phụ thuộc tương tác      → TanStack Query (client)
Mutation                          → Server Action, hoặc mutation + invalidate
```

### `queryKey` — thiết kế nó như thiết kế API

```ts
// Factory tập trung — tránh typo và làm invalidation nhất quán
export const keys = {
  tasks: {
    all:    ['tasks'] as const,
    list:   (f: TaskFilter) => ['tasks', 'list', f] as const,
    detail: (id: string)    => ['tasks', 'detail', id] as const,
  },
} as const;

// Invalidation theo prefix
qc.invalidateQueries({ queryKey: keys.tasks.all });          // mọi thứ về tasks
qc.invalidateQueries({ queryKey: keys.tasks.list({ status: 'open' }) });   // chính xác một list
```

Quy tắc bất biến: **mọi biến `queryFn` đọc phải nằm trong `queryKey`.** Thiếu một biến nghĩa là cache trả dữ liệu của tham số khác — bug im lặng và khó tìm.

### `staleTime` — quyết định nghiệp vụ

```ts
{
  queries: {
    staleTime: 30_000,          // mặc định hợp lý; 0 gây refetch liên tục
    gcTime: 5 * 60_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status < 500) return false;   // không retry 4xx
      return count < 2;
    },
    refetchOnWindowFocus: true,
  },
}
```

Đặt theo từng loại dữ liệu, không dùng một giá trị chung:

```text
Danh mục, cấu hình     staleTime: 5–60 phút
Danh sách task          staleTime: 30 giây
Số dư, tồn kho          staleTime: 0  (luôn refetch)
```

`staleTime` là câu trả lời cho "dữ liệu này cũ bao lâu thì chấp nhận được" — một câu hỏi nghiệp vụ, không phải kỹ thuật. `gcTime` là câu hỏi về bộ nhớ. Xem [Server state & cache](../02-react/behavior/04-server-state-cache.md).

### Prefetch

```tsx
// Hover vào link → tải trước
<Link
  href={`/tasks/${id}`}
  onMouseEnter={() => qc.prefetchQuery({
    queryKey: keys.tasks.detail(id),
    queryFn: () => api.getTask(id),
    staleTime: 10_000,
  })}
/>
```

Prefetch làm điều hướng cảm giác tức thì. Đánh đổi: tải dữ liệu có thể không dùng. Với hover thì tỉ lệ dùng cao nên gần như luôn đáng.

### Pagination cache

```ts
// placeholderData giữ dữ liệu trang trước trong lúc tải trang mới
useQuery({
  queryKey: keys.tasks.list({ page }),
  queryFn: () => api.getTasks({ page }),
  placeholderData: keepPreviousData,       // không nhấp nháy về skeleton
});
```

Không có `placeholderData`, mỗi lần đổi trang UI nhảy về skeleton — và người dùng cảm nhận là chậm dù thời gian như nhau.

### Optimistic update — phải có rollback

```ts
useMutation({
  mutationFn: api.toggleTask,
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: keys.tasks.all });
    const prev = qc.getQueryData(keys.tasks.all);
    qc.setQueryData(keys.tasks.all, (old: Task[] = []) =>
      old.map(t => t.id === id ? { ...t, done: !t.done } : t));
    return { prev };
  },
  onError: (_e, _id, ctx) => qc.setQueryData(keys.tasks.all, ctx?.prev),   // BẮT BUỘC
  onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks.all }),
});
```

Không có `onError` rollback, một request fail để lại UI **nói dối vĩnh viễn** — tệ hơn là chờ 300ms.

## Prediction

1. `const [tasks, setTasks] = useState([])` + `useEffect` fetch — bạn phải tự viết lại bao nhiêu tính năng của TanStack Query?
2. Filter trong `useState`, người dùng refresh trang — filter còn không? Gửi link cho đồng nghiệp thì sao?
3. `staleTime: 0`, người dùng chuyển tab đi rồi về — có refetch?
4. `queryKey: ['tasks']` nhưng `queryFn` đọc `filter` từ closure, đổi filter — dữ liệu đổi không?
5. Sửa DB, reload trang, vẫn cũ. `curl` API thấy mới — lớp nào giữ?
6. Cùng tình huống nhưng `curl` cũng thấy cũ, restart server thì hết — lớp nào?
7. TanStack Query cache có giúp giảm tải database không?
8. Optimistic update không có `onError` rollback, request fail — UI hiện gì?

<details>
<summary>Đáp án</summary>

1. Loading/error state, dedupe, cache, invalidation, retry, refetch-on-focus, race handling, pagination cache — khoảng 8 tính năng.
2. Mất khi refresh; link không mang filter.
3. Có — `staleTime: 0` nghĩa là stale ngay, `refetchOnWindowFocus` kích hoạt.
4. **Không** — cache trả bản cũ. Đây là bug phổ biến nhất với `queryKey`.
5. Cache ở client — TanStack Query hoặc Next.js Router Cache.
6. Next.js Data Cache / Full Route Cache (in-memory, per-instance).
7. **Không trực tiếp** — nó giảm HTTP request từ browser đó. Giảm tải DB là việc của Redis.
8. Trạng thái sai vĩnh viễn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ một biến khỏi `queryKey` nhưng vẫn dùng trong `queryFn` | Dữ liệu sai, im lặng |
| `staleTime: 0` với 10 query, chuyển tab qua lại | Đếm request trong Network tab |
| Đặt `staleTime: 60_000`, làm lại | Ít hơn nhiều |
| Filter trong `useState`, refresh | Mất filter |
| Chuyển sang URL, refresh và gửi link | Giữ nguyên |
| Dùng `push` thay `replace` cho filter, đổi 10 lần rồi bấm Back | Phải bấm 10 lần |
| Sửa DB rồi thử 5 bước chẩn đoán theo thứ tự | Xác định đúng lớp |
| Optimistic update, chặn API bằng DevTools | UI nói dối nếu không rollback |
| Bỏ `placeholderData` khi phân trang | Nhấp nháy skeleton mỗi trang |
| Derived state lưu trong `useState`, cập nhật nguồn ở 2 chỗ | Hai giá trị lệch nhau |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cần Redux cho dữ liệu từ API | Server state cần cache, không cần store |
| TanStack Query thay thế Redis | Hai lớp khác nhau, giải quyết hai vấn đề |
| Cache client giảm tải database | Chỉ giảm request từ browser đó |
| Filter là local state | Gần như luôn thuộc URL |
| `staleTime` và `gcTime` giống nhau | Một là độ tươi, một là tuổi thọ trong RAM |
| Một lớp cache là đủ | Có 5 lớp; mỗi lớp vô hiệu khác nhau |
| RSC thay thế hoàn toàn client fetching | Tương tác, polling, optimistic vẫn cần client |
| Optimistic update luôn cải thiện UX | Không có rollback thì tệ hơn không dùng |

## Debugging

1. **React Query DevTools** — nó hiện mọi query, key, trạng thái (fresh/stale/fetching), và dữ liệu. Phần lớn bug về cache thấy được ngay ở đây; dùng nó trước khi đọc code.
2. **Dữ liệu sai** → so `queryKey` với mọi biến `queryFn` đọc. Chúng phải khớp hoàn toàn.
3. **Refetch quá nhiều** → xem `staleTime`, `refetchOnWindowFocus`, `refetchOnMount`; đếm request trong Network tab.
4. **Dữ liệu cũ** → chạy 5 bước chẩn đoán lớp cache theo thứ tự từ ngoài vào trong.
5. **State lệch nhau** → tìm derived state đang được lưu; xoá một cái, tính từ cái còn lại.
6. **Không rõ state thuộc loại nào** → dùng bảng quyết định ở phần Mental Model.

## Production Considerations

- **Phân loại state tường minh** ngay khi thêm state mới. Đây là quyết định kiến trúc, không phải chi tiết.
- **URL state cho mọi thứ người dùng có thể muốn share** — filter, sort, page, search.
- **`queryKey` factory tập trung** để invalidation nhất quán và không typo.
- **`staleTime` theo từng loại dữ liệu**, không dùng một giá trị chung.
- **`queryClient.clear()` khi logout** — nếu không, người dùng tiếp theo trên cùng máy thấy dữ liệu của người trước. Đây là lỗi bảo mật thật.
- **Không retry 4xx**; retry 5xx có backoff.
- **Redis khi nút thắt là database**; TanStack Query khi nút thắt là round-trip. Đo trước khi thêm.
- **Đặt `staleTime` mặc định > 0** ở `QueryClient` — mặc định 0 gây refetch nhiều hơn cần thiết.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Fetch ở server (RSC) | ít JS, không waterfall, secret an toàn | không cache client, mỗi navigation round-trip |
| Fetch ở client | cache trong tab, tương tác tốt | JS bundle, cần hydrate |
| URL state | share được, back hoạt động | URL dài, cần serialize |
| Local state | đơn giản nhất | mất khi refresh, không share |
| `staleTime` cao | ít request | dữ liệu cũ hơn |
| Prefetch | điều hướng tức thì | tải dữ liệu có thể không dùng |
| Optimistic update | phản hồi tức thì | cần rollback; UI có thể nói dối |
| Thêm Redis | giảm tải DB thật | thêm hạ tầng, thêm invalidation |

## Explain Without Notes

1. Năm loại state và công cụ tương ứng?
2. Bảng quyết định để phân loại một state mới?
3. TanStack Query và Redis khác nhau ở ba điểm nào? Mỗi cái giảm cái gì?
4. Năm lớp cache và cách vô hiệu mỗi lớp?
5. Năm bước chẩn đoán "dữ liệu cũ đến từ lớp nào"?
6. Vì sao filter nên ở URL, và vì sao dùng `replace` không phải `push`?

## Related

- [Một màn hình nhiều API](01-multi-api-screen.md) — orchestration
- [Slow API UX](03-slow-api-ux.md) — khi cache không đủ
- [Server state & cache](../02-react/behavior/04-server-state-cache.md) — chi tiết TanStack Query
- [Props & state design](../02-react/behavior/06-props-composition-state-design.md) — derived state, colocation
- [Next.js data fetching & cache](../03-nextjs/behavior/03-data-fetching-cache.md) — 5 lớp cache của Next.js
- [HTTP & browser cache](../00-web-foundations/02-http-browser-cache.md) — lớp ngoài cùng
- [Cache patterns](../../03-database/02-redis/03-cache-patterns.md) — lớp server
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md)
