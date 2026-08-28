---
level: intermediate
area: cross-cutting
prerequisites:
  - 03-xss-csrf.md
related:
  - ../../04-infrastructure/01-networking/03-tls.md
  - ../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md
---

# Secure headers & TLS

> Sau khi bật HTTPS, team đánh dấu hạng mục bảo mật truyền tải là xong. Sáu tháng sau, một người dùng ở quán cà phê gõ `example.com` vào thanh địa chỉ. Trình duyệt gửi request **HTTP** đầu tiên (vì người dùng không gõ `https://`), và request đó bị can thiệp trước khi kịp chuyển hướng. HTTPS đã bật đúng — nhưng **request đầu tiên không bao giờ dùng nó**.

## Position

```text
Trình duyệt ←──────── header ────────→ Server
              ↑ chỉ thị cách trình duyệt XỬ LÝ trang của bạn

TLS bảo vệ ĐƯỜNG TRUYỀN.
Header bảo vệ NHỮNG GÌ TRÌNH DUYỆT LÀM với nội dung đã nhận.
```

## Problem

```text
Trình duyệt mặc định RỘNG RÃI vì tương thích ngược:
  · nhúng trang của bạn vào iframe của người khác → được
  · chạy script inline bất kỳ → được
  · gửi URL đầy đủ sang site khác qua Referer → được
  · thử HTTP trước khi biết bạn có HTTPS → được

⇒ Header bảo mật là cách BÁO CHO TRÌNH DUYỆT thu hẹp những mặc định đó.
   Không có header = trình duyệt vẫn dùng mặc định rộng rãi.
```

## Mental Model

### HSTS: giải quyết vấn đề "request đầu tiên"

```text
Không có HSTS:
  người dùng gõ "example.com"
  → trình duyệt thử HTTP
  → server trả 301 sang HTTPS
  ↑ request HTTP này ĐÃ ĐI QUA MẠNG và có thể bị can thiệp

Có HSTS (sau lần truy cập HTTPS đầu tiên):
  người dùng gõ "example.com"
  → trình duyệt TỰ CHUYỂN sang HTTPS trước khi gửi bất cứ gì
  ↑ không có request HTTP nào tồn tại
```

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
                                    ↑ 1 năm      ↑ mọi subdomain   ↑ danh sách nạp sẵn
```

```text
Vẫn còn khoảng trống: LẦN TRUY CẬP ĐẦU TIÊN, trước khi trình duyệt biết header này.
→ `preload` đóng nốt: tên miền nằm sẵn trong trình duyệt khi phát hành.
→ nhưng gỡ khỏi danh sách preload mất HÀNG THÁNG.
  Chỉ đăng ký khi chắc chắn mọi subdomain sẽ luôn có HTTPS.
```

`includeSubDomains` là phần hay gây sự cố: một subdomain nội bộ chỉ chạy HTTP sẽ **không truy cập được** sau khi bật. Kiểm kê subdomain trước.

### Bảng header và điều mỗi cái thực sự làm

```text
Strict-Transport-Security     bắt buộc HTTPS ở phía trình duyệt
Content-Security-Policy       giới hạn nguồn script/style/frame — lớp hai chống XSS
X-Content-Type-Options: nosniff  cấm trình duyệt đoán kiểu nội dung
                              → chặn file được phục vụ sai Content-Type bị chạy như script
Referrer-Policy               giới hạn thông tin URL gửi sang site khác
Permissions-Policy            tắt API trình duyệt không dùng (camera, mic, geolocation)
Cross-Origin-Opener-Policy    tách browsing context → chặn tấn công qua cửa sổ mở
Cross-Origin-Resource-Policy  giới hạn ai nhúng được tài nguyên của bạn
frame-ancestors (trong CSP)   chống clickjacking — thay cho X-Frame-Options
```

```text
X-XSS-Protection      ĐÃ LỖI THỜI — trình duyệt hiện đại bỏ qua; bản thân nó từng gây lỗ hổng
X-Frame-Options       vẫn hoạt động, nhưng `frame-ancestors` mạnh hơn và linh hoạt hơn
```

Nếu tài liệu bạn đang đọc khuyên bật `X-XSS-Protection: 1; mode=block`, nó đã cũ.

### `Referrer-Policy` rò rỉ nhiều hơn bạn nghĩ

```text
Mặc định của nhiều trình duyệt: strict-origin-when-cross-origin (đã khá tốt)
Nhưng nếu server đặt `unsafe-url` hoặc để mặc định cũ:

  người dùng ở /invoices/8421/edit?token=abc bấm link ra ngoài
  → site kia nhận TOÀN BỘ URL, gồm cả ID và tham số
```

```text
strict-origin-when-cross-origin   cùng origin: URL đầy đủ; khác origin: chỉ origin  ← mặc định tốt
no-referrer                        không gửi gì — an toàn nhất, đôi khi phá analytics
```

Bài học sâu hơn: **đừng đặt thông tin nhạy cảm vào URL** ngay từ đầu. URL xuất hiện trong `Referer`, log server, log proxy, lịch sử trình duyệt, và trong thanh địa chỉ khi chia sẻ màn hình.

### Cấu hình TLS: ba quyết định

```text
① PHIÊN BẢN   TLS 1.2 + 1.3. Tắt 1.0/1.1 (đã ngừng hỗ trợ).
               TLS 1.3: bắt tay 1 vòng thay vì 2 → nhanh hơn rõ rệt.

② BỘ MÃ       chỉ giữ bộ có forward secrecy (ECDHE)
               → khoá riêng bị lộ SAU này không giải mã được traffic ĐÃ ghi lại

③ CHỨNG CHỈ   chuỗi ĐẦY ĐỦ (leaf + intermediate)
               → thiếu intermediate: trình duyệt thường vẫn OK (nó cache),
                 `curl` và client khác thì lỗi ← nguồn của rất nhiều báo lỗi khó hiểu
```

### Nơi TLS kết thúc quyết định điều gì được bảo vệ

```text
Client ──TLS──> Load Balancer ──?──> Pod
                     ↑ TLS TERMINATION

Sau điểm này, traffic có thể là plaintext trong mạng nội bộ.
Chấp nhận được nếu mạng nội bộ đáng tin cậy; không chấp nhận được nếu:
  · yêu cầu tuân thủ đòi hỏi mã hoá đầu-cuối
  · mạng nội bộ chia sẻ với bên khác
  · mô hình zero-trust
→ khi đó cần mTLS giữa các service (service mesh làm việc này)
```

Hệ quả thực tế quan trọng nhất của TLS termination: **app không biết request gốc là HTTP hay HTTPS**.

```text
X-Forwarded-Proto: https    ← proxy nói cho app biết
X-Forwarded-For: <client>   ← IP thật của client

app.set('trust proxy', 1)   ← Express: TIN header này (chỉ từ proxy tin cậy)
```

```text
Không cấu hình trust proxy:
  · cookie `secure: true` không được đặt (app tưởng đang chạy HTTP)
  · redirect sang HTTPS thành vòng lặp vô hạn
  · rate limit theo IP thấy toàn IP của load balancer

Cấu hình SAI (tin mọi nguồn):
  · client tự đặt X-Forwarded-For → vượt qua rate limit và log sai IP
```

Cả hai lỗi đều phổ biến, và lỗi thứ hai nguy hiểm hơn vì nó im lặng.

### Chứng chỉ và tự động gia hạn

```text
Let's Encrypt: 90 ngày. Tự động hoá là bắt buộc, không phải tuỳ chọn.

Ba thứ phải có:
  ① gia hạn tự động (cert-manager trên K8s, certbot trên VM)
  ② MONITORING ngày hết hạn — cảnh báo trước 21 ngày
     → tự động hoá cũng hỏng; monitoring là thứ phát hiện điều đó
  ③ RELOAD sau khi gia hạn
     → nginx cần `nginx -s reload`; nhiều sự cố đến từ cert mới trên đĩa
       mà process cũ vẫn giữ cert cũ trong bộ nhớ
```

Điểm ③ là nguyên nhân của một loại sự cố đặc biệt khó chịu: chứng chỉ đã gia hạn thành công nhưng hệ thống vẫn phục vụ chứng chỉ hết hạn.

### Cookie: các thuộc tính là một phần của lớp này

```text
Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800

HttpOnly   script không đọc được
Secure     chỉ gửi qua HTTPS
SameSite   chống CSRF
Path       thu hẹp phạm vi gửi
__Host-    tiền tố: buộc Secure + Path=/ + KHÔNG có Domain
           → cookie không thể bị đặt bởi subdomain khác
           → biện pháp mạnh chống session fixation qua subdomain bị chiếm
```

Tiền tố `__Host-` ít được dùng nhưng rất hiệu quả trong hệ thống có nhiều subdomain: nó khiến một subdomain bị chiếm không đặt được cookie phiên cho domain chính.

## Example

Cấu hình đầy đủ cho NestJS sau reverse proxy:

```ts
// main.ts
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';

const app = await NestFactory.create(AppModule);

app.set('trust proxy', 1);               // ① TIN đúng một lớp proxy phía trước

app.use((req, res, next) => {            // ② nonce mới mỗi request
  res.locals.cspNonce = randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  strictTransportSecurity: {
    maxAge: 31_536_000,
    includeSubDomains: true,
    preload: false,                       // ③ chỉ bật khi CHẮC CHẮN
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (_req, res: any) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://cdn.example.com'],
      connectSrc: ["'self'", 'https://api.example.com'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],         // ④ chống clickjacking
      formAction: ["'self'"],             // ⑤ form không submit ra ngoài
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  xFrameOptions: false,                   // ⑥ frameAncestors đã lo; tránh trùng lặp
}));

app.use((_req, res, next) => {            // ⑦ helmet chưa đặt cái này
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
```

Và ở tầng nginx, phần TLS:

```nginx
server {
    listen 443 ssl;
    http2 on;

    ssl_certificate     /etc/ssl/fullchain.pem;   # leaf + intermediate — KHÔNG chỉ leaf
    ssl_certificate_key /etc/ssl/privkey.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;                # để client chọn — tốt hơn với TLS 1.3
    ssl_session_cache   shared:SSL:10m;
    ssl_stapling on;                              # OCSP stapling: client không phải tự hỏi CA
    ssl_stapling_verify on;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header X-Forwarded-Proto $scheme;   # app cần cái này
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    return 301 https://$host$request_uri;         # vẫn cần cho request HTTP đầu tiên
}
```

Chuyển hướng 80→443 vẫn cần thiết **kể cả khi có HSTS** — nó phục vụ những client chưa từng truy cập và chưa có header HSTS trong bộ nhớ.

## Prediction

1. HTTPS bật, không có HSTS, người dùng gõ `example.com` — request đầu tiên đi bằng gì?
2. Có HSTS và người dùng đã truy cập trước đó — request đầu tiên đi bằng gì?
3. Bật `includeSubDomains` nhưng có subdomain nội bộ chỉ chạy HTTP — chuyện gì xảy ra?
4. Đăng ký `preload` rồi phát hiện sai — gỡ mất bao lâu?
5. Chỉ phục vụ leaf certificate, không có intermediate — browser và `curl` phản ứng thế nào?
6. TLS terminate ở LB, app không cấu hình `trust proxy`, cookie `secure: true` — cookie có được đặt không?
7. `trust proxy` tin mọi nguồn, client tự đặt `X-Forwarded-For` — rate limit theo IP còn tác dụng không?
8. Cert được gia hạn trên đĩa nhưng nginx không reload — client thấy cert nào?
9. `Referrer-Policy: unsafe-url`, người dùng ở `/invoices/8421?token=x` bấm link ra ngoài — site kia nhận gì?
10. CSP có `frame-ancestors 'none'`, ai đó nhúng trang vào iframe — kết quả?
11. Không có `X-Content-Type-Options: nosniff`, file text được phục vụ với Content-Type sai — trình duyệt làm gì?
12. Chỉ có HSTS, không có redirect 80→443, client mới hoàn toàn gõ `http://` — chuyện gì xảy ra?
13. Cookie không có tiền tố `__Host-`, một subdomain bị chiếm — họ làm được gì với cookie phiên?

<details>
<summary>Đáp án</summary>

1. **HTTP** — và request đó có thể bị can thiệp trước khi redirect.
2. **HTTPS** — trình duyệt tự chuyển, không có request HTTP nào.
3. Subdomain đó **không truy cập được** qua trình duyệt.
4. **Hàng tháng** — phải chờ chu kỳ phát hành trình duyệt.
5. Browser thường **vẫn OK** (cache intermediate); `curl` và nhiều client khác **báo lỗi cert**.
6. **Không** — app tưởng đang chạy HTTP nên bỏ qua cookie `secure`.
7. **Không** — client giả mạo được IP; log cũng sai.
8. **Cert cũ** đã hết hạn — process giữ nó trong bộ nhớ.
9. **URL đầy đủ** gồm ID và token.
10. Iframe **trống** hoặc bị chặn.
11. Có thể **đoán kiểu** và xử lý nội dung như script.
12. Request HTTP không được trả lời đúng — thường là lỗi kết nối hoặc trang trống.
13. Đặt cookie cho **domain cha** — có thể ép phiên (session fixation).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `curl -I https://<host>` | Header nào thật sự có? |
| `curl -I http://<host>` | Có redirect 301 sang HTTPS không? |
| `openssl s_client -connect host:443 -servername host` | Chuỗi cert, phiên bản TLS, bộ mã |
| `curl -v https://<host>` từ máy sạch | Thiếu intermediate sẽ lộ ra ở đây |
| Nhúng trang vào iframe trên trang HTML local | `frame-ancestors` có chặn không? |
| Xoá nonce khỏi một thẻ script | CSP có chặn không? |
| Xem Console khi tải trang | Vi phạm CSP nào đang bị bỏ qua? |
| Gửi `X-Forwarded-For: 1.2.3.4` từ ngoài | Log ghi IP nào? |
| Đặt `X-Forwarded-Proto: https` từ ngoài | App có tin không? |
| Xem cookie trong DevTools | Đủ `HttpOnly`/`Secure`/`SameSite` chưa? |
| `echo \| openssl s_client -connect host:443 2>/dev/null \| openssl x509 -noout -dates` | Còn bao nhiêu ngày? |
| Bấm link ra ngoài từ trang có tham số nhạy cảm | `Referer` chứa gì? |

## What Usually Goes Wrong

- **Không có HSTS** → request đầu tiên vẫn đi bằng HTTP.
- **`includeSubDomains` bật mà chưa kiểm kê subdomain.**
- **`preload` đăng ký quá sớm** — khó gỡ.
- **Thiếu intermediate certificate** → browser OK, client khác lỗi.
- **Không cấu hình `trust proxy`** → cookie secure không đặt được, redirect vòng lặp.
- **Tin `X-Forwarded-*` từ mọi nguồn** → giả mạo IP.
- **Không reload sau khi gia hạn cert.**
- **Không monitor ngày hết hạn** — dựa hoàn toàn vào tự động hoá.
- **CSP có `unsafe-inline`** → gần như không tác dụng.
- **CSP bật thẳng không qua Report-Only** → phá trang, bị tắt vội.
- **Header đặt ở cả proxy và app**, khác nhau → hành vi khó đoán.
- **Vẫn đặt `X-XSS-Protection`** — lỗi thời.
- **Thông tin nhạy cảm trong URL** → rò rỉ qua `Referer` và log.
- **TLS chỉ tới LB** trong khi yêu cầu là mã hoá đầu-cuối.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| HTTPS là đủ cho bảo mật truyền tải | Request đầu tiên vẫn có thể là HTTP |
| HSTS bảo vệ ngay từ lần đầu | Chỉ sau lần truy cập HTTPS đầu tiên, trừ khi có preload |
| Có HSTS rồi thì bỏ redirect 80→443 | Vẫn cần cho client chưa có header |
| Header bảo mật làm trang chậm | Chúng là vài trăm byte |
| Cert hợp lệ trên browser là hợp lệ với mọi client | Browser cache intermediate; client khác thì không |
| Cert gia hạn xong là xong | Process phải reload |
| CSP thay được escaping | Nó là lớp thứ hai |
| `X-XSS-Protection` giúp chống XSS | Nó lỗi thời và từng gây lỗ hổng |
| `X-Frame-Options` là cách đúng | `frame-ancestors` mạnh hơn |
| Tin `X-Forwarded-For` là bình thường | Chỉ khi đến từ proxy bạn kiểm soát |
| TLS 1.3 chỉ là bảo mật hơn | Nó còn nhanh hơn rõ rệt (bắt tay 1-RTT) |

## Debugging

1. **`curl -I https://<host>`** — danh sách header thật, không phải header bạn nghĩ đã cấu hình.
2. **Header bị trùng hoặc thiếu** → kiểm tra cả proxy và app; quyết định một nơi duy nhất đặt chúng.
3. **`openssl s_client -connect host:443 -servername host`** — chuỗi cert, phiên bản, bộ mã. `-servername` bắt buộc khi có SNI.
4. **Browser OK, `curl` lỗi cert** → gần như chắc chắn thiếu intermediate.
5. **Redirect vòng lặp vô hạn** → app không thấy `X-Forwarded-Proto`, tự redirect sang HTTPS mãi.
6. **Cookie không được đặt trong production** → `secure: true` + app tưởng đang chạy HTTP.
7. **CSP phá trang** → Console in đúng directive bị vi phạm; sửa directive, không thêm `unsafe-inline`.
8. **Cert hết hạn dù có tự động gia hạn** → kiểm tra cert trên đĩa (`openssl x509 -noout -dates`) so với cert đang phục vụ; khác nhau = thiếu reload.
9. **Kiểm tra tổng thể**: SSL Labs (mạng ngoài) hoặc `testssl.sh` (nội bộ).

## Production Considerations

- **HSTS `max-age` 1 năm**; `includeSubDomains` sau khi kiểm kê; `preload` chỉ khi chắc chắn lâu dài.
- **Giữ redirect 80→443** kể cả khi có HSTS.
- **TLS 1.2 + 1.3**, bộ mã có forward secrecy, OCSP stapling.
- **Phục vụ chuỗi chứng chỉ đầy đủ.**
- **Tự động gia hạn + monitor ngày hết hạn + reload sau gia hạn** — cả ba, không phải một.
- **`trust proxy` đúng số lớp**, không tin mọi nguồn.
- **CSP với nonce**, triển khai qua Report-Only trước, xem báo cáo định kỳ.
- **`frame-ancestors 'none'`** trừ khi cần nhúng; bỏ `X-Frame-Options` để tránh cấu hình hai nơi.
- **`nosniff`, `Referrer-Policy`, `Permissions-Policy`** là mặc định nên có.
- **Cookie `__Host-` prefix** cho cookie phiên khi không cần chia sẻ giữa subdomain.
- **Đặt header ở MỘT nơi** (proxy hoặc app) và ghi rõ nơi đó ở tài liệu.
- **Không đặt dữ liệu nhạy cảm trong URL.**
- **mTLS giữa service** nếu mạng nội bộ không đáng tin hoặc có yêu cầu tuân thủ.
- **Kiểm tra cấu hình TLS định kỳ** — khuyến nghị về bộ mã thay đổi theo thời gian.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| HSTS `max-age` dài | bảo vệ tốt hơn | sai sót khó khắc phục nhanh |
| `includeSubDomains` | phủ toàn bộ | subdomain HTTP ngừng hoạt động |
| `preload` | bảo vệ cả lần đầu | gỡ mất hàng tháng |
| CSP nghiêm ngặt | XSS khó khai thác | công sức, phá script bên thứ ba |
| CSP Report-Only | không phá gì | không bảo vệ gì cho tới khi bật thật |
| TLS terminate ở LB | đơn giản, giảm tải app | plaintext trong mạng nội bộ |
| mTLS đầu-cuối | mã hoá toàn tuyến | phức tạp, quản lý cert nội bộ |
| `no-referrer` | không rò rỉ URL | mất dữ liệu analytics |
| Header ở proxy | tập trung | app dev không thấy khi chạy local |
| Header ở app | nhất quán mọi môi trường | mỗi service phải tự cấu hình |

## Explain Without Notes

1. Vấn đề "request đầu tiên" là gì, và HSTS giải quyết nó thế nào?
2. Vì sao vẫn cần redirect 80→443 khi đã có HSTS?
3. Vì sao browser chấp nhận cert mà `curl` báo lỗi?
4. `trust proxy` ảnh hưởng tới ba thứ nào trong ứng dụng?
5. Vì sao tin `X-Forwarded-For` từ mọi nguồn là lỗ hổng?
6. Ba thứ cần có cho quản lý chứng chỉ, và vì sao tự động gia hạn không đủ?
7. `frame-ancestors` và `X-Frame-Options` khác nhau ra sao?
8. Tiền tố cookie `__Host-` bảo vệ khỏi điều gì?

## Related

- [XSS & CSRF](03-xss-csrf.md) — CSP là lớp hai chống XSS
- [Security basics](01-security-basics.md) — mô hình đe doạ
- [TLS](../../04-infrastructure/01-networking/03-tls.md) — bắt tay, chuỗi tin cậy, SNI
- [Reverse proxy & load balancer](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — nơi TLS kết thúc
- [Ingress & service discovery](../../04-infrastructure/04-kubernetes/workloads-networking/02-ingress-service-discovery.md) — cert trong K8s
- [Session vs token](../../02-backend-api/03-auth/02-session-vs-token.md) — thuộc tính cookie
- [Cookies & storage](../../01-web-frontend/00-web-foundations/05-cookies-storage.md) — cơ chế cookie

## Version / Context

`helmet` v7+ (tên option dạng camelCase; các bản cũ dùng tên khác). nginx 1.25+ dùng `http2 on;` thay cho `listen ... http2`. TLS 1.0/1.1 đã ngừng hỗ trợ (RFC 8996). `X-XSS-Protection` đã bị loại bỏ khỏi mọi trình duyệt hiện đại. CSP Level 3. Danh sách HSTS preload do Chromium duy trì và được các trình duyệt khác dùng lại.
