# Pagination, concurrency và idempotency của Flowboard

Tài liệu này chuẩn hóa list/mutation behavior cho các use case ở [endpoint-contracts.md](endpoint-contracts.md). Nó triển khai các rule từ [query-and-index-policy.md](../data/query-and-index-policy.md) và [domain-model.md](../data/domain-model.md), không mở rộng thành generic data API.

## Pagination cursor

Mọi list endpoint có `limit` default **25**, maximum **100**. `limit` phải là integer trong `1..100`; API không clamp im lặng. Response JSON thành công luôn có:

```json
{
  "data": {
    "items": [],
    "page": {
      "nextCursor": "opaque-url-safe-value-or-null",
      "hasMore": true
    }
  },
  "requestId": "01J..."
}
```

Cursor là URL-safe opaque value do server phát hành và chống sửa đổi. Nó chứa schema version, canonical-query fingerprint, last sort key(s) và `id` tie-breaker tối thiểu để seek; client không parse, tạo, sửa, dùng như database ID hoặc thay bằng page-number/offset. Cursor invalid, forged, hết hạn theo codec policy, hoặc không khớp fingerprint trả `400 VALIDATION_FAILED`.

Fingerprint bind vào actor-visible project scope, `columnId` khi có, `sprintId` khi có (Phase 1.4), canonical filters, sort direction và search. Đổi `projectId`, `columnId`, filter, sort hay search phải bỏ cursor và tải trang đầu; cursor của column A không hợp lệ cho column B. Mọi order kết thúc bằng `id` theo cùng direction để không lặp/mất item khi seek.

## Task list: query allowlist tuyệt đối

`GET /projects/:projectId/tasks` chỉ nhận query sau, ngoài `cursor` và `limit`:

- `columnId`: UUID của active/same-project column khi lọc board.
- `assigneeId`: UUID project member; không có filter người ngoài project.
- `priority`: priority value do task use case cho phép; client không truyền arbitrary operator.
- `category`: fixed task category allowlist; không phải custom label query.
- `createdById`, `reviewerId`: chỉ ProjectMember cùng project; không nhận arbitrary user scope.
- `dueState`: server-derived enum `none|scheduled|due_soon|due_today|overdue`; client chỉ filter exact allowlisted value, không gửi biểu thức ngày/SQL.
- `dueFrom`, `dueTo`: `YYYY-MM-DD`, với `dueFrom <= dueTo`.
- `sort`: đúng một trong `position:asc|desc`, `createdAt:asc|desc`, `updatedAt:asc|desc`, `dueDate:asc|desc`.
- `search`: plain text chỉ trên `title` và `description`, dùng server-side fixed full-text expression; không có raw `tsquery`, fuzzy/ranking hay search tenant-wide.

`position` chỉ hợp lệ khi có `columnId`; không có `columnId` thì reject vì position chỉ có nghĩa trong column. Không có `columnId`/`sort` dùng `createdAt:desc` rồi `id:desc`. Có `columnId` nhưng không `sort` dùng board order `position:asc` rồi `id:asc`. `dueDate` dùng `NULLS LAST` rồi ID tie-breaker. Không tồn tại `fields`, `include`, `where`, `operator`, `sortBy`, SQL hay filter/sort/search field khác.

Board load active columns theo `position:asc, id:asc` và cho **mỗi column** một task page riêng, cùng default/max limit và cursor riêng. Board không fetch toàn bộ task của project lớn. Load-more chỉ thêm task của chính column đó; thay đổi query reset cursor của các column bị ảnh hưởng.

Comments, activity, workspace members, project members và report history (Phase 1.1) cũng dùng `limit`, `cursor`, `items`, `page`, order use-case cố định và project/workspace scope tương ứng; chúng không nhận allowlist task ở trên.

## Optimistic concurrency cho Task

Task create trả `version: 1`. Mỗi `PATCH /tasks/:taskId` hoặc `POST /tasks/:taskId/move` commit thành công tăng `version` đúng một lần. Client phải đọc `version` hiện tại và gửi `expectedVersion` positive integer trong body của cả hai mutation.

```text
client đọc version 7
  -> gửi expectedVersion 7
  -> update/move đầu tiên commit, task thành version 8
  -> update/move stale dùng 7 nhận 409; không có overwrite hay activity row
```

Conditional update/move luôn scope `taskId + projectId + expectedVersion` trong transaction. Nếu không match version, API trả:

```json
{
  "error": {
    "code": "TASK_VERSION_CONFLICT",
    "message": "The task changed before this request could be applied.",
    "details": {
      "currentVersion": 8
    }
  },
  "requestId": "01J..."
}
```

`error.code` là discriminator: ở đúng `TASK_VERSION_CONFLICT`, `details` là object `{ currentVersion }` như ví dụ trên, **không phải** field-error array của `VALIDATION_FAILED`. OpenAPI `oneOf` và client branch theo `error.code` trước khi đọc `details`; client không được dùng `currentVersion` từ bất kỳ error code nào khác.

`currentVersion` là dữ liệu tối thiểu cần cho recovery; nếu actor vẫn có `task:read`, client tải lại task/board hiện tại để review. UI giữ local draft để tham chiếu/copy, rollback optimistic move về snapshot, và yêu cầu người dùng chủ động áp dụng thay đổi trên version mới. Không có `force`, auto-merge, auto-retry stale write hoặc silent overwrite. Nếu quyền đã mất trong lúc reload, response bình thường là `403`/`404`/`401`, không lộ task mới.

`expectedVersion` là precondition, không phải task field editable. `version`, `projectId`, `columnId`, `position`, timestamps và audit fields trong `PATCH /tasks/:taskId` là `400 VALIDATION_FAILED`; move là use case riêng.

## Dedicated task move và ordering

`POST /tasks/:taskId/move` nhận đúng shape:

```json
{
  "destinationColumnId": "column-uuid",
  "targetPosition": "450.0000000000",
  "expectedVersion": 7
}
```

`targetPosition` là giá trị ordering opaque đối với client, chỉ được chấp nhận ở hợp đồng move này. Server validate nó là decimal position có giới hạn, không bao giờ là SQL expression. Transaction kiểm tra `task:move`, resolve task/project, khóa phạm vi ordering source/destination hẹp khi cần, yêu cầu destination column active/cùng project, đổi `columnId`/`position`, tăng version, ghi đúng một activity `task.moved`, rồi commit.

Task and board-column positions use gap/fractional ordering (`numeric(20,10)`, initial spacing 1024, midpoint on insert-between), so ordinary drag-and-drop does not rewrite every row. When the gap between neighbors at the insertion point drops below the 10⁻⁶ threshold, the server runs a controlled rebalance inside the same transaction — rewriting the affected column's positions to multiples of 1024 with locks on affected rows and the position unique constraint set deferred until commit — preserving deterministic order and uniqueness, and returning the committed task/column state. Rationale, precision analysis (`numeric(20,10)` exhausts distinct midpoints after ~43 same-slot halvings from a 1024 gap) and the `DEFERRABLE INITIALLY IMMEDIATE` decision live in [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md). Rebalance writes `position` only: it does **not** increment `version` and does **not** touch `updated_at` of the rewritten rows (only the task actually moved gets its version bump), so open clients receive no false `TASK_VERSION_CONFLICT` and `updatedAt` seek pagination stays stable; other clients see the new positions on their next board load, which is the same staleness window every non-realtime move already has. Rebalance is server behavior, not a public bulk-table reorder API.

`PATCH /columns/:columnId` is limited to the explicit column update/archive contract. `POST /columns/reorder` accepts only one project-scoped ordered column ID list and reassigns server-controlled fractional positions in one owner-authorized transaction; it cannot move tasks or update arbitrary column fields.

## Idempotency và retry

`Idempotency-Key` bắt buộc cho các create/action mutation nhạy cảm với retry:

- `POST /auth/sign-up`, `POST /auth/email/verification/resend`, `POST /auth/password/forgot`, `POST /auth/password/reset`;
- `POST /workspaces`, `POST /workspaces/:workspaceId/members`, `DELETE /workspaces/:workspaceId/members/:userId`;
- `POST /workspaces/:workspaceId/projects`, `PATCH /projects/:projectId`, `POST /projects/:projectId/members`, `PATCH /projects/:projectId/members/:userId`, `DELETE /projects/:projectId/members/:userId`;
- `POST /projects/:projectId/columns`, `PATCH /columns/:columnId`, `POST /columns/reorder`;
- `POST /projects/:projectId/tasks`, `PATCH /tasks/:taskId`, `POST /tasks/:taskId/move`, `POST /tasks/:taskId/comments`;
- `POST /projects/:projectId/reports/progress-export` in Phase 1.1;
- `POST /projects/:projectId/work-logs`, `POST /projects/:projectId/work-logs/bulk-review` in Phase 1.3;
- `POST /projects/:projectId/sprints`, `PATCH /sprints/:sprintId`, `POST /sprints/:sprintId/activate`, `POST /sprints/:sprintId/close`, `PATCH /projects/:projectId/sprint-settings` in Phase 1.4.

`POST /auth/sign-in` và `POST /auth/sign-out` cố ý theo session lifecycle thay vì required-key list: sign-in rotate sang session mới và sign-out đã semantically idempotent. Các mutation còn lại trong list phải có key, kể cả PATCH task; authorization và `expectedVersion` vẫn là điều kiện độc lập, không bị key thay thế.

Idempotency store là bảng [`idempotency_records`](../data/database-design.md#idempotency_records): claim `in_progress` được commit **trước** mutation để hai retry đồng thời không cùng thực thi (request đến sau nhận `409 IDEMPOTENCY_IN_PROGRESS` và chờ ngắn rồi gửi lại cùng key), còn outcome `completed` được commit atomically cùng mutation/activity. Transport timeout có thể retry bằng **cùng** key và canonical request chính xác. API replay outcome đã lưu trong 24 giờ; không duplicate user, membership, task, comment, export request, logical action gửi email hay activity row. Ý định mới của user dùng key mới. Key không sửa được `401`, `403`, `404`, validation failure hoặc stale `409`; cần có valid session, sửa request/permission, hoặc reload/review phù hợp trước khi tạo logical operation mới.

## WorkLog cursor, concurrency và bulk review — Phase 1.3

WorkLog cursor fingerprint bind `projectId`, actor-visible scope, `userId`, `taskId`, status, date range, sort/direction. Thay bất kỳ filter nào bỏ cursor cũ. Monthly aggregate không dùng cursor để bỏ qua row; drilldown quay lại WorkLog list với canonical filters mới.

`PATCH /work-logs/:workLogId`, submit và review mang `expectedVersion`. Server conditional update theo project scope/version; version mismatch, status không còn `submitted`, hoặc reviewer vừa mất capability trả `409` safe code/current version, không có ActivityLog success. Daily duration mutation đồng thời serialize bằng advisory lock project/user/workDate trước sum/validate/write.

Bulk review có `Idempotency-Key` cho toàn request và `expectedVersion` cho từng item. Replay cùng key/canonical body trả cùng danh sách kết quả; một item conflict/denied không rollback item khác đã commit. Client chỉ toast kết quả tổng quát, còn row lỗi hiển thị trạng thái/reason riêng để không tuyên bố duyệt toàn bộ sai.
