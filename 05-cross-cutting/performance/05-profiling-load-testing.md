---
level: advanced
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - 03-backend-performance.md
  - 06-backpressure.md
---

# Profiling & load testing

> Trước ngày ra mắt, một team chạy load test: 2000 rps, p99 = 85ms, không lỗi. Ngày ra mắt thật, hệ thống sập ở 400 rps. Load test dùng **một** user id, **một** sản phẩm, và gửi tải **đều tăm tắp**. Production có 50.000 người dùng khác nhau (cache miss liên tục), dữ liệu phân bố lệch, và lưu lượng đến theo cụm. **Bài test đã đo một hệ thống không tồn tại.**

## Position

```text
PROFILING     "thời gian/bộ nhớ đi đâu TRONG một process"  → tìm nguyên nhân
LOAD TESTING  "hệ thống chịu được bao nhiêu"               → tìm giới hạn

Hai công cụ, hai câu hỏi. Dùng nhầm là lý do đo mà không rút ra được gì.
```

## Problem

```text
Không đo → tối ưu theo trực giác → sửa 3% của vấn đề (Amdahl)
Đo sai   → tệ hơn: bạn TIN vào một con số không phản ánh thực tế
```

Sự cố ở đầu note thuộc nhóm thứ hai, và nó nguy hiểm hơn: nó tạo ra sự tự tin sai chỗ.

## Mental Model

### Load test chỉ đúng khi ba thứ giống production

```text
① DỮ LIỆU     kích thước, phân bố, cardinality
   một user id → cache hit 100%; 50.000 user → cache miss thật
   bảng 1000 dòng → plan khác bảng 40 triệu dòng

② HÌNH DẠNG TẢI
   đều tăm tắp → không bao giờ chạm hàng đợi
   thực tế đến theo CỤM → đột biến làm bão hoà tạm thời

③ HỖN HỢP THAO TÁC
   100% đọc từ một endpoint ≠ 70% đọc / 20% ghi / 10% tìm kiếm
   tỉ lệ ghi quyết định tranh chấp lock và bloat
```

Điều kiện ① thường bị bỏ vì nó tốn công nhất — và nó cũng là điều kiện quan trọng nhất.

### Bốn loại load test, bốn mục đích

```text
SMOKE       tải rất nhỏ, xác nhận hệ thống hoạt động     → chạy trong CI
LOAD        tải kỳ vọng, xác nhận đạt SLO                → trước mỗi phát hành lớn
STRESS      tăng dần tới khi hỏng                        → tìm GIỚI HẠN và cách nó hỏng
SOAK        tải vừa phải trong nhiều giờ                 → tìm RÒ RỈ và suy giảm dần
SPIKE       tăng đột ngột rồi giảm                       → kiểm tra phục hồi
```

```text
STRESS test trả lời câu quan trọng nhất: hệ thống hỏng NHƯ THẾ NÀO?
  · từ chối lịch sự với 503 và phục hồi khi tải giảm?   ← tốt
  · độ trễ tăng vô hạn, timeout dây chuyền, không phục hồi?  ← xấu

Biết giới hạn quan trọng hơn có giới hạn cao.
```

### Đọc kết quả: throughput bão hoà trước độ trễ

```text
tăng tải →  throughput tăng, độ trễ ổn định       vùng KHOẺ
         →  throughput tăng chậm, độ trễ tăng      gần bão hoà
         →  throughput ĐỨNG YÊN, độ trễ tăng vọt   ĐÃ BÃO HOÀ  ← điểm cần biết
         →  throughput GIẢM, lỗi tăng              SỤP ĐỔ

Con số cần lấy: throughput ở điểm ngay TRƯỚC khi độ trễ bắt đầu tăng.
Đó là dung lượng thật, không phải throughput tối đa quan sát được.
```

### Coordinated omission: cái bẫy làm mọi số đẹp lên

```text
Công cụ gửi request, CHỜ phản hồi, rồi gửi tiếp.
Khi hệ thống chậm, công cụ TỰ ĐỘNG gửi ít đi.
⇒ những request lẽ ra bị chậm KHÔNG BAO GIỜ ĐƯỢC GỬI
⇒ p99 báo cáo thấp hơn thực tế rất nhiều

Chữa: giữ TỐC ĐỘ ĐẾN CỐ ĐỊNH (open model), không phụ thuộc phản hồi.
  k6: `constant-arrival-rate`
  Gatling: `constantUsersPerSec`
  wrk2: `-R <rate>`
```

Đây là lý do một số công cụ cũ (ab, wrk phiên bản gốc, JMeter với thread model mặc định) cho kết quả lạc quan một cách hệ thống. Nếu bạn không cấu hình open model, con số p99 của bạn gần như chắc chắn quá đẹp.

### Profiling: bốn loại

```text
CPU profile      hàm nào chiếm thời gian CPU
                 → node --cpu-prof · Chrome DevTools · 0x · clinic flame
HEAP snapshot    cái gì đang giữ bộ nhớ
                 → so sánh HAI snapshot để tìm rò rỉ
ALLOCATION       cái gì cấp phát nhiều (áp lực GC)
                 → node --heap-prof
ASYNC/WALL       thời gian TRÔI QUA, gồm cả chờ I/O
                 → clinic bubbleprof · trace
```

```text
Nhầm lẫn phổ biến: dùng CPU profile cho vấn đề I/O.
  Service chờ database 2 giây → CPU profile gần như TRỐNG
  → cần wall-clock/async profile hoặc trace, không phải CPU profile
```

### Đọc flame graph

```text
Trục NGANG  = thời gian tích luỹ (KHÔNG phải thời gian trôi)
Trục DỌC    = độ sâu ngăn xếp
Bề RỘNG     = tổng thời gian trong hàm đó và hàm nó gọi

Tìm:
  · khối RỘNG ở gần đỉnh    → hàm tự nó tốn nhiều (self time)
  · khối rộng ở dưới         → nhánh gọi tốn nhiều tổng cộng
  · nhiều cột hẹp giống nhau → hàm được gọi rất nhiều lần
  · khối GC rộng             → áp lực cấp phát
```

Sắp xếp theo **self time** trước khi nhìn hình: nó cho danh sách hàm cần xem trong vài giây, còn hình cho ngữ cảnh về đường gọi.

### Đo trong production: continuous profiling

```text
Load test là mô phỏng. Production là thật.

Continuous profiling: lấy mẫu CPU/heap liên tục ở production
  · chi phí thấp (~1–2% với tần số lấy mẫu hợp lý)
  · trả lời "hàm nào tốn CPU nhất TUẦN NÀY"
  · so sánh được giữa hai phiên bản
```

Đây là công cụ trả lời câu hỏi mà load test không thể: **tải thật đang tốn tài nguyên ở đâu**.

### Micro-benchmark: hầu như luôn nói dối

```text
Chạy một hàm một triệu lần trong vòng lặp:
  · JIT tối ưu theo cách không xảy ra trong code thật
  · dead code elimination xoá luôn thứ bạn đang đo
  · dữ liệu nằm hết trong cache CPU
  · không có GC pressure, không có tranh chấp

⇒ Micro-benchmark dùng được để so hai thuật toán trong CÙNG điều kiện.
⇒ KHÔNG dùng để dự đoán tác động lên hệ thống thật.
```

Quy tắc: đo ở tầng cao nhất mà bạn còn phân biệt được thay đổi. Với thay đổi ở tầng ứng dụng, đó thường là endpoint, không phải hàm.

### Baseline và so sánh

```text
Một con số đơn lẻ vô nghĩa. "p99 = 200ms" tốt hay xấu?

Cần:
  ① BASELINE       số của phiên bản trước, cùng điều kiện
  ② CÙNG MÔI TRƯỜNG  cùng máy, cùng dữ liệu, cùng cấu hình
  ③ NHIỀU LẦN CHẠY  máy ảo có nhiễu; chạy 3–5 lần, lấy trung vị
  ④ WARM-UP        bỏ vài phút đầu (JIT, cache, pool)
```

Không có ④, bạn đang đo quá trình khởi động chứ không phải trạng thái ổn định.

## Example

Load test phản ánh production — bốn điểm khác biệt so với bài test sai ở đầu note:

```js
// k6
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

// ① DỮ LIỆU THẬT: 50.000 user và product id lấy từ bản sao production
const users = new SharedArray('users', () => JSON.parse(open('./users.json')));
const products = new SharedArray('products', () => JSON.parse(open('./products.json')));

export const options = {
  scenarios: {
    // ② OPEN MODEL: tốc độ đến CỐ ĐỊNH, không phụ thuộc phản hồi
    browse: {
      executor: 'constant-arrival-rate',
      rate: 500, timeUnit: '1s', duration: '10m',
      preAllocatedVUs: 200, maxVUs: 2000,
      exec: 'browse',
    },
    checkout: {                                  // ③ HỖN HỢP: đọc + ghi
      executor: 'constant-arrival-rate',
      rate: 50, timeUnit: '1s', duration: '10m',
      preAllocatedVUs: 50, maxVUs: 300,
      exec: 'checkout',
    },
    spike: {                                     // ④ ĐỘT BIẾN, không phải tải đều
      executor: 'ramping-arrival-rate',
      startRate: 500,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '10s', target: 2500 },       // đột biến 5x
        { duration: '1m',  target: 2500 },
        { duration: '30s', target: 500 },        // đo cả PHỤC HỒI
      ],
      preAllocatedVUs: 500, maxVUs: 3000,
      startTime: '5m',
      exec: 'browse',
    },
  },
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(99)<500'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function browse() {
  const p = products[Math.floor(Math.random() * products.length)];   // cardinality thật
  const res = http.get(`${__ENV.BASE_URL}/products/${p.id}`);
  check(res, { 'status 200': r => r.status === 200 });
}

export function checkout() {
  const u = users[Math.floor(Math.random() * users.length)];
  const res = http.post(`${__ENV.BASE_URL}/orders`,
    JSON.stringify({ productId: products[0].id }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` } });
  check(res, { 'status 201 hoặc 429': r => r.status === 201 || r.status === 429 });
}
```

Điều kiện chấp nhận ở `checkout` chấp nhận cả **429**: dưới đột biến, từ chối lịch sự là hành vi **đúng**, không phải thất bại. Một bài test coi 429 là lỗi sẽ khuyến khích bỏ rate limit — đúng thứ giữ hệ thống sống.

Và profiling khi kết quả cho thấy vấn đề:

```bash
# CPU profile trên một instance đang chịu tải
node --cpu-prof --cpu-prof-dir=./prof dist/main.js
# → mở .cpuprofile trong Chrome DevTools, sắp theo Self Time

# flame graph
npx 0x -- node dist/main.js

# rò rỉ bộ nhớ: hai snapshot cách nhau, so sánh
node --inspect dist/main.js
# DevTools → Memory → Heap snapshot lúc T0 và T+30m → Comparison
```

```text
Quy trình đọc kết quả:
  ① sắp theo SELF TIME → ba hàm đầu là danh sách việc
  ② CPU profile gần trống mà độ trễ cao → vấn đề I/O, chuyển sang trace
  ③ khối GC rộng → tìm chỗ cấp phát nhiều (heap-prof)
  ④ so hai snapshot → object nào tăng và ai giữ nó (retainer)
```

## Prediction

1. Load test dùng một user id — cache hit rate bao nhiêu? Production thì sao?
2. Load test trên bảng 1000 dòng, production 40 triệu — plan có giống nhau không?
3. Tải đều tăm tắp so với tải theo cụm — cái nào chạm hàng đợi?
4. Công cụ chờ phản hồi rồi mới gửi tiếp, hệ thống chậm lại — số request gửi đi thế nào?
5. Hệ quả với p99 báo cáo?
6. `constant-arrival-rate` — khác thế nào?
7. Throughput đứng yên trong khi độ trễ tăng vọt — điều này nghĩa là gì?
8. Dung lượng thật nên lấy ở điểm nào trên đường cong?
9. Service chờ database 2 giây, chạy CPU profile — profile trông thế nào?
10. Micro-benchmark cho thấy hàm A nhanh gấp 3 hàm B — endpoint có nhanh gấp 3 không?
11. Đo ngay khi service vừa khởi động — kết quả bị ảnh hưởng bởi gì?
12. Chạy load test một lần trên máy ảo dùng chung — con số đáng tin không?
13. Load test coi 429 là lỗi — nó khuyến khích quyết định thiết kế nào?
14. Soak test 6 giờ, độ trễ tăng đều từ 80ms lên 400ms — nghi gì?

<details>
<summary>Đáp án</summary>

1. Gần **100%**; production thấp hơn nhiều với 50.000 user.
2. **Không** — planner đổi chiến lược theo số dòng.
3. **Tải theo cụm** — tải đều không tạo đột biến.
4. Nó gửi **ít đi** — coordinated omission.
5. p99 báo cáo **thấp hơn thực tế rất nhiều**.
6. Giữ tốc độ đến cố định → hàng đợi tích luỹ như thật.
7. Hệ thống đã **bão hoà**; request đang xếp hàng.
8. Ngay **trước khi độ trễ bắt đầu tăng**, không phải throughput tối đa.
9. Gần như **trống** — CPU không làm gì, nó đang chờ.
10. **Không** — Amdahl; phụ thuộc hàm đó chiếm bao nhiêu phần trăm.
11. **JIT chưa tối ưu, cache lạnh, pool chưa đầy** — cần warm-up.
12. **Không** — cần nhiều lần chạy và lấy trung vị.
13. Bỏ rate limit — **đúng thứ bảo vệ hệ thống**.
14. **Rò rỉ tài nguyên**: bộ nhớ, kết nối, file descriptor, hoặc bloat ở DB.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy load test với 1 user rồi với 50.000 user | Kết quả chênh bao nhiêu? |
| Đổi từ closed model sang `constant-arrival-rate` | p99 đổi bao nhiêu? |
| Tăng tải dần tới khi hỏng | Nó hỏng như thế nào? Có phục hồi không? |
| Đột biến 5x trong 10 giây | Bao lâu để phục hồi? |
| Chạy soak test 6 giờ | Độ trễ hoặc bộ nhớ có tăng dần không? |
| So kết quả 3 lần chạy liên tiếp | Nhiễu bao nhiêu phần trăm? |
| Bỏ warm-up | Con số đổi thế nào? |
| Chạy CPU profile cho một endpoint chờ I/O | Profile có gì không? |
| Chụp hai heap snapshot cách 30 phút | Object nào tăng? |
| So micro-benchmark với đo ở tầng endpoint | Chênh bao nhiêu? |
| Chạy load test trên dữ liệu production-size | Plan database có đổi không? |

## What Usually Goes Wrong

- **Dữ liệu test không giống production** — cardinality, kích thước, phân bố.
- **Closed model** → coordinated omission → p99 quá đẹp.
- **Tải đều** thay vì theo cụm.
- **Chỉ test đường đọc**, bỏ ghi và tìm kiếm.
- **Không có baseline** → không biết thay đổi có tác dụng không.
- **Chạy một lần** trên môi trường nhiễu.
- **Không warm-up.**
- **Coi 429/503 là lỗi** → khuyến khích bỏ cơ chế bảo vệ.
- **Chỉ đo throughput tối đa**, không tìm điểm bão hoà.
- **Không chạy stress test** → không biết hệ thống hỏng thế nào.
- **Không chạy soak test** → rò rỉ chỉ lộ ở production sau vài ngày.
- **Dùng CPU profile cho vấn đề I/O.**
- **Tin micro-benchmark** để quyết định kiến trúc.
- **Load test không có observability** → biết chậm mà không biết vì sao.
- **Chạy load test vào production** mà không thông báo hoặc không có cách dừng.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Load test xanh nghĩa là sẵn sàng | Chỉ khi ba điều kiện dữ liệu/hình dạng/hỗn hợp đúng |
| Throughput tối đa là dung lượng | Dung lượng là điểm trước khi độ trễ tăng |
| Công cụ nào cũng cho p99 như nhau | Closed model gây coordinated omission |
| CPU profile chỉ ra mọi nút thắt | Nó mù với thời gian chờ I/O |
| Flame graph rộng = hàm chậm | Rộng = tổng thời gian, có thể do gọi nhiều lần |
| Micro-benchmark dự đoán được hệ thống | JIT và điều kiện thật khác hoàn toàn |
| Chạy một lần là đủ | Môi trường có nhiễu đáng kể |
| Profiling ở production quá tốn | Continuous profiling ~1–2% |
| Test 5 phút là đủ | Rò rỉ cần soak test hàng giờ |
| 429 trong load test là thất bại | Từ chối lịch sự là hành vi đúng |

## Debugging

1. **Xác định câu hỏi trước khi đo**: "hệ thống chịu được bao nhiêu" (load test) hay "thời gian đi đâu" (profile)?
2. **Kiểm tra bài test trước khi tin kết quả**: cardinality dữ liệu, open/closed model, hỗn hợp thao tác.
3. **Vẽ đường cong throughput–độ trễ**, không nhìn một điểm.
4. **Khi load test cho kết quả xấu**, bật đầy đủ observability và chạy lại — trace và event loop lag chỉ thẳng nút thắt.
5. **CPU profile**: sắp theo self time; nếu profile trống, vấn đề là I/O.
6. **Rò rỉ**: hai heap snapshot, xem Comparison, tìm retainer của object tăng nhiều nhất.
7. **Kết quả không tái lập** → tăng số lần chạy, cố định môi trường, kiểm tra hàng xóm ồn ào trên máy ảo.
8. **So với production thật**: nếu load test nói 2000 rps mà production sập ở 400, bài test sai — sửa bài test trước khi sửa hệ thống.

## Production Considerations

- **Dữ liệu test có kích thước và phân bố gần production** — bản sao đã ẩn danh là lựa chọn tốt nhất.
- **Open model (`constant-arrival-rate`)** để tránh coordinated omission.
- **Hỗn hợp thao tác theo tỉ lệ thật**, gồm cả ghi.
- **Ngưỡng (threshold) trong bài test** để nó pass/fail được, chạy trong CI cho thay đổi lớn.
- **Chạy đủ bốn loại**: smoke trong CI, load trước phát hành, stress và soak định kỳ.
- **Chấp nhận 429/503** như hành vi đúng dưới đột biến.
- **Baseline lưu lại** và so sánh giữa các phiên bản.
- **Warm-up rồi mới đo**; chạy nhiều lần, lấy trung vị.
- **Bật đầy đủ observability trong lúc test** — không có nó, bạn chỉ biết "chậm".
- **Continuous profiling ở production** để biết tải thật tốn ở đâu.
- **Ghi lại kết quả**: cấu hình, dữ liệu, con số, kết luận — nó là baseline cho lần sau.
- **Nếu test trên production**: thông báo trước, giới hạn phạm vi, có nút dừng, tránh giờ cao điểm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Load test dữ liệu thật | kết quả đúng | tốn công chuẩn bị, vấn đề riêng tư |
| Dữ liệu tổng hợp | dễ, an toàn | có thể không phản ánh thực tế |
| Open model | p99 đúng | cần nhiều VU hơn, tốn tài nguyên |
| Closed model | đơn giản, ít tài nguyên | coordinated omission |
| Test trong CI | bắt hồi quy sớm | tốn thời gian pipeline |
| Test thủ công trước phát hành | ít tốn | dễ bị bỏ qua |
| Continuous profiling | dữ liệu thật, liên tục | 1–2% chi phí, thêm công cụ |
| Profile theo yêu cầu | không chi phí thường trực | phải tái lập được vấn đề |
| Stress test tới sập | biết giới hạn và cách hỏng | rủi ro nếu chạy nhầm môi trường |
| Chỉ load test tới mức kỳ vọng | an toàn | không biết biên còn bao nhiêu |

## Explain Without Notes

1. Profiling và load testing trả lời hai câu hỏi nào?
2. Ba điều kiện để load test phản ánh production?
3. Coordinated omission là gì và nó làm sai lệch số nào?
4. Đọc đường cong throughput–độ trễ thế nào? Lấy dung lượng ở điểm nào?
5. Vì sao CPU profile vô dụng với vấn đề I/O? Dùng gì thay thế?
6. Đọc flame graph: bề rộng nghĩa là gì, và nhìn gì trước?
7. Vì sao micro-benchmark không dự đoán được tác động lên hệ thống?
8. Vì sao coi 429 là lỗi trong load test là quyết định sai?

## Related

- [Latency & bottleneck](01-latency-throughput-bottleneck.md) — khung tối ưu và định luật nền
- [Backend performance](03-backend-performance.md) — thứ profiling thường tìm ra
- [Database performance](04-database-performance.md) — vì sao dữ liệu test phải giống production
- [Backpressure](06-backpressure.md) — hành vi đúng khi vượt giới hạn
- [Capacity & limits](../reliability/04-capacity-and-limits.md) — dùng kết quả để lập kế hoạch
- [Metrics & SLO](../observability/04-metrics-slo.md) — ngưỡng để đánh giá kết quả
- [Deterministic tests](../testing/06-deterministic-tests.md) — nhiễu và tính tái lập
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — chạy load test trong CI

## Version / Context

Ví dụ dùng k6 (`constant-arrival-rate`, `ramping-arrival-rate`, `SharedArray`); Gatling và wrk2 có cơ chế tương đương. Node.js 20+ cho `--cpu-prof`, `--heap-prof`; `0x` và `clinic` cho flame graph và bubbleprof. Continuous profiling: Pyroscope, Parca, hoặc dịch vụ của nhà cung cấp APM. Khái niệm coordinated omission do Gil Tene nêu ra.
