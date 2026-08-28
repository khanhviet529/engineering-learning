---
level: intermediate
area: cross-cutting
related:
  - 05-profiling-load-testing.md
  - ../observability/04-metrics-slo.md
---

# Latency, throughput & bottleneck

> Một team tối ưu hàm tính giá từ 80ms xuống 12ms sau hai tuần. Độ trễ p99 của endpoint không đổi: vẫn 2,4 giây. Toàn bộ thời gian nằm ở 100 truy vấn database mà không ai đo. **Họ đã tối ưu 3% của vấn đề, rất giỏi.**

## Position

```text
MODEL → PREDICT → BUILD → MEASURE → OPTIMIZE
                            ↑
        không đo trước thì mọi tối ưu là phỏng đoán
```

## Problem

```text
Ba đại lượng bị nhầm lẫn với nhau, và chúng KHÔNG cùng chiều:

  LATENCY     một việc mất bao lâu          (giây)
  THROUGHPUT  bao nhiêu việc mỗi đơn vị     (việc/giây)
  UTILIZATION mức bận của tài nguyên        (%)

Tối ưu một cái thường làm xấu cái khác:
  · batch tăng throughput, TĂNG latency
  · thêm worker tăng throughput, tăng tranh chấp
  · chạy tài nguyên ở 95% tối đa hoá sử dụng, LÀM NỔ latency
```

## Mental Model

### Latency và throughput không đổi cho nhau

```text
Latency thấp, throughput thấp     một luồng, mỗi việc nhanh
Latency cao, throughput cao        batch lớn
Latency thấp, throughput cao       song song hoá tốt — mục tiêu
Latency cao, throughput thấp       có nút thắt
```

```text
Định luật Little:  L = λ × W
  L = số việc TRONG hệ thống
  λ = tốc độ đến (throughput)
  W = thời gian mỗi việc ở trong hệ thống (latency)

Hệ quả dùng được ngay:
  100 rps × 200ms = 20 request đồng thời ⇒ pool 10 kết nối là KHÔNG ĐỦ
```

Đây là phép tính đáng làm trước khi cấu hình bất kỳ pool, thread, hay số worker nào.

### Hàng đợi: vì sao 90% tải làm p99 nổ

```text
Khi tài nguyên tiến tới bão hoà, thời gian CHỜ tăng phi tuyến:

  thời gian chờ ≈ thời gian phục vụ × ρ / (1 − ρ)        ρ = mức sử dụng

  ρ = 0.5  →  chờ = 1×  thời gian phục vụ
  ρ = 0.8  →  chờ = 4×
  ρ = 0.9  →  chờ = 9×
  ρ = 0.95 →  chờ = 19×
  ρ = 0.99 →  chờ = 99×
```

```text
⇒ "CPU 90% là dùng tài nguyên hiệu quả" là hiểu sai nguy hiểm.
  Ở 90%, một đợt tăng nhỏ đẩy hệ thống sang vùng phi tuyến.
⇒ Giữ mức sử dụng ở 60–70% cho hệ thống nhạy độ trễ.
  30% "lãng phí" là thứ mua lấy khả năng chịu đột biến.
```

Con số này cũng giải thích một hiện tượng quen thuộc: hệ thống chạy tốt suốt nhiều tháng rồi "đột nhiên" chậm khi lưu lượng tăng 10%. Nó không đột nhiên — nó vừa đi qua khúc gấp của đường cong.

### Đuôi phân bố quan trọng hơn trung bình

```text
1000 request: 990 cái 50ms, 10 cái 5000ms
  trung bình 99.5ms   ← trông ổn
  p99        5000ms   ← 10 người đang chờ 5 giây
```

```text
Và với hệ thống nhiều thành phần, đuôi KHUẾCH ĐẠI:

  một trang gọi 20 dịch vụ phụ trợ, mỗi cái p99 = 1%
  → xác suất gặp ÍT NHẤT MỘT lời gọi p99 = 1 − 0.99²⁰ ≈ 18%

  ⇒ p99 của thành phần trở thành p82 của người dùng
  ⇒ trong kiến trúc phân tán, đuôi là vấn đề TRUNG TÂM, không phải ngoại lệ
```

### Định luật Amdahl: giới hạn của mọi tối ưu

```text
Nếu một phần chiếm p% tổng thời gian, tăng tốc nó vô hạn
chỉ cho tối đa:   1 / (1 − p)

  phần đó chiếm 5%  → tối đa nhanh hơn 1,05 lần   ← sự cố ở đầu note
  phần đó chiếm 50% → tối đa nhanh hơn 2 lần
  phần đó chiếm 90% → tối đa nhanh hơn 10 lần

⇒ ĐO TRƯỚC. Câu hỏi đúng không phải "cái này có chậm không"
  mà là "cái này chiếm bao nhiêu phần trăm tổng thời gian".
```

### Nút thắt: luôn có đúng một

```text
Tại mỗi thời điểm, hệ thống bị giới hạn bởi MỘT tài nguyên.
Tối ưu bất cứ thứ gì khác = 0 cải thiện.

Sáu ứng viên, theo thứ tự phổ biến trong ứng dụng web:
  ① I/O CHỜ        database, API ngoài, đĩa
  ② TRANH CHẤP     lock, pool cạn, hàng đợi
  ③ CPU            tính toán, serialize, nén, mã hoá
  ④ BỘ NHỚ         GC, swap, cache miss
  ⑤ MẠNG           băng thông, số vòng khứ hồi
  ⑥ THUẬT TOÁN     độ phức tạp, N+1
```

```text
Và một tính chất quan trọng: sửa nút thắt thì nút thắt DI CHUYỂN.
  → tối ưu là chu trình lặp: đo → sửa nút thắt → đo lại
  → dừng khi đạt mục tiêu, không dừng khi "hết chỗ tối ưu"
```

### Nhận diện nút thắt bằng dấu hiệu

```text
CPU cao, độ trễ tỉ lệ với tải          → CPU-bound
CPU THẤP, độ trễ cao                    → I/O-bound hoặc đang chờ
throughput ĐỨNG YÊN khi thêm tải        → đã bão hoà ở đâu đó
độ trễ tăng nhưng throughput không tăng → hàng đợi đang dài ra
thêm instance KHÔNG cải thiện           → nút thắt DÙNG CHUNG (database, lock, cache)
p50 ổn, p99 nổ                          → tranh chấp, GC, hoặc hàng đợi
độ trễ tăng đều theo thời gian chạy     → rò rỉ tài nguyên
```

Dòng "thêm instance không cải thiện" là dấu hiệu chẩn đoán mạnh nhất: nó thu hẹp ngay xuống nhóm tài nguyên dùng chung.

### Đo ở đâu: mỗi tầng cho một câu trả lời khác

```text
Người dùng    thời gian tới khi TRANG DÙNG ĐƯỢC        ← con số duy nhất thật sự quan trọng
Trình duyệt   Core Web Vitals, thời gian JS
Mạng          DNS + TCP + TLS + truyền
Load balancer thời gian tới upstream, thời gian hàng đợi
Ứng dụng      thời gian xử lý, thời gian chờ I/O
Database      thời gian query, thời gian chờ lock

Chênh lệch GIỮA hai tầng liền kề chính là chỗ thời gian biến mất.
```

Sự cố ở đầu note là chênh lệch giữa "ứng dụng" và "database" không được đo.

### Con số nên thuộc lòng

```text
Tham chiếu bộ nhớ                    ~1 ns
Cache L2                             ~7 ns
Mutex lock/unlock                    ~25 ns
Bộ nhớ chính                         ~100 ns
Nén 1 KB                             ~2 μs
Gửi 1 KB qua mạng 1 Gbps             ~10 μs
Đọc 4 KB ngẫu nhiên từ SSD           ~150 μs
Đọc 1 MB tuần tự từ bộ nhớ           ~250 μs
Vòng khứ hồi trong cùng datacenter   ~500 μs
Đọc 1 MB tuần tự từ SSD              ~1 ms
Đĩa quay: seek                       ~10 ms
Vòng khứ hồi xuyên lục địa           ~150 ms
```

Giá trị của bảng này không phải con số chính xác mà là **bậc độ lớn**: nó cho phép bạn ước lượng trước khi đo, và phát hiện ngay khi một phép đo vô lý.

```text
Ví dụ dùng: "query này mất 200ms cho 100 dòng"
  → 2ms mỗi dòng
  → so với đọc bộ nhớ (~ns) và SSD (~μs): CHẬM HƠN HÀNG NGHÌN LẦN
  → không phải chi phí đọc dữ liệu; là seq scan, thiếu index, hoặc N+1
```

### Tối ưu theo thứ tự chi phí

```text
① XOÁ VIỆC          không làm là nhanh nhất
                    lời gọi thừa · dữ liệu không dùng · tính lại thứ đã có
② LÀM ÍT HƠN        phân trang · chọn cột cần thiết · lazy load
③ LÀM SONG SONG     Promise.all thay vì tuần tự
④ LÀM TRƯỚC         cache, precompute, materialized view
⑤ LÀM SAU           đẩy sang hàng đợi, trả về ngay
⑥ LÀM NHANH HƠN     thuật toán, index, ngôn ngữ  ← đắt nhất, làm cuối
```

Đa số đội ngũ bắt đầu ở ⑥. Bốn bước đầu thường cho cải thiện lớn hơn với công sức ít hơn nhiều.

## Example

Đo trước khi tối ưu — chia nhỏ thời gian của một endpoint:

```ts
// đo TỪNG GIAI ĐOẠN, không chỉ tổng
@Get('dashboard')
async dashboard(@CurrentUser() user: User) {
  const t = createTimer();

  const orders = await this.orders.recent(user.tenantId);      t.mark('orders');
  const stats = await this.analytics.summary(user.tenantId);   t.mark('stats');
  const alerts = await this.alerts.active(user.tenantId);      t.mark('alerts');
  const html = this.render({ orders, stats, alerts });         t.mark('render');

  this.logger.info({ ...t.marks(), total: t.total() }, 'dashboard timing');
  return html;
}
```

```text
{ orders: 45, stats: 1870, alerts: 30, render: 12, total: 1957 }
                    ↑ 96% thời gian ở đây

Amdahl: tối ưu `render` từ 12ms xuống 0 → tiết kiệm 0,6%.
        tối ưu `stats` xuống 100ms      → tiết kiệm 90%.
```

Sau khi biết nút thắt, ba bước theo thứ tự chi phí:

```ts
// ① SONG SONG — ba lời gọi độc lập, không cần tuần tự
const [orders, stats, alerts] = await Promise.all([
  this.orders.recent(user.tenantId),
  this.analytics.summary(user.tenantId),
  this.alerts.active(user.tenantId),
]);
// 1957ms → 1870ms  (chỉ bằng phần chậm nhất)
```

```ts
// ② LÀM TRƯỚC — stats thay đổi mỗi giờ, không cần tính lại mỗi request
const stats = await this.cache.getOrSet(
  `stats:${user.tenantId}:${hourBucket()}`,
  3600,
  () => this.analytics.summary(user.tenantId),
);
// 1870ms → 45ms khi trúng cache
```

```ts
// ③ LÀM NHANH HƠN — chỉ khi vẫn chưa đủ, và chỉ sau khi đã đo lại
// EXPLAIN ANALYZE cho thấy seq scan trên bảng 40 triệu dòng
// → index trên (tenant_id, created_at) → 1870ms → 60ms cho lần miss
```

Chú ý: bước ① không cần biết gì về `analytics.summary` và đã loại bỏ 87ms. Bước ② không cần sửa query nào. Chỉ đến bước ③ mới phải hiểu database — và lúc đó nó chỉ ảnh hưởng tới trường hợp cache miss.

## Prediction

1. Tối ưu một hàm chiếm 5% tổng thời gian xuống còn 0 — endpoint nhanh hơn bao nhiêu?
2. 100 rps, mỗi request 200ms — cần bao nhiêu kết nối đồng thời?
3. Pool 10 kết nối trong tình huống trên — chuyện gì xảy ra?
4. Mức sử dụng từ 50% lên 90% — thời gian chờ tăng bao nhiêu lần?
5. Từ 90% lên 95% — tăng thêm bao nhiêu?
6. 990 request 50ms, 10 request 5000ms — trung bình? p99?
7. Trang gọi 20 dịch vụ, mỗi cái p99 = 1% — bao nhiêu phần trăm người dùng gặp ít nhất một lời gọi chậm?
8. Thêm instance thứ hai, throughput không đổi — nút thắt ở đâu?
9. CPU 15%, độ trễ 2 giây — nút thắt loại nào?
10. Throughput đứng yên khi tăng tải, độ trễ tăng tuyến tính — điều gì đang xảy ra?
11. Query 200ms trả về 100 dòng — so với bậc độ lớn của SSD, nó thế nào?
12. Ba lời gọi độc lập 400ms chạy tuần tự — tổng? Chạy song song?
13. Sửa xong nút thắt số một — điều gì xảy ra tiếp theo?

<details>
<summary>Đáp án</summary>

1. **Tối đa 5%** — Amdahl.
2. `100 × 0,2 = 20` kết nối đồng thời.
3. Request **xếp hàng** chờ kết nối; độ trễ tăng, không phải vì database chậm.
4. Từ 1× lên **9×** — gấp 9 lần.
5. Lên **19×** — chỉ 5 điểm phần trăm mà hơn gấp đôi.
6. Trung bình **99,5ms**; p99 **5000ms**.
7. **≈18%.**
8. **Tài nguyên dùng chung**: database, lock, cache, hoặc mạng.
9. **I/O-bound** hoặc đang chờ — không phải CPU.
10. Đã **bão hoà**; hàng đợi đang dài ra.
11. **Chậm hơn hàng nghìn lần** so với chi phí đọc dữ liệu — nghi seq scan hoặc N+1.
12. Tuần tự **1200ms**; song song **400ms**.
13. Nút thắt **di chuyển** sang chỗ khác — đo lại.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đo từng giai đoạn của một endpoint chậm | Phần nào chiếm >50%? |
| Tăng tải dần và vẽ độ trễ theo mức sử dụng | Khúc gấp ở đâu? |
| So p50 và p99 | Chênh bao nhiêu lần? |
| Thêm một instance | Throughput có tăng không? |
| Giảm pool kết nối xuống một nửa | Độ trễ đổi thế nào? |
| Chuyển ba lời gọi tuần tự sang `Promise.all` | Tiết kiệm bao nhiêu? |
| Thêm độ trễ giả 100ms vào một dependency | p99 tổng đổi bao nhiêu? |
| Chạy tải liên tục 30 phút | Độ trễ có tăng dần không (rò rỉ)? |
| Tính `λ × W` rồi so với pool hiện tại | Có đủ không? |
| Đo chênh lệch giữa thời gian LB và thời gian app | Thời gian biến đi đâu? |

## What Usually Goes Wrong

- **Tối ưu mà không đo** → sửa 3% của vấn đề.
- **Đo trung bình** thay vì phân vị.
- **Chạy tài nguyên ở 90%+** rồi ngạc nhiên khi p99 nổ.
- **Pool nhỏ hơn `λ × W`** → xếp hàng ở tầng ứng dụng.
- **Lời gọi độc lập chạy tuần tự.**
- **N+1** ẩn sau ORM.
- **Không đo chênh lệch giữa các tầng** → không biết thời gian biến mất ở đâu.
- **Tối ưu nút thắt cũ** sau khi nó đã di chuyển.
- **Thêm instance** khi nút thắt là tài nguyên dùng chung.
- **Bỏ qua đuôi phân bố** trong hệ thống nhiều thành phần.
- **Bắt đầu ở bước ⑥** (làm nhanh hơn) thay vì ① (xoá việc).
- **Tối ưu sớm** trước khi có dữ liệu tải thật.
- **Không có baseline** → không biết thay đổi có tác dụng không.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Latency và throughput đi cùng chiều | Chúng thường đối nghịch |
| CPU 90% là hiệu quả | Ở đó thời gian chờ gấp 9 lần |
| Trung bình đủ để theo dõi | Nó che giấu đúng phần người dùng đau |
| p99 chỉ ảnh hưởng 1% người dùng | Với 20 lời gọi, nó ảnh hưởng ~18% |
| Thêm server luôn giúp | Không, nếu nút thắt là tài nguyên dùng chung |
| Code nhanh hơn = hệ thống nhanh hơn | Amdahl giới hạn phần bạn không đo |
| Cache luôn cải thiện | Cache miss + chi phí quản lý có thể tệ hơn |
| Song song luôn nhanh hơn | Tranh chấp có thể làm chậm hơn |
| Tối ưu là làm code chạy nhanh hơn | Xoá việc thường hiệu quả hơn nhiều |
| Đo trên máy dev là đủ | Máy dev không có tải, không có mạng thật |

## Debugging

1. **Định lượng trước**: chậm bao nhiêu, ở phân vị nào, từ khi nào, ảnh hưởng bao nhiêu phần trăm?
2. **So với baseline** — cùng giờ tuần trước. Không có baseline thì không có bất thường.
3. **Chia theo tầng**: người dùng → LB → app → DB. Chênh lệch giữa hai tầng liền kề là nơi thời gian mất.
4. **Đọc trace** thay vì đoán: bậc thang = tuần tự; span lặp = N+1; khoảng trống = chờ.
5. **Phân loại nút thắt**: CPU cao hay thấp? Throughput có tăng theo tải không? Thêm instance có giúp không?
6. **Kiểm tra hàng đợi ẩn**: pool kết nối, thread pool của libuv, hàng đợi của LB, hàng đợi của queue.
7. **Ước lượng bằng bậc độ lớn** trước khi đào sâu — một phép đo lệch hàng nghìn lần so với kỳ vọng chỉ thẳng vào nguyên nhân.
8. **Một thay đổi, đo lại.** Đổi nhiều thứ cùng lúc = không biết cái nào có tác dụng.

## Production Considerations

- **Đo trước khi tối ưu**, và đo **từng giai đoạn**, không chỉ tổng.
- **Theo dõi p50/p95/p99**, không theo dõi trung bình.
- **Giữ mức sử dụng 60–70%** cho hệ thống nhạy độ trễ.
- **Tính `λ × W`** khi cấu hình mọi pool, thread, worker.
- **Timeout ở mọi lời gọi**, xếp thứ tự từ ngoài vào trong.
- **`Promise.all` cho lời gọi độc lập** — kiểm tra bằng trace.
- **Đo ở nhiều tầng** để thấy chênh lệch.
- **Baseline và cảnh báo trên độ lệch**, không trên giá trị tuyệt đối.
- **Kiểm tra lại nút thắt sau mỗi lần sửa** — nó di chuyển.
- **Đặt ngân sách độ trễ** cho từng thành phần của một request, và theo dõi nó.
- **Load test với hình dạng tải thật**, không chỉ tải đều.
- **Ghi lại kết quả tối ưu**: đã đo gì, sửa gì, cải thiện bao nhiêu — nó ngăn việc lặp lại công sức.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tối ưu latency | phản hồi nhanh | thường giảm throughput tối đa |
| Tối ưu throughput | xử lý nhiều hơn | latency tăng (batch, hàng đợi) |
| Mức sử dụng cao | ít máy, rẻ | p99 nổ khi có đột biến |
| Mức sử dụng thấp | chịu được đột biến | tốn tài nguyên |
| Cache | nhanh khi trúng | dữ liệu cũ, phức tạp invalidation |
| Song song | nhanh hơn | tranh chấp, khó debug |
| Đẩy sang hàng đợi | phản hồi ngay | phức tạp, cần theo dõi độ trễ xử lý |
| Precompute | đọc rất nhanh | ghi chậm hơn, dữ liệu có thể cũ |
| Tối ưu sớm | tránh nợ | thường tối ưu nhầm chỗ |
| Tối ưu muộn | dựa trên dữ liệu thật | có thể phải sửa kiến trúc |

## Explain Without Notes

1. Latency, throughput, utilization khác nhau thế nào? Cho ví dụ tối ưu một cái làm xấu cái khác.
2. Định luật Little và một ứng dụng thực tế của nó.
3. Vì sao mức sử dụng 90% làm p99 nổ? Con số cụ thể?
4. Vì sao p99 của thành phần trở thành p82 của người dùng?
5. Định luật Amdahl và hệ quả với thứ tự làm việc.
6. Sáu ứng viên nút thắt và dấu hiệu nhận biết từng nhóm?
7. Sáu bước tối ưu theo thứ tự chi phí, và vì sao đa số bắt đầu sai chỗ?
8. Dùng bảng bậc độ lớn để đánh giá "query 200ms cho 100 dòng" thế nào?

## Related

- [Frontend performance](02-frontend-performance.md) — độ trễ người dùng cảm nhận
- [Backend performance](03-backend-performance.md) — event loop, pool, serialize
- [Database performance](04-database-performance.md) — nút thắt phổ biến nhất
- [Profiling & load testing](05-profiling-load-testing.md) — cách đo
- [Backpressure](06-backpressure.md) — khi tải vượt khả năng
- [Metrics & SLO](../observability/04-metrics-slo.md) — theo dõi phân vị
- [Correlation & tracing](../observability/03-correlation-tracing.md) — đọc trace để tìm nút thắt
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — `λ × W` trong thực tế
- [Capacity & limits](../reliability/04-capacity-and-limits.md) — lập kế hoạch dung lượng

## Version / Context

Định luật Little (John Little, 1961); định luật Amdahl (Gene Amdahl, 1967); công thức thời gian chờ theo lý thuyết hàng đợi M/M/1 (xấp xỉ, giả định đến ngẫu nhiên Poisson — hệ thống thực có đột biến nên thường **tệ hơn** con số này). Bảng bậc độ lớn theo "Latency Numbers Every Programmer Should Know" (Jeff Dean), cập nhật cho phần cứng SSD hiện nay. Ví dụ dùng Node.js 20+ và NestJS 10/11.
