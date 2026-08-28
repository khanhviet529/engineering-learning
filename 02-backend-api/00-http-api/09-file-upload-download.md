---
level: intermediate
area: backend
prerequisites:
  - 01-http-request-response.md
related:
  - ../05-integrations/03-file-storage.md
  - ../01-nodejs/runtime-io/01-streams-buffers.md
  - ../../05-cross-cutting/security/02-injection.md
---

# Upload & download file

> `Content-Type: image/png` là **do client khai báo**. Nó không có nghĩa file đó là PNG. Đây là gốc của gần như mọi lỗ hổng upload.

## Position

```text
Browser (multipart/form-data)
      ↓ hoặc presigned URL → thẳng lên storage
Proxy (giới hạn kích thước)
      ↓
App (validate, không buffer)
      ↓
Storage (S3/R2) → CDN → download
```

## Problem

```ts
// Endpoint upload avatar, 8 dòng, và có 6 lỗ hổng
@Post('avatar')
@UseInterceptors(FileInterceptor('file'))
async upload(@UploadedFile() file: Express.Multer.File) {
  const name = file.originalname;
  await fs.writeFile(`./uploads/${name}`, file.buffer);
  return { url: `/uploads/${name}` };
}
```

Sáu vấn đề, và không cái nào gây lỗi khi test bằng một ảnh bình thường:

| Vấn đề | Khai thác |
|---|---|
| Tin `originalname` | `../../.env` → **path traversal**, ghi đè file hệ thống |
| Không kiểm tra kích thước | upload 10GB → hết đĩa, hoặc hết RAM (`file.buffer`) |
| Tin `Content-Type` | `.php`/`.html` với header `image/png` |
| Không kiểm tra nội dung thật | polyglot file: vừa là ảnh hợp lệ vừa là script |
| Lưu cùng máy chạy app | mất khi container restart; không scale |
| Serve từ cùng domain | HTML upload lên → **stored XSS** trên domain của bạn |

`file.buffer` là vấn đề riêng: nó load **toàn bộ** file vào RAM. Với 20 người upload 100MB cùng lúc, đó là 2GB. Xem [Streams & buffers](../01-nodejs/runtime-io/01-streams-buffers.md).

## Mental Model

Hai kiến trúc upload, và lựa chọn này quyết định mọi thứ khác:

```text
A. QUA SERVER
   Browser → App → Storage
   ✅ validate được nội dung trước khi lưu, xử lý được (resize, strip EXIF)
   ❌ băng thông và RAM/CPU của app; app phải chịu tải upload

B. PRESIGNED URL (thẳng lên storage)
   Browser → App: "cho tôi URL để upload"
   App → Browser: URL có ký, hết hạn 5 phút, giới hạn kích thước
   Browser → Storage: PUT thẳng, KHÔNG qua app
   Storage → App: webhook/event "đã có file mới"
   ✅ app không chịu băng thông; scale tốt
   ❌ validate nội dung phải làm SAU khi file đã lên
```

Quy tắc chọn:

```text
File nhỏ (< 5MB), cần validate/xử lý ngay  → A
File lớn, nhiều, hoặc video/ảnh gốc         → B
Bất kể chọn gì: KHÔNG lưu vào filesystem của app
```

Và nguyên tắc bao trùm:

> **Mọi thứ client gửi về file đều là dữ liệu không tin cậy: tên, kích thước khai báo, `Content-Type`, và phần mở rộng.**
>
> Chỉ có **nội dung byte thật** là bằng chứng.

## How It Works

### Validate — bốn lớp, theo thứ tự

```ts
// 1. Kích thước — ở PROXY trước, ở app sau
// nginx: client_max_body_size 10m;
// Nếu chỉ giới hạn ở app, request 10GB vẫn đi hết qua network trước khi bị chặn

// 2. Magic bytes — bằng chứng thật về loại file
import { fileTypeFromBuffer } from 'file-type';

const detected = await fileTypeFromBuffer(buffer.subarray(0, 4100));
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

if (!detected || !ALLOWED.has(detected.mime)) {
  throw new ValidationError('Loại file không được phép');
}
// Chú ý: so với detected.mime, KHÔNG so với file.mimetype (client khai báo)

// 3. Tên file — SINH MỚI, không dùng tên client gửi
const ext = detected.ext;                       // từ magic bytes, không từ tên
const key = `avatars/${userId}/${uuidv7()}.${ext}`;

// 4. Với ảnh: RE-ENCODE để loại bỏ payload nhúng
import sharp from 'sharp';
const clean = await sharp(buffer)
  .resize(512, 512, { fit: 'cover' })
  .rotate()                                     // áp dụng EXIF orientation rồi bỏ EXIF
  .webp({ quality: 82 })
  .toBuffer();
```

Lớp 4 là lớp bị bỏ nhiều nhất và có giá trị cao: **re-encode ảnh phá mọi payload nhúng**. Một file vừa là PNG hợp lệ vừa chứa PHP script sẽ không còn script sau khi đi qua `sharp`. Nó cũng xoá EXIF — vốn chứa **toạ độ GPS** của người dùng.

Bốn lớp này không thay thế nhau. Magic bytes chặn file sai loại; re-encode chặn payload trong file đúng loại.

### Streaming — không buffer

```ts
// ❌ Toàn bộ file vào RAM
@UseInterceptors(FileInterceptor('file'))
async upload(@UploadedFile() file: Express.Multer.File) {
  file.buffer;    // 100MB × 20 request đồng thời = 2GB
}

// ✅ Stream thẳng lên storage, RAM giữ ở mức chunk
import { pipeline } from 'node:stream/promises';

@Post('upload')
async upload(@Req() req: FastifyRequest) {
  const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
  if (!data) throw new ValidationError('Thiếu file');

  const key = `uploads/${uuidv7()}`;
  await this.storage.uploadStream(key, data.file);   // stream → S3
  return { key };
}
```

Đánh đổi thật của streaming: bạn **không có toàn bộ file** để kiểm tra magic bytes trước khi lưu. Hai cách xử lý:

```text
1. Đọc 4KB đầu để detect, rồi stream phần còn lại
   → validate được loại file, nhưng không re-encode được
2. Stream lên vùng "quarantine", validate/xử lý bằng job, rồi move sang vùng public
   → validate đầy đủ; file không public cho tới khi sạch
```

Cách 2 là kiến trúc đúng cho file lớn. Xem [File storage](../05-integrations/03-file-storage.md).

### Presigned URL

```ts
// App chỉ cấp quyền, không chịu băng thông
@Post('uploads/presign')
async presign(@Body() dto: PresignDto, @CurrentUser() user: User) {
  // Validate những gì validate được TRƯỚC
  if (!ALLOWED_MIME.has(dto.contentType)) throw new ValidationError('Loại không hợp lệ');
  if (dto.size > MAX_SIZE) throw new ValidationError('Quá lớn');

  const key = `quarantine/${user.id}/${uuidv7()}`;

  const url = await getSignedUrl(
    this.s3,
    new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: dto.contentType,
      ContentLength: dto.size,         // ràng buộc kích thước vào signature
    }),
    { expiresIn: 300 },                // 5 phút
  );

  await this.prisma.upload.create({
    data: { key, userId: user.id, status: 'PENDING', declaredType: dto.contentType },
  });

  return { url, key };
}
```

Bốn điều bắt buộc với presigned URL:

1. **`expiresIn` ngắn** (5–15 phút) — URL bị leak thì chỉ dùng được trong khoảng đó.
2. **Ràng buộc `ContentLength` và `ContentType`** vào signature — nếu không, client upload 10GB hoặc loại file khác.
3. **Ghi một record `PENDING`** — nếu không, bạn có file trong storage mà database không biết (orphan), và không cách nào dọn.
4. **Upload vào vùng `quarantine`, không public** — validate bằng job rồi mới move.

Bước 3 là bước hay bị bỏ, và nó tạo ra file rác tích luỹ vô hạn.

### Download — nơi tạo ra stored XSS

```ts
// ❌ Serve file người dùng upload từ cùng domain
app.use('/uploads', express.static('./uploads'));
// Upload evil.html → https://yourapp.com/uploads/evil.html
// → script chạy trên domain của bạn, đọc được cookie, localStorage
```

Bốn cách phòng, dùng kết hợp:

```text
1. Domain riêng cho file người dùng
   yourapp.com          → app
   files-yourapp.com    → file (origin KHÁC → không chia sẻ cookie/storage)

2. Header bắt buộc khi serve
   Content-Disposition: attachment; filename="..."     → tải về, không render
   X-Content-Type-Options: nosniff                     → browser không đoán loại
   Content-Security-Policy: default-src 'none'         → không chạy gì

3. KHÔNG trả Content-Type do client khai báo
   Trả loại đã detect, hoặc application/octet-stream

4. Presigned GET URL cho file riêng tư — hết hạn ngắn
```

Điểm 1 là biện pháp mạnh nhất: nếu file nằm ở origin khác, một file HTML độc hại cũng không đọc được cookie của app.

```ts
// Download file riêng tư: signed URL, không proxy qua app
@Get('files/:id/url')
async getDownloadUrl(@Param('id') id: string, @CurrentUser() user: User) {
  const file = await this.files.findForUser(id, user.id);   // AUTHZ ở đây
  if (!file) throw new NotFoundError('file', id);

  const url = await getSignedUrl(
    this.s3,
    new GetObjectCommand({
      Bucket: this.bucket,
      Key: file.key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
      ResponseContentType: file.detectedMime,
    }),
    { expiresIn: 60 },
  );
  return { url };
}
```

**Authorization phải ở app**, không ở storage. Object trong bucket phải **private**; app kiểm tra quyền rồi mới cấp signed URL. Bucket public là cách lộ dữ liệu phổ biến nhất. Xem [Access control](../../05-cross-cutting/security/04-access-control.md).

`encodeURIComponent` cho filename: tên file có ký tự đặc biệt (dấu ngoặc kép, newline) có thể **header injection**.

### Path traversal

```ts
// ❌ Tin tên client gửi
const path = `./uploads/${file.originalname}`;
// originalname = "../../../etc/passwd" hoặc "..\\..\\windows\\system32\\..."

// ✅ Không dùng tên client cho đường dẫn — sinh mới hoàn toàn
const key = `uploads/${userId}/${uuidv7()}.${detectedExt}`;

// Nếu BUỘC phải giữ tên gốc (để hiển thị), lưu nó như DỮ LIỆU, không như đường dẫn
await prisma.file.create({
  data: { key, displayName: sanitize(file.originalname) },
});
```

Nguyên tắc: **tên file client gửi là metadata để hiển thị, không bao giờ là phần của đường dẫn.**

### Idempotency và dọn rác

```ts
// Client sinh uploadId → retry không tạo file trùng
const uploadId = uuidv7();

// Job dọn: file PENDING quá lâu = upload thất bại giữa đường
async cleanupStale() {
  const stale = await this.prisma.upload.findMany({
    where: { status: 'PENDING', createdAt: { lt: subHours(new Date(), 24) } },
    take: 500,
  });
  for (const u of stale) {
    await this.storage.delete(u.key).catch(() => {});   // có thể chưa tồn tại
    await this.prisma.upload.update({ where: { id: u.id }, data: { status: 'EXPIRED' } });
  }
}
```

Không có job này, mỗi upload bị hủy giữa đường để lại một file trả tiền vĩnh viễn.

## Example

```text
Luồng upload avatar đầy đủ — presigned + quarantine

1. POST /uploads/presign          → validate size/type khai báo, tạo record PENDING,
                                     trả signed URL vào quarantine/
2. PUT <signed url>               → browser upload thẳng lên storage
3. POST /uploads/:id/complete     → app: tải 4KB đầu, check magic bytes
                                     → nếu ảnh: re-encode bằng sharp (strip EXIF)
                                     → move sang avatars/ (public-read qua CDN)
                                     → update record: status=READY, detectedMime, size thật
4. Job hàng ngày                  → dọn PENDING > 24h

Giới hạn ở mỗi tầng:
  CDN/WAF     10MB
  nginx       client_max_body_size 10m
  presign     ContentLength ràng buộc vào signature
  app         kiểm tra size thật sau upload (client có thể nói dối)
```

Chú ý bước 3 kiểm tra **size thật** — `ContentLength` trong signature ràng buộc được, nhưng vẫn nên đối chiếu lại với metadata thật của object.

## Prediction

1. `Content-Type: image/png` nhưng nội dung là HTML — validate bằng `file.mimetype` có phát hiện?
2. `originalname = "../../.env"`, code dùng `./uploads/${originalname}` — file ghi vào đâu?
3. `file.buffer` với 20 request × 100MB đồng thời — RAM?
4. Chỉ giới hạn kích thước ở app, không ở nginx — request 5GB đi được bao xa?
5. Serve file upload từ `yourapp.com/uploads/`, ai đó upload `evil.html` — họ đọc được gì?
6. Bucket public-read, app kiểm tra authz trước khi trả URL — file có an toàn?
7. Presigned URL không ràng buộc `ContentLength` — client upload được bao nhiêu?
8. Presign nhưng không tạo record trong DB, client hủy giữa đường — điều gì còn lại?
9. Ảnh JPEG có EXIF GPS, serve nguyên bản — lộ gì?
10. Re-encode ảnh bằng `sharp` — payload PHP nhúng trong ảnh còn không?

<details>
<summary>Đáp án</summary>

1. **Không** — `mimetype` là do client khai báo.
2. Ra ngoài `./uploads/` — path traversal, có thể ghi đè `.env`.
3. ~2GB → OOM.
4. Đi **hết** qua network rồi mới bị chặn — băng thông đã tốn.
5. Cookie, localStorage, session của app — stored XSS trên domain của bạn.
6. **Không** — ai có key đều tải được, bỏ qua authz của app.
7. Bao nhiêu cũng được — giới hạn duy nhất là của storage.
8. Một file trong storage mà DB không biết — orphan, trả tiền vĩnh viễn.
9. Toạ độ GPS nơi chụp ảnh.
10. Không — re-encode phá mọi dữ liệu không phải pixel.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi tên `evil.html` → `evil.png`, set `Content-Type: image/png`, upload | Qua nếu chỉ check mimetype |
| Thêm check magic bytes | Bị chặn |
| `originalname = "../test.txt"` | File ra ngoài thư mục dự định |
| Upload 500MB với `file.buffer`, xem `process.memoryUsage()` | RAM tăng bằng kích thước file |
| Bỏ `client_max_body_size`, upload 2GB | Đo băng thông tiêu tốn trước khi app chặn |
| Upload HTML rồi truy cập qua domain app | Script chạy; đọc `document.cookie` |
| Serve từ domain riêng, làm lại | Không đọc được cookie |
| Bỏ `Content-Disposition: attachment` với file HTML | Browser render thay vì tải |
| Bucket public, truy cập trực tiếp bằng key | Bỏ qua toàn bộ authz |
| Upload ảnh có EXIF GPS, xem metadata sau khi serve | Lộ toạ độ |
| Re-encode rồi kiểm tra lại | EXIF mất |
| Presign rồi hủy upload, đếm record vs object | Orphan |

Thí nghiệm 6–7 cạnh nhau là thí nghiệm quan trọng nhất — nó cho thấy vì sao domain riêng không phải chi tiết nhỏ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `Content-Type` cho biết loại file | Client khai báo; chỉ magic bytes là bằng chứng |
| Kiểm tra phần mở rộng là đủ | Đổi tên file mất 1 giây |
| Magic bytes là đủ | Polyglot file vừa hợp lệ vừa chứa payload → cần re-encode |
| Giới hạn kích thước ở app là đủ | Băng thông đã tốn; cần giới hạn ở proxy/CDN |
| Serve file từ cùng domain là tiện | Đó là stored XSS |
| Bucket public + authz ở app là an toàn | Ai có key đều tải được |
| `file.buffer` tiện và ổn | Nó là OOM đang chờ |
| Presigned URL không cần validate | Cần: type, size ràng buộc vào signature, và validate lại sau |
| Giữ tên file gốc là bình thường | Là path traversal nếu dùng làm đường dẫn |

## Debugging

1. **Nghi lỗ hổng upload** → thử ngay ba thứ: đổi tên file, sửa `Content-Type`, và `../` trong tên. Ba phút, và nó tìm ra phần lớn vấn đề.
2. **Kiểm tra loại file thật đã lưu**:
   ```bash
   file uploads/*                    # Linux: đọc magic bytes
   ```
   Nếu có file không đúng loại khai báo, validation đang thiếu.
3. **RAM tăng theo kích thước upload** → đang buffer; chuyển sang stream.
4. **Kiểm tra bucket có public không**: thử `curl` một object key **không** kèm signature.
5. **Đếm orphan**: so số object trong storage với số record trong DB. Chênh lệch = thiếu job dọn.
6. **Kiểm tra header khi download**: `curl -I <url>` — có `Content-Disposition` và `nosniff` chưa.
7. **EXIF còn không**: `exiftool file.jpg` sau khi upload và serve.

## Production Considerations

- **Giới hạn kích thước ở mọi tầng**: CDN/WAF → proxy → presign signature → app.
- **Magic bytes + allowlist**, không dùng `Content-Type` của client.
- **Re-encode ảnh** (sharp) — nó phá payload và xoá EXIF/GPS cùng lúc.
- **Sinh tên file mới**; tên gốc chỉ là metadata hiển thị.
- **Bucket private**, truy cập qua signed URL ngắn hạn, authz ở app.
- **Domain riêng cho file người dùng** + `Content-Disposition: attachment` + `nosniff` + CSP.
- **Quarantine → validate → move** cho file lớn hoặc từ nguồn không tin cậy.
- **Record `PENDING` + job dọn** để không tích luỹ orphan.
- **Rate limit** endpoint upload và presign. Xem [Rate limiting](07-rate-limiting.md).
- **Virus scan** (ClamAV hoặc dịch vụ) nếu file được người khác tải về — bắt buộc với nền tảng chia sẻ file.
- **Log mọi upload** với userId, key, size, detectedMime — cần cho điều tra.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Upload qua server | validate và xử lý ngay được | băng thông, RAM/CPU của app |
| Presigned URL | app không chịu tải, scale tốt | validate phải làm sau; nhiều bước hơn |
| Buffer toàn bộ | validate/xử lý đơn giản | RAM theo kích thước file |
| Stream | RAM không đổi | không có toàn bộ file để validate ngay |
| Quarantine + job | validate đầy đủ, an toàn nhất | file chưa dùng được ngay; thêm job |
| Re-encode ảnh | phá payload, xoá EXIF, giảm kích thước | tốn CPU, mất chất lượng gốc |
| Domain riêng cho file | chặn stored XSS | thêm domain, thêm cấu hình CORS/CDN |
| Signed URL ngắn hạn | an toàn | client phải xin URL mới khi hết hạn |

## Explain Without Notes

1. Vì sao `Content-Type` không đáng tin, và cái gì đáng tin?
2. Bốn lớp validate, và vì sao lớp 4 (re-encode) không thay được lớp 2 (magic bytes)?
3. Hai kiến trúc upload — chọn theo tiêu chí gì?
4. Vì sao serve file người dùng từ cùng domain là stored XSS?
5. Bốn điều bắt buộc với presigned URL?
6. Vì sao bucket public + authz ở app vẫn không an toàn?

## Related

- [File storage](../05-integrations/03-file-storage.md) — S3/R2, CDN, lifecycle, quarantine
- [Streams & buffers](../01-nodejs/runtime-io/01-streams-buffers.md) — vì sao không buffer
- [Export & reporting](10-export-and-reporting.md) — chiều ngược lại
- [HTTP request/response](01-http-request-response.md) — header, `Content-Disposition`
- [Rate limiting](07-rate-limiting.md) — bảo vệ endpoint upload
- [Injection](../../05-cross-cutting/security/02-injection.md) — path traversal
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — stored XSS từ file
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz cho file riêng tư
- [CSP & browser security](../../01-web-frontend/00-web-foundations/07-csp-browser-security.md)
