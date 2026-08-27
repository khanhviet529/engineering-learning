---
level: foundation
area: frontend
prerequisites:
  - 01-browser-request-render.md
related:
  - ../02-react/12-performance.md
  - ../../05-cross-cutting/performance/02-frontend-performance.md
---

# Rendering pipeline: DOM → CSSOM → layout → paint → composite

> Vì sao đổi `left` gây jank mà đổi `transform` thì không. Câu trả lời nằm ở việc mỗi thuộc tính CSS kích hoạt lại bao nhiêu bước của pipeline.

## Position

```text
HTML/CSS/JS → [DOM → CSSOM → Render tree → Layout → Paint → Composite] → pixel
                                              ↑ ở đây
```

## Problem

Animation của bạn giật. `will-change` được thêm vào ngẫu nhiên vì "nghe nói nó giúp". Scroll bị lag khi có nhiều element. Bạn không biết vì sao 60fps đôi khi đạt được và đôi khi không.

Nguyên nhân gốc: **mỗi frame có ngân sách ~16,7ms** (60fps). Nếu một thay đổi buộc browser chạy lại layout cho cả trang, bạn vượt ngân sách và frame bị bỏ.

Không biết thuộc tính nào kích hoạt bước nào thì tối ưu chỉ là mê tín.

## Mental Model

Pipeline một chiều, và **bạn có thể nhảy vào ở giữa**:

```text
DOM ┐
    ├→ Render tree → Layout ──→ Paint ──→ Composite → pixel
CSSOM┘                 │          │          │
                       │          │          └ chỉ GPU: transform, opacity  → RẺ NHẤT
                       │          └ paint lại: color, background, box-shadow → TRUNG BÌNH
                       └ layout lại: width, height, top, left, font-size     → ĐẮT NHẤT
```

Nguyên tắc: **càng vào sâu bên phải càng rẻ.** Một thay đổi chỉ ảnh hưởng composite thì browser chỉ cần ra lệnh cho GPU dịch một layer đã vẽ sẵn — không tính toán lại gì.

Cùng một hiệu ứng thị giác, hai chi phí khác nhau:

```css
/* Đắt: layout → paint → composite, mỗi frame, cho mọi element bị ảnh hưởng */
.slide { left: 100px; }

/* Rẻ: chỉ composite, GPU xử lý */
.slide { transform: translateX(100px); }
```

## How It Works

### DOM và CSSOM

HTML → DOM tree. CSS → CSSOM tree. Cả hai được ghép thành **render tree** chỉ gồm node **sẽ hiển thị**.

Lưu ý phân biệt:

| | Có trong render tree? | Chiếm chỗ? |
|---|---|---|
| `display: none` | Không | Không |
| `visibility: hidden` | Có | **Có** |
| `opacity: 0` | Có | Có |
| `<head>`, `<script>` | Không | — |

Đây là lý do `display:none` → `block` gây layout, còn `opacity` 0 → 1 thì không.

### Layout (reflow)

Tính vị trí và kích thước hình học của mọi node. Đắt vì **có tính lan truyền**: đổi width của một element có thể đổi vị trí của mọi element sau nó.

### Paint

Tô pixel: màu, chữ, border, shadow, ảnh. Kết quả ghi vào một hoặc nhiều **layer**.

### Composite

Ghép các layer theo thứ tự, có thể trên GPU. Element được đưa lên layer riêng khi có `transform: translateZ(0)`, `will-change`, `position: fixed`, video, canvas…

Layer riêng làm animation rẻ nhưng **tốn RAM GPU**. Đây là lý do `will-change: transform` cho 500 element làm mọi thứ tệ hơn, không tốt hơn.

### Forced synchronous layout

Bug hiệu năng phổ biến nhất và khó thấy nhất: **ghi rồi đọc trong cùng một vòng lặp**.

```ts
// ❌ layout thrashing: mỗi lần đọc offsetHeight buộc browser layout lại NGAY
for (const el of items) {
  el.style.height = el.offsetHeight + 10 + 'px';  // ghi, rồi đọc, rồi ghi...
}

// ✅ đọc hết trước, ghi hết sau
const heights = items.map(el => el.offsetHeight);   // batch đọc
items.forEach((el, i) => el.style.height = heights[i] + 10 + 'px');  // batch ghi
```

Browser vốn gộp các thay đổi style và chỉ layout một lần trước frame. Nhưng khi bạn *đọc* một thuộc tính hình học (`offsetTop`, `offsetHeight`, `getBoundingClientRect()`, `scrollTop`, `getComputedStyle()`), browser **buộc phải** layout ngay để trả số đúng. Làm việc đó trong loop biến O(n) thành O(n) lần layout toàn trang.

## Example

```html
<div id="box" style="width:100px;height:100px;background:red"></div>
<button id="a">left</button>
<button id="b">transform</button>
```

```ts
const box = document.getElementById('box')!;
let x = 0;

// A: kích hoạt layout mỗi frame
document.getElementById('a')!.onclick = () => {
  const step = () => { box.style.left = `${x += 2}px`; requestAnimationFrame(step); };
  box.style.position = 'relative'; step();
};

// B: chỉ composite
document.getElementById('b')!.onclick = () => {
  const step = () => { box.style.transform = `translateX(${x += 2}px)`; requestAnimationFrame(step); };
  step();
};
```

Mở DevTools → Performance, record cả hai. Xem sự khác biệt trong các thanh **Layout** (tím) và **Paint** (xanh).

## Prediction

1. Trong ví dụ trên, cách nào có thanh "Layout" trong Performance panel? Cách nào không?
2. Nếu trang có 5000 element, cách A chậm đi bao nhiêu so với khi có 50 element? Cách B?
3. Bạn đổi `background-color` — bước nào chạy lại?
4. Bạn đổi `font-size` — bước nào chạy lại? Vì sao khác câu 3?
5. Thêm `will-change: transform` cho 1000 element — dự đoán RAM và fps.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Animate `width` với 2000 element | fps rơi mạnh; Performance panel đầy thanh Layout tím |
| Layout thrashing trong loop 1000 lần | Cảnh báo "Forced reflow" trong Performance; thời gian tăng phi tuyến |
| `will-change` cho mọi element | RAM GPU tăng, có thể chậm hơn không dùng |
| Task JS 500ms trong lúc animation chạy | Animation đứng hẳn — main thread bị chiếm |
| CSS animation `transform` + task JS 500ms | Animation **vẫn chạy** — vì nó trên compositor thread |
| Ảnh không có `width`/`height` | Layout shift khi tải xong (CLS) |
| `box-shadow` lớn animate | Paint đắt dù không layout |

Thí nghiệm thứ 4 và 5 cạnh nhau là thí nghiệm quan trọng nhất trong note này: nó cho thấy compositor thread độc lập với main thread.

## What Usually Goes Wrong

- **Animate thuộc tính layout** (`left`, `top`, `width`, `margin`) thay vì `transform`/`opacity`.
- **Layout thrashing** trong code đo kích thước — thường là trong thư viện tooltip, virtual list, drag-and-drop tự viết.
- **`will-change` bừa bãi** — được coi là "thuốc tăng lực", thực chất là đánh đổi RAM.
- **Long task JS** chặn mọi frame; React render lớn là một dạng long task. Xem [React performance](../02-react/12-performance.md).
- **Layout shift** vì ảnh/font/ad không có kích thước dự phòng.
- **DOM quá lớn** — 10.000 node làm mọi layout đắt, kể cả thay đổi nhỏ. Giải pháp là virtualization.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `will-change` luôn làm nhanh hơn | Nó tạo layer; nhiều layer = tốn RAM, có thể chậm hơn |
| `transform` không bao giờ gây layout | Đúng với translate/scale/rotate; nhưng đổi `width` bên trong element đó thì vẫn layout |
| JS chậm chỉ ảnh hưởng JS | Nó chiếm main thread → chặn layout, paint, và mọi input |
| Animation CSS luôn nhanh hơn JS | Chỉ khi thuộc tính được animate là composite-only |
| `display:none` và `visibility:hidden` như nhau | `visibility:hidden` vẫn chiếm chỗ và vẫn trong render tree |
| 60fps là mục tiêu duy nhất | Màn hình 120Hz có ngân sách 8,3ms |

## Debugging

1. DevTools → **Performance** → record trong lúc tương tác. Đọc theo màu: vàng = JS, tím = Layout, xanh lá = Paint, xanh dương = Composite.
2. Tìm chữ **"Forced reflow"** hoặc tam giác đỏ — đó là layout thrashing, và Performance panel chỉ đúng dòng code.
3. **Rendering** panel (Cmd/Ctrl+Shift+P → "Show Rendering"):
   - *Paint flashing* — vùng nào đang được vẽ lại. Nếu cả trang nháy khi chỉ một element đổi → paint quá rộng.
   - *Layout Shift Regions* — thấy CLS trực tiếp.
   - *Frame Rendering Stats* — fps thật.
4. **Layers** panel — xem có bao nhiêu layer và vì sao chúng được tạo.
5. Nếu jank chỉ khi có nhiều dữ liệu → vấn đề là kích thước DOM, không phải thuộc tính CSS.

## Production Considerations

- Người dùng có CPU yếu hơn máy bạn 4–10 lần. Dùng CPU throttling 4× trong DevTools làm mặc định khi test.
- **Core Web Vitals** đo đúng các bước này: LCP (paint của nội dung lớn nhất), CLS (layout shift), INP (main thread có rảnh để phản hồi input không).
- `content-visibility: auto` cho phép bỏ qua layout/paint của nội dung ngoài viewport — hiệu quả lớn cho trang dài.
- Virtualization (render chỉ item trong viewport) là giải pháp đúng cho list dài, không phải memo.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `transform`/`opacity` cho animation | 60fps ổn định | không animate được mọi thuộc tính |
| Tạo layer (`will-change`) | composite rẻ | RAM GPU, có thể tăng thời gian composite |
| Virtualization | DOM nhỏ, layout rẻ | phức tạp hơn; Ctrl+F của browser không tìm được item chưa render |
| `content-visibility: auto` | bỏ qua công việc ngoài viewport | scrollbar có thể nhảy nếu không đặt `contain-intrinsic-size` |

## Explain Without Notes

1. Kể 5 bước của pipeline và cho mỗi bước một thuộc tính CSS kích hoạt nó.
2. Vì sao `transform: translateX` rẻ hơn `left`?
3. Layout thrashing là gì, vì sao nó xảy ra, và sửa bằng cách nào?
4. Vì sao một task JS 500ms làm animation `left` đứng nhưng không làm animation `transform` (CSS) đứng?
5. `will-change` đánh đổi cái gì lấy cái gì?

## Related

- [Browser request → render](01-browser-request-render.md) — pipeline này là nửa sau
- [React performance](../02-react/12-performance.md) — long task từ React render
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md) — đo Core Web Vitals
- [Event loop](../01-javascript-typescript/01-event-loop-async.md) — vì sao JS chặn render
