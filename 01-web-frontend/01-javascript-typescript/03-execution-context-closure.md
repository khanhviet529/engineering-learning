---
level: foundation
area: frontend
prerequisites:
  - 01-event-loop-async.md
related:
  - ../02-react/02-effects-lifecycle.md
  - 05-memory-gc.md
---

# Execution context, scope, closure, `this`, prototype

> Vì sao hàm của bạn đọc giá trị cũ. Đây là bug số một của React beginner và nó không phải bug của React.

## Position

```text
JavaScript engine [execution context → scope chain → closure]
   ↑ note này — nền cho stale closure trong React, cho callback trong Node
```

## Problem

Bốn đoạn code, bốn bất ngờ:

```ts
// 1. In ra gì?
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);

// 2. Còn cái này?
for (let i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);

// 3. `this` là gì trong hai trường hợp?
const obj = {
  name: 'a',
  regular() { setTimeout(function () { console.log(this.name); }, 0); },
  arrow()   { setTimeout(() => { console.log(this.name); }, 0); },
};

// 4. Vì sao counter không tăng?
function Counter() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(n + 1), 1000);
    return () => clearInterval(id);
  }, []);   // ← [] là chỗ bug
}
```

Cả bốn có cùng một nguyên nhân: **một hàm ghi nhớ *môi trường* nơi nó được định nghĩa, không phải nơi nó được gọi.** Hiểu điều đó giải quyết cả bốn.

## Mental Model

Khi một hàm được tạo, nó mang theo một tham chiếu tới scope chứa nó. Tham chiếu đó gọi là **closure**, và nó là *sống* — không phải bản chụp.

```text
Định nghĩa hàm  →  hàm giữ liên kết tới scope lúc đó
                   ┌──────────────────────────┐
                   │ Global scope             │
                   │  ┌────────────────────┐  │
                   │  │ function scope     │  │
                   │  │  ┌──────────────┐  │  │
                   │  │  │ block scope  │  │  │  ← hàm bên trong thấy hết ra ngoài
                   │  │  └──────────────┘  │  │
                   │  └────────────────────┘  │
                   └──────────────────────────┘
Gọi hàm         →  tra biến theo scope chain, TỪ TRONG RA NGOÀI
```

Hai câu chốt:

1. **Scope được quyết định lúc *viết code*** (lexical), không lúc gọi. Nơi bạn *gọi* hàm không ảnh hưởng biến nào nó thấy.
2. **`this` thì ngược lại** — nó được quyết định lúc *gọi*, trừ arrow function.

Điểm 2 là lý do `this` gây nhiều nhầm lẫn: nó là ngoại lệ duy nhất trong một hệ thống vốn nhất quán theo lexical.

### Vì sao `var` và `let` khác nhau trong loop

```text
var  → một binding duy nhất cho cả loop
       cả 3 closure trỏ vào CÙNG một biến → sau loop nó là 3 → in 3,3,3

let  → binding MỚI cho mỗi lần lặp
       mỗi closure trỏ vào biến riêng     → in 0,1,2
```

Đây không phải chuyện "`let` tốt hơn". Nó là hệ quả trực tiếp của việc closure giữ *tham chiếu tới binding*, không giữ *giá trị*.

### Stale closure

Trường hợp 4 ở trên là dạng React của cùng hiện tượng:

```text
Render 1: n = 0 → tạo effect → tạo callback ghi nhớ scope có n = 0
          [] nghĩa là effect không chạy lại
Render 2: n = 1 → nhưng callback CŨ vẫn đang chạy, vẫn thấy n = 0
          → setN(0 + 1) = 1 mãi mãi
```

Callback không "đọc giá trị cũ" vì lỗi nào cả. Nó đọc **đúng** biến của render mà nó được tạo ra. Vấn đề là bạn muốn giá trị của render *hiện tại*.

Ba cách sửa, ba trade-off:

```ts
// A. Không cần giá trị cũ → dùng updater function
setInterval(() => setN(prev => prev + 1), 1000);

// B. Cần giá trị mới nhất → ref (không gây render)
const nRef = useRef(n);
nRef.current = n;
setInterval(() => setN(nRef.current + 1), 1000);

// C. Cho effect chạy lại khi n đổi (interval bị tạo lại mỗi giây — thường không muốn)
useEffect(() => { /* ... */ }, [n]);
```

A là đúng nhất khi có thể. Xem [Effects & lifecycle](../02-react/02-effects-lifecycle.md).

## How It Works

### Hoisting và TDZ

```ts
console.log(a);   // undefined  — var được hoist, khởi tạo bằng undefined
var a = 1;

console.log(b);   // ReferenceError — let/const bị hoist nhưng ở TDZ
let b = 1;

foo();            // OK — function declaration được hoist cả body
function foo() {}

bar();            // TypeError: bar is not a function
var bar = () => {};
```

TDZ (Temporal Dead Zone) là khoảng từ đầu block đến dòng khai báo. Nó tồn tại để biến lỗi im lặng (`undefined`) thành lỗi ồn ào (`ReferenceError`).

### `this` — 5 quy tắc, theo thứ tự ưu tiên

```ts
new Foo()              // this = object mới
foo.call(obj) / bind   // this = obj (tường minh)
obj.foo()              // this = obj (implicit — do dấu chấm)
foo()                  // this = undefined (strict/module) hoặc globalThis
() => {}               // this = this của scope BAO NGOÀI, không đổi được
```

Bug điển hình — mất `this` khi truyền method như một hàm rời:

```ts
class Service {
  name = 'svc';
  log() { console.log(this.name); }
}
const s = new Service();
setTimeout(s.log, 0);            // undefined — mất dấu chấm, mất this
setTimeout(() => s.log(), 0);    // 'svc'
setTimeout(s.log.bind(s), 0);    // 'svc'
```

Trong module ESM và class body, code là strict mode, nên `this` là `undefined` chứ không phải `globalThis` — và bạn được `TypeError` rõ ràng thay vì lỗi im lặng.

### Prototype

JavaScript kế thừa qua **chuỗi object**, không qua class thật:

```ts
const proto = { greet() { return `hi ${this.name}`; } };
const o = Object.create(proto);
o.name = 'x';
o.greet();                         // 'hi x' — tìm greet trên o, không có → lên proto
Object.getPrototypeOf(o) === proto; // true
```

`class` là cú pháp trên cơ chế này. Khi bạn đọc `o.greet`, engine tra `o` → prototype của `o` → prototype của nó → ... → `null`.

Hệ quả thực tế: `this` trong method phụ thuộc **cách gọi**, không phụ thuộc việc method nằm trên prototype.

## Example

```ts
// Closure là công cụ, không chỉ là bug: private state
function makeCounter() {
  let count = 0;                       // không ai bên ngoài chạm được
  return {
    inc: () => ++count,
    get: () => count,
  };
}
const c = makeCounter();
c.inc(); c.inc();
c.get();     // 2
// c.count → undefined. Đây là cách có private state trước khi có `#field`.
```

## Prediction

Trả lời 4 đoạn ở phần Problem, rồi:

5. `makeCounter()` gọi hai lần — hai counter chia sẻ `count` hay có riêng?
6. Đổi `var` → `let` trong `for` loop mà **không** dùng `setTimeout` — output có đổi không?
7. Arrow function trong class field (`log = () => {...}`) — `this` có bị mất khi truyền rời không?
8. Closure giữ tham chiếu tới cả object 50MB dù chỉ dùng một field của nó — object đó có được GC không?

<details>
<summary>Đáp án 1–4</summary>

1. `3, 3, 3` — một binding `i` duy nhất; sau loop `i === 3`.
2. `0, 1, 2` — `let` tạo binding mới mỗi vòng.
3. `regular` → `undefined` (mất `this`); `arrow` → `'a'` (lấy `this` của `arrow()`, tức `obj`).
4. `n` bị khoá ở `0` mãi vì `[]` khiến callback chỉ được tạo một lần, trong scope có `n = 0`.
</details>

Câu 8 là cầu nối sang [Memory & GC](05-memory-gc.md): closure là nguyên nhân leak phổ biến nhất trong JS.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `var` trong loop + `setTimeout` | `3,3,3` — kinh điển |
| `useEffect` với `[]` đọc state | Stale closure; giá trị đứng yên |
| Truyền `obj.method` làm callback | `this` là `undefined`, `TypeError` |
| Dùng `let` trước khi khai báo | `ReferenceError` (TDZ), không phải `undefined` |
| Closure giữ mảng lớn, lưu vào một Map global | Heap tăng và không giảm — leak |
| Arrow function làm method rồi gọi `obj.method.call(other)` | `this` **không** đổi — arrow bỏ qua `call` |
| Đọc `this` trong callback của `forEach` (function thường) | `undefined` trong strict mode |

## What Usually Goes Wrong

- **Stale closure trong React** — dependency array thiếu, hoặc `[]` khi cần giá trị mới. Nguyên nhân số một.
- **Mất `this`** khi truyền method vào `setTimeout`, event listener, hoặc `map`.
- **Memory leak qua closure** — event listener không remove giữ cả component tree trong scope.
- **Nhầm closure với snapshot** — nó là tham chiếu tới binding; nếu binding thay đổi, closure thấy thay đổi (đó là vì sao `let` trong loop cho kết quả khác `var`).
- **Sửa prototype của built-in** (`Array.prototype.foo = ...`) — phá code khác, phá `for...in`.
- **Dùng `bind` trong render** (`onClick={this.f.bind(this)}`) → hàm mới mỗi render → phá memoization của child.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Closure chụp lại *giá trị* | Chụp *binding*; giá trị có thể đổi sau đó |
| `this` theo nơi hàm được định nghĩa | Theo cách hàm được **gọi** — trừ arrow |
| Arrow function chỉ là cú pháp ngắn | Nó thay đổi ngữ nghĩa `this`, `arguments`, và không dùng được với `new` |
| `let` "sửa" closure | Nó tạo binding mới mỗi vòng lặp; cơ chế closure không đổi |
| Class trong JS như class trong Java | Là cú pháp trên prototype chain; `this` vẫn phụ thuộc call-site |
| Hoisting chỉ áp dụng cho `var` | `let`/`const`/`class` cũng được hoist, nhưng vào TDZ |
| Stale closure là bug của React | Là behavior của JavaScript; React chỉ làm nó dễ gặp |

## Debugging

1. **Giá trị sai và có vẻ "cũ"** → nghi stale closure. Log cả giá trị *và* một marker của render (`useRef` đếm render) để xem callback thuộc render nào.
2. Đặt breakpoint trong callback → DevTools → **Scope panel** hiển thị chính xác Closure scope và giá trị nó thấy. Đây là công cụ tốt nhất cho lớp bug này và ít người dùng.
3. **`this` là `undefined`** → tìm chỗ hàm bị truyền rời khỏi object (mất dấu chấm).
4. **React**: bật ESLint `react-hooks/exhaustive-deps`. Nó bắt được phần lớn stale closure trước khi bạn chạy.
5. **Leak** → Memory profiler → heap snapshot × 2 → so sánh; retainer path sẽ chỉ closure nào đang giữ.

## Production Considerations

- Closure giữ tham chiếu ⇒ giữ object trong memory. Trong Node server, một closure trong cache/Map global có thể giữ cả request context, gây leak tăng dần. Xem [Process & memory](../../02-backend-api/01-nodejs/03-process-memory.md).
- Luôn remove event listener và clear timer trong cleanup — cả browser và Node.
- Dùng ESLint `exhaustive-deps` như một quy tắc bắt buộc, không phải gợi ý.
- Ưu tiên arrow function cho callback để `this` ổn định; ưu tiên method thường trên class khi cần `super`.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Closure để giữ private state | đóng gói tốt, không cần class | mỗi instance tạo hàm mới (tốn RAM hơn prototype) |
| `useRef` để tránh stale closure | luôn có giá trị mới | không gây re-render → dễ hiển thị dữ liệu cũ trên UI |
| Cho effect chạy lại (`[n]`) | luôn tươi | tạo lại subscription/timer thường xuyên |
| Arrow class field | `this` luôn đúng | mỗi instance một hàm, không dùng được `super` |

## Explain Without Notes

1. Closure giữ gì — giá trị hay tham chiếu? Chứng minh bằng ví dụ `var` vs `let`.
2. Vì sao `setTimeout(obj.method)` làm mất `this`, và ba cách sửa?
3. Stale closure trong React xảy ra thế nào, và vì sao `setN(prev => ...)` sửa được?
4. `this` được quyết định lúc nào? Nêu 5 quy tắc theo thứ tự ưu tiên.
5. TDZ tồn tại để làm gì?

## Related

- [Event loop & async](01-event-loop-async.md) — callback chạy khi nào
- [Effects & lifecycle](../02-react/02-effects-lifecycle.md) — stale closure trong thực tế
- [Memory & GC](05-memory-gc.md) — closure và leak
- [Custom hooks](../02-react/11-custom-hooks.md) — closure là nền của hook
- [TypeScript type system](07-typescript-type-system.md) — type không bảo vệ khỏi lớp bug này
