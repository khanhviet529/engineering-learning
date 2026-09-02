# ADR-0002: Project-level time tracking and approval

- Status: Accepted
- Date: 2026-09-02

## Context

Task start/due dates describe a plan, not actual work duration. Flowboard needs a project-private way to record daily actual time, identify the task and work performed, and aggregate monthly hours without inferring hours from task dates. Projects operate differently: some trust members to self-close time while others need an approver. The existing Owner/Editor/Viewer model, private-project boundary and deny-by-default policy must remain intact.

## Decision

Time Tracking is an optional Phase 1.3 module configured per project. Owner can enable it, choose `self_close` or `requires_approval`, set a 0–31 day backfill window (default 7), and designate active Project Editors as Time Approvers. Owner is always an approver; no approver may review their own WorkLog.

Daily `WorkLog` is an explicit user–task–date record with duration, description and an optional support reason. Members may log a visible task not assigned to them only with a support reason. In approval mode, only approved logs count; in self-close mode, actor confirmation creates an approved log with `approval_kind=self`. Owner may create a bounded date/member backfill override with a reason. Single and bulk review coexist; bulk produces a result for each log rather than pretending an all-or-nothing outcome.

Viewer remains read-only. Time Tracking does not introduce a timer, payroll, billing, time export, email, queue, worker, custom role or Workspace Admin access to a private project.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Cấu hình theo project | Phù hợp quy trình từng team, giữ fixed role model và audit rõ. | Owner phải quản lý settings/approver. |
| Một rule toàn hệ thống | Ít cấu hình, dễ triển khai ban đầu. | Không đáp ứng team tự chốt lẫn team cần duyệt. |
| Rule riêng theo task hoặc thành viên | Linh hoạt tối đa. | Khó hiểu, khó audit, tạo ngoại lệ và làm báo cáo tháng thiếu tin cậy. |

## Consequences

Thay đổi yêu cầu thêm entities/migration/index, project-scoped authorization, version/idempotency/error contracts, aggregate report và UI Light/Dark. Migration additive và feature disabled cho project hiện có; không backfill thời gian từ Task. Domain/API tests phải chứng minh cross-project denial, no self-review, daily 1.440-minute limit, backfill enforcement, bulk partial outcome và correct monthly totals.

## Revisit When

Mở ADR mới khi cần contributor chỉ ghi giờ nhưng không sửa task, timer chạy nền, payroll/billing, time XLSX/export/email, custom role, period locking hoặc policy vượt 31 ngày. Không sửa ADR Accepted để biểu diễn quyết định thay thế.
