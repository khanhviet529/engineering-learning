---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-security-basics.md
  - ../../02-backend-api/03-auth/06-authorization-models.md
related:
  - ../testing/01-testing-pyramid-behavior.md
  - ../../02-backend-api/03-auth/01-authentication-authorization.md
---

# Access control: lớp lỗi số 1

> Một API có 63 endpoint. 61 cái được bảo vệ đúng. Hai cái không: một endpoint export thêm vội trước hạn, và một endpoint webhook nội bộ được cho là "không ai biết URL". Cả hệ thống được đánh giá là an toàn cho tới khi một trong hai cái đó bị gọi. **Kiểm soát truy cập không có điểm trung bình — nó có điểm thấp nhất.**

## Position

```text
06-authorization-models  →  MÔ HÌNH HOÁ quyền (RBAC, ownership, ABAC)
04-access-control (đây)  →  cách nó HỎNG trong thực tế, và cách kiểm chứng
```

Note này không lặp lại phần mô hình. Nó trả lời: **lỗi thực tế trông như thế nào, và làm sao biết mình không mắc?**

## Problem

Kiểm soát truy cập là lớp lỗi phổ biến nhất (OWASP A01) vì nó có ba tính chất khó chịu cùng lúc:

```text
① KHÔNG CÔNG CỤ NÀO TÌM ĐƯỢC
   Scanner không biết Alice có được xem hoá đơn 8422 hay không.
   Chỉ nghiệp vụ của bạn biết.

② HỎNG THEO TỪNG ENDPOINT, KHÔNG THEO HỆ THỐNG
   61/63 đúng vẫn là bị chiếm dữ liệu.

③ IM LẶNG
   Không có exception, không có log lỗi, không có alert.
   Response 200. Mọi thứ trông bình thường.
```

Tính chất ③ là lý do lỗ hổng loại này thường tồn tại hàng năm.

## Mental Model

### Năm dạng hỏng

Gần như mọi lỗ hổng kiểm soát truy cập rơi vào một trong năm dạng sau.

**① IDOR / BOLA — sai đối tượng**

```text
GET /invoices/8421   → của tôi, OK
GET /invoices/8422   → của người khác, VẪN 200

Nguyên nhân: kiểm tra "đã đăng nhập chưa", không kiểm tra "có phải của họ không".
```

Đây là dạng phổ biến nhất, và cũng dễ kiểm chứng nhất: đổi một số trong URL.

**② Function-level — sai chức năng**

```text
POST /admin/users/123/promote

Người dùng thường gọi trực tiếp → thành công,
vì bảo vệ duy nhất là nút "Promote" không hiển thị trên UI.
```

**③ Mass assignment — sai trường**

```ts
// ✗ toàn bộ body được gán
await this.repo.update(id, req.body);
// body: { "name": "Alice", "role": "admin", "tenantId": "other-tenant" }
```

```ts
// ✓ chỉ nhận trường được phép, và authz nằm trong điều kiện
const dto = UpdateProfileSchema.parse(req.body);          // name, avatarUrl — hết
await this.repo.update({ id, tenantId: user.tenantId }, dto);
```

Dạng này nguy hiểm vì nó không cần endpoint nào bị thiếu bảo vệ — endpoint hợp lệ, quyền hợp lệ, chỉ có **trường** là không nên cho phép.

**④ Sai tenant — dữ liệu chéo khách hàng**

```text
Mọi endpoint kiểm tra quyền đúng.
Một query duy nhất quên `WHERE tenant_id = ?`
→ khách hàng A thấy dữ liệu khách hàng B.

Trong SaaS, đây là dạng gây thiệt hại lớn nhất.
```

**⑤ Leo thang qua luồng phụ**

```text
Endpoint chính được bảo vệ. Đường vòng thì không:
  · export / báo cáo / tải CSV
  · webhook nội bộ ("không ai biết URL")
  · GraphQL resolver lồng nhau — kiểm tra ở query gốc, không kiểm ở trường con
  · trang preview / share link không hết hạn
  · endpoint cũ còn sống sau khi UI đã đổi
  · job nền chạy với quyền hệ thống nhưng nhận tham số từ người dùng
```

Sự cố ở đầu note là dạng ⑤.

### Vì sao nó lọt qua review

```text
Review đọc code MỚI.
Lỗ hổng nằm ở thứ KHÔNG CÓ trong code — một dòng kiểm tra bị thiếu.

⇒ mắt người kém trong việc phát hiện sự vắng mặt
⇒ cần cơ chế cấu trúc, không dựa vào sự chú ý
```

Ba cơ chế cấu trúc, xếp theo độ tin cậy:

```text
① ĐIỀU KIỆN TRONG QUERY      không quên được — nó là một phần của câu truy vấn
② MẶC ĐỊNH ĐÓNG              quên = bị chặn = phát hiện ngay khi test
③ RLS Ở DATABASE             đúng kể cả khi cả hai lớp trên sai
```

So với chúng, "nhớ thêm `if` ở đầu handler" là biện pháp yếu nhất — nó phụ thuộc vào việc mọi người luôn nhớ.

### Kiểm tra sự tồn tại cũng là kiểm soát truy cập

```text
403 "tồn tại nhưng bạn không được xem"  → đếm được bản ghi, dò được ID hợp lệ
404 "không tìm thấy"                     → không tiết lộ gì

Ngay cả thời gian phản hồi cũng nói điều gì đó:
  ID tồn tại → 40ms (đọc DB rồi từ chối)
  ID không tồn tại → 3ms
⇒ lọc trong QUERY làm hai trường hợp giống nhau một cách tự nhiên
```

Đây là lợi ích phụ đáng kể của việc đặt điều kiện authz trong `WHERE`: cả hai trường hợp đi cùng một đường mã.

### GraphQL và REST lồng nhau: kiểm tra ở đâu

```graphql
query {
  project(id: "p1") {          # ← kiểm tra ở đây
    invoices {                  # ← và ở đây nữa?
      customer { email }        # ← và ở đây?
    }
  }
}
```

```text
Với GraphQL, người gọi tự chọn đường đi trong đồ thị dữ liệu.
⇒ kiểm tra ở resolver gốc là KHÔNG ĐỦ
⇒ mỗi resolver trả về dữ liệu nhạy cảm cần điều kiện của chính nó
⇒ hoặc: mọi truy cập dữ liệu đi qua một lớp có scope tenant/owner sẵn
```

Cùng vấn đề xuất hiện ở REST với tham số `?include=` hoặc `?expand=`.

### ID tuần tự không phải lỗ hổng, nhưng nó khuếch đại

```text
/invoices/8422       → đoán được ID kế tiếp; một lỗ hổng thành rò rỉ toàn bộ
/invoices/<uuid>     → không đoán được; một lỗ hổng chỉ rò rỉ thứ attacker đã biết

UUID KHÔNG thay thế kiểm soát truy cập.
Nó chỉ giới hạn quy mô khi kiểm soát truy cập thất bại.
```

Dùng UUID (hoặc ID không tuần tự) cho định danh xuất hiện trong URL là một lựa chọn mặc định tốt — nhưng nếu bạn đang dựa vào nó để bảo mật, bạn đang dựa vào obscurity.

### Cache và CDN có thể phá kiểm soát truy cập

```text
Response chứa dữ liệu riêng tư + header cho phép cache dùng chung
→ người dùng B nhận response đã cache của người dùng A

✓ Cache-Control: private, no-store cho mọi response có dữ liệu người dùng
✓ nếu cache theo khoá, khoá PHẢI bao gồm danh tính người dùng
```

Cùng nguyên tắc áp dụng cho cache trong ứng dụng (Redis): khoá cache quên `tenantId` là một lỗ hổng kiểm soát truy cập, không phải lỗi hiệu năng. Xem [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md).

## Example

Bộ test authz — thứ duy nhất thật sự ngăn hồi quy:

```ts
describe('GET /invoices/:id — access control', () => {
  let owner: TestUser, otherUser: TestUser, otherTenant: TestUser, admin: TestUser;
  let invoiceId: string;

  beforeAll(async () => {
    ({ owner, otherUser, otherTenant, admin } = await seedUsers());
    invoiceId = await createInvoice({ ownerId: owner.id, tenantId: owner.tenantId });
  });

  it('chủ sở hữu đọc được', () =>
    api.as(owner).get(`/invoices/${invoiceId}`).expect(200));

  it('người dùng KHÁC cùng tenant → 404', () =>
    api.as(otherUser).get(`/invoices/${invoiceId}`).expect(404));

  it('người dùng tenant KHÁC → 404', () =>
    api.as(otherTenant).get(`/invoices/${invoiceId}`).expect(404));

  it('chưa đăng nhập → 401', () =>
    api.anonymous().get(`/invoices/${invoiceId}`).expect(401));

  it('admin cùng tenant đọc được', () =>
    api.as(admin).get(`/invoices/${invoiceId}`).expect(200));

  it('danh sách KHÔNG chứa hoá đơn của người khác', async () => {
    const { body } = await api.as(otherUser).get('/invoices').expect(200);
    expect(body.items.map((i: any) => i.id)).not.toContain(invoiceId);
  });

  it('không cập nhật được trường không thuộc DTO', async () => {
    await api.as(owner).patch(`/invoices/${invoiceId}`)
      .send({ note: 'ok', tenantId: otherTenant.tenantId, status: 'paid' })
      .expect(200);
    const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
    expect(inv!.tenantId).toBe(owner.tenantId);   // mass assignment bị chặn
    expect(inv!.status).not.toBe('paid');
  });
});
```

Hai điều đáng chú ý:

```text
Test có giá trị là test ĐƯỜNG TỪ CHỐI.
"owner đọc được" hầu như luôn pass — nó không bảo vệ bạn khỏi gì cả.
Bốn test còn lại là thứ bắt được hồi quy.

Test cuối kiểm tra TRẠNG THÁI DATABASE, không kiểm tra mã trả về.
Mass assignment thường trả 200 rất vui vẻ.
```

Một helper nhỏ biến bộ này thành thứ áp dụng được cho mọi resource:

```ts
// dùng lại cho từng resource — khi thêm resource mới, thiếu test là nhìn thấy được
export function describeOwnedResource(name: string, setup: ResourceSetup) {
  describe(`${name} — access control`, () => {
    it('người khác → 404', /* ... */);
    it('tenant khác → 404', /* ... */);
    it('ẩn danh → 401', /* ... */);
    it('không có trong danh sách của người khác', /* ... */);
  });
}
```

## Prediction

1. Endpoint kiểm tra "đã đăng nhập", đổi ID trong URL sang của người khác — kết quả?
2. Nút "Xoá" ẩn với người dùng thường, API không kiểm quyền — họ gọi trực tiếp được không?
3. `repo.update(id, req.body)` với body chứa `role: 'admin'` — kết quả?
4. Query danh sách quên `tenant_id`, chi tiết thì có — người dùng thấy gì?
5. 403 cho hoá đơn của người khác, 404 cho ID không tồn tại — attacker suy ra gì?
6. Cả hai trả 404 nhưng thời gian phản hồi khác nhau 10 lần — suy ra gì?
7. GraphQL kiểm tra ở resolver gốc, trường con không kiểm — truy cập được gì?
8. Cache CDN với `Cache-Control: public` trên response chứa dữ liệu cá nhân — chuyện gì xảy ra?
9. Khoá cache Redis là `invoice:${id}` không có `tenantId`, hai tenant có ID trùng — kết quả?
10. Đổi ID tuần tự sang UUID, kiểm soát truy cập vẫn thiếu — an toàn hơn không?
11. Endpoint cũ `/v1/users` còn sống sau khi UI chuyển sang `/v2` — ai kiểm tra nó?
12. Job nền chạy với quyền hệ thống, nhận `userId` từ payload người dùng gửi — hậu quả?
13. Chỉ có test "admin làm được X" — nó bắt được lỗi gì?

<details>
<summary>Đáp án</summary>

1. **200 với dữ liệu người khác** — IDOR.
2. **Được** — UI không phải lớp bảo vệ.
3. Trường `role` bị ghi đè — **leo thang quyền**.
4. **Danh sách của mọi tenant**, nhưng bấm vào chi tiết thì 404.
5. **Hoá đơn nào tồn tại** — đếm được, dò được.
6. Vẫn suy ra được sự tồn tại — **timing side channel**.
7. Mọi thứ đi tới được **từ** đối tượng gốc, kể cả dữ liệu nhạy cảm ở nhánh sâu.
8. Người dùng B **nhận response của người dùng A**.
9. **Dữ liệu chéo tenant** — lỗ hổng, không phải lỗi cache.
10. **Không an toàn hơn** — chỉ khó dò hàng loạt hơn.
11. Thường là **không ai** — cho tới khi nó bị tìm thấy.
12. Người dùng đặt `userId` bất kỳ → job **thao tác thay người khác** với quyền hệ thống.
13. **Gần như không lỗi nào** — nó là đường thành công.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi ID trong URL sang ID của tài khoản khác | 200 = IDOR |
| Gọi API của tài khoản tenant khác | Dữ liệu chéo tenant |
| Gọi endpoint admin bằng tài khoản thường | UI có phải bảo vệ duy nhất không? |
| Thêm `role`, `tenantId`, `isVerified` vào body PATCH | Mass assignment |
| So thời gian phản hồi cho ID tồn tại và không tồn tại | Timing side channel |
| Gọi endpoint danh sách bằng tài khoản quyền thấp | Có dòng nào không thuộc về họ? |
| So kết quả `GET /x` và `GET /x/:id` cho cùng tài khoản | Lệch = scope tách rời |
| GraphQL: truy vấn trường lồng sâu | Resolver con có kiểm tra không? |
| Liệt kê route và đối chiếu với guard | Cái nào không được bảo vệ? |
| Tìm endpoint cũ trong git history còn được đăng ký | Còn sống không? |
| Xem `Cache-Control` trên response có dữ liệu cá nhân | `public` = lỗ hổng |
| Grep khoá cache thiếu `tenantId` | Rò rỉ chéo |
| Gửi `userId` khác trong payload job nền | Job có tin nó không? |

## What Usually Goes Wrong

- **Kiểm tra xác thực, không kiểm tra uỷ quyền.**
- **Ownership ở service, không ở query** → endpoint mới quên.
- **Thiếu `tenant_id`** ở một query trong hàng trăm.
- **Mass assignment** — gán cả body vào entity.
- **Bảo vệ chỉ ở UI.**
- **Mặc định mở** ở guard.
- **403 thay vì 404**, hoặc timing tiết lộ sự tồn tại.
- **Endpoint phụ không được kiểm tra**: export, webhook, preview, GraphQL con, API cũ.
- **Job nền tin tham số người dùng** trong khi chạy với quyền hệ thống.
- **Cache không tính danh tính vào khoá.**
- **Không có test đường từ chối** → hồi quy im lặng.
- **Không log quyết định từ chối** → không phát hiện được dò quét.
- **Share link không hết hạn, không thu hồi được.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Đăng nhập rồi thì được truy cập | Đó là hai câu hỏi khác nhau |
| Ẩn nút là kiểm soát truy cập | Đó là UX |
| UUID làm hệ thống an toàn | Nó chỉ hạn chế dò hàng loạt |
| Không ai biết endpoint này | Nó nằm trong bundle JS, log, lịch sử git |
| Scanner sẽ tìm ra | Không — nó không biết nghiệp vụ của bạn |
| 61/63 endpoint đúng là gần đủ | Điểm là của endpoint yếu nhất |
| Review code bắt được | Mắt người kém phát hiện thứ **thiếu** |
| Test authz là test admin làm được gì | Giá trị nằm ở đường **từ chối** |
| GraphQL kiểm tra một lần ở gốc là đủ | Người gọi chọn đường đi trong đồ thị |
| Cache là vấn đề hiệu năng | Khoá cache sai danh tính là lỗ hổng |
| Job nền là nội bộ nên an toàn | Nó nhận đầu vào từ người dùng |

## Debugging

1. **Kiểm kê bề mặt trước**: liệt kê mọi route đã đăng ký (`app.getHttpAdapter().getInstance()._router` với Express, hoặc log lúc khởi động) và đối chiếu với danh sách endpoint bạn *nghĩ* là có.
2. **Cho mỗi route hỏi ba câu**: ẩn danh gọi được không? người dùng khác? tenant khác?
3. **Grep query thiếu tenant**: tìm `findMany`, `find(`, `query(` không kèm `tenantId` — danh sách này thường ngắn và đáng xem hết.
4. **So `findOne` và `findMany`** cho từng resource: chúng có dùng chung hàm scope không?
5. **Log quyết định từ chối** với `userId`, tài nguyên, lý do. Đột biến 403/404 từ một tài khoản là dấu hiệu dò quét.
6. **Kiểm tra RLS đang bật**: `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace;`
7. **Sau sự cố**: audit log ở tầng dữ liệu (ai đọc bản ghi nào) là thứ duy nhất trả lời được "phạm vi rò rỉ tới đâu". Log HTTP thường không đủ.
8. **Kiểm tra `Cache-Control`** trên mọi response có dữ liệu người dùng — một dòng middleware đặt `private, no-store` mặc định là biện pháp rẻ.

## Production Considerations

- **Điều kiện authz trong query**, một hàm scope dùng chung cho check và list.
- **Mặc định đóng** ở guard toàn cục.
- **DTO tường minh cho input**; không bao giờ gán cả body.
- **`tenant_id` trong mọi query** + **RLS** làm lưới an toàn.
- **404 khi sự tồn tại là thông tin**; cùng đường mã cho cả hai trường hợp để timing giống nhau.
- **Định danh công khai không tuần tự.**
- **Kiểm tra ở mọi resolver GraphQL** trả dữ liệu nhạy cảm, không chỉ ở gốc.
- **Job nền không tin tham số người dùng** — xác định chủ thể từ dữ liệu đã lưu, không từ payload.
- **`Cache-Control: private, no-store`** mặc định cho response có dữ liệu người dùng; khoá cache gồm danh tính.
- **Share link có hạn, thu hồi được, phạm vi hẹp.**
- **Bộ test authz cho mọi resource**, chạy trong CI, với helper dùng chung để thiếu test là nhìn thấy được.
- **Log mọi quyết định từ chối** và alert trên đột biến.
- **Rà soát định kỳ danh sách route so với danh sách kiểm tra quyền** — tự động hoá nếu có thể.
- **Xoá endpoint không còn dùng** thay vì để lại "cho chắc".

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Authz trong query | không quên được | logic nằm trong repository |
| Authz trong middleware | tập trung | đọc tài nguyên hai lần hoặc không đủ ngữ cảnh |
| RLS | lưới an toàn cuối | khó debug, gắn với PostgreSQL |
| 404 thay vì 403 | không lộ sự tồn tại | thông báo lỗi kém rõ ràng cho người dùng thật |
| UUID công khai | khó dò hàng loạt | URL dài, index lớn hơn |
| Bộ test authz đầy đủ | chặn hồi quy | thời gian viết và chạy |
| Log mọi quyết định từ chối | phát hiện dò quét | dung lượng log |
| Không cache dữ liệu người dùng | không rò rỉ chéo | mất hiệu năng |
| Cache theo khoá gồm danh tính | vừa nhanh vừa an toàn | tỉ lệ trúng cache thấp hơn |

## Explain Without Notes

1. Ba tính chất khiến kiểm soát truy cập là lớp lỗi phổ biến nhất?
2. Năm dạng hỏng, mỗi dạng một ví dụ.
3. Vì sao mass assignment nguy hiểm dù endpoint và quyền đều đúng?
4. Vì sao review code kém hiệu quả với lớp lỗi này, và ba cơ chế cấu trúc thay thế?
5. Vì sao 404 tốt hơn 403, và vì sao lọc trong query giải quyết luôn vấn đề timing?
6. Vì sao kiểm tra ở resolver gốc GraphQL là không đủ?
7. Khoá cache thiếu `tenantId` là lỗi loại gì?
8. Test authz nào có giá trị, và vì sao "admin làm được X" không phải một trong số đó?

## Related

- [Authorization models](../../02-backend-api/03-auth/06-authorization-models.md) — cách mô hình hoá quyền
- [Authentication vs Authorization](../../02-backend-api/03-auth/01-authentication-authorization.md) — hai câu hỏi, RLS
- [Security basics](01-security-basics.md) — ranh giới tin cậy, đặc quyền tối thiểu
- [Injection](02-injection.md) — lớp lỗi kề bên
- [Testing pyramid](../testing/01-testing-pyramid-behavior.md) — nơi test authz thuộc về
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — khoá cache và danh tính
- [Validation & errors](../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — DTO chặn mass assignment
- [Structured logging](../observability/02-structured-logging.md) — log quyết định từ chối

## Version / Context

OWASP Top 10 (2021) A01: Broken Access Control — hạng nhất theo tỉ lệ ứng dụng bị ảnh hưởng. OWASP API Security Top 10 (2023) tách thành API1 (BOLA — object level), API3 (BOPLA — property level, gồm mass assignment) và API5 (function level). Ví dụ dùng NestJS 10/11, PostgreSQL 16.
