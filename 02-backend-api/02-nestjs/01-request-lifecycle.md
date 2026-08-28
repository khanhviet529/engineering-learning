---
level: intermediate
area: backend
prerequisites:
  - ../00-http-api/01-http-request-response.md
  - ../01-nodejs/01-node-runtime-concurrency.md
related:
  - 04-guards-interceptors.md
  - 03-validation-errors.md
  - ../04-architecture/01-controller-service-repository.md
---

# NestJS request lifecycle

> Bạn thêm một `Guard` để chặn user chưa đăng nhập. Nó không chạy. Bạn thêm log vào middleware — log ra. Thêm log vào guard — không ra. Câu hỏi không phải "guard bị lỗi gì" mà là "guard nằm ở đâu trên đường đi của request, và request có bao giờ tới đó không".

## Position

```text
Browser → Reverse proxy → Node http server → Nest platform adapter (Express/Fastify)
   → middleware → guard → interceptor(pre) → pipe → CONTROLLER → service → repository → PostgreSQL
                                                          ↑ toàn bộ note này
   ← ... ← interceptor(post) ← exception filter ← response
```

Toàn bộ NestJS chỉ là **một chuỗi trạm được sắp xếp trước** đặt giữa Node HTTP server và code nghiệp vụ của bạn. Nếu bạn thuộc chuỗi đó, bạn biết đặt code mới ở đâu và biết vì sao một thứ không chạy.

## Problem

Không có framework, một handler thật sự trông như sau:

```ts
app.post('/tasks', async (req, res) => {
  // 1. lấy request id để log
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  const startedAt = Date.now();
  try {
    // 2. xác thực
    const user = await verifyToken(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    // 3. phân quyền
    if (!user.roles.includes('member')) return res.status(403).json({ error: 'forbidden' });
    // 4. validate body
    if (typeof req.body?.title !== 'string' || req.body.title.length === 0)
      return res.status(400).json({ error: 'title required' });
    // 5. ép kiểu
    const projectId = Number(req.body.projectId);
    if (Number.isNaN(projectId)) return res.status(400).json({ error: 'bad projectId' });
    // 6. NGHIỆP VỤ — 1 dòng
    const task = await taskService.create(user.id, { title: req.body.title, projectId });
    // 7. định dạng response
    res.status(201).json({ data: task });
  } catch (err) {
    // 8. map lỗi
    log.error({ err, requestId });
    res.status(500).json({ error: 'internal' });
  } finally {
    log.info({ requestId, ms: Date.now() - startedAt });
  }
});
```

Trong 25 dòng đó, **1 dòng là nghiệp vụ**. 24 dòng còn lại là *cùng một thứ lặp lại ở mọi endpoint*: auth, phân quyền, validate, log, map lỗi, định dạng response.

Copy 24 dòng đó vào 80 endpoint là cách tạo ra một codebase mà không ai dám sửa: sửa format lỗi phải sửa 80 chỗ, và chỉ cần một endpoint quên `if (!user)` là có lỗ hổng.

NestJS trả lời bằng cách **rút 24 dòng đó ra khỏi handler và cắm chúng vào các khe cố định trên đường đi của request**. Mỗi loại việc có một khe riêng, và các khe có thứ tự cố định.

Cái giá phải trả: bạn không còn đọc được luồng thực thi bằng cách đọc từ trên xuống. Bạn phải **thuộc thứ tự các khe**. Đó là toàn bộ nội dung của note này.

## Mental Model

```text
                     ┌─────────────── NestJS ───────────────┐
HTTP  →  adapter  →  │ MIDDLEWARE  (req/res thô, kiểu Express) │
                     │      ↓                                  │
                     │ GUARD       "được đi tiếp không?"  → 403 │
                     │      ↓                                  │
                     │ INTERCEPTOR (trước)  bọc lấy handler    │
                     │      ↓                                  │
                     │ PIPE        "dữ liệu có đúng dạng?" →400│
                     │      ↓                                  │
                     │ CONTROLLER  → SERVICE → REPOSITORY      │
                     │      ↓                                  │
                     │ INTERCEPTOR (sau)   biến đổi kết quả    │
                     │      ↓                                  │
                     │ EXCEPTION FILTER  chỉ chạy khi có lỗi   │
                     └─────────────────────────────────────────┘
                                    ↓  HTTP response
```

Mỗi khe trả lời **một câu hỏi khác nhau**, và đó là cách chọn khe:

| Khe | Câu hỏi nó trả lời | Trả về gì | Ví dụ điển hình |
|---|---|---|---|
| Middleware | "có cần đụng vào req/res thô không?" | gọi `next()` | body parser, helmet, raw body cho webhook |
| Guard | "request này **được phép** đi tiếp không?" | `boolean` | JWT auth, RBAC, ownership, feature flag |
| Interceptor | "tôi cần **bọc** quanh handler không?" | Observable | logging, timing, cache, transform response, timeout |
| Pipe | "**giá trị** này có hợp lệ / đúng kiểu không?" | giá trị đã transform | `ValidationPipe`, `ParseIntPipe` |
| Filter | "lỗi này nên thành response nào?" | response | map `DomainError` → HTTP status |

Một câu để nhớ: **guard nói _có/không_, pipe nói _giá trị nào_, interceptor nói _bọc thế nào_, filter nói _hỏng thì trả gì_.**

## How It Works

### Thứ tự đầy đủ (NestJS 10/11)

Đây là thứ tự chính thức, và bạn nên thuộc nó như thuộc bảng cửu chương:

```text
 1. request tới
 2. middleware bind toàn cục   (app.use)
 3. middleware bind theo module (configure(consumer))
 4. guard toàn cục
 5. guard của controller
 6. guard của route
 7. interceptor toàn cục      (phần TRƯỚC controller)
 8. interceptor của controller (phần TRƯỚC)
 9. interceptor của route      (phần TRƯỚC)
10. pipe toàn cục
11. pipe của controller
12. pipe của route
13. pipe của tham số           (@Body(), @Param(), ...)
14. CONTROLLER — method handler
15. service / domain / repository
16. interceptor của route      (phần SAU)
17. interceptor của controller (phần SAU)
18. interceptor toàn cục       (phần SAU)
19. exception filter           (route → controller → toàn cục)
20. response đi ra
```

Hai điều quan trọng nhất trong bảng này, và cả hai đều phản trực giác:

**(a) Guard chạy TRƯỚC pipe.**
Nghĩa là khi guard chạy, `request.body` **vẫn là JSON thô chưa validate, chưa transform**. Một guard đọc `request.body.projectId` sẽ nhận `string` chứ không phải `number`, và nhận cả những field mà `whitelist` sẽ loại bỏ sau đó. Đây là nguồn lỗi phân quyền thật: guard kiểm tra `body.ownerId` mà attacker tự đặt.

**(b) Interceptor bọc hai đầu, và phần "sau" chạy ngược thứ tự.**
Interceptor giống `try/finally` quấn quanh handler:

```text
global(pre) → controller(pre) → route(pre) → HANDLER → route(post) → controller(post) → global(post)
```

Vì thế interceptor toàn cục là nơi đúng để đo tổng thời gian: nó là lớp ngoài cùng ở cả hai chiều.

### Middleware — trạm duy nhất chưa "biết" Nest

```ts
// middleware chạy ở tầng adapter (Express/Fastify), TRƯỚC khi Nest dựng ExecutionContext
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    req.headers['x-request-id'] ??= randomUUID();
    next();
  }
}
```

Hệ quả thực tế của việc "chưa biết Nest":

- Middleware **không** nhận `ExecutionContext`, nên **không** đọc được metadata đặt bằng decorator (`Reflector`). Muốn đọc `@Public()` hay `@Roles()` → phải dùng guard, không dùng middleware.
- Middleware bind theo **đường dẫn** (`forRoutes('tasks')`), không bind theo class/method.
- Lỗi ném trong middleware đi theo cơ chế xử lý lỗi của **adapter**, không đảm bảo đi qua exception filter của bạn. Đây là thứ phải **kiểm chứng bằng experiment** trong phiên bản bạn đang dùng, chứ không nên giả định — xem phần *Break It*.

Vì vậy quy tắc thực dụng: **middleware chỉ dùng cho việc thao tác `req`/`res` thô hoặc gắn thư viện Express có sẵn.** Mọi thứ liên quan tới nghiệp vụ hoặc metadata đều thuộc guard/interceptor.

### Guard — chỉ trả lời có/không

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // metadata từ decorator — thứ mà middleware không làm được
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),   // ưu tiên route
      context.getClass(),     // rồi tới controller
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException();       // → 401

    req.user = await this.tokens.verify(token);          // gắn vào request cho tầng sau
    return true;
  }
}
```

Hai chi tiết hay sai:

1. `return false` → Nest ném `ForbiddenException` → **403**. Nếu bạn muốn **401** (chưa đăng nhập, khác với "đã đăng nhập nhưng không đủ quyền"), phải `throw new UnauthorizedException()`. Trả `false` cho trường hợp thiếu token là bug ngữ nghĩa: client không biết là nên đăng nhập lại hay là bị cấm.
2. `getAllAndOverride` với thứ tự `[handler, class]` cho phép route ghi đè controller. Đảo thứ tự thành `[class, handler]` làm `@Public()` trên route bị controller nuốt mất — một lỗ hổng im lặng theo chiều ngược lại.

### Interceptor — nơi duy nhất bọc được cả hai đầu

```ts
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();          // TRƯỚC handler
    const { method, url } = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => log.info({ method, url, ms: Date.now() - startedAt })),   // SAU, khi thành công
      catchError((err) => {                                              // SAU, khi lỗi
        log.warn({ method, url, ms: Date.now() - startedAt, err: err.message });
        return throwError(() => err);      // ném tiếp cho filter — KHÔNG nuốt
      }),
    );
  }
}
```

`next.handle()` trả về `Observable`. Mọi thứ bạn viết **trước** dòng `return` chạy trước handler; mọi thứ trong `.pipe(...)` chạy sau.

Ba việc chỉ interceptor làm được:

```ts
// bọc response theo một hình dạng thống nhất
return next.handle().pipe(map((data) => ({ data })));

// timeout — cắt handler chạy quá lâu
return next.handle().pipe(timeout(5_000));

// cache — TRẢ VỀ LUÔN, không gọi handler
const hit = await this.cache.get(key);
if (hit) return of(hit);        // handler không bao giờ chạy
return next.handle().pipe(tap((v) => this.cache.set(key, v, 60)));
```

Cái cuối cùng là điểm mấu chốt: interceptor có thể **thay thế** handler, guard thì không.

### Pipe — làm việc trên giá trị, không phải trên request

```ts
@Post()
create(@Body() dto: CreateTaskDto, @Param('id', ParseIntPipe) id: number) {}
```

Pipe nhận **một giá trị** và trả về giá trị (đã transform) hoặc ném lỗi. Nó không biết gì về response, không biết về route.

`ValidationPipe` là pipe quan trọng nhất và nên bật toàn cục:

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,             // xoá field không khai báo trong DTO
  forbidNonWhitelisted: true,  // hoặc: 400 nếu có field lạ
  transform: true,             // biến plain object thành instance của DTO
  transformOptions: { enableImplicitConversion: false },   // xem note 03 — vì sao false
}));
```

Chi tiết đầy đủ: [Validation & errors](03-validation-errors.md).

### Exception filter — chỉ chạy khi có lỗi

```ts
@Catch()                                    // không tham số = bắt tất cả
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) log.error({ err: exception, url: req.url });   // chỉ log 5xx là error

    res.status(status).json({
      error: { code: status >= 500 ? 'internal_error' : 'request_error', requestId: req.id },
    });
  }
}
```

Filter phạm vi hẹp thắng filter phạm vi rộng: route → controller → global. Chỉ **một** filter xử lý mỗi lỗi.

### Đăng ký enhancer: `useGlobalX()` vs `APP_X` — khác biệt thật

```ts
// ❌ Toàn cục nhưng NGOÀI DI container → không inject được gì
app.useGlobalGuards(new JwtAuthGuard(/* lấy Reflector ở đâu? */));

// ✅ Toàn cục và VẪN nằm trong DI container
@Module({
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
```

Đây là một trong những nhầm lẫn tốn thời gian nhất khi mới dùng Nest: `useGlobalGuards` tạo instance bằng tay, nên guard đó không có `Reflector`, không có `ConfigService`, không có repository. Triệu chứng là `Cannot read properties of undefined` bên trong guard — trông như bug logic nhưng thật ra là bug đăng ký.

Quy tắc: **enhancer toàn cục cần dependency → luôn dùng `APP_GUARD` / `APP_INTERCEPTOR` / `APP_PIPE` / `APP_FILTER`.**

### Ngữ cảnh xuyên tầng: request ID đi từ middleware tới repository thế nào?

Chuỗi trạm là tuyến tính nhưng **không có tham số nào được truyền dọc theo nó**. Hai cách:

```ts
// (1) gắn lên request — đơn giản, nhưng service phải nhận req → rò rỉ tầng HTTP vào domain
req.requestId = id;

// (2) AsyncLocalStorage — service không cần biết HTTP tồn tại
const als = new AsyncLocalStorage<{ requestId: string }>();
// middleware/interceptor:  als.run({ requestId }, () => next());
// logger ở bất kỳ đâu:     als.getStore()?.requestId
```

Cách (2) là nền của correlation ID trong log. Xem [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).

## Example

Bật log ở **mọi** trạm rồi gửi 3 request. Đây là experiment quan trọng nhất của note này:

```ts
// main.ts — dán vào và chạy
app.use((req, _res, next) => { console.log('1 middleware'); next(); });

@Injectable() class LogGuard implements CanActivate {
  canActivate() { console.log('2 guard'); return true; }
}
@Injectable() class LogInterceptor implements NestInterceptor {
  intercept(_c: ExecutionContext, next: CallHandler) {
    console.log('3 interceptor pre');
    return next.handle().pipe(tap(() => console.log('6 interceptor post')));
  }
}
@Injectable() class LogPipe implements PipeTransform {
  transform(v: unknown) { console.log('4 pipe'); return v; }
}
@Catch() class LogFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) { console.log('7 filter'); /* ... */ }
}

@Controller('tasks')
export class TasksController {
  @Post()
  create(@Body(LogPipe) dto: CreateTaskDto) {
    console.log('5 controller');
    if (dto.title === 'boom') throw new BadRequestException('boom');
    return { ok: true };
  }
}
```

Ba request để gửi:

```bash
curl -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"a"}'
curl -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"boom"}'
curl -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{}'   # DTO fail
```

## Prediction

Viết ra giấy **trước khi chạy**:

1. Request 1 (`title: "a"`) in ra thứ tự nào?
2. Request 2 (`title: "boom"`, controller ném lỗi) — `6 interceptor post` có in không? `7 filter` in trước hay sau nó?
3. Request 3 (DTO fail ở `ValidationPipe`) — những số nào **không** được in?
4. Nếu `LogGuard` trả `false`, những số nào không in? Client nhận status nào?
5. Guard đọc `request.body.projectId` khi client gửi `"projectId": "7"` — guard thấy `7` hay `"7"`?
6. Interceptor có `catchError` mà **không** ném lại lỗi — filter có chạy không? Client nhận gì?
7. Handler dùng `@Res() res` và tự gọi `res.json()` — interceptor `map((d) => ({ data: d }))` còn tác dụng không?
8. Đăng ký guard bằng `app.useGlobalGuards(new JwtAuthGuard(...))` mà guard cần `Reflector` — lỗi xảy ra lúc nào: khởi động hay lúc có request?

<details>
<summary>Đáp án</summary>

1. `1 → 2 → 3 → 4 → 5 → 6`. Filter không chạy vì không có lỗi.
2. `6` **không** in — `tap()` chỉ chạy ở nhánh thành công. Thứ tự: `1 2 3 4 5 7`. Interceptor chạy trước filter trên đường ra, nhưng vì lỗi nên chỉ nhánh error của interceptor chạy.
3. `5` và `6` không in. Pipe ném trước khi tới controller → `1 2 3 4 7`.
4. Chỉ `1 2` in. Client nhận **403** (Nest tự ném `ForbiddenException` khi guard trả `false`).
5. Thấy `"7"` — **string**. Pipe chạy sau guard, chưa transform gì cả.
6. Filter **không** chạy; interceptor đã nuốt lỗi. Client nhận `200` với body rỗng hoặc `undefined` — một trong những bug khó chịu nhất vì monitoring thấy toàn 200.
7. Không. Dùng `@Res()` là bạn nhận trách nhiệm gửi response; Nest không đụng vào nữa nên interceptor biến đổi body trở nên vô hiệu.
8. Lúc **có request** (khi `this.reflector` là `undefined`), không phải lúc khởi động — vì thế nó thường lọt qua smoke test.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Guard `return false` thay vì `throw new UnauthorizedException()` | Client nhận 403 thay vì 401 — frontend không biết nên redirect tới login |
| Đảo `getAllAndOverride([class, handler])` | `@Public()` trên route bị bỏ qua → endpoint public bị chặn, hoặc ngược lại |
| Ném lỗi trong middleware | Xem lỗi có đi qua exception filter của bạn không, hay ra format mặc định của adapter |
| Interceptor `catchError` không `throwError` | 200 OK với body rỗng; alert 5xx im lặng |
| Đăng ký filter bằng `useGlobalFilters(new F(logger))` rồi inject provider | `undefined` khi có lỗi — filter chết trong lúc xử lý lỗi khác |
| Đọc `req.body` trong guard rồi so sánh `=== 7` | Luôn false vì body là string |
| `@Res()` trong handler + interceptor `map` | Response không được bọc; interceptor im lặng vô hiệu |
| Bỏ `whitelist: true` rồi gửi thêm `{"role":"admin"}` | Field lạ đi thẳng vào service — kiểm tra xem nó có tới DB không |
| Interceptor `timeout(100)` + handler `sleep(500)` | Client nhận 504/`RequestTimeoutException`; **handler vẫn chạy tiếp** — kiểm tra DB có bị ghi không |
| Hai global interceptor, cái ngoài đo thời gian | Xác nhận cái ngoài bao trọn cái trong ở cả hai chiều |

Cái áp chót đáng dừng lại: `timeout()` **không huỷ** công việc đang chạy. Nó chỉ ngừng chờ. Nếu handler đang chạy `INSERT`, `INSERT` đó vẫn hoàn tất sau khi client đã nhận lỗi. Xem [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## What Usually Goes Wrong

- **Đặt logic auth vào middleware** → không đọc được `@Public()`/`@Roles()`, phải hardcode danh sách path, và danh sách đó sẽ lệch với thực tế sau 3 tháng.
- **Guard đọc body chưa validate** → so sánh sai kiểu, hoặc tin vào field mà client tự đặt.
- **Enhancer toàn cục đăng ký bằng `new`** → `undefined` dependency lúc runtime.
- **Interceptor nuốt lỗi** → lỗi biến mất khỏi log và khỏi metric.
- **Filter quá rộng đè filter hẹp** — không xảy ra (hẹp thắng), nhưng người ta hay tưởng ngược lại rồi viết filter global "để chắc" và thắc mắc vì sao nó không chạy.
- **Trộn `@Res()` với interceptor/filter** → hành vi khó đoán; nếu buộc phải dùng `@Res()`, dùng `@Res({ passthrough: true })` để giữ Nest điều khiển response.
- **Logic nghiệp vụ trong guard** (ví dụ: ghi audit log, tăng counter) → guard chạy cả khi request sau đó fail validation, dữ liệu audit sai.
- **Không thuộc thứ tự** → mỗi lần "sao cái này không chạy" lại mất 40 phút.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Middleware và guard là như nhau | Middleware ở tầng adapter, không có `ExecutionContext`, không đọc được metadata |
| Pipe chạy trước guard (vì validate là việc "đầu tiên") | Guard chạy **trước**. Guard thấy dữ liệu thô |
| Interceptor chỉ chạy sau controller | Chạy **cả hai đầu**; là nơi duy nhất bọc được handler |
| Guard `return false` = 401 | = **403** |
| Filter bắt được mọi lỗi trong app | Không chắc với lỗi trong middleware; và interceptor có thể nuốt lỗi trước |
| `useGlobalGuards` và `APP_GUARD` tương đương | Chỉ `APP_GUARD` nằm trong DI container |
| Interceptor `timeout()` huỷ được handler | Chỉ ngừng chờ; handler chạy tới cùng |
| Thứ tự interceptor "sau" giống thứ tự "trước" | Ngược lại (route → controller → global) |
| Nest tự validate DTO vì DTO có type TypeScript | Type biến mất khi compile; phải có `ValidationPipe` + decorator |

Cái cuối là hệ quả trực tiếp của [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md).

## Debugging

Khi "một thứ không chạy", đi theo đúng thứ tự này:

1. **Request có tới app không?** Log ở middleware toàn cục đầu tiên. Không có log → vấn đề ở proxy/route/port, chưa phải Nest.
2. **Route có khớp không?** Bật `NestApplication` log lúc khởi động — Nest in ra mọi route đã map (`Mapped {/tasks, POST} route`). Không thấy route → controller chưa được khai báo trong module.
3. **Trạm nào là trạm cuối cùng chạy?** Thêm `console.log` vào từng khe theo thứ tự 1–20 ở trên. Trạm đầu tiên **không** in ra chính là nơi request dừng.
4. **Nếu dừng ở guard** → in giá trị `canActivate` trả về và metadata mà `Reflector` đọc được.
5. **Nếu dừng ở pipe** → in payload thô (`console.log(JSON.stringify(req.body))`) rồi so với DTO.
6. **Nếu response sai hình dạng** → kiểm tra có `@Res()` không, và có interceptor nào `map` không.
7. **Nếu lỗi không xuất hiện trong log** → tìm `catchError` không ném lại, và tìm filter đang log ở mức `warn`.
8. **Nếu enhancer bị `undefined` dependency** → kiểm tra cách đăng ký (`new` hay `APP_*`).

Bước 3 là bước quyết định và nó rẻ. Đừng đoán trước khi làm bước 3.

## Production Considerations

- **Interceptor toàn cục đo thời gian + log** là hạ tầng quan sát rẻ nhất bạn có: một chỗ, mọi endpoint. Log `method`, `route pattern` (không phải URL đầy đủ — tránh nổ cardinality), `status`, `duration_ms`, `requestId`, `userId`.
- **Route pattern chứ không phải URL**: `/tasks/:id` chứ không phải `/tasks/8213`. Nếu không, metric của bạn có hàng triệu label. Xem [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md).
- **`timeout()` toàn cục** (ví dụ 10s) chặn được handler treo vô hạn, nhưng nhớ nó không huỷ việc đang chạy — timeout phải đi kèm timeout ở tầng DB/HTTP client.
- **Filter không được ném lỗi.** Lỗi trong filter làm process trả 500 trống hoặc treo connection. Bọc thân filter trong `try/catch`.
- **Không log body mặc định.** Body chứa mật khẩu, token, PII. Nếu cần, đi qua một hàm redact có allowlist.
- **Thứ tự enhancer là hợp đồng.** Khi thêm guard mới, ghi rõ nó phụ thuộc guard nào chạy trước (ví dụ `RolesGuard` yêu cầu `JwtAuthGuard` đã gắn `req.user`). Nest **không** đảm bảo thứ tự giữa hai `APP_GUARD` khác module một cách hiển nhiên — thứ tự theo thứ tự provider được đăng ký, nên hãy khai báo chúng cùng một chỗ.
- **AsyncLocalStorage** cho correlation ID có chi phí nhỏ nhưng khác 0. Đo trước khi lo.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Chuỗi enhancer cố định | Không lặp code; bảo mật áp dụng đồng đều | Không đọc được luồng từ trên xuống; phải thuộc thứ tự |
| Guard toàn cục + `@Public()` opt-out | Mặc định an toàn: quên đánh dấu = bị chặn, không phải bị hở | Endpoint public phải nhớ đánh dấu |
| Guard theo route + không có guard toàn cục | Rõ ràng ở từng endpoint | Quên một endpoint = lỗ hổng im lặng |
| Interceptor bọc response `{ data }` | Client có hình dạng nhất quán | Thêm một lớp phải nhớ khi debug; khó khi cần trả file/stream |
| Middleware cho Express lib có sẵn | Dùng lại hệ sinh thái | Không truy cập metadata, khó test |
| `AsyncLocalStorage` | Domain không biết HTTP tồn tại | Thêm khái niệm ẩn; overhead nhỏ |

Lựa chọn mặc định nên là **guard toàn cục + `@Public()`**: hướng lỗi của nó là "chặn nhầm" (phát hiện ngay lập tức) chứ không phải "hở nhầm" (phát hiện sau khi bị khai thác).

## Explain Without Notes

1. Kể lại 6 khe theo đúng thứ tự và nói mỗi khe trả lời câu hỏi gì.
2. Vì sao logic phân quyền phải nằm ở guard chứ không phải middleware?
3. Guard chạy trước pipe gây ra hệ quả gì cho dữ liệu mà guard nhìn thấy?
4. Interceptor khác gì guard, khi cả hai đều "chặn được request"?
5. Vì sao `app.useGlobalGuards(new X())` và `APP_GUARD` không tương đương?
6. Một endpoint trả 200 nhưng body rỗng và không có log lỗi — nghi ngờ trạm nào đầu tiên?

## Related

- [HTTP request/response](../00-http-api/01-http-request-response.md) — thứ đi vào chuỗi này
- [Modules & DI](02-modules-di.md) — enhancer lấy dependency từ đâu
- [Validation & errors](03-validation-errors.md) — trạm pipe, chi tiết
- [Guards & interceptors](04-guards-interceptors.md) — trạm guard/interceptor, chi tiết
- [Controller → Service → Repository](../04-architecture/01-controller-service-repository.md) — cái gì xảy ra ở bước 14–15
- [Error model](../00-http-api/05-error-model.md) — filter nên trả hình dạng nào
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — ngữ cảnh xuyên chuỗi
- [Node runtime & concurrency](../01-nodejs/01-node-runtime-concurrency.md) — chuỗi này chạy trên event loop nào

## Version / Context

NestJS 10/11, platform Express (mặc định). Với Fastify adapter, khái niệm middleware và cách bind hơi khác nhưng thứ tự guard → interceptor → pipe → controller giữ nguyên.
