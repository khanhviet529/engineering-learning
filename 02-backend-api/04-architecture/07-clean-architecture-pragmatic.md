---
level: advanced
area: backend
prerequisites:
  - 06-solid-in-practice.md
  - 01-controller-service-repository.md
related:
  - 02-modular-monolith.md
  - 03-domain-logic-boundaries.md
---

# Clean Architecture — góc nhìn thực dụng

> Clean Architecture giải quyết một vấn đề thật. Nhưng nó được viết cho hệ thống lớn, sống nhiều năm, nhiều team. Áp dụng đầy đủ vào một CRUD app tạo ra 5 tầng cho một `SELECT`.

## Position

```text
Controller → Service → Prisma                    ← 2 tầng: đủ cho phần lớn app
Controller → UseCase → Domain → Repository → DB   ← 4+ tầng: khi nào cần?
                                                     ↑ note này
```

## Problem

Vấn đề Clean Architecture giải quyết là thật:

```ts
// Domain logic bị trộn với framework, DB, và HTTP
@Controller('orders')
export class OrdersController {
  @Post(':id/refund')
  async refund(@Param('id') id: string, @Res() res: Response) {
    const order = await this.prisma.order.findUnique({ where: { id } });

    // Quy tắc nghiệp vụ nằm trong controller
    if (order.status !== 'PAID') return res.status(400).json({ e: 'not paid' });
    if (Date.now() - order.paidAt.getTime() > 30 * 864e5)
      return res.status(400).json({ e: 'too old' });
    if (order.refundedAmount >= order.total)
      return res.status(400).json({ e: 'already refunded' });

    await this.stripe.refunds.create({ charge: order.chargeId });
    await this.prisma.order.update({ where: { id }, data: { status: 'REFUNDED' } });
    res.json({ ok: true });
  }
}
```

Ba quy tắc nghiệp vụ quan trọng ("chỉ refund order đã trả", "trong 30 ngày", "không refund hai lần") giờ:

- không test được mà không dựng HTTP + Prisma + Stripe;
- không tái dùng được từ CLI, job nền, hay admin panel;
- lẫn với chi tiết HTTP nên khó đọc;
- sẽ được copy sang endpoint khác và lệch nhau.

Nhưng phản ứng thái quá cũng là vấn đề:

```text
src/
  domain/entities/Order.ts
  domain/value-objects/Money.ts
  domain/repositories/IOrderRepository.ts
  application/use-cases/RefundOrderUseCase.ts
  application/dto/RefundOrderInput.ts
  application/ports/IPaymentGateway.ts
  application/ports/IUnitOfWork.ts
  infrastructure/persistence/PrismaOrderRepository.ts
  infrastructure/persistence/OrderMapper.ts
  infrastructure/payment/StripePaymentGateway.ts
  presentation/http/OrdersController.ts
  presentation/http/OrderPresenter.ts
```

12 file cho một chức năng. Mọi interface có một implementation. Mọi mapper chỉ copy field. Để hiểu refund, mở 12 file.

## Mental Model

Ý tưởng cốt lõi của Clean Architecture chỉ có **một câu**, và nó đúng:

> **Domain logic không được phụ thuộc vào framework, database, hay giao thức.**
> **Dependency luôn hướng vào trong.**

```text
       ┌─────────────────────────────────┐
       │  Presentation (HTTP, CLI, gRPC) │  ← đổi thường xuyên
       │  ┌───────────────────────────┐  │
       │  │ Application (use case)    │  │
       │  │  ┌─────────────────────┐  │  │
       │  │  │  Domain (quy tắc)   │  │  │  ← đổi chậm nhất
       │  │  └─────────────────────┘  │  │
       │  └───────────────────────────┘  │
       │  Infrastructure (DB, Stripe)    │  ← đổi thường xuyên
       └─────────────────────────────────┘

Mũi tên phụ thuộc: NGOÀI → TRONG. Domain không import gì từ ngoài.
```

Nhưng **số tầng không phải là điểm.** Điểm là **chiều phụ thuộc**. Bạn có thể đạt được nó với 2 tầng.

Cách rẻ nhất và hiệu quả nhất:

> **Tách domain logic thành hàm thuần.** Không class, không interface, không tầng.

```ts
// domain/order-rules.ts — không import Prisma, NestJS, Stripe
export type RefundCheck =
  | { ok: true; amount: number }
  | { ok: false; reason: 'NOT_PAID' | 'TOO_OLD' | 'ALREADY_REFUNDED' };

export function canRefund(order: OrderSnapshot, now: Date): RefundCheck {
  if (order.status !== 'PAID')                    return { ok: false, reason: 'NOT_PAID' };
  if (daysBetween(order.paidAt, now) > 30)        return { ok: false, reason: 'TOO_OLD' };
  if (order.refundedAmount >= order.total)        return { ok: false, reason: 'ALREADY_REFUNDED' };
  return { ok: true, amount: order.total - order.refundedAmount };
}
```

```ts
// application: điều phối, không chứa quy tắc
@Injectable()
export class RefundOrderUseCase {
  constructor(
    private readonly prisma: PrismaService,        // trực tiếp — một implementation
    private readonly payments: PaymentGateway,      // interface — CÓ nhiều impl thật
  ) {}

  async execute(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const check = canRefund(order, new Date());     // ← quy tắc ở đây
    if (!check.ok) throw new BusinessError(check.reason);

    const refund = await this.payments.refund(order.chargeId, check.amount);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'REFUNDED', refundedAmount: { increment: check.amount } },
    });
    return refund;
  }
}
```

Hai file. Domain logic test được với 0 dependency, 0 mock, 0ms. Điều đó đạt được **90% giá trị** của Clean Architecture với **10% chi phí**.

Chú ý sự khác biệt: `PaymentGateway` **là** interface (có Stripe, VNPay, MoMo thật), `PrismaService` **không** (một implementation). Đây là DIP áp dụng có chọn lọc thay vì đồng loạt.

## How It Works

### Khi nào cần thêm tầng

| Tín hiệu | Thêm gì |
|---|---|
| Quy tắc nghiệp vụ trộn trong controller/service | **hàm thuần domain** — luôn đáng làm |
| Cùng use case gọi từ HTTP + CLI + queue + cron | **use case layer** |
| Nhiều implementation thật của một dependency ngoài | **port/interface** cho cái đó |
| Nhiều module phải độc lập, nhiều team | **ranh giới module** → [modular monolith](02-modular-monolith.md) |
| Invariant phức tạp trên một cụm entity | **aggregate + domain object** |

Và khi nào **không**:

```text
✗ CRUD thuần                      → Controller → Service → Prisma là đủ
✗ Một team, một app, dưới ~50 endpoint
✗ Chỉ có HTTP là entry point
✗ Mỗi dependency có một implementation
✗ "Để sau này đổi database"        → YAGNI
✗ "Vì Clean Architecture là best practice"  → không phải lý do
```

### Thang leo tầng — thêm từng bước, có lý do

```text
Mức 0  Controller → Prisma
       Prototype, admin tool, script

Mức 1  Controller → Service → Prisma
       ✅ MẶC ĐỊNH cho phần lớn app

Mức 2  Controller → Service → Prisma
       + hàm thuần domain cho quy tắc
       ✅ Bước có ROI cao nhất. Gần như luôn nên làm.

Mức 3  Controller → UseCase → Domain → Prisma
       + port cho dependency ngoài CÓ nhiều impl
       Khi có nhiều entry point, hoặc nhiều gateway thật

Mức 4  + Repository, aggregate, mapper, unit of work
       Chỉ khi domain thật sự phức tạp (kế toán, bảo hiểm, logistics)
       và team hiểu chi phí
```

Đi từ mức 1 lên mức 2 là thay đổi có giá trị nhất. Đi từ mức 3 lên mức 4 thường không đáng cho app nghiệp vụ thường.

### Ports and adapters — chỉ nơi cần

```ts
// Port: interface do TẦNG TRONG định nghĩa (theo nhu cầu của nó)
export interface PaymentGateway {
  charge(amount: number, token: string): Promise<ChargeResult>;
  refund(chargeId: string, amount: number): Promise<RefundResult>;
}

// Adapter: infrastructure implement nó
@Injectable()
export class StripeGateway implements PaymentGateway { /* ... */ }
@Injectable()
export class VnPayGateway implements PaymentGateway { /* ... */ }
```

Chi tiết quyết định: interface được định nghĩa bởi **tầng trong**, theo nhu cầu của tầng trong — không phải là bản sao API của Stripe. Nếu interface của bạn trông giống hệt SDK của Stripe, nó không phải port; nó là một lớp bọc vô nghĩa.

Đây là lý do interface `IRepository<T>` với `find(where, orderBy, take)` là anti-pattern: nó mô phỏng SQL (tầng ngoài) chứ không diễn đạt nhu cầu domain.

### Hexagonal — cùng ý tưởng, cách nói khác

```text
        HTTP ─┐
         CLI ─┼→ [ Application core ] ─┼→ PostgreSQL
       Queue ─┘                        ├→ Stripe
                                       └→ Email
        ↑ inbound adapter        outbound adapter ↑
```

Hexagonal và Clean Architecture về bản chất giống nhau: core không biết gì về ngoài. Hexagonal nhấn mạnh **đối xứng** giữa inbound và outbound — hữu ích khi bạn có nhiều entry point.

### Chi phí thật — nói rõ để cân nhắc

```text
+ Số file:        1 chức năng có thể thành 6–12 file
+ Indirection:    mở 5 file để theo một luồng
+ Mapper:         entity ↔ DTO ↔ persistence model, thường chỉ copy field
+ Onboarding:     dev mới mất nhiều ngày để hiểu cấu trúc
+ Transaction:    khó hơn khi repository ẩn client (cần unit of work)
+ Tính năng ORM:  mất `include` lồng nhau, `_count`, nested write nếu ẩn Prisma
```

Hàng cuối đáng chú ý: nếu bạn ẩn Prisma sau `IRepository`, bạn mất phần lớn thứ làm Prisma hữu ích. Xem [Repository pattern & testing](../../03-database/05-data-access/07-repository-pattern-testing.md).

## Example

```text
Cấu trúc thực dụng — mức 2/3, dùng được cho phần lớn app

src/
  modules/
    orders/
      domain/
        order-rules.ts          ← HÀM THUẦN: canRefund, calculateTotal
        order-types.ts          ← type domain, không phải Prisma type
      application/
        refund-order.usecase.ts ← điều phối
        create-order.usecase.ts
      infrastructure/
        stripe.gateway.ts       ← implement PaymentGateway (CÓ nhiều impl)
      orders.controller.ts      ← HTTP: validate, map error → status
      orders.module.ts
    payments/
    users/
  shared/
    ports/payment-gateway.ts    ← interface, vì có Stripe + VNPay thật
```

Ba điều note-worthy:

- **Không có `IOrderRepository`** — dùng Prisma trực tiếp (một implementation).
- **Có `PaymentGateway`** — vì thật có nhiều gateway.
- **`domain/order-rules.ts` là hàm thuần** — nơi mọi quy tắc nghiệp vụ sống, test 0ms.

Tổ chức theo **module nghiệp vụ** (`orders/`, `payments/`) không theo **tầng kỹ thuật** (`controllers/`, `services/`). Lý do: thứ thay đổi cùng nhau nằm cùng nhau — cohesion. Xem [Modular monolith](02-modular-monolith.md).

## Prediction

1. Quy tắc nghiệp vụ trong controller — test nó cần dựng những gì?
2. Cùng quy tắc là hàm thuần — cần gì?
3. `IOrderRepository` với một implementation — cho bạn khả năng gì?
4. Ẩn Prisma sau `IRepository` generic — mất tính năng nào?
5. Cùng use case cần gọi từ HTTP và từ cron job, logic ở trong controller — làm sao?
6. 12 file cho một chức năng, dev mới cần hiểu luồng refund — mở mấy file?
7. Tổ chức theo `controllers/`, `services/`, `repositories/` — thêm một tính năng sửa mấy folder?
8. Tổ chức theo `modules/orders/` — mấy folder?

<details>
<summary>Đáp án</summary>

1. HTTP layer + Prisma + Stripe (hoặc mock cả ba).
2. Không gì — gọi hàm với object thường.
3. Không gì.
4. `include` lồng nhau, `select`, `_count`, nested write, transaction API — phần lớn giá trị của Prisma.
5. Không được — phải copy logic, và hai bản sẽ lệch nhau.
6. 12 — đó là chi phí thật.
7. 3+ folder cho một tính năng — coupling theo tầng.
8. 1 folder — cohesion theo nghiệp vụ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt quy tắc nghiệp vụ trong controller, viết test | Phải mock HTTP + DB + gateway |
| Tách thành hàm thuần, test lại | 0 mock, 0ms |
| Tạo `IRepository` với một impl, đếm file thêm vào | Indirection không lợi ích |
| Ẩn Prisma sau interface rồi cần `include` lồng nhau | Không diễn đạt được; phải thoát khỏi interface |
| Đếm file phải mở để hiểu một luồng | Trên 5 là dấu hiệu |
| Copy logic từ controller sang cron job, rồi sửa một bên | Hai bản lệch nhau |
| Tổ chức theo tầng, thêm một field vào một entity | Đếm số folder phải sửa |
| Tổ chức theo module, làm lại | Một folder |
| Transaction bao 2 repository không truyền client | Không rollback |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Clean Architecture nghĩa là nhiều tầng | Nghĩa là **chiều phụ thuộc**; 2 tầng cũng đạt được |
| Cần repository để tách domain khỏi DB | Hàm thuần domain đủ cho phần lớn trường hợp |
| Mọi dependency ngoài cần port | Chỉ khi có nhiều implementation thật |
| Nhiều tầng = dễ test hơn | Hàm thuần dễ test hơn mọi tầng |
| Mapper là bắt buộc | Nếu nó chỉ copy field, nó là chi phí không lợi ích |
| Clean Architecture giúp đổi database | Trên lý thuyết; thực tế query và tính năng đã gắn với DB |
| Tổ chức theo tầng rõ ràng hơn | Nó tách thứ thay đổi cùng nhau — cohesion thấp |
| Áp dụng đầy đủ hay không áp dụng | Có thang; mức 2 là điểm ngọt cho phần lớn |

## Debugging

1. **Đếm file phải mở** để hiểu một luồng nghiệp vụ. Trên 5 → over-abstraction.
2. **Đếm interface có một implementation** — mỗi cái là ứng viên xoá.
3. **Đếm mapper chỉ copy field** — chúng là chi phí thuần.
4. **Thử test domain logic mà không mock gì.** Nếu không được, domain logic chưa tách khỏi hạ tầng — đó là vấn đề thật cần sửa.
5. **Thêm một tính năng và đếm số folder phải sửa.** Nhiều folder = tổ chức theo tầng thay vì theo module.
6. **Hỏi mỗi tầng**: "tầng này cho phép gì mà không có nó thì không?" Không trả lời được → xoá.

## Production Considerations

- **Mức 2 là mặc định**: Controller → Service → Prisma, cộng hàm thuần domain cho quy tắc. Nó đủ cho đa số và rẻ.
- **Tách domain logic thành hàm thuần trước mọi refactor kiến trúc khác** — ROI cao nhất, rủi ro thấp nhất.
- **Port chỉ cho dependency có nhiều implementation thật** (payment gateway, notification channel, storage).
- **Tổ chức theo module nghiệp vụ**, không theo tầng kỹ thuật.
- **Không ẩn Prisma sau interface generic** — bạn mất tính năng và không được gì.
- **Ghi ADR khi thêm tầng**: lý do, chi phí, và điều kiện để bỏ nó.
- **Leo thang khi có tín hiệu**, không leo trước. Refactor thêm tầng dễ hơn bỏ tầng.
- Với microservices, ranh giới **service** quan trọng hơn ranh giới tầng bên trong. Xem [Monolith → microservices](../../06-system-design/08-monolith-to-microservices.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| 2 tầng (Controller → Service) | đơn giản, nhanh, dễ onboard | domain logic có thể lẫn |
| + hàm thuần domain | test 0 mock, tái dùng, rõ ràng | thêm một file, gần như không có chi phí khác |
| + use case layer | nhiều entry point dùng chung | thêm một tầng |
| + port/adapter | thay được implementation thật | chỉ đáng khi có nhiều impl |
| + repository/aggregate/mapper | domain thuần khiết | nhiều file, mất tính năng ORM, transaction khó |
| Tổ chức theo module | cohesion cao | phải quyết định ranh giới module |
| Tổ chức theo tầng | trực quan lúc đầu | một tính năng sửa nhiều folder |

## Explain Without Notes

1. Ý tưởng cốt lõi của Clean Architecture trong một câu?
2. Vì sao "số tầng" không phải là điểm?
3. Cách rẻ nhất đạt 90% giá trị của nó?
4. Năm tín hiệu để thêm tầng, và bốn lý do không nên?
5. Vì sao ẩn Prisma sau `IRepository` generic là mất mát thuần?
6. Vì sao tổ chức theo module tốt hơn theo tầng?

## Related

- [SOLID trong thực tế](06-solid-in-practice.md) — YAGNI và DIP có chọn lọc
- [Service decomposition](08-service-decomposition.md) — khi service quá lớn
- [Domain logic boundaries](03-domain-logic-boundaries.md) — domain object và invariant
- [Modular monolith](02-modular-monolith.md) — ranh giới module
- [Controller–Service–Repository](01-controller-service-repository.md) — mức 1
- [Repository pattern & testing](../../03-database/05-data-access/07-repository-pattern-testing.md) — chi phí của repository
- [Monolith → microservices](../../06-system-design/08-monolith-to-microservices.md)
- [Unit vs integration](../../05-cross-cutting/testing/02-unit-vs-integration.md) — test hàm thuần vs test tích hợp
