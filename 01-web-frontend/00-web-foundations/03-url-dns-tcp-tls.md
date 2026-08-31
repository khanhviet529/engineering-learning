---
level: foundation
area: frontend
prerequisites:
  - 00-web-vocabulary.md
  - ../../04-infrastructure/01-networking/00-network-vocabulary.md
related:
  - 01-browser-request-render.md
  - ../../04-infrastructure/01-networking/01-ip-port-dns.md
  - ../../04-infrastructure/01-networking/03-tls.md
---

# URL → DNS → TCP → TLS

> Trước khi có một byte HTTP nào, ba việc phải xảy ra. Mỗi việc có failure mode và error message riêng — nhận ra chúng giúp bạn debug đúng tầng ngay từ đầu.

> **Chưa biết những từ này?** [Từ vựng Web](00-web-vocabulary.md) — URL, scheme, host, port · [Từ vựng Network](../../04-infrastructure/01-networking/00-network-vocabulary.md) — IP, port, socket, TCP, DNS, TLS

## Position

```text
Browser → [DNS → TCP → TLS] → HTTP → Server
              ↑ ở đây
```

## Problem

Bạn thấy một trong các lỗi sau và không biết chúng khác nhau ở đâu:

```text
ERR_NAME_NOT_RESOLVED       ENOTFOUND
ERR_CONNECTION_REFUSED      ECONNREFUSED
ERR_CONNECTION_TIMED_OUT    ETIMEDOUT
ERR_CERT_AUTHORITY_INVALID  SELF_SIGNED_CERT_IN_CHAIN
```

Chúng **không** phải bốn cách nói "không kết nối được". Chúng chỉ ra bốn tầng khác nhau, và mỗi tầng có cách sửa khác nhau. Đọc đúng lỗi tiết kiệm hàng giờ.

## Mental Model

Ba câu hỏi phải trả lời lần lượt, mỗi câu là một tầng:

```text
1. "Máy đó ở đâu?"        → DNS      → trả về IP
2. "Mở đường tới đó"      → TCP      → trả về một kết nối
3. "Nói chuyện riêng"     → TLS      → trả về kênh mã hoá
─────────────────────────────────────────────────
4. "Cho tôi /users"       → HTTP
```

Bảng dịch lỗi → tầng:

| Lỗi | Tầng | Nghĩa |
|---|---|---|
| `ENOTFOUND` / `NAME_NOT_RESOLVED` | DNS | Không dịch được tên thành IP. Sai tên, sai resolver, hoặc service chưa tồn tại |
| `ECONNREFUSED` | TCP | **Tới được máy** nhưng không có ai listen ở port đó. Process chết, sai port, hoặc bind sai interface |
| `ETIMEDOUT` | TCP | Gói tin đi mà không có trả lời. Firewall drop, security group, sai IP, mạng đứt |
| `CERT_*` | TLS | Kết nối được, mã hoá thất bại. Cert hết hạn, sai hostname, CA không tin cậy |
| `404` / `500` | HTTP | Ba tầng dưới **đã thành công**. Vấn đề ở application |

Phân biệt quan trọng nhất: **`ECONNREFUSED` nghĩa là bạn đã tới đúng máy.** Nó là tín hiệu tốt — mạng ổn, chỉ process sai. `ETIMEDOUT` nghĩa là bạn còn chưa chắc đã tới được máy.

## How It Works

### URL có gì

```text
https://api.example.com:443/v1/users?limit=10#top
└─┬─┘   └──────┬──────┘└┬┘└───┬───┘└───┬────┘└┬┘
scheme      host      port  path     query  fragment
```

- **scheme** quyết định port mặc định (`http`=80, `https`=443) và có TLS hay không.
- **host** là thứ được đưa vào DNS.
- **fragment** (`#top`) **không bao giờ được gửi lên server**. Nó chỉ dành cho browser. Đây là lý do bạn không thể log fragment ở backend.
- **query** được gửi lên và thường bị log — **đừng đặt token hay password vào query string**.

### DNS

Phân giải theo thứ tự, dừng ở lần hit đầu tiên:

```text
browser cache → OS cache → hosts file → resolver (ISP/8.8.8.8)
                                            → root → TLD (.com) → authoritative
```

Mỗi record có **TTL**. TTL là lý do đổi DNS không có hiệu lực ngay: client vẫn dùng bản cũ đến khi TTL hết.

Record thường gặp: `A` (IPv4), `AAAA` (IPv6), `CNAME` (bí danh trỏ tên khác), `TXT` (xác thực domain), `SRV` (tên + port).

Trong Docker và Kubernetes, DNS được cung cấp bởi platform: service name → IP nội bộ. Xem [Container networking](../../04-infrastructure/02-docker/02-container-networking.md) và [Service discovery](../../04-infrastructure/04-kubernetes/workloads-networking/02-ingress-service-discovery.md).

### TCP

Three-way handshake: `SYN → SYN-ACK → ACK`. Một round-trip (RTT) trước khi gửi được dữ liệu.

TCP cung cấp: thứ tự, không mất gói (retransmit), flow control. Giá phải trả là **head-of-line blocking**: một gói mất làm chậm mọi thứ sau nó trên cùng kết nối.

Với RTT 100ms: TCP là 100ms, TLS 1.3 thêm 100ms → **200ms trước khi có byte HTTP nào**. Đây là vì sao `preconnect` và connection reuse quan trọng.

### TLS

Sau khi có kết nối, TLS handshake làm ba việc:

1. **Thoả thuận** phiên bản và cipher suite.
2. **Xác thực server** — server gửi certificate chain; client kiểm tra: cert có do CA mà nó tin cậy ký? còn hạn? hostname có khớp?
3. **Tạo khoá phiên** để mã hoá dữ liệu.

TLS 1.3 cần 1 RTT (TLS 1.2 cần 2). Session resumption có thể về 0 RTT.

**SNI** (Server Name Indication) gửi hostname *chưa mã hoá* trong handshake để server biết trả cert nào — đó là cách một IP host nhiều domain HTTPS.

Chi tiết: [TLS](../../04-infrastructure/01-networking/03-tls.md).

## Example

Quan sát cả bốn tầng bằng một lệnh:

```bash
# Tầng 1: chỉ DNS
dig +short api.example.com

# Tầng 2: chỉ TCP tới port
nc -vz api.example.com 443

# Tầng 3: chỉ TLS, xem cert
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null

# Cả 4 tầng, có timing
curl -v -o /dev/null -w \
 'dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
 https://api.example.com/health
```

Output của lệnh cuối cho bạn biết **chính xác trạm nào tốn thời gian**:

```text
dns=0.004 tcp=0.031 tls=0.089 ttfb=0.310 total=0.312
      │         │         │          │
      DNS 4ms   TCP 27ms  TLS 58ms   server 221ms  ← thủ phạm
```

## Prediction

1. Nếu `dig` trả về IP nhưng `nc -vz` timeout — vấn đề ở tầng nào? Firewall hay process?
2. Nếu `nc -vz` thành công nhưng `curl` báo lỗi cert — process có đang chạy không?
3. Bạn đổi A record từ IP cũ sang IP mới, TTL là 3600. Sau 5 phút, bao nhiêu phần trăm client dùng IP mới?
4. `curl https://1.2.3.4/` (IP thật của server) báo lỗi cert dù `curl https://example.com/` thì ổn. Vì sao?
5. Với `time_appconnect` = 0 trong output curl, bạn kết luận gì?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm dòng sai vào `/etc/hosts` trỏ domain về `127.0.0.1` | `ECONNREFUSED` thay vì lỗi DNS — chứng minh DNS đã "thành công" |
| Gọi port không có ai listen: `curl localhost:9999` | `ECONNREFUSED` ngay lập tức, không chờ |
| Gọi IP không tồn tại trong subnet: `curl 10.255.255.1` | `ETIMEDOUT` sau nhiều giây — khác biệt rõ với refused |
| App bind `127.0.0.1` rồi gọi từ container khác | Refused — bind address khác listen |
| Đổi hostname trong URL nhưng giữ IP: `curl --resolve` | Cert mismatch |
| Dùng cert self-signed | `SELF_SIGNED_CERT_IN_CHAIN`; thử `curl -k` để xác nhận đúng là TLS |
| Chặn UDP 53 | DNS chết, mọi thứ chết theo |

## What Usually Goes Wrong

- **Bind `127.0.0.1` trong container.** App chỉ nhận kết nối từ chính container đó. Phải bind `0.0.0.0`. Đây là failure phổ biến nhất của người mới dùng Docker.
- **DNS TTL dài khi cutover.** Hạ TTL xuống 60s **trước** khi đổi, không phải lúc đổi.
- **Cert hết hạn.** Luôn có monitor cho ngày hết hạn — không phụ thuộc vào việc người dùng báo.
- **Cert chỉ có `example.com` mà truy cập `www.example.com`.** SAN không đủ.
- **Timeout mặc định vô hạn** ở HTTP client. Một dependency treo làm treo cả pool. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **Token trong query string** → nằm trong access log của mọi proxy trên đường.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `ECONNREFUSED` và `ETIMEDOUT` như nhau | Refused = tới được máy; timeout = chưa chắc tới được |
| HTTPS chỉ là "HTTP có mã hoá" | Nó còn xác thực server; mã hoá không xác thực thì vô nghĩa với MITM |
| Đổi DNS có hiệu lực ngay | Bị giữ bởi TTL ở nhiều lớp cache |
| Fragment `#x` được gửi lên server | Không bao giờ |
| `localhost` luôn là máy này | Trong container, `localhost` là chính container đó |
| CNAME có thể đặt ở apex domain | Không (theo chuẩn); cần ALIAS/ANAME của nhà cung cấp |
| TLS làm chậm đáng kể | TLS 1.3 + resumption gần như miễn phí; HTTP/2 còn bù lại nhiều hơn |

## Debugging

Thứ tự cố định, mỗi bước loại trừ một tầng:

1. `dig +short <host>` → có IP không? Không → **DNS**.
2. IP đó có đúng như bạn mong đợi? Sai → cache DNS hoặc sai record.
3. `nc -vz <host> <port>` → refused → **không ai listen** (kiểm tra process, `ss -tlnp`). Timeout → **firewall/routing**.
4. `openssl s_client -connect host:443 -servername host` → lỗi ở đây là **TLS**.
5. `curl -v` → có status code nghĩa là 4 tầng dưới đã xong, chuyển sang debug **application**.
6. Cần biết thời gian đi đâu → dùng `-w` với các biến `time_*` như ví dụ trên.

## Production Considerations

- **Đặt TTL thấp trước migration**, khôi phục sau.
- **Health check phải qua đúng đường người dùng đi** — check `127.0.0.1` không phát hiện được lỗi DNS hay LB.
- **Monitor cert expiry** và tự động gia hạn (ACME/Let's Encrypt).
- **`preconnect`** cho domain quan trọng của bên thứ ba: `<link rel="preconnect" href="https://api.example.com">`.
- **Connection pooling** ở HTTP client backend — tạo kết nối mới cho mỗi request tốn 2 RTT mỗi lần.
- Trong K8s, DNS là một dependency thật và có thể là bottleneck (`ndots`, CoreDNS cache).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| TTL DNS thấp | đổi nhanh, failover nhanh | nhiều query, phụ thuộc resolver |
| TTL DNS cao | ít query, resilient | cutover chậm |
| TLS termination ở proxy | app đơn giản, cert tập trung | traffic sau proxy không mã hoá (cần mTLS nếu mạng không tin cậy) |
| HTTP/3 (QUIC, UDP) | ít RTT, không head-of-line blocking | một số mạng doanh nghiệp chặn UDP |

## Explain Without Notes

1. Kể ba câu hỏi mà DNS, TCP, TLS trả lời.
2. `ECONNREFUSED` cho bạn biết chắc chắn điều gì?
3. Vì sao app bind `127.0.0.1` không truy cập được từ container khác?
4. Vì sao đổi DNS không có hiệu lực ngay, và cách chuẩn bị cho cutover?
5. TLS làm hai việc gì, và vì sao chỉ mã hoá là không đủ?

## Related

- [Từ vựng Web](00-web-vocabulary.md) — foundation: URL, scheme, host, port
- [Từ vựng Network](../../04-infrastructure/01-networking/00-network-vocabulary.md) — foundation: IP, port, socket, TCP, DNS, TLS
- [Browser request → render](01-browser-request-render.md) — chuỗi này nằm ở đầu pipeline
- [IP, port, DNS](../../04-infrastructure/01-networking/01-ip-port-dns.md) — góc nhìn infrastructure
- [TCP & UDP](../../04-infrastructure/01-networking/02-tcp-udp.md) — cơ chế TCP chi tiết
- [TLS](../../04-infrastructure/01-networking/03-tls.md) — handshake, cert chain, mTLS
- [Network debugging](../../04-infrastructure/01-networking/06-network-debugging.md) — bộ công cụ
- [Container networking](../../04-infrastructure/02-docker/02-container-networking.md) — vì sao `localhost` khác trong container
