---
level: intermediate
area: backend
---

# Backend & API

Backend là nơi một request HTTP biến thành **một quyết định và một thay đổi bền vững**. Bốn folder ở đây theo đúng đường đi đó:

```text
Hợp đồng     00-http-api      cái gì đi vào, cái gì đi ra, ngữ nghĩa của nó
Runtime      01-nodejs        code của bạn chạy trên mô hình đồng thời nào
Framework    02-nestjs        chuỗi trạm giữa runtime và nghiệp vụ
Danh tính    03-auth          anh là ai, anh được làm gì
Kiến trúc    04-architecture  khi một thứ đổi, phải sửa ở đâu
```

## Bắt đầu ở đâu

| Bạn đang | Vào |
|---|---|
| Chưa rõ HTTP thật sự hoạt động thế nào | [00-http-api/](00-http-api/README.md) |
| Muốn hiểu vì sao Node "chậm" hoặc "treo" | [01-nodejs/](01-nodejs/README.md) |
| Đang viết feature trong NestJS | [02-nestjs/](02-nestjs/README.md) |
| Đang làm đăng nhập / phân quyền | [03-auth/](03-auth/README.md) |
| Codebase bắt đầu khó sửa | [04-architecture/](04-architecture/README.md) |

Thứ tự học mặc định: `00 → 01 → 02 → 04`, với `03` xen vào ngay sau khi bạn có endpoint đầu tiên cần bảo vệ.

## Đường đi của một request, và note tương ứng

```text
Client
  │
  ▼  HTTP: method, status, header, idempotency
[00-http-api]                     ── 01-http-request-response · 03-http-semantics-idempotency
  │
  ▼  Reverse proxy: TLS, timeout, giới hạn body
[04-infrastructure/01-networking] ── 05-reverse-proxy-load-balancer
  │
  ▼  Node: event loop, một thread JS
[01-nodejs]                       ── 01-node-runtime-concurrency
  │
  ▼  NestJS: middleware → guard → interceptor → pipe
[02-nestjs]                       ── 01-request-lifecycle · 04-guards-interceptors
  │
  ▼  Application: use case, transaction
[04-architecture]                 ── 01-controller-service-repository · 03-domain-logic-boundaries
  │
  ▼  Domain: quy tắc nghiệp vụ
  │
  ▼  Repository → Cache/Queue → PostgreSQL
[03-database]                     ── 01-transaction-isolation · 03-connection-pool
  │
  ▼  Response ← filter ← interceptor
[02-nestjs] + [04-architecture]   ── 03-validation-errors · 04-error-handling-strategy
```

Nếu bạn định vị được một bug trên sơ đồ này trước khi mở code, bạn đã tiết kiệm được phần lớn thời gian debug.

## Sáu câu hỏi trước khi coi một endpoint là xong

Không phải checklist hình thức — mỗi câu tương ứng một lớp sự cố production có thật:

1. **Ai được gọi nó, và ai **không** được?** Có test cho nhánh phủ định chưa? → [Guards & interceptors](02-nestjs/04-guards-interceptors.md)
2. **Input sai thì sao?** Field lạ có bị loại không? → [Validation & errors](02-nestjs/03-validation-errors.md)
3. **Nó có nguyên tử không?** Lỗi giữa chừng để lại gì? → [Database & transactions](02-nestjs/06-database-integration-transactions.md)
4. **Gọi hai lần thì sao?** → [HTTP semantics & idempotency](00-http-api/03-http-semantics-idempotency.md)
5. **Nó chậm thế nào với 1 triệu dòng?** Có N+1 không? → [Pagination](00-http-api/04-pagination-filtering-sorting.md)
6. **Lỗi lúc 3 giờ sáng thì tìm nguyên nhân bằng dữ liệu nào?** → [Error handling strategy](04-architecture/04-error-handling-strategy.md)

## Năm quyết định định hình cả codebase

Năm thứ này rẻ khi làm từ commit đầu, đắt khi thêm vào sau:

```text
1. ValidationPipe toàn cục với whitelist          → 02-nestjs/03
2. Guard toàn cục + @Public() opt-out             → 02-nestjs/04
3. Validate env, fail fast khi khởi động          → 04-architecture/05
4. Cây lỗi domain + MỘT filter dịch sang HTTP     → 04-architecture/04
5. requestId sinh ở biên, xuyên mọi log           → 04-architecture/04
```

Điểm chung: cả năm đều làm cho **hướng của lỗi khi con người quên** trở thành hướng an toàn.

## Position

```text
Browser → Next.js → HTTP → Reverse proxy → BACKEND → Cache/Queue → PostgreSQL
                                            ↑ folder này
```

## Related

- [01-web-frontend/03-nextjs/](../01-web-frontend/03-nextjs/README.md) — phía gọi API
- [03-database/](../03-database/README.md) — tầng dưới
- [04-infrastructure/](../04-infrastructure/README.md) — nơi backend này chạy
- [05-cross-cutting/](../05-cross-cutting/README.md) — security, testing, observability, reliability
- [06-system-design/](../06-system-design/README.md) — khi một backend thành nhiều
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi chạy experiment
