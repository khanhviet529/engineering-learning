---
level: intermediate
area: backend
prerequisites:
  - ../02-nestjs/03-validation-errors.md
related:
  - ../00-http-api/05-error-model.md
  - ../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
  - ../../05-cross-cutting/observability/02-structured-logging.md
---

# Error handling strategy

> Dashboard báo error rate 4%. Bạn mở log: 12.000 dòng `error` trong một giờ. Đọc kỹ thì 11.800 dòng là người dùng gửi form thiếu field. 200 dòng còn lại là kết nối database bị từ chối. Alert đã được tắt tiếng từ tháng trước vì "nó kêu suốt". Sự cố thật đã chạy 40 phút trước khi có người nhận ra.

## Position

```text
Lỗi phát sinh ở BẤT KỲ tầng nào
   domain · repository · HTTP client · queue worker · DB driver
        ↓
Nó phải đi tới ba nơi khác nhau, với ba nội dung khác nhau:
   → CLIENT     (đủ để hành động, không lộ nội bộ)
   → LOG        (đủ để điều tra)
   → ALERT      (chỉ khi cần con người)
```

Chiến lược xử lý lỗi là một quyết định **toàn hệ thống**, không phải một loạt `try/catch` rải rác. Note này về quyết định đó.

## Problem

### Vấn đề 1: mọi lỗi trông như nhau

```ts
try {
  await this.doWork();
} catch (err) {
  this.logger.error(err);                       // mọi thứ là 'error'
  throw new InternalServerErrorException();     // mọi thứ là 500
}
```

Bốn tình huống hoàn toàn khác nhau bị nén thành một:

| Chuyện thật xảy ra | Client nên làm gì | Bạn nên làm gì |
|---|---|---|
| Thiếu field trong form | sửa rồi gửi lại | không gì cả |
| Token hết hạn | refresh, hoặc đăng nhập lại | không gì cả |
| Task đã đóng rồi | tải lại, hiển thị trạng thái mới | không gì cả |
| Database từ chối kết nối | thử lại sau | **dậy ngay** |

Nén cả bốn thành `500 Internal Server Error` khiến client chỉ có một hành vi: thử lại. Và với ba trường hợp đầu, thử lại là sai — nó sẽ fail y hệt, mãi mãi.

### Vấn đề 2: log nhiễu làm mù

Nếu 4xx được log ở mức `error`, tỉ lệ tín hiệu/nhiễu là 1:60 như ví dụ mở đầu. Hệ quả không phải "log hơi lộn xộn" mà là **alert bị tắt**, và sau đó bạn không có hệ thống cảnh báo nào cả.

### Vấn đề 3: `catch` nuốt lỗi

```ts
try {
  await this.analytics.track(event);
} catch (e) {
  // không sao, analytics thôi
}
```

Sáu tháng sau, analytics đã ngừng hoạt động ba tháng và không ai biết. Bắt lỗi mà không ghi lại là **xoá thông tin**, và thông tin đó không lấy lại được.

## Mental Model

### Bốn loại lỗi

```text
                  ai sai?      client sửa được?  retry được?  log      alert
INPUT     4xx     client       có                không        debug    không
AUTH      401/403 client       có (login)        không        info     ngưỡng bất thường
BUSINESS  404/409/422 không ai  tuỳ              không        info     ngưỡng bất thường
SYSTEM    5xx     chúng ta     không             CÓ           error    CÓ
```

Chỉ hàng cuối đáng đánh thức người. Ba hàng trên là **hành vi bình thường của một hệ thống có người dùng thật** — chúng nên được đếm, không nên được báo động.

Ngoại lệ đáng chú ý: đột biến ở ba hàng trên vẫn là tín hiệu. 403 tăng gấp 50 lần trong 5 phút là dấu hiệu deploy sai hoặc bị dò quét. Alert trên **tỉ lệ bất thường**, không phải trên **sự tồn tại**.

### Quy tắc bắt lỗi

```text
CHỈ bắt khi bạn LÀM ĐƯỢC một trong ba việc:

1. THÊM NGỮ CẢNH rồi ném tiếp
   catch (e) { throw new StorageError('không upload được avatar', { userId, cause: e }); }

2. XỬ LÝ THẬT SỰ — có phương án thay thế
   catch (e) { logger.warn(...); return cachedValue; }

3. DỊCH sang loại lỗi của tầng bạn
   catch (e) { if (e.code === '23505') throw new ConflictError(...); throw e; }

Mọi trường hợp khác: ĐỪNG BẮT. Để nó lên tới ranh giới, nơi có đủ ngữ cảnh.
```

Cái phản trực giác: **`try/catch` càng ít càng tốt.** Một `catch` sai chỗ (không đủ thông tin để xử lý) chỉ làm mất stack trace và tạo cảm giác an toàn giả.

### Một ranh giới, một nơi dịch

```text
domain     ném DomainError          (NotFoundError, ConflictError, RuleViolation)
repository ném InfraError           (dịch mã lỗi driver ngay tại chỗ biết ý nghĩa)
                    ↓
        MỘT exception filter        ← nơi duy nhất biết HTTP status
                    ↓
        response + log + metric
```

Nếu có hai nơi dịch lỗi sang HTTP, chúng sẽ bất đồng, và client sẽ nhận hai hình dạng lỗi khác nhau cho cùng một loại vấn đề.

## How It Works

### Cây lỗi

```ts
export abstract class AppError extends Error {
  abstract readonly code: string;          // ổn định, client dựa vào cái này
  abstract readonly retryable: boolean;    // client/worker có nên thử lại?
  constructor(message: string, readonly context: Record<string, unknown> = {},
              options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

// người dùng sai — không retry
export class ValidationError extends AppError { code = 'validation_error'; retryable = false; }
export class NotFoundError   extends AppError { code = 'not_found';       retryable = false; }
export class ConflictError   extends AppError { code = 'conflict';        retryable = false; }
export class RuleViolation   extends AppError { code = 'rule_violation';  retryable = false; }
export class ForbiddenError  extends AppError { code = 'forbidden';       retryable = false; }

// chúng ta sai hoặc hạ tầng sai — có thể retry
export class UpstreamError   extends AppError { code = 'upstream_error';  retryable = true; }
export class TimeoutError    extends AppError { code = 'timeout';         retryable = true; }
export class StorageError    extends AppError { code = 'storage_error';   retryable = true; }
```

Ba trường, mỗi trường phục vụ một mục đích khác nhau:

- **`code`** — hợp đồng với client. Ổn định, không đổi khi bạn sửa message.
- **`retryable`** — quyết định của **bạn**, người biết bản chất lỗi, không phải của người gọi đang đoán. Worker và HTTP client đọc nó. Xem [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).
- **`context`** — dữ liệu có cấu trúc cho log. Không nhét vào message.

### `cause`: giữ chuỗi nguyên nhân

```ts
try {
  await this.s3.putObject(params);
} catch (e) {
  throw new StorageError('upload avatar thất bại', { userId, key }, { cause: e });
}
```

`cause` (chuẩn ES2022, Node 16.9+) giữ lỗi gốc. Không có nó, bạn có một `StorageError` đẹp đẽ và không biết S3 thật sự nói gì.

```ts
// khi log, đi hết chuỗi
function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: any = err;
  while (cur && out.length < 5) { out.push({ name: cur.name, message: cur.message }); cur = cur.cause; }
  return out;
}
```

### Filter: một nơi, ba đích đến

```ts
const STATUS: Record<string, number> = {
  validation_error: 400, forbidden: 403, not_found: 404,
  conflict: 409, rule_violation: 422,
  timeout: 504, upstream_error: 502, storage_error: 503,
};

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id: string; user?: { id: string } }>();

    const { status, code, message, context } = classify(err);

    // 1. LOG — mức theo status, ngữ cảnh có cấu trúc
    const entry = {
      requestId: req.id, userId: req.user?.id, method: req.method,
      route: req.route?.path, status, code, context, err: chain(err),
    };
    if (status >= 500)      this.logger.error(entry, message);
    else if (status === 429) this.logger.warn(entry, message);
    else                     this.logger.debug(entry, message);

    // 2. METRIC — đếm theo code, không theo message
    this.metrics.increment('http_errors_total', { code, status: String(status) });

    // 3. RESPONSE — 5xx KHÔNG lộ chi tiết
    res.status(status).json({
      error: {
        code,
        message: status >= 500 ? 'Đã có lỗi xảy ra, vui lòng thử lại sau' : message,
        requestId: req.id,
        ...(status >= 500 ? {} : { details: context }),
      },
    });
  }
}
```

Bốn tính chất bắt buộc của filter này:

1. **`requestId` luôn có trong response.** Nó là cầu nối duy nhất giữa "người dùng nói có lỗi" và "dòng log tương ứng". Không có nó, hỗ trợ khách hàng là đoán mò.
2. **5xx không bao giờ lộ `err.message`.** Message của PostgreSQL chứa tên bảng, tên cột, đôi khi cả giá trị.
3. **Mức log theo status**, không theo cảm tính.
4. **Metric theo `code`**, không theo `message` — message có thể chứa id và làm nổ cardinality.

Và filter **không được ném lỗi**. Lỗi trong lúc xử lý lỗi cho ra 500 trống hoặc treo connection. Bọc thân filter trong `try/catch` với một response dự phòng cứng.

### Dịch lỗi ở đúng nơi biết ý nghĩa

```ts
// repository — chỉ ở đây mới biết '23505' nghĩa là gì
try {
  return await this.db.user.create({ data });
} catch (e: any) {
  if (e.code === 'P2002' || e.code === '23505')
    throw new ConflictError('email đã được đăng ký', { email: data.email }, { cause: e });
  if (e.code === 'P2003' || e.code === '23503')
    throw new ValidationError('tham chiếu không tồn tại', {}, { cause: e });
  if (e.code === '40P01') throw new UpstreamError('deadlock', {}, { cause: e });   // retryable
  throw new StorageError('database error', {}, { cause: e });
}
```

```ts
// HTTP client — phân biệt lỗi CỦA HỌ và lỗi CỦA MÌNH
if (res.status >= 500) throw new UpstreamError('payment provider lỗi', {}, { cause: err });  // retry
if (res.status === 429) throw new UpstreamError('bị rate limit', { retryAfter }, {});        // retry có chờ
if (res.status >= 400) throw new ValidationError('request tới provider không hợp lệ');        // KHÔNG retry
```

Dòng cuối quan trọng: 4xx từ upstream là **lỗi của bạn**, và retry sẽ fail y hệt 5 lần. Nhiều hệ thống retry mọi lỗi HTTP và tạo ra tải vô ích cùng log nhiễu.

### Lỗi ngoài đường request

```ts
// những chỗ này KHÔNG có exception filter — phải xử lý riêng
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);                       // để process manager restart — trạng thái đã không xác định
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
```

Vì sao thoát chứ không cố sống tiếp: sau một `uncaughtException`, bạn không biết state nào đã hỏng. Một process ở trạng thái không xác định phục vụ request là nguy hiểm hơn một process chết được restart. Xem [Process & memory](../01-nodejs/03-process-memory.md).

Bốn nơi khác cũng nằm ngoài filter:

```text
Queue worker    → @OnWorkerEvent('failed'), phân loại retryable, DLQ
Cron job        → try/catch bao toàn bộ, log, KHÔNG để lỗi làm chết scheduler
Lifecycle hook  → lỗi trong onModuleInit làm app không start (thường là đúng)
WebSocket       → WsException, filter riêng
```

### Degradation: lỗi không phải lúc nào cũng nên lan ra

```ts
// dependency KHÔNG thiết yếu — hỏng thì đi tiếp, nhưng phải GHI LẠI
async getRecommendations(userId: string): Promise<Product[]> {
  try {
    return await this.recommender.fetch(userId);
  } catch (e) {
    this.logger.warn({ err: e, userId }, 'recommender unavailable, dùng fallback');
    this.metrics.increment('degraded_total', { feature: 'recommendations' });   // ĐẾM ĐƯỢC
    return this.popular.top(10);
  }
}
```

Khác biệt với "nuốt lỗi" nằm ở hai dòng: `logger.warn` và `metrics.increment`. Degradation không đếm được là degradation vĩnh viễn mà không ai biết.

Phân loại dependency **tường minh** trong tài liệu và trong code:

```text
BẮT BUỘC (hỏng ⇒ lỗi):        database, auth
TUỲ CHỌN (hỏng ⇒ giảm chức năng): cache, recommender, analytics, search
```

Xem [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md).

## Example

Cùng một sự cố, hai chiến lược:

```text
Sự cố: cổng thanh toán trả 503 trong 10 phút

KHÔNG có chiến lược
  · catch chung → 500 "Internal server error"
  · client thử lại 5 lần ngay lập tức → khuếch đại tải lên cổng đang chết
  · log lẫn với 11.000 dòng lỗi validation
  · không ai biết cho tới khi khách hàng gọi

CÓ chiến lược
  · repository: UpstreamError(retryable: true, cause: <503 gốc>)
  · client HTTP: retry 3 lần, exponential backoff + jitter, rồi dừng
  · filter: 502, message chung, requestId, log level error
  · metric: http_errors_total{code="upstream_error"} tăng vọt
  · alert: "upstream_error > 1% trong 5 phút" → nổ sau 5 phút
  · người dùng: "Thanh toán tạm thời không khả dụng, vui lòng thử lại sau ít phút"
```

Khác biệt không nằm ở việc tránh được sự cố — không tránh được. Khác biệt là **5 phút thay vì 40 phút**, và người dùng nhận một thông báo có nghĩa thay vì một lỗi trống.

## Prediction

1. Mọi lỗi thành 500 — client làm gì khi gửi form thiếu field? Hành vi đó đúng không?
2. 4xx được log ở mức `error`, 12.000 lỗi validation/giờ — chuyện gì xảy ra với alert sau một tháng?
3. `catch (e) {}` quanh một lời gọi analytics, dịch vụ đó chết 3 tháng — bao giờ bạn biết?
4. Ném `new Error('failed')` không có `cause` từ một catch — bạn mất gì khi điều tra?
5. Filter trả `err.message` cho lỗi Prisma 500 — client đọc được gì?
6. Retry mọi lỗi HTTP kể cả 400 — bao nhiêu lần thử vô ích cho một request sai định dạng?
7. `unhandledRejection` không có handler trong Node hiện đại — process thế nào?
8. Response không có `requestId`, user báo "lúc 10 giờ tôi bị lỗi" — bạn tìm log thế nào?
9. Filter ném lỗi trong lúc format response — client nhận gì?
10. Metric đếm lỗi theo `message` chứa id (`"task abc-123 not found"`) — hệ thống metric thế nào?
11. Cache chết, code không bắt lỗi cache — API còn phục vụ được không?

<details>
<summary>Đáp án</summary>

1. Thử lại — và fail y hệt, vĩnh viễn. Client không có cách nào biết là phải sửa input.
2. Bị tắt tiếng. Và sau đó sự cố thật cũng không ai thấy.
3. Khi có người hỏi "sao dashboard trống". Có thể là không bao giờ.
4. Nguyên nhân gốc. Bạn có `failed` và không có gì khác.
5. Tên bảng, tên constraint, có thể cả giá trị: `Unique constraint failed on the fields: (email)`.
6. 4 lần thừa mỗi request, nhân với số request. Log nhiễu và tải vô ích.
7. Node **thoát** với exit code khác 0 (mặc định từ Node 15). Nếu không có log, bạn thấy pod restart không rõ lý do.
8. Grep theo thời gian và đoán. Với hệ thống có traffic, đây là việc bất khả thi.
9. 500 trống hoặc connection treo — và không có log về lỗi gốc.
10. Cardinality nổ; hệ thống metric chậm hoặc từ chối ghi, và hoá đơn tăng.
11. **Không** — cache trở thành single point of failure. Đây là lỗi thiết kế phổ biến ở hệ thống có cache.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi mọi lỗi thành 500, gửi form sai | Client làm gì? Có sửa được không? |
| Log 400 ở mức `error`, chạy load test với payload sai | Đếm dòng log; ước lượng chi phí lưu trữ |
| Bọc một lời gọi bằng `catch {}`, tắt dịch vụ đó | Bao lâu để phát hiện? |
| Ném lỗi mới không có `cause` | Thử điều tra từ log — thiếu gì? |
| Trả `err.message` cho 500 từ Prisma | Đọc xem lộ gì |
| Retry một request 400 | Đếm số lần thử vô ích |
| Xoá `requestId` khỏi response | Thử tìm log cho một lỗi cụ thể |
| Ném lỗi bên trong filter | Client nhận gì? Log có gì? |
| Tắt Redis khi API đang chạy | Endpoint đọc còn hoạt động không? |
| Tắt database | Endpoint có trả 503 với message rõ ràng không, hay 500 trống? |
| Đếm metric theo `message` có id, chạy 1.000 request | Số series tăng bao nhiêu |
| Tạo unhandled rejection cố ý | Process thoát? Có log không? Pod restart? |

## What Usually Goes Wrong

- **Mọi lỗi là 500** → client không phân biệt được, retry sai.
- **4xx log ở mức error** → alert fatigue → alert bị tắt → mù.
- **`catch {}` rỗng** → mất thông tin vĩnh viễn.
- **Ném lỗi mới không `cause`** → mất nguyên nhân gốc.
- **Lộ chi tiết nội bộ ở 5xx** → rò rỉ schema và stack trace.
- **Không có `requestId`** → không lần được từ báo cáo người dùng tới log.
- **Retry lỗi không retry được** → tải vô ích, log nhiễu.
- **Không retry lỗi tạm thời** → sự cố thoáng qua thành lỗi cho người dùng.
- **Không xử lý `unhandledRejection`** → pod restart bí ẩn.
- **Filter ném lỗi** → 500 trống.
- **Metric theo message** → cardinality nổ.
- **Cache/dependency phụ làm chết request chính** → tối ưu hoá thành điểm chết.
- **Message lỗi dùng làm hợp đồng** → client parse tiếng Anh; đổi câu chữ là breaking change.
- **Message lỗi tiết lộ ở endpoint auth** ("email không tồn tại" vs "sai mật khẩu") → cho phép dò danh sách user.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Bắt lỗi nhiều là cẩn thận | `catch` không xử lý được gì chỉ làm mất thông tin |
| Mọi lỗi nên được log | 4xx nên đếm, không nên log ở mức error |
| Message lỗi chi tiết luôn tốt | Với 5xx, chi tiết là rò rỉ |
| Client parse message được | `code` mới là hợp đồng; message để cho người đọc |
| Retry luôn giúp | Với lỗi vĩnh viễn, retry chỉ nhân lên vấn đề |
| 500 nghĩa là "lỗi không xác định" | Nó nghĩa là "lỗi của chúng ta"; hãy phân loại tiếp |
| Bắt lỗi ở mọi tầng là phòng thủ tốt | Nó làm mất stack trace và làm luồng khó hiểu |
| Try/catch quanh mọi await | Chỉ bắt khi làm được một trong ba việc |
| Lỗi trong worker cũng qua filter | Không — cần xử lý riêng |
| Degradation là bỏ qua lỗi | Degradation phải được log và đếm |

## Debugging

1. **Bắt đầu từ `requestId`** người dùng cung cấp → một dòng log → toàn bộ ngữ cảnh.
2. **Không có `requestId`** → đó là việc cần sửa trước, không phải sau.
3. **Lỗi không xuất hiện trong log** → tìm `catch` không log; tìm interceptor `catchError` không ném lại.
4. **Không biết nguyên nhân gốc** → chuỗi `cause` bị cắt ở đâu?
5. **Phân biệt "của chúng ta" và "của họ"** → nhìn `code`: `upstream_error` vs `storage_error` vs `rule_violation`.
6. **Error rate cao nhưng người dùng không phàn nàn** → gần như chắc chắn 4xx đang bị tính là error.
7. **Pod restart không rõ lý do** → `kubectl logs --previous`; tìm `unhandledRejection`, `uncaughtException`, hoặc exit 137 (OOM).
8. **Log quá nhiều để đọc** → lọc theo `code`, không theo text. Đây là lý do `code` phải ổn định.

## Production Considerations

- **`requestId` sinh ở biên** (reverse proxy hoặc middleware đầu tiên), truyền xuống mọi tầng, trả về client, gắn vào mọi dòng log. Đây là hạ tầng có tỉ lệ giá trị/chi phí cao nhất trong toàn bộ observability. Xem [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
- **Alert trên tỉ lệ, không trên số tuyệt đối.** "5xx > 1% trong 5 phút" hữu ích; "có một lỗi 500" là nhiễu.
- **Alert cả trên 4xx bất thường.** 403 tăng 50 lần là deploy sai hoặc bị dò quét.
- **Đưa `code` vào tài liệu API.** Client cần danh sách code có thể nhận và ý nghĩa của chúng.
- **`code` là hợp đồng, message thì không.** Bạn được phép sửa câu chữ; không được sửa `code` mà không version hoá.
- **Redact PII trong `context`** trước khi log: email, số điện thoại, token, số thẻ.
- **Sampling cho lỗi tần suất cao.** Log 1% của một lỗi xuất hiện 10.000 lần/phút cộng với một counter đầy đủ, thay vì 10.000 dòng.
- **Kiểm tra định kỳ các nhánh degradation.** Nếu fallback chưa bao giờ chạy trong 6 tháng, nó có thể đã hỏng. Chủ động tắt dependency phụ trên staging là cách duy nhất biết.
- **Đưa lỗi vào SLO.** "99,9% request không lỗi hệ thống" là mục tiêu đo được; "ít lỗi" thì không. Xem [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cây lỗi riêng | phân loại rõ, dịch một chỗ | thêm code, phải bảo trì |
| Dùng thẳng `HttpException` | ít code | domain dính HTTP, không dùng lại được |
| Message chi tiết cho 4xx | client debug dễ | có thể lộ thông tin ở endpoint nhạy cảm |
| Message chung cho 5xx | không rò rỉ | hỗ trợ khách hàng phụ thuộc `requestId` |
| Log mọi lỗi | không mất gì | chi phí, nhiễu |
| Log theo mức | tín hiệu sạch | có thể bỏ sót nếu phân loại sai |
| `retryable` do server quyết định | client không phải đoán | phải phân loại đúng, và sai thì lan rộng |
| Degradation | chịu lỗi tốt | lỗi ẩn nếu không đếm |
| Fail fast | vấn đề lộ ngay | ít chịu lỗi hơn |
| Sampling log | rẻ | có thể bỏ lỡ trường hợp hiếm |

## Explain Without Notes

1. Bốn loại lỗi, và mức log + hành vi alert cho mỗi loại?
2. Ba lý do hợp lệ để bắt một lỗi. Điều gì xảy ra khi bắt vì lý do khác?
3. Vì sao 5xx không được trả `err.message`? Cho một ví dụ cụ thể về thứ bị lộ.
4. `cause` giải quyết vấn đề gì?
5. Vì sao `code` chứ không phải `message` là hợp đồng với client?
6. Vì sao alert nên dựa trên tỉ lệ chứ không phải sự tồn tại của lỗi?
7. Degradation khác nuốt lỗi ở hai dòng code nào?
8. Vì sao `unhandledRejection` nên làm process thoát?

## Related

- [Error model](../00-http-api/05-error-model.md) — hình dạng lỗi ở tầng hợp đồng API
- [Validation & errors](../02-nestjs/03-validation-errors.md) — implementation trong NestJS
- [Domain logic boundaries](03-domain-logic-boundaries.md) — vì sao domain ném lỗi domain
- [Timeout, retry & circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — `retryable` được dùng ở đâu
- [Graceful degradation](../../05-cross-cutting/reliability/03-graceful-degradation.md) — dependency bắt buộc vs tuỳ chọn
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md) — hình dạng dòng log
- [Correlation ID & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md) — `requestId` xuyên hệ thống
- [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md) — error rate như một mục tiêu
- [Error handling & immutability (JS)](../../01-web-frontend/01-javascript-typescript/09-error-handling-immutability.md) — cơ chế lỗi trong JavaScript
- [Process & memory](../01-nodejs/03-process-memory.md) — vì sao thoát khi state không xác định

## Version / Context

`Error.cause` cần Node 16.9+ và `target: ES2022` trong TypeScript. `Error.captureStackTrace` là API của V8 (Node/Chrome), không có ở mọi runtime.
