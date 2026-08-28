---
level: intermediate
area: infra
prerequisites:
  - 02-health-readiness-liveness.md
  - 05-scheduling-resources.md
related:
  - ../03-cicd/03-deployment-strategies.md
  - ../../02-backend-api/01-nodejs/05-graceful-shutdown.md
---

# Rollout & rollback

> `kubectl rollout status` báo thành công sau 40 giây. Nhưng biểu đồ lỗi có một cái gai: khoảng 300 lỗi `502` trong 8 giây. Cấu hình `maxUnavailable: 0`, graceful shutdown đã viết, readiness probe đã có. Vấn đề nằm ở một con số: `readinessProbe.periodSeconds: 10`. Trong 10 giây giữa lúc pod báo not-ready và lúc kubelet phát hiện, Service vẫn gửi traffic tới nó.

## Position

```text
Deployment  ──tạo──▶  ReplicaSet mới  ──scale up──▶  pod mới READY
                          ↓                              ↓
                    ReplicaSet cũ  ◀──scale down── pod cũ SIGTERM
```

## Problem

Rolling update trông đơn giản, nhưng nó có **năm điểm có thể mất request**:

```text
① Pod mới nhận traffic trước khi sẵn sàng     → thiếu readiness probe
② Pod cũ bị rút traffic quá muộn              → readiness period dài
③ Pod cũ đóng listener trước khi LB cập nhật  → thiếu delay trong shutdown
④ Pod cũ bị SIGKILL giữa chừng                → grace period quá ngắn
⑤ Hai phiên bản không tương thích             → API/schema/payload
```

Bốn điểm đầu là vấn đề **thời gian**; điểm thứ năm là vấn đề **thiết kế**. Cả năm đều phải giải quyết để rollout thật sự không mất request.

## Mental Model

### Deployment quản lý ReplicaSet

```text
Deployment api
   ├─ ReplicaSet api-7f8b (v2)  desired 3, ready 3   ← đang hoạt động
   ├─ ReplicaSet api-5c2a (v1)  desired 0            ← giữ để rollback
   └─ ReplicaSet api-3a1f (v0)  desired 0
```

Mỗi thay đổi trong `spec.template` tạo **ReplicaSet mới**. `revisionHistoryLimit` (mặc định 10) quyết định giữ bao nhiêu cái cũ.

```text
Đổi image / env / resources / probe  → ReplicaSet MỚI → rollout
Đổi replicas                          → chỉ scale, KHÔNG rollout
```

### `maxUnavailable` và `maxSurge`

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0     # không bao giờ giảm capacity
    maxSurge: 1           # thêm tối đa 1 pod trong lúc rollout
```

```text
maxUnavailable: 0, maxSurge: 1, replicas: 3

[v1][v1][v1]
[v1][v1][v1][v2]      ← thêm v2 (surge)
   chờ v2 READY
[v1][v1][v2]          ← rút một v1
[v1][v1][v2][v2]
   ...
[v2][v2][v2]

⇒ luôn có ≥3 pod ready. Chậm hơn nhưng không giảm capacity.
```

```text
maxUnavailable: 1, maxSurge: 1  → nhanh hơn, có lúc chỉ 2/3 pod phục vụ
maxUnavailable: 25%, maxSurge: 25%  (mặc định) → cân bằng
```

Với service quan trọng: `maxUnavailable: 0`. Nó cần thừa capacity cho `maxSurge` pod, và đó là cái giá hợp lý.

### Readiness quyết định tốc độ rollout

```text
Deployment CHỜ pod mới READY rồi mới rút pod cũ.
"Ready" nghĩa là readiness probe pass.

⇒ probe sai làm rollout treo hoặc làm rollout "thành công" trong khi app chưa sẵn sàng
```

Ba tình huống:

```text
readiness quá dễ (trả 200 luôn)  → rollout nhanh, nhưng traffic vào app chưa sẵn sàng
readiness quá chậm (period 30s)  → rollout rất chậm; và pod cũ bị rút muộn → 502
readiness không bao giờ pass     → rollout TREO tới progressDeadlineSeconds
```

### Chuỗi shutdown và cửa sổ 502

Đây là cơ chế đằng sau ví dụ ở đầu note:

```text
t=0     kubelet gửi SIGTERM  ┐
t=0     bắt đầu xoá pod khỏi endpoints  ┘ SONG SONG, không tuần tự
t=0.05  app đóng listener NGAY
t=0..X  kube-proxy trên MỖI node cập nhật iptables/IPVS (mất thời gian)
        LB bên ngoài cập nhật (mất thời gian)
t=0.2   traffic VẪN tới pod đã đóng cổng → 502
```

Cách sửa gồm ba phần, và cần cả ba:

```text
① readiness trả 503 NGAY khi nhận SIGTERM
② app CHỜ 3–5 giây trước khi đóng listener
③ readinessProbe.periodSeconds NGẮN (2s) + failureThreshold: 1
```

Phần ③ là phần bị thiếu trong ví dụ mở đầu: với `periodSeconds: 10`, kubelet mất tới 10 giây mới biết pod không còn ready — và trong 10 giây đó, endpoints vẫn chứa nó.

Chi tiết implementation: [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md).

### `terminationGracePeriodSeconds`

```yaml
spec:
  terminationGracePeriodSeconds: 45
```

```text
t=0      preStop hook (nếu có) → rồi SIGTERM
t=grace  SIGKILL nếu chưa exit → exit 137, mất request đang xử lý

⇒ grace period > preStop + delay + drain + đóng dependency + biên an toàn
```

`preStop` hook là cách tạo delay mà không sửa code:

```yaml
lifecycle:
  preStop:
    exec: { command: ["sh", "-c", "sleep 5"] }
```

Nhưng nhớ: **`preStop` chạy TRONG grace period.** `preStop: sleep 30` với `terminationGracePeriodSeconds: 30` cho app **0 giây** để dọn dẹp.

### `progressDeadlineSeconds`: rollout treo

```yaml
spec:
  progressDeadlineSeconds: 600      # mặc định
```

Nếu không có tiến triển trong khoảng này, Deployment bị đánh dấu `Progressing=False` với lý do `ProgressDeadlineExceeded`.

Điểm quan trọng: **Kubernetes KHÔNG tự rollback.** Nó chỉ dừng và báo. Rollback tự động phải do CI/CD hoặc công cụ như Argo Rollouts làm:

```bash
kubectl rollout status deploy/api --timeout=5m || kubectl rollout undo deploy/api
```

### Rollback

```bash
kubectl rollout history deploy/api
kubectl rollout undo deploy/api                    # về revision trước
kubectl rollout undo deploy/api --to-revision=3
```

```text
Rollback = scale ReplicaSet CŨ lên, scale cái mới xuống
   → nhanh (image đã có trên node)
   → nhưng chỉ hoạt động nếu ReplicaSet cũ còn trong revisionHistoryLimit
```

Ba điều làm rollback **không** khả thi:

```text
① revisionHistoryLimit quá nhỏ → ReplicaSet cũ đã bị xoá
② image cũ đã bị xoá khỏi registry
③ MIGRATION không tương thích ngược → code cũ không chạy được với schema mới
```

Điểm ③ là ràng buộc nghiêm ngặt nhất, và nó quyết định bạn có phương án rollback hay không. Xem [Migrations](../../03-database/03-data-modeling/04-migrations.md).

### PodDisruptionBudget và rollout

```text
PDB áp dụng cho VOLUNTARY disruption (drain, nâng cấp node)
Rolling update KHÔNG bị PDB chặn — Deployment controller tự quản lý
```

Nhưng PDB vẫn quan trọng: nếu cluster autoscaler hoặc nâng cấp node xảy ra **trong lúc** rollout, PDB ngăn việc mất quá nhiều pod cùng lúc.

Cảnh báo đã nêu: `minAvailable` bằng số replica làm `drain` bị chặn vĩnh viễn.

### Hai phiên bản chạy song song

```text
Trong cửa sổ rollout: v1 và v2 CÙNG phục vụ traffic

⇒ API phải tương thích ngược       (client cũ gọi server mới, và ngược lại)
⇒ Schema phải tương thích ngược    (code cũ chạy với schema mới)
⇒ Job payload phải version hoá     (job cũ trong hàng đợi, worker mới xử lý)
⇒ Cache key phải version hoá       (hai phiên bản đọc cùng cache)
```

Bốn ràng buộc này không phải chi tiết vận hành — chúng là **ràng buộc thiết kế cho mọi thay đổi**.

Ràng buộc thứ tư hay bị quên: nếu v2 đổi hình dạng object được cache, v1 đọc phải object đó sẽ lỗi. Thêm version vào cache key (`v2:project:...`) giải quyết điều này.

### Kết nối dài

```text
WebSocket, gRPC stream, SSE
   → rolling update NGẮT mọi kết nối trên pod bị thay thế
   → client phải reconnect với backoff + JITTER
   → không có jitter: 10.000 client reconnect cùng lúc → bão
```

Xem [WebSocket gateway](../../02-backend-api/02-nestjs/08-websocket-gateway.md).

## Example

Cấu hình đầy đủ cho rollout không mất request:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  revisionHistoryLimit: 10
  progressDeadlineSeconds: 300
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: api
          image: ghcr.io/org/app@sha256:9f2a...
          lifecycle:
            preStop:
              exec: { command: ["sh", "-c", "sleep 5"] }   # ② delay
          readinessProbe:
            httpGet: { path: /ready, port: http }
            periodSeconds: 2                                # ③ phát hiện nhanh
            failureThreshold: 1
          livenessProbe:
            httpGet: { path: /health, port: http }          # KHÔNG phản ánh shutdown
            periodSeconds: 20
            failureThreshold: 3
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: api-pdb }
spec:
  maxUnavailable: 1
  selector: { matchLabels: { app: api } }
```

Và quy trình deploy có kiểm chứng:

```bash
kubectl set image deploy/api api=ghcr.io/org/app@sha256:new...
kubectl rollout status deploy/api --timeout=5m || {
  kubectl rollout undo deploy/api
  kubectl rollout status deploy/api --timeout=5m
  exit 1
}
./scripts/smoke-test.sh https://api.example.com
```

Đo kết quả — đây là bước duy nhất chứng minh cấu hình đúng:

```bash
k6 run --vus 50 --duration 5m load.js &        # tải ổn định
sleep 30
kubectl rollout restart deploy/api
wait
# số lỗi trong cửa sổ rollout phải là 0
```

"Trông có vẻ ổn" không phải bằng chứng. Con số lỗi mới là.

## Prediction

1. `maxUnavailable: 0, maxSurge: 1`, 3 replica — tối thiểu bao nhiêu pod ready trong lúc rollout?
2. `maxUnavailable: 1, maxSurge: 0` — tối thiểu bao nhiêu?
3. Không có readiness probe — Deployment coi pod ready khi nào?
4. Hệ quả với traffic?
5. `readinessProbe.periodSeconds: 10`, pod nhận SIGTERM — bao lâu để bị rút khỏi endpoints?
6. Giảm xuống 2 với `failureThreshold: 1` — bao lâu?
7. App đóng listener ngay khi SIGTERM, không delay — client thấy gì?
8. `preStop: sleep 30` với `terminationGracePeriodSeconds: 30` — app có bao nhiêu giây dọn dẹp?
9. Shutdown mất 60 giây, grace period 30 — exit code?
10. Readiness probe không bao giờ pass — rollout thế nào? Kubernetes có tự rollback không?
11. `revisionHistoryLimit: 2`, rollout 5 lần, muốn về revision 1 — được không?
12. Rollback code sau khi migration đã `DROP COLUMN` — được không?
13. v2 đổi hình dạng object cache, v1 đọc phải nó — kết quả?

<details>
<summary>Đáp án</summary>

1. **3** — không bao giờ giảm dưới số replica mong muốn.
2. **2** — cho phép một pod không sẵn sàng, không thêm pod mới.
3. Ngay khi **container start** — không có tín hiệu nào khác.
4. Traffic vào pod chưa khởi động xong → lỗi trong cửa sổ rollout.
5. Tới **10 giây** — và trong thời gian đó Service vẫn gửi traffic tới nó → 502.
6. Tới **2 giây** — giảm mạnh cửa sổ 502.
7. **502** trong khoảng LB/kube-proxy chưa cập nhật (thường 0,5–2 giây).
8. **0 giây** — `preStop` ăn hết grace period; SIGTERM vừa gửi thì SIGKILL tới.
9. **137** — SIGKILL ở giây 30, mất request đang xử lý.
10. Rollout **treo** tới `progressDeadlineSeconds` rồi báo `ProgressDeadlineExceeded`. Kubernetes **không tự rollback**.
11. **Không** — chỉ giữ 2 revision gần nhất.
12. **Không** — cột không còn tồn tại.
13. v1 lỗi khi parse object — đây là lý do cache key phải có version.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy tải ổn định rồi `rollout restart`, đếm lỗi | Baseline |
| Bỏ readiness probe, lặp lại | Lỗi tăng |
| `readinessProbe.periodSeconds: 30`, lặp lại | 502 kéo dài |
| Giảm xuống 2 với `failureThreshold: 1` | Giảm mạnh |
| Bỏ delay trong shutdown (đóng listener ngay) | 502 xuất hiện |
| Thêm `preStop: sleep 5` | Về 0 |
| `preStop: sleep 30` với grace 30 | Exit 137 |
| `terminationGracePeriodSeconds: 5` với shutdown 20s | Exit 137, request bị cắt |
| Deploy image không tồn tại | Rollout treo; `describe` cho biết `ImagePullBackOff` |
| Deploy app có readiness không bao giờ pass | Treo tới `progressDeadlineSeconds` |
| `rollout undo` sau đó | Về phiên bản cũ nhanh |
| `revisionHistoryLimit: 1`, rollout 3 lần, thử undo 2 lần | Không được |
| Deploy v2 đổi cache format, quan sát v1 trong cửa sổ rollout | v1 lỗi |
| Rolling update với WebSocket đang mở | Kết nối đứt |

## What Usually Goes Wrong

- **Không có readiness probe** → traffic vào pod chưa sẵn sàng.
- **`readinessProbe.periodSeconds` dài** → pod cũ bị rút muộn → 502.
- **Đóng listener ngay khi SIGTERM** → 502 vì LB chưa cập nhật.
- **`preStop` ăn hết grace period** → app không có thời gian dọn dẹp.
- **Grace period ngắn hơn thời gian shutdown** → exit 137, mất request.
- **Liveness phản ánh shutdown** → SIGKILL ngay, cắt ngắn graceful shutdown.
- **API/schema/payload/cache không tương thích ngược** → lỗi trong cửa sổ rollout.
- **Tưởng Kubernetes tự rollback** → rollout treo và không ai biết.
- **`revisionHistoryLimit` quá nhỏ** → không rollback xa được.
- **Migration không tương thích ngược** → rollback bất khả thi.
- **Không đếm lỗi trong cửa sổ deploy** → không biết cấu hình có đúng không.
- **PDB `minAvailable` bằng số replica** → chặn bảo trì node.
- **Kết nối dài không có jitter khi reconnect** → bão reconnect sau mỗi rollout.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `maxUnavailable: 0` là đủ để không mất request | Còn cần readiness nhanh + delay trong shutdown |
| Kubernetes tự rollback khi rollout fail | Nó chỉ dừng và báo `ProgressDeadlineExceeded` |
| `rollout status` thành công = không có lỗi | Nó chỉ nói pod đã ready, không nói người dùng không gặp lỗi |
| Endpoint được xoá trước khi gửi SIGTERM | Hai việc **song song** |
| `server.close()` là đủ | Cần readiness=false + delay trước |
| `preStop` chạy ngoài grace period | Nó nằm **trong** grace period |
| PDB chặn rolling update | Deployment controller tự quản; PDB cho voluntary disruption |
| Rollback luôn khả thi | Cần ReplicaSet cũ + image cũ + migration tương thích |
| Đổi `replicas` gây rollout | Chỉ thay đổi `spec.template` mới gây |
| Rolling update giữ kết nối WebSocket | Nó ngắt mọi kết nối trên pod bị thay |

## Debugging

1. **Rollout treo** → `kubectl rollout status deploy/api` rồi `kubectl describe deploy api` (phần Conditions).
2. **Pod mới không ready** → `kubectl get pods -l app=api`; `kubectl describe pod <new>` → Events.
3. **`ImagePullBackOff`** → sai digest, thiếu imagePullSecret, hoặc registry không tới được.
4. **`CrashLoopBackOff`** → `kubectl logs <pod> --previous`.
5. **Lỗi trong cửa sổ rollout** → đây là câu hỏi phân loại: lỗi **chỉ** trong cửa sổ (vấn đề shutdown/readiness) hay **kéo dài sau đó** (bug của v2)?
6. **502 khi deploy** → kiểm tra theo thứ tự: readiness `periodSeconds`, delay trong shutdown, `keepAliveTimeout` của app so với idle timeout của LB.
7. **Đo lỗi thật**: chạy tải ổn định rồi `rollout restart`, đếm. Đây là bằng chứng duy nhất.
8. **Xem lịch sử**: `kubectl rollout history deploy/api --revision=3`.

## Production Considerations

- **`maxUnavailable: 0`** cho service quan trọng, và chuẩn bị thừa capacity cho `maxSurge`.
- **Readiness probe nhanh** (`periodSeconds: 2`, `failureThreshold: 1`) — nó quyết định độ rộng cửa sổ 502.
- **Delay 3–5 giây trong shutdown** (trong code hoặc `preStop`).
- **`terminationGracePeriodSeconds` > preStop + delay + drain + đóng dependency + biên.**
- **Liveness không phản ánh shutdown.**
- **Rollback tự động trong pipeline**: `rollout status || rollout undo`.
- **Smoke test sau rollout**, gồm một thao tác ghi.
- **Đo số lỗi trong cửa sổ deploy như một metric**, mục tiêu 0.
- **Mọi thay đổi tương thích ngược** — API, schema, job payload, cache key.
- **`revisionHistoryLimit` ≥ 5** để rollback xa được.
- **PDB với `maxUnavailable: 1`** — bảo vệ khi nâng cấp node xảy ra đồng thời.
- **Kết nối dài cần reconnect có jitter** ở phía client.
- **Deploy thường xuyên, ít thay đổi mỗi lần** — nó giảm rủi ro hơn mọi chiến lược phức tạp.
- **Canary cho thay đổi rủi ro cao** (Argo Rollouts, Flagger). Xem [Deployment strategies](../03-cicd/03-deployment-strategies.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `maxUnavailable: 0` | không giảm capacity | cần thừa tài nguyên, rollout chậm hơn |
| `maxUnavailable: 25%` | rollout nhanh | giảm capacity tạm thời |
| `maxSurge` lớn | rollout nhanh | tốn tài nguyên đỉnh |
| Readiness period ngắn | ít 502 | nhiều probe hơn |
| Readiness period dài | ít tải | 502 khi deploy |
| Grace period dài | mọi request kịp xong | rollout chậm (× số pod) |
| Grace period ngắn | rollout nhanh | cắt request đang xử lý |
| `preStop` hook | không sửa code | chia logic shutdown hai chỗ; ăn grace period |
| Delay trong code | một chỗ, kiểm soát tốt | phải viết và bảo trì |
| `revisionHistoryLimit` cao | rollback xa | nhiều ReplicaSet trong etcd |
| Rollback tự động | phục hồi nhanh | có thể rollback vì lỗi thoáng qua |
| Canary | giới hạn thiệt hại | cần công cụ và metric tốt |

## Explain Without Notes

1. Năm điểm có thể mất request trong một rolling update?
2. `maxUnavailable` và `maxSurge` — mỗi cái kiểm soát gì?
3. Vì sao readiness probe quyết định tốc độ rollout **và** độ rộng cửa sổ 502?
4. Chuỗi shutdown: vì sao cần delay trước khi đóng listener?
5. `preStop` chạy khi nào so với SIGTERM, và nó ảnh hưởng grace period thế nào?
6. Kubernetes làm gì khi rollout không tiến triển? Nó có tự rollback không?
7. Ba điều làm rollback không khả thi?
8. Bốn thứ phải tương thích ngược khi có hai phiên bản chạy song song?

## Related

- [Readiness & liveness](02-health-readiness-liveness.md) — probe quyết định rollout
- [Pod, Deployment, Service](01-pod-deployment-service.md) — ReplicaSet
- [Scheduling & resources](05-scheduling-resources.md) — PDB, capacity cho maxSurge
- [Debugging Kubernetes](10-debugging-k8s.md) — rollout treo
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — chuỗi shutdown đầy đủ
- [Signals & lifecycle](../00-linux/04-signals-lifecycle.md) — SIGTERM, exit code
- [Deployment strategies](../03-cicd/03-deployment-strategies.md) — canary, blue-green
- [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md) — deploy bằng digest
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — điều kiện rollback
- [WebSocket gateway](../../02-backend-api/02-nestjs/08-websocket-gateway.md) — kết nối dài

## Version / Context

Kubernetes 1.29+. `progressDeadlineSeconds` mặc định 600; `revisionHistoryLimit` mặc định 10; `terminationGracePeriodSeconds` mặc định 30. `maxUnavailable`/`maxSurge` mặc định 25%. Canary và blue-green cần Argo Rollouts, Flagger, hoặc service mesh.
