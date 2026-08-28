---
level: foundation
area: infra
prerequisites:
  - 01-process-files-env.md
related:
  - ../02-docker/03-volumes-state.md
  - ../04-kubernetes/workloads-networking/04-storage-statefulset.md
---

# Filesystem & permissions

> Bạn đổi Dockerfile từ chạy `root` sang `USER app` — một thay đổi bảo mật đúng đắn, được khuyến nghị ở mọi nơi. Deploy xong, ứng dụng crash: `EACCES: permission denied, open '/data/uploads/x.png'`. Volume vẫn ở đó, đường dẫn vẫn đúng, và nó hoạt động hoàn hảo năm phút trước. Cái đổi là **UID của process**, và filesystem không quan tâm tên user — nó chỉ so sánh những con số.

## Position

```text
Process (UID/GID)  →  syscall open/write  →  kernel kiểm tra quyền  →  inode
                                                    ↑
                       so sánh UID của process với owner của inode
```

## Problem

Ba lớp lỗi mà không có mô hình quyền thì phải sửa bằng cách thử:

```text
① EACCES / permission denied   khi ghi vào volume
② Container ghi file, host không xoá được (hoặc ngược lại)
③ "Sửa" bằng chmod 777          → hoạt động, và mở một lỗ hổng
```

Điều làm chúng khó hơn nó nên có: **tên user không tồn tại ở tầng filesystem.** Container có user `app`, host có user `deploy`, và cả hai đều vô nghĩa với kernel — nó chỉ thấy UID `1001` và `1000`.

## Mental Model

### Quyền là ba nhóm × ba bit

```bash
ls -l /data/uploads
# drwxr-xr-x  2 1000 1000  4096 Jan 15 10:00 uploads
#  ↑└┬┘└┬┘└┬┘    └┬─┘ └┬─┘
#  │ │  │  │      │    └─ GID chủ nhóm
#  │ │  │  │      └────── UID chủ sở hữu
#  │ │  │  └─ other:  r-x
#  │ │  └──── group:  r-x
#  │ └─────── owner:  rwx
#  └───────── loại: d=thư mục, -=file, l=symlink
```

```text
r = 4    w = 2    x = 1

755 = rwxr-xr-x   chủ sở hữu toàn quyền, còn lại đọc + vào được
644 = rw-r--r--   file thường
600 = rw-------   chỉ chủ sở hữu  ← secret, khoá riêng
777 = rwxrwxrwx   MỌI người ghi được  ← gần như luôn sai
```

### `x` trên thư mục nghĩa là "đi vào được", không phải "chạy được"

Đây là điểm gây nhầm lẫn nhất và là nguyên nhân của nhiều lỗi khó hiểu:

```text
Trên FILE:      x = thực thi được
Trên THƯ MỤC:   x = đi XUYÊN QUA được (truy cập file bên trong)
                r = LIỆT KÊ được nội dung
```

```bash
chmod 644 /data          # rw-r--r-- : đọc được tên file, KHÔNG vào được
cat /data/file.txt       # permission denied — dù file.txt là 777
```

Và quyền được kiểm tra ở **mọi thành phần của đường dẫn**: để mở `/a/b/c/file`, process cần `x` trên `/a`, `/a/b`, `/a/b/c`, rồi mới đến quyền trên `file`.

### Kernel so sánh SỐ, không so sánh TÊN

```text
Container:  user 'app'    → UID 1001
Host:       user 'deploy' → UID 1000

Volume mount: /host/data (owner UID 1000)  →  /data trong container

Process UID 1001 ghi vào thư mục owner 1000, mode 755
   → không phải owner, không thuộc group → chỉ có quyền 'other' = r-x
   → KHÔNG có 'w' → EACCES
```

Tên `app` và `deploy` không xuất hiện ở đâu trong quyết định này. Đây là lý do "user trong container có tồn tại ở host không" là câu hỏi sai — câu hỏi đúng là "**UID có khớp không**".

### Bốn cách xử lý quyền volume

```text
① chown ở host theo UID của container
   sudo chown -R 1001:1001 /host/data
   + đơn giản, đúng
   - phải biết UID trước; cần quyền ở host

② Đặt UID cố định trong Dockerfile và dùng nó nhất quán
   RUN adduser -u 1001 -S app
   + kiểm soát được
   - phải phối hợp với người tạo volume

③ K8s: fsGroup — kubelet tự chown volume
   securityContext: { fsGroup: 1001 }
   + tự động
   - chỉ với một số loại volume; chậm với volume rất lớn

④ initContainer chạy root để chown, rồi app chạy non-root
   + linh hoạt nhất
   - thêm một container, cần cho phép chạy root tạm thời
```

Và cách **không** nên dùng:

```bash
chmod -R 777 /data     # ❌ mọi process trên máy ghi được
```

Nó "hoạt động" và đó chính là vấn đề — nó biến một lỗi cấu hình thành một lỗ hổng vĩnh viễn mà không ai quay lại sửa.

### Named volume vs bind mount

```text
BIND MOUNT   -v /host/path:/data
   → dùng quyền của thư mục ở HOST
   → xung đột UID là chuyện thường
   → thấy được từ host, tiện cho dev

NAMED VOLUME -v mydata:/data
   → Docker quản lý; khi tạo LẦN ĐẦU, Docker COPY nội dung và quyền
     từ thư mục tương ứng trong IMAGE
   → nếu image đã chown đúng, volume kế thừa
   → ít xung đột hơn nhiều
```

Điểm về named volume đáng nhớ: **quyền chỉ được sao chép lúc volume rỗng, lần đầu tiên**. Sửa quyền trong image sau đó **không** ảnh hưởng volume đã tồn tại. Đây là nguyên nhân của "tôi đã sửa Dockerfile mà vẫn lỗi" — phải xoá volume và tạo lại.

Xem [Volumes & state](../02-docker/03-volumes-state.md).

### `umask`: quyền mặc định của file mới

```bash
umask                # 0022
# file mới:     666 - 022 = 644
# thư mục mới:  777 - 022 = 755
```

Nếu app tạo file mà process khác (UID khác) cần đọc, `umask 0022` cho `644` — đọc được. Nếu cần ghi, phải dùng group chung và `umask 0002` (cho `664`).

### setuid, setgid, sticky bit

```text
setuid (4000)  chạy với UID của CHỦ SỞ HỮU file, không phải người gọi
               → /usr/bin/sudo, /usr/bin/passwd
               → mọi binary setuid root là một bề mặt tấn công

setgid (2000)  trên thư mục: file mới KẾ THỪA group của thư mục
               → rất hữu ích cho thư mục dùng chung

sticky (1000)  trong thư mục ghi chung, chỉ CHỦ SỞ HỮU file được xoá nó
               → /tmp có mode 1777
```

`setgid` trên thư mục là công cụ giải quyết bài toán "nhiều process khác UID cùng ghi vào một thư mục":

```bash
sudo groupadd -g 2000 appdata
sudo chgrp -R appdata /data && sudo chmod -R g+rwXs /data
# file mới trong /data tự thuộc group appdata
```

Rồi chạy mọi container với `--group-add 2000`.

### Container: filesystem chỉ đọc

```yaml
securityContext:
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
volumeMounts:
  - { name: tmp,   mountPath: /tmp }        # cần ghi tạm
  - { name: cache, mountPath: /app/.cache }
volumes:
  - { name: tmp,   emptyDir: {} }
  - { name: cache, emptyDir: {} }
```

`readOnlyRootFilesystem` là một trong những biện pháp có tỉ lệ giá trị/chi phí cao nhất: attacker không ghi được binary, không sửa được cấu hình, không cài được gì. Cái giá là bạn phải liệt kê tường minh những chỗ cần ghi — và việc đó tự nó là một bài tập hữu ích.

`allowPrivilegeEscalation: false` chặn binary setuid leo thang quyền.

### Symlink và path traversal

```ts
// ❌ attacker gửi filename = "../../etc/passwd"
const filePath = path.join(UPLOAD_DIR, req.body.filename);
await fs.readFile(filePath);
```

```ts
// ✅ resolve rồi kiểm tra tiền tố — dùng path.resolve, KHÔNG chỉ kiểm tra chuỗi
const base = path.resolve(UPLOAD_DIR);
const target = path.resolve(base, req.body.filename);
if (!target.startsWith(base + path.sep)) throw new ForbiddenError();
```

`path.resolve` xử lý `..` và đường dẫn tuyệt đối. Nhưng nó **không** theo symlink — nếu thư mục upload chứa một symlink trỏ ra ngoài, kiểm tra trên vẫn qua. Với dữ liệu không tin cậy, dùng `fs.realpath` rồi kiểm tra lại. Xem [Injection](../../05-cross-cutting/security/02-injection.md).

## Example

Chẩn đoán `EACCES` từ đầu tới cuối:

```bash
# 1. Process chạy dưới UID nào
docker exec app id
# uid=1001(app) gid=1001(app)

# 2. Thư mục đích thuộc về ai
docker exec app ls -ld /data /data/uploads
# drwxr-xr-x 3 1000 1000 4096 Jan 15 10:00 /data
# drwxr-xr-x 2 1000 1000 4096 Jan 15 10:00 /data/uploads
#            └─ UID 1000, process là 1001 → chỉ có quyền 'other' = r-x → không ghi được

# 3. Kiểm tra TỪNG thành phần đường dẫn (x trên mọi thư mục cha)
docker exec app namei -l /data/uploads/x.png

# 4. Sửa — chọn một
sudo chown -R 1001:1001 /host/data                 # ① ở host
# hoặc K8s:
#   securityContext: { fsGroup: 1001 }             # ③
# hoặc initContainer chạy root: chown -R 1001:1001 /data   # ④

# 5. Xác minh
docker exec app touch /data/uploads/test && echo OK
```

Bước 3 (`namei -l`) là công cụ ít được biết nhưng giải quyết đúng lớp lỗi này: nó in quyền của **mọi** thành phần trên đường dẫn, và thường vấn đề nằm ở một thư mục cha chứ không phải ở đích.

## Prediction

1. Process UID 1001 ghi vào thư mục owner 1000 mode 755 — được không? Vì sao?
2. Đổi thư mục thành mode 775 và thêm UID 1001 vào group 1000 — được không?
3. File có mode 777 nhưng thư mục cha có mode 644 — đọc file được không?
4. Container tạo file, host xem — file thuộc UID nào?
5. Container non-root UID 1001, host user UID 1000 muốn xoá file container tạo — được không?
6. `chmod -R 777 /data` "sửa" được lỗi — vấn đề gì còn lại?
7. Named volume tạo lần đầu từ image đã `chown 1001`, sau đó bạn đổi Dockerfile sang UID 1002 và deploy lại — quyền volume thế nào?
8. `umask 0022`, app tạo file — mode là gì? Process UID khác đọc được không? Ghi được không?
9. `readOnlyRootFilesystem: true` mà app ghi vào `/tmp` — chạy được không?
10. `path.join(UPLOAD_DIR, "../../etc/passwd")` — đường dẫn cuối là gì?
11. Kiểm tra bằng `target.startsWith(base)` với `base = /data/up` và `target = /data/upload-evil` — có chặn được không?
12. Binary setuid root trong image, `allowPrivilegeEscalation: false` — chạy được không?

<details>
<summary>Đáp án</summary>

1. **Không** — không phải owner, không thuộc group → chỉ có quyền `other` = `r-x`, thiếu `w`.
2. **Được** — quyền group là `rwx` và process thuộc group đó.
3. **Không** — thiếu `x` trên thư mục cha nên không đi xuyên qua được, bất kể quyền của file.
4. **UID của process trong container** (ví dụ 1001). Host hiển thị số đó, hoặc tên user tương ứng ở host nếu có.
5. **Không** trực tiếp (khác UID, thiếu quyền ghi trên thư mục) — trừ khi dùng `sudo` hoặc có quyền group.
6. Mọi process trên máy ghi được — kể cả process bị chiếm quyền. Nó là một lỗ hổng vĩnh viễn.
7. **Không đổi** — Docker chỉ sao chép quyền khi volume rỗng lần đầu. Phải xoá volume hoặc `chown` thủ công.
8. `644` (666 - 022). UID khác **đọc được**, **không ghi được**.
9. **Được** nếu `/tmp` được mount bằng `emptyDir`. Nếu không, `EROFS: read-only file system`.
10. `/etc/passwd` — `path.join` chuẩn hoá `..` và thoát ra khỏi thư mục gốc.
11. **Không** — `/data/upload-evil`.startsWith(`/data/up`) là `true`. Phải so với `base + path.sep`.
12. Binary chạy nhưng **không leo thang được quyền** — đó chính là mục đích của cờ này.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy container non-root ghi vào bind mount owner khác UID | `EACCES` |
| `chown` host theo UID container, lặp lại | Ghi được |
| `chmod 644` một thư mục rồi thử `cat` file bên trong | `permission denied` dù file 777 |
| `namei -l /a/b/c/file` khi bị `EACCES` | Thấy thành phần nào chặn |
| Container tạo file, `ls -l` ở host | UID của container |
| Thử xoá file đó từ host bằng user thường | Từ chối |
| `chmod 777`, lặp lại | Được — và bạn vừa mở lỗ hổng |
| Named volume + đổi UID trong Dockerfile, deploy lại | Quyền cũ vẫn giữ |
| Xoá volume rồi tạo lại | Quyền mới được áp dụng |
| `readOnlyRootFilesystem: true` không mount `/tmp` | `EROFS` |
| Thêm `emptyDir` cho `/tmp`, lặp lại | Chạy được |
| Gửi `filename = "../../etc/passwd"` tới endpoint upload | Đọc được file hệ thống |
| Thêm kiểm tra `path.resolve` + `startsWith(base + sep)` | Bị chặn |
| Tạo symlink trong thư mục upload trỏ ra ngoài, thử lại | Kiểm tra chuỗi không chặn được |

## What Usually Goes Wrong

- **UID không khớp giữa container và volume** → `EACCES` sau khi chuyển sang non-root.
- **`chmod 777` để "sửa"** → lỗ hổng vĩnh viễn.
- **Quên `x` trên thư mục cha** → lỗi khó hiểu vì file đích có quyền đúng.
- **Quên rằng named volume giữ quyền cũ** → sửa Dockerfile mà vẫn lỗi.
- **File do container tạo, host không quản lý được** → phiền toái vận hành kéo dài.
- **`readOnlyRootFilesystem` mà không mount chỗ ghi tạm** → app crash lúc khởi động.
- **Path traversal** → đọc/ghi file ngoài thư mục cho phép.
- **Kiểm tra tiền tố bằng chuỗi không có separator** → bỏ sót `/data/upload-evil`.
- **Secret file mode 644** → mọi process trên máy đọc được. Phải là `600` hoặc `400`.
- **Chạy root "cho nhanh"** → mất một lớp phòng thủ rẻ.
- **Không dùng `fsGroup` trong K8s** khi nó giải quyết đúng vấn đề.
- **Binary setuid trong image production** → bề mặt tấn công không cần thiết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Tên user quyết định quyền | Kernel chỉ so sánh **UID/GID** |
| `x` trên thư mục nghĩa là chạy được | Nó nghĩa là đi xuyên qua được |
| Quyền chỉ kiểm tra ở file đích | Kiểm tra ở **mọi** thành phần đường dẫn |
| `chmod 777` là cách sửa hợp lệ | Nó là một lỗ hổng |
| Named volume tự đồng bộ quyền với image | Chỉ lúc tạo lần đầu, khi rỗng |
| Container cô lập nên quyền không quan trọng | Volume dùng chung với host |
| Root trong container = root trên host | Chỉ khi không có user namespace remapping — nhưng thiệt hại vẫn lớn |
| `readOnlyRootFilesystem` làm app không chạy được | Chỉ cần mount tường minh chỗ ghi tạm |
| `path.join` chống được traversal | Nó **chuẩn hoá** `..`, tức là cho phép thoát ra |
| Kiểm tra `startsWith(base)` là đủ | Thiếu separator → bỏ sót tiền tố trùng |

## Debugging

Thứ tự cố định cho `EACCES`:

1. **Process là UID nào?** `id` trong container.
2. **Đích thuộc về ai, mode gì?** `ls -ld <path>`.
3. **Toàn bộ đường dẫn** — `namei -l /a/b/c/file`. Vấn đề thường ở thư mục cha.
4. **Process thuộc group nào?** `id -G` — có khớp GID của thư mục không?
5. **Filesystem có read-only không?** `mount | grep <path>` hoặc thử `touch`.
6. **Có SELinux/AppArmor không?** Trên RHEL/Fedora, SELinux từ chối cả khi quyền POSIX đúng: `ausearch -m avc -ts recent`, hoặc thêm `:z`/`:Z` vào bind mount.
7. **Với K8s**: `securityContext` của pod và container, và `fsGroup`.

Bước 6 đáng nhớ: trên hệ thống có SELinux, `ls -l` cho thấy quyền hoàn toàn đúng mà thao tác vẫn bị từ chối — vì có một tầng kiểm soát khác.

## Production Considerations

- **Chạy non-root**, với UID cố định khai báo tường minh trong Dockerfile.
- **`readOnlyRootFilesystem: true`** + `emptyDir` cho các thư mục cần ghi. Đây là biện pháp rẻ và hiệu quả.
- **`allowPrivilegeEscalation: false`** và `capabilities: drop ALL`.
- **`fsGroup` trong K8s** cho volume cần ghi — nó tự chown và tránh initContainer.
- **Secret file mode `0400` hoặc `0600`**, sở hữu bởi UID của app.
- **Không bao giờ `chmod 777`.** Nếu bạn thấy nó trong code hoặc script, đó là một việc cần sửa.
- **Validate mọi đường dẫn từ input người dùng**: `path.resolve` + kiểm tra tiền tố có separator, và `fs.realpath` nếu có khả năng có symlink.
- **Đặt UID/GID nhất quán** trên toàn bộ hệ thống (ví dụ mọi app dùng 1001) — nó loại bỏ cả một lớp vấn đề vận hành.
- **Ghi lại UID mà mỗi service dùng** trong tài liệu vận hành; người tạo volume cần thông tin đó.
- **Với dev dùng bind mount**, cân nhắc đặt UID container khớp UID của lập trình viên qua build arg.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Chạy non-root | giảm thiệt hại khi bị xâm nhập | phải xử lý quyền volume |
| Chạy root | không vướng quyền | mất một lớp phòng thủ |
| `chown` ở host | đơn giản, rõ ràng | cần quyền ở host, phải nhớ làm |
| `fsGroup` (K8s) | tự động | chỉ một số loại volume; chậm với volume lớn |
| initContainer chown | linh hoạt nhất | thêm container, cần root tạm |
| Named volume | ít xung đột UID | khó xem/sửa từ host |
| Bind mount | tiện cho dev, thấy được | xung đột UID thường xuyên |
| `readOnlyRootFilesystem` | chặn nhiều lớp tấn công | phải liệt kê chỗ ghi |
| Group chung + setgid | nhiều service ghi chung dễ | thêm khái niệm phải quản lý |
| `chmod 777` | "hoạt động" ngay | lỗ hổng vĩnh viễn |

## Explain Without Notes

1. Vì sao đổi sang non-root làm hỏng việc ghi volume?
2. `x` trên thư mục nghĩa là gì? Cho một ví dụ lỗi do thiếu nó.
3. Quyền được kiểm tra ở đâu trên một đường dẫn nhiều cấp?
4. Bốn cách xử lý quyền volume, và mỗi cách phù hợp khi nào?
5. Vì sao named volume vẫn giữ quyền cũ sau khi sửa Dockerfile?
6. Vì sao `chmod 777` không phải giải pháp?
7. `path.join` chống được path traversal không? Cách kiểm tra đúng?
8. `readOnlyRootFilesystem` chặn được gì, và bạn phải làm gì để app vẫn chạy?

## Related

- [Process, file & env](01-process-files-env.md) — UID của process
- [Volumes & state](../02-docker/03-volumes-state.md) — bind mount vs named volume
- [Production image](../02-docker/07-production-image.md) — non-root, read-only rootfs
- [Storage & StatefulSet](../04-kubernetes/workloads-networking/04-storage-statefulset.md) — `fsGroup`, PV
- [Debugging toolbox](07-debugging-toolbox.md) — `namei`, `lsof`, `stat`
- [Injection](../../05-cross-cutting/security/02-injection.md) — path traversal
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — mode của file secret
- [Docker common failures](../02-docker/08-common-failures.md) — `permission denied` trong danh sách lỗi kinh điển

## Version / Context

Linux. Trên hệ thống có SELinux (RHEL, Fedora, CentOS), cần thêm `:z` (chia sẻ) hoặc `:Z` (riêng) cho bind mount của Docker. macOS và Windows dùng lớp chuyển đổi riêng cho Docker volume nên hành vi quyền khác — điều này là nguồn của khác biệt "chạy máy tôi thì được".
