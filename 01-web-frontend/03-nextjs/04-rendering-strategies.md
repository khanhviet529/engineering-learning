---
level: intermediate
area: frontend
prerequisites:
  - 01-server-client-boundary.md
related:
  - 03-data-fetching-cache.md
  - ../02-react/09-error-boundaries-suspense.md
---

# Rendering strategies: SSR, SSG, ISR, streaming, hydration

> Cùng một component có thể render lúc build, lúc request, hoặc lúc tương tác. Chọn thời điểm là quyết định kiến trúc, và nó quyết định cả tốc độ lẫn độ mới của dữ liệu.

*Baseline: Next.js 15, App Router.*

## Position

```text
Build time  →  Request time  →  Client (hydrate)  →  Tương tác
   SSG           SSR/ISR          hydration           CSR
```

## Problem

Bốn tình huống, bốn lựa chọn khác nhau — và dùng sai chiến lược cho một trong chúng gây vấn đề thật:

| Nội dung | Yêu cầu |
|---|---|
| Trang marketing | nhanh nhất có thể, dữ liệu gần như không đổi |
| Danh sách sản phẩm | mới trong vài phút là đủ, có hàng nghìn trang |
| Dashboard cá nhân | phải mới, phải đúng người dùng |
| Bảng giá realtime | cập nhật liên tục |

Nếu SSG trang dashboard: mọi người thấy dữ liệu của người đầu tiên (và đó là lỗi bảo mật). Nếu SSR trang marketing: bạn trả tiền server cho nội dung không đổi và TTFB tệ hơn.

## Mental Model

```text
                render ở đâu    khi nào       dữ liệu     TTFB
SSG (static)    server          BUILD         cũ          rất nhanh (CDN)
ISR             server          build + nền   cũ ≤ N giây rất nhanh (CDN)
SSR (dynamic)   server          MỖI request   mới         phụ thuộc server + DB
Streaming SSR   server          mỗi request   mới         nhanh (shell trước)
CSR             browser         sau khi tải   mới         nhanh HTML rỗng, chậm nội dung
```

Cách chọn — hỏi hai câu, theo thứ tự:

```text
1. Nội dung có phụ thuộc request (cookie, user, searchParams) không?
   Có  → dynamic (SSR)
   Không → tiếp câu 2

2. Dữ liệu cũ bao lâu thì chấp nhận được?
   Không bao giờ đổi   → SSG
   N giây/phút         → ISR với revalidate = N
   Phải luôn mới       → SSR
```

Trong App Router, bạn **không chọn tường minh**. Next.js suy ra từ những gì bạn dùng:

```text
Dùng cookies(), headers(), searchParams, noStore()  → route thành dynamic
Chỉ fetch có cache                                   → static
fetch với { next: { revalidate: 60 } }               → ISR
```

Điều này có nghĩa: **một dòng `cookies()` ở component sâu trong cây có thể biến cả route từ static thành dynamic**, và bạn sẽ chỉ phát hiện qua output của `next build`.

## How It Works

### Xác định và kiểm soát

```tsx
// Tường minh cho cả route
export const dynamic = 'force-dynamic';   // luôn SSR
export const dynamic = 'force-static';    // luôn SSG (lỗi build nếu dùng API dynamic)
export const revalidate = 60;             // ISR: làm mới sau 60s

// SSG cho route động: liệt kê trước các path
export async function generateStaticParams() {
  const posts = await db.post.findMany({ select: { slug: true } });
  return posts.map(p => ({ slug: p.slug }));
}
```

Đọc output của `next build`:

```text
Route (app)                    Size     First Load JS
┌ ○ /                          1.2 kB        89 kB     ○ = static
├ ● /blog/[slug]               2.1 kB        91 kB     ● = SSG với generateStaticParams
└ ƒ /dashboard                 3.4 kB        95 kB     ƒ = dynamic (SSR)
```

Kiểm tra output này sau mỗi thay đổi liên quan tới data fetching — nó là cách duy nhất thấy chiến lược **thật**.

### Streaming — quan trọng nhất trong thực tế

Không có streaming, TTFB = thời gian của query chậm nhất:

```tsx
export default async function Page() {
  const user = await getUser();        // 50ms
  const stats = await getStats();      // 2000ms  ← cả trang chờ 2 giây
  return <><Header user={user} /><Stats data={stats} /></>;
}
```

Với `Suspense`, server gửi shell ngay và stream phần còn lại:

```tsx
export default async function Page() {
  const user = await getUser();        // 50ms — cần cho shell

  return (
    <>
      <Header user={user} />                        {/* gửi ngay ở ~50ms */}
      <Suspense fallback={<StatsSkeleton />}>
        <Stats />                                   {/* gửi ở ~2s, cùng response */}
      </Suspense>
    </>
  );
}

async function Stats() {
  const data = await getStats();       // component tự fetch
  return <StatsView data={data} />;
}
```

TTFB xuống 50ms; người dùng thấy layout và skeleton ngay. Đây là kỹ thuật có tác động lớn nhất với trang có dữ liệu chậm.

Điều kiện để streaming hoạt động: hạ tầng không buffer response. Một reverse proxy với `proxy_buffering on` sẽ giữ toàn bộ response và bạn mất hết lợi ích — nhìn giống như streaming không hoạt động. Xem [Reverse proxy](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md).

### Song song hoá fetch

```tsx
// ❌ Waterfall: 50 + 2000 = 2050ms
const user = await getUser();
const stats = await getStats();

// ✅ Song song: max(50, 2000) = 2000ms
const [user, stats] = await Promise.all([getUser(), getStats()]);
```

Kết hợp cả hai: song song hoá những gì cần cho shell, stream những gì không cần.

### Hydration

```text
Server: render → HTML (có nội dung, chưa tương tác được)
   ↓ gửi HTML + RSC payload + JS bundle
Client: React "gắn" event listener vào HTML có sẵn (hydrate)
   ↓
Trang tương tác được
```

Khoảng giữa "HTML đã hiện" và "hydrate xong" là lúc trang **nhìn xong nhưng click không phản hồi**. Với bundle lớn, khoảng này dài và người dùng cảm nhận rõ — nó là nguyên nhân chính của INP xấu.

RSC giảm điều này bằng cách gửi ít JS hơn: Server Component không cần hydrate vì không có tương tác.

### PPR (Partial Prerendering)

Next.js 15 có PPR (thực nghiệm): một route có phần static được CDN phục vụ ngay, phần dynamic được stream vào. Nó là sự kết hợp SSG + streaming SSR trên **cùng một trang**.

Vì còn thực nghiệm, đừng phụ thuộc vào nó cho production; nhưng nó là hướng đi và giải thích vì sao ranh giới `Suspense` được thiết kế như hiện tại.

## Example

```tsx
// Trang có cả nội dung tĩnh và dữ liệu người dùng
export const revalidate = 3600;          // phần tĩnh làm mới mỗi giờ

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);   // cache được, không phụ thuộc user

  return (
    <>
      <ProductInfo product={product} />                  {/* static, từ CDN */}
      <Suspense fallback={<RecoSkeleton />}>
        <Recommendations productId={id} />               {/* cá nhân hoá, stream */}
      </Suspense>
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews productId={id} />                       {/* chậm, stream */}
      </Suspense>
    </>
  );
}
```

## Prediction

1. Page có `await getStats()` mất 2 giây, không có `Suspense` — TTFB bao nhiêu?
2. Cùng page với `Suspense` — TTFB bao nhiêu? Khi nào người dùng thấy stats?
3. Một component sâu trong cây gọi `cookies()` — route là static hay dynamic?
4. `export const dynamic = 'force-static'` nhưng có `cookies()` — điều gì xảy ra lúc build?
5. `revalidate = 60`, 1000 request đến trong 60 giây sau khi hết hạn — bao nhiêu lần fetch dữ liệu?
6. Nginx với `proxy_buffering on` trước một trang streaming — người dùng thấy gì?
7. Trang SSG hiển thị dữ liệu của user (fetch không có cookie) — người dùng thứ hai thấy gì?

<details>
<summary>Đáp án chọn lọc</summary>

3. Dynamic — API dynamic ở bất cứ đâu trong cây làm cả route dynamic.
4. Build error — đó là điểm của `force-static`: nó biến lỗi im lặng thành lỗi build.
5. Một lần (Next.js dedupe); các request khác nhận bản cũ trong lúc revalidate nền.
6. Không có streaming — chờ toàn bộ response rồi mới nhận.
7. Dữ liệu của user đầu tiên — lỗi bảo mật.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Query 3 giây không có `Suspense`, đo TTFB bằng `curl -w` | TTFB ≈ 3s |
| Thêm `Suspense` | TTFB xuống còn thời gian shell |
| Thêm `cookies()` vào component nhỏ, chạy `next build` | Route đổi từ `○` sang `ƒ` |
| `force-static` + `cookies()` | Build fail với thông báo rõ |
| Hai `await` tuần tự cho hai fetch độc lập | Cộng thời gian; đổi sang `Promise.all` và so |
| Bật `proxy_buffering on` ở nginx | Streaming ngừng hoạt động |
| SSG một trang có dữ liệu user | Người dùng thứ hai thấy dữ liệu người thứ nhất |
| Bundle client rất lớn, throttle CPU 4× | Đo khoảng thời gian click không phản hồi (hydration) |

## What Usually Goes Wrong

- **Waterfall await** — nguồn chậm phổ biến nhất, và trông hoàn toàn hợp lý trong code.
- **Không dùng `Suspense`** cho phần chậm → TTFB bằng query chậm nhất.
- **Route vô tình thành dynamic** vì một `cookies()`/`headers()` ở component sâu.
- **SSG dữ liệu người dùng** → lộ dữ liệu giữa các user.
- **Proxy buffer response** → streaming không hoạt động, và rất khó đoán nguyên nhân.
- **Quá nhiều Suspense boundary nhỏ** → nhiều skeleton nhấp nháy rời rạc.
- **`revalidate` quá ngắn** → gần như SSR nhưng phức tạp hơn.
- **Không đọc output `next build`** → không biết chiến lược thật của mình.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| SSR luôn chậm hơn SSG | SSR + streaming có thể có TTFB tốt hơn SSG có query chậm ở edge |
| ISR nghĩa là mọi request đều nhanh | Request đầu sau khi stale có thể chậm (tuỳ chiến lược) |
| Streaming cần cấu hình đặc biệt | Chỉ cần `Suspense` — nhưng hạ tầng phải không buffer |
| Hydration là "làm HTML sống lại" | React gắn listener và dựng cây; sai HTML thì nó render lại |
| App Router bỏ CSR | Client Component vẫn CSR sau hydrate |
| `revalidate` là cron | Là lazy: revalidate khi có request sau khi hết hạn |
| Static nghĩa là không có JS | Vẫn có JS cho Client Component; chỉ ít hơn |

## Debugging

1. **Đọc `next build`** — đây là bước đầu tiên. `○` static, `●` SSG, `ƒ` dynamic. Nếu khác kỳ vọng, tìm API dynamic trong cây.
2. **TTFB cao** → `curl -w 'ttfb=%{time_starttransfer}\n' -o /dev/null <url>`. Nếu cao, xem có `await` tuần tự và có `Suspense` chưa.
3. **Streaming không hoạt động** → test trực tiếp vào app (bỏ qua proxy/CDN). Nếu trực tiếp thì streaming, qua proxy thì không → proxy buffering.
4. **Dữ liệu cũ** → xem [Data fetching & cache](03-data-fetching-cache.md); xác định lớp cache nào.
5. **Route bị dynamic không rõ vì sao** → `next build --debug`, hoặc tìm `cookies()`, `headers()`, `noStore()`, `searchParams` trong cây.
6. **Hydration chậm** → Performance panel, đo thời gian từ FCP tới lúc INP tốt; giảm bundle client.

## Production Considerations

- **Đặt `Suspense` quanh mọi phần chậm** — đây là mặc định nên có, không phải tối ưu.
- **`Promise.all` cho fetch độc lập.**
- **Cấu hình proxy/CDN không buffer** response streaming.
- **Kiểm tra `next build` output trong CI** — fail nếu một route đáng lẽ static trở thành dynamic.
- **`generateStaticParams`** cho route động có số lượng hữu hạn.
- **Không SSG dữ liệu người dùng.** Nếu route đọc cookie, nó phải dynamic.
- Cân bằng số Suspense boundary: gộp phần load cùng lúc để tránh nhấp nháy.

## Trade-offs

| Chiến lược | Được | Mất |
|---|---|---|
| SSG | nhanh nhất, rẻ nhất, CDN | dữ liệu cũ, build lâu nếu nhiều trang |
| ISR | gần như SSG + tự làm mới | vẫn có thể cũ; phức tạp hơn |
| SSR | luôn mới, cá nhân hoá | tốn server, TTFB phụ thuộc DB |
| Streaming SSR | TTFB tốt + dữ liệu mới | cần thiết kế fallback; hạ tầng phải hỗ trợ |
| CSR | server nhẹ, tương tác nhanh sau tải | HTML rỗng ban đầu, xấu cho SEO/LCP |

## Explain Without Notes

1. Hai câu hỏi để chọn chiến lược render?
2. Streaming giảm TTFB thế nào? Vẽ timeline có và không có `Suspense`.
3. Điều gì làm một route static trở thành dynamic, và bạn phát hiện bằng cách nào?
4. Hydration là gì, và khoảng "nhìn xong nhưng chưa click được" đến từ đâu?
5. Vì sao SSG một trang có dữ liệu user là lỗi bảo mật?

## Related

- [Server/Client boundary](01-server-client-boundary.md) — cái gì render ở đâu
- [Data fetching & cache](03-data-fetching-cache.md) — cache quyết định static/dynamic
- [Routing & layout](02-routing-layout-rendering.md) — `loading.tsx` là Suspense
- [Error boundaries & Suspense](../02-react/09-error-boundaries-suspense.md) — cơ chế React
- [Reverse proxy](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — buffering phá streaming
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md) — đo TTFB, LCP, INP
