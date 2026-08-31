---
level: intermediate
area: infra
---

# Networking

Giữa hai process có tám tầng có thể hỏng. Folder này dạy **cách phân biệt chúng bằng tín hiệu**, thay vì đoán.

```text
Process A ─ DNS ─ routing ─ firewall ─ NAT ─ TLS ─ LB ─ firewall ─ Process B
```

Hai câu hỏi trả lời được phần lớn sự cố mạng:

```text
① Gói tin có TỚI nơi không?        refused = tới rồi;  timeout = chưa tới
② Thời gian nằm ở giai đoạn nào?   curl -w: dns / conn / tls / ttfb
```

## Vào đây từ đâu

```text
Chưa chắc IP / port / socket / TCP là gì?
        └──▶ 00-network-vocabulary.md   ← từ vựng, ~12 phút

Đã có từ vựng, muốn biết chúng hỏng thế nào?
        └──▶ 01-ip-port-dns.md          ← bắt đầu chuỗi behavior bên dưới

Đang có "không kết nối được" trên tay?
        └──▶ 06-network-debugging.md    ← chạy lệnh gì, theo thứ tự nào
```

Nếu bạn đang chuẩn bị học Docker: đọc `00-network-vocabulary.md` rồi [Ports & sockets](../00-linux/05-ports-sockets.md). Không có hai note đó, `-p 3000:3000` và bind `0.0.0.0` sẽ là phép thuật.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0 | [Từ vựng Network](00-network-vocabulary.md) | IP, port, socket, packet, TCP/UDP, DNS, TLS — **là gì?** |
| 1 | [IP, port & DNS](01-ip-port-dns.md) | Vì sao 10% traffic vẫn đi tới cluster cũ sau 4 tiếng? |
| 2 | [TCP & UDP](02-tcp-udp.md) | Vì sao client treo 15 phút khi peer biến mất? |
| 3 | [TLS](03-tls.md) | Vì sao trình duyệt OK mà `curl` báo lỗi certificate? |
| 4 | [NAT, firewall & routing](04-nat-firewall-routing.md) | Vì sao kết nối database chết sau 5 phút idle? |
| 5 | [Reverse proxy & LB](05-reverse-proxy-load-balancer.md) | Vì sao mỗi lần deploy có 200 lỗi 502? |
| 6 | [Network debugging](06-network-debugging.md) | "Không kết nối được" — chạy lệnh gì, theo thứ tự nào? |

Note 6 là note bạn sẽ mở lại nhiều nhất.

## Bảng tín hiệu

Bảng quan trọng nhất của cả folder:

| Triệu chứng | Nghĩa là | Note |
|---|---|---|
| `NXDOMAIN` | tên không tồn tại | [1](01-ip-port-dns.md) |
| IP khác với authoritative | cache DNS cũ | [1](01-ip-port-dns.md) |
| `network is unreachable` | không có route | [4](04-nat-firewall-routing.md) |
| `connection refused` | **tới nơi**, không ai listen | [2](02-tcp-udp.md) |
| `connection timed out` | **không tới nơi** (firewall DROP) | [4](04-nat-firewall-routing.md) |
| Treo rất lâu rồi mới lỗi | thiếu timeout ở tầng ứng dụng | [2](02-tcp-udp.md) |
| `ECONNRESET` | peer đóng đột ngột (process chết) | [2](02-tcp-udp.md) |
| Kết nối chết đều đặn sau ~5 phút | NAT idle timeout | [4](04-nat-firewall-routing.md) |
| Payload nhỏ OK, payload lớn treo | PMTU black hole | [2](02-tcp-udp.md) |
| `unable to get local issuer certificate` | thiếu CA bundle trong image | [3](03-tls.md) |
| Browser OK, `curl` lỗi cert | thiếu intermediate | [3](03-tls.md) |
| `502` | proxy kết nối được, phản hồi hỏng | [5](05-reverse-proxy-load-balancer.md) |
| `502` chỉ khi deploy | đóng listener trước khi LB rút traffic | [5](05-reverse-proxy-load-balancer.md) |
| `502` rải rác không rõ lý do | `keepAliveTimeout` app < idle timeout LB | [5](05-reverse-proxy-load-balancer.md) |
| `503` | không có backend khoẻ | [5](05-reverse-proxy-load-balancer.md) |
| `504` | app không trả lời kịp | [5](05-reverse-proxy-load-balancer.md) |
| Lỗi kết nối ngẫu nhiên khi tải cao | cạn SNAT port, hoặc bảng conntrack đầy | [4](04-nat-firewall-routing.md) |
| Pod không phân giải được tên nào | NetworkPolicy chặn DNS | [4](04-nat-firewall-routing.md) |
| SSE không nhận gì tới khi kết thúc | `proxy_buffering on` | [5](05-reverse-proxy-load-balancer.md) |
| WebSocket handshake 400 | thiếu header `Upgrade` ở proxy | [5](05-reverse-proxy-load-balancer.md) |

## Bảy bước debug

```bash
# ⓪ Chạy TỪ CHÍNH nơi bị lỗi, không từ laptop
dig +short <host>                          # ① tên
dig @<authoritative-ns> <host> +short      # ② đúng IP? (bỏ qua cache)
ip route get <ip>                          # ③ có route?
nc -zv -w5 <ip> <port>                     # ④ refused hay timeout?  ← QUYẾT ĐỊNH
mtr -rw -T -P <port> -c 20 <ip>            # ⑤ mất gói ở chặng cuối?
openssl s_client -connect <h>:443 -servername <h>   # ⑥ TLS
curl -o /dev/null -sS -w 'dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' <url>   # ⑦ thời gian đi đâu
```

Dừng ở bước đầu tiên thất bại. Bước ④ chia đôi không gian tìm kiếm.

## Sáu con số phải khớp nhau

Sai một cái là một lớp lỗi:

```text
① Timeout xếp thứ tự:  client > LB > proxy > app > DB
② keepAliveTimeout app  >  idle timeout của LB           (nếu không: 502 rải rác)
③ headersTimeout        >  keepAliveTimeout               (nếu không: race → 502)
④ TCP keepalive         <  NAT idle timeout               (nếu không: kết nối chết)
⑤ Delay trước server.close()  ≥ thời gian LB cập nhật     (nếu không: 502 khi deploy)
⑥ terminationGracePeriod  >  preStop + delay + drain
```

Sáu dòng này là nơi phần lớn lỗi 502 và "kết nối chết bí ẩn" sinh ra.

## Ba nguyên tắc

```text
① REFUSED ≠ TIMEOUT
   refused = gói ĐÃ tới (không ai listen)
   timeout = gói KHÔNG tới (firewall/routing)

② Test từ CHÍNH nơi bị lỗi
   Laptop và pod có DNS, route, firewall, trust store khác nhau.

③ Kiểm tra MỌI tầng firewall
   Cloud SG + NACL + host firewall + NetworkPolicy.
   Gói phải qua tất cả; kiểm tra một tầng rồi kết luận là sai.
```

## Position

```text
App → socket → TCP/IP → NAT/firewall → mạng → LB → App khác
                ↑ folder này
```

## Related

- [00-linux/](../00-linux/README.md) — socket, fd, `ss` (đọc trước)
- [02-docker/](../02-docker/README.md) — network namespace, `localhost` trong container
- [04-kubernetes/](../04-kubernetes/README.md) — Service, Ingress, NetworkPolicy
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — cùng chuỗi từ browser
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — chống 502 khi deploy
- [WebSocket gateway](../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md) — kết nối dài qua proxy
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — biết tầng nào chậm trước khi debug mạng

## Version / Context

Linux. `ss` thay `netstat`; `mtr` tốt hơn `traceroute`; `dig` từ `dnsutils`. Ví dụ proxy dùng nginx; Envoy/Traefik/HAProxy/ALB có tham số tương đương. Kubernetes: CoreDNS với `ndots:5`, NetworkPolicy cần CNI hỗ trợ.
