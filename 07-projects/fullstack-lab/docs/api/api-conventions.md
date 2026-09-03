# Quy ước API Flowboard

Tài liệu này là hợp đồng HTTP chung cho Flowboard. Các route cụ thể nằm ở [endpoint-contracts.md](endpoint-contracts.md); cursor, optimistic concurrency và retry nằm ở [pagination-concurrency-idempotency.md](pagination-concurrency-idempotency.md). Quy tắc dữ liệu và quyền được kế thừa từ [query-and-index-policy.md](../data/query-and-index-policy.md) và [authorization-model.md](../security/authorization-model.md).

## Phạm vi và nguyên tắc

- Route công khai biểu đạt một **use case** sản phẩm. Chúng không ánh xạ trực tiếp tới PostgreSQL table hay repository method.
- Mỗi controller nhận request schema hẹp, do module sở hữu, và trả response schema hẹp. Field không có trong schema là lỗi validation; không có mass assignment hay `include`, `fields`, `table`, `column`, SQL, filter operator hoặc sort expression do client chọn.
- Đường dẫn trong tài liệu là route path chuẩn. OpenAPI là nguồn máy đọc của các path, method, schema và status đã công bố; nó không biến MVP thành public API cho bên thứ ba.
- Mọi endpoint project-data xác thực session, resolve resource về project, kiểm tra action, rồi mới dùng repository query/mutation đã scope `projectId`. ID chỉ là locator, không phải bằng chứng có quyền.
- Mọi mutation browser có session phải gửi `X-CSRF-Token` hợp lệ và origin được phép. Cookie session opaque không được đưa vào JSON response.

## JSON, tên field và thời gian

Request/response dùng `application/json; charset=utf-8`, object field `camelCase`, UUID ở dạng string và enum string lowercase khi enum đã được hợp đồng xác định. Database `snake_case` không lộ thành API contract.

- Instant (`createdAt`, `updatedAt`, `archivedAt`, `expiresAt`) là chuỗi RFC 3339 UTC, ví dụ `2026-09-01T08:30:00Z`.
- `dueDate` là `YYYY-MM-DD` hoặc `null`: đó là ngày theo timezone workspace, không có time-of-day.
- `null` chỉ dùng cho field nullable đã công bố, như `assigneeId`, `dueDate`, `archivedAt` và `nextCursor`. Client không gửi `undefined` như một giá trị JSON.
- Payload không bao giờ chứa password hash, raw/hashed session ID, CSRF secret, reset/verification token hash, storage key, audit payload nội bộ hay dữ liệu/count của project không được phép.

## Envelope thành công

Mọi response JSON thành công có envelope sau; `requestId` cũng xuất hiện trong header `X-Request-Id`.

```json
{
  "data": {},
  "requestId": "01J..."
}
```

`204 No Content` không có body nhưng vẫn gửi `X-Request-Id`. Response list đặt `items` và `page` bên trong `data`, không ở top-level. File download là ngoại lệ có body binary và header `X-Request-Id`, không có JSON envelope.

## Envelope lỗi

Mọi lỗi JSON, kể cả lỗi do guard trước use case, dùng một shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "expectedVersion",
        "code": "required",
        "message": "expectedVersion is required."
      }
    ]
  },
  "requestId": "01J..."
}
```

`error.code` là discriminator của error envelope. `details` là dữ liệu cấu trúc tùy chọn, an toàn và phụ thuộc `error.code`; nó không phải một object generic mà client tự đoán shape. Hai variant đã công bố là:

- `VALIDATION_FAILED` luôn dùng `details` là **field-error array**. Mỗi phần tử có `{ field, code, message }`; `field` là JSON field/path của request, không phải tên cột database.
- `TASK_VERSION_CONFLICT` luôn dùng `details` là **object** `{ "currentVersion": positiveInteger }`, không phải field-error array. Object này cho client biết bản task nào cần tải/review lại.

Các error code khác không có `details` trừ khi contract của code đó công bố một variant an toàn riêng. Lỗi không trả stack trace, SQL, token, policy nội bộ, resource bị từ chối hay existence signal của private project.

Client xử lý discriminated theo `error.code`, không theo HTTP status hoặc `typeof details`:

```text
VALIDATION_FAILED     -> render field-error array cạnh form/query tương ứng
TASK_VERSION_CONFLICT -> đọc details.currentVersion, reload/review task; không force overwrite
EMAIL_VERIFICATION_REQUIRED -> không đọc details, xóa password, đưa user tới email verification/resend; không retry sign-in
mọi code khác        -> dùng message/requestId an toàn; không đọc details chưa được công bố
```

Các outcome chuẩn là:

- `400 VALIDATION_FAILED`: body/query/header không parse được, thiếu field bắt buộc, có field lạ, UUID/date/limit/cursor sai, allowlist bị vi phạm, hoặc invariant nghiệp vụ được biểu diễn an toàn là input invalid. Không ghi mutation hay ActivityLog.
- `401 UNAUTHENTICATED`: không có session opaque hợp lệ, session hết hạn/revoked, hoặc request không xác thực khi endpoint yêu cầu session. API có thể clear stale cookie; frontend chuyển về sign-in và không tự phát lại mutation cũ.
- `403 EMAIL_VERIFICATION_REQUIRED`: sign-in đã xác thực được email/password nhưng email chưa verified. Body là error envelope chuẩn với `error.code` này, safe `message`, `requestId` và không có `details`; không set session cookie/CSRF token hay trả dữ liệu private. Frontend xóa password, chuyển tới email verification và có thể đề nghị resend theo contract riêng; không retry sign-in.
- `403 FORBIDDEN`: actor đã nhìn thấy project/resource theo scope nhưng không có action yêu cầu. Ví dụ Viewer gọi move task. Không có side effect.
- `404 NOT_FOUND`: resource không tồn tại **hoặc** nằm ngoài project scope mà actor được phép nhìn thấy. Đây là response cho ID substitution/cross-project access; không xác nhận private resource tồn tại.
- `409 CONFLICT`: precondition cạnh tranh hoặc invariant trạng thái không thể áp dụng trên bản hiện tại. Task stale phải dùng `TASK_VERSION_CONFLICT` và trả `currentVersion`; chi tiết ở tài liệu concurrency. Không ghi Task hay ActivityLog cho version mismatch. `IDEMPOTENCY_KEY_REUSED` là cùng key với fingerprint khác; `IDEMPOTENCY_IN_PROGRESS` là retry đồng thời khi request gốc cùng key đang chạy — client chờ ngắn rồi gửi lại **cùng key**, không đổi key. Mỗi invariant nghiệp vụ khác dùng một code riêng, và **danh mục đầy đủ mọi `error.code` nằm ở [endpoint contracts](endpoint-contracts.md#danh-mục-error-code)** — một bảng duy nhất, kèm status, có/không `details`, endpoint phát ra và hành vi client. Tài liệu này cố ý **không** nhân bản danh sách đó thành registry thứ hai (nó sẽ trôi); nó chỉ chốt hành vi chung: code nghiệp vụ không có `details`, và client không tự retry mà phải đổi ý định của người dùng. Feature bị tắt theo project (`TIME_TRACKING_DISABLED` ở Phase 1.3, `SPRINT_DISABLED` ở Phase 1.4) được deny **sau** scope resolution để không tiết lộ project private, theo [authorization model](../security/authorization-model.md).
- `429 RATE_LIMITED`: request vượt giới hạn chống abuse; body không tiết lộ account có tồn tại hay không. Response **phải có header `Retry-After`** (số giây nguyên) cho biết khi nào được gửi lại; xem mục Rate limit bên dưới cho phạm vi áp dụng và hành vi client.
- `5xx INTERNAL_ERROR`: lỗi không mong đợi; message an toàn, requestId dùng để tra log. Không coi đây là thành công mutation.

## Rate limit và `Retry-After`

Rate limit tồn tại ở hai nhóm:

1. **Auth endpoint** (sign-in, sign-up, forgot/reset, resend): giới hạn theo client signal và normalized identifier như [authentication](../security/authentication.md) quy định; mục tiêu là chống abuse/enumeration.
2. **Endpoint đắt**: task search (có `search`, đánh GIN index), monthly time aggregate (Phase 1.3), export request (Phase 1.1) và bulk review (Phase 1.3). Giới hạn theo **cặp (authenticated actor, route class)**; các route project-scoped tính thêm project để một actor không dồn toàn bộ quota vào một project. Giá trị khởi điểm — được tune bằng telemetry, không phải cam kết SLA: search 30 request/phút, monthly aggregate 20 request/phút, export request 10 request/giờ, bulk review 12 request/phút.

**Cơ chế ở core MVP: in-process limiter per API instance** (token bucket/fixed window trong bộ nhớ của process). Đây là quyết định có ý thức, KHÔNG đưa Redis vào core MVP; thêm Redis chỉ để đếm request vi phạm quy tắc "chỉ thêm hạ tầng khi behavior cần nó". Kết luận "limiter per-instance = limiter toàn cục" là **có điều kiện single-instance**: nó đúng cho topology local/integration CI hiện tại (Compose, một API instance theo [local development](../operations/local-development.md)); runtime/số instance production **chưa được chọn** ([CI/CD](../operations/ci-cd.md)). Giới hạn được chấp nhận: counter reset khi process restart, và deployment nhiều instance làm quota bị nhân theo số instance — vì vậy chạy nhiều instance (hoặc Phase 1.2 đưa Redis vào vì queue) là điều kiện chuyển limiter sang Redis-backed trong cùng change có ADR, trước khi topology đó nhận traffic thật.

Mọi response `429 RATE_LIMITED` mang `Retry-After` (giây). `409 IDEMPOTENCY_IN_PROGRESS` cũng có thể mang `Retry-After` gợi ý khoảng chờ ngắn. Hành vi client: disable control/submit tương ứng cho tới hết `Retry-After`, hiển thị thông báo an toàn, **không tự retry mutation**; search input tự debounce/throttle để không tạo vòng 429. Chi tiết UI ở [interaction specifications](../design/interaction-specifications.md).

## Request ID và observability

Client có thể gửi `X-Request-Id` theo định dạng opaque hợp lệ. API validate/chuẩn hóa giá trị đó hoặc tạo request ID mới; client không thể ép giá trị log nguy hiểm. API trả cùng ID trong response header và JSON envelope, ghi nó trong structured log, và propagate nó sang worker/report job khi phase có worker. Một `requestId` là correlation ID, không phải idempotency key và không có semantic authorization.

## Xác thực và action permission

Trừ các auth route được ghi rõ là anonymous, endpoint yêu cầu session hợp lệ. Endpoint workspace yêu cầu action workspace tương ứng; endpoint project/column/task/comment/activity/report khai báo đúng action trong permission catalog, ví dụ `task:move` thay vì `task:update`.

Thứ tự thực thi bắt buộc là `SessionGuard` → `ResourceProjectResolver` → `ProjectPermissionGuard`/`AuthorizationService.can` → validation use case → repository đã scope. Client-supplied `projectId` trong body không thể đổi owner của `taskId`, `columnId`, `commentId` hay `reportId`. Response project trả capabilities do server tính cho chính actor/project để frontend gọi `can(action, resource)`; capability chỉ là affordance, không thay quyết định server.

## Idempotency key

Các mutation được liệt kê trong [pagination-concurrency-idempotency.md](pagination-concurrency-idempotency.md) gửi header `Idempotency-Key`: string opaque, high-entropy, do client tạo, một key cho một logical operation. Key không đi trong body, không mang user/resource ID, và được scope tối thiểu theo authenticated actor, route/use case và canonical request fingerprint.

Lần gọi retry có cùng key và cùng fingerprint trả lại outcome đã lưu (status, headers an toàn và response body; `requestId` là của chính request replay) thay vì chạy mutation/activity lần hai. Cùng key nhưng body/fingerprint khác trả `409 IDEMPOTENCY_KEY_REUSED`. Key không thay `expectedVersion`, CSRF, authorization hay validation. Endpoint không yêu cầu key phải từ chối request thiếu key bằng `400 VALIDATION_FAILED` trước use case.

Outcome được lưu trong bảng [`idempotency_records`](../data/database-design.md#idempotency_records) (hash của key, không lưu key thô) theo giao thức claim → mutation → outcome: claim `in_progress` commit trước mutation, rồi mutation + activity + `completed` atomic (transaction outcome thứ ba chỉ chạy khi business failure). Hai retry **đồng thời** cùng key vì vậy không cùng thực thi: request đến sau nhận `409 IDEMPOTENCY_IN_PROGRESS` và retry sau khoảng chờ ngắn; nếu request gốc crash, record `in_progress` quá 60 giây được request sau giành lại an toàn (mutation chưa từng commit). Business failure xác định cũng được lưu và replay như outcome.

## Quy trình OpenAPI contract

1. Module owner viết request schema, response schema, status/error code, permission action và examples cùng endpoint use case; chỉ schema hẹp, không schema table generic.
2. Build API sinh OpenAPI versioned từ các schema/controller đó. Artifact kiểm tra được phải công bố tại `/openapi.json`; UI tài liệu nội bộ có thể render cùng artifact, nhưng không chứa secret/example nhạy cảm. OpenAPI mô hình `error` là discriminated `oneOf` theo property `code`: `VALIDATION_FAILED` yêu cầu field-error array, `TASK_VERSION_CONFLICT` yêu cầu object `currentVersion`, còn code không công bố details không được client ép thành một trong hai shape.
3. CI validate document, lint OpenAPI, phát hiện path/schema breaking change và chạy contract test cho success, validation field-error array, `401`, `403 EMAIL_VERIFICATION_REQUIRED`, `403`/`404`, `409 TASK_VERSION_CONFLICT` object, cùng envelope `requestId`.
4. Thay đổi breaking (đổi/loại field, error code, semantic permission, cursor shape) cần versioning/migration plan và ADR sau baseline. Không âm thầm đổi contract để khớp implementation.
5. OpenAPI, Markdown contract và implementation được review cùng nhau. Markdown giải thích business invariant, authorization và retry; OpenAPI là nguồn chính xác máy đọc. Khi chúng mâu thuẫn, dừng publish và sửa trong cùng change.

## Controlled generic core

Shared HTTP code chỉ sở hữu primitives không có product decision: parser pagination, cursor codec/ký, parser filter-sort allowlist, error mapper/envelope, request-ID propagation, transaction helper, CSRF/idempotency helper và OpenAPI plumbing.

Mỗi module vẫn sở hữu create/update/list-query/response schema, action permission, allowlisted field/filter/sort/search, resource resolver, domain validation, activity event và use case. Cấm các path tương đương `GET /tables/:table`, `POST /tables/:table`, `GET /:table`, `POST /:table`, `PATCH /resources/:id` hoặc endpoint nhận table/field SQL từ client. Những path đó bỏ qua scope project, assignment, immutable history, ordering, concurrency và audit transaction.
