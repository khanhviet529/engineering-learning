---
level: intermediate
area: backend
prerequisites:
  - 01-http-request-response.md
related:
  - ../04-architecture/04-error-handling-strategy.md
  - ../02-nestjs/03-validation-errors.md
---

# Error model

> Client cần biết ba điều khi có lỗi: **có nên retry không**, **có nên hiện gì cho người dùng**, và **field nào sai**. Một `{ "error": "something went wrong" }` không trả lời được câu nào.

## Position

```text
Domain error → Exception filter → [HTTP status + error body] → Client xử lý
                                          ↑ note này
```

## Problem

```json
// Client nhận được cái này và phải làm gì?
{ "message": "Error" }
{ "error": true }
"Internal Server Error"
{ "statusCode": 500, "message": "Cannot read properties of undefined (reading 'id')" }
```

Cái cuối tệ nhất: nó vừa vô dụng cho client vừa **lộ chi tiết implementation** cho attacker (cấu trúc code, biến nào tồn tại).

Hệ quả thực tế của một error model kém:

- Client viết `if (msg.includes('not found'))` — coupling vào chuỗi tiếng Anh, và hỏng khi bạn sửa message.
- Form không map được lỗi về field, nên hiện một toast chung; người dùng không biết sửa gì.
- Client retry lỗi validation vô ích, hoặc không retry lỗi transient.
- Không có cách nào để người dùng báo lỗi mà bạn tìm được log tương ứng.

## Mental Model

Hợp đồng lỗi phải trả lời **ba câu hỏi của client**, và mỗi câu ứng với một phần của response:

```text
1. "Ai sai, tôi hay server? Có nên retry?"     → HTTP STATUS (4xx vs 5xx)
2. "Tôi xử lý trường hợp này thế nào?"          → CODE (định danh máy đọc được)
3. "Hiện gì cho người dùng? Field nào sai?"      → MESSAGE + DETAILS
```

Và một câu hỏi thứ tư của **bạn**:

```text
4. "Người dùng báo lỗi này, log ở đâu?"          → REQUEST ID
```

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Không tìm thấy task",
    "requestId": "018f4c2e-7a1b-4f3d-9c8e-2b5a1d4f6e8c"
  }
}
```

```json
// Lỗi validation — cần details theo field
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Dữ liệu không hợp lệ",
    "requestId": "018f...",
    "details": {
      "title": ["Bắt buộc"],
      "dueDate": ["Phải ở tương lai"]
    }
  }
}
```

**`code` là phần quan trọng nhất.** Nó là phần duy nhất client được phép branch trên. `message` dành cho con người và có thể đổi bất cứ lúc nào (i18n, viết lại cho rõ hơn); `code` là hợp đồng.

## How It Works

### Phân loại lỗi → status → hành vi

| Loại | Status | `code` ví dụ | Client nên | Log mức |
|---|---|---|---|---|
| Validation | 400 | `VALIDATION_FAILED` | hiện lỗi theo field | `info` |
| Chưa xác thực | 401 | `UNAUTHENTICATED` | chuyển tới login | `info` |
| Token hết hạn | 401 | `TOKEN_EXPIRED` | **refresh rồi retry** | `info` |
| Không có quyền | 403 | `FORBIDDEN` | hiện thông báo | `warn` |
| Không tồn tại | 404 | `TASK_NOT_FOUND` | hiện empty state | `info` |
| Xung đột state | 409 | `TASK_ALREADY_DONE` | reload rồi thử lại | `info` |
| Nghiệp vụ từ chối | 422 | `INSUFFICIENT_STOCK` | hiện lý do cụ thể | `info` |
| Rate limit | 429 | `RATE_LIMITED` | chờ `Retry-After` rồi retry | `warn` |
| Lỗi nội bộ | 500 | `INTERNAL_ERROR` | hiện lỗi chung, retry được | `error` |
| Dependency chậm/hỏng | 503 | `SERVICE_UNAVAILABLE` | retry có backoff | `error` |

Hai hàng đáng chú ý:

- **`TOKEN_EXPIRED` tách khỏi `UNAUTHENTICATED`** — nếu cùng một mã, client không biết nên refresh token hay bắt người dùng login lại. Đây là ví dụ rõ nhất về giá trị của `code`.
- **Validation log ở mức `info`, không `error`** — người dùng gửi dữ liệu sai là behavior bình thường. Log nó ở mức `error` làm dashboard đầy noise và alert bị bỏ qua.

### Implementation

```ts
// Domain error mang đủ thông tin để tầng HTTP dịch
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource.toUpperCase()}_NOT_FOUND`, 404, `Không tìm thấy ${resource}`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, cause?: unknown) {
    super(code, 409, message, undefined, { cause });
  }
}
```

```ts
// Exception filter — MỘT nơi dịch domain error → HTTP
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = ctx.getRequest<Request>().id;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Có lỗi xảy ra';
    let details: Record<string, string[]> | undefined;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 400 ? 'VALIDATION_FAILED' : 'HTTP_ERROR';
      // ... map từ response của Nest
    }

    // Log THEO MỨC PHÙ HỢP với loại lỗi
    const level = status >= 500 ? 'error' : status === 403 || status === 429 ? 'warn' : 'info';
    this.logger[level]({ err, requestId, code, status }, message);

    // KHÔNG bao giờ gửi stack hay message của lỗi không xác định ra ngoài
    res.status(status).json({ error: { code, message, requestId, details } });
  }
}
```

Điểm quan trọng: với lỗi **không** phải `AppError` (tức lỗi bất ngờ), message trả về là chuỗi chung `'Có lỗi xảy ra'`, **không** phải `err.message`. Log giữ chi tiết; client chỉ nhận `requestId`.

### Client xử lý

```ts
type ApiError = {
  error: { code: string; message: string; requestId: string; details?: Record<string, string[]> };
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.ok) return res.json();

  const body = (await res.json().catch(() => null)) as ApiError | null;
  throw new ApiClientError(
    body?.error.code ?? 'UNKNOWN',
    body?.error.message ?? res.statusText,
    res.status,
    body?.error.details,
    body?.error.requestId,
  );
}

// Branch trên CODE, không trên message
try {
  await request('/api/tasks', { method: 'POST', body });
} catch (e) {
  if (!(e instanceof ApiClientError)) throw e;

  switch (e.code) {
    case 'VALIDATION_FAILED':  return setFieldErrors(e.details ?? {});
    case 'TOKEN_EXPIRED':      return refreshThenRetry();
    case 'TASK_ALREADY_DONE':  return toast('Task đã hoàn thành, đang tải lại');
    case 'RATE_LIMITED':       return toast('Quá nhiều yêu cầu, thử lại sau');
    default:                   return toast(`Lỗi. Mã: ${e.requestId}`);
  }
}
```

Dòng cuối là chi tiết nhỏ có giá trị lớn: người dùng chụp màn hình có `requestId`, bạn `grep` log và thấy đúng stack trace.

## Example

```ts
// Domain layer ném lỗi có ngữ nghĩa — không biết gì về HTTP
async function completeTask(id: string, userId: string) {
  const task = await repo.find(id);
  if (!task) throw new NotFoundError('task', id);
  if (task.ownerId !== userId) throw new AppError('FORBIDDEN', 403, 'Không có quyền');
  if (task.status === 'done') throw new ConflictError('TASK_ALREADY_DONE', 'Task đã hoàn thành');

  return repo.update(id, { status: 'done' });
}
```

Controller không có `try/catch`. Exception filter là boundary duy nhất. Xem [Error handling strategy](../04-architecture/04-error-handling-strategy.md).

## Prediction

1. Client nhận `{ "message": "Error" }` với status 500 cho một lỗi validation — nó retry bao nhiêu lần?
2. Client branch trên `message.includes('not found')`, bạn đổi message sang tiếng Việt — client thế nào?
3. `TOKEN_EXPIRED` và `UNAUTHENTICATED` dùng cùng một `code` — client biết nên refresh hay login lại?
4. Trả `err.message` cho lỗi không xác định — attacker học được gì?
5. Log mọi lỗi validation ở mức `error`, 1000 user/ngày — dashboard thế nào?
6. Không có `requestId` trong response, user báo "tôi gặp lỗi lúc 3h chiều" — bạn tìm log thế nào?
7. Trả 200 với `{ error: ... }` — monitoring theo 5xx rate thấy gì?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Trả 500 cho validation error, bật retry ở client | Retry storm vô ích |
| Branch trên message rồi đổi message | Client hỏng im lặng |
| Trả `err.message` của lỗi không xác định | Đọc response: thấy tên biến, đường dẫn file |
| Bỏ `details` cho validation | Form không map được lỗi về field |
| Log validation ở mức `error` | Đếm số error/ngày; alert vô dụng |
| Bỏ `requestId` | Thử tìm log cho một lỗi user báo |
| Dùng chung `code` cho 401 hết hạn và 401 chưa login | Client hoặc không refresh, hoặc logout sai |
| Trả 200 cho lỗi | Dashboard 5xx = 0% trong khi user gặp lỗi |
| Message lỗi khác nhau giữa các endpoint cho cùng loại lỗi | Client phải xử lý từng trường hợp |

## What Usually Goes Wrong

- **Không có `code`** → client phải parse message.
- **Trả stack trace / message nội bộ** → lộ thông tin.
- **Không có `details`** cho validation → UX kém.
- **Nhầm 4xx/5xx** → retry sai hướng.
- **Trả 200 cho lỗi** → monitoring vô dụng.
- **Log mọi lỗi ở mức `error`** → alert fatigue.
- **Không có `requestId`** → không truy được log.
- **Hình dạng lỗi khác nhau giữa các endpoint** → client viết N cách xử lý.
- **`code` không ổn định** (đổi tên tuỳ ý) → phá client như đổi message.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Message đủ để client xử lý | Message dành cho người; `code` cho máy |
| Trả nhiều chi tiết giúp debug | Giúp attacker; log giữ chi tiết, response giữ `requestId` |
| Mọi lỗi nên log mức `error` | Validation là behavior bình thường |
| Status code đủ, không cần `code` | 400 có thể là 10 lý do khác nhau |
| Client tự biết có nên retry | Bạn phải nói qua status và `code` |
| `code` là chi tiết nội bộ | Nó là phần **ổn định nhất** của hợp đồng lỗi |
| Trả 200 với error body thuận tiện hơn | Nó phá cache, retry, monitoring |

## Debugging

1. **Client báo lỗi không rõ** → xin `requestId`, `grep` log. Nếu không có `requestId`, thêm nó trước khi làm gì khác.
2. **Kiểm tra hình dạng lỗi nhất quán**: gọi mọi loại lỗi bằng `curl` và so sánh response. Chúng phải cùng hình dạng.
3. **Nghi lộ thông tin** → tạo một lỗi runtime thật (ví dụ truy cập field của `undefined`) và đọc response ở môi trường production build.
4. **Alert noise** → nhóm log theo `code` và mức; nếu `error` chủ yếu là validation, sửa mức log.
5. **Client retry sai** → kiểm tra map giữa loại lỗi và status trên server.
6. Thêm test cho error path: mỗi `code` nên có một test xác nhận status và hình dạng response.

## Production Considerations

- **Một hình dạng lỗi cho toàn API**, thực thi bằng một exception filter duy nhất.
- **`code` là hợp đồng** — tài liệu hoá và không đổi tuỳ ý; thêm mã mới thay vì đổi mã cũ.
- **`requestId` trong mọi response lỗi** và trong mọi log line. Xem [Correlation & tracing](../../05-cross-cutting/observability/03-correlation-tracing.md).
- **Không bao giờ trả stack/SQL/đường dẫn** ra ngoài.
- **Log theo mức phù hợp**; alert chỉ trên 5xx và trên tăng bất thường của 4xx cụ thể (429, 403 có thể là dấu hiệu tấn công).
- **i18n message ở client**, dựa trên `code` — server không nên biết ngôn ngữ của người dùng.
- **Tài liệu hoá mọi `code`** trong OpenAPI spec.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `code` + `details` | client xử lý chính xác | phải định nghĩa và bảo trì danh sách mã |
| Chỉ status code | đơn giản | client không phân biệt được lý do |
| Message chi tiết | dễ debug | rủi ro lộ thông tin |
| Message chung + `requestId` | an toàn, vẫn truy được | cần hạ tầng log tốt |
| i18n ở server | client đơn giản | server phải biết locale, khó cache |
| i18n ở client | server đơn giản, cache tốt | client phải map mọi `code` |

## Explain Without Notes

1. Ba câu hỏi của client khi có lỗi, và phần nào của response trả lời mỗi câu?
2. Vì sao `code` quan trọng hơn `message`?
3. Vì sao `TOKEN_EXPIRED` nên tách khỏi `UNAUTHENTICATED`?
4. Vì sao không trả `err.message` cho lỗi không xác định?
5. Vì sao validation error không nên log ở mức `error`?

## Related

- [HTTP request/response](01-http-request-response.md) — chọn status code
- [Error handling strategy](../04-architecture/04-error-handling-strategy.md) — chiến lược trong app
- [Validation & errors (NestJS)](../02-nestjs/03-validation-errors.md) — implementation
- [Error handling & immutability](../../01-web-frontend/01-javascript-typescript/09-error-handling-immutability.md) — phân loại lỗi
- [Forms](../../01-web-frontend/02-react/10-forms.md) — map `details` về field
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md)
- [Rate limiting](07-rate-limiting.md) — 429 và `Retry-After`
