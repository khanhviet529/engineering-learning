---
level: advanced
area: infra
prerequisites:
  - 03-config-secrets-resources.md
related:
  - 09-autoscaling.md
  - 10-debugging-k8s.md
---

# Scheduling & resources

> Cluster có 12 node, `kubectl top nodes` cho thấy CPU trung bình 30%. Nhưng pod mới ở trạng thái `Pending` với thông báo `0/12 nodes are available: Insufficient cpu`. Node còn rảnh, và scheduler vẫn từ chối — vì nó không nhìn vào **mức sử dụng thực tế**, nó nhìn vào **tổng requests đã cam kết**.

## Position

```text
Pod được tạo → PENDING → scheduler chọn node → kubelet chạy container
                            ↑ note này: nó chọn thế nào, và vì sao đôi khi không chọn được
```

## Problem

```text
① Pod Pending mà node "còn rảnh"      → scheduler dùng REQUESTS, không dùng usage
② Pod bị evict khi node thiếu tài nguyên → theo QoS class
③ Pod của một app dồn vào một node     → node đó chết = mất toàn bộ app
④ Pod chạy trên node không phù hợp      → cần GPU, cần SSD, cần vùng cụ thể
⑤ Nâng cấp node lấy đi mọi replica      → không có PodDisruptionBudget
```

Năm vấn đề, và tất cả đều được điều khiển bởi những gì bạn khai báo trong pod spec.

## Mental Model

### Scheduler nhìn REQUESTS, không nhìn USAGE

```text
Node: 4 CPU, 16 GB
Pod A: requests 2 CPU, dùng THỰC TẾ 0,2 CPU
Pod B: requests 1,5 CPU, dùng THỰC TẾ 0,1 CPU

Scheduler thấy: đã cam kết 3,5 / 4 CPU → còn 0,5
`kubectl top node` thấy: đang dùng 0,3 / 4 CPU → còn 3,7

⇒ Pod mới cần 1 CPU: PENDING, dù node gần như rảnh hoàn toàn
```

Đây là ví dụ ở đầu note. Nó **không phải bug** — scheduler phải đảm bảo mọi pod nhận được phần đã hứa, kể cả khi tất cả cùng chạy hết công suất.

Hệ quả thực tế: **request quá lớn làm lãng phí cluster.** Đặt `requests: 2 CPU` cho một app dùng 0,2 CPU nghĩa là bạn đã đặt chỗ gấp 10 lần cần thiết.

Cách đo request đúng:

```text
requests = mức dùng ở tải BÌNH THƯỜNG (p50–p75), không phải đỉnh
limits   = đỉnh + biên an toàn
```

### Hai giai đoạn: filter rồi score

```text
① FILTER  loại node KHÔNG chạy được pod này
          · không đủ tài nguyên (theo requests)
          · không khớp nodeSelector / nodeAffinity
          · có taint mà pod không toleration
          · vi phạm anti-affinity
          · không có port trống (nếu dùng hostPort)
          · volume không mount được ở node đó

② SCORE   chấm điểm node còn lại, chọn cao nhất
          · cân bằng tài nguyên
          · ưu tiên node đã có image (ImageLocality)
          · affinity preference
          · spread constraints
```

Khi pod `Pending`, thông báo trong `kubectl describe pod` cho biết **bao nhiêu node bị loại vì lý do gì** — đó là dữ liệu chẩn đoán trực tiếp:

```text
0/12 nodes are available:
  3 node(s) had untolerated taint {node-role.kubernetes.io/control-plane}
  5 Insufficient cpu
  4 node(s) didn't match pod anti-affinity rules
```

### nodeSelector và nodeAffinity

```yaml
# đơn giản: chỉ khớp chính xác
nodeSelector:
  disktype: ssd

# linh hoạt hơn
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:      # BẮT BUỘC
      nodeSelectorTerms:
        - matchExpressions:
            - { key: topology.kubernetes.io/zone, operator: In, values: [ap-southeast-1a, ap-southeast-1b] }
    preferredDuringSchedulingIgnoredDuringExecution:      # ƯU TIÊN
      - weight: 100
        preference:
          matchExpressions:
            - { key: node.kubernetes.io/instance-type, operator: In, values: [c6i.xlarge] }
```

`IgnoredDuringExecution` trong tên có nghĩa đen: **nếu label của node thay đổi sau khi pod đã chạy, pod KHÔNG bị đuổi đi.** Quy tắc chỉ áp dụng lúc lên lịch.

### Taint và toleration: node từ chối pod

```text
nodeSelector/affinity  → POD chọn node
taint/toleration       → NODE từ chối pod (trừ pod có toleration)
```

```bash
kubectl taint nodes gpu-node-1 workload=gpu:NoSchedule
```

```yaml
tolerations:
  - { key: workload, operator: Equal, value: gpu, effect: NoSchedule }
```

Ba effect:

```text
NoSchedule        không lên lịch pod mới (pod đang chạy GIỮ NGUYÊN)
PreferNoSchedule  tránh nếu được
NoExecute         ĐUỔI pod đang chạy nếu không có toleration
```

Kubernetes tự thêm taint `NoExecute` khi node có vấn đề:

```text
node.kubernetes.io/not-ready       node không ready
node.kubernetes.io/unreachable     mất liên lạc
```

Mọi pod tự động có toleration cho hai taint này với `tolerationSeconds: 300`. Đây là lý do **pod mất ~5 phút mới được lên lịch lại sau khi node chết** — và nếu bạn cần nhanh hơn, phải giảm giá trị này tường minh:

```yaml
tolerations:
  - key: node.kubernetes.io/unreachable
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 30
```

### Pod anti-affinity: đừng dồn vào một node

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels: { app: api }
        topologyKey: kubernetes.io/hostname     # không hai pod api trên CÙNG node
```

Không có nó, scheduler có thể đặt cả 3 replica lên một node — và node đó chết là mất toàn bộ service.

Nhưng `required` có bẫy: nếu cluster chỉ có 2 node và bạn muốn 3 replica, pod thứ ba **Pending vĩnh viễn**. Với hầu hết trường hợp, `preferred` an toàn hơn:

```yaml
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector: { matchLabels: { app: api } }
          topologyKey: kubernetes.io/hostname
```

### Topology spread constraints: cách hiện đại hơn

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule            # hoặc ScheduleAnyway
    labelSelector: { matchLabels: { app: api } }
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector: { matchLabels: { app: api } }
```

```text
maxSkew: 1  → chênh lệch số pod giữa các zone tối đa 1
              6 replica, 3 zone → 2/2/2
```

Nó diễn đạt được điều mà anti-affinity không làm được: "phân bố **đều**", thay vì "không được cùng chỗ". Với hệ thống cần chịu được mất một zone, đây là công cụ đúng.

### Eviction: khi node thiếu tài nguyên

```text
Node thiếu memory/disk → kubelet EVICT pod theo thứ tự:
  ① BestEffort           (không đặt requests/limits)
  ② Burstable vượt request nhiều nhất
  ③ Guaranteed           (requests == limits) — cuối cùng
```

```text
Eviction ≠ OOMKilled:
  eviction   kubelet chủ động, pod bị xoá và LÊN LỊCH LẠI ở node khác
  OOMKilled  kernel giết CONTAINER, pod ở lại node và container restart
```

Phân biệt hai cái này quan trọng khi debug: một cái để lại pod ở trạng thái `Evicted` trên node cũ, một cái tăng `RESTARTS`.

### PodDisruptionBudget: bảo vệ khi bảo trì

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: api-pdb }
spec:
  minAvailable: 2                    # hoặc maxUnavailable: 1
  selector: { matchLabels: { app: api } }
```

```text
PDB áp dụng cho VOLUNTARY disruption:
  ✓ kubectl drain, nâng cấp node, cluster autoscaler thu nhỏ
  ✗ node chết đột ngột, OOMKill, pod crash  ← PDB KHÔNG bảo vệ được
```

Không có PDB, `kubectl drain` một node có thể lấy đi mọi replica cùng lúc nếu chúng dồn ở đó.

Cảnh báo: `minAvailable` bằng số replica hiện tại làm **`drain` bị chặn vĩnh viễn** — không thể bảo trì node. Đặt `minAvailable: N-1` hoặc `maxUnavailable: 1`.

### Priority và preemption

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: { name: high-priority }
value: 1000000
globalDefault: false
```

```yaml
spec:
  priorityClassName: high-priority
```

Khi cluster đầy, pod ưu tiên cao có thể **đuổi** (preempt) pod ưu tiên thấp để lấy chỗ. Hữu ích để đảm bảo service quan trọng luôn có chỗ, nhưng dùng bừa thì tạo ra một hệ thống mà không ai dự đoán được pod nào sống.

### Cluster Autoscaler và Karpenter

```text
Pod Pending vì thiếu tài nguyên
   → Cluster Autoscaler thêm NODE
   → pod được lên lịch

Node dưới ngưỡng sử dụng một thời gian
   → thu nhỏ (tôn trọng PDB)
```

Điều kiện để nó hoạt động: **pod phải khai báo requests.** Autoscaler tính toán dựa trên requests — pod BestEffort không kích hoạt scale-up.

Và một điều hay bị bỏ qua: pod không thể di chuyển (dùng `hostPath`, không có controller quản lý, PDB chặn) sẽ **ngăn node được thu nhỏ**, làm cluster giữ node rỗng và tốn tiền.

## Example

Chẩn đoán pod `Pending`:

```bash
# 1. Vì sao Pending — thông báo cho biết chính xác
kubectl describe pod api-7f8b | tail -20
# Events:
#   Warning FailedScheduling: 0/12 nodes are available:
#     3 node(s) had untolerated taint {node-role.kubernetes.io/control-plane}
#     5 Insufficient cpu
#     4 node(s) didn't match pod anti-affinity rules

# 2. So requests với capacity — KHÔNG so với usage
kubectl describe node <node> | grep -A8 'Allocated resources'
#   cpu     3500m (87%)     ← đã CAM KẾT
#   memory  12Gi   (75%)

kubectl top node <node>
#   cpu     900m (22%)      ← đang DÙNG THẬT

# ⇒ khác biệt giữa hai con số này chính là phần bị đặt chỗ mà không dùng

# 3. Pod nào chiếm chỗ?
kubectl get pods -A -o custom-columns=\
'NS:.metadata.namespace,NAME:.metadata.name,CPU:.spec.containers[*].resources.requests.cpu' \
  --field-selector spec.nodeName=<node>

# 4. Ba hướng sửa
#    a. giảm requests cho đúng với mức dùng thật
#    b. đổi anti-affinity từ required sang preferred
#    c. thêm node (hoặc để Cluster Autoscaler làm)
```

Bước 2 là bước quyết định: **hai con số đó luôn khác nhau, và khoảng cách giữa chúng là mức lãng phí của cluster.**

## Prediction

1. Node 4 CPU, các pod đã request tổng 3,5 CPU nhưng chỉ dùng 0,3 — pod mới cần 1 CPU có được lên lịch không?
2. `kubectl top node` cho thấy 22% — vì sao pod vẫn Pending?
3. Không đặt requests, node đầy — QoS class là gì? Bị evict thứ mấy?
4. `requests == limits` cho mọi container — QoS class? Bị evict thứ mấy?
5. `podAntiAffinity` `required` với `topologyKey: hostname`, 3 replica, cluster 2 node — kết quả?
6. Đổi sang `preferred` — kết quả?
7. Node bị taint `NoSchedule`, pod đang chạy trên đó — bị đuổi không?
8. Taint `NoExecute` — bị đuổi không?
9. Node chết, `tolerationSeconds` mặc định — pod được lên lịch lại sau bao lâu?
10. `PodDisruptionBudget minAvailable: 3` với `replicas: 3` — `kubectl drain` thế nào?
11. PDB có bảo vệ khi node chết đột ngột không?
12. Pod BestEffort Pending, có Cluster Autoscaler — nó có thêm node không?
13. `topologySpreadConstraints maxSkew: 1` với 3 zone và 6 replica — phân bố thế nào?

<details>
<summary>Đáp án</summary>

1. **Không** — scheduler nhìn requests (3,5 + 1 > 4), không nhìn usage.
2. Vì `top` hiển thị **usage**, scheduler dùng **requests**. Hai con số khác nhau.
3. **BestEffort** — bị evict **đầu tiên**.
4. **Guaranteed** — bị evict **cuối cùng**.
5. Pod thứ ba **Pending vĩnh viễn** — không có node thứ ba.
6. Cả 3 pod được lên lịch; hai pod có thể ở cùng node.
7. **Không** — `NoSchedule` chỉ ngăn pod **mới**.
8. **Có** — `NoExecute` đuổi pod đang chạy không có toleration.
9. Node được đánh dấu `NotReady` (~40s) + `tolerationSeconds: 300` → khoảng **5–6 phút**.
10. `drain` **bị chặn** — không thể xoá pod nào mà vẫn giữ 3 available. Đặt `minAvailable: 2`.
11. **Không** — PDB chỉ áp dụng cho voluntary disruption.
12. **Không** — autoscaler tính theo requests; pod không có requests không kích hoạt scale-up.
13. **2/2/2** — chênh lệch tối đa 1 giữa các zone.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt `requests.cpu: 3` cho app dùng 0,1 CPU, deploy nhiều replica | Pending dù node rảnh |
| So `describe node` (Allocated) với `top node` (usage) | Khoảng cách = lãng phí |
| Giảm requests cho đúng thực tế, deploy lại | Nhiều pod hơn vừa cùng node |
| Bỏ resources hoàn toàn, tạo áp lực memory trên node | BestEffort bị evict trước |
| `requests == limits`, lặp lại | Evict cuối cùng |
| `podAntiAffinity required` với replica > số node | Pending vĩnh viễn |
| Đổi sang `preferred` | Được lên lịch |
| `kubectl taint node X k=v:NoSchedule` với pod đang chạy | Không bị đuổi |
| Đổi sang `NoExecute` | Bị đuổi |
| Tắt kubelet một node, đo thời gian pod được lên lịch lại | ~5–6 phút |
| Giảm `tolerationSeconds: 30`, lặp lại | Nhanh hơn nhiều |
| `PDB minAvailable == replicas`, `kubectl drain` | Bị chặn |
| Đặt `minAvailable: N-1`, lặp lại | Drain thành công, từng pod một |
| `topologySpreadConstraints` với `maxSkew: 1`, xem phân bố | Đều giữa các zone |

## What Usually Goes Wrong

- **Requests quá lớn** → lãng phí cluster, pod Pending dù node rảnh.
- **Requests quá nhỏ** → node bị overcommit, pod bị evict hoặc throttle.
- **Không đặt requests** → BestEffort, evict đầu tiên, không kích hoạt autoscaler.
- **Nhầm usage với requests** khi debug → tìm sai chỗ.
- **`podAntiAffinity required` với ít node** → Pending vĩnh viễn.
- **Không có anti-affinity/spread** → mọi replica dồn một node.
- **PDB `minAvailable` bằng số replica** → không bảo trì node được.
- **Không có PDB** → `drain` lấy đi mọi replica cùng lúc.
- **Tưởng PDB bảo vệ khi node chết** → nó chỉ cho voluntary disruption.
- **`tolerationSeconds` mặc định 300s** → phục hồi chậm sau khi node chết.
- **Taint mà quên toleration** → pod không lên lịch được, thông báo khó hiểu.
- **Pod không di chuyển được** (`hostPath`, không có controller) → chặn cluster thu nhỏ, tốn tiền.
- **Dùng PriorityClass bừa** → không dự đoán được pod nào sống.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Scheduler nhìn mức sử dụng thực tế | Nó nhìn **requests** |
| `kubectl top` cho biết còn bao nhiêu chỗ | Nó cho biết **usage**, không phải capacity đã cam kết |
| Không đặt requests là "linh hoạt" | Là BestEffort, evict đầu tiên, không kích hoạt autoscaler |
| Taint đuổi pod đang chạy | Chỉ `NoExecute` mới đuổi |
| Anti-affinity luôn nên dùng `required` | `required` gây Pending khi thiếu node |
| PDB bảo vệ khỏi mọi gián đoạn | Chỉ voluntary disruption |
| Node chết thì pod chuyển ngay | Mặc định mất ~5–6 phút |
| Eviction và OOMKilled như nhau | Eviction xoá pod; OOMKill giết container |
| Cluster Autoscaler tự biết cần bao nhiêu | Nó tính theo requests của pod Pending |
| `nodeAffinity` áp dụng liên tục | `IgnoredDuringExecution` — chỉ lúc lên lịch |

## Debugging

1. **Pod Pending** → `kubectl describe pod` → Events. Thông báo nói **chính xác** bao nhiêu node bị loại vì lý do gì.
2. **`Insufficient cpu/memory`** → `kubectl describe node | grep -A8 'Allocated resources'` — so với requests, **không** so với `top`.
3. **Không node nào khớp affinity** → kiểm tra label của node: `kubectl get nodes --show-labels`.
4. **Taint** → `kubectl describe node | grep Taints`.
5. **Pod bị Evicted** → `kubectl get pods --field-selector status.phase=Failed`; `describe` cho biết node thiếu tài nguyên gì.
6. **`drain` bị treo** → PDB đang chặn: `kubectl get pdb`, xem `ALLOWED DISRUPTIONS`.
7. **Pod dồn một node** → `kubectl get pods -o wide` xem cột NODE.
8. **Cluster không scale up** → pod Pending có requests không? Autoscaler log nói gì?

## Production Considerations

- **Đo requests từ dữ liệu thật** (p50–p75 của mức dùng), không đoán. VPA ở chế độ `recommendation` cho gợi ý tốt.
- **Luôn đặt requests cho cả CPU và memory**; luôn đặt memory limit.
- **`LimitRange` trong mọi namespace** để pod quên khai báo không thành BestEffort.
- **`topologySpreadConstraints` theo zone và theo node** cho mọi service quan trọng — nó là cách chịu được mất một node hoặc một zone.
- **PDB cho mọi Deployment quan trọng**, với `maxUnavailable: 1` hoặc `minAvailable: N-1`.
- **Giảm `tolerationSeconds` cho `unreachable`/`not-ready`** nếu cần phục hồi nhanh hơn 5 phút.
- **Theo dõi tỉ lệ requests/usage** của cluster — đây là chỉ số lãng phí trực tiếp.
- **Node group riêng cho workload đặc biệt** (GPU, memory-optimized) với taint tương ứng.
- **Cluster Autoscaler hoặc Karpenter** với `maxReplicas`/giới hạn node rõ ràng — và nhớ giới hạn kết nối database. Xem [Connection pool](../../03-database/01-postgresql/03-connection-pool.md).
- **PriorityClass chỉ cho workload thật sự quan trọng**, không dùng rộng rãi.
- **Diễn tập `kubectl drain`** một node ở staging — nó phát hiện PDB sai và pod không di chuyển được.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Requests cao | pod luôn đủ tài nguyên | lãng phí cluster, Pending sớm |
| Requests thấp | mật độ cao, tiết kiệm | tranh chấp, evict, throttle |
| Guaranteed QoS | ổn định, evict cuối | tốn tài nguyên |
| Burstable QoS | mật độ cao | bị evict trước |
| Anti-affinity `required` | chắc chắn phân tán | Pending khi thiếu node |
| Anti-affinity `preferred` | luôn lên lịch được | có thể dồn một node |
| Topology spread `DoNotSchedule` | phân bố đảm bảo | Pending khi mất cân bằng |
| Topology spread `ScheduleAnyway` | luôn lên lịch được | phân bố có thể lệch |
| PDB chặt | bảo vệ availability | bảo trì node chậm hoặc bị chặn |
| PDB lỏng | bảo trì nhanh | có thể mất nhiều replica cùng lúc |
| `tolerationSeconds` thấp | phục hồi nhanh sau node chết | pod bị chuyển vì lỗi mạng tạm thời |
| Cluster Autoscaler | tự động, tiết kiệm | độ trễ scale-up, phức tạp |

## Explain Without Notes

1. Vì sao pod Pending dù `kubectl top node` cho thấy node rảnh?
2. Hai giai đoạn của scheduler, và mỗi giai đoạn làm gì?
3. `nodeSelector`/affinity khác taint/toleration ở hướng nào?
4. Ba effect của taint, và cái nào đuổi pod đang chạy?
5. Ba QoS class và thứ tự evict?
6. Anti-affinity `required` vs `preferred` — bẫy của cái đầu?
7. PDB bảo vệ khỏi cái gì và **không** bảo vệ khỏi cái gì?
8. Vì sao pod mất ~5 phút mới chuyển sau khi node chết?

## Related

- [Config, secrets & resources](03-config-secrets-resources.md) — requests/limits, QoS
- [Autoscaling](09-autoscaling.md) — HPA, VPA, Cluster Autoscaler
- [Rollout & rollback](07-rollout-rollback.md) — PDB và rolling update
- [Debugging Kubernetes](10-debugging-k8s.md) — pod Pending
- [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md) — cgroup bên dưới
- [Storage & StatefulSet](08-storage-statefulset.md) — volume ảnh hưởng scheduling
- [Vì sao cần Kubernetes](04-why-kubernetes.md) — scheduling là một trong năm việc
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md)

## Version / Context

Kubernetes 1.29+. `topologySpreadConstraints` ổn định từ 1.19; `minDomains` từ 1.27. `policy/v1` cho PDB từ 1.21. Taint mặc định `node.kubernetes.io/unreachable` và `not-ready` với `tolerationSeconds: 300`. Karpenter là lựa chọn thay Cluster Autoscaler trên AWS với thời gian scale-up nhanh hơn.
