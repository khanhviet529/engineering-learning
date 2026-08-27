---
level: intermediate
area: backend
prerequisites:
  - 01-node-runtime-concurrency.md
related:
  - 03-process-memory.md
  - ../../05-cross-cutting/performance/06-backpressure.md
---

# Streams & buffers

> Đọc một file 2GB vào biến rồi trả về client dùng 2GB RAM và chặn event loop. Stream cùng file đó dùng 64KB. Đây là khác biệt giữa một service chịu tải và một service bị OOMKilled.

## Position

```text
File / Socket / DB cursor → [Stream: chunk → chunk → chunk] → Response
                                    ↑ note này
```

## Problem

```ts
// ❌ Export CSV cho 5 triệu dòng
app.get('/export', async (req, res) => {
  const rows = await db.task.findMany();          // 5M object trong RAM
  const csv = rows.map(toCsvLine).join('\n');     // thêm một chuỗi khổng lồ
  res.send(csv);                                   // và một buffer nữa
});
```

Ba vấn đề cùng lúc:

1. **Memory**: 5M object + chuỗi CSV + buffer response. Vài GB. `OOMKilled`.
2. **Event loop**: `map` và `join` là đồng bộ trên 5M phần tử — chặn mọi request khác.
3. **Latency**: người dùng thấy trang trắng cho đến khi **toàn bộ** xong. Không có byte nào được gửi trước đó.

Và vấn đề thứ tư, tinh vi hơn: nếu client chậm (mạng 3G), server đã tạo xong toàn bộ dữ liệu và phải giữ nó trong memory cho đến khi client nhận hết.

## Mental Model

```text
Buffer  = toàn bộ dữ liệu trong RAM cùng lúc
          → memory = kích thước dữ liệu
          → phải chờ xong hết mới bắt đầu gửi

Stream  = dữ liệu chảy qua theo chunk
          → memory = kích thước chunk (mặc định 64KB cho file, 16KB cho object)
          → gửi ngay chunk đầu tiên
```

Bốn loại stream:

```text
Readable   → nguồn dữ liệu       (fs.createReadStream, HTTP request, DB cursor)
Writable   → đích dữ liệu        (fs.createWriteStream, HTTP response)
Duplex     → cả hai              (TCP socket)
Transform  → Duplex có biến đổi  (gzip, encrypt, parse CSV)
```

Và khái niệm quan trọng nhất, cái làm stream thật sự hữu ích:

```text
BACKPRESSURE = khi đích chậm hơn nguồn, nguồn phải CHẬM LẠI
```

Không có backpressure, một client mạng chậm làm server tích luỹ dữ liệu trong memory — đúng vấn đề mà stream lẽ ra giải quyết. Đây là lý do `pipeline()` tồn tại và tại sao tự viết `.on('data')` là sai.

## How It Works

### `pipeline` — cách đúng duy nhất

```ts
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

// ✅ Backpressure tự động, cleanup tự động, lỗi lan đúng
await pipeline(
  createReadStream('big.csv'),
  createGzip(),
  createWriteStream('big.csv.gz'),
);
```

So với cách cũ:

```ts
// ❌ .pipe() không lan lỗi và không cleanup — leak file descriptor khi có lỗi
readStream.pipe(gzip).pipe(writeStream);

// ❌ Tự viết: bỏ qua backpressure hoàn toàn
readStream.on('data', chunk => writeStream.write(chunk));   // không kiểm tra giá trị trả về
```

`writeStream.write()` trả về `false` khi buffer nội bộ đã đầy. Bỏ qua giá trị đó nghĩa là bạn tiếp tục ghi vào một buffer đang phình — memory tăng không giới hạn.

`pipeline()` xử lý cả ba việc: backpressure, cleanup khi lỗi, và lan lỗi ra một chỗ (`await` throw).

### Stream từ database

```ts
// ✅ Export 5M dòng với memory không đổi
import { Transform } from 'node:stream';

app.get('/export', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');

  const toCsv = new Transform({
    objectMode: true,
    transform(row, _enc, cb) {
      cb(null, `${row.id},${escapeCsv(row.title)},${row.status}\n`);
    },
  });

  try {
    await pipeline(
      db.queryStream('SELECT id, title, status FROM tasks'),   // cursor, không load hết
      toCsv,
      res,                                                     // response LÀ Writable
    );
  } catch (err) {
    // Header đã gửi rồi → không thể đổi status code
    if (!res.headersSent) res.status(500).end();
    else res.destroy();               // chỉ có thể ngắt kết nối
    logger.error({ err }, 'export failed');
  }
});
```

Điểm quan trọng và hay bị bỏ: **sau khi byte đầu tiên được gửi, bạn không thể đổi status code.** Nếu lỗi xảy ra giữa stream, client đã nhận `200 OK` và một phần dữ liệu. Cách duy nhất báo lỗi là ngắt kết nối — client sẽ thấy response không hoàn chỉnh.

Vì vậy: **validate mọi thứ trước khi gửi byte đầu tiên.**

### Backpressure trong thực tế

```ts
// Client mạng chậm, dữ liệu nguồn nhanh
db.queryStream(...)  →  toCsv  →  res (client 3G)

// pipeline() tự động:
// res buffer đầy → toCsv.write() trả false → toCsv ngừng đọc
//   → db cursor ngừng fetch → memory giữ ở mức chunk
// Khi client nhận xong một phần → 'drain' → chuỗi tiếp tục
```

Không có backpressure, database cursor sẽ fetch hết 5M dòng vào memory trong lúc client 3G vẫn đang nhận dòng thứ 1000.

Xem [Backpressure](../../05-cross-cutting/performance/06-backpressure.md) cho cùng nguyên lý ở tầng hệ thống.

### Buffer

```ts
// Buffer là dãy byte thô — không phải string
const buf = Buffer.from('xin chào', 'utf8');
buf.length;                       // 11 byte, KHÔNG phải 8 ký tự
'xin chào'.length;                // 8

// Nối buffer đúng cách
const combined = Buffer.concat([buf1, buf2]);

// ❌ Đừng cắt buffer ở ranh giới byte tuỳ ý rồi toString
buf.subarray(0, 5).toString('utf8');    // có thể cắt giữa một ký tự multi-byte

// ✅ Dùng StringDecoder để xử lý ranh giới chunk
import { StringDecoder } from 'node:string_decoder';
const decoder = new StringDecoder('utf8');
decoder.write(chunk1);            // giữ byte dở dang cho chunk sau
```

Đây là bug thật khi xử lý stream text tiếng Việt: một chunk 64KB có thể kết thúc giữa 3 byte của một ký tự có dấu, và `chunk.toString()` cho ra ký tự lỗi.

### Web Streams vs Node Streams

```ts
// Node stream (truyền thống)
import { Readable } from 'node:stream';

// Web stream (chuẩn, dùng trong Next.js Route Handler, fetch, Deno)
const stream = new ReadableStream({
  start(controller) { controller.enqueue('data'); controller.close(); },
});

// Chuyển đổi
Readable.toWeb(nodeStream);
Readable.fromWeb(webStream);
```

Next.js Route Handler và `fetch` dùng Web Streams. Code Node truyền thống dùng Node Streams. Biết cách chuyển đổi tránh việc viết lại.

## Example

```ts
// Upload file lớn — không bao giờ load hết vào memory
app.post('/upload', async (req, res) => {
  // Validate TRƯỚC khi bắt đầu stream
  const size = Number(req.headers['content-length'] ?? 0);
  if (size > MAX_UPLOAD) return res.status(413).json({ error: { code: 'TOO_LARGE' } });

  const dest = createWriteStream(`/data/uploads/${id}`);
  try {
    await pipeline(req, dest);                 // req LÀ Readable
    res.status(201).json({ id });
  } catch (err) {
    await unlink(`/data/uploads/${id}`).catch(() => {});   // dọn file dở
    throw err;
  }
});
```

`Content-Length` có thể bị client nói dối — vẫn cần một Transform đếm byte thật và ngắt khi vượt giới hạn.

## Prediction

1. `readFileSync` file 2GB — memory bao nhiêu? Event loop lag?
2. `createReadStream` cùng file, pipe tới response — memory bao nhiêu?
3. `readStream.on('data', c => writeStream.write(c))` với đích chậm — memory thế nào?
4. `pipeline()` cùng tình huống — memory thế nào?
5. Lỗi xảy ra sau khi đã gửi 1MB response — status code client nhận là gì?
6. `Buffer.from('xin chào').length` — bao nhiêu?
7. Chunk 64KB cắt giữa ký tự `ế`, gọi `chunk.toString()` — kết quả?
8. `.pipe()` với lỗi ở stream giữa — file descriptor được đóng không?

<details>
<summary>Đáp án</summary>

1. ~2GB (hoặc lỗi vượt giới hạn buffer); lag rất lớn.
2. ~64KB mỗi chunk.
3. Tăng không giới hạn — bỏ qua backpressure.
4. Giữ ở mức chunk — backpressure hoạt động.
5. `200` — đã gửi rồi. Client nhận response không hoàn chỉnh.
6. 11 byte.
7. Ký tự lỗi (replacement character) — cần `StringDecoder`.
8. Không — `.pipe()` không cleanup khi lỗi; đó là leak.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `readFileSync` file 1GB, đo RSS và event loop lag | Cả hai tăng vọt |
| Đổi sang `createReadStream` + `pipeline` | RSS gần như không đổi |
| Tự viết `.on('data')` với đích chậm (throttle client) | RSS tăng đều — không có backpressure |
| `pipeline()` cùng tình huống | RSS phẳng |
| Gây lỗi giữa stream, xem response ở client | 200 với dữ liệu không hoàn chỉnh |
| `.pipe()` rồi destroy stream giữa, đếm fd (`lsof -p`) | Fd không được đóng |
| Cắt chunk giữa ký tự có dấu, `toString()` | Ký tự lỗi |
| `db.findMany()` 1M dòng vs `queryStream` | So RSS |
| Bỏ giới hạn upload, gửi file 10GB | Đĩa đầy hoặc OOM |

## What Usually Goes Wrong

- **Load toàn bộ vào memory** cho export/import/upload — nguyên nhân OOM phổ biến nhất.
- **`.pipe()` thay vì `pipeline()`** → leak fd khi có lỗi, lỗi không lan.
- **Tự viết `.on('data')`** → bỏ qua backpressure.
- **`findMany()` không giới hạn** thay vì cursor/stream.
- **Không validate trước khi stream** → không thể trả status code lỗi.
- **Không dọn file dở** khi upload thất bại.
- **`toString()` trên chunk** cho text multi-byte → ký tự lỗi.
- **Không giới hạn kích thước upload/body** → DoS.
- **`JSON.stringify` mảng lớn** thay vì stream JSON.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Stream chỉ để tiết kiệm memory | Còn để gửi byte đầu sớm (TTFB) và để có backpressure |
| `.pipe()` xử lý lỗi | Không lan lỗi, không cleanup |
| `.on('data')` tương đương pipe | Bỏ qua backpressure |
| Buffer là string | Là dãy byte; độ dài tính theo byte |
| Có thể trả lỗi giữa stream | Header đã gửi; chỉ ngắt được kết nối |
| Stream luôn tốt hơn | Với dữ liệu nhỏ, buffer đơn giản hơn và đủ |
| `objectMode` có `highWaterMark` theo byte | Trong `objectMode`, nó tính theo **số object** |

## Debugging

1. **RSS tăng theo kích thước dữ liệu** → đang buffer, không stream. Đây là dấu hiệu rõ nhất.
2. **Đo RSS trong lúc stream**: `process.memoryUsage().rss` mỗi giây. Đường phẳng = stream đúng; đường tăng = buffer hoặc thiếu backpressure.
3. **Đếm file descriptor**: `lsof -p <pid> | wc -l` trước và sau nhiều lần stream. Tăng đều = leak (thường do `.pipe()`).
4. **Response không hoàn chỉnh** → tìm lỗi xảy ra sau `headersSent`; kiểm tra log server.
5. **Ký tự lỗi trong output** → chunk boundary; dùng `StringDecoder`.
6. **Stream treo** → thường vì backpressure và đích không bao giờ `drain`; kiểm tra client còn kết nối không.
7. `pipeline()` throw cho bạn stack trace đúng chỗ — đó là một lý do nữa để dùng nó.

## Production Considerations

- **`pipeline()` cho mọi stream.** Không dùng `.pipe()`, không tự viết `.on('data')`.
- **Giới hạn kích thước** upload và body ở cả proxy và app.
- **Validate trước byte đầu tiên** — sau đó không đổi được status.
- **Timeout cho stream dài**; và `res.on('close')` để dọn khi client ngắt giữa đường.
- **Dọn tài nguyên dở** (file tạm, transaction) trong `catch`.
- **Với export lớn, cân nhắc job nền**: trả 202 + link tải, thay vì giữ một HTTP connection 10 phút. Xem [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md).
- **Compression** (`createGzip`) trong pipeline cho export text — giảm băng thông đáng kể.
- **`proxy_buffering off`** ở nginx nếu muốn client nhận byte sớm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Stream | memory không đổi, TTFB tốt, backpressure | phức tạp hơn, không đổi được status giữa đường |
| Buffer toàn bộ | đơn giản, xử lý lỗi dễ | memory theo kích thước dữ liệu |
| Export qua HTTP stream | tức thì, không cần storage | giữ connection lâu, mất khi mạng đứt |
| Export qua job nền | resumable, không giữ connection | phức tạp hơn, cần storage và queue |
| Gzip trong pipeline | ít băng thông | tốn CPU (và dùng thread pool) |

## Explain Without Notes

1. Ba vấn đề của việc load toàn bộ dữ liệu vào memory?
2. Backpressure là gì và vì sao nó là phần quan trọng nhất của stream?
3. Vì sao `pipeline()` tốt hơn `.pipe()` — hai lý do?
4. Vì sao không thể trả status code lỗi giữa stream? Hệ quả với thiết kế?
5. Vì sao `chunk.toString()` gây ký tự lỗi với text tiếng Việt?

## Related

- [Node runtime & concurrency](01-node-runtime-concurrency.md) — vì sao đồng bộ chặn
- [Process & memory](03-process-memory.md) — giới hạn heap và RSS
- [Backpressure](../../05-cross-cutting/performance/06-backpressure.md) — cùng nguyên lý ở tầng hệ thống
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md) — export lớn nên là job
- [Memory & GC](../../01-web-frontend/01-javascript-typescript/05-memory-gc.md)
- [Reverse proxy](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — buffering
