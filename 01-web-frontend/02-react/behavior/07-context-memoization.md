---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
  - 06-props-composition-state-design.md
related:
  - 12-performance.md
---

# Context & memoization

> `memo`, `useMemo`, `useCallback` không làm app nhanh hơn. Chúng **đánh đổi** RAM và độ phức tạp để bỏ đi một số công việc render. Nếu công việc đó vốn đã rẻ, bạn chỉ mất mà không được.

## Position

```text
Context Provider → mọi consumer render khi value đổi
React.memo       → chặn render lan từ parent xuống
useMemo/useCallback → giữ reference ổn định để memo hoạt động
```

## Problem

Hai bẫy đối lập nhau:

```tsx
// Bẫy 1: Context value tạo mới mỗi render → mọi consumer render, dù dữ liệu không đổi
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>   {/* object literal! */}
      {children}
    </AuthContext.Provider>
  );
}
```

```tsx
// Bẫy 2: memo bị vô hiệu vì props không stable
const Row = memo(function Row({ item, onSelect }) { /* ... */ });

<Row item={item} onSelect={() => select(item.id)} />   {/* hàm mới mỗi render */}
```

Bẫy 2 là bẫy tinh vi hơn: bạn *thấy* `memo` trong code, nên tin rằng đã tối ưu. Thực tế `memo` chạy so sánh props mỗi render, thất bại, rồi render — tức bạn đã **thêm** chi phí mà không bỏ được gì.

## Mental Model

### Context

```text
Provider value đổi (theo Object.is)
      ↓
MỌI component gọi useContext(ThatContext) render lại
      ↓
memo KHÔNG chặn được điều này — consumer đăng ký trực tiếp với context
```

Điểm cuối quan trọng: `React.memo` chặn render lan **từ parent**, nhưng không chặn render do context. Một component `memo` mà gọi `useContext` vẫn render khi context đổi.

Hệ quả thiết kế: **chia context theo tần suất thay đổi**, không theo chủ đề.

```tsx
// ❌ Một context cho mọi thứ → đổi theme làm cả app render
<AppContext.Provider value={{ user, theme, notifications, cart }}>

// ✅ Tách theo tần suất đổi
<UserContext.Provider value={user}>          {/* rất ít đổi */}
  <ThemeContext.Provider value={theme}>      {/* ít đổi */}
    <CartContext.Provider value={cart}>      {/* đổi thường xuyên */}
```

Và tách **state** khỏi **action** — vì action không bao giờ đổi:

```tsx
<AuthStateContext.Provider value={user}>          {/* đổi khi login/logout */}
  <AuthActionsContext.Provider value={actions}>   {/* memo hoá, không bao giờ đổi */}
```

Component chỉ cần `login()` sẽ không render khi `user` đổi.

### Memoization

```text
React.memo(Component)      → bỏ render nếu props "bằng" (shallow, Object.is)
useMemo(() => v, deps)     → giữ nguyên GIÁ TRỊ giữa các render
useCallback(fn, deps)      → giữ nguyên HÀM giữa các render (= useMemo cho hàm)
```

Ba cái này chỉ có tác dụng khi **tất cả** props/deps đều stable. Một prop không stable làm vô hiệu toàn bộ.

Quy tắc chi phí:

```text
Chi phí memo   = so sánh props + giữ giá trị cũ trong RAM + độ phức tạp code
Lợi ích memo   = bỏ được công việc render
→ Chỉ đáng khi lợi ích > chi phí, tức là khi render THẬT SỰ đắt
```

Với một component render 5 div, chi phí lớn hơn lợi ích. Với một chart 5000 điểm hoặc một list 1000 dòng, ngược lại.

## How It Works

### Khi nào `useMemo` thật sự cần

```tsx
// 1. Tính toán đắt thật (đo trước!)
const sorted = useMemo(() => bigArray.sort(cmp), [bigArray]);

// 2. Giữ reference ổn định cho dependency array
const options = useMemo(() => ({ limit, offset }), [limit, offset]);
useEffect(() => { fetch(options); }, [options]);   // không có memo → effect chạy mỗi render

// 3. Giữ reference ổn định cho child đã memo
const config = useMemo(() => ({ theme, locale }), [theme, locale]);
<MemoChild config={config} />
```

Trường hợp 2 và 3 là lý do phổ biến hơn trường hợp 1: `useMemo` được dùng cho **tính đúng đắn của reference**, không cho tốc độ tính toán.

Ngược lại, đây là những chỗ `useMemo` chỉ thêm chi phí:

```tsx
const total = useMemo(() => a + b, [a, b]);          // ❌ cộng rẻ hơn memo
const label = useMemo(() => `${first} ${last}`, [first, last]);   // ❌
```

### `useCallback` chỉ có ý nghĩa khi hàm là dependency

```tsx
// ❌ Vô nghĩa — DOM handler không quan tâm reference
const onClick = useCallback(() => setOpen(true), []);
<button onClick={onClick}>

// ✅ Có nghĩa — child đã memo
const onSelect = useCallback((id: string) => select(id), [select]);
<MemoRow onSelect={onSelect} />

// ✅ Có nghĩa — là dependency của effect
const load = useCallback(() => fetch(url), [url]);
useEffect(() => { load(); }, [load]);
```

### Pattern tránh cần `useCallback`

Với list, truyền **dữ liệu** thay vì closure:

```tsx
// ❌ Closure mới cho mỗi row mỗi render
{items.map(i => <Row key={i.id} item={i} onSelect={() => select(i.id)} />)}

// ✅ Handler ổn định, row tự truyền id lại
const onSelect = useCallback((id: string) => select(id), [select]);
{items.map(i => <Row key={i.id} item={i} onSelect={onSelect} />)}

// Trong Row: onSelect(item.id)
```

Hoặc dùng event delegation — một handler ở container, đọc `data-id` từ target.

### Thứ tự ưu tiên khi tối ưu

```text
1. Thu hẹp phạm vi state (colocation)     ← rẻ nhất, hiệu quả nhất
2. Composition (children không render lại)
3. Tách context theo tần suất đổi
4. Virtualization cho list dài            ← giải pháp đúng cho list, không phải memo
5. memo + useCallback + useMemo           ← cuối cùng, sau khi ĐO
```

Bước 1 và 4 giải quyết phần lớn vấn đề hiệu năng thật. Bước 5 được dùng nhiều nhất nhưng giúp ít nhất.

Xem [Props & state design](06-props-composition-state-design.md) cho bước 1–2.

## Example

```tsx
// Context tách state/actions — actions không bao giờ đổi reference
const StateCtx = createContext<User | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // Không phụ thuộc user → không bao giờ tạo lại
  const actions = useMemo<Actions>(() => ({
    login: async (c: Creds) => setUser(await api.login(c)),
    logout: () => setUser(null),
  }), []);

  return (
    <StateCtx.Provider value={user}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useUser = () => useContext(StateCtx);
export const useAuthActions = () => useContext(ActionsCtx)!;
```

Component có nút "Logout" dùng `useAuthActions()` và **không** render khi `user` đổi.

## Prediction

1. Context value là `{ user, setUser }` object literal, parent render vì lý do khác — bao nhiêu consumer render?
2. Sau khi bọc `useMemo(() => ({user, setUser}), [user])` — bao nhiêu?
3. `memo(Row)` với `onSelect={() => f(id)}` inline — `memo` có tác dụng gì?
4. Component `memo` gọi `useContext(C)`, `C` đổi — có render?
5. `useMemo(() => a + b, [a, b])` — nhanh hơn hay chậm hơn `a + b` trực tiếp?
6. `useCallback` cho `onClick` của một `<button>` DOM — có tác dụng gì?

<details>
<summary>Đáp án</summary>

1. Tất cả — reference mới mỗi render.
2. Chỉ khi `user` thật sự đổi.
3. Không có tác dụng gì tốt: nó so sánh props, luôn thất bại (hàm mới), rồi render. Tổng chi phí **tăng**.
4. Có — `memo` không chặn context.
5. Chậm hơn: thêm mảng deps, thêm so sánh, thêm lưu trữ.
6. Không tác dụng về hiệu năng; DOM handler không so sánh reference.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Context value object literal, log trong 20 consumer | Tất cả render mỗi lần provider render |
| Bọc `useMemo`, làm lại | Chỉ render khi dữ liệu đổi |
| `memo` + prop inline function | DevTools Profiler cho thấy vẫn render |
| Thêm `useCallback` | Render dừng lại |
| `useMemo` cho `a + b`, đo bằng Profiler | Không nhanh hơn (thường chậm hơn chút) |
| List 5000 dòng có `memo` | Vẫn lag — memo không giải quyết được số lượng DOM |
| Cùng list với virtualization | Mượt — đây mới là giải pháp đúng |
| Một context cho user + theme + cart, đổi cart | Cả app render |

Thí nghiệm 6–7 là bài học quan trọng nhất: memo không phải giải pháp cho list dài.

## What Usually Goes Wrong

- **Context value không memo** → nguyên nhân số một của "app chậm khi dùng context".
- **`memo` với props không stable** → thêm chi phí, không lợi ích.
- **Memo hoá mọi thứ** → code khó đọc, deps array khắp nơi, không nhanh hơn.
- **Một context khổng lồ** cho mọi state global.
- **Dùng memo thay cho virtualization** cho list dài.
- **`useMemo` với deps sai** → giữ giá trị cũ khi lẽ ra phải tính lại (bug đúng đắn, không chỉ hiệu năng).
- **Tối ưu không đo** → không biết có tốt hơn không.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `memo` làm component nhanh hơn | Nó *bỏ* render; nếu render vốn rẻ thì chỉ thêm chi phí |
| `useMemo` cache giữa các lần mount | Chỉ trong một instance; mất khi unmount |
| `useCallback` làm hàm nhanh hơn | Chỉ giữ reference ổn định |
| `memo` chặn mọi render | Không chặn render do context hoặc state nội bộ |
| Context là "state management" | Là cơ chế truyền giá trị xuống cây; không có selector, không tối ưu |
| Memo hoá không có chi phí | Có: so sánh, RAM, độ phức tạp |
| React Compiler nên không cần hiểu điều này | Compiler tự memo, nhưng bạn vẫn cần hiểu để debug và thiết kế context |

## Debugging

1. **React DevTools → Profiler** → record → click một commit → xem component nào render và **"Why did this render?"**. Đây là bước đầu tiên, luôn luôn.
2. Nếu lý do là **"Context changed"** → tìm provider, kiểm tra value có memo.
3. Nếu là **"Props changed"** trên component đã `memo` → xem prop nào; thường là hàm hoặc object literal.
4. Bật **"Highlight updates when components render"** để thấy phạm vi trực quan.
5. **Đo trước và sau** mỗi tối ưu. Nếu không đo được sự khác biệt, hoàn lại thay đổi — bạn chỉ vừa thêm phức tạp.
6. Lag khi list dài → đếm số DOM node. Nếu hàng nghìn, vấn đề là số lượng, và giải pháp là virtualization.

## Production Considerations

- **Chia context theo tần suất thay đổi**, tách state khỏi actions.
- **Đo bằng Profiler với CPU throttling 4×** — máy bạn quá nhanh để thấy vấn đề của người dùng.
- **Virtualization cho mọi list > ~100 dòng** (TanStack Virtual, react-window).
- **React 19 + React Compiler** tự động memo hoá phần lớn trường hợp. Khi đó `useMemo`/`useCallback` thủ công chủ yếu dành cho việc giữ reference cho effect deps và cho tương tác với code ngoài React. Kiến trúc context vẫn là quyết định của bạn.
- Cân nhắc store có selector (Zustand) cho client state đổi thường xuyên — nó giải quyết đúng vấn đề mà context không giải quyết được.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Memo hoá | bỏ render đắt | RAM, so sánh, độ phức tạp, risk deps sai |
| Không memo hoá | code đơn giản | có thể render nhiều |
| Nhiều context nhỏ | render chính xác | nhiều provider, nhiều file |
| Một context lớn | đơn giản | render lan rộng |
| Store có selector | render chính xác nhất | thêm thư viện |
| Virtualization | xử lý list rất dài | phức tạp, Ctrl+F không tìm được item chưa render |

## Explain Without Notes

1. Vì sao context value là object literal gây render toàn bộ consumer?
2. Vì sao `memo` bị vô hiệu bởi prop inline function?
3. `memo` **không** chặn được loại render nào?
4. Ba lý do hợp lệ để dùng `useMemo`?
5. Thứ tự 5 bước tối ưu render, và bước nào nên làm trước memo?

## Related

- [State → render](01-state-render.md) — cái gì gây render
- [Props & state design](06-props-composition-state-design.md) — thu hẹp phạm vi state (bước 1)
- [React performance](12-performance.md) — đo lường và virtualization
- [Rendering pipeline](../../00-web-foundations/04-rendering-pipeline.md) — chi phí thật ở tầng browser
