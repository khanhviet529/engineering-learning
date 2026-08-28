---
level: advanced
area: cross-cutting
prerequisites:
  - 04-mocking-test-doubles.md
related:
  - 03-api-e2e-tests.md
  - ../../06-system-design/08-monolith-to-microservices.md
---

# Contract testing

> Team A đổi trường `total` từ số nguyên (xu) sang chuỗi có định dạng tiền tệ. Test của họ xanh — họ đã cập nhật hết. Test của team B cũng xanh — mock của B vẫn trả về số nguyên như hai năm trước. Sự cố xuất hiện ở production, ba giờ sau khi deploy, khi một báo cáo hiển thị `NaN`. **Cả hai bộ test đều đúng với thế giới mà chúng tin là có thật.**

## Position

```text
Unit / integration  kiểm chứng MỘT service
E2E                 kiểm chứng TẤT CẢ cùng lúc — chậm, giòn, cần mọi thứ chạy
Contract test       kiểm chứng RANH GIỚI giữa hai service — mỗi bên chạy độc lập
                    ↑ chỗ trống mà hai loại kia không lấp
```

## Problem

```text
Khi hai service giao tiếp, mỗi bên có một GIẢ ĐỊNH về bên kia:
  Consumer: "provider trả về hình dạng X"
  Provider: "consumer cần hình dạng Y"

Không có gì kiểm chứng X == Y.

Mock của consumer đóng băng X tại thời điểm viết.
Provider tiến hoá tự do.
⇒ hai bên trôi khỏi nhau, và không test nào đỏ.
```

Hai giải pháp thông thường đều có vấn đề:

```text
E2E với mọi service chạy cùng lúc
  − chậm, cần hạ tầng đầy đủ, khó chạy trên PR
  − N service thì cần N môi trường đồng bộ

Tài liệu / OpenAPI viết tay
  − không được thực thi → nó mô tả ý định, không mô tả thực tế
```

## Mental Model

### Contract test đảo ngược hướng phụ thuộc

```text
Cách thông thường:
  Consumer viết mock  →  hy vọng provider khớp

Contract test:
  Consumer viết KỲ VỌNG  →  sinh ra CONTRACT
                          →  provider CHẠY contract đó với code THẬT
                          →  provider đỏ nếu vi phạm
```

Điểm mấu chốt: **provider phát hiện việc phá vỡ consumer, trước khi deploy** — và cả hai bên vẫn chạy test độc lập, không cần môi trường chung.

### Consumer-driven: contract mô tả CÁI ĐANG ĐƯỢC DÙNG

```text
Consumer khai báo: "tôi gọi GET /orders/123 và tôi cần trường id, total (số), status"
                   ↑ CHỈ những trường nó THẬT SỰ dùng

Provider verify:   chạy contract đó với code thật
                   → nếu `total` đổi thành chuỗi → ĐỎ ở phía provider
                   → nếu provider thêm trường mới → VẪN XANH (consumer không quan tâm)
```

Tính chất cuối cùng là điều làm contract test dùng được trong thực tế: nó cho phép provider tiến hoá, chỉ chặn những thay đổi **thực sự phá vỡ ai đó**.

```text
Hệ quả: contract chỉ bảo vệ thứ có ÍT NHẤT MỘT consumer dùng.
        Trường không ai dùng → xoá được an toàn.
        Đây vừa là sức mạnh vừa là giới hạn.
```

### Contract kiểm chứng gì và không kiểm chứng gì

```text
✓ hình dạng và KIỂU của request/response
✓ mã trạng thái
✓ header quan trọng
✓ hành vi lỗi (404, 422 trông như thế nào)

✗ ngữ nghĩa: "total có đúng bằng tổng các dòng không"
✗ hiệu năng
✗ hành vi khi có tải
```

Contract test trả lời **"chúng ta có nói cùng một ngôn ngữ không"**, không trả lời **"câu trả lời có đúng không"**. Câu thứ hai vẫn là việc của test ở mỗi bên.

### Luồng đầy đủ

```text
① CONSUMER viết test với mock server do công cụ dựng
     → mock CHỈ trả về đúng thứ contract mô tả
     → nếu consumer dùng trường không khai báo → test consumer ĐỎ ngay
② sinh file contract (pact) và publish lên broker
③ PROVIDER lấy contract, chạy với code thật
     → dựng trạng thái cần thiết qua "provider state"
④ kết quả verify được publish ngược lại
⑤ TRƯỚC KHI DEPLOY: hỏi broker "phiên bản này an toàn để deploy chưa?"
     → can-i-deploy: mọi cặp consumer/provider ở môi trường đích đã verify chưa
```

Bước ⑤ là thứ biến contract test từ một bộ test thành một **cổng deploy**. Không có nó, contract test chỉ là cảnh báo dễ bỏ qua.

### Provider state: phần khó nhất

```text
Contract nói: "khi có đơn hàng 123, GET /orders/123 trả về ..."
                    ↑ provider state

Provider phải dựng được trạng thái đó trước khi chạy từng tương tác.
```

```ts
// phía provider
stateHandlers: {
  'có đơn hàng 123 đã thanh toán': async () => {
    await db.order.create({ data: { id: '123', status: 'paid', totalCents: 5_000 } });
  },
  'không có đơn hàng 999': async () => {
    await db.order.deleteMany({ where: { id: '999' } });
  },
}
```

```text
State phải:
  · ĐỘC LẬP với nhau (chạy theo thứ tự bất kỳ)
  · dọn sạch sau mỗi tương tác
  · dùng đường ngắn nhất (seed trực tiếp), không đi qua UI hay chuỗi API dài
```

State quá cụ thể (`"đơn hàng 123 của user 45 trong tenant 7 với 3 dòng"`) khiến contract khó bảo trì. State nên diễn đạt **điều kiện tối thiểu** cho tương tác đó.

### Matcher: đừng khớp giá trị cụ thể

```ts
// ✗ khớp giá trị chính xác — provider phải trả về ĐÚNG dữ liệu này
body: { id: '123', total: 5000, status: 'paid', createdAt: '2026-01-15T10:00:00Z' }

// ✓ khớp KIỂU và định dạng
body: {
  id: like('123'),
  total: integer(5000),                    // phải là số nguyên; giá trị nào cũng được
  status: term({ matcher: 'paid|pending|cancelled', generate: 'paid' }),
  createdAt: iso8601DateTime(),
  items: eachLike({ sku: like('A-1'), qty: integer(1) }, { min: 1 }),
}
```

Contract khớp giá trị cụ thể biến provider verification thành bài toán tái tạo dữ liệu chính xác — nguyên nhân phổ biến nhất khiến đội ngũ bỏ contract test.

### Khi nào contract test đáng dùng

```text
✓ nhiều service do các team KHÁC NHAU sở hữu
✓ triển khai độc lập (không deploy đồng thời)
✓ E2E đã trở nên quá chậm hoặc quá giòn
✓ mobile app dùng API mà bạn không kiểm soát lịch cập nhật của client

✗ monolith — dùng test tích hợp bình thường, rẻ hơn nhiều
✗ hai service cùng team, cùng repo, deploy cùng nhau  → dùng test chung
✗ API công khai với consumer KHÔNG XÁC ĐỊNH
    → consumer-driven không áp dụng được (bạn không biết ai dùng gì)
    → dùng OpenAPI + schema validation + versioning + deprecation policy
```

Trường hợp cuối đáng nhấn mạnh: contract test cần **biết consumer là ai**. Với API công khai, công cụ đúng là schema và chính sách phiên bản.

### Contract cho message queue

```text
Ranh giới bất đồng bộ cũng có contract, và nó còn hay bị bỏ hơn HTTP:

Producer  "tôi phát event OrderPlaced với hình dạng X"
Consumer  "tôi cần trường a, b, c"

→ cùng cơ chế: consumer khai báo, producer verify
→ đặc biệt giá trị vì lỗi ở đây IM LẶNG:
  consumer nhận message sai hình dạng và bỏ qua nó, không ai thấy gì
```

Với queue, một schema registry (Avro/Protobuf/JSON Schema) kèm quy tắc tương thích là lựa chọn thay thế phổ biến và thường đơn giản hơn.

### Lựa chọn nhẹ hơn

Nếu contract test đầy đủ là quá nặng cho quy mô hiện tại:

```text
① SCHEMA CHUNG được publish
   provider sinh OpenAPI/JSON Schema từ CODE (không viết tay)
   consumer validate response THẬT với schema đó trong test của mình
   + rẻ, không cần broker
   − không phát hiện được "consumer cần trường mà provider sắp xoá"

② KIỂM TRA TƯƠNG THÍCH SCHEMA trong CI
   so schema mới với schema cũ; chặn thay đổi phá vỡ
   + tự động, không cần consumer hợp tác
   − không biết ai thật sự dùng gì

③ SINH KIỂU TỪ SCHEMA CỦA PROVIDER
   consumer sinh TypeScript type từ OpenAPI của provider
   + compile error khi provider đổi → phát hiện lúc build
   − chỉ khi consumer chủ động cập nhật schema
```

Cách ① + ② lấp được phần lớn khoảng trống với chi phí thấp hơn nhiều, và là điểm khởi đầu hợp lý.

## Example

Phía consumer — khai báo đúng thứ mình dùng:

```ts
// consumer/order-client.pact.spec.ts
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
const { like, integer, eachLike, term } = MatchersV3;

const provider = new PactV3({ consumer: 'reporting-service', provider: 'order-service' });

describe('OrderClient', () => {
  it('lấy chi tiết đơn hàng đã thanh toán', async () => {
    provider
      .given('có đơn hàng 123 đã thanh toán')          // provider state
      .uponReceiving('yêu cầu chi tiết đơn hàng 123')
      .withRequest({ method: 'GET', path: '/orders/123', headers: { Accept: 'application/json' } })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: like('123'),
          totalCents: integer(5_000),                   // ← KIỂU là thứ được bảo vệ
          status: term({ matcher: 'paid|pending|cancelled', generate: 'paid' }),
          items: eachLike({ sku: like('A-1'), qty: integer(1) }, { min: 1 }),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const client = new OrderClient(mockServer.url);
      const order = await client.getOrder('123');

      // dùng ĐÚNG những gì đã khai báo — nếu client đọc trường khác, mock không có nó
      expect(order.totalCents).toBe(5_000);
      expect(order.items).toHaveLength(1);
    });
  });

  it('trả về null khi đơn hàng không tồn tại', async () => {
    provider
      .given('không có đơn hàng 999')
      .uponReceiving('yêu cầu chi tiết đơn hàng 999')
      .withRequest({ method: 'GET', path: '/orders/999' })
      .willRespondWith({ status: 404 });

    await provider.executeTest(async (mockServer) => {
      expect(await new OrderClient(mockServer.url).getOrder('999')).toBeNull();
    });
  });
});
```

Test thứ hai đáng chú ý: **đường lỗi cũng là một phần của contract**. Nếu provider đổi 404 thành 200 với body rỗng, consumer sẽ hỏng — và contract này bắt được.

Phía provider — verify với code thật:

```ts
// provider/pact-verify.spec.ts
import { Verifier } from '@pact-foundation/pact';

it('thoả mãn contract của mọi consumer', async () => {
  await new Verifier({
    provider: 'order-service',
    providerBaseUrl: `http://localhost:${port}`,        // app THẬT đang chạy
    pactBrokerUrl: process.env.PACT_BROKER_URL,
    consumerVersionSelectors: [
      { mainBranch: true },                              // contract từ nhánh chính
      { deployedOrReleased: true },                      // và từ thứ đang chạy production
    ],
    providerVersion: process.env.GIT_SHA,
    providerVersionBranch: process.env.GIT_BRANCH,
    publishVerificationResult: !!process.env.CI,
    stateHandlers: {
      'có đơn hàng 123 đã thanh toán': async () => {
        await db.order.create({ data: { id: '123', status: 'paid', totalCents: 5_000, items: { create: [{ sku: 'A-1', qty: 1 }] } } });
      },
      'không có đơn hàng 999': async () => {
        await db.order.deleteMany({ where: { id: '999' } });
      },
    },
  }).verifyProvider();
});
```

`deployedOrReleased` là bộ chọn quan trọng nhất: nó bảo đảm provider vẫn tương thích với phiên bản consumer **đang chạy production**, không chỉ với phiên bản mới nhất trên nhánh chính.

Và cổng deploy:

```bash
pact-broker can-i-deploy \
  --pacticipant order-service --version "$GIT_SHA" \
  --to-environment production
# thoát khác 0 → CI dừng, không deploy
```

## Prediction

1. Provider đổi `total` từ số nguyên sang chuỗi, consumer dùng mock cũ — test hai bên thế nào?
2. Có contract test — test bên nào đỏ?
3. Provider **thêm** một trường mới — contract test có đỏ không?
4. Provider **xoá** một trường mà không consumer nào khai báo — có đỏ không?
5. Provider xoá một trường mà một consumer khai báo — có đỏ không?
6. Contract khớp giá trị chính xác `total: 5000`, provider trả 5001 trong môi trường verify — kết quả?
7. Dùng `integer(5000)` — kết quả?
8. Consumer đọc một trường không khai báo trong contract — test consumer thế nào?
9. Không có `can-i-deploy`, contract verify đỏ nhưng deploy vẫn chạy — hậu quả?
10. Contract chỉ chọn `mainBranch`, production đang chạy consumer phiên bản cũ hơn — rủi ro gì?
11. API công khai với hàng nghìn consumer không xác định — consumer-driven contract có dùng được không?
12. Event `OrderPlaced` đổi hình dạng, consumer bỏ qua message sai — bao giờ ai đó biết?
13. Provider state dựng dữ liệu qua chuỗi 5 API call — điều gì dễ hỏng?

<details>
<summary>Đáp án</summary>

1. **Cả hai xanh** — và production hỏng.
2. **Provider đỏ** — nó phá vỡ contract của consumer.
3. **Không** — consumer không quan tâm trường thừa.
4. **Không** — không ai dùng nó.
5. **Có** — đúng mục đích của contract test.
6. **Đỏ** — vì lý do không liên quan tới tương thích.
7. **Xanh** — kiểu mới là thứ được bảo vệ.
8. **Đỏ ngay ở consumer** — mock không có trường đó.
9. Deploy phá vỡ consumer; contract test **chỉ là cảnh báo bị bỏ qua**.
10. Provider có thể phá vỡ **phiên bản consumer đang chạy production**.
11. **Không** — bạn không biết ai dùng gì; dùng schema + versioning.
12. Có thể **rất lâu** — lỗi im lặng, không có mã trạng thái nào để báo.
13. Chậm, giòn, và **phụ thuộc chính API đang được verify**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi kiểu một trường ở provider | Contract verify có đỏ không? |
| Thêm một trường mới ở provider | Có đỏ không? (không nên) |
| Xoá một trường consumer dùng | Có đỏ không? (nên) |
| Consumer đọc trường không khai báo | Test consumer có đỏ không? |
| Đổi 404 thành 200 body rỗng | Contract có bắt được không? |
| Đổi giá trị dữ liệu trong provider state | Contract dùng matcher có đỏ không? |
| Bỏ `can-i-deploy` và deploy bản vi phạm | Có gì chặn không? |
| Chạy provider verify với consumer version cũ | Còn tương thích không? |
| Xoá một state handler | Verify báo lỗi gì? |
| Chạy hai state handler theo thứ tự ngược | Chúng có độc lập không? |

## What Usually Goes Wrong

- **Khớp giá trị chính xác** thay vì matcher kiểu → verify đỏ vì lý do sai.
- **Provider state quá cụ thể** hoặc phụ thuộc lẫn nhau.
- **State dựng qua chuỗi API dài** → chậm và giòn.
- **Không có `can-i-deploy`** → contract test thành cảnh báo bị bỏ qua.
- **Chỉ chọn `mainBranch`** → phá vỡ consumer đang chạy production.
- **Contract khai báo mọi trường** thay vì chỉ trường được dùng → mất tính linh hoạt.
- **Dùng contract test cho monolith** → phức tạp không cần thiết.
- **Dùng consumer-driven cho API công khai** → không áp dụng được.
- **Bỏ contract cho message queue** — nơi lỗi im lặng nhất.
- **Contract không được cập nhật khi consumer đổi** → verify xanh nhưng vô nghĩa.
- **Coi contract test là thay thế cho test tích hợp** — nó chỉ kiểm chứng hình dạng.
- **Không ai sở hữu broker** → nó cũ đi và không ai tin nữa.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Contract test thay được E2E | Nó chỉ kiểm chứng ranh giới, không kiểm chứng luồng |
| Contract test kiểm chứng logic nghiệp vụ | Nó kiểm chứng hình dạng và kiểu |
| Provider định nghĩa contract | Consumer-driven: consumer định nghĩa |
| Thêm trường mới phá vỡ contract | Không — chỉ xoá/đổi thứ đang được dùng |
| Contract cần cả hai service chạy cùng lúc | Không — đó là điểm mấu chốt |
| OpenAPI viết tay là contract | Nó không được thực thi |
| Contract test hợp với mọi kiến trúc | Monolith không cần; API công khai không dùng được |
| Chỉ HTTP mới cần contract | Message queue cần hơn, vì lỗi im lặng |
| Verify xanh nghĩa là an toàn deploy | Chỉ khi `can-i-deploy` với đúng environment |
| Contract broker là hạ tầng phụ | Không ai sở hữu thì nó chết dần |

## Debugging

1. **Verify đỏ**: đọc phần diff mà công cụ in ra — nó chỉ chính xác trường nào lệch và lệch thế nào.
2. **Đỏ vì giá trị, không phải kiểu** → đang khớp giá trị chính xác; đổi sang matcher.
3. **State handler lỗi** → chạy riêng từng handler; kiểm tra chúng không phụ thuộc nhau.
4. **Verify chậm** → state dựng qua API thay vì seed trực tiếp.
5. **Contract cũ trong broker** → kiểm tra consumer có publish với đúng branch/version không.
6. **`can-i-deploy` từ chối** → xem ma trận verify trong broker: cặp nào chưa xanh, ở environment nào.
7. **Consumer test xanh nhưng production hỏng** → consumer đọc trường không khai báo trong contract? Kiểm tra client code có đường nào bỏ qua mock không.
8. **Không biết ai là consumer** → broker có danh sách; nếu không có broker, đây là câu hỏi đầu tiên cần trả lời.

## Production Considerations

- **Chỉ khai báo trường consumer thật sự dùng.**
- **Dùng matcher kiểu**, không khớp giá trị.
- **Provider state độc lập, dựng bằng seed trực tiếp.**
- **`can-i-deploy` là cổng bắt buộc trong pipeline deploy.**
- **Chọn cả `mainBranch` và `deployedOrReleased`** khi verify.
- **Publish kết quả verify từ CI**, gắn với git SHA và branch.
- **Contract cho cả message queue**, không chỉ HTTP.
- **Ai đó sở hữu broker** — nâng cấp, dọn contract cũ, theo dõi ma trận.
- **Bắt đầu nhẹ nếu quy mô nhỏ**: OpenAPI sinh từ code + kiểm tra tương thích schema trong CI.
- **Contract test không thay thế test tích hợp ở mỗi bên** — chúng trả lời câu hỏi khác nhau.
- **Ghi tài liệu chính sách phiên bản và deprecation** cho API có consumer ngoài tầm kiểm soát.
- **Xoá contract của consumer đã ngừng hoạt động** — contract chết làm provider bị khoá vô ích.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Contract test | phát hiện phá vỡ trước deploy, chạy độc lập | hạ tầng broker, cần hai bên hợp tác |
| E2E toàn hệ thống | kiểm chứng luồng thật | chậm, giòn, cần mọi thứ chạy |
| OpenAPI sinh từ code | rẻ, không cần broker | không biết ai dùng gì |
| Kiểm tra tương thích schema | tự động, không cần consumer | bảo thủ quá mức (chặn cả thay đổi an toàn) |
| Consumer-driven | chỉ bảo vệ thứ được dùng | cần biết consumer là ai |
| Provider-driven schema | dùng được với API công khai | consumer vẫn có thể trôi |
| Matcher kiểu | verify ổn định | không bắt lỗi giá trị |
| `can-i-deploy` | ngăn deploy phá vỡ | thêm một cổng có thể chặn nhầm |
| Contract cho queue | bắt lỗi im lặng | schema registry có thể đủ và đơn giản hơn |

## Explain Without Notes

1. Contract test lấp khoảng trống nào giữa integration test và E2E?
2. Vì sao "consumer-driven" quan trọng, và hệ quả của nó với việc provider thêm trường?
3. Contract kiểm chứng gì và không kiểm chứng gì?
4. Vì sao phải dùng matcher kiểu thay vì giá trị chính xác?
5. Provider state là gì và ba yêu cầu của nó?
6. `can-i-deploy` làm gì, và vì sao thiếu nó thì contract test mất phần lớn giá trị?
7. Khi nào **không** nên dùng contract test?
8. Vì sao contract cho message queue có giá trị cao hơn cảm giác ban đầu?

## Related

- [Mocking & test doubles](04-mocking-test-doubles.md) — vấn đề mock trôi mà contract test giải quyết
- [API & E2E tests](03-api-e2e-tests.md) — tầng mà contract test giảm tải
- [Test theo behavior](01-testing-pyramid-behavior.md) — nguyên tắc nền
- [Monolith to microservices](../../06-system-design/08-monolith-to-microservices.md) — khi nào ranh giới xuất hiện
- [Event-driven](../../06-system-design/07-event-driven.md) — contract cho message
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — ranh giới bất đồng bộ
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — cổng deploy
- [Build & artifact promotion](../../04-infrastructure/03-cicd/02-build-artifact-promotion.md) — phiên bản và môi trường

## Version / Context

Ví dụ dùng Pact (`@pact-foundation/pact` v12+, Pact Specification V3/V4) với Pact Broker hoặc PactFlow. Lựa chọn thay thế: Spring Cloud Contract (JVM), schema registry với Avro/Protobuf/JSON Schema cho message. `consumerVersionSelectors` với `deployedOrReleased` yêu cầu broker ghi nhận môi trường qua `record-deployment`.
