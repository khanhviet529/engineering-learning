---
level: intermediate
area: frontend
prerequisites:
  - ../../02-react/behavior/01-state-render.md
related:
  - 04-rendering-strategies.md
  - 03-data-fetching-cache.md
---

# Server / Client boundary

> Câu hỏi quan trọng nhất khi viết Next.js App Router: **dòng code này chạy ở đâu?** Không trả lời được nó thì mọi lỗi sẽ là bí ẩn.

*Baseline: Next.js 15, App Router.*

## Position

```text
Server (Node)                    │  Client (Browser)
Server Component                 │  Client Component
- fetch DB trực tiếp             │  - useState, useEffect
- đọc secret                     │  - onClick, event
- KHÔNG có hook, không event      │  - KHÔNG có DB, không secret
        └──── serialize props ────→ (chỉ dữ liệu JSON được, không hàm)
```

Hai từ, hai câu:

> **Server Component** là component **chỉ chạy trên server**. Code của nó không bao giờ được gửi xuống browser — browser chỉ nhận kết quả đã render.
>
> **Client Component** là component có code **được gửi xuống browser** và chạy ở đó, nên nó mới dùng được state và event.

Điều làm ranh giới này khó không phải định nghĩa, mà là **mặc định**: trong App Router mọi component là Server Component cho tới khi có `'use client'` ở đầu file. Ngược với trực giác của người đến từ React thuần, nơi mọi thứ đều chạy ở browser.

## Problem

Bốn lỗi có cùng một gốc:

```text
1. "useState is not defined" / "You're importing a component that needs useState"
2. "Cannot read properties of undefined (reading 'DATABASE_URL')" trong browser
3. "Functions cannot be passed directly to Client Components"
4. "Text content does not match server-rendered HTML" (hydration mismatch)
```

Gốc chung: trong App Router, **mặc định là Server Component**, và ranh giới giữa server và client có quy tắc cụ thể về cái gì đi qua được.

Lỗi thứ hai nghiêm trọng nhất: nếu code server lọt vào client bundle, **secret của bạn nằm trong JavaScript mà bất kỳ ai cũng tải được**.

## Mental Model

```text
Server Component (mặc định)
  chạy: chỉ trên server, mỗi request (hoặc lúc build)
  được: async/await, fetch DB, đọc env secret, import thư viện Node
  không: useState/useEffect/hook, onClick, window/document, Context Provider

Client Component ('use client')
  chạy: trên server MỘT LẦN (render HTML) rồi trên browser (hydrate + tương tác)
  được: mọi thứ của React
  không: truy cập DB, đọc secret, import module Node (fs, pg)
```

Điểm bị hiểu sai nhiều nhất: **`'use client'` không có nghĩa "chỉ chạy trên client".** Client Component vẫn được render trên server để sinh HTML ban đầu. Nó chỉ nghĩa là component này **cũng** được gửi xuống browser và hydrate ở đó.

Hệ quả: code trong Client Component chạy **hai lần** (server một lần, client một lần). Bất cứ thứ gì khác nhau giữa hai lần đó gây hydration mismatch.

### `'use client'` là một ranh giới, không phải một nhãn

```text
'use client' ở đầu file A
   ↓
A và MỌI THỨ A import trở thành client bundle
   ↓
kể cả khi component con không cần tương tác
```

Đây là lý do đặt `'use client'` ở component gốc của cây là sai — nó biến cả app thành client.

### Quy tắc đặt boundary: đẩy xuống lá

```text
❌ 'use client' ở layout/page          → cả cây thành client
✅ 'use client' ở component nhỏ nhất cần tương tác
```

```tsx
// ❌ Cả page thành client vì một cái nút
'use client';
export default function Page() {
  const [open, setOpen] = useState(false);
  return <div><HugeStaticContent /><button onClick={() => setOpen(true)}/></div>;
}

// ✅ Page là server; chỉ nút là client
export default async function Page() {
  const data = await db.query(...);            // chạy trên server
  return <div><HugeStaticContent data={data} /><ToggleButton /></div>;
}

// ToggleButton.tsx
'use client';
export function ToggleButton() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(true)}>Open</button>;
}
```

## How It Works

### Cái gì đi qua được boundary

Props từ Server → Client phải **serialize được**:

| Đi qua được | Không đi qua được |
|---|---|
| string, number, boolean, null | function (trừ Server Action) |
| Array, plain object | class instance |
| Date, Map, Set, BigInt | Symbol |
| Promise (React sẽ chờ) | closure |
| JSX element (`ReactNode`) | getter/setter |

```tsx
// ❌ "Functions cannot be passed directly to Client Components"
<ClientComp onSave={async (d) => { await db.save(d); }} />

// ✅ Server Action — được đánh dấu đặc biệt để serialize thành một reference
async function save(d: FormData) { 'use server'; await db.save(d); }
<ClientComp onSave={save} />
```

### Composition qua boundary

Server Component **không** import được vào Client Component. Nhưng có thể truyền qua `children`:

```tsx
// ❌ Client import Server → lỗi
'use client';
import ServerComp from './ServerComp';

// ✅ Server render và truyền xuống làm children
// page.tsx (server)
<ClientWrapper>
  <ServerComp />        {/* render trên server, truyền element xuống */}
</ClientWrapper>
```

Pattern này quan trọng: nó cho phép một provider client (theme, query client) bọc nội dung server.

### Bảo vệ ranh giới bằng build error

```ts
// lib/db.ts
import 'server-only';          // build FAIL nếu file này bị import vào client
export const db = createClient(process.env.DATABASE_URL!);
```

```ts
// lib/analytics.ts
import 'client-only';          // build fail nếu bị import vào server
```

Đây là biện pháp nên áp dụng cho mọi module chạm vào secret hoặc database. Không có nó, việc lộ secret là một lỗi import mà không ai để ý.

### Environment variable

```text
process.env.DATABASE_URL           → chỉ server. undefined ở client.
process.env.NEXT_PUBLIC_API_URL    → được nhúng vào bundle, AI CŨNG ĐỌC ĐƯỢC
```

`NEXT_PUBLIC_*` được thay thế bằng giá trị thật lúc build. Đừng bao giờ đặt secret vào đó — nó nằm trong file JS công khai.

### Hydration mismatch

Xảy ra khi HTML từ server khác kết quả render đầu tiên ở client:

```tsx
// ❌ Nguồn mismatch phổ biến
<p>{new Date().toLocaleString()}</p>        // thời gian server ≠ client
<p>{Math.random()}</p>
<p>{localStorage.getItem('x')}</p>          // window không tồn tại trên server
<p>{window.innerWidth}</p>

// ✅ Chỉ render ở client sau khi mount
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <Skeleton />;          // hoặc render giá trị trung tính
return <p>{new Date().toLocaleString()}</p>;
```

Với nội dung mà bạn biết chắc chỉ đúng ở client và không quan trọng cho SEO, dùng `suppressHydrationWarning` — nhưng chỉ sau khi hiểu vì sao mismatch xảy ra, không phải để làm im cảnh báo.

## Example

```tsx
// app/tasks/page.tsx — Server Component
import { db } from '@/lib/db';              // 'server-only'
import { TaskFilters } from './TaskFilters';

export default async function TasksPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;    // Next.js 15: searchParams là Promise
  const tasks = await db.task.findMany({ where: { status } });

  return (
    <>
      <TaskFilters />                        {/* client: có onChange */}
      <ul>{tasks.map(t => <li key={t.id}>{t.title}</li>)}</ul>  {/* server: chỉ hiển thị */}
    </>
  );
}
```

Không có `useEffect`, không có loading state, không có JS nào cho danh sách được gửi xuống client. Dữ liệu được fetch cùng nơi với nơi nó được render.

## Prediction

1. `'use client'` ở `layout.tsx` — bao nhiêu phần trăm app trở thành client bundle?
2. Server Component import một Client Component — được không? Chiều ngược lại?
3. Truyền `onSave={fn}` từ Server sang Client — lỗi gì? Sửa thế nào?
4. `process.env.DATABASE_URL` đọc trong Client Component — giá trị gì?
5. `NEXT_PUBLIC_SECRET_KEY` — ai đọc được?
6. `<p>{new Date().toISOString()}</p>` trong Client Component — cảnh báo gì?
7. Client Component có `console.log('hi')` ở body — log xuất hiện ở đâu?

<details>
<summary>Đáp án chọn lọc</summary>

2. Server → Client: được. Client → import Server: không (nhưng truyền qua `children` được).
4. `undefined` — biến không có tiền tố `NEXT_PUBLIC_` không được nhúng vào client bundle.
5. Bất kỳ ai — nó nằm trong file JS tải về.
7. **Cả hai**: terminal của server (lần render server) và console browser (lần hydrate).
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `'use client'` ở root layout | Chạy `next build`, so sánh First Load JS |
| Import `db` vào Client Component | Build error (nếu có `server-only`) hoặc secret vào bundle (nếu không) |
| Tìm secret trong bundle: `grep -r "your-secret" .next/static` | Nếu tìm thấy thì bạn đã lộ nó |
| Truyền function làm prop qua boundary | Lỗi serialization rõ ràng |
| Render `Date.now()` trong Client Component | Hydration mismatch |
| Đọc `localStorage` trong render | `window is not defined` |
| Đặt `'use client'` ở component có 20 import | Bundle analyzer cho thấy cả 20 vào client |
| Bỏ `server-only` rồi import nhầm | Không có cảnh báo — bug im lặng |

Thí nghiệm thứ ba (`grep` bundle) nên là một bước trong checklist review của bạn.

## What Usually Goes Wrong

- **`'use client'` quá cao** → mất hết lợi ích của RSC, bundle lớn.
- **Secret vào client bundle** — lỗi bảo mật thật, do một dòng import.
- **Không dùng `server-only`** → không có gì bảo vệ ranh giới.
- **Hydration mismatch** từ thời gian, random, `window`, `localStorage`.
- **Truyền function qua boundary** không dùng Server Action.
- **Import Server Component vào Client** thay vì dùng `children`.
- **Đặt `NEXT_PUBLIC_` cho secret**.
- **Dùng `useEffect` + fetch trong Client Component** khi lẽ ra fetch được ở server.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `'use client'` = chỉ chạy trên client | Vẫn render trên server một lần để sinh HTML |
| Server Component không gửi gì xuống client | Gửi HTML và RSC payload (dữ liệu đã render), nhưng không gửi code component |
| Cần `'use client'` để dùng props | Không — Server Component nhận props bình thường |
| Client Component không dùng được với SSR | Nó **được** SSR; đó là lý do có hydration |
| Mọi thứ trong `app/` là server | Đúng theo mặc định, nhưng `'use client'` lan xuống toàn bộ cây import |
| `NEXT_PUBLIC_` chỉ là quy ước đặt tên | Nó quyết định biến có được nhúng vào bundle công khai hay không |
| Hydration mismatch chỉ là cảnh báo | React có thể loại bỏ và render lại toàn bộ cây ở client — mất hết lợi ích SSR |

## Debugging

1. **"useState is not defined"** hoặc lỗi hook → component đang là Server Component. Thêm `'use client'` ở **file nhỏ nhất** cần nó.
2. **Không biết code chạy ở đâu** → `console.log`. Xuất hiện ở terminal = server; ở browser console = client; ở cả hai = Client Component đang render hai lần.
3. **Bundle lớn bất thường** → `next build` in ra First Load JS mỗi route. Tăng đột ngột nghĩa là có `'use client'` mới ở chỗ cao.
4. **Nghi lộ secret** → `grep -r "<giá trị secret>" .next/` sau build.
5. **Hydration mismatch** → React chỉ ra node cụ thể trong console. Tìm giá trị phụ thuộc thời gian/random/browser.
6. **`window is not defined`** → code chạy trên server; chuyển vào `useEffect` hoặc dùng `dynamic(() => ..., { ssr: false })`.

## Production Considerations

- **`import 'server-only'`** trong mọi module chạm database, secret, hoặc API key. Đây là biện pháp có ROI cao nhất trong note này.
- **Kiểm tra bundle trong CI**: đặt ngân sách First Load JS và fail khi vượt.
- **Fetch ở server theo mặc định.** Chỉ dùng client fetching cho dữ liệu phụ thuộc tương tác.
- **Đẩy `'use client'` xuống lá** — review PR nên hỏi "vì sao file này cần `'use client'`?".
- Không đặt secret trong `NEXT_PUBLIC_*`. Nếu đã từng đặt, coi như secret đó đã bị lộ và rotate nó.
- Client Component chạy trên server nghĩa là nó phải chịu được môi trường không có `window` — kể cả trong lần render đầu.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Server Component | ít JS, fetch gần data, secret an toàn | không tương tác, mỗi thay đổi cần round-trip |
| Client Component | tương tác, state cục bộ | JS bundle, cần hydrate |
| `'use client'` ở lá | bundle nhỏ | nhiều file nhỏ, cần nghĩ về boundary |
| `'use client'` ở gốc | đơn giản, giống SPA | mất hết lợi ích RSC |
| `dynamic(..., { ssr: false })` | tránh mismatch | không có HTML ban đầu (xấu cho SEO/LCP) |

## Explain Without Notes

1. `'use client'` thật sự nghĩa là gì? Nó **không** nghĩa là gì?
2. Cái gì đi qua được boundary Server → Client, cái gì không?
3. Vì sao đặt `'use client'` ở layout là sai?
4. Ba nguyên nhân hydration mismatch và cách sửa mỗi cái?
5. `server-only` bảo vệ điều gì, và điều gì xảy ra nếu không có nó?

## Related

- [Rendering strategies](04-rendering-strategies.md) — SSR/SSG/ISR/streaming
- [Data fetching & cache](03-data-fetching-cache.md) — fetch ở server
- [Route Handlers & Server Actions](05-route-handlers-server-actions.md) — hàm qua boundary
- [Routing & layout](02-routing-layout-rendering.md) — nơi đặt boundary theo route
- [Modules & bundling](../../01-javascript-typescript/fundamentals/02-modules-bundling.md) — bundler thực thi ranh giới này
- [Secrets management](../../../05-cross-cutting/security/06-secrets-management.md)
