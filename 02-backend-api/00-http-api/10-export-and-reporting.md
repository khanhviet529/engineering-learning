---
level: intermediate
area: backend
prerequisites:
  - 09-file-upload-download.md
  - ../01-nodejs/runtime-io/01-streams-buffers.md
related:
  - ../../03-database/04-message-queues/01-why-queue.md
  - ../../03-database/03-data-modeling/08-money-decimal.md
---

# Export & reporting: CSV, Excel, PDF

> `=cmd|'/c calc'!A1` trong một ô CSV **thực thi** khi người dùng mở bằng Excel. Đây là lỗ hổng có ở gần như mọi chức năng export, và nó không nằm trong OWASP Top 10 nên hầu như không ai kiểm tra.

## Position

```text
Database (nhiều dòng)
      ↓ stream, không load hết
Format (CSV / XLSX / PDF)
      ↓ escape, thoát formula
HTTP response, hoặc file trong storage + link
      ↓
Người dùng mở bằng Excel / trình đọc PDF
```

## Problem

```ts
// Export 500.000 đơn hàng — 4 dòng, 4 vấn đề
@Get('orders/export')
async export(@Res() res: Response) {
  const orders = await this.prisma.order.findMany();          // 1
  const csv = orders.map(o => `${o.id},${o.customerName},${o.total}`).join('\n');  // 2, 3
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);                                              // 4
}
```

| # | Vấn đề | Hậu quả |
|---|---|---|
| 1 | Load toàn bộ vào RAM | 500k object → OOM |
| 2 | Không escape | `customerName = "Công ty A, B"` phá cấu trúc cột |
| 3 | **Không thoát formula** | `=HYPERLINK(...)` thực thi khi mở |
| 4 | Giữ HTTP connection | 3 phút → proxy timeout 504 |

Vấn đề 3 là vấn đề bảo mật thật: người dùng nhập `=cmd|'/c calc'!A1` làm tên công ty, admin export và mở file, **lệnh chạy trên máy admin**. Đây gọi là **CSV formula injection** (hoặc CSV injection).

## Mental Model

Ba câu hỏi, theo thứ tự:

```text
1. BAO NHIÊU DÒNG?
   < 5.000       → response trực tiếp, đơn giản
   5.000–100.000 → stream trong response
   > 100.000     → JOB NỀN + link tải

2. ĐỊNH DẠNG NÀO?
   CSV   → đơn giản, stream được, nhưng cần thoát formula
   XLSX  → nhiều sheet, format số/ngày, nhưng nặng hơn
   PDF   → layout cố định, in được, nhưng khó stream

3. AI ĐƯỢC EXPORT?
   Export là endpoint đắt nhất và lộ nhiều dữ liệu nhất
   → authz chặt hơn endpoint đọc thường
   → rate limit riêng
```

Câu 1 quan trọng nhất, vì nó quyết định kiến trúc:

> **Export > 100.000 dòng không nên là request đồng bộ**, dù bạn tăng được timeout.
>
> Lý do: nó giữ connection, chết khi mạng đứt, không resume được, không retry được, và người dùng phải ngồi chờ.

Và nguyên tắc bảo mật:

> **Mọi giá trị text trong CSV/XLSX là dữ liệu không tin cậy đối với Excel.** Escape CSV (dấu phẩy, ngoặc kép) và thoát formula là **hai** việc khác nhau — làm một cái không đủ.

## How It Works

### CSV formula injection — cách phòng

```ts
// Excel/LibreOffice/Google Sheets coi ô bắt đầu bằng các ký tự này là CÔNG THỨC
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);

  // 1. THOÁT FORMULA — thêm dấu ' ở đầu để Excel coi là text
  if (FORMULA_PREFIX.test(s)) {
    s = `'${s}`;
  }

  // 2. ESCAPE CSV — hai việc KHÁC NHAU
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;     // ngoặc kép nhân đôi
  }
  return s;
}

// "=cmd|'/c calc'!A1"  → "'=cmd|'/c calc'!A1"   (text, không chạy)
// 'Công ty A, B'        → '"Công ty A, B"'        (một ô)
// 'Nói "xin chào"'      → '"Nói ""xin chào"""'
```

Bốn ký tự cần chú ý: `=`, `+`, `-`, `@`. Cộng thêm tab và CR — chúng cũng kích hoạt parsing trong một số phiên bản.

**Đừng chỉ xoá ký tự** — nó làm mất dữ liệu (số âm `-5` thành `5`). Thêm `'` ở đầu giữ được giá trị và vô hiệu hoá formula.

### CSV — stream, không buffer

```ts
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

@Get('orders/export')
async exportCsv(@Res() res: Response, @CurrentUser() user: User) {
  // Validate và authz TRƯỚC khi gửi byte đầu tiên
  await this.assertCanExport(user);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  // BOM để Excel trên Windows đọc đúng UTF-8 (tiếng Việt)
  res.write('﻿');
  res.write('Mã đơn,Khách hàng,Tổng tiền,Ngày tạo\n');

  const toCsv = new Transform({
    objectMode: true,
    transform(row, _enc, cb) {
      const cells = [
        row.id,
        row.customerName,
        formatMoney(row.totalMinor, row.currency),
        formatDate(row.createdAt, user.timezone),
      ].map(sanitizeCsvCell);
      cb(null, cells.join(',') + '\n');
    },
  });

  try {
    await pipeline(
      this.orders.streamForExport(user.orgId),    // cursor, không findMany()
      toCsv,
      res,
    );
  } catch (err) {
    // Header đã gửi → KHÔNG đổi được status code
    this.logger.error({ err, userId: user.id }, 'export failed mid-stream');
    res.destroy();
  }
}
```

Năm chi tiết quyết định:

- **BOM `﻿`** — không có nó, Excel trên Windows hiển thị tiếng Việt thành ký tự lỗi. Đây là lỗi được báo nhiều nhất về export CSV.
- **`sanitizeCsvCell` cho *mọi* ô**, kể cả ô bạn nghĩ là số.
- **Cursor, không `findMany()`** — xem dưới.
- **Authz trước byte đầu tiên** — sau đó không đổi được status code.
- **`Cache-Control: no-store`** — export chứa dữ liệu riêng tư, không được cache ở proxy.

### Stream từ database

```ts
// Prisma không có streaming API chính thức cho findMany.
// Hai cách thực dụng:

// A. Cursor pagination trong async generator
async *streamForExport(orgId: string) {
  let cursor: string | undefined;
  for (;;) {
    const batch = await this.prisma.order.findMany({
      where: { orgId },
      select: { id: true, customerName: true, totalMinor: true, currency: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1000,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (batch.length === 0) return;
    for (const row of batch) yield row;
    cursor = batch.at(-1)!.id;
  }
}

// B. Raw cursor của driver pg (hiệu quả hơn cho tập rất lớn)
// dùng pg-query-stream với connection riêng, không qua Prisma
```

Cách A dùng được ngay và giữ RAM ở mức 1000 dòng. Lưu ý `select` tường minh — export không nên kéo cột `TEXT` lớn không cần thiết.

Xem [Pagination](04-pagination-filtering-sorting.md) về vì sao cursor thay vì `skip/take`.

### XLSX — phải stream, thư viện mặc định thì không

```ts
// ❌ Phần lớn thư viện xlsx dựng toàn bộ workbook trong RAM rồi ghi
// → 100k dòng có thể tốn hàng GB

// ✅ Streaming writer
import ExcelJS from 'exceljs';

const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useSharedStrings: false });
const ws = wb.addWorksheet('Đơn hàng');

ws.columns = [
  { header: 'Mã đơn', key: 'id', width: 20 },
  { header: 'Khách hàng', key: 'name', width: 30 },
  { header: 'Tổng tiền', key: 'total', width: 15, style: { numFmt: '#,##0' } },
  { header: 'Ngày tạo', key: 'date', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
];

for await (const row of this.orders.streamForExport(orgId)) {
  ws.addRow({
    id: row.id,
    name: sanitizeCsvCell(row.customerName),      // XLSX cũng cần thoát formula
    total: Number(row.totalMinor),                 // SỐ thật, để Excel tính được
    date: row.createdAt,                            // DATE thật, không phải string
  }).commit();                                      // commit() → flush, không giữ trong RAM
}
await ws.commit();
await wb.commit();
```

Ba điểm XLSX hơn CSV, và chúng là lý do chọn nó:

1. **Số là số thật** — Excel tính tổng được. Với CSV, `1.250.000` là text (dấu chấm phân cách bị hiểu là thập phân hoặc không hiểu).
2. **Ngày là date thật** — người dùng sort và filter được theo ngày.
3. **`numFmt`** — định dạng hiển thị mà không mất giá trị gốc.

Điểm 1 quan trọng với tiền: đừng gửi chuỗi đã format sang XLSX; gửi số và để `numFmt` lo hiển thị. Xem [Money & Decimal](../../03-database/03-data-modeling/08-money-decimal.md).

`useSharedStrings: false` giảm RAM đáng kể cho tập lớn (đổi lại file lớn hơn một chút).

Và XLSX **vẫn cần thoát formula** — Excel parse công thức trong file xlsx như trong CSV.

### PDF — khác hẳn hai loại trên

PDF không phải "dữ liệu dạng bảng" mà là **layout**. Hai cách:

```text
A. HTML → PDF (Puppeteer / Playwright)
   ✅ dùng lại được HTML/CSS đã có; layout phức tạp dễ làm
   ❌ chạy một Chromium: ~200–400MB RAM mỗi instance, khởi động chậm
   → PHẢI chạy trong worker/job, không trong request handler

B. Thư viện PDF trực tiếp (pdfkit, PDFKit-based)
   ✅ nhẹ, stream được, RAM thấp
   ❌ tự đặt toạ độ; layout phức tạp rất tốn công
```

```ts
// A: Puppeteer trong JOB, không trong request
async generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const html = await this.render('invoice', await this.getInvoiceData(invoiceId));

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],   // cần trong container
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();     // BẮT BUỘC — không đóng là leak process
  }
}
```

Ba lưu ý vận hành với Puppeteer:

- **`--disable-dev-shm-usage`** — trong container, `/dev/shm` mặc định 64MB và Chromium sẽ crash.
- **Font** — image Docker mặc định không có font tiếng Việt; phải cài (`fonts-liberation`, `fonts-noto-cjk`) hoặc nhúng font vào HTML.
- **Reuse browser instance** trong worker sống lâu; launch mỗi request là 1–2 giây và 300MB.

### Export lớn → job nền

```ts
// Request: nhận yêu cầu, trả ngay
@Post('orders/export')
@HttpCode(202)
async requestExport(@Body() dto: ExportDto, @CurrentUser() user: User) {
  await this.assertCanExport(user);

  const job = await this.queue.add('export-orders', {
    orgId: user.orgId, userId: user.id, filter: dto.filter, format: dto.format,
  }, { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });

  return { jobId: job.id, statusUrl: `/exports/${job.id}` };
}

// Worker: stream ra storage, không qua HTTP
async process(job: Job<ExportPayload>) {
  const key = `exports/${job.data.orgId}/${job.id}.csv`;

  await pipeline(
    this.orders.streamForExport(job.data.orgId, job.data.filter),
    csvTransform(),
    this.storage.createWriteStream(key),          // → S3/R2
  );

  // Signed URL hết hạn — export chứa dữ liệu riêng tư
  const url = await this.storage.signedUrl(key, { expiresIn: 3600 });
  await this.mailer.send(job.data.userId, 'export-ready', { url });
  await this.prisma.export.update({
    where: { jobId: job.id },
    data: { status: 'READY', key, expiresAt: addHours(new Date(), 24) },
  });
}
```

Bốn thứ job cho bạn mà request đồng bộ không có: **retry**, **không giữ connection**, **resume được**, và **người dùng không phải chờ**. Xem [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md).

Và **lifecycle policy** trên storage để tự xoá export cũ — nếu không, file export tích luỹ vô hạn và chứa dữ liệu riêng tư. Xem [File storage](../05-integrations/03-file-storage.md).

## Example

```text
Ba mức export, ba kiến trúc

< 5.000 dòng           GET /export → CSV trong response
                       stream, sanitize, BOM, no-store

5k–100k dòng           GET /export → stream trong response
                       + tăng proxy timeout, + rate limit chặt

> 100k dòng, hoặc PDF  POST /export → 202 + jobId
                       worker stream → storage → signed URL → email
                       + lifecycle policy xoá sau 7 ngày
```

## Prediction

1. `findMany()` 500k dòng rồi `join('\n')` — RAM?
2. Tên khách hàng là `Công ty A, B`, không escape — file có mấy cột ở dòng đó?
3. Tên là `=1+1`, mở bằng Excel — ô hiển thị gì?
4. Tên là `=cmd|'/c calc'!A1` — điều gì xảy ra trên máy người mở?
5. Không có BOM, mở CSV tiếng Việt bằng Excel trên Windows — hiển thị gì?
6. Export 3 phút qua nginx mặc định — kết quả?
7. Lỗi xảy ra sau khi đã gửi 10MB response — client nhận status gì?
8. Gửi tiền dạng string `"1.250.000"` vào XLSX — Excel tính tổng được không?
9. Puppeteer trong request handler, 10 request đồng thời — RAM?
10. Không đóng browser trong `finally`, 100 lần gọi — điều gì tích luỹ?

<details>
<summary>Đáp án</summary>

1. Vài GB → OOM.
2. **4 cột** thay vì 3 — dấu phẩy phá cấu trúc.
3. `2` — Excel tính công thức.
4. Excel hỏi rồi có thể **thực thi lệnh** — CSV formula injection.
5. Ký tự lỗi (`CÃ´ng ty`) — Excel đoán sai encoding.
6. 504 sau `proxy_read_timeout` (mặc định 60s).
7. **200** — header đã gửi; client nhận file không hoàn chỉnh.
8. **Không** — nó là text.
9. ~3GB → OOM.
10. Process Chromium zombie — leak cho tới khi hết RAM/PID.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `findMany()` 200k dòng, đo `process.memoryUsage()` | RAM tăng bằng kích thước dữ liệu |
| Đổi sang cursor generator + stream | RAM phẳng |
| Đặt tên khách hàng có dấu phẩy, export, mở bằng Excel | Lệch cột |
| Đặt tên `=1+1`, mở bằng Excel | Ô hiện `2` |
| Thêm `sanitizeCsvCell`, làm lại | Hiện đúng text |
| Bỏ BOM, mở file tiếng Việt trên Excel Windows | Ký tự lỗi |
| Export 5 phút qua nginx mặc định | 504 |
| Gây lỗi giữa stream, xem response ở client | 200 với dữ liệu thiếu |
| Gửi tiền dạng string vào XLSX, thử `SUM()` trong Excel | Không tính được |
| Gửi số + `numFmt`, làm lại | Tính được |
| Puppeteer 10 lần song song, xem RAM và số process | Tăng vọt |
| Bỏ `browser.close()`, gọi 50 lần, `ps aux \| grep chrome` | Process zombie |

Thí nghiệm 4 nên chạy một lần — nó thay đổi cách bạn nhìn mọi chức năng export.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Escape CSV là đủ | Escape và thoát formula là **hai** việc |
| CSV injection không nghiêm trọng | Nó thực thi lệnh trên máy người mở file |
| Chỉ cần escape ô do người dùng nhập | Mọi ô — dữ liệu có thể đến từ nhiều nguồn |
| Xoá ký tự `=` là cách sửa | Làm mất dữ liệu (số âm); thêm `'` giữ được giá trị |
| BOM là chi tiết nhỏ | Không có nó, tiếng Việt hiện sai trên Excel Windows |
| XLSX không có formula injection | Có — Excel parse công thức trong xlsx |
| Thư viện xlsx tự stream | Phần lớn dựng toàn bộ workbook trong RAM |
| Format tiền thành string rồi gửi XLSX là ổn | Excel không tính được; gửi số + `numFmt` |
| Tăng timeout là cách sửa export chậm | Export lớn nên là job |
| Puppeteer nhẹ vì "chỉ render HTML" | Nó là một Chromium: 200–400MB |

## Debugging

1. **Nghi CSV injection** → export một record có tên `=1+1` và mở bằng Excel thật. Ba mươi giây, và nó cho câu trả lời dứt khoát.
2. **Excel hiện sai tiếng Việt** → kiểm tra BOM: `xxd file.csv | head -1` (phải bắt đầu `efbb bf`).
3. **RAM tăng theo số dòng** → còn `findMany()` ở đâu đó; grep trong code export.
4. **504 khi export** → so thời gian export với `proxy_read_timeout`; và cân nhắc chuyển sang job.
5. **File tải về không hoàn chỉnh** → lỗi giữa stream; kiểm tra log server (client không thấy status lỗi).
6. **Excel không tính được cột số** → giá trị đang là text; kiểm tra kiểu gửi vào thư viện.
7. **Process Chromium tích luỹ** → `ps aux | grep -c chrome`; thiếu `browser.close()`.
8. **PDF thiếu chữ tiếng Việt** → thiếu font trong image; `fc-list | grep -i noto`.

## Production Considerations

- **`sanitizeCsvCell` cho mọi ô, mọi định dạng** (CSV và XLSX). Đặt nó ở một nơi dùng chung.
- **BOM UTF-8** cho CSV nếu người dùng mở bằng Excel.
- **Stream, không `findMany()`** — cursor generator hoặc driver stream.
- **`select` tường minh** — export không kéo cột không cần.
- **> 100k dòng hoặc PDF → job nền**, trả 202 + link.
- **Signed URL ngắn hạn + lifecycle policy** — export chứa dữ liệu riêng tư, không để vĩnh viễn.
- **`Cache-Control: no-store`** và không cache export ở CDN.
- **Authz chặt hơn endpoint đọc** — export lộ nhiều dữ liệu một lúc. Và **log mọi lần export** (ai, filter gì, bao nhiêu dòng) — đây là dữ liệu cần khi điều tra rò rỉ.
- **Rate limit riêng** cho export, cost cao. Xem [Rate limiting](07-rate-limiting.md).
- **Puppeteer trong worker riêng**, reuse browser, `--disable-dev-shm-usage`, cài font, và giới hạn concurrency.
- **Thời gian và định dạng theo timezone của tổ chức**, không của server. Xem [Date, time & timezone](../../03-database/03-data-modeling/07-datetime-timezone.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| CSV | đơn giản, stream tốt, file nhỏ | không có kiểu dữ liệu, cần BOM, dễ lệch cột |
| XLSX | số/ngày thật, nhiều sheet, format | file lớn, thư viện nặng, cần streaming writer |
| PDF | layout cố định, in được | không stream tốt, tốn RAM/CPU, khó sửa layout |
| Response trực tiếp | đơn giản, tức thì | giữ connection, không retry, giới hạn kích thước |
| Job nền + link | retry, resume, không chờ | thêm hạ tầng, eventual result |
| Puppeteer (HTML→PDF) | dùng lại HTML/CSS | RAM lớn, cần font, phải quản process |
| pdfkit | nhẹ, stream được | layout phức tạp rất tốn công |
| Thêm `'` thoát formula | giữ được giá trị | ô hiển thị có dấu `'` ở một số trình đọc |

## Explain Without Notes

1. CSV formula injection là gì, và vì sao escape CSV không chặn được nó?
2. Vì sao thêm `'` tốt hơn xoá ký tự `=`?
3. Vì sao cần BOM, và điều gì xảy ra nếu thiếu?
4. Ba mức export theo số dòng, và kiến trúc tương ứng?
5. Ba điểm XLSX hơn CSV, và điều bắt buộc khi gửi tiền vào XLSX?
6. Vì sao Puppeteer không được chạy trong request handler?

## Related

- [Upload & download file](09-file-upload-download.md) — chiều ngược lại
- [Streams & buffers](../01-nodejs/runtime-io/01-streams-buffers.md) — `pipeline`, backpressure
- [Pagination](04-pagination-filtering-sorting.md) — cursor để stream
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md) — export lớn là job
- [File storage](../05-integrations/03-file-storage.md) — signed URL, lifecycle
- [Money & Decimal](../../03-database/03-data-modeling/08-money-decimal.md) — số vào XLSX
- [Date, time & timezone](../../03-database/03-data-modeling/07-datetime-timezone.md) — ngày trong export
- [Injection](../../05-cross-cutting/security/02-injection.md) — họ lỗ hổng injection
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz cho export
- [Rate limiting](07-rate-limiting.md)
