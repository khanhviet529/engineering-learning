---
level: advanced
area: cross-cutting
prerequisites:
  - 01-security-basics.md
related:
  - 06-secrets-management.md
  - ../../04-infrastructure/01-networking/04-nat-firewall-routing.md
---

# SSRF & supply chain

> Một tính năng "nhập dữ liệu từ URL" cho phép người dùng dán link CSV. Nó chạy trong container trên cloud. Người dùng dán một URL trỏ tới **địa chỉ metadata nội bộ của nhà cung cấp cloud** — dịch vụ ngoan ngoãn tải về và hiển thị nội dung. Firewall vòng ngoài không bị chạm tới: request xuất phát từ **bên trong**.

## Position

```text
Hai hướng mà mã lạ đi vào hệ thống của bạn:

RA NGOÀI (SSRF)      server của bạn gọi URL do người dùng chọn
                     → nó là một proxy mà attacker điều khiển

VÀO TRONG (supply chain)  bạn chạy code người khác viết
                     → dependency, base image, GitHub Action, script cài đặt
```

Hai chủ đề trong cùng một note vì chúng chia sẻ một tính chất: **ranh giới tin cậy nằm ở nơi bạn không nhìn**.

## Problem

```text
SSRF
  Server của bạn thường được tin tưởng nhiều hơn Internet:
    · ở trong VPC, sau firewall
    · có quyền gọi dịch vụ nội bộ không cần xác thực
    · có credential từ metadata service của cloud
  ⇒ khiến nó gọi hộ = mượn toàn bộ mức tin cậy đó

Supply chain
  Một `npm install` kéo về hàng nghìn gói của hàng trăm tác giả.
  Chúng chạy với QUYỀN CỦA BẠN — lúc build, lúc chạy, và cả trong CI.
  ⇒ bề mặt tấn công lớn hơn nhiều lần so với code bạn viết.
```

## Mental Model

### SSRF: mọi lời gọi ra ngoài với URL từ người dùng

Bề mặt rộng hơn cảm giác ban đầu:

```text
· nhập dữ liệu từ URL · tải ảnh từ URL · webhook do người dùng cấu hình
· xem trước link (unfurl) · chuyển đổi HTML→PDF · proxy ảnh
· "kiểm tra kết nối" khi cấu hình tích hợp
· XML parser với external entity · thư viện tự động theo redirect
```

Bất cứ chỗ nào có `fetch(userProvidedUrl)`, ở đó có câu hỏi SSRF.

### Vì sao danh sách chặn (blocklist) không hoạt động

```text
Chặn "localhost" và "127.0.0.1" là chưa đủ, vì cùng một đích có nhiều cách viết:
  · tên miền do attacker kiểm soát TRỎ tới địa chỉ nội bộ (DNS rebinding)
  · nhiều dạng biểu diễn địa chỉ (thập phân, bát phân, IPv6-mapped)
  · redirect: URL hợp lệ trả về 302 tới đích nội bộ
  · địa chỉ nội bộ khác ngoài loopback: dải riêng, link-local, metadata endpoint

⇒ Không thể liệt kê hết cách viết. Phải kiểm tra ĐÍCH THẬT SỰ KẾT NỐI TỚI.
```

### Phòng thủ SSRF theo thứ tự hiệu quả

```text
① KHÔNG CHO NGƯỜI DÙNG CHỌN ĐÍCH
   Danh sách nhà cung cấp được hỗ trợ, người dùng chọn từ danh sách.
   → loại bỏ lớp lỗi, không phải giảm nhẹ nó.

② TÁCH MẠNG (mạnh nhất khi vẫn cần URL tự do)
   Đưa mọi lời gọi ra ngoài qua một EGRESS PROXY ở mạng riêng
   không có đường tới dịch vụ nội bộ và không có credential.
   → SSRF thành công cũng chỉ tới được Internet công cộng.

③ VALIDATE Ở TẦNG KẾT NỐI
   Phân giải DNS → kiểm tra IP → kết nối tới CHÍNH IP ĐÓ
   → chặn DNS rebinding (đích không đổi được giữa lúc kiểm và lúc kết nối)

④ TẮT REDIRECT hoặc kiểm tra lại mỗi chặng

⑤ GIỚI HẠN: chỉ http/https · cổng 80/443 · timeout · kích thước tối đa
   · không trả nội dung phản hồi nguyên văn cho người dùng
```

Điểm ⑤ cuối cùng quan trọng: nếu server không **trả lại** nội dung, SSRF trở nên khó khai thác hơn nhiều (attacker mất kênh phản hồi).

```ts
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// dải KHÔNG được phép kết nối tới
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4 ánh xạ sang IPv6
    return mapped ? isPrivate(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)         // link-local: gồm metadata endpoint của cloud
    || a >= 224;                         // multicast, reserved
}

export async function safeFetch(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('scheme không được phép');

  const { address } = await lookup(url.hostname);
  if (isPrivate(address)) throw new Error('đích nội bộ');

  return fetch(url, {
    // kết nối tới IP ĐÃ KIỂM TRA — không phân giải DNS lần thứ hai
    dispatcher: new Agent({ connect: { lookup: (_h, _o, cb) => cb(null, address, 4) } }),
    redirect: 'manual',                       // tự xử lý từng chặng
    signal: AbortSignal.timeout(5_000),
  });
}
```

Điểm tinh tế nhất trong đoạn code trên là ép kết nối tới **IP đã kiểm tra**. Nếu bạn kiểm tra rồi để thư viện phân giải DNS lại, một tên miền có thể trả về IP khác ở lần thứ hai — kiểm tra trở nên vô nghĩa.

### Metadata service của cloud

```text
Trên cloud, một địa chỉ link-local trả về credential tạm thời của instance/pod
mà KHÔNG cần xác thực. Đó là điều làm SSRF trên cloud nghiêm trọng hơn hẳn.

Phòng thủ ở tầng hạ tầng:
  · AWS: bắt buộc IMDSv2 (yêu cầu token qua PUT, giới hạn hop) hoặc tắt IMDS
  · dùng IAM role cho service account (IRSA / Workload Identity) thay vì credential instance
  · NetworkPolicy chặn pod truy cập dải link-local
  · gán quyền tối thiểu cho role — SSRF lấy được credential vẫn bị giới hạn
```

Đây là ví dụ rõ nhất cho nguyên tắc phòng thủ theo lớp: bốn biện pháp trên độc lập nhau, và mỗi cái đều biến sự cố nghiêm trọng thành sự cố nhỏ.

### Webhook do người dùng cấu hình

Đây là SSRF **được thiết kế có chủ đích** — người dùng đúng là phải chọn URL.

```text
✓ chỉ https, chỉ IP công cộng, kiểm tra lại mỗi lần gửi (IP có thể đổi)
✓ gửi từ egress proxy / dải IP riêng biệt, công bố dải đó cho khách hàng
✓ ký payload (HMAC) để bên nhận xác minh nguồn
✓ timeout ngắn, không theo redirect, giới hạn kích thước phản hồi
✓ KHÔNG trả nội dung phản hồi cho người cấu hình
✓ retry có giới hạn + circuit breaker cho endpoint chết
```

### Supply chain: bốn nơi mã lạ chạy

```text
① CÀI ĐẶT     postinstall script chạy khi npm install — kể cả trên máy dev và trong CI
② BUILD       plugin bundler, transformer, code generator
③ RUNTIME     dependency trong production
④ CI          GitHub Action bên thứ ba chạy với quyền của workflow
```

Nơi ① và ④ hay bị bỏ qua nhất, và cả hai có quyền truy cập rất cao: máy dev có credential cá nhân, CI có secret của toàn dự án.

```text
✓ npm ci --ignore-scripts trong CI (chạy script chỉ khi thật sự cần build native)
✓ ghim GitHub Action theo SHA commit, không theo tag (tag di chuyển được)
✓ token CI đặc quyền tối thiểu, phạm vi theo job
✓ tách job build (không có secret) khỏi job deploy (có secret)
```

### Kiểm soát cái bạn kéo về

```text
LOCKFILE ĐƯỢC COMMIT + `npm ci`
  → cùng cây phụ thuộc chính xác ở mọi nơi
  → `npm install` có thể nâng phiên bản; `npm ci` thì không

GHIM PHIÊN BẢN
  · dependency: lockfile lo
  · Docker base image: dùng DIGEST (`node:20.11-alpine@sha256:...`), không dùng tag
  · GitHub Action: SHA commit

TỐI THIỂU HOÁ
  · mỗi dependency là code bạn chịu trách nhiệm
  · gói 20 dòng thay bằng 20 dòng của bạn
  · gỡ dependency không dùng — `depcheck`

QUÉT + CÓ QUY TRÌNH XỬ LÝ
  · `npm audit`, Dependabot/Renovate, Trivy cho image
  · quét mà không xử lý = tiếng ồn; cần định nghĩa: mức nào chặn merge
```

### Phân biệt "có CVE" và "có rủi ro"

```text
CVE trong một gói KHÔNG tự động nghĩa là bạn bị ảnh hưởng:
  · lỗ hổng nằm ở đường code bạn không gọi
  · nó là devDependency, không vào production
  · điều kiện khai thác không tồn tại trong ngữ cảnh của bạn

⇒ đánh giá theo NGỮ CẢNH, không theo màu của bảng cảnh báo
⇒ nhưng: nợ nâng cấp tích tụ đến lúc không nâng nổi
   → cập nhật đều đặn rẻ hơn cập nhật khi khẩn cấp
```

Đội ngũ bỏ qua mọi cảnh báo và đội ngũ nâng cấp mọi thứ ngay lập tức đều sai — cái đầu tích nợ, cái sau tiêu hết thời gian vào nhiễu.

### Typosquatting và gói bị chiếm

```text
Rủi ro thực tế khi thêm một dependency mới:
  · tên gần giống gói phổ biến (sai một ký tự)
  · gói thật bị chiếm tài khoản, phiên bản mới chứa mã lạ
  · maintainer chuyển giao cho người khác

Giảm nhẹ:
  · kiểm tra kỹ TÊN và repository khi thêm gói mới (đây là lúc duy nhất bạn nhìn nó)
  · trì hoãn cập nhật vài ngày với gói không khẩn cấp
    → phiên bản độc hại thường bị gỡ trong vòng vài giờ tới vài ngày
  · registry nội bộ / proxy cache có kiểm duyệt
  · SBOM để biết mình đang chạy gì khi có tin xấu
```

Điểm cuối là điều quyết định tốc độ phản ứng: khi một gói được công bố là độc hại, câu hỏi đầu tiên là "chúng ta có dùng nó không, ở đâu, phiên bản nào?". Không có SBOM thì câu đó mất hàng giờ.

## Example

Tính năng "nhập dữ liệu từ URL" thiết kế lại theo hướng loại bỏ lớp lỗi:

```ts
// ✗ thiết kế ban đầu: server tải URL người dùng đưa
@Post('import')
async import(@Body('url') url: string) {
  const res = await fetch(url);              // SSRF
  return this.parser.parseCsv(await res.text());
}

// ✓ lựa chọn 1: người dùng TẢI FILE LÊN — không có lời gọi ra ngoài nào
@Post('import')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
async import(@UploadedFile() file: Express.Multer.File) {
  return this.parser.parseCsv(file.buffer.toString('utf8'));
}

// ✓ lựa chọn 2: vẫn cần URL → qua egress proxy + validate + giới hạn
@Post('import')
async importFromUrl(@Body('url') url: string, @CurrentUser() user: User) {
  await this.limiter.consume(`import:${user.id}`);          // chống dùng làm máy quét
  const res = await this.egress.safeFetch(url, {            // proxy mạng riêng
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 5_000,
    allowedContentTypes: ['text/csv', 'text/plain'],
  });
  return this.parser.parseCsv(res.body);                    // KHÔNG trả nguyên văn phản hồi
}
```

Lựa chọn 1 đáng cân nhắc nghiêm túc trước khi làm lựa chọn 2. Nó không "an toàn hơn" — nó khiến câu hỏi SSRF **không tồn tại**, cùng với toàn bộ chi phí duy trì các biện pháp ở lựa chọn 2.

## Prediction

1. Chặn chuỗi `localhost` và `127.0.0.1` trong URL — có chặn được mọi đích nội bộ không?
2. Kiểm tra IP rồi gọi `fetch(url)` để thư viện phân giải DNS lại — vấn đề gì?
3. Thư viện tự động theo redirect, URL đầu tiên hợp lệ trả 302 tới đích nội bộ — chuyện gì xảy ra?
4. Service chạy trên cloud với credential từ metadata endpoint, có SSRF — thiệt hại?
5. Cùng vậy nhưng dùng IAM role phạm vi hẹp cho service account — thiệt hại?
6. Server trả nguyên văn nội dung phản hồi cho người dùng — điều đó thay đổi gì?
7. Không trả nội dung, chỉ trả "thành công/thất bại" — attacker còn suy ra được gì?
8. `npm install` trong CI với `postinstall` script của một dependency — script chạy với quyền gì?
9. GitHub Action ghim theo tag `@v3`, tag được di chuyển sang commit khác — bạn chạy code nào?
10. Ghim theo SHA commit — bạn chạy code nào?
11. Base image `node:20-alpine`, build lại sau hai tháng — cùng image không?
12. Base image theo digest — cùng image không?
13. Một gói phổ biến bị công bố là chứa mã độc, bạn không có SBOM — mất bao lâu để biết mình có bị ảnh hưởng?

<details>
<summary>Đáp án</summary>

1. **Không** — cùng một đích có nhiều cách viết, và DNS trỏ được tới bất kỳ đâu.
2. **DNS rebinding**: lần phân giải thứ hai có thể trả IP khác — kiểm tra trở nên vô nghĩa.
3. Request **tới đích nội bộ** — kiểm tra chỉ áp dụng cho URL đầu tiên.
4. Credential của instance bị lộ → **mọi quyền mà role đó có**.
5. Giới hạn ở đúng phạm vi của role — có thể là không đáng kể.
6. Attacker có **kênh phản hồi đầy đủ** — SSRF dễ khai thác hơn nhiều.
7. Vẫn suy ra được **cổng nào mở, dịch vụ nào tồn tại** qua thành công/thất bại và thời gian.
8. **Quyền của runner CI** — gồm mọi secret mà job đó truy cập được.
9. **Code ở commit mới** — tag là con trỏ di chuyển được.
10. Đúng commit đó, luôn luôn.
11. **Không** — tag được cập nhật; đó vừa là ưu điểm (vá bảo mật) vừa là rủi ro (không tái lập được).
12. **Cùng chính xác** — nhưng bạn phải chủ động cập nhật digest để nhận bản vá.
13. Hàng giờ hoặc lâu hơn — và đó là lý do SBOM tồn tại.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Nhập URL trỏ tới dải riêng vào tính năng nhập từ URL | Có bị chặn không? |
| Nhập tên miền công cộng trỏ tới địa chỉ nội bộ | Kiểm tra ở tầng nào? |
| URL trả 302 tới đích nội bộ | Redirect có được kiểm lại không? |
| URL với scheme không phải http/https | Bị từ chối? |
| URL tới cổng lạ (không 80/443) | Bị từ chối? |
| URL tới endpoint trả dữ liệu rất lớn | Có giới hạn kích thước không? |
| URL tới endpoint không phản hồi | Có timeout không? |
| `npm ls <package>` cho một CVE bất kỳ | Bạn có dùng nó không, ở nhánh nào? |
| `npm ci --ignore-scripts` rồi chạy test | Có gì hỏng không? Nếu không, giữ nó |
| `docker image inspect <img> --format '{{.RepoDigests}}'` | Bạn đang chạy digest nào? |
| Build lại image sau một tháng, so digest | Đã đổi chưa? |
| `depcheck` | Bao nhiêu dependency không dùng? |
| Đọc file `postinstall` của một dependency mới | Nó làm gì? |

## What Usually Goes Wrong

- **Danh sách chặn theo chuỗi** thay vì kiểm tra IP thật sự kết nối tới.
- **Kiểm tra rồi phân giải DNS lại** → DNS rebinding.
- **Theo redirect mà không kiểm lại.**
- **Trả nguyên văn phản hồi** cho người dùng.
- **Credential instance rộng quyền** thay vì role phạm vi hẹp.
- **Không tách mạng cho lời gọi ra ngoài.**
- **Webhook không giới hạn**, dùng được làm máy quét cổng.
- **`npm install` thay vì `npm ci`** trong CI.
- **Chạy postinstall script** ở nơi không cần.
- **Action/base image ghim theo tag.**
- **Quét dependency nhưng không có quy trình xử lý** → cảnh báo bị bỏ qua hết.
- **Nâng cấp mọi thứ ngay lập tức** → chạy vào phiên bản độc hại vừa xuất bản.
- **Không có SBOM** → không trả lời được "chúng ta có dùng gói đó không".
- **Token CI đặc quyền rộng** dùng chung cho mọi job.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Firewall vòng ngoài chặn SSRF | Request xuất phát từ bên trong |
| Chặn `localhost` là đủ | Có nhiều cách viết và DNS trỏ được bất kỳ đâu |
| Kiểm tra URL một lần là xong | Redirect và DNS đổi được sau đó |
| SSRF chỉ đọc được dữ liệu | Nó gọi được cả endpoint gây thay đổi trạng thái |
| Webhook người dùng cấu hình là an toàn vì có chủ đích | Nó vẫn là SSRF, chỉ là được thiết kế |
| `npm audit` sạch nghĩa là an toàn | Nó chỉ biết CVE đã công bố |
| Có CVE nghĩa là đang bị đe doạ | Phụ thuộc đường code và ngữ cảnh |
| Lockfile ngăn mọi thay đổi | Chỉ khi dùng `npm ci` |
| Tag Docker là bất biến | Tag di chuyển được; digest thì không |
| Dependency ít sao thì rủi ro thấp | Gói phổ biến là mục tiêu hấp dẫn hơn |
| CI là môi trường nội bộ nên an toàn | Nó giữ secret của toàn dự án |

## Debugging

1. **Tìm bề mặt SSRF**: `grep -rn 'fetch(\|axios\|got(\|request(' src/` rồi lọc ra chỗ URL đến từ input.
2. **Ghi log mọi lời gọi ra ngoài** kèm đích đã phân giải — đây cũng là dữ liệu phát hiện.
3. **Kiểm tra egress thực tế** từ trong container: nó tới được những đâu? Nếu tới được dịch vụ nội bộ, tách mạng chưa hoàn tất.
4. **Kiểm tra metadata endpoint** có truy cập được từ pod không — nếu có, đó là hạng mục cần sửa.
5. **`npm ls <package>`** trả lời "gói này vào cây phụ thuộc qua đường nào".
6. **`npm ci --ignore-scripts`** rồi chạy test: nếu mọi thứ hoạt động, bật nó vĩnh viễn trong CI.
7. **So digest image** giữa các lần build để biết base image đã đổi chưa.
8. **Khi có tin về gói độc hại**: tra SBOM trước, rồi lockfile, rồi log cài đặt của CI trong khoảng thời gian liên quan.

## Production Considerations

- **Ưu tiên loại bỏ**: tải file lên hoặc danh sách nhà cung cấp thay vì URL tự do.
- **Egress proxy ở mạng riêng** cho mọi lời gọi ra ngoài với URL từ người dùng.
- **Validate ở tầng kết nối**, kết nối tới IP đã kiểm tra, không theo redirect tự động.
- **Chặn dải riêng và link-local**; bắt buộc IMDSv2 hoặc tắt IMDS.
- **IAM role phạm vi hẹp cho service account**, không dùng credential instance.
- **Không trả nguyên văn phản hồi**; giới hạn kích thước, timeout, content-type.
- **Rate limit tính năng gọi URL** — nó cũng là công cụ quét nếu không giới hạn.
- **Webhook: ký HMAC, IP nguồn cố định và công bố, không theo redirect.**
- **`npm ci` với lockfile được commit**; `--ignore-scripts` ở nơi không cần build native.
- **Ghim base image theo digest, Action theo SHA**; cập nhật có chủ đích qua Renovate.
- **Tách job build (không secret) và job deploy (có secret)**; token đặc quyền tối thiểu theo job.
- **Sinh SBOM cho mỗi artifact** và lưu cùng artifact.
- **Chính sách rõ ràng cho kết quả quét**: mức nào chặn merge, mức nào ghi nhận, ai quyết định.
- **Cập nhật đều đặn theo lịch** thay vì dồn lại; trì hoãn vài ngày với bản mới không khẩn cấp.
- **Ký artifact và xác minh khi deploy** (Sigstore/cosign) nếu chuỗi cung ứng là mối lo chính.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Không cho URL tự do | loại bỏ lớp lỗi | mất tính năng người dùng muốn |
| Egress proxy | SSRF chỉ tới Internet công cộng | thêm hạ tầng và một điểm hỏng |
| Validate ở tầng kết nối | chặn DNS rebinding | code phức tạp, dễ sai |
| Không theo redirect | an toàn | một số URL hợp lệ không dùng được |
| Ghim theo digest | tái lập được | phải chủ động cập nhật để nhận vá |
| Ghim theo tag | tự nhận vá | không tái lập được |
| `--ignore-scripts` | chặn mã chạy lúc cài | một số gói native cần script |
| Cập nhật ngay | vá nhanh | gặp phiên bản độc hại vừa xuất bản |
| Trì hoãn vài ngày | tránh bản độc hại | cửa sổ chưa vá dài hơn |
| Ít dependency | bề mặt nhỏ | tự viết nhiều hơn |
| SBOM | phản ứng nhanh khi có tin xấu | thêm bước trong pipeline |

## Explain Without Notes

1. Vì sao SSRF nghiêm trọng hơn "server gọi một URL"?
2. Vì sao danh sách chặn theo chuỗi không hoạt động?
3. DNS rebinding vượt qua kiểm tra IP bằng cách nào, và cách chặn?
4. Vì sao SSRF trên cloud nguy hiểm hơn, và bốn lớp phòng thủ?
5. Webhook do người dùng cấu hình khác gì SSRF, và làm sao cho an toàn?
6. Bốn nơi mã của bên thứ ba chạy trong quy trình của bạn?
7. Tag và digest khác nhau ra sao? Mỗi cái đánh đổi gì?
8. Vì sao "có CVE" không đồng nghĩa "đang bị đe doạ", và vì sao vẫn phải cập nhật đều?

## Related

- [Security basics](01-security-basics.md) — ranh giới tin cậy, đặc quyền tối thiểu
- [Injection](02-injection.md) — cùng hình dạng: dữ liệu thành lệnh
- [Secrets management](06-secrets-management.md) — credential mà SSRF nhắm tới
- [NAT, firewall & routing](../../04-infrastructure/01-networking/04-nat-firewall-routing.md) — tách mạng egress
- [Production image](../../04-infrastructure/02-docker/07-production-image.md) — base image, digest
- [Build & artifact promotion](../../04-infrastructure/03-cicd/02-build-artifact-promotion.md) — ghim và ký artifact
- [Config, Secret & resources](../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md) — service account, quyền pod
- [Timeout, retry & circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md) — gọi ra ngoài an toàn

## Version / Context

OWASP Top 10 (2021): A10 SSRF, A08 Software and Data Integrity Failures, A06 Vulnerable and Outdated Components. Ví dụ dùng Node.js 20+ (`undici`/`fetch`, `AbortSignal.timeout`). Công cụ: Renovate/Dependabot, Trivy/Grype, Syft cho SBOM (CycloneDX/SPDX), Sigstore cosign để ký. Nội dung tập trung vào **phòng thủ**: không mô tả kỹ thuật khai thác cụ thể.
