---
level: intermediate
area: backend
prerequisites:
  - 01-authentication-authorization.md
  - ../../01-web-frontend/00-web-foundations/05-cookies-storage.md
related:
  - 03-jwt-refresh-token.md
  - ../../05-cross-cutting/security/03-xss-csrf.md
---

# Session vs token

> Một nhân viên bị sa thải lúc 10:00. Admin xoá tài khoản lúc 10:01. Lúc 10:12, người đó vẫn tải được toàn bộ danh sách khách hàng. JWT của họ có TTL 15 phút, và hệ thống không có cách nào **thu hồi** nó — mỗi request chỉ kiểm tra chữ ký, không hỏi database.

## Position

```text
Login  →  server phát ra một CHỨNG CHỈ  →  client gửi kèm mỗi request
                    ↑ note này: chứng chỉ đó là gì, lưu ở đâu, thu hồi thế nào
```

## Problem

HTTP là stateless: server không nhớ request trước. Sau khi người dùng đăng nhập, cần một cách để mỗi request tiếp theo nói "tôi là người vừa đăng nhập".

Hai họ giải pháp, và khác biệt cốt lõi chỉ nằm ở một chỗ:

```text
SESSION  server LƯU trạng thái; client giữ một ID trỏ tới nó
TOKEN    server KHÔNG lưu gì; client giữ dữ liệu đã ký

⇒ khác biệt thật: THU HỒI
   session: xoá một dòng → có hiệu lực NGAY
   token:   không xoá được gì → có hiệu lực khi HẾT HẠN
```

Mọi đánh đổi khác đều là hệ quả của dòng đó.

## Mental Model

### Session: server nhớ

```text
Login → tạo session trong Redis/DB → gửi session ID qua cookie
Request → cookie → tra Redis → biết user

+ THU HỒI TỨC THÌ (xoá key)
+ ID ngắn, không chứa dữ liệu → không lộ gì
+ đổi quyền có hiệu lực ngay lần request sau
- mỗi request một lần đọc store (~0,2ms với Redis)
- cần một store dùng chung giữa các instance
```

### Token (JWT): server không nhớ

```text
Login → ký một JWT chứa claim → gửi cho client
Request → verify CHỮ KÝ → tin nội dung, KHÔNG hỏi ai

+ không cần store; scale ngang dễ
+ dịch vụ khác verify được mà không gọi về auth service
- KHÔNG THU HỒI ĐƯỢC cho tới khi hết hạn  ← đánh đổi trung tâm
- payload lộ (base64, không mã hoá)
- token lớn hơn nhiều so với một ID
```

### Vì sao JWT không thu hồi được

```text
Verify JWT = kiểm tra chữ ký + hạn
   → KHÔNG có bước nào hỏi "token này còn hợp lệ không?"
   → thêm bước đó = thêm một lần đọc store = mất lợi thế chính của JWT
```

Đây là điểm mà nhiều hệ thống rơi vào tình trạng tệ nhất của cả hai: họ thêm một denylist trong Redis để thu hồi JWT — và giờ họ có **cả** độ phức tạp của JWT **lẫn** một lần đọc Redis mỗi request. Ở điểm đó, session đơn giản hơn và mạnh hơn.

Cách giảm nhẹ đúng: **access token TTL rất ngắn** (5–15 phút) + refresh token thu hồi được. Cửa sổ rủi ro bằng TTL của access token, và đó là con số bạn chọn có ý thức. Xem [JWT & refresh token](03-jwt-refresh-token.md).

### Lưu ở đâu — quan trọng hơn chọn session hay token

```text
                    XSS đọc được?   Tự gửi kèm?   CSRF?
localStorage             CÓ             không       không
sessionStorage           CÓ             không       không
cookie thường            CÓ             có          CÓ
cookie HttpOnly          KHÔNG          có          CÓ (cần SameSite/CSRF token)
bộ nhớ JS (biến)         chỉ khi đang chạy  không    không
```

```text
Cookie HttpOnly + Secure + SameSite  ← MẶC ĐỊNH ĐÚNG cho web app
localStorage                         ← phổ biến, và XSS lấy được token
```

Lập luận thường gặp cho `localStorage` là "để tránh CSRF". Nó đúng, nhưng đổi một rủi ro (CSRF, đã có giải pháp chuẩn) lấy một rủi ro nghiêm trọng hơn (XSS lấy được token và gửi đi bất cứ đâu).

```ts
res.cookie('sid', sessionId, {
  httpOnly: true,        // JS KHÔNG đọc được → XSS không lấy được
  secure: true,          // chỉ qua HTTPS
  sameSite: 'lax',       // chống CSRF cho hầu hết trường hợp
  path: '/',
  maxAge: 7 * 24 * 3600 * 1000,
});
```

`sameSite`:

```text
strict  không gửi kèm request từ site khác — an toàn nhất, phá luồng OAuth callback
lax     gửi với điều hướng GET cấp cao nhất — MẶC ĐỊNH ĐÚNG
none    gửi mọi lúc; BẮT BUỘC kèm Secure — cần cho cross-site thật sự
```

Xem [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md).

### Chọn thế nào

```text
DÙNG SESSION khi:
  · web app truyền thống hoặc SPA cùng domain
  · cần thu hồi ngay (ngân hàng, y tế, admin)
  · quyền thay đổi thường xuyên
  · đã có Redis
  → đây là mặc định đúng cho hầu hết ứng dụng

DÙNG TOKEN khi:
  · nhiều service verify độc lập, không muốn gọi về auth service
  · client bên thứ ba (mobile, API công khai)
  · liên kết giữa các tổ chức (OIDC)
  · thật sự stateless là yêu cầu

MẪU PHỔ BIẾN NHẤT (kết hợp):
  access token JWT ngắn (5–15 phút, trong bộ nhớ hoặc cookie)
  + refresh token dài, lưu ở SERVER, THU HỒI ĐƯỢC (cookie HttpOnly)
```

### Session không stateless — và điều đó thường không sao

Lập luận "session không scale" đã lỗi thời:

```text
Redis: ~0,2ms mỗi lần đọc, hàng trăm nghìn ops/giây
⇒ với một API mà mỗi request đã tốn 20–100ms, 0,2ms là không đáng kể
```

Vấn đề thật của session không phải hiệu năng, mà là:

```text
· cần một Redis (và nó phải có persistence — nếu không, restart = đăng xuất hàng loạt)
· cross-domain khó hơn (cookie ràng buộc theo domain)
· mobile app dùng cookie kém tự nhiên hơn
```

Xem [Persistence & failure](../../03-database/02-redis/05-persistence-failure.md).

### Bảo mật session

```ts
// ① Session fixation: ĐỔI session ID sau khi đăng nhập
await req.session.regenerate();
req.session.userId = user.id;

// ② Gắn thêm ngữ cảnh để phát hiện đánh cắp
req.session.ua = hash(req.headers['user-agent']);
req.session.ipPrefix = maskIp(req.ip);        // /24 — IP đổi khi chuyển mạng

// ③ Hai loại hết hạn
//    idle timeout: 30 phút không hoạt động
//    absolute timeout: 12 giờ, bất kể hoạt động
```

Session fixation (①) là lỗ hổng cụ thể: attacker đặt một session ID vào trình duyệt nạn nhân **trước** khi họ đăng nhập, rồi dùng chính ID đó sau khi họ đã đăng nhập. `regenerate()` chặn nó, và nó là một dòng code.

Về ②: gắn IP chính xác gây đăng xuất khi người dùng chuyển từ Wi-Fi sang 4G. Dùng tiền tố /24 hoặc chỉ dùng làm tín hiệu để cảnh báo, không để chặn.

### Đăng xuất

```text
SESSION  xoá key khỏi store → có hiệu lực NGAY, trên MỌI thiết bị nếu muốn
TOKEN    xoá ở client → server VẪN chấp nhận token đó tới khi hết hạn
         → cần denylist, hoặc chấp nhận cửa sổ = TTL
```

"Đăng xuất khỏi mọi thiết bị" là tính năng mà session cho **miễn phí** và JWT thuần **không thể** làm.

### Kết luận thực dụng

Nhiều hệ thống chọn JWT vì nó được nhắc tới nhiều hơn, rồi phát hiện họ cần thu hồi, rồi thêm Redis denylist — và kết thúc ở một hệ thống phức tạp hơn session mà không mạnh hơn.

> **Nếu bạn có một web app và một Redis, session là lựa chọn mặc định đúng.**
> Chọn JWT khi bạn có lý do cụ thể mà session không đáp ứng được.

## Example

Hai cách, cùng một luồng:

```ts
// ═══ SESSION ═══
@Post('login')
async login(@Body() dto: LoginDto, @Req() req, @Res({ passthrough: true }) res) {
  const user = await this.auth.verifyPassword(dto.email, dto.password);
  await new Promise<void>(r => req.session.regenerate(() => r()));   // chống fixation
  req.session.userId = user.id;
  req.session.tenantId = user.tenantId;
  return { user: toPublic(user) };
}

@Post('logout')
async logout(@Req() req) {
  await new Promise<void>(r => req.session.destroy(() => r()));      // hiệu lực NGAY
  return { ok: true };
}
```

```ts
// ═══ TOKEN (access ngắn + refresh thu hồi được) ═══
@Post('login')
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res) {
  const user = await this.auth.verifyPassword(dto.email, dto.password);

  const accessToken = this.jwt.sign(
    { sub: user.id, tenant: user.tenantId },
    { expiresIn: '10m' });                                   // NGẮN

  const refreshToken = randomBytes(32).toString('base64url');
  await this.refreshStore.save({                              // lưu ở SERVER
    hash: sha256(refreshToken), userId: user.id,
    expiresAt: addDays(new Date(), 30), family: randomUUID(),
  });

  res.cookie('rt', refreshToken, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/refresh',
    maxAge: 30 * 24 * 3600 * 1000,
  });
  return { accessToken };                                     // client giữ trong BỘ NHỚ
}
```

Ba chi tiết trong bản token:

```text
access token ngắn        → cửa sổ rủi ro khi thu hồi = 10 phút
refresh token lưu server → THU HỒI ĐƯỢC
path: '/auth/refresh'    → cookie chỉ gửi tới đúng endpoint đó, giảm bề mặt
```

## Prediction

1. Xoá tài khoản, JWT TTL 15 phút — người đó truy cập được bao lâu nữa?
2. Xoá session — bao lâu?
3. Token trong `localStorage`, có lỗ hổng XSS — attacker lấy được gì?
4. Token trong cookie `HttpOnly`, cùng lỗ hổng XSS — lấy được token không? Làm được gì?
5. Cookie không có `SameSite` — rủi ro gì?
6. `SameSite: strict` với luồng OAuth callback — hoạt động không?
7. Không gọi `session.regenerate()` sau login — lỗ hổng gì?
8. Session lưu ở Redis không persistence, Redis restart — người dùng thế nào?
9. Gắn IP chính xác vào session, người dùng chuyển Wi-Fi → 4G — kết quả?
10. JWT + Redis denylist mỗi request — còn lợi thế gì của JWT?
11. "Đăng xuất khỏi mọi thiết bị" với JWT thuần — làm được không?
12. Đổi role của user, JWT chứa role, TTL 15 phút — bao lâu có hiệu lực?
13. Payload JWT chứa email và role — ai đọc được?

<details>
<summary>Đáp án</summary>

1. **Tới 15 phút** — verify chỉ kiểm tra chữ ký và hạn.
2. **Ngay lập tức** — request sau tra store và không thấy gì.
3. **Token** → gửi đi bất cứ đâu, mạo danh người dùng cho tới khi token hết hạn.
4. **Không lấy được token.** Nhưng vẫn gọi API được **từ trình duyệt nạn nhân** (cookie tự gửi kèm) — XSS vẫn nguy hiểm, chỉ là attacker không mang token đi được.
5. CSRF — site khác gửi request kèm cookie của người dùng. (Trình duyệt hiện đại mặc định `Lax`, nhưng đừng dựa vào đó.)
6. **Không** — cookie không được gửi khi quay lại từ provider. Dùng `lax`.
7. **Session fixation** — attacker đặt session ID trước khi nạn nhân đăng nhập, rồi dùng chính nó.
8. **Đăng xuất hàng loạt.**
9. **Bị đăng xuất** khi đổi mạng — trải nghiệm tệ. Dùng tiền tố /24 hoặc chỉ để cảnh báo.
10. **Gần như không còn gì** — bạn có độ phức tạp của JWT cộng một lần đọc Redis. Session đơn giản hơn.
11. **Không** — không có nơi nào để xoá. Cần denylist hoặc đổi khoá ký (ảnh hưởng mọi người).
12. **Tới 15 phút** — role nằm trong token đã ký, không đọc lại từ DB.
13. **Bất kỳ ai có token** — JWT được base64, **không mã hoá**. Đừng đặt dữ liệu nhạy cảm vào payload.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá user, dùng JWT cũ gọi API | Vẫn hoạt động tới khi hết hạn |
| Xoá session, gọi lại | 401 ngay |
| Đọc `localStorage.getItem('token')` từ console | Lấy được |
| Thử đọc cookie `HttpOnly` từ console | Không được |
| Giải mã payload JWT trên jwt.io | Thấy toàn bộ claim |
| Bỏ `SameSite`, tạo form POST từ trang khác | CSRF |
| `SameSite: strict` với OAuth callback | Luồng gãy |
| Bỏ `session.regenerate()`, mô phỏng fixation | Session của attacker được nâng quyền |
| Restart Redis không persistence | Đăng xuất hàng loạt |
| Gắn IP chính xác, đổi mạng | Bị đăng xuất |
| Đổi role trong DB, dùng JWT cũ | Role cũ vẫn hiệu lực |
| Đổi role với session | Có hiệu lực ngay |
| Đo latency với và không có Redis lookup | Chênh ~0,2ms |

## What Usually Goes Wrong

- **JWT dài hạn không thu hồi được** → tài khoản bị xoá vẫn truy cập được.
- **Token trong `localStorage`** → XSS lấy được và mang đi.
- **Cookie thiếu `HttpOnly`/`Secure`/`SameSite`** → XSS hoặc CSRF.
- **Không `regenerate()` sau login** → session fixation.
- **Dữ liệu nhạy cảm trong payload JWT** → base64, ai cũng đọc được.
- **JWT + denylist mỗi request** → phức tạp của JWT + chi phí của session, không được gì.
- **Redis session không persistence** → đăng xuất hàng loạt khi restart.
- **Chỉ có idle timeout, không có absolute** → phiên sống vô hạn nếu còn hoạt động.
- **Gắn IP chính xác** → đăng xuất khi đổi mạng.
- **Quyền nằm trong token** → thu hồi quyền có độ trễ bằng TTL.
- **Đăng xuất chỉ xoá ở client** với JWT → token vẫn hợp lệ.
- **Không có "đăng xuất mọi thiết bị"** khi đó là yêu cầu thật.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| JWT an toàn hơn session | Chúng giải quyết việc khác nhau; JWT khó thu hồi hơn |
| JWT được mã hoá | Nó được **ký**, base64 — ai cũng đọc payload |
| Session không scale | Redis ~0,2ms; không đáng kể so với một request 50ms |
| `localStorage` tránh được CSRF nên an toàn hơn | Nó đổi CSRF lấy XSS — đánh đổi tệ hơn |
| Cookie `HttpOnly` làm XSS vô hại | XSS vẫn gọi API được từ trình duyệt nạn nhân |
| Đăng xuất xoá token là đủ với JWT | Server vẫn chấp nhận nó |
| Thêm denylist làm JWT thu hồi được | Đúng — nhưng lúc đó nó không còn stateless |
| Stateless luôn tốt hơn | Nó đánh đổi khả năng thu hồi |
| `SameSite` mặc định là đủ | Đừng dựa vào mặc định của trình duyệt |
| Refresh token là bản JWT dài hạn | Nó nên là chuỗi ngẫu nhiên lưu ở server |

## Debugging

1. **Người dùng vẫn truy cập sau khi bị thu hồi** → session hay token? Nếu token, TTL bao lâu?
2. **Kiểm tra cookie**: DevTools → Application → Cookies. Có `HttpOnly`, `Secure`, `SameSite` không?
3. **Giải mã token**: `echo <jwt> | cut -d. -f2 | base64 -d` — nó chứa gì? Hết hạn khi nào?
4. **Session không tồn tại** → kiểm tra store: `redis-cli KEYS 'sess:*' | head`; cookie có được gửi không?
5. **Đăng xuất hàng loạt** → Redis có persistence không? Có restart không?
6. **CSRF** → `SameSite` là gì? Có CSRF token cho form không?
7. **Cookie không được gửi** → domain, path, `Secure` (có HTTPS không?), `SameSite` với cross-site.
8. **Quyền cũ vẫn hiệu lực** → quyền nằm trong token hay đọc từ DB mỗi request?

## Production Considerations

- **Mặc định: session với cookie `HttpOnly` + `Secure` + `SameSite=Lax`** cho web app cùng domain.
- **Chọn JWT khi có lý do cụ thể** — nhiều service verify độc lập, client bên thứ ba, liên kết tổ chức.
- **Nếu dùng JWT: access token 5–15 phút** + refresh token lưu ở server, thu hồi được.
- **Không bao giờ đặt dữ liệu nhạy cảm vào payload JWT.**
- **`session.regenerate()` sau mỗi lần nâng quyền** (login, đổi mật khẩu, chuyển tài khoản).
- **Cả idle timeout lẫn absolute timeout.**
- **Redis session phải có persistence** (AOF), hoặc chấp nhận đăng xuất khi restart.
- **"Đăng xuất khỏi mọi thiết bị"** — với session là xoá theo `userId`; thiết kế key cho phép điều đó (`sess:<userId>:<sid>`).
- **Ghi audit log cho login, logout, refresh, và mọi lần thất bại.**
- **Rate limit endpoint login** để chống brute force. Xem [Password & MFA](05-password-mfa.md).
- **Đặt ra RTO cho thu hồi**: "quyền bị thu hồi phải có hiệu lực trong bao lâu?" Câu trả lời quyết định TTL của bạn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Session | thu hồi ngay, ID không lộ gì, đổi quyền tức thì | cần store dùng chung, +1 lần đọc |
| JWT | không cần store, verify độc lập | không thu hồi được, payload lộ |
| JWT ngắn + refresh | cân bằng tốt nhất | phức tạp hơn cả hai |
| Cookie `HttpOnly` | XSS không lấy được token | cần chống CSRF; khó cho cross-domain |
| `localStorage` | đơn giản, dễ cross-domain | XSS lấy được |
| Token trong bộ nhớ JS | XSS chỉ lấy được khi tab đang mở | mất khi F5; cần refresh |
| `SameSite=Strict` | chống CSRF mạnh nhất | phá luồng OAuth và link từ ngoài |
| `SameSite=Lax` | cân bằng | vẫn cần CSRF token cho một số trường hợp |
| TTL ngắn | cửa sổ rủi ro nhỏ | refresh thường xuyên hơn |
| TTL dài | ít refresh | thu hồi chậm |

## Explain Without Notes

1. Khác biệt cốt lõi giữa session và token là gì?
2. Vì sao JWT không thu hồi được? Điều gì xảy ra khi bạn thêm denylist?
3. Bảng bốn nơi lưu token: XSS đọc được không, tự gửi kèm không, CSRF không?
4. Vì sao `localStorage` là đánh đổi tệ hơn cookie `HttpOnly`?
5. Cookie `HttpOnly` chặn được gì và **không** chặn được gì với XSS?
6. Session fixation là gì, và một dòng code nào chặn nó?
7. Mẫu kết hợp phổ biến nhất là gì, và mỗi phần giải quyết vấn đề gì?
8. Câu hỏi nào quyết định TTL của access token?

## Related

- [Authentication vs Authorization](01-authentication-authorization.md) — hai câu hỏi khác nhau
- [JWT & refresh token](03-jwt-refresh-token.md) — rotation, thu hồi, phát hiện tái sử dụng
- [OAuth 2 & OIDC](04-oauth-oidc.md) — đăng nhập bằng nhà cung cấp
- [Password & MFA](05-password-mfa.md) — bước xác thực đầu tiên
- [Cookies & storage](../../01-web-frontend/00-web-foundations/05-cookies-storage.md) — phía trình duyệt
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — hai tấn công quyết định nơi lưu token
- [Middleware & auth patterns (Next.js)](../../01-web-frontend/03-nextjs/behavior/06-middleware-auth-patterns.md)
- [Persistence & failure (Redis)](../../03-database/02-redis/05-persistence-failure.md) — session store
- [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md) — implementation

## Version / Context

Cookie `SameSite` mặc định `Lax` ở trình duyệt hiện đại; `SameSite=None` bắt buộc kèm `Secure`. JWT theo RFC 7519 — được **ký**, không mã hoá (JWE mới là mã hoá, hiếm dùng). Ví dụ dùng NestJS 10/11 với `express-session` hoặc `@nestjs/jwt`.
