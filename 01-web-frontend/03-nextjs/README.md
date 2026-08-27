# Next.js

Next.js như một **framework có ý kiến về nơi code chạy và khi nào dữ liệu được render**. Hai câu hỏi đó — *chạy ở đâu* và *render khi nào* — giải thích gần như mọi behavior và mọi lỗi.

**Baseline: Next.js 15, App Router.** Điều này quan trọng: behavior caching thay đổi đáng kể giữa Next 14 và 15 (Next 15 mặc định **không** cache `fetch`), và Pages Router có mô hình khác hoàn toàn. Khi tra tài liệu, kiểm tra version.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Server/Client boundary](01-server-client-boundary.md) | Dòng code này chạy ở đâu, và làm sao tôi biết? |
| 2 | [Routing, layout & file conventions](02-routing-layout-rendering.md) | Mỗi tên file đặc biệt làm gì? |
| 3 | [Rendering strategies](04-rendering-strategies.md) | Trang render lúc build, lúc request, hay ở client? |
| 4 | [Data fetching & cache](03-data-fetching-cache.md) | Vì sao sửa DB mà trang vẫn cũ? |
| 5 | [Route Handlers & Server Actions](05-route-handlers-server-actions.md) | Client gọi server bằng cách nào? |
| 6 | [Middleware & auth patterns](06-middleware-auth-patterns.md) | Authorization thật nên ở đâu? |
| 7 | [Metadata, images & assets](07-metadata-images-assets.md) | Vì sao LCP xấu và card chia sẻ trống? |
| 8 | [Deployment & production](08-deployment-production.md) | Điều gì đổi khi có 3 instance sau một proxy? |

Note 1 và 4 là hai note quan trọng nhất. Note 6 là note có rủi ro bảo mật cao nhất nếu bỏ qua.

## Ba câu hỏi định hướng

1. **Code này chạy ở đâu?** Server Component (mặc định) hay Client Component? → [1](01-server-client-boundary.md)
2. **Dữ liệu này render khi nào, và cũ được bao lâu?** → [3](04-rendering-strategies.md), [4](03-data-fetching-cache.md)
3. **Ai được phép thấy dữ liệu này, và kiểm tra ở tầng nào?** → [6](06-middleware-auth-patterns.md)

## Sáu hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| `'use client'` = chỉ chạy trên client | Vẫn render trên server một lần để sinh HTML | [1](01-server-client-boundary.md) |
| Middleware bảo vệ app | Nó redirect; authorization phải ở tầng dữ liệu | [6](06-middleware-auth-patterns.md) |
| Server Action là hàm nội bộ an toàn | Là POST endpoint công khai; cần auth + validation | [5](05-route-handlers-server-actions.md) |
| Chỉ có một cache | Năm lớp, mỗi lớp vô hiệu khác nhau | [4](03-data-fetching-cache.md) |
| `loading.tsx` là "trang loading" | Là `Suspense` fallback — chỉ hiện khi có suspend | [2](02-routing-layout-rendering.md) |
| Env var luôn đọc lúc chạy | `NEXT_PUBLIC_*` bị nhúng lúc build | [8](08-deployment-production.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| `useState is not defined` | thiếu `'use client'` → [1](01-server-client-boundary.md) |
| `window is not defined` | code chạy trên server → [1](01-server-client-boundary.md) |
| Hydration mismatch | thời gian/random/`localStorage` trong render → [1](01-server-client-boundary.md) |
| Sửa DB mà trang vẫn cũ | lớp cache nào? → [4](03-data-fetching-cache.md) |
| TTFB cao | `await` tuần tự, thiếu `Suspense` → [3](04-rendering-strategies.md) |
| Route đáng lẽ static lại thành dynamic | `cookies()`/`searchParams` trong cây → [3](04-rendering-strategies.md) |
| User A thấy dữ liệu user B | cache dùng chung, hoặc thiếu authz → [4](03-data-fetching-cache.md), [6](06-middleware-auth-patterns.md) |
| `loading.tsx` không hiện | page không suspend → [2](02-routing-layout-rendering.md) |
| Container không nhận kết nối | thiếu `HOSTNAME=0.0.0.0` → [8](08-deployment-production.md) |
| Streaming không hoạt động ở production | proxy buffering → [8](08-deployment-production.md) |
| LCP xấu | ảnh thiếu `priority`/`sizes` → [7](07-metadata-images-assets.md) |

## Position

```text
Browser → Next.js (Server Component | Client Component) → HTTP → Backend → DB
              ↑ folder này: ranh giới, render, cache, auth, deploy
```

## Related

- [02-react/](../02-react/README.md) — mô hình React bên dưới
- [00-web-foundations/](../00-web-foundations/README.md) — HTTP cache, cookie, CORS, hydration
- [02-backend-api/](../../02-backend-api/README.md) — phía backend nếu bạn có API riêng
- [04-infrastructure/02-docker/](../../04-infrastructure/02-docker/README.md) — container hoá
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz đúng cách
