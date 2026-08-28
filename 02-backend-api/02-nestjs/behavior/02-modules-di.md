---
level: intermediate
area: backend
prerequisites:
  - ../../01-nodejs/fundamentals/02-module-system.md
  - 01-request-lifecycle.md
related:
  - ../../04-architecture/02-modular-monolith.md
  - 09-testing-nestjs.md
  - 05-config-lifecycle.md
---

# Modules & Dependency Injection

> `Nest can't resolve dependencies of the TasksService (?, ProjectsService)`. Dấu `?` là toàn bộ thông tin bạn được cho. Note này giải thích dấu `?` đó nghĩa là gì và vì sao nó xuất hiện.

## Position

```text
Bootstrap:   main.ts → AppModule → module graph → DI container → instantiate providers
                                        ↑ note này (xảy ra MỘT LẦN, lúc khởi động)

Runtime:     request → guard → controller ← (đã được tiêm sẵn) ← service ← repository
```

Điểm quan trọng nhất về vị trí: **DI xảy ra lúc khởi động, không phải lúc có request.** Mọi lỗi DI là lỗi *thời điểm bootstrap*, và đó là lý do chúng làm app không start được thay vì trả 500.

## Problem

Không có DI, code khởi tạo dependency ngay tại nơi dùng:

```ts
class TaskService {
  private readonly repo = new TaskRepository(new PgPool({ host: process.env.DB_HOST }));
  private readonly mailer = new SmtpMailer(process.env.SMTP_URL!);
}
```

Bốn thứ hỏng cùng lúc:

1. **Không test được.** Muốn test `TaskService` phải có PostgreSQL thật và SMTP thật. Test trở nên chậm và giòn, nên không ai viết.
2. **Không thay được implementation.** Đổi `SmtpMailer` → `SesMailer` phải sửa file service.
3. **Lifecycle sai.** Mỗi `TaskService` tạo một `PgPool` mới. 5 service → 5 pool → cạn connection ở DB. Xem [Connection pool](../../../03-database/01-postgresql/fundamentals/02-connection-pool.md).
4. **Thứ tự khởi tạo ẩn.** `process.env.DB_HOST` được đọc lúc class được import — trước khi `dotenv` chạy thì nó là `undefined`, và bạn phát hiện điều đó ở production.

DI giải quyết bằng cách **đảo ngược ai chịu trách nhiệm tạo**: class chỉ *khai báo* nó cần gì; container *quyết định* tạo thế nào, tạo bao nhiêu bản, và theo thứ tự nào.

```ts
class TaskService {
  constructor(
    private readonly repo: TaskRepository,   // "tôi cần cái này"
    private readonly mailer: Mailer,          // "tôi cần một Mailer, bất kỳ"
  ) {}
}
```

Cái giá phải trả: đường đi từ "tôi cần" tới "cái được tiêm vào" trở nên **vô hình**. Bạn không đọc được nó trong file service. Bạn phải đọc module graph.

## Mental Model

DI container của Nest là **một cái `Map` khổng lồ** được dựng lúc khởi động:

```text
Map<Token, Instance>
  TaskRepository        → TaskRepository { pool: <PgPool#1> }
  'MAILER'              → SesMailer { ... }
  ConfigService         → ConfigService { ... }
  TaskService           → TaskService { repo: ↑, mailer: ↑ }
```

Ba khái niệm, và mọi lỗi DI đều là một trong ba:

```text
TOKEN     — cái khoá tra trong Map. Mặc định là chính class. Có thể là string/Symbol.
PROVIDER  — công thức tạo ra giá trị cho một token.
MODULE    — PHẠM VI nhìn thấy. Quyết định token nào tra được từ đâu.
```

Và quy tắc phạm vi — quy tắc quan trọng nhất của toàn bộ NestJS:

> Một class trong module `A` chỉ tiêm được token mà **`A` khai báo trong `providers`**, hoặc token mà **một module `A` `imports` đã `exports`**.

Không có kế thừa. Không có "toàn cục" (trừ `@Global()`). Module `A` import `B`, `B` import `C`, `C` export `X` → **`A` KHÔNG thấy `X`**. Đây là nguồn của phần lớn lỗi "provider not found" khi codebase lớn lên.

```text
     AppModule
        │ imports
        ▼
   TasksModule  ── providers: [TasksService]  exports: [TasksService]
        │ imports
        ▼
   ProjectsModule ── providers: [ProjectsService]  exports: [ProjectsService]

TasksService tiêm được ProjectsService  ✓ (Tasks imports Projects, Projects exports)
AppModule tiêm được ProjectsService?    ✗ (App chỉ imports Tasks; Tasks không re-export Projects)
```

## How It Works

### Bốn kiểu provider

```ts
@Module({
  providers: [
    // 1. Class — token = chính class. 95% trường hợp.
    TaskService,

    // 2. useClass — token khác implementation. Đổi implementation không đụng consumer.
    { provide: Mailer, useClass: process.env.NODE_ENV === 'test' ? FakeMailer : SesMailer },

    // 3. useValue — giá trị có sẵn. Dùng nhiều trong test.
    { provide: 'CLOCK', useValue: { now: () => new Date() } },

    // 4. useFactory — cần tính toán / cần async / cần dependency khác
    {
      provide: 'REDIS',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => new Redis(cfg.get('REDIS_URL')),
    },
  ],
})
```

Với token không phải class (string/Symbol) phải tiêm bằng `@Inject`:

```ts
constructor(@Inject('REDIS') private readonly redis: Redis) {}
```

Vì sao? Xem phần tiếp theo — đó chính là gốc của dấu `?`.

### Vì sao Nest biết cần tiêm gì: `emitDecoratorMetadata`

Đây là cơ chế mà nếu không hiểu thì mọi lỗi DI đều là phép thuật.

```ts
@Injectable()
export class TaskService {
  constructor(private readonly repo: TaskRepository) {}
}
```

TypeScript **xoá sạch type khi compile**. `TaskRepository` là type, và type không tồn tại lúc runtime. Vậy Nest lấy đâu ra thông tin?

Từ `emitDecoratorMetadata` trong `tsconfig.json`. Khi bật, TypeScript sinh thêm một dòng:

```js
// output JS (rút gọn)
Reflect.metadata("design:paramtypes", [TaskRepository])(TaskService);
```

Nest đọc mảng `design:paramtypes` đó để biết cần tiêm gì.

Bốn hệ quả trực tiếp, và tất cả đều gây lỗi thật:

1. **Phải có `"emitDecoratorMetadata": true` và `"experimentalDecorators": true`.** Thiếu → mảng rỗng → mọi thứ là `?`.
2. **Phải `import 'reflect-metadata'` trước mọi thứ khác.** Xem [Module system trong Node](../../01-nodejs/fundamentals/02-module-system.md).
3. **Type không phải class thì metadata vô dụng.** `interface Mailer` biến mất hoàn toàn khi compile → `design:paramtypes` ghi `Object` → Nest không biết tra token nào → `?`. Đây là lý do interface **không** dùng làm token được, và là lý do bạn phải dùng `abstract class` hoặc string token.
4. **Circular import làm type thành `undefined`.** Nếu `a.ts` import `b.ts` và ngược lại, một trong hai sẽ thấy giá trị `undefined` tại thời điểm decorator chạy → metadata ghi `undefined` → `?`.

**Dấu `?` trong thông báo lỗi = vị trí tham số mà Nest không tra được token.** Nó không có nghĩa "provider bị thiếu"; nó có nghĩa "tôi thậm chí không biết phải tìm cái gì".

```text
Nest can't resolve dependencies of the TasksService (?, ProjectsService)
                                                     ↑
                          tham số thứ 0 — token là undefined hoặc Object
```

Phân biệt hai thông báo:

| Thông báo | Nghĩa | Nguyên nhân |
|---|---|---|
| `(?, X)` | không biết token của tham số 0 | circular import, interface làm type, thiếu `emitDecoratorMetadata` |
| `(TaskRepository, ?)` … `Please make sure that the argument TaskRepository at index [0] is available in the TasksModule context` | biết token nhưng không thấy trong phạm vi | thiếu `providers` hoặc thiếu `exports`/`imports` |

Hai lỗi này cần hai cách sửa hoàn toàn khác nhau. Đọc kỹ dấu `?` ở đâu là bước debug đầu tiên.

### Circular dependency — và vì sao `forwardRef` không phải lời giải

```ts
// tasks.service.ts
@Injectable()
export class TasksService {
  constructor(private readonly projects: ProjectsService) {}
}
// projects.service.ts
@Injectable()
export class ProjectsService {
  constructor(private readonly tasks: TasksService) {}   // ← vòng
}
```

Nest không thể tạo cái nào trước. `forwardRef` cho phép nó thoát:

```ts
constructor(@Inject(forwardRef(() => TasksService)) private readonly tasks: TasksService) {}
```

Nó hoạt động vì hoãn việc phân giải token tới sau khi cả hai class đã được định nghĩa. Nhưng:

> `forwardRef` sửa **triệu chứng** (app không start), không sửa **nguyên nhân** (hai module phụ thuộc lẫn nhau).

Vòng phụ thuộc vẫn còn, và nó có giá thật: bạn không tách được `TasksModule` ra service riêng, bạn không test được `TasksService` mà không dựng `ProjectsService`, và người đọc code không biết cái nào là cái "chính".

Ba cách sửa thật, theo thứ tự ưu tiên:

```text
1. Rút phần chung ra module thứ ba.
   TasksService → SharedRulesService ← ProjectsService

2. Đảo chiều một cạnh bằng event.
   TasksService phát TaskCreatedEvent; ProjectsService lắng nghe.
   → Tasks không còn biết Projects tồn tại.

3. Đặt lại ranh giới module.
   Nếu hai module lúc nào cũng cần nhau, có thể chúng vốn là MỘT module.
```

Xem [Modular monolith](../../04-architecture/02-modular-monolith.md) — vòng phụ thuộc là tín hiệu ranh giới module đang sai, không phải tín hiệu cần thêm `forwardRef`.

### Scope: vì sao provider mặc định là singleton

```ts
@Injectable()                                    // DEFAULT — singleton, tạo 1 lần
@Injectable({ scope: Scope.REQUEST })            // tạo mới cho MỖI request
@Injectable({ scope: Scope.TRANSIENT })          // tạo mới cho MỖI nơi tiêm
```

Singleton là mặc định vì nó đúng cho gần như mọi thứ: service không có state, repository dùng chung pool, config đọc một lần.

`Scope.REQUEST` nghe hấp dẫn (mỗi request có "context" riêng) nhưng nó **lan lên trên**:

```text
UserContext(REQUEST)  →  TaskService  →  TaskController
        ↑                     ↑                ↑
    REQUEST            bị ép REQUEST      bị ép REQUEST
```

Nest phải tạo lại **toàn bộ chuỗi phụ thuộc** cho mỗi request. Hệ quả:

- chi phí khởi tạo × số request;
- `onModuleInit` không chạy như bạn tưởng;
- một enhancer REQUEST-scoped làm mọi thứ nó chạm vào cũng thành REQUEST-scoped.

Nếu bạn cần "dữ liệu theo request" (user hiện tại, correlation ID), **`AsyncLocalStorage` gần như luôn là lựa chọn đúng hơn** — nó cho bạn context theo request mà không đụng vào lifecycle của DI. Xem [Request lifecycle](01-request-lifecycle.md#how-it-works).

### `@Global()` — công cụ nên dùng dè dặt

```ts
@Global()
@Module({ providers: [ConfigService], exports: [ConfigService] })
export class ConfigModule {}
```

Sau đó mọi module tiêm được `ConfigService` mà không cần `imports`. Tiện, nhưng nó **xoá thông tin**: đọc `@Module({ imports: [...] })` của một module không còn cho biết module đó thật sự phụ thuộc gì.

Quy tắc thực dụng: `@Global()` chỉ cho hạ tầng thật sự dùng ở khắp nơi và không bao giờ thay đổi — `ConfigModule`, `LoggerModule`. Không dùng cho service nghiệp vụ.

### Dynamic module — provider phụ thuộc cấu hình

```ts
@Module({})
export class RedisModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      providers: [{ provide: 'REDIS', useValue: new Redis(options) }],
      exports: ['REDIS'],
      global: true,
    };
  }

  // biến thể async: cần ConfigService để lấy URL
  static forRootAsync(): DynamicModule {
    return {
      module: RedisModule,
      imports: [ConfigModule],
      providers: [{
        provide: 'REDIS',
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => new Redis(cfg.getOrThrow('REDIS_URL')),
      }],
      exports: ['REDIS'],
    };
  }
}
```

Quy ước tên trong hệ sinh thái Nest, đáng thuộc vì nó cho biết ngay module đó hoạt động thế nào:

| Tên | Nghĩa |
|---|---|
| `forRoot` / `forRootAsync` | cấu hình **một lần** cho toàn app, thường tạo tài nguyên dùng chung (pool, connection) |
| `forFeature` | đăng ký thêm cho **một module cụ thể** (ví dụ: entity/repository của module đó) |
| `register` / `registerAsync` | cấu hình **cục bộ**, mỗi nơi một bản riêng (ví dụ `HttpModule.register({ timeout })`) |

Gọi `forRoot` hai lần thường là bug: hai pool, hai connection.

### Lifecycle hook

```ts
@Injectable()
export class SearchIndex implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit()            { await this.client.connect(); }   // sau khi module resolve xong
  async onApplicationShutdown(s?: string) { await this.client.close(); }
}
```

Thứ tự: `onModuleInit` → `onApplicationBootstrap` → (chạy) → `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`.

Điều kiện bắt buộc để nhóm shutdown chạy:

```ts
app.enableShutdownHooks();     // KHÔNG bật mặc định
```

Không gọi dòng này thì `onApplicationShutdown` không bao giờ chạy khi nhận SIGTERM, và connection không được đóng sạch mỗi lần deploy. Xem [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md) và [Config & lifecycle](05-config-lifecycle.md).

## Example

Đổi implementation mà không đụng vào consumer — đây là lý do tồn tại của DI, thu gọn còn 12 dòng:

```ts
// domain khai báo cái nó CẦN, bằng abstract class (không dùng interface — xem phần trên)
export abstract class Mailer {
  abstract send(to: string, subject: string): Promise<void>;
}

// production
@Module({ providers: [{ provide: Mailer, useClass: SesMailer }], exports: [Mailer] })
export class MailModule {}

// test — không đổi một dòng nào trong TaskService
const moduleRef = await Test.createTestingModule({ providers: [TaskService] })
  .useMocker((token) => (token === Mailer ? { send: jest.fn() } : undefined))
  .compile();
```

## Prediction

1. `TasksModule` imports `ProjectsModule`; `ProjectsModule` có `providers: [ProjectsService]` nhưng **không** `exports`. `TasksService` tiêm `ProjectsService` — lỗi lúc nào, thông báo nào?
2. `AppModule` imports `TasksModule`; `TasksModule` imports `ProjectsModule` (có export). `AppService` tiêm `ProjectsService` — được không?
3. Hai module cùng khai báo `providers: [CacheService]` (không import lẫn nhau). Có bao nhiêu instance?
4. `constructor(private readonly mailer: Mailer)` với `Mailer` là **interface** — Nest báo gì?
5. `TasksService` và `ProjectsService` phụ thuộc lẫn nhau, không dùng `forwardRef` — app start được không? Lỗi lúc bootstrap hay lúc request?
6. Một `@Injectable({ scope: Scope.REQUEST })` được tiêm vào `TasksController` — controller còn là singleton không?
7. `useFactory` async (`async () => await connect()`) — Nest có chờ không? Request đầu tiên có thể tới trước khi factory xong không?
8. Không gọi `app.enableShutdownHooks()`, gửi SIGTERM — `onApplicationShutdown` chạy không?
9. Gọi `RedisModule.forRoot()` ở cả `AppModule` và `TasksModule` — bao nhiêu connection Redis?

<details>
<summary>Đáp án</summary>

1. Lỗi lúc **bootstrap**: `Nest can't resolve dependencies of the TasksService (?)` kèm gợi ý *"...is available in the TasksModule context"*. Sửa bằng `exports: [ProjectsService]`.
2. **Không.** Phạm vi không bắc cầu. `AppModule` phải tự `imports: [ProjectsModule]`, hoặc `TasksModule` phải re-export nó.
3. **Hai** instance riêng biệt. Nếu `CacheService` giữ state (Map trong bộ nhớ), hai module thấy hai cache khác nhau — bug rất khó thấy.
4. `(?)` — interface bị xoá khi compile nên `design:paramtypes` ghi `Object`.
5. **Không start được**, lỗi lúc bootstrap. Đây là điểm tốt: lỗi DI luôn xuất hiện lúc khởi động chứ không phải lúc có traffic.
6. **Không.** Controller bị "kéo" thành REQUEST-scoped theo.
7. **Có**, Nest await factory trước khi hoàn tất bootstrap. App chưa listen cho tới khi mọi provider resolve xong.
8. **Không.** Connection không đóng sạch mỗi lần deploy.
9. **Hai.** `forRoot` gọi nhiều lần = nhiều tài nguyên; chỉ gọi ở module gốc.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá `exports` khỏi một module | Thông báo lỗi có `?` không, hay có tên token? Ghi lại khác biệt |
| Đổi `abstract class Mailer` thành `interface Mailer` | `(?)` ngay lập tức — chứng minh type bị xoá lúc compile |
| Tắt `emitDecoratorMetadata` trong tsconfig | **Mọi** provider thành `?` |
| Xoá `import 'reflect-metadata'` khỏi `main.ts` | `Reflect.getMetadata is not a function` |
| Tạo circular import giữa hai service | Ghi lại thông báo; thêm `forwardRef` và xác nhận nó start được **nhưng vòng vẫn còn** |
| Khai báo cùng provider ở 2 module, cho nó một `Map` nội bộ, ghi từ module A rồi đọc từ B | Đọc ra rỗng → chứng minh có 2 instance |
| Đổi một service thành `Scope.REQUEST`, log trong constructor | Constructor chạy mỗi request; đo latency trước/sau |
| Bỏ `app.enableShutdownHooks()`, gửi SIGTERM | `onApplicationShutdown` im lặng không chạy |
| Gọi `forRoot` hai lần, log số connection ở Redis (`CLIENT LIST`) | Hai connection |
| Đặt `@Global()` lên module nghiệp vụ, rồi xoá `imports` ở nơi dùng | App vẫn chạy — và bạn vừa mất khả năng biết ai phụ thuộc ai |

## What Usually Goes Wrong

- **Quên `exports`** — lỗi phổ biến nhất, nhưng cũng dễ nhất: thông báo nói thẳng module nào thiếu.
- **Tưởng `imports` bắc cầu** — A→B→C không cho A thấy C. Khi codebase lớn, đây là lỗi tốn thời gian nhất.
- **Dùng interface làm token** — `(?)` và không hiểu vì sao. Dùng `abstract class` hoặc string token.
- **`forwardRef` như thuốc giảm đau** — app start được, nợ kiến trúc tích lại. Sau 6 tháng module graph là một cục.
- **Provider trùng ở nhiều module có state** — hai instance, cache/counter không nhất quán. Đặc biệt nguy hiểm với in-memory cache và rate limiter.
- **`Scope.REQUEST` lan ngoài ý muốn** — latency tăng mà không rõ vì sao; profile cho thấy thời gian nằm ở constructor.
- **Lạm dụng `@Global()`** — module graph mất ý nghĩa, không refactor được.
- **`forRoot` nhiều lần** — nhiều pool/connection; triệu chứng ở phía DB (`too many connections`), không phải ở app.
- **Đọc `process.env` trực tiếp trong provider** thay vì qua `ConfigService` — không validate được, không test được. Xem [Configuration](../../04-architecture/05-configuration.md).
- **Quên `enableShutdownHooks`** — connection rò rỉ mỗi lần deploy.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| DI là "magic" của Nest | Chỉ là một `Map<token, instance>` dựng lúc bootstrap |
| `imports` bắc cầu | Không. Mỗi module phải import trực tiếp cái nó cần |
| Interface dùng làm token được | Interface bị xoá khi compile → không có token |
| `forwardRef` sửa circular dependency | Chỉ hoãn phân giải; vòng vẫn còn nguyên |
| Provider là singleton toàn app | Singleton **trong một module context**; khai báo 2 nơi = 2 instance |
| `Scope.REQUEST` chỉ ảnh hưởng service đó | Lan lên toàn bộ chuỗi tiêm nó |
| Lỗi DI xảy ra lúc có request | Xảy ra lúc bootstrap (trừ enhancer đăng ký bằng `new`) |
| `@Global()` là cách hay để bớt boilerplate | Nó xoá thông tin phụ thuộc, đắt về lâu dài |
| `useFactory` async không được hỗ trợ | Được, và Nest chờ nó xong trước khi listen |

## Debugging

1. **Đọc dấu `?` ở đâu.** `(?, X)` = không biết token (circular / interface / metadata). `(X, ?)` kèm "available in ... context" = biết token nhưng sai phạm vi. Hai nhánh này rẽ ngay từ bước 1.
2. **Nếu là vấn đề phạm vi**: mở module chứa consumer → nó có `imports` module kia không? → module kia có `exports` token đó không? Hai câu hỏi, hết.
3. **Nếu là `(?)`**: kiểm tra theo thứ tự rẻ → đắt:
   - type có phải interface không?
   - có circular import không (`madge --circular src/`)?
   - `emitDecoratorMetadata` có bật không?
   - `import 'reflect-metadata'` có ở dòng đầu `main.ts` không?
4. **Nghi ngờ nhiều instance**: log `constructor` với một id ngẫu nhiên. Số dòng log = số instance.
5. **Nghi ngờ scope sai**: log trong constructor. In một lần lúc bootstrap = singleton; in mỗi request = REQUEST-scoped.
6. **Xem toàn bộ graph**: `NestFactory.create(AppModule, { logger: ['debug'] })` in ra thứ tự khởi tạo dependency.
7. **Vẽ graph**: `npx madge --image graph.svg src/` — nhìn thấy vòng phụ thuộc nhanh hơn đọc code.

## Production Considerations

- **Mọi lỗi DI đều lộ lúc khởi động.** Đó là một tính chất tốt: một smoke test "app có start không" bắt được toàn bộ lớp lỗi này trước khi vào production. Đưa nó vào CI.
- **Ngoại lệ duy nhất**: enhancer đăng ký bằng `useGlobalX(new ...)` — lỗi lộ lúc có request. Đây là lý do nữa để luôn dùng `APP_*`.
- **`forRoot` chỉ ở module gốc.** Với connection pool, gọi trùng = gấp đôi connection, và trần connection của PostgreSQL là tài nguyên toàn cụm.
- **`app.enableShutdownHooks()` là bắt buộc** nếu bạn chạy trên K8s và có connection cần đóng.
- **Số provider ảnh hưởng thời gian khởi động**, và thời gian khởi động ảnh hưởng tốc độ rollout và thời gian phục hồi sau crash. Đo nó: `NestFactory.create` → `app.listen` mất bao lâu. Vài trăm ms là bình thường; vài giây thì phải xem lại (thường là kết nối đồng bộ trong `onModuleInit`).
- **`Scope.REQUEST` trong hot path** là quyết định về performance, không phải về kiến trúc. Đo trước.
- **Module graph là tài liệu kiến trúc thật.** Nếu nó là một cục rối, kiến trúc của bạn là một cục rối — bất kể sơ đồ trong Confluence vẽ gì.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| DI container | test được, thay implementation được, lifecycle đúng | luồng khởi tạo vô hình; phải học cơ chế |
| Token = class (mặc định) | ngắn gọn, type-safe | consumer phụ thuộc class cụ thể |
| Token = abstract class | đảo phụ thuộc thật sự | thêm một file, thêm một khái niệm |
| Token = string/Symbol | linh hoạt tối đa | mất type-safety, phải `@Inject` bằng tay |
| `@Global()` | bớt boilerplate | mất thông tin phụ thuộc, khó refactor |
| Nhiều module nhỏ | ranh giới rõ, dễ tách | nhiều import/export, dễ gặp vòng |
| Ít module lớn | đơn giản lúc đầu | mọi thứ thấy mọi thứ; không tách được về sau |
| `Scope.REQUEST` | context tự nhiên theo request | chi phí khởi tạo, lan lên trên |
| `AsyncLocalStorage` thay REQUEST scope | không đụng lifecycle DI | context ẩn, khó lần theo |

Về số lượng module: chia theo **năng lực nghiệp vụ** (`tasks`, `projects`, `billing`), không chia theo **loại kỹ thuật** (`controllers`, `services`, `dtos`). Cách thứ hai làm mọi module phụ thuộc mọi module.

## Explain Without Notes

1. Vẽ lại DI container là cấu trúc dữ liệu gì, và giải thích token/provider/module.
2. Vì sao `imports` không bắc cầu, và điều đó khiến bạn phải làm gì khi thêm dependency mới?
3. Dấu `?` trong thông báo lỗi nghĩa là gì, và nó khác gì với lỗi "not available in context"?
4. Vì sao không dùng interface làm token được, còn abstract class thì được?
5. `forwardRef` làm gì và vì sao nó không phải lời giải?
6. `Scope.REQUEST` có chi phí gì, và khi nào `AsyncLocalStorage` tốt hơn?

## Related

- [Module system trong Node](../../01-nodejs/fundamentals/02-module-system.md) — circular import, `reflect-metadata`
- [Request lifecycle](01-request-lifecycle.md) — enhancer lấy dependency từ container này
- [Config & lifecycle](05-config-lifecycle.md) — `ConfigModule`, `forRootAsync`, shutdown hook
- [Testing NestJS](09-testing-nestjs.md) — `Test.createTestingModule`, thay provider
- [Modular monolith](../../04-architecture/02-modular-monolith.md) — ranh giới module ở tầng kiến trúc
- [Controller → Service → Repository](../../04-architecture/01-controller-service-repository.md) — cái gì được tiêm vào đâu
- [Connection pool](../../../03-database/01-postgresql/fundamentals/02-connection-pool.md) — vì sao pool phải là singleton
- [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md) — `enableShutdownHooks`

## Version / Context

NestJS 10/11. `emitDecoratorMetadata` phụ thuộc TypeScript decorator "legacy" (`experimentalDecorators: true`); decorator chuẩn ECMAScript (TS 5.0+, không có `experimentalDecorators`) **không** sinh `design:paramtypes`, nên không dùng được với DI của Nest ở thời điểm này.
