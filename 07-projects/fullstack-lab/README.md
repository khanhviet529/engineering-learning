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

## Tài liệu Flowboard

Flowboard là workspace quản lý công việc riêng tư theo project dành cho các nhóm nhỏ. Bắt đầu bằng [bản đồ tài liệu](docs/README.md) để đọc các quyết định theo đúng thứ tự.

**Markdown baseline v0.1: Ready for Pencil.** Mốc này chỉ xác nhận hợp đồng Markdown đã sẵn sàng cho thiết kế UI/UX trong Pencil; không xác nhận UI design hoặc ứng dụng đã hoàn thành.

- Tầm nhìn và phạm vi: `docs/product/vision-and-scope.md`
- Hành trình người dùng: `docs/product/user-journeys.md`
- Kiến trúc thông tin: `docs/design/information-architecture.md`
- Luồng người dùng: `docs/design/user-flows.md`
- Danh mục màn hình: `docs/design/screen-inventory.md`
- Mô hình miền: `docs/data/domain-model.md`
- Mô hình phân quyền: `docs/security/authorization-model.md`
- Hợp đồng endpoint: `docs/api/endpoint-contracts.md`

### Approved baseline

- [Flowboard Product & Architecture Design](docs/superpowers/specs/2026-09-01-flowboard-product-architecture-design.md)
- [Flowboard Time Tracking Design — Phase 1.3](docs/superpowers/specs/2026-09-02-flowboard-time-tracking-design.md) (baseline bổ sung; xem [kế hoạch triển khai](docs/superpowers/plans/2026-09-02-flowboard-time-tracking-documentation-and-design.md))

## Milestones

1. Xác lập authentication, opaque session, CSRF và authorization project-scope trước khi có dữ liệu project.
2. Vertical slice workspace/project private: membership, capability server-computed, query scope và forbidden/not-found behavior.
3. Vertical slice board: Owner cấu hình cột; Owner/Editor/Viewer chỉ thấy và thao tác theo permission.
4. Vertical slice task/comment/activity: create, assign, move, optimistic concurrency và audit transaction trong đúng project scope.
5. Hoàn thiện UI state, integration/E2E authorization matrix, Docker Compose, CI và observability cho các slice đã có.
6. Chỉ sau core loop mới thêm reporting/export; Redis, worker/BullMQ và delivery chỉ xuất hiện khi phase bất đồng bộ cần chúng.
7. Sau khi hệ thống chạy ổn định: load/failure experiments, local Kubernetes và system design tổng kết.
