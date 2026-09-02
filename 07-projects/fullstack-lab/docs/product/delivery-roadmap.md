# Lộ trình phát hành Flowboard

## Nguyên tắc phân pha

Lộ trình ưu tiên một vòng lặp quản lý công việc riêng tư, hoàn chỉnh trước khi tăng tự động hóa. Mỗi phase chỉ đưa thêm hạ tầng khi hành vi sản phẩm mới thật sự cần nó. Vì vậy Redis, worker, BullMQ và AI không được thêm sớm chỉ để “sẵn sàng cho tương lai”.

Quyền project vẫn là ranh giới không đổi ở mọi phase: Project Owner, Editor và Viewer là các vai trò cố định; Workspace Admin không có quyền ngầm định với project riêng tư. AI và reporting không được đi vòng qua các ràng buộc này.

## Core MVP — hoàn tất vòng lặp chính

**Mục tiêu sản phẩm:** Owner thiết lập project riêng tư; Editor quản lý task trên board; Viewer review tiến độ và history mà không thay đổi dữ liệu.

| Hạng mục | Phạm vi đã chấp nhận |
|---|---|
| Luồng | Đăng nhập → workspace → project được cấp quyền → cấu hình cột → thêm thành viên project → tạo/giao/di chuyển task → comment và activity history. |
| Quyền | Project private mặc định; Owner/Editor/Viewer thực thi theo từng project; Workspace Admin phải được thêm tường minh trước khi đọc hoặc thay đổi project. |
| Trải nghiệm | Board, task detail, comment, activity; loading, empty, lỗi mạng, conflict và permission-denied states. |
| Tính đúng đắn | Danh sách có giới hạn; task có version để phát hiện cập nhật cũ; không ghi đè âm thầm khi có conflict. |
| Hạ tầng cần thiết | Web app, API, PostgreSQL; môi trường Compose ban đầu có web, API, PostgreSQL và Mailpit để kiểm tra email. |

**Chưa đưa vào:** Redis, worker, BullMQ, export, gửi báo cáo tự động, AI, realtime, custom roles, attachments, billing, mobile và microservices.

**Điều kiện chuyển phase:** Có thể kiểm thử end-to-end vòng lặp của Owner/Editor/Viewer, bao gồm Viewer gọi HTTP trực tiếp bị từ chối, truy cập chéo project bị từ chối và conflict có đường xem lại dữ liệu hiện tại.

## Phase 1.1 — Owner tải export tiến độ

**Mục tiêu sản phẩm:** Chỉ Project Owner có thể yêu cầu và tải báo cáo tiến độ XLSX cho một project. Owner tự gửi file cho manager nếu cần.

| Ràng buộc | Tiêu chí chấp nhận |
|---|---|
| Phạm vi và quyền | Mỗi yêu cầu gắn với đúng project và snapshot filter của request; Editor, Viewer và Workspace Admin chưa là thành viên project không export được. |
| Dấu vết | Yêu cầu export tạo activity/audit record để có thể biết ai đã yêu cầu báo cáo nào. |
| Hành vi | Report có thể được Owner tải xuống; phase này không bao gồm lịch gửi hay email delivery tự động. |
| Hạ tầng | Bổ sung khả năng truy vấn/generates file report và download; không cam kết loại storage hay queue cụ thể ngoài những gì cần cho download. |

**Vì sao chưa cần Redis/worker:** Mục tiêu chỉ là Owner chủ động tải một báo cáo. Khi chưa có delivery bất đồng bộ hoặc lịch chạy, đưa queue vào làm tăng thành phần vận hành mà chưa hoàn tất thêm một nhu cầu người dùng bắt buộc.

## Phase 1.2 — giao báo cáo theo lịch hoặc theo yêu cầu

**Mục tiêu sản phẩm:** Tạo và gửi report theo lịch hoặc theo yêu cầu mà request web/API phản hồi kịp thời.

| Ràng buộc | Tiêu chí chấp nhận |
|---|---|
| Hành vi bất đồng bộ | CPU tạo file và delivery chạy ngoài request; người dùng nhận trạng thái job rõ ràng. |
| Độ tin cậy | Job có trạng thái tường minh, retry có giới hạn, idempotency key, error code, expiry và audit record. |
| Quyền và phạm vi | Report giữ project scope và filter snapshot; yêu cầu/delivery không mở rộng quyền xem project hoặc export. |
| Hạ tầng | Redis và worker riêng dùng BullMQ để xếp hàng, chạy report và delivery; khả năng email delivery xuất hiện tại phase này. |

**Vì sao hạ tầng này xuất hiện ở đây:** Bất đồng bộ, retry và delivery là hành vi cốt lõi của phase; chúng không phải yêu cầu của first vertical slice. Worker tách thời gian tạo file/gửi mail khỏi request và Redis/BullMQ cung cấp queue cần thiết để theo dõi/retry job.

## Phase 1.3 — Time Tracking và duyệt giờ theo project

**Mục tiêu sản phẩm:** Owner có thể bật theo từng project cơ chế ghi giờ thực tế hằng ngày, chọn tự chốt hoặc cần duyệt, và theo dõi tổng giờ tháng trong đúng private-project scope.

| Ràng buộc | Tiêu chí chấp nhận |
|---|---|
| Cấu hình và quyền | Chỉ Owner bật/tắt, chọn mode, đặt backfill 0–31 ngày và chỉ định active Editor làm approver. Workspace Admin không là member không có quyền; Viewer vẫn read-only. |
| Tính đúng đắn | WorkLog gắn user–task–ngày; task date không suy ra giờ; daily total không vượt 1.440 phút; task không giao cho actor cần lý do hỗ trợ. |
| Duyệt | `self_close` tính ngay với nhãn self; `requires_approval` chỉ tính sau approver khác author duyệt. Có duyệt từng log và hàng loạt theo từng kết quả độc lập. |
| Báo cáo | Monthly aggregate chỉ dùng log final đã authorized, tách self-closed/pending/rejected và không tự export/gửi email. |
| Hạ tầng | PostgreSQL/API/web hiện có; không cần Redis, BullMQ, worker, timer background hay provider mới. |

**Vì sao không đưa vào core MVP:** luồng tạo/giao/di chuyển task vẫn hoàn tất khi chưa có timesheet. Time Tracking thêm workflow, approval và dữ liệu audit riêng nên chỉ mở sau khi task/permission/concurrency baseline được kiểm chứng.

## AI-1 — đề xuất task từ mục tiêu Owner

**Mục tiêu sản phẩm:** Owner nhập một mục tiêu; AI tạo các đề xuất task có cấu trúc và không tự ghi thay dữ liệu project.

- Chỉ Owner khởi tạo đề xuất trong phạm vi project được cấp quyền.
- Output được parse, schema-validate và chuẩn hóa như input không tin cậy.
- **Project Owner được ủy quyền phải xác nhận tường minh trước mọi thao tác ghi/thay đổi (mutation/write).**
- Hạ tầng cần: adapter do ứng dụng sở hữu cho model provider, structured-output validation và luồng xác nhận. Không chọn provider cố định trước khi đánh giá chi phí, năng lực, riêng tư và độ trễ.

**Vì sao không sớm hơn:** AI-1 phụ thuộc vào mô hình task và quyền Owner đã ổn định; nó chỉ đề xuất, không thay thế product rules hoặc authorization.

## AI-2 — tóm tắt tiến độ và rủi ro

**Mục tiêu sản phẩm:** Cung cấp tóm tắt tiến độ/rủi ro từ context của đúng một project.

- Server xây context theo project, không chấp nhận phạm vi workspace/project do model tự nêu.
- Theo dõi token, latency và cost cùng thông tin context đã được redaction phù hợp.
- Hạ tầng cần: context builder theo project và observability cho AI; vẫn giữ validation và adapter của AI-1.

**Vì sao sau AI-1:** Tóm tắt chỉ hữu ích khi dữ liệu hoạt động, activity và các giới hạn quyền của core MVP đã đáng tin cậy; telemetry cần có trước khi mở rộng mức sử dụng AI.

## AI-3 — copilot và semantic search theo project

**Mục tiêu sản phẩm:** Trả lời câu hỏi và tìm kiếm ngữ nghĩa trong dữ liệu mà người dùng có quyền đọc ở một project.

- Retrieval bị filter theo project trước khi context được tạo; không có cross-project context.
- Kết quả có citations; hệ thống lưu retrieved IDs, scores và đánh giá để kiểm chứng chất lượng.
- Hạ tầng cần: retrieval/embeddings theo project, citations và evaluation, cùng telemetry AI hiện có.

**Vì sao sau AI-2:** Search/câu trả lời mở rộng bề mặt rò rỉ dữ liệu và đòi hỏi retrieval có ràng buộc, citation và evaluation; không được thêm trước khi pattern context riêng tư đã được xác lập.

## AI-4 — công cụ AI đọc rồi mutation có kiểm soát

**Mục tiêu sản phẩm:** Cho AI gọi một tập action hẹp, bắt đầu bằng read-only và chỉ tiến tới thay đổi dữ liệu khi có kiểm soát đầy đủ.

- Tools nằm trong allowlist hẹp; model không tự chọn user, workspace hoặc project identity.
- Server xác thực quyền và domain state cho từng tool call; model không phải nguồn quyết định quyền.
- Mọi mutation có timeout, xác nhận người dùng và audit; action được giới hạn phạm vi.
- Hạ tầng cần: lớp tools có contract hẹp, authorization phía server, confirmation workflow, audit và observability/evaluation liên tục.

**Vì sao là phase cuối:** Mutation của AI có mức rủi ro cao nhất. Chỉ triển khai khi quyền, audit, retrieval/context, đánh giá và xác nhận đã chứng minh được hoạt động đúng; không có “autonomous admin” hoặc quyền vượt ranh giới project.

## Failure experiment theo phase

Flowboard là một lab: mỗi phase phải kèm ít nhất một failure experiment được tái hiện, quan sát và giải thích, không chỉ một feature "chạy được". Các experiment dưới đây suy ra trực tiếp từ hợp đồng hiện hành; chúng kiểm chứng behavior đã đặc tả, không thêm behavior mới.

| Phase | Failure experiment | Hợp đồng nguồn |
|---|---|---|
| Core MVP | Gửi hai mutation đồng thời cho cùng task với cùng `expectedVersion`: request đến sau nhận `409 TASK_VERSION_CONFLICT` kèm `details.currentVersion`, không có Task hay ActivityLog nào được ghi cho request thua; UI có đường xem lại dữ liệu hiện tại thay vì ghi đè âm thầm. | [Endpoint contracts](../api/endpoint-contracts.md), [pagination/concurrency/idempotency](../api/pagination-concurrency-idempotency.md) |
| Core MVP | Thành viên project A thay ID resource của một private project khác vào URL: server trả `404`, không xác nhận project kia tồn tại; member thiếu quyền trên project nhìn thấy được mới nhận `403`. | [Authorization model](../security/authorization-model.md) |
| Core MVP | Kill API process giữa một mutation transaction: sau khi hệ thống chạy lại, không có partial write — ActivityLog chỉ tồn tại cùng transaction với mutation đã commit. | [Query and index policy](../data/query-and-index-policy.md) (transaction matrix), [testing strategy](../operations/testing-strategy.md) |
| Core MVP | Chèn N task liên tiếp vào cùng một khe (mỗi lần khoảng cách neighbor giảm một nửa) vượt ngưỡng rebalance 10⁻⁶: server rebalance trong cùng transaction, thứ tự giữ nguyên, và **không có unique violation ở mọi mức N** — kể cả N vượt ~43 lần chia đôi làm cạn precision của `numeric(20,10)` nếu không rebalance. | [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md), [pagination/concurrency/idempotency](../api/pagination-concurrency-idempotency.md) |
| Core MVP | Đổi filter/sort của task list rồi tái dùng cursor cũ: cursor sai fingerprint bị từ chối `400 VALIDATION_FAILED` và client quay về page đầu với canonical filters mới. | [Query and index policy](../data/query-and-index-policy.md), [pagination/concurrency/idempotency](../api/pagination-concurrency-idempotency.md) |
| Core MVP | Làm chậm response của filter cũ để nó về SAU response của filter mới (client-side read race): board không hiển thị kết quả của filter cũ vì cache key là canonical fingerprint — response cũ không có chỗ ghi vào; và một refetch trả task `version` thấp hơn không ghi đè state đã được server xác nhận (version guard). | [Interaction specifications](../design/interaction-specifications.md) (mục 2 và 6) |
| Core MVP | Stop rồi start lại container PostgreSQL trong Compose: dữ liệu còn nguyên nhờ named volume; xóa dữ liệu chỉ xảy ra qua lệnh reset tường minh nhắm đúng database/volume. | [Local development](../operations/local-development.md) |
| Core MVP | Seed representative data distribution rồi chạy `EXPLAIN (ANALYZE, BUFFERS)` trước/sau index cho task list query: chứng minh index policy bằng số liệu, không bằng niềm tin. | [Query and index policy](../data/query-and-index-policy.md) (explain-plan verification rule) |
| Phase 1.1 | Gửi lại export request với cùng `Idempotency-Key`, cùng actor, cùng canonical payload: nhận lại cùng export record, không có bản thứ hai; cùng key với payload khác bị từ chối. | [Progress export](../reporting/progress-export.md) |
| Phase 1.2 | Kill worker giữa chừng rồi để BullMQ giao lại job (at-least-once), hoặc enqueue lặp cùng job: status transition compare-and-set/lease và stable job ID bảo đảm generate/gửi mail không lặp side effect; attempt count và audit phản ánh đúng. | [Progress export](../reporting/progress-export.md) |
| Phase 1.2 | Làm Redis/queue unavailable: API request core vẫn phản hồi (liveness không phụ thuộc dependency outage), export job báo trạng thái lỗi an toàn có error code, không mất intent record trong PostgreSQL. | [Progress export](../reporting/progress-export.md) (queue outage gate), [local development](../operations/local-development.md) |
| Phase 1.3 | Gửi hai WorkLog request đồng thời cho cùng `(project, user, work_date)` với tổng vượt 1.440 phút: advisory transaction lock buộc tuần tự hóa, một request commit, request còn lại bị reject validation; daily total không bao giờ vượt 1.440. | [Query and index policy](../data/query-and-index-policy.md), [database design](../data/database-design.md) |
| AI-1 | Ép model trả structured output sai schema hoặc chứa field vượt quyền (`projectId`, role…): output bị reject như untrusted input, không task nào được ghi khi Owner chưa xác nhận tường minh. | Mục AI-1 ở trên, [AI architecture and safety](../ai/architecture-and-safety.md) |
| AI-2 | Yêu cầu tóm tắt "toàn workspace" hoặc project khác qua prompt: context builder phía server vẫn chỉ nạp đúng một project; phạm vi do model tự nêu bị bỏ qua. | Mục AI-2 ở trên, [AI architecture and safety](../ai/architecture-and-safety.md) |
| AI-3 | Semantic search nhắm tới dữ liệu project mà actor không có quyền đọc: retrieval đã filter theo project nên không có kết quả cross-project; citations chỉ trỏ tới retrieved IDs hợp lệ. | Mục AI-3 ở trên, [AI architecture and safety](../ai/architecture-and-safety.md) |
| AI-4 | Cho model đề nghị tool call mutation ngoài allowlist hoặc bỏ qua bước xác nhận: server từ chối theo authorization/confirmation contract và ghi audit; không mutation nào xảy ra chỉ vì model yêu cầu. | Mục AI-4 ở trên, [AI architecture and safety](../ai/architecture-and-safety.md) |

## Definition of done cho mọi phase

Một phase chỉ được coi là hoàn thành khi có đủ:

1. feature chạy được;
2. test cho behavior chính;
3. failure experiment có cách tái hiện;
4. note giải thích nguyên nhân và trade-off;
5. screenshot hoặc command output đủ để người đọc kiểm chứng.

## Tiêu chí kiểm soát lộ trình

- Không kéo một capability của phase sau vào core MVP chỉ vì đã có hạ tầng kỹ thuật liên quan.
- Một phase reporting hoặc AI chỉ được mở khi các ràng buộc quyền, audit và phạm vi dữ liệu của phase đó có tiêu chí kiểm thử được.
- Không phase nào thêm realtime, custom roles hay tự động hóa vượt quyền; các mục này vẫn ngoài scope cho đến khi có quyết định sản phẩm và thiết kế riêng.
