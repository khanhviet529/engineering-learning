---
level: advanced
area: infra
prerequisites:
  - ../scheduling-reliability/02-scheduling-resources.md
  - ../../02-docker/03-volumes-state.md
related:
  - 02-ingress-service-discovery.md
  - ../../../03-database/01-postgresql/operations/01-wal-durability-backup.md
---

# Storage & StatefulSet

> Deployment chạy PostgreSQL với một PVC. Bạn scale lên 2 replica để "có dự phòng". Pod thứ hai `Pending` mãi mãi. Rồi ai đó đổi sang `ReadWriteMany` trên NFS và nó chạy — **hai instance PostgreSQL cùng ghi vào một thư mục dữ liệu**. Cơ sở dữ liệu hỏng trong vòng vài phút, và không có gì trong Kubernetes ngăn điều đó.

## Position

```text
Pod  →  volumeMounts  →  PVC  →  PV  →  storage thật (EBS, PD, NFS, local)
                          ↑ note này: ai được mount, ở đâu, và điều gì xảy ra khi pod di chuyển
```

## Problem

```text
① Pod tạm thời, dữ liệu thì không
② Pod có thể chuyển node → volume phải đi theo (hoặc pod bị ghim vào node)
③ Nhiều pod cùng ghi một volume → HỎNG DỮ LIỆU
④ Deployment không cho pod danh tính ổn định → database cần điều đó
⑤ Backup, restore, failover — Kubernetes KHÔNG làm hộ
```

Điểm ⑤ là điểm quan trọng nhất và hay bị bỏ qua: Kubernetes cho bạn **cơ chế lưu trữ**, không cho bạn **vận hành database**.

## Mental Model

### PV, PVC, StorageClass

```text
StorageClass   "loại lưu trữ nào" (gp3, ssd, nfs) + provisioner
PV             một khối lưu trữ THẬT (thường được tạo tự động)
PVC            YÊU CẦU lưu trữ của pod — đây là thứ bạn viết
```

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data }
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: gp3
  resources:
    requests: { storage: 20Gi }
```

Bạn khai báo PVC; provisioner tạo PV tương ứng. Pod mount PVC.

### Access mode: đây là nơi hỏng dữ liệu

```text
ReadWriteOnce (RWO)   MỘT NODE mount đọc-ghi
                      → nhiều pod TRÊN CÙNG NODE vẫn dùng chung được
ReadOnlyMany (ROX)    nhiều node, chỉ đọc
ReadWriteMany (RWX)   nhiều node đọc-ghi — cần NFS/EFS/CephFS
ReadWriteOncePod       đúng MỘT POD (1.29+) ← an toàn nhất cho database
```

Hai điều cực kỳ quan trọng:

```text
① RWO ≠ "một pod". Nó là "một NODE".
   Hai pod trên cùng node vẫn mount được cùng PVC.

② Access mode KHÔNG ngăn app ghi hỏng dữ liệu.
   Nó chỉ kiểm soát MOUNT. Nếu hai process cùng ghi vào một thư mục
   dữ liệu PostgreSQL, Kubernetes không biết và không ngăn.
```

Điểm ② là sự cố ở đầu note. `ReadWriteMany` cho phép mount — nó **không** làm PostgreSQL an toàn khi chạy hai instance.

`ReadWriteOncePod` (1.29+) là access mode duy nhất thật sự đảm bảo một pod, và nó nên là mặc định cho database.

### Volume ràng buộc pod vào node

```text
EBS/PD volume nằm ở MỘT availability zone
   → pod dùng nó CHỈ lên lịch được ở node trong zone đó
   → node đó chết mà zone còn → volume mount lại ở node khác cùng zone (mất vài phút)
   → cả ZONE chết → volume không truy cập được
```

`volumeBindingMode` quyết định thứ tự:

```yaml
kind: StorageClass
volumeBindingMode: WaitForFirstConsumer   # ← nên dùng
```

```text
Immediate               tạo PV NGAY → chọn zone TRƯỚC khi biết pod đi đâu
                        → có thể tạo volume ở zone không có chỗ cho pod → Pending mãi
WaitForFirstConsumer    chờ pod được lên lịch RỒI mới tạo PV ở đúng zone  ✓
```

### StatefulSet: danh tính ổn định

```text
Deployment            pod ngẫu nhiên: api-7f8b-x9k2, api-7f8b-m3p1
                      → tên và IP đổi mỗi lần tạo lại
                      → mọi pod dùng CHUNG một PVC (nếu có)

StatefulSet           pod có THỨ TỰ và danh tính: db-0, db-1, db-2
                      → tên ỔN ĐỊNH qua restart
                      → MỖI POD một PVC RIÊNG (volumeClaimTemplates)
                      → DNS ổn định: db-0.db.ns.svc.cluster.local
                      → tạo/xoá theo THỨ TỰ
```

Ba tính chất đó là thứ database cần: replica phải biết "tôi là node số mấy" và "primary ở đâu".

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db }
spec:
  serviceName: db                      # headless Service — BẮT BUỘC
  replicas: 3
  podManagementPolicy: OrderedReady     # hoặc Parallel
  selector: { matchLabels: { app: db } }
  template:
    metadata: { labels: { app: db } }
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: postgres
          image: postgres:16-alpine
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
  volumeClaimTemplates:                 # MỖI pod một PVC riêng
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOncePod]
        storageClassName: gp3
        resources: { requests: { storage: 100Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: db }
spec:
  clusterIP: None                       # headless
  selector: { app: db }
  ports: [{ port: 5432 }]
```

### PVC của StatefulSet KHÔNG bị xoá

```text
Xoá StatefulSet → PVC VẪN CÒN
Scale down 3 → 1 → PVC của db-1, db-2 VẪN CÒN

⇒ tính năng an toàn: scale down không mất dữ liệu
⇒ nhưng cũng là nguồn chi phí ẩn: PVC mồ côi tích luỹ
```

Từ 1.27 có `persistentVolumeClaimRetentionPolicy` để kiểm soát:

```yaml
spec:
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain      # hoặc Delete
    whenScaled: Retain
```

Với dữ liệu quan trọng, giữ `Retain` cho `whenDeleted`.

### `reclaimPolicy`: điều gì xảy ra khi PVC bị xoá

```text
Delete   (mặc định của nhiều StorageClass)  xoá PVC → XOÁ LUÔN dữ liệu
Retain   giữ PV và dữ liệu; phải dọn thủ công
```

Với dữ liệu production, `reclaimPolicy: Retain` là lựa chọn an toàn: một `kubectl delete pvc` nhầm sẽ không xoá dữ liệu.

```bash
kubectl get sc gp3 -o jsonpath='{.reclaimPolicy}'    # kiểm tra trước khi tin
```

### `emptyDir` vs PVC vs `hostPath`

```text
emptyDir   sống theo POD (không phải container)
           → container restart: GIỮ;  pod bị xoá: MẤT
           → đúng cho /tmp, cache, và khi dùng readOnlyRootFilesystem
           → emptyDir.medium: Memory → tmpfs (tính vào memory limit!)

PVC        tồn tại độc lập với pod
           → đúng cho dữ liệu thật

hostPath   thư mục của NODE
           → pod chuyển node = MẤT; rủi ro bảo mật
           → TRÁNH, trừ trường hợp đặc biệt (node agent, log collector)
```

Lưu ý về `emptyDir.medium: Memory`: nó dùng tmpfs, và dung lượng **tính vào memory limit của pod** — ghi 500 MB vào đó với limit 512Mi sẽ gây OOMKilled.

### `fsGroup`: quyền volume

```yaml
securityContext:
  fsGroup: 1001
  runAsNonRoot: true
  runAsUser: 1001
```

kubelet `chown` volume theo `fsGroup` khi mount — giải quyết vấn đề `EACCES` với container non-root.

Nhưng với volume rất lớn, `chown` đệ quy mỗi lần mount **rất chậm**. Từ 1.23:

```yaml
securityContext:
  fsGroupChangePolicy: OnRootMismatch    # chỉ chown khi quyền gốc sai
```

Xem [Filesystem & permissions](../../00-linux/03-filesystem-permissions.md).

### Chạy database trên Kubernetes: nên hay không

```text
Kubernetes cho:  scheduling, storage, restart, DNS ổn định
Kubernetes KHÔNG cho:
  · backup và restore
  · failover đúng cách (promote replica, tránh split-brain)
  · nâng cấp version an toàn
  · tuning, monitoring chuyên biệt
  · point-in-time recovery
```

Ba lựa chọn:

```text
① Managed service (RDS, Cloud SQL)     ← mặc định đúng cho hầu hết
   + backup, failover, vá lỗi, replication đều có sẵn
   − đắt hơn, ít kiểm soát

② Operator (CloudNativePG, Zalando, Percona)
   + operator BIẾT về PostgreSQL: backup, failover, nâng cấp
   − vẫn phải hiểu cả PostgreSQL lẫn operator

③ StatefulSet tự viết
   + kiểm soát tối đa
   − bạn phải tự làm mọi thứ ở danh sách trên
   → gần như luôn là lựa chọn sai cho production
```

Câu hỏi quyết định không phải "có chạy được không" (có), mà là **"team có muốn vận hành một database không"**.

Nếu chọn ②, dùng operator trưởng thành — đừng tự viết StatefulSet cho PostgreSQL.

### Mở rộng volume

```yaml
kind: StorageClass
allowVolumeExpansion: true
```

```bash
kubectl patch pvc data-db-0 -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
```

```text
Mở rộng: ĐƯỢC (nếu StorageClass cho phép)
Thu nhỏ: KHÔNG BAO GIỜ

⇒ bắt đầu nhỏ, mở rộng khi cần — không đặt dư "cho chắc"
```

Một số CSI driver yêu cầu restart pod để filesystem nhận kích thước mới; nhiều driver hiện đại mở rộng online.

### Snapshot

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata: { name: db-snap-20260115 }
spec:
  volumeSnapshotClassName: csi-snapclass
  source: { persistentVolumeClaimName: data-db-0 }
```

Snapshot là **ảnh chụp khối lưu trữ**, không phải backup nhất quán của database:

```text
Snapshot volume của PostgreSQL đang chạy
   → có thể không nhất quán về transaction
   → PostgreSQL sẽ crash-recovery khi khởi động từ nó (thường được, không đảm bảo)

⇒ với database, dùng công cụ của chính nó: pg_dump, pgBackRest, WAL archiving
```

Xem [WAL, durability & backup](../../../03-database/01-postgresql/operations/01-wal-durability-backup.md).

## Example

Chẩn đoán "pod thứ hai Pending":

```bash
kubectl describe pod db-1 | tail -15
# Events:
#   Warning FailedScheduling: 0/6 nodes are available:
#     6 node(s) had volume node affinity conflict

# → PVC bị ràng buộc vào một zone, không node nào trong zone đó có chỗ

kubectl get pvc
# NAME        STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS
# data-db-0   Bound    pvc-a1   100Gi      RWO            gp3
# data-db-1   Pending                                     gp3

kubectl describe pvc data-db-1
# Events: waiting for first consumer to be created before binding
#   ← WaitForFirstConsumer: PVC chờ pod, pod chờ PVC?  Không —
#     pod chưa lên lịch được vì lý do KHÁC; đọc lại describe pod

kubectl get pv pvc-a1 -o jsonpath='{.spec.nodeAffinity}'
# {"required":{"nodeSelectorTerms":[{"matchExpressions":[
#   {"key":"topology.kubernetes.io/zone","operator":"In","values":["ap-southeast-1a"]}]}]}}
#   ← volume ở zone 1a; nếu không node nào ở 1a còn chỗ → Pending
```

Và cấu hình đúng cho một database nhỏ chạy trên cluster:

```yaml
# dùng OPERATOR, không tự viết StatefulSet
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: pg }
spec:
  instances: 3
  storage:
    size: 100Gi
    storageClass: gp3
  backup:
    barmanObjectStore:
      destinationPath: s3://backups/pg
      wal: { compression: gzip }
      data: { compression: gzip }
    retentionPolicy: "30d"
  monitoring:
    enablePodMonitor: true
```

Operator lo: replication, failover có fencing, backup + WAL archiving, point-in-time recovery, rolling upgrade. Đó là danh sách những thứ StatefulSet thuần **không** cho bạn.

## Prediction

1. Deployment với PVC `ReadWriteOnce`, scale lên 2 replica trên 2 node — pod thứ hai thế nào?
2. Cùng cấu hình nhưng cả hai pod được lên lịch trên **cùng một node** — thế nào?
3. Đổi sang `ReadWriteMany` với NFS, chạy 2 PostgreSQL cùng ghi — Kubernetes có ngăn không?
4. Kết quả với dữ liệu?
5. `ReadWriteOncePod` — pod thứ hai thế nào?
6. PVC dùng EBS ở zone `1a`, node duy nhất ở `1a` chết — pod thế nào?
7. Cả zone `1a` chết — pod thế nào?
8. `volumeBindingMode: Immediate`, PV tạo ở zone không có chỗ cho pod — kết quả?
9. Xoá StatefulSet — PVC thế nào?
10. Scale StatefulSet 3 → 1 — PVC của db-1, db-2 thế nào?
11. `reclaimPolicy: Delete`, xoá PVC nhầm — dữ liệu thế nào?
12. `emptyDir.medium: Memory`, ghi 500 MB, memory limit 512Mi — kết quả?
13. Snapshot volume PostgreSQL đang chạy, restore — dữ liệu nhất quán không?

<details>
<summary>Đáp án</summary>

1. **Pending** — RWO chỉ cho một node mount.
2. **Cả hai mount được** — RWO là "một node", không phải "một pod". Đây là bẫy.
3. **Không** — access mode chỉ kiểm soát mount, không kiểm soát ghi.
4. **Hỏng cơ sở dữ liệu** trong vòng vài phút — hai instance ghi vào cùng thư mục dữ liệu.
5. **Pending** — `ReadWriteOncePod` đảm bảo đúng một pod.
6. Volume được mount lại ở node khác **cùng zone** — mất vài phút.
7. Volume **không truy cập được**. Pod Pending cho tới khi zone hồi phục.
8. Pod **Pending mãi mãi** — volume ở zone A, chỗ trống ở zone B, không thể ghép.
9. **PVC vẫn còn** — tính năng an toàn để không mất dữ liệu.
10. **Vẫn còn** — và nếu scale lên lại, chúng được tái sử dụng.
11. **Dữ liệu bị xoá** cùng PV. Dùng `Retain` cho dữ liệu quan trọng.
12. **OOMKilled** — tmpfs tính vào memory limit của pod.
13. **Không đảm bảo** — snapshot ở mức khối, không nhất quán về transaction. PostgreSQL sẽ crash-recovery, thường được nhưng không có gì bảo đảm.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Deployment + RWO PVC, scale lên 2 trên 2 node | Pod thứ hai Pending |
| Ép cả hai pod lên cùng node (nodeSelector) | Cả hai mount được |
| Đổi sang `ReadWriteOncePod` | Pod thứ hai Pending, luôn luôn |
| RWX + hai instance database cùng ghi (môi trường thử nghiệm!) | Dữ liệu hỏng |
| Xoá node có PVC, đo thời gian pod chạy lại | Vài phút |
| `volumeBindingMode: Immediate` với cluster nhiều zone | Có thể Pending vĩnh viễn |
| Đổi sang `WaitForFirstConsumer` | Volume tạo đúng zone |
| Xoá StatefulSet, `kubectl get pvc` | PVC còn |
| Scale down rồi scale up | PVC được tái sử dụng, dữ liệu còn |
| `reclaimPolicy: Delete`, xoá PVC | Dữ liệu mất |
| `Retain`, lặp lại | PV còn, ở trạng thái `Released` |
| `emptyDir.medium: Memory`, ghi vượt limit | OOMKilled |
| Non-root container không có `fsGroup`, ghi vào PVC | `EACCES` |
| Thêm `fsGroup`, lặp lại | Ghi được |
| Mở rộng PVC lên; thử thu nhỏ xuống | Mở rộng OK, thu nhỏ bị từ chối |

## What Usually Goes Wrong

- **Tưởng RWO là "một pod"** → hai pod trên cùng node mount được.
- **Dùng RWX để "sửa" Pending** → hai instance ghi cùng lúc, hỏng dữ liệu. Sai lầm nghiêm trọng nhất.
- **Deployment cho stateful workload** → không có danh tính ổn định, dùng chung PVC.
- **`volumeBindingMode: Immediate`** → volume ở zone không có chỗ → Pending vĩnh viễn.
- **`reclaimPolicy: Delete` cho dữ liệu production** → xoá PVC nhầm là mất dữ liệu.
- **PVC mồ côi tích luỹ** → chi phí ẩn tăng dần.
- **`hostPath`** → pod chuyển node là mất dữ liệu.
- **`emptyDir.medium: Memory`** không tính vào memory limit → OOMKilled bất ngờ.
- **Non-root không có `fsGroup`** → `EACCES`.
- **`fsGroup` với volume lớn** → mount chậm vì chown đệ quy.
- **Snapshot làm backup database** → có thể không nhất quán.
- **Tự viết StatefulSet cho PostgreSQL production** → không có failover, không có PITR.
- **Không diễn tập restore** → backup là giả định, không phải phương án.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `ReadWriteOnce` = một pod | Nó là **một node** |
| Access mode ngăn hỏng dữ liệu | Nó chỉ kiểm soát mount |
| RWX làm database chạy nhiều instance được | Nó chỉ cho phép mount; database vẫn hỏng |
| PVC đi theo pod tới mọi node | EBS/PD gắn với một zone |
| Xoá StatefulSet xoá dữ liệu | PVC được giữ lại |
| Xoá PVC luôn giữ dữ liệu | Tuỳ `reclaimPolicy`; mặc định thường là `Delete` |
| `emptyDir` mất khi container restart | Nó sống theo **pod** |
| `emptyDir.medium: Memory` không tốn RAM của pod | Nó tính vào memory limit |
| Snapshot là backup database | Nó là ảnh chụp khối, có thể không nhất quán |
| Kubernetes lo failover database | Nó không biết gì về database |
| StatefulSet đủ để chạy PostgreSQL | Nó cho danh tính và storage; không cho backup/failover |

## Debugging

1. **Pod Pending với volume** → `kubectl describe pod` → thường là `volume node affinity conflict` hoặc `Insufficient` tài nguyên.
2. **PVC `Pending`** → `kubectl describe pvc`:
   - `waiting for first consumer` → bình thường với `WaitForFirstConsumer`; vấn đề nằm ở chỗ pod chưa lên lịch được.
   - `no persistent volumes available` → StorageClass sai hoặc provisioner có vấn đề.
3. **Volume ở zone nào?** `kubectl get pv <pv> -o jsonpath='{.spec.nodeAffinity}'`.
4. **`EACCES` khi ghi** → có `fsGroup` chưa? `kubectl exec <pod> -- ls -ld <mountPath>` và `id`.
5. **Mount chậm** → volume lớn + `fsGroup` chown đệ quy. Dùng `fsGroupChangePolicy: OnRootMismatch`.
6. **Đầy đĩa trong pod** → `kubectl exec <pod> -- df -h`; PVC có `allowVolumeExpansion` không?
7. **PVC mồ côi** → `kubectl get pvc -A` và đối chiếu với StatefulSet/Deployment còn tồn tại.
8. **Dữ liệu mất sau khi xoá** → kiểm tra `reclaimPolicy` của StorageClass — thường đã quá muộn.

## Production Considerations

- **Database production: dùng managed service** trừ khi có lý do rõ ràng.
- **Nếu chạy trên K8s, dùng operator trưởng thành** (CloudNativePG, Zalando Postgres Operator, Percona) — không tự viết StatefulSet.
- **`ReadWriteOncePod` cho database** (1.29+); nó là access mode duy nhất thật sự đảm bảo một pod.
- **`volumeBindingMode: WaitForFirstConsumer`** cho mọi StorageClass.
- **`reclaimPolicy: Retain`** cho dữ liệu production.
- **`persistentVolumeClaimRetentionPolicy: whenDeleted: Retain`** cho StatefulSet quan trọng.
- **`fsGroup` + `fsGroupChangePolicy: OnRootMismatch`** cho container non-root.
- **Backup bằng công cụ của database**, không bằng snapshot volume. WAL archiving cho PITR.
- **Diễn tập restore theo lịch** — backup chưa từng restore là giả định.
- **Theo dõi dung lượng PVC** và alert ở 80% — đầy đĩa với database là sự cố nghiêm trọng.
- **`allowVolumeExpansion: true`** trên StorageClass; bắt đầu nhỏ vì không thu nhỏ được.
- **Dọn PVC mồ côi định kỳ** — chúng tích luỹ chi phí âm thầm.
- **Anti-affinity cho replica database** để chúng không cùng node.
- **Cân nhắc nghiêm túc**: chạy database trên K8s tăng đáng kể phạm vi vận hành. Với đội nhỏ, managed service gần như luôn đúng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Managed database | không vận hành, có backup/failover | đắt, ít kiểm soát |
| Operator trên K8s | tự động hoá tốt, kiểm soát nhiều | phải hiểu cả DB lẫn operator |
| StatefulSet tự viết | kiểm soát tối đa | tự làm backup, failover, nâng cấp |
| `ReadWriteOncePod` | an toàn nhất | cần K8s 1.29+, CSI hỗ trợ |
| `ReadWriteOnce` | phổ biến, mọi CSI hỗ trợ | hai pod cùng node vẫn mount được |
| `ReadWriteMany` | nhiều pod ghi được | cần NFS/EFS (chậm hơn); rủi ro hỏng dữ liệu |
| `Retain` | không mất dữ liệu do xoá nhầm | phải dọn thủ công, PV tích luỹ |
| `Delete` | tự dọn | xoá nhầm = mất dữ liệu |
| `WaitForFirstConsumer` | volume đúng zone | tạo volume muộn hơn |
| `Immediate` | volume sẵn sàng sớm | có thể sai zone → Pending |
| `emptyDir` | nhanh, đơn giản | mất khi pod bị xoá |
| `hostPath` | nhanh nhất | gắn node, rủi ro bảo mật |

## Explain Without Notes

1. PV, PVC, StorageClass — mỗi cái là gì?
2. `ReadWriteOnce` nghĩa là gì chính xác? Bẫy của nó?
3. Vì sao access mode không ngăn được hỏng dữ liệu?
4. Volume ràng buộc pod vào node/zone thế nào?
5. StatefulSet cho gì mà Deployment không cho?
6. Điều gì xảy ra với PVC khi xoá StatefulSet, và vì sao?
7. Vì sao snapshot volume không phải backup database?
8. Ba lựa chọn chạy database, và câu hỏi quyết định?

## Related

- [Scheduling & resources](../scheduling-reliability/02-scheduling-resources.md) — volume ảnh hưởng lên lịch
- [Ingress & service discovery](02-ingress-service-discovery.md) — headless Service cho StatefulSet
- [Volumes & state](../../02-docker/03-volumes-state.md) — khái niệm ở tầng Docker
- [Filesystem & permissions](../../00-linux/03-filesystem-permissions.md) — `fsGroup`, UID
- [Memory, CPU & limits](../../00-linux/02-memory-cpu-limits.md) — `emptyDir.medium: Memory`
- [WAL, durability & backup](../../../03-database/01-postgresql/operations/01-wal-durability-backup.md) — backup đúng cách
- [Replication & scaling](../../../03-database/01-postgresql/operations/02-replication-scaling.md) — failover, split-brain
- [Debugging Kubernetes](../operations/02-debugging-k8s.md) — pod Pending vì volume

## Version / Context

Kubernetes 1.29+. `ReadWriteOncePod` GA từ 1.29. `persistentVolumeClaimRetentionPolicy` cho StatefulSet GA từ 1.27. `fsGroupChangePolicy` từ 1.23. VolumeSnapshot cần CSI driver hỗ trợ. Operator PostgreSQL phổ biến: CloudNativePG, Zalando, Percona, Crunchy.
