---
level: beginner
area: frontend
type: foundation
prerequisites: []
related:
  - 01-browser-request-render.md
  - 03-url-dns-tcp-tls.md
  - 06-cors.md
  - ../../02-backend-api/00-http-api/00-api-vocabulary.md
---

# Từ vựng Web: URL, HTTP, origin

## Note này trả lời gì

Khi bạn gõ một địa chỉ vào browser rồi Enter, **những cái tên trong quá trình đó nghĩa là gì** — URL, host, origin, request, response, header, method, status.

Đây là note **từ vựng**, không phải note behavior. Nó không dạy cache hoạt động thế nào hay CORS thất bại ra sao. Nó chỉ đảm bảo khi bạn đọc `06-cors.md` và thấy chữ "origin", bạn biết chính xác đó là gì.

> Đọc note này mất ~10 phút. Nếu bạn đã biết origin gồm ba phần và biết `PUT` khác `PATCH` ở đâu, hãy bỏ qua và vào [01-browser-request-render.md](./01-browser-request-render.md).

## Vị trí

```text
Bạn gõ URL ────▶ Browser ────▶ [ HTTP request ] ────▶ Server
                                                        │
Browser render ◀──── [ HTTP response ] ◀────────────────┘

     ▲                    ▲
     │                    │
  từ vựng             từ vựng
  của note này        của note này
```

Note này định nghĩa các danh từ trên sơ đồ. Byte đi thế nào ở tầng dưới là việc của [network vocabulary](../../04-infrastructure/01-networking/00-network-vocabulary.md).

## Định nghĩa

### Client và server

**Client** là bên mở kết nối và hỏi. **Server** là bên chờ và trả lời.

Đây là **vai trò trong một cuộc trao đổi**, không phải loại máy tính. Cùng một process có thể vừa là server (nhận request từ browser) vừa là client (gọi database, gọi API của người khác).

```text
Browser ──request──▶ NestJS ──request──▶ PostgreSQL
 client              server              server
                     client
```

NestJS là server với browser và là client với PostgreSQL. Hiểu điều này mới đọc được các note về timeout và retry: bạn phải biết mình đang nói về phía nào.

### URL và các phần của nó

**URL** (Uniform Resource Locator) là một chuỗi ký tự nói **đủ** để tìm ra một tài nguyên: giao thức nào, máy nào, đường nào trên máy đó.

```text
https://api.shop.com:443/v1/orders?status=paid&page=2#summary
└─┬─┘   └──────┬─────┘ └┬┘└───┬───┘└────────┬───────┘└──┬───┘
scheme       host      port  path        query      fragment
```

| Phần | Nghĩa | Ai đọc nó |
|---|---|---|
| **scheme** | giao thức dùng để nói (`https`, `http`, `ws`, `mailto`) | browser, để biết nói kiểu gì |
| **host** | máy nào — tên miền hoặc IP | dùng để phân giải ra IP |
| **port** | cửa nào trên máy đó | hệ điều hành của server |
| **path** | tài nguyên nào trên server | server |
| **query** | tham số, dạng `key=value` nối bằng `&` | server |
| **fragment** | vị trí *trong* tài liệu, sau dấu `#` | **chỉ browser** — không gửi lên server |

Hai điều đáng nhớ ngay:

**Fragment không bao giờ được gửi đi.** Server không biết `#summary` tồn tại. Nếu bạn định đọc nó ở backend, bạn sẽ không bao giờ đọc được.

**Port có mặc định theo scheme.** `https` → 443, `http` → 80. `https://shop.com` và `https://shop.com:443` là **cùng một** URL. Nhưng `http://shop.com:80` và `https://shop.com:443` là hai URL khác nhau ở mọi khía cạnh.

### Domain, hostname, host — ba từ hay bị dùng lẫn

```text
                shop.com                     ← domain (tên bạn đăng ký)
            api.shop.com                     ← hostname (một máy/service cụ thể)
            api.shop.com:8080                ← host trong ngữ cảnh URL (có thể kèm port)
```

| Từ | Nghĩa chính xác |
|---|---|
| **domain** | tên bạn mua và đăng ký, ví dụ `shop.com` |
| **subdomain** | nhánh con của domain: `api`, `www`, `staging` trong `api.shop.com` |
| **hostname** | tên đầy đủ trỏ tới một máy: `api.shop.com` |
| **host** | trong URL và trong header `Host`: hostname, **kèm port nếu không phải mặc định** |

Lý do phải phân biệt: cookie gắn theo **domain**, còn origin gắn theo **hostname + port**. Hai quy tắc khác nhau, và đó là nguồn của rất nhiều bug đăng nhập.

### Origin — khái niệm quan trọng nhất trong note này

**Origin** là bộ ba: `scheme + hostname + port`.

```text
https://shop.com          origin = (https, shop.com, 443)
```

Hai URL **cùng origin** khi và chỉ khi cả **ba** phần giống nhau:

| URL A | URL B | Cùng origin? | Vì |
|---|---|---|---|
| `https://shop.com/a` | `https://shop.com/b` | ✅ | path không tính |
| `https://shop.com` | `http://shop.com` | ❌ | scheme khác |
| `https://shop.com` | `https://api.shop.com` | ❌ | hostname khác — subdomain vẫn là khác |
| `https://shop.com` | `https://shop.com:8080` | ❌ | port khác |
| `http://localhost:3000` | `http://localhost:4000` | ❌ | port khác |

Dòng cuối là lý do bạn gặp lỗi CORS ngay ở máy mình: Next.js chạy `:3000`, NestJS chạy `:4000` — với browser, đó là **hai website khác nhau**.

Origin là đơn vị bảo mật của browser. Cookie, localStorage, quyền đọc response — tất cả đều tính theo origin. Chi tiết vì sao và cách sửa: [06-cors.md](./06-cors.md).

### HTTP request gồm những gì

**HTTP** là bộ quy ước về **hình dạng của một câu hỏi và một câu trả lời** giữa client và server. Một request là văn bản có cấu trúc:

```text
POST /v1/orders HTTP/1.1              ← start line: method + path + version
Host: api.shop.com                    ┐
Content-Type: application/json        │ headers: metadata về request
Authorization: Bearer eyJhbGc...      │
Content-Length: 41                    ┘
                                      ← một dòng trống, bắt buộc
{"productId":"p_123","quantity":2}    ← body: dữ liệu thật
```

| Thành phần | Là gì |
|---|---|
| **method** | *ý định* của bạn với tài nguyên: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| **path** | tài nguyên nào |
| **header** | thông tin **về** request, dạng `Tên: giá trị` |
| **body** | dữ liệu bạn gửi kèm. `GET` và `DELETE` thường không có body |

### HTTP response gồm những gì

```text
HTTP/1.1 201 Created                  ← status line: mã + lý do
Content-Type: application/json        ┐ headers
Location: /v1/orders/o_789            ┘
                                      ← dòng trống
{"id":"o_789","status":"pending"}     ← body
```

Cấu trúc đối xứng với request. Khác duy nhất: thay vì method + path, response có **status code**.

### Method — ý định, không phải kỹ thuật

| Method | Ý định | Có body? |
|---|---|---|
| `GET` | đọc, không đổi gì | không |
| `POST` | tạo mới, hoặc "làm một việc" | có |
| `PUT` | thay thế **toàn bộ** tài nguyên | có |
| `PATCH` | sửa **một phần** tài nguyên | có |
| `DELETE` | xoá | thường không |

Method là **lời hứa của bạn**, không phải ràng buộc mà HTTP áp lên bạn. Bạn *có thể* viết một `GET /deleteUser?id=5` xoá thật — và nó sẽ gây tai hoạ, vì browser, CDN và crawler đều tin rằng `GET` an toàn nên tự do gọi lại nó. Vì sao điều đó phá hệ thống: [03-http-semantics-idempotency.md](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md).

### Status code — năm lớp

```text
1xx  đang xử lý           ít gặp trực tiếp
2xx  thành công           200 OK, 201 Created, 204 No Content
3xx  chuyển hướng         301 vĩnh viễn, 302 tạm thời, 304 dùng cache đi
4xx  CLIENT sai           400, 401, 403, 404, 409, 422, 429
5xx  SERVER sai           500, 502, 503, 504
```

Ranh giới cần nhớ nằm giữa `4xx` và `5xx`: **`4xx` = lỗi của bên gọi, gọi lại y như vậy vẫn lỗi. `5xx` = lỗi của bên nhận, gọi lại có thể thành công.**

Đó không phải chuyện thẩm mỹ — nó quyết định client có nên retry hay không, và alert có nên đánh thức người trực hay không. Trả `500` cho dữ liệu người dùng gửi sai làm dashboard lỗi của bạn thành vô nghĩa.

Ý nghĩa từng mã và cách chọn: [00-api-vocabulary.md](../../02-backend-api/00-http-api/00-api-vocabulary.md).

### Header đáng biết ngay

| Header | Hướng | Nói gì |
|---|---|---|
| `Host` | request | bạn đang hỏi hostname nào (một IP có thể phục vụ nhiều site) |
| `Content-Type` | cả hai | body là định dạng gì: `application/json`, `text/html` |
| `Authorization` | request | danh tính: `Bearer <token>` |
| `Cookie` | request | browser tự động gắn |
| `Set-Cookie` | response | server yêu cầu browser lưu cookie |
| `Cache-Control` | cả hai | được cache không, bao lâu |
| `Location` | response | với `3xx`: đi đâu; với `201`: tài nguyên vừa tạo ở đâu |

### Stateless — HTTP không nhớ bạn

Mỗi HTTP request là **độc lập**. Server không có ký ức nào về request trước của bạn.

```text
Request 1:  POST /login       → đăng nhập thành công
Request 2:  GET /my-orders    → server không biết bạn là ai
```

Vì vậy request 2 **phải tự mang bằng chứng danh tính** — cookie hoặc `Authorization` header. Toàn bộ chủ đề session, token và JWT tồn tại chỉ để giải quyết đúng một câu này. Xem [03-auth/](../../02-backend-api/03-auth/README.md).

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| Subdomain thì cùng origin | `shop.com` và `api.shop.com` là **khác** origin | fetch từ frontend bị CORS chặn, không hiểu vì sao |
| Đổi port không ảnh hưởng gì | port là một phần của origin | `localhost:3000` gọi `localhost:4000` cần CORS |
| Fragment gửi lên server | fragment chỉ tồn tại trong browser | logic backend đọc `#...` không bao giờ chạy |
| `GET` không đổi dữ liệu vì HTTP bắt buộc | HTTP chỉ *quy ước*; code bạn viết mới quyết định | crawler hoặc prefetch của browser vô tình xoá dữ liệu |
| Lỗi gì cũng trả `500` | `4xx` là lỗi bên gọi, `5xx` là lỗi bên nhận | client retry vô ích; alert 5xx nhiễu tới mức bị bỏ qua |
| `PUT` và `PATCH` như nhau | `PUT` thay toàn bộ — field không gửi bị **xoá** | mất dữ liệu khi client gửi thiếu field |
| HTTPS là "HTTP có ổ khoá màu xanh" | HTTPS là HTTP chạy trong đường ống được TLS mã hoá | không hiểu vì sao lỗi certificate xảy ra trước khi request được gửi |
| Header là tuỳ ý, không quan trọng | `Host`, `Content-Type`, `Cache-Control` thay đổi hành vi thật | body JSON bị parse sai vì thiếu `Content-Type` |

## Kiểm tra bản thân

Trả lời không nhìn lại. Nếu tắc ở câu nào, đọc lại đúng mục đó.

1. `https://shop.com` và `https://shop.com:443` — cùng origin hay khác? Vì sao?
2. `http://localhost:3000` và `http://localhost:4000` — cùng origin hay khác?
3. Ba phần của origin là gì? Path có nằm trong đó không?
4. Phần nào của URL không bao giờ được gửi lên server?
5. Client gửi dữ liệu sai định dạng — trả `4xx` hay `5xx`? Database sập — trả gì?
6. Vì sao `GET /my-orders` sau khi `POST /login` mà server vẫn cần cookie hoặc token?
7. `PUT /users/5` với body chỉ có `{"name":"A"}` — trường `email` của user 5 sẽ thế nào?
8. Một IP phục vụ 3 website khác nhau. Header nào cho server biết bạn muốn website nào?

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 01-browser-request-render.md   ← toàn bộ đường đi, đầu-tới-cuối
        ├──▶ 03-url-dns-tcp-tls.md          ← URL biến thành kết nối thế nào
        ├──▶ 02-http-browser-cache.md       ← vì sao thấy dữ liệu cũ
        ├──▶ 06-cors.md                     ← origin gây ra lỗi gì (cần mục "Origin" ở trên)
        └──▶ 00-api-vocabulary.md           ← phía server nói gì (status code, REST, DTO)
```

Nếu chỉ đọc được một note tiếp: [01-browser-request-render.md](./01-browser-request-render.md). Nó dùng gần như mọi từ trong note này.

## Related

- [Browser request → render](./01-browser-request-render.md) — behavior đầy-đủ dùng từ vựng này
- [URL → DNS → TCP → TLS](./03-url-dns-tcp-tls.md) — tầng dưới của cùng một request
- [CORS](./06-cors.md) — hệ quả trực tiếp của khái niệm origin
- [Cookie & storage](./05-cookies-storage.md) — cookie theo domain, storage theo origin
- [Từ vựng API](../../02-backend-api/00-http-api/00-api-vocabulary.md) — status code, REST, DTO
- [Từ vựng network](../../04-infrastructure/01-networking/00-network-vocabulary.md) — IP, port, socket, TCP, DNS, TLS
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — vì sao method là lời hứa
- [Glossary](../../00-roadmap/glossary.md)
