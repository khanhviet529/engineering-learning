---
level: intermediate
area: backend
prerequisites:
  - 06-solid-in-practice.md
related:
  - 07-clean-architecture-pragmatic.md
  - 02-modular-monolith.md
  - ../02-nestjs/behavior/02-modules-di.md
---

# Service decomposition

> Một service inject 15 dependency. Đó là **triệu chứng**, không phải bệnh. Tách nó thành 5 service 3 dependency mà không sửa nguyên nhân chỉ chuyển vấn đề sang chỗ khác.

## Position

```text
Controller → Service (15 dependency?) → nhiều thứ khác
                  ↑ note này: chẩn đoán trước khi tách
```

## Problem

```ts
@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private stripe: StripeService,
    private inventory: InventoryService,
    private shipping: ShippingService,
    private pricing: PricingService,
    private tax: TaxService,
    private coupon: CouponService,
    private audit: AuditService,
    private slack: SlackService,
    private pdf: PdfService,
    private s3: S3Service,
    private redis: RedisService,
    private queue: QueueService,
    private analytics: AnalyticsService,
  ) {}

  async createOrder(dto: CreateOrderDto) { /* 220 dòng */ }
  async cancelOrder(id: string) { /* 90 dòng */ }
  async refundOrder(id: string) { /* 140 dòng */ }
  // ... 18 method nữa
}
```

Phản xạ thông thường: "vi phạm SRP, tách ra". Nhưng tách theo cách nào?

```ts
// Tách máy móc — 15 dependency chia thành 5 service
class OrderCreationService  { constructor(p, mailer, stripe) {} }
class OrderCancellationService { constructor(p, mailer, inventory) {} }
class OrderRefundService    { constructor(p, stripe, audit) {} }
// ...
```

Kết quả: 5 file thay vì 1, nhưng `OrderCreationService` vẫn phải gọi `OrderRefundService` trong một số luồng, và giờ bạn có **circular dependency** → `forwardRef` → và một cấu trúc khó hiểu hơn ban đầu.

Vấn đề: bạn đã tách theo **method**, không theo **nguyên nhân**.

## Mental Model

15 dependency có thể là **bốn** vấn đề khác nhau, và mỗi cái cần một cách sửa khác:

```text
1. GOD SERVICE
   Service làm nhiều nghiệp vụ không liên quan
   → tách theo NGHIỆP VỤ, không theo method

2. SIDE EFFECT COUPLING            ← phổ biến nhất, và dễ sửa nhất
   Service phải biết mọi thứ cần xảy ra SAU một hành động
   (email, Slack, analytics, audit, invalidate cache...)
   → event, không tách class

3. ORCHESTRATION SERVICE
   Service điều phối nhiều bước — 15 dependency là ĐÚNG cho vai trò này
   → giữ nguyên, nhưng đừng để nó chứa quy tắc

4. WRONG MODULE BOUNDARY
   Service phải chạm dữ liệu của module khác
   → sửa ranh giới module, không sửa service
```

Chẩn đoán trước:

> **Nhìn vào danh sách dependency: có bao nhiêu cái được dùng cho *side effect sau khi việc chính xong*?**
>
> Nếu phần lớn → vấn đề là (2), và event bus giải quyết nó mà không tách class nào.

Với ví dụ trên: `mailer`, `slack`, `analytics`, `audit`, `pdf`, `s3` — sáu cái là side effect. Đó là 40% dependency, và không cái nào là quy tắc nghiệp vụ của order.

## How It Works

### Chẩn đoán 2 — side effect coupling (làm trước tiên)

```ts
// ❌ Service biết mọi hệ quả
async createOrder(dto: CreateOrderDto) {
  const order = await this.prisma.order.create({ data: /* ... */ });

  await this.mailer.sendOrderConfirmation(order);       // side effect
  await this.slack.notifyNewOrder(order);               // side effect
  await this.analytics.track('order_created', order);   // side effect
  await this.audit.log('order.created', order);         // side effect
  const pdf = await this.pdf.generateInvoice(order);    // side effect
  await this.s3.upload(`invoices/${order.id}.pdf`, pdf); // side effect
  await this.redis.del(`user:${dto.userId}:orders`);     // side effect

  return order;
}
```

```ts
// ✅ Service làm việc chính, phát event. 6 dependency biến mất.
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,      // CẦN: quy tắc nghiệp vụ
    private readonly pricing: PricingService,          // CẦN: quy tắc nghiệp vụ
    private readonly events: EventEmitter2,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    await this.inventory.assertAvailable(dto.items);    // phải xong TRƯỚC
    const total = this.pricing.calculate(dto.items);    // phải xong TRƯỚC

    const order = await this.prisma.order.create({ data: { ...dto, total } });

    this.events.emit('order.created', new OrderCreatedEvent(order));
    return order;
  }
}

// Mỗi hệ quả là một listener độc lập
@Injectable()
export class OrderNotifications {
  constructor(private readonly mailer: MailerService) {}

  @OnEvent('order.created')
  async onCreated(e: OrderCreatedEvent) {
    await this.mailer.sendOrderConfirmation(e.order);
  }
}
```

Từ 15 xuống 4 dependency, **không tách một service nghiệp vụ nào**.

Phân biệt quan trọng — cái gì được phép thành event:

```text
PHẢI đồng bộ (giữ trong service):
  ✓ kiểm tra tồn kho trước khi tạo order    → quyết định có tạo hay không
  ✓ tính giá                                 → là phần của dữ liệu
  ✓ validate quyền                           → chặn hành động

CÓ THỂ async (thành event):
  ✓ gửi email, Slack, push
  ✓ analytics, audit log
  ✓ sinh PDF, upload
  ✓ invalidate cache
  → chúng không ảnh hưởng KẾT QUẢ của hành động
```

Câu hỏi phân loại: **nếu việc này thất bại, hành động chính có nên rollback không?** Có → đồng bộ. Không → event.

Và một chi tiết vận hành: event trong process (như `EventEmitter2`) **mất khi process chết**. Nếu email *phải* được gửi, dùng [outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) thay vì in-process event.

### Chẩn đoán 1 — god service

```ts
// Service làm nhiều nghiệp vụ độc lập
class UserService {
  register() {}           // nghiệp vụ: onboarding
  updateProfile() {}      // nghiệp vụ: profile
  changeSubscription() {} // nghiệp vụ: billing      ← khác hẳn
  exportGdprData() {}     // nghiệp vụ: compliance   ← khác hẳn
}
```

Tách theo **nghiệp vụ**, và kiểm tra bằng câu hỏi: hai nhóm này có đổi vì cùng lý do không?

```text
UserAccountService       register, updateProfile        (đổi vì quy tắc account)
SubscriptionService      changeSubscription             (đổi vì pricing)
GdprService              exportGdprData, deleteAccount  (đổi vì luật)
```

Ba nghiệp vụ, ba nhịp thay đổi khác nhau → ba service.

### Chẩn đoán 3 — orchestration service (không phải vấn đề)

```ts
// Checkout: điều phối 6 bước. Nhiều dependency là ĐÚNG.
@Injectable()
export class CheckoutUseCase {
  constructor(
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
    private readonly pricing: PricingService,
    private readonly payment: PaymentService,
    private readonly orders: OrdersService,
    private readonly events: EventEmitter2,
  ) {}

  async execute(userId: string, paymentToken: string) {
    const cart = await this.cart.get(userId);
    await this.inventory.reserve(cart.items);
    const total = this.pricing.calculate(cart.items);
    const charge = await this.payment.charge(total, paymentToken);
    const order = await this.orders.createFromCart(cart, charge);
    await this.cart.clear(userId);
    this.events.emit('checkout.completed', { orderId: order.id });
    return order;
  }
}
```

6 dependency, và **không nên tách**. Vai trò của nó là điều phối. Tách nó ra làm luồng khó theo hơn.

Điều kiện để orchestration service là ổn:

```text
✓ Nó KHÔNG chứa quy tắc nghiệp vụ (quy tắc ở service con hoặc hàm thuần)
✓ Nó chỉ gọi theo thứ tự và xử lý lỗi
✓ Đọc nó là hiểu được luồng nghiệp vụ
```

Nếu bạn thấy `if (cart.items.length > 10 && user.tier === 'free')` trong orchestrator, quy tắc đang ở sai chỗ.

### Chẩn đoán 4 — wrong module boundary

```ts
// Smell: OrdersService query bảng của module khác
class OrdersService {
  async createOrder(dto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    const inv = await this.prisma.inventory.findMany({ /* bảng của module Inventory */ });
    const promo = await this.prisma.promotion.findFirst({ /* bảng của module Marketing */ });
  }
}
```

Đây không phải vấn đề của service — nó là **ranh giới module sai**. Orders đang đọc trực tiếp dữ liệu của Inventory và Marketing, nên mọi thay đổi schema của họ phá Orders.

Sửa bằng cách đi qua API của module, không qua bảng:

```ts
class OrdersService {
  constructor(
    private readonly inventory: InventoryModuleApi,     // API công khai của module
    private readonly promotions: PromotionModuleApi,
  ) {}
}
```

Xem [Modular monolith](02-modular-monolith.md).

### Khi nào **không** tách

```text
✗ Service 400 dòng làm ĐÚNG một nghiệp vụ
✗ Chia theo số dòng hoặc số method
✗ Tách rồi các phần vẫn gọi lẫn nhau → circular dependency
✗ Tách chỉ để "đúng SRP"
✗ Tách làm luồng nghiệp vụ khó theo hơn
```

Dấu hiệu bạn tách sai: sau khi tách, bạn cần `forwardRef`. Circular dependency giữa hai service nghĩa là chúng thuộc **cùng một** đơn vị. Xem [Module system trong Node](../01-nodejs/fundamentals/02-module-system.md).

## Example

```text
Chẩn đoán OrdersService 15 dependency

Bước 1 — phân loại từng dependency
  prisma, inventory, pricing, tax, coupon    → quy tắc nghiệp vụ, ĐỒNG BỘ  (5)
  mailer, slack, analytics, audit, pdf, s3   → side effect, ASYNC         (6)
  stripe, shipping                            → gateway ngoài              (2)
  redis                                        → cache, side effect         (1)
  queue                                        → hạ tầng cho event          (1)

Bước 2 — sửa theo chẩn đoán 2 (rẻ nhất trước)
  6 side effect + redis → event listener       → 15 → 8

Bước 3 — chẩn đoán 1: các method có cùng nghiệp vụ?
  createOrder / cancelOrder / refundOrder      → cùng lifecycle order ✓ giữ
  generateInvoice / exportOrders               → nghiệp vụ báo cáo   → tách

Bước 4 — quy tắc thành hàm thuần
  canCancel(order), canRefund(order), calculateTotal(items)
  → OrdersService còn: prisma, inventory, payment, events  = 4

Kết quả: 15 → 4, tách MỘT service (reporting), không có circular dependency
```

Điểm quan trọng: bước 2 (event) giải quyết 7/11 dependency **mà không tách gì cả**. Đó là lý do nó phải làm trước.

## Prediction

1. 15 dependency, 6 là side effect — chuyển sang event còn bao nhiêu?
2. Tách theo method (`OrderCreationService`, `OrderRefundService`) — điều gì xảy ra khi create cần gọi refund?
3. Orchestration service 6 dependency chỉ điều phối — nên tách không?
4. Cùng orchestration nhưng có `if (user.tier === 'free' && ...)` — vấn đề gì?
5. Tách 2 service rồi cần `forwardRef` — nó nói gì về cách tách?
6. `OrdersService` query bảng `inventory` trực tiếp, Inventory đổi schema — điều gì xảy ra?
7. Email gửi qua in-process event, process chết ngay sau `emit` — email có được gửi?
8. Service 400 dòng làm một nghiệp vụ, tách thành 8 file — cohesion tăng hay giảm?

<details>
<summary>Đáp án</summary>

1. 9 (hoặc 8 nếu tính cả redis).
2. Circular dependency → `forwardRef` → cấu trúc khó hiểu hơn ban đầu.
3. **Không** — nhiều dependency là đúng cho vai trò điều phối.
4. Quy tắc nghiệp vụ ở sai chỗ; nó thuộc service con hoặc hàm thuần.
5. Chúng thuộc cùng một đơn vị — tách sai.
6. Orders vỡ — ranh giới module sai.
7. **Không** — in-process event mất. Cần outbox nếu email là bắt buộc.
8. **Giảm** — thứ đổi cùng nhau bị tách ra.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm dependency, phân loại thành "quy tắc" vs "side effect" | Tỉ lệ side effect thường > 40% |
| Chuyển side effect sang event, đếm lại | Giảm mạnh, không tách class |
| Tách service theo method rồi để chúng gọi nhau | Circular dependency, cần `forwardRef` |
| Đặt quy tắc nghiệp vụ trong orchestrator | Đọc luồng khó, test cần mock nhiều |
| Query bảng của module khác, rồi đổi schema bảng đó | Module không liên quan vỡ |
| Kill process ngay sau `emit` event | Side effect mất |
| Đổi sang outbox, làm lại | Side effect vẫn xảy ra sau restart |
| `git log` cho service đó — nó đổi vì mấy lý do khác nhau? | Nhiều lý do = god service thật |
| Đếm mock cần thiết để test một method | Nhiều mock = coupling cao |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Nhiều dependency = vi phạm SRP | Có thể là orchestration đúng vai, hoặc side effect coupling |
| Tách service luôn cải thiện | Tách sai gây circular dependency và giảm cohesion |
| Service nhỏ = kiến trúc tốt | Nếu chúng cùng đổi thì cohesion đã giảm |
| Event làm code khó theo nên tránh | Nó giảm coupling thật; bù bằng observability |
| Circular dependency sửa bằng `forwardRef` | `forwardRef` che triệu chứng; nguyên nhân là tách sai |
| Orchestration service là anti-pattern | Là pattern hợp lệ nếu không chứa quy tắc |
| In-process event đủ cho mọi side effect | Mất khi process chết; email quan trọng cần outbox |
| Tách theo method là cách tự nhiên | Tách theo **nghiệp vụ** và **lý do thay đổi** |

## Debugging

1. **Phân loại từng dependency**: quy tắc nghiệp vụ / side effect / gateway / hạ tầng. Tỉ lệ side effect cao → chẩn đoán 2, và đó là cách sửa rẻ nhất.
2. **`git log` cho file đó** để xem nó đổi vì mấy lý do:
   ```bash
   git log --oneline --since="6 months ago" -- src/orders/orders.service.ts
   ```
   Đọc message: nhiều chủ đề khác nhau = god service thật.
3. **Đếm mock cần thiết** để test một method. Nhiều mock = coupling cao.
4. **Tìm circular dependency**: `npx madge --circular --extensions ts src/`. Nếu có, cách tách đang sai.
5. **Tìm query xuyên module**: grep tên bảng của module khác trong service của bạn.
6. **Đọc một method từ đầu đến cuối** — nếu không theo được luồng, vấn đề là indirection, không phải kích thước.

## Production Considerations

- **Chẩn đoán trước khi tách.** Bốn nguyên nhân, bốn cách sửa; tách sai đắt hơn không tách.
- **Event cho side effect là bước đầu tiên** — rẻ nhất, hiệu quả nhất, không phá cấu trúc.
- **Side effect quan trọng cần outbox**, không phải in-process event. Xem [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md).
- **Quy tắc nghiệp vụ ra hàm thuần** — nó giảm dependency và làm test không cần mock.
- **Orchestration service được phép nhiều dependency**, miễn không chứa quy tắc.
- **Ranh giới module trước ranh giới class** — query xuyên module là vấn đề lớn hơn service to.
- **`madge --circular` trong CI** — circular dependency là dấu hiệu tách sai, và nó phá DI.
- **Event cần observability**: correlation ID xuyên event, và metric cho listener thất bại. Không có nó, luồng async trở nên không debug được. Xem [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Event cho side effect | coupling thấp, ít dependency | luồng khó theo, cần observability |
| Gọi trực tiếp | luồng rõ ràng, dễ debug | coupling cao, service phình |
| Tách theo nghiệp vụ | cohesion cao | phải quyết định ranh giới |
| Tách theo method | dễ làm | circular dependency, cohesion thấp |
| Orchestration service | luồng nghiệp vụ đọc được ở một chỗ | nhiều dependency (nhưng đúng vai) |
| In-process event | đơn giản, không hạ tầng | mất khi process chết |
| Outbox | bảo đảm side effect xảy ra | thêm bảng, thêm worker |

## Explain Without Notes

1. Bốn nguyên nhân của "service 15 dependency", và cách sửa mỗi cái?
2. Câu hỏi để phân loại một việc là đồng bộ hay event?
3. Vì sao tách theo method gây circular dependency?
4. Khi nào orchestration service với nhiều dependency là đúng?
5. `forwardRef` nói gì về cách bạn đã tách?
6. In-process event mất ở đâu, và khi nào cần outbox?

## Related

- [SOLID trong thực tế](06-solid-in-practice.md) — SRP là "một lý do thay đổi"
- [Clean architecture pragmatic](07-clean-architecture-pragmatic.md) — use case layer
- [Modular monolith](02-modular-monolith.md) — ranh giới module
- [Domain logic boundaries](03-domain-logic-boundaries.md) — quy tắc thành hàm thuần
- [Modules & DI (NestJS)](../02-nestjs/behavior/02-modules-di.md) — circular dependency và `forwardRef`
- [Module system trong Node](../01-nodejs/fundamentals/02-module-system.md) — vì sao circular import phá DI
- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md)
- [Event-driven systems](../../06-system-design/07-event-driven.md)
- [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md)
