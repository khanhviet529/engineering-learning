---
level: foundation
area: frontend
prerequisites:
  - 01-state-render.md
  - ../01-javascript-typescript/03-execution-context-closure.md
related:
  - 03-async-race-condition.md
  - 11-custom-hooks.md
---

# Effects & lifecycle

> `useEffect` không phải "lifecycle hook". Nó là cơ chế **đồng bộ component với một hệ thống bên ngoài**. Dùng nó như `componentDidMount` là nguồn của gần như mọi bug effect.

## Position

```text
RENDER (thuần) → COMMIT (sửa DOM) → browser paint → EFFECT chạy
                                                        ↑ note này
```

Effect chạy **sau** khi DOM đã cập nhật và browser đã vẽ. Đó là lý do nó không được dùng để tính giá trị hiển thị.

## Problem

Bốn bug effect kinh điển:

```ts
// 1. Effect chạy 2 lần trong dev — "React bị lỗi?"
useEffect(() => { console.log('mount'); }, []);

// 2. Vòng lặp vô hạn
useEffect(() => { setData({ ...data, ready: true }); });

// 3. Counter đứng ở 1
useEffect(() => {
  const id = setInterval(() => setN(n + 1), 1000);
  return () => clearInterval(id);
}, []);

// 4. Derived state — không cần effect chút nào
useEffect(() => { setFullName(first + ' ' + last); }, [first, last]);
```

Bốn bug, ba nguyên nhân: hiểu sai mục đích của effect, hiểu sai dependency, và [stale closure](../01-javascript-typescript/03-execution-context-closure.md).

## Mental Model

Câu hỏi đúng khi viết effect **không** phải "khi nào tôi muốn code này chạy?" mà:

> **"Component này cần đồng bộ với hệ thống bên ngoài nào, và làm sao ngắt kết nối đó?"**

```text
Effect = { thiết lập kết nối, dọn kết nối }

setup:   subscribe / addEventListener / mở socket / start timer / fetch
cleanup: unsubscribe / removeEventListener / đóng / clear / abort
```

"Hệ thống bên ngoài" = mọi thứ không phải React state: DOM API, `window`, timer, WebSocket, thư viện bên thứ ba, network.

Từ mô hình này suy ra ngay: **nếu bạn không mô tả được cleanup thì có lẽ bạn không cần effect.**

Bảng quyết định:

| Việc bạn muốn làm | Có cần effect? |
|---|---|
| Tính giá trị từ props/state | **Không** — tính trực tiếp trong render |
| Cập nhật state khi props đổi | **Không** — tính trực tiếp, hoặc dùng `key` để reset |
| Xử lý một event của người dùng | **Không** — làm trong event handler |
| Gửi request khi click | **Không** — trong handler |
| Fetch dữ liệu để hiển thị | Được, nhưng nên dùng thư viện. Xem [server state](04-server-state-cache.md) |
| Subscribe một event bên ngoài | **Có** |
| Đồng bộ với `document.title`, `localStorage` | **Có** |
| Kết nối WebSocket | **Có** |

Phần lớn `useEffect` trong code thực tế thuộc ba hàng đầu — tức là không cần thiết.

## How It Works

### Dependency array

```ts
useEffect(fn);            // sau MỌI render
useEffect(fn, []);        // một lần sau mount (+ 1 lần nữa trong StrictMode dev)
useEffect(fn, [a, b]);    // khi Object.is(a_prev, a) hoặc Object.is(b_prev, b) là false
```

Dependency **không** phải "khi nào tôi muốn chạy". Nó là "những giá trị mà effect này đọc". Nếu effect đọc một giá trị mà nó không có trong deps, giá trị đó bị đóng băng — đó là stale closure.

Đây là lý do `react-hooks/exhaustive-deps` nên được coi là **error**, không phải warning. Tắt nó bằng `// eslint-disable` là cách tạo bug số một trong React.

### StrictMode: vì sao effect chạy 2 lần

Trong dev với StrictMode, React chạy `setup → cleanup → setup` để kiểm tra effect của bạn có **chịu được việc bị mount lại**. Điều đó quan trọng thật, vì:

- Fast Refresh trong dev mount lại component;
- `<Offscreen>`/Suspense có thể mount lại;
- người dùng navigate qua lại.

Nếu chạy 2 lần gây vấn đề, effect của bạn thiếu cleanup — và bug đó sẽ xuất hiện trong production dưới dạng listener nhân đôi hoặc request trùng.

**Cách sửa đúng là viết cleanup, không phải tắt StrictMode.**

### Cleanup

```ts
useEffect(() => {
  const ac = new AbortController();

  fetch(`/api/users/${id}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });

  return () => ac.abort();    // chạy trước lần setup tiếp theo VÀ khi unmount
}, [id]);
```

Thứ tự khi `id` đổi: `cleanup(id cũ)` → `setup(id mới)`. Không phải setup rồi mới cleanup.

### Đừng dùng effect cho derived state

```ts
// ❌ hai lần render, state có thể lệch nhau
const [full, setFull] = useState('');
useEffect(() => { setFull(first + ' ' + last); }, [first, last]);

// ✅ một lần render, không thể lệch
const full = first + ' ' + last;

// ✅ nếu tính toán thật sự nặng
const full = useMemo(() => expensive(first, last), [first, last]);
```

Pattern sai này còn gây flash: render đầu tiên `full` là `''`, người dùng thấy nội dung trống trong một frame.

### Reset state khi props đổi — dùng `key`

```tsx
// ❌ effect để reset
useEffect(() => { setDraft(''); }, [userId]);

// ✅ key mới → React tạo instance mới, state tự reset
<Editor key={userId} userId={userId} />
```

`key` là công cụ hay bị bỏ qua nhất. Nó biến "reset state" từ một effect thành một tính chất của cây component. Xem [Reconciliation & keys](05-reconciliation-keys.md).

### `useLayoutEffect`

Chạy **trước** khi browser paint — dùng khi bạn cần đo DOM và sửa trước khi người dùng thấy:

```ts
useLayoutEffect(() => {
  const { height } = ref.current!.getBoundingClientRect();
  setTooltipTop(height);        // tránh tooltip nhảy một frame
}, []);
```

Nó chặn paint, nên dùng đúng chỗ (đo/định vị) và không dùng cho fetch. Trong SSR nó gây warning vì không có DOM.

## Example

```tsx
// Đúng: đồng bộ với một hệ thống bên ngoài, có cleanup
function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

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

Effect này chạy 2 lần trong StrictMode và **không có vấn đề gì** — vì cleanup đúng. Đó là bài kiểm tra.

## Prediction

1. `useEffect(() => console.log('x'), [])` trong StrictMode dev — in mấy lần? Trong production?
2. `useEffect(() => setCount(count + 1))` không có deps — điều gì xảy ra?
3. Effect với `[]` dùng `setInterval(() => setN(n + 1))` — sau 5 giây `n` là mấy? Vì sao?
4. Effect có `[id]`, `id` đổi từ 1 → 2. Thứ tự: setup(2) trước hay cleanup(1) trước?
5. `useEffect(fn, [{ a: 1 }])` — effect chạy mỗi render hay chỉ một lần?
6. `useLayoutEffect` vs `useEffect` — cái nào chạy trước paint?

<details>
<summary>Đáp án</summary>

1. Hai lần trong dev+StrictMode; một lần trong production.
2. Vòng lặp vô hạn: mỗi effect gọi setState → render → effect chạy lại.
3. `n = 1`. Callback bị khoá trong scope có `n = 0`, nên luôn `setN(1)`. Sửa bằng `setN(p => p + 1)`.
4. `cleanup(1)` trước, rồi `setup(2)`.
5. Mỗi render — object literal là reference mới mỗi lần, `Object.is` luôn `false`.
6. `useLayoutEffect`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ cleanup của `addEventListener`, navigate qua lại 20 lần | Đếm listener bằng `getEventListeners(window)` trong console |
| `setState` trong effect không có deps | Vòng lặp vô hạn, tab treo |
| `[]` với effect đọc state | Giá trị đóng băng — stale closure |
| Object literal trong deps | Effect chạy mỗi render |
| Bỏ `AbortController` rồi đổi `id` nhanh | Race condition. Xem [note 03](03-async-race-condition.md) |
| Tắt StrictMode để "sửa" effect chạy 2 lần | Bug vẫn ở đó, chỉ ẩn đi; sẽ hiện lại trong production |
| Dùng effect cho derived state | Thêm một render, và một frame hiển thị giá trị rỗng |
| `useLayoutEffect` với việc nặng | Chặn paint, jank rõ rệt |

## What Usually Goes Wrong

- **Dùng effect cho derived state** — bug phổ biến nhất, và hoàn toàn không cần thiết.
- **Thiếu dependency** → stale closure, giá trị đóng băng.
- **Thiếu cleanup** → leak listener/timer/socket, request trùng.
- **`// eslint-disable-next-line react-hooks/exhaustive-deps`** — gần như luôn che một bug thật.
- **Fetch trong effect thủ công** → thiếu race handling, dedupe, cache, retry. Xem [server state](04-server-state-cache.md).
- **Object/array/function trong deps** không được memo → effect chạy mỗi render.
- **Dùng effect để phản ứng với event của user** — nên làm trong handler; effect làm luồng dữ liệu khó theo.
- **`useLayoutEffect` cho việc không cần đo DOM** → chặn paint không lý do.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `useEffect(fn, [])` = `componentDidMount` | Chạy 2 lần trong StrictMode; và nó phải chịu được mount lại |
| Effect chạy 2 lần là bug của React | Là kiểm tra chủ động; cleanup thiếu là bug của bạn |
| Deps là "khi nào tôi muốn chạy" | Là "effect này đọc những giá trị nào" |
| Cần effect để cập nhật state khi props đổi | Tính trực tiếp trong render, hoặc dùng `key` |
| Effect chạy trước paint | Sau paint. `useLayoutEffect` mới trước |
| Cleanup chỉ chạy khi unmount | Chạy trước **mỗi** lần setup lại |
| Effect rỗng deps không bao giờ thấy state mới | Đúng — và đó chính là stale closure |

## Debugging

1. **Effect chạy quá nhiều** → log deps ra: `useEffect(() => {...}, [a, b])` kèm `console.log({a, b})`. Tìm cái nào đổi reference mỗi render.
2. **Giá trị cũ trong effect** → so sánh deps thật với những gì effect đọc. Bật `exhaustive-deps` và làm theo nó.
3. **Vòng lặp vô hạn** → tìm `setState` trong effect mà state đó (trực tiếp hay gián tiếp) nằm trong deps.
4. **Leak** → `getEventListeners(window)` trong Chrome console; hoặc heap snapshot. Xem [Memory & GC](../01-javascript-typescript/05-memory-gc.md).
5. **StrictMode phát hiện vấn đề** → đừng tắt nó. Viết cleanup cho đến khi setup→cleanup→setup an toàn.
6. React DevTools → Profiler cho biết effect nào chạy sau render nào.

## Production Considerations

- **`exhaustive-deps` là error trong CI.** Đây là quy tắc có ROI cao nhất cho code React.
- **Mọi effect có subscription phải có cleanup.** Không ngoại lệ.
- **StrictMode bật ở dev** cho mọi dự án.
- **Không fetch bằng effect thủ công** trong production code — dùng TanStack Query/SWR, hoặc fetch ở server (RSC). Effect thủ công thiếu quá nhiều thứ.
- Đếm số effect trong codebase; số lớn thường là dấu hiệu dùng effect cho việc không cần effect.
- React 19: `use()` và Server Components làm nhiều effect fetch trở nên không cần thiết.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Deps đầy đủ | không stale | effect chạy thường xuyên hơn |
| `useRef` để tránh deps | effect chạy ít | dễ đọc giá trị cũ trên UI |
| `key` để reset state | đơn giản, không effect | mount lại toàn bộ subtree (mất DOM state) |
| Thư viện server state | xử lý cache/race/retry | thêm dependency, thêm khái niệm |
| `useLayoutEffect` | không nhảy layout | chặn paint |

## Explain Without Notes

1. Câu hỏi đúng khi viết một effect là gì?
2. Vì sao effect chạy 2 lần trong StrictMode, và cách sửa đúng?
3. Dependency array nghĩa là gì (chính xác)?
4. Nêu 3 việc **không** cần effect, và cách làm đúng cho mỗi việc.
5. Thứ tự cleanup/setup khi một dependency đổi?

## Related

- [State → render](01-state-render.md) — effect chạy sau commit
- [Async race condition](03-async-race-condition.md) — cleanup và AbortController
- [Server state & cache](04-server-state-cache.md) — thay thế fetch-in-effect
- [Custom hooks](11-custom-hooks.md) — đóng gói effect
- [Reconciliation & keys](05-reconciliation-keys.md) — `key` để reset state
- [Closure](../01-javascript-typescript/03-execution-context-closure.md) — cơ chế stale closure
- [Memory & GC](../01-javascript-typescript/05-memory-gc.md) — leak từ thiếu cleanup
