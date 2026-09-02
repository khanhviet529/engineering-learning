# Backend conventions Flowboard

`apps/api` dùng NestJS, Fastify adapter, TypeScript, PostgreSQL, Drizzle ORM/Drizzle Kit, Zod, OpenAPI/Swagger, Pino và Vitest. Tài liệu này áp dụng các contract API/data/security đã phê duyệt; nó không scaffold Nest module, schema database hay migration.

## Module shape và ownership

```text
apps/api/src/
├── main.ts
├── modules/
│   └── tasks/
│       ├── tasks.module.ts             # Nest wiring của module
│       ├── presentation/               # controller, request/response adapter, OpenAPI metadata
│       ├── application/                # explicit use case và command/query DTO nội bộ
│       ├── domain/                     # invariant, policy, port/interface thuộc Tasks
│       ├── infrastructure/             # Drizzle repository/adaptor thuộc Tasks
│       └── test/                       # test module/use case/repository của Tasks
└── shared/
    ├── authorization/  ├── database/  ├── http/
    ├── observability/  ├── config/    └── errors/
```

`auth`, `workspaces`, `projects`, `board-columns`, `tasks`, `comments`, `activity` và sau này `reports` có cùng shape. Module chỉ tạo folder khi có use case của module; không tạo base module/service/repository trống. `reports` thuộc Phase 1.1, còn worker/queue logic thuộc Phase 1.2, không nằm trong core task module.

Dependency chỉ đi theo hướng sau:

```text
controller → application use case → domain rule/port → infrastructure repository
```

Controller biết HTTP/Nest/OpenAPI nhưng không biết Drizzle table. Use case điều phối authorization result, validation result, transaction và explicit product command. Domain giữ invariant/policy có ý nghĩa nghiệp vụ. Repository port diễn đạt query/mutation hẹp mà use case cần; infrastructure là nơi duy nhất module dùng Drizzle/PostgreSQL. Hạ tầng không import controller, và repository không tự quyết định HTTP response.

## HTTP, Nest và Fastify boundary

Nest chạy trên Fastify adapter; plugin/bootstrap, request lifecycle và response integration tuân theo Fastify thay vì thêm Express-only middleware. `main.ts` chỉ bootstrap adapter, global HTTP policy, document publication và graceful lifecycle; nó không chứa route/business logic.

Mỗi controller route tương ứng một use case công khai, request schema hẹp và response projection hẹp. OpenAPI/Swagger được xuất từ controller/contract để công bố HTTP interface; Markdown API contract vẫn là quyết định behavior gốc. Không có controller generic theo table, base CRUD route, dynamic field selector hoặc client-supplied SQL expression.

Protected request theo thứ tự cố định:

```text
SessionGuard → ResourceProjectResolver → ProjectPermissionGuard/
AuthorizationService.can → Zod validation → use case → project-scoped repository
```

ID là locator, không phải chứng cứ quyền. Resolver lấy owner project từ resource; repository tiếp tục ràng buộc `project_id`. Workspace Admin không có project membership không nhận resource/count/metadata private. Use case re-check invariant có thể thay đổi trong transaction và mọi mutation business ghi ActivityLog trong cùng transaction; stale update/move rollback, trả `409` với current version và không ghi activity.

## Contract, validation và lỗi

Zod là boundary parser cho params, query và body: schema từ `packages/contracts` khi web/API cùng dùng, hoặc schema module-local khi chỉ API cần. Parse xảy ra trước use case; module schema chỉ nhận field allowlist, canonicalize input được phép và từ chối field/query/sort/cursor không hợp lệ. Zod client-side chỉ tăng UX, không thay parser server.

Error mapper ở `shared/errors` chuyển error đã biết thành envelope chuẩn `{ code, message, requestId, details? }` trong [API conventions](../api/api-conventions.md). Validation trả `400 VALIDATION_FAILED` với `details` đã xác thực; auth/permission/scope/conflict dùng code và status đã công bố. Lỗi không mong đợi trả thông điệp `500` an toàn, giữ cause/stack chỉ trong Pino log. Controller/use case không tự tạo response/error shape riêng.

## Drizzle, repository và transaction boundary

Drizzle table/schema, connection/pool, migration runner và transaction helper ở database boundary; use case không import raw table để viết query. Repository method nhận context scope rõ (actor/resolved project/resource và canonical query) thay vì ID rời rạc mơ hồ. Query luôn giữ project scope, fixed filter/sort/search allowlist và cursor policy từ [query and index policy](../data/query-and-index-policy.md).

Transaction helper chỉ điều phối atomicity, không chứa Task/Project rule. Use case sở hữu thứ tự: resolve/authorize, re-read/lock invariant cần thiết, mutation, activity event allowlisted rồi commit. Không mở transaction cho HTTP call, file generation, email hay job queue. Task move dùng dedicated transaction, lock vừa đủ, fractional/gap ordering có rebalance kiểm soát và `expectedVersion`; không dùng generic update để đổi `columnId`/`position`.

## Logging, test và quality gate

Pino log structured JSON với tối thiểu `level`, `time`, `requestId`, `method`, `route`, `statusCode`, `durationMs`, `module` và safe error `code`; thêm `actorId`, `workspaceId`, `projectId`, `taskId` chỉ khi hợp lệ và không nhạy cảm. Không log password, cookie/session/CSRF, reset/verification token hoặc hash, raw authorization payload, request body nhạy cảm hay stack cho client. `requestId` được lấy/chuẩn hóa hoặc tạo tại HTTP boundary, trả về response và truyền vào mọi log/use case; worker phase sau phải preserve correlation này.

Vitest unit test domain policy, Zod schema, mapper và use case branch. Integration test chạy Nest use case/repository với PostgreSQL để chứng minh scope, transaction, pagination/cursor, idempotency và stale-version behavior. Test authorization bắt buộc có Viewer direct HTTP attempt và User A/User B object-level access theo [authorization test matrix](../security/authorization-test-matrix.md). Định nghĩa environment/pipeline đầy đủ thuộc operations docs; backend quality gate yêu cầu format, lint, typecheck, unit/integration test và OpenAPI contract review trước merge.

Helper chỉ vào `shared/` khi qua [controlled generic core policy](shared-helper-policy.md). Logic permission/resource scope, task ordering, membership invariant, activity event hoặc response allowlist vẫn ở module sở hữu.
