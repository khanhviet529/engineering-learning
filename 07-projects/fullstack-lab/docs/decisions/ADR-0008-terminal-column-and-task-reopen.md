# ADR-0008: Terminal board column và ngữ nghĩa mở lại task

- Status: Proposed
- Date: 2026-09-03
- Related docs: [ADR-0001](ADR-0001-task-planning-fields-and-review-workflow.md), [database design](../data/database-design.md), [query and index policy](../data/query-and-index-policy.md), [endpoint contracts](../api/endpoint-contracts.md), [design system](../design/design-system.md), [interaction specifications](../design/interaction-specifications.md)

## Context

Năm tài liệu đang sống dựa vào khái niệm **terminal column** để suy ra `dueState`:

- `data/database-design.md`: "Server suy ra `none`, `scheduled`, `due_soon`, `due_today`, `overdue` từ workspace-local date, `due_date` và terminal state; task terminal không bao giờ overdue."
- [ADR-0001](ADR-0001-task-planning-fields-and-review-workflow.md) (**Accepted**): "...derives ... from the workspace-local current date, dates, and whether the task is in a terminal column. A terminal task is never overdue."
- `design/design-system.md`, `design/interaction-specifications.md`: "task terminal không render overdue".

Nhưng `board_columns` **không có cột nào biểu diễn terminal** — grep `is_terminal`/`isTerminal` trên toàn bộ tài liệu đang sống trả về **0 kết quả**. Nghĩa là một ADR đã Accepted và bốn contract khác đang phụ thuộc vào một thuộc tính mà schema không có: server không thể implement `dueState` đúng như đặc tả. Đây là incoherence, không phải thiếu tính năng.

Hai hệ quả kéo theo:

1. Đợt design 03/09 render pill `success (hoàn thành)` trong `FbDueState`, nhưng `dueState` chỉ có `none|scheduled|due_soon|due_today|overdue` — thiết kế đã tự sinh một giá trị API không tồn tại (đồng thời `dueState` là **filter value** trong allowlist, nên thêm giá trị không phải chuyện thẩm mỹ).
2. Yêu cầu sản phẩm "thêm trạng thái re-open" không có chỗ đặt: Flowboard cố ý **không có status toàn hệ thống** cho Task — Owner cấu hình BoardColumn, và bản `requirements.md` cũ nói "ba trạng thái mặc định" đã bị archive vì mâu thuẫn chính điều này. Nếu thêm `tasks.status` thì mâu thuẫn đó sống lại.

## Decision

1. **`board_columns.is_terminal boolean NOT NULL DEFAULT false`.** Owner cấu hình qua chính hợp đồng column hiện có: `POST /projects/:projectId/columns` nhận thêm `isTerminal` (optional, default `false`); `PATCH /columns/:columnId` nhận thêm **một explicit command thứ ba** `{ "isTerminal": boolean }` bên cạnh `{ "name" }` và `{ "archive": true }` (vẫn đúng một command mỗi request). Column projection trả `isTerminal`.
2. **Cho phép 0..n terminal column mỗi project.** Một project có thể có cả `Xong` và `Huỷ` là terminal; project không có terminal column nào là hợp lệ và khi đó `dueState` không bị suppress. Không giới hạn thành đúng một, và **không** tự động đánh dấu column cuối cùng là terminal khi migrate.
3. **`dueState` của task trong terminal column là `none`**, bất kể `start_date`/`due_date`. Enum `dueState` **không đổi**, filter allowlist **không đổi**, index **không đổi**. `none` mang nghĩa "không có tín hiệu due-state" (bao trùm cả không có ngày và đã terminal), đúng như câu đã có "terminal không bao giờ overdue".
4. **Affordance "hoàn thành" của UI lấy từ `column.isTerminal`, không phải từ `dueState`.** `FbDueState` giữ đúng năm giá trị server-derived; pill hoàn thành là biểu diễn của column, không phải một due state.
5. **Mở lại (re-open) là một `task:move`**, không phải trạng thái mới, không phải endpoint mới, không phải permission mới. Khi source column có `is_terminal = true` và destination column có `is_terminal = false`, transaction move ghi **đúng một** activity với action **`task.reopened`** thay cho `task.moved` — giữ nguyên invariant "một activity cho một move commit". Mọi validation khác của move không đổi: nếu destination có `requires_reviewer = true` thì vẫn bắt buộc reviewer hợp lệ; `expectedVersion` và `Idempotency-Key` không đổi.
6. **Không thêm `task.completed`.** Việc vào terminal column đã quan sát được qua `task.moved` + destination. Chỉ chiều đi ra khỏi terminal được đặt tên riêng vì đó là tín hiệu rework mà báo cáo/activity feed cần phân biệt ("Mở lại"), và nó bất đối xứng về ý nghĩa. Không thêm reason/comment bắt buộc khi mở lại — không tự phát minh field.
7. **Migration additive**, `DEFAULT false`, không backfill suy đoán. Không có index mới: `is_terminal` luôn được đọc cùng column của project đã scope (bảng column mỗi project rất nhỏ).

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| `is_terminal` trên board_columns + reopen là move (chọn) | Đóng đúng gap mà ADR-0001 đang treo; giữ nguyên nguyên tắc "Owner cấu hình workflow"; không đổi enum/filter/index; reopen có tên event greppable để đo rework. | Thêm một cột và một explicit command cho PATCH column; UI phải phân biệt nguồn của pill hoàn thành. |
| `tasks.status` enum toàn hệ thống (`open/in_progress/done/reopened`) | Quen với người dùng Jira; truy vấn trạng thái trực tiếp. | Mâu thuẫn trực tiếp với BoardColumn do Owner cấu hình — chính là bản `requirements.md` đã bị archive ở Batch 1; tạo hai nguồn sự thật cho "task đang ở đâu". |
| Suy ra terminal = column có `position` lớn nhất | Không cần schema change. | Ngầm và sai khi Owner reorder; `Huỷ` đứng cuối sẽ suppress overdue sai; không biểu diễn được nhiều terminal column. |
| Thêm `completed` vào enum `dueState` | Đúng cái design đang vẽ. | `dueState` là filter allowlist + có index + có OpenAPI `oneOf` + client branch theo giá trị; đổi enum cho một nhu cầu trình bày là chi phí sai chỗ. |
| Reopen là endpoint riêng `POST /tasks/:id/reopen` | Ngữ nghĩa rõ ràng nhất. | Trùng lặp toàn bộ validation của move (destination, reviewer, position, version, rebalance) ở một use case thứ hai; hai đường ghi cùng một loại thay đổi. |

## Consequences

- Thay đổi contract cần đi cùng nhau: `data/database-design.md` (`board_columns` + dueState invariant), `api/endpoint-contracts.md` (create/PATCH column, column projection `isTerminal`), `data/query-and-index-policy.md` (bảng transaction: move ghi `task.reopened` khi rời terminal), activity action allowlist, `design/design-system.md` + `design/interaction-specifications.md` (nguồn của pill hoàn thành), `BRD-02 Column Editor` (toggle `isTerminal`), activity feed (nhãn "Mở lại").
- Test bắt buộc: task trong terminal column có `dueState = none` dù `due_date` đã quá hạn; move ra khỏi terminal ghi đúng một `task.reopened` (không kèm `task.moved`); mở lại vào column `requires_reviewer` mà thiếu reviewer bị reject trước commit; project có hai terminal column hoạt động đúng; project không có terminal column không bị suppress.
- Failure experiment (lab): đặt `due_date` quá hạn cho một task rồi move vào terminal column — `dueState` chuyển `none` và biến mất khỏi filter `overdue`; move ngược ra, task xuất hiện lại là `overdue` và activity có đúng một `task.reopened`.
- **Quyết định này là điều kiện tiên quyết của [ADR-0010](ADR-0010-sprint-iteration.md)**: "task chưa hoàn thành" khi đóng sprint được định nghĩa bằng `is_terminal = false`. Nếu ADR-0008 bị bác, ADR-0010 phải định nghĩa lại "unfinished" bằng cách khác.
- Không đổi: permission catalog, error code, cursor/fingerprint, idempotency, rebalance, quyền Viewer.

## Revisit When

- Sản phẩm cần thêm ngữ nghĩa hệ thống cho column ngoài terminal (ví dụ "đang review" có ý nghĩa với báo cáo, hoặc WIP limit theo column).
- Báo cáo cần cả hai chiều vào/ra terminal (khi đó bổ sung `task.completed` bằng ADR mới thay vì sửa ADR này).
- Có yêu cầu bắt buộc lý do khi mở lại task (một field mới trên move — cần quyết định product riêng).
