---
level: advanced
area: cross-cutting
related:
  - 02-timeout-retry-circuit-breaker.md
  - ../observability/04-metrics-slo.md
---

# Failure modes: hệ thống hỏng như thế nào

> Một service phụ trợ hiển thị "sản phẩm gợi ý" trở nên chậm — 30 giây mỗi lời gọi, không lỗi. Trang chủ gọi nó đồng bộ, không có timeout. Trong bốn phút, mọi worker của trang chủ đều bị giữ trong lời gọi chờ. Trang chủ ngừng phục vụ. Rồi checkout — vốn không liên quan gì tới gợi ý — cũng ngừng, vì nó dùng chung pool kết nối đã cạn. **Một tính năng phụ đã kéo sập toàn bộ trang, mà bản thân nó không hề trả về lỗi nào.**

## Position

```text
Performance   "nhanh bao nhiêu khi mọi thứ ổn"
Reliability   "chuyện gì xảy ra khi KHÔNG ổn"
              ↑ và câu trả lời được quyết định lúc THIẾT KẾ, không lúc sự cố
```

## Problem

```text
Mọi thành phần SẼ hỏng. Câu hỏi không phải "có hỏng không" mà là:
  ① nó hỏng THEO CÁCH NÀO?
  ② hỏng của nó LAN tới đâu?
  ③ hệ thống PHỤC HỒI thế nào khi nó trở lại?

Hệ thống được thiết kế cho đường thành công sẽ hỏng theo cách tệ nhất
ở cả ba câu — và đó là mặc định nếu không ai chọn khác.
```

## Mental Model

### Chậm nguy hiểm hơn chết

```text
Dependency CHẾT     → lỗi ngay → xử lý được → hệ thống tiếp tục
Dependency CHẬM     → giữ tài nguyên → cạn dần → hệ thống CHẾT THEO

Vì sao:
  lỗi nhanh giải phóng worker/kết nối ngay
  chờ 30 giây giữ chúng suốt 30 giây
  → với 100 rps, 30 giây chờ = 3000 request tích luỹ
```

Đây là lý do **timeout là biện pháp reliability quan trọng nhất**, và cũng là thứ hay thiếu nhất. Một dependency không có timeout là một dependency có thể kéo sập bạn.

### Bốn cách hỏng

```text
FAIL-STOP      dừng hẳn, quan sát được       → dễ xử lý nhất
FAIL-SLOW      vẫn phản hồi nhưng rất chậm   → nguy hiểm nhất
FAIL-PARTIAL   một phần hỏng (một shard, một AZ, một tenant)
BYZANTINE      trả về kết quả SAI mà vẫn "thành công"  → khó phát hiện nhất
```

```text
Health check chỉ phát hiện fail-stop.
Ba loại còn lại cần: timeout, kiểm tra ngữ nghĩa, và metric nghiệp vụ.
```

### Lỗi lan như thế nào: bốn cơ chế

```text
① CẠN TÀI NGUYÊN
   dependency chậm → worker/kết nối bị giữ → dịch vụ KHÁC cũng cạn
   ← chính là sự cố ở đầu note

② RETRY STORM
   lỗi → mọi client retry → tải nhân 3 → dependency càng hỏng

③ HÀNG ĐỢI PHÌNH
   consumer chậm → hàng đợi dài → bộ nhớ → OOM

④ MẤT CÂN BẰNG SAU SỰ CỐ
   một instance chết → tải dồn sang instance còn lại → chúng cũng chết
   → "cascading failure" theo nghĩa hẹp nhất
```

Cơ chế ④ đặc biệt khó chịu vì nó tự tăng tốc: mỗi instance chết làm tải trên phần còn lại tăng thêm.

### Bulkhead: chặn lỗi lan giữa các phần

```text
Không có bulkhead:
  [ pool kết nối DÙNG CHUNG 100 ]
    ← gợi ý (chậm) chiếm hết 100 → checkout không còn gì

Có bulkhead:
  [ checkout: 60 ] [ tìm kiếm: 25 ] [ gợi ý: 15 ]
    ← gợi ý chỉ chiếm được 15 → checkout không bị ảnh hưởng
```

```text
Nguyên tắc: phân vùng tài nguyên theo MỨC QUAN TRỌNG, không chia đều.
  → đường sinh doanh thu có phần riêng và lớn nhất
  → tính năng phụ có trần cứng
```

Bulkhead áp dụng cho: pool kết nối, thread/worker, hàng đợi, và ở tầng hạ tầng là cluster/namespace riêng.

### Phụ thuộc: bắt buộc hay không bắt buộc

```text
Với MỖI dependency, trả lời: "nếu nó chết, tính năng này còn hoạt động không?"

BẮT BUỘC (hard)      không có nó thì không làm được
                     → database chính cho checkout
                     → giảm số lượng này xuống tối thiểu

KHÔNG BẮT BUỘC (soft) có thì tốt, không có vẫn chạy
                     → gợi ý, analytics, ảnh đại diện, gợi ý tìm kiếm
                     → PHẢI có timeout ngắn và fallback
```

```text
Lỗi thiết kế phổ biến nhất: xử lý dependency KHÔNG bắt buộc
như thể nó bắt buộc — chờ nó vô hạn và fail cả request khi nó lỗi.
```

Bài kiểm tra: đếm số dependency mà nếu chết sẽ làm trang chủ ngừng hoạt động. Nếu con số đó lớn hơn 2–3, kiến trúc đang phụ thuộc quá nhiều thứ.

### Nhân số 9 lại: phụ thuộc nối tiếp

```text
Service A phụ thuộc BẮT BUỘC vào 5 service, mỗi cái 99,9%:
  khả dụng = 0,999⁵ ≈ 99,5%   → 3,6 giờ/tháng thay vì 43 phút

⇒ mỗi phụ thuộc bắt buộc thêm vào LÀM GIẢM độ tin cậy
⇒ biến phụ thuộc thành không bắt buộc là cách rẻ nhất tăng độ tin cậy
```

### Fail open hay fail closed

```text
Khi một kiểm tra không thực hiện được, chọn mặc định nào?

FAIL CLOSED  từ chối khi không chắc
             ✓ authz, thanh toán, kiểm tra tồn kho
             → an toàn nhưng có thể tự gây downtime

FAIL OPEN    cho qua khi không chắc
             ✓ rate limit (Redis chết → cho qua), feature flag, analytics
             → giữ dịch vụ nhưng mất kiểm soát

Quyết định theo HẬU QUẢ, không theo thói quen.
"Redis chết thì mọi người không đăng nhập được" thường là lựa chọn sai.
```

### Điểm hỏng đơn lẻ ở nơi không ngờ

```text
Rõ ràng:   một instance database, một node
Ít rõ hơn: · DNS
           · dịch vụ xác thực (mọi request đều qua nó)
           · feature flag service (nếu fail closed)
           · một AZ dù có nhiều instance đều nằm trong đó
           · certificate hết hạn (tất cả cùng lúc)
           · một dependency npm bị gỡ khỏi registry
           · CHÍNH CƠ CHẾ PHỤC HỒI: rollback cần CI, mà CI cũng đang hỏng
```

Mục cuối là loại điểm hỏng đáng lo nhất: nó chỉ lộ ra đúng lúc bạn cần nó nhất.

### Hiệu ứng đàn: khi mọi thứ xảy ra cùng lúc

```text
THUNDERING HERD   cache hết hạn cùng lúc → mọi request cùng đánh vào DB
                  → jitter cho TTL; single-flight; stale-while-revalidate

RETRY ĐỒNG BỘ     mọi client retry sau đúng 1 giây
                  → jitter trong backoff

CRON ĐỒNG BỘ      mọi instance chạy job lúc 00:00
                  → jitter, hoặc bầu chọn leader

RECONNECT STORM   dịch vụ trở lại → mọi client kết nối lại cùng lúc
                  → backoff + jitter phía client
```

Mẫu chung: **jitter**. Nó là biện pháp rẻ nhất trong toàn bộ note này và bị bỏ qua thường xuyên nhất.

### Phục hồi cũng phải thiết kế

```text
Hệ thống trở lại KHÔNG có nghĩa là mọi thứ ổn:

  · hàng tồn khổng lồ cần xử lý → có bỏ việc quá cũ không?
  · cache lạnh → tải lên DB gấp nhiều lần bình thường
  · mọi client reconnect cùng lúc
  · dữ liệu không nhất quán từ lúc sự cố → có cách phát hiện và sửa không?

⇒ Test PHỤC HỒI, không chỉ test hành vi lúc hỏng.
```

## Example

Chuyển sự cố ở đầu note từ "sập toàn trang" thành "mất một tính năng phụ":

```ts
// ✗ trước: phụ thuộc không bắt buộc được xử lý như bắt buộc
@Get('/')
async home(@CurrentUser() user: User) {
  const [products, recommendations] = await Promise.all([
    this.products.featured(),
    this.recommendations.forUser(user.id),   // không timeout, không fallback
  ]);
  return { products, recommendations };
}
```

```ts
// ✓ sau: bốn lớp bảo vệ, mỗi lớp chặn một cơ chế lan
@Get('/')
async home(@CurrentUser() user: User) {
  const products = await this.products.featured();            // BẮT BUỘC

  const recommendations = await this.safeRecommendations(user.id);  // KHÔNG bắt buộc
  return { products, recommendations, degraded: recommendations === null };
}

private async safeRecommendations(userId: string) {
  // ① CIRCUIT BREAKER: ngừng gọi khi rõ ràng đang hỏng
  if (this.recoBreaker.isOpen()) {
    recoSkipped.inc({ reason: 'circuit_open' });
    return this.cache.get(`reco:${userId}`) ?? null;          // ② FALLBACK: dữ liệu cũ
  }

  try {
    // ③ TIMEOUT NGẮN: tính năng phụ không được chờ lâu
    const result = await this.recommendations.forUser(userId, { timeoutMs: 300 });
    this.recoBreaker.recordSuccess();
    await this.cache.set(`reco:${userId}`, result, 3600);     // nuôi fallback
    return result;
  } catch (err) {
    this.recoBreaker.recordFailure();
    recoFailed.inc({ kind: err instanceof TimeoutError ? 'timeout' : 'error' });
    this.logger.warn({ err, userId }, 'recommendations unavailable — degrading');
    return this.cache.get(`reco:${userId}`) ?? null;          // KHÔNG ném lỗi lên
  }
}
```

```ts
// ④ BULKHEAD: pool riêng — gợi ý không bao giờ chiếm được kết nối của checkout
const pools = {
  critical: new Pool({ max: 60 }),      // checkout, đăng nhập
  standard: new Pool({ max: 25 }),      // duyệt, tìm kiếm
  optional: new Pool({ max: 15 }),      // gợi ý, analytics
};
```

```text
Kết quả khi gợi ý chậm 30 giây:
  trước:  trang chủ chết trong 4 phút, checkout chết theo
  sau:    trang chủ trả về sau 300ms, không có phần gợi ý
          checkout hoàn toàn không bị ảnh hưởng
          circuit breaker mở sau vài lần lỗi → ngừng lãng phí 300ms mỗi request
```

Chú ý dòng `degraded: recommendations === null`: hệ thống **biết** nó đang ở chế độ suy giảm và nói ra. Không có tín hiệu đó, suy giảm trở thành lỗi im lặng — trang thiếu tính năng và không ai biết trong nhiều ngày.

## Prediction

1. Dependency chết ngay so với chậm 30 giây — cái nào nguy hiểm hơn?
2. 100 rps, dependency chậm 30 giây, không timeout — bao nhiêu request tích luỹ?
3. Pool dùng chung 100 kết nối, một tính năng phụ chiếm hết — checkout thế nào?
4. Có bulkhead với 15 kết nối cho tính năng phụ — checkout thế nào?
5. Service phụ thuộc bắt buộc vào 5 service, mỗi cái 99,9% — khả dụng tổng?
6. Biến 3 trong 5 thành không bắt buộc — khả dụng?
7. Health check trả 200 nhưng service trả dữ liệu sai — loại hỏng nào? Có phát hiện được không?
8. Rate limit dùng Redis, Redis chết, code fail closed — chuyện gì xảy ra?
9. Fail open — chuyện gì xảy ra?
10. 10.000 khoá cache cùng TTL 3600s, set cùng lúc — chuyện gì xảy ra sau một giờ?
11. Thêm jitter ±10% vào TTL — thế nào?
12. Một instance trong 3 chết, tải dồn sang 2 cái còn lại — điều gì có thể xảy ra?
13. Hệ thống trở lại sau 20 phút, cache trống — tải lên DB thế nào?
14. Cần rollback nhưng CI cũng đang hỏng — bạn làm gì?

<details>
<summary>Đáp án</summary>

1. **Chậm** — nó giữ tài nguyên; chết thì giải phóng ngay.
2. `100 × 30 = 3000` request.
3. **Chết theo** — không còn kết nối nào.
4. **Không bị ảnh hưởng** — tính năng phụ có trần cứng.
5. `0,999⁵ ≈ 99,5%` — 3,6 giờ/tháng.
6. `0,999² ≈ 99,8%` — cải thiện đáng kể mà không cần làm gì với hạ tầng.
7. **Byzantine** — health check không phát hiện được; cần kiểm tra ngữ nghĩa và metric nghiệp vụ.
8. **Không ai gọi được API** — Redis chết thành downtime toàn bộ.
9. Rate limit tạm mất hiệu lực, dịch vụ **vẫn chạy**.
10. **Thundering herd** — mọi request cùng đánh vào DB.
11. Hết hạn **trải đều** trong 12 phút.
12. Chúng có thể **quá tải và chết theo** — cascading failure.
13. **Gấp nhiều lần bình thường** — cache lạnh.
14. Đây là câu hỏi cần trả lời **trước** sự cố; cần đường rollback không phụ thuộc CI.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm delay 30 giây vào một dependency | Hệ thống thế nào sau 2 phút? |
| Giết một dependency hoàn toàn | Khác với làm chậm nó thế nào? |
| Liệt kê mọi dependency, đánh dấu bắt buộc/không | Bao nhiêu cái bắt buộc? |
| Gỡ mạng tới Redis | Fail open hay fail closed? |
| Giết 1 trong 3 instance | 2 cái còn lại có chịu nổi không? |
| Xoá toàn bộ cache | Tải lên DB tăng bao nhiêu? |
| Đặt TTL giống nhau cho 10.000 khoá | Có đợt tăng sau khi hết hạn không? |
| Chặn DNS trong 30 giây | Bao nhiêu thứ hỏng? |
| Làm dependency trả về dữ liệu SAI (không phải lỗi) | Có gì phát hiện không? |
| Dừng consumer 15 phút rồi bật lại | Bao lâu để xử lý hết? Có bỏ việc cũ không? |
| Thử rollback khi CI đang hỏng | Có đường khác không? |

## What Usually Goes Wrong

- **Không có timeout** cho lời gọi ra ngoài.
- **Xử lý dependency không bắt buộc như bắt buộc.**
- **Tài nguyên dùng chung không phân vùng** → một phần kéo sập tất cả.
- **Retry không có backoff/jitter/ngân sách.**
- **Fail closed ở nơi nên fail open** (rate limit, feature flag).
- **Fail open ở nơi nên fail closed** (authz, thanh toán).
- **Chỉ có health check** → mù với fail-slow và byzantine.
- **Không có jitter** cho TTL, cron, reconnect, retry.
- **Không tính khả dụng tổng hợp** của chuỗi phụ thuộc.
- **Không test phục hồi** — chỉ test hành vi lúc hỏng.
- **Suy giảm im lặng** — không có tín hiệu nào cho biết đang thiếu tính năng.
- **Cơ chế phục hồi phụ thuộc thứ đang hỏng.**
- **Không diễn tập** — sự cố đầu tiên là lần thực hành đầu tiên.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Dependency chết là trường hợp xấu nhất | Chậm tệ hơn nhiều |
| Health check đủ để biết service khoẻ | Nó chỉ bắt fail-stop |
| Retry làm hệ thống đáng tin hơn | Khi quá tải, nó làm tệ hơn |
| Thêm redundancy tăng độ tin cậy | Chỉ khi lỗi độc lập và tải dồn được chịu |
| Nhiều instance = không có SPOF | Chúng có thể cùng một AZ, cùng cert, cùng DNS |
| Fail closed luôn an toàn hơn | Nó có thể tự gây downtime |
| Microservices tăng độ tin cậy | Chúng nhân số phụ thuộc lên |
| Hệ thống trở lại là xong | Hàng tồn, cache lạnh, reconnect storm |
| Suy giảm là thất bại | Nó là thành công có kiểm soát |
| Chúng ta chưa gặp sự cố nên thiết kế ổn | Bạn chưa gặp điều kiện gây ra nó |

## Debugging

1. **Trong sự cố: giảm thiểu trước, hiểu sau** — rollback, tắt flag, chuyển traffic.
2. **Xác định phạm vi**: một tenant, một region, một endpoint, hay toàn bộ?
3. **Cái gì đã thay đổi?** Deploy, flag, cấu hình, lưu lượng, dependency.
4. **Chậm hay lỗi?** Chậm chỉ tới cạn tài nguyên; lỗi chỉ tới dependency hoặc bug.
5. **Kiểm tra tài nguyên dùng chung**: pool, thread, hàng đợi, bộ nhớ, file descriptor.
6. **Tìm khuếch đại**: tỉ lệ retry, số lời gọi phụ trợ mỗi request, hàng đợi có phình không.
7. **Sau khi phục hồi**: kiểm tra hàng tồn, dữ liệu không nhất quán, cache lạnh.
8. **Postmortem**: điều kiện nào cho phép lỗi lan? lớp nào lẽ ra phải chặn? tín hiệu nào lẽ ra phải phát hiện sớm hơn?

## Production Considerations

- **Timeout ở mọi lời gọi ra ngoài**, xếp thứ tự từ ngoài vào trong.
- **Phân loại mọi dependency** bắt buộc/không bắt buộc, viết ra, và giảm số bắt buộc.
- **Timeout ngắn + fallback + circuit breaker** cho mọi phụ thuộc không bắt buộc.
- **Bulkhead theo mức quan trọng** cho pool, worker, hàng đợi.
- **Jitter ở mọi nơi**: TTL, retry, cron, reconnect.
- **Chọn fail open/closed theo hậu quả** và ghi lại quyết định.
- **Tín hiệu suy giảm rõ ràng** — metric và trường trong response.
- **Test phục hồi**, không chỉ test lúc hỏng.
- **Đường rollback không phụ thuộc CI** — ví dụ deploy digest cũ trực tiếp.
- **Diễn tập sự cố (game day)** định kỳ với kịch bản thật.
- **Kiểm kê SPOF** định kỳ, gồm cả DNS, cert, auth, registry.
- **Chaos engineering** ở mức phù hợp: bắt đầu bằng làm chậm một dependency trong staging.
- **Đo tỉ lệ suy giảm** như một chỉ số bình thường, không phải lỗi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Timeout ngắn | giải phóng tài nguyên nhanh | cắt cả request lẽ ra thành công |
| Timeout dài | ít cắt nhầm | giữ tài nguyên khi dependency chậm |
| Bulkhead | cô lập lỗi | tài nguyên bị phân mảnh, dùng kém hiệu quả |
| Pool dùng chung | tận dụng tối đa | một phần kéo sập tất cả |
| Fail open | giữ dịch vụ | mất kiểm soát tạm thời |
| Fail closed | an toàn | có thể tự gây downtime |
| Nhiều phụ thuộc không bắt buộc | tính năng phong phú | nhiều đường suy giảm phải test |
| Ít phụ thuộc | đơn giản, tin cậy | ít tính năng |
| Redundancy | chịu được mất một phần | chi phí, phức tạp, tải dồn |
| Chaos testing | tìm lỗi trước | rủi ro, cần chuẩn bị |

## Explain Without Notes

1. Vì sao dependency chậm nguy hiểm hơn dependency chết?
2. Bốn cách hỏng, và vì sao health check chỉ bắt được một?
3. Bốn cơ chế lan lỗi, mỗi cái một ví dụ.
4. Bulkhead là gì và phân vùng theo tiêu chí nào?
5. Tính khả dụng của service phụ thuộc 5 service 99,9%. Cách rẻ nhất cải thiện?
6. Fail open và fail closed — cho một ví dụ mỗi loại và lý do.
7. Bốn hiệu ứng đàn và biện pháp chung cho cả bốn.
8. Bốn thứ cần xử lý khi hệ thống phục hồi sau sự cố.

## Related

- [Timeout, retry & circuit breaker](02-timeout-retry-circuit-breaker.md) — cơ chế cụ thể
- [Graceful degradation](03-graceful-degradation.md) — suy giảm có kiểm soát
- [Capacity & limits](04-capacity-and-limits.md) — biết giới hạn trước khi chạm
- [Backpressure](../performance/06-backpressure.md) — hành vi khi vượt giới hạn
- [Metrics & SLO](../observability/04-metrics-slo.md) — đo độ tin cậy
- [Alerting & dashboards](../observability/05-alerting-dashboards.md) — phát hiện và runbook
- [Readiness & liveness](../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) — health check ở tầng K8s
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — rollback là biện pháp giảm thiểu số một
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — đánh đổi ở tầng kiến trúc

## Version / Context

Khái niệm bulkhead, circuit breaker, fail fast theo Michael Nygard (*Release It!*); cascading failure và thundering herd theo Google SRE Book. Ví dụ dùng NestJS 10/11 và Node.js 20+. Chaos engineering theo nguyên tắc của Netflix (bắt đầu ở môi trường không phải production, có giả thuyết rõ ràng, có nút dừng).
