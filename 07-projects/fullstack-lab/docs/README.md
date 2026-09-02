# Tài liệu Flowboard

Tài liệu này là bản đồ điều hướng cho Flowboard. [Đặc tả baseline đã được phê duyệt](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) giữ các quyết định gốc; các tài liệu theo chủ đề sẽ diễn giải chúng thành hợp đồng có thể thực hiện.

**Markdown baseline v0.1: Ready for Pencil.** Mốc này xác nhận tài liệu Markdown sẵn sàng cho công việc UI/UX trong Pencil, không phải xác nhận thiết kế UI hoặc ứng dụng đã hoàn thành.

## Traceability với master specification

| Master-spec section | Focused documentation |
|---|---|
| 1. Purpose | [Product vision and scope](product/vision-and-scope.md), [delivery roadmap](product/delivery-roadmap.md) |
| 2. Problem and target users | [Personas and jobs](product/personas-and-jobs.md), [user journeys](product/user-journeys.md) |
| 3. Product scope | [Product vision and scope](product/vision-and-scope.md), [delivery roadmap](product/delivery-roadmap.md) |
| 4. Information architecture and UX rules | [Information architecture](design/information-architecture.md), [user flows](design/user-flows.md), [screen inventory](design/screen-inventory.md), [Pencil handoff](design/pencil-handoff.md) |
| 5. Authorization model | [Authentication](security/authentication.md), [authorization model](security/authorization-model.md), [authorization test matrix](security/authorization-test-matrix.md) |
| 6. Domain and data model | [Domain model](data/domain-model.md), [database design](data/database-design.md), [query and index policy](data/query-and-index-policy.md) |
| 7. API design | [API conventions](api/api-conventions.md), [endpoint contracts](api/endpoint-contracts.md) |
| 8. Pagination, ordering, and concurrency | [Pagination, concurrency, and idempotency](api/pagination-concurrency-idempotency.md), [query and index policy](data/query-and-index-policy.md) |
| 9. Technical baseline | [Repository structure](engineering/repository-structure.md), [frontend conventions](engineering/frontend-conventions.md), [backend conventions](engineering/backend-conventions.md), [shared-helper policy](engineering/shared-helper-policy.md) |
| 10. Reporting and asynchronous work | [Progress export](reporting/progress-export.md), [delivery roadmap](product/delivery-roadmap.md) |
| 11. Testing, delivery, and observability | [Testing strategy](operations/testing-strategy.md), [local development](operations/local-development.md), [CI/CD](operations/ci-cd.md), [observability](operations/observability.md) |
| 12. AI design | [AI roadmap](ai/roadmap.md), [AI architecture and safety](ai/architecture-and-safety.md) |
| 13. Documentation deliverables | This index, [design and documentation plan](design-and-docs-plan.md), [user guide](user-guide/README.md), [ADR process](decisions/README.md) |
| 14. Baseline acceptance criteria | This index, [design and documentation plan](design-and-docs-plan.md), [approved baseline](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) |

### Baseline bổ sung

Các baseline sau được phê duyệt sau master specification 2026-09-01. Chúng không phải một section của spec cũ; mỗi baseline có spec và kế hoạch triển khai riêng, và các quyết định đã được diễn giải vào focused documentation tương ứng.

| Baseline | Spec | Kế hoạch triển khai | Focused documentation đã cập nhật |
|---|---|---|---|
| Phase 1.3 — Time Tracking (2026-09-02) | [Time Tracking design](superpowers/specs/2026-09-02-flowboard-time-tracking-design.md) | [Time Tracking documentation and design plan](superpowers/plans/2026-09-02-flowboard-time-tracking-documentation-and-design.md) | [ADR-0002](decisions/ADR-0002-project-time-tracking-and-approval.md), [delivery roadmap](product/delivery-roadmap.md), [database design](data/database-design.md), [query and index policy](data/query-and-index-policy.md), [authorization model](security/authorization-model.md), [endpoint contracts](api/endpoint-contracts.md), [pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md), [Pencil handoff](design/pencil-handoff.md) |

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
| capabilities | Quyền do server tính cho resource; frontend chỉ dùng để diễn đạt affordance, không thay thế authorization. |

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
