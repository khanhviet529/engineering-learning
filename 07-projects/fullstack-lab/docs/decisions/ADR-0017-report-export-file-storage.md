# ADR-0017: File export tiến độ nằm trong PostgreSQL ở Phase 1.1

**Status:** Accepted

**Date:** 2026-09-19

**Owners:** Chủ dự án ký; backend thực thi; tôi giữ hợp đồng và tài liệu.

**Related docs:** [endpoint-contracts.md](../api/endpoint-contracts.md) · [database-design.md](../data/database-design.md) · [local-development.md](../operations/local-development.md) · [implementation-plan.md](../implementation-plan.md) · [ADR-0005](ADR-0005-module-dependency-and-activity-boundary.md)

## Context

M6 thêm `POST /projects/:projectId/reports/progress-export` và `GET /reports/:reportId/download`. `report_exports.file_storage_key` được mô tả là "server-side storage reference, không phải public URL" — nhưng **chưa ở đâu nói cái reference đó trỏ vào cái gì**.

Ba ràng buộc đang có, và chúng loại lẫn nhau:

1. **Topology là đúng bốn service.** `compose.yaml` mở đầu bằng câu đó, và CI có job `topology` đi đếm. Thêm service thứ năm là một thay đổi cần ADR cùng với cập nhật health, backup, telemetry và test **trong cùng một lượt** — cùng lập luận đã hoãn Redis sang Phase 1.2.
2. **Một dòng không được nói sai về chính nó.** Đây là lý do `expired` không phải một status: một status phải có thứ gì chạy để lật nó, và trong khoảng chưa lật thì dòng nói sai. Một dòng `ready` trỏ tới file đã biến mất cũng là dòng nói sai — chỉ là theo cách khó thấy hơn.
3. **Container phải vứt đi được.** `api` được dựng lại mỗi lần `up --build`. Trạng thái đặt trong filesystem của nó là trạng thái mất lúc deploy, và mất **im lặng**.

Phase áp dụng: **1.1**. Vẫn ngoài scope: queue, worker, retry, delivery qua email, và lịch purge tự động — tất cả thuộc Phase 1.2.

Quy mô đang bàn: một project MVP. Một XLSX gồm vài trăm tới vài nghìn dòng task cỡ hàng chục tới hàng trăm KB. Đây là con số ước lượng theo quy mô dữ liệu hiện có, **chưa đo**.

## Decision

**Bytes của file nằm trong PostgreSQL, ở một bảng riêng `report_export_files`, một dòng một file, cột `bytes bytea`.** `report_exports.file_storage_key` giữ nguyên ý nghĩa đã công bố và mang khoá của dòng đó.

Ba ràng buộc thực thi:

- **Bảng riêng, không phải thêm cột vào `report_exports`.** `GET /reports/:reportId` đọc metadata rất nhiều lần trong khi client chờ; nếu bytes nằm cùng dòng thì mỗi lượt đọc đó kéo theo một cột lớn mà PostgreSQL phải bỏ qua, và `SELECT *` của một người viết vội sẽ kéo nó về thật.
- **Không có đường đọc bytes nào ngoài `GET /reports/:reportId/download`.** Bảng này không xuất hiện trong bất kỳ projection nào, không có endpoint list, không có port.
- **`file_storage_key` không được suy ra từ `reportId`.** Nó là giá trị ngẫu nhiên riêng. Lý do: nếu khoá suy ra được thì mọi lỗi kiểm quyền ở tầng trên trở thành một đường đọc file trực tiếp; khoá ngẫu nhiên khiến một sai sót như vậy vẫn cần thêm một lần rò rỉ nữa mới khai thác được.

Chủ dự án đã ký 19/09/2026. Hợp đồng HTTP **không đổi** — `file_storage_key` chưa bao giờ xuất hiện trong response, nên không có migration nào phía client.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| **PostgreSQL `bytea` ở bảng riêng** (chọn) | Không thêm service. Backup và restore đã có sẵn và đã được diễn tập — file đi cùng database, không cần một quy trình khôi phục thứ hai. Xoá file là `DELETE`, nằm trong cùng transaction với việc đổi status, nên không có trạng thái "row nói ready mà file đã mất" | Bytes đi qua bộ nhớ của API khi stream, nên có trần kích thước thực tế. Bloat bảng nếu retention không chạy. Cả hai chấp nhận được ở quy mô Phase 1.1 và **phải đo lại** trước Phase 1.2 |
| **Object storage (MinIO/S3), service thứ năm** | Đúng hình dạng lâu dài; stream không qua bộ nhớ ứng dụng | Phá "đúng bốn service", và kéo theo health check, backup riêng, credential riêng, một đường kiểm quyền thứ hai, và một trạng thái mới: file có mà row không, hoặc ngược lại. Đó là chi phí của Phase 1.2, không phải của một nút bấm tải file |
| **Filesystem của container `api`** | Rẻ nhất để viết | File mất khi `up --build`, và mất **im lặng**: row vẫn `ready`. Vi phạm trực tiếp ràng buộc (2). Thêm volume để cứu thì biến `api` thành container có trạng thái, tức mất tính vứt đi được, mà vẫn chưa giải quyết được chuyện hai nguồn sự thật |
| **Sinh file ngay trong request, không lưu** | Không cần bảng, không cần retention | Phá hợp đồng đã công bố: `202` + ba trạng thái + `REPORT_NOT_READY` + `REPORT_EXPIRED` mô tả một tài nguyên có vòng đời. Bỏ lưu là bỏ luôn idempotency ("cùng key → cùng record") và bỏ `RPT-01` |

## Consequences

**Được.** Số thành phần vận hành không đổi. Retention chỉ là một câu `DELETE`. Không có trạng thái lệch giữa hai kho. Không thêm credential nào vào `.env`.

**Chi phí và rủi ro.** Bytes qua bộ nhớ API khi stream, nên trần là **25 MB** cho một file. Con số đó không nói về giới hạn của `bytea` (lớn hơn nhiều bậc) mà nói về bộ nhớ của một process API đang phục vụ nhiều request. Vượt trần là lỗi ở lúc **sinh** file: status thành `failed`, và `GET /reports/:reportId/download` trả `409 REPORT_NOT_READY` như mọi ca `failed` khác — **không** thêm error code mới, vì với người dùng thì "file không có để tải" là cùng một sự việc dù nguyên nhân khác nhau. Bảng `report_export_files` sẽ phình nếu không có gì dọn; Phase 1.1 chưa có lịch purge tự động, nên `expires_at` chặn được việc **tải**, nhưng **không** làm bytes biến mất. Đó là một khoản nợ có tên, không phải một chỗ bỏ sót.

**Bảo mật.** Đường đọc bytes duy nhất đi qua `GET /reports/:reportId/download`, nơi authorization được kiểm lại tại thời điểm request. `file_storage_key` không bao giờ rời server. `bytea` không xuất hiện trong bất kỳ log nào.

**Cần cập nhật cùng lượt:** `database-design.md` (thêm bảng và index), migration mới, `query-and-index-policy.md` (đường đọc của download), và một dòng nợ trong `implementation-plan.md` cho việc purge.

## Revisit When

- Phase 1.2 mở — lúc đó có worker, và object storage vào cùng với queue chứ không vào trước.
- Kích thước một export vượt trần đã đặt, hoặc `report_export_files` vượt một ngưỡng dung lượng đo được.
- Có yêu cầu product cho phép tải lại export cũ sau nhiều tuần, tức retention dài hơn đáng kể so với `expires_at` hiện tại.

Khi thay thế, tạo ADR mới và đánh dấu ADR này `Superseded`.
