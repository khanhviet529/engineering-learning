---
level: beginner
area: frontend
type: foundation
prerequisites: []
related:
  - 01-execution-context-closure.md
  - ../async-concurrency/01-event-loop-async.md
  - ../async-concurrency/02-promise-concurrency.md
---

# Từ vựng JavaScript: giá trị, bộ nhớ, thứ tự chạy

## Note này trả lời gì

**JavaScript giữ dữ liệu ở đâu, và chạy code theo thứ tự nào** — value vs reference, stack vs heap, sync vs async, callback, Promise, task vs microtask.

Đây là note **từ vựng**. Nó không dạy stale closure gây bug gì hay `Promise.all` khác `allSettled` ra sao. Nó đảm bảo khi bạn đọc những note đó, bạn không phải đoán nghĩa của từ.

> ~12 phút. Nếu bạn giải thích được vì sao `[1,2] === [1,2]` là `false` và vì sao `await` không chặn thread, hãy bỏ qua và vào [01-execution-context-closure.md](./01-execution-context-closure.md).

## Vị trí

```text
Code của bạn
   │
   ├─ Dữ liệu ở đâu?     stack (giá trị nhỏ, cố định)  ·  heap (object, array, function)
   ├─ Ai đang chạy?       call stack — một luồng duy nhất
   ├─ Việc chưa xong?     ra ngoài chờ, rồi quay lại qua queue
   └─ Quay lại lúc nào?   microtask trước, macrotask sau
```

Bốn dòng đó là toàn bộ nội dung note này. Chúng là nền của mọi bug bất đồng bộ và mọi bug "sao state không đổi".

## Định nghĩa

### Primitive và object

JavaScript có hai họ giá trị, và mọi thứ khác là hệ quả.

```text
Primitive   string  number  boolean  null  undefined  symbol  bigint
Object      {} [] function  Date  Map  Set  Promise  class instance
```

**Primitive là bất biến.** Bạn không sửa được một string; bạn chỉ tạo string mới.

```js
let s = 'abc';
s.toUpperCase();     // trả về 'ABC' MỚI
console.log(s);      // 'abc' — s không đổi
```

**Object thì sửa được** (mutable): cùng một object, nội dung thay đổi.

### Value và reference — nguồn của nhiều bug nhất

Biến giữ **primitive** thì giữ *chính giá trị đó*. Biến giữ **object** thì giữ *một tham chiếu* — địa chỉ tới object nằm chỗ khác.

```js
let a = 1;
let b = a;          // COPY giá trị
b = 2;
console.log(a);     // 1  ← a không liên quan tới b

let x = { n: 1 };
let y = x;          // COPY THAM CHIẾU, không copy object
y.n = 2;
console.log(x.n);   // 2  ← cùng một object!
```

```text
let a = 1;  let b = a;             let x = {n:1};  let y = x;

  a ──▶ 1                            x ──┐
  b ──▶ 1   (hai ô riêng)                 ├──▶ { n: 1 }   (một object, hai mũi tên)
                                     y ──┘
```

Vì vậy so sánh object bằng `===` là so sánh **địa chỉ**, không phải nội dung:

```js
[1, 2] === [1, 2]            // false — hai array khác nhau, nội dung giống
{ n: 1 } === { n: 1 }        // false
const r = [1, 2]; r === r    // true  — cùng một array
```

Đây là lý do gốc của ba nhóm bug bạn sẽ gặp:

| Hệ quả | Ở đâu |
|---|---|
| React không re-render dù object đã sửa | React so sánh reference, thấy "không đổi" |
| `useEffect` chạy vô hạn | dependency là object literal tạo mới mỗi render → luôn "khác" |
| Sửa dữ liệu ở một chỗ, chỗ khác đổi theo | hai biến trỏ cùng object |

**Copy nông vs copy sâu:**

```js
const o = { user: { name: 'A' } };
const shallow = { ...o };          // copy NÔNG
shallow.user.name = 'B';
console.log(o.user.name);          // 'B' — o.user vẫn là cùng object

const deep = structuredClone(o);   // copy SÂU
```

`{ ...o }` và `[...arr]` chỉ copy **một tầng**. Tầng trong vẫn dùng chung. Hệ quả trong React: [03-error-handling-immutability.md](./03-error-handling-immutability.md).

### Stack và heap

Hai vùng bộ nhớ, khác nhau ở việc ai dọn và bao giờ.

```text
STACK                                  HEAP
kích thước biết trước, dọn tự động     kích thước tuỳ ý, dọn bằng GC
primitive + tham chiếu                 object, array, function, closure

┌──────────────┐                       ┌─────────────────┐
│ a = 1        │                       │ { n: 1 }        │
│ x = ref ─────┼──────────────────────▶│                 │
└──────────────┘                       └─────────────────┘
```

**Call stack** là chồng các lời gọi hàm đang chạy dở:

```js
function c() { throw new Error('x'); }
function b() { c(); }
function a() { b(); }
a();
// Error: x
//     at c   ← đang ở đây
//     at b
//     at a   ← được gọi từ đây
```

Stack trace bạn đọc mỗi ngày chính là ảnh chụp call stack. Đọc **từ trên xuống**: trên cùng là nơi lỗi xảy ra, dưới là đường đi tới đó.

Hai lỗi tương ứng hai vùng:

| Lỗi | Vùng | Nguyên nhân điển hình |
|---|---|---|
| `Maximum call stack size exceeded` | stack | đệ quy không có điều kiện dừng |
| `heap out of memory` | heap | giữ tham chiếu tới dữ liệu không còn cần (memory leak) |

**Garbage collector** giải phóng object khi **không còn tham chiếu nào** tới nó. Leak trong JS gần như luôn là: bạn vẫn còn giữ một tham chiếu mà bạn không nhớ — biến global, listener chưa remove, `Map` chỉ thêm không xoá.

### Sync và async

**Đồng bộ (sync)** = làm xong mới đi tiếp. **Bất đồng bộ (async)** = bắt đầu việc, đi tiếp, quay lại khi có kết quả.

```js
const data = readFileSync('a.txt');   // sync: dòng dưới CHỜ dòng này
console.log('sau');

readFile('a.txt', (err, data) => {    // async: đăng ký "xong thì gọi tôi"
  console.log('trong callback');
});
console.log('sau');                   // in TRƯỚC "trong callback"
```

Điều phải hiểu đúng: **JavaScript chạy code của bạn trên một luồng duy nhất.** Không có hai dòng code JS của bạn chạy cùng lúc.

Vậy async lấy đâu ra "song song"? Việc chờ được giao cho **bên ngoài** — kernel của OS, hoặc thread pool của runtime. Trong lúc chờ, luồng JS rảnh và chạy việc khác.

```text
Luồng JS:   [code] ─── rảnh, chạy việc khác ─── [callback]
Bên ngoài:         └─── đọc file / gọi mạng ────┘
```

Vì vậy: **async không có nghĩa là nhanh hơn. Nó có nghĩa là không chặn.**

**Blocking** là làm ngược lại: chiếm luồng JS bằng công việc CPU. Vòng `for` 10 triệu lần chặn tuyệt đối — không có async nào cứu được, vì nó dùng đúng cái luồng mà mọi thứ khác cần.

### Callback

**Callback** chỉ là một function bạn truyền cho code khác gọi hộ. Không có gì đặc biệt về syntax — nó đặc biệt về *thời điểm*.

```js
[1, 2, 3].map(n => n * 2);            // callback đồng bộ — gọi ngay
setTimeout(() => console.log('x'), 0); // callback bất đồng bộ — gọi sau
```

Cùng một hình dạng code, hai thời điểm hoàn toàn khác. Nhầm hai loại này là bug phổ biến nhất của người mới:

```js
let result;
fetchUser(id, (user) => { result = user; });
console.log(result);      // undefined — callback CHƯA chạy
```

### Promise — là một object, không phải phép thuật

**Promise là một object đại diện cho một kết quả chưa có.** Nó ở một trong ba trạng thái:

```text
pending    ──▶  fulfilled  (có value)
           └─▶  rejected   (có lý do lỗi)
```

Chuyển trạng thái **một lần và không quay lại**. Một Promise đã settled thì kết quả cố định vĩnh viễn.

```js
const p = fetch('/api/user');
console.log(p);       // Promise { <pending> }  ← object, không phải dữ liệu

p.then(res => ...);   // "khi fulfilled thì làm cái này"
```

Ba điểm hay hiểu sai:

**Promise đã chạy rồi.** Tạo Promise là bắt đầu việc luôn — không phải chờ tới lúc `await`. Đây là khác biệt với `async` của một số ngôn ngữ khác.

```js
const p = fetch('/api/slow');   // request ĐÃ gửi ở đây
await doSomethingElse();
const r = await p;              // chỉ chờ kết quả, không gửi lại
```

**`await` không chặn luồng.** Nó chỉ tạm dừng *hàm async đang chạy*, và trả luồng lại cho việc khác.

**`async function` luôn trả về Promise**, kể cả khi bạn `return 1`.

```js
async function f() { return 1; }
f();              // Promise { 1 } — không phải 1
await f();        // 1
```

Cách dùng `Promise.all` / `allSettled` / `race` và bẫy của từng cái: [02-promise-concurrency.md](../async-concurrency/02-promise-concurrency.md).

### Task và microtask

Khi việc bên ngoài xong, callback không chạy ngay. Nó **vào hàng đợi**. Có **hai** hàng, ưu tiên khác nhau:

```text
Chạy hết code hiện tại (đồng bộ)
        ↓
Dọn HẾT microtask queue        ← Promise .then/.catch, await, queueMicrotask
        ↓
Lấy MỘT macrotask              ← setTimeout, setInterval, I/O
        ↓
Dọn HẾT microtask lại
        ↓
lặp
```

Quy tắc: **microtask luôn chạy trước macrotask**, và microtask được dọn *sạch* trước khi lấy macrotask tiếp theo.

```js
console.log('1');
setTimeout(() => console.log('2'), 0);      // macrotask
Promise.resolve().then(() => console.log('3')); // microtask
console.log('4');

// 1 4 3 2
```

`setTimeout(..., 0)` **không** chạy ngay, và **không** chạy trước Promise. Nó xếp vào hàng chậm hơn.

Hệ quả thật, không phải câu hỏi phỏng vấn: microtask sinh microtask vô hạn sẽ **treo hoàn toàn** vòng lặp — macrotask không bao giờ được tới lượt. Chi tiết và cách đo: [01-event-loop-async.md](../async-concurrency/01-event-loop-async.md).

### Scope, closure, hoisting — mức từ vựng

| Từ | Nghĩa ngắn |
|---|---|
| **scope** | vùng code mà một biến nhìn thấy được |
| **closure** | function ghi nhớ scope nơi nó **được định nghĩa**, không phải nơi được gọi |
| **hoisting** | khai báo được xử lý trước khi code chạy — `var` thành `undefined`, `let`/`const` vào "vùng chết" |
| **TDZ** | khoảng từ đầu block tới dòng `let`; truy cập ở đó → `Cannot access before initialization` |

Closure là cái *cho phép* callback dùng biến bên ngoài. Nó cũng là cái *giữ* biến đó sống — nguồn của cả stale closure và memory leak. Đầy đủ: [01-execution-context-closure.md](./01-execution-context-closure.md).

## Hiểu sai thường gặp

| Hiểu sai | Thực tế | Hậu quả |
|---|---|---|
| `y = x` copy object | copy tham chiếu | sửa `y` làm `x` đổi theo, bug "dữ liệu tự đổi" |
| `[1,2] === [1,2]` là `true` | so sánh reference, không phải nội dung | so sánh sai, React re-render sai |
| `{...o}` copy toàn bộ | chỉ copy một tầng | mutate tầng trong làm hỏng state gốc |
| async nghĩa là nhanh hơn | nghĩa là không chặn luồng | tưởng bọc `async` là tối ưu xong |
| JS chạy nhiều luồng | code JS của bạn chạy trên **một** luồng | vòng `for` nặng làm treo cả server |
| `await` chặn thread | chỉ tạm dừng hàm async đó | tưởng `await` trong loop là an toàn về hiệu năng |
| Promise chỉ chạy khi `await` | tạo là chạy luôn | tưởng đã tuần tự hoá xong, thực ra vẫn song song |
| `setTimeout(fn, 0)` chạy ngay | vào macrotask, sau mọi microtask | thứ tự log không như dự đoán |
| `async function` trả về giá trị | luôn trả Promise | `if (f())` luôn truthy, kể cả khi `return false` |
| GC dọn mọi thứ không dùng | GC dọn cái không còn **tham chiếu** | listener/Map còn giữ ref → leak |
| `var` và `let` chỉ khác cú pháp | `var` là function-scope, `let` là block-scope | biến trong `for` bị chia sẻ, closure lấy sai giá trị |

## Kiểm tra bản thân

1. `let a = {n:1}; let b = a; b.n = 2;` — `a.n` bằng bao nhiêu? Vì sao?
2. `[1,2] === [1,2]` cho gì? Nếu muốn so sánh nội dung thì làm sao?
3. `{...o}` copy được mấy tầng? Tầng trong thì sao?
4. JS chạy code của bạn trên mấy luồng? Vậy `await` "song song" bằng cách nào?
5. Một Promise có mấy trạng thái? Từ `fulfilled` về `pending` được không?
6. `const p = fetch(url);` — request đã được gửi chưa, hay chờ tới lúc `await`?
7. Thứ tự in của: `log('1'); setTimeout(()=>log('2'),0); Promise.resolve().then(()=>log('3')); log('4');`
8. `async function f() { return 1 }` — `f()` trả về gì?
9. Sự khác nhau giữa `Maximum call stack size exceeded` và `heap out of memory`?

## Đọc gì tiếp

```text
Đã có từ vựng ở đây
        │
        ├──▶ 01-execution-context-closure.md      ← closure và bug stale closure
        ├──▶ ../async-concurrency/01-event-loop-async.md  ← event loop, lag, cách đo
        ├──▶ ../async-concurrency/02-promise-concurrency.md ← all / allSettled / race
        ├──▶ 03-error-handling-immutability.md    ← hệ quả của value vs reference
        └──▶ 02-modules-bundling.md               ← import/export, ESM vs CJS
```

Nếu bạn đang học React: đọc mục **Value và reference** ở trên thật kỹ. Phần lớn bug "state không đổi" và "effect chạy vô hạn" nằm trọn trong 15 dòng đó.

## Related

- [Execution context & closure](./01-execution-context-closure.md) — scope và closure ở mức behavior
- [Modules & bundling](./02-modules-bundling.md) — module, ESM vs CJS
- [Error handling & immutability](./03-error-handling-immutability.md) — hệ quả trực tiếp của reference
- [Event loop & async](../async-concurrency/01-event-loop-async.md) — task/microtask ở mức behavior
- [Promise concurrency](../async-concurrency/02-promise-concurrency.md) — all, allSettled, race
- [JavaScript / TypeScript](../README.md) — toàn bộ vùng này
- [Glossary](../../../00-roadmap/glossary.md)
