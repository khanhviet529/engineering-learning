---
level: intermediate
area: infra
prerequisites:
  - 00-network-vocabulary.md
  - 02-tcp-udp.md
related:
  - 05-reverse-proxy-load-balancer.md
  - ../../05-cross-cutting/security/07-secure-headers-tls.md
---

# TLS

> Lúc 02:14 sáng thứ Bảy, mọi request tới API trả về lỗi certificate. Không ai deploy gì. Không ai đổi cấu hình. Certificate hết hạn — và nó hết hạn vào đúng thời điểm đó vì nó được cấp đúng 90 ngày trước, và job tự động gia hạn đã lặng lẽ thất bại từ tuần thứ hai.

> **Chưa biết những từ này?** [Từ vựng Network](00-network-vocabulary.md) — TLS, certificate, CA

## Position

```text
HTTP
  ↓
TLS   ← xác thực server + mã hoá + toàn vẹn
  ↓
TCP
```

TLS làm ba việc, và người ta thường chỉ nhớ một:

```text
① MÃ HOÁ        không ai đọc được nội dung
② XÁC THỰC      bạn đang nói chuyện với ĐÚNG server   ← quan trọng nhất
③ TOÀN VẸN      không ai sửa được nội dung trên đường
```

Nếu chỉ cần mã hoá, bất kỳ khoá nào cũng đủ. Việc khó — và toàn bộ hệ thống certificate authority tồn tại vì nó — là ②.

## Problem

Không có TLS, ba tấn công đều tầm thường:

```text
· Đọc trộm      Wi-Fi công cộng, ISP, bất kỳ ai trên đường đi
· Giả mạo       tôi nói tôi là api.bank.com — ai kiểm chứng?
· Sửa nội dung  chèn script vào HTML, đổi số tài khoản trong response
```

Và các lớp lỗi thực tế khi có TLS:

```text
① Certificate hết hạn                → sự cố toàn hệ thống, thường vào cuối tuần
② SAN không khớp hostname            → "certificate name mismatch"
③ Thiếu intermediate certificate     → trình duyệt OK, curl/Java FAIL
④ Chain không hợp lệ trong container → "unable to get local issuer certificate"
⑤ Tự ký hoặc CA nội bộ không được tin → mọi client phải cấu hình
```

Lỗi ③ đặc biệt khó chịu vì nó **không đồng nhất giữa các client**, nên "trên trình duyệt vẫn được" làm người ta nghi ngờ sai chỗ.

## Mental Model

### Chain of trust

```text
Root CA           (đã có sẵn trong OS/browser, tự ký)
   │ ký
Intermediate CA
   │ ký
Certificate của bạn (api.example.com)
```

Client tin root CA vì nó nằm sẵn trong trust store. Để xác minh certificate của bạn, client phải dựng được **toàn bộ chuỗi** tới một root nó tin.

Và đây là nguồn của lỗi ③:

```text
Server PHẢI gửi: certificate của mình + INTERMEDIATE
Server KHÔNG cần gửi root (client đã có)

Thiếu intermediate:
  · trình duyệt thường TỰ TẢI VỀ (AIA fetching) → có vẻ ổn
  · curl, Java, Go, Python thường KHÔNG → FAIL
```

Vì thế: **luôn test bằng `openssl` hoặc `curl`, không chỉ bằng trình duyệt.**

### Bắt tay TLS

```text
TLS 1.2:  2 RTT
TLS 1.3:  1 RTT  (0-RTT khi nối lại phiên — nhưng có rủi ro replay)

Client ── ClientHello (phiên bản, cipher, SNI) ──▶ Server
Client ◀── ServerHello + CERTIFICATE ─────────── Server
Client    xác minh chuỗi + hostname + hạn
Client ── trao đổi khoá ───────────────────────▶ Server
          (từ đây trở đi mã hoá)
```

`SNI` (Server Name Indication) trong ClientHello là lý do nhiều domain dùng chung một IP được: server đọc SNI để biết trả certificate nào. Hệ quả: **SNI được gửi ở dạng rõ** trong TLS 1.2 — người quan sát biết bạn truy cập domain nào dù không đọc được nội dung. (TLS 1.3 với ECH mã hoá cả SNI, nhưng chưa phổ biến.)

Và hệ quả thực tế: nếu client cũ không gửi SNI, server không biết trả cert nào và trả cert mặc định — gây lỗi name mismatch.

### Client xác minh ba thứ

```text
① CHUỖI hợp lệ tới một root được tin
② HOSTNAME khớp: SAN (Subject Alternative Name) chứa tên bạn gọi
③ THỜI HẠN: notBefore ≤ hiện tại ≤ notAfter
```

Về ②: **CN (Common Name) đã lỗi thời.** Trình duyệt hiện đại chỉ đọc SAN. Certificate chỉ có CN mà không có SAN sẽ bị từ chối.

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
```

Wildcard `*.example.com` chỉ khớp **một cấp**:

```text
*.example.com  khớp  api.example.com     ✓
               KHÔNG khớp  a.b.example.com  ✗
               KHÔNG khớp  example.com      ✗  (phải thêm SAN riêng)
```

Dòng cuối là lỗi phổ biến: mua wildcard rồi phát hiện domain gốc không được bảo vệ.

### Terminate TLS ở đâu

```text
① Ở LOAD BALANCER / INGRESS         ← phổ biến nhất
   Client ──TLS──▶ LB ──HTTP (rõ)──▶ App
   + một chỗ quản lý cert, app đơn giản, LB đọc được header để routing
   - traffic nội bộ KHÔNG mã hoá

② Passthrough tới app
   Client ──────TLS───────▶ App
   + mã hoá đầu-cuối
   - mỗi app phải quản lý cert; LB không đọc được header (chỉ TCP)

③ Re-encrypt
   Client ──TLS──▶ LB ──TLS──▶ App
   + mã hoá cả trong nội bộ, LB vẫn đọc được header
   - hai lớp cert phải quản lý, thêm CPU

④ Service mesh (mTLS tự động)
   + mTLS mọi nơi, xoay cert tự động, không sửa app
   - thêm một tầng hạ tầng phức tạp
```

Mặc định thực dụng: ① cho hầu hết hệ thống; ③ hoặc ④ khi có yêu cầu tuân thủ hoặc mạng nội bộ không đáng tin.

Với ①, nhớ rằng app không còn biết request là HTTPS — nó phải đọc `X-Forwarded-Proto`. Xem [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md).

### mTLS: cả hai bên xuất trình certificate

```text
TLS thường:  client xác minh SERVER
mTLS:        cả hai xác minh lẫn nhau
```

Dùng cho: giao tiếp service-to-service, API có đối tác cố định, thiết bị IoT. Nó thay thế API key bằng danh tính có thể thu hồi và hết hạn tự động.

Cái giá: phải phát hành, phân phối và **xoay vòng** certificate cho mọi client — đó là lý do service mesh tồn tại.

### Let's Encrypt và tự động gia hạn

```text
Certificate 90 ngày → BẮT BUỘC tự động hoá
```

Ba cách xác minh quyền sở hữu domain:

```text
HTTP-01   đặt file ở /.well-known/acme-challenge/
          cần port 80 mở; KHÔNG hỗ trợ wildcard
DNS-01    tạo TXT record
          hỗ trợ wildcard; cần quyền API của DNS provider
TLS-ALPN-01  qua chính kết nối TLS trên port 443
```

Và điều quan trọng hơn công cụ: **gia hạn tự động phải được giám sát.**

```bash
# alert khi cert còn dưới 21 ngày
echo | openssl s_client -connect api.example.com:443 -servername api.example.com 2>/dev/null \
  | openssl x509 -noout -checkend $((21*86400)) || echo "CERT SẮP HẾT HẠN"
```

Sự cố ở đầu note không phải do thiếu tự động hoá — nó do **tự động hoá thất bại im lặng**. Một cron job gia hạn không có alert là một cron job sẽ hỏng.

### Certificate trong container

```text
"unable to get local issuer certificate" trong image tối giản
   → image không có CA bundle
```

```dockerfile
FROM alpine
RUN apk add --no-cache ca-certificates
# Debian/Ubuntu: apt-get install -y ca-certificates
```

Với `FROM scratch`, phải copy bundle vào:

```dockerfile
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
```

Và với CA nội bộ, phải thêm vào trust store của mọi client — đây là chi phí ẩn của việc dùng CA riêng.

### Điều KHÔNG nên làm

```ts
// ❌ tắt xác minh — biến TLS thành chỉ-mã-hoá, mất hoàn toàn phần XÁC THỰC
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
new https.Agent({ rejectUnauthorized: false });
curl -k
```

Nó "sửa" lỗi certificate bằng cách bỏ đi thứ có giá trị nhất của TLS: **bạn không còn biết mình đang nói chuyện với ai.** Man-in-the-middle trở nên tầm thường.

Nếu vấn đề là CA nội bộ, giải pháp đúng là **thêm CA đó vào trust store**, không phải tắt xác minh:

```bash
NODE_EXTRA_CA_CERTS=/etc/ssl/internal-ca.crt node app.js
```

## Example

Chẩn đoán lỗi certificate:

```bash
# 1. Xem toàn bộ chuỗi và kết quả xác minh
openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts </dev/null
# Certificate chain
#  0 s:CN=api.example.com   i:C=US, O=Let's Encrypt, CN=R3
#  1 s:CN=R3                i:CN=ISRG Root X1        ← intermediate CÓ mặt
# Verify return code: 0 (ok)
#
# Nếu chỉ có "0 s:..." và không có "1 s:..." → THIẾU INTERMEDIATE

# 2. Hạn và SAN
echo | openssl s_client -connect api.example.com:443 -servername api.example.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
# notAfter=Apr 15 10:00:00 2026 GMT
# X509v3 Subject Alternative Name: DNS:api.example.com, DNS:www.example.com

# 3. Còn bao nhiêu ngày
echo | openssl s_client -connect api.example.com:443 2>/dev/null \
  | openssl x509 -noout -checkend $((30*86400)) && echo "còn >30 ngày" || echo "SẮP HẾT HẠN"

# 4. Phiên bản TLS và cipher
openssl s_client -connect api.example.com:443 -tls1_3 </dev/null 2>&1 | grep -E 'Protocol|Cipher'

# 5. Từ chính client bị lỗi (quan trọng — trust store khác nhau)
curl -v https://api.example.com/ 2>&1 | grep -E 'SSL|subject|issuer|expire'
```

Bước 5 là bước hay bị bỏ: `openssl` trên máy bạn dùng trust store của máy bạn. Nếu lỗi chỉ xảy ra trong container, phải chạy từ trong container đó.

## Prediction

1. Certificate hết hạn lúc 02:14 — bao nhiêu request bị ảnh hưởng?
2. Server thiếu intermediate certificate — trình duyệt thế nào? `curl` thế nào? Java thế nào?
3. Certificate cho `*.example.com`, gọi `api.example.com` — khớp không?
4. Gọi `example.com` (không có subdomain) — khớp không?
5. Gọi `a.b.example.com` — khớp không?
6. Certificate chỉ có CN, không có SAN — trình duyệt hiện đại chấp nhận không?
7. Client cũ không gửi SNI, server host nhiều domain — nhận cert nào?
8. TLS terminate ở LB, app đọc `req.protocol` — trả về gì?
9. `NODE_TLS_REJECT_UNAUTHORIZED=0` — mất tính chất nào của TLS?
10. Image `FROM scratch`, app gọi HTTPS ra ngoài — lỗi gì?
11. TLS 1.2 vs 1.3, RTT 100ms — chênh bao nhiêu ms cho bắt tay?
12. Với keep-alive, request thứ hai — có bắt tay TLS lại không?
13. Cron gia hạn cert thất bại từ tuần thứ hai, không có alert — bao lâu tới sự cố?

<details>
<summary>Đáp án</summary>

1. **Tất cả** — mọi client từ chối kết nối. Đây là sự cố toàn hệ thống, không phải suy giảm dần.
2. Trình duyệt thường **OK** (tự tải intermediate qua AIA). `curl`, Java, Go, Python thường **FAIL**.
3. **Khớp.**
4. **Không** — wildcard không khớp domain gốc. Cần SAN riêng cho `example.com`.
5. **Không** — wildcard chỉ khớp một cấp.
6. **Không** — trình duyệt hiện đại yêu cầu SAN.
7. Cert **mặc định** của server → thường gây lỗi name mismatch.
8. `http` — app phải đọc `X-Forwarded-Proto` để biết client dùng HTTPS.
9. Mất **xác thực** (①). Vẫn mã hoá, nhưng bạn không biết đang nói chuyện với ai → MITM tầm thường.
10. `unable to get local issuer certificate` — không có CA bundle.
11. TLS 1.2: 2 RTT = 200ms. TLS 1.3: 1 RTT = 100ms. **Chênh ~100ms.**
12. **Không** — kết nối đã thiết lập; đó là một lý do lớn để dùng keep-alive.
13. Khoảng **11–12 tuần** kể từ khi cấp (cert 90 ngày), tức là ~10 tuần sau khi job bắt đầu hỏng — đủ lâu để không ai nhớ điều gì đã thay đổi.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Cấu hình server chỉ gửi leaf cert, test bằng browser và `curl` | Browser OK, `curl` fail |
| Đổi giờ hệ thống vượt `notAfter` | Mọi client từ chối |
| Cert cho `example.com`, gọi bằng IP | Name mismatch |
| Wildcard `*.example.com`, gọi `a.b.example.com` | Không khớp |
| Wildcard, gọi `example.com` | Không khớp |
| `openssl s_client` không có `-servername` | Nhận cert mặc định |
| `curl -k` với server dùng cert sai | "Hoạt động" — và bạn vừa tắt xác thực |
| Image alpine không có `ca-certificates`, gọi HTTPS | `unable to get local issuer` |
| Thêm `apk add ca-certificates` | Hoạt động |
| TLS terminate ở proxy, log `req.protocol` trong app | `http` |
| Thêm `X-Forwarded-Proto` và `trust proxy` | `https` |
| Đo bắt tay TLS 1.2 vs 1.3 với `netem delay 100ms` | Chênh ~1 RTT |
| Tắt keep-alive, đo 100 request HTTPS | Bắt tay mỗi lần |
| Chạy `checkend` trên cert production | Biết còn bao nhiêu ngày |

## What Usually Goes Wrong

- **Certificate hết hạn** → sự cố toàn hệ thống, thường ngoài giờ làm việc.
- **Tự động gia hạn thất bại im lặng** → không ai biết cho tới khi hết hạn.
- **Thiếu intermediate** → hoạt động trên trình duyệt, hỏng với API client.
- **Chỉ test bằng trình duyệt** → bỏ sót lỗi ③.
- **Wildcard không phủ domain gốc** → phát hiện muộn.
- **Cert chỉ có CN** → trình duyệt hiện đại từ chối.
- **`rejectUnauthorized: false`** → mất toàn bộ giá trị xác thực của TLS.
- **Image không có CA bundle** → lỗi khi gọi HTTPS ra ngoài.
- **App không đọc `X-Forwarded-Proto`** → redirect loop, hoặc tạo URL sai scheme.
- **Không alert trên hạn certificate** → biết khi đã muộn.
- **CA nội bộ không được phân phối đầy đủ** → mỗi client mới là một sự cố.
- **Cipher/phiên bản TLS cũ** → không đạt yêu cầu tuân thủ, hoặc bị client mới từ chối.
- **Private key lộ trong git hoặc image** → phải thu hồi và cấp lại toàn bộ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| TLS chỉ để mã hoá | Xác thực mới là phần khó và quan trọng nhất |
| Trình duyệt OK nghĩa là cấu hình đúng | Trình duyệt tự tải intermediate; client khác thì không |
| `curl -k` là cách sửa | Nó tắt xác thực — biến TLS thành gần như vô dụng |
| Wildcard phủ mọi subdomain | Chỉ một cấp, và không phủ domain gốc |
| CN vẫn dùng được | Trình duyệt hiện đại chỉ đọc SAN |
| HTTPS làm hệ thống chậm đáng kể | Với TLS 1.3 + keep-alive, chi phí rất nhỏ |
| Terminate ở LB nghĩa là an toàn tuyệt đối | Traffic nội bộ sau LB không mã hoá |
| Cert tự ký chỉ là "cảnh báo phiền" | Nó không cung cấp xác thực nào |
| SNI được mã hoá | Trong TLS 1.2 nó ở dạng rõ |
| mTLS chỉ dành cho hệ thống lớn | Nó thay API key bằng danh tính hết hạn được |

## Debugging

1. **`openssl s_client -connect host:443 -servername host -showcerts`** — chuỗi đầy đủ và `Verify return code`. Lệnh đầu tiên, luôn luôn.
2. **Đếm số cert trong chuỗi** — chỉ có `0 s:` = thiếu intermediate.
3. **Hạn và SAN**: `openssl x509 -noout -dates -ext subjectAltName`.
4. **Chạy từ chính client bị lỗi** — trust store khác nhau giữa máy, container, runtime.
5. **Trong container**: `docker exec <c> curl -v https://...` — không phải từ host.
6. **Kiểm tra `X-Forwarded-Proto`** nếu vấn đề là redirect loop hoặc URL sai scheme.
7. **Kiểm tra tự động gia hạn**: log của certbot/cert-manager, và `checkend` trên cert đang phục vụ (không phải cert trong file — chúng có thể khác nhau nếu reload thất bại).
8. **Kiểm tra bên ngoài**: SSL Labs hoặc `testssl.sh` cho đánh giá đầy đủ về cipher, phiên bản, cấu hình.

Điểm ở bước 7 đáng nhớ: gia hạn thành công nhưng server chưa reload nghĩa là file mới còn cert cũ vẫn đang phục vụ.

## Production Considerations

- **Tự động gia hạn + ALERT.** Alert là phần quan trọng hơn. Cảnh báo ở 30 và 14 ngày còn lại.
- **Giám sát cert đang PHỤC VỤ**, không phải cert trong file — chúng khác nhau khi reload thất bại.
- **Test bằng `curl`/`openssl`, không chỉ trình duyệt.**
- **Luôn gửi đầy đủ intermediate.**
- **TLS 1.2 tối thiểu; ưu tiên 1.3.** Tắt SSLv3, TLS 1.0/1.1.
- **HSTS** để trình duyệt luôn dùng HTTPS: `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Cẩn thận — nó khó thu hồi. Xem [Secure headers & TLS](../../05-cross-cutting/security/07-secure-headers-tls.md).
- **`X-Forwarded-Proto`** được set ở proxy và app phải tin nó (`app.set('trust proxy', 1)`), nhưng **chỉ tin từ proxy của bạn** — nếu không, client có thể giả mạo.
- **Private key mode 600**, không bao giờ trong git hay image. Xem [Secrets management](../../05-cross-cutting/security/06-secrets-management.md).
- **CA bundle trong image** — `ca-certificates` là dependency thật.
- **Keep-alive** để không bắt tay TLS mỗi request.
- **cert-manager trong Kubernetes** để tự động hoá toàn bộ vòng đời.
- **Có quy trình thu hồi** viết sẵn cho trường hợp key bị lộ — và biết nó mất bao lâu.
- **mTLS hoặc service mesh** nếu mạng nội bộ không đáng tin hoặc có yêu cầu tuân thủ.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Terminate ở LB | một chỗ quản lý cert, app đơn giản | nội bộ không mã hoá |
| Passthrough | mã hoá đầu-cuối | mỗi app quản lý cert; LB không routing theo header được |
| Re-encrypt | mã hoá cả nội bộ, LB vẫn routing được | hai lớp cert, thêm CPU |
| Service mesh (mTLS) | mTLS tự động, xoay cert tự động | thêm một tầng hạ tầng lớn |
| Let's Encrypt | miễn phí, tự động | 90 ngày → bắt buộc tự động hoá |
| Cert thương mại | hạn dài hơn, có bảo hiểm | tốn tiền, vẫn nên tự động hoá |
| Wildcard | một cert cho nhiều subdomain | một key lộ ảnh hưởng tất cả; không phủ gốc |
| Cert riêng từng domain | cô lập rủi ro | nhiều cert phải quản lý |
| TLS 1.3 | nhanh hơn, an toàn hơn | client rất cũ không hỗ trợ |
| mTLS | danh tính mạnh, thu hồi được | phải phân phối và xoay cert cho client |

## Explain Without Notes

1. Ba việc TLS làm, và cái nào khó nhất?
2. Chain of trust hoạt động thế nào? Server phải gửi những gì?
3. Vì sao thiếu intermediate hoạt động trên trình duyệt nhưng hỏng với `curl`?
4. Wildcard khớp những gì và không khớp những gì?
5. Bốn cách terminate TLS, và mỗi cách phù hợp khi nào?
6. Vì sao `rejectUnauthorized: false` nguy hiểm hơn nó có vẻ?
7. Vì sao app sau LB cần `X-Forwarded-Proto`, và rủi ro khi tin nó vô điều kiện?
8. Vì sao giám sát cert phải nhìn cert đang phục vụ, không phải file?

## Related

- [Từ vựng Network](00-network-vocabulary.md) — foundation: TLS, certificate, CA
- [TCP & UDP](02-tcp-udp.md) — TLS thêm RTT lên trên bắt tay TCP
- [IP, port & DNS](01-ip-port-dns.md) — SNI dùng tên
- [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md) — terminate, `X-Forwarded-*`
- [Network debugging](06-network-debugging.md) — `openssl s_client`
- [Secure headers & TLS](../../05-cross-cutting/security/07-secure-headers-tls.md) — HSTS, cipher
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — private key
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — từ phía browser
- [Production image](../02-docker/07-production-image.md) — CA bundle trong image
- [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md) — cert-manager

## Version / Context

TLS 1.3 (RFC 8446) là mặc định nên dùng; TLS 1.2 là mức tối thiểu. Let's Encrypt cấp cert 90 ngày qua giao thức ACME. `openssl s_client` cần `-servername` để gửi SNI. ECH (mã hoá SNI) còn đang triển khai.
