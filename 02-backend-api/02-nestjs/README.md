---
level: intermediate
area: backend
---

# NestJS

NestJS không phải một tập decorator cần thuộc. Nó là **một chuỗi trạm cố định đặt giữa Node HTTP server và code nghiệp vụ của bạn**, cộng với **một DI container dựng lúc khởi động**.

Hai câu đó giải thích gần như mọi thứ, kể cả những lỗi khó nhất:

```text
"Guard của tôi không chạy"           → bạn chưa thuộc thứ tự các trạm
"Nest can't resolve dependencies (?)" → bạn chưa hiểu container dựng thế nào
```

Học framework này nghĩa là học hai mô hình đó, không phải học tên decorator.

## Cấu trúc

```text
fundamentals/   building blocks, decorator, DI, provider, scope
behavior/       request lifecycle, guard, pipe, transaction, testing
```

Kiến trúc (ranh giới module, modular monolith, god service) nằm ở
[04-architecture/](../04-architecture/README.md) — nó áp dụng cho backend nói chung.

## Thứ tự đọc

### Bước 0 — từ vựng (đọc trước mọi note behavior)

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0a | [Building blocks](./fundamentals/01-building-blocks.md) | `main.ts` → AppModule → Controller → Service là gì? Decorator nào ở đâu? |
| 0b | [DI & providers](./fundamentals/02-di-providers.md) | Vì sao "Nest can't resolve dependencies"? `useFactory` khác `useExisting` ở đâu? |

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Request lifecycle](./behavior/01-request-lifecycle.md) | Code mới nên đặt ở đâu, và vì sao thứ tôi thêm không chạy? |
| 2 | [Modules & DI](./behavior/02-modules-di.md) | Dấu `?` trong thông báo lỗi nghĩa là gì? |
| 3 | [Validation & errors](./behavior/03-validation-errors.md) | Biên giới giữa dữ liệu không đáng tin và đáng tin nằm ở dòng nào? |
| 4 | [Guards & interceptors](./behavior/04-guards-interceptors.md) | Vì sao đăng nhập hợp lệ vẫn đọc được dữ liệu của người khác? |
| 5 | [Config & lifecycle](./behavior/05-config-lifecycle.md) | Vì sao chạy được ở local nhưng hỏng ở staging? |
| 6 | [Database & transactions](./behavior/06-database-integration-transactions.md) | Vì sao dữ liệu ở trạng thái nửa vời khi lỗi giữa chừng? |
| 7 | [Caching, queues & jobs](./behavior/07-caching-queues-jobs.md) | Việc nặng nên đi đâu, và cache sai ở đâu? |
| 8 | [WebSocket gateway](./behavior/08-websocket-gateway.md) | Vì sao realtime chạy với 1 pod nhưng hỏng với 3 pod? |
| 9 | [Testing NestJS](./behavior/09-testing-nestjs.md) | Vì sao 340 test xanh mà production vẫn vỡ? |

Note 1 và 2 là nền của bảy note còn lại — đừng nhảy cóc. Note 6 cần [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) trước.

## Hai mô hình phải thuộc

### Chuỗi trạm

```text
middleware → guard → interceptor(pre) → pipe → CONTROLLER → service
                                                              │
    response ← filter(nếu lỗi) ← interceptor(post) ←──────────┘
```

| Trạm | Câu hỏi nó trả lời | Trả về |
|---|---|---|
| Middleware | "cần đụng `req`/`res` thô không?" | `next()` |
| Guard | "request này **được phép** đi tiếp không?" | `boolean` |
| Interceptor | "tôi **bọc** quanh handler thế nào?" | `Observable` |
| Pipe | "**giá trị** này hợp lệ / đúng kiểu không?" | giá trị đã transform |
| Filter | "lỗi này nên thành response nào?" | response |

Hai điều phản trực giác nhất: **guard chạy trước pipe** (nên guard thấy dữ liệu thô), và **interceptor bọc cả hai đầu** (phần "sau" chạy ngược thứ tự).

### DI container

```text
Map<Token, Instance> dựng MỘT LẦN lúc bootstrap

TOKEN     khoá tra — mặc định là class
PROVIDER  công thức tạo giá trị
MODULE    PHẠM VI — quyết định token nào tra được từ đâu
```

Quy tắc quan trọng nhất: **`imports` không bắc cầu.** A→B→C không cho A thấy provider của C.

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| `Nest can't resolve dependencies of X (?)` | circular import, interface làm token, thiếu `emitDecoratorMetadata` → [2](./behavior/02-modules-di.md) |
| `...(Y, ?)` + "available in the X context" | thiếu `exports` hoặc `imports` → [2](./behavior/02-modules-di.md) |
| Guard/interceptor có dependency `undefined` | đăng ký bằng `new` thay vì `APP_*` → [2](./behavior/02-modules-di.md) |
| Guard thêm vào nhưng không chạy | sai phạm vi đăng ký, hoặc request dừng trước đó → [1](./behavior/01-request-lifecycle.md) |
| 401 dù token hợp lệ | `RolesGuard` khai báo trước `JwtAuthGuard` → [4](./behavior/04-guards-interceptors.md) |
| Guard trả 403 khi đáng lẽ 401 | `return false` thay vì `throw UnauthorizedException` → [4](./behavior/04-guards-interceptors.md) |
| User đọc được dữ liệu user khác | thiếu ownership check, hoặc cache key thiếu `userId` → [4](./behavior/04-guards-interceptors.md) |
| Endpoint trả 200 với body rỗng, không log lỗi | interceptor nuốt lỗi (`catchError` không ném lại) → [4](./behavior/04-guards-interceptors.md) |
| Field client gửi thừa lọt vào DB | thiếu `whitelist: true` → [3](./behavior/03-validation-errors.md) |
| Field bị mất im lặng, request vẫn 201 | `whitelist` bật, `forbidNonWhitelisted` tắt, tên field gõ sai → [3](./behavior/03-validation-errors.md) |
| Nested object không được validate | thiếu `@Type()` cạnh `@ValidateNested()` → [3](./behavior/03-validation-errors.md) |
| Input sai trả 500 thay vì 400 | chưa có `ValidationPipe` toàn cục → [3](./behavior/03-validation-errors.md) |
| Lỗi domain ra 500 | filter chưa nhận biết class lỗi → [3](./behavior/03-validation-errors.md) |
| Lỗi trùng ra 500 thay vì 409 | repository chưa dịch mã lỗi driver → [3](./behavior/03-validation-errors.md) |
| Chạy local ổn, staging `undefined` | không validate env → [5](./behavior/05-config-lifecycle.md) |
| Connection DB tăng dần mỗi lần deploy | thiếu `app.enableShutdownHooks()` → [5](./behavior/05-config-lifecycle.md) |
| Pod CrashLoopBackOff, log rỗng | crash trước khi logger sẵn sàng: validate env hoặc lỗi DI → [5](./behavior/05-config-lifecycle.md) |
| "DB chậm" nhưng DB rảnh | network call bên trong transaction, pool bị giữ → [6](./behavior/06-database-integration-transactions.md) |
| Dữ liệu nửa vời sau lỗi | không có ranh giới transaction, hoặc repository quên `tx` → [6](./behavior/06-database-integration-transactions.md) |
| `current transaction is aborted` | `try/catch` bên trong transaction → [6](./behavior/06-database-integration-transactions.md) |
| Endpoint chậm tuyến tính theo số dòng | N+1 → [6](./behavior/06-database-integration-transactions.md) |
| 500 ngẫu nhiên chỉ khi tải cao | deadlock (`40P01`) → [6](./behavior/06-database-integration-transactions.md) |
| Dữ liệu "lúc cũ lúc mới" khi F5 | cache in-memory với nhiều replica → [7](./behavior/07-caching-queues-jobs.md) |
| Cron gửi email 3 lần | `@Cron` chạy trên mọi replica → [7](./behavior/07-caching-queues-jobs.md) |
| Job chạy hai lần, email trùng | job không idempotent → [7](./behavior/07-caching-queues-jobs.md) |
| Redis đầy bộ nhớ | thiếu `removeOnComplete` → [7](./behavior/07-caching-queues-jobs.md) |
| Realtime chạy với 1 pod, hỏng với 3 pod | thiếu Redis adapter → [8](./behavior/08-websocket-gateway.md) |
| WebSocket reconnect đều đặn mỗi ~60s | `proxy_read_timeout` của reverse proxy → [8](./behavior/08-websocket-gateway.md) |
| Handshake WebSocket trả 400 | proxy thiếu header `Upgrade`/`Connection` → [8](./behavior/08-websocket-gateway.md) |
| Test xanh nhưng production vỡ | e2e không dùng cấu hình của `main.ts` → [9](./behavior/09-testing-nestjs.md) |

## Mười quyết định mặc định

Nếu bạn chỉ mang đi mười dòng từ folder này:

```ts
// 1. Guard toàn cục, opt-out bằng @Public() — quên = bị CHẶN, không phải bị HỞ
{ provide: APP_GUARD, useClass: JwtAuthGuard }

// 2. Enhancer toàn cục luôn qua APP_* để nằm trong DI container
{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }

// 3. ValidationPipe toàn cục từ commit đầu tiên
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })

// 4. Validate env lúc khởi động — thiếu biến thì KHÔNG start
validate: validateEnv

// 5. Bật shutdown hook, nếu không mọi onApplicationShutdown là code chết
app.enableShutdownHooks();

// 6. Service ném DomainError, MỘT filter dịch sang HTTP
throw new NotFoundError('task not found');

// 7. Ranh giới transaction ở SERVICE; không network call bên trong
await this.prisma.$transaction(async (tx) => { /* chỉ ghi DB */ }, { timeout: 5_000 });

// 8. Cache dùng chung phải ở Redis, key có tenant/user, luôn có TTL
`project:${tenantId}:${id}`

// 9. Job có jobId ổn định + kiểm tra trạng thái ở đầu process()
await queue.add('generate', { id }, { jobId: `report:${id}` });

// 10. Test phân quyền theo hướng PHỦ ĐỊNH
it('người khác KHÔNG đọc được', () => request(app).get(url).set(bobAuth).expect(404));
```

## Năm hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| Pipe validate trước khi guard chạy | Guard chạy **trước**; nó thấy dữ liệu thô | [1](./behavior/01-request-lifecycle.md) |
| `imports` bắc cầu qua nhiều tầng module | Không; mỗi module phải import trực tiếp | [2](./behavior/02-modules-di.md) |
| DTO có type TypeScript nghĩa là đã validate | Type biến mất khi compile | [3](./behavior/03-validation-errors.md) |
| Đăng nhập rồi thì được truy cập tài nguyên của mình | Không có gì tự ràng buộc "của mình" | [4](./behavior/04-guards-interceptors.md) |
| `interceptor.timeout()` huỷ được query | Chỉ ngừng chờ; query vẫn commit | [4](./behavior/04-guards-interceptors.md) · [6](./behavior/06-database-integration-transactions.md) |

## Position

```text
HTTP → Node runtime → NestJS → Domain/Service → Cache/Queue → PostgreSQL
                        ↑ folder này
```

## Related

- [00-http-api/](../00-http-api/README.md) — hợp đồng mà framework này phục vụ
- [01-nodejs/](../01-nodejs/README.md) — runtime bên dưới; đọc [Module system](../01-nodejs/fundamentals/02-module-system.md) trước note 2
- [04-architecture/](../04-architecture/README.md) — cái gì xảy ra sau controller
- [03-auth/](../03-auth/README.md) — cơ chế đằng sau guard
- [03-database/](../../03-database/README.md) — tầng dưới của note 6 và 7
- [05-cross-cutting/](../../05-cross-cutting/README.md) — security, testing, observability, reliability
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi chạy mọi experiment trong folder này

## Version / Context

Toàn bộ folder viết cho **NestJS 10/11**, platform Express, TypeScript 5 với `experimentalDecorators` + `emitDecoratorMetadata`. Ví dụ database dùng Prisma 5 và PostgreSQL 16.
