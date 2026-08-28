---
level: intermediate
area: infra
prerequisites:
  - ../02-docker/07-production-image.md
related:
  - 02-cloudflare-and-edge.md
  - ../04-kubernetes/fundamentals/01-why-kubernetes.md
---

# Chạy ở đâu: VPS, PaaS, container, serverless, edge

> Bạn không thể kiểm chứng bất cứ điều gì repo này dạy về production cho tới khi có **hai instance sau một load balancer**. Graceful shutdown, readiness probe, cache per-instance, connection pool chia cho N pod — trên laptop chúng chỉ là chữ.

## Position

```text
Code + Dockerfile
      ↓
[ VPS | PaaS | Container platform | Kubernetes | Serverless | Edge ]
      ↓                                          ← note này
Runtime constraint quyết định NGƯỢC LẠI lên kiến trúc app
```

Mũi tên cuối là điểm quan trọng: **lựa chọn platform giới hạn những gì app được phép làm.** Chọn edge runtime nghĩa là không có `fs`, không có TCP socket, không có process sống lâu — và điều đó loại bỏ một phần lớn kiến thức Node.js.

## Problem

Repo này dạy Docker (behavior 11) rồi Kubernetes (behavior 12). Nhưng giữa hai bước đó có một khoảng trống lớn:

```text
docker-compose trên laptop        ← bạn đang ở đây
        ↓
        ??? 
        ↓
Kubernetes cluster                 ← repo dạy cái này
```

Và phần lớn dự án **không bao giờ** cần bước cuối. Hệ quả của việc bỏ qua khoảng giữa:

| Nếu nhảy thẳng lên K8s | Nếu không deploy gì |
|---|---|
| Học YAML mà chưa gặp vấn đề nó giải quyết | Không kiểm chứng được graceful shutdown, probe, multi-instance |
| Vận hành một cluster cho một app | Không biết `NEXT_PUBLIC_*` bị nhúng lúc build |
| Chi phí và độ phức tạp không tương xứng | Không thấy cache per-instance gây bất nhất |

Câu hỏi đúng không phải "học K8s hay không" mà: **mức độ trừu tượng nào phù hợp với giai đoạn hiện tại?**

## Mental Model

Sáu mức, và trục là **bạn quản bao nhiêu**:

```text
        bạn quản nhiều                              platform quản nhiều
        kiểm soát cao                               tiện lợi cao
   ┌────────┬─────────┬──────────────┬──────┬────────────┬──────┐
   │  VPS   │  PaaS   │  Container   │ K8s  │ Serverless │ Edge │
   └────────┴─────────┴──────────────┴──────┴────────────┴──────┘
     OS,      git push   Dockerfile    mọi    hàm, không   V8
     patch,   là deploy  + config      thứ    server       isolate
     nginx,
     systemd
```

Nhưng trục "tiện lợi" gây nhầm lẫn, vì **hai mức cuối không phải "tiện hơn" — chúng là runtime KHÁC**:

```text
VPS / PaaS / Container / K8s     → Node.js đầy đủ
                                   fs, TCP, process sống lâu, worker_threads

Serverless (Lambda)              → Node.js, nhưng process EPHEMERAL
                                   cold start, không giữ kết nối, timeout cứng

Edge (Workers, Deno Deploy)      → KHÔNG PHẢI Node.js
                                   V8 isolate + Web API
                                   không fs, không TCP, giới hạn CPU time
```

Đây là ngã ba đường, không phải một bậc thang. Chọn edge cho API là quyết định kiến trúc, không phải quyết định vận hành.

### Bảng chọn

| | Bạn phù hợp khi | Bạn KHÔNG phù hợp khi |
|---|---|---|
| **VPS** (Hetzner, DO) | muốn hiểu toàn bộ; chi phí thấp và dự đoán được; 1–3 service | không muốn tự patch OS, tự backup, tự monitor |
| **PaaS** (Railway, Render, Fly.io) | muốn deploy trong 10 phút; 1–10 service; team nhỏ | cần kiểm soát network sâu; chi phí ở quy mô lớn |
| **Container platform** (ECS, Cloud Run) | đã có Docker; cần autoscale; ở trong một cloud | muốn tránh vendor lock |
| **Kubernetes** | nhiều service, nhiều team, cần chuẩn hoá deploy; **đã gặp giới hạn của Compose** | một app, một team — nó là chi phí thuần |
| **Serverless** | traffic không đều (0 → burst); job nền; webhook | request dài; cần giữ kết nối DB; cần độ trễ p99 ổn định |
| **Edge** | static/SSR gần người dùng; middleware; API rất nhẹ | cần Node API, driver DB TCP, tính toán nặng |

### Thứ tự học tôi khuyên

```text
1. Docker + Compose trên laptop          ← hiểu container
2. Deploy lên PaaS hoặc VPS               ← LẦN ĐẦU thấy production thật
   + Cloudflare phía trước (DNS/CDN/WAF)
3. Scale lên 2 instance                   ← ĐÂY là lúc nhiều thứ mới lộ ra
4. Kubernetes — chỉ khi đã gặp vấn đề nó giải quyết
```

Bước 3 là bước có giá trị học tập cao nhất, và nó rẻ: hầu hết PaaS cho bạn tăng replica bằng một dòng config. Xem phần dưới.

## How It Works

### Điều gì thật sự đổi khi lên production

Đây là danh sách kiểm chứng — mỗi mục là một thứ repo dạy mà chỉ production xác nhận được:

```text
□ Env var: NEXT_PUBLIC_* bị NHÚNG lúc build
    → một artifact cho nhiều môi trường thì không dùng được nó
□ Bind 0.0.0.0, không phải 127.0.0.1
    → localhost trong container chỉ là chính container đó
□ Graceful shutdown: SIGTERM → readiness=false → chờ → close
    → thiếu delay trước close = 502 mỗi lần deploy
□ Health check: readiness ≠ liveness
    → liveness kiểm tra DB = restart storm khi DB chậm
□ PID 1: node, không phải npm
    → npm không forward SIGTERM → luôn bị SIGKILL
□ Connection pool × số instance ≤ max_connections
    → scale app lên 10 pod có thể làm sập database
□ Cache in-memory không chia sẻ giữa instance
    → dữ liệu "lúc cũ lúc mới" khi F5
□ Log ra stdout, không ra file
    → file trong container biến mất
□ File upload không lưu vào filesystem container
    → mất khi restart; pod khác không thấy
□ Migration là bước RIÊNG trong CI/CD
    → không chạy trong entrypoint của mọi pod
```

Mười mục này là phần lớn khác biệt giữa "chạy trên máy tôi" và "chạy trong production". Xem [Deployment & production](../../01-web-frontend/03-nextjs/behavior/08-deployment-production.md).

### VPS — khi bạn muốn hiểu hết

```bash
# Hetzner CX22: ~4 EUR/tháng, 2 vCPU, 4GB RAM
# Đủ cho: Next.js + NestJS + PostgreSQL + Redis của một app thật

# Cấu trúc thực dụng
/opt/app/
  docker-compose.yml       # web, api, db, redis
  .env                     # secret, chmod 600
  Caddyfile                # reverse proxy + TLS TỰ ĐỘNG
```

```caddyfile
# Caddy: TLS tự động, không cần certbot
app.example.com {
  reverse_proxy web:3000
}
api.example.com {
  reverse_proxy api:3000
}
```

Caddy đáng nhắc: nó tự xin và gia hạn Let's Encrypt certificate, không cần cron, không cần cấu hình. Với VPS nhỏ, nó tiết kiệm nhiều thời gian so với nginx + certbot.

**Bạn phải tự làm:** patch OS, firewall (`ufw`), backup database (và **kiểm tra restore**), monitor, log rotation, và deploy (script hoặc [Coolify](https://coolify.io) / Dokploy cho UI).

**Giới hạn thật:** một máy = một điểm hỏng. Không có zero-downtime deploy trừ khi bạn tự dựng. Scale = mua máy to hơn.

Với dự án học tập hoặc sản phẩm nhỏ, đánh đổi này thường **đúng** — và bạn học được nhiều nhất ở đây.

### PaaS — deploy trong 10 phút

```yaml
# railway.json / render.yaml — ví dụ khái niệm
services:
  - name: api
    dockerfile: ./apps/api/Dockerfile
    healthCheckPath: /health
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: main, property: connectionString }
    numReplicas: 2                 # ← DÒNG QUAN TRỌNG NHẤT để học
```

Dòng `numReplicas: 2` là bài học đắt giá nhất bạn mua được với giá rẻ nhất. Đổi từ 1 sang 2 và quan sát:

```text
□ Cache in-memory có bất nhất không?     → dữ liệu nhảy khi F5
□ Session lưu ở đâu?                      → đăng xuất ngẫu nhiên nếu in-memory
□ Cron job chạy mấy lần?                  → 2 lần! cần leader election/lock
□ Connection pool tổng là bao nhiêu?      → 2 × pool_size
□ Deploy có mất request không?            → graceful shutdown
□ WebSocket có hoạt động?                 → cần sticky session hoặc Redis pub/sub
```

Sáu câu này là behavior 11–12 của repo, và chúng trở nên **thật** chỉ với một dòng config.

**PaaS lo:** TLS, DNS, build, rolling deploy, log, metric cơ bản, managed PostgreSQL/Redis.
**Bạn vẫn phải lo:** graceful shutdown, health check đúng, pool sizing, migration là bước riêng.

**Giới hạn:** chi phí tăng nhanh ở quy mô lớn; kiểm soát network hạn chế; vendor lock ở mức cấu hình (nhưng Dockerfile thì portable).

### Serverless — mô hình khác, không phải "server nhỏ hơn"

```text
Request → cold start? → chạy hàm → THOÁT
                                    ↑ mọi state trong memory MẤT
```

Ba ràng buộc quyết định:

```text
1. COLD START        200ms–2s cho lần gọi đầu (hoặc sau khi idle)
                     → p99 latency không ổn định
2. KHÔNG GIỮ KẾT NỐI Mỗi instance mở connection DB riêng
                     → 100 concurrent = 100 connection → CẠN max_connections
                     → BẮT BUỘC dùng pooler (RDS Proxy, PgBouncer, Neon/Supabase pooler)
3. TIMEOUT CỨNG      15 phút (Lambda), 60s (Vercel Functions tuỳ plan)
                     → job dài không chạy được
```

Ràng buộc 2 là ràng buộc phá vỡ nhiều kiến trúc nhất: mọi thứ repo dạy về [connection pool](../../03-database/01-postgresql/fundamentals/02-connection-pool.md) đảo ngược. Với serverless + PostgreSQL, **pooler là bắt buộc**, không phải tối ưu.

**Phù hợp:** webhook handler, job nền, cron, API traffic rất không đều, xử lý ảnh/file theo sự kiện.
**Không phù hợp:** API cần p99 ổn định, WebSocket, request dài, app có state trong memory.

### Kubernetes — khi nào thật sự cần

Repo đã có [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md). Tóm tắt điều kiện:

```text
✅ Cần K8s khi:
   - nhiều service (> ~5–10) và nhiều team
   - cần chuẩn hoá deploy/rollback/scaling cho tất cả
   - đã gặp giới hạn CỤ THỂ của Compose/PaaS
   - có người vận hành nó

❌ Chưa cần khi:
   - 1–3 service, một team
   - "sau này sẽ cần"                  → YAGNI
   - "vì đó là best practice"          → không phải lý do
```

K8s là **chi phí thường trực**: cluster, upgrade, RBAC, networking, storage, monitoring. Với một app, PaaS hoặc VPS rẻ hơn nhiều lần về cả tiền và thời gian.

### Managed database — quyết định riêng

```text
Self-host PostgreSQL trong container
  ✅ rẻ nhất, kiểm soát hoàn toàn, học được nhiều
  ❌ BẠN chịu trách nhiệm backup, restore, HA, upgrade, tuning
  → dùng cho: dev, học, sản phẩm nhỏ có backup được kiểm tra

Managed (RDS, Neon, Supabase, Cloud SQL)
  ✅ backup tự động + PITR, HA, upgrade, monitoring
  ❌ đắt hơn, ít kiểm soát tham số, có thể có connection limit thấp
  → dùng cho: production có dữ liệu quan trọng
```

Nguyên tắc thực dụng: **app có thể self-host lâu, database thì nên managed sớm.** Lý do: mất app là restart; mất dữ liệu là mất vĩnh viễn. Và "chúng tôi có backup" không có nghĩa gì cho tới khi bạn **restore thử**. Xem [WAL, durability & backup](../../03-database/01-postgresql/operations/01-wal-durability-backup.md).

Với Neon/Supabase, chú ý **connection pooling mode**: transaction pooling không hỗ trợ prepared statement như session pooling — Prisma cần `?pgbouncer=true`.

## Example

```text
Lộ trình thực tế cho một dự án học tập → sản phẩm

Giai đoạn 1 — học (0đ)
  docker-compose trên laptop
  → hiểu container, network, volume, env

Giai đoạn 2 — deploy lần đầu (~5–10 USD/tháng)
  VPS (Hetzner) + Caddy + docker-compose
  hoặc PaaS (Railway/Render) free/hobby tier
  + Cloudflare: DNS, CDN, WAF (miễn phí)
  → kiểm chứng 10 mục trong checklist ở trên

Giai đoạn 3 — HỌC ĐƯỢC NHIỀU NHẤT (~15–30 USD/tháng)
  Tăng lên 2 replica
  Database managed (Neon free tier / Supabase)
  Redis managed (Upstash free tier)
  → cache bất nhất, cron chạy 2 lần, pool sizing, sticky session
  → ĐÂY là nơi behavior 11–12 trở thành thật

Giai đoạn 4 — chỉ khi cần
  Container platform (Cloud Run / ECS) hoặc K8s
  → khi có nhiều service và nhiều người
```

Giai đoạn 3 là giai đoạn tôi khuyên đầu tư thời gian nhất. Nó rẻ, và nó là nơi phần lớn kiến thức production của repo được kiểm chứng.

## Prediction

1. Deploy Next.js với `NEXT_PUBLIC_API_URL=staging`, promote artifact đó sang production — client gọi API nào?
2. Bind `127.0.0.1:3000` trong container, gọi từ container khác — kết quả?
3. `CMD npm start` trong Dockerfile, K8s gửi SIGTERM — exit code cuối?
4. Cron job trong app, scale lên 3 replica — job chạy mấy lần?
5. Pool size 20, scale lên 10 pod, `max_connections = 100` — điều gì xảy ra?
6. Cache in-memory, 2 replica, người dùng F5 nhiều lần — họ thấy gì?
7. Session trong memory, 2 replica, không sticky — người dùng thế nào?
8. Lambda với 100 request đồng thời, PostgreSQL không có pooler — connection?
9. Cloudflare Workers, code có `import fs from 'node:fs'` — kết quả?
10. Log ra file trong container, container restart — log còn không?

<details>
<summary>Đáp án</summary>

1. **Staging** — giá trị đã nhúng vào bundle lúc build.
2. Connection refused — `localhost` là chính container đó.
3. **137** (SIGKILL) — `npm` không forward SIGTERM.
4. **3 lần** — cần leader election hoặc distributed lock.
5. 200 connection cần > 100 có → `too many connections`, app sập.
6. Dữ liệu "lúc cũ lúc mới" tuỳ pod nào phục vụ.
7. Đăng xuất ngẫu nhiên.
8. ~100 connection — cạn `max_connections` nhanh. Pooler là bắt buộc.
9. Build/runtime error — Workers không có Node API.
10. **Mất** — filesystem container ephemeral. Log phải ra stdout.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Deploy 1 replica, chạy load test, `rollout restart` | Đếm lỗi — baseline |
| Thêm graceful shutdown + delay, làm lại | Lỗi về 0 |
| Tăng lên 2 replica với cache in-memory, F5 20 lần | Dữ liệu nhảy |
| Chuyển cache sang Redis, làm lại | Nhất quán |
| Cron trong app với 3 replica, log mỗi lần chạy | 3 log cùng lúc |
| Thêm distributed lock | 1 log |
| Session in-memory, 2 replica, refresh nhiều lần | Đăng xuất ngẫu nhiên |
| `CMD npm start`, `docker stop`, đo thời gian và exit code | ~10s rồi 137 |
| Đổi `CMD ["node", ...]` | Thoát nhanh, exit 0 |
| Pool 20 × 6 pod với `max_connections=100` | `too many connections` |
| Ghi file upload vào container, restart | File mất |
| `grep -r "NEXT_PUBLIC" .next/static` sau build | Thấy giá trị đã nhúng |

Chuỗi 3–4 và 5–6 là hai thí nghiệm có giá trị học tập cao nhất — chúng biến hai khái niệm trừu tượng thành hai lỗi bạn tự tạo và tự sửa.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Kubernetes là bước tiếp theo sau Docker | Với 1 app, PaaS/VPS phù hợp hơn nhiều |
| Serverless là "server nhỏ hơn" | Process ephemeral, cold start, không giữ connection |
| Edge runtime là Node.js chạy gần người dùng | Là V8 isolate, **không** có Node API |
| Deploy được là xong | 10 mục trong checklist chỉ lộ ra ở production |
| 1 replica và N replica chỉ khác số lượng | N replica đổi kiến trúc: cache, session, cron, pool |
| Managed database là "cho người không biết làm" | Mất dữ liệu là vĩnh viễn; đây là quyết định rủi ro |
| Có backup nghĩa là an toàn | Backup chưa restore thử không phải backup |
| PaaS đắt nên tự host rẻ hơn | Tính cả thời gian vận hành thì thường không |
| VPS không dùng được cho production | Rất nhiều sản phẩm thật chạy trên một VPS |

## Debugging

1. **Chạy được ở local, lỗi ở production** → đi qua 10 mục checklist theo thứ tự. Nó bắt phần lớn trường hợp.
2. **502 khi deploy** → graceful shutdown; kiểm tra có delay trước `server.close()` chưa.
3. **Container không nhận kết nối** → `ss -tlnp` trong container; nếu thấy `127.0.0.1` thì đó là nguyên nhân.
4. **Exit code 137** → SIGKILL: PID 1 sai, hoặc OOM, hoặc grace period hết. `kubectl describe pod` phân biệt được.
5. **Hành vi khác nhau giữa các lần request** → nhiều instance với state in-memory. Scale về 1 để xác nhận.
6. **`too many connections`** → `số_instance × pool_size` so với `max_connections`.
7. **Log mất** → đang ghi ra file; chuyển sang stdout.
8. **Env var không đúng** → phân biệt build-time và run-time; `grep` bundle để kiểm tra.

## Production Considerations

- **Deploy sớm, deploy nhỏ.** Một app đã deploy dạy nhiều hơn mười tutorial.
- **Chạy 2 replica càng sớm càng tốt** — nó là bài kiểm tra kiến trúc rẻ nhất.
- **Database managed sớm** với backup **đã restore thử**.
- **Cloudflare (hoặc CDN khác) phía trước** cho DNS/TLS/CDN/WAF — độc lập với platform. Xem [Cloudflare & edge](02-cloudflare-and-edge.md).
- **Một artifact cho mọi môi trường**; cấu hình khác biệt đọc lúc **runtime**.
- **Migration là bước riêng** trong pipeline, trước khi deploy code.
- **Log ra stdout**; state ra Redis/database; file ra object storage.
- **Ghi lại lý do chọn platform** — và điều kiện để đổi. Nếu không, ba năm sau không ai biết vì sao.
- **Đừng tối ưu chi phí trước khi có traffic**, và đừng chọn K8s trước khi có vấn đề nó giải quyết.

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| VPS | rẻ, dự đoán được, học nhiều nhất, không lock | tự patch/backup/monitor; một điểm hỏng |
| PaaS | deploy nhanh, TLS/CDN/log sẵn, scale một dòng | chi phí ở quy mô lớn, kiểm soát hạn chế |
| Container platform | autoscale, tích hợp cloud | vendor lock, phức tạp hơn PaaS |
| Kubernetes | chuẩn hoá cho nhiều service/team | chi phí vận hành thường trực |
| Serverless | scale-to-zero, trả theo dùng | cold start, cần pooler, timeout cứng |
| Edge | độ trễ thấp toàn cầu | không phải Node.js — giới hạn lớn |
| Self-host DB | rẻ, kiểm soát, học nhiều | rủi ro mất dữ liệu thuộc về bạn |
| Managed DB | backup/HA/PITR | đắt hơn, ít kiểm soát tham số |

## Explain Without Notes

1. Vì sao không kiểm chứng được kiến thức production mà không deploy?
2. Vì sao edge và serverless là "ngã ba", không phải "bậc thang tiện lợi"?
3. Sáu thứ đổi khi tăng từ 1 lên 2 replica?
4. Ba ràng buộc của serverless, và cái nào phá vỡ kiến trúc DB?
5. Điều kiện để thật sự cần Kubernetes?
6. Vì sao "app self-host được lâu, database nên managed sớm"?

## Related

- [Cloudflare & edge](02-cloudflare-and-edge.md) — Cloudflare cụ thể, và Workers không phải Node.js
- [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md) — điều kiện cần
- [Production image](../02-docker/07-production-image.md) — multi-stage, non-root, PID 1
- [Compose](../02-docker/06-compose.md) — multi-service trên một máy
- [Common Docker failures](../02-docker/08-common-failures.md) — bind address, volume
- [CI/CD pipeline](../03-cicd/01-pipeline.md) · [Artifact promotion](../03-cicd/02-build-artifact-promotion.md)
- [Deployment & production (Next.js)](../../01-web-frontend/03-nextjs/behavior/08-deployment-production.md) — 5 điều chỉ lộ ở production
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md)
- [Connection pool](../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — pool × instance
- [Readiness & liveness](../04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md)
