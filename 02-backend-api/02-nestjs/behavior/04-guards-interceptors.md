---
level: intermediate
area: backend
prerequisites:
  - 01-request-lifecycle.md
  - 02-modules-di.md
related:
  - ../../03-auth/06-authorization-models.md
  - ../../../05-cross-cutting/security/04-access-control.md
  - ../../../05-cross-cutting/observability/03-correlation-tracing.md
---

# Guards & interceptors

> Endpoint `GET /tasks/:id` có `@UseGuards(JwtAuthGuard)`. User B đăng nhập hợp lệ, gọi `GET /tasks/<id của user A>`, và nhận về task của A. Guard đã chạy đúng. Guard đã trả `true` đúng. Lỗ hổng nằm ở chỗ *câu hỏi mà guard trả lời* không phải câu hỏi cần trả lời.

## Position

```text
middleware → GUARD → INTERCEPTOR(pre) → pipe → controller → service
                          │                                    │
                          └──────── INTERCEPTOR(post) ◀─────────┘
```

Guard và interceptor là hai khe duy nhất trong NestJS **hiểu được ngữ cảnh của Nest**: chúng nhận `ExecutionContext`, nên đọc được metadata từ decorator, biết controller nào và method nào đang chạy. Đó là điều middleware không làm được, và là lý do mọi logic bảo mật và quan sát sống ở đây.

## Problem

Hai vấn đề tách biệt, cùng được giải bằng hai khe này.

**Vấn đề 1 — phân quyền bị rải ra khắp nơi.**

```ts
@Get(':id')
async findOne(@Param('id') id: string, @Req() req) {
  if (!req.user) throw new UnauthorizedException();
  const task = await this.tasks.findById(id);
  if (!task) throw new NotFoundException();
  if (task.ownerId !== req.user.id && !req.user.roles.includes('admin'))
    throw new ForbiddenException();
  return task;
}
```

Nhân 80 endpoint. Kết quả có thể dự đoán được: **một endpoint sẽ quên dòng thứ ba**, và không có test nào bắt được vì test viết theo happy path. Lỗ hổng loại này (broken access control) đứng đầu OWASP Top 10 không phải vì nó khó hiểu, mà vì nó dễ quên.

**Vấn đề 2 — cùng một việc "bọc quanh" lặp ở mọi handler.**

```ts
const t0 = Date.now();
try { ... } finally { log.info({ ms: Date.now() - t0 }); }
```

Đo thời gian, log, cache, timeout, bọc response, redact field nhạy cảm — tất cả đều là *quấn quanh* handler, và tất cả đều giống nhau ở mọi endpoint.

## Mental Model

```text
GUARD        →  boolean          →  "request này ĐƯỢC đi tiếp không?"
                                    chạy TRƯỚC, không thấy kết quả
INTERCEPTOR  →  Observable       →  "tôi BỌC quanh handler thế nào?"
                                    thấy cả trước lẫn sau, thay thế được kết quả
```

Cách chọn nhanh:

| Bạn cần | Dùng |
|---|---|
| Chặn/cho qua theo điều kiện | Guard |
| Đo, log, thêm ngữ cảnh | Interceptor |
| Biến đổi giá trị trả về | Interceptor |
| Trả kết quả mà **không** chạy handler (cache hit) | Interceptor |
| Đặt timeout cho handler | Interceptor |
| Bắt/đổi lỗi trước khi tới filter | Interceptor |
| Đụng vào `req`/`res` thô, gắn thư viện Express | Middleware |
| Kiểm tra/ép kiểu **một giá trị** | Pipe |

Và ranh giới quan trọng nhất, thứ mà ví dụ mở đầu nói tới:

```text
AUTHENTICATION   — "anh là ai?"        → guard toàn cục, không cần biết dữ liệu
AUTHORIZATION    — "anh được làm gì?"
     ├── theo VAI TRÒ   (role)         → guard làm được: chỉ cần token
     └── theo QUAN HỆ   (ownership)    → guard làm được NHƯNG phải đọc DB
                                          → thường nên nằm ở SERVICE
```

Guard chỉ biết `request`. Nếu câu hỏi phân quyền cần biết **dữ liệu**, guard phải tự query — và đó là lúc phải cân nhắc.

## How It Works

### Guard + metadata: cơ chế `Reflector`

```ts
// decorator chỉ gắn metadata, không có logic
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata('isPublic', true);
```

```ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),    // metadata trên method — ưu tiên cao hơn
      context.getClass(),      // metadata trên controller
    ]);
    if (!required?.length) return true;                 // không khai báo = không yêu cầu

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new UnauthorizedException();       // 401, KHÔNG phải 403
    if (!required.some((r) => user.roles.includes(r)))
      throw new ForbiddenException(`requires one of: ${required.join(', ')}`);
    return true;
  }
}
```

Hai hàm của `Reflector`, và chúng có ngữ nghĩa khác nhau:

| Hàm | Hành vi | Dùng cho |
|---|---|---|
| `getAllAndOverride` | lấy giá trị **đầu tiên** tìm thấy | cờ bật/tắt: `@Public()`, `@SkipCache()` |
| `getAllAndMerge` | **gộp** mọi giá trị tìm thấy | tích luỹ: role của controller + role của route |

Chọn sai làm quyền bị nới hoặc bị siết ngoài ý muốn. Ví dụ: controller `@Roles('member')`, route `@Roles('admin')`. `override` → chỉ cần `admin`. `merge` → chấp nhận `member` **hoặc** `admin` (vì code dùng `some`), tức là route "chặt hơn" lại hoá ra dễ hơn.

Và thứ tự mảng cũng là ngữ nghĩa: `[handler, class]` cho phép route ghi đè controller (đúng, phổ biến). Đảo lại thì `@Public()` trên một route bị controller nuốt — một lỗ hổng, hoặc một endpoint public bị chặn mà không ai hiểu vì sao.

### Guard toàn cục "mặc định đóng" — mô hình nên dùng

```ts
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },   // chạy trước
    { provide: APP_GUARD, useClass: RolesGuard },     // chạy sau, dùng req.user
  ],
})
export class AuthModule {}
```

```ts
@Public()                       // opt-out tường minh
@Post('login')
login() {}
```

Vì sao mô hình này quan trọng hơn nó trông có vẻ: nó **đảo chiều của lỗi**.

```text
Opt-in  (@UseGuards trên từng route):  quên  ⇒ endpoint HỞ    (im lặng, phát hiện khi bị khai thác)
Opt-out (guard toàn cục + @Public()):  quên  ⇒ endpoint CHẶN  (ồn ào, phát hiện trong 5 phút)
```

Thiết kế hệ thống bảo mật là thiết kế **hướng của lỗi khi con người quên**. Không phải giả định con người không quên.

Thứ tự giữa nhiều `APP_GUARD` theo thứ tự khai báo trong mảng `providers`. `RolesGuard` phụ thuộc `req.user` do `JwtAuthGuard` gắn, nên khai báo cả hai **trong cùng một module, cùng một mảng** — không rải ra hai module rồi hy vọng thứ tự đúng.

### Ownership: guard hay service?

Đây là quyết định thật, và cả hai đều có người dùng.

```ts
// PHƯƠNG ÁN A — guard đọc DB
@Injectable()
export class TaskOwnerGuard implements CanActivate {
  constructor(private readonly tasks: TasksService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const task = await this.tasks.findById(req.params.id);   // +1 query
    if (!task) throw new NotFoundException();
    if (task.ownerId !== req.user.id) throw new ForbiddenException();
    req.task = task;                                          // tránh query lần 2
    return true;
  }
}
```

```ts
// PHƯƠNG ÁN B — service tự kiểm tra, và query đã lọc sẵn
async findOneForUser(taskId: string, userId: string) {
  const task = await this.repo.findOne({ where: { id: taskId, ownerId: userId } });
  if (!task) throw new NotFoundError('task not found');       // 404, không phải 403
  return task;
}
```

| | Guard (A) | Service (B) |
|---|---|---|
| Áp dụng đồng đều | ✓ khai báo là có | ✗ phải nhớ ở mỗi method |
| Query thừa | +1 query, hoặc phải nhét vào `req` | 0 — điều kiện nằm trong `WHERE` |
| Dùng được ngoài HTTP (queue, cron) | ✗ | ✓ |
| Rò rỉ sự tồn tại | 403 tiết lộ "id này có tồn tại" | 404 không tiết lộ gì |
| Kiểm tra phức tạp (nhiều bảng) | cồng kềnh | tự nhiên |

Điểm thứ tư đáng dừng lại: trả **403** cho tài nguyên của người khác là một rò rỉ thông tin. Attacker duyệt ID và phân biệt được "không tồn tại" (404) với "tồn tại nhưng của người khác" (403). Với dữ liệu nhạy cảm, trả **404 cho cả hai** là lựa chọn đúng.

Quy tắc thực dụng: **role → guard; ownership và quy tắc phụ thuộc dữ liệu → service, và đưa điều kiện vào `WHERE`.** Guard cho ownership chỉ dùng khi bạn có nhiều endpoint trên cùng một tài nguyên và muốn đảm bảo không sót. Xem [Authorization models](../../03-auth/06-authorization-models.md) và [Access control](../../../05-cross-cutting/security/04-access-control.md).

### Interceptor: bốn mẫu bao trọn 90% nhu cầu

```ts
// 1. LOG + ĐO THỜI GIAN — hạ tầng quan sát rẻ nhất bạn có
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const t0 = process.hrtime.bigint();
    const base = {
      method: req.method,
      route: req.route?.path ?? 'unknown',   // PATTERN, không phải URL — tránh nổ cardinality
      requestId: req.id,
      userId: req.user?.id,
    };
    return next.handle().pipe(
      tap({
        next:  ()    => log.info({ ...base, status: 'ok',    ms: ms(t0) }),
        error: (err) => log.warn({ ...base, status: 'error', ms: ms(t0), code: err?.code }),
      }),
    );
  }
}
```

```ts
// 2. BỌC RESPONSE — hình dạng nhất quán cho client
return next.handle().pipe(map((data) => ({ data })));
```

```ts
// 3. TIMEOUT — chặn handler treo vô hạn
return next.handle().pipe(
  timeout(5_000),
  catchError((e) => throwError(() =>
    e instanceof TimeoutError ? new RequestTimeoutException() : e)),
);
```

```ts
// 4. CACHE — trả về mà KHÔNG chạy handler
const key = `${req.method}:${req.originalUrl}:${req.user?.id ?? 'anon'}`;
const hit = await this.cache.get(key);
if (hit) return of(hit);                                    // handler không chạy
return next.handle().pipe(tap((v) => this.cache.set(key, v, 60)));
```

Mẫu 4 là năng lực riêng của interceptor: nó **thay thế** handler. Nhưng để ý `req.user?.id` trong key — thiếu nó là lỗ hổng cache nghiêm trọng: user B nhận response đã cache của user A. Xem [Cache patterns](../../../03-database/02-redis/03-cache-patterns.md).

Về mẫu 3, một điều phải nói rõ: **`timeout()` không huỷ công việc đang chạy.** Nó chỉ ngừng chờ và ném lỗi. Query PostgreSQL vẫn chạy tới cùng, `INSERT` vẫn commit. Timeout ở tầng này phải đi kèm timeout thật ở tầng dưới (`statement_timeout`, timeout của HTTP client). Xem [Timeout, retry & circuit breaker](../../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

### `ClassSerializerInterceptor` — nơi mật khẩu bị rò rỉ

```ts
export class User {
  id!: string;
  email!: string;
  @Exclude() passwordHash!: string;
  @Expose() get displayName() { return this.email.split('@')[0]; }
}

app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
```

Nó hoạt động bằng cách chạy `classToPlain` trên giá trị handler trả về. Ba điều kiện, và nếu thiếu một thì `@Exclude()` **im lặng không có tác dụng**:

1. Giá trị trả về phải là **instance của class**, không phải plain object. Prisma trả plain object → `@Exclude()` vô hiệu. Phải `plainToInstance(User, row)`.
2. Interceptor phải chạy — nếu handler dùng `@Res()` và tự gửi response thì không.
3. Mảng lồng nhau cần `@Type()` để serializer biết class của phần tử.

Vì "im lặng không có tác dụng" là chế độ hỏng, đừng coi `@Exclude()` là lớp phòng thủ duy nhất. Lớp chắc chắn hơn: **repository chỉ `SELECT` những cột được phép trả ra**. Không lấy `password_hash` khỏi DB thì không có gì để rò rỉ.

```ts
// an toàn theo thiết kế, không phụ thuộc decorator chạy đúng
this.prisma.user.findMany({ select: { id: true, email: true, createdAt: true } });
```

Và một test chống hồi quy đáng giá hơn mọi decorator:

```ts
it('never exposes passwordHash', async () => {
  const res = await request(app).get('/users/me').expect(200);
  expect(JSON.stringify(res.body)).not.toContain('passwordHash');
});
```

### Custom param decorator: sạch, và có một cái bẫy

```ts
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    return data ? user?.[data] : user;
  },
);

@Get('me')
me(@CurrentUser() user: AuthUser) { return user; }
```

Bẫy: `createParamDecorator` **không nằm trong DI container** — không inject được service vào nó. Và nó không thay thế guard: nếu `JwtAuthGuard` không chạy, `req.user` là `undefined` và decorator trả `undefined` một cách im lặng. Type khai báo `AuthUser` (không phải `AuthUser | undefined`) khiến TypeScript tin rằng nó luôn có. Đây là lý do nữa để guard là **toàn cục** chứ không phải per-route.

## Example

Kiểm chứng thứ tự và phạm vi bằng một endpoint duy nhất:

```ts
@Controller('tasks')
@UseGuards(RolesGuard)                 // guard cấp controller
@Roles('member')
export class TasksController {
  @Get(':id')
  @UseInterceptors(CacheInterceptor)   // interceptor cấp route
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tasks.findOneForUser(id, userId);
  }

  @Delete(':id')
  @Roles('admin')                      // ghi đè controller
  remove(@Param('id') id: string) { return this.tasks.remove(id); }
}
```

```bash
# token member  → GET ok, DELETE 403
# token admin   → cả hai ok  (nếu getAllAndOverride)
# không token   → 401 ở cả hai
# GET hai lần   → lần hai có chạy service không? (log ở service để biết)
```

## Prediction

1. Guard `return false` — client nhận status nào? Còn `throw new UnauthorizedException()`?
2. `getAllAndOverride([handler, class])` với controller `@Roles('member')` + route `@Roles('admin')` — token `member` gọi route đó, kết quả?
3. Đảo thành `[class, handler]` — kết quả đổi thế nào? Với `@Public()` trên route thì sao?
4. Guard đọc `request.body.projectId` khi client gửi `"7"` — guard so sánh với số `7` thì đúng hay sai? Vì sao?
5. Hai interceptor toàn cục A rồi B, cả hai log "in"/"out" — thứ tự 4 dòng log?
6. Interceptor `catchError` không `throwError` — filter chạy không? Client nhận gì? Metric 5xx thấy gì?
7. `timeout(100)` + handler `INSERT` mất 500ms — client nhận gì? Row có trong DB không?
8. Cache key không có `userId`, user A gọi rồi user B gọi — B thấy gì?
9. Prisma trả plain object, `@Exclude() passwordHash` — response có `passwordHash` không?
10. `@CurrentUser()` trên route mà `JwtAuthGuard` không chạy — giá trị là gì? TypeScript có cảnh báo không?
11. `APP_GUARD` `RolesGuard` khai báo **trước** `JwtAuthGuard` — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. `false` → **403**. `UnauthorizedException` → **401**. Với thiếu token, 401 mới đúng ngữ nghĩa — client cần biết là nên đăng nhập lại.
2. `override` lấy giá trị đầu tiên = `['admin']` → **403**.
3. Lấy `['member']` → cho qua. Đây là nới quyền ngoài ý muốn. Với `@Public()`: route đánh dấu public sẽ **không** được nhận ra → bị chặn.
4. **Sai** — body là `"7"` (string). Pipe chạy sau guard nên chưa transform.
5. `A in → B in → B out → A out`. Interceptor lồng nhau như `try/finally`.
6. Filter **không** chạy. Client nhận 200, body `undefined`. Metric thấy 100% thành công trong khi mọi request đều lỗi.
7. Client nhận 504/`RequestTimeoutException`. Row **vẫn có** trong DB — timeout không huỷ query.
8. B thấy dữ liệu của A. Lỗ hổng rò rỉ dữ liệu qua cache.
9. **Có.** `@Exclude()` chỉ hoạt động trên instance của class.
10. `undefined`, và TypeScript **không** cảnh báo vì decorator không tham gia kiểm kiểu ở đây.
11. `RolesGuard` chạy khi `req.user` chưa được gắn → luôn 401, kể cả token hợp lệ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi guard từ `throw UnauthorizedException` sang `return false` | Frontend có redirect tới login được nữa không? |
| Đảo thứ tự `[class, handler]` trong `getAllAndOverride` | Route `@Public()` bị chặn; route `@Roles('admin')` bị nới |
| Đổi `getAllAndOverride` → `getAllAndMerge` | Ai được phép làm gì thay đổi thế nào? |
| Xoá `@UseGuards` khỏi **một** route (mô phỏng "quên") | Với guard opt-in: không ai biết. Với guard toàn cục: không thể quên |
| Bỏ `userId` khỏi cache key, đăng nhập 2 tài khoản, gọi cùng endpoint | Rò rỉ dữ liệu chéo user |
| Interceptor `catchError` nuốt lỗi | 200 với body rỗng; dashboard 5xx sạch bóng |
| `timeout(100)` trên handler ghi DB | Client nhận lỗi nhưng row vẫn được tạo |
| Trả plain object từ Prisma với `@Exclude()` | `passwordHash` xuất hiện trong response |
| Dùng `@Res()` trong handler có `ClassSerializerInterceptor` | Serializer im lặng không chạy |
| Khai báo `RolesGuard` trước `JwtAuthGuard` | 401 cho mọi request có token hợp lệ |
| Guard ownership query DB, chạy load test | Đo số query mỗi request trước/sau |
| Gọi `GET /tasks/<id của người khác>` với token hợp lệ | 403 hay 404? Bạn vừa tiết lộ gì? |

## What Usually Goes Wrong

- **Chỉ có authentication, không có authorization.** Guard trả lời "anh là ai" rồi dừng. Ví dụ mở đầu note này.
- **Guard opt-in** → một endpoint bị quên, không ai biết cho tới khi bị khai thác.
- **`RolesGuard` chạy trước `JwtAuthGuard`** → 401 khắp nơi, và "sửa" bằng cách bỏ `RolesGuard`.
- **Guard đọc dữ liệu chưa validate** → so sánh sai kiểu, hoặc tin field do client tự đặt.
- **Interceptor nuốt lỗi** → mù hoàn toàn về lỗi thật.
- **Cache key thiếu chiều user/tenant** → rò rỉ dữ liệu.
- **Cache trên endpoint có tác dụng phụ** (POST/PATCH) → hành vi sai hoàn toàn.
- **`@Exclude()` được tin tưởng như lớp bảo vệ duy nhất** → rò rỉ khi tầng dữ liệu trả plain object.
- **Log URL đầy đủ thay vì route pattern** → cardinality nổ, hệ thống metric tính tiền theo series.
- **Log toàn bộ body/header** → mật khẩu và token vào log, và log thường có quyền truy cập rộng hơn DB.
- **403 cho tài nguyên của người khác** → rò rỉ sự tồn tại của tài nguyên.
- **Guard làm việc nặng** (query nhiều bảng) → mọi request trả giá, kể cả request sẽ fail validation ngay sau đó.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Guard = authentication | Guard là *cơ chế*; authentication và authorization là hai câu hỏi khác nhau |
| Đăng nhập rồi thì được truy cập tài nguyên của mình | Không có gì tự động ràng buộc "của mình" — phải viết ra |
| `return false` nghĩa là 401 | 403 |
| Guard thấy DTO đã validate | Guard chạy **trước** pipe |
| Interceptor chỉ chạy sau handler | Chạy cả hai đầu; và có thể thay thế handler |
| `timeout()` huỷ được query | Chỉ ngừng chờ |
| `@Exclude()` luôn bảo vệ field | Chỉ khi giá trị là instance của class và interceptor thật sự chạy |
| Ẩn nút trên UI là phân quyền | UI là gợi ý; API là nơi quyết định |
| Guard toàn cục làm chậm app | Chi phí gần như bằng 0 nếu nó không query DB |
| Thứ tự `APP_GUARD` không quan trọng | Nó là hợp đồng: guard sau phụ thuộc `req.user` của guard trước |

## Debugging

1. **Guard không chạy** → nó được đăng ký thế nào? `@UseGuards` trên route/controller, hay `APP_GUARD`? Log dòng đầu tiên của `canActivate`.
2. **Guard chạy nhưng luôn từ chối** → log giá trị `Reflector` đọc được. `undefined` = metadata không tới nơi (sai key, sai thứ tự mảng, decorator đặt sai chỗ).
3. **401 dù token hợp lệ** → thứ tự guard. `req.user` có tồn tại khi guard thứ hai chạy không?
4. **403 nhưng đáng lẽ được phép** → in `user.roles` và `required` cạnh nhau. Chín trên mười lần là lệch chuỗi (`'Admin'` vs `'admin'`).
5. **Interceptor không có tác dụng** → handler có dùng `@Res()` không? Có interceptor nào phía ngoài trả sớm không?
6. **Response sai hình dạng** → đếm số interceptor đang `map`. Hai cái cùng bọc `{ data }` cho ra `{ data: { data } }`.
7. **Lỗi biến mất khỏi log** → tìm `catchError` không ném lại.
8. **Dữ liệu của user khác xuất hiện** → kiểm tra cache key trước, rồi kiểm tra `WHERE` của query. Đây là hai nguyên nhân chiếm gần hết trường hợp.
9. **Không chắc guard nào đang chạy** → thêm `console.log(this.constructor.name)` vào mỗi guard. Thứ tự in ra là thứ tự thật.

## Production Considerations

- **Một `LoggingInterceptor` toàn cục** là thứ đầu tiên nên có: `method`, `route pattern`, `status`, `duration_ms`, `requestId`, `userId`. Từ đó ra được p50/p95/p99 theo endpoint mà không cần thêm gì.
- **Route pattern, không phải URL.** `/tasks/:id`, không phải `/tasks/8213`. Nếu không, mỗi ID là một time series.
- **Redact trước khi log**, bằng allowlist: chỉ log field bạn liệt kê, thay vì cố loại field nhạy cảm.
- **Guard toàn cục phải rẻ.** Verify JWT bằng chữ ký (không query DB) thì tốn micro giây. Nếu guard phải query DB mỗi request, đó là một quyết định về capacity — hãy cache có TTL ngắn và biết rằng bạn vừa tạo ra một cửa sổ mà quyền bị thu hồi vẫn còn hiệu lực.
- **Timeout phải có ở mọi tầng**, và tầng ngoài phải dài hơn tầng trong: `client > gateway > interceptor > HTTP client / statement_timeout`. Ngược lại thì timeout ngoài luôn nổ trước và bạn không bao giờ thấy lỗi thật.
- **Cache interceptor cần chiến lược invalidation** trước khi bật, không phải sau. Xem [Cache invalidation](../../../03-database/02-redis/01-cache-invalidation.md).
- **Đưa quyết định phân quyền vào audit log** khi từ chối: ai, tài nguyên nào, quyền nào thiếu. Đây là dữ liệu bạn sẽ cần khi có sự cố bảo mật, và bạn không thể lấy lại nó về sau.
- **Test phân quyền theo hướng phủ định.** Test "admin xoá được" là test happy path; test "member **không** xoá được" mới là test bảo vệ bạn. Xem [Testing NestJS](09-testing-nestjs.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Guard toàn cục + `@Public()` | không thể quên bảo vệ | endpoint public phải nhớ đánh dấu |
| Guard per-route | rõ ở nơi đọc | quên = lỗ hổng im lặng |
| Ownership ở guard | đồng đều, khai báo | +1 query; không dùng được ngoài HTTP |
| Ownership ở service (`WHERE`) | không query thừa, dùng lại được | phải nhớ ở mỗi method |
| 404 thay 403 | không rò rỉ sự tồn tại | khó debug hơn cho client hợp lệ |
| Interceptor bọc `{ data }` | client nhất quán | thêm lớp; vướng khi trả file/stream |
| Cache interceptor | giảm tải rõ rệt | stale data, rủi ro rò rỉ theo key |
| `ClassSerializerInterceptor` | khai báo gọn | im lặng khi không áp dụng được |
| `SELECT` cột tường minh | an toàn theo thiết kế | dài dòng, phải sửa khi thêm field |
| Log mọi request | quan sát tốt | chi phí lưu trữ, rủi ro PII |

## Explain Without Notes

1. Guard và interceptor khác nhau ở điều gì, ngoài "thứ tự chạy"?
2. Vì sao "guard toàn cục + opt-out" an toàn hơn "guard per-route", nói theo hướng của lỗi?
3. Khi nào ownership nên ở guard, khi nào nên ở service? Nêu hai lý do cho mỗi bên.
4. `getAllAndOverride` và `getAllAndMerge` khác nhau thế nào? Cho một ví dụ chọn sai gây nới quyền.
5. Vì sao `timeout()` trong interceptor không đủ để bảo vệ database?
6. Kể ba cách `@Exclude()` im lặng không hoạt động, và một cách chắc chắn hơn.

## Related

- [Request lifecycle](01-request-lifecycle.md) — vị trí và thứ tự
- [Modules & DI](02-modules-di.md) — vì sao `APP_GUARD` chứ không phải `useGlobalGuards`
- [Validation & errors](03-validation-errors.md) — pipe chạy **sau** guard
- [Authorization models](../../03-auth/06-authorization-models.md) — RBAC, ABAC, ownership, tenant
- [Access control](../../../05-cross-cutting/security/04-access-control.md) — lớp lỗ hổng này ở tầng cross-cutting
- [Rate limiting](../../00-http-api/07-rate-limiting.md) — một guard điển hình
- [Cache patterns](../../../03-database/02-redis/03-cache-patterns.md) — cache key và invalidation
- [Correlation ID & tracing](../../../05-cross-cutting/observability/03-correlation-tracing.md) — interceptor là nơi gắn ngữ cảnh
- [Timeout, retry & circuit breaker](../../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)

## Version / Context

NestJS 10/11. `CacheInterceptor` tách sang gói `@nestjs/cache-manager` từ Nest 10.
