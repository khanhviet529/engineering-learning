---
level: intermediate
area: infra
prerequisites:
  - 01-image-container.md
  - 02-container-networking.md
related:
  - 03-volumes-state.md
  - ../00-linux/07-debugging-toolbox.md
---

# Những lỗi Docker kinh điển

> Note này không giới thiệu khái niệm mới. Nó là **danh mục các lỗi bạn sẽ gặp**, kèm mental model giải thích chúng — vì mỗi lỗi ở đây có một nguyên nhân *có thể suy luận được*, và khi biết cơ chế, bạn chẩn đoán trong 30 giây thay vì một buổi chiều.

## Position

```text
Triệu chứng  →  cơ chế bên dưới  →  cách sửa  →  cách phòng
```

## Mental Model

Gần như mọi lỗi Docker quy về một trong năm mô hình:

```text
① NAMESPACE       "localhost" của ai? mạng nào? PID nào?
② LAYER           bất biến; xoá không xoá được; cache theo hash
③ STATE           container bị xoá thì layer ghi biến mất
④ UID             kernel so sánh SỐ, không so sánh tên
⑤ PID 1           không có handler signal mặc định
```

Khi gặp một lỗi lạ, hỏi: **"nó thuộc mô hình nào trong năm cái này?"** Câu trả lời thường dẫn thẳng tới nguyên nhân.

## Danh mục lỗi

### ① `connection refused` từ host, dù container chạy

```text
Cơ chế: NAMESPACE. App bind 127.0.0.1 = loopback của CHÍNH container.
        Port mapping (DNAT) chuyển gói tới container:3000, nhưng app
        chỉ nghe loopback → gói từ ngoài namespace không được nhận.
```

```bash
docker exec app ss -tlnp
# LISTEN 0 511 127.0.0.1:3000    ← nguyên nhân
```

```ts
app.listen(port, '0.0.0.0');     // sửa
```

**Phòng:** luôn ghi rõ `'0.0.0.0'` trong code, không dựa vào mặc định.

### ② Container A gọi `localhost` tới container B

```text
Cơ chế: NAMESPACE. Mỗi container một network namespace → localhost riêng.
```

```text
Docker Compose:  postgres://db:5432        (tên service, port TRONG container)
Kubernetes:      postgres://db.default:5432
Tới host:        host.docker.internal (Desktop) / --add-host (Linux)
```

**Phòng:** dùng tên service ở mọi nơi, kể cả ở dev.

### ③ Restart mất dữ liệu

```text
Cơ chế: STATE. Layer ghi của container biến mất khi container bị xoá.
```

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
```

**Phòng:** trả lời "dữ liệu này mất được không" trước khi viết service.

### ④ `docker compose down -v` xoá sạch dữ liệu

```text
Cơ chế: cờ -v xoá volume. KHÔNG có xác nhận.
        `docker volume prune` cũng xoá volume của service đang DỪNG.
```

**Phòng:** đặt tên tường minh cho volume; backup dataset dev quan trọng; đừng để `-v` trong script quen tay.

### ⑤ `EACCES: permission denied` sau khi chuyển sang non-root

```text
Cơ chế: UID. Kernel so sánh SỐ. Container UID 1001 ghi vào thư mục
        owner 1000 mode 755 → chỉ có quyền 'other' = r-x.
```

```bash
docker exec app id                 # uid=1001
docker exec app ls -ld /data       # owner 1000
sudo chown -R 1001:1001 /host/data # hoặc fsGroup trong K8s
```

**Phòng:** UID cố định trong Dockerfile, ghi vào tài liệu, và dùng named volume khi được.

### ⑥ Sửa Dockerfile mà quyền volume vẫn cũ

```text
Cơ chế: named volume chỉ copy quyền/nội dung từ image khi TRỐNG, LẦN ĐẦU.
```

```bash
docker volume rm myproject_pgdata     # phải xoá để áp dụng quyền mới
```

### ⑦ `node_modules` biến mất khi mount code

```text
Cơ chế: mount CHE nội dung có sẵn của image tại điểm mount đó.
```

```yaml
volumes:
  - .:/app
  - /app/node_modules      # anonymous volume: mount cụ thể hơn THẮNG
```

**Phòng:** mẫu này nên có sẵn trong template Compose của team.

### ⑧ Build chậm — cài lại dependency mỗi lần đổi code

```text
Cơ chế: LAYER. COPY . . tính hash MỌI file → một byte đổi làm vô hiệu
        layer đó và MỌI layer sau.
```

```dockerfile
COPY package*.json ./
RUN npm ci
COPY . .
```

**Phòng:** đo thời gian build khi chỉ đổi code — nó phải dưới 30 giây.

### ⑨ Container mất ~10–30 giây mới tắt, exit 137

```text
Cơ chế: PID 1. Shell form CMD → sh là PID 1 → không forward SIGTERM
        → hết grace period → SIGKILL.
```

```dockerfile
CMD ["node", "dist/main.js"]     # exec form
```

```bash
docker exec <c> ps -o pid,comm   # PID 1 phải là 'node'
```

**Phòng:** kiểm tra PID 1 trong smoke test của CI.

### ⑩ Exit 137 ngay khi tải cao, không có log

```text
Cơ chế: OOMKilled. Kernel gửi SIGKILL — KHÔNG bắt được, không có log từ app.
```

```bash
docker inspect <c> --format '{{.State.OOMKilled}}'      # true
kubectl describe pod <p> | grep -A3 'Last State'        # Reason: OOMKilled
```

```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=384"   # ~75% memory limit
```

Đặt heap limit đổi chế độ hỏng từ SIGKILL im lặng sang lỗi **có stack trace**.

### ⑪ Image 1,4 GB

```text
Cơ chế: LAYER. Không multi-stage → công cụ build, source, devDependencies
        đều nằm trong image cuối.
```

```bash
docker history <image> | sort -k3 -h -r | head -5    # layer nào lớn
```

**Phòng:** đặt ngân sách kích thước image và kiểm tra trong CI.

### ⑫ Secret trong image

```text
Cơ chế: LAYER bất biến. `rm` ở layer sau chỉ CHE, không xoá.
        ARG hiện trong `docker history`.
```

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

**Nếu đã lỡ push: XOAY SECRET.** Xoá image không đủ.

### ⑬ Chạy được ở local, hỏng ở production

```text
Nguyên nhân thường gặp, theo thứ tự tần suất:
  · biến môi trường khác  → docker exec <c> env  vs  .env local
  · kiến trúc khác (Mac ARM → server x86) → docker buildx
  · tag di động (:latest) → hai môi trường hai image
  · bind mount ở dev che nội dung image
  · .dockerignore thiếu → .env hoặc node_modules của host vào image
```

**Phòng:** một artifact cho mọi môi trường, xác định bằng digest.

### ⑭ Đĩa đầy vì log container

```text
Cơ chế: log driver json-file KHÔNG giới hạn theo mặc định.
```

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

Và nhớ: **`rm` file log đang mở không giải phóng đĩa** — dùng `truncate -s 0`.

### ⑮ `no space left on device` dù `df -h` còn trống

```text
Hai nguyên nhân:
  · hết INODE           → df -i
  · image/layer/volume rác  → docker system df
```

```bash
docker system df
docker system prune -a --volumes    # ⚠️ --volumes xoá cả volume không dùng
```

### ⑯ `docker build` không thấy file

```text
Cơ chế: file bị .dockerignore loại, hoặc nằm ngoài build context.
```

```bash
docker build --progress=plain . 2>&1 | head -5   # xem context bao nhiêu
```

`COPY ../file .` **không hoạt động** — không thể ra ngoài context.

### ⑰ Timezone sai trong container

```text
Cơ chế: image tối giản mặc định UTC.
```

```dockerfile
ENV TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata
```

**Nhưng lựa chọn tốt hơn: giữ UTC ở mọi nơi** và chỉ đổi múi giờ ở tầng hiển thị. Lưu `timestamptz`, log UTC, so sánh UTC. Timezone trong container là một nguồn bug âm thầm.

### ⑱ `unable to get local issuer certificate`

```text
Cơ chế: image tối giản không có CA bundle.
```

```dockerfile
RUN apk add --no-cache ca-certificates
```

Với `scratch`: `COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/`.

## Example

Quy trình chẩn đoán chung — bốn lệnh trả lời phần lớn câu hỏi:

```bash
C=myapp

docker ps -a --filter name=$C            # đang chạy? exit code?
docker logs --tail 100 $C                # nó nói gì trước khi chết?
docker inspect $C --format '{{.State.ExitCode}} OOM={{.State.OOMKilled}} {{.State.Error}}'
docker exec $C sh -c 'id; ss -tlnp; env | sort' 2>/dev/null || echo "container không chạy"
```

Rồi rẽ nhánh theo exit code:

```text
0    thoát bình thường — có phải CMD kết thúc ngay không?
1    lỗi ứng dụng      → đọc log
125  lỗi của Docker daemon (tham số sai)
126  lệnh không thực thi được (thiếu quyền x)
127  lệnh không tồn tại (sai đường dẫn, thiếu binary trong image)
137  SIGKILL           → OOM hoặc hết grace period
139  SIGSEGV           → native crash
143  SIGTERM           → tắt theo yêu cầu, không dọn dẹp
```

Ba exit code 125/126/127 hay bị bỏ qua và chúng rất cụ thể: **127 nghĩa là binary không có trong image** — thường do dùng `alpine` mà quên rằng nó không có `bash`.

## Prediction

1. App bind `127.0.0.1` trong container với `-p 8080:3000` — `curl` từ host?
2. Container A gọi `localhost:5432` tới container B?
3. `docker rm` container có dữ liệu không dùng volume?
4. `docker compose down -v` — có xác nhận không?
5. Container UID 1001 ghi vào bind mount owner 1000 mode 755?
6. Đổi UID trong Dockerfile nhưng named volume đã tồn tại?
7. Mount `.:/app` với image có `/app/node_modules`?
8. `COPY . .` trước `RUN npm ci`, sửa `README.md`?
9. `CMD npm start`, `docker stop`?
10. Exit 137 với `OOMKilled: false`?
11. `COPY secret . && RUN rm secret` — secret còn không?
12. Exit 127 — nghĩa là gì?
13. `df -h` còn 40% nhưng `no space left on device`?

<details>
<summary>Đáp án</summary>

1. **Refused** — app chỉ nghe loopback của namespace container.
2. **Refused** — `localhost` của A là chính A.
3. **Mất dữ liệu** — layer ghi biến mất.
4. **Không** — xoá ngay.
5. **`EACCES`** — chỉ có quyền `other` = `r-x`.
6. **Quyền cũ giữ nguyên** — volume chỉ kế thừa khi trống lần đầu.
7. `node_modules` từ image bị **che**.
8. **`npm ci` chạy lại** — `COPY . .` tính hash mọi file.
9. Chờ ~10 giây rồi SIGKILL → **exit 137**; handler không chạy.
10. Hết grace period khi shutdown, hoặc bị `docker kill` — không phải OOM.
11. **Còn** — trong layer trước.
12. **Lệnh không tồn tại** — thường là dùng `bash` trong image alpine (chỉ có `sh`).
13. Hết **inode** (`df -i`), hoặc `/var/lib/docker` ở phân vùng khác đã đầy.
</details>

## Break It

Chạy từng cái một lần — mỗi thí nghiệm mất dưới một phút và dạy một mô hình:

| Thí nghiệm | Mô hình |
|---|---|
| Bind `127.0.0.1` rồi curl từ host | ① namespace |
| Gọi `localhost` giữa hai container | ① namespace |
| Ghi file rồi `docker rm` và chạy lại | ③ state |
| `docker compose down -v` | ③ state |
| Chạy `--user 1001` ghi vào thư mục owner 1000 | ④ UID |
| Đổi UID trong Dockerfile với volume đã tồn tại | ④ UID + ② layer |
| Mount `.` che `node_modules` | ② layer bị che |
| `COPY . .` trước `npm ci`, sửa một file | ② layer cache |
| `CMD npm start` + `docker stop` | ⑤ PID 1 |
| `-m 100m` với app cấp phát 200MB | cgroup |
| `COPY secret && rm` rồi `docker history` | ② layer bất biến |
| Chạy `bash` trong image alpine | exit 127 |
| Ghi log liên tục không `max-size` | log driver |
| `docker system df` sau vài tháng dev | rác tích luỹ |

## Debugging

Quy trình chung, dùng cho mọi lỗi trong danh mục:

```text
① Container có chạy không?        docker ps -a
② Exit code là gì?                docker inspect ... ExitCode, OOMKilled
③ Log nói gì?                     docker logs --tail 100
④ Bên trong ra sao?               docker exec: id, ss -tlnp, env, ls -ld
⑤ Nó thấy gì?                     docker inspect: Mounts, Networks
⑥ Nó bị giới hạn gì?              /sys/fs/cgroup/memory.max
⑦ Image có gì?                    docker history, dive
```

Và câu hỏi phân loại: **lỗi này thuộc mô hình nào trong năm cái?** Namespace, layer, state, UID, hay PID 1.

Với container không chạy được để `exec`:

```bash
docker run --rm -it --entrypoint sh <image>       # vào image, bỏ qua entrypoint
docker create <image> && docker cp <id>:/app /tmp/inspect   # lấy file ra
```

## Production Considerations

- **Smoke test trong CI** kiểm tra: PID 1 đúng, chạy non-root, không có secret trong layer, exit code 0 khi nhận SIGTERM. Bốn kiểm tra này chặn bốn lớp lỗi trong danh mục.
- **Đặt `max-size` cho log driver** ở mọi node.
- **Đặt memory limit** cho mọi container.
- **Ghim version base image và deploy bằng digest.**
- **Template Dockerfile và Compose dùng chung trong tổ chức** — nó ngăn lớp lỗi ⑦, ⑧, ⑨ ngay từ đầu.
- **Runbook cho ba triệu chứng phổ biến**: `connection refused`, exit 137, `EACCES`.
- **`docker system prune` định kỳ trên node dev/CI** — rác tích luỹ nhanh hơn bạn nghĩ.
- **Giữ UTC ở mọi nơi**; chỉ đổi múi giờ ở tầng hiển thị.
- **Ghi lại mỗi lỗi mới gặp** vào danh mục nội bộ — nó biến kinh nghiệm cá nhân thành kiến thức của team.

## Explain Without Notes

1. Năm mô hình giải thích gần như mọi lỗi Docker?
2. Vì sao `connection refused` từ host dù container chạy?
3. Vì sao `rm` file trong Dockerfile không xoá được secret?
4. Vì sao named volume giữ quyền cũ sau khi sửa Dockerfile?
5. Vì sao `CMD npm start` gây exit 137?
6. Exit 127 nghĩa là gì, và nguyên nhân phổ biến?
7. Bốn lệnh đầu tiên khi container có vấn đề?
8. Vì sao `rm` file log không giải phóng đĩa?

## Related

- [Image & container](01-image-container.md) — layer, tag, PID 1
- [Container networking](02-container-networking.md) — `localhost`, port mapping
- [Volumes & state](03-volumes-state.md) — mất dữ liệu, quyền volume
- [Namespaces & cgroups](04-namespaces-cgroups.md) — cô lập và giới hạn
- [Dockerfile & build cache](05-dockerfile-build-cache.md) — build chậm
- [Production image](07-production-image.md) — image lớn, secret
- [Ports & sockets](../00-linux/05-ports-sockets.md) — bind interface
- [Filesystem & permissions](../00-linux/03-filesystem-permissions.md) — UID
- [Signals & lifecycle](../00-linux/04-signals-lifecycle.md) — exit code
- [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md) — OOMKilled
- [Debugging toolbox](../00-linux/07-debugging-toolbox.md) — công cụ chung

## Version / Context

Docker 24+ với BuildKit. Exit code theo quy ước `128 + signal`. `docker system prune -a --volumes` xoá cả volume không dùng — cẩn thận.
