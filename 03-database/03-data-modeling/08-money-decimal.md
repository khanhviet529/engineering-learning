---
level: intermediate
area: database
prerequisites:
  - 01-constraints-invariants.md
related:
  - 07-datetime-timezone.md
  - ../../02-backend-api/00-http-api/02-rest-api-contract.md
---

# Tiền & Decimal

> `0.1 + 0.2 !== 0.3`. Ai cũng biết câu này, và vẫn viết `price: Float` trong schema. Sai số không xuất hiện ở giao dịch đầu tiên — nó xuất hiện ở bảng đối chiếu cuối tháng, khi tổng lệch 47 đồng và không ai biết vì sao.

## Position

```text
Người dùng nhập "1.250.000 ₫"
      ↓ parse
Application (kiểu gì?)
      ↓ JSON qua HTTP (kiểu gì?)
Database (numeric? bigint? float?)
      ↓
Báo cáo · đối chiếu · hoá đơn
```

Bốn chỗ có thể mất chính xác, và mất ở một chỗ là mất cả chuỗi.

## Problem

```ts
0.1 + 0.2;                    // 0.30000000000000004
1.1 * 3;                      // 3.3000000000000003
0.07 * 100;                   // 7.000000000000001
(2.675).toFixed(2);           // "2.67"  ← không phải "2.68"
```

Nguyên nhân: `Number` trong JavaScript là **IEEE 754 double** — nó biểu diễn số ở hệ nhị phân. `0.1` không biểu diễn chính xác được bằng nhị phân, giống như `1/3` không biểu diễn chính xác được bằng thập phân.

Với một giao dịch, sai số là 10⁻¹⁷ — vô hại. Với 100.000 giao dịch cộng dồn, sai số tích luỹ thành đồng thật. Và với `toFixed()` làm tròn sai (như `2.675` ở trên), bạn có sai số ngay từ giao dịch đầu.

Bốn hệ quả thực tế:

| Hệ quả | Ví dụ |
|---|---|
| Tổng lệch khi đối chiếu | báo cáo tháng lệch vài chục đồng, không tìm ra nguồn |
| So sánh sai | `if (paid === total)` là `false` dù đã trả đủ |
| Làm tròn không nhất quán | cùng đơn hàng, hai nơi tính ra hai số |
| Chia không chia hết | giảm giá 1/3 trên 1000 đồng → mất hoặc thừa 1 đồng |

## Mental Model

Hai cách lưu tiền đúng, và **cả hai đều không dùng float**:

```text
1. SỐ NGUYÊN, ĐƠN VỊ NHỎ NHẤT  (minor unit)
   1.250.000 ₫ → 1250000        (VND không có đơn vị nhỏ hơn)
   $12.50      → 1250            (cent)
   → PostgreSQL: bigint          TypeScript: number (an toàn tới 2^53) hoặc bigint
   → cộng/trừ chính xác tuyệt đối, không cần thư viện

2. DECIMAL CHÍNH XÁC TUỲ Ý
   → PostgreSQL: numeric(19,4)   TypeScript: Decimal (thư viện)
   → đúng cho cả nhân/chia, giá đơn vị nhiều chữ số thập phân
```

Cách chọn:

| Tình huống | Chọn |
|---|---|
| Chỉ cộng/trừ số tiền, một loại tiền tệ | **số nguyên minor unit** — đơn giản nhất |
| Có tỉ giá, thuế theo %, giá đơn vị lẻ (0,0001 $/đơn vị) | **numeric** |
| Nhiều loại tiền tệ | **numeric + cột currency**, hoặc integer + biết exponent của từng tệ |
| Hệ thống tài chính / kế toán | **numeric**, và ghi rõ quy tắc làm tròn |

Câu chốt:

> **Không bao giờ `float`/`double`/`real` cho tiền. Không có ngoại lệ.**

Và một câu ít được nói:

> **Đơn vị nhỏ nhất không giống nhau giữa các loại tiền tệ.** VND có 0 chữ số thập phân, USD có 2, KWD có 3, JPY có 0. Nếu bạn hardcode "×100", bạn sai với VND (nhân thừa) và với KWD (nhân thiếu).

## How It Works

### PostgreSQL

```sql
-- ✅ Số nguyên minor unit
CREATE TABLE orders (
  id            uuid PRIMARY KEY,
  total_minor   bigint NOT NULL CHECK (total_minor >= 0),   -- 1250000 = 1.250.000 ₫
  currency      char(3) NOT NULL DEFAULT 'VND'
);

-- ✅ Numeric — precision và scale TƯỜNG MINH
CREATE TABLE orders (
  total    numeric(19,4) NOT NULL CHECK (total >= 0),
  currency char(3) NOT NULL
);

-- ⚠️ numeric KHÔNG có precision: chính xác nhưng chậm hơn và không có ràng buộc
total numeric NOT NULL

-- ❌ Không bao giờ
total double precision;
total real;
total float;
```

`numeric(19,4)` nghĩa là: tối đa 19 chữ số, trong đó 4 chữ số sau dấu thập phân. 4 chữ số là lựa chọn phổ biến vì nó đủ cho tỉ giá và giá đơn vị nhỏ, đồng thời tránh sai số làm tròn trung gian.

**`numeric` chính xác nhưng chậm hơn `bigint`** — nó là kiểu có độ dài thay đổi, tính toán bằng software chứ không bằng CPU. Với bảng hàng trăm triệu dòng và nhiều aggregate, khác biệt là đo được. Với phần lớn ứng dụng thì không đáng lo.

### Prisma

```prisma
model Order {
  id String @id @default(uuid(7)) @db.Uuid

  // Cách 1: số nguyên minor unit
  totalMinor BigInt @map("total_minor")

  // Cách 2: Decimal
  total    Decimal @db.Decimal(19, 4)
  currency String  @db.Char(3)
}
```

Hai bẫy của Prisma ở đây:

**1. `Decimal` không phải `number`.** Prisma trả về một object `Decimal` (từ decimal.js). Nó **không** cộng được bằng `+`:

```ts
const a = order.total;              // Decimal
const b = discount.amount;          // Decimal

a + b;                              // ❌ nối string hoặc NaN
a.plus(b);                          // ✅
a.minus(b).times(0.9).toFixed(2);   // ✅
a.equals(b);                        // ✅ — KHÔNG dùng ===
```

**2. `Decimal` và `BigInt` đều không serialize được** bằng `JSON.stringify`:

```ts
res.json({ total: order.total });        // ❌ với BigInt: throw
                                         //    với Decimal: ra object lạ
res.json({ total: order.total.toString() });   // ✅
```

Đây là lý do cần một lớp chuyển đổi ở ranh giới API — xem phần dưới.

### Ở API — dùng string

```json
// ✅ String: không mất chính xác, client tự parse bằng thư viện decimal
{ "total": "1250000", "currency": "VND" }

// ✅ Hoặc tường minh về đơn vị
{ "totalMinor": "1250000", "currency": "VND", "exponent": 0 }

// ❌ Number: client JavaScript sẽ parse thành double
{ "total": 1250000.50 }
```

Vì sao string: `JSON.parse` biến mọi số thành `double`. Nếu bạn trả `number`, client **mất chính xác ngay lúc parse**, trước cả khi làm gì với nó. Với số lớn (> 2⁵³) thì mất luôn cả phần nguyên.

Trả kèm `currency` **luôn luôn** — một con số tiền không có đơn vị tiền tệ là dữ liệu không đầy đủ.

### Làm tròn — quy tắc phải tường minh

```ts
// ❌ toFixed() dùng làm tròn nhị phân → không đoán được
(2.675).toFixed(2);          // "2.67"  (vì 2.675 thực ra là 2.67499...)
(1.005).toFixed(2);          // "1.00"

// ✅ Decimal với chế độ làm tròn TƯỜNG MINH
import Decimal from 'decimal.js';
new Decimal('2.675').toFixed(2, Decimal.ROUND_HALF_UP);   // "2.68"
```

Bốn chế độ hay dùng, và chúng cho kết quả khác nhau:

```text
ROUND_HALF_UP     2.5 → 3,  -2.5 → -3     (phổ biến trong thương mại)
ROUND_HALF_EVEN   2.5 → 2,  3.5 → 4       (banker's rounding — giảm bias khi cộng nhiều)
ROUND_DOWN        2.9 → 2                  (truncate)
ROUND_UP          2.1 → 3
```

**Chọn một và ghi vào tài liệu.** Nếu backend dùng `HALF_UP` và frontend dùng `toFixed()`, hai bên hiển thị hai số khác nhau cho cùng đơn hàng — và khách hàng sẽ chụp màn hình.

Với kế toán, `ROUND_HALF_EVEN` được ưa hơn vì nó không lệch về một phía khi cộng dồn nhiều lần.

### Thuế và giảm giá — thứ tự quyết định kết quả

```ts
// Ba cách tính, ba kết quả khác nhau cho cùng input
const subtotal = new Decimal('1000000');
const taxRate = new Decimal('0.1');
const discountRate = new Decimal('0.15');

// A: giảm giá trước, thuế sau
const a = subtotal.times(new Decimal(1).minus(discountRate)).times(new Decimal(1).plus(taxRate));

// B: thuế trước, giảm giá sau
const b = subtotal.times(new Decimal(1).plus(taxRate)).times(new Decimal(1).minus(discountRate));

// C: làm tròn ở mỗi bước (đúng như hoá đơn thật)
const afterDiscount = subtotal.times(new Decimal(1).minus(discountRate))
                              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const tax = afterDiscount.times(taxRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const c = afterDiscount.plus(tax);
```

A và B ra cùng số (phép nhân giao hoán), nhưng **C khác** vì làm tròn ở giữa. Và C thường là cái đúng về mặt pháp lý — hoá đơn phải hiển thị từng dòng đã làm tròn, và tổng phải bằng tổng các dòng đã làm tròn.

Quy tắc: **thứ tự tính và điểm làm tròn là quy tắc nghiệp vụ**, không phải chi tiết implementation. Nó phải được viết ra và test.

```ts
// Test cho quy tắc làm tròn — đây là loại test đáng viết nhất
it('tổng bằng tổng các dòng đã làm tròn', () => {
  const lines = [line(333, 1), line(333, 1), line(334, 1)];
  const invoice = calculateInvoice(lines);
  const sumOfLines = lines.reduce((s, l) => s.plus(l.total), new Decimal(0));
  expect(invoice.total.equals(sumOfLines)).toBe(true);
});
```

### Chia — vấn đề "1 đồng lẻ"

```text
Chia 1000 ₫ cho 3 người:
  333 + 333 + 333 = 999    ← MẤT 1 đồng
```

Tiền không chia hết được. Phải có quy tắc phân bổ phần lẻ:

```ts
function allocate(totalMinor: number, parts: number): number[] {
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  // Phân bổ phần lẻ cho các phần đầu — tổng LUÔN đúng
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

allocate(1000, 3);   // [334, 333, 333] — tổng = 1000 ✅
```

Đây là thuật toán cần thiết cho: chia hoá đơn, phân bổ giảm giá theo dòng, chia hoa hồng. Nguyên tắc: **tổng phải bất biến**, và phần lẻ đi đâu là một quyết định (phần đầu, phần lớn nhất, hoặc luân phiên).

### Nhiều loại tiền tệ

```sql
CREATE TABLE payments (
  amount        numeric(19,4) NOT NULL,
  currency      char(3)       NOT NULL,          -- ISO 4217
  -- Nếu có quy đổi: lưu CẢ tỉ giá và thời điểm
  fx_rate       numeric(19,8),
  fx_at         timestamptz,
  amount_base   numeric(19,4)                     -- quy đổi về tiền tệ gốc của hệ thống
);
```

Ba nguyên tắc:

1. **Không bao giờ cộng hai số tiền khác currency.** Đây nên là lỗi compile hoặc lỗi runtime, không phải phép cộng im lặng.
2. **Lưu tỉ giá và thời điểm quy đổi**, không chỉ kết quả — nếu không, bạn không đối chiếu lại được.
3. **Số chữ số thập phân theo từng tệ** (VND: 0, USD: 2, KWD: 3). Đừng hardcode 2.

```ts
// Money type: currency là phần của kiểu, không phải metadata
type Money = { readonly minor: bigint; readonly currency: Currency };

function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Không cộng được ${a.currency} với ${b.currency}`);
  }
  return { minor: a.minor + b.minor, currency: a.currency };
}
```

### Hiển thị

```ts
// Intl.NumberFormat lo dấu phân cách, ký hiệu, số chữ số theo locale + currency
const fmt = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
fmt.format(1250000);        // "1.250.000 ₫"

new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(12.5);
// "$12.50"
```

`Intl.NumberFormat` tự biết VND không có phần thập phân và USD có 2 — đó là lý do dùng nó thay vì tự format. Tạo ở **module scope**, không trong render.

## Example

```ts
// Chuyển đổi ở ranh giới: Decimal bên trong, string ra ngoài
const OrderDto = z.object({
  id: z.string(),
  totalMinor: z.string(),        // "1250000"
  currency: z.string().length(3),
});

function toDto(order: Order) {
  return {
    id: order.id,
    totalMinor: order.totalMinor.toString(),   // BigInt → string
    currency: order.currency,
  };
}
```

```prisma
model Order {
  id         String @id @default(uuid(7)) @db.Uuid
  totalMinor BigInt @map("total_minor")
  currency   String @db.Char(3)

  @@check([/* total_minor >= 0 — khai báo trong migration SQL */])
}
```

Constraint `CHECK (total_minor >= 0)` viết trong migration SQL — nó là lớp bảo vệ cuối, và database không cho phép số tiền âm lọt vào dù code có bug. Xem [Constraints & invariants](01-constraints-invariants.md).

## Prediction

1. `price Float` trong schema, cộng 100.000 giao dịch — tổng lệch bao nhiêu?
2. `(2.675).toFixed(2)` — kết quả? Vì sao?
3. Prisma `Decimal`, viết `order.total + discount.amount` — kết quả?
4. `res.json({ total: order.totalMinor })` với `BigInt` — kết quả?
5. Trả `{ "total": 1250000.50 }` dạng number, client `JSON.parse` — có mất chính xác?
6. Backend `ROUND_HALF_UP`, frontend `toFixed()` — hai bên hiển thị giống nhau?
7. Chia 1000 cho 3 bằng `Math.floor(1000/3)` cho cả ba phần — tổng bằng bao nhiêu?
8. Hardcode `× 100` để đổi sang minor unit, với VND — kết quả?
9. Cộng `{amount: 100, currency: 'USD'}` với `{amount: 100, currency: 'VND'}` không kiểm tra — kết quả?

<details>
<summary>Đáp án</summary>

1. Không đoán trước được — đó là vấn đề. Sai số tích luỹ, thường vài chục tới vài trăm đơn vị.
2. `"2.67"` — vì `2.675` trong double thực ra là `2.67499...`.
3. Nối string hoặc `NaN` — `Decimal` không có toán tử `+`. Dùng `.plus()`.
4. Throw `TypeError: Do not know how to serialize a BigInt`.
5. Có — `JSON.parse` biến nó thành double.
6. **Không** — `toFixed` làm tròn nhị phân, `HALF_UP` làm tròn thập phân.
7. 999 — mất 1.
8. Nhân thừa 100 lần; VND đã là đơn vị nhỏ nhất.
9. 200 "gì đó" — dữ liệu vô nghĩa, không có lỗi nào.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Cột `float`, insert 100.000 giá trị `0.01`, `SUM()` | Kết quả không phải `1000.00` |
| Cột `numeric`, làm lại | Chính xác |
| `console.log(0.1 + 0.2 === 0.3)` | `false` |
| `(2.675).toFixed(2)` và `(1.005).toFixed(2)` | Cả hai làm tròn xuống |
| Prisma `Decimal` với `+` | Kết quả sai/lạ |
| `res.json()` với `BigInt` | Throw |
| Trả number lớn > 2⁵³, parse ở client | Mất chính xác phần nguyên |
| Backend `HALF_UP`, frontend `toFixed`, so 100 đơn hàng | Tìm số lệch |
| `Math.floor` chia 3 phần, so tổng | Mất 1 |
| Cộng hai currency khác nhau | Không có lỗi — dữ liệu sai im lặng |
| Test: tổng hoá đơn vs tổng các dòng đã làm tròn | Fail nếu làm tròn không nhất quán |

Thí nghiệm cuối là test đáng viết nhất cho mọi hệ thống có hoá đơn.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `float` đủ chính xác cho tiền | Sai số tích luỹ, và `toFixed` làm tròn sai ngay từ đầu |
| `toFixed()` làm tròn đúng | Nó làm tròn trên biểu diễn nhị phân |
| Nhân 100 là đủ để có minor unit | Số chữ số thập phân khác nhau theo từng tệ |
| `Decimal` cộng được bằng `+` | Cần `.plus()`, và so sánh bằng `.equals()` |
| Trả number trong JSON là ổn | `JSON.parse` biến thành double |
| Thứ tự tính thuế/giảm giá không quan trọng | Điểm làm tròn đổi kết quả |
| Tiền chia được đều | Cần thuật toán phân bổ phần lẻ |
| Một số tiền không cần currency | Nó là dữ liệu không đầy đủ |
| `numeric` không có precision là an toàn nhất | Chính xác nhưng chậm hơn và không có ràng buộc |

## Debugging

1. **Tổng lệch một số nhỏ** → kiểm tra kiểu cột **trước tiên**:
   ```sql
   SELECT column_name, data_type, numeric_precision, numeric_scale
   FROM information_schema.columns
   WHERE table_name = 'orders' AND column_name LIKE '%total%' OR column_name LIKE '%amount%';
   ```
   `double precision` hoặc `real` là nguyên nhân, không cần tìm tiếp.
2. **Grep float trong schema**: `grep -rn "Float\|double precision\|real" prisma/ migrations/`.
3. **Hai nơi hiển thị hai số** → so quy tắc làm tròn ở backend và frontend. Đây là nguyên nhân số một của loại bug này.
4. **Tổng hoá đơn ≠ tổng các dòng** → điểm làm tròn không nhất quán; viết test cho invariant đó.
5. **`JSON.stringify` throw** → có `BigInt` chưa convert; thêm serializer ở ranh giới.
6. **Số tiền âm trong dữ liệu** → thiếu `CHECK` constraint; thêm ngay và backfill.
7. **Kiểm tra currency mismatch**:
   ```sql
   SELECT DISTINCT currency FROM payments;   -- có giá trị lạ không?
   ```

## Production Considerations

- **Không bao giờ float.** `bigint` (minor unit) hoặc `numeric(19,4)`.
- **`CHECK (amount >= 0)`** cho mọi cột tiền, trừ khi âm là hợp lệ (điều chỉnh, hoàn tiền).
- **Luôn lưu `currency`** cùng số tiền; không cộng hai currency khác nhau.
- **Một quy tắc làm tròn duy nhất**, ghi vào ADR, và **dùng chung** giữa frontend và backend (chia sẻ hàm tính, không copy).
- **Test invariant**: tổng = tổng các dòng đã làm tròn; phân bổ phần lẻ giữ tổng.
- **API trả string**, kèm `currency`.
- **Serializer ở ranh giới** để `BigInt`/`Decimal` không rò rỉ ra `res.json()`.
- **Lưu tỉ giá + thời điểm** khi có quy đổi.
- **`Intl.NumberFormat` ở module scope**, dựa vào nó cho số chữ số thập phân theo tệ.
- Với hệ thống kế toán: cân nhắc **ledger append-only** (mỗi thay đổi là một dòng, số dư là tổng) thay vì cột `balance` bị update — nó cho audit trail và không có lost update. Xem [Soft delete & audit](05-soft-delete-audit-patterns.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `bigint` minor unit | chính xác tuyệt đối khi cộng/trừ, nhanh, nhỏ | phải biết exponent từng tệ; nhân/chia cần cẩn thận |
| `numeric(19,4)` | đúng cho cả nhân/chia, giá lẻ | chậm hơn `bigint`, cần thư viện Decimal ở app |
| `numeric` không precision | linh hoạt | chậm hơn, không có ràng buộc |
| String ở API | không mất chính xác | client phải parse bằng thư viện |
| Number ở API | tiện | mất chính xác lúc `JSON.parse` |
| `ROUND_HALF_UP` | trực giác thương mại | lệch nhẹ về phía trên khi cộng nhiều |
| `ROUND_HALF_EVEN` | không lệch khi cộng dồn | phản trực giác với người dùng |
| Ledger append-only | audit đầy đủ, không lost update | phức tạp hơn, cần tính tổng hoặc snapshot |

## Explain Without Notes

1. Vì sao `float` sai cho tiền, và vì sao sai số không xuất hiện ngay?
2. Hai cách lưu tiền đúng, và chọn theo tiêu chí gì?
3. Vì sao `toFixed(2)` không đáng tin?
4. Vì sao thứ tự tính thuế/giảm giá đổi kết quả?
5. Thuật toán phân bổ 1000 cho 3 phần sao cho tổng đúng?
6. Vì sao API phải trả tiền dạng string?

## Related

- [Constraints & invariants](01-constraints-invariants.md) — `CHECK` cho số tiền
- [Date, time & timezone](07-datetime-timezone.md) — cùng họ "kiểu dữ liệu dễ làm sai"
- [ID strategy](06-id-strategy.md) — `BigInt` cũng không serialize được
- [Soft delete & audit](05-soft-delete-audit-patterns.md) — ledger append-only
- [Prisma model & client](../05-data-access/02-prisma-model-and-client.md) — `Decimal`, `BigInt`
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — quy ước dữ liệu ở API
- [Transaction isolation](../01-postgresql/transactions-concurrency/01-transaction-isolation.md) — lost update trên số dư
- [Export & reporting](../../02-backend-api/00-http-api/10-export-and-reporting.md) — định dạng tiền trong export
