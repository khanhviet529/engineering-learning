---
level: foundation
area: frontend
prerequisites:
  - 01-browser-request-render.md
  - 05-cookies-storage.md
related:
  - ../../02-backend-api/00-http-api/01-http-request-response.md
  - ../../05-cross-cutting/security/03-xss-csrf.md
---

# CORS

> CORS không bảo vệ server của bạn. Nó bảo vệ **người dùng** khỏi việc một site lạ đọc dữ liệu từ site khác bằng credential của họ. Hiểu sai điều này dẫn tới cả cấu hình sai và kỳ vọng sai.

## Position

```text
Browser (JS trên origin A) → HTTP → Server (origin B)
     ↑ browser thực thi CORS ở đây, TRƯỚC khi trả response cho JS
```

CORS được thực thi **trong browser**, không phải trên server. `curl` và backend-to-backend không bao giờ gặp CORS.

## Problem

```text
Access to fetch at 'https://api.example.com/tasks' from origin 'http://localhost:3000'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

Bạn thấy lỗi này, thấy request **có** trong tab Network với status 200, và kết luận "server bị lỗi CORS". Sai ở hai điểm:

1. Server không lỗi — server chỉ **không cho phép**. Response đã tới browser bình thường.
2. Không phải server chặn — **browser** chặn, và nó chặn việc *JS của bạn đọc response*, sau khi request đã được thực hiện.

Điểm thứ hai có hệ quả lớn: nếu request là `POST /transfer-money`, nó **đã chạy trên server** rồi. CORS chỉ ngăn bạn đọc kết quả. Đó là lý do CORS không phải cơ chế chống CSRF.

## Mental Model

Mặc định của web là **same-origin policy**: JS từ origin A không được đọc dữ liệu từ origin B. Lý do: browser tự động gắn cookie của B vào request tới B. Nếu không có SOP, `evil.com` chỉ cần `fetch('https://bank.com/accounts')` là đọc được tài khoản của bạn.

CORS là cơ chế để server B **nới lỏng** SOP một cách có kiểm soát:

```text
Không có CORS  → SOP chặn hết → an toàn nhưng không dùng được API cross-origin
Có CORS        → server B tự khai báo: "origin A được phép đọc tôi"
```

Origin = **scheme + host + port**. Cả ba phải khớp:

```text
https://app.com        vs  http://app.com         → khác (scheme)
https://app.com        vs  https://api.app.com    → khác (host)
http://localhost:3000  vs  http://localhost:4000  → khác (port)
```

Subdomain **không** được coi là cùng origin. Đây là bất ngờ phổ biến nhất.

## How It Works

CORS có hai chế độ.

### Simple request — không có preflight

Nếu request thoả **tất cả**:

- method là `GET`, `HEAD`, hoặc `POST`;
- chỉ dùng header "an toàn" (`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`);
- `Content-Type` là `application/x-www-form-urlencoded`, `multipart/form-data`, hoặc `text/plain`.

thì browser gửi thẳng và kiểm tra response header sau đó.

Chú ý: `Content-Type: application/json` **không** nằm trong danh sách. Đây là lý do gần như mọi API JSON đều bị preflight.

### Preflighted request

Ngược lại, browser gửi `OPTIONS` trước:

```http
OPTIONS /tasks HTTP/1.1
Origin: http://localhost:3000
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization
```

Server phải trả:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 86400
```

Chỉ khi preflight thành công, browser mới gửi request thật.

`Access-Control-Max-Age` cho browser cache kết quả preflight — không có nó, **mỗi** request có preflight riêng, tức gấp đôi số round-trip.

### Credentials — trường hợp gây nhiều lỗi nhất

Để cookie đi kèm request cross-origin, cần **cả hai phía**:

```ts
fetch(url, { credentials: 'include' })   // client
```

```http
Access-Control-Allow-Origin: http://localhost:3000   ← origin cụ thể, KHÔNG được là *
Access-Control-Allow-Credentials: true
```

Quy tắc tuyệt đối: **`Allow-Origin: *` không dùng được với credentials.** Browser sẽ chặn. Bạn phải echo lại origin cụ thể từ một allowlist.

### Đọc response header

JS chỉ đọc được một số header mặc định. Muốn đọc header khác:

```http
Access-Control-Expose-Headers: X-Total-Count, X-Request-Id
```

Không có dòng này, `response.headers.get('X-Total-Count')` trả `null` dù header có trong Network tab. Đây là lỗi hay gặp khi làm pagination.

## Example

```ts
// NestJS — allowlist, không wildcard, có credentials
app.enableCors({
  origin: (origin, cb) => {
    const allowed = ['https://app.example.com', 'http://localhost:3000'];
    // origin là undefined với request same-origin hoặc từ curl/server
    cb(null, !origin || allowed.includes(origin));
  },
  credentials: true,
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400,
});
```

```ts
// Client
const res = await fetch('https://api.example.com/tasks', {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },  // → gây preflight
});
const total = res.headers.get('X-Total-Count');     // null nếu thiếu exposedHeaders
```

## Prediction

1. `fetch` với `Content-Type: application/json` — có preflight không? Còn `text/plain`?
2. Server trả `Allow-Origin: *`, client dùng `credentials: 'include'` — kết quả?
3. `POST /delete-all` bị CORS chặn. Dữ liệu đã bị xoá chưa?
4. `curl` gọi API thành công, browser báo lỗi CORS. Server có vấn đề gì không?
5. Server trả `X-Total-Count` (thấy trong Network tab) nhưng `headers.get()` trả `null`. Thiếu gì?
6. Bạn thêm `Authorization` header vào một `GET` request đơn giản — có preflight không?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ `Access-Control-Allow-Origin` | Lỗi CORS, nhưng request **vẫn** hiện trong Network với status 200 |
| Dùng `*` + `credentials: 'include'` | Browser chặn với lỗi nói rõ về wildcard |
| Thiếu `Allow-Headers: authorization` | Preflight fail; request thật không bao giờ được gửi |
| Bỏ `Max-Age` rồi gọi 50 request | Thấy 50 `OPTIONS` trong Network — latency gấp đôi |
| Đổi port frontend từ 3000 → 3001 | Lỗi CORS trở lại — chứng minh port thuộc origin |
| Gọi cùng API bằng `curl` | Thành công — chứng minh CORS là quy tắc của browser |
| Trả `Allow-Origin` echo bất kỳ origin nào (`req.headers.origin`) | "Hoạt động" — và đó là lỗ hổng: mọi site đều đọc được API của bạn với cookie người dùng |

Thí nghiệm cuối là quan trọng nhất: nó là cách "sửa CORS" phổ biến nhất trên Stack Overflow và cũng là cách vô hiệu hoá SOP.

## What Usually Goes Wrong

- **`Allow-Origin: *` cho tiện** — mất hết bảo vệ, và vẫn không dùng được với cookie.
- **Echo origin không kiểm tra** — tệ hơn `*`, vì nó *hoạt động* với credentials, biến API thành đọc được bởi mọi site.
- **Thiếu handler cho `OPTIONS`** — router yêu cầu auth cho mọi method, kể cả `OPTIONS`. Preflight không mang credential nên bị 401 → CORS fail. Preflight phải được xử lý **trước** guard auth.
- **Thiếu `exposedHeaders`** cho pagination/request-id.
- **Không có `Max-Age`** → gấp đôi số request.
- **Dùng proxy trong dev để "khỏi lo CORS"** rồi production mới phát hiện chưa cấu hình.
- **Nghĩ CORS là bảo mật của server** → không có authz thật, chỉ dựa vào CORS.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| CORS bảo vệ server | Bảo vệ người dùng. Server vẫn cần auth + authz |
| CORS chặn request | Chặn JS **đọc response**. Request đã tới server (trừ khi preflight fail) |
| CORS chống CSRF | Không. CSRF chỉ cần gửi request, không cần đọc response |
| Subdomain là same-origin | Không. `api.app.com` ≠ `app.com` |
| Lỗi CORS = lỗi server | Server chạy đúng, chỉ là không cho phép origin đó |
| `*` là cách nhanh để sửa | Không dùng được với credentials, và mất bảo vệ |
| Preflight fail = server lỗi | Thường là `OPTIONS` bị auth middleware chặn |

## Debugging

1. Đọc **nguyên văn** thông báo lỗi trong console. Chrome nói rõ thiếu header nào hoặc vi phạm quy tắc nào — đừng bỏ qua để đi tìm trên mạng.
2. Network tab, filter theo `OPTIONS`:
   - **Không có `OPTIONS`** → request là simple; vấn đề ở `Allow-Origin` của response chính.
   - **Có `OPTIONS` và nó fail (401/404/500)** → server chưa xử lý preflight, thường vì auth middleware. Đây là nguyên nhân số một.
3. So sánh chuỗi origin **từng ký tự**: scheme, host, port, không có dấu `/` cuối.
4. Chạy lại bằng `curl -H "Origin: http://localhost:3000" -i <url>` → xem server có thực sự trả các header CORS không. Loại trừ browser khỏi bài toán.
5. Dùng credentials? Kiểm tra bốn thứ cùng lúc: `credentials: 'include'`, `Allow-Credentials: true`, `Allow-Origin` là origin cụ thể, và cookie có `SameSite=None; Secure` nếu thật sự cross-site.
6. Đọc được header? Kiểm tra `Access-Control-Expose-Headers`.

## Production Considerations

- **Allowlist từ config**, không hardcode, không echo. Danh sách nên nằm trong env var.
- **Đặt `Max-Age`** (ví dụ 86400) để bỏ preflight lặp lại.
- **Xử lý `OPTIONS` trước authentication** trong chuỗi middleware.
- Cân nhắc **đặt frontend và API cùng origin** qua reverse proxy (`/api` → backend). CORS biến mất hoàn toàn, cookie đơn giản hơn, không cần `SameSite=None`. Đây thường là kiến trúc tốt hơn là cấu hình CORS cho đúng.
- CORS không thay thế authz: mọi endpoint vẫn phải tự kiểm tra quyền. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cùng origin qua proxy | không có CORS, cookie đơn giản | thêm một lớp proxy phải vận hành |
| CORS với allowlist | frontend/API deploy độc lập | cấu hình phải đúng ở nhiều nơi |
| `Allow-Origin: *` | đơn giản | chỉ dùng được cho API công khai không credential |
| `Max-Age` dài | ít preflight | đổi policy có độ trễ |

## Explain Without Notes

1. CORS bảo vệ ai, khỏi cái gì?
2. CORS chặn request hay chặn việc đọc response? Hệ quả với `POST` là gì?
3. Điều kiện nào khiến một request bị preflight? Vì sao API JSON hầu như luôn bị?
4. Vì sao `Allow-Origin: *` không dùng được với cookie?
5. Preflight trả 401 — nguyên nhân thường gặp nhất là gì?

## Related

- [Cookies & storage](05-cookies-storage.md) — vì sao credentials cross-origin cần cấu hình cả hai phía
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — CORS không giải quyết CSRF
- [HTTP request/response](../../02-backend-api/00-http-api/01-http-request-response.md) — header và method
- [Reverse proxy](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — cách xoá bỏ CORS bằng kiến trúc
- [Access control](../../05-cross-cutting/security/04-access-control.md) — bảo vệ thật nằm ở đây
