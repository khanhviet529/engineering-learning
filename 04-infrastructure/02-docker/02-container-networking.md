---
level: intermediate
area: infra
prerequisites:
  - 01-image-container.md
  - ../00-linux/05-ports-sockets.md
related:
  - 04-namespaces-cgroups.md
  - 06-compose.md
  - 08-common-failures.md
---

# Container networking

> App trong container gọi `http://localhost:5432` để tới PostgreSQL — cũng đang chạy trong một container trên cùng máy. Nó nhận `ECONNREFUSED`. Cả hai container đều khoẻ, PostgreSQL đang listen, không có firewall. `localhost` là đúng — chỉ là nó trỏ tới **một nơi khác** với nơi bạn nghĩ.

## Position

```text
Host network namespace
   ├─ bridge docker0 / <compose-net>
   │     ├─ container A  (netns riêng: eth0, lo, bảng route riêng)
   │     └─ container B  (netns riêng)
   └─ eth0 của host
```

Mỗi container có **network namespace riêng**: interface riêng, bảng routing riêng, iptables riêng, và **`localhost` riêng**.

## Problem

```text
① localhost trong container ≠ localhost của host ≠ localhost của container khác
② Container gọi host thế nào?
③ Container gọi nhau thế nào?
④ Port mapping hoạt động ra sao, và vì sao đôi khi không?
```

Bốn câu hỏi, và trả lời sai câu ① là nguyên nhân của lỗi phổ biến nhất khi container hoá một ứng dụng.

## Mental Model

### `localhost` là loopback của namespace hiện tại

```text
Container A: localhost → CHÍNH container A
Container B: localhost → CHÍNH container B
Host:        localhost → CHÍNH host

⇒ A gọi localhost:5432 không bao giờ tới được B
```

Bảng ánh xạ đầy đủ:

```text
Từ đâu          Tới đâu               Dùng gì
─────────────────────────────────────────────────────────────
container A  →  container B (cùng net)   tên container / tên service
container A  →  chính nó                  localhost
container A  →  HOST                      host.docker.internal (Desktop)
                                          172.17.0.1 (gateway bridge, Linux)
                                          --network=host (Linux, mất cô lập)
host         →  container                 localhost:<port đã map>
ngoài        →  container                 <ip host>:<port đã map>
```

### Bốn chế độ mạng

```text
bridge (mặc định)  netns riêng, nối vào bridge, cần -p để lộ ra ngoài
host               DÙNG CHUNG netns của host — không cô lập mạng, không cần -p
none               không có mạng
container:<id>     DÙNG CHUNG netns với container khác  ← pattern của K8s pod
```

`container:<id>` là cơ chế đằng sau pod trong Kubernetes: mọi container trong một pod dùng chung netns, nên chúng **nói chuyện với nhau qua `localhost`** và không được trùng port.

`--network=host` chỉ hoạt động trên Linux (trên Docker Desktop nó không làm điều bạn nghĩ) và nó bỏ toàn bộ cô lập mạng — dùng khi cần hiệu năng tối đa hoặc cần thấy mạng của host, không dùng như giải pháp cho vấn đề kết nối.

### DNS nội bộ của Docker

```bash
docker network create appnet
docker run -d --name db     --network appnet postgres:16
docker run -d --name api    --network appnet myapi
# trong api:  postgres://db:5432   ← "db" phân giải được
```

Ba điều quan trọng:

```text
① Chỉ hoạt động trên network do NGƯỜI DÙNG tạo, KHÔNG trên bridge mặc định
② Tên = tên container hoặc tên service (Compose)
③ Container KHÔNG cùng network thì KHÔNG thấy nhau
```

Điểm ① hay gây bất ngờ: `docker run` không có `--network` dùng bridge mặc định, nơi DNS theo tên **không** hoạt động (chỉ có `--link` đã lỗi thời).

### Port mapping là DNAT

```bash
docker run -p 8080:3000 myapp
#             │     └─ port TRONG container
#             └─ port trên HOST
```

```text
Gói tới host:8080 → iptables DNAT → container:3000
```

Ba biến thể đáng biết:

```bash
-p 8080:3000              # lộ ra MỌI interface của host (0.0.0.0) — có thể là internet
-p 127.0.0.1:8080:3000    # CHỈ host truy cập được  ← an toàn hơn cho dịch vụ nội bộ
-p 3000                   # host port ngẫu nhiên
```

`-p 8080:3000` trên một máy có IP công khai và không có firewall = **dịch vụ mở ra internet**. Đây là cách nhiều database dev bị quét và khai thác.

Và điểm quan trọng nhất về port mapping:

```text
Port mapping KHÔNG cứu được việc app bind sai interface.
App bind 127.0.0.1:3000 trong container → DNAT chuyển gói tới container:3000
   → nhưng gói đến từ NGOÀI namespace, và app chỉ nghe loopback
   → connection refused
```

Đây là ví dụ ở đầu note ở dạng khác, và cách sửa là **luôn bind `0.0.0.0` trong container**.

### Kiểm tra bên trong container

```bash
docker exec app ss -tlnp
# LISTEN 0 511 127.0.0.1:3000   ← chỉ loopback → host không tới được
# LISTEN 0 511 0.0.0.0:3000     ← đúng
```

Đây là lệnh đầu tiên khi gặp lỗi kết nối container, và nó tốn 2 giây.

### Compose: DNS theo tên service

```yaml
services:
  api:
    build: .
    ports: ["8080:3000"]        # chỉ để truy cập TỪ HOST
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/app   # tên SERVICE, port TRONG container
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 5s
      retries: 10
```

Ba điểm hay sai:

```text
① Dùng port đã MAP (8080) để container gọi nhau
   → sai; giữa container dùng port TRONG container (3000, 5432)
② Không cần `ports:` để container gọi nhau
   → `ports:` chỉ để truy cập từ HOST
③ depends_on không có condition chỉ đợi container KHỞI ĐỘNG, không đợi SẴN SÀNG
   → app khởi động trước khi Postgres nhận kết nối → crash
```

Xem [Compose](06-compose.md).

### Gọi host từ container

```text
Docker Desktop (macOS/Windows):  host.docker.internal
Linux:
   · --add-host=host.docker.internal:host-gateway   (Docker 20.10+)
   · IP gateway của bridge (thường 172.17.0.1)
   · --network=host  (mất cô lập)
```

Trên Linux, `host.docker.internal` **không tồn tại mặc định** — đây là khác biệt hay gây "chạy máy tôi thì được".

### Hairpin NAT

```text
Container gọi IP CÔNG KHAI của chính host mình
   → gói phải ra rồi quay lại
   → nhiều cấu hình KHÔNG hỗ trợ → timeout
```

Triệu chứng: "gọi được từ ngoài, không gọi được từ trong". Cách sửa: dùng địa chỉ nội bộ (tên container/service) thay vì đi vòng qua IP công khai.

### Kubernetes: mô hình khác

```text
POD              mọi container trong pod DÙNG CHUNG netns
                 → nói chuyện qua localhost
                 → KHÔNG được trùng port
POD IP           mỗi pod một IP; pod nói chuyện trực tiếp KHÔNG qua NAT
SERVICE          IP ảo ổn định + DNS + load balancing
                 <svc>.<ns>.svc.cluster.local
```

Khác biệt lớn nhất so với Docker: **không có port mapping** trong K8s theo nghĩa của Docker. `containerPort` chỉ là tài liệu; Service và Ingress lo việc lộ ra ngoài.

Và mô hình pod chính là `--network=container:<id>` — cùng cơ chế, tên khác. Xem [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md).

## Example

Chẩn đoán "api không gọi được db":

```bash
# 1. Cùng network không?
docker inspect api --format '{{json .NetworkSettings.Networks}}' | jq keys
docker inspect db  --format '{{json .NetworkSettings.Networks}}' | jq keys
# ["appnet"] và ["bridge"]   ← KHÁC NHAU → không thấy nhau

# 2. DNS trong container api
docker exec api getent hosts db
# (rỗng) → không phân giải được

# 3. Sửa: cùng network
docker network connect appnet db

# 4. Xác minh
docker exec api getent hosts db
# 172.20.0.3  db
docker exec api nc -zv db 5432
# succeeded

# 5. Nếu vẫn refused: kiểm tra db bind interface nào
docker exec db ss -tlnp
# LISTEN 0 244 0.0.0.0:5432   ✓
# LISTEN 0 244 127.0.0.1:5432 ✗  → chỉ loopback của chính container db
```

Bước 1 và 5 là hai bước giải quyết phần lớn trường hợp, và cả hai đều tốn vài giây.

## Prediction

1. Container A gọi `localhost:5432` tới PostgreSQL ở container B — kết quả?
2. Hai container trên bridge **mặc định**, A gọi `http://b:3000` — phân giải được không?
3. Cùng tình huống trên network do người dùng tạo — phân giải được không?
4. App bind `127.0.0.1:3000` trong container, `-p 8080:3000`, `curl localhost:8080` từ host — kết quả?
5. App bind `0.0.0.0:3000`, cùng mapping — kết quả?
6. Compose: api gọi `postgres://db:8080/app` khi `ports: ["8080:5432"]` — đúng không?
7. Không có `ports:` trong Compose, api gọi `db:5432` — được không?
8. `depends_on: [db]` không có condition, Postgres mất 8 giây khởi động — api thế nào?
9. `-p 8080:3000` trên VPS có IP công khai, không firewall — ai truy cập được?
10. Container gọi IP công khai của chính host — kết quả thường là gì?
11. Trên Linux, container gọi `host.docker.internal` mà không có `--add-host` — kết quả?
12. Hai container trong cùng một pod K8s, cả hai bind port 8080 — kết quả?
13. `--network=host` trên Linux, app bind `0.0.0.0:3000` — cần `-p` không?

<details>
<summary>Đáp án</summary>

1. **ECONNREFUSED** — `localhost` của A là chính A, không phải B.
2. **Không** — DNS theo tên chỉ hoạt động trên network do người dùng tạo.
3. **Được.**
4. **Refused** — DNAT chuyển gói tới container:3000, nhưng app chỉ nghe loopback của namespace đó.
5. **200** — app nhận được gói từ ngoài namespace.
6. **Sai** — giữa container dùng port **trong** container: `postgres://db:5432/app`.
7. **Được** — `ports:` chỉ để truy cập từ host.
8. api khởi động ngay khi container db **bắt đầu**, trước khi Postgres nhận kết nối → **crash** hoặc lỗi kết nối.
9. **Bất kỳ ai trên internet** — cổng mở ra mọi interface.
10. **Timeout** (hairpin NAT thường không hỗ trợ).
11. Không phân giải được — `host.docker.internal` không có sẵn trên Linux.
12. Container thứ hai **không bind được** — cùng netns, port đã bị chiếm.
13. **Không** — với `--network=host`, container dùng chung netns của host; port đã ở trên host.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gọi `localhost` giữa hai container | Refused |
| Dùng tên container trên bridge mặc định | Không phân giải được |
| Tạo network riêng, lặp lại | Hoạt động |
| App bind `127.0.0.1` với `-p`, curl từ host | Refused |
| `docker exec app ss -tlnp` | Thấy `127.0.0.1:3000` |
| Đổi sang `0.0.0.0`, lặp lại | Hoạt động |
| Compose dùng port đã map để container gọi nhau | Refused |
| Bỏ `ports:` nhưng giữ gọi giữa container | Vẫn hoạt động |
| `depends_on` không có condition với DB chậm khởi động | App crash lúc start |
| Thêm `condition: service_healthy` | Ổn |
| `-p 8080:3000` trên máy có IP công khai, quét từ ngoài | Port mở |
| Đổi sang `-p 127.0.0.1:8080:3000`, quét lại | Đóng |
| Container gọi IP công khai của host | Timeout |
| Hai container cùng pod K8s cùng port | Container thứ hai fail |

## What Usually Goes Wrong

- **`localhost` giữa các container** → refused. Lỗi phổ biến nhất khi container hoá.
- **App bind `127.0.0.1` trong container** → port mapping không cứu được.
- **Dùng bridge mặc định rồi mong DNS theo tên hoạt động** → không phân giải được.
- **Dùng port đã map để container gọi nhau** → refused.
- **`depends_on` không có condition** → app khởi động trước dependency sẵn sàng.
- **`-p 8080:3000` trên máy công khai** → dịch vụ lộ ra internet.
- **`host.docker.internal` trên Linux** → không tồn tại mặc định.
- **Hairpin NAT** → "gọi được từ ngoài, không từ trong".
- **Trùng port trong cùng pod K8s** → container không start được.
- **`--network=host` như giải pháp cho lỗi kết nối** → mất cô lập, và thường không sửa nguyên nhân.
- **Không kiểm tra `ss -tlnp` trong container** → debug bằng đoán.
- **Quên rằng CNI có thể có MTU nhỏ hơn** → payload lớn treo trong K8s. Xem [TCP & UDP](../01-networking/02-tcp-udp.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `localhost` giống nhau ở mọi nơi | Nó là loopback của **namespace hiện tại** |
| Port mapping làm app truy cập được | App vẫn phải bind đúng interface |
| DNS theo tên container luôn hoạt động | Chỉ trên network do người dùng tạo |
| Cần `ports:` để container gọi nhau | Không — `ports:` chỉ cho host |
| `depends_on` đợi service sẵn sàng | Chỉ đợi container khởi động, trừ khi có `condition` |
| `-p 8080:3000` chỉ mở cho host | Nó mở cho **mọi** interface |
| `host.docker.internal` có ở mọi nền tảng | Không có sẵn trên Linux |
| `--network=host` giống nhau ở mọi OS | Trên Docker Desktop nó không như trên Linux |
| K8s có port mapping như Docker | `containerPort` chỉ là tài liệu |
| Container trong cùng pod cô lập mạng với nhau | Chúng dùng chung netns |

## Debugging

Thứ tự cố định:

1. **App bind interface nào?** `docker exec <c> ss -tlnp` — bước đầu tiên, luôn luôn.
2. **Cùng network không?** `docker inspect <c> --format '{{json .NetworkSettings.Networks}}'`.
3. **DNS phân giải được không?** `docker exec <c> getent hosts <name>`.
4. **Port tới được không?** `docker exec <c> nc -zv <name> <port>` — `refused` vs `timeout`.
5. **Port mapping đúng không?** `docker port <c>`.
6. **Từ host:** `curl -v localhost:<hostport>`.
7. **Không có công cụ trong image?** `docker run --rm -it --net=container:<id> nicolaka/netshoot`.
8. **Trong K8s:** `kubectl exec` để test, `kubectl get endpoints <svc>` để xem Service có pod nào không.

Bước 8 đáng nhớ: `endpoints` rỗng nghĩa là Service không khớp pod nào (sai selector) hoặc pod không ready — hai nguyên nhân rất khác nhau với cùng triệu chứng.

## Production Considerations

- **Luôn bind `0.0.0.0` trong container**, và ghi rõ trong code.
- **`-p 127.0.0.1:...`** cho mọi dịch vụ chỉ cần truy cập từ host (database dev, admin UI, metrics).
- **Network riêng cho mỗi nhóm service** — nó vừa cho DNS theo tên vừa cô lập.
- **Không dùng `--network=host`** trừ khi có lý do cụ thể; nó bỏ cô lập mạng.
- **Health check thật** thay vì `depends_on` đơn thuần, và app phải retry kết nối khi khởi động — dependency có thể restart bất cứ lúc nào.
- **Trong K8s, dùng tên Service**, không dùng IP pod (pod IP thay đổi mỗi lần restart).
- **NetworkPolicy để cô lập** — mặc định mọi pod nói chuyện được với mọi pod. Xem [NAT, firewall & routing](../01-networking/04-nat-firewall-routing.md).
- **Kiểm tra MTU của CNI** khi dựng cluster mới — overlay network thường có MTU nhỏ hơn 1500, và không khớp gây treo im lặng với payload lớn.
- **Đừng hardcode IP container** — chúng thay đổi mỗi lần tạo lại.
- **Ghi lại sơ đồ mạng** của môi trường dev (network nào, service nào, port nào) — nó tiết kiệm thời gian cho mọi người mới.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| bridge (mặc định) | cô lập, port mapping rõ ràng | thêm một lớp NAT |
| `--network=host` | không NAT, hiệu năng tối đa | không cô lập; xung đột port; chỉ Linux |
| Network riêng | DNS theo tên, cô lập nhóm | phải quản lý network |
| Bridge mặc định | không cấu hình gì | không có DNS theo tên |
| `-p 0.0.0.0:...` | truy cập từ mọi nơi | lộ ra mạng |
| `-p 127.0.0.1:...` | an toàn | chỉ host dùng được |
| Nhiều container một pod (K8s) | localhost, chia sẻ volume dễ | không trùng port; scale cùng nhau |
| Container riêng | scale độc lập | cần Service để gọi nhau |
| Overlay network | nhiều node nói chuyện được | MTU nhỏ hơn, thêm encapsulation |

## Explain Without Notes

1. Vì sao `localhost` giữa hai container không hoạt động?
2. Vẽ bảng "từ đâu tới đâu dùng gì" cho container, host, và bên ngoài.
3. Port mapping làm gì, và vì sao nó không cứu được app bind `127.0.0.1`?
4. DNS theo tên container hoạt động khi nào và không hoạt động khi nào?
5. Giữa hai container, dùng port đã map hay port trong container?
6. `depends_on` đảm bảo điều gì và không đảm bảo điều gì?
7. Pod trong Kubernetes tương ứng với chế độ mạng nào của Docker?
8. Hai lệnh đầu tiên khi container không gọi được nhau?

## Related

- [Image & container](01-image-container.md) — container là process
- [Namespaces & cgroups](04-namespaces-cgroups.md) — network namespace
- [Compose](06-compose.md) — DNS theo tên service, healthcheck
- [Common failures](08-common-failures.md) — `localhost` là lỗi số một
- [Ports & sockets](../00-linux/05-ports-sockets.md) — bind interface, `refused` vs `timeout`
- [IP, port & DNS](../01-networking/01-ip-port-dns.md) — DNS nói chung
- [NAT, firewall & routing](../01-networking/04-nat-firewall-routing.md) — DNAT, hairpin
- [Ingress & service discovery](../04-kubernetes/workloads-networking/02-ingress-service-discovery.md) — mô hình mạng K8s
- [Network debugging](../01-networking/06-network-debugging.md) — quy trình đầy đủ

## Version / Context

Docker 24+. `host.docker.internal` có sẵn trên Docker Desktop; trên Linux cần `--add-host=host.docker.internal:host-gateway` (Docker 20.10+). Kubernetes yêu cầu mô hình mạng phẳng: mọi pod gọi được mọi pod không qua NAT; CNI hiện thực điều đó theo nhiều cách khác nhau.
