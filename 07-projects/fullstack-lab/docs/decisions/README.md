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
