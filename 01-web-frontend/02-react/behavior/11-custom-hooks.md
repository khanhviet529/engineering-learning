---
level: intermediate
area: frontend
prerequisites:
  - 02-effects-lifecycle.md
  - 06-props-composition-state-design.md
related:
  - 13-testing-react.md
---

# Custom hooks

> Hook không phải cách tái dùng UI — đó là việc của component. Hook là cách tái dùng **logic có state**. Nhầm hai mục đích tạo ra hook mà không ai muốn dùng lần thứ hai.

## Position

```text
Component (UI)  ← composition để tái dùng
Custom hook     ← tái dùng logic có state / có effect
Hàm thuần       ← tái dùng tính toán không state
```

## Problem

```tsx
// Cùng logic lặp trong 6 component
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
useEffect(() => { /* fetch, cleanup, error */ }, [id]);
```

Nhưng cũng có thái cực đối lập — hook được tạo ra không vì lý do gì:

```tsx
// Hook không có state, không có effect → chỉ nên là hàm thuần
function useFormatPrice(n: number) {
  return `${n.toLocaleString()} đ`;
}
```

Hook thứ hai không sai về mặt kỹ thuật nhưng nó **mất** thứ quan trọng: một hàm thuần gọi được ở bất cứ đâu (server, test, event handler), còn hook chỉ gọi được trong component.

Quy tắc: **nếu không có `useState`, `useEffect`, `useRef`, `useContext` hay hook khác bên trong, đó phải là một hàm thuần.**

## Mental Model

```text
Hook = một hàm gọi hook khác, đặt tên bắt đầu bằng "use"

Nó KHÔNG phải:
  - class ẩn (không có instance, không có `this`)
  - singleton (mỗi component gọi có state RIÊNG)
  - cách chia sẻ state giữa các component
```

Điểm cuối là hiểu nhầm phổ biến nhất:

```tsx
function useCounter() {
  const [n, setN] = useState(0);
  return { n, inc: () => setN(p => p + 1) };
}

// A và B có state HOÀN TOÀN RIÊNG
function A() { const { n } = useCounter(); }
function B() { const { n } = useCounter(); }
```

Hook chia sẻ **logic**, không chia sẻ **state**. Muốn chia sẻ state cần context hoặc store.

### Rules of Hooks — vì sao chúng tồn tại

```text
1. Chỉ gọi ở top level (không trong if, loop, nested function)
2. Chỉ gọi trong component hoặc trong hook khác
```

Lý do quy tắc 1: React lưu state theo **thứ tự gọi**, không theo tên. Mỗi component có một mảng hook nội bộ; lần render nào cũng phải khớp thứ tự.

```tsx
// ❌ Điều gì xảy ra khi cond đổi từ true sang false
if (cond) { const [a] = useState(1); }
const [b] = useState(2);
// Render 1 (cond=true):  hook[0]=a, hook[1]=b
// Render 2 (cond=false): hook[0]=b  ← b đọc state của a
```

Hiểu điều này giải thích luôn vì sao ESLint plugin `react-hooks` là bắt buộc, không phải khuyến nghị.

## How It Works

### Thiết kế một hook tốt

```tsx
// ✅ Một trách nhiệm, API rõ, có cleanup, TypeScript generic
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);          // cleanup — bắt buộc
  }, [value, delay]);

  return debounced;
}

// Dùng
const search = useDebouncedValue(input, 500);
useQuery({ queryKey: ['tasks', search], queryFn: () => api.search(search) });
```

Tiêu chí một hook tốt:

| Tiêu chí | Vì sao |
|---|---|
| Một trách nhiệm | dễ hiểu, dễ test, dễ tái dùng |
| Trả về giá trị stable | tránh gây render/effect ở component dùng nó |
| Có cleanup nếu có subscription | không leak |
| Không giả định về UI | hook về logic, không về hiển thị |
| Generic khi hợp lý | dùng được với nhiều loại dữ liệu |
| Không nhận quá nhiều option | > 4 option thường là dấu hiệu làm quá nhiều việc |

### Trả về gì

```tsx
// Object: khi có nhiều giá trị, gọi tên rõ, thứ tự không quan trọng
return { data, error, isLoading, refetch };

// Tuple: khi chỉ 2 giá trị và người dùng cần tự đặt tên
return [value, setValue] as const;    // `as const` để type là tuple, không phải array
```

Chú ý về stability: nếu hook trả về object literal mới mỗi render, mọi effect phụ thuộc nó sẽ chạy lại.

```tsx
// ❌ object mới mỗi render → effect ở component dùng nó chạy mãi
return { data, actions: { save, remove } };

// ✅
const actions = useMemo(() => ({ save, remove }), [save, remove]);
return { data, actions };
```

### Latest-ref để tránh dependency

```tsx
function useInterval(callback: () => void, ms: number | null) {
  const latest = useRef(callback);

  useEffect(() => { latest.current = callback; }, [callback]);   // luôn cập nhật

  useEffect(() => {
    if (ms === null) return;                        // null = tạm dừng
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms]);                                        // KHÔNG phụ thuộc callback
}
```

Không có `latest`, mỗi lần `callback` đổi reference (tức mỗi render) interval bị clear và tạo lại — timer không bao giờ chạy đúng.

### Khi nào **không** nên tạo hook

```tsx
// ❌ Không có state/effect → hàm thuần
function useIsAdmin(user: User) { return user.role === 'admin'; }
const isAdmin = (user: User) => user.role === 'admin';        // ✅ dùng được ở server, test

// ❌ Hook chỉ dùng một lần, làm code khó theo
function useEverythingForThisPage() { /* 200 dòng */ }

// ❌ Hook trả JSX → đó là component
function useModal() { return <div>...</div>; }
```

Hook thứ hai (`useEverythingForThisPage`) là mẫu phản diện phổ biến: nó không tái dùng gì, chỉ chuyển 200 dòng từ chỗ này sang chỗ khác và làm khó việc đọc luồng dữ liệu.

## Example

```tsx
// Hook hữu ích thật: đồng bộ với một hệ thống bên ngoài
function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;                       // private mode, quota, JSON lỗi
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);

  return [value, setValue] as const;
}
```

Hai chi tiết quan trọng: initializer là **function** (chỉ chạy lần đầu, không đọc localStorage mỗi render), và `try/catch` ở cả hai chiều vì `localStorage` **throw**. Xem [Cookies & storage](../../00-web-foundations/05-cookies-storage.md).

## Prediction

1. Hai component cùng gọi `useCounter()` — chúng chia sẻ `n` không?
2. `useState` bên trong một `if` — điều gì xảy ra khi điều kiện đổi?
3. Hook trả `{ data, actions: {...} }` không memo, component dùng nó có `useEffect(..., [actions])` — effect chạy mấy lần?
4. `useInterval` không có latest-ref, `callback` là arrow inline — interval có chạy đúng chu kỳ?
5. `useState(JSON.parse(localStorage.getItem(k)))` (không phải function) — `localStorage` được đọc mấy lần?
6. Hook không dùng hook nào bên trong — có gọi được ở ngoài component không?

<details>
<summary>Đáp án chọn lọc</summary>

1. Không — state riêng hoàn toàn.
2. Thứ tự hook lệch; state bị đọc sai chỗ; React báo lỗi "Rendered fewer/more hooks than expected".
3. Mỗi render — object literal luôn là reference mới.
4. Không — clear và tạo lại mỗi render, callback gần như không bao giờ chạy.
5. Mỗi render (đồng bộ, chặn main thread) — đó là lý do dùng lazy initializer.
6. Không, nếu tên bắt đầu bằng `use` thì ESLint chặn; nhưng về mặt runtime thì được — và đó là dấu hiệu nó nên là hàm thuần.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `useState` trong `if`, toggle điều kiện | React báo lỗi rõ ràng về số lượng hook |
| Hook trả object không memo, dùng làm dependency | Effect chạy vô hạn |
| `useInterval` không latest-ref, callback inline | Timer không chạy |
| Bỏ cleanup trong hook có subscription | Leak; đếm listener |
| Hai component dùng cùng hook, đổi state ở một cái | Cái kia không đổi — chứng minh state riêng |
| `useState(expensiveInit())` thay vì `useState(() => expensiveInit())` | Chạy mỗi render; đo bằng `console.time` |
| Hook có 8 option boolean | Thử dùng nó ở tình huống mới — API khó dùng |
| Gọi hook trong callback | ESLint chặn; nếu bỏ qua thì runtime lỗi |

## What Usually Goes Wrong

- **Hook không có state/effect** → nên là hàm thuần; mất khả năng dùng ở server/test.
- **Trả về reference không stable** → effect/render lan ở nơi dùng.
- **Thiếu cleanup** → leak.
- **Hook "god object"** làm 10 việc, chỉ dùng một lần.
- **Tin hook chia sẻ state** → hai component không đồng bộ, tưởng bug.
- **Không dùng lazy initializer** cho khởi tạo đắt → chạy mỗi render.
- **Gọi hook có điều kiện** → lỗi thứ tự hook.
- **Hook phụ thuộc thứ tự gọi với hook khác** → coupling ẩn, rất khó debug.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Hook chia sẻ state giữa component | Chia sẻ logic; state riêng cho mỗi lần gọi |
| Mọi logic tái dùng nên thành hook | Chỉ khi có state/effect; còn lại là hàm thuần |
| Hook là thay thế cho HOC/render props | Cho logic thì có; cho UI thì dùng component |
| Đặt tên `use*` là đủ để thành hook | Cần thực sự gọi hook bên trong |
| Rules of Hooks là quy ước style | Là yêu cầu kỹ thuật — state lưu theo thứ tự gọi |
| Nhiều hook nhỏ làm code rối | Ngược lại: dễ test, dễ hiểu hơn một hook lớn |
| `useState(init)` chỉ chạy `init` một lần | Biểu thức được **tính** mỗi render; chỉ kết quả bị bỏ qua |

## Debugging

1. **"Rendered more/fewer hooks than during the previous render"** → có hook gọi có điều kiện. Tìm `if`/`return` sớm trước một hook.
2. **Effect chạy vô hạn** → log dependency; tìm giá trị từ hook không stable.
3. **State không đồng bộ giữa hai component** → không phải bug; hook có state riêng. Cần context/store.
4. **Test hook độc lập** với `renderHook` của Testing Library — nếu khó test thì hook đang làm quá nhiều việc.
5. Bật ESLint `react-hooks/rules-of-hooks` (error) và `exhaustive-deps` (error). Chúng bắt hầu hết vấn đề trước runtime.
6. Hook chậm → React DevTools Profiler hiện thời gian của từng hook trong component.

## Production Considerations

- **`eslint-plugin-react-hooks` với cả hai rule ở mức error** trong CI.
- **Đặt hook dùng chung trong `hooks/`** với test riêng; hook là API nội bộ, đối xử như vậy.
- **Ưu tiên hook của thư viện đã trưởng thành** (TanStack Query, React Hook Form, `usehooks-ts`) cho các vấn đề phổ biến — chúng đã xử lý các edge case mà bạn sẽ gặp sau.
- **Không tạo hook chỉ để "tổ chức code"** trong một component; dùng hàm thuần hoặc tách component.
- Với React 19 + Compiler, memo hoá tự động giảm nhu cầu `useCallback`/`useMemo` trong hook, nhưng yêu cầu về cleanup, stability của reference trả về, và Rules of Hooks không đổi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Custom hook | tái dùng logic có state | chỉ gọi được trong component |
| Hàm thuần | dùng ở mọi đâu, dễ test | không giữ được state |
| Nhiều hook nhỏ | dễ test, dễ tổ hợp | nhiều file |
| Một hook lớn | ít import | khó test, khó tái dùng |
| Trả tuple | người dùng tự đặt tên | thứ tự phải nhớ |
| Trả object | tên rõ ràng | cần memo để stable |

## Explain Without Notes

1. Hook chia sẻ gì và **không** chia sẻ gì giữa các component?
2. Vì sao không được gọi hook trong `if`? Cơ chế nào của React bị phá?
3. Khi nào một "hook" nên là hàm thuần?
4. Latest-ref pattern giải quyết vấn đề gì trong `useInterval`?
5. Vì sao `useState(() => init())` khác `useState(init())`?

## Related

- [Effects & lifecycle](02-effects-lifecycle.md) — cleanup trong hook
- [Props & state design](06-props-composition-state-design.md) — composition cho UI
- [Context & memoization](07-context-memoization.md) — chia sẻ state thật
- [Testing React](13-testing-react.md) — test hook
- [Closure](../../01-javascript-typescript/fundamentals/01-execution-context-closure.md) — cơ chế nền
- [Advanced types](../../01-javascript-typescript/typescript/03-advanced-types.md) — generic cho hook
