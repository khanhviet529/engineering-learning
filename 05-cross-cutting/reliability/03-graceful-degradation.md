---
level: advanced
area: cross-cutting
prerequisites:
  - 02-timeout-retry-circuit-breaker.md
related:
  - 04-capacity-and-limits.md
  - ../performance/06-backpressure.md
---

# Graceful degradation

> Dịch vụ tính phí vận chuyển ngừng phản hồi. Trang checkout hiển thị lỗi 500 và không cho đặt hàng. Trong 40 phút đó, cửa hàng mất toàn bộ doanh thu. Điều đáng chú ý: 92% đơn hàng dùng phương thức vận chuyển tiêu chuẩn với mức phí **cố định** đã biết. Hệ thống có đủ thông tin để hoàn tất 92% đơn — nó chỉ chưa bao giờ được thiết kế để làm điều đó khi thiếu một thành phần.

## Position

```text
Hỏng hoàn toàn    ────────────────────────────  hoạt động đầy đủ
      ↑                     ↑                            ↑
   mặc định        SUY GIẢM CÓ KIỂM SOÁT           đường thành công
                   ↑ vùng này phải được THIẾT KẾ,
                     nó không tự xuất hiện
```

## Problem

```text
Phần lớn hệ thống có đúng HAI trạng thái: hoạt động hoặc lỗi.
Nhưng thực tế hiếm khi nhị phân:
  · một dependency chậm, các cái khác ổn
  · một region hỏng
  · tải gấp 5, tài nguyên đủ cho 2

⇒ Nếu không có trạng thái trung gian, mọi sự cố nhỏ thành sự cố toàn phần.
```

## Mental Model

### Phân tầng tính năng theo giá trị

```text
Với mỗi tính năng, hỏi: "nếu nó biến mất trong một giờ, mất gì?"

TẦNG 0 — SỐNG CÒN        không có thì không còn sản phẩm
                          đăng nhập · checkout · thanh toán · đọc dữ liệu chính
TẦNG 1 — QUAN TRỌNG      mất thì khó chịu nhưng dùng được
                          tìm kiếm · lọc · thông báo
TẦNG 2 — BỔ TRỢ          mất thì hầu như không ai để ý
                          gợi ý · "người khác cũng xem" · analytics · badge

Quy tắc: tầng 2 KHÔNG BAO GIỜ được làm hỏng tầng 0.
```

Việc phân tầng này phải làm **trước** khi có sự cố. Trong sự cố, không ai đủ bình tĩnh để tranh luận tính năng nào quan trọng hơn.

### Bốn cách suy giảm

```text
① BỎ TÍNH NĂNG        ẩn phần gợi ý, tắt tìm kiếm nâng cao
② DỮ LIỆU CŨ          trả kết quả cache dù đã hết hạn (stale-if-error)
③ CHẤT LƯỢNG THẤP HƠN ảnh độ phân giải thấp · kết quả gần đúng · ít mục hơn
④ GIÁ TRỊ MẶC ĐỊNH    phí vận chuyển cố định · gợi ý mặc định · giá niêm yết
```

```text
Sự cố ở đầu note là ④: phí vận chuyển mặc định cho phương thức tiêu chuẩn
+ ghi nhận để tính lại sau, thay vì chặn toàn bộ đơn hàng.
```

### Dữ liệu cũ tốt hơn không có dữ liệu — nhưng không phải luôn

```text
✓ CHẤP NHẬN ĐƯỢC cũ:  danh mục sản phẩm · bài viết · cấu hình · gợi ý
                       số liệu tổng hợp · danh sách bạn bè

✗ KHÔNG chấp nhận:     số dư tài khoản · tồn kho lúc thanh toán
                       · quyền truy cập · giá đang khuyến mãi có hạn

⇒ quyết định theo từng loại dữ liệu, không theo mặc định toàn hệ thống
⇒ và LUÔN cho người dùng biết dữ liệu đã cũ ("cập nhật 5 phút trước")
```

```text
Kỹ thuật: stale-while-revalidate và stale-if-error
  cache lưu cả sau khi hết hạn
  hết hạn + nguồn khoẻ  → trả cũ, làm mới nền
  hết hạn + nguồn hỏng  → trả cũ, ghi nhận suy giảm
```

### Suy giảm phải RÕ RÀNG, không im lặng

```text
Suy giảm im lặng là chế độ hỏng tệ thứ hai sau sập:
  · người dùng thấy dữ liệu sai mà tưởng đúng
  · đội ngũ không biết hệ thống đang chạy thiếu tính năng
  · nó có thể kéo dài NHIỀU NGÀY

Ba nơi phải thể hiện:
  ① người dùng: "một số thông tin có thể chưa cập nhật"
  ② response:   trường `degraded: [...]`
  ③ metric:     đếm theo tính năng và lý do → có alert khi vượt ngưỡng
```

### Feature flag: công tắc phải có trước sự cố

```text
Mỗi tính năng tầng 1 và 2 nên có công tắc tắt được KHÔNG CẦN DEPLOY.

Yêu cầu của công tắc dùng được trong sự cố:
  · tắt trong vài giây, không qua CI
  · KHÔNG phụ thuộc hệ thống đang hỏng   ← quan trọng nhất
  · có giá trị mặc định an toàn khi không đọc được cấu hình
  · ai đang trực cũng biết dùng
```

```text
Nghịch lý hay gặp: feature flag service cũng hỏng trong sự cố.
→ cache giá trị flag cục bộ với TTL dài
→ mặc định an toàn khi không đọc được (thường: giữ trạng thái cuối cùng đã biết)
```

### Suy giảm theo tải, không chỉ theo lỗi

```text
Dependency vẫn khoẻ nhưng TẢI gấp 5:

  mức 0 (bình thường)   mọi tính năng
  mức 1 (tải cao)       tắt tầng 2 · tăng TTL cache · giảm số mục trả về
  mức 2 (rất cao)       tắt tầng 1 · chỉ phục vụ từ cache
  mức 3 (quá tải)       chỉ tầng 0 · shed load phần vượt

Chuyển mức TỰ ĐỘNG theo tín hiệu: event loop lag, độ sâu hàng đợi, tỉ lệ lỗi.
```

Điểm quan trọng: chuyển mức phải **có trễ (hysteresis)** — vào mức cao nhanh, ra khỏi mức cao chậm. Nếu không, hệ thống dao động qua lại giữa hai mức.

### Suy giảm ghi khó hơn suy giảm đọc

```text
ĐỌC:  fallback sang cache, giá trị mặc định, dữ liệu cũ    → tương đối dễ

GHI:  không thể "trả về giá trị cũ" cho một thao tác ghi
      → NHẬN và XỬ LÝ SAU (queue) — nếu nghiệp vụ chấp nhận
      → GHI VÀO STORE DỰ PHÒNG rồi đồng bộ lại
      → hoặc TỪ CHỐI rõ ràng với thông báo dùng được

Nguy hiểm: nhận thao tác ghi mà KHÔNG THỂ hoàn tất
  → người dùng tưởng xong → dữ liệu không nhất quán
  → tệ hơn nhiều so với từ chối thẳng
```

Quy tắc: chỉ nhận-và-xử-lý-sau khi bạn **thực sự đảm bảo** xử lý được (durable queue, có DLQ, có theo dõi), và khi nghiệp vụ chấp nhận độ trễ đó.

### Phục hồi: quay lại cũng cần thiết kế

```text
Dependency trở lại:
  · cache lạnh → đợt tăng tải lớn        → làm nóng dần, không mở toàn bộ ngay
  · hàng tồn                              → bỏ việc đã quá cũ
  · dữ liệu ghi trong lúc suy giảm        → có cần đối soát không?
  · circuit breaker                       → half-open cho vài lời gọi trước

⇒ Bật lại tính năng TỪ TỪ (theo tỉ lệ phần trăm), không bật 100% một lúc.
```

## Example

Checkout hoạt động khi dịch vụ vận chuyển chết:

```ts
const SHIPPING_DEFAULTS = {
  standard: { cents: 5_000, days: 5 },
  express:  null,                        // không có mặc định an toàn → phải từ chối
};

async function getShippingOptions(cart: Cart, address: Address) {
  try {
    const quotes = await this.shipping.quote(cart, address, { timeoutMs: 800 });
    return { options: quotes, degraded: false };
  } catch (err) {
    shippingDegraded.inc({ reason: kindOf(err) });
    this.logger.warn({ err, cartId: cart.id }, 'shipping quote unavailable — dùng mặc định');

    // ① chỉ đưa ra phương thức CÓ mặc định an toàn
    return {
      options: [{
        method: 'standard',
        ...SHIPPING_DEFAULTS.standard,
        estimated: true,                              // ② đánh dấu là ước tính
      }],
      degraded: true,
      message: 'Phí vận chuyển là ước tính. Chúng tôi sẽ xác nhận qua email.',
    };
  }
}
```

```ts
// ③ đơn hàng ghi nhận rằng phí là ước tính → đối soát sau
async createOrder(cart: Cart, shipping: ShippingSelection) {
  const order = await this.orders.create({
    ...cart,
    shippingCents: shipping.cents,
    shippingEstimated: shipping.estimated,            // ← cờ để job đối soát tìm lại
  });

  if (shipping.estimated) {
    await this.reconcileQueue.add('recalculate-shipping', { orderId: order.id },
      { delay: 5 * 60_000, attempts: 10, backoff: { type: 'exponential', delay: 60_000 } });
  }
  return order;
}
```

Cờ `shippingEstimated` là phần biến suy giảm thành **an toàn**: hệ thống không giả vờ con số là chính xác, nó ghi nhận sự không chắc chắn và có kế hoạch giải quyết.

Và mức suy giảm tự động theo tải:

```ts
type Level = 0 | 1 | 2 | 3;

class DegradationController {
  private level: Level = 0;
  private lastChange = Date.now();

  update(signals: { eventLoopLagMs: number; errorRate: number; queueDepth: number }) {
    const target = this.computeLevel(signals);

    // hysteresis: LÊN ngay, XUỐNG phải chờ 60 giây ổn định
    if (target > this.level) {
      this.setLevel(target);
    } else if (target < this.level && Date.now() - this.lastChange > 60_000) {
      this.setLevel((this.level - 1) as Level);       // xuống TỪNG BẬC, không nhảy về 0
    }
  }

  private computeLevel(s: { eventLoopLagMs: number; errorRate: number; queueDepth: number }): Level {
    if (s.eventLoopLagMs > 500 || s.errorRate > 0.20) return 3;
    if (s.eventLoopLagMs > 200 || s.errorRate > 0.10) return 2;
    if (s.eventLoopLagMs > 80  || s.errorRate > 0.03) return 1;
    return 0;
  }

  isEnabled(tier: 0 | 1 | 2): boolean {
    if (tier === 0) return true;                      // tầng 0 KHÔNG BAO GIỜ bị tắt
    if (tier === 1) return this.level < 2;
    return this.level < 1;
  }

  private setLevel(l: Level) {
    this.level = l; this.lastChange = Date.now();
    degradationLevel.set(l);                          // metric → alert → runbook
    this.logger.warn({ level: l }, 'degradation level changed');
  }
}
```

Hai chi tiết: **xuống từng bậc** (không nhảy thẳng về 0) và **60 giây ổn định** trước khi xuống. Không có chúng, hệ thống dao động: tắt tính năng → tải giảm → bật lại → tải tăng → tắt.

## Prediction

1. Dịch vụ vận chuyển chết, checkout trả 500 — mất bao nhiêu phần trăm doanh thu?
2. Có giá trị mặc định cho phương thức tiêu chuẩn — mất bao nhiêu?
3. Hiển thị dữ liệu cache đã cũ mà không báo — người dùng nghĩ gì?
4. Có nhãn "cập nhật 5 phút trước" — người dùng nghĩ gì?
5. Suy giảm không có metric, kéo dài 3 ngày — ai biết?
6. Feature flag service phụ thuộc vào chính hệ thống đang hỏng — tắt tính năng được không?
7. Flag được cache cục bộ với TTL dài — tắt được không?
8. Chuyển mức suy giảm không có hysteresis — hành vi thế nào?
9. Có hysteresis 60 giây — thế nào?
10. Nhận thao tác ghi vào hàng đợi nhưng không đảm bảo xử lý được — hậu quả?
11. Từ chối thẳng với thông báo rõ ràng — hậu quả?
12. Dependency trở lại, bật 100% tính năng ngay, cache trống — chuyện gì xảy ra?
13. Bật dần theo tỉ lệ — chuyện gì xảy ra?
14. Trả dữ liệu cũ cho số dư tài khoản — vấn đề gì?

<details>
<summary>Đáp án</summary>

1. **100%** — không ai đặt được hàng.
2. Khoảng **8%** — phần dùng phương thức không có mặc định.
3. Rằng **dữ liệu đó đúng** — và ra quyết định sai dựa trên nó.
4. Họ **biết mức tin cậy** và có thể tự làm mới.
5. **Không ai** — đây là chế độ hỏng im lặng.
6. **Không** — nghịch lý phổ biến.
7. **Có** — với giá trị cũ nhưng dùng được.
8. **Dao động** liên tục giữa hai mức.
9. Ổn định; ra khỏi mức cao có kiểm soát.
10. Người dùng tưởng xong nhưng **thao tác không bao giờ hoàn tất** — tệ hơn từ chối.
11. Người dùng biết và **thử lại sau** — trạng thái nhất quán.
12. **Đợt tăng tải** lên dependency vừa phục hồi → có thể sập lại.
13. Nó **ấm dần** và chịu được.
14. Người dùng có thể **chi tiêu dựa trên số sai** — loại dữ liệu này không được cũ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Giết một dependency tầng 2 | Tầng 0 có bị ảnh hưởng không? |
| Giết dependency tầng 1 | Người dùng thấy gì? |
| Liệt kê tính năng và phân tầng | Có ai từng làm việc này chưa? |
| Tắt một tính năng bằng flag | Mất bao lâu? Cần deploy không? |
| Giết feature flag service | Còn tắt được tính năng khác không? |
| Tăng tải gấp 5 | Hệ thống có tự suy giảm không? |
| Giảm tải về bình thường | Có dao động không? |
| Xem response khi đang suy giảm | Có trường `degraded` không? |
| Kiểm tra metric suy giảm | Có alert không? |
| Bật lại dependency với cache trống | Đợt tăng tải bao nhiêu? |
| Tìm nơi trả dữ liệu cũ | Loại dữ liệu nào? Có được phép cũ không? |

## What Usually Goes Wrong

- **Chỉ có hai trạng thái**: hoạt động hoặc lỗi.
- **Không phân tầng tính năng** trước sự cố.
- **Tính năng tầng 2 làm hỏng tầng 0.**
- **Suy giảm im lặng** — không có tín hiệu ở cả ba nơi.
- **Không có feature flag**, hoặc flag cần deploy để đổi.
- **Flag phụ thuộc hệ thống đang hỏng.**
- **Trả dữ liệu cũ cho loại dữ liệu không được cũ.**
- **Nhận thao tác ghi mà không đảm bảo hoàn tất.**
- **Không có hysteresis** → dao động giữa các mức.
- **Bật lại 100% ngay** sau khi dependency phục hồi.
- **Không đối soát** dữ liệu tạo ra trong lúc suy giảm.
- **Chưa bao giờ test đường suy giảm** → nó tự nó có bug.
- **Suy giảm chỉ phản ứng với lỗi**, không phản ứng với tải.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Suy giảm là thất bại | Nó là thành công có kiểm soát |
| Dữ liệu cũ luôn tốt hơn không có | Không phải với số dư, tồn kho, quyền |
| Người dùng không nhận ra suy giảm | Họ nhận ra và mất niềm tin nếu bị giấu |
| Feature flag là công cụ cho A/B test | Nó cũng là công cụ vận hành sự cố |
| Suy giảm chỉ liên quan tới lỗi | Tải cao cũng cần suy giảm |
| Có fallback là đủ | Fallback không được test là fallback không tồn tại |
| Nhận ghi rồi xử lý sau luôn an toàn | Chỉ khi thực sự đảm bảo xử lý được |
| Phục hồi là tự động | Cache lạnh và hàng tồn cần xử lý |
| Suy giảm làm sản phẩm trông kém | Trang trắng trông kém hơn nhiều |
| Có thể quyết định lúc sự cố | Không ai đủ bình tĩnh để tranh luận lúc đó |

## Debugging

1. **Đang suy giảm hay đang hỏng?** — kiểm tra metric mức suy giảm và tỉ lệ fallback theo tính năng.
2. **Tính năng nào đang tắt và vì sao** — dashboard phải trả lời được trong 10 giây.
3. **Suy giảm kéo dài bất thường** → dependency chưa phục hồi, hay circuit breaker kẹt ở OPEN?
4. **Dao động giữa các mức** → thiếu hysteresis hoặc ngưỡng quá sát nhau.
5. **Người dùng báo dữ liệu sai** → có phải fallback đang trả dữ liệu cũ mà không báo?
6. **Sau khi phục hồi** → còn dữ liệu nào cần đối soát? Job đối soát có chạy không?
7. **Fallback không hoạt động** → nó có được test bao giờ chưa? Chạy thử trong staging.
8. **Postmortem**: tính năng nào lẽ ra có thể suy giảm thay vì hỏng? Đó là danh sách việc.

## Production Considerations

- **Phân tầng mọi tính năng** và ghi vào tài liệu, làm trước sự cố.
- **Tầng 0 không phụ thuộc tầng 1 và 2** — kiểm chứng bằng cách giết chúng.
- **Fallback cho mọi phụ thuộc không bắt buộc**: mặc định, cache cũ, hoặc ẩn.
- **Feature flag cho tầng 1 và 2**, đổi được trong vài giây, không phụ thuộc hệ thống chính.
- **Cache flag cục bộ** với mặc định an toàn.
- **Tín hiệu suy giảm ở ba nơi**: người dùng, response, metric.
- **Alert khi tỉ lệ suy giảm vượt ngưỡng** — không alert khi nó khác 0.
- **Mức suy giảm tự động theo tải** với hysteresis.
- **Không nhận ghi mà không đảm bảo hoàn tất**; ưu tiên từ chối rõ ràng.
- **Đối soát dữ liệu tạo ra trong lúc suy giảm** — job riêng, có theo dõi.
- **Bật lại từ từ** sau khi phục hồi.
- **Test đường suy giảm trong CI** — nó là code, nó có bug.
- **Diễn tập**: giết một dependency trong staging và xem hệ thống có suy giảm như thiết kế không.
- **Runbook ghi rõ tắt gì trước** khi cần giảm tải khẩn cấp.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Suy giảm | giữ được phần lớn giá trị | phức tạp, nhiều đường code phải test |
| Fail toàn bộ | đơn giản, nhất quán | mất tất cả khi mất một phần |
| Dữ liệu cũ | vẫn phục vụ được | có thể sai, cần cảnh báo người dùng |
| Từ chối khi không chắc | luôn đúng | mất doanh thu/trải nghiệm |
| Giá trị mặc định | hoàn tất được luồng | cần đối soát sau |
| Nhận ghi, xử lý sau | UX mượt | rủi ro nếu không hoàn tất được |
| Từ chối ghi | trạng thái nhất quán | người dùng phải làm lại |
| Suy giảm tự động | phản ứng nhanh | có thể tắt nhầm lúc nhiễu |
| Suy giảm thủ công | kiểm soát | chậm, phụ thuộc người trực |
| Nhiều feature flag | linh hoạt | tổ hợp trạng thái khó test |

## Explain Without Notes

1. Ba tầng tính năng và quy tắc giữa chúng?
2. Bốn cách suy giảm, mỗi cách một ví dụ.
3. Khi nào dữ liệu cũ chấp nhận được, khi nào không?
4. Vì sao suy giảm im lặng là chế độ hỏng tệ thứ hai?
5. Ba yêu cầu của một feature flag dùng được trong sự cố?
6. Vì sao chuyển mức suy giảm cần hysteresis?
7. Vì sao suy giảm cho thao tác ghi khó hơn cho đọc?
8. Bốn thứ cần xử lý khi bật lại tính năng sau sự cố?

## Related

- [Failure modes](01-failure-modes.md) — phụ thuộc bắt buộc và không bắt buộc
- [Timeout, retry & circuit breaker](02-timeout-retry-circuit-breaker.md) — cơ chế kích hoạt suy giảm
- [Capacity & limits](04-capacity-and-limits.md) — suy giảm theo tải
- [Backpressure](../performance/06-backpressure.md) — shed load ở mức cao nhất
- [Cache patterns](../../03-database/02-redis/03-cache-patterns.md) — stale-while-revalidate
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — dữ liệu cũ có kiểm soát
- [Alerting & dashboards](../observability/05-alerting-dashboards.md) — runbook và giảm thiểu
- [Deployment strategies](../../04-infrastructure/03-cicd/03-deployment-strategies.md) — feature flag và rollout dần
- [Consistency & availability](../../06-system-design/04-consistency-availability.md) — đánh đổi nền tảng

## Version / Context

Ví dụ dùng NestJS 10/11, BullMQ, Node.js 20+. `stale-while-revalidate` và `stale-if-error` là chỉ thị Cache-Control theo RFC 5861. Khái niệm phân tầng tính năng và suy giảm theo tải phổ biến trong thực hành SRE; hysteresis là kỹ thuật điều khiển cơ bản áp dụng lại cho việc chuyển mức.
