# Tài liệu Flowboard

Tài liệu này là bản đồ điều hướng cho Flowboard. [Đặc tả baseline đã được phê duyệt](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) giữ các quyết định gốc; các tài liệu theo chủ đề sẽ diễn giải chúng thành hợp đồng có thể thực hiện. Thư mục `superpowers/` giữ các spec/plan đã phê duyệt — tên thư mục là tên bộ công cụ đã tạo ra chúng; spec là thẩm quyền gốc, plan là trình tự thực hiện tương ứng.

**Markdown baseline v0.1: Ready for Pencil.** Mốc này xác nhận tài liệu Markdown sẵn sàng cho công việc UI/UX trong Pencil, không phải xác nhận thiết kế UI hoặc ứng dụng đã hoàn thành.

## Đối chiếu với master specification

Số thứ tự ở cột đầu là số section trong [master specification](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) — snapshot đó viết bằng tiếng Anh và không được sửa, nên số giữ nguyên để tra cứu 1:1; phần chữ ở đây là tiếng Việt.

| Section trong master spec | Tài liệu chi tiết tương ứng |
|---|---|
| 1. Mục đích | [Tầm nhìn và phạm vi sản phẩm](product/vision-and-scope.md), [lộ trình phát hành](product/delivery-roadmap.md) |
| 2. Vấn đề và người dùng mục tiêu | [Chân dung người dùng và công việc của họ](product/personas-and-jobs.md), [hành trình người dùng](product/user-journeys.md) |
| 3. Phạm vi sản phẩm | [Tầm nhìn và phạm vi sản phẩm](product/vision-and-scope.md), [lộ trình phát hành](product/delivery-roadmap.md) |
| 4. Kiến trúc thông tin và quy tắc UX | [Kiến trúc thông tin](design/information-architecture.md), [luồng người dùng](design/user-flows.md), [danh mục màn hình](design/screen-inventory.md), [bàn giao Pencil](design/pencil-handoff.md) |
| 5. Mô hình phân quyền | [Xác thực](security/authentication.md), [mô hình phân quyền](security/authorization-model.md), [ma trận test phân quyền](security/authorization-test-matrix.md) |
| 6. Mô hình miền và dữ liệu | [Mô hình miền](data/domain-model.md), [thiết kế database](data/database-design.md), [chính sách query và index](data/query-and-index-policy.md) |
| 7. Thiết kế API | [Quy ước API](api/api-conventions.md), [hợp đồng endpoint](api/endpoint-contracts.md) |
| 8. Phân trang, thứ tự và concurrency | [Phân trang, concurrency và idempotency](api/pagination-concurrency-idempotency.md), [chính sách query và index](data/query-and-index-policy.md) |
| 9. Baseline kỹ thuật | [Cấu trúc repository](engineering/repository-structure.md), [quy ước frontend](engineering/frontend-conventions.md), [quy ước backend](engineering/backend-conventions.md), [chính sách shared helper](engineering/shared-helper-policy.md) |
| 10. Báo cáo và công việc bất đồng bộ | [Export tiến độ](reporting/progress-export.md), [lộ trình phát hành](product/delivery-roadmap.md) |
| 11. Test, phát hành và observability | [Chiến lược test](operations/testing-strategy.md), [phát triển cục bộ](operations/local-development.md), [CI/CD](operations/ci-cd.md), [observability](operations/observability.md) |
| 12. Thiết kế AI | [Lộ trình AI](ai/roadmap.md), [kiến trúc và an toàn AI](ai/architecture-and-safety.md) |
| 13. Sản phẩm tài liệu phải giao | Chính trang chỉ mục này, [kế hoạch thiết kế và tài liệu](design-and-docs-plan.md), [hướng dẫn người dùng](user-guide/README.md), [quy trình ADR](decisions/README.md), [ba lát cắt dọc](how-it-works.md) |
| 14. Tiêu chí nghiệm thu baseline | Chính trang chỉ mục này, [kế hoạch thiết kế và tài liệu](design-and-docs-plan.md), [baseline đã phê duyệt](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) |

### Baseline bổ sung

Các baseline sau được phê duyệt sau master specification 2026-09-01. Chúng không phải một section của spec cũ; mỗi baseline có spec và kế hoạch triển khai riêng, và các quyết định đã được diễn giải vào tài liệu chi tiết tương ứng.

| Baseline | Spec | Kế hoạch triển khai | Tài liệu chi tiết đã cập nhật |
|---|---|---|---|
| Phase 1.3 — Time Tracking (2026-09-02) | [Time Tracking design](superpowers/specs/2026-09-02-flowboard-time-tracking-design.md) | [Time Tracking documentation and design plan](superpowers/plans/2026-09-02-flowboard-time-tracking-documentation-and-design.md) | [ADR-0002](decisions/ADR-0002-project-time-tracking-and-approval.md), [lộ trình phát hành](product/delivery-roadmap.md), [thiết kế database](data/database-design.md), [chính sách query và index](data/query-and-index-policy.md), [mô hình phân quyền](security/authorization-model.md), [hợp đồng endpoint](api/endpoint-contracts.md), [phân trang, concurrency và idempotency](api/pagination-concurrency-idempotency.md), [bàn giao Pencil](design/pencil-handoff.md) |

## Ngôn ngữ tài liệu

Tài liệu này viết cho người đọc Việt, nên **văn xuôi dùng tiếng Việt**. Giữ nguyên tiếng Anh những thứ mà dịch ra sẽ làm mất khả năng đối chiếu với code:

- Định danh kỹ thuật: tên bảng/cột (`board_columns`, `due_date`), field API (`expectedVersion`, `sprintId`), error code (`TASK_VERSION_CONFLICT`), HTTP method và status, tên route.
- Tên công nghệ và thư viện: PostgreSQL, NestJS, Drizzle, Zod, Lucide, BullMQ.
- Tên primitive/component và permission: `SessionGuard`, `FbSidebar`, `task:move`, `report:export`.
- Thuật ngữ chuẩn ở bảng dưới khi nó là **tên chính thức** của khái niệm: Workspace Admin, Project Owner, Editor, Viewer, Board Column, Task, Activity Log.

Ba nhóm file **cố ý giữ nguyên tiếng Anh**, không dịch:

1. `superpowers/specs/*` và `superpowers/plans/*` — đây là **snapshot có ngày** của baseline và kế hoạch đã phê duyệt. Dịch chúng là viết lại lịch sử; khi nội dung cần đổi thì mở ADR mới chứ không sửa snapshot.
2. `decisions/ADR-0001` và `ADR-0002` — ADR đã `Accepted`; quy trình cấm sửa nội dung một quyết định đã chốt. ADR từ 0003 trở đi viết tiếng Việt.
3. Trích dẫn nguyên văn từ ba nhóm trên khi một tài liệu sống cần dẫn lại.

Khi một file trộn hai ngôn ngữ không theo quy tắc này, đó là nợ tài liệu cần dọn, không phải quy ước.

## Thuật ngữ chuẩn (Canonical terminology)

Những tên dưới đây là tên sản phẩm/chính sách chuẩn trong toàn bộ tài liệu. Tên database, DTO hoặc API để trong code font (ví dụ `board_columns`, `due_date`, `expectedVersion`, `requestId`) là định danh kỹ thuật, không phải tên thay thế cho khái niệm sản phẩm.

| Canonical term | Quy ước dùng |
|---|---|
| Workspace Admin; Workspace Member | Hai vai trò membership cố định của workspace. |
| Project Owner; Editor; Viewer | Ba vai trò cố định của project; `Owner` trong bảng/quy ước role là Project Owner. |
| Board Column; Task; Activity Log | Khái niệm sản phẩm; `board_columns`, `tasks`, `activity_logs` và `ActivityLog` là các định danh schema/code tương ứng. |
| `due_date` | Cột SQL DATE tùy chọn; API presentation dùng `dueDate`. |
| `expectedVersion` | Field API cho optimistic concurrency; persistence lưu version của Task. |
| `requestId` | Correlation ID cho HTTP request; không phải authorization claim, actor ID, hoặc metric label. |
| capabilities | Quyền do server tính cho resource; frontend chỉ dùng để diễn đạt affordance, không thay thế authorization. Có bản theo từng record trên projection của resource (Phase 1.3). |
| `dueState` | Enum do server suy ra: `none`, `scheduled`, `due_soon`, `due_today`, `overdue`. Nó vừa là giá trị hiển thị vừa là **filter value có index**; không phải palette trạng thái và không có giá trị thứ sáu. |
| Terminal column | Cột board được Owner đánh dấu là điểm kết thúc công việc (`board_columns.is_terminal`). Task ở cột terminal luôn có `dueState = none`. Một project có 0..n cột terminal. |
| Mở lại task (reopen) | Việc di chuyển task **ra khỏi** cột terminal. Nó là một `task:move` bình thường, ghi activity `task.reopened`; **không** phải một status mới của Task. |
| `Idempotency-Key` | Header do client sinh cho **một ý định của user**; outcome được lưu ở `idempotency_records`. Giữ nguyên key khi retry cùng payload vì lỗi vận chuyển, xoay key mới khi ý định đổi. |
| `position` | Thứ tự fractional `numeric(20,10)` do server sở hữu tuyệt đối; client không bao giờ gửi nó trong update. Rebalance là hành vi server, chỉ ghi `position`. |
| Evidence link | Một URL `https` duy nhất trên Task (`evidence_url`) làm bằng chứng công việc. Không phải attachment; server không bao giờ fetch nó. |
| WorkLog | Bản ghi giờ thực tế theo một user–task–ngày (Phase 1.3). Giờ **không** được suy ra từ `startDate`/`dueDate` của Task. |
| Time Approver | Editor được Owner chỉ định để duyệt WorkLog của người khác (`ProjectTimeApprover`). Owner là approver ngầm định; không ai tự duyệt log của chính mình. |
| Approval mode | Cách chốt giờ của một project: `self_close` (tác giả tự chốt) hoặc `requires_approval` (cần approver khác duyệt). |
| Backfill window | Số ngày lịch trước hôm nay mà member còn được ghi bù giờ (0–31, mặc định 7); mở rộng cá biệt bằng `WorkLogAccessOverride`. |
| Sprint; backlog | Chu kỳ lập kế hoạch theo project (Phase 1.4), vòng đời `planned → active → closed`, tối đa một sprint `active` mỗi project. **Backlog** là task chưa thuộc sprint nào (`sprint_id` rỗng) và luôn là trạng thái hợp lệ. |
| Subtask | Task có `parent_task_id`, sâu **đúng một cấp** (Phase 1.5): task đã có cha không được làm cha. Subtask là Task đầy đủ, không phải checklist item. |
| Dependency (blocking) | Cạnh `task_dependencies` giữa hai Task cùng project (Phase 1.5). Chỉ một loại quan hệ là blocking; đồ thị phải acyclic; task bị block **vẫn di chuyển được** — blocking là thông tin, không phải cưỡng chế. |

## Cách đọc dự án (How to read this project)

Bắt đầu ở [README cấp project](../README.md), rồi đọc theo thứ tự sau. Các đường dẫn không có phần mở rộng bên dưới tương ứng với tệp Markdown cùng tên trong `docs/`. Xem [kế hoạch thiết kế và tài liệu](design-and-docs-plan.md) để biết điều kiện chuyển từ Markdown sang Pencil.

```text
README
→ product/vision-and-scope
→ product/user-journeys
→ design/information-architecture
→ design/user-flows
→ design/screen-inventory
→ Pencil
→ data/domain-model
→ security/authorization-model
→ api/endpoint-contracts
→ engineering and operations
```

Đường trên đúng cho người **thiết kế sản phẩm** (product → UX → data). Một engineer mới nên đi đường stack-first để biết app viết bằng gì ngay từ đầu:

```text
README
→ engineering/repository-structure (stack + quy tắc quyết định kiến trúc)
→ decisions/README và ADR-0003..0006 (vì sao stack như vậy)
→ engineering/backend-conventions (module shape + bản đồ phụ thuộc)
→ data/database-design → data/query-and-index-policy
→ security/authorization-model
→ api/api-conventions → api/endpoint-contracts
→ how-it-works (ba lát cắt dọc nối các tầng trên)
→ operations/local-development → operations/testing-strategy
```

[Ba lát cắt dọc](how-it-works.md) là bản đồ định tuyến xuyên tầng cho ba thao tác tiêu biểu (sign in, move task, log work); nó chỉ trỏ về canonical owner, không định nghĩa lại gì.

### Bài toán khó và cách giải

Bảng định tuyến: mỗi bài toán kỹ thuật trung tâm của Flowboard và các file sở hữu lời giải.

| Bài toán | Đọc ở đâu |
|---|---|
| Lost update khi hai người sửa cùng task | [Pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md) (`expectedVersion` → `409`), [interaction specifications](design/interaction-specifications.md) (§5 Conflict), [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md) |
| Drag-and-drop ordering không rewrite cả bảng | [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md), [pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md) (move/rebalance), [database design](data/database-design.md) |
| Retry gây double-write | [API conventions](api/api-conventions.md) (idempotency key), [database design](data/database-design.md) (`idempotency_records`), [testing strategy](operations/testing-strategy.md) |
| IDOR / truy cập chéo project | [Authorization model](security/authorization-model.md) (`404` không lộ existence), [database design](data/database-design.md) (composite FK same-project), [authorization test matrix](security/authorization-test-matrix.md) |
| Invariant cross-row: tổng ≤ 1.440 phút/ngày | [Query and index policy](data/query-and-index-policy.md) (advisory lock), [ADR-0002](decisions/ADR-0002-project-time-tracking-and-approval.md) |
| Board của project lớn vẫn nhanh | [Query and index policy](data/query-and-index-policy.md) (per-column cursor, index baseline, explain rule) |
| Search tiếng Việt gõ không dấu | [Query and index policy](data/query-and-index-policy.md) (unaccent đối xứng, `fb_unaccent`) |
| Response cũ về muộn ghi đè state mới (client race) | [Interaction specifications](design/interaction-specifications.md) (§2 version guard, §6 cache-key fingerprint) |

Task này chỉ thiết lập bản đồ. Các tài liệu theo chủ đề được liên kết bên dưới là đầu ra của các task tiếp theo; chúng được hoãn có chủ đích, không phải là phần đã hoàn tất của MVP hay của thiết kế UI.

## Sản phẩm (Product)

- Tầm nhìn và phạm vi (`product/vision-and-scope.md`): vấn đề, người dùng mục tiêu, MVP và non-goals.
- Persona và jobs-to-be-done (`product/personas-and-jobs.md`): trách nhiệm và nhu cầu thông tin của từng vai trò.
- Hành trình người dùng (`product/user-journeys.md`): các đường đi thành công và thất bại chính.
- Lộ trình phát hành (`product/delivery-roadmap.md`): ranh giới giữa core MVP, reporting và AI.

## UX và Pencil (UX and Pencil)

- `design/information-architecture.md`, `design/user-flows.md` và `design/screen-inventory.md` xác định hành vi, trạng thái và phạm vi màn hình trước khi thiết kế hình ảnh.
- `design/interaction-specifications.md`, `design/design-system.md` và `design/pencil-handoff.md` là hợp đồng bàn giao.
- Pencil là nguồn chân lý cho thiết kế trực quan: bố cục, thành phần, biến thể, trạng thái đáp ứng và tài sản giao diện. Markdown vẫn là nguồn chân lý cho hành vi sản phẩm, kiến trúc, hợp đồng và vận hành.

## Thiết kế hệ thống (System design)

- `data/domain-model.md`, `data/database-design.md` và `data/query-and-index-policy.md`.
- `security/authentication.md`, `security/authorization-model.md` và `security/authorization-test-matrix.md`.
- `api/api-conventions.md`, `api/endpoint-contracts.md` và `api/pagination-concurrency-idempotency.md`.

## Kỹ thuật và vận hành (Engineering and operations)

- `engineering/repository-structure.md`, `engineering/frontend-conventions.md`, `engineering/backend-conventions.md` và `engineering/shared-helper-policy.md`.
- `operations/testing-strategy.md`, `operations/local-development.md`, `operations/ci-cd.md` và `operations/observability.md`.

## Các giai đoạn tương lai (Future phases)

- `reporting/progress-export.md` thuộc Phase 1.1 và Phase 1.2; Redis, worker và BullMQ chỉ được đưa vào khi việc tạo hoặc gửi báo cáo trở thành bất đồng bộ.
- `ai/roadmap.md` và `ai/architecture-and-safety.md` mô tả các phase AI-1 đến AI-4. AI, realtime, custom roles, attachments, billing, mobile và microservices không thuộc core MVP.
- `user-guide/README.md` được bổ sung sau khi các luồng sản phẩm và tài sản Pencil đã ổn định.

## Hồ sơ quyết định (Decision records)

`decisions/README.md` lưu các quyết định khó đảo ngược sau baseline này, như lựa chọn session, ORM, chiến lược ordering/concurrency, thay đổi permission, queue, nhà cung cấp AI và deployment.

## Lưu trữ (Archive)

[`_archive/`](_archive/README.md) giữ các tài liệu đã bị thay thế. Chúng không còn là contract; khi grep thấy nội dung ở `_archive/` lệch với tài liệu đang sống, tài liệu đang sống luôn đúng.
