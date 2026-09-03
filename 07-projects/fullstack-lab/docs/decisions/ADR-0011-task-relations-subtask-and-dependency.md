# ADR-0011: Quan hệ giữa Task — subtask một cấp và phụ thuộc blocking (Phase 1.5)

- Status: Accepted
- Date: 2026-09-03
- Accepted: 2026-09-03
- Related docs: [ADR-0001](ADR-0001-task-planning-fields-and-review-workflow.md), [ADR-0008](ADR-0008-terminal-column-and-task-reopen.md), [ADR-0010](ADR-0010-sprint-iteration.md), [database design](../data/database-design.md), [query and index policy](../data/query-and-index-policy.md), [authorization model](../security/authorization-model.md), [endpoint contracts](../api/endpoint-contracts.md), [vision and scope](../product/vision-and-scope.md)

## Context

Yêu cầu sản phẩm: task cần quan hệ **cha–con** và quan hệ **phụ thuộc**. Đúng như nhận định, đây là tính năng chuẩn: Jira có subtask và link `blocks`/`is blocked by`, Linear có sub-issue và blocking relation, Azure DevOps có predecessor/successor.

Ràng buộc phải đối diện: cả hai đang bị **loại tường minh** khỏi MVP ở ba nơi — `product/vision-and-scope.md` ("labels, checklists, task dependencies, recurring tasks và templates" là non-goal), baseline đã phê duyệt §3.2 ("The MVP does not include ... task dependencies ..."), và [ADR-0001](ADR-0001-task-planning-fields-and-review-workflow.md) **Accepted** ("Attachments, subtasks, dependencies, custom labels, custom fields, recurrence, and notifications remain outside MVP").

Cách đọc đúng: cả ba đều nói **outside MVP**, không nói "không bao giờ"; baseline §3.3 có sẵn cơ chế "planned phases after core". Vì vậy thêm chúng như một **phase sau** là đúng cơ chế đã được phê duyệt và **không** cần supersede ADR-0001 — chỉ cần sửa danh sách non-goal khi ADR này được duyệt.

Hai quan hệ này có độ phức tạp rất khác nhau và không nên bị coi là một: cha–con là một cạnh cây có thể chặn cycle bằng cấu trúc, còn phụ thuộc là một **đồ thị** cần chống cycle lúc chạy dưới điều kiện đồng thời.

## Decision

Cả hai thuộc **Phase 1.5**, sau Phase 1.4. Không thuộc core MVP. Chúng độc lập với Time Tracking và Sprint.

### 1. Subtask: `tasks.parent_task_id uuid NULL`, sâu đúng một cấp

- Composite FK `(project_id, parent_task_id) → tasks(project_id, id)` — database chặn cha khác project. CHECK `parent_task_id IS NULL OR parent_task_id <> id` chặn tự tham chiếu.
- **Sâu tối đa một cấp**: một task đã có cha thì **không được** làm cha của task khác. Quy tắc này làm đồ thị cha–con **cycle-free theo cấu trúc**, nên không cần recursive check nào khi gán cha. Nó là use-case invariant (FK không diễn đạt được) và phải có test riêng.
- **Subtask là một Task đầy đủ**: có column, `position`, `version`, assignee, comment, activity, WorkLog như mọi task. Không tạo bảng checklist item — nếu subtask không gán được người và không di chuyển được trên board thì nó không giải quyết vấn đề mà yêu cầu này nhắm tới.
- `parentTaskId` được thêm vào task create/update allowlist (`task:update`, `expectedVersion`, activity `task.updated`) và vào filter allowlist của task list để `TSK-02` liệt kê con của một task; cursor fingerprint bind `parentTaskId`. Index `tasks(project_id, parent_task_id)`.
- **Tiến độ cha là giá trị dẫn xuất**, đếm số con đang ở column `is_terminal = true` — phụ thuộc [ADR-0008](ADR-0008-terminal-column-and-task-reopen.md). Không có cột `progress`, không có trigger cập nhật cha.
- Cha vào terminal column khi còn con chưa xong: **chỉ cảnh báo ở UI, server không chặn** (xem lý do ở mục 2). Move một task không kéo theo con của nó.

### 2. Phụ thuộc: bảng `task_dependencies`, chống cycle bằng advisory lock

- `task_dependencies(id PK, project_id FK → projects(id), blocking_task_id, blocked_task_id, created_by_user_id FK → users(id), created_at)`. Composite FK cho **cả hai** phía: `(project_id, blocking_task_id) → tasks(project_id, id)` và `(project_id, blocked_task_id) → tasks(project_id, id)` — nên **phụ thuộc xuyên project là bất khả thi ở tầng database**, không chỉ ở tầng use case. `UNIQUE (project_id, blocking_task_id, blocked_task_id)`; CHECK `blocking_task_id <> blocked_task_id`.
- Chỉ **một loại quan hệ**: blocking. Không có `relates_to`, `duplicates`, `causes` — mỗi loại thêm vào là một ngữ nghĩa mới phải định nghĩa và render.
- **Chống cycle:** transaction insert lấy PostgreSQL advisory transaction lock theo `(project_id)`, chạy recursive CTE kiểm tra khả năng tới được từ `blocked_task_id` về `blocking_task_id`, rồi mới ghi. Cycle bị từ chối bằng `409 TASK_DEPENDENCY_CYCLE`. Đây đúng là trường hợp cần advisory lock: khả năng tới được trong đồ thị là một **aggregate**, không phải uniqueness, nên không constraint nào của database làm thay được — ngược lại với "một active sprint" ở [ADR-0010](ADR-0010-sprint-iteration.md), nơi partial unique index là đủ. Hai thí nghiệm cạnh nhau là bài học chọn công cụ theo loại invariant.
- **Giới hạn có biên:** tối đa 50 cạnh mỗi chiều cho một task (`blocks` và `blocked_by` tính riêng), để recursive walk luôn có biên. Vượt giới hạn trả `400 VALIDATION_FAILED` như mọi invariant biểu diễn được ở input.
- **Không cưỡng chế khi move:** server **không** chặn việc move một task đang bị block sang terminal column. Cưỡng chế cứng buộc phải có đường vượt quyền (ai được bỏ qua, ghi audit thế nào) — thêm một bề mặt policy cho một quy tắc mà Jira và Linear đều để ở mức thông tin. UI hiển thị cảnh báo; `task:move` giữ nguyên contract.
- **Permission dùng lại `task:update`**, không thêm entry catalog: thay đổi quan hệ là thay đổi nội dung task, không có nhu cầu policy riêng. (`task:assign` tồn tại riêng vì assignment có policy riêng; ở đây không có.)
- **Xoá phụ thuộc là xoá row thật** qua `DELETE /task-dependencies/:dependencyId`. Đây là **hard delete đầu tiên** của schema và là ngoại lệ có chủ đích: row này là một cạnh join thuần, không mang nội dung người dùng, và lịch sử của nó nằm ở ActivityLog (`task_dependency.added`, `task_dependency.removed`) — đúng nguyên tắc "Activity Log là nguồn lịch sử". Soft delete sẽ buộc mọi query phải filter thêm mà không đổi được gì.
- Projection của task detail trả hai danh sách **có biên** `blocks` và `blockedBy`, mỗi phần tử gồm `id`, `title`, `columnId` và cờ terminal của column đó; vì đã chặn ở 50 nên không cần cursor.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Subtask một cấp + dependency blocking, Phase 1.5 (chọn) | Cycle cha–con bị loại theo cấu trúc; đồ thị phụ thuộc có chống cycle đúng chỗ; core MVP không đổi. | Người dùng quen cây nhiều tầng sẽ thấy giới hạn; cần một bảng và một cột. |
| Cây cha–con sâu tuỳ ý | Mô hình hoá được epic → story → subtask. | Cần chống cycle lúc chạy cho cả cha–con; rollup tiến độ mơ hồ nhiều tầng; UI board không biểu diễn được cây sâu. Nếu cần epic, đó là entity riêng (như Sprint), không phải đệ quy vô hạn. |
| Subtask là checklist item ở bảng riêng | Rẻ, không đụng board. | Không gán được người, không di chuyển được, không comment, không ghi giờ — không giải quyết nhu cầu. |
| Chống cycle bằng CHECK/trigger trong database | Không cần lock ở use case. | Reachability cần đọc nhiều row; trigger đệ quy khó review và khó test, trái nguyên tắc "invariant cross-row là use-case transaction rule, không phải trigger magic" đã có trong database design. |
| Chặn cứng move khi còn blocker | Kỷ luật mạnh. | Buộc thiết kế đường vượt quyền và audit của nó; deadlock UX khi blocker nằm ngoài quyền của actor; cả Jira và Linear để mức thông tin. |
| Thêm cả `relates_to`, `duplicates` | Đủ loại quan hệ. | Mỗi loại là ngữ nghĩa và UI mới; blocking là loại duy nhất có hành vi (cảnh báo) chứ không chỉ là ghi chú. |

## Consequences

- Khi được duyệt, phải sửa cùng lượt: `product/vision-and-scope.md` (đưa dependencies/subtasks khỏi danh sách non-goal, ghi rõ chúng thuộc Phase 1.5). Baseline `2026-09-01` **không** được sửa: nó là snapshot có ngày, và theo `decisions/README.md` thì ADR ghi quyết định mới hơn chứ không viết lại baseline đã phê duyệt; `product/delivery-roadmap.md` (Phase 1.5), `data/database-design.md` (một cột, một bảng, migration order sau `tasks`), `data/query-and-index-policy.md` (filter/fingerprint/index/transaction/advisory-lock key mới), `api/endpoint-contracts.md` (routes, allowlist, projection, error code mới), `api/api-conventions.md` (`TASK_DEPENDENCY_CYCLE` vào danh sách outcome `409`), `design/screen-inventory.md` cùng Pencil (mục subtask và mục phụ thuộc ở `TSK-02`, cảnh báo blocker).
- ADR-0001 **không bị supersede**: nó nói subtasks/dependencies "remain outside MVP", và ADR này giữ đúng điều đó bằng cách đặt chúng ở Phase 1.5.
- Test bắt buộc: gán cha cho một task đã có cha bị từ chối (giới hạn một cấp); tạo cạnh A→B rồi B→A nhận `409 TASK_DEPENDENCY_CYCLE`; **hai request đồng thời** tạo hai cạnh cùng đóng một chu trình chỉ một cái thành công (advisory lock); cạnh xuyên project bị composite FK chặn; cạnh thứ 51 bị `400`; xoá cạnh ghi `task_dependency.removed` và không xoá activity cũ.
- Failure experiment (lab): dựng chuỗi A→B→C→…→N rồi gửi đồng thời hai request tạo cạnh N→A và N→A từ hai client — đúng một cái vào được vòng kiểm tra, cả hai không thể cùng tạo cycle; đo chi phí recursive CTE ở N = 50 để chứng minh giới hạn 50 là đủ chặt.
- Không đổi: quyền Viewer, `dueState`, rebalance/ordering, idempotency, Time Tracking, reporting.

## Revisit When

- Có nhu cầu epic nhiều tầng thật: entity `epic` riêng thay vì nới độ sâu cha–con.
- Có nhu cầu chặn cứng move theo blocker: cần thiết kế đường vượt quyền và audit trước.
- Có nhu cầu loại quan hệ ngoài blocking, hoặc phụ thuộc xuyên project (khi đó phải xem lại toàn bộ ranh giới private-project, không chỉ bảng này).
- Có nhu cầu critical path/Gantt: thuộc phase reporting và cần quyết định aggregate riêng.
