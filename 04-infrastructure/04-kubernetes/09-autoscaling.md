---
level: advanced
area: infra
prerequisites:
  - 05-scheduling-resources.md
related:
  - 07-rollout-rollback.md
  - ../../03-database/01-postgresql/03-connection-pool.md
  - ../../05-cross-cutting/reliability/04-capacity-and-limits.md
---

# Autoscaling

> HPA được cấu hình để scale API từ 3 lên 50 pod theo CPU. Một đợt tăng tải bất ngờ tới, HPA làm đúng việc của nó và scale lên 40 pod. Mỗi pod mở 10 connection tới PostgreSQL. `max_connections` là 200. Database từ chối kết nối, **mọi** pod bắt đầu lỗi — kể cả 3 pod ban đầu vốn đang chạy tốt. Autoscaling đã biến một đợt tăng tải thành một sự cố toàn phần.

## Position

```text
HPA   số POD    ← theo metric của workload
VPA   tài nguyên MỖI pod
CA    số NODE   ← khi pod Pending vì thiếu chỗ
```

Ba cơ chế, ba trục khác nhau. Chúng phối hợp — và cũng xung đột nếu cấu hình sai.

## Problem

```text
Tải thay đổi:
  · ngày/đêm chênh 10 lần
  · đợt tăng đột biến (chiến dịch, sự kiện)
  · tăng trưởng dài hạn

Cố định số pod:
  · đặt theo đỉnh  → lãng phí phần lớn thời gian
  · đặt theo trung bình → chết khi có đỉnh
```

Autoscaling giải quyết điều đó. Nhưng nó tạo ra ba vấn đề mới:

```text
① Scale ứng dụng KHÔNG scale dependency  → database, API bên ngoài, rate limit
② Scale không đủ nhanh                    → đỉnh tải đã qua khi pod mới sẵn sàng
③ Flapping                                → scale lên/xuống liên tục
```

Vấn đề ① là nghiêm trọng nhất và là sự cố ở đầu note.

## Mental Model

### HPA: số pod theo metric

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
```

```text
desiredReplicas = ceil( currentReplicas × (currentMetric / targetMetric) )

6 pod, CPU trung bình 90%, target 70%
   → ceil(6 × 90/70) = ceil(7.7) = 8 pod
```

**Điểm quan trọng nhất về HPA:** `averageUtilization` tính theo **CPU request**, không theo limit và không theo capacity của node.

```text
request 100m, dùng thật 70m → utilization 70%
⇒ đặt request SAI làm HPA hoạt động sai HOÀN TOÀN

request quá cao → utilization luôn thấp → không bao giờ scale
request quá thấp → utilization luôn cao → scale vô tận
```

Đây là lý do **HPA đòi hỏi request đúng** trước khi nó có ý nghĩa.

### CPU không phải lúc nào cũng là metric đúng

```text
CPU     đúng cho: xử lý, render, tính toán
        SAI cho: app I/O-bound (CPU thấp trong khi đang quá tải chờ DB)

Memory  hiếm khi đúng: app thường không giải phóng memory khi tải giảm
        → scale lên thì được, scale xuống thì không

Metric tuỳ chỉnh  thường ĐÚNG NHẤT:
        · request per second
        · độ dài hàng đợi        ← tốt nhất cho worker
        · latency p95
        · số kết nối đang mở
```

Với một API Node.js I/O-bound, CPU có thể ở 20% trong khi event loop lag cao và người dùng đang chờ. Scale theo CPU sẽ **không bao giờ kích hoạt**.

### Metric tuỳ chỉnh với KEDA

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: worker }
spec:
  scaleTargetRef: { name: worker }
  minReplicaCount: 1
  maxReplicaCount: 20
  cooldownPeriod: 300
  triggers:
    - type: redis
      metadata:
        address: redis:6379
        listName: bull:reports:wait
        listLength: "50"          # 1 pod cho mỗi 50 job đang chờ
```

Với worker, **độ dài hàng đợi là metric đúng** — nó phản ánh trực tiếp công việc chưa làm, và nó hoạt động kể cả khi worker là I/O-bound.

KEDA cũng scale được về **0** — hữu ích cho worker chạy theo đợt.

### `behavior`: kiểm soát tốc độ

```yaml
spec:
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0        # phản ứng NGAY
      policies:
        - { type: Percent, value: 100, periodSeconds: 30 }   # gấp đôi mỗi 30s
        - { type: Pods, value: 4, periodSeconds: 30 }        # tối đa +4 pod/30s
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300      # chờ 5 PHÚT trước khi giảm
      policies:
        - { type: Percent, value: 10, periodSeconds: 60 }    # giảm tối đa 10%/phút
```

Nguyên tắc bất đối xứng, và nó là điểm quan trọng nhất về cấu hình HPA:

```text
SCALE UP    NHANH  — hậu quả của chậm: người dùng gặp lỗi
SCALE DOWN  CHẬM   — hậu quả của nhanh: flapping, và đỉnh tiếp theo lại thiếu
```

`stabilizationWindowSeconds` cho scale down mặc định là 300 giây — giữ nguyên hoặc tăng, đừng giảm.

### Vì sao scale up thường quá chậm

```text
t=0    tải tăng
t=15   metrics-server thu thập (mặc định mỗi 15s)
t=30   HPA đánh giá (mặc định mỗi 15s)
t=30   tạo pod mới
t=?    kéo image        ← 5–60 giây tuỳ kích thước image
t=?    app khởi động     ← 5–120 giây
t=?    readiness pass
────────────────────────
tổng: 1–3 PHÚT trước khi pod mới nhận traffic
```

Với đợt tăng tải kéo dài 90 giây, HPA **không kịp**.

Ba cách rút ngắn:

```text
① Image nhỏ → kéo nhanh hơn
② App khởi động nhanh → không kết nối đồng bộ nặng trong lúc boot
③ minReplicas đủ cao để chịu được đỉnh trong lúc chờ scale
```

Điểm ③ đáng nhấn: **autoscaling không thay được việc có đủ capacity nền.** Nó xử lý tăng trưởng, không xử lý đỉnh đột ngột.

Với đỉnh biết trước (khuyến mãi, sự kiện), **scale trước bằng tay hoặc theo lịch** — đừng dựa vào HPA.

### VPA: tài nguyên mỗi pod

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
spec:
  targetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  updatePolicy:
    updateMode: "Off"          # chỉ KHUYẾN NGHỊ, không tự sửa
```

```text
updateMode:
  Off       chỉ gợi ý — DÙNG CÁI NÀY để tìm request đúng
  Initial   áp dụng cho pod MỚI
  Auto      RESTART pod để áp dụng  ← rủi ro
```

**VPA và HPA theo CPU xung đột nhau**: VPA đổi request → utilization đổi → HPA phản ứng → vòng lặp không ổn định. Chỉ dùng cùng nhau khi HPA scale theo metric **khác** CPU/memory.

Cách dùng thực dụng nhất: **VPA ở chế độ `Off`** để lấy khuyến nghị, rồi bạn đặt request bằng tay. Nó giải quyết đúng vấn đề "request đặt bao nhiêu" mà không tạo rủi ro restart.

### Cluster Autoscaler và Karpenter

```text
Pod Pending vì thiếu tài nguyên → thêm NODE
Node dưới ngưỡng sử dụng một thời gian → thu nhỏ (tôn trọng PDB)
```

```text
Điều kiện để scale UP:
  · pod PHẢI có requests — pod BestEffort KHÔNG kích hoạt

Điều kiện để scale DOWN:
  · mọi pod trên node phải DI CHUYỂN ĐƯỢC
  · pod dùng hostPath, không có controller, hoặc bị PDB chặn → NGĂN thu nhỏ
```

Điểm thứ hai là nguồn của chi phí ẩn: một pod không di chuyển được giữ nguyên cả node rỗng.

Karpenter (AWS) khác Cluster Autoscaler ở chỗ nó chọn **loại instance** phù hợp với pod đang Pending thay vì scale một node group cố định — thường nhanh hơn và rẻ hơn.

### Autoscaling phải tính tới dependency

Đây là bài học từ sự cố ở đầu note:

```text
maxReplicas × connection pool per pod  <  max_connections của DB
```

```text
20 pod × 10 connection = 200
PostgreSQL max_connections = 200
+ worker, cron, migration, công cụ admin...
⇒ VƯỢT → mọi thứ lỗi
```

Ba cách xử lý:

```text
① Giới hạn maxReplicas theo khả năng của DB   ← đơn giản nhất, làm ngay
② PgBouncer ở giữa                             → ghép nhiều connection app thành ít
③ Giảm pool size mỗi pod
```

Cùng lý lẽ áp dụng cho: rate limit của API bên ngoài, băng thông, license theo instance. **Scale ứng dụng không scale những thứ nó phụ thuộc.**

Xem [Connection pool](../../03-database/01-postgresql/03-connection-pool.md).

### PDB và autoscaling

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  maxUnavailable: 1
  selector: { matchLabels: { app: api } }
```

Khi Cluster Autoscaler thu nhỏ, nó `drain` node — và PDB đảm bảo không mất quá nhiều pod cùng lúc.

Nhưng PDB quá chặt (`minAvailable` bằng số replica) **chặn hoàn toàn** việc thu nhỏ, và cluster giữ node rỗng vĩnh viễn.

### Scale worker khác scale API

```text
API      metric: request rate, latency
         → scale up nhanh, scale down chậm
         → minReplicas ≥ 2 (khả dụng)

WORKER   metric: ĐỘ DÀI HÀNG ĐỢI hoặc TUỔI job cũ nhất
         → scale được về 0 khi hàng đợi rỗng (KEDA)
         → job dài cần grace period đủ lớn để không bị cắt
```

Với worker I/O-bound (gọi API bên ngoài), thêm pod tăng throughput. Với worker CPU-bound, thêm pod chỉ giúp tới số core khả dụng.

Và một điều dễ quên: **thêm worker không tăng throughput nếu nút thắt ở downstream** (database, API bên thứ ba, rate limit của họ).

## Example

Cấu hình hoàn chỉnh có tính tới dependency:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api }
  minReplicas: 4                    # đủ chịu đỉnh trong lúc chờ scale
  maxReplicas: 15                   # 15 × 10 conn = 150 < max_connections 200
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
    - type: Pods
      pods:
        metric: { name: http_requests_per_second }
        target: { type: AverageValue, averageValue: "100" }
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - { type: Percent, value: 100, periodSeconds: 30 }
        - { type: Pods, value: 4, periodSeconds: 30 }
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - { type: Percent, value: 10, periodSeconds: 60 }
```

Với nhiều metric, HPA tính desired replicas cho **từng** metric và lấy **giá trị lớn nhất** — nên thêm metric chỉ làm nó scale sớm hơn, không muộn hơn.

Kiểm chứng:

```bash
kubectl get hpa api -w
# NAME  REFERENCE       TARGETS           MINPODS MAXPODS REPLICAS
# api   Deployment/api  45%/70%, 60/100   4       15      4

kubectl describe hpa api        # Events cho biết vì sao scale hoặc không

# Load test và quan sát
k6 run --vus 200 --duration 10m load.js &
watch -n5 'kubectl get hpa api; kubectl get pods -l app=api | tail -3'
```

Ba con số cần đo trong load test:

```text
· bao lâu từ khi tải tăng tới khi pod mới READY?
· trong thời gian đó, bao nhiêu request lỗi?
· ở maxReplicas, database có chịu được không?
```

## Prediction

1. `averageUtilization: 70` với CPU request 100m, pod dùng 70m — utilization là bao nhiêu?
2. Request đặt 1000m nhưng pod chỉ dùng 70m — utilization? HPA có scale không?
3. App I/O-bound, CPU 20% nhưng latency cao — HPA theo CPU có scale không?
4. Metric nào đúng hơn cho worker xử lý hàng đợi?
5. Tải tăng đột ngột trong 90 giây, HPA + image 1 GB + app khởi động 60s — HPA có kịp không?
6. `maxReplicas: 40`, mỗi pod 10 connection, `max_connections: 200` — chuyện gì xảy ra khi scale lên 40?
7. Hệ quả với 3 pod ban đầu vốn đang chạy tốt?
8. `scaleDown.stabilizationWindowSeconds: 0` với tải dao động — hiện tượng gì?
9. VPA `updateMode: Auto` cùng HPA theo CPU — chuyện gì xảy ra?
10. Pod không đặt requests, Cluster Autoscaler có thêm node không?
11. Một pod dùng `hostPath` trên node gần rỗng — CA có thu nhỏ node đó không?
12. PDB `minAvailable` bằng số replica, CA muốn thu nhỏ — kết quả?
13. Worker I/O-bound gọi API bên ngoài có rate limit 100 req/s, scale từ 5 lên 50 pod — throughput tăng bao nhiêu?

<details>
<summary>Đáp án</summary>

1. **70%** — tính theo request.
2. **7%** — HPA **không bao giờ scale**. Request sai làm HPA vô dụng.
3. **Không** — CPU thấp trong khi app đang quá tải chờ I/O. Cần metric khác.
4. **Độ dài hàng đợi** (hoặc tuổi job cũ nhất) — phản ánh trực tiếp công việc chưa làm.
5. **Không kịp** — tổng thời gian tới khi pod mới ready thường 1–3 phút.
6. 400 connection > 200 → database **từ chối kết nối**.
7. **Chúng cũng lỗi** — pool của chúng không mở thêm được, và database đang quá tải. Autoscaling biến đợt tăng tải thành sự cố toàn phần.
8. **Flapping** — scale lên rồi xuống liên tục, mỗi lần tạo/xoá pod.
9. Vòng lặp không ổn định: VPA đổi request → utilization đổi → HPA phản ứng → VPA phản ứng.
10. **Không** — CA tính theo requests; pod BestEffort không kích hoạt scale-up.
11. **Không** — pod `hostPath` không di chuyển được, ngăn thu nhỏ. Node rỗng vẫn tốn tiền.
12. Thu nhỏ **bị chặn** — không xoá được pod nào.
13. **Gần như không tăng** — nút thắt là rate limit của API bên ngoài, không phải số worker.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt CPU request gấp 10 lần mức dùng thật, chạy tải | HPA không scale |
| Sửa request cho đúng, lặp lại | HPA scale |
| App I/O-bound, HPA theo CPU, tăng tải | CPU thấp, không scale, latency tăng |
| Đổi sang metric RPS hoặc queue length | Scale đúng |
| Load test với đợt tăng đột ngột, đo thời gian tới pod ready | 1–3 phút |
| Giảm kích thước image, lặp lại | Nhanh hơn |
| Tăng `minReplicas`, lặp lại | Ít lỗi hơn trong đỉnh |
| `maxReplicas × pool > max_connections`, chạy tải cao | Database từ chối kết nối |
| Thêm PgBouncer, lặp lại | Hoạt động |
| `scaleDown.stabilizationWindowSeconds: 0` với tải dao động | Flapping |
| Tăng lên 300 | Ổn định |
| VPA `Auto` + HPA CPU | Dao động |
| Pod không có requests, tạo nhiều để node đầy | CA không thêm node |
| Pod `hostPath` trên node gần rỗng | CA không thu nhỏ được |
| PDB `minAvailable == replicas`, thử `drain` | Bị chặn |

## What Usually Goes Wrong

- **CPU request sai** → HPA hoạt động sai hoàn toàn. Nguyên nhân số một.
- **Scale theo CPU cho app I/O-bound** → không bao giờ kích hoạt.
- **`maxReplicas` không tính tới dependency** → scale làm sập database. Nguy hiểm nhất.
- **Scale up quá chậm** → đỉnh đã qua khi pod sẵn sàng.
- **`minReplicas` quá thấp** → không chịu được đỉnh trong lúc chờ scale.
- **Scale down quá nhanh** → flapping.
- **VPA `Auto` + HPA CPU** → vòng lặp không ổn định.
- **Pod không có requests** → CA không scale up.
- **Pod không di chuyển được** → CA không thu nhỏ, giữ node rỗng.
- **PDB quá chặt** → chặn thu nhỏ hoàn toàn.
- **Scale worker khi nút thắt ở downstream** → thêm pod không tăng throughput.
- **Không load test với autoscaling bật** → không biết hành vi thật.
- **Không có giới hạn chi phí** → một bug làm scale lên 200 pod và hoá đơn tăng vọt.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| HPA tính utilization theo capacity node | Nó tính theo **CPU request** |
| CPU là metric mặc định tốt | Sai cho app I/O-bound |
| Memory là metric tốt để scale | App thường không giải phóng memory → không scale xuống |
| Autoscaling xử lý được đỉnh đột ngột | Nó mất 1–3 phút; đỉnh ngắn thì không kịp |
| Scale up và down nên đối xứng | Up nhanh, down chậm |
| Scale app là đủ | Dependency (DB, API ngoài) không scale theo |
| VPA và HPA dùng chung được | Xung đột khi HPA theo CPU/memory |
| CA scale up cho mọi pod Pending | Chỉ khi pod có requests |
| CA luôn thu nhỏ được node rỗng | Pod không di chuyển được ngăn nó |
| Nhiều metric làm HPA thận trọng hơn | Nó lấy **max** — scale sớm hơn |

## Debugging

1. **HPA không scale** → `kubectl describe hpa api`, đọc **Events** và cột `TARGETS`.
2. **`TARGETS: <unknown>`** → metrics-server không chạy, hoặc pod không có resource requests.
3. **Utilization luôn thấp** → CPU request quá cao. So `kubectl top pod` với request.
4. **Utilization luôn cao** → request quá thấp.
5. **Scale nhưng vẫn chậm** → nút thắt ở downstream (DB, API ngoài), không phải ở số pod.
6. **Pod mới Pending** → CA có chạy không? Pod có requests không? `kubectl describe pod` cho biết lý do.
7. **CA không thu nhỏ** → log của CA cho biết pod nào chặn:
   ```bash
   kubectl -n kube-system logs deploy/cluster-autoscaler | grep -i 'scale.down'
   ```
8. **Flapping** → tăng `scaleDown.stabilizationWindowSeconds`.
9. **Đo trong load test**: thời gian từ tải tăng tới pod ready, số lỗi trong khoảng đó, và trạng thái database ở `maxReplicas`.

## Production Considerations

- **Đặt CPU request đúng TRƯỚC KHI bật HPA** — dùng VPA `updateMode: Off` để lấy khuyến nghị.
- **`maxReplicas` phải tính từ giới hạn của dependency**, không phải từ mong muốn. Viết phép tính ra:
  ```text
  maxReplicas × pool_size + worker + cron + admin  <  max_connections
  ```
- **`minReplicas` đủ để chịu đỉnh** trong 1–3 phút chờ scale — autoscaling không thay được capacity nền.
- **Scale up nhanh, scale down chậm** (`stabilizationWindowSeconds: 300` cho down).
- **Metric phù hợp với loại workload**: RPS/latency cho API, queue length cho worker.
- **KEDA cho worker** — nó scale theo hàng đợi và scale được về 0.
- **PgBouncer** nếu `maxReplicas × pool` vượt khả năng của database.
- **PDB `maxUnavailable: 1`** — bảo vệ khi CA thu nhỏ, nhưng không chặt tới mức chặn hoàn toàn.
- **Load test với autoscaling BẬT** — đây là cách duy nhất biết hành vi thật.
- **Alert khi chạm `maxReplicas`** — nó nghĩa là bạn đã hết dư địa và cần quyết định.
- **Giới hạn chi phí**: `maxReplicas` và giới hạn node của CA là hàng rào cuối cùng chống hoá đơn bất ngờ.
- **Scale trước cho đỉnh biết trước** (khuyến mãi, sự kiện) — đừng dựa vào HPA.
- **Image nhỏ và khởi động nhanh** là tối ưu autoscaling hiệu quả nhất mà không ai nghĩ tới.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| HPA theo CPU | đơn giản, có sẵn | sai cho app I/O-bound |
| HPA theo metric tuỳ chỉnh | phản ánh đúng tải | cần Prometheus adapter / KEDA |
| `minReplicas` cao | chịu đỉnh tốt | tốn tài nguyên lúc thấp điểm |
| `minReplicas` thấp | tiết kiệm | lỗi khi có đỉnh đột ngột |
| Scale up hung hăng | phản ứng nhanh | có thể quá đà, tốn tiền, đập vào DB |
| Scale up thận trọng | ổn định | chậm khi cần |
| Scale down nhanh | tiết kiệm | flapping, đỉnh tiếp theo lại thiếu |
| Scale down chậm | ổn định | giữ pod thừa lâu hơn |
| VPA `Auto` | request luôn đúng | restart pod; xung đột HPA |
| VPA `Off` | an toàn, có khuyến nghị | phải đặt tay |
| Cluster Autoscaler | tiết kiệm node | độ trễ scale-up, phức tạp |
| Node cố định | dự đoán được, nhanh | tốn tiền lúc thấp điểm |
| KEDA scale to zero | tiết kiệm tối đa cho worker | độ trễ cold start cho job đầu tiên |

## Explain Without Notes

1. HPA tính `desiredReplicas` thế nào? `averageUtilization` tính theo cái gì?
2. Vì sao CPU request sai làm HPA vô dụng?
3. Vì sao CPU là metric sai cho app I/O-bound? Dùng gì thay?
4. Vì sao scale up mất 1–3 phút? Ba cách rút ngắn?
5. Nguyên tắc bất đối xứng giữa scale up và scale down?
6. Vì sao autoscaling có thể **gây ra** sự cố? Phép tính nào phải làm trước?
7. Hai điều kiện để Cluster Autoscaler scale up và scale down?
8. Vì sao VPA `Auto` và HPA theo CPU xung đột?

## Related

- [Scheduling & resources](05-scheduling-resources.md) — requests là nền của HPA và CA
- [Rollout & rollback](07-rollout-rollback.md) — PDB, capacity
- [Readiness & liveness](02-health-readiness-liveness.md) — readiness quyết định khi nào pod mới nhận traffic
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — giới hạn thật của `maxReplicas`
- [Caching, queues & jobs](../../02-backend-api/02-nestjs/07-caching-queues-jobs.md) — scale worker theo hàng đợi
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md) — độ dài hàng đợi làm metric
- [Capacity & limits](../../05-cross-cutting/reliability/04-capacity-and-limits.md) — tài nguyên hữu hạn dùng chung
- [Latency & throughput](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — tìm nút thắt thật

## Version / Context

Kubernetes 1.29+. `autoscaling/v2` cho HPA với nhiều metric và `behavior` (từ 1.23). metrics-server bắt buộc cho metric CPU/memory. Metric tuỳ chỉnh cần Prometheus Adapter hoặc KEDA. VPA là add-on riêng. Cluster Autoscaler và Karpenter là hai lựa chọn cho scale node.
