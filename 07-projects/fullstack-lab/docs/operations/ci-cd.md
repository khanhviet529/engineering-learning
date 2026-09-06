# CI/CD, deployment và recovery Flowboard

Tài liệu này xác định quality gate, deploy control, backup/recovery và security operations cho Flowboard. Nó kế thừa [testing strategy](testing-strategy.md), [local environment policy](local-development.md), [API contract process](../api/api-conventions.md) và [authorization model](../security/authorization-model.md). Chưa có runtime hoặc provider deployment được chọn; các nguyên tắc dưới đây là contract cho hạ tầng sau này.

## Nơi workflow phải nằm

`.github/workflows/fullstack-lab-ci.yml` — **ở gốc repository**, không phải trong thư mục lab.

GitHub Actions chỉ đọc `.github/workflows/` ở gốc; một workflow nằm trong thư mục con **không bao giờ được thực thi**. Bản đầu tiên của file này nằm ở `07-projects/fullstack-lab/.github/workflows/ci.yml` và vì vậy **chưa chạy lần nào** trong sáu mốc — năm cổng dưới đây tồn tại dưới dạng văn bản suốt thời gian đó, và `container-image` lẽ ra đã chặn merge ở lỗi `web.Dockerfile` mà frontend phải tự tìm bằng tay ở M5.5.

Đó là cùng một khuôn mẫu đã lặp lại nhiều lần trong dự án này, chỉ ở quy mô lớn hơn: **một quy tắc chỉ nằm trong file thì không chặn được ai.** Lần này thứ chỉ nằm trong file là cả một pipeline.

`paths` giới hạn workflow vào `07-projects/fullstack-lab/**`: phần còn lại của repository là kho kiến thức riêng, và một thay đổi ở đó không được kéo theo một lượt CI dựng Docker.

CI chạy trên **Ubuntu** và bắt đầu từ **số không** mỗi lượt — hai tính chất mà máy phát triển không có. Xem [local development](local-development.md) mục "Ba môi trường" để biết loại lỗi nào chỉ khoảng cách đó sinh ra.

## Pull-request pipeline bắt buộc

Pipeline chạy theo đúng thứ tự để failure rẻ xuất hiện trước:

```text
format -> lint -> typecheck -> unit -> integration -> build -> E2E -> container image
```

| Stage | Bằng chứng | Merge policy |
|---|---|---|
| Format | Formatter kiểm tra source và config thay đổi. **Markdown nằm ngoài phạm vi**: `docs/superpowers/**` là snapshot có ngày và ADR đã `Accepted` đều bị cấm sửa nội dung, nên để máy định dạng ghi lại byte của chúng là vi phạm chính hợp đồng đang bảo vệ chúng. Tính đúng đắn của tài liệu được kiểm bằng link check và các phép đối chiếu chéo. | Block merge. |
| Lint | Linter không có error, **và** `scripts/check-config-boundary.mjs` xanh: script `start` của `apps/api`/`apps/web` không nạp config từ file. Bộ kiểm này đọc chính `package.json` mà runtime chạy, vì quy tắc "`dev` nạp file, `start` thì không" hôm nay đúng nhờ người viết đúng — và một quy tắc chỉ nằm trong tài liệu thì không chặn được ai. | Block merge. |

| Typecheck | Tất cả workspace typecheck thành công | Block merge. |
| Unit | Bộ test cho domain, schema, mapper, policy và shared contract | Block merge. |
| Integration | PostgreSQL ephemeral, migration chạy tường minh, bộ test repository, guard, transaction và idempotency | Block merge. |
| Build | Web, API và contract/OpenAPI artifact build thành công | Block merge. |
| E2E | Hành trình Next.js đi cùng API, gồm cả các đường then chốt về role và conflict | Block merge. |
| Container image | Image build lại được từ commit đã review và cho kết quả như nhau; digest được ghi lại | **Block merge.** Mọi pull request phải build image thành công trước khi merge. |

**Bộ test của các workspace chạy tuần tự, không song song.** `pnpm test` đặt `--workspace-concurrency=1`; mỗi bộ vẫn chạy song song **bên trong** nó. Lý do là một quan sát chứ không phải sở thích: máy dev có 8 core, năm workspace chạy cùng lúc thì mỗi bộ tự spawn worker riêng, tổng khoảng 35 worker trên 8 core. Ở mức đó các phép chờ bất đồng bộ hết hạn vì **máy chậm**, không vì code sai — và cùng một bộ test xanh khi chạy riêng.

Điều đó đã làm cổng chất lượng đỏ hai lần trong bốn lượt `pnpm verify`, mỗi lần ở một suite khác nhau (`endpoint-contract-matrix` của `apps/api`, rồi `invitations` của `apps/web`), và không lần nào lặp lại khi chạy riêng. **Một cổng đỏ ngẫu nhiên không còn là bằng chứng** — nó dạy người ta chạy lại cho tới khi xanh, và đó là lúc cổng mất hết giá trị. Sau khi chuyển sang tuần tự: ba lượt liên tiếp xanh.

Đánh đổi: wall time dài hơn. Chấp nhận, vì thứ đang mua là tính tất định. Ngưỡng chờ đã nới ở `apps/web` (`testTimeout` 60s, `asyncUtilTimeout` 5s) là cách chữa triệu chứng của đúng nguyên nhân này; xem lại chúng ở M5, sau khi tuần tự đã chạy đủ lâu để biết còn cần bao nhiêu.

Thay đổi trên API còn bị chặn merge thêm khi một trong các việc sau thất bại: OpenAPI lint, kiểm tra path/schema/status/error envelope đã publish, phát hiện breaking change, hoặc các test phân quyền và concurrency bắt buộc. UI trong browser chạy xanh **không** miễn được yêu cầu phủ test phân quyền ở mức HTTP trực tiếp. CI chỉ nạp giá trị test dùng một lần; log và artifact phải redact giá trị secret, cookie, vật liệu CSRF, token reset/verification và body request thô.

### Phán quyết của controller: container image là cổng của pull request

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

## Quy trình migration có kiểm soát

Mỗi migration có owner, review, dependency, loại thay đổi (additive/backfill/contract/destructive), lock/runtimes estimate, validation query và recovery plan. Expand/backfill/contract chia release nếu client cũ có thể còn dùng schema cũ. Migration chỉ chạy một lần qua command/controller explicit, idempotent ở mức migration ledger và có audit log.

Trước migration production:

- Verify backup mới nhất và restore drill gần nhất vẫn đạt mục tiêu RPO/RTO.
- Chọn maintenance/rollout window phù hợp với lock/risk; notify operator chịu trách nhiệm.
- Verify migration identity least privilege, target database và current migration state.
- Theo dõi duration, error, connection saturation, readiness và business smoke checks; stop/escalate khi vượt guardrail đã review.

## Backup, restore, RPO và RTO

PostgreSQL là system of record cho MVP. Named volume local, container image, Mailpit inbox, cache và future queue không thay thế backup database. Production dùng encrypted, access-controlled backup ngoài failure domain của primary database; retention và provider cụ thể là decision deployment nhưng phải đáp ứng baseline sau.

| Mục tiêu | Baseline production của MVP | Bằng chứng |
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

Environment secret chỉ đến từ approved secret manager/injection; không nằm trong Git, image layer, Compose template, CI log, support dump, OpenAPI example hay error response. **Tên** của chúng thì ngược lại — phải công khai và phải được kiểm: [.env.production.example](../../.env.production.example) liệt kê đúng tên biến, chia mục bắt buộc/tuỳ chọn, không một giá trị nào, và một test so danh sách đó với `envSchema` để nó không trôi khỏi schema. Access dùng least privilege và audit: runtime API chỉ đọc secret cần chạy; migration/deploy identity tách khỏi runtime identity; operator break-glass access phải time-bound và reviewed.

Rotation bao gồm database credential, `CURSOR_SECRET`, `CSRF_SECRET` và SMTP/provider credential. Hai secret ký thì có cửa sổ dual-validity qua `CURSOR_SECRET_PREVIOUS`/`CSRF_SECRET_PREVIOUS`: ký bằng key hiện hành, verify bằng cả hai, gỡ biến `_PREVIOUS` sau khi cửa sổ đóng. Rotation plan phải xác định owner, dual-validity/cutover khi cần, session impact, rollback và verification. Password reset/security revocation có thể revoke server session theo [authentication contract](../security/authentication.md); operator không sửa session/token trực tiếp như workaround.

### Runbook sự cố bảo mật

1. Giữ lại bằng chứng an toàn: thời điểm sự cố, environment và release bị ảnh hưởng, log đã sanitize, các `requestId` và audit event. Không copy secret, cookie, raw token, password/hash hay private project data vào ticket/chat.
2. Contain: revoke/rotate credential hoặc session material bị nghi ngờ, disable compromised deploy identity, and stop unsafe rollout. Đánh giá blast radius theo project scope; không dùng query không scope để "tìm nhanh" dữ liệu.
3. Eradicate và recover: deploy approved digest/fix, run readiness/authorization smoke checks, then monitor login/reset rate limit, error rate và denied-access anomalies.
4. Notify theo incident policy của tổ chức, document impact/decisions, and create remediation work. Bất kỳ thay đổi khó đảo ngược về secret, deployment, migration hoặc queue cần ADR.

## Phase 1.2 boundary

Redis, BullMQ và `apps/worker` không được build/deploy cùng core MVP chỉ để dự phòng. Khi report delivery asynchronous được duyệt, CI thêm worker unit/integration/failure tests, container artifact và deployment step; monitoring thêm queue depth/age/retry/failure/duplicate-delivery signals; runbook thêm job replay/cancellation theo idempotency/audit contract. Những addition đó không được bypass Project Owner authorization hoặc project scope.
