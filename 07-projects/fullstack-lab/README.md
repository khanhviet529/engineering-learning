# Flowboard — fullstack lab

Flowboard là workspace quản lý công việc **riêng tư theo project** cho nhóm nhỏ: đăng nhập → chọn không gian làm việc → mở project được cấp quyền → cấu hình cột board → tạo/giao/di chuyển task → comment và xem lịch sử thay đổi. Mọi project đều private; quyền là cố định theo ba vai trò project (Owner, Editor, Viewer) và không ai có quyền ngầm định.

Đây đồng thời là **lab** của repository này: mỗi tính năng được xây như sản phẩm thật, rồi dùng chính nó để quan sát behavior từ browser xuống database — lost update, transaction, ordering, phân quyền, concurrency, idempotency, queue.

## Trạng thái hiện tại (04/09/2026)

| Giai đoạn | Trạng thái |
|---|---|
| Hợp đồng Markdown | **Đã chốt** — baseline v0.1, 11 ADR đã Accepted |
| Thiết kế Pencil | **Freeze v0.1** ngày 04/09/2026, blob `12d6ff91`; checklist 34/34 |
| Code ứng dụng | **Chưa có dòng nào.** Kế hoạch triển khai đã có; cổng kế tiếp là mốc **M0 — bộ khung và đường nối hợp đồng** |

Nói rõ để không kỳ vọng sai: repository này hiện chỉ có **tài liệu và một file thiết kế**. Không có `apps/`, không có migration, không có server chạy được.

## Bắt đầu từ đâu

- **Chưa biết gì về dự án** → [bản đồ tài liệu](docs/README.md), rồi [tầm nhìn và phạm vi](docs/product/vision-and-scope.md).
- **Là engineer, muốn hiểu hệ thống chạy thế nào** → [ba lát cắt dọc](docs/how-it-works.md): sign in · move task · ghi và duyệt giờ, mỗi thao tác đi từ UX xuống schema. Sau đó theo đường stack-first trong bản đồ tài liệu.
- **Muốn biết vì sao chọn như vậy** → [hồ sơ quyết định](docs/decisions/README.md): opaque session thay JWT, Drizzle thay Prisma, fractional ordering, subtask một cấp, và các quyết định khó đảo ngược khác.
- **Muốn biết bài toán khó nằm ở đâu** → bảng "Bài toán khó và cách giải" trong [bản đồ tài liệu](docs/README.md).
- **Sắp bắt tay vào code** → [kế hoạch triển khai](docs/implementation-plan.md): làm theo thứ tự nào, mỗi mốc xong khi nào, và frontend với backend tách ở đâu.

Bản đồ tài liệu là danh sách điều hướng duy nhất; README này cố ý **không** nhân bản nó để hai chỗ không trôi khỏi nhau.

## Phạm vi miền đã chốt

Miền dữ liệu **đã được đặc tả xong**, không còn là gợi ý. Core MVP gồm `User`, `AuthSession`, `Workspace`, `WorkspaceMember`, `Project`, `ProjectMember`, `BoardColumn`, `Task`, `Comment`, `ActivityLog`, cộng bảng lưu outcome idempotency. Các phase sau thêm `ReportExport` (1.1), bốn bảng Time Tracking (1.3), Sprint (1.4) và quan hệ giữa Task (1.5).

Chi tiết thực thể, bất biến và ranh giới sở hữu nằm ở [mô hình miền](docs/data/domain-model.md); schema PostgreSQL đầy đủ ở [thiết kế database](docs/data/database-design.md).

## Kiến trúc và tiến hoá

Bắt đầu bằng modular monolith trên PostgreSQL:

```text
Browser
  ↓
Next.js
  ↓ HTTP
NestJS
  ↓
PostgreSQL
```

Chỉ thêm hạ tầng khi có hành vi sản phẩm thật sự cần nó — quy tắc này là contract, không phải sở thích (xem [quy tắc quyết định kiến trúc](docs/engineering/repository-structure.md)):

```text
Browser → Next.js → NestJS → PostgreSQL
                         ├→ Redis          (chỉ khi có cache/rate-limit cần quan sát)
                         └→ Worker/Queue   (chỉ từ Phase 1.2, khi delivery bất đồng bộ)

Dockerize → CI/CD → Observability → Kubernetes
```

## Thứ tự triển khai

1. Xác lập authentication, opaque session, CSRF và authorization project-scope **trước khi** có dữ liệu project.
2. Vertical slice workspace/project private: membership, capability server-computed, query scope và forbidden/not-found behavior.
3. Vertical slice board: Owner cấu hình cột; Owner/Editor/Viewer chỉ thấy và thao tác theo permission.
4. Vertical slice task/comment/activity: create, assign, move, optimistic concurrency và audit transaction trong đúng project scope.
5. Hoàn thiện UI state, integration/E2E authorization matrix, Docker Compose, CI và observability cho các slice đã có.
6. Chỉ sau core loop mới thêm reporting/export; Redis, worker/BullMQ và delivery chỉ xuất hiện khi phase bất đồng bộ cần chúng.
7. Sau khi hệ thống chạy ổn định: load/failure experiment, local Kubernetes và tổng kết system design.

Mỗi phase chỉ được coi là hoàn thành khi có đủ năm thứ: feature chạy được · test cho behavior chính · failure experiment tái hiện được · note giải thích nguyên nhân và trade-off · screenshot hoặc command output để người đọc tự kiểm chứng. Danh sách failure experiment theo từng phase nằm ở [lộ trình phát hành](docs/product/delivery-roadmap.md).

## Baseline đã phê duyệt

- [Flowboard Product & Architecture Design](docs/superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) — baseline gốc.
- [Flowboard Time Tracking Design — Phase 1.3](docs/superpowers/specs/2026-09-02-flowboard-time-tracking-design.md) — baseline bổ sung, kèm [kế hoạch triển khai](docs/superpowers/plans/2026-09-02-flowboard-time-tracking-documentation-and-design.md).

Hai file trên là **snapshot có ngày**: khi một quyết định cần đổi thì mở ADR mới chứ không sửa snapshot.
