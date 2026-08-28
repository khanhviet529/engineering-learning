---
level: intermediate
area: infra
prerequisites:
  - 05-dockerfile-build-cache.md
  - 04-namespaces-cgroups.md
related:
  - 08-common-failures.md
  - ../../05-cross-cutting/security/06-secrets-management.md
---

# Production image

> Image production nặng 1,4 GB. Nó chứa: source code TypeScript, toàn bộ devDependencies, `git`, `curl`, một compiler C, và — trong layer thứ tư — file `.npmrc` với token đọc registry riêng của công ty. Ai pull được image đều lấy được token đó. Image được đẩy lên registry nội bộ, nơi mọi kỹ sư đều có quyền pull.

## Position

```text
Dockerfile ──▶ image ──▶ registry ──▶ node kéo về ──▶ container chạy
                  ↑ note này: kích thước, bề mặt tấn công, danh tính
```

Image production khác image dev ở ba chiều đo được: **kích thước**, **những gì có trong đó**, và **chạy dưới quyền gì**.

## Problem

```text
① QUÁ LỚN     pull chậm → scale chậm, phục hồi chậm, tốn băng thông
② QUÁ NHIỀU   mỗi binary là một CVE tiềm năng và một công cụ cho attacker
③ CHẠY ROOT   thoát container = root trên node
④ CÓ SECRET   nằm vĩnh viễn trong layer, không xoá được
```

Điểm ① không chỉ là chuyện thẩm mỹ: thời gian pull nằm trong đường tới hạn của **autoscale** và **phục hồi sau sự cố**. Image 1,4 GB kéo về mất 40 giây là 40 giây bạn không phục vụ được traffic tăng đột biến.

## Mental Model

### Bốn thuộc tính của image production

```text
NHỎ         chỉ những gì cần để CHẠY (không phải để build)
TỐI GIẢN    ít binary = ít CVE, ít công cụ cho attacker
KHÔNG ROOT  UID cố định, không đặc quyền
TÁI LẬP     cùng input → cùng output; ghim version, dùng digest
```

### Chọn base image

```text
node:20                 ~1,1 GB  đầy đủ Debian; chỉ dùng để BUILD
node:20-slim            ~200 MB  Debian tối giản, glibc — tương thích tốt
node:20-alpine          ~130 MB  musl libc — nhỏ nhất nhưng khác glibc
distroless/nodejs20     ~170 MB  chỉ runtime, KHÔNG shell, không package manager
scratch                 0        chỉ cho binary tĩnh (Go, Rust)
```

Alpine dùng **musl** thay glibc. Hệ quả thực tế:

```text
· một số native module phải build lại từ source
· DNS resolver hoạt động khác đôi chút (từng gây vấn đề với một số cấu hình)
· hiệu năng một số thao tác (đặc biệt allocation nhiều thread) có thể khác
```

Với Node.js thuần, Alpine thường ổn. Với native module phức tạp hoặc khi gặp lỗi khó hiểu, `slim` là lựa chọn an toàn hơn với chi phí ~70 MB.

**Distroless** không có shell — nghĩa là `kubectl exec ... sh` không hoạt động. Đó vừa là điểm mạnh (attacker cũng không có shell) vừa là điểm yếu (bạn phải dùng ephemeral debug container). Với `kubectl debug` sẵn có, đánh đổi này thường đáng.

### Multi-stage: công cụ build không vào image cuối

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20.11.1

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=384"

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist        ./dist
COPY --from=build --chown=app:app /app/package.json ./

USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Chín quyết định trong file này:

```text
ARG NODE_VERSION           ghim version, đổi ở một chỗ
secret mount cho .npmrc    token KHÔNG vào layer nào
cache mount cho npm        build nhanh khi lock file đổi
npm prune --omit=dev       bỏ devDependencies khỏi image cuối
chỉ COPY dist + node_modules  không có source TypeScript
UID cố định 1001           khớp được với quyền volume
--chown khi COPY           không cần một layer chown riêng
NODE_ENV=production        nhiều thư viện đổi hành vi
--max-old-space-size       lỗi có stack trace thay vì OOMKilled im lặng
exec form CMD              node là PID 1, nhận SIGTERM
```

Kết quả: từ ~1,4 GB xuống ~180 MB, không có source code, không có devDependencies, không có secret, không chạy root.

### Secret: quy tắc tuyệt đối

```dockerfile
# ❌ nằm vĩnh viễn trong layer, `rm` không xoá được
COPY .npmrc .
RUN npm ci && rm .npmrc

# ❌ hiện trong `docker history`
ARG NPM_TOKEN
RUN echo "//registry:_authToken=${NPM_TOKEN}" > .npmrc && npm ci

# ✅ không tạo layer nào
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t app .
```

Kiểm tra image đã build:

```bash
docker history --no-trunc <image> | grep -i -E 'token|secret|password|key'
dive <image>          # duyệt từng layer
```

Nếu secret đã lọt vào một image đã push: **xoay secret đó**. Xoá image khỏi registry không đủ — có thể đã có bản sao.

### Runtime security context

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  runAsGroup: 1001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }
volumeMounts:
  - { name: tmp, mountPath: /tmp }
volumes:
  - { name: tmp, emptyDir: {} }
```

`readOnlyRootFilesystem` yêu cầu bạn liệt kê mọi chỗ ghi — và việc đó tự nó là một bài tập hữu ích: nhiều app ghi vào những chỗ không ai biết.

Chi tiết: [Namespaces & cgroups](04-namespaces-cgroups.md).

### Health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Với Kubernetes, `HEALTHCHECK` trong Dockerfile **bị bỏ qua** — K8s dùng probe của riêng nó. Nó vẫn hữu ích cho Docker và Compose.

Và với distroless (không có shell, không có `curl`), health check phải dùng chính runtime — như ví dụ trên với `node -e`.

### Metadata: OCI labels

```dockerfile
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}"
```

Khi có sự cố lúc 3 giờ sáng, `docker inspect <image> | jq '.[0].Config.Labels'` cho biết **chính xác commit nào** đang chạy. Không có nó, bạn phải lần theo tag và hy vọng nó chưa bị ghi đè.

### Quét lỗ hổng

```bash
trivy image --severity HIGH,CRITICAL --exit-code 1 myapp:$SHA
```

Đưa vào CI với ngưỡng chặn build. Nhưng cần một chính sách thực tế:

```text
· không phải CVE nào cũng khai thác được trong ngữ cảnh của bạn
· một số CVE không có bản vá → cần allowlist có thời hạn và có người chịu trách nhiệm
· quét base image ĐỊNH KỲ, không chỉ lúc build — CVE mới xuất hiện sau khi image đã build
```

Điểm cuối quan trọng: một image "sạch" khi build có thể có 12 CVE nghiêm trọng sau ba tháng. Quét định kỳ và rebuild là một phần của vận hành.

### Kích thước ảnh hưởng gì

```text
Pull time = kích thước / băng thông
   → nằm trong đường tới hạn của AUTOSCALE và PHỤC HỒI SAU SỰ CỐ

1,4 GB @ 300 Mbps ≈ 40 giây
180 MB @ 300 Mbps ≈ 5 giây

Với 20 pod cần scale trong một đợt tăng tải, khác biệt là rõ rệt.
```

Và layer được chia sẻ: nếu mọi service dùng chung base image, node chỉ tải base một lần. Đây là lý do **thống nhất base image trong tổ chức** tiết kiệm thật.

## Example

Kiểm tra một image trước khi coi là sẵn sàng cho production:

```bash
IMG=myapp:$SHA

# ① Kích thước và layer nào lớn
docker images $IMG --format '{{.Size}}'
docker history $IMG | sort -k3 -h -r | head -5

# ② Chạy dưới user nào
docker run --rm $IMG id
# uid=1001(app) gid=1001(app)     ✓  (nếu là uid=0(root) → FAIL)

# ③ PID 1 là gì
docker run -d --name t $IMG && docker exec t ps -o pid,comm | head -3
# 1 node     ✓

# ④ Có shell/công cụ thừa không (với distroless thì mọi lệnh này fail — đúng)
docker run --rm $IMG sh -c 'which sh curl wget git gcc apk apt 2>/dev/null' || true

# ⑤ Secret trong layer
docker history --no-trunc $IMG | grep -i -E 'token|secret|password|_auth'

# ⑥ Có source code không
docker run --rm $IMG sh -c 'ls -la /app; find / -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null | head'

# ⑦ Lỗ hổng
trivy image --severity HIGH,CRITICAL $IMG

# ⑧ Tắt sạch
docker stop t; docker inspect t --format '{{.State.ExitCode}}'   # phải là 0
```

Tám bước, và chúng nên là một script chạy trong CI thay vì một checklist trong đầu ai đó.

## Prediction

1. `COPY .npmrc . && RUN npm ci && rm .npmrc` — token còn trong image không?
2. `ARG NPM_TOKEN` dùng trong `RUN` — có trong `docker history` không?
3. `--mount=type=secret` — có trong layer không?
4. Không có multi-stage, image chứa gì thừa?
5. Image 1,4 GB vs 180 MB, băng thông 300 Mbps, scale 20 pod — chênh bao nhiêu thời gian?
6. `USER app` nhưng volume owner UID 1000 — ghi được không?
7. `readOnlyRootFilesystem: true`, app ghi `/tmp`, không mount `emptyDir` — kết quả?
8. Distroless image, `kubectl exec -it pod -- sh` — kết quả? Debug thế nào?
9. `HEALTHCHECK` trong Dockerfile, chạy trên Kubernetes — K8s có dùng không?
10. Alpine với native module cần glibc — kết quả?
11. Image build sạch CVE hôm nay, 3 tháng sau quét lại — kết quả?
12. Không có OCI label, sự cố lúc 3 giờ sáng — làm sao biết commit nào đang chạy?
13. `npm ci` không có `--omit=dev` và không `npm prune` — image chứa gì?

<details>
<summary>Đáp án</summary>

1. **Còn** — nó nằm trong layer `COPY`; `rm` chỉ che ở layer sau.
2. **Có** — `ARG` hiện trong `docker history`.
3. **Không** — secret mount không tạo layer.
4. Compiler, git, curl, devDependencies, source code, cache của package manager.
5. 40s vs 5s mỗi node. Với nhiều node kéo song song, khác biệt trong thời gian scale là rõ rệt.
6. **Không** — UID 1001 không sở hữu thư mục owner 1000.
7. `EROFS: read-only file system` → app crash lúc khởi động.
8. **Không có shell** → lệnh fail. Debug bằng `kubectl debug` với ephemeral container.
9. **Không** — K8s dùng `livenessProbe`/`readinessProbe` riêng.
10. Có thể lỗi khi build native module, hoặc lỗi runtime khó hiểu. Dùng `slim` nếu gặp.
11. Có thể có CVE mới — CVE được công bố sau khi image build. Cần quét định kỳ và rebuild.
12. Phải lần theo tag và hy vọng nó chưa bị ghi đè — không đáng tin. OCI label giải quyết điều này.
13. Toàn bộ devDependencies (TypeScript, jest, eslint...) — thường vài trăm MB.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `COPY` secret rồi `rm`, chạy `docker history --no-trunc` | Thấy lệnh; trích xuất được file |
| Đổi sang `--mount=type=secret` | Không thấy |
| Bỏ multi-stage, so `docker images` | Chênh lệch lớn |
| Bỏ `npm prune --omit=dev` | Image lớn hơn nhiều |
| `docker run --rm <img> id` với image chạy root | `uid=0` |
| Thêm `USER app`, lặp lại | `uid=1001` |
| `USER app` với volume owner khác | `EACCES` |
| `readOnlyRootFilesystem` không mount `/tmp` | `EROFS` |
| Thử `sh` trong distroless | Không có |
| `kubectl debug` với netshoot | Có công cụ |
| Đo thời gian pull image 1,4 GB và 180 MB | Chênh lệch |
| `trivy image` trên `node:20` và `node:20-alpine` | Số CVE khác nhau |
| Quét lại image cũ 3 tháng | CVE mới xuất hiện |
| `docker inspect` xem labels | Có/không biết được commit |

## What Usually Goes Wrong

- **Secret trong layer** → nằm vĩnh viễn; phải xoay secret.
- **Không multi-stage** → image lớn gấp 5–10 lần, chứa source và công cụ build.
- **Chạy root** → thoát container = root trên node.
- **Không ghim version base image** → build không tái lập, và "hôm qua chạy được" thành bí ẩn.
- **Dùng `:latest`** → không biết phiên bản nào đang chạy.
- **Quên `npm prune --omit=dev`** → devDependencies trong production.
- **Shell form `CMD`** → PID 1 sai, exit 137 mỗi lần deploy.
- **Không đặt `--max-old-space-size`** → OOMKilled không có stack trace.
- **UID không cố định** → xung đột quyền volume.
- **Không quét lỗ hổng** → CVE nghiêm trọng lên production.
- **Chỉ quét lúc build** → CVE mới không được phát hiện.
- **Không có OCI label** → không biết image nào từ commit nào.
- **Image lớn** → autoscale và phục hồi chậm.
- **Distroless mà không biết cách debug** → bí khi có sự cố.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `rm` file trong Dockerfile xoá nó khỏi image | Nó vẫn ở layer trước |
| `ARG` an toàn cho secret | Nó hiện trong `docker history` |
| Image nhỏ chỉ để tiết kiệm dung lượng | Nó ảnh hưởng tốc độ scale và phục hồi |
| Alpine luôn là lựa chọn tốt nhất | musl khác glibc; `slim` an toàn hơn với native module |
| Distroless không debug được | `kubectl debug` giải quyết điều đó |
| `HEALTHCHECK` hoạt động trên K8s | K8s dùng probe riêng |
| Chạy root trong container an toàn vì đã cô lập | Cô lập không tuyệt đối |
| Quét CVE một lần là đủ | CVE mới xuất hiện liên tục |
| Image sạch CVE là image an toàn | Cấu hình runtime cũng quan trọng không kém |
| Multi-stage chỉ để image nhỏ | Nó cũng ngăn secret và source lọt vào |

## Debugging

1. **Image lớn** → `docker history <img>` sắp theo size; `dive <img>` để thấy file nào trong layer nào.
2. **Có gì thừa?** `docker run --rm <img> sh -c 'du -sh /* 2>/dev/null | sort -rh | head'`.
3. **Secret?** `docker history --no-trunc` + `dive`. Nếu tìm thấy, **xoay secret**.
4. **Chạy user nào?** `docker run --rm <img> id`.
5. **PID 1?** `docker run -d ... && docker exec <c> ps -o pid,comm`.
6. **Distroless không debug được** → `kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>`.
7. **Image nào đang chạy?** `docker inspect <c> --format '{{.Image}}'` rồi so digest; đọc OCI label để biết commit.
8. **CVE** → `trivy image --severity HIGH,CRITICAL`, và kiểm tra cả base image riêng.

## Production Considerations

- **Multi-stage luôn luôn** — nó giải quyết cùng lúc kích thước, secret, và source code.
- **Ghim version base image**; tự động cập nhật bằng Renovate/Dependabot rồi test.
- **Deploy bằng digest**, không bằng tag di động.
- **Non-root với UID cố định**, và ghi UID đó vào tài liệu (người tạo volume cần biết).
- **`readOnlyRootFilesystem` + `emptyDir`** cho chỗ ghi tạm.
- **BuildKit secret mount** cho mọi credential lúc build.
- **Quét trong CI với ngưỡng chặn**, và **quét lại định kỳ** image đang chạy ở production.
- **Rebuild định kỳ** (hằng tuần) để lấy bản vá của base image, kể cả khi code không đổi.
- **OCI label với `revision` và `created`** — nó là thứ bạn cần lúc 3 giờ sáng.
- **Ký image** (cosign) và verify lúc admit nếu chuỗi cung ứng là mối lo.
- **SBOM** (`syft`) để biết chính xác image chứa gì — cần khi có CVE mới công bố và bạn phải trả lời "chúng ta có bị ảnh hưởng không".
- **Base image dùng chung trong tổ chức** — vá một chỗ, pull nhanh hơn.
- **Đo thời gian pull** như một metric; nó là một phần của thời gian phục hồi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Alpine | nhỏ nhất | musl ≠ glibc; native module có thể vấn đề |
| Debian slim | tương thích tốt | lớn hơn ~70 MB |
| Distroless | rất nhỏ, bề mặt tấn công tối thiểu | không shell → cần ephemeral container |
| `scratch` | 0 byte overhead | chỉ cho binary tĩnh |
| Multi-stage | nhỏ, sạch, không secret | Dockerfile dài hơn |
| Single-stage | đơn giản | lớn, chứa công cụ build và có thể cả secret |
| Ghim digest | chính xác tuyệt đối | phải tự động hoá cập nhật |
| Tag version | dễ đọc | vẫn có thể bị ghi đè |
| Non-root | an toàn hơn nhiều | phải xử lý quyền volume, port <1024 |
| `readOnlyRootFilesystem` | chặn nhiều lớp tấn công | phải liệt kê chỗ ghi |
| Quét chặn build | không đưa CVE lên production | có thể chặn deploy vì CVE không khai thác được |
| Quét cảnh báo | không cản trở | CVE có thể bị bỏ qua |

## Explain Without Notes

1. Bốn thuộc tính của image production?
2. Vì sao `COPY secret && rm secret` không xoá được secret?
3. Ba cách truyền credential lúc build, và cái nào an toàn?
4. Multi-stage giải quyết ba vấn đề nào cùng lúc?
5. Alpine vs slim vs distroless — chọn thế nào?
6. Vì sao kích thước image ảnh hưởng tới thời gian phục hồi sau sự cố?
7. Vì sao quét CVE một lần lúc build là không đủ?
8. OCI label giải quyết vấn đề gì lúc 3 giờ sáng?

## Related

- [Dockerfile & build cache](05-dockerfile-build-cache.md) — multi-stage, cache mount, secret mount
- [Image & container](01-image-container.md) — layer, tag, digest
- [Namespaces & cgroups](04-namespaces-cgroups.md) — securityContext, capability
- [Volumes & state](03-volumes-state.md) — quyền volume với non-root
- [Common failures](08-common-failures.md) — lỗi kinh điển
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — secret ở tầng hệ thống
- [Build & artifact promotion](../03-cicd/02-build-artifact-promotion.md) — một artifact, nhiều môi trường
- [Memory, CPU & limits](../00-linux/02-memory-cpu-limits.md) — `--max-old-space-size`
- [Signals & lifecycle](../00-linux/04-signals-lifecycle.md) — exec form, PID 1
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — không nướng config vào image

## Version / Context

Docker 24+ với BuildKit. `--mount=type=secret` cần `# syntax=docker/dockerfile:1.7`. Distroless: `gcr.io/distroless/nodejs20-debian12`. Công cụ: `trivy`/`grype` (quét), `dive` (duyệt layer), `syft` (SBOM), `cosign` (ký image). Kubernetes bỏ qua `HEALTHCHECK` của Dockerfile.
