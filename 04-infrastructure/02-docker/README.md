---
level: intermediate
area: infra
---

# Docker

Docker không phát minh cơ chế nào. Nó **ghép sáu tính năng của Linux** lại và cho chúng một API dễ dùng:

```text
namespace  →  container "thấy" thế giới riêng (mạng, PID, filesystem)
cgroup     →  giới hạn tài nguyên
capability →  chia nhỏ quyền root
seccomp    →  lọc syscall
overlayfs  →  layer chỉ-đọc + layer ghi
chroot-ish →  gốc filesystem riêng
```

Vì thế: **học Linux trước Docker**. Mọi lỗi Docker khó đều là một cơ chế Linux rò rỉ ra.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Image & container](01-image-container.md) | Vì sao build mất 8 phút khi chỉ đổi một dòng code? |
| 2 | [Container networking](02-container-networking.md) | Vì sao `localhost` không tới được container khác? |
| 3 | [Volumes & state](03-volumes-state.md) | Vì sao `down -v` xoá sạch dữ liệu hai tuần? |
| 4 | [Namespaces & cgroups](04-namespaces-cgroups.md) | Cô lập của container chặt tới đâu? |
| 5 | [Dockerfile & build cache](05-dockerfile-build-cache.md) | Vì sao CI mất 11 phút còn local mất 12 giây? |
| 6 | [Compose](06-compose.md) | Onboarding một ngày rưỡi → một lệnh |
| 7 | [Production image](07-production-image.md) | Vì sao image 1,4 GB và có token trong đó? |
| 8 | [Common failures](08-common-failures.md) | Danh mục 18 lỗi kinh điển và cơ chế của chúng |

Note 8 là note bạn sẽ mở lại nhiều nhất.

## Năm mô hình giải thích gần như mọi lỗi

```text
① NAMESPACE   "localhost" của ai? mạng nào? PID nào?
② LAYER       bất biến; xoá không xoá được; cache theo hash nội dung
③ STATE       container bị xoá → layer ghi biến mất
④ UID         kernel so sánh SỐ, không so sánh tên user
⑤ PID 1       không có handler signal mặc định
```

Khi gặp lỗi lạ: **nó thuộc mô hình nào?** Câu trả lời thường dẫn thẳng tới nguyên nhân.

## Bảng chẩn đoán

| Triệu chứng | Mô hình | Note |
|---|---|---|
| `connection refused` từ host | ① app bind `127.0.0.1` | [2](02-container-networking.md) |
| Container A gọi `localhost` tới B | ① namespace riêng | [2](02-container-networking.md) |
| Tên container không phân giải được | ① bridge mặc định không có DNS | [2](02-container-networking.md) |
| Restart mất dữ liệu | ③ layer ghi | [3](03-volumes-state.md) |
| `down -v` xoá sạch | ③ volume bị xoá, không xác nhận | [3](03-volumes-state.md) |
| `EACCES` sau khi chuyển non-root | ④ UID không khớp | [3](03-volumes-state.md) |
| Sửa Dockerfile mà quyền volume cũ | ② volume chỉ kế thừa lần đầu | [3](03-volumes-state.md) |
| `node_modules` biến mất khi mount code | ② mount che nội dung image | [3](03-volumes-state.md) |
| Build chậm mỗi lần đổi code | ② `COPY . .` trước cài dependency | [5](05-dockerfile-build-cache.md) |
| CI chậm nhưng local nhanh | không có cache trong CI | [5](05-dockerfile-build-cache.md) |
| Container mất ~10s mới tắt, exit 137 | ⑤ shell form `CMD` | [1](01-image-container.md) |
| Exit 137 khi tải cao, không log | cgroup: OOMKilled | [4](04-namespaces-cgroups.md) |
| Image 1,4 GB | ② không multi-stage | [7](07-production-image.md) |
| Secret trong image | ② layer bất biến | [7](07-production-image.md) |
| Exit 127 | binary không có trong image (`bash` trong alpine) | [8](08-common-failures.md) |
| Đĩa đầy vì log | log driver không giới hạn | [8](08-common-failures.md) |
| `unable to get local issuer certificate` | thiếu `ca-certificates` | [8](08-common-failures.md) |
| Chạy local được, production hỏng | env / kiến trúc / tag di động | [8](08-common-failures.md) |

## Dockerfile tham chiếu

Mười quyết định, mỗi cái chặn một lớp lỗi:

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20.11.1                              # ① ghim version

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package*.json ./                                  # ② dependency TRƯỚC code
RUN --mount=type=cache,target=/root/.npm \             # ③ cache mount
    --mount=type=secret,id=npmrc,target=/root/.npmrc \ # ④ secret không vào layer
    npm ci

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev              # ⑤ bỏ devDependencies

FROM node:${NODE_VERSION}-alpine AS runtime            # ⑥ multi-stage
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=384"            # ⑦ ~75% memory limit
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app   # ⑧ UID cố định
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
USER app                                               # ⑨ non-root
EXPOSE 3000
CMD ["node", "dist/main.js"]                           # ⑩ exec form → PID 1 đúng
```

Và ở tầng runtime:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }
```

## Bốn lệnh chẩn đoán

```bash
docker ps -a                                          # chạy? exit code?
docker logs --tail 100 <c>                            # nó nói gì trước khi chết
docker inspect <c> --format '{{.State.ExitCode}} OOM={{.State.OOMKilled}}'
docker exec <c> sh -c 'id; ss -tlnp; env | sort'      # user? bind đâu? env gì?
```

Exit code nói rất nhiều:

```text
0 bình thường · 1 lỗi app · 125 lỗi daemon · 126 không thực thi được
127 lệnh không tồn tại · 137 SIGKILL (OOM/grace period) · 143 SIGTERM
```

## Kiểm tra trước khi coi image là sẵn sàng

```bash
docker run --rm $IMG id                    # phải là non-root
docker exec <c> ps -o pid,comm             # PID 1 phải là app
docker history --no-trunc $IMG | grep -iE 'token|secret|password'
docker images $IMG --format '{{.Size}}'
trivy image --severity HIGH,CRITICAL $IMG
docker stop <c>; docker inspect <c> --format '{{.State.ExitCode}}'   # phải là 0
```

Sáu kiểm tra này nên là một script trong CI, không phải một checklist trong đầu ai đó.

## Position

```text
Linux (namespace, cgroup) → DOCKER → Compose (một máy) → Kubernetes (cụm)
                             ↑ folder này
```

## Related

- [00-linux/](../00-linux/README.md) — cơ chế bên dưới; **đọc trước**
- [01-networking/](../01-networking/README.md) — DNS, TCP, proxy
- [04-kubernetes/](../04-kubernetes/README.md) — khi Compose không đủ
- [03-cicd/](../03-cicd/README.md) — nơi image được build và promote
- [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md) — ranh giới của Compose
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — PID 1 và SIGTERM
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — không nướng config vào image
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md)
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi thực hành

## Version / Context

Docker 24+ với BuildKit (mặc định từ 23). Compose v2 (`docker compose`). Cú pháp `--mount=type=cache|secret` cần `# syntax=docker/dockerfile:1.7`. Công cụ: `dive`, `trivy`, `syft`, `cosign`, `docker buildx`.
