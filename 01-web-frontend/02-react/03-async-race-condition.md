---
level: intermediate
area: frontend
prerequisites:
  - 02-effects-lifecycle.md
  - ../01-javascript-typescript/04-promise-concurrency.md
related:
  - 04-server-state-cache.md
  - ../../05-cross-cutting/concurrency/01-concurrency-models.md
---

# Async race condition trong UI

> Request A gửi trước B, nhưng A trả về **sau** B và ghi đè dữ liệu mới bằng dữ liệu cũ. Người dùng thấy thông tin của người khác. Đây là bug bạn không thấy trên máy local vì mạng của bạn quá nhanh.

## Position

```text
React → fetch → network (độ trễ KHÔNG xác định) → setState
                        ↑ thứ tự trả về ≠ thứ tự gửi
```

## Problem

```tsx
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(r => r.json())
      .then(setUser);          // ← bug ở đây
  }, [userId]);

  return <div>{user?.name}</div>;
}
```

Người dùng click nhanh: user 1 → user 2.

```text
t=0    userId=1 → gửi request A
t=50   userId=2 → gửi request B
t=120  B trả về → setUser(user2)   ✅ UI hiện user 2 — đúng
t=300  A trả về → setUser(user1)   ❌ UI hiện user 1 — nhưng userId là 2
```

Kết quả: URL nói user 2, màn hình hiện user 1. Không có lỗi nào trong console. Test pass. Trên máy dev với `localhost` (độ trễ 2ms) hầu như không tái hiện được.

Trong một app có tiền hoặc dữ liệu riêng tư, đây không phải bug UI — đây là **lộ dữ liệu giữa các user**.

## Mental Model

Vấn đề gốc:

> **Mỗi response cần biết nó thuộc về request nào, và chỉ được ghi vào state nếu nó vẫn là request mới nhất.**

Ba cách giải quyết, ba mức độ:

```text
1. IGNORE STALE   — đánh dấu request cũ là không còn liên quan, bỏ response của nó
                    (không huỷ; server vẫn xử lý)

2. ABORT          — huỷ thật request cũ qua AbortController
                    (tiết kiệm băng thông và tài nguyên server)

3. REQUEST KEY    — mỗi kết quả được lưu theo key của nó, UI đọc theo key hiện tại
                    (thư viện server state làm cách này)
```

Cách 3 mạnh nhất vì nó **loại bỏ khả năng xảy ra** thay vì xử lý sau khi xảy ra: không có một ô state chung để ghi đè.

## How It Works

### Cách 1 — cờ ignore

```tsx
useEffect(() => {
  let ignore = false;                          // riêng cho mỗi lần effect chạy

  fetch(`/api/users/${userId}`)
    .then(r => r.json())
    .then(data => { if (!ignore) setUser(data); });   // chỉ ghi nếu còn liên quan

  return () => { ignore = true; };              // cleanup đánh dấu là cũ
}, [userId]);
```

Vì sao đúng: mỗi lần effect chạy tạo một biến `ignore` **riêng** (closure). Khi `userId` đổi, cleanup của lần trước set `ignore = true` cho closure *đó*, nên response A không ghi được nữa. Đây là [closure](../01-javascript-typescript/03-execution-context-closure.md) được dùng đúng mục đích.

7 dòng, không thư viện. Đây là cách tối thiểu đúng.

### Cách 2 — AbortController

```tsx
useEffect(() => {
  const ac = new AbortController();

  fetch(`/api/users/${userId}`, { signal: ac.signal })
    .then(r => r.json())
    .then(setUser)
    .catch(e => { if (e.name !== 'AbortError') setError(e); });   // ← bắt buộc

  return () => ac.abort();
}, [userId]);
```

Ưu điểm so với cách 1: request thật sự bị huỷ — tiết kiệm băng thông, giải phóng connection, và giảm tải server.

Bẫy: `abort()` làm promise **reject** với `AbortError`. Không lọc nó ra thì bạn hiện thông báo lỗi cho người dùng mỗi lần họ điều hướng.

Điều `AbortController` **không** làm: nếu request là một mutation đã tới server, server **vẫn xử lý nó**. Abort chỉ nghĩa là bạn không nghe câu trả lời. Đây là lý do mutation cần [idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md), không phải abort.

### Cách 3 — cache theo key

```tsx
const { data: user, isPending } = useQuery({
  queryKey: ['user', userId],       // ← dữ liệu được lưu theo key
  queryFn: ({ signal }) => fetch(`/api/users/${userId}`, { signal }).then(r => r.json()),
});
```

Không có race condition **về mặt cấu trúc**: kết quả của `['user', 1]` không thể ghi vào chỗ của `['user', 2]`. Cộng thêm: dedupe request trùng, cache, retry, refetch khi focus, và `signal` được cung cấp tự động.

### Race condition trong mutation

Không chỉ đọc. Với ghi thì hậu quả nặng hơn:

```tsx
// Người dùng click "Save" hai lần nhanh
await fetch('/api/tasks', { method: 'POST', body });   // tạo task
await fetch('/api/tasks', { method: 'POST', body });   // tạo task THỨ HAI
```

Ba lớp phòng thủ, cần cả ba:

1. **UI**: disable nút khi đang gửi (`isPending`).
2. **Client**: dedupe mutation đang bay (thư viện mutation làm việc này).
3. **Server**: idempotency key hoặc unique constraint — **lớp duy nhất thật sự đảm bảo**.

Lớp 1 và 2 là UX. Chỉ lớp 3 chống được double-submit từ hai tab, từ retry của mạng, hoặc từ người dùng cố ý.

## Example

```tsx
// Tái hiện bug 100% — dùng để test
// Backend: thêm delay nghịch với id
app.get('/api/users/:id', async (req, res) => {
  const delay = req.params.id === '1' ? 2000 : 100;   // user 1 chậm hơn nhiều
  await sleep(delay);
  res.json({ id: req.params.id, name: `User ${req.params.id}` });
});
```

Giờ click user 1 → user 2 và quan sát: sau 2 giây UI nhảy về user 1. Bug tái hiện được là bug sửa được — và là bug test được.

## Prediction

1. Với code có bug ở phần Problem: click user 1 rồi user 2 (A chậm 2s, B nhanh 100ms) — UI hiện gì sau 2,5 giây?
2. Thêm cờ `ignore` — UI hiện gì? Request A có bị huỷ không?
3. Dùng `AbortController` — request A trong Network tab hiện trạng thái gì?
4. Không lọc `AbortError` — người dùng thấy gì khi điều hướng?
5. Click "Save" hai lần trong 100ms, backend không có unique constraint — bao nhiêu record?
6. Chỉ disable nút (không có bảo vệ server), người dùng mở 2 tab và submit cùng lúc — bao nhiêu record?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Delay nghịch theo id (như ví dụ trên), click nhanh | Race tái hiện 100% |
| DevTools → Network → throttle "Slow 3G" | Race xuất hiện với thao tác bình thường |
| Bỏ cleanup, unmount component giữa lúc fetch | Cảnh báo setState trên component đã unmount (React 17) / im lặng (React 18+) |
| `abort()` mà không lọc `AbortError` | Thông báo lỗi giả mỗi lần điều hướng |
| Click submit 5 lần trong 200ms | Đếm record trong DB |
| Hai tab cùng submit | Chứng minh client-side guard không đủ |
| Abort một `POST` đã tới server | Record vẫn được tạo — abort không rollback |

## What Usually Goes Wrong

- **Fetch trong effect không có cleanup** — nguyên nhân số một.
- **Chỉ test trên localhost** → không bao giờ thấy race.
- **Không lọc `AbortError`** → lỗi giả.
- **Tin rằng disable nút là đủ** cho double-submit.
- **Abort mutation và tưởng đã rollback** — server đã xử lý.
- **Nhiều nguồn ghi vào cùng một ô state** (effect + handler + WebSocket) → thứ tự bất định.
- **Không có loading state theo từng request** → UI hiện dữ liệu của key cũ trong lúc chờ key mới.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Response về theo thứ tự gửi | Không có đảm bảo nào |
| `await` tuần tự nên không có race | Race xảy ra giữa các *lần render*, không trong một hàm |
| `abort()` huỷ việc trên server | Chỉ ngừng nghe; server vẫn xử lý |
| Disable nút chống được double-submit | Chỉ chống người dùng bình thường, một tab |
| Race chỉ xảy ra với mạng chậm | Mạng chậm làm nó *dễ thấy*; nó luôn có thể xảy ra |
| React tự xử lý việc này | Không. React không biết request nào thuộc render nào |
| Chỉ đọc mới có race | Ghi có race, và hậu quả nặng hơn |

## Debugging

1. **UI hiện dữ liệu không khớp URL/selection** → nghi race ngay. Đây là dấu hiệu đặc trưng.
2. Log kèm identity của request:
   ```ts
   console.log('response for', userId, 'current is', currentIdRef.current);
   ```
   Nếu hai giá trị khác nhau, bạn đã tìm ra.
3. Tái hiện có kiểm soát: thêm delay ở server hoặc DevTools throttling. Không sửa bug mà không tái hiện được trước.
4. Network tab: tìm request `canceled` (đúng) hay `200` cho request lẽ ra đã cũ (sai).
5. Đếm record trong DB sau khi click nhanh — phát hiện double-write.
6. React DevTools → xem `user` state đổi mấy lần và với giá trị nào.

## Production Considerations

- **Dùng thư viện server state** (TanStack Query, SWR, hoặc RSC + Server Actions). Race condition là một trong nhiều vấn đề mà chúng giải quyết theo cấu trúc.
- **Mọi mutation nhạy cảm cần bảo vệ ở server**: idempotency key, unique constraint, hoặc kiểm tra chuyển trạng thái. Xem [Idempotency & retry](../../06-system-design/03-idempotency-retry.md).
- **Truyền `AbortSignal` xuyên tầng** để huỷ lan truyền được.
- Người dùng thật có mạng chậm và nhấp nhiều lần. Test với throttling như một phần của quy trình.
- Nếu có realtime (WebSocket) **và** fetch cùng ghi vào một state, xác định rõ ai là nguồn sự thật. Xem [WebSocket & SSE](../00-web-foundations/08-websocket-sse.md).

## Trade-offs

| Cách | Được | Mất |
|---|---|---|
| Cờ `ignore` | 7 dòng, không dependency | request vẫn chạy, tốn tài nguyên |
| `AbortController` | huỷ thật, tiết kiệm | phải lọc `AbortError` |
| Thư viện server state | loại bỏ vấn đề theo cấu trúc + cache, dedupe, retry | thêm dependency và khái niệm |
| Idempotency key ở server | đảm bảo thật | thêm bảng/logic ở backend |
| Disable nút | UX rõ ràng, dễ làm | không phải đảm bảo |

## Explain Without Notes

1. Mô tả race condition này bằng timeline 4 dòng.
2. Vì sao cờ `ignore` hoạt động? Cơ chế JavaScript nào làm nó đúng?
3. `AbortController` làm gì và **không** làm gì?
4. Vì sao thư viện server state loại bỏ vấn đề thay vì xử lý nó?
5. Ba lớp chống double-submit, và lớp nào là đảm bảo thật?

## Related

- [Effects & lifecycle](02-effects-lifecycle.md) — cleanup là cơ chế
- [Server state & cache](04-server-state-cache.md) — giải pháp theo cấu trúc
- [Promise & concurrency](../01-javascript-typescript/04-promise-concurrency.md) — nền async
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — bảo vệ phía server
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md)
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md) — cùng họ vấn đề ở các tầng khác
- [Shared state & races](../../05-cross-cutting/concurrency/02-shared-state-races.md)
