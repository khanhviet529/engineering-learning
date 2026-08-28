---
level: advanced
area: infra
prerequisites:
  - 01-image-container.md
  - ../00-linux/02-memory-cpu-limits.md
related:
  - 02-container-networking.md
  - 07-production-image.md
---

# Namespaces & cgroups

> Container "cô lập" của bạn chạy root, mount `/var/run/docker.sock` để build image trong CI. Một dependency bị chiếm quyền chạy `docker run --privileged -v /:/host alpine chroot /host`. Trong ba giây, nó có root trên **node**, không chỉ trong container. Cô lập của container là thật — nhưng nó là một tập hợp các cơ chế bạn có thể tắt, và mặc định thì nhiều cơ chế chưa được bật.

## Position

```text
Container = PROCESS + namespace (thấy gì) + cgroup (dùng bao nhiêu)
                     + capability (làm được gì) + seccomp (gọi syscall nào)
                                    ↑ note này
```

Docker không phát minh cơ chế nào. Nó **ghép sáu tính năng của kernel Linux** lại và cho chúng một API dễ dùng.

## Problem

"Container cô lập process" là câu nói đúng nhưng thiếu. Câu hỏi thực tế:

```text
① Cô lập CÁI GÌ?          namespace: PID, mạng, mount, user, IPC, UTS
② Giới hạn BAO NHIÊU?      cgroup: memory, CPU, PID, I/O
③ Làm được NHỮNG GÌ?       capability + seccomp
④ Cô lập CHẶT tới đâu?     dùng CHUNG kernel → không phải máy ảo
```

Trả lời sai câu ④ dẫn tới giả định nguy hiểm: coi container như một ranh giới bảo mật cứng. Nó là một ranh giới **mềm** — tốt cho cô lập lỗi và tài nguyên, không đủ để chạy code không tin cậy.

## Mental Model

### Sáu namespace

```text
PID      thấy process nào       → trong container, app là PID 1
NET      interface, route, port → localhost riêng, port riêng
MNT      cây filesystem         → nền tảng của image layer
UTS      hostname               → mỗi container một hostname
IPC      shared memory, queue   → không đụng IPC của host
USER     ánh xạ UID/GID         → root trong container ≠ root trên host
```

`USER` namespace là cơ chế mạnh nhất về bảo mật và **thường không được bật** theo mặc định:

```text
Không có user namespace:  root trong container = UID 0 THẬT trên host
                          → thoát container = root trên host
Có user namespace:        root trong container = UID 100000 trên host
                          → thoát container = một user không đặc quyền
```

Kiểm tra namespace của một process:

```bash
ls -l /proc/<pid>/ns/
# net -> 'net:[4026532288]'    ← số này khác nhau = namespace khác nhau
```

So sánh số này giữa hai container cho biết chúng có dùng chung namespace hay không — hữu ích khi debug pod trong Kubernetes.

### cgroup: giới hạn và kế toán

```text
memory.max     trần cứng → vượt là bị OOM kill
memory.high    ngưỡng mềm → bị bóp và ép reclaim
cpu.max        "quota period" → vượt là bị throttle
cpu.weight     tỉ lệ chia khi tranh chấp (từ CPU request)
pids.max       số process tối đa → chống fork bomb
io.max         giới hạn IOPS/băng thông
```

`pids.max` đáng chú ý vì nó ít được đặt và giải quyết một lớp tấn công đơn giản: một fork bomb trong container không giới hạn PID sẽ làm cạn PID của **toàn bộ node**.

Chi tiết memory và CPU: [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md).

### Capability: chia nhỏ quyền root

Linux chia quyền của root thành ~40 capability. Docker bỏ phần lớn theo mặc định, nhưng vẫn giữ một số:

```text
Docker giữ mặc định (một phần):
  CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, NET_BIND_SERVICE, KILL, ...

Đã bỏ mặc định:
  SYS_ADMIN, NET_ADMIN, SYS_PTRACE, SYS_MODULE, ...
```

`SETUID`/`SETGID` và `DAC_OVERRIDE` vẫn đủ để làm nhiều việc nếu attacker vào được container chạy root. Vì thế:

```yaml
securityContext:
  capabilities:
    drop: ["ALL"]                       # bỏ hết
    add: ["NET_BIND_SERVICE"]           # thêm lại đúng cái cần (nếu cần port <1024)
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false       # chặn binary setuid leo thang
  readOnlyRootFilesystem: true
  seccompProfile: { type: RuntimeDefault }
```

Sáu dòng này là cấu hình bảo mật container có tỉ lệ giá trị/chi phí cao nhất, và chúng không yêu cầu sửa ứng dụng (trừ `readOnlyRootFilesystem`, cần mount chỗ ghi tạm).

### seccomp: lọc syscall

```text
Profile mặc định của Docker chặn ~44 syscall nguy hiểm
  (mount, reboot, kexec_load, ptrace ở một số cấu hình...)
--security-opt seccomp=unconfined   → TẮT hoàn toàn ← đừng
```

Trong Kubernetes, `seccompProfile: RuntimeDefault` **không** phải mặc định ở mọi phiên bản — nên nó là một dòng đáng thêm tường minh.

### `--privileged`: tắt gần hết

```text
--privileged
  = mọi capability + tắt seccomp + tắt AppArmor + truy cập mọi thiết bị
  ≈ root trên HOST
```

Nó tồn tại cho những trường hợp thật sự cần (một số CNI, driver lưu trữ), và nó gần như không bao giờ là câu trả lời đúng cho ứng dụng.

Ba thứ tương đương về mức nguy hiểm:

```text
--privileged
-v /var/run/docker.sock:/var/run/docker.sock    ← tạo được container privileged
-v /:/host                                       ← đọc/ghi toàn bộ filesystem host
```

Điểm thứ hai là ví dụ ở đầu note: mount docker socket **là** cấp quyền root trên host, chỉ gián tiếp một bước.

Thay thế cho việc build image trong CI: Kaniko, BuildKit rootless, hoặc buildah — chúng build được mà không cần docker socket.

### Vì sao container không phải ranh giới bảo mật cứng

```text
Container: dùng CHUNG kernel với host
VM:        kernel riêng, ranh giới ở tầng hypervisor

⇒ một lỗ hổng kernel = thoát được container
⇒ container KHÔNG đủ để chạy CODE KHÔNG TIN CẬY
```

Với multi-tenant thật sự (chạy code của người dùng), cần thêm một lớp: gVisor (kernel userspace), Kata Containers (VM nhẹ), hoặc Firecracker.

Với hầu hết ứng dụng — code của chính bạn, dependency đã kiểm duyệt — container + cấu hình đúng là đủ. Điều quan trọng là biết ranh giới nằm ở đâu.

### Rootless Docker và user namespace

```bash
dockerd-rootless-setuptool.sh install
```

```text
+ daemon chạy dưới user thường → thoát container không cho root host
+ giảm mạnh hậu quả của lỗ hổng
- một số tính năng hạn chế (port <1024, một số storage driver, network mode)
```

Trong Kubernetes, `runAsNonRoot: true` + Pod Security Standards (`restricted`) cho phần lớn lợi ích tương tự với ít ràng buộc hơn.

## Example

Xem cơ chế bên dưới, và đo hiệu quả của cấu hình:

```bash
# 1. Namespace của container so với host
docker run -d --name t alpine sleep 300
PID=$(docker inspect t --format '{{.State.Pid}}')
ls -l /proc/$PID/ns/ /proc/1/ns/ | grep -E 'net|pid|mnt'
# số khác nhau → namespace khác nhau

# 2. Trên HOST vẫn thấy process của container (chỉ khác PID namespace)
ps -p $PID -o pid,user,comm

# 3. cgroup và giới hạn thật
cat /proc/$PID/cgroup
docker run --rm -m 100m alpine cat /sys/fs/cgroup/memory.max     # 104857600

# 4. Capability
docker run --rm alpine sh -c 'apk add -q libcap; capsh --print | head -3'
docker run --rm --cap-drop=ALL alpine sh -c 'apk add -q libcap; capsh --print | head -3'

# 5. Chứng minh vì sao root trong container nguy hiểm (chỉ trên máy thử nghiệm)
docker run --rm -v /etc:/host-etc alpine cat /host-etc/shadow
# → đọc được vì root trong container = UID 0 trên host
```

Bước 5 là thí nghiệm đáng chạy một lần: nó biến "chạy non-root là thực hành tốt" thành một điều bạn đã thấy tận mắt.

Cấu hình an toàn tương ứng:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }
resources:
  limits: { memory: 512Mi, cpu: "1" }
  requests: { memory: 256Mi, cpu: 100m }
```

## Prediction

1. Container chạy root, không có user namespace, thoát được container — quyền gì trên host?
2. Có user namespace (UID 0 ánh xạ thành 100000) — quyền gì?
3. `ps aux` trên host khi container chạy — thấy process của container không?
4. `ps aux` trong container — thấy process của host không?
5. `-v /var/run/docker.sock:/var/run/docker.sock` — attacker trong container làm được gì?
6. `--privileged` — những gì bị tắt?
7. Không đặt `pids.max`, fork bomb trong container — ảnh hưởng tới host không?
8. `capabilities: drop ALL` nhưng app cần bind port 80 — kết quả? Cách sửa?
9. `allowPrivilegeEscalation: false`, có binary setuid root trong image — chạy được không?
10. `readOnlyRootFilesystem: true`, app ghi vào `/tmp` không mount `emptyDir` — kết quả?
11. Chạy code không tin cậy của người dùng trong container thường — đủ an toàn không?
12. Hai container `--network=container:<id>` — namespace nào dùng chung?
13. `seccomp=unconfined` — mất lớp bảo vệ nào?

<details>
<summary>Đáp án</summary>

1. **Root trên host** — UID 0 trong container là UID 0 thật.
2. Quyền của **UID 100000** — một user không đặc quyền. Thiệt hại giảm rất nhiều.
3. **Có** — container là process trên kernel host; chỉ khác PID namespace.
4. **Không** — PID namespace riêng chỉ cho thấy process trong container.
5. Tạo container mới với `--privileged` và mount `/` → **root trên host**. Tương đương cấp root.
6. Mọi capability được cấp, seccomp tắt, AppArmor tắt, truy cập mọi thiết bị — gần như bằng root host.
7. **Có** — cạn PID của node, ảnh hưởng mọi container khác trên đó.
8. `EACCES` — port <1024 cần `CAP_NET_BIND_SERVICE`. Sửa: `add: ["NET_BIND_SERVICE"]`, hoặc tốt hơn là dùng port 8080 + proxy.
9. Binary **chạy được** nhưng **không leo thang quyền** — đó chính là mục đích của cờ này.
10. `EROFS: read-only file system` → app crash. Cần mount `emptyDir` cho `/tmp`.
11. **Không** — container dùng chung kernel; cần gVisor, Kata, hoặc VM.
12. **NET** (và tuỳ cấu hình có thể cả IPC) — đây là mô hình pod của Kubernetes.
13. Bộ lọc syscall — attacker gọi được syscall mà profile mặc định chặn (mount, một số thao tác kernel).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `docker run -v /etc:/host-etc alpine cat /host-etc/shadow` | Đọc được — root container = root host |
| Thêm `--user 1001`, lặp lại | Permission denied |
| `ls -l /proc/<pid>/ns/` so container và host | Số namespace khác nhau |
| `ps aux` trên host với container đang chạy | Thấy process |
| `docker run -m 50m` với app cấp phát 100MB | OOMKilled |
| `cat /sys/fs/cgroup/memory.max` trong container | Thấy giới hạn thật |
| Fork bomb không giới hạn `pids.max` (máy thử nghiệm!) | Cạn PID của host |
| Thêm `--pids-limit 100`, lặp lại | Bị chặn trong container |
| `--cap-drop=ALL` rồi thử bind port 80 | `EACCES` |
| Thêm `--cap-add=NET_BIND_SERVICE` | Được |
| `readOnlyRootFilesystem` không mount `/tmp` | `EROFS` |
| `--privileged` rồi `chroot` vào filesystem host | Root trên host |
| Mount docker.sock rồi tạo container privileged từ trong | Root trên host |

## What Usually Goes Wrong

- **Chạy root trong container** → thoát container = root host.
- **Mount `/var/run/docker.sock`** → tương đương cấp root, và nó rất phổ biến trong CI.
- **`--privileged` để "cho nhanh"** → tắt gần hết cô lập.
- **Không giới hạn memory** → một container làm chết node.
- **Không giới hạn PID** → fork bomb ảnh hưởng toàn node.
- **Không drop capability** → attacker có nhiều công cụ hơn cần thiết.
- **`allowPrivilegeEscalation` không tắt** → binary setuid leo thang được.
- **Coi container là ranh giới bảo mật cứng** → chạy code không tin cậy trong container thường.
- **Tắt seccomp** để "sửa" một lỗi → mở lại toàn bộ bề mặt syscall.
- **`readOnlyRootFilesystem` mà không mount chỗ ghi** → app crash, rồi người ta tắt cờ đó luôn.
- **Không dùng Pod Security Standards** → cấu hình an toàn phụ thuộc việc mỗi người nhớ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Container cô lập như máy ảo | Dùng chung kernel — ranh giới mềm hơn nhiều |
| Root trong container vô hại | Bằng root trên host nếu không có user namespace |
| Docker tự bảo vệ hoàn toàn | Nó cung cấp cơ chế; bạn phải bật |
| Container chỉ là "chroot tốt hơn" | Nó là namespace + cgroup + capability + seccomp |
| `--privileged` chỉ mở thêm vài quyền | Nó tắt gần như toàn bộ cô lập |
| Mount docker.sock là tiện ích vô hại | Nó tương đương cấp root trên host |
| cgroup chỉ để giới hạn tài nguyên | Nó cũng chống fork bomb và I/O storm |
| Drop capability làm app không chạy | Hầu hết app không cần capability nào |
| seccomp làm chậm đáng kể | Chi phí rất nhỏ |
| Container an toàn cho multi-tenant | Cần gVisor/Kata/VM cho code không tin cậy |

## Debugging

1. **Namespace nào?** `ls -l /proc/<pid>/ns/` — so số giữa các process.
2. **cgroup nào và giới hạn gì?** `cat /proc/<pid>/cgroup`, rồi đọc `memory.max`, `cpu.max` ở đường dẫn tương ứng.
3. **Capability hiện có?** `capsh --print` trong container, hoặc `grep Cap /proc/<pid>/status` rồi giải mã bằng `capsh --decode=`.
4. **`EACCES` không giải thích được** → thiếu capability, hoặc seccomp chặn syscall, hoặc AppArmor/SELinux.
5. **Syscall bị chặn?** Chạy tạm với `--security-opt seccomp=unconfined` để xác nhận nguyên nhân — rồi **thêm đúng cái cần**, không giữ unconfined.
6. **Kiểm tra cấu hình bảo mật của pod**: `kubectl get pod -o jsonpath='{.spec.containers[0].securityContext}'`.
7. **Quét cấu hình sai**: `docker-bench-security`, `kubescape`, hoặc `trivy` với chế độ misconfiguration.

## Production Considerations

- **`runAsNonRoot: true` với UID cố định**, ép bằng Pod Security Standards (`restricted`) hoặc admission policy — không dựa vào việc mỗi người nhớ.
- **`capabilities: drop ALL`**, thêm lại đúng cái cần.
- **`allowPrivilegeEscalation: false`** và **`readOnlyRootFilesystem: true`** + `emptyDir` cho chỗ ghi.
- **`seccompProfile: RuntimeDefault`** tường minh.
- **Memory limit luôn có; PID limit nên có.**
- **Không bao giờ mount docker socket** vào workload. Dùng Kaniko/BuildKit rootless cho build trong CI.
- **`--privileged` phải là ngoại lệ có phê duyệt**, và ghi lại lý do.
- **Cân nhắc rootless container runtime** hoặc user namespace nếu chạy workload từ nhiều nhóm khác nhau.
- **gVisor/Kata cho code không tin cậy** — nếu bạn chạy code của người dùng, container thường là không đủ.
- **Quét cấu hình trong CI**, không chỉ quét lỗ hổng image.
- **Ghi lại vì sao mỗi ngoại lệ tồn tại** (mỗi `privileged`, mỗi capability thêm vào) — nếu không, chúng tích luỹ và không ai dám xoá.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Non-root | giảm mạnh thiệt hại | phải xử lý quyền volume, port <1024 |
| Root | không vướng quyền | thoát container = root host |
| Drop ALL capability | bề mặt tấn công nhỏ nhất | phải thêm lại cái cần |
| Giữ capability mặc định | app nào cũng chạy | attacker có nhiều công cụ hơn |
| `readOnlyRootFilesystem` | chặn nhiều lớp tấn công | phải liệt kê chỗ ghi |
| seccomp `RuntimeDefault` | chặn syscall nguy hiểm | hiếm khi cản app, nhưng có thể |
| User namespace / rootless | cô lập mạnh nhất ở tầng container | một số tính năng hạn chế |
| gVisor / Kata | cô lập gần VM | chậm hơn, phức tạp hơn |
| Container thường | nhanh, đơn giản | không đủ cho code không tin cậy |
| PID limit | chống fork bomb | phải ước lượng số process |

## Explain Without Notes

1. Sáu namespace và mỗi cái cô lập gì?
2. User namespace giải quyết vấn đề gì? Vì sao nó quan trọng nhất về bảo mật?
3. cgroup giới hạn những gì, và `pids.max` chống được gì?
4. Vì sao mount docker socket tương đương cấp root trên host?
5. `--privileged` tắt những gì?
6. Vì sao container không đủ cho code không tin cậy?
7. Sáu dòng `securityContext` nên có mặc định, và mỗi dòng chặn gì?
8. Vì sao "chạy non-root" là biện pháp có giá trị cao nhất?

## Related

- [Image & container](01-image-container.md) — container là process
- [Container networking](02-container-networking.md) — network namespace
- [Volumes & state](03-volumes-state.md) — mount namespace
- [Production image](07-production-image.md) — non-root, distroless
- [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md) — cgroup chi tiết
- [Process, file & env](../00-linux/01-process-files-env.md) — PID namespace, `/proc`
- [Filesystem & permissions](../00-linux/03-filesystem-permissions.md) — UID và capability
- [Config, secrets & resources (K8s)](../04-kubernetes/operations/01-config-secrets-resources.md) — `securityContext`
- [Access control](../../05-cross-cutting/security/04-access-control.md) — nguyên tắc least privilege

## Version / Context

Linux kernel 5.x+, cgroup v2, Docker 24+. User namespace remapping trong Docker cần cấu hình `userns-remap`; rootless Docker là cách tiếp cận hiện đại hơn. Kubernetes: Pod Security Standards thay thế PodSecurityPolicy (đã bỏ từ 1.25). `seccompProfile: RuntimeDefault` là mặc định từ Kubernetes 1.27 với feature gate tương ứng — kiểm tra phiên bản của bạn.
