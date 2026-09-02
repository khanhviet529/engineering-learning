# Flowboard

> A small, reliable workspace for teams to turn ideas into shipped work.

Flowboard là một sản phẩm quản lý công việc cho các team nhỏ. Người dùng tạo project, chia task, trao đổi trong comment và theo dõi lịch sử thay đổi trên một board trực quan.

Đây cũng là **full-stack product lab** của repository này: mỗi tính năng được xây như một sản phẩm thật, sau đó dùng để quan sát các behavior từ browser đến production.

## Product in one minute

Một team thường gặp ba vấn đề:

- task nằm rải rác trong chat và không ai biết trạng thái mới nhất;
- thay đổi không có lịch sử nên khó trả lời “ai đã làm gì và khi nào”;
- công cụ quản lý công việc quá lớn so với nhu cầu của team nhỏ.

Flowboard giải quyết phần lõi đó bằng một workspace đơn giản:

```text
Create workspace → Create project → Plan tasks → Execute work → Review history
```

### Primary users

- **Member**: xem, cập nhật và trao đổi về task được phép truy cập.
- **Project owner**: quản lý task, thành viên và tiến độ của project.
- **Workspace admin**: quản lý workspace, thành viên và quyền truy cập.

### Core user journey

```text
Sign up → Create workspace → Create project → Invite member
                                      ↓
                         Create task → Move task → Comment → Review history
```

## MVP scope

MVP chỉ tập trung vào một vòng đời hoàn chỉnh của task:

- đăng ký, đăng nhập và đăng xuất;
- workspace, project và membership;
- task với title, description, status, priority, assignee và due date;
- board với `Todo`, `In Progress`, `Done`;
- comment, activity log và role-based access control;
- empty, loading, error và permission states.

Chưa làm trong MVP: chat realtime, billing, mobile app, public API, microservices và notification đa kênh.

## Why this is a serious engineering project

| Product behavior | Engineering behavior được quan sát |
|---|---|
| Board cập nhật task | UI state, optimistic update, async race |
| Nhiều người cùng sửa task | transaction, lost update, conflict handling |
| Thành viên chỉ thấy project được phép truy cập | authentication, authorization, data boundary |
| Activity log không được sai lệch | transaction và auditability |
| Board tải nhanh khi có nhiều task | query shape, index, pagination, cache |
| Gửi notification sau thay đổi | queue, retry, idempotency |
| Chạy giống nhau ở local và CI | container networking, health check, reproducibility |

## Architecture evolution

```text
Phase 1–3: Browser → Next.js → NestJS → in-memory
Phase 4–7: Browser → Next.js → NestJS → PostgreSQL
Phase 8:   NestJS ─┬→ PostgreSQL
                   ├→ Redis
                   └→ Worker/Queue
Phase 9–10: Docker Compose → CI/CD → Observability → Kubernetes local
```

Kiến trúc bắt đầu là **modular monolith**. Các module có boundary rõ ràng trong code; chỉ tách deployment khi có yêu cầu và số liệu chứng minh cần thiết.

## Documentation map

- [Product brief](docs/product-brief.md) — Flowboard dành cho ai và tại sao tồn tại.
- [Requirements](docs/requirements.md) — scope, use cases, acceptance criteria và non-goals.
- [Domain model](docs/domain-model.md) — entity, invariant và permission model.
- [Architecture](docs/architecture.md) — boundary, request flow và các quyết định kỹ thuật.
- [Delivery roadmap](docs/roadmap.md) — từng phase, failure experiment và definition of done.

## Stack

- Web: Next.js, React, TypeScript
- API: NestJS, TypeScript
- Data: PostgreSQL
- Cache/queue: Redis (introduced later)
- Testing: unit, integration, end-to-end
- Delivery: Docker Compose, CI, local Kubernetes

## Learning rule

Mỗi phase phải có đủ vòng:

```text
Model → Predict → Build → Break → Explain
```

Không đánh dấu hoàn thành chỉ vì feature “chạy được”. Một phase hoàn thành khi failure tương ứng đã được tái hiện, quan sát và giải thích được.

## Status

Planning / implementation in progress. Đây là một learning project nhưng tài liệu, issue và commit sẽ được viết theo tiêu chuẩn của một product repository công khai.
