---
level: advanced
area: backend
prerequisites:
  - 01-authentication-authorization.md
related:
  - ../../05-cross-cutting/security/04-access-control.md
  - ../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md
---

# Authorization models

> Sản phẩm bắt đầu với ba role: `admin`, `member`, `viewer`. Mười tám tháng sau có `admin`, `member`, `viewer`, `billing_admin`, `member_readonly`, `external_auditor`, `support_l1`, `support_l2`, `member_no_export`. Mỗi khách hàng lớn yêu cầu thêm một role. Không ai dám xoá role nào vì không biết ai đang dùng. Vấn đề không phải là "quá nhiều role" — mà là **role đã được dùng để mã hoá thứ vốn không phải là role**.

## Position

```text
Ai? (authn)  →  ĐƯỢC LÀM GÌ? (authz)  →  thao tác
                       ↑ note này: cách MÔ HÌNH HOÁ câu trả lời
```

## Problem

Mọi hệ thống bắt đầu bằng `if (user.role === 'admin')`. Câu hỏi không phải là mô hình nào "tốt nhất", mà là:

```text
① Quyết định phụ thuộc vào GÌ?
     chỉ vai trò của người dùng?              → RBAC
     thuộc tính của TÀI NGUYÊN (chủ sở hữu)?  → ownership / ReBAC
     ngữ cảnh (giờ, IP, trạng thái đơn hàng)? → ABAC

② Ai ĐỊNH NGHĨA quy tắc? bạn hay khách hàng?

③ Bạn cần trả lời "user X làm được Y với Z không?"
   hay "user X thấy được NHỮNG tài nguyên nào?"
```

Câu ③ là câu quyết định kiến trúc, và là câu hay bị bỏ qua nhất.

## Mental Model

### Hai câu hỏi hoàn toàn khác nhau

```text
CHECK    "user X có được đọc invoice 42 không?"
         → một câu trả lời boolean
         → dễ: hàm nào cũng làm được

LIST     "user X đọc được NHỮNG invoice nào?"
         → phải lọc trong QUERY
         → khó: không thể gọi hàm check cho từng dòng
```

Đây là nơi mọi thư viện authz "đẹp" gặp vực:

```ts
// ✗ 10.000 hoá đơn → 10.000 lần kiểm tra, và phân trang SAI hoàn toàn
const all = await this.repo.find({ take: 20 });
return all.filter(inv => this.authz.can(user, 'read', inv));
//     ↑ lấy 20 dòng rồi lọc còn 3 — trang 2 chồng lấn, tổng số sai
```

```ts
// ✓ điều kiện nằm TRONG query
return this.repo.find({
  where: { tenantId: user.tenantId, ...(user.role === 'member' ? { ownerId: user.id } : {}) },
  take: 20,
});
```

**Quy tắc**: nếu mô hình authz của bạn không sinh ra được **một mệnh đề `WHERE`**, nó sẽ không dùng được cho danh sách. Chọn mô hình với ràng buộc này ngay từ đầu, không phải sau khi đã cài đặt.

### RBAC — role gắn với permission

```text
user → role → permission → thao tác

admin   → invoice:read, invoice:write, invoice:delete, user:manage
member  → invoice:read, invoice:write
viewer  → invoice:read
```

```text
+ dễ hiểu, dễ audit, hiển thị được trên UI
+ đủ cho công cụ nội bộ và giai đoạn đầu
− KHÔNG diễn đạt được "của tôi"
− bùng nổ role khi cần biến thể ← sự cố ở đầu note
```

Cải tiến quan trọng và rẻ: **kiểm tra permission, không kiểm tra role.**

```ts
// ✗ thêm role mới = sửa mọi chỗ kiểm tra
if (user.role === 'admin' || user.role === 'billing_admin') { ... }

// ✓ thêm role mới = thêm một dòng cấu hình
if (user.permissions.has('invoice:refund')) { ... }
```

Role trở thành **cách nhóm permission**, không phải thứ code kiểm tra trực tiếp. Đây là thay đổi ngăn được phần lớn cơn bùng nổ role.

### Ownership / ReBAC — quan hệ giữa người dùng và tài nguyên

```text
"được đọc invoice 42" KHÔNG phải thuộc tính của người dùng
→ nó là QUAN HỆ:  user:alice --owner--> invoice:42
                  user:bob   --viewer--> project:x --contains--> invoice:42
```

Đây là mô hình của Google Zanzibar (và các sản phẩm mở phỏng theo như OpenFGA, SpiceDB).

```text
+ diễn đạt tự nhiên: chia sẻ, kế thừa qua nhóm/thư mục, "của tôi"
+ giải quyết đúng lớp lỗi IDOR
− cần lưu và duyệt đồ thị quan hệ
− CÂU HỎI LIST khó: cần "reverse index" hoặc trả về danh sách ID
```

Trong hầu hết ứng dụng, bạn **không cần Zanzibar** — bạn cần một cột `owner_id` và một cột `tenant_id` trong mệnh đề `WHERE`. Đồ thị quan hệ chỉ đáng khi có chia sẻ lồng nhau nhiều cấp (kiểu Google Drive).

### ABAC — quy tắc trên thuộc tính

```text
cho phép NẾU  user.department == resource.department
              AND resource.status != 'locked'
              AND now() trong giờ hành chính
```

```text
+ diễn đạt được ngữ cảnh phức tạp
+ quy tắc thay đổi không cần deploy (nếu quy tắc là dữ liệu)
− khó suy luận: "vì sao Alice bị từ chối?" trở thành bài toán debug
− khó chuyển thành WHERE
− dễ tạo ra quy tắc mâu thuẫn
```

Dùng ABAC cho **một vài quy tắc bổ sung** trên nền RBAC + ownership, không dùng làm mô hình chính.

### Cách kết hợp thực tế

Hầu hết hệ thống SaaS hội tụ về cùng một tổ hợp ba tầng:

```text
① TENANT      luôn luôn, không ngoại lệ  → WHERE tenant_id = ?
② PERMISSION  người này được làm hành động này không?  → RBAC
③ OWNERSHIP   trên đúng tài nguyên nào?  → WHERE owner_id = ? (nếu role bị giới hạn)
```

```ts
// ① + ② ở guard: "hành động này có được phép không"
@RequirePermission('invoice:read')
@Get(':id')
async findOne(@Param('id') id: string, @CurrentUser() user: User) {
  // ③ ở query: "trên tài nguyên nào"
  const invoice = await this.repo.findOne({
    where: {
      id,
      tenantId: user.tenantId,
      ...(user.can('invoice:read:any') ? {} : { ownerId: user.id }),
    },
  });
  if (!invoice) throw new NotFoundException();   // 404, không phải 403
  return invoice;
}
```

Ba dòng `where` này là toàn bộ mô hình. Chúng cũng chính là mệnh đề dùng lại được cho danh sách.

Phân biệt permission theo phạm vi (`invoice:read:own` vs `invoice:read:any`) thay vì tạo role mới cho từng biến thể — đây là cách chặn bùng nổ role tận gốc.

### Vì sao 404 chứ không 403

```text
403 "tài nguyên này TỒN TẠI nhưng bạn không được xem"
    → tiết lộ sự tồn tại: đếm được số bản ghi, dò được ID hợp lệ

404 "không tìm thấy"
    → không tiết lộ gì
```

Dùng 403 khi việc tài nguyên tồn tại **vốn đã công khai** (ví dụ trang cài đặt của tổ chức mà người dùng biết là có). Dùng 404 khi chính sự tồn tại là thông tin — đó là đa số trường hợp.

### Nơi đặt quyết định

```text
Guard / middleware   ✓ permission thô ("được gọi endpoint này không")
                     ✗ ownership — cần đọc tài nguyên, và sẽ đọc HAI LẦN

Service              ✓ quy tắc nghiệp vụ ("chỉ huỷ được đơn ở trạng thái pending")
                     ~ ownership — được, nhưng dễ QUÊN ở endpoint mới

Query (WHERE)        ✓ ownership và tenant — KHÔNG QUÊN ĐƯỢC, không tốn query thừa
                     ✓ dùng lại được cho list và cho check

Database (RLS)       ✓ lớp cuối: đúng kể cả khi tầng trên quên
                     − khó debug, ràng buộc với PostgreSQL
```

Hai nơi quan trọng nhất là **guard** (permission) và **query** (ownership + tenant). Xem [Authentication vs Authorization](01-authentication-authorization.md) cho ví dụ RLS.

### Mặc định đóng

```text
✗ mọi endpoint công khai, thêm @Auth() ở nơi cần
   → endpoint mới bị QUÊN → công khai

✓ guard toàn cục chặn mọi thứ, thêm @Public() ở nơi cần
   → endpoint mới bị QUÊN → bị chặn → phát hiện ngay khi test
```

Cả hai đều có thể bị quên. Khác biệt là **chiều của hậu quả khi quên**. Xem [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md).

### Quyền là dữ liệu, không phải code

```text
if (user.role === 'admin') { ... }          → đổi quyền = deploy
permissions từ DB/cấu hình                  → đổi quyền = cập nhật dữ liệu
```

Đánh đổi: quyền là dữ liệu thì cần audit trail cho chính việc thay đổi quyền, và cần cache (kiểm tra quyền chạy ở mọi request). Cache quyền thì phải xử lý được việc thu hồi — cùng bài toán với [session vs token](02-session-vs-token.md).

## Example

Guard kiểm tra permission, query kiểm tra ownership:

```ts
export const RequirePermission = (...perms: string[]) =>
  SetMetadata('permissions', perms);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>('permissions', [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;             // permission thô không bắt buộc ở mọi route

    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new UnauthorizedException();

    const ok = required.every(p => user.permissions.includes(p));
    if (!ok) throw new ForbiddenException();   // 403 ở đây là ĐÚNG: chưa chạm tài nguyên
    return true;
  }
}
```

Điều kiện ownering dùng lại được cho cả `findOne` và `findMany`:

```ts
// một hàm, hai chỗ dùng — không thể lệch nhau
private scope(user: User) {
  return {
    tenantId: user.tenantId,
    ...(user.permissions.includes('invoice:read:any') ? {} : { ownerId: user.id }),
  };
}

findOne(id: string, user: User) {
  return this.repo.findOne({ where: { id, ...this.scope(user) } });
}

findMany(user: User, page: number) {
  return this.repo.find({ where: this.scope(user), skip: page * 20, take: 20 });
}
```

Việc `findOne` và `findMany` dùng **cùng một hàm scope** là điểm quan trọng nhất trong đoạn code này. Khi chúng tách rời, chúng sẽ lệch nhau — và lệch theo hướng danh sách rò rỉ dữ liệu mà chi tiết thì không.

## Prediction

1. `if (user.role === 'admin')` rải ở 40 chỗ, cần thêm role `billing_admin` có một phần quyền admin — phải sửa bao nhiêu chỗ?
2. Kiểm tra `user.permissions.has('invoice:refund')` — phải sửa bao nhiêu chỗ?
3. Lấy 20 dòng rồi lọc bằng hàm `can()`, người dùng chỉ thấy 3 — trang 2 thế nào?
4. Trả 403 khi không có quyền xem hoá đơn — attacker suy ra gì khi dò ID?
5. Trả 404 — suy ra gì?
6. Ownership kiểm tra trong service, thêm endpoint mới và quên — hậu quả?
7. Ownership nằm trong `WHERE`, thêm endpoint mới dùng cùng repo method — hậu quả?
8. Guard toàn cục mặc định mở, thêm 10 endpoint và quên 1 — hậu quả?
9. Mặc định đóng, quên 1 — hậu quả?
10. Quyền cache trong JWT 24 giờ, thu hồi quyền admin của một người — bao lâu có hiệu lực?
11. `findOne` lọc `ownerId` nhưng `findMany` quên — người dùng thấy gì?
12. Thêm ABAC với 15 quy tắc chồng nhau, một người bị từ chối — mất bao lâu để biết vì sao?

<details>
<summary>Đáp án</summary>

1. **Cả 40** — và bạn sẽ bỏ sót vài chỗ.
2. **Không chỗ nào** — chỉ thêm permission vào role mới.
3. **Sai hoàn toàn**: `skip` áp dụng trước khi lọc → trang chồng lấn, bỏ sót, tổng số sai.
4. **Hoá đơn nào tồn tại** — đếm được, dò được ID.
5. **Không gì.**
6. Endpoint mới **rò rỉ dữ liệu của người khác** — đây là IDOR.
7. Vẫn **được lọc** — điều kiện đi kèm câu query.
8. Endpoint đó **công khai**, và không ai biết cho tới khi bị phát hiện.
9. Endpoint đó **bị chặn** — phát hiện ngay ở lần test đầu.
10. **Tới 24 giờ.** Đây là lý do quyền chi tiết không nên nằm trong token.
11. **Danh sách của mọi người**, nhưng bấm vào chi tiết thì 404 — triệu chứng kinh điển của scope tách rời.
12. Lâu — và đó chính là chi phí thật của ABAC.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi ID trong URL sang ID của người khác | 200 = IDOR |
| Gọi endpoint danh sách với tài khoản quyền thấp | Có dòng nào không thuộc về họ? |
| Lọc sau khi phân trang, sang trang 2 | Dòng lặp hoặc bị bỏ sót |
| So `findOne` và `findMany` cho cùng người dùng | Danh sách nhiều hơn chi tiết = lệch scope |
| Thêm endpoint mới không có decorator, mặc định mở | Công khai |
| Cùng vậy với mặc định đóng | 403 |
| Bỏ `tenantId` khỏi một query | Dữ liệu chéo tenant |
| Thu hồi quyền, dùng token cũ | Quyền cũ còn hiệu lực bao lâu? |
| Grep `role ===` trong codebase | Số chỗ phải sửa khi thêm role |
| Gọi API trực tiếp cho hành động UI đã ẩn nút | Có bị chặn ở server không? |

## What Usually Goes Wrong

- **Kiểm tra role thay vì permission** → bùng nổ role.
- **Lọc sau khi query** → phân trang sai và không mở rộng được.
- **`findOne` và `findMany` có scope khác nhau** → danh sách rò rỉ.
- **Quên `tenant_id`** ở một query → rò rỉ chéo khách hàng.
- **Ownership chỉ ở service** → endpoint mới quên.
- **Mặc định mở** → endpoint mới công khai.
- **403 thay vì 404** → tiết lộ sự tồn tại.
- **Chỉ kiểm tra ở UI** (ẩn nút) → API vẫn gọi được.
- **Quyền chi tiết nhồi vào JWT** → không thu hồi được.
- **ABAC làm mô hình chính** → không ai giải thích được quyết định.
- **Không audit ai đổi quyền của ai** → không điều tra được.
- **Không có test cho đường từ chối** → chỉ test "admin làm được", không test "member KHÔNG làm được".

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| RBAC đủ cho mọi thứ | Nó không diễn đạt được "của tôi" |
| Thêm role là cách xử lý yêu cầu mới | Thường là dấu hiệu cần permission theo phạm vi |
| Authz là một hàm boolean | Câu hỏi LIST quan trọng ngang câu hỏi CHECK |
| Lọc trong code cũng như lọc trong query | Phân trang sai và không mở rộng được |
| Ẩn nút trên UI là kiểm soát truy cập | Đó là UX; kiểm soát nằm ở server |
| 403 rõ ràng hơn nên tốt hơn | Nó tiết lộ sự tồn tại của tài nguyên |
| Zanzibar/ReBAC là chuẩn nên phải dùng | Phần lớn ứng dụng chỉ cần `owner_id` + `tenant_id` |
| ABAC linh hoạt nên tốt hơn | Linh hoạt đổi bằng khả năng suy luận |
| Quyền trong token là tối ưu | Nó là quyền **không thu hồi được** |
| Test authz là test happy path | Giá trị nằm ở test đường **từ chối** |

## Debugging

1. **"Vì sao người này bị từ chối?"** → log quyết định authz: `userId`, permission yêu cầu, permission có, tài nguyên, kết quả. Không có log này thì mọi câu hỏi authz đều thành phỏng đoán.
2. **Danh sách nhiều hơn chi tiết** → `findOne` và `findMany` dùng scope khác nhau.
3. **Rò rỉ chéo tenant** → grep các query thiếu `tenantId`; cân nhắc RLS làm lưới an toàn.
4. **Tìm endpoint không được bảo vệ**: liệt kê route và đối chiếu với decorator — hoặc dùng mặc định đóng để bài toán biến mất.
5. **`SELECT * FROM user_permissions WHERE user_id = ?`** — quyền thực tế trong DB có khớp với quyền trong token/cache không?
6. **Quyền "không cập nhật"** → tìm nơi cache: JWT, Redis, biến trong process.
7. **Kiểm tra RLS**: `SET app.tenant_id = '...'; SELECT count(*) FROM invoices;` — số dòng thấy được có đúng không?
8. **Sau sự cố truy cập trái phép** → audit log có đủ để trả lời "ai đã xem những gì" không?

## Production Considerations

- **Kiểm tra permission, không kiểm tra role.** Role chỉ là cách nhóm permission.
- **Phạm vi trong tên permission** (`:own` / `:any`) thay vì role mới cho mỗi biến thể.
- **`tenant_id` trong mọi query** — không có ngoại lệ.
- **Một hàm scope duy nhất** dùng cho cả check và list.
- **Mặc định đóng** ở tầng guard.
- **404 khi sự tồn tại là thông tin.**
- **RLS ở PostgreSQL** làm lớp cuối cho hệ thống multi-tenant.
- **Quyền chi tiết đọc từ store**, không nhồi vào token; cache ngắn với đường vô hiệu hoá.
- **Audit log cho quyết định từ chối và cho thay đổi quyền** — cả hai đều cần khi điều tra.
- **Test đường từ chối** cho mọi endpoint: "member KHÔNG xem được của người khác" là test có giá trị, không phải "admin xem được".
- **Rà soát quyền định kỳ** — quyền chỉ tăng nếu không ai xem lại.
- **Impersonation (đăng nhập hộ) phải được audit riêng** và hiển thị rõ ràng — nó là lỗ hổng nếu không kiểm soát.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| RBAC thuần | đơn giản, dễ audit | không diễn đạt ownership |
| Permission theo phạm vi | tránh bùng nổ role | tên permission dài hơn |
| ReBAC (đồ thị) | chia sẻ lồng nhau tự nhiên | hạ tầng và câu hỏi list khó |
| ABAC | ngữ cảnh phong phú | khó suy luận và khó chuyển thành WHERE |
| Authz trong query | không quên được, nhanh | logic phân tán trong repository |
| Authz trong service | tập trung, dễ đọc | dễ quên ở endpoint mới |
| RLS | lưới an toàn cuối | khó debug, gắn với PostgreSQL |
| Quyền trong token | không tra store | không thu hồi được |
| Quyền từ store + cache | thu hồi được | thêm phụ thuộc mỗi request |
| Quyền là dữ liệu | đổi không cần deploy | cần audit và UI quản trị |

## Explain Without Notes

1. Hai câu hỏi authz khác nhau là gì, và vì sao câu thứ hai định hình kiến trúc?
2. Vì sao lọc sau khi query làm hỏng phân trang?
3. RBAC không diễn đạt được điều gì? Cho ví dụ.
4. Vì sao kiểm tra permission tốt hơn kiểm tra role?
5. Khi nào trả 404 thay vì 403?
6. Ba tầng của mô hình thực tế (tenant / permission / ownership) đặt ở đâu trong code?
7. Vì sao mặc định đóng an toàn hơn mặc định mở, khi cả hai đều có thể bị quên?
8. Vì sao không nên nhồi quyền chi tiết vào JWT?

## Related

- [Authentication vs Authorization](01-authentication-authorization.md) — hai câu hỏi tách biệt, RLS
- [JWT & refresh token](03-jwt-refresh-token.md) — vì sao quyền không nên nằm trong token
- [OAuth 2 & OIDC](04-oauth-oidc.md) — scope ở provider khác quyền trong hệ thống bạn
- [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md) — cài đặt mặc định đóng
- [Access control](../../05-cross-cutting/security/04-access-control.md) — lớp lỗi IDOR/BOLA
- [Domain logic boundaries](../04-architecture/03-domain-logic-boundaries.md) — quy tắc nghiệp vụ đặt ở đâu
- [Index & query plan](../../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — điều kiện authz cần index
- [Constraints & invariants](../../03-database/03-data-modeling/01-constraints-invariants.md) — ràng buộc ở tầng dữ liệu

## Version / Context

Mô hình chung, không gắn framework. Ví dụ dùng NestJS 10/11 và PostgreSQL 16 (RLS). OpenFGA và SpiceDB là cài đặt mã nguồn mở theo mô hình Google Zanzibar; Casbin và CASL là lựa chọn nhẹ hơn trong hệ sinh thái Node. OWASP xếp Broken Access Control ở vị trí số 1 trong Top 10 (2021).
