---
level: intermediate
area: frontend
prerequisites:
  - 01-server-client-boundary.md
  - 04-rendering-strategies.md
related:
  - ../00-web-foundations/02-http-browser-cache.md
  - ../../03-database/02-redis/01-cache-invalidation.md
---

# Data fetching & cache

> "Tôi sửa database rồi mà trang vẫn hiện dữ liệu cũ." Trong Next.js App Router, câu trả lời phụ thuộc **lớp cache nào** đang giữ nó — và có tới bốn lớp.

*Baseline: Next.js 15, App Router. Behavior caching thay đổi đáng kể giữa Next 14 và 15 — Next 15 đổi mặc định sang **không cache**.*

## Position

```text
Browser cache
   ↓
Router Cache (client, trong bộ nhớ)
   ↓
Full Route Cache (HTML/RSC đã render)
   ↓
Data Cache (kết quả fetch, bền qua deploy)
   ↓
Request Memoization (trong một request)
   ↓
Database
```

Năm lớp. Khi dữ liệu cũ, câu hỏi đúng là **"lớp nào?"** — và mỗi lớp có cách vô hiệu khác nhau.

## Problem

Với Next 14, mặc định là **cache mọi thứ**, và điều đó gây rất nhiều bất ngờ: `fetch` được cache vô hạn, `POST` từ Route Handler cũng bị cache, và người ta thêm `cache: 'no-store'` khắp nơi mà không hiểu tại sao.

Next 15 đảo mặc định: **`fetch` không cache theo mặc định**. Điều này an toàn hơn nhưng nghĩa là bạn phải **chủ động** bật cache để có hiệu năng.

Vì repo này dùng baseline Next 15, hãy nhớ: bạn **opt in** cache, không phải opt out.

## Mental Model

Năm lớp, ba trục:

| Lớp | Ở đâu | Phạm vi | Vô hiệu bằng |
|---|---|---|---|
| **Request Memoization** | server | một request | tự động (hết request) |
| **Data Cache** | server | mọi user, qua deploy | `revalidateTag`, `revalidatePath`, TTL |
| **Full Route Cache** | server | mọi user | `revalidatePath`, deploy |
| **Router Cache** | client | một user, một session | `router.refresh()`, navigate, 30s/5min |
| **Browser cache** | client | một user | HTTP header |

Hai lớp gây bối rối nhất:

**Request Memoization** — trong *cùng một* render, hai component gọi `fetch('/api/user')` chỉ tạo **một** request. Điều này cho phép mỗi component tự fetch dữ liệu nó cần mà không cần truyền props hay lifting — một tính năng thiết kế quan trọng của RSC.

**Router Cache** — cache ở **client**. Đây là lý do phổ biến nhất của "tôi đã `revalidateTag` mà vẫn thấy cũ": server đã có dữ liệu mới, nhưng client đang dùng bản trong bộ nhớ của nó. Cần `router.refresh()` hoặc một `revalidatePath` trong Server Action (nó cũng xoá Router Cache).

## How It Works

### Bật cache tường minh (Next 15)

```ts
// Không cache (mặc định trong Next 15)
await fetch(url);

// Cache vô hạn cho tới khi revalidate
await fetch(url, { cache: 'force-cache' });

// Cache có TTL
await fetch(url, { next: { revalidate: 60 } });

// Cache có tag để vô hiệu chính xác
await fetch(url, { next: { tags: ['tasks'] } });
```

### Cache cho hàm không dùng `fetch`

Truy vấn database trực tiếp không đi qua `fetch`, nên không có Data Cache. Dùng `unstable_cache`:

```ts
import { unstable_cache } from 'next/cache';

export const getTasks = unstable_cache(
  async (projectId: string) => db.task.findMany({ where: { projectId } }),
  ['tasks'],                                  // key prefix
  { tags: ['tasks'], revalidate: 60 },
);
```

Và `cache()` của React cho memoization trong một request:

```ts
import { cache } from 'react';

export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }));
// Gọi ở 5 component trong cùng render → 1 query
```

Phân biệt: `cache()` chỉ trong một request (như Request Memoization); `unstable_cache` bền qua request (như Data Cache).

### Vô hiệu cache

```ts
'use server';
import { revalidateTag, revalidatePath } from 'next/cache';

export async function createTask(input: CreateTaskInput) {
  const task = await db.task.create({ data: input });

  revalidateTag('tasks');          // mọi fetch/unstable_cache có tag 'tasks'
  // hoặc
  revalidatePath('/tasks');        // Full Route Cache + Router Cache của path đó

  return task;
}
```

Ưu tiên **tag** hơn path: tag mô tả *dữ liệu*, path mô tả *trang*. Một thay đổi dữ liệu có thể ảnh hưởng nhiều trang, và bạn không muốn phải liệt kê chúng.

### Route Handler

```ts
// GET được cache nếu không dùng API dynamic; POST không bao giờ cache
export const dynamic = 'force-dynamic';   // tường minh khi cần luôn mới

export async function GET() {
  const tasks = await db.task.findMany();
  return Response.json(tasks);
}
```

### `searchParams` và `params` là Promise (Next 15)

```tsx
// Next 15 — breaking change so với 14
export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
}
```

## Example

```ts
// lib/tasks.ts — dùng chung, có tag
import { unstable_cache } from 'next/cache';

export const getTasks = unstable_cache(
  async (projectId: string) => db.task.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  }),
  ['tasks-by-project'],
  { tags: ['tasks'], revalidate: 300 },
);
```

```tsx
// app/tasks/page.tsx
export default async function Page() {
  const tasks = await getTasks('p1');       // cache 5 phút hoặc tới khi revalidateTag
  return <TaskList tasks={tasks} />;
}
```

```ts
// app/tasks/actions.ts
'use server';
export async function addTask(fd: FormData) {
  const input = CreateTask.parse(Object.fromEntries(fd));
  await db.task.create({ data: input });
  revalidateTag('tasks');                    // trang tự cập nhật
}
```

## Prediction

1. Ba component trong cùng một render gọi `fetch('/api/user/1')` — bao nhiêu HTTP request?
2. `fetch(url)` không có option trong Next 15 — được cache không? Trong Next 14?
3. `revalidateTag('tasks')` từ Server Action — Router Cache ở client có bị xoá?
4. Truy vấn `db.task.findMany()` trực tiếp (không qua `fetch`) — Data Cache có áp dụng?
5. Người dùng navigate `/tasks` → `/settings` → `/tasks` trong 10 giây — request thứ hai tới `/tasks` gọi server?
6. `revalidate = 60`, 500 request đồng thời sau khi hết hạn — bao nhiêu query DB?

<details>
<summary>Đáp án</summary>

1. Một — Request Memoization.
2. Next 15: không. Next 14: có (mặc định `force-cache`).
3. Có — `revalidateTag`/`revalidatePath` trong Server Action cũng làm mới Router Cache.
4. Không — Data Cache gắn với `fetch`. Cần `unstable_cache`.
5. Không nhất thiết — Router Cache giữ bản đã render trong bộ nhớ client.
6. Một — Next.js dedupe; các request khác nhận bản cũ trong lúc revalidate nền.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Sửa dữ liệu trong DB, reload trang có `force-cache` | Vẫn cũ tới khi revalidate |
| Thêm `revalidateTag` vào action | Cập nhật ngay |
| Bỏ `revalidateTag`, dùng `router.refresh()` ở client | Cũng cập nhật — nhưng chỉ cho user đó |
| Cache một fetch có dữ liệu phụ thuộc user (không có cookie) | Người dùng khác thấy dữ liệu của người đầu |
| Query DB trực tiếp, mong Data Cache hoạt động | Không cache — mỗi request một query |
| Navigate qua lại nhanh sau khi sửa dữ liệu | Router Cache trả bản cũ |
| `unstable_cache` với key không gồm tham số | Mọi tham số trả cùng kết quả |
| So sánh cùng code trên Next 14 và 15 | Behavior cache khác nhau — lý do phải ghim version |

Thí nghiệm thứ tư là lỗ hổng bảo mật, không chỉ là bug hiển thị.

## What Usually Goes Wrong

- **Cache dữ liệu phụ thuộc user** ở lớp dùng chung → lộ dữ liệu giữa các user.
- **Quên `revalidateTag` sau mutation** → UI không cập nhật.
- **Không biết Router Cache tồn tại** → "revalidate không hoạt động".
- **Dùng `revalidatePath` cho mọi thứ** → phải liệt kê mọi trang bị ảnh hưởng.
- **Query DB trực tiếp** rồi mong `revalidate` hoạt động.
- **Key của `unstable_cache` không gồm tham số** → trả sai dữ liệu.
- **Đọc tài liệu Next 14** khi dùng Next 15 (hoặc ngược lại) → mặc định khác nhau.
- **Cache lỗi** — một response 500 được cache với TTL dài.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Chỉ có một cache | Năm lớp, mỗi lớp vô hiệu khác nhau |
| `revalidateTag` xoá mọi cache | Nó xoá Data Cache + Full Route Cache; Router Cache được xoá khi gọi từ Server Action |
| Next 15 cache như Next 14 | Next 15 mặc định **không** cache `fetch` |
| Data Cache áp dụng cho mọi truy vấn | Chỉ `fetch` và `unstable_cache` |
| `cache: 'no-store'` là đủ để luôn mới | Vẫn có Full Route Cache và Router Cache |
| Router Cache có thể tắt hoàn toàn | Có thể điều chỉnh (`staleTimes`), nhưng thiết kế của nó là để có |
| Cache nghĩa là hiệu năng | Cache dữ liệu riêng tư là lỗ hổng bảo mật |

## Debugging

1. **Xác định lớp trước tiên**, theo thứ tự từ ngoài vào:
   ```text
   Hard reload (Ctrl+Shift+R) hết cũ?     → Browser/Router Cache
   curl trực tiếp thấy dữ liệu mới?        → cache ở client
   curl thấy cũ, restart server hết cũ?    → Full Route/Data Cache trong bộ nhớ
   Vẫn cũ sau restart?                     → Data Cache trên đĩa / CDN
   Query DB trực tiếp đúng?                → vấn đề ở tầng cache; nếu sai thì ở DB/logic
   ```
2. **`next build` output** cho biết route là static hay dynamic — nửa số vấn đề cache nằm ở đây.
3. Log trong `queryFn`/`fetch` wrapper để biết nó có **thật sự chạy** hay được cache.
4. `NEXT_PRIVATE_DEBUG_CACHE=1` (không chính thức, có thể đổi) hoặc thêm log quanh `unstable_cache` để quan sát hit/miss.
5. **Dữ liệu của người khác xuất hiện** → tìm ngay fetch được cache mà lẽ ra phụ thuộc user. Đây là ưu tiên bảo mật.
6. Trên Vercel/CDN, kiểm tra header `x-vercel-cache` hoặc `age` để biết response từ đâu.

## Production Considerations

- **Không bao giờ cache dữ liệu phụ thuộc user** ở lớp dùng chung. Nếu response phụ thuộc cookie, route phải dynamic.
- **Dùng tag, không dùng path** cho invalidation — nó theo dữ liệu, dễ bảo trì hơn.
- **Đặt `revalidate` theo từng loại dữ liệu**, không dùng một giá trị chung.
- **Ghim version Next.js** và đọc release note khi nâng cấp major — caching là phần thay đổi nhiều nhất.
- **Trên nhiều instance**, Data Cache mặc định là per-instance. Cần cache handler dùng chung (Redis) để nhất quán. Đây là bất ngờ lớn khi scale từ 1 lên N instance.
- **Không cache response lỗi**; kiểm tra `res.ok` trước khi trả về dữ liệu cache được.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `force-cache` + tag | nhanh, invalidate chính xác | phải nhớ revalidate ở mọi mutation |
| Không cache | luôn đúng, đơn giản | tải DB cao, TTFB chậm |
| `revalidate` TTL | tự động, đơn giản | dữ liệu cũ tới TTL |
| Tag-based | theo dữ liệu, dễ bảo trì | cần thiết kế tag |
| Path-based | trực quan | phải liệt kê mọi path bị ảnh hưởng |
| Cache handler dùng chung (Redis) | nhất quán giữa instance | thêm hạ tầng |

## Explain Without Notes

1. Kể năm lớp cache và cách vô hiệu mỗi lớp.
2. Request Memoization cho phép pattern kiến trúc nào trong RSC?
3. Vì sao `revalidateTag` "không hoạt động" từ góc nhìn người dùng, và nguyên nhân thật là gì?
4. Vì sao query DB trực tiếp không được Data Cache? Cách sửa?
5. Vì sao cache dữ liệu user là lỗ hổng bảo mật, không chỉ là bug?

## Related

- [Rendering strategies](04-rendering-strategies.md) — cache quyết định static/dynamic
- [Server/Client boundary](01-server-client-boundary.md) — nơi fetch chạy
- [Route Handlers & Server Actions](05-route-handlers-server-actions.md) — nơi gọi revalidate
- [HTTP & browser cache](../00-web-foundations/02-http-browser-cache.md) — lớp ngoài cùng
- [Server state & cache](../02-react/04-server-state-cache.md) — cache ở client
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — cùng bài toán ở tầng app
