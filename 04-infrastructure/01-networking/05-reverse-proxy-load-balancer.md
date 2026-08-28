---
level: intermediate
area: infra
prerequisites:
  - 02-tcp-udp.md
  - 03-tls.md
related:
  - 04-nat-firewall-routing.md
  - ../04-kubernetes/06-ingress-service-discovery.md
  - ../../02-backend-api/01-nodejs/05-graceful-shutdown.md
---

# Reverse proxy & load balancer

> Sau khi thêm load balancer, hệ thống ổn định hơn — trừ mỗi lần deploy. Mỗi lần rollout, biểu đồ lỗi có một cái gai: khoảng 200 lỗi `502 Bad Gateway` trong 3 giây. Ứng dụng có graceful shutdown, được viết cẩn thận, và nó **đang chạy đúng**. Vấn đề là nó đóng listener trước khi load balancer kịp biết là không nên gửi traffic tới nữa nữa.

## Position

```text
Client
  ↓  TLS
LOAD BALANCER / REVERSE PROXY   ← note này
  │  TLS termination · routing · health check · timeout · retry
  ↓  HTTP
App instance 1..N
```

## Problem

Không có lớp này, mỗi app instance phải tự lo:

```text
· TLS certificate            → mỗi instance một bản, xoay vòng ở N nơi
· phân phối tải              → client phải biết mọi instance
· loại instance chết         → client phải health check
· giới hạn tốc độ, giới hạn kích thước body
· nén, cache tĩnh
· timeout với client chậm
```

Reverse proxy gom tất cả vào một chỗ. Nhưng nó cũng **thêm một trạm** giữa client và app, và trạm đó có timeout riêng, buffer riêng, và cách xử lý lỗi riêng — đó là nguồn của một lớp vấn đề mới.

## Mental Model

### Reverse proxy vs load balancer

```text
REVERSE PROXY   đứng TRƯỚC server, làm nhiều việc:
                TLS, routing theo path/host, cache, nén, rewrite
LOAD BALANCER   phân phối tải giữa nhiều backend, có health check

Trong thực tế chúng chồng nhau: nginx/Envoy/Traefik làm cả hai.
Khác biệt đáng nhớ hơn là L4 vs L7.
```

### L4 vs L7

```text
L4 (TCP)                          L7 (HTTP)
chỉ thấy IP:port                  đọc được method, path, header, cookie
nhanh nhất, ít CPU                 routing theo nội dung
không đọc được nội dung            TLS termination
không retry được (không biết       retry được request idempotent
  request là gì)
→ database proxy, TCP passthrough  → API gateway, ingress, CDN origin
```

Với TLS passthrough, bạn buộc phải dùng L4 — và mất khả năng routing theo path, thêm header, và retry.

### Thuật toán phân phối

```text
round-robin           lần lượt        đơn giản; sai khi request có chi phí khác nhau
least-connections     ít kết nối nhất  tốt hơn khi thời gian xử lý biến thiên
ip-hash / sticky      theo client      cần cho session; phân bố lệch
weighted              theo trọng số    khi instance khác cấu hình
EWMA / least-latency  theo độ trễ      thích ứng tốt nhất, phức tạp hơn
```

Với backend đồng nhất và request đồng đều, round-robin đủ. Với request có chi phí rất khác nhau (một số endpoint 5ms, một số 5 giây), **least-connections** tránh được tình huống một instance nhận toàn request nặng.

Sticky session nên tránh nếu được: nó làm phân bố lệch, cản trở rollout, và tạo ra trạng thái ở tầng LB. Nếu ứng dụng cần session, để session ở Redis thay vì ở bộ nhớ instance.

### Health check: liveness ≠ readiness

```text
LIVENESS   "process còn sống không?"      → không sống thì RESTART
READINESS  "sẵn sàng nhận traffic chưa?"  → chưa thì RÚT KHỎI POOL
```

Hai loại này phải khác nhau, và nhầm chúng gây hai sự cố ngược nhau:

```ts
// ❌ health check kiểm tra database
app.get('/health', async (req, res) => {
  await db.query('SELECT 1');       // DB chậm → MỌI instance bị coi là chết
  res.send('ok');                    // → LB rút hết → downtime toàn phần
});
```

```ts
// ✅ tách hai loại
app.get('/health', (_, res) => res.send('ok'));          // liveness: chỉ process
app.get('/ready', async (_, res) => {                     // readiness: có phục vụ được không
  if (shuttingDown) return res.status(503).send('shutting down');
  try { await db.query('SELECT 1'); res.send('ok'); }
  catch { res.status(503).send('db unavailable'); }
});
```

Nguyên tắc: **liveness không được phụ thuộc dependency bên ngoài.** Nếu database chậm, restart app không giúp gì — nó chỉ làm tình hình tệ hơn.

Ba tham số quyết định tốc độ phản ứng:

```text
interval          2–5s   càng ngắn phát hiện càng nhanh, càng nhiều tải
timeout           1–2s   phải NGẮN HƠN interval
unhealthyThreshold 2–3   tránh rút node vì một lần chậm
healthyThreshold   2     tránh đưa node chưa ổn định vào lại
```

### 502, 503, 504: ba lỗi, ba nguyên nhân

```text
502 Bad Gateway         proxy KẾT NỐI được nhưng nhận phản hồi HỎNG
                        → app crash giữa chừng, đóng kết nối đột ngột,
                          hoặc app đóng listener khi LB chưa biết

503 Service Unavailable KHÔNG CÓ backend nào khoẻ
                        → mọi instance fail health check

504 Gateway Timeout     app không trả lời KỊP
                        → app chậm, hoặc timeout của proxy quá ngắn
```

Phân biệt được ba cái này là bước đầu của mọi cuộc debug ở tầng này, và chúng dẫn đi ba hướng hoàn toàn khác nhau.

### 502 khi deploy: cơ chế đầy đủ

Đây là vấn đề ở đầu note:

```text
t=0     orchestrator gửi SIGTERM cho pod
t=0     BẮT ĐẦU xoá pod khỏi danh sách backend  (bất đồng bộ!)
t=0.05  app đóng listener NGAY
t=0.2   LB CHƯA cập nhật → vẫn gửi request tới cổng đã đóng → 502
t=1.5   LB cập nhật xong
```

Việc xoá backend và việc gửi SIGTERM xảy ra **song song**, không tuần tự. Cửa sổ 1–2 giây đó là nơi 502 sinh ra.

Cách sửa gồm ba phần, và cần cả ba:

```text
① readiness trả 503 NGAY khi nhận SIGTERM
② CHỜ 3–5 giây trước khi đóng listener      ← phần thường bị thiếu
③ readiness probe interval ngắn (2s) + failureThreshold 1
```

Xem [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md).

### Timeout phải xếp thứ tự

```text
client 30s  >  LB 25s  >  proxy 20s  >  app 15s  >  DB statement_timeout 10s
```

Nếu đảo ngược ở bất kỳ chỗ nào, tầng ngoài luôn nổ trước và bạn **không bao giờ thấy lỗi thật** — chỉ thấy timeout của gateway.

Và một cặp timeout đặc biệt trong Node.js:

```text
server.keepAliveTimeout  PHẢI LỚN HƠN idle timeout của LB
server.headersTimeout    PHẢI LỚN HƠN keepAliveTimeout
```

Nếu `keepAliveTimeout` của app **nhỏ hơn** của LB, có một cửa sổ mà LB gửi request vào kết nối app vừa đóng → **502 ngẫu nhiên, không liên quan tới deploy**. Đây là một trong những nguyên nhân 502 khó chẩn đoán nhất.

```ts
server.keepAliveTimeout = 65_000;   // > 60s idle timeout của ALB
server.headersTimeout   = 66_000;   // > keepAliveTimeout
```

### Buffering: ai giữ dữ liệu

```text
nginx proxy_buffering on (mặc định)
   → nginx đọc TOÀN BỘ phản hồi rồi mới gửi cho client
   + bảo vệ app khỏi client chậm (app giải phóng nhanh)
   - PHÁ streaming: SSE, download lớn, response dần

proxy_buffering off
   → chuyển tiếp ngay
   + streaming hoạt động
   - client chậm giữ kết nối tới app
```

Với SSE và streaming response, buffering là nguyên nhân của "không nhận được gì cho tới khi kết thúc":

```nginx
location /events {
  proxy_pass http://app;
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_set_header Connection '';
  proxy_http_version 1.1;
}
```

### WebSocket qua proxy

```nginx
location /socket.io/ {
  proxy_pass http://app;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;      # BẮT BUỘC
  proxy_set_header Connection "upgrade";       # BẮT BUỘC
  proxy_read_timeout 3600s;                    # mặc định 60s sẽ cắt kết nối
}
```

Thiếu hai header `Upgrade` → handshake trả **400**. Thiếu `proxy_read_timeout` → kết nối đứt sau 60 giây im lặng, và log trông như "mạng người dùng kém". Xem [WebSocket gateway](../../02-backend-api/02-nestjs/08-websocket-gateway.md).

### Header phải truyền xuống

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
```

Thiếu `X-Forwarded-Proto` → app tưởng request là HTTP → sinh URL sai scheme, hoặc redirect loop nếu app tự redirect sang HTTPS.

Và ở phía app:

```ts
app.set('trust proxy', 1);   // tin ĐÚNG một proxy — không dùng `true`
```

`true` nghĩa là tin mọi giá trị trong `X-Forwarded-For`, và client tự đặt được → giả mạo IP.

### Retry ở LB: cẩn thận

```text
LB retry sang backend khác khi nhận lỗi kết nối
   ✓ an toàn: lỗi KẾT NỐI (không kết nối được) — request chưa tới app
   ✗ nguy hiểm: timeout — app CÓ THỂ đã xử lý xong rồi
```

Retry một `POST` sau timeout có thể tạo hai đơn hàng. Chỉ retry method idempotent, và chỉ với lỗi kết nối. Xem [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md).

### Giới hạn ở biên

```nginx
client_max_body_size 10m;              # chặn upload khổng lồ TRƯỚC khi tới app
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;
limit_req zone=api burst=50 nodelay;
client_body_timeout 10s;
client_header_timeout 10s;
```

Chặn ở biên rẻ hơn nhiều so với chặn ở app: request bị từ chối không tốn một worker, không tốn một connection tới database, không tốn CPU parse JSON.

## Example

Chẩn đoán 502 khi deploy:

```bash
# 1. 502 hay 503 hay 504? (ba nguyên nhân khác nhau)
kubectl logs -n ingress deploy/ingress-nginx-controller | grep ' 50[234] '

# 2. Chúng tập trung vào cửa sổ deploy không?
#    Nếu có → nghi shutdown; nếu rải rác → nghi keepAliveTimeout

# 3. App có delay trước khi đóng listener không?
grep -n 'SHUTDOWN_DELAY\|server.close' src/main.ts

# 4. keepAliveTimeout của app so với idle timeout của LB
node -e "const s=require('http').createServer(); console.log(s.keepAliveTimeout)"
# 5000 (mặc định Node) — NHỎ HƠN 60s của ALB → 502 ngẫu nhiên

# 5. Sửa cả hai
```

```ts
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;
// + readiness=false ngay khi SIGTERM, chờ 5s, rồi mới server.close()
```

```bash
# 6. Xác minh: chạy tải ổn định rồi rollout, ĐẾM lỗi
k6 run --vus 50 --duration 3m load.js &
kubectl rollout restart deploy/api
# lỗi phải về 0
```

Bước 6 là bước duy nhất chứng minh vấn đề đã được sửa. "Trông có vẻ ổn" không phải bằng chứng.

## Prediction

1. Health check gọi `SELECT 1`, database chậm 5 giây — bao nhiêu instance bị rút khỏi pool?
2. Hệ quả với người dùng?
3. App đóng listener ngay khi nhận SIGTERM, LB cần 1,5s cập nhật — client thấy gì?
4. Thêm delay 5 giây trước khi đóng — client thấy gì?
5. `keepAliveTimeout` của app 5s, idle timeout của LB 60s — chuyện gì xảy ra?
6. `headersTimeout < keepAliveTimeout` — hệ quả?
7. Timeout: client 10s, LB 30s, app 60s — client thấy lỗi gì? Bạn có thấy lỗi thật không?
8. `proxy_buffering on` với endpoint SSE — client nhận gì?
9. Thiếu header `Upgrade` cho WebSocket — handshake trả gì?
10. Thiếu `X-Forwarded-Proto`, app tự redirect HTTP→HTTPS — kết quả?
11. `trust proxy: true`, client gửi `X-Forwarded-For: 1.2.3.4` — log ghi IP nào?
12. LB retry `POST` sau timeout, app đã xử lý xong — hậu quả?
13. `client_max_body_size` không đặt, ai đó upload 5 GB — ảnh hưởng gì tới app?

<details>
<summary>Đáp án</summary>

1. **Tất cả** — mọi instance đều fail cùng health check.
2. LB không còn backend nào → **503 cho mọi request** → downtime toàn phần, gây ra bởi chính health check.
3. **502** trong khoảng 1,5 giây đó.
4. Không lỗi — LB đã rút backend trước khi listener đóng.
5. App đóng kết nối keep-alive ở giây thứ 5; LB tưởng vẫn dùng được và gửi request vào đó → **502 ngẫu nhiên**, không liên quan deploy.
6. Race giữa hai timeout → 502 ngẫu nhiên, khó tái hiện.
7. Client thấy **timeout của chính nó** ở giây thứ 10. Bạn **không bao giờ** thấy lỗi thật của app.
8. Không nhận gì cho tới khi response kết thúc — SSE **không hoạt động**.
9. **400 Bad Request** — server không nâng cấp giao thức.
10. **Redirect loop** — app luôn thấy `http` nên luôn redirect.
11. **`1.2.3.4`** — IP giả mạo. Rate limit theo IP và audit log đều sai.
12. **Xử lý hai lần** — hai đơn hàng, hai lần trừ tiền.
13. Body 5 GB đi qua proxy tới app; app đọc vào bộ nhớ → **OOM**. Chặn ở biên rẻ hơn nhiều.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Health check gọi DB, làm DB chậm | Mọi instance bị rút → 503 |
| Tách liveness/readiness, lặp lại | Chỉ readiness fail, liveness giữ pod sống |
| Chạy tải rồi `rollout restart`, đếm 502 | Số lỗi trong cửa sổ deploy |
| Thêm delay 5s trước `server.close()`, lặp lại | Về 0 |
| Đặt `keepAliveTimeout` 5s với LB idle 60s, chạy tải dài | 502 rải rác |
| Tăng lên 65s, lặp lại | Hết |
| Đặt `headersTimeout < keepAliveTimeout` | 502 ngẫu nhiên |
| `proxy_buffering on` với SSE | Không nhận gì cho tới cuối |
| `proxy_buffering off`, lặp lại | Nhận từng sự kiện |
| Bỏ header `Upgrade`, thử WebSocket | 400 |
| `proxy_read_timeout 10s` với WebSocket im lặng 15s | Đứt kết nối |
| Bỏ `X-Forwarded-Proto`, app redirect sang HTTPS | Loop |
| `trust proxy: true`, gửi `X-Forwarded-For` giả | Log ghi IP giả |
| Bỏ `client_max_body_size`, upload 2 GB | App nhận toàn bộ |
| Timeout đảo ngược (client < app) | Không bao giờ thấy lỗi thật |

## What Usually Goes Wrong

- **Health check phụ thuộc database** → DB chậm gây downtime toàn phần.
- **Không tách liveness/readiness** → restart pod khi vấn đề nằm ở dependency.
- **Đóng listener ngay khi SIGTERM** → 502 mỗi lần deploy.
- **`keepAliveTimeout` app < idle timeout LB** → 502 ngẫu nhiên, rất khó chẩn đoán.
- **`headersTimeout ≤ keepAliveTimeout`** → race, 502 ngẫu nhiên.
- **Timeout không xếp thứ tự** → không bao giờ thấy lỗi thật.
- **`proxy_buffering` bật cho streaming** → SSE và download lớn không hoạt động.
- **Thiếu header `Upgrade`** → WebSocket handshake 400.
- **`proxy_read_timeout` mặc định 60s** → WebSocket đứt liên tục.
- **Thiếu `X-Forwarded-Proto`** → redirect loop, URL sai scheme.
- **`trust proxy: true`** → giả mạo IP.
- **LB retry method không idempotent** → xử lý trùng.
- **Không giới hạn body ở biên** → OOM ở app.
- **Sticky session không cần thiết** → phân bố lệch, rollout khó.
- **Không đếm lỗi trong cửa sổ deploy** → không biết đã sửa được chưa.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Health check nên kiểm tra mọi dependency | Liveness thì không — nó gây downtime toàn phần |
| 502 và 504 gần như nhau | 502 = phản hồi hỏng; 504 = quá chậm. Hai nguyên nhân khác nhau |
| LB xoá backend trước khi gửi SIGTERM | Hai việc song song |
| `server.close()` là đủ để shutdown sạch | Cần readiness=false + delay trước |
| Timeout đặt ở một chỗ là đủ | Phải xếp thứ tự qua mọi tầng |
| Proxy trong suốt với ứng dụng | Nó buffer, đổi header, có timeout riêng |
| `X-Forwarded-For` đáng tin | Chỉ khi tin đúng số proxy |
| LB retry luôn an toàn | Chỉ với lỗi kết nối và method idempotent |
| Sticky session là cách xử lý state | Để state ở Redis; sticky là biện pháp cuối |
| L7 luôn tốt hơn L4 | L4 nhanh hơn và cần thiết cho TLS passthrough |

## Debugging

1. **502, 503 hay 504?** Ba nguyên nhân khác nhau — đây là bước phân loại đầu tiên.
2. **Lỗi tập trung hay rải rác?** Tập trung vào cửa sổ deploy = shutdown. Rải rác = keep-alive timeout hoặc app không ổn định.
3. **Log của proxy** — nó ghi upstream nào, thời gian bao lâu, lỗi gì:
   ```text
   log_format up '$status ut=$upstream_response_time us=$upstream_status ua=$upstream_addr rt=$request_time';
   ```
   `upstream_response_time` vs `request_time` phân biệt "app chậm" với "client chậm".
4. **Health check** — gọi thủ công `/health` và `/ready` trên từng instance.
5. **Timeout của từng tầng** — liệt kê ra và kiểm tra thứ tự.
6. **`keepAliveTimeout` vs idle timeout của LB** — nguyên nhân của 502 rải rác.
7. **Header tới app** — log `X-Forwarded-*` ở app để xác nhận proxy có set không.
8. **Đếm lỗi trong cửa sổ deploy** — chạy tải rồi rollout. Đây là bằng chứng duy nhất.

## Production Considerations

- **Liveness không phụ thuộc dependency; readiness thì có.** Đây là quy tắc quan trọng nhất trong note.
- **Readiness phản ánh trạng thái shutdown**; liveness **không** — nếu liveness trả 503 khi shutdown, orchestrator giết pod ngay và cắt ngắn graceful shutdown.
- **`keepAliveTimeout` > idle timeout của LB**, và `headersTimeout` > `keepAliveTimeout`.
- **Timeout xếp thứ tự** từ ngoài vào trong, và ghi chúng ra một chỗ.
- **Chỉ retry lỗi kết nối và method idempotent** ở LB.
- **Giới hạn body, giới hạn tốc độ, timeout header ở biên** — rẻ hơn chặn ở app rất nhiều.
- **Log của proxy phải có `upstream_response_time` và `upstream_addr`** — không có chúng, bạn không biết instance nào chậm.
- **Đo lỗi trong cửa sổ deploy như một metric**, và đặt mục tiêu 0.
- **Tránh sticky session**; nếu buộc phải dùng, để session ở Redis và dùng sticky chỉ như tối ưu.
- **`proxy_buffering off` cho endpoint streaming**, bật cho phần còn lại.
- **PROXY protocol** khi cần IP nguồn qua L4 LB.
- **Nhiều tầng proxy thì mỗi tầng đều có timeout và buffer** — vẽ sơ đồ và ghi số ra, đừng giữ trong đầu.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| L7 proxy | routing theo nội dung, retry, header | thêm CPU, thêm độ trễ |
| L4 proxy | nhanh, TLS passthrough | không routing theo path, không retry |
| TLS terminate ở LB | một chỗ quản lý cert | nội bộ không mã hoá |
| TLS passthrough | mã hoá đầu-cuối | mất L7 |
| `proxy_buffering on` | bảo vệ app khỏi client chậm | phá streaming |
| `proxy_buffering off` | streaming hoạt động | client chậm giữ kết nối app |
| Health check sâu | phát hiện vấn đề thật | rủi ro rút hết backend |
| Health check nông | ổn định | có thể gửi traffic vào instance hỏng |
| Retry ở LB | che lỗi thoáng qua | rủi ro xử lý trùng |
| Không retry | rõ ràng | client thấy lỗi lẽ ra tránh được |
| Sticky session | session trong bộ nhớ hoạt động | phân bố lệch, rollout khó |
| Không sticky | phân bố đều | phải để session ra ngoài |

## Explain Without Notes

1. L4 và L7 khác nhau ở gì? Khi nào buộc phải dùng L4?
2. Liveness và readiness khác nhau thế nào, và điều gì xảy ra khi nhầm?
3. Vì sao 502 xuất hiện mỗi lần deploy, và ba phần của cách sửa?
4. Vì sao `keepAliveTimeout` của app phải lớn hơn idle timeout của LB?
5. 502, 503, 504 — ba nguyên nhân?
6. Vì sao timeout phải xếp thứ tự? Điều gì xảy ra khi đảo ngược?
7. `proxy_buffering` ảnh hưởng SSE thế nào?
8. Khi nào LB được phép retry, và khi nào không?

## Related

- [TCP & UDP](02-tcp-udp.md) — keep-alive, timeout
- [TLS](03-tls.md) — terminate, `X-Forwarded-Proto`
- [NAT, firewall & routing](04-nat-firewall-routing.md) — mất IP nguồn, PROXY protocol
- [Network debugging](06-network-debugging.md) — quy trình
- [Ingress & service discovery](../04-kubernetes/06-ingress-service-discovery.md) — Ingress là reverse proxy
- [Readiness & liveness](../04-kubernetes/02-health-readiness-liveness.md) — probe trong K8s
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — chống 502 khi deploy
- [WebSocket gateway](../../02-backend-api/02-nestjs/08-websocket-gateway.md) — Upgrade header, timeout
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — retry an toàn
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md) — chặn ở biên

## Version / Context

Ví dụ dùng nginx. Envoy, Traefik, HAProxy, ALB có tham số tương đương với tên khác. Node.js: `keepAliveTimeout` mặc định 5 giây (từ Node 18 là 5s), `headersTimeout` mặc định 60 giây — cả hai cần chỉnh khi đứng sau LB có idle timeout dài hơn. AWS ALB idle timeout mặc định 60 giây.
