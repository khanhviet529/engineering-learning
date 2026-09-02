# Chiến lược kiểm thử Flowboard

Tài liệu này xác định trách nhiệm kiểm thử trước khi Flowboard có runtime. Nó cụ thể hóa Section 11 của [baseline đã phê duyệt](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md), [API conventions](../api/api-conventions.md), hợp đồng [concurrency và idempotency](../api/pagination-concurrency-idempotency.md), và [authorization test matrix](../security/authorization-test-matrix.md). Không một lớp test nào thay thế lớp khác.

## Mục tiêu và nguyên tắc

- Kiểm thử behavior và invariant của use case cụ thể; không kiểm thử một generic CRUD surface không tồn tại trong MVP.
- Giữ test gần owner: domain/module test ở API module, component/feature test ở web feature, còn journey xuyên app nằm ở E2E.
- Test phải độc lập, tạo fixture riêng và không phụ thuộc thứ tự. Integration/E2E dùng database và namespace dữ liệu tách biệt để có thể chạy song song.
- Mỗi lỗi trả về phải giữ envelope đã công bố, gồm `requestId`; test không chấp nhận stack trace, SQL, token, session value hay existence signal của private project.
- Test chứng minh side effect lẫn response: mọi deny, validation failure, idempotent replay và stale conflict phải xác nhận không có mutation hoặc `ActivityLog` ngoài outcome được phép.

## Trách nhiệm theo lớp

| Lớp | Owner và môi trường | Chứng minh | Không thay thế |
|---|---|---|---|
| Unit | Module domain, policy, Zod schema, mapper và shared primitive có contract hẹp; Vitest | permission mapping, allowlist, canonicalization, error mapping, cursor codec, requestId normalization | transaction, SQL scope hay browser journey |
| Integration | Nest use case/repository với PostgreSQL thật; Vitest | transaction, project-scoped query, migration compatibility, pagination, idempotency, session/CSRF guard và optimistic concurrency | accessibility, browser cookie behavior hay drag interaction hoàn chỉnh |
| E2E | Next.js + API + PostgreSQL trong topology CI; Playwright | journey chính, cookie/session, role affordance, network/error/conflict recovery, keyboard và pointer drag | toàn bộ matrix SQL/guard branch |
| Contract | API build/OpenAPI và HTTP fixture | path, schema, status, error-code variant, `X-Request-Id`/envelope | business invariant chưa được endpoint công bố |
| Failure experiment | environment không-production, tách dữ liệu | graceful degradation, rollback, timeout và recovery runbook | test thường xuyên của pull request |

## Authorization là quality gate bắt buộc

[Authorization test matrix](../security/authorization-test-matrix.md) là nguồn đầy đủ của role/action coverage. Unit test phải đánh giá mọi cell Allow/Deny; integration và E2E phải chọn các đường đi có rủi ro cao để chứng minh frontend không phải authorization boundary.

Fixture chuẩn có một workspace và hai private project:

- Project B có `Owner`, `Editor`, `Viewer` và User B là Owner/owner của resource mục tiêu.
- Một Workspace Admin không có `project_members` row cho Project B.
- User A là Owner của private Project A trong cùng workspace nhưng không có membership Project B.

Tối thiểu phải có các test sau:

| Test | Lớp tối thiểu | Expected result |
|---|---|---|
| Full role matrix | Unit | `AuthorizationService.can` khớp từng ô; Workspace Admin không tự có project permission. |
| Direct HTTP của Viewer | Integration | Mọi mutation Project B bị `403`, không có mutation hay activity row. |
| User A/User B ID substitution | Integration và một E2E journey | User A dùng task/comment/column/report ID của User B nhận `404`, không có data, count hoặc existence signal. |
| Parent/child không khớp | Integration | Parent ID client không override ownership đã resolver xác định; request bị deny trước repository mutation. |
| Capability affordance | E2E | UI dùng `can(action, resource)` để ẩn/disable control nhưng API vẫn là quyết định cuối cùng. |
| Response field exposure | Contract và integration | Denied envelope không chứa protected data; success chỉ có projection được endpoint cho phép. |

Các regression về opaque session, cookie production, CSRF, token one-time/expiry và rate limit được thực hiện theo cùng matrix. Fixture và log assertion không được lưu raw cookie, password, CSRF, reset/verification token hoặc hash của chúng.

### Ma trận phái sinh không được trôi khỏi catalog

Ma trận visibility theo role trong `design/screen-inventory.md` và `design/information-architecture.md` là **phái sinh** của permission catalog ([authorization model](../security/authorization-model.md)); khi lệch, catalog thắng. Để chống trôi âm thầm: dùng lại fixture/cấu trúc của [authorization test matrix](../security/authorization-test-matrix.md), thêm assertion rằng **không affordance nào trong ma trận visibility cấp một action mà catalog Deny** cho role tương ứng (ví dụ Viewer không bao giờ có drag handle vì `task:move` Deny; Workspace Admin chưa là member luôn về Forbidden/404). E2E capability-affordance test hiện có là nơi thực thi; thay đổi permission chưa xong khi hai ma trận phái sinh chưa được re-check.

## Concurrency, transaction và retry

Integration test phải dùng PostgreSQL và transaction thực; mock repository không đủ để chứng minh atomicity.

| Case | Thiết lập | Expected result |
|---|---|---|
| Stale task update | Hai request đọc cùng version; request đầu commit trước, request sau gửi `expectedVersion` cũ. | Request sau là `409 TASK_VERSION_CONFLICT` với chỉ `currentVersion` an toàn; Task không bị overwrite và không có activity mới. |
| Task move transaction | Move tới active column cùng project với `expectedVersion` hợp lệ; kiểm tra column, ordering, version và activity trong một commit. | Task đổi `columnId`/`position`, version tăng đúng một, có đúng một `task.moved`; lỗi ở bất kỳ invariant nào rollback toàn bộ. |
| Cross-project move/assignment | Dùng destination column hoặc assignee từ Project A. | Reject trước commit; không có cross-project write hay activity. |
| Idempotent retry | Gửi lại cùng route, actor, canonical request fingerprint và `Idempotency-Key`. | Replay outcome đã lưu, không tạo duplicate task/comment/activity. Cùng key với fingerprint khác trả `409 IDEMPOTENCY_KEY_REUSED`. |
| Cursor scope | Dùng cursor của column/project/query khác. | `400 VALIDATION_FAILED`; không đọc sang scope khác. |

E2E thêm journey conflict: UI giữ local draft/snapshot, rollback optimistic move khi stale `409`, tải lại dữ liệu được phép đọc và không force/auto-merge/auto-retry stale write.

## Failure experiments và recovery checks

Failure experiment chỉ chạy trên local/CI hoặc environment non-production được cô lập. Nó có owner, thời hạn, dữ liệu disposable, expected signal và cleanup; không biến thành chaos testing production ngẫu hứng.

- PostgreSQL unavailable khi startup hoặc trong request: readiness trở thành không sẵn sàng, API trả error an toàn với `requestId`, không partial-commit mutation.
- Mailpit/SMTP local unavailable: flow email báo failure an toàn, không lộ token hoặc account existence và có log correlation để điều tra.
- Timeout/client retry: idempotent mutation không duplicate side effect.
- Migration fail hoặc restore drill fail: pipeline/deploy dừng; runbook được cập nhật trước lần thử tiếp theo.
- Khi Phase 1.2 tồn tại, worker restart, Redis unavailable, retry exhaustion và duplicate delivery là các experiment riêng cho job idempotency; chúng không thuộc MVP hiện tại.

## Quality gate và bằng chứng

Mỗi pull request phải chạy format, lint, typecheck, unit, integration, build, E2E và API contract checks theo [CI/CD](ci-cd.md). Thay đổi permission, session/CSRF, scope query, task move, idempotency, error envelope hoặc migration không được merge khi thiếu test phù hợp ở các lớp nêu trên.

Trước release, lưu artifact CI gồm kết quả test, OpenAPI lint/breaking-change result, image digest và migration review. Incident/recovery test lưu thời điểm, phạm vi, kết quả restore và hành động follow-up, không lưu secret hay production personal data trong test artifact.
