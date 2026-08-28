---
level: foundation
area: backend
related:
  - 02-di-providers.md
  - ../behavior/01-request-lifecycle.md
---

# NestJS building blocks: từ `main.ts` tới database

> Một dev đọc note "request lifecycle" của NestJS và không theo được. Không phải vì note khó — mà vì họ chưa biết `@Injectable()` khác `@Controller()` ở chỗ nào, vì sao service phải khai báo trong `providers` mới dùng được, và vì sao thêm một class mới lại báo *"Nest can't resolve dependencies"*. **Vocabulary phải đến trước lifecycle.**

## Position

```text
Note này là TỪ VỰNG. Đọc trước mọi note behavior của NestJS.

  building blocks (note này)
        ↓
  DI & providers (02)
        ↓
  request lifecycle (behavior/01)
        ↓
  guards, pipes, filters, transactions…
```

## Problem

```text
NestJS là một framework có Ý KIẾN: nó quy định cách bạn tổ chức code.
Cái giá là một tập khái niệm phải học TRƯỚC khi viết dòng đầu tiên:

  Module · Controller · Provider · Service · DI container · Injection token

Không có chúng, mọi thông báo lỗi của Nest đều khó hiểu,
và mọi hướng dẫn đều giống như đọc thần chú.
```

## Mental Model

### Đường đi từ khởi động tới database

```text
main.ts                    ← điểm vào, gọi NestFactory
  ↓ tạo application context
AppModule                  ← module gốc, import mọi feature module
  ↓
Feature Module             ← OrdersModule, UsersModule…
  ↓ khai báo controllers + providers
Controller                 ← nhận HTTP, KHÔNG chứa logic nghiệp vụ
  ↓ gọi
Service                    ← logic nghiệp vụ
  ↓ gọi
Repository / client ngoài  ← chạm database, API bên ngoài
  ↓
Database
```

```text
Quy tắc trách nhiệm, đọc từ trên xuống:
  Controller  dịch HTTP ↔ nghiệp vụ. Không biết SQL, không biết Redis.
  Service     biết nghiệp vụ. Không biết `Request`, `Response`, status code.
  Repository  biết lưu trữ. Không biết quy tắc nghiệp vụ.

Vi phạm phổ biến nhất: controller gọi thẳng repository,
hoặc service nhận `@Res()` và tự trả response.
```

### `main.ts` — nơi mọi thứ bắt đầu

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);   // ① dựng DI container

  app.useGlobalPipes(new ValidationPipe({            // ② cấu hình toàn cục
    whitelist: true,                                 //    bỏ field không có trong DTO
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.enableShutdownHooks();                         // ③ nhận SIGTERM

  await app.listen(3000);                            // ④ mở cổng
}
bootstrap();
```

```text
Bốn việc `main.ts` làm, và không nên làm gì khác:
  ① NestFactory quét AppModule → dựng đồ thị phụ thuộc → khởi tạo provider
  ② đăng ký thứ áp dụng cho MỌI request (pipe, filter, interceptor, CORS)
  ③ bật shutdown hook để đóng kết nối gọn khi container bị dừng
  ④ lắng nghe

Logic nghiệp vụ KHÔNG bao giờ ở đây.
```

### Module — đơn vị tổ chức và ranh giới hiển thị

```ts
@Module({
  imports: [TypeOrmModule.forFeature([Order]), PaymentsModule],  // ① dùng module khác
  controllers: [OrdersController],                                // ② nhận request
  providers: [OrdersService, OrderRepository],                    // ③ khởi tạo được
  exports: [OrdersService],                                       // ④ cho module khác dùng
})
export class OrdersModule {}
```

```text
Bốn trường, và mỗi trường trả lời một câu hỏi khác nhau:

imports      "module này CẦN gì từ nơi khác?"
controllers  "module này nhận request nào?"
providers    "module này TỰ tạo được những gì?"
exports      "module khác được dùng gì của module này?"
```

```text
Quy tắc hiển thị — nguồn của hầu hết lỗi DI:

  provider KHÔNG tự động dùng được ở mọi nơi.
  Nó chỉ dùng được TRONG module khai báo nó,
  hoặc ở module khác NẾU được `exports` VÀ module kia `imports`.

  A cần B  ⇒  B phải nằm trong `exports` của ModuleB
              VÀ ModuleB phải nằm trong `imports` của ModuleA
```

### Controller — biên HTTP

```ts
@Controller('orders')                       // tiền tố route: /orders
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}   // DI qua constructor

  @Get(':id')                               // GET /orders/:id
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(id);         // trả object → Nest tự serialize
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: User) {
    return this.orders.create(dto, user);
  }
}
```

```text
Controller CHỈ nên làm ba việc:
  ① khai báo route và method
  ② rút dữ liệu từ request qua decorator tham số
  ③ gọi service và trả kết quả

Nó KHÔNG nên: truy vấn database · chứa if/else nghiệp vụ · gọi API ngoài
```

### Provider và service

```ts
@Injectable()                               // ← đánh dấu: Nest quản lý vòng đời
export class OrdersService {
  constructor(
    private readonly repo: OrderRepository,     // Nest tự tiêm
    private readonly payments: PaymentsService,
  ) {}
}
```

```text
"Provider" là khái niệm RỘNG: bất cứ thứ gì DI container tạo và tiêm được.
  service · repository · factory · client HTTP · giá trị cấu hình

"Service" chỉ là provider chứa logic nghiệp vụ — một quy ước đặt tên,
không phải một khái niệm riêng của framework.

`@Injectable()` KHÔNG đăng ký class. Nó chỉ nói "class này tiêm được".
Đăng ký là việc của mảng `providers` trong module.
```

### DTO — hình dạng dữ liệu vào

```ts
export class CreateOrderDto {
  @IsUUID() cartId!: string;
  @IsInt() @Min(1) @Max(100) quantity!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
```

```text
DTO là HỢP ĐỒNG của endpoint, không phải entity database.

  · `ValidationPipe` dùng decorator ở đây để kiểm tra dữ liệu vào
  · `whitelist: true` XOÁ mọi field không khai báo
    → chặn mass assignment (client gửi `role: 'admin'` bị bỏ)
  · dùng entity làm DTO là lỗi: nó lộ cột nội bộ và cho phép ghi đè
```

Xem [Validation & errors](../behavior/03-validation-errors.md).

### Bản đồ decorator

```text
KHAI BÁO LỚP
  @Module({...})          định nghĩa module
  @Controller('prefix')   class nhận HTTP
  @Injectable()           class DI quản lý được

ĐỊNH TUYẾN — tham số là đường dẫn nối sau prefix của controller
  @Get() @Post() @Put() @Patch() @Delete()
  @HttpCode(204)          đổi status mặc định
  @Header('X-Foo','bar')  thêm header

RÚT DỮ LIỆU TỪ REQUEST
  @Body()      toàn bộ body, hoặc @Body('field')
  @Param('id') tham số đường dẫn
  @Query()     query string
  @Headers('authorization')
  @Req() @Res()  ← đối tượng của platform (Express/Fastify)

GẮN CƠ CHẾ
  @UseGuards(X) @UseInterceptors(X) @UsePipes(X) @UseFilters(X)
  @SetMetadata(k,v)   gắn metadata cho Guard đọc qua Reflector
```

```text
Cảnh báo về `@Res()`:
  dùng nó khiến Nest chuyển sang chế độ "bạn tự lo response".
  → interceptor KHÔNG chạy được nữa
  → serialization tự động ngừng hoạt động
  → code gắn chặt vào Express hoặc Fastify

  Cần đặt header hoặc status? Dùng `@Header()`, `@HttpCode()`,
  hoặc `@Res({ passthrough: true })`.
```

### Sáu cơ chế trong đường đi của request

```text
Request
  ↓
Middleware      cắt ngang, có `req`/`res` thô. Logging, body parser.
  ↓
Guard           CHO PHÉP hay TỪ CHỐI. Xác thực, phân quyền. Trả boolean.
  ↓
Interceptor     bọc TRƯỚC và SAU handler. Timing, transform response, cache.
  ↓
Pipe            biến đổi và VALIDATE tham số. DTO, ParseUUIDPipe.
  ↓
Controller → Service → Repository → Database
  ↓
Interceptor     phần "sau" chạy ở đây
  ↓
Exception Filter  bắt lỗi ném ra, dịch thành HTTP response
  ↓
Response
```

```text
Câu hỏi phân biệt khi không biết dùng cái nào:

  "được phép làm không?"       → Guard
  "dữ liệu vào có hợp lệ không?" → Pipe
  "cần làm gì đó quanh handler?" → Interceptor
  "lỗi này ra HTTP gì?"          → Exception Filter
  "cần chạm req/res thô?"        → Middleware
```

Chi tiết thứ tự và các trường hợp biên: [Request lifecycle](../behavior/01-request-lifecycle.md).

## Example

Một feature module hoàn chỉnh, mỗi phần đúng vai trò:

```ts
// orders/dto/create-order.dto.ts
export class CreateOrderDto {
  @IsUUID() cartId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// orders/orders.controller.ts — CHỈ dịch HTTP
@Controller('orders')
@UseGuards(AuthGuard)                              // mọi route cần đăng nhập
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.orders.findOne(id, user);          // service NÉM lỗi, không trả status
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: User) {
    return this.orders.create(dto, user);
  }
}

// orders/orders.service.ts — logic nghiệp vụ, không biết HTTP
@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrderRepository,
    private readonly payments: PaymentsService,     // từ PaymentsModule
  ) {}

  async findOne(id: string, user: User) {
    // điều kiện phân quyền nằm TRONG query — không kiểm tra sau
    const order = await this.repo.findOne({ id, tenantId: user.tenantId });
    if (!order) throw new NotFoundException();      // filter dịch thành 404
    return order;
  }
}

// orders/orders.module.ts — ranh giới hiển thị
@Module({
  imports: [TypeOrmModule.forFeature([Order]), PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderRepository],
  exports: [OrdersService],                         // module khác dùng được
})
export class OrdersModule {}

// app.module.ts
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), OrdersModule, PaymentsModule],
})
export class AppModule {}
```

```text
Bốn quyết định đáng chú ý:

`throw new NotFoundException()` trong service
  → service không biết mã HTTP; exception filter dịch. Service vẫn test được
    mà không cần dựng HTTP.

`{ id, tenantId: user.tenantId }` trong query
  → phân quyền nằm trong điều kiện truy vấn, không phải một `if` sau đó
    → không thể quên, và trả 404 thay vì 403.

`exports: [OrdersService]`
  → thiếu dòng này, module khác import OrdersModule vẫn KHÔNG dùng được service.

`PaymentsModule` trong `imports`
  → thiếu nó, `PaymentsService` trong constructor gây lỗi "can't resolve".
```

## Prediction

1. Thêm một service mới nhưng quên khai báo trong `providers` — chuyện gì xảy ra?
2. `ModuleB` khai báo `ServiceB` nhưng không `exports`; `ModuleA` import `ModuleB` và tiêm `ServiceB` — kết quả?
3. `@Injectable()` trên một class nhưng không có trong `providers` của module nào — nó có được tạo không?
4. Controller gọi thẳng repository, bỏ qua service — code còn chạy không? Vấn đề gì?
5. Dùng entity database làm DTO, client gửi thêm `role: 'admin'` — chuyện gì xảy ra nếu không có `whitelist`?
6. Có `whitelist: true` — chuyện gì xảy ra?
7. Dùng `@Res()` rồi tự gọi `res.json()` — interceptor có chạy không?
8. Service ném `NotFoundException` — ai dịch nó thành HTTP 404?
9. Guard trả `false` — handler có chạy không?
10. Đặt logic phân quyền theo chủ sở hữu trong Guard — nó cần làm gì thêm?
11. `app.enableShutdownHooks()` không được gọi, container nhận SIGTERM — chuyện gì xảy ra với kết nối DB?
12. Hai module cùng khai báo `OrdersService` trong `providers` — có mấy instance?

<details>
<summary>Đáp án</summary>

1. Lỗi lúc khởi động: **"Nest can't resolve dependencies"**.
2. **Cùng lỗi đó** — import module không đủ; provider phải được export.
3. **Không** — `@Injectable()` chỉ đánh dấu, không đăng ký.
4. **Chạy được**, nhưng logic nghiệp vụ rò rỉ vào tầng HTTP và không test được nếu không dựng HTTP.
5. Field đó **đi thẳng vào entity** → mass assignment.
6. Nó **bị xoá** khỏi payload trước khi tới handler.
7. **Không** — bạn đã chuyển sang chế độ tự lo response.
8. **Exception filter** (mặc định của Nest).
9. **Không** — Nest trả 403.
10. Nó phải **đọc tài nguyên** → thêm một truy vấn; đặt điều kiện trong query của service thường tốt hơn.
11. Kết nối **bị cắt đột ngột**, request đang xử lý bị mất.
12. **Hai instance khác nhau** — mỗi module một scope; thường là bug.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá một provider khỏi `providers` | Thông báo lỗi lúc khởi động nói gì? |
| Xoá `exports` của một service đang được module khác dùng | Lỗi giống hay khác? |
| Bỏ `@Injectable()` nhưng vẫn để trong `providers` | Có chạy không? Khi nào thì hỏng? |
| Gửi field thừa trong body có và không có `whitelist` | Khác nhau thế nào? |
| Dùng `@Res()` rồi kiểm tra interceptor logging | Nó có chạy không? |
| Khai báo cùng một service ở hai module, log `this` | Cùng instance không? |
| Ném `Error` thường thay vì `HttpException` | Client nhận status gì? |
| Bỏ `enableShutdownHooks`, gửi SIGTERM khi đang có request | Điều gì xảy ra? |

## What Usually Goes Wrong

- **Quên `providers`** hoặc **quên `exports`** → lỗi DI khó đọc.
- **Tưởng `@Injectable()` là đăng ký.**
- **Controller chứa logic nghiệp vụ** hoặc gọi thẳng repository.
- **Service biết về HTTP** (nhận `@Res()`, trả status code).
- **Dùng entity làm DTO** → mass assignment và lộ cột nội bộ.
- **Không bật `whitelist`** trong `ValidationPipe`.
- **Dùng `@Res()`** rồi mất interceptor và serialization.
- **Khai báo cùng provider ở nhiều module** → nhiều instance ngoài ý muốn.
- **Không `enableShutdownHooks`** → mất request khi deploy.
- **Đặt mọi thứ vào `AppModule`** → không có ranh giới, mọi thứ thấy mọi thứ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `@Injectable()` đăng ký class với DI | Nó chỉ đánh dấu; `providers` mới đăng ký |
| Import module là dùng được mọi provider của nó | Chỉ những gì được `exports` |
| Provider là singleton toàn ứng dụng | Nó là singleton **theo module scope** |
| Service phải kế thừa gì đó | Nó là class thường có `@Injectable()` |
| DTO là entity | DTO là hợp đồng của endpoint |
| Controller nên xử lý lỗi | Ném exception; filter dịch |
| `@Res()` là cách bình thường để trả response | Nó tắt interceptor và serialization |
| Guard là nơi kiểm tra mọi quyền | Quyền theo chủ sở hữu thuộc về query |

## Debugging

1. **"Nest can't resolve dependencies of X (?)"** — dấu `?` chỉ đúng vị trí tham số thiếu. Kiểm tra theo thứ tự: class có `@Injectable()`? có trong `providers`? nếu ở module khác thì có `exports` và `imports` chưa?
2. **Circular dependency** → Nest báo rõ; dùng `forwardRef()` như biện pháp tạm, nhưng nó thường là dấu hiệu ranh giới module sai.
3. **Route không khớp** → prefix của `@Controller()` cộng đường dẫn của `@Get()`; bật log route lúc khởi động để xem bảng route thật.
4. **Validation không chạy** → `ValidationPipe` đã đăng ký toàn cục chưa? DTO có phải class (không phải interface) không?
5. **Interceptor không chạy** → có `@Res()` ở đâu đó trong handler không?
6. **Nhiều instance của một service** → nó được khai báo ở mấy module?
7. **Lỗi trả về 500 thay vì mã đúng** → exception có kế thừa `HttpException` không?

## Explain Without Notes

1. Vẽ đường đi từ `main.ts` tới database và nêu trách nhiệm từng tầng.
2. Bốn trường của `@Module` trả lời bốn câu hỏi nào?
3. Quy tắc hiển thị của provider — hai điều kiện để module A dùng service của module B?
4. `@Injectable()` làm gì và **không** làm gì?
5. DTO khác entity ở điểm nào? `whitelist: true` chặn lớp lỗi nào?
6. Sáu cơ chế trong request pipeline và câu hỏi phân biệt chúng.
7. Vì sao `@Res()` là quyết định có hậu quả?
8. Vì sao service nên ném exception thay vì trả status code?

## Related

- [DI & providers](02-di-providers.md) — useClass/useValue/useFactory, scope, circular
- [Request lifecycle](../behavior/01-request-lifecycle.md) — thứ tự đầy đủ và trường hợp biên
- [Modules & DI](../behavior/02-modules-di.md) — cơ chế container chi tiết
- [Validation & errors](../behavior/03-validation-errors.md) — DTO, pipe, filter
- [Guards & interceptors](../behavior/04-guards-interceptors.md) — Reflector, mặc định đóng
- [Config & lifecycle](../behavior/05-config-lifecycle.md) — shutdown hook
- [Controller/Service/Repository](../../04-architecture/01-controller-service-repository.md) — trách nhiệm từng tầng
- [Modular monolith](../../04-architecture/02-modular-monolith.md) — ranh giới module ở quy mô lớn

## Version / Context

NestJS **11** (bản hiện tại), yêu cầu Node.js 20.19+ hoặc 22.12+. DI dựa vào `emitDecoratorMetadata` trong `tsconfig.json` — thiếu nó thì Nest không suy được kiểu tham số constructor và mọi injection bằng kiểu sẽ hỏng. Ví dụ dùng Express adapter (mặc định); với Fastify, `@Res()` có kiểu khác nhưng cảnh báo về việc mất interceptor là như nhau.
