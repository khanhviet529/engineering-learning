---
level: foundation
area: frontend
prerequisites:
  - ../../02-react/fundamentals/01-components-and-rendering-model.md
related:
  - ../behavior/01-server-client-boundary.md
  - 02-nextjs-16-changes.md
---

# Next.js foundations: cấu trúc thư mục và từ vựng routing

> Một người mới nhận dự án Next.js, mở `app/` và thấy: `(marketing)/`, `@modal/`, `[[...slug]]/`, `_components/`, `default.tsx`, `template.tsx`. Không có file nào trong đó là code họ viết được — chúng là **quy ước**, và quy ước không đoán được. Hai ngày đầu tiên trôi qua chỉ để hiểu thư mục nào tạo ra URL nào.

## Position

```text
Next.js = React + một tập QUY ƯỚC THƯ MỤC + runtime server.

  quy ước file (note này)
        ↓
  server/client boundary (01)
        ↓
  data fetching & caching (03, 09)
        ↓
  rendering & production (04, 08)
```

## Problem

```text
Trong React thuần, cấu trúc thư mục là tuỳ bạn.
Trong Next.js App Router, THƯ MỤC LÀ API:

  tên thư mục   → quyết định URL
  tên file      → quyết định vai trò (page? layout? handler?)
  ký tự đặc biệt → đổi hoàn toàn ngữ nghĩa: (), [], [[]], @, _

⇒ không đọc được quy ước = không đọc được ứng dụng.
⇒ và đây là kiến thức thuần ghi nhớ — không suy ra được từ nguyên lý.
```

## Mental Model

### Thư mục tạo URL, file tạo vai trò

```text
app/
├── layout.tsx              → layout GỐC (bắt buộc, phải có <html> và <body>)
├── page.tsx                → URL: /
├── loading.tsx             → fallback Suspense cho segment này và con
├── error.tsx               → error boundary cho segment này và con
├── not-found.tsx           → UI khi notFound() được gọi
└── dashboard/
    ├── layout.tsx          → layout lồng, bọc mọi trang trong dashboard
    ├── page.tsx            → URL: /dashboard
    └── settings/
        └── page.tsx        → URL: /dashboard/settings
```

```text
Quy tắc gốc: chỉ `page.tsx` và `route.ts` tạo ra URL truy cập được.
Thư mục không có `page.tsx` chỉ là nhóm cấu trúc — không có URL.
```

### Bảng file đặc biệt

| File | Vai trò | Ghi chú quan trọng |
|---|---|---|
| `page.tsx` | UI của một route, tạo URL | thiếu nó → thư mục không có URL |
| `layout.tsx` | UI bọc quanh, **giữ state khi điều hướng** giữa các route con | không render lại khi đổi route con |
| `template.tsx` | như layout nhưng **tạo instance mới** mỗi lần điều hướng | dùng khi cần reset state/effect mỗi lần vào |
| `loading.tsx` | fallback Suspense tự động cho segment | bọc `page` bằng `<Suspense>` giúp bạn |
| `error.tsx` | error boundary (bắt buộc là Client Component) | **không** bắt lỗi của `layout.tsx` cùng cấp |
| `global-error.tsx` | error boundary cho layout gốc | phải tự render `<html>` và `<body>` |
| `not-found.tsx` | UI cho `notFound()` và URL không khớp | |
| `forbidden.tsx` | UI cho `forbidden()` | Next 15+ |
| `unauthorized.tsx` | UI cho `unauthorized()` | Next 15+ |
| `route.ts` | API endpoint (GET/POST/…) | **không** cùng thư mục với `page.tsx` |
| `default.tsx` | fallback cho parallel route slot | Next 16: **bắt buộc** cho mọi slot |
| `proxy.ts` | chặn request trước khi vào route | Next 16 đổi tên từ `middleware.ts` |
| `instrumentation.ts` | chạy một lần khi server khởi động | nơi đặt OpenTelemetry |

```text
Điểm hay sai nhất trong bảng trên:
  `error.tsx` KHÔNG bắt lỗi của `layout.tsx` CÙNG CẤP.
  Lý do: error boundary được render BÊN TRONG layout đó.
  → lỗi trong layout gốc cần `global-error.tsx`.
```

### Layout và template: khác nhau ở state

```text
LAYOUT    /dashboard/a → /dashboard/b
          layout KHÔNG render lại, KHÔNG mất state, effect KHÔNG chạy lại
          → dùng cho sidebar, nav, provider

TEMPLATE  cùng điều hướng đó
          template tạo instance MỚI → state reset, effect chạy lại
          → dùng cho animation vào trang, logging mỗi lần xem trang
```

Nếu bạn thấy state trong layout không reset khi đổi trang và bạn **muốn** nó reset — đó là lúc dùng `template.tsx`.

### Ký tự đặc biệt trong tên thư mục

```text
[id]            DYNAMIC SEGMENT — khớp đúng một đoạn
                app/blog/[slug]/page.tsx     → /blog/hello
                params: { slug: 'hello' }

[...slug]       CATCH-ALL — khớp một hoặc nhiều đoạn
                app/docs/[...slug]/page.tsx  → /docs/a/b/c
                params: { slug: ['a','b','c'] }
                ⚠ KHÔNG khớp /docs

[[...slug]]     OPTIONAL CATCH-ALL — khớp cả khi KHÔNG có đoạn nào
                app/docs/[[...slug]]/page.tsx → /docs  VÀ  /docs/a/b
                params: { slug: undefined } hoặc { slug: ['a','b'] }

(group)         ROUTE GROUP — nhóm để dùng chung layout, KHÔNG vào URL
                app/(marketing)/about/page.tsx → /about
                → dùng để có nhiều layout gốc khác nhau

@slot           PARALLEL ROUTE — render nhiều page cùng lúc trong một layout
                app/@team/page.tsx + app/@analytics/page.tsx
                → layout nhận chúng làm PROPS

(.)folder       INTERCEPTING ROUTE — chặn điều hướng, render trong layout hiện tại
                (.) cùng cấp · (..) lên một cấp · (...) từ gốc app
                → dùng cho modal giữ được URL chia sẻ

_folder         PRIVATE FOLDER — bị loại khỏi routing hoàn toàn
                app/_components/  → không tạo URL nào
```

### Parallel routes: nhiều page trong một layout

```text
app/
├── layout.tsx          ← nhận `children`, `team`, `analytics` làm PROPS
├── page.tsx            ← đi vào prop `children`
├── @team/
│   ├── page.tsx
│   └── default.tsx     ← BẮT BUỘC ở Next 16
└── @analytics/
    ├── page.tsx
    └── default.tsx
```

```tsx
export default function Layout({
  children, team, analytics,
}: {
  children: React.ReactNode; team: React.ReactNode; analytics: React.ReactNode;
}) {
  return <><nav />{children}<aside>{team}{analytics}</aside></>;
}
```

```text
Dùng khi: dashboard có nhiều vùng độc lập, mỗi vùng có loading/error riêng
          và điều hướng độc lập.

`default.tsx` trả lời câu: "khi URL hiện tại không khớp slot này thì render gì?"
Next 16 làm nó BẮT BUỘC — thiếu thì build fail.
Muốn giữ hành vi cũ: `default.tsx` trả `null` hoặc gọi `notFound()`.
```

### Điều hướng: API nào ở đâu

```text
SERVER COMPONENT           CLIENT COMPONENT
  redirect()                 useRouter()   → push, replace, refresh, back
  notFound()                 usePathname() → đường dẫn hiện tại
  forbidden()                useSearchParams() → query string
  unauthorized()             useParams()   → params động
  await cookies()            <Link href>   → điều hướng có prefetch
  await headers()
```

```text
Hai bẫy thường gặp:

① `useSearchParams()` làm component đó phải render động (client).
   Bọc nó trong `<Suspense>` nếu không muốn cả trang mất khả năng prerender.

② `redirect()` hoạt động bằng cách NÉM một lỗi đặc biệt.
   Gọi nó trong `try/catch` sẽ bị catch nuốt mất → redirect không xảy ra.
```

### `<Link>` khác thẻ `<a>`

```text
<a href>     tải lại toàn bộ trang, mất toàn bộ state client
<Link href>  điều hướng phía client, giữ state của layout, có prefetch

Prefetch: Next tải trước dữ liệu route khi Link vào viewport (production).
Next 16 viết lại cơ chế này: layout dùng chung chỉ tải MỘT lần,
và chỉ tải phần chưa có trong cache.
```

### `public/` và `src/`

```text
public/         file tĩnh phục vụ nguyên trạng tại gốc URL
                public/logo.png → /logo.png
                ⚠ mọi thứ ở đây là CÔNG KHAI

src/            tuỳ chọn — đặt `app/` vào `src/app/`
                không đổi ngữ nghĩa gì, chỉ tách code khỏi file cấu hình gốc
```

## How It Works

### Từ URL tới cây component

```text
GET /dashboard/settings

① proxy.ts chạy (nếu có) — có thể rewrite/redirect/chặn
② Next khớp thư mục: app/dashboard/settings/
③ dựng cây từ NGOÀI VÀO TRONG:
     app/layout.tsx
       └─ app/dashboard/layout.tsx
            └─ <Suspense fallback={app/dashboard/loading.tsx}>
                 └─ <ErrorBoundary fallback={app/dashboard/error.tsx}>
                      └─ app/dashboard/settings/page.tsx
④ Server Component chạy trên server → sinh HTML + payload RSC
⑤ HTML stream về, Client Component được hydrate
```

```text
Chú ý bước ③: `loading.tsx` và `error.tsx` được Next TỰ ĐỘNG bọc quanh.
Bạn không viết `<Suspense>` — đặt file đúng chỗ là đủ.
Và vì boundary nằm BÊN TRONG layout, lỗi của layout không bị nó bắt.
```

### `params` và `searchParams` là Promise

```tsx
// Next 15+: BẮT BUỘC await
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  return <Search slug={slug} query={q} />;
}
```

```text
Truy cập đồng bộ đã bị loại bỏ ở Next 16.
Cùng thay đổi đó áp dụng cho `cookies()`, `headers()`, `draftMode()`.
Lý do: cho phép Next bắt đầu render trước khi biết giá trị request.
```

## Example

Một cấu trúc thực tế, đọc được bằng bảng ở trên:

```text
src/app/
├── layout.tsx                     → layout gốc: <html>, <body>, provider
├── global-error.tsx               → bắt lỗi của chính layout gốc
├── proxy.ts                       → kiểm tra session, rewrite theo tenant
│
├── (marketing)/                   → nhóm: KHÔNG vào URL
│   ├── layout.tsx                 → header/footer trang giới thiệu
│   ├── page.tsx                   → /
│   └── pricing/page.tsx           → /pricing
│
├── (app)/                         → nhóm: layout khác hoàn toàn
│   ├── layout.tsx                 → sidebar + topbar (state GIỮ khi điều hướng)
│   ├── dashboard/
│   │   ├── page.tsx               → /dashboard
│   │   ├── loading.tsx            → skeleton
│   │   ├── error.tsx              → UI lỗi (Client Component)
│   │   ├── @metrics/              → parallel: vùng số liệu
│   │   │   ├── page.tsx
│   │   │   └── default.tsx        → BẮT BUỘC (Next 16)
│   │   └── @activity/
│   │       ├── page.tsx
│   │       └── default.tsx
│   └── orders/
│       ├── page.tsx               → /orders
│       ├── [id]/page.tsx          → /orders/123
│       └── (.)[id]/page.tsx       → chặn: mở modal khi bấm từ /orders
│
├── docs/[[...slug]]/page.tsx      → /docs VÀ /docs/a/b/c
├── api/webhooks/route.ts          → POST /api/webhooks
├── _components/                   → private: không tạo URL
└── not-found.tsx                  → 404
```

```text
Đọc lại ba quyết định trong cấu trúc này:

`(marketing)` và `(app)` — hai layout gốc khác nhau cho cùng một domain,
  không phải thêm tiền tố URL. Đây là lý do route group tồn tại.

`(.)[id]` cạnh `[id]` — bấm từ danh sách thì mở modal, mở URL trực tiếp
  hoặc F5 thì ra trang đầy đủ. Cùng một URL, hai cách render.

`_components` — không có ký tự này, Next sẽ cố tạo route từ thư mục đó.
```

## Prediction

1. Thư mục `app/blog/` chỉ có `layout.tsx`, không có `page.tsx` — `/blog` trả về gì?
2. `app/(shop)/cart/page.tsx` — URL là gì?
3. `app/docs/[...slug]/page.tsx` — `/docs` có khớp không?
4. `app/docs/[[...slug]]/page.tsx` — `/docs` có khớp không?
5. Điều hướng từ `/dashboard/a` sang `/dashboard/b`, state trong `layout.tsx` của dashboard — có mất không?
6. Cùng vậy nhưng dùng `template.tsx` — có mất không?
7. Lỗi ném ra trong `app/dashboard/layout.tsx` — `app/dashboard/error.tsx` có bắt được không?
8. Lỗi ném ra trong `app/dashboard/page.tsx` — có bắt được không?
9. Parallel route slot thiếu `default.tsx` ở Next 16 — chuyện gì xảy ra?
10. `redirect()` gọi bên trong `try { } catch { }` — redirect có xảy ra không?
11. Dùng `useSearchParams()` mà không bọc `<Suspense>` — ảnh hưởng gì tới prerender?
12. Đặt `page.tsx` và `route.ts` trong cùng một thư mục — kết quả?
13. `app/_components/button.tsx` — có tạo URL `/\_components/button` không?
14. Truy cập `params.slug` không `await` ở Next 16 — kết quả?

<details>
<summary>Đáp án</summary>

1. **404** — chỉ `page.tsx` tạo URL truy cập được.
2. **`/cart`** — route group không vào URL.
3. **Không** — catch-all cần ít nhất một đoạn.
4. **Có** — optional catch-all khớp cả khi rỗng.
5. **Không mất** — layout không render lại khi đổi route con.
6. **Mất** — template tạo instance mới mỗi lần điều hướng.
7. **Không** — error boundary nằm bên trong layout đó; cần error.tsx ở cấp cha.
8. **Có.**
9. **Build fail** — Next 16 bắt buộc `default.tsx` cho mọi slot.
10. **Không** — `redirect()` ném lỗi đặc biệt và `catch` nuốt mất nó.
11. Component đó thành dynamic; **cả cây không prerender được** nếu không có Suspense boundary.
12. **Xung đột** — không cho phép cùng một segment vừa là page vừa là route.
13. **Không** — thư mục `_` bị loại khỏi routing.
14. **Lỗi** — truy cập đồng bộ đã bị loại bỏ; phải `await`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá `page.tsx` khỏi một thư mục có `layout.tsx` | URL đó trả về gì? |
| Đổi `[slug]` thành `[...slug]` rồi truy cập URL một đoạn | Còn khớp không? |
| Bọc một thư mục bằng `(group)` | URL có đổi không? |
| Đặt state trong layout, điều hướng giữa hai route con | State có giữ không? |
| Đổi layout đó thành template | Khác thế nào? |
| Ném lỗi trong layout và trong page, so kết quả | `error.tsx` bắt cái nào? |
| Xoá `default.tsx` của một parallel slot | Build có pass không? |
| Bọc `redirect()` trong `try/catch` | Nó còn chuyển hướng không? |
| Dùng `useSearchParams()` ở trang tĩnh, chạy `next build` | Trang còn là static không? |
| Đổi `<Link>` thành `<a>` | State của layout có mất không? |

## What Usually Goes Wrong

- **Tưởng thư mục nào cũng tạo URL** — thiếu `page.tsx` là 404.
- **Tưởng route group thêm tiền tố URL.**
- **Dùng `[...slug]` khi cần khớp cả URL rỗng** → thiếu `[[...slug]]`.
- **Mong `error.tsx` bắt lỗi của layout cùng cấp.**
- **Quên `global-error.tsx`** → lỗi ở layout gốc thành trang trắng.
- **Dùng layout khi cần template** (hoặc ngược lại).
- **Thiếu `default.tsx`** cho parallel slot → build fail ở Next 16.
- **`redirect()` trong `try/catch`.**
- **`useSearchParams()` không có Suspense** → mất khả năng prerender.
- **Đặt file nội bộ trong `app/`** mà không có tiền tố `_`.
- **Truy cập `params`/`cookies()` đồng bộ** — đã bị loại bỏ.
- **Để dữ liệu nhạy cảm trong `public/`.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Mọi thư mục trong `app/` là một route | Chỉ thư mục có `page.tsx`/`route.ts` |
| Route group `(x)` thêm `/x` vào URL | Nó không vào URL |
| `layout.tsx` render lại mỗi lần điều hướng | Nó giữ nguyên và giữ state |
| `error.tsx` bắt mọi lỗi trong segment | Không bắt lỗi của layout cùng cấp |
| `[...slug]` khớp cả URL rỗng | Cần `[[...slug]]` |
| Parallel route là tính năng hiếm dùng | Nó là cách đúng cho dashboard nhiều vùng |
| `middleware.ts` vẫn là tên chuẩn | Next 16 đổi thành `proxy.ts` |
| `params` là object thường | Nó là Promise, phải `await` |
| `<a>` và `<Link>` tương đương | `<a>` tải lại trang và mất state |

## Debugging

1. **URL trả 404** → thư mục có `page.tsx` không? Có bị bọc trong thư mục `_` không?
2. **URL khác mong đợi** → có route group `()` nào trên đường dẫn không?
3. **Trang trắng khi lỗi** → lỗi ở layout gốc; cần `global-error.tsx`.
4. **State reset khi không mong muốn** → đang dùng `template.tsx`, hoặc `key` của layout đổi.
5. **State không reset khi mong muốn** → đang dùng `layout.tsx`; đổi sang `template.tsx`.
6. **Build fail với parallel route** → thiếu `default.tsx`.
7. **Trang không được prerender** → tìm `useSearchParams`, `cookies()`, `headers()` không có Suspense boundary; `next build` in ra ký hiệu static/dynamic cho từng route.
8. **Xem cây route thực tế**: output của `next build` liệt kê mọi route kèm loại rendering — đây là nguồn sự thật khi cấu trúc phức tạp.

## Explain Without Notes

1. Cái gì tạo ra URL, và cái gì chỉ là nhóm cấu trúc?
2. Sáu ký tự đặc biệt trong tên thư mục và ý nghĩa từng cái.
3. `layout.tsx` và `template.tsx` khác nhau ở điểm nào?
4. Vì sao `error.tsx` không bắt được lỗi của layout cùng cấp?
5. Ba dạng dynamic segment và cái nào khớp URL rỗng?
6. Parallel route giải quyết vấn đề gì, và `default.tsx` trả lời câu hỏi nào?
7. Vì sao `redirect()` không hoạt động trong `try/catch`?
8. Vì sao `params` và `cookies()` là async?

## Related

- [Server/Client boundary](../behavior/01-server-client-boundary.md) — `"use client"` và ranh giới serialize
- [Routing, layout & rendering](../behavior/02-routing-layout-rendering.md) — hành vi điều hướng chi tiết
- [Data fetching & cache](../behavior/03-data-fetching-cache.md) — lấy dữ liệu trong Server Component
- [Rendering strategies](../behavior/04-rendering-strategies.md) — static, dynamic, streaming
- [Route Handlers & Server Actions](../behavior/05-route-handlers-server-actions.md) — `route.ts` và mutation
- [Proxy & auth patterns](../behavior/06-middleware-auth-patterns.md) — `proxy.ts`
- [Next.js 16 & caching model](02-nextjs-16-changes.md) — thay đổi từ Next 15
- [React foundations](../../02-react/fundamentals/01-components-and-rendering-model.md) — component, element, render

## Version / Context

Next.js 16.3.3, App Router. Yêu cầu Node.js 20.9+, TypeScript 5.1+, React 19.2. `proxy.ts` thay `middleware.ts` từ Next 16 (`middleware.ts` còn dùng được cho Edge runtime nhưng đã deprecated). `default.tsx` bắt buộc cho mọi parallel slot từ Next 16. `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` bắt buộc async từ Next 15, truy cập đồng bộ bị loại bỏ ở Next 16. `forbidden.tsx`/`unauthorized.tsx` có từ Next 15. Turbopack là bundler mặc định từ Next 16.
