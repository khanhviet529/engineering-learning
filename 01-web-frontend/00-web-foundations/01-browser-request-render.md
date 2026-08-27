---
level: foundation
area: frontend
prerequisites: []
related:
  - 03-url-dns-tcp-tls.md
  - 04-rendering-pipeline.md
  - 02-http-browser-cache.md
---

# Browser: từ request tới render

> Giữa lúc bạn gõ Enter và lúc thấy chữ trên màn hình có khoảng 10 bước. Note này là bản đồ của 10 bước đó.

## Position

```text
User → Browser → [DNS → TCP → TLS → HTTP] → Server
                        ↓
                 HTML → DOM → render → pixel
                 ↑ ở đây
```

Đây là behavior đầu tiên trong [Roadmap](../../00-roadmap/02-roadmap.md). Mọi thứ khác trong repo này nằm ở đâu đó trên đường đi này.

## Problem

Bạn deploy một trang. Nó mất 4 giây để hiện chữ. Câu hỏi "vì sao chậm" **không thể trả lời** nếu bạn coi browser là một hộp đen — vì "chậm" có thể là:

- DNS mất 800ms vì resolver lạnh;
- TLS handshake thêm 2 round-trip;
- server mất 1,5s trả HTML;
- một `<script>` ở `<head>` chặn parsing;
- font chưa tải xong nên chữ chưa vẽ;
- một file CSS 400KB chặn render.

Sáu nguyên nhân này cần sáu cách sửa hoàn toàn khác nhau. Không có mental model về chuỗi bước thì bạn chỉ có thể đoán.

## Mental Model

Browser là một **pipeline có nhiều trạm, và một số trạm chặn trạm sau**.

```text
1. Phân giải tên      URL → IP                      (DNS)
2. Mở kết nối         TCP handshake                 (1 RTT)
3. Mã hoá             TLS handshake                 (1–2 RTT)
4. Xin tài liệu       HTTP request → response       (server time)
5. Đọc HTML           bytes → token → DOM tree      (streaming, tăng dần)
6. Đọc CSS            bytes → CSSOM                 (CHẶN render)
7. Chạy JS            có thể sửa DOM                (CHẶN parsing nếu sync)
8. Tính vị trí        layout / reflow
9. Vẽ                 paint
10. Ghép lớp          composite → pixel lên màn hình
```

Hai từ quan trọng nhất trong bảng trên là **CHẶN**. Tối ưu frontend hầu hết là việc trả lời: *cái gì đang chặn cái gì, và có thể bỏ chặn không?*

Bước 5 là streaming: browser **không** chờ nhận hết HTML mới bắt đầu dựng DOM. Nó dựng dần. Đây là nền tảng của streaming SSR trong [Next.js](../03-nextjs/04-rendering-strategies.md).

## How It Works

### Trước khi có byte nào

Browser kiểm tra theo thứ tự, mỗi bước đều có thể kết thúc sớm:

1. **Service Worker** — có thể trả response mà không ra mạng.
2. **HTTP cache** — nếu còn `fresh`, dùng luôn, **không có request nào đi ra**. Đây là lý do bạn sửa server mà không thấy gì đổi. Xem [HTTP & browser cache](02-http-browser-cache.md).
3. **DNS cache** (OS + browser) → nếu miss thì query thật.
4. **Connection pool** — nếu đã có kết nối tới host đó, tái dùng, bỏ qua bước 2–3.

Với HTTP/2, nhiều request tới cùng host dùng **một** kết nối TCP (multiplexing). Điều này xoá bỏ nhu cầu "gộp file để giảm số request" của thời HTTP/1.1.

### Parse HTML

Browser đọc byte → token → node → DOM tree. Trong lúc parse:

| Thẻ | Behavior |
|---|---|
| `<link rel="stylesheet">` | tải song song, **chặn render** (không chặn parse) |
| `<script>` | **chặn parse** — browser dừng dựng DOM, tải rồi chạy |
| `<script defer>` | tải song song, chạy sau khi DOM xong, giữ thứ tự |
| `<script async>` | tải song song, chạy ngay khi tải xong, **không** giữ thứ tự |
| `<script type="module">` | defer theo mặc định |
| `<img>` | tải song song, không chặn gì (nhưng gây layout shift nếu không có kích thước) |

Vì sao `<script>` chặn parse? Vì script có thể gọi `document.write()` và thay đổi phần HTML chưa parse. Browser không thể biết trước nên phải dừng.

### First paint

Browser cần **cả** DOM và CSSOM để tính được cái gì hiện ở đâu. Vì vậy CSS chặn render: hiện nội dung chưa có style rồi nhảy lại (FOUC) tệ hơn là chờ.

Đó là lý do **critical CSS** inline trong `<head>` giúp first paint, còn CSS không quan trọng nên tải bất đồng bộ.

## Example

Ba biến thể, cùng nội dung, ba behavior khác nhau:

```html
<!-- A: script chặn parse. Chữ dưới nó chưa vào DOM khi script chạy -->
<head><script src="/app.js"></script></head>
<body><h1>Hello</h1></body>

<!-- B: defer. DOM xong trước khi script chạy -->
<head><script defer src="/app.js"></script></head>
<body><h1>Hello</h1></body>

<!-- C: CSS chặn render, không chặn parse -->
<head><link rel="stylesheet" href="/big.css"></head>
<body><h1>Hello</h1></body>
```

```js
// app.js
console.log(document.querySelector('h1'));
```

## Prediction

Viết ra trước khi chạy:

1. Trong A, `console.log` in ra gì? Trong B?
2. Trong C, nếu `big.css` mất 3 giây, người dùng thấy gì trong 3 giây đó — chữ không style, hay trang trắng?
3. Nếu bạn thêm `<img>` 2MB không có `width`/`height`, cái gì nhảy và vào lúc nào?
4. Nếu server trả HTML theo kiểu chunked, gửi `<h1>` trước rồi 2 giây sau gửi phần còn lại — người dùng thấy `<h1>` ngay hay chờ?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt `<script>` sync ở đầu `<head>`, thêm delay 3s ở server cho file JS | Trang trắng 3s dù HTML đã có sẵn |
| Thêm CSS chậm | Trang trắng cho đến khi CSS xong — chứng minh CSS chặn render |
| DevTools → Network → throttle "Slow 4G" | Waterfall giãn ra, thấy rõ trạm nào là bottleneck |
| Chặn domain font trong DevTools → Network → Block request URL | Chữ vô hình hoặc nhảy font (FOIT/FOUT) |
| `<img>` không có kích thước | CLS: nội dung nhảy khi ảnh tải xong |
| Đổi `defer` thành `async` với 2 script phụ thuộc nhau | Lỗi ngẫu nhiên vì thứ tự chạy không xác định |

## What Usually Goes Wrong

- **Third-party script sync** — một thẻ analytics ở `<head>` không có `async` làm mọi trang chậm theo độ trễ của bên thứ ba.
- **CSS quá lớn** — một bundle CSS cho cả site chặn first paint của mọi trang.
- **Font không có `font-display: swap`** — chữ vô hình vài trăm ms.
- **Ảnh không có kích thước** — layout shift, điểm CLS xấu.
- **Chờ JS mới hiện nội dung** (SPA thuần) — HTML rỗng, người dùng thấy trang trắng đến khi bundle chạy xong. Đây chính là problem mà SSR giải quyết.
- **Waterfall tuần tự** — HTML → JS → mới biết cần gọi API → API. Ba round-trip xếp hàng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Browser tải hết HTML mới parse | Parse theo dòng, streaming |
| `defer` và `async` như nhau | `defer` giữ thứ tự và chạy sau DOM; `async` chạy ngay khi tải xong, thứ tự bất định |
| CSS chặn parse HTML | CSS chặn **render**, không chặn parse |
| Nhiều request luôn chậm hơn ít request | Với HTTP/2 multiplexing, gộp file có thể tệ hơn (mất cache granularity) |
| DOM và HTML là một | HTML là text; DOM là cây object có thể bị JS sửa sau đó |
| `DOMContentLoaded` = trang xong | Chỉ nghĩa là DOM dựng xong; ảnh/font/CSS có thể chưa xong (`load` mới là hết) |

## Debugging

Đi từ tín hiệu rẻ nhất:

1. **DevTools → Network**, xem cột Waterfall của request HTML đầu tiên. Chia thời gian thành: Queueing / DNS / Initial connection / SSL / **TTFB** / Content Download.
   - TTFB lớn → vấn đề ở **server hoặc network**, không phải frontend.
   - Content Download lớn → payload quá to.
2. Nếu TTFB ổn mà vẫn thấy trắng lâu → **Performance panel**, record reload. Tìm thanh nào chiếm chỗ trước First Paint.
3. Xem có request nào là **render-blocking** — DevTools ghi rõ trong Lighthouse ("Eliminate render-blocking resources").
4. Nếu nội dung hiện rồi mới nhảy → CLS, dùng Performance → Layout Shift.
5. Nếu chỉ chậm với người dùng thật → so sánh với RUM/field data, không kết luận từ máy local (máy bạn nhanh và gần server).

Nguyên tắc: **xác định TTFB trước**. Nó chia bài toán thành "lỗi backend" và "lỗi frontend", tiết kiệm rất nhiều thời gian.

## Production Considerations

- **CDN** đặt tài nguyên tĩnh gần người dùng, giảm RTT của bước 1–4.
- **HTTP/2 hoặc HTTP/3** giảm chi phí kết nối; HTTP/3 (QUIC) bỏ được cả TCP handshake khi tái kết nối.
- **`preconnect` / `dns-prefetch`** làm bước 1–3 song song với parse HTML thay vì sau nó.
- **Compression** (gzip/brotli) — payload text nhỏ hơn 3–5 lần.
- Người dùng thật có mạng chậm, CPU yếu và cache lạnh. Máy dev của bạn không đại diện cho họ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Inline critical CSS | first paint nhanh | HTML lớn hơn, không cache riêng được |
| Gộp bundle | ít request | cache invalidation thô — sửa 1 dòng, tải lại cả bundle |
| Chia nhỏ bundle | cache tốt | nhiều request, waterfall nếu phụ thuộc nhau |
| SSR | thấy nội dung sớm | server làm việc nhiều hơn, TTFB có thể tăng |
| Lazy load ảnh | tải trang nhanh | ảnh hiện muộn khi scroll |

## Explain Without Notes

1. Kể 10 trạm từ Enter tới pixel, và nói trạm nào chặn trạm nào.
2. Vì sao `<script>` chặn parse HTML nhưng `<link rel=stylesheet>` thì không?
3. `defer` khác `async` ở hai điểm nào?
4. TTFB cao nói cho bạn điều gì, và loại trừ được điều gì?
5. Vì sao một SPA thuần hiện trang trắng lúc đầu, và SSR sửa điều đó thế nào?

## Related

- [URL → DNS → TCP → TLS](03-url-dns-tcp-tls.md) — chi tiết 3 trạm đầu
- [Rendering pipeline](04-rendering-pipeline.md) — chi tiết 5 trạm cuối
- [HTTP & browser cache](02-http-browser-cache.md) — vì sao request không đi ra mạng
- [Event loop](../01-javascript-typescript/01-event-loop-async.md) — JS chạy khi nào trong pipeline này
- [Next.js rendering strategies](../03-nextjs/04-rendering-strategies.md) — server can thiệp vào pipeline này ở đâu
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md) — đo và tối ưu
