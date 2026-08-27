---
level: intermediate
area: backend
prerequisites:
  - ../../01-web-frontend/01-javascript-typescript/06-modules-bundling.md
related:
  - ../02-nestjs/02-modules-di.md
  - 05-graceful-shutdown.md
---

# Module system trong Node

> `Nest can't resolve dependencies of TasksService (?)`. Không phải lỗi DI — đó là circular import, và dấu `?` nghĩa là một module đã được đánh giá **một nửa** khi ai đó cần nó.

Note này là góc **Node runtime + build backend**. Góc bundler/tree-shaking (barrel file, code splitting) ở [Modules & bundling](../../01-web-frontend/01-javascript-typescript/06-modules-bundling.md) — đọc note đó trước.

## Position

```text
Source .ts → tsc/swc → .js (CJS hay ESM?) → Node resolution → module graph
                                                    ↓
                                  thứ tự đánh giá → decorator chạy → DI container
```

## Problem

Năm lỗi, một gốc — **thứ tự và danh tính của module lúc runtime**:

```text
1. ERR_MODULE_NOT_FOUND        — đường dẫn đúng, file có thật
2. Cannot use import statement outside a module
3. ERR_REQUIRE_ESM
4. Reflect.getMetadata is not a function
5. Nest can't resolve dependencies of X (?)   ← circular import
```

Lỗi 5 tốn nhiều giờ nhất vì thông báo không nói gì về nguyên nhân. Dấu `?` ở vị trí tham số nghĩa là: khi container hỏi "type của tham số này là gì?", nó nhận được `undefined` — vì module chứa type đó đang ở giữa quá trình đánh giá.

## Mental Model

Node phân giải **specifier** thành **một file cụ thể**, lúc runtime:

```text
Ba loại specifier
  './repo.js'        relative  → theo đường dẫn file
  'node:fs'          builtin   → luôn thắng, không đi tìm
  '@app/tasks'       bare      → đi bộ lên cây node_modules
```

Với bare specifier, Node đi từ folder của file hiện tại lên gốc:

```text
/app/src/tasks/service.js  cần  'pg'
  → /app/src/tasks/node_modules/pg
  → /app/src/node_modules/pg
  → /app/node_modules/pg          ← tìm thấy
  → /node_modules/pg
```

Từ đây suy ra một hệ quả quan trọng: **danh tính của module là đường dẫn file đã phân giải, không phải tên package.**

```text
/app/node_modules/pg                    ← service A dùng
/app/node_modules/orm/node_modules/pg   ← service B dùng
→ HAI module khác nhau, hai connection pool, hai instance của mọi singleton
```

Đây là nguyên nhân của `instanceof` thất bại một cách bí ẩn, và của `reflect-metadata` "không hoạt động" khi có hai bản.

### CJS và ESM đánh giá khác nhau

```text
CJS   require() → đồng bộ, chạy ngay tại dòng đó
      cache theo đường dẫn đã phân giải
      module.exports là một OBJECT có thể đọc dở

ESM   ba pha tách rời:
      1. construction  — đọc & parse toàn bộ graph (chưa chạy code nào)
      2. instantiation — nối các binding (live binding, chưa có giá trị)
      3. evaluation    — chạy code, theo thứ tự depth-first
```

Vì ESM biết cả graph **trước khi** chạy dòng nào, nó xử lý circular import tốt hơn CJS — nhưng vẫn không cứu được mọi trường hợp.

### Circular import — vì sao nó vỡ DI

```text
A.js:  const B = require('./B');  class A { constructor(b: B) {} }
B.js:  const A = require('./A');  class B { constructor(a: A) {} }

Node bắt đầu từ A:
  1. đưa A vào cache với module.exports = {}   ← RỖNG
  2. chạy A → gặp require('./B')
  3. chạy B → gặp require('./A')
  4. A đã có trong cache → trả về {} RỖNG (A chưa chạy xong!)
  5. B thấy A là undefined
```

Bước 4 là mấu chốt: cache được điền **trước khi** module chạy xong, để chống đệ quy vô hạn. Giá phải trả là một module có thể quan sát được trạng thái dở dang của module khác.

Với NestJS, `undefined` đó chảy vào metadata của decorator → container không biết inject gì → `(?)`.

## How It Works

### `exports` và `imports` trong package.json

```json
{
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" },
    "./testing": "./dist/testing.mjs"
  },
  "imports": {
    "#config": "./src/config/index.js"
  }
}
```

- `exports` **đóng** package: path không khai báo thì không import được, dù file tồn tại. Đây là lý do `import 'pkg/dist/internal/x'` đột nhiên fail sau khi upgrade.
- Thứ tự key **có ý nghĩa** — `types` phải đứng đầu.
- `imports` (`#config`) là subpath nội bộ — thay thế được cho alias của tsconfig mà **không** cần bước build viết lại đường dẫn.

### TypeScript cho backend — bảng quyết định

Đây là chỗ gây nhiều lỗi nhất, vì `tsconfig` quyết định output là CJS hay ESM:

| Mục tiêu | `module` | `moduleResolution` | Đuôi trong import |
|---|---|---|---|
| CJS (mặc định của NestJS) | `commonjs` | `node` | không cần |
| ESM thật | `nodenext` | `nodenext` | **bắt buộc `.js`** |
| Chỉ type-check, bundler emit | `preserve`/`esnext` | `bundler` | không cần |

Điều gây bất ngờ nhất khi chuyển sang ESM: bạn viết đuôi `.js` trong file `.ts`.

```ts
// File là service.ts, nhưng import trỏ tới đường dẫn SAU KHI COMPILE
import { TaskRepository } from './task.repository.js';   // ✅ đúng
import { TaskRepository } from './task.repository';      // ❌ ERR_MODULE_NOT_FOUND
```

### Decorator và `reflect-metadata`

NestJS/TypeORM dựa vào metadata do TypeScript emit:

```jsonc
{
  "emitDecoratorMetadata": true,       // emit type của tham số
  "experimentalDecorators": true       // decorator "legacy" — cái NestJS dùng
}
```

```ts
// main.ts — PHẢI là import đầu tiên, trước mọi module có decorator
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
```

Ba điều kiện phải đủ, thiếu một là `Reflect.getMetadata is not a function` hoặc metadata rỗng:

1. `reflect-metadata` được import **trước** khi bất kỳ decorator nào chạy;
2. chỉ có **một** bản `reflect-metadata` trong cây dependency;
3. `emitDecoratorMetadata: true`.

Và một cảnh báo về TC39 decorators (chuẩn mới, `experimentalDecorators: false`): chúng **không** emit metadata theo cách NestJS cần. Với NestJS 10/11, giữ `experimentalDecorators: true`.

### Import type — hai vấn đề

```ts
import type { User } from './user.entity';        // bị XOÁ hoàn toàn khi compile
import { UserService } from './user.service';     // giữ lại → import runtime thật
```

`import type` giải quyết hai thứ:

1. **Không kéo module vào bundle/runtime** chỉ để lấy type.
2. **Phá vòng lặp import** — nếu A cần B chỉ để làm type, `import type` làm vòng lặp biến mất ở runtime.

Nhưng cẩn thận với NestJS: nếu type đó cũng được dùng làm **token DI** (tham số constructor), `import type` sẽ xoá nó và container mất metadata. Khi đó cần `forwardRef`, không phải `import type`.

### Phá vòng lặp — bốn cách, theo thứ tự ưu tiên

```text
1. Tách phần dùng chung ra module thứ ba     ← sửa thiết kế, tốt nhất
2. import type (nếu chỉ cần làm type)
3. Đảo phụ thuộc: dùng interface + event thay vì gọi trực tiếp
4. forwardRef (NestJS)                        ← băng cứu thương, không phải cách sửa
```

```ts
// 4. Khi buộc phải dùng
@Injectable()
export class TasksService {
  constructor(
    @Inject(forwardRef(() => ProjectsService))
    private readonly projects: ProjectsService,
  ) {}
}
```

`forwardRef` làm code chạy được nhưng vòng lặp vẫn còn — nó là dấu hiệu hai module đang gánh cùng một trách nhiệm. Xem [Modules & DI](../02-nestjs/02-modules-di.md).

## Example

```ts
// ❌ Vòng lặp: A → B → A
// task.service.ts
import { ProjectService } from './project.service';
export class TaskService {
  constructor(private projects: ProjectService) {}
  async archive(id: string) { await this.projects.touch(id); }
}
// project.service.ts
import { TaskService } from './task.service';
export class ProjectService {
  constructor(private tasks: TaskService) {}
  async close(id: string) { await this.tasks.archive(id); }
}

// ✅ Tách phần dùng chung — không còn vòng lặp
// task-archiver.ts  (không import service nào)
export class TaskArchiver { async archive(id: string) { /* ... */ } }
// cả TaskService và ProjectService đều chỉ phụ thuộc TaskArchiver
```

## Prediction

1. `import './repo'` trong project ESM Node, file `repo.js` có thật — chạy được?
2. Hai bản `pg` ở hai tầng `node_modules` — bao nhiêu connection pool?
3. CJS: A require B, B require A. B nhận được `module.exports` của A là gì?
4. `import 'reflect-metadata'` đặt **sau** `import { AppModule }` — metadata thế nào?
5. Package có `exports` không khai báo `./internal`, bạn import nó — kết quả?
6. `import type { X }` cho một class dùng làm token DI trong constructor — container thấy gì?
7. `experimentalDecorators: false` với NestJS 11 — decorator hoạt động?
8. `forwardRef` được thêm vào — vòng lặp còn không?

<details>
<summary>Đáp án</summary>

1. Không — `ERR_MODULE_NOT_FOUND`; ESM cần đuôi tường minh `./repo.js`.
2. Hai — module identity là đường dẫn đã phân giải, không phải tên package.
3. `{}` rỗng — A chưa chạy xong khi B đọc nó.
4. Rỗng hoặc `Reflect.getMetadata is not a function` — decorator trong `AppModule` đã chạy trước khi polyfill được nạp.
5. Lỗi resolution — `exports` đóng package.
6. `undefined` — type bị xoá lúc compile, mất metadata. Cần `forwardRef`.
7. Không như mong đợi — TC39 decorators không emit metadata NestJS cần.
8. Còn — `forwardRef` chỉ hoãn việc phân giải, không sửa thiết kế.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ đuôi `.js` trong project ESM | `ERR_MODULE_NOT_FOUND` dù file tồn tại |
| Tạo vòng lặp A↔B, log `typeof B` ở đầu A | `undefined` |
| Cùng vòng lặp trong NestJS | `Nest can't resolve dependencies of A (?)` |
| Cài hai version của một package (`npm ls pg`) | `instanceof` thất bại giữa hai instance |
| Di chuyển `import 'reflect-metadata'` xuống dưới | Metadata rỗng |
| Đặt `emitDecoratorMetadata: false` | Container không suy ra được type tham số |
| `import type` cho một DI token | `(?)` trong thông báo lỗi |
| `require()` một package ESM-only | `ERR_REQUIRE_ESM` |
| Import đường dẫn không có trong `exports` | Resolution error |
| Thêm `forwardRef` rồi chạy `madge --circular src/` | Vòng lặp vẫn được báo |

## What Usually Goes Wrong

- **Circular import** → `undefined` lúc runtime, và trong NestJS là `(?)`. Nguyên nhân số một.
- **`forwardRef` dùng như cách sửa** thay vì dấu hiệu cần tách module.
- **Thiếu đuôi `.js`** khi bật ESM cho TypeScript.
- **`reflect-metadata` import không phải dòng đầu**.
- **Hai bản cùng package** → singleton nhân đôi, `instanceof` sai.
- **Trộn CJS/ESM** trong monorepo có nhiều `package.json`.
- **`import type` cho DI token** → mất metadata.
- **Barrel file (`index.ts`) trong backend** → tăng khả năng tạo vòng lặp, và làm thứ tự đánh giá khó đoán.
- **Alias tsconfig mà runtime không hiểu** → chạy `ts-node` được, `node dist/` thì không (cần `tsconfig-paths` hoặc `imports` của package.json).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Module identity là tên package | Là đường dẫn file đã phân giải |
| `forwardRef` sửa circular dependency | Nó chỉ hoãn phân giải; vòng lặp vẫn còn |
| ESM không có circular import problem | Tốt hơn CJS, nhưng vẫn vỡ được |
| Alias tsconfig hoạt động lúc runtime | `tsc` không viết lại đường dẫn |
| `import type` luôn an toàn | Xoá mất DI token |
| Vòng lặp chỉ là vấn đề style | Nó gây `undefined` lúc runtime |
| `require.cache` theo tên module | Theo đường dẫn đã phân giải |
| TC39 decorators thay được legacy decorators | Không emit metadata NestJS cần |

## Debugging

1. **`Nest can't resolve dependencies of X (?)`** → đếm vị trí `?` trong danh sách tham số; đó là tham số bị `undefined`. Rồi tìm vòng lặp.
2. **Tìm vòng lặp tự động**: `npx madge --circular --extensions ts src/`. Đây là bước đầu tiên, không phải bước cuối.
3. **Xác nhận `undefined`**: thêm `console.log('B is', typeof B)` ở đầu module A. Nếu `undefined` → vòng lặp.
4. **Hai bản package**: `npm ls <pkg>` / `pnpm why <pkg>`. Nhiều dòng = nhiều bản.
5. **Module là CJS hay ESM?** Kiểm tra đuôi file + `"type"` trong `package.json` **gần nhất**. Bước này hay bị bỏ và là gốc của lỗi 2, 3.
6. **Xem Node phân giải ra file nào**: `node --experimental-import-meta-resolve`, hoặc `require.resolve('pkg')` trong CJS.
7. **Metadata rỗng** → xác nhận `import 'reflect-metadata'` là dòng đầu của entrypoint, và chỉ có một bản.

## Production Considerations

- **Chọn một module system cho cả repo** và ghi vào tài liệu. Trộn lẫn tốn rất nhiều giờ.
- **NestJS: giữ CJS** (`module: commonjs`, `experimentalDecorators: true`) trừ khi có lý do cụ thể. ESM + decorator + monorepo là tổ hợp nhiều ma sát.
- **`madge --circular` trong CI**, fail build khi có vòng lặp mới. Đây là biện pháp có ROI cao nhất trong note này — nó chặn bug trước khi nó thành `(?)` lúc 3h sáng.
- **Tránh barrel file trong backend** — nó vừa tăng khả năng vòng lặp vừa làm thứ tự đánh giá khó đoán.
- **`imports` của package.json** (`#config`) thay cho alias tsconfig, để runtime và compile hiểu giống nhau.
- **Lock dependency** và kiểm tra trùng bản (`npm dedupe`, `pnpm` dùng chung store).
- **`import 'reflect-metadata'` là dòng đầu** của entrypoint, không nằm trong module nào khác.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| CJS cho backend | tương thích rộng, decorator ổn định | không tree-shake, không phải chuẩn |
| ESM cho backend | chuẩn, top-level await | phải ghi đuôi `.js`, ma sát với decorator |
| Tách module thứ ba | xoá vòng lặp thật | thêm file, phải thiết kế lại |
| `forwardRef` | chạy được ngay | vòng lặp còn đó, coupling ẩn |
| `imports` package.json | runtime và compile khớp nhau | cú pháp `#` lạ với người mới |
| Barrel file | import gọn | dễ tạo vòng lặp, thứ tự khó đoán |

## Explain Without Notes

1. Danh tính của một module trong Node là gì? Hệ quả khi có hai bản cùng package?
2. Vì sao CJS trả về `{}` rỗng trong circular import? Bước nào gây ra?
3. Vì sao circular import biến thành `(?)` trong NestJS?
4. Bốn cách phá vòng lặp, và vì sao `forwardRef` ở cuối?
5. Ba điều kiện để `reflect-metadata` hoạt động?
6. Vì sao ESM trong TypeScript bắt bạn viết đuôi `.js`?

## Related

- [Modules & bundling](../../01-web-frontend/01-javascript-typescript/06-modules-bundling.md) — góc bundler: tree-shaking, barrel file, code splitting
- [Modules & DI (NestJS)](../02-nestjs/02-modules-di.md) — nơi circular import biến thành lỗi DI
- [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md) — cái gì bị xoá lúc compile
- [Node runtime & concurrency](01-node-runtime-concurrency.md) — runtime nạp module này
- [Controller–Service–Repository](../04-architecture/01-controller-service-repository.md) — layering đúng giảm vòng lặp
- [Configuration](../04-architecture/05-configuration.md) — `imports` cho config path
