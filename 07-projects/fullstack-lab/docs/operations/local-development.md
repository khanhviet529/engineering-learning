# Môi trường local, Docker Compose và cấu hình Flowboard

Tài liệu này định nghĩa environment có thể tái lập cho Flowboard trước khi repository được scaffold. Nó áp dụng [repository structure](../engineering/repository-structure.md), [backend conventions](../engineering/backend-conventions.md), [authentication](../security/authentication.md) và Section 11 của [baseline](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md). Nó không tạo Compose file, Dockerfile, app, migration hay secret thật.

## Topology core MVP

Compose local và integration CI chỉ có bốn service sau:

```text
browser -> web (Next.js) -> api (NestJS/Fastify) -> PostgreSQL
                                 |
                                 `-> Mailpit (local email capture only)
```

| Service | Trách nhiệm | Dữ liệu/port policy |
|---|---|---|
| `web` | Next.js browser experience; gọi API qua contract/transport | Chỉ expose port dev cần thiết; không chứa database credential. |
| `api` | NestJS/Fastify HTTP boundary, session, use case, migration command và OpenAPI | Là consumer duy nhất của database credential; không ghi secret vào log/response. |
| `postgres` | PostgreSQL persistent local data cho development và integration | Dùng named volume local; database test có tên/volume riêng và được reset bằng command rõ ràng. |
| `mailpit` | Capture email local cho reset/verification test | Không relay ra Internet, không là service production và không chứa secret production. |

Không thêm Redis, BullMQ, `apps/worker`, queue dashboard hay broker vào core Compose. [Phase 1.2](../product/delivery-roadmap.md) mới thêm Redis và worker sau khi report delivery là asynchronous; thay đổi đó cần ADR, topology/health/backup/telemetry/test cập nhật cùng lúc.

## Cách dùng sau khi scaffold

Implementation phải cung cấp một Compose profile/local target có tên ổn định để start/stop bốn service trên, cùng một command rõ ràng để xem service health và log. Tên file/script cụ thể được chọn khi `infra/compose` và package scripts được scaffold; tài liệu này không giả vờ command chưa tồn tại đã chạy được.

Một developer mới phải có thể làm theo thứ tự sau mà không tự tạo config:

1. Copy template environment versioned, điền giá trị local không nhạy cảm hoặc tạo secret local mới.
2. Start topology local và chờ API readiness trước khi dùng web.
3. Chạy migration explicit một lần cho database local đang chọn.
4. Nạp seed data disposable để có Owner/Editor/Viewer, User A/User B, board/task/comment/activity fixtures.
5. Chạy web/API test hoặc smoke journey qua Mailpit; stop service nhưng giữ hoặc xóa volume bằng command có ý nghĩa rõ ràng.

Seed không được tạo account production-like, password dùng chung, token thật hoặc project data thật. Reset database local/test phải xác định database/volume đích trước khi xóa; lệnh destructive không được có default mơ hồ.

## Configuration và secret policy

Config được validate tại process startup bằng schema hẹp. Startup fail fast với reason an toàn khi required variable thiếu/sai; error log ghi tên variable hoặc category, không ghi value. `packages/config` chỉ version toolchain config; runtime environment và secret không thuộc package đó.

| Category | Ví dụ | Nơi lưu/cấp | Quy tắc |
|---|---|---|---|
| Non-secret config | environment name, public web origin, API listen port, log level, database host/name, Mailpit host/port | `.env.example`, Compose env, deployment config | Version template và validation; không encode product policy vào config tùy ý. |
| Secret local | database password, session-signing/encryption material, CSRF secret, SMTP credential nếu cần | `.env.local` hoặc secret store local bị ignore | Developer tự tạo; không commit, copy vào ticket/chat/log hoặc dùng lại production secret. |
| Secret deployed | database credential, session/CSRF material, SMTP/provider credential | approved deployment secret manager/injection | Least privilege, audit access, rotation procedure và no echo in CI. |

### Biến đến từ đâu, theo từng cách chạy

Cùng một tên biến có **hai giá trị đúng khác nhau**, tuỳ process chạy ở đâu. `postgres` và `mailpit` là tên service của Docker network: chỉ container phân giải được chúng. `localhost:5433` và `localhost:1026` là cổng Compose publish ra host: chỉ process trên host dùng được. Không có một giá trị nào đúng cho cả hai.

| Cách chạy | Nguồn của biến | Ghi chú |
|---|---|---|
| Tất cả trong Compose | `.env` ở gốc lab, Compose đọc rồi inject qua `environment:` của từng service | Service `api` liệt kê **từng biến** một, không dùng `env_file:` quét cả file — biến lạ không lọt vào container |
| API trên host, hạ tầng trong Compose | `.env` rồi `.env.host` ghi đè, cả hai nạp bởi `--env-file-if-exists` trong script `dev` | `.env.host` chỉ chứa ba dòng khác biệt: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT` |
| Test | `DATABASE_URL_HOST ?? DATABASE_URL` đọc thẳng từ `process.env` | Bộ test không nạp file; CI inject biến |
| Web dev | Next.js tự nạp `.env`/`.env.local` từ gốc `apps/web` | Không thêm cơ chế nào; web không giữ credential nào |
| Deployed | Nền tảng inject vào environment; secret từ secret manager | **Không file nào được đọc** |

**Quy tắc có hiệu lực: `dev` được nạp file, `start` thì không.** `apps/api` script `start` là `node dist/main.js` — không `--env-file`, không `dotenv`, và `env.ts` chỉ đọc `process.env`. Đây là chỗ mà một "tiện cho dev" dễ rò sang production: thêm `--env-file` vào `start` cho đỡ phải cấu hình sẽ khiến production đọc một file trên đĩa thay vì environment do nền tảng cấp, và secret quay về nằm cạnh code. Sửa `start` theo hướng đó là vi phạm review, không phải một tối ưu.

`--env-file-if-exists` được chọn thay vì `--env-file` vì trong Docker **không có** `.env` cạnh code và đó là bình thường. Đánh đổi đã biết: đánh máy sai tên file cũng im lặng đi tiếp y như file không tồn tại. Chấp nhận ở `dev`; đó là thêm một lý do nữa để nó không xuất hiện ở `start`.

### Ba khoảng trống đã biết

Cơ chế đọc config ở trên là đúng hình cho production. Cách **giữ secret** thì chưa, và ghi lại ở đây để không bị phát hiện lúc deploy — xem bảng nợ ở [kế hoạch triển khai](../implementation-plan.md):

1. `SESSION_SECRET`, `CSRF_SECRET` và mật khẩu database đang là **plaintext trong `.env` trên đĩa**. `.gitignore` chặn được việc commit, không chặn được việc file tồn tại và bị đọc.
2. **Không có cửa sổ rotate.** Đổi `SESSION_SECRET` là vô hiệu mọi session đang mở, vì tất cả đang ký bằng key cũ. Rotate được mà không đá ai ra cần **hai** key trong một khoảng thời gian: ký bằng key mới, verify bằng cả hai. Đó là thiết kế, không phải cấu hình.
3. **Chưa có kiểm tự động nào** khẳng định `start` không nạp file. Hôm nay nó đúng vì có người viết đúng; một lint rule hoặc một test đọc `package.json` sẽ làm nó đúng vì không thể sai.

Template environment chỉ liệt kê **tên**, mô tả, required/optional và safe example không-secret. API phải đặt cookie `Secure` ngoài local development; local relaxation không được leak sang build/deploy production. CORS/origin allowlist, cookie domain và public URL dùng config được validate, không lấy từ client request.

## Database, migration và seed policy

Drizzle Kit migration là artifact versioned và được review cùng thay đổi schema/query/invariant. Không dùng `schema push`, auto-sync khi API boot, hay một Compose sidecar tự chạy schema mutation.

- Chỉ một command migration có tên rõ ràng được gọi explicit bởi developer hoặc deploy controller; nó báo database target, migration version/result và fail non-zero.
- CI tạo PostgreSQL ephemeral, chạy cùng migration path từ zero/current release candidate rồi mới chạy integration/E2E; không dùng schema khác với production.
- PostgreSQL image local và CI **phải có sẵn extension `unaccent`** (contrib module — official postgres image có sẵn; custom/slim image phải được kiểm chứng), và migration identity phải được phép `CREATE EXTENSION`, vì search index phụ thuộc `unaccent` + `fb_unaccent` theo [query and index policy](../data/query-and-index-policy.md). Thiếu extension làm migration fail — đây là lỗi setup, không được vá bằng cách bỏ index.
- Production migration được review, backup-gated và execute một lần dưới deploy identity có quyền migration. API runtime identity không có quyền DDL.
- Migration destructive hoặc long-running cần expand/backfill/contract plan, estimated lock/risk, rollback/forward recovery và ADR trước execution.
- Seed chỉ dành local/test. Production không chạy seed tự động; bootstrap account/membership cần một use case hoặc operator procedure có audit.

## Health và readiness local

API phải expose một liveness endpoint và một readiness endpoint theo [observability](observability.md). Local Compose đánh dấu service usable bằng readiness, không chỉ vì process đã mở port. `web` chỉ depend on API readiness khi behavior thực sự cần API; database healthcheck kiểm tra PostgreSQL tương ứng thay vì TCP-only check.

Liveness không query database và không restart process chỉ vì dependency outage. Readiness kiểm tra khả năng API dùng PostgreSQL với timeout ngắn, không log credential và trả response tối thiểu. Mailpit failure làm email flows unavailable/test fail nhưng không làm API core readiness phụ thuộc vào Mailpit.

## Ranh giới phase sau

Redis/BullMQ/worker được đánh giá lại khi Phase 1.2 có asynchronous report delivery. Khi đó, worker có config/secret độc lập, health/readiness riêng, queue retry/idempotency telemetry, alert backlog/failure, backup classification và failure experiments. API request vẫn trả prompt; CPU/file generation/delivery không chạy trong web/API request path.
