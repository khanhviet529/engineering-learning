---
level: foundation
area: frontend
prerequisites:
  - 02-routing-layout-rendering.md
related:
  - ../../../05-cross-cutting/performance/02-frontend-performance.md
  - ../../00-web-foundations/04-rendering-pipeline.md
---

# Metadata, images & assets

> Ảnh thường là phần lớn nhất của payload một trang — nhiều hơn cả JavaScript. Và metadata quyết định trang trông thế nào khi được chia sẻ, điều bạn không bao giờ thấy trong lúc phát triển.

*Baseline: Next.js 15, App Router.*

## Position

```text
Request → Page → <head> (metadata) + <img> (assets) → browser tải → LCP, CLS
```

## Problem

Ba vấn đề luôn được phát hiện muộn:

1. **Ảnh 4MB từ điện thoại** được upload và hiển thị nguyên bản → LCP 8 giây trên 4G.
2. **Layout nhảy** khi ảnh tải xong vì không khai báo kích thước → CLS xấu.
3. **Chia sẻ link lên Slack/Facebook** ra một card trống → không ai click.

Cả ba rẻ để sửa, nhưng chỉ khi bạn biết chúng tồn tại. Chúng không xuất hiện trong lúc dev vì máy bạn nhanh, cache nóng, và bạn không tự chia sẻ link của mình.

## Mental Model

```text
Metadata  → cái gì hiện trong tab, trong Google, trong card khi chia sẻ
Images    → phần lớn nhất của payload; LCP và CLS phụ thuộc trực tiếp vào nó
Fonts     → chặn hiển thị chữ; gây layout shift nếu fallback khác kích thước
```

Với ảnh, bốn quyết định độc lập:

```text
1. Format     → AVIF/WebP nhỏ hơn JPEG 30–60%
2. Kích thước → gửi đúng kích thước hiển thị, không lớn hơn
3. Thời điểm  → ảnh trong viewport tải ngay (priority); còn lại lazy
4. Không gian → khai báo width/height để không nhảy layout
```

`next/image` xử lý cả bốn — nhưng nó **không tự biết** ảnh nào ở trên màn hình đầu tiên, và không tự biết ảnh sẽ hiển thị ở kích thước nào. Hai điều đó bạn phải nói với nó (`priority`, `sizes`).

## How It Works

### Metadata tĩnh và động

```tsx
// app/layout.tsx — mặc định cho toàn app
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Task Lab', template: '%s | Task Lab' },
  description: 'Quản lý task cho nhóm nhỏ',
  metadataBase: new URL('https://tasklab.example.com'),   // để URL tương đối resolve được
  openGraph: { type: 'website', locale: 'vi_VN', siteName: 'Task Lab' },
  robots: { index: true, follow: true },
};
```

```tsx
// app/tasks/[id]/page.tsx — động, theo dữ liệu
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const task = await getTask(id);        // request memoization: không gọi 2 lần cùng page

  if (!task) return { title: 'Không tìm thấy' };

  return {
    title: task.title,                   // → "Viết test | Task Lab" nhờ template
    description: task.description?.slice(0, 160),
    openGraph: {
      title: task.title,
      images: [{ url: `/tasks/${id}/opengraph-image`, width: 1200, height: 630 }],
    },
    alternates: { canonical: `/tasks/${id}` },
  };
}
```

`metadataBase` hay bị quên: không có nó, URL tương đối trong `openGraph.images` không resolve được và card chia sẻ mất ảnh.

`generateMetadata` chạy **song song** với page render, và nhờ request memoization, `getTask(id)` được gọi một lần dù cả hai đều cần nó.

### OG image động

```tsx
// app/tasks/[id]/opengraph-image.tsx
import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { id: string } }) {
  const task = await getTask(params.id);

  return new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        width: '100%', height: '100%', padding: 80,
        background: '#111', color: '#fff', fontSize: 64,
      }}>
        <div>{task?.title ?? 'Task'}</div>
        <div style={{ fontSize: 32, opacity: 0.6 }}>Task Lab</div>
      </div>
    ),
    size,
  );
}
```

`ImageResponse` render bằng Satori, không phải browser thật — nó chỉ hỗ trợ một tập CSS con (flexbox có, CSS Grid không).

### `next/image`

```tsx
import Image from 'next/image';

// Ảnh tĩnh import: width/height tự suy ra → không nhảy layout
import hero from '@/public/hero.png';
<Image src={hero} alt="Trang chủ Task Lab" priority />

// Ảnh remote: PHẢI có kích thước (hoặc fill) và domain phải được allowlist
<Image src={user.avatarUrl} alt={`Ảnh của ${user.name}`} width={48} height={48} sizes="48px" />

// Lấp đầy container
<div style={{ position: 'relative', aspectRatio: '16/9' }}>
  <Image src={cover} alt="" fill sizes="(max-width: 768px) 100vw, 50vw"
         style={{ objectFit: 'cover' }} />
</div>
```

```ts
// next.config.ts — allowlist, không wildcard
export default {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.example.com', pathname: '/avatars/**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
};
```

`remotePatterns` là **kiểm soát bảo mật**, không chỉ cấu hình: không có allowlist chặt, endpoint tối ưu ảnh của bạn trở thành một proxy mở mà người khác dùng để phục vụ ảnh của họ qua hạ tầng (và hoá đơn) của bạn.

Hai điểm về `sizes` và `priority`:

- Không có `sizes` đúng, browser giả định `100vw` và tải bản lớn hơn nhiều so với cần.
- `priority` chỉ cho **một hoặc hai** ảnh trên màn hình đầu. Đặt cho mọi ảnh xoá bỏ ý nghĩa của nó — chúng tranh nhau băng thông và ảnh LCP thật có thể chậm hơn.

`alt` là bắt buộc: chuỗi mô tả cho ảnh có nội dung, `alt=""` cho ảnh trang trí. `alt` thiếu là lỗi accessibility, không phải chi tiết nhỏ.

### Font

```tsx
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  display: 'swap',                 // hiện chữ bằng fallback ngay, đổi khi font xong
  variable: '--font-inter',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi" className={inter.variable}><body>{children}</body></html>;
}
```

`next/font` **self-host** font (không request tới Google — tốt cho cả hiệu năng và quyền riêng tư) và tự tính `size-adjust` cho fallback để giảm layout shift khi font thật tải xong.

`lang="vi"` ảnh hưởng screen reader, hyphenation và font fallback của browser — không phải chi tiết trang trí.

### Static asset

```text
public/            → phục vụ tại /, KHÔNG có hash → cache ngắn hoặc no-cache
import từ src/     → có hash trong tên → cache 1 năm, immutable
```

Đây là lý do ảnh nên `import` khi có thể thay vì đặt trong `public/`: bạn được hash tự động, và do đó được cache dài hạn an toàn. Xem [HTTP & browser cache](../../00-web-foundations/02-http-browser-cache.md).

## Example

```tsx
// Trang có ảnh LCP rõ ràng và thumbnail lazy
export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const p = await getProduct(id);

  return (
    <>
      {/* Ảnh chính = LCP: priority + sizes đúng */}
      <Image src={p.image} alt={p.name} width={800} height={600}
             sizes="(max-width: 768px) 100vw, 800px" priority />

      {/* Thumbnail: lazy (mặc định), kích thước nhỏ */}
      {p.gallery.map(g => (
        <Image key={g.id} src={g.url} alt="" width={96} height={96} sizes="96px" />
      ))}
    </>
  );
}
```

## Prediction

1. `<img src="4mb.jpg" width="200">` — browser tải bao nhiêu byte?
2. `<Image src="4mb.jpg" width={200} height={150} />` — bao nhiêu?
3. Ảnh không có `width`/`height` và không có `aspect-ratio` — điều gì xảy ra khi nó tải xong?
4. `priority` cho 20 ảnh — hiệu quả thế nào?
5. Không có `sizes`, ảnh hiển thị 48px trên desktop — browser tải kích thước nào?
6. Không có `metadataBase` với `openGraph.images: ['/og.png']` — card chia sẻ hiện gì?
7. `remotePatterns` với `hostname: '**'` — ai dùng được endpoint ảnh của bạn?
8. Ảnh trong `public/` vs ảnh `import` — cái nào cache được 1 năm an toàn?

<details>
<summary>Đáp án</summary>

1. Đủ 4MB — `width` của HTML chỉ ảnh hưởng hiển thị, không ảnh hưởng byte tải về.
2. Bản đã resize và chuyển format, thường vài chục KB.
3. Layout nhảy (CLS) khi kích thước thật được biết.
4. Tất cả tranh nhau băng thông; ảnh LCP thật có thể chậm **hơn** so với khi chỉ nó có `priority`.
5. Mặc định `100vw` → bản rất lớn cho một ảnh 48px.
6. Không có ảnh — URL tương đối không resolve được.
7. Bất kỳ ai — proxy mở, bạn trả tiền băng thông và CPU.
8. Ảnh `import` — nó có hash trong tên nên đổi nội dung là đổi URL.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `<img>` thuần với ảnh 4MB, throttle "Slow 4G" | Đo LCP; so với `next/image` |
| Bỏ `width`/`height` | DevTools → Rendering → Layout Shift Regions cho thấy CLS |
| `priority` cho 20 ảnh | Network waterfall: mọi ảnh tranh băng thông |
| Bỏ `sizes` cho ảnh 48px | Xem URL ảnh thật trong Network — width lớn bất ngờ |
| Bỏ `metadataBase`, test bằng Facebook Sharing Debugger | Card không có ảnh |
| `hostname: '**'` rồi gọi `/_next/image?url=https://ảnh-của-người-khác` | Hạ tầng của bạn phục vụ ảnh của họ |
| Font `display: block` thay vì `swap` | Chữ vô hình vài trăm ms (FOIT) |
| Bỏ `lang` trên `<html>` | Screen reader đọc sai ngôn ngữ |
| Đặt ảnh trong `public/`, cache 1 năm, rồi đổi ảnh | Người dùng vẫn thấy ảnh cũ — không có hash để invalidate |

## What Usually Goes Wrong

- **Ảnh không tối ưu** — thường là nguyên nhân LCP xấu số một, và bị bỏ qua vì "chỉ là ảnh".
- **Thiếu kích thước** → CLS.
- **`priority` sai chỗ** hoặc cho quá nhiều ảnh.
- **`sizes` thiếu hoặc sai** → tải bản quá lớn.
- **`metadataBase` thiếu** → OG image không hoạt động.
- **`remotePatterns` quá rộng** → proxy mở.
- **`alt` thiếu** → lỗi accessibility.
- **Ảnh do người dùng upload không giới hạn kích thước** → 20MB vào storage và vào response.
- **Font không `swap`** → chữ vô hình.
- **Metadata chỉ ở root** → mọi trang có cùng title trong kết quả tìm kiếm.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `width` trong HTML giảm byte tải về | Không — chỉ ảnh hưởng hiển thị |
| `next/image` tự biết ảnh nào là LCP | Bạn phải đặt `priority` |
| `next/image` tự biết kích thước hiển thị | Bạn phải đặt `sizes` |
| Lazy loading tốt cho mọi ảnh | Lazy cho ảnh LCP làm LCP tệ hơn |
| Metadata chỉ cho SEO | Còn cho card chia sẻ — thường ảnh hưởng traffic nhiều hơn |
| `public/` là chỗ đúng cho mọi asset | `import` cho hash + cache dài hạn |
| Font từ Google CDN nhanh hơn | Self-host thường nhanh hơn (một origin, không thêm kết nối) |
| AVIF luôn tốt nhất | Encode chậm hơn; WebP thường là điểm cân bằng tốt |

## Debugging

1. **LCP xấu** → DevTools → Performance → tìm phần tử LCP. Nếu là ảnh: nó có `priority` chưa, kích thước bao nhiêu byte, format gì?
2. **CLS** → Rendering panel → *Layout Shift Regions*. Nó chỉ đúng element gây nhảy.
3. **Ảnh quá lớn** → Network tab, sort theo Size. So sánh byte tải về với kích thước hiển thị.
4. **Kiểm tra kích thước thật `next/image` chọn** → xem query param `w=` trong URL `/_next/image`.
5. **OG card sai** → dùng Facebook Sharing Debugger / Twitter Card Validator / `curl` rồi grep `og:`. Đừng đoán; các nền tảng cache aggressive.
6. **Metadata không xuất hiện** → View Source (không phải Inspect) để thấy HTML server trả về.
7. **Lighthouse** cho một danh sách vấn đề ưu tiên theo tác động — chạy nó trên production build.

## Production Considerations

- **Giới hạn kích thước upload** và resize ở server trước khi lưu. Không tin ảnh từ client.
- **Ngân sách ảnh cho mỗi trang** và kiểm tra trong CI (Lighthouse CI).
- **`remotePatterns` chặt** với hostname và pathname cụ thể.
- **`generateMetadata` cho mọi route động** — title/description riêng ảnh hưởng trực tiếp tới click-through.
- **`sitemap.ts` và `robots.ts`** của App Router cho SEO.
- **`priority` cho đúng ảnh LCP** của mỗi trang, không nhiều hơn.
- **Đo trên field data** (CrUX/RUM) — Lighthouse trên máy bạn không đại diện cho người dùng.
- Cân nhắc CDN cho ảnh nếu lượng truy cập lớn: endpoint tối ưu ảnh của Next.js tiêu CPU server.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `next/image` | tự resize/format/lazy | phụ thuộc runtime tối ưu ảnh, tốn CPU server |
| CDN ảnh riêng | scale tốt, giảm tải app | thêm dịch vụ, thêm chi phí |
| AVIF | nhỏ nhất | encode chậm, hỗ trợ hẹp hơn WebP |
| `priority` | LCP nhanh | dùng nhiều làm mọi thứ chậm |
| Ảnh `import` | hash, cache 1 năm | phải nằm trong source, không dùng cho ảnh động |
| OG image động | card đẹp, cá nhân hoá | tốn CPU mỗi lần render (nên cache) |

## Explain Without Notes

1. Bốn quyết định độc lập với một ảnh, và `next/image` xử lý cái nào tự động?
2. Vì sao `<img width="200">` không giảm byte tải về?
3. `priority` dùng cho ảnh nào, và vì sao không dùng cho tất cả?
4. `metadataBase` giải quyết vấn đề gì?
5. Vì sao `remotePatterns` là kiểm soát bảo mật?

## Related

- [Routing & layout](02-routing-layout-rendering.md) — metadata theo route segment
- [Rendering pipeline](../../00-web-foundations/04-rendering-pipeline.md) — vì sao ảnh gây CLS
- [HTTP & browser cache](../../00-web-foundations/02-http-browser-cache.md) — hash và cache dài hạn
- [Frontend performance](../../../05-cross-cutting/performance/02-frontend-performance.md) — LCP, CLS, đo lường
- [Deployment & production](08-deployment-production.md)
