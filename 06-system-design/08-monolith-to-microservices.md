---
level: advanced
area: system-design
prerequisites:
  - 07-event-driven.md
related:
  - ../02-backend-api/04-architecture/02-modular-monolith.md
  - 09-distributed-systems-fallacies.md
---

# Monolith → microservices

> Một team 12 người tách monolith thành 9 microservice trong tám tháng. Sau đó, mỗi tính năng mới đụng trung bình 4 service, mỗi lần triển khai cần phối hợp giữa 3 team, và một truy vấn "danh sách đơn hàng kèm tên khách và trạng thái giao" trở thành 3 lời gọi mạng phải gộp ở tầng ứng dụng. Họ gộp 9 service về 4 trong năm tiếp theo. **Vấn đề không phải microservices — mà là ranh giới được vẽ theo TẦNG KỸ THUẬT thay vì theo NGHIỆP VỤ.**

## Position

```text
Monolith rối        →  MODULAR MONOLITH  →  tách vài service  →  microservices
     ↑                        ↑                    ↑
  vấn đề thật        đích đến của HẦU HẾT     chỉ khi có lý do cụ thể
                          dự án
```

## Problem

```text
Microservices giải quyết một vấn đề rất cụ thể:
  NHIỀU TEAM cần TRIỂN KHAI ĐỘC LẬP mà không chờ nhau.

Nó KHÔNG giải quyết:
  · code lộn xộn          → tách ra chỉ tạo code lộn xộn phân tán
  · hiệu năng              → mạng chậm hơn lời gọi hàm hàng nghìn lần
  · khả năng mở rộng       → phần lớn hệ thống mở rộng tốt dưới dạng monolith
  · "kiến trúc hiện đại"   → không phải một yêu cầu

Và nó THÊM:
  mạng · nhất quán phân tán · vận hành N dịch vụ · debug xuyên service
  · hợp đồng API · quản lý phiên bản · triển khai phối hợp
```

## Mental Model

### Modular monolith: đích đến bị bỏ quên

```text
Phần lớn lợi ích của microservices đến từ RANH GIỚI RÕ RÀNG,
không phải từ việc triển khai riêng.

Modular monolith có:
  ✓ ranh giới module rõ, giao tiếp qua interface công khai
  ✓ mỗi module sở hữu bảng của nó — module khác KHÔNG đọc trực tiếp
  ✓ đội có thể làm việc song song
  ✗ nhưng triển khai CHUNG

Nó KHÔNG có:
  · mạng giữa các module        · nhất quán phân tán
  · N pipeline, N dashboard     · debug xuyên tiến trình
```

```text
⇒ Nếu bạn chưa có modular monolith hoạt động tốt,
  tách thành microservices sẽ tạo ra một monolith phân tán —
  tệ hơn cả hai lựa chọn.
```

Xem [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md).

### Bốn lý do hợp lệ để tách

```text
① TEAM ĐỘC LẬP
   nhiều team, cản trở nhau ở khâu triển khai
   → dấu hiệu: "chờ team kia merge xong mới deploy được"

② HỒ SƠ TÀI NGUYÊN KHÁC HẲN
   xử lý video cần 16 GB RAM và GPU; API cần 512 MB
   → nhét chung nghĩa là trả tiền cho cấu hình lớn cho mọi thứ

③ YÊU CẦU KHÁC HẲN VỀ TIN CẬY HOẶC TUÂN THỦ
   xử lý thanh toán cần cô lập, audit, và vòng đời phát hành riêng

④ NHỊP THAY ĐỔI RẤT KHÁC
   một phần đổi mỗi ngày, một phần đổi mỗi năm
```

```text
KHÔNG hợp lệ:
  · "code quá lớn"           → tách module trước
  · "cần mở rộng"            → đo đã; thường một monolith nhiều instance là đủ
  · "công ty khác làm thế"   → họ có 500 kỹ sư
  · "dễ hiểu hơn"            → 9 repo khó hiểu hơn 1 repo có cấu trúc
```

### Ranh giới đúng: theo NGHIỆP VỤ, không theo tầng

```text
✗ THEO TẦNG KỸ THUẬT — sai lầm trong sự cố ở đầu note
   api-service · business-logic-service · data-service
   → MỌI tính năng đụng cả ba
   → mọi thay đổi cần triển khai phối hợp
   → đây là monolith phân tán

✓ THEO NĂNG LỰC NGHIỆP VỤ
   Orders · Payments · Inventory · Shipping
   → một tính năng thường nằm TRONG một service
   → mỗi service sở hữu dữ liệu của nó từ đầu đến cuối
```

```text
Bài kiểm tra ranh giới:
  ① một tính năng điển hình đụng bao nhiêu service?
     1 → ranh giới tốt · 3+ → ranh giới sai
  ② hai service có cần đổi CÙNG LÚC thường xuyên không?
     có → chúng nên là một
  ③ service này có sở hữu dữ liệu của nó không, hay chỉ là lớp bọc quanh bảng?
```

### Dữ liệu là phần khó, không phải code

```text
Tách code: vài tuần. Tách dữ liệu: vài tháng.

Vấn đề xuất hiện ngay:
  · JOIN xuyên service    → không làm được → gọi nhiều lần rồi gộp ở app
  · TRANSACTION xuyên service → không có → saga và bù trừ
  · khoá ngoại xuyên service  → không có → tính toàn vẹn ở tầng ứng dụng
  · báo cáo cần dữ liệu 5 service → cần kho phân tích riêng

Quy tắc: MỘT service sở hữu MỘT tập bảng. Không service nào đọc bảng của service khác.
  → vi phạm quy tắc này = bạn vẫn có monolith, chỉ là qua mạng
```

```text
Chia sẻ database giữa các service là phản mẫu phổ biến nhất:
  nó giữ lại mọi ràng buộc của monolith
  và thêm mọi chi phí của hệ thống phân tán.
```

### Strangler fig: cách tách an toàn

```text
① Đặt một PROXY/GATEWAY trước monolith
② Xây tính năng MỚI trong service mới
③ Chuyển từng phần lưu lượng của tính năng CŨ sang service mới
④ Chạy SONG SONG và đối soát kết quả
⑤ Chuyển 100%, xoá code cũ trong monolith
⑥ Lặp lại

Mỗi bước NHỎ, ĐẢO NGƯỢC ĐƯỢC, và hệ thống luôn hoạt động.
```

```text
Ngược lại — viết lại toàn bộ ("big bang rewrite"):
  · hệ thống cũ tiếp tục thay đổi trong lúc bạn viết lại
  · không có giá trị nào được giao cho tới khi xong
  · thời điểm chuyển đổi là rủi ro tập trung
  → tỉ lệ thất bại rất cao
```

### Cái giá phải trả, cụ thể

```text
LỜI GỌI HÀM        ~10 ns · không thất bại · transaction chung · type-safe
LỜI GỌI MẠNG       ~500 μs trong DC · TIMEOUT · retry · serialize · phiên bản API
                   → chậm hơn ~50.000 lần và có thể thất bại

Với một tính năng gọi 5 service tuần tự:
  monolith:      5 lời gọi hàm ≈ vài μs
  microservices: 5 vòng khứ hồi ≈ 2,5 ms + xác suất lỗi cộng dồn
                 với mỗi service 99,9% → 99,5% khả dụng
```

```text
Và chi phí vận hành nhân lên:
  N pipeline · N dashboard · N runbook · N lần nâng cấp thư viện
  · N bộ secret · N môi trường dev · onboard người mới khó hơn nhiều
```

### Điều kiện cần trước khi tách service đầu tiên

```text
□ CI/CD tự động, triển khai được nhiều lần mỗi ngày
□ Observability xuyên service: trace, correlation id, log tập trung
□ Có thể dựng môi trường dev với nhiều service (compose hoặc tương đương)
□ Hợp đồng API có versioning và contract test
□ Đội hiểu timeout, retry, idempotency, circuit breaker
□ Có runbook và on-call cho dịch vụ mới

Thiếu bất kỳ mục nào → tách service sẽ tạo ra vấn đề bạn chưa có công cụ để xử lý.
```

### Hợp nhất cũng là một lựa chọn hợp lệ

```text
Nếu hai service:
  · luôn đổi cùng nhau
  · luôn triển khai cùng nhau
  · gọi nhau đồng bộ ở mọi request
  · thuộc cùng một team

⇒ chúng nên là MỘT. Gộp lại không phải thất bại — đó là sửa ranh giới sai.
```

Đội ngũ trong sự cố ở đầu note đi từ 9 service về 4 — và đó là quyết định đúng, không phải thừa nhận thất bại.

## Example

Tách `Payments` khỏi monolith bằng strangler fig:

```text
── BƯỚC 0: kiểm tra điều kiện ────────────────────────────
✓ CI/CD tự động  ✓ trace xuyên service  ✓ compose cho dev
✓ contract test  ✓ đội hiểu timeout/retry/idempotency

Lý do tách: thanh toán cần vòng đời phát hành riêng và audit riêng (lý do ③).
```

```text
── BƯỚC 1: tách MODULE trong monolith trước ──────────────
Trước khi tách tiến trình, tách ranh giới trong code:
  · mọi truy cập thanh toán qua `PaymentsFacade`
  · không code nào ngoài module đọc bảng `payments`
  · đếm số nơi vi phạm → sửa hết trước khi đi tiếp

Bước này thường lộ ra ranh giới THẬT khác với ranh giới bạn tưởng.
```

```ts
// ── BƯỚC 2: interface không đổi, cài đặt chuyển dần ──────
export interface PaymentsPort {
  capture(input: CaptureInput): Promise<CaptureResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

// cài đặt cũ — trong monolith
export class LocalPayments implements PaymentsPort { /* ... */ }

// cài đặt mới — gọi service, có đủ cơ chế của lời gọi mạng
export class RemotePayments implements PaymentsPort {
  async capture(input: CaptureInput): Promise<CaptureResult> {
    return this.client.call(
      (signal) => this.http.post('/payments/capture', input, {
        signal,
        headers: { 'Idempotency-Key': input.idempotencyKey },   // BẮT BUỘC qua mạng
      }),
      { timeoutMs: 5000, maxAttempts: 2, idempotent: true },
    );
  }
}
```

```ts
// ── BƯỚC 3: chạy SONG SONG và đối soát ───────────────────
export class ShadowPayments implements PaymentsPort {
  constructor(private local: LocalPayments, private remote: RemotePayments) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const result = await this.local.capture(input);          // đường THẬT vẫn là cũ

    // gọi service mới ở NỀN, chỉ để so sánh — không ảnh hưởng người dùng
    this.remote.capture({ ...input, dryRun: true })
      .then(shadow => {
        if (!deepEqual(normalize(shadow), normalize(result))) {
          shadowMismatch.inc({ operation: 'capture' });
          this.logger.warn({ input, result, shadow }, 'shadow lệch');
        }
      })
      .catch(err => shadowError.inc({ operation: 'capture' }));

    return result;
  }
}
```

```text
Chạy shadow 2–4 tuần. Chỉ chuyển khi tỉ lệ lệch ≈ 0.
Đây là bước hay bị bỏ, và nó là bước rẻ nhất để phát hiện khác biệt hành vi.
```

```ts
// ── BƯỚC 4: chuyển lưu lượng theo tỉ lệ, đảo ngược được ──
export class RoutedPayments implements PaymentsPort {
  async capture(input: CaptureInput): Promise<CaptureResult> {
    const useRemote = await this.flags.isEnabled('payments.remote', {
      percentage: true, key: input.orderId,     // ổn định theo đơn hàng
    });
    return useRemote ? this.remote.capture(input) : this.local.capture(input);
  }
}
// 1% → 10% → 50% → 100%, mỗi bước theo dõi tỉ lệ lỗi và độ trễ
// bất kỳ lúc nào cũng đưa cờ về 0 được
```

```text
── BƯỚC 5: tách DỮ LIỆU ─────────────────────────────────
Phần khó nhất, làm SAU khi lưu lượng đã ổn định ở service mới:
  ① service mới ghi vào database RIÊNG, đồng bộ ngược về monolith qua outbox
  ② monolith ngừng ghi bảng payments; chỉ đọc bản sao đồng bộ
  ③ mọi truy vấn của monolith cần dữ liệu payments → gọi API
  ④ xoá bảng payments khỏi monolith

Ở bước ③, mọi JOIN với bảng payments phải được viết lại.
Đây là lúc bạn biết ranh giới có đúng không: nếu có 40 chỗ join, ranh giới sai.
```

## Prediction

1. Tách theo tầng (api / logic / data), thêm một tính năng — đụng bao nhiêu service?
2. Tách theo nghiệp vụ (Orders / Payments), thêm một tính năng — đụng bao nhiêu?
3. Hai service luôn deploy cùng nhau — chúng nên là một hay hai?
4. Hai service chia sẻ database — bạn có microservices không?
5. Lời gọi hàm ~10ns so với lời gọi mạng ~500μs — chậm hơn bao nhiêu lần?
6. Tính năng gọi 5 service, mỗi cái 99,9% — khả dụng tổng?
7. Big bang rewrite trong 8 tháng, hệ thống cũ vẫn thay đổi — chuyện gì xảy ra?
8. Strangler fig, mỗi bước nhỏ — rủi ro thế nào?
9. Chuyển 100% lưu lượng sang service mới ngay, không shadow — bạn biết nó đúng không?
10. Chạy shadow 3 tuần, tỉ lệ lệch 0 — bạn biết gì?
11. Tách service mà không có trace xuyên service — debug một lỗi mất bao lâu?
12. Tách code trước hay tách dữ liệu trước?
13. Sau khi tách, phát hiện 40 chỗ cần join xuyên service — điều đó nói gì về ranh giới?
14. Gộp 9 service về 4 — đó là thất bại hay sửa lỗi?

<details>
<summary>Đáp án</summary>

1. **Cả ba** — mọi tính năng cắt ngang mọi tầng.
2. **Thường một** — đó là mục đích của ranh giới nghiệp vụ.
3. **Một** — chúng không độc lập về triển khai.
4. **Không** — bạn có monolith phân tán với mọi chi phí và không lợi ích nào.
5. Khoảng **50.000 lần**.
6. `0,999⁵ ≈ 99,5%` — từ 43 phút xuống 3,6 giờ downtime/tháng.
7. Bạn **đuổi theo mục tiêu di động**; thường không bao giờ hoàn thành.
8. Thấp — mỗi bước **đảo ngược được**, hệ thống luôn chạy.
9. **Không** — bạn phát hiện khác biệt qua sự cố ở production.
10. Hành vi của hai cài đặt **khớp nhau trên dữ liệu thật**.
11. Rất lâu — phải ghép log thủ công từ nhiều service.
12. **Code trước** (tách module), dữ liệu sau — và dữ liệu là phần khó.
13. **Ranh giới sai** — hai phần đó thuộc về nhau.
14. **Sửa lỗi** — ranh giới sai được sửa lại.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm số service một tính năng điển hình đụng tới | 1 hay 3+? |
| Xem lịch sử git: hai service nào hay đổi cùng nhau? | Chúng nên là một |
| Tìm service đọc bảng của service khác | Có bao nhiêu? |
| Đo độ trễ một request đi qua N service | So với monolith? |
| Tính khả dụng tổng từ khả dụng từng service | Bao nhiêu? |
| Giết một service và xem tính năng nào hỏng | Đúng như thiết kế không? |
| Debug một lỗi xuyên 3 service | Mất bao lâu? Có trace không? |
| Dựng môi trường dev đầy đủ | Mất bao lâu? Có làm được không? |
| Đếm số pipeline, dashboard, runbook | Ai duy trì chúng? |
| Thử nâng cấp một thư viện chung | Phải sửa bao nhiêu repo? |

## What Usually Goes Wrong

- **Tách theo tầng kỹ thuật** → monolith phân tán.
- **Chia sẻ database** → mọi chi phí, không lợi ích.
- **Tách trước khi có modular monolith hoạt động tốt.**
- **Tách vì "code lộn xộn"** → code lộn xộn phân tán.
- **Big bang rewrite** thay vì strangler fig.
- **Không chạy shadow** → phát hiện khác biệt ở production.
- **Không có trace xuyên service** → debug bằng cách ghép log thủ công.
- **Tách dữ liệu trước khi ổn định ranh giới code.**
- **Không dùng idempotency key** cho lời gọi qua mạng.
- **Không có timeout/retry/circuit breaker** giữa các service.
- **Không có contract test** → thay đổi API phá vỡ consumer.
- **Đánh giá thấp chi phí vận hành** N service.
- **Coi việc gộp service lại là thất bại** → giữ ranh giới sai mãi.
- **Không đo** — không biết tách có cải thiện gì không.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Microservices là kiến trúc trưởng thành | Nó là đánh đổi cho vấn đề tổ chức cụ thể |
| Nó giúp mở rộng | Monolith nhiều instance mở rộng tốt |
| Nó làm code sạch hơn | Ranh giới làm code sạch; mạng thì không |
| Service nhỏ hơn thì tốt hơn | Kích thước đúng là "một team sở hữu được" |
| Chia sẻ DB là bước trung gian ổn | Nó là phản mẫu, giữ lại mọi ràng buộc |
| Tách code là phần khó | Tách dữ liệu khó hơn nhiều |
| Có thể tách rồi sửa ranh giới sau | Sửa ranh giới sau khi tách dữ liệu rất đắt |
| Gộp service lại là thừa nhận thất bại | Đó là sửa ranh giới sai |
| Microservices tăng tốc độ phát triển | Chỉ khi trước đó bị chặn bởi phối hợp |
| Mỗi team nên có nhiều service | Mỗi service nên có đúng một team |

## Debugging

1. **Đo trước khi tách**: một tính năng điển hình đụng bao nhiêu module? Team có thực sự bị chặn bởi nhau không?
2. **Kiểm tra ranh giới bằng git**: hai phần nào hay thay đổi trong cùng commit? Chúng thuộc về nhau.
3. **Tìm vi phạm quyền sở hữu dữ liệu**: service nào đọc bảng của service khác?
4. **Sau khi tách, độ trễ tăng** → đếm số lời gọi mạng tuần tự trong một request; có gộp được không?
5. **Lỗi lan giữa các service** → có timeout, circuit breaker, bulkhead không?
6. **Debug chậm** → có trace và correlation id xuyên service không?
7. **Thay đổi API phá vỡ consumer** → có contract test không? Có versioning không?
8. **Cân nhắc gộp lại** khi hai service luôn đổi và triển khai cùng nhau — đó là dữ liệu, không phải cảm giác.

## Production Considerations

- **Modular monolith trước**; chỉ tách khi có một trong bốn lý do hợp lệ.
- **Ranh giới theo năng lực nghiệp vụ**, không theo tầng kỹ thuật.
- **Một service sở hữu dữ liệu của nó**; không service nào đọc bảng của service khác.
- **Kiểm tra đủ điều kiện** (CI/CD, trace, contract test, kỹ năng) trước service đầu tiên.
- **Strangler fig**, mỗi bước nhỏ và đảo ngược được.
- **Chạy shadow và đối soát** trước khi chuyển lưu lượng.
- **Chuyển theo tỉ lệ với feature flag**, ổn định theo khoá thực thể.
- **Idempotency key, timeout, retry có ngân sách, circuit breaker** cho mọi lời gọi qua mạng.
- **Contract test + versioning** cho mọi API giữa service.
- **Trace và correlation id** bắt buộc từ ngày đầu.
- **Môi trường dev dựng được** với nhiều service.
- **Đo trước và sau khi tách**: độ trễ, khả dụng, tần suất triển khai, thời gian dẫn.
- **Sẵn sàng gộp lại** khi dữ liệu cho thấy ranh giới sai.
- **Kho phân tích riêng** cho báo cáo cần dữ liệu nhiều service.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Monolith | đơn giản, transaction, debug dễ | phối hợp triển khai khi đội lớn |
| Modular monolith | ranh giới rõ, vẫn đơn giản | vẫn triển khai chung |
| Microservices | team độc lập, scale riêng, cô lập lỗi | mạng, vận hành, nhất quán phân tán |
| Ranh giới theo nghiệp vụ | tính năng nằm trong một service | cần hiểu nghiệp vụ sâu |
| Ranh giới theo tầng | dễ vẽ | mọi tính năng cắt ngang mọi service |
| Chia sẻ DB | tách nhanh hơn | không phải microservices thật |
| DB riêng mỗi service | tự chủ thật | mất join và transaction |
| Strangler fig | rủi ro thấp, đảo ngược được | chậm, phải duy trì hai đường |
| Big bang rewrite | "sạch" | rủi ro rất cao |
| Shadow run | phát hiện khác biệt sớm | tốn tài nguyên, code tạm |

## Explain Without Notes

1. Microservices giải quyết vấn đề gì, và ba vấn đề nó **không** giải quyết?
2. Modular monolith có gì và không có gì so với microservices?
3. Bốn lý do hợp lệ để tách, và bốn lý do không hợp lệ?
4. Ba câu hỏi kiểm tra ranh giới?
5. Vì sao tách theo tầng kỹ thuật tạo ra monolith phân tán?
6. Sáu bước của strangler fig, và vì sao nó an toàn hơn viết lại?
7. Vì sao chia sẻ database giữa các service là phản mẫu?
8. Khi nào nên gộp hai service lại?

## Related

- [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md) — đích đến của hầu hết dự án
- [Event-driven](07-event-driven.md) — giao tiếp bất đồng bộ giữa service
- [Distributed systems fallacies](09-distributed-systems-fallacies.md) — giả định sai khi tách
- [Consistency & availability](04-consistency-availability.md) — mất transaction xuyên service
- [Requirements & trade-offs](01-requirements-tradeoffs.md) — microservices là giải pháp, không phải yêu cầu
- [Contract testing](../05-cross-cutting/testing/07-contract-testing.md) — hợp đồng giữa service
- [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — bắt buộc khi có mạng
- [Correlation & tracing](../05-cross-cutting/observability/03-correlation-tracing.md) — debug xuyên service
- [Domain logic boundaries](../02-backend-api/04-architecture/03-domain-logic-boundaries.md) — ranh giới trong code
- [Deployment strategies](../04-infrastructure/03-cicd/03-deployment-strategies.md) — triển khai độc lập

## Version / Context

Strangler fig pattern theo Martin Fowler. "Kích thước service đúng là một team sở hữu được" phản ánh Team Topologies (Skelton & Pais) và luật Conway. Ví dụ dùng NestJS 10/11 và PostgreSQL 16. Nội dung tập trung vào quyết định kiến trúc, không phụ thuộc nền tảng triển khai cụ thể.
