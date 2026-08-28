---
level: intermediate
area: infra
---

# Platforms: chạy app ở đâu

Folder này lấp khoảng trống giữa `docker-compose` trên laptop và Kubernetes cluster — nơi phần lớn dự án thật sống, và nơi repo trước đây không nói gì.

## Vì sao folder này tồn tại

Repo dạy Docker (behavior 11) rồi Kubernetes (behavior 12). Nhưng:

```text
docker-compose trên laptop
        ↓
        ???            ← khoảng trống này
        ↓
Kubernetes cluster
```

Và phần lớn dự án **không bao giờ** cần bước cuối.

Quan trọng hơn: **bạn không kiểm chứng được bất cứ điều gì repo dạy về production cho tới khi có hai instance sau một load balancer.** Graceful shutdown, readiness probe, cache per-instance, connection pool chia cho N pod — trên laptop chúng chỉ là chữ.

## Nội dung

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Chạy ở đâu](01-where-to-run.md) | VPS / PaaS / container / K8s / serverless / edge — chọn thế nào? |
| 2 | [Cloudflare & edge runtime](02-cloudflare-and-edge.md) | Cloudflare là ba quyết định khác nhau; Workers **không phải** Node.js |

## Thứ tự học tôi khuyên

```text
1. Docker + Compose trên laptop         ← hiểu container
2. Deploy lên PaaS hoặc VPS              ← lần đầu thấy production thật
   + Cloudflare phía trước (DNS/CDN/WAF)
3. Tăng lên 2 replica                    ← HỌC ĐƯỢC NHIỀU NHẤT, và rẻ
4. Kubernetes — chỉ khi đã gặp giới hạn của bước 2–3
```

Bước 3 là bước có tỉ lệ (giá trị học tập)/(chi phí) cao nhất trong toàn bộ repo. Một dòng config, và sáu khái niệm trở thành thật:

```text
□ Cache in-memory bất nhất        → dữ liệu nhảy khi F5
□ Session in-memory               → đăng xuất ngẫu nhiên
□ Cron chạy 2 lần                 → cần leader election / distributed lock
□ Connection pool × 2             → có thể cạn max_connections
□ Deploy mất request              → cần graceful shutdown
□ WebSocket không hoạt động       → cần sticky session hoặc Redis pub/sub
```

## Điểm quan trọng nhất về Cloudflare

Nó là **ba quyết định độc lập**, và nhầm chúng là nguồn của mọi tranh luận vô ích:

| Lớp | Với stack Next.js + NestJS + PostgreSQL |
|---|---|
| **DNS / TLS / CDN / WAF** trước app | ✅ gần như luôn nên — không đổi code, giá trị cao |
| **Pages** (host frontend) | ⚠️ được, nếu Server Component không dùng Node API |
| **Workers** (host API) | ❌ **không phải Node.js** — NestJS, `pg`, `argon2`, `sharp` đều không chạy |

Workers là **V8 isolate + Web API**, không phải Node runtime. Chuyển sang nó là đổi runtime, không phải tối ưu hiệu năng.

Mô hình đúng là **hybrid**: edge cho frontend và middleware, Node origin cho API/DB/job.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Chạy ở local, lỗi ở production | đi qua checklist 10 mục → [1](01-where-to-run.md) |
| 502 mỗi lần deploy | thiếu graceful shutdown → [1](01-where-to-run.md) |
| Exit code 137 | PID 1 là `npm`, hoặc OOM → [1](01-where-to-run.md) |
| Hành vi khác nhau giữa các request | nhiều instance với state in-memory → [1](01-where-to-run.md) |
| `too many connections` sau khi scale | pool × instance > max_connections → [1](01-where-to-run.md) |
| Cron chạy nhiều lần | nhiều replica, thiếu lock → [1](01-where-to-run.md) |
| Rate limit không hoạt động sau Cloudflare | thiếu `CF-Connecting-IP` / `trust proxy` → [2](02-cloudflare-and-edge.md) |
| CDN trả dữ liệu người này cho người khác | Cache Everything cho `/api/*` → [2](02-cloudflare-and-edge.md) |
| Ai đó tấn công trực tiếp vào IP origin | bật proxy nhưng không firewall origin → [2](02-cloudflare-and-edge.md) |
| WebSocket bị cắt sau ~100 giây | thiếu heartbeat → [2](02-cloudflare-and-edge.md) |
| KV trả giá trị cũ | eventually consistent, không dùng cho session → [2](02-cloudflare-and-edge.md) |
| NestJS không deploy được lên Workers | Workers không có Node API → [2](02-cloudflare-and-edge.md) |

## Position

```text
Code + Dockerfile
      ↓
[ VPS | PaaS | Container | K8s | Serverless | Edge ]     ← folder này
      ↓
Cloudflare / CDN
      ↓
User
```

## Related

- [02-docker/](../02-docker/README.md) — container là nền của mọi lựa chọn ở đây
- [04-kubernetes/](../04-kubernetes/README.md) — mức trừu tượng cuối, cần điều kiện
- [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md) — điều kiện cụ thể
- [03-cicd/](../03-cicd/README.md) — deploy tự động, artifact promotion
- [Reverse proxy & load balancer](../01-networking/05-reverse-proxy-load-balancer.md)
- [Deployment & production (Next.js)](../../01-web-frontend/03-nextjs/behavior/08-deployment-production.md) — 5 điều chỉ lộ ở production
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md)
- [Connection pool](../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — pool × instance
- [File storage](../../02-backend-api/05-integrations/03-file-storage.md) — R2
