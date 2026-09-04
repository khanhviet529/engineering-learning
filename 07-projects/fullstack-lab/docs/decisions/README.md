# Architecture Decision Records (ADR) của Flowboard

## Mục đích

ADR lưu lý do và hậu quả của một quyết định khó đảo ngược sau documentation baseline. Nó giúp quyết định được truy vết từ product/UX đến code, migration, vận hành và các phase sau, thay vì chỉ tồn tại trong pull request hoặc trí nhớ của nhóm.

ADR không thay thế [baseline đã được phê duyệt](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md). Baseline là điểm xuất phát hiện tại; ADR ghi quyết định mới, thay đổi hoặc làm rõ có tác động khó đảo ngược. Một ADR không được tự mở rộng core MVP: private project, role Owner/Editor/Viewer, deny-by-default và phase boundary vẫn áp dụng cho mọi quyết định.

## Khi ADR là bắt buộc

Tạo ADR trước khi implementation hoặc migration cho các quyết định sau:

- lựa chọn authentication/session, cookie/CSRF hoặc thay đổi vòng đời credential;
- lựa chọn hoặc thay đổi ORM;
- cách database thực hiện ordering, optimistic concurrency, transaction hoặc chiến lược migration khó đảo ngược;
- thay đổi permission catalog, role mapping, private-project scope hoặc authorization enforcement;
- thêm queue, Redis, BullMQ, worker, durable execution/delivery hay chính sách retry ở Phase 1.2;
- chọn AI provider/model, data residency, retention, routing, quota, retrieval/index hoặc tool allowlist;
- thay đổi deployment topology, secret management, backup/recovery target hoặc cơ chế release/rollback.

ADR cũng bắt buộc cho API contract breaking change, package boundary/migration ownership hoặc thay đổi khác làm dữ liệu, bảo mật, vận hành hay chi phí khó quay lại. Thay đổi copy, layout Pencil hoặc implementation detail có thể đảo ngược và không đổi behavior/contract thường không cần ADR.

## Quy trình

1. Sao chép [ADR template](ADR-template.md) thành `NNNN-short-kebab-title.md`, dùng số tăng dần bốn chữ số.
2. Ghi `Status: Proposed`, nêu Context đủ để reviewer hiểu ràng buộc và liên kết đến documentation baseline liên quan.
3. So sánh các Alternatives thực tế, gồm phương án không thay đổi hoặc hoãn lại nếu phù hợp; nêu trade-off, không chỉ liệt kê tên công nghệ.
4. Sau khi quyết định được phê duyệt, đổi trạng thái thành `Accepted` trước khi merge implementation có tính không đảo ngược. ADR bị thay thế giữ nguyên lịch sử và ghi `Superseded by ADR-NNNN`.
5. Liên kết ADR từ pull request, migration, rollout/runbook hoặc phase document thực hiện nó. Khi điều kiện `Revisit When` xảy ra, mở ADR mới thay vì viết lại quyết định cũ.

Không đưa secret, token, cookie/session ID, dữ liệu project riêng tư, raw prompt hoặc thông tin vận hành nhạy cảm vào ADR.

**Nợ đã biết:** [ADR-0001](ADR-0001-task-planning-fields-and-review-workflow.md) được viết trước khi template hiện hành được áp dụng, nên nó thiếu `Alternatives` và `Revisit When`. Nó **không** được sửa: quy trình cấm thay đổi một ADR đã `Accepted`, và trên thực tế nó vẫn đang được xem lại đúng cơ chế được phép — [ADR-0008](ADR-0008-terminal-column-and-task-reopen.md) đóng phần terminal column mà nó phụ thuộc, [ADR-0009](ADR-0009-task-evidence-and-comment-formatting.md) mở rộng tập field của Task. Mọi ADR từ 0002 trở đi đủ năm mục.

## Trạng thái

| Status | Ý nghĩa |
|---|---|
| Proposed | Đang được review; chưa là quyền để implementation quyết định thay đổi khó đảo ngược. |
| Accepted | Đã được phê duyệt và là nguồn quyết định cho phạm vi nêu trong ADR. |
| Rejected | Đã xem xét nhưng không chọn; giữ lại lý do để tránh lặp lại debate. |
| Superseded | Không còn là quyết định hiện hành; liên kết ADR thay thế phải được nêu rõ. |

## Tài liệu liên quan

- [Lộ trình phát hành](../product/delivery-roadmap.md) — ranh giới core MVP, reporting và AI.
- [Kiến trúc thông tin](../design/information-architecture.md) và [bàn giao Pencil](../design/pencil-handoff.md) — Pencil sở hữu visual design, Markdown sở hữu behavior/contract.
- [Mô hình phân quyền](../security/authorization-model.md) — private project và role/capability hiện hành.
- [Chính sách query, index và transaction](../data/query-and-index-policy.md) — ordering/concurrency và thay đổi dữ liệu.
- [Local development](../operations/local-development.md), [CI/CD](../operations/ci-cd.md) và [observability](../operations/observability.md) — queue/deploy/recovery implications.
- [Reporting](../reporting/progress-export.md) và [AI architecture and safety](../ai/architecture-and-safety.md) — các quyết định được hoãn đến Phase 1.2 và AI.
- [ADR-0001: Task planning fields and review workflow](ADR-0001-task-planning-fields-and-review-workflow.md) — category/priority/start–due date, `created_by` và review workflow theo cột của Task ở core MVP.
- [ADR-0002: Project-level time tracking and approval](ADR-0002-project-time-tracking-and-approval.md) — WorkLog, approval và backfill theo project ở Phase 1.3.
- [ADR-0003: Opaque server session, cookie và CSRF thay vì JWT](ADR-0003-opaque-session-authentication.md) — lý do chọn opaque session, chi phí lookup và các quyết định phụ (rotate, revoke-all, không cookie khi chưa verify).
- [ADR-0004: Drizzle ORM và Drizzle Kit cho data access](ADR-0004-drizzle-orm.md) — trục so sánh với Prisma/Kysely/raw SQL và lý do lệch mặc định Prisma của kho kiến thức.
- [ADR-0005: Bản đồ phụ thuộc module và vị trí của Activity](ADR-0005-module-dependency-and-activity-boundary.md) — Activity là module với recorder port; đồ thị phụ thuộc acyclic của apps/api.
- [ADR-0006: Fractional ordering, ngưỡng rebalance và optimistic concurrency](ADR-0006-fractional-ordering-and-concurrency.md) — spacing 1024, ngưỡng 10⁻⁶, phân tích precision và unique constraint DEFERRABLE.
- [ADR-0007: Password policy](ADR-0007-password-policy.md) — độ dài 12–200 cộng blocklist thay cho composition rules; NFKC, không truncate, không rotation định kỳ.
- [ADR-0008: Terminal board column và ngữ nghĩa mở lại task](ADR-0008-terminal-column-and-task-reopen.md) — `is_terminal` đóng gap `due_state`; mở lại là move ghi `task.reopened`, không thêm status.
- [ADR-0009: Liên kết bằng chứng của Task và định dạng comment](ADR-0009-task-evidence-and-comment-formatting.md) — `evidence_url` https-only server không fetch; comment giữ plain text, Markdown subset chỉ ở tầng render.
- [ADR-0010: Sprint theo project như một phase tuỳ chọn](ADR-0010-sprint-iteration.md) — Phase 1.4, bật theo project, `sprint_id` nullable để giữ backlog, một active sprint cưỡng chế bằng partial unique index.
- [ADR-0011: Quan hệ giữa Task — subtask một cấp và phụ thuộc blocking](ADR-0011-task-relations-subtask-and-dependency.md) — Phase 1.5, cha–con sâu một cấp cycle-free theo cấu trúc, đồ thị phụ thuộc chống cycle bằng advisory lock.
- [ADR-0012: `packages/mock` — mock HTTP dựng từ hợp đồng, dùng chung cho dev và test](ADR-0012-contract-mock-package.md) — Thêm workspace package thứ tư để frontend chạy được trước backend ở M2–M4; mock không cưỡng chế quyền, concurrency hay idempotency và không được deploy.
- [ADR-0013: Thêm workspace member bằng lời mời qua email, không bằng tra cứu người dùng](ADR-0013-workspace-member-invitation.md) — Một endpoint tra cứu "chỉ dành cho Workspace Admin" thực chất mở cho mọi người vừa đăng ký, vì ai xác minh email cũng tạo được workspace và thành admin của nó.
