---
level: advanced
area: backend
prerequisites:
  - 02-session-vs-token.md
related:
  - 04-oauth-oidc.md
  - ../../05-cross-cutting/security/06-secrets-management.md
---

# JWT & refresh token

> Một refresh token bị đánh cắp qua XSS. Attacker dùng nó lấy access token mới mỗi 10 phút. Người dùng thật cũng đang dùng ứng dụng bình thường — họ không nhận ra gì. Trong ba tuần, cả hai cùng có phiên hợp lệ. Nếu refresh token được **xoay vòng** và hệ thống **phát hiện tái sử dụng**, sự cố này kết thúc ở lần refresh thứ hai.

## Position

```text
Login → access token (NGẮN, không state) + refresh token (DÀI, có state)
          ↓ dùng cho mọi request           ↓ dùng để lấy access token mới
        hết hạn sau 10 phút                 xoay vòng mỗi lần dùng
```

## Problem

JWT đánh đổi khả năng thu hồi lấy tính stateless. Refresh token là cách **mua lại** khả năng thu hồi mà vẫn giữ phần lớn lợi ích:

```text
Access token   ngắn, stateless, verify bằng chữ ký → nhanh, không cần store
Refresh token  dài, CÓ STATE ở server → thu hồi được

⇒ cửa sổ rủi ro khi thu hồi = TTL của access token (bạn CHỌN con số đó)
```

Nhưng nó tạo ra ba vấn đề mới:

```text
① Refresh token bị đánh cắp → attacker gia hạn vô hạn
② Refresh đồng thời (nhiều tab) → race condition, đăng xuất oan
③ Khoá ký bị lộ hoặc cần xoay vòng
```

## Mental Model

### Cấu trúc JWT

```text
header.payload.signature
  eyJhbGc...  .  eyJzdWI...  .  SflKxwRJ...
    base64        base64         chữ ký

⇒ payload là base64, KHÔNG mã hoá. Ai có token đều đọc được.
```

```json
{
  "sub": "user-123",           // subject: ai
  "iss": "https://api.example.com",   // issuer: ai phát hành
  "aud": "https://api.example.com",   // audience: dành cho ai
  "exp": 1737000600,           // hết hạn (BẮT BUỘC)
  "iat": 1737000000,           // phát hành lúc
  "jti": "a1b2c3",             // ID token — cần cho denylist
  "tenant": "acme"
}
```

Ba claim hay bị bỏ và cả ba đều là lỗ hổng khi thiếu:

```text
exp  không có → token sống vĩnh viễn
aud  không kiểm tra → token của service A dùng được ở service B
iss  không kiểm tra → token từ issuer khác được chấp nhận
```

### `alg: none` và confusion attack

```text
① alg: none
   Thư viện cũ chấp nhận token KHÔNG CÓ chữ ký.
   → attacker tự tạo token bất kỳ.

② HS256 ↔ RS256 confusion
   Server dùng RS256 (public/private key).
   Attacker đổi header thành HS256 và ký bằng chính PUBLIC KEY.
   Nếu thư viện dùng "khoá đã cấu hình" mà không kiểm tra alg → chấp nhận.
```

```ts
// ✅ luôn chỉ định thuật toán tường minh
jwt.verify(token, publicKey, {
  algorithms: ['RS256'],      // KHÔNG để thư viện tự đoán
  issuer: 'https://api.example.com',
  audience: 'https://api.example.com',
});
```

Thư viện hiện đại đã chặn hai tấn công này, nhưng **chỉ khi bạn chỉ định `algorithms`**.

### HS256 vs RS256

```text
HS256  đối xứng — cùng một secret để ký và verify
       + đơn giản, nhanh
       - MỌI service verify được cũng KÝ được
       → chỉ dùng khi một service vừa phát hành vừa verify

RS256  bất đối xứng — private key ký, public key verify
       + service khác verify mà KHÔNG ký được
       + public key phân phối qua JWKS endpoint
       → dùng khi nhiều service, hoặc identity provider riêng
```

Với microservices, HS256 nghĩa là mọi service có thể giả mạo token của mọi service khác. RS256 là lựa chọn đúng ở đó.

### Refresh token rotation + phát hiện tái sử dụng

Đây là cơ chế giải quyết sự cố ở đầu note:

```text
Mỗi lần refresh:
  ① kiểm tra token cũ còn hợp lệ và CHƯA DÙNG
  ② phát hành token MỚI, đánh dấu token cũ ĐÃ DÙNG
  ③ nếu token ĐÃ DÙNG được dùng lại → HUỶ TOÀN BỘ FAMILY
```

```text
Kịch bản bị đánh cắp:
  t=0   attacker lấy RT1
  t=1   attacker refresh → RT2 (RT1 đánh dấu đã dùng)
  t=2   NGƯỜI DÙNG THẬT refresh bằng RT1 → PHÁT HIỆN tái sử dụng
        → huỷ toàn bộ family → CẢ HAI bị đăng xuất
        → người dùng đăng nhập lại; attacker mất quyền
```

Điểm quan trọng: hệ thống **không biết** ai là attacker — nên nó huỷ cả hai. Đó là hành vi đúng: người dùng thật chỉ mất công đăng nhập lại, attacker mất hoàn toàn.

```ts
async refresh(rawToken: string) {
  const hash = sha256(rawToken);
  const rt = await this.repo.findByHash(hash);

  if (!rt) throw new UnauthorizedError('invalid refresh token');

  if (rt.usedAt) {
    // TÁI SỬ DỤNG → token đã bị đánh cắp (hoặc bị sao chép)
    await this.repo.revokeFamily(rt.family);
    this.audit.log({ event: 'refresh_reuse_detected', userId: rt.userId, family: rt.family });
    throw new UnauthorizedError('token reuse detected');
  }
  if (rt.revokedAt || rt.expiresAt < new Date()) {
    throw new UnauthorizedError('expired or revoked');
  }

  return this.db.$transaction(async (tx) => {
    await tx.refreshToken.update({ where: { id: rt.id }, data: { usedAt: new Date() } });
    const next = randomBytes(32).toString('base64url');
    await tx.refreshToken.create({
      data: {
        hash: sha256(next), userId: rt.userId,
        family: rt.family,                      // cùng family
        expiresAt: rt.expiresAt,                // KHÔNG gia hạn vô hạn
      },
    });
    return { accessToken: this.signAccess(rt.userId), refreshToken: next };
  });
}
```

Bốn chi tiết:

```text
LƯU HASH, không lưu token gốc   → DB bị lộ không cho attacker token dùng được
family                           → huỷ cả chuỗi khi phát hiện tái sử dụng
expiresAt KHÔNG gia hạn          → có absolute timeout, không sống vĩnh viễn
transaction                      → đánh dấu dùng và tạo mới phải nguyên tử
```

### Race condition khi nhiều tab

```text
Access token hết hạn. Ba tab cùng gọi /refresh với CÙNG refresh token.
  Tab A: thành công, RT1 → RT2
  Tab B: gửi RT1 → đã dùng → PHÁT HIỆN TÁI SỬ DỤNG → huỷ family
  ⇒ người dùng bị đăng xuất OAN
```

Ba cách xử lý:

```text
① Grace period ngắn
   Cho phép RT cũ dùng lại trong 10–30 giây sau khi xoay,
   TRẢ VỀ CÙNG token mới (không tạo thêm).

② Khoá phía client
   Chỉ một tab refresh; các tab khác chờ (BroadcastChannel / Web Locks API).

③ Khoá phía server theo user
   Refresh đồng thời được tuần tự hoá.
```

Cách ① đơn giản nhất và đủ cho hầu hết trường hợp. Nó nới cửa sổ phát hiện tái sử dụng một chút — đánh đổi hợp lý so với việc đăng xuất oan người dùng thật.

Không xử lý race condition là lý do phổ biến nhất khiến rotation bị **tắt đi** sau khi triển khai.

### Lưu refresh token ở đâu

```text
✓ cookie HttpOnly + Secure + SameSite + path='/auth/refresh'
    → XSS không đọc được; chỉ gửi tới đúng endpoint refresh
✗ localStorage → XSS lấy được, và đó chính là sự cố ở đầu note
```

Access token thì:

```text
✓ trong BỘ NHỚ JS (biến, không phải storage)
    → XSS chỉ lấy được khi tab đang mở và script đang chạy
    → mất khi F5, nhưng refresh token lấy lại được
✗ localStorage → tồn tại sau khi đóng tab
```

Xem [Session vs token](02-session-vs-token.md).

### Xoay khoá ký (key rotation)

```text
① Phát hành khoá mới; ký bằng khoá MỚI
② Verify chấp nhận CẢ HAI khoá (dùng `kid` trong header để chọn)
③ Sau khi mọi token ký bằng khoá cũ đã hết hạn → bỏ khoá cũ
```

```json
// JWKS endpoint: /.well-known/jwks.json
{ "keys": [
  { "kid": "2026-01", "kty": "RSA", "n": "...", "e": "AQAB" },
  { "kid": "2025-10", "kty": "RSA", "n": "...", "e": "AQAB" }
]}
```

Với RS256 và JWKS, service khác tự tải public key và cache theo `kid` — bạn xoay khoá mà không cần deploy lại chúng.

**Nếu khoá bị lộ**: đổi khoá **ngay** và chấp nhận mọi token hiện có bị vô hiệu (đăng xuất toàn bộ). Đây là lý do TTL ngắn quan trọng — nó giới hạn thiệt hại trước khi bạn kịp phản ứng.

### Đừng nhồi dữ liệu vào token

```text
✗ payload chứa: tên, email, danh sách quyền chi tiết, cấu hình
   → token lớn (gửi kèm MỌI request)
   → dữ liệu CŨ (không đọc lại từ DB)
   → LỘ (base64)

✓ payload chứa: sub, tenant, roles ở mức thô, exp/iat/iss/aud/jti
   → chi tiết đọc từ DB hoặc cache khi cần
```

Mỗi claim thêm vào payload là dữ liệu bạn **không thể cập nhật** cho tới khi token hết hạn.

## Example

Luồng đầy đủ ở phía client:

```ts
let accessToken: string | null = null;          // BỘ NHỚ, không localStorage
let refreshing: Promise<string> | null = null;   // chống race giữa các request

async function fetchWithAuth(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    credentials: 'include',                      // gửi cookie refresh
  });
  if (res.status !== 401) return res;

  // chỉ MỘT lần refresh dù nhiều request cùng 401
  refreshing ??= (async () => {
    const r = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!r.ok) { window.location.href = '/login'; throw new Error('refresh failed'); }
    const { accessToken: at } = await r.json();
    accessToken = at;
    return at;
  })().finally(() => { refreshing = null; });

  await refreshing;
  return fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
}
```

`refreshing ??=` là mẫu quan trọng: nếu năm request cùng nhận 401, chỉ **một** lệnh refresh được gửi và bốn cái còn lại chờ cùng promise đó. Không có nó, năm request refresh đồng thời sẽ kích hoạt phát hiện tái sử dụng.

Với nhiều **tab**, cần thêm khoá liên tab (`BroadcastChannel` hoặc Web Locks API) hoặc grace period ở server.

## Prediction

1. Payload JWT chứa email và role — ai đọc được?
2. Không kiểm tra `aud` — token của service A dùng ở service B được không?
3. Không chỉ định `algorithms` trong `verify`, thư viện cũ — tấn công nào khả thi?
4. Server dùng RS256, attacker đổi header thành HS256 và ký bằng public key — thư viện không kiểm tra alg thì sao?
5. HS256 với 5 microservice cùng verify — service nào ký được token?
6. Refresh token bị đánh cắp, không có rotation — attacker dùng được bao lâu?
7. Có rotation + phát hiện tái sử dụng — bao lâu?
8. Ba tab cùng refresh với cùng token, không có grace period — kết quả?
9. Thêm grace period 20 giây — kết quả?
10. Refresh token lưu dạng plaintext trong DB, DB bị lộ — hậu quả?
11. Lưu hash — hậu quả?
12. Refresh gia hạn `expiresAt` mỗi lần — phiên sống bao lâu?
13. Khoá ký bị lộ, access token TTL 24 giờ — thiệt hại kéo dài bao lâu?

<details>
<summary>Đáp án</summary>

1. **Bất kỳ ai có token** — base64, không mã hoá.
2. **Được** — không có gì ngăn. Đây là lý do phải kiểm tra `aud`.
3. **`alg: none`** — token không có chữ ký được chấp nhận.
4. Thư viện dùng public key làm HMAC secret → **chữ ký hợp lệ** → token giả được chấp nhận.
5. **Tất cả** — HS256 đối xứng; verify được nghĩa là ký được.
6. **Vô hạn** — cho tới khi refresh token hết hạn, và mỗi lần dùng lại gia hạn nếu bạn gia hạn `expiresAt`.
7. Tới lần refresh tiếp theo của **người dùng thật** — thường vài phút tới vài giờ. Sau đó cả hai bị đăng xuất.
8. Tab thứ hai và ba kích hoạt **phát hiện tái sử dụng** → huỷ family → đăng xuất oan.
9. Cả ba nhận cùng token mới; không đăng xuất oan.
10. Attacker dùng được **mọi refresh token** trong DB.
11. Hash **không dùng được** để refresh — cần token gốc.
12. **Vĩnh viễn** nếu người dùng hoạt động đều — không có absolute timeout.
13. **Tới 24 giờ** cho token đã phát hành, cộng thời gian bạn phát hiện và xoay khoá.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dán JWT vào jwt.io | Đọc được toàn bộ payload |
| Bỏ kiểm tra `aud`, dùng token của service khác | Được chấp nhận |
| Bỏ `algorithms` trong `verify`, gửi token `alg: none` | Tuỳ thư viện — thử với bản cũ |
| RS256 + token đổi sang HS256 ký bằng public key | Confusion attack |
| Không rotation, dùng lại refresh token 100 lần | Luôn hoạt động |
| Có rotation, dùng lại token cũ | Family bị huỷ |
| Ba tab cùng refresh, không grace period | Đăng xuất oan |
| Thêm grace period | Không đăng xuất |
| Nhồi 50 claim vào payload, đo kích thước header | Token lớn, gửi kèm mọi request |
| Đổi role trong DB, dùng access token cũ | Role cũ vẫn hiệu lực |
| Lưu refresh token plaintext, dump DB | Dùng được ngay |
| Lưu hash, dump DB | Không dùng được |
| Gia hạn `expiresAt` mỗi lần refresh, chạy 1 năm | Phiên không bao giờ hết |
| Xoay khoá ký, dùng token cũ | Bị từ chối (nếu bỏ khoá cũ ngay) |

## What Usually Goes Wrong

- **Không kiểm tra `algorithms`, `iss`, `aud`** → chấp nhận token không nên chấp nhận.
- **Access token TTL dài** → thu hồi không có hiệu lực trong thời gian dài.
- **Không rotation** → refresh token bị đánh cắp dùng được vô hạn.
- **Rotation không xử lý race** → đăng xuất oan → team tắt rotation.
- **Lưu refresh token plaintext** → DB bị lộ = mọi phiên bị chiếm.
- **Không có absolute timeout** → phiên sống vĩnh viễn.
- **Nhồi dữ liệu vào payload** → token lớn, dữ liệu cũ, lộ thông tin.
- **HS256 với nhiều service** → mọi service giả mạo được token.
- **Lưu token trong `localStorage`** → XSS lấy được.
- **Không có JWKS/`kid`** → không xoay khoá được mà không downtime.
- **Không log sự kiện `refresh_reuse_detected`** → bỏ lỡ tín hiệu bị tấn công rõ ràng nhất.
- **Không có kế hoạch cho khoá bị lộ** → không biết làm gì khi cần nhất.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| JWT được mã hoá | Nó được **ký**; payload đọc được |
| JWT an toàn hơn session | Nó khó thu hồi hơn |
| Refresh token nên là một JWT | Chuỗi ngẫu nhiên lưu server tốt hơn — thu hồi được |
| Rotation là tính năng phụ | Nó là thứ làm refresh token an toàn |
| Phát hiện tái sử dụng gây phiền | Nó là cơ chế phát hiện đánh cắp duy nhất bạn có |
| Thư viện tự lo `alg` | Chỉ khi bạn chỉ định `algorithms` |
| HS256 đủ cho mọi trường hợp | Với nhiều service, nó cho phép giả mạo chéo |
| TTL dài tiện cho người dùng | Nó là cửa sổ rủi ro khi thu hồi |
| Nhồi quyền vào token tiết kiệm query | Nó làm quyền không cập nhật được |
| Đăng xuất là xoá token ở client | Server vẫn chấp nhận access token |

## Debugging

1. **Giải mã token**: `echo <jwt> | cut -d. -f2 | tr '_-' '/+' | base64 -d | jq` — xem `exp`, `iss`, `aud`, `sub`.
2. **Token bị từ chối** → hết hạn? sai `aud`/`iss`? sai `kid`? đồng hồ lệch (clock skew)?
3. **Đồng hồ lệch** là nguyên nhân hay bị bỏ qua — cho phép `clockTolerance: 30` giây.
4. **Người dùng bị đăng xuất ngẫu nhiên** → xem log `refresh_reuse_detected`. Nếu nhiều, nghi race condition giữa các tab, không phải bị tấn công.
5. **Refresh luôn fail** → cookie có được gửi không? `path` có khớp endpoint không? `SameSite` với cross-site?
6. **Quyền cũ vẫn hiệu lực** → quyền nằm trong token; TTL bao lâu?
7. **Kiểm tra store**: `SELECT * FROM refresh_tokens WHERE user_id = ? ORDER BY created_at DESC` — bao nhiêu token còn hiệu lực? Có `usedAt` bất thường không?
8. **Sau sự cố**: đếm số family bị huỷ theo thời gian — đột biến là dấu hiệu tấn công.

## Production Considerations

- **Access token 5–15 phút; refresh token 7–30 ngày với absolute timeout.**
- **Luôn chỉ định `algorithms`, `issuer`, `audience` khi verify.**
- **RS256 + JWKS** nếu có nhiều service verify; HS256 chỉ khi một service.
- **Rotation + phát hiện tái sử dụng + huỷ theo family** — đây là ba thứ đi cùng nhau.
- **Grace period 10–30 giây** để rotation không đăng xuất oan.
- **Lưu HASH của refresh token**, không lưu token gốc.
- **Refresh token trong cookie `HttpOnly` với `path` hẹp**; access token trong bộ nhớ JS.
- **Payload tối giản** — mỗi claim là dữ liệu không cập nhật được.
- **`kid` trong header + JWKS** để xoay khoá không downtime.
- **Quy trình khẩn cấp cho khoá bị lộ** viết sẵn và đã diễn tập.
- **Alert trên `refresh_reuse_detected`** — nó là tín hiệu bị đánh cắp rõ ràng nhất bạn có.
- **Cho phép người dùng xem và thu hồi phiên** ("thiết bị đang đăng nhập") — nó vừa là tính năng vừa là công cụ phản ứng sự cố.
- **Dọn refresh token hết hạn** định kỳ — bảng này tăng vô hạn nếu không.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Access TTL ngắn | cửa sổ thu hồi nhỏ | refresh thường xuyên, tải lên auth |
| Access TTL dài | ít refresh | thu hồi chậm |
| Rotation | phát hiện đánh cắp | phức tạp; cần xử lý race |
| Không rotation | đơn giản | token bị cắp dùng được tới khi hết hạn |
| Grace period | không đăng xuất oan | cửa sổ phát hiện rộng hơn một chút |
| HS256 | đơn giản, nhanh | mọi bên verify đều ký được |
| RS256 + JWKS | phân tách quyền, xoay khoá dễ | phức tạp hơn, chậm hơn chút |
| Payload nhiều claim | ít query | token lớn, dữ liệu cũ, lộ thông tin |
| Payload tối giản | linh hoạt, nhỏ | phải đọc DB/cache |
| Cookie `HttpOnly` | XSS không lấy được | cần chống CSRF |
| Bộ nhớ JS cho access token | XSS khó lấy hơn | mất khi F5 |

## Explain Without Notes

1. Vì sao payload JWT không được chứa dữ liệu nhạy cảm?
2. Ba claim phải kiểm tra khi verify, và điều gì xảy ra khi thiếu từng cái?
3. Hai tấn công liên quan tới `alg`, và một dòng code chặn cả hai?
4. HS256 và RS256 khác nhau thế nào? Khi nào bắt buộc dùng RS256?
5. Rotation + phát hiện tái sử dụng hoạt động thế nào? Vẽ dòng thời gian khi bị đánh cắp.
6. Vì sao rotation gây đăng xuất oan, và ba cách xử lý?
7. Vì sao lưu hash thay vì token gốc?
8. Khoá ký bị lộ — bạn làm gì, và TTL ngắn giúp thế nào?

## Related

- [Session vs token](02-session-vs-token.md) — chọn cơ chế, nơi lưu
- [Authentication vs Authorization](01-authentication-authorization.md) — hai câu hỏi
- [OAuth 2 & OIDC](04-oauth-oidc.md) — nơi JWT được dùng như chuẩn
- [Password & MFA](05-password-mfa.md) — bước trước khi phát hành token
- [Cookies & storage](../../01-web-frontend/00-web-foundations/05-cookies-storage.md) — nơi lưu
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — vector đánh cắp token
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — khoá ký
- [Guards & interceptors](../02-nestjs/04-guards-interceptors.md) — verify trong request lifecycle

## Version / Context

JWT theo RFC 7519; JWKS theo RFC 7517. Thư viện Node phổ biến: `jose` (hiện đại, khuyến nghị), `jsonwebtoken`. Cả hai yêu cầu chỉ định `algorithms` tường minh. Refresh token rotation với reuse detection là khuyến nghị của OAuth 2.0 Security Best Current Practice.
