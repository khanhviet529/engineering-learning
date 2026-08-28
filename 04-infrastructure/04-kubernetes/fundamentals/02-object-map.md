---
level: foundation
area: infra
prerequisites:
  - 01-why-kubernetes.md
related:
  - ../workloads-networking/01-pod-deployment-service.md
  - ../operations/02-debugging-k8s.md
---

# Bản đồ đối tượng Kubernetes

> Một dev sửa YAML của Pod trực tiếp bằng `kubectl edit pod` để tăng memory limit. Thay đổi được chấp nhận. Ba phút sau, Pod bị xoá và tạo lại với giá trị cũ. Họ thử lại, cùng kết quả. **Không có gì hỏng — họ đang sửa một đối tượng do Deployment sở hữu, và Deployment liên tục khôi phục nó về đúng trạng thái đã khai báo.**

## Position

```text
Note này là TỪ VỰNG: Kubernetes có những đối tượng nào,
cái nào sở hữu cái nào, và ai chịu trách nhiệm cho việc gì.

  why kubernetes (01) → object map (note này) → workloads, networking, …
```

## Mental Model

### Mọi thứ là một vòng lặp điều hoà

```text
Bạn khai báo TRẠNG THÁI MONG MUỐN (YAML) → lưu vào etcd
Controller chạy vòng lặp vô hạn:

  while (true) {
    thực tế = quan sát cluster
    if (thực tế ≠ mong muốn) hành động
  }
```

```text
Một câu đó giải thích gần như mọi hành vi lạ của Kubernetes:

  · xoá Pod do Deployment quản lý → Pod mới xuất hiện
  · sửa Pod trực tiếp → bị ghi đè về trạng thái khai báo  ← sự cố ở đầu note
  · node chết → Pod xuất hiện ở node khác
  · scale từ 3 xuống 2 → một Pod bị chấm dứt

⇒ bạn không RA LỆNH cho Kubernetes. Bạn MÔ TẢ kết quả mong muốn.
⇒ và bạn phải sửa đối tượng SỞ HỮU, không sửa đối tượng bị sở hữu.
```

### Control plane và node

```text
CONTROL PLANE — bộ não
  kube-apiserver          cửa duy nhất vào cluster; mọi thứ đi qua đây
  etcd                    kho lưu trạng thái (key-value, đồng thuận Raft)
  kube-scheduler          chọn node cho Pod chưa được gán
  kube-controller-manager chạy các vòng lặp điều hoà built-in

NODE — nơi container thật sự chạy
  kubelet                 nhận Pod spec, bảo container runtime chạy, báo trạng thái
  container runtime       containerd — thật sự chạy container
  kube-proxy              cài rule mạng để Service hoạt động
```

```text
Hai điều đáng nhớ:

① Mọi thành phần chỉ nói chuyện với API SERVER, không nói với nhau.
   → apiserver chết = không thay đổi gì được, NHƯNG Pod đang chạy vẫn chạy

② kubelet là thứ giữ Pod sống trên node.
   → kubelet chết = Pod trên node đó không được giám sát, không restart được
```

### Cây sở hữu: ai tạo ra ai

```text
Deployment          bạn khai báo cái này
   └─ ReplicaSet    Deployment tạo — MỖI phiên bản một ReplicaSet
        └─ Pod      ReplicaSet tạo và duy trì đúng số lượng
             └─ Container

Sửa Deployment → tạo ReplicaSet MỚI → dựng Pod mới, thu Pod cũ
ReplicaSet cũ được GIỮ LẠI (số lượng 0) → đó là cách `rollout undo` hoạt động
```

```text
Quy tắc: LUÔN sửa đối tượng ở CẤP CAO NHẤT.

  sửa Deployment   ✓ thay đổi bền vững
  sửa ReplicaSet   ✗ Deployment ghi đè
  sửa Pod          ✗ ReplicaSet thay thế
```

### Bảng đối tượng theo vai trò

**Chạy workload**

| Đối tượng | Dùng cho | Đặc điểm quyết định |
|---|---|---|
| `Pod` | đơn vị nhỏ nhất — một hoặc nhiều container | chia sẻ network namespace và volume; **không tự khởi động lại khi node chết** |
| `Deployment` | ứng dụng **không trạng thái** | rolling update, rollback, Pod có thể thay thế lẫn nhau |
| `StatefulSet` | ứng dụng **có trạng thái** | tên ổn định (`db-0`, `db-1`), volume riêng cho mỗi Pod, khởi động theo thứ tự |
| `DaemonSet` | một Pod trên **mỗi node** | agent log, agent metric, CNI |
| `Job` | chạy **tới khi xong** | migration, xử lý theo lô |
| `CronJob` | Job theo lịch | `concurrencyPolicy` quyết định điều gì xảy ra khi lần trước chưa xong |

**Kết nối mạng**

| Đối tượng | Dùng cho |
|---|---|
| `Service` (ClusterIP) | một tên DNS ổn định + cân bằng tải trong cluster |
| `Service` (NodePort/LoadBalancer) | mở ra ngoài cluster |
| `Service` (Headless) | không có IP ảo — DNS trả về IP từng Pod; dùng với StatefulSet |
| `Ingress` / `Gateway` | định tuyến HTTP theo host/path, TLS termination |
| `NetworkPolicy` | firewall giữa các Pod — **mặc định là cho phép tất cả** |
| `Endpoints` / `EndpointSlice` | danh sách Pod đang **ready** của một Service |

**Cấu hình và lưu trữ**

| Đối tượng | Dùng cho | Cảnh báo |
|---|---|---|
| `ConfigMap` | cấu hình không nhạy cảm | không tự reload khi mount làm env |
| `Secret` | dữ liệu nhạy cảm | **base64 ≠ mã hoá**; cần encryption at rest + RBAC |
| `PersistentVolumeClaim` | yêu cầu dung lượng lưu trữ | `ReadWriteOnce` = một **node**, không phải một Pod |
| `PersistentVolume` | dung lượng thật (thường do StorageClass tạo tự động) | |
| `StorageClass` | mô tả loại lưu trữ và cách cấp phát | |

**Tổ chức và bảo mật**

| Đối tượng | Dùng cho |
|---|---|
| `Namespace` | nhóm logic + phạm vi cho tên, quota, RBAC, NetworkPolicy |
| `ServiceAccount` | danh tính của Pod khi gọi API server |
| `Role` / `ClusterRole` | tập quyền (namespace / toàn cluster) |
| `RoleBinding` / `ClusterRoleBinding` | gắn quyền cho người dùng hoặc ServiceAccount |
| `ResourceQuota` / `LimitRange` | giới hạn tài nguyên theo namespace |
| `PodDisruptionBudget` | số Pod tối thiểu phải sống khi bảo trì node |
| `HorizontalPodAutoscaler` | tự điều chỉnh số replica theo metric |

### Bốn cạm bẫy nằm ngay trong bảng trên

```text
① Pod KHÔNG tự phục hồi
   Pod trần (không có Deployment) mà node chết → nó BIẾN MẤT.
   Kubernetes không tạo lại Pod bạn tạo thủ công.

② NetworkPolicy MẶC ĐỊNH LÀ MỞ
   Không có policy nào = mọi Pod gọi được mọi Pod.
   Thêm policy đầu tiên cho một Pod = mọi thứ khác bị chặn cho Pod đó.

③ Secret chỉ là base64
   `kubectl get secret x -o yaml | base64 -d` đọc được ngay.
   Cần: encryption at rest cho etcd + RBAC chặt + mount dạng file.

④ ReadWriteOnce là một NODE
   Hai Pod trên CÙNG node dùng chung được một PVC RWO.
   Hai Pod trên node KHÁC nhau thì không → Pod thứ hai kẹt `Pending`.
   (`ReadWriteOncePod` mới là "đúng một Pod", GA từ 1.29.)
```

### Label và selector: cách mọi thứ tìm thấy nhau

```yaml
# Deployment gắn label cho Pod nó tạo
spec:
  selector: { matchLabels: { app: api } }     # bất biến sau khi tạo
  template:
    metadata:
      labels: { app: api }                     # ← Pod mang label này
---
# Service tìm Pod bằng label, KHÔNG bằng tên
kind: Service
spec:
  selector: { app: api }                       # phải khớp label của Pod
```

```text
Đây là cơ chế liên kết trung tâm của Kubernetes, và cũng là lỗi phổ biến nhất:

  selector của Service KHÔNG khớp label của Pod
  → `kubectl get endpoints <svc>` trả về RỖNG
  → Service tồn tại, DNS phân giải được, nhưng không có gì phía sau
  → triệu chứng: connection refused hoặc timeout, không có lỗi nào rõ ràng

⇒ `kubectl get endpoints` là lệnh chia đôi không gian tìm kiếm:
  rỗng → vấn đề ở label hoặc readiness.  có → vấn đề ở tầng khác.
```

### Namespace cô lập cái gì và không cô lập cái gì

```text
CÓ cô lập      tên đối tượng · RBAC · ResourceQuota · NetworkPolicy (nếu có)
KHÔNG cô lập   node · mạng (mặc định) · tài nguyên vật lý · CRD
               · đối tượng cluster-scoped (PV, StorageClass, ClusterRole)

⇒ Namespace là ranh giới TỔ CHỨC, không phải ranh giới BẢO MẬT
  cho tới khi bạn thêm NetworkPolicy và RBAC.
```

### DNS trong cluster

```text
<service>                              cùng namespace
<service>.<namespace>                  khác namespace
<service>.<namespace>.svc.cluster.local  dạng đầy đủ

⇒ Ingress ở namespace A trỏ tới Service ở namespace B bằng tên trần → 404.
  Phải dùng dạng có namespace.
```

## Prediction

1. `kubectl edit pod` để tăng memory limit của Pod do Deployment quản lý — thay đổi tồn tại bao lâu?
2. Sửa ở đâu mới bền vững?
3. Xoá một Pod do Deployment quản lý — chuyện gì xảy ra?
4. Tạo một Pod trần (không Deployment), node chết — Pod thế nào?
5. Sửa image trong Deployment — bao nhiêu ReplicaSet tồn tại sau đó?
6. Vì sao ReplicaSet cũ được giữ lại?
7. Service có selector `app: api`, Pod có label `app: api-server` — `kubectl get endpoints` trả về gì?
8. Triệu chứng người dùng thấy là gì?
9. Cluster không có NetworkPolicy nào — Pod A gọi được Pod B không?
10. Thêm một NetworkPolicy cho Pod B — Pod A còn gọi được không?
11. `kubectl get secret db -o yaml` — có đọc được mật khẩu không?
12. Hai Pod trên hai node khác nhau cùng dùng một PVC `ReadWriteOnce` — chuyện gì xảy ra?
13. Ingress ở namespace `edge` trỏ tới Service tên `api` ở namespace `app` — kết quả?
14. apiserver chết — Pod đang chạy có dừng không?

<details>
<summary>Đáp án</summary>

1. Tới lần điều hoà tiếp theo — **vài giây tới vài phút**.
2. Ở **Deployment** — đối tượng cấp cao nhất.
3. ReplicaSet **tạo Pod mới** để giữ đúng số lượng.
4. Nó **biến mất** — không có gì tạo lại.
5. **Hai** — cái mới đang chạy, cái cũ ở số lượng 0.
6. Để `kubectl rollout undo` quay lại được.
7. **Rỗng** — selector không khớp label.
8. Connection refused hoặc timeout, **không có lỗi rõ ràng**.
9. **Được** — mặc định là cho phép tất cả.
10. **Không** — policy đầu tiên cho một Pod chặn mọi thứ không được cho phép rõ ràng.
11. **Có** — base64 giải mã được ngay.
12. Pod thứ hai kẹt ở **`Pending`** với lỗi gắn volume.
13. **404** — cần `api.app` hoặc dạng đầy đủ.
14. **Không** — chúng vẫn chạy; chỉ là không thay đổi gì được.
</details>

## What Usually Goes Wrong

- **Sửa Pod hoặc ReplicaSet** thay vì Deployment.
- **Tạo Pod trần** cho workload cần tồn tại lâu dài.
- **Selector Service không khớp label Pod** → endpoints rỗng.
- **Không kiểm tra `kubectl get endpoints`** khi debug kết nối.
- **Tin Secret được mã hoá.**
- **Không có NetworkPolicy** → mọi Pod gọi được mọi Pod.
- **Hiểu nhầm `ReadWriteOnce`** là một Pod.
- **Coi Namespace là ranh giới bảo mật** khi chưa có RBAC và NetworkPolicy.
- **Gọi Service khác namespace bằng tên trần.**
- **Dùng Deployment cho ứng dụng có trạng thái** thay vì StatefulSet.
- **Không có PodDisruptionBudget** → bảo trì node hạ toàn bộ replica cùng lúc.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Kubernetes chạy lệnh của bạn | Nó điều hoà về trạng thái bạn khai báo |
| Sửa Pod là cách nhanh để thử | Nó bị ghi đè |
| Pod tự khởi động lại khi node chết | Chỉ khi có controller sở hữu nó |
| Secret được mã hoá | Nó là base64 |
| Namespace cô lập mạng | Chỉ khi có NetworkPolicy |
| `ReadWriteOnce` = một Pod | Nó là một **node** |
| Service tìm Pod bằng tên | Bằng **label selector** |
| Xoá Deployment giữ lại Pod | Pod bị xoá theo (owner reference) |
| apiserver chết là cluster chết | Pod đang chạy vẫn chạy |

## Explain Without Notes

1. Vòng lặp điều hoà là gì, và nó giải thích bốn hành vi nào?
2. Cây sở hữu Deployment → Pod, và quy tắc "sửa ở đâu"?
3. Vì sao ReplicaSet cũ được giữ lại?
4. Bốn thành phần control plane và vai trò từng cái.
5. Service tìm Pod bằng cơ chế nào? Lệnh nào chia đôi không gian tìm kiếm khi nó hỏng?
6. Bốn cạm bẫy trong bảng đối tượng.
7. Namespace cô lập gì và không cô lập gì?
8. Khi nào dùng Deployment, StatefulSet, DaemonSet, Job?

## Related

- [Vì sao cần Kubernetes](01-why-kubernetes.md) — Compose thiếu gì
- [Pod, Deployment, Service](../workloads-networking/01-pod-deployment-service.md) — chi tiết và endpoints rỗng
- [Ingress & service discovery](../workloads-networking/02-ingress-service-discovery.md) — DNS, namespace
- [Rollout & rollback](../workloads-networking/03-rollout-rollback.md) — ReplicaSet trong thực tế
- [Storage & StatefulSet](../workloads-networking/04-storage-statefulset.md) — PVC, ReadWriteOnce
- [Readiness & liveness](../scheduling-reliability/01-health-readiness-liveness.md) — Pod ready mới vào endpoints
- [Scheduling & resources](../scheduling-reliability/02-scheduling-resources.md) — scheduler dùng requests
- [Config, Secret & resources](../operations/01-config-secrets-resources.md) — Secret và encryption at rest
- [Debugging Kubernetes](../operations/02-debugging-k8s.md) — bốn câu hỏi khi có sự cố
- [Docker fundamentals](../../02-docker/01-image-container.md) — điều kiện tiên quyết

## Version / Context

Kubernetes **1.29+**. `ReadWriteOncePod` GA từ 1.29. `EndpointSlice` thay thế `Endpoints` cho cluster lớn (cả hai vẫn tồn tại). Gateway API (v1.1 GA) là hướng thay thế Ingress cho định tuyến phức tạp. NetworkPolicy cần CNI hỗ trợ — không phải CNI nào cũng thực thi nó. Secret **không** được mã hoá mặc định trong etcd ở nhiều bản phân phối; cần `EncryptionConfiguration`.
