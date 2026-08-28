---
level: intermediate
area: backend
prerequisites:
  - 01-controller-service-repository.md
related:
  - 07-clean-architecture-pragmatic.md
  - 08-service-decomposition.md
---

# SOLID trong thực tế

> SOLID là **heuristic**, không phải luật tự nhiên. Nó được viết năm 2000 cho codebase C++/Java lớn với chi phí thay đổi cao. Áp dụng máy móc vào một service TypeScript 5.000 dòng tạo ra nhiều lớp trừu tượng hơn code thật.

## Position

```text
Code smell (thứ bạn quan sát được)
      ↓
SOLID / DRY / KISS / YAGNI  ← note này: heuristic để chẩn đoán
      ↓
Refactor cụ thể, hoặc quyết định KHÔNG refactor
```

## Problem

Hai thất bại đối lập, và cả hai đều phổ biến:

**Thất bại 1 — không có nguyên tắc nào:**

```ts
// UsersService: 2.400 dòng, 15 dependency
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService, private mailer: MailerService,
    private stripe: StripeService, private s3: S3Service,
    private redis: RedisService, private queue: QueueService,
    private slack: SlackService, private pdf: PdfService,
    /* ... 7 nữa */
  ) {}

  async register(dto) { /* 180 dòng: validate, tạo user, gửi mail, tạo Stripe
                           customer, upload avatar, ghi audit, gửi Slack... */ }
}
```

**Thất bại 2 — áp dụng SOLID máy móc:**

```ts
// Cùng chức năng, 14 file, 9 interface
interface IUserRepository {}
interface IUserFactory {}
interface IUserValidator {}
interface IEmailNotifier {}
interface INotifierFactory {}
interface IUserRegistrationOrchestrator {}
class UserRegistrationOrchestratorImpl implements IUserRegistrationOrchestrator {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly userFactory: IUserFactory,
    private readonly userValidator: IUserValidator,
    private readonly notifierFactory: INotifierFactory,
  ) {}
  // 12 dòng, gọi 4 thứ khác
}
```

Thất bại 2 **cảm giác** như kiến trúc tốt. Nó có tên đúng, có interface, có DI. Nhưng để hiểu `register()` làm gì, bạn phải mở 9 file — và mọi interface chỉ có **một** implementation, nên không interface nào tạo ra khả năng thay thế.

Đây là chi phí trừu tượng không có lợi ích: **indirection mà không có polymorphism**.

## Mental Model

Đảo ngược cách thường được dạy: **bắt đầu từ code smell, không từ acronym.**

```text
❌ "Áp dụng SRP" → tách class ra cho đúng nguyên tắc
✅ "Class này khó test / khó đọc / sửa một thứ phá thứ khác" → tách theo lý do THẬT
```

Và câu hỏi kiểm tra mọi trừu tượng:

> **Trừu tượng này cho phép tôi làm gì mà không có nó thì không làm được?**
>
> Nếu câu trả lời là "không gì" → xoá nó.

Ba câu trả lời hợp lệ: (1) có nhiều implementation thật, (2) là ranh giới test cần thiết, (3) là ranh giới giữa các module/team.

## Năm nguyên tắc, qua code smell

### S — Single Responsibility

**Phát biểu hữu ích hơn phát biểu gốc:** một class nên có **một lý do để thay đổi**, không phải "làm một việc".

```ts
// Smell: đọc tên class không biết nó làm gì; hoặc mọi PR đều sửa file này
class UserService {
  register() {}          // lý do đổi: quy tắc đăng ký
  sendWelcomeEmail() {}  // lý do đổi: template email
  chargeSubscription() {} // lý do đổi: pricing
  generateInvoicePdf() {} // lý do đổi: layout hoá đơn
}
```

Bốn lý do thay đổi độc lập → bốn nơi nên tách.

Nhưng **đừng** tách theo số dòng:

```text
❌ "class > 200 dòng nên tách"
✅ "class này đổi vì 4 lý do độc lập nên tách theo 4 lý do đó"
```

Một class 400 dòng làm đúng một việc thì để nguyên. Xem [Service decomposition](08-service-decomposition.md).

### O — Open/Closed

**Áp dụng khi:** bạn thêm loại mới **thường xuyên** và biết trước sẽ thêm.

```ts
// Smell: switch theo type, và bạn đã sửa nó 5 lần trong 3 tháng
function calculateFee(method: string, amount: number) {
  switch (method) {
    case 'card':   return amount * 0.029 + 3000;
    case 'bank':   return 5000;
    case 'momo':   return amount * 0.02;
    // mỗi phương thức mới sửa hàm này
  }
}

// Mở rộng được: thêm loại = thêm entry, không sửa logic
const FEES: Record<PaymentMethod, (a: number) => number> = {
  card: (a) => a * 0.029 + 3000,
  bank: () => 5000,
  momo: (a) => a * 0.02,
};
const calculateFee = (m: PaymentMethod, a: number) => FEES[m](a);
```

Chú ý: giải pháp là một **object map**, không phải 4 class implement một interface. Với TypeScript, `Record` + union type cho bạn exhaustiveness check của compiler — thêm method mới vào union sẽ là lỗi compile ở mọi chỗ chưa xử lý. Đó thường là đủ.

**Không** áp dụng khi: một `switch` 3 case chưa đổi từ khi viết. Nó là YAGNI.

### L — Liskov Substitution

**Phát biểu thực tế:** subtype không được **làm người dùng bất ngờ**.

```ts
// ❌ Vi phạm: subtype thu hẹp hợp đồng
class Storage { async save(f: File): Promise<string> {} }

class S3Storage extends Storage {
  async save(f: File) {
    if (f.size > 5_000_000) throw new Error('Quá lớn');   // điều kiện MỚI
    // → code dùng Storage giờ có thể vỡ khi được truyền S3Storage
  }
}
```

Với TypeScript, LSP thường được compiler bảo vệ. Nơi nó vẫn vỡ là ở **hợp đồng runtime**: điều kiện tiền đề mới, exception mới, hoặc behavior khác (ví dụ một implementation là async thật, một implementation cache và trả tức thì với dữ liệu cũ).

### I — Interface Segregation

**Smell:** implement một interface nhưng nửa số method throw `NotImplemented`.

```ts
// ❌ Interface quá rộng
interface UserRepository {
  findById(id): Promise<User>;
  findAll(): Promise<User[]>;
  create(d): Promise<User>;
  update(id, d): Promise<User>;
  delete(id): Promise<void>;
  bulkImport(f: File): Promise<void>;      // chỉ admin dùng
  exportToCsv(): Promise<Buffer>;          // chỉ report dùng
}

// ✅ Tách theo NGƯỜI DÙNG của interface, không theo entity
interface UserReader { findById(id: string): Promise<User | null>; }
interface UserWriter { create(d: CreateUser): Promise<User>; }
```

Điểm quan trọng: tách theo **client của interface**, không theo entity. Một interface nên nhỏ vì người dùng nó chỉ cần nhỏ.

### D — Dependency Inversion

**Đây là nguyên tắc bị lạm dụng nhất.**

```ts
// ❌ Interface có MỘT implementation, mãi mãi
interface IUserRepository { findById(id: string): Promise<User | null>; }
class PrismaUserRepository implements IUserRepository { /* ... */ }
// Không có implementation thứ hai. Không bao giờ có.
// → interface này chỉ là một file thêm để đọc qua
```

DIP đáng dùng khi có **ít nhất một trong ba**:

```text
1. Nhiều implementation THẬT
   PaymentGateway: Stripe | VNPay | MoMo         ✅ có 3 cái thật
   NotificationChannel: email | SMS | push        ✅

2. Ranh giới ngoài không kiểm soát được
   Bạn muốn test logic mà không gọi Stripe thật   ✅

3. Ranh giới giữa module/team
   Module A không được biết chi tiết module B     ✅
```

Prisma **không** thuộc ba loại trên: nó có một implementation, và test tốt nhất là test với database thật. Xem [Repository pattern & testing](../../03-database/05-data-access/07-repository-pattern-testing.md).

## Ngoài SOLID — bốn heuristic quan trọng hơn

Trong thực tế, bốn nguyên tắc sau được dùng nhiều hơn SOLID:

### YAGNI — quan trọng nhất

> **You Aren't Gonna Need It.** Đừng trừu tượng cho một yêu cầu tương lai chưa tồn tại.

```ts
// ❌ "Sau này có thể đổi database"
interface IRepository<T> { find(where: object): Promise<T[]>; }

// ✅ Dùng Prisma trực tiếp. Khi thật cần đổi, refactor lúc đó — với thông tin thật.
```

Chi phí của trừu tượng sai **cao hơn** chi phí thêm trừu tượng muộn, vì trừu tượng sai định hình mọi code viết sau nó.

### DRY — và giới hạn của nó

DRY nói về **kiến thức**, không về **ký tự**.

```ts
// Hai đoạn giống nhau NHƯNG thay đổi vì lý do khác nhau
function validateUserEmail(e: string) { return /^[^@]+@[^@]+$/.test(e); }
function validateContactEmail(e: string) { return /^[^@]+@[^@]+$/.test(e); }
// Gộp lại → khi quy tắc email của user đổi (thêm domain allowlist),
//            contact cũng đổi theo — SAI
```

Đây là **coupling do DRY sai**, và nó khó phát hiện hơn duplication. Quy tắc: gộp khi hai chỗ thay đổi **cùng lý do**; giữ riêng khi chúng chỉ tình cờ giống nhau.

> **Duplication rẻ hơn abstraction sai.** Đợi tới trường hợp thứ ba.

### KISS và Rule of Three

```text
Trường hợp 1: viết trực tiếp
Trường hợp 2: copy, chấp nhận duplication
Trường hợp 3: giờ mới thấy được cái gì THẬT SỰ chung → trừu tượng
```

Với hai trường hợp, bạn không có đủ dữ liệu để biết cái gì chung và cái gì tình cờ giống.

### Cohesion và coupling — thước đo thật

```text
Cohesion cao   = thứ thay đổi cùng nhau nằm cùng nhau
Coupling thấp  = module đổi không buộc module khác đổi

→ Đây là mục tiêu THẬT. SOLID chỉ là cách đạt tới nó.
```

Nếu một refactor tăng cohesion và giảm coupling, nó đúng — kể cả khi nó "vi phạm" một nguyên tắc SOLID nào đó. Nếu nó không làm được cả hai, đừng làm.

## Example

```ts
// Trước: một service làm mọi thứ
@Injectable()
export class UsersService {
  constructor(/* 15 dependency */) {}
  async register(dto: RegisterDto) { /* 180 dòng */ }
}

// Sau: tách theo LÝ DO THAY ĐỔI, không theo nguyên tắc
// 1. Domain logic thuần — không dependency, test không cần mock
export function validateRegistration(dto: RegisterDto): Result<void, string[]> {
  const errors: string[] = [];
  if (dto.password.length < 12) errors.push('PASSWORD_TOO_SHORT');
  if (!isBusinessEmail(dto.email)) errors.push('EMAIL_NOT_ALLOWED');
  return errors.length ? err(errors) : ok();
}

// 2. Use case: điều phối, không chứa quy tắc
@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly prisma: PrismaService,      // trực tiếp — một implementation
    private readonly events: EventBus,            // side effect đi qua event
  ) {}

  async execute(dto: RegisterDto) {
    const check = validateRegistration(dto);
    if (!check.ok) throw new ValidationError(check.error);

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash: await hash(dto.password) },
    });

    // Email, Stripe, Slack, audit → subscriber lắng nghe event này
    await this.events.emit('user.registered', { userId: user.id });
    return user;
  }
}
```

Ba quyết định trong đoạn trên:

- **Domain logic là hàm thuần** — test 0ms, không mock, dùng được ở mọi đâu.
- **Prisma dùng trực tiếp** — không interface, vì chỉ có một implementation.
- **Side effect qua event** — đây là thứ giảm 15 dependency xuống 2, và nó không cần một interface nào.

Điểm cuối là bài học chính: 15 dependency không phải vấn đề SRP mà là vấn đề **coupling**. Event bus giải quyết nó tốt hơn mọi cách tách class. Xem [Service decomposition](08-service-decomposition.md).

## Prediction

1. Interface có một implementation duy nhất, mãi mãi — nó cho bạn khả năng gì?
2. Gộp hai hàm validate email giống nhau, rồi quy tắc của một bên đổi — điều gì xảy ra?
3. Tách class 400 dòng thành 8 class 50 dòng nhưng chúng cùng đổi mỗi lần — cohesion tăng hay giảm?
4. Service 15 dependency — tách thành 5 service 3 dependency có giảm coupling không?
5. Trừu tượng ở trường hợp thứ hai vs thứ ba — cái nào có nhiều thông tin hơn?
6. `switch` 3 case chưa đổi từ khi viết, refactor thành strategy pattern — được gì?
7. Test domain logic là hàm thuần vs là method của class có 15 dependency — cần mock gì?

<details>
<summary>Đáp án</summary>

1. Không gì — chỉ thêm một file phải đọc qua.
2. Bên kia đổi theo — coupling do DRY sai.
3. **Giảm** — thứ đổi cùng nhau bị tách ra.
4. Không nhất thiết — nếu 5 service vẫn phụ thuộc nhau thì chỉ chuyển coupling sang chỗ khác. Event bus mới giảm thật.
5. Thứ ba — hai trường hợp không đủ để biết cái gì chung.
6. Không gì; mất tính đơn giản. YAGNI.
7. Hàm thuần: không mock. Method: mock 15 thứ, và test có ít giá trị.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm số interface có đúng một implementation | Mỗi cái là indirection không có lợi ích |
| Xoá một interface đó, dùng class trực tiếp | Code ít hơn, dễ đọc hơn, không mất gì |
| Gộp hai hàm "giống nhau", rồi đổi quy tắc một bên | Bên kia đổi theo — bug |
| Tách class theo số dòng | Đếm số file phải mở để hiểu một luồng |
| Đếm số file phải mở để hiểu `register()` | Trên 5 là dấu hiệu over-abstraction |
| Service 15 dependency, thêm event bus cho side effect | Đếm lại số dependency |
| Test method có 15 dependency | Đếm số mock; đánh giá test có giá trị gì |
| Tách domain logic thành hàm thuần, test lại | Không mock, chạy 0ms |
| `git log --format= --name-only \| sort \| uniq -c \| sort -rn` | File nào đổi trong mọi PR = SRP vi phạm thật |

Thí nghiệm cuối là cách khách quan nhất tìm SRP violation: file xuất hiện trong mọi commit là file có quá nhiều lý do thay đổi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| SOLID là luật phải tuân thủ | Là heuristic; mục tiêu thật là cohesion cao + coupling thấp |
| SRP nghĩa là class nhỏ | Nghĩa là một **lý do thay đổi** |
| Mọi dependency cần interface | Chỉ khi có nhiều implementation thật, hoặc là ranh giới |
| DRY nghĩa là không lặp ký tự | Nghĩa là không lặp **kiến thức** |
| Trừu tượng sớm là an toàn | Trừu tượng sai đắt hơn duplication |
| Nhiều file nhỏ = kiến trúc tốt | Nếu chúng cùng đổi thì cohesion đã giảm |
| Interface giúp đổi implementation sau | Chỉ khi thật có implementation thứ hai |
| SOLID làm code dễ test hơn | Tách domain logic thuần hiệu quả hơn nhiều |

## Debugging

1. **Đếm interface có một implementation**: `grep -rn "implements I" src/` rồi kiểm tra từng cái. Đây là chỉ số over-abstraction rõ nhất.
2. **Đếm số file phải mở** để hiểu một luồng nghiệp vụ. Trên 5 là dấu hiệu.
3. **File nào đổi trong mọi PR**:
   ```bash
   git log --format= --name-only --since="3 months ago" | sort | uniq -c | sort -rn | head -10
   ```
   File đầu danh sách có quá nhiều lý do thay đổi — đó là SRP violation *thật*, không phải suy đoán.
4. **Đếm dependency của mỗi service.** Trên 7 là tín hiệu; xem [Service decomposition](08-service-decomposition.md).
5. **Đếm mock trong test.** Nhiều mock = test ít giá trị và thiết kế coupling cao.
6. **Sửa một thứ phá thứ khác** → coupling cao. Đây là smell đáng tin hơn mọi metric.

## Production Considerations

- **Bắt đầu đơn giản.** Controller → Service → Prisma là đủ cho phần lớn. Thêm tầng khi có lý do cụ thể.
- **Tách domain logic thành hàm thuần** — đây là refactor có ROI cao nhất: dễ test, dễ đọc, không mock.
- **Event bus cho side effect** thay vì inject mọi service — giảm dependency thật.
- **Interface chỉ khi có nhiều implementation thật** hoặc là ranh giới module/team.
- **Rule of three** cho mọi trừu tượng.
- **Ghi ADR** khi thêm một tầng — người sau cần biết vì sao. Xem [Documentation & ADR](03-domain-logic-boundaries.md).
- **Review PR nên hỏi**: "trừu tượng này cho phép làm gì mà không có nó thì không?" thay vì "có tuân thủ SOLID không?".
- Với modular monolith, ranh giới **module** quan trọng hơn ranh giới class. Xem [Modular monolith](02-modular-monolith.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ít trừu tượng | dễ đọc, ít file, luồng rõ | refactor lớn hơn khi yêu cầu đổi |
| Nhiều trừu tượng | linh hoạt (nếu đúng chỗ) | nhiều file, khó theo luồng, có thể vô ích |
| Interface cho mọi dependency | test dễ mock | indirection không lợi ích nếu một impl |
| Dùng class cụ thể | đơn giản, rõ | phải refactor khi cần thay thế |
| DRY triệt để | ít code | coupling giữa thứ chỉ tình cờ giống nhau |
| Cho phép duplication | module độc lập | phải sửa nhiều chỗ khi quy tắc *thật sự* chung đổi |
| Event cho side effect | coupling thấp | luồng khó theo, cần observability tốt |

## Explain Without Notes

1. Câu hỏi một câu để kiểm tra một trừu tượng có đáng tồn tại?
2. SRP phát biểu đúng là gì — và vì sao "class nhỏ" là phát biểu sai?
3. Ba điều kiện để DIP đáng dùng?
4. DRY sai gây vấn đề gì, và nó khó phát hiện hơn duplication ở đâu?
5. Rule of three — vì sao trường hợp thứ hai không đủ?
6. Cách khách quan để tìm SRP violation thật trong một codebase?

## Related

- [Controller–Service–Repository](01-controller-service-repository.md) — layering cơ bản
- [Clean architecture pragmatic](07-clean-architecture-pragmatic.md) — khi nào nhiều tầng là đúng
- [Service decomposition](08-service-decomposition.md) — service 15 dependency
- [Domain logic boundaries](03-domain-logic-boundaries.md) — domain logic thuần
- [Modular monolith](02-modular-monolith.md) — ranh giới module
- [Repository pattern & testing](../../03-database/05-data-access/07-repository-pattern-testing.md) — DIP với Prisma
- [Modules & DI (NestJS)](../02-nestjs/behavior/02-modules-di.md)
- [Mocking & test doubles](../../05-cross-cutting/testing/04-mocking-test-doubles.md) — nhiều mock = thiết kế coupling cao
