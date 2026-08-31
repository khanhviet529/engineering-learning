---
level: intermediate
area: frontend
prerequisites:
  - 00-js-vocabulary.md
  - ../async-concurrency/02-promise-concurrency.md
related:
  - ../../../02-backend-api/04-architecture/04-error-handling-strategy.md
  - ../../02-react/behavior/09-error-boundaries-suspense.md
---

# Error handling & immutability

> Lỗi bị mất im lặng tệ hơn lỗi làm crash. Và state bị mutate tại chỗ là lý do UI không cập nhật dù dữ liệu đã đổi.

> **Chưa biết những từ này?** [Từ vựng JavaScript](00-js-vocabulary.md) — value vs reference, copy nông vs copy sâu

## Position

```text
Code JS → [throw / reject / Result] → boundary xử lý lỗi → log / UI / retry
        → [mutate vs copy]           → React so sánh reference → render hay không
```

## Problem — hai vấn đề, một note

**Lỗi bị mất:**

```ts
try {
  await save(data);
} catch (e) {
  console.log('error');     // stack đi đâu? loại lỗi gì? recover được không?
}
```

Bốn thông tin bị mất ở đây: nguyên nhân gốc, stack trace, loại lỗi (transient hay permanent), và context (request nào, user nào). Ba tháng sau, log này vô dụng.

**State bị mutate:**

```ts
const [items, setItems] = useState<Item[]>([]);
items.push(newItem);        // mutate mảng cũ
setItems(items);            // cùng reference → React không render
```

Hai vấn đề này nằm cùng một note vì chúng có cùng một gốc rễ: **JavaScript cho phép làm điều tiện lợi mà không cảnh báo**, và cả hai gây bug im lặng.

## Mental Model

### Error

```text
throw / reject
   ↓
lan lên theo call stack (đồng bộ) hoặc theo promise chain (async)
   ↓
gặp một BOUNDARY xử lý:
   frontend → error boundary / catch trong mutation handler
   backend  → exception filter / middleware
   ↓
Ở boundary: log ĐẦY ĐỦ (stack + context) → quyết định (retry? báo user? 500?)
```

Quy tắc: **`catch` chỉ ở nơi bạn *làm được gì* với lỗi.** Ở giữa, để nó lan lên — hoặc bọc thêm context rồi throw lại. `catch` để "cho an toàn" là cách chôn lỗi.

Phân loại lỗi quyết định cách xử lý:

| Loại | Ví dụ | Xử lý |
|---|---|---|
| **Expected / domain** | validation fail, không đủ quyền, không đủ tồn kho | trả lỗi có cấu trúc cho client; **không** log như error |
| **Transient** | timeout, 503, deadlock, kết nối đứt | retry có backoff |
| **Programmer bug** | `undefined` không mong đợi, invariant vỡ | log ở mức error, fail nhanh, sửa code |

Trộn ba loại này vào một `catch` là lý do dashboard đầy "error" mà không ai xem: 99% là validation của người dùng.

### Immutability

```text
mutate:  arr.push(x)          → cùng reference → React/memo KHÔNG thấy đổi
copy:    [...arr, x]          → reference mới  → thấy đổi
```

React (và `memo`, `useMemo`, dependency array) so sánh bằng `Object.is` — tức là **so reference** cho object và array. Mutate tại chỗ là vô hình với cơ chế đó.

Immutability không phải nguyên tắc đạo đức. Nó là điều kiện để so sánh bằng reference hoạt động — và so sánh bằng reference là điều cho phép React nhanh.

## How It Works

### Error class có ngữ nghĩa

```ts
class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);       // `cause` giữ lỗi gốc — ES2022
    this.name = new.target.name;
  }
}

class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, 'NOT_FOUND', 404);
  }
}

class ConflictError extends AppError {
  constructor(msg: string, cause?: unknown) {
    super(msg, 'CONFLICT', 409, { cause });
  }
}
```

`cause` là tính năng quan trọng và mới được dùng rộng: nó cho phép bọc thêm context **mà không mất** lỗi gốc.

```ts
try {
  await db.insert(task);
} catch (e) {
  // Thêm context, giữ nguyên nguyên nhân
  throw new ConflictError(`Cannot create task in project ${projectId}`, { cause: e });
}
```

Log thì in cả chuỗi: `error.cause` → `error.cause.cause` → ...

### `catch` cho ra `unknown`

```ts
try { /* ... */ } catch (e) {
  // e là unknown — JS có thể throw bất cứ gì: string, number, null
  if (e instanceof NotFoundError) return null;
  if (e instanceof AppError) throw e;              // đã có ngữ nghĩa, để lan lên
  throw new AppError('unexpected', 'INTERNAL', 500, { cause: e });
}
```

Đừng viết `catch (e: any) { e.message }` — nếu ai đó `throw 'oops'` thì `e.message` là `undefined` và bạn mất hoàn toàn thông tin.

### Result type — khi lỗi là chuyện thường

```ts
type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function findUser(id: string): Promise<Result<User>> {
  const u = await db.user.findUnique({ where: { id } });
  return u ? { ok: true, value: u } : { ok: false, error: new NotFoundError('User', id) };
}

const r = await findUser(id);
if (!r.ok) return handle(r.error);     // compiler BUỘC bạn xử lý
r.value.email;                          // narrow xong, an toàn
```

Dùng `Result` khi lỗi là **một kết quả bình thường** của nghiệp vụ (không tìm thấy, không đủ quyền) — vì khi đó compiler buộc bạn xử lý. Dùng `throw` cho lỗi thật sự bất thường — vì khi đó bạn *muốn* nó lan lên tới boundary.

Đừng dùng `Result` cho mọi thứ: nó bắt bạn viết plumbing ở mọi tầng trung gian, đúng cái mà exception giúp tránh.

### Immutable update

```ts
// Array
[...arr, x]                                  // thêm
arr.filter(i => i.id !== id)                 // xoá
arr.map(i => i.id === id ? { ...i, done: true } : i)   // sửa một phần tử
arr.toSorted()                               // ES2023 — bản mới, không mutate
[...arr].sort()                              // cách cũ; `arr.sort()` MUTATE

// Object lồng nhau
{ ...state, filters: { ...state.filters, status: 'open' } }
```

Method mutate cần nhớ: `sort`, `reverse`, `splice`, `push`, `pop`, `shift`, `unshift`, `fill`. Bản bất biến ES2023: `toSorted`, `toReversed`, `toSpliced`, `with`.

Với state lồng sâu, spread lồng nhau trở nên khó đọc — dùng Immer (`produce`) hoặc thiết kế lại state cho phẳng hơn. State lồng 4 tầng thường là dấu hiệu nên chuẩn hoá (normalize) thành map theo ID.

```ts
Object.freeze(obj);   // runtime: gán im lặng thất bại (hoặc throw trong strict)
// khác readonly của TS — readonly chỉ compile time
```

## Example

```ts
// Backend: mỗi tầng thêm context, boundary xử lý một lần
async function completeTask(taskId: string, userId: string) {
  const task = await repo.find(taskId);
  if (!task) throw new NotFoundError('Task', taskId);
  if (task.ownerId !== userId) throw new ForbiddenError('not owner');

  try {
    return await repo.update(taskId, { status: 'done', completedAt: new Date() });
  } catch (e) {
    throw new ConflictError(`Failed to complete task ${taskId}`, { cause: e });
  }
}
```

Không có `try/catch` nào ở controller. Exception filter là boundary duy nhất: nó map `AppError.status` → HTTP status, log theo mức phù hợp với loại lỗi. Xem [Validation & errors](../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md).

## Prediction

1. `catch (e) { console.log(e.message) }` và ai đó `throw 'oops'` — in ra gì?
2. `items.push(x); setItems(items)` — component render lại không? Vì sao?
3. `arr.sort()` — trả về mảng mới hay mutate? Còn `arr.toSorted()`?
4. `Object.freeze(o); o.x = 1` — trong module ESM (strict mode) thì sao? Trong script không strict?
5. `throw new Error('b', { cause: originalError })` — `originalError` còn truy cập được không?
6. Một `catch {}` rỗng ở tầng giữa — lỗi đi đâu? Monitoring thấy gì?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `catch {}` rỗng ở tầng service | Lỗi mất hoàn toàn; UI hiện "thành công" cho một thao tác thất bại |
| `console.log(e)` thay vì log có structure | Log không truy vấn được, không có request ID |
| Mutate state rồi `setState` cùng reference | UI không cập nhật — bug "React bị lỗi" kinh điển |
| Mutate props trong child | Parent không biết; bug xuất hiện ở nơi khác |
| Log validation error ở mức `error` | Dashboard đầy noise; alert bị bỏ qua |
| `throw` một string thay vì Error | Không có stack trace |
| Bỏ `cause` khi wrap lỗi | Chỉ thấy "Failed to complete task", không biết vì sao |
| `Promise` reject không ai catch (Node) | Process crash — xem `unhandledRejection` |

## What Usually Goes Wrong

- **`catch` rỗng hoặc chỉ `console.log`** — lỗi mất, không alert được.
- **Không phân biệt loại lỗi** → retry lỗi permanent (vô ích), hoặc không retry lỗi transient (mất availability).
- **Mất stack trace** do throw string hoặc tạo Error mới không có `cause`.
- **Log thiếu context** — không có request ID/user ID thì log không dùng được. Xem [Structured logging](../../../05-cross-cutting/observability/02-structured-logging.md).
- **Lộ thông tin trong error message** trả ra client (SQL, đường dẫn file, stack).
- **Mutate state** → UI không cập nhật, hoặc cập nhật "ngẫu nhiên".
- **Mutate object trong `useMemo`/`useEffect` dependency** → dependency không đổi reference, effect không chạy lại.
- **`try/catch` bọc quá rộng** → không biết dòng nào lỗi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `catch` mọi lỗi là phòng thủ tốt | Là cách chôn lỗi. Chỉ catch khi làm được gì |
| Mọi lỗi nên log mức `error` | Validation của user là behavior bình thường, log `info`/`warn` |
| `throw` chỉ dùng cho lỗi nghiêm trọng | Dùng cho mọi thứ bất thường; `Result` cho lỗi nghiệp vụ dự kiến |
| `readonly` của TS chặn mutate lúc runtime | Chỉ compile time; `Object.freeze` mới runtime |
| Spread copy sâu | Chỉ copy một tầng; object lồng vẫn chia sẻ reference |
| Immutability chỉ là style | Là điều kiện để so sánh reference hoạt động |
| `arr.sort()` trả mảng mới | Nó mutate **và** trả về chính mảng đó |

## Debugging

1. **Lỗi không rõ nguyên nhân** → in cả chuỗi `cause`:
   ```ts
   let e: unknown = err;
   while (e instanceof Error) { console.error(e.message, e.stack); e = e.cause; }
   ```
2. **Lỗi mất tích** → `grep -rn "catch\s*{}\|catch (.*) {}\s*$" src/` và tìm `console.log` trong catch.
3. **UI không cập nhật** → log reference: `console.log(prev === next)`. Nếu `true` thì bạn đã mutate.
4. React DevTools → Profiler → "Why did this render?" xác nhận component có nhận props mới hay không.
5. **Nghi mutate** → `Object.freeze` state trong dev; mutate sẽ throw ngay tại dòng gây ra.
6. **Node crash không rõ** → bắt `unhandledRejection` và `uncaughtException`, log rồi exit có kiểm soát.

## Production Considerations

- **Một boundary xử lý lỗi cho mỗi tầng**: exception filter ở backend, error boundary ở frontend.
- **Log có structure** với `requestId`, `userId`, `code`, `stack` — không dùng `console.log`.
- **Không trả stack/SQL cho client.** Trả `code` + message an toàn + `requestId` để đối chiếu log.
- **Alert trên lỗi programmer và lỗi transient tăng bất thường**, không alert trên validation error.
- **`unhandledRejection`/`uncaughtException`**: log rồi thoát có kiểm soát (process đã ở state không xác định).
- Frontend: gửi lỗi về một service (Sentry…) với source map để stack có ý nghĩa.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `throw` exception | code sạch ở tầng giữa | không thấy trong signature; dễ quên xử lý |
| `Result` type | compiler buộc xử lý | plumbing ở mọi tầng trung gian |
| Immutable update | so sánh reference hoạt động, dễ debug | tạo object mới (thường không đáng kể) |
| Immer | code như mutate, kết quả bất biến | thêm dependency, chút overhead |
| `Object.freeze` trong dev | bắt mutate ngay | chi phí runtime — chỉ dùng ở dev |

## Explain Without Notes

1. Ba loại lỗi và cách xử lý khác nhau của mỗi loại?
2. Vì sao `catch {}` tệ hơn để lỗi lan lên?
3. `cause` giải quyết vấn đề gì?
4. Vì sao mutate state làm React không render? Cơ chế so sánh là gì?
5. Khi nào dùng `Result` thay vì `throw`?

## Related

- [Từ vựng JavaScript](00-js-vocabulary.md) — foundation: value vs reference, copy nông vs copy sâu
- [Promise & concurrency](../async-concurrency/02-promise-concurrency.md) — unhandled rejection
- [Error handling strategy](../../../02-backend-api/04-architecture/04-error-handling-strategy.md) — chiến lược ở backend
- [Error model](../../../02-backend-api/00-http-api/05-error-model.md) — hợp đồng lỗi với client
- [Error boundaries & Suspense](../../02-react/behavior/09-error-boundaries-suspense.md) — boundary ở frontend
- [State → render](../../02-react/behavior/01-state-render.md) — vì sao reference quan trọng
- [Structured logging](../../../05-cross-cutting/observability/02-structured-logging.md)
