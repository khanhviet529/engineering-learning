---
level: intermediate
area: database
prerequisites:
  - 01-constraints-invariants.md
related:
  - ../../02-backend-api/00-http-api/02-rest-api-contract.md
  - ../01-postgresql/fundamentals/01-architecture-and-acid.md
---

# Date, time & timezone

> Câu hỏi "báo cáo hôm nay" không có một câu trả lời. Hôm nay của ai — người dùng, server, hay công ty? Bug timezone không phải bug tính toán; nó là bug **thiếu quyết định**.

## Position

```text
Người dùng (múi giờ của họ)
      ↓ nhập/hiển thị
Browser (Intl API)
      ↓ ISO 8601 UTC qua HTTP
Backend (Node — process.env.TZ)
      ↓
PostgreSQL (timestamptz vs timestamp)
```

Bốn chỗ có múi giờ, và mỗi chỗ chuyển đổi sai một lần là một bug.

## Problem

```sql
-- Cột nào?
created_at timestamp        -- không có timezone
created_at timestamptz      -- có timezone
```

```ts
// "Báo cáo hôm nay" — hôm nay theo ai?
const today = new Date();
const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
// → múi giờ của SERVER. Nếu server UTC và user ở Việt Nam (UTC+7):
//   lúc 6h sáng ở VN, server vẫn đang ở "hôm qua"
//   → báo cáo thiếu 7 giờ dữ liệu, mỗi ngày
```

Bốn bug kinh điển, tất cả đều là bug **im lặng** — không có exception nào:

| Bug | Biểu hiện |
|---|---|
| Dùng `timestamp` thay `timestamptz` | dữ liệu đúng cho tới khi có user ở múi giờ khác, hoặc server đổi TZ |
| "Hôm nay" tính theo server | báo cáo lệch 7 giờ, mỗi ngày, không ai phát hiện |
| Lưu thời gian local dưới dạng UTC | lệch đúng bằng offset, và lệch khác nhau vào mùa DST |
| So sánh ngày bằng string | `'2026-01-10' > '2026-01-9'` là `false` |

## Mental Model

Ba loại "thời gian" khác nhau về bản chất, và **không** thay thế nhau:

```text
1. THỜI ĐIỂM (instant)          "khi nào việc này xảy ra"
   → một điểm trên trục thời gian toàn cầu
   → PostgreSQL: timestamptz     TypeScript: Date
   → created_at, paid_at, logged_in_at

2. NGÀY DÂN SỰ (civil date)     "ngày sinh", "ngày nghỉ lễ", "hạn nộp"
   → KHÔNG có thời điểm; nó là một nhãn trên lịch
   → PostgreSQL: date            TypeScript: string 'YYYY-MM-DD'
   → birth_date, due_date, holiday

3. GIỜ ĐỊA PHƯƠNG TƯƠNG LAI     "họp 9h sáng thứ Ba hàng tuần ở Hà Nội"
   → phải lưu giờ local + TÊN múi giờ, KHÔNG lưu UTC
   → vì luật múi giờ có thể đổi trước khi tới ngày đó
   → PostgreSQL: timestamp + text (tz name)
```

Loại 3 là loại bị làm sai nhiều nhất. Nếu bạn lưu "9h sáng 15/3 ở New York" thành UTC (`14:00Z`) và chính phủ Mỹ đổi luật DST trước tháng 3, cuộc họp sẽ diễn ra sai giờ. Với thời điểm **tương lai được neo vào giờ địa phương**, phải lưu `('2027-03-15 09:00', 'America/New_York')`.

### `timestamptz` — tên gây nhầm lẫn

```text
timestamptz KHÔNG lưu timezone.
Nó lưu một thời điểm (microsecond kể từ epoch UTC),
và CHUYỂN ĐỔI khi đọc/ghi theo TimeZone của session.

timestamp   lưu một chuỗi ngày-giờ KHÔNG có ý nghĩa múi giờ.
            '2026-08-28 10:00' — 10 giờ ở đâu? Không ai biết.
```

Vì vậy:

> **Dùng `timestamptz` cho mọi thời điểm. `timestamp` gần như luôn là bug.**

Ngoại lệ hợp lệ duy nhất: loại 3 ở trên (giờ local tương lai), và khi đó nó **luôn đi kèm** một cột chứa tên múi giờ.

## How It Works

### Quy tắc bốn tầng

```text
DATABASE   timestamptz, luôn luôn. Session TimeZone = 'UTC'
BACKEND    làm việc bằng UTC. process.env.TZ = 'UTC'
API        ISO 8601 có offset: "2026-08-28T10:00:00Z"
FRONTEND   chuyển sang múi giờ người dùng ở LỚP HIỂN THỊ, không sớm hơn
```

Nguyên tắc: **chuyển đổi múi giờ chỉ xảy ra ở hai đầu** — lúc người dùng nhập, và lúc hiển thị. Ở giữa, mọi thứ là UTC.

```ts
// Backend: đặt TZ tường minh, không phụ thuộc môi trường
// package.json: "start": "TZ=UTC node dist/main.js"
// hoặc Dockerfile: ENV TZ=UTC

// Node hiện `Date` luôn là UTC bên trong; vấn đề nằm ở các hàm LOCAL:
new Date().toISOString();        // ✅ luôn UTC
new Date().getHours();           // ❌ giờ theo TZ của process
new Date().toLocaleString();     // ❌ theo TZ + locale của process
```

Ba hàm `getHours()`, `getDate()`, `getMonth()` là nguồn bug phổ biến nhất ở backend — chúng trả về giá trị theo múi giờ của **process**, không phải của người dùng.

### "Hôm nay của ai" — quyết định phải tường minh

```ts
// ❌ Hôm nay theo server
const start = startOfDay(new Date());

// ✅ Hôm nay theo múi giờ NGƯỜI DÙNG, tường minh
import { TZDate } from '@date-fns/tz';   // hoặc Temporal khi đã ổn định

function dayRangeInTz(dateStr: string, tz: string) {
  // dateStr: '2026-08-28' (ngày dân sự), tz: 'Asia/Ho_Chi_Minh'
  const start = new TZDate(`${dateStr}T00:00:00`, tz);
  const end = new TZDate(`${dateStr}T00:00:00`, tz);
  end.setDate(end.getDate() + 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

// Query dùng nửa mở [start, end) — KHÔNG dùng BETWEEN
const { start, end } = dayRangeInTz(query.date, user.timezone);
await prisma.order.findMany({
  where: { createdAt: { gte: start, lt: end } },
});
```

Hai chi tiết quan trọng:

**1. Nửa mở `[start, end)` thay vì `BETWEEN`.** `BETWEEN` bao gồm cả hai đầu, nên `BETWEEN '2026-08-28 00:00' AND '2026-08-28 23:59:59'` **bỏ mất** khoảng từ `23:59:59.000001` tới `23:59:59.999999`. Với `timestamptz` có microsecond, đó là dữ liệu thật bị mất.

**2. Múi giờ đến từ đâu** phải là một quyết định:

```text
user.timezone trong database    → tốt nhất; người dùng chọn, ổn định
Intl.DateTimeFormat().resolvedOptions().timeZone (browser)  → tiện, nhưng đổi khi họ đi du lịch
Header/query param từ client    → linh hoạt, nhưng client có thể sai
Múi giờ của công ty/tenant      → đúng cho báo cáo nội bộ
```

Với báo cáo tài chính, gần như luôn là **múi giờ của tổ chức**, không phải của người xem — nếu không, hai người ở hai nước sẽ thấy hai con số khác nhau cho "doanh thu tháng 8".

### DST — nơi mọi giả định vỡ

```text
Giờ KHÔNG tồn tại:  02:00–03:00 ngày chuyển sang DST → nhảy qua
Giờ TỒN TẠI HAI LẦN: 01:00–02:00 ngày chuyển khỏi DST → lặp lại

Hệ quả:
  - Một "ngày" có thể có 23 hoặc 25 giờ
  - now() + 24h ≠ "cùng giờ ngày mai"
  - Cron "2:30 sáng hàng ngày" có thể bị bỏ hoặc chạy hai lần
```

```ts
// ❌ Cộng 24 giờ ≠ ngày mai
const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);

// ✅ Cộng theo lịch, trong múi giờ cụ thể
const tomorrow = addDays(new TZDate(now, tz), 1);
```

Việt Nam không có DST, nên nếu chỉ phục vụ người dùng Việt Nam bạn ít gặp. Nhưng ngay khi có một khách hàng ở Mỹ hoặc Âu, mọi giả định "một ngày = 24 giờ" trở thành bug.

### PostgreSQL — các hàm cần biết

```sql
-- Session timezone: quyết định cách timestamptz được HIỂN THỊ
SET TIME ZONE 'UTC';                    -- nên là mặc định của app
SHOW TimeZone;

-- Chuyển đổi tường minh
SELECT created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' FROM orders;
-- → trả về `timestamp` (không tz) biểu diễn giờ local ở VN

-- Nhóm theo ngày TRONG múi giờ cụ thể — cách đúng cho báo cáo
SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
       count(*), sum(total)
FROM orders
WHERE created_at >= $1 AND created_at < $2
GROUP BY 1 ORDER BY 1;

-- ❌ Nhóm theo UTC rồi gọi là "ngày" → lệch 7 giờ cho user VN
SELECT date_trunc('day', created_at) ...

-- now() vs clock_timestamp()
SELECT now();               -- thời điểm bắt đầu TRANSACTION (không đổi trong transaction)
SELECT clock_timestamp();   -- thời điểm thật, đổi mỗi lần gọi
```

`now()` cố định trong một transaction là behavior đúng và hữu ích (mọi dòng insert trong một transaction có cùng `created_at`), nhưng gây bất ngờ khi bạn đo thời gian bên trong transaction.

**Index cho query theo khoảng thời gian:**

```sql
-- ❌ Hàm trên cột → không dùng được index thường
WHERE date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = '2026-08-28'

-- ✅ So sánh khoảng trên cột thô → dùng index
WHERE created_at >= $1 AND created_at < $2
CREATE INDEX ON orders (created_at DESC);
```

Đây là lý do phải tính `[start, end)` ở application rồi truyền vào, thay vì bọc hàm quanh cột trong `WHERE`.

### Frontend — chỉ chuyển ở lớp hiển thị

```tsx
// Intl API có sẵn, không cần thư viện cho việc hiển thị
const fmt = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',       // TƯỜNG MINH, không dựa vào máy người dùng
});
fmt.format(new Date(order.createdAt));   // "28 thg 8, 2026 17:00"
```

Tạo `Intl.DateTimeFormat` ở **module scope**, không trong component — nó là một trong những object đắt bất ngờ nhất, và với list 1000 dòng nó chiếm phần lớn thời gian render. Xem [React performance](../../01-web-frontend/02-react/behavior/12-performance.md).

Và cẩn thận với **hydration mismatch**: nếu server format theo TZ của server và client format theo TZ của browser, HTML không khớp. Cách an toàn: truyền `timeZone` tường minh ở cả hai phía, hoặc chỉ format ở client sau khi mount. Xem [Server/Client boundary](../../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md).

## Example

```prisma
model Order {
  id        String   @id @default(uuid(7)) @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  paidAt    DateTime? @map("paid_at") @db.Timestamptz(6)
  @@index([createdAt(sort: Desc)])
}

model User {
  id       String @id @default(uuid(7)) @db.Uuid
  birthDate DateTime? @map("birth_date") @db.Date        // NGÀY DÂN SỰ
  timezone String @default("Asia/Ho_Chi_Minh")            // để tính "hôm nay của họ"
}

model Meeting {
  id         String   @id @default(uuid(7)) @db.Uuid
  localStart DateTime @map("local_start") @db.Timestamp(6)  // giờ LOCAL tương lai
  timezone   String                                          // + tên múi giờ
}
```

Ba kiểu cột cho ba loại thời gian, đúng như mental model. `@db.Timestamptz` là bắt buộc trong Prisma — không có nó, Prisma dùng `timestamp` (không tz) cho PostgreSQL và bạn mất ý nghĩa múi giờ.

## Prediction

1. Cột `timestamp` (không tz), server đổi từ UTC sang UTC+7 — dữ liệu cũ đọc ra thế nào?
2. `new Date().getHours()` trên server có `TZ=UTC`, user ở VN — trả về giờ của ai?
3. `BETWEEN '2026-08-28 00:00' AND '2026-08-28 23:59:59'` — bỏ mất khoảng nào?
4. `date_trunc('day', created_at)` không có `AT TIME ZONE`, user ở UTC+7 — báo cáo "hôm nay" lệch bao nhiêu?
5. `now() + interval '24 hours'` vào ngày chuyển DST ở New York — có phải cùng giờ ngày mai?
6. `WHERE date_trunc('day', created_at) = '2026-08-28'` — dùng được index `(created_at)` không?
7. Lưu "9h sáng 15/3/2027 ở New York" thành UTC, sau đó Mỹ đổi luật DST — cuộc họp diễn ra lúc nào?
8. `new Intl.DateTimeFormat(...)` trong component render 1000 dòng — chi phí?
9. Prisma `DateTime` không có `@db.Timestamptz` trên PostgreSQL — cột là kiểu gì?

<details>
<summary>Đáp án</summary>

1. Cùng chuỗi số, nhưng giờ **nghĩa khác** — mọi thời điểm cũ bị hiểu lệch 7 giờ. Không có lỗi nào.
2. Giờ UTC — không phải giờ của user.
3. `23:59:59.000001` → `23:59:59.999999`.
4. 7 giờ, mỗi ngày.
5. **Không** — ngày đó có 23 hoặc 25 giờ.
6. **Không** — hàm bọc quanh cột. Cần expression index, hoặc viết lại thành so sánh khoảng.
7. Sai giờ — offset đã đổi so với lúc lưu.
8. Rất đắt — nó là một trong những object đắt bất ngờ nhất; tạo ở module scope.
9. `timestamp` không có timezone — mất ý nghĩa múi giờ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tạo cột `timestamp`, insert dữ liệu, rồi `SET TIME ZONE 'Asia/Ho_Chi_Minh'` | Giá trị đọc ra không đổi nhưng nghĩa đã khác |
| Cùng thí nghiệm với `timestamptz` | Giá trị hiển thị đổi đúng, nghĩa giữ nguyên |
| Báo cáo "hôm nay" tính theo server UTC, xem lúc 6h sáng VN | Thiếu dữ liệu từ 0h–7h |
| `BETWEEN ... 23:59:59` rồi insert một dòng lúc `23:59:59.5` | Dòng đó bị bỏ |
| Đổi sang `>= start AND < end` | Không mất dòng nào |
| `EXPLAIN` query có `date_trunc()` trong `WHERE` | Seq scan |
| Viết lại thành so sánh khoảng | Index scan |
| Đặt `TZ=Asia/Ho_Chi_Minh` cho process rồi chạy test | Test pass/fail khác nhau tuỳ TZ — dấu hiệu code phụ thuộc TZ |
| Format ngày ở server và client không truyền `timeZone` | Hydration mismatch |
| `Intl.DateTimeFormat` trong render, list 1000 dòng, Profiler | Nó chiếm phần lớn thời gian |

Thí nghiệm 8 rất hữu ích: chạy toàn bộ test suite với `TZ=UTC` và `TZ=Asia/Ho_Chi_Minh`. Test nào đổi kết quả là test đang phụ thuộc múi giờ của máy — và đó là bug đang chờ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `timestamptz` lưu timezone | Nó lưu thời điểm; chuyển đổi khi đọc/ghi theo session TZ |
| `timestamp` "trung tính" nên an toàn | Nó không có ý nghĩa múi giờ — gần như luôn là bug |
| Lưu UTC là luôn đúng | Với giờ local **tương lai** thì sai (luật múi giờ đổi) |
| Một ngày = 24 giờ | 23 hoặc 25 vào ngày chuyển DST |
| `BETWEEN` cho khoảng ngày là đủ | Nó bỏ mất phần cuối giây |
| "Hôm nay" là khái niệm rõ ràng | Phải chọn: của user, của tenant, hay của server |
| Chỉ frontend cần quan tâm timezone | Backend `getHours()` cũng dùng TZ của process |
| Ngày sinh nên là `timestamptz` | Là ngày dân sự → `date` |
| VN không có DST nên không cần quan tâm | Đúng tới khi có khách hàng ở Mỹ/Âu |

## Debugging

1. **Lệch đúng bằng một số nguyên giờ** (7, 8, 12...) → gần như luôn là bug timezone. Con số đó chính là offset.
2. **Kiểm tra kiểu cột thật**, không tin schema:
   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'orders' AND data_type LIKE 'timestamp%';
   ```
   `timestamp without time zone` là dấu hiệu đầu tiên cần sửa.
3. **Kiểm tra TZ của process**: `node -e "console.log(process.env.TZ, new Date().getTimezoneOffset())"`. Nếu không phải UTC, đó là biến số ẩn.
4. **Kiểm tra session TZ của DB**: `SHOW TimeZone;` — và của connection pool, vì mỗi connection có thể khác.
5. **Chạy test với hai TZ khác nhau** — test đổi kết quả là test phụ thuộc TZ.
6. **Grep các hàm local**: `grep -rn "getHours()\|getDate()\|getMonth()\|toLocaleDateString" src/` — mỗi chỗ ở backend là ứng viên bug.
7. **Báo cáo lệch** → in ra `[start, end)` thật đang gửi vào query, và múi giờ dùng để tính chúng.

## Production Considerations

- **`TZ=UTC` cho mọi process** (Dockerfile, K8s env, systemd). Không dựa vào TZ của máy host.
- **`timestamptz` cho mọi thời điểm**; `date` cho ngày dân sự; `timestamp + tz name` cho giờ local tương lai.
- **`@db.Timestamptz(6)` trong Prisma** — bắt buộc, nếu không được `timestamp`.
- **Lưu `user.timezone`** trong database nếu người dùng có thể ở nhiều múi giờ.
- **Quyết định "hôm nay của ai" và ghi vào tài liệu** — với báo cáo tài chính, thường là múi giờ tổ chức.
- **Luôn `[start, end)`**, không bao giờ `BETWEEN` cho khoảng thời gian.
- **Tính khoảng ở application**, truyền vào query → dùng được index.
- **`Intl.DateTimeFormat` ở module scope**, và truyền `timeZone` tường minh ở cả server và client.
- **Cron job**: dùng UTC cho job hệ thống. Nếu job phải chạy theo giờ địa phương (ví dụ "gửi báo cáo 8h sáng cho mỗi tenant"), lưu giờ + tz của tenant và tính lịch trong múi giờ đó — không dùng một cron duy nhất.
- **Cập nhật tzdata** trong image production; luật múi giờ đổi vài lần mỗi năm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `timestamptz` mọi nơi | không mơ hồ, chuyển đổi đúng | phải hiểu session TZ |
| `timestamp` | "đơn giản" | mất ý nghĩa; bug khi có nhiều múi giờ |
| Lưu UTC cho giờ tương lai | đơn giản | sai nếu luật múi giờ đổi |
| Lưu local + tz name | đúng với lịch tương lai | hai cột, phải tính khi query |
| "Hôm nay" theo user | đúng với trải nghiệm cá nhân | hai người thấy hai số khác nhau |
| "Hôm nay" theo tenant | báo cáo nhất quán | không khớp cảm nhận của user ở múi giờ khác |
| Format ở server | HTML đầy đủ, tốt cho SEO | rủi ro hydration mismatch |
| Format ở client sau mount | luôn đúng TZ người dùng | một frame hiển thị trống |

## Explain Without Notes

1. Ba loại "thời gian" và kiểu cột tương ứng?
2. `timestamptz` thật sự lưu gì? Vì sao tên gây nhầm lẫn?
3. Vì sao lưu UTC là **sai** cho một cuộc họp năm sau?
4. Vì sao `BETWEEN` cho khoảng ngày là bug?
5. Vì sao `date_trunc()` trong `WHERE` làm mất index, và cách viết lại?
6. "Hôm nay của ai" — ba lựa chọn và khi nào chọn cái nào?

## Related

- [Constraints & invariants](01-constraints-invariants.md) — check constraint cho khoảng thời gian
- [ID strategy](06-id-strategy.md) — UUIDv7 chứa timestamp
- [Money & Decimal](08-money-decimal.md) — cùng họ "kiểu dữ liệu dễ làm sai"
- [PostgreSQL architecture & ACID](../01-postgresql/fundamentals/01-architecture-and-acid.md) — `now()` trong transaction
- [Index & query plan](../01-postgresql/indexes-query-planning/01-index-query-plan.md) — hàm trên cột phá index
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — ISO 8601 trong API
- [Server/Client boundary](../../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) — hydration mismatch
- [React performance](../../01-web-frontend/02-react/behavior/12-performance.md) — `Intl` đắt trong render
- [Deterministic tests](../../05-cross-cutting/testing/06-deterministic-tests.md) — test phụ thuộc TZ
