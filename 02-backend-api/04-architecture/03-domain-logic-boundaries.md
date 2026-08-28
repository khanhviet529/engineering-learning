---
level: advanced
area: backend
prerequisites:
  - 01-controller-service-repository.md
related:
  - 02-modular-monolith.md
  - 04-error-handling-strategy.md
  - ../02-nestjs/06-database-integration-transactions.md
---

# Domain logic boundaries

> Yêu cầu mới: "khi hết hạn dùng thử mà chưa thanh toán thì khoá workspace". Bạn tìm chỗ để viết quy tắc đó. Nó cần biết ngày hết hạn (bảng subscriptions), trạng thái thanh toán (module billing), và phải chạy được từ cả cron job lẫn webhook của cổng thanh toán. Không có chỗ nào đúng, nên nó được viết ở nơi tiện nhất — và ba tháng sau có một bản sao thứ hai ở webhook, hơi khác một chút.

## Position

```text
HTTP · Queue · Cron · CLI     ← đường vào (thay được)
        ↓
   APPLICATION (use case)      ← điều phối, transaction, quyền
        ↓
      DOMAIN                   ← quy tắc nghiệp vụ, KHÔNG phụ thuộc gì
        ↓
  INFRASTRUCTURE               ← DB, HTTP client, email, S3 (thay được)
```

Quy tắc một chiều: **mũi tên phụ thuộc chỉ được hướng vào trong.** Domain không biết HTTP tồn tại, không biết PostgreSQL tồn tại, không biết NestJS tồn tại.

## Problem

"Logic nghiệp vụ" là thứ duy nhất trong hệ thống mà **không ai ngoài công ty bạn có thể viết hộ**. Framework thay được, database thay được, cloud provider thay được. Quy tắc "khi nào một task được đóng" thì không.

Nhưng nó cũng là thứ dễ bị hoà tan nhất:

```ts
// quy tắc nằm trong controller — dính HTTP
if (task.status === 'closed') throw new BadRequestException('already closed');

// quy tắc nằm trong query — dính SQL
UPDATE tasks SET status='closed' WHERE id=$1 AND status != 'closed' AND pending_subtasks = 0

// quy tắc nằm trong validation DTO — dính class-validator
@ValidateIf((o) => o.status === 'closed') @IsEmpty() reopenReason?: string;

// quy tắc nằm trong frontend — dính React
{task.pendingSubtasks === 0 && <CloseButton />}
```

Bốn mảnh của cùng một quy tắc, ở bốn công nghệ khác nhau. Khi quy tắc đổi, bạn phải nhớ cả bốn. Bạn sẽ không nhớ.

Bốn hệ quả đo được:

```text
1. Không trả lời được "quy tắc X nằm ở đâu"     → mỗi lần sửa là một cuộc tìm kiếm
2. Không test được quy tắc mà không dựng hạ tầng → nên không ai test chúng
3. Không tái dùng được từ đường vào khác        → nên logic bị copy
4. Đổi framework = viết lại nghiệp vụ           → nên không bao giờ đổi được
```

## Mental Model

### Câu hỏi phân loại

Với mỗi đoạn logic, hỏi: **"quy tắc này đúng ngay cả khi hệ thống không có HTTP, không có database, không có UI?"**

```text
CÓ  → domain
     "task đã đóng thì không đóng lại được"
     "hoá đơn là tổng các dòng, cộng thuế"
     "gói free tối đa 3 project"

KHÔNG → application (use case)
     "tải task lên, kiểm tra quyền, đóng, ghi activity, phát event" — đây là ĐIỀU PHỐI
     "mở transaction, gọi 3 repository, commit"

KHÔNG → infrastructure
     "SELECT ... FOR UPDATE"
     "gửi email qua SES"
     "trả 409 khi conflict"
```

Ranh giới giữa domain và application hay bị lẫn. Cách phân biệt: **domain trả lời "cái gì đúng", application trả lời "làm theo thứ tự nào".**

### Ba tính chất của domain code

```text
1. Không import gì từ framework hay driver
   không @Injectable, không HttpException, không Prisma, không axios

2. Không I/O
   không async vì lý do mạng/đĩa (async vì tính toán thì hiếm)

3. Test được bằng một dòng
   new Task({...}).close(userId)  → không setup, không mock, 0ms
```

Tính chất 3 là bài kiểm tra thực dụng nhất và nó tự kiểm chứng: nếu test một quy tắc cần hơn 3 dòng setup, quy tắc đó chưa nằm trong domain.

### Chỗ dễ nhầm: validation

```text
VALIDATION (biên)          "title là string, dài 1..200, projectId là UUID"
                           → biết được mà không cần dữ liệu khác
                           → DTO + pipe

INVARIANT (domain)         "task đã đóng không đóng lại được"
                           "tổng phân bổ không vượt ngân sách project"
                           → cần trạng thái hiện tại
                           → domain object
```

Đưa invariant vào DTO là lỗi hay gặp vì `class-validator` có `@ValidateIf` và nó *trông như* làm được. Nhưng DTO chỉ thấy payload, không thấy trạng thái hiện tại của hệ thống — nên quy tắc đó sẽ không bao giờ đầy đủ. Xem [Validation & errors](../02-nestjs/03-validation-errors.md).

## How It Works

### Đảo chiều phụ thuộc: domain định nghĩa cái nó cần

Vấn đề: domain cần lưu dữ liệu, nhưng nếu nó import repository của Prisma thì nó phụ thuộc infrastructure.

```ts
// domain/task.repository.ts — INTERFACE do domain sở hữu, không có Prisma ở đây
export abstract class TaskRepository {
  abstract findById(id: TaskId): Promise<Task | null>;
  abstract save(task: Task): Promise<void>;
}
```

```ts
// infrastructure/prisma-task.repository.ts — IMPLEMENTATION phụ thuộc domain
@Injectable()
export class PrismaTaskRepository extends TaskRepository {
  async findById(id: TaskId) { /* Prisma ở đây */ }
}
```

```ts
// module — nối hai đầu lại
{ provide: TaskRepository, useClass: PrismaTaskRepository }
```

```text
TRƯỚC:  domain ──────▶ Prisma        (domain phụ thuộc hạ tầng)
SAU:    domain ◀────── Prisma        (hạ tầng phụ thuộc domain)
        (domain định nghĩa interface, hạ tầng implement)
```

Chi tiết kỹ thuật: dùng `abstract class`, **không** dùng `interface` — interface bị xoá khi compile nên không làm token DI được. Xem [Modules & DI](../02-nestjs/02-modules-di.md).

Câu hỏi công bằng: *"đây có phải over-engineering không?"* Với CRUD thuần thì có. Nó bắt đầu trả lãi khi quy tắc nghiệp vụ đủ nhiều để bạn muốn test chúng mà không cần DB — và bạn sẽ biết lúc nào, vì bạn sẽ thấy mình tránh viết test.

### Kiểu domain thay cho kiểu nguyên thuỷ

```ts
// ❌ mọi id đều là string — trình biên dịch không giúp được gì
function assign(taskId: string, userId: string, projectId: string) {}
assign(userId, taskId, projectId);      // hoán vị: compile sạch, chạy sai
```

```ts
// ✅ branded type — chi phí runtime bằng 0
export type TaskId = string & { readonly __brand: 'TaskId' };
export type UserId = string & { readonly __brand: 'UserId' };

function assign(taskId: TaskId, userId: UserId) {}
assign(userId, taskId);                  // ❌ compile error
```

```ts
// ✅ value object — bất biến, tự validate, không thể tồn tại ở trạng thái sai
export class Money {
  private constructor(readonly amount: number, readonly currency: Currency) {}

  static of(amount: number, currency: Currency): Money {
    if (!Number.isInteger(amount)) throw new RuleViolation('dùng đơn vị nhỏ nhất (xu)');
    return new Money(amount, currency);
  }
  add(other: Money): Money {
    if (other.currency !== this.currency) throw new RuleViolation('khác loại tiền tệ');
    return Money.of(this.amount + other.amount, this.currency);
  }
}
```

`Money` chặn hai lớp bug mà không test nào của bạn nghĩ tới: cộng USD với VND, và dùng số thực cho tiền (`0.1 + 0.2 !== 0.3`).

Nguyên tắc chung: **làm cho trạng thái sai không biểu diễn được.** Rẻ hơn nhiều so với kiểm tra ở mọi nơi có thể sai.

### Aggregate: đơn vị của tính nhất quán

```ts
export class Project {
  private tasks: Task[] = [];

  addTask(title: string, estimate: Hours) {
    // invariant xuyên nhiều entity — phải có một nơi ép nó
    const total = this.tasks.reduce((s, t) => s + t.estimate, 0);
    if (total + estimate > this.budgetHours)
      throw new RuleViolation('vượt ngân sách giờ của project');
    if (this.tasks.length >= this.plan.maxTasks)
      throw new RuleViolation('vượt giới hạn của gói');
    this.tasks.push(Task.create(title, estimate));
  }
}
```

Aggregate là câu trả lời cho: *"quy tắc này liên quan tới nhiều entity, đặt ở đâu?"* Đặt ở entity **sở hữu** invariant đó.

Và nó cho một quy tắc thực dụng về transaction: **một transaction nên sửa một aggregate.** Nếu use case của bạn phải sửa ba aggregate nguyên tử, hoặc ranh giới aggregate sai, hoặc bạn cần eventual consistency giữa chúng.

Cảnh báo về hiệu năng: nạp cả aggregate để kiểm tra một invariant có thể tốn kém (project có 5.000 task). Hai lối thoát: giữ giá trị tổng hợp trong chính aggregate (`totalEstimate` cập nhật khi thêm/xoá), hoặc đẩy invariant xuống DB constraint. Đừng nạp 5.000 row cho một phép cộng.

### Application service: điều phối, không quyết định

```ts
// application/close-task.usecase.ts
@Injectable()
export class CloseTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,      // interface của domain
    private readonly activity: ActivityLog,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(cmd: { taskId: TaskId; userId: UserId }): Promise<void> {
    await this.uow.run(async () => {
      const task = await this.tasks.findById(cmd.taskId);
      if (!task) throw new NotFoundError('task', cmd.taskId);

      task.close(cmd.userId);                    // ◀── QUYẾT ĐỊNH nằm trong domain

      await this.tasks.save(task);
      await this.activity.record('task.closed', cmd);
    });
  }
}
```

Đọc method này thấy **thứ tự các bước**, không thấy quy tắc nào. Đó là dấu hiệu ranh giới đúng. Nếu bạn thấy `if (task.status === ...)` ở đây, quy tắc đang rò rỉ ra ngoài domain.

### Đường vào là thứ thay được

```ts
// HTTP
@Post(':id/close') close(@Param('id') id: string, @CurrentUser() u: AuthUser) {
  return this.closeTask.execute({ taskId: id as TaskId, userId: u.id as UserId });
}

// Queue consumer
@Process('auto-close') handle(job: Job<{ taskId: string }>) {
  return this.closeTask.execute({ taskId: job.data.taskId as TaskId, userId: SYSTEM_USER });
}

// CLI
program.command('close <id>').action((id) =>
  this.closeTask.execute({ taskId: id as TaskId, userId: SYSTEM_USER }));
```

Ba đường vào, một use case, không lặp một dòng quy tắc nào. Đây là mục tiêu, và nó cũng là bài kiểm tra: **nếu thêm đường vào thứ hai buộc bạn copy logic, ranh giới chưa đúng.**

### Chi phí: khi nào KHÔNG làm

Kiến trúc này có giá thật: nhiều file hơn, code map giữa domain object và row DB, một tầng gián tiếp nữa để đọc.

```text
KHÔNG đáng khi:
  · CRUD thuần, quy tắc là "field bắt buộc"
  · Prototype, thời gian sống dự kiến < 6 tháng
  · Team chưa thống nhất về khái niệm — trừu tượng sai còn tệ hơn không có

ĐÁNG khi:
  · Có quy tắc mà người ngoài không đoán được (giá, quyền, workflow, tuân thủ)
  · Nhiều đường vào cùng một nghiệp vụ
  · Quy tắc thay đổi thường xuyên hơn hạ tầng
  · Sai một quy tắc là mất tiền hoặc mất dữ liệu
```

Cách tiếp cận thực tế nhất: **để CRUD là CRUD, và chỉ dựng domain layer quanh phần thật sự có quy tắc.** Một hệ thống có thể có `SettingsController → Prisma` trực tiếp và đồng thời có một `billing` domain đầy đủ. Đồng nhất không phải mục tiêu; đặt công sức đúng chỗ mới là.

## Example

Một quy tắc, ba nơi nó có thể sống, và hệ quả:

```text
Quy tắc: "gói free tối đa 3 project đang hoạt động"

(A) trong controller
    if (count >= 3) throw new BadRequestException(...)
    → import CSV bỏ qua quy tắc; admin panel bỏ qua; migration bỏ qua

(B) trong query
    INSERT ... WHERE (SELECT count(*) ...) < 3
    → quy tắc vô hình với người đọc code; đổi gói phải sửa SQL

(C) trong domain
    workspace.createProject(name)  →  ném RuleViolation nếu vượt hạn mức gói
    → mọi đường vào đều bị ràng buộc; test bằng 2 dòng; đọc là hiểu
```

Test cho (C):

```ts
it('gói free chặn project thứ tư', () => {
  const ws = Workspace.create({ plan: Plan.FREE });
  ws.createProject('a'); ws.createProject('b'); ws.createProject('c');
  expect(() => ws.createProject('d')).toThrow(RuleViolation);
});
```

Hai dòng setup, không DB, không HTTP, chạy trong một mili giây. So sánh với chi phí test cùng quy tắc ở (A) hoặc (B).

## Prediction

1. Quy tắc "task đã đóng không đóng lại được" nằm trong controller. Một import CSV tạo task với status tuỳ ý — quy tắc có được áp dụng không?
2. Domain service có `@Injectable()` và inject `PrismaService` — test quy tắc cần gì?
3. Dùng `interface TaskRepository` làm token DI — chuyện gì xảy ra lúc khởi động?
4. `assign(taskId: string, userId: string)` bị gọi hoán vị hai tham số — bắt được lúc nào? Với branded type thì sao?
5. `Money` cho phép cộng khác currency, dữ liệu có VND và USD — hệ quả xuất hiện ở đâu?
6. Aggregate `Project` chứa 5.000 task, mỗi lần thêm task phải nạp hết để kiểm tra ngân sách — latency thế nào?
7. Application service chứa `if (task.status === 'closed') throw` — điều gì cho biết ranh giới đã rò rỉ?
8. Domain ném `RuleViolation`, không có filter nào biết class đó — client nhận status nào?
9. Một use case sửa ba aggregate trong một transaction — dấu hiệu gì về thiết kế?

<details>
<summary>Đáp án</summary>

1. **Không.** Import CSV không đi qua controller. Đây là cách dữ liệu không hợp lệ vào hệ thống mà mọi test API đều xanh.
2. Cần dựng DI container hoặc mock Prisma. Test đắt → ít test → quy tắc không được bảo vệ.
3. `Nest can't resolve dependencies (?)` — interface bị xoá khi compile.
4. Với `string`: **không bắt được** cho tới khi có người phát hiện dữ liệu sai. Với branded type: lỗi compile.
5. Ở báo cáo tài chính, và thường là nhiều tháng sau. Loại bug đắt nhất là bug âm thầm làm hỏng dữ liệu.
6. Latency tăng theo số task, và nó tăng dần theo thời gian nên không ai để ý cho tới khi quá muộn. Giữ tổng trong aggregate hoặc dùng DB constraint.
7. Quyết định nghiệp vụ đang nằm ở tầng điều phối. Đọc use case không còn thấy "thứ tự các bước" thuần tuý.
8. **500.** Filter phải nhận biết cây lỗi domain. Xem [Error handling strategy](04-error-handling-strategy.md).
9. Hoặc ranh giới aggregate sai (ba cái này thực ra là một), hoặc bạn cần eventual consistency giữa chúng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Viết một test cho một quy tắc nghiệp vụ | Bao nhiêu dòng setup? >3 là tín hiệu |
| Thêm một đường vào thứ hai (CLI) cho một use case có sẵn | Phải copy bao nhiêu logic? |
| `grep -r "HttpException\|@Injectable\|prisma" src/domain/` | Mỗi kết quả là một rò rỉ |
| Đổi `string` id thành branded type ở một hàm | Bao nhiêu chỗ gọi sai lộ ra? |
| Cho `Money` cộng khác currency, chạy suite | Có test nào đỏ không? |
| Nạp aggregate 5.000 phần tử, đo thời gian thêm một phần tử | Latency |
| Ném `RuleViolation` từ domain khi filter chưa biết | 500 |
| Xoá một quy tắc khỏi domain object | Bao nhiêu test đỏ? 0 = quy tắc không được bảo vệ |

## What Usually Goes Wrong

- **Quy tắc rải ở nhiều tầng** → không có nguồn sự thật; các bản sao lệch nhau.
- **Quy tắc trong controller** → đường vào khác bỏ qua nó.
- **Quy tắc trong SQL** → vô hình khi đọc code; không test đơn vị được.
- **Quy tắc trong frontend** → không phải quy tắc, chỉ là gợi ý UX.
- **Domain import framework** → không test được nếu không dựng framework.
- **Dùng `interface` làm token DI** → `(?)` lúc khởi động.
- **Kiểu nguyên thuỷ ở khắp nơi** → hoán vị tham số, đơn vị lẫn lộn.
- **Anemic model** → domain object chỉ là túi dữ liệu; quy tắc lặp trong service.
- **Application service chứa quyết định** → ranh giới rò rỉ ngược.
- **Aggregate quá lớn** → nạp chậm, khoá rộng, deadlock.
- **Aggregate quá nhỏ** → invariant xuyên aggregate không ai ép.
- **Domain layer cho CRUD thuần** → nhiều file, không lợi ích; điều này cũng là một lỗi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Domain layer = viết nhiều file hơn cho mọi thứ | Chỉ dựng quanh phần thật sự có quy tắc |
| Validation DTO là logic nghiệp vụ | Validation kiểm tra hình dạng; invariant cần trạng thái |
| Entity của ORM là domain model | Nó là ánh xạ bảng; thường không có hành vi |
| Constraint DB là đủ để bảo vệ quy tắc | DB không diễn đạt được quy tắc phức tạp, và thông báo lỗi vô nghĩa |
| Domain phải không có `async` | Tránh I/O, không phải tránh `async` |
| Kiểu nguyên thuỷ là đủ | Branded type miễn phí lúc runtime và chặn cả một lớp bug |
| Aggregate càng lớn càng nhất quán | Càng lớn càng chậm và càng dễ deadlock |
| Repository interface là over-engineering | Nó tồn tại để domain không phụ thuộc hạ tầng, không phải để đổi DB |
| Kiến trúc phải đồng nhất toàn codebase | Đặt công sức nơi có rủi ro; CRUD cứ là CRUD |

## Debugging

1. **"Quy tắc X nằm ở đâu?"** — grep. Nếu ra nhiều file ở nhiều tầng, đó là câu trả lời.
2. **`grep -r "prisma\|HttpException\|axios" src/domain/`** — mỗi kết quả là một rò rỉ phụ thuộc.
3. **Đo chi phí test một quy tắc** — nếu cần dựng module/DB, quy tắc chưa ở đúng chỗ.
4. **Đếm đường vào** — với mỗi use case quan trọng, có bao nhiêu đường vào, và chúng có gọi chung một chỗ không?
5. **Xoá thử một quy tắc** — bao nhiêu test đỏ? 0 nghĩa là quy tắc không được bảo vệ dù có thể nó được viết đúng.
6. **Đọc một application service** — nếu thấy `if` về nghiệp vụ, ranh giới đã rò rỉ.

## Production Considerations

- **Quy tắc quan trọng nên có hai lớp**: domain (thông báo tốt, test rẻ) và DB constraint (đúng cả khi có concurrency và cả khi có người sửa dữ liệu bằng tay). Chúng bổ sung, không thay thế nhau.
- **Domain ném lỗi domain**; đúng một chỗ dịch sang HTTP. Xem [Error handling strategy](04-error-handling-strategy.md).
- **Ghi lại quy tắc dưới dạng test có tên đọc được**: `it('gói free chặn project thứ tư')`. Đây là tài liệu duy nhất không bao giờ lỗi thời.
- **Aggregate lớn là vấn đề vận hành**, không chỉ vấn đề thiết kế: nó tạo transaction dài, khoá rộng và deadlock. Xem [Locking & deadlock](../../03-database/01-postgresql/05-locking-deadlock.md).
- **Value object cho tiền và thời gian là hai chỗ đáng đầu tư nhất.** Số thực cho tiền và `Date` không có múi giờ là hai nguồn bug âm thầm phổ biến nhất trong hệ thống nghiệp vụ.
- **Đừng bắt đầu bằng kiến trúc đầy đủ.** Bắt đầu bằng service + repository; rút domain object ra khi bạn thấy quy tắc thứ hai bị lặp. Trừu tượng dựa trên hai ví dụ thật tốt hơn trừu tượng dựa trên dự đoán.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Domain layer tách bạch | quy tắc một chỗ, test rẻ, tái dùng | nhiều file, code map, gián tiếp |
| Logic trong service (anemic) | ít file, hợp ORM | quy tắc lặp, khó tìm |
| Repository interface do domain sở hữu | domain độc lập hạ tầng | thêm abstract class + provider |
| Gọi ORM trực tiếp | ngắn, nhanh | quy tắc dính hạ tầng |
| Value object | trạng thái sai không biểu diễn được | code map, ít quen thuộc |
| Kiểu nguyên thuỷ | đơn giản | hoán vị, đơn vị lẫn lộn |
| Aggregate lớn | invariant mạnh | nạp chậm, khoá rộng |
| Aggregate nhỏ | nhanh, ít khoá | invariant xuyên aggregate không ai ép |
| Quy tắc cũng ở DB constraint | đúng dưới concurrency | trùng lặp, thông báo lỗi xấu |

## Explain Without Notes

1. Câu hỏi nào phân loại một đoạn logic thuộc domain hay application?
2. Ba tính chất của domain code, và bài kiểm tra thực dụng nhất trong ba cái?
3. Đảo chiều phụ thuộc hoạt động thế nào? Vẽ mũi tên trước và sau.
4. Vì sao dùng `abstract class` chứ không `interface` cho repository trong NestJS?
5. Aggregate là gì, và quy tắc nào nó cho bạn về transaction?
6. Kể ba trường hợp **không** nên dựng domain layer.
7. Vì sao quy tắc quan trọng nên có cả ở domain lẫn DB constraint?

## Related

- [Controller → Service → Repository](01-controller-service-repository.md) — layer, nền của note này
- [Modular monolith](02-modular-monolith.md) — ranh giới giữa các module
- [Error handling strategy](04-error-handling-strategy.md) — lỗi domain đi ra HTTP thế nào
- [Validation & errors](../02-nestjs/03-validation-errors.md) — validation vs invariant
- [Modules & DI](../02-nestjs/02-modules-di.md) — vì sao interface không làm token được
- [Database & transactions](../02-nestjs/06-database-integration-transactions.md) — aggregate và transaction
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — lớp phòng thủ ở DB
- [Type system](../../01-web-frontend/01-javascript-typescript/07-typescript-type-system.md) — branded type, mô hình hoá bằng kiểu
