---
level: intermediate
area: infra
prerequisites:
  - 01-pod-deployment-service.md
related:
  - 05-scheduling-resources.md
  - ../../02-backend-api/04-architecture/05-configuration.md
  - ../../05-cross-cutting/security/06-secrets-management.md
---

# Config, Secret & resources

> Team dùng GitOps: mọi manifest nằm trong git. Sáu tháng sau, một audit phát hiện `DATABASE_PASSWORD` nằm trong một file `configmap.yaml` được commit từ tuần đầu tiên. Repo là private, nhưng 40 người có quyền đọc, và nó có trong mọi bản clone, mọi backup, và toàn bộ lịch sử git.

## Position

```text
Image (bất biến)  +  ConfigMap / Secret (theo môi trường)  +  resources (giới hạn)
                       ↑ note này
                     = Pod đang chạy
```

## Problem

```text
① Cấu hình khác nhau giữa môi trường mà image PHẢI giống nhau
② Secret cần cơ chế KHÁC config thường (phân quyền, mã hoá, xoay vòng)
③ Không có resource limit → một pod làm chết node
④ Không có resource request → scheduler không biết đặt pod ở đâu
```

Bốn vấn đề độc lập, và Kubernetes giải bằng bốn đối tượng.

## Mental Model

### ConfigMap và Secret gần như giống nhau — trừ một điểm

```text
ConfigMap  dữ liệu không nhạy cảm; lưu dạng rõ trong etcd
Secret     dữ liệu nhạy cảm; lưu BASE64 trong etcd
           → base64 KHÔNG PHẢI mã hoá
           → khác biệt thật: RBAC riêng, không hiện trong `describe`,
             có thể bật encryption at rest
```

Điểm quan trọng nhất: **Secret của Kubernetes mặc định chỉ được base64 hoá, không mã hoá.** Ai đọc được etcd hoặc có RBAC đọc Secret trong namespace đều lấy được giá trị.

```bash
kubectl get secret api-secrets -o jsonpath='{.data.DATABASE_PASSWORD}' | base64 -d
```

Bảo vệ thật cần ba lớp:

```text
① encryption at rest cho etcd    (EncryptionConfiguration ở API server)
② RBAC chặt cho Secret           (không phải ai cũng đọc được)
③ external secret manager        (Vault, AWS Secrets Manager, GCP Secret Manager)
```

### Hai cách đưa vào pod: env var vs file

```yaml
# ① env var — đơn giản nhất
envFrom:
  - configMapRef: { name: api-config }
  - secretRef:    { name: api-secrets }

# ② file mount — tốt hơn cho SECRET
volumeMounts:
  - { name: secrets, mountPath: /etc/secrets, readOnly: true }
volumes:
  - name: secrets
    secret:
      secretName: api-secrets
      defaultMode: 0400
```

```text
                        env var              file mount
Đơn giản                ✓                    cần đọc file
Lộ qua /proc/<pid>/environ  ✓ CÓ            ✗ không
Lộ qua `kubectl describe pod`  ✓ (tên+giá trị nếu inline)  ✗
Lộ trong crash dump     ✓ CÓ                ✗
Cập nhật khi Secret đổi ✗ CẦN RESTART        ✓ kubelet cập nhật tại chỗ (có độ trễ)
Phân quyền              không                file permission
```

Dòng "cập nhật" là khác biệt thực tế lớn nhất: **env var chỉ đọc một lần lúc khởi động.** Đổi Secret không có tác dụng cho tới khi pod restart.

File mount được kubelet cập nhật (độ trễ tới ~1 phút, hoặc bằng `--sync-frequency`), nhưng **app phải chủ động đọc lại** — nó không tự nhận biết.

Quy tắc thực dụng: **config qua env var; secret qua file mount** khi có thể.

### ConfigMap/Secret đổi không tự restart pod

```text
Sửa ConfigMap → pod KHÔNG restart → app vẫn dùng giá trị cũ (nếu qua env)
```

Ba cách xử lý:

```yaml
# ① checksum annotation — thay đổi ConfigMap làm pod template đổi → rollout
spec:
  template:
    metadata:
      annotations:
        checksum/config: "{{ sha256sum config.yaml }}"     # Helm
```

```text
② Đặt tên ConfigMap có hash: api-config-a1b2c3
   → Kustomize configMapGenerator làm điều này tự động
   → đổi nội dung = đổi tên = pod template đổi = rollout

③ Reloader operator — theo dõi ConfigMap và tự trigger rollout
```

Cách ② là cách sạch nhất: nó biến "cấu hình thay đổi" thành một rollout bình thường, có rollback bình thường.

### Resource requests và limits

```yaml
resources:
  requests:                # dùng để SCHEDULE và ĐẢM BẢO
    cpu: 100m              # 0,1 core
    memory: 256Mi
  limits:                  # trần CỨNG
    memory: 512Mi          # vượt → OOMKilled
    # cpu: không đặt       # xem lý do bên dưới
```

```text
CPU     request → cpu.weight (phần được đảm bảo khi tranh chấp)
        limit   → cpu.max (throttle, KHÔNG giết)
MEMORY  request → dùng để schedule
        limit   → memory.max (vượt là GIẾT)
```

Khác biệt cốt lõi: **memory không nén được, CPU nén được.** Chi tiết: [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md).

Về CPU limit — một khuyến nghị gây tranh cãi nhưng có cơ sở:

```text
Đặt CPU limit  → throttling ngay cả khi node còn rảnh → p99 xấu
Không đặt      → pod dùng CPU dư → p99 tốt hơn
                 nhưng có thể lấn sang pod khác (được giới hạn bởi request/weight)

⇒ Với service nhạy latency: đặt request, CÂN NHẮC bỏ limit, và THEO DÕI nr_throttled
⇒ Với batch/job: đặt limit để không ảnh hưởng service
⇒ MEMORY LIMIT thì LUÔN đặt
```

### QoS class quyết định ai bị evict trước

```text
Guaranteed   requests == limits cho MỌI container    → evict CUỐI CÙNG
Burstable    có requests, khác limits                → evict giữa
BestEffort   không đặt gì                            → evict ĐẦU TIÊN
```

```bash
kubectl get pod <p> -o jsonpath='{.status.qosClass}'
```

Khi node thiếu memory, kubelet evict theo thứ tự ngược: BestEffort trước, rồi Burstable vượt request nhiều nhất, cuối cùng mới tới Guaranteed.

Với workload quan trọng, `Guaranteed` (request = limit cho memory) đáng cân nhắc — đổi lấy mật độ pod thấp hơn.

### LimitRange và ResourceQuota

```yaml
# LimitRange: giá trị mặc định và trần cho MỖI container trong namespace
apiVersion: v1
kind: LimitRange
metadata: { name: defaults }
spec:
  limits:
    - type: Container
      default:        { memory: 512Mi, cpu: 500m }    # limit mặc định
      defaultRequest: { memory: 256Mi, cpu: 100m }    # request mặc định
      max:            { memory: 2Gi }
```

```yaml
# ResourceQuota: TỔNG cho cả namespace
apiVersion: v1
kind: ResourceQuota
metadata: { name: team-quota }
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.memory: 80Gi
    pods: "50"
    persistentvolumeclaims: "10"
```

`LimitRange` giải quyết vấn đề "ai đó quên đặt resources" — nó gán giá trị mặc định thay vì để pod thành BestEffort.

Và lưu ý: **khi có ResourceQuota cho `requests.cpu`, mọi pod trong namespace BẮT BUỘC phải khai báo request** — nếu không, pod bị từ chối. Đây là hành vi hay gây bất ngờ.

### Downward API: pod biết về chính nó

```yaml
env:
  - name: POD_NAME
    valueFrom: { fieldRef: { fieldPath: metadata.name } }
  - name: NODE_NAME
    valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
  - name: MEMORY_LIMIT
    valueFrom: { resourceFieldRef: { resource: limits.memory } }
```

`MEMORY_LIMIT` đặc biệt hữu ích: app đọc được giới hạn thật của mình thay vì `os.totalmem()` (trả về RAM của **node**). Xem [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md).

`POD_NAME` và `NODE_NAME` nên có trong mọi dòng log — chúng là thứ bạn cần khi một pod cụ thể hành xử khác.

### External Secrets: đưa secret ra khỏi git

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata: { name: api-secrets }
spec:
  refreshInterval: 1h
  secretStoreRef: { name: aws-secrets, kind: ClusterSecretStore }
  target: { name: api-secrets }
  data:
    - secretKey: DATABASE_PASSWORD
      remoteRef: { key: prod/api, property: db_password }
```

Với GitOps, đây là cách giải quyết mâu thuẫn giữa "mọi thứ trong git" và "secret không được vào git": git chứa **tham chiếu** tới secret, không chứa giá trị.

Lựa chọn khác: **Sealed Secrets** (mã hoá secret bằng public key của cluster, an toàn để commit) — đơn giản hơn nhưng không xoay vòng tự động được.

### Nếu secret đã lọt vào git

```text
① XOAY SECRET NGAY — đây là bước quan trọng nhất
② Sau đó mới dọn lịch sử git (git filter-repo, BFG)
③ Giả định nó đã bị lộ: mọi bản clone, mọi backup, mọi CI cache đều có
```

Thứ tự quan trọng: xoá khỏi git **không** làm secret an toàn trở lại. Chỉ xoay mới làm được.

## Example

Cấu hình đầy đủ:

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: api-config }
data:
  NODE_ENV: production
  LOG_LEVEL: info
  DATABASE_POOL_MAX: "10"
---
apiVersion: v1
kind: Secret
metadata: { name: api-secrets }
type: Opaque
stringData:                       # stringData: viết dạng rõ, K8s tự base64
  DATABASE_PASSWORD: <từ external secret manager>
  JWT_SECRET: <...>
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          envFrom:
            - configMapRef: { name: api-config }        # config: env var
          env:
            - name: POD_NAME
              valueFrom: { fieldRef: { fieldPath: metadata.name } }
            - name: MEMORY_LIMIT_BYTES
              valueFrom: { resourceFieldRef: { resource: limits.memory } }
            - name: DATABASE_PASSWORD_FILE
              value: /etc/secrets/DATABASE_PASSWORD      # secret: FILE
          volumeMounts:
            - { name: secrets, mountPath: /etc/secrets, readOnly: true }
            - { name: tmp, mountPath: /tmp }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 512Mi }                  # memory limit LUÔN có
          securityContext:
            runAsNonRoot: true
            runAsUser: 1001
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
      volumes:
        - name: secrets
          secret: { secretName: api-secrets, defaultMode: 0400 }
        - name: tmp
          emptyDir: {}
```

Và ở phía app, đọc secret từ file:

```ts
function readSecret(name: string): string {
  const path = process.env[`${name}_FILE`];
  if (path) return fs.readFileSync(path, 'utf8').trim();   // .trim() BẮT BUỘC
  const v = process.env[name];
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
}
```

`.trim()` không phải chi tiết vặt: file secret rất hay có newline ở cuối, và một mật khẩu có `\n` thừa gây lỗi xác thực khó hiểu.

## Prediction

1. Secret trong Kubernetes — nó được mã hoá hay chỉ base64?
2. Ai đọc được giá trị Secret nếu không có RBAC chặt?
3. Sửa ConfigMap, pod đang chạy dùng env var — app thấy giá trị mới không?
4. Cùng ConfigMap nhưng mount thành file — app thấy giá trị mới không? Ngay lập tức?
5. Secret qua env var, app crash và tạo core dump — secret có trong dump không?
6. Không đặt memory limit, app rò rỉ bộ nhớ — ảnh hưởng tới node thế nào?
7. Đặt CPU limit 500m, app cần 1 CPU liên tục — bị giết hay bị chậm?
8. Không đặt resources gì — QoS class là gì? Bị evict thứ mấy?
9. `requests == limits` cho memory — QoS class là gì?
10. Có ResourceQuota cho `requests.cpu`, deploy pod không khai báo request — kết quả?
11. Có LimitRange với `defaultRequest`, cùng pod — kết quả?
12. `os.totalmem()` trong pod giới hạn 512Mi trên node 64 GB — trả về gì?
13. Secret đã commit vào git, bạn xoá file ở commit sau — secret còn nguy hiểm không?

<details>
<summary>Đáp án</summary>

1. **Chỉ base64** theo mặc định. Cần bật encryption at rest cho etcd.
2. Bất kỳ ai có RBAC đọc Secret trong namespace đó, và bất kỳ ai đọc được etcd.
3. **Không** — env var đọc một lần lúc khởi động. Cần restart pod.
4. **Có**, nhưng có **độ trễ** (tới ~1 phút), và **app phải chủ động đọc lại file**.
5. **Có** — env var nằm trong `/proc/<pid>/environ` và thường có trong core dump.
6. App dùng hết RAM node → kubelet evict pod khác, hoặc node OOM → **ảnh hưởng mọi pod trên node**.
7. **Bị chậm** (throttle). CPU nén được nên kernel bóp thay vì giết.
8. **BestEffort** — bị evict **đầu tiên** khi node thiếu tài nguyên.
9. **Guaranteed** (nếu mọi container đều vậy cho cả cpu và memory) — evict cuối cùng.
10. Pod **bị từ chối** — có quota cho `requests.cpu` thì mọi pod phải khai báo.
11. LimitRange gán `defaultRequest` → pod được chấp nhận.
12. **64 GB** — thông tin của node. Dùng Downward API để lấy limit thật.
13. **Còn nguy hiểm** — nó trong lịch sử git, trong mọi bản clone, backup, CI cache. **Phải xoay.**
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `kubectl get secret -o jsonpath='{.data.X}' \| base64 -d` | Đọc được giá trị |
| Sửa ConfigMap, không restart pod, kiểm tra env trong pod | Giá trị cũ |
| Mount thành file, sửa ConfigMap, `cat` file sau 2 phút | Giá trị mới |
| Secret qua env, `cat /proc/1/environ` trong pod | Secret hiện ra |
| Secret qua file, lặp lại | Không thấy |
| Bỏ memory limit, chạy app rò rỉ | Node bị ảnh hưởng |
| Đặt CPU limit thấp, đo p99 và `cpu.stat` | `nr_throttled` cao |
| Bỏ CPU limit, đo lại | p99 cải thiện |
| Deploy pod không đặt resources, xem `qosClass` | BestEffort |
| Tạo áp lực memory trên node | BestEffort bị evict trước |
| Thêm ResourceQuota, deploy pod không có request | Bị từ chối |
| Thêm LimitRange, lặp lại | Được chấp nhận |
| `node -e "console.log(os.totalmem())"` trong pod | RAM của node |
| Đọc `MEMORY_LIMIT_BYTES` từ Downward API | Giới hạn thật |
| Secret file không `.trim()`, dùng làm mật khẩu | Lỗi xác thực khó hiểu |

## What Usually Goes Wrong

- **Secret trong git** → lộ vĩnh viễn; phải xoay.
- **Secret trong ConfigMap** → sai cơ chế, sai phân quyền, hiện trong `describe`.
- **Tưởng Secret được mã hoá** → không bật encryption at rest.
- **Secret qua env var** → lộ trong `/proc`, crash dump, log của thư viện in env.
- **Sửa ConfigMap mà không rollout** → app dùng giá trị cũ, và không ai nhận ra.
- **Không đặt memory limit** → một pod làm chết node.
- **Không đặt resources gì** → BestEffort, bị evict đầu tiên.
- **CPU limit quá chặt** → throttling im lặng, p99 xấu.
- **ResourceQuota không kèm LimitRange** → pod bị từ chối với lỗi khó hiểu.
- **Đọc `os.totalmem()`/`os.cpus()`** → cấu hình sai theo tài nguyên của node.
- **Quên `.trim()` khi đọc secret từ file** → newline thừa gây lỗi xác thực.
- **Không validate config lúc khởi động** → lỗi lộ muộn.
- **`stringData` với giá trị thật commit vào git** → cùng vấn đề với secret trong git.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Secret được mã hoá | Chỉ base64; cần bật encryption at rest |
| base64 là một dạng bảo vệ | Nó là mã hoá ký tự, không phải mã hoá bảo mật |
| Sửa ConfigMap là pod nhận ngay | Env var cần restart; file có độ trễ |
| Secret qua env var an toàn | Lộ qua `/proc`, crash dump, `describe` |
| Request và limit gần như nhau | Request để schedule/chia phần; limit để giết/bóp |
| Nên luôn đặt CPU limit | Với service nhạy latency, request-không-limit thường tốt hơn |
| Memory limit có thể bỏ qua | Không — một pod sẽ làm chết node |
| Không đặt resources là "linh hoạt" | Là BestEffort, bị evict đầu tiên |
| Xoá secret khỏi git là đủ | Phải xoay secret |
| Container thấy tài nguyên của chính nó | Nhiều API trả số của node |

## Debugging

1. **App dùng giá trị config cũ** → `kubectl exec <pod> -- env | grep X`. Nếu khác ConfigMap, pod chưa restart.
2. **Xem giá trị thật của ConfigMap/Secret**:
   ```bash
   kubectl get configmap api-config -o yaml
   kubectl get secret api-secrets -o jsonpath='{.data.KEY}' | base64 -d
   ```
3. **Pod `Pending`** → `kubectl describe pod` → Events. Thường là `Insufficient cpu/memory` (request quá lớn) hoặc quota.
4. **Pod bị từ chối lúc tạo** → ResourceQuota hoặc LimitRange. Đọc thông báo lỗi của `kubectl apply`.
5. **OOMKilled** → `kubectl describe pod | grep -A3 'Last State'`; so `limits.memory` với mức dùng thật.
6. **Chậm mà CPU thấp** → CPU throttling: `kubectl exec <pod> -- cat /sys/fs/cgroup/cpu.stat`.
7. **QoS class**: `kubectl get pod <p> -o jsonpath='{.status.qosClass}'`.
8. **Secret không đúng** → kiểm tra khoảng trắng và newline (`| xxd | tail`).

## Production Considerations

- **Secret không bao giờ vào git.** Dùng External Secrets Operator hoặc Sealed Secrets.
- **Bật encryption at rest cho etcd** — mặc định không bật ở nhiều bản cài đặt.
- **RBAC chặt cho Secret** — không phải ai đọc được pod cũng nên đọc được secret.
- **Secret qua file mount với `defaultMode: 0400`**, config qua env var.
- **Đổi ConfigMap/Secret phải kích hoạt rollout** — dùng Kustomize `configMapGenerator` (thêm hash vào tên) hoặc checksum annotation.
- **Memory limit cho mọi container**, luôn luôn.
- **CPU request cho mọi container**; cân nhắc bỏ CPU limit cho service nhạy latency và **theo dõi `nr_throttled`**.
- **LimitRange trong mọi namespace** — nó ngăn pod BestEffort do quên khai báo.
- **ResourceQuota theo team/namespace** để một team không chiếm hết cluster.
- **Downward API để app biết giới hạn thật** thay vì đọc tài nguyên của node.
- **Validate config lúc khởi động** — thiếu biến thì pod không vào Service, rollout dừng. Xem [Configuration](../../02-backend-api/04-architecture/05-configuration.md).
- **Xoay secret định kỳ** và có quy trình khẩn cấp đã diễn tập.
- **Quét git tìm secret** (`gitleaks`) trong CI, trên cả lịch sử.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Secret qua env var | đơn giản, mọi app đọc được | lộ qua `/proc`, cần restart để đổi |
| Secret qua file | kín hơn, xoay được, phân quyền được | app phải đọc file, phải `.trim()` |
| Secret của K8s | có sẵn, đơn giản | chỉ base64; cần RBAC + encryption |
| External secret manager | audit, xoay tự động, một nguồn sự thật | thêm hạ tầng, phụ thuộc lúc khởi động |
| Sealed Secrets | commit được vào git | không xoay tự động |
| Memory limit chặt | phát hiện leak sớm, mật độ cao | OOMKilled khi có đỉnh |
| Memory limit rộng | ít restart | lãng phí, leak lộ muộn |
| CPU limit | công bằng, dự đoán được | throttling, p99 xấu |
| Không CPU limit | p99 tốt, tận dụng CPU dư | pod khác có thể chậm hơn dự kiến |
| Guaranteed QoS | ổn định, evict cuối | tốn tài nguyên, mật độ thấp |
| Burstable QoS | mật độ cao | bị evict trước |
| ResourceQuota | không ai chiếm hết cluster | pod bị từ chối nếu thiếu request |

## Explain Without Notes

1. ConfigMap và Secret khác nhau ở điểm nào thật sự?
2. Vì sao Secret của Kubernetes không được coi là mã hoá?
3. Env var và file mount khác nhau ở bốn điểm nào?
4. Vì sao sửa ConfigMap không có tác dụng, và ba cách xử lý?
5. Request và limit khác nhau thế nào cho CPU và cho memory?
6. Ba QoS class và thứ tự evict?
7. Vì sao nên cân nhắc bỏ CPU limit nhưng luôn đặt memory limit?
8. Secret đã lọt vào git — bước đầu tiên là gì?

## Related

- [Pod, Deployment, Service](01-pod-deployment-service.md) — nơi cấu hình được gắn vào
- [Scheduling & resources](05-scheduling-resources.md) — request quyết định pod đi đâu
- [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md) — cgroup bên dưới
- [Namespaces & cgroups](../02-docker/04-namespaces-cgroups.md) — securityContext
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — nguyên tắc chung
- [Config & lifecycle (NestJS)](../../02-backend-api/02-nestjs/05-config-lifecycle.md) — validate lúc khởi động
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — secret ở tầng hệ thống
- [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md) — image bất biến, config theo môi trường

## Version / Context

Kubernetes 1.29+. Encryption at rest cho etcd cấu hình qua `EncryptionConfiguration` ở API server (không bật mặc định ở nhiều bản cài). External Secrets Operator, Sealed Secrets (Bitnami), Vault Agent Injector là các lựa chọn phổ biến. Immutable ConfigMap/Secret (`immutable: true`) có từ 1.21 và giảm tải lên API server.
