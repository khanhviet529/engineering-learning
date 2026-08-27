# Fullstack Lab

Một project xuyên suốt để mọi behavior có nơi thử nghiệm.

## Baseline

```text
Browser
  ↓
Next.js
  ↓ HTTP
NestJS
  ↓
PostgreSQL
```

Sau đó thêm dần:

```text
Browser → Next.js → NestJS → PostgreSQL
                         ├→ Redis
                         └→ Worker/Queue

Dockerize → CI/CD → Observability → Kubernetes
```

## Domain gợi ý

Task/issue management nhỏ:
- users;
- projects;
- tasks;
- comments;
- role/permissions;
- activity log.

Đủ đơn giản để tập trung vào engineering behavior, đủ giàu để học auth, DB relations, concurrency, cache và background jobs.

## Milestones

1. CRUD + validation.
2. Auth + authorization.
3. PostgreSQL relations + transaction.
4. Async UI + race/error handling.
5. Redis cache.
6. Background job.
7. Docker compose.
8. Tests + CI.
9. Logs/metrics/traces.
10. Kubernetes local.
11. Load/failure experiments.
12. Viết system design cuối kỳ.
