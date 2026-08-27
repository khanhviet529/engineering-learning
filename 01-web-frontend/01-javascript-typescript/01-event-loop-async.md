---
level: foundation
area: frontend
prerequisites: []
related:
  - 04-promise-concurrency.md
  - ../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md
  - ../02-react/02-effects-lifecycle.md
---

# Event loop & async

> Một thread, nhiều việc, không có chỗ nào chờ. Đây là mô hình đồng thời của JavaScript ở cả browser và Node.js — và nguồn của mọi bất ngờ về thứ tự thực thi.

## Position

```text
Browser: main thread [call stack | microtask queue | macrotask queue | render]
Node.js: main thread [call stack | microtask | timers | poll | check | close]
   ↑ note này
```

Đây là behavior nền cho: [Promise](04-promise-concurrency.md), [React effect](../02-react/02-effects-lifecycle.md), [race condition](../02-react/03-async-race-condition.md), [Node concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md).

## Problem

JavaScript có **một** thread thực thi. Nếu một việc phải chờ (đọc file, gọi API, đợi 1 giây), thì:

- **chờ đồng bộ** → cả UI đóng băng, không click được, animation đứng, và ở server thì mọi request khác bị kẹt;
- **cần một cách để "tạm gác" việc đang chờ** và làm việc khác, rồi quay lại khi có kết quả.

Cách đó là event loop. Nó giải thích vì sao JavaScript xử lý được 10.000 kết nối đồng thời với một thread — và cũng vì sao một vòng lặp tính toán 5 giây làm mọi thứ đứng im.

## Mental Model

```text
        ┌──────────────────────────────────────┐
        │  Call stack (một, chạy tới hết)      │
        └──────────────────────────────────────┘
                        ↑ lấy việc tiếp theo
        ┌──────────────────────────────────────┐
        │  Microtask queue                     │  ← Promise.then, await, queueMicrotask
        │  → làm CẠN queue này trước           │
        └──────────────────────────────────────┘
        ┌──────────────────────────────────────┐
        │  Macrotask queue                     │  ← setTimeout, event, I/O
        │  → chỉ lấy MỘT task mỗi vòng         │
        └──────────────────────────────────────┘
                        ↓
                    Render (browser)
```

Vòng lặp thực tế:

```text
1. Chạy hết một task đồng bộ (call stack cạn)
2. Làm CẠN microtask queue        ← toàn bộ, kể cả microtask mới sinh ra
3. (Browser) render nếu cần
4. Lấy MỘT macrotask → về bước 1
```

Ba điều rút ra từ mô hình này, và chúng giải thích gần như mọi câu hỏi về thứ tự:

1. **Microtask luôn chạy trước macrotask** — bất kể ai được đặt vào queue trước.
2. **Microtask không nhường chỗ cho render.** Một chuỗi microtask vô hạn làm treo trang y như `while(true)`.
3. **Không có gì async chạy khi call stack chưa cạn.** `setTimeout(fn, 0)` không chạy sau 0ms; nó chạy sau khi code đồng bộ hiện tại xong — có thể là 3 giây sau.

## How It Works

### Microtask vs macrotask

| Microtask | Macrotask |
|---|---|
| `Promise.then/catch/finally` | `setTimeout`, `setInterval` |
| `await` (phần sau await) | DOM event (click, scroll) |
| `queueMicrotask` | I/O callback |
| `MutationObserver` | `setImmediate` (Node) |
| `process.nextTick` (Node — chạy trước cả microtask khác) | `requestAnimationFrame` (trước render) |

### `await` thực chất là gì

```ts
async function f() {
  console.log('A');
  await something;      // ← hàm DỪNG ở đây, trả control về caller
  console.log('B');     // ← phần này thành một microtask
}
```

`await` chia hàm thành hai phần. Phần trước chạy **đồng bộ**. Phần sau được lên lịch như microtask. Đây là lý do:

```ts
async function g() { console.log(1); await null; console.log(3); }
g();
console.log(2);
// 1, 2, 3  — không phải 1, 3, 2
```

`await null` vẫn tạo ra một lượt chờ microtask, dù không có gì để chờ.

### Node.js có nhiều phase hơn

Event loop của Node (qua libuv) có các phase: `timers` → `pending` → `poll` (I/O) → `check` (`setImmediate`) → `close`. Microtask được làm cạn **giữa mỗi phase**, không chỉ giữa các macrotask. `process.nextTick` có queue riêng, ưu tiên cao hơn Promise microtask.

Trong browser thì đơn giản hơn nhưng có thêm bước render. Chi tiết Node: [Node runtime & concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md).

## Example

```ts
console.log('1 sync');

setTimeout(() => console.log('2 timeout'), 0);

Promise.resolve()
  .then(() => console.log('3 microtask'))
  .then(() => console.log('4 microtask'));

queueMicrotask(() => console.log('5 microtask'));

(async () => {
  console.log('6 sync (trước await)');
  await null;
  console.log('7 sau await');
})();

console.log('8 sync');
```

## Prediction

**Viết thứ tự output ra giấy trước khi chạy.** Đây là bài test mental model tốt nhất của note này.

Rồi trả lời tiếp:

1. Nếu thêm `while (Date.now() - t < 3000) {}` ngay sau `console.log('1 sync')` — `setTimeout(..., 0)` chạy sau bao lâu?
2. `setTimeout(fn, 0)` và `queueMicrotask(fn)` — cái nào chạy trước? Vì sao?
3. Code này gây gì?
   ```ts
   function loop() { Promise.resolve().then(loop); }
   loop();
   ```
   Trang còn click được không? Còn nếu là `setTimeout(loop, 0)`?
4. `await` một giá trị không phải Promise (`await 5`) — có tốn lượt chờ nào không?

<details>
<summary>Đáp án thứ tự output</summary>

```text
1 sync
6 sync (trước await)
8 sync
3 microtask
5 microtask
7 sau await
4 microtask
2 timeout
```

Toàn bộ code đồng bộ chạy trước. Rồi microtask theo thứ tự được đặt vào queue: `3` (đặt lúc `.then` đầu), `5` (`queueMicrotask`), `7` (sau `await null`). `4` chỉ được đặt vào queue *sau khi* `3` chạy xong, nên nó ở lượt sau. `2` là macrotask nên chạy cuối.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `while (true) {}` trong click handler | Tab đóng băng hoàn toàn; không click được, không scroll |
| Microtask đệ quy (câu 3 ở trên) | Treo trang — chứng minh microtask không nhường render |
| `setTimeout` đệ quy | Trang **vẫn** phản hồi — mỗi vòng nhường chỗ cho render và event |
| `setInterval(fn, 10)` với `fn` mất 50ms | Callback dồn, khoảng cách thực tế ≠ 10ms |
| 100.000 `Promise.resolve().then()` | Đo thời gian tới frame tiếp theo — thấy render bị hoãn |
| `JSON.parse` một chuỗi 50MB | Đo INP trước/sau — long task chặn input |
| Trong Node: vòng lặp CPU 3s trong một handler | Mọi request khác đứng 3 giây |

Thí nghiệm 2 và 3 cạnh nhau là thí nghiệm quan trọng nhất — nó cho thấy sự khác biệt thật giữa microtask và macrotask không phải là "thứ tự", mà là **có nhường chỗ cho render hay không**.

## What Usually Goes Wrong

- **Tính toán nặng trên main thread** — parse/format/sort dữ liệu lớn làm UI đứng. Giải pháp: chia nhỏ (`yield` qua `setTimeout`/`scheduler.yield`), Web Worker, hoặc làm ở server.
- **Ở Node: một handler CPU-bound làm chậm mọi request** — vì cùng một thread. Xem [Worker threads](../../02-backend-api/01-nodejs/04-worker-threads-cpu.md).
- **Tưởng `setTimeout(fn, 100)` chạy sau đúng 100ms** — đó là *tối thiểu* 100ms; nếu main thread đang bận thì lâu hơn.
- **`forEach` với async callback** — `forEach` không chờ Promise, nên code sau nó chạy trước khi các Promise xong. Dùng `for...of` với `await`, hoặc `Promise.all`.
- **`await` trong vòng lặp khi có thể song song** — biến 10 request 100ms thành 1 giây thay vì 100ms. Xem [Promise & concurrency](04-promise-concurrency.md).
- **Unhandled rejection** — một Promise reject không có `catch` không dừng chương trình một cách rõ ràng; ở Node nó làm crash process (mặc định từ Node 15).
- **`setInterval` không được clear** khi component unmount → callback tiếp tục chạy trên state đã cũ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `setTimeout(fn, 0)` chạy "ngay" | Chạy sau khi call stack cạn và sau hết microtask |
| JavaScript async = multi-thread | Một thread; async chỉ là lên lịch. Song song thật cần Worker |
| `await` làm dừng chương trình | Chỉ dừng *hàm đó*; caller tiếp tục chạy |
| Microtask "nhẹ" nên an toàn hơn | Microtask vô hạn treo trang; macrotask thì không |
| Promise chạy async | Executor (`new Promise(fn)`) chạy **đồng bộ**; chỉ `.then` là async |
| `async` function luôn async | Phần trước `await` đầu tiên chạy đồng bộ |
| Node async nghĩa là không bao giờ block | CPU-bound code block hoàn toàn; async chỉ giúp với I/O |

## Debugging

1. **UI đứng** → DevTools → Performance, record. Tìm **long task** (thanh vàng > 50ms) có gạch đỏ. Nó chỉ đúng hàm.
2. **Thứ tự không như mong đợi** → thêm log có nhãn rõ (`sync/micro/macro`) rồi đối chiếu với mô hình 4 bước ở trên. Đừng đoán.
3. **Callback không chạy** → kiểm tra call stack có cạn chưa; một vòng lặp đồng bộ ở đâu đó có thể đang giữ thread.
4. **Node: latency tăng đều theo tải** → nghi event loop lag. Đo bằng `perf_hooks.monitorEventLoopDelay()`. Đây là metric quan trọng nhất của một Node service.
5. **Unhandled rejection** → thêm `process.on('unhandledRejection')` (Node) hoặc `window.addEventListener('unhandledrejection')` để không mất lỗi im lặng.

## Production Considerations

- **Event loop lag là metric hạng nhất** cho Node service. Lag > 100ms nghĩa là request đang xếp hàng. Xem [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md).
- **INP** (Interaction to Next Paint) của Core Web Vitals đo trực tiếp việc main thread có rảnh để phản hồi không.
- Máy người dùng chậm hơn máy bạn 4–10 lần: một task 30ms trên máy bạn có thể là 200ms trên điện thoại tầm trung.
- Việc CPU-bound thuộc về Worker, queue, hoặc database — không thuộc request handler.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Một thread + async I/O | đơn giản (không lock, không data race trong một tick), scale tốt với I/O | một task nặng chặn tất cả |
| Chia task nhỏ + yield | UI phản hồi | code phức tạp hơn, tổng thời gian dài hơn |
| Web Worker / worker thread | song song thật | phải serialize dữ liệu, khó debug |
| `Promise.all` song song | nhanh hơn nhiều | tải đồng thời lên dependency; cần giới hạn concurrency |

## Explain Without Notes

1. Kể 4 bước của một vòng event loop.
2. Vì sao microtask vô hạn treo trang mà macrotask vô hạn thì không?
3. `await` chia một async function thành hai phần thế nào? Phần nào đồng bộ?
4. Vì sao một handler CPU-bound trong Node làm chậm mọi request?
5. `setTimeout(fn, 100)` — 100 là gì, chính xác?

## Related

- [Promise & concurrency](04-promise-concurrency.md) — `Promise.all`, giới hạn concurrency, error handling
- [Execution context & closure](03-execution-context-closure.md) — vì sao callback đọc giá trị cũ
- [Node runtime & concurrency](../../02-backend-api/01-nodejs/01-node-runtime-concurrency.md) — phase của libuv
- [Worker threads & CPU](../../02-backend-api/01-nodejs/04-worker-threads-cpu.md) — khi cần song song thật
- [React effects](../02-react/02-effects-lifecycle.md) — effect chạy ở đâu trong vòng này
- [Rendering pipeline](../00-web-foundations/04-rendering-pipeline.md) — vì sao JS chặn render
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md) — so sánh với thread và distributed
