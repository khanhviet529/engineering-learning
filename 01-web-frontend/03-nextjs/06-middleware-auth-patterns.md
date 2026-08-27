---
level: intermediate
area: frontend
prerequisites:
  - 05-route-handlers-server-actions.md
  - ../00-web-foundations/05-cookies-storage.md
related:
  - ../../02-backend-api/03-auth/02-session-vs-token.md
  - ../../05-cross-cutting/security/04-access-control.md
---

# Middleware & auth patterns

> Middleware chạy trước mọi request và là chỗ tốt để **redirect**. Nó là chỗ **tệ** để authorization thật. Nhầm hai việc này tạo ra một app trông có bảo mật mà không có.

*Baseline: Next.js 15, App Router.*

## Position

```text
Request → Middleware (edge, trước routing) → Route (layout → page / handler) → DB
              ↑ UX gate                          ↑ authorization THẬT ở đây
```

## Problem

Pattern phổ biến nhất và sai nhất:

```ts
// middleware.ts
export function middleware(req: NextRequest) {
  const token = req.cookies.get('session');
  if (!token) return NextResponse.redirect(new URL('/login', req.url));
  // ✅ "Xong, app được bảo vệ"
}
```

App này **không** được bảo vệ. Ba lý do:

1. Middleware chỉ kiểm tra **có cookie**, không kiểm tra cookie **hợp lệ**. Một cookie `session=anything` cũng qua.
2. Middleware không chạy cho mọi đường vào. Server Action, một số Route Handler pattern, và request nội bộ có thể bỏ qua nó tuỳ `matcher`.
3. Kể cả khi middleware đúng, nó không biết **user này có quyền với resource này** — nó chỉ thấy URL, chưa query database.

Kết quả điển hình: `/tasks/123` được middleware cho qua vì user đã đăng nhập, và page trả về task 123 dù nó thuộc người khác. Đây là [broken access control](../../05-cross-cutting/security/04-access-control.md) — hạng mục số một của OWASP.

## Mental Model

```text
Middleware       = "URL này có nên hiển thị cho người này không?"  → UX, redirect
Layout/Page      = "User này là ai?"                               → xác thực
Data layer       = "User này có quyền với RESOURCE này không?"      → authorization THẬT
```

Quy tắc:

> **Authorization phải ở nơi gần dữ liệu nhất.** Mọi tầng phía trên chỉ là tiện lợi cho người dùng.

Lý do: chỉ tầng dữ liệu biết resource thuộc về ai. Và chỉ nó là tầng mà **mọi** đường vào phải đi qua — Server Action, Route Handler, RSC, job nền.

Middleware chạy ở **edge runtime**: không có Node API, không có `pg`, không có Prisma, không đọc filesystem. Nên nó về mặt kỹ thuật cũng **không thể** query database để kiểm tra quyền.

## How It Works

### Middleware làm gì tốt

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // 1. Security header (áp dụng cho mọi response)
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 2. Request ID để correlate log
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('x-request-id', requestId);

  // 3. Redirect nhanh cho UX (KHÔNG phải bảo mật)
  const hasSession = req.cookies.has('session');
  const isAuthPage = req.nextUrl.pathname.startsWith('/login');

  if (!hasSession && !isAuthPage && req.nextUrl.pathname.startsWith('/app')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname);   // quay lại sau khi login
    return NextResponse.redirect(url);
  }

  // 4. i18n, A/B test, rewrite
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

`matcher` quan trọng cho hiệu năng: không có nó, middleware chạy cho **mọi** asset tĩnh.

### Authorization thật — ở tầng dữ liệu

```ts
// lib/dal.ts — Data Access Layer, mọi truy cập đi qua đây
import 'server-only';
import { cache } from 'react';

export const getSession = cache(async () => {
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  return verifySession(token);           // VERIFY, không chỉ kiểm tra tồn tại
});

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session.user;
}

// Authorization gắn với resource
export async function getTaskForUser(taskId: string) {
  const user = await requireUser();

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      OR: [
        { ownerId: user.id },
        { project: { members: { some: { userId: user.id } } } },
      ],
    },
  });

  if (!task) notFound();     // 404 chứ không 403 — không tiết lộ resource có tồn tại
  return task;
}
```

Hai điểm thiết kế quan trọng:

- **`cache()` quanh `getSession`** — nhiều component gọi nó trong cùng render chỉ verify một lần.
- **Authorization nằm trong query**, không phải kiểm tra sau khi query. `where: { id, ownerId }` không thể bị quên; `if (task.ownerId !== user.id)` thì có thể.
- **Trả 404 thay vì 403** cho resource không thuộc user — 403 tiết lộ rằng ID đó tồn tại.

### Dùng ở mọi đường vào

```tsx
// Server Component
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskForUser(id);      // authz bên trong
  return <TaskView task={task} />;
}
```

```ts
// Server Action
'use server';
export async function updateTask(id: string, data: unknown) {
  await getTaskForUser(id);                  // authz — cùng một hàm
  const input = UpdateTask.parse(data);
  await db.task.update({ where: { id }, data: input });
  revalidateTag('tasks');
}
```

```ts
// Route Handler
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskForUser(id);     // cùng một hàm
  return Response.json(task);
}
```

Một hàm, ba đường vào. Đây là điều làm authorization đáng tin: không có đường nào bỏ qua được.

### Session pattern

```text
Cookie HttpOnly + Secure + SameSite=Lax chứa session ID hoặc JWT ký
   ↓
Middleware: kiểm tra TỒN TẠI (nhanh, edge, cho UX)
   ↓
DAL: VERIFY chữ ký / tra database (chậm hơn, nhưng đúng)
```

Với JWT, verify được ở edge (dùng `jose`, không phải `jsonwebtoken` vốn cần Node API). Nhưng **revocation** vẫn cần một lần tra database hoặc Redis — JWT không thể bị thu hồi bằng chính nó. Xem [JWT & refresh token](../../02-backend-api/03-auth/03-jwt-refresh-token.md).

## Example

```tsx
// Ẩn UI không phải bảo vệ — nhưng vẫn cần cho UX
export default async function TaskActions({ task }: { task: Task }) {
  const user = await getSession();
  const canDelete = user?.id === task.ownerId;

  return (
    <>
      {canDelete && <DeleteButton taskId={task.id} />}
    </>
  );
}
```

```ts
// Và server VẪN kiểm tra — vì ẩn nút không chặn được curl
'use server';
export async function deleteTask(id: string) {
  const task = await getTaskForUser(id);           // ném nếu không có quyền
  if (task.ownerId !== (await requireUser()).id) throw new ForbiddenError();
  await db.task.delete({ where: { id } });
}
```

## Prediction

1. Middleware chỉ kiểm tra `cookies.has('session')`. Attacker set `session=garbage` và gọi `/app/dashboard` — qua được middleware không? Page thấy gì?
2. Middleware bảo vệ `/app/*`. Attacker gọi Server Action trực tiếp bằng `curl` — middleware có chạy?
3. Page dùng `db.task.findUnique({ where: { id } })` không có điều kiện owner. User A gọi `/tasks/<id-của-B>` — thấy gì?
4. Middleware cố `import { PrismaClient }` — điều gì xảy ra?
5. `getSession()` được gọi ở 6 component trong cùng render, có `cache()` — verify mấy lần? Không có `cache()`?
6. Trả 403 cho task không thuộc user — attacker học được gì mà 404 không cho biết?

<details>
<summary>Đáp án chọn lọc</summary>

1. Qua được middleware; page thấy gì phụ thuộc page có verify hay không. Nếu page tin middleware thì đây là lỗ hổng.
2. Tuỳ `matcher`; và kể cả khi chạy, nó không kiểm tra quyền với resource.
3. Thấy task của B — broken access control.
4. Build error hoặc runtime error — edge runtime không có Node API.
5. Một lần với `cache()`; sáu lần không có.
6. 403 xác nhận ID đó tồn tại — hữu ích cho attacker khi enumerate.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Set cookie `session=x` bằng DevTools, vào route được middleware "bảo vệ" | Qua được — middleware chỉ thấy sự tồn tại |
| Gọi Server Action bằng `curl` (action ID từ bundle), không cookie | Nếu action không có auth, nó chạy |
| Đổi ID trong URL sang ID của user khác | Nếu query thiếu điều kiện owner, bạn đọc được dữ liệu người khác |
| `import` Prisma vào middleware | Lỗi runtime/build — edge không có Node API |
| Bỏ `matcher` | Middleware chạy cho mọi asset; đo latency |
| Chỉ ẩn nút Delete, gọi action bằng `curl` | Xoá được — chứng minh ẩn UI không phải bảo vệ |
| Bỏ `cache()` quanh `getSession`, log số lần verify | Nhiều lần mỗi request |
| Trả 403 rồi thử enumerate ID | Phân biệt được ID tồn tại và không tồn tại |

Thí nghiệm 1, 2, 3, 6 nên chạy một lần trong lab. Chúng thay đổi cách bạn viết mọi endpoint sau đó.

## What Usually Goes Wrong

- **Tin middleware là authorization** → lỗ hổng nghiêm trọng nhất trong pattern này.
- **Chỉ kiểm tra cookie tồn tại**, không verify.
- **Authorization kiểm tra sau khi query** (`if (task.ownerId !== ...)`) → dễ quên ở một endpoint.
- **Query không có điều kiện owner** → IDOR (Insecure Direct Object Reference).
- **Server Action không kiểm tra quyền** vì "middleware đã lo".
- **Import Node API vào middleware**.
- **Không có `matcher`** → middleware chạy cho asset tĩnh.
- **403 thay vì 404** cho resource không thuộc user → tiết lộ thông tin.
- **Ẩn UI và coi là đã bảo vệ**.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Middleware bảo vệ app | Nó redirect; authorization ở tầng dữ liệu |
| Middleware chạy cho mọi request | Phụ thuộc `matcher`; và không thay thế kiểm tra ở endpoint |
| Middleware có thể query DB | Edge runtime không có Node API/driver DB |
| Kiểm tra ở layout là đủ | Layout không chạy lại cho mọi đường vào; và không biết resource nào |
| Ẩn nút = authorization | Client là môi trường không tin cậy |
| JWT verify được ở edge nên không cần DB | Revocation cần tra DB/Redis |
| Một lần kiểm tra ở tầng vào là đủ | Kiểm tra phải gắn với truy cập dữ liệu |

## Debugging

1. **Nghi thiếu authz** → thử bằng `curl` **không** có cookie, và với cookie của user khác. Đây là bước kiểm tra bắt buộc cho mọi endpoint mới.
2. **Middleware không chạy** → kiểm tra `matcher` regex; thêm `console.log` (xuất hiện ở terminal server).
3. **Redirect loop** → điều kiện middleware bao gồm cả trang đích (`/login`). Loại trừ nó tường minh.
4. **Lỗi lạ trong middleware** → gần như luôn là Node API trong edge runtime.
5. **Verify session nhiều lần** → bọc bằng `cache()` của React.
6. **Kiểm tra toàn bộ**: `grep -rn "findUnique\|findFirst" src/` và xác nhận mỗi query có điều kiện owner hoặc đi qua DAL.

## Production Considerations

- **Một Data Access Layer** (`lib/dal.ts`) với `import 'server-only'` là nơi duy nhất truy cập dữ liệu. Mọi đường vào dùng nó.
- **Authorization trong query**, không phải kiểm tra sau.
- **Middleware chỉ cho**: security header, request ID, redirect UX, i18n, rewrite.
- **Cookie**: `HttpOnly`, `Secure`, `SameSite=Lax`. Xem [Cookies & storage](../00-web-foundations/05-cookies-storage.md).
- **Rotate session ID sau login** (chống session fixation).
- **Log mọi lần từ chối** với user ID, resource ID, và request ID — đây là tín hiệu phát hiện tấn công.
- **Test authz như test chức năng**: mỗi endpoint có test "user khác không truy cập được".
- Nếu có backend riêng (NestJS), authorization nên ở đó và Next.js chỉ là client. Xem [Authorization models](../../02-backend-api/03-auth/06-authorization-models.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Middleware redirect | UX nhanh, ở edge | không phải bảo vệ; thêm latency cho mọi request |
| Authz ở DAL | không đường nào bỏ qua | phải kỷ luật đi qua DAL |
| Authz trong query | không quên được | query phức tạp hơn |
| Authz kiểm tra sau query | query đơn giản | dễ quên ở một endpoint |
| 404 cho resource không thuộc user | không tiết lộ | khó phân biệt "không có" và "không được phép" khi debug |

## Explain Without Notes

1. Middleware làm tốt việc gì và **không** làm được việc gì?
2. Vì sao authorization phải ở tầng gần dữ liệu nhất?
3. Vì sao `where: { id, ownerId }` tốt hơn `if (task.ownerId !== user.id)`?
4. Vì sao middleware không thể query database?
5. Vì sao trả 404 thay vì 403 cho resource của người khác?

## Related

- [Route Handlers & Server Actions](05-route-handlers-server-actions.md) — mọi đường vào cần authz
- [Cookies & storage](../00-web-foundations/05-cookies-storage.md) — session cookie
- [Session vs token](../../02-backend-api/03-auth/02-session-vs-token.md)
- [Authorization models](../../02-backend-api/03-auth/06-authorization-models.md) — RBAC, ownership, tenant
- [Access control](../../05-cross-cutting/security/04-access-control.md) — IDOR và cách phòng
- [CSP & browser security](../00-web-foundations/07-csp-browser-security.md) — header trong middleware
