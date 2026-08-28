---
level: intermediate
area: infra
---

# Infrastructure

Nơi code của bạn **thật sự chạy**. Năm folder theo thứ tự phụ thuộc — và thứ tự đó không phải tuỳ chọn:

```text
00-linux       process, fd, signal, cgroup, quyền, socket
01-networking  DNS, TCP, TLS, NAT, firewall, proxy
02-docker      đóng gói: image, layer, namespace, volume
03-cicd        đưa artifact từ commit tới production
04-kubernetes  điều phối trên nhiều máy
```

Nguyên tắc bao trùm:

> **Mọi lỗi Kubernetes khó đều là một cơ chế Linux hoặc mạng rò rỉ qua nhiều lớp trừu tượng.**

Học từ dưới lên. Học Kubernetes trước Linux là cách nhanh nhất để thuộc YAML mà không hiểu gì.

## Bắt đầu ở đâu

| Bạn đang | Vào |
|---|---|
| Chưa rõ process, fd, signal, cgroup | [00-linux/](00-linux/README.md) |
| Debug "không kết nối được" | [01-networking/](01-networking/README.md) |
| Container hoá ứng dụng | [02-docker/](02-docker/README.md) |
| Pipeline chậm, deploy thủ công | [03-cicd/](03-cicd/README.md) |
| Compose không đủ nữa | [Vì sao cần Kubernetes](04-kubernetes/04-why-kubernetes.md) |

## Bảy con số phải đọc được

Chúng xuất hiện ở mọi tầng, và biết chúng rút ngắn phần lớn cuộc điều tra:

```text
EXIT CODE     0 sạch · 137 SIGKILL (OOM hoặc hết grace period) · 143 SIGTERM không dọn dẹp
              125 lỗi daemon · 126 không thực thi được · 127 binary không tồn tại

LOAD AVERAGE  so với số core; trên Linux tính CẢ tiến trình chờ đĩa
              → load cao + CPU thấp = nút thắt I/O

MEMORY        nhìn `available`, không nhìn `free`
              trong container: /sys/fs/cgroup/memory.max

CONNECTION    refused = gói ĐÃ tới (không ai listen)
              timeout = gói KHÔNG tới (firewall/routing)

HTTP 5xx      502 phản hồi hỏng · 503 không backend khoẻ · 504 quá chậm

REQUESTS      scheduler dùng requests, `kubectl top` cho usage — hai số khác nhau

FILE DESC     socket cũng là fd; `ulimit -n` là giới hạn MỖI process
```

## Bảng chẩn đoán liên tầng

| Triệu chứng | Tầng | Note |
|---|---|---|
| `EMFILE: too many open files` | Linux | [fd](00-linux/01-process-files-env.md) |
| Exit 137, không log | Linux/cgroup | [memory](00-linux/02-memory-cpu-limits.md) |
| Chậm bất thường, CPU trung bình thấp | cgroup | [CPU throttling](00-linux/02-memory-cpu-limits.md) |
| `EACCES` khi ghi volume | Linux/Docker | [quyền](00-linux/03-filesystem-permissions.md) |
| Container mất 30s mới tắt | Linux/Docker | [PID 1](00-linux/04-signals-lifecycle.md) |
| `connection refused` từ host | Linux/Docker | [bind interface](00-linux/05-ports-sockets.md) |
| `CLOSE_WAIT` tăng đều | Linux/app | [socket](00-linux/05-ports-sockets.md) |
| Đĩa đầy vì log | Linux/Docker | [log](00-linux/06-logs-and-services.md) |
| Load 40 mà CPU 10% | Linux | [debugging](00-linux/07-debugging-toolbox.md) |
| Đổi DNS mà 10% traffic vẫn đi cũ | Networking | [DNS TTL](01-networking/01-ip-port-dns.md) |
| Client treo 15 phút khi peer chết | Networking | [TCP timeout](01-networking/02-tcp-udp.md) |
| Browser OK, `curl` lỗi cert | Networking | [TLS chain](01-networking/03-tls.md) |
| Kết nối DB chết sau ~5 phút idle | Networking | [NAT timeout](01-networking/04-nat-firewall-routing.md) |
| 502 mỗi lần deploy | Networking/K8s | [LB + shutdown](01-networking/05-reverse-proxy-load-balancer.md) |
| `localhost` không tới container khác | Docker | [namespace](02-docker/02-container-networking.md) |
| Restart mất dữ liệu | Docker | [volume](02-docker/03-volumes-state.md) |
| Build chậm mỗi lần đổi code | Docker | [cache](02-docker/05-dockerfile-build-cache.md) |
| Secret trong image | Docker | [production image](02-docker/07-production-image.md) |
| Staging OK, production crash cùng commit | CI/CD | [build once](03-cicd/02-build-artifact-promotion.md) |
| Pipeline chậm, người ta né chạy | CI/CD | [pipeline](03-cicd/01-pipeline.md) |
| Pod Pending dù node rảnh | K8s | [scheduling](04-kubernetes/05-scheduling-resources.md) |
| Mọi pod restart khi DB chậm | K8s | [liveness](04-kubernetes/02-health-readiness-liveness.md) |
| `endpoints` rỗng | K8s | [Service](04-kubernetes/01-pod-deployment-service.md) |
| HPA làm sập database | K8s | [autoscaling](04-kubernetes/09-autoscaling.md) |
| CrashLoopBackOff, log rỗng | K8s | [debugging](04-kubernetes/10-debugging-k8s.md) |

## Quy trình debug chung

Cùng một khung cho mọi tầng:

```text
① Triệu chứng ĐO ĐƯỢC chưa?      "chậm" → chậm bao nhiêu ms, ở đâu, từ khi nào
② So với BASELINE                 không có baseline thì không có bất thường
③ Thu hẹp TẦNG                    client → mạng → LB → container → app → DB → đĩa
④ Bốn tài nguyên + hai thứ khác   CPU / memory / disk / network / lock / giới hạn cấu hình
⑤ Thu hẹp PROCESS                 pod/container/process nào
⑥ Đi sâu                          /proc, lsof, strace -c, tcpdump
⑦ Một giả thuyết, một thay đổi    đổi nhiều thứ = không biết cái nào đúng
⑧ Ghi lại                         triệu chứng, đã loại trừ gì, nguyên nhân, cách phòng
```

Bước ② và ⑦ bị bỏ nhiều nhất, và cả hai làm hỏng mọi bước còn lại.

## Mười hai quyết định định hình cả hệ thống

```text
Container
 1. CMD dạng exec — PID 1 là app, không phải sh/npm
 2. Chạy non-root với UID cố định
 3. Bind 0.0.0.0 trong container
 4. Heap limit ≈ 75% memory limit → lỗi có stack trace thay vì SIGKILL im lặng
 5. Multi-stage build; secret qua BuildKit secret mount

Mạng
 6. Timeout ở mọi lời gọi, xếp thứ tự: client > LB > app > DB
 7. keepAliveTimeout của app > idle timeout của LB
 8. TCP keepalive < NAT idle timeout

Vận hành
 9. Liveness KHÔNG chạm dependency; readiness thì có
10. Delay 3–5 giây trước khi đóng listener khi shutdown
11. Memory limit cho mọi container; requests đúng với thực tế
12. Build một lần, deploy bằng digest; mọi thay đổi tương thích ngược
```

Mười hai dòng này chặn phần lớn lớp lỗi trong bảng chẩn đoán ở trên.

## Position

```text
App → RUNTIME (process, fd, signal) → CONTAINER (namespace, cgroup)
    → MẠNG (DNS, TCP, TLS, proxy) → ORCHESTRATOR (scheduling, rollout)
      ↑ toàn bộ folder này
```

## Related

- [02-backend-api/](../02-backend-api/README.md) — ứng dụng chạy trên hạ tầng này
- [03-database/](../03-database/README.md) — tầng dữ liệu bên dưới
- [05-cross-cutting/](../05-cross-cutting/README.md) — observability, reliability, security
- [Observability](../05-cross-cutting/observability/README.md) — quan sát **trước** khi cần
- [Reliability](../05-cross-cutting/reliability/README.md) — timeout, retry, circuit breaker, degradation
- [06-system-design/](../06-system-design/README.md) — quyết định kiến trúc ở tầng trên
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi dựng và phá thử

## Version / Context

Linux với systemd và cgroup v2; Docker 24+ với BuildKit; Kubernetes 1.29+. Ví dụ CI dùng GitHub Actions, proxy dùng nginx — các công cụ khác có khái niệm tương đương. Mỗi note ghi rõ phiên bản ở phần cuối.
