# Xuất báo cáo tiến độ Flowboard

Tài liệu này là hợp đồng cho reporting sau core MVP. Nó kế thừa [lộ trình phát hành](../product/delivery-roadmap.md), [hợp đồng endpoint](../api/endpoint-contracts.md), [mô hình phân quyền](../security/authorization-model.md), [thiết kế dữ liệu](../data/database-design.md) và [operability](../operations/observability.md). Reporting không tạo một đường tắt quanh private project, `report:export`, query đã scope hay Activity Log.

## Ranh giới với Time Tracking Phase 1.3

`report:export` ở Phase 1.1 vẫn chỉ là XLSX tiến độ do Owner request/download. Phase 1.3 thêm màn aggregate giờ tháng đã authorized, không tự thêm XLSX giờ, email, lịch gửi, storage lifecycle, queue hoặc worker. Khi một phase sau cần time export/delivery, nó phải có spec/ADR, capability và contract riêng; không tái sử dụng ngầm `report:export`.

## Ranh giới phase

| Phase | Giá trị sản phẩm | Có | Không có |
|---|---|---|---|
| Core MVP | Hoàn thành vòng lặp quản lý task riêng tư | Web, API, PostgreSQL, Mailpit | Export, `report_exports`, Redis, BullMQ, worker, email delivery |
| 1.1 | Project Owner tải XLSX tiến độ và tự gửi cho manager nếu cần | Owner request/download, filter snapshot, file lifecycle, audit/activity | Schedule, automatic email, Redis, BullMQ, `apps/worker`, retry queue |
| 1.2 | Giao report theo yêu cầu hoặc lịch mà web/API phản hồi kịp thời | Redis, BullMQ, worker, retry có giới hạn, durable execution/delivery record, email delivery | Bypass Owner authorization, generic reporting API, Redis như system of record |

Redis, BullMQ và worker chỉ được thêm cùng Phase 1.2 sau ADR/review về queue durability, credentials, recovery, telemetry, failure test và deploy. Không thêm chúng vào Compose, CI hay production chỉ để “sẵn sàng”.

## Quyền, phạm vi và dữ liệu chung

`report:export` là Owner-only. Editor, Viewer và Workspace Admin không phải Project Member bị từ chối; Workspace Admin không có quyền ngầm định vào project riêng tư. Mọi request nhận `projectId` hoặc `reportId` phải đi theo `SessionGuard` → `ResourceProjectResolver` → `ProjectPermissionGuard` → validation → repository query đã scope. Report/project ngoài phạm vi trả `404` và không để lộ existence, snapshot hay metadata.

Filters chỉ là subset task-filter canonical đã allowlist và phải thuộc project được resolve. Client không gửi raw SQL, table, column, storage key, status, project owner, recipient privilege hay file URL. `report_exports.filter_snapshot` giữ bản filter đã validate, bất biến theo request; thay đổi filter sau đó tạo export khác, không sửa snapshot cũ.

Mỗi export có một `report_exports` record Phase 1.1 với `project_id`, `requested_by_user_id`, `filter_snapshot`, status, file metadata, `expires_at`, timestamps và server-only `file_storage_key` theo [database design](../data/database-design.md). PostgreSQL là source of truth cho export/business audit. Redis job state không thay thế record này, Activity Log hay audit record.

## Phase 1.1 — Owner tải XLSX

### Request và idempotency

`POST /projects/:projectId/reports/progress-export` yêu cầu session, CSRF, `report:export` và `Idempotency-Key`; response `202` trả `{ id, projectId, status: "requested", expiresAt, createdAt }`. Cùng key, cùng actor và cùng canonical request phải trả cùng kết quả export thay vì tạo bản thứ hai. Cùng key với payload khác bị từ chối theo [idempotency contract](../api/pagination-concurrency-idempotency.md); key không là authorization claim và không được dùng làm ID report.

Trong một transaction ngắn, use case resolve/authorize project, validate và snapshot filter, tạo `report_exports` với `requested`, và append `report_export.requested` Activity Log/audit event. Transaction commit trước khi tạo file; generation không được giữ database transaction mở. Request bị reject hoặc rollback không tạo export hay activity.

Phase 1.1 không đòi queue. Cơ chế generation phải chỉ dùng capability đã được duyệt cho phase này, cập nhật trạng thái trong transaction riêng và không kéo Redis/BullMQ/worker vào MVP. Khi thành công, server ghi file metadata rồi chuyển `requested → ready`; khi lỗi không recoverable, ghi safe error code và chuyển `requested → failed`. Không ghi raw query, credential, path nội bộ, payload task không cần thiết hay exception vào response/activity.

### Lifecycle tệp và download

```text
requested --generation succeeds--> ready
ready     --expires_at < now()----> (derived: expired — chặn download, không đổi status)
ready     --purge policy 1.2------> purged (file đã hủy vật lý, không đảo ngược)
     |                                      ^
     '--terminal failure--> failed          | (không resurrect export cũ)
```

`GET /reports/:reportId` re-authorize Owner và chỉ trả metadata allowlisted. `GET /reports/:reportId/download` re-authorize lần nữa ngay lúc tải; chỉ `ready` và chưa hết hạn mới stream XLSX với content type/disposition an toàn. `requested` hoặc `failed` trả `409 REPORT_NOT_READY`, export hết hạn trả `410 REPORT_EXPIRED`, resource không scope trả `404`. Không trả `file_storage_key`, public URL lâu dài, filter snapshot của project khác hay blob trong JSON.

`expires_at` là hard access boundary và là **nguồn duy nhất của hết hạn logic**: server chặn download bằng điều kiện `expires_at < now()`, không phụ thuộc một status ghi thêm — hai nguồn cho cùng một điều sẽ lệch nhau. Status `purged` chỉ được ghi khi physical file thực sự bị hủy theo retention policy được duyệt (Phase 1.2 trở đi); "expired" trong UI/DTO là trạng thái derived từ `expiresAt`. Row và non-secret snapshot/audit metadata được giữ để chứng minh lifecycle; không tái sử dụng file hết hạn. Mọi request, ready/failed transition, download bị chặn vì hết hạn, và purge outcome phải có audit evidence với `requestId` khi có HTTP request. Owner tự gửi file cho manager; Phase 1.1 không gửi email, không lưu schedule và không delivery tự động.

## Phase 1.2 — delivery bất đồng bộ

### Delivery lifecycle và source of truth

Phase này thêm Redis, BullMQ và `apps/worker` vì generation/delivery có thể tốn CPU hoặc phụ thuộc email provider. API vẫn chỉ authorize, snapshot, persist intent và enqueue sau commit; worker tạo file/gửi mail ngoài HTTP request. Mỗi request hoặc schedule tạo durable execution/delivery record liên kết export, project, requester/schedule owner, immutable input snapshot, current status, attempt count, idempotency key, safe error code, expiry và audit references. Schema chi tiết, recipient policy và queue durability là ADR/migration của Phase 1.2; chúng không được ngầm suy ra từ BullMQ metadata.

```text
accepted -> queued -> running -> generated -> delivering -> delivered
                   |       |                    |
                   |       '-> retry_wait ------'
                   '-> failed | cancelled | expired
```

Status transition dùng compare-and-set/lease do server kiểm soát để worker bị crash hoặc delivery bị replay không tạo duplicate side effect. Job ID ổn định được suy ra từ durable execution/delivery ID; BullMQ chỉ vận chuyển lệnh, không quyết định business status. Worker luôn reload record từ PostgreSQL, kiểm tra expiry/cancellation và scope trước side effect. `requestId` gốc được preserve trong metadata; mỗi execution có job/execution correlation ID riêng, không phải actor ID, permission hay idempotency key.

### Retry, duplicate prevention và expiry

- Retry chỉ dành cho failure tạm thời đã phân loại (ví dụ email provider timeout hoặc Redis/network interruption). Số lần là hữu hạn, backoff có jitter và policy được cấu hình/review; không retry authorization, validation, expired/cancelled input, malformed recipient hay permanent provider error.
- API request idempotency ngăn tạo duplicate export/delivery intent. Stable BullMQ job ID ngăn enqueue trùng. Worker idempotency và durable transition ngăn generate/upload/send lặp khi BullMQ giao at-least-once; email/provider idempotency reference được dùng nếu provider hỗ trợ.
- Delivery chỉ dùng recipient/configuration đã được product/security review và snapshot tại lúc tạo. Không có model, queue payload hay arbitrary request field nào được phép mở rộng recipient hoặc project scope. Trước delivery, worker kiểm tra lại export chưa hết hạn, schedule/request còn active và policy hiện hành; revocation/cancellation thắng retry.
- Hết hạn (`expires_at < now()`) thì delivery/download bị chặn và job đang chờ bị cancel/skip theo điều kiện derived; khi purge policy hủy file vật lý, record export chuyển `purged` với audit outcome. Retry không được làm sống lại export đã hết hạn; cần Owner request mới.

### Authorization, audit và vận hành

Owner authorization được kiểm tra khi tạo request/schedule; worker không mang một “Owner token” để bypass policy. Nó chạy service identity least-privilege, load record theo ID, áp dụng project scope và business policy do server định nghĩa. Mọi request, schedule change, enqueue, attempt, retry, terminal failure, send success/failure, cancel, expiry và manual replay ghi append-only audit evidence; sensitive email/address, provider credential, raw XLSX và raw error không xuất hiện trong Activity Log/telemetry.

Phase 1.2 bổ sung worker health/readiness riêng, bounded queue metrics (depth, oldest age, active/retry/failed/completed, duration, duplicate/replay outcome), alerts và runbook replay/cancellation. CI thêm worker unit/integration/failure tests và image/deployment artifact; recovery phải chứng minh rằng PostgreSQL audit/export state vẫn đúng khi Redis mất dữ liệu. Xem [local development](../operations/local-development.md), [CI/CD](../operations/ci-cd.md) và [observability](../operations/observability.md).

## Điều kiện chấp nhận trước khi mở phase

Phase 1.1 chỉ bắt đầu khi Owner-only HTTP, ID substitution, idempotency, immutable filter snapshot, status transition, expiry/purge và audit tests đều có. Phase 1.2 chỉ bắt đầu khi Phase 1.1 còn đúng và test được crash/replay, duplicate enqueue/delivery, bounded retry, cancellation/expiry, queue outage, recipient policy, telemetry/redaction và recovery. Không có test nào được phép coi một UI affordance, queue state hoặc URL khó đoán là authorization.

## Ghi chú học tập liên quan

- [Export & reporting: CSV, Excel, PDF](../../../../02-backend-api/00-http-api/10-export-and-reporting.md) — streaming, file format và CSV/XLSX safety.
- [NestJS queues and jobs](../../../../02-backend-api/02-nestjs/behavior/07-caching-queues-jobs.md) — queue lifecycle, retry và idempotent worker.
- [Retry and DLQ](../../../../03-database/04-message-queues/03-retry-dlq.md) và [outbox pattern](../../../../03-database/04-message-queues/06-outbox-pattern.md) — failure/replay reasoning.
