---
level: intermediate
area: cross-cutting
related:
  - 02-unit-vs-integration.md
  - 04-mocking-test-doubles.md
---

# Test theo behavior, không theo cấu trúc

> Một dự án có 1.847 test và độ phủ 92%. Một lần refactor nhỏ — tách một service thành hai — làm hỏng 340 test. Không có bug nào được tìm thấy trong quá trình sửa chúng. Ba tuần sau, production có sự cố: đơn hàng bị tính tiền hai lần khi người dùng bấm nút submit hai lần. **Không test nào bắt được, vì không test nào mô tả hành vi đó.**

## Position

```text
MODEL → PREDICT/BUILD → BREAK → EXPLAIN → RECALL
                          ↑
        test là cách BREAK có hệ thống và LẶP LẠI ĐƯỢC
```

## Problem

Hai câu hỏi hoàn toàn khác nhau, và chúng dẫn tới hai bộ test khác nhau:

```text
"Hàm này có được gọi đúng không?"      → test theo CẤU TRÚC
"Hệ thống có làm đúng việc không?"      → test theo HÀNH VI
```

Test theo cấu trúc có một tính chất chết người:

```text
Nó hỏng khi bạn ĐỔI CÁCH LÀM.
Nó KHÔNG hỏng khi bạn làm SAI VIỆC.

⇒ ngược hoàn toàn với thứ bạn muốn.
```

Đó là lý do 340 test hỏng mà không tìm ra bug nào, và một hành vi quan trọng không được bảo vệ.

## Mental Model

### Test là một mệnh đề về hành vi

```text
Một test tốt đọc được thành một câu về HỆ THỐNG:

  "Khi cùng một đơn hàng được submit hai lần, chỉ một khoản tiền được tính."
  "Khi thanh toán thất bại, đơn hàng không chuyển sang trạng thái paid."
  "Người dùng không xem được hoá đơn của người khác."

Một test kém đọc thành một câu về CODE:

  "orderService.create gọi paymentGateway.charge đúng một lần."
  "repository.save được gọi với đối tượng có trường status."
```

Câu hỏi kiểm tra: **nếu bạn viết lại phần triển khai từ đầu nhưng giữ nguyên hành vi, test này còn đúng không?** Nếu không, nó đang test cấu trúc.

### Kim tự tháp không phải về loại test — nó về CHI PHÍ

```text
            ╱ E2E ╲          chậm · giòn · đắt · gần người dùng nhất
          ╱─────────╲
        ╱ Integration ╲      vừa · thật · bắt được lỗi tích hợp
      ╱─────────────────╲
    ╱       Unit          ╲  nhanh · nhiều · phản hồi tức thì
  ╱─────────────────────────╲

Tỉ lệ KHÔNG phải quy tắc. Nguyên tắc là:
  đẩy mỗi kiểm chứng xuống TẦNG RẺ NHẤT VẪN CÒN CÓ NGHĨA.
```

"Vẫn còn có nghĩa" là phần quan trọng. Kiểm chứng "transaction rollback khi có lỗi" ở tầng unit với repository giả **không có nghĩa** — nó chỉ kiểm tra mock của bạn.

### Ranh giới nào nên mock

Đây là quyết định định hình toàn bộ chất lượng bộ test:

```text
✓ MOCK Ở RANH GIỚI TIẾN TRÌNH      ✗ MOCK Ở RANH GIỚI TẦNG
  · API bên thứ ba (thanh toán,      · repository (thay bằng DB thật)
    email, SMS)                      · service khác trong cùng ứng dụng
  · đồng hồ, random, uuid            · ORM
  · hàng đợi bên ngoài               · framework HTTP

  → chậm, tốn tiền, không            → mock ở đây khoá chặt cấu trúc
    xác định, tác dụng phụ thật        và không kiểm chứng được gì thật
```

Mock repository là cách nhanh nhất biến bộ test thành thứ mô tả code hiện tại thay vì mô tả hành vi mong muốn. Xem [Mocking & test doubles](04-mocking-test-doubles.md).

### Độ phủ đo được gì và không đo được gì

```text
Coverage = "dòng code này đã CHẠY trong lúc test"
         ≠ "hành vi này đã được KIỂM CHỨNG"
```

```ts
// hàm này đạt 100% coverage với một test không assert gì cả
it('không lỗi', () => { calculateTotal(order); });
```

```text
Coverage HỮU ÍCH khi đọc ngược:
  vùng KHÔNG được phủ = vùng chắc chắn chưa được kiểm chứng
  → dùng nó để tìm lỗ hổng, không dùng để chứng minh chất lượng

Coverage THÀNH MỤC TIÊU → test rác được viết để đạt số
  (định luật Goodhart: một chỉ số trở thành mục tiêu thì nó ngừng là chỉ số tốt)
```

### Test nào đáng viết: bắt đầu từ hành vi có thể sai

```text
Với mỗi hành vi, hỏi bốn câu:
  ① Đường đúng     — nó làm đúng việc chứ?
  ② Biên            — rỗng, một phần tử, quá lớn, âm, null
  ③ Từ chối         — ai KHÔNG được làm? cái gì KHÔNG được xảy ra?
  ④ Đồng thời/lặp   — hai lần cùng lúc? hai lần liên tiếp?

Câu ③ và ④ là nơi bug production sống,
và là nơi bộ test trung bình mỏng nhất.
```

Sự cố ở đầu note là câu ④: submit hai lần. Nó không được kiểm chứng vì không ai hỏi câu đó.

### Test là tài liệu duy nhất luôn đúng

```text
Comment nói dối. README lỗi thời. Test CHẠY.

⇒ Tên test nên đọc được như đặc tả:
  ✗ it('test create order')
  ✗ it('should work')
  ✓ it('không tạo đơn thứ hai khi cùng idempotency key được gửi lại')
  ✓ it('từ chối đơn hàng có tổng tiền âm')
```

Khi một test hỏng, tên của nó phải đủ để biết **hành vi nào của hệ thống đang sai** — trước khi đọc code.

### Cấu trúc một test: Arrange–Act–Assert

```text
Arrange   dựng trạng thái — chỉ những gì LIÊN QUAN tới hành vi này
Act       MỘT hành động
Assert    kiểm chứng hành vi quan sát được từ bên ngoài
```

```ts
it('không tính tiền hai lần khi submit lại cùng một đơn', async () => {
  // Arrange
  const cart = await seedCart({ items: [{ sku: 'A', qty: 1, priceCents: 5_000 }] });
  const key = 'idem-123';

  // Act
  await api.post('/orders').set('Idempotency-Key', key).send({ cartId: cart.id }).expect(201);
  await api.post('/orders').set('Idempotency-Key', key).send({ cartId: cart.id }).expect(200);

  // Assert — quan sát TRẠNG THÁI, không quan sát lời gọi hàm
  const orders = await db.order.findMany({ where: { cartId: cart.id } });
  expect(orders).toHaveLength(1);
  expect(paymentGateway.charges).toHaveLength(1);      // fake ghi lại tác dụng phụ THẬT
  expect(paymentGateway.charges[0].amountCents).toBe(5_000);
});
```

Assert cuối cùng đáng chú ý: nó kiểm chứng **tác dụng phụ đã xảy ra ra bên ngoài** (một lần charge, đúng số tiền), không kiểm chứng rằng một method nào đó được gọi. Nếu bạn thay thư viện thanh toán, test này vẫn có nghĩa.

### Khi nào một test đáng xoá

```text
✗ test mô tả cách triển khai (mock nội bộ, kiểm tra thứ tự gọi hàm)
✗ test lặp lại điều một test khác đã kiểm chứng
✗ test luôn pass dù code sai (không có assert thật)
✗ test flaky mà không ai sửa  ← độc hại nhất
✗ test kiểm tra thư viện chứ không kiểm tra code của bạn

Test flaky làm hỏng TOÀN BỘ bộ test:
  đỏ ngẫu nhiên → người ta chạy lại → "đỏ" mất ý nghĩa
  → test thật hỏng cũng bị chạy lại
```

Xoá một test flaky tốt hơn giữ nó — nhưng tốt nhất là sửa nguyên nhân. Xem [Deterministic tests](06-deterministic-tests.md).

## Example

Cùng một hành vi, hai cách test:

```ts
// ✗ THEO CẤU TRÚC — hỏng khi refactor, không bắt được lỗi logic
it('creates order', async () => {
  const repo = { save: jest.fn().mockResolvedValue({ id: '1' }) };
  const payment = { charge: jest.fn().mockResolvedValue({ ok: true }) };
  const service = new OrderService(repo as any, payment as any);

  await service.create({ cartId: 'c1' });

  expect(repo.save).toHaveBeenCalledTimes(1);
  expect(payment.charge).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000 }));
});
```

```text
Test này pass kể cả khi:
  · đơn được lưu với trạng thái sai
  · charge chạy TRƯỚC khi kiểm tra tồn kho
  · submit hai lần tạo hai đơn
Và nó HỎNG khi:
  · bạn đổi tên method từ `save` thành `persist`
  · bạn gộp hai lời gọi thành một
⇒ hỏng đúng lúc không nên, không hỏng đúng lúc cần
```

```ts
// ✓ THEO HÀNH VI — DB thật, fake ở ranh giới tiến trình
describe('POST /orders', () => {
  it('tạo đơn ở trạng thái pending và tính đúng số tiền', async () => {
    const cart = await seedCart({ items: [{ sku: 'A', qty: 2, priceCents: 2_500 }] });

    const { body } = await api.as(user).post('/orders').send({ cartId: cart.id }).expect(201);

    const order = await db.order.findUniqueOrThrow({ where: { id: body.id } });
    expect(order.status).toBe('pending');
    expect(order.totalCents).toBe(5_000);
  });

  it('KHÔNG chuyển sang paid khi thanh toán thất bại', async () => {
    const cart = await seedCart({ items: [{ sku: 'A', qty: 1, priceCents: 5_000 }] });
    paymentGateway.failNext('card_declined');

    await api.as(user).post('/orders').send({ cartId: cart.id }).expect(402);

    const orders = await db.order.findMany({ where: { cartId: cart.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('payment_failed');   // không phải 'paid', không phải biến mất
  });

  it('không cho đặt đơn từ giỏ hàng của người khác', async () => {
    const cart = await seedCart({ ownerId: otherUser.id });
    await api.as(user).post('/orders').send({ cartId: cart.id }).expect(404);
  });

  it('không tạo đơn thứ hai khi cùng idempotency key được gửi lại', async () => {
    /* ... như ví dụ ở trên ... */
  });
});
```

Bốn test này sống sót qua mọi refactor nội bộ và bắt được đúng những gì có thể sai. Chúng cũng đọc được như một đặc tả của endpoint.

## Prediction

1. Refactor tách một service thành hai, không đổi hành vi — test theo cấu trúc có hỏng không?
2. Test theo hành vi có hỏng không?
3. Code có bug logic nhưng gọi đúng các hàm — test theo cấu trúc có bắt được không?
4. Coverage 92%, submit hai lần tạo hai đơn — coverage có phản ánh điều đó không?
5. `it('không lỗi', () => { fn(x); })` — coverage của `fn` là bao nhiêu? Nó kiểm chứng gì?
6. Mock repository và test "service lưu đúng dữ liệu" — nó kiểm chứng gì về database?
7. Dùng DB thật trong test — nó kiểm chứng thêm gì?
8. Một test flaky trong bộ 2000 test, chạy 10 lần/ngày — hệ quả sau một tháng?
9. Test tên `it('should work')` hỏng trong CI — bạn biết gì?
10. Test tên `it('từ chối đơn hàng có tổng tiền âm')` hỏng — bạn biết gì?
11. Đặt mục tiêu coverage 90% cho team — chuyện gì xảy ra với chất lượng test?
12. Chỉ test đường đúng, không test đường từ chối — lớp bug nào không được bảo vệ?

<details>
<summary>Đáp án</summary>

1. **Có** — nó gắn với cấu trúc.
2. **Không** — hành vi không đổi.
3. **Không** — nó chỉ kiểm tra lời gọi.
4. **Không** — coverage đo dòng chạy, không đo hành vi.
5. **100%**, và nó kiểm chứng **không gì cả** ngoài việc hàm không ném lỗi.
6. **Không gì** — nó kiểm chứng mock của bạn hoạt động.
7. Schema, ràng buộc, transaction, kiểu dữ liệu, hành vi thật của query.
8. Đội ngũ **quen với việc chạy lại** → đỏ mất ý nghĩa → test thật hỏng cũng bị bỏ qua.
9. **Không gì** — phải đọc code mới biết.
10. **Chính xác hành vi nào đang sai.**
11. Test rác được viết để đạt số; coverage tăng, chất lượng không.
12. Kiểm soát truy cập, validate, xử lý lỗi — tức phần lớn bug nghiêm trọng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi tên một method nội bộ | Bao nhiêu test hỏng? Có bug nào không? |
| Sửa một dòng logic thành sai (mutation thủ công) | Có test nào đỏ không? |
| Xoá một `expect` trong test | Test còn pass không? |
| Chạy toàn bộ bộ test 20 lần liên tiếp | Có test nào flaky không? |
| Chạy test theo thứ tự ngẫu nhiên | Có test nào phụ thuộc thứ tự không? |
| Chạy một test đơn lẻ | Nó pass độc lập không? |
| Xem coverage của thư mục domain so với controller | Chỗ nào mỏng? |
| Đếm test có mock repository | Chúng kiểm chứng gì? |
| Grep `toHaveBeenCalled` | Bao nhiêu test kiểm tra lời gọi thay vì kết quả? |
| Tắt mạng và chạy test | Có test nào gọi ra ngoài thật không? |

## What Usually Goes Wrong

- **Test theo cấu trúc** → hỏng khi refactor, im lặng khi có bug.
- **Mock ở ranh giới tầng** (repository, service nội bộ).
- **Coverage thành mục tiêu** → test không assert.
- **Không có test cho đường từ chối** và đường đồng thời.
- **Tên test không mô tả hành vi** → test đỏ không nói gì.
- **Test phụ thuộc thứ tự chạy** hoặc chia sẻ trạng thái.
- **Test flaky được chạy lại thay vì sửa** → cả bộ test mất uy tín.
- **Quá nhiều E2E** → chậm, giòn, người ta ngừng chạy.
- **Quá ít integration** → lỗi tích hợp chỉ lộ ra ở production.
- **Test kiểm tra thư viện** thay vì code của mình.
- **Một test assert mười thứ** → hỏng một chỗ, không biết chỗ nào.
- **Arrange dài 50 dòng** → không đọc được, và thường là dấu hiệu thiết kế chặt.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Coverage cao = chất lượng cao | Coverage đo dòng chạy, không đo kiểm chứng |
| Mọi test phải là unit test | Đúng tầng quan trọng hơn đúng loại |
| Mock mọi dependency là thực hành tốt | Mock ở ranh giới tầng khoá chặt cấu trúc |
| DB thật trong test là chậm và sai | Với container, nó nhanh và bắt được nhiều hơn |
| Test hỏng khi refactor là bình thường | Đó là dấu hiệu test gắn với cấu trúc |
| Nhiều test hơn là tốt hơn | Test kém tạo chi phí bảo trì và cảm giác an toàn giả |
| E2E là loại test đáng tin nhất | Nó cũng giòn và chậm nhất |
| Test flaky chỉ cần chạy lại | Nó phá hỏng ý nghĩa của toàn bộ bộ test |
| Viết test sau khi code xong cũng như nhau | Viết trước ép bạn nghĩ về hành vi trước |
| Test là chi phí | Nó là thứ cho phép thay đổi code mà không sợ |

## Debugging

1. **Test đỏ**: đọc **tên test** trước, không đọc stack trace. Nếu tên không đủ, đó là hạng mục cần sửa.
2. **Test hỏng hàng loạt sau refactor** → chúng gắn với cấu trúc; cân nhắc viết lại ở tầng cao hơn thay vì sửa từng cái.
3. **Test pass local, đỏ trong CI** → thứ tự chạy, song song, múi giờ, biến môi trường, tài nguyên dùng chung.
4. **Test flaky** → chạy 50 lần (`--repeat`); tìm nguồn không xác định: thời gian, random, thứ tự, network, trạng thái còn sót.
5. **Kiểm tra test có thật sự kiểm chứng gì không**: sửa code thành sai và xem test có đỏ không (mutation thủ công).
6. **Bộ test chậm** → đo từng test (`--verbose` với thời gian); thường 5% số test chiếm 80% thời gian.
7. **Không biết thiếu test ở đâu** → xem coverage của thư mục domain, và duyệt danh sách bug production gần đây: mỗi bug lẽ ra phải có một test.

## Production Considerations

- **Mỗi bug production sinh ra một test** trước khi sửa — đây là cách bộ test lớn lên đúng hướng.
- **Tên test là câu mô tả hành vi**, đọc được bởi người không biết code.
- **Mock chỉ ở ranh giới tiến trình**; DB thật qua container.
- **Test đường từ chối và đường đồng thời** cho mọi hành vi quan trọng.
- **Coverage là công cụ tìm lỗ hổng, không phải KPI.**
- **Không dung thứ test flaky**: sửa trong ngày hoặc cách ly (quarantine) có hạn, không để trôi.
- **Test chạy song song và độc lập thứ tự** — mỗi test tự dựng dữ liệu của nó.
- **Bộ test đơn vị + tích hợp chạy dưới 5 phút** trong CI; chậm hơn thì người ta né chạy.
- **E2E ít nhưng chọn lọc**: các luồng sinh doanh thu và luồng đăng nhập.
- **Chạy test theo thứ tự ngẫu nhiên** định kỳ để phát hiện phụ thuộc ngầm.
- **Kiểm chứng đường lỗi của dependency ngoài** — timeout, 500, phản hồi méo.
- **Mutation testing** trên module quan trọng (Stryker) nếu muốn biết test thật sự bắt được gì.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Test theo hành vi | sống sót qua refactor | dựng dữ liệu phức tạp hơn |
| Test theo cấu trúc | viết nhanh, cô lập | giòn, không bắt được lỗi thật |
| Nhiều unit test | phản hồi nhanh | bỏ sót lỗi tích hợp |
| Nhiều integration test | tin cậy hơn | chậm hơn, cần hạ tầng |
| Nhiều E2E | gần người dùng | chậm, giòn, khó debug |
| DB thật | kiểm chứng thật | cần container, chậm hơn |
| Mock DB | rất nhanh | kiểm chứng mock của chính mình |
| Mục tiêu coverage | dễ đo | khuyến khích test rác |
| Không đo coverage | không bị bóp méo | không thấy vùng trống |
| Xoá test flaky | bộ test đáng tin | mất phần bảo vệ nó từng có |

## Explain Without Notes

1. Câu hỏi một-dòng để phân biệt test hành vi với test cấu trúc?
2. Vì sao test theo cấu trúc "hỏng sai lúc và im lặng sai lúc"?
3. Kim tự tháp test thật sự nói về điều gì?
4. Ranh giới nào nên mock, ranh giới nào không, và vì sao?
5. Coverage đo gì? Dùng nó đúng cách là dùng thế nào?
6. Bốn câu hỏi để tìm test đáng viết, và hai câu nào hay bị bỏ?
7. Vì sao một test flaky làm hỏng cả bộ test 2000 test?
8. Vì sao tên test quan trọng hơn cảm giác ban đầu?

## Related

- [Unit vs integration](02-unit-vs-integration.md) — chọn tầng cho từng kiểm chứng
- [API & E2E tests](03-api-e2e-tests.md) — test từ ngoài vào
- [Mocking & test doubles](04-mocking-test-doubles.md) — mock ở đâu và bằng gì
- [Testcontainers](05-testcontainers.md) — DB thật trong test
- [Deterministic tests](06-deterministic-tests.md) — chống flaky
- [Contract testing](07-contract-testing.md) — ranh giới giữa các service
- [Testing NestJS](../../02-backend-api/02-nestjs/09-testing-nestjs.md) — cài đặt cụ thể
- [Access control](../security/04-access-control.md) — test đường từ chối
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — nơi test chạy

## Version / Context

Ví dụ dùng Jest/Vitest với NestJS 10/11 và Prisma; nguyên tắc không phụ thuộc công cụ. Mutation testing: Stryker. Thuật ngữ "test pyramid" từ Mike Cohn; "test theo hành vi" gần với cách dùng của Kent Beck và Ian Cooper — đơn vị test là **hành vi**, không phải class.
