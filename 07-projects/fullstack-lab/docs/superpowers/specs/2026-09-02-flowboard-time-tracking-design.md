# Flowboard — Time Tracking và phê duyệt giờ theo project

**Trạng thái:** Proposed — chờ user review trước khi tạo kế hoạch triển khai.
**Ngày:** 2026-09-02
**Phạm vi phát hành đề xuất:** Phase 1.3, sau core MVP và độc lập với queue/report delivery Phase 1.2.

## 1. Mục tiêu và ranh giới

Task có `startDate`/`dueDate` để lập kế hoạch, không phải bằng chứng giờ làm thực tế. Time Tracking bổ sung một sổ giờ (`WorkLog`) theo ngày để Owner theo dõi tổng số giờ một thành viên đã làm trong tháng, đồng thời vẫn biết giờ đó gắn với task nào và đã làm gì.

Mỗi project có thể bật/tắt Time Tracking và chọn cách chốt giờ riêng:

| Chế độ | Ý nghĩa |
|---|---|
| `self_close` | Thành viên tự chốt WorkLog; log được tính chính thức ngay. |
| `requires_approval` | Thành viên gửi log; Owner hoặc Editor được chỉ định duyệt/trả lại trước khi log được tính chính thức. |

Tính năng này không suy ra số giờ từ khoảng ngày của task, không thêm realtime, payroll, billing, invoice, overtime, leave, timer chạy nền, lịch gửi báo cáo hoặc queue. Báo cáo tháng là aggregate trực tiếp từ WorkLog đã được chốt/duyệt trong PostgreSQL.

## 2. Phương án đã chọn

Chọn **cấu hình theo project** thay vì một quy tắc toàn hệ thống hoặc rule riêng cho từng task/thành viên.

- Owner quản lý cấu hình Time Tracking, danh sách Editor được duyệt giờ và thời hạn ghi bù.
- Một hoặc nhiều Editor có thể là `Time Approver`; Owner luôn có quyền duyệt.
- Khi `requires_approval`, không ai được duyệt WorkLog của chính mình, kể cả Owner. Owner cần một Owner/Editor approver khác cho log của mình.
- Thành viên có thể log giờ vào task được giao hoặc một task khác mà họ được phép đọc. Với task không giao cho chính mình, `supportReason` là bắt buộc.
- Duyệt một log và duyệt hàng loạt cùng tồn tại. Hàng loạt xử lý từng log độc lập, không all-or-nothing.

## 3. Mô hình dữ liệu và bất biến

### 3.1 Thực thể mới

```text
Project
 ├── ProjectTimeTrackingSettings (1:1, optional)
 ├── ProjectTimeApprover (0..n, Editor được Owner chỉ định)
 ├── WorkLog (0..n)
 └── WorkLogAccessOverride (0..n, mở ghi bù cho một member/ngày)

Task ── WorkLog
User ── WorkLog.logged_by_user_id
User ── WorkLog.reviewed_by_user_id (nullable)
```

| Thực thể | Fields lõi | Quy tắc |
|---|---|---|
| `ProjectTimeTrackingSettings` | `project_id`, `enabled`, `approval_mode`, `backfill_days`, timestamps/version | Một hàng tối đa cho mỗi project. `approval_mode` là `self_close` hoặc `requires_approval`; `backfill_days` 0–31, mặc định 7. |
| `ProjectTimeApprover` | `project_id`, `user_id`, `assigned_by_user_id`, timestamps | User phải đang là Editor của đúng project. `UNIQUE(project_id, user_id)`. Owner là approver ngầm định, không cần row. |
| `WorkLog` | `id`, `project_id`, `task_id`, `logged_by_user_id`, `work_date`, `duration_minutes`, `description`, `support_reason?`, `status`, `submitted_at?`, `reviewed_at?`, `reviewed_by_user_id?`, `review_note?`, `version`, timestamps | Một entry tổng hợp cho một user–task–ngày: `UNIQUE(project_id, task_id, logged_by_user_id, work_date)`. Author bổ sung duration/mô tả vào entry này trong ngày; `duration_minutes` nguyên dương, tối đa 1.440. |
| `WorkLogAccessOverride` | `project_id`, `user_id`, `work_date`, `expires_at`, `opened_by_user_id`, `reason`, timestamps | Owner mở lại một ngày cụ thể cho một member sau backfill window; không tự mở lại toàn bộ lịch sử. |

`work_date` là `DATE` theo timezone của workspace. Timestamp, audit và expiry dùng UTC `TIMESTAMPTZ`. Một WorkLog luôn có cùng `project_id` với Task; repository không query bare WorkLog ID ngoài scope project đã authorize.

### 3.2 Trạng thái

```text
draft ──submit──> submitted ──approve──> approved
   │                   │
   └─self close────────┴───────────────────> approved (approval_kind = self)
                       └─return────────────> rejected ──edit/resubmit──> submitted
```

- `approved` là trạng thái được tính vào báo cáo chính thức. `approval_kind` phân biệt `self` và `reviewed`; không coi self-close là một người tự duyệt trong chế độ `requires_approval`.
- Chỉ `draft` hoặc `rejected` được author chỉnh sửa. Sửa `rejected` phải xóa `reviewed_at`, `reviewed_by_user_id`, `review_note` và trở lại `draft`; lịch sử quyết định vẫn được giữ ở ActivityLog/audit.
- Chỉ Owner hoặc Time Approver hợp lệ được chuyển `submitted → approved|rejected`. Approver không được là `logged_by_user_id`.
- Tổng `duration_minutes` của một `logged_by_user_id` trong một `work_date`, tính các WorkLog chưa bị hủy, không được vượt 1.440 phút. Server lấy transaction/advisory lock ổn định theo `project_id + logged_by_user_id + work_date`, rồi sum và validate trước mutation; UI chỉ hỗ trợ phản hồi sớm.
- Khi Time Tracking tắt, WorkLog cũ giữ nguyên để audit/report lịch sử nhưng không tạo/sửa/gửi/duyệt log mới. Bật lại không đổi status hay approval mode của log đã chốt.

### 3.3 Ghi bù

`backfill_days = 7` nghĩa là actor có thể tạo/sửa log cho hôm nay và tối đa bảy ngày lịch trước đó theo timezone workspace. Không tính từ client clock.

Ngoài cửa sổ này, server từ chối trừ khi có `WorkLogAccessOverride` còn hiệu lực của đúng project, member và ngày làm. Owner có thể mở override cho ngày chưa có log hoặc mở lại một log cụ thể thông qua cùng record ngày/member; reason là bắt buộc và mọi thao tác có ActivityLog.

## 4. Authorization và capability

Time Tracking không thêm role mới và không làm Workspace Admin có quyền ngầm định vào project. Viewer vẫn chỉ đọc như hợp đồng MVP hiện tại; vì vậy chỉ Owner/Editor có thể ghi WorkLog. Nếu sau này cần contributor chỉ log giờ nhưng không sửa task, phải có ADR cho role/capability mới thay vì âm thầm biến Viewer thành write role.

| Capability | Owner | Editor | Viewer | Điều kiện bổ sung |
|---|:---:|:---:|:---:|---|
| `time-tracking:settings:update` | Allow | Deny | Deny | Bật/tắt, mode, backfill, approver list. |
| `work-log:read` | Allow | Allow | Allow | Chỉ khi feature enabled; Viewer chỉ read authorized project data. |
| `work-log:create:self` | Allow | Allow | Deny | Actor là `logged_by_user_id`; task thuộc project và actor đọc được task. |
| `work-log:update:self` | Allow | Allow | Deny | Chỉ `draft`/`rejected`, trong backfill hoặc override. |
| `work-log:submit:self` | Allow | Allow | Deny | Chỉ author, entry hợp lệ. |
| `work-log:review` | Allow | Assigned Editor | Deny | Không duyệt log của chính mình. |
| `work-log:backfill:override` | Allow | Deny | Deny | Reason bắt buộc. |
| `time-report:read` | Allow | Assigned Editor | Deny | Owner xem toàn project; approver chỉ xem aggregate cần duyệt/được giao. |

Mỗi route đi qua `SessionGuard → ResourceProjectResolver → ProjectPermissionGuard → domain validation → project-scoped repository`. Frontend chỉ render CTA từ capability server trả về; mọi mutation đều re-authorize trên server.

## 5. API và query contract

Không tạo generic CRUD/table API. Mọi payload là allowlist, không nhận arbitrary filter field, SQL, timezone từ client hay `projectId` mâu thuẫn với resource đã resolve.

| Use case | Route đề xuất | Quyền | Ghi chú |
|---|---|---|---|
| Đọc/cập nhật cấu hình | `GET/PATCH /projects/:projectId/time-tracking/settings` | time-tracking:settings:update | Settings và approver list là Owner-only; PATCH chỉ nhận `enabled`, `approvalMode`, `backfillDays`, `approverIds`; replacement approver list validate Editor cùng project. |
| Danh sách log cá nhân | `GET /projects/:projectId/work-logs` | work-log:read | Allowlist `userId`, `taskId`, `status`, `dateFrom`, `dateTo`; Viewer chỉ scope read, `userId` không vượt quyền response. Cursor pagination. |
| Tạo/sửa log | `POST /projects/:projectId/work-logs`, `PATCH /work-logs/:workLogId` | create/update:self | POST/PATCH allowlist task, date, duration, description, supportReason, expectedVersion. `Idempotency-Key` cho POST. |
| Gửi log | `POST /work-logs/:workLogId/submit` | submit:self | `self_close` tạo approved/self; `requires_approval` tạo submitted. |
| Duyệt/trả log | `POST /work-logs/:workLogId/review` | review | `{ decision: approved|rejected, note? }`; note bắt buộc khi trả lại. |
| Duyệt hàng loạt | `POST /projects/:projectId/work-logs/bulk-review` | review | Yêu cầu `Idempotency-Key`; chỉ WorkLog cùng project và submitted; trả kết quả theo từng `id`, không atomic toàn danh sách. |
| Mở ghi bù | `POST /projects/:projectId/work-log-access-overrides` | backfill:override | `{ userId, workDate, expiresAt, reason }`; Owner-only. |
| Báo cáo tháng | `GET /projects/:projectId/time-reports/monthly` | time-report:read | `month=YYYY-MM`, optional user/status; server aggregate `SUM(duration_minutes)` theo member và status. |

Phân trang, cursor fingerprint và filter reset áp dụng như Task list. Index baseline: `(project_id, logged_by_user_id, work_date DESC, id DESC)`, `(project_id, task_id, work_date DESC, id DESC)`, `(project_id, status, work_date DESC, id DESC)` và unique daily task entry đã nêu.

## 6. UX, page inventory và filter control

### 6.1 Quy tắc filter chung

Mọi filter có tập giá trị hữu hạn phải thể hiện là control chọn rõ ràng, không phải text giả dropdown:

| Loại dữ liệu | Component | Hiển thị |
|---|---|---|
| Người thực hiện / người giao / reviewer | `FbAsyncMemberSelect` | Label, avatar, placeholder `Tất cả người thực hiện`, icon chevron, tìm kiếm trong popup khi member nhiều. |
| Trạng thái task | `FbSelect` | Label `Trạng thái`, placeholder `Tất cả trạng thái`, option là Board Column active; không nhầm `overdue` với workflow status. |
| Nhóm, độ ưu tiên, due state | `FbSelect` | Một select rõ ràng cho enum/fixed allowlist. |
| Khoảng hạn / ngày log | `FbDateRangePicker` | Hai date input cùng một control, calendar icon, validation start ≤ end. |
| Search title/description | `FbSearchInput` | Input tự do riêng; không giả làm dropdown. |
| Sort | `FbSelect` hoặc menu button | Có chevron và nhãn hiện selection hiện tại. |

Desktop dùng filter toolbar; mỗi select hiển thị label/placeholder/chevron và, sau khi chọn, tạo active chip có nút xóa. Mobile gom các filter vào filter drawer nhưng dùng cùng value/query. Thay filter reset cursor. UI rà ở `BRD-01`, `MYT-01`, `PRJ-04 Dashboard`, `RPT-01`, WorkLog list, Approval Queue và Monthly Report.

### 6.2 Screens mới

| ID | Page / overlay | Actor | Nội dung chính |
|---|---|---|---|
| `TTS-01` | Time Tracking Settings trong PRJ-03 | Owner | Toggle enabled, self-close/requires approval, backfill days, Editor approver list, warning không tự hồi tố. |
| `WTL-01` | Nhật ký giờ của tôi | Owner/Editor | Week/day view, tổng theo ngày, `Thêm giờ`, danh sách draft/submitted/approved/rejected và reopen state. |
| `WTL-02` | Form ghi giờ | Owner/Editor | Task searchable select, date picker, duration, mô tả, support reason condition, daily-total validation; Save draft / Submit hoặc Self-close. |
| `WTA-01` | Hàng chờ duyệt giờ | Owner/assigned Editor | Filter người, ngày, task, status; detail review; checkbox bulk review summary. |
| `WTR-01` | Báo cáo giờ tháng | Owner/assigned Editor | Month select, member rows, total approved/self-closed hours, pending/rejected breakdown, drilldown an toàn. |
| `TSK-02` extension | Tab Nhật ký giờ trong Task Detail | Authorized reader | WorkLog đã authorize theo task; no write CTA nếu thiếu capability. |

Modal `WTL-02`, review dialog và bulk confirmation luôn đặt trên đầy đủ App Shell + page nền. Mỗi page có Light/Dark tương đương, loading/empty/error/forbidden, sidebar item active và tooltip trong sidebar collapsed.

## 7. Reporting, audit và lỗi

- Báo cáo tháng chỉ cộng WorkLog `approved`; với `self_close`, approved có `approval_kind=self` và được hiển thị riêng để Owner biết đây là số tự chốt. `draft`, `submitted`, `rejected` hiển thị breakdown nhưng không cộng vào tổng chính thức.
- Activity/audit ghi tối thiểu: config changed, approver assigned/removed, WorkLog created/edited/submitted/self-closed/approved/rejected, bulk-review outcome từng record, override opened/expired. Không log mô tả công việc thô, raw payload, ID ngoài scope, token hay reason nhạy cảm vào telemetry.
- Domain errors chuẩn: `TIME_TRACKING_DISABLED`, `WORK_LOG_BACKFILL_CLOSED`, `WORK_LOG_DAILY_LIMIT_EXCEEDED`, `WORK_LOG_SELF_REVIEW_FORBIDDEN`, `WORK_LOG_NOT_SUBMITTED`, `WORK_LOG_REVIEWER_INVALID`, `WORK_LOG_TASK_SUPPORT_REASON_REQUIRED`, `WORK_LOG_VERSION_CONFLICT`.
- `409` cho stale `expectedVersion`, status không còn submitted hoặc aggregate race; không retry mutation im lặng. `403` cho visible project member thiếu capability, `404` cho resource không nằm trong project scope thấy được.

## 8. Rollout và kiểm thử chấp nhận

### Migration/rollout

1. Additive migration: settings, approvers, WorkLog, override tables/indexes; feature mặc định disabled cho project hiện có.
2. Implement authorization/capability, scoped repositories và mutation transactions trước UI.
3. Thêm screens Light/Dark, filter components và error states; không đổi semantics của Task dates hoặc `dueState`.
4. Bật theo từng project bằng Owner; không backfill giờ từ Task duration.

### Acceptance criteria

- Owner có thể bật từng project, chọn self-close hoặc approval, chỉ định nhiều Editor approver và đặt 0–31 ngày ghi bù.
- Editor log giờ vào task mình hoặc task khác; task khác bắt buộc support reason. Server từ chối tổng ngày vượt 24 giờ và ngày ngoài cửa sổ chưa được Owner mở.
- Self-close tính ngay; required-approval chỉ tính sau approver khác actor duyệt. Owner không tự duyệt log của mình.
- Duyệt đơn lẻ và hàng loạt không vượt project/status; bulk trả kết quả riêng cho từng log conflict/failure.
- Báo cáo tháng cho đúng tổng authorized/scope, tách approved/self-closed/pending/rejected; Viewer không có write/approval/report CTA.
- Tất cả filter có option set dùng select/dropdown rõ label, chevron, placeholder, active chip và cùng query contract với API; search tự do là input riêng.
- Light/Dark, responsive sidebar, focus/keyboard, empty/loading/error/403/409 và audit được kiểm thử; không có generic table API hay unscoped query.

## 9. Tác động tài liệu sau khi spec được duyệt

Sau approval, cập nhật đồng bộ `vision-and-scope`, `delivery-roadmap`, domain/database/query policy, authorization model, API contracts, reporting, screen inventory, interaction specs, Pencil handoff và các frame Light/Dark. Nếu quyết định cho Viewer ghi giờ hoặc thêm timer/billing, mở ADR/spec mới thay vì thay đổi ngầm phạm vi này.
