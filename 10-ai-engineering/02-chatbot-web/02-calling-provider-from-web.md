---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-chatbot-architecture.md
related:
  - ../07-production/05-failure-handling.md
  - ../../05-cross-cutting/security/06-secrets-management.md
---

# Gọi AI provider từ web application

> Một startup phát hiện hoá đơn API tháng đó là 47.000 USD thay vì 300 USD. Nguyên nhân: API key được đặt trong biến môi trường tên `NEXT_PUBLIC_AI_API_KEY` để "cho tiện lúc dev", frontend gọi provider trực tiếp, và key nằm trong bundle JS công khai trong sáu tuần. Không có ai bị hack. Key chỉ đơn giản là **đã công khai** kể từ lần deploy đầu tiên.

## Position

```text
Browser ──▶ BACKEND CỦA BẠN ──▶ AI Provider
              ▲
     note này: vì sao mũi tên giữa là bắt buộc,
     và cái gì phải có ở đó
```

## Problem

Gọi AI provider trông giống gọi bất kỳ API bên thứ ba nào, nhưng có bốn tính chất làm nó nguy hiểm hơn:

```text
① Key mang QUYỀN CHI TIỀN KHÔNG GIỚI HẠN, không chỉ quyền đọc dữ liệu
② Mỗi request tốn tiền thật, nên lạm dụng có hậu quả tức thì
③ Request CHẬM (nhiều giây), nên timeout/retry sai gây dồn tải
④ Rate limit là của CẢ TỔ CHỨC, không phải per-instance
```

Tính chất ① là lý do quy tắc dưới đây không có ngoại lệ thực tế cho một web app thông thường.

## Mental Model

### Quy tắc: browser không bao giờ giữ key của provider

```text
❌ Browser ──── API key ────▶ Provider
   · key nằm trong JS bundle → ai xem source cũng thấy
   · không rate limit được theo user của BẠN
   · không log được, không tính chi phí theo user
   · không kiểm được nội dung, không chặn được lạm dụng
   · biến môi trường có tiền tố công khai (NEXT_PUBLIC_, VITE_) ĐƯỢC NHÚNG VÀO BUNDLE

✅ Browser ──── cookie/JWT của BẠN ────▶ Backend ──── key ────▶ Provider
```

Điều đáng nhấn: **`NEXT_PUBLIC_*` và `VITE_*` không phải "biến môi trường"** theo nghĩa server. Chúng là **hằng số được nhúng vào file JS** lúc build. Đặt secret vào đó là công khai nó, không phải cấu hình nó.

Kiểm tra rẻ nhất: build production rồi `grep` bundle tìm tiền tố key. Nếu thấy, key đã bị lộ và **phải rotate**, không chỉ sửa code.

### Ngoại lệ hợp pháp — và nó không phải "lộ key"

Có kiến trúc cho phép client gọi provider trực tiếp, nhưng nó **không** dùng key dài hạn:

```text
Browser ──▶ Backend: "cho tôi quyền tạm"
Backend  ──▶ Provider: tạo EPHEMERAL TOKEN (hạn phút, phạm vi hẹp)
Backend  ──▶ Browser: token đó
Browser  ──▶ Provider trực tiếp   ← chỉ với token ngắn hạn
```

Khi nào đáng làm: **realtime audio/video hai chiều**, nơi đi qua backend thêm độ trễ không chấp nhận được. Với chat text, lợi ích không đáng đánh đổi — bạn mất log, mất kiểm soát nội dung, mất khả năng tính chi phí theo user.

Nếu bạn đi đường này: token phải có hạn ngắn, phạm vi hẹp, phát theo user đã xác thực, và có trần sử dụng.

### Bảy thứ backend phải làm ở tầng gọi provider

```text
① SECRET     key từ secret manager / env server-side. Không trong code, không trong git.
② TIMEOUT    luôn có. Không có timeout = giữ tài nguyên vô hạn.
③ RETRY      chỉ cho lỗi retryable, có backoff + jitter, có TRẦN.
④ RATE LIMIT của bạn, theo user — trước cả khi gọi provider.
⑤ COST CAP   trần token/chi phí theo user và theo tổ chức.
⑥ LOG        usage, model, route, finishReason, latency.
⑦ ABORT      truyền AbortSignal xuống provider khi client ngắt.
```

Trong bảy thứ đó, **⑤ và ⑦ là hai thứ đặc thù của AI**. Năm thứ còn lại là kỷ luật tích hợp dịch vụ bên ngoài mà repo đã dạy ở [reliability/](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

### Timeout: hai con số, không phải một

```text
NON-STREAMING     một timeout cho toàn bộ request
                  → phải đủ dài cho output dài nhất bạn cho phép

STREAMING         ① timeout cho TTFT           (~10–30s)
                  ② timeout GIỮA HAI CHUNK     (~30–60s)  ← cái này hay bị bỏ
                  ③ trần thời gian tổng        (~5 phút)
```

Timeout ② là timeout quan trọng nhất với streaming, và là timeout không có sẵn trong hầu hết HTTP client. Không có nó, một stream "sống" nhưng không gửi gì nữa sẽ **treo mãi mãi** — kết nối vẫn mở, tài nguyên vẫn giữ, và người dùng nhìn con trỏ nhấp nháy.

```ts
async function* withIdleTimeout<T>(src: AsyncIterable<T>, ms: number): AsyncIterable<T> {
  const it = src[Symbol.asyncIterator]();
  for (;;) {
    const timer = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new AppError('LLM_STREAM_IDLE_TIMEOUT')), ms));
    const { value, done } = await Promise.race([it.next(), timer]);
    if (done) return;
    yield value;
  }
}
```

### Retry: cái gì retry được, và cái gì làm mọi thứ tệ hơn

```text
RETRY ĐƯỢC                          KHÔNG RETRY
429 rate limit (tôn trọng Retry-After)   400 context too large   → thu gọn context
500 / 502 / 503 / 504                    400 invalid request     → sửa code
timeout kết nối                          401 / 403               → sửa key/quyền
                                         content policy          → thông báo user
                                         finishReason=max_tokens → tăng limit/thu yêu cầu
```

Ba quy tắc bắt buộc:

```text
① Backoff + JITTER. Không jitter = mọi instance retry cùng lúc.
② TRẦN số lần (1–2 là đủ cho request tương tác).
③ Với request TƯƠNG TÁC, retry cạnh tranh với sự kiên nhẫn của người dùng.
   Một retry mất 8 giây thường tệ hơn một lỗi có nút "Thử lại".
```

Quy tắc ③ là quy tắc người ta hay bỏ qua. Trong chat, **để người dùng quyết định retry** thường tốt hơn tự retry — họ có thể sửa câu hỏi, hoặc đơn giản là không cần nữa.

Và một cái bẫy: **SDK thường tự retry mặc định** (2 lần là phổ biến). Cộng với retry của bạn, một request có thể thành 9 lần gọi. Kiểm tra và đặt tường minh.

### Rate limit: hai tầng, hai mục đích

```text
TẦNG 1 — của bạn, theo user (Redis)
   mục đích: chống lạm dụng, chia sẻ công bằng, bảo vệ hoá đơn
   đơn vị:   request/phút  VÀ  token/ngày

TẦNG 2 — của provider, theo tổ chức
   mục đích: không phải của bạn
   thực tế:  429 khi VƯỢT — dùng chung giữa MỌI instance của bạn
```

Hệ quả của tầng 2 mà nhiều người gặp khi scale: **tăng số instance không tăng throughput với provider.** 3 pod cùng chia một hạn mức. Nếu cần đảm bảo, phải có **giới hạn đồng thời phân tán** (semaphore trong Redis), không phải giới hạn cục bộ trong từng process.

```ts
// Giới hạn cục bộ: sai khi có nhiều instance
const localLimit = pLimit(10);      // 3 pod → 30 request đồng thời

// Phân tán: đúng
await redisSemaphore.acquire('llm:concurrency', { max: 10, ttlMs: 60_000 });
```

### Abort: đường dây phải nối liền

Khi người dùng bấm Stop hoặc đóng tab, tín hiệu phải đi hết đường:

```text
Browser: AbortController.abort()
   ↓  kết nối HTTP đóng
Backend: phát hiện request aborted  (req.signal / 'close' event)
   ↓  truyền signal xuống
Provider: request bị abort → NGỪNG sinh token
```

Nếu đứt ở khâu cuối, bạn **vẫn bị tính tiền cho phần còn lại** dù không ai đọc nó. Đây là rò rỉ chi phí lặng lẽ nhất trong chatbot.

## Example

```ts
@Injectable()
export class ProviderGateway {
  async *stream(req: ChatRequest, ctx: Ctx): AsyncIterable<ChatEvent> {
    // ④ rate limit của BẠN, trước khi tốn tiền
    await this.limiter.consumeRequests(ctx.userId);
    await this.limiter.consumeTokens(ctx.userId, req.estimatedInputTokens);

    // ⑤ cost cap — kiểm trước, không phải sau
    const spent = await this.cost.spentToday(ctx.orgId);
    if (spent >= cfg.dailyCostCapUsd) throw new AppError('AI_BUDGET_EXCEEDED');

    // giới hạn đồng thời PHÂN TÁN
    const lease = await this.sem.acquire('llm:concurrency', { max: cfg.maxConcurrent });
    try {
      // ②⑦ timeout TTFT + idle + abort
      const raw = this.provider.stream({ ...req, signal: ctx.signal });
      yield* withIdleTimeout(withFirstTokenTimeout(raw, cfg.ttftMs), cfg.idleMs);
    } finally {
      await lease.release();
    }
  }
}
```

Thứ tự trong hàm trên là có chủ đích: **kiểm rate limit và ngân sách *trước* khi gọi provider.** Kiểm sau khi gọi là đã tốn tiền rồi mới từ chối.

Và secret không bao giờ xuất hiện trong code:

```ts
// ❌ trong code, trong git, trong image
const client = new Provider({ apiKey: 'sk-ant-...' });

// ❌ tiền tố công khai — ĐƯỢC NHÚNG VÀO BUNDLE FRONTEND
const client = new Provider({ apiKey: process.env.NEXT_PUBLIC_AI_KEY });

// ✅ server-side, từ secret manager, và fail nhanh nếu thiếu
const client = new Provider({ apiKey: requireEnv('AI_API_KEY') });
```

Chi tiết vòng đời secret, rotation, phát hiện rò rỉ: [06-secrets-management.md](../../05-cross-cutting/security/06-secrets-management.md).

## Prediction

1. Bạn đặt key vào `NEXT_PUBLIC_AI_KEY` và chỉ dùng ở Server Component. An toàn không?
2. Bạn có timeout tổng 60 giây cho stream, nhưng không có idle timeout. Provider ngừng gửi ở giây thứ 5. Người dùng chờ bao lâu?
3. Bạn dùng `pLimit(10)` trong process và scale lên 4 pod. Bao nhiêu request đồng thời tới provider?
4. Bạn retry 3 lần với backoff cho lỗi `400 context too large`. Chi phí và kết quả?
5. Bạn phát hiện key đã nằm trong bundle 6 tuần. Sửa code là đủ chưa?

<details>
<summary>Đáp án</summary>

1. **Không an toàn.** Tiền tố `NEXT_PUBLIC_` khiến giá trị được nhúng vào bundle client **bất kể bạn dùng ở đâu**. Đó là quy tắc của bundler, không phải của nơi bạn gọi. Đổi tên biến (bỏ tiền tố) và rotate key.
2. **55 giây** — cho tới khi timeout tổng nổ. Với idle timeout 30s thì 30 giây; với 15s thì 15 giây. Đây là lý do idle timeout là timeout quan trọng nhất của streaming.
3. **40**. Giới hạn cục bộ nhân với số instance. Cần semaphore phân tán nếu hạn mức provider quan trọng.
4. **Ba lần fail chắc chắn** — context quá lớn là lỗi của request, không phụ thuộc thời điểm. Bạn trả thêm latency mà không có cơ hội thành công. (Request bị từ chối ở tầng validate thường không tính token, nhưng bạn vẫn mất thời gian và tăng tải.)
5. **Chưa.** Key đã công khai → **phải rotate ngay**, kiểm log sử dụng để phát hiện lạm dụng, và đặt trần chi phí. Sửa code chỉ chặn lần lộ tiếp theo.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Hoá đơn tăng vọt không giải thích được | key lộ trong bundle; hoặc không có cost cap |
| Request treo vô hạn | thiếu idle timeout cho stream |
| `429` liên tục sau khi scale | hạn mức provider dùng chung; giới hạn đồng thời cục bộ |
| Latency p99 rất tệ | retry tự động cộng dồn (SDK + của bạn) |
| Bị tính tiền cho câu trả lời không ai đọc | không truyền AbortSignal |
| Một user làm chậm mọi người | thiếu rate limit theo user, hoặc thiếu giới hạn đồng thời |
| Retry làm sự cố provider tệ hơn | không backoff, không jitter, không circuit breaker |
| Lỗi provider hiện raw cho người dùng | không map sang error model của bạn |

Dòng cuối đáng nói: thông báo lỗi của provider có thể chứa chi tiết nội bộ. Map sang `code` của bạn, như [05-error-model.md](../../02-backend-api/00-http-api/05-error-model.md) yêu cầu.

## Debugging

```text
1. grep bundle production tìm tiền tố key   → lộ hay không, câu hỏi số 1
2. HTTP status của lỗi?  4xx → sửa request | 429/5xx → retry/backoff
3. Có bao nhiêu lần gọi provider cho MỘT request người dùng?
   → cộng retry của SDK + retry của bạn + vòng lặp tool
4. Stream dừng: có event 'done' không? → ngắt giữa dòng vs kết thúc thật
5. Số request đồng thời thực tế = giới hạn cục bộ × số instance?
6. Chi phí theo user/route: ai tốn nhiều nhất?
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Luôn qua backend | bảo mật, log, rate limit, cost control | thêm một hop (~10–50ms) — không đáng kể so với TTFT |
| Ephemeral token cho client | latency thấp nhất cho realtime | mất log/kiểm soát nội dung; phức tạp hơn nhiều |
| Tự retry | chịu được lỗi tạm | latency cao hơn; nhân chi phí; có thể làm sự cố tệ hơn |
| Để người dùng retry | rẻ, minh bạch, họ sửa được câu hỏi | nhiều lỗi hiện ra hơn |
| Semaphore phân tán | tôn trọng hạn mức provider | thêm phụ thuộc Redis vào đường request |
| Cost cap cứng | không bao giờ có hoá đơn bất ngờ | có thể từ chối user hợp lệ vào cuối kỳ |

## Explain Without Notes

1. Browser không bao giờ giữ key provider; `NEXT_PUBLIC_*` là **nhúng vào bundle**, không phải env.
2. Bảy thứ ở tầng gateway; hai thứ đặc thù AI là **cost cap** và **abort**.
3. Streaming cần **ba** timeout, và idle timeout là cái quan trọng nhất.
4. `429`/`5xx` retry được; `400 context too large` thì không.
5. Hạn mức provider dùng chung giữa mọi instance → giới hạn đồng thời phải phân tán.

## Related

- [Chatbot architecture](./01-chatbot-architecture.md) — trạm ⑩
- [Streaming](./03-streaming.md) — abort và ngắt giữa dòng
- [Failure handling](../07-production/05-failure-handling.md) — phân loại retryability đầy đủ
- [Cost & model routing](../07-production/02-cost-and-model-routing.md) — cost cap
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — vòng đời key, rotation
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md)
- [Rate limiting (HTTP)](../../02-backend-api/00-http-api/07-rate-limiting.md) — `429`, `Retry-After`
- [Error model](../../02-backend-api/00-http-api/05-error-model.md) — map lỗi provider
- [AI security limits](../../09-ai-assisted-development/05-ai-security-limits.md) — nhóm ③
