---
level: advanced
area: backend
prerequisites:
  - 03-jwt-refresh-token.md
related:
  - 06-authorization-models.md
  - ../../05-cross-cutting/security/04-access-control.md
---

# OAuth 2 & OIDC

> Một team dựng "Đăng nhập bằng Google" trong hai giờ. Sáu tháng sau, pentest phát hiện: họ nhận `access_token` từ client, gọi Google `/userinfo` để lấy email, rồi tạo phiên. Attacker lấy access token từ **ứng dụng khác của chính họ** (cũng do Google phát hành), gửi lên, và đăng nhập được vào bất kỳ tài khoản nào. Lỗi không nằm ở Google — nằm ở việc dùng token **uỷ quyền** để **xác thực**.

## Position

```text
01 authn vs authz  →  02 session vs token  →  03 JWT
                                                ↓
                                     04 ỦY QUYỀN CHO BÊN THỨ BA  ← đây
```

## Problem

Bạn cần một trong hai thứ (và chúng **không** giống nhau):

```text
① "Cho tôi truy cập tài nguyên của người dùng ở dịch vụ khác"
   → đọc lịch Google, đẩy code lên GitHub
   → OAuth 2.0 (ỦY QUYỀN)

② "Cho tôi biết người dùng này là ai"
   → đăng nhập bằng Google
   → OpenID Connect (XÁC THỰC), xây trên OAuth 2.0
```

Không có OAuth, cách duy nhất là người dùng đưa bạn **mật khẩu Google của họ**. Vấn đề OAuth giải quyết:

```text
✗ mật khẩu: quyền TOÀN BỘ, vĩnh viễn, không thu hồi riêng lẻ được
✓ OAuth:    quyền GIỚI HẠN (scope), có hạn, thu hồi riêng lẻ được
```

## Mental Model

### Bốn vai

```text
Resource Owner        người dùng — chủ sở hữu dữ liệu
Client                ứng dụng CỦA BẠN — muốn truy cập
Authorization Server  Google/Auth0/Keycloak — phát hành token
Resource Server       API giữ dữ liệu (thường cùng bên với AS)
```

Nhầm lẫn phổ biến nhất: nghĩ "client" là trình duyệt. Client là **ứng dụng của bạn** (SPA hoặc backend).

### Authorization Code + PKCE — luồng duy nhất bạn cần

```text
① Người dùng bấm "Đăng nhập bằng Google"
② App tạo:  code_verifier (ngẫu nhiên)
            code_challenge = SHA256(code_verifier)
            state (ngẫu nhiên, lưu vào session)
            nonce (ngẫu nhiên, lưu vào session)
③ Chuyển hướng tới AS:
     /authorize?client_id=...&redirect_uri=...&response_type=code
                &scope=openid email&state=...&nonce=...
                &code_challenge=...&code_challenge_method=S256
④ Người dùng đăng nhập ở AS và ĐỒNG Ý cấp quyền
⑤ AS chuyển hướng về:  /callback?code=...&state=...
⑥ App KIỂM TRA state khớp   ← chống CSRF
⑦ App đổi code (BACKEND):
     POST /token  { code, code_verifier, client_id, redirect_uri }
   → { access_token, id_token, refresh_token }
⑧ App VERIFY id_token (chữ ký, iss, aud, exp, nonce)
⑨ App tạo PHIÊN CỦA CHÍNH MÌNH
```

Ba bước hay bị bỏ, mỗi bước là một lỗ hổng:

```text
⑥ state    bỏ → CSRF: attacker ép nạn nhân đăng nhập vào TÀI KHOẢN CỦA ATTACKER
⑧ verify   bỏ → chấp nhận token giả hoặc token của ứng dụng khác
② PKCE     bỏ → code bị chặn (deep link, log, referrer) đổi được thành token
```

### PKCE giải quyết vấn đề gì

```text
KHÔNG có PKCE:
  attacker chặn được `code` (qua deep link bị đăng ký trùng, log proxy, lịch sử URL)
  → đổi code lấy token → chiếm tài khoản

CÓ PKCE:
  code chỉ đổi được khi kèm `code_verifier` — thứ chỉ app gốc có trong bộ nhớ
  → code bị chặn trở nên vô dụng
```

PKCE ban đầu dành cho mobile, nay là **khuyến nghị cho mọi client**, kể cả backend có client secret. OAuth 2.1 đưa nó thành bắt buộc.

### `access_token` vs `id_token` — điểm mấu chốt của sự cố ở đầu note

```text
access_token   "người mang token này ĐƯỢC PHÉP LÀM X"
               → dành cho RESOURCE SERVER
               → app của bạn KHÔNG được diễn giải nó
               → có thể là chuỗi opaque, không nhất thiết là JWT

id_token       "người dùng này LÀ AI, và đã đăng nhập lúc nào"
               → dành cho CLIENT (app của bạn)
               → LUÔN là JWT, có `aud` = client_id CỦA BẠN
               → đây là thứ dùng để xác thực
```

Vì sao dùng `access_token` để xác thực là sai:

```text
access_token KHÔNG nói nó được phát hành cho ai.
Attacker có access token hợp lệ từ ứng dụng KHÁC (do cùng AS phát hành),
gửi lên app của bạn → app gọi /userinfo → nhận email của attacker...
hoặc của bất kỳ ai attacker lừa được cấp quyền cho ứng dụng của họ.

id_token có `aud = client_id của bạn`.
Token của ứng dụng khác có `aud` khác → verify thất bại → chặn.
```

Đây gọi là **token substitution / confused deputy**. `aud` là thứ chặn nó.

### Verify `id_token` — bảy bước

```ts
import * as jose from 'jose';

const JWKS = jose.createRemoteJWKSet(
  new URL('https://accounts.google.com/.well-known/jwks.json'),
);

const { payload } = await jose.jwtVerify(idToken, JWKS, {
  issuer: 'https://accounts.google.com',   // ② iss
  audience: process.env.GOOGLE_CLIENT_ID!, // ③ aud = CHÍNH BẠN
});                                        // ① chữ ký, ④ exp/iat tự kiểm

if (payload.nonce !== session.nonce) throw new Error('nonce mismatch');   // ⑤ replay
if (!payload.email_verified) throw new Error('email chưa xác minh');      // ⑥
const externalId = payload.sub;                                           // ⑦ khoá ổn định
```

Bước ⑥ và ⑦ là hai lỗi logic nghiêm trọng nhất khi tích hợp:

```text
email_verified = false
  Một số provider cho phép đăng ký tài khoản với email BẤT KỲ chưa xác minh.
  Nếu bạn khớp người dùng theo email → attacker đăng ký "ceo@company.com"
  ở provider đó → đăng nhập vào tài khoản CEO.

Khớp theo EMAIL thay vì `sub`
  Email THAY ĐỔI được. `sub` thì không.
  Đổi email ở Google → mất tài khoản, hoặc tệ hơn:
  người khác nhận email cũ và chiếm được tài khoản.
```

Quy tắc: **`sub` là khoá; email chỉ là thuộc tính hiển thị.** Lưu `(provider, sub)` là khoá duy nhất.

### Public client vs confidential client

```text
Confidential  backend giữ được client_secret
              → SPA/mobile KHÔNG phải loại này (code tải về máy người dùng)

Public        SPA, mobile — không giữ được secret
              → BẮT BUỘC PKCE
              → redirect_uri phải khớp CHÍNH XÁC (không wildcard)
```

**Lỗi thường gặp**: nhúng `client_secret` vào SPA. Nó nằm trong bundle JavaScript mà ai cũng tải được.

### BFF: nơi nên đặt token

Với web app, mẫu tốt nhất là **Backend For Frontend**:

```text
Browser ──cookie phiên (HttpOnly)──> Backend của bạn ──access token──> API bên thứ ba
         KHÔNG BAO GIỜ thấy OAuth token         giữ token phía server
```

```text
+ token không bao giờ ở trong JS → XSS không lấy được
+ thu hồi phiên tức thì
+ refresh xử lý phía server
− cần backend có state (session store)
```

So với việc SPA tự giữ token: SPA phải lưu access token và refresh token ở đâu đó trong trình duyệt, và mọi nơi đó đều đọc được bởi XSS. Xem [Session vs token](02-session-vs-token.md).

### Scope không phải là quyền của bạn

```text
scope    "app này được phép làm gì với dữ liệu ở GOOGLE"
         → do AS định nghĩa và thực thi

quyền    "người dùng này được phép làm gì trong HỆ THỐNG CỦA BẠN"
         → do BẠN định nghĩa và thực thi
```

Sai lầm: cho rằng đăng nhập bằng Google nghĩa là người dùng đã được uỷ quyền trong hệ thống của bạn. Nó chỉ nói **họ là ai**. Việc họ được làm gì là câu hỏi riêng — xem [Authorization models](06-authorization-models.md).

### Logout không đơn giản

```text
Xoá phiên của BẠN     → người dùng đăng xuất khỏi app của bạn
Phiên ở AS vẫn còn    → bấm "đăng nhập" lại → vào thẳng, không hỏi mật khẩu
```

Muốn đăng xuất cả hai: dùng **RP-Initiated Logout** (`end_session_endpoint`) — nhưng phải cân nhắc, vì nó đăng xuất người dùng khỏi **mọi** ứng dụng dùng AS đó (kể cả Gmail nếu là Google). Với hầu hết trường hợp, đăng xuất cục bộ là hành vi người dùng mong đợi.

### Các luồng KHÔNG dùng

```text
✗ Implicit flow            token trong URL fragment → lộ qua log, lịch sử, referrer
                           đã bị loại bỏ trong OAuth 2.1
✗ Resource Owner Password  app nhận trực tiếp mật khẩu → phá bỏ toàn bộ mục đích
                           đã bị loại bỏ trong OAuth 2.1
✓ Authorization Code + PKCE   dùng cái này
✓ Client Credentials          machine-to-machine, KHÔNG có người dùng
✓ Device Authorization        thiết bị không có trình duyệt (TV, CLI)
```

Nếu tài liệu bạn đang đọc hướng dẫn implicit flow, nó đã cũ.

## Example

Callback handler trong NestJS — mọi bước kiểm tra ở đúng chỗ:

```ts
@Get('callback')
async callback(
  @Query('code') code: string,
  @Query('state') state: string,
  @Session() session: Record<string, any>,
  @Res({ passthrough: true }) res: Response,
) {
  // ① state — chống CSRF. So sánh TRƯỚC khi làm bất cứ việc gì khác.
  if (!state || state !== session.oauthState) throw new UnauthorizedException();
  const { codeVerifier, nonce } = session;
  delete session.oauthState; delete session.codeVerifier; delete session.nonce;  // dùng MỘT LẦN

  // ② đổi code — ở BACKEND, kèm code_verifier
  const tokens = await this.oauth.exchange({ code, codeVerifier });

  // ③ verify id_token — chữ ký, iss, aud, exp, nonce
  const claims = await this.oauth.verifyIdToken(tokens.id_token, nonce);

  // ④ email chưa xác minh → KHÔNG khớp tài khoản
  if (!claims.email_verified) throw new ForbiddenException('email chưa xác minh');

  // ⑤ khớp theo (provider, sub) — KHÔNG theo email
  const user = await this.users.findOrCreateByExternalId('google', claims.sub, {
    email: claims.email, name: claims.name,
  });

  // ⑥ phiên CỦA BẠN; token của provider giữ phía server nếu còn cần
  await new Promise<void>((ok, err) => session.regenerate(e => e ? err(e) : ok()));  // chống fixation
  session.userId = user.id;
  res.redirect(this.safeReturnTo(session.returnTo));   // ⑦ chỉ đường dẫn nội bộ
}
```

Bước ⑦ đáng chú ý: nếu bạn chuyển hướng tới `returnTo` do người dùng cung cấp mà không kiểm tra, bạn có **open redirect** — attacker gửi link đăng nhập kết thúc ở trang giả mạo. Chỉ chấp nhận đường dẫn tương đối bắt đầu bằng `/` và không bắt đầu bằng `//`.

## Prediction

1. Dùng `access_token` để xác thực người dùng — tấn công nào khả thi?
2. `id_token` có `aud` khác `client_id` của bạn — verify đúng thì sao?
3. Bỏ kiểm tra `state` — attacker làm được gì?
4. Bỏ `nonce` — tấn công nào?
5. SPA không dùng PKCE, code bị chặn qua lịch sử trình duyệt — hậu quả?
6. Có PKCE, code bị chặn — hậu quả?
7. Khớp người dùng theo `email` thay vì `sub`, người dùng đổi email ở Google — chuyện gì xảy ra?
8. Chấp nhận `email_verified: false` và khớp theo email — attacker làm được gì?
9. Nhúng `client_secret` vào SPA — ai lấy được?
10. `redirect_uri` cấu hình wildcard `https://*.example.com/callback`, một subdomain bị chiếm — hậu quả?
11. Xoá phiên local rồi bấm "đăng nhập bằng Google" lại — có phải nhập mật khẩu không?
12. Dùng implicit flow, token trong URL fragment — nó xuất hiện ở đâu?
13. Người dùng đăng nhập bằng Google — họ được làm gì trong hệ thống của bạn?

<details>
<summary>Đáp án</summary>

1. **Token substitution** — access token từ ứng dụng khác được chấp nhận. Chính là sự cố ở đầu note.
2. **Bị từ chối** — đó là mục đích của `aud`.
3. **CSRF đăng nhập**: attacker ép nạn nhân hoàn tất luồng với code của attacker → nạn nhân dùng tài khoản attacker và dữ liệu nạn nhân nhập vào thuộc về attacker.
4. **Replay**: id_token cũ bị dùng lại.
5. Attacker **đổi code lấy token** → chiếm tài khoản.
6. Code **vô dụng** — thiếu `code_verifier`.
7. Nếu email cũ được cấp lại cho người khác, người đó **chiếm được tài khoản**. Nhẹ hơn: người dùng mất tài khoản.
8. Đăng ký email của người khác ở provider dễ dãi → **đăng nhập vào tài khoản của họ**.
9. **Bất kỳ ai** — nó nằm trong bundle JS.
10. Attacker chuyển hướng code về subdomain họ kiểm soát → **chiếm tài khoản**.
11. **Không** — phiên ở AS vẫn còn; vào thẳng.
12. **Lịch sử trình duyệt, log proxy, header `Referer`** — đó là lý do nó bị loại bỏ.
13. **Chưa gì cả.** OIDC chỉ nói họ là ai. Quyền là quyết định riêng của bạn.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gửi access token của app khác lên endpoint xác thực | Được chấp nhận nếu không verify `aud` |
| Verify `id_token` với `audience` sai | Bị từ chối |
| Bỏ `state`, thử lại luồng với code cũ của tài khoản khác | Đăng nhập nhầm tài khoản |
| Dùng lại `id_token` cũ | `nonce` chặn (nếu có kiểm) |
| Đổi `code` hai lần | Lần hai bị từ chối (code dùng một lần) |
| Bỏ PKCE và đổi code từ máy khác | Thành công — đó là lỗ hổng |
| Có PKCE, đổi code với verifier sai | Bị từ chối |
| Đổi email ở provider, đăng nhập lại | Tài khoản mới nếu khớp theo email; đúng tài khoản nếu khớp theo `sub` |
| Xem bundle JS tìm `client_secret` | Nếu có, nó đã bị lộ |
| `returnTo=https://evil.com` | Open redirect nếu không kiểm |
| Đăng xuất local rồi đăng nhập lại | Không hỏi mật khẩu |
| Dùng access token đã hết hạn gọi `/userinfo` | 401 |

## What Usually Goes Wrong

- **Dùng `access_token` thay `id_token` để xác thực** — lỗ hổng nghiêm trọng nhất trong danh sách này.
- **Không verify chữ ký `id_token`** — chỉ giải mã payload và tin nó.
- **Không kiểm tra `aud` hoặc `iss`** — chấp nhận token của ứng dụng khác.
- **Bỏ `state`** — CSRF đăng nhập.
- **Bỏ `nonce`** — replay.
- **Bỏ PKCE** — code bị chặn đổi được.
- **Khớp người dùng theo email** thay vì `(provider, sub)`.
- **Bỏ qua `email_verified`** — chiếm tài khoản qua provider dễ dãi.
- **`client_secret` trong client công khai** (SPA, mobile).
- **`redirect_uri` dùng wildcard** — một subdomain bị chiếm là đủ.
- **Open redirect** ở tham số `returnTo`.
- **Lưu OAuth token trong `localStorage`** thay vì giữ phía server (BFF).
- **Không xử lý người dùng thu hồi quyền** ở phía provider — refresh thất bại và app không biết xử lý.
- **Tự cài đặt OAuth server** thay vì dùng thư viện/sản phẩm đã kiểm chứng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| OAuth là giao thức xác thực | OAuth là **uỷ quyền**; OIDC mới là xác thực |
| `access_token` cho biết người dùng là ai | Nó không nói nó được phát hành cho ai |
| `id_token` gửi kèm mọi request tới API của bạn | Nó dùng **một lần** lúc đăng nhập; sau đó dùng phiên của bạn |
| PKCE chỉ cho mobile | Khuyến nghị cho mọi client; bắt buộc trong OAuth 2.1 |
| `state` là tuỳ chọn | Không có nó là CSRF đăng nhập |
| Email là định danh ổn định | Email thay đổi; `sub` thì không |
| Đăng nhập bằng Google = tin tưởng người dùng | Chỉ biết họ là ai, không biết họ được làm gì |
| Đăng xuất khỏi app = đăng xuất khỏi Google | Hai phiên độc lập |
| Scope là quyền trong hệ thống của bạn | Scope là quyền ở **provider** |
| Implicit flow đơn giản hơn nên dùng được | Nó đã bị loại bỏ vì rò rỉ token |
| Tự viết OAuth server cho vui | Đây là loại code không nên tự viết |

## Debugging

1. **Giải mã `id_token`** ở jwt.io: `iss`, `aud`, `exp`, `sub`, `nonce` có đúng không?
2. **`invalid_grant`** khi đổi code → code hết hạn (thường 60 giây), đã dùng, `redirect_uri` không khớp **chính xác**, hoặc `code_verifier` sai.
3. **`redirect_uri_mismatch`** → so sánh từng ký tự với cấu hình ở AS: scheme, cổng, dấu `/` cuối đều tính.
4. **`state mismatch`** → phiên có tồn tại giữa hai request không? Cookie `SameSite=Strict` chặn cookie trong chuyển hướng cross-site — dùng `Lax`.
5. **Verify chữ ký thất bại** → `kid` có trong JWKS không? Cache JWKS có cũ không? Đồng hồ có lệch không?
6. **Xem metadata**: `curl https://accounts.google.com/.well-known/openid-configuration | jq` — mọi endpoint và thuật toán hỗ trợ đều ở đó.
7. **Refresh thất bại đột ngột** → người dùng đã thu hồi quyền ở provider; cần đưa họ qua luồng cấp quyền lại.
8. **Người dùng "mất tài khoản"** → kiểm tra bạn đang khớp theo `sub` hay email.

## Production Considerations

- **Chỉ dùng Authorization Code + PKCE.** Không implicit, không password grant.
- **Verify `id_token` đầy đủ**: chữ ký qua JWKS, `iss`, `aud`, `exp`, `nonce`.
- **Khoá người dùng là `(provider, sub)`**; email là thuộc tính có thể đổi.
- **Từ chối `email_verified: false`** khi khớp tài khoản theo email.
- **`redirect_uri` liệt kê tường minh**, không wildcard.
- **`state`, `nonce`, `code_verifier` dùng một lần**, sinh bằng CSPRNG, xoá sau khi dùng.
- **BFF cho web app**: token ở server, cookie `HttpOnly` cho trình duyệt.
- **`session.regenerate()` sau khi đăng nhập** — chống session fixation.
- **Chỉ chuyển hướng tới đường dẫn nội bộ** sau đăng nhập.
- **Dùng thư viện chuẩn** (`openid-client`, `jose`) thay vì tự ghép request.
- **Xin scope tối thiểu** — mỗi scope thừa là dữ liệu bạn phải bảo vệ.
- **Có đường dự phòng** khi provider ngừng hoạt động (email đăng nhập, provider thứ hai).
- **Log sự kiện đăng nhập** kèm provider, `sub`, IP — cần cho điều tra sự cố.
- **Liên kết tài khoản (account linking)** cần xác minh chủ động: người dùng đã đăng nhập rồi mới được thêm provider mới, không tự động gộp theo email.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Đăng nhập bằng provider | không giữ mật khẩu, MFA sẵn có | phụ thuộc bên thứ ba |
| Mật khẩu tự quản | không phụ thuộc | phải làm đúng hash, reset, MFA |
| BFF (token ở server) | XSS không lấy được token | cần state ở server |
| SPA giữ token | backend không state | XSS lấy được token |
| PKCE | code bị chặn vô dụng | thêm hai tham số |
| RP-initiated logout | đăng xuất triệt để | đăng xuất khỏi cả ứng dụng khác |
| Nhiều provider | tiện cho người dùng | account linking phức tạp |
| Tự dựng AS (Keycloak) | kiểm soát, không phụ thuộc | vận hành, bảo mật là của bạn |

## Explain Without Notes

1. OAuth và OIDC khác nhau ở điểm nào? Mỗi cái trả lời câu hỏi gì?
2. `access_token` và `id_token` khác nhau thế nào, và vì sao dùng nhầm là lỗ hổng?
3. Vẽ luồng Authorization Code + PKCE với đủ chín bước.
4. `state`, `nonce`, `code_verifier` — mỗi cái chống tấn công nào?
5. Vì sao khớp người dùng theo `sub` chứ không theo email?
6. `email_verified: false` nguy hiểm thế nào?
7. BFF là gì và nó giải quyết vấn đề gì?
8. Đăng nhập bằng Google xong, người dùng được làm gì trong hệ thống của bạn?

## Related

- [JWT & refresh token](03-jwt-refresh-token.md) — verify `id_token`, JWKS, `aud`
- [Session vs token](02-session-vs-token.md) — phiên sau khi đăng nhập
- [Authentication vs Authorization](01-authentication-authorization.md) — hai câu hỏi tách biệt
- [Authorization models](06-authorization-models.md) — quyền trong hệ thống của bạn
- [Password & MFA](05-password-mfa.md) — khi bạn tự quản lý danh tính
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — `state` chống CSRF
- [Access control](../../05-cross-cutting/security/04-access-control.md) — kiểm soát truy cập nói chung
- [Guards & interceptors](../02-nestjs/behavior/04-guards-interceptors.md) — cài đặt trong NestJS

## Version / Context

OAuth 2.0 (RFC 6749), PKCE (RFC 7636), OIDC Core 1.0, OAuth 2.0 Security Best Current Practice. OAuth 2.1 (draft) hợp nhất các khuyến nghị: PKCE bắt buộc, loại bỏ implicit và password grant, `redirect_uri` so khớp chính xác. Thư viện Node khuyến nghị: `openid-client`, `jose`.
