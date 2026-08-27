---
level: foundation
area: backend
prerequisites:
  - ../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md
related:
  - 03-http-semantics-idempotency.md
  - ../01-nodejs/01-node-runtime-concurrency.md
---

# HTTP request & response

> HTTP là text trên TCP. Method, status code và header có **ngữ nghĩa** được định nghĩa trong RFC — không phải quy ước tuỳ ý của mỗi team. Tôn trọng ngữ nghĩa đó là cách bạn được cache, retry và proxy hoạt động đúng miễn phí.

## Position

```text
Client → TCP → [HTTP request] → Proxy → Server → [HTTP response] → Client
                     ↑ note này
```

## Problem

Ba quyết định trông như chuyện thẩm mỹ nhưng có hậu quả kỹ thuật thật:

```text
POST /getUser        vs  GET /users/1
200 + { error: ... } vs  404
PUT /tasks/1         vs  PATCH /tasks/1
```

Cột trái "hoạt động" — client vẫn nhận được dữ liệu. Nhưng:

- `POST /getUser` **không được cache** bởi bất kỳ lớp nào (browser, CDN, proxy), và không an toàn để retry.
- `200 + { error }` làm mọi monitoring nghĩ hệ thống khoẻ mạnh; alert theo error rate không bao giờ kích hoạt.
- Chọn sai giữa `PUT` và `PATCH` khiến client ghi mất field mà nó không biết tới.

HTTP là một **hợp đồng chung** giữa client, proxy, CDN, load balancer và monitoring. Phá hợp đồng nghĩa là mất hạ tầng miễn phí.

## Mental Model

```text
REQUEST                              RESPONSE
POST /tasks HTTP/1.1                 HTTP/1.1 201 Created
Host: api.example.com                Content-Type: application/json
Content-Type: application/json       Location: /tasks/42
Authorization: Bearer eyJ...         Cache-Control: no-store
Content-Length: 27
                                     {"id":42,"title":"Viết test"}
{"title":"Viết test"}
```

Bốn phần: **start line** (method + path + version), **header**, dòng trống, **body**.

Ba tính chất của method, và chúng quyết định mọi thứ khác:

| Method | Safe (không đổi state) | Idempotent (gọi N lần = 1 lần) | Cache được |
|---|---|---|---|
| `GET` | ✅ | ✅ | ✅ |
| `HEAD` | ✅ | ✅ | ✅ |
| `OPTIONS` | ✅ | ✅ | ❌ |
| `PUT` | ❌ | ✅ | ❌ |
| `DELETE` | ❌ | ✅ | ❌ |
| `PATCH` | ❌ | **❌** | ❌ |
| `POST` | ❌ | ❌ | ❌ (trừ khi khai báo tường minh) |

Ba tính chất này không phải lý thuyết. Chúng là **quy tắc mà hạ tầng thật dựa vào**:

- Browser và proxy tự retry `GET` khi kết nối lỗi — vì nó idempotent.
- Browser cảnh báo khi reload một trang từ `POST` — vì nó không idempotent.
- CDN cache `GET` mà không cache `POST`.
- Client library retry `GET`/`PUT` nhưng thường không retry `POST`.

Vì `PATCH` **không** idempotent theo chuẩn (một patch dạng "tăng 1" gọi hai lần cho kết quả khác), nếu bạn muốn `PATCH` an toàn để retry thì phải tự thiết kế nó như vậy.

## How It Works

### Status code — nhóm quyết định hành vi

```text
2xx  Thành công
     200 OK            có body
     201 Created       + Location header
     202 Accepted      đã nhận, xử lý sau (queue)
     204 No Content    thành công, KHÔNG có body (DELETE)

3xx  Chuyển hướng
     301 Moved Permanently   → cache vĩnh viễn, cẩn thận
     302/307 Temporary       → 307 giữ nguyên method, 302 có thể đổi POST→GET
     304 Not Modified        → dùng bản cache

4xx  LỖI CỦA CLIENT — retry vô ích
     400 Bad Request         payload sai cú pháp/type
     401 Unauthorized        chưa xác thực (thực ra là "unauthenticated")
     403 Forbidden           đã xác thực nhưng không có quyền
     404 Not Found           không tìm thấy (hoặc che giấu 403)
     409 Conflict            xung đột state (version, unique)
     422 Unprocessable       cú pháp đúng, nghiệp vụ sai
     429 Too Many Requests   + Retry-After

5xx  LỖI CỦA SERVER — retry CÓ THỂ có ích
     500 Internal Server Error
     502 Bad Gateway         proxy không nhận được response hợp lệ từ upstream
     503 Service Unavailable + Retry-After
     504 Gateway Timeout     upstream quá chậm
```

Phân biệt 4xx/5xx là phân biệt quan trọng nhất trong danh sách trên, vì nó quyết định **có nên retry không**. Trả 500 cho một payload sai làm client retry mãi một request không bao giờ thành công. Trả 400 cho một lỗi database làm client bỏ cuộc trong khi retry sẽ thành công.

`401` vs `403`: tên `401 Unauthorized` gây nhầm lẫn — nó nghĩa là *chưa xác thực* (thiếu/sai credential). `403` là *đã biết bạn là ai, nhưng không được phép*.

### Header quan trọng

```http
# Nội dung
Content-Type: application/json; charset=utf-8
Content-Length: 27
Content-Encoding: gzip

# Điều hướng cache
Cache-Control: no-store
ETag: "abc123"
Vary: Accept-Encoding, Authorization

# Xác thực
Authorization: Bearer <token>
Cookie: session=...

# Điều kiện (optimistic concurrency)
If-None-Match: "abc123"
If-Match: "abc123"           ← chống lost update

# Truy vết
X-Request-Id: 018f...
Traceparent: 00-<trace-id>-<span-id>-01
```

`If-Match` là công cụ ít dùng nhưng giải quyết đúng bài toán lost update ở tầng HTTP:

```text
Client A: GET /tasks/1  → ETag: "v1"
Client B: GET /tasks/1  → ETag: "v1"
Client A: PUT /tasks/1  If-Match: "v1" → 200, ETag mới "v2"
Client B: PUT /tasks/1  If-Match: "v1" → 412 Precondition Failed  ← ghi bị chặn
```

Đây là optimistic concurrency control, cùng nguyên lý với version column trong database. Xem [Transaction isolation](../../03-database/01-postgresql/01-transaction-isolation.md).

### HTTP/1.1 → 2 → 3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Kết nối | 6/domain, mỗi request xếp hàng | 1, multiplex nhiều stream | 1, trên QUIC/UDP |
| Head-of-line blocking | ở tầng HTTP | ở tầng TCP | không |
| Header | text | nén (HPACK) | nén (QPACK) |
| Hệ quả thực tế | gộp file có lợi | gộp file **bất lợi** (mất cache granularity) | tái kết nối nhanh |

Vì vậy các thực hành cũ như sprite ảnh và gộp mọi JS thành một file là **phản tác dụng** trên HTTP/2+.

## Example

```bash
# Xem toàn bộ request/response thật — công cụ debug HTTP quan trọng nhất
curl -v https://api.example.com/tasks

# Chỉ header response
curl -I https://api.example.com/tasks

# Đo thời gian từng chặng
curl -o /dev/null -s -w \
 'dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
 https://api.example.com/tasks

# POST với body và header
curl -X POST https://api.example.com/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer TOKEN' \
  -d '{"title":"Viết test"}' -i
```

`curl -v` bỏ qua browser hoàn toàn — nó là cách phân biệt "server sai" và "browser chặn" (CORS, cache, mixed content). Xem [CORS](../../01-web-frontend/00-web-foundations/06-cors.md).

## Prediction

1. `POST /getUser` — CDN có cache không? Client library có tự retry không?
2. Trả `200` với body `{ error: "not found" }` — monitoring theo error rate thấy gì?
3. `PATCH /tasks/1` với body `{ "increment": 1 }` gọi 2 lần vì retry — kết quả?
4. Trả `500` cho payload sai — client retry bao nhiêu lần?
5. `302` redirect một `POST` — request tiếp theo là method gì? Còn `307`?
6. `DELETE /tasks/1` gọi hai lần — lần hai trả gì? Có phải lỗi không?
7. Hai client cùng `PUT` với `If-Match: "v1"` — client thứ hai nhận gì?

<details>
<summary>Đáp án</summary>

1. Không cache; phần lớn client không retry `POST`.
2. Hệ thống trông khoẻ mạnh 100% — alert không bao giờ kích hoạt.
3. Tăng 2 — `PATCH` không idempotent nếu thiết kế như vậy.
4. Nhiều lần, vô ích — 5xx báo hiệu "thử lại có thể được".
5. `302` có thể đổi thành `GET` (nhiều client làm vậy); `307` giữ nguyên `POST`.
6. `204` hoặc `404` — cả hai hợp lệ; `DELETE` idempotent nên lần hai **không** phải lỗi hệ thống.
7. `412 Precondition Failed`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Trả 200 cho mọi lỗi, xem dashboard error rate | 0% lỗi trong khi người dùng gặp lỗi |
| Dùng `POST` cho việc đọc | Không cache; đo lại số request tới DB |
| Trả 500 cho validation error, bật retry ở client | Retry storm cho một request không bao giờ thành công |
| Bỏ `Content-Type` trên response JSON | Client parse sai hoặc browser tải file về |
| `301` cho một redirect tạm thời | Browser cache vĩnh viễn; rất khó hoàn tác |
| Bỏ `Retry-After` với 429/503 | Client retry ngay lập tức → làm tệ hơn |
| Đặt token vào query string | Nó vào access log của mọi proxy trên đường |
| Response 100MB không stream | Đo memory của server |
| Bỏ `Vary: Authorization` với response cache được | Cache trả dữ liệu người khác |

## What Usually Goes Wrong

- **Dùng 200 cho lỗi** → monitoring vô dụng, client phải parse body để biết thành công.
- **Nhầm 4xx/5xx** → retry sai hướng cả hai chiều.
- **`POST` cho đọc** → mất cache ở mọi lớp.
- **Không có `Retry-After`** với 429/503.
- **Thiếu `Vary`** trên response cache được → lộ dữ liệu giữa các user.
- **Token trong URL** → leak qua log, Referer, history.
- **Không giới hạn body size** → DoS đơn giản bằng một request lớn.
- **Trả stack trace trong response** → lộ đường dẫn, version, cấu trúc code.
- **`301` khi nên là `302`/`307`**.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Method chỉ là quy ước | Nó quyết định cache, retry, và hành vi của proxy |
| `PATCH` idempotent | Theo chuẩn thì không |
| `401` = không có quyền | `401` = chưa xác thực; `403` = không có quyền |
| Trả 200 cho lỗi tiện hơn cho client | Nó phá monitoring và mọi retry logic |
| HTTP/2 cần gộp file như HTTP/1.1 | Ngược lại — gộp làm mất cache granularity |
| `DELETE` hai lần là lỗi | `DELETE` idempotent; lần hai không phải lỗi hệ thống |
| Header không phân biệt hoa thường thì tên nào cũng được | Đúng về case, nhưng tên header chuẩn có ngữ nghĩa được hạ tầng đọc |

## Debugging

1. **`curl -v`** trước tiên. Nó cho bạn request và response thật, không qua browser. Nếu `curl` thành công mà browser thất bại → vấn đề ở browser (CORS, cache, CSP), không ở server.
2. **Đọc status code trước body.** Nó cho biết ai sai (client hay server) và có nên retry.
3. **`curl -w` với `time_*`** để biết thời gian ở chặng nào — DNS, TCP, TLS, hay server.
4. **502/504** → vấn đề ở **proxy ↔ upstream**, không ở client. Kiểm tra upstream còn sống, và timeout của proxy.
5. **So sánh header** giữa môi trường hoạt động và môi trường lỗi — thường khác một header.
6. **Log request/response ở proxy** (nginx access log) khi không rõ request có tới app hay không.
7. Với HTTP/2, dùng `curl --http2 -v` để thấy stream; DevTools cũng hiện Protocol trong Network tab.

## Production Considerations

- **Giới hạn body size** ở proxy và ở app.
- **Timeout ở mọi tầng** (client, proxy, app, DB) và tăng dần từ trong ra ngoài. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **`X-Request-Id`** sinh ở edge, truyền xuyên tầng, có trong mọi log. Xem [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
- **Compression** (gzip/brotli) cho response text.
- **`Retry-After`** cho 429 và 503.
- **Không bao giờ trả stack trace**; trả `code` + `requestId`.
- **Trust proxy** đúng cách để `X-Forwarded-For` không bị giả mạo (chỉ tin proxy của bạn).
- Metric theo status code group — 5xx rate là tín hiệu sức khoẻ hạng nhất.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tôn trọng ngữ nghĩa HTTP | cache, retry, proxy hoạt động đúng | phải học và tuân thủ |
| Tất cả là `POST` | đơn giản, không phải nghĩ | mất cache, mất retry an toàn |
| Status code chi tiết (409, 422) | client xử lý chính xác | client phải biết nhiều mã |
| Chỉ 200/400/500 | client đơn giản | mất thông tin để xử lý đúng |
| `If-Match` optimistic locking | chống lost update ở tầng HTTP | client phải giữ và gửi ETag |

## Explain Without Notes

1. Ba tính chất của method (safe, idempotent, cacheable) và mỗi cái ảnh hưởng hạ tầng nào?
2. Vì sao phân biệt 4xx/5xx là quan trọng nhất?
3. `401` khác `403` thế nào?
4. Vì sao trả 200 cho lỗi là quyết định tệ?
5. `If-Match` giải quyết vấn đề gì, và tương ứng với cơ chế nào trong database?

## Related

- [HTTP semantics & idempotency](03-http-semantics-idempotency.md) — chi tiết về idempotency
- [REST API contract](02-rest-api-contract.md) — thiết kế resource
- [Error model](05-error-model.md) — hình dạng body lỗi
- [URL → DNS → TCP → TLS](../../01-web-frontend/00-web-foundations/03-url-dns-tcp-tls.md) — tầng dưới
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — cache dựa trên header
- [Request lifecycle (NestJS)](../02-nestjs/01-request-lifecycle.md) — request đi đâu sau khi tới app
- [Rate limiting](07-rate-limiting.md) — 429 và `Retry-After`
