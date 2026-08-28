---
level: intermediate
area: frontend
prerequisites:
  - ../async-concurrency/01-event-loop-async.md
related:
  - ../typescript/01-runtime-boundary.md
  - ../../03-nextjs/behavior/01-server-client-boundary.md
---

# Module system & bundling

> `Cannot use import statement outside a module`, `require is not defined`, `ERR_REQUIRE_ESM`. Ba lỗi, một nguyên nhân: JavaScript có hai hệ module không tương thích hoàn toàn, và bạn đang ở giữa.

## Position

```text
Source (.ts/.tsx) → tsc/swc → bundler (webpack/turbopack/vite) → bundle
                                    ↓
                           Browser (ESM) | Node (ESM hoặc CJS)
                                    ↑ note này
```

## Problem

Bạn thêm một package và build fail. Hoặc chạy được ở dev, chết ở production. Hoặc bundle của bạn 2MB dù chỉ dùng một hàm từ một library.

Nguyên nhân gốc là lịch sử: Node tạo CommonJS trước khi JavaScript có module chuẩn. Sau đó ESM ra đời. Hai hệ tồn tại song song và khác nhau ở một điểm căn bản — **thời điểm giải quyết dependency** — nên chúng không thể hoà trộn hoàn toàn.

## Mental Model

```text
CommonJS (CJS)                       ESM
require('x')                         import x from 'x'
đồng bộ, chạy lúc runtime            tĩnh, phân tích được lúc build
có thể gọi trong if, trong hàm       phải ở top level
module.exports là một object động    export là binding sống (live)
__dirname, __filename có sẵn         import.meta.url
```

Điểm quyết định: **ESM là tĩnh.** Bundler đọc `import` mà không chạy code, nên nó biết chính xác cái gì được dùng. Đó là điều kiện cho **tree-shaking**.

```ts
require(someCondition ? 'a' : 'b')   // CJS: chỉ biết lúc chạy → không tree-shake được
import { a } from './lib'            // ESM: biết lúc build → loại bỏ b, c, d
```

Hệ quả một chiều: **ESM import được CJS, nhưng CJS không thể `require` ESM** (vì `require` đồng bộ, ESM có thể có top-level `await`). Đây là toàn bộ nội dung của lỗi `ERR_REQUIRE_ESM`.

## How It Works

### Node quyết định CJS hay ESM thế nào

Theo thứ tự:

1. `.mjs` → ESM. `.cjs` → CJS.
2. `.js` → xem `"type"` trong `package.json` gần nhất: `"module"` = ESM, `"commonjs"` hoặc không có = CJS.

Lỗi thường gặp:

| Lỗi | Nghĩa |
|---|---|
| `Cannot use import statement outside a module` | File được xử lý như CJS nhưng chứa `import` → thêm `"type": "module"` hoặc đổi sang `.mjs` |
| `require is not defined` | File là ESM nhưng dùng `require` |
| `ERR_REQUIRE_ESM` | CJS đang `require` một package chỉ có ESM → dùng dynamic `import()` |
| `ERR_MODULE_NOT_FOUND` với đường dẫn đúng | ESM cần **đuôi file tường minh**: `./util.js`, không phải `./util` |

Điều cuối gây bất ngờ nhất khi chuyển TypeScript sang ESM: bạn viết `import './util.js'` trong file `.ts` — đúng, vì đường dẫn là đường dẫn *sau khi compile*.

### `exports` trong package.json

Package hiện đại khai báo nhiều entry point:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./server": { "import": "./dist/server.mjs" }
  }
}
```

Hai điều quan trọng:

- Thứ tự trong object **có ý nghĩa** — `types` phải đứng đầu.
- `exports` **đóng** package: đường dẫn không được khai báo sẽ không import được, dù file có tồn tại. Đây là lý do `import 'pkg/dist/internal/x'` đột nhiên fail sau khi package upgrade.

### Tree-shaking cần gì

Ba điều kiện, thiếu một là không hiệu quả:

1. **ESM** (không phải CJS).
2. **Không có side effect** ở top level của module — hoặc khai báo `"sideEffects": false` trong package.json.
3. **Import cụ thể**, không import cả namespace.

```ts
import { debounce } from 'lodash';        // ❌ CJS → kéo cả lodash (~70KB)
import debounce from 'lodash/debounce';   // ✅ chỉ file cần
import { debounce } from 'lodash-es';     // ✅ ESM, tree-shake được
```

Side effect ngăn tree-shaking vì bundler không dám xoá: nếu module đăng ký polyfill hay CSS khi được load, xoá nó là đổi behavior.

### Dynamic import và code splitting

```ts
// Tạo một chunk riêng, chỉ tải khi dòng này chạy
const { Chart } = await import('./chart');
```

Đây là cơ chế của `React.lazy` và `next/dynamic`. Nó biến một bundle lớn thành nhiều bundle nhỏ theo route hoặc theo tương tác.

## Example

```ts
// ❌ Barrel file: index.ts re-export mọi thứ
// import { Button } from '@/components'  → có thể kéo cả 200 component
export * from './Button';
export * from './Modal';
export * from './Chart';      // Chart kéo theo một chart library 300KB

// ✅ Import trực tiếp
import { Button } from '@/components/Button';
```

Barrel file là nguồn bundle phình to phổ biến nhất trong dự án lớn, và cũng là nguồn build chậm — vì mỗi import kéo cả graph.

## Prediction

1. `import { debounce } from 'lodash'` — bundle tăng bao nhiêu? Còn `'lodash/debounce'`?
2. CJS file `require('some-esm-only-package')` — lỗi gì? Cách sửa?
3. `import './util'` trong ESM Node — chạy được không?
4. Package có `"exports"` không khai báo `./internal`, bạn import nó — kết quả?
5. Module có `console.log` ở top level, không được import ở đâu dùng tới — bundler có xoá không?
6. `await import('./big')` trong một event handler — chunk `big` được tải lúc nào?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Import cả namespace của một util library | Chạy bundle analyzer, so sánh trước/sau |
| Trộn `require` và `import` trong cùng file | Build error hoặc behavior lạ |
| `require` một package ESM-only | `ERR_REQUIRE_ESM` |
| Bỏ đuôi `.js` trong ESM Node | `ERR_MODULE_NOT_FOUND` dù file có thật |
| Thêm side effect vào top level module | Tree-shaking ngừng loại bỏ nó |
| Tạo barrel file re-export 50 module rồi import 1 thứ | Bundle và thời gian build tăng rõ rệt |
| Import code chỉ dành cho server vào Client Component | Bundle chứa code server, hoặc build fail. Xem [Server/Client boundary](../../03-nextjs/behavior/01-server-client-boundary.md) |
| Import vòng (A → B → A) | Một bên nhận `undefined` lúc runtime — bug rất khó thấy |

## What Usually Goes Wrong

- **Barrel file** làm bundle phình và build chậm.
- **Import cả library** thay vì hàm cần dùng.
- **Circular import** → `undefined` tại thời điểm chạy, thường biểu hiện như "class không tồn tại". Trong NestJS thì là DI lỗi — xem [Modules & DI](../../../02-backend-api/02-nestjs/behavior/02-modules-di.md).
- **Trộn CJS/ESM** trong monorepo với nhiều `package.json`.
- **Thiếu đuôi file** khi bật ESM cho TypeScript.
- **Code server lọt vào client bundle** — không chỉ là vấn đề kích thước, mà có thể **lộ secret**.
- **`"sideEffects"` khai báo sai** → bundler xoá code cần thiết (thường là CSS import).
- **Nhiều bản của cùng một package** trong node_modules → bundle chứa 2 bản React, hook lỗi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| ESM và CJS thay thế nhau được | ESM import được CJS; ngược lại thì không (đồng bộ vs async) |
| Tree-shaking tự động luôn hiệu quả | Cần ESM + không side effect + import cụ thể |
| Barrel file chỉ là tổ chức code | Có thể tăng bundle và thời gian build đáng kể |
| `import` được hoist nên đặt đâu cũng như nhau | Đúng về hoisting; nhưng thứ tự side effect vẫn theo thứ tự import |
| Bundler xoá code không dùng | Chỉ khi chứng minh được là không có side effect |
| `"type": "module"` chỉ ảnh hưởng cú pháp | Nó đổi cả resolution: cần đuôi file, không có `__dirname` |
| Dynamic import luôn tốt hơn | Thêm round-trip; xấu nếu dùng cho code cần ngay |

## Debugging

1. **Bundle to** → chạy analyzer: `next build` + `@next/bundle-analyzer`, hoặc `vite-bundle-visualizer`. Xem treemap: package nào chiếm chỗ, và **vì sao nó được import** (analyzer chỉ được đường import).
2. **Lỗi module** → xác định file đó là CJS hay ESM trước (đuôi file + `"type"` gần nhất). Đây là bước bị bỏ qua nhiều nhất.
3. **`undefined` lúc runtime từ một import** → nghi circular import. Vẽ đường import, hoặc dùng `madge --circular src/`.
4. **Nhiều bản package** → `npm ls react` / `pnpm why react`.
5. **Code server trong client bundle** → search bundle output cho một chuỗi định danh (ví dụ tên biến env). Nếu tìm thấy, bạn có cả bug kích thước và bug bảo mật.
6. **Build chậm** → nghi barrel file; thử import trực tiếp và đo lại.

## Production Considerations

- **Đặt ngân sách bundle** và fail CI khi vượt. Không có ngân sách thì bundle chỉ tăng.
- **Code splitting theo route** là mặc định trong Next.js; thêm split theo tương tác cho component nặng (chart, editor, map).
- **Không import barrel** trong code dùng nhiều; import trực tiếp.
- Đặt code chỉ dành cho server vào file có ranh giới rõ (`*.server.ts`) hoặc dùng `server-only` package để build fail sớm nếu bị import sai.
- Trong monorepo, thống nhất **một** module system; trộn lẫn sẽ tốn nhiều giờ debug.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| ESM | tree-shaking, chuẩn | tương thích với package cũ khó hơn |
| CJS | tương thích rộng, đơn giản trong Node | không tree-shake, không phải chuẩn |
| Bundle lớn ít chunk | ít request, đơn giản | tải ban đầu chậm |
| Nhiều chunk nhỏ | tải ban đầu nhanh, cache tốt | nhiều request, waterfall nếu phụ thuộc |
| Barrel file | import gọn | bundle to, build chậm |

## Explain Without Notes

1. Khác biệt căn bản giữa CJS và ESM, và vì sao nó dẫn tới tree-shaking?
2. Vì sao CJS không thể `require` ESM?
3. Ba điều kiện để tree-shaking hoạt động?
4. Barrel file gây vấn đề gì?
5. Circular import biểu hiện thế nào lúc runtime, và tìm nó bằng cách nào?

## Related

- [TypeScript ↔ runtime boundary](../typescript/01-runtime-boundary.md) — type bị xoá lúc compile
- [Server/Client boundary](../../03-nextjs/behavior/01-server-client-boundary.md) — ranh giới do bundler thực thi
- [Module system trong Node](../../../02-backend-api/01-nodejs/fundamentals/02-module-system.md) — góc Node runtime: resolution, `exports`, decorator, `reflect-metadata`
- [Modules & DI (NestJS)](../../../02-backend-api/02-nestjs/behavior/02-modules-di.md) — circular dependency ở backend
- [Frontend performance](../../../05-cross-cutting/performance/02-frontend-performance.md) — ngân sách bundle
- [Deployment & production (Next.js)](../../03-nextjs/behavior/08-deployment-production.md)
