---
level: intermediate
area: frontend
prerequisites:
  - 01-runtime-boundary.md
related:
  - 03-advanced-types.md
---

# TypeScript type system

> Mục tiêu không phải "làm compiler im lặng". Mục tiêu là **làm cho state sai không biểu diễn được** — khi đó cả một lớp bug trở thành lỗi compile.

## Position

```text
Compile time: [structural typing → inference → narrowing → discriminated union]
   ↑ note này. Runtime: xem 02-typescript-runtime-boundary.md
```

## Problem

Đoạn này compile sạch nhưng có bốn state vô nghĩa:

```ts
type State = {
  loading: boolean;
  data?: User;
  error?: string;
};
```

`{ loading: true, data: user, error: 'x' }` — đang load, có data, và có lỗi? Nghĩa là gì?

Vấn đề không phải thiếu type. Vấn đề là type **cho phép** những tổ hợp không tồn tại trong thực tế. Mỗi tổ hợp vô nghĩa là một chỗ để bug trú.

## Mental Model

Nghĩ về một type như **tập các giá trị hợp lệ**:

```text
string           → vô hạn giá trị
'a' | 'b'        → đúng 2 giá trị
boolean          → 2
never            → 0 (không giá trị nào — dùng để chứng minh "không thể tới đây")
unknown          → tất cả (nhưng phải narrow trước khi dùng)
any              → tắt kiểm tra (không phải "tất cả" — là "đừng kiểm tra")
```

Từ đó: **union = hợp tập**, **intersection = giao**.

```ts
type A = { a: string };
type B = { b: number };
type U = A | B;    // có A HOẶC B → chỉ đọc được thuộc tính chung (không có gì)
type I = A & B;    // có CẢ hai → đọc được cả a và b
```

Nhầm lẫn phổ biến: `|` nghe như "ít hơn" nhưng cho *nhiều* giá trị hơn; `&` nghe như "nhiều hơn" nhưng cho *ít* giá trị hơn (yêu cầu khắt khe hơn).

### Structural typing

TypeScript so **hình dạng**, không so tên:

```ts
type Point = { x: number; y: number };
type Vec = { x: number; y: number };
const p: Point = { x: 1, y: 2 };
const v: Vec = p;             // OK — cùng hình dạng
```

Hệ quả: một `UserId` và một `PostId` (cả hai là `string`) hoàn toàn thay thế nhau được — nguồn bug thật. Cách chặn là **branded type**:

```ts
type UserId = string & { readonly __brand: 'UserId' };
type PostId = string & { readonly __brand: 'PostId' };

const asUserId = (s: string) => s as UserId;

function getUser(id: UserId) {}
getUser(postId);      // ❌ lỗi compile — đúng như mong đợi
```

Brand không tồn tại lúc runtime (nó là intersection với một type ảo), nên chi phí bằng 0.

### Discriminated union — công cụ quan trọng nhất

Sửa ví dụ ở đầu:

```ts
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User }
  | { status: 'error'; error: string };
```

Bây giờ:

- `{ status: 'loading', data: user }` là **lỗi compile**;
- truy cập `state.data` khi `status === 'loading'` là **lỗi compile**;
- state vô nghĩa **không biểu diễn được**.

```ts
switch (state.status) {
  case 'idle':    return null;
  case 'loading': return <Spinner />;
  case 'success': return <List items={state.data} />;   // data chắc chắn có
  case 'error':   return <Error msg={state.error} />;   // error chắc chắn có
}
```

Cộng thêm exhaustiveness check để compiler bắt khi bạn thêm state mới mà quên xử lý:

```ts
default: {
  const _exhaustive: never = state;    // lỗi compile nếu còn case chưa xử lý
  throw new Error(`unhandled: ${JSON.stringify(state)}`);
}
```

Đây là kỹ thuật có giá trị cao nhất trong note này: thêm một state mới vào union sẽ làm **mọi** chỗ xử lý thiếu trở thành lỗi build.

## How It Works

### Narrowing

TypeScript thu hẹp type theo luồng điều khiển:

```ts
function f(x: string | number | null) {
  if (x === null) return;              // x: string | number
  if (typeof x === 'string') {
    x.toUpperCase();                   // x: string
  } else {
    x.toFixed(2);                      // x: number
  }
}
```

Các cách narrow: `typeof`, `instanceof`, `in`, so sánh literal, `Array.isArray`, truthiness, và **type predicate**:

```ts
function isUser(v: unknown): v is User {
  return typeof v === 'object' && v !== null && 'id' in v;
}
```

Chú ý: `v is User` là **lời hứa của bạn**. Nếu hàm kiểm tra không đủ, TypeScript vẫn tin — giống `as`. Đây là lý do Zod tốt hơn type predicate viết tay cho dữ liệu bên ngoài.

### `unknown` thay cho `any`

```ts
function handle(e: unknown) {           // catch cho ra unknown
  if (e instanceof Error) return e.message;   // buộc phải narrow
  return String(e);
}
```

`unknown` là "tôi không biết" — an toàn, vì bạn phải chứng minh trước khi dùng. `any` là "đừng kiểm tra" — không an toàn, và nó *lan* sang mọi biểu thức chứa nó.

Quy tắc: dùng `unknown` ở mọi nơi bạn định dùng `any`.

### `type` vs `interface`

| | `type` | `interface` |
|---|---|---|
| Union, intersection, conditional | có | không |
| Declaration merging | không | có |
| Khai báo trùng tên | lỗi | tự gộp |
| Dùng cho object shape | được | được |
| Thông báo lỗi | có thể dài hơn | thường gọn hơn |

Thực tế: dùng `type` làm mặc định (linh hoạt hơn); dùng `interface` khi cần mở rộng từ bên ngoài (khai báo thêm vào type của một library).

### `readonly`, `as const`

```ts
const roles = ['admin', 'user'] as const;      // readonly ['admin', 'user']
type Role = typeof roles[number];              // 'admin' | 'user'
```

Pattern này tạo union type **từ** một array runtime — một nguồn sự thật cho cả validation và type.

## Example

```ts
// Mô hình hoá: một task chỉ có assignee khi đã được assign
type Task =
  | { state: 'draft'; title: string }
  | { state: 'open'; title: string; assigneeId: UserId }
  | { state: 'done'; title: string; assigneeId: UserId; completedAt: Date };

// Không thể tạo task 'done' mà thiếu completedAt.
// Không thể đọc completedAt của task 'open'.
// Quy tắc nghiệp vụ được compiler thực thi, không phải bằng code review.
```

So sánh với `{ state: string; assigneeId?: string; completedAt?: Date }` — version đó cho phép 8 tổ hợp, trong đó 5 là vô nghĩa.

## Prediction

1. `type U = {a: string} | {b: number}` — đọc `u.a` được không? Vì sao?
2. `type I = {a: string} & {a: number}` — `I['a']` là gì?
3. Với discriminated union, truy cập `state.data` khi `status === 'loading'` — lỗi compile hay runtime?
4. Bạn thêm `{ status: 'cancelled' }` vào union nhưng không sửa `switch`. Với `never` check — có lỗi build không? Không có nó?
5. `UserId` và `PostId` đều là `string` không brand — truyền lẫn được không?
6. `const x = ['a','b']` — `typeof x[number]` là gì? Còn với `as const`?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dùng boolean flags cho state (`loading`/`error`/`data`) | Đếm số tổ hợp vô nghĩa có thể tạo được |
| Đổi sang discriminated union | Các tổ hợp đó thành lỗi compile |
| Thêm một state mới vào union, không có `never` check | Build pass, UI thiếu case im lặng |
| Thêm `never` check rồi làm lại | Build fail đúng chỗ cần sửa |
| Truyền `PostId` vào hàm nhận `UserId` (không brand) | Compile OK — bug thật |
| Type predicate kiểm tra thiếu (`v is User` chỉ check `'id' in v`) | TS tin bạn; runtime vẫn crash |
| Dùng `any` cho một biến rồi theo dõi nó qua 5 hàm | Type check biến mất trên cả nhánh |

## What Usually Goes Wrong

- **Boolean flags thay vì union** → state vô nghĩa biểu diễn được.
- **`any` để đi tiếp** → mất kiểm tra trên cả nhánh code.
- **Optional (`?`) bừa bãi** → mỗi `?` nhân đôi số state; dùng union thay vì nhiều optional.
- **Thiếu exhaustiveness check** → thêm case mới không ai bắt.
- **Type predicate không đầy đủ** → an toàn giả.
- **Type quá phức tạp** → compile chậm, lỗi khó đọc, đồng nghiệp không sửa được. Type khó hơn code mà nó bảo vệ là lỗ.
- **`string` cho mọi ID** → hoán vị ID lẫn nhau.
- **Không dùng `unknown` trong `catch`** → coi mọi lỗi là `Error` (nhưng JS có thể throw bất cứ gì).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `|` cho ít giá trị hơn | Union cho **nhiều** giá trị hơn, nên **ít** thao tác an toàn hơn |
| `interface` "chuẩn" hơn `type` | Khác biệt nhỏ; `type` linh hoạt hơn |
| `unknown` và `any` như nhau | `unknown` buộc narrow; `any` tắt kiểm tra |
| Nhiều type = an toàn hơn | Type mô hình hoá sai còn tệ hơn ít type |
| Structural typing là hạn chế | Nó là tính năng; brand khi cần nominal |
| Type predicate là kiểm tra thật | Là lời hứa, như `as` |
| `readonly` chặn thay đổi lúc runtime | Chỉ compile time; `Object.freeze` mới là runtime |

## Debugging

1. **Lỗi type dài** → đọc **dòng cuối** trước ("Type X is not assignable to Y"), rồi đi lên. Phần giữa thường là chi tiết đệ quy.
2. Hover để xem type thật; hoặc buộc compiler hiện ra:
   ```ts
   type Debug<T> = { [K in keyof T]: T[K] };   // "mở" type ra khi hover
   ```
3. Kiểm tra một giả định về type:
   ```ts
   type Assert<T extends true> = T;
   type _ = Assert<Equals<MyType, Expected>>;   // fail compile nếu sai
   ```
4. `tsc --noEmit --extendedDiagnostics` để tìm type gây compile chậm.
5. Narrowing không hoạt động → thường vì giá trị được truy cập qua getter, hoặc bị "làm mới" sau một lần gọi hàm (TS mất narrowing sau closure boundary).

## Production Considerations

- **`strict: true`** là điều kiện tiên quyết cho mọi thứ trong note này.
- **Discriminated union cho mọi async state** — đây là thay đổi có ROI cao nhất trong code frontend.
- **Brand cho ID** trong domain có nhiều loại ID.
- **Sinh type từ nguồn sự thật**: Zod schema, OpenAPI, Prisma, GraphQL codegen.
- **Giữ type đơn giản đủ để đồng nghiệp sửa được.** Type-level metaprogramming là nợ nếu chỉ một người hiểu.
- Type check phải nằm trong CI (`tsc --noEmit`), không chỉ trong IDE.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Discriminated union | state sai không biểu diễn được | verbose hơn boolean flags |
| Branded type | không hoán vị ID | cần hàm chuyển đổi ở ranh giới |
| Type phức tạp | bảo đảm mạnh | compile chậm, lỗi khó đọc |
| `any` | đi tiếp nhanh | mất kiểm tra, bug về sau |
| Sinh type tự động | luôn khớp nguồn | thêm bước build |

## Explain Without Notes

1. Vì sao union cho nhiều giá trị nhưng ít thao tác an toàn hơn?
2. Discriminated union sửa vấn đề gì của boolean flags? Cho ví dụ.
3. Exhaustiveness check bằng `never` hoạt động thế nào và bắt được lỗi gì?
4. Structural typing gây bug gì với ID, và brand sửa thế nào?
5. Vì sao `unknown` tốt hơn `any` trong `catch`?

## Related

- [TypeScript ↔ runtime boundary](01-runtime-boundary.md) — type không kiểm tra dữ liệu ngoài
- [Advanced types](03-advanced-types.md) — generic, mapped, conditional
- [Server state & cache](../../02-react/behavior/04-server-state-cache.md) — async state dưới dạng union
- [Error model](../../../02-backend-api/00-http-api/05-error-model.md) — mô hình hoá lỗi bằng union
- [API & interface design](../../../02-backend-api/00-http-api/02-rest-api-contract.md)
