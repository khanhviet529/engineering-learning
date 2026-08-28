---
level: foundation
area: frontend
prerequisites: []
related:
  - 02-type-system.md
  - ../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md
---

# TypeScript ↔ runtime boundary

> Type nói `user.email` là `string`. Runtime nói `undefined`. Cả hai đều đúng — và hiểu vì sao là điều quan trọng nhất về TypeScript.

## Position

```text
Compile time: TypeScript kiểm tra type → XOÁ HẾT type
                        ↓
Runtime: chỉ còn JavaScript. Không có type nào tồn tại.
   ↑ mọi dữ liệu từ bên ngoài vào đây mà không được kiểm tra
```

## Problem

```ts
type User = { id: string; email: string };

const res = await fetch('/api/user');
const user: User = await res.json();     // ← lời hứa, không phải kiểm tra

user.email.toLowerCase();                // TypeScript: OK
                                         // Runtime: Cannot read properties of undefined
```

TypeScript **không** kiểm tra gì ở dòng `await res.json()`. `res.json()` trả `Promise<any>`, và bạn vừa dán nhãn `User` lên nó. Không có validation nào xảy ra.

Đây là lỗ hổng lớn nhất trong hiểu biết về TypeScript, và nó là nguồn của phần lớn lỗi runtime trong codebase "đã có type đầy đủ".

## Mental Model

```text
┌─────────────── Compile time ────────────────┐
│  type, interface, generic, as, satisfies    │
│  → kiểm tra tính nhất quán TRONG code bạn   │
│  → rồi BỊ XOÁ HOÀN TOÀN                     │
└─────────────────────────────────────────────┘
                    ↓ tsc
┌─────────────── Runtime ─────────────────────┐
│  chỉ còn JavaScript                         │
│  typeof, instanceof, Array.isArray, in      │
│  → đây là những thứ THẬT SỰ kiểm tra        │
└─────────────────────────────────────────────┘
```

Câu chốt:

> **TypeScript đảm bảo code của bạn nhất quán với chính nó. Nó không đảm bảo gì về dữ liệu đến từ bên ngoài.**

"Bên ngoài" gồm: HTTP response, request body, database row, `JSON.parse`, `localStorage`, biến môi trường, query param, file, message từ queue, và mọi thứ AI sinh ra mà bạn chưa kiểm tra.

Ở mọi ranh giới đó, bạn cần **validation runtime**, không phải type annotation.

```text
Bên ngoài ──[ validate ]──→ Bên trong
             ↑ Zod/class-validator: kiểm tra THẬT
                                     ↑ TypeScript: đủ dùng ở đây
```

## How It Works

### Cái gì bị xoá, cái gì còn lại

```ts
// Bị xoá hoàn toàn
type A = { x: number };
interface B { y: string }
function f<T>(t: T): T { return t; }        // <T> biến mất
const c = x as User;                        // `as User` biến mất
const d = y satisfies Config;               // biến mất
declare module 'x' {}                       // biến mất

// Còn lại lúc runtime
enum E { A, B }                             // sinh ra một object thật
class C { }                                 // là JS class
const g = <T,>(t: T) => t;                  // hàm còn, generic mất
```

`enum` và `class` là hai thứ *sinh ra code*. Đó là lý do `const enum` và `import type` tồn tại — để nói rõ "cái này chỉ dùng lúc compile, đừng emit".

```ts
import type { User } from './types';   // đảm bảo bị xoá; không tạo import runtime
import { schema } from './schema';     // giữ lại
```

`import type` quan trọng thực tế: một `import` bình thường chỉ để lấy type vẫn tạo ra một import runtime, có thể kéo cả module vào bundle hoặc gây circular dependency.

### `as` là lời hứa, không phải kiểm tra

```ts
const n = '5' as unknown as number;   // compile OK
n.toFixed(2);                          // runtime crash
```

`as` nói với compiler "tin tôi". Nếu bạn sai, không ai bắt được.

Ba mức độ nguy hiểm:

| Cú pháp | Ý nghĩa | Rủi ro |
|---|---|---|
| `x satisfies T` | kiểm tra x khớp T, **giữ nguyên** type cụ thể của x | An toàn — nên dùng |
| `const x: T = ...` | kiểm tra và mở rộng thành T | An toàn |
| `x as T` | ép, không kiểm tra | Nguy hiểm |
| `x as unknown as T` | ép qua hai bước để bỏ mọi cảnh báo | Rất nguy hiểm |

`satisfies` (TS 4.9+) là công cụ hay bị bỏ qua:

```ts
const routes = {
  home: '/',
  user: '/user/:id',
} satisfies Record<string, string>;

routes.home;   // type là '/' — giá trị cụ thể, không bị mở rộng thành string
// Với `const routes: Record<string,string>` thì routes.home chỉ là string
```

### Validation ở ranh giới

```ts
import { z } from 'zod';

const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
});

type User = z.infer<typeof User>;      // type SINH RA từ schema — một nguồn sự thật

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return User.parse(await res.json());  // ← kiểm tra THẬT; throw nếu sai
}
```

Điểm quan trọng của pattern này: `type` được **suy ra từ** schema, không viết song song. Viết cả hai bằng tay là chuyện chắc chắn sẽ lệch nhau.

### `strict` mode

Không có `strict: true`, TypeScript cho phép `undefined` ở mọi nơi và giá trị của nó giảm mạnh:

```jsonc
{
  "compilerOptions": {
    "strict": true,                        // bắt buộc
    "noUncheckedIndexedAccess": true,      // arr[0] có type T | undefined — đúng với thực tế
    "exactOptionalPropertyTypes": true,    // phân biệt "thiếu key" và "key = undefined"
    "noImplicitOverride": true
  }
}
```

`noUncheckedIndexedAccess` gây khó chịu lúc đầu nhưng bắt được một lớp bug thật: `arr[i]` **có thể** là `undefined` và TypeScript mặc định nói dối về điều đó.

## Example

```ts
// ❌ Ba ranh giới không được kiểm tra
const port: number = process.env.PORT as any;     // thực ra là string | undefined
const cfg: Config = JSON.parse(raw);              // any
const rows: User[] = await db.query(sql);         // driver trả any

// ✅ Validate một lần, tin cậy về sau
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']),
});
export const env = Env.parse(process.env);   // fail lúc khởi động, không phải lúc 3h sáng
```

Validate env lúc khởi động là một trong những thay đổi có tỉ lệ giá trị/công sức cao nhất trong một service. Nó biến một lỗi runtime ngẫu nhiên thành một lỗi deploy tức thì.

## Prediction

1. `const n = '5' as unknown as number; n.toFixed(2)` — compile? runtime?
2. `JSON.parse('{"a":1}')` có type gì? Nó "an toàn" không?
3. `const arr: number[] = []; arr[0].toFixed()` — compile được không? Với `noUncheckedIndexedAccess` thì sao?
4. `enum Color { Red }` — sau compile còn code không? Còn `type Color = 'red'`?
5. `process.env.PORT` có type gì? Nó có thể là `undefined` không?
6. `satisfies` khác `as` ở đâu về mặt an toàn?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Trả JSON thiếu field mà type khai báo bắt buộc | Không có lỗi cho đến khi truy cập → crash ở nơi xa nguồn lỗi |
| `as` một type sai hoàn toàn | Compile pass, runtime crash |
| Bỏ `strict: false` rồi gọi method trên biến có thể null | Không cảnh báo |
| Dùng `arr[10]` trên mảng 3 phần tử | `undefined`; bật `noUncheckedIndexedAccess` để thấy TS bắt được |
| Đọc `process.env.MISSING` và dùng như string | `undefined` lan xuống, lỗi ở tầng khác |
| Thêm Zod ở ranh giới rồi gửi payload sai | Lỗi rõ ràng, đúng chỗ, có thông báo field nào sai |
| `import { User } from './types'` (không `import type`) trong file có circular dep | Có thể `undefined` lúc runtime |

## What Usually Goes Wrong

- **Tin `res.json()`** — nguồn số một của lỗi runtime trong app "typed".
- **`as` để làm compiler im lặng** thay vì sửa mô hình dữ liệu.
- **`any` lan** — một `any` ở ranh giới làm mất type check của cả một nhánh code.
- **Không validate `process.env`** — service khởi động thành công rồi lỗi khi dùng tới config đó.
- **Viết type và validation schema riêng** → hai nguồn sự thật, chắc chắn lệch.
- **Tin type của ORM** — nếu bạn `SELECT` một tập cột khác, type vẫn nói đủ.
- **Tắt `strict`** để "cho nhanh" — mất phần lớn giá trị của TypeScript.
- **Type từ AI generate** trông đúng nhưng không khớp API thật. Xem [Hallucination & verification](../../../09-ai-assisted-development/04-hallucination-verification.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| TypeScript kiểm tra dữ liệu lúc chạy | Không có type nào tồn tại lúc chạy |
| `as` là ép kiểu (như cast trong Java) | Là lời hứa không được kiểm tra |
| API có type nghĩa là response an toàn | Type chỉ là kỳ vọng của bạn về response |
| `interface` an toàn hơn `type` | Cả hai bị xoá; khác nhau về declaration merging và hiệu năng compile |
| TypeScript làm chậm runtime | Bị xoá hết; zero runtime cost (trừ enum/class) |
| `strict` chỉ là "khó tính hơn" | Không có nó, `null`/`undefined` không được kiểm tra chút nào |
| Zod thay thế TypeScript | Bổ sung: Zod ở ranh giới, TypeScript bên trong |

## Debugging

1. **`Cannot read properties of undefined`** trên dữ liệu "đã có type" → tìm ranh giới gần nhất nơi dữ liệu vào (`fetch`, `JSON.parse`, `db.query`, `process.env`). Lỗi gần như luôn ở đó, không ở nơi crash.
2. Log **dữ liệu thật** ở ranh giới và so với type. Chúng thường khác nhau ở những chỗ nhỏ: `null` vs `undefined`, số dạng string, ngày dạng string.
3. `grep -rn " as " src/ | grep -v "as const"` → danh sách những chỗ bạn đã yêu cầu compiler tin mình. Bug thường ở đó.
4. Bật `noImplicitAny`, `strictNullChecks` và xem số lỗi — đó là bản đồ nợ kỹ thuật.
5. Dùng `satisfies` thay `as` ở đâu có thể; nhiều `as` sẽ tự biến thành lỗi compile thật.

## Production Considerations

- **Validate ở mọi ranh giới**: request body, response từ service ngoài, message queue, env, dữ liệu từ storage.
- **Validate env lúc khởi động** và fail nhanh. Container không start là lỗi tốt hơn 500 lúc 3h sáng.
- **Sinh type từ schema** (Zod `infer`) hoặc từ OpenAPI/GraphQL, không viết tay hai bản.
- **Bật `strict` cho code mới**, migrate dần code cũ bằng `// @ts-expect-error` (có tài liệu) thay vì `any`.
- Ở backend, dùng `class-validator` + `ValidationPipe` của NestJS ở tầng vào. Xem [Validation & errors](../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Validate mọi ranh giới | bug xuất hiện đúng chỗ, sớm | thêm code, chi phí runtime nhỏ |
| Tin type, không validate | ít code | bug xuất hiện xa nguồn, khó truy |
| Type suy ra từ schema | một nguồn sự thật | ràng buộc vào một validation library |
| `strict: true` | bắt nhiều bug | migrate code cũ tốn công |
| `noUncheckedIndexedAccess` | bắt lỗi index thật | nhiều `!` hoặc guard hơn |

## Explain Without Notes

1. TypeScript đảm bảo điều gì và **không** đảm bảo điều gì?
2. Kể 5 ranh giới nơi dữ liệu vào mà không được kiểm tra.
3. `as` khác `satisfies` thế nào về an toàn?
4. Vì sao nên sinh type từ schema thay vì viết cả hai?
5. `import type` giải quyết hai vấn đề gì?

## Related

- [TypeScript type system](02-type-system.md) — dùng type để mô hình hoá miền dữ liệu
- [Advanced types](03-advanced-types.md) — generic, mapped, conditional
- [Validation & errors (NestJS)](../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — validation ở backend
- [Error model](../../../02-backend-api/00-http-api/05-error-model.md) — trả lỗi validation cho client
- [Modules & bundling](../fundamentals/02-modules-bundling.md) — `import type` và circular dependency
- [Configuration](../../../02-backend-api/04-architecture/05-configuration.md) — validate env
