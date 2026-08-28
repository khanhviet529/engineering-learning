---
level: advanced
area: cross-cutting
prerequisites:
  - 01-concurrency-models.md
related:
  - 03-distributed-locks.md
  - ../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md
---

# Shared state & race conditions

> Một chương trình khuyến mãi giới hạn 100 suất. Hệ thống bán được 137 suất. Code kiểm tra rõ ràng: đọc số suất đã dùng, nếu `< 100` thì cộng thêm một. Nó chạy đúng trong mọi test. Nó chạy đúng suốt sáu tháng với lưu lượng bình thường. Nó sai **chỉ trong 4 giây đầu tiên** khi chiến dịch mở, khi 2.000 người bấm cùng lúc. **Race condition không phải bug hiếm — nó là bug chỉ xuất hiện khi hệ thống thành công.**

## Position

```text
Đọc → Quyết định → Ghi
  ↑         ↑        ↑
  └─────────┴────────┴─ nếu ai đó chen vào GIỮA, quyết định đã dựa trên dữ liệu CŨ
```

## Problem

```text
Race condition có ba tính chất khiến nó đặc biệt khó chịu:

  ① KHÔNG TÁI LẬP ĐƯỢC   phụ thuộc thời điểm; test đơn lẻ luôn pass
  ② XUẤT HIỆN KHI THÀNH CÔNG  cần lưu lượng cao mới lộ ra
  ③ IM LẶNG               không có exception, không có log lỗi
                          → dữ liệu sai, và không ai biết trong bao lâu
```

## Mental Model

### Ba mẫu race phổ biến

```text
① READ-MODIFY-WRITE (lost update)
   A đọc 100 · B đọc 100 · A ghi 130 · B ghi 120
   → mất cập nhật của A

② CHECK-THEN-ACT
   A kiểm tra "chưa tồn tại" · B kiểm tra "chưa tồn tại" · cả hai tạo
   → trùng lặp  ← chính là sự cố ở đầu note

③ TIME-OF-CHECK TO TIME-OF-USE (TOCTOU)
   kiểm tra quyền · (trạng thái đổi) · thực hiện
   → thực hiện với quyền đã bị thu hồi
```

Cả ba đều có cùng hình dạng: **một khoảng thời gian giữa lúc biết và lúc hành động**.

### Trong JavaScript, mọi `await` là một điểm chen ngang

```ts
// ✗ giữa hai await, request khác chạy được
async function useCoupon(code: string) {
  const coupon = await this.repo.find(code);        // ← A và B cùng đọc used = 99
  if (coupon.used >= coupon.limit) throw new Error('hết suất');
  await this.repo.update(code, { used: coupon.used + 1 });   // ← cả hai ghi 100
}
```

```text
JavaScript đơn luồng KHÔNG bảo vệ bạn ở đây.
Nó chỉ đảm bảo không có hai luồng ghi cùng một biến trong bộ nhớ.
Chuỗi đọc-quyết định-ghi qua database thì hoàn toàn có thể xen kẽ.
```

### Bốn cách chặn, theo thứ tự nên thử

```text
① NGUYÊN TỬ HOÁ Ở DATABASE           ← rẻ nhất và mạnh nhất
   để database làm phép tính, đừng đọc rồi ghi
② RÀNG BUỘC                           unique, check — database từ chối trạng thái sai
③ OPTIMISTIC LOCKING (version)        phát hiện xung đột, thử lại
④ PESSIMISTIC LOCKING (SELECT FOR UPDATE)  khoá trước khi đọc
```

**① Nguyên tử hoá:**

```sql
-- điều kiện nằm TRONG câu UPDATE — không có khoảng trống nào
UPDATE coupons
   SET used = used + 1
 WHERE code = $1 AND used < limit
RETURNING used;
-- 0 dòng trả về = hết suất. Không cần đọc trước.
```

```text
Vì sao cách này mạnh nhất:
  · không có khoảng thời gian giữa kiểm tra và ghi
  · một lệnh, một vòng khứ hồi
  · không cần lock tường minh, không cần retry
```

**② Ràng buộc:**

```sql
-- check-then-act cho việc tạo: để database từ chối
CREATE UNIQUE INDEX ON registrations (event_id, user_id);
-- INSERT thứ hai thất bại với lỗi unique → bắt và xử lý
```

Ràng buộc là lớp phòng thủ **không thể quên**: nó đúng kể cả khi một đoạn code mới bỏ qua mọi kiểm tra ở tầng ứng dụng.

**③ Optimistic locking:**

```sql
UPDATE orders SET status = 'shipped', version = version + 1
 WHERE id = $1 AND version = $2;
-- 0 dòng = ai đó đã sửa → đọc lại và thử lại
```

```text
✓ khi xung đột HIẾM — không giữ lock, throughput cao
✗ khi xung đột NHIỀU — retry liên tục, lãng phí
```

**④ Pessimistic locking:**

```sql
BEGIN;
SELECT * FROM accounts WHERE id = $1 FOR UPDATE;   -- khoá dòng
-- ... tính toán ...
UPDATE accounts SET balance = $2 WHERE id = $1;
COMMIT;
```

```text
✓ khi xung đột NHIỀU và thao tác ngắn
✗ giữ lock → giảm throughput; và MỌI transaction phải khoá theo CÙNG THỨ TỰ
  (nếu không: deadlock)
```

### Isolation level không giải quyết mọi thứ

```text
READ COMMITTED (mặc định PostgreSQL)
  ✓ không đọc dữ liệu chưa commit
  ✗ KHÔNG chặn lost update
  ✗ KHÔNG chặn write skew

REPEATABLE READ
  ✓ đọc nhất quán trong transaction
  ✓ PostgreSQL PHÁT HIỆN lost update → lỗi serialization, bạn phải retry

SERIALIZABLE
  ✓ như thể chạy tuần tự
  ✗ nhiều lỗi serialization hơn → BẮT BUỘC có vòng retry
```

```text
Điểm quan trọng: isolation cao KHÔNG loại bỏ nhu cầu xử lý xung đột.
Nó chuyển từ "dữ liệu sai im lặng" sang "lỗi rõ ràng cần retry".
Đó là cải thiện lớn — nhưng chỉ khi bạn CÓ vòng retry.
```

Xem [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md).

### Write skew: race mà isolation thấp không thấy

```text
Quy tắc: luôn phải có ÍT NHẤT MỘT bác sĩ trực.
Hai bác sĩ đang trực. Cả hai cùng xin nghỉ.

  A: đếm bác sĩ trực = 2 → "còn 1 người sau khi tôi nghỉ" → nghỉ
  B: đếm bác sĩ trực = 2 → "còn 1 người sau khi tôi nghỉ" → nghỉ
  → 0 bác sĩ trực

Cả hai đọc và ghi các DÒNG KHÁC NHAU → không có lost update
→ READ COMMITTED và REPEATABLE READ đều KHÔNG chặn
→ cần SERIALIZABLE, hoặc khoá tường minh, hoặc ràng buộc ở tầng dữ liệu
```

Write skew là loại race khó nhất vì nó vi phạm một **bất biến trên nhiều dòng**, không phải trên một dòng.

### Idempotency: race giữa request và retry

```text
Client gửi request → timeout → retry
→ hai request CÙNG Ý ĐỊNH có thể chạy ĐỒNG THỜI

Kiểm tra `if (đã xử lý) return` KHÔNG đủ:
  cả hai vượt qua `if` trước khi cái nào ghi

⇒ ràng buộc UNIQUE trên idempotency key là thứ thực sự chặn
```

Xem [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md).

### Race ngoài database

```text
CACHE          hai request cùng miss → cùng tính → cùng ghi
               → single-flight: chỉ MỘT tính, các request khác chờ kết quả đó

FILE           hai process cùng ghi một file
               → ghi file tạm + rename (rename là nguyên tử trên cùng filesystem)

JOB THEO LỊCH  N pod cùng chạy `@Cron` lúc 00:00
               → bầu chọn leader, hoặc khoá phân tán, hoặc scheduler bên ngoài

BỘ NHỚ TRONG PROCESS  chỉ đúng với MỘT instance
               → với nhiều pod, mọi trạng thái phối hợp phải ở store dùng chung
```

Mục cuối đáng nhấn mạnh: rất nhiều "giải pháp chống race" bằng biến in-memory **im lặng ngừng hoạt động** khi hệ thống scale lên hai pod.

### Test race condition: ép nó xảy ra

```text
Test tuần tự KHÔNG BAO GIỜ bắt được race.
Phải CHỦ ĐỘNG tạo đồng thời:
```

```ts
it('không bán quá 100 suất khi 500 người mua đồng thời', async () => {
  await seedCoupon({ code: 'SALE', limit: 100, used: 0 });

  const results = await Promise.allSettled(
    Array.from({ length: 500 }, () => api.as(randomUser()).post('/coupons/SALE/redeem')),
  );

  const ok = results.filter(r => r.status === 'fulfilled' && r.value.status === 201);
  expect(ok).toHaveLength(100);                    // đúng 100, không phải 137

  const coupon = await db.coupon.findUniqueOrThrow({ where: { code: 'SALE' } });
  expect(coupon.used).toBe(100);
});
```

Test này biến một bug không tái lập được thành một test **xác định**. Nó cũng là thứ ngăn bug quay lại sau một lần refactor.

## Example

Sửa sự cố ở đầu note — bốn cách, so sánh trực tiếp:

```ts
// ✗ SAI: đọc, kiểm tra, ghi
async redeem(code: string, userId: string) {
  const coupon = await this.repo.find(code);
  if (coupon.used >= coupon.limit) throw new ConflictException('hết suất');
  await this.repo.update(code, { used: coupon.used + 1 });
  await this.repo.createRedemption(code, userId);
}
```

```ts
// ✓ CÁCH 1: nguyên tử hoá ở database — đơn giản nhất, hiệu quả nhất
async redeem(code: string, userId: string) {
  const rows = await this.db.$queryRaw<{ used: number }[]>`
    UPDATE coupons SET used = used + 1
     WHERE code = ${code} AND used < "limit"
    RETURNING used`;

  if (rows.length === 0) throw new ConflictException('hết suất');
  await this.repo.createRedemption(code, userId);
}
```

```ts
// ✓ CÁCH 2: ràng buộc — chặn cả trường hợp một người dùng dùng hai lần
// CREATE UNIQUE INDEX ON redemptions (coupon_code, user_id);
async redeem(code: string, userId: string) {
  try {
    return await this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        UPDATE coupons SET used = used + 1
         WHERE code = ${code} AND used < "limit" RETURNING used`;
      if ((rows as unknown[]).length === 0) throw new ConflictException('hết suất');

      return tx.redemption.create({ data: { couponCode: code, userId } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictException('bạn đã dùng mã này');
    throw err;
  }
}
```

```ts
// ✓ CÁCH 3: SERIALIZABLE + retry — khi logic phức tạp hơn một phép cộng
async redeem(code: string, userId: string) {
  return withSerializableRetry(3, () =>
    this.db.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUniqueOrThrow({ where: { code } });
      if (coupon.used >= coupon.limit) throw new ConflictException('hết suất');
      await tx.coupon.update({ where: { code }, data: { used: coupon.used + 1 } });
      return tx.redemption.create({ data: { couponCode: code, userId } });
    }, { isolationLevel: 'Serializable' }),
  );
}

async function withSerializableRetry<T>(max: number, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (!isSerializationFailure(err) || i >= max - 1) throw err;   // 40001
      await sleep(Math.random() * 50 * 2 ** i);                       // backoff + jitter
    }
  }
}
```

```text
So sánh:
  cách 1  một câu lệnh, không lock, không retry        → dùng khi diễn đạt được bằng SQL
  cách 2  cộng thêm lớp không thể quên                 → dùng cùng cách 1, luôn luôn
  cách 3  logic phức tạp, nhiều bảng                   → chi phí: vòng retry bắt buộc
  cách 4  SELECT FOR UPDATE — khi xung đột rất nhiều và thao tác ngắn
```

Điểm quan trọng: **cách 2 không thay thế cách 1, nó bổ sung**. Nguyên tử hoá xử lý luồng bình thường; ràng buộc là lưới an toàn cho mọi đoạn code trong tương lai.

## Prediction

1. Hai request cùng đọc `used = 99`, cùng kiểm tra `< 100`, cùng ghi `100` — bán được mấy suất?
2. `UPDATE ... SET used = used + 1 WHERE used < limit` với 500 request đồng thời — mấy suất?
3. JavaScript đơn luồng — nó có ngăn được race ở câu 1 không?
4. READ COMMITTED, hai transaction cùng đọc rồi cùng ghi một dòng — có lost update không?
5. REPEATABLE READ trong PostgreSQL — chuyện gì xảy ra với transaction thứ hai?
6. SERIALIZABLE nhưng không có vòng retry — người dùng thấy gì?
7. Hai bác sĩ cùng xin nghỉ, quy tắc "ít nhất một người trực", READ COMMITTED — kết quả?
8. Cùng vậy với SERIALIZABLE?
9. `if (đã xử lý) return` cho idempotency, hai retry chạy đồng thời — có chặn được không?
10. Ràng buộc UNIQUE trên key — có chặn được không?
11. Optimistic locking khi 90% request xung đột — hiệu quả thế nào?
12. `@Cron('0 0 * * *')` trên 5 pod — job chạy mấy lần?
13. Test tuần tự cho luồng mua coupon — có bắt được race không?
14. `Promise.allSettled` với 500 request đồng thời trong test — có bắt được không?

<details>
<summary>Đáp án</summary>

1. **101** — cả hai đều thành công dù chỉ còn một suất.
2. **Đúng 100** — điều kiện nằm trong câu lệnh.
3. **Không** — nó chỉ ngăn data race trong bộ nhớ.
4. **Có** — READ COMMITTED không chặn lost update.
5. PostgreSQL **phát hiện** và ném lỗi serialization (40001).
6. **Lỗi 500 ngẫu nhiên** khi có tải — isolation cao mà không retry là đổi bug này lấy bug khác.
7. **0 bác sĩ trực** — write skew.
8. Một transaction **bị từ chối** với lỗi serialization.
9. **Không** — cả hai vượt qua `if`.
10. **Có** — chỉ một `INSERT` thành công.
11. **Rất kém** — retry liên tục; nên dùng pessimistic lock.
12. **5 lần** — mỗi pod một lần.
13. **Không bao giờ.**
14. **Có** — nó ép tình huống đồng thời xảy ra.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| 500 request đồng thời vào endpoint có giới hạn | Có vượt giới hạn không? |
| Hai request đồng thời cập nhật cùng bản ghi | Có mất cập nhật không? |
| Hai request đồng thời tạo cùng tài nguyên duy nhất | Có trùng lặp không? |
| Xoá ràng buộc unique rồi lặp lại | Khác thế nào? |
| Đổi isolation từ READ COMMITTED sang SERIALIZABLE | Lỗi 40001 xuất hiện chưa? |
| Bỏ vòng retry với SERIALIZABLE | Người dùng thấy gì? |
| Chạy job `@Cron` với 3 pod | Chạy mấy lần? |
| Hai request cùng gây cache miss | Tính mấy lần? |
| Gửi cùng idempotency key hai lần đồng thời | Thao tác chạy mấy lần? |
| Dùng biến in-memory để khoá, chạy 2 pod | Còn hoạt động không? |
| Hai transaction khoá hai dòng theo thứ tự ngược | Deadlock? |

## What Usually Goes Wrong

- **Read-modify-write** thay vì cập nhật nguyên tử.
- **Check-then-act** không có ràng buộc bảo vệ.
- **Tin rằng JavaScript đơn luồng nên không có race.**
- **Dựa vào READ COMMITTED** để chặn lost update.
- **Dùng SERIALIZABLE mà không có vòng retry.**
- **Không nhận ra write skew** — bất biến trên nhiều dòng.
- **Idempotency chỉ bằng câu `if`.**
- **Trạng thái phối hợp trong bộ nhớ process** khi có nhiều instance.
- **Job theo lịch chạy trên mọi replica.**
- **Optimistic locking khi xung đột nhiều** → retry vô ích.
- **Khoá theo thứ tự khác nhau** → deadlock.
- **Không test đồng thời** → race chỉ lộ ở production.
- **Không log/đếm xung đột** → không biết chúng đang xảy ra.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| JavaScript đơn luồng nên an toàn | Mọi `await` là điểm chen ngang |
| Transaction ngăn mọi race | Chỉ ở mức isolation đủ cao, và cần retry |
| READ COMMITTED đủ cho hầu hết trường hợp | Nó không chặn lost update hay write skew |
| SERIALIZABLE giải quyết mọi thứ | Nó chuyển bug thành lỗi cần retry |
| Race là bug hiếm | Nó xuất hiện đúng lúc hệ thống thành công |
| Test đơn lẻ pass nghĩa là không có race | Test tuần tự không bao giờ bắt được |
| Kiểm tra trước khi ghi là đủ | Chỉ ràng buộc mới chặn được đồng thời |
| Lock luôn là câu trả lời | Cập nhật nguyên tử thường tốt hơn |
| Optimistic luôn tốt hơn pessimistic | Với xung đột nhiều thì ngược lại |
| Biến in-memory chống được race | Chỉ với đúng một instance |

## Debugging

1. **Nghi race khi**: dữ liệu sai mà không có lỗi; chỉ xảy ra lúc tải cao; không tái lập được đơn lẻ.
2. **Tìm mẫu đọc-quyết-định-ghi**: grep các đoạn có `find` rồi `update` trên cùng bản ghi.
3. **Kiểm tra ràng buộc**: bất biến này có được database bảo vệ không, hay chỉ có code kiểm tra?
4. **Viết test đồng thời** để tái lập — biến bug ngẫu nhiên thành xác định.
5. **Đếm lỗi serialization (40001)** và unique violation — chúng cho biết xung đột đang xảy ra ở đâu.
6. **Deadlock**: `SELECT * FROM pg_locks` và log deadlock của PostgreSQL cho biết hai transaction khoá gì theo thứ tự nào.
7. **Chạy nhiều instance trong staging** — race giữa các pod chỉ lộ ra ở đó.
8. **Sau khi sửa**: chạy test đồng thời 100 lần để xác nhận, không chạy một lần.

## Production Considerations

- **Ưu tiên cập nhật nguyên tử** ở database trước mọi cơ chế khoá.
- **Ràng buộc cho mọi bất biến** — nó là lớp không thể quên.
- **Optimistic locking khi xung đột hiếm; pessimistic khi nhiều.**
- **SERIALIZABLE cho logic phức tạp**, luôn kèm vòng retry với jitter.
- **Khoá theo thứ tự nhất quán** trong toàn hệ thống để tránh deadlock.
- **Idempotency bằng ràng buộc unique**, không bằng câu `if`.
- **Job theo lịch: bầu chọn leader hoặc khoá phân tán**, không chạy trên mọi replica.
- **Single-flight cho cache** để tránh thundering herd.
- **Trạng thái phối hợp ở Redis/DB**, không trong process.
- **Test đồng thời cho mọi bất biến quan trọng** (giới hạn, tồn kho, số dư, tính duy nhất).
- **Đo tỉ lệ xung đột**: unique violation, lỗi 40001, số lần retry.
- **Job đối soát định kỳ** cho bất biến quan trọng — phát hiện dữ liệu đã sai, không chỉ ngăn nó sai.
- **Ghi lại quyết định về đồng thời** cho mỗi bất biến: nó được bảo vệ bằng cơ chế nào?

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cập nhật nguyên tử | đơn giản, nhanh, không lock | chỉ diễn đạt được logic đơn giản |
| Ràng buộc | không thể quên | thông báo lỗi cần dịch sang ngôn ngữ nghiệp vụ |
| Optimistic lock | throughput cao khi ít xung đột | retry nhiều khi xung đột cao |
| Pessimistic lock | đúng khi xung đột cao | giữ lock, giảm throughput, rủi ro deadlock |
| SERIALIZABLE | chặn cả write skew | nhiều lỗi serialization, bắt buộc retry |
| READ COMMITTED | nhanh, ít xung đột | không chặn lost update và write skew |
| Khoá phân tán | phối hợp giữa nhiều instance | phức tạp, phụ thuộc Redis, có giới hạn |
| Job đối soát | phát hiện sai sót còn sót | thêm hệ thống, chạy sau khi đã sai |
| Test đồng thời | bắt được race | chậm hơn, khó viết |

## Explain Without Notes

1. Ba mẫu race phổ biến và hình dạng chung của chúng?
2. Vì sao JavaScript đơn luồng vẫn có race? `await` đóng vai trò gì?
3. Bốn cách chặn race theo thứ tự nên thử, và vì sao thứ tự đó?
4. Isolation level nào chặn được gì? Điều gì isolation cao **không** loại bỏ?
5. Write skew là gì và vì sao nó khó hơn lost update?
6. Vì sao ràng buộc unique quan trọng hơn câu `if` cho idempotency?
7. Khi nào dùng optimistic, khi nào dùng pessimistic locking?
8. Vì sao test tuần tự không bao giờ bắt được race, và cách viết test bắt được?

## Related

- [Concurrency models](01-concurrency-models.md) — nơi đồng thời đến từ đâu
- [Distributed locks](03-distributed-locks.md) — phối hợp giữa nhiều instance
- [Transaction isolation](../../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) — chi tiết isolation level
- [Locking & deadlock](../../03-database/01-postgresql/transactions-concurrency/03-locking-deadlock.md) — khoá ở PostgreSQL
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — ràng buộc ở tầng dữ liệu
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — race giữa request và retry
- [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md) — nguồn của retry đồng thời
- [Deterministic tests](../testing/06-deterministic-tests.md) — khi flaky hoá ra là race thật
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — single-flight

## Version / Context

Ví dụ dùng PostgreSQL 16 và Prisma với NestJS 10/11. PostgreSQL mặc định READ COMMITTED; REPEATABLE READ ở PostgreSQL thực chất là snapshot isolation và **phát hiện** lost update (khác chuẩn SQL); SERIALIZABLE dùng Serializable Snapshot Isolation. Mã lỗi 40001 là serialization failure, 23505 là unique violation. Thuật ngữ write skew theo Berenson và cộng sự (1995), được phổ biến lại trong *Designing Data-Intensive Applications*.
