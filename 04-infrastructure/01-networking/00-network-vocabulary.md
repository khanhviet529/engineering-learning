---
level: beginner
area: infra
type: foundation
prerequisites: []
related:
  - 01-ip-port-dns.md
  - 02-tcp-udp.md
  - 03-tls.md
  - ../00-linux/05-ports-sockets.md
---

# Từ vựng Network: IP, port, socket, TCP, DNS, TLS

## Note này trả lời gì

**Byte đi từ máy này sang máy khác bằng cách nào, và các danh từ trong quá trình đó nghĩa là gì** — IP, port, socket, packet, TCP, UDP, DNS, TLS.

Đây là note **từ vựng**. Nó không dạy TCP handshake thất bại ra sao hay DNS TTL gây sự cố gì. Nó chỉ đảm bảo khi bạn đọc `05-ports-sockets.md` và thấy `bind(IP:port)`, bạn biết cả ba từ đó là gì.

> ~12 phút. Nếu bạn giải thích được vì sao `127.0.0.1` khác `0.0.0.0` khi bind, hãy bỏ qua và vào [01-ip-port-dns.md](./01-ip-port-dns.md).

## Vị trí

```text
App của bạn                     "gửi cái này tới api.shop.com"
   │
   ├─ DNS      api.shop.com ──▶ 203.0.113.10        "máy nào?"
   ├─ TCP      mở kết nối tới 203.0.113.10:443      "cửa nào, và đảm bảo tới đủ"
   ├─ TLS      mã hoá nội dung trong kết nối đó     "ai đọc được?"
   └─ HTTP     gửi GET /orders                      "nói gì"
   │
Máy đích
```

Bốn dòng giữa là bốn lớp độc lập. Lỗi ở mỗi lớp có triệu chứng khác nhau, và nhầm lớp là lý do phần lớn buổi debug network mất hàng giờ.

## Định nghĩa

### IP address — địa chỉ của một máy

**IP address** là con số định danh một máy trên mạng. Máy không có tên; nó có số. Tên là việc của DNS.

```text
IPv4    203.0.113.10          4 số 0–255, cách nhau bằng dấu chấm
IPv6    2001:db8::1           dài hơn, vì IPv4 đã hết địa chỉ
```

Hai loại IP cần phân biệt, vì gần như mọi lỗi "chạy ở local, chết trong container" đến từ đây:

| Loại | Dải | Đi ra Internet được? | Gặp ở đâu |
|---|---|---|---|
| **Public** | mọi dải còn lại | có | server thật, `203.0.113.10` |
| **Private** | `10.x`, `172.16–31.x`, `192.168.x` | không — chỉ trong mạng nội bộ | LAN nhà bạn, mạng Docker, mạng K8s |
| **Loopback** | `127.0.0.1` (tên: `localhost`) | không — **không rời khỏi máy** | dev ở máy mình |

`127.0.0.1` không phải "địa chỉ của máy tôi". Nó là "**chính process này, trong máy này**". Trong container, `127.0.0.1` là bản thân container — không phải laptop của bạn, không phải container khác. Đây là nguyên nhân của lỗi kinh điển: app bind `127.0.0.1`, container chạy tốt, nhưng bên ngoài không kết nối được. Xem [05-ports-sockets.md](../00-linux/05-ports-sockets.md).

`0.0.0.0` khi bind nghĩa là "mọi network interface trên máy này" — đó là cái container cần.

### Port — cửa nào trên máy đó

Một máy chạy nhiều service. IP tìm ra máy; **port** tìm ra **service nào trên máy đó**.

```text
203.0.113.10 : 443     ← Nginx
203.0.113.10 : 5432    ← PostgreSQL
203.0.113.10 : 6379    ← Redis
             └─┬─┘
              port: số 1–65535
```

| Dải | Tên gọi | Ghi chú |
|---|---|---|
| 1–1023 | well-known | cần quyền root để bind trên Linux |
| 1024–49151 | registered | 3000, 5432, 6379, 8080 nằm ở đây |
| 49152–65535 | ephemeral | OS tự cấp cho phía **client** |

Điểm hay bị bỏ qua: **client cũng có port.** Khi browser gọi server, OS cấp cho nó một port ngẫu nhiên. Không có nó thì response không biết quay về đâu.

Port mặc định đáng nhớ: `80` HTTP · `443` HTTPS · `22` SSH · `5432` PostgreSQL · `6379` Redis · `27017` MongoDB · `3000`/`8080` app dev.

### Socket — một đầu của một kết nối

**Socket** là *một đầu của một kênh liên lạc*, mà app dùng như một file: ghi vào để gửi, đọc ra để nhận.

Trong hệ điều hành, socket là một **file descriptor** — cùng loại tay nắm mà app dùng để mở file. Đó là lý do quá nhiều kết nối gây lỗi `EMFILE: too many open files`, một lỗi thoạt trông không liên quan gì tới network.

Một kết nối TCP đã thiết lập được xác định **duy nhất** bởi bốn giá trị:

```text
(IP nguồn, port nguồn, IP đích, port đích)

(192.168.1.5, 51234, 203.0.113.10, 443)     ← tab 1 của browser
(192.168.1.5, 51235, 203.0.113.10, 443)     ← tab 2, chỉ khác port nguồn
```

Bộ bốn này giải thích một điều gây bối rối: **một server ở port 443 phục vụ được hàng nghìn client cùng lúc.** Mỗi kết nối là một bộ bốn khác nhau, nên mỗi cái là một socket riêng. Server không "hết port".

Phân biệt hai loại socket ở server:

```text
listening socket   1 cái, gắn với IP:port         "tôi nhận khách ở đây"
connected socket   1 cái cho MỖI client           "đây là cuộc nói chuyện với khách này"
```

`accept()` là hành động biến một khách mới thành một connected socket. Chi tiết vòng đời: [05-ports-sockets.md](../00-linux/05-ports-sockets.md).

### Packet — dữ liệu đi thành từng mẩu

Mạng **không** chuyển "một file" hay "một HTTP request". Nó chuyển những mẩu nhỏ gọi là **packet**.

```text
JSON 100 KB của bạn
        ↓ chia ra
[pkt][pkt][pkt] ... [pkt]        mỗi packet ~1500 byte (MTU của Ethernet)
        ↓ đi qua nhiều router, có thể theo đường khác nhau, có thể tới lệch thứ tự
        ↓ ghép lại
JSON 100 KB nguyên vẹn           ← nếu dùng TCP
```

**MTU** (Maximum Transmission Unit) là kích thước packet lớn nhất mà một đường truyền chấp nhận, thường 1500 byte.

Từ chỗ này ra hai hệ quả có mặt trong rất nhiều note khác: dữ liệu **đến dần dần** (nên có `stream`), và dữ liệu **có thể mất giữa đường** (nên có TCP).

### TCP và UDP — hai lời hứa khác nhau

Cả hai đều chuyển packet giữa `IP:port` và `IP:port`. Chúng khác nhau ở **điều được đảm bảo**.

| | TCP | UDP |
|---|---|---|
| Thiết lập kết nối trước? | có (handshake) | không — gửi luôn |
| Packet mất thì sao? | tự gửi lại | mất luôn, im lặng |
| Thứ tự | đúng thứ tự đã gửi | có thể lệch |
| Trả giá | chậm hơn, có state | nhanh, không đảm bảo |
| Dùng cho | HTTP, database, SSH — **gần như mọi thứ bạn viết** | DNS query, video call, game |

**TCP** = "đảm bảo tới đủ và đúng thứ tự, hoặc báo lỗi". Đổi lại: phải bắt tay trước (thêm một vòng round-trip), và phải giữ state ở cả hai đầu.

**UDP** = "gửi và không hỏi lại". Đúng khi dữ liệu cũ vô giá trị — trong video call, gửi lại một frame 200ms trước còn tệ hơn là bỏ nó.

Mọi note trong repo này nói về HTTP, PostgreSQL, Redis, gRPC đều đang chạy trên TCP. Behavior chi tiết của handshake, `RST`, `TIME_WAIT`: [02-tcp-udp.md](./02-tcp-udp.md).

### DNS — sổ danh bạ từ tên sang IP

**DNS** (Domain Name System) dịch **tên** thành **IP**, vì con người nhớ tên còn mạng chỉ định tuyến theo số.

```text
api.shop.com  ──DNS──▶  203.0.113.10
```

Từ vựng tối thiểu:

| Từ | Nghĩa |
|---|---|
| **record** | một dòng dữ liệu DNS |
| **A** / **AAAA** | tên → IPv4 / tên → IPv6 |
| **CNAME** | tên → **tên khác** ("hỏi chỗ kia đi") |
| **MX** | máy nào nhận email cho domain này |
| **TXT** | văn bản tự do — SPF, DKIM, xác thực sở hữu domain |
| **resolver** | bên đi tra hộ bạn (thường là DNS của ISP, hoặc `8.8.8.8`) |
| **TTL** | được **cache bao lâu**, tính bằng giây |

TTL là từ quan trọng nhất trong bảng trên. Câu trả lời DNS được cache ở nhiều tầng: process của bạn, OS, resolver của ISP. Vì vậy **đổi DNS không có hiệu lực ngay** — traffic tiếp tục đi tới IP cũ cho tới khi TTL hết ở từng tầng cache. Toàn bộ hậu quả vận hành: [01-ip-port-dns.md](./01-ip-port-dns.md).

Quan trọng: DNS chỉ trả về **IP**. Nó không biết port, không biết path, không kiểm tra máy đó còn sống. Phân giải DNS thành công không nói gì về việc server có chạy hay không.

### TLS và certificate — mã hoá và danh tính

**TLS** (Transport Layer Security) làm hai việc trên một kết nối TCP đã có:

1. **Mã hoá** — người đứng giữa thấy byte, không đọc được nội dung.
2. **Xác thực server** — chứng minh bạn đang nói với `shop.com` thật, không phải kẻ giả mạo.

**HTTPS** chính là HTTP chạy bên trong một kết nối được TLS bảo vệ. Không có protocol nào tên HTTPS ở tầng riêng.

```text
TCP kết nối         ─────▶  đường ống đã mở
TLS handshake       ─────▶  thoả thuận mã hoá + kiểm tra certificate
HTTP request        ─────▶  giờ mới gửi được dữ liệu
```

**Certificate** là một file mà server xuất trình, nói: "tôi là `shop.com`, và đây là public key của tôi". Nó chỉ có giá trị nhờ chữ ký của một **CA** (Certificate Authority) mà máy bạn đã tin sẵn.

Client kiểm tra ba điều, và mỗi điều là một lỗi khác nhau:

| Kiểm tra | Hỏng thì | Lỗi thường thấy |
|---|---|---|
| CA có được tin? | self-signed, hoặc thiếu intermediate | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` |
| Tên có khớp hostname? | cert cho `shop.com`, bạn gọi `api.shop.com` | `ERR_CERT_COMMON_NAME_INVALID` |
| Còn hạn? | quên gia hạn | `CERT_HAS_EXPIRED` |

Lỗi TLS xảy ra **trước khi** HTTP request được gửi. Nghĩa là server không hề thấy request, và log của server sẽ trống. Nếu bạn không biết điều này, bạn sẽ tìm bug ở sai chỗ. Chi tiết handshake: [03-tls.md](./03-tls.md).

### Proxy, reverse proxy, load balancer

Ba từ chỉ **cùng một loại máy đứng giữa**, khác nhau ở chỗ nó đứng phía ai:

```text
Client ──▶ [proxy]         ──▶ Internet      proxy: đại diện cho CLIENT
Client ──▶ [reverse proxy] ──▶ App servers   reverse proxy: đại diện cho SERVER
Client ──▶ [load balancer] ──▶ App 1 / 2 / 3 chia tải giữa nhiều server
```

Nginx, Cloudflare, ALB đều là reverse proxy — và thường kiêm luôn load balancer, TLS termination và cache. Hệ quả: từ góc nhìn app của bạn, **IP nguồn là IP của proxy**, không phải của user. Đây là lý do rate limit hay chặn sai người nếu không cấu hình `trust proxy`. Xem [05-reverse-proxy-load-balancer.md](./05-reverse-proxy-load-balancer.md).

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| `127.0.0.1` = "máy tôi" | = "chính process/container này", không rời khỏi nó | app bind `127.0.0.1` trong container → bên ngoài không kết nối được |
| Bind `0.0.0.0` giống `127.0.0.1` | `0.0.0.0` = mọi interface; `127.0.0.1` = chỉ loopback | container không nhận traffic, mất hàng giờ debug |
| DNS phân giải được nghĩa là server sống | DNS chỉ trả IP, không kiểm tra gì | `ping` OK nhưng app vẫn `ECONNREFUSED` |
| Đổi DNS có hiệu lực ngay | bị cache theo TTL ở nhiều tầng | traffic vẫn tới IP cũ hàng giờ sau khi cutover |
| Server "hết port" khi nhiều client | mỗi kết nối là một bộ bốn khác nhau; server dùng 1 port | tăng port vô ích, không sửa đúng nguyên nhân |
| DNS record có chứa port | DNS chỉ có IP | tưởng đổi DNS là đổi được port |
| HTTPS là protocol riêng | HTTPS = HTTP trong ống TLS | không hiểu vì sao lỗi cert xảy ra khi server chưa thấy request |
| Cert hỏng thì server sẽ log lỗi | TLS chết trước HTTP; server không thấy gì | tìm bug trong log app, nơi không thể có dấu vết |
| TCP đảm bảo tin nhắn "nguyên khối" | TCP là **stream byte**, không có biên tin nhắn | tự viết protocol trên TCP mà không framing → dữ liệu dính nhau |
| UDP luôn nhanh hơn nên tốt hơn | UDP mất packet trong im lặng | mất dữ liệu không có triệu chứng |

Dòng "TCP là stream byte" đáng nhắc lại: TCP đảm bảo **thứ tự byte**, không đảm bảo rằng một lần `write()` của bạn tương ứng một lần `read()` ở phía kia. HTTP giải quyết chuyện này bằng `Content-Length`.

## Kiểm tra bản thân

1. `IP` trả lời câu hỏi gì, `port` trả lời câu hỏi gì?
2. Bind `127.0.0.1` khác bind `0.0.0.0` thế nào? Cái nào đúng trong container?
3. Bốn giá trị nào xác định duy nhất một kết nối TCP?
4. Vì sao server ở port 443 phục vụ được 10.000 client mà không hết port?
5. TCP đảm bảo gì mà UDP không? Đổi lại phải trả giá gì?
6. Bạn sửa DNS record trỏ sang IP mới. Traffic đi ngay không? Từ nào quyết định?
7. Certificate hết hạn — server có nhận được HTTP request của bạn không? Log server có gì?
8. `nslookup api.shop.com` trả về IP đúng nhưng app báo `ECONNREFUSED`. Ba lớp: DNS, TCP, app — lớp nào đã đúng, lớp nào đang sai?

Câu 8 là hình dạng của mọi buổi debug network: xác định **lớp nào đã đúng** trước khi đoán nguyên nhân.

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 01-ip-port-dns.md          ← DNS/TTL gây sự cố production thế nào
        ├──▶ 02-tcp-udp.md              ← handshake, RST, TIME_WAIT
        ├──▶ 03-tls.md                  ← handshake và failure mode của cert
        ├──▶ ../00-linux/05-ports-sockets.md  ← socket ở mức syscall, EADDRINUSE
        └──▶ 06-network-debugging.md    ← dùng dig, ss, curl, tcpdump theo thứ tự nào
```

Nếu bạn đang học Docker: đọc [05-ports-sockets.md](../00-linux/05-ports-sockets.md) ngay sau note này. Không có nó, `-p 3000:3000` và mạng container sẽ là phép thuật.

## Related

- [IP, port, DNS](./01-ip-port-dns.md) — behavior và sự cố vận hành
- [TCP & UDP](./02-tcp-udp.md) — handshake, retransmit, state
- [TLS](./03-tls.md) — handshake, cert chain, failure mode
- [NAT, firewall, routing](./04-nat-firewall-routing.md) — packet đi qua đâu
- [Reverse proxy & load balancer](./05-reverse-proxy-load-balancer.md) — máy đứng giữa
- [Network debugging](./06-network-debugging.md) — thứ tự kiểm tra
- [Ports & sockets (Linux)](../00-linux/05-ports-sockets.md) — socket là file descriptor
- [Process, file, env](../00-linux/01-process-files-env.md) — vì sao `EMFILE` là lỗi network
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — cùng đường đi, nhìn từ browser
- [Từ vựng Web](../../01-web-frontend/00-web-foundations/00-web-vocabulary.md) — tầng trên: URL, HTTP, origin
- [Glossary](../../00-roadmap/glossary.md)
