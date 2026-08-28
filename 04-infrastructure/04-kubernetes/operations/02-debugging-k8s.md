---
level: intermediate
area: infra
prerequisites:
  - ../workloads-networking/01-pod-deployment-service.md
  - ../scheduling-reliability/01-health-readiness-liveness.md
related:
  - ../../00-linux/07-debugging-toolbox.md
  - ../../01-networking/06-network-debugging.md
---

# Debugging Kubernetes

> Pod ở trạng thái `CrashLoopBackOff`. `kubectl logs` trả về **rỗng**. `kubectl describe` cho một Event chung chung. Cluster có 12 node, 40 service, và không ai biết bắt đầu từ đâu. Note này là **thứ tự** — vì với Kubernetes, số nơi có thể hỏng lớn tới mức không có quy trình thì bạn sẽ đi vòng quanh.

## Position

```text
Triệu chứng → tầng nào? → công cụ nào? → dữ liệu → nguyên nhân
```

## Problem

Kubernetes thêm nhiều tầng giữa bạn và process:

```text
kubectl → API server → scheduler / controller → kubelet → container runtime → process
                                                    ↓
                                          CNI, CSI, kube-proxy, DNS
```

Mỗi tầng có thể hỏng, và triệu chứng thường xuất hiện ở **tầng khác** với nơi nguyên nhân nằm.

## Mental Model

### Bốn câu hỏi, theo thứ tự

```text
① Pod có ĐƯỢC TẠO không?        → Deployment / ReplicaSet / quota / admission
② Pod có ĐƯỢC LÊN LỊCH không?    → scheduler: resources, taint, affinity, volume
③ Container có CHẠY không?       → image, config, crash, probe
④ Traffic có TỚI được không?     → Service, endpoints, Ingress, DNS, NetworkPolicy
```

Dừng ở câu đầu tiên trả lời "không". Mỗi câu loại trừ hết các tầng phía sau.

### Bảng trạng thái → nguyên nhân

Bảng quan trọng nhất trong note:

```text
Trạng thái            Nghĩa là                        Xem gì
─────────────────────────────────────────────────────────────────────
Pending               chưa được lên lịch              describe pod → Events
ContainerCreating     đang kéo image / mount volume   describe pod → Events
ImagePullBackOff      không kéo được image            tên/tag/digest, pull secret
CrashLoopBackOff      container khởi động rồi chết    logs --previous
Error                 container thoát khác 0          logs
OOMKilled             vượt memory limit               describe → Last State
Running 0/1           chạy nhưng KHÔNG ready          readiness probe
Running 1/1 (vẫn lỗi) app có bug, hoặc mạng           logs, endpoints
Terminating (kẹt)     finalizer hoặc grace period     describe, finalizers
Evicted               node thiếu tài nguyên           describe node
Init:Error            init container fail             logs -c <init>
```

## How It Works

### Câu ①: pod có được tạo không?

```bash
kubectl get deploy,rs,pod -l app=api
```

```text
Deployment có nhưng KHÔNG có ReplicaSet   → controller có vấn đề (hiếm)
ReplicaSet có nhưng desired 0             → HPA scale về 0, hoặc bị scale tay
ReplicaSet desired 3, current 0           → không tạo được pod
```

```bash
kubectl describe rs <rs>              # Events cho biết vì sao
kubectl get events --sort-by=.lastTimestamp | tail -20
```

Nguyên nhân thường gặp: ResourceQuota chặn, admission webhook từ chối, hoặc PodSecurity policy.

### Câu ②: pod Pending

```bash
kubectl describe pod <pod> | tail -20
```

Thông báo của scheduler rất cụ thể — nó nói **bao nhiêu node bị loại vì lý do gì**:

```text
0/12 nodes are available:
  3 node(s) had untolerated taint {node-role.kubernetes.io/control-plane}
  5 Insufficient cpu                          ← requests, KHÔNG phải usage
  2 node(s) didn't match pod anti-affinity rules
  2 node(s) had volume node affinity conflict ← volume ở zone khác
```

```bash
# so REQUESTS đã cam kết với capacity — không so với `top`
kubectl describe node <node> | grep -A8 'Allocated resources'
kubectl get pvc                       # PVC Pending?
```

Xem [Scheduling & resources](../scheduling-reliability/02-scheduling-resources.md).

### Câu ③: container không chạy

```bash
kubectl logs <pod>                    # container hiện tại
kubectl logs <pod> --previous         # container ĐÃ CRASH  ← quan trọng nhất
kubectl logs <pod> -c <container>     # pod nhiều container
kubectl logs -l app=api --tail=100 --prefix   # mọi pod cùng lúc
```

`--previous` là lệnh quan trọng nhất khi debug `CrashLoopBackOff`: log của container hiện tại thường rỗng vì nó vừa được tạo lại.

Nếu `--previous` cũng rỗng:

```text
· app chết TRƯỚC khi kịp log → lỗi config, thiếu biến môi trường
· app ghi log ra file thay vì stdout
· liveness probe giết trước khi app khởi động xong → thiếu startupProbe
```

```bash
kubectl describe pod <pod> | grep -A8 'Last State'
#   Reason: OOMKilled   Exit Code: 137   → vượt memory limit
#   Reason: Error       Exit Code: 1     → lỗi app
#   Reason: Error       Exit Code: 137   → SIGKILL (liveness hoặc grace period)
```

Phân biệt `OOMKilled` và `Error` với cùng exit code 137 là chi tiết quan trọng: một cái là memory, một cái là bị giết vì lý do khác.

### Câu ④: traffic không tới

```bash
kubectl get endpoints <svc>
```

Đây là lệnh chia đôi không gian tìm kiếm:

```text
<none>   → selector sai HOẶC pod chưa ready
có IP    → vấn đề ở tầng Ingress / DNS / NetworkPolicy / app
```

```bash
# nếu <none>: phân biệt hai nguyên nhân
kubectl get pods -l <selector>              # có pod nào khớp không?
kubectl get pods -l <selector> -o wide      # READY 1/1 hay 0/1?
kubectl get pods --show-labels              # label thật là gì?
```

```bash
# test từng tầng, từ trong ra ngoài
kubectl exec <pod> -- wget -qO- localhost:3000/health        # app tự nó
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://api.default.svc.cluster.local/health         # qua Service
kubectl port-forward svc/api 8080:80                          # bỏ qua Ingress/LB
curl localhost:8080/health
```

Bốn bước này cô lập chính xác tầng có vấn đề.

### Ephemeral debug container

```bash
kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>
```

Nó chạy một container **trong cùng namespace** với pod đích — cùng mạng, cùng PID (nếu `--target`). Đây là cách debug image distroless hoặc image tối giản không có shell.

```bash
kubectl debug node/<node> -it --image=ubuntu    # debug chính node
```

### Pod kẹt `Terminating`

```bash
kubectl get pod <pod> -o jsonpath='{.metadata.finalizers}'
```

```text
· grace period chưa hết (chờ terminationGracePeriodSeconds)
· app không phản hồi SIGTERM → chờ tới hết grace period
· finalizer chưa được xoá → kẹt VĨNH VIỄN
· node NotReady → API server không xác nhận được
```

```bash
kubectl delete pod <pod> --force --grace-period=0   # BIỆN PHÁP CUỐI
```

Với StatefulSet, `--force` nguy hiểm: nó xoá bản ghi pod trong khi container **có thể vẫn chạy** trên node — và một pod thứ hai với cùng danh tính sẽ được tạo, dẫn tới hai instance cùng ghi vào một volume.

### Events: nơi chứa phần lớn câu trả lời

```bash
kubectl get events --sort-by=.lastTimestamp -A | tail -30
kubectl get events --field-selector involvedObject.name=<pod>
kubectl describe pod <pod>        # Events ở CUỐI output
```

Events mặc định chỉ giữ **1 giờ**. Với sự cố xảy ra đêm qua, chúng đã biến mất — đây là lý do cần một hệ thống lưu event lâu dài (Loki, hoặc event exporter).

### Log của control plane và node

```bash
kubectl logs -n kube-system deploy/coredns
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller
kubectl logs -n kube-system deploy/cluster-autoscaler | grep -i 'scale'
kubectl get nodes -o wide
kubectl describe node <node> | grep -A10 Conditions
```

`describe node` → phần **Conditions** cho biết `MemoryPressure`, `DiskPressure`, `PIDPressure` — chúng giải thích tại sao pod bị evict.

### `kubectl` cần biết

```bash
kubectl get pods -A -o wide --sort-by=.status.startTime
kubectl get pods -A --field-selector status.phase=Pending
kubectl get pods -A --field-selector status.phase=Failed
kubectl top pods -A --sort-by=memory
kubectl top nodes

# so cấu hình mong muốn với thực tế
kubectl get deploy api -o yaml | kubectl neat        # cần plugin krew "neat"
kubectl diff -f deployment.yaml

# xem lịch sử
kubectl rollout history deploy/api
kubectl rollout history deploy/api --revision=3

# kiểm tra quyền
kubectl auth can-i create pods --as=system:serviceaccount:default:api
```

`kubectl auth can-i` giải quyết một lớp lỗi khó đoán: pod không làm được gì đó vì RBAC, và thông báo lỗi thường không nói rõ.

## Example

`CrashLoopBackOff` với log rỗng, từ đầu tới cuối:

```bash
POD=api-7f8b-x9k2

# 1. Trạng thái và lý do
kubectl get pod $POD
# NAME             READY   STATUS             RESTARTS   AGE
# api-7f8b-x9k2    0/1     CrashLoopBackOff   7          12m

# 2. Log của container ĐÃ CRASH
kubectl logs $POD --previous
# (rỗng)                       ← app chết trước khi kịp log

# 3. Exit code và lý do
kubectl describe pod $POD | grep -A6 'Last State'
#   Last State: Terminated
#     Reason: Error
#     Exit Code: 1
#     Started: ...  Finished: ... (chênh 0,3 giây)
#   ← chết trong 0,3 giây → lỗi lúc khởi động, không phải OOM

# 4. Events
kubectl describe pod $POD | tail -15
#   Normal  Pulled   ...  Successfully pulled image
#   Warning BackOff  ...  Back-off restarting failed container

# 5. Chạy image bằng tay, bỏ qua entrypoint
kubectl run debug --rm -it --image=<same-image> --restart=Never -- sh
# / $ node dist/main.js
# Error: Invalid environment: DATABASE_URL: Required
#   ← ĐÂY: thiếu biến môi trường, và app validate config lúc khởi động (đúng)

# 6. Xác nhận
kubectl get secret api-secrets -o jsonpath='{.data}' | jq keys
# ["JWT_SECRET"]              ← thiếu DATABASE_URL
```

Bước 5 là bước quyết định: **chạy image bằng tay với shell** cho bạn thấy lỗi mà log của pod không kịp ghi.

Và lưu ý điều tích cực: app crash lúc khởi động vì thiếu config là **hành vi đúng** — nó ngăn pod hỏng vào Service. Xem [Configuration](../../../02-backend-api/04-architecture/05-configuration.md).

## Prediction

1. `CrashLoopBackOff`, `kubectl logs` rỗng — vì sao? Dùng lệnh nào?
2. `logs --previous` cũng rỗng — ba khả năng?
3. Exit code 137 với `Reason: OOMKilled` vs `Reason: Error` — khác gì?
4. Pod `Running 0/1` — nghĩa là gì?
5. `kubectl get endpoints` trả `<none>`, pod `Running 1/1` — nguyên nhân?
6. Cùng lệnh trả `<none>`, pod `Running 0/1` — nguyên nhân?
7. Pod `Pending`, `kubectl top node` cho thấy CPU 20% — vì sao?
8. `ImagePullBackOff` — ba nguyên nhân?
9. Pod kẹt `Terminating` 10 phút — ba khả năng?
10. `--force --grace-period=0` trên pod StatefulSet — rủi ro gì?
11. Sự cố đêm qua, sáng nay chạy `kubectl get events` — thấy gì?
12. Image distroless không có shell, cần debug mạng — làm sao?
13. Pod không tạo được ServiceAccount token / không gọi được API — kiểm tra gì?

<details>
<summary>Đáp án</summary>

1. Container hiện tại vừa được tạo lại nên chưa có log. Dùng **`kubectl logs --previous`**.
2. (a) App chết trước khi kịp log (lỗi config). (b) App ghi log ra file thay vì stdout. (c) Liveness probe giết trước khi khởi động xong.
3. `OOMKilled` = vượt memory limit. `Error` + 137 = bị SIGKILL vì lý do khác (liveness, hoặc hết grace period).
4. Container **chạy** nhưng **readiness probe fail** → không nhận traffic.
5. **Selector không khớp label** của pod.
6. **Pod chưa ready** — readiness probe fail.
7. Scheduler dùng **requests** đã cam kết, không dùng usage. `describe node` → `Allocated resources`.
8. Sai tên/tag/digest; thiếu `imagePullSecret`; registry không tới được từ node.
9. Grace period chưa hết; app không phản hồi SIGTERM; finalizer chưa được xoá (hoặc node NotReady).
10. Bản ghi pod bị xoá trong khi container **có thể vẫn chạy** → pod mới cùng danh tính được tạo → **hai instance ghi cùng volume**.
11. **Không thấy gì** — events mặc định chỉ giữ 1 giờ.
12. `kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>`.
13. RBAC: `kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa>`.
</details>

## Break It

Tạo từng lỗi một lần — mỗi thí nghiệm dạy một trạng thái:

| Tạo lỗi thế nào | Trạng thái |
|---|---|
| Đặt image tag không tồn tại | `ImagePullBackOff` |
| Xoá một biến môi trường bắt buộc | `CrashLoopBackOff`, log rỗng |
| Chạy image bằng tay với shell | Thấy lỗi thật |
| Đặt `requests.cpu: 100` | `Pending` + `Insufficient cpu` |
| Cấp phát memory vượt limit | `OOMKilled`, exit 137 |
| Làm readiness probe fail | `Running 0/1`, endpoints rỗng |
| Đổi label pod lệch selector | endpoints rỗng, pod `1/1` |
| Liveness probe fail liên tục | Restart tăng, `Reason: Error` 137 |
| Bỏ startupProbe với app khởi động chậm | `CrashLoopBackOff` |
| App không xử lý SIGTERM, `delete pod` | Kẹt `Terminating` tới hết grace period |
| NetworkPolicy chặn DNS | Pod chạy nhưng không phân giải được gì |
| PVC ở zone không có chỗ | `Pending` + `volume node affinity conflict` |
| Dùng `kubectl debug` với image distroless | Có công cụ |

## What Usually Goes Wrong

- **Quên `--previous`** khi debug CrashLoopBackOff → thấy log rỗng và bế tắc.
- **Không đọc Events trong `describe`** → bỏ qua nơi chứa câu trả lời.
- **Nhầm `top` với requests** khi debug Pending → tìm sai chỗ.
- **Không phân biệt `OOMKilled` và `Error`** với cùng exit 137.
- **Không kiểm tra `endpoints`** khi Service không hoạt động → debug sai tầng.
- **Không phân biệt "selector sai" và "pod chưa ready"** — cùng triệu chứng.
- **`--force --grace-period=0` trên StatefulSet** → hai instance cùng volume.
- **Events đã hết hạn** → không có dữ liệu về sự cố đêm qua.
- **Không có log tập trung** → pod bị xoá là mất log.
- **Debug từ laptop thay vì từ trong cluster** → đường mạng khác hoàn toàn.
- **Sửa bằng `kubectl edit` ở production** → thay đổi biến mất ở lần deploy sau, và không ai biết đã sửa gì.
- **Không kiểm tra RBAC** khi pod không gọi được API.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `kubectl logs` cho log của container đã crash | Cần `--previous` |
| Log rỗng nghĩa là không có gì để xem | App có thể chết trước khi kịp log |
| Exit 137 luôn là OOM | Cũng có thể là liveness hoặc hết grace period |
| `Running` nghĩa là hoạt động | Cần `READY 1/1` |
| `kubectl top` cho biết còn bao nhiêu chỗ | Scheduler dùng **requests** |
| Events được giữ lâu | Mặc định chỉ 1 giờ |
| `--force` là cách an toàn để xoá pod kẹt | Với StatefulSet nó nguy hiểm thật |
| Image không có shell thì không debug được | `kubectl debug` giải quyết |
| Debug từ laptop tương đương từ pod | DNS, route, firewall, trust store đều khác |
| `kubectl edit` là cách sửa nhanh | Nó tạo drift và biến mất ở lần deploy sau |

## Debugging

Quy trình đầy đủ — dán vào runbook:

```bash
# ═══ ① Tổng quan ═══
kubectl get pods -A --field-selector status.phase!=Running
kubectl get events --sort-by=.lastTimestamp -A | tail -30
kubectl get nodes -o wide

# ═══ ② Pod cụ thể ═══
POD=<pod>; NS=<ns>
kubectl -n $NS describe pod $POD | tail -25          # Events ở CUỐI
kubectl -n $NS logs $POD --previous --tail=200
kubectl -n $NS get pod $POD -o jsonpath='{.status.containerStatuses[0].lastState}' | jq

# ═══ ③ Pending ═══
kubectl -n $NS describe pod $POD | grep -A5 'FailedScheduling'
kubectl describe node <node> | grep -A8 'Allocated resources'
kubectl -n $NS get pvc

# ═══ ④ Traffic ═══
kubectl -n $NS get endpoints <svc>
kubectl -n $NS get pods -l <selector> -o wide
kubectl -n $NS exec $POD -- wget -qO- localhost:3000/health
kubectl -n $NS port-forward svc/<svc> 8080:80

# ═══ ⑤ Đi sâu ═══
kubectl -n $NS debug -it $POD --image=nicolaka/netshoot --target=<container>
kubectl -n $NS exec $POD -- sh -c 'id; env | sort; ss -tlnp; cat /sys/fs/cgroup/memory.max'

# ═══ ⑥ Hạ tầng ═══
kubectl -n kube-system logs deploy/coredns --tail=50
kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=50
kubectl describe node <node> | grep -A10 Conditions
```

Và câu hỏi phân loại ở mỗi bước: **tôi đang ở tầng nào trong bốn tầng?**

## Production Considerations

- **Log tập trung** (Loki, ELK, Cloud Logging) — pod bị xoá là mất log cục bộ, và bạn cần log của pod đã chết.
- **Lưu Events lâu dài** — mặc định 1 giờ là không đủ cho sự cố đêm qua.
- **Metric có nhãn `pod`, `node`, `version`** — không có chúng, bạn không so sánh được.
- **Cài sẵn `kubectl debug` và biết dùng** trước khi cần.
- **Runbook cho năm trạng thái phổ biến**: `Pending`, `ImagePullBackOff`, `CrashLoopBackOff`, `OOMKilled`, `Running 0/1` — với đúng chuỗi lệnh.
- **`kubectl` plugin hữu ích** (qua krew): `stern` (log nhiều pod), `neat` (bỏ field thừa), `ctx`/`ns` (đổi context nhanh).
- **Không `kubectl edit` ở production** — mọi thay đổi qua git (GitOps). `kubectl edit` tạo drift mà không ai theo dõi được.
- **Quyền chỉ-đọc rộng rãi, quyền ghi hẹp** — mọi người debug được, ít người sửa được.
- **`kubectl auth can-i --list`** để hiểu quyền của một ServiceAccount trước khi debug RBAC.
- **Ghi postmortem** cho mọi sự cố, kèm chuỗi lệnh đã dùng — nó biến kinh nghiệm cá nhân thành runbook.
- **Diễn tập**: chủ động tạo các lỗi ở bảng Break It trên staging. Ba mươi phút thí nghiệm tiết kiệm nhiều giờ lúc 3 giờ sáng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Log tập trung | có log của pod đã chết | chi phí lưu trữ, độ trễ |
| Chỉ `kubectl logs` | miễn phí | mất khi pod bị xoá |
| Lưu Events lâu | điều tra được sự cố cũ | thêm một thành phần |
| `kubectl debug` | debug được image tối giản | cần quyền, cần biết cách |
| Công cụ trong image app | luôn sẵn sàng | image lớn, bề mặt tấn công |
| Image distroless | an toàn, nhỏ | phải dùng ephemeral container |
| Quyền ghi rộng | sửa nhanh khi có sự cố | rủi ro, và tạo drift |
| Quyền ghi hẹp + GitOps | mọi thay đổi có lịch sử | chậm hơn khi khẩn cấp |
| Runbook chi tiết | ai cũng xử lý được | phải bảo trì |

## Explain Without Notes

1. Bốn câu hỏi theo thứ tự khi debug Kubernetes?
2. Vì sao `kubectl logs` rỗng với CrashLoopBackOff, và dùng lệnh gì?
3. Ba khả năng khi `logs --previous` cũng rỗng?
4. Phân biệt exit 137 do OOM và do liveness thế nào?
5. `endpoints` rỗng — hai nguyên nhân và cách phân biệt?
6. Vì sao `kubectl top` không giúp khi pod Pending?
7. Vì sao `--force --grace-period=0` nguy hiểm với StatefulSet?
8. Bốn bước cô lập tầng khi traffic không tới?

## Related

- [Pod, Deployment, Service](../workloads-networking/01-pod-deployment-service.md) — endpoints, label
- [Readiness & liveness](../scheduling-reliability/01-health-readiness-liveness.md) — `Running 0/1`
- [Scheduling & resources](../scheduling-reliability/02-scheduling-resources.md) — Pending
- [Storage & StatefulSet](../workloads-networking/04-storage-statefulset.md) — PVC Pending, `--force`
- [Ingress & service discovery](../workloads-networking/02-ingress-service-discovery.md) — traffic không tới
- [Rollout & rollback](../workloads-networking/03-rollout-rollback.md) — rollout treo
- [Linux debugging toolbox](../../00-linux/07-debugging-toolbox.md) — tầng OS
- [Network debugging](../../01-networking/06-network-debugging.md) — tầng mạng
- [Docker common failures](../../02-docker/08-common-failures.md) — tầng container
- [Logs, metrics & traces](../../../05-cross-cutting/observability/01-logs-metrics-traces.md) — quan sát trước khi cần

## Version / Context

Kubernetes 1.29+. `kubectl debug` (ephemeral container) ổn định từ 1.25. Events mặc định giữ 1 giờ (`--event-ttl` của API server). Plugin qua krew: `stern`, `neat`, `ctx`, `ns`. Image debug phổ biến: `nicolaka/netshoot`.
