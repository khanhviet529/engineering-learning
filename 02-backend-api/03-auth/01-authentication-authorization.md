---
level: intermediate
area: backend
prerequisites:
  - ../00-http-api/01-http-request-response.md
related:
  - 02-session-vs-token.md
  - 06-authorization-models.md
  - ../../05-cross-cutting/security/04-access-control.md
---

# Authentication vs Authorization

> Hệ thống có JWT, có `@UseGuards(JwtAuthGuard)` trên mọi controller, có refresh token, có MFA. Một người dùng đổi `id` trong URL từ `/invoices/8421` thành `/invoices/8422` và đọc được hoá đơn của công ty khác. Mọi thứ về **authentication** đều đúng. Không có gì về **authorization** tồn tại.

## Position

```text
Request
  ↓
AUTHENTICATION  "anh là AI?"        → 401 nếu không xác định được
  ↓
AUTHORIZATION   "anh được làm GÌ?"  → 403 nếu không được phép
  ↓
Business logic
```

Hai câu hỏi khác nhau, hai cơ chế khác nhau, hai lớp lỗi khác nhau. Gộp chúng làm một là gốc của lớp lỗ hổng phổ biến nhất trong ứng dụng web.

## Problem

Authentication là bài toán **đã được giải**: có thư viện, có chuẩn, có nhà cung cấp. Bạn hiếm khi tự viết nó, và nếu viết sai thì thường lộ ra ngay.

Authorization thì không:

```text
· Không có thư viện nào biết "hoá đơn này thuộc về ai" trong hệ thống của bạn
· Mỗi endpoint là một cơ hội để quên
· Quên thì KHÔNG có lỗi nào — nó chỉ hoạt động, cho sai người
· Test happy path luôn pass
```

Đó là lý do **Broken Access Control đứng số 1 trong OWASP Top 10** — không phải vì nó khó hiểu, mà vì nó dễ quên và im lặng.

## Mental Model

### Ba câu hỏi, không phải hai

```text
① AUTHENTICATION   "anh là ai?"            → danh tính
② AUTHORIZATION    "anh được làm gì?"      → quyền
③ AUDIT            "ai đã làm gì, khi nào?" → dấu vết
```

Câu ③ hay bị bỏ. Nó là thứ duy nhất trả lời được "chuyện gì đã xảy ra" sau một sự cố bảo mật — và bạn không thể tạo ra nó hồi tố.

### Hai loại authorization, và chúng rất khác nhau

```text
THEO VAI TRÒ (role)          "admin xoá được"
   → chỉ cần TOKEN, không cần đọc dữ liệu
   → guard/middleware làm được

THEO QUAN HỆ (ownership)     "chỉ chủ sở hữu xoá được"
   → PHẢI đọc dữ liệu để biết
   → thuộc về service/query, không phải guard
```

Nhầm hai loại này là nguyên nhân của ví dụ ở đầu note: `JwtAuthGuard` + `RolesGuard` bảo vệ tốt loại thứ nhất và **hoàn toàn không chạm** tới loại thứ hai.

Cách kiểm tra một endpoint có đủ authorization chưa:

> **"Nếu người dùng đổi ID trong URL thành ID của người khác thì sao?"**

Nếu câu trả lời không phải "404 hoặc 403", endpoint đó có lỗ hổng.

### Ownership thuộc về query, không thuộc về guard

```ts
// ❌ kiểm tra sau khi đã lấy dữ liệu — dễ quên, và tốn một query
const invoice = await this.repo.findById(id);
if (invoice.tenantId !== user.tenantId) throw new ForbiddenError();
```

```ts
// ✅ điều kiện nằm TRONG query — không thể quên, không tốn thêm query
const invoice = await this.repo.findOne({ where: { id, tenantId: user.tenantId } });
if (!invoice) throw new NotFoundError('invoice not found');    // 404, không phải 403
```

Hai điểm quan trọng:

```text
① Điều kiện trong WHERE là an toàn theo THIẾT KẾ
   Không có "quên kiểm tra" — nếu quên thêm điều kiện, query không chạy đúng
   và bạn phát hiện ngay, thay vì rò rỉ im lặng.

② Trả 404, không phải 403
   403 cho tài nguyên của người khác TIẾT LỘ rằng nó tồn tại.
   Attacker duyệt ID và phân biệt được "không có" với "có nhưng của người khác".
```

### Multi-tenant: `tenantId` phải được ép ở tầng không thể quên

```text
Tầng nào cũng có thể quên, TRỪ:
  · repository ép tenantId vào MỌI query
  · PostgreSQL Row-Level Security (RLS)
```

```sql
-- RLS: database từ chối, bất kể code viết gì
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

```ts
// đặt tenant cho mỗi transaction
await tx.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, true)`;
```

RLS là lớp phòng thủ mạnh nhất cho multi-tenant: một service mới quên `tenantId` sẽ nhận về **0 dòng**, không phải dữ liệu của tenant khác. Cái giá là độ phức tạp khi debug và một chút chi phí ở planner.

### UI không phải authorization

```tsx
{user.role === 'admin' && <DeleteButton />}
```

Đây là **UX**, không phải bảo vệ. Người dùng gọi API trực tiếp bằng `curl` không chạy React của bạn.

Quy tắc: **mọi kiểm tra ở frontend đều phải có bản sao ở backend.** Frontend quyết định *hiển thị gì*; backend quyết định *cho phép gì*.

### Mặc định đóng

```text
Opt-in  (thêm guard cho từng route):  quên ⇒ endpoint HỞ    ← im lặng
Opt-out (guard toàn cục + @Public()): quên ⇒ endpoint CHẶN  ← ồn ào
```

Thiết kế bảo mật là thiết kế **hướng của lỗi khi con người quên**, không phải giả định con người không quên.

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }   // toàn cục
```

```ts
@Public()                       // opt-out tường minh
@Post('login')
login() {}
```

Xem [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md).

### 401 và 403 có nghĩa khác nhau

```text
401 Unauthorized  "tôi không biết anh là ai"     → client nên ĐĂNG NHẬP
403 Forbidden     "tôi biết anh, nhưng không"    → đăng nhập lại KHÔNG giúp
404 Not Found     dùng thay 403 khi không muốn tiết lộ sự tồn tại
```

Tên `401 Unauthorized` là một nhầm lẫn lịch sử của HTTP — nó thật ra nghĩa là *unauthenticated*. Trả 403 cho trường hợp thiếu token làm frontend không biết nên redirect tới login.

### Audit log

```ts
this.audit.log({
  actor: user.id,
  action: 'invoice.delete',
  resource: `invoice:${id}`,
  tenantId: user.tenantId,
  result: 'allowed',            // hoặc 'denied' + lý do
  ip: req.ip,
  at: new Date(),
});
```

Ghi **cả** trường hợp bị từ chối — chuỗi 50 lần `denied` từ một tài khoản là tín hiệu bạn muốn thấy.

Và audit log là dữ liệu bạn **không thể tạo hồi tố**: sau một sự cố, câu hỏi đầu tiên là "ai đã truy cập gì" và chỉ có audit log trả lời được.

## Example

Cùng một endpoint, ba mức:

```ts
// ❌ MỨC 0 — chỉ authentication
@Get('invoices/:id')
@UseGuards(JwtAuthGuard)
findOne(@Param('id') id: string) {
  return this.repo.findById(id);          // BẤT KỲ user đăng nhập nào cũng đọc được
}
```

```ts
// ⚠️ MỨC 1 — có kiểm tra, nhưng dễ quên và tiết lộ sự tồn tại
@Get('invoices/:id')
async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
  const inv = await this.repo.findById(id);
  if (!inv) throw new NotFoundError();
  if (inv.tenantId !== user.tenantId) throw new ForbiddenError();   // 403 → lộ sự tồn tại
  return inv;
}
```

```ts
// ✅ MỨC 2 — điều kiện trong query, 404 cho mọi trường hợp
@Get('invoices/:id')
findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
  return this.invoices.findOneForTenant(id, user.tenantId);
}

// service
async findOneForTenant(id: string, tenantId: string) {
  const inv = await this.repo.findOne({ where: { id, tenantId } });
  if (!inv) throw new NotFoundError('invoice not found');
  return inv;
}
```

Và test bảo vệ nó — **nhánh phủ định là nhánh quan trọng**:

```ts
it('tenant khác KHÔNG đọc được', () =>
  request(app.getHttpServer())
    .get(`/invoices/${invoiceOfTenantA.id}`)
    .set('Authorization', `Bearer ${tenantBToken}`)
    .expect(404));                          // 404, không phải 403
```

Cộng thêm một test bao trùm bắt được endpoint mới bị quên:

```ts
it.each(getAllRoutes(app).filter(r => !r.isPublic))(
  '%s %s yêu cầu xác thực', async (method, path) => {
    const res = await request(app.getHttpServer())[method.toLowerCase()](path.replace(/:\w+/g, '1'));
    expect([401, 403]).toContain(res.status);
  });
```

## Prediction

1. Endpoint có `JwtAuthGuard` nhưng không kiểm tra ownership — user B đọc được dữ liệu của A không?
2. Kiểm tra ownership sau khi `findById` — có bao nhiêu query? Có thể quên không?
3. Điều kiện trong `WHERE` — bao nhiêu query? Có thể quên không?
4. Trả 403 cho tài nguyên của người khác — attacker biết được gì?
5. Trả 404 — biết được gì?
6. Guard opt-in, developer thêm endpoint mới và quên `@UseGuards` — hậu quả?
7. Guard toàn cục + `@Public()`, quên đánh dấu public cho `/login` — hậu quả?
8. UI ẩn nút Delete cho non-admin, API không kiểm tra — có an toàn không?
9. Multi-tenant, một service mới quên `tenantId` trong query, có RLS — kết quả?
10. Cùng tình huống, không có RLS — kết quả?
11. Chỉ có test "admin xoá được", không có test "member không xoá được" — lỗ hổng nào lọt?
12. Không có audit log, phát hiện rò rỉ dữ liệu sau 2 tháng — trả lời được "ai đã truy cập gì" không?
13. Trả 403 khi thiếu token thay vì 401 — frontend làm gì?

<details>
<summary>Đáp án</summary>

1. **Có** — authentication xác nhận danh tính, không xác nhận quyền trên tài nguyên cụ thể.
2. **Hai** query (hoặc một query + một kiểm tra). **Có thể quên** — và quên thì im lặng.
3. **Một** query. **Không thể quên** — nếu thiếu điều kiện, kết quả sai theo cách phát hiện được.
4. Biết tài nguyên đó **tồn tại**. Duyệt ID để lập bản đồ hệ thống.
5. Không phân biệt được "không tồn tại" và "của người khác".
6. Endpoint **hở**, im lặng, cho tới khi bị khai thác.
7. `/login` bị chặn → **phát hiện trong 5 phút**. Hướng lỗi an toàn.
8. **Không** — `curl` không chạy React.
9. Query trả **0 dòng** — an toàn.
10. Trả về dữ liệu của **mọi tenant** — rò rỉ chéo tổ chức.
11. Mọi thay đổi nới quyền: xoá `@Roles`, sai chuỗi role, đảo điều kiện.
12. **Không** — audit log không tạo hồi tố được.
13. Không biết nên redirect tới login — nó hiển thị "không có quyền" cho một người chỉ cần đăng nhập.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đăng nhập user B, gọi `GET /invoices/<id của A>` | Đọc được? |
| Thêm điều kiện `tenantId` vào query, lặp lại | 404 |
| So sánh phản hồi cho ID không tồn tại và ID của người khác | Có phân biệt được không? |
| Xoá `@UseGuards` khỏi một route (mô phỏng "quên") | Có test nào đỏ không? |
| Chuyển sang guard toàn cục, lặp lại | Không thể quên |
| Gọi API trực tiếp bằng `curl` với token non-admin cho endpoint admin | UI ẩn nút — API có chặn không? |
| Xoá điều kiện `tenantId` khỏi một query, có RLS | 0 dòng |
| Tắt RLS, lặp lại | Dữ liệu chéo tenant |
| Sửa role thành `'Admin'` (hoa chữ đầu) trong token | So sánh chuỗi fail — chặn hay cho qua? |
| Gọi 50 lần với ID ngẫu nhiên | Audit log có ghi không? Có alert không? |
| Thu hồi quyền của một user đang có phiên | Bao lâu tới khi có hiệu lực? |

## What Usually Goes Wrong

- **Chỉ có authentication** → mọi user đăng nhập đọc được mọi thứ. Lỗ hổng phổ biến nhất.
- **Kiểm tra ownership ở tầng dễ quên** → một endpoint mới là một lỗ hổng.
- **Trả 403 thay 404** → tiết lộ sự tồn tại của tài nguyên.
- **Guard opt-in** → quên = hở, im lặng.
- **Tin vào kiểm tra ở frontend** → `curl` bỏ qua nó.
- **Multi-tenant không ép ở tầng dữ liệu** → rò rỉ chéo tổ chức.
- **Chỉ test happy path** → nhánh phủ định không bao giờ được kiểm chứng.
- **So sánh role bằng chuỗi không chuẩn hoá** → `'Admin'` ≠ `'admin'`.
- **Không có audit log** → không trả lời được câu hỏi sau sự cố.
- **403 khi thiếu token** → frontend không biết redirect tới login.
- **Quyền được cache lâu** → thu hồi quyền không có hiệu lực ngay.
- **Mass assignment** → client tự đặt `role` hoặc `tenantId` trong body. Xem [Validation & errors](../02-nestjs/behavior/03-validation-errors.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Có JWT nghĩa là đã bảo mật | JWT chỉ trả lời "anh là ai" |
| Đăng nhập rồi thì được truy cập dữ liệu của mình | Không có gì tự ràng buộc "của mình" |
| Guard là đủ cho mọi authorization | Guard tốt cho role; ownership cần dữ liệu |
| Ẩn nút trên UI là phân quyền | UI là gợi ý; API là quyết định |
| 403 là câu trả lời đúng cho tài nguyên của người khác | Nó tiết lộ sự tồn tại |
| 401 nghĩa là "không có quyền" | Nó nghĩa là "chưa xác định được anh là ai" |
| Test authorization là test admin làm được gì | Nhánh **phủ định** mới bảo vệ bạn |
| Multi-tenant chỉ cần thêm cột `tenant_id` | Cần ép nó ở tầng không thể quên |
| Audit log là yêu cầu tuân thủ | Nó là dữ liệu duy nhất sau sự cố |
| Authorization là bài toán đã giải | Nó đặc thù cho từng hệ thống |

## Debugging

1. **Nghi rò rỉ dữ liệu** → thử ngay: đăng nhập tài khoản A, gọi API với ID của B.
2. **Kiểm tra query thật** — điều kiện `tenantId`/`ownerId` có trong `WHERE` không? Bật query log.
3. **Rà soát endpoint**: liệt kê mọi route, đánh dấu route nào có kiểm tra ownership. Route nào không có là ứng viên.
4. **So phản hồi** cho ID không tồn tại và ID của người khác — nếu khác nhau, bạn đang tiết lộ.
5. **Kiểm tra cache key** — cache thiếu chiều user/tenant cũng gây rò rỉ. Xem [Cache & invalidation](../../03-database/02-redis/01-cache-invalidation.md).
6. **Đọc audit log** — có ghi cả `denied` không? Có `actor`, `resource`, `tenantId` không?
7. **Test tự động**: bộ ba cho mỗi tài nguyên — chủ sở hữu được, người khác không, không token không.

## Production Considerations

- **Guard toàn cục + `@Public()` opt-out** — hướng lỗi an toàn.
- **Ownership và tenant nằm trong `WHERE`**, không phải trong một `if` sau đó.
- **404 thay 403** cho tài nguyên của người khác, trừ khi có lý do UX rõ ràng.
- **RLS ở PostgreSQL cho multi-tenant** nếu dữ liệu nhạy cảm — nó là lớp không thể quên.
- **Bộ ba test cho mỗi tài nguyên**: owner được, người khác không, không token không. Viết helper để nó rẻ.
- **Test bao trùm** kiểm tra mọi route không `@Public()` đều từ chối request không token.
- **Audit log cho mọi hành động thay đổi dữ liệu và mọi lần bị từ chối**, với `actor`, `action`, `resource`, `tenantId`, `result`, `ip`.
- **Alert trên đột biến 403/404** — nó là dấu hiệu dò quét.
- **Chuẩn hoá role** (lowercase, enum) để không có lỗi so sánh chuỗi.
- **Quyền cache ngắn hoặc không cache** — mỗi giây cache là một giây quyền bị thu hồi vẫn còn hiệu lực.
- **Rà soát authorization như một phần của code review** — câu hỏi cố định: "nếu đổi ID thành của người khác thì sao?"

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Guard toàn cục + opt-out | không thể quên bảo vệ | endpoint public phải nhớ đánh dấu |
| Guard per-route | rõ ở nơi đọc | quên = lỗ hổng im lặng |
| Ownership trong `WHERE` | an toàn theo thiết kế, ít query | phải nhớ ở mỗi method |
| Ownership ở guard | đồng đều, khai báo | +1 query; không dùng ngoài HTTP được |
| RLS ở database | lớp không thể quên | khó debug, chi phí planner |
| Chỉ ép ở app | đơn giản, dễ debug | một service mới có thể quên |
| 404 thay 403 | không rò rỉ sự tồn tại | khó debug hơn cho client hợp lệ |
| 403 | rõ ràng | tiết lộ tài nguyên tồn tại |
| Audit log đầy đủ | trả lời được sau sự cố | chi phí lưu trữ, rủi ro PII |
| Cache quyền | nhanh | cửa sổ quyền bị thu hồi vẫn hiệu lực |

## Explain Without Notes

1. Authentication và authorization trả lời hai câu hỏi nào? Câu thứ ba là gì?
2. Hai loại authorization, và vì sao guard chỉ làm tốt một loại?
3. Câu hỏi kiểm tra một endpoint có đủ authorization chưa?
4. Vì sao điều kiện trong `WHERE` an toàn hơn kiểm tra sau khi truy vấn?
5. Vì sao trả 404 thay vì 403?
6. "Mặc định đóng" nghĩa là gì? So sánh hướng của lỗi.
7. Vì sao kiểm tra ở frontend không phải authorization?
8. Vì sao audit log không tạo hồi tố được?

## Related

- [Session vs token](02-session-vs-token.md) — cơ chế mang danh tính
- [JWT & refresh token](03-jwt-refresh-token.md) — thu hồi, hết hạn
- [OAuth 2 & OIDC](04-oauth-oidc.md) — uỷ quyền cho nhà cung cấp
- [Password & MFA](05-password-mfa.md) — xác thực bằng mật khẩu
- [Authorization models](06-authorization-models.md) — RBAC, ABAC, ownership, tenant
- [Access control](../../05-cross-cutting/security/04-access-control.md) — lớp lỗ hổng ở tầng bảo mật
- [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md) — implementation
- [Validation & errors](../02-nestjs/behavior/03-validation-errors.md) — mass assignment
- [Testing NestJS](../02-nestjs/behavior/09-testing-nestjs.md) — test nhánh phủ định
- [Cache & invalidation](../../03-database/02-redis/01-cache-invalidation.md) — cache key thiếu chiều

## Version / Context

Khái niệm áp dụng cho mọi framework. Ví dụ dùng NestJS 10/11 và PostgreSQL 16 (RLS). OWASP Top 10 (2021): A01 Broken Access Control đứng đầu danh sách.
