# ADR-0005: Bản đồ phụ thuộc module và vị trí của Activity

- Status: Accepted
- Date: 2026-09-02
- Related docs: [repository structure](../engineering/repository-structure.md) (mục Quy tắc quyết định kiến trúc), [backend conventions](../engineering/backend-conventions.md), [query and index policy](../data/query-and-index-policy.md) (transaction boundaries), [authorization model](../security/authorization-model.md)

## Context

Modular monolith đã được chốt (quy tắc quyết định kiến trúc ở repository structure). `repository-structure.md` có bản đồ phụ thuộc ở mức **package** (`apps/web → packages/contracts`…), nhưng chưa có bản đồ phụ thuộc giữa các module trong `apps/api` (`auth`, `workspaces`, `projects`, `board-columns`, `tasks`, `comments`, `activity`, sau này `reports`). Trong khi đó có ít nhất bốn phụ thuộc cross-module thật, suy ra từ transaction contract:

1. Mọi module mutation ghi ActivityLog **trong cùng transaction** (query-and-index-policy, bảng transaction).
2. `tasks` validate assignee/reviewer là ProjectMember và target workspace member (dữ liệu của `projects`).
3. `comments` resolve project qua parent task (dữ liệu của `tasks`).
4. Ít được thấy nhất: `tasks` cần biết destination column **active** (dữ liệu của `board-columns`), đồng thời `board-columns` archive cần biết column **không còn task** (dữ liệu của `tasks`) — nếu để hai module import nhau trực tiếp thì đây là **circular dependency**.

Câu hỏi trung tâm: Activity là một module hay một shared transaction concern? Nếu là module bình thường, năm module khác import nó và quy tắc "module không đọc bảng của nhau" cần cơ chế; nếu là shared helper thuần thì sai bản chất — `activity_logs` có `project_id` FK, có read endpoint sản phẩm (`GET /tasks/:taskId/activity`) và phải nằm trong transaction của mutation.

## Decision

**Activity là một module, giao tiếp qua một port ghi hẹp** — phương án thứ ba so với "module thuần" và "shared concern thuần":

- Module `activity` **sở hữu** bảng `activity_logs`, các read use case (project/task history) và schema/allowlist chung của một event record.
- Nó export đúng một application port ghi: `ActivityRecorder.record(tx, event)` — nhận transaction handle của mutation đang chạy và một event đã allowlist. Không module nào INSERT `activity_logs` trực tiếp; không có mutation endpoint công khai cho activity (đúng transaction contract hiện có).
- **Tên event và payload allowlist vẫn thuộc module mutation** (đúng backend conventions: "activity event ở module sở hữu"); recorder chỉ validate shape chung + sanitize + persist.
- `activity` không import module nào khác ⇒ nó là leaf của đồ thị, không thể tạo cycle.

**Bản đồ phụ thuộc module trong `apps/api`** (mũi tên = "được phép import port của"; mọi phụ thuộc chỉ ở mức application port, không import Drizzle table của nhau):

```text
comments ──► tasks ──► board-columns
   │           │  └──► projects ──► workspaces
   │           │             │
   ▼           ▼             ▼
activity ◄── (mọi module mutation: projects, board-columns, tasks, comments, reports)

auth: không phụ thuộc module sản phẩm nào; actor đi qua shared/authorization.
reports (Phase 1.1): ──► projects, tasks (read port), activity.
```

- `tasks → projects`: port `getProjectMember(projectId, userId)` cho assignee/reviewer validation (composite FK vẫn là lớp bảo vệ cuối tại database).
- `tasks → board-columns`: port đọc destination column (`active`, cùng project).
- `projects → workspaces`: port `isWorkspaceMember(workspaceId, userId)` khi thêm project member.
- `comments → tasks`: port resolve task → project và read scope.
- **Phá cycle tasks ↔ board-columns bằng dependency inversion**: use case archive của `board-columns` cần "column không còn task", nhưng `board-columns` KHÔNG import `tasks`. Thay vào đó `board-columns` **định nghĩa** port `ColumnEmptinessCheck` trong domain của nó; module `tasks` cung cấp adapter implement port này; composition root (Nest wiring) nối hai bên. Chiều import ở source code chỉ còn `tasks → board-columns` (tasks import interface để implement) — đồ thị acyclic.
- **Ngoại lệ được ghi nhận**: `shared/authorization` (kernel, không phải module) đọc read-only membership/role từ `workspace_members`/`project_members` để đánh giá policy. Đây là ngoại lệ có chủ đích của quy tắc "không đọc bảng của nhau": kernel không được phép phụ thuộc ngược vào module sản phẩm, và nó chỉ đọc. Mutation membership vẫn thuộc duy nhất `projects`/`workspaces`.

Deployment vẫn là một monolith; tách deployment chỉ khi có số liệu và ADR mới (giữ nguyên quy tắc quyết định kiến trúc).

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Activity là module + recorder port, DI phá cycle (chọn) | Ownership bảng/read use case rõ; atomicity giữ nguyên (recorder nhận tx handle); đồ thị acyclic kiểm tra được bằng lint. | Cần kỷ luật wiring ở composition root; thêm một interface cho mỗi cross-module need. |
| Activity là module thường, các module import repository của nhau | Ít interface hơn. | Vi phạm "module không đọc bảng của nhau"; cycle tasks ↔ board-columns không giải được; đồ thị thoái hóa thành big ball of mud. |
| Activity là shared concern trong `shared/` | Mọi module dùng tự do như transaction helper. | Sai bản chất: `activity_logs` là domain data có project scope + read endpoint sản phẩm; đưa vào shared/ vi phạm chính controlled-generic-core policy (shared không mang product decision). |
| Domain events + async listener ghi activity | Decoupling tối đa. | Phá vỡ invariant cứng "activity cùng transaction với mutation" — append-only audit trở thành best-effort; bị transaction contract cấm tường minh. |

## Consequences

- `backend-conventions.md` bổ sung bản đồ phụ thuộc module này (cùng commit với ADR); mọi import cross-module ngoài bản đồ là vi phạm review.
- Composition root chịu trách nhiệm nối `ColumnEmptinessCheck` (tasks adapter → board-columns port) và `ActivityRecorder`.
- Test: mỗi port cross-module có contract test riêng; integration test activity-atomicity giữ nguyên (mutation fail ⇒ không activity row).
- Không đổi schema, endpoint hay permission nào; đây là ranh giới code, không phải contract API.

## Revisit When

- Một phụ thuộc mới không đặt vừa đồ thị acyclic (dấu hiệu ranh giới module sai — mở ADR trước khi thêm `forwardRef`).
- Phase AI/reporting thêm module mới cần hơn read port (ví dụ orchestration hai chiều).
- Có số liệu (deploy độc lập, scaling, team split) biện minh tách service — khi đó bản đồ này là input cho ranh giới tách.
