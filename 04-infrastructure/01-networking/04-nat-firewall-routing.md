---
level: intermediate
area: infra
prerequisites:
  - 01-ip-port-dns.md
  - 02-tcp-udp.md
related:
  - 06-network-debugging.md
  - ../02-docker/02-container-networking.md
---

# NAT, firewall & routing

> Pod trong Kubernetes gọi được `google.com` nhưng không gọi được database RDS trong cùng VPC. Không có lỗi DNS — tên phân giải ra đúng IP riêng. `curl` treo rồi timeout. Nguyên nhân không nằm ở cluster, ở pod, hay ở database: nó nằm ở một dòng trong security group mà không ai nhớ đã tạo.

## Position

```text
Gói tin rời process
   ↓  ROUTING     đi ra interface nào, qua gateway nào?
   ↓  FIREWALL    có được phép không? (mỗi chặng)
   ↓  NAT         địa chỉ nguồn/đích có bị đổi không?
   ↓  ...lặp lại ở mỗi chặng...
đến đích
```

Ba cơ chế này quyết định gói tin **có tới nơi không**, và chúng hoạt động ở **mọi chặng** — không chỉ ở điểm đầu và điểm cuối.

## Problem

```text
"Không kết nối được" khi DNS đã đúng có ba nguyên nhân ở tầng này:

① ROUTING sai      không có đường tới mạng đích
② FIREWALL chặn    có đường, nhưng bị từ chối
③ NAT              gói đi được, nhưng phản hồi không về được
```

Và chúng có triệu chứng gần giống nhau, nên phải phân biệt bằng cách quan sát:

```text
REJECT (firewall trả lời)  → connection refused NGAY
DROP   (firewall im lặng)  → TIMEOUT sau vài chục giây   ← phổ biến hơn trong cloud
Không có route             → "network is unreachable" NGAY
NAT một chiều              → gói đi được, không có phản hồi → timeout
```

`DROP` là hành vi mặc định của hầu hết security group và firewall trong cloud — vì `REJECT` tiết lộ rằng có gì đó ở đó. Đó là lý do timeout là triệu chứng phổ biến nhất.

## Mental Model

### Routing: bảng "đi đâu qua đâu"

```bash
ip route
# default via 10.0.1.1 dev eth0          ← không khớp gì khác thì đi đây
# 10.0.1.0/24 dev eth0 proto kernel scope link src 10.0.1.42
# 172.17.0.0/16 dev docker0

ip route get 8.8.8.8        # kernel sẽ chọn đường nào?
```

Quy tắc: **prefix dài nhất thắng.** `/32` thắng `/24` thắng `/0` (default).

`ip route get <ip>` là lệnh hữu ích nhất ở đây — thay vì đọc bảng và tự suy luận, nó cho biết kernel **thực sự** chọn gì.

### NAT: đổi địa chỉ trên đường đi

```text
SNAT / masquerade   đổi địa chỉ NGUỒN
   nhiều máy riêng ──▶ một IP công khai
   dùng cho: máy riêng ra internet, pod ra ngoài cluster

DNAT / port forward đổi địa chỉ ĐÍCH
   IP công khai:80 ──▶ máy riêng:8080
   dùng cho: docker -p, load balancer, ingress
```

NAT phải giữ **bảng kết nối** để biết phản hồi thuộc về ai:

```text
10.0.1.5:54321 → 203.0.113.1:443   ánh xạ thành
198.51.100.7:61000 → 203.0.113.1:443

Phản hồi tới 198.51.100.7:61000 → tra bảng → chuyển về 10.0.1.5:54321
```

Từ đó ra ba hệ quả thực tế:

```text
① NAT có TRẠNG THÁI → bảng có giới hạn kích thước
   Nhiều kết nối đồng thời → bảng đầy → kết nối mới BỊ DROP
   Triệu chứng: lỗi kết nối ngẫu nhiên khi tải cao, không có pattern rõ

② Kết nối IDLE bị xoá khỏi bảng (thường sau 300–350 giây)
   → kết nối dài (WebSocket, DB pool) "chết im lặng"
   → cách sửa: TCP keepalive NGẮN HƠN idle timeout của NAT

③ NAT làm mất IP nguồn thật
   → server thấy IP của gateway, không thấy IP client
   → cần X-Forwarded-For hoặc PROXY protocol
```

Điểm ② là nguyên nhân kinh điển của "kết nối database chết sau 5 phút không hoạt động" trong môi trường cloud.

### SNAT port exhaustion

```text
Một IP NAT có ~64k port cho mỗi (IP đích, port đích)
Nhiều instance sau một NAT gateway, cùng gọi một API bên ngoài
   → cạn port → kết nối mới thất bại
   → triệu chứng: lỗi ngẫu nhiên khi tải cao
```

Cách sửa: keep-alive (ít kết nối hơn), nhiều IP cho NAT gateway, hoặc VPC endpoint để không đi qua NAT.

### Firewall: nhiều tầng, tất cả phải cho phép

```text
Cloud:        security group (theo instance)  +  NACL (theo subnet)
Host:         iptables / nftables / ufw
Kubernetes:   NetworkPolicy
Ứng dụng:     bind interface, allowlist IP
```

**Gói tin phải qua được TẤT CẢ.** Kiểm tra một tầng và kết luận là sai — đây là lý do debug firewall tốn thời gian.

Khác biệt quan trọng trong AWS:

```text
Security Group   CÓ TRẠNG THÁI  → cho phép vào thì phản hồi tự động được ra
NACL             KHÔNG trạng thái → phải mở CẢ HAI CHIỀU (nhớ ephemeral port!)
```

Quên chiều về trong NACL là một lỗi phổ biến và triệu chứng của nó là timeout một chiều.

### `REJECT` vs `DROP`

```bash
iptables -A INPUT -p tcp --dport 8080 -j REJECT   # trả về RST → refused NGAY
iptables -A INPUT -p tcp --dport 8080 -j DROP     # im lặng → TIMEOUT
```

```text
DROP  + không tiết lộ có gì ở đó
      - client chờ timeout → tài nguyên bị giữ lâu
REJECT + client fail nhanh, dễ debug
      - tiết lộ có máy ở đó
```

Với mạng nội bộ, `REJECT` thường tốt hơn: fail nhanh dễ chẩn đoán hơn nhiều so với timeout. Với mạng công khai, `DROP` là mặc định hợp lý.

### Kubernetes NetworkPolicy

```text
MẶC ĐỊNH: mọi pod nói chuyện được với mọi pod
Có NetworkPolicy chọn một pod → pod đó chuyển sang DENY mọi thứ
   trừ những gì được cho phép TƯỜNG MINH
```

```yaml
# chặn mọi ingress cho pod có label app=api
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-default-deny }
spec:
  podSelector: { matchLabels: { app: api } }
  policyTypes: [Ingress]
```

```yaml
# rồi cho phép tường minh
spec:
  podSelector: { matchLabels: { app: api } }
  ingress:
    - from: [{ podSelector: { matchLabels: { app: web } } }]
      ports: [{ protocol: TCP, port: 3000 }]
```

Hai điều hay bị quên và cả hai gây sự cố:

```text
① Chặn egress mà quên cho phép DNS (UDP/TCP 53 tới kube-dns)
   → pod không phân giải được TÊN NÀO → mọi thứ hỏng, triệu chứng khó hiểu
② NetworkPolicy cần CNI hỗ trợ (Calico, Cilium)
   → với CNI không hỗ trợ, policy được CHẤP NHẬN nhưng KHÔNG có hiệu lực
```

Điểm ② nguy hiểm: bạn nghĩ đã bảo vệ và thực tế không.

### Mất IP nguồn qua các tầng

```text
Client 203.0.113.99
   ↓
LB (NAT)          → server thấy IP của LB
   ↓  X-Forwarded-For: 203.0.113.99
Ingress
   ↓  X-Forwarded-For: 203.0.113.99, <ip-lb>
App               → phải parse header, không đọc socket
```

```ts
app.set('trust proxy', 1);   // tin đúng MỘT proxy phía trước
```

`trust proxy` sai cấu hình là một lỗ hổng: nếu tin vô điều kiện, client có thể tự đặt `X-Forwarded-For` và giả mạo IP — làm vô hiệu rate limit theo IP và làm sai audit log.

Với TCP thuần (không HTTP), dùng **PROXY protocol** — nó truyền IP gốc ở một header nhỏ trước dữ liệu, và phải bật ở cả hai phía.

Trong Kubernetes:

```yaml
spec:
  externalTrafficPolicy: Local   # giữ IP nguồn, nhưng chỉ route tới node CÓ pod
```

`Local` giữ IP thật nhưng đánh đổi: node không có pod sẽ không nhận traffic, nên phân bố có thể lệch.

### Hairpin / NAT loopback

```text
Container A gọi IP CÔNG KHAI của chính host mình
   → gói ra rồi phải quay lại
   → nhiều cấu hình KHÔNG hỗ trợ → timeout
```

Cách sửa: dùng địa chỉ nội bộ (tên service, IP riêng) thay vì đi vòng qua IP công khai. Đây là nguyên nhân của "gọi được từ ngoài nhưng không gọi được từ trong".

## Example

Chẩn đoán "pod không gọi được RDS":

```bash
# 1. DNS đúng chưa?
kubectl exec -it api-pod -- nslookup db.abc.rds.amazonaws.com
# → 10.0.2.50   (IP riêng, đúng)

# 2. Có route tới mạng đó không?
kubectl exec -it api-pod -- ip route get 10.0.2.50
# 10.0.2.50 via 10.0.1.1 dev eth0    ← có route

# 3. Port có tới được không?
kubectl exec -it api-pod -- nc -zv -w5 10.0.2.50 5432
# timed out    ← DROP ở đâu đó (nếu là refused thì là app không chạy)

# 4. Đi tới đâu thì mất?
kubectl exec -it api-pod -- traceroute -n -T -p 5432 10.0.2.50

# 5. Kiểm tra TỪNG tầng firewall — không dừng ở tầng đầu tiên
#    a. NetworkPolicy có chặn egress không?
kubectl get networkpolicy -A
#    b. Security group của RDS có cho phép từ CIDR của node/pod không?
aws ec2 describe-security-groups --group-ids sg-rds
#    c. NACL của subnet — CẢ HAI CHIỀU (nhớ ephemeral port 1024-65535)
#    d. Route table của subnet pod có đường tới subnet RDS không?

# ⇒ Thường tìm thấy ở (b): security group chỉ cho phép CIDR của node cũ,
#    và cluster đã thêm node group mới.
```

Bước 5 là bước quyết định, và điểm mấu chốt là **kiểm tra tất cả bốn**, không dừng ở cái đầu tiên trông có vẻ đúng.

## Prediction

1. Firewall `DROP`, client kết nối — nhận gì? Bao lâu?
2. Firewall `REJECT` — nhận gì? Bao lâu?
3. Không có route tới mạng đích — nhận gì?
4. NAT idle timeout 300s, kết nối DB pool không hoạt động 10 phút, rồi dùng lại — kết quả?
5. TCP keepalive 30s trong tình huống trên — kết quả?
6. 500 instance sau một NAT gateway, mỗi cái mở 200 kết nối tới cùng một API — vấn đề gì?
7. Security group cho phép inbound 5432 — phản hồi có cần rule outbound không?
8. NACL cho phép inbound 5432 nhưng không có outbound ephemeral port — kết quả?
9. NetworkPolicy chặn egress, quên cho phép DNS — triệu chứng?
10. Áp NetworkPolicy trên CNI không hỗ trợ — điều gì xảy ra?
11. App sau 2 proxy, `trust proxy` đặt là `true` (tin tất cả) — rủi ro gì?
12. `externalTrafficPolicy: Cluster` — app thấy IP nguồn nào?
13. Container gọi IP công khai của chính host — kết quả thường là gì?

<details>
<summary>Đáp án</summary>

1. **Timeout** sau vài chục giây — không có phản hồi nào.
2. **Connection refused** ngay lập tức (nhận RST).
3. **`Network is unreachable`** ngay lập tức — kernel biết không có đường.
4. Kết nối đã bị xoá khỏi bảng NAT → gói tin không về được → **treo rồi timeout**, hoặc `ECONNRESET`.
5. Keepalive giữ kết nối "hoạt động" → NAT không xoá → **hoạt động bình thường**.
6. 100.000 kết nối tới cùng đích → có thể **cạn SNAT port** → lỗi kết nối ngẫu nhiên khi tải cao.
7. **Không** — security group có trạng thái; phản hồi tự động được phép.
8. **Timeout** — request tới được nhưng phản hồi (từ port ephemeral) bị chặn. NACL không có trạng thái.
9. Pod **không phân giải được tên nào** → mọi kết nối theo tên fail. Triệu chứng trông như "mạng hỏng hoàn toàn".
10. Policy được **chấp nhận nhưng không có hiệu lực** — bạn nghĩ đã bảo vệ và thực tế không.
11. Client tự đặt `X-Forwarded-For` → **giả mạo IP** → rate limit theo IP vô hiệu, audit log sai.
12. IP của **node** (do SNAT), không phải IP client thật.
13. **Timeout** — hairpin NAT thường không được hỗ trợ. Dùng địa chỉ nội bộ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `iptables -A INPUT -p tcp --dport 8080 -j DROP`, thử kết nối | Timeout |
| Đổi sang `REJECT` | Refused ngay |
| `ip route del` route tới một mạng, thử kết nối | `Network is unreachable` |
| `ip route get <ip>` | Kernel chọn đường nào |
| Đặt `nf_conntrack_tcp_timeout_established` rất ngắn, để kết nối idle | Kết nối chết |
| Thêm TCP keepalive ngắn hơn, lặp lại | Sống |
| Mở nhiều kết nối tới cùng đích qua NAT, xem `conntrack -C` | Bảng đầy dần |
| NACL chỉ mở một chiều | Timeout một chiều |
| NetworkPolicy deny-all egress, không cho phép DNS | Mọi tên không phân giải được |
| Thêm rule cho port 53 tới kube-dns | Hoạt động lại |
| Áp NetworkPolicy trên CNI không hỗ trợ, test kết nối bị "chặn" | Vẫn kết nối được |
| Đặt `trust proxy = true`, gửi `X-Forwarded-For: 1.2.3.4` | Log ghi IP giả |
| `externalTrafficPolicy` `Cluster` vs `Local`, log IP nguồn | Node IP vs client IP |
| Container gọi IP công khai của host | Timeout |

## What Usually Goes Wrong

- **Chỉ kiểm tra một tầng firewall** → mất hàng giờ vì tầng khác chặn.
- **NACL quên chiều về** → timeout một chiều, rất khó đoán.
- **NAT idle timeout ngắn hơn keepalive** → kết nối dài chết im lặng.
- **Cạn SNAT port** → lỗi ngẫu nhiên khi tải cao, không có pattern.
- **NetworkPolicy chặn DNS** → toàn bộ pod hỏng với triệu chứng khó hiểu.
- **NetworkPolicy trên CNI không hỗ trợ** → cảm giác an toàn giả.
- **`trust proxy` quá rộng** → giả mạo IP.
- **Không xử lý `X-Forwarded-For`** → mọi client trông như đến từ LB; rate limit theo IP vô nghĩa.
- **Hairpin NAT** → "gọi được từ ngoài, không gọi được từ trong".
- **Security group theo IP thay vì theo security group** → phải cập nhật mỗi lần đổi hạ tầng.
- **Rule quá rộng (`0.0.0.0/0`)** để "cho nhanh" → không ai quay lại thu hẹp.
- **Không ghi lại vì sao mỗi rule tồn tại** → không ai dám xoá rule cũ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Timeout nghĩa là server chậm | Thường là firewall `DROP` |
| Một tầng firewall là đủ để kiểm tra | Gói phải qua tất cả các tầng |
| Security group và NACL như nhau | SG có trạng thái, NACL thì không |
| NAT trong suốt với ứng dụng | Nó có bảng giới hạn, có idle timeout, và giấu IP nguồn |
| Kết nối idle vẫn sống mãi | NAT xoá sau vài phút |
| NetworkPolicy có hiệu lực ngay | Cần CNI hỗ trợ |
| Không có NetworkPolicy = mặc định deny | Ngược lại: mặc định **allow all** |
| `X-Forwarded-For` đáng tin | Client tự đặt được nếu bạn tin vô điều kiện |
| Traceroute không có phản hồi = đứt ở đó | ICMP thường bị chặn ở chặng giữa |
| `ping` được nghĩa là port mở | ICMP và TCP là hai chuyện khác nhau |

## Debugging

Thứ tự cố định:

1. **DNS đúng chưa?** `dig +short <host>` — loại trừ tầng tên.
2. **Có route không?** `ip route get <ip>` — cho biết kernel chọn đường nào.
3. **Port tới được không?** `nc -zv -w5 <ip> <port>` — `refused` vs `timeout` là hai hướng khác nhau.
4. **Mất ở chặng nào?** `mtr -rw -T -P <port> <ip>` hoặc `traceroute -T -p <port>`. Dùng TCP, không dùng ICMP.
5. **Kiểm tra TẤT CẢ các tầng firewall** — cloud SG, NACL, host firewall, NetworkPolicy. Không dừng ở tầng đầu.
6. **Bảng NAT**: `conntrack -L | wc -l`, `conntrack -C`, so với `nf_conntrack_max`.
7. **Bắt gói ở cả hai đầu**: `tcpdump -i any -nn host <ip> and port <port>`. Nếu thấy SYN đi ra ở A mà không thấy tới ở B, gói bị chặn ở giữa — và điều này biến phỏng đoán thành bằng chứng.
8. **Ghi lại kết quả từng bước** — debug mạng thường cần nhiều người, và họ cần biết bạn đã loại trừ gì.

Bước 7 là công cụ mạnh nhất: nó phân biệt dứt khoát "không gửi" với "gửi mà không tới" với "tới mà không trả lời".

## Production Considerations

- **Mặc định deny, cho phép tường minh** — cả ở cloud firewall lẫn NetworkPolicy.
- **Ghi mô tả cho mọi rule**: vì sao tồn tại, ai yêu cầu, khi nào xem lại. Không có nó, không ai dám xoá.
- **Dùng security group tham chiếu security group** (thay vì CIDR) trong AWS — nó tự đúng khi hạ tầng thay đổi.
- **NetworkPolicy: nhớ DNS.** Rule egress đầu tiên luôn là cho phép port 53 tới kube-dns.
- **Xác minh CNI hỗ trợ NetworkPolicy** trước khi dựa vào nó. Test bằng cách thử kết nối bị cấm.
- **TCP keepalive ngắn hơn NAT idle timeout** cho mọi kết nối dài (DB pool, WebSocket, gRPC).
- **Theo dõi bảng conntrack** (`nf_conntrack_count` / `nf_conntrack_max`) — đầy bảng gây lỗi ngẫu nhiên khó chẩn đoán.
- **VPC endpoint thay NAT gateway** cho dịch vụ trong cùng cloud — tránh cạn SNAT port và giảm chi phí.
- **`trust proxy` chính xác số proxy**, không dùng `true`.
- **`externalTrafficPolicy: Local`** khi cần IP nguồn thật, và chấp nhận đánh đổi về phân bố.
- **`REJECT` trong mạng nội bộ** để fail nhanh; `DROP` ở biên công khai.
- **Test kết nối từ chính pod/instance bị lỗi**, không từ máy của bạn — đường đi khác nhau.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `DROP` | không tiết lộ thông tin | timeout, khó debug, giữ tài nguyên client |
| `REJECT` | fail nhanh, dễ debug | tiết lộ có máy ở đó |
| Mặc định deny | an toàn | mỗi kết nối mới cần một rule |
| Mặc định allow | tiện | bề mặt tấn công lớn |
| SG tham chiếu SG | tự đúng khi hạ tầng đổi | chỉ trong cùng VPC |
| SG theo CIDR | linh hoạt, dùng được xuyên VPC | phải cập nhật thủ công |
| NAT gateway | đơn giản, một điểm ra | cạn port, tốn tiền, thêm một điểm chết |
| VPC endpoint | không qua NAT, rẻ hơn | chỉ cho dịch vụ hỗ trợ |
| `externalTrafficPolicy: Local` | giữ IP nguồn | phân bố lệch, mất một chặng cân bằng |
| `Cluster` | phân bố đều | mất IP nguồn thật |
| NetworkPolicy chặt | cô lập tốt | dễ chặn nhầm DNS và service nội bộ |

## Explain Without Notes

1. Ba nguyên nhân "không kết nối được" ở tầng này, và triệu chứng phân biệt chúng?
2. `DROP` và `REJECT` khác nhau thế nào từ phía client?
3. Vì sao NAT có trạng thái, và ba hệ quả của điều đó?
4. Vì sao kết nối database chết sau vài phút idle trong cloud, và cách sửa?
5. Security group và NACL khác nhau ở điểm nào quan trọng nhất?
6. Mặc định của NetworkPolicy là gì? Điều gì xảy ra khi bạn áp policy đầu tiên?
7. Vì sao `trust proxy: true` là lỗ hổng?
8. Bước debug nào biến phỏng đoán thành bằng chứng?

## Related

- [IP, port & DNS](01-ip-port-dns.md) — trước tầng này
- [TCP & UDP](02-tcp-udp.md) — keepalive, timeout
- [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md) — `X-Forwarded-For`, PROXY protocol
- [Network debugging](06-network-debugging.md) — quy trình đầy đủ
- [Container networking](../02-docker/02-container-networking.md) — NAT của Docker
- [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md) — NetworkPolicy, `externalTrafficPolicy`
- [Ports & sockets](../00-linux/05-ports-sockets.md) — `refused` vs `timeout`
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md) — vì sao IP nguồn quan trọng
- [Access control](../../05-cross-cutting/security/04-access-control.md) — mạng là một lớp phòng thủ

## Version / Context

Linux với `nftables`/`iptables`. AWS: security group có trạng thái, NACL không. Kubernetes NetworkPolicy cần CNI hỗ trợ (Calico, Cilium, Weave); `kubenet` và một số CNI đơn giản **không** hỗ trợ. `conntrack` từ gói `conntrack-tools`.
