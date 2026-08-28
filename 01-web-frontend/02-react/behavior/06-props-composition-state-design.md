---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
related:
  - 07-context-memoization.md
  - 11-custom-hooks.md
---

# Props, composition & state design

> Phần lớn "code React khó bảo trì" không phải vấn đề về hook. Nó là vấn đề về **state đặt sai chỗ** và **abstraction sai hình dạng**.

## Position

```text
Cây component: state ở đâu? → ai render lại? → prop truyền qua mấy tầng?
```

## Problem

Ba triệu chứng, cùng một nguyên nhân là thiết kế state:

```tsx
// 1. Prop drilling: truyền qua 5 tầng cho một component ở lá
<App user={user}>
  <Layout user={user}>
    <Sidebar user={user}>
      <Menu user={user}>
        <Avatar user={user} />

// 2. Derived state lưu trong state → có thể lệch nhau
const [items, setItems] = useState<Item[]>([]);
const [count, setCount] = useState(0);
const [hasItems, setHasItems] = useState(false);   // ba nguồn cho một sự thật

// 3. State ở quá cao → gõ một chữ, cả trang render
function App() {
  const [searchText, setSearchText] = useState('');   // chỉ SearchBox cần
  // ...200 component con render mỗi lần gõ
}
```

## Mental Model

Ba câu hỏi, theo thứ tự:

### 1. Đây có thật là state không?

```text
Tính được từ props/state khác?     → KHÔNG phải state. Tính trong render.
Không thay đổi?                    → KHÔNG phải state. Là hằng số.
Không dùng để render?               → KHÔNG phải state. Dùng ref.
Server sở hữu?                      → server state. Xem note 04.
```

Câu hỏi này loại bỏ phần lớn state không cần thiết:

```ts
// ❌ 3 state, có thể lệch nhau
const [items, setItems] = useState<Item[]>([]);
const [count, setCount] = useState(0);
const [hasItems, setHasItems] = useState(false);

// ✅ 1 state, 2 giá trị dẫn xuất — không thể lệch
const [items, setItems] = useState<Item[]>([]);
const count = items.length;
const hasItems = items.length > 0;
```

Nguyên tắc: **mỗi sự thật chỉ có một nguồn.** Hai state phải đồng bộ với nhau là một bug đang chờ.

### 2. State này nên ở đâu?

```text
Đặt state ở component THẤP NHẤT mà vẫn dùng được cho mọi nơi cần nó.
```

- Chỉ một component dùng → đặt trong component đó (**colocation**).
- Nhiều sibling dùng → đưa lên parent gần nhất (**lifting**).
- Rất nhiều nơi ở nhiều tầng dùng → context hoặc store.

Đặt quá cao là lỗi phổ biến hơn đặt quá thấp: nó làm render lan rộng và làm component không tái dùng được.

### 3. Có thể mô hình hoá để state sai không biểu diễn được?

```ts
// ❌ 8 tổ hợp, 5 vô nghĩa
{ loading: boolean; data?: T; error?: string }

// ✅ 4 tổ hợp, tất cả hợp lệ
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };
```

Xem [TypeScript type system](../../01-javascript-typescript/typescript/02-type-system.md).

## How It Works

### Composition thay vì prop drilling

Prop drilling thường là dấu hiệu **cấu trúc component sai**, không phải dấu hiệu cần context.

```tsx
// ❌ Truyền user qua 4 tầng chỉ để tới Avatar
<Layout user={user} />

// ✅ Truyền chính component đã có dữ liệu
<Layout sidebar={<Menu avatar={<Avatar user={user} />} />} />
```

Kỹ thuật này (`children` hoặc prop nhận ReactNode) là câu trả lời cho phần lớn prop drilling, và nó **không thêm khái niệm mới** như context.

```tsx
// Component "trong suốt" — không cần biết mình bọc gì
function Card({ header, children }: { header: ReactNode; children: ReactNode }) {
  return <div className="card"><div className="hd">{header}</div>{children}</div>;
}
```

Lợi ích phụ quan trọng: `children` được tạo ở **parent**, nên khi `Card` render lại, `children` **không** render lại (cùng element reference). Composition tự nhiên tránh render không cần thiết.

### Thiết kế props

```tsx
// ❌ Boolean explosion — 2^4 = 16 tổ hợp, phần lớn vô nghĩa
<Button primary secondary large disabled />

// ✅ Union — chỉ tổ hợp hợp lệ
<Button variant="primary" size="lg" disabled />

// ❌ Prop cho mọi khả năng — component biết quá nhiều
<Table data={d} showHeader showFooter headerColor="red" onRowClick={...} rowHeight={40} ... />

// ✅ Compound component — người dùng tự lắp
<Table data={d}>
  <Table.Header />
  <Table.Row onClick={...} />
</Table>
```

### Controlled vs uncontrolled

```tsx
// Uncontrolled: component tự giữ state
<Input defaultValue="a" />

// Controlled: parent giữ state
<Input value={v} onChange={setV} />

// Cả hai (như thư viện UI thật làm)
function Input({ value, defaultValue, onChange }: Props) {
  const [internal, setInternal] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const handle = (v: string) => {
    if (!isControlled) setInternal(v);
    onChange?.(v);
  };
  // ...
}
```

Mặc định nên là **uncontrolled**: đơn giản hơn và không gây render ở parent với mỗi ký tự. Chỉ controlled khi parent thật sự cần giá trị ở mỗi thay đổi (validate live, sync với component khác).

### Khi nào cần context / store

```text
useState colocated       → mặc định
lifting lên parent       → khi sibling cần chia sẻ
composition (children)   → khi chỉ là vấn đề "truyền qua nhiều tầng"
Context                  → dữ liệu ÍT ĐỔI, nhiều nơi cần (theme, locale, user)
Store (Zustand/Redux)    → client state phức tạp, cập nhật thường xuyên, cần selector
Server state library     → mọi dữ liệu từ API
```

Context cho dữ liệu **đổi thường xuyên** là bẫy hiệu năng: mọi consumer render khi value đổi. Xem [Context & memoization](07-context-memoization.md).

## Example

```tsx
// Trước: state quá cao → gõ một chữ, cả trang render
function Page() {
  const [q, setQ] = useState('');
  return (
    <>
      <input value={q} onChange={e => setQ(e.target.value)} />
      <HeavyChart />          {/* render mỗi ký tự */}
      <Results query={q} />
    </>
  );
}

// Sau: colocate state vào component nhỏ nhất cần nó
function Page() {
  return (
    <>
      <SearchAndResults />
      <HeavyChart />          {/* không render khi gõ */}
    </>
  );
}

function SearchAndResults() {
  const [q, setQ] = useState('');
  return (
    <>
      <input value={q} onChange={e => setQ(e.target.value)} />
      <Results query={q} />
    </>
  );
}
```

Đây là cách tối ưu hiệu năng **không cần `memo`**: thu hẹp phạm vi state. Nó luôn nên thử trước khi thêm memoization.

## Prediction

1. State `searchText` ở `App`, có 200 component con — gõ một ký tự, bao nhiêu component render?
2. Sau khi colocate vào `SearchBox` — bao nhiêu?
3. `count` lưu trong state riêng, đồng bộ với `items` bằng effect — khi nào chúng lệch nhau?
4. `<Card>{expensiveChild}</Card>`, `Card` render lại vì state nội bộ của nó — `expensiveChild` có render lại?
5. Component uncontrolled với `value` truyền vào nhưng không có `onChange` — người dùng gõ được không?
6. Context với value là `{ user, setUser }` object literal — bao nhiêu consumer render khi parent render?

<details>
<summary>Đáp án chọn lọc</summary>

3. Bất cứ khi nào ai đó sửa `items` mà không qua đường có effect đó — ví dụ một `setItems` khác, hoặc effect chưa chạy kịp.
4. Không — `children` là element được tạo ở parent, reference không đổi.
5. Không — React coi là controlled input với giá trị cố định; console cảnh báo.
6. Tất cả — object literal là reference mới mỗi render.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt state input ở root với 100 component con | Bật "Highlight updates" trong DevTools — cả trang nháy mỗi ký tự |
| Colocate lại | Chỉ vùng nhỏ nháy |
| Giữ `count` và `items` riêng, cập nhật `items` ở 2 chỗ | Chúng lệch nhau |
| Truyền `value` mà không `onChange` | Input "đóng băng", có cảnh báo |
| Context value là object literal | Mọi consumer render mỗi lần parent render |
| Prop drilling 6 tầng rồi đổi tên field | Phải sửa 6 file cho một thay đổi |
| Component có 15 boolean prop | Đếm số tổ hợp; thử tạo tổ hợp vô nghĩa |
| Bọc `{children}` vs gọi `<Child />` trực tiếp, đo với Profiler | Thấy khác biệt về render |

## What Usually Goes Wrong

- **Derived state lưu trong state** → hai nguồn sự thật, lệch nhau.
- **State quá cao** → render lan rộng, component không tái dùng.
- **Dùng context để sửa prop drilling** khi composition đủ → thêm khái niệm không cần thiết, và tạo vấn đề render mới.
- **Boolean explosion** trong props.
- **Component biết quá nhiều** — 20 prop điều khiển mọi khả năng thay vì cho phép lắp ghép.
- **Copy props vào state** (`useState(props.value)`) → không cập nhật khi props đổi. Dùng `key` để reset thay vì effect.
- **Trộn server state vào client store** → tự viết lại cache.
- **Abstraction quá sớm** — tạo component chung sau khi thấy *hai* trường hợp; thường sai. Đợi ba.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Prop drilling luôn xấu | 2–3 tầng thường rõ ràng hơn context |
| Context giải quyết mọi chia sẻ state | Nó gây render cho mọi consumer; không có selector |
| State ở cao thì dễ quản | Gây render lan rộng và giảm tái dùng |
| Nhiều prop = component linh hoạt | Thường là component làm quá nhiều việc |
| Controlled tốt hơn uncontrolled | Controlled gây render mỗi ký tự; chỉ dùng khi cần |
| `useMemo` là cách sửa render nhiều | Thu hẹp phạm vi state hiệu quả hơn và đơn giản hơn |
| Nên tách component càng nhỏ càng tốt | Tách theo *ranh giới thay đổi*, không theo số dòng |

## Debugging

1. **Render lan rộng** → React DevTools → bật "Highlight updates when components render". Xem trực quan phạm vi. Đây là công cụ chẩn đoán nhanh nhất cho vấn đề thiết kế state.
2. **State lệch nhau** → tìm nơi nào có hai state phải đồng bộ. Xoá một cái, tính từ cái còn lại.
3. **Prop drilling sâu** → hỏi "component trung gian có *dùng* prop này không?" Nếu không, dùng composition.
4. Profiler → "Why did this render?" → nếu là "parent rendered" và props không đổi thì đây là vấn đề cấu trúc, không phải vấn đề memo.
5. Đếm số prop; > 8 là dấu hiệu component nên tách hoặc dùng compound pattern.

## Production Considerations

- **Colocate là mặc định.** Chỉ lift khi có nhu cầu thật.
- **Tách server state ra khỏi client state** hoàn toàn — hai loại, hai công cụ.
- **Thiết kế state bằng union type** cho mọi thứ có nhiều trạng thái.
- **Composition trước context, context trước store.** Mỗi bước thêm phức tạp; chỉ đi tiếp khi bước trước không đủ.
- Đợi đến trường hợp thứ ba mới tạo abstraction chung. Hai trường hợp không đủ dữ liệu để biết cái gì thật sự chung.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Colocate state | render hẹp, tái dùng tốt | phải lift khi cần chia sẻ |
| Lift state | chia sẻ dễ | render rộng hơn |
| Composition | không thêm khái niệm, tránh render | JSX ở parent phức tạp hơn |
| Context | không drilling | mọi consumer render; cần chia nhỏ context |
| Store với selector | render chính xác | thêm thư viện và khái niệm |
| Compound component | linh hoạt cao | API khó học hơn |

## Explain Without Notes

1. Ba câu hỏi để quyết định một giá trị có phải state và nên ở đâu?
2. Vì sao derived state trong state là bug đang chờ?
3. Composition giải quyết prop drilling thế nào, và lợi ích phụ về render là gì?
4. Khi nào dùng controlled, khi nào uncontrolled?
5. Thứ tự leo thang: colocate → ? → ? → ?

## Related

- [State → render](01-state-render.md) — vì sao vị trí state ảnh hưởng render
- [Context & memoization](07-context-memoization.md) — chi phí của context
- [Custom hooks](11-custom-hooks.md) — tái dùng logic thay vì component
- [Refs & uncontrolled](08-refs-uncontrolled.md) — giá trị không dùng để render
- [Type system](../../01-javascript-typescript/typescript/02-type-system.md) — union cho state
- [React performance](12-performance.md)
