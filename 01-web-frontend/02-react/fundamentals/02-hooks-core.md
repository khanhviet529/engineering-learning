---
level: foundation
area: frontend
prerequisites:
  - 01-components-and-rendering-model.md
related:
  - 03-hooks-advanced-map.md
  - ../behavior/01-state-render.md
---

# Năm hook cốt lõi

> Một dev viết `useEffect` để tính `fullName` từ `firstName` và `lastName`. Nó chạy đúng, nhưng gây thêm một lần render mỗi khi tên đổi, và có một khoảnh khắc UI hiển thị giá trị cũ. Ba tháng sau, cùng dự án có 40 effect kiểu này. **Không ai làm sai cú pháp — họ chỉ dùng `useEffect` cho một việc không phải của nó.**

## Position

```text
Năm hook này chiếm ~95% code React hằng ngày:

  useState · useReducer   → nhớ
  useRef                  → nhớ mà KHÔNG render
  useContext              → đọc từ tổ tiên
  useEffect               → đồng bộ với thế giới ngoài React

Note này: mỗi hook giải quyết vấn đề gì và KHÔNG dùng khi nào.
Đọc sâu ở behavior/. Hook còn lại ở 03-hooks-advanced-map.
```

## Problem

```text
Hook nào cũng "chạy được" cho gần như mọi việc.
Điều đó làm việc chọn sai hook KHÔNG gây lỗi — nó gây:

  · render thừa           · UI nhấp nháy giá trị cũ
  · state không đồng bộ   · effect chạy vòng vô hạn
  · code không thể suy luận được sau sáu tháng

⇒ chọn đúng hook là quyết định thiết kế, không phải chi tiết cú pháp.
```

## `useState` — giá trị thay đổi và UI phải đổi theo

```tsx
const [count, setCount] = useState(0);
setCount(c => c + 1);        // dạng hàm: an toàn khi cập nhật liên tiếp
```

```text
DÙNG khi     giá trị đổi → giao diện phải vẽ lại
KHÔNG dùng   · giá trị TÍNH ĐƯỢC từ props/state khác  → tính thẳng trong render
             · giá trị đổi mà UI không cần đổi         → useRef
             · dữ liệu đến từ server                    → thư viện server-state
             · nhiều mảnh ràng buộc lẫn nhau            → useReducer
```

```text
Ba điều phải nhớ:
① `setState` KHÔNG cập nhật biến ngay — giá trị bị đóng băng trong render đó
② nhiều `setState` trong cùng một event được GỘP thành một lần render
③ dùng dạng hàm `setX(prev => ...)` khi giá trị mới phụ thuộc giá trị cũ
```

```tsx
// ✗ derived state: thêm state + thêm effect + một nhịp UI sai
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✓ tính trong render — không state, không effect, không nhịp sai
const fullName = `${first} ${last}`;
```

Đây chính là sự cố ở đầu note. Quy tắc: **nếu tính được từ thứ đã có, đừng lưu nó.**

## `useReducer` — nhiều mảnh state ràng buộc nhau

```tsx
const [state, dispatch] = useReducer(reducer, { status: 'idle' });
dispatch({ type: 'submitted' });
```

```text
DÙNG khi     · các mảnh state không được phép sai tổ hợp
             · state tiếp theo phụ thuộc state trước theo quy tắc rõ ràng
             · cùng logic cập nhật gọi từ nhiều nơi
KHÔNG dùng   một hai giá trị độc lập — `useState` ngắn hơn và rõ hơn

Câu hỏi phân biệt: "có tổ hợp state nào KHÔNG ĐƯỢC PHÉP xảy ra không?"
```

Reducer phải **thuần**: không gọi API, không `Date.now()`, không mutate. Xem [useReducer & state machine](../behavior/14-usereducer-state-machines.md).

## `useRef` — nhớ mà không render

```tsx
const inputRef = useRef<HTMLInputElement>(null);   // ① tham chiếu DOM
const timerRef = useRef<number | null>(null);      // ② giá trị bất kỳ
```

```text
DÙNG khi     · cần DOM node thật (focus, đo kích thước, thư viện ngoài)
             · nhớ giá trị giữa các render mà UI KHÔNG phụ thuộc nó
               (timer id, giá trị trước đó, instance thư viện, cờ "đã chạy")
KHÔNG dùng   · giá trị cần hiển thị        → useState
             · để "né" cảnh báo dependency  → sửa dependency thật
```

```text
Ranh giới một câu:
  đổi giá trị → UI phải đổi?  → useState
  đổi giá trị → UI không đổi? → useRef

Và: ĐỪNG đọc/ghi `ref.current` trong lúc render.
Nó phá tính thuần của render. Chỉ chạm nó trong event handler hoặc effect.
```

## `useContext` — đọc giá trị từ tổ tiên

```tsx
const ThemeContext = createContext<Theme>('light');
const theme = useContext(ThemeContext);
```

```text
DÙNG khi     dữ liệu cần ở nhiều nơi, cách xa nhau trong cây
             (theme, user hiện tại, locale, config)
KHÔNG dùng   · chỉ đi xuống 1–2 tầng      → truyền prop
             · giá trị đổi rất thường xuyên → mọi consumer re-render
             · làm state manager toàn cục   → nó không phải store
```

```text
Điểm quan trọng: mọi consumer render lại khi giá trị context ĐỔI THAM CHIẾU.

  <Ctx.Provider value={{ user, setUser }}>   ← object MỚI mỗi render
  → mọi consumer render lại mỗi lần cha render, dù user không đổi

Cách xử lý: tách context theo TẦN SUẤT THAY ĐỔI,
và tách riêng context "state" với context "hàm cập nhật".
```

Composition (truyền `children`) thường giải quyết prop drilling mà không cần context. Xem [Context & memoization](../behavior/07-context-memoization.md).

## `useEffect` — đồng bộ với thế giới ngoài React

Đây là hook bị dùng sai nhiều nhất, nên định nghĩa cần chính xác:

```text
`useEffect` KHÔNG phải "chạy code sau khi render".
Nó là: ĐỒNG BỘ component với một HỆ THỐNG NGOÀI React.

  hệ thống ngoài = DOM API · WebSocket · timer · thư viện không phải React
                   · subscription · analytics · trình duyệt
```

```tsx
useEffect(() => {
  const conn = connect(roomId);      // thiết lập
  return () => conn.disconnect();    // ← DỌN DẸP, không phải tuỳ chọn
}, [roomId]);                        // ← chạy lại khi roomId đổi
```

```text
KHÔNG dùng useEffect cho:
  ✗ derived state          → tính trong render
  ✗ phản ứng với sự kiện người dùng → làm trong event handler
  ✗ khởi tạo state         → dùng initializer của useState
  ✗ fetch dữ liệu server   → dùng thư viện server-state (dedupe, cache, race)
  ✗ reset state khi props đổi → dùng `key`
```

```text
Ba lỗi kinh điển:

① THIẾU CLEANUP
   effect chạy lại mà không dọn cái cũ → hai kết nối, hai listener, rò rỉ

② DEPENDENCY LÀ OBJECT/HÀM TẠO MỚI MỖI RENDER
   → effect chạy mỗi render → vòng lặp vô hạn

③ CHẶN EFFECT BẰNG REF ĐỂ "CHẠY MỘT LẦN"
   → đang vá triệu chứng của StrictMode; sửa cleanup mới đúng
```

StrictMode chạy effect **mount → unmount → mount** ở development có chủ đích: nếu effect có cleanup đúng, chạy hai lần vô hại. Xem [Effects & lifecycle](../behavior/02-effects-lifecycle.md).

## Cây quyết định

```text
Tôi cần nhớ một giá trị.
├── UI có phụ thuộc nó không?
│   ├── CÓ  → nó có TÍNH ĐƯỢC từ thứ khác không?
│   │        ├── CÓ  → đừng lưu, tính trong render
│   │        └── KHÔNG → có ràng buộc với mảnh state khác không?
│   │                    ├── CÓ → useReducer
│   │                    └── KHÔNG → useState
│   └── KHÔNG → useRef
│
Tôi cần chạm thứ ngoài React (DOM, socket, timer, thư viện)
└── useEffect + cleanup

Tôi cần giá trị từ tổ tiên xa
└── truyền prop được không? → được thì truyền prop; không thì useContext
```

## Example

Một component dùng cả năm, mỗi hook đúng vai trò:

```tsx
function ChatRoom({ roomId }: { roomId: string }) {
  const theme = useContext(ThemeContext);              // ① từ tổ tiên
  const [draft, setDraft] = useState('');              // ② UI phụ thuộc
  const [state, dispatch] = useReducer(chatReducer,    // ③ nhiều mảnh ràng buộc
    { status: 'connecting', messages: [] });
  const listRef = useRef<HTMLDivElement>(null);        // ④ DOM, không render

  // ⑤ đồng bộ với WebSocket — hệ thống NGOÀI React
  useEffect(() => {
    const conn = connect(roomId);
    conn.on('open',    () => dispatch({ type: 'connected' }));
    conn.on('message', (m) => dispatch({ type: 'received', message: m }));
    return () => conn.disconnect();                    // dọn dẹp bắt buộc
  }, [roomId]);

  // ⑥ derived — KHÔNG phải state, không phải effect
  const unread = state.messages.filter(m => !m.read).length;

  function handleSend() {
    if (!draft.trim() || state.status !== 'connected') return;
    send(roomId, draft);                               // ⑦ tác dụng phụ ở HANDLER
    setDraft('');
    listRef.current?.scrollTo({ top: 0 });             // ⑧ chạm DOM ở handler
  }

  return (/* ... */);
}
```

```text
Đọc lại các quyết định:

② `draft` là useState vì ô nhập phải hiển thị nó.
③ `status` và `messages` đi cùng nhau — "connecting mà có messages" là sai.
④ `listRef` không gây render: cuộn không phải trạng thái UI.
⑥ `unread` tính lại mỗi render — rẻ, luôn đúng, không cần đồng bộ.
⑦ Gửi tin là phản ứng với SỰ KIỆN NGƯỜI DÙNG → handler, không phải effect.
```

Nếu `unread` được lưu bằng `useState` + `useEffect`, sẽ có một nhịp mà số đếm sai — đó là dạng bug ở đầu note.

## Prediction

1. `fullName` tính từ `first` và `last`, lưu bằng `useState` + `useEffect` — có bao nhiêu lần render mỗi khi tên đổi?
2. Tính thẳng trong render — bao nhiêu lần?
3. Gọi `setState` ba lần trong một event handler — bao nhiêu lần render?
4. `setCount(count + 1)` hai lần liên tiếp trong một handler — count tăng mấy?
5. `setCount(c => c + 1)` hai lần — tăng mấy?
6. Lưu timer id bằng `useState` — chuyện gì xảy ra mỗi lần đặt timer?
7. `useEffect` không có cleanup, dependency đổi 5 lần — bao nhiêu kết nối mở?
8. Dependency là object literal tạo trong render — effect chạy khi nào?
9. `<Ctx.Provider value={{ user }}>` với object literal, cha render lại — consumer thế nào?
10. Đọc `ref.current` trong lúc render — vấn đề gì?
11. Fetch dữ liệu bằng `useEffect` thủ công, người dùng đổi filter nhanh — rủi ro gì?
12. Reset state khi prop `userId` đổi bằng `useEffect` — có cách nào tốt hơn?

<details>
<summary>Đáp án</summary>

1. **Hai** — một cho tên đổi, một cho `setFullName`; và có một nhịp hiển thị giá trị cũ.
2. **Một.**
3. **Một** — batching gộp lại.
4. **Một** — cả hai đọc cùng giá trị `count` đã đóng băng.
5. **Hai** — dạng hàm nhận giá trị mới nhất.
6. **Render thừa mỗi lần** — UI không phụ thuộc timer id.
7. **Năm** — không có gì đóng kết nối cũ.
8. **Mỗi render** — tham chiếu mới mỗi lần → thường thành vòng lặp vô hạn.
9. **Render lại tất cả**, dù `user` không đổi.
10. Phá tính thuần của render; giá trị đọc được không đáng tin khi concurrent rendering.
11. **Race condition** — phản hồi cũ về sau ghi đè phản hồi mới.
12. **Dùng `key`** — đổi key làm React tạo instance mới, state tự reset.
</details>

## What Usually Goes Wrong

- **`useState` + `useEffect` cho derived state** → render thừa và một nhịp UI sai.
- **`useEffect` cho phản ứng với sự kiện người dùng** → logic nằm sai chỗ, khó suy luận.
- **Thiếu cleanup** → rò rỉ kết nối, listener, timer.
- **Object/hàm làm dependency** → vòng lặp vô hạn.
- **Dùng ref để chặn effect chạy hai lần** thay vì sửa cleanup.
- **`useState` cho giá trị UI không dùng tới** → render thừa.
- **Đọc `ref.current` trong render.**
- **Context với `value` là object literal** → mọi consumer re-render.
- **Context làm state manager** cho dữ liệu đổi liên tục.
- **Fetch thủ công bằng `useEffect`** → tự viết lại dedupe, cache, chống race.
- **`setX(x + 1)` khi cần dạng hàm.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `useEffect` là "chạy sau render" | Nó là **đồng bộ với hệ thống ngoài React** |
| Mọi thứ cần đồng bộ đều dùng effect | Derived state tính trong render |
| Cleanup là tuỳ chọn | Thiếu nó là rò rỉ |
| Effect chạy hai lần là bug | Đó là StrictMode ở development |
| `useRef` chỉ dùng cho DOM | Nó là ô nhớ không gây render |
| `useContext` là state manager | Nó là cơ chế truyền giá trị |
| `useReducer` luôn tốt hơn nhiều `useState` | Chỉ khi các mảnh **ràng buộc** nhau |
| `setState` cập nhật biến ngay | Giá trị bị đóng băng trong render đó |
| Nhiều `setState` = nhiều render | Chúng được gộp |

## Explain Without Notes

1. Cây quyết định: cần nhớ một giá trị — chọn hook nào và dựa vào câu hỏi nào?
2. Định nghĩa chính xác của `useEffect`, và năm việc **không** dùng nó.
3. Ranh giới một câu giữa `useState` và `useRef`.
4. Vì sao derived state bằng effect gây một nhịp UI sai?
5. `setX(x+1)` và `setX(c => c+1)` khác nhau khi nào?
6. Vì sao context với `value` là object literal làm mọi consumer re-render?
7. Ba lỗi kinh điển của `useEffect`.
8. Câu hỏi phân biệt `useState` và `useReducer`.

## Related

- [Component & rendering model](01-components-and-rendering-model.md) — state sống ở đâu
- [Hooks advanced map](03-hooks-advanced-map.md) — 13 hook còn lại
- [State & render](../behavior/01-state-render.md) — snapshot, batching
- [Effects & lifecycle](../behavior/02-effects-lifecycle.md) — dependency, cleanup, StrictMode
- [useReducer & state machine](../behavior/14-usereducer-state-machines.md)
- [Context & memoization](../behavior/07-context-memoization.md)
- [Refs & uncontrolled](../behavior/08-refs-uncontrolled.md)
- [Async race condition](../behavior/03-async-race-condition.md) — vì sao fetch thủ công khó
- [Server state & cache](../behavior/04-server-state-cache.md) — thay cho fetch trong effect

## Version / Context

React 19.2. `useEffectEvent` (ổn định từ 19.2) giải quyết trường hợp effect cần đọc giá trị mới nhất mà không chạy lại — xem [hooks advanced map](03-hooks-advanced-map.md). StrictMode double-invoke chỉ ở development.
