---
level: intermediate
area: frontend
prerequisites:
  - 01-server-client-boundary.md
  - 03-data-fetching-cache.md
related:
  - ../02-react/10-forms.md
  - ../../02-backend-api/00-http-api/02-rest-api-contract.md
---

# Route Handlers & Server Actions

> Hai cách để code server chạy theo yêu cầu của client. Chúng không thay thế nhau — và Server Action **là một HTTP endpoint**, nên nó cần đúng những kiểm tra bảo mật mà một endpoint cần.

*Baseline: Next.js 15, App Router.*

## Position

```text
Client Component / form
   ↓
Server Action (RPC nội bộ)     |   Route Handler (HTTP endpoint công khai)
   ↓                                ↓
Domain logic → DB
```

## Problem

Bạn cần server làm một việc: tạo task, upload file, trả JSON cho một app mobile, nhận webhook từ Stripe.

Next.js cho hai công cụ, và chọn sai gây đau về sau: dùng Server Action cho API mà app mobile cần gọi (không được — nó không có hợp đồng công khai), hoặc dùng Route Handler cho mọi form (mất progressive enhancement và phải tự viết fetch).

Nguy hiểm hơn: nhiều người coi Server Action như một "hàm nội bộ" và **quên kiểm tra quyền** — vì nó trông giống một hàm TypeScript được gọi trực tiếp. Thực tế nó là một POST endpoint mà bất kỳ ai cũng gọi được.

## Mental Model

```text
Server Action                       Route Handler
'use server' + hàm async            app/api/*/route.ts
gọi như hàm từ client               gọi bằng fetch/HTTP
POST tự sinh, không có URL ổn định  URL công khai, ổn định
progressive enhancement (form)      không
revalidate dễ                       tự làm
CHỈ cho client của bạn              cho bất kỳ client
```

Cách chọn:

| Nhu cầu | Dùng |
|---|---|
| Form mutation trong app của bạn | **Server Action** |
| Cần hoạt động khi JS chưa tải | **Server Action** (với `<form action>`) |
| API cho mobile app / bên thứ ba | **Route Handler** |
| Webhook từ Stripe/GitHub | **Route Handler** |
| Trả file, stream, SSE | **Route Handler** |
| Cần method GET với cache | **Route Handler** |
| OAuth callback | **Route Handler** |

Câu chốt về bảo mật:

> **Server Action là một public HTTP endpoint.** Nó cần authentication, authorization và validation — giống hệt mọi endpoint khác.

## How It Works

### Server Action

```ts
// app/tasks/actions.ts
'use server';

import { revalidateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import { CreateTask } from '@/shared/schemas/task';

export async function createTask(formData: FormData) {
  // 1. Authentication — BẮT BUỘC, không phải tuỳ chọn
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  // 2. Validation — không tin dữ liệu từ client
  const parsed = CreateTask.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.flatten().fieldErrors };
  }

  // 3. Authorization — user này có quyền với resource này?
  const canAccess = await userCanAccessProject(session.user.id, parsed.data.projectId);
  if (!canAccess) throw new Error('Forbidden');

  // 4. Việc thật
  const task = await db.task.create({ data: { ...parsed.data, ownerId: session.user.id } });

  // 5. Làm mới cache
  revalidateTag('tasks');
  return { ok: true as const, task };
}
```

Bốn bước đầu là bắt buộc cho **mọi** action. Không có chúng, bạn có một endpoint không xác thực cho phép ghi vào database.

### Dùng với form — progressive enhancement

```tsx
// Server Component — form hoạt động cả khi JS chưa tải xong
export default function Page() {
  return (
    <form action={createTask}>
      <input name="title" required />
      <SubmitButton />
    </form>
  );
}
```

```tsx
// 'use client'
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus();       // đọc trạng thái form cha
  return <button disabled={pending}>{pending ? 'Đang lưu...' : 'Lưu'}</button>;
}
```

Đây là điều SPA thường mất: form submit được **trước** khi JavaScript tải xong. Với mạng chậm, đó là khác biệt thật.

### `useActionState` — nhận lỗi về UI

```tsx
'use client';
import { useActionState } from 'react';

const initial = { ok: false, errors: {} as Record<string, string[]> };

export function TaskForm() {
  const [state, action, pending] = useActionState(createTaskAction, initial);

  return (
    <form action={action}>
      <input name="title" aria-invalid={!!state.errors?.title} />
      {state.errors?.title && <p role="alert">{state.errors.title[0]}</p>}
      <button disabled={pending}>Lưu</button>
    </form>
  );
}
```

Chú ý: **trả về lỗi validation** (không `throw`) để hiện được ở UI. `throw` sẽ vào `error.tsx` và mất context field.

### Route Handler

```ts
// app/api/tasks/route.ts
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status');
  const tasks = await db.task.findMany({ where: { ownerId: session.user.id, status } });

  return Response.json(tasks, {
    headers: { 'Cache-Control': 'private, no-cache' },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateTask.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'VALIDATION', fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const task = await db.task.create({ data: parsed.data });
  return Response.json(task, { status: 201 });
}
```

### Webhook — cần verify signature

```ts
// app/api/webhooks/stripe/route.ts
export async function POST(req: NextRequest) {
  const body = await req.text();                       // TEXT, không phải json — cần raw
  const sig = req.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotent: event có thể được gửi lại
  await handleEventOnce(event.id, event);
  return Response.json({ received: true });
}
```

Ba điều bắt buộc cho webhook: đọc **raw body** (parse JSON trước sẽ làm signature sai), **verify signature**, và xử lý **idempotent** (mọi webhook provider đều gửi lại). Xem [Idempotency & retry](../../06-system-design/03-idempotency-retry.md).

## Example

```tsx
// Optimistic update với Server Action
'use client';
import { useOptimistic } from 'react';

export function TaskList({ tasks }: { tasks: Task[] }) {
  const [optimistic, addOptimistic] = useOptimistic(
    tasks,
    (state, newTitle: string) => [...state, { id: 'temp', title: newTitle, pending: true }],
  );

  return (
    <>
      <form action={async (fd) => {
        addOptimistic(fd.get('title') as string);   // hiện ngay
        await createTask(fd);                        // server; revalidate sẽ đồng bộ lại
      }}>
        <input name="title" />
      </form>
      <ul>{optimistic.map(t => <li key={t.id} data-pending={t.pending}>{t.title}</li>)}</ul>
    </>
  );
}
```

## Prediction

1. Server Action không kiểm tra `auth()` — ai gọi được nó?
2. Server Action `throw new Error('Forbidden')` — người dùng thấy gì? Message thật có xuống client ở production?
3. Trả `{ errors }` từ action vs `throw` — cái nào hiện được lỗi ở field?
4. `<form action={serverAction}>` với JavaScript bị tắt — form có hoạt động?
5. Webhook handler dùng `await req.json()` rồi verify signature — verify pass hay fail?
6. Server Action gọi `revalidateTag` — Router Cache của client có được làm mới?
7. Route Handler `GET` không dùng API dynamic nào — có bị cache?

<details>
<summary>Đáp án</summary>

1. Bất kỳ ai — nó là POST endpoint; attacker chỉ cần tìm action ID trong bundle.
2. Thấy `error.tsx`; message thật **không** xuống client ở production (chỉ có `digest`).
3. Trả về — `throw` mất context field.
4. Có — đó là progressive enhancement.
5. Fail — signature tính trên raw body; `req.json()` đã tiêu thụ và biến đổi stream.
6. Có.
7. Có thể — kiểm tra `next build` output.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Server Action không có `auth()`, gọi bằng `curl` với action ID lấy từ bundle | Ghi được vào DB mà không đăng nhập |
| Bỏ validation, gửi field lạ | Dữ liệu rác vào DB (hoặc mass assignment) |
| `throw` lỗi validation | Vào `error.tsx`, mất context field |
| Tắt JS trong DevTools, submit `<form action>` | Vẫn hoạt động |
| Cùng form nhưng dùng `onSubmit` + fetch, tắt JS | Không hoạt động |
| Webhook: `req.json()` trước verify | Signature luôn sai |
| Webhook không idempotent, provider gửi lại | Xử lý hai lần |
| Server Action trả về object có Date/class instance | Kiểm tra serialization |
| Bỏ `revalidateTag` sau mutation | UI không cập nhật |

Thí nghiệm đầu tiên nên được thực hiện một lần trong lab — nó thay đổi cách bạn nghĩ về Server Action.

## What Usually Goes Wrong

- **Server Action không kiểm tra auth/authz** — lỗ hổng nghiêm trọng nhất và phổ biến nhất, vì nó *trông* như hàm nội bộ.
- **Không validate input** trong action.
- **`throw` cho lỗi validation** → mất context field.
- **Webhook parse JSON trước verify signature**.
- **Webhook không idempotent**.
- **Dùng Server Action cho API mà bên thứ ba cần gọi** — không có hợp đồng ổn định.
- **Quên `revalidateTag`/`revalidatePath`** sau mutation.
- **Trả về giá trị không serialize được** từ action.
- **Không rate limit** action/handler → dễ bị abuse.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Server Action là hàm nội bộ, an toàn | Là POST endpoint công khai; cần auth/authz/validation |
| Server Action thay thế API routes | Không cho client bên ngoài, webhook, hoặc GET có cache |
| Chỉ dùng được với form | Gọi được từ bất kỳ Client Component |
| Server Action tự động an toàn vì có action ID | ID có trong bundle; không phải bí mật |
| Route Handler `GET` không bao giờ cache | Có thể cache; kiểm tra build output |
| `revalidatePath` chỉ ảnh hưởng server | Cũng làm mới Router Cache ở client |
| Message lỗi từ action hiện cho người dùng | Production chỉ gửi `digest` |

## Debugging

1. **Action không chạy** → Network tab, tìm POST tới cùng URL trang với header `Next-Action`. Xem status và response.
2. **Lỗi không hiện ở UI** → đang `throw` thay vì `return`. Chuyển sang trả về object lỗi.
3. **UI không cập nhật** → thiếu `revalidateTag`/`revalidatePath`, hoặc tag không khớp.
4. **Webhook luôn 400** → kiểm tra đọc raw body (`req.text()`) và secret đúng môi trường.
5. **Nghi thiếu authz** → thử gọi action/handler bằng `curl` không có cookie. Đây nên là một bước trong review.
6. **Lỗi serialization** → kiểm tra giá trị trả về; Date và plain object được, class instance thì không.

## Production Considerations

- **Mọi Server Action bắt đầu bằng auth + validation + authz.** Cân nhắc một wrapper để không thể quên:
  ```ts
  export const action = <T>(schema: ZodSchema<T>, fn: (input: T, session: Session) => Promise<unknown>) =>
    async (fd: FormData) => { /* auth, parse, gọi fn */ };
  ```
- **Rate limit** cho action và handler nhạy cảm. Xem [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md).
- **Webhook**: verify signature, raw body, idempotent, và trả 2xx nhanh (xử lý nặng đưa vào queue).
- **Log mọi mutation** với user ID và request ID.
- **Không đặt business logic trong action** — action là tầng vào; logic ở service. Xem [Controller–Service–Repository](../../02-backend-api/04-architecture/01-controller-service-repository.md).
- Nếu bạn có backend NestJS riêng, Server Action nên gọi API đó thay vì truy cập DB trực tiếp — giữ một nơi chứa domain logic.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Server Action | ít boilerplate, progressive enhancement, revalidate dễ | ràng buộc Next.js; không dùng cho client ngoài |
| Route Handler | hợp đồng HTTP công khai, dùng cho mọi client | tự viết fetch, tự revalidate |
| Cả hai | linh hoạt | hai đường vào phải bảo vệ như nhau |
| Action gọi DB trực tiếp | nhanh, ít tầng | logic có thể trùng với backend riêng |
| Action gọi API backend | một nguồn domain logic | thêm một network hop |

## Explain Without Notes

1. Vì sao Server Action cần auth/authz như một endpoint bình thường?
2. Bốn bước bắt buộc đầu tiên của một Server Action?
3. Progressive enhancement với `<form action>` nghĩa là gì?
4. Vì sao `throw` không phù hợp cho lỗi validation?
5. Ba yêu cầu bắt buộc cho một webhook handler?

## Related

- [Server/Client boundary](01-server-client-boundary.md) — `'use server'` và serialization
- [Data fetching & cache](03-data-fetching-cache.md) — revalidate sau mutation
- [Forms](../02-react/10-forms.md) — dùng action với form
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — thiết kế Route Handler
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz đúng cách
- [Idempotency & retry](../../06-system-design/03-idempotency-retry.md) — webhook
- [Rate limiting](../../02-backend-api/00-http-api/07-rate-limiting.md)
