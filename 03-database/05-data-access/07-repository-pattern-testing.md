---
level: advanced
area: database
prerequisites:
  - 02-prisma-model-and-client.md
  - ../../02-backend-api/04-architecture/01-controller-service-repository.md
related:
  - ../../02-backend-api/04-architecture/03-domain-logic-boundaries.md
  - ../../05-cross-cutting/testing/02-unit-vs-integration.md
---

# Repository pattern trên Prisma: có cần không?

> Prisma Client **đã là** một data access abstraction. Bọc nó bằng một repository chỉ để "có repository" tạo ra một tầng chuyển tiếp không thêm nghĩa — và nó là loại nợ khó bỏ nhất, vì nó trông giống kiến trúc tốt.

## Position

```text
Controller
    ↓
Service (domain logic)
    ↓
[ Repository? ]        ← note này: tầng này có đáng tồn tại?
    ↓
Prisma Client
    ↓
PostgreSQL
```

## Problem

Đây là repository mà gần như mọi dự án đều viết trong tuần đầu:

```ts
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  findAll() {
    return this.prisma.user.findMany();
  }
  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }
  delete(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
```

Hãy hỏi: **tầng này thêm gì?**

- Không thêm ngữ nghĩa nghiệp vụ — tên method là tên CRUD.
- Không che Prisma — signature nhận `Prisma.UserCreateInput`, tức Prisma vẫn rò rỉ ra ngoài.
- Không tạo test seam thật — mock nó nghĩa là test không kiểm tra query nào.
- Không cho phép đổi database — kiểu dữ liệu vẫn của Prisma.

Nó thêm: một file, một provider, một tầng phải đọc qua khi debug, và một chỗ nữa phải sửa khi thêm field.

Đây là **abstraction không có giá trị** — chi phí thật, lợi ích bằng 0.

Nhưng kết luận "repository luôn vô dụng" cũng sai. Câu hỏi đúng cụ thể hơn.

## Mental Model

> **Một tầng trừu tượng chỉ đáng tồn tại nếu nó cho phép bạn nói điều gì đó mà tầng dưới không nói được.**

Áp dụng vào đây:

```text
prisma.user.findUnique({ where: { id } })
   → nói: "lấy dòng theo khoá chính"

userRepo.findActiveWithExpiredTrial()
   → nói: "những user cần được nhắc gia hạn"
```

Câu thứ hai là **ngôn ngữ của nghiệp vụ**. Câu thứ nhất là ngôn ngữ của database. Repository có giá trị khi nó dịch từ thứ nhất sang thứ hai.

Bài kiểm tra một câu:

> **Nếu bạn xoá tầng repository, service có phải viết thêm logic nào không?**
>
> Không → repository đó chỉ là chuyển tiếp, xoá đi.
> Có → nó đang giữ logic thật, giữ lại.

## How It Works

### Khi **không** cần repository

```text
✅ CRUD đơn giản theo khoá chính
✅ Query chỉ dùng ở một chỗ
✅ Service đã là ranh giới đủ tốt
✅ Team nhỏ, một database, không có kế hoạch đổi
✅ Prisma Client đã cho type safety và composability
```

Trong trường hợp này, service gọi Prisma trực tiếp:

```ts
@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  async complete(taskId: string, userId: string) {
    const { count } = await this.prisma.task.updateMany({
      where: { id: taskId, assigneeId: userId, status: 'IN_PROGRESS' },
      data: { status: 'DONE', completedAt: new Date() },
    });
    if (count === 0) throw new ConflictError('TASK_NOT_COMPLETABLE');
  }
}
```

Điều này **không** phải "thiếu kiến trúc". Prisma Client *là* tầng data access; service *là* ranh giới domain. Hai tầng là đủ cho phần lớn ứng dụng. Xem [Controller–Service–Repository](../../02-backend-api/04-architecture/01-controller-service-repository.md).

### Khi repository **có** giá trị

Năm trường hợp cụ thể, mỗi cái có một lý do khác nhau:

**1. Query phức tạp được dùng lại ở nhiều chỗ**

```ts
@Injectable()
export class TaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Task quá hạn, chưa hoàn thành, thuộc project đang active — dùng ở 4 nơi */
  findOverdue(projectId: string) {
    return this.prisma.task.findMany({
      where: {
        projectId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { lt: new Date() },
        project: { archivedAt: null },
        deletedAt: null,
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
  }
}
```

Giá trị: điều kiện "quá hạn" được định nghĩa **một lần**. Nếu định nghĩa đổi (thêm `deletedAt: null`), sửa một chỗ. Không có repository, điều kiện này bị copy 4 lần và sẽ lệch nhau.

**2. Đóng gói raw SQL**

```ts
/** Raw SQL vì cần RANK() OVER — Prisma Client không diễn đạt window function */
async monthlyTopCustomers(from: Date) {
  const rows = await this.prisma.$queryRaw`WITH monthly AS (...) SELECT ... RANK() OVER (...)`;
  return RowSchema.array().parse(rows);
}
```

Giá trị: SQL thô không rải khắp service; có một chỗ để kiểm tra khi đổi schema. Xem [Raw SQL escape hatches](06-raw-sql-escape-hatches.md).

**3. Aggregate — nạp và lưu một cụm object như một đơn vị**

```ts
/** Order + lines + payments là MỘT đơn vị nhất quán */
async loadOrderAggregate(id: string): Promise<Order> {
  const row = await this.prisma.order.findUniqueOrThrow({
    where: { id },
    include: { lines: true, payments: true },
  });
  return Order.fromPersistence(row);        // dựng domain object có invariant
}

async saveOrderAggregate(order: Order) {
  const s = order.toPersistence();
  await this.prisma.$transaction([...]);     // lưu cả cụm nguyên tử
}
```

Giá trị lớn nhất và ít gặp nhất: repository trả về **domain object** (`Order` có method `addLine()`, `applyDiscount()` bảo vệ invariant), không phải row của Prisma. Đây là repository theo nghĩa DDD gốc.

Chỉ làm điều này khi domain thật sự có invariant phức tạp. Với CRUD, nó là over-engineering. Xem [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md).

**4. Nhiều nguồn dữ liệu sau một interface**

```ts
/** User đến từ PostgreSQL, nhưng có cache Redis và một số field từ service ngoài */
async findById(id: string): Promise<User | null> {
  const cached = await this.redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await this.prisma.user.findUnique({ where: { id } });
  if (user) await this.redis.setex(`user:${id}`, 300, JSON.stringify(user));
  return user;
}
```

Giá trị: service không cần biết có cache. Đây là trường hợp repository rõ ràng có nghĩa. Xem [Cache patterns](../02-redis/03-cache-patterns.md).

**5. Test seam thật sự cần**

Chỉ khi bạn **thật sự** muốn test service mà không cần database. Xem phần Testing dưới — đó là một lựa chọn có đánh đổi, không phải mặc định.

### Anti-pattern: repository "database-agnostic"

```ts
// ❌ Interface mô phỏng SQL — trừu tượng rò rỉ hoàn toàn
interface IRepository<T> {
  find(where: object, orderBy: object, take: number, skip: number): Promise<T[]>;
}
```

Vấn đề: interface này *là* SQL, chỉ khác cú pháp. Nó không cho phép đổi sang MongoDB (mô hình query khác hoàn toàn), không type-safe, và mất mọi tính năng của Prisma (`include` lồng nhau, `_count`, nested write).

Lý do "để đổi database sau này" gần như luôn là lý do giả:

- Đổi database là dự án nhiều tháng, không phải đổi một implementation.
- Query, index, transaction, kiểu dữ liệu đã gắn với database cụ thể.
- Trong thực tế điều này gần như không bao giờ xảy ra — và khi xảy ra, repository không giúp được nhiều.

Đây là YAGNI: trả chi phí ngay cho một lợi ích có thể không bao giờ đến. Xem [SOLID in practice](../../02-backend-api/04-architecture/06-solid-in-practice.md).

## Testing — nơi quyết định thật sự nằm

Đây là lý do phổ biến nhất người ta thêm repository, nên nó đáng được xem xét riêng.

```text
Chiến lược A — mock repository
  Service test không cần DB → nhanh (ms)
  NHƯNG: không kiểm tra query nào; mock có thể lệch thực tế
  → test pass, production lỗi

Chiến lược B — database thật (Testcontainers)
  Test đi qua Prisma và SQL thật → bắt được lỗi query, constraint, migration
  NHƯNG: chậm hơn (giây), cần Docker

Chiến lược C — kết hợp (thực dụng nhất)
  Domain logic thuần  → unit test, không DB, không mock
  Service + query     → integration test với DB thật
  → không cần repository chỉ để mock
```

Chiến lược C thường đúng, và nó có một hệ quả quan trọng: **nếu bạn tách domain logic ra thành hàm thuần, bạn không cần mock gì cả.**

```ts
// Domain logic thuần — test không cần DB, không cần mock
export function canComplete(task: Task, userId: string): Result<void, string> {
  if (task.status !== 'IN_PROGRESS') return err('WRONG_STATUS');
  if (task.assigneeId !== userId)     return err('NOT_ASSIGNEE');
  return ok();
}

// Test: 0ms, không mock, không repository
expect(canComplete({ status: 'DONE', assigneeId: 'u1' } as Task, 'u1')).toEqual(err('WRONG_STATUS'));
```

```ts
// Query: integration test với DB thật
it('findOverdue loại task đã xoá mềm', async () => {
  await prisma.task.createMany({ data: [
    { id: 't1', dueDate: yesterday, status: 'OPEN', projectId: 'p1' },
    { id: 't2', dueDate: yesterday, status: 'OPEN', projectId: 'p1', deletedAt: new Date() },
  ]});

  const rows = await repo.findOverdue('p1');
  expect(rows.map(r => r.id)).toEqual(['t1']);      // t2 bị loại — kiểm tra ĐIỀU KIỆN THẬT
});
```

Test thứ hai bắt được lỗi mà mock **không bao giờ** bắt được: điều kiện `deletedAt: null` bị quên. Xem [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md) và [Unit vs integration](../../05-cross-cutting/testing/02-unit-vs-integration.md).

### Transaction xuyên repository — vấn đề thật

Nếu có repository, transaction bao nhiều repository trở nên khó:

```ts
// ❌ Hai repository, hai connection — KHÔNG cùng transaction
await this.prisma.$transaction(async (tx) => {
  await this.taskRepo.update(...);      // dùng this.prisma, không phải tx
  await this.logRepo.create(...);       // connection khác
});
```

Cách sửa: truyền `tx` xuống, hoặc dùng AsyncLocalStorage để repository tự lấy client hiện tại:

```ts
// Truyền tường minh — đơn giản, rõ ràng, nhưng lan qua mọi signature
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class TaskRepository {
  constructor(private readonly prisma: PrismaService) {}
  findOverdue(projectId: string, db: Db = this.prisma) {
    return db.task.findMany({ where: { /* ... */ } });
  }
}

// Service
await this.prisma.$transaction(async (tx) => {
  await this.taskRepo.markDone(id, tx);
  await this.logRepo.record(id, tx);
});
```

Đây là **chi phí thật của repository** mà ít ai tính tới khi thêm nó. Xem [Database integration & transactions](../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md).

## Example

```ts
// Cấu hình thực dụng: KHÔNG có repository cho CRUD, CÓ cho query phức tạp
@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,      // CRUD trực tiếp
    private readonly taskQueries: TaskQueries,   // query phức tạp + raw SQL
  ) {}

  // CRUD: Prisma trực tiếp, không tầng trung gian
  findById(id: string) {
    return this.prisma.task.findUnique({ where: { id }, include: { assignee: true } });
  }

  // Query có ngữ nghĩa nghiệp vụ: qua tầng riêng, dùng lại được
  async sendOverdueReminders(projectId: string) {
    const overdue = await this.taskQueries.findOverdue(projectId);
    // ...
  }
}
```

Tên `TaskQueries` thay vì `TaskRepository` là có chủ đích: nó nói đúng vai trò (một tập query có tên) và không hứa hẹn một trừu tượng persistence đầy đủ mà nó không cung cấp.

## Prediction

1. Repository chỉ có `findById` gọi `prisma.user.findUnique` — xoá nó thì service phải viết thêm gì?
2. Mock repository trong service test, rồi quên `deletedAt: null` trong query thật — test pass không? Production?
3. `$transaction` bao hai repository dùng `this.prisma` — chúng có cùng transaction?
4. Interface `IRepository<T>` với `find(where, orderBy, take, skip)` — đổi sang MongoDB được không?
5. Domain logic tách thành hàm thuần — cần mock gì để test?
6. Điều kiện "task quá hạn" copy ở 4 chỗ, rồi thêm một điều kiện mới — bao nhiêu chỗ có nguy cơ bị quên?
7. Repository trả `Prisma.UserGetPayload<...>` — nó có che Prisma khỏi service?

<details>
<summary>Đáp án</summary>

1. Không gì cả — đó là bằng chứng nó chỉ là chuyển tiếp.
2. Test **pass**; production trả cả task đã xoá. Đây là loại lỗi mock không bắt được.
3. **Không** — mỗi repository dùng client riêng, ngoài transaction.
4. Không — mô hình query của MongoDB khác hoàn toàn; interface này là SQL trá hình.
5. Không cần mock gì.
6. 3 chỗ (hoặc 4 nếu quên hết) — và không có compiler nào nhắc.
7. Không — kiểu Prisma vẫn rò rỉ qua signature.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm số dòng của repository chỉ chuyển tiếp | Toàn bộ là boilerplate |
| Xoá nó, gọi Prisma trực tiếp | Ít code hơn, ít tầng debug hơn |
| Mock repository, cố tình viết query sai | Test vẫn pass |
| Đổi sang integration test với DB thật | Test fail đúng chỗ |
| `$transaction` bao hai repository không truyền `tx` | Không rollback; kiểm tra bằng cách gây lỗi ở lệnh sau |
| Copy điều kiện query 4 chỗ, thêm điều kiện mới vào 3 chỗ | Bug ở chỗ thứ 4, im lặng |
| Repository trả về type của Prisma | Đổi tên field trong schema → mọi tầng đều lỗi |
| Viết `IRepository<T>` generic rồi thử dùng `include` lồng nhau | Không diễn đạt được, phải thoát khỏi interface |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Repository luôn là kiến trúc tốt | Chỉ khi nó thêm ngữ nghĩa; nếu không, là nợ |
| Cần repository để test | Chỉ khi bạn chọn mock; tách domain thuần + integration test tốt hơn |
| Repository cho phép đổi database | Gần như luôn là lý do giả |
| Prisma Client không phải abstraction | Nó *là* data access layer |
| Không có repository là thiếu kiến trúc | Controller → Service → Prisma là hai tầng, đủ cho phần lớn app |
| Repository generic tái dùng tốt | Nó là SQL trá hình, mất tính năng ORM |
| Mock nhanh nên test tốt hơn | Mock nhiều = test ít giá trị |
| Repository và transaction phối hợp tự nhiên | Transaction xuyên repository là chi phí thật |

## Debugging

1. **Bài kiểm tra một câu**: xoá tầng repository (trong đầu) — service phải viết thêm logic gì? Không gì → xoá thật.
2. **Đếm tỉ lệ method chuyển tiếp 1:1** trong repository. Trên 70% là dấu hiệu rõ.
3. **Test pass nhưng production lỗi query** → đang mock quá sâu. Chuyển sang DB thật cho tầng query.
4. **Transaction không rollback** → kiểm tra repository có nhận `tx` không.
5. **Cùng điều kiện query xuất hiện nhiều nơi** → đây là lúc repository *thật sự* có giá trị; tách ra.
6. **Type của Prisma xuất hiện trong signature của controller** → repository không che gì; đó là dấu hiệu tầng này không làm việc nó hứa.

## Production Considerations

- **Mặc định: không có repository.** Service gọi Prisma trực tiếp. Thêm tầng khi có lý do cụ thể, không thêm trước.
- **Khi thêm, đặt tên theo vai trò**: `TaskQueries`, `RevenueReports` — không phải `TaskRepository` generic.
- **Tên method theo nghiệp vụ**, không theo CRUD: `findOverdue()`, không `findByStatusAndDate()`.
- **Truyền `tx` tường minh** hoặc dùng AsyncLocalStorage — quyết định sớm, đổi sau rất đau.
- **Integration test cho mọi query có điều kiện phức tạp** — đây là nơi bug thật sự nằm.
- **Tách domain logic thành hàm thuần** ở đâu có thể; nó xoá bỏ phần lớn nhu cầu mock.
- **Ghi ADR** nếu quyết định có/không có repository — người sau sẽ hỏi.
- Với modular monolith, repository có thể là ranh giới giữa module (module A không truy cập bảng của module B trực tiếp). Đây là lý do kiến trúc hợp lệ. Xem [Modular monolith](../../02-backend-api/04-architecture/02-modular-monolith.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không repository | ít code, ít tầng, transaction đơn giản | query phức tạp có thể bị lặp |
| Repository cho query phức tạp | một nguồn sự thật, dùng lại được | thêm một tầng |
| Repository đầy đủ (DDD) | domain object có invariant | nhiều code, chỉ đáng khi domain phức tạp |
| Mock repository trong test | test nhanh | không kiểm tra query, dễ lệch thực tế |
| Integration test | bắt lỗi thật | chậm hơn, cần Docker |
| Truyền `tx` tường minh | rõ ràng | lan qua mọi signature |
| AsyncLocalStorage | signature sạch | ẩn, khó debug hơn |

## Explain Without Notes

1. Bài kiểm tra một câu để biết repository có đáng tồn tại?
2. Năm trường hợp repository thật sự có giá trị?
3. Vì sao "để đổi database sau này" là lý do giả?
4. Mock repository che mất loại bug nào? Cho ví dụ cụ thể.
5. Vì sao tách domain logic thành hàm thuần làm giảm nhu cầu repository?
6. Transaction xuyên nhiều repository khó ở đâu, và hai cách xử lý?

## Related

- [Controller–Service–Repository](../../02-backend-api/04-architecture/01-controller-service-repository.md) — layering cơ bản
- [Domain logic boundaries](../../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — domain object và invariant
- [Modular monolith](../../02-backend-api/04-architecture/02-modular-monolith.md) — repository như ranh giới module
- [SOLID in practice](../../02-backend-api/04-architecture/06-solid-in-practice.md) — DIP và YAGNI
- [Clean architecture pragmatic](../../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md) — khi nào nhiều tầng là đúng
- [Raw SQL escape hatches](06-raw-sql-escape-hatches.md) — nơi đóng gói SQL thô
- [Unit vs integration](../../05-cross-cutting/testing/02-unit-vs-integration.md) · [Mocking & test doubles](../../05-cross-cutting/testing/04-mocking-test-doubles.md) · [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md)
- [Database integration & transactions (NestJS)](../../02-backend-api/02-nestjs/behavior/06-database-integration-transactions.md)
