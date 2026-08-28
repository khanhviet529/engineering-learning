---
level: intermediate
area: backend
prerequisites:
  - ../../03-database/04-message-queues/01-why-queue.md
related:
  - 02-outgoing-webhooks.md
  - ../../03-database/04-message-queues/06-outbox-pattern.md
---

# Gửi email

> Email không phải "gọi một API". Nó là hệ thống duy nhất trong stack của bạn mà **người nhận có thể lặng lẽ không nhận** — không lỗi, không cảnh báo, chỉ là email không tới. Và bạn chỉ biết khi khách hàng gọi điện.

## Position

```text
App → provider (SES/SendGrid/Postmark/Resend)
      ↓ SMTP
Mail server của người nhận
      ↓ kiểm tra SPF/DKIM/DMARC + reputation
Inbox · Spam · Bị chặn (không có phản hồi nào)
      ↓ bounce/complaint → webhook về app
```

## Problem

```ts
// Đăng ký người dùng — 3 dòng, 5 vấn đề
async register(dto: RegisterDto) {
  const user = await this.prisma.user.create({ data: dto });
  await this.mailer.sendWelcome(user.email);      // ← ở đây
  return user;
}
```

| Vấn đề | Hậu quả |
|---|---|
| Gửi trong request | provider chậm 3 giây → API chậm 3 giây |
| Provider lỗi → throw | **đăng ký thất bại** vì email lỗi |
| Không transaction-safe | email gửi rồi, transaction rollback → email nói về user không tồn tại |
| Không retry | provider lỗi tạm thời → email mất vĩnh viễn |
| Không xử lý bounce | email không tồn tại → gửi mãi → **reputation giảm** → email của bạn vào spam cho *mọi* người |

Vấn đề cuối là vấn đề nghiêm trọng nhất và ít ai nghĩ tới: gửi email cho địa chỉ không tồn tại làm **hard bounce**, và tỉ lệ bounce cao khiến provider giới hạn hoặc khoá tài khoản của bạn. Một danh sách email cũ có thể phá reputation của cả domain.

## Mental Model

```text
Email là SIDE EFFECT BẤT ĐỒNG BỘ, không phải một bước trong request.

register()  →  ghi user (transaction)
            →  phát ý định "gửi welcome email"
            →  worker thực hiện, retry được
            →  provider → bounce/complaint webhook → cập nhật trạng thái
```

Và phân loại email quyết định mọi thứ về hạ tầng:

```text
TRANSACTIONAL          người dùng ĐANG CHỜ nó
  reset password, OTP, xác nhận đơn hàng, hoá đơn
  → độ tin cậy và tốc độ là ưu tiên
  → KHÔNG cần unsubscribe (nó là phần của dịch vụ)
  → tách domain/subdomain riêng nếu có thể

MARKETING              người dùng KHÔNG chờ
  newsletter, khuyến mãi, "chúng tôi có tính năng mới"
  → BẮT BUỘC có unsubscribe (luật, và để tránh complaint)
  → cần opt-in tường minh
  → gửi qua kênh/subdomain RIÊNG
```

Vì sao phải tách: complaint (người dùng bấm "Spam") từ email marketing sẽ hạ reputation của domain gửi. Nếu email reset password đi cùng domain đó, **người dùng không nhận được mật khẩu mới** — một vấn đề marketing biến thành sự cố đăng nhập.

## How It Works

### Ba bản ghi DNS — không có chúng, email vào spam

```text
SPF    "Server nào được phép gửi thay tôi?"
       TXT @  "v=spf1 include:amazonses.com ~all"
       → giới hạn 10 lần lookup DNS; nhiều include quá sẽ FAIL

DKIM   "Email này có bị sửa trên đường không?"
       TXT <selector>._domainkey  "v=DKIM1; k=rsa; p=<public key>"
       → provider ký bằng private key; người nhận verify bằng key trong DNS

DMARC  "Nếu SPF/DKIM fail thì làm gì? Báo cáo cho ai?"
       TXT _dmarc  "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com; pct=100"
                    ↑ bắt đầu p=none để THU BÁO CÁO, chưa chặn
```

Lộ trình DMARC — quan trọng, vì `p=reject` ngay có thể chặn email hợp lệ của chính bạn:

```text
1. p=none + rua      → thu báo cáo 2–4 tuần, xem ai đang gửi thay domain bạn
2. Sửa các nguồn hợp lệ chưa được ký (CRM, tool nội bộ, hệ thống cũ)
3. p=quarantine; pct=10 → tăng dần lên 100
4. p=reject          → khi báo cáo đã sạch
```

Bỏ bước 1–2 là cách phổ biến làm mất email từ những hệ thống bạn quên mất.

Thêm hai thứ nữa:

```text
Reverse DNS (PTR)    IP gửi phải resolve về hostname của bạn — provider lo việc này
DMARC alignment      From: domain phải KHỚP với domain trong SPF/DKIM
                     → dùng "no-reply@yourdomain.com", KHÔNG dùng "@gmail.com"
```

### Gửi qua queue — không gửi trong request

```ts
// ❌ Trong request
await this.mailer.send(...);

// ✅ Enqueue, worker gửi
@Injectable()
export class UserService {
  async register(dto: RegisterDto) {
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: dto });
      // Outbox: ý định gửi email nằm TRONG transaction
      await tx.outbox.create({
        data: {
          type: 'email.welcome',
          payload: { userId: u.id, email: u.email },
          idempotencyKey: `welcome:${u.id}`,      // gửi lại không nhân đôi
        },
      });
      return u;
    });
    return user;   // API trả về ngay, không chờ email
  }
}
```

Vì sao **outbox** chứ không phải `queue.add()` trực tiếp:

```text
queue.add() ngoài transaction  → transaction rollback nhưng job đã vào queue
                                  → email nói về user không tồn tại
queue.add() trong transaction  → job vào queue nhưng transaction rollback
                                  → cùng vấn đề (queue không tham gia transaction DB)
outbox trong transaction        → ý định và dữ liệu commit CÙNG NHAU
                                  → worker đọc outbox → không bao giờ lệch
```

Đây chính là bài toán dual-write. Xem [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md).

### Worker — idempotent và có retry

```ts
@Processor('email')
export class EmailProcessor {
  @Process('send')
  async send(job: Job<EmailJob>) {
    const { idempotencyKey, to, template, data } = job.data;

    // 1. Đã gửi chưa? (job có thể chạy lại — at-least-once)
    const existing = await this.prisma.emailLog.findUnique({ where: { idempotencyKey } });
    if (existing?.status === 'SENT') return existing.providerId;

    // 2. Địa chỉ này có bị suppress không? — BẮT BUỘC kiểm tra
    if (await this.suppression.isSuppressed(to)) {
      await this.log(idempotencyKey, 'SUPPRESSED');
      return;                                    // KHÔNG gửi, KHÔNG throw
    }

    // 3. Gửi
    const res = await this.provider.send({ to, template, data });

    // 4. Ghi lại để idempotent và để đối chiếu
    await this.prisma.emailLog.upsert({
      where: { idempotencyKey },
      create: { idempotencyKey, to, template, providerId: res.id, status: 'SENT' },
      update: { providerId: res.id, status: 'SENT' },
    });
    return res.id;
  }
}

// Cấu hình retry: chỉ retry lỗi TẠM THỜI
{
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },   // 30s, 1m, 2m, 4m, 8m
}
```

Bước 2 là bước quan trọng nhất và hay bị bỏ. Nếu không có suppression list, một địa chỉ hard-bounce sẽ được gửi lại mỗi lần có sự kiện — và mỗi lần là một bounce nữa cho reputation.

**Không retry** với: địa chỉ không hợp lệ (`550`), bị suppress, hoặc lỗi 4xx từ provider. Retry chúng chỉ làm reputation tệ hơn. Xem [Retry & DLQ](../../03-database/04-message-queues/03-retry-dlq.md).

### Bounce & complaint — xử lý webhook

```ts
@Post('webhooks/email')
async handle(@Req() req: RawBodyRequest, @Headers('x-signature') sig: string) {
  // Verify signature trên RAW body — xem note webhook
  const event = this.provider.verifyWebhook(req.rawBody, sig);

  switch (event.type) {
    case 'bounce':
      if (event.bounceType === 'Permanent') {
        // HARD bounce: địa chỉ không tồn tại → suppress VĨNH VIỄN
        await this.suppression.add(event.email, 'HARD_BOUNCE');
      } else {
        // SOFT bounce: hộp thư đầy, server tạm lỗi → retry sau, đếm số lần
        await this.suppression.incrementSoftBounce(event.email);
      }
      break;

    case 'complaint':
      // Người dùng bấm "Spam" → suppress NGAY, kể cả transactional
      await this.suppression.add(event.email, 'COMPLAINT');
      break;

    case 'delivered':
      await this.emailLog.markDelivered(event.messageId);
      break;
  }
  return { ok: true };
}
```

Phân biệt hard/soft bounce là bắt buộc:

| | Hard bounce | Soft bounce |
|---|---|---|
| Nguyên nhân | địa chỉ không tồn tại, domain sai | hộp thư đầy, server tạm lỗi, quá lớn |
| Xử lý | **suppress vĩnh viễn** | retry, suppress sau N lần |
| Ảnh hưởng reputation | **rất nặng** | nhẹ |

Và ngưỡng cần biết: phần lớn provider giới hạn **bounce rate < 5%** và **complaint rate < 0,1%**. Vượt là bị hạn chế hoặc khoá.

### Suppression list — bảng phải có

```prisma
model EmailSuppression {
  email     String   @id
  reason    String              // HARD_BOUNCE | COMPLAINT | MANUAL | SOFT_BOUNCE_LIMIT
  createdAt DateTime @default(now())
  softCount Int      @default(0)
}
```

Kiểm tra **trước mỗi lần gửi**, không phải sau. Đây là thứ bảo vệ reputation của bạn.

### Template — không nối string HTML

```ts
// ❌ XSS trong email (đúng, email cũng bị XSS — email client render HTML)
const html = `<p>Xin chào ${user.name}</p>`;

// ✅ Template engine tự escape
const html = await this.render('welcome', { name: user.name });
```

Bốn ràng buộc của HTML email — nó không phải HTML web:

```text
1. Dùng TABLE để layout — flexbox/grid không hoạt động ở Outlook
2. CSS phải INLINE — nhiều client bỏ <style>
3. Luôn có bản PLAIN TEXT — một số client chỉ đọc text; và nó tăng deliverability
4. Ảnh có thể bị CHẶN mặc định → không đặt thông tin quan trọng trong ảnh
```

Dùng MJML hoặc react-email để không tự viết table layout.

### Reset password — nơi hay có lỗ hổng

```ts
// Token phải: ngẫu nhiên MẬT MÃ, hết hạn, dùng một lần, hash khi lưu
const raw = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(raw).digest('hex');

await this.prisma.passwordReset.create({
  data: { userId, tokenHash: hash, expiresAt: addMinutes(new Date(), 30) },
});
// Gửi `raw` trong email; DB chỉ lưu `hash`
// → DB bị đọc cũng không dùng được token

// Phản hồi KHÔNG tiết lộ email có tồn tại
return { message: 'Nếu email tồn tại, chúng tôi đã gửi hướng dẫn' };
```

Bốn yêu cầu, và bỏ một cái là một lỗ hổng: `randomBytes` (không phải `Math.random()`), có `expiresAt`, dùng một lần (xoá sau khi dùng), và **lưu hash** không lưu token thật. Xem [Password & MFA](../03-auth/05-password-mfa.md).

## Example

```text
Luồng hoàn chỉnh cho welcome email

1. register()          → transaction: INSERT user + INSERT outbox
2. Outbox poller       → đọc outbox chưa xử lý → queue.add('email:send')
3. Worker              → check idempotencyKey → check suppression
                       → provider.send() → ghi emailLog
4. Provider webhook    → delivered / bounce / complaint → cập nhật
5. Hard bounce         → suppression list → không gửi lần sau

Hạ tầng:
  SPF + DKIM + DMARC (p=reject sau khi thu báo cáo)
  subdomain riêng: mail.yourdomain.com (transactional)
                   news.yourdomain.com (marketing)
  monitor: bounce rate, complaint rate, delivery rate
```

## Prediction

1. `await mailer.send()` trong request, provider chậm 4 giây — API chậm bao lâu?
2. Provider throw, không try/catch — người dùng đăng ký được không?
3. `queue.add()` trong transaction, transaction rollback — job còn trong queue?
4. Không có SPF/DKIM, gửi từ `no-reply@yourdomain.com` — email vào đâu?
5. Không có suppression list, 1000 địa chỉ hard-bounce, gửi mỗi tuần — reputation sau 1 tháng?
6. Retry email tới địa chỉ `550 User unknown` 5 lần — được gì?
7. Marketing và transactional cùng domain, nhiều complaint từ marketing — email reset password thế nào?
8. Lưu token reset password dạng plain text, DB bị đọc — hậu quả?
9. `From: no-reply@gmail.com` với DMARC của gmail.com — kết quả?
10. Layout email bằng flexbox, mở trên Outlook — hiển thị thế nào?

<details>
<summary>Đáp án</summary>

1. 4 giây — người dùng chờ email provider.
2. **Không** — đăng ký thất bại vì email lỗi.
3. **Có** — queue không tham gia transaction của DB. Đây là dual-write.
4. Phần lớn vào spam; Gmail/Outlook có thể chặn hẳn.
5. Bị provider giới hạn hoặc khoá; email vào spam cho cả người dùng hợp lệ.
6. Không gì — chỉ thêm 5 bounce nữa cho reputation.
7. **Có thể không tới** — reputation domain đã giảm.
8. Ai đọc được DB đều đổi được mật khẩu của mọi user.
9. **Fail DMARC** — bạn không được phép gửi thay gmail.com.
10. Vỡ layout — Outlook dùng engine của Word.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm `sleep(4000)` vào mailer, gọi register | API chậm đúng 4 giây |
| Làm mailer throw | Đăng ký thất bại |
| Chuyển sang outbox + worker | Đăng ký thành công, email tới sau |
| `queue.add()` trong transaction rồi throw sau đó | Job vẫn gửi — email về user không tồn tại |
| Gửi email không có SPF/DKIM tới Gmail | Kiểm tra header `Authentication-Results` |
| Gửi tới `bounce@simulator.amazonses.com` (SES) | Nhận bounce webhook, test được luồng |
| Bỏ check suppression, gửi lại tới địa chỉ đã hard-bounce | Bounce thêm; theo dõi bounce rate |
| Đặt `p=reject` ngay mà chưa thu báo cáo | Email từ tool nội bộ bị chặn |
| Email HTML với `${user.name}` không escape, name = `<img onerror=...>` | Kiểm tra email client có render |
| Layout flexbox, mở trên Outlook desktop | Vỡ |
| Không có plain text version | Một số client hiện trống |

Provider thường có **địa chỉ simulator** (SES: `bounce@`, `complaint@`) — dùng chúng để test luồng bounce mà không phá reputation thật.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Gửi email là gọi một API | Nó là hệ thống có deliverability, reputation, bounce |
| Provider trả 200 nghĩa là email đã tới | Chỉ nghĩa là provider **nhận** — tới hay không là chuyện khác |
| Không có SPF/DKIM cũng gửi được | Gửi được, nhưng vào spam |
| `p=reject` ngay là an toàn nhất | Nó chặn cả email hợp lệ chưa được ký |
| Bounce là chuyện của provider | Bounce rate cao khoá tài khoản của **bạn** |
| Transactional không cần quan tâm complaint | Complaint suppress địa chỉ, kể cả transactional |
| Marketing và transactional gửi chung được | Complaint từ marketing phá deliverability của transactional |
| Email không bị XSS | Email client render HTML |
| HTML email như HTML web | Cần table layout, CSS inline |
| Retry mọi lỗi email là đúng | Retry hard bounce làm reputation tệ hơn |

## Debugging

1. **Email không tới** → kiểm tra theo thứ tự: (a) provider có nhận không (dashboard/log), (b) có bounce/complaint không, (c) địa chỉ có trong suppression list không, (d) SPF/DKIM/DMARC pass không.
2. **Đọc header của email đã nhận** — đây là nguồn thông tin dứt khoát:
   ```text
   Authentication-Results: spf=pass ... dkim=pass ... dmarc=pass
   ```
   Nếu có `fail`, đó là nguyên nhân.
3. **Kiểm tra DNS**:
   ```bash
   dig +short TXT yourdomain.com | grep spf
   dig +short TXT selector._domainkey.yourdomain.com
   dig +short TXT _dmarc.yourdomain.com
   ```
4. **Test deliverability** bằng mail-tester.com hoặc Google Postmaster Tools — chúng cho điểm và chỉ ra thiếu gì.
5. **Bounce rate tăng** → tìm nguồn địa chỉ mới (import danh sách? form không verify?).
6. **Email vào spam đột ngột** → kiểm tra complaint rate, và kiểm tra IP/domain có trong blacklist (mxtoolbox).
7. **Đọc DMARC report** (file XML gửi tới `rua=`) — nó cho biết ai đang gửi thay domain bạn.

## Production Considerations

- **SPF + DKIM + DMARC** ngay từ đầu; DMARC theo lộ trình `none → quarantine → reject`.
- **Subdomain riêng cho transactional và marketing.**
- **Email qua queue + outbox**, không bao giờ trong request.
- **Suppression list, kiểm tra trước mỗi lần gửi.**
- **Xử lý bounce/complaint webhook** — không có nó, reputation giảm dần và bạn không biết.
- **Monitor**: delivery rate, bounce rate (< 5%), complaint rate (< 0,1%).
- **Không retry hard bounce**; retry soft bounce có giới hạn.
- **Idempotency key** cho mỗi email — job chạy lại không gửi hai lần.
- **Plain text version** cho mọi email.
- **Rate limit** endpoint gửi email do người dùng kích hoạt (mời bạn, reset password) — nếu không nó là công cụ spam. Xem [Rate limiting](../00-http-api/07-rate-limiting.md).
- **Log mọi email** (to, template, providerId, status) — cần khi khách hàng nói "tôi không nhận được".
- **Double opt-in cho marketing** — nó giảm bounce và complaint đáng kể.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Gửi trong request | đơn giản, biết ngay kết quả | API chậm, thất bại lan sang nghiệp vụ chính |
| Queue + outbox | API nhanh, retry, không mất | thêm hạ tầng, eventual |
| Provider quản lý (SES/Postmark) | reputation, bounce handling, deliverability | phụ thuộc, chi phí theo lượng |
| Tự chạy SMTP | kiểm soát hoàn toàn | reputation phải tự xây; rất khó |
| Subdomain riêng | bảo vệ transactional | thêm cấu hình DNS |
| `p=reject` | chống spoofing domain | chặn cả nguồn hợp lệ chưa ký |
| Double opt-in | list sạch, ít bounce | mất một phần người đăng ký |

## Explain Without Notes

1. Vì sao email là side effect bất đồng bộ, không phải một bước trong request?
2. Ba bản ghi DNS và mỗi cái trả lời câu hỏi gì?
3. Vì sao `p=reject` ngay là nguy hiểm, và lộ trình đúng?
4. Hard bounce vs soft bounce — xử lý khác nhau thế nào và vì sao?
5. Vì sao phải tách marketing và transactional?
6. Vì sao outbox thay vì `queue.add()` trong transaction?

## Related

- [Outgoing webhooks](02-outgoing-webhooks.md) — cùng họ side effect ra ngoài
- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) — dual-write
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md)
- [Retry & DLQ](../../03-database/04-message-queues/03-retry-dlq.md) — retry lỗi transient
- [Delivery semantics](../../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once, idempotency
- [Password & MFA](../03-auth/05-password-mfa.md) — token reset password
- [Rate limiting](../00-http-api/07-rate-limiting.md) — chống lạm dụng
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — escape trong template
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md)
