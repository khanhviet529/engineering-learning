---
level: intermediate
area: cross-cutting
prerequisites:
  - 02-unit-vs-integration.md
related:
  - 06-deterministic-tests.md
  - 07-contract-testing.md
---

# API & E2E tests

> Một team có 400 test E2E chạy qua trình duyệt. Bộ test mất 55 phút và đỏ khoảng 20% số lần chạy vì lý do không liên quan tới code. Quy trình thực tế của đội ngũ trở thành: **merge khi CI đỏ, sau khi liếc qua và thấy "chắc là flaky"**. Bộ test đó không còn bảo vệ gì nữa — nó chỉ tốn 55 phút mỗi lần.

## Position

```text
Unit         logic
Integration  code của bạn + hạ tầng thật
API test     HTTP thật → ứng dụng thật → DB thật, KHÔNG có trình duyệt   ← điểm ngọt
E2E          trình duyệt thật → toàn hệ thống
```

Phần lớn giá trị mà đội ngũ tìm ở E2E thực ra nằm ở **tầng API test**, với một phần nhỏ chi phí.

## Problem

```text
E2E là loại test DUY NHẤT trả lời được: "toàn bộ thứ này có hoạt động không?"
Và nó cũng là loại:
  · chậm nhất       (giây tới phút cho mỗi test)
  · giòn nhất       (đổi một class CSS → đỏ)
  · khó debug nhất  (đỏ ở bước 7, nguyên nhân ở bước 2)
  · đắt nhất để bảo trì

⇒ Giá trị cao, chi phí cao. Sai lầm không phải là viết E2E,
  mà là viết NHIỀU E2E cho những thứ tầng dưới đã kiểm chứng được.
```

## Mental Model

### API test: nơi tỉ lệ giá trị/chi phí tốt nhất

```text
Khởi động ứng dụng THẬT + DB THẬT, gửi HTTP THẬT, không có trình duyệt.

Kiểm chứng được:
  ✓ routing, middleware, guard, pipe, filter — toàn bộ chuỗi xử lý
  ✓ mã trạng thái, hình dạng response, header
  ✓ xác thực và uỷ quyền — kể cả đường TỪ CHỐI
  ✓ validate input, thông báo lỗi
  ✓ trạng thái database sau thao tác
  ✓ wiring của DI và cấu hình — app không khởi động được là test đỏ

Không kiểm chứng được:
  ✗ JavaScript phía client, render, khả năng truy cập
```

Với backend, đây là tầng nên chứa **phần lớn** test có giá trị cao.

### E2E nên bao nhiêu và cái gì

```text
Nguyên tắc: E2E chỉ dành cho luồng mà NẾU HỎNG THÌ DOANH NGHIỆP DỪNG.

Với hầu hết sản phẩm, danh sách đó là 5–15 luồng:
  · đăng ký / đăng nhập / khôi phục mật khẩu
  · luồng mua hàng hoặc luồng tạo giá trị chính
  · thanh toán
  · một luồng quản trị quan trọng

Mọi thứ khác: đẩy xuống API test hoặc component test.
```

Câu hỏi kiểm tra trước khi thêm một E2E: **"nếu chỉ hành vi này hỏng và không ai phát hiện trong 24 giờ, hậu quả là gì?"**

### Vì sao E2E flaky, và cách chữa từng nguyên nhân

```text
① CHỜ THEO THỜI GIAN thay vì chờ theo ĐIỀU KIỆN
   ✗ await page.waitForTimeout(2000)
   ✓ await expect(page.getByRole('alert')).toBeVisible()
   → auto-waiting: chờ tới khi điều kiện đúng, tối đa timeout

② SELECTOR GẮN VỚI CẤU TRÚC
   ✗ page.locator('.btn-primary > span:nth-child(2)')
   ✓ page.getByRole('button', { name: 'Đặt hàng' })
   ✓ page.getByTestId('submit-order')
   → selector theo vai trò/nhãn cũng kiểm chứng luôn khả năng truy cập

③ TRẠNG THÁI DÙNG CHUNG giữa các test
   ✗ mọi test dùng cùng một tài khoản
   ✓ mỗi test tạo dữ liệu riêng qua API, không qua UI

④ PHỤ THUỘC BÊN THỨ BA THẬT
   ✗ gọi API thanh toán thật trong CI
   ✓ chạy phiên bản giả (sandbox nội bộ) — xác định và nhanh

⑤ THỜI GIAN, MÚI GIỜ, NGÔN NGỮ
   → cố định trong cấu hình test

⑥ ĐUA GIỮA ĐIỀU HƯỚNG VÀ REQUEST NỀN
   → chờ trạng thái mạng hoặc chờ phần tử kết quả, không chờ "trang đã load"
```

Nguyên nhân ① và ② chiếm phần lớn flakiness thực tế.

### Dựng dữ liệu qua API, không qua UI

```text
✗ E2E: đăng ký qua form → xác minh email → đăng nhập → tạo sản phẩm qua form
       → thêm vào giỏ → rồi mới BẮT ĐẦU kiểm chứng thanh toán
       (6 bước dựng, mỗi bước là một điểm hỏng không liên quan)

✓ E2E: tạo user + sản phẩm + giỏ hàng qua API (hoặc seed trực tiếp)
       → đăng nhập bằng token → kiểm chứng ĐÚNG luồng thanh toán
```

Nguyên tắc: **chỉ đi qua UI phần bạn đang kiểm chứng.** Mọi thứ khác dựng bằng con đường nhanh nhất.

Một ngoại lệ có chủ đích: nên có **một** E2E đi qua toàn bộ luồng đăng ký bằng UI, vì đó là luồng bạn muốn kiểm chứng. Nhưng đúng một cái, không phải mọi test đều bắt đầu bằng nó.

### Test song song và cô lập

```text
E2E song song đòi hỏi mỗi test có VŨ TRỤ RIÊNG:
  · tài khoản riêng          → sinh email duy nhất
  · dữ liệu riêng             → tenant/workspace riêng
  · không đụng cấu hình chung → tránh test bật/tắt feature flag toàn cục

Nếu một test đổi trạng thái toàn cục, nó phải chạy tuần tự (đánh dấu serial).
```

### Môi trường chạy

```text
① Cùng CI, dựng bằng docker compose
   + xác định, cô lập, chạy được trên PR
   − CI phải đủ tài nguyên

② Môi trường staging dùng chung
   + giống production hơn
   − dữ liệu người khác thay đổi → flaky
   − không chạy song song nhiều PR được

③ Preview environment cho mỗi PR
   + cô lập + giống production
   − hạ tầng phức tạp và tốn kém
```

Lựa chọn ① cho PR và ② cho smoke test sau deploy là tổ hợp phổ biến và hợp lý.

### Smoke test sau deploy

```text
Khác mục đích với E2E trong CI:
  E2E trong CI     "thay đổi này có làm hỏng gì không?"  → trước khi merge
  Smoke sau deploy "bản vừa deploy có sống không?"        → sau khi deploy, 60 giây

Smoke test: 3–5 kiểm tra, chạy trên production, chạy nhanh
  · health endpoint trả 200 và báo cáo dependency
  · đăng nhập được
  · một truy vấn đọc trả dữ liệu
  · một thao tác ghi (rồi dọn)

Thất bại → rollback tự động.
```

Đây thường là thứ có giá trị cao nhất trong toàn bộ chiến lược test mà đội ngũ chưa có.

## Example

API test cho một endpoint — chuỗi xử lý đầy đủ, chạy trong vài chục mili-giây:

```ts
describe('POST /orders', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PaymentGateway).useClass(FakePaymentGateway)   // ranh giới TIẾN TRÌNH
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));       // giống production
    await app.init();
  });

  afterAll(() => app.close());

  it('401 khi chưa đăng nhập', () =>
    request(app.getHttpServer()).post('/orders').send({ cartId: 'x' }).expect(401));

  it('400 khi thiếu cartId', () =>
    request(app.getHttpServer()).post('/orders').set(authHeader(user)).send({}).expect(400));

  it('404 khi giỏ hàng thuộc người khác', async () => {
    const cart = await seedCart({ ownerId: otherUser.id });
    await request(app.getHttpServer())
      .post('/orders').set(authHeader(user)).send({ cartId: cart.id }).expect(404);
  });

  it('bỏ qua trường không thuộc DTO', async () => {
    const cart = await seedCart({ ownerId: user.id });
    const { body } = await request(app.getHttpServer())
      .post('/orders').set(authHeader(user))
      .send({ cartId: cart.id, status: 'paid', totalCents: 1 })      // cố ghi đè
      .expect(201);

    const order = await db.order.findUniqueOrThrow({ where: { id: body.id } });
    expect(order.status).toBe('pending');                             // không phải 'paid'
    expect(order.totalCents).toBeGreaterThan(1);
  });
});
```

Bốn test trên chạy nhanh và kiểm chứng đúng những thứ chỉ tồn tại khi có chuỗi HTTP thật: guard, ValidationPipe với `whitelist`, ánh xạ lỗi thành mã trạng thái.

Và một E2E cho luồng thanh toán — dựng dữ liệu qua API, chỉ đi UI phần cần kiểm chứng:

```ts
test('người dùng hoàn tất thanh toán và thấy xác nhận', async ({ page, request }) => {
  // Arrange qua API — nhanh và không giòn
  const { email, password, token } = await createUser(request);
  const cartId = await seedCartViaApi(request, token, [{ sku: 'A', qty: 1 }]);

  // đăng nhập bằng token, không qua form
  await page.context().addCookies([sessionCookie(token)]);

  // Act — CHỈ luồng đang kiểm chứng đi qua UI
  await page.goto(`/checkout/${cartId}`);
  await page.getByLabel('Số thẻ').fill('4242424242424242');
  await page.getByRole('button', { name: 'Thanh toán' }).click();

  // Assert — chờ ĐIỀU KIỆN, không chờ thời gian
  await expect(page.getByRole('heading', { name: 'Đặt hàng thành công' })).toBeVisible();
  await expect(page.getByTestId('order-number')).toHaveText(/^ORD-\d{6}$/);
});
```

## Prediction

1. 400 E2E chạy 55 phút, đỏ 20% số lần vì lý do không liên quan — đội ngũ làm gì với kết quả CI?
2. `await page.waitForTimeout(2000)` trên máy CI chậm hơn máy dev — kết quả?
3. `await expect(locator).toBeVisible()` — nó chờ thế nào?
4. Selector `.btn-primary > span:nth-child(2)`, designer đổi markup — kết quả?
5. `getByRole('button', { name: 'Đặt hàng' })` — cùng thay đổi?
6. Mọi E2E dùng chung một tài khoản, chạy song song 4 worker — kết quả?
7. E2E dựng dữ liệu bằng 6 bước qua UI — xác suất đỏ vì lý do không liên quan?
8. Dựng qua API, chỉ 2 bước UI — xác suất đó?
9. E2E gọi API thanh toán thật trong CI — hai vấn đề gì?
10. Không có smoke test sau deploy, bản deploy hỏng cấu hình DB — bao lâu mới biết?
11. Có smoke test — bao lâu?
12. API test khởi động `AppModule` thật, một provider bị thiếu trong module — test có đỏ không?
13. Unit test cho cùng service — có đỏ không?

<details>
<summary>Đáp án</summary>

1. **Bỏ qua kết quả** — "chắc là flaky". Bộ test mất hết giá trị.
2. **Flaky** — đôi khi 2 giây không đủ.
3. Nó **thử lại liên tục** cho tới khi điều kiện đúng hoặc hết timeout.
4. **Đỏ** — dù hành vi không đổi.
5. **Vẫn xanh** — vai trò và nhãn không đổi.
6. **Xung đột trạng thái** — flaky ngẫu nhiên.
7. Cao — mỗi bước là một điểm hỏng không liên quan tới thứ đang kiểm chứng.
8. Thấp hơn nhiều.
9. **Chậm và không xác định**; và có thể **tốn tiền thật** hoặc bị rate limit.
10. Tới khi người dùng báo — có thể hàng giờ.
11. **Dưới một phút**, và rollback tự động được.
12. **Có** — ứng dụng không khởi động được.
13. **Không** — unit test tự dựng instance, không qua DI container.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy bộ E2E 10 lần liên tiếp không đổi code | Bao nhiêu lần đỏ? |
| Thay `waitForTimeout` bằng chờ điều kiện | Flakiness giảm bao nhiêu? |
| Đổi một class CSS | Bao nhiêu test đỏ? |
| Chạy E2E song song 4 worker | Có xung đột dữ liệu không? |
| Làm CI chậm đi (giới hạn CPU) | Test nào đỏ trước? |
| Gỡ một provider khỏi module | API test có đỏ không? |
| Đo thời gian từng E2E | Bao nhiêu phần trăm là dựng dữ liệu? |
| Đếm E2E kiểm chứng thứ API test làm được | Bao nhiêu cái đẩy xuống được? |
| Tắt mạng ra ngoài khi chạy test | Có test nào gọi bên thứ ba thật không? |
| Deploy một bản có config sai vào staging | Smoke test có bắt được không? |

## What Usually Goes Wrong

- **Quá nhiều E2E** cho thứ tầng dưới kiểm chứng được.
- **Chờ theo thời gian** thay vì chờ điều kiện.
- **Selector gắn với cấu trúc DOM/CSS.**
- **Dựng dữ liệu qua UI** — mỗi bước là một điểm hỏng.
- **Trạng thái dùng chung** giữa các test.
- **Gọi dịch vụ bên thứ ba thật** trong CI.
- **Không cố định thời gian/múi giờ/ngôn ngữ.**
- **Chạy trên staging dùng chung** với dữ liệu thay đổi.
- **Không có smoke test sau deploy** — loại test có tỉ lệ giá trị/chi phí cao nhất.
- **Test flaky được chạy lại** thay vì sửa → CI mất uy tín.
- **API test không dùng cấu hình giống production** (thiếu ValidationPipe, thiếu guard toàn cục) → test nói dối.
- **Không có artifact khi đỏ** (ảnh chụp, video, trace) → debug rất tốn thời gian.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Nhiều E2E = tự tin hơn | Nhiều E2E flaky = không ai tin CI nữa |
| E2E kiểm chứng "thật" nhất | Nó cũng giòn và chậm nhất |
| API test là integration test | Nó chạy qua toàn bộ chuỗi HTTP — nhiều hơn thế |
| Test qua UI phản ánh người dùng | Chỉ phần bạn kiểm chứng mới cần qua UI |
| Flaky là bản chất của E2E | Phần lớn flakiness có nguyên nhân xác định |
| `waitForTimeout` an toàn nếu đủ dài | Nó vừa chậm vừa vẫn flaky |
| Test id là thực hành xấu | Nó ổn định hơn selector CSS nhiều |
| Chạy E2E trên staging là giống production nhất | Dữ liệu dùng chung làm nó không đáng tin |
| Smoke test là thừa vì đã có E2E | Chúng trả lời hai câu hỏi khác nhau |
| CI đỏ thỉnh thoảng là chấp nhận được | Nó huỷ hoại toàn bộ giá trị của CI |

## Debugging

1. **E2E đỏ** → xem trace/video/ảnh chụp trước khi đọc code. Playwright trace viewer cho thấy đúng trạng thái DOM lúc thất bại.
2. **Đỏ ngẫu nhiên** → chạy `--repeat-each=20` để tái lập; nếu chỉ đỏ khi song song, đó là vấn đề cô lập dữ liệu.
3. **Đỏ chỉ trong CI** → CI chậm hơn: tìm mọi `waitForTimeout` và mọi giả định về tốc độ.
4. **Đỏ ở bước 7, nguyên nhân ở bước 2** → thêm assert trung gian sau mỗi bước dựng.
5. **API test đỏ với 500** → log của ứng dụng test, không phải output của test runner.
6. **API test xanh, production hỏng** → so cấu hình: pipe, guard, interceptor toàn cục có được đăng ký trong test không?
7. **Bộ test chậm** → đo tỉ lệ thời gian dựng dữ liệu so với thời gian kiểm chứng; nếu dựng chiếm phần lớn, chuyển sang API/seed.
8. **Sau khi sửa flaky** → chạy 50 lần để xác nhận, không chạy một lần rồi kết luận.

## Production Considerations

- **Phần lớn test có giá trị nằm ở tầng API test**, không phải E2E.
- **E2E chỉ cho luồng mà nếu hỏng thì doanh nghiệp dừng** — 5–15 luồng.
- **Chờ theo điều kiện, không theo thời gian.**
- **Selector theo vai trò/nhãn hoặc test id**, không theo CSS.
- **Dựng dữ liệu qua API hoặc seed**; chỉ đi UI phần đang kiểm chứng.
- **Mỗi test có dữ liệu riêng**; đánh dấu serial cho test đụng trạng thái toàn cục.
- **Fake dịch vụ bên thứ ba**, không gọi thật trong CI.
- **Cố định thời gian, múi giờ, ngôn ngữ, kích thước cửa sổ.**
- **API test dùng đúng cấu hình production** (pipe, guard, filter toàn cục).
- **Lưu trace/video/ảnh khi đỏ** — nó quyết định tốc độ debug.
- **Smoke test sau mỗi deploy** với rollback tự động khi thất bại.
- **Ngân sách thời gian rõ ràng**: PR dưới 10 phút; vượt thì cắt hoặc song song hoá.
- **Chính sách flaky**: sửa trong ngày hoặc cách ly có thời hạn, không để trôi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều API test | nhanh, ổn định, phủ chuỗi xử lý | không thấy phía client |
| Nhiều E2E | gần người dùng nhất | chậm, giòn, đắt |
| Dựng qua API | nhanh, ổn định | không kiểm chứng luồng dựng |
| Dựng qua UI | kiểm chứng cả luồng dựng | mỗi bước là điểm hỏng |
| Chạy trong CI với compose | cô lập, chạy được trên PR | tốn tài nguyên CI |
| Chạy trên staging | giống production | dữ liệu dùng chung → flaky |
| Preview env mỗi PR | cô lập + giống production | hạ tầng phức tạp, tốn kém |
| Test id trong markup | selector ổn định | markup có thêm thuộc tính |
| Selector theo vai trò | kiểm chứng cả khả năng truy cập | phụ thuộc nhãn (đổi text → đỏ) |
| Smoke test trên production | phát hiện nhanh nhất | tạo dữ liệu thật, phải dọn |

## Explain Without Notes

1. API test kiểm chứng được gì mà integration test thường không?
2. Tiêu chí chọn luồng đáng viết E2E?
3. Sáu nguyên nhân flaky trong E2E và cách chữa từng cái.
4. Vì sao dựng dữ liệu qua UI là lựa chọn tồi, và ngoại lệ duy nhất?
5. Vì sao chờ theo thời gian vừa chậm vừa flaky?
6. Smoke test sau deploy khác E2E trong CI ở mục đích nào?
7. Điều gì xảy ra với một đội ngũ khi CI đỏ 20% số lần?
8. Vì sao API test phải dùng đúng cấu hình global của production?

## Related

- [Test theo behavior](01-testing-pyramid-behavior.md) — nguyên tắc nền
- [Unit vs integration](02-unit-vs-integration.md) — tầng dưới
- [Mocking & test doubles](04-mocking-test-doubles.md) — fake dịch vụ bên thứ ba
- [Deterministic tests](06-deterministic-tests.md) — nguồn gốc flakiness
- [Contract testing](07-contract-testing.md) — thay thế E2E giữa các service
- [Testing NestJS](../../02-backend-api/02-nestjs/behavior/09-testing-nestjs.md) — dựng API test
- [Access control](../security/04-access-control.md) — test đường từ chối ở tầng API
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — smoke test và rollback
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — ngân sách thời gian CI

## Version / Context

Ví dụ dùng Playwright (auto-waiting, trace viewer), Supertest với NestJS 10/11, Jest/Vitest. Cypress có mô hình tương đương với `cy.get(...).should(...)`. Nguyên tắc không phụ thuộc công cụ; auto-waiting là tính năng của cả Playwright và Cypress hiện đại.
