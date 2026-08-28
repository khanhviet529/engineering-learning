---
level: intermediate
area: cross-cutting
prerequisites:
  - 02-injection.md
related:
  - 07-secure-headers-tls.md
  - ../../02-backend-api/03-auth/02-session-vs-token.md
---

# XSS & CSRF

> Một ứng dụng ghi chú cho phép định dạng văn bản. Nội dung được lưu nguyên văn và hiển thị bằng `dangerouslySetInnerHTML`. Một ghi chú được chia sẻ trong nhóm; khi đồng nghiệp mở nó, script trong ghi chú chạy **trong origin của ứng dụng** và gọi API bằng chính phiên của họ. Không có mật khẩu nào bị đánh cắp — attacker không cần mật khẩu khi họ chạy được code trong tab của nạn nhân.

## Position

```text
XSS   attacker chạy được CODE trong origin của bạn
      → mọi thứ người dùng làm được, script cũng làm được

CSRF  attacker khiến TRÌNH DUYỆT NẠN NHÂN gửi request thay họ
      → attacker KHÔNG đọc được phản hồi, nhưng hành động vẫn xảy ra
```

Hai lỗ hổng khác nhau về bản chất, và chúng thường bị nhầm lẫn với nhau.

## Problem

Trình duyệt có một mô hình bảo mật duy nhất: **origin** (`scheme://host:port`).

```text
Same-Origin Policy: script ở origin A không đọc được dữ liệu của origin B

XSS  phá vỡ nó bằng cách chạy code TRONG origin A
CSRF đi vòng qua nó: không đọc dữ liệu, chỉ GỬI request
     (trình duyệt tự đính kèm cookie của origin A — đó là thiết kế của cookie)
```

## Mental Model

### XSS: dữ liệu bị diễn giải thành HTML/JS

Cùng hình dạng với injection SQL, khác trình thông dịch:

```text
Người dùng nhập:  <chuỗi bất kỳ>
Được chèn vào:    HTML mà trình duyệt sẽ phân tích
⇒ nếu chuỗi được PHÂN TÍCH thay vì HIỂN THỊ, nó thành mã
```

Ba dạng theo đường đi của dữ liệu:

```text
Stored     lưu vào DB, hiển thị cho NGƯỜI KHÁC   ← nguy hiểm nhất (sự cố ở đầu note)
Reflected  phản chiếu từ tham số URL              ← cần lừa nạn nhân bấm link
DOM-based  không qua server: innerHTML, eval, location.hash
           ← server log không thấy gì, dễ bị bỏ sót nhất
```

### Vì sao XSS nghiêm trọng hơn cảm giác ban đầu

```text
Script chạy trong origin của bạn ⇒ nó có MỌI thứ trang có:
  · gọi API với phiên hiện tại (cookie tự động đính kèm)
  · đọc DOM: dữ liệu đang hiển thị trên màn hình
  · đọc localStorage/sessionStorage
  · sửa giao diện: thêm form đăng nhập giả
  · thao tác thay người dùng và đọc kết quả

HttpOnly cookie giúp một điều: script không ĐỌC được cookie.
Nhưng nó vẫn GỬI được request kèm cookie đó.
⇒ HttpOnly giảm thiệt hại (không xuất được token ra ngoài), KHÔNG chặn XSS.
```

Đây là lý do "chúng tôi dùng HttpOnly nên XSS không nguy hiểm" là kết luận sai.

### Phòng thủ XSS: mã hoá theo NGỮ CẢNH

```text
Cùng một chuỗi cần xử lý KHÁC NHAU tuỳ nơi nó xuất hiện:

nội dung HTML     <div>{data}</div>            → escape < > & " '
thuộc tính        <div title="{data}">         → escape + BẮT BUỘC có dấu nháy
URL               <a href="{data}">            → chỉ cho phép http/https, encode
trong <script>    var x = "{data}"             → JSON encode; tốt nhất là ĐỪNG
CSS               style="color:{data}"         → tránh hoàn toàn
```

Tin tốt: **framework hiện đại làm việc này mặc định**.

```tsx
// ✓ React escape tự động — đây là mặc định an toàn
<div>{userContent}</div>

// ✗ những lối thoát khỏi mặc định đó
<div dangerouslySetInnerHTML={{ __html: userContent }} />   // React
<div v-html="userContent" />                                 // Vue
element.innerHTML = userContent;                             // DOM thuần
```

Gần như mọi XSS trong ứng dụng React/Vue hiện đại nằm ở một trong bốn dòng trên, hoặc ở `href` nhận URL từ người dùng.

### `href` và `src` là bề mặt bị quên

```tsx
// ✗ scheme javascript: chạy code khi bấm
<a href={userUrl}>link</a>

// ✓ chỉ cho phép scheme an toàn
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : '#';
  } catch {
    return '#';
  }
}
```

Cùng nguyên tắc cho `<img src>`, `<iframe src>`, `window.open`, và `router.push` với đích do người dùng cung cấp (cái cuối cũng là **open redirect**).

### Khi thật sự cần HTML từ người dùng

Rich text editor là nhu cầu chính đáng. Cách đúng là **sanitize bằng allowlist**, phía server nếu có thể:

```ts
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const DOMPurify = createDOMPurify(new JSDOM('').window);

const clean = DOMPurify.sanitize(userHtml, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
});
```

```text
✓ allowlist thẻ và thuộc tính     — thứ không liệt kê thì bị bỏ
✗ tự viết bộ lọc bằng regex        — HTML không phải ngôn ngữ chính quy
✓ sanitize ở SERVER khi lưu VÀ escape khi hiển thị
```

Sanitize ở client dễ bị bỏ qua (attacker gọi API trực tiếp). Sanitize ở server khi **lưu** giữ dữ liệu sạch, nhưng khi thư viện sanitize được cập nhật, dữ liệu cũ vẫn theo luật cũ — nên nhiều hệ thống sanitize ở cả hai thời điểm.

### CSP: lớp phòng thủ thứ hai

```text
Content-Security-Policy giới hạn NGUỒN script được phép chạy
→ XSS vẫn có thể tồn tại, nhưng payload không chạy được
```

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random-mỗi-request}';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
```

```text
'unsafe-inline'  → vô hiệu hoá gần như toàn bộ tác dụng của CSP
nonce            → mỗi request một giá trị ngẫu nhiên; script không có nonce đúng KHÔNG chạy
frame-ancestors  → chống clickjacking (thay cho X-Frame-Options)
base-uri 'none'  → chặn việc đổi base URL để chuyển hướng script tương đối
```

CSP là **lớp thứ hai**, không phải lớp thứ nhất. Triển khai theo thứ tự: `Content-Security-Policy-Report-Only` → xem báo cáo → sửa vi phạm → bật thật. Xem [Secure headers & TLS](07-secure-headers-tls.md).

### CSRF: cookie được gửi tự động

```text
Nạn nhân đã đăng nhập bank.com (có cookie phiên).
Nạn nhân mở evil.com, trang đó có:
     <form action="https://bank.com/transfer" method="POST"> ... </form>  (tự submit)

Trình duyệt GỬI cookie của bank.com kèm request — vì cookie gắn với ĐÍCH, không gắn với nguồn.
Attacker KHÔNG đọc được phản hồi (Same-Origin Policy), nhưng CHUYỂN KHOẢN ĐÃ XẢY RA.
```

Điều kiện để CSRF khả thi:

```text
① xác thực bằng thứ trình duyệt tự đính kèm  → cookie, HTTP Basic
② request gây THAY ĐỔI trạng thái
③ server không kiểm tra request đến TỪ ĐÂU
```

Phá vỡ bất kỳ điều kiện nào là đủ. Hệ quả quan trọng: **API dùng `Authorization: Bearer` không bị CSRF** — header đó không tự đính kèm.

### Phòng thủ CSRF theo thứ tự ưu tiên

```text
① SameSite cookie  ← lớp nền, gần như miễn phí
   Lax     (mặc định của trình duyệt hiện nay)
           không gửi cookie với POST cross-site → chặn phần lớn CSRF
           vẫn gửi với điều hướng GET cấp cao nhất → OAuth callback hoạt động
   Strict  không gửi với mọi request cross-site → an toàn hơn, nhưng
           bấm link từ email vào trang cần đăng nhập sẽ thấy trạng thái chưa đăng nhập
   None    phải kèm Secure; chỉ khi thật sự cần cross-site

② Token CSRF
   Double-submit: cookie + header/field cùng giá trị; server so khớp
   Synchronizer: token gắn với phiên ở server — mạnh hơn

③ Kiểm tra Origin / Sec-Fetch-Site cho request thay đổi trạng thái
   Sec-Fetch-Site: same-origin | same-site | cross-site | none
   → đơn giản và hiệu quả với trình duyệt hiện đại
```

```ts
// kiểm tra origin cho mọi method thay đổi trạng thái
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

if (UNSAFE.has(req.method)) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') throw new ForbiddenException('cross-site request');

  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin || new URL(origin).origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('origin mismatch');
  }
}
```

`SameSite=Lax` + kiểm tra `Origin` đủ cho đa số ứng dụng. Thêm token CSRF khi có yêu cầu tuân thủ hoặc khi phải hỗ trợ trình duyệt cũ.

### CORS không phải cơ chế chống CSRF

Đây là nhầm lẫn phổ biến nhất trong chủ đề này:

```text
CORS quyết định: "script ở origin A có ĐỌC ĐƯỢC phản hồi từ origin B không?"
CSRF quan tâm:   "request có ĐƯỢC GỬI không?"

⇒ CORS không chặn việc gửi. Form POST cross-origin vẫn đi và vẫn có tác dụng
  kể cả khi trình duyệt chặn attacker đọc phản hồi.
```

Cấu hình CORS sai còn tạo ra lỗ hổng riêng:

```text
✗ Access-Control-Allow-Origin: * kèm Allow-Credentials: true
  → trình duyệt từ chối tổ hợp này, nhưng nó cho thấy hiểu nhầm

✗ phản chiếu Origin từ request mà không kiểm tra + Allow-Credentials: true
  → bất kỳ site nào cũng đọc được dữ liệu của người dùng đã đăng nhập
  → đây là lỗ hổng nghiêm trọng, không phải cấu hình lỏng

✓ danh sách origin cho phép cụ thể
```

## Example

Cấu hình phòng thủ đầy đủ cho một ứng dụng NestJS + React dùng cookie phiên:

```ts
// main.ts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],   // tạm chấp nhận cho CSS-in-JS
      imgSrc: ["'self'", 'data:', 'https://cdn.example.com'],
      connectSrc: ["'self'", 'https://api.example.com'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

app.use(session({
  cookie: {
    httpOnly: true,     // script không đọc được
    secure: true,       // chỉ qua HTTPS
    sameSite: 'lax',    // chặn phần lớn CSRF
    maxAge: 8 * 3600_000,
  },
}));

app.enableCors({
  origin: ['https://app.example.com'],   // danh sách cụ thể, KHÔNG phản chiếu
  credentials: true,
});
```

Bốn dòng cookie ở trên bảo vệ bốn thứ khác nhau:

```text
httpOnly  → XSS không xuất được cookie ra ngoài (không chặn XSS)
secure    → không rò rỉ qua HTTP
sameSite  → chặn CSRF ở tầng trình duyệt
maxAge    → giới hạn cửa sổ khi cookie bị đánh cắp
```

Và ở phía React, hai chỗ duy nhất cần chú ý:

```tsx
// ① nội dung văn bản — React escape tự động, không cần làm gì
<article>{note.body}</article>

// ② HTML thật từ người dùng — sanitize ở server khi lưu, escape URL khi hiển thị
<article dangerouslySetInnerHTML={{ __html: note.sanitizedHtml }} />
//                                        ↑ đã sanitize phía server, KHÔNG phải note.body
```

Việc đặt tên trường là `sanitizedHtml` thay vì `html` là một biện pháp phòng thủ thật: nó khiến việc dùng nhầm trường chưa sanitize trở nên nhìn thấy được trong code review.

## Prediction

1. Cookie `HttpOnly` + có lỗ hổng XSS — attacker gọi API thay người dùng được không?
2. Token trong `localStorage` + XSS — attacker lấy được token không?
3. `<div>{userInput}</div>` trong React — có XSS không?
4. `dangerouslySetInnerHTML={{ __html: userInput }}` — có XSS không?
5. `<a href={userInput}>` với `userInput` là URL scheme `javascript:` — chuyện gì xảy ra khi bấm?
6. CSP có `'unsafe-inline'` trong `script-src` — nó chặn được gì?
7. CSP dùng nonce, attacker chèn được `<script>` không có nonce — script chạy không?
8. API dùng `Authorization: Bearer`, không có token CSRF — có bị CSRF không?
9. API dùng cookie phiên, `SameSite=Lax`, form POST từ site khác — cookie có được gửi không?
10. Cùng vậy nhưng `SameSite=None` — có được gửi không?
11. CORS chỉ cho phép `app.example.com`, form POST từ `evil.com` — request có tới server không?
12. Server phản chiếu `Origin` từ request và đặt `Allow-Credentials: true` — hậu quả?
13. `SameSite=Strict`, người dùng bấm link từ email vào trang cần đăng nhập — họ thấy gì?

<details>
<summary>Đáp án</summary>

1. **Được** — cookie tự đính kèm; script không cần đọc nó.
2. **Được** — `localStorage` không có bảo vệ nào với script cùng origin.
3. **Không** — React escape mặc định.
4. **Có** — đó là điểm thoát khỏi bảo vệ mặc định.
5. Code chạy khi bấm — XSS qua thuộc tính `href`.
6. **Gần như không gì** với XSS chèn inline script.
7. **Không** — đó là mục đích của nonce.
8. **Không** — header không tự đính kèm.
9. **Không** — `Lax` không gửi cookie với POST cross-site.
10. **Có** — và đó là lý do `None` cần biện pháp khác.
11. **Có** — CORS không chặn việc gửi, chỉ chặn việc đọc phản hồi.
12. **Bất kỳ site nào cũng đọc được dữ liệu** của người dùng đã đăng nhập — lỗ hổng nghiêm trọng.
13. **Trạng thái chưa đăng nhập** — đây là chi phí UX của `Strict`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Nhập `<b>test</b>` vào mọi ô văn bản | Hiển thị đậm = HTML được phân tích |
| Grep `dangerouslySetInnerHTML`, `v-html`, `innerHTML` | Danh sách chỗ cần xem lại |
| Đặt URL scheme `javascript:` vào trường link | Bấm thử |
| Xem CSP: `curl -I <url> \| grep -i content-security` | Có `unsafe-inline` không? |
| Xoá nonce khỏi một thẻ script hợp lệ | Có bị chặn không? |
| Xem cookie trong DevTools | `HttpOnly`, `Secure`, `SameSite` có đủ không? |
| Tạo form POST từ trang HTML local tới API | `SameSite` có chặn không? |
| Gửi request với `Origin: https://evil.com` | Server có kiểm tra không? |
| `curl -H 'Origin: https://evil.com' -I <api>` | Server có phản chiếu origin không? |
| Sửa `Sec-Fetch-Site` thành `same-origin` bằng curl | Header client cung cấp — server tin nó không? |
| Dán URL có tham số phản chiếu vào trang | Reflected XSS? |
| Nhập ghi chú có HTML, xem ở tài khoản khác | Stored XSS? |

Lưu ý ở dòng thứ mười: `Sec-Fetch-*` do **trình duyệt** đặt và trình duyệt không cho trang web ghi đè, nhưng công cụ dòng lệnh đặt được tuỳ ý. Nó là phòng thủ chống trình duyệt của nạn nhân bị lợi dụng — không phải chống client tuỳ ý.

## What Usually Goes Wrong

- **`dangerouslySetInnerHTML` với dữ liệu chưa sanitize.**
- **DOM-based XSS** qua `innerHTML`, `location.hash`, `eval` — server không thấy gì.
- **`href`/`src` nhận URL từ người dùng** mà không kiểm tra scheme.
- **Tự viết sanitizer bằng regex.**
- **Sanitize chỉ ở client** — API gọi trực tiếp bỏ qua nó.
- **CSP có `'unsafe-inline'`** → gần như không tác dụng.
- **Không có CSP** hoặc có nhưng chưa bao giờ xem báo cáo vi phạm.
- **Nhầm CORS với chống CSRF.**
- **Phản chiếu `Origin` + `credentials: true`** — lỗ hổng nghiêm trọng.
- **`SameSite=None` không cần thiết.**
- **Token CSRF có nhưng không kiểm tra ở server** (chỉ gửi kèm).
- **Coi `HttpOnly` là giải pháp cho XSS.**
- **Không escape khi render dữ liệu vào thẻ `<script>`** — ngữ cảnh khó nhất.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `HttpOnly` chặn XSS | Nó chỉ chặn việc **đọc** cookie |
| React miễn nhiễm XSS | Chỉ tới khi bạn dùng `dangerouslySetInnerHTML` hoặc `href` động |
| CORS chống CSRF | CORS về **đọc phản hồi**, CSRF về **gửi request** |
| CSP thay được escaping | Nó là lớp thứ hai |
| JWT trong header vẫn cần token CSRF | Không — header không tự đính kèm |
| Cookie luôn bị CSRF | `SameSite=Lax` chặn phần lớn |
| `SameSite=Strict` luôn tốt hơn | Nó phá trải nghiệm bấm link từ ngoài |
| Chỉ POST mới bị CSRF | GET gây thay đổi trạng thái cũng bị — và GET không nên gây thay đổi |
| Sanitize ở client là đủ | API gọi trực tiếp bỏ qua nó |
| XSS chỉ là "hiện popup" | Nó là thực thi mã trong phiên của nạn nhân |
| Escape một lần cho mọi ngữ cảnh | HTML, thuộc tính, URL, JS cần cách khác nhau |

## Debugging

1. **Xem header thực tế**: `curl -I https://app.example.com` — CSP, `Set-Cookie`, `X-Frame-Options`.
2. **CSP chặn nhầm** → Console của trình duyệt in đúng directive bị vi phạm; sửa directive, đừng thêm `unsafe-inline`.
3. **Báo cáo CSP**: dùng `Content-Security-Policy-Report-Only` với `report-uri`/`report-to` trước khi bật thật.
4. **Tìm bề mặt XSS**: `grep -rn 'dangerouslySetInnerHTML\|innerHTML\|v-html\|eval(' src/`.
5. **CSRF token luôn sai** → cookie có được gửi không? `SameSite` chặn ở bước nào? Có nhiều tab với token khác nhau không?
6. **Đăng nhập hoạt động ở dev, hỏng ở prod** → `secure: true` cần HTTPS; `sameSite` với subdomain khác nhau.
7. **OAuth callback mất phiên** → `SameSite=Strict` chặn cookie trong chuyển hướng cross-site; dùng `Lax`.
8. **Kiểm tra CORS**: `curl -H 'Origin: https://evil.com' -I <api>` — phản hồi có `Access-Control-Allow-Origin: https://evil.com` là lỗi cấu hình.

## Production Considerations

- **Dựa vào escaping mặc định của framework**; coi mọi lối thoát khỏi nó là ngoại lệ cần review.
- **Sanitize HTML bằng thư viện allowlist**, ở server, khi lưu và/hoặc khi hiển thị.
- **Kiểm tra scheme cho mọi URL từ người dùng** trước khi đưa vào `href`/`src`/redirect.
- **CSP với nonce, không `unsafe-inline`**; triển khai qua Report-Only trước.
- **`frame-ancestors 'none'`** trừ khi thật sự cần nhúng.
- **Cookie: `HttpOnly` + `Secure` + `SameSite=Lax`** là mặc định.
- **Kiểm tra `Origin`/`Sec-Fetch-Site` cho mọi method thay đổi trạng thái.**
- **CORS: danh sách origin cụ thể**, không bao giờ phản chiếu, không `*` với credentials.
- **GET không được gây thay đổi trạng thái** — đây vừa là nguyên tắc HTTP vừa là biện pháp CSRF.
- **Nội dung người dùng tải lên phục vụ từ tên miền riêng** — xem [Security basics](01-security-basics.md).
- **Test hồi quy**: một bộ input HTML cố định chạy qua mọi trường văn bản trong CI.
- **Xem báo cáo CSP định kỳ** — nó cũng là hệ thống phát hiện script lạ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Escape mặc định, không cho HTML | an toàn nhất | không có định dạng phong phú |
| Sanitize allowlist | cho phép rich text | phụ thuộc thư viện, phải cập nhật |
| CSP nghiêm ngặt | XSS khó khai thác | công sức cấu hình, phá script bên thứ ba |
| CSP có `unsafe-inline` | dễ triển khai | gần như không bảo vệ |
| `SameSite=Lax` | chặn phần lớn CSRF, UX tốt | không chặn 100% |
| `SameSite=Strict` | chặn triệt để hơn | bấm link từ ngoài mất trạng thái |
| Token CSRF | không phụ thuộc trình duyệt | phức tạp, race giữa nhiều tab |
| Kiểm tra `Origin` | đơn giản, hiệu quả | dựa vào header trình duyệt đặt |
| Bearer token thay cookie | không bị CSRF | phải lưu token ở client → XSS |

## Explain Without Notes

1. XSS và CSRF khác nhau ở điều gì? Attacker đạt được gì trong mỗi trường hợp?
2. Vì sao `HttpOnly` không chặn XSS?
3. Ba dạng XSS và vì sao DOM-based khó phát hiện nhất?
4. Vì sao escaping phải theo ngữ cảnh? Cho ba ngữ cảnh khác nhau.
5. CSP nonce hoạt động thế nào, và vì sao `unsafe-inline` phá hỏng nó?
6. Ba điều kiện để CSRF khả thi, và cách phá vỡ từng điều kiện.
7. Vì sao CORS không phải cơ chế chống CSRF?
8. `SameSite=Lax` và `Strict` khác nhau ở đâu về hành vi và về UX?

## Related

- [Injection](02-injection.md) — cùng hình dạng, khác trình thông dịch
- [Security basics](01-security-basics.md) — ranh giới tin cậy
- [Secure headers & TLS](07-secure-headers-tls.md) — CSP và các header khác
- [Session vs token](../../02-backend-api/03-auth/02-session-vs-token.md) — nơi lưu credential
- [OAuth 2 & OIDC](../../02-backend-api/03-auth/04-oauth-oidc.md) — `state` chống CSRF đăng nhập
- [Cookies & storage](../../01-web-frontend/00-web-foundations/05-cookies-storage.md) — cơ chế cookie
- [Access control](04-access-control.md) — điều attacker làm được sau khi có XSS

## Version / Context

Hành vi `SameSite=Lax` là mặc định ở Chrome (từ v80), Firefox và Safari hiện nay; đừng dựa vào mặc định — đặt tường minh. `Sec-Fetch-*` được hỗ trợ ở mọi trình duyệt hiện đại. CSP Level 3 (`nonce`, `strict-dynamic`). Thư viện: `helmet` cho header, `DOMPurify` cho sanitize. Nội dung tập trung vào **phòng thủ**: không cung cấp payload khai thác.
