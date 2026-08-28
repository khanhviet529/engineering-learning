---
level: intermediate
area: frontend
prerequisites:
  - 01-app-router-structure.md
related:
  - ../behavior/03-data-fetching-cache.md
  - ../behavior/04-rendering-strategies.md
---

# Next.js 16: mô hình caching mới và những gì đã đổi

> Một dự án nâng từ Next.js 15 lên 16. Build pass, test pass, deploy thành công. Trong production, `middleware.ts` **không chạy nữa** — file vẫn ở đó, không có cảnh báo nào, và mọi kiểm tra session trong đó bị bỏ qua. Cùng lúc, `revalidateTag('posts')` ngừng có tác dụng stale-while-revalidate vì nó đã cần tham số thứ hai. **Không có lỗi nào trong hai thay đổi này — chúng chỉ im lặng làm ít hơn trước.**

## Position

```text
Các note behavior trong folder này được viết theo baseline Next.js 15.
Note này ghi lại phần ĐÃ ĐỔI ở Next 16, để bạn đọc chúng với đúng ngữ cảnh.

  Next 15  cache mặc định TẮT cho fetch, nhưng route vẫn static-hoặc-dynamic
  Next 16  Cache Components: opt-in caching + PPR là hành vi MẶC ĐỊNH
```

## Problem

```text
Next.js đổi mô hình caching ba lần trong ba bản chính:

  13/14  fetch được cache MẶC ĐỊNH → dữ liệu cũ bất ngờ
  15     fetch KHÔNG cache mặc định → chậm bất ngờ
  16     Cache Components: bạn CHỌN cái gì được cache, ở mức component

⇒ mọi bài viết, mọi câu trả lời trên diễn đàn, và mọi ký ức về Next.js
  đều gắn với một phiên bản cụ thể. Đọc mà không biết phiên bản là đoán.
```

## Mental Model

### Hai mô hình cùng tồn tại ở Next 16

```text
KHÔNG bật cacheComponents  → mô hình cũ (giống Next 15), vẫn được hỗ trợ
BẬT cacheComponents: true  → mô hình mới: PPR + "use cache"

next.config.ts
  const nextConfig = { cacheComponents: true };
```

Phần còn lại của note mô tả mô hình **mới**. Nếu dự án chưa bật cờ đó, các note behavior baseline v15 vẫn đúng.

### Cache Components: caching là opt-in, ở mức component

```text
Mặc định (khi bật cờ): MỌI dữ liệu động chạy lúc REQUEST.
Bạn chọn cái gì được cache bằng directive `"use cache"`.

  cache ở mức DỮ LIỆU  → một hàm fetch/tính toán
  cache ở mức UI       → cả một component, page, hoặc layout
```

```tsx
import { cacheLife, cacheTag } from 'next/cache';

async function BlogPosts() {
  'use cache';
  cacheLife('hours');        // tuổi thọ — nên luôn khai báo
  cacheTag('posts');         // nhãn để invalidate sau này

  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

```text
Cache key được sinh TỰ ĐỘNG từ:
  · đối số của hàm
  · mọi giá trị bắt được từ scope cha

⇒ đầu vào khác nhau → entry cache khác nhau, không cần tự đặt key.
⇒ và đây cũng là lý do giá trị truyền vào phải serialize được.
```

### PPR là hành vi mặc định

```text
Trước đây mỗi URL phải chọn: static HOẶC dynamic.
PPR bỏ ranh giới đó:

  ┌─ static shell ────────────────────────┐
  │ header, nav          ← prerender      │  ← phục vụ NGAY từ CDN
  │ <BlogPosts/>         ← "use cache"    │
  │ ┌ <Suspense> ──────────────────────┐  │
  │ │ fallback           ← prerender    │  │
  │ │ nội dung động      ← stream sau   │  │  ← chạy lúc request
  │ └──────────────────────────────────┘  │
  └───────────────────────────────────────┘
```

```text
Hệ quả quan trọng nhất cho người viết code:

  đọc `cookies()` KHÔNG còn làm CẢ ROUTE thành dynamic.
  Nó chỉ làm phần BÊN TRONG Suspense boundary đó thành dynamic.

⇒ ở Next 15, một `cookies()` ở layout gốc giết khả năng static của mọi trang.
⇒ ở Next 16 với Cache Components, phần còn lại vẫn prerender được.
```

### Quy tắc mới: dữ liệu chưa cache phải nằm trong Suspense

```tsx
export default function Page() {
  return (
    <>
      <h1>Blog</h1>                     {/* static, vào shell */}
      <BlogPosts />                     {/* "use cache", vào shell */}

      <Suspense fallback={<p>Đang tải…</p>}>
        <UserPreferences />             {/* đọc cookies() → stream lúc request */}
      </Suspense>
    </>
  );
}
```

```text
Nếu bạn đọc dữ liệu chưa cache mà KHÔNG có Suspense bao quanh,
dev overlay báo lỗi "blocking-route" và chỉ ba cách sửa:
  ① bọc `<Suspense>`   ② thêm `"use cache"`   ③ cho route opt out

Đây là thay đổi về tư duy: Next 16 BẮT BUỘC bạn nói rõ
mỗi phần dữ liệu thuộc loại nào.
```

### Đẩy `await` xuống sâu để shell lớn hơn

```tsx
// ✗ await params ở layout → cả layout không prerender được
export default async function Layout({ params, children }) {
  const { slug } = await params;
  return <div><Sidebar /><h1>{slug}</h1>{children}</div>;
}

// ✓ await bên trong Suspense → Sidebar và children vẫn vào shell
export default function Layout({ params, children }) {
  return (
    <div>
      <Sidebar />
      <Suspense fallback={<h1>Đang tải…</h1>}>
        {params.then(({ slug }) => <h1>{slug}</h1>)}
      </Suspense>
      {children}
    </div>
  );
}
```

Nguyên tắc chung: **async work càng nằm sâu trong cây, phần prerender được càng lớn.**

### Ba API invalidate, ba ngữ nghĩa khác nhau

```ts
// ① revalidateTag(tag, profile) — SWR, cho nội dung chấp nhận trễ
revalidateTag('posts', 'max');        // tham số thứ hai giờ BẮT BUỘC
revalidateTag('products', { expire: 3600 });
// revalidateTag('posts')             ← dạng một tham số đã DEPRECATED

// ② updateTag(tag) — chỉ trong Server Action, read-your-writes
'use server';
export async function updateProfile(id: string, data: Profile) {
  await db.users.update(id, data);
  updateTag(`user-${id}`);            // người dùng thấy thay đổi NGAY
}

// ③ refresh() — chỉ trong Server Action, làm mới dữ liệu CHƯA cache
refresh();                            // không đụng cache
```

```text
Chọn cái nào:
  người dùng vừa sửa và cần thấy ngay   → updateTag
  nội dung chung, chấp nhận trễ vài giây → revalidateTag(tag, 'max')
  chỉ cần vẽ lại phần động (badge, đếm)  → refresh
```

### `middleware.ts` → `proxy.ts`

```ts
// proxy.ts — chạy trên Node.js runtime
import { NextResponse, type NextRequest } from 'next/server';

export default function proxy(request: NextRequest) {
  if (!request.cookies.get('session')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}
```

```text
Việc phải làm: đổi tên file `middleware.ts` → `proxy.ts`
                và đổi tên hàm export → `proxy`. Logic giữ nguyên.

⚠ `middleware.ts` vẫn còn dùng được cho Edge runtime nhưng đã DEPRECATED
  và sẽ bị bỏ. Đây là loại thay đổi im lặng — nếu bạn đổi tên hàm
  mà quên đổi tên file (hoặc ngược lại), không có gì báo.
```

### Danh sách thay đổi phá vỡ

```text
YÊU CẦU PHIÊN BẢN
  Node.js 20.9+ (Node 18 không còn hỗ trợ) · TypeScript 5.1+ · React 19.2

BẮT BUỘC ASYNC — truy cập đồng bộ đã bị LOẠI BỎ
  await params · await searchParams · await cookies()
  · await headers() · await draftMode()

ĐÃ XOÁ
  `next lint`              → dùng ESLint/Biome trực tiếp
  `experimental.ppr`       → thay bằng cacheComponents
  `experimental.dynamicIO` → đổi tên thành cacheComponents
  AMP · serverRuntimeConfig · publicRuntimeConfig

ĐỔI HÀNH VI
  Turbopack là bundler MẶC ĐỊNH (`next build --webpack` để quay lại)
  parallel route slot BẮT BUỘC có `default.js` — thiếu thì build fail
  `images.qualities` mặc định [75] thay vì [1..100]
  `images.minimumCacheTTL` 60s → 4 giờ
  `revalidateTag()` cần tham số thứ hai
```

### Bots và crawler được xử lý khác

```text
Trình duyệt      nhận static shell ngay, phần động stream về sau
Bot/crawler      Next PHÁT HIỆN qua user agent → render TOÀN BỘ động
                 rồi gửi HTML hoàn chỉnh một lần

⇒ hệ quả dễ bỏ sót: phần shell của bạn giờ chạy lúc REQUEST cho bot.
  Nếu shell phụ thuộc dữ liệu chỉ có lúc build, trang load được cho người
  nhưng LỖI cho crawler.
```

## Example

Một trang, ba loại nội dung, đọc được mức cache của từng phần:

```tsx
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { cacheLife, cacheTag } from 'next/cache';

export default function ProductPage({ params }: PageProps<'/products/[id]'>) {
  return (
    <>
      <SiteHeader />                                {/* ① static → shell */}

      <Suspense fallback={<ProductSkeleton />}>
        {params.then(({ id }) => <ProductDetail id={id} />)}
      </Suspense>                                    {/* ② cached theo id */}

      <Suspense fallback={<p>Đang tải giỏ hàng…</p>}>
        <CartWidget />                               {/* ③ runtime → stream */}
      </Suspense>
    </>
  );
}

// ② dữ liệu chung cho mọi người, đổi vài lần mỗi giờ
async function ProductDetail({ id }: { id: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(`product-${id}`);
  const product = await db.product.findUnique({ where: { id } });
  return <article>{product.name}</article>;
}

// ③ phụ thuộc cookie của từng người → không cache chung được
async function CartWidget() {
  const cart = (await cookies()).get('cart')?.value;
  return <span>{parseCart(cart).length} sản phẩm</span>;
}
```

```ts
// Server Action: người dùng sửa sản phẩm và phải thấy ngay
'use server';
export async function editProduct(id: string, data: ProductInput) {
  await db.product.update({ where: { id }, data });
  updateTag(`product-${id}`);     // read-your-writes, KHÔNG phải revalidateTag
}
```

```text
Ba mức, ba quyết định có ý thức:
  ① header không phụ thuộc gì   → prerender, phục vụ từ CDN
  ② chi tiết sản phẩm chung     → cache theo id, tag để invalidate
  ③ giỏ hàng theo người dùng    → runtime, nằm trong Suspense

Ở Next 15, chỉ riêng `cookies()` ở ③ sẽ làm CẢ TRANG thành dynamic.
```

## Prediction

1. Nâng lên Next 16, giữ nguyên `middleware.ts` — nó có chạy không? Có cảnh báo không?
2. `revalidateTag('posts')` một tham số ở Next 16 — nó còn hoạt động thế nào?
3. Bật `cacheComponents`, đọc `cookies()` trong một component không có Suspense — chuyện gì xảy ra?
4. Cùng vậy nhưng có Suspense — phần còn lại của trang có prerender được không?
5. Ở Next 15, `cookies()` ở layout gốc — bao nhiêu trang mất khả năng static?
6. `await params` ở đầu layout so với `await` bên trong Suspense — khác gì về shell?
7. Hàm có `'use cache'` nhận hai đối số khác nhau — mấy entry cache?
8. Parallel route slot thiếu `default.js` ở Next 16 — build thế nào?
9. Người dùng sửa hồ sơ và cần thấy ngay — dùng `revalidateTag` hay `updateTag`?
10. Chỉ cần vẽ lại badge đếm thông báo chưa cache — dùng API nào?
11. Truy cập `params.id` không `await` — kết quả?
12. Shell phụ thuộc dữ liệu chỉ có lúc build, crawler truy cập — chuyện gì xảy ra?
13. Không bật `cacheComponents` ở Next 16 — mô hình caching là gì?

<details>
<summary>Đáp án</summary>

1. Còn chạy (deprecated, cho Edge runtime), nhưng nếu bạn đã đổi tên hàm hoặc file lệch nhau thì **im lặng không chạy**.
2. Vẫn invalidate nhưng **mất hành vi stale-while-revalidate**; dạng một tham số đã deprecated.
3. Dev overlay báo **blocking-route** và yêu cầu bọc Suspense, thêm `use cache`, hoặc opt out.
4. **Có** — đó chính là PPR.
5. **Mọi trang dùng layout đó.**
6. `await` ở đầu layout → **cả layout không vào shell**; `await` trong Suspense → chỉ phần đó stream.
7. **Hai** — đối số là một phần của cache key.
8. **Build fail.**
9. **`updateTag`** — read-your-writes.
10. **`refresh()`** — nó không đụng cache.
11. **Lỗi** — truy cập đồng bộ đã bị loại bỏ.
12. Trang **load được cho người dùng nhưng lỗi cho crawler**.
13. **Mô hình cũ**, giống Next 15.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi tên `middleware.ts` → `proxy.ts` nhưng giữ tên hàm cũ | Nó có chạy không? |
| Bật `cacheComponents` trên dự án hiện có | Bao nhiêu chỗ báo blocking-route? |
| Đọc `cookies()` không có Suspense | Dev overlay nói gì? |
| Di chuyển `await params` từ layout xuống component con | Shell lớn thêm bao nhiêu? |
| Gọi `'use cache'` với đối số khác nhau, xem số entry | Cache key sinh ra thế nào? |
| Dùng `revalidateTag` thay `updateTag` sau khi sửa dữ liệu | Người dùng thấy dữ liệu mới ngay không? |
| Xoá `default.js` của một parallel slot | Build có pass không? |
| Chạy `next build` và đọc bảng route | Route nào static, route nào dynamic? |
| Truy cập trang bằng user-agent của crawler | Render đường nào? |

## What Usually Goes Wrong

- **Đổi tên `middleware.ts`/hàm lệch nhau** → proxy im lặng không chạy.
- **`revalidateTag` một tham số** → mất SWR mà không có lỗi.
- **Dùng `revalidateTag` khi cần `updateTag`** → người dùng không thấy thay đổi của mình.
- **`await params` ở layout gốc** → shell nhỏ đi đáng kể.
- **Không bọc Suspense** cho dữ liệu runtime.
- **`"use cache"` không kèm `cacheLife`** → dùng profile mặc định không chủ ý.
- **Cache dữ liệu theo người dùng** vào cache dùng chung.
- **Thiếu `default.js`** cho parallel slot.
- **Đọc tài liệu Next 13/14/15** cho dự án Next 16 — caching khác hoàn toàn.
- **Quên rằng shell chạy lúc request cho crawler.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Next 16 cache mọi thứ như Next 13 | Caching là opt-in qua `"use cache"` |
| `cookies()` làm cả route dynamic | Với Cache Components, chỉ phần trong Suspense đó |
| PPR là tính năng thử nghiệm phải bật | Nó là mặc định khi bật Cache Components |
| `middleware.ts` vẫn là tên chuẩn | Đã đổi thành `proxy.ts` |
| `revalidateTag` và `updateTag` như nhau | Một là SWR, một là read-your-writes |
| Cache key phải tự đặt | Nó sinh từ đối số và scope |
| Bật `cacheComponents` là thay đổi cấu hình nhỏ | Nó đổi mô hình rendering của cả app |
| Static shell luôn được dùng lại | Crawler nhận bản render lại hoàn toàn |

## Debugging

1. **`next build`** in bảng route kèm loại rendering — nguồn sự thật đầu tiên.
2. **Route không prerender** → tìm `await` ở tầng cao (layout, đầu page) và dữ liệu runtime không có Suspense.
3. **Dev overlay báo blocking-route** → nó chỉ đúng dòng và ba cách sửa; đọc nó thay vì đoán.
4. **Dữ liệu cũ sau khi sửa** → dùng `revalidateTag` thay vì `updateTag`?
5. **Proxy không chạy** → tên file `proxy.ts` và tên hàm export `proxy` có khớp không?
6. **Cache không trúng như mong đợi** → đối số hoặc giá trị bắt từ scope có đổi giữa các lần gọi không?
7. **Trang lỗi với crawler nhưng ổn với trình duyệt** → shell phụ thuộc dữ liệu chỉ có lúc build.
8. **So sánh với mô hình cũ** → tắt `cacheComponents` để xác nhận vấn đề đến từ mô hình mới.

## Production Considerations

- **Ghim phiên bản Next trong tài liệu đội** — mọi câu trả lời trên mạng đều gắn với một bản.
- **Bật `cacheComponents` có kế hoạch**, không bật cùng lúc với nâng cấp lớn khác.
- **Luôn kèm `cacheLife` với `"use cache"`.**
- **`cacheTag` cho mọi thứ cần invalidate** theo sự kiện nghiệp vụ.
- **`updateTag` trong Server Action** khi người dùng phải thấy thay đổi của mình.
- **Đẩy `await` xuống sâu nhất có thể** để tối đa hoá shell.
- **Kiểm tra bảng route sau mỗi build** — hồi quy về rendering xảy ra âm thầm.
- **Kiểm tra shell với user-agent của crawler** trước khi phát hành.
- **Không cache dữ liệu theo người dùng** vào store dùng chung; dùng `use cache: private` nếu cần.
- **Đổi `middleware.ts` sang `proxy.ts`** ngay khi nâng cấp, đừng để deprecated tích tụ.

## Explain Without Notes

1. Ba mô hình caching của Next 13/14/15/16 khác nhau thế nào?
2. Cache Components làm gì, và caching là opt-in hay opt-out?
3. PPR giải quyết ranh giới nào? Vẽ static shell với một Suspense boundary.
4. Vì sao `cookies()` ở Next 16 không giết khả năng static của cả route?
5. Vì sao đẩy `await` xuống sâu làm shell lớn hơn?
6. `revalidateTag`, `updateTag`, `refresh` — chọn cái nào khi nào?
7. Thay đổi `middleware.ts` → `proxy.ts` nguy hiểm ở điểm nào?
8. Vì sao crawler có thể gặp lỗi mà người dùng thì không?

## Related

- [App Router structure](01-app-router-structure.md) — quy ước file và routing
- [Data fetching & cache](../behavior/03-data-fetching-cache.md) — chi tiết (baseline v15)
- [Rendering strategies](../behavior/04-rendering-strategies.md) — static/dynamic/streaming
- [Server/Client boundary](../behavior/01-server-client-boundary.md)
- [Route Handlers & Server Actions](../behavior/05-route-handlers-server-actions.md) — nơi gọi `updateTag`
- [Proxy & auth patterns](../behavior/06-middleware-auth-patterns.md) — `proxy.ts`
- [Cache invalidation](../../../03-database/02-redis/01-cache-invalidation.md) — cùng bài toán ở tầng backend
- [Frontend performance](../../../05-cross-cutting/performance/02-frontend-performance.md) — tác động của shell tới LCP

## Version / Context

Next.js **16.3.3** (kiểm tra với tài liệu chính thức, 08/2026). Cache Components bật bằng `cacheComponents: true`; khi không bật, mô hình caching của Next 15 vẫn áp dụng và tài liệu tương ứng là "Caching and Revalidating (Previous Model)". `use cache: private` cho dữ liệu phụ thuộc request; `use cache: remote` cho cache dùng chung giữa các instance. Mọi cache đều gắn với build id — deploy mới bắt đầu với cache rỗng.
