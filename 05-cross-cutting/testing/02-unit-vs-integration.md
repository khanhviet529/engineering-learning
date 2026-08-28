---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-testing-pyramid-behavior.md
related:
  - 04-mocking-test-doubles.md
  - 05-testcontainers.md
---

# Unit vs integration: chọn tầng

> Một service tính giá có 120 unit test, tất cả xanh. Trong production, tổng đơn hàng bị lệch một xu ở khoảng 3% đơn. Nguyên nhân: hàm tính toán làm việc với `number`, còn cột trong database là `numeric(12,2)`. Mọi unit test dùng số đã làm tròn sẵn nên không bao giờ chạm tới sự khác biệt đó. **Lỗi không nằm trong bất kỳ đơn vị nào — nó nằm ở chỗ nối giữa chúng.**

## Position

```text
Unit          logic thuần, không I/O            → mili-giây
Integration   code CỦA BẠN + hạ tầng THẬT       → trăm mili-giây
E2E           toàn hệ thống qua giao diện thật  → giây
```

Câu hỏi không phải "viết loại nào", mà **"kiểm chứng này thuộc tầng nào"**.

## Problem

```text
Unit test rất tốt ở một việc: kiểm chứng LOGIC.
Nó mù hoàn toàn với:
  · schema và ràng buộc database    · kiểu dữ liệu và ép kiểu
  · hành vi transaction              · độ chính xác số học ở tầng lưu trữ
  · serialize/deserialize            · thứ tự thực thi thật
  · cấu hình sai                     · query thật sự sinh ra là gì

⇒ Bộ test toàn unit cho cảm giác an toàn ở đúng vùng ÍT rủi ro nhất.
```

Ngược lại, bộ test toàn integration thì chậm tới mức không ai chạy trước khi push — và phản hồi chậm là phản hồi không dùng được.

## Mental Model

### Ranh giới thật sự: có I/O hay không

```text
UNIT         không chạm mạng, đĩa, đồng hồ, random
             → chạy song song vô hạn, mili-giây, xác định tuyệt đối

INTEGRATION  chạm hạ tầng thật (DB, Redis, queue) nhưng KHÔNG chạm bên thứ ba
             → cần container, cần dọn dữ liệu, cần nghĩ về cô lập

E2E          chạy toàn hệ thống, thường qua trình duyệt
             → chậm nhất, giòn nhất, gần người dùng nhất
```

Định nghĩa "unit = một class" là định nghĩa gây hại: nó dẫn tới mock mọi thứ xung quanh class đó. Định nghĩa dùng được: **unit = một hành vi kiểm chứng được không cần I/O**, dù nó chạm bao nhiêu class.

### Quyết định tầng: một câu hỏi

```text
"Kiểm chứng này có thể SAI vì hạ tầng không?"

KHÔNG  → unit
        tính thuế, chuyển trạng thái, parse, validate, định dạng, thuật toán

CÓ     → integration
        query trả đúng dòng? · ràng buộc unique chặn? · transaction rollback?
        · index có được dùng? · TTL cache đúng? · job vào đúng queue?

CÓ, và liên quan tới NHIỀU HỆ THỐNG → E2E
        đăng nhập → đặt hàng → thanh toán → email
```

### Vùng mà unit test nói dối

Đây là danh sách đáng thuộc, vì mỗi mục là một lớp bug production:

```text
① KIỂU DỮ LIỆU
   number ↔ numeric/decimal · Date ↔ timestamptz · string ↔ enum
   → lỗi ở đầu note thuộc nhóm này

② RÀNG BUỘC
   unique, foreign key, check, NOT NULL
   → mock repository chấp nhận mọi thứ; database thì không

③ TRANSACTION
   rollback, isolation, deadlock, lock chờ
   → không mô phỏng được bằng mock

④ QUERY THẬT
   ORM sinh ra SQL gì? N+1? index có được dùng?

⑤ SERIALIZE
   JSON round-trip, Date thành string, BigInt, số lớn mất độ chính xác

⑥ CẤU HÌNH
   biến môi trường thiếu, DI wiring sai, module không được import
   → ứng dụng không khởi động được là bug mà unit test không thấy
```

### Kiến trúc quyết định tỉ lệ

```text
Logic nghiệp vụ TÁCH KHỎI I/O
  → phần lớn kiểm chứng làm được ở tầng unit, rẻ và nhanh
  → integration test tập trung vào các chỗ nối

Logic TRỘN với truy vấn database
  → không có gì test được ở tầng unit mà có nghĩa
  → mọi thứ phải là integration test → bộ test chậm

⇒ "khó viết unit test" thường không phải vấn đề của test.
   Nó là phản hồi về THIẾT KẾ.
```

```ts
// ✗ logic trộn với I/O — chỉ integration test được
async function applyDiscount(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { user: true } });
  const isVip = order.user.totalSpentCents > 1_000_000;
  const rate = isVip ? 0.1 : order.totalCents > 100_000 ? 0.05 : 0;
  await db.order.update({ where: { id: orderId }, data: { discountCents: Math.round(order.totalCents * rate) } });
}

// ✓ logic thuần tách ra — unit test được, và ĐỌC ĐƯỢC
export function discountRate(input: { totalCents: number; userTotalSpentCents: number }): number {
  if (input.userTotalSpentCents > 1_000_000) return 0.1;
  if (input.totalCents > 100_000) return 0.05;
  return 0;
}

// vỏ mỏng — integration test kiểm chứng chỗ nối
async function applyDiscount(orderId: string) {
  const order = await this.repo.findWithUser(orderId);
  const rate = discountRate({ totalCents: order.totalCents, userTotalSpentCents: order.user.totalSpentCents });
  await this.repo.setDiscount(orderId, Math.round(order.totalCents * rate));
}
```

Sau khi tách, `discountRate` kiểm chứng được toàn bộ ma trận điều kiện trong mili-giây, và integration test chỉ cần **một** trường hợp để chứng minh dây nối đúng.

### Integration test: cô lập dữ liệu

Đây là vấn đề kỹ thuật chính của tầng này.

```text
① TRANSACTION + ROLLBACK sau mỗi test
   + nhanh nhất, sạch tuyệt đối
   − không test được chính hành vi transaction của code
   − khó khi code tự mở transaction lồng nhau

② TRUNCATE bảng sau mỗi test
   + đơn giản, đúng trong mọi trường hợp
   − chậm hơn; cần biết thứ tự khoá ngoại (hoặc TRUNCATE ... CASCADE)

③ DỮ LIỆU DUY NHẤT mỗi test (tenant/user riêng)
   + chạy SONG SONG được — thường là yếu tố quyết định tổng thời gian
   − cần kỷ luật: mọi query phải lọc theo phạm vi đó

④ SCHEMA/DATABASE riêng cho mỗi worker
   + cô lập hoàn toàn, song song tốt
   − tốn tài nguyên, khởi tạo lâu hơn
```

Lựa chọn ③ kết hợp ② thường cho kết quả tốt nhất: mỗi test tạo tenant riêng, truncate chạy giữa các file thay vì giữa các test.

### Test schema và migration

Một loại integration test hay bị bỏ, nhưng rẻ và giá trị cao:

```text
✓ migration chạy được từ đầu trên database rỗng
✓ migration chạy được trên bản sao schema của production
✓ sau khi chạy, schema khớp với thứ ORM mong đợi
✓ migration rollback được (nếu bạn tuyên bố là rollback được)
```

Nếu migration chỉ được chạy lần đầu tiên trên production, thì production **là** môi trường test của nó.

## Example

Cùng một tính năng, kiểm chứng chia theo tầng:

```ts
// ===== UNIT: logic thuần, toàn bộ ma trận điều kiện =====
describe('discountRate', () => {
  it.each([
    { totalCents: 50_000,  userTotalSpentCents: 0,         expected: 0    },
    { totalCents: 150_000, userTotalSpentCents: 0,         expected: 0.05 },
    { totalCents: 50_000,  userTotalSpentCents: 2_000_000, expected: 0.1  },
    { totalCents: 150_000, userTotalSpentCents: 2_000_000, expected: 0.1  },  // VIP thắng
    { totalCents: 100_000, userTotalSpentCents: 1_000_000, expected: 0    },  // BIÊN: không phải >
  ])('$totalCents / $userTotalSpentCents → $expected', ({ expected, ...input }) => {
    expect(discountRate(input)).toBe(expected);
  });
});

// ===== INTEGRATION: chỗ nối với database =====
describe('applyDiscount (DB thật)', () => {
  it('ghi đúng discountCents và làm tròn về số nguyên', async () => {
    const order = await seedOrder({ totalCents: 150_001, userTotalSpentCents: 0 });

    await service.applyDiscount(order.id);

    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.discountCents).toBe(7_500);          // 150001 * 0.05 = 7500.05 → 7500
    expect(Number.isInteger(updated.discountCents)).toBe(true);
  });

  it('không để lại thay đổi khi ghi thất bại', async () => {
    const order = await seedOrder({ totalCents: 150_000 });
    jest.spyOn(repo, 'setDiscount').mockRejectedValueOnce(new Error('db down'));

    await expect(service.applyDiscount(order.id)).rejects.toThrow();

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.discountCents).toBe(0);
  });

  it('ràng buộc chặn discount lớn hơn tổng đơn', async () => {
    const order = await seedOrder({ totalCents: 1_000 });
    await expect(
      db.order.update({ where: { id: order.id }, data: { discountCents: 2_000 } }),
    ).rejects.toThrow(/check constraint/i);       // ràng buộc ở DB, không ở code
  });
});
```

Chú ý sự phân công: **unit test lo ma trận điều kiện** (5 trường hợp, mili-giây), **integration test lo ba thứ unit không thấy được** — làm tròn khi ghi xuống cột nguyên, hành vi khi ghi thất bại, và ràng buộc ở tầng dữ liệu.

Nếu đảo ngược — chạy 5 trường hợp điều kiện qua database — bộ test chậm gấp trăm lần mà không kiểm chứng thêm gì.

## Prediction

1. Hàm tính giá dùng `number`, cột DB là `numeric(12,2)` — unit test có phát hiện lệch không?
2. Integration test có phát hiện không?
3. Mock repository chấp nhận mọi dữ liệu, DB có ràng buộc `NOT NULL` — unit test có bắt được thiếu trường không?
4. Code quên `await` một lời gọi DB — unit test với mock có bắt được không?
5. Integration test có bắt được không?
6. Migration chưa bao giờ chạy trên schema giống production — rủi ro gì?
7. 500 integration test, mỗi test truncate 40 bảng — thời gian chạy?
8. Cùng số test nhưng mỗi test dùng tenant riêng, chạy song song 8 worker — thời gian chạy?
9. Hai test cùng tạo user với email cố định `test@example.com`, chạy song song — kết quả?
10. Logic trộn trong hàm có 3 lời gọi DB — viết unit test cho nó mất bao nhiêu mock?
11. Sau khi tách logic thuần ra — bao nhiêu mock?
12. Module không được import vào AppModule — loại test nào bắt được?

<details>
<summary>Đáp án</summary>

1. **Không** — nó không bao giờ chạm tầng lưu trữ.
2. **Có** — giá trị đi qua kiểu thật của cột.
3. **Không** — mock chấp nhận mọi thứ.
4. Thường **không** — mock trả về giá trị đồng bộ hoặc promise đã resolve.
5. **Có** — dữ liệu không có trong DB khi test đọc lại.
6. Migration hỏng lần đầu chạy trên **production**.
7. Chậm — truncate là chi phí chính; hàng phút.
8. Nhanh hơn nhiều — song song là đòn bẩy lớn nhất ở tầng này.
9. **Xung đột unique constraint** — flaky ngẫu nhiên tuỳ thứ tự.
10. Ít nhất ba, cộng với việc thiết lập giá trị trả về cho từng cái.
11. **Không mock nào** — hàm thuần nhận đối tượng dữ liệu.
12. **Integration hoặc E2E** khởi động ứng dụng thật; unit test không bao giờ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi kiểu cột từ `integer` sang `numeric` | Unit test có đỏ không? Integration? |
| Thêm ràng buộc `NOT NULL` cho một cột | Loại test nào bắt được? |
| Xoá một `await` trước lời gọi DB | Loại test nào bắt được? |
| Gỡ một module khỏi `AppModule` | Loại test nào bắt được? |
| Chạy integration test song song 8 worker | Có xung đột dữ liệu không? |
| Đặt email cố định trong hai test | Chạy song song xem sao |
| Đo thời gian từng file test | Chỗ nào chiếm phần lớn? |
| Đếm số mock trong một file unit test | Nhiều hơn 3 = dấu hiệu thiết kế chặt |
| Chạy migration trên DB rỗng từ đầu | Có chạy được không? |
| Chạy migration trên bản sao schema production | Có chạy được không? |

## What Usually Goes Wrong

- **Bộ test toàn unit** → mù với kiểu dữ liệu, ràng buộc, transaction.
- **Bộ test toàn integration** → chậm, không ai chạy trước khi push.
- **Mock repository trong unit test** rồi tin rằng đã kiểm chứng lưu trữ.
- **Logic trộn với I/O** → không tách tầng được, mọi test đều đắt.
- **Dữ liệu cố định** giữa các test → xung đột khi chạy song song.
- **Không dọn dữ liệu** → test phụ thuộc thứ tự chạy.
- **Không test migration** → production là môi trường test đầu tiên.
- **Integration test dùng DB dùng chung** giữa nhiều người → flaky.
- **Không test đường lỗi của I/O** — DB down, timeout, ràng buộc vi phạm.
- **Coi "khó test" là vấn đề của test** thay vì phản hồi về thiết kế.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Unit = một class | Unit = một hành vi không cần I/O |
| Mock DB nhanh hơn nên tốt hơn | Nó cũng kiểm chứng ít hơn nhiều |
| Integration test luôn chậm | Với container và song song, nó khá nhanh |
| Unit test đủ nếu coverage cao | Nó mù với cả một lớp lỗi |
| Test DB thật là "không phải unit test" nên xấu | Tên gọi không quan trọng; giá trị mới quan trọng |
| Tỉ lệ 70/20/10 là quy tắc | Nó là quan sát, không phải mục tiêu |
| Khó viết test = test phức tạp | Thường là code đang kết dính chặt |
| Migration không cần test | Nó là code chạy đúng một lần trên dữ liệu thật |
| Chạy song song là tối ưu hoá cuối | Nó thường là đòn bẩy lớn nhất |

## Debugging

1. **Bộ test chậm** → đo theo file, không theo tổng. Thường vài file chiếm phần lớn thời gian.
2. **Chậm ở integration** → kiểm tra chiến lược dọn dữ liệu; `TRUNCATE` 40 bảng mỗi test là nghi phạm số một.
3. **Flaky khi chạy song song** → tìm dữ liệu cố định dùng chung (email, slug, ID cứng).
4. **Test pass riêng lẻ, đỏ khi chạy cả bộ** → trạng thái còn sót; chạy với thứ tự ngẫu nhiên để xác nhận.
5. **Bug production không test nào bắt** → hỏi "kiểm chứng này thuộc tầng nào" và thêm vào đúng tầng đó.
6. **Không biết ORM sinh SQL gì** → bật log query trong integration test; đây thường là lúc phát hiện N+1.
7. **Container khởi động chậm** → tái sử dụng container giữa các lần chạy local; xem [Testcontainers](05-testcontainers.md).

## Production Considerations

- **Tách logic thuần khỏi I/O** — đây là quyết định làm mọi thứ khác rẻ hơn.
- **Unit test cho ma trận điều kiện**; integration test cho **chỗ nối**, ít trường hợp.
- **DB thật trong integration test**, không dùng SQLite thay PostgreSQL.
- **Mỗi test tự dựng dữ liệu duy nhất** (tenant/user riêng) để chạy song song.
- **Chạy song song** với worker theo số core; đây là đòn bẩy lớn nhất.
- **Test migration** trên DB rỗng và trên bản sao schema production trong CI.
- **Test đường lỗi của I/O**: ràng buộc vi phạm, timeout, kết nối đứt.
- **Bộ unit + integration dưới 5 phút**; nếu vượt, chia theo thư mục thay đổi.
- **Log query trong integration test** khi debug — nó là nguồn phát hiện N+1 rẻ nhất.
- **Chạy thứ tự ngẫu nhiên** định kỳ để lộ phụ thuộc ngầm.
- **Cùng phiên bản database với production** — hành vi khác nhau giữa các bản chính.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Nhiều unit test | nhanh, ổn định | mù với hạ tầng |
| Nhiều integration test | bắt lỗi thật | chậm hơn, cần container |
| Mock DB | rất nhanh | kiểm chứng mock của mình |
| DB thật | kiểm chứng thật | hạ tầng và thời gian |
| Transaction rollback để dọn | nhanh nhất | không test được transaction thật |
| Truncate | đúng mọi trường hợp | chậm hơn |
| Dữ liệu duy nhất mỗi test | song song được | cần kỷ luật phạm vi |
| Schema riêng mỗi worker | cô lập tuyệt đối | tốn tài nguyên |
| Tách logic khỏi I/O | test rẻ, code rõ | thêm một lớp gián tiếp |
| SQLite thay PostgreSQL | nhanh, không container | hành vi khác → test nói dối |

## Explain Without Notes

1. Ranh giới thật giữa unit và integration là gì?
2. Sáu vùng mà unit test mù, mỗi vùng một ví dụ.
3. Câu hỏi một dòng để chọn tầng cho một kiểm chứng?
4. Vì sao "khó viết unit test" là phản hồi về thiết kế?
5. Bốn chiến lược cô lập dữ liệu và đánh đổi của từng cái.
6. Vì sao chạy song song thường là đòn bẩy lớn nhất ở tầng integration?
7. Vì sao dùng SQLite thay PostgreSQL trong test là lựa chọn tồi?
8. Vì sao migration cần test, và test cái gì?

## Related

- [Test theo behavior](01-testing-pyramid-behavior.md) — nguyên tắc nền
- [API & E2E tests](03-api-e2e-tests.md) — tầng trên
- [Mocking & test doubles](04-mocking-test-doubles.md) — mock ở đâu
- [Testcontainers](05-testcontainers.md) — hạ tầng thật trong test
- [Deterministic tests](06-deterministic-tests.md) — chống flaky khi chạy song song
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — thứ cần được test
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — ràng buộc mà mock không có
- [Testing NestJS](../../02-backend-api/02-nestjs/behavior/09-testing-nestjs.md) — cài đặt cụ thể

## Version / Context

Ví dụ dùng Jest/Vitest, Prisma, PostgreSQL 16. Vitest hỗ trợ chạy song song theo file mặc định; Jest dùng `--maxWorkers`. Nguyên tắc không phụ thuộc công cụ.
