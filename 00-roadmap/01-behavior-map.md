---
level: foundation
area: cross-cutting
---

# Behavior Map

Đơn vị học là **behavior/problem**; công nghệ chỉ là dụng cụ thí nghiệm.

File này là bảng dịch giữa hai ngôn ngữ: ngôn ngữ của **hiện tượng** (cái bạn quan sát) và ngôn ngữ của **công nghệ** (cái bạn tra cứu).

## Behavior → công nghệ

| Behavior cần hiểu | Công nghệ thường chạm tới | Note |
|---|---|---|
| Browser biến một URL thành pixel thế nào? | DNS, TCP, TLS, HTTP, DOM, CSSOM | [01](../01-web-frontend/00-web-foundations/01-browser-request-render.md) [04](../01-web-frontend/00-web-foundations/04-rendering-pipeline.md) |
| Vì sao thứ tự async không như tôi nghĩ? | event loop, microtask, Promise | [01](../01-web-frontend/01-javascript-typescript/async-concurrency/01-event-loop-async.md) |
| Vì sao hàm của tôi đọc giá trị cũ? | closure, scope | [03](../01-web-frontend/01-javascript-typescript/fundamentals/01-execution-context-closure.md) |
| UI phản ứng khi state thay đổi thế nào? | React render, reconciliation | [01](../01-web-frontend/02-react/behavior/01-state-render.md) [05](../01-web-frontend/02-react/behavior/05-reconciliation-keys.md) |
| Dữ liệu async đồng bộ với UI thế nào? | effect, cleanup, AbortController, TanStack Query | [02](../01-web-frontend/02-react/behavior/02-effects-lifecycle.md) [03](../01-web-frontend/02-react/behavior/03-async-race-condition.md) [04](../01-web-frontend/02-react/behavior/04-server-state-cache.md) |
| Server và client chia việc thế nào? | Next.js RSC, hydration | [01](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) [04](../01-web-frontend/03-nextjs/behavior/04-rendering-strategies.md) |
| Vì sao trang không cập nhật dù DB đã đổi? | Next.js cache, revalidate | [03](../01-web-frontend/03-nextjs/behavior/03-data-fetching-cache.md) |
| Một HTTP request đi qua backend ra sao? | HTTP, Node.js, NestJS pipeline | [01](../02-backend-api/00-http-api/01-http-request-response.md) [01](../02-backend-api/02-nestjs/behavior/01-request-lifecycle.md) |
| Vì sao request bị từ chối? | CORS, auth, validation, guard, rate limit | [06](../01-web-frontend/00-web-foundations/06-cors.md) [03](../02-backend-api/02-nestjs/behavior/03-validation-errors.md) [04](../02-backend-api/02-nestjs/behavior/04-guards-interceptors.md) |
| Vì sao một endpoint chậm làm cả server chậm? | event loop blocking | [01](../02-backend-api/01-nodejs/fundamentals/01-runtime-concurrency.md) [04](../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) |
| Code mới nên đặt ở đâu? | layering, DI, modular monolith | [01](../02-backend-api/04-architecture/01-controller-service-repository.md) [02](../02-backend-api/04-architecture/02-modular-monolith.md) |
| Dữ liệu được lưu bền vững thế nào? | transaction, WAL, fsync | [06](../03-database/01-postgresql/operations/01-wal-durability-backup.md) |
| Vì sao hai request đồng thời làm sai dữ liệu? | transaction, MVCC, isolation, lock | [01](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) [05](../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) |
| Vì sao query nhanh/chậm? | index, query planner, EXPLAIN | [02](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) [08](../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md) |
| Vì sao table phình to dù đã xoá dữ liệu? | MVCC, dead tuple, vacuum | [04](../03-database/01-postgresql/transactions-concurrency/02-mvcc-vacuum.md) |
| Cache làm nhanh hơn nhưng sai ở đâu? | TTL, invalidation, stampede | [01](../03-database/02-redis/01-cache-invalidation.md) [03](../03-database/02-redis/03-cache-patterns.md) |
| Việc nặng không nên làm trong request thì làm ở đâu? | queue, worker, job | [01](../03-database/04-message-queues/01-why-queue.md) |
| Vì sao job chạy hai lần? | at-least-once, ack | [02](../03-database/04-message-queues/02-delivery-semantics.md) |
| Vì sao app chạy local nhưng container không chạy? | namespace, network, filesystem, env | [08](../04-infrastructure/02-docker/08-common-failures.md) [02](../04-infrastructure/02-docker/02-container-networking.md) |
| Vì sao container mất dữ liệu? | layer, volume | [03](../04-infrastructure/02-docker/03-volumes-state.md) |
| Khi process/container chết, hệ thống hồi phục thế nào? | restart policy, desired state | [04](../04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md) [01](../04-infrastructure/04-kubernetes/workloads-networking/01-pod-deployment-service.md) |
| Vì sao deploy gây downtime? | readiness, rolling update, graceful shutdown | [02](../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) [05](../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) |
| Làm sao biết production đang hỏng ở đâu? | logs, metrics, traces | [01](../05-cross-cutting/observability/01-logs-metrics-traces.md) |
| Vì sao một service chậm làm sập cả hệ thống? | timeout, retry storm, circuit breaker | [02](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) |
| Kẻ tấn công có thể làm gì? | XSS, CSRF, SQLi, SSRF, access control | [security/](../05-cross-cutting/security/README.md) |
| Làm sao hệ thống chịu tải tăng? | caching, queue, replication, sharding, LB | [06-system-design/](../06-system-design/README.md) |

## Công nghệ → behavior nào nó thực sự giải quyết

Đọc bảng này theo chiều ngược lại giúp tránh cargo cult: thêm một công nghệ mà không biết nó giải quyết behavior nào là cách tạo ra độ phức tạp miễn phí.

| Công nghệ | Behavior nó giải quyết | Nếu bạn chưa gặp behavior này thì |
|---|---|---|
| TanStack Query | server state có lifecycle riêng (stale, refetch, dedupe, race) | `useEffect` + `useState` là đủ |
| Next.js RSC | giảm JS gửi xuống client, fetch gần data | SPA thuần đủ dùng |
| NestJS | request lifecycle có nhiều concern cần tách trạm | Express + vài file là đủ |
| Redis | có chi phí đọc lặp lại, hoặc cần state chia sẻ giữa instance | in-memory Map là đủ |
| Message queue | công việc không cần xong trong request, hoặc cần chịu tải đột biến | gọi trực tiếp là đủ |
| Docker | môi trường chạy khác nhau giữa máy và server | script setup là đủ |
| Kubernetes | nhiều instance cần tự hồi phục, tự scale, deploy không downtime | Compose là đủ |
| Distributed tracing | request đi qua nhiều service, không rõ thời gian ở đâu | log có request ID là đủ |
| Microservices | các phần cần deploy/scale/sở hữu độc lập bởi nhiều team | modular monolith là đủ |

Quy tắc: **thêm công nghệ khi đã cảm nhận được problem, không phải trước đó.** Đó cũng là lý do [Roadmap](02-roadmap.md) đặt Kubernetes ở behavior 12 chứ không ở behavior 3.

## Quy tắc Position

Mỗi note phải định vị được trên xương sống. Ghi cụ thể, không ghi nhãn chung:

```text
✅ Position: React → HTTP API → NestJS guard
❌ Position: Frontend
```

Lý do: `Position` không phải để phân loại, mà để bạn biết **khi debug thì đi tiếp về hướng nào**. Nhãn "Frontend" không nói được điều đó.

## Related

- [Roadmap](02-roadmap.md) — 12 behavior theo thứ tự phụ thuộc
- [Behavior Index](behavior-index.md) — tra theo triệu chứng cụ thể
- [Knowledge Map](knowledge-map.md) — tra theo tầng hệ thống
- [Learning System](00-learning-system.md) — vòng học
