---
level: intermediate
area: frontend
prerequisites:
  - 04-rendering-strategies.md
  - 03-data-fetching-cache.md
related:
  - ../../../04-infrastructure/02-docker/07-production-image.md
  - ../../../04-infrastructure/03-cicd/01-pipeline.md
---

# Deployment & production

> "Chạy được ở local" và "chạy được ở production" khác nhau ở: nhiều instance, biến môi trường lúc build vs lúc chạy, cache không chia sẻ, và một reverse proxy mà bạn không cấu hình.

*Baseline: Next.js 15, App Router.*

## Position

```text
Source → build (env lúc build được NHÚNG) → image/artifact → N instance
                                                  ↓
                                    reverse proxy / CDN → user
```

## Problem

Năm điều chỉ xuất hiện ngoài local:

1. **`NEXT_PUBLIC_*` bị đóng băng lúc build** → deploy cùng image sang staging và production, cả hai trỏ về cùng API.
2. **Data Cache là per-instance** → 3 pod, 3 bản cache khác nhau, `revalidateTag` chỉ ảnh hưởng pod nhận request.
3. **Proxy buffer response** → streaming ngừng hoạt động.
4. **Image không tối ưu** → 1,5GB, deploy chậm, tốn tiền.
5. **Không graceful shutdown** → request bị cắt giữa mỗi lần deploy.

Điểm chung: chúng đều là hệ quả của việc **chuyển từ một process trên máy bạn sang N process sau một proxy**.

## Mental Model

```text
BUILD TIME                          RUN TIME
NEXT_PUBLIC_* được nhúng            process.env (server) đọc được
static page được render             dynamic page render mỗi request
bundle được tạo                     cache được điền dần

→ Đổi NEXT_PUBLIC_* cần BUILD LẠI
→ Đổi secret server chỉ cần restart
```

Đây là phân biệt quan trọng nhất cho CI/CD: nếu bạn muốn **một artifact chạy ở nhiều môi trường** (thực hành tốt — xem [artifact promotion](../../../04-infrastructure/03-cicd/02-build-artifact-promotion.md)), thì bạn **không thể** dùng `NEXT_PUBLIC_*` cho những gì khác nhau giữa các môi trường.

Giải pháp: đưa cấu hình client qua một endpoint hoặc qua Server Component thay vì nhúng lúc build.

```tsx
// Thay vì NEXT_PUBLIC_API_URL nhúng lúc build:
// Server Component đọc env lúc chạy và truyền xuống
export default async function Layout({ children }: { children: ReactNode }) {
  return <ConfigProvider apiUrl={process.env.API_URL!}>{children}</ConfigProvider>;
}
```

## How It Works

### Docker multi-stage với standalone output

```ts
// next.config.ts
export default { output: 'standalone' };   // chỉ đóng gói file cần thiết
```

```dockerfile
# 1. Cài dependency (layer này được cache khi package.json không đổi)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# ARG cho biến cần lúc build (nếu buộc phải dùng NEXT_PUBLIC_*)
RUN npm run build

# 3. Runtime — image nhỏ, user không phải root
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV HOSTNAME=0.0.0.0                     # BẮT BUỘC — không phải 127.0.0.1
CMD ["node", "server.js"]
```

Ba chi tiết quyết định:

- **`output: 'standalone'`** — image từ ~1,2GB xuống ~150MB. Nó chỉ copy dependency thực sự được dùng.
- **`HOSTNAME=0.0.0.0`** — bind mặc định vào `localhost` nghĩa là không container/pod nào khác kết nối được. Đây là failure phổ biến nhất khi container hoá Next.js. Xem [Container networking](../../../04-infrastructure/02-docker/02-container-networking.md).
- **`USER nextjs`** — không chạy root. Xem [Production image](../../../04-infrastructure/02-docker/07-production-image.md).

### Cache trên nhiều instance

Mặc định, Data Cache và Full Route Cache nằm **trong từng instance**:

```text
3 pod, mỗi pod cache riêng
   → user A hit pod 1 (cache mới), user B hit pod 2 (cache cũ) → không nhất quán
   → revalidateTag từ pod 1 KHÔNG ảnh hưởng pod 2 và 3
```

Với `revalidate` TTL thì đây chỉ là không nhất quán tạm thời. Với `revalidateTag` thì nó là **bug thật**: mutation không làm mới cache của các pod khác.

Giải pháp: cache handler dùng chung.

```ts
// next.config.ts
export default {
  cacheHandler: require.resolve('./cache-handler.js'),   // Redis-backed
  cacheMaxMemorySize: 0,                                  // tắt cache in-memory
};
```

Đây là quyết định phải làm **trước** khi scale lên nhiều instance, không phải sau khi phát hiện bug.

### Health check và graceful shutdown

```ts
// app/api/health/route.ts
export const dynamic = 'force-dynamic';       // không được cache

export async function GET() {
  // Readiness: dependency có sẵn không?
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
```

Phân biệt liveness và readiness là quan trọng: liveness ("process còn sống?") không nên kiểm tra database — nếu DB chậm, Kubernetes sẽ restart pod và làm tình hình tệ hơn. Xem [Readiness & liveness](../../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md).

Graceful shutdown để không mất request khi deploy: xem [Graceful shutdown](../../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md).

### Reverse proxy

```nginx
location / {
  proxy_pass http://nextjs:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;   # để Next.js biết là HTTPS
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

  proxy_buffering off;                           # BẮT BUỘC cho streaming
  proxy_read_timeout 300s;                       # cho SSE / request dài
}
```

`proxy_buffering off` là dòng làm streaming SSR hoạt động. Không có nó, mọi `Suspense` boundary trở nên vô nghĩa và bạn sẽ không hiểu tại sao.

`X-Forwarded-Proto` cần thiết để cookie `Secure` và redirect hoạt động đúng — không có nó, Next.js nghĩ nó đang chạy HTTP.

## Example

```yaml
# Kubernetes deployment — các phần quan trọng
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web
          image: registry/tasklab-web:sha-abc123      # tag theo commit SHA, không dùng :latest
          ports: [{ containerPort: 3000 }]
          env:
            - name: HOSTNAME
              value: "0.0.0.0"
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: web-secrets, key: database-url } }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 512Mi }               # không limit CPU: xem note K8s
          readinessProbe:
            httpGet: { path: /api/health, port: 3000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /api/ping, port: 3000 }  # KHÔNG kiểm tra DB
            periodSeconds: 20
```

## Prediction

1. Build image với `NEXT_PUBLIC_API_URL=https://staging.api`, deploy sang production với env khác — client gọi API nào?
2. `output: 'standalone'` vs không — kích thước image chênh bao nhiêu?
3. Không đặt `HOSTNAME=0.0.0.0` trong container — pod khác kết nối được không? `curl` từ trong pod thì sao?
4. 3 pod, `revalidateTag('tasks')` chạy trên pod 1 — pod 2 và 3 thấy dữ liệu mới không?
5. nginx với `proxy_buffering on` (mặc định) trước trang có `Suspense` — người dùng thấy gì?
6. Liveness probe kiểm tra database, DB chậm 30 giây — điều gì xảy ra với các pod?
7. Không có graceful shutdown, rolling update 3 pod — bao nhiêu request bị cắt?

<details>
<summary>Đáp án chọn lọc</summary>

1. Staging API — giá trị đã bị nhúng vào bundle lúc build.
3. Không kết nối được từ ngoài; `curl localhost:3000` từ **trong** pod vẫn được — đó là điều làm bug này khó chẩn đoán.
4. Không — cache per-instance.
5. Không có streaming; chờ toàn bộ response.
6. Tất cả pod bị restart → outage tự gây ra, và DB càng chậm hơn vì connection storm.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Deploy cùng image sang 2 môi trường với `NEXT_PUBLIC_*` khác | Cả hai gọi cùng API |
| Bỏ `output: 'standalone'` | `docker images` — so kích thước |
| Bỏ `HOSTNAME=0.0.0.0` | `curl` từ pod khác: connection refused |
| Scale lên 3 pod, mutation rồi reload nhiều lần | Dữ liệu nhảy giữa mới và cũ |
| `proxy_buffering on` với trang streaming | TTFB = query chậm nhất |
| Liveness probe gọi DB, làm DB chậm | Mọi pod restart cùng lúc |
| Rolling update không có graceful shutdown | Đo số 502 trong lúc deploy |
| Chạy container với `USER root` rồi scan bằng `trivy` | Danh sách cảnh báo |
| Dùng tag `:latest` rồi rollback | Không biết rollback về đâu |

## What Usually Goes Wrong

- **`NEXT_PUBLIC_*` cho cấu hình theo môi trường** → không promote được artifact.
- **Không đặt `HOSTNAME=0.0.0.0`** → container không nhận kết nối.
- **Cache per-instance khi có nhiều replica** → dữ liệu không nhất quán, `revalidateTag` không đủ.
- **`proxy_buffering on`** → streaming không hoạt động.
- **Liveness probe kiểm tra dependency** → restart storm khi dependency chậm.
- **Không graceful shutdown** → 502 mỗi lần deploy.
- **Image lớn** (không standalone, không multi-stage) → deploy chậm, tốn registry.
- **Chạy root trong container**.
- **Tag `:latest`** → không biết đang chạy gì, không rollback được.
- **Secret trong image** hoặc trong `NEXT_PUBLIC_*`.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Env var đọc lúc chạy cho mọi biến | `NEXT_PUBLIC_*` bị nhúng lúc build |
| Cache của Next.js chia sẻ giữa instance | Per-instance theo mặc định |
| Streaming hoạt động tự động ở production | Proxy buffering có thể tắt nó |
| `revalidateTag` là đủ cho nhiều replica | Cần cache handler dùng chung |
| Liveness và readiness như nhau | Liveness kiểm tra process; readiness kiểm tra sẵn sàng nhận traffic |
| `next start` là cách deploy | Standalone output + `node server.js` nhẹ hơn nhiều |
| Vercel và self-host giống nhau | Vercel xử lý ISR/cache/streaming ở tầng hạ tầng; self-host phải tự làm |

## Debugging

1. **Client gọi sai API** → tìm giá trị trong bundle: `grep -r "staging.api" .next/static`. Nếu có, nó bị nhúng lúc build.
2. **Container không nhận kết nối** → `ss -tlnp` trong container. Nếu thấy `127.0.0.1:3000` thay vì `0.0.0.0:3000`, đó là nguyên nhân.
3. **Dữ liệu không nhất quán** → scale về 1 replica. Nếu hết vấn đề, đó là cache per-instance.
4. **Streaming không hoạt động** → `curl -N` trực tiếp vào app (bỏ qua proxy) rồi qua proxy. So sánh.
5. **502 khi deploy** → kiểm tra graceful shutdown và `terminationGracePeriodSeconds`.
6. **Pod restart liên tục** → `kubectl describe pod` xem lý do; kiểm tra probe. Xem [Debugging K8s](../../../04-infrastructure/04-kubernetes/operations/02-debugging-k8s.md).
7. **Image lớn** → `docker history <image>` xem layer nào chiếm chỗ.

## Production Considerations

- **Một artifact cho mọi môi trường.** Cấu hình khác biệt phải đọc lúc chạy.
- **Cache handler dùng chung (Redis)** trước khi scale lên nhiều instance.
- **Proxy: `buffering off`, `X-Forwarded-Proto`, timeout đủ dài.**
- **Probe đúng vai**: readiness kiểm tra dependency, liveness chỉ kiểm tra process sống.
- **Graceful shutdown** với `SIGTERM` handler.
- **Tag image theo commit SHA**; `:latest` không rollback được.
- **Scan image** trong CI (`trivy`), chạy non-root, không có secret trong layer.
- **CDN cho static asset** (`/_next/static` có hash → cache 1 năm).
- **Observability**: request ID xuyên tầng, log có structure, metric cho TTFB và error rate. Xem [Observability](../../../05-cross-cutting/observability/README.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Vercel / platform quản lý | ISR, cache, streaming, CDN sẵn sàng | ràng buộc nhà cung cấp, chi phí theo tải |
| Self-host (Docker/K8s) | kiểm soát, chi phí dự đoán được | phải tự làm cache dùng chung, CDN, scaling |
| `output: 'standalone'` | image nhỏ | cần copy đúng file, dễ sai lúc đầu |
| Cache handler Redis | nhất quán giữa instance | thêm dependency, thêm điểm hỏng |
| Env lúc chạy cho client config | một artifact cho mọi môi trường | thêm một round-trip hoặc một provider |
| `NEXT_PUBLIC_*` | đơn giản, không round-trip | phải build riêng cho mỗi môi trường |

## Explain Without Notes

1. Phân biệt build-time và run-time env. Hệ quả với CI/CD?
2. Vì sao `HOSTNAME=0.0.0.0` bắt buộc trong container, và vì sao bug này khó chẩn đoán?
3. Điều gì xảy ra với `revalidateTag` khi có 3 replica? Cách sửa?
4. Vì sao `proxy_buffering off` cần cho streaming?
5. Vì sao liveness probe không nên kiểm tra database?

## Related

- [Rendering strategies](04-rendering-strategies.md) — streaming cần proxy đúng
- [Data fetching & cache](03-data-fetching-cache.md) — cache per-instance
- [Production image](../../../04-infrastructure/02-docker/07-production-image.md) — multi-stage, non-root
- [Container networking](../../../04-infrastructure/02-docker/02-container-networking.md) — bind address
- [Reverse proxy](../../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md)
- [Readiness & liveness](../../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md)
- [Graceful shutdown](../../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md)
- [CI/CD pipeline](../../../04-infrastructure/03-cicd/01-pipeline.md)
