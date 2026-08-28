---
level: intermediate
area: infra
prerequisites:
  - ../../02-docker/06-compose.md
related:
  - ../workloads-networking/01-pod-deployment-service.md
  - ../workloads-networking/03-rollout-rollback.md
---

# Vì sao cần Kubernetes

> Bạn có ba VPS chạy Docker Compose. Đêm thứ Bảy, VPS số 2 chết. Không ai biết cho tới sáng thứ Hai vì monitoring cũng chạy trên đó. Traffic vẫn đi tới nó qua round-robin DNS, và 33% người dùng nhận lỗi trong 36 tiếng. Không có gì cấu hình sai. Compose chỉ đơn giản **không có khái niệm "node chết"** — nó không được thiết kế để biết điều đó.

## Position

```text
Một máy, thủ công     → docker run
Một máy, có tổ chức   → docker compose
NHIỀU MÁY, tự phục hồi → Kubernetes    ← note này: khi nào vượt ranh giới đó
```

Đây là note nên đọc **trước** mọi note Kubernetes khác — vì học K8s trước khi gặp vấn đề mà nó giải quyết là cách nhanh nhất để thuộc YAML mà không hiểu gì.

## Problem

Compose làm tốt việc của nó: mô tả nhiều container trên **một máy**. Nó không làm được năm việc, và mỗi việc là một sự cố có thật:

```text
① NODE CHẾT
   Compose không biết node khác tồn tại. Container không được tạo lại ở đâu cả.

② DEPLOY KHÔNG DOWNTIME
   `docker compose up` dừng container cũ rồi tạo mới → gián đoạn.

③ TRAFFIC VÀO CONTAINER CHƯA SẴN SÀNG
   Không có health-based routing. Container vừa start đã nhận request.

④ SCALE THEO TẢI
   `deploy.replicas` chỉ có tác dụng với Swarm. Không có autoscale.

⑤ NHIỀU MÁY
   Không có scheduler, không có mạng xuyên node, không có service discovery.
```

Và một vấn đề thứ sáu, xuất hiện muộn hơn: **không ai biết trạng thái mong muốn là gì.** Sau sáu tháng vá thủ công, cấu hình thật trên máy khác với file Compose trong git.

## Mental Model

### Kubernetes là một vòng lặp điều hoà

```text
Bạn khai báo TRẠNG THÁI MONG MUỐN:  "3 replica của image X, ready khi /ready trả 200"

Controller chạy vòng lặp VÔ HẠN:
   trạng thái thực tế == mong muốn?
     ✓ không làm gì
     ✗ HÀNH ĐỘNG để tiến về mong muốn
```

Từ đó ra toàn bộ hành vi của K8s:

```text
Pod chết        → thực tế 2 ≠ mong muốn 3 → tạo pod mới
Node chết       → pod trên đó biến mất → tạo lại trên node khác
Bạn đổi image   → mong muốn đổi → rolling update
Bạn xoá pod tay → controller tạo lại ngay      ← đây là lý do "xoá pod không có tác dụng"
```

**Bạn không ra lệnh cho Kubernetes làm gì. Bạn mô tả kết quả mong muốn.** Đây là khác biệt cơ bản với Compose, và nó giải thích cả sức mạnh lẫn sự khó chịu của K8s.

### Năm việc Kubernetes làm mà Compose không

```text
① TỰ PHỤC HỒI     node chết → pod được lên lịch lại ở nơi khác
② ROLLING UPDATE  thay dần, không downtime, tự rollback nếu pod mới không ready
③ HEALTH ROUTING  chỉ pod ready mới nhận traffic (readiness probe)
④ AUTOSCALE       theo CPU, memory, hoặc metric tuỳ chỉnh
⑤ SCHEDULING      đặt pod ở node có đủ tài nguyên, theo affinity/taint
```

Cộng thêm những thứ đi kèm: service discovery, quản lý secret/config, RBAC, network policy, và một API thống nhất mà mọi công cụ khác xây trên đó.

### Cái giá — và nó không nhỏ

```text
· Khái niệm phải học: Pod, Deployment, Service, Ingress, PVC, ConfigMap,
  Secret, probe, request/limit, QoS, taint, affinity, HPA, RBAC, NetworkPolicy...
· YAML nhiều; công cụ template (Helm, Kustomize) trở thành bắt buộc
· Cluster phải vận hành: nâng cấp, vá, chứng chỉ, etcd
· Debug khó hơn: thêm nhiều tầng giữa bạn và process
· Chi phí: control plane + node dự phòng
· Cần người biết vận hành nó
```

Với một ứng dụng chạy trên một VPS mà downtime 30 giây khi deploy là chấp nhận được, Kubernetes là chi phí thuần.

### Ranh giới quyết định

```text
DÙNG COMPOSE / VPS / PaaS khi:
  · một máy đủ, và sẽ còn đủ trong 1–2 năm
  · downtime vài chục giây khi deploy chấp nhận được
  · team không có ai muốn vận hành hạ tầng
  · số service ít

DÙNG KUBERNETES khi (cần ÍT NHẤT một):
  · node chết mà hệ thống phải tự phục hồi
  · deploy không được downtime, nhiều lần mỗi ngày
  · nhiều team deploy độc lập lên hạ tầng chung
  · tải biến thiên mạnh, cần autoscale
  · đã vượt quá một máy
```

Câu hỏi quyết định không phải "hệ thống có lớn không" mà là: **"bạn đã gặp một trong năm vấn đề ở trên chưa?"**

### Các lựa chọn ở giữa

Giữa Compose và Kubernetes có nhiều bậc, và chúng thường bị bỏ qua:

```text
PaaS               Render, Railway, Fly.io, App Runner, Cloud Run
                   → rolling deploy, autoscale, TLS, không vận hành gì
                   → đủ cho phần lớn ứng dụng web

Managed container  ECS Fargate, Cloud Run
                   → có scheduler và self-healing, ít khái niệm hơn K8s

Nomad              đơn giản hơn K8s đáng kể, vẫn có scheduling và self-healing

Docker Swarm       gần Compose nhất, có scheduling — nhưng hệ sinh thái đã teo lại
```

Nhiều đội chuyển thẳng từ Compose sang Kubernetes trong khi PaaS giải quyết đúng vấn đề của họ với 5% chi phí vận hành. Đó là quyết định đáng cân nhắc nghiêm túc trước.

### Managed Kubernetes vẫn còn nhiều việc

```text
Nhà cung cấp lo:  control plane, etcd, nâng cấp control plane
BẠN vẫn lo:       node group, nâng cấp node, CNI, ingress controller,
                  cert-manager, monitoring, log, RBAC, network policy,
                  autoscaler, backup, và mọi cấu hình workload
```

"Managed" giảm khoảng một nửa công việc, không phải toàn bộ. Đây là điều hay bị đánh giá thấp khi quyết định.

### Điều Kubernetes KHÔNG làm

```text
✗ không làm app của bạn có khả năng scale
   → app giữ state trong bộ nhớ vẫn không scale ngang được

✗ không làm app chịu lỗi
   → không có retry, timeout, circuit breaker ở tầng app thì vẫn sập dây chuyền

✗ không thay CI/CD
   → nó nhận artifact; bạn vẫn cần pipeline

✗ không quản lý database cho bạn
   → chạy database trên K8s là một dự án riêng

✗ không tự làm hệ thống đáng tin cậy
   → nó cho công cụ; bạn phải cấu hình probe, resource, PDB đúng
```

Điểm cuối đáng nhấn: một cluster với probe sai, không có resource limit, và không có PodDisruptionBudget **kém tin cậy hơn** một VPS được cấu hình cẩn thận.

### Điều kiện tiên quyết

Trước khi học Kubernetes, cần có mức hiểu **tự debug được** về:

```text
① process, PID 1, signal, exit code    → 00-linux/01, 04
② port, socket, bind interface          → 00-linux/05
③ filesystem, UID, quyền                → 00-linux/03
④ memory/CPU limit, cgroup, OOMKilled   → 00-linux/02
⑤ image, layer, volume, container network → 02-docker
⑥ DNS, TCP, reverse proxy, timeout       → 01-networking
⑦ đã tự gặp giới hạn của Compose         → 02-docker/06
```

Thiếu bảy điều này, mỗi lỗi Kubernetes sẽ là một bí ẩn — vì gần như mọi lỗi K8s là một trong bảy cơ chế trên rò rỉ qua nhiều lớp trừu tượng.

## Example

Cùng một hệ thống, ba mức:

```yaml
# ── Compose: một máy ──
services:
  api:
    image: myapp:v1
    ports: ["80:3000"]
    restart: always          # restart nếu CONTAINER chết — KHÔNG cứu được node chết
```

```yaml
# ── Kubernetes: nhiều máy, tự phục hồi ──
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  strategy:
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: api
          image: ghcr.io/org/app@sha256:9f2a...
          ports: [{ containerPort: 3000 }]
          readinessProbe:                       # ③ chỉ pod ready nhận traffic
            httpGet: { path: /ready, port: 3000 }
            periodSeconds: 2
            failureThreshold: 1
          livenessProbe:
            httpGet: { path: /health, port: 3000 }
            periodSeconds: 20
          resources:                            # ⑤ scheduler biết đặt ở đâu
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 512Mi }
---
apiVersion: v1
kind: Service                                   # service discovery + load balancing
metadata: { name: api }
spec:
  selector: { app: api }
  ports: [{ port: 80, targetPort: 3000 }]
```

Năm việc bản K8s làm mà bản Compose không:

```text
node chết        → pod được tạo lại ở node khác            (① tự phục hồi)
deploy           → thay dần, maxUnavailable: 0             (② không downtime)
pod chưa ready   → không nhận traffic                       (③ health routing)
tải tăng         → HPA thêm replica (nếu cấu hình)          (④ autoscale)
đặt pod ở đâu    → theo requests và tình trạng node         (⑤ scheduling)
```

## Prediction

1. Compose với `restart: always`, container crash — có được restart không?
2. Cùng cấu hình, cả **node** chết — container thế nào?
3. K8s, pod crash — chuyện gì xảy ra?
4. K8s, node chết — pod thế nào? Mất bao lâu?
5. `docker compose up` với image mới — có downtime không?
6. K8s rolling update với `maxUnavailable: 0` — có downtime không?
7. Bạn `kubectl delete pod` một pod của Deployment — kết quả?
8. Container vừa khởi động, chưa kết nối được DB, Compose — nó có nhận traffic không?
9. Cùng tình huống với readiness probe trong K8s?
10. App giữ session trong bộ nhớ, chạy 3 replica trên K8s — hoạt động đúng không?
11. Không đặt resource requests — scheduler đặt pod thế nào?
12. Managed Kubernetes — bạn còn phải vận hành những gì?
13. Team 3 người, một ứng dụng web, một database, deploy 2 lần/tuần — K8s có hợp lý không?

<details>
<summary>Đáp án</summary>

1. **Có** — Docker daemon restart container.
2. **Không có gì xảy ra** — không có ai biết node đó tồn tại. Container không được tạo lại ở đâu.
3. Controller thấy thực tế ≠ mong muốn → **tạo pod mới** (thường trong vài giây).
4. Sau khi node được đánh dấu `NotReady` (mặc định ~40 giây) và tolerance hết hạn (~5 phút), pod được **lên lịch lại** ở node khác. Tổng thường 1–6 phút tuỳ cấu hình.
5. **Có** — Compose dừng container cũ rồi tạo mới.
6. **Không** — pod mới ready xong mới rút pod cũ (nếu graceful shutdown đúng).
7. Controller **tạo lại ngay** — đây là lý do "xoá pod không có tác dụng"; muốn dừng thật thì phải đổi trạng thái mong muốn (`scale --replicas=0`).
8. **Có** — Compose không có health-based routing.
9. **Không** — readiness probe fail → pod bị rút khỏi Service endpoints.
10. **Không đúng** — mỗi replica một bộ nhớ riêng; người dùng bị đăng xuất ngẫu nhiên. K8s không sửa được điều này.
11. Scheduler không biết pod cần bao nhiêu → có thể đặt quá nhiều pod lên một node → tranh chấp tài nguyên.
12. Node group, nâng cấp node, CNI, ingress, cert-manager, monitoring, log, RBAC, network policy, autoscaler, backup, và toàn bộ cấu hình workload.
13. **Thường là không** — PaaS hoặc một VPS với Compose + monitoring tốt sẽ rẻ hơn nhiều. Trừ khi họ đã gặp một trong năm vấn đề.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Compose: `docker kill` container với `restart: always` | Được restart |
| Compose: tắt hẳn máy (mô phỏng node chết) | Không có gì phục hồi |
| K8s: `kubectl delete pod` | Pod mới xuất hiện ngay |
| K8s: `kubectl drain <node>` | Pod chuyển sang node khác |
| K8s: tắt kubelet trên một node, đo thời gian tới khi pod được lên lịch lại | 1–6 phút |
| Compose: `up` với image mới khi đang có tải, đếm lỗi | Có downtime |
| K8s: rollout với `maxUnavailable: 0`, đếm lỗi | Về 0 (nếu graceful shutdown đúng) |
| K8s: bỏ readiness probe, deploy | Traffic vào pod chưa sẵn sàng |
| K8s: app giữ session trong bộ nhớ, 3 replica, đăng nhập rồi F5 | Bị đăng xuất ngẫu nhiên |
| K8s: bỏ resource requests, deploy nhiều pod | Node quá tải |
| Đếm số khái niệm phải hiểu để deploy một app đơn giản | So Compose và K8s |
| Đo thời gian dựng một cluster local (kind/minikube) và deploy | Chi phí học thật |

## What Usually Goes Wrong

- **Dùng K8s khi chưa cần** → chi phí lớn, không giải quyết vấn đề nào đang có.
- **Không dùng khi cần** → node chết không ai biết, deploy có downtime.
- **Bỏ qua PaaS** → chọn giữa hai cực trong khi lựa chọn ở giữa phù hợp hơn.
- **Học K8s trước Linux/Docker/networking** → mọi lỗi là bí ẩn.
- **Tưởng K8s tự làm app scale được** → app stateful vẫn không scale ngang.
- **Tưởng K8s tự làm hệ thống đáng tin** → probe sai + không limit = kém tin cậy hơn VPS.
- **Đánh giá thấp chi phí vận hành managed K8s** → vẫn còn rất nhiều việc.
- **Không có người vận hành** → cluster trở thành hộp đen không ai dám đụng.
- **Copy YAML từ blog** → cấu hình sai probe, resource, security.
- **Không có PodDisruptionBudget** → nâng cấp node làm mất toàn bộ replica cùng lúc.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| K8s làm app scale được | App stateful vẫn không scale ngang |
| K8s làm hệ thống đáng tin cậy | Nó cho công cụ; cấu hình sai thì kém tin hơn VPS |
| Managed K8s = không phải vận hành | Bạn vẫn lo node, CNI, ingress, monitoring, RBAC |
| K8s thay CI/CD | Nó nhận artifact; pipeline vẫn cần |
| Chỉ có hai lựa chọn: Compose hoặc K8s | PaaS, ECS, Cloud Run, Nomad nằm ở giữa |
| Hệ thống lớn thì phải dùng K8s | Câu hỏi là "đã gặp vấn đề nào chưa", không phải kích thước |
| `restart: always` = tự phục hồi | Chỉ khi daemon sống; node chết thì không |
| Xoá pod là cách dừng service | Controller tạo lại ngay |
| K8s phức tạp vì thiết kế tệ | Phức tạp vì bài toán (điều phối phân tán) vốn phức tạp |
| Học K8s xong sẽ hiểu hạ tầng | Ngược lại: hiểu hạ tầng rồi K8s mới có nghĩa |

## Debugging

Câu hỏi để tự đánh giá — trả lời trước khi quyết định:

```text
① Hệ thống hiện tại hỏng ở đâu?
   Viết ra ba sự cố gần nhất. K8s có ngăn được cái nào không?

② Bạn deploy bao nhiêu lần/tuần, downtime mỗi lần bao lâu?
   Nếu 1 lần/tuần × 30 giây, đó không phải vấn đề.

③ Node chết thì chuyện gì xảy ra hôm nay?
   Nếu câu trả lời là "không ai biết" — đó là vấn đề thật.

④ Ai sẽ vận hành cluster?
   Nếu không có ai, đây là câu trả lời.

⑤ PaaS có giải quyết được không?
   Thử trước; nó rẻ hơn nhiều.

⑥ Team có nắm bảy điều kiện tiên quyết chưa?
   Nếu chưa, học chúng trước sẽ rút ngắn đường học K8s.
```

## Production Considerations

- **Bắt đầu ở mức đơn giản nhất đủ dùng.** Chuyển lên khi gặp vấn đề cụ thể, không phải khi dự đoán.
- **Thử PaaS trước.** Với phần lớn ứng dụng web, nó cho ①②③④ mà không tốn chi phí vận hành.
- **Nếu chọn K8s, dùng managed** (EKS/GKE/AKS) — vận hành control plane không tạo khác biệt cạnh tranh.
- **Có ít nhất một người hiểu cluster đủ để debug lúc 3 giờ sáng.**
- **Học điều kiện tiên quyết trước** — nó rút ngắn đường học K8s đáng kể.
- **Đừng copy YAML mà không hiểu** — probe, resource, security context sai gây sự cố mà YAML trông vẫn "đúng".
- **Ghi lại vì sao chọn K8s** — sau hai năm, câu hỏi "chúng ta có cần cái này không" là câu hỏi thật.
- **Đo chi phí thật**: tiền hạ tầng + thời gian người. Với đội nhỏ, cột thứ hai thường lớn hơn.
- **App phải cloud-native trước**: stateless, cấu hình qua env, log ra stdout, graceful shutdown, health endpoint. Không có những thứ này, K8s không giúp được gì.

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| Một VPS + Compose | đơn giản nhất, rẻ nhất | không tự phục hồi, downtime khi deploy |
| Nhiều VPS + Compose | rẻ, phân tán | không có scheduler; node chết không ai xử lý |
| PaaS | rolling deploy, autoscale, TLS, zero-ops | ít kiểm soát, chi phí theo quy mô, khoá nhà cung cấp |
| ECS / Cloud Run | self-healing, ít khái niệm hơn K8s | gắn với một cloud |
| Nomad | đơn giản hơn K8s, vẫn scheduling | hệ sinh thái nhỏ hơn nhiều |
| Managed K8s | đầy đủ tính năng, hệ sinh thái lớn | vẫn nhiều việc vận hành, học nhiều |
| Self-hosted K8s | kiểm soát tối đa | vận hành control plane, etcd, nâng cấp |

## Explain Without Notes

1. Năm việc Kubernetes làm mà Compose không?
2. Vòng lặp điều hoà là gì? Vì sao xoá pod bằng tay không có tác dụng?
3. Cái giá của Kubernetes gồm những gì?
4. Ranh giới quyết định: khi nào Compose đủ, khi nào cần K8s?
5. Managed Kubernetes vẫn để lại cho bạn những việc gì?
6. Năm điều Kubernetes **không** làm?
7. Bảy điều kiện tiên quyết trước khi học K8s?
8. Câu hỏi nào quyết định, thay cho "hệ thống có lớn không"?

## Related

- [Compose](../../02-docker/06-compose.md) — giới hạn của một máy
- [Pod, Deployment, Service](../workloads-networking/01-pod-deployment-service.md) — ba khái niệm đầu tiên
- [Readiness & liveness](../scheduling-reliability/01-health-readiness-liveness.md) — health routing
- [Rollout & rollback](../workloads-networking/03-rollout-rollback.md) — deploy không downtime
- [Scheduling & resources](../scheduling-reliability/02-scheduling-resources.md) — scheduler đặt pod ở đâu
- [Autoscaling](../scheduling-reliability/03-autoscaling.md) — scale theo tải
- [00-linux/](../../00-linux/README.md) — điều kiện tiên quyết
- [02-docker/](../../02-docker/README.md) — điều kiện tiên quyết
- [01-networking/](../../01-networking/README.md) — điều kiện tiên quyết
- [Deployment strategies](../../03-cicd/03-deployment-strategies.md) — chiến lược deploy

## Version / Context

Kubernetes 1.29+. Thời gian phát hiện node chết phụ thuộc `node-monitor-grace-period` (mặc định 40s) và `tolerationSeconds` của taint `node.kubernetes.io/unreachable` (mặc định 300s). Managed: EKS, GKE, AKS. PaaS: Render, Railway, Fly.io, Cloud Run, App Runner.
