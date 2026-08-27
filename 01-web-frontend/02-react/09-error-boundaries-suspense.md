---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
  - 02-effects-lifecycle.md
related:
  - ../01-javascript-typescript/09-error-handling-immutability.md
  - ../03-nextjs/04-rendering-strategies.md
---

# Error boundaries & Suspense

> Một lỗi trong một component nhỏ làm trắng cả trang. Đó là mặc định của React, và nó là lựa chọn có chủ đích — nhưng bạn phải đặt ranh giới để nó không xảy ra.

## Position

```text
Component tree
 └── ErrorBoundary   ← bắt lỗi RENDER của cây con
      └── Suspense   ← bắt trạng thái CHỜ của cây con
           └── Component
```

## Problem

Một `undefined` trong một component:

```tsx
function TaskRow({ task }: { task: Task }) {
  return <div>{task.assignee.name}</div>;   // assignee là null với task chưa assign
}
```

Kết quả: React unmount **toàn bộ** cây và người dùng thấy trang trắng. Không phải chỉ dòng đó biến mất — cả app.

React làm vậy có lý: nếu render thất bại, tiếp tục hiển thị một UI dở dang có thể tệ hơn (hiển thị dữ liệu sai, cho phép thao tác trên trạng thái không hợp lệ). Nhưng "trang trắng" không phải lựa chọn tốt cho người dùng — nên cần một ranh giới.

## Mental Model

```text
ErrorBoundary  = try/catch cho RENDER của một nhánh cây
Suspense       = "await" cho một nhánh cây (hiện fallback trong lúc chờ)
```

Cả hai là **ranh giới theo cây component**, không theo thời gian. Câu hỏi thiết kế:

> **Nếu phần này lỗi (hoặc chưa xong), phần nào của UI vẫn phải dùng được?**

Trả lời câu đó cho bạn vị trí đặt boundary.

```text
❌ Một boundary ở root       → lỗi ở đâu cũng mất cả trang
✅ Boundary theo vùng chức năng → lỗi ở chart, sidebar vẫn dùng được
```

### Error boundary bắt gì và **không** bắt gì

| Loại lỗi | Bắt được? |
|---|---|
| Lỗi trong render | **Có** |
| Lỗi trong constructor / lifecycle | **Có** |
| Lỗi trong effect (đồng bộ) | Có |
| Lỗi trong **event handler** | **Không** |
| Lỗi trong `setTimeout`, `Promise.then` | **Không** |
| Lỗi trong async function không await | **Không** |
| Lỗi ở server (SSR) | Không (cần xử lý riêng) |

Hàng thứ 5 là điều bất ngờ và quan trọng nhất: **lỗi trong `onClick` không được error boundary bắt.** Lý do: lúc đó React không đang render, nên không có cây nào để thay thế.

Hệ quả: bạn cần **hai** cơ chế:

```text
Lỗi render         → ErrorBoundary
Lỗi trong handler / mutation → try/catch hoặc onError của mutation → state lỗi → hiển thị
```

Đây là lý do một app chỉ có ErrorBoundary vẫn có lỗi bị mất im lặng.

## How It Works

### Error boundary

Chỉ class component làm được (không có hook tương đương):

```tsx
class ErrorBoundary extends React.Component<
  { fallback: (e: Error, reset: () => void) => ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };                        // đổi state → render fallback
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });   // gửi về Sentry
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}
```

Thực tế nên dùng `react-error-boundary` — nó có `useErrorBoundary` để ném lỗi async vào boundary, và `resetKeys` để tự reset.

**Reset là phần hay bị bỏ:** không có cách reset, người dùng bị kẹt ở fallback cho đến khi F5. Reset khi người dùng điều hướng hoặc bấm "Thử lại".

### Suspense

```tsx
<Suspense fallback={<Skeleton />}>
  <SlowComponent />        {/* lazy, hoặc đang chờ dữ liệu */}
</Suspense>
```

Suspense hoạt động với:

- `React.lazy()` — code splitting;
- Server Components đang chờ dữ liệu (Next.js App Router);
- `use()` của React 19;
- thư viện có tích hợp Suspense (TanStack Query với `useSuspenseQuery`).

Suspense **không** hoạt động với `useEffect` + `fetch` thủ công. Không có cách nào để React biết component đó đang chờ.

### Đặt boundary ở đâu

```tsx
function Dashboard() {
  return (
    <Layout>
      {/* Mỗi vùng độc lập: lỗi hoặc chậm ở một vùng không ảnh hưởng vùng khác */}
      <ErrorBoundary fallback={(e, reset) => <WidgetError onRetry={reset} />}>
        <Suspense fallback={<ChartSkeleton />}>
          <RevenueChart />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={() => <WidgetError />}>
        <Suspense fallback={<ListSkeleton />}>
          <TaskList />
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
```

Nếu `RevenueChart` lỗi, `TaskList` vẫn hoạt động và navigation vẫn dùng được. Đây là [graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) ở tầng UI.

### Streaming SSR

Trong Next.js App Router, `Suspense` cho phép server gửi HTML **theo từng phần**: shell đi trước, phần chậm đi sau khi xong.

```tsx
export default function Page() {
  return (
    <>
      <Header />                              {/* gửi ngay */}
      <Suspense fallback={<Skeleton />}>
        <SlowData />                          {/* gửi sau, cùng response */}
      </Suspense>
    </>
  );
}
```

Không có `Suspense`, cả trang phải chờ query chậm nhất. Xem [Rendering strategies](../03-nextjs/04-rendering-strategies.md).

## Example

```tsx
// Lỗi trong handler — ErrorBoundary KHÔNG bắt, phải tự xử lý
function DeleteButton({ id }: { id: string }) {
  const [error, setError] = useState<Error | null>(null);

  const onClick = async () => {
    try {
      await api.delete(id);
    } catch (e) {
      setError(e as Error);          // ← không có dòng này, lỗi biến mất
    }
  };

  return (
    <>
      <button onClick={onClick}>Delete</button>
      {error && <Toast>{error.message}</Toast>}
    </>
  );
}
```

Với thư viện mutation thì `onError` làm việc này, và đó là lý do nên dùng nó thay vì `try/catch` rải rác.

## Prediction

1. Lỗi trong render của một component nhỏ, không có boundary — người dùng thấy gì?
2. Lỗi trong `onClick` — ErrorBoundary có bắt không? Người dùng thấy gì?
3. Lỗi trong `setTimeout(() => { throw new Error() })` — bắt được không?
4. `Suspense` bọc component fetch bằng `useEffect` — fallback có hiện không?
5. ErrorBoundary không có cách reset, người dùng điều hướng sang trang khác — fallback còn hiện?
6. Trong Next.js, `Suspense` bọc một query 3 giây — người dùng thấy gì ở giây thứ 1?

<details>
<summary>Đáp án</summary>

1. Trang trắng — cả cây bị unmount.
2. Không bắt. Không có gì xảy ra trên UI; lỗi chỉ vào console (và mất nếu không có global handler).
3. Không.
4. Không — Suspense không biết component đang chờ.
5. Có, nếu boundary không được reset và không bị unmount — người dùng kẹt ở fallback.
6. Shell + skeleton (nếu streaming), rồi nội dung thật khi xong.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `throw new Error()` trong render, không boundary | Trang trắng |
| Thêm boundary quanh component đó | Chỉ vùng đó hiện fallback |
| `throw` trong `onClick` | Boundary im lặng; chỉ có console |
| `throw` trong `setTimeout` | Không bắt được; cần `window.onerror` |
| Boundary không có reset, gây lỗi rồi điều hướng | Kẹt ở fallback |
| Một boundary duy nhất ở root, gây lỗi ở widget nhỏ | Mất cả app vì một widget |
| `Suspense` với `useEffect` fetch | Không có fallback; component tự quản loading |
| Bỏ `Suspense` trong Next.js với query chậm | TTFB tăng bằng query chậm nhất |

## What Usually Goes Wrong

- **Không có boundary nào** → một lỗi làm trắng app.
- **Chỉ có một boundary ở root** → không có degradation.
- **Không xử lý lỗi trong handler** → lỗi mất im lặng, người dùng bấm nút và không có gì xảy ra.
- **Không có cách reset** → người dùng kẹt.
- **Fallback không đủ thông tin** — "Something went wrong" không giúp gì; cần cách thử lại và một mã lỗi để đối chiếu log.
- **Không báo lỗi về monitoring** trong `componentDidCatch` → không biết người dùng đang gặp lỗi.
- **Fallback có layout khác hẳn** → nhảy layout khi chuyển từ fallback sang nội dung (CLS).
- **Quá nhiều Suspense boundary nhỏ** → nhiều skeleton nhấp nháy rời rạc, cảm giác giật.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| ErrorBoundary bắt mọi lỗi | Chỉ lỗi trong render/lifecycle; không bắt handler và async |
| Suspense là cho data fetching bất kỳ | Chỉ với nguồn có tích hợp Suspense |
| Suspense thay thế loading state | Với fetch thủ công thì không |
| Một boundary ở root là đủ | Mất khả năng degradation |
| Boundary tự reset | Phải tự làm |
| Trang trắng là bug của React | Là behavior có chủ đích — thiếu boundary là thiếu sót của bạn |
| Nhiều Suspense luôn tốt hơn | Quá nhiều gây nhấp nháy rời rạc |

## Debugging

1. **Trang trắng** → mở console, tìm lỗi render đầu tiên. React ghi cả **component stack** — nó chỉ đúng component gây lỗi.
2. **Người dùng báo "bấm nút không có gì xảy ra"** → gần như luôn là lỗi trong handler không được catch. Kiểm tra `onError` của mutation.
3. **Lỗi trong production không rõ nguyên nhân** → cần source map và `componentStack` gửi về monitoring; không có chúng thì stack vô nghĩa.
4. Thêm global handler để không mất lỗi async:
   ```ts
   window.addEventListener('error', report);
   window.addEventListener('unhandledrejection', report);
   ```
5. **Fallback hiện mãi** → boundary chưa reset; kiểm tra `resetKeys` hoặc reset khi route đổi.
6. React DevTools cho thấy boundary nào đang ở trạng thái lỗi.

## Production Considerations

- **Boundary theo vùng chức năng**: mỗi widget/panel/route segment một boundary. Navigation và layout nên nằm ngoài mọi boundary.
- **Gửi lỗi về monitoring** với `componentStack`, release version và source map.
- **Fallback phải có hành động**: nút "Thử lại", và một mã lỗi/`requestId` để người dùng báo lại.
- **Reset boundary khi route đổi** — nếu không, người dùng kẹt sau một lỗi.
- **Global handler** cho lỗi async, để không mất chúng.
- Trong Next.js, `error.tsx` và `loading.tsx` của App Router chính là ErrorBoundary và Suspense được đặt tự động theo route segment. Xem [Routing & layout](../03-nextjs/02-routing-layout-rendering.md).
- Cân bằng số Suspense boundary: gộp những phần load cùng lúc để tránh nhấp nháy.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều boundary nhỏ | degradation tốt | nhiều code, nhiều fallback phải thiết kế |
| Một boundary lớn | đơn giản | mất nhiều UI khi có lỗi |
| Suspense + streaming | thấy nội dung sớm | phức tạp hơn, cần thiết kế fallback |
| Fallback chi tiết (skeleton giống thật) | không nhảy layout | phải bảo trì song song với UI |
| Fallback đơn giản (spinner) | dễ bảo trì | CLS, cảm giác chậm hơn |

## Explain Without Notes

1. ErrorBoundary bắt loại lỗi nào và **không** bắt loại nào? Vì sao?
2. Câu hỏi thiết kế để quyết định đặt boundary ở đâu?
3. Vì sao cần cả ErrorBoundary và try/catch trong handler?
4. Suspense hoạt động với nguồn dữ liệu nào, không hoạt động với nguồn nào?
5. Vì sao reset boundary là bắt buộc?

## Related

- [Error handling & immutability](../01-javascript-typescript/09-error-handling-immutability.md) — phân loại lỗi
- [Server state & cache](04-server-state-cache.md) — `onError` của mutation
- [Rendering strategies (Next.js)](../03-nextjs/04-rendering-strategies.md) — streaming với Suspense
- [Routing & layout](../03-nextjs/02-routing-layout-rendering.md) — `error.tsx`, `loading.tsx`
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — cùng nguyên lý ở tầng hệ thống
