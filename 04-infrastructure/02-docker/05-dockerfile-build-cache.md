---
level: intermediate
area: infra
prerequisites:
  - 01-image-container.md
related:
  - 07-production-image.md
  - ../03-cicd/01-pipeline.md
---

# Dockerfile & build cache

> CI mất 11 phút cho mỗi commit, và 9 phút trong đó là `npm ci`. Trên máy dev nó chỉ mất 12 giây vì cache. Cùng một Dockerfile, cùng một lệnh — khác biệt là **CI không có cache**, và không ai cấu hình cho nó có.

## Position

```text
Dockerfile ──▶ BuildKit ──▶ layer cache ──▶ image
                              ↑ note này: cái gì làm nó vô hiệu, và làm sao chia sẻ
```

## Problem

Build chậm là chi phí bạn trả **hàng chục lần mỗi ngày**:

```text
11 phút × 20 build/ngày × 5 người = 18 giờ chờ mỗi ngày
```

Và nó không chỉ là thời gian: build chậm làm người ta gộp nhiều thay đổi vào một commit, test ít hơn, và tránh CI.

Hai nguyên nhân, và chúng độc lập:

```text
① Cache bị vô hiệu ở sai chỗ    → Dockerfile viết sai thứ tự
② Không có cache để dùng         → CI chạy trên runner sạch mỗi lần
```

Sửa ① mà quên ② thì CI vẫn chậm.

## Mental Model

### Cache theo layer, và nó lan xuống

```text
Mỗi lệnh Dockerfile = một layer, có một hash.
Hash khớp cache → dùng lại.
Hash KHÔNG khớp → build lại lệnh đó VÀ MỌI LỆNH SAU NÓ.
```

Hash được tính từ:

```text
RUN         chuỗi lệnh (chỉ là TEXT — không phải kết quả của nó)
COPY / ADD  NỘI DUNG file (checksum), + metadata (quyền, thời gian với ADD)
FROM        digest của base image
ENV / ARG   giá trị (nếu được dùng trong lệnh sau)
```

Điểm về `RUN`: Docker **không biết** lệnh đó làm gì. `RUN apt-get update` cho kết quả khác nhau mỗi ngày nhưng hash giống nhau → cache trả về gói cũ. Đây là lý do phải gộp `update` và `install` trong một `RUN`.

### Quy tắc thứ tự

```text
Ổn định nhất  →  hay thay đổi nhất
base image → công cụ hệ thống → dependency → cấu hình → MÃ NGUỒN
```

```dockerfile
# ❌ đổi một dòng code → cài lại toàn bộ dependency
COPY . .
RUN npm ci && npm run build

# ✅ chỉ khi package.json đổi mới cài lại
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
```

### `.dockerignore`: ảnh hưởng nhiều hơn bạn nghĩ

```text
node_modules/
.git/
dist/
coverage/
*.log
.env*
Dockerfile
docker-compose*.yml
**/.DS_Store
```

Ba tác dụng:

```text
① Build context nhỏ hơn → gửi ít dữ liệu tới daemon → nhanh hơn
② COPY . . không bị vô hiệu bởi file không liên quan (log, .git)
③ Không vô tình đưa .env hay node_modules (sai kiến trúc) vào image
```

Kiểm tra context đang gửi bao nhiêu:

```bash
docker build --no-cache --progress=plain . 2>&1 | head -5
# => transferring context: 1.2MB     ← nếu là hàng trăm MB, .dockerignore thiếu
```

### BuildKit: cache mount

Đây là tính năng có tác động lớn nhất và ít được dùng nhất:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
```

```text
Cache mount ≠ layer cache:
  · layer cache: dùng lại CẢ layer khi hash khớp
  · cache mount: thư mục TỒN TẠI QUA các lần build, kể cả khi layer phải chạy lại

⇒ package.json đổi → npm ci CHẠY LẠI, nhưng tải gói từ cache cục bộ
⇒ 9 phút → 40 giây
```

Tương đương cho các hệ sinh thái khác:

```dockerfile
RUN --mount=type=cache,target=/var/cache/apt apt-get install -y ...
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
RUN --mount=type=cache,target=/go/pkg/mod go build ./...
```

### BuildKit: secret mount

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t app .
```

Secret **không vào layer nào** — khác hẳn với `COPY .npmrc . && RUN ... && rm .npmrc`, vốn để lại file trong layer trước vĩnh viễn.

Với `ARG`, nhớ rằng nó xuất hiện trong `docker history` — **không bao giờ truyền secret qua `ARG`**.

### Multi-stage: build song song và image nhỏ

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20.11-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS test
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm test                     # stage này chạy SONG SONG với build

FROM node:20.11-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps  --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
USER app
CMD ["node", "dist/main.js"]
```

BuildKit dựng đồ thị phụ thuộc và chạy các stage độc lập **song song**. `test` và `build` không phụ thuộc nhau nên chúng chạy cùng lúc.

Và `--target` cho phép build một stage cụ thể:

```bash
docker build --target test -t app-test .     # chỉ chạy test
docker build --target runtime -t app .       # image production
```

### Cache trong CI

Đây là phần giải quyết vấn đề ở đầu note.

```bash
# ① Registry cache — dùng được giữa các runner, giữa các nhánh
docker buildx build \
  --cache-from type=registry,ref=ghcr.io/org/app:buildcache \
  --cache-to   type=registry,ref=ghcr.io/org/app:buildcache,mode=max \
  --push -t ghcr.io/org/app:$SHA .
```

```text
mode=min  chỉ cache layer của image cuối
mode=max  cache MỌI layer, kể cả stage trung gian  ← thường đáng giá hơn
```

```yaml
# ② GitHub Actions cache (đơn giản hơn, giới hạn 10 GB)
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Điểm quan trọng: **cache mount (`--mount=type=cache`) KHÔNG được lưu bởi registry cache.** Nó là cache cục bộ của builder. Với runner sạch mỗi lần, bạn cần cả hai:

```text
registry cache  → dùng lại LAYER đã build
cache mount     → tăng tốc khi layer PHẢI chạy lại (chỉ hữu ích với builder bền)
```

Với CI dùng runner ephemeral, `--cache-from`/`--cache-to` là thứ tạo khác biệt lớn nhất.

### Build multi-arch

```bash
docker buildx build --platform linux/amd64,linux/arm64 --push -t app:v1 .
```

Cần thiết khi dev dùng Mac ARM còn server chạy x86. Build cho nền tảng khác dùng QEMU và **chậm hơn đáng kể** — với native module, cân nhắc dùng runner native cho mỗi kiến trúc rồi gộp manifest.

### Tái lập được

```text
✗ FROM node:20              tag di động, đổi khi có bản vá
✗ RUN apt-get install -y x  phiên bản đổi theo thời gian
✗ RUN curl ... | sh         nội dung có thể đổi

✓ FROM node:20.11.1-alpine3.19
✓ FROM node@sha256:abc...   (chính xác nhất)
✓ npm ci (dùng package-lock.json), không phải npm install
```

`npm ci` vs `npm install` là khác biệt thật: `install` có thể cập nhật lock file và cài phiên bản khác; `ci` cài **chính xác** những gì trong lock file và fail nếu lock không khớp `package.json`.

## Example

Đo tác động của từng thay đổi:

```bash
# Baseline: COPY . . trước npm ci, không .dockerignore, không cache mount
time docker build --no-cache -t app .                 # 8m 20s
touch src/index.ts && time docker build -t app .      # 8m 10s   ← đau nhất

# + .dockerignore
touch src/index.ts && time docker build -t app .      # 7m 50s

# + đảo thứ tự (COPY package*.json trước)
touch src/index.ts && time docker build -t app .      # 18s      ← thay đổi lớn nhất
# nhưng khi package.json đổi:                          8m 5s

# + cache mount cho npm
# package.json đổi:                                    42s       ← thay đổi lớn thứ hai

# + registry cache trong CI (runner sạch)
# CI, chỉ đổi code:                                    55s
# CI, đổi package.json:                                1m 40s
```

Hai thay đổi có tác động lớn nhất — **thứ tự lệnh** và **cache mount** — đều là vài dòng Dockerfile. Thay đổi thứ ba (registry cache) là vài dòng cấu hình CI.

## Prediction

1. `COPY . .` trước `RUN npm ci`, sửa `README.md` — `npm ci` chạy lại không?
2. Đảo thứ tự, sửa `README.md` — chạy lại không?
3. Sửa `package.json`, có cache mount — `npm ci` mất bao lâu so với không có?
4. `RUN apt-get update` ở một layer, `RUN apt-get install` ở layer sau, build lại sau 1 tháng — cài phiên bản nào?
5. `ARG NPM_TOKEN` rồi dùng trong `RUN` — token có trong `docker history` không?
6. `--mount=type=secret` — có trong layer không?
7. `COPY .npmrc . && RUN npm ci && rm .npmrc` — `.npmrc` còn trong image không?
8. Không có `.dockerignore`, thư mục có `node_modules` 900 MB — build context bao nhiêu?
9. CI runner sạch mỗi lần, không có `--cache-from` — bao nhiêu layer được dùng lại?
10. Thêm `--cache-from type=registry` — bao nhiêu?
11. Cache mount có được lưu bởi registry cache không?
12. Hai stage độc lập trong multi-stage — chúng chạy tuần tự hay song song?
13. `npm install` vs `npm ci` trong Dockerfile — cái nào tái lập được?

<details>
<summary>Đáp án</summary>

1. **Có** — `COPY . .` tính hash mọi file; một byte đổi làm vô hiệu nó và mọi layer sau.
2. **Không** — `npm ci` chỉ phụ thuộc `package*.json`.
3. Không cache mount: tải lại toàn bộ gói (phút). Có cache mount: **vài chục giây** — chỉ tải gói mới.
4. Layer `update` được cache → cài từ **danh sách gói cũ** → có thể lỗi 404 hoặc cài phiên bản cũ. Phải gộp vào một `RUN`.
5. **Có** — `ARG` xuất hiện trong `docker history`. Không dùng `ARG` cho secret.
6. **Không** — secret mount không tạo layer nào.
7. **Còn** — nó nằm trong layer `COPY`; `rm` chỉ che ở layer sau.
8. Gần 900 MB được gửi tới daemon mỗi lần build.
9. **Không layer nào** — runner sạch không có cache cục bộ.
10. Những layer có hash khớp — thường là base image và dependency.
11. **Không** — cache mount là cache cục bộ của builder, không nằm trong layer.
12. **Song song** — BuildKit dựng đồ thị phụ thuộc.
13. **`npm ci`** — cài chính xác lock file và fail nếu không khớp.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `COPY . .` trước `npm ci`, sửa một file, build lại | Cài lại từ đầu; đo thời gian |
| Đảo thứ tự, lặp lại | Nhanh hơn hàng chục lần |
| Xoá `.dockerignore` với `node_modules` lớn | Context khổng lồ |
| Tách `apt-get update` và `install` thành hai `RUN`, build lại sau vài tuần | Cài gói cũ hoặc 404 |
| Gộp lại một `RUN` | Đúng |
| `ARG TOKEN` rồi `docker history --no-trunc` | Token hiện ra |
| Đổi sang `--mount=type=secret` | Không thấy |
| Thêm cache mount cho npm, đổi `package.json`, build lại | Nhanh hơn nhiều |
| Build trên runner sạch không có `--cache-from` | Không dùng lại layer nào |
| Thêm registry cache | Dùng lại phần lớn |
| So `mode=min` và `mode=max` với multi-stage | `max` cache cả stage trung gian |
| `docker build --progress=plain` | Thấy layer nào CACHED |
| Build multi-arch với QEMU, đo thời gian | Chậm hơn native đáng kể |

## What Usually Goes Wrong

- **`COPY . .` trước khi cài dependency** → nguyên nhân số một của build chậm.
- **Không có `.dockerignore`** → context lớn, cache vô hiệu bởi file không liên quan, `.env` vào image.
- **CI không có cache** → mọi build từ đầu, và không ai nhận ra vì local vẫn nhanh.
- **Tách `apt-get update` khỏi `install`** → cài gói cũ, hoặc 404 khi mirror đổi.
- **Secret qua `ARG` hoặc `COPY`** → nằm vĩnh viễn trong image.
- **Không dùng cache mount** → tải lại dependency mỗi khi lock file đổi.
- **Base image không ghim version** → build không tái lập được, và "hôm qua chạy được" trở thành bí ẩn.
- **`npm install` thay `npm ci`** → phiên bản khác nhau giữa các lần build.
- **Không multi-stage** → công cụ build và source vào image cuối.
- **Quá nhiều layer nhỏ không cần thiết** → khó đọc, nhưng ít quan trọng hơn thứ tự.
- **Build multi-arch với QEMU cho mọi thứ** → chậm; dùng runner native khi có thể.
- **Không đo thời gian build** → không biết mình đang trả giá bao nhiêu.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Docker cache theo thời gian | Nó cache theo **hash của lệnh và nội dung** |
| `RUN` được cache theo kết quả | Chỉ theo **chuỗi lệnh** — `apt-get update` cho kết quả cũ |
| Gộp mọi lệnh vào một `RUN` là tốt nhất | Nó giảm layer nhưng cũng giảm khả năng cache |
| `.dockerignore` chỉ để build nhanh | Nó còn là biện pháp bảo mật |
| Cache mount và layer cache như nhau | Khác hẳn; cache mount không nằm trong layer |
| Registry cache lưu cả cache mount | Không |
| Multi-stage chỉ để image nhỏ | Nó còn cho build song song |
| Build nhanh ở local nghĩa là CI cũng nhanh | CI thường không có cache |
| `ARG` an toàn cho secret | Nó xuất hiện trong `docker history` |
| `npm install` và `npm ci` tương đương | `ci` tái lập được, `install` thì không |

## Debugging

1. **Layer nào không cache?** `docker build --progress=plain .` — tìm lệnh đầu tiên **không** báo `CACHED`. Mọi lệnh sau nó cũng sẽ chạy lại.
2. **Context bao nhiêu?** Dòng `transferring context` ở đầu output.
3. **Layer nào lớn?** `docker history <image>` sắp theo `SIZE`; hoặc `dive <image>` để duyệt từng layer.
4. **Secret có lọt vào không?** `docker history --no-trunc <image>`, và duyệt layer bằng `dive`.
5. **CI có dùng cache không?** Đọc log build; nếu không có dòng `CACHED` nào, cache không hoạt động.
6. **So thời gian ba kịch bản**: build sạch, đổi code, đổi dependency. Ba con số này cho biết Dockerfile của bạn tối ưu ở đâu và chưa ở đâu.
7. **Cache registry không hit** → kiểm tra `--cache-from` trỏ đúng ref, và builder có quyền pull không.

## Production Considerations

- **Đo ba con số**: build sạch, build khi đổi code, build khi đổi dependency. Con số thứ hai là con số bạn trả giá nhiều nhất.
- **Registry cache trong CI** (`--cache-from`/`--cache-to type=registry,mode=max`) — thay đổi lớn nhất cho runner ephemeral.
- **Cache mount cho package manager** — thay đổi lớn thứ hai.
- **`.dockerignore` đầy đủ**, và review nó khi thêm thư mục mới.
- **Ghim version base image**, cập nhật có chủ đích (Renovate/Dependabot).
- **`npm ci`, không `npm install`.**
- **BuildKit secret mount cho mọi credential lúc build.**
- **Quét image trong CI** (`trivy`) với ngưỡng chặn build cho lỗ hổng nghiêm trọng.
- **Multi-stage với `--target`** để dùng chung Dockerfile cho dev, test và production.
- **Build một lần, deploy nhiều nơi** — không build lại cho mỗi môi trường. Xem [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md).
- **Đặt ngân sách thời gian build** (ví dụ: dưới 3 phút cho thay đổi code) và coi vượt ngân sách là một bug.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều layer nhỏ | cache tốt hơn | Dockerfile dài hơn |
| Gộp lệnh `RUN` | ít layer, image nhỏ hơn chút | mất cache khi một phần đổi |
| Cache mount | build nhanh khi layer chạy lại | không dùng được với runner sạch nếu không có builder bền |
| Registry cache | dùng được giữa runner | tốn dung lượng registry, thêm thời gian push/pull |
| Ghim version chính xác | tái lập được | phải chủ động cập nhật |
| Tag di động | tự có bản vá | build không tái lập |
| Multi-stage | image nhỏ, build song song | Dockerfile phức tạp hơn |
| Multi-arch trong một build | một lệnh | chậm với QEMU |
| Runner native mỗi arch | nhanh | phức tạp hơn, cần gộp manifest |
| `--no-cache` trong CI | chắc chắn sạch | chậm nhất |

## Explain Without Notes

1. Cache layer bị vô hiệu bởi cái gì, và điều gì xảy ra với các layer sau?
2. Quy tắc thứ tự lệnh trong Dockerfile?
3. Vì sao `apt-get update` và `install` phải cùng một `RUN`?
4. Cache mount khác layer cache thế nào? Cái nào lưu được ở registry?
5. Vì sao `ARG` không dùng được cho secret, và cái gì thay thế?
6. Vì sao build nhanh ở local nhưng chậm ở CI?
7. Ba con số nên đo cho một Dockerfile?
8. `npm ci` khác `npm install` ở điểm nào quan trọng?

## Related

- [Image & container](01-image-container.md) — layer, tag, digest
- [Production image](07-production-image.md) — nhỏ, an toàn, non-root
- [Namespaces & cgroups](04-namespaces-cgroups.md) — vì sao non-root quan trọng
- [CI/CD pipeline](../03-cicd/01-pipeline.md) — nơi build chạy
- [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md) — build một lần
- [Compose](06-compose.md) — build cho môi trường dev
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — không nướng config vào image

## Version / Context

Docker 24+ với BuildKit (mặc định từ Docker 23). Cú pháp `--mount=type=cache|secret` cần dòng `# syntax=docker/dockerfile:1.7` ở đầu file. `docker buildx` cho multi-arch và registry cache. Cache backend: `registry`, `gha`, `s3`, `local`.
