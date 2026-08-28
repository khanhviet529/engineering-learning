---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-security-basics.md
related:
  - ../../03-database/00-sql/01-relational-thinking.md
  - ../../02-backend-api/04-architecture/04-error-handling-strategy.md
---

# Injection

> Một báo cáo nội bộ cho phép lọc theo cột do người dùng chọn. ORM được dùng ở mọi nơi, nên team tin rằng SQL injection không thể xảy ra. Nhưng tên cột không tham số hoá được, nên nó được **ghép chuỗi** vào `ORDER BY`. Một tham số truy vấn duy nhất đủ để đọc dữ liệu ngoài phạm vi báo cáo. ORM không sai — nó chỉ không bảo vệ đoạn mà nó không nhìn thấy.

## Position

```text
Ranh giới tin cậy: dữ liệu người dùng → trình thông dịch
   SQL · shell · HTML · LDAP · NoSQL · template · XML · header · log
   ↑ mọi thứ ở đây là CÙNG MỘT lỗi với vỏ ngoài khác nhau
```

## Problem

```text
Trình thông dịch nhận MỘT chuỗi và phải tự phân biệt:
   phần nào là LỆNH, phần nào là DỮ LIỆU

Nếu ranh giới đó do NỘI DUNG quyết định (dấu nháy, dấu chấm phẩy),
thì người điều khiển nội dung sẽ điều khiển được ranh giới.
```

```sql
-- ý định: dữ liệu là một chuỗi
SELECT * FROM users WHERE email = '<input>'
--                                 ↑ nếu input chứa dấu nháy, nó thoát ra khỏi vùng dữ liệu
```

Đây là lớp lỗi duy nhất có **giải pháp triệt để**: đừng để trình thông dịch phải đoán.

## Mental Model

### Tham số hoá: tách kênh lệnh khỏi kênh dữ liệu

```text
GHÉP CHUỖI                        THAM SỐ HOÁ
"...WHERE email = '" + x + "'"    "...WHERE email = $1", [x]
        ↓                                  ↓
một chuỗi, DB phải phân tích       hai thứ tách biệt:
ranh giới do nội dung quyết định   truy vấn được PHÂN TÍCH TRƯỚC,
                                   giá trị gắn vào SAU, luôn là DỮ LIỆU
```

Điểm mấu chốt: với tham số hoá, giá trị **không bao giờ được phân tích cú pháp**. Dấu nháy trong dữ liệu chỉ là ký tự dấu nháy. Không có gì để "thoát ra".

```ts
// ✗ ghép chuỗi
const rows = await db.query(`SELECT * FROM users WHERE email = '${email}'`);

// ✓ tham số hoá
const rows = await db.query('SELECT * FROM users WHERE email = $1', [email]);

// ✓ ORM/query builder — tham số hoá bên dưới
const user = await this.repo.findOne({ where: { email } });
```

### Vì sao escaping là lựa chọn kém hơn

```text
Escaping = giữ nguyên kiến trúc "một chuỗi" và cố gắng vô hiệu hoá ký tự nguy hiểm

Phụ thuộc vào:  charset của kết nối · phiên bản DB · đúng hàm escape cho đúng ngữ cảnh
Sai một điều kiện → escaping bị vượt qua

Tham số hoá không phụ thuộc điều gì cả — vấn đề không tồn tại.
```

Danh sách chặn (`blacklist`) còn tệ hơn: nó giả định bạn liệt kê được mọi dạng nguy hiểm. Bạn không liệt kê được.

### Thứ KHÔNG tham số hoá được

Đây là nguồn gốc của sự cố ở đầu note:

```text
Tham số hoá được:   giá trị (WHERE, VALUES, SET, LIMIT ở phần lớn driver)
KHÔNG tham số hoá:  TÊN BẢNG · TÊN CỘT · ORDER BY · ASC/DESC
                    → chúng là phần CẤU TRÚC của câu lệnh, không phải dữ liệu
```

Với những phần này, cách đúng duy nhất là **danh sách cho phép** (allowlist):

```ts
// ✗ tên cột ghép trực tiếp
const sql = `SELECT * FROM invoices ORDER BY ${sortBy} ${order}`;

// ✓ ánh xạ từ input sang giá trị CỦA BẠN — input không bao giờ vào câu lệnh
const SORT = { date: 'created_at', amount: 'total_cents', name: 'customer_name' } as const;
const ORDER = { asc: 'ASC', desc: 'DESC' } as const;

const column = SORT[sortBy as keyof typeof SORT] ?? 'created_at';
const dir = ORDER[order as keyof typeof ORDER] ?? 'DESC';
const sql = `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY ${column} ${dir}`;
```

Khác biệt tinh tế nhưng quyết định: giá trị đi vào câu lệnh là **hằng số trong code của bạn**, không phải chuỗi từ người dùng đã được kiểm tra. Kiểm tra rồi dùng lại chuỗi gốc vẫn để lại đường cho những dạng bạn không nghĩ tới.

### ORM không tự động an toàn

```text
✓ an toàn:  repo.find({ where: { email } })
            queryBuilder.where('email = :email', { email })

✗ KHÔNG:    repo.query(`SELECT ... ${x}`)          — raw query
            queryBuilder.where(`email = '${x}'`)   — ghép trong điều kiện
            queryBuilder.orderBy(userInput)        — cấu trúc, không tham số hoá
            $queryRawUnsafe(...)                   — tên nói rõ điều đó
```

ORM bảo vệ đường đi thông thường. Mọi lỗ hổng SQL injection trong dự án dùng ORM đều nằm ở **đoạn thoát khỏi ORM** — và thường được viết vì ORM không diễn đạt được điều gì đó.

### Các họ injection khác — cùng một hình dạng

```text
COMMAND INJECTION
  exec(`convert ${file} out.png`)        ✗ chuỗi đi qua SHELL
  execFile('convert', [file, 'out.png']) ✓ mảng đối số — KHÔNG có shell phân tích
  → nguyên tắc giống hệt: tách lệnh khỏi đối số

NoSQL INJECTION
  { password: req.body.password }        ✗ nếu body gửi { "$ne": null } thì điều kiện luôn đúng
  → ép kiểu và validate schema TRƯỚC khi đưa vào query

XSS  (injection vào HTML)                → 03-xss-csrf.md
SSRF (injection vào URL nội bộ)          → 05-ssrf-supply-chain.md

TEMPLATE INJECTION
  render(userString)                     ✗ template engine coi input là mã
  render('page', { data: userString })   ✓ input là DỮ LIỆU truyền vào template

LOG INJECTION
  logger.info(`user ${name} logged in`)  ✗ tên chứa xuống dòng → giả mạo dòng log
  logger.info('login', { name })         ✓ log có cấu trúc, giá trị là trường riêng

HEADER INJECTION
  res.setHeader('Location', userUrl)     ✗ ký tự CR/LF tách được response
  → validate và mã hoá; framework hiện đại chặn CR/LF nhưng đừng dựa vào đó
```

Nhận ra hình dạng chung quan trọng hơn nhớ từng loại: **ở đâu chuỗi do người dùng kiểm soát đi vào một trình thông dịch, ở đó có câu hỏi injection.**

### Đặc quyền tối thiểu: giảm thiệt hại khi phòng tuyến đầu thủng

```sql
-- account của ứng dụng KHÔNG cần những quyền này
REVOKE ALL ON SCHEMA public FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
-- không DROP, không CREATE, không đọc pg_shadow, không superuser
```

Cộng với **RLS** cho multi-tenant: kể cả khi một truy vấn bị thao túng, nó vẫn bị giới hạn trong tenant hiện tại. Xem [Authentication vs Authorization](../../02-backend-api/03-auth/01-authentication-authorization.md).

Ngoài ra, **`statement_timeout`** giới hạn được các truy vấn nặng bất thường:

```sql
ALTER ROLE app_user SET statement_timeout = '10s';
```

### Thông báo lỗi là kênh rò rỉ

```text
✗ trả về client:  'error: column "xyz" does not exist'
                  'duplicate key value violates unique constraint "users_email_key"'
   → tiết lộ cấu trúc, và biến một lần thử thành phản hồi hữu ích

✓ trả về client:  { error: 'invalid request', requestId: 'a1b2c3' }
✓ vào log:        toàn bộ chi tiết, gắn cùng requestId
```

Xem [Error handling strategy](../../02-backend-api/04-architecture/04-error-handling-strategy.md).

## Example

Endpoint tìm kiếm có sắp xếp và phân trang — mọi phần đều nằm đúng chỗ:

```ts
const QuerySchema = z.object({
  q: z.string().max(100).optional(),
  sortBy: z.enum(['date', 'amount', 'name']).default('date'),   // ① enum, không phải string
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(0).max(1000).default(0),    // ② ép kiểu, chặn trên
});

const SORT_COLUMN = { date: 'created_at', amount: 'total_cents', name: 'customer_name' } as const;

async search(rawQuery: unknown, user: User) {
  const { q, sortBy, order, page } = QuerySchema.parse(rawQuery);   // ③ validate ở BIÊN

  return this.db.query(
    `SELECT id, customer_name, total_cents, created_at
       FROM invoices
      WHERE tenant_id = $1                                     -- ④ authz trong query
        AND ($2::text IS NULL OR customer_name ILIKE '%' || $2 || '%')
      ORDER BY ${SORT_COLUMN[sortBy]} ${order === 'asc' ? 'ASC' : 'DESC'}   -- ⑤ hằng số
      LIMIT 20 OFFSET $3`,
    [user.tenantId, q ?? null, page * 20],
  );
}
```

Năm điểm, mỗi điểm chặn một thứ khác nhau:

```text
① enum      giá trị ngoài danh sách bị từ chối ở tầng schema
② chặn trên OFFSET khổng lồ là vấn đề hiệu năng, không phải bảo mật — nhưng vẫn là DoS
③ biên      validate MỘT LẦN ở nơi dữ liệu vào, không rải rác
④ tenant    injection thành công vẫn không vượt được RLS/điều kiện tenant
⑤ hằng số   chuỗi đi vào SQL đến từ CODE, không từ người dùng
```

Lưu ý `'%' || $2 || '%'`: ký tự `%` và `_` trong `q` vẫn hoạt động như ký tự đại diện của `LIKE`. Đó không phải lỗ hổng injection, nhưng là vấn đề hiệu năng (`%a%` quét toàn bảng) — escape chúng nếu muốn tìm kiếm theo nghĩa đen.

## Prediction

1. Dùng ORM ở mọi nơi, một chỗ dùng `repo.query()` với chuỗi ghép — an toàn không?
2. `ORDER BY ${sortBy}` với `sortBy` đã kiểm tra bằng regex `^[a-z_]+$` — còn rủi ro gì?
3. `ORDER BY ${SORT[sortBy]}` với `SORT` là object hằng — còn rủi ro gì?
4. Escape dấu nháy thủ công, charset kết nối bị cấu hình sai — chuyện gì xảy ra?
5. `exec('convert ' + filename)` với tên file chứa dấu chấm phẩy — shell làm gì?
6. `execFile('convert', [filename])` — shell làm gì?
7. MongoDB: `find({ password: req.body.password })`, body gửi `{"$ne": null}` — điều kiện thành gì?
8. Trả về nguyên văn lỗi database cho client — attacker nhận được gì?
9. DB account có quyền `DROP` và có một lỗ hổng injection — thiệt hại tối đa?
10. Account chỉ `SELECT` trên schema `app`, có RLS — thiệt hại tối đa?
11. `logger.info(\`user ${name} logged in\`)` với `name` chứa xuống dòng — log trông thế nào?
12. Tìm kiếm `LIKE '%' || $1 || '%'` với `$1 = '%'` — query quét bao nhiêu?

<details>
<summary>Đáp án</summary>

1. **Không** — chỗ đó là lỗ hổng, ORM không nhìn thấy nó.
2. Regex chặn nhiều dạng, nhưng tên cột hợp lệ **của bảng khác hoặc cột nhạy cảm** vẫn qua được → rò rỉ dữ liệu qua sắp xếp.
3. **Không còn** — chuỗi vào SQL là hằng số trong code.
4. Escaping có thể **bị vượt qua** — nó phụ thuộc charset.
5. Shell phân tích chuỗi và **chạy lệnh thứ hai**.
6. **Không có shell** — `convert` nhận đúng một đối số là tên file.
7. `password != null` → **luôn đúng** với mọi tài khoản có mật khẩu.
8. Tên bảng, tên cột, ràng buộc — bản đồ cấu trúc dữ liệu.
9. **Toàn bộ database**, kể cả xoá.
10. Giới hạn ở dữ liệu tenant hiện tại, chỉ đọc.
11. Dòng log **giả** được chèn vào — làm sai lệch điều tra.
12. **Toàn bảng** — vấn đề hiệu năng, không phải injection.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Nhập dấu nháy đơn vào mọi ô tìm kiếm | 500 = có ghép chuỗi ở đâu đó |
| Grep `query(\``, `queryRawUnsafe`, `${` trong file SQL | Danh sách chỗ cần xem lại |
| Gửi `sortBy` bằng tên cột khác trong bảng | Có bị từ chối không? |
| Gửi `{"$ne": null}` vào trường mật khẩu (NoSQL) | Query có nhận object không? |
| Đặt tên file chứa khoảng trắng và ký tự đặc biệt rồi xử lý | `exec` hay `execFile`? |
| Xem thông báo lỗi khi vi phạm unique constraint | Lộ tên constraint không? |
| Kiểm tra quyền DB: `\du` và `\dp` trong psql | Rộng hơn mức cần? |
| Chèn `\n` vào tên người dùng rồi xem log | Log có bị tách dòng không? |
| Tìm kiếm với `%` | Thời gian phản hồi |
| Gửi `page=999999999` | Có chặn trên không? |

## What Usually Goes Wrong

- **Một chỗ ghép chuỗi** trong codebase dùng ORM khắp nơi.
- **`ORDER BY` / tên cột động** — phần không tham số hoá được.
- **Escape thủ công** thay vì tham số hoá.
- **Danh sách chặn** thay vì danh sách cho phép.
- **Validate rồi dùng lại chuỗi gốc** thay vì ánh xạ sang hằng số.
- **`exec` với shell** thay vì `execFile` với mảng đối số.
- **Nhận object thay vì chuỗi** trong query NoSQL.
- **Trả về lỗi database nguyên văn.**
- **DB account có đặc quyền quá rộng.**
- **Không có `statement_timeout`** → truy vấn nặng làm nghẽn pool.
- **Log ghép chuỗi** → log injection, và log khó truy vấn.
- **Không có test cho input bất thường** → hồi quy im lặng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Dùng ORM là miễn nhiễm | Chỉ đường đi thông thường được bảo vệ |
| Escape dấu nháy là đủ | Phụ thuộc charset, phiên bản, ngữ cảnh |
| Prepared statement bảo vệ mọi phần của câu lệnh | Chỉ bảo vệ **giá trị**, không bảo vệ cấu trúc |
| Regex validate là tương đương allowlist | Nó cho qua mọi thứ khớp mẫu, kể cả thứ bạn không muốn |
| Chỉ SQL mới bị injection | Shell, HTML, template, LDAP, log, header đều bị |
| Input từ mobile app đáng tin hơn | Client nào cũng giả lập được |
| Dữ liệu từ database đáng tin | Nó có thể do người dùng ghi vào trước đó |
| WAF chặn được injection | Nó lọc theo mẫu; tham số hoá loại bỏ vấn đề |
| Ẩn thông báo lỗi là đủ | Nó chỉ làm chậm, không sửa lỗ hổng |
| Injection là vấn đề cũ, đã hết | Nó vẫn ở A03 trong OWASP Top 10 |

## Debugging

1. **Tìm bề mặt**: `grep -rn 'queryRaw\|\.query(`\|execSync\|exec(' src/` — mọi kết quả cần một lý do.
2. **Bật log truy vấn** ở môi trường dev và xem SQL thực tế ORM sinh ra — thường khác với hình dung.
3. **500 khi nhập dấu nháy** là dấu hiệu rõ nhất của ghép chuỗi; tìm trong stack trace câu lệnh gây lỗi.
4. **`pg_stat_statements`** cho thấy truy vấn thật đang chạy — truy vấn lạ ở đây đáng điều tra.
5. **Kiểm tra quyền**: `SELECT * FROM information_schema.role_table_grants WHERE grantee = 'app_user';`
6. **Kiểm tra RLS**: `SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'invoices';`
7. **Xem log ứng dụng có bị tách dòng bất thường không** — dấu hiệu log injection.
8. **Sau sự cố**: dựng lại danh sách truy vấn đã chạy với credential nghi ngờ; nếu log không đủ để làm việc này, đó là hạng mục cần sửa.

## Production Considerations

- **Tham số hoá mọi giá trị.** Không có ngoại lệ hợp lý.
- **Allowlist ánh xạ sang hằng số** cho tên bảng, tên cột, hướng sắp xếp.
- **`execFile`/`spawn` với mảng đối số**, không dùng shell.
- **Validate schema ở biên** (Zod/class-validator) với kiểu chặt: `enum`, `number`, không phải `string` tự do.
- **Ép kiểu trước khi vào query NoSQL** — chặn object ở nơi mong đợi chuỗi.
- **DB account đặc quyền tối thiểu** + **RLS** cho multi-tenant.
- **`statement_timeout`** ở mức role.
- **Thông báo lỗi chung ra ngoài**, chi tiết vào log kèm request id.
- **Log có cấu trúc** — giá trị là trường, không nối vào chuỗi thông điệp.
- **SAST/linter** cảnh báo raw query trong CI (ví dụ ESLint rule chặn `$queryRawUnsafe`).
- **Test với input bất thường** cho mọi endpoint nhận chuỗi tự do — đưa vào bộ test hồi quy.
- **Review riêng mọi PR có raw SQL** — quy ước rõ ràng rẻ hơn phát hiện muộn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| ORM khắp nơi | an toàn mặc định | khó diễn đạt truy vấn phức tạp, kém tối ưu |
| Raw SQL có kiểm soát | kiểm soát và hiệu năng | phải tự đảm bảo tham số hoá |
| Allowlist cho cột sắp xếp | an toàn | thêm cột phải sửa code |
| Cho phép cột động | linh hoạt cho báo cáo | bề mặt tấn công và rò rỉ dữ liệu |
| Đặc quyền tối thiểu | giới hạn thiệt hại | migration cần account riêng |
| RLS | lưới an toàn cuối | khó debug, gắn với PostgreSQL |
| Lỗi chung ra ngoài | không rò rỉ cấu trúc | hỗ trợ khó hơn — bù bằng request id |
| WAF | chặn được quét tự động ồn ào | tạo cảm giác an toàn sai |

## Explain Without Notes

1. Vì sao tham số hoá triệt để hơn escaping? Điều gì xảy ra ở phía database?
2. Phần nào của câu SQL không tham số hoá được, và cách xử lý đúng?
3. Vì sao "validate bằng regex rồi ghép" yếu hơn "ánh xạ sang hằng số"?
4. `exec` và `execFile` khác nhau ở đâu?
5. NoSQL injection xảy ra thế nào khi không có chuỗi SQL nào?
6. Kể ba họ injection ngoài SQL và nêu điểm chung.
7. Đặc quyền tối thiểu và RLS thay đổi hậu quả của một lỗ hổng injection ra sao?
8. Vì sao thông báo lỗi database không nên trả cho client?

## Related

- [Security basics](01-security-basics.md) — ranh giới tin cậy, mô hình đe doạ
- [XSS & CSRF](03-xss-csrf.md) — injection vào HTML
- [SSRF & supply chain](05-ssrf-supply-chain.md) — injection vào URL
- [Relational thinking](../../03-database/00-sql/01-relational-thinking.md) — cách query được xây
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — lớp bảo vệ ở dữ liệu
- [Validation & errors](../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — validate ở biên
- [Error handling strategy](../../02-backend-api/04-architecture/04-error-handling-strategy.md) — lỗi nào lộ ra ngoài
- [Authentication vs Authorization](../../02-backend-api/03-auth/01-authentication-authorization.md) — RLS

## Version / Context

Ví dụ dùng PostgreSQL 16 (`$1` placeholder; MySQL dùng `?`), Node.js với `pg`/TypeORM/Prisma, Zod cho validation. OWASP Top 10 (2021) xếp Injection ở A03. Nội dung tập trung vào **phòng thủ**: không mô tả cách xây dựng payload khai thác.
