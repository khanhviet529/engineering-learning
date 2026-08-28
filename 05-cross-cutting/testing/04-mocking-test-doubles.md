---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-testing-pyramid-behavior.md
related:
  - 05-testcontainers.md
  - 07-contract-testing.md
---

# Mocking & test doubles

> Một service gửi email dùng mock trong toàn bộ test. Test kiểm chứng `mailer.send` được gọi với đúng tham số. Trong production, email không bao giờ tới: tham số thứ hai của thư viện là `options`, không phải `body` — API đã đổi ở phiên bản trước và không ai để ý. **Mock luôn khớp với thứ bạn nghĩ API trông như thế nào, không phải với API thật.**

## Position

```text
Test double = thứ thay thế một dependency thật trong test

Câu hỏi thứ tự:
  ① CÓ CẦN thay thế không?     ← câu quan trọng nhất, hay bị bỏ qua
  ② Thay ở RANH GIỚI nào?
  ③ Dùng LOẠI double nào?
```

## Problem

```text
Mock giải quyết: dependency chậm, tốn tiền, không xác định, có tác dụng phụ thật.

Mock TẠO RA: một bản sao của thực tế mà bạn tự viết
             → nó có thể sai, và khi nó sai, test vẫn xanh.

⇒ Mỗi mock là một GIẢ ĐỊNH chưa được kiểm chứng về thế giới bên ngoài.
```

Số lượng mock trong bộ test tỉ lệ thuận với lượng "sự thật chưa kiểm chứng" mà bạn đang dựa vào.

## Mental Model

### Năm loại double — chúng không tương đương nhau

```text
DUMMY   chỉ để lấp chỗ tham số, không bao giờ được dùng
STUB    trả về giá trị định sẵn                → trạng thái
SPY     bản thật + ghi lại lời gọi
MOCK    được lập trình sẵn KỲ VỌNG về lời gọi  → tương tác
FAKE    cài đặt THẬT nhưng đơn giản hoá        → hành vi
```

Khác biệt quan trọng nhất nằm giữa hai nhóm cuối:

```text
MOCK  kiểm chứng "hàm X được gọi với tham số Y"
      → gắn với CÁCH LÀM
      → hỏng khi refactor, im lặng khi logic sai

FAKE  cài đặt thật thu nhỏ (in-memory repository, gateway giả)
      → kiểm chứng KẾT QUẢ
      → sống sót qua refactor
```

Trong hầu hết trường hợp bạn định dùng mock, **fake là lựa chọn tốt hơn**.

### Fake tốt hơn mock: một ví dụ cụ thể

```ts
// ✗ MOCK — kiểm chứng lời gọi
const mailer = { send: jest.fn() };
await service.notifyOrderPlaced(order);
expect(mailer.send).toHaveBeenCalledWith('a@b.com', 'Đơn hàng đã đặt', expect.any(String));
```

```text
Test này pass kể cả khi:
  · gọi hai lần (gửi trùng)     · gửi sai người khi có nhiều người nhận
  · nội dung email rỗng          · chữ ký của thư viện đã đổi ← sự cố ở đầu note
```

```ts
// ✓ FAKE — cài đặt thật thu nhỏ, kiểm chứng kết quả
export class FakeMailer implements Mailer {
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];

  async send(msg: { to: string; subject: string; body: string }) {
    if (!msg.to.includes('@')) throw new Error('địa chỉ không hợp lệ');   // ràng buộc THẬT
    this.sent.push(msg);
  }
}

// test
await service.notifyOrderPlaced(order);
expect(mailer.sent).toHaveLength(1);
expect(mailer.sent[0].to).toBe('a@b.com');
expect(mailer.sent[0].body).toContain(order.number);
```

Fake bắt được cả bốn trường hợp mock bỏ lọt, và nó dùng lại được ở mọi test thay vì cấu hình lại mỗi lần.

### Ranh giới nào được phép thay thế

```text
✓ RANH GIỚI TIẾN TRÌNH — thứ nằm NGOÀI process của bạn và bạn không kiểm soát
  · API bên thứ ba (thanh toán, email, SMS, bản đồ)
  · đồng hồ, random, uuid, biến môi trường
  · hệ thống file (đôi khi)

✗ RANH GIỚI TẦNG — thứ nằm TRONG ứng dụng của bạn
  · repository → dùng DB thật
  · service khác cùng ứng dụng → gọi thật
  · ORM, framework HTTP → dùng thật

~ TUỲ NGỮ CẢNH
  · database → thật trong integration test, không có trong unit test
  · Redis → thật (container) hoặc fake in-memory
  · service nội bộ KHÁC (microservice) → contract test, không mock tay
```

Quy tắc rút gọn: **mock thứ bạn không sở hữu, dùng thật thứ bạn sở hữu** — nhưng với thứ bạn không sở hữu, hãy mock **lớp bao của bạn quanh nó**, không mock trực tiếp thư viện.

### Lớp bao (adapter) là điều kiện để mock an toàn

```ts
// ✗ mock trực tiếp thư viện bên thứ ba
jest.mock('stripe');
// → mock của bạn khớp với API bạn TƯỞNG, không phải API thật

// ✓ định nghĩa cổng của RIÊNG BẠN, mock/fake cổng đó
export interface PaymentGateway {
  charge(input: { amountCents: number; currency: string; token: string }): Promise<ChargeResult>;
}

// một cài đặt thật (được kiểm chứng riêng bằng contract test hoặc test có gắn nhãn)
export class StripeGateway implements PaymentGateway { /* ... */ }

// một fake dùng trong mọi test khác
export class FakePaymentGateway implements PaymentGateway {
  readonly charges: ChargeInput[] = [];
  private nextFailure?: string;
  failNext(code: string) { this.nextFailure = code; }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    this.charges.push(input);
    if (this.nextFailure) {
      const code = this.nextFailure; this.nextFailure = undefined;
      return { ok: false, code };
    }
    return { ok: true, id: `ch_${this.charges.length}` };
  }
}
```

Lợi ích thật của adapter không phải là "kiến trúc sạch" — nó là: **chỉ có một chỗ duy nhất trong codebase tiếp xúc với API thật**, nên chỉ một chỗ cần được kiểm chứng với thực tế.

### Vấn đề trung tâm: mock trôi khỏi thực tế

```text
Mock được viết một lần, dựa trên hiểu biết tại thời điểm đó.
API thật thay đổi:
  · thêm trường bắt buộc      · đổi tên trường
  · đổi kiểu (string → object) · đổi mã lỗi
  · thêm rate limit            · đổi hành vi khi lỗi

Mock KHÔNG BIẾT. Test vẫn xanh. Production hỏng.
```

Ba cách giảm nhẹ, theo thứ tự hiệu quả:

```text
① CONTRACT TEST với nhà cung cấp   → 07-contract-testing.md
② TEST TÍCH HỢP THẬT có gắn nhãn, chạy theo lịch (không chạy trên mỗi PR)
   → dùng sandbox của nhà cung cấp; đỏ ở đây = API đã đổi
③ KIỂM TRA KIỂU TỪ SCHEMA CỦA HỌ (OpenAPI → type) thay vì gõ tay interface
```

Không có cách nào trong ba cách trên là miễn phí, nhưng ít nhất một trong số chúng là cần thiết cho dependency quan trọng.

### Thời gian và ngẫu nhiên: tiêm vào, đừng mock toàn cục

```ts
// ✗ mock toàn cục — ảnh hưởng mọi thứ, kể cả thư viện bên trong
jest.useFakeTimers().setSystemTime(new Date('2026-01-01'));

// ✓ tiêm phụ thuộc — tường minh và cục bộ
export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };

class TokenService {
  constructor(private readonly clock: Clock) {}
  isExpired(t: Token) { return t.expiresAt < this.clock.now(); }
}

// test
const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
expect(new TokenService(clock).isExpired(token)).toBe(true);
```

Fake timer vẫn hữu ích cho việc **tua nhanh** (test retry với backoff, debounce), nhưng cho "hiện tại là lúc nào", tiêm đồng hồ rõ ràng hơn và không gây tác dụng phụ ngoài ý muốn. Xem [Deterministic tests](06-deterministic-tests.md).

### Mock HTTP ở tầng mạng

Khi không tránh được việc gọi HTTP thật trong code:

```ts
// msw — chặn ở tầng mạng, code KHÔNG cần biết mình đang bị test
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('https://api.stripe.com/v1/charges', async ({ request }) => {
    const body = await request.formData();
    if (body.get('amount') === '0') {
      return HttpResponse.json({ error: { code: 'amount_too_small' } }, { status: 400 });
    }
    return HttpResponse.json({ id: 'ch_1', status: 'succeeded' });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));   // ← quan trọng
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` là dòng đáng chú ý: nó biến "test lỡ gọi ra mạng thật" từ một lỗi im lặng thành một test đỏ.

Ưu điểm so với mock thư viện: nó kiểm chứng **request thật sự được gửi** (URL, method, body, header) — tức là kiểm chứng cả lớp adapter của bạn.

## Example

Cùng một hành vi — retry khi cổng thanh toán tạm lỗi — với hai cách tiếp cận:

```ts
// ✗ mock: khoá chặt số lần gọi và thứ tự
const gateway = { charge: jest.fn()
  .mockRejectedValueOnce(new Error('503'))
  .mockResolvedValueOnce({ ok: true }) };

await service.pay(order);
expect(gateway.charge).toHaveBeenCalledTimes(2);
// nếu bạn đổi từ 3 lần retry sang backoff khác → test đỏ, dù hành vi vẫn đúng
```

```ts
// ✓ fake: mô tả hành vi của thế giới, kiểm chứng KẾT QUẢ
class FlakyGateway implements PaymentGateway {
  constructor(private failFirst: number) {}
  attempts = 0;
  async charge(input: ChargeInput) {
    this.attempts++;
    if (this.attempts <= this.failFirst) throw new ServiceUnavailableError();
    return { ok: true as const, id: 'ch_1' };
  }
}

it('thanh toán thành công dù cổng lỗi tạm hai lần', async () => {
  const gateway = new FlakyGateway(2);
  const service = new PaymentService(gateway, { maxRetries: 3, clock: fakeClock });

  const result = await service.pay(order);

  expect(result.status).toBe('paid');
  expect(gateway.attempts).toBeLessThanOrEqual(3);        // giới hạn, không phải con số chính xác
});

it('KHÔNG tính tiền hai lần khi retry', async () => {
  const gateway = new FlakyGateway(1);
  await service.pay(order);

  const charges = await db.charge.findMany({ where: { orderId: order.id } });
  expect(charges).toHaveLength(1);                         // hành vi QUAN TRỌNG NHẤT
});

it('dừng sau khi hết số lần thử và giữ đơn ở trạng thái failed', async () => {
  const gateway = new FlakyGateway(99);
  await expect(service.pay(order)).rejects.toThrow();

  const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(updated.status).toBe('payment_failed');
  expect(gateway.attempts).toBe(3);                        // ở đây con số CÓ nghĩa: giới hạn
});
```

Điểm khác biệt: fake mô tả **cổng thanh toán cư xử thế nào**, và test kiểm chứng **hệ thống phản ứng ra sao**. Bạn đổi chiến lược retry, hai test đầu vẫn đúng.

## Prediction

1. Mock `mailer.send` kiểm tra tham số, thư viện đổi chữ ký ở bản mới — test có đỏ không?
2. Fake implement interface của bạn, adapter chưa cập nhật — test có đỏ không?
3. Mock repository, code quên `await` — test có bắt được không?
4. DB thật — có bắt được không?
5. `expect(fn).toHaveBeenCalledTimes(2)` cho retry, bạn đổi từ 2 sang 3 lần thử — test thế nào?
6. Kiểm chứng "chỉ một charge trong DB" — cùng thay đổi?
7. Test lỡ gọi API thật, msw không có `onUnhandledRequest: 'error'` — chuyện gì xảy ra?
8. Có cấu hình đó — chuyện gì xảy ra?
9. `jest.useFakeTimers()` toàn cục, một thư viện bên trong dùng `setInterval` — hậu quả?
10. Tiêm `Clock` — hậu quả?
11. Mock trực tiếp `stripe` package, Stripe thêm trường bắt buộc — bao giờ bạn biết?
12. Có contract test hoặc integration test theo lịch — bao giờ bạn biết?
13. Một file test có 8 mock — nó nói gì về thiết kế của code?

<details>
<summary>Đáp án</summary>

1. **Không** — mock khớp với API bạn *nghĩ*, không phải API thật.
2. **Có** — TypeScript báo lỗi kiểu khi adapter không còn khớp interface.
3. Thường **không**.
4. **Có** — dữ liệu chưa có khi đọc lại.
5. **Đỏ**, dù hành vi vẫn đúng.
6. **Vẫn xanh** — nó kiểm chứng điều thật sự quan trọng.
7. Test **gọi ra mạng thật** — chậm, không xác định, có thể tốn tiền.
8. Test **đỏ ngay** với thông báo rõ ràng.
9. Thư viện đó **treo hoặc cư xử lạ** — nguồn flaky khó tìm.
10. Chỉ đoạn code bạn kiểm chứng bị ảnh hưởng.
11. **Ở production.**
12. Khi contract test chạy — trước khi tới production.
13. Code **kết dính chặt** với quá nhiều thứ; nó là phản hồi về thiết kế.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi tên một method nội bộ | Bao nhiêu mock phải sửa? |
| Đổi số lần retry | Test nào đỏ? Chúng có nên đỏ không? |
| Sửa adapter thật cho khác interface | TypeScript có bắt không? |
| Chạy test với `onUnhandledRequest: 'error'` | Có test nào gọi ra mạng thật? |
| Đếm `jest.fn()` trong một file | Nhiều hơn 3 = nghi ngờ thiết kế |
| Thay một mock bằng fake | Test có bắt được nhiều hơn không? |
| Xoá một assert `toHaveBeenCalled` | Test còn kiểm chứng gì không? |
| Chạy integration test thật với sandbox nhà cung cấp | Mock có còn khớp không? |
| `jest.useFakeTimers()` rồi chạy test có `await` promise ngoài | Có treo không? |
| Grep `jest.mock('` với package bên thứ ba | Danh sách mock rủi ro cao |

## What Usually Goes Wrong

- **Mock repository và service nội bộ** → khoá chặt cấu trúc, kiểm chứng chính mock.
- **Mock trực tiếp thư viện bên thứ ba** → mock trôi khỏi API thật.
- **Không có adapter** → hàng chục chỗ tiếp xúc với API ngoài.
- **Kiểm chứng lời gọi thay vì kết quả.**
- **Mock không bao giờ được đối chiếu với thực tế** — không contract test, không integration test theo lịch.
- **Fake quá đơn giản** — không có ràng buộc nào, chấp nhận mọi thứ.
- **Fake quá phức tạp** — trở thành phần mềm thứ hai cần bảo trì và tự nó có bug.
- **`jest.useFakeTimers()` toàn cục** gây tác dụng phụ khó tìm.
- **Không chặn request ra mạng** trong test.
- **Mock rải rác trong từng test** thay vì một fake dùng chung.
- **Quên reset mock giữa các test** → test phụ thuộc thứ tự.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Mock mọi dependency là thực hành tốt | Nó biến test thành mô tả cấu trúc |
| Mock và fake là hai tên của một thứ | Mock kiểm chứng tương tác; fake là cài đặt thật thu nhỏ |
| Mock làm test nhanh hơn nên tốt hơn | Nó cũng kiểm chứng ít hơn |
| Mock ở đâu cũng như nhau | Ranh giới tiến trình khác hẳn ranh giới tầng |
| `toHaveBeenCalledWith` là assert mạnh | Nó chỉ khẳng định về code của bạn, không về thế giới |
| Mock thư viện là cách cô lập | Nó tạo giả định chưa kiểm chứng về thư viện đó |
| Fake tốn công viết | Một fake dùng lại ở hàng trăm test |
| Fake tốt là fake đầy đủ | Fake tốt là fake giữ đúng **ràng buộc quan trọng** |
| Fake timer là cách đúng để kiểm soát thời gian | Tiêm đồng hồ rõ ràng hơn cho "bây giờ là lúc nào" |
| Nhiều mock trong file là bình thường | Nó là chỉ báo kết dính chặt |

## Debugging

1. **Test xanh nhưng production hỏng ở dependency ngoài** → mock đã trôi. Kiểm chứng adapter với API thật một lần, thủ công nếu cần.
2. **Test đỏ sau refactor không đổi hành vi** → tìm assert kiểu `toHaveBeenCalled`; chúng là nguồn.
3. **Test treo** → fake timer bật mà có promise thật đang chờ; hoặc fake không resolve.
4. **Test phụ thuộc thứ tự** → mock chưa được reset (`restoreMocks: true` trong cấu hình).
5. **Không biết test có gọi mạng không** → bật `onUnhandledRequest: 'error'` hoặc chạy với mạng bị chặn.
6. **Fake và thật khác nhau** → viết một bộ test **dùng chung** chạy trên cả hai cài đặt (contract test nội bộ) — đây là cách rẻ nhất giữ chúng đồng bộ.
7. **Quá nhiều mock để dựng một test** → dấu hiệu cần tách logic thuần ra khỏi I/O.

## Production Considerations

- **Adapter cho mọi dependency ngoài**; chỉ một chỗ tiếp xúc API thật.
- **Fake thay vì mock** cho các dependency được dùng ở nhiều test.
- **Chỉ thay thế ở ranh giới tiến trình**; dùng thật cho thứ bạn sở hữu.
- **Fake giữ ràng buộc quan trọng** (validate đầu vào, giới hạn, mã lỗi) — nếu không, nó nói dối.
- **Bộ test dùng chung cho fake và cài đặt thật** để chúng không trôi khỏi nhau.
- **Contract test hoặc integration test theo lịch** cho dependency quan trọng.
- **Sinh kiểu từ schema của nhà cung cấp** thay vì gõ tay khi có OpenAPI.
- **Chặn mọi request ra mạng** trong test và làm nó thành lỗi.
- **Tiêm `Clock`, `Random`, `IdGenerator`** thay vì mock toàn cục.
- **`restoreMocks: true`** để mock không rò rỉ giữa các test.
- **Đặt fake cùng chỗ với interface** (`payment/payment.gateway.ts`, `payment/payment.gateway.fake.ts`) để chúng được cập nhật cùng nhau.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Mock | viết nhanh, cô lập tuyệt đối | giòn, kiểm chứng cấu trúc |
| Fake | bền, dùng lại được | tốn công viết ban đầu |
| Dùng thật (container) | kiểm chứng thật nhất | chậm hơn, cần hạ tầng |
| Adapter | một chỗ tiếp xúc, dễ thay | thêm một lớp gián tiếp |
| Không adapter | ít code | mock trôi, khó đổi nhà cung cấp |
| msw (chặn tầng mạng) | kiểm chứng cả request thật | thêm công cụ, cấu hình riêng |
| Contract test | phát hiện trôi | cần nhà cung cấp hợp tác hoặc schema |
| Integration test theo lịch | phát hiện trôi, đơn giản | chậm, cần credential sandbox |
| Fake timer | tua nhanh được | tác dụng phụ toàn cục |
| Tiêm Clock | tường minh, cục bộ | phải truyền qua constructor |

## Explain Without Notes

1. Năm loại test double và khác biệt quan trọng nhất giữa mock và fake?
2. Ranh giới nào được phép thay thế, ranh giới nào không, và vì sao?
3. "Mock trôi khỏi thực tế" nghĩa là gì và ba cách giảm nhẹ?
4. Vì sao adapter là điều kiện để mock an toàn?
5. Vì sao `toHaveBeenCalledTimes` cho retry là assert kém?
6. Fake tốt giữ lại điều gì và bỏ đi điều gì?
7. Vì sao tiêm `Clock` tốt hơn fake timer toàn cục cho "bây giờ là lúc nào"?
8. Tám mock trong một file test nói gì về code?

## Related

- [Test theo behavior](01-testing-pyramid-behavior.md) — vì sao kiểm chứng kết quả, không kiểm chứng lời gọi
- [Unit vs integration](02-unit-vs-integration.md) — khi nào dùng thật thay vì thay thế
- [Testcontainers](05-testcontainers.md) — dùng thật cho hạ tầng
- [Deterministic tests](06-deterministic-tests.md) — thời gian, ngẫu nhiên, thứ tự
- [Contract testing](07-contract-testing.md) — chống mock trôi giữa các service
- [Testing NestJS](../../02-backend-api/02-nestjs/09-testing-nestjs.md) — `overrideProvider`
- [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md) — hành vi cần fake để test

## Version / Context

Ví dụ dùng Jest/Vitest và msw v2 (`http`/`HttpResponse`; v1 dùng `rest`/`res(ctx...)`). Thuật ngữ năm loại double theo Gerard Meszaros (*xUnit Test Patterns*); phân biệt "mock thứ bạn không sở hữu" theo Steve Freeman và Nat Pryce.
