---
level: intermediate
area: cross-cutting
---

# Cross-Cutting Concerns

Những chủ đề **không thuộc một tầng nào** vì chúng xuất hiện ở mọi tầng.

Đây là lý do folder này tồn tại: nếu bạn đặt "security" vào folder backend, bạn sẽ quên rằng XSS xảy ra ở browser, SQL injection ở database, SSRF ở network và secret leak ở CI. Nếu bạn đặt "caching" vào folder Redis, bạn sẽ quên rằng có tới 4 lớp cache giữa người dùng và database.

## Vì sao "xuyên tầng" là một khái niệm quan trọng

Một request đi qua chuỗi này:

```text
Browser → Next.js → HTTP → Proxy → NestJS → Cache/Queue → PostgreSQL → OS → Container → Network
```

Một concern xuyên tầng là concern mà bạn phải quyết định **lại** ở mỗi trạm:

| Concern | Ở browser | Ở API | Ở database | Ở infra |
|---|---|---|---|---|
| Authentication | cookie/token gửi kèm | verify token | không (DB không biết user) | mTLS giữa service |
| Authorization | ẩn UI (không phải bảo vệ) | check quyền thật | RLS nếu cần | RBAC của K8s |
| Logging | error reporting | structured log per request | slow query log | container stdout |
| Timeout | fetch timeout | HTTP client timeout | statement timeout | probe timeout |
| Caching | HTTP cache | Next.js / Redis | shared buffer | CDN |
| Validation | UX feedback | validation thật | constraint | — |

Bảng này nói một điều: **quyết định ở một tầng không bảo vệ được tầng khác**. Ẩn nút "Delete" trên UI không phải authorization. Validation ở frontend không phải validation.

## Các vùng

| Vùng | Trả lời câu hỏi | Vào |
|---|---|---|
| **Security** | Kẻ tấn công có thể làm gì với hệ thống này? | [security/](security/README.md) |
| **Testing** | Làm sao biết nó đúng, và đúng lại sau khi sửa? | [testing/](testing/README.md) |
| **Observability** | Làm sao biết chuyện gì đang xảy ra trong production? | [observability/](observability/README.md) |
| **Performance** | Thời gian và tài nguyên đi đâu? | [performance/](performance/README.md) |
| **Reliability** | Khi một phần hỏng, phần còn lại thế nào? | [reliability/](reliability/README.md) |
| **Concurrency** | Nhiều thứ xảy ra cùng lúc thì sai ở đâu? | [concurrency/](concurrency/README.md) |

Ba concern xuyên tầng khác được đặt ở nơi chúng được implement, nhưng phải đọc với tư duy xuyên tầng:

| Concern | Ở đâu | Vì sao đặt ở đó |
|---|---|---|
| Authentication / Authorization | [02-backend-api/03-auth/](../02-backend-api/03-auth/README.md) | Backend là nơi duy nhất quyết định có hiệu lực |
| Caching | [03-database/02-redis/](../03-database/02-redis/README.md) + [Next.js cache](../01-web-frontend/03-nextjs/03-data-fetching-cache.md) + [browser cache](../01-web-frontend/00-web-foundations/02-http-browser-cache.md) | Mỗi lớp có cơ chế và failure mode riêng |
| Messaging | [03-database/04-message-queues/](../03-database/04-message-queues/README.md) | Queue là stateful infrastructure, cùng họ với DB |
| Configuration | [02-backend-api/04-architecture/05-configuration.md](../02-backend-api/04-architecture/05-configuration.md) | Bắt đầu từ app, lan ra Docker và K8s |
| Error handling | [02-backend-api/04-architecture/04-error-handling-strategy.md](../02-backend-api/04-architecture/04-error-handling-strategy.md) | Cần một chiến lược thống nhất, không phải try/catch rải rác |
| CI/CD | [04-infrastructure/03-cicd/](../04-infrastructure/03-cicd/README.md) | — |

## Thứ tự đọc gợi ý

Đọc cross-cutting **sau** khi đã có mental model của các tầng, không trước. Lý do: "SQL injection" không có nghĩa gì nếu bạn chưa biết query được ghép thế nào.

```text
Sau behavior 06 (backend lifecycle)
  → security/01-security-basics
  → testing/01-testing-pyramid-behavior
  → 03-auth/ (toàn bộ)

Sau behavior 09 (query performance)
  → performance/01-latency-throughput-bottleneck
  → performance/04-database-performance
  → concurrency/ (toàn bộ)

Sau behavior 11 (container/network)
  → observability/ (toàn bộ)
  → reliability/ (toàn bộ)
  → security/ (phần còn lại)
```

## Bốn câu hỏi để tự kiểm tra

Với bất kỳ feature nào bạn viết, cross-cutting đã đủ khi bạn trả lời được:

1. **Security** — nếu người dùng đổi ID trong URL thành ID của người khác thì sao?
2. **Observability** — nếu feature này lỗi trong production lúc 3 giờ sáng, bạn tìm nguyên nhân bằng dữ liệu nào?
3. **Reliability** — nếu dependency của nó (DB, Redis, service khác) chậm 10 giây thì sao?
4. **Concurrency** — nếu hai người dùng gọi nó cùng lúc trên cùng một dữ liệu thì sao?

Nếu một câu không trả lời được, feature chưa xong — dù test đã pass.

## Related

- [Knowledge Map](../00-roadmap/knowledge-map.md) — bản đồ theo tầng
- [Behavior Index](../00-roadmap/behavior-index.md) — bản đồ theo triệu chứng
- [System Design](../06-system-design/README.md) — nơi các concern này trở thành quyết định kiến trúc
