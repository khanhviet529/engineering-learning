---
level: intermediate
area: backend
prerequisites:
  - 01-request-lifecycle.md
  - ../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md
related:
  - ../00-http-api/05-error-model.md
  - ../04-architecture/04-error-handling-strategy.md
  - ../../05-cross-cutting/security/02-injection.md
---

# Validation & errors

> DTO của bạn khai báo `projectId: number`. Client gửi `{"projectId": "1 OR 1=1"}`. TypeScript compile sạch, không có warning nào. Câu hỏi không phải "vì sao TypeScript không bắt" — mà là "biên giới giữa dữ liệu không đáng tin và dữ liệu đáng tin nằm ở dòng nào trong code của tôi".

## Position

```text
Client (không đáng tin)
   │  JSON tuỳ ý — client có thể gửi BẤT KỲ thứ gì
   ▼
body parser → guard (vẫn thấy dữ liệu thô!) → PIPE ◀── biên giới tin cậy nằm ở đây
   │
   ▼ (từ đây trở đi mới được phép tin)
controller → service → repository → PostgreSQL (constraint = phòng tuyến cuối)
```

Mọi hệ thống có đúng **một** đường kẻ chia "dữ liệu tôi không kiểm soát" khỏi "dữ liệu tôi đã kiểm tra". Trong NestJS, đường kẻ đó là pipe. Nếu bạn không biết nó ở đâu, bạn không có nó.

## Problem

TypeScript không tồn tại lúc runtime. Điều này đã được nói ở [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md); ở backend nó chuyển từ khó chịu thành nguy hiểm:

```ts
class CreateTaskDto {
  title: string;
  projectId: number;
  isDone: boolean;
}

@Post()
create(@Body() dto: CreateTaskDto) {
  return this.tasks.create(dto);   // dto là gì lúc runtime?
}
```

Không có `ValidationPipe`, `dto` là **object JSON thô mà client gửi**, ép kiểu bằng lời hứa suông:

```bash
curl -X POST /tasks -d '{"title": null, "projectId": "abc", "isDone": "no", "ownerId": 1, "role": "admin"}'
```

Từng thứ hỏng theo một cách riêng:

| Client gửi | Hệ quả trong app |
|---|---|
| `title: null` | `title.trim()` → `TypeError` → **500** (đáng lẽ 400) |
| `projectId: "abc"` | Query `WHERE project_id = 'abc'` → lỗi kiểu ở PostgreSQL → 500 |
| `isDone: "no"` | `"no"` là **truthy** → task được đánh dấu hoàn thành |
| `ownerId: 1` | Nếu service làm `repo.save(dto)` → **mass assignment**: client tự chọn chủ sở hữu |
| `role: "admin"` | Cùng lỗ hổng, hậu quả nặng hơn |

Hai dòng cuối là lớp lỗ hổng nghiêm trọng nhất và nó **không** trông giống lỗ hổng khi đọc code: `repo.save(dto)` là dòng vô hại nhất trên đời.

Vấn đề thứ hai, độc lập với validation: khi có lỗi, **client không phân biệt được các loại lỗi khác nhau**.

```json
{ "statusCode": 500, "message": "Internal server error" }
```

Client nhận cùng một thứ dù là: sai định dạng (sửa được, thử lại được), vi phạm quy tắc nghiệp vụ (không thử lại được), hay DB đang chết (thử lại sau thì được). Ba tình huống cần ba hành vi khác nhau ở client, và một hình dạng lỗi duy nhất khiến cả ba thành "thử lại xem sao".

## Mental Model

### Ba loại kiểm tra, ba nơi khác nhau

Đây là mô hình trung tâm của note này. Nhầm lẫn giữa ba loại là nguồn của cả over-engineering lẫn lỗ hổng:

```text
1. SHAPE     — "dữ liệu có đúng hình dạng không?"
   title là string? dài 1..200? projectId là số nguyên dương?
   → biết được mà KHÔNG cần đụng database
   → thuộc về PIPE / DTO
   → sai ⇒ 400

2. INVARIANT — "thao tác này có hợp lệ trong ngữ cảnh hiện tại không?"
   project có tồn tại? user có quyền trên project? task đã đóng chưa?
   → BẮT BUỘC phải đọc database
   → thuộc về SERVICE
   → sai ⇒ 404 / 409 / 422 tuỳ ngữ nghĩa

3. CONSTRAINT — "cơ sở dữ liệu có chấp nhận không?"
   unique(email), foreign key, check(quantity >= 0)
   → phòng tuyến CUỐI, đúng cả khi có concurrency
   → thuộc về SCHEMA
   → sai ⇒ map về 409
```

Quy tắc: **không thể thay loại này bằng loại kia.**

- Pipe không thay được service: pipe không nên query DB (nó chạy trước guard xong, không có transaction, và làm chậm mọi request).
- Service không thay được constraint: giữa `SELECT` kiểm tra trùng và `INSERT` có một khe thời gian, và hai request đồng thời chui lọt qua khe đó. Xem [Transaction isolation](../../03-database/01-postgresql/01-transaction-isolation.md).
- Constraint không thay được pipe: lỗi constraint cho client một thông báo vô nghĩa và tốn một vòng tới DB.

### Bốn loại lỗi, bốn hành vi client

```text
                  client sửa được?   thử lại được?   log ở mức nào?
INPUT (400/422)        có                không            debug
AUTH  (401/403)        có (login)        không            info
BUSINESS (404/409)     tuỳ               không            info
SYSTEM (5xx)           không             CÓ               error + alert
```

Chỉ nhóm cuối đáng để đánh thức ai đó lúc 3 giờ sáng. Nếu 400 của bạn được log ở mức `error`, alert của bạn sẽ ồn tới mức bị tắt — và rồi 500 thật cũng không ai thấy.

## How It Works

### `ValidationPipe` — cấu hình tối thiểu đúng

```ts
// main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,               // xoá field không khai báo trong DTO
  forbidNonWhitelisted: true,    // hoặc: 400 nếu có field lạ
  transform: true,               // biến plain object → instance của class DTO
  transformOptions: { enableImplicitConversion: false },
  disableErrorMessages: false,   // giữ message ở 4xx (KHÔNG chứa thông tin nội bộ)
}));
```

Từng tuỳ chọn, và điều gì hỏng khi thiếu nó:

**`whitelist: true`** — đây là dòng chống mass assignment. Không có nó, `dto` giữ nguyên mọi field client gửi, và `repo.save(dto)` ghi tất cả vào DB.

**`forbidNonWhitelisted: true`** — thay vì im lặng xoá, trả 400. Nên bật: `whitelist` một mình biến lỗi của client (gõ nhầm `titel`) thành hành vi im lặng khó debug — request thành công nhưng field không được lưu.

**`transform: true`** — không có nó, `dto` là plain object, không phải instance của class. Hệ quả: default value trong class không áp dụng, method của class không tồn tại, và `@Type()` không chạy.

**`enableImplicitConversion`** — đây là bẫy đáng nói riêng.

```ts
class Query {
  @IsInt() page: number;
  @IsBoolean() archived: boolean;
}
// GET /tasks?page=2&archived=true
// Query string LUÔN là string: { page: "2", archived: "true" }
```

Bật `enableImplicitConversion: true` thì `class-transformer` tự ép theo type TypeScript. Tiện — nhưng nó ép **mọi thứ**, kể cả nơi bạn không muốn:

```text
"abc"  → Number("abc") → NaN     rồi @IsInt() mới chạy trên NaN
"0"    → false?  "false" → true?  quy tắc ép boolean không như bạn nghĩ
"1e3"  → 1000                     ID biến thành số khác
```

Lựa chọn an toàn hơn: tắt implicit conversion, khai báo ép kiểu **rõ ràng ở từng field**:

```ts
class ListTasksQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;                                     // default áp dụng khi transform: true

  @Transform(({ value }) => value === 'true')     // ép boolean có chủ đích
  @IsBoolean()
  archived = false;
}
```

Đánh đổi: dài dòng hơn, nhưng mỗi lần ép kiểu là một quyết định bạn viết ra chứ không phải một quy tắc bạn thừa hưởng.

### DTO viết đúng

```ts
export class CreateTaskDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(5_000)
  description?: string;

  @IsUUID()
  projectId!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true })                       // validate TỪNG phần tử
  tags?: string[];

  @IsOptional() @ValidateNested() @Type(() => DueDateDto)
  due?: DueDateDto;                               // KHÔNG có @Type thì nested KHÔNG được validate
}
```

Ba chi tiết gây lỗ hổng im lặng:

1. **`@ValidateNested()` mà thiếu `@Type()`** → object lồng nhau không được validate. Không báo lỗi, chỉ đơn giản là bỏ qua. Đây là lỗi phổ biến nhất trong DTO thật.
2. **`each: true`** — thiếu nó, `@IsString()` validate *mảng* (fail) chứ không validate từng phần tử. Nhiều người thấy fail rồi bỏ luôn decorator.
3. **`@ArrayMaxSize`** — không giới hạn thì client gửi mảng 1 triệu phần tử. Validation vượt qua, service sinh 1 triệu row.

Có `@MaxLength` ở mọi string là kỷ luật rẻ: nếu không, một field `description` không giới hạn là một đường tới OOM. Xem [Process & memory](../01-nodejs/03-process-memory.md).

### DTO tái sử dụng, không copy

```ts
export class UpdateTaskDto extends PartialType(CreateTaskDto) {}          // mọi field optional
export class PublicTaskDto extends OmitType(Task, ['ownerId'] as const);  // bỏ field
export class TaskFilterDto extends PickType(CreateTaskDto, ['projectId']);
```

`PartialType`/`OmitType`/`PickType` (từ `@nestjs/mapped-types` hoặc `@nestjs/swagger`) giữ nguyên decorator validation. Copy-paste DTO là cách chắc chắn để `CreateTaskDto` có `@MaxLength(200)` còn `UpdateTaskDto` thì không.

### Cây lỗi trong domain, và filter dịch nó ra HTTP

Vấn đề thiết kế: service **không nên** ném `HttpException`. Nếu nó ném, service của bạn chỉ dùng được từ HTTP — không dùng được từ queue consumer, cron job hay CLI. Xem [Domain logic boundaries](../04-architecture/03-domain-logic-boundaries.md).

```ts
// domain/errors.ts — không biết HTTP tồn tại
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;      // giữ tên class trong stack trace
  }
}
export class NotFoundError extends DomainError   { readonly code = 'not_found'; }
export class ConflictError extends DomainError   { readonly code = 'conflict'; }
export class RuleViolation extends DomainError   { readonly code = 'rule_violation'; }
export class ForbiddenError extends DomainError  { readonly code = 'forbidden'; }
```

```ts
// service — ném lỗi domain
async close(taskId: string, userId: string) {
  const task = await this.repo.findById(taskId);
  if (!task) throw new NotFoundError('task not found', { taskId });
  if (task.ownerId !== userId) throw new ForbiddenError('not owner', { taskId, userId });
  if (task.status === 'closed') throw new RuleViolation('task already closed', { taskId });
  // ...
}
```

```ts
// filter — MỘT nơi duy nhất biết HTTP
const STATUS: Record<string, number> = {
  not_found: 404, conflict: 409, rule_violation: 422, forbidden: 403,
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();

    let status = 500;
    let body: Record<string, unknown> = { code: 'internal_error', message: 'Internal server error' };

    if (err instanceof DomainError) {
      status = STATUS[err.code] ?? 422;
      body = { code: err.code, message: err.message };        // message domain an toàn để lộ
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse();
      body = typeof r === 'string' ? { code: 'request_error', message: r } : (r as object);
    }

    // 5xx: log đầy đủ, KHÔNG trả ra ngoài. 4xx: log nhẹ.
    if (status >= 500) this.logger.error({ err, url: req.url, requestId: req.id }, 'unhandled');
    else this.logger.debug({ code: body.code, url: req.url }, 'client error');

    res.status(status).json({ error: { ...body, requestId: req.id } });
  }
}
```

Bốn tính chất của filter này, và mỗi cái sửa một vấn đề thật:

- **`requestId` trong response.** Người dùng báo lỗi bằng cách gửi bạn một chuỗi; bạn tìm ra đúng dòng log. Không có nó, hỗ trợ khách hàng là trò đoán.
- **5xx không bao giờ lộ `err.message`.** Message của PostgreSQL chứa tên bảng, tên cột, giá trị. Đó là thông tin dò tìm miễn phí cho attacker.
- **4xx không log ở mức `error`.** Nếu không, alert nhiễu tới mức vô dụng.
- **Domain error được dịch ở đúng một chỗ.** Thêm loại lỗi mới = thêm một dòng vào `STATUS`.

### Lỗi từ database — dịch, đừng để rơi xuống 500

```ts
// repository — biến lỗi driver thành lỗi domain, ngay tại nơi biết ý nghĩa của nó
try {
  return await this.prisma.user.create({ data });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictError('email already registered');    // → 409
  }
  throw e;
}
// pg thuần: e.code === '23505' (unique_violation), '23503' (foreign_key_violation)
```

Đây cũng là cách xử lý race condition đúng: **thử làm, bắt lỗi constraint** (`INSERT ... ON CONFLICT` hoặc try/catch) thay vì `SELECT` rồi `INSERT`. Kiểm tra trước không an toàn dưới concurrency.

### Chọn thư viện: `class-validator` hay Zod?

| | `class-validator` + `class-transformer` | Zod |
|---|---|---|
| Kiểu suy ra | khai báo hai lần (class + decorator) | `z.infer` — một nguồn sự thật |
| Tích hợp Nest | mặc định, `ValidationPipe` sẵn có | cần pipe tự viết (~15 dòng) |
| Nested/union | union kiểu discriminated khá vụng | mạnh, tự nhiên |
| Transform | qua `@Transform`/`@Type`, dễ nhầm | `.transform()` rõ ràng, có kiểu |
| Dùng chung với frontend | khó (cần decorator + reflect-metadata) | dễ — cùng schema hai phía |
| Phụ thuộc | `reflect-metadata`, `experimentalDecorators` | không |

Giữ `class-validator` nếu bạn theo mặc định của Nest và team đã quen. Chọn Zod nếu bạn muốn một schema dùng chung giữa Next.js và NestJS, hoặc gặp nhiều union/nested. Cả hai đều đúng; điều **sai** là không có cái nào.

## Example

Cùng một endpoint, xem bốn hình dạng lỗi mà nó phải trả:

```bash
# 1. shape sai → 400, message chỉ ra field
curl -X POST /tasks -d '{"title":"","projectId":"not-a-uuid"}'
# { "error": { "code":"request_error",
#              "message":["title should not be empty","projectId must be a UUID"],
#              "requestId":"..." } }

# 2. field lạ → 400 (forbidNonWhitelisted)
curl -X POST /tasks -d '{"title":"x","projectId":"<uuid>","ownerId":"me"}'
# { "error": { "message":["property ownerId should not exist"] } }

# 3. invariant → 404 (shape đúng, nhưng project không tồn tại)
curl -X POST /tasks -d '{"title":"x","projectId":"00000000-0000-0000-0000-000000000000"}'
# { "error": { "code":"not_found", "message":"project not found" } }

# 4. constraint → 409 (hai request đồng thời tạo cùng slug)
# { "error": { "code":"conflict", "message":"slug already used" } }
```

Bốn status, bốn hành vi client. Đó là mục tiêu.

## Prediction

1. Không có `ValidationPipe` toàn cục, client gửi `{"title": 123}` — service nhận gì? Lỗi ở đâu, status nào?
2. `whitelist: true` nhưng **không** `forbidNonWhitelisted`, client gửi `titel` (gõ nhầm) — client nhận status nào? Dữ liệu lưu thế nào?
3. `transform: false`, DTO có `limit = 20` làm default, client không gửi `limit` — `dto.limit` bằng gì?
4. `@ValidateNested()` mà quên `@Type()` — nested object có được validate không? Có báo lỗi gì không?
5. `@IsString()` trên `tags: string[]` mà thiếu `each: true` — client gửi `["a","b"]` thì kết quả?
6. `enableImplicitConversion: true`, query `?page=abc` với `@IsInt() page: number` — `page` bằng gì khi `@IsInt` chạy?
7. Service ném `new NotFoundError()` mà filter chưa xử lý `DomainError` — client nhận status nào?
8. Filter trả `err.message` cho lỗi 500 và lỗi đó đến từ PostgreSQL — client đọc được gì?
9. Hai request đồng thời `POST /users` cùng email; service `SELECT` rồi `INSERT`, DB có unique index — chuyện gì xảy ra?
10. Client gửi body 50 MB — validation chạy trước hay sau khi Node đọc hết body vào bộ nhớ?

<details>
<summary>Đáp án</summary>

1. Nhận `123` (number). `title.trim()` → `TypeError` → **500**. Lỗi input bị báo cáo như lỗi hệ thống.
2. **201 Created**, nhưng `title` là `undefined` trong DB. Im lặng và rất khó debug — đây là lý do nên bật `forbidNonWhitelisted`.
3. `undefined`. Default của class chỉ áp dụng khi tạo instance thật, tức là cần `transform: true`.
4. **Không** được validate, và **không** có cảnh báo nào. Client gửi gì cũng qua.
5. Fail — `@IsString()` chạy trên chính mảng. Cách sửa đúng là `@IsArray() @IsString({ each: true })`.
6. `NaN`. `@IsInt()` fail nên vẫn ra 400 — nhưng message khó hiểu, và với `@IsOptional()` thì `NaN` có thể lọt xuống dưới.
7. **500** — `DomainError` không phải `HttpException`, filter mặc định coi mọi thứ lạ là internal error.
8. Tên bảng, tên cột, có thể cả giá trị. Ví dụ: `duplicate key value violates unique constraint "users_email_key"`.
9. Cả hai `SELECT` đều thấy "chưa tồn tại", cả hai `INSERT`; một cái ném unique violation. Nếu không bắt → 500 thay vì 409.
10. **Sau.** Body phải được đọc và parse xong mới có object để validate. Vì thế phải giới hạn ở tầng trước: `app.use(json({ limit: '1mb' }))` và giới hạn ở reverse proxy.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tắt `ValidationPipe`, gửi `{"title": null}` | 500 với stack trace — lỗi client bị tính vào error rate |
| Bỏ `whitelist`, gửi thêm `{"ownerId":"<id người khác>"}` rồi kiểm tra row trong DB | Mass assignment: field lạ có tới DB không? |
| Bật `whitelist`, tắt `forbidNonWhitelisted`, gửi field gõ sai | 201 nhưng dữ liệu thiếu — bug im lặng |
| Quên `@Type()` trên nested | Nested object nhận rác mà vẫn 201 |
| Bật `enableImplicitConversion`, gửi `?limit=1e3` | `limit` = 1000, vượt `@Max(100)`? Kiểm tra thứ tự transform và validate |
| Gửi mảng 100.000 phần tử vào field không có `@ArrayMaxSize` | Đo RSS và thời gian validate |
| Gửi body 50 MB không giới hạn | Đo RSS; xác nhận vì sao giới hạn phải ở tầng trước |
| Gửi `{"__proto__": {"isAdmin": true}}` | Xác nhận `whitelist` loại nó; xác nhận cả khi không có `whitelist` thì code của bạn có bị ảnh hưởng không |
| Ném `DomainError` khi filter chưa biết nó | 500 — chứng minh vì sao filter phải là nơi duy nhất dịch lỗi |
| Trả `err.message` của lỗi Postgres ra client | Đọc xem lộ những gì |
| Xoá unique index, chạy 50 request đồng thời tạo cùng email | Đếm số row trùng — chứng minh vì sao `SELECT` rồi `INSERT` không an toàn |
| Log 400 ở mức `error`, chạy load test với payload sai | Xem alert nhiễu tới mức nào |

## What Usually Goes Wrong

- **Không có `ValidationPipe` toàn cục** — chỉ vài endpoint được bảo vệ; endpoint mới quên là mặc định hở.
- **`whitelist` thiếu** → mass assignment. Đây là lỗ hổng nghiêm trọng và dễ tránh nhất trong danh sách này.
- **`@ValidateNested` thiếu `@Type`** → nested không được kiểm tra, im lặng.
- **`each: true` thiếu** → mảng không được kiểm tra từng phần tử.
- **Không giới hạn độ dài/kích thước** — string, mảng, body. Đường tới OOM và tới DB phình.
- **Service ném `HttpException`** → domain dính vào HTTP; queue consumer gọi cùng service nhận lỗi vô nghĩa.
- **Không dịch lỗi DB** → 500 cho tình huống 409, và lộ nội bộ.
- **Trả `err.message` cho 5xx** → rò rỉ schema.
- **Log 4xx ở mức error** → alert fatigue.
- **Kiểm tra trùng bằng `SELECT` rồi `INSERT`** → race condition; phải có unique constraint.
- **Validate ở frontend rồi bỏ ở backend** — frontend validation là UX, không phải bảo mật. `curl` không chạy JavaScript của bạn.
- **Message lỗi tiết lộ thông tin ở endpoint auth**: "email không tồn tại" vs "sai mật khẩu" cho phép dò danh sách user. Xem [Password & MFA](../03-auth/05-password-mfa.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| TypeScript type bảo vệ được API | Type biến mất khi compile; runtime không biết gì |
| DTO có type là đã validate | Cần decorator + `ValidationPipe` |
| `whitelist: true` chỉ để cho gọn | Đó là dòng chống mass assignment |
| Validate ở frontend là đủ | Frontend là UX; attacker gọi API trực tiếp |
| Validation thay được constraint DB | Không — concurrency chui lọt giữa check và write |
| Constraint DB thay được validation | Thông báo lỗi vô nghĩa với client, tốn một round-trip |
| Mọi lỗi validation là 400 | Sai format = 400; đúng format nhưng vi phạm quy tắc = 422/409 |
| `enableImplicitConversion` là tiện lợi vô hại | Nó ép cả nơi bạn không muốn, theo quy tắc bạn không kiểm soát |
| Service nên ném `NotFoundException` của Nest | Chỉ khi service chỉ phục vụ HTTP mãi mãi |
| Message lỗi càng chi tiết càng tốt | Với 5xx, chi tiết là rò rỉ thông tin |

## Debugging

1. **Client nhận 500 cho input sai** → có `ValidationPipe` toàn cục không? Nó có được đăng ký **trước** khi route được xử lý không?
2. **Validation không chạy trên field cụ thể** → field đó có decorator không? Nếu là nested: có `@Type()` không? Nếu là mảng: có `each: true` không?
3. **Field bị mất im lặng** → `whitelist: true` + `forbidNonWhitelisted: false` + tên field gõ sai. Bật `forbidNonWhitelisted` là biết ngay.
4. **Default không áp dụng** → `transform: true` chưa bật.
5. **Query param là string** → thiếu `@Type(() => Number)`.
6. **Lỗi domain ra 500** → filter chưa nhận biết class lỗi đó. In `err.constructor.name` trong filter.
7. **Không tìm được log ứng với lỗi user báo** → chưa có `requestId` trong response.
8. **Lỗi trùng ra 500 thay vì 409** → repository chưa dịch mã lỗi driver (`23505` / `P2002`).
9. **Không rõ dữ liệu vào service là gì** → log `JSON.stringify(dto)` **sau** pipe và so với body thô log **trong** middleware. Khác nhau ở đâu chính là những gì pipe đã làm.

Bước 9 là bước hiệu quả nhất và ít người làm: nhìn dữ liệu ở **hai phía** của biên giới tin cậy.

## Production Considerations

- **`ValidationPipe` toàn cục ngay từ commit đầu tiên.** Thêm sau nghĩa là phải rà lại toàn bộ endpoint đã có.
- **Giới hạn kích thước body ở nhiều tầng**: reverse proxy (`client_max_body_size`), Express (`json({ limit })`), và DTO (`@MaxLength`, `@ArrayMaxSize`). Tầng ngoài rẻ nhất; đừng để 50 MB đi tới `class-validator`.
- **`disableErrorMessages: true` ở production** là một lựa chọn, không phải mặc định đúng: nó giấu cả message hữu ích cho client hợp lệ. Tốt hơn: giữ message cho 4xx (chúng do bạn viết), che hoàn toàn cho 5xx.
- **Chi phí validation không bằng 0.** DTO lớn với nhiều nested + `class-transformer` có thể chiếm vài ms mỗi request. Nếu endpoint hot, đo nó.
- **Đưa `code` vào response, không chỉ `message`.** Client không nên parse tiếng Anh để biết chuyện gì xảy ra. Xem [Error model](../00-http-api/05-error-model.md).
- **Đếm lỗi theo `code` như metric.** Đột biến `rule_violation` thường là dấu hiệu client mới deploy sai, và bạn muốn biết trước khi họ báo.
- **Không bao giờ log payload thô nguyên vẹn.** Redact `password`, `token`, `authorization`, `card`. Dùng allowlist thay vì denylist nếu dữ liệu nhạy cảm nhiều.
- **Validation phải giống nhau giữa các đường vào.** Nếu queue consumer cũng tạo task, nó cũng phải validate — cùng schema, cùng chỗ. Xem [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `forbidNonWhitelisted: true` | lỗi client lộ ngay | client cũ gửi field thừa sẽ vỡ khi bạn thêm strictness |
| `whitelist` im lặng xoá | tương thích ngược tốt | bug gõ sai field rất khó tìm |
| `enableImplicitConversion` | DTO ngắn | ép kiểu ngoài kiểm soát |
| Ép kiểu tường minh từng field | rõ ràng, an toàn | dài dòng |
| Cây `DomainError` riêng | domain độc lập HTTP, dùng lại được | thêm một tầng dịch, thêm code |
| Ném `HttpException` trong service | ít code | domain dính HTTP, khó tái dùng |
| Message lỗi chi tiết | client debug dễ | rò rỉ thông tin ở 5xx và endpoint auth |
| Validate nghiêm ở biên | bug lộ sớm | integration với hệ thống cũ hay gãy |
| Zod | một schema, dùng chung FE/BE | rời khỏi mặc định của Nest |

## Explain Without Notes

1. Vẽ ba loại kiểm tra (shape / invariant / constraint) và nói rõ vì sao không thay thế nhau được.
2. `whitelist: true` chống lại tấn công nào? Mô tả tấn công đó bằng một câu `curl`.
3. Vì sao service **không** nên ném `HttpException`? Điều gì hỏng nếu nó ném?
4. Bốn loại lỗi và mức log tương ứng — vì sao 400 không được log là `error`?
5. Vì sao "kiểm tra tồn tại rồi mới insert" không an toàn, và cái gì thay thế nó?
6. Client gửi `?page=abc` — mô tả đường đi của giá trị đó cho tới lúc thành response 400.

## Related

- [Request lifecycle](01-request-lifecycle.md) — pipe nằm ở đâu, chạy sau guard
- [Error model](../00-http-api/05-error-model.md) — hình dạng lỗi ở tầng hợp đồng API
- [Error handling strategy](../04-architecture/04-error-handling-strategy.md) — chiến lược toàn app
- [Domain logic boundaries](../04-architecture/03-domain-logic-boundaries.md) — vì sao domain không biết HTTP
- [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md) — gốc của vấn đề
- [Injection](../../05-cross-cutting/security/02-injection.md) — validation là một lớp phòng thủ, không phải lớp duy nhất
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — phòng tuyến cuối
- [Forms (React)](../../01-web-frontend/02-react/10-forms.md) — phía client của cùng một DTO

## Version / Context

NestJS 10/11, `class-validator` 0.14, `class-transformer` 0.5.
