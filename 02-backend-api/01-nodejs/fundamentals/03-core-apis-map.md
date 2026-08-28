---
level: foundation
area: backend
prerequisites:
  - 01-runtime-concurrency.md
related:
  - 02-module-system.md
  - ../runtime-io/01-streams-buffers.md
---

# Bản đồ core API và package.json

> Một service đọc file cấu hình bằng `fs.readFileSync` trong handler, ghép đường dẫn bằng `'./config/' + name`, và tự viết logic timeout bằng `setTimeout` + cờ boolean. Cả ba đều có API chuẩn làm đúng việc đó tốt hơn: `fs.promises`, `path.join`, `AbortSignal.timeout`. **Không ai viết sai — họ chỉ không biết những thứ đó tồn tại.**

## Position

```text
Note này là BẢN ĐỒ: module nào tồn tại, giải quyết vấn đề gì,
và cạm bẫy chính của nó. Đọc sâu ở các note behavior.

Không phải API reference — Node docs làm việc đó tốt hơn.
```

## `package.json` — hợp đồng của dự án

```jsonc
{
  "name": "orders-api",
  "type": "module",              // ① "module" = ESM · "commonjs" = CJS (mặc định)
  "engines": { "node": ">=22.12" },  // ② phiên bản yêu cầu
  "scripts": {                   // ③ điểm vào chuẩn của dự án
    "dev": "node --watch src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {},            // ④ cần lúc CHẠY → vào production image
  "devDependencies": {},         //    chỉ cần lúc BUILD/TEST → không vào image
  "peerDependencies": {},        //    host phải cung cấp (dùng khi viết thư viện)
  "optionalDependencies": {}     //    cài lỗi cũng không sao
}
```

```text
Ba điều quyết định hành vi:

`type`         quyết định `.js` được đọc là ESM hay CJS
               → sai trường này là nguồn của lỗi "Cannot use import statement"

dependencies vs devDependencies
               → nhầm chỗ: hoặc image phình to, hoặc production thiếu module
               → `npm ci --omit=dev` trong Dockerfile phơi bày ngay lỗi này

`npm ci` vs `npm install`
               → `ci` cài ĐÚNG lockfile, xoá node_modules trước; dùng trong CI
               → `install` có thể nâng phiên bản và sửa lockfile
```

## Bản đồ module theo vấn đề

| Module | Giải quyết | Cạm bẫy chính |
|---|---|---|
| `node:fs` | đọc/ghi file | bản sync **chặn event loop**; dùng `fs/promises` |
| `node:path` | ghép và phân tích đường dẫn | ghép chuỗi bằng `+` hỏng trên Windows |
| `node:process` | argv, env, exit code, signal | `process.exit()` cắt ngang I/O đang chờ |
| `node:events` | pub/sub trong process | listener không gỡ → rò rỉ bộ nhớ |
| `node:stream` | dữ liệu lớn theo lô | bỏ qua backpressure → phình bộ nhớ |
| `node:buffer` | dữ liệu nhị phân | `Buffer` nằm **ngoài** heap V8 |
| `node:timers` | hoãn, lặp lại | timer giữ process sống; `unref()` để bỏ |
| `node:http` | server/client HTTP | không có timeout mặc định hợp lý |
| `node:crypto` | băm, ngẫu nhiên, ký | `Math.random()` **không** dùng cho bảo mật |
| `node:worker_threads` | việc CPU nặng | chi phí tạo ~10–40ms |
| `node:child_process` | chạy chương trình ngoài | `exec` qua shell → command injection |
| `node:async_hooks` | ngữ cảnh theo request | `AsyncLocalStorage` là API nên dùng |

Tiền tố `node:` là dạng khuyến nghị hiện nay — nó nói rõ đây là module built-in, không phải package trên npm trùng tên.

## Những thứ đáng biết ở từng module

### `fs` — đồng bộ chặn event loop

```ts
import { readFile } from 'node:fs/promises';

// ✗ chặn MỌI request khác trong lúc đọc
const config = readFileSync('./config.json', 'utf8');

// ✓ không chặn
const config = JSON.parse(await readFile('./config.json', 'utf8'));

// ✓ và với file lớn: stream, đừng đọc hết vào bộ nhớ
await pipeline(createReadStream('huge.csv'), parse(), createWriteStream('out.json'));
```

Lưu ý: `fs` bất đồng bộ chạy trong **thread pool của libuv** (mặc định 4 luồng), không phải kernel async như mạng. Nhiều thao tác `fs` đồng thời có thể cạn pool.

### `path` — đừng ghép chuỗi

```ts
import path from 'node:path';

path.join('config', 'app.json')       // 'config/app.json' (hoặc '\' trên Windows)
path.resolve('config', 'app.json')    // đường dẫn tuyệt đối
path.extname('a/b/c.tar.gz')          // '.gz'
path.basename('/a/b/c.md', '.md')     // 'c'

// và quan trọng cho bảo mật:
const safe = path.resolve(BASE, userInput);
if (!safe.startsWith(BASE + path.sep)) throw new Error('path traversal');
```

### `process` — môi trường và vòng đời

```ts
process.env.NODE_ENV          // biến môi trường (luôn là string | undefined)
process.argv.slice(2)         // tham số dòng lệnh
process.exitCode = 1;         // ✓ đặt mã, để Node thoát tự nhiên
process.exit(1);              // ✗ cắt ngang I/O đang chờ, log có thể mất

process.on('SIGTERM', () => shutdown());     // container gửi tín hiệu này
process.on('unhandledRejection', (err) => { logger.fatal({ err }); process.exit(1); });
process.on('uncaughtException', (err) => { logger.fatal({ err }); process.exit(1); });
```

```text
Với hai handler cuối: LOG rồi THOÁT. Đừng cố tiếp tục chạy —
process đang ở trạng thái không xác định. Orchestrator sẽ khởi động lại.
```

### `events` — EventEmitter

```ts
import { EventEmitter, once } from 'node:events';

class Jobs extends EventEmitter {}
const jobs = new Jobs();
jobs.on('done', (id) => logger.info({ id }, 'job done'));

await once(jobs, 'done');                    // chờ một sự kiện, dạng promise
```

```text
Hai cạm bẫy:
① listener không gỡ → rò rỉ. Node cảnh báo khi vượt 10 listener cùng loại
   (`MaxListenersExceededWarning`) — đó là cảnh báo rò rỉ, không phải giới hạn cứng.
② sự kiện `'error'` KHÔNG có listener → Node NÉM và làm sập process.
```

### `timers` — và việc giữ process sống

```ts
const t = setTimeout(fn, 60_000);
t.unref();                    // không giữ process sống chỉ vì timer này

clearTimeout(t);              // luôn dọn trong cleanup
setTimeout(fn, 0);            // KHÔNG phải "ngay lập tức" — tối thiểu ~1ms
setImmediate(fn);             // chạy sau pha poll — dùng để nhường event loop

import { setTimeout as delay } from 'node:timers/promises';
await delay(1000);            // dạng promise, hỗ trợ AbortSignal
```

### `AbortController` — huỷ thao tác bất đồng bộ

```ts
// timeout cho fetch — API chuẩn, không cần tự viết
const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });

// kết hợp nhiều tín hiệu huỷ
const signal = AbortSignal.any([AbortSignal.timeout(5_000), userAbort.signal]);

// tự tạo và truyền xuống
const ac = new AbortController();
await readFile(p, { signal: ac.signal });
ac.abort();
```

`AbortSignal` được hỗ trợ bởi `fetch`, `fs/promises`, `timers/promises`, và stream. Nó là cách chuẩn để huỷ — đừng tự viết cờ boolean.

### `crypto` — dùng đúng hàm

```ts
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

randomUUID();                              // ✓ id ngẫu nhiên
randomBytes(32).toString('base64url');     // ✓ token: CSPRNG
Math.random().toString(36);                // ✗ KHÔNG dùng cho bảo mật

createHash('sha256').update(data).digest('hex');   // ✓ checksum, ETag
// ✗ KHÔNG dùng để hash MẬT KHẨU — cần argon2/bcrypt (chậm có chủ đích)

timingSafeEqual(a, b);                     // so sánh bí mật, chống timing attack
```

### `child_process` — mảng đối số, không phải chuỗi

```ts
import { execFile } from 'node:child_process';

execFile('convert', [userFile, 'out.png']);   // ✓ không qua shell
exec(`convert ${userFile} out.png`);          // ✗ shell phân tích → injection
```

## Web API có sẵn trong Node hiện đại

```text
fetch · Request · Response · Headers · FormData     (ổn định từ Node 21)
AbortController · AbortSignal
URL · URLSearchParams
structuredClone()
TextEncoder · TextDecoder
Web Streams (ReadableStream, WritableStream, TransformStream)
crypto.subtle (WebCrypto)

⇒ code dùng những API này chạy được ở cả Node, Deno, Bun, và edge runtime.
⇒ ưu tiên chúng khi có lựa chọn — trừ khi cần tính năng riêng của Node.
```

## Prediction

1. `readFileSync` trong request handler, file 50 MB — request khác thế nào?
2. `'./config/' + name` trên Windows — kết quả?
3. `process.exit(0)` ngay sau `logger.info(...)` với log bất đồng bộ — log có ra không?
4. `process.exitCode = 0` rồi để hàm kết thúc — khác gì?
5. EventEmitter phát `'error'` mà không có listener — chuyện gì xảy ra?
6. 15 listener cùng loại trên một emitter — Node nói gì? Có phải lỗi không?
7. `setTimeout(fn, 60000)` không `unref()`, không có việc gì khác — process thoát khi nào?
8. `Math.random()` sinh token reset mật khẩu — vấn đề gì?
9. `createHash('sha256')` để hash mật khẩu — vì sao sai?
10. `exec` với tên file do người dùng đặt chứa dấu chấm phẩy — chuyện gì xảy ra?
11. Thư viện chỉ dùng lúc build nằm trong `dependencies`, Dockerfile chạy `npm ci --omit=dev` — build hay runtime hỏng?
12. `"type": "module"` nhưng file dùng `require()` — kết quả?

<details>
<summary>Đáp án</summary>

1. **Chờ toàn bộ** — event loop bị chặn.
2. Sai dấu phân cách; dùng `path.join`.
3. **Có thể mất** — `exit` cắt ngang I/O đang chờ.
4. Node thoát **sau khi** flush xong I/O.
5. Node **ném lỗi và sập process**.
6. `MaxListenersExceededWarning` — **cảnh báo rò rỉ**, không phải lỗi.
7. Sau **60 giây** — timer giữ process sống.
8. Không phải CSPRNG — token **đoán được**.
9. Nó **nhanh** — hash mật khẩu phải chậm có chủ đích.
10. Shell chạy **lệnh thứ hai** — command injection.
11. **Runtime** — module bị loại khỏi image.
12. `require is not defined` — dùng `import` hoặc `createRequire`.
</details>

## What Usually Goes Wrong

- **API đồng bộ trong request path** (`readFileSync`, `execSync`, `crypto` sync).
- **Ghép đường dẫn bằng `+`** → hỏng trên Windows, và mở đường path traversal.
- **`process.exit()`** thay vì `process.exitCode`.
- **Không xử lý `unhandledRejection` / `uncaughtException`.**
- **Listener không gỡ** → rò rỉ bộ nhớ.
- **Không có listener cho `'error'`** → process sập.
- **Timer không `clearTimeout`/`unref`** → process không thoát.
- **`Math.random()` cho giá trị bảo mật.**
- **`sha256` cho mật khẩu.**
- **`exec` thay `execFile`.**
- **Nhầm `dependencies`/`devDependencies`.**
- **Tự viết timeout** thay vì `AbortSignal.timeout`.

## Explain Without Notes

1. Ba trường trong `package.json` quyết định hành vi runtime, và mỗi cái hỏng thế nào?
2. `npm ci` khác `npm install` ở đâu, và vì sao CI dùng `ci`?
3. Vì sao `fs` đồng bộ nguy hiểm trong server, và `fs` async chạy ở đâu?
4. `process.exit()` và `process.exitCode` khác nhau ra sao?
5. Hai cạm bẫy của EventEmitter.
6. `AbortSignal` dùng được với những API nào? Nó thay thế cách làm nào?
7. Ba hàm `crypto` và trường hợp dùng đúng của từng cái.
8. `exec` và `execFile` khác nhau thế nào?

## Related

- [Runtime & concurrency](01-runtime-concurrency.md) — event loop, thread pool
- [Module system](02-module-system.md) — CJS vs ESM, `type` field
- [Streams & buffers](../runtime-io/01-streams-buffers.md) — `stream`, `Buffer`, backpressure
- [Worker threads & CPU](../runtime-io/02-worker-threads-cpu.md) — `worker_threads`, `child_process`
- [Process & memory](../production/01-process-memory.md) — `process`, GC, unhandled rejection
- [Graceful shutdown](../production/02-graceful-shutdown.md) — signal, exit code
- [Injection](../../../05-cross-cutting/security/02-injection.md) — `exec` và command injection
- [Password & MFA](../../03-auth/05-password-mfa.md) — vì sao không hash bằng sha256
- [Timeout, retry & circuit breaker](../../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — `AbortSignal` trong thực tế

## Version / Context

Node.js **24 LTS** (Node 26 là Current; Node 20 đã EOL 04/2026). `fetch`, `FormData`, `AbortSignal.any` ổn định từ Node 21; `AbortSignal.timeout` từ Node 17.3. Tiền tố `node:` được khuyến nghị cho mọi module built-in. `--watch` ổn định từ Node 22. Node 22.6+ chạy được TypeScript trực tiếp qua type stripping (`--experimental-strip-types`, mặc định từ Node 23.6) — kiểm tra tài liệu cho phiên bản bạn dùng.
