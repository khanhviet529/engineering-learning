---
level: advanced
area: cross-cutting
prerequisites:
  - 01-failure-modes.md
related:
  - 03-graceful-degradation.md
  - ../../06-system-design/03-idempotency-retry.md
---

# Timeout, retry & circuit breaker

> Cổng thanh toán bị chậm trong 90 giây. Client của nó retry 3 lần, mỗi lần timeout 30 giây. Kết quả: mỗi request của người dùng giữ một worker trong 90 giây, và cổng thanh toán nhận **gấp ba** lưu lượng đúng lúc nó đang quá tải. Khi mọi thứ ổn định trở lại, bộ phận kế toán phát hiện 1.400 khách hàng bị **tính tiền hai lần** — request đầu đã thành công ở phía cổng, chỉ là phản hồi không kịp về.

## Position

```text
Ba cơ chế phải đi CÙNG NHAU, và theo đúng thứ tự:

  TIMEOUT          giới hạn thời gian một lần thử       → giải phóng tài nguyên
  RETRY            thử lại lỗi TẠM THỜI                  → cần idempotency
  CIRCUIT BREAKER  ngừng thử khi rõ ràng đang hỏng       → bảo vệ cả hai bên

Dùng riêng lẻ, mỗi cái đều có thể làm mọi thứ tệ hơn.
```

## Problem

```text
Không timeout   → tài nguyên bị giữ vô hạn → cạn → sập
Timeout không retry → lỗi tạm thời thành lỗi thật với người dùng
Retry không giới hạn → khuếch đại tải lên hệ thống đang hỏng
Retry không idempotency → THAO TÁC LẶP: tính tiền hai lần, gửi email hai lần
Không circuit breaker → tiếp tục gọi và chờ timeout một dịch vụ đã chết
```

Sự cố ở đầu note có cả bốn vấn đề cùng lúc.

## Mental Model

### Timeout: xếp thứ tự từ ngoài vào trong

```text
Client (trình duyệt)   30s
  └─ CDN / LB          25s
      └─ API           20s
          └─ service   10s
              └─ DB     5s

Quy tắc: timeout của tầng NGOÀI phải LỚN HƠN tầng trong.
```

```text
Nếu đảo ngược (DB 30s, API 10s):
  API bỏ cuộc lúc 10s NHƯNG truy vấn DB VẪN CHẠY tới 30s
  → giữ kết nối, giữ lock, tốn CPU cho kết quả không ai nhận
  → "orphaned work" — tải vô hình mà không metric nào của API thấy
```

Và một tính toán bị bỏ quên: **timeout tổng phải tính cả retry**.

```text
timeout 10s × 3 lần thử + backoff (1s + 2s) = 33 giây
→ vượt timeout 20s của tầng trên → tầng trên đã bỏ cuộc từ lâu

⇒ ngân sách phải chia cho TOÀN BỘ chuỗi thử, không phải mỗi lần thử.
```

### Bốn loại timeout khác nhau

```text
CONNECT     thiết lập kết nối TCP        ngắn (1–3s) — mạng hoặc host chết
TLS         bắt tay                       ngắn
REQUEST     gửi xong tới nhận byte đầu    theo p99 của dependency
TỔNG        toàn bộ, gồm cả đọc body      chặn response chảy chậm vô hạn

Nhiều thư viện chỉ cấu hình một cái và để ba cái kia mặc định — thường là VÔ HẠN.
```

```text
Chọn giá trị:  timeout ≈ p99 của dependency × 1,5–2
  quá ngắn → cắt cả request lẽ ra thành công, tạo retry không cần thiết
  quá dài  → giữ tài nguyên khi có sự cố
```

### Retry: chỉ cho lỗi tạm thời

```text
✓ RETRY ĐƯỢC
  timeout · connection reset · 502/503/504 · 429 (theo Retry-After)
  · deadlock ở DB · lỗi mạng tạm thời

✗ KHÔNG RETRY
  400 · 401 · 403 · 404 · 422   → thử lại cũng thế
  · lỗi validate                 → dữ liệu sai vẫn sai
  · 409 conflict                 → cần xử lý nghiệp vụ, không phải thử lại
```

```text
Vùng XÁM: 500
  có thể tạm thời, có thể là bug.
  → retry TỐI ĐA một lần, và chỉ khi thao tác idempotent.
```

### Backoff và jitter

```text
Không backoff:      thử lại ngay → dập tiếp hệ thống đang hỏng
Backoff tuyến tính: 1s, 2s, 3s   → vẫn dày
Exponential:        1s, 2s, 4s, 8s → giãn ra hợp lý
Exponential + JITTER: ngẫu nhiên trong khoảng → KHÔNG đồng bộ giữa các client
```

```text
Vì sao jitter là bắt buộc, không phải tuỳ chọn:
  1000 client cùng nhận lỗi lúc T
  không jitter → cả 1000 retry lúc T+1s → đột biến đồng bộ, thường TỆ HƠN lần đầu
  có jitter    → trải đều trong khoảng → hệ thống có cơ hội phục hồi
```

```ts
// full jitter — đơn giản và hiệu quả nhất trong các biến thể phổ biến
function backoffMs(attempt: number, baseMs = 200, maxMs = 20_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.random() * exp;                    // [0, exp)
}
```

### Ngân sách retry: giới hạn ở tầng hệ thống

```text
Giới hạn "3 lần mỗi request" KHÔNG đủ:
  10.000 request × 3 lần = 30.000 lời gọi tới dịch vụ đang hỏng

Ngân sách retry: tổng số retry ≤ 10% tổng số request
  → hết ngân sách thì KHÔNG retry nữa, dù request đó mới thử một lần
  → biến retry từ khuếch đại thành phần bổ sung có kiểm soát
```

Đây là biện pháp phân biệt hệ thống chịu được sự cố dependency với hệ thống làm sự cố đó tệ hơn.

### Retry cần idempotency — không có ngoại lệ

```text
Timeout KHÔNG có nghĩa là thao tác thất bại.
Nó có nghĩa là bạn KHÔNG BIẾT nó thành công hay không.

  request → server xử lý XONG → phản hồi mất trên đường về → client timeout
  → client retry → thao tác chạy LẦN HAI  ← 1.400 khách bị tính tiền hai lần
```

```text
Idempotency key: client sinh khoá duy nhất cho MỖI Ý ĐỊNH (không phải mỗi lần thử)
  → server lưu (key → kết quả)
  → thấy key đã có → trả về kết quả CŨ, không thực thi lại
```

```ts
async charge(input: ChargeInput, idempotencyKey: string) {
  const existing = await this.repo.findByKey(idempotencyKey);
  if (existing) return existing.result;                 // đã xử lý — trả kết quả cũ

  return this.db.$transaction(async (tx) => {
    // ràng buộc UNIQUE trên key là thứ THỰC SỰ chặn thao tác lặp
    // khi hai lần thử chạy ĐỒNG THỜI — kiểm tra ở trên chỉ là tối ưu
    await tx.idempotencyKey.create({ data: { key: idempotencyKey } });
    const result = await this.gateway.charge(input);
    await tx.idempotencyKey.update({ where: { key: idempotencyKey }, data: { result } });
    return result;
  });
}
```

Chi tiết quan trọng: **ràng buộc unique ở database** làm việc chặn, không phải câu `if` ở đầu. Hai lần thử chạy song song đều vượt qua `if` — chỉ một cái vượt qua `INSERT`.

Xem [Idempotency & retry](../../06-system-design/03-idempotency-retry.md).

### Circuit breaker: ba trạng thái

```text
CLOSED     bình thường, mọi lời gọi đi qua
           đếm lỗi → vượt ngưỡng → chuyển OPEN

OPEN       KHÔNG gọi nữa, fail ngay (hoặc fallback)
           → không lãng phí timeout, dependency được nghỉ để phục hồi
           sau `resetTimeout` → HALF-OPEN

HALF-OPEN  cho MỘT VÀI lời gọi thử đi qua
           thành công → CLOSED
           thất bại   → OPEN lại
```

```text
Giá trị chính không phải "fail nhanh cho client"
mà là NGỪNG DẬP dependency đang cố phục hồi.
```

```text
Cấu hình:
  ngưỡng theo TỈ LỆ lỗi (ví dụ 50%) tốt hơn theo SỐ lỗi tuyệt đối
  → 5 lỗi trong 10 request khác hẳn 5 lỗi trong 10.000 request
  cộng số lượng tối thiểu (ví dụ ≥20 request) để tránh mở vì mẫu quá nhỏ
  breaker RIÊNG cho mỗi dependency — không dùng chung
```

### Ba cơ chế phối hợp

```text
Lời gọi ra ngoài
  ├─ circuit breaker OPEN?  → fail ngay / fallback     (không tốn gì)
  ├─ CLOSED → gọi với TIMEOUT
  │    ├─ thành công → ghi nhận, trả về
  │    └─ thất bại → ghi nhận
  │         ├─ lỗi có retry được không?
  │         ├─ còn ngân sách retry không?
  │         ├─ còn deadline không?
  │         └─ có thì backoff + jitter, thử lại (với CÙNG idempotency key)
  └─ hết lượt → fallback hoặc ném lỗi
```

## Example

Một client HTTP có đủ ba cơ chế:

```ts
interface ResilientOptions {
  timeoutMs: number;
  maxAttempts: number;
  idempotent: boolean;         // ← quyết định CÓ ĐƯỢC PHÉP retry hay không
}

export class ResilientClient {
  constructor(
    private readonly breaker: CircuitBreaker,
    private readonly retryBudget: RetryBudget,      // ngân sách toàn hệ thống
  ) {}

  async call<T>(fn: (signal: AbortSignal) => Promise<T>, opts: ResilientOptions): Promise<T> {
    if (this.breaker.isOpen()) {
      throw new DependencyUnavailableError('circuit open');       // ① không tốn timeout
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
      if (attempt > 0) {
        // ② chỉ retry khi: idempotent + lỗi tạm thời + còn ngân sách + còn deadline
        if (!opts.idempotent) break;
        if (!this.retryBudget.tryConsume()) { retriesDenied.inc(); break; }
        const delay = Math.random() * Math.min(20_000, 200 * 2 ** attempt);
        if (delay > remainingMs()) break;                          // ③ tôn trọng deadline
        await sleep(delay);
      }

      const ac = new AbortSignal.timeout(Math.min(opts.timeoutMs, remainingMs()));
      try {
        const result = await fn(ac);
        this.breaker.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;
        this.breaker.recordFailure();                              // ④ mọi lỗi đều ghi nhận
        if (!isRetryable(err)) throw err;                          // ⑤ 4xx: ném ngay
      }
    }
    throw lastError;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  if (err instanceof Error && 'code' in err) {
    return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err.code as string);
  }
  return false;
}
```

Dùng cho thao tác thanh toán — chú ý idempotency key sinh **một lần cho cả chuỗi thử**:

```ts
async pay(order: Order) {
  const key = order.paymentIdempotencyKey ?? randomUUID();
  await this.orders.setPaymentKey(order.id, key);        // lưu TRƯỚC khi gọi

  return this.client.call(
    (signal) => this.gateway.charge({ ...order, idempotencyKey: key }, { signal }),
    { timeoutMs: 8000, maxAttempts: 3, idempotent: true },
  );
}
```

Việc lưu key **trước** khi gọi là điểm quyết định: nếu process chết giữa chừng và job được chạy lại, nó dùng lại đúng key đó thay vì sinh key mới — và cổng thanh toán nhận ra đây là cùng một ý định.

```text
Kết quả với sự cố ở đầu note:
  trước:  90s giữ worker · gấp 3 tải lên cổng · 1.400 lần tính tiền lặp
  sau:    8s timeout · circuit mở sau ~20 lời gọi lỗi → ngừng dập cổng
          · retry giới hạn bởi ngân sách · idempotency key chặn tính tiền lặp
```

## Prediction

1. Timeout DB 30s, timeout API 10s — truy vấn DB dừng lúc nào khi API bỏ cuộc?
2. Timeout 10s × 3 lần + backoff 1s+2s — tổng thời gian tối đa? Tầng trên timeout 20s thì sao?
3. 1000 client retry sau đúng 1 giây, không jitter — hình dạng tải?
4. Có full jitter — hình dạng?
5. Retry 3 lần cho 10.000 request tới dịch vụ đang hỏng — bao nhiêu lời gọi?
6. Có ngân sách retry 10% — bao nhiêu?
7. Request thành công ở server nhưng response mất trên đường về, client retry — kết quả nếu không idempotent?
8. Có idempotency key — kết quả?
9. Hai lần thử chạy ĐỒNG THỜI với cùng key, chỉ có câu `if` kiểm tra — có chặn được không?
10. Có ràng buộc UNIQUE trên key — có chặn được không?
11. Circuit breaker OPEN, 1000 request tới — bao nhiêu lời gọi tới dependency?
12. Không có breaker, dependency chết, timeout 10s — mỗi request tốn bao lâu?
13. Retry một lỗi 400 — kết quả?
14. Ngưỡng breaker "5 lỗi" với service nhận 10.000 rps — nó mở khi nào?

<details>
<summary>Đáp án</summary>

1. **Nó chạy tiếp tới 30s** — giữ kết nối và lock cho kết quả không ai nhận.
2. `10+1+10+2+10 = 33s`; tầng trên **đã bỏ cuộc từ 13 giây trước**.
3. **Đột biến đồng bộ** tại T+1s — thường tệ hơn lần đầu.
4. **Trải đều** — dependency có cơ hội phục hồi.
5. Tới **30.000**.
6. Tối đa **1.000 retry** ngoài 10.000 lời gọi gốc.
7. **Thao tác chạy hai lần** — tính tiền hai lần.
8. Server trả **kết quả cũ**, không thực thi lại.
9. **Không** — cả hai vượt qua `if` trước khi cái nào ghi.
10. **Có** — chỉ một `INSERT` thành công.
11. **Không cái nào** — fail ngay.
12. **10 giây mỗi request**, và giữ tài nguyên suốt thời gian đó.
13. Vẫn 400 — **lãng phí thuần tuý**.
14. Gần như **ngay lập tức và liên tục** — 5 lỗi trong 10.000 request là bình thường. Dùng tỉ lệ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt timeout DB lớn hơn timeout API | Truy vấn có dừng khi API bỏ cuộc không? |
| Cộng timeout × số lần thử, so với timeout tầng trên | Có vượt không? |
| Retry không jitter với 100 client đồng thời | Hình dạng tải sau backoff? |
| Làm dependency chậm 30s, không có breaker | Bao nhiêu worker bị giữ? |
| Bật breaker, lặp lại | Sau bao lâu nó ngừng gọi? |
| Gửi cùng idempotency key hai lần | Thao tác chạy mấy lần? |
| Gửi cùng key hai lần ĐỒNG THỜI | Có chặn được không? |
| Retry một lỗi 400 | Có ích gì không? |
| Ngắt mạng giữa chừng sau khi server đã xử lý | Client thấy gì? Dữ liệu thế nào? |
| Đếm tổng lời gọi tới dependency khi nó hỏng | Gấp bao nhiêu lần bình thường? |
| Kiểm tra thư viện HTTP có cấu hình đủ 4 loại timeout không | Cái nào đang vô hạn? |

## What Usually Goes Wrong

- **Không có timeout**, hoặc chỉ cấu hình một trong bốn loại.
- **Timeout tầng trong lớn hơn tầng ngoài** → orphaned work.
- **Không tính retry vào ngân sách timeout tổng.**
- **Retry lỗi không retry được** (4xx).
- **Retry không có jitter** → đột biến đồng bộ.
- **Không có ngân sách retry** → khuếch đại tải.
- **Retry thao tác không idempotent** → thao tác lặp.
- **Sinh idempotency key mới cho mỗi lần thử** → key vô dụng.
- **Chỉ kiểm tra key bằng `if`**, không có ràng buộc unique.
- **Không có circuit breaker** → lãng phí timeout cho dịch vụ đã chết.
- **Breaker ngưỡng tuyệt đối** thay vì tỉ lệ.
- **Một breaker dùng chung** cho nhiều dependency.
- **Retry ở NHIỀU tầng** → 3 × 3 × 3 = 27 lần thử.
- **Không đo tỉ lệ retry và trạng thái breaker** → không biết chúng có hoạt động không.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Timeout là chi tiết cấu hình nhỏ | Nó là biện pháp reliability quan trọng nhất |
| Timeout nghĩa là thao tác đã thất bại | Nó nghĩa là bạn **không biết** |
| Retry làm hệ thống đáng tin hơn | Không có giới hạn thì nó làm tệ hơn |
| Retry 3 lần là con số hợp lý | Phụ thuộc idempotency, ngân sách và deadline |
| Jitter là tối ưu nhỏ | Không có nó, retry tạo đột biến đồng bộ |
| Idempotency chỉ cần cho thanh toán | Mọi thao tác có tác dụng phụ đều cần |
| Kiểm tra key trước khi ghi là đủ | Chỉ ràng buộc unique chặn được đồng thời |
| Circuit breaker để client fail nhanh | Chủ yếu để dependency được nghỉ |
| Retry ở mọi tầng cho chắc | Nó nhân số lần thử lên |
| GET luôn an toàn để retry | An toàn về ngữ nghĩa, nhưng vẫn tốn tải |

## Debugging

1. **Kiểm kê timeout**: liệt kê mọi lời gọi ra ngoài và giá trị timeout của nó. Cái nào vô hạn là nghi phạm.
2. **Vẽ cây timeout** từ client vào trong; tìm chỗ tầng trong lớn hơn tầng ngoài.
3. **Đếm tỉ lệ retry** trong tổng lời gọi. Cao bất thường = retry đang là một phần của vấn đề.
4. **Tìm retry lồng nhau**: thư viện HTTP retry + code retry + gateway retry.
5. **Trạng thái breaker theo thời gian** — nó có mở đúng lúc không, có đóng lại được không?
6. **Thao tác lặp** → tìm nơi thiếu idempotency key hoặc key được sinh lại mỗi lần thử.
7. **Orphaned work** → so số truy vấn ở DB với số request thành công ở app; chênh lệch là công việc bị bỏ.
8. **Sau sự cố**: dependency đã nhận gấp bao nhiêu lần lưu lượng bình thường? Đó là mức khuếch đại của bạn.

## Production Considerations

- **Timeout ở mọi lời gọi**, cả bốn loại, xếp thứ tự từ ngoài vào trong.
- **Ngân sách deadline cho cả chuỗi thử**, không phải mỗi lần thử.
- **Giá trị timeout ≈ p99 của dependency × 1,5–2**, xem lại khi p99 đổi.
- **Chỉ retry lỗi tạm thời**; danh sách rõ ràng, không đoán.
- **Exponential backoff + full jitter.**
- **Ngân sách retry toàn hệ thống** (~10%), có metric.
- **Idempotency key cho mọi thao tác có tác dụng phụ**, sinh một lần cho cả chuỗi, lưu trước khi gọi.
- **Ràng buộc UNIQUE ở database** làm cơ chế chặn thật.
- **Circuit breaker riêng cho mỗi dependency**, ngưỡng theo tỉ lệ + số lượng tối thiểu.
- **Retry ở ĐÚNG MỘT tầng** — tắt retry mặc định của thư viện nếu bạn tự làm.
- **Đo**: tỉ lệ retry, tỉ lệ timeout, trạng thái breaker, số lần từ chối vì hết ngân sách.
- **`Retry-After` khi trả 429/503** để client không đoán.
- **Test hành vi**: làm dependency chậm, chết, và trả lỗi ngắt quãng — cả ba khác nhau.
- **Dọn bảng idempotency key** định kỳ (giữ đủ lâu để phủ mọi cửa sổ retry).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Timeout ngắn | giải phóng tài nguyên nhanh | cắt request lẽ ra thành công |
| Timeout dài | ít cắt nhầm | giữ tài nguyên khi hỏng |
| Retry nhiều | chịu được lỗi tạm | khuếch đại tải, độ trễ cao |
| Không retry | không khuếch đại | lỗi tạm thành lỗi thật |
| Ngân sách retry | chặn khuếch đại | một số request không được thử lại |
| Idempotency key | an toàn khi retry | thêm state, thêm bảng, thêm dọn dẹp |
| Circuit breaker | bảo vệ dependency | có thể mở nhầm và từ chối oan |
| Ngưỡng breaker thấp | phản ứng nhanh | dễ mở vì nhiễu |
| Ngưỡng cao | ít mở nhầm | phản ứng chậm |
| Retry ở tầng client | đơn giản | mỗi client làm một kiểu |
| Retry ở gateway/mesh | thống nhất | ẩn, dễ nhân với retry ở app |

## Explain Without Notes

1. Vì sao timeout tầng trong phải nhỏ hơn tầng ngoài? Điều gì xảy ra nếu ngược lại?
2. Bốn loại timeout, và cái nào hay bị để mặc định vô hạn?
3. Vì sao timeout không có nghĩa là thao tác đã thất bại?
4. Vì sao jitter là bắt buộc chứ không phải tối ưu nhỏ?
5. Ngân sách retry khác giới hạn "3 lần mỗi request" thế nào?
6. Vì sao ràng buộc unique quan trọng hơn câu `if` khi làm idempotency?
7. Ba trạng thái của circuit breaker và giá trị chính của nó?
8. Vì sao retry ở nhiều tầng nguy hiểm?

## Related

- [Failure modes](01-failure-modes.md) — vì sao cần ba cơ chế này
- [Graceful degradation](03-graceful-degradation.md) — làm gì khi breaker mở
- [Capacity & limits](04-capacity-and-limits.md) — giới hạn tổng
- [Backpressure](../performance/06-backpressure.md) — phía nhận của cùng vấn đề
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — thiết kế idempotency
- [Retry & DLQ](../../03-database/04-message-queues/03-retry-dlq.md) — retry trong hệ thống bất đồng bộ
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once và hệ quả
- [Graceful shutdown](../../02-backend-api/01-nodejs/05-graceful-shutdown.md) — timeout khi tắt
- [Metrics & SLO](../observability/04-metrics-slo.md) — đo tỉ lệ retry và timeout

## Version / Context

Ví dụ dùng Node.js 20+ (`AbortSignal.timeout`), NestJS 10/11. Thuật ngữ circuit breaker và bulkhead theo Michael Nygard (*Release It!*); "full jitter" theo bài viết của AWS Architecture Blog về exponential backoff; retry budget theo thực hành của Google SRE và cấu hình của Envoy/gRPC. `Retry-After` theo RFC 9110. Idempotency-Key header đang được chuẩn hoá qua IETF draft và đã phổ biến ở API thanh toán.
