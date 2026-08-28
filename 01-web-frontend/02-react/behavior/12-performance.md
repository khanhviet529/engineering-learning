---
level: advanced
area: frontend
prerequisites:
  - 07-context-memoization.md
related:
  - ../../../05-cross-cutting/performance/02-frontend-performance.md
  - ../../00-web-foundations/04-rendering-pipeline.md
---

# React performance

> Quy tắc số một: **đo trước khi sửa.** Quy tắc số hai: vấn đề hiếm khi là "component render quá nhiều" — nó thường là "render một lần quá đắt" hoặc "có quá nhiều DOM node".

## Position

```text
JS: React render → reconcile → commit
Browser: layout → paint → composite
   ↑ nút thắt có thể ở BẤT KỲ bước nào — phải đo để biết
```

## Problem

Cách tối ưu React phổ biến nhất là cũng là cách kém hiệu quả nhất: rải `memo`, `useCallback`, `useMemo` khắp nơi rồi hy vọng. Kết quả thường là code khó đọc hơn và **không** nhanh hơn — vì nút thắt thật ở nơi khác.

Bốn nguyên nhân chậm khác nhau hoàn toàn về cách sửa:

| Triệu chứng | Nguyên nhân thật | Cách sửa |
|---|---|---|
| Gõ input bị lag | render lan rộng | thu hẹp phạm vi state |
| Scroll list dài giật | quá nhiều DOM node | virtualization |
| Click rồi UI đứng 300ms | một render đắt / long task | chia nhỏ, `useTransition`, Worker |
| Trang tải chậm lần đầu | bundle lớn, waterfall | code splitting, fetch ở server |

Rải memo chỉ giải quyết một phần của hàng 1. Đó là lý do nó thường không giúp gì.

## Mental Model

```text
Tổng thời gian = số_lần_render × chi_phí_mỗi_render + chi_phí_DOM
                     ↓                  ↓                   ↓
              memo, colocation    chia component,      virtualization
                                  giảm việc trong render
```

Đọc công thức này để chọn công cụ: nếu `chi_phí_DOM` là 90% thì giảm `số_lần_render` không thay đổi gì đáng kể.

Bảng chẩn đoán:

| Câu hỏi | Công cụ trả lời |
|---|---|
| Component nào render, vì sao? | React DevTools Profiler → "Why did this render?" |
| Render mất bao lâu? | Profiler flamegraph |
| Bao nhiêu DOM node? | `document.querySelectorAll('*').length` |
| Thời gian là JS hay layout/paint? | Chrome Performance panel (màu vàng vs tím/xanh) |
| Người dùng thật có chậm không? | field data / RUM, Core Web Vitals |

## How It Works

### Thứ tự tối ưu (theo hiệu quả giảm dần)

**1. Thu hẹp phạm vi state** — rẻ nhất, hiệu quả nhất, không thêm phức tạp.

```tsx
// Trước: state ở page → 200 component render mỗi ký tự
// Sau: state trong SearchBox → 2 component render
```

Xem [Props & state design](06-props-composition-state-design.md).

**2. Virtualization cho list dài** — giải pháp đúng, không thể thay bằng memo.

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const v = useVirtualizer({
  count: rows.length,               // 100.000 hàng
  getScrollElement: () => parentRef.current,
  estimateSize: () => 40,
  overscan: 5,
});
// Chỉ render ~20 hàng đang hiển thị thay vì 100.000
```

100.000 hàng × 5 DOM node = 500.000 node. Không có lượng memo nào cứu được điều đó — vấn đề là browser phải layout 500.000 node.

**3. Chia nhỏ long task** — giữ main thread rảnh để phản hồi input.

```tsx
// useTransition: đánh dấu update là "không gấp"
const [isPending, startTransition] = useTransition();

const onChange = (e: ChangeEvent<HTMLInputElement>) => {
  setQuery(e.target.value);                      // gấp: input phải phản hồi ngay
  startTransition(() => setFiltered(filter(all, e.target.value)));  // hoãn được
};

// useDeferredValue: đơn giản hơn khi chỉ cần hoãn một giá trị
const deferredQuery = useDeferredValue(query);
const results = useMemo(() => filter(all, deferredQuery), [all, deferredQuery]);
```

Cả hai giữ input phản hồi tức thì trong khi kết quả cập nhật chậm hơn một chút — đúng thứ tự ưu tiên mà người dùng cảm nhận.

**4. Code splitting** — giảm bundle ban đầu.

```tsx
const Chart = lazy(() => import('./Chart'));      // chunk riêng
<Suspense fallback={<Skeleton />}><Chart /></Suspense>
```

**5. Memoization** — cuối cùng, sau khi đo. Xem [Context & memoization](07-context-memoization.md).

### Giảm việc trong render

```tsx
// ❌ Tạo hàm format, parse date, sort — mỗi render
function Row({ item }: Props) {
  const fmt = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' });  // đắt!
  return <td>{fmt.format(item.createdAt)}</td>;
}

// ✅ Tạo một lần ở module scope
const fmt = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' });
function Row({ item }: Props) {
  return <td>{fmt.format(item.createdAt)}</td>;
}
```

`new Intl.DateTimeFormat` là một trong những thứ đắt bất ngờ nhất — với 1000 hàng nó có thể chiếm phần lớn thời gian render.

### Đo đúng cách

```text
1. CPU throttling 4× (DevTools → Performance → gear)
2. Network throttling
3. Build production (dev build chậm hơn 2–5×, và có StrictMode double render)
4. Profiler → record → tương tác → stop
5. Đọc flamegraph: component nào rộng nhất
6. Sửa MỘT thứ → đo lại → so sánh
```

Bước 3 quan trọng: profiling trên dev build cho kết luận sai, vì React dev có nhiều kiểm tra và double render.

## Example

```tsx
// Trước: 5000 hàng, mỗi hàng có memo — vẫn lag
{rows.map(r => <MemoRow key={r.id} row={r} />)}

// Sau: virtualization — 20 hàng thật trong DOM
<div ref={parentRef} style={{ height: 600, overflow: 'auto' }}>
  <div style={{ height: v.getTotalSize(), position: 'relative' }}>
    {v.getVirtualItems().map(vi => (
      <div key={rows[vi.index].id}
           style={{ position: 'absolute', top: vi.start, height: vi.size, width: '100%' }}>
        <Row row={rows[vi.index]} />
      </div>
    ))}
  </div>
</div>
```

## Prediction

1. List 5000 hàng, mỗi hàng bọc `memo` — scroll có mượt không? Vì sao?
2. Cùng list với virtualization — bao nhiêu DOM node?
3. Input với `useState` ở root, 200 component con, CPU throttle 4× — độ trễ mỗi ký tự?
4. Sau khi colocate state — độ trễ?
5. `useDeferredValue` cho query với filter 50ms trên 10.000 item — input có lag không?
6. Profiling trên dev build vs production build — chênh nhau bao nhiêu?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Render 10.000 hàng không virtualize | Đo `document.querySelectorAll('*').length` và thời gian layout |
| Thêm `memo` cho từng hàng | Vẫn lag — memo không giảm số DOM node |
| Virtualize | Mượt; số node giảm 500× |
| `new Intl.DateTimeFormat` trong mỗi hàng | Profiler chỉ ra nó chiếm phần lớn thời gian |
| Filter đồng bộ 10.000 item mỗi ký tự | Input lag |
| Bọc bằng `useDeferredValue` | Input mượt, kết quả trễ nhẹ |
| Import chart library ở top level | Bundle analyzer cho thấy +300KB tải ngay |
| `lazy()` cho chart | Bundle ban đầu giảm |
| Profile dev build rồi production build | Số liệu khác nhau đáng kể |

## What Usually Goes Wrong

- **Tối ưu không đo** → thêm phức tạp, không nhanh hơn.
- **Dùng memo cho list dài** thay vì virtualization.
- **Tạo object/formatter/regex đắt trong render**.
- **Filter/sort dữ liệu lớn đồng bộ** trong render.
- **State quá cao** → render lan rộng.
- **Import thư viện nặng ở top level** (chart, editor, date library, icon set).
- **Profile trên dev build** → kết luận sai.
- **Test trên máy dev nhanh** → người dùng thật trên mobile có trải nghiệm khác hoàn toàn.
- **Ảnh không tối ưu** — thường tốn nhiều byte hơn cả JS bundle.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Render lại là vấn đề chính | Render không commit thì rẻ; DOM và long task đắt hơn |
| `memo` khắp nơi làm nhanh hơn | Thêm chi phí so sánh; thường không giúp |
| `useMemo` cache giữa các mount | Chỉ trong một instance |
| Virtualization chỉ cho list "rất dài" | Hữu ích từ khoảng 100 hàng phức tạp |
| React chậm | Thường code của bạn chậm; React ít khi là nút thắt |
| Bundle nhỏ là đủ | Long task và DOM lớn vẫn gây lag |
| Compiler sẽ tự tối ưu hết | Compiler tự memo; không tự virtualize hay giảm bundle |

## Debugging

1. **Xác định loại vấn đề trước**: Chrome Performance panel. JS (vàng) chiếm nhiều → vấn đề React/JS. Layout (tím)/Paint (xanh) chiếm nhiều → vấn đề DOM/CSS. Xem [Rendering pipeline](../../00-web-foundations/04-rendering-pipeline.md).
2. **React DevTools Profiler** → record → flamegraph. Thanh rộng = component tốn thời gian. Click → "Why did this render?".
3. **Đếm DOM node**: `document.querySelectorAll('*').length`. Trên 5.000 là dấu hiệu cần virtualization.
4. **Long task**: Performance panel, thanh có gạch đỏ (> 50ms). Chúng là nguyên nhân của INP xấu.
5. **Bundle**: `@next/bundle-analyzer` hoặc `vite-bundle-visualizer` → treemap.
6. **Field data**: Core Web Vitals từ người dùng thật (CrUX, hoặc `web-vitals` gửi về backend). Lab data không đại diện.
7. Luôn sửa **một** thứ rồi đo lại. Sửa nhiều thứ cùng lúc thì không biết cái nào có tác dụng.

## Production Considerations

- **Đặt ngân sách hiệu năng** và fail CI khi vượt: kích thước bundle, LCP, INP, CLS.
- **Core Web Vitals**: LCP < 2,5s, INP < 200ms, CLS < 0,1 — đo trên field data.
- **Ảnh** thường là phần lớn payload: dùng `next/image` (hoặc tương đương) với format hiện đại, kích thước đúng, `loading="lazy"`.
- **Font**: `font-display: swap`, preload font quan trọng, subset.
- **RUM** để biết người dùng thật; máy dev và CI không đại diện.
- Với Next.js App Router, chuyển việc nặng sang **server** thường hiệu quả hơn mọi tối ưu client. Xem [Rendering strategies](../../03-nextjs/behavior/04-rendering-strategies.md).
- Test trên thiết bị thật, tầm trung, mạng 4G.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Virtualization | xử lý list rất dài | phức tạp; Ctrl+F không tìm được item chưa render; a11y cần chú ý |
| `useTransition`/`useDeferredValue` | input luôn mượt | kết quả hiện trễ hơn |
| Code splitting | tải ban đầu nhanh | thêm round-trip khi cần chunk |
| Memoization | bỏ render đắt | RAM, độ phức tạp, risk deps sai |
| Server rendering việc nặng | client nhẹ | server tốn tài nguyên, TTFB có thể tăng |
| Web Worker | main thread rảnh | serialize dữ liệu, khó debug |

## Explain Without Notes

1. Công thức tổng thời gian và ba công cụ tương ứng với ba thành phần?
2. Vì sao `memo` không giải quyết được list 5000 hàng?
3. `useTransition` giữ điều gì mượt, và đánh đổi gì?
4. Vì sao không nên profile trên dev build?
5. Thứ tự 5 bước tối ưu, và vì sao memo ở cuối?

## Related

- [Context & memoization](07-context-memoization.md) — memo và chi phí của nó
- [Props & state design](06-props-composition-state-design.md) — bước 1: thu hẹp state
- [Rendering pipeline](../../00-web-foundations/04-rendering-pipeline.md) — chi phí ở tầng browser
- [Frontend performance](../../../05-cross-cutting/performance/02-frontend-performance.md) — Core Web Vitals, đo lường
- [Modules & bundling](../../01-javascript-typescript/fundamentals/02-modules-bundling.md) — bundle size
- [Event loop](../../01-javascript-typescript/async-concurrency/01-event-loop-async.md) — long task
