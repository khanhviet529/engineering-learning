---
level: intermediate
area: infra
prerequisites:
  - 01-where-to-run.md
  - ../01-networking/05-reverse-proxy-load-balancer.md
related:
  - ../../02-backend-api/05-integrations/03-file-storage.md
  - ../../01-web-frontend/00-web-foundations/02-http-browser-cache.md
---

# Cloudflare & edge runtime

> "Dùng Cloudflare" không phải một quyết định — nó là **ba quyết định khác nhau**. Đặt Cloudflare trước app: gần như luôn nên. Chạy app **trên** Cloudflare Workers: đó là đổi runtime, và nó loại bỏ Node.js.

## Position

```text
Browser
   ↓
Cloudflare (DNS → WAF → CDN → cache)          ← lớp 1: proxy, dùng với mọi stack
   ↓
[ origin của bạn: VPS/PaaS/K8s ]              hoặc
[ Workers/Pages: chạy TRÊN Cloudflare ]        ← lớp 2: đổi runtime
   ↓
D1 / R2 / KV / Durable Objects                 ← lớp 3: dịch vụ dữ liệu
```

Ba lớp, ba quyết định độc lập. Nhầm chúng là nguồn của mọi tranh luận vô ích về "Cloudflare có tốt không".

## Problem

Bạn có stack Next.js + NestJS + PostgreSQL + Prisma và nghe nói nên dùng Cloudflare. Ba câu hỏi khác nhau:

```text
1. Đặt Cloudflare trước app?          → gần như luôn CÓ
2. Host Next.js trên Cloudflare Pages? → CÓ THỂ, có điều kiện
3. Chạy NestJS API trên Workers?       → KHÔNG — Workers không phải Node.js
```

Câu 3 là chỗ nhiều người mất nhiều ngày rồi phát hiện `pg` không chạy, `reflect-metadata` không hoạt động, và NestJS cần Node runtime. Đây không phải "cấu hình khó" — nó là **runtime khác**.

## Mental Model

### Lớp 1 — Cloudflare như một proxy (dùng với mọi stack)

```text
Browser → Cloudflare → origin của bạn (ở đâu cũng được)
             ↑ DNS, TLS, CDN, WAF, DDoS, rate limit, bot management
```

Lớp này **độc lập với runtime**. App của bạn chạy trên VPS, Railway, hay K8s đều dùng được. Giá trị:

| Tính năng | Giá trị thực tế |
|---|---|
| **DNS** | nhanh, miễn phí, API tốt |
| **TLS** | certificate miễn phí, tự gia hạn, TLS 1.3 |
| **CDN** | cache static asset gần người dùng |
| **WAF** | chặn tấn công phổ biến trước khi tới origin |
| **DDoS** | miễn phí ở mức không giới hạn — đây là giá trị lớn nhất |
| **Rate limit** | lớp thô trước rate limit của app |
| **Origin ẩn** | IP thật của server không lộ ra |

Rủi ro thấp, giá trị cao, và **không cần đổi gì trong code**. Đây là lý do tôi khuyên dùng lớp này trước tiên.

Ba cấu hình cần chú ý:

```text
1. Proxy mode (mây vàng) vs DNS only (mây xám)
   → chỉ proxy mới có CDN/WAF; DNS only chỉ là DNS

2. SSL mode: PHẢI là "Full (strict)"
   → "Flexible" nghĩa là Cloudflare → origin KHÔNG mã hoá
   → đây là lỗi cấu hình phổ biến và nghiêm trọng

3. IP thật của client
   → origin nhìn thấy IP của Cloudflare, không phải của user
   → phải đọc CF-Connecting-IP, và CHỈ tin nó khi request đến từ IP của Cloudflare
```

Điểm 3 quan trọng cho [rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md): nếu app tin `X-Forwarded-For` vô điều kiện, attacker gửi IP giả và bypass rate limit. Cấu hình `trust proxy` đúng số hop, hoặc dùng `CF-Connecting-IP` với allowlist IP range của Cloudflare.

### Lớp 2 — Workers: đây là ngã ba đường

```text
Node.js                              Cloudflare Workers
─────────                            ──────────────────
V8 + libuv + Node API                V8 isolate + Web API
fs, net, dns, child_process          KHÔNG có
TCP socket trực tiếp                 KHÔNG (chỉ fetch/HTTP, và connect() hạn chế)
process sống lâu, giữ state          ephemeral, isolate có thể bị recycle
worker_threads, native module        KHÔNG
CPU time không giới hạn              GIỚI HẠN (10ms–5min tuỳ plan)
cold start ~100ms+                   ~0ms (isolate, không phải container)
```

Hệ quả cụ thể cho stack của bạn:

| Thứ | Trên Workers |
|---|---|
| **NestJS** | ❌ cần Node runtime (`reflect-metadata`, DI, decorator metadata) |
| **`pg` driver** | ❌ cần TCP socket |
| **Prisma** | ⚠️ cần Driver Adapter + Hyperdrive/HTTP driver; kiểm tra version |
| **`fs`, `sharp`, `bcrypt`** | ❌ native/Node API |
| **`argon2`** | ❌ native module → dùng WebCrypto hoặc chuyển hash sang service khác |
| **Hono, itty-router** | ✅ được viết cho Web API |
| **Next.js** | ⚠️ được qua `@opennextjs/cloudflare`; kiểm tra tính năng nào hỗ trợ |

Điểm quan trọng nhất và dễ bỏ: **hash mật khẩu**. Argon2/bcrypt là native module, không chạy trên Workers. WebCrypto có PBKDF2 nhưng nó yếu hơn argon2id. Nếu API auth chạy trên Workers, bạn phải hoặc giảm chất lượng hash, hoặc đưa auth sang service khác — cả hai đều là quyết định lớn. Xem [Password & MFA](../../02-backend-api/03-auth/05-password-mfa.md).

**Hyperdrive** giải quyết một phần vấn đề DB: nó là connection pooler của Cloudflare, cho Workers nói chuyện với PostgreSQL qua kết nối được pool ở edge. Nhưng nó không xoá bỏ ràng buộc về Node API.

*Kiểm tra tài liệu Cloudflare hiện tại — `nodejs_compat` flag đã hỗ trợ thêm nhiều Node API theo thời gian, và danh sách này thay đổi.*

### Lớp 3 — dịch vụ dữ liệu

```text
R2               object storage, S3-compatible, EGRESS MIỄN PHÍ
KV               key-value, eventually consistent (~60s), đọc nhanh toàn cầu
D1               SQLite ở edge, giới hạn kích thước, phù hợp dữ liệu nhỏ
Durable Objects  MỘT instance có state, strong consistency — cho coordination
Queues           message queue
```

Bốn cái này có đặc tính rất khác nhau, và chọn sai là bug:

| Dịch vụ | Consistency | Dùng cho | KHÔNG dùng cho |
|---|---|---|---|
| **R2** | strong (read-after-write) | file, backup, static asset | dữ liệu quan hệ |
| **KV** | **eventual (~60s)** | config, feature flag, cache | session, counter, dữ liệu cần đọc-sau-ghi |
| **D1** | strong | dữ liệu nhỏ, per-tenant | dữ liệu lớn, nhiều ghi đồng thời |
| **Durable Objects** | strong, serialized | rate limit, WebSocket room, lock | dữ liệu lớn |

**KV eventually consistent là bẫy lớn nhất.** Ghi rồi đọc ngay có thể ra giá trị cũ tới ~60 giây. Dùng nó cho session nghĩa là người dùng đăng nhập rồi bị coi là chưa đăng nhập. Đây là cùng lớp vấn đề với [đọc-sau-ghi từ replica](../../03-database/06-mongodb/06-transactions-consistency.md).

**R2 với egress miễn phí** là giá trị rõ ràng nhất của lớp 3: nếu bạn serve nhiều file, khác biệt so với S3 là hàng nghìn đô ở quy mô TB. Và vì nó S3-compatible, dùng `@aws-sdk/client-s3` với `endpoint` khác — không lock in. Xem [File storage](../../02-backend-api/05-integrations/03-file-storage.md).

## How It Works

### Cấu hình lớp 1 đúng

```text
DNS
  A/CNAME → origin, bật proxy (mây VÀNG)
  → IP origin không lộ; nhưng phải chặn truy cập trực tiếp vào origin
    (firewall chỉ cho IP range của Cloudflare, hoặc dùng Cloudflare Tunnel)

SSL/TLS
  Mode: Full (strict)          ← BẮT BUỘC
  Always Use HTTPS: on
  Min TLS: 1.2
  → "Flexible" = Cloudflare→origin không mã hoá. Không dùng.

Cache
  Static asset (/_next/static/*, có hash) → Cache Everything, Edge TTL 1 năm
  HTML                                     → tôn trọng Cache-Control của origin
  /api/*                                   → BYPASS cache

WAF
  Managed rules: on
  Rate limit: /auth/login 10/phút theo IP    ← lớp thô, app vẫn cần lớp riêng
```

Hai điểm dễ sai:

**1. Cache `/api/*`.** Nếu bạn bật "Cache Everything" cho toàn site, response API có dữ liệu người dùng sẽ được cache và **trả cho người khác**. Đây là cùng lỗi với `Cache-Control: public` trên dữ liệu riêng tư. Xem [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md).

**2. Chặn truy cập trực tiếp vào origin.** Nếu ai đó biết IP thật, họ bypass toàn bộ WAF/DDoS/rate limit của Cloudflare. Firewall chỉ cho Cloudflare IP range, hoặc dùng **Cloudflare Tunnel** (origin không cần IP công khai và không mở port).

### Lấy IP thật của client

```ts
// Chỉ tin header khi request ĐẾN TỪ Cloudflare
function getClientIp(req: Request): string {
  // Cloudflare luôn set header này, và ghi đè nếu client tự gửi
  const cf = req.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  // Fallback cho môi trường không qua Cloudflare (dev, health check nội bộ)
  return req.headers.get('X-Real-IP') ?? 'unknown';
}
```

```ts
// Express/NestJS: cấu hình trust proxy đúng số hop
app.set('trust proxy', 1);      // Cloudflare là 1 hop
// Sau đó req.ip là IP thật
```

Không có bước này, `rate limit theo IP` trở nên vô nghĩa hoặc chặn oan (mọi request trông như đến từ cùng IP Cloudflare).

### Streaming và WebSocket qua Cloudflare

```text
Streaming SSR / SSE
  → Cloudflare KHÔNG buffer theo mặc định cho response streaming
  → nhưng: kiểm tra không có transform rule/compression làm buffer
  → và origin phải có Cache-Control: no-transform

WebSocket
  → hỗ trợ, cần bật (thường mặc định on)
  → nhưng: idle timeout ~100 giây → CẦN heartbeat
```

Heartbeat cho WebSocket là bắt buộc, không tuỳ chọn — không có nó, kết nối bị cắt sau ~100 giây im lặng. Xem [WebSocket & SSE](../../01-web-frontend/00-web-foundations/08-websocket-sse.md).

### Nếu chọn Workers — kiến trúc thực tế

Cách dùng Workers **không** phải "chuyển toàn bộ API sang":

```text
Cloudflare Workers/Pages          Origin (Node.js)
────────────────────────          ────────────────
✅ Next.js SSR/static             ✅ NestJS API
✅ middleware (auth check, redirect)  ✅ Prisma + PostgreSQL
✅ edge cache logic                ✅ hash mật khẩu (argon2)
✅ image resize (Cloudflare Images)   ✅ xử lý ảnh (sharp)
✅ rate limit (Durable Objects)    ✅ job nền, queue worker
✅ webhook receiver đơn giản       ✅ export, PDF
```

Đây là mô hình **hybrid**, và nó lấy được lợi ích của edge (độ trễ thấp cho frontend, middleware) mà không mất Node.js cho phần cần nó.

```ts
// Worker làm middleware: rẻ, gần người dùng, không cần Node API
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Chặn sớm ở edge, không tốn origin
    if (!req.headers.get('cookie')?.includes('session=') && url.pathname.startsWith('/app')) {
      return Response.redirect(new URL('/login', url), 302);
    }

    // Còn lại: chuyển tới origin
    return fetch(req);
  },
};
```

Lưu ý: đây là **redirect cho UX**, không phải authorization. Authorization thật vẫn ở tầng dữ liệu của origin — cùng nguyên tắc với [middleware của Next.js](../../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md).

### Cloudflare Pages cho Next.js — điều kiện

```text
Static export (output: 'export')     ✅ hoạt động tốt
App Router SSR                        ⚠️ qua @opennextjs/cloudflare
  → kiểm tra: ISR, Image Optimization, Server Actions, streaming
  → một số tính năng có giới hạn hoặc cần cấu hình riêng
Node runtime API trong Server Component  ❌ (fs, sharp...)
```

Thực dụng: nếu Next.js app của bạn chỉ fetch từ API và render, Pages hoạt động tốt. Nếu Server Component dùng Node API hoặc truy cập DB trực tiếp qua `pg`, bạn cần Node runtime — Vercel, hoặc container.

*Hỗ trợ Next.js trên Cloudflare thay đổi nhanh; kiểm tra tài liệu `@opennextjs/cloudflare` hiện tại trước khi cam kết.*

## Example

```text
Kiến trúc hybrid — khuyến nghị cho stack Next.js + NestJS + PostgreSQL

Cloudflare (lớp 1 + 2 nhẹ)
  DNS + TLS (Full strict) + WAF + DDoS
  CDN: /_next/static/* cache 1 năm; /api/* BYPASS
  Pages: Next.js frontend (nếu không cần Node API)
  Worker: middleware redirect, rate limit thô
  R2: file upload (egress miễn phí)

Origin (Node.js — VPS/PaaS/K8s)
  NestJS API + Prisma
  PostgreSQL (managed) + Redis
  Worker process: queue, email, export, PDF
  → firewall CHỈ cho Cloudflare IP range, hoặc Cloudflare Tunnel

App code
  getClientIp() từ CF-Connecting-IP
  trust proxy = 1
  Cache-Control tường minh cho mọi response
```

## Prediction

1. SSL mode "Flexible", origin có TLS — traffic Cloudflare → origin có mã hoá?
2. App đọc `X-Forwarded-For` vô điều kiện, sau Cloudflare — rate limit theo IP hoạt động?
3. Bật "Cache Everything" cho toàn site, `/api/me` trả dữ liệu user — người thứ hai thấy gì?
4. Bật proxy nhưng không firewall origin, ai đó biết IP thật — họ bypass được gì?
5. NestJS deploy lên Workers — kết quả?
6. `import argon2 from 'argon2'` trong Worker — kết quả?
7. `pg` driver trong Worker không có Hyperdrive — kết quả?
8. Ghi vào KV rồi đọc ngay — có chắc thấy giá trị mới?
9. Dùng KV làm session store — người dùng đăng nhập rồi refresh ngay?
10. WebSocket qua Cloudflare, không heartbeat, im lặng 3 phút — kết nối?

<details>
<summary>Đáp án</summary>

1. **Không** — "Flexible" nghĩa là HTTP giữa Cloudflare và origin. Phải dùng Full (strict).
2. **Không** — mọi request trông như từ IP Cloudflare, hoặc attacker gửi header giả để bypass.
3. Có thể thấy dữ liệu của người thứ nhất — lộ dữ liệu.
4. Toàn bộ WAF, DDoS protection, rate limit của Cloudflare.
5. Không chạy — cần Node runtime cho `reflect-metadata` và DI.
6. Lỗi — native module không chạy trên Workers.
7. Lỗi — cần TCP socket.
8. **Không** — KV eventually consistent, tới ~60 giây.
9. Có thể bị coi là chưa đăng nhập.
10. Bị cắt sau ~100 giây.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt SSL mode "Flexible", `tcpdump` trên origin | Thấy HTTP plaintext |
| Đổi sang Full (strict) | Mã hoá |
| Log `req.ip` sau Cloudflare không có trust proxy | Thấy IP Cloudflare, không phải user |
| Cấu hình trust proxy, làm lại | IP thật |
| Bật Cache Everything, gọi `/api/me` bằng 2 tài khoản | Người thứ hai có thể thấy dữ liệu người thứ nhất |
| Tìm IP origin (dịch vụ như SecurityTrails), gọi trực tiếp | Bypass WAF nếu không firewall |
| Deploy NestJS lên Workers | Lỗi rõ ràng về Node API |
| `import fs` trong Worker | Build/runtime error |
| Ghi KV rồi đọc trong vòng lặp, đo thời gian tới khi thấy giá trị mới | Có thể tới ~60s |
| WebSocket im lặng 2 phút qua Cloudflare | Kết nối bị cắt |
| Thêm ping 30s | Giữ được |
| So chi phí egress R2 vs S3 với 1TB/tháng | Khác biệt rõ rệt |

Thí nghiệm 6 nên chạy một lần: nếu bạn tìm được IP origin của chính mình, attacker cũng tìm được.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| "Dùng Cloudflare" là một quyết định | Ba lớp độc lập: proxy, runtime, dịch vụ dữ liệu |
| Workers là Node.js gần người dùng | V8 isolate + Web API; không có Node API |
| Chuyển sang Workers là tối ưu hiệu năng | Là **đổi runtime** — loại bỏ một phần lớn thư viện |
| SSL "Flexible" vẫn an toàn vì có HTTPS ở browser | Cloudflare → origin không mã hoá |
| Bật proxy là đủ để ẩn origin | Phải chặn truy cập trực tiếp bằng firewall/Tunnel |
| KV như Redis | KV eventually consistent (~60s); Redis strong |
| D1 thay được PostgreSQL | SQLite ở edge, giới hạn kích thước và ghi đồng thời |
| Cache Everything là tối ưu tốt | Nó cache cả API riêng tư |
| Edge nhanh hơn nên luôn tốt hơn | Nếu app vẫn phải gọi DB ở một region, edge không giúp |
| R2 và S3 khác nhau nhiều | S3-compatible; khác chủ yếu ở egress |

## Debugging

1. **Kiểm tra request có qua Cloudflare không** → header `CF-Ray` và `Server: cloudflare` trong response.
2. **Cache hit hay miss** → header `CF-Cache-Status`: `HIT`, `MISS`, `BYPASS`, `DYNAMIC`. Đây là câu trả lời trực tiếp cho "vì sao vẫn cũ" hoặc "vì sao không cache".
3. **IP thật** → log cả `CF-Connecting-IP`, `X-Forwarded-For`, và `req.ip` để so.
4. **Nghi cache API** → gọi cùng endpoint bằng 2 tài khoản, so response và `CF-Cache-Status`.
5. **Origin bị truy cập trực tiếp** → so log của origin với log của Cloudflare; request không có `CF-Ray` là request bypass.
6. **Workers lỗi** → `wrangler tail` để xem log realtime; và kiểm tra API bạn dùng có trong danh sách hỗ trợ.
7. **Streaming không hoạt động** → so sánh gọi trực tiếp origin vs qua Cloudflare bằng `curl -N`.
8. **KV trả giá trị cũ** → đó là behavior, không phải bug; đổi sang Durable Objects hoặc origin DB nếu cần strong consistency.

## Production Considerations

- **SSL mode "Full (strict)"**, không bao giờ "Flexible".
- **Chặn truy cập trực tiếp vào origin** — firewall theo Cloudflare IP range, hoặc Cloudflare Tunnel.
- **`/api/*` BYPASS cache**; chỉ cache asset có hash với TTL dài.
- **`CF-Connecting-IP` + `trust proxy`** đúng, để rate limit và log có IP thật.
- **Rate limit ở Cloudflare là lớp thô** — app vẫn cần lớp theo user/endpoint. Xem [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md).
- **Heartbeat cho WebSocket/SSE** (15–30 giây).
- **Nếu dùng Workers: kiến trúc hybrid** — edge cho frontend/middleware, Node origin cho API/DB/job.
- **KV không dùng cho session hay counter** — eventually consistent.
- **R2 nếu serve nhiều file** — egress miễn phí, và S3-compatible nên không lock in.
- **Ghi lại cấu hình Cloudflare vào IaC** (Terraform provider) — nếu không, thay đổi trong dashboard không ai biết và không rollback được.
- **Kiểm tra tài liệu hiện tại** trước khi cam kết vào Workers cho một tính năng — danh sách API hỗ trợ (`nodejs_compat`) thay đổi thường xuyên.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cloudflare làm proxy | DDoS/WAF/CDN/TLS miễn phí, không đổi code | thêm một hop, thêm một chỗ cấu hình |
| Không dùng CDN | đơn giản | tự lo TLS, không có DDoS protection |
| Workers cho API | độ trễ thấp, scale tự động, cold start ~0 | **không có Node.js** — mất phần lớn thư viện |
| Node origin cho API | dùng được mọi thư viện | phải vận hành server, cold start nếu serverless |
| Hybrid (edge + origin) | lợi ích của cả hai | hai nơi deploy, hai mô hình để hiểu |
| KV | đọc nhanh toàn cầu | eventually consistent |
| Durable Objects | strong consistency, coordination | một instance = một điểm nghẽn cho key đó |
| R2 | egress miễn phí, S3-compatible | ít tính năng nâng cao hơn S3 |
| D1 | SQLite ở edge, đơn giản | giới hạn kích thước và ghi đồng thời |

## Explain Without Notes

1. Ba lớp của Cloudflare, và quyết định nào là "gần như luôn nên"?
2. Vì sao Workers không phải Node.js, và bốn thứ cụ thể không chạy được?
3. SSL "Flexible" sai ở đâu?
4. Vì sao bật proxy chưa đủ để ẩn origin?
5. Vì sao KV không dùng được cho session?
6. Kiến trúc hybrid — cái gì ở edge, cái gì ở origin?

## Related

- [Chạy ở đâu](01-where-to-run.md) — sáu mức platform, và thứ tự học
- [Reverse proxy & load balancer](../01-networking/05-reverse-proxy-load-balancer.md) — Cloudflare là một reverse proxy
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — `Cache-Control`, `public` vs `private`
- [File storage](../../02-backend-api/05-integrations/03-file-storage.md) — R2, CDN, lifecycle
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md) — `X-Forwarded-For`, nhiều lớp
- [WebSocket & SSE](../../01-web-frontend/00-web-foundations/08-websocket-sse.md) — heartbeat, proxy timeout
- [Middleware & auth patterns](../../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md) — edge middleware là UX, không phải authz
- [Password & MFA](../../02-backend-api/03-auth/05-password-mfa.md) — argon2 không chạy trên Workers
- [Deployment & production (Next.js)](../../01-web-frontend/03-nextjs/behavior/08-deployment-production.md)
- [Secure headers & TLS](../../05-cross-cutting/security/07-secure-headers-tls.md)
