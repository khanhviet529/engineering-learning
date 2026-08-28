---
level: intermediate
area: cross-cutting
---

# Performance

Hai câu chi phối toàn bộ folder này:

> **Đo trước khi tối ưu.** Nếu một phần chiếm 5% tổng thời gian, tăng tốc nó vô hạn cho bạn tối đa 5%.
>
> **Tại mỗi thời điểm có đúng một nút thắt.** Tối ưu bất cứ thứ gì khác cho 0 cải thiện — và khi bạn sửa nó, nút thắt sẽ di chuyển.

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Latency, throughput & bottleneck](01-latency-throughput-bottleneck.md) | Tối ưu hàm từ 80ms xuống 12ms, vì sao p99 không đổi? |
| 2 | [Frontend performance](02-frontend-performance.md) | Lighthouse 96 mà LCP thật 4,2 giây? |
| 3 | [Backend performance](03-backend-performance.md) | Vì sao một tính năng gọi 2 lần/phút làm chậm mọi endpoint? |
| 4 | [Database performance](04-database-performance.md) | Vì sao cùng truy vấn chạy 8ms ở staging và 4 giây ở production? |
| 5 | [Profiling & load testing](05-profiling-load-testing.md) | Load test 2000 rps xanh, production sập ở 400 rps? |
| 6 | [Backpressure](06-backpressure.md) | Vì sao "không từ chối request nào" là cách hỏng tệ nhất? |

Note 1 là khung tư duy. Note 4 là nút thắt bạn sẽ gặp nhiều nhất. Note 6 là thứ quyết định hệ thống **hỏng như thế nào** khi vượt giới hạn — và đó là câu hỏi quan trọng hơn "giới hạn cao bao nhiêu".

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Tối ưu xong mà không nhanh hơn | tối ưu nhầm phần (Amdahl) | [1](01-latency-throughput-bottleneck.md) |
| p50 ổn, p99 nổ | tranh chấp, GC, hoặc hàng đợi | [1](01-latency-throughput-bottleneck.md), [3](03-backend-performance.md) |
| Tải tăng 10% mà độ trễ tăng gấp đôi | đã ở vùng bão hoà (>85%) | [1](01-latency-throughput-bottleneck.md) |
| Thêm instance không cải thiện | nút thắt là tài nguyên dùng chung | [1](01-latency-throughput-bottleneck.md), [4](04-database-performance.md) |
| Điểm Lighthouse cao, người dùng vẫn kêu chậm | lab ≠ field | [2](02-frontend-performance.md) |
| Trang trắng vài giây | JS quá lớn, tài nguyên chặn render | [2](02-frontend-performance.md) |
| Nội dung nhảy khi tải | thiếu `width`/`height`, font swap | [2](02-frontend-performance.md) |
| Bấm nút thì giật | INP kém — long task trên luồng chính | [2](02-frontend-performance.md) |
| Endpoint không chạm DB cũng chậm | chặn event loop | [3](03-backend-performance.md) |
| Đăng nhập chậm làm mọi thứ chậm | cạn thread pool libuv (bcrypt) | [3](03-backend-performance.md) |
| Độ trễ app cao, độ trễ DB thấp | chờ pool kết nối | [3](03-backend-performance.md), [4](04-database-performance.md) |
| Exit 137 không có stack trace | heap limit ≥ memory limit container | [3](03-backend-performance.md) |
| Nhiều span DB ngắn xếp liên tiếp | N+1 | [4](04-database-performance.md) |
| Truy vấn nhanh ở dev, chậm ở production | plan đổi theo kích thước/thống kê | [4](04-database-performance.md) |
| Phân trang trang sau chậm dần | `OFFSET` sâu | [4](04-database-performance.md) |
| Mọi truy vấn chậm dần theo tuần | bloat vì transaction dài | [4](04-database-performance.md) |
| Load test đẹp, production sập | dữ liệu/hình dạng tải không thật | [5](05-profiling-load-testing.md) |
| p99 báo cáo thấp hơn thực tế | coordinated omission | [5](05-profiling-load-testing.md) |
| Đột biến làm hệ thống sập và lâu phục hồi | hàng đợi không giới hạn | [6](06-backpressure.md) |
| Bộ nhớ tăng khi có tải, không giảm | buffer/hàng đợi trong process | [6](06-backpressure.md) |

## Mười quyết định mặc định

```text
Trước khi tối ưu
 1. Đo TỪNG GIAI ĐOẠN, không chỉ tổng. Amdahl quyết định thứ tự việc.
 2. Theo dõi p50/p95/p99, không theo dõi trung bình.
 3. Giữ mức sử dụng 60–70%. 30% "lãng phí" là thứ mua khả năng chịu đột biến.

Thứ tự tối ưu (rẻ → đắt)
 4. Xoá việc → làm ít hơn → song song → làm trước (cache) → làm sau (queue) → làm nhanh hơn.

Backend
 5. Việc nặng CPU ra khỏi request path; đo event loop lag và có alert.
 6. Pool theo λ × W; kiểm tra N pod × pool < max_connections.
 7. Heap limit ≈ 75% memory limit container.

Database
 8. Index tổ hợp: bằng → phạm vi → sắp xếp. Bật pg_stat_statements.
 9. Test hiệu năng trên dữ liệu có kích thước và phân bố gần production.

Giới hạn
10. Mọi hàng đợi có giới hạn (throughput × timeout); từ chối sớm, rẻ, và có ưu tiên.
```

## Ba con số nên thuộc lòng

```text
① ĐƯỜNG CONG HÀNG ĐỢI
   ρ = 0.5 → chờ 1×   ·   0.8 → 4×   ·   0.9 → 9×   ·   0.95 → 19×
   → giải thích vì sao hệ thống "đột nhiên" chậm khi tải tăng 10%

② KHUẾCH ĐẠI ĐUÔI
   20 lời gọi phụ trợ, mỗi cái p99 = 1% → 18% người dùng gặp ít nhất một cái chậm
   → p99 của thành phần là p82 của người dùng

③ BẬC ĐỘ LỚN
   bộ nhớ ~100ns · SSD ngẫu nhiên ~150μs · vòng khứ hồi nội bộ ~500μs
   · SSD tuần tự 1MB ~1ms · xuyên lục địa ~150ms
   → dùng để phát hiện phép đo vô lý trước khi đào sâu
```

## Quy trình

```text
① ĐỊNH LƯỢNG      chậm bao nhiêu, phân vị nào, từ khi nào, bao nhiêu % người dùng
② BASELINE         so với cùng giờ tuần trước
③ CHIA THEO TẦNG   người dùng → LB → app → DB; chênh lệch là nơi thời gian mất
④ ĐỌC TRACE        bậc thang = tuần tự · span lặp = N+1 · khoảng trống = chờ
⑤ PHÂN LOẠI        CPU · I/O · tranh chấp · hàng đợi · bộ nhớ · thuật toán
⑥ MỘT thay đổi, ĐO LẠI
⑦ NÚT THẮT DI CHUYỂN → lặp lại, dừng khi ĐẠT MỤC TIÊU
```

Bước ⑦ đáng nhấn mạnh: dừng khi đạt mục tiêu, không dừng khi hết chỗ tối ưu. Luôn còn chỗ tối ưu.

## Kiểm tra nhanh trước khi phát hành tính năng

```text
□ Nó có làm việc nặng CPU trong request path không?
□ Có lời gọi độc lập nào đang chạy tuần tự không?
□ Nó thêm bao nhiêu truy vấn database? Có N+1 không?
□ Truy vấn mới có index phù hợp? Đã EXPLAIN trên dữ liệu cỡ production chưa?
□ Nó thêm bao nhiêu KB JavaScript?
□ Nếu tải gấp 5, nó từ chối lịch sự hay sập?
□ Có metric nào cho biết nó đang chậm không?
```

## Position

```text
Người dùng
   ↓  [2] frontend: LCP, INP, CLS
Mạng / CDN
   ↓  [1] độ trễ, đuôi phân bố, hàng đợi
App
   ↓  [3] event loop, pool, GC        [6] backpressure khi vượt giới hạn
Database / cache / queue
   ↓  [4] N+1, index, plan, lock
                                       [5] profiling & load testing đo mọi tầng
```

## Related

- [05-cross-cutting/](../README.md) — các concern xuyên tầng khác
- [Observability](../observability/README.md) — dữ liệu để đo
- [Reliability](../reliability/README.md) — hành vi khi vượt giới hạn
- [Concurrency](../concurrency/README.md) — tranh chấp và song song
- [03-database/](../../03-database/README.md) — tầng thường là nút thắt
- [Event loop](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — cơ chế nền của backend Node.js
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — quyết định ở tầng kiến trúc
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi đo và phá thử

## Version / Context

Ví dụ dùng Node.js 20+, NestJS 10/11, PostgreSQL 16, React 18/19, k6. Định luật Little (1961), định luật Amdahl (1967), xấp xỉ hàng đợi M/M/1. Core Web Vitals với INP là chỉ số chính thức từ tháng 3/2024. Mỗi note ghi rõ phiên bản và điều kiện ở phần cuối.
