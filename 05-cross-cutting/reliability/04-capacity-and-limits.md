---
level: advanced
area: cross-cutting
prerequisites:
  - 01-failure-modes.md
related:
  - ../performance/06-backpressure.md
  - ../../04-infrastructure/04-kubernetes/09-autoscaling.md
---

# Capacity & limits

> Một hệ thống chạy ổn định ở 300 rps suốt sáu tháng. Marketing thông báo chiến dịch sẽ mang về "khoảng gấp đôi lưu lượng". Đội ngũ tăng số pod từ 6 lên 20 để chắc chắn. Ngày chiến dịch, hệ thống sập ở 450 rps — thấp hơn cả mức họ nghĩ là an toàn. Nguyên nhân: 20 pod × 20 kết nối = 400 kết nối, vượt `max_connections = 200` của PostgreSQL. **Việc thêm dung lượng đã tạo ra sự cố.**

## Position

```text
Performance   "nhanh bao nhiêu"
Backpressure  "làm gì khi vượt giới hạn"
Capacity      "GIỚI HẠN Ở ĐÂU, và nó là giới hạn CỦA CÁI GÌ"
              ↑ câu hỏi phải trả lời TRƯỚC, bằng số
```

## Problem

```text
"Hệ thống chịu được bao nhiêu?" — hầu hết đội ngũ không có câu trả lời bằng số.

Hệ quả:
  · scale mù → thêm chỗ này, làm sập chỗ khác  ← sự cố ở đầu note
  · không biết còn bao nhiêu biên trước khi hỏng
  · phát hiện giới hạn vào đúng ngày quan trọng nhất
  · chi quá nhiều cho dung lượng không cần, hoặc quá ít cho phần cần
```

## Mental Model

### Giới hạn nào cũng là giới hạn của MỘT tài nguyên

```text
Với mỗi tầng, viết ra con số:

  Ứng dụng    số request đồng thời · số worker · event loop
  Kết nối     N pod × pool ≤ max_connections    ← hay bị bỏ nhất
  Database    IOPS · CPU · bộ nhớ · số kết nối
  Cache       bộ nhớ · băng thông · số lệnh/giây
  Queue       throughput consumer · độ sâu · dung lượng lưu
  Mạng        băng thông · số kết nối · giới hạn NAT
  Bên thứ ba  rate limit của họ ← thường là trần thật của bạn
  Hạ tầng     quota cloud · IP trong subnet · số pod mỗi node
```

Trần thật của hệ thống là **giá trị nhỏ nhất** trong danh sách này — không phải giá trị của thành phần bạn hay nghĩ tới.

### Scale ứng dụng không scale dependency

```text
Ứng dụng   scale NGANG dễ — thêm pod
Database   scale ngang KHÓ — một primary cho ghi
Cache      scale được nhưng cần sharding
Bên thứ ba KHÔNG scale được — rate limit là của họ

⇒ Thêm pod chuyển tải xuống dependency KHÔNG scale được.
⇒ Đây là cách "thêm dung lượng" trở thành nguyên nhân sự cố.
```

```text
Phép tính bắt buộc trước MỌI lần scale:

  max_replicas × pool_per_pod + (kết nối cho migration, admin, job)
    ≤ max_connections × 0.8            (chừa biên)

  6 pod × 20 = 120 + 20 = 140 ≤ 160  ✓
  20 pod × 20 = 400 + 20 = 420 ≤ 160  ✗   ← sự cố ở đầu note
```

Lời giải đúng cho tình huống đó không phải "tăng `max_connections`" mà là **connection pooler** (PgBouncer ở chế độ transaction), tách số kết nối ứng dụng khỏi số kết nối database.

### Ba con số cho mỗi tài nguyên

```text
MỨC DÙNG HIỆN TẠI    đo được, hôm nay
GIỚI HẠN CỨNG         cấu hình hoặc vật lý
NGƯỠNG AN TOÀN        thường 60–70% giới hạn cứng

Biên = ngưỡng an toàn − mức hiện tại
     → tính bằng PHẦN TRĂM và bằng THỜI GIAN ("còn 4 tháng theo đà tăng")
```

Con số "còn bao nhiêu tháng" hữu ích hơn phần trăm: nó biến kế hoạch dung lượng thành một mục có thời hạn thay vì một cảm giác.

### Vì sao 100% không bao giờ đạt được

```text
Đường cong hàng đợi: chờ ≈ phục vụ × ρ/(1−ρ)
  ρ = 0.7 →  2,3×      ρ = 0.9 →  9×      ρ = 0.95 → 19×

⇒ ngưỡng an toàn 60–70% không phải lãng phí.
  Nó là thứ mua: khả năng chịu đột biến · thời gian scale · biên cho lỗi ước lượng
```

Và một lý do thứ hai, hay bị bỏ: **khi một instance chết, tải của nó dồn sang phần còn lại**. Chạy ở 90% với 10 instance nghĩa là mất một instance đẩy phần còn lại lên 100%.

### Autoscaling không phải kế hoạch dung lượng

```text
Autoscaling giải quyết: biến động DỰ ĐOÁN ĐƯỢC theo giờ trong ngày
Nó KHÔNG giải quyết:
  · đột biến trong vài giây   (scale mất 30s–2 phút: phát hiện + lên lịch + khởi động + warm-up)
  · giới hạn của dependency    (scale app không scale database)
  · quota cloud                (hết instance là hết)

⇒ Autoscaling cần TRẦN được tính toán, không phải trần đặt tuỳ ý.
⇒ Và cần backpressure cho khoảng thời gian nó chưa kịp scale.
```

### Giới hạn của bên thứ ba là trần của bạn

```text
API thanh toán:  100 req/s
Email:           500 email/giờ
SMS:             quota theo ngày
Nhà cung cấp:    burst limit khác sustained limit

⇒ Hệ thống của bạn không thể nhanh hơn giới hạn này.
⇒ Cần: rate limit PHÍA BẠN (đừng để họ từ chối bạn)
       hàng đợi để làm phẳng đột biến
       theo dõi hạn mức còn lại (nhiều API trả trong header)
```

Lỗi phổ biến: coi rate limit của nhà cung cấp là chuyện của họ. Khi bạn bị họ chặn, nó là sự cố của bạn.

### Multi-tenant: một khách hàng có thể chiếm hết

```text
Không có quota theo tenant:
  một khách hàng chạy import 500.000 dòng
  → chiếm hết worker, pool, hàng đợi
  → mọi khách hàng khác bị ảnh hưởng   ("noisy neighbour")

Cần:
  · quota theo tenant (request/giây, job đồng thời, dung lượng)
  · hàng đợi riêng hoặc fair scheduling
  · giới hạn kích thước từng thao tác (số dòng, dung lượng file)
```

### Tăng trưởng không tuyến tính

```text
Một số thứ tăng nhanh hơn số người dùng:

  quan hệ n²        mỗi người dùng kết nối với người khác
  dữ liệu tích luỹ  không xoá gì → bảng tăng mãi → truy vấn chậm dần
  fan-out           một hành động sinh N thông báo
  N+1 ẩn            danh sách dài hơn → nhiều truy vấn hơn mỗi request

⇒ Đo tài nguyên trên MỖI ĐƠN VỊ NGHIỆP VỤ, không chỉ tổng:
     rps mỗi người dùng hoạt động · dung lượng mỗi tenant
     · truy vấn mỗi request · kết nối mỗi pod
  → dự báo mới có ý nghĩa
```

### Ước lượng dung lượng: một phép tính đơn giản

```text
① Đơn vị nghiệp vụ:   người dùng hoạt động hằng ngày
② Tỉ lệ chuyển đổi:    request mỗi người dùng mỗi ngày
③ Hệ số đỉnh:          đỉnh / trung bình  (thường 3–10× cho ứng dụng B2C)
④ Tài nguyên mỗi request: CPU, truy vấn, kết nối, byte
⑤ Nhân lên, chia cho ngưỡng an toàn
```

```text
Ví dụ:
  100.000 DAU × 50 request/ngày = 5.000.000 request/ngày
  trung bình = 58 rps;  đỉnh × 6 = 350 rps
  mỗi request: 3 truy vấn, 15ms DB → 350 × 3 × 0,015 = 15,75 kết nối bận
  ở ngưỡng 60%: cần ~26 kết nối → pool 30 tổng cộng qua mọi pod
```

Giá trị của phép tính này không phải độ chính xác — nó là việc **buộc bạn viết ra các giả định**. Khi thực tế lệch, bạn biết giả định nào sai.

## Example

Bảng dung lượng — tài liệu nên có cho mọi service:

```text
SERVICE: order-api                    cập nhật: 2026-08-28

TÀI NGUYÊN        HIỆN TẠI   AN TOÀN   CỨNG      BIÊN     GHI CHÚ
────────────────────────────────────────────────────────────────────────────
rps               310        700       ~1000     2,3×     đo từ stress test
pod               6          14        20        HPA max  20 × 20 = 400 conn ✗
DB connections    120        160       200       1,3×     ← TRẦN THẬT
DB CPU            45%        70%       100%      1,6×
DB IOPS           2.100      6.000     8.000     2,9×
Redis memory      3,2 GB     6 GB      8 GB      1,9×     maxmemory-policy: allkeys-lru
Queue depth       ~40        5.000     ∞         —        alert khi >2.000
Payment API       12 rps     70 rps    100 rps   5,8×     giới hạn của nhà cung cấp
Disk              340 GB     700 GB    1 TB      2,1×     tăng ~40 GB/tháng → 9 tháng

TRẦN THẬT: DB connections tại 8 pod (8 × 20 = 160)
           → HPA maxReplicas PHẢI ≤ 8, không phải 20
           → hoặc: PgBouncer để tách hai con số này
```

Bảng này biến câu hỏi "chúng ta chịu được bao nhiêu" thành một dòng có thể chỉ tay vào.

Và bảo vệ trong code:

```ts
// ① kiểm tra bất biến lúc khởi động — fail fast thay vì sập lúc cao điểm
const maxReplicas = Number(process.env.MAX_REPLICAS);
const poolSize = Number(process.env.DB_POOL_SIZE);
const dbMaxConnections = Number(process.env.DB_MAX_CONNECTIONS);
const reserved = 20;                                     // migration, admin, job

if (maxReplicas * poolSize + reserved > dbMaxConnections * 0.8) {
  throw new Error(
    `Cấu hình vượt trần: ${maxReplicas} × ${poolSize} + ${reserved} ` +
    `> ${dbMaxConnections} × 0.8. Giảm pool, giảm maxReplicas, hoặc dùng pooler.`,
  );
}
```

```ts
// ② quota theo tenant — chặn noisy neighbour
@Injectable()
export class TenantQuotaGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx.switchToHttp().getRequest();
    const quota = QUOTAS[user.tier];                     // free/pro/enterprise

    const ok = await this.limiter.tryConsume(`tenant:${user.tenantId}`, quota.rps);
    if (!ok) {
      quotaExceeded.inc({ tenant_tier: user.tier });
      throw new HttpException('vượt hạn mức', 429);
    }
    return true;
  }
}
```

```ts
// ③ theo dõi hạn mức còn lại của nhà cung cấp — họ nói cho bạn biết
const res = await fetch(paymentUrl, opts);
const remaining = Number(res.headers.get('x-ratelimit-remaining'));
const limit = Number(res.headers.get('x-ratelimit-limit'));
if (Number.isFinite(remaining) && Number.isFinite(limit)) {
  providerQuotaRemaining.set({ provider: 'payment' }, remaining / limit);
  // alert khi < 0,2 → còn thời gian phản ứng trước khi bị chặn
}
```

## Prediction

1. 6 pod × 20 kết nối, tăng lên 20 pod, `max_connections = 200` — chuyện gì xảy ra?
2. Cách sửa đúng: tăng `max_connections` hay dùng pooler?
3. Chạy ở 90% dung lượng với 10 instance, một instance chết — phần còn lại ở mức nào?
4. Ở 70% với 10 instance, một chết — mức nào?
5. Đột biến 5x trong 10 giây, autoscaling mất 90 giây — nó có kịp không?
6. Rate limit của nhà cung cấp thanh toán là 100 rps, bạn scale lên 500 rps — chuyện gì xảy ra?
7. Một tenant chạy import 500.000 dòng, không có quota — các tenant khác thế nào?
8. Bảng dữ liệu tăng 40 GB/tháng, đĩa 1 TB, hiện dùng 340 GB — còn bao lâu?
9. Mỗi người dùng kết nối với mọi người dùng khác, số người dùng tăng gấp đôi — số quan hệ tăng bao nhiêu?
10. 100.000 DAU × 50 request/ngày, hệ số đỉnh 6 — rps đỉnh?
11. Không biết hệ số đỉnh, dùng trung bình để lập kế hoạch — sai bao nhiêu lần?
12. HPA `maxReplicas = 20` nhưng trần thật ở 8 pod — HPA có bảo vệ bạn không?
13. Kiểm tra `maxReplicas × pool ≤ max_connections` lúc khởi động — khi nào bạn biết cấu hình sai?
14. Không kiểm tra — khi nào?

<details>
<summary>Đáp án</summary>

1. `20 × 20 = 400 > 200` — **kết nối bị từ chối**, hệ thống sập.
2. **Pooler** — tăng `max_connections` chuyển vấn đề sang bộ nhớ và context switch của database.
3. `90% × 10/9 = 100%` — **quá tải**, có thể sập dây chuyền.
4. `70% × 10/9 ≈ 78%` — **vẫn trong vùng an toàn**.
5. **Không** — 80 giây đầu hệ thống phải tự chịu bằng backpressure.
6. Nhà cung cấp **chặn bạn** — và đó là sự cố của bạn.
7. Bị ảnh hưởng — **noisy neighbour**.
8. `(1000 − 340) / 40 ≈ 16 tháng` tới giới hạn cứng; tới ngưỡng an toàn 700 GB thì **9 tháng**.
9. **Gấp bốn** — quan hệ n².
10. `100.000 × 50 / 86.400 ≈ 58 rps` trung bình; đỉnh **≈350 rps**.
11. **Sai 6 lần** — hệ thống sập ở giờ cao điểm đầu tiên.
12. **Không** — nó cho phép scale vượt trần thật.
13. **Lúc deploy** — fail fast.
14. **Lúc cao điểm**, khi HPA thực sự scale lên.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tính `maxReplicas × pool` và so với `max_connections` | Có vượt không? |
| Scale lên `maxReplicas` trong staging | Database còn nhận kết nối không? |
| Giết một instance khi đang ở 90% | Phần còn lại thế nào? |
| Đột biến 5x trong 10 giây | Autoscaling có kịp không? |
| Gửi tải vượt rate limit của nhà cung cấp | Họ trả gì? Code xử lý thế nào? |
| Cho một tenant chạy job rất lớn | Tenant khác bị ảnh hưởng không? |
| Đo mức tăng dung lượng đĩa mỗi tháng | Còn bao nhiêu tháng? |
| Tính hệ số đỉnh từ dữ liệu thật | Bao nhiêu lần trung bình? |
| Liệt kê mọi giới hạn của mọi tầng | Cái nào nhỏ nhất? |
| Chạy stress test tới sập | Tài nguyên nào cạn trước? |
| Kiểm tra quota cloud hiện tại | Còn bao nhiêu instance được tạo? |

## What Usually Goes Wrong

- **Không biết trần thật** — không ai từng viết ra bằng số.
- **`N pod × pool > max_connections`** — lỗi kinh điển khi scale.
- **Scale app mà không scale hoặc bảo vệ dependency.**
- **Chạy ở mức sử dụng quá cao** → mất một instance là sập dây chuyền.
- **Coi autoscaling là kế hoạch dung lượng.**
- **`maxReplicas` đặt tuỳ ý**, không tính từ trần thật.
- **Bỏ qua rate limit của bên thứ ba.**
- **Không có quota theo tenant** → noisy neighbour.
- **Dùng trung bình thay vì đỉnh** để lập kế hoạch.
- **Không đo tài nguyên trên mỗi đơn vị nghiệp vụ** → không dự báo được.
- **Quên tăng trưởng dữ liệu** — đĩa và thời gian truy vấn.
- **Không tính quota cloud** (IP trong subnet, instance, IOPS).
- **Không kiểm tra bất biến dung lượng lúc khởi động.**
- **Bảng dung lượng viết một lần rồi không cập nhật.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Thêm pod luôn tăng dung lượng | Nó có thể làm sập dependency |
| Autoscaling lo dung lượng | Nó không xử lý đột biến giây và giới hạn dependency |
| Chạy ở 90% là hiệu quả | Mất một instance là sập |
| Trần là con số của thành phần chậm nhất | Nó là con số **nhỏ nhất** trong mọi tầng |
| `max_connections` cao hơn là giải pháp | Nó chuyển vấn đề sang bộ nhớ database |
| Rate limit của nhà cung cấp là chuyện của họ | Bị chặn là sự cố của bạn |
| Tăng trưởng tuyến tính theo người dùng | Nhiều thứ tăng nhanh hơn |
| Trung bình đủ để lập kế hoạch | Hệ số đỉnh thường 3–10× |
| Cloud là vô hạn | Quota và hạn mức khu vực là thật |
| Biết dung lượng một lần là đủ | Nó thay đổi theo mỗi thay đổi kiến trúc |

## Debugging

1. **Xác định tài nguyên nào cạn trước** — stress test cho câu trả lời nhanh nhất.
2. **Liệt kê ba con số cho mỗi tầng** (hiện tại / an toàn / cứng) và tìm giá trị nhỏ nhất.
3. **Kiểm tra phép tính kết nối**: `SELECT count(*) FROM pg_stat_activity;` so với `max_connections`.
4. **Sập khi scale lên** → gần như luôn là kết nối hoặc rate limit của dependency.
5. **Đo hệ số đỉnh thật** từ dữ liệu lịch sử, không đoán.
6. **Tài nguyên trên mỗi đơn vị nghiệp vụ** → dùng nó để dự báo, không dùng số tổng.
7. **Kiểm tra quota cloud** trước sự kiện lớn — nó là giới hạn không tăng được trong vài phút.
8. **Sau sự cố dung lượng**: cập nhật bảng, và thêm kiểm tra bất biến lúc khởi động cho ràng buộc vừa bị vi phạm.

## Production Considerations

- **Bảng dung lượng cho mỗi service**, có ba con số mỗi tài nguyên, cập nhật định kỳ.
- **Xác định TRẦN THẬT** và ghi rõ nó là giới hạn của tài nguyên nào.
- **`maxReplicas` tính từ trần thật**, không đặt tuỳ ý.
- **Kiểm tra bất biến dung lượng lúc khởi động** — fail fast.
- **Connection pooler** khi số pod lớn.
- **Ngưỡng an toàn 60–70%**, tính cả trường hợp mất một instance.
- **Backpressure cho khoảng thời gian autoscaling chưa kịp.**
- **Rate limit phía bạn cho mọi API bên thứ ba**; theo dõi hạn mức còn lại.
- **Quota theo tenant** và giới hạn kích thước từng thao tác.
- **Đo tài nguyên trên mỗi đơn vị nghiệp vụ** để dự báo.
- **Alert theo biên còn lại** ("còn 2 tháng"), không chỉ theo mức tuyệt đối.
- **Kiểm tra quota cloud** định kỳ và trước sự kiện lớn.
- **Chạy stress test định kỳ** — dung lượng thay đổi theo mỗi lần thay đổi kiến trúc.
- **Lập kế hoạch cho sự kiện đã biết** (khuyến mãi, mùa cao điểm) bằng số, không bằng cảm giác.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ngưỡng an toàn thấp (60%) | chịu được đột biến và mất instance | tốn tài nguyên |
| Ngưỡng cao (85%) | rẻ | không có biên |
| Nhiều pod nhỏ | phân tán rủi ro, scale mịn | nhiều kết nối, nhiều overhead |
| Ít pod lớn | ít kết nối | mất một pod ảnh hưởng lớn |
| Connection pooler | tách app khỏi giới hạn DB | thêm thành phần, mất một số tính năng session |
| Autoscaling | thích ứng theo tải | chậm, có thể làm sập dependency |
| Dung lượng cố định | dự đoán được | trả tiền cho đỉnh 24/7 |
| Quota theo tenant | công bằng, chặn noisy neighbour | phức tạp, khách hàng lớn phàn nàn |
| Không quota | đơn giản | một tenant ảnh hưởng tất cả |
| Stress test định kỳ | biết giới hạn thật | tốn thời gian và tài nguyên |

## Explain Without Notes

1. Vì sao thêm pod có thể làm hệ thống sập?
2. Phép tính bắt buộc trước mỗi lần scale, và cách sửa đúng khi nó không thoả?
3. Ba con số cần cho mỗi tài nguyên, và vì sao "còn bao nhiêu tháng" hữu ích hơn phần trăm?
4. Hai lý do không chạy ở 90% dung lượng?
5. Autoscaling giải quyết gì và không giải quyết gì?
6. Vì sao rate limit của nhà cung cấp là trần của bạn?
7. Bốn thứ tăng nhanh hơn số người dùng?
8. Năm bước ước lượng dung lượng, và giá trị thật của phép tính đó là gì?

## Related

- [Failure modes](01-failure-modes.md) — điều gì xảy ra khi chạm giới hạn
- [Graceful degradation](03-graceful-degradation.md) — suy giảm theo tải
- [Backpressure](../performance/06-backpressure.md) — hành vi khi vượt giới hạn
- [Profiling & load testing](../performance/05-profiling-load-testing.md) — đo giới hạn thật
- [Latency & bottleneck](../performance/01-latency-throughput-bottleneck.md) — đường cong hàng đợi
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — phép tính kết nối
- [Autoscaling](../../04-infrastructure/04-kubernetes/09-autoscaling.md) — cấu hình HPA
- [Replication & scaling](../../03-database/01-postgresql/09-replication-scaling.md) — scale tầng dữ liệu
- [Scaling, cache & queue](../../06-system-design/02-scaling-cache-queue.md) — quyết định kiến trúc
- [Metrics & SLO](../observability/04-metrics-slo.md) — theo dõi bão hoà

## Version / Context

Ví dụ dùng PostgreSQL 16 (`max_connections` mặc định 100; PgBouncer ở chế độ transaction là pooler phổ biến), Kubernetes 1.29+ (HPA `autoscaling/v2`), Redis 7. Hệ số đỉnh 3–10× là quan sát thực nghiệm cho ứng dụng B2C — hãy đo hệ số của chính bạn. Đường cong hàng đợi theo xấp xỉ M/M/1.
