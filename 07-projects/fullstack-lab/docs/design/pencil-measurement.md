# Cách đo artifact Pencil, và bốn cái bẫy đã dẫm

Tài liệu này tồn tại vì một lý do hẹp: **mọi con số về `flowboard-v0.1.pen` trong repo này đều đã từng sai ít nhất một lần, và luôn sai theo cùng một kiểu** — không phải đếm lệch, mà đếm đúng một thứ khác với thứ mình tưởng đang đếm. Bốn lần đều cho ra số **đẹp** (0 hardcoded hex, 0 clipped, 31 biến chết), nên không có gì báo động.

Ai đo artifact — người review hay agent design — đọc file này trước, và ghi rõ trong báo cáo mình dùng lens nào.

## Nguyên tắc chung

Số đo chỉ có nghĩa cùng với lens sinh ra nó. Một báo cáo ghi `clippedNodes 0` mà không nói đo trên cây nào là một báo cáo không kiểm được. Hai bên đo cùng một artifact bằng hai lens khác nhau sẽ ra hai con số, **và cả hai đều tin mình đúng** — chuyện đã xảy ra ở vòng freeze v0.1, nơi hai bên khớp số chính xác trong khi cả hai cùng sai.

## Bẫy 1 — Style property nằm **trực tiếp** trên node, không có object `styles`

`.pen` là JSON thuần. `fill`, `stroke`, `effect`, `fontFamily` nằm ngay trên node. **Không có `n.styles`.**

Một bộ đếm đọc `n.styles` sẽ trả `undefined` ở mọi node, tức là `0` cho mọi phép đếm style — và `0 hardcoded hex` trông hệt như một kết quả tốt. Hậu quả thật đã xảy ra: báo cáo "31 biến chết" (thật ra 22 biến còn được dùng qua 4.929 property), "0 hardcoded hex" (thật ra 112), và một lệnh xoá biến bị agent design chặn lại đúng lúc.

```js
// Sai: luôn ra 0
for (const k of Object.keys(n.styles || {})) { /* ... */ }

// Đúng: quét đệ quy mọi property trực tiếp, trừ children
function scan(v, path) {
  if (typeof v === "string") { if (/#[0-9a-fA-F]{3,8}\b/.test(v) && !path.endsWith("content")) hit++; return }
  if (v && typeof v === "object") for (const k of Object.keys(v)) scan(v[k], path + "." + k)
}
Get((n) => { for (const k of Object.keys(n)) if (k !== "children") scan(n[k], k); return undefined },
    { resolveInstances: true })
```

Phải đệ quy: `effect` là array of object, nên một vòng lặp chỉ đi sâu một tầng sẽ bỏ qua màu bên trong nó. Phải loại `content`: text hiển thị chuỗi `#5B3DF5` là nhãn swatch, không phải style hardcode. Trong artifact hiện tại đúng 4 chuỗi như vậy.

## Bẫy 2 — `ref` nằm trong `descendants` không phải là con trong cây thô

Instance override nội dung bằng `descendants`, và giá trị replacement **có thể chứa `ref` lồng ở bất kỳ độ sâu nào** — kể cả trong `children` của chính nó. Bộ duyệt cây thô (`Get(visit)` không có `resolveInstances`) **không đi vào vùng `descendants`**, nên nó không thấy những ref đó.

Kết quả: một component đang render thật ở nhiều chỗ vẫn bị đếm ra `0 instance`. Bẫy này đã bắt hai lần, cách nhau vài vòng:

- Lần một, khi đo biến chết: 22 ref ẩn, tổng thật 531.
- Lần hai, khi tôi kết luận `FbSkeleton`, `FbActivityItem` và `FbNavGroupTimeTracking` có 0 instance và đề nghị xoá chúng. Agent design phản biện và đúng: ba component đó có **2 / 8 / 18** ref ẩn — skeleton của cột loading BRD-01, hai dòng activity ở 4 frame TSK-02, và nhóm `CHẤM CÔNG` ở 14 màn Phase 1.3. Làm theo đề nghị của tôi là xoá 28 ref đang render.

```js
const raw = {}, hidden = {}
function digRefs(v, sink) {
  if (!v || typeof v !== "object") return
  if (Array.isArray(v)) { for (const x of v) digRefs(x, sink); return }
  if (v.type === "ref" && typeof v.ref === "string") sink[v.ref] = (sink[v.ref] || 0) + 1
  for (const k of Object.keys(v)) if (k !== "ref") digRefs(v[k], sink)
}
Get((n) => {
  if (n.type === "ref") raw[n.ref] = (raw[n.ref] || 0) + 1
  if (n.descendants) digRefs(n.descendants, hidden)
  return undefined
})
// Instance thật của một component = raw[id] + hidden[id]. Chỉ raw là chưa đủ.
```

**Hệ quả cho quyết định, không chỉ cho số đo:** "0 instance" **không** chứng minh được là không ai dùng, nên nó không bao giờ đủ để biện minh một lệnh xoá. Muốn xoá một component thì phải đo bằng lens trên và cho ra 0 ở **cả hai** cột.

## Bẫy 3 — Clipping là tính chất của **instance**, không phải của definition

Trên cây thô, ruột mỗi component được layout ở kích thước tự nhiên và không gì tràn. Tràn chỉ xuất hiện khi instance bị đặt và bị ép chiều rộng trong một màn cụ thể. Đo `ctx.problems` mà không `resolveInstances` nghĩa là **không kiểm instance nào cả** — chỉ kiểm 28 definition, và ra `clippedNodes 0`.

Ngược lại, đo có `resolveInstances` mà **không** loại subtree `enabled: false` sẽ đếm cả những node đã tắt: node tắt không được layout nên báo `fully clipped`, và đó không phải lỗi. Ở artifact này, các nav item bị tắt theo mốc/theo role tự chúng sinh ra 174 kết quả giả.

```js
let clipped = 0
Get((n, c) => {
  if (n.enabled === false) { c.skipChildren(); return undefined }   // node tắt: không phải lỗi
  if (!c.problems) return undefined
  clipped++
  const p = c.parentCtx
  const ovR = p ? Math.round(c.bounds.x + c.bounds.width  - p.bounds.width)  : 0
  const ovB = p ? Math.round(c.bounds.y + c.bounds.height - p.bounds.height) : 0
  return Print(n.id, n.name, "in", p?.node.name, "R+" + ovR, "B+" + ovB)
}, { resolveInstances: true })
```

Lens này đã tìm ra 10 chỗ text tràn thật mà lens cũ báo 0: helper của text field tràn 136px, label trong badge tràn 57px, label trong link tràn 16px. Cả ba đều là **component ép `width` cố định cho nội dung co giãn** — sửa ở definition thì mọi instance cùng hết.

**Ghi chú khi báo cáo:** tách ba nhóm, đừng gộp thành một số.

1. Tràn thật (`> 0px`, ngoài REF sheet) — mục tiêu 0.
2. Cố ý: ô preview trong REF sheet cắt bớt nội dung, focus ring vẽ ra ngoài control, card đang được nhấc trong DnD stage.
3. `+0px`: bounds bằng đúng mép. `ctx.problems` vẫn đếm, nhưng không có gì tràn. **Không nới hình học để làm sạch con số** — chỉnh geometry cho vừa lòng một dụng cụ đo là để dụng cụ điều khiển thiết kế. Định nghĩa chỉ số loại `≤ 0px`, và ghi lại là đã loại.

## Bẫy 4 — Frame vừa tạo trong cùng session báo bounds lệch

Agent design phát hiện và ghi lại: frame được tạo trong session hiện tại có thể báo `bounds` lệch khoảng +50px, sinh ra "clip" giả — 10 frame `WSP-05` đầu tiên cho 49 kết quả giả, trong khi bản `Copy` của **cùng** frame đó đo `y=0` và sạch hoàn toàn.

Vì vậy: **đừng tin số clipping đo ngay sau khi tạo frame.** Hoặc `Copy` lại rồi xoá bản gốc, hoặc đo ở lượt `execute` sau.

Bẫy này còn để lại dấu: ở một vòng trước, `REF-14` và `REF-17` đã bị nới cao hơn cần thiết để đuổi theo tràn ảo. Hai frame đó dư chiều cao, vô hại, và được giữ nguyên có chủ ý — ghi ở đây để lần sau không ai đi tìm nguyên nhân.

## Bộ chỉ số của một báo cáo freeze

Mỗi vòng freeze báo đúng bộ này, kèm tên lens:

| Chỉ số | Lens |
|---|---|
| `nodes`, `depth0`, `depth1` | cây thô |
| `reusableComponents`, và instance **thô + ẩn** của từng component | cây thô + `digRefs` (bẫy 2) |
| `textNodes`, `fontSizeUnder11` | cây thô |
| `hardcodedHexProps`, `distinct`, `stringHexTotal` | đệ quy trên cây đã resolve, loại `content` (bẫy 1) |
| `variables`, số biến prefix `fb.` | `GetVariables()` |
| `themes` | `GetVariables().themes` |
| `clippedNodes`, tách ba nhóm | resolve + loại `enabled:false` (bẫy 3) |
| `contrastChecked`, `below`, `noOpaqueBg` | tự khai; `noOpaqueBg` là lỗ hổng đã công bố, không phải 0 |

`noOpaqueBg` hiện là 22 và vẫn chưa ai kiểm được — nó là số node không có nền đục để so, nên contrast của chúng không xác định. Đừng đọc `below 0` như "không có vấn đề contrast".

## Lưu trạng thái

Editor Pencil giữ công việc trong bộ nhớ. **Số đo trong bộ nhớ không tồn tại với repo cho tới khi file được save.** Đã có một vòng làm xong 16 frame mới cộng ba sửa component rồi đóng editor trước khi save — sau đó không cách nào kiểm lại, và cũng không cách nào lấy lại. Quy ước: agent design báo cáo xong thì **chủ dự án save**, và việc save nên xảy ra **trước** vòng xác minh, không phải sau.
