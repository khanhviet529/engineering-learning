---
level: foundation
area: cross-cutting
---

# Project Roadmap

Behavior nào được thực hành trong phase nào của [Fullstack Lab](../07-projects/fullstack-lab/README.md).

Lý do file này tồn tại: đọc note tạo ra *recognition*, build tạo ra *ability*. Nếu không có một hệ thống thật để mọi experiment tích luỹ vào, bạn sẽ có 50 sandbox rời rạc và không có kinh nghiệm nào về việc các tầng tương tác với nhau.

## Nguyên tắc

1. **Một project duy nhất, lớn dần.** Không tạo project mới cho mỗi công nghệ. Độ phức tạp tích luỹ chính là thứ cần học.
2. **Mỗi phase thêm đúng một loại độ phức tạp.** Thêm Redis và Kubernetes cùng lúc thì khi hỏng bạn không biết cái nào gây ra.
3. **Không phase nào xong nếu chưa cố tình phá.** Tiêu chí hoàn thành luôn gồm một failure đã tái hiện được và đã debug được.
4. **Không cần implement hết mọi feature.** Cần đủ để behavior xuất hiện. Một endpoint đủ để học transaction; không cần 30 endpoint.

## Domain

Task/issue management nhỏ: `users`, `projects`, `tasks`, `comments`, `roles`, `activity_log`.

Đủ đơn giản để không mất thời gian vào business logic, đủ giàu để có: quan hệ nhiều-nhiều, ownership, concurrency trên cùng một record, dữ liệu nên cache, việc nên đưa vào queue.

## Bản đồ phase → behavior → note

| Phase | Thêm gì | Behavior thực hành | Failure phải tự tạo được |
|---|---|---|---|
| [01](../07-projects/fullstack-lab/phases/phase-01-ui-state.md) | React UI + state, không backend | 02 | list mất state khi re-order; render vô hạn |
| [02](../07-projects/fullstack-lab/phases/phase-02-async-ui.md) | Mock API + async UI | 03 | race condition ghi đè state mới |
| [03](../07-projects/fullstack-lab/phases/phase-03-api-crud.md) | NestJS CRUD + validation | 05, 06 | payload sai lọt qua; 500 thay vì 400 |
| [04](../07-projects/fullstack-lab/phases/phase-04-database.md) | PostgreSQL + quan hệ thật | 07 | FK violation; dữ liệu mồ côi |
| [05](../07-projects/fullstack-lab/phases/phase-05-auth.md) | Auth + authorization | cross-cutting | user A đọc dữ liệu user B |
| [06](../07-projects/fullstack-lab/phases/phase-06-concurrency.md) | Concurrent write | 08 | lost update; deadlock |
| [07](../07-projects/fullstack-lab/phases/phase-07-performance.md) | Seed dữ liệu lớn + index | 09 | seq scan trên 1M dòng; N+1 |
| [08](../07-projects/fullstack-lab/phases/phase-08-cache-queue.md) | Redis + queue/worker | 10 | stale data; job chạy 2 lần |
| [09](../07-projects/fullstack-lab/phases/phase-09-docker.md) | Docker Compose toàn stack | 11 | `localhost` trong container; mất data khi restart |
| [10](../07-projects/fullstack-lab/phases/phase-10-production.md) | CI/CD, observability, K8s, load test | 12 | deploy downtime; cascading failure |

## Kiến trúc lớn dần

**Sau phase 03:**

```text
Browser → Next.js → HTTP → NestJS → (in-memory)
```

**Sau phase 05:**

```text
Browser → Next.js → HTTP → NestJS → PostgreSQL
              ↑ session/token
```

**Sau phase 08:**

```text
Browser → Next.js → HTTP → NestJS ─┬→ PostgreSQL
                                   ├→ Redis (cache, rate limit)
                                   └→ Queue → Worker → PostgreSQL
```

**Sau phase 09:**

```text
Docker network
 ┌────────────────────────────────────────────┐
 │ nginx → web(Next.js) → api(NestJS) ─┬→ db  │
 │                                     ├→ redis│
 │                          worker ────┘      │
 └────────────────────────────────────────────┘
```

**Sau phase 10:**

```text
Ingress → Service → Deployment(api ×3) ─┬→ PostgreSQL (StatefulSet / managed)
                                        ├→ Redis
                                        └→ Worker Deployment
   + probes + resource limits + HPA
   + OpenTelemetry → traces/metrics/logs
   + CI: lint → test → build → push → deploy
```

## Thứ tự lồng ghép note và build

Với mỗi phase:

```text
1. Đọc note của behavior tương ứng   → MODEL
2. Viết prediction vào learning log  → PREDICT
3. Build feature nhỏ nhất            → BUILD
4. Chạy bảng "Break It" của note     → BREAK
5. Viết explanation không nhìn note  → EXPLAIN
6. Buổi sau recall trước khi sang phase tiếp
```

Không sang phase mới khi chưa tạo lại được failure của phase hiện tại. Nếu bạn không tạo lại được nó theo ý muốn thì bạn chưa hiểu nó — bạn chỉ vừa may mắn sửa được.

## Ước lượng thời gian

Không phải cam kết, chỉ để bạn biết mình có đang mắc kẹt bất thường không.

| Phase | Buổi (60–90 phút) |
|---|---|
| 01–02 | 4–6 |
| 03–04 | 6–8 |
| 05 | 4–5 |
| 06–07 | 6–8 |
| 08 | 4–6 |
| 09 | 4–5 |
| 10 | 8–12 |

Tổng khoảng 36–50 buổi. Phase 10 dài nhất và cũng là phase mà phần lớn người học bỏ dở — đó chính là phần phân biệt "biết code" và "biết vận hành".

## Related

- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — chi tiết từng phase
- [Roadmap](02-roadmap.md) — 12 behavior
- [Learning System](00-learning-system.md) — vòng học
- [08-learning-log/](../08-learning-log/README.md) — nơi ghi lại
