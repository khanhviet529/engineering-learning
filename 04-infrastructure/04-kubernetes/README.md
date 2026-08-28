---
level: advanced
area: infra
---

# Kubernetes

Kubernetes là **một vòng lặp điều hoà**:

```text
Bạn khai báo TRẠNG THÁI MONG MUỐN
Controller chạy vòng lặp vô hạn: thực tế ≠ mong muốn → hành động
```

Một câu đó giải thích gần như mọi hành vi: vì sao xoá pod không có tác dụng, vì sao đổi image gây rolling update, vì sao node chết thì pod xuất hiện ở nơi khác.

**Đọc [Vì sao cần Kubernetes](04-why-kubernetes.md) trước.** Học K8s trước khi gặp vấn đề mà nó giải quyết là cách nhanh nhất để thuộc YAML mà không hiểu gì.

## Điều kiện tiên quyết

Cần hiểu ở mức **tự debug được**, không phải mức "đã đọc qua":

```text
① process, PID 1, signal, exit code      → 00-linux/01, 04
② port, socket, bind interface            → 00-linux/05
③ filesystem, UID, quyền                  → 00-linux/03
④ memory/CPU limit, cgroup, OOMKilled     → 00-linux/02
⑤ image, layer, volume, container network → 02-docker
⑥ DNS, TCP, reverse proxy, timeout        → 01-networking
⑦ đã tự gặp giới hạn của Compose          → 02-docker/06
```

Gần như mọi lỗi Kubernetes là một trong bảy cơ chế trên rò rỉ qua nhiều lớp trừu tượng.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0 | [Vì sao cần Kubernetes](04-why-kubernetes.md) | Compose thiếu gì? Bạn có cần K8s không? |
| 1 | [Pod, Deployment, Service](01-pod-deployment-service.md)| Vì sao Service trả 404 dù 3 pod đều Running? |
| 2 | [Readiness & liveness](02-health-readiness-liveness.md) | Vì sao DB chậm 90 giây làm restart toàn bộ pod? |
| 3 | [Config, Secret & resources](03-config-secrets-resources.md) | Secret có được mã hoá không? Request khác limit thế nào? |
| 4 | [Scheduling & resources](05-scheduling-resources.md) | Vì sao pod Pending dù node rảnh 70%? |
| 5 | [Ingress & service discovery](06-ingress-service-discovery.md) | Vì sao Ingress trả 404 khi Service ở namespace khác? |
| 6 | [Rollout & rollback](07-rollout-rollback.md) | Vì sao mỗi lần deploy có 300 lỗi 502? |
| 7 | [Storage & StatefulSet](08-storage-statefulset.md) | Vì sao hai pod ghi cùng volume làm hỏng database? |
| 8 | [Autoscaling](09-autoscaling.md) | Vì sao HPA làm sập database? |
| 9 | [Debugging Kubernetes](10-debugging-k8s.md) | CrashLoopBackOff, log rỗng — bắt đầu từ đâu? |

Note 9 là note bạn sẽ mở lại nhiều nhất.

## Bốn câu hỏi khi có sự cố

```text
① Pod có ĐƯỢC TẠO không?      → Deployment / ReplicaSet / quota / admission
② Pod có ĐƯỢC LÊN LỊCH không?  → resources, taint, affinity, volume
③ Container có CHẠY không?     → image, config, crash, probe
④ Traffic có TỚI được không?   → endpoints, Ingress, DNS, NetworkPolicy
```

Dừng ở câu đầu tiên trả lời "không".

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| `Pending` dù node rảnh | scheduler dùng **requests**, không phải usage | [4](05-scheduling-resources.md) |
| `Pending` + `volume node affinity conflict` | volume ở zone khác | [7](08-storage-statefulset.md) |
| `ImagePullBackOff` | sai digest, thiếu pull secret | [9](10-debugging-k8s.md) |
| `CrashLoopBackOff`, log rỗng | dùng `logs --previous`; nghi lỗi config | [9](10-debugging-k8s.md) |
| Exit 137 + `OOMKilled` | vượt memory limit | [3](03-config-secrets-resources.md) |
| Exit 137 + `Error` | liveness giết, hoặc hết grace period | [2](02-health-readiness-liveness.md) |
| `Running 0/1` | readiness probe fail | [2](02-health-readiness-liveness.md) |
| Mọi pod restart khi DB chậm | liveness kiểm tra dependency | [2](02-health-readiness-liveness.md) |
| `endpoints` rỗng, pod `1/1` | selector không khớp label | [1](01-pod-deployment-service.md) |
| `endpoints` rỗng, pod `0/1` | pod chưa ready | [2](02-health-readiness-liveness.md) |
| Ingress 404 | Ingress và Service khác namespace | [5](06-ingress-service-discovery.md) |
| 502 mỗi lần deploy | readiness period dài, thiếu delay khi shutdown | [6](07-rollout-rollback.md) |
| Rollout treo | readiness không pass; K8s **không** tự rollback | [6](07-rollout-rollback.md) |
| gRPC dồn vào một pod | ClusterIP cân bằng theo **kết nối** | [5](06-ingress-service-discovery.md) |
| Pod không phân giải được tên nào | NetworkPolicy chặn DNS | [5](06-ingress-service-discovery.md) |
| Pod thứ hai `Pending` với PVC | `ReadWriteOnce` = một **node** | [7](08-storage-statefulset.md) |
| HPA không scale | CPU request sai, hoặc metric sai loại | [8](09-autoscaling.md) |
| Scale lên làm database chết | `maxReplicas × pool > max_connections` | [8](09-autoscaling.md) |
| Cluster không thu nhỏ | pod không di chuyển được, hoặc PDB chặn | [4](05-scheduling-resources.md) |

## Manifest tham chiếu

Mười lăm quyết định, mỗi cái chặn một lớp lỗi:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  revisionHistoryLimit: 10                             # ① rollback xa được
  progressDeadlineSeconds: 300
  strategy:
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }  # ② không giảm capacity
  selector: { matchLabels: { app: api } }              # ③ label ỔN ĐỊNH (bất biến)
  template:
    metadata: { labels: { app: api } }
    spec:
      terminationGracePeriodSeconds: 45                # ④ > delay + drain
      topologySpreadConstraints:                       # ⑤ chịu được mất node/zone
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector: { matchLabels: { app: api } }
      securityContext:
        runAsNonRoot: true                             # ⑥
        runAsUser: 1001
        fsGroup: 1001
      containers:
        - name: api
          image: ghcr.io/org/app@sha256:9f2a...        # ⑦ DIGEST, không phải tag
          ports: [{ name: http, containerPort: 3000 }]
          envFrom:
            - configMapRef: { name: api-config }       # ⑧ config qua env
          env:
            - name: MEMORY_LIMIT_BYTES                 # ⑨ app biết limit thật
              valueFrom: { resourceFieldRef: { resource: limits.memory } }
          volumeMounts:
            - { name: secrets, mountPath: /etc/secrets, readOnly: true }  # ⑩ secret qua FILE
            - { name: tmp, mountPath: /tmp }
          lifecycle:
            preStop:
              exec: { command: ["sh", "-c", "sleep 5"] }   # ⑪ chống 502 khi deploy
          readinessProbe:                              # ⑫ NHẠY
            httpGet: { path: /ready, port: http }
            periodSeconds: 2
            failureThreshold: 1
          livenessProbe:                               # ⑬ CHẬM, KHÔNG chạm dependency
            httpGet: { path: /health, port: http }
            periodSeconds: 20
            failureThreshold: 3
          startupProbe:                                # ⑭ cho app khởi động chậm
            httpGet: { path: /health, port: http }
            periodSeconds: 5
            failureThreshold: 20
          resources:
            requests: { cpu: 100m, memory: 256Mi }     # ⑮ scheduler + HPA cần
            limits:   { memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
            seccompProfile: { type: RuntimeDefault }
      volumes:
        - { name: secrets, secret: { secretName: api-secrets, defaultMode: 0400 } }
        - { name: tmp, emptyDir: {} }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: api-pdb }
spec:
  maxUnavailable: 1                                    # bảo vệ khi bảo trì node
  selector: { matchLabels: { app: api } }
```

## Năm nguyên tắc

```text
① LIVENESS KHÔNG CHẠM DEPENDENCY
   Restart không sửa được database chậm — nó làm mọi thứ tệ hơn.
   Câu hỏi: "restart có sửa được không?" Có → liveness. Không → readiness.

② SCHEDULER DÙNG REQUESTS, KHÔNG DÙNG USAGE
   `kubectl top` và `describe node` cho hai con số khác nhau.
   Khoảng cách giữa chúng là mức lãng phí của cluster.

③ MỌI THAY ĐỔI PHẢI TƯƠNG THÍCH NGƯỢC
   Trong cửa sổ rollout có hai phiên bản: API, schema, job payload, cache key.
   Đây cũng là điều kiện để rollback khả thi.

④ SCALE APP KHÔNG SCALE DEPENDENCY
   maxReplicas × pool_size < max_connections. Viết phép tính ra.

⑤ KUBERNETES KHÔNG LÀM APP CỦA BẠN ĐÁNG TIN CẬY
   Probe sai + không resource limit + không PDB
   = kém tin cậy hơn một VPS được cấu hình cẩn thận.
```

## Mười lệnh

```bash
kubectl get pods -A --field-selector status.phase!=Running
kubectl describe pod <pod> | tail -25          # Events ở CUỐI
kubectl logs <pod> --previous                  # container đã crash
kubectl get endpoints <svc>                    # chia đôi không gian tìm kiếm
kubectl get events --sort-by=.lastTimestamp -A | tail -30
kubectl describe node <node> | grep -A8 'Allocated resources'
kubectl rollout status deploy/api --timeout=5m || kubectl rollout undo deploy/api
kubectl port-forward svc/api 8080:80           # bỏ qua Ingress/LB
kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>
kubectl auth can-i <verb> <res> --as=system:serviceaccount:<ns>:<sa>
```

## Position

```text
Linux (namespace, cgroup) → Docker → Compose (một máy) → KUBERNETES (cụm)
                                                          ↑ folder này
```

## Related

- [00-linux/](../00-linux/README.md) · [01-networking/](../01-networking/README.md) · [02-docker/](../02-docker/README.md) — điều kiện tiên quyết
- [03-cicd/](../03-cicd/README.md) — artifact và chiến lược deploy
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — điều kiện để rollout không mất request
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — validate config lúc khởi động
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — giới hạn thật của autoscaling
- [Observability](../../05-cross-cutting/observability/README.md) — quan sát trước khi cần
- [Reliability](../../05-cross-cutting/reliability/README.md) — probe, PDB, degradation
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi thực hành

## Version / Context

Kubernetes 1.29+. `autoscaling/v2` cho HPA; `policy/v1` cho PDB; `networking.k8s.io/v1` cho Ingress và NetworkPolicy. `ReadWriteOncePod` GA từ 1.29; `kubectl debug` ổn định từ 1.25; Gateway API GA (v1.1) là hướng thay thế Ingress. NetworkPolicy cần CNI hỗ trợ.
