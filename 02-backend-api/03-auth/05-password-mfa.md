---
level: intermediate
area: backend
prerequisites:
  - 01-authentication-authorization.md
related:
  - 02-session-vs-token.md
  - ../../05-cross-cutting/security/01-security-basics.md
---

# Password & MFA

> Một hệ thống nội bộ bị chiếm tài khoản quản trị. Mật khẩu mạnh, hash bằng bcrypt, không có lỗ hổng injection. Nguyên nhân: chức năng **quên mật khẩu** sinh token bằng `Math.random()`, gửi qua email, và token không hết hạn. Xác thực không hỏng ở chỗ đăng nhập — nó hỏng ở **con đường vòng** quanh đăng nhập.

## Position

```text
Người dùng nhập mật khẩu
   ↓ HASH CHẬM + salt
   ↓ YẾU TỐ THỨ HAI (TOTP / passkey)
   ↓ phát hành phiên  →  02-session-vs-token
   ↑
   └── các đường vòng: quên mật khẩu, đổi email, mã dự phòng, hỗ trợ khách hàng
       ← đây là nơi hệ thống thật sự bị phá
```

## Problem

Ba câu hỏi cần trả lời riêng biệt:

```text
① Nếu database bị lộ, mật khẩu người dùng có bị lộ không?
   → thuật toán hash

② Nếu mật khẩu bị lộ (dùng lại từ site khác), tài khoản có bị chiếm không?
   → MFA

③ Nếu attacker không có gì cả, họ có đường vòng nào không?
   → khôi phục tài khoản, rate limit, enumeration
```

Hầu hết team trả lời được ① và bỏ qua ③ — trong khi ③ là nơi sự cố thực tế xảy ra.

## Mental Model

### Vì sao hash phải CHẬM

```text
Hash thường (SHA-256): thiết kế để NHANH
  → phần cứng chuyên dụng thử hàng tỷ giá trị mỗi giây
  → database bị lộ = mật khẩu yếu bị suy ra rất nhanh

Hash mật khẩu (bcrypt/argon2): thiết kế để CHẬM và TỐN BỘ NHỚ
  → cost tuning: ~100–250ms mỗi lần hash trên phần cứng của bạn
  → cùng phần cứng, số lần thử/giây giảm nhiều bậc độ lớn
```

Đây là lý do "hash bằng SHA-256 rồi salt" vẫn là sai: nó nhanh.

```text
salt      chuỗi ngẫu nhiên MỖI người dùng, lưu cùng hash
          → hai người cùng mật khẩu ra hai hash khác nhau
          → bảng tra sẵn (rainbow table) vô dụng
          → bcrypt/argon2 tự sinh và nhúng salt vào chuỗi kết quả

pepper    bí mật CHUNG, lưu NGOÀI database (KMS/biến môi trường)
          → DB bị lộ mà pepper không lộ → hash không tấn công được
          → đánh đổi: xoay pepper khó
```

### Chọn thuật toán

```text
argon2id   lựa chọn ưu tiên hiện nay
           tham số: memoryCost, timeCost, parallelism
           chống được cả GPU (tốn bộ nhớ) và side-channel

bcrypt     vẫn chấp nhận được; đơn giản, phổ biến
           lưu ý: cắt cụt đầu vào ở 72 BYTE
           → mật khẩu dài hơn bị cắt âm thầm

scrypt     ổn nếu đã dùng
✗ PBKDF2   chỉ khi bắt buộc vì lý do tuân thủ
✗ MD5/SHA  không phải hash mật khẩu
```

```ts
import * as argon2 from 'argon2';

const OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

// đăng ký
const hash = await argon2.hash(password, OPTS);

// đăng nhập
const ok = await argon2.verify(hash, password);
```

Tham số phải **đo trên phần cứng thật của bạn**, nhắm ~100–250ms. Sao chép tham số từ blog là cách chắc chắn để hoặc quá yếu, hoặc làm sập server khi có tải.

### Timing attack và user enumeration

Hai lỗi cùng gốc: **phản hồi khác nhau tiết lộ thông tin**.

```ts
// ✗ email không tồn tại trả về NGAY; email tồn tại mất 200ms hash
const user = await this.repo.findByEmail(email);
if (!user) throw new UnauthorizedException('email không tồn tại');
if (!await argon2.verify(user.hash, password)) {
  throw new UnauthorizedException('sai mật khẩu');
}
```

```ts
// ✓ luôn hash, luôn cùng thông báo
const user = await this.repo.findByEmail(email);
const stored = user?.hash ?? DUMMY_HASH;          // hash của chuỗi ngẫu nhiên cố định
const ok = await argon2.verify(stored, password);
if (!user || !ok) throw new UnauthorizedException('email hoặc mật khẩu không đúng');
```

Cùng nguyên tắc áp dụng cho **quên mật khẩu** ("nếu email tồn tại, chúng tôi đã gửi hướng dẫn") và **đăng ký** (xác nhận qua email thay vì báo "email đã tồn tại").

Enumeration không phải lỗ hổng nghiêm trọng nhất, nhưng nó biến một danh sách email rò rỉ thành danh sách **tài khoản có thật** — đầu vào cho các bước tiếp theo.

### Chính sách mật khẩu: cái gì thật sự có tác dụng

```text
✓ Độ dài tối thiểu 8–12 ký tự, KHÔNG giới hạn trên (ít nhất 64)
✓ Đối chiếu với danh sách mật khẩu đã bị lộ  ← hiệu quả nhất
✓ Cho phép mọi ký tự, kể cả khoảng trắng và unicode
✓ Cho phép dán (đừng chặn — nó phá hỏng trình quản lý mật khẩu)

✗ Bắt buộc chữ hoa + số + ký tự đặc biệt
    → người dùng tạo "Password1!" — phức tạp về hình thức, yếu về thực chất
✗ Bắt đổi mật khẩu định kỳ (90 ngày)
    → người dùng tăng số cuối: Password1 → Password2
✗ Câu hỏi bảo mật ("tên thú cưng đầu tiên")
    → là mật khẩu yếu mà người dùng không thể đổi, và thường tìm được công khai
```

NIST SP 800-63B đã bỏ khuyến nghị về độ phức tạp và đổi định kỳ. Chỉ đổi mật khẩu **khi có bằng chứng bị lộ**.

Đối chiếu danh sách bị lộ (ví dụ Have I Been Pwned qua k-anonymity — gửi 5 ký tự đầu của SHA-1, nhận về danh sách hậu tố) có tác dụng lớn hơn mọi quy tắc độ phức tạp cộng lại: nó chặn đúng loại mật khẩu bị dùng trong tấn công thực tế.

### MFA: hai loại bằng chứng khác nhau

```text
Yếu tố    Bạn BIẾT (mật khẩu) · bạn CÓ (điện thoại, khoá) · bạn LÀ (vân tay)

MFA thật = hai yếu tố KHÁC LOẠI.
Mật khẩu + câu hỏi bảo mật = hai thứ bạn BIẾT = không phải MFA.
```

```text
Passkey / WebAuthn   ✓✓ mạnh nhất
                     khoá riêng không rời thiết bị; chữ ký gắn với TÊN MIỀN
                     → CHỐNG PHISHING theo thiết kế
                     → trang giả mạo không lấy được gì vì domain không khớp

TOTP (app 6 số)      ✓ tốt, phổ biến, hoạt động offline
                     → phishing được: người dùng gõ mã vào trang giả

Push notification    ✓ tiện
                     → "MFA fatigue": gửi liên tục cho tới khi người dùng bấm nhầm
                     → giảm nhẹ bằng number matching

SMS                  ~ tốt hơn không có, kém hơn mọi lựa chọn trên
                     → SIM swap, chặn ở tầng mạng
                     → dùng khi người dùng không thể dùng cách khác
```

Điểm khác biệt quan trọng: **passkey chống phishing, TOTP thì không.** Nếu người dùng bị dụ vào trang giả mạo, họ sẽ gõ cả mật khẩu lẫn mã TOTP vào đó. Với passkey, trình duyệt từ chối ký vì tên miền không khớp — bảo vệ hoạt động **kể cả khi người dùng bị lừa hoàn toàn**.

### TOTP: ba chi tiết hay sai

```text
① Đồng hồ lệch
   TOTP dựa trên thời gian. Cho phép ±1 khoảng (30 giây) mỗi bên.
   Rộng hơn = nới cửa sổ tấn công.

② Dùng lại mã
   Mã hợp lệ 30 giây → dùng được nhiều lần trong 30 giây đó nếu không chặn.
   → lưu (userId, mã đã dùng) và TỪ CHỐI lần hai.

③ Không rate limit
   Mã 6 chữ số = 1.000.000 khả năng.
   Không giới hạn số lần thử → thử được.
   → tối đa 5 lần sai rồi khoá tạm.
```

### Mã dự phòng: điểm yếu bị bỏ quên

```text
Mã dự phòng là mật khẩu thứ hai — và thường được bảo vệ kém hơn:
  ✓ hash chúng như hash mật khẩu (chúng có entropy cao nên hash nhanh cũng chấp nhận được,
    nhưng đừng lưu plaintext)
  ✓ dùng MỘT LẦN, đánh dấu đã dùng
  ✓ rate limit như mọi yếu tố khác
  ✓ hiển thị MỘT LẦN lúc sinh, cho tải về
  ✓ sinh lại làm mất hiệu lực bộ cũ
```

### Đường vòng: nơi hệ thống thật sự bị phá

Sự cố ở đầu note nằm ở đây. Danh sách những đường vòng phải bảo vệ ngang với đăng nhập:

```text
Quên mật khẩu     token phải: CSPRNG ≥128 bit · hash trong DB
                  · hết hạn 15–60 phút · DÙNG MỘT LẦN
                  · huỷ MỌI PHIÊN sau khi đổi
                  · KHÔNG tiết lộ email có tồn tại hay không

Đổi email         yêu cầu mật khẩu hiện tại + xác minh email MỚI
                  + thông báo tới email CŨ (kèm cách khôi phục)
                  → đây là cách chiếm tài khoản khi đã có phiên tạm thời

Đổi mật khẩu      yêu cầu mật khẩu hiện tại
                  huỷ mọi phiên KHÁC (giữ phiên hiện tại)

Tắt MFA           yêu cầu xác thực lại đầy đủ + thông báo

Hỗ trợ khách hàng quy trình xác minh danh tính rõ ràng
                  → social engineering nhắm vào đây, không nhắm vào code
```

Nguyên tắc chung: **mọi thao tác thay đổi cách đăng nhập đều cần xác thực lại (step-up).** Có phiên đang mở không đủ.

### Rate limiting: ba trục

```text
theo TÀI KHOẢN      chống thử mật khẩu cho một người
theo IP             chống một nguồn thử nhiều tài khoản
theo MẬT KHẨU       chống credential stuffing (một mật khẩu phổ biến, nhiều tài khoản)
                    ← trục hay bị bỏ nhất, và là kiểu tấn công phổ biến nhất
```

Chỉ giới hạn theo tài khoản không chặn được credential stuffing: attacker thử **một** mật khẩu trên **mười nghìn** tài khoản — mỗi tài khoản chỉ một lần thử.

Nên dùng **backoff tăng dần** thay vì khoá cứng: khoá cứng theo tài khoản biến thành công cụ từ chối dịch vụ (attacker khoá tài khoản người khác bằng cách thử sai). Xem [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md).

## Example

Luồng đăng nhập với các lớp bảo vệ ở đúng chỗ:

```ts
async login(email: string, password: string, ip: string) {
  // ① rate limit TRƯỚC khi chạm database
  await this.limiter.consume([`ip:${ip}`, `email:${email}`]);

  const user = await this.repo.findByEmail(email);

  // ② luôn hash — thời gian phản hồi không tiết lộ email có tồn tại
  const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user || !ok) {
    this.audit.log({ event: 'login_failed', email, ip });
    throw new UnauthorizedException('email hoặc mật khẩu không đúng');
  }

  // ③ nâng cost khi tham số đã lỗi thời — chỉ làm được ở đây, khi có mật khẩu gốc
  if (argon2.needsRehash(user.passwordHash, OPTS)) {
    await this.repo.updateHash(user.id, await argon2.hash(password, OPTS));
  }

  // ④ MFA là bước RIÊNG — chưa phát hành phiên đầy đủ
  if (user.mfaEnabled) {
    return { status: 'mfa_required', challenge: await this.mfa.createChallenge(user.id) };
  }

  this.audit.log({ event: 'login_success', userId: user.id, ip });
  return this.sessions.create(user.id);
}
```

Bước ③ đáng chú ý: bạn **chỉ có mật khẩu gốc trong tay tại thời điểm đăng nhập**. Đó là cơ hội duy nhất để nâng cost mà không bắt người dùng đổi mật khẩu. Không có bước này, tham số hash của bạn đóng băng ở mức của ngày triển khai đầu tiên.

## Prediction

1. Hash bằng SHA-256 + salt, database bị lộ — mật khẩu yếu có an toàn không?
2. bcrypt cost 4 (mặc định thư viện cũ) so với cost 12 — khác nhau thế nào?
3. Không có salt, hai người cùng mật khẩu — hash giống nhau không? Hậu quả?
4. Email không tồn tại trả về trong 5ms, email tồn tại trong 200ms — attacker suy ra gì?
5. bcrypt với mật khẩu 100 ký tự — bao nhiêu ký tự thực sự được dùng?
6. Bắt đổi mật khẩu mỗi 90 ngày — người dùng làm gì?
7. Mật khẩu + câu hỏi bảo mật — có phải MFA không?
8. Người dùng bị phishing, gõ mật khẩu và mã TOTP vào trang giả — attacker vào được không?
9. Cùng tình huống với passkey — attacker vào được không?
10. Mã TOTP hợp lệ 30 giây, không đánh dấu đã dùng — dùng được mấy lần?
11. Rate limit 5 lần/tài khoản/giờ. Attacker thử mật khẩu `Summer2026!` trên 50.000 tài khoản — bị chặn không?
12. Token reset không hết hạn, người dùng chuyển tiếp email cho đồng nghiệp — hậu quả?
13. Đổi mật khẩu nhưng không huỷ phiên cũ — attacker đang có phiên thì sao?
14. Cho đổi email mà chỉ cần có phiên đang mở — attacker mượn máy 30 giây làm được gì?

<details>
<summary>Đáp án</summary>

1. **Không** — SHA-256 nhanh; mật khẩu yếu bị suy ra rất nhanh.
2. Cost tăng 1 = **gấp đôi công sức**. 4 → 12 là **256 lần**.
3. **Giống nhau** — lộ ra ai dùng chung mật khẩu, và bảng tra sẵn dùng được.
4. **Email nào tồn tại** — user enumeration.
5. **72 byte đầu**, phần còn lại bị cắt âm thầm.
6. Tăng số cuối: `Password1` → `Password2`. Chính sách làm mật khẩu **dễ đoán hơn**.
7. **Không** — cả hai đều là thứ bạn *biết*.
8. **Được** — attacker chuyển tiếp mã ngay lập tức.
9. **Không** — chữ ký gắn với tên miền; trình duyệt từ chối ký cho domain giả.
10. **Nhiều lần** trong 30 giây đó.
11. **Không** — mỗi tài khoản chỉ một lần thử. Cần giới hạn theo IP và theo mật khẩu.
12. Bất kỳ ai đọc được email đó **đổi được mật khẩu**, bất kể bao lâu sau.
13. Attacker **vẫn giữ quyền truy cập** — người dùng tưởng mình đã xử lý xong.
14. Đổi email sang email của họ → dùng "quên mật khẩu" → **chiếm tài khoản vĩnh viễn**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đo thời gian phản hồi cho email tồn tại và không tồn tại | Chênh lệch = enumeration |
| Hash cùng mật khẩu hai lần bằng argon2 | Hai kết quả khác nhau (salt) |
| So sánh thời gian bcrypt cost 4 và cost 12 | ~256 lần |
| bcrypt với mật khẩu 80 ký tự, đổi ký tự thứ 75 | Vẫn đăng nhập được |
| Dùng lại mã TOTP trong cùng 30 giây | Được, nếu không đánh dấu đã dùng |
| Chỉnh đồng hồ điện thoại lệch 2 phút | Mã bị từ chối |
| Thử một mật khẩu phổ biến trên nhiều tài khoản | Rate limit theo tài khoản không chặn |
| Dùng token reset hai lần | Lần hai phải bị từ chối |
| Đổi mật khẩu, kiểm tra phiên cũ ở trình duyệt khác | Còn hoạt động = lỗi |
| Đổi email không cần mật khẩu hiện tại | Đường chiếm tài khoản |
| Đăng nhập bằng mã dự phòng hai lần | Lần hai phải bị từ chối |
| Nhập sai mã TOTP 100 lần | Không bị chặn = có thể thử |

## What Usually Goes Wrong

- **Hash nhanh** (MD5/SHA) hoặc **cost quá thấp**.
- **Không bao giờ nâng cost** — tham số đóng băng ở mức của ngày đầu.
- **Enumeration** qua thông báo lỗi hoặc thời gian phản hồi.
- **bcrypt cắt cụt ở 72 byte** — không ai nhận ra cho tới khi kiểm tra.
- **Chính sách phức tạp** thay vì đối chiếu danh sách mật khẩu bị lộ.
- **Rate limit chỉ theo tài khoản** — không chặn credential stuffing.
- **Khoá cứng tài khoản** — biến thành công cụ DoS.
- **Token reset yếu** (`Math.random()`), **không hết hạn**, hoặc **dùng nhiều lần**.
- **Không huỷ phiên** sau khi đổi mật khẩu.
- **Đổi email không cần xác thực lại** — đường chiếm tài khoản trực tiếp.
- **Mã TOTP dùng lại được** hoặc **không rate limit**.
- **Mã dự phòng lưu plaintext**.
- **SMS là yếu tố duy nhất**.
- **Không log sự kiện đăng nhập** — không điều tra được sau sự cố.
- **Không thông báo cho người dùng** khi có thay đổi bảo mật.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Salt là bí mật | Salt công khai được; nó chống bảng tra sẵn |
| SHA-256 + salt là đủ | Nó nhanh — đó chính là vấn đề |
| Mật khẩu phức tạp = mạnh | Độ dài và không nằm trong danh sách lộ quan trọng hơn |
| Đổi mật khẩu định kỳ tăng an toàn | Nó làm mật khẩu dễ đoán hơn |
| Câu hỏi bảo mật là yếu tố thứ hai | Nó là mật khẩu yếu không đổi được |
| SMS OTP là MFA tốt | SIM swap; là lựa chọn kém nhất trong nhóm |
| TOTP chống phishing | Không — chỉ passkey mới chống |
| MFA làm mật khẩu yếu trở nên ổn | MFA là lớp thứ hai, không thay lớp thứ nhất |
| Rate limit theo tài khoản là đủ | Credential stuffing đi ngang qua nó |
| Reset mật khẩu là tính năng phụ | Nó là con đường vào tài khoản, ngang với đăng nhập |
| Có phiên rồi thì đổi email thoải mái | Đó là cách chiếm tài khoản |

## Debugging

1. **Đăng nhập chậm bất thường** → cost quá cao, hoặc hash chạy trên event loop chính khi có tải cao. Đo p99, không đo trung bình.
2. **Hash CPU-bound** → argon2/bcrypt native chạy trong thread pool của libuv; `UV_THREADPOOL_SIZE` mặc định là 4. Tải cao làm xếp hàng.
3. **"Mật khẩu đúng mà không vào được"** → encoding (unicode normalization), khoảng trắng bị trim ở một phía, hoặc bcrypt cắt cụt.
4. **TOTP luôn sai** → lệch đồng hồ server hay client? Kiểm tra NTP.
5. **Kiểm tra tham số hash hiện tại**: chuỗi argon2 chứa tham số — `$argon2id$v=19$m=19456,t=2,p=1$...`. So với `OPTS` hiện tại.
6. **Enumeration** → so thời gian phản hồi và nội dung thông báo giữa email tồn tại và không.
7. **Sau sự cố**: log đăng nhập có `userId`, IP, user agent, kết quả, yếu tố dùng — không có những trường này thì không dựng lại được chuyện gì đã xảy ra.
8. **Đột biến `login_failed`** từ nhiều IP với ít lần thử mỗi tài khoản = credential stuffing.

## Production Considerations

- **argon2id** với tham số đo trên phần cứng thật (~100–250ms), hoặc **bcrypt cost ≥ 12**.
- **`needsRehash` lúc đăng nhập** để nâng cost dần theo thời gian.
- **Đối chiếu danh sách mật khẩu bị lộ** khi đăng ký và đổi mật khẩu.
- **Độ dài tối thiểu 8–12, tối đa ≥ 64, cho phép mọi ký tự và dán.**
- **Thông báo lỗi và thời gian phản hồi đồng nhất.**
- **Rate limit ba trục** (tài khoản, IP, mật khẩu) với backoff tăng dần.
- **Passkey/WebAuthn** là mục tiêu; TOTP là mặc định thực tế; SMS là phương án cuối.
- **Mã TOTP dùng một lần**, cửa sổ ±1, tối đa 5 lần thử.
- **Mã dự phòng đã hash, dùng một lần**, sinh lại làm mất hiệu lực bộ cũ.
- **Token reset**: CSPRNG ≥128 bit, hash trong DB, hết hạn 15–60 phút, dùng một lần.
- **Huỷ mọi phiên khác** khi đổi mật khẩu, đổi email, hoặc tắt MFA.
- **Step-up authentication** cho mọi thao tác nhạy cảm.
- **Thông báo cho người dùng** khi có đăng nhập từ thiết bị mới hoặc thay đổi bảo mật.
- **Log đầy đủ sự kiện xác thực**; giữ đủ lâu để điều tra.
- **Quy trình xác minh danh tính cho hỗ trợ khách hàng** — bằng văn bản, không tuỳ nhân viên.
- **Không tự viết crypto**; dùng thư viện đã kiểm chứng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cost hash cao | tốn công tấn công hơn | đăng nhập chậm, tốn CPU |
| Cost thấp | nhanh | hash yếu |
| Pepper | DB lộ vẫn an toàn | quản lý khoá, xoay khó |
| Passkey | chống phishing | hỗ trợ thiết bị, khôi phục phức tạp |
| TOTP | phổ biến, offline | phishing được |
| SMS | ai cũng dùng được | SIM swap |
| Bắt MFA toàn bộ | an toàn hơn nhiều | ma sát, tăng yêu cầu hỗ trợ |
| MFA tuỳ chọn | ít ma sát | phần lớn người dùng không bật |
| Khoá cứng sau N lần sai | chặn thử mật khẩu | trở thành công cụ DoS |
| Backoff tăng dần | không DoS được | attacker chậm vẫn tiếp tục |
| Không dùng mật khẩu (chỉ passkey) | loại bỏ cả lớp lỗi | khôi phục và tương thích |

## Explain Without Notes

1. Vì sao hash mật khẩu phải chậm, và vì sao SHA-256 + salt không đủ?
2. Salt và pepper khác nhau thế nào? Cái nào phải giữ bí mật?
3. Vì sao "bắt buộc ký tự đặc biệt + đổi mỗi 90 ngày" làm mật khẩu yếu đi?
4. Vì sao passkey chống phishing mà TOTP thì không?
5. Credential stuffing là gì, và vì sao rate limit theo tài khoản không chặn được?
6. Liệt kê năm yêu cầu của một token reset mật khẩu an toàn.
7. Vì sao đổi email phải yêu cầu mật khẩu hiện tại?
8. `needsRehash` giải quyết vấn đề gì?

## Related

- [Authentication vs Authorization](01-authentication-authorization.md) — xác thực là bước một
- [Session vs token](02-session-vs-token.md) — phát hành phiên sau khi xác thực
- [OAuth 2 & OIDC](04-oauth-oidc.md) — khi bên thứ ba giữ mật khẩu thay bạn
- [Rate limit & locking](../../03-database/02-redis/02-rate-limit-locking.md) — cài đặt giới hạn
- [Security basics](../../05-cross-cutting/security/01-security-basics.md) — mô hình đe doạ
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — pepper, khoá ký
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md) — log sự kiện xác thực

## Version / Context

Khuyến nghị theo NIST SP 800-63B và OWASP Password Storage Cheat Sheet (tham số argon2id: m=19456 KiB, t=2, p=1 là mức tối thiểu OWASP hiện hành). Thư viện Node: `argon2`, `bcrypt`, `@simplewebauthn/server` cho passkey, `otplib` cho TOTP (RFC 6238). WebAuthn Level 2 được hỗ trợ ở mọi trình duyệt hiện đại.
