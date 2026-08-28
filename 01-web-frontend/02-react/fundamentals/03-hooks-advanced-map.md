---
level: foundation
area: frontend
prerequisites:
  - 01-components-and-rendering-model.md
related:
  - ../behavior/11-custom-hooks.md
  - ../behavior/12-performance.md
---

# Bản đồ hooks: cái nào tồn tại, dùng khi nào

> Một đội ngũ dùng `useEffect` để đồng bộ với một store bên ngoài. Component đọc `store.getState()` trong render và subscribe trong effect. Nó chạy đúng — cho tới khi bật concurrent rendering, và UI bắt đầu hiển thị giá trị cũ trong một số lần render. React có một hook dành riêng cho đúng việc này (`useSyncExternalStore`), nhưng **không ai biết nó tồn tại** vì nó không xuất hiện trong bất kỳ tutorial nào họ từng đọc.

## Position

```text
Note này là BẢN ĐỒ, không phải hướng dẫn sâu.

  Mỗi hook: nó giải quyết vấn đề gì · khi nào KHÔNG dùng · đi đâu để đọc sâu.
  Các hook quan trọng có note riêng; các hook nhỏ dừng ở đây là đủ.
```

## Problem

```text
React có 18 hook chính thức. Phần lớn tutorial dạy 4.

Hệ quả:
  · giải quyết vấn đề đã có hook sẵn bằng useEffect thủ công
  · dùng useEffect cho thứ không phải "đồng bộ với hệ thống ngoài"
  · không biết một hook tồn tại nên không biết mình đang làm sai

⇒ vấn đề không phải học thuộc 18 hook.
  Vấn đề là biết CÁI GÌ TỒN TẠI để tra khi gặp đúng bài toán.
```

## Mental Model

### Bốn nhóm theo vấn đề chúng giải quyết

```text
① NHỚ GIỮA CÁC RENDER      useState · useReducer · useRef
② ĐỒNG BỘ VỚI BÊN NGOÀI     useEffect · useLayoutEffect · useSyncExternalStore
                            · useInsertionEffect · useEffectEvent
③ ĐỌC GIÁ TRỊ TỪ TRÊN       useContext
④ ĐIỀU KHIỂN ƯU TIÊN/CHI PHÍ useMemo · useCallback · useTransition · useDeferredValue

+ TIỆN ÍCH: useId · useDebugValue · useImperativeHandle · useActionState
            · useOptimistic · useFormStatus (react-dom)
```

```text
Câu hỏi phân loại nhanh:
  "cần nhớ gì đó?"          → nhóm ①
  "cần chạm thứ ngoài React?" → nhóm ②
  "cần dữ liệu từ tổ tiên?"  → nhóm ③
  "React làm quá nhiều việc?" → nhóm ④  ← và chỉ sau khi ĐO
```

## Nhóm ① — Nhớ giữa các render

| Hook | Vấn đề nó giải quyết | KHÔNG dùng khi | Đọc sâu |
|---|---|---|---|
| `useState` | giá trị thay đổi và cần render lại khi đổi | giá trị **tính được** từ props/state khác | [01](../behavior/01-state-render.md) |
| `useReducer` | nhiều mảnh state ràng buộc nhau, nhiều chuyển trạng thái | một hai giá trị độc lập | [14](../behavior/14-usereducer-state-machines.md) |
| `useRef` | nhớ giá trị **không** gây render; giữ DOM node | giá trị cần hiển thị trên UI | [08](../behavior/08-refs-uncontrolled.md) |

```text
Ranh giới useState / useRef:
  đổi giá trị → UI phải đổi?  → useState
  đổi giá trị → UI không đổi? → useRef
    (timer id, giá trị trước đó, cờ "đã chạy", instance thư viện ngoài)
```

## Nhóm ② — Đồng bộ với bên ngoài

| Hook | Vấn đề | Chạy khi nào | KHÔNG dùng khi | Đọc sâu |
|---|---|---|---|---|
| `useEffect` | đồng bộ với hệ thống ngoài React | sau khi trình duyệt vẽ | tính derived state; xử lý sự kiện người dùng | [02](../behavior/02-effects-lifecycle.md) |
| `useLayoutEffect` | đo layout rồi sửa **trước khi** người dùng thấy | sau commit, **trước** khi vẽ | mọi trường hợp khác — nó chặn vẽ | [02](../behavior/02-effects-lifecycle.md) |
| `useSyncExternalStore` | subscribe store ngoài, an toàn với concurrent rendering | khi subscribe | state thuần React | dưới đây |
| `useInsertionEffect` | thư viện CSS-in-JS chèn `<style>` | trước mọi mutation DOM | bạn không viết thư viện CSS | — |
| `useEffectEvent` | tách phần **không phản ứng** ra khỏi effect | — | chỉ để làm im lint | dưới đây |

### `useSyncExternalStore` — hook bị bỏ quên nhiều nhất

```text
Vấn đề: React có thể render nhiều lần trước khi commit (concurrent).
Nếu bạn đọc store ngoài trong render và subscribe trong effect,
giá trị đọc được có thể CŨ so với lúc commit → tearing (UI không nhất quán).

`useSyncExternalStore` đảm bảo React luôn đọc giá trị nhất quán.
```

```ts
const isOnline = useSyncExternalStore(
  (cb) => { addEventListener('online', cb); addEventListener('offline', cb);
            return () => { removeEventListener('online', cb);
                           removeEventListener('offline', cb); }; },
  () => navigator.onLine,        // đọc giá trị ở client
  () => true,                    // giá trị cho server render (bắt buộc nếu có SSR)
);
```

```text
Dùng khi: `window`, `localStorage`, `matchMedia`, store của thư viện ngoài,
          bất cứ nguồn dữ liệu nào KHÔNG do React quản lý.
Không dùng khi: dữ liệu đã ở trong React state hoặc context.
```

### `useEffectEvent` — tách phần không phản ứng

```ts
function ChatRoom({ roomId, theme }: { roomId: string; theme: string }) {
  // đọc `theme` MỚI NHẤT nhưng KHÔNG làm effect chạy lại khi theme đổi
  const onConnected = useEffectEvent(() => showToast('Đã kết nối', theme));

  useEffect(() => {
    const conn = connect(roomId);
    conn.on('connected', onConnected);
    return () => conn.disconnect();
  }, [roomId]);           // ← chỉ roomId; đổi theme KHÔNG kết nối lại
}
```

```text
Nó giải quyết đúng một vấn đề: một effect cần ĐỌC giá trị mới nhất
nhưng KHÔNG được chạy lại khi giá trị đó đổi.

⚠ Không dùng để làm im cảnh báo lint. Nếu effect thật sự phụ thuộc
  một giá trị, nó phải nằm trong dependency array.
```

## Nhóm ③ — Đọc giá trị từ trên

| Hook | Vấn đề | KHÔNG dùng khi | Đọc sâu |
|---|---|---|---|
| `useContext` | tránh truyền prop qua nhiều tầng trung gian | dữ liệu chỉ đi xuống 1–2 tầng; hoặc giá trị đổi rất thường xuyên | [07](../behavior/07-context-memoization.md) |

```text
Context KHÔNG phải state manager. Nó là cơ chế TRUYỀN.
Mọi consumer re-render khi giá trị context đổi tham chiếu.
→ tách context theo tần suất thay đổi; tách state và dispatch.
```

## Nhóm ④ — Điều khiển ưu tiên và chi phí

| Hook | Vấn đề | KHÔNG dùng khi | Đọc sâu |
|---|---|---|---|
| `useMemo` | tính toán **thật sự** tốn kém lặp lại mỗi render | phép tính rẻ — nó tự tốn chi phí | [07](../behavior/07-context-memoization.md) |
| `useCallback` | giữ tham chiếu hàm ổn định cho `memo` hoặc dependency array | hàm không phải dependency của gì cả | [07](../behavior/07-context-memoization.md) |
| `useTransition` | đánh dấu cập nhật là **không khẩn cấp**, cho phép ngắt | cập nhật cần phản hồi tức thì (gõ chữ vào input) | [12](../behavior/12-performance.md) |
| `useDeferredValue` | hoãn phần UI nặng, giữ phần nhập liệu mượt | bạn kiểm soát được nơi gọi setState → dùng `useTransition` | [12](../behavior/12-performance.md) |

```text
Cả bốn hook nhóm này đều là TỐI ƯU.
Quy tắc: ĐO TRƯỚC. Thêm chúng mà không đo thường làm code phức tạp hơn
mà không nhanh hơn — và `useMemo`/`useCallback` tự nó tốn bộ nhớ và so sánh.

React Compiler (ổn định từ 2025) tự động memo hoá phần lớn trường hợp
→ nếu dự án bật React Compiler, phần lớn `useMemo`/`useCallback` thủ công là thừa.
```

```text
useTransition vs useDeferredValue:
  useTransition     bạn SỞ HỮU lời gọi setState → bọc nó
                    startTransition(() => setQuery(v))
  useDeferredValue  giá trị đến từ props, bạn KHÔNG sở hữu setState
                    const deferred = useDeferredValue(query)
```

## Tiện ích

| Hook | Vấn đề | Ghi chú |
|---|---|---|
| `useId` | sinh id ổn định, khớp giữa server và client | dùng cho `htmlFor`/`aria-describedby`. **Không** dùng làm key trong list |
| `useDebugValue` | nhãn cho custom hook trong React DevTools | chỉ hữu ích trong thư viện |
| `useImperativeHandle` | cho cha gọi method của con qua ref | hiếm khi cần — cân nhắc props trước |
| `useActionState` | quản lý state của một action (form + Server Action) | React 19; xem [10-forms](../behavior/10-forms.md) |
| `useOptimistic` | hiển thị kết quả lạc quan trong khi action chạy | React 19 |
| `useFormStatus` | đọc trạng thái pending của `<form>` bao quanh | từ `react-dom`, không phải `react` |

### `useId` — tránh một lỗi hydration phổ biến

```tsx
function Field({ label }: { label: string }) {
  const id = useId();                      // ổn định giữa server và client
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} />
    </>
  );
}
```

```text
Vì sao không dùng `Math.random()` hay counter tự viết:
  server sinh một giá trị, client sinh giá trị khác → hydration mismatch.
`useId` được thiết kế để khớp giữa hai môi trường.
```

## API không phải hook nhưng cần biết tồn tại

| API | Vấn đề | Đọc sâu |
|---|---|---|
| `createPortal` | render con vào **DOM node khác** nhưng giữ nguyên vị trí trong cây React | dưới đây |
| `memo` | bỏ qua render lại khi props không đổi tham chiếu | [12](../behavior/12-performance.md) |
| `lazy` + `Suspense` | tách bundle và hiển thị fallback khi đang tải | [09](../behavior/09-error-boundaries-suspense.md) |
| Error Boundary | bắt lỗi render của cây con | [09](../behavior/09-error-boundaries-suspense.md) |
| `<Activity>` | ẩn UI bằng `display:none` nhưng **giữ state** và dọn effect | React 19.2 |

### `createPortal` — thoát khỏi DOM cha, không thoát khỏi cây React

```tsx
function Modal({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div className="overlay">{children}</div>,
    document.body,                    // DOM node đích
  );
}
```

```text
Điểm hay bị hiểu sai:
  · DOM: phần tử nằm trong <body> → thoát được `overflow: hidden` của cha
  · REACT: nó VẪN là con trong cây React
    → context vẫn đọc được
    → SỰ KIỆN VẪN NỔI BỌT LÊN CHA TRONG CÂY REACT, không theo cây DOM
    → error boundary của cha vẫn bắt được lỗi

Dùng cho: modal, tooltip, dropdown — thứ cần thoát khỏi
`overflow: hidden` hoặc `z-index` của container.
```

## Rules of Hooks — vì sao chúng tồn tại

```text
① Chỉ gọi hook ở CẤP CAO NHẤT của component hoặc custom hook
   → không trong if, loop, hàm lồng, sau early return
② Chỉ gọi hook từ component React hoặc custom hook
   → không từ hàm thường

Lý do: React nhận diện ô nhớ của mỗi hook bằng THỨ TỰ GỌI.
Thứ tự đổi giữa hai lần render = state gán nhầm ô = lỗi rất khó tìm.
```

Xem [React foundations](01-components-and-rendering-model.md) và [Custom hooks](../behavior/11-custom-hooks.md).

## Prediction

1. Cần nhớ một timer id, không hiển thị lên UI — dùng hook nào?
2. Cần subscribe `window.matchMedia` — hook nào là đúng, và vì sao không phải `useEffect`?
3. Effect cần đọc giá trị mới nhất của `theme` nhưng không được chạy lại khi `theme` đổi — hook nào?
4. `useLayoutEffect` làm việc 200ms — người dùng thấy gì?
5. Bạn sở hữu lời gọi `setState` và muốn nó không chặn UI — `useTransition` hay `useDeferredValue`?
6. Giá trị đến từ props, bạn không sở hữu `setState` — hook nào?
7. `useMemo` cho một phép cộng hai số — lợi hay hại?
8. Dự án bật React Compiler — `useCallback` thủ công còn cần không?
9. `useId` dùng làm `key` trong danh sách — đúng hay sai?
10. Sinh id bằng `Math.random()` trong component có SSR — chuyện gì xảy ra?
11. Modal render bằng `createPortal` vào `document.body`, bấm vào trong modal — sự kiện nổi bọt lên đâu?
12. Modal đó có đọc được context của cha không?
13. Gọi `useState` sau một `return` sớm — React nói gì?
14. Đọc store ngoài trong render + subscribe trong `useEffect`, bật concurrent rendering — rủi ro gì?

<details>
<summary>Đáp án</summary>

1. **`useRef`** — thay đổi không cần render.
2. **`useSyncExternalStore`** — nó đảm bảo giá trị nhất quán khi concurrent rendering; `useEffect` có thể gây tearing.
3. **`useEffectEvent`**.
4. Màn hình **đứng hình 200ms** — layout effect chặn vẽ.
5. **`useTransition`**.
6. **`useDeferredValue`**.
7. **Hại** — chi phí so sánh và bộ nhớ lớn hơn phép cộng.
8. Phần lớn là **không** — compiler tự memo hoá.
9. **Sai** — key phải đến từ danh tính dữ liệu, không phải id sinh ra.
10. **Hydration mismatch** — server và client sinh giá trị khác nhau.
11. Lên **cha trong cây React**, không theo cây DOM.
12. **Có** — portal không rời khỏi cây React.
13. Vi phạm Rules of Hooks — **thứ tự hook thay đổi** giữa các render.
14. **Tearing** — UI hiển thị giá trị không nhất quán giữa các phần.
</details>

## What Usually Goes Wrong

- **Dùng `useEffect` cho mọi thứ** — kể cả derived state và subscribe store ngoài.
- **Không biết `useSyncExternalStore` tồn tại** → tự viết subscribe và gặp tearing.
- **Dùng `useEffectEvent` để làm im lint** thay vì sửa dependency thật.
- **`useLayoutEffect` làm mặc định** → chặn vẽ không cần thiết.
- **`useMemo`/`useCallback` rải khắp nơi** mà không đo.
- **Nhầm `useTransition` với `useDeferredValue`.**
- **`useId` làm key trong list.**
- **Sinh id ngẫu nhiên trong component có SSR** → hydration mismatch.
- **Tưởng portal thoát khỏi cây React** → ngạc nhiên vì sự kiện nổi bọt "sai chỗ".
- **Gọi hook có điều kiện** → state gán nhầm ô.
- **Dùng `useImperativeHandle`** khi một prop là đủ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `useEffect` là nơi chạy mọi thứ sau render | Nó là để **đồng bộ với hệ thống ngoài React** |
| `useRef` chỉ dùng cho DOM | Nó là ô nhớ không gây render |
| `useMemo` luôn cải thiện hiệu năng | Nó có chi phí riêng; cần đo |
| `useCallback` làm component nhanh hơn | Chỉ khi hàm là dependency hoặc prop của `memo` |
| `useContext` là state manager | Nó là cơ chế truyền, không quản lý state |
| `useTransition` và `useDeferredValue` như nhau | Khác nhau ở chỗ ai sở hữu `setState` |
| Portal tách component khỏi cây React | Chỉ tách khỏi cây **DOM** |
| Hook lạ thì không cần biết | Không biết nó tồn tại là lý do bạn làm sai |
| React Compiler thay thế mọi hook tối ưu | Nó thay `useMemo`/`useCallback`, không thay `useTransition` |

## Explain Without Notes

1. Bốn nhóm hook theo vấn đề, và câu hỏi phân loại nhanh cho từng nhóm.
2. Ranh giới giữa `useState` và `useRef`?
3. `useSyncExternalStore` giải quyết vấn đề gì mà `useEffect` không?
4. `useEffectEvent` dùng khi nào, và khi nào **không** được dùng?
5. `useTransition` và `useDeferredValue` khác nhau ở điểm nào?
6. Vì sao `useId` tồn tại thay vì tự sinh id?
7. Portal tách khỏi cái gì và **không** tách khỏi cái gì?
8. Rules of Hooks tồn tại vì cơ chế nào bên trong React?

## Related

- [React foundations](01-components-and-rendering-model.md) — element, render, commit, vị trí trong cây
- [State & render](../behavior/01-state-render.md) — `useState`
- [Effects & lifecycle](../behavior/02-effects-lifecycle.md) — `useEffect`, `useLayoutEffect`
- [Context & memoization](../behavior/07-context-memoization.md) — `useContext`, `useMemo`, `useCallback`
- [Refs & uncontrolled](../behavior/08-refs-uncontrolled.md) — `useRef`
- [useReducer & state machine](../behavior/14-usereducer-state-machines.md) — `useReducer`
- [Error boundaries & Suspense](../behavior/09-error-boundaries-suspense.md) — `lazy`, Suspense
- [Performance](../behavior/12-performance.md) — `useTransition`, `useDeferredValue`, `memo`
- [Custom hooks](../behavior/11-custom-hooks.md) — gói logic thành hook riêng
- [Forms](../behavior/10-forms.md) — `useActionState`, `useFormStatus`

## Version / Context

React 19.2 (10/2025). `useEffectEvent` ổn định từ 19.2 (trước đó là `experimental_useEffectEvent`). `useActionState`, `useOptimistic` từ React 19. `useSyncExternalStore` từ React 18. `<Activity>` và View Transitions từ 19.2. React Compiler 1.0 ổn định — khi bật, phần lớn `useMemo`/`useCallback` thủ công không còn cần. `useFormStatus` nằm trong `react-dom`, không phải `react`.
