# ADR-0010: Sprint theo project như một phase tuỳ chọn (Phase 1.4)

- Status: Accepted
- Date: 2026-09-03
- Accepted: 2026-09-03
- Related docs: [ADR-0008](ADR-0008-terminal-column-and-task-reopen.md), [ADR-0002](ADR-0002-project-time-tracking-and-approval.md), [delivery roadmap](../product/delivery-roadmap.md), [vision and scope](../product/vision-and-scope.md), [database design](../data/database-design.md), [query and index policy](../data/query-and-index-policy.md), [authorization model](../security/authorization-model.md), [endpoint contracts](../api/endpoint-contracts.md)

## Context

Yêu cầu sản phẩm: thêm sprint, và "tạo task thì phải có sprint". Sprint là khái niệm chuẩn của thị trường — Jira gọi là Sprint, Linear gọi là Cycle, Azure DevOps gọi là Iteration — nên câu hỏi không phải "có nên tồn tại" mà là **thuộc phase nào và ràng buộc tới đâu**.

Ràng buộc hiện có phải giữ:

- Board là cột do Owner cấu hình; không có status hệ thống cho Task. Sprint **không được** trở thành một trục workflow thứ hai cạnh column.
- `product/vision-and-scope.md` mô tả MVP là một vòng lặp thực thi tối giản: không có bảng planning riêng, không recurring task. Sprint chính là **lớp planning** mà MVP cố ý chưa có.
- Phase 1.3 đã thiết lập pattern rõ: tính năng lớn bật/tắt **theo từng project** qua bảng settings 1:1, mặc định tắt, migration additive (`project_time_tracking_settings`). Sprint đi theo đúng pattern đó thay vì phát minh cách mới.
- Không phải team nào cũng chạy sprint: kanban dòng chảy liên tục là cách làm hợp lệ và phổ biến ở team nhỏ, đúng phân khúc của Flowboard.

Một điểm quan trọng về yêu cầu **"task phải có sprint"**: nếu `sprint_id` là bắt buộc thì mọi task phải thuộc một sprint, và backlog — nơi ý tưởng nằm chờ trước khi được lập kế hoạch — không còn biểu diễn được. Cả ba công cụ kể trên đều giữ backlog là trạng thái "chưa thuộc iteration nào". Bắt buộc sprint sẽ giết backlog, cùng loại lý do mà bên design đã dùng để bác việc bắt buộc assignee và due date.

## Decision

Sprint là **Phase 1.4**, bật/tắt theo từng project, **không thuộc core MVP**. Khi tắt, nó không đổi bất kỳ contract nào của core MVP.

1. **Bật theo project.** `project_sprint_settings(project_id PK/FK → projects(id), enabled boolean NOT NULL DEFAULT false, default_duration_days smallint NOT NULL DEFAULT 14 CHECK (default_duration_days BETWEEN 7 AND 28), version integer NOT NULL DEFAULT 1, created_at, updated_at)`. Chỉ Owner bật/tắt và đổi cấu hình. Khi tắt: không route, không CTA, không field sprint trong task projection.
2. **`sprints`**: `id` PK, `project_id` FK → `projects(id)`, `name text NOT NULL`, `goal text NULL`, `starts_on date NOT NULL`, `ends_on date NOT NULL`, `status text NOT NULL` với `CHECK (status IN ('planned', 'active', 'closed'))`, `closed_at timestamptz NULL`, `version integer NOT NULL DEFAULT 1`, timestamps. Constraints: `UNIQUE (project_id, id)` để task dùng composite FK; `UNIQUE (project_id, name)`; CHECK `starts_on <= ends_on`.
3. **Đúng một sprint `active` mỗi project, cưỡng chế tại database** bằng `CREATE UNIQUE INDEX ... ON sprints (project_id) WHERE status = 'active'`. Đây là điểm khác biệt có ý nghĩa so với Phase 1.3: invariant "tổng ≤ 1.440 phút/ngày" là một **aggregate** nên buộc phải advisory lock, còn "đúng một active" là một **uniqueness** nên database cưỡng chế được atomically, không cần lock thủ công. Chọn đúng công cụ cho đúng loại invariant.
4. **`tasks.sprint_id uuid NULL`** với composite FK `(project_id, sprint_id) → sprints(project_id, id)` — cùng pattern same-project đã dùng cho column/assignee/reviewer, nên database chặn gán task sang sprint của project khác. **`sprint_id NULL` nghĩa là backlog** và luôn hợp lệ: sprint không bao giờ bắt buộc. Gán/bỏ gán sprint đi qua task update allowlist hiện có (`task:update`, `expectedVersion`, `Idempotency-Key`, activity `task.updated`); phase này **không** có bulk endpoint mới — UI planning gửi N request và hiển thị kết quả từng dòng như bulk review Phase 1.3 đã làm.
5. **Vòng đời một chiều** `planned → active → closed`. `POST /sprints/:sprintId/activate` và `POST /sprints/:sprintId/close` đều cần `sprint:manage`, CSRF, `Idempotency-Key` và `expectedVersion`. Sprint đã `closed` là **bất biến**: không mở lại, không gán thêm task; muốn tiếp tục thì tạo sprint mới. Không auto-activate theo ngày và không timer nền — cùng lý do Phase 1.3 không có timer.
6. **Đóng sprint xử lý task chưa hoàn thành theo lựa chọn tường minh của Owner**: body `{ "unfinishedTasks": "backlog" | "move_to_sprint", "targetSprintId"?, "expectedVersion" }`. "Chưa hoàn thành" nghĩa là task đang ở column có `is_terminal = false`, nên **định nghĩa này phụ thuộc [ADR-0008](ADR-0008-terminal-column-and-task-reopen.md)**; nếu ADR-0008 bị bác thì ADR này phải định nghĩa lại "unfinished" trước khi được duyệt. Không có carry-over ngầm: hành vi phải do Owner chọn trong chính request.
7. **Permission:** thêm `sprint:read` (Owner/Editor/Viewer Allow) và `sprint:manage` (Owner Allow, Editor/Viewer Deny) vào catalog cho Phase 1.4, đúng cách `board-column:read`/`board-column:manage` đang làm. Viewer vẫn read-only; Workspace Admin chưa là ProjectMember vẫn ngoài mọi route.
8. **Query:** thêm `sprintId` vào filter allowlist của task list, nhận UUID cùng project hoặc token `backlog` cho `sprint_id IS NULL`. Cursor fingerprint **bắt buộc bind `sprintId`** theo quy tắc hiện hành, nên đổi sprint reset cursor. Index: `tasks(project_id, sprint_id, column_id, position)` cho sprint board seek theo từng cột, và `sprints(project_id, status, starts_on DESC)` cho danh sách sprint.
9. **Không đưa vào phase này:** story point/estimation (không có field estimate nào tồn tại; `priority` không phải estimate), velocity/burndown chart, capacity planning, sprint xuyên project, sprint-scoped permission, auto-rollover và bảng planning riêng. Sprint **không** suy ra `start_date`/`due_date` của task và **không** đổi `dueState`. Time Tracking Phase 1.3 vẫn tính theo ngày, báo cáo theo tháng; không có aggregate theo sprint ở phase này.
10. **Activity:** `sprint.created`, `sprint.updated`, `sprint.activated`, `sprint.closed`. Gán task vào sprint dùng `task.updated` đã có.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Phase 1.4, bật theo project, `sprint_id` nullable (chọn) | Core MVP không đổi khi tắt; đúng pattern Phase 1.3; backlog vẫn tồn tại; database cưỡng chế một active sprint. | Thêm hai bảng và một cột; cần thêm màn planning; Owner quản thêm cấu hình. |
| `sprint_id NOT NULL`, mọi task phải có sprint (đúng yêu cầu ban đầu) | Không có task "lơ lửng"; báo cáo theo sprint luôn đầy đủ. | Xoá bỏ backlog; buộc tạo sprint rác để chứa ý tưởng; mọi task hiện có phải backfill khi migrate; trái cách Jira/Linear/Azure DevOps đều làm. |
| Sprint vào core MVP | Người dùng có ngay lớp planning. | Vòng lặp thực thi cốt lõi còn chưa được kiểm chứng bằng code; kéo lớp planning vào phá nguyên tắc "chỉ thêm khi hành vi sản phẩm cần" của roadmap. |
| Sprint bật toàn hệ thống, không theo project | Ít cấu hình hơn. | Team kanban bị buộc dùng sprint; phá pattern per-project đã thiết lập. |
| Dùng BoardColumn tên "Sprint N" thay cho entity | Không cần schema mới. | Trộn hai trục khác nhau (giai đoạn công việc và khoảng thời gian) vào một; board nở theo số sprint và mất ý nghĩa. |

## Consequences

- Khi được duyệt, các thay đổi phải đi cùng nhau: `product/delivery-roadmap.md` (Phase 1.4 vào chuỗi phase), `product/vision-and-scope.md` (sprint ra khỏi vùng "không có bảng planning riêng"), `data/database-design.md` (hai bảng, một cột, vị trí trong migration order sau `projects`), `data/query-and-index-policy.md` (filter, fingerprint, index, transaction boundary), `security/authorization-model.md` (hai permission), `api/endpoint-contracts.md` (routes và projection), `design/screen-inventory.md` cùng Pencil (Sprint Board, Backlog, Sprint Settings, dialog đóng sprint).
- Test bắt buộc: activate sprint thứ hai khi đã có một active bị database từ chối kể cả với hai request đồng thời; gán task sang sprint của project khác bị composite FK chặn; đóng sprint với `unfinishedTasks: "backlog"` chuyển đúng tập task non-terminal và ghi đúng activity; sprint `closed` từ chối mọi gán thêm; đổi filter `sprintId` reset cursor.
- Failure experiment (lab): gửi đồng thời hai request activate hai sprint khác nhau của cùng project — đúng một thành công, request còn lại nhận unique violation được map về error envelope an toàn. Đặt cạnh thí nghiệm 1.440 phút của Phase 1.3 để thấy rõ khác biệt giữa uniqueness constraint và advisory lock.
- Khi tắt: không đổi contract core MVP, board, `dueState`, Time Tracking hay reporting.

## Revisit When

- Có nhu cầu estimate/velocity thật: ADR riêng cho field estimation trước, chart sau.
- Planning cần gán hàng loạt task vào sprint trong một request: bulk endpoint có kết quả từng dòng.
- Có yêu cầu báo cáo giờ theo sprint: giao với Phase 1.3, cần quyết định aggregate mới.
- Team cần nhiều sprint song song: partial unique index không còn đúng và invariant phải xem lại.
