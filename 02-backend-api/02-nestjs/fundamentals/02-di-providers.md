---
level: foundation
area: backend
prerequisites:
  - 01-building-blocks.md
related:
  - ../behavior/02-modules-di.md
  - ../behavior/05-config-lifecycle.md
---

# Dependency Injection & provider

> Một service được đổi sang `scope: Scope.REQUEST` để đọc được `tenantId` từ request. Sau khi deploy, throughput giảm 40% và bộ nhớ tăng đều. Nguyên nhân: service đó được tiêm vào một controller, và **request scope lan ngược lên** — controller cũng thành request-scoped, rồi mọi provider trong chuỗi phụ thuộc cũng vậy. Mỗi request giờ tạo mới hàng chục object thay vì dùng lại singleton.

## Position

```text
building blocks (01) → DI & provider (note này) → request lifecycle (behavior)

Note này trả lời: Nest LẤY ĐÂU RA object để tiêm vào constructor,
và bạn điều khiển việc đó bằng cách nào.
```

## Problem

```text
DI giải quyết một vấn đề cụ thể: KHÔNG hard-code cách tạo phụ thuộc.

  ✗ class OrdersService { private repo = new OrderRepository(new PgClient(...)); }
     → không thay được khi test
     → mỗi nơi tạo một instance
     → đổi cách tạo phải sửa mọi nơi

  ✓ constructor(private repo: OrderRepository) {}
     → ai đó bên ngoài quyết định `repo` là gì

Cái giá: bạn phải hiểu "ai đó bên ngoài" hoạt động thế nào.
Không hiểu ⇒ mọi lỗi DI đều là bí ẩn.
```

### Trước đó: "dependency" nghĩa là gì

Từ này xuất hiện trong hơn 100 note của repo, nên đáng định nghĩa một lần cho dứt điểm.

> **Dependency** của một class là **thứ mà class đó cần có sẵn để làm được việc của nó.**

```ts
class OrdersService {
  constructor(
    private repo: OrderRepository,   // ← dependency
    private mailer: MailerService,   // ← dependency
  ) {}
}
```

`OrdersService` không thể hoạt động nếu thiếu hai thứ đó. Chúng là phụ thuộc của nó.

Ba điều đi kèm định nghĩa:

```text
① Dependency là QUAN HỆ, không phải loại object.
   Cùng một MailerService là dependency của OrdersService,
   và có dependency riêng của nó (HttpClient, Config).
   → chuỗi phụ thuộc, không phải danh sách phẳng.

② "Injection" chỉ nói ai TẠO ra nó.
   Tự tạo:      private repo = new OrderRepository(...)   ← không phải injection
   Nhận từ ngoài: constructor(private repo: OrderRepository)  ← injection

③ Vì vậy DI không thêm khả năng nào cho code của bạn.
   Nó chỉ chuyển quyền quyết định "repo là object nào"
   từ trong class ra ngoài class.
```

Điểm ③ là lý do DI đáng học kỹ: nó **đổi chỗ** một quyết định, và mọi lợi ích (test thay được, một instance dùng chung, đổi implementation không sửa caller) cũng như mọi rắc rối (`(?)` trong lỗi, circular dependency, scope lan ngược ở đầu note) đều bắt nguồn từ việc quyết định đó giờ nằm ở chỗ khác.

## Mental Model

### DI container là một `Map<Token, Instance>`

```text
Lúc khởi động, Nest:
  ① quét AppModule và mọi module được import
  ② với mỗi provider, đọc TOKEN của nó
  ③ đọc kiểu tham số constructor → suy ra token cần tiêm
  ④ sắp thứ tự khởi tạo theo đồ thị phụ thuộc
  ⑤ tạo instance, lưu vào Map, tiêm vào nơi cần
```

```text
TOKEN là khoá tra cứu. Mặc định token chính là CLASS.

  providers: [OrdersService]
  ⇒ tương đương { provide: OrdersService, useClass: OrdersService }

Constructor `constructor(private o: OrdersService)` được biên dịch thành
metadata "tham số 0 có kiểu OrdersService" → Nest tra Map bằng token đó.
```

```text
⚠ Metadata này đến từ `emitDecoratorMetadata` trong tsconfig.
Thiếu nó, Nest không biết kiểu tham số và MỌI injection theo kiểu hỏng.
Đây là nguyên nhân của lỗi DI khó hiểu nhất khi dựng dự án mới.
```

### Bốn cách khai báo provider

```ts
// ① useClass — mặc định; Nest tự new và tiêm phụ thuộc của nó
providers: [OrdersService]
providers: [{ provide: OrdersService, useClass: OrdersService }]   // dạng đầy đủ

// thay cài đặt theo môi trường — cùng token, class khác
providers: [{
  provide: PaymentGateway,
  useClass: process.env.NODE_ENV === 'test' ? FakeGateway : StripeGateway,
}]

// ② useValue — đưa thẳng một giá trị có sẵn
providers: [{ provide: 'APP_CONFIG', useValue: { retries: 3 } }]
providers: [{ provide: Logger, useValue: mockLogger }]             // hay dùng khi test

// ③ useFactory — cần tính toán hoặc async để tạo
providers: [{
  provide: 'REDIS',
  useFactory: async (config: ConfigService) => {
    const client = new Redis(config.get('REDIS_URL'));
    await client.ping();                                    // fail fast lúc khởi động
    return client;
  },
  inject: [ConfigService],                                  // ← phụ thuộc của factory
}]

// ④ useExisting — bí danh cho một provider đã có, KHÔNG tạo instance mới
providers: [
  LoggerService,
  { provide: 'LOGGER', useExisting: LoggerService },        // cùng một instance
]
```

```text
Phân biệt `useClass` và `useExisting` — điểm hay nhầm:

  useClass:    { provide: 'A', useClass: LoggerService }
               → tạo instance MỚI của LoggerService cho token 'A'
               → có HAI instance nếu LoggerService cũng được khai báo riêng

  useExisting: { provide: 'A', useExisting: LoggerService }
               → 'A' trỏ tới ĐÚNG instance đã có
               → dùng khi muốn hai tên cho cùng một thứ (ví dụ giữ tương thích ngược)
```

### Token không phải class: cần `@Inject()`

```ts
// TypeScript không có "kiểu" cho một chuỗi → Nest không suy được token
@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrderRepository,          // ✓ suy được từ kiểu
    @Inject('REDIS') private readonly redis: Redis,  // ✓ phải chỉ định token
  ) {}
}
```

```text
Dùng `Symbol` hoặc hằng số thay chuỗi thô để tránh gõ sai:

  export const REDIS = Symbol('REDIS');
  @Inject(REDIS) private readonly redis: Redis

Chuỗi thô sai chính tả → lỗi lúc khởi động, không phải lỗi biên dịch.
```

### Ba scope, và cái giá của chúng

```text
DEFAULT (singleton)   MỘT instance cho cả ứng dụng
                      → mặc định, và đúng cho gần như mọi thứ

REQUEST               MỘT instance cho MỖI request
                      → truy cập được `REQUEST` object
                      → tốn: tạo lại toàn bộ chuỗi phụ thuộc mỗi request

TRANSIENT             instance MỚI cho mỗi nơi tiêm
                      → hiếm khi cần
```

```text
Điều làm request scope nguy hiểm — BUBBLE UP:

  OrdersService là REQUEST scope
  → OrdersController tiêm nó ⇒ controller cũng thành REQUEST scope
  → mọi thứ trên chuỗi đó cũng vậy

⇒ một quyết định nhỏ ở tầng sâu làm cả nhánh mất singleton.
⇒ đây chính là sự cố ở đầu note.
```

```ts
// ✗ dùng request scope chỉ để đọc dữ liệu request
@Injectable({ scope: Scope.REQUEST })
export class TenantService {
  constructor(@Inject(REQUEST) private req: Request) {}
  get tenantId() { return this.req.user.tenantId; }
}

// ✓ AsyncLocalStorage: ngữ cảnh theo request, provider vẫn SINGLETON
@Injectable()
export class TenantContext {
  private als = new AsyncLocalStorage<{ tenantId: string }>();
  run<T>(ctx: { tenantId: string }, fn: () => T) { return this.als.run(ctx, fn); }
  get tenantId() { return this.als.getStore()?.tenantId; }
}
```

```text
Quy tắc: cần dữ liệu theo request → AsyncLocalStorage, không phải request scope.
Chỉ dùng request scope khi thật sự cần một INSTANCE riêng cho mỗi request
(hiếm — ví dụ một client giữ trạng thái riêng cho từng request).
```

### Module global

```ts
@Global()                     // provider export ra dùng được ở MỌI module
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
```

```text
`@Global()` bỏ yêu cầu `imports` ở nơi dùng.

Dùng cho: config, logger — thứ thật sự dùng ở khắp nơi.
KHÔNG dùng cho: service nghiệp vụ.

Lý do: nó xoá ranh giới hiển thị — thứ duy nhất ngăn mọi module
phụ thuộc mọi module. Lạm dụng `@Global()` biến modular monolith
thành một quả cầu bùn có thư mục đẹp.
```

### Dynamic module: module nhận cấu hình

```ts
@Module({})
export class StorageModule {
  static forRoot(options: StorageOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: STORAGE_OPTIONS, useValue: options },
        StorageService,
      ],
      exports: [StorageService],
    };
  }
}

// dùng
@Module({ imports: [StorageModule.forRoot({ bucket: 'uploads' })] })
export class AppModule {}
```

```text
Quy ước tên trong hệ sinh thái Nest:
  forRoot()      cấu hình MỘT LẦN ở AppModule
  forRootAsync() như trên nhưng cần phụ thuộc (ví dụ ConfigService)
  forFeature()   đăng ký phần cụ thể ở feature module (entity, queue)
```

### Circular dependency

```text
A cần B, B cần A → Nest không biết tạo cái nào trước.

Giải pháp kỹ thuật:
  constructor(@Inject(forwardRef(() => BService)) private b: BService)
  và ở module: imports: [forwardRef(() => BModule)]

Nhưng `forwardRef` là BĂNG DÁN, không phải giải pháp.
Vòng phụ thuộc gần như luôn có nghĩa:
  · ranh giới module đặt sai, hoặc
  · thiếu một khái niệm thứ ba mà cả hai cùng phụ thuộc, hoặc
  · một trong hai chiều nên là EVENT thay vì lời gọi trực tiếp
```

## Example

Cùng một nhu cầu — "service cần biết tenant của request" — ba cách, ba hệ quả:

```ts
// ── CÁCH 1: request scope (cách sai ở đầu note) ─────────
@Injectable({ scope: Scope.REQUEST })
export class OrdersService {
  constructor(@Inject(REQUEST) private req: Request, private repo: OrderRepository) {}
  find() { return this.repo.find({ tenantId: this.req.user.tenantId }); }
}
// → OrdersController cũng thành request-scoped
// → mỗi request tạo mới cả chuỗi; throughput giảm, bộ nhớ tăng
```

```ts
// ── CÁCH 2: truyền tenantId xuống như tham số ───────────
@Injectable()                                   // SINGLETON
export class OrdersService {
  constructor(private repo: OrderRepository) {}
  find(tenantId: string) { return this.repo.find({ tenantId }); }
}
// → đơn giản nhất, test dễ nhất
// → nhược: phải truyền qua mọi tầng, kể cả tầng không quan tâm
```

```ts
// ── CÁCH 3: AsyncLocalStorage ───────────────────────────
export const tenantStore = new AsyncLocalStorage<{ tenantId: string }>();

// middleware đặt ngữ cảnh một lần
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    tenantStore.run({ tenantId: req.user.tenantId }, next);
  }
}

@Injectable()                                   // vẫn SINGLETON
export class OrdersService {
  constructor(private repo: OrderRepository) {}
  find() {
    const tenantId = tenantStore.getStore()?.tenantId;
    if (!tenantId) throw new Error('thiếu tenant context');
    return this.repo.find({ tenantId });
  }
}
```

```text
So sánh:
  cách 1  tiện nhất khi viết · đắt nhất khi chạy · lan scope ngoài kiểm soát
  cách 2  rõ ràng nhất · test dễ nhất · ồn ào ở chữ ký hàm
  cách 3  singleton + ngữ cảnh · phải nhớ đặt store · phụ thuộc ngầm

Mặc định nên là cách 2. Dùng cách 3 khi ngữ cảnh phải đi qua
nhiều tầng không quan tâm tới nó (logging, audit, tenant).
```

Và cấu hình provider theo môi trường — nơi DI trả lại giá trị rõ nhất:

```ts
@Module({
  providers: [
    OrdersService,
    {
      provide: PaymentGateway,                   // token là abstract class/interface
      useClass: process.env.NODE_ENV === 'test' ? FakePaymentGateway : StripeGateway,
    },
    {
      provide: 'REDIS',
      useFactory: async (cfg: ConfigService) => {
        const client = new Redis(cfg.getOrThrow('REDIS_URL'), { lazyConnect: true });
        await client.connect();                  // fail fast, không đợi request đầu
        return client;
      },
      inject: [ConfigService],
    },
  ],
})
export class OrdersModule {}

// test: thay một provider, giữ nguyên phần còn lại
const moduleRef = await Test.createTestingModule({ imports: [OrdersModule] })
  .overrideProvider(PaymentGateway).useClass(FakePaymentGateway)
  .compile();
```

## Prediction

1. `emitDecoratorMetadata` bị tắt trong tsconfig — injection theo kiểu hoạt động không?
2. `@Inject('REDIS')` gõ nhầm thành `'REDS'` — lỗi lúc biên dịch hay lúc chạy?
3. `{ provide: 'A', useClass: LoggerService }` cùng với `LoggerService` trong `providers` — mấy instance?
4. Đổi thành `useExisting` — mấy instance?
5. `useFactory` là async và ném lỗi — ứng dụng khởi động được không?
6. Một service sâu đổi sang `Scope.REQUEST` — controller tiêm nó có còn singleton không?
7. Hệ quả với throughput và bộ nhớ?
8. Dùng AsyncLocalStorage thay vì request scope — provider còn singleton không?
9. Quên gọi `tenantStore.run()` ở middleware, service đọc store — nhận gì?
10. `@Global()` cho một service nghiệp vụ — mất gì?
11. A cần B, B cần A, dùng `forwardRef` — vấn đề gốc đã được giải quyết chưa?
12. Cùng một provider khai báo ở hai module không có quan hệ — mấy instance?

<details>
<summary>Đáp án</summary>

1. **Không** — Nest không suy được kiểu tham số constructor.
2. **Lúc chạy** (khởi động) — chuỗi thô không được compiler kiểm tra.
3. **Hai** — `useClass` tạo instance mới cho token đó.
4. **Một** — `useExisting` là bí danh.
5. **Không** — và đó là hành vi đúng: fail fast tốt hơn lỗi ở request đầu tiên.
6. **Không** — request scope lan ngược lên.
7. Throughput **giảm**, bộ nhớ **tăng** — cả chuỗi được tạo lại mỗi request.
8. **Còn** — đó là lý do chọn nó.
9. `undefined` — nên code phải kiểm tra và ném lỗi rõ ràng.
10. **Ranh giới hiển thị** — mọi module dùng được nó mà không khai báo phụ thuộc.
11. **Chưa** — `forwardRef` chỉ làm nó chạy được; ranh giới vẫn sai.
12. **Hai** — provider là singleton theo module scope, không phải toàn ứng dụng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tắt `emitDecoratorMetadata` rồi khởi động | Lỗi nói gì? |
| Gõ sai token chuỗi | Lỗi lúc nào — build hay chạy? |
| Khai báo cùng class bằng `useClass` và trực tiếp, log `this` | Cùng instance không? |
| Đổi sang `useExisting`, lặp lại | Khác thế nào? |
| Đặt `Scope.REQUEST` cho một service sâu, log constructor | Bao nhiêu lần mỗi request? |
| Đo throughput trước và sau khi đổi scope | Giảm bao nhiêu? |
| Cho `useFactory` ném lỗi | App có khởi động không? |
| Bỏ middleware đặt AsyncLocalStorage | Service đọc được gì? |
| Tạo vòng A↔B không dùng `forwardRef` | Thông báo lỗi của Nest? |

## What Usually Goes Wrong

- **`emitDecoratorMetadata` tắt** → mọi injection theo kiểu hỏng.
- **Token chuỗi thô gõ sai** → lỗi lúc chạy thay vì lúc build.
- **Nhầm `useClass` với `useExisting`** → hai instance ngoài ý muốn.
- **Request scope để đọc dữ liệu request** → lan scope, mất hiệu năng.
- **Không nhận ra scope bubble up.**
- **`@Global()` cho service nghiệp vụ** → mất ranh giới module.
- **`forwardRef` như giải pháp** thay vì sửa ranh giới.
- **`useFactory` không fail fast** → lỗi kết nối lộ ra ở request đầu tiên của người dùng.
- **Provider khai báo trùng ở nhiều module** → nhiều instance.
- **Không dùng abstract class/interface làm token** → không thay được cài đặt khi test.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Provider là singleton toàn ứng dụng | Nó là singleton **theo module scope** |
| Request scope chỉ ảnh hưởng service đó | Nó lan ngược lên toàn chuỗi |
| `useClass` và `useExisting` tương đương | Một tạo instance mới, một là bí danh |
| Token phải là class | Có thể là chuỗi hoặc Symbol, nhưng cần `@Inject()` |
| `@Global()` là tiện lợi vô hại | Nó xoá ranh giới hiển thị |
| `forwardRef` giải quyết circular dependency | Nó chỉ làm code chạy được |
| DI chỉ để test dễ hơn | Nó còn để đổi cài đặt theo môi trường |
| Factory async làm app khởi động chậm là xấu | Fail fast lúc khởi động tốt hơn lỗi lúc phục vụ |

## Debugging

1. **"Nest can't resolve dependencies of X (?, Y)"** — dấu `?` là tham số thiếu, theo đúng thứ tự. Kiểm tra: `@Injectable()`? trong `providers`? nếu ở module khác thì `exports` + `imports`?
2. **Token chuỗi không tìm thấy** → so từng ký tự; chuyển sang `Symbol` hằng để compiler bắt lỗi.
3. **Nghi nhiều instance** → log trong constructor; đếm số lần chạy lúc khởi động.
4. **Nghi request scope lan** → log constructor và xem nó chạy mỗi request hay một lần.
5. **Circular dependency** → Nest in ra chuỗi vòng; đọc nó như một bản đồ ranh giới sai.
6. **Provider không được tạo** → nó có nằm trong nhánh module nào được `AppModule` với tới không?
7. **Hành vi khác giữa test và production** → provider nào đang bị `overrideProvider` thay thế?

## Explain Without Notes

1. DI container lưu gì, và token mặc định là gì?
2. Bốn cách khai báo provider và khi nào dùng từng cái.
3. `useClass` và `useExisting` khác nhau ra sao?
4. Vì sao token chuỗi cần `@Inject()` còn class thì không?
5. Ba scope, và vì sao request scope nguy hiểm hơn nó có vẻ?
6. Cách đúng để có dữ liệu theo request mà vẫn giữ singleton?
7. `@Global()` đánh đổi gì?
8. Vì sao `forwardRef` là băng dán, và ba nguyên nhân gốc của circular dependency?

## Related

- [Building blocks](01-building-blocks.md) — module, controller, provider
- [Modules & DI](../behavior/02-modules-di.md) — cơ chế container, forwardRef chi tiết
- [Config & lifecycle](../behavior/05-config-lifecycle.md) — factory async, fail fast, shutdown
- [Testing NestJS](../behavior/09-testing-nestjs.md) — `overrideProvider`
- [Request lifecycle](../behavior/01-request-lifecycle.md) — nơi scope có tác dụng
- [Modular monolith](../../04-architecture/02-modular-monolith.md) — ranh giới module
- [Domain logic boundaries](../../04-architecture/03-domain-logic-boundaries.md) — vòng phụ thuộc là dấu hiệu gì
- [Structured logging](../../../05-cross-cutting/observability/02-structured-logging.md) — AsyncLocalStorage cho ngữ cảnh

## Version / Context

NestJS **11**. DI dựa vào `experimentalDecorators` và `emitDecoratorMetadata` trong `tsconfig.json`. `AsyncLocalStorage` ổn định từ Node 16. Với Nest 11, `Scope.REQUEST` vẫn lan lên chuỗi phụ thuộc — đây là hành vi theo thiết kế, không phải hạn chế tạm thời. `forwardRef` áp dụng cho cả provider (`@Inject(forwardRef(...))`) và module (`imports: [forwardRef(...)]`) — thiếu một trong hai vẫn lỗi.
