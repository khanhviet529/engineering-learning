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

API exposes two safe endpoints with stable semantics:

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
| Delivery | deployment version/digest, startup/readiness transition, migration duration/outcome | Correlate incident với release. |
| Recovery | last successful backup timestamp, last restore drill result/duration | Enforce RPO/RTO evidence trong [CI/CD](ci-cd.md). |
| Phase 1.2 queue | queue depth/oldest job, active/retry/failed/completed counts, job duration, duplicate/replay outcome | Operate BullMQ worker only after it exists. |

Dashboard đầu tiên nhóm theo service/environment/release và links từ a failed request/alert về sanitized logs by `requestId`. Distributed trace và Kubernetes resource/pod/container metrics chỉ được thêm sau khi provider/runtime đã được selected; trace context phải giữ redaction và không thay `requestId` response contract.

## Alert policy và operator runbooks

Alert chỉ page khi có action rõ ràng, có owner và link runbook; warning/ticket signal dùng cho capacity/trend. Threshold được calibrated từ SLO/baseline thực tế trước production, nhưng các condition sau là mandatory:

| Signal | Severity intent | First operator action |
|---|---|---|
| API readiness unavailable hoặc sustained liveness restart | Page | Check release/dependency status, use safe logs and rollback/incident procedure. |
| Sustained 5xx/error-rate or latency regression | Page when user impact confirmed | Correlate request IDs, release digest, database signal; stop rollout or rollback application digest. |
| PostgreSQL connection/pool saturation or query failure | Page | Protect write path, inspect database/provider health, avoid unscoped diagnostic queries. |
| Backup older than RPO or restore drill overdue/failed | Page/ticket according to RPO breach | Start backup/recovery owner procedure; block risky migration until evidence is restored. |
| Sign-in/reset rate-limit spike, unexpected CSRF/auth denial anomaly | Security alert | Preserve sanitized evidence, contain identity/secret issue following security runbook. |
| Phase 1.2 queue oldest job/retry/failure threshold | Page | Pause/retry/replay only through idempotent job runbook; do not manually duplicate delivery. |

Every alert opens or links an incident timeline containing environment, release digest, observed start/end, relevant request/job correlation IDs, customer impact, owner and decisions. It must not include secret values or private resource payloads.

### Generic service incident runbook

1. Acknowledge, classify impact and record time/environment/release digest/request IDs.
2. Verify liveness/readiness and recent deployment/migration state; inspect sanitized structured logs and bounded metrics.
3. Contain user impact: stop rollout, rollback approved application digest, or take dependency-specific action. Do not execute schema push, ad-hoc destructive query or unreviewed secret change.
4. Verify recovery with readiness, minimal authorized smoke checks and sustained telemetry; compare backup/recovery result with RPO/RTO when data integrity is involved.
5. Close only after documenting root cause, impact, timeline, data window, remediation and any ADR requirement.

### Data recovery and security references

The authoritative step-by-step restore and security-incident procedures, including 24-hour RPO and four-hour RTO targets, are in [CI/CD, deployment and recovery](ci-cd.md). Authorization diagnosis must preserve deny-by-default and `404` non-disclosure rules from the [authorization model](../security/authorization-model.md); support operators do not use logs or metrics to reveal another private project's existence.

## Staged telemetry boundary

Core MVP does not emit BullMQ worker metrics, trace spans or Kubernetes monitoring because it has no worker, Redis or Kubernetes runtime. The later phase must add those signals, dashboards, alerts, failure experiments, backup/recovery classification and runbooks in the same reviewed change that introduces its dependency. It must preserve `requestId`, job idempotency, Project Owner authorization, project-scoped data access and safe redaction.
