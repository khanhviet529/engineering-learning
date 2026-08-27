---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
related:
  - 10-forms.md
  - 05-reconciliation-keys.md
---

# Refs & uncontrolled components

> Ref là chỗ để giữ giá trị mà **không** gây render, và là cửa duy nhất để chạm vào DOM thật. Dùng sai nó cho state hiển thị là cách tạo ra UI nói dối.

## Position

```text
React state  → render → DOM
React ref    → KHÔNG render → trỏ trực tiếp vào DOM node hoặc giá trị bất kỳ
```

## Problem

```tsx
// 1. Cần focus vào input sau khi mở modal — state không làm được điều này
// 2. Cần biết chiều cao thật của element để định vị tooltip
// 3. Cần giữ id của timer để clear — nhưng không muốn render mỗi lần nó đổi
// 4. Cần giữ giá trị "trước đó" để so sánh
```

Bốn nhu cầu này có điểm chung: **giá trị cần được ghi nhớ nhưng không dùng để tính UI**. Đưa chúng vào state là sai — bạn trả giá render cho một giá trị không ảnh hưởng đến những gì hiển thị.

## Mental Model

```text
useState  → "giá trị này QUYẾT ĐỊNH UI"        → đổi thì phải render
useRef    → "giá trị này chỉ để tôi ghi nhớ"   → đổi thì KHÔNG render
```

`useRef` trả về một object `{ current }` **giữ nguyên identity** suốt đời component. Bạn ghi vào `.current` bất cứ lúc nào, không cần setter, không gây render.

Câu hỏi để chọn:

> **Nếu giá trị này đổi mà UI không cập nhật, có phải là bug không?**
>
> Có → state. Không → ref.

Hệ quả quan trọng: **không đọc/ghi `ref.current` trong lúc render.** Render phải là hàm thuần; đọc một giá trị có thể đã bị mutate làm output không xác định. Đọc trong effect và event handler.

## How It Works

### DOM ref

```tsx
function SearchBox() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();       // DOM đã tồn tại ở thời điểm effect
  }, []);

  return <input ref={inputRef} />;
}
```

`ref.current` là `null` trong lúc render đầu tiên (DOM chưa tạo) và được gán trước khi effect chạy. Đó là lý do luôn cần `?.`.

Việc hợp lệ để làm với DOM ref: `focus()`, `blur()`, `scrollIntoView()`, đo kích thước, `select()`, gọi API của thư viện không phải React (chart, map, editor), play/pause media.

Việc **không** nên làm: đổi `textContent`, thêm/xoá class, sửa style để hiển thị — đó là việc của render. Sửa DOM sau lưng React nghĩa là lần render tiếp theo sẽ ghi đè, hoặc tệ hơn, React và DOM lệch nhau.

### Ref cho giá trị (không phải DOM)

```tsx
// Timer id — đổi liên tục nhưng không ảnh hưởng UI
const timerRef = useRef<ReturnType<typeof setTimeout>>();

const debouncedSave = (v: string) => {
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => save(v), 500);
};

// Giá trị trước đó
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => { ref.current = value; });   // ghi SAU render
  return ref.current;                          // đọc giá trị của render trước
}

// Tránh stale closure mà không cần thêm dependency
const latest = useRef(callback);
useEffect(() => { latest.current = callback; }, [callback]);
useEffect(() => {
  const id = setInterval(() => latest.current(), 1000);   // luôn gọi bản mới nhất
  return () => clearInterval(id);
}, []);                                                   // interval không bị tạo lại
```

Pattern cuối (`latest ref`) là cách chuẩn để một subscription dài hạn gọi callback mới nhất mà không phải tạo lại subscription mỗi lần callback đổi. Xem [Effects](02-effects-lifecycle.md).

### Uncontrolled component

```tsx
// Uncontrolled: DOM giữ giá trị, đọc khi cần
function Form() {
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save({ name: nameRef.current!.value });    // đọc một lần lúc submit
  };

  return (
    <form onSubmit={submit}>
      <input ref={nameRef} defaultValue="" />   {/* defaultValue, KHÔNG value */}
    </form>
  );
}
```

So sánh:

| | Uncontrolled | Controlled |
|---|---|---|
| Nguồn giá trị | DOM | React state |
| Render khi gõ | **không** | mỗi ký tự |
| Validate live | khó | dễ |
| Format khi gõ (currency, phone) | khó | dễ |
| Reset | `form.reset()` hoặc `key` | `setState` |
| Đồng bộ với UI khác | khó | dễ |

Mặc định nên là **uncontrolled** cho form thường: đơn giản hơn và không render mỗi ký tự. Chuyển sang controlled khi cần validate/format/đồng bộ theo từng thay đổi. Thư viện form (React Hook Form) dùng uncontrolled chính vì lý do hiệu năng này. Xem [Forms](10-forms.md).

### `ref` như prop (React 19)

```tsx
// React 19: ref là prop bình thường
function Input({ ref, ...props }: { ref?: Ref<HTMLInputElement> } & InputProps) {
  return <input ref={ref} {...props} />;
}

// React 18 và trước: cần forwardRef
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) =>
  <input ref={ref} {...props} />);
```

### Callback ref

```tsx
// Chạy khi node được gắn/tháo — dùng khi cần biết thời điểm
<div ref={(node) => {
  if (node) observer.observe(node);
  return () => observer.unobserve(node);   // cleanup — React 19
}} />
```

Callback ref hữu ích khi node xuất hiện/biến mất theo điều kiện, vì effect với `[]` không biết điều đó.

## Example

```tsx
// Đo kích thước — cần useLayoutEffect để không nhảy một frame
function Tooltip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const h = ref.current?.getBoundingClientRect().height ?? 0;
    setTop(-h - 8);                  // đặt trước khi browser paint
  }, [children]);

  return <div ref={ref} style={{ top }}>{children}</div>;
}
```

Ở đây `top` **là** state (nó quyết định UI), còn `ref` chỉ để đo. Đó là sự phân vai đúng.

## Prediction

1. `ref.current` trong lần render đầu tiên — giá trị gì?
2. `ref.current = 5` rồi `console.log(ref.current)` — component có render? Log ra gì?
3. `usePrevious(count)` với `count` vừa đổi từ 1 → 2 — trả về gì?
4. Input uncontrolled với 20 field, gõ một ký tự — bao nhiêu render?
5. Cùng form nhưng controlled — bao nhiêu render?
6. `<input value={v} />` không có `onChange` — gõ được không?
7. Đặt `<input value={v} />` với `v` từ ref (`ref.current`) và mutate ref — UI cập nhật?

<details>
<summary>Đáp án chọn lọc</summary>

1. `null` (DOM chưa gắn).
2. Không render; log `5`.
3. `1` — vì effect ghi giá trị mới *sau* render.
4. 0 render — DOM tự giữ giá trị.
5. 1 render mỗi ký tự.
6. Không — React coi là controlled, giá trị bị khoá; console cảnh báo.
7. Không — mutate ref không gây render, UI đứng ở giá trị của lần render cuối. Đây chính là cách tạo UI nói dối.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dùng ref cho giá trị hiển thị, mutate nó | UI không cập nhật — "nói dối" |
| Đọc `ref.current` trong render body | Kết quả không xác định, khác nhau giữa dev/prod |
| `<input value={v}>` không có `onChange` | Input đóng băng + cảnh báo |
| Đổi `textContent` bằng ref rồi setState | Thay đổi bị ghi đè |
| Effect với `[]` truy cập ref của element render có điều kiện | `null` khi element chưa xuất hiện |
| Form controlled 30 field, gõ nhanh với CPU throttle 4× | Lag rõ rệt |
| Cùng form uncontrolled | Mượt |
| Component bị unmount (đổi `key`) sau khi lưu giá trị vào ref | Giá trị mất — ref không sống qua unmount |

## What Usually Goes Wrong

- **Dùng ref cho state hiển thị** → UI không cập nhật.
- **Dùng state cho giá trị không hiển thị** (timer id, flag nội bộ) → render vô ích.
- **Đọc/ghi ref trong render** → không thuần, StrictMode phát hiện.
- **Sửa DOM trực tiếp** thay vì render → React ghi đè hoặc lệch trạng thái.
- **Quên `?.`** → `Cannot read properties of null` trong lần render đầu.
- **Trộn controlled/uncontrolled** (`value` + `defaultValue`) → cảnh báo và behavior lạ.
- **Tin ref sống qua unmount** → mất giá trị khi `key` đổi hoặc component bị bỏ.
- **Ref vào component React** (không phải DOM) mà không có `forwardRef` (React ≤ 18) → `null`.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Ref chỉ dùng cho DOM | Dùng cho bất kỳ giá trị cần ghi nhớ không gây render |
| Đổi `ref.current` gây render | Không bao giờ |
| Ref là "state nhanh hơn" | Nó không phải state; UI sẽ không phản ánh nó |
| Controlled input luôn tốt hơn | Gây render mỗi ký tự; uncontrolled thường đủ và nhanh hơn |
| `useRef` giữ giá trị qua unmount | Mất khi component unmount |
| Có thể đọc ref an toàn ở mọi nơi | Không trong render body |
| `forwardRef` vẫn bắt buộc | React 19 cho phép `ref` như prop thường |

## Debugging

1. **UI không cập nhật** → kiểm tra giá trị đó là ref hay state. Nếu ref, đó là nguyên nhân.
2. **`null` khi truy cập ref** → xác định thời điểm: render (chưa gắn) hay effect (đã gắn)? Element có render có điều kiện không?
3. **Cảnh báo controlled/uncontrolled** → chọn một; không truyền cả `value` và `defaultValue`.
4. **Render nhiều khi gõ** → Profiler; nếu mỗi ký tự một render, xét chuyển sang uncontrolled hoặc thư viện form.
5. **DOM lệch với React** → tìm chỗ sửa DOM trực tiếp qua ref.
6. `ref.current` khác nhau giữa dev và production → đang đọc trong render body.

## Production Considerations

- **Form lớn nên uncontrolled** (React Hook Form) — nó thay đổi trải nghiệm rõ rệt trên máy yếu.
- Khi tích hợp thư viện không phải React (chart, map, editor, video player), ref là ranh giới đúng: khởi tạo trong effect, dọn trong cleanup.
- Dùng `useLayoutEffect` khi đo DOM để tránh nhảy layout — nhưng nó chặn paint, nên giữ nhỏ.
- Accessibility: focus management (focus vào modal khi mở, trả focus khi đóng) dựa hoàn toàn vào ref, và là yêu cầu thật chứ không phải tối ưu.
- Với SSR, ref là `null` trên server; mọi code dùng ref phải nằm trong effect.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Uncontrolled | không render khi gõ, đơn giản | khó validate/format live |
| Controlled | kiểm soát hoàn toàn | render mỗi ký tự |
| Ref cho giá trị | không render | UI không phản ánh; dễ tạo bug im lặng |
| State cho mọi thứ | UI luôn đúng | render nhiều hơn cần |
| Latest-ref pattern | subscription không tạo lại | thêm một tầng gián tiếp |

## Explain Without Notes

1. Câu hỏi một câu để quyết định state hay ref?
2. Vì sao không được đọc `ref.current` trong render body?
3. Uncontrolled khác controlled ở đâu về số lần render?
4. Ba việc hợp lệ và hai việc không nên làm với DOM ref?
5. Latest-ref pattern giải quyết vấn đề gì?

## Related

- [State → render](01-state-render.md) — cái gì gây render
- [Effects & lifecycle](02-effects-lifecycle.md) — nơi an toàn để dùng ref
- [Forms](10-forms.md) — controlled vs uncontrolled trong thực tế
- [Reconciliation & keys](05-reconciliation-keys.md) — mount lại làm mất ref
- [React performance](12-performance.md)
