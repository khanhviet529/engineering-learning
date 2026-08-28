---
level: intermediate
area: frontend
prerequisites:
  - 03-async-race-condition.md
related:
  - ../../03-nextjs/behavior/03-data-fetching-cache.md
  - ../../../03-database/02-redis/03-cache-patterns.md
---

# Server state & cache

> Server state không phải state của bạn. Nó là **bản sao** của một sự thật ở nơi khác, và bản sao thì luôn có thể cũ. Đó là toàn bộ lý do một thư viện riêng tồn tại cho nó.

## Position

```text
PostgreSQL (sự thật) → API → [cache trong browser] → React state → UI
                                    ↑ note này
```

## Problem

`useState` được thiết kế cho **client state**: giá trị bạn sở hữu hoàn toàn (modal đang mở, tab đang chọn, nội dung input). Đặc điểm: bạn là nguồn duy nhất, không ai đổi sau lưng bạn, không bao giờ "cũ".

Server state khác về bản chất:

| | Client state | Server state |
|---|---|---|
| Chủ sở hữu | bạn | server |
| Có thể cũ? | không | **có, ngay sau khi lấy về** |
| Ai khác đổi được? | không | có (user khác, job, admin) |
| Cần đồng bộ? | không | có |
| Có thể lỗi khi đọc? | không | có |
| Có loading state? | không | có |

Dùng `useState` + `useEffect` cho server state nghĩa là bạn sẽ tự viết lại: loading, error, race condition, dedupe, cache, invalidation, retry, refetch khi focus, và pagination. Mỗi component một lần, mỗi lần một cách khác.

## Mental Model

Server state là một **cache có chính sách làm mới**, không phải một biến.

```text
                      fetch
    ┌──────────────────────────────────────┐
    │  Cache (theo KEY)                    │
    │  ['user', 1] → { data, updatedAt }   │
    │  ['tasks', {status:'open'}] → ...    │
    └──────────────────────────────────────┘
         fresh ──────────→ dùng ngay, không fetch
         stale ──────────→ trả ngay + fetch nền (stale-while-revalidate)
         không có ───────→ loading + fetch
```

Hai khái niệm phải phân biệt rõ, và đây là chỗ nhầm nhiều nhất:

- **`staleTime`** — bao lâu dữ liệu được coi là *còn tươi* (không cần fetch lại). Đây là **quyết định nghiệp vụ**: dữ liệu này cũ 30 giây có sao không?
- **`gcTime`** (cacheTime) — bao lâu dữ liệu **không được dùng** còn nằm trong memory trước khi bị xoá. Đây là quyết định về **bộ nhớ**.

Mặc định `staleTime: 0` nghĩa là mọi dữ liệu stale ngay lập tức → refetch rất thường xuyên. Đặt `staleTime` phù hợp là thay đổi có tác động lớn nhất khi tối ưu.

Và **key là identity**. Đây là điều làm race condition không thể xảy ra: dữ liệu của `['user', 1]` không có đường nào ghi vào chỗ của `['user', 2]`.

## How It Works

### Query

```tsx
const { data, isPending, isError, error, isFetching } = useQuery({
  queryKey: ['tasks', { projectId, status }],   // mọi input đều PHẢI vào key
  queryFn: ({ signal }) =>
    fetch(`/api/tasks?project=${projectId}&status=${status}`, { signal })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
  staleTime: 30_000,
});
```

Phân biệt hai cờ:

- `isPending` — **chưa có dữ liệu nào** (lần đầu). Hiện skeleton.
- `isFetching` — đang có request bay, **có thể đã có dữ liệu cũ**. Hiện indicator nhỏ, không xoá nội dung.

Dùng `isPending` cho lần đầu và `isFetching` cho refresh là cách có UX tốt: người dùng không bị mất nội dung khi làm mới.

`queryFn` **phải** throw khi response không ok — `fetch` không throw với 4xx/5xx. Đây là lỗi hay gặp: query "thành công" với body lỗi.

### Mutation + invalidation

```tsx
const qc = useQueryClient();

const create = useMutation({
  mutationFn: (input: NewTask) =>
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),

  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });   // đánh dấu stale → refetch
  },
});

<button disabled={create.isPending} onClick={() => create.mutate(input)}>Add</button>
```

`invalidateQueries` với prefix `['tasks']` làm stale **mọi** query bắt đầu bằng `tasks` — kể cả `['tasks', {status:'open'}]`. Cấu trúc key phân cấp là điều làm invalidation trở nên dễ quản.

### Optimistic update

```tsx
const toggle = useMutation({
  mutationFn: (id: string) => api.toggle(id),

  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: ['tasks'] });
    const prev = qc.getQueryData<Task[]>(['tasks']);
    qc.setQueryData<Task[]>(['tasks'], (old) =>
      old?.map(t => t.id === id ? { ...t, done: !t.done } : t));
    return { prev };                          // context cho rollback
  },

  onError: (_e, _id, ctx) => qc.setQueryData(['tasks'], ctx?.prev),   // rollback
  onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),     // đồng bộ lại
});
```

Optimistic update rất tốt cho UX nhưng **phải** có rollback. Không có `onError` rollback thì một request fail để lại UI nói dối vĩnh viễn — tệ hơn là chờ 300ms.

Dùng optimistic khi: xác suất thành công cao, thao tác dễ hoàn tác (toggle, like, reorder). Không dùng khi: thanh toán, xoá vĩnh viễn, hoặc thao tác mà thất bại khó giải thích cho người dùng.

## Example

```tsx
// So sánh: cùng một tính năng
// ❌ ~50 dòng thủ công, thiếu: dedupe, cache, retry, refetch on focus, pagination
function TasksManual({ projectId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    fetch(`/api/tasks?project=${projectId}`)
      .then(r => r.json())
      .then(d => { if (!ignore) { setTasks(d); setLoading(false); } })
      .catch(e => { if (!ignore) { setError(e); setLoading(false); } });
    return () => { ignore = true; };
  }, [projectId]);
  // ...
}

// ✅
function Tasks({ projectId }: Props) {
  const { data, isPending, error } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: ({ signal }) => api.tasks(projectId, signal),
    staleTime: 30_000,
  });
  if (isPending) return <Skeleton />;
  if (error) return <ErrorState error={error} />;
  return <List items={data} />;
}
```

## Prediction

1. Hai component cùng dùng `queryKey: ['user', 1]`, mount cùng lúc — bao nhiêu HTTP request?
2. `staleTime: 0` (mặc định), người dùng chuyển tab đi rồi về — có refetch không?
3. `staleTime: 60_000`, cùng thao tác — có refetch không?
4. `queryKey: ['tasks']` nhưng `queryFn` dùng `status` từ props (không có trong key). Đổi `status` — dữ liệu đổi không?
5. `invalidateQueries({ queryKey: ['tasks'] })` — có làm stale `['tasks', {status:'open'}]` không? Còn `['task', 1]`?
6. Optimistic update, request fail, không có `onError` rollback — UI hiện gì?

Câu 4 là bug phổ biến nhất khi mới dùng: thiếu biến trong key làm cache trả dữ liệu của tham số khác.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ một biến khỏi `queryKey` nhưng vẫn dùng trong `queryFn` | Dữ liệu sai, cache trả bản của tham số cũ |
| `staleTime: 0` với danh sách lớn | Refetch mỗi lần focus/mount; xem Network tab |
| `queryFn` không throw khi `!r.ok` | Query "thành công" với body lỗi; UI hiện dữ liệu rác |
| Optimistic không có rollback, chặn API bằng DevTools | UI hiện trạng thái sai vĩnh viễn |
| Quên `invalidateQueries` sau mutation | Danh sách không cập nhật sau khi thêm |
| Invalidate quá rộng (`invalidateQueries()` không key) | Refetch toàn bộ app |
| Đặt server state vào Redux/Context thủ công | Tự viết lại cache; so số dòng code |
| Mở 2 tab, sửa ở tab A | Tab B cũ đến khi focus (refetch on focus) — quan sát chính sách làm mới |

## What Usually Goes Wrong

- **Thiếu biến trong `queryKey`** → cache trả dữ liệu sai.
- **`queryFn` không throw** với response lỗi.
- **Copy server state sang `useState`** rồi cả hai lệch nhau. Đọc trực tiếp từ `data`.
- **Không invalidate** sau mutation → UI cũ.
- **Invalidate quá rộng** → refetch cả app sau mỗi thao tác nhỏ.
- **Optimistic không rollback**.
- **Đặt server state vào global store** (Redux) → tự viết lại cache, invalidation, dedupe.
- **Dùng `isFetching` cho skeleton** → nội dung nhấp nháy mỗi lần refetch nền.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Server state như client state | Nó là bản sao, có thể cũ, có owner khác |
| `staleTime` và `gcTime` giống nhau | Một là độ tươi, một là tuổi thọ trong memory |
| Cache nghĩa là dữ liệu cũ | `stale-while-revalidate`: hiện ngay + làm mới nền |
| Cần Redux cho dữ liệu từ API | Server state cần cache, không cần store. Redux cho client state phức tạp |
| `fetch` throw khi 404 | Không. Chỉ throw khi lỗi mạng |
| Optimistic update luôn tốt cho UX | Không có rollback thì tệ hơn không dùng |
| Invalidate = refetch ngay | Đánh dấu stale; refetch khi query đang được dùng |

## Debugging

1. **Cài React Query DevTools.** Nó hiện mọi query, key, trạng thái (fresh/stale/fetching), và dữ liệu. Phần lớn bug được nhìn thấy ngay ở đây — dùng nó trước khi đọc code.
2. **Dữ liệu sai** → so `queryKey` với mọi biến mà `queryFn` đọc. Chúng phải khớp hoàn toàn.
3. **Refetch quá nhiều** → xem `staleTime`, `refetchOnWindowFocus`, `refetchOnMount`. Đếm request trong Network tab.
4. **UI không cập nhật sau mutation** → kiểm tra `invalidateQueries` có khớp prefix key không.
5. **Dữ liệu cũ dai dẳng** → xác định lớp: DevTools (client cache) → Network (có request không) → response (dữ liệu server đúng chưa) → Next.js cache → Redis → DB. Đi từ ngoài vào.
6. **Loading nhấp nháy** → dùng `isPending` chứ không `isFetching`; hoặc `placeholderData` để giữ dữ liệu cũ khi đổi key.

## Production Considerations

- **Đặt `staleTime` theo từng loại dữ liệu**: danh mục ít đổi (5 phút), danh sách task (30 giây), số dư (0). Không dùng một giá trị cho mọi thứ.
- **Chuẩn hoá key** thành factory để tránh typo và để invalidation nhất quán:
  ```ts
  export const keys = {
    tasks: (f?: Filter) => ['tasks', f] as const,
    task: (id: string) => ['task', id] as const,
  };
  ```
- **Retry chỉ cho lỗi transient** — mặc định retry 4xx là vô ích và gây tải.
- **Xoá cache khi logout** (`queryClient.clear()`) — nếu không, người dùng tiếp theo trên cùng máy thấy dữ liệu của người trước.
- Với Next.js App Router, phần lớn dữ liệu đọc nên fetch ở **server**; dùng query cho dữ liệu thay đổi thường và cho tương tác client. Xem [Data fetching & cache](../../03-nextjs/behavior/03-data-fetching-cache.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Thư viện server state | giải quyết cả một lớp vấn đề | thêm dependency, thêm khái niệm |
| `staleTime` cao | ít request, nhanh | dữ liệu cũ hơn |
| `staleTime: 0` | luôn mới | nhiều request, có thể nhấp nháy |
| Optimistic update | UI phản hồi tức thì | cần rollback; UI có thể nói dối |
| Fetch ở server (RSC) | không JS, không waterfall | không có cache client, mỗi navigation là round-trip |

## Explain Without Notes

1. Server state khác client state ở những điểm nào?
2. `staleTime` và `gcTime` khác nhau thế nào? Mỗi cái là quyết định về gì?
3. Vì sao `queryKey` loại bỏ race condition?
4. `isPending` vs `isFetching` — dùng cái nào cho skeleton, vì sao?
5. Optimistic update cần gì để không nói dối người dùng?

## Related

- [Async race condition](03-async-race-condition.md) — vấn đề mà cache-theo-key loại bỏ
- [Effects & lifecycle](02-effects-lifecycle.md) — vì sao fetch-in-effect không đủ
- [Next.js data fetching](../../03-nextjs/behavior/03-data-fetching-cache.md) — lớp cache của framework
- [HTTP & browser cache](../../00-web-foundations/02-http-browser-cache.md) — lớp cache của browser
- [Cache patterns](../../../03-database/02-redis/03-cache-patterns.md) — cùng nguyên lý ở server
- [Forms](10-forms.md) — mutation và validation
