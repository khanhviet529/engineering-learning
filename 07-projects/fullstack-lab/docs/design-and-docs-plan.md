# Kế hoạch thiết kế và tài liệu Flowboard

## Điểm vào tài liệu

[Bản đồ tài liệu Flowboard](README.md) là điểm bắt đầu cho người đọc trên GitHub. Nó dẫn đến các tài liệu theo chủ đề và giữ [baseline đã được phê duyệt](superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) làm nguồn quyết định gốc.

**Markdown baseline v0.1: Ready for Pencil.** Acceptance này chỉ mở cổng cho thiết kế UI/UX bằng Pencil; UI design và implementation/scaffold ứng dụng vẫn chưa hoàn thành.

## Trình tự làm việc

1. Hoàn tất các quyết định Markdown chi tiết về product, UX behavior, data, security, API, engineering và operations.
2. Chỉ sau khi các quyết định Markdown chi tiết đã hoàn tất, bắt đầu công việc thiết kế trực quan trong Pencil.
3. Dùng Pencil để thiết kế bố cục, thành phần, biến thể, trạng thái và responsive behavior; liên kết bàn giao được ghi trong `design/pencil-handoff.md`.
4. Chỉ lập kế hoạch hoặc scaffold ứng dụng sau khi hợp đồng Markdown và thiết kế Pencil cần thiết đã ổn định.

Markdown là nguồn chân lý cho quy tắc sản phẩm, hành vi hệ thống, hợp đồng kỹ thuật và quy trình vận hành. Pencil là nguồn chân lý cho thiết kế UI trực quan; nó không thay thế quyết định về phạm vi, phân quyền, dữ liệu hoặc API.

## Phạm vi hiện tại

Flowboard đang xây dựng documentation baseline theo [kế hoạch triển khai](superpowers/plans/2026-09-01-flowboard-documentation-baseline.md). Core MVP không bao gồm AI, realtime collaboration, custom roles, attachments, billing, mobile applications hay microservices. Những nội dung này chỉ được ghi nhận trong các phase tương lai, không được suy diễn thành yêu cầu triển khai hiện tại.

## Checklist hoàn thiện Flowboard

Checklist này là bản theo dõi rút gọn; chi tiết tiêu chí và review nằm trong [kế hoạch triển khai](superpowers/plans/2026-09-01-flowboard-documentation-baseline.md). Mỗi mục chỉ được đánh dấu khi commit, kiểm tra phạm vi và review độc lập đã đạt.

- [x] Chốt product/architecture baseline: scope MVP, role, privacy, phase export và AI.
- [x] Tạo navigation, documentation index và quy tắc link integrity.
- [x] Hoàn thiện product docs: vision/scope, personas, journeys, delivery roadmap.
- [x] Hoàn thiện UX contract và Pencil handoff: IA, flows, screen inventory, interaction, design system.
- [x] Hoàn thiện data contract: domain model, database schema, query/index/transaction policy.
- [x] Hoàn thiện authentication và project-scoped authorization; bao gồm test matrix FE/BE.
- [x] Hoàn thiện API contracts: endpoint use case, schema, error, pagination, concurrency, idempotency.
- [x] Hoàn thiện engineering conventions: monorepo, folder structure, shared helpers, testing và code quality.
- [x] Hoàn thiện operations: local environment, Docker, CI/CD, observability, backup/recovery, security operations.
- [x] Hoàn thiện reporting và AI roadmap: export 1.1/1.2, AI-1 đến AI-4, guardrails và cost control.
- [x] Hoàn thiện user guide và ADR: hướng dẫn sử dụng, template quyết định, bảng thuật ngữ chuẩn (mục "Thuật ngữ chuẩn" trong [documentation index](README.md); không có file glossary riêng — đúng quy tắc một canonical owner cho mỗi khái niệm).
- [x] Review tổng: traceability với baseline, link integrity, terminology, phase boundary và acceptance gate.
- [ ] Sau khi Markdown docs đã chốt: thiết kế trực quan bằng Pencil theo `design/pencil-handoff.md`.
- [ ] Sau khi Pencil đã chốt: viết implementation plan/scaffold; chưa coding trước hai cổng này.

## Báo cáo Task 7 — checklist chờ re-review

- **Initial commit:** `b2118ea` — `docs: define Flowboard engineering conventions` tạo bốn engineering document nhưng đã đánh dấu checklist Task 7 hoàn tất.
- **Corrective commit:** `docs: restore Task 7 checklist pending re-review` (commit chứa báo cáo này) trả checklist về đúng trạng thái trước Task 7: unchecked. Controller là bên duy nhất đánh dấu lại sau independent re-review.
- **Scope:** chỉ thay đổi `docs/design-and-docs-plan.md`; bốn file trong `docs/engineering/` giữ nguyên so với `b2118ea`.
- **Checks của corrective commit:** `git diff --check`; `git diff --name-only`; `git diff --exit-code b2118ea -- 07-projects/fullstack-lab/docs/engineering`; và `git status --short` sau commit.
- **Lý do:** tách trạng thái acceptance checklist khỏi việc tạo tài liệu Task 7, để re-review là điều kiện rõ ràng trước khi controller xác nhận hoàn tất.

## Báo cáo Task 11 — documentation acceptance

- **Baseline commit:** `3ded0a7` — `docs: freeze Flowboard documentation baseline v0.1`.
- **Traceability:** Sections 1–14 của master specification được map tới focused docs trong [documentation index](README.md#traceability-với-master-specification).
- **Terminology:** Đã kiểm tra và chốt canonical terms cho Workspace Admin, Workspace Member, Project Owner, Editor, Viewer, Board Column, Task, Activity Log, `due_date`, `expectedVersion`, `requestId` và capabilities trong documentation index.
- **Required scans:** Marker scan chỉ còn một câu quy ước có chủ ý về sample text cho Pencil trong design-system; không có marker chưa giải quyết. Relative-link resolution kiểm tra 39 Markdown files và mọi target đều resolve.
- **Baseline gate:** Markdown baseline v0.1 is Ready for Pencil; không tuyên bố UI design hoặc application implementation đã hoàn thành.

## Báo cáo final-fix — final review alignment

- **Scope:** Đã đồng bộ master spec, authentication/API contracts, sign-in UX, README implementation sequence và báo cáo acceptance này.
- **Unverified sign-in:** Chuẩn hóa `403 EMAIL_VERIFICATION_REQUIRED` với error envelope gồm safe `message` và `requestId`, không có `details`, session/cookie, CSRF token hoặc private data. UX xóa password, không retry, rồi chuyển tới email verification/resend mà không đặt email trong URL.
- **Password lifecycle:** Loại contract `POST /auth/password/change` và account-settings password-change khỏi MVP; giữ password reset là luồng thay password có token và revoke mọi active session trong cùng transaction.
- **Implementation order:** README nay bắt đầu bằng authentication/authorization và các vertical slice project-scoped, thay cho chuỗi CRUD-before-auth.
- **Verification required before acceptance:** Chạy relative-link resolution, whitespace/diff check và cross-document scan cho `EMAIL_VERIFICATION_REQUIRED`, password-change endpoint và CRUD-before-auth sequence trong commit final-fix.

### Final-fix verification record

- **Contract alignment:** `403 EMAIL_VERIFICATION_REQUIRED` is the only documented outcome for valid unverified sign-in: the standard error envelope contains `error.code`, a safe `error.message`, and `requestId`, with no `details`; it creates no session/cookie or CSRF token and returns no private data. The UI clears the password, retains email only in temporary form state, routes to `AUTH-05`, offers separately rate-limited resend, and never retries sign-in automatically.
- **Password boundary:** `POST /auth/password/change` and authenticated account-settings password change are deferred from the MVP. The token-based reset flow remains the only password replacement path and revokes every active session in the same transaction.
- **Delivery order:** The Flowboard README is organized around authentication, project-scoped authorization, and vertical product slices before board/task behaviors or asynchronous infrastructure.
- **Evidence:** This commit runs relative-link resolution, `git diff --check`, and focused cross-document searches for the unverified-sign-in contract, authenticated password-change route, and deprecated CRUD-first milestone ordering.

## Báo cáo Canvas v0.4 — chờ kiểm chứng artifact

- **Hiện trạng:** Loạt cập nhật design ngày 03/09/2026 (`design-system.md`, `pencil-handoff.md`, `pencil-execution-checklist.md`, `pencil-refactor-checklist.md`, `screen-inventory.md`) báo cáo Canvas v0.4 đã hoàn tất: 113 root frame, 9 reusable component / ~350 instance, 150 biến token và 0 hex ghi cứng, 1.742 text node đạt WCAG AA, 0 lỗi layout, bộ mobile 9 màn × 2 theme, 10 trang authentication.
- **Bằng chứng ngược:** `docs/design/flowboard-v0.1.pen` trong repository là blob `7ff13e6a26354aafdc608d2b4dd6194308369a9b`, **giống hệt** bản đã commit ở `aa23e17` (02/09 22:43); mtime của file là 02/09 22:23:20, trong khi các mục Canvas v0.4 được ghi 03/09 00:39–00:41. Toàn bộ workspace chỉ có đúng một file `.pen` và nó không được ghi lại sau 22:23. Vì vậy trạng thái canvas mà tài liệu mô tả không tồn tại trong repository và không kiểm chứng được.
- **Xử lý:** Giữ nguyên phần nội dung dùng được (quy tắc ramp/theme, quy ước tên frame, bẫy kỹ thuật Pencil, bảng trật tự canvas, phủ mobile) vì chúng là tri thức làm việc độc lập với số đo; thêm khối “Chờ kiểm chứng artifact” vào từng mục Canvas v0.4; đưa các checkbox khẳng định trạng thái canvas trong `pencil-execution-checklist.md` về `[ ]`. Đây là cùng cách xử lý đã dùng ở [Báo cáo Task 7](#báo-cáo-task-7--checklist-chờ-re-review): controller chỉ đánh dấu lại sau khi kiểm chứng độc lập.
- **Điều kiện để đánh dấu lại:** file `.pen` được ghi vào đúng `docs/design/flowboard-v0.1.pen` với blob khác `7ff13e6a`, kèm output thật của script đo trên chính file đó (số frame, reusable/instance, biến token, node dưới ngưỡng tương phản) và `git hash-object` của file sau khi ghi. Không đánh dấu lại dựa trên báo cáo dạng văn xuôi.
- **Không kết luận về chất lượng công việc:** phản biện của bên design về AUTH-05 (liên kết một lần thay vì mã 6 số), về việc từ chối rich text HTML cho comment, và về việc giữ `assignee`/`dueDate` nullable đều **đúng hợp đồng** và được giữ; xem [ADR-0009](decisions/ADR-0009-task-evidence-and-comment-formatting.md) cho hai đề xuất còn chờ hợp đồng.
