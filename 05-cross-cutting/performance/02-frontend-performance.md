---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - 03-backend-performance.md
  - ../../01-web-frontend/00-web-foundations/02-http-browser-cache.md
---

# Frontend performance

> Một trang thương mại điện tử đạt điểm Lighthouse 96 trên máy của lập trình viên. Dữ liệu người dùng thật cho thấy p75 của LCP là 4,2 giây — mức "kém". Khác biệt: máy dev có CPU nhanh, mạng gigabit, cache nóng, và không có ba script marketing được thêm vào sau khi đo. **Điểm số trong phòng thí nghiệm và trải nghiệm thật là hai đại lượng khác nhau.**

## Position

```text
Người dùng gõ URL
  → DNS · TCP · TLS         (mạng, ~1 vòng khứ hồi mỗi bước)
  → HTML                     (server nghĩ + truyền)
  → CSS + JS                 (tải + phân tích + thực thi)
  → render                   (layout + paint)
  → hydrate / tương tác được ← điều người dùng THỰC SỰ chờ
```

## Problem

```text
Backend đo thời gian nó xử lý. Người dùng đo thời gian tới khi DÙNG ĐƯỢC.

  API 50ms + 1,2 MB JavaScript trên điện thoại tầm trung
  = trang trắng 4 giây

⇒ Tối ưu backend từ 50ms xuống 20ms không đổi gì cả.
  Nút thắt nằm ở chỗ backend không nhìn thấy.
```

## Mental Model

### Core Web Vitals: ba số đo trải nghiệm

```text
LCP  Largest Contentful Paint    "nội dung chính hiện ra khi nào"      tốt < 2,5s
INP  Interaction to Next Paint   "bấm vào thì bao lâu có phản hồi"     tốt < 200ms
CLS  Cumulative Layout Shift     "nội dung có nhảy không"              tốt < 0,1
```

```text
Chúng đo bằng p75 của NGƯỜI DÙNG THẬT, không phải một lần chạy trên máy dev.
INP thay thế FID từ tháng 3/2024 — và nó khó hơn nhiều:
  FID chỉ đo ĐỘ TRỄ tới lúc xử lý bắt đầu
  INP đo TOÀN BỘ tới khi frame tiếp theo được vẽ
  → JavaScript nặng trong handler giờ mới bị tính
```

### Lab data và field data đo hai thứ khác nhau

```text
LAB (Lighthouse, WebPageTest)
  + tái lập được, chạy trên mỗi PR, chẩn đoán được
  − một thiết bị, một mạng, cache nóng, không có script bên thứ ba thật

FIELD (RUM, CrUX)
  + trải nghiệm THẬT: thiết bị thật, mạng thật, cache thật
  − không tái lập, khó chẩn đoán từng trường hợp

⇒ Dùng FIELD để biết CÓ vấn đề; dùng LAB để tìm NGUYÊN NHÂN.
  Tối ưu điểm lab mà không nhìn field là tối ưu một môi trường không tồn tại.
```

### Đường tới hạn: thứ chặn hiển thị

```text
HTML tải xong → trình duyệt bắt đầu phân tích
  <link rel="stylesheet">   CHẶN RENDER    → không vẽ gì cho tới khi CSS xong
  <script src>              CHẶN PARSER    → dừng phân tích HTML
  <script defer>            không chặn; chạy sau khi parse xong, ĐÚNG THỨ TỰ
  <script async>            không chặn; chạy ngay khi tải xong, THỨ TỰ BẤT KỲ
  <script type="module">    defer theo mặc định
```

```text
Mỗi tài nguyên chặn render thêm ÍT NHẤT một vòng khứ hồi vào LCP.
Trên mạng 3G (RTT ~200ms), ba tài nguyên chặn nối tiếp = +600ms trước khi vẽ.
```

### JavaScript đắt hơn ảnh cùng kích thước

```text
200 KB ảnh:  tải → giải mã → vẽ
200 KB JS:   tải → PHÂN TÍCH → BIÊN DỊCH → THỰC THI → thường gây layout

Trên điện thoại tầm trung, ~1 MB JS ≈ 1–3 giây CPU chỉ để phân tích và thực thi.
Và CPU điện thoại tầm trung chậm hơn máy dev 4–6 lần.
```

```text
⇒ Ngân sách JS quan trọng hơn ngân sách tổng dung lượng.
⇒ Luôn test với CPU throttling 4x — nó gần với thiết bị thật hơn máy của bạn.
```

### Bốn cách giảm JavaScript, theo hiệu quả

```text
① XOÁ                 dependency không dùng, polyfill cho trình duyệt đã chết
                      → `npx depcheck`, kiểm tra browserslist
② THAY BẰNG NHẸ HƠN   moment (~70 KB) → date-fns/Temporal
                      lodash toàn bộ → import từng hàm
③ CHIA NHỎ THEO ROUTE mỗi trang chỉ tải code của nó
④ HOÃN                dynamic import cho thứ dưới màn hình đầu / sau tương tác
```

```ts
// ③ chia theo route
const Analytics = lazy(() => import('./pages/Analytics'));

// ④ hoãn thứ nặng và không cần ngay
const openEditor = async () => {
  const { RichTextEditor } = await import('./RichTextEditor');   // 300 KB, chỉ khi cần
  setEditor(() => RichTextEditor);
};
```

Thứ tự này quan trọng: chia nhỏ (③) là kỹ thuật được nói tới nhiều nhất nhưng ① và ② thường cho kết quả lớn hơn với ít rủi ro hơn.

### Ảnh: thường là phần nặng nhất và dễ sửa nhất

```html
<img
  src="/hero-800.webp"
  srcset="/hero-400.webp 400w, /hero-800.webp 800w, /hero-1600.webp 1600w"
  sizes="(max-width: 600px) 100vw, 800px"
  width="800" height="450"        <!-- BẮT BUỘC: chống CLS -->
  loading="lazy"                   <!-- KHÔNG dùng cho ảnh LCP -->
  decoding="async"
  alt="..."
/>
```

```text
width/height     trình duyệt dành chỗ trước khi ảnh tải → CLS = 0
                 → thiếu nó là nguyên nhân CLS phổ biến nhất
loading="lazy"   cho ảnh DƯỚI màn hình đầu
                 → đặt trên ảnh LCP làm LCP TỆ HƠN (trình duyệt hoãn tải nó)
srcset/sizes     điện thoại không tải ảnh 1600px
định dạng        AVIF < WebP < JPEG về dung lượng
fetchpriority="high"  cho ảnh LCP → nâng độ ưu tiên tải
```

### Font: nguyên nhân của cả LCP lẫn CLS

```text
Mặc định: font chưa tải xong → chữ VÔ HÌNH (FOIT) tới 3 giây
  → LCP tệ, vì nội dung chính là chữ

font-display: swap    hiện font dự phòng ngay, đổi khi font thật tải xong
                      → LCP tốt, nhưng có thể gây CLS khi đổi
size-adjust + ascent-override   khớp metric của font dự phòng với font thật
                                → swap không gây nhảy chữ
```

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+0000-00FF, U+0102-0103, U+1EA0-1EF9;   /* chỉ tải subset cần */
}
@font-face {
  font-family: 'Inter-fallback';
  src: local('Arial');
  size-adjust: 107%;              /* khớp chiều rộng → không nhảy khi swap */
  ascent-override: 90%;
}
```

```html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

### Script bên thứ ba: chi phí ẩn lớn nhất

```text
Analytics, chat, A/B testing, quảng cáo, heatmap:
  · chạy trên luồng chính → ăn vào INP
  · có thể tự tải thêm script khác → bạn không kiểm soát tổng dung lượng
  · thường được thêm SAU khi đo hiệu năng ← chính là sự cố ở đầu note

Giảm nhẹ:
  · tải sau tương tác đầu tiên hoặc sau `load`
  · chạy trong web worker (Partytown) khi có thể
  · đặt NGÂN SÁCH và đo lại mỗi khi thêm script
  · xem lại định kỳ: script nào còn được dùng?
```

### Rendering: chọn theo bản chất trang

```text
CSR   trang trắng → tải JS → gọi API → hiện
      LCP phụ thuộc hoàn toàn vào JS → chậm nhất
      ✓ ứng dụng sau đăng nhập, không cần SEO

SSR   HTML có nội dung ngay → hydrate
      LCP tốt, TTFB phụ thuộc server
      ✓ nội dung động, cần SEO

SSG   HTML dựng sẵn từ CDN
      LCP tốt nhất
      ✓ nội dung ít đổi

ISR/streaming  HTML tĩnh + phần động chảy về sau
      ✓ tổ hợp thực dụng cho hầu hết trang thương mại
```

Xem [Rendering strategies](../../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md).

### Cache: mỗi lớp một vai trò

```text
CDN                   tài nguyên tĩnh, gần người dùng
Cache-Control immutable  file có hash trong tên → cache 1 năm
HTML                  không cache lâu; dùng `no-cache` + ETag
API                   `private, max-age` ngắn hoặc `stale-while-revalidate`
Service Worker        offline và điều hướng lặp lại
```

```text
Chiến lược chuẩn:
  /assets/app.a1b2c3.js   → Cache-Control: public, max-age=31536000, immutable
  /index.html             → Cache-Control: no-cache   (kiểm tra ETag mỗi lần)
  ⇒ deploy mới đổi hash → HTML mới trỏ file mới → không cần xoá cache
```

## Example

Đo và sửa một trang có LCP 4,2 giây:

```text
Waterfall cho thấy:
  0ms      HTML request
  180ms    HTML về (TTFB)
  180ms    phát hiện <link rel=stylesheet>  → +200ms RTT
  400ms    CSS về, bắt đầu render
  400ms    phát hiện <img> hero trong CSS background  → +200ms
  600ms    ảnh hero bắt đầu tải (1,8 MB JPEG)
  2900ms   ảnh hero về
  2900ms   LCP
  ...
  4200ms   bundle JS 1,1 MB thực thi xong → trang tương tác được
```

Bốn thay đổi, xếp theo tỉ lệ hiệu quả/công sức:

```html
<!-- ① ảnh hero: định dạng + kích thước + ưu tiên  → 1,8 MB xuống 120 KB -->
<img src="/hero-800.avif" srcset="/hero-400.avif 400w, /hero-800.avif 800w"
     sizes="(max-width: 600px) 100vw, 800px"
     width="800" height="450" fetchpriority="high" alt="...">
<!-- và ĐƯA NÓ VÀO HTML, không để trong CSS background:
     ảnh trong CSS chỉ được phát hiện SAU khi CSS tải và phân tích xong -->

<!-- ② preload thứ chắc chắn cần cho màn hình đầu -->
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://api.example.com">

<!-- ③ CSS quan trọng inline, phần còn lại tải không chặn -->
<style>/* CSS cho màn hình đầu, ~4 KB */</style>
<link rel="stylesheet" href="/app.css" media="print" onload="this.media='all'">

<!-- ④ script bên thứ ba sau tương tác đầu -->
<script>
  const loadThirdParty = () => { /* chèn analytics, chat */ };
  ['pointerdown', 'keydown', 'scroll'].forEach(e =>
    addEventListener(e, loadThirdParty, { once: true, passive: true }));
  setTimeout(loadThirdParty, 5000);          // dự phòng nếu người dùng không tương tác
</script>
```

```text
Kết quả:
  LCP  4200ms → 900ms
  chủ yếu từ ①: ảnh hero nhỏ hơn 15 lần VÀ được phát hiện sớm hơn 200ms

Bài học: việc ảnh nằm trong CSS background thay vì trong HTML
làm trình duyệt không thể phát hiện nó trong bước quét trước (preload scanner).
Đây là loại vấn đề mà chỉ waterfall mới cho thấy.
```

## Prediction

1. Lighthouse 96 trên máy dev, LCP thật p75 = 4,2 giây — điều gì khác nhau?
2. `<script src>` không có `defer` trong `<head>` — trình duyệt làm gì?
3. Thêm `defer` — khác thế nào?
4. `<link rel="stylesheet">` — có chặn render không?
5. 200 KB ảnh và 200 KB JS — cái nào tốn CPU hơn?
6. Điện thoại tầm trung so với máy dev — CPU chậm hơn bao nhiêu lần?
7. `<img>` không có `width`/`height` — chỉ số nào bị ảnh hưởng?
8. `loading="lazy"` trên ảnh LCP — LCP tốt hơn hay tệ hơn?
9. Font không có `font-display` — chữ hiển thị thế nào trong 3 giây đầu?
10. `font-display: swap` không có `size-adjust` — chỉ số nào bị ảnh hưởng khi font tải xong?
11. Ảnh hero đặt trong CSS `background-image` thay vì `<img>` — nó được phát hiện khi nào?
12. Thêm ba script marketing sau khi đo hiệu năng — INP đổi thế nào?
13. File JS có hash trong tên, `Cache-Control: immutable, max-age=1 năm`, deploy bản mới — người dùng có nhận được không?
14. CSR với bundle 1 MB trên 3G — LCP khoảng bao nhiêu?

<details>
<summary>Đáp án</summary>

1. CPU, mạng, cache, **và script bên thứ ba** được thêm sau khi đo.
2. **Dừng phân tích HTML** cho tới khi script tải và chạy xong.
3. Tải song song, **chạy sau khi parse xong**, đúng thứ tự.
4. **Có** — không vẽ gì cho tới khi CSS tải xong.
5. **JS** — nó còn phải phân tích, biên dịch, thực thi.
6. Khoảng **4–6 lần**.
7. **CLS** — nội dung nhảy khi ảnh tải xong.
8. **Tệ hơn** — trình duyệt hoãn tải chính ảnh quyết định LCP.
9. **Vô hình (FOIT)** — và LCP tính từ lúc chữ hiện ra.
10. **CLS** — chữ nhảy khi đổi font.
11. **Sau khi CSS tải và phân tích xong** — preload scanner không thấy nó.
12. **Tệ hơn** — chúng chạy trên luồng chính.
13. **Có** — HTML mới trỏ tới file có hash mới.
14. Nhiều giây — LCP phụ thuộc hoàn toàn vào việc tải và chạy JS.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy Lighthouse với CPU throttle 4x và mạng 3G | Điểm đổi bao nhiêu? |
| So dữ liệu field (CrUX/RUM) với điểm lab | Chênh bao nhiêu? |
| Xoá `width`/`height` khỏi một ảnh | CLS đổi thế nào? |
| Đặt `loading="lazy"` lên ảnh hero | LCP đổi thế nào? |
| Xem waterfall và tìm tài nguyên chặn render | Bao nhiêu vòng khứ hồi trước khi vẽ? |
| Chặn mọi script bên thứ ba | LCP và INP đổi bao nhiêu? |
| Xem bundle analyzer | Ba dependency lớn nhất là gì? Có cần không? |
| `npx depcheck` | Bao nhiêu dependency không dùng? |
| Đo thời gian thực thi JS trong Performance panel | Bao nhiêu ms trên luồng chính? |
| Tải trang với cache trống, chế độ ẩn danh | Khác lần thứ hai bao nhiêu? |
| Chuyển ảnh hero từ CSS background sang `<img>` | Nó bắt đầu tải sớm hơn bao nhiêu? |

## What Usually Goes Wrong

- **Chỉ đo lab, không đo field.**
- **Đo trên máy dev** với CPU nhanh và mạng nhanh.
- **Không có ngân sách hiệu năng** → bundle lớn dần không ai để ý.
- **Script bên thứ ba** thêm vào sau khi đo.
- **Ảnh không tối ưu**: sai định dạng, sai kích thước, không responsive.
- **Ảnh LCP nằm trong CSS** → preload scanner không thấy.
- **`loading="lazy"` trên ảnh LCP.**
- **Thiếu `width`/`height`** → CLS.
- **Font không có `font-display`** hoặc swap không có `size-adjust`.
- **Chia nhỏ bundle nhưng không xoá dependency thừa** — sửa triệu chứng.
- **Polyfill cho trình duyệt không còn ai dùng** (kiểm tra `browserslist`).
- **Cache HTML quá lâu** → người dùng kẹt ở bản cũ.
- **Không cache tài nguyên có hash** → tải lại mỗi lần.
- **Tối ưu lần tải đầu, bỏ qua INP** — trang mở nhanh nhưng bấm gì cũng giật.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Điểm Lighthouse cao = người dùng hài lòng | Lab và field đo hai thứ khác nhau |
| Dung lượng tổng là chỉ số quan trọng nhất | 200 KB JS đắt hơn 200 KB ảnh nhiều lần |
| `async` tốt hơn `defer` | `async` chạy bất kỳ lúc nào, có thể chặn parse |
| Lazy load mọi ảnh là tốt | Trên ảnh LCP nó phản tác dụng |
| CLS chỉ là vấn đề thẩm mỹ | Nó làm người dùng bấm nhầm |
| CDN giải quyết mọi vấn đề tốc độ | Nó không giảm thời gian thực thi JS |
| SSR luôn nhanh hơn CSR | SSR chậm nếu TTFB kém |
| Script analytics là "nhẹ" | Nó chạy trên luồng chính và tự kéo thêm script |
| Hydration là miễn phí | Nó thực thi lại toàn bộ cây component |
| Tối ưu ảnh là việc của designer | Định dạng, srcset, priority là quyết định kỹ thuật |

## Debugging

1. **Bắt đầu từ field data** (CrUX hoặc RUM): chỉ số nào kém, ở thiết bị/mạng/trang nào?
2. **Tái lập trong lab** với throttle tương ứng — CPU 4x, mạng Slow 4G.
3. **Waterfall trước tiên**: cái gì chặn render, cái gì được phát hiện muộn, cái gì lớn bất thường.
4. **Xác định phần tử LCP** (Lighthouse chỉ ra) — nó là ảnh, chữ, hay video? Nó được phát hiện lúc nào?
5. **INP kém** → Performance panel, tìm long task > 50ms trên luồng chính; thường là script bên thứ ba hoặc render lại toàn cây.
6. **CLS** → Layout Shift regions trong DevTools; thường là ảnh thiếu kích thước, font swap, hoặc nội dung chèn động.
7. **Bundle lớn** → bundle analyzer; nhìn ba khối lớn nhất trước, đừng tối ưu khối nhỏ.
8. **So sánh trước/sau** với cùng điều kiện throttle — không có so sánh cùng điều kiện thì không kết luận được.

## Production Considerations

- **Đo field data liên tục** (RUM), không chỉ chạy Lighthouse thỉnh thoảng.
- **Ngân sách hiệu năng trong CI**: dung lượng JS, LCP lab, số request — build đỏ khi vượt.
- **Test với CPU throttle 4x và mạng chậm** làm mặc định.
- **Ảnh: AVIF/WebP, `srcset`, `width`/`height`, `fetchpriority="high"` cho LCP.**
- **Ảnh LCP trong HTML**, không trong CSS.
- **`font-display: swap` + `size-adjust`** cho font dự phòng.
- **Preload thứ chắc chắn cần**; `preconnect` tới origin của API.
- **Chia bundle theo route**, hoãn thứ dưới màn hình đầu.
- **Script bên thứ ba tải sau tương tác**; có ngân sách và xem lại định kỳ.
- **Tài nguyên có hash: `immutable, max-age=1 năm`; HTML: `no-cache`.**
- **Theo dõi INP như một chỉ số hạng nhất** — nó phản ánh chất lượng sau khi trang đã tải.
- **Kiểm tra `browserslist`** — polyfill cho trình duyệt đã chết là dung lượng thuần tuý lãng phí.
- **Đo lại sau mỗi lần thêm dependency hoặc script** — hồi quy hiệu năng xảy ra dần dần.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| SSR/SSG | LCP tốt, SEO | phức tạp, TTFB phụ thuộc server |
| CSR | đơn giản, tương tác mượt sau khi tải | LCP kém, SEO kém |
| Chia nhỏ bundle | tải đầu nhanh | nhiều request, có thể chậm khi điều hướng |
| Inline CSS quan trọng | render sớm | HTML lớn hơn, khó bảo trì |
| Lazy load | tiết kiệm băng thông | nội dung hiện muộn nếu dùng sai chỗ |
| Ảnh chất lượng cao | đẹp | LCP chậm |
| AVIF | nhỏ nhất | mã hoá chậm, hỗ trợ hẹp hơn WebP |
| Font tuỳ chỉnh | thương hiệu | thêm request, rủi ro FOIT/CLS |
| Script bên thứ ba | tính năng, dữ liệu | INP kém, mất kiểm soát dung lượng |
| Service Worker | offline, điều hướng nhanh | phức tạp cập nhật, dễ phục vụ bản cũ |

## Explain Without Notes

1. Ba Core Web Vitals đo gì? Vì sao INP khó hơn FID?
2. Lab data và field data khác nhau ra sao, và dùng cái nào cho việc gì?
3. `defer`, `async`, và script thường khác nhau thế nào?
4. Vì sao 200 KB JS đắt hơn 200 KB ảnh?
5. Bốn cách giảm JavaScript theo thứ tự hiệu quả, và vì sao "chia nhỏ" không đứng đầu?
6. Vì sao `loading="lazy"` trên ảnh LCP làm mọi thứ tệ hơn?
7. Vì sao ảnh trong CSS background được phát hiện muộn hơn trong `<img>`?
8. Chiến lược cache nào cho phép deploy mà không cần xoá cache?

## Related

- [Latency & bottleneck](01-latency-throughput-bottleneck.md) — khung tối ưu chung
- [Backend performance](03-backend-performance.md) — TTFB đến từ đâu
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — cơ chế cache
- [Rendering strategies](../../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md) — CSR/SSR/SSG/ISR
- [Data fetching & cache](../../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) — cache ở tầng framework
- [Reverse proxy & load balancer](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — CDN và TTFB
- [TLS](../../04-infrastructure/01-networking/03-tls.md) — chi phí bắt tay
- [Profiling & load testing](05-profiling-load-testing.md) — công cụ đo

## Version / Context

Core Web Vitals: INP thay thế FID làm chỉ số chính thức từ tháng 3/2024. Ngưỡng "tốt" tính trên **p75** của người dùng thật. `fetchpriority` được hỗ trợ ở Chrome/Edge/Safari; Firefox hỗ trợ từ v132. `size-adjust`/`ascent-override` cho `@font-face` được hỗ trợ rộng rãi. Dữ liệu field công khai qua Chrome UX Report (CrUX) — chỉ có cho trang đủ lưu lượng. Partytown để chạy script bên thứ ba trong web worker.
