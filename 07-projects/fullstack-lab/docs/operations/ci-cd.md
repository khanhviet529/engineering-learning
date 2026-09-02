# CI/CD, deployment và recovery Flowboard

Tài liệu này xác định quality gate, deploy control, backup/recovery và security operations cho Flowboard. Nó kế thừa [testing strategy](testing-strategy.md), [local environment policy](local-development.md), [API contract process](../api/api-conventions.md) và [authorization model](../security/authorization-model.md). Chưa có runtime hoặc provider deployment được chọn; các nguyên tắc dưới đây là contract cho hạ tầng sau này.

## Pull-request pipeline bắt buộc

Pipeline chạy theo đúng thứ tự để failure rẻ xuất hiện trước:

```text
format -> lint -> typecheck -> unit -> integration -> build -> E2E -> container image
```

| Stage | Bằng chứng | Merge policy |
|---|---|---|
| Format | Formatter kiểm tra source, config và docs thay đổi | Block merge. |
| Lint | Linter không có error | Block merge. |
| Typecheck | Tất cả workspace typecheck thành công | Block merge. |
| Unit | Domain/schema/mapper/policy/shared-contract suite | Block merge. |
| Integration | PostgreSQL ephemeral, migrations explicit, repository/guard/transaction/idempotency suite | Block merge. |
| Build | Web, API và contract/OpenAPI artifact build thành công | Block merge. |
| E2E | Next.js + API journey, including role/conflict critical paths | Block merge. |
| Container image | Image reproducibly builds from reviewed commit; digest is recorded | **Block merge.** Every pull request must build the container image successfully before merge. |

API changes additionally block merge when OpenAPI lint, published path/schema/status/error envelope checks, breaking-change detection, or required authorization/concurrency tests fail. A green browser UI does not waive direct HTTP authorization coverage. CI injects only ephemeral test values; logs/artifacts must redact secret values, cookies, CSRF material, reset/verification tokens and raw request bodies.

### Controller ruling: container image is a PR gate

Container-image build là required pull-request merge gate, không phải optional validation hay chỉ là release-promotion gate. Ruling này bắt lỗi Dockerfile, build context và image-build trước release; đội chấp nhận CI chậm hơn để có feedback đó trước khi thay đổi được merge. Các deployment checks của release promotion ở phần tiếp theo là gate riêng, bổ sung cho — không thay thế — container-image PR gate.

## Artifact và promotion

Build một commit bất biến thành artifact/image có digest; deploy chỉ promote digest đã qua pipeline, không rebuild "cùng source" tại production. Artifact record tối thiểu gồm commit SHA, source revision, image digest, migration set, OpenAPI version/check result, environment target và thời điểm deploy.

Deployment chạy staged (development -> staging -> production khi các environment tồn tại). Mỗi promotion yêu cầu:

1. Approved PR và toàn bộ required checks xanh cho commit/digest đó.
2. Configuration validation và secret injection thành công mà không echo value.
3. Backup/recovery precondition của database đạt.
4. Migration review cho release; chỉ deploy controller có quyền execute migration đã duyệt.
5. Rollout quan sát readiness, safe error rate và rollback signal trước khi mở rộng traffic.

Rollback application bằng image digest trước; không chạy rollback schema tùy tiện. Nếu migration đã thay đổi dữ liệu, dùng forward fix hoặc restore procedure đã review thay vì automatic down migration. Release không được dùng `schema push`, ORM auto-sync hay API boot hook để thay đổi production schema.

## Controlled migration procedure

Mỗi migration có owner, review, dependency, loại thay đổi (additive/backfill/contract/destructive), lock/runtimes estimate, validation query và recovery plan. Expand/backfill/contract chia release nếu client cũ có thể còn dùng schema cũ. Migration chỉ chạy một lần qua command/controller explicit, idempotent ở mức migration ledger và có audit log.

Trước migration production:

- Verify backup mới nhất và restore drill gần nhất vẫn đạt mục tiêu RPO/RTO.
- Chọn maintenance/rollout window phù hợp với lock/risk; notify operator chịu trách nhiệm.
- Verify migration identity least privilege, target database và current migration state.
- Theo dõi duration, error, connection saturation, readiness và business smoke checks; stop/escalate khi vượt guardrail đã review.

## Backup, restore, RPO và RTO

PostgreSQL là system of record cho MVP. Named volume local, container image, Mailpit inbox, cache và future queue không thay thế backup database. Production dùng encrypted, access-controlled backup ngoài failure domain của primary database; retention và provider cụ thể là decision deployment nhưng phải đáp ứng baseline sau.

| Objective | MVP production baseline | Evidence |
|---|---|---|
| RPO | Tối đa 24 giờ dữ liệu đã commit | Backup thành công hằng ngày; alert khi backup mới nhất vượt 24 giờ. |
| RTO | Khôi phục service trong tối đa 4 giờ từ khi incident được tuyên bố | Timed restore drill trong isolated environment, sau đó API readiness và smoke check. |
| Restore validation | Ít nhất hằng quý và sau thay đổi backup/migration material | Record thời gian start/end, restore point, integrity/smoke result và corrective action. |

RPO/RTO là service objective, không phải cam kết mất dữ liệu bằng không. Nếu reporting Phase 1.2 thêm Redis/BullMQ, Redis job state không phải authoritative record cho report/business audit; queue durability, replay/idempotency, credential backup scope và worker recovery phải có ADR/review riêng trước deploy.

### Restore runbook

1. Incident lead tuyên bố scope, dừng write/deploy có thể làm tình hình xấu hơn và ghi incident timeline với `requestId`/release digest liên quan.
2. Xác nhận target database, sự cố primary và restore point phù hợp RPO; không restore đè primary còn hoạt động khi chưa có quyết định incident lead.
3. Restore vào isolated database/environment trước, dùng encrypted backup qua identity được ủy quyền; kiểm tra migration ledger, database integrity và dữ liệu/scope smoke checks an toàn.
4. Đo thời gian thực tế với RTO, so sánh với mục tiêu, rồi cut over theo provider/deployment procedure đã review.
5. Xác nhận API readiness, sign-in/session behavior, private-project authorization, task read/mutation smoke check và audit/activity consistency; monitor alert sau cutover.
6. Record outcome, data window, decisions, evidence và follow-up. Khi drill/incident không đạt RPO/RTO, mở corrective action trước release/migration tiếp theo.

## Security operations và incident runbooks

Environment secret chỉ đến từ approved secret manager/injection; không nằm trong Git, image layer, Compose template, CI log, support dump, OpenAPI example hay error response. Access dùng least privilege và audit: runtime API chỉ đọc secret cần chạy; migration/deploy identity tách khỏi runtime identity; operator break-glass access phải time-bound và reviewed.

Rotation bao gồm database credential, session/CSRF cryptographic material và SMTP/provider credential. Rotation plan phải xác định owner, dual-validity/cutover khi cần, session impact, rollback và verification. Password reset/security revocation có thể revoke server session theo [authentication contract](../security/authentication.md); operator không sửa session/token trực tiếp như workaround.

### Security incident runbook

1. Preserve safe evidence: incident time, affected environment/release, sanitized logs, request IDs and audit events. Không copy secret, cookie, raw token, password/hash hay private project data vào ticket/chat.
2. Contain: revoke/rotate credential hoặc session material bị nghi ngờ, disable compromised deploy identity, and stop unsafe rollout. Đánh giá blast radius theo project scope; không dùng query không scope để "tìm nhanh" dữ liệu.
3. Eradicate và recover: deploy approved digest/fix, run readiness/authorization smoke checks, then monitor login/reset rate limit, error rate và denied-access anomalies.
4. Notify theo incident policy của tổ chức, document impact/decisions, and create remediation work. Bất kỳ thay đổi khó đảo ngược về secret, deployment, migration hoặc queue cần ADR.

## Phase 1.2 boundary

Redis, BullMQ và `apps/worker` không được build/deploy cùng core MVP chỉ để dự phòng. Khi report delivery asynchronous được duyệt, CI thêm worker unit/integration/failure tests, container artifact và deployment step; monitoring thêm queue depth/age/retry/failure/duplicate-delivery signals; runbook thêm job replay/cancellation theo idempotency/audit contract. Những addition đó không được bypass Project Owner authorization hoặc project scope.
