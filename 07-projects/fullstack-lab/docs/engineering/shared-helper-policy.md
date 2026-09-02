# Chính sách controlled generic core và shared helper

Mục tiêu của shared core là tái sử dụng primitive kỹ thuật có contract hẹp mà không làm mờ ownership product. Flowboard không dùng `utils/` như nơi đổ code, không tạo generic table API, generic CRUD controller/service/repository hay policy có thể thao túng table/field từ client.

## Quy tắc hai consumer

Một helper chỉ được chuyển sang shared khi **cả ba** điều kiện đều đúng:

1. Có ít nhất hai consumer hiện tại, cụ thể và độc lập; khả năng “sẽ dùng sau” không đủ.
2. Helper không chứa domain logic, action/role policy, allowlist, entity state transition hay side effect của một module.
3. Contract đầu vào/đầu ra hẹp, có tên theo capability kỹ thuật và có test riêng.

Trước điều đó, helper ở module/feature sở hữu. Khi consumer thứ hai xuất hiện, owner xác minh hai use case thật sự có cùng invariant; nếu chỉ giống bề ngoài, nhân bản nhỏ và rõ ràng tốt hơn abstraction non sớm. Chuyển helper không được thay đổi API contract hoặc xóa kiểm tra authorization/transaction của từng use case.

## Controlled generic core được phép

| Category | Vị trí dự kiến | Contract được phép | Giới hạn |
|---|---|---|---|
| Transport contract | `packages/contracts` | Zod schema/type của request, response, error envelope đã công bố | Contract vẫn mang tên use case, không export DB table hay arbitrary payload |
| HTTP/error | `apps/api/src/shared/http`, `errors` | requestId normalization, response envelope, known-error mapper | Không quyết định status/policy ngoài mapping contract đã định nghĩa |
| Pagination | `apps/api/src/shared/http` | limit parser, signed cursor codec, canonical fingerprint primitive | Module tự khai báo allowed filter/sort/search và order |
| Database mechanics | `apps/api/src/shared/database` | pool/transaction wrapper, migration wiring, clock/ID primitive khi cần | Không có repository CRUD hay query không scope |
| Retry/idempotency | shared technical boundary | idempotency-key normalization/store protocol, bounded retry primitive sau phase phù hợp | Mỗi module sở hữu semantic key, response snapshot và side effect của use case |
| Observability/config | shared/package config | Pino factory, safe redaction, config validation, correlation context | Không log raw payload/secrets hoặc gán business severity ngầm |
| Web technical primitive | `apps/web/src/lib`, `hooks`, `components/shared` | API client setup, QueryClient, accessible non-product hook/composition | Không có Task/Project query, capability hay mutation |
| UI primitive | `packages/ui`, `components/ui` | Flowboard wrapper Ant Design có variant/accessibility stable | Không fetch, route, form policy hay biết resource/role |

Generic primitives chỉ là “controlled core” khi module phải cung cấp domain input explicit. Ví dụ cursor codec nhận fingerprint canonical do Task list module dựng; transaction helper nhận callback do Task move use case sở hữu. Core không tự suy ra table, field, permission hay mutation.

## Logic phải ở module/feature sở hữu

| Sở hữu | Ví dụ không được đẩy vào shared |
|---|---|
| `tasks` | Field create/update allowlist, task list filter/sort/search, expected-version conflict, position calculation/rebalance, same-project assignee/column rule, `task.*` activity payload |
| `projects` | Private-project visibility, Owner cuối cùng, member add/remove/role-change invariant và project capabilities |
| `board-columns` | Active/archive rule, column reorder completeness và `COLUMN_NOT_EMPTY` decision |
| `auth` | Credential/reset/verification policy, session revocation, rate-limit semantic và CSRF outcome |
| `comments`/`activity` | Immutable comment rule, visibility scope và activity summary/event allowlist |
| Web feature | Board optimistic rollback, task form mapping, conflict UX, query invalidation và capability affordance của use case |

`AuthorizationService` và resource resolver là shared enforcement mechanism vì nhiều module gọi chúng, nhưng permission catalog/resource-to-project mapping vẫn explicit và version-controlled. Mỗi controller vẫn declares action; mỗi repository vẫn scopes data; use case vẫn kiểm tra invariant. Shared authorization không là “admin bypass” hay generic `canAnyTable` API.

## Quy trình extract và review

1. Nêu hai consumer, owner hiện tại và exact contract trong PR/ADR khi decision khó đảo ngược.
2. Chứng minh helper không nhận entity/table name, arbitrary field, raw query, role string tự do hoặc callback cho domain behavior không kiểm soát.
3. Đặt helper ở shared layer nhỏ nhất phù hợp (`web`, `api`, `packages/contracts`, `packages/ui`), không mặc định là global package.
4. Viết unit test cho contract hẹp và giữ test behavior/invariant trong module consumer.
5. Kiểm tra import direction: shared không import feature/module/app consumer; app không deep-import internal implementation của shared package.

Nếu không qua review này, giữ helper local. Quy tắc này bảo vệ API explicit, project-scoped authorization, transaction/ActivityLog atomicity và optimistic concurrency đã định nghĩa trong [API](../api/api-conventions.md), [data](../data/query-and-index-policy.md) và [security](../security/authorization-model.md) contracts.
