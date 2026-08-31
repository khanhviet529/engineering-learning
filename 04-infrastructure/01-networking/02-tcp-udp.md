---
level: intermediate
area: infra
prerequisites:
  - 00-network-vocabulary.md
  - 01-ip-port-dns.md
  - ../00-linux/05-ports-sockets.md
related:
  - 03-tls.md
  - 05-reverse-proxy-load-balancer.md
  - ../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
---

# TCP & UDP

> Service A gọi service B. B chết hoàn toàn — process bị kill, máy vẫn sống. A không nhận lỗi. A **treo 15 phút** rồi mới báo timeout. Trong 15 phút đó, mọi request qua A đều xếp hàng và cả hệ thống dừng. TCP không hỏng; nó đang làm đúng những gì nó được thiết kế: **cố gắng đến cùng**.

> **Chưa biết những từ này?** [Từ vựng Network](00-network-vocabulary.md) — packet, socket, TCP vs UDP

## Position

```text
HTTP / gRPC / PostgreSQL protocol
        ↓
      TLS (tuỳ chọn)
        ↓
      TCP  ← note này: kết nối, thứ tự, gửi lại, kiểm soát luồng
        ↓
       IP
```

## Problem

TCP che giấu mạng rất tốt — quá tốt. Nó làm bạn quên rằng bên dưới có gói tin bị mất, bị đảo thứ tự, và có thể không bao giờ tới.

Ba hệ quả của việc quên điều đó:

```text
① Không đặt timeout       → treo vô hạn khi peer biến mất im lặng
② Tin rằng "gửi xong = đã tới"  → write() thành công chỉ nghĩa là vào buffer
③ Không hiểu head-of-line blocking → một gói mất làm chậm mọi thứ trên connection đó
```

## Mental Model

### TCP và UDP: hai hợp đồng khác nhau

```text
TCP                                  UDP
có kết nối (bắt tay 3 bước)          không kết nối, gửi là xong
đảm bảo tới nơi (gửi lại)            không đảm bảo
đảm bảo THỨ TỰ                       không
kiểm soát luồng + tắc nghẽn          không
overhead cao hơn, latency cao hơn    tối giản, nhanh nhất
→ HTTP, DB, gRPC, SSH                → DNS, video call, game, QUIC/HTTP3
```

Nghịch lý đáng nhớ: **QUIC (nền của HTTP/3) chạy trên UDP** và tự cài đặt lại độ tin cậy ở tầng ứng dụng — chính vì làm vậy cho phép nó tránh những hạn chế cố hữu của TCP (đặc biệt là head-of-line blocking).

### Bắt tay ba bước và cái giá của nó

```text
Client                    Server
  │  ── SYN ──────────────▶ │
  │  ◀────────── SYN-ACK ── │
  │  ── ACK ──────────────▶ │
  │      (kết nối sẵn sàng)
```

Một RTT (round-trip time) trước khi gửi được byte dữ liệu đầu tiên. Với TLS, thêm 1–2 RTT nữa:

```text
RTT 5ms  (cùng vùng)   → TCP 5ms  + TLS ~10ms  ≈ 15ms trước byte đầu
RTT 150ms (xuyên lục địa) → TCP 150ms + TLS ~300ms ≈ 450ms
```

Đây là lý do **keep-alive quan trọng hơn hầu hết mọi tối ưu hoá khác**: nó xoá toàn bộ chi phí này cho request thứ hai trở đi.

### Đóng kết nối: bốn bước, và trạng thái TIME_WAIT

```text
A ── FIN ──▶ B     A không gửi nữa
A ◀── ACK ── B
A ◀── FIN ── B     B cũng không gửi nữa
A ── ACK ──▶ B
A: TIME_WAIT ~60s  ← bên ĐÓNG TRƯỚC giữ, để nuốt gói tin lạc
```

Từ đó ra một điều thực tế: **bên nào đóng trước thì bên đó chịu `TIME_WAIT`.** Nếu server đóng kết nối (ví dụ sau `keepAliveTimeout`), server tích luỹ `TIME_WAIT`; nếu client đóng, client chịu.

Với client tạo nhiều kết nối ngắn, `TIME_WAIT` giữ ephemeral port và có thể làm cạn port. Cách sửa đúng là keep-alive, không phải chỉnh sysctl. Xem [Ports & sockets](../00-linux/05-ports-sockets.md).

### Vì sao peer chết mà bạn không biết

Đây là cơ chế đằng sau ví dụ mở đầu:

```text
Peer bị KILL (process chết, máy còn sống)
   → OS của peer gửi RST → bạn nhận ECONNRESET NGAY   ✓ tốt

Peer MẤT ĐIỆN / mất mạng / firewall im lặng
   → KHÔNG có gói nào được gửi
   → TCP của bạn không biết gì
   → nếu bạn đang CHỜ ĐỌC: chờ MÃI MÃI
   → nếu bạn GỬI: gửi lại theo cấp số nhân, tới ~15 phút mới bỏ cuộc
```

TCP keepalive tồn tại cho tình huống này, nhưng mặc định của Linux vô dụng:

```bash
net.ipv4.tcp_keepalive_time   = 7200   # 2 GIỜ trước khi thăm dò đầu tiên
net.ipv4.tcp_keepalive_intvl  = 75
net.ipv4.tcp_keepalive_probes = 9
# → phát hiện peer chết sau ~2 giờ 11 phút
```

```ts
// đặt ở tầng socket của ứng dụng
socket.setKeepAlive(true, 30_000);
```

Nhưng kết luận quan trọng nhất là: **timeout ở tầng ứng dụng là thứ bạn phải có**, không phải TCP keepalive.

```ts
const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
```

TCP không thể biết "5 giây là quá lâu cho API này" — chỉ ứng dụng biết.

### Ba loại timeout phải phân biệt

```text
CONNECT timeout   bao lâu để thiết lập kết nối        (nên NGẮN: 1–3s)
IDLE/SOCKET timeout  bao lâu không có byte nào        (5–30s)
TOTAL/REQUEST timeout  toàn bộ request                (tuỳ nghiệp vụ)
```

Chỉ đặt total timeout là chưa đủ: một kết nối tới host không tồn tại có thể mất hàng chục giây chỉ ở bước connect, và bạn muốn fail sớm hơn thế.

Và một ràng buộc: **timeout của tầng ngoài phải dài hơn tầng trong.**

```text
client 30s > gateway 25s > app 20s > DB statement_timeout 10s
```

Ngược lại thì tầng ngoài luôn nổ trước và bạn không bao giờ thấy lỗi thật.

### `write()` thành công không nghĩa là đã tới

```ts
socket.write(data);   // trả về true → chỉ nghĩa là ĐÃ VÀO BUFFER của kernel
```

```text
write() thành công  →  dữ liệu trong send buffer
                    →  TCP sẽ cố gửi
                    →  peer có thể không bao giờ nhận
                    →  và bạn có thể không bao giờ biết
```

Cách duy nhất biết peer đã xử lý: **phản hồi ở tầng ứng dụng.** Đây là lý do mọi giao thức đáng tin đều có ack riêng, và là lý do "đã gửi" không bao giờ đủ để coi một thao tác là hoàn tất. Xem [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md).

### Head-of-line blocking

```text
HTTP/1.1  một request mỗi connection tại một thời điểm
          → trình duyệt mở 6 connection song song
HTTP/2    nhiều stream trên MỘT connection
          → nhưng nếu MỘT gói TCP mất, MỌI stream dừng chờ gửi lại
HTTP/3    QUIC trên UDP: mỗi stream độc lập
          → một gói mất chỉ ảnh hưởng stream của nó
```

HTTP/2 giải quyết head-of-line blocking ở tầng HTTP nhưng **không** giải quyết được ở tầng TCP — vì TCP đảm bảo thứ tự cho toàn bộ dòng byte. Đó là lý do HTTP/3 phải rời bỏ TCP.

Trên mạng ổn định (datacenter), khác biệt nhỏ. Trên mạng di động mất gói, nó rõ rệt.

### Nagle và delayed ACK

```text
Nagle       gom gói nhỏ lại trước khi gửi (giảm overhead)
Delayed ACK bên nhận chờ ~40ms trước khi gửi ACK (gom ACK)

Hai cái GẶP NHAU → độ trễ ~40ms cho request nhỏ
```

Hầu hết thư viện hiện đại bật `TCP_NODELAY` (tắt Nagle) theo mặc định. Nhưng nếu bạn thấy độ trễ ~40ms một cách bí ẩn và đều đặn cho request nhỏ, đây là ứng viên đầu tiên.

```ts
socket.setNoDelay(true);
```

### Backlog và SYN flood

```text
listen(backlog)
  → hàng đợi kết nối đã bắt tay xong, chờ accept()
  → đầy → kết nối mới bị drop
```

Triệu chứng: kết nối bị từ chối hoặc treo dưới đỉnh tải, trong khi app trông rảnh. Nguyên nhân gốc thường là app không gọi `accept()` kịp — với Node.js, đó là event loop bị chặn.

Xem [Ports & sockets](../00-linux/05-ports-sockets.md).

### MTU và phân mảnh

```text
MTU thường 1500 byte
Qua VPN/tunnel: 1400 hoặc thấp hơn
```

Nếu MTU không khớp và ICMP bị chặn (rất phổ biến), bạn gặp **PMTU black hole**: kết nối thiết lập được, request nhỏ chạy tốt, request lớn **treo im lặng**.

Triệu chứng đặc trưng: `curl` với payload nhỏ OK, payload > 1 KB treo. Đây là một trong những lỗi mạng khó chẩn đoán nhất, và nó chỉ xuất hiện khi có VPN/tunnel/overlay network ở giữa.

## Example

Chẩn đoán "request treo lâu rồi mới timeout":

```bash
# 1. Kết nối có thiết lập được không, mất bao lâu?
curl -o /dev/null -sS -w \
  'dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  https://api.example.com/health
# dns=0.004 conn=0.045 tls=0.120 ttfb=15.200 total=15.210
#                                  ↑ kết nối nhanh, SERVER chậm trả byte đầu

# 2. Xem trạng thái kết nối phía client
ss -tanp | grep :443
# ESTAB 0 0 10.0.1.5:54321 203.0.113.10:443
#       ↑ Recv-Q 0, Send-Q 0 → đã gửi xong, đang CHỜ phản hồi

# 3. Nếu Send-Q > 0 và không giảm → peer không nhận (mạng hoặc peer chết)
# 4. Nếu Recv-Q > 0 và không giảm → app không đọc (event loop bị chặn)
```

Ba cột đó phân biệt ba nguyên nhân hoàn toàn khác nhau:

```text
Send-Q lớn, không giảm   → dữ liệu kẹt ở buffer gửi: peer/mạng có vấn đề
Recv-Q lớn, không giảm   → dữ liệu đã tới nhưng APP không đọc
Cả hai = 0, ESTAB lâu    → đang chờ peer xử lý (server chậm)
```

Và giải pháp cho ví dụ mở đầu:

```ts
const controller = AbortSignal.timeout(5_000);
const res = await fetch(url, { signal: controller });
// + keep-alive agent để tái sử dụng kết nối
// + circuit breaker để không gọi tiếp khi peer đang chết
```

## Prediction

1. `socket.write(data)` trả `true` — peer đã nhận chưa?
2. Peer bị `kill -9` (máy còn sống) — client nhận gì? Bao lâu?
3. Peer mất điện đột ngột — client nhận gì? Bao lâu?
4. Không đặt timeout, peer mất mạng, client đang chờ đọc — chờ bao lâu?
5. TCP keepalive mặc định của Linux — phát hiện peer chết sau bao lâu?
6. Client mở 10.000 kết nối ngắn/giây, không keep-alive — vấn đề gì ở phía client?
7. Bên nào chịu `TIME_WAIT` — bên đóng trước hay đóng sau?
8. RTT 150ms, mở kết nối HTTPS mới — bao lâu trước byte dữ liệu đầu tiên?
9. Với keep-alive, request thứ hai — bao lâu?
10. HTTP/2 với một gói TCP bị mất — bao nhiêu stream bị ảnh hưởng?
11. HTTP/3 (QUIC) cùng tình huống — bao nhiêu?
12. `curl` payload 500 byte OK, payload 5 KB treo, có VPN ở giữa — nghi ngờ gì?
13. `ss` cho thấy `Recv-Q` 200KB không giảm — vấn đề ở đâu?

<details>
<summary>Đáp án</summary>

1. **Chưa biết** — nó chỉ nghĩa là dữ liệu đã vào send buffer của kernel.
2. **ECONNRESET ngay lập tức** — OS của peer gửi RST vì không có process nào nhận.
3. **Không nhận gì.** Nếu đang chờ đọc: chờ mãi. Nếu đang gửi: gửi lại tới ~15 phút.
4. **Mãi mãi** (hoặc tới khi TCP keepalive phát hiện, mà mặc định là ~2 giờ).
5. `7200 + 9 × 75` ≈ **2 giờ 11 phút**. Vô dụng cho hầu hết mục đích.
6. Cạn ephemeral port (`TIME_WAIT` giữ ~60 giây mỗi kết nối) → `EADDRNOTAVAIL`.
7. **Bên đóng trước.**
8. TCP 150ms + TLS 1–2 RTT (150–300ms) ≈ **300–450ms**.
9. **~150ms** (chỉ một RTT cho request/response) — không có bắt tay.
10. **Mọi stream** trên connection đó — TCP đảm bảo thứ tự cho cả dòng byte.
11. **Chỉ stream chứa gói đó** — QUIC tách stream ở tầng ứng dụng.
12. **PMTU black hole** — MTU không khớp và ICMP bị chặn.
13. **Ứng dụng không đọc** — thường là event loop bị chặn hoặc handler treo.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gọi API rồi `kill -9` server ngay | `ECONNRESET` tức thì |
| Chặn traffic bằng `iptables -j DROP` thay vì tắt server | Client treo, không lỗi |
| Đo thời gian tới khi client bỏ cuộc (không timeout) | Có thể ~15 phút |
| Thêm `AbortSignal.timeout(5000)` | Fail sau 5 giây |
| `tc qdisc add dev eth0 root netem delay 200ms` | Đo ảnh hưởng RTT lên bắt tay |
| So thời gian request đầu và request thứ hai với keep-alive | Chênh 1–2 RTT |
| Tắt keep-alive, chạy 10.000 request | `TIME_WAIT` tích luỹ; có thể cạn port |
| `curl -w` với các mốc thời gian | Thấy thời gian nằm ở giai đoạn nào |
| Chặn event loop 10 giây rồi gửi dữ liệu lớn, xem `Recv-Q` | Tăng, không giảm |
| `netem loss 5%` với HTTP/2 nhiều stream | Mọi stream chậm theo |
| Đặt MTU 1400 một đầu, 1500 đầu kia, chặn ICMP, gửi payload lớn | Treo im lặng |
| Đo latency request nhỏ với và không có `TCP_NODELAY` | Chênh ~40ms nếu Nagle bật |

## What Usually Goes Wrong

- **Không đặt timeout** → treo lâu khi peer biến mất im lặng. Lỗi nghiêm trọng nhất trong note.
- **Chỉ đặt total timeout, không đặt connect timeout** → mất hàng chục giây ở bước connect.
- **Timeout tầng ngoài ngắn hơn tầng trong** → luôn thấy lỗi timeout của gateway, không bao giờ thấy lỗi thật.
- **Tin `write()` thành công là đã tới** → mất dữ liệu im lặng.
- **Không dùng keep-alive** → 1–2 RTT thừa mỗi request, và cạn ephemeral port.
- **Dựa vào TCP keepalive mặc định** → phát hiện peer chết sau 2 giờ.
- **`CLOSE_WAIT` tích luỹ** → code không `close()`; rò rỉ fd.
- **Chỉnh sysctl `TIME_WAIT`** thay vì dùng keep-alive → che triệu chứng.
- **Không có circuit breaker** → tiếp tục gọi vào peer đang chết, tích luỹ kết nối treo.
- **MTU không khớp + ICMP bị chặn** → request lớn treo im lặng.
- **Nagle + delayed ACK** → độ trễ 40ms bí ẩn.
- **Backlog nhỏ + event loop bị chặn** → kết nối bị drop dưới đỉnh tải.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| TCP đảm bảo dữ liệu tới nơi | Nó đảm bảo *cố gắng*; peer biến mất thì không |
| `write()` thành công = đã tới | Chỉ vào buffer của kernel |
| TCP tự phát hiện peer chết | Chỉ khi peer gửi RST; mất mạng thì không |
| TCP keepalive giải quyết vấn đề đó | Mặc định ~2 giờ; cần timeout ở tầng app |
| Timeout ở một tầng là đủ | Cần connect / idle / total, và chúng phải xếp thứ tự |
| HTTP/2 xoá head-of-line blocking | Chỉ ở tầng HTTP; TCP vẫn chặn |
| UDP luôn kém tin cậy hơn | QUIC trên UDP đáng tin và tránh được hạn chế của TCP |
| `TIME_WAIT` nhiều là bug | Bình thường với kết nối ngắn; `CLOSE_WAIT` mới là bug |
| Keep-alive chỉ là tối ưu nhỏ | Nó xoá 1–2 RTT mỗi request — thường là tối ưu lớn nhất |
| Mạng trong datacenter thì tin cậy | Nó vẫn mất gói, vẫn có phân mảnh, vẫn có firewall im lặng |

## Debugging

1. **Tách thời gian theo giai đoạn**:
   ```bash
   curl -o /dev/null -sS -w 'dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' <url>
   ```
   Đây là lệnh đầu tiên nên chạy — nó nói ngay vấn đề ở DNS, TCP, TLS hay server.
2. **Trạng thái kết nối**: `ss -tanp | grep <port>` — nhìn `Recv-Q`/`Send-Q`.
3. **Đếm theo trạng thái**: `ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn`.
4. **`refused` vs `timeout`** — hai hướng debug khác nhau. Xem [IP, port, DNS](01-ip-port-dns.md).
5. **Mất gói / đường đi**: `mtr -rw -c 20 <host>`.
6. **Nghi MTU**: `ping -M do -s 1472 <host>` (1472 + 28 = 1500). Nếu fail, giảm dần.
7. **Bắt gói khi cần**: `tcpdump -i any -nn host <ip> and port <port> -w /tmp/c.pcap` rồi phân tích bằng Wireshark. Biện pháp cuối, nhưng đôi khi là cách duy nhất.
8. **Xem chi tiết một socket**: `ss -tanpi` — hiện `rtt`, `cwnd`, số lần gửi lại.

## Production Considerations

- **Timeout ở mọi lời gọi mạng**, ba loại, xếp thứ tự tầng ngoài > tầng trong. Đây là biện pháp quan trọng nhất trong note.
- **Keep-alive cho mọi HTTP client** (`http.Agent({ keepAlive: true })`) và connection pool cho database.
- **`keepAliveTimeout` của server phải nhỏ hơn idle timeout của load balancer** — nếu ngược lại, LB gửi request vào kết nối server vừa đóng và bạn nhận 502 ngẫu nhiên.
- **`headersTimeout > keepAliveTimeout`** trong Node.js — ngược lại tạo race gây 502.
- **TCP keepalive ở tầng socket** (30–60s) cho kết nối dài (WebSocket, database) — nó phát hiện peer chết nhanh hơn nhiều so với mặc định.
- **Circuit breaker** để không tích luỹ kết nối treo khi peer chết. Xem [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **Theo dõi số kết nối theo trạng thái** — `CLOSE_WAIT` tăng đều là tín hiệu sớm của rò rỉ.
- **Đo `time_connect` và `time_starttransfer` riêng** — chúng chỉ ra hai loại vấn đề khác nhau.
- **Kiểm tra MTU khi có VPN/overlay** ở giữa — đặc biệt trong Kubernetes với CNI dùng tunnel.
- **HTTP/2 cho nhiều request nhỏ song song** trong datacenter; cân nhắc HTTP/3 cho client trên mạng di động.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| TCP | tin cậy, có thứ tự | overhead bắt tay, head-of-line blocking |
| UDP | nhanh nhất, không kết nối | phải tự lo tin cậy |
| QUIC/HTTP3 | không HOL blocking, 0-RTT | mới hơn, một số mạng chặn UDP |
| Keep-alive | bỏ bắt tay, latency thấp | giữ fd, cần cấu hình timeout khớp nhau |
| Kết nối ngắn | đơn giản | `TIME_WAIT`, cạn port, latency cao |
| Timeout ngắn | fail nhanh, không tích luỹ | cắt request hợp lệ khi mạng chậm |
| Timeout dài | chịu được mạng chậm | treo lâu khi peer chết |
| TCP keepalive | phát hiện peer chết | thêm traffic; không thay được timeout app |
| HTTP/2 | nhiều stream một connection | HOL blocking ở tầng TCP |
| HTTP/1.1 nhiều connection | HOL blocking cô lập | nhiều bắt tay, nhiều fd |

## Explain Without Notes

1. TCP và UDP khác nhau ở bốn điểm nào? Vì sao QUIC chọn UDP?
2. Vì sao `write()` thành công không nghĩa là peer đã nhận?
3. Hai cách peer biến mất, và client biết được trong trường hợp nào?
4. Vì sao TCP keepalive mặc định vô dụng, và cái gì thay thế?
5. Ba loại timeout và vì sao chỉ một cái là không đủ?
6. Head-of-line blocking ở HTTP/1.1, HTTP/2, HTTP/3 khác nhau thế nào?
7. Bên nào chịu `TIME_WAIT`, và hệ quả với client tạo nhiều kết nối ngắn?
8. `Recv-Q` cao và `Send-Q` cao chỉ ra hai vấn đề khác nhau nào?

## Related

- [Từ vựng Network](00-network-vocabulary.md) — foundation: packet, socket, TCP vs UDP
- [IP, port & DNS](01-ip-port-dns.md) — trước khi có kết nối
- [TLS](03-tls.md) — thêm 1–2 RTT lên trên TCP
- [NAT, firewall & routing](04-nat-firewall-routing.md) — vì sao gói tin biến mất
- [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md) — timeout phải khớp nhau
- [Network debugging](06-network-debugging.md) — quy trình đầy đủ
- [Ports & sockets](../00-linux/05-ports-sockets.md) — socket, trạng thái, backlog
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — cùng chuỗi từ browser
- [WebSocket gateway](../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md) — kết nối dài, keepalive

## Version / Context

Linux. `net.ipv4.tcp_keepalive_time` mặc định 7200 giây. `ss -tanpi` hiện thông tin chi tiết mỗi socket. HTTP/3 (RFC 9114) chạy trên QUIC (RFC 9000) — hỗ trợ rộng ở trình duyệt và CDN, ít phổ biến hơn cho giao tiếp nội bộ.
