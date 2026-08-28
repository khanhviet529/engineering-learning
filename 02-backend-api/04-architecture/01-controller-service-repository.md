---
level: intermediate
area: backend
prerequisites:
  - ../02-nestjs/behavior/01-request-lifecycle.md
related:
  - 02-modular-monolith.md
  - 03-domain-logic-boundaries.md
  - ../02-nestjs/behavior/06-database-integration-transactions.md
---

# Controller → Service → Repository

> Team quy ước "mọi thứ phải có controller, service, repository". Sáu tháng sau, `TaskService` có 1.400 dòng, `TaskRepository` chỉ là một lớp mỏng gọi thẳng ORM và không giấu được gì, còn controller thì chứa ba câu lệnh `if` về quyền. Ba tầng đã được tạo ra đúng nghi thức, và không tầng nào bảo vệ được gì.

## Position

```text
HTTP (hoặc queue consumer, hoặc CLI, hoặc cron)
  ↓
CONTROLLER    dịch giao thức ↔ lời gọi hàm
  ↓
SERVICE       use case: điều phối, quyết định, ranh giới transaction
  ↓
REPOSITORY    dịch domain ↔ storage
  ↓
PostgreSQL
```

## Problem

Không có ranh giới, mọi thứ dồn vào một chỗ:

```ts
@Post(':id/close')
async close(@Param('id') id: string, @Req() req) {
  const task = await this.prisma.task.findUnique({ where: { id } });
  if (!task) throw new NotFoundException();
  if (task.ownerId !== req.user.id) throw new ForbiddenException();
  if (task.status === 'closed') throw new BadRequestException('already closed');
  if (task.subtaskCount > task.doneSubtaskCount)
    throw new BadRequestException('subtasks pending');

  await this.prisma.task.update({ where: { id }, data: { status: 'closed', closedAt: new Date() } });
  await this.prisma.activity.create({ data: { type: 'task.closed', taskId: id } });
  await this.mailer.send(task.watchers, `Task ${task.title} đã đóng`);
  return { ok: true };
}
```

Nó hoạt động. Vấn đề xuất hiện khi bạn cần một trong bốn điều sau, và mọi dự án đều cần ít nhất một:

1. **Đóng task từ chỗ khác** — một job dọn dẹp tự động, một import CSV, một webhook. Bạn không gọi lại được logic này vì nó dính vào `@Req()` và `HttpException`.
2. **Test quy tắc "còn subtask thì không đóng được"** — phải dựng HTTP server, phải có token, phải có DB.
3. **Biết quy tắc nghiệp vụ nằm ở đâu** — chúng nằm rải trong controller, cùng chỗ với chuyện tầm thường như đọc param.
4. **Đảm bảo update và activity cùng thành công** — chúng không nằm trong transaction, và không rõ ai chịu trách nhiệm cho việc đó.

Ranh giới tầng tồn tại để trả lời **một** câu hỏi: *khi thứ này thay đổi, tôi phải sửa ở đâu?*

```text
Đổi HTTP → gRPC?              chỉ controller
Đổi PostgreSQL → chỗ khác?    chỉ repository
Đổi quy tắc "khi nào đóng được"? chỉ service
```

Nếu một thay đổi trong ba cái trên bắt bạn sửa cả ba tầng, ranh giới của bạn không tồn tại — chỉ có thư mục.

## Mental Model

```text
CONTROLLER   Ngôn ngữ: HTTP. Biết status code, header, DTO.
             KHÔNG biết: quy tắc nghiệp vụ, SQL.
             Kích thước lành mạnh: 3–10 dòng mỗi handler.

SERVICE      Ngôn ngữ: nghiệp vụ. Biết "task", "đóng", "chủ sở hữu".
             KHÔNG biết: HTTP status, tên bảng, cú pháp SQL.
             Sở hữu: ranh giới transaction, thứ tự các bước.

REPOSITORY   Ngôn ngữ: lưu trữ. Biết bảng, cột, index, query.
             KHÔNG biết: vì sao dữ liệu được lấy.
             Trả về: đối tượng domain, không phải row thô của ORM.
```

Bài kiểm tra một câu cho mỗi tầng:

| Tầng | Câu hỏi kiểm tra |
|---|---|
| Controller | Nếu ngày mai gọi từ queue thay vì HTTP, có phải viết lại logic không? |
| Service | Đọc method này có hiểu được **quy tắc nghiệp vụ** mà không cần biết SQL không? |
| Repository | Đổi sang một storage khác, có phải sửa service không? |

Ba câu trả lời đúng đều là "không".

## How It Works

### Cùng use case, chia lại

```ts
// CONTROLLER — chỉ dịch giao thức
@Post(':id/close')
@HttpCode(200)
close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
  return this.tasks.close(id, user.id);
}
```

```ts
// SERVICE — use case, quy tắc, ranh giới transaction
async close(taskId: string, userId: string): Promise<Task> {
  return this.uow.run(async () => {
    const task = await this.tasks.findByIdForUpdate(taskId);
    if (!task) throw new NotFoundError('task', taskId);

    task.close(userId);                       // quy tắc sống trong domain object

    await this.tasks.save(task);
    await this.activity.record('task.closed', { taskId, userId });
    await this.outbox.enqueue({ type: 'task.closed', taskId });   // email do worker gửi
    return task;
  });
}
```

```ts
// DOMAIN — quy tắc, không phụ thuộc gì cả
export class Task {
  close(userId: string) {
    if (this.ownerId !== userId) throw new ForbiddenError('not owner');
    if (this.status === 'closed') throw new RuleViolation('already closed');
    if (this.pendingSubtasks > 0) throw new RuleViolation('subtasks pending');
    this.status = 'closed';
    this.closedAt = new Date();
  }
}
```

```ts
// REPOSITORY — chỉ biết lưu trữ
async findByIdForUpdate(id: string): Promise<Task | null> {
  const row = await this.db.$queryRaw`SELECT * FROM tasks WHERE id = ${id} FOR UPDATE`;
  return row[0] ? Task.fromRow(row[0]) : null;
}
```

Cái đạt được không phải là "code sạch hơn". Cái đạt được là bốn điều cụ thể:

```text
✓ Job dọn dẹp gọi thẳng tasks.close(id, systemUserId)
✓ Test quy tắc: new Task({...}).close(userId) — 3 dòng, 0 ms, không cần DB
✓ Đọc Task.close() là đọc toàn bộ quy tắc, ở một chỗ
✓ Transaction có chủ: service, và nó rõ ràng
```

### Repository: giấu cái gì, không giấu cái gì

Sai lầm phổ biến là repository chỉ bọc mỏng ORM:

```ts
// ❌ không giấu gì — chỉ thêm một lớp phải bảo trì
class TaskRepository {
  findMany(args: Prisma.TaskFindManyArgs) { return this.db.task.findMany(args); }
}
// service phải biết cú pháp Prisma → đổi ORM vẫn phải sửa service
```

```ts
// ✅ nói bằng ngôn ngữ nghiệp vụ
class TaskRepository {
  findOpenByProject(projectId: string, page: Page): Promise<Task[]>;
  findOverdue(before: Date, limit: number): Promise<Task[]>;
  countByStatus(projectId: string): Promise<Record<TaskStatus, number>>;
}
```

Tên method là bài kiểm tra: nếu nó chứa từ của ORM (`findMany`, `where`, `include`), lớp này chưa giấu gì.

Câu hỏi hợp lý: *"tôi sẽ không bao giờ đổi PostgreSQL, sao phải trừu tượng hoá?"* Đúng — và đó **không** phải lý do chính. Ba lý do thật hơn:

1. **Query nằm cùng một chỗ** thay vì rải trong 40 service. Khi cần thêm index hay sửa N+1, bạn biết tìm ở đâu.
2. **Service test được** với một repository giả đơn giản (không cần mock cú pháp ORM).
3. **Chỗ tự nhiên để đặt cache, đo query, thêm tenant filter** — một lần, cho mọi lời gọi.

Lý do 3 đáng giá nhất trong hệ thống multi-tenant: nếu điều kiện `tenantId` được ép ở repository, một service quên nó cũng không rò rỉ dữ liệu.

### Khi nào **không** cần ba tầng

Ranh giới có giá. Với một endpoint chỉ đọc và không có quy tắc nào:

```ts
@Get('countries')
getCountries() { return this.db.country.findMany({ orderBy: { name: 'asc' } }); }
```

Thêm `CountryService` chỉ để gọi `CountryRepository` chỉ để gọi `findMany` là ba file cho không có gì. **Ranh giới nên xuất hiện khi có thứ để bảo vệ**, không phải vì quy ước.

Dấu hiệu đã đến lúc tách:

```text
service có nhiều nhánh if về nghiệp vụ  → tách domain object
cùng query xuất hiện ở 3 nơi            → tách repository
controller có logic ngoài việc dịch     → đẩy xuống service
service gọi service gọi service...      → xem lại ranh giới module
```

### Anemic model: ba tầng đúng, quy tắc vẫn không có nhà

```ts
// service 200 dòng, entity chỉ là túi dữ liệu
class TaskService {
  async close(id, userId) {
    const t = await this.repo.findById(id);
    if (t.ownerId !== userId) throw ...;
    if (t.status === 'closed') throw ...;
    t.status = 'closed';
    await this.repo.save(t);
  }
  async reopen(id, userId) {
    const t = await this.repo.findById(id);
    if (t.ownerId !== userId) throw ...;     // lặp lại
    if (t.status !== 'closed') throw ...;
    t.status = 'open';
    await this.repo.save(t);
  }
  // ... 8 method nữa, mỗi cái lặp phần kiểm tra
}
```

Đây là kiến trúc phổ biến nhất trong thực tế và nó **chấp nhận được cho hệ thống đơn giản**. Nó trở thành vấn đề khi số quy tắc tăng: chúng bị lặp, và một chỗ sửa mà chỗ khác quên.

Điểm chuyển: khi cùng một quy tắc xuất hiện ở hai method, đưa nó vào entity. Không cần "làm DDD" — chỉ cần đặt quy tắc cạnh dữ liệu mà nó ràng buộc.

### Nhiều đường vào — bài kiểm tra thật của kiến trúc

```text
HTTP controller  ─┐
Queue consumer   ─┼──▶  TaskService.close()  ──▶ repository ──▶ DB
Cron job         ─┤
CLI command      ─┘
```

Nếu cả bốn gọi được cùng một service, ranh giới của bạn là thật. Nếu chỉ HTTP gọi được, ba đường còn lại sẽ copy logic — và bản copy sẽ lệch.

Điều này ràng buộc service: nó **không được** nhận `Request`, không được ném `HttpException`, không được đọc `process.env` trực tiếp. Xem [Domain logic boundaries](03-domain-logic-boundaries.md).

## Example

Một thay đổi thật, đo bằng số file phải sửa:

```text
Yêu cầu: "task chỉ đóng được nếu mọi subtask đã xong VÀ đã có ít nhất một comment"

Kiến trúc gộp:   sửa controller HTTP + job dọn dẹp + import CSV  = 3 chỗ, dễ sót
Kiến trúc tách:  sửa Task.close()                                = 1 chỗ
                 test: new Task({pendingSubtasks: 0, comments: 0}).close() → throw
```

Số "1 chỗ" đó là toàn bộ giá trị của việc phân tầng. Nếu một thay đổi nghiệp vụ vẫn phải đụng ba file, tầng của bạn chưa làm việc.

## Prediction

1. Logic đóng task nằm trong controller. Cần đóng task từ một cron job — bạn làm gì? Chuyện gì xảy ra sau 6 tháng?
2. Service ném `NotFoundException` của Nest, một queue consumer gọi service đó — consumer nhận gì và nó có nghĩa gì?
3. Repository nhận `Prisma.TaskFindManyArgs` — đổi sang Drizzle phải sửa những file nào?
4. Điều kiện `tenantId` được kiểm tra ở service, một service mới quên nó — chuyện gì xảy ra? Nếu ép ở repository thì sao?
5. Ranh giới transaction đặt ở repository (mỗi method tự mở) — hai method gọi liên tiếp có nguyên tử không?
6. Controller nhận `@Body() dto` rồi truyền thẳng `dto` xuống repository `save()` — lỗ hổng gì?
7. Service A gọi service B gọi service C, C gọi lại A — triệu chứng lúc khởi động?
8. Quy tắc "không đóng khi còn subtask" nằm trong service, lặp ở 4 method — thêm điều kiện mới, xác suất sót là bao nhiêu?

<details>
<summary>Đáp án</summary>

1. Copy logic sang job. Sau 6 tháng hai bản đã lệch: một bản có quy tắc mới, bản kia không. Bug loại này rất khó phát hiện vì cả hai đều "hoạt động".
2. Nhận một object có `getStatus()` — vô nghĩa với queue. Tệ hơn: consumer có thể coi nó là lỗi hệ thống và retry mãi.
3. **Mọi service** gọi repository đó — vì chúng đang nói bằng cú pháp Prisma. Trừu tượng hoá đã thất bại.
4. Rò rỉ dữ liệu chéo tenant. Ép ở repository thì service mới không thể quên.
5. **Không.** Hai transaction riêng; lỗi giữa chừng để lại dữ liệu nửa vời.
6. Mass assignment — client tự đặt `ownerId`, `role`. Xem [Validation & errors](../02-nestjs/behavior/03-validation-errors.md).
7. `Nest can't resolve dependencies` hoặc phải dùng `forwardRef`. Vòng phụ thuộc là tín hiệu ranh giới sai.
8. Cao. Đây chính là lý do quy tắc nên nằm cạnh dữ liệu, không lặp trong từng use case.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gọi service từ một script CLI đơn giản | Nó chạy được không? Phải giả lập `Request` không? |
| Viết test cho một quy tắc nghiệp vụ, không dùng DB | Mất bao nhiêu dòng setup? Trên 10 dòng là tín hiệu |
| Đổi tên một cột DB | Đếm số file phải sửa. Trên 1 = repository không giấu được gì |
| Thêm một quy tắc nghiệp vụ | Đếm số file phải sửa |
| Xoá điều kiện `tenantId` ở một service | Có test nào đỏ không? Repository có chặn không? |
| Ném lỗi giữa hai bước của use case | Dữ liệu nửa vời? Ai đáng lẽ mở transaction? |
| Truyền `dto` thẳng xuống `save()` với field lạ | Field lạ tới DB không? |
| Tạo vòng: service A ↔ service B | App start được không? |

## What Usually Goes Wrong

- **Ba tầng như nghi thức**, không tầng nào giấu được gì — chi phí bảo trì không đổi lấy lợi ích nào.
- **Logic nghiệp vụ trong controller** → không tái dùng được từ queue/cron/CLI.
- **Service ném `HttpException`** → domain dính HTTP.
- **Repository lộ cú pháp ORM** → trừu tượng hoá vô nghĩa.
- **Repository trả row thô của ORM** → mọi tầng trên biết cấu trúc bảng.
- **Ranh giới transaction ở repository** → không ghép được nhiều thao tác.
- **Service khổng lồ** (1000+ dòng) → thực chất là controller đổi tên.
- **Anemic model với quy tắc lặp** → sửa một chỗ, sót chỗ khác.
- **Vòng phụ thuộc giữa service** → ranh giới module sai, và `forwardRef` chỉ giấu nó đi.
- **DTO của HTTP dùng làm entity** → hình dạng API và hình dạng lưu trữ dính chặt; đổi API buộc đổi DB.
- **Điều kiện bảo mật (tenant, owner) ở tầng dễ quên** → lỗ hổng khi thêm code mới.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Ba tầng luôn tốt hơn | Chúng có giá; chỉ đáng khi có thứ để bảo vệ |
| Repository là để đổi database | Lý do thật hơn: gom query, test được, chỗ đặt cache/tenant filter |
| Service = nơi chứa mọi logic | Service **điều phối**; quy tắc nên ở gần dữ liệu |
| Controller mỏng nghĩa là kiến trúc tốt | Chỉ khi logic đi vào đúng chỗ, không phải vào một service khổng lồ |
| Layer và module là một | Layer chia theo *loại việc*; module chia theo *năng lực nghiệp vụ* |
| DTO dùng lại làm entity cho gọn | Nó buộc hình dạng API và hình dạng DB thay đổi cùng nhau |
| Transaction nên ở repository | Ở service — nó biết use case nào cần nguyên tử |
| Domain object cần framework DDD | Chỉ cần đặt quy tắc cạnh dữ liệu nó ràng buộc |

## Debugging

1. **"Sửa cái này phải đụng bao nhiêu file?"** — con số này là chỉ số sức khoẻ tốt nhất của kiến trúc. Đo nó cho ba loại thay đổi: đổi API, đổi schema, đổi quy tắc.
2. **Quy tắc nghiệp vụ nằm ở đâu?** — grep một quy tắc cụ thể. Nếu ra nhiều file, nó đã bị lặp.
3. **Service có test được không?** — thử viết một test không cần DB, không cần HTTP. Nếu không được, service đang dính vào hạ tầng.
4. **Query nằm ở đâu?** — grep tên bảng. Nếu xuất hiện ngoài repository, tầng đã rò rỉ.
5. **Vòng phụ thuộc** — `npx madge --circular src/`. Mỗi vòng là một ranh giới sai.
6. **Service nào quá lớn** — sắp xếp file theo số dòng. Service >500 dòng thường chứa nhiều use case không liên quan.

## Production Considerations

- **Ranh giới quan trọng nhất là ranh giới bạn dùng để ép quy tắc bảo mật.** Đặt `tenantId`/`ownerId` ở nơi không thể quên (repository, hoặc RLS ở PostgreSQL) đáng giá hơn mọi tinh chỉnh layering khác.
- **Ranh giới transaction phải rõ ai sở hữu**, và phải ngắn. Xem [Database & transactions](../02-nestjs/behavior/06-database-integration-transactions.md).
- **Repository là nơi đặt đo đạc**: đếm query, log query chậm, gắn tên use case vào query (`/* task.close */`) để `pg_stat_statements` đọc được.
- **Đừng trừu tượng hoá trước khi có ví dụ thứ hai.** Một trừu tượng hoá dựa trên một trường hợp gần như luôn sai hình dạng.
- **Layer không thay được module.** Một codebase có ba layer hoàn hảo nhưng chỉ một module vẫn là một cục. Xem [Modular monolith](02-modular-monolith.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ba tầng đầy đủ | thay đổi cô lập, test được | nhiều file, nhiều indirection |
| Controller gọi thẳng ORM | ít code, đọc thẳng | không tái dùng, không test rẻ |
| Repository trừu tượng thật | gom query, đổi được, đặt cache | phải thiết kế interface |
| Repository bọc mỏng ORM | ít nghĩ | không được lợi ích nào |
| Domain object có hành vi | quy tắc một chỗ | phải map row ↔ object |
| Anemic model | đơn giản, hợp ORM | quy tắc lặp, dễ lệch |
| DTO riêng cho mỗi tầng | tầng độc lập | code map lặp lại |
| Dùng chung một kiểu | ít code | mọi tầng dính nhau |

Về dòng cuối: với CRUD đơn giản, dùng chung kiểu là lựa chọn hợp lý. Tách khi API và storage bắt đầu tiến hoá theo hai hướng khác nhau — và bạn sẽ biết lúc đó, vì bạn sẽ thấy mình thêm field vào DB chỉ để API có nó.

## Explain Without Notes

1. Mỗi tầng "nói ngôn ngữ" gì, và một câu kiểm tra cho mỗi tầng?
2. Vì sao service không được ném `HttpException`? Kể một tình huống cụ thể mà nó gây hại.
3. Ba lý do thật để có repository, ngoài "đổi database"?
4. Anemic model là gì, khi nào chấp nhận được, dấu hiệu nào cho biết đã đến lúc đổi?
5. Vì sao "nhiều đường vào cùng gọi được service" là bài kiểm tra tốt cho kiến trúc?
6. Bạn đo sức khoẻ của kiến trúc bằng con số nào?

## Related

- [Modular monolith](02-modular-monolith.md) — chia theo năng lực, không chỉ theo layer
- [Domain logic boundaries](03-domain-logic-boundaries.md) — domain không biết HTTP
- [Error handling strategy](04-error-handling-strategy.md) — lỗi đi qua các tầng thế nào
- [Request lifecycle](../02-nestjs/behavior/01-request-lifecycle.md) — cái gì xảy ra trước controller
- [Database & transactions](../02-nestjs/behavior/06-database-integration-transactions.md) — ai sở hữu transaction
- [Modules & DI](../02-nestjs/behavior/02-modules-di.md) — module graph là kiến trúc thật
- [Testing NestJS](../02-nestjs/behavior/09-testing-nestjs.md) — ranh giới quyết định test rẻ hay đắt
- [REST API contract](../00-http-api/02-rest-api-contract.md) — hình dạng ở tầng controller
