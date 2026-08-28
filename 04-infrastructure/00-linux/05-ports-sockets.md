---
level: foundation
area: infra
prerequisites:
  - 01-process-files-env.md
related:
  - ../01-networking/01-ip-port-dns.md
  - ../02-docker/02-container-networking.md
  - 07-debugging-toolbox.md
---

# Ports & sockets

> Ứng dụng chạy hoàn hảo trong container: `curl localhost:3000` từ bên trong trả về `200`. Từ host, `curl localhost:3000` trả về `connection refused`. Port mapping đúng, không có firewall, không có lỗi trong log. Nguyên nhân là một chuỗi bốn ký tự trong lời gọi `listen()`: `127.0.0.1`.

## Position

```text
Process ──▶ socket(fd) ──▶ bind(IP:port) ──▶ listen() ──▶ accept()
                                 ↑
              chọn IP nào ở đây quyết định AI kết nối được
```

## Problem

Ba lỗi kết nối chiếm gần hết thời gian debug mạng, và chúng nói ba điều khác nhau:

```text
ECONNREFUSED   có ai đó trả lời và TỪ CHỐI — không có process nào listen ở đó
ETIMEDOUT      KHÔNG có ai trả lời — gói tin bị firewall nuốt, hoặc sai IP
EADDRINUSE     port đã bị process khác chiếm
```

Phân biệt được ba cái này là bước đầu tiên và rẻ nhất của mọi cuộc debug mạng:

```text
ECONNREFUSED → đúng máy, sai port, hoặc app chưa chạy, hoặc bind sai interface
ETIMEDOUT    → firewall, sai IP, hoặc routing sai
```

## Mental Model

### Socket được định danh bằng bốn thứ

```text
(protocol, local IP, local port, remote IP, remote port)

Listening socket:  (TCP, 0.0.0.0, 3000, *, *)
Connection:        (TCP, 10.0.1.5, 3000, 10.0.2.9, 54321)
```

Từ đó ra một điều thường bị hiểu nhầm: **một server có thể có hàng nghìn kết nối trên "cùng một port"** — vì mỗi kết nối là một bộ bốn khác nhau (khác remote port). Port 3000 không phải một tài nguyên bị "dùng hết" bởi một kết nối.

Giới hạn thật là số **file descriptor**, không phải số port. Xem [Process, file & env](01-process-files-env.md).

### `bind()`: chọn interface là chọn ai kết nối được

```text
127.0.0.1  chỉ loopback → CHỈ process trên CÙNG máy/namespace mạng
0.0.0.0    mọi interface IPv4 → bất kỳ ai tới được máy
10.0.1.5   chỉ interface đó
::         mọi interface IPv6 (thường kèm IPv4 nếu dual-stack)
```

```ts
app.listen(3000, '127.0.0.1');   // ❌ trong container: chỉ chính container đó truy cập được
app.listen(3000, '0.0.0.0');     // ✅ host và container khác truy cập được
app.listen(3000);                // tuỳ framework/runtime — GHI RÕ để chắc chắn
```

Đây là nguyên nhân của ví dụ mở đầu, và nó là lỗi phổ biến nhất khi container hoá một ứng dụng:

```text
Trên máy dev:  127.0.0.1 = máy của bạn = hoạt động
Trong container: 127.0.0.1 = CHÍNH container đó
                 host là một namespace mạng KHÁC → không tới được
```

Ngược lại, ở môi trường không container, bind `127.0.0.1` là một biện pháp bảo mật tốt cho dịch vụ nội bộ (database, admin panel): nó khiến dịch vụ **không thể** truy cập từ mạng, bất kể firewall.

### Port đặc quyền

```text
0–1023     cần root (hoặc capability CAP_NET_BIND_SERVICE)
1024–49151 đăng ký, dùng tự do
49152+     ephemeral — hệ điều hành cấp cho kết nối RA
```

Đừng chạy app dưới root chỉ để bind port 80. Ba cách tốt hơn:

```text
① Bind 8080, để reverse proxy/LB nhận 80/443     ← mặc định đúng
② setcap 'cap_net_bind_service=+ep' /usr/bin/node
③ K8s: containerPort 8080, Service port 80
```

### `EADDRINUSE`: bốn nguyên nhân

```text
① Process khác đang listen  → ss -tlnp | grep :3000
② Process cũ chưa chết      → nodemon/dev server còn sót
③ TIME_WAIT với bind cụ thể → cần SO_REUSEADDR (hầu hết runtime bật sẵn)
④ Hai instance cùng cấu hình → cùng port
```

Tìm thủ phạm:

```bash
ss -tlnp | grep :3000                 # Linux hiện đại
lsof -i :3000                         # macOS và Linux
fuser -k 3000/tcp                     # giết process đang giữ port
```

### Trạng thái TCP đáng biết

```text
LISTEN       đang chờ kết nối
ESTABLISHED  đang hoạt động
TIME_WAIT    bên ĐÓNG TRƯỚC giữ ~60s để nuốt gói tin lạc
CLOSE_WAIT   bên kia đã đóng, PHÍA TA CHƯA gọi close()  ← BUG Ở ỨNG DỤNG
SYN_SENT     đang chờ phản hồi bắt tay
```

Hai trạng thái nói lên vấn đề:

```text
Nhiều TIME_WAIT    bình thường với client tạo nhiều kết nối ngắn.
                   Cách sửa đúng: dùng keep-alive / connection pool,
                   KHÔNG phải chỉnh sysctl.

Nhiều CLOSE_WAIT   LUÔN LUÔN là bug: code không gọi close() sau khi
                   peer đóng. Nó cũng là rò rỉ fd.
```

```bash
ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn
```

Nếu `CLOSE_WAIT` tăng đều theo thời gian, bạn đã tìm ra một rò rỉ fd — và nguyên nhân nằm trong code, không nằm ở cấu hình.

### Backlog: hàng đợi kết nối chưa được `accept()`

```text
listen(fd, backlog)
   → kernel giữ hàng đợi kết nối đã bắt tay xong, chờ app gọi accept()
   → hàng đợi đầy → kết nối mới bị DROP hoặc RST

Node mặc định backlog = 511
Kernel: net.core.somaxconn (mặc định 4096 trên nhân mới; 128 trên nhân cũ)
   → backlog thực = min(backlog của app, somaxconn)
```

Triệu chứng backlog đầy: **kết nối bị từ chối hoặc treo dưới tải đột biến, trong khi app trông rảnh.** Nguyên nhân gốc thường là event loop bị chặn — app không gọi `accept()` kịp.

```bash
ss -tlni | grep -A1 :3000     # xem Send-Q (backlog hiện tại) và giới hạn
netstat -s | grep -i listen   # đếm số lần overflow
```

### Ephemeral port: giới hạn của phía CLIENT

```bash
cat /proc/sys/net/ipv4/ip_local_port_range     # 32768 60999 → ~28k port
```

Với kết nối **ra** tới cùng một `(IP đích, port đích)`, số kết nối đồng thời tối đa bị giới hạn bởi số ephemeral port. Cộng thêm `TIME_WAIT` giữ port ~60 giây, một client tạo nhiều kết nối ngắn có thể cạn port:

```text
Triệu chứng: EADDRNOTAVAIL hoặc "cannot assign requested address" ở phía CLIENT
```

Cách sửa đúng: **keep-alive và connection pool** — tái sử dụng kết nối thay vì tạo mới. Chỉnh `ip_local_port_range` hay `tcp_tw_reuse` là biện pháp giảm nhẹ, không phải giải pháp.

### Unix domain socket

```ts
app.listen('/tmp/app.sock');
```

```text
+ nhanh hơn TCP loopback (bỏ qua toàn bộ stack mạng)
+ quyền bằng FILE PERMISSION — không ai ngoài host chạm được
+ không tốn port
- chỉ dùng được trên CÙNG máy/namespace
```

Dùng cho: app ↔ nginx trên cùng máy, PostgreSQL local, `docker.sock`.

Và một cảnh báo bảo mật: mount `/var/run/docker.sock` vào container **tương đương cho container đó quyền root trên host** — nó có thể tạo container mới với `--privileged`.

### `localhost` trong container

```text
Container A: app listen 0.0.0.0:3000
Container B: fetch('http://localhost:3000')  → ECONNREFUSED
```

Mỗi container có **network namespace riêng**, nên `localhost` của B là chính B, không phải A.

```text
Docker Compose:  http://api:3000            (tên service = DNS)
Kubernetes:      http://api.default.svc:3000 (tên Service)
Từ container tới HOST: host.docker.internal (Docker Desktop),
                       hoặc IP của gateway bridge (Linux)
```

Chi tiết: [Container networking](../02-docker/02-container-networking.md).

## Example

Chẩn đoán `connection refused` theo thứ tự, từ trong ra ngoài:

```bash
# 1. Có process nào listen không, VÀ trên interface nào?
docker exec app ss -tlnp
# LISTEN 0 511 127.0.0.1:3000    ← ĐÂY: chỉ loopback

# 2. Từ bên trong container — hoạt động
docker exec app curl -sS -o /dev/null -w '%{http_code}' localhost:3000    # 200

# 3. Từ host — thất bại
curl -v localhost:8080          # connection refused

# 4. Port mapping có đúng không
docker port app                 # 3000/tcp -> 0.0.0.0:8080   ← mapping đúng

# ⇒ Kết luận: app bind 127.0.0.1, nên không nhận được gói từ ngoài namespace.
```

Sửa:

```ts
app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
```

```bash
docker exec app ss -tlnp
# LISTEN 0 511 0.0.0.0:3000     ✓
curl localhost:8080             # 200
```

Bước 1 là bước quyết định và tốn 2 giây. Rất nhiều cuộc debug bỏ qua nó và đi thẳng vào kiểm tra firewall.

## Prediction

1. App bind `127.0.0.1:3000` trong container, port mapping `-p 8080:3000`, `curl localhost:8080` từ host — kết quả?
2. Cùng app bind `0.0.0.0:3000` — kết quả?
3. `curl` một port không có ai listen, trên cùng máy — lỗi gì?
4. `curl` một IP bị firewall chặn (DROP) — lỗi gì? Mất bao lâu?
5. Hai process cùng bind `0.0.0.0:3000` — process thứ hai nhận gì?
6. App chạy non-root cố bind port 80 — kết quả?
7. `ss -tan` cho thấy 3.000 `CLOSE_WAIT` tăng đều — nguyên nhân? Chỉnh sysctl có sửa được không?
8. 20.000 `TIME_WAIT` ở phía client tạo nhiều kết nối ngắn — bình thường hay bug? Cách sửa đúng?
9. Client tạo 40.000 kết nối tới cùng một `IP:port` — chuyện gì xảy ra? Lỗi gì?
10. Event loop bị chặn 5 giây, 1.000 kết nối tới trong lúc đó, backlog 511 — bao nhiêu bị drop?
11. Container B gọi `http://localhost:3000` tới app ở container A — kết quả? Vì sao?
12. Unix socket `/tmp/app.sock` mode 666 — ai kết nối được?
13. `-p 127.0.0.1:8080:3000` thay vì `-p 8080:3000` — khác gì về bảo mật?

<details>
<summary>Đáp án</summary>

1. **Connection refused** — app chỉ nghe loopback của namespace container; gói từ host không tới được.
2. **200** — bind mọi interface.
3. **ECONNREFUSED** ngay lập tức — kernel gửi RST vì không có socket nào listen.
4. **ETIMEDOUT** — không có phản hồi nào; mất vài chục giây (tuỳ timeout của client).
5. **EADDRINUSE** — trừ khi cả hai dùng `SO_REUSEPORT` (một tính năng khác, cho phép load balancing giữa nhiều process).
6. **EACCES** — port < 1024 cần root hoặc `CAP_NET_BIND_SERVICE`.
7. **Bug ở ứng dụng**: không gọi `close()` sau khi peer đóng. Đây cũng là rò rỉ fd. Sysctl **không** sửa được.
8. **Bình thường** với client tạo nhiều kết nối ngắn. Cách sửa đúng là **keep-alive / connection pool**, không phải chỉnh `tcp_tw_reuse`.
9. Cạn ephemeral port (~28k khả dụng, và `TIME_WAIT` giữ chúng) → **EADDRNOTAVAIL** ở phía client.
10. Khoảng **489** kết nối bị drop hoặc treo (1.000 − 511). App trông "rảnh" vì nó đang bận chặn.
11. **ECONNREFUSED** — `localhost` của B là chính B. Phải dùng tên service.
12. Bất kỳ process nào trên cùng máy/namespace có quyền đọc-ghi file đó. Với socket nhạy cảm, dùng `660` + group.
13. `-p 8080:3000` mở port ra **mọi interface của host** (có thể là internet nếu host có IP công khai). `-p 127.0.0.1:8080:3000` chỉ mở cho chính host.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bind `127.0.0.1` trong container, curl từ host | Refused |
| `ss -tlnp` trong container | Thấy `127.0.0.1:3000` |
| Đổi sang `0.0.0.0`, lặp lại | Hoạt động |
| Chạy hai instance cùng port | `EADDRINUSE` |
| `fuser -k 3000/tcp` rồi chạy lại | Được |
| Non-root bind port 80 | `EACCES` |
| `setcap cap_net_bind_service`, lặp lại | Được |
| Viết client không gọi `close()`, chạy 1.000 request, `ss -tan` | `CLOSE_WAIT` tăng |
| Tạo 50.000 kết nối ngắn tới một đích | Cạn ephemeral port |
| Bật keep-alive, lặp lại | Không cạn |
| Chặn event loop 5s rồi bắn 1.000 kết nối | Kết nối bị drop |
| `sysctl net.core.somaxconn=16` rồi bắn tải | Overflow sớm hơn nhiều |
| Từ container B gọi `localhost` tới container A | Refused |
| Dùng tên service | Hoạt động |
| `-p 8080:3000` trên máy có IP công khai, quét từ ngoài | Port mở ra internet |

## What Usually Goes Wrong

- **Bind `127.0.0.1` trong container** → không truy cập được từ ngoài. Lỗi phổ biến nhất khi container hoá.
- **Không phân biệt `ECONNREFUSED` và `ETIMEDOUT`** → debug sai hướng (kiểm tra firewall khi vấn đề là app chưa chạy).
- **Chạy root để bind port 80** → mất một lớp phòng thủ không cần thiết.
- **`CLOSE_WAIT` tích luỹ** → rò rỉ fd, cuối cùng `EMFILE`.
- **Chỉnh sysctl để "sửa" `TIME_WAIT`** → che triệu chứng; vấn đề là không dùng keep-alive.
- **Cạn ephemeral port** ở client không dùng connection pool.
- **Backlog nhỏ + event loop bị chặn** → kết nối bị drop dưới đỉnh tải.
- **`localhost` giữa các container** → refused.
- **`-p 8080:3000` trên host có IP công khai** → mở dịch vụ ra internet ngoài ý muốn.
- **Mount `/var/run/docker.sock`** → tương đương cho root trên host.
- **Unix socket mode 666** → mọi process trên máy kết nối được.
- **Không ghi rõ interface trong `listen()`** → hành vi khác nhau giữa framework và phiên bản.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Một port chỉ phục vụ một kết nối | Socket định danh bằng bộ bốn; hàng nghìn kết nối chung một port |
| `localhost` giống nhau ở mọi nơi | Nó là loopback của **namespace hiện tại** |
| `ECONNREFUSED` và `ETIMEDOUT` như nhau | Một cái có phản hồi, một cái không — hai hướng debug khác nhau |
| `TIME_WAIT` nhiều là bug | Bình thường; `CLOSE_WAIT` mới là bug |
| Chỉnh `tcp_tw_reuse` sửa được vấn đề kết nối | Nó che triệu chứng; keep-alive mới là giải pháp |
| Bind `0.0.0.0` luôn đúng | Trong container thì đúng; trên host thì có thể là rủi ro |
| Port là tài nguyên hết được ở phía server | Giới hạn là **fd**; ephemeral port là giới hạn phía **client** |
| Backlog không quan trọng | Nó quyết định hành vi dưới đỉnh tải |
| Port mapping đúng là đủ | App vẫn phải bind đúng interface |
| Unix socket kém an toàn hơn TCP | Nó an toàn hơn — dùng file permission, không lộ ra mạng |

## Debugging

Thứ tự cố định:

1. **Có ai listen không, và ở interface nào?**
   ```bash
   ss -tlnp | grep :3000        # trong CÙNG namespace với app
   ```
   Đây là bước quyết định, tốn 2 giây, và hay bị bỏ qua nhất.
2. **Từ bên trong ra:** `curl localhost:3000` **trong container**. Thất bại = vấn đề ở app.
3. **Từ ngoài vào:** `curl <host>:<port>`. Refused = không có ai listen ở đó (sai interface/port mapping). Timeout = firewall/routing.
4. **Port mapping:** `docker port <c>`, hoặc `kubectl get svc`.
5. **Đếm trạng thái TCP:** `ss -tan | awk '{print $1}' | sort | uniq -c | sort -rn`.
6. **`CLOSE_WAIT` cao** → tìm chỗ không `close()` trong code.
7. **Số fd:** `ls /proc/<pid>/fd | wc -l` so với `ulimit -n`.
8. **Backlog overflow:** `netstat -s | grep -i 'listen queue'`.

Xem thêm [Network debugging](../01-networking/06-network-debugging.md).

## Production Considerations

- **Luôn bind `0.0.0.0` trong container**, và ghi rõ trong code — đừng dựa vào mặc định.
- **Trên host, bind `127.0.0.1` cho dịch vụ nội bộ** (database, admin, metrics) — đó là biện pháp bảo mật mạnh hơn firewall vì nó không phụ thuộc cấu hình.
- **`-p 127.0.0.1:8080:3000`** khi chỉ cần truy cập từ host.
- **Không chạy root để bind port thấp** — dùng 8080 + proxy, hoặc `CAP_NET_BIND_SERVICE`.
- **Keep-alive và connection pool** cho mọi client HTTP và database — nó giải quyết cả `TIME_WAIT` lẫn cạn ephemeral port.
- **`ulimit -n` đủ lớn** cho số kết nối dự kiến. Xem [Process, file & env](01-process-files-env.md).
- **Theo dõi số fd và số kết nối theo trạng thái** như metric — `CLOSE_WAIT` tăng đều là tín hiệu sớm của rò rỉ.
- **`net.core.somaxconn` đủ lớn** cho service nhận đỉnh tải đột biến, và giữ event loop không bị chặn.
- **Không mount `docker.sock`** vào container trừ khi bạn hiểu rõ nó tương đương cấp root trên host.
- **Health check phải dùng cùng interface và port với traffic thật** — nếu không, nó có thể xanh trong khi người dùng không kết nối được.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Bind `0.0.0.0` | truy cập từ mọi nơi | lộ ra mạng nếu không có firewall |
| Bind `127.0.0.1` | an toàn theo thiết kế | không dùng được trong container |
| Bind `-p 127.0.0.1:...` | chỉ host truy cập | không dùng được từ máy khác |
| Port thấp (80/443) | quen thuộc với người dùng | cần root hoặc capability |
| Port cao + proxy | không cần đặc quyền | thêm một thành phần |
| TCP loopback | linh hoạt, dùng được qua mạng | chậm hơn Unix socket một chút |
| Unix socket | nhanh, kín, dùng file permission | chỉ cùng máy |
| Backlog lớn | chịu đỉnh tải tốt | che vấn đề app chậm `accept()` |
| Keep-alive | tránh cạn port, giảm latency | giữ fd lâu hơn |
| Kết nối ngắn | đơn giản | `TIME_WAIT`, cạn ephemeral port |

## Explain Without Notes

1. Socket được định danh bằng gì? Vì sao hàng nghìn kết nối chung một port là bình thường?
2. `ECONNREFUSED` và `ETIMEDOUT` khác nhau thế nào? Mỗi cái dẫn bạn đi hướng nào?
3. Vì sao bind `127.0.0.1` trong container làm host không truy cập được?
4. `TIME_WAIT` và `CLOSE_WAIT` — cái nào là bug, và bug ở đâu?
5. Cạn ephemeral port xảy ra ở phía nào, và cách sửa đúng?
6. Backlog là gì, và triệu chứng khi nó đầy?
7. Vì sao `localhost` giữa hai container không hoạt động?
8. Ba lệnh đầu tiên khi gặp `connection refused`?

## Related

- [Process, file & env](01-process-files-env.md) — socket là fd, `ulimit -n`
- [Debugging toolbox](07-debugging-toolbox.md) — `ss`, `lsof`, `tcpdump`
- [IP, port, DNS](../01-networking/01-ip-port-dns.md) — tầng mạng
- [TCP & UDP](../01-networking/02-tcp-udp.md) — bắt tay, trạng thái, timeout
- [Network debugging](../01-networking/06-network-debugging.md) — quy trình đầy đủ
- [Container networking](../02-docker/02-container-networking.md) — namespace mạng, `localhost`
- [Docker common failures](../02-docker/08-common-failures.md) — `connection refused` kinh điển
- [Node runtime & concurrency](../../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) — event loop và `accept()`

## Version / Context

Linux. `ss` thay thế `netstat` trên hệ thống hiện đại. `net.core.somaxconn` mặc định 4096 từ Linux 5.4 (trước đó là 128). macOS dùng `lsof -i` và `netstat` với cú pháp khác.
