---
level: intermediate
area: infra
prerequisites:
  - 04-why-kubernetes.md
  - ../02-docker/02-container-networking.md
related:
  - 02-health-readiness-liveness.md
  - 06-ingress-service-discovery.md
---

# Pod, Deployment, Service

> Bạn deploy xong, `kubectl get pods` cho thấy 3 pod `Running`. Nhưng gọi Service thì nhận `connection refused`. `kubectl get endpoints api` trả về `<none>`. Ba pod khoẻ mạnh và một Service trỏ vào hư không — vì `selector` của Service ghi `app: api` còn pod có label `app: api-server`.

## Position

```text
Deployment  ──quản lý──▶  ReplicaSet  ──quản lý──▶  Pod  ──chứa──▶  Container
                                                      ▲
Service  ──chọn theo LABEL──────────────────────────┘
```

Ba đối tượng, ba trách nhiệm riêng. Nhầm chúng là nguồn của phần lớn nhầm lẫn ban đầu.

## Problem

Container một mình không đủ để chạy ở production:

```text
· container chết → ai tạo lại?
· cần 3 bản → ai đảm bảo luôn có 3?
· IP thay đổi mỗi lần tạo lại → client gọi vào đâu?
· deploy phiên bản mới → thay thế nào để không downtime?
```

Kubernetes tách bốn câu hỏi này thành bốn đối tượng, mỗi cái làm đúng một việc.

## Mental Model

### Bốn đối tượng, bốn trách nhiệm

```text
POD          đơn vị lên lịch nhỏ nhất; 1+ container DÙNG CHUNG network và volume
             → có IP riêng; TẠM THỜI, không bao giờ tự tạo lại
ReplicaSet   giữ đúng N pod
             → bạn hiếm khi tạo trực tiếp
DEPLOYMENT   quản lý ReplicaSet để làm rolling update và rollback
             → đây là thứ bạn viết
SERVICE      IP ảo ổn định + DNS + load balancing tới pod theo LABEL
             → giải quyết vấn đề "IP pod thay đổi"
```

### Pod: nhiều container dùng chung namespace

```text
Trong một pod:
  · CÙNG network namespace → gọi nhau qua localhost, KHÔNG trùng port
  · CÙNG volume (nếu mount)
  · CÙNG vòng đời — lên lịch cùng nhau, chết cùng nhau
```

Đây chính là `--network=container:<id>` của Docker, có tên khác. Xem [Container networking](../02-docker/02-container-networking.md).

Khi nào cho nhiều container vào một pod:

```text
✓ sidecar        log shipper, proxy của service mesh
✓ init container chạy TRƯỚC, xong mới tới container chính (chờ dependency, chown volume)
✗ api + database → chúng scale khác nhau, có vòng đời khác nhau
```

Quy tắc: **một pod = một thứ có thể scale độc lập.** Nếu hai container luôn phải scale cùng nhau và luôn chạy trên cùng máy, chúng thuộc một pod.

### Pod là tạm thời

```text
Pod bị xoá → KHÔNG tự quay lại (nếu tạo trực tiếp)
Pod của Deployment bị xoá → ReplicaSet tạo pod MỚI, IP KHÁC, TÊN KHÁC
```

Hệ quả: **không bao giờ dùng IP pod trong cấu hình.** Dùng Service.

### Deployment: quản lý ReplicaSet

```text
Deployment (api)
   ├─ ReplicaSet api-7f8b (v2)  → 3 pod    ← đang hoạt động
   └─ ReplicaSet api-5c2a (v1)  → 0 pod    ← giữ lại để rollback
```

Mỗi lần đổi `spec.template`, Deployment tạo **ReplicaSet mới** và giảm dần cái cũ. ReplicaSet cũ được giữ (mặc định 10) để `kubectl rollout undo` hoạt động.

Điểm quan trọng: **chỉ thay đổi trong `spec.template` mới kích hoạt rollout.** Đổi `replicas` chỉ scale, không tạo ReplicaSet mới.

### Service: label selector là hợp đồng

```yaml
apiVersion: v1
kind: Service
metadata: { name: api }
spec:
  selector: { app: api }          # ← khớp với LABEL của pod
  ports:
    - port: 80                    # port của Service
      targetPort: 3000            # port TRONG container
```

```text
Service KHÔNG biết Deployment tồn tại.
Nó chỉ tìm pod có LABEL khớp selector VÀ đang READY.
```

Từ đó ra hai nguồn lỗi:

```text
① selector không khớp label  → endpoints rỗng → connection refused
② pod không READY            → endpoints rỗng → connection refused
```

Cả hai cho **cùng một triệu chứng**, và `kubectl get endpoints` phân biệt chúng trong hai giây:

```bash
kubectl get endpoints api
# <none>                          → không pod nào khớp HOẶC không pod nào ready
kubectl get pods -l app=api       → có pod nào khớp label không?
kubectl get pods -l app=api -o wide  → READY 1/1 hay 0/1?
```

### Bốn loại Service

```text
ClusterIP      (mặc định)  IP ảo nội bộ; chỉ trong cluster
NodePort       mở một port trên MỌI node; thường chỉ dùng để test
LoadBalancer   tạo LB của cloud provider; mỗi Service một LB → TỐN TIỀN
ExternalName   CNAME tới tên ngoài; không có proxy
```

Với nhiều service HTTP, **Ingress** (một LB, routing theo host/path) rẻ và linh hoạt hơn nhiều LoadBalancer Service. Xem [Ingress & service discovery](06-ingress-service-discovery.md).

### Headless Service

```yaml
spec:
  clusterIP: None      # headless
```

```text
Service thường:  DNS → MỘT ClusterIP; kube-proxy phân phối
Headless:        DNS → IP của TỪNG pod
```

Dùng cho: StatefulSet (mỗi pod một danh tính ổn định), và client tự làm load balancing (gRPC — vì gRPC dùng một kết nối HTTP/2 dài, ClusterIP sẽ ghim nó vào một pod duy nhất).

### Label và selector ở khắp nơi

```text
Service        → chọn pod
Deployment     → chọn pod của mình (spec.selector, KHÔNG ĐỔI ĐƯỢC sau khi tạo)
NetworkPolicy  → chọn pod áp dụng
kubectl        → -l app=api
```

Quy ước label chuẩn:

```yaml
labels:
  app.kubernetes.io/name: api
  app.kubernetes.io/instance: api-prod
  app.kubernetes.io/version: "1.4.2"
  app.kubernetes.io/component: backend
  app.kubernetes.io/part-of: myshop
```

Và một điểm dễ vấp: **`spec.selector` của Deployment là bất biến.** Muốn đổi nó phải xoá và tạo lại Deployment — nên chọn label ổn định (đừng đưa `version` vào selector).

### Manifest tối thiểu đúng

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels: { app: api }
spec:
  replicas: 3
  selector:
    matchLabels: { app: api }          # BẤT BIẾN
  strategy:
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  template:
    metadata:
      labels: { app: api }             # PHẢI khớp selector
    spec:
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
      containers:
        - name: api
          image: ghcr.io/org/app@sha256:9f2a...    # digest, không phải tag
          ports:
            - { name: http, containerPort: 3000 }
          env:
            - name: NODE_ENV
              value: production
          envFrom:
            - configMapRef: { name: api-config }
            - secretRef:    { name: api-secrets }
          readinessProbe:
            httpGet: { path: /ready, port: http }
            periodSeconds: 2
            failureThreshold: 1
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 20
            failureThreshold: 3
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - { name: tmp, emptyDir: {} }
---
apiVersion: v1
kind: Service
metadata: { name: api }
spec:
  selector: { app: api }
  ports:
    - { port: 80, targetPort: http }
```

Điểm nhỏ đáng dùng: `targetPort: http` tham chiếu **tên** port thay vì số — đổi port trong container không phải sửa Service.

### `kubectl` cần biết

```bash
kubectl get pods -l app=api -o wide
kubectl get endpoints api                    # ← lệnh chẩn đoán quan trọng nhất
kubectl describe pod <pod>                   # Events ở cuối là phần giá trị nhất
kubectl logs <pod> -f
kubectl logs <pod> --previous                # container đã crash
kubectl exec -it <pod> -- sh
kubectl port-forward svc/api 8080:80         # test Service từ máy bạn
kubectl rollout status deploy/api
kubectl rollout undo deploy/api
kubectl get events --sort-by=.lastTimestamp | tail -20
```

`kubectl describe pod` — phần **Events** ở cuối trả lời phần lớn câu hỏi "vì sao pod không chạy".

## Example

Chẩn đoán "Service không trả về gì":

```bash
# 1. Endpoints — bước quyết định
kubectl get endpoints api
# NAME   ENDPOINTS   AGE
# api    <none>      5m          ← không pod nào được chọn

# 2. Có pod nào khớp label không?
kubectl get pods -l app=api
# No resources found.            ← selector không khớp

kubectl get pods --show-labels
# api-7f8b-x9k2   1/1  Running   app=api-server,...
#                                 ↑ label là "api-server", selector là "api"

# 3. Sửa: cho khớp
kubectl patch svc api -p '{"spec":{"selector":{"app":"api-server"}}}'

# 4. Xác minh
kubectl get endpoints api
# api    10.1.2.3:3000,10.1.2.4:3000,10.1.2.5:3000

# 5. Test từ trong cluster
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://api.default.svc.cluster.local/health
```

Nếu bước 2 cho thấy **có pod nhưng `READY 0/1`**, nguyên nhân khác hẳn: readiness probe fail. Xem [Readiness & liveness](02-health-readiness-liveness.md).

## Prediction

1. `kubectl delete pod` một pod thuộc Deployment — chuyện gì xảy ra?
2. Tạo Pod trực tiếp (không qua Deployment) rồi xoá — chuyện gì xảy ra?
3. Pod được tạo lại — IP có giữ nguyên không? Tên có giữ nguyên không?
4. Service selector `app: api`, pod label `app: api-server` — `get endpoints` trả gì?
5. Pod label đúng nhưng `READY 0/1` — `get endpoints` trả gì?
6. Hai câu trên cho cùng triệu chứng gì ở phía client?
7. Đổi `replicas` từ 3 lên 5 — có tạo ReplicaSet mới không?
8. Đổi `image` trong `spec.template` — có tạo ReplicaSet mới không?
9. Đổi `spec.selector` của Deployment đang chạy — kết quả?
10. Hai container trong một pod, cả hai bind port 8080 — kết quả?
11. Client dùng IP pod trong cấu hình, pod restart — kết quả?
12. gRPC client gọi ClusterIP Service với 3 pod — traffic phân bố thế nào?
13. 10 microservice, mỗi cái một `LoadBalancer` Service trên AWS — hệ quả?

<details>
<summary>Đáp án</summary>

1. ReplicaSet thấy thiếu → **tạo pod mới** ngay. Đây là lý do "xoá pod không dừng được service".
2. Pod **biến mất vĩnh viễn** — không có controller nào quản lý nó.
3. **Cả IP và tên đều mới.** Pod là tạm thời.
4. **`<none>`** — không pod nào khớp selector.
5. **`<none>`** — pod chưa ready thì không được đưa vào endpoints.
6. `connection refused` hoặc timeout — cùng triệu chứng, hai nguyên nhân khác nhau. `get endpoints` + `get pods -l` phân biệt.
7. **Không** — chỉ scale ReplicaSet hiện tại.
8. **Có** — mọi thay đổi trong `spec.template` tạo ReplicaSet mới và kích hoạt rollout.
9. **Bị từ chối** — `spec.selector` bất biến. Phải xoá và tạo lại Deployment.
10. Container thứ hai **không bind được** — cùng network namespace, port đã bị chiếm.
11. Kết nối tới IP cũ **thất bại** — pod mới có IP khác. Phải dùng Service.
12. **Ghim vào một pod** — gRPC dùng một kết nối HTTP/2 dài; ClusterIP cân bằng ở mức kết nối, không phải mức request. Cần headless Service + client-side LB, hoặc service mesh.
13. **10 load balancer của cloud** → chi phí lớn. Dùng một Ingress thay thế.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `kubectl delete pod` của Deployment | Pod mới xuất hiện, IP khác |
| Tạo Pod trực tiếp rồi xoá | Biến mất vĩnh viễn |
| Đổi label của pod cho lệch selector | `endpoints` về `<none>` |
| Làm readiness probe fail | `endpoints` cũng về `<none>` |
| So hai trường hợp trên bằng `get pods -l` | Phân biệt được nguyên nhân |
| Đổi `replicas` và xem `get rs` | Không có ReplicaSet mới |
| Đổi `image` và xem `get rs` | Có ReplicaSet mới |
| Thử đổi `spec.selector` | Bị từ chối |
| Hai container cùng pod cùng port | Container thứ hai fail |
| Hardcode IP pod rồi xoá pod | Kết nối hỏng |
| gRPC qua ClusterIP với 3 pod, đếm request mỗi pod | Lệch hoàn toàn |
| Đổi sang headless + client-side LB | Phân bố đều |
| `kubectl describe pod` khi pod Pending | Events giải thích lý do |

## What Usually Goes Wrong

- **Selector không khớp label** → endpoints rỗng, `connection refused`.
- **Pod không ready** → cùng triệu chứng, nguyên nhân khác.
- **Không đọc `kubectl get endpoints`** → debug sai hướng.
- **Dùng IP pod trong cấu hình** → hỏng sau mỗi lần restart.
- **Tạo Pod trực tiếp thay vì Deployment** → không tự phục hồi.
- **Đưa `version` vào `spec.selector`** → không đổi được sau này (selector bất biến).
- **Nhiều container không liên quan trong một pod** → không scale độc lập được.
- **Trùng port trong cùng pod** → container không start.
- **`LoadBalancer` Service cho mọi service** → chi phí lớn.
- **gRPC qua ClusterIP** → traffic ghim vào một pod.
- **Deploy bằng tag thay vì digest** → không biết chắc phiên bản nào.
- **Không đọc `Events` trong `describe`** → bỏ qua nơi chứa câu trả lời.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Pod tương đương container | Pod là 1+ container dùng chung network và volume |
| Pod ổn định | Pod tạm thời; IP và tên đổi mỗi lần tạo lại |
| Service biết Deployment | Service chỉ biết **label** |
| Pod `Running` nghĩa là nhận được traffic | Cần `READY` — tức là readiness probe pass |
| Xoá pod là cách dừng service | Controller tạo lại ngay |
| Đổi `replicas` gây rollout | Chỉ thay đổi `spec.template` mới gây rollout |
| Đổi selector được như đổi label | `spec.selector` bất biến |
| Nhiều container trong pod là bình thường | Chỉ khi chúng thật sự cùng vòng đời |
| ClusterIP cân bằng theo request | Nó cân bằng theo **kết nối** — vấn đề với gRPC/HTTP2 |
| `LoadBalancer` là cách chuẩn để lộ service | Ingress rẻ và linh hoạt hơn cho HTTP |

## Debugging

Thứ tự cố định cho "Service không trả về gì":

1. **`kubectl get endpoints <svc>`** — `<none>` hay có IP? Đây là bước chia đôi không gian tìm kiếm.
2. **Nếu `<none>`**: `kubectl get pods -l <selector>` — có pod nào khớp không?
   - Không có pod → **selector sai**. So với `kubectl get pods --show-labels`.
   - Có pod nhưng `0/1` → **readiness probe fail**. Xem [Readiness & liveness](02-health-readiness-liveness.md).
3. **Nếu có endpoints nhưng vẫn lỗi**: `targetPort` có khớp port container không? App có bind `0.0.0.0` không?
4. **`kubectl describe pod`** — đọc **Events** ở cuối.
5. **`kubectl logs <pod> --previous`** cho container đã crash — lệnh quan trọng nhất khi CrashLoopBackOff.
6. **Test từ trong cluster**: `kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -v http://api/health`.
7. **`kubectl port-forward svc/api 8080:80`** để test từ máy bạn — nó bỏ qua Ingress và LB, cô lập vấn đề.

## Production Considerations

- **Luôn dùng Deployment, không tạo Pod trực tiếp.**
- **Label nhất quán** theo quy ước `app.kubernetes.io/*`; `spec.selector` chỉ chứa label **ổn định**.
- **Deploy bằng digest**, không bằng tag.
- **Readiness probe cho mọi service** — không có nó, traffic vào pod chưa sẵn sàng.
- **`maxUnavailable: 0`** cho service quan trọng.
- **Resource requests cho mọi container** — scheduler cần chúng.
- **`securityContext` non-root** theo mặc định.
- **PodDisruptionBudget** để nâng cấp node không lấy đi toàn bộ replica:
  ```yaml
  apiVersion: policy/v1
  kind: PodDisruptionBudget
  spec:
    minAvailable: 2
    selector: { matchLabels: { app: api } }
  ```
- **Ingress thay nhiều LoadBalancer Service.**
- **Headless Service + client-side LB cho gRPC**, hoặc dùng service mesh.
- **Namespace theo môi trường hoặc theo team**, với ResourceQuota.
- **Quản lý manifest bằng Kustomize hoặc Helm**, trong git — không `kubectl edit` ở production.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Deployment | tự phục hồi, rolling update | thêm một tầng trừu tượng |
| Pod trực tiếp | đơn giản | không tự phục hồi |
| Một container/pod | scale độc lập, rõ ràng | nhiều pod hơn |
| Nhiều container/pod | chia sẻ network/volume dễ | scale cùng nhau, không trùng port |
| ClusterIP | đơn giản, ổn định | không lộ ra ngoài |
| NodePort | lộ ra ngoài không cần LB | port cao, không có TLS, khó quản lý |
| LoadBalancer | lộ ra ngoài đúng cách | một LB mỗi Service → tốn tiền |
| Ingress | một LB cho nhiều service, routing theo path | thêm một thành phần phải vận hành |
| Headless | client-side LB, danh tính pod | client phải tự cân bằng |
| `maxUnavailable: 0` | không giảm capacity | cần thừa tài nguyên |

## Explain Without Notes

1. Bốn đối tượng và trách nhiệm của mỗi cái?
2. Vì sao pod là tạm thời, và hệ quả với cấu hình?
3. Service tìm pod bằng cách nào? Nó có biết Deployment không?
4. Hai nguyên nhân làm `endpoints` rỗng, và cách phân biệt?
5. Thay đổi nào gây rollout, thay đổi nào không?
6. Khi nào cho nhiều container vào một pod?
7. Vì sao gRPC qua ClusterIP phân bố lệch?
8. Ba lệnh đầu tiên khi Service không trả về gì?

## Related

- [Vì sao cần Kubernetes](04-why-kubernetes.md) — đọc trước
- [Readiness & liveness](02-health-readiness-liveness.md) — vì sao pod không ready
- [Config, secrets & resources](03-config-secrets-resources.md) — ConfigMap, Secret, requests/limits
- [Ingress & service discovery](06-ingress-service-discovery.md) — lộ service ra ngoài
- [Rollout & rollback](07-rollout-rollback.md) — ReplicaSet và rolling update
- [Debugging Kubernetes](10-debugging-k8s.md) — quy trình đầy đủ
- [Container networking](../02-docker/02-container-networking.md) — pod = network namespace chung
- [Reverse proxy & load balancer](../01-networking/05-reverse-proxy-load-balancer.md) — Service là một LB

## Version / Context

Kubernetes 1.29+. `apiVersion: apps/v1` cho Deployment, `v1` cho Service, `policy/v1` cho PodDisruptionBudget. `kubectl get endpoints` vẫn dùng được; EndpointSlice (`kubectl get endpointslices`) là API hiện đại hơn cho cluster lớn.
