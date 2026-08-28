---
level: intermediate
area: infra
prerequisites:
  - 01-ip-port-dns.md
  - 02-tcp-udp.md
related:
  - ../00-linux/07-debugging-toolbox.md
  - ../04-kubernetes/10-debugging-k8s.md
---

# Network debugging

> "Service A không gọi được service B." Đó là toàn bộ thông tin. Có tám tầng có thể hỏng giữa hai process, và mỗi tầng có một cách kiểm tra riêng. Note này là **thứ tự** kiểm tra — vì kiểm tra đúng thứ tự biến tám khả năng thành ba câu lệnh.

## Position

```text
Process A ─ DNS ─ routing ─ firewall ─ NAT ─ LB ─ firewall ─ Process B
             ↑ tám điểm có thể hỏng, mỗi điểm một cách kiểm tra
```

## Problem

Debug mạng không có quy trình = thử ngẫu nhiên:

```text
"chắc DNS"      → flush cache    → vẫn lỗi
"chắc firewall" → mở hết port    → vẫn lỗi
"chắc app"      → restart        → hết lỗi trong 10 phút rồi lại lỗi
   ⇒ không biết nguyên nhân, nên nó sẽ quay lại
```

Điều làm quy trình khả thi: **mỗi tầng có một tín hiệu phân biệt được.** Bạn không cần đoán — bạn loại trừ.

## Mental Model

### Bảy bước, từ ngoài vào trong

```text
① TÊN có phân giải được không?          dig
② Phân giải ra ĐÚNG IP không?           dig @authoritative
③ IP có TỚI được không?                 mtr / ping
④ PORT có mở không?                     nc -zv     ← refused vs timeout
⑤ TLS có hợp lệ không?                  openssl s_client
⑥ HTTP có trả lời không?                curl -v
⑦ ỨNG DỤNG có xử lý đúng không?         log, trace
```

Dừng ở bước đầu tiên thất bại. Mỗi bước loại trừ mọi tầng phía trên nó.

### Bảng tín hiệu → nguyên nhân

Đây là bảng quan trọng nhất trong note:

```text
Triệu chứng                          Nghĩa là
─────────────────────────────────────────────────────────────
NXDOMAIN                             tên không tồn tại
phân giải ra IP KHÁC authoritative   cache cũ ở đâu đó
network is unreachable               không có route
connection refused                   TỚI được, KHÔNG có ai listen
connection timed out                 KHÔNG tới được (firewall DROP / sai IP)
TLS handshake failure                cert, phiên bản, hoặc cipher
502                                  proxy kết nối được, phản hồi hỏng
503                                  không có backend khoẻ
504                                  app không trả lời kịp
kết nối OK nhưng payload lớn treo    MTU / PMTU black hole
```

Hai dòng đáng nhớ nhất: **`refused` nghĩa là gói tin ĐÃ tới nơi** (chỉ không ai nghe), còn **`timeout` nghĩa là nó không tới** (hoặc phản hồi không về). Chúng dẫn đi hai hướng hoàn toàn khác nhau.

## How It Works

### Bộ công cụ tối thiểu

```bash
dig / nslookup      DNS
ping                ICMP — thường bị chặn, KHÔNG kết luận từ nó
mtr / traceroute    đường đi và nơi mất gói
nc / telnet         port có mở không
curl                HTTP, với đo thời gian theo giai đoạn
openssl s_client    TLS
ss                  socket cục bộ
tcpdump             bắt gói — biện pháp cuối, bằng chứng cuối cùng
```

### `curl -w`: lệnh hữu ích nhất

```bash
curl -o /dev/null -sS -w \
'dns=%{time_namelookup}s conn=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s code=%{http_code}\n' \
https://api.example.com/health
```

Nó tách thời gian theo giai đoạn, và mỗi giai đoạn chỉ vào một tầng:

```text
dns cao   → resolver chậm, hoặc ndots gây nhiều truy vấn
conn cao  → RTT lớn, hoặc bắt tay TCP chậm
tls cao   → bắt tay TLS (TLS 1.2 tốn 2 RTT)
ttfb cao  → SERVER chậm — đây là tín hiệu rõ nhất
total-ttfb cao → tải dữ liệu chậm (băng thông, hoặc response lớn)
```

Một lệnh, và nó trả lời câu hỏi "thời gian đi đâu" chính xác hơn mọi phỏng đoán.

### `nc`: refused vs timeout

```bash
nc -zv -w5 10.0.2.50 5432
# succeeded    → có process listen
# refused      → tới nơi, không ai listen
# timed out    → không tới nơi
```

Bước này quyết định hướng debug, và nó tốn 5 giây.

### `mtr`: đường đi và nơi mất gói

```bash
mtr -rw -c 20 api.example.com
# HOST                    Loss%  Snt  Avg  Best  Wrst
# 1. gateway               0.0%   20  0.5   0.4   1.2
# 2. isp-router           0.0%   20  8.2   7.1  15.0
# 3. ???                 100.0%   20  0.0   0.0   0.0    ← chặn ICMP, KHÔNG phải đứt
# 4. api.example.com       0.0%   20 45.1  44.0  52.0    ← vẫn tới được
```

Điểm quan trọng: **mất gói ở chặng GIỮA mà chặng cuối vẫn OK là bình thường** — nhiều router giới hạn tốc độ hoặc bỏ qua ICMP. Chỉ mất gói ở **chặng cuối** mới là vấn đề thật.

Nhiều người đọc sai điều này và kết luận "mạng đứt ở chặng 3".

### `tcpdump`: bằng chứng cuối cùng

```bash
tcpdump -i any -nn 'host 10.0.2.50 and port 5432' -c 100 -w /tmp/c.pcap
tcpdump -r /tmp/c.pcap -nn
```

Đọc kết quả:

```text
SYN đi ra, KHÔNG có SYN-ACK          → gói bị chặn, hoặc peer không listen
SYN đi ra, nhận RST                  → peer từ chối (không có process)
SYN-ACK về, rồi im lặng              → bắt tay OK, app không trả lời
retransmission liên tục              → mất gói trên đường
```

Sức mạnh thật của `tcpdump` là **bắt ở CẢ HAI đầu cùng lúc**:

```text
Thấy SYN ra ở A, KHÔNG thấy ở B  → bị chặn ở GIỮA
Thấy SYN ở B, không có phản hồi  → vấn đề ở B
```

Đây là bước biến phỏng đoán thành bằng chứng, và nó kết thúc mọi tranh cãi "không phải phía tôi".

### Trong container: công cụ không có sẵn

```bash
# Kubernetes: container tạm cùng namespace mạng với pod
kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>

# Docker
docker run --rm -it --net=container:<id> nicolaka/netshoot

# Không có gì cả: đọc /proc
cat /proc/net/tcp        # socket dạng hex
cat /proc/net/route
```

### Kiểm tra từ đúng chỗ

Đây là sai lầm quy trình phổ biến nhất:

```text
✗ Test từ MÁY BẠN khi vấn đề là pod → pod
✓ Test từ CHÍNH pod bị lỗi
```

Đường đi, DNS resolver, firewall, trust store — tất cả đều khác nhau giữa máy bạn và pod. Một `curl` thành công từ laptop không nói gì về việc pod có gọi được hay không.

## Example

"Pod không gọi được RDS", từ đầu tới cuối:

```bash
POD=api-7f8b

# ① DNS
kubectl exec $POD -- nslookup db.abc.rds.amazonaws.com
# 10.0.2.50  ✓

# ② Đúng IP không (so với authoritative — bỏ qua cache)
kubectl exec $POD -- dig +short db.abc.rds.amazonaws.com
# giống nhau ✓

# ③ Route
kubectl exec $POD -- ip route get 10.0.2.50
# via 10.0.1.1 dev eth0  ✓

# ④ Port  ← BƯỚC QUYẾT ĐỊNH
kubectl exec $POD -- nc -zv -w5 10.0.2.50 5432
# timed out  ✗   → KHÔNG tới được → firewall DROP

# ⑤ Chặng nào
kubectl exec $POD -- traceroute -n -T -p 5432 10.0.2.50

# ⑥ Kiểm tra TẤT CẢ các tầng firewall — không dừng ở tầng đầu tiên
kubectl get networkpolicy -A                              # NetworkPolicy?
aws ec2 describe-security-groups --group-ids sg-rds       # SG của RDS?
aws ec2 describe-network-acls --filters ...               # NACL cả hai chiều?
aws ec2 describe-route-tables --filters ...               # route table?

# ⇒ Tìm thấy: SG của RDS chỉ cho phép CIDR của node group CŨ.
#    Cluster đã thêm node group mới tháng trước.
```

Bốn lệnh đầu tốn 30 giây và loại trừ ba tầng. Bước ⑥ là nơi tốn thời gian — và cách rút ngắn nó là kiểm tra **tất cả** thay vì dừng ở cái đầu tiên trông có vẻ hợp lý.

## Prediction

1. `ping` không có phản hồi nhưng `curl` hoạt động — nghĩa là gì?
2. `nc -zv` trả `refused` — gói tin có tới đích không?
3. `nc -zv` trả `timed out` — gói tin có tới đích không?
4. `mtr` cho thấy chặng 3 mất 100% gói nhưng chặng cuối 0% — có vấn đề không?
5. `dig` từ máy bạn khác `dig @authoritative` — nguyên nhân?
6. `curl -w` cho `ttfb=8.5s` nhưng `conn=0.04s` — vấn đề ở đâu?
7. `curl -w` cho `dns=2.1s` — nghi ngờ gì?
8. `tcpdump` thấy SYN đi ra nhưng không có SYN-ACK — hai khả năng?
9. `tcpdump` ở A thấy SYN ra, ở B không thấy gì — kết luận?
10. Payload 500 byte OK, payload 5 KB treo, có VPN ở giữa — nghi gì?
11. Test từ laptop thành công, từ pod thất bại — điều đó nói lên gì?
12. `ss` cho `Recv-Q` 200KB không giảm ở phía server — vấn đề ở đâu?
13. Kết nối hoạt động 5 phút rồi chết, lặp lại đều đặn — nghi gì?

<details>
<summary>Đáp án</summary>

1. **ICMP bị chặn** — bình thường. Không bao giờ kết luận "máy chết" từ ping thất bại.
2. **Có** — gói tới nơi, kernel trả RST vì không có process nào listen.
3. **Không** (hoặc phản hồi không về) — firewall DROP, sai IP, hoặc routing sai.
4. **Không** — router chặng giữa không trả lời ICMP. Chỉ mất gói ở **chặng cuối** mới đáng lo.
5. **Cache cũ** ở resolver, OS, hoặc app.
6. **Server chậm** — kết nối nhanh, thời gian nằm ở việc server tạo phản hồi.
7. DNS chậm: resolver quá tải, hoặc `ndots` gây nhiều truy vấn (trong K8s).
8. (a) Gói bị chặn trên đường (DROP). (b) Peer không listen và cũng không gửi RST (hiếm, thường do firewall trên chính peer).
9. Gói bị chặn **ở giữa** A và B — không phải lỗi của B.
10. **PMTU black hole** — MTU không khớp và ICMP bị chặn.
11. Đường đi/DNS/firewall khác nhau. Test từ laptop **không có giá trị** cho vấn đề pod→pod.
12. **Ứng dụng không đọc** — dữ liệu đã tới kernel nhưng app không `read()`. Thường là event loop bị chặn.
13. **NAT idle timeout** (thường 300s) xoá kết nối. Cần TCP keepalive ngắn hơn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `iptables -A INPUT -p icmp -j DROP` rồi ping và curl | Ping fail, curl OK |
| `iptables ... -j DROP` port cụ thể, `nc -zv` | Timeout |
| Đổi sang `REJECT` | Refused |
| Thêm entry sai vào `/etc/hosts` | `dig` đúng, ứng dụng sai |
| `curl -w` với server chậm (thêm `sleep`) | `ttfb` cao, `conn` thấp |
| `tc qdisc add dev eth0 root netem delay 200ms` | `conn` và `tls` tăng |
| `netem loss 10%` | `mtr` thấy mất gói ở chặng cuối |
| Đặt MTU lệch hai đầu, chặn ICMP, gửi payload lớn | Treo im lặng |
| `tcpdump` ở hai đầu khi chặn giữa | Thấy SYN ở A, không ở B |
| Chặn event loop rồi gửi dữ liệu lớn, xem `Recv-Q` ở server | Tăng không giảm |
| Đặt NAT idle timeout 30s, để kết nối im 60s | Kết nối chết |
| Thêm TCP keepalive 20s, lặp lại | Sống |
| Test từ laptop và từ pod cho cùng đích | Kết quả khác nhau |

## What Usually Goes Wrong

- **Test từ sai chỗ** → kết luận vô nghĩa. Sai lầm quy trình phổ biến nhất.
- **Kết luận từ `ping`** → ICMP thường bị chặn riêng.
- **Không phân biệt `refused` và `timeout`** → debug sai tầng ngay từ đầu.
- **Đọc sai `mtr`** → tưởng đứt ở chặng giữa.
- **Chỉ kiểm tra một tầng firewall** → mất hàng giờ.
- **Bỏ qua `/etc/hosts`** → "chỉ máy tôi bị".
- **Không so DNS với authoritative** → không phát hiện cache cũ.
- **Không bắt gói khi cần** → tranh cãi "không phải phía tôi" không kết thúc.
- **Không ghi lại đã loại trừ gì** → người tiếp theo làm lại từ đầu.
- **Quên MTU khi có VPN/overlay** → treo im lặng với payload lớn.
- **Quên NAT idle timeout** → kết nối dài chết đều đặn mà không rõ lý do.
- **Dừng ở nguyên nhân đầu tiên tìm thấy** → có thể có nhiều lớp.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Ping được nghĩa là kết nối được | ICMP và TCP là hai chuyện khác nhau |
| Ping không được nghĩa là máy chết | ICMP thường bị chặn |
| `refused` và `timeout` như nhau | Một cái tới nơi, một cái không |
| Mất gói ở chặng giữa `mtr` là vấn đề | Chỉ chặng cuối mới quan trọng |
| Test từ máy nào cũng như nhau | Đường đi, DNS, firewall, trust store đều khác |
| `tcpdump` chỉ dành cho chuyên gia mạng | Nó là cách duy nhất có bằng chứng dứt khoát |
| DNS đúng nghĩa là mạng đúng | Còn sáu tầng nữa |
| Timeout nghĩa là server chậm | Thường là firewall DROP |
| Một tầng firewall là đủ để kiểm tra | Gói phải qua tất cả |
| Kết nối chết đều đặn là mạng kém | Thường là NAT idle timeout |

## Debugging

Quy trình đầy đủ, và mỗi bước có một lệnh:

```text
⓪ TỪ ĐÂU?  Chạy mọi lệnh TỪ CHÍNH nơi bị lỗi.

① dig +short <host>                       tên phân giải được?
② dig @<authoritative> <host>             có đúng IP không?
③ ip route get <ip>                       có route không?
④ nc -zv -w5 <ip> <port>                  refused hay timeout?
⑤ mtr -rw -T -P <port> -c 20 <ip>         mất gói ở chặng cuối?
⑥ openssl s_client -connect <h>:443 -servername <h>   TLS?
⑦ curl -o /dev/null -sS -w '<format>' <url>           thời gian đi đâu?
⑧ tcpdump ở CẢ HAI đầu                    bằng chứng cuối cùng
```

Và sau khi tìm ra:

```text
⑨ Ghi lại: triệu chứng, đã loại trừ gì, nguyên nhân, cách sửa, cách phòng.
```

Bước ⑨ là bước biến một lần debug thành kiến thức của cả team.

## Production Considerations

- **Cài sẵn `netshoot`** (hoặc image tương đương) và biết cách dùng `kubectl debug` **trước** khi có sự cố.
- **Image production giữ tối giản** — dùng debug container thay vì nhét công cụ vào.
- **Đo `time_namelookup`, `time_connect`, `time_starttransfer`** từ ứng dụng, không chỉ tổng thời gian. Ba số này chỉ ra ba tầng khác nhau.
- **Health check ngoài (synthetic monitoring)** từ nhiều vùng — nó phát hiện vấn đề DNS và routing mà monitoring nội bộ không thấy.
- **Log `upstream_addr` và `upstream_response_time`** ở proxy — không có chúng, bạn không biết instance nào chậm.
- **Runbook cho ba triệu chứng phổ biến**: `connection refused`, `timeout`, `502` — với đúng chuỗi lệnh.
- **Ghi lại sơ đồ mạng thật**: mọi tầng firewall, mọi NAT, mọi proxy, với timeout của từng cái. Khi có sự cố, không ai có thời gian dựng lại sơ đồ này.
- **Distributed tracing** để biết thời gian nằm ở service nào trước khi phải debug mạng. Xem [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
- **Postmortem cho mọi sự cố mạng** — chúng lặp lại, và người tiếp theo cần biết bạn đã loại trừ gì.
- **Kiểm tra MTU khi dựng overlay network mới** — nó là lớp lỗi khó chẩn đoán nhất và dễ phòng nhất.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Công cụ trong image app | luôn sẵn sàng | image lớn, bề mặt tấn công |
| Debug container | image sạch | cần quyền, cần biết cách |
| `tcpdump` ở production | bằng chứng dứt khoát | tốn CPU/đĩa, có thể chứa dữ liệu nhạy cảm |
| Chỉ đọc log | không xâm lấn | có thể không đủ thông tin |
| `REJECT` trong nội bộ | fail nhanh, dễ debug | tiết lộ có máy ở đó |
| `DROP` | kín | timeout, khó debug |
| Synthetic monitoring | phát hiện sớm từ bên ngoài | chi phí, có thể báo động giả |
| Chỉ monitoring nội bộ | rẻ | không thấy vấn đề DNS/routing bên ngoài |
| Distributed tracing | biết ngay tầng nào chậm | chi phí triển khai và runtime |

## Explain Without Notes

1. Bảy bước debug mạng theo thứ tự, và mỗi bước dùng lệnh gì?
2. `refused` và `timeout` khác nhau thế nào? Mỗi cái dẫn đi đâu?
3. Vì sao không kết luận gì từ `ping` thất bại?
4. Đọc `mtr` thế nào? Mất gói ở chặng nào mới đáng lo?
5. `curl -w` tách thời gian thành những giai đoạn nào, và mỗi giai đoạn chỉ vào tầng nào?
6. Vì sao phải test từ chính nơi bị lỗi?
7. `tcpdump` ở hai đầu cho bạn kết luận gì mà một đầu không cho được?
8. Kết nối chết đều đặn sau 5 phút — nghi gì đầu tiên?

## Related

- [IP, port & DNS](01-ip-port-dns.md) — bước ① và ②
- [TCP & UDP](02-tcp-udp.md) — bước ③ và ④, MTU, keepalive
- [TLS](03-tls.md) — bước ⑥
- [NAT, firewall & routing](04-nat-firewall-routing.md) — nguyên nhân của timeout
- [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md) — 502/503/504
- [Linux debugging toolbox](../00-linux/07-debugging-toolbox.md) — tầng OS
- [Ports & sockets](../00-linux/05-ports-sockets.md) — `ss`, trạng thái socket
- [Debugging Kubernetes](../04-kubernetes/10-debugging-k8s.md) — tầng orchestrator
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — biết tầng nào chậm trước khi debug mạng

## Version / Context

`dig` từ `dnsutils`/`bind-utils`; `mtr`, `nc`, `tcpdump` từ gói cùng tên. `nicolaka/netshoot` là image debug phổ biến. `kubectl debug` (ephemeral container) ổn định từ Kubernetes 1.25.
