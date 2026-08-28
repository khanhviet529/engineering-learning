---
level: foundation
area: frontend
related:
  - ../behavior/01-state-render.md
  - 03-hooks-advanced-map.md
---

# React foundations: từ vựng và mô hình render

> Một người mới đọc note "state là snapshot" và không hiểu gì. Không phải vì note viết khó — mà vì họ chưa có từ để gọi tên những thứ trong đó: *element* khác gì *component*, *render* khác gì *commit*, "React render lại" nghĩa là gì khi DOM không đổi. **Thiếu từ vựng thì không đọc được mental model, và thiếu mental model thì mọi hành vi của React trông như phép thuật.**

## Position

```text
Note này là TỪ ĐIỂN + MÔ HÌNH NỀN.
Đọc trước 01-state-render.md.

  từ vựng (note này)
        ↓
  behavior (01–13)
        ↓
  failure & debugging
```

## Problem

```text
React có một tập từ vựng nhỏ nhưng chính xác, và tài liệu dùng chúng
như thể ai cũng biết:

  "component render lại nhưng DOM không thay đổi"
  "element là mô tả, không phải instance"
  "state được đóng băng trong một render"

Ba câu trên vô nghĩa nếu chưa biết render/commit/element là gì.
Và chúng là điều kiện để hiểu MỌI hành vi khác của React.
```

## Mental Model

### Bốn từ hay bị dùng lẫn lộn

```text
COMPONENT   một HÀM nhận props, trả về element
            function Button(props) { return <button>...</button> }

ELEMENT     một OBJECT mô tả "cái gì nên có trên màn hình"
            { type: Button, props: { label: 'OK' } }
            → rẻ, bất biến, KHÔNG phải DOM node

INSTANCE    trạng thái React giữ cho một vị trí trong cây
            → nơi state và effect thật sự sống

DOM NODE    phần tử thật trong trình duyệt
```

```text
Quan hệ:
  bạn viết COMPONENT
  → React gọi nó, nhận về ELEMENT
  → React so element mới với element cũ
  → React cập nhật DOM NODE nếu cần
  → state sống ở INSTANCE, không ở component function
```

Điểm quyết định: **component function chạy lại nhiều lần; instance thì không được tạo lại**. Đó là lý do state không mất khi component render lại — state không nằm trong hàm.

### JSX chỉ là cú pháp

```tsx
// bạn viết
<Button label="OK" onClick={save}>Lưu</Button>

// trình biên dịch chuyển thành (React 17+, JSX transform mới)
jsx(Button, { label: 'OK', onClick: save, children: 'Lưu' })

// và nó trả về một OBJECT, không phải DOM
// { type: Button, props: { label: 'OK', onClick: save, children: 'Lưu' } }
```

```text
Hệ quả thực tế của "JSX là object":
  · viết <Foo /> KHÔNG gọi Foo — nó chỉ tạo mô tả; React quyết định khi nào gọi
  · truyền <Foo /> làm prop là rẻ (chỉ là object)
  · `children` là một prop bình thường, chỉ có cú pháp đặc biệt
  · điều kiện `{cond && <Foo />}` tạo element hoặc `false` — cả hai đều hợp lệ
```

### Props và children

```text
PROPS       dữ liệu đi TỪ CHA XUỐNG CON, chỉ đọc
            component KHÔNG được sửa props của chính nó

CHILDREN    một prop đặc biệt: nội dung giữa thẻ mở và thẻ đóng
            <Card><p>hi</p></Card>  →  props.children = <p>hi</p>
```

```text
Vì children là prop, nó cho phép COMPOSITION:
  cha quyết định NỘI DUNG, con quyết định BỐ CỤC
  → tránh được prop drilling ở nhiều trường hợp
```

Xem [Props, composition & state design](../behavior/06-props-composition-state-design.md).

### State: bộ nhớ gắn với vị trí

```text
State KHÔNG nằm trong biến của hàm.
Nó nằm trong INSTANCE mà React giữ cho vị trí đó trong cây.

  useState(0) không có nghĩa "gán 0"
  nó có nghĩa "cho tôi ô nhớ thứ N của instance này; nếu chưa có, khởi tạo bằng 0"
```

```text
Hệ quả:
  · React biết ô nhớ nào là ô nào nhờ THỨ TỰ GỌI HOOK
    → đó là lý do có Rules of Hooks (không gọi hook trong if/loop)
  · component ở VỊ TRÍ khác nhau có state khác nhau
  · component bị unmount thì state MẤT
  · đổi `key` = React coi đó là vị trí khác = state bị reset
```

### Render và commit: hai pha khác nhau

```text
① TRIGGER   có gì đó gọi setState (hoặc lần mount đầu)
② RENDER    React GỌI component function
            → nhận element mới
            → so với element cũ (reconciliation)
            → tính ra danh sách thay đổi
            ⚠ pha này KHÔNG chạm DOM
③ COMMIT    React áp thay đổi lên DOM thật
            → rồi chạy layout effect, browser paint, rồi effect
```

```text
"React render lại component" ≠ "DOM thay đổi".
Render là GỌI HÀM để tính toán. Nếu kết quả giống cũ, DOM không đổi.

⇒ đây là lý do "render lại nhiều lần" thường KHÔNG phải vấn đề hiệu năng.
  Vấn đề là render lại LÀM VIỆC NẶNG, hoặc render lại quá NHIỀU cây con.
```

Xem [State & render](../behavior/01-state-render.md) và [Performance](../behavior/12-performance.md).

### Event handler và luồng dữ liệu

```text
Dữ liệu đi XUỐNG bằng props.
Sự kiện đi LÊN bằng callback truyền xuống dưới dạng props.

  <Child onSave={handleSave} />   ← cha đưa hàm xuống
  onClick={() => onSave(value)}   ← con gọi ngược lên

React KHÔNG có luồng dữ liệu hai chiều tự động.
"Two-way binding" trong React là: value đi xuống + onChange đi lên.
```

### Cây component và vị trí

```text
<App>
  └─ <Layout>
       ├─ <Sidebar />
       └─ <Page>
            └─ <List>
                 ├─ <Item key="a" />
                 └─ <Item key="b" />

React nhận diện một component bằng VỊ TRÍ TRONG CÂY + TYPE (+ key nếu có).
  cùng vị trí, cùng type  → giữ instance, giữ state
  khác type               → huỷ instance cũ, tạo mới, MẤT state
  khác key                → coi như phần tử khác, MẤT state
```

Xem [Reconciliation & keys](../behavior/05-reconciliation-keys.md).

## How It Works

### Một vòng đời hoàn chỉnh, theo thứ tự

```text
người dùng bấm nút
  → onClick chạy → setCount(c => c + 1)
  → React ĐÁNH DẤU component cần render (chưa render ngay — batching)
  → hết microtask hiện tại, React bắt đầu RENDER:
       gọi Counter() → nhận element mới
       so sánh với element cũ
  → COMMIT: cập nhật textContent của <span>
  → chạy useLayoutEffect (đồng bộ, trước khi vẽ)
  → trình duyệt VẼ
  → chạy useEffect (bất đồng bộ, sau khi vẽ)
```

```text
Ba điểm hay gây bất ngờ trong chuỗi trên:
  · setState KHÔNG cập nhật biến ngay lập tức (batching)
  · useEffect chạy SAU khi người dùng đã thấy màn hình
  · useLayoutEffect chạy TRƯỚC khi vẽ → chặn vẽ nếu làm việc nặng
```

### Thứ React coi là "thay đổi"

```text
React so props bằng Object.is (gần như ===), KHÔNG so sâu.

  <Item data={{ id: 1 }} />
  → mỗi render tạo object MỚI → prop "đổi" dù nội dung giống
  → đây là lý do memo() thường không có tác dụng như mong đợi
```

```text
Và đây cũng là lý do MUTATE state không hoạt động:
  state.items.push(x)  → vẫn là CÙNG mảng → Object.is trả true → không render
  setItems([...items, x]) → mảng MỚI → React thấy thay đổi
```

### Strict Mode: công cụ phát hiện, không phải lỗi

```text
Trong development, React StrictMode cố tình:
  · gọi component function HAI LẦN
  · chạy effect: mount → unmount → mount lại

Mục đích: phát hiện code KHÔNG thuần và effect KHÔNG có cleanup đúng.
Trong production nó không xảy ra.

⇒ "effect chạy hai lần" là TÍNH NĂNG, không phải bug cần vá bằng ref.
```

Xem [Effects & lifecycle](../behavior/02-effects-lifecycle.md).

## Example

Cùng một component, đọc theo bốn từ vựng:

```tsx
function TodoItem({ todo, onToggle }: { todo: Todo; onToggle: (id: string) => void }) {
  const [editing, setEditing] = useState(false);   // ① state gắn với INSTANCE

  return (                                          // ② trả về ELEMENT (object)
    <li onClick={() => onToggle(todo.id)}>          // ③ sự kiện đi LÊN qua prop
      {editing ? <Input value={todo.text} /> : todo.text}
    </li>
  );
}

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul>
      {todos.map(t => <TodoItem key={t.id} todo={t} onToggle={toggle} />)}
    </ul>                          {/* ④ key xác định DANH TÍNH, không phải thứ tự */}
  );
}
```

```text
Đọc lại bằng từ vựng chính xác:

① `editing` sống ở instance của TodoItem tại vị trí có key = t.id.
   Xoá todo đó khỏi mảng → instance bị huỷ → `editing` mất. Đúng như mong đợi.

② `<li>...</li>` là một object mô tả, không phải thẻ <li> thật.
   React so nó với object của lần render trước.

③ TodoItem không biết "toggle" làm gì. Nó chỉ gọi hàm cha đưa xuống.

④ Nếu dùng key={index} và xoá phần tử đầu, mọi instance bị gán lại
   cho todo khác → `editing` nhảy sang dòng khác.
```

## Prediction

1. `<Button />` trong JSX — nó có gọi hàm `Button` ngay không?
2. Element là DOM node hay object mô tả?
3. State nằm trong biến của component function hay ở đâu?
4. Component render lại — DOM có nhất thiết thay đổi không?
5. Gọi `useState` bên trong `if` — vì sao React cấm?
6. `state.items.push(x)` rồi `setItems(state.items)` — có render lại không?
7. Đổi `key` của một component, giữ nguyên type và vị trí — state thế nào?
8. `useEffect` chạy trước hay sau khi trình duyệt vẽ?
9. `useLayoutEffect` làm việc nặng 200ms — người dùng thấy gì?
10. Effect chạy hai lần ở dev nhưng không ở production — đó là gì?
11. Truyền `data={{ id: 1 }}` cho một component bọc `memo` — memo có tác dụng không?
12. Component cha render lại — con có luôn render lại không?

<details>
<summary>Đáp án</summary>

1. **Không** — nó tạo một object mô tả. React quyết định khi nào gọi.
2. **Object mô tả** — rẻ và bất biến.
3. Ở **instance** React giữ cho vị trí đó trong cây, không trong hàm.
4. **Không** — nếu kết quả giống cũ, DOM không đổi.
5. React nhận diện ô nhớ bằng **thứ tự gọi hook**; `if` làm thứ tự thay đổi giữa các render.
6. **Không** — cùng tham chiếu mảng, `Object.is` trả `true`.
7. **Bị reset** — React coi đó là phần tử khác.
8. **Sau** khi vẽ.
9. Màn hình **đứng hình 200ms** — layout effect chặn vẽ.
10. **StrictMode** — công cụ phát hiện effect thiếu cleanup.
11. **Không** — object literal mới mỗi render, prop luôn "đổi".
12. **Mặc định là có**, trừ khi con được `memo` và props không đổi tham chiếu.
</details>

## What Usually Goes Wrong

- **Tưởng element là DOM node** → không hiểu vì sao tạo element rẻ.
- **Tưởng state nằm trong biến hàm** → không hiểu vì sao nó sống sót qua render.
- **Nhầm render với commit** → tối ưu nhầm chỗ, sợ "render lại" một cách vô cớ.
- **Mutate state** rồi ngạc nhiên vì UI không cập nhật.
- **Gọi hook có điều kiện** → thứ tự hook lệch, state nhảy lung tung.
- **Dùng `key={index}`** với danh sách có thêm/xoá.
- **Vá StrictMode bằng ref** thay vì sửa cleanup của effect.
- **Dùng `useLayoutEffect` mặc định** → chặn vẽ không cần thiết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| JSX là HTML | Nó là cú pháp tạo object |
| `<Foo />` gọi hàm `Foo` | Nó tạo mô tả; React gọi khi cần |
| Element là DOM node | Element là object mô tả |
| Render lại nghĩa là DOM đổi | Render là tính toán; commit mới chạm DOM |
| Render lại luôn là vấn đề hiệu năng | Chỉ khi nó làm việc nặng hoặc lan quá rộng |
| State nằm trong component function | Nó nằm ở instance theo vị trí trong cây |
| React so props sâu | Nó so bằng `Object.is` |
| Effect chạy hai lần là bug | Đó là StrictMode ở development |
| `children` là khái niệm đặc biệt | Nó là một prop bình thường |

## Explain Without Notes

1. Phân biệt component, element, instance, DOM node.
2. `<Button />` biên dịch thành gì? Nó có gọi `Button` không?
3. State thật sự sống ở đâu, và vì sao có Rules of Hooks?
4. Render và commit khác nhau thế nào?
5. Vì sao mutate state không làm UI cập nhật?
6. React nhận diện một component bằng gì? Ba cách làm mất state.
7. Thứ tự: setState → render → commit → layout effect → paint → effect. Cái nào chặn vẽ?
8. StrictMode làm gì và vì sao nó tồn tại?

## Related

- [State & render](../behavior/01-state-render.md) — state là snapshot, batching
- [Effects & lifecycle](../behavior/02-effects-lifecycle.md) — effect, cleanup, StrictMode
- [Reconciliation & keys](../behavior/05-reconciliation-keys.md) — danh tính và mất state
- [Props, composition & state design](../behavior/06-props-composition-state-design.md) — children và composition
- [Hooks reference map](03-hooks-advanced-map.md) — toàn bộ hook và khi nào dùng
- [Performance](../behavior/12-performance.md) — khi nào render lại thật sự tốn kém
- [JavaScript event loop](../../01-javascript-typescript/async-concurrency/01-event-loop-async.md) — nền của batching

## Version / Context

React 19.2 (bản ổn định hiện tại, phát hành 10/2025). JSX transform mới (`jsx()` thay vì `React.createElement`) là mặc định từ React 17 — không cần `import React` chỉ để dùng JSX. StrictMode double-render chỉ xảy ra ở development. Từ React 19, `ref` là prop bình thường (không cần `forwardRef`).
