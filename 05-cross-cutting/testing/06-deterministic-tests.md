---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-testing-pyramid-behavior.md
related:
  - 04-mocking-test-doubles.md
  - 05-testcontainers.md
---

# Deterministic tests: chống flaky

> Một bộ test đỏ khoảng 3% số lần chạy. Đội ngũ thêm `--retry 2` vào CI và vấn đề "biến mất". Bốn tháng sau, một bug thật lọt lên production: một race condition trong xử lý đơn hàng. Nó **đã** làm test đỏ nhiều lần — nhưng mỗi lần đều được retry và trở thành xanh. Cơ chế che giấu flaky cũng che giấu chính bug mà flaky đang báo hiệu.

## Position

```text
Một test flaky không phải "test hơi kém".
Nó là một trong hai thứ:
  ① test có giả định sai về môi trường
  ② HỆ THỐNG có hành vi không xác định  ← và đó là bug production đang chờ
```

## Problem

```text
Chi phí của flaky không tuyến tính:

  1 test flaky, tỉ lệ đỏ 1%
  bộ 500 test → xác suất ÍT NHẤT MỘT test đỏ mỗi lần chạy ≈ 1 - 0.99^500 ≈ 99%

⇒ vài test flaky là đủ để CI gần như KHÔNG BAO GIỜ xanh
⇒ đội ngũ học cách bỏ qua màu đỏ
⇒ bộ test mất toàn bộ giá trị, kể cả những test tốt
```

Đây là lý do flaky phải được xử lý như sự cố, không phải như phiền toái.

## Mental Model

### Sáu nguồn không xác định

```text
① THỜI GIAN        Date.now(), timeout, TTL, múi giờ, DST, năm nhuận
② NGẪU NHIÊN       Math.random(), uuid, thứ tự Map/Set trong một số ngôn ngữ
③ THỨ TỰ           test phụ thuộc test khác, thứ tự file, thứ tự dòng trả về từ DB
④ ĐỒNG THỜI        race trong code, race giữa các test song song
⑤ TÀI NGUYÊN NGOÀI mạng, cổng, đĩa, container chưa sẵn sàng
⑥ TRẠNG THÁI SÓT   dữ liệu, cache, mock chưa reset, biến module-level
```

Mọi test flaky đều thuộc ít nhất một trong sáu nhóm này. Chẩn đoán bắt đầu bằng việc xác định nhóm.

### ① Thời gian: tiêm, đừng đọc trực tiếp

```ts
// ✗ đọc đồng hồ toàn cục — không kiểm soát được
class TokenService {
  isExpired(t: Token) { return t.expiresAt < new Date(); }
}

// ✓ tiêm — tường minh và kiểm soát được
export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };

class TokenService {
  constructor(private readonly clock: Clock = systemClock) {}
  isExpired(t: Token) { return t.expiresAt < this.clock.now(); }
}
```

```text
Fake timer vẫn hữu ích cho việc TUA NHANH:
  · test retry với exponential backoff (không muốn chờ 30 giây thật)
  · test debounce/throttle
  · test job theo lịch

nhưng nó là công cụ toàn cục → dùng có chủ đích, không dùng mặc định
```

Bẫy kinh điển của fake timer:

```ts
// ✗ TREO: promise thật không bao giờ resolve vì timer đã bị đóng băng
jest.useFakeTimers();
await service.retryWithBackoff();

// ✓ tua thời gian trong lúc chờ
jest.useFakeTimers();
const p = service.retryWithBackoff();
await jest.advanceTimersByTimeAsync(30_000);
await p;
```

**Múi giờ** là nguồn flaky theo mùa: test viết ở UTC+7 chạy trong CI ở UTC hỏng vào một số giờ nhất định. Cố định `TZ=UTC` cho mọi lần chạy test, và test riêng logic múi giờ với giá trị tường minh.

### ② Ngẫu nhiên: tiêm hoặc gieo hạt

```ts
export type IdGenerator = () => string;
export const uuidGenerator: IdGenerator = () => crypto.randomUUID();

// test
const ids = ['id-1', 'id-2', 'id-3'];
let i = 0;
const service = new OrderService({ generateId: () => ids[i++] });
```

Với dữ liệu test ngẫu nhiên (faker), **luôn ghi lại seed** khi test đỏ — nếu không, thất bại không tái lập được:

```ts
const seed = Number(process.env.TEST_SEED ?? Date.now());
faker.seed(seed);
afterEach(function () { if (this.currentTest?.state === 'failed') console.log('SEED=', seed); });
```

### ③ Thứ tự: mỗi test tự đứng vững

```text
Kiểm tra: chạy MỘT test đơn lẻ. Nó có pass không?
          chạy bộ test theo thứ tự NGẪU NHIÊN. Còn xanh không?

✗ beforeAll tạo dữ liệu, các test lần lượt SỬA nó
   → test 3 phụ thuộc test 1 và 2 đã chạy
✓ mỗi test tự tạo dữ liệu nó cần
```

Thứ tự dòng trả về từ database là nguồn hay bị bỏ qua:

```sql
-- KHÔNG có ORDER BY → thứ tự KHÔNG được đảm bảo
SELECT * FROM invoices WHERE tenant_id = $1;
```

```text
Nó thường ổn định trong dev (bảng nhỏ, seq scan)
và đổi trong CI hoặc production (plan khác, index khác, parallel scan)

→ ORDER BY tường minh trong cả code và test
→ hoặc assert theo TẬP HỢP: expect(ids).toEqual(expect.arrayContaining([...]))
```

### ④ Đồng thời: khi flaky là bug thật

```text
Test song song đỏ ngẫu nhiên → hai khả năng:
  a) test dùng chung dữ liệu     → sửa cô lập
  b) CODE có race condition       → sửa CODE

Đừng cho rằng luôn là (a).
Sự cố ở đầu note là (b) bị chẩn đoán nhầm thành (a).
```

Cách phân biệt: nếu test đỏ khi chạy **tuần tự** với dữ liệu riêng biệt nhưng gọi đồng thời (`Promise.all`), đó là (b).

```ts
// test chủ động cho race condition — biến bug không xác định thành test xác định
it('không cho hai người mua sản phẩm cuối cùng', async () => {
  const product = await seedProduct({ stock: 1 });

  const results = await Promise.allSettled([
    api.as(userA).post('/orders').send({ productId: product.id }),
    api.as(userB).post('/orders').send({ productId: product.id }),
  ]);

  const ok = results.filter(r => r.status === 'fulfilled' && r.value.status === 201);
  expect(ok).toHaveLength(1);                                  // đúng MỘT thành công

  const updated = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  expect(updated.stock).toBe(0);                               // không âm
});
```

Test này chạy được lặp lại vì nó **ép** tình huống đồng thời thay vì chờ nó tình cờ xảy ra.

### ⑤ Tài nguyên ngoài: chờ điều kiện, không chờ thời gian

```text
✗ await sleep(2000)                 → vừa chậm vừa flaky
✓ chờ tới khi điều kiện đúng, có timeout

✗ cổng cố định                       → xung đột khi chạy song song
✓ cổng 0 (hệ điều hành cấp) hoặc cổng ngẫu nhiên của container

✗ gọi mạng thật                      → phụ thuộc thứ ngoài tầm kiểm soát
✓ chặn mọi request ra ngoài và làm nó thành lỗi
```

```ts
// polling có timeout — mẫu dùng được cho mọi trạng thái bất đồng bộ
async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 5_000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor: hết thời gian chờ');
    await new Promise(r => setTimeout(r, stepMs));
  }
}

// dùng cho job nền: kiểm chứng KẾT QUẢ, không đoán thời gian xử lý
const order = await waitFor(() => db.order.findFirst({ where: { id, status: 'paid' } }));
```

### ⑥ Trạng thái sót

```text
· dữ liệu DB          → truncate hoặc dữ liệu duy nhất mỗi test
· Redis               → flush hoặc prefix key theo test
· mock                → restoreMocks: true
· biến module-level   → tránh trạng thái ở tầng module; nếu có, reset tường minh
· singleton/DI cache  → tạo lại app hoặc reset provider
· biến môi trường     → lưu và khôi phục quanh test đổi env
```

Biến ở tầng module là nguồn khó tìm nhất, vì nó tồn tại xuyên suốt file test và không hiện ra trong `beforeEach`.

### Retry: khi nào chấp nhận được

```text
✗ retry MỌI test mặc định
   → che giấu cả flaky lẫn bug thật ← sự cố ở đầu note

~ retry với ĐIỀU KIỆN:
   · chỉ ở tầng E2E (nơi nguồn không xác định thật sự nằm ngoài tầm kiểm soát)
   · GHI LẠI mọi lần retry và báo cáo → flaky vẫn nhìn thấy được
   · có ngưỡng: quá N% test cần retry → coi là lỗi build

✓ tốt nhất: sửa nguyên nhân; cách ly (quarantine) có THỜI HẠN nếu chưa sửa kịp
```

Nguyên tắc: retry được phép **giấu sự bất tiện, không được phép giấu thông tin**. Nếu bạn không đo được tỉ lệ retry, retry đang giấu thông tin.

## Example

Chính sách flaky viết thành cấu hình:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-each.ts'],
    restoreMocks: true,               // ① mock không rò rỉ giữa các test
    sequence: { shuffle: true },      // ② thứ tự ngẫu nhiên → lộ phụ thuộc ngầm
    retry: process.env.CI ? 1 : 0,    // ③ retry tối thiểu, chỉ trong CI
    testTimeout: 10_000,
    env: { TZ: 'UTC', LANG: 'C' },    // ④ cố định môi trường
  },
});
```

```ts
// test/setup-each.ts
import { server } from './msw-server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));  // ⑤ chặn mạng thật
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  await truncateAllTables();                                       // ⑥ dữ liệu sạch
  await redis.flushdb();
});
```

Sáu dòng này loại bỏ phần lớn flaky trước khi nó xuất hiện. Dòng ② đáng chú ý nhất: nó **chủ động tìm** phụ thuộc thứ tự thay vì chờ chúng gây rắc rối trong CI vào một ngày xấu trời.

Và cách tái lập một test flaky:

```bash
# chạy lặp lại để tái lập
npx vitest run path/to/test.spec.ts --repeat=50

# chạy với thứ tự cố định để loại trừ yếu tố thứ tự
npx vitest run --sequence.shuffle=false --sequence.seed=12345

# chạy tuần tự để loại trừ yếu tố song song
npx vitest run --no-file-parallelism
```

Ba lệnh này chia không gian tìm kiếm thành ba phần: nếu chỉ đỏ khi song song → cô lập dữ liệu hoặc race; nếu chỉ đỏ với một seed thứ tự nhất định → phụ thuộc thứ tự; nếu đỏ ngay cả khi chạy đơn lẻ lặp lại → thời gian, ngẫu nhiên, hoặc tài nguyên ngoài.

## Prediction

1. Bộ 500 test, mỗi test đỏ 1% độc lập — xác suất ít nhất một test đỏ mỗi lần chạy?
2. Đội ngũ thêm `--retry 2` cho mọi test — điều gì bị che giấu?
3. Test viết ở UTC+7, CI chạy UTC, test dùng `new Date()` với logic theo ngày — đỏ khi nào?
4. `SELECT * FROM invoices` không `ORDER BY`, test assert thứ tự — ổn định không?
5. Cùng query trên bảng lớn hơn với index khác — thứ tự có đổi không?
6. `jest.useFakeTimers()` rồi `await` một promise chờ `setTimeout` thật — kết quả?
7. Thêm `advanceTimersByTimeAsync` — kết quả?
8. `beforeAll` tạo dữ liệu, ba test lần lượt sửa nó, chạy test thứ 3 đơn lẻ — pass không?
9. Chạy bộ test với thứ tự ngẫu nhiên lần đầu tiên — điều gì thường xảy ra?
10. Hai test song song cùng dùng email `test@example.com` — kết quả?
11. Test đỏ ngẫu nhiên khi song song, dữ liệu đã cô lập riêng — nghi ngờ gì?
12. `Math.random()` trong code, test đỏ một lần trong 200 — tái lập thế nào?
13. Mock không được restore, test A đặt `mockReturnValue`, test B chạy sau — B thấy gì?

<details>
<summary>Đáp án</summary>

1. **≈ 99%** — `1 - 0.99^500`. CI gần như không bao giờ xanh.
2. Cả **flaky lẫn bug thật** — gồm race condition.
3. Vào các giờ mà ngày ở hai múi giờ khác nhau — tức **một phần trong ngày**, mỗi ngày.
4. **Không được đảm bảo** — nó chỉ tình cờ ổn định.
5. **Có thể đổi** — plan khác, parallel scan, index scan.
6. **Treo** cho tới khi hết timeout.
7. Chạy được.
8. **Không** — nó phụ thuộc hai test trước.
9. **Vài test đỏ** — chúng đã luôn phụ thuộc thứ tự, chỉ chưa lộ.
10. **Xung đột unique** — flaky tuỳ timing.
11. **Race condition trong code** — và đó là bug production.
12. **Gieo hạt và ghi lại seed**; không có seed thì không tái lập được.
13. **Giá trị mock của test A** — kết quả sai hoặc đỏ ngẫu nhiên tuỳ thứ tự.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy bộ test 50 lần liên tiếp | Bao nhiêu lần đỏ, test nào? |
| Bật `sequence.shuffle` lần đầu | Bao nhiêu test đỏ? |
| Chạy một test đơn lẻ | Nó pass độc lập không? |
| Đổi `TZ` sang `Pacific/Kiritimati` | Test nào đỏ? |
| Chạy CI với ít CPU hơn | Test nào đỏ trước? |
| Bỏ `ORDER BY` khỏi một query rồi chạy trên bảng lớn | Thứ tự có đổi không? |
| Gọi hai request đồng thời tới cùng tài nguyên | Có race không? |
| Tắt `restoreMocks` | Test nào bắt đầu phụ thuộc nhau? |
| Chặn mạng ra ngoài | Test nào đỏ? |
| Thêm delay ngẫu nhiên vào một dependency | Test nào lộ giả định về thời gian? |

## What Usually Goes Wrong

- **Retry mặc định cho mọi test** → che giấu bug thật.
- **Đọc `Date.now()` trực tiếp** trong logic nghiệp vụ.
- **Không cố định `TZ`** trong test.
- **Fake timer toàn cục** gây treo và tác dụng phụ.
- **Không `ORDER BY`** rồi assert thứ tự.
- **Test phụ thuộc thứ tự** qua `beforeAll` chia sẻ trạng thái.
- **Dữ liệu cố định** (email, slug) khi chạy song song.
- **Chờ theo thời gian** cho thao tác bất đồng bộ.
- **Mock không reset.**
- **Trạng thái ở tầng module** giữ giá trị giữa các test.
- **Coi mọi flaky là lỗi test** — bỏ qua khả năng đó là race trong code.
- **Không đo tỉ lệ flaky** → không biết vấn đề đang lớn hay nhỏ.
- **Không ghi seed** cho dữ liệu ngẫu nhiên → thất bại không tái lập.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Vài test flaky không sao | Với bộ test lớn, vài cái đủ làm CI luôn đỏ |
| Retry giải quyết flaky | Nó giấu flaky, và giấu cả bug thật |
| Flaky là bản chất của test tích hợp | Phần lớn có nguyên nhân xác định |
| Test đỏ ngẫu nhiên là lỗi test | Có thể là race condition trong code |
| DB trả về thứ tự ổn định | Không có `ORDER BY` thì không có bảo đảm |
| Fake timer là cách đúng để kiểm soát thời gian | Nó tốt cho tua nhanh, không tốt cho "bây giờ" |
| Chạy tuần tự tránh được flaky | Nó chỉ giấu vấn đề cô lập |
| Test chạy trên máy tôi nên nó ổn | CI có tốc độ, thứ tự và tài nguyên khác |
| Shuffle làm test không ổn định | Nó **phơi bày** sự không ổn định đã có |
| Sửa flaky là việc thấp ưu tiên | Nó quyết định bộ test còn giá trị hay không |

## Debugging

1. **Tái lập trước**: `--repeat=50` trên test nghi ngờ. Không tái lập được thì không sửa được.
2. **Chia không gian tìm kiếm** bằng ba lệnh: lặp lại đơn lẻ / tắt shuffle / tắt song song. Mỗi kết quả loại trừ một nhóm nguyên nhân.
3. **Đỏ chỉ khi song song** → cô lập dữ liệu, hoặc race trong code. Phân biệt bằng cách gọi đồng thời trong một test tuần tự.
4. **Đỏ chỉ trong CI** → so `TZ`, `LANG`, số CPU, tốc độ đĩa, phiên bản image.
5. **Đỏ chỉ vào một số giờ** → múi giờ hoặc ranh giới ngày.
6. **In trạng thái khi đỏ**: dữ liệu DB liên quan, thời điểm, seed. Thất bại không kèm ngữ cảnh rất tốn thời gian.
7. **Đo tỉ lệ flaky theo thời gian** — báo cáo số lần retry theo test; danh sách top là danh sách việc cần làm.
8. **Nếu nghi race trong code**: viết test ép đồng thời (`Promise.all`) và chạy 100 lần. Nếu nó đỏ, bạn vừa biến bug không xác định thành test xác định.

## Production Considerations

- **Cố định `TZ=UTC`, `LANG=C`** cho mọi lần chạy test.
- **Tiêm `Clock`, `Random`, `IdGenerator`** thay vì đọc toàn cục.
- **`ORDER BY` tường minh** ở mọi query mà thứ tự có ý nghĩa — trong code, không chỉ trong test.
- **Mỗi test tự dựng dữ liệu duy nhất** của nó.
- **`restoreMocks: true`** và tránh trạng thái ở tầng module.
- **Bật shuffle** để phơi bày phụ thuộc thứ tự.
- **Chặn mọi request ra mạng** và làm nó thành lỗi.
- **Chờ điều kiện với timeout**, không sleep.
- **Retry tối đa 1 lần, chỉ ở tầng cao, và ĐO tỉ lệ** — coi tỉ lệ đó là chỉ số sức khoẻ.
- **Chính sách flaky rõ ràng**: sửa trong N ngày, hoặc cách ly có thời hạn kèm issue, không để trôi.
- **Ghi seed khi test dữ liệu ngẫu nhiên đỏ.**
- **Khi flaky hoá ra là race trong code, viết test ép đồng thời** — nó có giá trị hơn nhiều test bình thường.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tiêm Clock/Random | kiểm soát hoàn toàn | thêm tham số constructor |
| Fake timer | tua nhanh được | tác dụng phụ toàn cục, dễ treo |
| Shuffle thứ tự | phơi bày phụ thuộc | thất bại khó tái lập hơn (cần seed) |
| Chạy song song | nhanh hơn nhiều | lộ vấn đề cô lập |
| Chạy tuần tự | ít flaky hơn | chậm, và giấu vấn đề |
| Retry trong CI | build ít đỏ giả | có thể giấu bug thật |
| Không retry | tín hiệu trung thực | build đỏ vì lý do ngoài tầm kiểm soát |
| Cách ly test flaky | CI dùng được ngay | mất phần bảo vệ tạm thời |
| Dữ liệu ngẫu nhiên (faker) | phủ rộng hơn | cần seed để tái lập |
| Dữ liệu cố định | tái lập dễ | bỏ sót trường hợp biên |

## Explain Without Notes

1. Vì sao 1% flaky trên 500 test làm CI gần như luôn đỏ?
2. Sáu nguồn không xác định, mỗi nguồn một ví dụ.
3. Vì sao retry mặc định nguy hiểm hơn nó có vẻ?
4. Fake timer tốt cho việc gì và tệ cho việc gì?
5. Vì sao thứ tự dòng từ database không được đảm bảo nếu không có `ORDER BY`?
6. Làm sao phân biệt flaky do cô lập với flaky do race trong code?
7. Ba lệnh để chia không gian tìm kiếm khi debug flaky?
8. Vì sao bật shuffle là điều nên làm dù nó làm lộ nhiều test đỏ?

## Related

- [Test theo behavior](01-testing-pyramid-behavior.md) — vì sao test flaky phá hỏng cả bộ
- [Unit vs integration](02-unit-vs-integration.md) — cô lập dữ liệu
- [API & E2E tests](03-api-e2e-tests.md) — nơi flaky tập trung
- [Mocking & test doubles](04-mocking-test-doubles.md) — tiêm Clock và Random
- [Testcontainers](05-testcontainers.md) — wait strategy, cổng ngẫu nhiên
- [Shared state & races](../concurrency/02-shared-state-races.md) — khi flaky là bug thật
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — CI đỏ và niềm tin của đội ngũ

## Version / Context

Ví dụ dùng Vitest (`sequence.shuffle`, `--repeat`, `--no-file-parallelism`) và Jest (`--runInBand`, `--shuffle` từ v29, `restoreMocks`). `advanceTimersByTimeAsync` có từ Jest 29 / Vitest 0.34. Nguyên tắc không phụ thuộc công cụ.
