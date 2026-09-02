# Cấu trúc repository Flowboard

Tài liệu này áp dụng baseline kỹ thuật đã phê duyệt vào cấu trúc pnpm workspace trước khi scaffold. Nó cùng với [frontend conventions](frontend-conventions.md), [backend conventions](backend-conventions.md) và [shared-helper policy](shared-helper-policy.md) xác định ownership; không tạo application code, migration hay hạ tầng chạy được.

## Ranh giới monorepo

Flowboard dùng một pnpm workspace. Mỗi package hoặc app có một trách nhiệm có thể mô tả độc lập; không tạo package chỉ để gom “utils”, cũng không để app này import source nội bộ của app kia.

```text
fullstack-lab/
├── docs/                         # Product, UX, contracts, engineering và operations
├── apps/
│   ├── web/                      # Next.js browser experience
│   ├── api/                      # NestJS HTTP API và application behavior
│   └── worker/                   # Chỉ Phase 1.2: report/delivery bất đồng bộ
├── packages/
│   ├── contracts/                # Zod schemas và types của HTTP use case rõ ràng
│   ├── ui/                       # Primitive/wrapper UI Flowboard tái sử dụng
│   └── config/                   # Cấu hình dùng chung, không chứa product behavior
├── infra/
│   ├── docker/                   # Dockerfile/image concerns
│   ├── compose/                  # Mô tả topology local/CI
│   ├── kubernetes/               # Chỉ khi phase vận hành cần nó
│   └── monitoring/               # Dashboard/alert/collector configuration
└── scripts/                      # Automation có tên, input/output rõ ràng
```

`apps/worker` không tồn tại trong core MVP và Phase 1.1 export tải xuống thủ công. Nó chỉ được thêm khi reporting/delivery thực sự bất đồng bộ ở Phase 1.2, cùng Redis và BullMQ. Không tạo sẵn worker, queue hoặc dependency của chúng để “dự phòng”.

## Ownership của từng workspace

| Vùng | Sở hữu | Được chứa | Không được chứa |
|---|---|---|---|
| `apps/web` | Trải nghiệm Next.js và state phía browser | route composition, feature UI, query/mutation, form, accessibility, DnD affordance | Nest controller, Drizzle query, authorization quyết định cuối cùng |
| `apps/api` | HTTP boundary và product behavior phía server | Nest modules, guards, use case, domain rule, repository port/infrastructure adapter | page/component Next.js, client cache, generic table API |
| `apps/worker` | Job report/delivery sau Phase 1.2 | consumer của use case/job contract hẹp, retry/idempotency/telemetry job | quyền bypass API, query không project-scoped, logic UI |
| `packages/contracts` | Hợp đồng transport dùng bởi web và API | Zod request/query/response schema, inferred type, error-code vocabulary khi đã công bố | Drizzle table, Nest decorator, React component, secret/config runtime |
| `packages/ui` | UI primitive Flowboard dùng ở nhiều feature | wrapper Ant Design, token/variant/accessibility contract được phê duyệt | fetch, quyền, route, product mutation hay feature-specific form |
| `packages/config` | Cấu hình toolchain/format/lint/type/test được versioned | preset nhỏ, documentation cho môi trường cần thiết | secret, environment value triển khai, domain constant |
| `infra` | Artefact hạ tầng khai báo | image, compose, deployment và monitoring configuration theo phase | business rule, migration tự chạy không kiểm soát |
| `scripts` | Tự động hóa lặp lại có giới hạn | command kiểm tra/docs/migration được gọi tường minh | application logic dùng từ runtime |
| `docs` | Nguồn chân lý Markdown cho behavior và contract | quyết định, ADR, hướng dẫn, acceptance/operation docs | bản sao source code hoặc secret |

## Hướng phụ thuộc

```text
apps/web ──────────────┐
                        ├── packages/contracts
apps/api ──────────────┤
                        ├── packages/config
apps/web ──────────────┴── packages/ui

apps/worker (Phase 1.2) ── packages/contracts + packages/config
```

- App chỉ import public entry point của package. Không deep-import source hoặc test fixture nội bộ.
- `packages/contracts` không phụ thuộc vào `apps/*`, Drizzle, NestJS, Next.js hoặc React. Contract biểu đạt use case cụ thể (ví dụ `moveTask`), không biểu đạt table/database chung.
- `packages/ui` không phụ thuộc `apps/api`; nếu component cần capability, data hoặc mutation của Task/Project, nó thuộc feature sở hữu use case đó.
- `apps/web` gọi API qua contract/transport được kiểm soát. `apps/api` không import presentation/client state của web. Cả hai không chia sẻ database model.
- `infra` và `scripts` có thể tham chiếu workspace command/documented config nhưng không trở thành dependency runtime của domain.

## Biên giới package và thay đổi

Một thay đổi cross-app bắt đầu từ contract/Markdown đã được phê duyệt: use case, input allowlist, response projection, error và authorization giữ theo [API conventions](../api/api-conventions.md), [endpoint contracts](../api/endpoint-contracts.md) và [authorization model](../security/authorization-model.md). Sau đó web và API cùng cập nhật consumer/producer của contract. Không dùng shared type để hợp thức hóa field, endpoint, action hoặc generic CRUD chưa được baseline cho phép.

Khi một quyết định làm thay đổi package boundary, migration ownership, session/auth, ordering/concurrency, worker/queue hoặc deployment, ghi ADR trước khi implementation. Chi tiết chọn shared code nằm tại [shared-helper policy](shared-helper-policy.md).

## Quy tắc quyết định kiến trúc

Các quy tắc nền sau chi phối mọi thay đổi cấu trúc; chúng có trước và đứng trên lựa chọn công nghệ của từng phase:

- Bắt đầu bằng PostgreSQL và modular monolith; chỉ tách deployment khi có yêu cầu và số liệu chứng minh cần thiết.
- Chỉ thêm Redis khi có cache behavior hoặc rate-limit experiment cụ thể cần quan sát.
- Chỉ thêm queue/worker khi có công việc bất đồng bộ với retry/idempotency cần quan sát; theo [lộ trình phát hành](../product/delivery-roadmap.md), điều này chỉ xảy ra từ Phase 1.2.
- Không dùng eventual consistency cho dữ liệu cốt lõi của task nếu chưa nêu rõ UX trade-off.
- Mỗi quyết định khó đảo ngược phải có ADR với điều kiện xem lại, theo [quy trình ADR](../decisions/README.md).
