# ADR-0009: Liên kết bằng chứng của Task và định dạng comment

- Status: Accepted
- Date: 2026-09-03
- Accepted: 2026-09-03
- Related docs: [database design](../data/database-design.md), [endpoint contracts](../api/endpoint-contracts.md), [API conventions](../api/api-conventions.md), [query and index policy](../data/query-and-index-policy.md), [design system](../design/design-system.md), [vision and scope](../product/vision-and-scope.md)

## Context

Đợt design 03/09 render trước hai thứ rồi tự đánh dấu "đang chờ hợp đồng" thay vì tự quyết — đúng kỷ luật:

1. Trường **`Liên kết bằng chứng`** ở `TSK-01 Task Form` và hàng `BẰNG CHỨNG` ở `TSK-02 Task Detail`.
2. **Toolbar định dạng cơ bản** cho comment composer.

Cả hai là câu hỏi contract, không phải chi tiết trình bày: (1) cần cột, allowlist update, validation URL; (2) quyết định hình dạng nội dung comment và bề mặt XSS. `product/vision-and-scope.md` liệt kê **attachments** là non-goal — nhưng một *liên kết* không phải attachment: không upload, không storage, không AV scan, không quota. Phân biệt này là lý do đề xuất (1) admissible mà không phá non-goal.

Bên design đã **bác** rich text HTML đầy đủ cho comment với lý do `comments.body` là plain text immutable và HTML mở bề mặt XSS. Lập luận đó đúng và ADR này giữ nguyên kết luận.

## Decision

### 1. `tasks.evidence_url text NULL`

- Validation server: URL tuyệt đối, **chỉ scheme `https`** (từ chối `http` để không hợp thức hoá bằng chứng qua kênh không mã hoá, và từ chối tuyệt đối `javascript:`, `data:`, `file:`), độ dài tối đa 2048, một URL duy nhất — không phải danh sách, vì danh sách là bảng mới cộng thứ tự cho một nhu cầu chưa chứng minh được.
- **Server không bao giờ fetch URL này.** Không preview, không unfurl, không kiểm tra liveness, không resolve redirect — bất kỳ hành vi fetch nào biến field do người dùng nhập thành SSRF vector nhắm vào mạng nội bộ. Client cũng không auto-fetch preview; nó render link với `rel="noopener noreferrer"` và hiển thị host để người đọc thấy đích trước khi bấm.
- Thêm `evidence_url` vào allowlist của task create và task update, cạnh `title`, `description`, `assignee_id`, `reviewer_id`, `category`, `priority`, `start_date`, `due_date`; projection là `evidenceUrl`. Thay đổi đi qua `task:update` như mọi field nội dung khác — **không thêm permission mới**; `409 TASK_VERSION_CONFLICT` và `Idempotency-Key` áp dụng như cũ; activity là `task.updated`.
- **Optional, không bắt buộc** — kể cả khi move vào column `requires_reviewer = true`. Bên design đề nghị bắt buộc ở cột review; ADR này không làm vậy vì nó thêm một nhánh chặn move mới cùng error code mới, trong khi bằng chứng hợp lệ có thể nằm ở comment hoặc một buổi demo. Nếu review workflow thật sự cần cưỡng chế, đường đúng là cờ `board_columns.requires_evidence` do Owner cấu hình — quyết định riêng, ADR riêng.
- Không index: `evidence_url` không phải filter, không phải sort, không search.

### 2. Comment giữ plain text; định dạng là hợp đồng render, không phải hợp đồng lưu trữ

- `comments.body` **không đổi**: `text`, immutable, không `updated_at`. Không cột mới, không bảng mới, không schema change nào cho phần này.
- Composer có thể có toolbar, nhưng nó chỉ chèn **cú pháp Markdown** vào chính plain text mà người dùng gửi. Server lưu **đúng** những gì người dùng gõ: không normalize, không sanitize-rồi-lưu, không chuyển sang HTML.
- Client render một **subset Markdown đóng, allowlist tường minh**: bold, italic, inline code, fenced code block, unordered list, ordered list, link. **Không** raw HTML passthrough, **không** image, table, embed, heading, blockquote hay autolink của scheme lạ. Link chỉ nhận `https`, `http`, `mailto` và luôn có `rel="noopener noreferrer"`.
- Vì body là plain text, một client không render Markdown sẽ hiển thị ký tự cú pháp thô — degrade như vậy là **chấp nhận được** và chính là lý do quyết định này an toàn: không có dữ liệu dẫn xuất nào được lưu, không có cache HTML để invalidate.
- Không mention hay notification (notification vẫn là non-goal), không emoji picker như một contract, không sửa comment (immutable giữ nguyên).

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| `evidence_url` một trường, https-only, server không fetch (chọn) | Đáp ứng nhu cầu "chứng minh đã làm" với chi phí gần bằng không; không đụng non-goal attachments; không mở bề mặt SSRF. | Không kiểm được link còn sống hay trỏ đúng; chỉ một URL mỗi task. |
| Bảng `task_evidence` nhiều link có thứ tự | Nhiều bằng chứng, có nhãn. | Bảng cộng ordering cộng phân trang cộng activity cho từng link, cho một nhu cầu chưa được chứng minh. |
| Bắt buộc evidence khi vào cột `requires_reviewer` | Kỷ luật review mạnh hơn. | Thêm nhánh chặn move và error code; bằng chứng có thể không phải URL; ghép hai quyết định vào một ADR. Để dành cho `requires_evidence`. |
| Upload attachment thật | Người dùng mong đợi. | Non-goal tường minh của baseline: cần storage, quota, AV, signed URL, retention — một phase riêng. |
| Comment rich text lưu HTML (design đã bác, ADR giữ) | WYSIWYG quen tay. | Bề mặt XSS; phải sanitize cả khi lưu và khi render; phá tính immutable/plain text; export và activity phải xử lý HTML. |
| Server render Markdown sang HTML rồi lưu | Client nhẹ. | Lưu dữ liệu dẫn xuất, phải invalidate khi renderer đổi, vẫn cần sanitizer — tệ hơn cả hai đầu. |

## Consequences

- Migration additive một cột nullable; cập nhật `data/database-design.md` bảng `tasks`, `api/endpoint-contracts.md` create/update body và task projection, `data/query-and-index-policy.md` task update allowlist, `design/design-system.md` bỏ nhãn chờ hợp đồng cho hai mục này.
- Test bắt buộc: `http://`, `javascript:`, `data:` và URL dài quá 2048 bị reject bằng `400 VALIDATION_FAILED`; server **không phát sinh request ra ngoài** khi lưu `evidence_url` — test này là bằng chứng không có SSRF; renderer Markdown từ chối `<script>`, `<img onerror=...>`, link scheme `javascript:` và HTML thô trong body comment.
- Frontend nhận một dependency renderer có cấu hình allowlist; cấu hình đó là contract, không phải tuỳ chọn của từng component.
- Không đổi: permission catalog, error envelope, cursor/fingerprint, tính immutable của comment, non-goal attachments.

## Revisit When

- Review workflow cần bằng chứng bắt buộc, dẫn tới ADR cho `board_columns.requires_evidence`.
- Có nhu cầu nhiều bằng chứng cho một task, dẫn tới ADR cho bảng `task_evidence`.
- Attachments trở thành một phase: đánh giá lại quan hệ giữa link và file đính kèm.
- Có mention hoặc notification: quyết định lại cú pháp và bề mặt render của comment.
