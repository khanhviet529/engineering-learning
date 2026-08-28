---
level: intermediate
area: frontend
prerequisites:
  - 01-server-client-boundary.md
related:
  - 04-rendering-strategies.md
  - 06-middleware-auth-patterns.md
---

# Routing, layout & file conventions

> App Router biến cấu trúc thư mục thành cấu trúc UI. Mỗi tên file đặc biệt là một câu trả lời cho câu hỏi "khi nào React cần một boundary ở đây?".

*Baseline: Next.js 15, App Router.*

## Position

```text
URL → route segment → layout (lồng nhau) → template? → page
                          ↑ error.tsx, loading.tsx, not-found.tsx bọc mỗi tầng
```

## Problem

Bạn cần: một sidebar không reload khi đổi trang, một skeleton khi dữ liệu đang tải, một trang lỗi cho từng vùng, và một số route không xuất hiện trong URL.

Trong Pages Router bạn tự dựng những thứ đó. Trong App Router, chúng là **file convention** — nhưng nếu không biết mỗi file làm gì, bạn sẽ có layout không reset, loading không hiện, hoặc lỗi làm trắng cả trang.

## Mental Model

```text
app/
  layout.tsx          ← root, BẮT BUỘC, chứa <html><body>
  page.tsx            ← UI cho "/"
  loading.tsx         ← = <Suspense fallback> cho segment này
  error.tsx           ← = <ErrorBoundary> cho segment này ('use client' bắt buộc)
  not-found.tsx       ← UI cho notFound()
  template.tsx        ← như layout nhưng MOUNT LẠI mỗi navigation
  dashboard/
    layout.tsx        ← lồng trong root layout; KHÔNG reload khi đổi trang con
    page.tsx          ← "/dashboard"
    tasks/
      page.tsx        ← "/dashboard/tasks"
      [id]/
        page.tsx      ← "/dashboard/tasks/123"
```

Cây file **là** cây React:

```text
<RootLayout>
  <ErrorBoundary fallback={error.tsx}>
    <Suspense fallback={loading.tsx}>
      <DashboardLayout>
        <Page />
      </DashboardLayout>
    </Suspense>
  </ErrorBoundary>
</RootLayout>
```

Hiểu điều này giải thích mọi behavior: `loading.tsx` là `Suspense`, nên nó chỉ hiện khi có gì đó suspend. `error.tsx` là ErrorBoundary, nên nó **không** bắt lỗi trong event handler.

### `layout` vs `template`

```text
layout   → giữ state, KHÔNG mount lại khi navigate giữa các route con
template → mount lại mỗi navigation
```

Đây là phân biệt hay bị bỏ. `layout` giữ state là tính năng (sidebar không mất scroll position, nhạc không dừng). Nhưng nếu bạn cần một animation vào trang, hoặc reset một form mỗi lần đổi route, bạn cần `template`.

## How It Works

### Route group và dynamic segment

```text
app/
  (marketing)/          ← group: KHÔNG xuất hiện trong URL
    layout.tsx          ← layout riêng cho marketing
    about/page.tsx      → /about
  (app)/
    layout.tsx          ← layout riêng có sidebar
    dashboard/page.tsx  → /dashboard

  blog/[slug]/page.tsx        → /blog/hello        params.slug = 'hello'
  shop/[...path]/page.tsx     → /shop/a/b/c        params.path = ['a','b','c']
  docs/[[...path]]/page.tsx   → /docs và /docs/a   params.path = undefined | ['a']
```

Route group `(name)` là công cụ quan trọng: nó cho phép **nhiều root layout khác nhau** (marketing vs app) mà không ảnh hưởng URL.

### Params là Promise (Next 15)

```tsx
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
}
```

Lưu ý: **đọc `searchParams` làm route thành dynamic.** Xem [Rendering strategies](04-rendering-strategies.md).

### Navigation

```tsx
import Link from 'next/link';
<Link href="/tasks" prefetch>Tasks</Link>          {/* prefetch khi vào viewport */}

// Client Component
'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const router = useRouter();
router.push('/tasks');       // thêm vào history
router.replace('/tasks');    // thay thế
router.refresh();            // fetch lại dữ liệu server, GIỮ state client
router.back();
```

`router.refresh()` là công cụ quan trọng: nó làm mới dữ liệu server mà không mất state client (không như `location.reload()`). Dùng nó sau một mutation từ client.

### Error, loading, not-found

```tsx
// app/dashboard/error.tsx — PHẢI là Client Component
'use client';
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <p>Có lỗi xảy ra.</p>
      {error.digest && <code>{error.digest}</code>}   {/* để đối chiếu log server */}
      <button onClick={reset}>Thử lại</button>
    </div>
  );
}
```

`error.digest` là hash của lỗi, cũng được ghi ở server log — nó cho phép người dùng báo một mã và bạn tìm được stack trace thật. Message thật **không** được gửi xuống client ở production (để không lộ thông tin).

```tsx
// app/dashboard/loading.tsx — tự động thành Suspense fallback
export default function Loading() { return <Skeleton />; }
```

```tsx
// Trong page
import { notFound } from 'next/navigation';
const task = await getTask(id);
if (!task) notFound();          // render not-found.tsx gần nhất
```

`error.tsx` **không** bắt lỗi trong root layout — cần `global-error.tsx` cho điều đó (và nó phải tự render `<html><body>`).

### Parallel & intercepting routes

```text
app/dashboard/
  @analytics/page.tsx     ← slot, nhận vào layout làm prop
  @team/page.tsx
  layout.tsx              ← function Layout({ children, analytics, team })

app/feed/
  @modal/(.)photo/[id]/page.tsx   ← intercept: /photo/1 hiện dưới dạng modal trên feed
```

Intercepting route giải quyết một vấn đề thật: click ảnh trong feed mở modal, nhưng URL vẫn chia sẻ được và F5 mở trang đầy đủ. Đây là tính năng phức tạp — chỉ dùng khi cần đúng behavior đó.

## Example

```text
app/
  (auth)/
    layout.tsx              ← layout tối giản, không sidebar
    login/page.tsx          → /login
  (app)/
    layout.tsx              ← có sidebar + header (giữ state khi đổi trang)
    loading.tsx             ← skeleton chung
    error.tsx               ← boundary chung
    dashboard/page.tsx      → /dashboard
    tasks/
      page.tsx              → /tasks
      loading.tsx           ← skeleton riêng cho tasks
      [id]/
        page.tsx            → /tasks/123
        error.tsx           ← lỗi ở một task không phá cả trang tasks
```

Cấu trúc này cho: hai layout khác nhau không ảnh hưởng URL, degradation theo từng tầng, và sidebar không mount lại khi điều hướng.

## Prediction

1. Navigate `/dashboard` → `/dashboard/tasks`. `dashboard/layout.tsx` có mount lại không? State của nó?
2. Đổi `layout.tsx` thành `template.tsx` — câu trả lời đổi thế nào?
3. `loading.tsx` có sẵn nhưng page không `await` gì — skeleton có hiện?
4. Lỗi trong `onClick` của một Client Component — `error.tsx` có bắt?
5. Lỗi trong root `layout.tsx` — `error.tsx` cùng cấp có bắt?
6. Đọc `searchParams` trong page — route static hay dynamic?
7. `router.refresh()` — state của Client Component có mất?

<details>
<summary>Đáp án</summary>

1. Không mount lại; state được giữ.
2. `template.tsx` mount lại → state mất.
3. Không — `loading.tsx` là Suspense fallback, chỉ hiện khi có suspend.
4. Không — ErrorBoundary không bắt lỗi handler.
5. Không — cần `global-error.tsx`.
6. Dynamic.
7. Không mất — đó là điểm khác với `location.reload()`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt state trong layout, navigate giữa route con | State giữ nguyên |
| Đổi sang `template.tsx` | State reset mỗi navigation |
| `throw new Error()` trong page | `error.tsx` gần nhất hiện |
| `throw` trong `onClick` | Không có gì; chỉ console |
| Xoá `error.tsx`, gây lỗi | Lỗi lan lên tầng trên; có thể mất cả layout |
| `loading.tsx` với page không async | Không hiện |
| Thêm `await sleep(2000)` vào page | Skeleton hiện 2 giây |
| Đọc `searchParams`, chạy `next build` | Route đổi từ `○` sang `ƒ` |
| Route group `(x)` | URL không đổi; kiểm tra bằng `next build` |
| Bỏ `prefetch` trên `Link` với route chậm | Navigation cảm giác chậm hơn rõ rệt |

## What Usually Goes Wrong

- **Không có `error.tsx`** ở tầng hợp lý → một lỗi làm mất cả vùng UI lớn.
- **Trông chờ `error.tsx` bắt lỗi handler** → lỗi mutation biến mất im lặng.
- **Đặt state cần reset trong `layout`** → không reset khi đổi route.
- **`loading.tsx` không hiện** vì page không suspend (dữ liệu đã cache hoặc không async).
- **`searchParams` làm route dynamic** ngoài ý muốn.
- **Quên `'use client'` trong `error.tsx`** → build error.
- **Không dùng route group** → nhồi mọi thứ vào một layout với `if` điều kiện.
- **Dùng `location.reload()`** thay `router.refresh()` → mất state client, chậm hơn nhiều.
- **Lạm dụng parallel/intercepting routes** khi một modal thường là đủ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `loading.tsx` là "trang loading" | Là `Suspense` fallback — chỉ hiện khi có suspend |
| `error.tsx` bắt mọi lỗi | Chỉ lỗi render; không bắt handler, không bắt lỗi root layout |
| `layout` mount lại mỗi navigation | Không — đó là `template` |
| Route group ảnh hưởng URL | Không |
| `params` là object thường (Next 15) | Là Promise, phải `await` |
| `router.refresh()` như F5 | Nó fetch lại dữ liệu server nhưng giữ state client |
| Cần một `error.tsx` là đủ | Nhiều tầng cho degradation tốt hơn |

## Debugging

1. **Layout mount lại không mong đợi** → kiểm tra là `layout` hay `template`; kiểm tra `key` ở đâu đó trong cây.
2. **`loading.tsx` không hiện** → page có `await` gì không? Dữ liệu đã cache? Thêm `await sleep()` tạm để xác nhận file có được nhận.
3. **Lỗi không được bắt** → phân loại: lỗi render (`error.tsx`) hay lỗi handler (`try/catch`/`onError`)?
4. **Route dynamic ngoài ý muốn** → `next build` output; tìm `searchParams`, `cookies()`, `headers()`.
5. **URL không như mong đợi** → kiểm tra route group `(x)` và dynamic segment.
6. **Navigation chậm** → xem `prefetch`; và xem page có `await` gì chậm mà không có `Suspense`.

## Production Considerations

- **`error.tsx` ở mọi tầng có ý nghĩa** — ít nhất ở root và ở mỗi vùng chức năng chính.
- **Log `error.digest`** ở server và hiện nó cho người dùng để đối chiếu.
- **`loading.tsx` cho mọi route có fetch chậm** — không có nó, navigation cảm giác treo.
- **Route group để tách layout** (auth / app / marketing) thay vì điều kiện trong một layout.
- **`generateMetadata`** cho SEO ở page động. Xem [Metadata & images](07-metadata-images-assets.md).
- Cân nhắc `not-found.tsx` ở tầng hợp lý — `notFound()` ở page con nên hiện trong layout của vùng đó, không phải trang 404 toàn cục.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `layout` | giữ state, không mount lại | không reset khi cần |
| `template` | reset mỗi navigation | mất state, mount lại tốn hơn |
| Nhiều `error.tsx` | degradation tốt | nhiều file fallback phải bảo trì |
| `loading.tsx` chi tiết | UX tốt, không nhảy layout | phải bảo trì song song với UI |
| Parallel/intercepting routes | UX modal + URL chia sẻ được | phức tạp cao, khó debug |
| `prefetch` | navigation tức thì | tải trước dữ liệu có thể không dùng |

## Explain Without Notes

1. Vẽ cây React tương ứng với `layout.tsx`, `error.tsx`, `loading.tsx`, `page.tsx`.
2. `layout` khác `template` ở đâu, và khi nào cần `template`?
3. Vì sao `loading.tsx` có thể không hiện?
4. `error.tsx` **không** bắt được hai loại lỗi nào?
5. Route group `(x)` dùng để làm gì?

## Related

- [Server/Client boundary](01-server-client-boundary.md) — `error.tsx` phải là client
- [Rendering strategies](04-rendering-strategies.md) — `loading.tsx` và streaming
- [Data fetching & cache](03-data-fetching-cache.md) — Router Cache và navigation
- [Middleware & auth patterns](06-middleware-auth-patterns.md) — bảo vệ route
- [Metadata, images & assets](07-metadata-images-assets.md) — SEO theo route
- [Error boundaries & Suspense](../../02-react/behavior/09-error-boundaries-suspense.md) — cơ chế React bên dưới
