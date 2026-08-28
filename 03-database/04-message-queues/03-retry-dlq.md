---
level: advanced
area: database
prerequisites:
  - 02-delivery-semantics.md
related:
  - ../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
  - ../../05-cross-cutting/observability/05-alerting-dashboards.md
---

# Retry & DLQ

> API của đối tác chậm 30 giây trong 5 phút. Hệ thống của bạn có 8 worker, mỗi job retry 5 lần không backoff. Kết quả: bạn gửi gấp **5 lần** lượng request bình thường tới một hệ thống đang chết, kéo dài sự cố của họ thêm 20 phút, và tự tạo ra một hàng đợi 40.000 job cho chính mình. Retry được thiết kế để giúp — nhưng retry không có backoff là một cuộc tấn công DDoS mà bạn tự thực hiện.

## Position

```text
Job fail
   ↓
Lỗi TẠM THỜI?  ──yes──▶ retry với backoff + jitter ──▶ hết attempts ──▶ DLQ
   │no
   ▼
DLQ ngay
   ↓
Con người xem, sửa, phát lại
```

## Problem

### Không phải lỗi nào cũng đáng retry

```text
TẠM THỜI — sẽ tự khỏi                 VĨNH VIỄN — retry vô ích
timeout mạng                           payload sai định dạng
503 / 502 từ upstream                  400 từ API bên ngoài
deadlock (40P01)                       bản ghi đã bị xoá
serialization failure (40001)          vi phạm quy tắc nghiệp vụ
Redis/DB mất kết nối tạm               thiếu quyền
429 rate limit (có Retry-After)        bug trong code
```

Retry một lỗi vĩnh viễn 5 lần với backoff exponential:

```text
2s + 4s + 8s + 16s = 30 giây cho một việc KHÔNG BAO GIỜ thành công
× 5 dòng log lỗi mỗi job
× hàng nghìn job = log nhiễu tới mức không đọc được
```

### Retry sai cách khuếch đại sự cố

```text
Downstream chậm/lỗi
   → job fail
   → retry NGAY LẬP TỨC
   → thêm tải lên downstream đang chết
   → downstream chậm hơn
   → nhiều job fail hơn
   → vòng xoáy
```

Đây là **retry storm**, và nó biến một sự cố 2 phút của người khác thành sự cố 40 phút của bạn.

### Job chết im lặng

Không có DLQ hoặc không ai nhìn DLQ:

```text
Job fail 5 lần → biến mất → không ai biết
→ 3 tuần sau, kế toán hỏi vì sao 200 hoá đơn chưa gửi
```

## Mental Model

### Ba câu hỏi cho mỗi lỗi

```text
① Lỗi này có tự khỏi không?          → retry hay không
② Retry bao nhiêu lần, cách nhau bao lâu?  → backoff
③ Hết attempts thì đi đâu?           → DLQ + alert
```

Câu ① là câu quan trọng nhất, và nó là **quyết định của người viết code**, không phải của queue. Queue không biết `400 Bad Request` khác `503 Service Unavailable`.

### Backoff: bốn kiểu

```text
IMMEDIATE      0, 0, 0, 0              ✗ không bao giờ dùng
FIXED          5s, 5s, 5s, 5s          ✗ mọi job retry cùng lúc → đợt sóng
EXPONENTIAL    2s, 4s, 8s, 16s         ✓ cho downstream thời gian phục hồi
EXP + JITTER   2±1s, 4±2s, 8±4s        ✓✓ MẶC ĐỊNH ĐÚNG
```

Vì sao jitter quan trọng hơn nó có vẻ:

```text
1.000 job fail cùng lúc (downstream chết)
Exponential không jitter → cả 1.000 retry ở giây thứ 2 → đợt sóng 1.000 request
                        → fail tiếp → cả 1.000 retry ở giây thứ 6 → đợt sóng nữa
Exponential + jitter    → trải đều trong khoảng 1–3 giây → tải mượt
```

Không có jitter, bạn đồng bộ hoá toàn bộ hệ thống thành các đợt sóng — chính xác điều bạn muốn tránh.

```ts
function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 60_000);   // trần 60 giây
  return base * (0.5 + Math.random() * 0.5);            // jitter 50–100%
}
```

### Tôn trọng `Retry-After`

Khi upstream trả `429` hoặc `503` kèm `Retry-After`, họ đang nói cho bạn biết chính xác khi nào nên quay lại. Bỏ qua nó là tự làm mình bị chặn lâu hơn.

```ts
if (res.status === 429) {
  const after = Number(res.headers.get('retry-after') ?? 60) * 1000;
  throw new RetryableError('rate limited', { delayMs: after });
}
```

### Phân loại lỗi trong code

```ts
// lỗi vĩnh viễn — vào DLQ NGAY, không retry
export class PermanentError extends Error {}

function classify(e: unknown): 'retry' | 'permanent' {
  if (e instanceof PermanentError) return 'permanent';

  // HTTP: 4xx của họ = lỗi CỦA MÌNH (trừ 408, 429)
  if (isHttpError(e)) {
    if (e.status === 429 || e.status === 408) return 'retry';
    if (e.status >= 400 && e.status < 500) return 'permanent';
    return 'retry';                                    // 5xx
  }

  // PostgreSQL
  if (e.code === '40001' || e.code === '40P01') return 'retry';   // serialization, deadlock
  if (e.code === '23505' || e.code === '23503') return 'permanent'; // constraint

  // mạng
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(e.code)) return 'retry';

  return 'retry';   // không rõ → retry, nhưng có trần
}
```

```ts
// BullMQ: UnrecoverableError bỏ qua mọi attempt còn lại
if (classify(e) === 'permanent') throw new UnrecoverableError(e.message);
throw e;
```

Mặc định "không rõ thì retry" là lựa chọn hợp lý: retry một lỗi vĩnh viễn tốn vài lần thử, còn không retry một lỗi tạm thời làm mất việc.

### DLQ: nơi job đi khi hết cách

```text
DLQ = hàng đợi riêng chứa job đã thất bại hết attempts

Nó KHÔNG phải nơi để quên. Nó là hàng đợi CÔNG VIỆC CHO CON NGƯỜI.
Mỗi job trong DLQ là một câu hỏi chưa được trả lời.
```

Job trong DLQ phải mang đủ ngữ cảnh để điều tra mà không cần đọc code:

```ts
{
  originalQueue: 'invoices',
  jobId: 'invoice:order-8421',
  payload: { orderId: 'order-8421', v: 1 },
  attempts: 5,
  firstFailedAt: '2026-01-15T10:23:00Z',
  lastFailedAt:  '2026-01-15T10:24:30Z',
  errors: [
    { attempt: 1, at: '...', message: 'ETIMEDOUT', stack: '...' },
    { attempt: 5, at: '...', message: 'ETIMEDOUT', stack: '...' },
  ],
  correlationId: 'req-abc-123',
}
```

Trường `errors` là mảng, không phải một lỗi cuối: **năm lần fail có thể do năm nguyên nhân khác nhau**, và biết điều đó thay đổi cách bạn chẩn đoán.

### Quy trình xử lý DLQ

```text
① Alert khi DLQ có job mới (ngưỡng, không phải mỗi job)
② Con người xem: lỗi gì? bao nhiêu job cùng loại?
③ Phân loại:
   · bug trong code       → sửa code → phát lại
   · dữ liệu xấu          → sửa dữ liệu → phát lại
   · downstream đã hỏng   → chờ họ sửa → phát lại
   · không thể xử lý       → ghi nhận, xoá, và ghi lại lý do
④ Phát lại theo lô, có giới hạn tốc độ
⑤ Ghi lại nguyên nhân gốc để nó không lặp lại
```

Bước ⑤ là bước phân biệt một hệ thống trưởng thành: nếu cùng một loại job vào DLQ mỗi tuần, vấn đề không phải DLQ.

```ts
// phát lại có kiểm soát — KHÔNG đẩy 10.000 job cùng lúc
async function replayDlq(type: string, limit = 100) {
  const jobs = await dlq.getJobs(['failed'], 0, limit);
  for (const job of jobs.filter((j) => j.data.type === type)) {
    await mainQueue.add(job.name, job.data, { jobId: job.data.jobId });   // jobId → chống trùng
    await job.remove();
    await sleep(50);                                                       // giới hạn tốc độ
  }
}
```

Nếu phát lại 10.000 job cùng lúc vào một downstream vừa phục hồi, bạn làm nó chết lần nữa.

### Poison message

```text
Một job LUÔN LUÔN fail (payload hỏng, bug với dữ liệu cụ thể)
→ nếu retry vô hạn: nó quay vòng mãi mãi, chiếm worker
→ nếu ở đầu hàng đợi FIFO: nó CHẶN mọi job sau nó
```

Phòng: **luôn có giới hạn attempts**, và theo dõi `delivery_count`/`attemptsMade`. Job vượt ngưỡng bất thường là poison message.

Với hệ thống có thứ tự nghiêm ngặt (Kafka partition), poison message chặn cả partition — đó là lý do phải có chiến lược "bỏ qua và ghi nhận" thay vì "retry mãi". Xem [Ordering & partitioning](04-ordering-partitioning.md).

### Circuit breaker: dừng retry khi downstream đang chết

Retry cho từng job không đủ. Khi downstream chết hoàn toàn, bạn nên **dừng gọi** thay vì để mỗi job thử 5 lần.

```text
CLOSED     gọi bình thường; đếm lỗi
   ↓ tỉ lệ lỗi vượt ngưỡng
OPEN       KHÔNG gọi nữa; fail ngay lập tức, không tốn timeout
   ↓ sau cooldown
HALF-OPEN  cho vài request đi thử
   ↓ ok            ↓ fail
CLOSED           OPEN
```

Khi mạch mở, job nên được **hoãn** (delay) thay vì fail vào DLQ — vấn đề là downstream, không phải job:

```ts
if (breaker.isOpen()) {
  await job.moveToDelayed(Date.now() + 60_000);   // thử lại sau 1 phút
  return;
}
```

Chi tiết: [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

### Timeout là điều kiện tiên quyết của retry

Retry không có timeout là vô nghĩa: nếu một job treo vô hạn, nó không bao giờ đến bước retry.

```text
timeout mỗi lần gọi          <  thời gian job tối đa
thời gian job tối đa         <  visibility timeout / lockDuration
tổng thời gian mọi attempt   <  thời gian bạn chấp nhận chờ kết quả
```

Bốn con số này phải khớp nhau. Sai một cái làm cả chuỗi retry vô hiệu.

## Example

Cấu hình đầy đủ:

```ts
BullModule.registerQueue({
  name: 'invoices',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },     // 2s, 4s, 8s, 16s (+jitter của BullMQ)
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: false,                                // GIỮ để điều tra
  },
});
```

```ts
@Processor('invoices')
export class InvoiceProcessor extends WorkerHost {
  async process(job: Job) {
    try {
      if (this.breaker.isOpen()) {
        await job.moveToDelayed(Date.now() + 60_000);   // downstream đang chết
        return;
      }
      return await this.doWork(job.data);
    } catch (e) {
      if (classify(e) === 'permanent') {
        throw new UnrecoverableError(`${e.name}: ${e.message}`);   // → DLQ ngay
      }
      this.breaker.recordFailure();
      throw e;                                                      // → retry
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);

    this.logger.error({
      queue: 'invoices', jobId: job.id, attempt: job.attemptsMade,
      final, err: err.message, correlationId: job.data.correlationId,
    }, final ? 'job dead-lettered' : 'job failed, will retry');

    this.metrics.increment('job_failed', { queue: 'invoices', final: String(final) });

    if (final) {
      await this.dlq.add('dead', {
        originalQueue: 'invoices',
        jobId: job.id,
        payload: job.data,
        attempts: job.attemptsMade,
        errors: job.stacktrace?.slice(0, 5),
        firstFailedAt: job.processedOn,
        lastFailedAt: Date.now(),
      });
    }
  }
}
```

Bốn quyết định trong đoạn này:

```text
removeOnFail: false     giữ job thất bại để điều tra
UnrecoverableError      lỗi vĩnh viễn không tốn 5 lần thử
moveToDelayed           downstream chết → hoãn, không phải fail
final trong log/metric  phân biệt "sẽ thử lại" (info) và "đã chết" (cần người)
```

Điểm cuối quan trọng cho alert: log mọi lần fail ở mức `error` làm bạn không phân biệt được "job thứ 2 trong 5 lần thử, bình thường" với "job đã chết, cần người xem".

## Prediction

1. Retry 5 lần không backoff, downstream chậm — bạn gửi bao nhiêu lần lượng request bình thường?
2. Exponential backoff không jitter, 1.000 job fail cùng lúc — hình dạng tải retry?
3. Thêm jitter — hình dạng đổi thế nào?
4. Retry một lỗi `400 Bad Request` từ API bên ngoài 5 lần — kết quả? Tốn bao lâu?
5. Không phân loại lỗi, một bản ghi bị xoá làm job fail — bao nhiêu lần thử vô ích?
6. Không có DLQ, job fail hết attempts — nó đi đâu?
7. Có DLQ nhưng không có alert — bao lâu để phát hiện?
8. Poison message trong hàng đợi FIFO nghiêm ngặt, retry vô hạn — job phía sau thế nào?
9. Downstream chết 10 phút, 8 worker × 5 attempts, không circuit breaker — tổng số request tới downstream?
10. Có circuit breaker — bao nhiêu?
11. Phát lại 10.000 job từ DLQ cùng lúc vào downstream vừa phục hồi — chuyện gì xảy ra?
12. Retry không có timeout, một job treo vô hạn — nó có bao giờ retry không?
13. Log mọi lần fail ở mức `error` với 1.000 job × 5 attempts — bao nhiêu dòng error? Alert thế nào?

<details>
<summary>Đáp án</summary>

1. **Gấp 5 lần** — và tất cả gần như đồng thời, đúng lúc downstream yếu nhất.
2. Các **đợt sóng đồng bộ**: 1.000 request ở giây 2, rồi 1.000 ở giây 6, rồi 1.000 ở giây 14.
3. Tải **trải đều** thay vì sóng — downstream có cơ hội phục hồi.
4. Fail cả 5 lần. Tốn 2+4+8+16 = **30 giây** và 5 dòng log cho một việc không bao giờ thành công.
5. **5 lần** (4 lần thừa), nhân với số job cùng loại.
6. Biến mất (tuỳ cấu hình `removeOnFail`). **Không ai biết.**
7. Cho tới khi có người phàn nàn — có thể vài tuần.
8. **Bị chặn** — không job nào sau nó được xử lý.
9. 10 phút × tốc độ job × 8 worker × 5 = rất lớn. Bạn đang tấn công một hệ thống đang chết.
10. Sau khi mạch mở: **gần như 0** — job bị hoãn thay vì gọi.
11. Downstream **chết lần nữa** ngay khi vừa phục hồi.
12. **Không** — job không bao giờ kết thúc để chuyển sang trạng thái fail. Timeout là điều kiện tiên quyết.
13. **5.000 dòng error**. Alert dựa trên số lỗi sẽ nổ liên tục; và không phân biệt được lần thử với lần chết.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Retry không backoff, làm downstream chậm (thêm `sleep`) | Đếm request tới downstream |
| Thêm exponential backoff | So sánh |
| Thêm jitter, 1.000 job fail cùng lúc, vẽ biểu đồ thời điểm retry | Sóng vs trải đều |
| Retry lỗi 400, đo thời gian và số dòng log | 30 giây vô ích |
| Thêm phân loại → `UnrecoverableError` | Vào DLQ ngay |
| Xoá một bản ghi rồi chạy job liên quan | Retry vô ích |
| Bỏ DLQ (`removeOnFail: true`), làm job fail | Biến mất không dấu vết |
| Thêm DLQ nhưng không alert, để một tuần | Đếm job tồn đọng |
| Tạo poison message trong hàng đợi có thứ tự | Job sau bị chặn |
| Tắt downstream 5 phút với và không có circuit breaker | So số request |
| Phát lại 5.000 job từ DLQ cùng lúc | Downstream quá tải |
| Phát lại có `sleep(50)` giữa các job | Mượt |
| Bỏ timeout, để downstream treo | Job không bao giờ retry |
| Log mọi lần fail ở `error`, chạy load test có lỗi | Đếm dòng log; đánh giá alert |

## What Usually Goes Wrong

- **Retry không backoff** → khuếch đại sự cố của downstream.
- **Không jitter** → đợt sóng đồng bộ.
- **Không phân loại lỗi** → retry lỗi vĩnh viễn, log nhiễu, tài nguyên lãng phí.
- **Không có DLQ** → job chết im lặng.
- **Có DLQ nhưng không có alert** → DLQ thành thư mục rác.
- **DLQ thiếu ngữ cảnh** → không điều tra được, phải đoán.
- **Không có giới hạn attempts** → poison message quay vòng mãi mãi.
- **Không có circuit breaker** → mỗi job thử 5 lần vào một hệ thống đã chết.
- **Phát lại hàng loạt không giới hạn tốc độ** → làm downstream chết lần nữa.
- **Không có timeout** → retry không bao giờ kích hoạt.
- **Log mọi lần fail ở mức error** → alert fatigue, không phân biệt được lần thử với lần chết.
- **Retry một job không idempotent** → mỗi lần retry tạo tác dụng phụ trùng.
- **Không tìm nguyên nhân gốc** → cùng loại job vào DLQ mỗi tuần.
- **Trần backoff quá cao** → job "sống" nhưng thực tế bị hoãn nhiều giờ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Retry luôn giúp | Với lỗi vĩnh viễn nó chỉ nhân lên vấn đề |
| Retry nhiều thì an toàn hơn | Nó khuếch đại tải lên hệ thống đang yếu |
| Exponential backoff là đủ | Thiếu jitter tạo đợt sóng đồng bộ |
| Queue tự quyết định retry hợp lý | Nó không biết `400` khác `503` |
| DLQ là nơi bỏ job hỏng | Là hàng đợi công việc cho con người |
| Job trong DLQ có thể phát lại vô tư | Cần idempotency và giới hạn tốc độ |
| Circuit breaker chỉ cho HTTP client | Nó cũng thuộc về worker |
| `attempts: 3` là cấu hình đủ | Còn cần backoff, jitter, phân loại, DLQ, alert |
| Mọi lần fail nên log `error` | Chỉ lần cuối (đã chết) mới cần người xem |
| Phát lại DLQ là bước cuối | Bước cuối là tìm nguyên nhân gốc |

## Debugging

1. **Job vào DLQ** → đọc **toàn bộ** mảng lỗi, không chỉ lỗi cuối. Năm lần fail có thể do năm nguyên nhân.
2. **Phân loại**: lỗi giống nhau ở mọi attempt → vĩnh viễn (và lẽ ra không nên retry). Lỗi khác nhau → có thể tạm thời.
3. **Đếm job trong DLQ theo loại lỗi** — một loại chiếm đa số thường chỉ ra một nguyên nhân gốc.
4. **Xem `attemptsMade` phân bố** — nhiều job dừng ở attempt 1 nghĩa là lỗi vĩnh viễn không được phân loại.
5. **Tương quan thời gian**: job vào DLQ có tập trung vào một khoảng không? Nếu có, tìm sự kiện ở khoảng đó (deploy, sự cố downstream).
6. **Đo tỉ lệ retry** như một metric. Tăng dần nghĩa là downstream đang yếu đi.
7. **Kiểm tra timeout trước khi kiểm tra retry** — nếu không có timeout, chuỗi retry không bao giờ chạy.
8. **Trước khi phát lại**: job có idempotent không? Nguyên nhân đã được sửa chưa? Phát lại khi chưa sửa chỉ tạo thêm rác.

## Production Considerations

- **Phân loại lỗi là bắt buộc**, không phải tối ưu hoá. Một hàm `classify(e)` dùng chung cho mọi worker.
- **Exponential backoff + jitter** làm mặc định, với trần (thường 60 giây).
- **Tôn trọng `Retry-After`** khi upstream cung cấp.
- **DLQ cho mọi queue**, với đủ ngữ cảnh để điều tra.
- **Alert trên DLQ theo ngưỡng và theo tốc độ**, không phải mỗi job. "DLQ > 10 job trong 5 phút" hữu ích hơn "có một job vào DLQ".
- **Log mức khác nhau**: `warn` cho lần thử, `error` cho lần chết. Đây là điều kiện để alert có ý nghĩa.
- **Circuit breaker cho mọi dependency ngoài** trong worker.
- **Timeout ở mọi lời gọi**, và bốn con số timeout phải khớp nhau.
- **Công cụ phát lại DLQ** có giới hạn tốc độ và lọc theo loại — viết nó **trước** khi cần, không phải lúc 2 giờ sáng.
- **Đo bốn thứ**: tỉ lệ retry, kích thước DLQ, tuổi job cũ nhất trong DLQ, tỉ lệ thành công sau retry.
- **Xem xét DLQ định kỳ** như một phần công việc vận hành, không phải chỉ khi có alert.
- **Ghi lại nguyên nhân gốc** mỗi lần xử lý DLQ. Cùng loại lỗi lặp lại là tín hiệu cần sửa thiết kế, không phải cần phát lại nhanh hơn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Retry nhiều lần | chịu lỗi tạm thời tốt | khuếch đại tải, độ trễ đuôi cao |
| Retry ít lần | không làm downstream tệ hơn | mất việc khi lỗi thoáng qua |
| Backoff dài | downstream có thời gian phục hồi | kết quả rất muộn |
| Backoff ngắn | phục hồi nhanh khi lỗi thoáng qua | rủi ro khuếch đại |
| Jitter | tải mượt | thời điểm không dự đoán được |
| Phân loại lỗi | không lãng phí, log sạch | phải bảo trì bảng phân loại |
| Không phân loại | ít code | retry vô ích, log nhiễu |
| DLQ giữ lâu | điều tra được | tốn dung lượng |
| DLQ xoá sớm | gọn | mất bằng chứng |
| Circuit breaker | bảo vệ downstream, fail nhanh | thêm trạng thái, có thể mở nhầm |
| Phát lại tự động | nhanh, ít việc tay | có thể phát lại job chưa sửa nguyên nhân |
| Phát lại thủ công | có kiểm soát | tốn thời gian người |

## Explain Without Notes

1. Ba câu hỏi cho mỗi lỗi, và câu nào quan trọng nhất?
2. Vì sao jitter quan trọng? Vẽ hình dạng tải có và không có jitter.
3. Kể năm lỗi tạm thời và năm lỗi vĩnh viễn.
4. Retry storm xảy ra thế nào, và hai cơ chế chống nó?
5. DLQ là gì, và vì sao gọi nó là "hàng đợi công việc cho con người"?
6. Poison message là gì, và nó gây gì trong hàng đợi có thứ tự?
7. Vì sao timeout là điều kiện tiên quyết của retry?
8. Vì sao không nên log mọi lần fail ở mức `error`?

## Related

- [Delivery semantics](02-delivery-semantics.md) — vì sao retry an toàn cần idempotency
- [Vì sao cần queue](01-why-queue.md) — nền tảng
- [Ordering & partitioning](04-ordering-partitioning.md) — poison message chặn partition
- [Outbox pattern](06-outbox-pattern.md) — retry ở tầng phát tán sự kiện
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — ba cơ chế phải thiết kế cùng nhau
- [Failure modes](../../05-cross-cutting/reliability/01-failure-modes.md) — phân loại hỏng hóc
- [Alerting & dashboards](../../05-cross-cutting/observability/05-alerting-dashboards.md) — alert trên DLQ
- [Error handling strategy](../../02-backend-api/04-architecture/04-error-handling-strategy.md) — `retryable` trong cây lỗi
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — nguyên lý ở tầng hệ thống
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md) — `Retry-After`

## Version / Context

Ví dụ dùng BullMQ 5 (`UnrecoverableError`, `moveToDelayed`, `job.stacktrace`). SQS có DLQ và `maxReceiveCount` sẵn; RabbitMQ dùng dead-letter exchange; Kafka thường cần một topic DLQ tự quản lý.
