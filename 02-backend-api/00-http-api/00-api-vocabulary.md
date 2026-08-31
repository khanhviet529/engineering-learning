---
level: beginner
area: backend
type: foundation
prerequisites:
  - ../../01-web-frontend/00-web-foundations/00-web-vocabulary.md
related:
  - 02-rest-api-contract.md
  - 05-error-model.md
  - 08-rpc-graphql-alternatives.md
---

# Từ vựng API: endpoint, status code, REST, DTO

## Note này trả lời gì

**Một HTTP API nói bằng ngôn ngữ gì** — API, endpoint, resource, mã trạng thái nào cho tình huống nào, REST nghĩa là gì, DTO và serialization là gì.

Đây là note **từ vựng**. Nó không dạy cách thiết kế contract, không dạy error model dùng ở production. Nó đảm bảo khi bạn đọc `05-error-model.md` và thấy "trả `409` chứ không phải `400`", bạn hiểu vì sao đó là hai thứ khác nhau.

> ~12 phút. Nếu bạn nói được ngay khác biệt giữa `401` và `403`, `400` và `422`, `404` và `409`, hãy bỏ qua và vào [02-rest-api-contract.md](./02-rest-api-contract.md).

Cần trước: [Từ vựng Web](../../01-web-frontend/00-web-foundations/00-web-vocabulary.md) — URL, header, method, request/response.

## Vị trí

```text
Frontend                            Backend
   │                                   │
   │  POST /v1/orders  { ... }         │
   ├──────────────────────────────────▶│  DTO → validate → service → DB
   │                                   │
   │  201 { id, status }               │
   ◀───────────────────────────────────┤  entity → serialize → JSON
   │                                   │

        └──── contract ────┘
        cái mà note này đặt tên cho
```

## Định nghĩa

### API, endpoint, resource

**API** (Application Programming Interface) là **giao diện để một chương trình gọi một chương trình khác**. Không nhất thiết liên quan tới web: `Array.prototype.map` là một API. Trong repo này, "API" hầu như luôn nghĩa là **HTTP API** — giao diện được gọi bằng HTTP request qua mạng.

**Endpoint** là một địa chỉ cụ thể mà API của bạn trả lời: một **method + path**.

```text
GET    /v1/orders          ← endpoint
POST   /v1/orders          ← endpoint KHÁC, dù cùng path
GET    /v1/orders/:id      ← endpoint khác nữa
```

Method là phần của định danh. `GET /orders` và `POST /orders` là hai endpoint riêng biệt, có thể có quyền, validation và response khác nhau hoàn toàn.

**Resource** là *thứ* mà endpoint nói về: order, user, invoice. Đây là danh từ trong hệ thống của bạn.

```text
Resource:  order
Endpoints: GET /orders · POST /orders · GET /orders/:id · PATCH /orders/:id
```

Quy ước gần như phổ quát: resource dùng **danh từ số nhiều** (`/orders`, không phải `/order` hay `/getOrder`). Động từ đã nằm ở method.

### Contract

**Contract** là lời hứa mà API đưa ra: gọi thế nào, nhận lại gì, lỗi trông ra sao.

```text
Contract của POST /v1/orders
├─ Nhận:    { productId: string, quantity: number (≥1) }
├─ Trả 201: { id, status, createdAt }
├─ Trả 400: body sai định dạng
├─ Trả 409: sản phẩm hết hàng
└─ Header:  Authorization bắt buộc
```

Contract quan trọng vì frontend viết code dựa trên nó. Đổi contract mà không đổi version là làm hỏng client của người khác — chủ đề của [06-api-versioning-evolution.md](./06-api-versioning-evolution.md).

### Status code — ý nghĩa từng mã

Năm lớp đã có ở [Từ vựng Web](../../01-web-frontend/00-web-foundations/00-web-vocabulary.md). Đây là **mã cụ thể và khi nào dùng**.

**2xx — thành công**

| Mã | Tên | Dùng khi | Body |
|---|---|---|---|
| `200` | OK | mặc định khi thành công có dữ liệu trả về | có |
| `201` | Created | vừa **tạo** tài nguyên mới | có (+ header `Location`) |
| `202` | Accepted | đã nhận, **chưa xử lý xong** (đẩy vào queue) | thường có id để tra |
| `204` | No Content | thành công và **không có gì để trả** (thường là `DELETE`) | **không** |

`202` là mã bị bỏ quên nhiều nhất và hữu dụng nhất khi bạn có background job: nó nói thật với client rằng việc chưa xong.

**3xx — chuyển hướng**

| Mã | Nghĩa | Lưu ý |
|---|---|---|
| `301` | Moved Permanently | **cacheable theo mặc định** — client được phép lưu lâu |
| `302` | Found (tạm thời) | mặc định **không** cacheable, nhưng có thể cache nếu header cho phép |
| `304` | Not Modified | "dữ liệu bạn đang cache còn đúng" — body trống |
| `307` / `308` | như 302 / 301 nhưng **giữ nguyên method** | `301`/`302` có thể bị client đổi `POST` thành `GET` |

Về caching redirect, cần nói cho đúng:

```text
❌ "301 cache mãi, 302 không cache"
✅ "301 là cacheable theo mặc định; 302 thì không.
    Nhưng caching THỰC TẾ do Cache-Control / Expires quyết định,
    và hành vi từng browser có khác nhau."
```

Cụ thể: bạn **có** thể giới hạn một `301` bằng `Cache-Control: max-age=60`, và **có** thể cho cache một `302` bằng header tường minh. Điều khiến `301` nguy hiểm không phải "cache mãi" mà là: nếu bạn không gửi `Cache-Control`, client được phép lưu nó rất lâu, và browser thường lưu rất lâu trong thực tế — nên đặt sai một lần thì user vẫn bị chuyển hướng sai kể cả sau khi bạn đã sửa server.

Nguyên tắc thực dụng: **khi chưa chắc chắn là vĩnh viễn, dùng `302`** (hoặc `307` nếu cần giữ method). Và nếu buộc phải dùng `301`, gửi kèm `Cache-Control` với `max-age` ngắn trong lúc còn đang thử nghiệm.

**4xx — bên gọi sai**

| Mã | Nghĩa chính xác | Ví dụ |
|---|---|---|
| `400` | Bad Request — request **không hợp lệ về hình dạng** | JSON hỏng, thiếu field bắt buộc, sai kiểu |
| `401` | tên trong spec là *Unauthorized*, nhưng nghĩa thực tế là **cần xác thực / xác thực thất bại** | thiếu token, token hết hạn, token sai |
| `403` | Forbidden — **biết bạn là ai, và bạn không được phép** | user thường gọi endpoint admin |
| `404` | Not Found — tài nguyên **không tồn tại** | `/orders/999` mà order 999 không có |
| `405` | Method Not Allowed | `DELETE /orders` khi chỉ hỗ trợ `GET`/`POST` |
| `409` | Conflict — hợp lệ, nhưng **xung đột với trạng thái hiện tại** | email đã tồn tại; huỷ đơn đã giao |
| `410` | Gone — từng có, đã bị xoá vĩnh viễn | |
| `413` | Payload Too Large | upload quá giới hạn |
| `415` | Unsupported Media Type | gửi XML khi chỉ nhận JSON |
| `422` | Unprocessable Entity — hình dạng đúng, **nghĩa sai** | `quantity: -5`, `endDate` trước `startDate` |
| `429` | Too Many Requests | vượt rate limit (kèm `Retry-After`) |

Lưu ý về tên `401`: nó **được đặt tên sai từ đầu trong lịch sử HTTP**. `401 Unauthorized` nói về *authentication*, còn `403 Forbidden` mới là *authorization*. Đây là cái bẫy tên gọi, không phải cái bẫy khái niệm — và nó là lý do rất nhiều người dùng lẫn hai mã này.

Bốn cặp phải phân biệt được, vì nhầm chúng làm client xử lý sai:

```text
401 vs 403     chưa biết anh là ai   vs   biết rồi, nhưng không được phép
               → client nên đăng nhập lại   → đăng nhập lại VÔ ÍCH

400 vs 422     JSON hỏng / sai kiểu  vs   đúng kiểu, sai nghiệp vụ
               → sửa code                  → sửa dữ liệu người dùng nhập

404 vs 403     không tồn tại         vs   tồn tại, anh không được xem
               → cẩn thận: 403 tiết lộ rằng tài nguyên CÓ TỒN TẠI

404 vs 409     không có gì để làm    vs   có, nhưng đang ở trạng thái không cho phép
               → không retry               → có thể retry sau khi state đổi
```

Ghi chú bảo mật ở cặp thứ ba: với tài nguyên riêng tư của người khác, nhiều hệ thống cố tình trả `404` thay vì `403` để không xác nhận sự tồn tại. Đó là lựa chọn có ý thức, không phải sai sót.

`400` vs `422` không có chuẩn tuyệt đối — có hệ thống dùng `400` cho cả hai. Điều bắt buộc là **nhất quán trong API của bạn** và tài liệu hoá rõ.

**5xx — bên nhận sai**

| Mã | Nghĩa | Ai gây ra |
|---|---|---|
| `500` | Internal Server Error — exception không lường trước | code của bạn |
| `502` | Bad Gateway — proxy gọi upstream và nhận rác/không nhận được | app chết, hoặc proxy sai cấu hình |
| `503` | Service Unavailable — tạm thời không phục vụ được | đang deploy, quá tải, chủ động từ chối |
| `504` | Gateway Timeout — upstream không trả lời kịp | app chậm hơn timeout của proxy |

`502`/`504` thường **không phải** app bạn trả về — chúng do reverse proxy sinh ra khi app không trả lời được. Nghĩa là log app của bạn có thể trống hoàn toàn trong lúc user nhận `502`. Biết điều này quyết định bạn tìm log ở đâu.

Quy ước vận hành mặc định trong repo này: **`4xx` không đánh thức người trực, `5xx` thì có.**

> Đây là **operational convention**, không phải quy tắc của HTTP. HTTP không nói gì về alerting.

Và nó có ngoại lệ hai chiều, đều thường gặp:

| Tình huống | Đúng ra nên |
|---|---|
| `401`/`403` **tăng vọt** đột ngột | alert — có thể là deploy làm hỏng auth, hoặc đang bị tấn công |
| `429` tăng vọt | alert — hoặc bị abuse, hoặc rate limit đặt sai làm chặn người dùng thật |
| `400` tăng vọt sau một lần deploy | alert — thường là client và server lệch contract |
| `503` trong lúc deploy có kế hoạch | **không** page — đây là kỳ vọng |
| `504` lẻ tẻ từ một upstream đã có retry | ghi nhận, không page ngay |

Cách phát biểu đúng: **phân loại `4xx`/`5xx` cho bạn biết *lỗi thuộc về ai*; còn *có page hay không* là quyết định dựa trên tỉ lệ, xu hướng và tác động tới người dùng.**

Điều vẫn đúng tuyệt đối: trả `500` cho dữ liệu người dùng nhập sai là **sai phân loại** — nó nói "lỗi của tôi" khi thực ra không phải, và nó làm mọi dashboard 5xx của bạn thành vô nghĩa trong một tuần.

### REST, RESTful, "REST API"

**REST** (Representational State Transfer) là một *kiểu kiến trúc* với vài ràng buộc: client–server, **stateless**, tài nguyên có định danh, dùng đúng semantics của HTTP method, response nói rõ được cache hay không.

**Điều nên biết thẳng:** phần lớn thứ được gọi là "REST API" trong công việc thật **không** thoả mãn đầy đủ các ràng buộc kiến trúc của REST — thường thiếu HATEOAS (response tự chứa link để client điều hướng), và đôi khi cả cache/uniform-interface.

```text
Cái mọi người GỌI LÀ "REST API" trong công việc:
    JSON qua HTTP + path theo danh từ tài nguyên
    + method mang ý nghĩa + status code dùng đúng lớp

Cái REST THẬT SỰ yêu cầu:
    thêm stateless, cacheability, uniform interface, layered system,
    và HATEOAS — phần gần như không ai làm
```

Dùng quy ước ở khối trên là **hoàn toàn ổn**, và đó là mặc định của repo này. Điều đáng biết chỉ là: **"REST API" trong hội thoại là tên gọi cho một quy ước, không phải một chuẩn có thể kiểm tra tự động.** Biết vậy để không tranh luận vô ích về việc một API có "REST thật" hay không — câu hỏi đáng hỏi là contract có nhất quán và tài liệu hoá được không.

Các lựa chọn khác — GraphQL, gRPC, tRPC — và khi nào chúng đáng đổi: [08-rpc-graphql-alternatives.md](./08-rpc-graphql-alternatives.md).

### Stateless — và vì sao nó là ràng buộc kiến trúc

**Stateless** = server **không giữ** thông tin về các request trước của client. Mỗi request phải tự đủ.

```text
❌ Stateful:   server nhớ "user 5 đang ở bước 2 của wizard" trong RAM
✅ Stateless:  mỗi request mang theo token; state ở database hoặc Redis
```

Đây không phải chuyện thẩm mỹ. Nó là điều kiện để **chạy nhiều instance**:

```text
        ┌──▶ App instance 1   (nhớ session của bạn)
LB ─────┤
        └──▶ App instance 2   (không biết bạn là ai)
```

State trong RAM của một instance nghĩa là request kế tiếp có thể rơi vào instance khác và mất state — biểu hiện ra ngoài là "user bị đăng xuất ngẫu nhiên". Đây là một trong sáu thứ chỉ lộ ra khi bạn tăng lên 2 replica: [05-platforms/](../../04-infrastructure/05-platforms/README.md).

### DTO, serialization, validation

Ba từ mô tả cùng một biên: **dữ liệu đi qua ranh giới giữa "ngoài" và "trong"**.

```text
JSON từ client ──▶ [ DTO + validate ] ──▶ object nội bộ ──▶ service ──▶ DB
                                                                          │
JSON cho client ◀── [ serialize ] ◀────── entity ◀────────────────────────┘
```

**DTO** (Data Transfer Object) là hình dạng dữ liệu **tại biên**. Nó cố tình khác với entity trong database.

```ts
// DTO — cái client được phép gửi
class CreateOrderDto {
  productId: string;
  quantity: number;
}

// Entity — cái database có
class Order {
  id; productId; quantity; userId; internalCost; status; createdAt;
}
```

Vì sao phải khác nhau, chứ không dùng thẳng entity: nếu client gửi được `{ status: 'paid', internalCost: 0 }` và bạn nhận nguyên xi, đó là lỗ hổng **mass assignment** — client tự đặt trạng thái đã thanh toán.

**Validation** là kiểm tra dữ liệu đến **trước khi** nó chạm vào logic:

| Tầng | Kiểm tra | Ví dụ |
|---|---|---|
| hình dạng | có field không, đúng kiểu không | `quantity` là number |
| ràng buộc | trong khoảng cho phép | `quantity ≥ 1` |
| nghiệp vụ | hợp lệ với trạng thái hệ thống | sản phẩm còn hàng |

Hai tầng đầu sai → `400`/`422`. Tầng ba sai → thường là `409`.

**Serialization** là biến object trong bộ nhớ thành chuỗi để gửi đi (thường là JSON) — và nó là **cái chặn cuối** trước khi dữ liệu ra khỏi hệ thống.

```ts
// Serialize sai = rò rỉ dữ liệu
res.json(user);   // ← gửi luôn passwordHash, internalNotes, deletedAt
```

Không có tầng serialize tường minh, mọi field bạn thêm vào database sau này sẽ **tự động** xuất hiện trong response API. Đó là cách rò rỉ dữ liệu xảy ra mà không ai viết dòng code nào để gây ra nó.

Ba từ hay lẫn: **serialize** (object → chuỗi), **encode** (đổi cách biểu diễn, ví dụ base64 — đảo được, không bảo mật), **encrypt** (mã hoá, cần khoá để đọc). Base64 **không** là bảo mật.

### Payload, envelope, pagination

| Từ | Nghĩa |
|---|---|
| **payload** | phần dữ liệu thật trong body |
| **envelope** | lớp bọc quanh payload: `{ data, meta, error }` |
| **pagination** | trả dữ liệu theo trang thay vì tất cả |
| **offset pagination** | `?page=2&limit=20` — đơn giản, lệch khi dữ liệu thay đổi |
| **cursor pagination** | `?after=<cursor>` — ổn định, không nhảy tới trang bất kỳ |

Có envelope hay không là lựa chọn phong cách; **nhất quán** thì không. Trade-off của hai kiểu pagination: [04-pagination-filtering-sorting.md](./04-pagination-filtering-sorting.md).

### Error response nên có gì

Trả `400` với body `"Bad Request"` là hợp lệ về HTTP và vô dụng trong thực tế. Client cần **phân biệt được các lỗi khác nhau bằng code**, không phải bằng cách so chuỗi tiếng Anh.

```json
{
  "error": {
    "code": "PRODUCT_OUT_OF_STOCK",
    "message": "Sản phẩm đã hết hàng",
    "requestId": "req_01HX3...",
    "details": [{ "field": "quantity", "issue": "max_available_is_3" }]
  }
}
```

| Field | Vì sao cần |
|---|---|
| `code` | **máy đọc được** — client `if (code === '...')`; message có thể đổi bất cứ lúc nào |
| `message` | người đọc |
| `requestId` | nối lỗi user thấy với log server — thứ biến "app lỗi" thành một dòng log tìm được |
| `details` | field nào sai, để form hiển thị đúng chỗ |

Thiết kế đầy đủ và các bẫy: [05-error-model.md](./05-error-model.md).

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| `401` và `403` gần như nhau | `401` = chưa biết anh là ai; `403` = biết rồi, không được phép | client cho đăng nhập lại vô ích, hoặc loop redirect |
| Lỗi validate thì trả `500` | `4xx` là lỗi bên gọi | alert 5xx nhiễu, không ai còn để ý |
| Dùng `200` kèm `{success:false}` | status code là phần contract mà proxy, CDN, monitoring đều đọc | lỗi không xuất hiện ở bất kỳ dashboard nào |
| `403` không tiết lộ gì | `403` xác nhận **tài nguyên tồn tại**; với dữ liệu riêng tư của người khác, `404` kín hơn | rò rỉ sự tồn tại của dữ liệu người khác |
| `301` cache mãi, `302` không cache | `301` cacheable theo mặc định, `302` thì không — nhưng `Cache-Control` mới quyết định thực tế | đặt `301` sai rồi tưởng không sửa được, hoặc tưởng `302` an toàn tuyệt đối |
| `4xx` không bao giờ cần alert, `5xx` luôn phải page | đây là quy ước vận hành, không phải quy tắc HTTP | bỏ qua spike `401`/`429`; bị page lúc 3h sáng vì `503` của deploy có kế hoạch |
| `POST` sau `301`/`302` vẫn là `POST` | có thể bị đổi thành `GET` — cần `307`/`308` | request mất body, lỗi khó hiểu |
| Dùng entity làm DTO cho tiện | client gửi được field nội bộ | mass assignment — client tự set `status: 'paid'` |
| `res.json(user)` là đủ | mọi field mới trong DB tự động lộ ra | rò rỉ `passwordHash` mà không ai viết code gây ra |
| base64 là mã hoá | chỉ là encode, đảo ngược trong 1 giây | tưởng đã bảo vệ dữ liệu |
| Message tiếng Anh đủ để client xử lý | client cần `code` máy đọc được | đổi câu chữ làm sập logic frontend |
| REST là chuẩn có thể kiểm tra | REST là kiểu kiến trúc; "REST API" thực tế là quy ước | tranh luận vô ích thay vì thống nhất contract |
| Stateless chỉ là lời khuyên | là điều kiện để scale nhiều instance | user bị đăng xuất ngẫu nhiên sau khi tăng replica |

## Kiểm tra bản thân

1. Token hết hạn → mã nào? User thường gọi endpoint admin → mã nào?
2. Body JSON hỏng → mã nào? `quantity: -5` → mã nào? Vì sao khác nhau?
3. Đăng ký với email đã tồn tại → mã nào, và vì sao không phải `400`?
4. Tạo xong tài nguyên → mã nào, và nên kèm header nào?
5. `DELETE /orders/5` thành công, không có gì trả về → mã nào?
6. `502` do app bạn trả về hay do ai? Log app có gì?
7. Vì sao không nên dùng entity của database làm DTO nhận input?
8. Vì sao error response cần `code` chứ không chỉ `message`?
9. App giữ session trong RAM. Bạn tăng từ 1 lên 2 instance. User thấy gì?
10. `301` khác `302` ở điểm nào có hậu quả thực tế?

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 01-http-request-response.md   ← một request đi qua backend thế nào
        ├──▶ 02-rest-api-contract.md       ← thiết kế contract, đặt tên resource
        ├──▶ 05-error-model.md             ← error model dùng được ở production
        ├──▶ 03-http-semantics-idempotency.md ← safe/idempotent, idempotency key
        └──▶ ../03-auth/                   ← 401/403 đến từ đâu
```

## Related

- [HTTP request → response](./01-http-request-response.md) — đường đi qua backend
- [REST API contract](./02-rest-api-contract.md) — thiết kế contract
- [HTTP semantics & idempotency](./03-http-semantics-idempotency.md) — safe, idempotent, cacheable
- [Pagination, filtering, sorting](./04-pagination-filtering-sorting.md) — offset vs cursor
- [Error model](./05-error-model.md) — `code`, `requestId`, phân loại lỗi
- [API versioning & evolution](./06-api-versioning-evolution.md) — đổi contract không phá client
- [Rate limiting](./07-rate-limiting.md) — `429` và `Retry-After`
- [RPC, GraphQL & alternatives](./08-rpc-graphql-alternatives.md) — khi nào không dùng REST
- [Authentication & authorization](../03-auth/01-authentication-authorization.md) — nguồn của `401` và `403`
- [Từ vựng Web](../../01-web-frontend/00-web-foundations/00-web-vocabulary.md) — URL, header, method
- [Chạy ở đâu](../../04-infrastructure/05-platforms/01-where-to-run.md) — vì sao stateless là điều kiện scale
- [Glossary](../../00-roadmap/glossary.md)
