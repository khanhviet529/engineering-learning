---
level: foundation
area: frontend
prerequisites:
  - ../01-javascript-typescript/03-execution-context-closure.md
related:
  - 05-reconciliation-keys.md
  - 02-effects-lifecycle.md
  - 12-performance.md
---

# State → render

> Component function chạy lại **không** có nghĩa DOM thay đổi. Phân biệt hai việc đó là nền của mọi hiểu biết về React.

## Position

```text
Event → setState → schedule → RENDER (chạy function) → so sánh → COMMIT (sửa DOM) → browser paint
                                  ↑ note này
```

## Problem

Ba câu hỏi mà người dùng React nhiều năm vẫn trả lời sai:

```ts
function Counter() {
  const [n, setN] = useState(0);

  const onClick = () => {
    setN(n + 1);
    setN(n + 1);
    setN(n + 1);
    console.log(n);      // in ra gì?
  };

  return <button onClick={onClick}>{n}</button>;
}
```

Sau một click: `n` hiển thị là bao nhiêu? `console.log` in gì? Và nếu đổi thành `setN(p => p + 1)` ba lần thì khác gì?

Không trả lời được ba câu này thì mọi bug về "state không cập nhật" sẽ là bí ẩn.

## Mental Model

**Render là gọi function của bạn để hỏi "UI nên trông thế nào?"** Nó không sửa DOM.

```text
1. setState  → React ghi nhận: component này cần render lại
2. RENDER    → gọi Component() → nhận về element tree (object JS thuần)
3. DIFF      → so tree mới với tree cũ
4. COMMIT    → chỉ sửa những DOM node thực sự khác
5. PAINT     → browser vẽ
```

Hai điểm quan trọng:

- Bước 2 có thể chạy **nhiều lần mà bước 4 không làm gì cả** (nếu output giống hệt). Render "vô ích" tốn CPU nhưng không gây flicker.
- Function của bạn phải là **hàm thuần** trong bước 2 — cùng props/state cho ra cùng output, không side effect. React có quyền gọi nó nhiều lần, bỏ kết quả, hoặc gọi lại sau.

### State là snapshot

Đây là ý quan trọng nhất của note:

> **Mỗi render có một "ảnh chụp" state riêng.** Trong một lần render, `n` là một **hằng số**.

```text
Render 1: n = 0   → onClick được tạo với n = 0 trong scope
Render 2: n = 1   → onClick MỚI được tạo với n = 1 trong scope
```

Nên trong ví dụ đầu:

```ts
setN(n + 1);   // n là 0 → setN(1)
setN(n + 1);   // n VẪN là 0 → setN(1)
setN(n + 1);   // n VẪN là 0 → setN(1)
console.log(n);// 0 — biến này không bao giờ thay đổi trong render này
// Kết quả: n = 1
```

`setN` không gán vào biến `n`. Nó yêu cầu React render lại với giá trị mới. Biến `n` của render hiện tại là bất biến — đây chính là [closure](../01-javascript-typescript/03-execution-context-closure.md) đang hoạt động, không phải một cơ chế riêng của React.

Với updater function thì khác:

```ts
setN(p => p + 1);   // queue: p → p+1
setN(p => p + 1);   // queue: p → p+1
setN(p => p + 1);   // React áp dụng lần lượt: 0→1→2→3
// Kết quả: n = 3
```

**Quy tắc:** nếu giá trị mới phụ thuộc giá trị cũ, dùng updater function. Luôn.

### Batching

React gộp nhiều `setState` trong cùng một event thành **một** lần render. Từ React 18, batching áp dụng cả trong `setTimeout`, `Promise.then` và native event handler (automatic batching).

```ts
setA(1); setB(2); setC(3);   // → 1 render, không phải 3
```

## How It Works

### Cái gì gây render lại

| Nguyên nhân | Render lại? |
|---|---|
| `setState` với giá trị **khác** (`Object.is`) | Có |
| `setState` với giá trị **giống** | React có thể bỏ qua (nhưng đôi khi vẫn render 1 lần rồi dừng) |
| Parent render | Có — mọi child render, kể cả props không đổi |
| Context value đổi | Có — mọi consumer |
| Thay đổi biến thường (không phải state) | **Không** |
| Mutate object trong state | **Không** — cùng reference |

Hàng thứ ba là điều bất ngờ với nhiều người: **parent render → child render**, bất kể props có đổi hay không. `React.memo` là cách chặn điều đó. Xem [Context & memoization](07-context-memoization.md).

### Vì sao mutate không hoạt động

```ts
const [user, setUser] = useState({ name: 'a' });

user.name = 'b';        // mutate
setUser(user);          // cùng reference → Object.is(prev, next) === true → bỏ qua
setUser({ ...user });   // reference mới → render
```

React so sánh bằng `Object.is`. Xem [immutability](../01-javascript-typescript/09-error-handling-immutability.md).

### StrictMode double render

Trong dev với StrictMode, React **gọi component function hai lần** để phát hiện side effect không thuần. Đây là tính năng, không phải bug. Nếu hai lần cho kết quả khác nhau, code của bạn không thuần:

```ts
function Bad() {
  const items = [];
  items.push(Math.random());   // ❌ không thuần — mỗi render một kết quả
  return <div>{items[0]}</div>;
}
```

Production chỉ gọi một lần. Nhưng nếu StrictMode phát hiện vấn đề, vấn đề đó là thật.

## Example

```tsx
function Counter() {
  const [n, setN] = useState(0);
  console.log('render, n =', n);       // đếm số render

  return (
    <>
      <button onClick={() => { setN(n + 1); setN(n + 1); }}>direct</button>
      <button onClick={() => { setN(p => p + 1); setN(p => p + 1); }}>updater</button>
      <button onClick={() => { setN(0); setN(0); }}>set same</button>
      <span>{n}</span>
    </>
  );
}
```

## Prediction

Viết ra trước khi chạy:

1. Click "direct" (từ `n = 0`) — `n` thành mấy? Có bao nhiêu dòng `render` in ra?
2. Click "updater" — `n` thành mấy?
3. `n` đang là 0, click "set same" — có render nào không?
4. Trong `onClick` của "direct", nếu thêm `console.log(n)` sau hai `setN` — in gì?
5. `setA(1); setB(2)` trong cùng handler — bao nhiêu render?
6. Cùng hai lệnh đó trong `setTimeout` — bao nhiêu render trong React 18+? Trong React 17?

<details>
<summary>Đáp án</summary>

1. `n = 1`; **một** dòng render (batching gộp hai `setN`).
2. `n = 2`.
3. Không (hoặc React render một lần rồi dừng, không commit) — `Object.is(0, 0)` là `true`.
4. `0` — biến `n` của render hiện tại không đổi.
5. Một render.
6. React 18+: một (automatic batching). React 17: hai.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `setN(n+1)` ba lần vs `setN(p=>p+1)` ba lần | 1 vs 3 — hiểu snapshot |
| Mutate object trong state rồi `setState` | Không render |
| `console.log` trong body component, click nhiều lần | Đếm render thật, so với dự đoán |
| Đặt `Math.random()` trong body với StrictMode | Hai giá trị khác nhau → phát hiện không thuần |
| `setState` trong body component (không trong effect/handler) | "Too many re-renders" — vòng lặp vô hạn |
| Parent render, child có props không đổi, log trong child | Child **vẫn** render |
| Bọc child bằng `React.memo` rồi làm lại | Child không render nữa |
| Truyền `onClick={() => {}}` (inline) cho child đã `memo` | `memo` vô dụng — hàm mới mỗi render |

Thí nghiệm cuối là bài học quan trọng: `memo` bị vô hiệu bởi props không stable.

## What Usually Goes Wrong

- **Dùng `n` thay vì updater function** khi giá trị mới phụ thuộc giá trị cũ → mất update khi có nhiều lần gọi.
- **Mutate state** → UI không cập nhật.
- **`setState` trong render body** → vòng lặp vô hạn.
- **Kỳ vọng đọc được state mới ngay sau `setState`** → luôn đọc giá trị cũ.
- **Derived state lưu trong state** — tính từ props rồi `setState` trong effect. Sai; tính trực tiếp trong render. Xem [state design](06-props-composition-state-design.md).
- **Object/array mới mỗi render truyền xuống child memo** → memo vô dụng.
- **Side effect trong render body** (fetch, log ra ngoài, sửa DOM) → StrictMode phát hiện, và nó thật sự sai.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `setState` cập nhật biến ngay | Nó lên lịch render mới; biến hiện tại bất biến |
| Render = DOM thay đổi | Render tạo element tree; commit mới sửa DOM |
| Render lại là chậm/xấu | Render không commit thì rẻ; vấn đề chỉ khi render nặng |
| Child chỉ render khi props đổi | Parent render → child render (trừ khi `memo`) |
| StrictMode double render là bug | Là công cụ phát hiện hàm không thuần |
| React so sánh sâu props | So bằng `Object.is` (shallow, theo reference) |
| `useState` với object thì cập nhật từng field được | Phải tạo object mới |

## Debugging

1. **`console.log` trong body component** — cách rẻ nhất để đếm render. Làm việc này trước mọi thứ khác.
2. **React DevTools → Profiler** → record → xem *"Why did this render?"*. Nó nói rõ: props đổi, state đổi, hay parent render.
3. **State không cập nhật** → kiểm tra hai thứ: có mutate không (`prev === next`), và có dùng updater function không.
4. **Render vô hạn** → tìm `setState` trong render body hoặc trong effect không có dependency đúng.
5. **Bật "Highlight updates when components render"** trong DevTools → thấy trực quan component nào render.
6. Nếu render nhiều nhưng UI đúng và không lag — **đừng tối ưu**. Đo trước. Xem [React performance](12-performance.md).

## Production Considerations

- Render lại không phải vấn đề cho đến khi có **đo lường** cho thấy nó là vấn đề. Tối ưu sớm bằng `memo`/`useCallback` khắp nơi làm code khó đọc và thường không nhanh hơn.
- Vấn đề thật thường là: list dài không virtualize, component render nặng (chart, editor), hoặc context value đổi quá thường xuyên.
- StrictMode nên bật ở dev cho mọi dự án — nó bắt bug trước khi lên production.
- React 19 có React Compiler tự memo hoá; nhưng mental model về snapshot và purity vẫn cần thiết để debug.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Updater function | luôn đúng với nhiều update | verbose hơn một chút |
| Immutable update | so sánh reference hoạt động | tạo object mới |
| `React.memo` | chặn render không cần thiết | cần props stable; thêm phức tạp |
| State ở cao (lifted) | dễ chia sẻ | render nhiều component |
| State colocated | render ít | khó chia sẻ khi cần |

## Explain Without Notes

1. Phân biệt render và commit. Cái nào sửa DOM?
2. Vì sao `setN(n+1)` ba lần chỉ tăng 1?
3. Vì sao mutate state không gây render?
4. Ba nguyên nhân làm một component render lại?
5. StrictMode double render dùng để phát hiện gì?

## Related

- [Reconciliation & keys](05-reconciliation-keys.md) — bước diff làm gì
- [Effects & lifecycle](02-effects-lifecycle.md) — code chạy sau commit
- [Props, composition & state design](06-props-composition-state-design.md) — state nên ở đâu
- [Context & memoization](07-context-memoization.md) — chặn render lan rộng
- [React performance](12-performance.md) — khi nào render thật sự là vấn đề
- [Closure](../01-javascript-typescript/03-execution-context-closure.md) — cơ chế đằng sau snapshot
- [Immutability](../01-javascript-typescript/09-error-handling-immutability.md)
