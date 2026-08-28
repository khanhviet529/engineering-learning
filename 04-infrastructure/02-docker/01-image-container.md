---
level: foundation
area: infra
prerequisites:
  - ../00-linux/01-process-files-env.md
related:
  - 04-namespaces-cgroups.md
  - 05-dockerfile-build-cache.md
  - 08-common-failures.md
---

# Image & container

> Bạn sửa một dòng trong `src/index.ts`, chạy `docker build`, và nó mất 8 phút — cài lại toàn bộ `node_modules` từ đầu. Lần build trước cũng vậy. Không có gì hỏng: Dockerfile của bạn đang nói với Docker rằng **mọi thứ đã thay đổi**, và Docker tin.

## Position

```text
Dockerfile  ──build──▶  IMAGE (bất biến, nhiều layer)
                          │
                          ├──run──▶ CONTAINER 1  (layer ghi riêng)
                          ├──run──▶ CONTAINER 2
                          └──run──▶ CONTAINER 3
```

Hai khái niệm, và nhầm chúng là nguồn của phần lớn hiểu lầm về Docker:

```text
IMAGE      công thức, bất biến, chia sẻ được
CONTAINER  một PROCESS đang chạy + một layer ghi TẠM THỜI
```

## Problem

Container giải quyết một vấn đề cụ thể: **"chạy được trên máy tôi"**.

```text
Không có container:
  · phiên bản Node khác nhau giữa dev và production
  · thư viện hệ thống thiếu (libssl, glibc)
  · biến môi trường khác
  · thứ tự cài đặt khác
  → mỗi lần deploy là một lần khám phá
```

Image đóng gói **toàn bộ userspace**: binary, thư viện, cấu hình. Chỉ kernel là dùng chung với host.

Nhưng nó tạo ra ba vấn đề mới:

```text
① Build chậm      → cache layer bị vô hiệu ở sai chỗ
② Image khổng lồ  → 1,2 GB cho một app 5 MB; pull chậm, tốn tiền
③ Dữ liệu biến mất → container bị xoá, mọi thứ ghi trong nó biến mất
```

## Mental Model

### Image là chồng layer chỉ-đọc

```text
┌─────────────────────────┐
│ layer ghi (container)   │  ← chỉ tồn tại khi container chạy
├─────────────────────────┤
│ COPY dist/              │  ← mỗi lệnh Dockerfile = một layer
│ RUN npm ci              │
│ COPY package*.json      │
│ FROM node:20-alpine     │  ← base image
└─────────────────────────┘
```

Ba tính chất quan trọng:

```text
① Layer BẤT BIẾN và được chia sẻ giữa mọi container dùng image đó
② Container chỉ thêm MỘT layer ghi mỏng (copy-on-write)
③ Xoá file ở layer trên KHÔNG xoá nó ở layer dưới — chỉ che đi
```

Tính chất ③ là nguồn của một lỗi bảo mật kinh điển:

```dockerfile
COPY secret.key .
RUN ./setup.sh && rm secret.key    # ← file bị "xoá" nhưng VẪN nằm trong layer trước
```

```bash
docker history --no-trunc <image>    # thấy mọi lệnh
# và với `docker save`, có thể trích xuất file từ layer cũ
```

Secret một khi đã vào một layer thì **nằm đó vĩnh viễn** trong image đó. Cách duy nhất tránh: đừng để nó vào layer nào — dùng multi-stage build hoặc BuildKit secret mount. Xem [Production image](07-production-image.md).

### Container là process, không phải máy ảo

```text
Máy ảo:    kernel riêng, boot đầy đủ, GB RAM, khởi động vài chục giây
Container: PROCESS trên kernel CỦA HOST, cô lập bằng namespace + cgroup
           khởi động mili giây, overhead gần bằng 0
```

Hệ quả trực tiếp:

```text
· ps aux trên host THẤY process trong container (chỉ khác PID namespace)
· container KHÔNG có kernel riêng → không load module, không sysctl tuỳ ý
· image Linux không chạy trên kernel Windows (và ngược lại)
· thoát container = có quyền trên host → chạy root trong container là rủi ro
```

Xem [Namespaces & cgroups](04-namespaces-cgroups.md).

### Build cache: quy tắc quyết định tốc độ

```text
Docker tính một hash cho mỗi lệnh.
Nếu hash KHỚP cache → dùng lại layer.
Nếu KHÔNG khớp → build lại lệnh đó VÀ MỌI LỆNH SAU NÓ.
```

Từ đó ra nguyên tắc duy nhất cần nhớ: **thứ ít thay đổi đặt TRƯỚC, thứ hay thay đổi đặt SAU.**

```dockerfile
# ❌ đổi một dòng code → npm ci chạy lại
COPY . .
RUN npm ci
RUN npm run build

# ✅ chỉ khi package.json đổi mới cài lại
COPY package*.json ./
RUN npm ci                 # ← layer này được cache qua hàng trăm lần build
COPY . .
RUN npm run build
```

Với `COPY . .`, hash được tính từ **nội dung mọi file** — nên sửa `README.md` cũng làm `npm ci` chạy lại. Đó chính là vấn đề ở đầu note.

Và `.dockerignore` quan trọng hơn nó có vẻ:

```text
node_modules/
.git/
dist/
*.log
.env*
```

Không có nó, `COPY . .` gửi toàn bộ `node_modules` và `.git` vào build context — làm build chậm, image lớn, và có thể **đưa `.env` vào image**.

### `CMD` vs `ENTRYPOINT`

```dockerfile
ENTRYPOINT ["node", "dist/main.js"]   # cố định, khó ghi đè
CMD ["--port", "3000"]                 # tham số mặc định, dễ ghi đè
```

```text
docker run img                    → node dist/main.js --port 3000
docker run img --port 8080        → node dist/main.js --port 8080
docker run img sh                 → node dist/main.js sh   (không phải shell!)
docker run --entrypoint sh img    → sh
```

Và khác biệt quan trọng hơn nhiều — **shell form vs exec form**:

```dockerfile
CMD npm start                      # shell form → /bin/sh -c "npm start"
                                   # → sh là PID 1, KHÔNG forward SIGTERM
CMD ["node", "dist/main.js"]       # exec form → node là PID 1  ✓
```

Shell form là nguyên nhân của "container mất 10–30 giây mới tắt và exit 137". Xem [Signals & lifecycle](../00-linux/04-signals-lifecycle.md).

### Container không lưu dữ liệu

```text
docker rm <container>  → layer ghi BIẾN MẤT
```

Mọi thứ ghi vào filesystem của container (log, upload, database file) mất khi container bị xoá — và container **được thiết kế để bị xoá**: mỗi lần deploy là một container mới.

Dữ liệu cần tồn tại phải ở volume hoặc ở dịch vụ bên ngoài. Xem [Volumes & state](03-volumes-state.md).

### Tag không phải định danh

```text
myapp:latest  hôm nay ≠  myapp:latest ngày mai
   → tag là con trỏ có thể DI CHUYỂN
   → "build once, deploy many" bị phá vỡ

myapp@sha256:abc123...  ← digest, BẤT BIẾN, định danh thật
```

Dùng `:latest` ở production nghĩa là bạn không biết chắc phiên bản nào đang chạy, và rollback trở nên không xác định. Dùng tag có version (`v1.4.2`) hoặc digest.

Cùng lý lẽ cho base image: `FROM node:20` sẽ đổi khi có bản vá; `FROM node:20.11.1-alpine3.19` thì không.

### Registry và pull

```text
docker pull chỉ tải layer CHƯA CÓ ở local
   → base image dùng chung giữa nhiều app = pull nhanh
   → đây là lý do dùng CHUNG base image tiết kiệm thật

imagePullPolicy:
  Always        luôn kiểm tra registry
  IfNotPresent  dùng local nếu có          ← nguy hiểm với tag di động
  Never         chỉ dùng local
```

Với tag `:latest` và `IfNotPresent`, node đã có image cũ sẽ **không bao giờ** lấy bản mới — một nguồn của "pod này chạy code cũ".

## Example

Cùng một app, hai Dockerfile:

```dockerfile
# ❌ 1,2 GB, build 8 phút mỗi lần đổi code
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD npm start
```

```dockerfile
# ✅ ~180 MB, build ~15 giây khi chỉ đổi code
FROM node:20.11.1-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci                              # cache qua hàng trăm lần build

FROM node:20.11.1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20.11.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Bảy quyết định trong bản thứ hai:

```text
alpine + version cố định   nhỏ, tái lập được
multi-stage                công cụ build KHÔNG vào image cuối
COPY package*.json trước   cache npm ci
npm prune --omit=dev       bỏ devDependencies
non-root                   giảm thiệt hại nếu bị xâm nhập
exec form CMD              node là PID 1, nhận SIGTERM
NODE_ENV=production        nhiều thư viện đổi hành vi theo nó
```

Đo:

```bash
docker images myapp                          # kích thước
docker history myapp                         # layer nào lớn
time docker build -t myapp .                 # lần đầu
touch src/index.ts && time docker build -t myapp .   # sau khi đổi code
```

Con số thứ hai là con số quan trọng — nó là thứ bạn trả giá hàng chục lần mỗi ngày.

## Prediction

1. `COPY . .` trước `RUN npm ci`, sửa `README.md` — `npm ci` có chạy lại không?
2. Đảo thứ tự, sửa `README.md` — có chạy lại không?
3. `COPY secret.key . && RUN rm secret.key` — secret còn trong image không?
4. `CMD npm start`, `docker stop` — mất bao lâu? Exit code?
5. `CMD ["node", "app.js"]` — khác gì?
6. `docker run img sh` với `ENTRYPOINT ["node","app.js"]` — chạy gì?
7. Container ghi file vào `/app/uploads`, `docker rm` rồi `docker run` lại — file còn không?
8. `myapp:latest` với `imagePullPolicy: IfNotPresent`, node đã có image cũ — pod chạy code nào?
9. Không có `.dockerignore`, thư mục có `node_modules` 800 MB — build context bao nhiêu?
10. Hai image cùng base `node:20-alpine`, pull cả hai — tải base mấy lần?
11. `FROM node:20` build hôm nay và 3 tháng sau — có giống nhau không?
12. `ps aux` trên host khi có container chạy Node — thấy process không?
13. Image build trên macOS ARM, chạy trên server x86 — được không?

<details>
<summary>Đáp án</summary>

1. **Có** — `COPY . .` tính hash mọi file; một byte đổi là cache vô hiệu, và mọi lệnh sau đó chạy lại.
2. **Không** — `npm ci` chỉ phụ thuộc `package*.json`.
3. **Còn** — nó nằm trong layer trước và trích xuất được. `rm` chỉ che nó ở layer sau.
4. Shell là PID 1, không forward SIGTERM → chờ ~10 giây (mặc định `docker stop`) rồi SIGKILL → **exit 137**.
5. `node` là PID 1, nhận SIGTERM, chạy handler → thoát ngay, **exit 0**.
6. `node app.js sh` — `sh` trở thành **tham số** của node, không phải lệnh. Cần `--entrypoint sh`.
7. **Mất** — layer ghi biến mất cùng container.
8. **Code cũ** — node đã có image với tag đó nên không pull lại. Nguồn của "pod này chạy code cũ".
9. Toàn bộ ~800 MB+ được gửi tới daemon → build chậm, và `node_modules` của host (có thể sai kiến trúc) vào image.
10. **Một lần** — layer được chia sẻ.
11. **Không** — `node:20` là tag di động, sẽ có bản vá mới.
12. **Có** — container là process trên kernel host, chỉ khác PID namespace.
13. **Không** trực tiếp — cần build multi-arch (`docker buildx`) hoặc build đúng nền tảng đích.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `COPY . .` trước `npm ci`, sửa một file, build lại | Cài lại từ đầu; đo thời gian |
| Đảo thứ tự, lặp lại | Nhanh hơn nhiều |
| Xoá `.dockerignore`, build với `node_modules` lớn | Build context khổng lồ |
| `COPY secret . && RUN rm secret`, rồi `docker history --no-trunc` | Thấy lệnh; trích xuất được file |
| `CMD npm start` + `docker stop`, đo thời gian và exit code | ~10s, 137 |
| Đổi sang exec form, lặp lại | Tức thì, 0 |
| Ghi file vào container, `docker rm`, `docker run` lại | Mất |
| Thêm volume, lặp lại | Còn |
| So `docker images` giữa `node:20` và `node:20-alpine` | Chênh hàng trăm MB |
| `docker history <image>` sắp theo kích thước | Layer nào chiếm chỗ |
| Build cùng Dockerfile hai lần cách nhau với `FROM node:20` | Có thể khác nhau |
| `docker run` image ARM trên x86 | Lỗi kiến trúc |
| `ps aux \| grep node` trên host khi container chạy | Thấy process |

## What Usually Goes Wrong

- **`COPY . .` trước khi cài dependency** → cache vô hiệu mỗi lần đổi code; build chậm gấp hàng chục lần.
- **Không có `.dockerignore`** → build context khổng lồ, `.env` và `node_modules` vào image.
- **Secret trong layer** → nằm vĩnh viễn trong image, `rm` không xoá được.
- **Shell form `CMD`** → PID 1 sai, không nhận SIGTERM, exit 137 mỗi lần deploy.
- **Ghi dữ liệu vào container** → mất khi container bị xoá.
- **`:latest` ở production** → không biết phiên bản nào đang chạy, rollback không xác định.
- **Base image không ghim version** → build không tái lập được.
- **`imagePullPolicy: IfNotPresent` với tag di động** → node chạy image cũ.
- **Không multi-stage** → công cụ build, source code, devDependencies vào image cuối.
- **Chạy root** → mất một lớp phòng thủ rẻ.
- **Image quá lớn** → pull chậm, scale chậm, tốn băng thông và tiền lưu trữ.
- **Không có `NODE_ENV=production`** → nhiều thư viện chạy ở chế độ dev (chậm, verbose).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Container là máy ảo nhẹ | Nó là **process** trên kernel host |
| Container có kernel riêng | Dùng chung kernel với host |
| `rm` file trong Dockerfile xoá nó khỏi image | Chỉ che ở layer sau; layer trước vẫn có |
| Tag là định danh của image | Tag di chuyển được; digest mới bất biến |
| `:latest` là phiên bản mới nhất | Nó chỉ là một cái tên như mọi tag khác |
| Dữ liệu trong container an toàn | Mất khi container bị xoá |
| Nhiều `RUN` gộp lại luôn tốt hơn | Gộp giảm số layer nhưng cũng giảm khả năng cache |
| Image nhỏ chỉ để tiết kiệm chỗ | Nó còn giảm bề mặt tấn công và thời gian scale |
| `CMD` và `ENTRYPOINT` thay thế nhau | `ENTRYPOINT` cố định, `CMD` là tham số mặc định |
| Container luôn cô lập hoàn toàn | Cô lập bằng namespace; thoát container là có thật |

## Debugging

1. **Build chậm** → `docker build --progress=plain` để thấy layer nào không cache. Tìm lệnh đầu tiên báo "not cached".
2. **Image lớn** → `docker history <image>` sắp theo `SIZE`. Thường một hoặc hai layer chiếm phần lớn.
3. **Container thoát ngay** → `docker logs <c>`, rồi `docker inspect <c> --format '{{.State.ExitCode}} {{.State.Error}}'`.
4. **PID 1 sai** → `docker exec <c> ps -o pid,comm` — phải là app của bạn.
5. **File không có trong image** → `docker run --rm -it <image> sh` rồi tìm; kiểm tra `.dockerignore`.
6. **"Code cũ đang chạy"** → so digest: `docker inspect <c> --format '{{.Image}}'` với digest bạn vừa push.
7. **Build khác nhau giữa các máy** → base image có ghim version không? Có `.dockerignore` nhất quán không?
8. **Kiểm tra secret trong layer** → `docker history --no-trunc <image>`, hoặc `dive` để duyệt từng layer.

## Production Considerations

- **Ghim version base image** (`node:20.11.1-alpine3.19`), và cập nhật có chủ đích.
- **Deploy bằng digest hoặc tag bất biến**, không dùng `:latest`.
- **Multi-stage build** để công cụ build không vào image cuối.
- **`.dockerignore`** đầy đủ — nó ảnh hưởng cả tốc độ lẫn bảo mật.
- **Không bao giờ để secret vào layer** — dùng BuildKit secret mount hoặc truyền lúc chạy.
- **Exec form cho `CMD`/`ENTRYPOINT`.**
- **Non-root** với UID cố định.
- **Quét lỗ hổng trong CI** (`trivy`, `grype`) và có ngưỡng chặn build.
- **Base image dùng chung giữa các service** → pull nhanh hơn, vá một chỗ.
- **Đo thời gian build khi chỉ đổi code** — đó là con số bạn trả giá nhiều lần mỗi ngày.
- **Đo thời gian pull + start** — nó là một phần của thời gian phục hồi khi có sự cố và của tốc độ autoscale.
- **Build cache dùng chung trong CI** (`--cache-from`, registry cache) — không có nó, CI build lại từ đầu mỗi lần.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Alpine base | rất nhỏ | musl libc khác glibc; một số native module cần build lại |
| Debian slim | tương thích tốt | lớn hơn ~50–100 MB |
| Distroless | nhỏ, bề mặt tấn công tối thiểu | không có shell → khó debug |
| Ghim version chính xác | tái lập được | phải chủ động cập nhật bản vá |
| Tag di động (`node:20`) | tự có bản vá | build không tái lập được |
| Nhiều layer nhỏ | cache tốt hơn | nhiều metadata (ít quan trọng ngày nay) |
| Gộp lệnh `RUN` | ít layer | mất cache khi một phần đổi |
| Multi-stage | image nhỏ, sạch | Dockerfile dài hơn |
| Single-stage | đơn giản | image lớn, chứa công cụ build |
| `:latest` | tiện lúc dev | không xác định ở production |
| Digest | chính xác tuyệt đối | dài, phải tự động hoá |

## Explain Without Notes

1. Image và container khác nhau thế nào? Cái nào bất biến?
2. Vì sao `rm` một file trong Dockerfile không xoá nó khỏi image?
3. Quy tắc thứ tự lệnh trong Dockerfile, và vì sao nó quyết định tốc độ build?
4. Shell form và exec form khác nhau thế nào? Hệ quả với SIGTERM?
5. Vì sao container không phải máy ảo, và ba hệ quả của điều đó?
6. Vì sao `:latest` không nên dùng ở production?
7. `CMD` và `ENTRYPOINT` — mỗi cái dùng khi nào?
8. Vì sao `.dockerignore` ảnh hưởng cả tốc độ lẫn bảo mật?

## Related

- [Namespaces & cgroups](04-namespaces-cgroups.md) — cơ chế cô lập bên dưới
- [Dockerfile & build cache](05-dockerfile-build-cache.md) — tối ưu build
- [Production image](07-production-image.md) — nhỏ, an toàn, non-root
- [Volumes & state](03-volumes-state.md) — dữ liệu tồn tại lâu hơn container
- [Container networking](02-container-networking.md) — `localhost` trong container
- [Common failures](08-common-failures.md) — các lỗi kinh điển
- [Process, file & env](../00-linux/01-process-files-env.md) — PID 1
- [Signals & lifecycle](../00-linux/04-signals-lifecycle.md) — vì sao exec form quan trọng
- [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md) — một artifact, nhiều môi trường

## Version / Context

Docker 24+ với BuildKit (mặc định). `docker buildx` cho build multi-arch. Công cụ hữu ích: `dive` (duyệt layer), `trivy` (quét lỗ hổng). Distroless từ Google Container Tools.
