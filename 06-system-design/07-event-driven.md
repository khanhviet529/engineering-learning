---
level: advanced
area: system-design
prerequisites:
  - 04-consistency-availability.md
related:
  - 08-monolith-to-microservices.md
  - ../03-database/04-message-queues/06-outbox-pattern.md
---

# Event-driven architecture

> Một hệ thống chuyển sang kiến trúc hướng sự kiện để "giảm phụ thuộc giữa các service". Sáu tháng sau, để trả lời câu hỏi "vì sao đơn hàng này chưa được giao", một kỹ sư phải mở sáu dashboard và ghép thủ công dòng thời gian từ log của năm service. Không service nào phụ thuộc trực tiếp vào service khác — nhưng **thay đổi một trường trong event `OrderPlaced` vẫn làm hỏng ba service, và không ai biết trước cái nào**.

## Position

```text
Đồng bộ:  A gọi B, chờ trả lời      → A BIẾT B, A phụ thuộc B đang sống
Sự kiện:  A phát "đã xảy ra X"       → A KHÔNG BIẾT ai nghe
          B, C, D tự quyết định làm gì

⇒ phụ thuộc chuyển từ THỜI GIAN CHẠY sang HỢP ĐỒNG DỮ LIỆU.
  Nó không biến mất — nó trở nên VÔ HÌNH.
```

## Problem

```text
Event-driven giải quyết thật:
  · A không cần biết ai quan tâm → thêm consumer mới không sửa A
  · A không chết khi B chết      → cô lập lỗi
  · A không chờ B                → độ trễ của A không phụ thuộc B
  · đột biến được làm phẳng

Và tạo ra:
  · luồng nghiệp vụ KHÔNG CÒN Ở MỘT CHỖ NÀO      → khó hiểu, khó debug
  · nhất quán cuối cùng ở mọi nơi                 → trạng thái trung gian nhìn thấy được
  · hợp đồng ngầm giữa producer và consumer       ← sự cố ở đầu note
  · thứ tự, trùng lặp, message chết               → mỗi cái là một lớp lỗi
```

## Mental Model

### Ba loại "event" hay bị gộp làm một

```text
① EVENT NOTIFICATION       "đã xảy ra X" — payload tối thiểu
   { type: 'OrderPlaced', orderId: '123' }
   ✓ hợp đồng nhỏ, ít ràng buộc
   ✗ consumer phải GỌI NGƯỢC để lấy chi tiết → lại tạo phụ thuộc runtime

② EVENT-CARRIED STATE TRANSFER  "đã xảy ra X, đây là dữ liệu"
   { type: 'OrderPlaced', order: { id, items, total, customer } }
   ✓ consumer tự chủ hoàn toàn, không gọi ngược
   ✗ hợp đồng LỚN → mọi thay đổi ảnh hưởng nhiều bên; dữ liệu trùng lặp

③ COMMAND (đội lốt event)  "hãy làm X"
   { type: 'SendEmail', to: '...' }
   ← đây KHÔNG phải event; nó là lời gọi bất đồng bộ có đúng một người nhận
   → dùng queue điểm-điểm, đừng dùng pub/sub
```

Nhầm ③ với ① là lỗi thiết kế phổ biến: nó tạo ra một hệ thống nơi producer thực chất **vẫn** ra lệnh cho consumer, nhưng bây giờ qua một lớp gián tiếp làm việc debug khó hơn.

```text
Lựa chọn thực dụng: ② với payload VỪA ĐỦ
  → đủ để consumer phổ biến nhất không phải gọi ngược
  → không nhồi mọi thứ "phòng khi cần"
```

### Event là SỰ THẬT ĐÃ XẢY RA, ở thì quá khứ

```text
✓ OrderPlaced · PaymentCaptured · InventoryReserved · UserRegistered
✗ CreateOrder · ProcessPayment · SendEmail        ← đây là command

Tên ở thì quá khứ ép bạn nghĩ đúng:
  event mô tả điều ĐÃ xảy ra và KHÔNG THỂ từ chối
  command mô tả điều bạn MUỐN xảy ra và có thể bị từ chối
```

```text
Hệ quả thiết kế: producer KHÔNG được quan tâm ai xử lý event và xử lý thế nào.
  nếu producer cần biết kết quả → đó là command, không phải event
  nếu producer retry vì consumer thất bại → producer đang ra lệnh
```

### Hợp đồng event: phần bị bỏ quên nhất

```text
Event là API CÔNG KHAI. Nó khó đổi hơn REST API vì:
  · bạn không biết ai đang nghe
  · event cũ có thể đang nằm trong queue hoặc trong log
  · consumer cập nhật theo lịch riêng của họ

Quy tắc tương thích:
  ✓ THÊM trường tuỳ chọn
  ✓ thêm loại event mới
  ✗ XOÁ trường
  ✗ ĐỔI TÊN trường
  ✗ ĐỔI KIỂU (số → chuỗi)
  ✗ đổi Ý NGHĨA của trường  ← nguy hiểm nhất, không công cụ nào phát hiện
```

```text
Công cụ:
  · schema registry (Avro/Protobuf/JSON Schema) + kiểm tra tương thích trong CI
  · phiên bản trong TÊN event: `order.placed.v2` khi buộc phải phá vỡ
  · phát CẢ HAI phiên bản trong thời gian chuyển đổi
  · contract test giữa producer và consumer
```

Xem [Contract testing](../05-cross-cutting/testing/07-contract-testing.md).

### Ba đảm bảo bạn không có

```text
① THỨ TỰ
   chỉ được đảm bảo TRONG một partition
   → cùng khoá (orderId) phải vào cùng partition
   → thứ tự TOÀN CỤC giữa các khoá: không có, và đừng thiết kế cần nó

② XỬ LÝ ĐÚNG MỘT LẦN
   at-least-once là mặc định
   → consumer PHẢI idempotent

③ THỜI GIAN
   event có thể tới sau vài mili-giây hoặc vài phút (retry, tồn đọng)
   → không thiết kế logic phụ thuộc "event sẽ tới trong X giây"
   → event cũng có thể tới KHÔNG THEO THỨ TỰ giữa các khoá khác nhau
```

```text
Hệ quả cụ thể: consumer phải xử lý được
  · cùng event hai lần
  · event tới muộn hơn event lẽ ra sau nó (khác khoá)
  · event của một thực thể đã bị xoá
```

### Dual-write: bug nền tảng của mọi hệ thống event

```text
✗ ghi database rồi publish event — HAI thao tác, KHÔNG nguyên tử
  process chết ở giữa → dữ liệu tồn tại, event KHÔNG BAO GIỜ được phát
  → không có lỗi, không có alert, không ai biết

✓ OUTBOX: ghi event vào bảng trong CÙNG transaction; worker đọc và publish
✓ CDC: đọc WAL/binlog → event sinh ra từ chính thay đổi dữ liệu
```

Đây là lỗi phổ biến nhất trong hệ thống event-driven, và nó **im lặng** — hệ quả chỉ lộ ra khi ai đó phát hiện dữ liệu không khớp giữa hai service.

Xem [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md).

### Choreography và orchestration

```text
CHOREOGRAPHY   mỗi service nghe event và tự quyết định
  Order → OrderPlaced → Payment nghe → PaymentCaptured → Shipping nghe → ...
  ✓ ghép lỏng, thêm bước không sửa ai
  ✗ KHÔNG CÓ CHỖ NÀO mô tả toàn bộ luồng   ← sự cố ở đầu note
  ✗ khó biết luồng đang ở đâu, khó xử lý thất bại giữa chừng

ORCHESTRATION  một điều phối viên gọi từng bước
  Saga orchestrator: gọi Payment → gọi Inventory → gọi Shipping
  ✓ luồng ở MỘT CHỖ, đọc được, theo dõi được, bù trừ rõ ràng
  ✗ điều phối viên biết về mọi bước → ghép chặt hơn
```

```text
Lựa chọn thực dụng:
  choreography cho phản ứng ĐỘC LẬP
    (gửi email chào mừng, cập nhật chỉ mục tìm kiếm, ghi analytics)
  orchestration cho QUY TRÌNH NGHIỆP VỤ có nhiều bước và cần bù trừ
    (đặt hàng → thanh toán → giữ hàng → giao hàng)
```

Nhiều hệ thống dùng choreography cho mọi thứ vì nó dễ bắt đầu hơn, rồi phát hiện không ai mô tả được quy trình đặt hàng hoạt động thế nào.

### Event sourcing: khác event-driven

```text
EVENT-DRIVEN    dùng event để GIAO TIẾP giữa các thành phần
EVENT SOURCING  dùng event làm CÁCH LƯU TRỮ trạng thái
                → trạng thái hiện tại = phát lại toàn bộ event

Event sourcing:
  ✓ audit trail hoàn hảo, phát lại được, xem được trạng thái tại mọi thời điểm
  ✗ phức tạp lớn: snapshot, tiến hoá schema event, sửa dữ liệu sai rất khó
  ✗ truy vấn cần projection riêng (CQRS)

⇒ event-driven KHÔNG đòi hỏi event sourcing.
  Phần lớn hệ thống nên dùng cái đầu và không dùng cái sau.
```

Event sourcing đáng cân nhắc khi **lịch sử thay đổi tự nó là yêu cầu nghiệp vụ** (kế toán, hồ sơ pháp lý) — không phải vì nó "hiện đại hơn".

### Quan sát hệ thống event-driven

```text
Không có request nào đi xuyên hệ thống ⇒ debug khó hơn hẳn.
Bốn thứ bắt buộc:

① CORRELATION ID trong mọi event, truyền qua mọi bước
   → dựng lại được toàn bộ dòng thời gian của một giao dịch

② TRACE qua message queue
   → nhúng trace context vào message; đo `message.age_ms`

③ TRẠNG THÁI QUY TRÌNH nhìn thấy được
   → bảng lưu trạng thái saga/quy trình, truy vấn được
   → "đơn hàng này đang ở bước nào" phải trả lời được bằng MỘT truy vấn

④ METRIC cho mỗi loại event
   → tốc độ phát, tốc độ xử lý, tuổi message cũ nhất, tỉ lệ vào DLQ
```

Điểm ③ là thứ trực tiếp giải quyết sự cố ở đầu note: nếu có bảng trạng thái quy trình, câu hỏi "vì sao đơn hàng này chưa giao" là một câu `SELECT`.

## Example

Quy trình đặt hàng — orchestration cho luồng chính, choreography cho phản ứng phụ:

```ts
// ① OUTBOX: event và dữ liệu trong CÙNG transaction
async placeOrder(dto: PlaceOrderDto, user: User) {
  return this.db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { ...dto, userId: user.id, status: 'pending' },
    });

    // trạng thái quy trình — nhìn thấy được, truy vấn được
    await tx.orderSaga.create({
      data: { orderId: order.id, step: 'created', correlationId: currentTraceId() },
    });

    await tx.outbox.create({
      data: {
        topic: 'order.placed.v1',
        key: order.id,                                  // ② partition key = thứ tự theo đơn
        payload: {
          eventId: randomUUID(),                        // ③ để consumer khử trùng lặp
          occurredAt: new Date().toISOString(),
          correlationId: currentTraceId(),
          order: { id: order.id, userId: user.id, totalCents: order.totalCents,
                   items: order.items },                // ④ state transfer VỪA ĐỦ
        },
      },
    });
    return order;
  });
}
```

```ts
// ⑤ ORCHESTRATION cho luồng chính — quy trình ở MỘT CHỖ, đọc được
@Injectable()
export class OrderSaga {
  @OnEvent('order.placed.v1')
  async handle(event: OrderPlacedEvent) {
    const { orderId } = event.order;

    try {
      await this.advance(orderId, 'reserving_inventory');
      await this.inventory.reserve(orderId, event.order.items);

      await this.advance(orderId, 'capturing_payment');
      await this.payments.capture(orderId, event.order.totalCents,
        { idempotencyKey: `order-${orderId}` });        // ⑥ idempotent

      await this.advance(orderId, 'completed');
    } catch (err) {
      await this.compensate(orderId, err);              // ⑦ bù trừ tường minh
    }
  }

  private async compensate(orderId: string, err: unknown) {
    const saga = await this.db.orderSaga.findUniqueOrThrow({ where: { orderId } });

    // bù trừ NGƯỢC lại theo đúng các bước ĐÃ hoàn thành
    if (saga.step === 'capturing_payment' || saga.step === 'completed') {
      await this.payments.refund(orderId, { idempotencyKey: `refund-${orderId}` });
    }
    if (['reserving_inventory', 'capturing_payment', 'completed'].includes(saga.step)) {
      await this.inventory.release(orderId);
    }
    await this.advance(orderId, 'failed', String(err));
  }

  private advance(orderId: string, step: string, error?: string) {
    return this.db.orderSaga.update({
      where: { orderId },
      data: { step, error, updatedAt: new Date() },     // ⑧ mỗi bước ghi lại
    });
  }
}
```

```ts
// ⑨ CHOREOGRAPHY cho phản ứng độc lập — không ảnh hưởng luồng chính
@OnEvent('order.placed.v1')
async sendConfirmationEmail(event: OrderPlacedEvent) {
  // khử trùng lặp: unique index trên (consumer, event_id)
  const first = await this.dedupe.tryClaim('email-consumer', event.eventId);
  if (!first) return;                                   // đã xử lý

  await this.mailer.send({ to: event.order.userEmail, template: 'order-confirmation' });
}

@OnEvent('order.placed.v1')
async updateSearchIndex(event: OrderPlacedEvent) { /* ... */ }

@OnEvent('order.placed.v1')
async recordAnalytics(event: OrderPlacedEvent) { /* ... */ }
```

```text
Kết quả:
  · luồng nghiệp vụ ở MỘT file, đọc được từ trên xuống
  · "đơn hàng đang ở bước nào" = SELECT step FROM order_saga WHERE order_id = ?
  · thêm consumer mới (analytics, chỉ mục) không sửa gì trong luồng chính
  · lỗi ở consumer phụ không làm hỏng đơn hàng
```

Và câu hỏi từ sự cố ở đầu note giờ có câu trả lời trực tiếp:

```sql
SELECT step, error, updated_at FROM order_saga WHERE order_id = '...';
-- 'capturing_payment' | 'gateway timeout' | 2026-08-28 03:14
```

## Prediction

1. A gọi B đồng bộ, B chết — A thế nào?
2. A phát event, B chết — A thế nào?
3. Event notification chỉ có `orderId`, consumer cần chi tiết — nó làm gì?
4. Điều đó có tạo lại phụ thuộc runtime không?
5. Xoá một trường khỏi event schema — consumer nào hỏng?
6. Đổi ý nghĩa của một trường (giữ nguyên tên và kiểu) — công cụ nào phát hiện?
7. Ghi DB rồi publish event, process chết giữa hai bước — hậu quả?
8. Dùng outbox — hậu quả?
9. Hai event của cùng đơn hàng vào hai partition khác nhau — thứ tự có được đảm bảo không?
10. Consumer không idempotent, message được gửi lại — hậu quả?
11. Choreography thuần, 5 service, cần biết luồng đang ở đâu — làm sao?
12. Có bảng trạng thái saga — làm sao?
13. Event tên `SendEmail` — đó là event hay command?
14. Producer retry vì consumer xử lý thất bại — nó đang làm gì sai?

<details>
<summary>Đáp án</summary>

1. A **lỗi hoặc treo** — phụ thuộc runtime.
2. A **không bị ảnh hưởng** — event nằm trong queue chờ B trở lại.
3. **Gọi ngược** producer để lấy chi tiết.
4. **Có** — mất phần lớn lợi ích của việc tách bằng event.
5. **Không biết** — bạn không biết ai đang nghe.
6. **Không công cụ nào** — schema vẫn hợp lệ; đây là thay đổi nguy hiểm nhất.
7. Dữ liệu tồn tại, **event không bao giờ được phát**, không có lỗi nào.
8. Event nằm trong cùng transaction → **không mất**.
9. **Không** — thứ tự chỉ trong một partition.
10. Thao tác **chạy hai lần**.
11. Ghép thủ công từ log của 5 service.
12. **Một câu `SELECT`.**
13. **Command** — nó ra lệnh, không mô tả sự thật đã xảy ra.
14. Nó đang **ra lệnh**, không phát sự kiện — thiết kế sai vai trò.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dừng một consumer 10 phút | Producer có bị ảnh hưởng không? |
| Gửi cùng event hai lần | Consumer xử lý mấy lần? |
| Gửi hai event của cùng entity vào partition khác nhau | Thứ tự thế nào? |
| Xoá một trường khỏi event | Consumer nào hỏng? Bạn biết trước không? |
| Giết process giữa commit và publish | Event có mất không? |
| Hỏi "đơn hàng X đang ở bước nào" | Mất bao lâu để trả lời? |
| Tìm nơi mô tả toàn bộ quy trình đặt hàng | Có file nào không? |
| Đếm số consumer của một event | Có danh sách không? |
| Làm consumer thứ ba thất bại | Luồng chính có bị ảnh hưởng không? |
| Theo dõi một correlation id qua mọi service | Có làm được không? |
| Xem DLQ | Có gì trong đó? Ai xem nó? |

## What Usually Goes Wrong

- **Dual-write** thay vì outbox → event mất im lặng.
- **Command đội lốt event** → producer vẫn ra lệnh, chỉ khó debug hơn.
- **Event notification quá nhỏ** → consumer gọi ngược, tái tạo phụ thuộc runtime.
- **Event quá lớn** → hợp đồng khổng lồ, mọi thay đổi ảnh hưởng nhiều bên.
- **Không có schema registry** → thay đổi phá vỡ không bị phát hiện.
- **Đổi ý nghĩa trường** — không công cụ nào bắt được.
- **Consumer không idempotent** với at-least-once.
- **Giả định thứ tự toàn cục.**
- **Choreography cho quy trình nghiệp vụ** → không ai mô tả được luồng.
- **Không có bảng trạng thái quy trình** → câu hỏi đơn giản mất hàng giờ.
- **Không có correlation id** → không dựng lại được dòng thời gian.
- **Không ai xem DLQ** → message chết tích tụ.
- **Nhầm event-driven với event sourcing** → nhận độ phức tạp không cần.
- **Không đo tuổi message cũ nhất** → consumer chết mà không ai biết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Event-driven giảm phụ thuộc | Nó chuyển phụ thuộc sang hợp đồng dữ liệu, và làm nó vô hình |
| Event-driven đơn giản hơn | Nó đổi độ phức tạp runtime lấy độ phức tạp nhận thức |
| Producer không cần biết consumer | Đúng về runtime, sai về hợp đồng |
| Publish sau commit là an toàn | Đó là dual-write |
| Broker đảm bảo thứ tự | Chỉ trong một partition |
| Exactly-once có thể cấu hình được | Consumer phải idempotent |
| Event-driven đòi hỏi event sourcing | Hai thứ khác nhau |
| Choreography luôn tốt hơn vì ghép lỏng | Nó làm quy trình nghiệp vụ biến mất |
| Thêm consumer là miễn phí | Mỗi consumer là một hợp đồng phải giữ |
| Kiến trúc event là bắt buộc để mở rộng | Phần lớn hệ thống mở rộng tốt mà không cần |

## Debugging

1. **"Chuyện gì đã xảy ra với X"** → truy vấn bảng trạng thái quy trình trước, không đọc log.
2. **Nếu không có bảng đó**, dùng correlation id để gom log từ mọi service — và ghi nhận việc thêm bảng đó vào việc cần làm.
3. **Event không tới** → kiểm tra outbox tồn đọng, worker có chạy không, DLQ có gì không.
4. **Consumer chậm** → `message.age_ms` và độ sâu hàng đợi; phân biệt "xử lý chậm" với "chờ trong hàng đợi".
5. **Xử lý trùng** → consumer có bảng khử trùng lặp không? Nó có nằm cùng transaction với tác dụng phụ không?
6. **Thứ tự sai** → hai event có cùng partition key không?
7. **Consumer hỏng sau khi producer deploy** → thay đổi schema; kiểm tra registry và contract test.
8. **Dữ liệu lệch giữa hai service** → tìm dual-write; chạy đối soát.

## Production Considerations

- **Outbox hoặc CDC**, không bao giờ dual-write.
- **Event ở thì quá khứ**; command đi qua queue điểm-điểm, không qua pub/sub.
- **Payload vừa đủ** cho consumer phổ biến nhất, không nhồi phòng xa.
- **Schema registry + kiểm tra tương thích trong CI**; phiên bản trong tên event khi buộc phá vỡ.
- **Contract test** giữa producer và consumer chính.
- **`eventId` trong mọi event**; consumer khử trùng lặp bằng unique index.
- **Partition key theo thực thể** để giữ thứ tự nơi cần.
- **Orchestration cho quy trình nghiệp vụ**, choreography cho phản ứng độc lập.
- **Bảng trạng thái quy trình** truy vấn được, có mọi bước và lỗi.
- **Correlation id trong mọi event và mọi dòng log.**
- **Trace context nhúng vào message**; đo `message.age_ms`.
- **DLQ có người sở hữu, có alert, có quy trình xử lý lại.**
- **Đo theo loại event**: tốc độ phát, tốc độ xử lý, tuổi cũ nhất, tỉ lệ DLQ.
- **Job đối soát** giữa các service giữ dữ liệu trùng lặp.
- **Danh sách consumer của mỗi event** — tài liệu hoặc tự sinh từ registry.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Đồng bộ | đơn giản, lỗi thấy ngay, dễ debug | ghép chặt, lan lỗi, độ trễ cộng dồn |
| Event-driven | ghép lỏng runtime, cô lập lỗi | luồng phân tán, nhất quán cuối cùng |
| Event notification | hợp đồng nhỏ | consumer phải gọi ngược |
| State transfer | consumer tự chủ | hợp đồng lớn, dữ liệu trùng lặp |
| Choreography | thêm bước không sửa ai | không ai mô tả được luồng |
| Orchestration | luồng ở một chỗ, theo dõi được | điều phối viên biết mọi bước |
| Event sourcing | audit hoàn hảo, phát lại được | phức tạp lớn, sửa dữ liệu khó |
| Trạng thái hiện tại | đơn giản, truy vấn dễ | mất lịch sử |
| Schema registry | bắt thay đổi phá vỡ | thêm hạ tầng và quy trình |
| Không registry | linh hoạt | phá vỡ consumer mà không biết |

## Explain Without Notes

1. Event-driven chuyển phụ thuộc từ đâu sang đâu? Vì sao đó không phải là loại bỏ?
2. Ba loại "event" và cái nào không phải event thật?
3. Vì sao tên event phải ở thì quá khứ?
4. Ba loại thay đổi phá vỡ hợp đồng event, và loại nào không công cụ nào bắt được?
5. Dual-write là gì và hai cách chống?
6. Ba đảm bảo bạn không có trong hệ thống event, và hệ quả cụ thể của từng cái?
7. Choreography và orchestration — dùng cái nào cho việc gì?
8. Bốn thứ bắt buộc để quan sát được hệ thống event-driven?

## Related

- [Consistency & availability](04-consistency-availability.md) — nhất quán cuối cùng
- [Monolith to microservices](08-monolith-to-microservices.md) — khi nào cần ranh giới
- [Storage selection](06-storage-selection.md) — CDC làm cầu nối giữa các kho
- [Idempotency & retry](03-idempotency-retry.md) — consumer phải idempotent
- [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) — chống dual-write
- [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once
- [Ordering & partitioning](../03-database/04-message-queues/04-ordering-partitioning.md) — thứ tự trong partition
- [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) — message chết
- [Contract testing](../05-cross-cutting/testing/07-contract-testing.md) — hợp đồng event
- [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) — trace qua queue

## Version / Context

Ví dụ dùng NestJS 10/11, PostgreSQL 16 (outbox với `FOR UPDATE SKIP LOCKED`), Kafka/BullMQ. Phân loại ba kiểu event theo Martin Fowler ("What do you mean by Event-Driven?"). Saga pattern theo Garcia-Molina và Salem (1987). Debezium cho CDC. Schema registry: Confluent Schema Registry (Avro/Protobuf/JSON Schema) hoặc tương đương.
