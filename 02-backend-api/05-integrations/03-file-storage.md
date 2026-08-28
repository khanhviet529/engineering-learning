---
level: intermediate
area: backend
prerequisites:
  - ../00-http-api/09-file-upload-download.md
related:
  - ../../04-infrastructure/05-platforms/02-cloudflare-and-edge.md
  - ../../01-web-frontend/00-web-foundations/02-http-browser-cache.md
---

# File storage: S3, CDN, lifecycle

> Object storage không phải filesystem. Không có thư mục, không có rename, không có append, và **không có transaction với database của bạn**. Điểm cuối là gốc của mọi file rác và mọi record trỏ vào file không tồn tại.

## Position

```text
App → Object storage (S3 / R2 / GCS)
         ↓ signed URL hoặc CDN
      CDN (CloudFront / Cloudflare)
         ↓
      Browser
```

## Problem

```ts
// Lưu file — 2 dòng, và một lớp bug không thấy ngay
await fs.writeFile(`./uploads/${key}`, buffer);
await this.prisma.file.create({ data: { key, userId } });
```

Bốn vấn đề, xếp theo mức độ khó phát hiện:

| Vấn đề | Khi nào lộ ra |
|---|---|
| Lưu vào filesystem của app | container restart → **mất hết file** |
| Không scale | 3 pod → pod A lưu, pod B không thấy file |
| Không có transaction giữa storage và DB | process chết giữa hai dòng → **orphan** |
| Đĩa đầy | lúc 3 giờ sáng, và mọi upload thất bại |

Vấn đề thứ ba là vấn đề dai dẳng nhất:

```text
Ghi storage OK → process chết → DB không có record
  → file trong storage, không ai biết, trả tiền vĩnh viễn

Ghi DB OK → ghi storage lỗi
  → record trỏ vào file không tồn tại → 404 cho người dùng
```

Đây chính là **dual-write** — cùng bài toán với [outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md), nhưng với storage thay vì message broker. Và không có cách nào làm nó atomic.

## Mental Model

```text
Object storage ≠ filesystem

filesystem              object storage
├── thư mục thật        chỉ có KEY dạng string ("a/b/c.jpg" — dấu / là ký tự thường)
├── rename rẻ           rename = COPY + DELETE (tốn tiền và thời gian)
├── append được         KHÔNG (phải ghi lại toàn bộ object)
├── list rẻ             list ĐẮT và phân trang (đừng list để đếm)
├── consistency ngay    read-after-write consistent, nhưng LIST có thể chậm
└── transaction với DB  KHÔNG BAO GIỜ
```

Từ đó ra nguyên tắc chi phối:

> **Database là nguồn sự thật về "file nào tồn tại". Storage chỉ giữ byte.**
>
> Và vì hai bên không atomic, bạn phải **chấp nhận trạng thái trung gian** và có job dọn.

Thứ tự ghi đúng:

```text
1. INSERT record status=PENDING     (DB biết trước)
2. Upload lên storage
3. UPDATE record status=READY

Nếu chết ở bước 2 → record PENDING mồ côi → job dọn theo tuổi
Nếu chết ở bước 3 → file có, record PENDING → job đối chiếu và fix

⇒ Không bao giờ có record READY trỏ vào file không tồn tại
```

Đây là điểm quan trọng: thứ tự này biến "orphan không phát hiện được" thành "orphan có nhãn và dọn được".

## How It Works

### Key design — quyết định khó đổi

```text
✅ files/{orgId}/{yyyy}/{mm}/{uuid}.{ext}
      │         │            │
      │         │            └─ uuid: không đoán được, không trùng
      │         └─ theo thời gian: lifecycle policy theo prefix, dễ archive
      └─ theo tenant: xoá tenant = xoá prefix; phân quyền theo prefix

❌ uploads/{originalFilename}          → trùng tên, path traversal
❌ {userId}/{originalFilename}         → đoán được, và trùng
❌ files/{uuid}                        → không biết loại, không lifecycle được
```

Ba điều key phải làm được: **không trùng**, **không đoán được**, và **cho phép lifecycle/phân quyền theo prefix**.

Lưu ý: rename object là copy + delete. Nên nếu bạn cần "di chuyển file giữa các thư mục" thường xuyên, đó là dấu hiệu key design sai — thông tin thay đổi nên nằm trong **database**, không trong key.

### Ba giai đoạn: quarantine → xử lý → public

```ts
// Bucket layout
// quarantine/  — vừa upload, CHƯA validate. Không ai đọc được.
// files/       — đã validate. Đọc qua signed URL hoặc CDN.
// exports/     — file sinh ra, TTL ngắn.

@Injectable()
export class StorageService {
  async completeUpload(uploadId: string) {
    const upload = await this.prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });

    // 1. Lấy metadata thật từ storage (client có thể nói dối)
    const head = await this.s3.send(new HeadObjectCommand({
      Bucket: this.bucket, Key: upload.quarantineKey,
    }));
    if ((head.ContentLength ?? 0) > MAX_SIZE) {
      await this.deleteObject(upload.quarantineKey);
      throw new ValidationError('File quá lớn');
    }

    // 2. Tải phần đầu để check magic bytes
    const head4k = await this.getRange(upload.quarantineKey, 0, 4100);
    const detected = await fileTypeFromBuffer(head4k);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      await this.deleteObject(upload.quarantineKey);
      throw new ValidationError('Loại file không được phép');
    }

    // 3. Xử lý nếu là ảnh (re-encode phá payload + xoá EXIF)
    const finalKey = `files/${upload.orgId}/${format(new Date(), 'yyyy/MM')}/${upload.id}.${detected.ext}`;
    if (detected.mime.startsWith('image/')) {
      const buf = await this.getObject(upload.quarantineKey);
      const clean = await sharp(buf).rotate().webp({ quality: 82 }).toBuffer();
      await this.putObject(finalKey, clean, 'image/webp');
    } else {
      // Không phải ảnh: copy trong storage, không tải về app
      await this.s3.send(new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${upload.quarantineKey}`,
        Key: finalKey,
        MetadataDirective: 'REPLACE',
        ContentType: detected.mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    }

    // 4. Dọn quarantine + cập nhật DB
    await this.deleteObject(upload.quarantineKey);
    await this.prisma.upload.update({
      where: { id: uploadId },
      data: { status: 'READY', key: finalKey, mime: detected.mime, size: head.ContentLength },
    });
    return finalKey;
  }
}
```

Chi tiết đáng chú ý: với file không phải ảnh, dùng **`CopyObjectCommand`** — copy xảy ra **trong** storage, không tải về app. Với file 500MB, đó là khác biệt giữa vài giây và vài phút cộng 500MB băng thông.

Xem [Upload & download file](../00-http-api/09-file-upload-download.md) cho chi tiết validate.

### Cache-Control — quyết định quan trọng nhất về hiệu năng

```text
Key có UUID (không bao giờ đổi nội dung)
  → Cache-Control: public, max-age=31536000, immutable
  → CDN và browser cache 1 năm; đổi ảnh = key mới

Key theo tên logic ("avatars/{userId}.jpg", nội dung ĐỔI)
  → Cache-Control: public, max-age=60, must-revalidate
  → hoặc: thêm version vào URL (?v=<hash>) và cache 1 năm

File riêng tư
  → Cache-Control: private, no-store
  → và KHÔNG qua CDN công khai
```

Nguyên tắc: **key immutable + cache dài** thay vì **key cố định + invalidate CDN**. Invalidate CDN chậm, tốn tiền, và không chạm được cache trên browser người dùng. Đổi key là tức thì và miễn phí.

Đây là cùng nguyên tắc với asset có hash trong tên. Xem [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md).

### File riêng tư — bucket private + signed URL

```ts
// Bucket LUÔN private. App kiểm tra quyền rồi cấp URL ngắn hạn.
@Get('files/:id/url')
async getUrl(@Param('id') id: string, @CurrentUser() user: User) {
  const file = await this.prisma.file.findFirst({
    where: { id, orgId: user.orgId, status: 'READY' },   // AUTHZ trong query
  });
  if (!file) throw new NotFoundError('file', id);        // 404 không 403

  const url = await getSignedUrl(this.s3, new GetObjectCommand({
    Bucket: this.bucket,
    Key: file.key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
  }), { expiresIn: 300 });

  return { url, expiresIn: 300 };
}
```

Ba điều bắt buộc:

1. **Bucket private.** Bucket public + authz ở app = không có authz, vì ai có key đều tải được.
2. **Authz trong query** (`orgId: user.orgId`), không kiểm tra sau khi query.
3. **URL hết hạn ngắn** (5–15 phút) — nó sẽ nằm trong history, log của proxy, và có thể được chia sẻ.

Với file cần bảo vệ qua CDN: dùng **signed cookie** (CloudFront) hoặc **Cloudflare Signed URLs** — chúng cho phép cache ở CDN mà vẫn kiểm soát truy cập.

### Lifecycle policy — tự dọn, không viết cron

```json
{
  "Rules": [
    {
      "Id": "delete-quarantine",
      "Filter": { "Prefix": "quarantine/" },
      "Expiration": { "Days": 1 },
      "Status": "Enabled"
    },
    {
      "Id": "delete-exports",
      "Filter": { "Prefix": "exports/" },
      "Expiration": { "Days": 7 },
      "Status": "Enabled"
    },
    {
      "Id": "archive-old-files",
      "Filter": { "Prefix": "files/" },
      "Transitions": [
        { "Days": 90, "StorageClass": "STANDARD_IA" },
        { "Days": 365, "StorageClass": "GLACIER_IR" }
      ],
      "Status": "Enabled"
    },
    {
      "Id": "abort-incomplete-multipart",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 },
      "Status": "Enabled"
    }
  ]
}
```

Rule cuối là rule bị bỏ nhiều nhất và tốn tiền âm thầm: **multipart upload chưa hoàn thành vẫn chiếm dung lượng** và không hiện trong danh sách object thông thường. Với upload file lớn thất bại thường xuyên, đây là chi phí tích luỹ mà bạn không thấy trong `ls`.

Lifecycle policy rẻ hơn và đáng tin hơn cron job tự viết — nó chạy ở tầng storage, không phụ thuộc app của bạn còn sống.

### Đối chiếu — job phải có

```ts
// 1. Record PENDING quá lâu → upload thất bại giữa đường
async cleanupStalePending() {
  const stale = await this.prisma.upload.findMany({
    where: { status: 'PENDING', createdAt: { lt: subHours(new Date(), 24) } },
    take: 500,
  });
  for (const u of stale) {
    await this.deleteObject(u.quarantineKey).catch(() => {});   // có thể chưa tồn tại
    await this.prisma.upload.update({ where: { id: u.id }, data: { status: 'EXPIRED' } });
  }
}

// 2. Record READY nhưng object không tồn tại → lỗi nghiêm trọng, cần alert
async verifyIntegrity(sample = 1000) {
  const files = await this.prisma.file.findMany({
    where: { status: 'READY' }, take: sample, orderBy: { checkedAt: 'asc' },
  });
  for (const f of files) {
    const exists = await this.objectExists(f.key);
    if (!exists) {
      this.logger.error({ fileId: f.id, key: f.key }, 'DB record trỏ vào object không tồn tại');
      await this.metrics.increment('storage.missing_object');
    }
    await this.prisma.file.update({ where: { id: f.id }, data: { checkedAt: new Date() } });
  }
}
```

Job 2 phát hiện loại lỗi mà không có gì khác phát hiện được — và nếu nó tăng, bạn có vấn đề về thứ tự ghi hoặc ai đó xoá object trực tiếp.

Chiều còn lại (object không có record) khó hơn: `ListObjects` trên bucket lớn rất đắt. Thực dụng: dựa vào lifecycle policy cho `quarantine/`, và chỉ đối chiếu đầy đủ khi có nghi ngờ.

### Chọn provider

| | S3 | Cloudflare R2 | GCS |
|---|---|---|---|
| Egress (tải ra) | **tính tiền, đắt** | **miễn phí** | tính tiền |
| API | chuẩn de-facto | **tương thích S3** | riêng + tương thích S3 |
| Tích hợp CDN | CloudFront | **built-in** | Cloud CDN |
| Lifecycle | đầy đủ | có, đơn giản hơn | đầy đủ |
| Vendor lock | cao | thấp (S3-compatible) | cao |

**Egress miễn phí của R2** là khác biệt lớn nhất về chi phí nếu bạn serve nhiều file cho người dùng. Với 10TB/tháng, khác biệt là hàng nghìn đô. Nhưng: nếu bạn đã ở AWS và file chủ yếu được đọc bởi service nội bộ, egress không phải vấn đề.

Vì R2 tương thích S3 API, dùng `@aws-sdk/client-s3` với `endpoint` khác — nên chuyển đổi không đắt. Đây là lý do dùng S3-compatible API thay vì SDK riêng của provider.

Xem [Cloudflare & edge](../../04-infrastructure/05-platforms/02-cloudflare-and-edge.md).

### CDN — cache và invalidate

```text
CDN cache theo URL. Ba quyết định:

1. Cache key      có bao gồm query string? cookie? header?
                  → mặc định nên bỏ qua cookie cho file tĩnh
2. TTL            từ Cache-Control của origin, hoặc override ở CDN
3. Invalidate     CHẬM và TỐN TIỀN
                  → đừng dựa vào nó; dùng key immutable
```

Và cẩn thận: **file riêng tư không được đi qua CDN công khai.** Nếu `Cache-Control: public` trên một file có dữ liệu người dùng, CDN sẽ trả nó cho người khác. Đây là cùng lỗi với [`public` trong HTTP cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md).

## Example

```text
Kiến trúc storage hoàn chỉnh

Bucket (private) — một bucket, nhiều prefix
  quarantine/{orgId}/{uuid}        lifecycle: xoá sau 1 ngày
  files/{orgId}/{yyyy}/{mm}/{uuid} lifecycle: IA sau 90d, Glacier sau 365d
  exports/{orgId}/{uuid}           lifecycle: xoá sau 7 ngày
  + AbortIncompleteMultipartUpload: 7 ngày

Luồng upload
  presign(quarantine) → PUT → complete() → validate → copy/re-encode → files/
  → DB: PENDING → READY

Đọc
  file công khai (avatar)  → CDN, Cache-Control immutable, key có uuid
  file riêng tư            → signed URL 5 phút, authz ở app, KHÔNG qua CDN công khai

Job
  hàng giờ  : cleanupStalePending()
  hàng ngày : verifyIntegrity(sample)
  metric    : storage.missing_object, upload.pending_count, bucket size
```

## Prediction

1. Lưu file vào `./uploads/` trong container, container restart — file còn không?
2. 3 pod, pod A lưu file vào local disk, request tiếp theo tới pod B — kết quả?
3. Ghi storage OK rồi process chết trước khi INSERT DB — còn lại gì?
4. INSERT DB status=READY trước rồi upload lỗi — người dùng thấy gì?
5. Thứ tự PENDING → upload → READY, chết giữa upload — trạng thái?
6. Rename `files/a.jpg` → `files/b.jpg` trên S3 — chi phí?
7. Bucket public-read, app kiểm tra authz trước khi trả URL — file an toàn?
8. `Cache-Control: public` cho file có dữ liệu người dùng, qua CDN — hậu quả?
9. Không có `AbortIncompleteMultipartUpload`, 1000 upload lớn thất bại — chi phí?
10. Key là `avatars/{userId}.jpg`, người dùng đổi ảnh, CDN cache 1 năm — họ thấy ảnh nào?

<details>
<summary>Đáp án</summary>

1. **Mất** — filesystem container là ephemeral.
2. 404 — pod B không có file đó.
3. File trong storage, không record → **orphan**, trả tiền vĩnh viễn, không phát hiện được.
4. 404 khi tải — record trỏ vào file không tồn tại.
5. Record `PENDING` → job dọn theo tuổi phát hiện được. Đây là lý do thứ tự này đúng.
6. **COPY + DELETE** — tốn thời gian và tiền, không phải thao tác metadata.
7. **Không** — ai có key đều tải được, bỏ qua authz.
8. CDN trả file của người này cho người khác — lộ dữ liệu.
9. Dung lượng tích luỹ **không hiện trong danh sách object** — chi phí ẩn.
10. **Ảnh cũ**, tới 1 năm. Cần key immutable hoặc `?v=hash`.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Lưu vào local disk, `docker restart` | File mất |
| Scale 2 pod, upload rồi tải nhiều lần | Một nửa request 404 |
| Kill process giữa upload và INSERT | Object mồ côi trong bucket |
| Đảo thứ tự (DB READY trước) rồi làm upload lỗi | Record trỏ vào file không tồn tại |
| Dùng thứ tự PENDING → upload → READY, làm lại | Record PENDING, job dọn được |
| `CopyObjectCommand` vs tải về rồi upload lại, file 200MB | Đo thời gian và băng thông |
| Bucket public, `curl` object key không có signature | Tải được — bỏ qua authz |
| `Cache-Control: public` cho file riêng tư, tải bằng 2 tài khoản qua CDN | Người thứ hai thấy file người thứ nhất |
| Key cố định + đổi nội dung, cache 1 năm | Người dùng thấy bản cũ |
| Key có UUID, đổi nội dung = key mới | Thấy ngay |
| Bỏ lifecycle cho `quarantine/`, upload 100 file rồi hủy | Dung lượng tăng mãi |
| Multipart upload dở dang, kiểm tra `ListMultipartUploads` | Dung lượng không thấy trong `ListObjects` |

Thí nghiệm 3–5 là chuỗi quan trọng nhất — nó cho thấy thứ tự ghi không phải chi tiết mà là thiết kế.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Object storage như filesystem | Không có thư mục, rename là copy+delete, không append |
| Có thể transaction giữa storage và DB | Không bao giờ — cần thứ tự ghi + job dọn |
| Bucket public + authz ở app là an toàn | Ai có key đều tải được |
| Invalidate CDN là cách cập nhật file | Chậm, tốn tiền, không chạm browser cache. Dùng key mới |
| `ListObjects` để đếm file | Đắt và phân trang; đếm trong DB |
| Lifecycle policy là tính năng phụ | Nó là cách duy nhất dọn đáng tin |
| Multipart dở dang không tốn gì | Nó chiếm dung lượng và không hiện trong list thường |
| S3 và R2 khác nhau nhiều | R2 tương thích S3 API; khác chủ yếu ở egress |
| File riêng tư qua CDN cũng được | `public` là lộ dữ liệu |
| Rename file để tổ chức lại | Thông tin thay đổi nên ở DB, không ở key |

## Debugging

1. **File mất sau deploy** → đang lưu vào filesystem container. Đây là câu trả lời trong hầu hết trường hợp.
2. **404 không đều (một số request được, một số không)** → nhiều pod với local storage.
3. **Đếm orphan**: so số object với số record. Nếu `ListObjects` quá đắt, so trên một prefix nhỏ:
   ```bash
   aws s3 ls s3://bucket/quarantine/ --recursive --summarize | tail -3
   ```
4. **Record trỏ vào object không tồn tại** → chạy `verifyIntegrity`; nếu có, kiểm tra thứ tự ghi và xem có ai xoá object trực tiếp.
5. **Chi phí storage tăng bất thường** → kiểm tra multipart dở dang:
   ```bash
   aws s3api list-multipart-uploads --bucket <bucket>
   ```
6. **CDN trả file cũ** → kiểm tra `Cache-Control` của object thật (`aws s3api head-object`), không tin cấu hình bạn nghĩ đã đặt.
7. **Nghi bucket public** → `curl` một object key mà **không** kèm signature.

## Production Considerations

- **Không bao giờ lưu file vào filesystem của app.**
- **Bucket private**, signed URL ngắn hạn, authz trong query ở app.
- **Thứ tự ghi: DB PENDING → storage → DB READY.** Không đảo.
- **Job dọn PENDING quá tuổi** + **job đối chiếu integrity** với metric và alert.
- **Lifecycle policy** cho mọi prefix, gồm `AbortIncompleteMultipartUpload`.
- **Key immutable (có UUID) + `Cache-Control: immutable`** thay vì invalidate CDN.
- **Prefix theo tenant và theo thời gian** — cho phép lifecycle, phân quyền, và xoá tenant.
- **`CopyObjectCommand`** cho thao tác trong storage, không tải về app.
- **Server-side encryption** bật (SSE-S3 hoặc SSE-KMS), và bật **versioning** cho bucket quan trọng — nó cứu bạn khi ai đó xoá nhầm.
- **Block Public Access** ở mức account, không chỉ mức bucket.
- **Monitor**: bucket size theo prefix, số object, chi phí egress, số upload PENDING, `storage.missing_object`.
- **Dùng S3-compatible SDK** để chuyển provider không đắt.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Object storage | bền, scale, rẻ | không phải filesystem; không transaction với DB |
| Filesystem container | đơn giản nhất | mất khi restart, không scale |
| Signed URL | authz thật, không qua app | client phải xin URL; hết hạn |
| Proxy file qua app | kiểm soát hoàn toàn, log được | băng thông và RAM của app |
| Key immutable | cache 1 năm, không invalidate | đổi nội dung = record mới |
| Key cố định | URL ổn định, dễ nhớ | phải invalidate CDN, browser cache vẫn cũ |
| Quarantine | validate an toàn | file chưa dùng được ngay, thêm bước |
| R2 (egress free) | rẻ khi serve nhiều | ít tính năng nâng cao hơn S3 |
| S3 | đầy đủ tính năng, tích hợp AWS | egress đắt |
| Versioning | cứu được xoá nhầm | tốn dung lượng, cần lifecycle cho version cũ |

## Explain Without Notes

1. Năm điểm object storage khác filesystem?
2. Vì sao không có transaction giữa storage và DB, và thứ tự ghi nào giải quyết?
3. Vì sao bucket public + authz ở app vẫn không an toàn?
4. Vì sao key immutable tốt hơn invalidate CDN?
5. Ba điều key design phải làm được?
6. `AbortIncompleteMultipartUpload` giải quyết vấn đề gì mà `ListObjects` không thấy?

## Related

- [Upload & download file](../00-http-api/09-file-upload-download.md) — validate, presigned URL, path traversal
- [Export & reporting](../00-http-api/10-export-and-reporting.md) — file sinh ra, TTL
- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) — cùng bài toán dual-write
- [HTTP & browser cache](../../01-web-frontend/00-web-foundations/02-http-browser-cache.md) — `Cache-Control`, immutable
- [Cloudflare & edge](../../04-infrastructure/05-platforms/02-cloudflare-and-edge.md) — R2, CDN
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz cho file
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — credential storage
- [Volumes & state](../../04-infrastructure/02-docker/03-volumes-state.md) — vì sao container filesystem ephemeral
- [Metadata, images & assets](../../01-web-frontend/03-nextjs/behavior/07-metadata-images-assets.md) — serve ảnh
