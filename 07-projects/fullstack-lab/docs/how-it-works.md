# Ba lát cắt dọc qua Flowboard (how it works)

Tài liệu docs được tổ chức theo tầng (product → UX → security → data → api → engineering), nên một thao tác duy nhất trải trên nhiều file. Tài liệu này đi **dọc**: ba thao tác phủ gần hết cơ chế của hệ thống, mỗi tầng chỉ tóm 2–4 dòng và trỏ về canonical owner. Nó là bản đồ định tuyến — **không định nghĩa lại** schema, permission hay error code nào; khi có khác biệt, file được trỏ tới luôn thắng.

## ① Sign in

| Tầng | Điều gì xảy ra | Canonical owner |
|---|---|---|
| UX | `AUTH-01` gửi email/password; lỗi credential là thông báo generic không lộ account; email chưa verify chuyển tới `AUTH-05`, xóa password khỏi form, không đưa email vào URL. | [F-AUT-01](design/user-flows.md) |
| HTTP | `POST /auth/sign-in` trả actor + `csrfToken`, set cookie session HttpOnly. Sai credential: `401 UNAUTHENTICATED`; chưa verify: `403 EMAIL_VERIFICATION_REQUIRED` — envelope chuẩn, **không set cookie/CSRF**. Rate limit `429` + `Retry-After`. | [Endpoint contracts](api/endpoint-contracts.md), [API conventions](api/api-conventions.md) |
| Authz/Session | Session là opaque ID rotate mỗi lần sign-in, chỉ hash được lưu; `SessionGuard` lookup mỗi request. Mọi mutation browser sau đó cần `X-CSRF-Token` session-bound. Lý do chọn thay JWT: [ADR-0003](decisions/ADR-0003-opaque-session-authentication.md). | [Authentication](security/authentication.md) |
| Use case / transaction | Verify Argon2id, tạo session mới; password reset (luồng chị em) thay hash và **revoke mọi session trong cùng transaction**. | [Authentication](security/authentication.md) |
| Schema | `users` (hash + token hash một lần), `auth_sessions` (`session_token_hash UNIQUE`, `revoked_at`); lookup qua index unique. | [Database design](data/database-design.md) |
| Chế độ thất bại | Session hết hạn giữa chừng → `SYS-02`, dừng mutation, xóa cache private; token reset/verify replay → validation error an toàn. | [F-AUT-01](design/user-flows.md), [interaction specifications](design/interaction-specifications.md) |

## ② Move task

| Tầng | Điều gì xảy ra | Canonical owner |
|---|---|---|
| UX | Owner/Editor kéo bằng chuột/bàn phím (Viewer không có drag handle); card đặt vào chỗ mới lạc quan, nhãn "Đang đồng bộ", snapshot để hoàn nguyên. | [Interaction specifications §1–2](design/interaction-specifications.md), [F-TSK-03](design/user-flows.md) |
| HTTP | `POST /tasks/:taskId/move` với `{ destinationColumnId, targetPosition, expectedVersion, reviewerId? }`, kèm CSRF + `Idempotency-Key` (retry replay outcome; retry đồng thời: `409 IDEMPOTENCY_IN_PROGRESS`). | [Endpoint contracts](api/endpoint-contracts.md), [pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md) |
| Authz | `SessionGuard → ResourceProjectResolver → ProjectPermissionGuard` với action `task:move`; ID ngoài scope nhìn thấy trả `404` (không xác nhận project khác tồn tại), member thiếu quyền trả `403`. | [Authorization model](security/authorization-model.md) |
| Use case / transaction | Transaction riêng: re-check version, lock range ordering hẹp, validate destination active/cùng project + reviewer nếu cột yêu cầu; tính fractional position (spacing 1024), rebalance khi gap < 10⁻⁶; ghi đúng một `task.moved` **trong cùng transaction** qua ActivityRecorder port. | [Query and index policy](data/query-and-index-policy.md), [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md), [ADR-0005](decisions/ADR-0005-module-dependency-and-activity-boundary.md) |
| Schema | Composite FK `(project_id, column_id) → board_columns(project_id, id)` chặn cross-project ngay tại DB; `UNIQUE (project_id, column_id, position)` DEFERRABLE; `version` của task được move tăng đúng một — các row bị rebalance không đổi `version`/`updated_at`. | [Database design](data/database-design.md), [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md) |
| Chế độ thất bại | `expectedVersion` stale → `409 TASK_VERSION_CONFLICT` + `details.currentVersion`, không activity; UI hoàn nguyên snapshot, mở `SYS-04`, không force move. Refetch trả version cũ hơn không ghi đè state đã xác nhận (version guard). | [Pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md), [interaction specifications §2, §5](design/interaction-specifications.md) |

## ③ Log work và approve (Phase 1.3)

| Tầng | Điều gì xảy ra | Canonical owner |
|---|---|---|
| UX | `WTL-02` chọn task/ngày/số phút; task không giao cho mình bắt buộc lý do hỗ trợ. CTA sửa/gửi/duyệt của **từng dòng** lấy từ capabilities per-record; author không bao giờ thấy CTA duyệt log của mình. | [Interaction specifications §10](design/interaction-specifications.md), [screen inventory](design/screen-inventory.md) |
| HTTP | `POST /projects/:projectId/work-logs`, `PATCH/submit/review /work-logs/:id`, bulk-review per-record kết quả độc lập. Error codes riêng: `TIME_TRACKING_DISABLED`, `WORK_LOG_DAILY_LIMIT_EXCEEDED`, `WORK_LOG_SELF_REVIEW_FORBIDDEN`… | [Endpoint contracts](api/endpoint-contracts.md) |
| Authz | `work-log:review`/Editor `time-report:read` không phải quyền theo role thuần: cần record `ProjectTimeApprover` hiện hành; self-review bị từ chối kể cả Owner; Workspace Admin không là member đứng ngoài mọi route. | [Authorization model — Time Tracking conditions](security/authorization-model.md) |
| Use case / transaction | Create/update/resubmit lấy **advisory transaction lock** theo `(project_id, logged_by_user_id, work_date)`, sum log active, validate tổng ≤ 1.440 phút rồi conditional write cùng transaction — invariant cross-row không tin client aggregate. Backfill window/override validate trong cùng transaction. | [Query and index policy](data/query-and-index-policy.md) |
| Schema | 4 bảng Phase 1.3; `UNIQUE(project_id, task_id, logged_by_user_id, work_date)`; composite FK same-project cho task/author; lifecycle `draft → submitted → approved\|rejected`, self-close đi thẳng approved với `approval_kind=self`. | [Database design](data/database-design.md), [domain model — trạng thái](data/domain-model.md), [ADR-0002](decisions/ADR-0002-project-time-tracking-and-approval.md) |
| Chế độ thất bại | Hai request đồng thời vượt 1.440 phút: advisory lock tuần tự hóa, một commit một bị reject. Version stale/status đã đổi → `409` an toàn, không activity; bulk review không all-or-nothing. | [Failure experiment](product/delivery-roadmap.md), [pagination/concurrency/idempotency](api/pagination-concurrency-idempotency.md) |
