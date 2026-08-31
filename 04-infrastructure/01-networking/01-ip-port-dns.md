---
level: foundation
area: infra
prerequisites:
  - 00-network-vocabulary.md
  - ../00-linux/05-ports-sockets.md
related:
  - 02-tcp-udp.md
  - 06-network-debugging.md
  - ../02-docker/02-container-networking.md
---

# IP, port & DNS

> Deploy phiên bản mới, đổi DNS record trỏ sang cluster mới. 90% traffic chuyển ngay. 10% còn lại vẫn đi tới cluster cũ — trong **bốn tiếng**. Không ai làm gì sai. TTL của record là 3600 giây, và một số resolver bỏ qua cả TTL đó.

> **Chưa biết những từ này?** [Từ vựng Network](00-network-vocabulary.md) — IP, port, DNS record, TTL

## Position

```text
"api.example.com"
   ↓  DNS: tên → IP
203.0.113.10
   ↓  routing: gói tin đi qua các mạng
đến máy đích
   ↓  port: máy nào → process nào
process listen ở đó
```

Ba tầng định danh, ba cơ chế khác nhau, và ba lớp lỗi khác nhau.

## Problem

```text
"Không kết nối được" có thể là:
  · tên không phân giải được         → DNS
  · phân giải ra IP SAI              → DNS cache / cấu hình
  · phân giải đúng nhưng không tới   → routing / firewall
  · tới nơi nhưng không ai nghe      → port / bind
```

Bốn nguyên nhân, bốn cách sửa hoàn toàn khác nhau. Nếu bạn không tách được chúng, mỗi lần debug là một cuộc thử ngẫu nhiên.

## Mental Model

### Ba tầng định danh

```text
IP     máy nào trên mạng          203.0.113.10
PORT   process nào trên máy đó    :443
DNS    tên người đọc được → IP    api.example.com
```

DNS **không** tham gia vào việc truyền dữ liệu. Nó chỉ là một bước tra cứu **trước** khi kết nối. Sau khi có IP, DNS không còn liên quan — đó là lý do đổi DNS không ảnh hưởng kết nối đang mở.

### IP và subnet

```text
10.0.1.42/24
   └────┬───┘└┬┘
        │     └─ prefix: 24 bit đầu là MẠNG
        └─ địa chỉ

/24  → 10.0.1.0 – 10.0.1.255   (254 host dùng được)
/16  → 10.0.0.0 – 10.0.255.255 (~65k)
/32  → đúng một địa chỉ
```

Quy tắc: **cùng subnet → nói chuyện trực tiếp; khác subnet → phải qua gateway.**

Dải riêng (không định tuyến trên internet):

```text
10.0.0.0/8       172.16.0.0/12       192.168.0.0/16
127.0.0.0/8      loopback
169.254.0.0/16   link-local (AWS metadata: 169.254.169.254)
```

Biết dải riêng có ích ngay: nếu `dig` trả về `10.x.x.x` cho một domain công khai, bạn đang nhận DNS nội bộ (split-horizon) — và đó thường là điều bạn muốn, hoặc là dấu hiệu cấu hình sai.

### DNS: chuỗi tra cứu

```text
1. cache của ứng dụng      (Node, JVM, trình duyệt — mỗi cái một chính sách)
2. cache của OS            (systemd-resolved, nscd — không phải máy nào cũng có)
3. /etc/hosts              ← luôn thắng, không có TTL
4. resolver (/etc/resolv.conf)  → recursive resolver
5. root → TLD → authoritative
```

Bốn tầng cache là lý do "tôi đã đổi DNS 10 phút trước mà vẫn chưa thấy": mỗi tầng có TTL riêng, và một số tầng bỏ qua TTL.

Các loại record cần biết:

```text
A       tên → IPv4
AAAA    tên → IPv6
CNAME   tên → TÊN KHÁC (không được đặt ở đỉnh domain cùng record khác)
TXT     text (xác minh domain, SPF, DKIM)
MX      mail
SRV     tên → host + PORT   ← dịch vụ nội bộ, service discovery
NS      uỷ quyền cho name server khác
```

### TTL: hợp đồng bạn không kiểm soát được hoàn toàn

```text
TTL 3600 → resolver được phép cache 1 giờ
```

Ba điều làm TTL không đáng tin như bạn nghĩ:

```text
① Một số resolver BỎ QUA TTL ngắn và áp mức tối thiểu của họ
② Ứng dụng có cache riêng — JVM từng cache VĨNH VIỄN theo mặc định
③ Người dùng có thể đang dùng resolver không tuân thủ
```

Vì thế, quy trình đổi IP an toàn:

```text
① Giảm TTL xuống 60s, ĐỢI hết TTL cũ (nếu TTL cũ là 3600, đợi hơn 1 giờ)
② Đổi record
③ Giữ hạ tầng CŨ chạy ít nhất 24 giờ  ← bước quan trọng nhất
④ Theo dõi traffic tới hạ tầng cũ về 0
⑤ Tăng TTL trở lại
```

Bước ③ giải quyết ví dụ ở đầu note: bạn không kiểm soát được cache của người khác, nên đừng tắt cái cũ.

### DNS trả về nhiều IP — và đó không phải load balancing

```bash
dig +short api.example.com
# 203.0.113.10
# 203.0.113.11
```

```text
✗ Đây KHÔNG phải load balancing đáng tin:
  · client thường chỉ dùng IP ĐẦU TIÊN
  · IP chết vẫn nằm trong record cho tới khi ai đó xoá
  · không có health check
  · cache làm phân bố lệch
```

Round-robin DNS là công cụ phân tán thô, không phải load balancer. Load balancer thật có health check và rút node chết ra ngay. Xem [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md).

### `/etc/resolv.conf` và `search domain`

```text
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

`ndots:5` trong Kubernetes có một hệ quả thực tế lớn:

```text
Tra "api.example.com" (2 dấu chấm < 5)
   → thử LẦN LƯỢT:
     api.example.com.default.svc.cluster.local   ✗
     api.example.com.svc.cluster.local           ✗
     api.example.com.cluster.local               ✗
     api.example.com                             ✓
   ⇒ 4 truy vấn DNS cho MỘT lần tra cứu domain ngoài
```

Với ứng dụng gọi API bên ngoài nhiều lần, đây là chi phí thật và là nguyên nhân của "DNS chậm trong cluster".

Cách sửa: dùng FQDN kết thúc bằng dấu chấm (`api.example.com.`) để bỏ qua search list, hoặc giảm `ndots` trong pod spec:

```yaml
dnsConfig:
  options: [{ name: ndots, value: "2" }]
```

### DNS trong Kubernetes

```text
<service>.<namespace>.svc.cluster.local

api.default.svc.cluster.local
api.default          ← đủ nếu cùng cluster
api                  ← đủ nếu cùng namespace
```

```text
Service thường (ClusterIP)  → DNS trả về MỘT IP ảo; kube-proxy phân phối
Headless Service (None)     → DNS trả về IP của TỪNG pod
```

Headless service dùng cho StatefulSet và cho client tự làm load balancing (gRPC). Xem [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md).

### DNS cache trong ứng dụng

```text
Node.js  không cache (dùng getaddrinfo mỗi lần) → tra cứu mỗi kết nối
         → dùng `cacheable-lookup` nếu cần giảm tải DNS
JVM      networkaddress.cache.ttl — MẶC ĐỊNH CŨ là cache vĩnh viễn
         → nguyên nhân kinh điển: app Java không thấy IP mới sau failover
Go       không cache
Trình duyệt  cache riêng, ~60s tới vài phút
```

Điểm về JVM đáng nhớ: nếu bạn vận hành cả app Java, `networkaddress.cache.ttl=60` là một dòng cấu hình cần kiểm tra.

## Example

Chẩn đoán "không kết nối được", theo thứ tự loại trừ:

```bash
# 1. Tên có phân giải được không?
dig +short api.example.com
# (rỗng) → vấn đề DNS
# 203.0.113.10 → đi tiếp

# 2. Nó phân giải ra ĐÚNG IP không?
dig api.example.com +noall +answer
# api.example.com. 3600 IN A 203.0.113.10     ← chú ý TTL
#
# So với authoritative (bỏ qua mọi cache):
dig @ns1.example.com api.example.com +short
# 203.0.113.20     ← KHÁC! → bạn đang nhận cache cũ

# 3. IP có tới được không?
ping -c3 203.0.113.10        # có thể bị chặn ICMP — không kết luận vội
mtr -rw -c 10 203.0.113.10   # đường đi và nơi mất gói

# 4. Port có mở không?
nc -zv 203.0.113.10 443
# succeeded  → có ai listen
# refused    → không có process nào listen ở đó
# timed out  → firewall nuốt gói

# 5. Ứng dụng phía trên
curl -sv https://api.example.com/health
```

Năm bước, và mỗi bước loại trừ một tầng. Bước 2 (so với authoritative) là bước hay bị bỏ và thường chính là câu trả lời.

## Prediction

1. Đổi A record, TTL 3600, sau 10 phút — bao nhiêu client thấy IP mới?
2. Giảm TTL xuống 60 rồi đổi record ngay lập tức — client thấy IP mới sau bao lâu?
3. Đổi DNS trong khi có kết nối TCP đang mở — kết nối đó thế nào?
4. `/etc/hosts` có entry cho `api.example.com`, DNS trả về IP khác — cái nào thắng?
5. DNS trả về 3 IP, một IP chết — client thế nào?
6. `nc -zv` trả `refused` — DNS đúng hay sai? Vấn đề ở đâu?
7. `nc -zv` trả `timed out` — nghi ngờ gì?
8. Kubernetes `ndots:5`, app gọi `api.stripe.com` — bao nhiêu truy vấn DNS?
9. Thêm dấu chấm cuối (`api.stripe.com.`) — bao nhiêu?
10. App Java cache DNS vĩnh viễn, database failover sang IP mới — app thế nào?
11. `dig` từ máy bạn trả về `203.0.113.10`, `dig @authoritative` trả về `203.0.113.20` — nguyên nhân?
12. Headless Service trong K8s, `dig` tên service — trả về gì?
13. `dig` một domain công khai trong VPC trả về `10.0.5.20` — nghĩa là gì?

<details>
<summary>Đáp án</summary>

1. Tuỳ resolver của họ cache từ khi nào — có thể **tới 1 giờ** sau. Không kiểm soát được.
2. **Không nhanh** — TTL cũ (3600) vẫn còn hiệu lực với cache đã tạo. Phải đợi hết TTL **cũ** trước.
3. **Không ảnh hưởng** — kết nối đã có IP; DNS chỉ dùng lúc thiết lập.
4. **`/etc/hosts` thắng**, và nó không có TTL. Đây là nguyên nhân kinh điển của "chỉ máy tôi bị".
5. Client thường thử IP đầu tiên; nếu đó là IP chết, nó chờ timeout rồi mới (có thể) thử IP khác — hoặc bỏ cuộc.
6. DNS **đúng** (đã có IP). Vấn đề ở tầng port/app: không có process nào listen.
7. Firewall/security group nuốt gói, hoặc sai IP, hoặc routing sai.
8. **4** — ba lần thử với search domain, rồi mới tra tên thật.
9. **1** — FQDN bỏ qua search list.
10. App tiếp tục gọi IP **cũ** cho tới khi restart. Sự cố kéo dài không giải thích được nếu không biết cơ chế này.
11. Bạn đang nhận **cache cũ** ở đâu đó trong chuỗi (resolver, OS, app).
12. **IP của từng pod**, không phải một ClusterIP.
13. Split-horizon DNS: resolver nội bộ trả IP riêng cho domain công khai. Thường là có chủ đích (private endpoint).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm entry sai vào `/etc/hosts`, gọi API | Đi sai đích; `dig` vẫn đúng |
| Đổi A record, `dig` liên tục mỗi 10 giây | Thấy TTL đếm ngược rồi giá trị đổi |
| So `dig` với `dig @authoritative` | Phát hiện cache cũ |
| Chặn port ở firewall (DROP), `nc -zv` | `timed out` |
| Tắt app, `nc -zv` | `refused` — khác biệt rõ ràng |
| Đo thời gian DNS trong pod K8s cho domain ngoài | Nhiều truy vấn vì `ndots` |
| Thêm dấu chấm cuối, đo lại | Nhanh hơn |
| Đặt `networkaddress.cache.ttl=-1` trong JVM, đổi IP | App không bao giờ thấy IP mới |
| DNS trả 2 IP, tắt một, gọi 100 lần | Đếm số lần lỗi |
| `dig` một tên có CNAME chuỗi dài | Đếm số bước phân giải |
| Đặt TTL 30 giây rồi đo tần suất truy vấn DNS | Tải lên resolver tăng |

## What Usually Goes Wrong

- **Đổi DNS rồi tắt hạ tầng cũ ngay** → 10% traffic mất trong nhiều giờ.
- **Không giảm TTL trước khi đổi** → không kiểm soát được thời điểm chuyển.
- **`/etc/hosts` bị bỏ quên** → "chỉ máy tôi bị", không ai nghĩ tới.
- **Dựa vào round-robin DNS làm load balancing** → traffic vào node chết.
- **Không biết app cache DNS** → app không thấy IP mới sau failover.
- **`ndots:5` trong K8s** → 4× truy vấn DNS cho mọi domain ngoài.
- **CoreDNS không đủ tài nguyên** → DNS chậm làm mọi thứ chậm; triệu chứng lan toả và khó quy trách nhiệm.
- **Không phân biệt `refused` và `timed out`** → debug sai tầng.
- **Dùng IP cứng trong cấu hình** → không đổi được hạ tầng mà không sửa code.
- **TTL rất ngắn (5s)** → tải lớn lên resolver, và nhiều resolver bỏ qua nó.
- **Quên `AAAA` record khi bật IPv6** → client thử IPv6 trước, timeout, rồi mới fallback.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Đổi DNS có hiệu lực ngay | Cache ở nhiều tầng, một số bỏ qua TTL |
| TTL đảm bảo thời điểm chuyển | Nó là gợi ý; resolver có thể không tuân thủ |
| Đổi DNS ngắt kết nối đang mở | Không — kết nối đã có IP |
| DNS nhiều IP = load balancing | Không có health check, client thường dùng IP đầu |
| `ping` được nghĩa là kết nối được | ICMP thường bị chặn riêng; và ping không kiểm tra port |
| `refused` và `timeout` như nhau | Một cái có phản hồi, một cái không |
| DNS chỉ là tra cứu tên, không ảnh hưởng hiệu năng | Trong K8s với `ndots:5`, nó là chi phí thật |
| `/etc/hosts` chỉ dùng khi dev | Nó luôn thắng, kể cả ở production |
| Mọi runtime xử lý DNS như nhau | JVM từng cache vĩnh viễn theo mặc định |
| CNAME dùng được ở đỉnh domain | Không, khi có record khác cùng tên (dùng ALIAS/ANAME) |

## Debugging

Thứ tự cố định:

1. **Tên có phân giải không?** `dig +short <host>`
2. **Có đúng IP không?** So `dig <host>` với `dig @<authoritative-ns> <host>`. Khác nhau = cache.
3. **Cache ở tầng nào?** Kiểm tra `/etc/hosts` trước, rồi resolver (`resolvectl status`), rồi cache của app.
4. **IP có tới được không?** `mtr -rw -c 10 <ip>` — cho biết mất gói ở chặng nào.
5. **Port có mở không?** `nc -zv <ip> <port>` — `refused` vs `timed out` là hai hướng khác nhau.
6. **Ứng dụng?** `curl -sv` với `-w '%{time_namelookup} %{time_connect} %{time_starttransfer}'` để tách thời gian theo giai đoạn.
7. **Trong K8s:** `kubectl exec -it <pod> -- nslookup <svc>`; kiểm tra `/etc/resolv.conf` và log của CoreDNS.

Bước 6 với `-w` là công cụ ít dùng nhưng rất hiệu quả — nó cho biết thời gian nằm ở DNS, ở TCP, hay ở phía server.

## Production Considerations

- **Quy trình đổi IP**: giảm TTL → đợi hết TTL cũ → đổi → **giữ hạ tầng cũ ≥ 24 giờ** → theo dõi → tăng TTL lại.
- **TTL 300–3600 cho record ổn định**; 60 khi sắp thay đổi. Dưới 60 thường không được tôn trọng và tốn tải.
- **Không dùng IP cứng** trong cấu hình — dùng tên, kể cả cho dịch vụ nội bộ.
- **Load balancer thật thay round-robin DNS** cho mọi thứ cần health check.
- **Trong K8s, giảm `ndots`** hoặc dùng FQDN có dấu chấm cuối cho domain ngoài — nó giảm tải CoreDNS đáng kể.
- **CoreDNS cần đủ replica và tài nguyên**, và cần được theo dõi. DNS chậm biểu hiện thành "mọi thứ chậm" và rất khó quy trách nhiệm.
- **Theo dõi thời gian phân giải DNS** như một metric (`time_namelookup` của curl, hoặc từ APM).
- **Kiểm tra chính sách cache DNS của mọi runtime** bạn vận hành — đặc biệt JVM.
- **Health check phải dùng tên, không dùng IP** — nếu không, nó không phát hiện được vấn đề DNS.
- **Ghi lại mọi thay đổi DNS** với thời điểm — khi có sự cố, "ai đổi gì lúc mấy giờ" là câu hỏi đầu tiên.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| TTL ngắn | chuyển nhanh khi cần | tải DNS cao; nhiều resolver bỏ qua |
| TTL dài | ít truy vấn, ổn định | chuyển chậm, khó kiểm soát |
| Round-robin DNS | không cần hạ tầng | không health check, phân bố lệch |
| Load balancer | health check, phân bố đều | thêm một thành phần, thêm chi phí |
| Dùng tên | linh hoạt, đổi hạ tầng dễ | phụ thuộc DNS hoạt động |
| Dùng IP cứng | không phụ thuộc DNS | không đổi được mà không sửa cấu hình |
| `ndots:5` (mặc định K8s) | tên ngắn tiện | 4× truy vấn cho domain ngoài |
| `ndots:2` | ít truy vấn | phải viết tên đầy đủ hơn |
| Cache DNS ở app | giảm tải resolver | không thấy thay đổi ngay |
| Không cache | luôn mới | mỗi kết nối một lần tra cứu |

## Explain Without Notes

1. Ba tầng định danh và mỗi tầng trả lời câu hỏi gì?
2. Vì sao đổi DNS không có hiệu lực ngay, và bốn tầng cache là gì?
3. Quy trình đổi IP an toàn, và bước nào quan trọng nhất?
4. Vì sao round-robin DNS không phải load balancing?
5. `refused` và `timed out` khác nhau thế nào? Mỗi cái dẫn đi hướng nào?
6. `ndots:5` gây ra chuyện gì trong Kubernetes?
7. Vì sao đổi DNS không ngắt kết nối đang mở?
8. Vì sao `/etc/hosts` là nguyên nhân của "chỉ máy tôi bị"?

## Related

- [Từ vựng Network](00-network-vocabulary.md) — foundation: IP, port, DNS record, TTL
- [Ports & sockets](../00-linux/05-ports-sockets.md) — bind, `refused` vs `timeout`
- [TCP & UDP](02-tcp-udp.md) — cái gì xảy ra sau khi có IP
- [TLS](03-tls.md) — SNI dùng tên, không dùng IP
- [NAT, firewall & routing](04-nat-firewall-routing.md) — vì sao gói tin không tới
- [Reverse proxy & load balancer](05-reverse-proxy-load-balancer.md) — thay round-robin DNS
- [Network debugging](06-network-debugging.md) — quy trình đầy đủ
- [Container networking](../02-docker/02-container-networking.md) — DNS trong Docker
- [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md) — DNS trong K8s
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — cùng chuỗi từ phía browser

## Version / Context

`dig` từ gói `dnsutils`/`bind-utils`. Kubernetes dùng CoreDNS với `ndots:5` mặc định. `systemd-resolved` (Ubuntu hiện đại) có cache riêng — dùng `resolvectl status` và `resolvectl flush-caches`. JVM: `networkaddress.cache.ttl` mặc định phụ thuộc phiên bản và security manager.
