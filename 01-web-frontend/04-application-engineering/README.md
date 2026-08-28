# Frontend Application Engineering

Tầng nằm **trên** React và Next.js: khi bạn đã biết hook và routing, làm sao tổ chức một màn hình thật với nhiều nguồn dữ liệu, API chậm, và lỗi từng phần?

## Phạm vi — đọc kỹ phần này

Folder này chỉ chứa **frontend application-level orchestration**. Nó **không** phải toàn bộ "Real-world Application Engineering" của repo — lớp kiến thức đó nằm rải ở nhiều tầng và được tập hợp lại bằng một view:

> **[00-roadmap/application-engineering-map.md](../../00-roadmap/application-engineering-map.md)**

View đó nhóm note theo **problem thực tế** (data fetching, hệ thống chậm, data access, architecture, database choice, reliability) và trỏ sang cả backend, database và cross-cutting. Nếu bạn đang tìm "làm một application thật thế nào", bắt đầu từ view, không từ folder này.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Một màn hình nhiều API](01-multi-api-screen.md) | Dashboard 8 nguồn: cái nào song song, cái nào được phép fail? |
| 2 | [Data fetching architecture](02-data-fetching-architecture.md) | 5 loại state, 5 lớp cache — cái nào dùng khi nào? |
| 3 | [Slow API UX](03-slow-api-ux.md) | API 5 giây: tối ưu thật và tối ưu cảm nhận |
| 4 | [Frontend resilience](04-frontend-resilience.md) | 8 trạng thái UI mà người dùng thật gặp |

Đọc theo thứ tự — mỗi note dùng khái niệm của note trước.

## Bốn câu hỏi định hướng

1. **Cái nào phụ thuộc cái nào?** Vẽ dependency graph trước khi viết `await`. → [1](01-multi-api-screen.md)
2. **Cái nào được phép fail?** Phân loại critical / important / optional. Không phân loại nghĩa là mặc định "tất cả critical". → [1](01-multi-api-screen.md)
3. **State này thuộc loại nào?** Local / URL / server / global / derived. → [2](02-data-fetching-architecture.md)
4. **Người dùng thấy gì khi nó chậm hoặc lỗi?** 8 trạng thái, không phải 2. → [4](04-frontend-resilience.md)

## Sáu hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| `Promise.all` là cách gọi song song đúng | Với dữ liệu optional, dùng `allSettled` — `all` mất tất cả khi một cái fail | [1](01-multi-api-screen.md) |
| Nhiều API nghĩa là cần BFF | Chỉ khi round-trip × latency là nút thắt **đo được** | [1](01-multi-api-screen.md) |
| TanStack Query thay thế Redis | Hai lớp khác nhau: một giảm HTTP request, một giảm tải DB | [2](02-data-fetching-architecture.md) |
| Filter là local state | Gần như luôn thuộc **URL** — để share, back, refresh hoạt động | [2](02-data-fetching-architecture.md) |
| Thêm spinner là giải quyết API chậm | Actual không đổi; và spinner cho request 180ms làm UX **tệ hơn** | [3](03-slow-api-ux.md) |
| Loading + success là đủ | Người dùng gặp 8 trạng thái; thiếu `error` làm component crash | [4](04-frontend-resilience.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Waterfall dạng bậc thang trong Network tab | `await` tuần tự không cần thiết → [1](01-multi-api-screen.md) |
| Một widget lỗi làm mất cả trang | thiếu boundary theo vùng → [1](01-multi-api-screen.md) |
| Người dùng chờ cái chậm nhất | loading gộp → [1](01-multi-api-screen.md) |
| Dữ liệu sai sau khi đổi filter | thiếu biến trong `queryKey` → [2](02-data-fetching-architecture.md) |
| Refresh mất filter, không share được link | filter trong `useState` thay vì URL → [2](02-data-fetching-architecture.md) |
| Sửa DB mà UI vẫn cũ | 5 lớp cache — chẩn đoán từ ngoài vào → [2](02-data-fetching-architecture.md) |
| Nội dung nhấp nháy về skeleton | dùng `isFetching` thay vì `isPending` → [3](03-slow-api-ux.md) |
| Không biết 5 giây đi đâu | thiếu `Server-Timing` → [3](03-slow-api-ux.md) |
| `Cannot read properties of undefined` | thiếu xử lý trạng thái `error` → [4](04-frontend-resilience.md) |
| Spinner vô hạn | thiếu timeout → [4](04-frontend-resilience.md) |
| Người dùng tưởng dữ liệu bị mất | empty state không phân biệt với "filter không khớp" → [4](04-frontend-resilience.md) |

## Ba thói quen

1. **Throttle mạng khi phát triển.** DevTools → Network → "Slow 4G". Waterfall, N+1 và loading state sai chỉ lộ ra ở đó. Localhost với RTT 0,2ms che gần hết vấn đề.
2. **Block từng API URL** (DevTools → Network → Block request URL) và xem UI làm gì. Đây là bài test resilience rẻ nhất.
3. **Bật Offline 2 phút** và dùng app. Nó tìm ra nhiều lỗi hơn mọi bài test khác.

## Position

```text
Browser → [orchestration, cache, UI states] → HTTP → Backend/BFF → DB
               ↑ folder này
```

## Related

- **[Application Engineering Map](../../00-roadmap/application-engineering-map.md)** — view đầy đủ theo problem, xuyên FE/BE/DB
- [02-react/](../02-react/README.md) — render model, server state, error boundary
- [03-nextjs/](../03-nextjs/README.md) — RSC, streaming, 5 lớp cache
- [BFF & aggregation](../../02-backend-api/04-architecture/09-bff-and-aggregation.md) — phía backend của note 1
- [Full-stack triage](../../05-cross-cutting/performance/07-full-stack-triage.md) — quy trình tìm nút thắt từ browser xuống DB
- [Reliability](../../05-cross-cutting/reliability/README.md) — timeout, retry, degradation
- [Cache patterns](../../03-database/02-redis/03-cache-patterns.md) — lớp cache ở server
