---
level: foundation
area: frontend
prerequisites:
  - 01-event-loop-async.md
related:
  - 09-error-handling-immutability.md
  - ../02-react/03-async-race-condition.md
  - ../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
---

# Promise & concurrency

> `await` trong vòng lặp biến 10 request 100ms thành 1 giây. `Promise.all` biến chúng thành 100ms — và có thể làm sập dependency của bạn. Note này về việc chọn đúng mức song song.

## Position

```text
Code của bạn → [Promise combinator] → nhiều I/O đồng thời → API / DB / file
                      ↑ note này
```

## Problem

Bạn cần lấy dữ liệu cho 200 task, mỗi task cần một lần gọi API.

- **Tuần tự**: 200 × 100ms = 20 giây. Người dùng bỏ đi.
- **Tất cả cùng lúc**: 100ms — nhưng 200 kết nối đồng thời có thể làm cạn connection pool, kích hoạt rate limit, hoặc đánh sập service kia.

Đáp án đúng gần như luôn ở giữa: **song song có giới hạn**. Và để chọn được giới hạn, bạn cần biết các combinator khác nhau ở đâu, đặc biệt là ở cách chúng xử lý **lỗi**.

## Mental Model

Một Promise là một **giá trị sẽ có sau**, ở một trong ba trạng thái: `pending` → `fulfilled` | `rejected`. Chuyển trạng thái **một lần, không đảo lại**.

Bốn combinator, khác nhau ở câu hỏi *"khi nào tôi xong?"*:

```text
Promise.all         xong khi TẤT CẢ ok       → reject NGAY khi có 1 lỗi (fail-fast)
Promise.allSettled  xong khi TẤT CẢ kết thúc → không bao giờ reject; trả status từng cái
Promise.race        xong khi CÁI ĐẦU TIÊN kết thúc (ok hay lỗi)  → dùng cho timeout
Promise.any         xong khi CÁI ĐẦU TIÊN ok → chỉ reject khi tất cả lỗi
```

Quy tắc chọn:

| Tình huống | Dùng |
|---|---|
| Cần tất cả, thiếu một là vô nghĩa | `all` |
| Cần càng nhiều càng tốt, một lỗi không phá phần còn lại | `allSettled` |
| Cần thêm timeout cho một operation | `race` |
| Nhiều nguồn tương đương, lấy nguồn nhanh nhất | `any` |

Điểm quan trọng nhất và bị bỏ qua nhiều nhất: **`Promise.all` fail-fast nhưng KHÔNG huỷ.** Khi một promise reject, `all` reject ngay, nhưng 199 request kia **vẫn đang chạy**. Bạn chỉ ngừng *chờ* chúng. Nếu chúng có side effect, side effect vẫn xảy ra. Muốn huỷ thật thì cần `AbortController`.

## How It Works

### Song song có giới hạn

```ts
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;               // an toàn: một thread, không có race ở đây
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// 200 item, tối đa 8 request đồng thời
const data = await mapLimit(taskIds, 8, (id) => fetchTask(id));
```

`next++` không cần lock: JavaScript chạy một thread, và không có `await` giữa việc đọc và tăng `next`. Đây là một trong những chỗ mô hình một thread thực sự làm code đơn giản hơn — so sánh với [shared state trong hệ đa thread](../../05-cross-cutting/concurrency/02-shared-state-races.md).

### Timeout

Promise không có timeout sẵn. Ghép bằng `race`:

```ts
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}
```

Nhưng cách này **không huỷ** công việc bên dưới — request vẫn chạy tới cùng. Với `fetch`, dùng `AbortSignal.timeout()` để huỷ thật:

```ts
await fetch(url, { signal: AbortSignal.timeout(5000) });   // huỷ thật sự
```

Phân biệt này quan trọng ở server: timeout không huỷ nghĩa là dưới tải cao bạn tích luỹ công việc zombie, tiếp tục chiếm connection pool dù không ai còn chờ kết quả.

### Xử lý lỗi

```ts
// Fail-fast: một lỗi là mất hết
const [a, b] = await Promise.all([getA(), getB()]);

// Chịu lỗi từng phần
const rs = await Promise.allSettled([getA(), getB()]);
const ok = rs.filter((r): r is PromiseFulfilledResult<Data> => r.status === 'fulfilled')
             .map(r => r.value);
const errs = rs.filter(r => r.status === 'rejected').map(r => r.reason);
```

### Bẫy: unhandled rejection

```ts
// ❌ Promise được tạo trước khi có ai catch
const p = fetchData();          // nếu reject ngay → unhandledRejection
await sleep(1000);
try { await p; } catch {}       // catch tới muộn

// ❌ forEach không chờ Promise
items.forEach(async (i) => { await save(i); });
console.log('done');            // in ra TRƯỚC khi save nào xong; lỗi bị mất

// ✅
await Promise.all(items.map(i => save(i)));
```

Ở Node, unhandled rejection **làm crash process** theo mặc định (từ Node 15). Đó là hành vi đúng, nhưng nó nghĩa là một lỗi bị bỏ quên ở đâu đó có thể giết cả service.

## Example

```ts
// Sai: tuần tự không cần thiết — 3 lần chờ nối tiếp
const user = await getUser(id);
const posts = await getPosts(id);      // không phụ thuộc user
const stats = await getStats(id);      // không phụ thuộc gì

// Đúng: 3 độc lập → song song
const [user, posts, stats] = await Promise.all([
  getUser(id), getPosts(id), getStats(id),
]);

// Đúng khi CÓ phụ thuộc thật
const user = await getUser(id);
const team = await getTeam(user.teamId);   // cần user trước — buộc phải tuần tự
```

Waterfall không cần thiết là bug hiệu năng phổ biến nhất trong code async. Nó khó thấy vì code trông hoàn toàn hợp lý.

## Prediction

1. `Promise.all` với 5 promise, cái thứ 2 reject sau 10ms, cái thứ 5 xong sau 1s. `await` trả về sau bao lâu? Cái thứ 5 có chạy tới cùng không?
2. `Promise.allSettled` cùng input — reject không? Trả về sau bao lâu?
3. `items.forEach(async i => await save(i))` rồi `console.log('done')` — thứ tự output?
4. `mapLimit` với `limit = 1` tương đương gì? `limit = items.length`?
5. `withTimeout(fetch(url), 100)` với request mất 5 giây — sau 100ms bạn nhận lỗi, nhưng request thế nào?
6. `new Promise(fn)` — `fn` chạy đồng bộ hay async?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `Promise.all` 500 request tới API có rate limit | Hàng loạt 429; hiểu vì sao cần giới hạn |
| `Promise.all` 500 query tới DB có pool size 10 | Query xếp hàng; p99 tăng vọt. Xem [connection pool](../../03-database/01-postgresql/03-connection-pool.md) |
| Tạo Promise reject mà không catch, ở Node | Process crash — xem log `unhandledRejection` |
| `forEach` với async callback | Hàm "xong" trước khi việc xong; lỗi biến mất im lặng |
| `await` trong `for` loop với 100 item, đo thời gian | So sánh với `Promise.all` và `mapLimit(8)` — ba con số rất khác nhau |
| `withTimeout` rồi đếm request đang mở ở server | Zombie request tích luỹ |
| `Promise.race` với promise reject nhanh nhất | `race` reject — nó không "đợi cái thành công đầu tiên", `any` mới làm thế |

## What Usually Goes Wrong

- **Waterfall không cần thiết** — `await` tuần tự cho các việc độc lập.
- **`Promise.all` không giới hạn** — sập dependency, cạn pool, bị rate limit.
- **`forEach` với async** — không chờ, mất lỗi.
- **Không có timeout** — một request treo giữ tài nguyên vô hạn.
- **Timeout không huỷ** — tích luỹ công việc zombie dưới tải.
- **Bắt lỗi quá rộng** — `try { ...20 dòng... } catch {}` che mất lỗi nào thật sự xảy ra.
- **`return await` trong `try`** bị bỏ quên: `return p` (không có `await`) trong `try/catch` khiến `catch` **không** bắt được lỗi của `p`.
- **Retry không backoff** → thundering herd. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `Promise.all` reject thì các promise khác bị huỷ | Chúng vẫn chạy; bạn chỉ ngừng chờ |
| `await` làm code chạy song song | `await` làm code **chờ**; song song do combinator |
| `Promise.race` trả cái thành công đầu tiên | Trả cái **kết thúc** đầu tiên, kể cả lỗi. `any` mới là thành công đầu tiên |
| `new Promise` chạy async | Executor chạy **đồng bộ** ngay lập tức |
| Nhiều song song luôn nhanh hơn | Vượt quá năng lực dependency thì chậm hơn và có lỗi |
| `try/catch` bắt được mọi lỗi async trong block | Chỉ bắt lỗi của promise được `await`; promise "trôi" thì không |
| Promise có thể reject sau khi đã resolve | Không — trạng thái chỉ chuyển một lần |

## Debugging

1. **Chậm bất thường** → đếm số `await` tuần tự trên đường đi. Trong DevTools Network, waterfall dạng bậc thang là dấu hiệu rõ ràng.
2. **Lỗi biến mất** → tìm `forEach(async`, promise không được `await`, và `catch` rỗng.
3. **`UnhandledPromiseRejection`** → thêm handler global để log stack, rồi truy nguồn:
   ```ts
   process.on('unhandledRejection', (r) => { logger.error({ err: r }, 'unhandled'); });
   ```
4. **Quá tải dependency** → log số operation đồng thời (một counter tăng/giảm quanh mỗi call). Con số này thường gây bất ngờ.
5. **Treo mãi không xong** → thiếu timeout; thêm `withTimeout` tạm để xác định operation nào treo.
6. Stack trace async bị cắt → dùng Node ≥ 16 (async stack traces tốt hơn) và tránh `.then` lồng nhau.

## Production Considerations

- **Mọi network call phải có timeout.** Không có ngoại lệ. Mặc định của nhiều client là vô hạn.
- **Giới hạn concurrency** dựa trên năng lực *dependency*, không dựa trên số item. Connection pool size là trần thực tế.
- **Retry cần backoff + jitter**, và chỉ cho lỗi transient (5xx, timeout), không cho 4xx.
- **`allSettled` cho công việc batch** — một item lỗi không nên làm mất 999 item còn lại.
- **Truyền `AbortSignal` xuyên tầng** để huỷ lan truyền được khi client ngắt kết nối.
- Đo và alert trên số operation đồng thời — nó là tín hiệu sớm của bottleneck.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tuần tự | dễ suy luận, tải thấp | chậm nhất |
| `Promise.all` không giới hạn | nhanh nhất trên giấy | có thể sập dependency |
| Song song có giới hạn | cân bằng, dự đoán được | thêm code, phải chọn con số |
| `all` (fail-fast) | biết lỗi sớm, không làm việc vô ích | mất kết quả đã có |
| `allSettled` | chịu lỗi từng phần | phải xử lý kết quả một phần ở tầng trên |

## Explain Without Notes

1. Bốn combinator và câu hỏi "khi nào tôi xong?" của mỗi cái.
2. `Promise.all` reject — các promise còn lại thế nào? Hệ quả với side effect?
3. Vì sao `forEach` với async callback là bug? Sửa thế nào?
4. Vì sao `withTimeout` bằng `race` không đủ ở server?
5. Chọn giới hạn concurrency dựa trên cái gì?

## Related

- [Event loop & async](01-event-loop-async.md) — Promise chạy ở đâu trong vòng lặp
- [Error handling & immutability](09-error-handling-immutability.md) — bắt lỗi async đúng cách
- [Async race condition](../02-react/03-async-race-condition.md) — cùng vấn đề trong UI
- [Connection pool](../../03-database/01-postgresql/03-connection-pool.md) — trần thực tế của concurrency
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md)
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md)
