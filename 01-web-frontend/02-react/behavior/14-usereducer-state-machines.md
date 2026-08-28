---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
  - 06-props-composition-state-design.md
related:
  - ../fundamentals/03-hooks-advanced-map.md
  - 07-context-memoization.md
---

# useReducer & state machine

> Một form thanh toán có sáu `useState`: `loading`, `error`, `success`, `data`, `retryCount`, `disabled`. Trong production xuất hiện một trạng thái không ai thiết kế: `loading === true` **và** `success === true` cùng lúc, nút bấm được, spinner vẫn quay. Người dùng bấm tiếp và bị tính tiền hai lần. Sáu boolean độc lập cho phép 64 tổ hợp; **chỉ 4 trong số đó là hợp lệ, và không có gì trong code ngăn 60 tổ hợp còn lại xảy ra.**

## Position

```text
useState      nhiều mảnh state ĐỘC LẬP
useReducer    MỘT state + các CHUYỂN TRẠNG THÁI hợp lệ
                ↑ khi các mảnh state ràng buộc lẫn nhau
```

## Problem

```text
`useState` không có cách nào diễn đạt: "hai giá trị này không được cùng đúng".

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  → 2 × N × M tổ hợp, phần lớn vô nghĩa
  → mỗi handler phải nhớ cập nhật ĐỦ cả ba
  → quên một cái = trạng thái không hợp lệ, và nó IM LẶNG
```

```text
Vấn đề không phải "nhiều useState quá".
Vấn đề là LOGIC CẬP NHẬT bị phân tán ra khắp các handler,
nên không có chỗ nào định nghĩa "trạng thái hợp lệ là gì".
```

## Mental Model

### Reducer là một hàm thuần: (state, action) → state

```text
useState:    bạn nói KẾT QUẢ    → setState(newValue)
useReducer:  bạn nói SỰ KIỆN    → dispatch({ type: 'submitted' })
             reducer quyết định kết quả

⇒ logic chuyển trạng thái nằm ở MỘT CHỖ, tách khỏi component.
⇒ và vì reducer là hàm thuần, nó test được mà không cần render.
```

```tsx
type State = { status: 'idle' } | { status: 'loading' } | ...;
type Action = { type: 'submitted' } | { type: 'succeeded'; data: Result } | ...;

function reducer(state: State, action: Action): State { /* ... */ }

const [state, dispatch] = useReducer(reducer, { status: 'idle' });
```

### Discriminated union: làm trạng thái sai KHÔNG BIỂU DIỄN ĐƯỢC

Đây là phần quan trọng hơn cả `useReducer` — nó là thay đổi về **mô hình hoá**, không phải về API.

```ts
// ✗ 64 tổ hợp, 4 hợp lệ
type Bad = {
  loading: boolean; error: string | null; success: boolean; data: Result | null;
};

// ✓ đúng 4 trạng thái, và TypeScript ép bạn xử lý đủ
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Result }
  | { status: 'error'; message: string; retryCount: number };
```

```text
Lợi ích trực tiếp:
  · `data` chỉ tồn tại khi status === 'success' → không cần kiểm tra null
  · `retryCount` chỉ tồn tại ở nhánh error → không có biến "treo" vô nghĩa
  · TypeScript báo lỗi nếu bạn quên một nhánh trong switch
  · trạng thái "loading và success cùng lúc" KHÔNG VIẾT RA ĐƯỢC
```

Bạn dùng được discriminated union với `useState` luôn. Nhưng khi đã có nhiều **chuyển trạng thái**, `useReducer` là nơi tự nhiên để đặt chúng.

### Reducer phải THUẦN

```text
Reducer chỉ được: đọc state + action, trả về state MỚI.

✗ KHÔNG được trong reducer:
  gọi API · setTimeout · đọc/ghi localStorage · Math.random() · Date.now()
  · mutate state cũ

Vì sao: StrictMode gọi reducer HAI LẦN ở development để phát hiện
điều này. Reducer không thuần sẽ cho kết quả khác nhau giữa hai lần.
```

```text
Tác dụng phụ đi ở đâu:
  · trong event handler (trước hoặc sau khi dispatch)
  · trong useEffect phản ứng với sự thay đổi của state
```

### Khi nào dùng useReducer

```text
✓ DÙNG khi
  · nhiều mảnh state RÀNG BUỘC lẫn nhau
  · state tiếp theo phụ thuộc state trước theo quy tắc rõ ràng
  · cùng một logic cập nhật gọi từ NHIỀU nơi
  · muốn test logic mà không render
  · muốn log được mọi chuyển trạng thái (debug)

✗ KHÔNG dùng khi
  · một hai giá trị độc lập (`isOpen`, `query`) → useState đơn giản hơn
  · state thật ra là DERIVED → tính trong render, đừng lưu
  · state là dữ liệu SERVER → dùng thư viện server-state
  · chỉ để "trông chuyên nghiệp" → reducer 5 dòng cho 1 boolean là thừa
```

Câu hỏi phân biệt: **"có tổ hợp state nào không được phép xảy ra không?"** Nếu có, reducer đáng giá. Nếu không, `useState` thắng vì ít code hơn.

### Reducer không thay thế context, và ngược lại

```text
useReducer   giải quyết ĐỘ PHỨC TẠP của logic cập nhật
context      giải quyết KHOẢNG CÁCH truyền dữ liệu xuống sâu

Chúng thường đi cùng nhau nhưng là hai vấn đề khác nhau:
  reducer + context = một store nhỏ trong React
  → tách hai context: STATE và DISPATCH
  → `dispatch` ổn định theo tham chiếu → consumer chỉ nghe dispatch không re-render
```

Xem [Context & memoization](07-context-memoization.md).

## How It Works

### Chuyển trạng thái tường minh

```ts
type State =
  | { status: 'idle' }
  | { status: 'loading'; attempt: number }
  | { status: 'success'; data: Result }
  | { status: 'error'; message: string; attempt: number };

type Action =
  | { type: 'submitted' }
  | { type: 'succeeded'; data: Result }
  | { type: 'failed'; message: string }
  | { type: 'retried' }
  | { type: 'reset' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'submitted':
      // CHỈ đi được từ idle hoặc error → double-submit bị chặn Ở ĐÂY
      if (state.status === 'loading') return state;
      return { status: 'loading', attempt: 1 };

    case 'succeeded':
      if (state.status !== 'loading') return state;   // bỏ qua phản hồi lạc
      return { status: 'success', data: action.data };

    case 'failed':
      if (state.status !== 'loading') return state;
      return { status: 'error', message: action.message, attempt: state.attempt };

    case 'retried':
      if (state.status !== 'error') return state;
      return { status: 'loading', attempt: state.attempt + 1 };

    case 'reset':
      return { status: 'idle' };
  }
}
```

```text
Hai dòng đáng chú ý:

`if (state.status === 'loading') return state;` ở 'submitted'
  → double-submit bị chặn bởi MÔ HÌNH, không bởi một cờ `disabled` riêng
  → và nó đúng kể cả khi có ba nút cùng dispatch

`if (state.status !== 'loading') return state;` ở 'succeeded'
  → phản hồi tới sau khi người dùng đã reset bị BỎ QUA
  → đây là một dạng chống race condition ở tầng state
```

### Trả về `state` nguyên vẹn nghĩa là không render

React so kết quả reducer bằng `Object.is`. Trả về đúng object cũ → không có render lại. Đó là lý do các nhánh "bỏ qua" ở trên rẻ.

### `useReducer` với lazy init

```tsx
// tránh chạy hàm khởi tạo nặng ở MỌI render
const [state, dispatch] = useReducer(reducer, initialProp, init);
//                                            ↑ arg      ↑ init(arg) chạy 1 lần
```

## Example

Form thanh toán ở đầu note, viết lại:

```tsx
function CheckoutForm({ cartId }: { cartId: string }) {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatch({ type: 'submitted' });          // ① tác dụng phụ NGOÀI reducer

    try {
      const data = await pay(cartId, { idempotencyKey: keyFor(cartId) });
      dispatch({ type: 'succeeded', data });
    } catch (err) {
      dispatch({ type: 'failed', message: toMessage(err) });
    }
  }

  // ② render là một hàm thuần của state — không có tổ hợp nào bị bỏ sót
  return (
    <form onSubmit={handleSubmit}>
      {state.status === 'error' && (
        <p role="alert">
          {state.message}
          <button type="button" onClick={() => dispatch({ type: 'retried' })}>
            Thử lại (lần {state.attempt + 1})
          </button>
        </p>
      )}

      {state.status === 'success'
        ? <OrderConfirmation data={state.data} />
        : <button disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Đang xử lý…' : 'Thanh toán'}
          </button>}
    </form>
  );
}
```

```text
Ba thứ biến mất so với phiên bản sáu useState:
  · không còn cờ `disabled` riêng — nó suy ra từ status
  · không còn `if (loading && success)` để phòng trạng thái không hợp lệ
  · không còn khả năng quên cập nhật một trong sáu biến
```

Và reducer test được mà không cần render gì:

```ts
it('bỏ qua submit thứ hai khi đang loading', () => {
  const s1 = reducer({ status: 'idle' }, { type: 'submitted' });
  const s2 = reducer(s1, { type: 'submitted' });
  expect(s2).toBe(s1);                        // cùng tham chiếu → không render
});

it('bỏ qua phản hồi tới sau khi đã reset', () => {
  const loading = reducer({ status: 'idle' }, { type: 'submitted' });
  const idle = reducer(loading, { type: 'reset' });
  const after = reducer(idle, { type: 'succeeded', data: fake });
  expect(after.status).toBe('idle');          // phản hồi lạc bị bỏ
});
```

Hai test này chạy trong mili-giây và mô tả đúng hai bug đã xảy ra ở production.

## Prediction

1. Sáu boolean độc lập — bao nhiêu tổ hợp? Bao nhiêu hợp lệ?
2. Discriminated union bốn trạng thái — bao nhiêu tổ hợp biểu diễn được?
3. `data` khai báo trong nhánh `success` — có cần kiểm tra `null` khi dùng không?
4. Thiếu một `case` trong switch với union đã khai báo — TypeScript nói gì?
5. Reducer gọi `fetch` bên trong — StrictMode ở dev làm gì?
6. Reducer trả về đúng object `state` cũ — React có render lại không?
7. Người dùng bấm submit hai lần rất nhanh, reducer chặn ở nhánh `'submitted'` — có gọi API hai lần không?
8. Phản hồi API tới sau khi người dùng đã bấm reset — state thành gì?
9. `dispatch` có ổn định theo tham chiếu giữa các render không?
10. Một `useState` cho `isOpen` — nên chuyển sang reducer không?
11. Test reducer — có cần render component không?
12. State thực ra tính được từ props — reducer có giúp gì không?

<details>
<summary>Đáp án</summary>

1. **64 tổ hợp**, khoảng **4** hợp lệ.
2. **Đúng 4** — trạng thái sai không viết ra được.
3. **Không** — TypeScript biết `data` tồn tại trong nhánh đó.
4. Nó **báo lỗi** nếu hàm có kiểu trả về tường minh (exhaustiveness check).
5. Gọi reducer **hai lần** → API bị gọi hai lần → lộ ra ngay ở dev.
6. **Không** — `Object.is` trả `true`.
7. **Không** — lần thứ hai reducer trả về state cũ; nhưng lưu ý tác dụng phụ nằm ở handler, nên vẫn nên kiểm tra status trước khi gọi API.
8. **`idle`** — nhánh `'succeeded'` bỏ qua vì status không phải `loading`.
9. **Có** — React đảm bảo `dispatch` ổn định.
10. **Không** — một boolean độc lập thì `useState` đơn giản hơn.
11. **Không** — nó là hàm thuần.
12. **Không** — derived state không nên lưu ở đâu cả.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đếm số tổ hợp state trong form hiện tại của bạn | Bao nhiêu hợp lệ? |
| Cố viết ra trạng thái `loading + success` với union | Có viết được không? |
| Xoá một `case` khỏi switch | TypeScript báo gì? |
| Gọi `Math.random()` trong reducer, chạy StrictMode | Kết quả có ổn định không? |
| Mutate `state` trong reducer rồi trả về nó | UI có cập nhật không? |
| Dispatch cùng action hai lần liên tiếp | Có render hai lần không? |
| Cho API trả về sau khi component đã reset | State cuối là gì? |
| Chuyển một `useState` boolean đơn lẻ sang reducer | Code dài thêm bao nhiêu? Có lợi gì không? |

## What Usually Goes Wrong

- **Nhiều boolean độc lập** cho một quy trình có trạng thái.
- **Không dùng discriminated union** → vẫn phải kiểm tra `null` khắp nơi.
- **Tác dụng phụ trong reducer** → StrictMode phơi bày, và logic không test được.
- **Mutate state trong reducer** → không render lại.
- **Dùng reducer cho state đơn giản** → code dài hơn, không lợi gì.
- **Dùng reducer cho server state** → viết lại một thư viện cache kém hơn.
- **Không chặn chuyển trạng thái không hợp lệ** → reducer chỉ là `setState` viết vòng.
- **Một context chứa cả state và dispatch** → mọi consumer re-render khi state đổi.
- **Không test reducer** dù nó là phần dễ test nhất trong toàn bộ component.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `useReducer` là để thay Redux | Nó là state cục bộ của component |
| Nhiều state thì phải dùng reducer | Chỉ khi chúng **ràng buộc** lẫn nhau |
| Reducer làm code sạch hơn tự động | Reducer cho state đơn giản làm code dài hơn |
| `dispatch` gây re-render như `setState` | Có, nhưng trả về state cũ thì không |
| Reducer có thể gọi API | Nó phải thuần |
| Union type là chi tiết TypeScript | Nó là thứ làm trạng thái sai không tồn tại |
| Reducer thay được server-state library | Nó không có cache, dedupe, revalidate |
| Phải dùng context cùng reducer | Hai vấn đề khác nhau |

## Debugging

1. **UI ở trạng thái không thể xảy ra** → đếm tổ hợp state; đó là dấu hiệu cần union.
2. **Log mọi chuyển trạng thái** — bọc reducer một lớp:
   `(s, a) => { const n = reducer(s, a); console.log(a.type, s.status, '→', n.status); return n; }`
   Đây là lợi thế lớn của reducer: mọi thay đổi đi qua **một** chỗ.
3. **UI không cập nhật** → reducer có trả về object mới không, hay đang mutate?
4. **Hành vi khác giữa dev và production** → reducer không thuần; StrictMode đang phơi bày.
5. **Trạng thái nhảy lùi** → phản hồi bất đồng bộ lạc; thêm điều kiện kiểm tra status trong reducer.
6. **Test reducer trước khi debug component** — nó là hàm thuần, tái lập được 100%.

## Explain Without Notes

1. Vì sao sáu boolean độc lập là vấn đề? Đưa con số.
2. Discriminated union làm gì mà nhiều `useState` không làm được?
3. Reducer nhận gì, trả gì, và phải có tính chất gì?
4. Ba thứ không được làm trong reducer, và vì sao StrictMode phát hiện được?
5. Câu hỏi một dòng để quyết định dùng `useState` hay `useReducer`?
6. Reducer chống double-submit và phản hồi lạc bằng cơ chế nào?
7. `useReducer` và context giải quyết hai vấn đề khác nhau nào?
8. Vì sao reducer là phần dễ test nhất của một component?

## Related

- [React foundations](../fundamentals/01-components-and-rendering-model.md) — state sống ở đâu
- [State & render](01-state-render.md) — state là snapshot
- [Props, composition & state design](06-props-composition-state-design.md) — state nên ở đâu
- [Context & memoization](07-context-memoization.md) — tách context state và dispatch
- [Async race condition](03-async-race-condition.md) — phản hồi lạc
- [Server state & cache](04-server-state-cache.md) — khi state là dữ liệu server
- [Hooks reference map](../fundamentals/03-hooks-advanced-map.md) — vị trí của `useReducer` trong bộ hook
- [Forms](10-forms.md) — double-submit ở tầng form
- [Idempotency & retry](../../../06-system-design/03-idempotency-retry.md) — chống tính tiền hai lần ở tầng server

## Version / Context

React 19.2. `useReducer` ổn định từ React 16.8. StrictMode gọi reducer hai lần ở development để phát hiện hàm không thuần. Exhaustiveness check trong `switch` cần TypeScript và kiểu trả về tường minh trên hàm reducer. Với state của form, `useActionState` (React 19) là lựa chọn thay thế khi state gắn với một Server Action.
