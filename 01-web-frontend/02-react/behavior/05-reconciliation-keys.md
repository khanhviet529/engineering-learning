---
level: foundation
area: frontend
prerequisites:
  - 01-state-render.md
related:
  - 12-performance.md
  - 08-refs-uncontrolled.md
---

# Reconciliation & keys

> Bạn sắp xếp lại danh sách và chữ trong các input nhảy sang dòng khác. Không phải React lỗi — bạn đã nói với React rằng những dòng đó là cùng một dòng.

## Position

```text
RENDER → element tree mới → [RECONCILIATION: so với tree cũ] → COMMIT DOM tối thiểu
                                        ↑ note này
```

## Problem

```tsx
{tasks.map((task, i) => <TaskRow key={i} task={task} />)}
```

`key={index}` là mặc định mà mọi người viết vì ESLint yêu cầu *một* key và index luôn có sẵn. Nó hoạt động — cho đến khi danh sách thay đổi thứ tự.

```text
Trước:  [A, B, C]   → key 0=A, 1=B, 2=C
Xoá A:  [B, C]      → key 0=B, 1=C

React thấy: key 0 vẫn tồn tại → "cùng component, chỉ đổi props"
            key 2 mất         → "unmount cái cuối"

Thực tế:    A bị xoá
React làm:  giữ DOM/state của vị trí 0 và 1, xoá vị trí 2
```

Kết quả: state bên trong component (giá trị input, checkbox, focus, animation) **đứng yên tại vị trí** trong khi dữ liệu dịch chuyển. Nội dung input của A giờ nằm ở dòng B.

## Mental Model

Reconciliation trả lời một câu hỏi:

> **Element này trong tree mới có phải là "cùng một thứ" với element nào trong tree cũ không?**

Nếu **cùng** → giữ DOM node và giữ state của component, chỉ cập nhật props.
Nếu **khác** → unmount cái cũ (mất hết state), mount cái mới.

React quyết định bằng hai thứ, theo thứ tự:

```text
1. Vị trí trong tree + type của element
2. Nếu là list: KEY
```

Vì vậy: **key là cách bạn nói với React "đây là identity của item này"**. Key phải trả lời được câu "item này là item nào?" — và index không trả lời được câu đó, vì index nói về *vị trí*, không về *identity*.

```text
key = index  →  "item ở vị trí thứ 2"       ← đổi khi sắp xếp lại
key = id     →  "item có id = 42"           ← không đổi
```

## How It Works

### Type khác → mount lại

```tsx
{isEditing ? <input value={v} /> : <span>{v}</span>}
```

`input` và `span` là type khác nhau → React unmount cái này, mount cái kia. Mọi DOM state (focus, selection, scroll) mất.

Tinh vi hơn — cùng type nhưng khác vị trí trong tree:

```tsx
// ❌ Hai <Input> ở hai nhánh khác nhau của tree → mount lại khi toggle
{cond ? <div><Input /></div> : <section><Input /></section>}

// ✅ Cùng vị trí → giữ state
<div className={cond ? 'a' : 'b'}><Input /></div>
```

### `key` để **cố ý** reset state

Đây là mặt tích cực của cùng cơ chế, và là một công cụ rất hữu ích:

```tsx
// Đổi user → form phải reset về giá trị mới
<ProfileForm key={userId} user={user} />
```

Key mới → React coi đây là component khác → mount mới → state trong form tự reset. Không cần effect, không cần `useEffect(() => setDraft(...), [userId])`.

So sánh hai cách:

| | `key={userId}` | `useEffect` reset |
|---|---|---|
| Số dòng | 1 | 3–6 |
| Có frame hiển thị giá trị cũ? | không | **có** |
| Reset mọi state trong subtree? | có | chỉ cái bạn nhớ |
| Rủi ro quên một field | không | có |

### Chọn key

```tsx
// ✅ ID ổn định từ server
key={task.id}

// ✅ Với item chưa có ID (optimistic), sinh ID ở client khi TẠO, không khi render
const draft = { id: crypto.randomUUID(), ... };

// ❌ index — sai khi có reorder/insert/delete
key={i}

// ❌ Math.random() — key mới mỗi render → mount lại toàn bộ mỗi lần
key={Math.random()}

// ⚠️ nội dung — sai nếu trùng lặp hoặc đổi
key={task.title}
```

`key={Math.random()}` là trường hợp tệ nhất: nó "sửa" cảnh báo của React nhưng làm mọi item unmount/mount **mỗi render**, phá hiệu năng và mất mọi state.

Key phải: **duy nhất trong danh sách đó**, **ổn định giữa các render**, và **gắn với dữ liệu, không gắn với vị trí**.

### Khi nào `key={index}` chấp nhận được

Khi cả ba điều đúng: danh sách **không bao giờ** reorder, không insert/delete ở giữa, và item **không có state nội bộ** hay DOM state. Ví dụ: một danh sách chỉ đọc render từ dữ liệu tĩnh.

Ngay cả khi đó, dùng ID vẫn tốt hơn vì điều kiện có thể đổi mà không ai nhớ lại quyết định này.

## Example

```tsx
// Thí nghiệm để thấy bug — dùng làm bài test hiểu biết
function List() {
  const [items, setItems] = useState([
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Gamma' },
  ]);

  return (
    <>
      <button onClick={() => setItems(p => p.slice().reverse())}>reverse</button>
      <button onClick={() => setItems(p => p.slice(1))}>remove first</button>

      {items.map((it, i) => (
        <div key={i}>                              {/* đổi thành key={it.id} */}
          {it.label}: <input placeholder="type here" />
        </div>
      ))}
    </>
  );
}
```

Gõ chữ khác nhau vào ba input, rồi bấm "reverse". So sánh `key={i}` và `key={it.id}`.

## Prediction

1. Với `key={i}`, gõ "X" vào input của Alpha rồi bấm reverse — "X" ở dòng nào?
2. Với `key={it.id}`, cùng thao tác — "X" ở dòng nào?
3. Với `key={i}`, bấm "remove first" — input còn lại chứa gì?
4. `key={Math.random()}` — input còn giữ chữ khi bạn gõ tiếp không? Vì sao?
5. `<ProfileForm key={userId} />` khi `userId` đổi — state trong form thế nào?
6. `{cond ? <div><Input/></div> : <section><Input/></section>}` — toggle `cond`, input có giữ giá trị?

<details>
<summary>Đáp án</summary>

1. "X" ở dòng Gamma — DOM của key 0 được giữ tại vị trí 0, nhưng label đổi.
2. "X" theo Alpha xuống cuối — đúng như mong đợi.
3. Input giữ chữ của Alpha nhưng label là Beta.
4. Không — mỗi lần gõ gây render, key mới, input mới, mất giá trị (và mất focus).
5. Reset hoàn toàn.
6. Không — type wrapper khác nhau nên `Input` bị unmount/mount.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `key={i}` + reverse với input có nội dung | Nội dung lệch dòng |
| `key={i}` + xoá item đầu | State lệch một dòng |
| `key={Math.random()}` | Mất focus và giá trị mỗi lần gõ |
| Key trùng nhau trong list | React cảnh báo; behavior không xác định |
| Đổi type element khi toggle (`input`↔`span`) | Mất focus, mất selection |
| Thêm `key={userId}` vào form | Form tự reset khi đổi user |
| Bọc list bằng wrapper khác nhau theo điều kiện | Toàn bộ subtree mount lại; đo bằng Profiler |
| Checkbox trong list `key={i}`, tick vài cái rồi sort | Tick nhảy sang item khác — bug nghiêm trọng nếu là "chọn để xoá" |

Thí nghiệm cuối cho thấy đây không chỉ là bug UX: chọn item để xoá bằng checkbox với `key={i}` có thể **xoá sai bản ghi**.

## What Usually Goes Wrong

- **`key={index}` với list có thể reorder** — bug số một.
- **`key={Math.random()}`** để làm im cảnh báo → mất state và hiệu năng.
- **Key trùng** khi ghép nhiều nguồn dữ liệu (dùng prefix: `` key={`local-${id}`} ``).
- **Đổi cấu trúc tree theo điều kiện** làm subtree mount lại không lý do.
- **Không dùng `key` để reset** rồi viết effect phức tạp thay thế.
- **Key từ nội dung** trùng lặp khi hai item có cùng tên.
- **Key đặt trên phần tử con** thay vì phần tử ngoài cùng của `map`.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Key chỉ để React không cảnh báo | Nó là identity; sai key là bug dữ liệu |
| `key={index}` luôn ổn nếu list không đổi | "Không đổi" hôm nay, đổi tháng sau |
| Key phải unique toàn app | Chỉ cần unique trong cùng một list |
| Key được truyền vào component như prop | Không — React dùng nó, component không nhận được |
| Reconciliation so sánh sâu | So theo vị trí + type + key, không deep compare |
| Cùng component type thì luôn giữ state | Chỉ khi cùng vị trí trong tree hoặc cùng key |
| `key` chỉ dùng trong list | Dùng để cố ý reset state ở bất cứ đâu |

## Debugging

1. **State/input nhảy sai dòng** → kiểm tra `key` ngay. Đây là dấu hiệu đặc trưng, gần như không có nguyên nhân khác.
2. **Component mount lại không mong đợi** → React DevTools → Profiler, xem *"Why did this render?"*; component mount lại hiện là mount, không phải update.
3. **Cảnh báo "Each child should have a unique key"** → sửa thật, đừng dùng `Math.random()`.
4. **Cảnh báo "Encountered two children with the same key"** → key trùng; thêm prefix theo nguồn.
5. Toàn bộ list mount lại mỗi render → tìm key không stable, hoặc wrapper đổi type.
6. Mất focus khi gõ → key đổi mỗi render, hoặc component bị mount lại từ parent.

## Production Considerations

- **Luôn dùng ID từ server làm key.** Nếu dữ liệu chưa có ID (chưa lưu), sinh UUID **lúc tạo item**, không lúc render.
- Với optimistic update, giữ nguyên ID tạm khi thay bằng dữ liệu server, hoặc map ID tạm → ID thật, để item không mount lại.
- Với virtualization, key vẫn phải là ID — index của window sẽ đổi khi scroll.
- Trong list có checkbox/selection, key sai có thể dẫn tới **thao tác trên sai bản ghi**. Coi đây là vấn đề đúng đắn dữ liệu, không phải vấn đề giao diện.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `key={id}` | identity đúng, giữ state | cần có ID (đôi khi phải sinh ở client) |
| `key={index}` | luôn có sẵn | sai khi reorder/insert/delete |
| `key` để reset state | 1 dòng, không effect | mount lại cả subtree (mất DOM state, chạy lại effect) |
| Giữ cấu trúc tree ổn định | không mount lại | JSX có thể verbose hơn |

## Explain Without Notes

1. Reconciliation trả lời câu hỏi gì, và dùng hai thông tin nào?
2. Vì sao `key={index}` gây lệch state khi reorder? Vẽ timeline.
3. Vì sao `key={Math.random()}` tệ hơn không có key?
4. `key` dùng để reset state hoạt động thế nào, và đánh đổi gì?
5. Khi nào `key={index}` chấp nhận được?

## Related

- [State → render](01-state-render.md) — render vs commit
- [Effects & lifecycle](02-effects-lifecycle.md) — `key` thay cho effect reset
- [Refs & uncontrolled](08-refs-uncontrolled.md) — DOM state bị mất khi mount lại
- [React performance](12-performance.md) — mount lại không cần thiết
- [Forms](10-forms.md) — reset form bằng key
