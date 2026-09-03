# Observability, health, alert và runbook Flowboard

Tài liệu này là contract operability cho MVP và các phase sau. Nó áp dụng [API error/request ID contract](../api/api-conventions.md), [backend logging convention](../engineering/backend-conventions.md), [local health policy](local-development.md) và [CI/CD recovery policy](ci-cd.md). First release có Pino structured logs, `requestId`, health/readiness và safe error reporting; metrics, traces, queue monitoring, load/failure testing và Kubernetes monitoring được thêm theo phase đã nêu, không được giả định đã tồn tại.

## Structured Pino logging và redaction

API ghi Pino JSON structured log cho request lifecycle, known error, unexpected error và important lifecycle event. Không log free-form request body như cách thay thế cho telemetry. Mỗi event có tối thiểu:

| Field | Ý nghĩa |
|---|---|
| `level`, `time`, `message` | Pino level, timestamp chuẩn và event message ổn định. |
| `requestId` | Correlation ID đã normalize/tạo tại HTTP boundary. |
| `method`, `route`, `statusCode`, `durationMs` | HTTP outcome đã route-normalize, không dùng raw query/path nhạy cảm. |
| `module`, `code` | Module owner và safe application/error code khi áp dụng. |
| `actorId`, `workspaceId`, `projectId`, `taskId` | Chỉ thêm khi đã được resolve, hợp lệ và không nhạy cảm; không substitute raw authorization payload. |
| `error` | Safe error class/code/cause/stack chỉ server-side cho unexpected failure; không serialize sang client. |

Redaction phải chặn password, cookie/session ID, CSRF secret, reset/verification token hoặc hash, database URL/credential, SMTP/provider credential, authorization payload thô và request body nhạy cảm. Log, trace, metric label, CI artifact và support export cùng dùng policy này. Không dùng email, title, description hoặc arbitrary user input làm high-cardinality metric label.

## `requestId` correlation

1. HTTP boundary nhận `X-Request-Id` opaque hợp lệ rồi normalize, hoặc tạo ID mới; client không được ép value có thể làm hại log/search.
2. API dùng một ID cho request context, structured logs, use case, database/error events, response header `X-Request-Id` và JSON success/error envelope.
3. Unexpected `5xx` trả `INTERNAL_ERROR` message an toàn và `requestId`; client/support dùng ID này để tìm server logs. Không trả stack, SQL, secret, token, policy detail hoặc private-resource existence.
4. Phase 1.2 job metadata preserve originating `requestId`, tạo job execution ID riêng và log cả hai. Correlation không phải authorization claim, idempotency key hay user identifier.

## Health, liveness và readiness

API mở đúng hai endpoint an toàn với ngữ nghĩa cố định:

| Endpoint | Câu hỏi trả lời | Dependency policy | Response |
|---|---|---|---|
| `GET /health/live` | Process/event loop có sống để nhận traffic không? | Không query PostgreSQL, Mailpit, Redis hay external service. | `200` minimal `{ "status": "ok" }`; không có version, credential, topology hay dependency detail. |
| `GET /health/ready` | API có sẵn sàng phục vụ core request bây giờ không? | Verify PostgreSQL connectivity bằng timeout ngắn; future worker/Redis có readiness riêng, không làm core API claim healthy sai. | `200` khi ready, `503` khi không ready, body tối thiểu không lộ hạ tầng. |

Liveness failure là lý do restart process; dependency outage chỉ làm readiness fail và cần alert/triage. Health handler không đi qua expensive authorization/use case path, không log secret và không create activity. Load balancer/deploy controller route traffic theo readiness; local Compose và CI wait readiness thay vì một arbitrary sleep.

## Metrics và dashboard roadmap

Metrics là phase sau first log/readiness release nhưng instrumentation names/labels phải được định nghĩa trước để tránh ad-hoc telemetry. Tất cả metric dùng bounded labels như route template, status class/code, module và environment; không dùng `requestId`, user ID, project ID, task ID, raw URL hay exception message làm label.

| Nhóm | Metric/indicator cần có khi metrics được bật | Mục đích |
|---|---|---|
| Availability | readiness state, request count/error rate theo route/status class | Detect unavailable API và regression. |
| Latency | request duration histogram theo route template | Compare p50/p95/p99 với SLO/baseline đã được owner phê duyệt. |
| Database | pool usage/wait, query duration/error, connection failure | Detect saturation/dependency failure trước cascade. |
| Security | sign-in/reset rate-limit reject, CSRF failure, auth failure/denied action aggregate | Detect abuse/regression mà không enumerate account/resource. |
| Rate limit | reject count theo route class (auth, search, aggregate, export, bulk review) và tỷ lệ 429/tổng request | Tune giá trị khởi điểm trong [API conventions](../api/api-conventions.md#rate-limit-và-retry-after); phát hiện limiter quá chặt/quá lỏng trước khi user báo. |
| Delivery | deployment version/digest, startup/readiness transition, migration duration/outcome | Correlate incident với release. |
| Recovery | thời điểm backup thành công gần nhất, kết quả và thời lượng lần diễn tập restore gần nhất | Bắt buộc có bằng chứng RPO/RTO theo [CI/CD](ci-cd.md). |
| Phase 1.2 queue | độ sâu queue và job cũ nhất, số job active/retry/failed/completed, thời lượng job, kết quả duplicate/replay | Chỉ vận hành BullMQ worker sau khi nó thực sự tồn tại. |
| Invariant guard | rebalance count theo project/column, WorkLog daily-limit reject (1.3), sprint activate conflict (1.4), dependency cycle reject và edge-count-limit reject (1.5) | Đây là các **revisit trigger đã ghi trong ADR**, nên chúng phải đo được: [ADR-0006](../decisions/ADR-0006-fractional-ordering-and-concurrency.md) xem lại spacing/ngưỡng khi rebalance xảy ra thường xuyên; [ADR-0011](../decisions/ADR-0011-task-relations-subtask-and-dependency.md) xem lại giới hạn 50 cạnh theo tần suất reject. Label chỉ dùng route template/module/phase, không dùng project/task ID. |

Dashboard đầu tiên nhóm theo service, environment và release, và từ một request lỗi hoặc một alert phải dẫn được về log đã sanitize theo `requestId`. Distributed trace và metric resource/pod/container của Kubernetes chỉ được thêm sau khi đã chọn provider và runtime; trace context phải giữ redaction và không thay `requestId` response contract.

## Alert policy và operator runbooks

Alert chỉ page khi có action rõ ràng, có owner và link runbook; warning/ticket signal dùng cho capacity/trend. Threshold phải được hiệu chỉnh theo SLO và baseline thực tế trước khi lên production, nhưng các điều kiện sau là bắt buộc:

| Tín hiệu | Mức độ dự kiến | Hành động đầu tiên của operator |
|---|---|---|
| API readiness không khả dụng, hoặc liveness restart liên tục | Page | Kiểm tra trạng thái release và dependency, đọc log an toàn, chạy quy trình rollback hoặc incident. |
| Tỷ lệ 5xx hoặc error rate cao kéo dài, hoặc latency xấu đi | Page khi đã xác nhận có ảnh hưởng tới người dùng | Đối chiếu `requestId`, release digest và tín hiệu database; dừng rollout hoặc rollback về digest cũ. |
| Connection hoặc pool PostgreSQL bị bão hoà, hoặc query lỗi | Page | Bảo vệ write path, kiểm tra sức khoẻ database và provider, tuyệt đối không chạy query chẩn đoán không giới hạn scope. |
| Backup cũ hơn RPO, hoặc diễn tập restore quá hạn hay thất bại | Page hoặc ticket tuỳ mức vi phạm RPO | Khởi động quy trình của owner backup/recovery; chặn mọi migration rủi ro cho tới khi có lại bằng chứng. |
| Rate limit sign-in hoặc reset tăng vọt, hoặc CSRF và auth bị từ chối bất thường | Security alert | Giữ lại bằng chứng đã sanitize, khoanh vùng sự cố identity hoặc secret theo security runbook. |
| Job cũ nhất, số lần retry hoặc số job lỗi trong queue vượt ngưỡng (Phase 1.2) | Page | Chỉ pause, retry hoặc replay qua runbook job idempotent; không tự tay gửi trùng delivery. |

Mỗi alert phải mở hoặc liên kết tới một incident timeline ghi đủ: environment, release digest, thời điểm bắt đầu và kết thúc quan sát được, các correlation ID của request và job liên quan, ảnh hưởng tới khách hàng, người chịu trách nhiệm và các quyết định đã ra. Timeline không được chứa giá trị secret hay payload của tài nguyên riêng tư.

### Runbook sự cố dịch vụ dùng chung

1. Xác nhận đã tiếp nhận, phân loại mức ảnh hưởng, ghi lại thời điểm, environment, release digest và các `requestId`.
2. Kiểm tra liveness/readiness và trạng thái deployment/migration gần nhất; đọc structured log đã sanitize cùng các metric có label giới hạn.
3. Khoanh vùng ảnh hưởng tới người dùng: dừng rollout, rollback về application digest đã được phê duyệt, hoặc xử lý riêng theo dependency. Không được push schema, không chạy query destructive tuỳ hứng, không đổi secret khi chưa qua review.
4. Xác nhận đã hồi phục bằng readiness, một lượng nhỏ smoke check có thẩm quyền và telemetry ổn định trong một khoảng thời gian; khi có liên quan tới toàn vẹn dữ liệu thì đối chiếu kết quả backup/recovery với RPO/RTO.
5. Chỉ đóng sự cố sau khi đã ghi lại nguyên nhân gốc, mức ảnh hưởng, timeline, khoảng dữ liệu bị tác động, cách khắc phục và ADR cần mở nếu có.

### Tham chiếu phục hồi dữ liệu và bảo mật

Quy trình restore và xử lý sự cố bảo mật theo từng bước — bao gồm mục tiêu RPO 24 giờ và RTO 4 giờ — nằm ở [CI/CD, triển khai và phục hồi](ci-cd.md); đó là bản có thẩm quyền, tài liệu này không nhân bản lại. Khi chẩn đoán vấn đề phân quyền vẫn phải giữ nguyên deny-by-default và quy tắc không tiết lộ qua `404` của [mô hình phân quyền](../security/authorization-model.md): người vận hành hỗ trợ không được dùng log hay metric để tiết lộ sự tồn tại của một project riêng tư của người khác.

## Ranh giới telemetry theo phase

Các metric của một phase chỉ **phát** khi phase đó tồn tại; tên và label được định nghĩa trước để tránh telemetry ad-hoc, đúng nguyên tắc ở bảng trên. Riêng nhóm Invariant guard là ngoại lệ có lý do: rebalance count thuộc core MVP (ordering có từ đầu), nên nó phát ngay khi có runtime, còn các dòng 1.3/1.4/1.5 phát cùng phase của chúng.

Core MVP không phát metric của BullMQ worker, không phát trace span và không có monitoring Kubernetes, đơn giản vì nó chưa có worker, chưa có Redis và chưa chạy trên Kubernetes. Phase nào mang dependency đó vào thì phải thêm luôn tín hiệu, dashboard, alert, failure experiment, phân loại backup/recovery và runbook **trong cùng một change đã qua review** — không để nợ sang sau. Phase đó vẫn phải giữ nguyên `requestId`, tính idempotent của job, thẩm quyền Project Owner, phạm vi dữ liệu theo project và quy tắc redaction an toàn.
