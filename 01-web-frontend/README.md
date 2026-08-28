# Web & Frontend

Web như một **runtime**: browser, network, JavaScript engine, React, Next.js. Học behavior trước API.

Thứ tự các folder ở đây không tuỳ ý — mỗi tầng là nền của tầng sau. Hydration mismatch là vấn đề của browser; stale closure là vấn đề của JavaScript; race condition là vấn đề của network. Nếu học React trước, bạn sẽ tìm nguyên nhân trong tài liệu React cho những vấn đề không thuộc React.

## Năm tầng

| # | Folder | Học gì |
|---|---|---|
| 1 | [00-web-foundations/](./00-web-foundations/README.md) | DNS, TCP, TLS, HTTP, cache, DOM, rendering pipeline, cookie, CORS, CSP, WebSocket |
| 2 | [01-javascript-typescript/](./01-javascript-typescript/README.md) | event loop, closure, promise, memory, module, type system |
| 3 | [02-react/](./02-react/README.md) | render/commit, reconciliation, effect, async state, form, performance, test |
| 4 | [03-nextjs/](./03-nextjs/README.md) | server/client boundary, rendering strategies, cache, action, auth, deploy |
| 5 | [04-application-engineering/](./04-application-engineering/README.md) | nhiều API trên một màn hình, cache layering, API chậm, 8 trạng thái UI |

Bốn tầng đầu là **công nghệ**; tầng 5 là **application** — nó nằm trên và dùng cả bốn. Đọc nó sau khi đã có React và Next.js, khi câu hỏi chuyển từ *"hook này làm gì"* sang *"màn hình 8 API thì tổ chức thế nào"*.

Tầng 5 chỉ chứa phần frontend của lớp kiến thức đó. Bức tranh đầy đủ (gồm cả backend, database, cross-cutting) ở [Application Engineering Map](../00-roadmap/application-engineering-map.md).

## Đường đi ngắn nhất nếu bạn đã biết React

Đọc 5 note này theo thứ tự — chúng là những chỗ mà kinh nghiệm React thường không đủ:

1. [Event loop & async](./01-javascript-typescript/async-concurrency/01-event-loop-async.md) — nền của mọi thứ async
2. [Execution context & closure](./01-javascript-typescript/fundamentals/01-execution-context-closure.md) — stale closure không phải bug của React
3. [TypeScript ↔ runtime boundary](./01-javascript-typescript/typescript/01-runtime-boundary.md) — type không kiểm tra response API
4. [Async race condition](./02-react/behavior/03-async-race-condition.md) — bug bạn không thấy trên localhost
5. [Server/Client boundary](./03-nextjs/behavior/01-server-client-boundary.md) — câu hỏi "code này chạy ở đâu"

## Position trong xương sống

```text
User → Browser → React/Next.js → HTTP → Backend → Cache → DB → Infra
         └──────── folder này ────────┘
```

Phía bên kia của mũi tên HTTP: [02-backend-api/](../02-backend-api/README.md).

## Ba behavior của roadmap thuộc folder này

- **Behavior 01** — [Browser biến một URL thành UI thế nào?](../00-roadmap/02-roadmap.md#behavior-01)
- **Behavior 02** — [State thay đổi khiến UI thay đổi thế nào?](../00-roadmap/02-roadmap.md#behavior-02)
- **Behavior 03** — [UI lấy dữ liệu async và xử lý race condition thế nào?](../00-roadmap/02-roadmap.md#behavior-03)
- **Behavior 04** — [Server và client chia việc render thế nào?](../00-roadmap/02-roadmap.md#behavior-04)

## Related

- [Behavior Index](../00-roadmap/behavior-index.md) — tra theo triệu chứng
- [Frontend performance](../05-cross-cutting/performance/02-frontend-performance.md)
- [Testing](../05-cross-cutting/testing/README.md)
- [Security](../05-cross-cutting/security/README.md) — XSS, CSRF, CSP đều chạm tầng này
