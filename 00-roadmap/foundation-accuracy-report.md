---
level: meta
area: roadmap
---

# Foundation Accuracy Report

Review độ chính xác của lớp foundation vừa thêm. Không tạo taxonomy mới, không thêm topic, không restructure — chỉ **sửa câu**.

Nguyên tắc áp dụng:

```text
Simple
but
Not false
```

Cụ thể hơn: một beginner phải hiểu được ngay, **và** không phải học lại sau này.

## Files audited

| File | Số câu sửa |
|---|---|
| `04-infrastructure/01-networking/00-network-vocabulary.md` | 8 |
| `01-web-frontend/00-web-foundations/00-web-vocabulary.md` | 6 |
| `01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md` | 7 |
| `02-backend-api/00-http-api/00-api-vocabulary.md` | 5 |
| `00-roadmap/glossary.md` | 17 dòng sửa + 3 entry thêm (`container`, `thread`, `NoSQL`) |
| `01-web-frontend/00-web-foundations/05-cookies-storage.md` | 1 (đồng bộ canonical: cookie bỏ qua port) |
| `00-roadmap/02-roadmap.md` | 2 |
| `02-backend-api/00-http-api/01-http-request-response.md` | 1 |

Tổng: **8 file, ~50 statement**. Không file mới, không note mới.

## Statements corrected

### Network — vùng sai nhiều nhất

| Đã viết (sai/quá đơn giản) | Đã sửa thành |
|---|---|
| `127.0.0.1` là "chính process này, trong máy này" | địa chỉ của **loopback interface trong network namespace hiện tại**; mọi process cùng namespace đều dùng được |
| `0.0.0.0` = "mọi network interface trên máy này" | **wildcard address của IPv4**; IPv6 là `::` |
| Public IP = "mọi dải còn lại" | địa chỉ **định tuyến được công khai**; còn loopback, link-local, multicast, documentation, reserved |
| "Mọi note nói về HTTP, PostgreSQL, Redis, gRPC đều chạy trên TCP" | bảng theo protocol: HTTP/1.1 và HTTP/2 → TCP; **HTTP/3 → QUIC trên UDP**; gRPC mặc định → HTTP/2/TCP |
| UDP "dùng cho DNS query, video call, game" (ngụ ý DNS chỉ UDP) | DNS thường UDP, **chuyển sang TCP** khi response lớn/bị cắt; còn DoT/DoH |
| "socket là một file descriptor" (định nghĩa phổ quát) | trên Unix, process **thao tác socket qua** file descriptor; Windows dùng handle riêng |
| "HTTPS chính là HTTP bên trong kết nối TLS" + sơ đồ TCP→TLS→HTTP | giữ sơ đồ nhưng ghi rõ đó là HTTP/1.1 & HTTP/2; **HTTP/3 gộp TLS 1.3 vào handshake QUIC** |
| Sơ đồ Position bốn lớp DNS/TCP/TLS/HTTP không có phiên bản | thêm footnote: đây là đường đi của HTTP/1.1 & HTTP/2 |

### Web

| Đã viết | Đã sửa thành |
|---|---|
| **"Cookie, localStorage, quyền đọc response — tất cả đều tính theo origin"** | `localStorage`/`sessionStorage`/IndexedDB/CORS theo origin; **cookie theo domain + path và bỏ qua port**, lọc thêm bởi `SameSite`/`Secure`/`HttpOnly` |
| — (thiếu) | thêm hệ quả cụ thể: `localhost:3000` và `localhost:4000` khác origin nhưng **chia sẻ cookie** → "đăng nhập app này thì app kia đăng xuất" ở local |
| Ví dụ `POST /v1/orders HTTP/1.1` trình bày như hình dạng của HTTP nói chung | ghi rõ **đây là wire format HTTP/1.1**; HTTP/2 & HTTP/3 truyền nhị phân, header nén; cái giữ nguyên là **mô hình ngữ nghĩa** |
| Response wire format, không nói phiên bản | thêm ghi chú `:status` pseudo-header ở HTTP/2 & HTTP/3 |
| "domain = tên bạn mua và đăng ký" | giữ làm mental model cho người mới, thêm qualifier: trong DNS mọi tên đều là domain ở một cấp; ranh giới đăng ký phụ thuộc TLD |
| "HTTPS là HTTP chạy trong đường ống được TLS mã hoá" | HTTP **được truyền trong kênh đã được TLS mã hoá và xác thực** |

### JavaScript

| Đã viết | Đã sửa thành |
|---|---|
| Stack/heap trình bày như đảm bảo của ngôn ngữ | thêm khối cảnh báo: **ECMAScript không quy định** primitive ở stack / object ở heap; V8 có escape analysis, register, nhiều generation. Sơ đồ chỉ để hình dung **identity** và **lifetime** |
| — (thiếu) | nói thẳng phần *thật sự* là behavior ngôn ngữ: primitive có value semantics, object có reference/identity semantics |
| "object copy địa chỉ" (dễ đọc thành pass-by-reference) | **JS luôn pass/copy by value; với object, value đó *là* một reference** — kèm ví dụ `g(o){o={n:3}}` không đổi được biến ngoài |
| **"Promise đã chạy rồi. Tạo Promise là bắt đầu việc luôn"** | **Promise không phải task/thread đang chạy.** Bảng: `new Promise(executor)` gọi executor **đồng bộ ngay**; `fetch()` gửi request khi *`fetch` được gọi*; `await` **không** khởi động gì. Kèm ví dụ `new Promise(()=>{})` treo mãi |
| "JavaScript chạy code của bạn trên một luồng duy nhất" | **trong một luồng JS, code chạy tuần tự**; runtime có Web Worker / `worker_threads`, nhưng bộ nhớ tách biệt, giao tiếp qua message |
| — (thiếu) | thêm phân biệt **concurrency vs parallelism**: `async ⇒ concurrency`, `async ⇏ parallelism`; việc CPU cần `worker_threads` |
| "microtask luôn chạy trước macrotask" | **sau khi task hiện tại xong và call stack rỗng**, microtask queue được dọn sạch trước task kế tiếp — microtask **không** cắt ngang code đồng bộ. Thêm: cơ chế do runtime (HTML spec / libuv) định nghĩa, thứ tự macrotask **khác nhau giữa Node và browser** |

### API

| Đã viết | Đã sửa thành |
|---|---|
| "`301` browser cache rất lâu, có thể cache mãi / `302` không cache" | `301` **cacheable theo mặc định**, `302` thì không — nhưng **caching thực tế do `Cache-Control`/`Expires` và hành vi client quyết định**. Có thể giới hạn `301` bằng `max-age`, có thể cho cache `302` |
| **"`4xx` không đánh thức người trực, `5xx` thì có"** (nêu như nguyên tắc) | ghi rõ đây là **operational convention, không phải quy tắc HTTP**; kèm bảng ngoại lệ hai chiều: spike `401`/`403`/`429`/`400` **nên** alert; `503` trong deploy có kế hoạch và `504` lẻ tẻ **không** page |
| "`401` = chưa biết bạn là ai" | giữ wording cho người mới, thêm: tên spec là *Unauthorized* nhưng nghĩa thực tế là **cần xác thực / xác thực thất bại**; `403` mới là authorization |
| "`404` luôn an toàn hơn `403` → **đúng**" | đảo lại thành đúng chiều: `403` **xác nhận tài nguyên tồn tại**; với dữ liệu riêng tư của người khác thì `404` kín hơn — là **lựa chọn có ý thức**, không phải quy tắc |
| REST giản lược thành "JSON + HTTP + danh từ" | tách hai khối: cái mọi người **gọi là** "REST API", và cái REST **thật sự yêu cầu** (stateless, cacheability, uniform interface, layered system, HATEOAS). Dùng quy ước là ổn; chỉ cần biết nó không phải chuẩn kiểm tra được |

### Glossary (17 dòng)

Sửa các dòng có thể tạo mental model tuyệt đối, giữ độ dài một câu:

```text
cookie          → domain + path, KHÔNG tính port, lọc bởi SameSite/Secure
socket          → trên Unix thao tác qua file descriptor
DNS             → A/AAAA cho IP, và nhiều loại record khác
microtask       → dọn hết khi call stack rỗng, trước macrotask kế tiếp
macrotask       → runtime chỉ lấy task tiếp sau khi microtask queue dọn hết
Promise         → KHÔNG phải task/thread đang chạy
stack / heap    → mental model implementation, không phải quy định ECMAScript
value vs ref    → JS luôn copy value; với object, value LÀ một reference
JWT             → dạng phổ biến (JWS) có chữ ký nhưng KHÔNG mã hoá payload
async           → cho concurrency, KHÔNG phải parallelism
HTTP            → wire format khác nhau giữa 1.1 / 2 / 3
TCP             → HTTP/1.1 và HTTP/2 dùng nó; HTTP/3 thì không
UDP             → nền của QUIC/HTTP3 và của DNS query
authentication  → tên spec là Unauthorized, nhưng nghĩa là cần xác thực
```

Thêm 3 entry mà review chỉ ra là thiếu: `container`, `thread`, `NoSQL` (`NoSQL` kèm qualifier: **không** phải "không có schema").

## Oversimplifications fixed

Tính theo danh sách trong Definition of Done — **13/13 mental model sai đã được sửa**:

| Mental model sai | Trạng thái |
|---|---|
| cookie luôn theo origin | ✅ sửa ở `00-web-vocabulary.md` + `05-cookies-storage.md` + glossary |
| `127.0.0.1` là chính process | ✅ |
| `0.0.0.0` là mọi interface trong mọi trường hợp | ✅ |
| public IP là mọi IP không private | ✅ |
| HTTP luôn chạy TCP | ✅ sửa ở 4 chỗ (network vocab, glossary, roadmap, `01-http-request-response.md`) |
| DNS chỉ dùng UDP | ✅ |
| object luôn nằm heap theo spec JS | ✅ |
| primitive luôn nằm stack theo spec JS | ✅ |
| Promise là task đang chạy | ✅ |
| `301` luôn cache mãi | ✅ |
| `302` không cache | ✅ |
| `4xx` không bao giờ alert | ✅ |
| `5xx` luôn phải page | ✅ |

## Canonical definitions synchronized

Sửa xong thì scan các bản trùng để không tạo hai định nghĩa lệch nhau:

| Khái niệm | Canonical owner | Chỗ khác cần đồng bộ | Kết quả |
|---|---|---|---|
| cookie scope | `05-cookies-storage.md` | `00-web-vocabulary.md`, glossary | đồng bộ; canonical owner giờ nói rõ "không tính port" |
| HTTP transport | `00-network-vocabulary.md` | glossary, `02-roadmap.md`, `01-http-request-response.md` | 4 chỗ đã thêm qualifier phiên bản |
| socket | `00-network-vocabulary.md` | glossary, `05-ports-sockets.md` | đồng bộ |
| stack/heap | `00-js-vocabulary.md` | glossary | đồng bộ |
| Promise | `00-js-vocabulary.md` | glossary, `02-promise-concurrency.md` | đồng bộ |
| Redis đơn luồng | `00-redis-data-model.md` | — | **không cần sửa**: note đã tự qualify ("từ Redis 7 một số thao tác nền chạy trên luồng riêng, nhưng thực thi lệnh vẫn đơn luồng") |
| Node một thread | `01-runtime-concurrency.md` | `02-backend-api/01-nodejs/README.md` | **không cần sửa**: đã ghi "JS chạy một thread; libuv có pool cho một số việc I/O" |

## Kết quả spot-check các vùng khác

Quét React · Next.js · Node.js · NestJS · SQL/PostgreSQL · Redis · MongoDB · Docker · Kubernetes · Security · Observability · System Design, tìm mẫu `luôn luôn` / `chính là` / `chỉ` / `mọi` / `không bao giờ`.

**Kết quả: gần như không có lỗi.** Các absolute tìm thấy đều đúng hoặc đã tự qualify:

| Statement | Đánh giá |
|---|---|
| `WHERE x = NULL` → không bao giờ khớp dòng nào | ✅ đúng (logic ba giá trị của SQL) |
| `nextTick` đệ quy → event loop không bao giờ tiến sang phase tiếp | ✅ đúng |
| `:latest` + `IfNotPresent` → node không bao giờ lấy bản mới | ✅ đúng |
| "Container là process, không phải máy ảo" | ✅ đúng |
| "Thêm index luôn giúp" | ✅ đã nằm trong **bảng hiểu sai**, không phải khẳng định |
| "Node là multi-threaded" | ✅ đã nằm trong bảng hiểu sai, kèm giải thích libuv pool |

Nghĩa là: các note viết ở những phiên trước **đã có kỷ luật qualifier**. Sai sót tập trung ở 4 note từ vựng viết trong phiên gần nhất — đó là hệ quả trực tiếp của việc ưu tiên "dễ đọc" khi viết nhanh, và là lý do phiên review này cần thiết.

## No taxonomy changes · No new topic expansion

```text
File mới        : 1  (chỉ báo cáo này)
Note mới        : 0
Folder mới      : 0
Note bị xoá     : 0
Behavior note bị viết lại : 0  (chỉ chèn qualifier vào 2 dòng ở 2 file)
Thay đổi triết lý học : không
```

## Validation results

| Kiểm tra | Kết quả |
|---|---|
| Broken link | **11 — bằng baseline, không tăng** |
| Broken link còn lại | 10 × `07-projects/fullstack-lab/phases/` (labs chưa dựng) + 1 placeholder trong `templates/topic-note.md` |
| Frontmatter `prerequisites`/`related` không giải được | 0 |
| Note mồ côi | 0 |
| Code fence lệch | 0 |
| Stub < 1 KB | 0 |
| Glossary: dòng bảng sai số cột | 0 (kiểm tra bằng script — hai dòng bị lệch cột trong lúc sửa đã được phát hiện và vá) |
| Glossary: link tới canonical owner | tất cả giải được |

## Remaining deliberate simplifications

Những chỗ **cố tình** giữ đơn giản, đã ghi qualifier trong note nhưng không đào sâu. Ghi ra đây để lần sau không ai tưởng là sót:

| Đơn giản hoá còn lại | Vì sao giữ | Qualifier đã có |
|---|---|---|
| Sơ đồ stack/heap | hình dung identity + lifetime rất hiệu quả cho người mới | khối cảnh báo ở đầu mục, nói rõ không phải spec |
| Wire format HTTP/1.1 làm ví dụ chính | là dạng duy nhất đọc được bằng mắt; DevTools cũng hiển thị theo mô hình này | ghi rõ phiên bản, và nói cái gì giữ nguyên qua 1.1/2/3 |
| QUIC chỉ được *mention*, không có note riêng | chưa phải prerequisite của note nào trong repo | bảng protocol + một đoạn giải thích QUIC tự làm reliability |
| DoT/DoH chỉ mention một câu | không ảnh hưởng công việc app hằng ngày | nêu tên để không tưởng DNS luôn là plaintext/UDP |
| Không dạy đủ các dải IP reserved | không cần cho debug app | nói rõ "không phải private ⇒ public" là suy luận sai |
| "domain = tên bạn đăng ký" | mental model tiện và đúng trong ngữ cảnh web app | qualifier về DNS terminology nhiều cấp |
| `400` vs `422` trình bày như convention | thực tế không có chuẩn tuyệt đối | đã nói rõ "có hệ thống dùng `400` cho cả hai; điều bắt buộc là nhất quán" |
| Không giải thích IPv6 addressing | repo chưa có note nào cần nó | nêu `::` khi nói về bind wildcard |
| Không đi vào ECMAScript spec language | foundation không nên thành văn bản academic | dẫn tới điều spec **có** đảm bảo (value/reference semantics) |

## Related

- [Foundation gap audit](./foundation-gap-audit.md) — vì sao lớp foundation tồn tại
- [Foundation coverage report](./foundation-coverage-report.md) — lớp foundation gồm những gì
- [Glossary](./glossary.md) — index tra từ
- [Learning system](./00-learning-system.md)
