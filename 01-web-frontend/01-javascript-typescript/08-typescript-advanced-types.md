---
level: advanced
area: frontend
prerequisites:
  - 07-typescript-type-system.md
related:
  - 02-typescript-runtime-boundary.md
---

# Generics, mapped & conditional types

> Công cụ để một type **suy ra từ** type khác thay vì được viết lại. Giá trị thật của chúng là loại bỏ sự lệch nhau giữa các định nghĩa song song.

## Position

```text
Compile time: [generic → mapped type → conditional type → template literal]
   ↑ note này — tầng "type sinh ra type"
```

## Problem

```ts
type User       = { id: string; email: string; name: string; createdAt: Date };
type UserCreate = { email: string; name: string };                  // viết lại
type UserUpdate = { email?: string; name?: string };                 // viết lại
type UserPublic = { id: string; name: string };                      // viết lại
```

Bốn định nghĩa cho một khái niệm. Thêm field `avatar` vào `User` — bạn phải nhớ sửa ba chỗ khác. Bạn sẽ quên. Compiler không nhắc, vì cả bốn đều hợp lệ độc lập.

Đó là bài toán mà mapped type giải quyết: **một nguồn sự thật, các biến thể được suy ra**.

```ts
type UserCreate = Omit<User, 'id' | 'createdAt'>;
type UserUpdate = Partial<UserCreate>;
type UserPublic = Pick<User, 'id' | 'name'>;
```

Giờ thêm `avatar` vào `User` là cả ba tự cập nhật.

## Mental Model

Nghĩ về type như một **hàm chạy lúc compile**:

```text
Generic            = tham số        →  type Box<T> = { value: T }
Mapped type        = map            →  { [K in keyof T]: ... }
Conditional type   = if/else        →  T extends X ? A : B
infer              = destructure    →  T extends Array<infer U> ? U : never
Template literal   = string concat  →  `on${Capitalize<K>}`
```

Với bộ này bạn có một ngôn ngữ hàm thuần đầy đủ ở tầng type. Điều đó vừa mạnh vừa nguy hiểm — xem phần Trade-offs.

## How It Works

### Generic constraint

```ts
// Không constraint: không làm được gì với T
function first<T>(arr: T[]): T | undefined { return arr[0]; }

// Có constraint: biết T có gì
function byId<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find(i => i.id === id);
}

// Constraint giữa hai tham số — bảo đảm K là key thật của T
function get<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
get(user, 'email');    // type: string
get(user, 'nope');     // ❌ lỗi compile
```

`K extends keyof T` là pattern hữu ích nhất trong thực tế: nó biến typo tên field thành lỗi build.

### Mapped type

```ts
type Optional<T>  = { [K in keyof T]?: T[K] };
type Immutable<T> = { readonly [K in keyof T]: T[K] };
type Nullable<T>  = { [K in keyof T]: T[K] | null };

// Đổi tên key bằng `as` + template literal
type Getters<T> = { [K in keyof T & string as `get${Capitalize<K>}`]: () => T[K] };
// Getters<{ name: string }> → { getName: () => string }

// Lọc key theo type của value
type StringKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];
// StringKeys<User> → 'id' | 'email' | 'name'
```

Kỹ thuật `{...}[keyof T]` để lọc key là idiom cần nhận ra: map mọi key thành `K` hoặc `never`, rồi lấy union của các value — `never` tự biến mất khỏi union.

### Utility type có sẵn

```ts
Partial<T>           // mọi field optional
Required<T>          // mọi field bắt buộc
Readonly<T>          // mọi field readonly
Pick<T, K>           // chỉ giữ K
Omit<T, K>           // bỏ K
Record<K, V>         // { [k in K]: V }
Exclude<U, X>        // bỏ X khỏi union U
Extract<U, X>        // chỉ giữ phần của U khớp X
NonNullable<T>       // bỏ null | undefined
ReturnType<F>        // type trả về của hàm
Parameters<F>        // tuple tham số
Awaited<T>           // unwrap Promise (đệ quy)
```

Lưu ý: `Omit` **không** kiểm tra key có tồn tại. `Omit<User, 'emial'>` (typo) không báo lỗi — nó chỉ trả về `User`. Phiên bản an toàn:

```ts
type StrictOmit<T, K extends keyof T> = Omit<T, K>;
```

Đây là một bẫy thật: một typo trong `Omit` âm thầm giữ lại field bạn tưởng đã bỏ.

### Conditional type + `infer`

```ts
type ElementOf<T>  = T extends readonly (infer U)[] ? U : never;
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

// Phân phối trên union (distributive) — hành vi mặc định khi kiểm tra một naked type param
type ToArray<T> = T extends any ? T[] : never;
type R = ToArray<string | number>;      // string[] | number[]  (KHÔNG phải (string|number)[])

// Chặn phân phối bằng cách bọc trong tuple
type NoDistribute<T> = [T] extends [any] ? T[] : never;
type R2 = NoDistribute<string | number>;   // (string | number)[]
```

Distributive conditional type là nguồn kết quả bất ngờ số một khi viết type nâng cao. Nhớ: nếu bên trái là *naked type parameter*, conditional type sẽ phân phối trên union.

### Template literal type

```ts
type Method = 'get' | 'post';
type Path   = '/users' | '/tasks';
type Route  = `${Uppercase<Method>} ${Path}`;   // 'GET /users' | 'GET /tasks' | 'POST /users' | ...

// Parse param từ path
type Params<S extends string> =
  S extends `${string}:${infer P}/${infer Rest}` ? P | Params<Rest>
  : S extends `${string}:${infer P}`            ? P
  : never;

type P = Params<'/users/:userId/tasks/:taskId'>;   // 'userId' | 'taskId'
```

Kỹ thuật cuối cho type-safe routing: URL sai thành lỗi compile.

## Example

```ts
// Bài toán thật: type-safe event emitter
type Events = {
  'task.created': { id: string; title: string };
  'task.deleted': { id: string };
};

class Emitter<E extends Record<string, unknown>> {
  private handlers: { [K in keyof E]?: Array<(p: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void) {
    (this.handlers[event] ??= []).push(fn);
  }

  emit<K extends keyof E>(event: K, payload: E[K]) {
    this.handlers[event]?.forEach(fn => fn(payload));
  }
}

const bus = new Emitter<Events>();
bus.on('task.created', (p) => p.title);       // p được suy ra chính xác
bus.emit('task.deleted', { id: '1' });        // ✅
bus.emit('task.deleted', { title: 'x' });     // ❌ lỗi compile
bus.on('task.unknown', () => {});             // ❌ lỗi compile
```

Đây là ví dụ tốt vì nó cho thấy giá trị thật: một bảng khai báo `Events` duy nhất, và mọi call site được kiểm tra.

## Prediction

1. `ToArray<string | number>` — `(string|number)[]` hay `string[] | number[]`?
2. `Omit<User, 'emial'>` (typo) — lỗi compile hay trả về `User`?
3. `Partial<Required<Partial<T>>>` tương đương gì?
4. `Awaited<Promise<Promise<string>>>` là gì?
5. `keyof { a: 1, b: 2 }` là gì? Còn `keyof any`?
6. `StringKeys<T>` với `T = { a: string; b: number }` cho ra gì, và `never` biến đi đâu?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Viết `UserCreate` bằng tay, rồi thêm field vào `User` | Lệch nhau, không ai báo |
| Đổi sang `Omit<User, ...>`, thêm field | Tự cập nhật |
| Typo trong `Omit<T, 'xyz'>` | Không lỗi — bug im lặng |
| Conditional type đệ quy sâu (>50 mức) | `Type instantiation is excessively deep` |
| Type-level "tính toán" phức tạp trên union 1000 phần tử | Compile chậm rõ rệt; đo bằng `--extendedDiagnostics` |
| Bỏ constraint `K extends keyof T` | Typo key không bị bắt |
| Dùng `any` trong generic default | Type check mất tác dụng ở call site |

## What Usually Goes Wrong

- **Định nghĩa song song** thay vì suy ra → lệch nhau khi schema đổi.
- **Type quá thông minh** — đúng nhưng không ai trong team sửa được. Type là code; code không đọc được là nợ.
- **`Omit` với typo** không bị bắt.
- **Không lường distributive behavior** → kết quả sai một cách khó hiểu.
- **Compile chậm** vì conditional type đệ quy trên union lớn.
- **Generic không constraint** → `T` không làm được gì, phải `as` bên trong.
- **Dùng generic khi chỉ cần union** — thêm phức tạp không thêm bảo đảm.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Generic như generic của Java | Là hàm compile-time, có conditional và đệ quy |
| Conditional type áp dụng cho cả union một lần | Phân phối trên từng phần tử nếu là naked type param |
| `Omit` kiểm tra key tồn tại | Không |
| Type nâng cao không ảnh hưởng hiệu năng | Ảnh hưởng **thời gian compile** đáng kể |
| `keyof T` gồm cả method | Gồm mọi key, kể cả method |
| Mapped type giữ được modifier | Cần `+`/`-` tường minh để thêm/bỏ `?` và `readonly` |
| Nhiều generic = API linh hoạt hơn | Thường chỉ khó dùng hơn |

## Debugging

1. Hover không đủ → dùng type "expander":
   ```ts
   type Expand<T> = T extends object ? { [K in keyof T]: T[K] } : T;
   type Check = Expand<UserCreate>;    // hover thấy shape phẳng
   ```
2. Test type như test code:
   ```ts
   type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
   type Assert<T extends true> = T;
   type _t1 = Assert<Equals<Params<'/a/:id'>, 'id'>>;    // fail build nếu sai
   ```
   Type test nên nằm trong repo và chạy trong CI.
3. `Type instantiation is excessively deep` → giảm đệ quy, hoặc thêm bộ đếm độ sâu.
4. Compile chậm → `tsc --extendedDiagnostics`, xem *Instantiations*. Số hàng triệu là dấu hiệu type quá phức tạp.
5. Lỗi khó đọc → tách type lớn thành các type nhỏ có tên; thông báo lỗi sẽ dùng tên đó.

## Production Considerations

- **Ưu tiên sinh type từ nguồn sự thật** (Zod, Prisma, OpenAPI codegen) hơn là viết type nâng cao bằng tay. Nó ít thông minh hơn nhưng đúng hơn và bền hơn.
- **Đặt trần độ phức tạp**: nếu một type cần comment để hiểu, nó có thể quá phức tạp cho code sản phẩm.
- **Type test trong CI** cho các utility type dùng chung.
- **Theo dõi thời gian `tsc`** — nó ảnh hưởng trực tiếp tốc độ vòng feedback của cả team.
- Dùng `satisfies` để giữ type cụ thể thay vì mở rộng bằng annotation.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Suy ra type từ một nguồn | không lệch nhau | gián tiếp, khó đọc hơn khi mới nhìn |
| Viết type tường minh | rõ ràng, hover đẹp | phải cập nhật nhiều chỗ |
| Type nâng cao | bảo đảm mạnh | compile chậm, khó bảo trì |
| Codegen | đúng theo nguồn | thêm bước build |

## Explain Without Notes

1. Vấn đề nào mapped type giải quyết? Cho ví dụ với 4 biến thể của `User`.
2. Distributive conditional type là gì, và cách chặn?
3. `infer` dùng để làm gì? Cho ví dụ.
4. Vì sao `Omit` với typo là bẫy?
5. Khi nào **không** nên viết type nâng cao?

## Related

- [TypeScript type system](07-typescript-type-system.md) — nền tảng
- [TypeScript ↔ runtime boundary](02-typescript-runtime-boundary.md) — type không bảo vệ dữ liệu ngoài
- [REST API contract](../../02-backend-api/00-http-api/02-rest-api-contract.md) — type chia sẻ giữa FE và BE
- [Custom hooks](../02-react/11-custom-hooks.md) — generic trong hook
