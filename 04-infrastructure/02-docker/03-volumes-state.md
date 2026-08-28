---
level: intermediate
area: infra
prerequisites:
  - 01-image-container.md
  - ../00-linux/03-filesystem-permissions.md
related:
  - 06-compose.md
  - ../04-kubernetes/08-storage-statefulset.md
---

# Volumes & state

> Bạn chạy PostgreSQL trong Docker suốt hai tuần phát triển. Mọi thứ tốt. Rồi bạn chạy `docker compose down -v` để "dọn dẹp" và mất toàn bộ dữ liệu test — bao gồm cả dataset mà một đồng nghiệp đã dành hai ngày chuẩn bị. Cờ `-v` xoá volume, và không có bước xác nhận nào.

## Position

```text
Container
   ├─ layer ghi (tạm thời)   ← MẤT khi container bị xoá
   └─ mount point
        ├─ named volume   → Docker quản lý
        ├─ bind mount     → thư mục của host
        └─ tmpfs          → RAM
```

## Problem

Container được thiết kế để **bị xoá và tạo lại**:

```text
deploy → container mới; container cũ bị xoá
crash  → orchestrator tạo container mới
scale  → nhiều container, mỗi cái filesystem riêng
```

Mọi thứ ghi vào layer ghi của container biến mất theo. Đó là **tính chất mong muốn** (container tái lập được, không tích luỹ rác), nhưng nó buộc bạn phải trả lời một câu hỏi cho mỗi dữ liệu:

```text
"Dữ liệu này mất được không?"
   được   → để trong container (cache, file tạm)
   không  → volume, hoặc dịch vụ bên ngoài
```

## Mental Model

### Ba loại mount

```text
NAMED VOLUME     -v mydata:/var/lib/postgresql/data
   Docker quản lý (/var/lib/docker/volumes/)
   + hiệu năng tốt trên mọi OS, quyền được xử lý hợp lý
   + kế thừa quyền/nội dung từ image khi tạo LẦN ĐẦU
   - khó xem/sửa từ host
   → mặc định cho DỮ LIỆU

BIND MOUNT       -v /host/path:/container/path
   ánh xạ thẳng thư mục của host
   + thấy được, sửa được từ host — cần cho hot reload
   - xung đột UID thường xuyên; CHẬM trên macOS/Windows
   → cho MÃ NGUỒN khi phát triển

TMPFS            --tmpfs /tmp
   trong RAM, mất khi container dừng
   + nhanh, không chạm đĩa
   - tốn RAM, không lưu được
   → cache tạm, secret không muốn chạm đĩa
```

### Named volume kế thừa quyền — nhưng chỉ một lần

```text
Volume TRỐNG được mount lần đầu
   → Docker COPY nội dung VÀ quyền từ thư mục tương ứng trong IMAGE
Volume ĐÃ CÓ dữ liệu
   → KHÔNG copy gì; nội dung image bị CHE
```

Đây là nguyên nhân của "tôi đã sửa Dockerfile mà vẫn lỗi permission": bạn `chown` trong image, nhưng volume đã tồn tại từ lần chạy trước và giữ quyền cũ.

```bash
docker volume rm mydata     # phải xoá volume để quyền mới được áp dụng
```

Bind mount thì **không bao giờ** copy — nó dùng quyền của host, luôn luôn.

### Mount che nội dung có sẵn

```dockerfile
COPY node_modules /app/node_modules
```

```bash
docker run -v $(pwd):/app myapp
# → /app/node_modules từ IMAGE bị CHE bởi thư mục host (có thể trống hoặc sai kiến trúc)
```

Mẫu phổ biến để giải quyết: dùng **anonymous volume** che ngược lại chỗ cần giữ từ image.

```yaml
volumes:
  - .:/app                # code từ host (hot reload)
  - /app/node_modules     # ← giữ node_modules TỪ IMAGE
```

Nó hoạt động vì mount cụ thể hơn (`/app/node_modules`) thắng mount rộng hơn (`/app`).

Điều này quan trọng khi host là macOS và image là Linux: `node_modules` build trên macOS có native module sai kiến trúc.

### `docker compose down` và cờ `-v`

```bash
docker compose down       # xoá container + network. Volume GIỮ NGUYÊN.
docker compose down -v    # xoá LUÔN volume  ← MẤT DỮ LIỆU, không hỏi lại
docker volume prune       # xoá mọi volume KHÔNG được container nào dùng
```

`docker volume prune` nguy hiểm hơn nó có vẻ: một volume của service đang dừng (không phải đang chạy) được coi là "không dùng".

Named volume có tên rõ ràng an toàn hơn anonymous volume, vì bạn nhận ra nó trong danh sách:

```yaml
volumes:
  pgdata:
    name: myproject_pgdata     # tên tường minh
```

### Quyền: UID phải khớp

```bash
docker run -v /host/data:/data -u 1001 myapp
# ls -ld /host/data → drwxr-xr-x 1000 1000
# → UID 1001 chỉ có quyền 'other' = r-x → KHÔNG ghi được → EACCES
```

Bốn cách xử lý, đã nêu ở [Filesystem & permissions](../00-linux/03-filesystem-permissions.md):

```text
① chown ở host theo UID container
② dùng named volume (kế thừa quyền từ image)
③ K8s: fsGroup
④ initContainer chạy root để chown
```

Với bind mount trong dev, cách thực dụng là **khớp UID của container với UID của lập trình viên**:

```dockerfile
ARG UID=1000
RUN adduser -u ${UID} -S app
```

### Backup: volume không tự backup

```bash
# backup
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
  tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .

# restore
docker run --rm -v pgdata:/data -v $(pwd):/backup alpine \
  tar xzf /backup/pgdata-2026-01-15.tar.gz -C /data
```

Nhưng với database, **tar file dữ liệu của một database đang chạy có thể cho backup hỏng** — nó không nhất quán về mặt transaction. Dùng công cụ của chính database:

```bash
docker exec db pg_dump -U user app | gzip > backup.sql.gz
```

Xem [WAL, durability & backup](../../03-database/01-postgresql/06-wal-durability-backup.md).

### Stateful trong container: khi nào nên, khi nào không

```text
DEV / TEST        chạy database trong container: TỐT
                  → nhanh, tái lập được, xoá đi làm lại dễ

PRODUCTION        thường KHÔNG nên tự vận hành
                  → managed service (RDS, Cloud SQL) lo backup, failover,
                    vá lỗi, replication
                  → nếu tự chạy: cần StatefulSet, PV, backup, monitoring,
                    và người biết vận hành database
```

Câu hỏi quyết định không phải "container có chạy database được không" (có), mà là **"team có muốn vận hành một database không"**. Với hầu hết đội ngũ, câu trả lời là không — và đó là một quyết định đúng.

### Không lưu state trong container

```text
✗ log ghi vào file trong container       → mất; dùng stdout
✗ upload lưu trong container              → mất; dùng S3 hoặc volume
✗ session trong bộ nhớ                    → mất khi restart; dùng Redis
✗ cache trong bộ nhớ với nhiều replica    → không nhất quán; dùng Redis
✗ file tạm không dọn                      → layer ghi phình dần
```

Nguyên tắc chung: **container nên stateless.** Mọi state đi ra ngoài — database, object storage, Redis. Điều này không chỉ để tránh mất dữ liệu; nó là điều kiện để scale ngang và để thay thế container bất cứ lúc nào.

### Kubernetes: volume có nhiều loại hơn

```text
emptyDir      tạm, sống theo POD (không phải container) — cho /tmp, cache
hostPath      thư mục của NODE — pod chuyển node là mất; tránh dùng
PVC + PV      lưu trữ thật (EBS, GCE PD, NFS)
ConfigMap     cấu hình mount thành file
Secret        secret mount thành file (tốt hơn env var)
```

Hai điều đáng biết:

```text
· emptyDir sống theo POD: container restart thì GIỮ, pod bị xoá thì MẤT
  → đúng cho /tmp khi dùng readOnlyRootFilesystem
· ReadWriteOnce (phổ biến nhất) = chỉ MỘT node mount được
  → không scale ngang được với volume đó
```

Xem [Storage & StatefulSet](../04-kubernetes/08-storage-statefulset.md).

## Example

Compose cho dev, với ba loại mount dùng đúng chỗ:

```yaml
services:
  api:
    build: { context: ., target: dev }
    volumes:
      - .:/app                    # bind: code, hot reload
      - /app/node_modules         # anonymous: GIỮ node_modules từ image
      - /app/dist                 # anonymous: giữ build output
    tmpfs:
      - /tmp                      # RAM, không chạm đĩa
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/app

  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data      # named: DỮ LIỆU
      - ./seed:/docker-entrypoint-initdb.d:ro  # bind read-only: script khởi tạo
    environment:
      POSTGRES_PASSWORD: pass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 5s
      retries: 10

volumes:
  pgdata:
    name: myproject_pgdata        # tên tường minh → nhận ra được, khó xoá nhầm
```

Bốn quyết định:

```text
bind cho code            hot reload cần thấy thay đổi từ host
anonymous cho node_modules  giữ bản build trong image (đúng kiến trúc)
named cho dữ liệu DB     hiệu năng tốt, quyền đúng, tồn tại qua down
tmpfs cho /tmp           nhanh, và hợp với readOnlyRootFilesystem
:ro cho script seed      container không sửa được file của host
```

Và một quy tắc vận hành: **`docker compose down -v` chỉ chạy khi bạn thật sự muốn mất dữ liệu.** Với dữ liệu quan trọng ở dev, backup trước.

## Prediction

1. Container ghi file vào `/app/uploads`, `docker rm` rồi `docker run` lại — file còn không?
2. Cùng tình huống với `-v uploads:/app/uploads` — còn không?
3. `docker compose down` — volume thế nào?
4. `docker compose down -v` — volume thế nào? Có xác nhận không?
5. `docker volume prune` khi service đang **dừng** (không chạy) — volume của nó thế nào?
6. Image có `/app/node_modules`, mount `-v $(pwd):/app` — `node_modules` từ image còn thấy không?
7. Thêm `-v /app/node_modules` (anonymous) — còn không?
8. Bind mount thư mục host owner 1000, container chạy UID 1001 — ghi được không?
9. Named volume tạo từ image đã `chown 1001`, sau đó đổi Dockerfile sang UID 1002, chạy lại — quyền thế nào?
10. Xoá volume rồi chạy lại — quyền thế nào?
11. `tar` thư mục dữ liệu của PostgreSQL đang chạy — backup có dùng được không?
12. `emptyDir` trong K8s, container crash và restart — dữ liệu còn không? Pod bị xoá thì sao?
13. PVC `ReadWriteOnce`, scale deployment lên 3 replica trên 3 node — kết quả?

<details>
<summary>Đáp án</summary>

1. **Mất** — layer ghi biến mất cùng container.
2. **Còn** — volume tồn tại độc lập.
3. Volume **giữ nguyên** — chỉ container và network bị xoá.
4. Volume **bị xoá**. **Không có xác nhận nào.**
5. **Bị xoá** — volume chỉ được coi là "đang dùng" khi có container (kể cả dừng) tham chiếu; anonymous volume của container đã xoá thì bị prune.
6. **Không** — thư mục host che nội dung từ image.
7. **Còn** — mount cụ thể hơn thắng mount rộng hơn.
8. **Không** — UID 1001 chỉ có quyền `other` trên thư mục owner 1000 mode 755.
9. **Giữ quyền cũ (1001)** — Docker chỉ copy quyền khi volume trống lần đầu.
10. Quyền mới (1002) được áp dụng.
11. **Có thể hỏng** — không nhất quán về transaction. Dùng `pg_dump` hoặc dừng database trước.
12. Container restart: **còn** (emptyDir sống theo pod). Pod bị xoá: **mất**.
13. Pod thứ hai và ba **không schedule được** trên node khác — `ReadWriteOnce` chỉ cho một node mount.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Ghi file trong container, `docker rm`, chạy lại | Mất |
| Thêm named volume, lặp lại | Còn |
| `docker compose down` rồi `up` | Dữ liệu còn |
| `docker compose down -v` rồi `up` | Dữ liệu mất, không cảnh báo |
| `docker volume ls` trước và sau `prune` | Volume của service dừng biến mất |
| Mount `$(pwd):/app` với image có `node_modules` | Bị che |
| Thêm anonymous volume `/app/node_modules` | Được giữ |
| Bind mount owner khác UID container | `EACCES` |
| `chown` ở host theo UID container | Ghi được |
| Named volume, đổi UID trong Dockerfile, chạy lại | Quyền cũ vẫn giữ |
| `docker volume rm` rồi chạy lại | Quyền mới |
| Đo tốc độ ghi vào bind mount trên macOS vs named volume | Chênh lệch lớn |
| `tar` dữ liệu Postgres đang chạy, restore, kiểm tra | Có thể hỏng |
| `pg_dump` rồi restore | Nhất quán |
| K8s: ghi vào `emptyDir`, kill container | Còn; xoá pod thì mất |

## What Usually Goes Wrong

- **Ghi dữ liệu vào container** → mất khi container bị xoá.
- **`docker compose down -v` vô ý** → mất dữ liệu, không có xác nhận.
- **`docker volume prune`** → xoá volume của service đang dừng.
- **Bind mount che `node_modules` của image** → module sai kiến trúc hoặc thiếu.
- **UID không khớp với bind mount** → `EACCES`.
- **Named volume giữ quyền cũ** → sửa Dockerfile mà vẫn lỗi.
- **`tar` file dữ liệu database đang chạy** → backup hỏng, và bạn phát hiện lúc cần restore.
- **Bind mount trên macOS/Windows cho dữ liệu lớn** → chậm nghiêm trọng.
- **`hostPath` trong K8s** → pod chuyển node là mất dữ liệu.
- **`ReadWriteOnce` với nhiều replica** → pod không schedule được.
- **Log ghi vào file trong container** → mất, và không ai xoay vòng nó.
- **Không backup volume ở dev** → mất dataset test mà người khác đã chuẩn bị.
- **Tự vận hành database production trong container mà không có kế hoạch backup/failover** → sự cố không phục hồi được.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Dữ liệu trong container tồn tại lâu dài | Mất khi container bị xoá |
| `docker compose down` xoá dữ liệu | Không — trừ khi có `-v` |
| `docker volume prune` chỉ xoá rác | Nó xoá cả volume của service đang dừng |
| Named volume tự đồng bộ quyền với image | Chỉ lúc tạo lần đầu, khi trống |
| Bind mount và named volume tương đương | Khác về quyền, hiệu năng, và cách xử lý nội dung có sẵn |
| Mount thư mục là "gộp" nội dung | Nó **che** hoàn toàn nội dung có sẵn |
| `tar` volume là backup đầy đủ | Với database đang chạy, nó có thể không nhất quán |
| `emptyDir` mất khi container restart | Nó sống theo **pod** |
| PVC dùng chung được giữa nhiều pod | `ReadWriteOnce` chỉ một node |
| Chạy database trong container là sai | Ở dev thì đúng; ở production thì là quyết định về vận hành |

## Debugging

1. **Dữ liệu mất** → có volume không? `docker inspect <c> --format '{{json .Mounts}}' | jq`.
2. **Volume nào đang tồn tại** → `docker volume ls`, `docker volume inspect <name>`.
3. **`EACCES`** → `docker exec <c> id` và `docker exec <c> ls -ld <path>`. So UID.
4. **Nội dung không như mong đợi** → có mount nào che nó không? Liệt kê `Mounts` theo thứ tự.
5. **Chậm bất thường trên macOS** → bind mount cho thư mục lớn; chuyển sang named volume hoặc dùng `:cached`/`:delegated`.
6. **Trong K8s** → `kubectl describe pod` xem `Volumes` và `Events`; PVC có `Bound` không (`kubectl get pvc`).
7. **PVC `Pending`** → không có PV phù hợp, hoặc StorageClass không tồn tại, hoặc `ReadWriteOnce` đã bị node khác giữ.

## Production Considerations

- **Container stateless.** Mọi state ra ngoài: database, object storage, Redis.
- **Log ra stdout**, không ghi file trong container.
- **Upload lên object storage** (S3), không lưu trong container hay volume cục bộ — nó không scale và không backup được dễ dàng.
- **Database production: dùng managed service** trừ khi có lý do rõ ràng và có người biết vận hành.
- **Nếu tự chạy database trên K8s**: StatefulSet + PVC + backup tự động + monitoring + kế hoạch failover đã diễn tập.
- **Backup volume bằng công cụ của database**, không bằng `tar` file dữ liệu đang chạy.
- **Đặt tên tường minh cho named volume** — nó giảm rủi ro xoá nhầm.
- **`readOnlyRootFilesystem: true` + `emptyDir` cho `/tmp`** — chặn nhiều lớp tấn công với chi phí thấp.
- **Secret mount thành file, không qua env var** — file phân quyền được và không lộ qua `/proc/<pid>/environ`.
- **Kiểm tra `ReadWriteOnce` trước khi scale** — nó là giới hạn cứng.
- **Diễn tập restore**, không chỉ backup. Backup chưa từng được restore là giả định.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Named volume | hiệu năng tốt, quyền hợp lý | khó xem/sửa từ host |
| Bind mount | thấy được, hot reload | xung đột UID, chậm trên macOS/Windows |
| tmpfs | nhanh nhất, không chạm đĩa | tốn RAM, mất khi dừng |
| Stateless container | scale ngang, thay thế tự do | phải có dịch vụ lưu trữ bên ngoài |
| State trong container | đơn giản lúc đầu | không scale, mất dữ liệu |
| Managed database | không vận hành, có backup/failover | đắt hơn, ít kiểm soát |
| Tự chạy database | rẻ hơn, kiểm soát đầy đủ | phải vận hành, backup, failover |
| `emptyDir` | nhanh, đơn giản | mất khi pod bị xoá |
| PVC | tồn tại lâu dài | `ReadWriteOnce` giới hạn scale; phụ thuộc storage class |
| `hostPath` | đơn giản, nhanh | gắn với node; tránh dùng ở production |

## Explain Without Notes

1. Ba loại mount và mỗi loại dùng cho gì?
2. Vì sao named volume "kế thừa quyền từ image" chỉ hoạt động một lần?
3. Vì sao mount `$(pwd):/app` làm mất `node_modules` của image, và cách sửa?
4. `docker compose down` và `down -v` khác nhau thế nào?
5. Vì sao `tar` file dữ liệu database đang chạy không phải backup đáng tin?
6. `emptyDir` sống theo cái gì? Khi nào nó mất?
7. `ReadWriteOnce` giới hạn gì?
8. Câu hỏi nào quyết định dữ liệu để đâu?

## Related

- [Image & container](01-image-container.md) — layer ghi tạm thời
- [Filesystem & permissions](../00-linux/03-filesystem-permissions.md) — UID và volume
- [Compose](06-compose.md) — volume trong môi trường dev
- [Production image](07-production-image.md) — `readOnlyRootFilesystem`
- [Common failures](08-common-failures.md) — mất dữ liệu là lỗi kinh điển
- [Storage & StatefulSet](../04-kubernetes/08-storage-statefulset.md) — PVC, PV, StatefulSet
- [WAL, durability & backup](../../03-database/01-postgresql/06-wal-durability-backup.md) — backup đúng cách
- [Logs & services](../00-linux/06-logs-and-services.md) — log ra stdout, không ra file
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — secret mount thành file

## Version / Context

Docker 24+. Trên macOS/Windows, bind mount đi qua lớp chuyển đổi (VirtioFS/gRPC-FUSE) nên chậm hơn Linux đáng kể — đây là nguồn của khác biệt hiệu năng giữa các máy dev. Kubernetes: `emptyDir` sống theo pod; access mode `ReadWriteMany` chỉ khả dụng với một số storage backend (NFS, EFS, CephFS).
