---
level: intermediate
area: cross-cutting
prerequisites:
  - ../../02-backend-api/03-auth/01-authentication-authorization.md
related:
  - 04-access-control.md
  - ../../06-system-design/01-requirements-tradeoffs.md
---

# Security basics: mô hình đe doạ

> Một team dành ba tuần cấu hình WAF, bật mọi security header, quét dependency hằng ngày. Sự cố thực tế xảy ra sáu tháng sau: một endpoint nội bộ `/admin/export` không có kiểm tra quyền, được một nhân viên cũ gọi trực tiếp. Không có công cụ nào trong ba tuần đó nhìn vào endpoint ấy — vì **không ai từng viết ra hệ thống này bảo vệ cái gì, khỏi ai**.

## Position

```text
Trước khi viết bất kỳ biện pháp phòng thủ nào:
  ① BẢO VỆ CÁI GÌ?   → tài sản
  ② KHỎI AI?          → tác nhân
  ③ QUA ĐƯỜNG NÀO?    → bề mặt tấn công
  ④ ĐÁNH ĐỔI RA SAO?  → chi phí vs rủi ro

Mọi note security khác trong folder này là câu trả lời cho ③.
```

## Problem

Bảo mật không phải một danh sách việc cần làm. Nó là một **quá trình ra quyết định dưới ràng buộc tài nguyên**:

```text
Bạn không thể bảo vệ mọi thứ như nhau.
Bạn cũng không thể biết trước mọi lỗ hổng.

⇒ Câu hỏi đúng không phải "hệ thống này có an toàn không?"
   mà là "cái gì hỏng thì đau nhất, và nó hỏng qua đường nào?"
```

Không có mô hình đe doạ, bạn sẽ:

```text
✗ tối ưu thứ dễ đo (số lượng header, số CVE) thay vì thứ quan trọng
✗ bỏ trống những đường mà không công cụ tự động nào nhìn vào
     → logic nghiệp vụ, kiểm soát truy cập, quy trình hỗ trợ khách hàng
```

Đây chính xác là điều đã xảy ra trong sự cố ở đầu note.

## Mental Model

### CIA — ba thứ có thể mất

```text
Confidentiality  dữ liệu bị người không nên xem đọc được
Integrity        dữ liệu bị thay đổi ngoài ý muốn
Availability     hệ thống không phục vụ được
```

Ba thứ này **xung đột nhau**. Mã hoá mạnh hơn → khôi phục khó hơn (availability). Rate limit chặt hơn → người dùng thật bị chặn. Không có "an toàn hơn" chung chung; chỉ có "an toàn hơn theo trục nào, đánh đổi trục nào".

Với hầu hết ứng dụng kinh doanh, thứ tự ưu tiên thực tế là:

```text
Integrity > Confidentiality > Availability
```

Dữ liệu sai âm thầm tệ hơn dữ liệu bị đọc trộm, và cả hai tệ hơn downtime — vì downtime nhìn thấy được và sửa được.

### Bốn câu hỏi của mô hình đe doạ

Đây là phiên bản rút gọn, đủ dùng cho một feature hoặc một service:

```text
① Chúng ta đang xây gì?      vẽ luồng dữ liệu, đánh dấu ranh giới tin cậy
② Cái gì có thể sai?          duyệt từng ranh giới
③ Chúng ta làm gì với nó?     giảm nhẹ / chuyển giao / chấp nhận / loại bỏ
④ Chúng ta làm đủ tốt chưa?   kiểm chứng bằng test, không bằng cảm giác
```

Hai giờ với bốn câu hỏi này, làm **trước khi code**, có giá trị hơn một tháng cấu hình công cụ.

### Ranh giới tin cậy — khái niệm trung tâm

```text
Ranh giới tin cậy = nơi dữ liệu đi từ vùng ít tin cậy sang vùng tin cậy hơn
```

```text
Browser ══║══> API ══║══> Database
        (1)        (2)
                       ══║══> dịch vụ bên thứ ba
                       (3)
```

Mọi lỗ hổng lớn đều là **một ranh giới không được kiểm tra**:

| Ranh giới | Nếu không kiểm tra |
|---|---|
| Browser → API | mọi input là của attacker: injection, IDOR, mass assignment |
| API → Database | query ghép chuỗi → SQL injection |
| API → bên thứ ba | SSRF, rò rỉ dữ liệu qua log của họ |
| CI → production | secret trong build log, artifact bị thay |
| Người dùng → hỗ trợ khách hàng | social engineering |

**Nguyên tắc**: dữ liệu qua ranh giới thì phải **validate ở phía nhận**. Validate ở phía gửi (frontend) là UX, không phải bảo mật.

### STRIDE — sáu câu hỏi cho mỗi ranh giới

Cách nhanh nhất để "duyệt từng ranh giới" mà không bỏ sót:

```text
S  Spoofing              giả mạo danh tính     → xác thực
T  Tampering             sửa dữ liệu           → chữ ký, ràng buộc, checksum
R  Repudiation           chối bỏ hành vi       → audit log
I  Information disclosure lộ thông tin         → phân quyền, mã hoá, thông báo lỗi
D  Denial of service     làm ngưng dịch vụ     → rate limit, timeout, quota
E  Elevation of privilege leo thang quyền      → kiểm soát truy cập
```

Với một endpoint, đi qua sáu chữ cái mất năm phút và thường tìm ra ít nhất một thứ chưa nghĩ tới.

### Không tin gì cả: input là dữ liệu, không phải lệnh

Gần như mọi lớp lỗ hổng "injection" đều cùng một hình dạng:

```text
Dữ liệu do người dùng cung cấp được DIỄN GIẢI như mã/lệnh:
  → chuỗi ghép vào SQL         → SQL injection
  → chuỗi ghép vào HTML        → XSS
  → chuỗi ghép vào lệnh shell  → command injection
  → chuỗi ghép vào URL nội bộ  → SSRF
  → chuỗi ghép vào template    → template injection
```

Cách phòng thủ cũng cùng một hình dạng: **tách dữ liệu khỏi lệnh** (tham số hoá), không phải "lọc ký tự xấu". Xem [Injection](02-injection.md).

### Phòng thủ theo lớp, và cái nào là lớp thật

```text
Lớp phòng thủ tốt = lớp vẫn hoạt động khi lớp khác bị bỏ qua

✓ ownership trong WHERE       — không bỏ qua được
✓ ràng buộc ở database         — không bỏ qua được
✓ RLS                          — không bỏ qua được
~ guard ở API                  — bỏ qua nếu quên decorator
~ WAF                          — bỏ qua nếu request hợp lệ về hình thức
✗ ẩn nút trên UI               — không phải lớp phòng thủ
✗ obscurity (URL khó đoán)     — không phải lớp phòng thủ
```

Câu hỏi kiểm tra: **"nếu attacker gọi thẳng API bằng curl, lớp này còn tác dụng không?"** Nếu không, nó là UX.

### Ba nguyên tắc định hình thiết kế

```text
① ĐẶC QUYỀN TỐI THIỂU
   service DB account chỉ cần SELECT/INSERT/UPDATE trên bảng của nó
   → không cần DROP, không cần đọc bảng của service khác
   → giới hạn thiệt hại khi một thành phần bị chiếm

② MẶC ĐỊNH ĐÓNG (fail closed)
   quên cấu hình → bị chặn, không phải được mở
   → lỗi bị phát hiện ở lần test đầu, không phải ở lần pentest thứ ba

③ GIẢM BỀ MẶT TẤN CÔNG
   endpoint không dùng → xoá
   cổng không cần → đóng
   dependency không dùng → gỡ
   → thứ không tồn tại thì không bị tấn công
```

Nguyên tắc ③ là nguyên tắc rẻ nhất và bị bỏ qua nhiều nhất.

### Lỗi phổ biến vs lỗi nguy hiểm

OWASP Top 10 (2021) xếp theo mức độ phổ biến trong dữ liệu thực tế:

```text
A01 Broken Access Control    ← số 1, và là loại KHÔNG công cụ nào tự tìm được
A02 Cryptographic Failures
A03 Injection
A04 Insecure Design          ← thiếu chính mô hình đe doạ này
A05 Security Misconfiguration
A06 Vulnerable Components
A07 Auth Failures
A08 Data Integrity Failures  ← supply chain, deserialization
A09 Logging & Monitoring Failures
A10 SSRF
```

Điều đáng chú ý: **A01 và A04 phụ thuộc vào nghiệp vụ của bạn**, nên không có công cụ nào tìm hộ. Đó là lý do mô hình đe doạ không thay thế được bằng scanner.

### Rủi ro là hàm hai biến

```text
Rủi ro ≈ Khả năng xảy ra × Thiệt hại

Cao × Cao   → sửa ngay
Cao × Thấp  → sửa theo lịch
Thấp × Cao  → giảm nhẹ + chuẩn bị phản ứng (backup, kế hoạch sự cố)
Thấp × Thấp → ghi nhận, chấp nhận
```

"Chấp nhận rủi ro" là một quyết định hợp lệ — miễn là nó được **viết ra và ai đó chịu trách nhiệm**. Rủi ro không ghi nhận không phải là rủi ro được chấp nhận; nó là rủi ro bị bỏ quên.

## Example

Mô hình đe doạ cho một endpoint upload avatar — mười phút, viết ra giấy:

```text
① XÂY GÌ
   Browser → POST /users/me/avatar (multipart) → API → S3 → CDN → mọi người xem

   Ranh giới: browser→API (1) · API→S3 (2) · CDN→công chúng (3)

② CÓ THỂ SAI GÌ (STRIDE ở ranh giới 1)
   S  người dùng A upload cho hồ sơ của B          → authz theo `me`, không theo id trong body
   T  file không phải ảnh (SVG chứa script, HTML)  → kiểm tra magic bytes + re-encode
   R  không biết ai upload cái gì                  → audit log userId + object key
   I  tên file chứa đường dẫn (../../)             → sinh tên MỚI, không dùng tên client
      metadata EXIF chứa toạ độ GPS                → xoá EXIF khi re-encode
   D  file 2 GB, hoặc "zip bomb" ảnh 50000×50000   → giới hạn kích thước VÀ số điểm ảnh
   E  không có                                      → endpoint không cấp quyền gì

③ LÀM GÌ
   giảm nhẹ: giới hạn 5 MB + 4000×4000 px, chỉ nhận jpeg/png/webp theo MAGIC BYTES,
             re-encode bằng thư viện ảnh (xoá EXIF và mọi nội dung nhúng),
             tên object = uuid, Content-Type do SERVER đặt,
             phục vụ từ TÊN MIỀN KHÁC (không cùng origin với app),
             rate limit 5 lần/giờ/người
   chấp nhận: ảnh không phù hợp về nội dung → xử lý bằng báo cáo, không bằng kỹ thuật

④ KIỂM CHỨNG
   test: upload .svg đổi đuôi .png          → bị từ chối
         upload file 6 MB                   → 413
         upload ảnh 20000×20000 (file nhỏ)  → bị từ chối
         POST avatar với userId của người khác → 403/404
         kiểm tra Content-Type trả về từ CDN  → image/*, không phải text/html
```

Hai quyết định trong danh sách trên đáng chú ý vì chúng không đến từ checklist:

```text
"phục vụ từ tên miền khác"
  → nếu file người dùng nằm cùng origin với app,
    một file HTML lọt qua sẽ chạy script TRONG origin của bạn
    → đọc được cookie, gọi được API với quyền người dùng
  → tên miền riêng biến lỗ hổng nghiêm trọng thành phiền toái nhỏ

"giới hạn SỐ ĐIỂM ẢNH, không chỉ dung lượng"
  → ảnh nén cực tốt: file 200 KB giải nén thành 4 GB trong bộ nhớ
  → giới hạn dung lượng KHÔNG chặn được kiểu này
```

Cả hai đến từ việc hỏi "chuyện gì có thể sai ở ranh giới này", không từ việc đọc danh sách header nên bật.

## Prediction

1. Validate ở frontend, không validate ở backend — attacker gọi API bằng `curl` thì sao?
2. Ẩn nút "Xoá" cho người dùng thường, API không kiểm tra — họ xoá được không?
3. URL khó đoán (`/report/8f3a9c...`) không kiểm quyền — có an toàn không?
4. DB account của service có quyền `DROP TABLE` — nếu có SQL injection thì thiệt hại thế nào?
5. Cùng vậy với account chỉ có `SELECT/INSERT/UPDATE`?
6. Guard mặc định mở, thêm endpoint mới quên decorator — hậu quả?
7. Mặc định đóng, quên — hậu quả?
8. File người dùng upload phục vụ từ cùng origin với app, một file HTML lọt qua — attacker làm được gì?
9. Từ tên miền riêng?
10. Chỉ giới hạn dung lượng 5 MB, không giới hạn kích thước ảnh — ảnh nén tốt gây ra gì?
11. Tên object dùng tên file client cung cấp — vấn đề gì?
12. Không có audit log, phát hiện dữ liệu bị rò rỉ — trả lời được "ai đã xem gì" không?

<details>
<summary>Đáp án</summary>

1. **Mọi validation bị bỏ qua** — frontend validation là UX.
2. **Được** — ẩn nút không phải kiểm soát truy cập.
3. **Không** — URL xuất hiện trong log, header `Referer`, lịch sử, được chia sẻ. Obscurity không phải phòng thủ.
4. **Toàn bộ database** — kể cả xoá.
5. Giới hạn ở dữ liệu service đó chạm tới; không xoá được cấu trúc.
6. Endpoint **công khai** cho tới khi ai đó phát hiện.
7. Endpoint **bị chặn** — phát hiện ngay khi test.
8. Script chạy **trong origin của bạn**: đọc được cookie không-HttpOnly, gọi API với phiên của nạn nhân.
9. Script chạy trong origin khác — **không chạm được** dữ liệu của app.
10. **Cạn bộ nhớ** khi giải nén — DoS.
11. Path traversal (`../../`), ghi đè object khác, XSS qua tên file khi hiển thị.
12. **Không** — và đó là lý do A09 nằm trong Top 10.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gọi API bằng `curl` bỏ qua toàn bộ frontend | Validation/authz nào thật sự tồn tại? |
| Gửi trường không có trong form (`isAdmin: true`) | Mass assignment nếu được nhận |
| Đổi ID trong URL sang ID người khác | 200 = broken access control |
| Đổi đuôi file rồi upload | Kiểm tra theo đuôi hay theo magic bytes? |
| Upload ảnh kích thước rất lớn, file nhỏ | Bộ nhớ tăng vọt |
| Xem thông báo lỗi khi gửi dữ liệu sai | Có lộ stack trace, tên bảng, đường dẫn không? |
| Kiểm tra quyền của DB account: `\du` trong psql | Nhiều hơn mức cần? |
| Liệt kê endpoint và đối chiếu với guard | Cái nào không được bảo vệ? |
| Gỡ mạng tới một dependency | Hệ thống fail closed hay fail open? |
| Tìm secret trong repo và trong build log | Có gì lọt ra không? |

## What Usually Goes Wrong

- **Không có mô hình đe doạ** → phòng thủ tập trung sai chỗ.
- **Coi frontend validation là bảo vệ.**
- **Ẩn UI thay vì kiểm soát ở server.**
- **Dựa vào obscurity** (URL khó đoán, cổng lạ).
- **Fail open** khi dependency bảo mật (auth service, OPA) không phản hồi.
- **Đặc quyền quá rộng** cho DB account, service account, token CI.
- **Không xoá endpoint/dependency/cổng không dùng.**
- **Thông báo lỗi tiết lộ nội bộ** (stack trace, tên bảng, phiên bản).
- **Chỉ dựa vào scanner** → bỏ trống A01 và A04, hai loại phổ biến nhất.
- **Không có audit log** → sau sự cố không dựng lại được chuyện gì.
- **Không có kế hoạch phản ứng** → sự cố đầu tiên là lần diễn tập đầu tiên.
- **Bảo mật là việc của một người** → không ai khác nghĩ về nó khi viết code.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Bảo mật là một checklist | Nó là quyết định đánh đổi theo bối cảnh |
| HTTPS nghĩa là an toàn | Nó bảo vệ đường truyền, không bảo vệ logic |
| WAF chặn được lỗ hổng logic | WAF không biết ai được xem hoá đơn nào |
| Scanner tìm được mọi thứ | Nó không tìm được broken access control |
| Không ai biết endpoint này | Nó nằm trong bundle JS và trong log |
| Chúng ta nhỏ, không ai nhắm vào | Tấn công tự động không chọn mục tiêu |
| Bảo mật làm chậm phát triển | Sửa sau sự cố chậm hơn nhiều |
| Mã hoá mọi thứ là an toàn hơn | Nó dịch chuyển vấn đề sang quản lý khoá |
| An toàn tuyệt đối là mục tiêu | Mục tiêu là chi phí tấn công > giá trị thu được |
| Bảo mật là việc của team security | Quyết định nằm trong từng dòng code |

## Debugging

Khi nghi ngờ có sự cố bảo mật, thứ tự này giảm thiệt hại:

1. **Ngăn chặn trước, điều tra sau** — thu hồi credential, chặn IP, tắt tính năng. Đừng chờ hiểu đầy đủ.
2. **Bảo toàn bằng chứng** — snapshot log, không xoá container, ghi lại thời điểm.
3. **Dựng dòng thời gian** từ log: request đầu tiên bất thường lúc nào, từ đâu, với credential nào.
4. **Xác định phạm vi** — dữ liệu nào bị chạm tới? Câu này cần audit log ở tầng dữ liệu, không chỉ log HTTP.
5. **Xoay mọi bí mật có thể liên quan** — rẻ hơn nhiều so với đoán sai.
6. **Sửa nguyên nhân, không sửa triệu chứng** — chặn một IP không sửa endpoint thiếu authz.
7. **Postmortem không đổ lỗi**: điều kiện nào cho phép lỗi này tồn tại, và lớp nào lẽ ra phải bắt được?
8. **Thêm test cho chính lỗ hổng đó** — nếu không, nó quay lại.

## Production Considerations

- **Mô hình đe doạ cho mỗi feature có ranh giới tin cậy mới** — mười phút, viết ra.
- **Validate ở phía nhận, mọi ranh giới.**
- **Mặc định đóng** ở guard, firewall, CORS, và khi dependency bảo mật lỗi.
- **Đặc quyền tối thiểu** cho DB account, service account, token CI, IAM role.
- **Xoá thứ không dùng** — endpoint, cổng, dependency, tài khoản.
- **Thông báo lỗi chung ra ngoài, chi tiết vào log** kèm request id.
- **File người dùng phục vụ từ tên miền riêng**, `Content-Type` do server đặt.
- **Audit log ở tầng dữ liệu**: ai, làm gì, trên bản ghi nào, khi nào — không chỉ log HTTP.
- **Quét dependency trong CI** và có quy trình xử lý kết quả (nếu không xử lý thì quét vô nghĩa).
- **Xoay bí mật định kỳ** và có quy trình xoay khẩn cấp đã diễn tập.
- **Kế hoạch phản ứng sự cố viết sẵn**: ai gọi ai, tắt cái gì trước, thông báo cho ai.
- **Test đường từ chối trong CI** — kiểm soát truy cập không có test sẽ hồi quy im lặng.
- **Xem lại rủi ro đã chấp nhận định kỳ** — bối cảnh thay đổi thì quyết định cũng đổi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Mô hình đe doạ trước khi code | tìm lỗ hổng thiết kế sớm | thời gian trước khi bắt đầu |
| Chỉ dùng scanner | rẻ, tự động | bỏ trống lớp lỗi phổ biến nhất |
| Fail closed | an toàn | có thể tự gây downtime |
| Fail open | không tự gây downtime | mất kiểm soát khi có sự cố |
| Đặc quyền tối thiểu | giới hạn thiệt hại | cấu hình tỉ mỉ hơn |
| Nhiều lớp phòng thủ | chịu được một lớp hỏng | phức tạp, khó debug |
| Mã hoá dữ liệu nhạy cảm | lộ DB không đủ để đọc | quản lý khoá, mất khả năng query |
| Audit log đầy đủ | điều tra được | dung lượng, và bản thân log thành dữ liệu nhạy cảm |
| Rate limit chặt | chống lạm dụng | chặn người dùng thật |

## Explain Without Notes

1. Bốn câu hỏi của mô hình đe doạ, và vì sao câu ① phải đứng trước?
2. Ranh giới tin cậy là gì? Kể ba ranh giới trong hệ thống bạn đang làm.
3. Vì sao "lọc ký tự xấu" không phải cách chống injection?
4. Kiểm tra một-câu để phân biệt lớp phòng thủ thật với UX là gì?
5. Vì sao scanner không tìm được broken access control?
6. Đặc quyền tối thiểu thay đổi hậu quả của một lỗ hổng như thế nào?
7. Vì sao file người dùng nên phục vụ từ tên miền khác?
8. "Chấp nhận rủi ro" khác "bỏ quên rủi ro" ở điểm nào?

## Related

- [Injection](02-injection.md) — dữ liệu bị diễn giải thành lệnh
- [XSS & CSRF](03-xss-csrf.md) — ranh giới browser
- [Access control](04-access-control.md) — A01, lớp lỗi phổ biến nhất
- [SSRF & supply chain](05-ssrf-supply-chain.md) — ranh giới ra ngoài và vào trong
- [Secrets management](06-secrets-management.md) — bí mật rò rỉ ở đâu
- [Secure headers & TLS](07-secure-headers-tls.md) — cấu hình mặc định đúng
- [Authentication vs Authorization](../../02-backend-api/03-auth/01-authentication-authorization.md) — hai câu hỏi
- [Authorization models](../../02-backend-api/03-auth/06-authorization-models.md) — mô hình hoá quyền
- [Requirements & trade-offs](../../06-system-design/01-requirements-tradeoffs.md) — bảo mật là một yêu cầu phi chức năng

## Version / Context

Khung tham chiếu: OWASP Top 10 (2021), STRIDE (Microsoft), NIST Cybersecurity Framework. OWASP Application Security Verification Standard (ASVS) là danh sách kiểm tra chi tiết hơn khi cần mức chính thức. Nội dung note tập trung vào **phòng thủ và cách suy nghĩ**, không hướng dẫn khai thác.
